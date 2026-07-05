# River Rush — Mechanics

**Type:** streak-based competitive (race/scarcity) | **Sim category:** River Rush (carried stub) | **Config sheets:** RR / RR_v2 (identical)

## What it is

River Rush is Angry Birds Dream Blast's streak-based competitive event ("River Rush Bots and Improvements — H2/2024", shipped/live per the design doc status). Players race 4 other players across a river of stones; every stone is one match-3 level, and rewards are scarcity-driven — the first player to finish a round picks first from the round's reward pool, and later finishers pick from what remains.

Design hypothesis (stated in the PDF, p.2): *"We believe that introducing a streak-based competitive event with an engaging narrative, and adding a new scarcity element, we can increase the ARPDAU by at least 10% for our target player persona, highly competitive players that has spent at least once."*

Business rationale (stated, p.4): win streak is a proven high-performing/monetising event archetype; the round structure and escalating rewards drive retention; scarcity + reward agency ("choose their preferred rewards") is the novelty element. The event is billed internally as "fresh and infinite content" — with round cycling it never truly ends.

Calendar role: the **"Weekly High Intensity"** slot — one 7-day River Rush instance every week (current LiveOps calendar, all dumped weeks). The 2026 calendar-redesign deck proposes reskinning it as **"Lava Quest"** (Royal Match's Lava Quest is the explicit reference in the PDF, p.16) and moving it to a daily weekend cadence (Fri–Sun) alongside Target Day, Chuck's Flash Race and Kite Festival — River Rush covering the "social race + win streak" motivation in that lineup.

## Player-facing mechanics (core loop)

All stated in the PDF (pp.4–5, 17–19) unless marked inferred.

1. **Join** — event badge on the meta screen; welcome popup ("Be the first to cross the river to grab the best prize!" / CTA "Join"). From client v1.74 an `optInEnabled` beacon flag controls whether joining is automatic or opt-in.
2. **Matchmaking** — player is grouped with **5 players per round (hard-coded, explicitly not configurable** — chosen for readability and competition feel, and because rewards scale with player count; design Q&A, pp.18–19). Matchmaking takes **~30–45 s** (same system as Chuck's Flash Race); dummy/fake avatars are shown while the round-start animation runs. If no real players are available, **ghost opponents** replay real-player behaviour; the server can also fill slots with **bots** (`botsEnabled`, with per-difficulty desired counts — Easy 1 / Medium 1 / Hard 1 / Extreme 1 / Any 0, where "Any" picks a random ghost regardless of skillPercentile).
3. **Race** — all 5 start the round simultaneously. Win a level → your avatar jumps to the next stone (+1 crocodile token; token count = levels won so far in the round). Optional **variable rewards** can sit on specific stones — the *first* player to land on that stone gets the reward automatically (beacon on/off, flagged "nice to have").
4. **Fail** — fail a level → avatar falls into the river (crocodiles approach, Red rescues you), **all round progress is lost**, and you restart the *same* round from stone 1 **with a new set of competitors** (fresh matchmaking). The out-of-moves popup leans on this loss aversion: "If you leave now, you'll lose all your progress in River Rush!"
5. **Finish & pick** — reach the final (reward) stone → "You made it!" → reward-picking popup showing all 5 bundles in a grid, taken bundles greyed out with the claimer's avatar ("[Player's name] has already claimed this prize"). **First come, first served:** 1st finisher picks from all 5 bundles, 2nd from the remaining 4, … 5th takes the last one.
6. **Next round** — new round starts with new matchmaking; requirements escalate.
7. **Cycling** — after the last round the event loops back to the round flagged as `loopbackPoint` (`cycleRounds` must be true because the client does not end the event when all rounds are done). In the live config the loop restarts at **round 10**, so rounds 10–15 repeat indefinitely for the rest of the event.

**Edge case (stated, p.16):** the server only learns a player's choice after they claim, so two players finishing near-simultaneously can select the *same* bundle. In that case remaining players get one extra bundle to choose from ("can be perceived as a variable reward so it might benefit the results").

**Offline behaviour (stated, p.17):** offline at app start → no event badge; offline while playing → token shown on level-complete but no event progression; offline while picking → the pick may collide with server state (reward may still be considered available).

**Reduced-reward mode (stated, p.18):** `rewardCandidates` should normally hold 5 bundles, but the event also works with just 3 — in that case players finishing after the bundles run out **lose the round**.

## Round structure & level requirements (table)

From the RR sheet config panel: `numberOfRounds` = 15, `groupSize` = 5, `cycleRounds` = TRUE, `loopbackPoint` = 10, `firstPeakLastRound` = 4. Computed: **Total levels = 185** (full first run), **Levels during loop = 87** (rounds 10–15 per cycle), **Levels until 1st peak = 36**.

| Round | Level Req (win streak) | Cumulative | Phase |
|---|---|---|---|
| 1 | 5 | 5 | Warm-up (escalates to first peak at R4) |
| 2 | 6 | 11 | Warm-up |
| 3 | 10 | 21 | Warm-up |
| 4 | 15 | 36 | **First peak** |
| 5 | 8 | 44 | Reset, build to mid-game climax |
| 6 | 10 | 54 | Build |
| 7 | 12 | 66 | Build |
| 8 | 15 | 81 | Build |
| 9 | 17 | 98 | Mid-game climax; last one-time round |
| 10 | 8 | 106 | **Loop start** (loopbackPoint) — difficulty resets |
| 11 | 10 | 116 | Loop builds |
| 12 | 12 | 128 | Loop builds |
| 13 | 15 | 143 | Loop builds |
| 14 | 17 | 160 | Loop builds |
| 15 | 25 | 185 | **Loop end** — longest round, biggest rewards, then cycles back to R10 |

The Level Req sequence is 5, 6, 10, 15 | 8, 10, 12, 15, 17 | 8 | 10, 12, 15, 17 | 25. A player who never fails plays 185 levels to complete rounds 1–15, then 87 levels per 10→15 loop cycle thereafter. Failures restart the current round, so realized levels-per-round is a multiple of Level Req depending on win rate (inferred).

Note a config discrepancy: the beacon documentation warns "do not use values smaller than 6 since layout of rocks will break when there are not enough rocks," yet Round 1 in the live config uses Level Req = 5 (see Gaps).

## Reward structure (per-place scarcity picking; key bundles)

Rewards are **per finishing place, not summed**: a player finishing 3rd in a round gets only the 3rd-place bundle for that round. A bundle can contain multiple items. Bundle *position* here is by sheet convention (1st = first row of the round); in play the order of *picking* is finish order, and a fast finisher may of course pick any remaining bundle — the sheet's place labels represent the intended value ranking (stated in prior verified context; pick-freedom is stated in the PDF).

Full 75-bundle table (15 rounds × 5 places) from the RR sheet, compacted to non-zero items. Unlimited-item and Unlimited Lives amounts are minutes of the timed booster (inferred — standard ABDB convention); Coins = hard currency (HC); SPT = Strong Power Token, SPT x2 = its double-value variant; Red/Chuck/Bomb/Slingshot/Shuffle/Comet are single-use boosters (counts).

| Round | 1st | 2nd | 3rd | 4th | 5th |
|---|---|---|---|---|---|
| 1 | Coins 30 | Unl. Lives 15 | Bomb 1 | Shuffle 1 | Unl. Chuck 10 |
| 2 | Unl. Lives 15 | Comet 1 | Chuck 1 | Unl. Red 10 | SPT x2 10 |
| 3 | Unl. Bomb 20 | Shuffle 1 | Unl. Chuck 10 | Red 1 | SPT 20 |
| 4 | Coins 55 + Red 1 | Unl. Lives 20 | Comet 1 | Chuck 1 | Unl. Red 15 |
| 5 | Shuffle 1 | Unl. Chuck 10 | Chuck 1 | Unl. Red 10 | Red 1 |
| 6 | Coins 50 | Unl. Lives 15 | Bomb 1 | Shuffle 1 | SPT x2 15 |
| 7 | Slingshot 1 | Unl. Red 15 | Red 1 | SPT 30 | SPT x2 15 |
| 8 | Bomb 1 + Unl. Lives 30 | Comet 1 | Unl. Chuck 15 | Chuck 1 | Red 1 |
| 9 | Coins 70 + SPT 30 + Red 1 | Slingshot 1 + Unl. Bomb 15 | Unl. Chuck 15 | Unl. Red 15 | SPT x2 15 |
| 10 | Unl. Red 20 | Unl. Lives 15 | Bomb 1 | Chuck 1 | Red 1 |
| 11 | Unl. Lives 15 | Unl. Chuck 10 | Slingshot 1 | Unl. Red 10 | SPT 30 |
| 12 | Comet 1 | Shuffle 1 | Red 1 | SPT 30 | SPT x2 15 |
| 13 | Coins 65 | Bomb 1 | Unl. Chuck 15 | Slingshot 1 | Unl. Red 15 |
| 14 | Unl. Lives 20 | Comet 1 | Shuffle 1 | Slingshot 1 | SPT 30 |
| 15 | Coins 150 + Slingshot 1 + Unl. Red 30 | SPT 50 + Unl. Lives 60 | Unl. Chuck 30 | Shuffle 1 | SPT x2 30 |

Key bundles: HC appears **only in 1st-place bundles** (rounds 1, 4, 6, 9, 13, 15 — 30/55/50/70/65/150), so HC from this event is gated on winning the race. Round 15 (loop end) is the value spike: 1st = Coins 150 + Slingshot 1 + Unlimited Red 30 — cross-checks exactly against the prior verified context example.

Per-resource totals across all 75 bundles (i.e., the total pool dispensed to a full 5-player group over rounds 1–15), with the rounds 10–15 loop portion (30 bundles, dispensed again each loop cycle):

| Resource | Full run (R1–15) | Per loop cycle (R10–15) |
|---|---|---|
| Coins (HC) | 420 | 215 |
| SPT | 220 | 140 |
| SPT x2 | 100 | 45 |
| Red | 8 | 2 |
| Chuck | 5 | 1 |
| Bomb | 5 | 2 |
| Slingshot | 6 | 4 |
| Shuffle | 7 | 3 |
| Comet | 5 | 2 |
| Unlimited Lives | 205 | 110 |
| Unlimited Red | 140 | 75 |
| Unlimited Chuck | 115 | 55 |
| Unlimited Bomb | 35 | 0 |

Over half the HC pool (215/420) sits in the loop rounds, which repeat — consistent with the analytics finding that heavy players harvest most River Rush value from the loop (see Simulation notes). Unlimited Bomb appears only in progression rounds 3 and 9, never in the loop.

Punch-card columns present in the sheet but all-zero for this event: Avatar, 1-star Dly … 6-star Dly (and COOP Token in the wider canonical set) — River Rush does not touch them, and the zero columns are kept deliberately per the sheet's punch-card convention.

Beacon also supports **multiple reward sets to segment players by engagement/spending** (stated, p.17) — the RR sheet models a single set.

## Duration & cadence

- **Duration:** beacon-configurable timer (stated). In practice **7 days**, weekly, in the "Weekly High Intensity" calendar slot — every dumped week of the current 2026 LiveOps calendar shows "River Rush, 7 days".
- **Most recent analytics run window:** 2026-04-23 → 2026-04-30 (8 calendar days spanned; used for the distribution/item-claim queries).
- **Within an instance,** content is effectively unlimited via cycling (rounds 10–15 loop); a no-fail player consumes 185 levels for the first pass and 87 per loop cycle after.
- **Redesign proposal (not implemented in the sim):** rebrand as "Lava Quest", run daily on weekends (Fri–Sun), paired with Target Day / Flash Race / Kite Festival for complementary motivations.

## Resources paid

Of the sim's 11 tracked resources, River Rush pays out **all 11**: HC (as Coins), Slingshot, Shuffle, Comet, Red, Chuck, Bomb, Unlimited Bomb, Unlimited Chuck, Unlimited Red, Unlimited Lives.

In addition, the config pays **SPT** (Strong Power Token) and **SPT x2** (double-value variant), which are outside the sim's 11-resource universe. Legacy spec shorthand maps as: SP → SPT, Doubler SP → SPT x2, Shooting Star → Comet, UL → Unlimited Lives, UL Red/Chuck/Bomb → Unlimited Red/Chuck/Bomb.

Not paid (all-zero punch-card columns): Avatar, 1–6-star Dly, COOP Token.

## Simulation notes (why it's carried; what a real model would need)

**Status in the economy sim: carried stub, by request.** Verified this session: the RR_v2 sheet is identical to RR — a programmatic cell-by-cell comparison of all 88 rows × 26 columns found **0 differences at both cached-value and formula level**. River Rush also does not appear in either calendar grid (`cal_curr` / `cal_new` rows scanned — no River Rush cell), so it is not routed through the `measured × R × D × T` event pipeline; the engine's SOURCES registry treats unlisted categories as carried. Consequently **simulated result = measured value, diff = 0** for every segment and resource. This is intentional: no reward change (R = 1), no duration/cadence change modeled.

**Why a real model is hard (and what it would need):**

- **Outcome is a placement distribution, not an accrual curve.** Reward per round = f(finish place among 5), and place depends on relative level-clear *speed and win rate* vs 4 competitors/ghosts/bots. A model needs per-segment win rate and levels-per-hour, plus the matchmaking/bot mix, to produce P(place = k).
- **Failure resets create high variance in levels-per-reward.** Expected levels to clear an N-streak at win rate p is a geometric-compound quantity (≈ (p^-N − 1)·p/(1−p) levels, inferred), which explodes for R15's N=25 at casual win rates — so reward access is sharply skewed toward skilled/boosted (spending) players. That is the monetisation lever (extra-moves purchases mid-streak are explicitly tracked in analytics) and exactly what a flat accrual curve can't express.
- **Loop-round harvesting dominates for heavy players.** Analytics: `river_rush` HC gain per player is ~0.5 (levels 1–9 engagement bucket) vs ~31.2 (100+ bucket) — a **~69× ratio, +30.7 absolute gap**, the 3rd-largest engagement-skew of any source. The loop (R10–15, 215 HC per pass) can be repeated all week, so total payout scales with time-in-event, not with a fixed ladder. A real model needs loop-cycles-per-instance by segment.
- **Scarcity picking couples players.** What a player receives depends on what earlier finishers took (and on the same-pick collision edge case), so per-place bundle values are only an approximation of realized per-player value; expected value per player = mixture over P(place) × remaining-bundle choice policy.
- **Data to calibrate exists:** `m_item` (index of reward chosen), `m_current_round` (1–15), `m_score_count` (cumulative tokens = levels won), `m_leaderboard_position` (finish place), `m_leaderboard_id` (competitor-group ID); event identified by `m_event_name = 'river_rush'` OR `m_action_sub1 = 'river_rush'` (schema not personally verified). The written-but-unverified query 4.3 (item claims by HC bucket, loop vs progression rounds) is the natural first calibration step.
- Also worth remembering: `client_events_view_currency_gain` caps values at 0–9999 and Night Sky logs as Dream Heist — standing query gotchas if River Rush payouts are ever re-derived from raw events.

Given RR_v2 == RR and no calendar change, the carried stub is exactly correct for the current comparison; the machinery above only matters if a future redesign (e.g., the Lava Quest weekend-daily proposal, reward re-tuning, or duration change) actually touches River Rush.

## Sources

- `D:\_projects\r_liveops_2_sim_work\DRBLRiver Rush180526085745.pdf` — design doc "River Rush Bots and Improvements — H2/2024" (22 pp.): hypothesis, feature breakdown, scarcity system, FTUE/UX copy, edge cases, analytics list, offline behaviour, ghosts, beacon configuration variables, matchmaking & group-size Q&A.
- `D:\_projects\r_liveops_2_sim_work\NEW_LIVEOPS_CALENDAR_ECO.xlsx`, sheets `RR` and `RR_v2` — config panel (numberOfRounds 15, groupSize 5, cycleRounds TRUE, loopbackPoint 10, firstPeakLastRound 4; totals 185/87/36) and the 75-row (Round, Place) reward table. RR_v2 verified identical to RR (0 cell diffs, values and formulas).
- `D:\_projects\r_liveops_2_sim_work\spreadsheet_style_and_river_rush_context.md` — §2 River Rush event context (prior verified; cross-checked against PDF and sheet — consistent), §3 prize-name mapping.
- `D:\_projects\r_liveops_2_sim_work\Event_Eco_Investigation_Context.md` — §8 River Rush analytics context (fields, run window 2026-04-23→30, loop vs progression framing); §5 engagement-skew table (69× HC ratio).
- `D:\_projects\r_liveops_2_sim_work\calendar_dump.txt` — weekly "River Rush, 7 days" in the Weekly High Intensity slot.
- `D:\_projects\r_liveops_2_sim_work\redesign_dump.txt` — redesign deck pp.42–46: River Rush typing (solo/competitive/win streak/race) and Lava Quest weekend-daily proposal.
- `D:\_projects\r_liveops_2_sim_work\HAND_OFF.md` — sim engine context: RR_v2 byte-identical, unlisted categories carried at measured.

## Gaps & open questions

1. **Round 1 Level Req = 5 vs beacon warning "do not use values smaller than 6"** (rock-layout break). Either the warning is stale, the layout was fixed, or the live config differs from the sheet. Unresolved.
2. **loopbackPoint representation mismatch:** beacon defines it as a per-round boolean flag ("set to true for the round where reusing round data should start"); the RR sheet models it as a round number (10). Same semantics, but worth knowing if the sheet is ever exported to beacon config.
3. **Analytics schema unverified:** `m_item`/`m_current_round` field names and the `m_event_name`/`m_action_sub1 = 'river_rush'` identifier are assumed by convention, not personally verified. Query 4.3 (item claims by HC bucket, loop vs progression) is written but not run.
4. **Unlimited-item units inferred** (minutes), not stated in the sheet or PDF.
5. **Sheet "place" = intended bundle ranking, actual pick is player choice** — realized per-place value distribution (which bundles 1st-place finishers actually take, incl. non-available options logged) is unknown; the analytics spec tracks it but no data was reviewed.
6. **Segmented reward sets:** beacon supports multiple reward sets by engagement/spending; whether the live event uses segmentation (and whether the RR sheet is one segment's set) is unknown.
7. **Variable in-map stone rewards:** on/off state in the live config unknown (nice-to-have feature); not in the RR sheet.
8. **Bot/ghost fill rates in production** (how often real players vs ghosts/bots, and ghost difficulty mix actually deployed) unknown — matters for any real placement model.
9. **SPT / SPT x2 sit outside the sim's 11-resource universe** — if River Rush is ever un-stubbed, decide whether Strong Power Tokens need to enter the sim's resource set or be mapped to value elsewhere.
10. **ARPDAU hypothesis outcome:** the +10% target is stated; no post-launch validation result appears in any available material.
