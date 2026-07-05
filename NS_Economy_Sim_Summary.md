Night Sky Event — Mechanics & Economy Simulation Summary
What is Night Sky?
Night Sky (NS) is a daily streak-based event in Gymnastics Dream (match-3 mobile game). It runs alongside Core Progression (Daily Rewards + Saga) as a secondary source of Hard Currency (HC). NS resets every day — players start fresh each morning.
How Night Sky Works
Structure
NS has 5 Rounds, played sequentially. Each round has:

A Mid (shared) path — a few mandatory milestones everyone hits first
A crossroad where the player picks Left or Right
Branch milestones along the chosen path

Left path is shorter/easier with smaller HC rewards. Right path is longer/harder with bigger HC rewards.
Milestone Progression
Each milestone has a streak requirement — a number of consecutive level wins the player must achieve in a single unbroken streak.

Player starts Round 1, Mid path
They play match-3 levels. Each win extends their current streak. Each fail resets it to 0
When their streak reaches a milestone's requirement, they claim it and the streak counter resets for the next milestone
After clearing Mid milestones, they pick Left or Right at the crossroad
Clear all branch milestones → advance to next Round
Repeat for Rounds 1–5

HC Rewards
Not every milestone awards HC — many are progression-only (0 HC). HC rewards are placed at specific milestones, generally deeper in each round. The streak requirements escalate dramatically across rounds:

Round 1: Streak reqs ~2–11 (accessible to most active players)
Round 2: Streak reqs ~7–49
Round 3: Streak reqs ~8–84
Round 4: Streak reqs ~13–197
Round 5: Streak reqs ~17–370 (only reachable by extreme players)

Daily Reset
NS resets completely each day. Progress doesn't carry over. A player who reached Round 3 yesterday starts at Round 1 again today. This means NS HC income is a daily rate, not cumulative.

What the Simulation Does
The simulation models the HC economy under two scenarios:

BEFORE (OLD): Only Core Progression (Daily Rewards + Saga) — NS doesn't exist
AFTER (NEW): Reduced Core Progression + Night Sky as a new HC source

The goal is to truthfully answer: "What happens to HC income across the player population when we cut Core rewards and add NS?"
Spreadsheet Architecture
SheetPurposeMainSimulation hub. Select engagement group, streak percentile, payer type → see 7-day cumulative tables (OLD vs NEW), comparison, and population overviewdaily_rewards_old/new7-day login reward cycle configs. D1 and D7 have HC; D2–D6 are 0saga_progression_old/new10-node repeating saga cycle. HC per node varies (12–30 HC)ns_old / ns_newFull milestone tables for NS — every round, every path, streak requirements and HC rewardsns_calcHelper sheet that lays out NS milestones sequentially (Mid→Left, Mid→Right) with formulas referencing ns_new. Used by streak_data SUMPRODUCT formulasengagement_data18 engagement groups (by levels/day). Real DAU data, login frequency, path preference, probabilistic DR HC/day formulas. Payer columns (PAU, Revenue, PAU-specific login/path/DR)streak_dataStreak distributions per engagement group (avg, P25, P50, P75, P90, max). NS HC formulas for each percentile × pathstreak_data_pauSame as streak_data but for payers (separate streak profiles)
Three Selectors in Main

Engagement Group (e.g., "30-39") — which player type to simulate
Streak Percentile (P25/P50/P75/P90) — which streak assumption to use for NS reachability
Payers / Non-Payers (Payers/Non-Payers/Both) — switches all data sources between all-player and payer-specific


How Each HC Source is Calculated
Daily Rewards HC
Probabilistic cycle model. Given login probability p = login_days/7:

E[HC per cycle] = p¹×D1 + p²×D2 + ... + p⁷×D7
E[cycle length] = expected days before cycle completes or breaks
HC/day = E[HC per cycle] / E[cycle length]

This captures that a player with 6/7 login has a ~39% chance of completing the full 7-day cycle (and claiming the big D7 reward), rather than naively assuming they always miss it.
Saga Progression HC
Deterministic from levels/day. Levels per day ÷ 10 = nodes claimed per day. Each node awards HC from a repeating 10-node table (using MOD to cycle). Cumulative tables use SUMPRODUCT with INDEX/MOD to sum node rewards across multiple cycles.
Night Sky HC
SUMPRODUCT formula per engagement group per percentile:
=SUMPRODUCT((streak_req_array <= player_streak_percentile) * hc_reward_array)
For each milestone in the full sequential path (Mid→Left or Mid→Right across all 5 rounds): if the milestone's streak requirement ≤ the player's streak at the chosen percentile, they earn that milestone's HC. Sum everything up = expected NS HC per day for that path.
Left and Right HC are calculated separately, then blended by the group's path preference (e.g., 45% Right → 0.55 × Left_HC + 0.45 × Right_HC).

Key Findings from the Simulation

Bottom-heavy DAU distribution: ~65% of DAU is in the 0–29 levels/day groups. These players have very short streaks and earn minimal NS HC even with optimistic percentile assumptions.
NS accessibility is gated by streak requirements: The first HC-rewarding milestone requires a streak of 6 (after config revision to lower streaks from original 13). Groups with P50 streaks below 6 earn nothing from NS.
Population-weighted NS HC is far below target: Even with P90 streaks, the DAU-weighted NS income was ~8 HC/day vs the ~21 HC/day target needed for a 50/50 Core/NS split. The mismatch is structural — too many players can't reach HC milestones.
Payer dimension matters: Payers likely have longer streaks (from booster usage) and higher login rates, meaning the Core nerf + NS addition may affect payers and non-payers very differently. The simulation supports separate analysis via the Payers/Non-Payers selector and dedicated payer streak/engagement data.


Known Simplifications

NS formula treats milestones independently — doesn't track cumulative level budget drain across milestones within a day
Uses a single percentile as a hard threshold — in reality, players sometimes exceed their P75 and sometimes fall short
No variance in levels/day — every active day uses the group average
DR model assumes independent daily login probability — doesn't capture weekly patterns or re-engagement after breaks
"Both" and "Non-Payers" currently return the same data — non-payer specific values require backing out from (all × DAU - payer × PAU) / (DAU - PAU), not yet implemented