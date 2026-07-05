# Daily Gift (Daily Login Reward) — Mechanics

**Type:** always-on | **Sim category:** Daily Gift | **data_gains category label(s):** `Daily Gift` (= source_details `daily_reward`, `day_1` … `day_7`, `gift`) | **Config sheets:** `c_day`, `c_day_v2` in `NEW_LIVEOPS_CALENDAR_ECO.xlsx` (mirrored as `daily_rewards_old` / `daily_rewards_new` in `1_DAY_NS_TD_5_Segs_V3 (1).xlsx` and, with an older harsher v2 draft, in `1. Rainbow_Maker_Sim.xlsx`)

## What it is

The daily login reward: a 7-day escalating gift cycle claimed via a pop-up at session start. It is the game's most evenly distributed HC source — unlike progression or events it pays low-engagement players nearly as much as grinders (measured per-earner HC is ~65–180 across all segments, vs a 24–40× segment spread for Core). That makes it the "casual lifeline" of the economy, and also why its redesign R is **streak-weighted** rather than a flat ratio: how much of the ladder a player actually sees depends on how many consecutive days they log in.

## Player-facing mechanics (core loop)

- On login the **Daily gift pop-up** is triggered on the landing screen (the general flow in the MVP PDF places it right after the album/season start flows: "Daily gift popup is triggered (if available)", p.33; the PDF also notes work on "changing the order of the daily gift" in the landing-screen/ENS sequence, p.55).
- The player claims **day N of a 7-day ladder**; rewards escalate to a large day-7 payout (100 HC + 120 min Unlimited Lives + an extra item in every variant). The source_details in the data (`day_1` … `day_7`) confirm a 7-day day-indexed cycle.
- **Cycle/streak behaviour (inferred from the sim models, not stated in any doc):** the ladder advances with consecutive daily logins and a missed day breaks the cycle — the earlier sim explicitly models "E[cycle length] = expected days before cycle completes **or breaks**", and the current engine weights day N by P(login streak ≥ N). Whether a broken cycle restarts at day 1 is assumed (modeled that way) but not documented.
- **Five content variants** exist per config (`Variant 1` … `Variant 5`): same 7-day skeleton, different mix of coin days vs booster/Unlimited-Lives days. How a variant is assigned (rotation per cycle, per player, A/B) is not documented anywhere in the repo.
- The current live pop-up carries a "Join a Team for:" section; with the Dream Album MVP this text is removed and the title changes (PDF p.12), and **an envelope (Album card pack) may be added as a daily reward** — "Routine: Daily gifts (Common envelopes) create an automatic morning opening habit" (p.6); the Common envelope (1 snap, mostly 1-star) lists "Daily Gift" as an example source (p.26).

## Reward structure (actual ladders/numbers from configs)

### Effective HC day-ladder (column B of the config sheets — what the sim uses)

| Day | Base (`c_day`) | v2 (`c_day_v2`) | v2/base |
|---|---|---|---|
| 1 | 22 | 12 | 0.545 |
| 2 | 0 | 0 | — |
| 3 | 0 | 0 | — |
| 4 | 27 | 17 | 0.630 |
| 5 | 0 | 0 | — |
| 6 | 33 | 23 | 0.697 |
| 7 | 100 | 100 | 1.000 |
| **Total/cycle** | **182** | **152** | **0.835** |
| **Avg HC/day (7d)** | **26** | **21.71** | |

`c_day_v2` states `% of old = 0.8352`. The ladder is a modeling abstraction over the 5 variants: verified numerically, each nonzero day equals the rounded mean of the coin amounts across the variants that pay coins on that day (e.g. base D1 = mean(20, 25, 20) ≈ 22; v2 D6 = mean(20, 25, 20, 25) ≈ 23), and days where most variants pay boosters instead of coins are set to 0 (D2/D3/D5) — inferred rule, but it reproduces every cell in both sheets.

### Full variant compositions — Base (`c_day`)

Coins / items by day (empty = nothing of that type):

| Variant | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
|---|---|---|---|---|---|---|---|
| V1 | 20 HC | UL Lives 15m | Slingshot ×1 | 25 HC | Shuffle ×1 | 30 HC | 100 HC + UL Lives 120m + UL Red 60m |
| V2 | UL Lives 20m | 25 HC | Slingshot ×1 | 30 HC | Shuffle ×1 | 35 HC | 100 HC + UL Lives 120m + UL Chuck 60m |
| V3 | UL Lives 15m | 20 HC | Slingshot ×1 | 25 HC | Shuffle ×1 | 30 HC | 100 HC + UL Lives 120m + UL Bomb 30m |
| V4 | 25 HC | UL Lives 30m | Shuffle ×1 | Slingshot ×1 | 30 HC | Slingshot ×1 | 100 HC + Comet ×1 + UL Lives 120m |
| V5 | 20 HC | UL Lives 15m | Slingshot ×1 | Shuffle ×1 | UL Lives 60m | 35 HC | 100 HC + Slingshot ×1 + UL Lives 120m |

### Full variant compositions — v2 (`c_day_v2`)

**Only the coin amounts change; every booster/Unlimited-Lives entry is identical to base** (verified cell-by-cell). Coin days:

| Variant | D1 | D2 | D4 | D5 | D6 | D7 |
|---|---|---|---|---|---|---|
| V1 | 20→**10** | — | 25→**15** | — | 30→**20** | 100 (unchanged) |
| V2 | — | 25→**15** | 30→**20** | — | 35→**25** | 100 |
| V3 | — | 20→**10** | 25→**15** | — | 30→**20** | 100 |
| V4 | 25→**15** | — | — | 30→**20** | — | 100 |
| V5 | 20→**10** | — | — | — | 35→**25** | 100 |

Pattern: −10 HC on every pre-day-7 coin day, day 7 untouched.

### Earlier draft of the v2 ladder (`1. Rainbow_Maker_Sim.xlsx` → `daily_rewards_new`)

A harsher, flat draft, superseded by the current v2: effective ladder 10, 0, 0, 10, 0, 10, 100 = **130**/cycle (avg 18.57/day, `% of old = 0.7143`). Every pre-D7 coin day is flattened to 10 HC across all five variants (V1: 10/–/–/10/–/10/100; V2: –/10/–/10/–/10/100; V3: –/10/–/10/–/10/100; V4: 10/–/–/–/10/–/100; V5: 10/–/–/–/–/10/100), with boosters/UL entries unchanged from base. Its `daily_rewards_old` sheet carries the warning: "⚠️ This is the old daily rewards BEFORE NS Test. If NS gets baselined, it would be prudent to update this." By contrast, the `1_DAY_NS_TD_5_Segs_V3 (1).xlsx` daily sheets are value-identical to `c_day`/`c_day_v2` (the current pair).

### Measured anchor (`data_gains`, 33-day window, amount_per_earner, HC)

| Segment | NONPAYER | PAYER |
|---|---|---|
| A. 0 | 94.9 | 95.4 |
| B. 1-9 | 136.0 | 179.4 |
| C. 10-19 | 117.6 | 118.7 |
| D. 20-39 | 106.1 | 98.3 |
| E. 40-99 | 115.3 | 97.6 |
| F. 100+ | 73.3 | 64.8 |

Non-HC measured (B. 1-9 NONPAYER, per earner): Unlimited Lives 114.4 min, UL Bomb 26.1 min, UL Chuck 11.3 min, UL Red 9.0 min, Slingshot 1.57, Shuffle 1.07, Comet 0.21, Chuck 0.0. Note the hump shape: mid segments earn more than 100+ (high-engagement players' HC comes from elsewhere; per-earner daily gift is roughly capped by the ladder itself).

## Base vs v2 (redesign) changes

- **Cycle HC: 182 → 152 (unweighted R = 0.835, −16.5%).**
- The cut is entirely on days 1–6 (−45% on D1, −37% on D4, −30% on D6); **day 7 (100 HC) is untouched** — the redesign back-loads the cycle.
- **All boosters and Unlimited-Lives entries are unchanged** in every variant; only coin quantities were reduced.
- Because D7 is unchanged, the effective nerf is **streak-dependent**: a player who never completes a cycle loses up to ~45% (D1-only: 22→12), while a player who always reaches day 7 loses only 16.5%. Low-streak (typically low-engagement) players take the biggest relative cut — the reason the sim streak-weights R per segment.
- Draft history: base 182 → RM-sim draft 130 (0.714) → shipped v2 config 152 (0.835).

## Resources paid

Of the 11 sim resources: **HC** (coins), **Slingshot**, **Shuffle**, **Comet** (V4 D7 only), **Unlimited Lives**, **UL Red**, **UL Chuck**, **UL Bomb** (variant-specific D7 extras). Never in the config: **Red, Chuck, Bomb** (single-bird boosters) and SPT. Measured data_gains agrees (bird-booster rows ≈0). Post-Album-MVP the gift may additionally contain a Common envelope (not a sim resource).

## Simulation notes (R×D×T mapping, modeling approaches used so far)

- **Model:** `new_per_earner = measured × R × D × T` with **D = T = 1** (always-on). Only R applies, and only to HC.
- **Current engine (`EcoGainsSim.gs` → `simDailyGift`):** reads both 7-value ladders (`readDayLadder_('c_day')` / `('c_day_v2')`); if they differ, computes **streak weights** from `data_seg_beh` login-streak percentiles: a piecewise-linear CDF through (p50, 0.5), (p75, 0.75), (p90, 0.9) gives `w[n] = P(streak ≥ n)` for n = 1..7; then `R = Σ v2[d]·w[d] / Σ base[d]·w[d]` and `HC_sim = HC_measured × R`. Non-HC resources are carried unchanged (correct, since the redesign touches only coins).
- **Earlier sim #1 (NS Economy sim, per `NS_Economy_Sim_Summary.md`):** probabilistic cycle model with independent daily login probability `p = login_days/7`: `E[HC per cycle] = p¹×D1 + p²×D2 + … + p⁷×D7`; `HC/day = E[HC per cycle] / E[cycle length]` where E[cycle length] accounts for the cycle completing or breaking. Captures e.g. that a 6/7-login player has only ~39% chance of claiming the D7 jackpot. Known simplification (stated there): independent daily logins, no weekly patterns or re-engagement.
- **Earlier sim #2 (`1_DAY_NS_TD_5_Segs_V3 (1).xlsx` → `Sim per Segment`):** `dr_new (sim) = daily_rewards_new!$B$13 × data_processed!Y` — i.e. the flat `% of old` (0.8352) times the measured/probabilistic old DR HC/day from `data_processed`. Simpler than the streak-weighted R now used (a flat 0.835 over-credits low-streak segments, whose true ratio is closer to 0.55–0.7).
- Both HAND_OFF and the config diff confirm Daily Gift is one of only two sources (with Core/Saga) where the redesign changed **rewards** rather than duration/cadence — for everything else R = 1.

## Sources

- `NEW_LIVEOPS_CALENDAR_ECO.xlsx` → `c_day`, `c_day_v2` (ladders, 5 variants, totals, avg/day, `% of old`); → `data_gains` (measured per-earner values); → `data_seg_beh` (login-streak percentiles used for weighting).
- `1_DAY_NS_TD_5_Segs_V3 (1).xlsx` → `daily_rewards_old/new` (identical to c_day/c_day_v2), `Sim per Segment` rows 5–18 (`dr new (sim)` formula), `notes`.
- `1. Rainbow_Maker_Sim.xlsx` → `daily_rewards_old/new` (earlier 130-HC v2 draft; "BEFORE NS Test" warning).
- `resource_share_by_category_period_v2.sql` lines 247–248 (`daily_reward`, `day_1`–`day_7`, `gift` → `Daily Gift`).
- `DRBLMVP Dream Album190526105102.pdf` p.6 (daily gifts = Common envelopes, morning habit), p.12 (Daily gift pop-up changes: title, "Join a Team for:" removed, envelope as daily reward), p.26 (Common envelope sourced from Daily Gift), p.33 (pop-up position in the general flow), p.55 (landing-screen order change).
- `HAND_OFF.md` §2, §5 (D=T=1, streak-weighted R); `NS_Economy_Sim_Summary.md` (probabilistic cycle model); `EcoGainsSim.gs` (`simDailyGift`, `reachWeights_`, `readDayLadder_`).

## Gaps & open questions

1. **Cycle reset rule is undocumented.** Does missing a day reset to day 1, pause, or does the cycle restart weekly regardless? All three sims assume streak-gated progression (break ⇒ restart); no design doc confirms it.
2. **Variant assignment is unknown** — rotation order, per-player vs per-cycle, or live A/B of the 5 variants is not described anywhere in the repo. The effective HC ladder's implicit assumption (majority-of-variants) is inferred, though it reproduces the sheet numbers exactly.
3. **The effective-ladder derivation drops minority coin days** (base V2/V3 pay 20–25 HC on D2; V4 pays 30 on D5) — the ladder treats those days as 0. Fine as long as base and v2 are treated symmetrically (they are), but the absolute HC/cycle is variant-dependent (base V1 = 175, V4 = 155 coins actual vs 182 modeled).
4. **Streak-weighting uses login-streak percentiles as a proxy for gift-cycle position** — it assumes claim-streak = login-streak (no missed claims while logged in) and a linearised CDF between percentiles.
5. **The Dream Album envelope addition** (Common envelope in the daily gift) has no economy config yet ("real economy TBD in Economy Design section", PDF p.26) — if it ships, the gift gains a non-sim resource and possibly displaces part of the coin/booster ladder.
6. data_gains `gift` source_detail is folded in — whether it includes non-login gifts (e.g. team gifts, compensation grants) under the same label is unverified.
