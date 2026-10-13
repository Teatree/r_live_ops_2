# Fix needed: `segment` must be a 7-day saga play-rate tier, not profile level

> ### ⚠ PARTLY SUPERSEDED by `PROMPT_hex_album_v2.md` (2026-10-13)
> The production album SQL (`sqls/album_*.sql`) turned up eleven mismatches against this
> document. In particular: `album_metrics_daily` DOES exist, the segment we need is already a
> column (`album_segmentation_daily.level_completes_7d`) and must not be rebuilt by hand, the
> payer flag should come from `spend_group`, and `albumPct` should use
> `hex_abgbproduction_174525b3.album_snaps` rather than a hardcoded 72. **Send v2 instead of
> this file**; it lists what here is still correct.

The data you built is internally correct — the problem is that its `segment` column and ours are
different measures that happen to use the same five labels, so they join cleanly and compare the
wrong people. This is the one thing that has to be fixed before any of it is usable; everything else
can stay as it is.

## What you built vs what we need

You bucketed on **`player_profile_level`** — how far a player has progressed, taken from
`MIN_BY(player_profile_level, o_ts)`. That is a *progression* measure.

Our `segment` is **the average number of saga levels a player completes per day, averaged over a
rolling 7-day window**. That is a *play-rate* measure. So our `100+` means "completes 100+ saga
levels a day, every day, for a week" — a very small group of extremely heavy players — while your
`100+` means "is past profile level 100", which is most of the player base.

The populations show it:

| cell | ours | yours | ratio |
|---|---|---|---|
| `0-9 NONPAYER` | 107,126 | 221 | 0.00× |
| `10-19 PAYER` | 25,992 | 768 | 0.03× |
| `20-39 PAYER` | 19,794 | 4,364 | 0.22× |
| `40-99 PAYER` | 10,805 | 14,362 | 1.33× |
| `100+ PAYER` | 1,362 | 44,259 | **32.50×** |

A different date window or filter set would shift every cell by roughly the same factor. A smooth
slide from 0× to 32× in one direction is the signature of a different axis.

---

## The definition to replicate

This is from `sqls/data_seg_beh.sql`, which is the source of the segmentation for everything on our
side. Please match it exactly.

**Step 1 — saga level completions per player per day.** One row per completed saga level:

```sql
daily_completions AS (
    SELECT
        ls.player_id,
        CAST(date_parse(CAST(ls.processdate AS VARCHAR), '%Y%m%d') AS DATE) AS event_date,
        COUNT(*) AS daily_completions
    FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
    WHERE CAST(ls.processdate AS INT) BETWEEN <6 days before season start> AND <season end>
      AND ls.game_mode   = 'saga'
      AND ls.exit_screen = 'completed'
    GROUP BY 1, 2
)
```

Note the window **starts 6 days before the season** so that day 1 already has a full 7-day average
behind it.

**Step 2 — the rolling 7-day average of that daily count:**

```sql
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

> ⚠ **Do not zero-fill the missing days.** `daily_completions` only has rows for days the player
> actually completed something, and the average is taken over *those* rows inside the 7-day span —
> not over all seven days. A player who completed 40 levels on Monday and nothing until Sunday
> averages 40 at that point, not 40/7. This is easy to "improve" by accident and it changes every
> bucket.

**Step 3 — the buckets:**

| `avg_completions_7d` | segment |
|---|---|
| `NULL` or `0` | **excluded entirely** — see below |
| `< 10` | `0-9` |
| `< 20` | `10-19` |
| `< 40` | `20-39` |
| `< 100` | `40-99` |
| `>= 100` | `100+` |

**Step 4 — one segment per player, not per day.** The tier moves day to day; our population counts
assign each player to their **modal** segment — the one holding the most of their active days in the
window, ties going to the *higher* tier. Please do the same, so a player sits in exactly one cell for
the whole season. (This matters for `data_col_season`'s `unique_players`, and it keeps
`data_col_daily`'s cohort fixed, which we asked for separately.)

**Step 5 — exclusions, which are part of the definition and not just hygiene:**

- **`avg_completions_7d > 0`** — players who completed no saga levels in the window are **not in our
  population at all**. This is a big one: your pull counted everyone active in `player_daily`, which
  is why your total is 165k against our 350k even before the axis difference.
- orphans (`reporting.orphans` for this app id), `geo NOT IN ('FI','PL')`, `max_level > 200` — the
  standard set you are already applying.
- Our build also excluded an A/B variant group; **ignore that**, it is specific to an old test.

**Step 6 — the payer flag is LIFETIME, within the window.** Ours is: `cumulative_money_spent > 0`
at **any** point during the window. You used the last reading *before day 1*, which is close but
not the same — a player who first pays on day 3 is `PAYER` for us and `NONPAYER` for you. Please
switch to the lifetime-within-window version.

---

## What to keep exactly as it is

Everything else you built was right, so please do not change it:

- the per-metric derivations (`packs`, `cards`, `unique`, `sets`, `albumPct`, `balance`) — all good;
- `players_in_cell` and `players_nonzero` — keep sending these, they are how we verify the fix
  landed;
- `status = MEASURED`, blank-for-unmeasurable, zero-for-measured-zero;
- the day-1 anchoring and fixed cohort we agreed separately.

## How to check the fix worked, before sending it

Compare your `players_in_cell` against these. After the fix they should be within a factor of ~2
cell by cell, and the *shape* should match — most players in `0-9`, very few in `100+`:

| cell | expected order of magnitude |
|---|---|
| `0-9 NONPAYER` | ~107,000 |
| `0-9 PAYER` | ~64,000 |
| `10-19 NONPAYER` | ~54,000 |
| `10-19 PAYER` | ~26,000 |
| `20-39 NONPAYER` | ~42,000 |
| `20-39 PAYER` | ~20,000 |
| `40-99 NONPAYER` | ~22,000 |
| `40-99 PAYER` | ~11,000 |
| `100+ NONPAYER` | ~2,500 |
| `100+ PAYER` | ~1,400 |

Those come from a June–July window, so they will not match to the digit — but if `100+` is still
the biggest cell, the axis is still wrong. **The quick test: `0-9` should be the largest group and
`100+` the smallest by a wide margin.** Your current output has it the other way round.
