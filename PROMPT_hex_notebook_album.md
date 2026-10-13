# Hex notebook to build: **ALBUM / card collection actuals**

> ### ⚠ PARTLY SUPERSEDED by `PROMPT_hex_album_v2.md` (2026-10-13)
> The production album SQL (`sqls/album_*.sql`) turned up eleven mismatches against this
> document. In particular: `album_metrics_daily` DOES exist, the segment we need is already a
> column (`album_segmentation_daily.level_completes_7d`) and must not be rebuilt by hand, the
> payer flag should come from `spend_group`, and `albumPct` should use
> `hex_abgbproduction_174525b3.album_snaps` rather than a hardcoded 72. **Send v2 instead of
> this file**; it lists what here is still correct. Updated 2026-10-13 after two more
> production queries landed: `album_daily_snaps.sql` is almost exactly the query we want
> (all players, zeros included, long per metric x breakdown, splits on `level_completes_7d`),
> and `star_balance_max` IS in `album_metrics_daily` after all.

Hand this whole file to the analytics LLM. It describes one Hex notebook whose job is to produce
**three output tables, named exactly as written here**, which get exported to three sheets of the
same name in our simulation workbook.

The notebook you are replacing already exists in part — `album_notebook_export` — and its
`album_actuals_player` query is **correct and proven**. Reuse it. What is new is that we need the
output shaped as three named tables instead of one, and two metrics it does not yet produce.

---

## The three tables (these names are a contract)

| Table / sheet | Grain | Rows (expected) |
|---|---|---|
| `data_col_daily` | `segment × payer_flag × day × metric` | ~1,700 (10 cells × 6 metrics × 28 days) |
| `data_col_season` | `segment × payer_flag` | exactly 10 |
| `data_col_envelopes` | `segment × payer_flag × source × pack_tier` | as many as are non-zero |

`data_col_daily` is the one we want **first and re-pulled repeatedly** while a season runs; the
other two are once-per-season. If you can only deliver one, deliver that one.

---

## Key spellings — a mismatch makes a whole table read as zero

| Column | Allowed values |
|---|---|
| `segment` | `0-9`, `10-19`, `20-39`, `40-99`, `100+` — **but see the warning below: this must be a 7-DAY SAGA-COMPLETION tier, not profile level.** The column must be called `segment` |
| `payer_flag` | `PAYER`, `NONPAYER` — same as `payer_type`, **renamed** |
| `metric` | `packs`, `cards`, `unique`, `sets`, `albumPct`, `balance` (the labels `Packs Opened`, `Cards Drawn`, `Unique Cards`, `Sets Completed`, `Album %`, `Star Balance` are also accepted) |
| `pack_tier` | `1-star Pack` … `5-star Pack` (the 6-star tier was retired — omit it) |
| `status` | `MEASURED` on every row of every table |

The `status` column is not decoration. Our reader treats a row marked `FAKE` as a placeholder; the
sheets currently hold placeholder rows and `MEASURED` is what tells the engine your data is real.

---

## Table 1 — `data_col_daily`  ⟵ the important one

**Start from the existing `album_actuals_player` query.** It already produces exactly the right
spine: `event_id, player_id, level_bucket, payer_type, day, metric, daily_value, cum_value`, with
`day = DATE_DIFF('day', event_start, event_date) + 1` capped at 28, the level buckets we use, and
the payer flag from `player_daily.cumulative_money_spent > 0`. Keep all of that.

Two changes to it:

**(a) Add the two missing metrics.** It currently emits four (`packs_opened`, `cards_drawn`,
`unique_cards`, `sets_completed`). We need six:

- **`albumPct`** — the existing notebook derives this downstream as `unique_cards / 72.0 * 100`.
  Please compute it the same way, but **take the 72 from the catalog rather than hardcoding it**
  (count the distinct cards in the album config for that season) and say in a note what number you
  used. Important: if a player finishes the album and starts a second one, this should keep
  climbing past 100 — our simulation reports album 2 at 30% as `130`. If your source cannot see
  album 2, cap at 100 and **say so in the notes**, because that difference shows up as our curve
  running above yours at the top segments.
- **`balance`** — the player's **star balance held at end of day**. This is the one metric with no
  equivalent in the existing query, and the only one that is **not monotone**: it goes DOWN when a
  player buys a star chest. We need the balance, not the stars earned. If the warehouse only has
  stars earned and stars spent, send both as separate metrics named `stars_earned` and
  `stars_spent` and we will difference them — but say which you sent.

**(b) Aggregate to the percentile distribution across players**, not just the mean. Final shape:

| Column | Meaning |
|---|---|
| `segment`, `payer_flag`, `day` | keys. `day` is 1-based day of the collection season (day 1 = first day), not a calendar date |
| `metric` | one of the six above |
| `actual_p10`, `actual_p25`, `actual_p50`, `actual_p75`, `actual_p90`, `actual_p95`, `actual_p98` | the **cumulative** value through that day at each percentile across players in that cell |
| `actual_mean` | the cumulative mean across **every** player in the cell, including players who never engaged |
| `status` | `MEASURED` |

All eight statistics, because our simulation reports exactly that set and we plot them against each
other. Send whichever you can produce — a column you omit is written blank rather than zero and the
rest still plot — but if `p95`/`p98` are unstable at your sample size, say so rather than dropping
them silently.

So: `SELECT segment, payer_flag, day, metric, APPROX_PERCENTILE(cum_value, 0.1) AS actual_p10, …,
AVG(cum_value) AS actual_mean FROM <the existing per-player result> GROUP BY 1,2,3,4`.

**Two things that matter more here than anywhere else:**

- **Cumulative, not daily.** Every value is a running total through that day. The existing query
  already computes `cum_value` with a window function — use that, not `daily_value`.
- **A missing day means "no data yet", not zero.** Omit rows you cannot fill. A zero makes our
  chart line dive to the axis, which reads as a collapse rather than as an absent measurement.
  The existing query deliberately builds a dense grid and zero-fills (`COALESCE(SUM(r.value), 0)`)
  so that a player who opened nothing counts as 0 for the *mean* — that is right for a player
  inside a day we have, and wrong for a day we do not have. Keep the zero-fill **per player within
  the observed window**, and simply do not emit days past the last one with data.

---

## Table 2 — `data_col_season`

One row per `segment` × `payer_flag` (10 rows), season-level. Most of this is the same per-player
result collapsed over the whole season instead of per day.

| Column | Meaning |
|---|---|
| `segment`, `payer_flag` | keys |
| `unique_players` | distinct players in the cell over the season — **the denominator for every mean below**, and state it in the notes |
| `season_days` | length of the collection season in days, as observed. We expect **28**; if it is not, that is itself a finding |
| `envelopes_received_mean` | envelopes granted per player |
| `envelopes_opened_mean` | envelopes actually opened per player. We want both — they differ, and the existing query only has `envelopes_opened` |
| `envelopes_received_p25`, `_p50`, `_p75`, `_p90` | per-player distribution |
| `cards_drawn_mean` | cards received per player |
| `new_cards_mean`, `duplicate_cards_mean` | the split. `unique` in the existing query is the new-card count |
| `new_card_share` | new ÷ drawn. We currently **assume 0.42**; this replaces an assumption |
| `sets_completed_mean` | sets completed per player |
| `album1_completion_rate` | share of players in the cell who **finish album 1** inside the season. Not the mean of albums completed — a rate |
| `album1_completion_day_p50` | median day they finished. Leave blank for a cell where almost nobody finishes |
| `albums_completed_mean` | albums completed per player, can exceed 1 |
| `stars_earned_mean`, `stars_spent_mean`, `star_balance_end_mean` | the star chain |
| `chests_bought_bronze_mean`, `chests_bought_silver_mean`, `chests_bought_gold_mean` | star chests purchased per player, by tier |
| `active_days_mean` | active days per player in the window, same definition as our existing `data_seg_beh` |
| `status` | `MEASURED` |

---

## Table 3 — `data_col_envelopes`

One row per `segment` × `payer_flag` × `source` × `pack_tier`. **Long format. Emit only non-zero
rows** — a missing row means a measured zero, which is how our other tables work.

| Column | Meaning |
|---|---|
| `segment`, `payer_flag`, `pack_tier` | keys |
| `source` | the feature that granted the envelope. Please also list the raw event-name strings you mapped from. Our names: `Rainbow Maker`, `Night Sky` (logged as **Dream Heist**), `Season Pass`, `Target Day`, `Tower of Fortune`, `Hatchling Hideaway`, `Jigsaw`, `Bomb's Ballet`, `Kite Festival`, `Photoshoot`, `Team Event`, `Flock Flurry`, `Star Chest - Bronze/Silver/Gold` |
| `envelopes_mean` | envelopes of that tier from that source, per player in the cell |
| `envelopes_per_instance_mean` | the same, divided by how many times that event ran in the window |
| `instances` | how many times that event ran in the window |
| `participation_rate` | share of the cell that took part in that event at all. **The single most valuable column in this request** — see the warning below |
| `status` | `MEASURED` |

> ⚠ **`participation_rate` must not be rounded.** A rate that exports as `0.0` is indistinguishable
> from "no telemetry", and our reader then prices that event at **full** participation — roughly
> 40× too high. Give it 4+ decimal places, or send the raw numerator and denominator instead.
> Kite Festival is the live example: it is an opt-in league, the measured rate is 1–3%, and we are
> currently guessing 0.35 because a rounded export could not be distinguished from a missing one.

---

## Warehouse notes (what the existing notebook proved)

- Album per-player metrics: **`tmp_radekjanhuba.album_metrics_daily`** — long format with
  `metric` / `breakdown` / `value`, de-duplicated with `MAX(CAST(value AS double))` grouped by
  `event_id, player_id, event_date, metric, breakdown` before summing. Keep that de-dup: the raw
  table has repeated rows.
- Season start day per event: `MIN(event_start_time)` over
  `abgbproduction_174525b3_gdpr.client_events_view_event_progress`, converted with
  `FROM_UNIXTIME(... / 1000)`.
- Profile level at entry: `MIN_BY(player_profile_level, o_ts)` from the same view, windowed from one
  day before the event start.
- Payer flag: `MAX_BY(cumulative_money_spent, …)` from `abgbproduction_174525b3_gdpr.player_daily`,
  preferring the last reading **before** the event start.

Apply our standard economy filters (from `Event_Eco_Investigation_Context.md`):
`geo NOT IN ('FI','PL')`, exclude orphan accounts, `max_level > 200`, and **derive coins from
`player_daily.hc_gain`** — `client_events` currency amounts carry a 0–9999 cap that silently zeroes
large grants. Athena/Trino: cast `processdate` to `INT` for partition pruning; no `COUNT(DISTINCT)`
inside a window; `ARBITRARY()` is non-deterministic; `event_tokens` is a `MAP` on the level-summary
view.

> ### ⚠ `segment` IS A 7-DAY SAGA-COMPLETION TIER, NOT PROFILE LEVEL
>
> This one invalidated a whole pull, so please read it before writing the bucketing. Our segments
> come from `sqls/data_seg_beh.sql` and are **how many saga levels a player completed in a rolling
> 7-day window** — an activity measure. The obvious reading, `player_profile_level`, is a
> progression measure, and the two produce nearly opposite populations:
>
> | cell | ours (7d saga completions) | a profile-level pull | ratio |
> |---|---|---|---|
> | `0-9 NONPAYER` | 107,126 | 221 | 0.00× |
> | `100+ PAYER` | 1,362 | 44,259 | 32.50× |
>
> Our model plots your actuals directly against its own band for the same cell name, so a
> profile-level bucketing silently compares our heaviest weekly players against everyone past level
> 100. **Please bucket on 7-day saga completions**, and keep sending `players_in_cell` so we can
> verify it — our engine now cross-checks that against `data_seg_beh` and flags any cell more than
> 2× out. If 7-day saga completions cannot be reconstructed, tell us and send what you can with the
> axis NAMED, rather than relabelled to ours.

## Three traps we have already been bitten by

1. **A rate that rounds to `0.0`** — see the participation warning above.
2. **Counts must be players, not rows.** A previous export split spend by sink, so one account
   counted N times. State the denominator for every `*_mean` column.
3. **No one-sided exclusions.** A previous export dropped 0% of one arm and 12% of the other, which
   made the two non-comparable. If any filter drops players unevenly across segments, say so.

## Deliverable

The three tables as named above, each as its own Hex output (so it can be exported to a sheet of
the same name), plus the SQL, row counts, and a notes block covering: the exact source tables and
date window; any column you could not produce and why; the player denominators; the raw event-name
strings mapped to each `source`; the album card count you used for `albumPct` and whether it can
exceed 100; and anything that looked wrong on the way.

We would rather have six solid columns and a clear note than twenty where three are proxies.
