# Fix the "ABDB - Album performance vs predictions" notebook

> ### ✅ UPDATED 2026-10-13 for the production album SQL — send this one for the notebook fix
> This file is for fixing **the existing comparison notebook**. `PROMPT_hex_album_v2.md` is a
> different job (building the three `data_col_*` tables for the simulation workbook) — send both,
> they do not overlap. Change A below was rewritten: the 7-day segment **already exists as a
> column** and must not be rebuilt by hand.

Four cells to change. The notebook is currently broken for **two** independent reasons, and only one
of them is the level-bucket problem:

1. **Cell 03's source table is gone.** `tmp_radekjanhuba.album_metrics_daily` is no longer visible
   from the Athena connection. The rebuild from raw `DreamAlbum` rows in
   `client_events_view_event_progress` is the replacement.
2. **Cell 04 joins two different measures that share five labels.** This is the one that makes the
   charts wrong while everything still runs.

Below is cell by cell. Nothing about the chart cells (06–41) needs to change except one column
rename.

---

## The problem in one table

Your `level_bucket` is **profile level** — how far through the game a player is. The simulation's
tiers are **how many saga levels a player finishes per day, averaged over the previous 7 days**. The
two join cleanly on `'0-9'`, `'100+'` etc. and compare different people:

| label | simulation (play rate) | notebook (profile level) | ratio |
|---|---|---|---|
| `0-9 NONPAYER` | 107,126 | 221 | 0.00× |
| `40-99 PAYER` | 10,805 | 14,362 | 1.33× |
| `100+ PAYER` | 1,362 | 44,259 | **32.50×** |

In the simulation `0-9` is the biggest group and `100+` the smallest. In the notebook it is the
other way round. A different date range or filter would move every group by about the same factor;
a slide from 0× to 32× in one direction means the two measures are different things.

---

## Cell 03 — `album_actuals_player`

**Keep:** the day index (`DATE_DIFF('day', ev.start_date, event_date) + 1`, capped at 28), the
per-metric derivations, the cumulative window function, and the de-duplication. All correct.

**Change A — replace the `lvl` CTE and the `level_bucket` CASE with a join to the segmentation
table.** This is much smaller than it first looked: the tier we need is **already a column**.

```sql
seg AS (
    SELECT event_date, event_id, player_id,
           CAST(level_completes_7d AS varchar) AS level_completes_7d,
           CAST(spend_group        AS varchar) AS spend_group
    FROM tmp_radekjanhuba.album_segmentation_daily
    WHERE event_date <= DATE '<end date>'
)
```

`album_segmentation_daily.level_completes_7d` is what **every** production album query filters and
splits on (`album_snaps_collected.sql`, `album_total_snaps_found_percentiles.sql`,
`album_set_completion.sql`, `album_card_rarity_per_envelope.sql`, `album_daily_dau_share.sql`,
`album_daily_envelope_gained.sql`, `album_daily_snaps.sql` — all seven). Using it means the charts
are on the same axis as the dashboards, and there is no second definition of the same thing to keep
in step.

> ⚠ **Check the bucket values before mapping.** The column *name* matches the simulation's axis, but
> the boundaries might not. The simulation cuts the 7-day **average completions per day** at
> `<10 / <20 / <40 / <100 / >=100` and labels them `0-9 / 10-19 / 20-39 / 40-99 / 100+`. Please run
> `SELECT level_completes_7d, COUNT(DISTINCT player_id) FROM tmp_radekjanhuba.album_segmentation_daily GROUP BY 1`
> first. If the values are already those five labels, map straight across; if they are raw numbers or
> different bands, say so rather than relabelling on a guess.

**Change B — name it `segment`, and keep your profile level as its own column.** Emit **both**:

```sql
    <the play-rate tier>  AS segment,              -- joins to the simulation
    <your existing CASE>  AS profile_level_bucket  -- keep it, it is genuinely useful
```

Your profile-level measure is not wrong and is worth charting on its own. The only rule is that
`profile_level_bucket` must never be the join key.

**Change C — one tier per player, fixed to their FIRST DAY SEEN.** The tier moves day to day, so
it has to be pinned. Every production album query pins it the same way — *"a player's segment
(filters + splits) is fixed to their FIRST day seen (stable cohorts)"* — so do that. It is simpler
than a modal tier and it is stable from day 1, which matters for a cumulative chart.

**Change D — the payer flag: use the segmentation table's own spend column.** Do not recompute it
from `player_daily`. `album_segmentation_daily` carries **`spend_group`**, **`spend_60d_percentile`**
and **`spent_in_event`**, and the dashboards use those.

Please run `SELECT DISTINCT` + player counts on `spend_group` and `spent_in_event` and tell us the
values. The simulation's flag is binary — `PAYER` = paid anything at any point in the window — so we
need to know which column collapses onto that and how. Likely `spend_group`; not worth guessing.

**Change E — the population comes from `album_segmentation_daily`, which already applies most of
this.** Joining to that table for the segment also gives you its population definition for free, so
the hand-rolled filters mostly go away. Keep `geo NOT IN ('FI','PL')` and the `reporting.orphans`
exclusion if the segmentation table does not already apply them — please check and say which it
does. (The simulation additionally drops players with zero 7-day completions, which is part of why
its population is ~350k against your ~165k.)

**Change F — pre-start activity.** The current season logged album activity on the day *before* the
official calendar start, which `DATE_DIFF + 1` puts on day 0 and then drops. Every series is a
running total, so fold it into day 1 rather than dropping it: day 1 = everything up to and including
the end of calendar day 1. Also report how many players and opens landed pre-start — that cohort
looked like early access and is worth knowing about.

---

## Cell 02 — `parse_percentile_bands.py`

One rename, to make the join obvious. The cell currently produces **two** differently-meaning
columns:

- `level_bucket` — the tier parsed out of the band label (`0-9`, `100+`, …)
- `segment` — the tier *and* payer joined into one string (`0-9 NONPAYER`)

Rename them so the vocabulary matches cell 03:

```python
# was: columns=[..., "level_bucket", "payer_type", ...]
columns=["day", "segment", "payer_type", "metric", "stat", "value"]
...
album_bands = album_bands[["day", "segment", "payer_type", "metric", "mean", "p10", "p90"]]
album_bands["segment"] = pd.Categorical(album_bands["segment"],
                                        ["0-9", "10-19", "20-39", "40-99", "100+"], ordered=True)
album_bands["cell_label"] = album_bands["segment"].astype(str) + " " + album_bands["payer_type"]
```

So: `segment` = the tier, `cell_label` = the combined display label (what was called `segment`).

**Two notes on the band file you upload.** The simulation's `Col_Cards_Cloud` has grown:

- It is now **97 columns per block** instead of 49 — eight statistics for the simulation and eight
  more for actuals, appended on the right. Your parser handles this **by luck**: the actuals columns
  are headed `ACT p10` … `ACT MEAN`, and `"ACT P10"` is not in `_STAT_MAP`, so they are skipped. If
  you ever extend `_STAT_MAP`, exclude anything starting with `ACT` or you will read the simulation's
  own copy of the actuals back in as if it were a prediction.
- `_STAT_MAP` takes only `MEAN`, `P10`, `P90`. The sheet now carries **p25, p50, p75, p95 and p98**
  as well. Adding them is a two-line change and would let the charts show a proper spread.

---

## Cell 04 — `album_bands_vs_actual`

The actual fix is the join key. Currently:

```sql
ON CAST(b.level_bucket AS VARCHAR) = a.level_bucket
```

becomes:

```sql
ON CAST(b.segment AS VARCHAR) = a.segment
```

Two other things in this cell worth a look while you are there:

- **`album_pct` is hardcoded to 72 cards** (`cum_value / 72.0 * 100`). Production has a table for
  this — **`hex_abgbproduction_174525b3.album_snaps`** (cards per album) — and its own
  `cards_found_pct` measure is *unique cards ÷ cards in that album × 100*. Use the table, so a
  config change cannot silently rescale the metric.
- **`album_pct` cannot exceed 100 here, but it does in the simulation.** A player who finishes album
  1 and starts album 2 reads 130 there (album 2 at 30%). If the data can see a second album, add
  +100 for it; if not, that is fine, but expect the simulation's curve to sit above yours at the top
  groups for that reason alone rather than from a disagreement.

---

## New cell — a shape check, so this cannot come back silently

Add one cell after 04. It is three lines and it is the thing that would have caught this:

```sql
-- population shape check: 0-9 must be the LARGEST group, 100+ the SMALLEST
SELECT segment, payer_type, MAX(actual_players) AS players
FROM album_bands_vs_actual
GROUP BY 1, 2
ORDER BY players DESC
```

If `100+` is at the top of that list, the segmentation is still on profile level. If `0-9` is at the
top and `100+` at the bottom by a wide margin, it is right.

Rough sizes to expect (from a June–July window, so not exact — the *shape* is the point):

| group | ≈ players |
|---|---|
| `0-9 NONPAYER` | 107,000 |
| `0-9 PAYER` | 64,000 |
| `10-19 NONPAYER` | 54,000 |
| `20-39 NONPAYER` | 42,000 |
| `40-99 NONPAYER` | 22,000 |
| `40-99 PAYER` | 11,000 |
| `100+ NONPAYER` | 2,500 |
| `100+ PAYER` | 1,400 |

---

## Cells 05 and 06–41

- **05 (`day9_check`)** — no change; it reads `album_bands_vs_actual` and will pick up the fix.
- **06–41 (the 36 charts)** — no change beyond the column rename: anything faceting on
  `level_bucket` becomes `segment`. If you want to keep a progression view, facet a copy on
  `profile_level_bucket` — just never join on it.

Once this lands, the `100+` panel should stop showing the simulation miles above reality. That gap
was never a modelling error; it was ~1,400 very heavy players being compared against ~44,000
ordinary high-level ones.
