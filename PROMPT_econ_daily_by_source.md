# Prompt — per-SOURCE daily economy feed producing `data_econ_daily_by_source`

Paste this to the analytics LLM **together with four queries it already wrote**: `data_seg_beh`,
`data_econ`, `data_econ_daily`, and the `data_gains` query (`resource_share_by_category_period_v2`
as it runs TODAY, including any branches added after the repo copy — see §4). The new result set
must be derived from the same base CTEs so it reconciles with all four to the unit.

---

You wrote my `data_seg_beh`, `data_econ`, `data_econ_daily` and `data_gains` queries (pasted below).
I need **one new companion result set, `data_econ_daily_by_source`**. It is the cross product of two
things you already deliver: `data_gains` (source × resource, whole window) and `data_econ_daily`
(day × resource). Reuse the *identical* window, cohort, segmentation, filters, currency mapping and
category mapping; **do not redefine any of them**.

## 1. Purpose (so you can judge substitutions)

My simulation places each source's window total on calendar days by a rule per source family
(leaderboards pay on the instance's last day, collections follow an accrual curve, always-on sources
follow the daily active rate, and so on). This table is how I validate those **day placements**
per source. It is read by name: the `source` strings must be the `data_gains` categories **exactly**,
or the whole source silently reads as missing.

## 2. Window and calendar — two columns on every row

| column | value |
|---|---|
| `window_start_date` | the DATE of `day_index = 1`, identical to the `data_econ_daily` window start (a Wednesday) |
| `calendar_tag` | the LiveOps calendar name this window ran under. Our workbook calls the measured one `cal_curr`; use that literal unless the window is the newly launched calendar, then `cal_live` |

**Run 1 = the `data_gains` window** (same start/end as `data_seg_beh`). That is the only window
on which the reconciliation in §10 can be checked, so do it first. The same query re-pointed at the
live calendar start (`window_start_date` = the live calendar's day 1) is the follow-up; on that run
emit only complete days (§8) and skip the reconciliation steps that need `data_gains`.

## 3. Output schema — one row per (segment, payer_flag, source, currency, day_index)

| column | meaning |
|---|---|
| `segment` | `0-9`, `10-19`, `20-39`, `40-99`, `100+` — the merged labels of `data_econ_daily`, NOT the `B. 1-9` spelling of `data_gains` (we map `0-9` → `B. 1-9` on our side). Do not emit `A. 0` |
| `payer_flag` | `NONPAYER` / `PAYER`, lifetime payer, same as `data_seg_beh` |
| `source` | a `data_gains.category` string, exactly (§4) |
| `currency` | exactly one of the 13 strings of the delivered `data_econ_daily`: `HC`, `Slingshot`, `Shuffle`, `Comet`, `Red`, `Chuck`, `Bomb`, `UL Bomb`, `UL Chuck`, `UL Red`, `Unlimited Lives`, `SPT`, `SPTx2` |
| `day_index` | 1..33 on run 1; `window_start_date + (day_index − 1)` |
| `calendar_date` | the actual date, so nobody has to recompute it |
| `gain_total` | raw total of that currency gained from that source on that day by the cell |
| `resource_earners` | **window-level** distinct players with gain > 0 of this currency **from any source** in the cell — constant across all rows of (segment, payer_flag, currency) and **identical to `data_econ_daily.resource_earners` and `data_gains.resource_earners`** |
| `gain_per_earner_day` | `gain_total ÷ resource_earners` — the window-earner denominator so the 33 days AND the sources are both additive |
| `recipients_day` | distinct players with gain > 0 of this currency from this source on this day |
| `spend_total` | §6: coins spent INSIDE this source on that day; **blank** when the source has no sink of its own, `0` when it has one and nothing was spent |
| `spend_per_earner_day` | `spend_total ÷ resource_earners`, same blank rule |
| `window_start_date`, `calendar_tag` | §2 |
| `status` | `MEASURED` on every row |

Emit **every** (segment, payer_flag, source, currency) that has any gain in the window, with all days
present and `0` where the day had none. A source × currency with zero over the whole window is
omitted — `data_gains` only emits amount > 0 rows, and a missing row is a measured zero there too.

## 4. The source axis — reuse the `data_gains` CASE verbatim

Take the `CASE ... END AS category` from the `data_gains` query **as it runs today** — the same
`source_detail = COALESCE(NULLIF(m_action_sub1,''), m_action)` and the same branches, in the same
order, ELSE `'Other'`. The repo copy of that query predates two branches the live one must contain,
because the delivered sheet carries both categories: **`Saga`** (`saga_progression`, split out of
`Core`) and **`Level Race`** (`wager_event`). If your live query has further renames (`player_level_up`
→ `Core`, `ad_chest`/`ad_life` → `Ads`), keep them. Night Sky is logged as *Dream Heist*
(`dreamheist_event` → `Daily Night Sky Prize`).

The set my engine expects, for your checklist (every name below is read by exact string):
`Ads`, `Bomb Challenge`, `Bomb's Ballet`, `Chuck Challenge`, `Core`, `Daily Gift`,
`Daily Night Sky Prize`, `Flash Race`, `Flock Flurry`, `FlowerCoop`, `Hatchling Hideaway`, `IAPs`,
`Jigsaw`, `Kite Festival`, `Level Race`, `Other`, `Photoshoot`, `Rainbow Maker`, `Red Challenge`,
`River Rush`, `Saga`, `Season Pass (Free)`, `Target Day`, `Team Event`, `Team Race`.

Four more names exist in the engine but NOT in the CASE: `Season Pass (Paid)`, `ToF`, `Col - Sets`,
`Col - Albums`. If the paid pass track, Tower of Fortune (*Mighty Doors*) rewards, or collection
set/album completion rewards are identifiable by `source_detail`, add rows under those exact names
and **list the raw strings you mapped**; otherwise leave them absent and say so. Never fold them
into `Other` silently — list, in the notes, the top 20 raw `source_detail` strings that landed in
`Other` with their HC share.

## 5. Currency mapping and units (identical to `data_gains` / `data_econ_daily`)

- `HC` = **coins, free only** (`m_amount_cur_free`, 0–9999 band) — this is the `data_gains` basis,
  because source attribution only exists on `client_events`. It is therefore NOT the
  `player_daily.hc_gain` basis of `data_econ_daily.HC`; §10 asks you to report that gap, not hide it.
- `Slingshot`, `Shuffle`, `Comet`, `Red`, `Chuck`, `Bomb` = booster **counts**, free only
  (`m_action <> 'purchase'`), per-event 0–99 band as in `data_gains`.
- `UL Bomb`, `UL Chuck`, `UL Red`, `Unlimited Lives` = **minutes**, free only; UL boosters
  **deduplicated** exactly as `ul_booster_raw` does (`ROW_NUMBER` over `o_ts, m_item, m_amount_item,
  player_id, m_item_category, m_action`), lives NOT deduplicated — copy, do not improve.
- `SPT` = season pass tokens (count); `SPTx2` = **minutes** of the 2× multiplier buff (it is a timer,
  not a token). Use the same `m_item` identifiers your `data_gains` run used — they are not recorded
  in my repo, so **print them in the notes**.
- Packs (`1-star Pack` … `5-star Pack`) and `ToF_Ticket` are absent by design here; they are covered
  by the collection data request.

## 6. Spend — only where a source can spend

`spend_total` is coins spent **inside** that source: Tower of Fortune continues/top-ups, a Kite
Festival opt-in fee, River Rush / Flash Race retries, star-chest purchases if they cost coins — any
`currency_spend` whose `m_action` / `m_action_sub1` names the same event as the gain rows. Core
sinks (`extra_moves`, `purchase_lives`, booster/powerup purchases) belong to no event source and
stay in `data_econ_daily.spend_total`; put them on **no** row here. Rule: a source with no sink of its
own gets a **blank**, a source with a sink gets `0` on quiet days. List the sinks you attributed and
the raw strings behind each.

## 7. Denominator — why the window earner count

`resource_earners` is the **window** earner count of the currency (any source), not the day's
participants and not the source's recipients. Deliberate: it makes the rows additive on both axes —
`Σ_day gain_per_earner_day` per source equals `data_gains.amount_per_earner`, and `Σ_source` per
day equals `data_econ_daily.gain_per_earner_day` (boosters/UL/SPT exactly, HC up to the basis gap).
`recipients_day` is there so a per-recipient view can be derived; do not divide by it yourself.

## 8. Status and blanks

- `status = MEASURED` on every row, zeros included. Never `FAKE`.
- A measured zero is `0`; an unmeasurable value is **empty**. The only designed blanks are the two
  spend columns (§6).
- On a live-calendar run: emit only **complete** days (last complete `processdate` = yesterday, not
  today), no rows for future days, no forward fill, no averaging across missing days.

## 9. Athena / project gotchas — apply all

- Schema `abgbproduction_174525b3_gdpr`; standard cohort filters identical to `data_seg_beh`:
  `t_geo NOT IN ('FI','PL')` on the events side, orphans excluded, `max_level > 200`, the same
  0–9999 / 0–99 amount bands, the same Night Sky V3 exclusion and A/B cohort join if that run used one.
- Segment = the player's **window-level modal** segment (`ORDER BY seg_days DESC, seg_rank DESC`),
  as `data_seg_beh`; do NOT re-segment per day and do NOT use `player_profile_level`.
- Cast `processdate` to INT for partition pruning; the 7-day rolling segmentation needs
  `rolling_start_pd` = start − 6 days, as in the anchor.
- No `COUNT(DISTINCT)` inside a window function; `ARBITRARY()` is non-deterministic;
  `event_tokens` is a MAP on the level-summary view.
- No `LIMIT`, no sampling, no `APPROX_` on the totals.

## 10. Acceptance test — run on your own output before delivering

1. **Keys unique:** `GROUP BY segment, payer_flag, source, currency, day_index HAVING COUNT(*) > 1`
   returns 0 rows.
2. **Day coverage:** every (segment, payer_flag, source, currency) present has exactly 33 rows,
   `day_index` 1..33, no gaps (live run: exactly N rows, 1..N, N = days complete).
3. **Window reconciliation vs `data_gains`:** per (segment → `B. 1-9` etc., payer_flag, currency →
   `resource`, source → `category`): `Σ_day gain_total == category_amount` and
   `resource_earners == data_gains.resource_earners`, up to rounding. Report the max relative gap.
4. **Day reconciliation vs `data_econ_daily`:** per (segment, payer_flag, currency, day_index):
   `Σ_source gain_total` vs `data_econ_daily.gain_total`. Must agree for the 12 non-HC currencies;
   for `HC` tabulate the gap (free-capped client_events vs `player_daily.hc_gain`) per cell and day.
5. **Additivity:** `Σ_day gain_per_earner_day × resource_earners == Σ_day gain_total` per key.
6. **Constants:** `window_start_date`, `calendar_tag` identical on every row;
   `calendar_date = window_start_date + day_index − 1`; `status = 'MEASURED'` everywhere.
7. **Spend blanks:** `spend_total` is NULL for every source you did not list in §6, and non-NULL
   for every row of a source you did.

## 11. Deliverable

The **SQL** (one query, separate file; do not modify the four pasted queries), the result as CSV,
the row count, the `HEADER_NOTES` entry for `data_econ_daily_by_source` in the style of
`daily_gains.sql`, and a notes block: window used, the §4 raw-string mappings (including `Other`'s
top 20 and the SPT/SPTx2 `m_item` ids), the §6 sink list, and the §10 results including the HC gap table.
