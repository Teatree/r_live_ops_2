# Fix the "ABDB - Album performance vs predictions" notebook

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

**Change A — replace the `lvl` CTE and the `level_bucket` CASE** with the play-rate tier. Two new
CTEs:

```sql
-- saga level completions per player per day. Start the window 6 days BEFORE the season
-- so day 1 already has a full 7-day average behind it.
daily_completions AS (
    SELECT
        ls.player_id,
        CAST(date_parse(CAST(ls.processdate AS VARCHAR), '%Y%m%d') AS DATE) AS event_date,
        COUNT(*) AS daily_completions
    FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
    CROSS JOIN ev
    WHERE CAST(ls.processdate AS INT)
          BETWEEN CAST(date_format(ev.start_date - INTERVAL '6' DAY, '%Y%m%d') AS INT)
              AND CAST(date_format(ev.start_date + INTERVAL '28' DAY, '%Y%m%d') AS INT)
      AND ls.game_mode   = 'saga'
      AND ls.exit_screen = 'completed'
    GROUP BY 1, 2
),
rolling_7d AS (
    SELECT player_id, event_date,
        AVG(daily_completions) OVER (
            PARTITION BY player_id
            ORDER BY CAST(event_date AS TIMESTAMP)
            RANGE BETWEEN INTERVAL '6' DAY PRECEDING AND CURRENT ROW
        ) AS avg_completions_7d
    FROM daily_completions
)
```

then bucket it:

| `avg_completions_7d` | tier |
|---|---|
| `NULL` or `0` | **drop the player entirely** |
| `< 10` | `0-9` |
| `< 20` | `10-19` |
| `< 40` | `20-39` |
| `< 100` | `40-99` |
| `>= 100` | `100+` |

> ⚠ **Do not zero-fill the gap days.** `daily_completions` only has rows for days with at least one
> completion, and the average is over *those* rows inside the 7-day span — not over all seven days.
> A player who finished 40 levels on Monday and nothing until Sunday averages 40, not 40÷7. This is
> the one detail that is easy to "tidy up" and it shifts every bucket if you do.

**Change B — name it `segment`, and keep your profile level as its own column.** Emit **both**:

```sql
    <the play-rate tier>  AS segment,              -- joins to the simulation
    <your existing CASE>  AS profile_level_bucket  -- keep it, it is genuinely useful
```

Your profile-level measure is not wrong and is worth charting on its own. The only rule is that
`profile_level_bucket` must never be the join key.

**Change C — the tier moves day to day, so pick one per player.** Assign each player their **modal**
tier: the one holding the most of their active days in the window, ties going to the *higher* tier.
That keeps a player in exactly one group for the whole season, which is how the simulation's own
population is counted.

**Change D — the payer flag.** Yours is the last reading before day 1:

```sql
MAX_BY(p.cumulative_money_spent, CASE WHEN p.event_date < ev.start_date THEN ... END)
```

The simulation uses **lifetime payer within the window** — paid anything at any point during the
season. So a player who first pays on day 3 is `PAYER` there and `NONPAYER` here. Replace with:

```sql
MAX(p.cumulative_money_spent) > 0   -- over event_date BETWEEN ev.start_date AND ev.start_date + 28
```

**Change E — add the standard filters** if they are not already there: `geo NOT IN ('FI','PL')`,
exclude `reporting.orphans` for this app id, `max_level > 200`. Combined with the
`avg_completions_7d > 0` drop above, this is most of why the simulation's population is ~350k and
yours is ~165k — players who completed no saga levels are not in its population at all.

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

- **`album_pct` is hardcoded to 72 cards** (`cum_value / 72.0 * 100`). Take the card count from the
  event's own `album_snaps_needed` field instead, so a config change does not silently rescale the
  metric.
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
