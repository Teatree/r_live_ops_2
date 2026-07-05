# Target Day (Archery Arena) — Mechanics

**Type:** milestone/score (SPECIAL) | **Sim category:** Target Day | **Calendar name:** Target Day | **Accrual key:** Target Day (broken for this event) | **Config sheets:** TaD / TaD_v2

> **THIS IS THE SIM'S HIGHEST-PRIORITY BROKEN SOURCE.** Do **not** treat it as a generic collection event. It is a **milestone/SCORE** event: expected reward per instance = Σ over milestones *k* of P(reach *k*) × reward_*k*, where reaching milestone *k* depends on **cumulative score accumulated within the instance duration**. See "Simulation notes."

## What it is

Target Day (internal design name: **Archery Arena**, working narrative name in the design doc: "Target Practice") is a **time-limited competitive event combining a 50-player leaderboard with single-player milestone rewards**, driven by a **score system with a win-streak multiplier**. It was pitched in the 2023H2 strategy explicitly as a clone of **Royal Match's Archery Arena** ("finding key selling points of our competitors and fit them in Dream Blast"), intended for weekends. Technically the design doc calls it "very similar to our Photoshoot-event with the addition of leaderboard while excluding customization" (PDF p.1).

Business intent (PDF p.1): push conversion via Out-Of-Moves (OOM) purchases (a win streak must be maintained to keep the score multiplier, so players buy extra moves rather than lose it), lengthen sessions via milestone rewards (as proven by Rainbow Maker), and raise session counts for competitive players checking their rank.

In the 2026 live-ops calendar it appears as its own row, "**TARGET DAY — Target Day (2.0.0+)??**" — version-gated to client 2.0.0+ and still marked with "??" / "Released" / "ToBeSetup" flags (i.e., tentative), recurring across weeks ~23–29 (June–July 2026).

## Player-facing mechanics (core loop — how score accumulates)

All stated in the design PDF (pp.1–2) unless noted:

1. **Scoring:** each **level win** is worth **1 score point** by default (configurable per difficulty Normal/Hard/Extreme, default **1 / 1 / 1** — confirmed in the TaD config panel `levelDifficultyMultiplier`).
2. **Streak multiplier:** the base point is multiplied by an event-specific **win-streak multiplier** and added automatically to the leaderboard score on every level completion. PDF default: **×1 | ×5 | ×20 | ×100**. The TaD config sheet has a 5-step ladder: **`winStreakMultipliers = 1, 5, 10, 20, 100`** (the live config adds a ×10 step).
3. **Failing a level resets the score multiplier, but NOT the accumulated leaderboard score.** This is the OOM-conversion hook: players spend to keep the ×100 streak alive.
4. **Milestone rewards:** granted automatically once the player visits the event popup and the required cumulative score is reached. Unclaimed rewards are given when the event ends (auto-open popup with milestone-bar animation if rewards are pending).
5. **Leaderboard:** players compete against up to 49 others (default leaderboard size **50**); at event end, rank-based rewards are paid and players receive **medals**. Bots are used to pad boards — TaD config `desiredBotCounts`: easy 9 / medium 6 / hard 3 / extreme 1 (and `data_event_inst` shows `avg_bots` ≈ 0–1 in practice).
6. **Entry gate:** `requiredSagaLevel = 25` (TaD config).
7. After claiming the **final** milestone, the milestone UI disappears and the leaderboard takes its place (PDF p.2) — i.e., the milestone ladder is finite and completable; the leaderboard is the end-game.

## Milestone ladder (full table — the critical section)

### ⚠ Critical config finding first

The **TaD / TaD_v2 sheets contain exactly 20 milestones, and EVERY milestone reward cell is a hard-coded 0** (verified as literal values, not un-cached formulas — all 21 reward columns × 20 rows are `0.0` in both sheets). The workbook config therefore specifies the **score requirements** of the ladder but **no milestone rewards at all**.

This means the HAND_OFF.md statement that Target Day's "rewards sit at **milestones 26+**" is **NOT confirmed — and cannot be confirmed — from any material in this project**: the config ladder stops at milestone 20, and it pays nothing. Either (a) the live game runs a longer, richer ladder (Royal Match's Archery Arena has ~30+ milestones, so 26+ is plausible for the live clone) that was never copied into the TaD sheets, or (b) the "26+" figure came from another artifact (analytics/Redash) not present here. **The sim's Target Day reward stream in this workbook can only come from measured `data_gains`, not from the TaD config ladder.** Flag this discrepancy when fixing the sim.

### Ladder as configured (TaD and TaD_v2 — byte-identical between the two)

`NEW_LIVEOPS_CALENDAR_ECO.xlsx`, sheets TaD/TaD_v2, rows 10–30. "Score req." is the **Total score requirement** column (cumulative). Reward columns (Coins, SPT, SPT×2, Red, Chuck, Bomb, Slingshot, Shuffle, Comet, Unlimited Lives/Red/Chuck/Bomb, COOP Token, Avatar, 1–6-star Dailies) are **all zero on every row** and omitted.

| Milestone | Score req. (cumulative) | Step (visible to player) | Levels needed @ constant ×100 (PDF) | Configured reward |
|---|---|---|---|---|
| 1 | 100 | 100 | 1 | — (all 0) |
| 2 | 300 | 200 | 3 | — |
| 3 | 500 | 200 | 5 | — |
| 4 | 700 | 200 | 7 | — |
| 5 | 2,000 | 1,300 | 20 | — |
| 6 | 3,000 | 1,000 | 30 | — |
| 7 | 4,000 | 1,000 | 40 | — |
| 8 | 5,500 | 1,500 | 55 | — |
| 9 | 7,000 | 1,500 | 70 | — |
| 10 | 8,500 | 1,500 | 85 | — |
| 11 | 10,000 | 1,500 | 100 | — |
| 12 | 11,500 | 1,500 | 115 | — |
| 13 | 13,000 | 1,500 | 130 | — |
| 14 | 14,500 | 1,500 | 145 | — |
| 15 | 16,000 | 1,500 | 160 | — |
| 16 | 17,500 | 1,500 | 175 | — |
| 17 | 19,000 | 1,500 | 190 | — |
| 18 | 20,500 | 1,500 | 205 | — |
| 19 | 22,000 | 1,500 | 220 | — |
| 20 | 23,500 | 1,500 | 235 | — |

The score requirements match the design PDF's "Requirement and reward configurations" table (p.2) exactly. The "Levels needed" column is the PDF's own math assuming a permanently maxed ×100 multiplier; real players cycle the multiplier, so actual level counts are far higher.

### Design-doc suggested rewards (PDF p.2–3 — economy suggestion "based on Royal Match", NOT the live/workbook config)

The PDF proposes this reward mapping for the same 20 milestones ("Amount of Timed boosters adjusted, or removed. Collectible cards replaced with Season Pass tokens"):

| Milestone | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Reward | Red | UL 30 min *(bird type not stated; likely UL Red — inferred)* | 10 SP tokens | Chuck | UL 30 min | Bomb | 20 coins | 20 SP tokens | Slingshot | Chuck |

| Milestone | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|
| Reward | 30 SP tokens | Red | UL 30 min | Chuck | Slingshot | 20 coins | Bomb | Slingshot | Shuffle | Meteor (Comet) |

### Leaderboard rewards (TaD/TaD_v2 rows 34–55 — identical in both; these ARE configured)

| Rank | Reward (workbook config) | PDF suggestion (p.2–3, for reference) |
|---|---|---|
| 1 | **200 Coins + 1 Comet** | Red, Chuck, Bomb, Meteor |
| 2 | **100 Coins + 1 Shuffle** | Chuck, Bomb, Shuffle |
| 3 | **50 Coins + 1 Slingshot** | Bomb, Slingshot |
| 4–5 | 1 Shuffle each | Bomb / Chuck |
| 6–10 | 1 Slingshot each | Red each |
| 11–20 | nothing (all-zero rows) | — |

### How far do real players actually get?

`data_event_inst` `avg_final_token_balance` (token = score for Target Day, measured on the historical ~2-day instance):

| Segment | Nonpayer avg score | Payer avg score | ≈ highest milestone reached (avg) |
|---|---|---|---|
| 0–9 | 178.8 | 153.5 | M1 (100) |
| 10–19 | 746.0 | 685.8 | M4 (700) / M3 |
| 20–39 | 1,606.7 | 1,578.2 | M4 (< 2,000) |
| 40–99 | 3,826.4 | 3,829.1 | M6 (3,000) |
| 100+ | 9,903.8 | 9,900.7 | M10–M11 (8,500–10,000) |

Even the top segment averages only ~milestone 10 of 20 on the measured instance — the tail of the ladder (and any "milestone 26+" live extension) is reachable only with long durations and sustained ×100 streaks. Median leaderboard position (`position_p50`): 9–10 for segment 0–9 shrinking to **1** for 100+ (top segment typically wins its board). Participation rate 0.20→0.47 and opt-in 0.34→0.48 rising with segment.

## Duration & cadence (3×7d → 15×1d; the calendar-vs-data duration mismatch)

**The only base-vs-v2 diff in the entire TaD sheet pair is `EventDuration`: TaD = 7, TaD_v2 = 1.** Everything else (multipliers, bot counts, saga gate, milestone score reqs, all-zero milestone rewards, leaderboard rewards) is identical. So **R = 1** (reward-config ratio unchanged), matching HAND_OFF.

Four different duration claims exist — reconcile before trusting any D factor:

| Source | Duration | Cadence |
|---|---|---|
| `cal_curr` (row 19) | 7d per HAND_OFF / `TaD EventDuration = 7` | **3 instances** in the 33-day window (labels at Wed wk1, Fri wk2, Fri wk4) → **3×7d** |
| `cal_new` (row 19) | 1d (`TaD_v2 EventDuration = 1`) | **15 instances**: Fri+Sat+Sun of all 5 weekends → **15×1d** |
| `data_event_accrual` / `data_event_inst` (measured) | **`instance_length_days = 2`**, `n_instances = 2` in the measured window | ⚠ conflicts with the calendar's 7d |
| Design PDF | default **24h**, "concurring, daily event from Friday to Sunday" | ⚠ matches cal_new, not cal_curr |
| 2026 live calendar PDF | "Target Day (2.0.0+)??" roughly weekly, weeks 23–29 | tentative, version-gated |

So the cadence change is **5× more instances** (3 → 15) while per-instance duration collapses **7d → 1d**. The measured accrual data was captured on **2-day instances** — neither 7d nor 1d — which is one root of the sim breakage (below).

## Resources paid

Target Day's category rows in `data_gains` (measured, 30-day window; segments there use the alternate labels A.0 / B.1-9 / C.10-19 / D.20-39 / E.40-99 / F.100+):

- **HC (coins):** per-*earner* averages are near-zero for low segments and grow steeply with segment: 0.31 → 0.29 (seg 0) → 0.29–0.34 (1-9) → 1.54–1.61 (10-19) → 4.24–4.45 (20-39) → 9.28–10.29 (40-99) → **12.1–13.7 (100+)**. Per-*recipient* HC is large (79–171) but recipient rates are tiny (0.29%–8.2%) — consistent with HC flowing only to leaderboard top-3 placements. This confirms the HAND_OFF note: **Target Day pays ~0 HC to low segments but real boosters.**
- **Boosters:** Slingshot (up to ~0.06/earner, recipient rate up to 5.8%), Shuffle (~0.01–0.06/earner), small Red/Chuck/Bomb counts, Comet (~0.003–0.015/earner in mid segments).
- **Unlimited Lives:** meaningful — 1.6–3.9 **minutes/earner** (recipients get ~31–40 min, i.e., 30-min-class grants), recipient rates 5–10% for segments 1-9 and up.
- Sim resource set (all 11): HC, Slingshot, Shuffle, Comet, Red, Chuck, Bomb, UL Bomb, UL Chuck, UL Red, Unlimited Lives.

Note the tension: the workbook's TaD milestone ladder pays nothing and its leaderboard pays only Coins/Comet/Shuffle/Slingshot, yet measured `data_gains` shows UL minutes and bird boosters being paid — further evidence the **live config differs from the TaD sheets** and that measured `data_gains` is the only reliable reward source here.

## Simulation notes (why the generic model breaks; the score-curve fix plan)

**Established project facts (HAND_OFF.md §5–6) — reflect these, do not re-derive:**

1. **Model class:** milestone/SCORE event (SPECIAL). Expected reward per instance = **Σ_k P(reach milestone k) × reward_k**, where reaching depends on **cumulative score within the instance duration**. Never route it through the generic collection path (`measured × R × D × T`).
2. **The breakage:** per HAND_OFF, rewards sit at high milestones ("26+") requiring huge cumulative score. A 7-day run reaches them; a 1-day run does not. Since the calendar moves **3×7d (cal_curr) → 15×1d (cal_new)**, per-instance reward should **collapse**, offsetting the 5× cadence rise. But the sim's duration factor D is computed from the **token/levels accrual curves, and both saturate at day 1**: `data_event_accrual` for Target Day has `instance_length_days = 2` with `cum_token_share_mean` ≈ **0.92 on day 1** and 1.0 on day 2 (`cum_token_share_p50 = 1.0 already on day 1`). So D = 1, cadence ×5 dominates, and **the sim DOUBLES Target Day instead of shrinking it**. The current sim result is an **upper bound only**.
   - Root cause of the saturation: the accrual data was measured on **2-day instances** while `cal_curr`/TaD claim 7d — the duration mismatch means the curve never observed days 2–7 of a long run.
3. **Fix plan (HAND_OFF §6):** add a **cumulative-SCORE-by-day** column to the accrual query for Target Day (score → which milestone is reachable → summed reward at that reach), then set **`D_TaD = Σ (reward reachable at newDur) ÷ Σ (reward reachable at curDur)`**. Also **reconcile the calendar (7d) vs data (`instance_length = 2`) duration mismatch** before computing either sum. Implement as a bespoke `simTargetDay` (milestone-reach-by-duration), analogous to `simRainbowMaker`'s bottom-up milestone reach.
4. **Extra blocker found while writing this doc:** the fix formula needs a **reward-per-milestone vector**, and the TaD sheets provide none (all zeros, only 20 milestones). Until the real live ladder (the one with rewards at high milestones) is exported, the reward vector must be reconstructed — either from the PDF suggestion table (design intent only), from Royal Match benchmarks, or preferably from a Redash pull of actual per-milestone grants. Alternatively, calibrate the score→reward mapping so that simulated payouts match measured `data_gains` per segment on the 2-day instance, then extrapolate to 1d/7d via the score-by-day curve.
5. **TaD_v2 changed only EventDuration → R = 1** (confirmed byte-identical reward tables). All of the cal_new delta must come through cadence (T) and duration (D) — which is exactly why a correct D is everything for this event.
6. **Analytics context (HAND_OFF):** kite-like engagement amplification; Target Day pays ~0 HC to low segments but real boosters (confirmed in `data_gains` above).

## Sources

- `D:\_projects\r_liveops_2_sim_work\DRBLTarget Day Archery Arena200526070238.pdf` — design doc (5 pp.): why/what/how, scoring & multiplier rules, configurables (24h default, LB size 50, multipliers ×1|×5|×20|×100), 20-milestone score/reward suggestion table, top-10 leaderboard reward suggestion, theming, analytics questions.
- `D:\_projects\r_liveops_2_sim_work\NEW_LIVEOPS_CALENDAR_ECO.xlsx` — sheets **TaD / TaD_v2** (config panel, milestone score reqs ×20 with all-zero rewards, leaderboard rewards ×20, EventDuration 7 vs 1); **cal_curr / cal_new** row 19 (3 vs 15 instances); **data_event_inst** rows 132–141 (participation, final score balances, positions); **data_event_accrual** Target Day rows (instance_length 2, day-1 saturation); **data_gains** category "Target Day" (measured payouts per segment).
- `D:\_projects\r_liveops_2_sim_work\HAND_OFF.md` — §4 table row "Target Day", §5 sim architecture, §6 "THE TWO MILESTONE EVENTS" (breakage + fix plan, "milestones 26+" claim).
- `D:\_projects\r_liveops_2_sim_work\current_live_ops_calendar_2026.pdf` (via `calendar_dump.txt`) — "TARGET DAY / Target Day (2.0.0+)??" row, weeks ~23–29 of 2026.
- `D:\_projects\r_liveops_2_sim_work\1_DAY_NS_TD_5_Segs_V3 (1).xlsx` — **checked and ruled out**: despite "TD" in the filename, it contains **no Target Day content**. It is a Night Sky / Daily Rewards / Saga HC-net simulation (sheets: `Sim per Segment` HC gain/spend regression, `ns_old`/`ns_new`, `daily_rewards_*`, `saga_progression_*`, Redash query notes). The only "Target" hits are "Target Streak %" columns belonging to Night Sky streak modeling. Do not use it as a Target Day source.

## Gaps & open questions

1. **The live milestone ladder with actual rewards is missing.** The TaD sheets have 20 milestones and zero rewards; HAND_OFF says rewards sit at "milestones 26+". **Neither the 26+ milestone count nor any per-milestone reward amounts appear anywhere in the available materials.** Export the live config (or a Redash per-milestone grant distribution) before implementing `simTargetDay`.
2. **Duration truth:** is the "current" instance really 7d (`cal_curr`/TaD config), 2d (measured `data_event_accrual`/`data_event_inst`), or 1d Fri–Sun daily (design PDF)? The fix's D_TaD depends entirely on which is the real curDur.
3. **Score-by-day curve does not exist yet** — the accrual query only has token/levels shares for a 2-day instance. The planned cumulative-SCORE-by-day column must be added and measured on a long (7d) instance to be usable.
4. **Milestone-20 UI rule:** after the final milestone the milestone UI disappears (PDF). If the live ladder really extends past 26, the 20-row workbook table is simply an outdated copy — confirm which version the 2026 "Target Day (2.0.0+)" release runs.
5. **PDF reward suggestions include Season Pass tokens and coins at specific milestones (3, 7, 8, 11, 16)** — if the live ladder resembles this, Target Day is also an SPT source, which the 11-resource sim currently wouldn't capture (SPT columns exist in the sheet but are zero).
6. **UL 30 min at milestones 2/5/13 (PDF):** bird type unspecified in the doc (inferred UL Red at M2 by adjacency). Immaterial until the live ladder is exported.
7. **HC per_recipient ≈ 79–171 in `data_gains`** exceeds the configured max single leaderboard payout (200/100/50) only via multiple wins per 30-day window — consistent, but worth validating that no milestone HC exists in live config (config says milestone coins = 0 everywhere).
