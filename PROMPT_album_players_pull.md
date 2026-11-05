# Prompt — the album sheets on the players who HAVE the album, plus their behaviour rows (`data_col_beh`)

Paste this to the analytics LLM **together with the three queries behind `data_col_season`,
`data_col_envelopes` and `data_col_daily`, and `sqls/data_seg_beh.sql`** (same arm, window,
segmentation and cohort). It re-pulls the three album sheets on a narrower population and adds one
new sheet. No other sheet changes.

---

Since the old population filters were dropped, your three album sheets count every player of the
cell who was present on season day 1, and about half of them never opened an envelope:

| cell | players in the album sheets | with ≥ 1 envelope by day 22 | share | active days of 22: the whole cell (`data_seg_beh`) | the album sheets' players |
|---|---|---|---|---|---|
| 0-9 NONPAYER | 31,228 | 14,447 | 46% | 7.3 | 14.8 |
| 20-39 NONPAYER | 9,461 | 4,395 | 46% | 8.9 | 16.6 |
| 100-249 NONPAYER | 362 | 180 | 50% | 6.6 | 19.1 |

My album simulation plays one kind of player: someone who has the album. So every input it reads
has to describe those players, and today two of them do not: the album sheets average in the players
without the album, and the only activity data I have (`data_seg_beh`) is every player of the cell,
who play half as many days and are far more spread out. I do not want to tune the simulation to
land on your completion rate; I want its inputs measured on the right players.

## 1. The population: album players

- Start from the cohort the album queries use today: Variant A, players present on season day 1
  (2026-10-13), with the segment and `payer_flag` those queries already give each player.
- Keep a player only if they **have the album: at least one envelope opened between day 1 and
  `data_through_date`**. This is exactly what your `players_nonzero` counts today.
- If the game has a cleaner flag for "has the album" (unlocked, intro envelope received), tell me
  what it is and how its count differs per cell from `players_nonzero`. Do not switch to it silently.
- Segments: the seven the current pull has (`0-9`, `10-19`, `20-39`, `40-99`, `100-249`, `250+`,
  `ALL`). `data_through_date`: the same as every other sheet of the pull.

## 2. Re-pull the three album sheets on that population — same schemas, same column names

- **`data_col_season`**: every mean, percentile and rate over album players. `unique_players` =
  album players. Add `players_in_cell` = the cohort before the filter. `players_nonzero` then equals
  `unique_players`; keep the column.
- **`data_col_envelopes`**: `envelopes_mean` per album player; `cell_players` = album players;
  `participation_rate` over album players. `envelopes_total`, `grant_rows` and `players_granted` do
  not change.
- **`data_col_daily`**: every `actual_*` statistic over album players; `players_in_cell` = album
  players. Keep the `*_qualified` columns as they are.

## 3. New sheet `data_col_beh` — the `data_seg_beh` query run on the album players

One row per (segment, payer_flag), Variant A, the same window as `data_seg_beh`
(2026-10-13 .. `data_through_date`), **the same output columns as `sqls/data_seg_beh.sql`** with the
same definitions — the only difference is the player list, which is §1's. Each player keeps the
segment and payer flag the album sheets give them, so that `unique_players` matches
`data_col_season` cell for cell.

The columns my model reads from it (the rest can come along unchanged):

| column | meaning |
|---|---|
| `segment`, `payer_flag`, `ab_variant` | as `data_seg_beh` |
| `unique_players` | album players in the cell |
| `days_available` | days of the window the row counts over |
| `weekday_active_rate`, `weekend_active_rate` | probability a player of the cell is active on a weekday / weekend date, exactly as `data_seg_beh` defines them |
| `active_days_mean` | mean active days per player over the window |
| `active_days_p25`, `_p50`, `_p75`, `_p90`, `_p95`, `_p98` | the distribution of active days per player — **this is the part I cannot get any other way** |
| `status` | `MEASURED` |

## 4. Reconciliation (run it, report the numbers)

1. `data_col_beh.unique_players` = `data_col_season.unique_players`, per cell.
2. `data_col_beh.active_days_mean` against `data_col_season.active_days_mean`, per cell: same
   players, so they should agree; say why if they do not.
3. Totals must not move, only the denominator: `envelopes_mean × cell_players` per (cell, source,
   tier), and `album1_completers` per cell, are identical before and after.
4. Per cell: `players_in_cell`, album players, and the share — next to the table above.

## 5. Do not

- Do not touch `data_seg_beh`, `data_gains` or any other sheet: they stay on every player.
- Do not back-fill players who arrive after day 1, and do not send placeholder rows.
- Do not round the rates: a rate that exports as `0.0` reads as "no data" on my side.
