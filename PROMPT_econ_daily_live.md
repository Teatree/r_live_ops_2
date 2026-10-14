# Prompt — the simple per-day feed from the LIVE calendar start, `data_econ_daily_live`

Paste this to the analytics LLM **together with the `data_seg_beh` and `data_econ_daily` queries it
already wrote**, so it reuses the same cohort, segmentation, filters and currency mapping. This is a
repeatable pull: we will ask for it again every few days as the live calendar runs.

---

You wrote my `data_seg_beh` and `data_econ_daily` queries (pasted below). I need **one new result
set, `data_econ_daily_live`**: *"this is how much `<currency>` players of `<segment>` gained on day
N"*. No modelling, no simulation, no smoothing — raw daily totals and two plain denominators.

## 1. Purpose

A direct comparison line against my simulation, day by day, as the live calendar runs. It is
**incomplete by design**: if only 2 of 33 days exist, emit 2 days and nothing downstream breaks. The
line simply ends on the last day you have.

## 2. Window — day 1 is the live calendar start

- `window_start_date` = **`<<LIVE_CAL_START_DATE>>`** (I fill this in before sending; expose it as a
  Hex input `{{ live_cal_start_date_input }}`). It is the first calendar day of the live LiveOps
  calendar — the day-1 column of our calendar grid — which by our convention is a **Wednesday**. If
  the date I give you is not a Wednesday, say so in the notes; do not shift it.
- `day_index = date_diff('day', window_start_date, calendar_date) + 1`. Day 1 = the start date.
- End = the **last complete day** in the warehouse (`processdate` ≤ yesterday). Never include today.
- The 7-day rolling segmentation needs its 6-day run-up: `rolling_start_pd` = start − 6 days.
- Weekend for us = Fri/Sat/Sun; emit `dow` so nobody has to derive it.

## 3. Output schema — one row per (segment, payer_flag, currency, day_index)

| column | meaning |
|---|---|
| `segment` | `0-9`, `10-19`, `20-39`, `40-99`, `100+` — the modal 7-day saga play-rate tier of `data_seg_beh`, **same CASE, same thresholds, same modal rule** (`ORDER BY seg_days DESC, seg_rank DESC`). Not `player_profile_level`, not first-day-seen. No `A. 0` |
| `payer_flag` | `NONPAYER` / `PAYER`, lifetime payer, same as `data_seg_beh` |
| `currency` | exactly one of the 13 strings of the delivered `data_econ_daily`: `HC`, `Slingshot`, `Shuffle`, `Comet`, `Red`, `Chuck`, `Bomb`, `UL Bomb`, `UL Chuck`, `UL Red`, `Unlimited Lives`, `SPT`, `SPTx2` (+ §5 extras if measurable) |
| `day_index` | 1..N, N = days complete so far |
| `calendar_date` | the date of that day |
| `dow` | `Mon`..`Sun` |
| `gain_total` | raw total gained on that day by the cell (all sources) |
| `spend_total` | raw total spent/consumed on that day by the cell |
| `players_in_cell` | distinct players assigned to this (segment, payer_flag) over the days available — the population guard denominator (§6) |
| `active_players_day` | distinct players of the cell active on that day |
| `resource_earners_window` | distinct players of the cell with gain > 0 of this currency **anywhere in the days available** |
| `gain_per_active_player_day` | `gain_total ÷ active_players_day` |
| `spend_per_active_player_day` | `spend_total ÷ active_players_day` |
| `gain_per_earner_day` | `gain_total ÷ resource_earners_window` |
| `spend_per_earner_day` | `spend_total ÷ resource_earners_window` |
| `days_available` | N, constant on every row — the number of complete days this pull covers |
| `window_start_date` | §2, constant on every row |
| `status` | `MEASURED` on every row |

Emit every (segment, payer_flag, currency) × every **complete** day: `10 × 13 × N` rows, `0` where a
complete day had no gain. Never a row for a day that is not complete.

## 4. Two denominators — why both

- **`per_active_player_day`** — "a player who played today gained X". It depends only on that day,
  so a day delivered on Tuesday reads the same on Friday's re-pull. This is the stable one for a
  growing window and the one I compare day by day.
- **`per_earner_day`** — the `data_econ_daily` basis: window earner count, so the days are additive
  and sum to a per-earner window total that reconciles with `data_econ`/`data_gains`. **It drifts
  on re-pull**: `resource_earners_window` grows as days are added, so early days shrink slightly.
  Expected, not a bug; say which pull a number came from (`days_available`).

Both denominators are **players, not rows** (one account counts once). State in the notes how each
was counted.

## 5. Units and extras

Units identical to `data_econ_daily`: `HC` = coins only, from **`player_daily.hc_gain` / `hc_spend`**
(never summed from `client_events`, whose 0–9999 cap silently zeroes large grants); boosters =
counts, pre-level + in-level; `UL *` and `Unlimited Lives` = minutes; `SPT` = tokens (count);
`SPTx2` = **minutes** of the 2× buff — a timer, not a token. Same `m_item` ids as your
`data_econ_daily` run; print them.

Extras, **only if measurable** from the envelope/ticket grant events: `1-star Pack` … `5-star Pack`
(count of envelopes granted; the 6-star tier is retired) and `ToF_Ticket` (count). If you add them,
same row shape, `spend_total` = envelopes opened / tickets consumed. If not, leave them out entirely
and say so — absent-by-design is a known state; a zero column is a false measurement.

## 6. Population guard

I cross-check `players_in_cell` against `data_seg_beh.unique_players` cell by cell. A **uniform**
offset across the ten cells is fine (your window is shorter). A **spread** across cells larger than
~3× means the segment axis is not ours — the first real pull of another feed bucketed on
`player_profile_level` and ran 0.0× at `0-9` to 32× at `100+`. Print the ten ratios in the notes.

## 7. Status and blanks

- `status = MEASURED` on every row, zeros included. Never `FAKE`.
- A measured zero is `0`. A day you cannot fill is **absent**, not `0` — a zero draws a collapse.
- A column you cannot produce is omitted, not filled with a proxy.

## 8. What you must NOT do

1. No forward fill, no back fill, no zero-filling of future days.
2. No averaging or interpolation across missing days; no `APPROX_` on totals.
3. No per-day re-segmentation and no `player_profile_level` segmentation — modal 7-day play rate only.
4. No `LIMIT`, no sampling.
5. No partial day (today) in the output.
6. Do not change `data_seg_beh` or `data_econ_daily`; separate query, separate sheet.
7. Do not substitute a proxy for a column silently (see §7).

## 9. Athena / project gotchas — apply all

- Schema `abgbproduction_174525b3_gdpr`. Filters identical to `data_seg_beh`: `t_geo NOT IN
  ('FI','PL')` on the events side, orphans excluded (`reporting.orphans`), `max_level > 200`, the
  same amount bands per currency, the same Night Sky V3 exclusion if the anchor applied it.
  **No A/B cohort filter** on this feed: all eligible players on the live calendar.
- Cast `processdate` to INT for partition pruning; open-ended upper bound = yesterday's `processdate`.
- No `COUNT(DISTINCT)` inside a window function; `ARBITRARY()` is non-deterministic;
  `event_tokens` is a MAP on the level-summary view; Night Sky is logged as *Dream Heist*.

## 10. Acceptance test — run on your own output before delivering

1. **Keys unique:** `GROUP BY segment, payer_flag, currency, day_index HAVING COUNT(*) > 1` → 0 rows.
2. **Day coverage:** `day_index` is contiguous 1..N with N = `days_available` on every row;
   `MAX(calendar_date)` ≤ yesterday; row count = `10 × 13 × N` (+ extras × N).
3. **Denominators:** `gain_per_active_player_day × active_players_day == gain_total` and
   `gain_per_earner_day × resource_earners_window == gain_total`, up to rounding; same for spend.
4. **Population:** `Σ players_in_cell` over the ten cells = distinct players in the window; the ten
   ratios vs `data_seg_beh.unique_players` printed, spread (max/min) reported.
5. **Re-pull stability:** on the second and later pulls, `gain_total` and `*_per_active_player_day`
   for a day already delivered must match the previous pull (flag any day that moved > 1% — late
   events); `*_per_earner_day` is allowed to drift (§4).
6. **Constants:** `window_start_date`, `days_available`, `status = 'MEASURED'` identical on every row.
7. **Cross-check:** on the first pull, if the live window overlaps the `data_econ_daily` window,
   the overlapping days' `gain_total` must agree.

## 11. Deliverable

The **SQL** (one query, parameterised on `{{ live_cal_start_date_input }}` with the end date derived
as yesterday, so the same file re-runs unchanged), the CSV, the row count and N, the `HEADER_NOTES`
entry for `data_econ_daily_live` in the style of `daily_gains.sql`, and a notes block: the exact
start/end dates and day-of-week of the start, the `m_item` ids, how each denominator was counted, the
§6 ratios, any column omitted and why, anything that looked wrong.
