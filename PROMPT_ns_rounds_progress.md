# Prompt — Night Sky (Dream Heist) round completions and streak progress, from the event's own logs

Paste this to the analytics LLM **together with `sqls/data_seg_beh.sql`, `PROMPT_ab_data_refresh.md`
(§0 shared rules, §2 the `data_seg_beh` definition) and the `data_ns_rounds` query it wrote**. Same
cohort, segmentation, filters and A/B arm as every other sheet of the pull. Night Sky is logged as
**Dream Heist**.

---

## 0. Why

Night Sky is a daily event: within one day the player clears rounds by winning levels in a row, and
each round has a cumulative streak requirement (`Cum Streak Req`, per segment). We are about to give
the engaged segments **up to 10 rounds** (0-9 and 10-19 keep their 3), so the model has to say how
many players reach a cumulative requirement **above** anything the current ladder asks for.

Today my model predicts a round's completion rate from `data_streaks` (each player-day's longest
saga win streak, p25..p90, x 1.25). Your `data_ns_rounds` says that model is wrong in shape, not
just level. Claims per player-day, model vs your sheet (Variant A pull, NONPAYER):

| cell | round (cum req) | model | `data_ns_rounds` |
|---|---|---|---|
| 0-9 | 1 (2) | 0.60 | 0.03 |
| 10-19 | 1 (6) | 0.64 | 0.32 |
| 20-39 | 3 (42) | 0.05 | 0.11 |
| 40-99 | 3 (100) | 0.00 | 0.13 |
| 100-249 | 2 (175) | 0.00 | 0.27 |
| 100-249 | 3 (280) | 0.00 | 0.18 |

Summed over rounds: the model goes 1.15 -> 0.18 claims a day from 0-9 to 100-249; your sheet is
~0.7 everywhere from 10-19 up. A cumulative 280 is not reachable in one unbroken daily streak when
the cell's p90 daily max streak is 86, so the event's streak is not the saga's daily max streak.

But I cannot take `data_ns_rounds` as the truth either, because it does not match the config:

1. **Coins per claim do not match the ladder.** The `NS` ladder pays, per round: 0-9 0 / 10 / 15,
   10-19 10 / 25 / 50, 20-39 15 / 40 / 80, 40-99 50 / 100 / 225, 100+ 100 / 300 / 400. Your
   `hc_per_claim`: 0-9 10.5 / 10.8 / 15.8, 20-39 15.0 / 30.0 / 49.4, 40-99 37.0 / 55.2 / 88.7,
   100-249 76.0 / 100.7 / 91.6.
2. **Round 1 at 0-9 pays 0 coins**, yet it shows 10.5 coins per claim and fewer claims than round 2
   (17k vs 107k). Earlier you attributed claims to rounds by their coin amount; a 0-coin round is
   invisible that way.
3. **No `ab_variant` column**, so I cannot tell whether Control (which may run another ladder) is
   pooled in.
4. **`player_days`** is 10-40% above `data_streaks`' for the same cell; the denominator is undefined.
5. **`cum_streak_req` is empty** everywhere.

## 1. Shared rules

As every sheet of this pull (`PROMPT_ab_data_refresh.md` §0):

- **Arm:** `ab_variant` column on every row. Deliver **Variant A**; add Control rows only if you
  can label them.
- **Window:** 2026-10-13 .. `data_through_date` (the same date as the rest of the pull, never after
  2026-11-15).
- **Segments:** the modal 7-day saga play-rate tier as in `data_seg_beh`: `0-9`, `10-19`, `20-39`,
  `40-99`, `100-249`, `250+`, plus `ALL`. Lifetime `payer_flag`. The standard filters (geo NOT IN
  ('FI','PL'), orphans excluded, max_level > 200). No `A. 0`.
- **NS-active player-day** (the denominator everywhere below): a (player, date) on which Night Sky
  was live for the player and the player started at least one level. State how you know Night Sky
  was live for them (event-entry log, first progress event, or server targeting).
- **Rounds:** use the **round index the game logs** (e.g. `m_round_current` or the claim event's own
  round field), never the coin amount. If the index is ambiguous (0- or 1-based, the value before or
  after the claim), resolve it with one example player-day traced end to end and show it.

## 2. Answer first, in prose (no SQL needed if the design doc or the event config says it)

1. **What resets the Night Sky streak?** For each case, does it reset it to 0, leave it as it is, or
   something else: a lost level; a lost level saved with a +5-moves continue; quitting a level; a new
   session the same day; the day boundary (which timezone?).
2. **Does a cleared round's streak count toward the next one?** Is `Cum Streak Req` a cumulative
   count from the day's start, or does each round restart its count at 0 (`Streak Req` per round)?
3. **After the final round**, does the event keep counting wins (a field we can read), or stop?
4. **Which config does a player get?** Is the player's Night Sky segment assigned by the same 7-day
   saga play-rate tier, at what moment (daily, weekly, at install), and can it differ from the
   segment in §1?
5. **Was the ladder the same for the whole window**, in both arms? If not, which dates ran which
   ladder (paste the per-segment `Cum Streak Req` and coins per round of each version).

## 3. Sheets to deliver

### 3.1 `data_ns_rounds` (replaces the current one; same name, superset of its columns)

One row per (`ab_variant`, segment, payer_flag, `config_segment`, round):

| column | meaning |
|---|---|
| `ab_variant`, `segment`, `payer_flag` | as §1 |
| `config_segment` | the Night Sky ladder the player was served on that day (§2.4); `ALL` row = all configs pooled |
| `round` | the logged round index, 1-based |
| `cum_streak_req`, `hc_reward` | the requirement and the coins of that round in the ladder that ran (a ladder change inside the window: split by `ladder_version`) |
| `ladder_version` | as §2.5, a label |
| `player_days` | NS-active player-days of the (segment, payer_flag, config_segment) |
| `players` | distinct players behind them |
| `claims_total` | claims of that round, **0-coin rounds included** |
| `claim_rate_per_player_day` | `claims_total / player_days` |
| `hc_granted_total`, `hc_per_claim` | as before (`hc_per_claim` must now equal `hc_reward` up to ladder versions; report any cell where it does not) |
| `claims_weekday`, `claims_weekend`, `player_days_weekday`, `player_days_weekend` | Fri/Sat/Sun = weekend |

### 3.2 `data_ns_dayend` — how far a player-day gets

One row per (`ab_variant`, segment, payer_flag, `config_segment`, `rounds_completed`), with
`rounds_completed` = 0 .. the ladder's last round:

| column | meaning |
|---|---|
| keys | as 3.1, plus `rounds_completed` |
| `player_days`, `player_days_weekday`, `player_days_weekend` | NS-active player-days that ended the day with exactly that many rounds cleared |
| `share` | `player_days` / the cell's NS-active player-days (the shares of one cell sum to 1) |

### 3.3 `data_ns_progress` — the uncensored streak curve (the most important sheet)

Per NS-active player-day, the **highest Night Sky streak progress the event registered that day**,
counted exactly the way the event counts toward `Cum Streak Req` (§2.1-§2.2), **including the wins
after the final round** (§2.3). If the event stops counting after the final round, rebuild the count
from the level-result logs with the event's own reset rule and say so. Players who never started a
level are not NS-active and are not in it; players who started levels but never won are rows with 0.

One row per (`ab_variant`, segment, payer_flag, `config_segment`, `day_type`), `day_type` =
`weekday` / `weekend` / `all`:

| column | meaning |
|---|---|
| keys | as above |
| `player_days`, `players` | |
| `progress_mean` | |
| `progress_p10`, `progress_p25`, `progress_p50`, `progress_p75`, `progress_p90`, `progress_p95`, `progress_p99`, `progress_p99.5`, `progress_p99.9` | percentiles over player-days |
| `share_zero` | share of player-days with progress 0 |
| `share_ge_<X>` for X = 2, 5, 10, 20, 40, 60, 100, 150, 200, 300, 400, 500, 600, 800, 1000 | share of player-days whose progress reached at least X |

The redesign has rounds up to a cumulative 765 at 100+, so the top of the curve matters most: deliver
the high percentiles and the `share_ge` columns past 500 even where only a handful of player-days
reach them (give the count behind each in your notes). More `share_ge_<X>` or `progress_p<Q>` columns
than listed are welcome: the model reads every column of these two shapes by its header.
| `share_cleared_final` | share of player-days that cleared the last round of their ladder |

If you cannot rebuild progress past the final round, deliver the sheet anyway with the censoring
stated (`censored_at` column = the final round's `cum_streak_req`), and say which percentiles are
censored.

### 3.4 `data_ns_streak_session` — only if §2.1 says a reset is not a plain lost level

Per (`ab_variant`, segment, payer_flag): wins per NS-active player-day (mean, p25..p90), lost levels
per player-day, continues bought per player-day and the share of lost levels saved by a continue.
This lets me tell "longer streaks" apart from "streaks kept alive by continues".

## 4. Reconciliation (run it, report the numbers)

1. Per cell, `Σ_rounds claim_rate_per_player_day` (3.1) against `Σ_k k x share` (3.2): the same
   number by two routes, within 1%.
2. Per cell and round k: `claims_total / player_days` (3.1) against `share_ge_<cum_streak_req_k>`
   (3.3, reading the nearest X or interpolating): they must agree if a round is cleared exactly when
   progress reaches its requirement. Report every cell off by more than 0.02, and why.
3. Coins: `Σ hc_granted_total` per cell against Night Sky (`Daily Night Sky Prize` / Dream Heist) coins
   in `data_gains` for the same arm and window, within 2%.
4. `player_days` (3.1) against `data_streaks.player_days` for the same cell: give both and the
   difference in the two definitions.
5. One example player-day traced end to end: level results in order, the streak count after each,
   each claim with its round index and coins.

## 5. Deliverables

- The queries, composed in labelled blocks like your earlier ones, as `sqls/data_ns_rounds_v2.sql`,
  `sqls/data_ns_dayend.sql`, `sqls/data_ns_progress.sql` (and `sqls/data_ns_streak_session.sql` if
  delivered).
- The sheets named exactly `data_ns_rounds`, `data_ns_dayend`, `data_ns_progress`
  (`data_ns_streak_session`), headers exactly as §3, data from row 2, pushed by the same export step.
- Notes: the answers to §2, the reconciliation numbers of §4, and anything you approximated.
