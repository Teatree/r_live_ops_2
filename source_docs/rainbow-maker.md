# Rainbow Maker — Mechanics

**Type:** milestone (matchables) | **Sim category:** Rainbow Maker | **Status:** NEW event (cal_new only) | **Config/ladder sheets:** RM (live workbook); milestone_3day_new / milestone_4day_new (RM sim workbook)

## What it is

Rainbow Maker is a single-player **milestone progression event**: players accumulate "matchables" (bubbles popped by matches and explosions during normal level play) toward a ladder of 30 cumulative milestones, each paying a reward (coins, boosters, timed unlimited items, with every third milestone from M6 a chest). It is a Rovio design ("Rainbow Maker (Milestone Event)", GDD dated May–Jun 2024, PDF p.1–2) intended as a **new low-intrusion lane in the LiveOps calendar**.

Design hypothesis (PDF p.2–3, stated): "by introducing a seamless, frequent progression event with multiple variations that engage players daily with new challenges, we can create a new lane in LiveOps calendar which can steadily, permanently increase level wins → monetisation opportunities → ARPDAU by 5%" — targeted at "power & achiever players". Motivation (PDF p.3, stated): players lack frequent single-player progression goals; most events progress only on level wins with no in-core actions counting; RM progresses **inside the core loop with no mandatory pop-ups** (the only auto-opening popup is the one-time FTUE infographic).

It is **NOT in the current live calendar** (absent from cal_curr); it appears only in the redesigned calendar (cal_new), so there is no measured live anchor for its economy.

## Player-facing mechanics (core loop)

From PDF pp.4–6 (Feature Breakdown / Flow), all stated:

1. **Event start:** event popup shows what to collect; a one-time infographic tutorial auto-opens (no close button first time). Tapping the progression bar or grand prize opens the milestone progression popup listing all milestones. A meta-screen badge with a progress bar appears. The event can be triggered after 1 level played, so players may already have progress (PDF p.14, Q&A #1).
2. **In level:** a small `+{bubblecount}` tooltip appears whenever the player collects matchables via **matches or explosions** ({bubblecount} = matchables collected with that move). Chain-reaction arcade-style score tooltips are a nice-to-have. Note (PDF p.6): the core game cannot require a single matchable colour or mechanic (colour gaps of 9–10 levels exist), so RM counts *all* matchables.
3. **Level fail — loss aversion:** a loss-aversion screen warns that "the collected pieces from this level will be lost if the level is not completed" (PDF pp.4–5) — i.e. matchables collected in a level only bank on a **level win** (inferred from the loss-aversion copy). This screen has low priority (above Season Pass only, below all other events).
4. **Level win:** Level Complete popup shows pieces collected; back in meta the progress bar animates under the badge (1–2 s), replays whenever the player returns to meta, and glows at a configurable 80% fill.
5. **Milestone claiming:** rewards are **auto-granted, no claim button** — a single reward plays a "flying token" animation; a chest milestone shows the usual chest overlay; if multiple milestones are crossed in one level the reward cycle repeats per milestone (PDF pp.5–6, 10).
6. **Offline behaviour** (PDF p.13): must be online to receive/start the event; can progress and collect rewards offline.
7. **Beacon-configurable** (PDF pp.13–14): number of milestones, per-milestone requirements, rewards (>1 prize per milestone allowed), glow threshold %, dynamic segmentation via game parameters. Dynamic segmentation (requirements re-tuned mid-event using EventTimeLeft, grand prize aimed at top 0.1%) is a stretch-goal A/B idea only (PDF p.13).
8. **Future variations** (PDF p.12, not in scope): create birds, collect moves left, collect specific mechanics, destroy pieces. Future improvements (p.14): 2× doubler reward, timed rewards, rainbow trail.

The PDF's Economy Design section is only an external link ("Click here", PDF p.13) — the actual requirements/rewards live in the workbooks below.

## Milestone ladder (actual Req Accum + rewards)

The ladder the live engine reads (**NEW_LIVEOPS_CALENDAR_ECO.xlsx → sheet RM**, `EventDuration = 4.0`) is **identical row-for-row to `milestone_4day_new`** in the RM sim workbook (verified: all 30 Matchables Req, Req Accum, Chest flags and rewards match). The RM sheet also carries empty columns (SPT, SPT x2, Unlimited Bomb, COOP Token, Avatar, star-Dly) that are never populated for this event.

**4-day ladder (live config = RM sheet = milestone_4day_new):**

| M | Matchables Req | Req Accum | Chest | Reward | Reward HC value |
|---|---|---|---|---|---|
| 1 | 160 | 160 | – | 1 Red | 33.3 |
| 2 | 300 | 460 | – | 10 Coins | 10 |
| 3 | 1,000 | 1,460 | – | 1 Chuck | 50 |
| 4 | 250 | 1,710 | – | 15 min Unlimited Lives | 31.25 |
| 5 | 500 | 2,210 | – | 1 Bomb | 66.7 |
| 6 | 1,600 | 3,810 | CHEST | 1 Chuck + 1 Slingshot | 100 |
| 7 | 500 | 4,310 | – | 1 Red | 33.3 |
| 8 | 1,000 | 5,310 | – | 1 Chuck | 50 |
| 9 | 3,300 | 8,610 | CHEST | 20 Coins + 1 Slingshot | 70 |
| 10 | 1,100 | 9,710 | – | 30 min Unlimited Lives | 62.5 |
| 11 | 2,200 | 11,910 | – | 1 Shuffle | 50* |
| 12 | 6,500 | 18,410 | CHEST | 35 Coins + 1 Shuffle | 101.7 |
| 13 | 2,200 | 20,610 | – | 10 min Unlimited Red | 73.8 |
| 14 | 4,400 | 25,010 | – | 2 Red | 66.7 |
| 15 | 13,250 | 38,260 | CHEST | 1 Chuck + 1 Comet | 216.7 |
| 16 | 3,300 | 41,560 | – | 1 Bomb | 66.7 |
| 17 | 6,500 | 48,060 | – | 2 Slingshot | 100 |
| 18 | 19,750 | 67,810 | CHEST | 50 Coins + 2 Shuffle | 183.3 |
| 19 | 4,200 | 72,010 | – | 60 min Unlimited Lives | 125 |
| 20 | 8,250 | 80,260 | – | 2 Red | 66.7 |
| 21 | 22,000 | 102,260 | CHEST | 2 Slingshot + 2 Comet | 433.3 |
| 22 | 6,000 | 108,260 | – | 10 min Unlimited Chuck | 76.2 |
| 23 | 10,500 | 118,760 | – | 2 Chuck | 100 |
| 24 | 33,000 | 151,760 | CHEST | 100 Coins + 2 Slingshot + 2 Shuffle + 2 Comet | 666.7 |
| 25 | 8,750 | 160,510 | – | 60 min Unlimited Lives | 125 |
| 26 | 14,250 | 174,760 | – | 2 Bomb | 133.3 |
| 27 | 44,000 | 218,760 | CHEST | 250 Coins + 3 Slingshot + 3 Shuffle + 3 Comet + 20 min UL Lives | 1,255.7 |
| 28 | 16,500 | 235,260 | – | 60 min Unlimited Lives | 125 |
| 29 | 34,000 | 269,260 | – | 3 Bomb | 200 |
| 30 | 83,000 | 352,260 | CHEST | 1,000 Coins + 4 Slingshot + 4 Shuffle + 4 Comet | 2,133.3 |

Total ladder value: **6,806.1 HC-equivalent** (Cum HC value col, milestone_4day_new). Total coins if fully cleared: **1,465 HC** (M2 10, M9 20, M12 35, M18 50, M24 100, M27 250, M30 1,000). Chests sit at M6 and every 3rd milestone after (6, 9, 12, 15, 18, 21, 24, 27, 30). *Note: the workbook's per-milestone "Reward HC value" prices M11's single Shuffle at 50 rather than the item_vals 66.7 — minor internal inconsistency in the sheet.

**3-day variant (milestone_3day_new)** — same 30-milestone shape and mostly the same rewards, but lower requirements and slightly smaller top rewards. Requirement differences (Req Accum): 130/380/1,230/1,430/1,880/3,180/3,630/4,450/7,750/8,850/11,050/17,550/19,750/24,050/37,050/40,350/45,850/62,100/65,900/72,900/92,400/97,300/106,050/128,050/133,550/141,760/190,760/203,010/225,010/292,010. Reward differences vs 4-day: M9 = 20 Coins + 1 **Bomb** (not Slingshot); M17 = 2 **Shuffle**... (3-day M17 pays 2 Slingshot valued 100 — identical); the material differences are M24 = 1× (not 2×) Slingshot/Shuffle/Comet + 100 Coins, M27 = 2× (not 3×) + 250 Coins + 20 min UL Lives, M30 = 3× (not 4×) + 1,000 Coins. Total 3-day ladder value: **5,972.8 HC-equivalent**. The live calendar uses the 4-day config; the 3-day config exists in the sim workbook as an alternative duration scenario.

## Duration & cadence

- **EventDuration = 4 days** (RM sheet Config Panel, stated).
- **cal_new:** 5 instances in the ~30-day redesigned calendar month, starting on day 1 (a Wednesday) and days 6, 13, 20, 27 (Mondays) — read from the cal_new grid, row "Rainbow Maker". Per HAND_OFF, this is **5×4d instances, one clipped** by the calendar window edge (the day-27 start).
- **cal_curr:** absent — no live instances, hence no measured anchor.

## Segment reach (matchables per segment → milestone reached)

Matchables p50 per (segment, payer) comes from **Sim Per Segment** in the RM sim workbook (underlying telemetry in data_raw_3_day / data_raw_4_day: `p50_matchables_window` per `avg_completions_7d_bucket`; the "A. 0" completions bucket is excluded — sheet header "0 players excluded"). Segments are 7-day level-completions buckets.

| Segment | NP p50 (3d) | NP p50 (4d) | P p50 (3d) | P p50 (4d) |
|---|---|---|---|---|
| 0-9 | 3,935 | 4,553 | 4,410 | 5,438 |
| 10-19 | 15,214 | 19,134 | 15,870 | 20,371 |
| 20-39 | 30,450 | 38,620 | 30,740 | 38,625 |
| 40-99 | 67,452 | 83,292 | 65,920 | 83,537 |
| 100+ | 127,482 | 139,889 | 138,432 | 157,274 |

Highest milestone whose Req Accum ≤ p50, against the **4-day ladder the engine reads**:

| Segment | Engine map (3-day p50) NP / P | If 4-day p50 used NP / P |
|---|---|---|
| 0-9 | M6 / M7 | M7 / M8 |
| 10-19 | M11 / M11 | M12 / M12 |
| 20-39 | M14 / M14 | M15 / M15 |
| 40-99 | M17 / M17 | M20 / M20 |
| 100+ | M23 / M23 | M23 / M24 |

HAND_OFF's quoted engine fallback map (0-9 NONPAYER = 3,935 … 100+ NONPAYER = 127,482) matches the **3-day** section of Sim Per Segment, and its stated results (0-9 → milestone 6, +37 HC; 100+ → milestone 23, +333 HC) are consistent with those 3-day p50s applied to the 4-day ladder (0-9: 3,935 ≥ 3,810 = M6; 100+: 127,482 ≥ 118,760 = M23). **Inferred mismatch flag:** the live ladder is the 4-day config, so the 4-day p50 column is arguably the right input — it moves mid segments up 1–3 milestones (e.g. NP 40-99 M17 → M20, adding 50 HC coins per instance). See Gaps.

For context, the workbook's own measured %-reach curves (data_raw, 4-day window) put NP 0-9 at 55.6% reaching M6, and NP 100+ at 58.7% reaching M23 — the p50-threshold method and the reach curves are two views of the same distributions.

## Resources paid

Ladder pays 10 of the project's 11 RM resources (HC = Coins):

- **HC (Coins):** M2, M9, M12, M18, M24, M27, M30 (10/20/35/50/100/250/1,000).
- **Red:** M1, M7, M14, M20. **Chuck:** M3, M6, M8, M15, M23. **Bomb:** M5, M16, M26, M29.
- **Slingshot:** M6, M9, M17, M21, M24, M27, M30. **Shuffle:** M11, M12, M18, M24, M27, M30. **Comet:** M15, M21, M24, M27, M30.
- **Unlimited Lives (min):** M4 (15), M10 (30), M19/M25/M28 (60), M27 (20). **Unlimited Red:** M13 (10 min). **Unlimited Chuck:** M22 (10 min).
- **UL Bomb:** column exists in both ladder sheets and in the 11-resource sim list but is **never awarded** by either ladder (stated: all rows empty).

Item HC-equivalents (item_vals sheet): Coin 1, SPT 0.638, Red 33.33, Chuck 50, Bomb 66.67, Slingshot 50, Shuffle 66.67, Comet 166.67, Unlimited Lives 2.083/min, UL Red 7.38/min, UL Chuck 7.62/min, UL Bomb 7.78/min.

## Simulation notes

**Why bottom-up:** RM is NEW in cal_new (5×4d instances, one clipped; absent from cal_curr), so there is no measured per-instance gain to anchor on. The project engine therefore simulates it bottom-up:

```
per_instance[res] = Σ over milestones k with ReqAccum[k] ≤ matchables_p50(segment, payer) of reward_k[res]
RM[res]          = per_instance[res] × nEff,   nEff = Σ reach over the 5 cal_new instances
```

matchables_p50 per (segment, payer) comes from "1. Rainbow_Maker_Sim.xlsx" → Sim Per Segment. The engine looks for an `RM_matchables` sheet in the calendar workbook first and falls back to a built-in map (no such sheet exists in NEW_LIVEOPS_CALENDAR_ECO.xlsx — confirmed against its sheet list — so the fallback is live; TODO stands to move it to a sheet). Results so far: 0-9 reaches milestone 6 (+37 HC), 100+ reaches milestone 23 (+333 HC) — i.e. per-instance coins of 10 and 115 scaled by segment nEff (≈3.7 and ≈2.9 respectively, inferred).

**FLAGGED ASSUMPTION (per-instance vs per-window):** the engine treats matchables_p50 as **PER-INSTANCE**; if the telemetry window is actually longer than one instance, divide by nEff. Evidence from the workbook leans per-instance: data_raw columns are named `*_matchables_window` with `avg_active_days_window` ≈ 1.8–2.9 (≤ the 3/4-day event length), and the workbook maintains separate 3-day and 4-day raw tables — consistent with matchables measured over a single 3-day / 4-day window equal to one event instance (inferred, not conclusively verified).

**How the RM sim workbook itself works** (structure-derived, inferred):

1. **data_raw_3_day / data_raw_4_day** — telemetry per population (Non-payer/Payer) × completions bucket (0, 1-9, 10-19, 20-39, 40-99, 100+): players, matchables percentiles (p10–p90) over a 3-/4-day window, avg levels, matchables/level (~510–585), HC gain split (saga, daily gift, other), HC spend/net, per-participant-day HC from four existing low-intensity events (Hatchling Hideaway, Bomb's Ballet, Photoshoot, Jigsaw), and `pct_reach_m01..m30` = share of the bucket whose window matchables ≥ each Req Accum.
2. **milestone_3day_new / milestone_4day_new** — the ladder designs, each with: per-milestone reward HC value and cumulative value (via item_vals); an "HC spend est" block (estimated cumulative HC spent grinding to that milestone, per npu/pu × bucket) and a "Net" block (reward value minus spend — deeply negative for most segments at mid ladder, i.e. the ladder is a monetisation driver, not a net faucet); "Suggested Matchables Req/Accum" tuning columns; and PAU 100+ p25/p50/p75/p90 %-reach checks.
3. **Sim Per Segment** — the integration sheet (one block per duration): current HC gain/spend/net per segment from data, the M1–M30 reach curves, then the SIMULATED columns: `saga new (sim)`, `daily new (sim)` (nerfed saga/daily configs from saga_progression_old→new and daily_rewards_old→new, e.g. daily cycle 182→130 HC, saga node HC 15-25→0-10), and **Milestone Coins (sim)** = expected RM coins = Σ_k reach%_k × coins_k (probability-weighted over the measured reach curve, e.g. NP 0-9 4-day = 19.2 HC — note this differs from the engine's p50-threshold method). It then compares `sim gain on-top` vs `sim gain without` (RM replacing the low-intensity-events average) against unchanged spend to produce net-HC deltas per segment.
4. **Sim_Progression_p25/p50/p75** — for the p25/p50/p75 player of each segment, which event day (D1–D3 or D1–D4) each milestone is reached and the running net HC at that point ("X" = never reached); e.g. p50 NP 0-9 tops out at M6 on D4 (4-day), NP 100+ at M23 on D4.

**nEff:** reach per instance across the 5 cal_new instances comes from the project's standard event-reach model (HAND_OFF); RM per-instance rewards are multiplied by that sum.

## Sources

- **PDF** "DRBLRainbow Maker Milestone Event090626080933.pdf": p.1 title/team; p.2 changelog/status + hypothesis; p.3 goals, WHAT/WHY, ARPDAU +5%, target audience, problems/opportunities; pp.4–6 flow (matchable collection, +{bubblecount} tooltip, loss aversion, progress bar, auto-claim/chest overlay, no single-colour requirement); p.7–9 mockups (multi-reward milestones, chest tooltip); p.10 reward animation flows; p.12 future variations; p.13 economy-design external link, analytics, dynamic segmentation A/B, offline behaviour; pp.13–14 Beacon configurables, future improvements; pp.14–15 Q&A (trigger after 1 level, dynamic segmentation feasibility).
- **1. Rainbow_Maker_Sim.xlsx**: milestone_3day_new / milestone_4day_new (ladders, HC values, spend/net, PAU reach); Sim Per Segment (p50 matchables, reach curves, Milestone Coins sim, on-top/without deltas); Sim_Progression_p25/p50/p75 (day-of-reach); data_raw_3_day / data_raw_4_day (telemetry); daily_rewards_old/new, saga_progression_old/new (companion nerf configs); item_vals (HC-equivalents).
- **NEW_LIVEOPS_CALENDAR_ECO.xlsx**: sheet RM (EventDuration 4.0 + live 30-milestone ladder — verified identical to milestone_4day_new); sheet cal_new (5 RM instances, start days 1/6/13/20/27); sheet list (no RM_matchables sheet).
- **HAND_OFF.md**: bottom-up method, nEff, engine fallback map, current results, per-instance/per-window flag, 11-resource list.

## Gaps & open questions

1. **Per-instance vs per-window (HAND_OFF flag, still open):** matchables_p50 is treated as per-instance. Workbook column naming (`*_matchables_window`, separate 3d/4d tables) supports this, but it is not conclusively verified; if per-window, divide by nEff.
2. **3-day p50 fed to a 4-day ladder:** the engine's fallback map values (3,935…127,482) are the **3-day** window p50s, while the live RM ladder is the 4-day config. Using the 4-day p50 column (4,553…157,274) moves NP 0-9 M6→M7, mid segments up 1–3 milestones (NP 40-99 M17→M20), and P 100+ M23→M24. Decide which window matches the live 4-day instances (4-day column looks correct) and update the map / future RM_matchables sheet accordingly.
3. **p50-threshold vs expectation:** the engine takes the p50 player's milestone; the workbook's own "Milestone Coins (sim)" is the reach-curve expectation. These differ (e.g. NP 0-9: 10 HC per instance at p50 vs 19.2 HC expected) — the current sim understates coins for skewed segments.
4. **nEff values per segment** are taken from the project reach model; the exact per-instance reach used for the ×3.7 / ×2.9 multipliers (inferred) is not documented here — confirm against the engine.
5. **Clipped 5th instance:** the day-27 start is flagged clipped in HAND_OFF; confirm how the engine prorates a clipped RM instance (fewer active days → lower matchables), since p50 assumes a full 4-day window.
6. **UL Bomb** is in the 11-resource list and both ladder sheets but never awarded — harmless, but the resource can be dropped from RM output or kept at 0.
7. **Economy source of record:** the PDF's Economy Design is an external link; the workbooks are the only in-repo numbers. If Beacon config diverges from the RM sheet at launch (milestone count/reqs/rewards are all Beacon-tunable, and dynamic segmentation could change reqs mid-event), the sim ladder must be refreshed.
8. **Loss-aversion effect on telemetry:** matchables bank only on level wins (inferred from PDF loss-aversion copy), but data_raw matchables were measured before the event exists — if they count matchables from *all* levels (including fails), p50 slightly overstates event progress.
9. **Segment scheme mismatch:** data uses completions buckets 0/1-9/10-19/20-39/40-99/100+ with the "0" bucket excluded from Sim Per Segment; confirm the mapping to the project's 0-9…100+ (segment, payer) scheme treats 0-completions players as non-participants rather than folding them into 0-9.
10. **daily/saga old-vs-new caveat:** the workbook warns its OLD daily/saga configs predate the NS test — if NS is baselined those comparison columns (not the RM ladder itself) are stale.
