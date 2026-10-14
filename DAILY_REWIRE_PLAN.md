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
