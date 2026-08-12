# Night Sky — Mechanics

**Type:** daily-reset win-streak milestone ladder | **Sim category:** Daily Night Sky Prize | **Status:** LIVE as an A/B test (both calendars, 33×1d) | **Config sheets:** `NS` (base = live) / `NS_v2` (redesign) | **Athena name:** logged as *Dream Heist*

## What it is

Night Sky is a **daily streak event**: the player chains consecutive level wins, and clearing a streak
milestone pays a reward. A level **fail resets the streak to 0**, and the whole event **resets every
day** — yesterday's progress does not carry over. NS income is therefore a **daily rate**, not a
cumulative track, which is why the sim prices it per active day and multiplies by expected active
days (CONFIRMED: `NS_Economy_Sim_Summary.md`, and the sheet layout).

It runs **alongside** Core progression as a secondary HC faucet, and was introduced as the offset for
a Core/Saga nerf ("cut Core rewards, add NS") — see `core-saga.md`.

## Two versions of the mechanic

1. **Design/study version** (`NS_Economy_Sim_Summary.md`, workbook `1_DAY_NS_TD_5_Segs_V3`): 5 rounds
   played sequentially, each with a shared *Mid* path, a crossroad, and a **Left (short/cheap) or
   Right (long/rich)** branch. Streak requirements escalate hard across rounds (R1 ~2–11, R5
   ~17–370). Many milestones are progression-only (0 HC). CONFIRMED for that study.
2. **What the live config actually ships** (`NS` sheet, "Night Sky (5 Segment)"): per engagement
   segment **3 rounds × 1 milestone**, `Path` = `Final` for every row — i.e. **no L/R branching** —
   gated on `Cum Streak Req`, paying `HC Reward` plus booster columns. This is what the engine reads.
   CONFIRMED from the sheet; the branch model above is NOT in the live config.

**Config panel:** `numberOfSegments 5`, `roundsPerSegment 3`, `milestonesPerRound 1`.

## The ladder (live `NS`, workbook (14) — `NS_v2` is a verbatim clone as shipped)

Cumulative streak requirement → HC reward, per segment (booster columns alongside: m2 pays Red,
m3 pays Chuck + Slingshot):

| Segment | m1 | m2 | m3 |
|---|---|---|---|
| 0-9   | 2 → 0 HC   | 5 → 10 HC   | 10 → 15 HC   |
| 10-19 | 6 → 10 HC  | 13 → 30 HC  | 26 → 60 HC   |
| 20-39 | 11 → 15 HC | 26 → 50 HC  | 42 → 100 HC  |
| 40-99 | 28 → 50 HC | 60 → 120 HC | 100 → 250 HC |
| 100+  | 80 → 100 HC| 175 → 300 HC| 280 → 400 HC |

The sheets also carry `SPT`, `SPT x2`, `COOP Token`, `Avatar` and the six `N-star Dly` pack columns —
**all zero today**. Typing a value into `NS_v2` is how a redesign enters the sim (see below).

## Calendar

| | cal_curr | cal_new |
|---|---|---|
| Night Sky | 33 × 1-day instances | 33 × 1-day instances |

Identical on both sides, so the cadence term **T = 1** today. Each instance is one day, so its reach
is just that day's activity probability (`p_day`), and `Σ p_day` over the lane is the expected number
of active days in the 33-day window.

## Simulation notes (D22, 2026-08-05 — ANCHORED; supersedes the bottom-up D13 model)

`NS` is the **base** config and `NS_v2` the **redesign**. The measured `Daily Night Sky Prize` rows in
`data_gains` were earned under `NS`, which makes them a legitimate anchor, so NS is priced like every
other configured source:

```
SIMULATED[res] = measured[res] × R[res] × T          (D = 1 — one-day instances)
R[res]         = E_v2[res] / E_base[res]
E[res]         = Σ_k S(CumStreakReq_k) × reward_k[res]
S              = survival over data_streaks max_streak_per_day p25/50/75/90 × NS_STREAK_N (1.25)
```

- **The same S prices both sides**, so a **requirement** edit in `NS_v2` moves R just as a reward edit
  does.
- **`NS_v2 == NS` ⇒ R = 1 ⇒ sim = measured × T**, and with T = 1 the diff is exactly **0**. That is the
  property the re-anchor exists for — the model cannot invent a change that was not configured.
- **Missing `NS_v2`** sheet, or a missing segment row, falls back to `NS` (R = 1) — the sheet works
  before the redesign is authored.
- **No anchor cases:** `E_base = 0` and `E_v2 > 0` → ADD the bottom-up `E_v2 × Σ p_day` (this is how an
  SPT reward typed into `NS_v2` reaches `sptTotals_` and can move the Season Pass tier). Packs instead
  take the standard `packLane_` (`E_v2 × participation × Σ reach`), like every other source.
- **No `cal_new` NS instances → 0** (removal semantics, as River Rush).
- **`A. 0`** is intercepted by `appendixRow_` → carried, never simulated.
- **`NS_SIMULATE`** (in `EcoGainsSim_v4.gs`) remains the on/off for the whole lane: `false` → carried,
  T not applied, and the PBP sim claims no NS milestones.
- **PBP** reads `NS` on `cal_curr` and `NS_v2` on `cal_new` — the one documented exception to "ladders
  come from the `_v2` sheets for both calendars" — so the ledger agrees with the anchored window sim.

Shipped values, workbook (14), NONPAYER (sim == measured, diff 0, because `NS_v2` is a clone):
0-9 **14.07** · 10-19 **43.51** · 20-39 **86.85** · 40-99 **180.67** · 100+ **201.74** HC.

`NS_STREAK_N = 1.25` is the **effective-streak factor** from the standalone NS Excel study: a player
tends to land roughly a second streak of similar size within the day, and the factor absorbs resets.
INFERRED-from-study, uniform across segments and payer types.

## Flags / open questions

1. **The overestimate was never diagnosed.** The pre-D22 bottom-up model produced absolute totals
   ~4.6–5× the measured value with *untouched* configs (20-39: 455.6 vs 86.9 HC). Anchoring makes the
   level right by construction but does **not** explain the gap — the same unvalidated
   ladder-climbing model still produces R, so a large `NS_v2` edit inherits whatever bias it carries.
2. **A/B dilution now cancels.** Measured NS is diluted by players who never had the event. That
   dilution sits on both sides of R and cancels, so the DIFF is the **config effect only** — the
   full-rollout ("rollout effect") number is no longer produced by any sheet function. Accepted
   trade-off (D22), but it means NS cannot answer "what is full rollout worth?" any more.
3. **One clear per day.** The model assumes the ladder is climbed within a single unbroken run per
   day (`Cum Streak Req` vs the daily MAX streak) — conservative. The optimistic alternative
   (per-milestone `Streak Req`, streaks chaining across claims) is a one-line switch.
4. **Tail past p90.** S is extrapolated linearly beyond p90; the harness prints an `S = 0 beyond p90`
   conservative bound alongside. Matters most for 100+, whose m3 sits at 280 streak.
5. **Live config ≠ design doc.** The shipped ladder has no L/R branching and 3 milestones, against the
   5-round branching structure in the study. If the redesign restores branches, `readLadder_` reads
   rows until the first blank first cell — a branched layout would need a reader change.
6. **A/B-arm telemetry unused.** No validation of the model against the treated arm has been done.

## Sources

- `NS_Economy_Sim_Summary.md` (standalone study; workbook `1_DAY_NS_TD_5_Segs_V3`)
- `NIGHT_SKY_REWIRE_PLAN.md` (2026-07-06 Option A re-wire — the E term behind R)
- `SIMULATION_PLAN.md` §2.16 + decisions D13 / D14 / D22; `SIMULATION_METHODOLOGY.md` §6.7
- Live workbook sheets `NS`, `NS_v2`, `data_streaks`, `data_gains`, `cal_curr`, `cal_new`
