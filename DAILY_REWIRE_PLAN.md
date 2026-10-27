# DAILY_REWIRE_PLAN — how `EcoGainsSim_Daily` places gains on days (D60, 2026-10-14)

Decision record for the day-placement rewrite of `engine/EcoGainsSim_Daily.gs` (mirrored into
`engine/pre_collection/`). Companion to `NIGHT_SKY_REWIRE_PLAN.md`. Reflects the code as shipped.

## 1. What this is for

The daily view exists to compare the simulation **day by day** with the measured data as it
arrives, so the direction of travel can be read early — even from 2 or 3 days of a 33-day window.
Before D60 it could not be trusted for that: it misplaced **19.6%** of a resource's mass (TV,
share of mass sitting on the wrong day; HC 13.9%) against the real 33-day `data_econ_daily`.

## 2. Method — measured before it was built

Nothing in this plan was argued into the engine. Every candidate rule was prototyped offline and
scored against `data_econ_daily` **one at a time**, then together:

- `harness/_probe_daily_alloc.js` — the baseline: today's allocation vs the actuals, per
  (cell × resource), with the actuals' own noise floor (CV around a 7-day MA, weekend amplitude)
  so the acceptance threshold is derived, not asserted.
- `harness/_probe_daily_alloc_toggles.js` — each candidate rule as a toggle, alone and combined,
  with a parameter sweep where a parameter existed. Outputs in `analysis/out/daily_alloc_*.json`.

The metric is **TV = ½ Σ_d |a_d/Σa − s_d/Σs|** on the normalised day-shapes: immune to the level
gap between the two feeds, so it measures *placement* and nothing else.

| candidate | TV alone | verdict |
|---|---|---|
| River Rush drawn on `cal_curr` (days 2–8, 16–22, 30–33), `p_day` inside each block | 0.196 → **0.169** (−14%); SPTx2 0.443 → 0.093 | **ship — a calendar edit** |
| Season Pass lane ∝ Σ`p_day` over its days, no reach split | 0.196 → **0.170** (−13%); HC 0.139 → 0.126 | **ship** |
| rank lumps settle **+1** day after the grid cell | 0.196 → **0.178** (−9%); HC → 0.120 | **ship**, authored per category |
| geometric attendance *collect* kernel on everything | 0.196 → 0.162 (−17%) | **rejected** — see §4 |
| leaderboard accrual curves (milestone share *s*) | 0.196 → 0.194 (−1.3%) | no-op: `cal_curr` instances are 1 day long |
| Season Pass on tier-crossing days | 0.196 → **0.259 (+32% worse)**, every variant, both dumps | **rejected** |
| flat → `p_day` for off-grid sources | 0.0% (weekday/weekend rates differ by <0.03) | principled, inert |
| `cum_token_share_mean` instead of `p50` for the marginal family | small, mixed at the ALL level; correct | **ship** |

Combined (River Rush + Season Pass lane + settle +1): **0.196 → 0.121**, mass-weighted
0.146 → 0.108, HC 0.139 → **0.096** against an HC noise floor of 0.067; 116 of 130 series improve;
every window total conserved to the bit.

## 3. The model as shipped — `DAILY_ALLOC_MODEL = 'settle'`

```
days[d][r] = W[r] × renorm_1..33( shift( place[d], settle[cat] ) ⊛ lag[cat] )[d]

place   lump on the instance's last day            — rank families (DAILY_LASTDAY)
        Δ cum_token_share_MEAN over the instance   — marginal family (HH, Bomb's Ballet, Jigsaw, Photoshoot)
        ∝ p_day over the UNION of the lane's days  — continuous tracks (DAILY_TRACK: Season Pass Free/Paid)
        ∝ p_day                                     — always-on (Core/Saga/Daily Gift), RM/NS within instance
        1/33 flat                                   — no calendar instance (Ads, Other, IAPs, FlowerCoop)
settle  authored per category on the optional `sim_settle` sheet; default +1 for every rank
        family (DAILY_SETTLE_DEFAULT), 0 for everything else
lag     authored [lag_0, lag_1, lag_2], normalised; identity until fitted (§6)
renorm  mass that leaves day 33 is dropped and the vector renormalised — never a 34th row,
        never a fold onto day 33 (user decision 2026-10-13). A category whose every lump would
        leave the window keeps its earn-day placement rather than going flat.
```

`'legacy'` restores the pre-D60 engine bit for bit (gated). The 7-day view asks for
`opts.earnDay` and skips settle + lag: the A/B window is compared on the day a reward is
**earned** (user decision 2026-10-14). Days 1..33 sum to the same window total either way.

**Why +1.** A 1-day calendar cell is a **2-date event** (user-confirmed 2026-10-14;
`data_event_accrual` carries `instance_length_days = 2` for every leaderboard the grid draws as one
cell, with 81–98% of tokens on date 1). The board closes and pays on the next date. Team Race shows
it in all ten cells: Sunday closes 5/12/19/26 read 0.83–0.94× of the mean on the close day and
1.15–1.23× the Monday after. There is **no day-1 offset** between `cal_curr` and the data: once the
lumps settle, shifting the actuals ±1 day is clearly worse (0.155 vs 0.190 / 0.173).

**Why the grid is not redrawn instead.** Merging every 1-day cell into a 2-day instance would
change reach (T) and D and reopen validated window totals. The settle offset encodes the same fact
— the cell is the date the event is played, the payout lands the next date — without touching
them.

## 4. What was rejected, and why it matters

**The geometric attendance *collect* kernel** (collect on the first active day ≥ settlement,
`P(k) = p_(s+k) Π(1−p_(s+j))`). It scored −17% alone, but three facts killed it:
the data shows the post-close excess on `end+1` with **no tail at +2/+3**, where the kernel
would smear 52–66% of a rank lump over +2…+10; a plain symmetric 5-day box scored the same
(0.160 vs 0.162), so the gain was *de-lumping a population average*, not modelling collection;
and the width is not identified by daily totals at all. What survives is the **authored lag
vector** — a slot for the real thing once the grant-vs-balance lag data exists.

**Season Pass on tier-crossing days.** +32% worse on both dumps. The base track pays HC on tiers
2/5/10/15/20/25/30 only, so a mean-player crossing model is a 7-tooth comb against a smooth
population average; and the synthetic Core SPT anchor (§7) caps 6 of 10 cells at tier 30 by day
~20. `spPackTiers_` (the card sim's envelope days) uses the same linear rule and scores 0.272
here — a known gap, not changed by D60.

**"Split ratio from `packRungs_`/`rewardE_`."** `packRungs_` is pack-only and returns `null` for
all 29 categories on the workbook of record; a per-resource rank/milestone split needs a lane-aware
accumulator in `lbE_`/`collE_`. Deferred: the lane split measured −1.3% because `cal_curr`
instances are one day long and the curves have nothing to spread.

## 5. Per-category rules

| sources | rule | notes |
|---|---|---|
| Bomb/Chuck/Red Challenge, Level Race, Flash Race, Target Day, Kite Festival, Team Event, Team Race, Flock Flurry | lump on last day, **settle +1** | the data could not see Bomb/Chuck/Red/Level Race either way (0.7–3% of mass); +1 is the rule, the panel can override per source |
| Hatchling Hideaway, Bomb's Ballet, Jigsaw, Photoshoot | Δ `cum_token_share_mean`, no settle | `accrualD_` keeps p50 for the D multiplier |
| Season Pass (Free), Season Pass (Paid) | ∝ Σ`p_day` over the lane's days | kills the [1..30]+[31..33] stub artefact |
| Core, Saga, Daily Gift | ∝ `p_day`, instant | unchanged |
| Night Sky | D23 weekday/weekend ladder split, instant | unchanged; its "own curve" is a 2-date straddle of a 1-day cell, nothing to spread |
| Rainbow Maker | ∝ `p_day` within instance (per-instance config rows on the new side) | unchanged |
| ToF | ∝ `p_day` over its live days | unchanged |
| River Rush | ∝ `p_day` within each block **once drawn on `cal_curr`** | off-grid it is flat — the largest single error found |
| Ads, Other, IAPs, FlowerCoop | flat 1/33 | FlowerCoop is a guess; `p_day` measured inert |
| Col - Sets, Col - Albums | carried through `measuredRow_` | the card sim's own day curve is not wired in (menu-run, stochastic, may be stale) |

## 6. Data asks, ranked by what they unblock

1. **`data_econ_daily` with a source dimension** — `PROMPT_econ_daily_by_source.md`. Validates
   the settle offset per event, identifies the lag width, prices the lane split, shows the Season
   Pass lane's true shape. Without it the view can only be checked in aggregate over ~25 sources,
   where a +2-day error on one and a −2-day error on another cancel.
2. **The live daily feed** — `PROMPT_econ_daily_live.md`: "how much did segment X gain of Y on day
   N", incomplete-tolerant, the direct comparison line.
3. The grant-vs-balance **lag distribution** per player (fits `lag_0..2`).
4. The per-player **SPT-rate distribution** (what a Season Pass crossing model would need).
5. The River Rush **schedule** for `cal_curr` — a calendar edit, not a query.

## 7. Known errors the placement model does NOT touch

- **The D18 synthetic Core SPT anchor is 5.7–30× the actual SPT faucet** (782–13,247 SPT per
  earner vs a measured 136–622). `data_econ_daily` carries a real SPT lane now, so the anchor can
  be validated; as shipped it looks like a double count. Dominates every SPT delta.
- **In wb15 the sim anchor (`data_gains`) and the actuals (`data_econ`) are different pulls**
  (sim/actual level 0.33–0.86×). In the live ADJUST workbook they agree within ±2% for nonpayers.
  Per-day **%** deltas on wb15 are mostly level, not placement — read TV, or cumulative-through-N.
- `data_event_accrual`'s `Milestone` rows are one unidentified instance (mean = p50 = 0.4247 on
  day 1); not used as a default curve.

## 8. Reading the comparison — the acceptance criterion

A single day's % is not a verdict: the data's own day-to-day CV is 17–29% for the smooth
resources and 51–61% for SPT/SPTx2 (event structure, not noise). Derived from the data:

- **Shape:** per series TV ≤ 1.5× its own 7-day-MA residual (HC ≈ 0.10, boosters 0.09–0.12,
  UL 0.17–0.21); aggregate mean TV ≤ 0.13. The shipped combination reads 0.121.
- **Level / trend:** cumulative-through-N for N ≥ 7, inside the resource's week-over-week CV
  (HC 2–12%, boosters 3–22%, UL 10–30%).
- **Timing:** 3-day centred sums (±1 day) — the grid's 1-day cells straddle two dates, so ±1 day
  is the calendar's own resolution.

## 9. Conservation and the blast radius

Every kernel is renormalised over days 1–33, so Σ_d equals the window total: verified max abs err
0 on every probe run and 6e-12 on the 7-day CONSERVATION gate. Therefore: the 33-day
`ECOGAINS_SIM` is untouched (it never reads the daily view); `ECOGAINS_SIM_7_DAY` sums the
earn-day series and its conservation gate holds; `packDayWeights_` keeps the D26 fold onto
`SEASON_LAST_DAY`; `EcoGainsSim_PBP.gs` has its own claim ledger and references none of this;
`CardOpenings.gs` places its own envelope rungs (`packGrantPlan_`, p50 marginal) — a second
placement model, flagged, not changed here.

Gates (`harness/_mock_daily.js`, `_mock_7day.js`) assert the **rule** with fixtures, never a day
list: default +1 off the parsed calendar (a day-33 close folded, never a day 34), legacy, authored
`settle_days = 0`, authored lag [.5,.5] (equal halves on +1/+2), an authored row moving only its
own source, earn-day; HH on the MEAN marginal under settle and p50 under legacy; a synthetic
[1..30]+[31..33] lane with equal same-type-day weights under settle and a piled stub under legacy;
River Rush injected on `cal_curr`; DATA/DATADIFF and the 14-of-33-day truncation.

## 10. Sheet and workbook changes

- `display/EcoGainsSim_Daily_v3.xlsx` (`builders/_build_daily.py`): CURRENT GAINS (data) / NEW
  GAINS (sim) / Δ GAINS (data − sim) / CURRENT SPEND (data) / CURRENT NET (data) / NEW NET (sim) /
  Δ NET (data − sim) + the SIM-of-cal_curr validation lane. Twenty resources wide (ToF_Ticket).
  Data blocks blank past the last pulled day and unless Source = ALL.
- `display/sim_settle_v1.xlsx` (`builders/_build_sim_settle.py`): optional; defaults run without it.
- **`cal_curr`: draw a `River Rush` row** with merges at days 2–8, 16–22, 30–33, then run
  **EcoGainsSim ▸ Precompute calendars** (merge edits fire no trigger).
- Re-paste `EcoGainsSim_v4.gs`, `EcoGainsSim_Daily.gs`, `EcoGainsSim_7Day.gs` (stamp
  `EcoGainsSim_Daily.gs D60 2026-10-14`).

## 11. Decisions logged

| date | decision |
|---|---|
| 2026-10-13 | Current = measured actuals; New stays the cal_new redesign; cal_curr is the live calendar |
| 2026-10-13 | `data_econ_daily.day_index` is balance day |
| 2026-10-13 | two lanes per source in principle; conservation by renormalisation, no 34th row |
| 2026-10-14 | 1-day calendar cells are 2-date events → settle +1 encodes it, grid not redrawn |
| 2026-10-14 | the 7-day A/B window compares on **earn** day |
| 2026-10-14 | NEW NET keeps the anchored form (data gain + sim shift − data spend) |
| 2026-10-14 | all five measured changes approved; lag vector ships as identity until the lag data exists |

## 12. Addendum (D61, 2026-10-14) — what the no-change check found

The user's workbook deliberately runs `cal_curr == cal_new` with identical configs and expects no
differences. It showed plenty. None of them were the placement model:

| cause | fix | commit |
|---|---|---|
| Rainbow Maker placed per instance on NEW only; CURRENT fell through to the reach split (same totals, days 10 HC apart) | both sides place per instance; pack cutoff folds on both sides | D60b `0114f2a` |
| Rainbow Maker anchored on a synthetic walk 4.6–10.8× the export — **the SPT excess over `data_econ`** | `RM_REAL_DATA_WINS = true`, per resource: `sim = export × walk_new / walk_cur` | D61a `2b6df6a` |
| packs and `ToF_Ticket` read 0 on the measured side by construction | `PACK_ANCHORED`: the source's own sim over `cal_curr` on the base config | D61b `921a510` |
| ToF read 0 on the measured side (no `data_gains` category) | `TOF_ANCHORED`: the run budget over `cal_curr`, measured ticket income | D61c `a9f650e` |
| Night Sky's base side ignored the authored `NS_weekday` ladder | base pair blended like the redesign pair; daily view places both sides by day type | D61d |
| `data_econ_daily!A1` reads `EcoGainsSim_Daily` instead of `segment` | **workbook edit** — the daily reader finds no segment column otherwise | — |
| Season Pass (Paid) NEW total moved 175 with the pack cutoff at `20-39 PAYER` — the SPT totals were memoised while ToF was in flight (ToF contributes 0 there), so the cached tier depended on which row was asked for first | explicit `noToF` mode keyed into every cache in the cycle; `Context.reset()` clears module memos | D62 `5af1108` |
| the measured Season Pass tier total memoised from inside the Core row's buff-minutes walk, 105 short | served there, never memoised | D62b (same commit) |
| the data blocks read the August sheet although the live feed had landed | `data_econ_daily_live` preferred when usable, base sheet as fallback | D63 `cac0544` |
| the weekend was a hardcoded Wednesday start; the live calendar starts on a Tuesday | `isWeekend_` reads day 1's weekday off the calendar's weekday row; Wednesday is the fallback | D64 |

After D61 the live dump's NEW-vs-CURRENT list is empty, and `harness/_mock_run.js` proves the
rule by fixture (calendars and every `_v2` sheet made identical → `DIFF == 0` everywhere; anchors
off → the simulated side bit-identical and the measured bottom-up columns 0 again).

**Config diffs, re-checked with the engine's own readers.** Of the differing cells across the
`_v2` pairs, the engine saw exactly one: `SP_lb_v2` row 17 (Rank 11, Slingshot 0 → 1), which is
the Season Pass Slingshot 1.75 → 2.18. `RM_1st_v2` cols 28–45 ("New Matchables Req",
"Polynomial Power", the `<seg>_reward` panel), `Ph_v2` rows 17–19, `AlbumConfig_v2` Q:V, `TaD_v2`
row 7, `Ki_v2` row 89, `Race_v2` row 92, `BB_v2` col 23 are helper and visual blocks the ladder
readers never touch — confirmed by per-category sim == measured on identical calendars.

**The data in this workbook is not from this calendar.** `data_econ_daily` and the by-source feed
cover **Tue 2026-08-11 → 09-13** (a Tuesday start, where the calendar convention is Wednesday —
`isWeekend_` is then off by one against that data) and run the OLD calendar: Bomb Challenge mass
sits on days 2/4/30/32 while this `cal_curr` ends it on 14/16. Per source the by-source feed
also does not reconcile with `data_econ_daily` day by day even for boosters (Chuck 0.6–4.5×
under every ±1-day shift), so the two pulls are not on the same footing. Decision (user,
2026-10-14): leave the data blocks alone until `data_econ_daily_live` arrives from the new
calendar's day 1; ask the analyst to re-pull both on the Wednesday start with the §10
reconciliation test actually run.

## 13. Live feed, day 1 (2026-10-14, 16:19 workbook) — what it showed

`data_econ_daily_live` landed with one day (`window_start_date` 2026-10-13, Tuesday; 130 rows,
10 cells × 13 currencies, `status = MEASURED`). The reader takes it over the August sheet by itself
(D63); day 1 fills, days 2..33 stay ''. But the numbers are not comparable yet:

| cell | live d1 HC per earner | live d1 HC per active | NEW sim d1 (per window earner) | Aug HC per earner-day | Aug window earners / daily actives | live d1 / Aug, per active |
|---|---|---|---|---|---|---|
| 0-9 NONPAYER | 73.6 | 68.7 | 14.4 | 15.6 | 3.06 | 1.44 |
| 20-39 NONPAYER | 202.3 | 199.0 | 43.8 | 50.8 | 2.74 | 1.43 |
| 100+ NONPAYER | 761.7 | 758.3 | 137.3 | 155.5 | 3.03 | 1.61 |
| 0-9 PAYER | 90.3 | 84.9 | 18.9 | 23.1 | 2.95 | 1.25 |
| 20-39 PAYER | 346.3 | 340.8 | 50.4 | 78.2 | 2.97 | 1.47 |
| 100+ PAYER | 1301.9 | 1301.9 | 145.7 | 221.9 | 2.96 | 1.98 |

Two effects stack. **The denominator:** `gain_per_earner_day = gain_total / resource_earners_window`,
and the window is *to date* — on day 1 that is the day's actives, by day 33 it is ~3× more people, so
every row is revised down on each re-pull and the series only reaches the sim's footing (per
window earner, the `data_gains` unit the sim is anchored on) when the window completes. **The day
itself:** per active player, day 1 pays 1.25–1.98× an August average day (a season/calendar start,
or the Tuesday before it — see below). The sim's day 1 sits on the August level, as it should.

**Decision needed (recommended first):**
1. Re-define `resource_earners_window` as the unique earners in the trailing 33 days ending on
   `calendar_date`. Fixed per day, never revised, same footing as `data_gains`. No engine change.
2. Or compare per active player-day (`gain_per_active_player_day`, stable) and convert the sim by
   `earners_window / active_players_day` (2.7–3.1 from August, or `data_seg_beh`). That puts a model
   factor inside a block meant to be pure data — flagged, not recommended.

**Also found:** `window_start_date` is a Tuesday — **confirmed by the user (2026-10-14): the live
calendar's day 1 IS Tuesday 2026-10-13.** Both calendar sheets still say Wednesday on their weekday
row and `isWeekend_` was a hardcoded Wednesday start, so the weekend sat one day early for this
calendar. D64 reads the start weekday off the calendar's weekday-name row (`calDay1Dow_`); the one
workbook edit is to retype that row Tuesday-first on `cal_curr` and `cal_new` (the engine then runs
the weekend on days 4/5/6 … 32/33). Measured on the adjust dump: 33-day totals move < 0.1%, the
identical-calendar DIFF stays 0, the day placement moves. The feed's `dow` column is cross-checked
against the calendar in `econDaily_` and a mismatch is logged. The workbook's live sheet also carries
~63,800 by-source rows pasted beneath the 130 live ones in a different column layout (skipped by the
reader, but walked on every recalc); `data_econ_daily!A1` still reads `EcoGainsSim_Daily`.
