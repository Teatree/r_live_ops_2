# Prompt — Night Sky (Dream Heist): the daily streak distribution on the claim's own counter

Paste this to the analytics LLM **together with the query that produced `data_ns_reach` and
`data_ns_per_day_reach`** (2026-11-18 pull). It extends that pull; same cohort, filters, arm, dates and
ladder assignment. Night Sky is logged as **Dream Heist**.

---

## 0. Why

We are redesigning the Night Sky ladders (40-99 goes from 3 rounds at cumulative streak 28 / 60 / 100 to
7 rounds at 11 / 26 / 42 / 70 / 102 / 142 / 197; 100+ from 80 / 175 / 280 to 28 / 60 / 100 / 160 / 240 /
335 / 440, and drafts go up to 765). To say how many player-days will clear a round at a requirement the
current ladder never asked for, I need the **whole distribution of the streak progress the round
claim fires on**, not just its value at today's three requirements.

Your `data_ns_reach` (2026-11-18) gives four candidate measures at today's requirements. Per active
player-day, all dates pooled:

| ladder, round (cum req) | claimed | reached_streak | reached_longest | reached | `data_ns_progress` |
|---|---|---|---|---|---|
| 0-9, 1 (2) | 72.8% | 68.0% | 68.0% | 70.8% | 73.2% |
| 0-9, 3 (10) | 21.2% | 16.9% | 11.2% | 22.1% | 23.9% |
| 10-19, 3 (26) | 8.4% | 6.5% | 4.3% | 13.1% | 15.9% |
| 20-39, 1 (11) | 54.5% | 48.7% | 48.7% | 66.3% | 75.0% |
| 40-99, 1 (28) | 34.4% | 31.7% | 31.7% | 59.3% | 68.0% |
| 40-99, 3 (100) | 5.0% | 3.8% | 3.3% | 9.0% | 10.7% |
| 100+, 1 (80) | 25.9% | 23.5% | 23.5% | 49.0% | ~63% |

`data_ns_progress` (the curve I priced new rounds on) behaves like `reached`, about 2x the claims from
20-39 up, so it cannot price a round. **`reached_streak` is the measure that tracks the claims**, but it
still sits 5-29% under them on the later rounds (0-9 round 3: 16.9% against 21.2%). So:

1. find the counter the round claim actually fires on, and
2. deliver its full daily distribution (§3), on exactly the denominator of `data_ns_per_day_reach`.

## 1. Shared rules (unchanged from the 2026-11-18 pull)

- **Arm:** `config_arm` on every row, as in `data_ns_per_day_reach`. Variant A (Dream Album); add Control
  rows only if labelled.
- **Dates:** the same `event_date`s as `data_ns_per_day_reach` (2026-10-13 .. 2026-11-15). Deliver
  **every** date, Oct 13 included - I leave out a date myself when it is broken (see §2.4).
- **Ladder:** the Night Sky ladder the player was served that day (`ladder` = `0-9`, `10-19`, `20-39`,
  `40-99`, `100+`), exactly as in `data_ns_per_day_reach`.
- **Active player:** exactly the `players_active` definition of `data_ns_per_day_reach`, so that for every
  (date, ladder) the payer rows of §3 sum to that sheet's `players_active`.
- **Payer:** lifetime `payer_flag` (`NONPAYER` / `PAYER`), the same flag as every other sheet.
- `day_type`: Fri / Sat / Sun = `weekend`, else `weekday` (as `data_ns_per_day_reach`).

## 2. Answer first, in prose

1. **The three reach columns.** Give the exact definition (the SQL logic, in words) of
   `players_reached_streak`, `players_reached_longest` and `players_reached`. Which log fields and which
   reset rule each one uses.
2. **The claim's counter.** What does the game check when it lets a player claim round k: a counter the
   client logs (name the event and field, e.g. the Dream Heist progress event), or a rule you rebuild from
   level results? Why do claims exceed `players_reached_streak` by 5-29%? Check each of these and say which
   ones explain the gap, with the number of claims each accounts for:
   - a lost level saved by a +5-moves continue (does it keep the streak?);
   - a quit / a closed app mid-level;
   - progress carried across the day boundary (which timezone is the event day?);
   - a claim of round k made on the day AFTER the player reached it (claimed late);
   - boosters or pre-level items counted as wins;
   - the client counting a win the level-result log does not have (or the reverse).
3. **Cumulative or per round?** Does a cleared round's progress count toward the next round (one counter
   per day, `Cum Streak Req`), or does each round restart from 0 (`Streak Req`)?
4. **Oct 13.** On 2026-10-13 round 1 has more claims than active players (0-9: 7,075 vs 4,761; 10-19:
   2,310 vs 2,062; 20-39: 2,206 vs 1,024). Why (event start time, claims of an earlier test, a different
   `players_active` that day)? I leave out any date where a round counts more claims than actives.
5. **After the final round.** Does the counter keep counting after the last round is cleared? If not,
   rebuild it past the final round with the same reset rule (§3 must not stop at 10 / 26 / 42 / 100 / 280).

## 3. Sheet to deliver: `data_ns_streak_dist`

Per (date, ladder, payer): how many active players' **daily peak progress on the claim's counter** (§2.2;
`reached_streak` if nothing better reproduces the claims) reached at least X. **Counts, not shares**: I pool
dates and payers myself, so the numbers must add.

One row per (`event_date`, `ladder`, `config_arm`, `payer_flag`). Headers exactly:

| column | meaning |
|---|---|
| `event_date` | date, as in `data_ns_per_day_reach` |
| `day_type` | `weekday` / `weekend` |
| `ladder` | `0-9`, `10-19`, `20-39`, `40-99`, `100+` |
| `config_arm` | as in `data_ns_per_day_reach` |
| `payer_flag` | `NONPAYER` / `PAYER` (no ALL row - I sum them) |
| `players_active` | active players of the (date, ladder, payer); the two payer rows sum to `data_ns_per_day_reach.players_active` |
| `players_zero` | active players whose peak progress that day was 0 |
| `progress_sum` | sum over active players of their peak progress (for the mean) |
| `progress_max` | the highest peak progress of the (date, ladder, payer) |
| `players_ge_<X>` | active players whose peak progress reached at least X, for **X = 1, 2, 3, 4, 5, 6, 8, 10, 11, 13, 15, 18, 20, 23, 26, 28, 30, 35, 40, 42, 50, 55, 60, 62, 70, 80, 90, 100, 110, 120, 142, 150, 160, 175, 197, 200, 225, 240, 250, 280, 300, 335, 350, 400, 440, 500, 600, 700, 765, 800, 900, 1000** |

More `players_ge_<X>` columns than listed are welcome (the model reads every column of that shape by its
header and interpolates between them); keep them in increasing X order. Deliver the high X columns even
where they are 0 or a handful of players.

Example (made-up numbers):

```
event_date  day_type ladder config_arm               payer_flag players_active players_zero progress_sum progress_max players_ge_1 players_ge_2 ...
2026-10-14  weekday  40-99  Variant A (Dream Album)  NONPAYER   4210           61           118450       233          4149         4101         ...
2026-10-14  weekday  40-99  Variant A (Dream Album)  PAYER      1874           35           50120        210          1839         1817         ...
```

## 4. Reconciliation (run it, report the numbers)

1. **Same denominator.** Per (date, ladder): `SUM over payer_flag of players_active` =
   `data_ns_per_day_reach.players_active`. Exact.
2. **The counter is the claim's.** Per (date, ladder, round k): `SUM over payers of players_ge_<cum_req_k>`
   against `data_ns_per_day_reach.players_claimed` of round k. Report, per ladder and round over all dates
   (Oct 13 excluded), the ratio claimed / reached. **Target: within 3% on every round.** If you deliver
   `reached_streak`'s counter because nothing closer exists, say so and give the same ratios.
3. **Monotone.** Every row: `players_active >= players_ge_1 >= players_ge_2 >= ...`, and
   `players_active - players_zero = players_ge_1`.
4. **Past the last round.** For each ladder, how many player-days reach 2x the final round's requirement
   (0-9: 20, 10-19: 52, 20-39: 84, 40-99: 200, 100+: 560) - to show the counter is not capped.

## 5. Deliverables

- The query, composed in labelled blocks like your earlier ones, as `sqls/data_ns_streak_dist.sql`.
- The sheet named exactly `data_ns_streak_dist`, headers exactly as §3, data from row 2, pushed by the same
  export step as `data_ns_per_day_reach`.
- Notes: the answers to §2, the reconciliation numbers of §4, and anything you approximated.

## 6. How it is used (for your information)

For a ladder and day type, `S(X) = SUM players_ge_X / SUM players_active` over the kept dates (payers
pooled, or one payer). A round with requirement X then completes on `c x S(X)` of active player-days, where
`c` = claims / S at today's rounds (close to 1 if §4.2 holds). The NS_v2 / NS_v2_weekday sheets and the
economy engine both read the sheet by its headers; until it exists they fall back to `data_ns_progress`.

## 7. Follow-up on the 2026-11-18 delivery

Thank you - `data_ns_streak_dist` reproduces the claims well: claimed / `players_ge_<cum_req>` is 1.01-1.14
on every ladder and round. One thing is still missing: **the counter stops at each ladder's final round**,
so nothing above it is measured (§2.5, §4.4):

| ladder | final round | share reaching it | share reaching the next column |
|---|---|---|---|
| 0-9 | 10 | 20.1% | 11: 3.4% |
| 10-19 | 26 | 7.7% | 28: 0.9% |
| 20-39 | 42 | 7.6% | 50: 0.5% |
| 40-99 | 100 | 4.4% | 102: 0.36% |
| 100+ | 280 | 1.6% | 300: 0.12% |

The redesign's new rounds sit above those points (40-99 at 102 / 142 / 197, 100+ at 335 / 440, 20-39 at 62),
so until then I extend the curve past the final round on its own slope (an assumption). Please re-deliver
the sheet with the counter **rebuilt past the final round** from the level results, with the same reset
rule as below it, and add a column `censored_at` = the ladder's final requirement if any part of a row
still stops there.
