# Next steps — proceed without the grant

Thanks for not guessing a mapping, and for reporting exactly what you searched. Three decisions, so
you are not blocked waiting on access.

## 1. Go ahead on your hand-built segmentation. Do not wait for the table.

Your own 7-day play-rate calculation is **accepted as the interim source**. It is the right measure —
your rerun confirmed it independently ("most players are profile-level 100+ but spread across all
play-rate tiers"), which is exactly the pattern we were seeing from our side.

Radek's column is still where we want to end up, for two reasons that have not changed: it is what
all seven production dashboards use, so matching it means matching them; and `album_metrics_daily`
carries envelope rarity, card rarity and `pity_probability` as ready-made breakdowns that are
painful to rebuild from raw events. But neither is worth stalling a week for.

**So: ship the hand-built version now, and make the later swap a one-line change** — put each table
reference behind a single variable or one CTE at the top rather than inline in nine places. When the
grant lands, one edit switches the source.

## 2. Keep the modal tier — I had this wrong

My earlier prompt told you to switch from the modal tier to first-day-seen "to match production".
**Ignore that; your modal choice is correct.** Our own population table (`data_seg_beh`) assigns each
player their modal segment, and our engine cross-checks your `players_in_cell` against its
`unique_players` on every run. First-day-seen would leave a permanent gap in the one check we use to
confirm your data lines up with ours.

If it is cheap, send **both**: `segment` (modal — the join key) and `segment_first_day` as an extra
column. Then we can measure how far apart the two rules actually are, and we keep a column that
matches the production dashboards.

## 3. Apply it to the three data tables too, not only the comparison notebook

The fix so far has landed in the comparison notebook's cell 03. The three tables that feed our
simulation workbook — `data_col_daily`, `data_col_season`, `data_col_envelopes` — still need the same
treatment, and they are the ones we are actually blocked on. Same segmentation, same payer rule, same
filters.

Please also add one column to each: **`segment_source`**, reading `hand_7d_playrate` for now and
`album_segmentation_daily` once the grant lands. Our reader ignores columns it does not know, and in
three months it will be the only way to tell which run produced a chart.

---

## How we will know it worked

Our engine already compares your `players_in_cell` against our `data_seg_beh.unique_players`, cell by
cell, on every run. On the profile-level pull **8 of the 10 cells were flagged**, ranging from 0.00×
to 32.5×. With the play-rate segmentation it should drop to **0 of 10**, or close to it.

That is the acceptance test, and it works whether the segment came from your calculation or Radek's
column — so keep sending `players_in_cell` whatever happens.

Rough sizes to expect, from a June–July window (so not exact — the **shape** is the point):

| cell | ≈ players |
|---|---|
| `0-9 NONPAYER` | 107,000 |
| `0-9 PAYER` | 64,000 |
| `10-19 NONPAYER` | 54,000 |
| `20-39 NONPAYER` | 42,000 |
| `40-99 NONPAYER` | 22,000 |
| `40-99 PAYER` | 11,000 |
| `100+ NONPAYER` | 2,500 |
| `100+ PAYER` | 1,400 |

`0-9` should be the largest cell and `100+` the smallest, by a wide margin.

## Two checks you could not run, deferred not dropped

When the grant lands, these are still wanted and still unanswered:

1. `SELECT level_completes_7d, COUNT(DISTINCT player_id) FROM tmp_radekjanhuba.album_segmentation_daily GROUP BY 1`
   — so we can confirm the bucket boundaries match ours before switching the source.
2. `SELECT DISTINCT` + counts on `spend_group` and `spent_in_event`, so we know which one collapses
   onto our binary payer flag.
3. Whether that table already applies the FI/PL and orphans filters, so the hand-rolled ones can come
   out rather than being applied twice.

## What stays as it was

Everything else from the last two prompts is unchanged and still wanted: the three table names and
their columns; `status = MEASURED` on every row; **blank for unmeasurable, 0 for measured-zero**;
`participation_rate` empty; chest columns empty; `players_in_cell` and `players_nonzero` kept; day 1
= the official calendar start with pre-start activity folded in; cumulative not daily; omit days you
cannot fill rather than sending zeros; and `albumPct` off `album_snaps` with +100 per completed
album, which you have already done.
