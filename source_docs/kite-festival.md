# Kite Festival — Mechanics

**Type:** score-based PVP leaderboard | **Sim category:** LEADERBOARD since 2026-07-06 (`simKiteFestival` → `leaderboardSim_`, D pinned 1) | **Calendar name:** Kite Festival | **Accrual source:** `data_event_kite_accrual` (score-LAG query; **PBP sim only** since the re-classification) | **Config sheets:** Ki / Ki_v2

> **2026-07-06 RE-CLASSIFICATION (user decision):** payouts are rank-based and **zero-sum per
> league of 60** (fixed pot 875 HC/league; `avg_bots` = 0 in the now-populated `data_event_inst`
> Kite rows, resolving gap #5 below; the single score milestone at req 100 pays no HC and even the
> p25 player @0-9 banks ~100). Everyone scoring less in a 3-day instance leaves ranks — and
> therefore payouts — unchanged, exactly as the "zero-sum" note in the simulation-relevant facts
> below argued. The 33-day engine now prices Kite = measured × R × T (T ≈ 1.28–1.36, a mild
> cadence inflator); the score-curve D ≈ 0.32 "flagship shrink" (gap #7, HAND_OFF established
> fact) is **superseded**, and the parse canary direction flipped from shrink to GROW. Statements
> below describing D≈0.32 as applied by the engine are historical.

> **⚠ Source coverage warning:** the design PDF (`NESTKite Festival200526112311.pdf`) is **only 1 page**. It covers the core loop concept and one entry-milestone fact, and **explicitly outsources everything else**: the reward table lives in a linked "Kite Festival Event Rewards.pdf" (not in the materials) and the "Win Streak restoration method" is behind a broken/inaccessible link. All numbers below therefore come from the **Ki config sheet** of `NEW_LIVEOPS_CALENDAR_ECO.xlsx`, not from the PDF. What the PDF **does** cover: PVP score-submission concept, streak-based scoring with loss reset, bank-anytime mechanic, ranking = sum of submitted scores, week-long duration, main-menu score launch, first-100-score unlock + 30 min unlimited lives. What it does **not** cover: streak score values, reward ladders, league size, entry requirements, matchmaking/bots, streak restoration details.

## What it is

Kite Festival is a **PVP score-leaderboard event** (PDF p.1: "a PVP event where players strive to submit the highest total score during the event"). Players accumulate a running score by completing levels; **consecutive wins grant additional scores, but a single loss resets them** (PDF p.1, bold in original) — a push-your-luck risk/reward loop. At any point the player may **submit ("launch") their collected score** to bank it onto the leaderboard; the running score then resets and momentum must be rebuilt. **Leaderboard ranking = total of all submitted scores**; prizes are paid by final ranking at event end (PDF p.1).

In the calendars it is the **high-intensity** event: in the 2026 live-ops calendar it occupies the WEEKLY HIGH INTENSITY slot in alternation with River Rush, and it additionally runs as a **permanent new-user trigger event** ("NEW USERS: Trigger Event 7days Kite Festival" appears in every week row of the 2026 calendar). It is also the project's analytics standout: **the most engagement-amplifying source in the game (~386× HC ratio between segment 100+ and 1-9;** the 1-9 segment gets only ~0.03 HC/day from it) *(established project fact)*.

## Player-facing mechanics (core loop)

From PDF p.1 unless noted; numeric values from Ki sheet:

1. **Play levels to build score.** Each consecutive win advances the streak step; the score awarded per win grows with the streak (Ki rows 13–19): step 1 → **1**, step 2 → **10**, step 3 → **100**, step 4 → **200**, step 5 → **500**, step 6+ → **1,000** per win. A **single loss resets the streak** (PDF p.1). *(The Ki sheet labels this "Score Per Win Streak Step (loss resets to step 1)"; whether the loss also wipes the un-submitted running score is not stated — the PDF says loss resets "them" [the additional scores], and one screenshot caption says "Failing a level resets the score you've earned since your last kite launch", i.e. un-banked score is lost on a loss.)*
2. **Launch the kite (submit score) at any time from the main menu** (PDF p.1: "Allows launching score whenever in main menu"). Submitted score is added to the leaderboard total; the running score resets to 0.
3. **Leaderboard unlock:** submitting the **first 100 score** unlocks the leaderboard and pays **30 min Unlimited Lives** (PDF p.1). This matches the Ki config exactly: `milestonesRequiredForLeaderboard = 1`, and the single milestone row is Score Req **100 → 30 Unlimited Lives** (Ki rows 7, 22–23).
4. **Compete within a league group of 60 players** (`leagueGroupSize = 60`, Ki row 5; not in the PDF). Ranking is by total submitted score.
5. **Event end:** prizes by final position (PDF p.1); only the **top 25 of 60** positions carry rewards (Ki rows 27–51; positions 26–60 all-zero).
6. A **Win Streak restoration method** exists (PDF p.1 info-box) but the linked page is not in the materials — mechanism unknown (paid restore? ad? grace loss?).

**Entry requirements (Ki rows 3–4):** `requiredPlayerLevel = 1`, `requiredSagaLevel = 42`. **Other config:** `scoreAddition = 1000` (Ki row 8 — semantics not documented; plausibly the max per-win score, matching streak step 6+), `assetBundle = event-kite-festival`, `configuration = KiteFestival`.

## Reward structure (actual ladder from config — table)

From sheet **Ki** of `NEW_LIVEOPS_CALENDAR_ECO.xlsx`. **Ladders are identical between Ki and Ki_v2** — the only diff in the whole sheet pair is `Event Duration (days)`: **Ki = 7, Ki_v2 = 3** (cell B6). All-zero columns (SPT x2, COOP Token, Avatar, star dailies, Unlimited Red/Chuck/Bomb, Coins beyond top 5, etc.) omitted.

**Milestone rewards (Ki rows 22–23) — one milestone only:**

| Milestone | Score req | Reward |
|---|---|---|
| 1 | 100 | 30 × Unlimited Lives (min) — unlocks leaderboard |

**Leaderboard rewards (Ki rows 26–51; 60 positions, top 25 rewarded):**

| Position | Coins (HC) | SPT | Booster |
|---|---|---|---|
| 1 | 300 | 400 | 1 × Comet |
| 2 | 200 | 300 | 1 × Shuffle |
| 3 | 150 | 240 | 1 × Shuffle |
| 4 | 125 | 200 | 1 × Shuffle |
| 5 | 100 | 160 | 1 × Shuffle |
| 6 | — | 140 | 1 × Slingshot |
| 7 | — | 125 | 1 × Slingshot |
| 8 | — | 120 | 1 × Slingshot |
| 9 | — | 115 | 1 × Slingshot |
| 10 | — | 110 | 1 × Slingshot |
| 11 | — | 105 | 1 × Bomb |
| 12 | — | 100 | 1 × Bomb |
| 13 | — | 95 | 1 × Chuck |
| 14 | — | 90 | 1 × Chuck |
| 15 | — | 85 | 1 × Red |
| 16 | — | 80 | 1 × Red |
| 17–25 | — | 75, 70, 65, 60, 55, 50, 45, 40, 35 | — |
| 26–60 | — | — | — |

*(SPT = Season Pass Tokens — inferred from the workbook's SP/SP_lb sheets; the Ki sheet only labels the column "SPT".)* The 2026 calendar corroborates the SPT link: Flash Race rows are annotated "With SPT", implying SPT is a cross-event season-pass currency.

**Per-group payout totals (fixed per league of 60):** 875 HC, 2,990 SPT, 1 Comet, 4 Shuffle, 5 Slingshot, 2 Bomb, 2 Chuck, 2 Red — plus 30 min Unlimited Lives × every player who submits ≥100 score. Expected value per participant ≈ payout/60 modulated by rank distribution (and by bots, if any — see gaps).

## Duration & cadence

| Source | Value |
|---|---|
| Design PDF p.1 | "week long leaderboard event" |
| Ki config (`Event Duration (days)`, B6) | **7** |
| Ki_v2 config (only diff vs Ki) | **3** |
| Measured analytics (`data_event_kite_accrual`, `instance_length_days`) | **8** (likely 7d event + claim/results day — *inferred*) |
| 2026 live-ops calendar PDF | "Kite Festival, 7 days" |

**Scheduling:**

- **cal_curr** (33-day window, day 1 = Wednesday): **3 × 7d**, starting days 3, 17, 31 (cells D15, R15, AF15 — all Fridays, biweekly). Matches the established "Kite 3×7d (cal_curr)" fact.
- **cal_new** (same window): **5 × 3d**, starting days 3, 10, 17, 24, 31 (cells D15, K15, R15, Y15, AF15 — **every Friday**). Matches "5×3d (cal_new)".
- **2026 live-ops calendar** (`current_live_ops_calendar_2026.pdf`, 19 pages ≈ 39 week-rows): "Kite Festival, 7 days" is the WEEKLY HIGH INTENSITY event in **18 of ~39 weeks**, strictly alternating with **River Rush (21 weeks)** — i.e. roughly every other week. Photoshoot/Jigsaw/Mystery Puzzle low-intensity events are scheduled inside Kite weeks; Bomb's Ballet + Hatchling Hideaway in River Rush weeks.
- **Permanent new-user instance:** every week row also carries "NEW USERS KITE FESTIVAL — NEW USERS: Trigger Event 7days Kite Festival" (39/39 weeks) — a 7-day Kite Festival triggered for new users independent of the main rotation. *(The sim materials do not model this separately — see gaps.)*

## Resources paid

Of the 11 sim resources, Kite Festival pays (per Ki ladder):

| Resource | Where |
|---|---|
| HC (Coins) | Positions 1–5 (300/200/150/125/100) |
| Comet | Position 1 (×1) |
| Shuffle | Positions 2–5 (×1 each) |
| Slingshot | Positions 6–10 (×1 each) |
| Bomb (pre-level) | Positions 11–12 (×1 each) |
| Chuck (pre-level) | Positions 13–14 (×1 each) |
| Red (pre-level) | Positions 15–16 (×1 each) |
| Unlimited Lives | 30 min milestone (score 100), every participant |

**Not paid:** UL Red / UL Chuck / UL Bomb (all-zero columns). Also pays **SPT** (season-pass tokens — outside the 11-resource set). Consistent with the established analytics note that Kite gives "~0 HC to low segments but real boosters" — HC only reaches the top 5 of each league, while boosters reach the top 16 and Unlimited Lives reaches everyone who engages minimally.

## Simulation notes

- **SCORE-based leaderboard event** — the only one needing its own accrual query: score is cumulative-max, so the accrual is derived via a **score-LAG query** (`eventtype='event_action'`, `m_event_name='KiteFestival'`, `m_score_reached`) → sheet `data_event_kite_accrual` *(established)*.
- **Sim formula:** `simScoreEvent(cat)` = `measured × D × T` (R = 1 — reward ladder verified byte-identical between Ki and Ki_v2; only duration changed).
- **D — the flagship "shrink" case:** cal_curr 3×7d → cal_new 5×3d. `D = cum_share(3)/cum_share(7) ≈ 0.32` *(established)*. This is the **post-install sanity check: if Kite doesn't shrink, the calendar-merge reading is broken.**
- **Which curve the 0.32 comes from:** the established curve "day3≈0.32, day4≈0.97, day5≈1.0" matches the **p50 (median)** columns of `data_event_kite_accrual` for segment 0-9 NONPAYER (day 3 p50 = 0.3148, day 4 p50 = 0.9687, day 5 p50 = 1.0). The **mean** day-3 shares are higher and flatter across segments: 0.42–0.47 for segments 0-9…40-99 (both payer flags), but **0.61/0.55 (NP/P) for segment 100+** — top players front-load their scoring. Day-7 mean ≈ 0.973–0.989 everywhere (day 8 adds ~1%). If the sim ever moves from the single 0.32 factor to per-segment D, the mean-based values (≈0.42–0.61) would give a materially milder shrink than 0.32 — worth an explicit decision.
- **Measured base:** `instance_length_days = 8` in the accrual data; `n_instances` varies wildly by segment (1–49; low segments have few observed instances — the new-user trigger instances may be the reason low segments see Kite at all despite the biweekly main cadence). No Kite rows exist in `data_event_inst` (no participation/opt-in/final-balance stats), unlike collection events.
- **Engagement amplification: ~386× HC ratio (100+ vs 1-9), the most amplifying source in the sim** *(established)* — consistent with the ladder shape: HC only for top-5 finishes, which low segments essentially never reach; segment 1-9 nets ~0.03 HC/day.
- **Leaderboard payout is zero-sum per league of 60** — total payout per league is fixed (see totals above); per-player expected value depends on rank distribution within segment, which the measured `data_gains` numbers already embody. Duration change does not change the per-instance league payout, only instance count (5 vs 3 per window) and score volumes.

## Sources

| Fact | Source |
|---|---|
| PVP concept, streak scores w/ loss reset, submit-anytime, ranking = sum of submissions, prizes by rank | Design PDF p.1 (Introduction) |
| Week-long; main-menu score launch; first 100 score unlocks leaderboard + 30 min UL | PDF p.1 (Event Details) |
| Un-banked score lost on level fail | PDF p.1 (screenshot caption, small print) |
| Reward details & streak restoration exist but are external links | PDF p.1 (links to "Kite Festival Event Rewards.pdf" and "here") |
| requiredSagaLevel 42, leagueGroupSize 60, duration 7d, milestonesRequiredForLeaderboard 1, scoreAddition 1000 | `NEW_LIVEOPS_CALENDAR_ECO.xlsx` sheet Ki rows 3–10 |
| Streak score table 1/10/100/200/500/1000 | sheet Ki rows 13–19 |
| Milestone: score 100 → 30 UL | sheet Ki rows 22–23 |
| Leaderboard ladder (positions 1–25; 26–60 empty) | sheet Ki rows 26–86 |
| Ki vs Ki_v2: only diff = duration 7 → 3 (B6) | programmatic full-sheet diff |
| cal_curr 3×7d Fridays (days 3/17/31); cal_new 5×3d Fridays (days 3/10/17/24/31) | sheets cal_curr / cal_new row 15 |
| 2026 cadence: 18× "Kite Festival, 7 days" weekly-HI alternating with River Rush (21×); new-user 7d trigger row in all 39 weeks | `current_live_ops_calendar_2026.pdf` (all pages) |
| Accrual day-3/day-7 shares (mean + p50) by segment; instance_length 8; n_instances 1–49 | sheet data_event_kite_accrual |
| Score-LAG query, D≈0.32, flagship shrink case, 386× amplification, ~0.03 HC/day for 1-9 | project HAND_OFF (established facts) |

## Gaps & open questions

1. **The rewards PDF referenced by the design doc ("Kite Festival Event Rewards.pdf") is not in the materials.** The Ki sheet fills the gap, but there is no independent confirmation that the Ki ladder matches the live rewards doc.
2. **Win Streak restoration method unknown** — the PDF links out to a page we don't have. If a restore exists (HC purchase? ad view?), it is a potential HC **sink** attached to this event that the sim does not model.
3. **`scoreAddition = 1000` semantics undocumented** — assumed to be the streak-cap score per win (matches step 6+), unconfirmed.
4. **Does a loss wipe the un-submitted running score, the streak, or both?** PDF body says the *consecutive-win bonus* resets; a screenshot caption says the *score since last launch* resets. Both taken as true here, but the exact rule matters for optimal-play modeling.
5. **Bots / league fill:** `avg_bots` column exists in `data_event_inst` but Kite has no rows there; whether 60-player leagues are filled with bots (affecting real-player payout rates) is unknown.
6. **New-user trigger instance not separately modeled:** it runs 7 days in *every* week for new users; low-segment accrual data likely mixes trigger and main instances (n_instances 1–9 for segments 0-19 vs 49 for 20+ hints at inconsistent observation windows).
7. **p50-vs-mean D:** established D≈0.32 tracks the median curve of the lowest segment; per-segment mean day-3 shares are 0.42–0.61. Fine as a deliberately conservative flagship shrink, but flag if per-segment D is ever introduced.
8. **SPT identity** (Season Pass Tokens) inferred, and SPT is outside the 11-resource sim set — where its value lands in the economy (via SP ladder rewards) is out of scope here.
9. **Milestone count:** the config supports multiple milestones (`milestonesRequiredForLeaderboard = 1` and an 86-row grid) but only one (score 100) is populated — presumably intentional, unconfirmed.
