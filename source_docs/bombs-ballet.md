# Bomb's Ballet — Mechanics

**Type:** collection | **Sim category:** Bomb's Ballet | **Calendar name:** Bomb's Ballet Show | **Accrual key:** Bombs Ballet | **Config sheets:** BB / BB_v2

## What it is

Bomb's Ballet (internal design name: **Bomb's Music Box Event**; calendar names: "Bomb's Ballet Show" in the ECO workbook, "Bomb's Ballet" in the 2026 live-ops calendar) is a solo **collection / threshold-reward event** hosted by the Bomb character in a ballet/music-box theme. The design doc describes it as "a modified Stella's shop event combined with threshold reward event": players collect **Notes** (event tokens) from levels and, each time a cumulative threshold is reached, get to **freely choose which Music Box to open** on the event popup. The choice is purely cosmetic — the reward sequence is **linear and independent of which box the player taps** (PDF p.7: "first selection will always give the 15 coins, whether user chooses the first, last box or any other box"). Design intent (PDF p.1): add a bit of 'choice' to threshold events, more thematics, "and a bit of musical mystery too."

In the live-ops calendar it occupies the **LOW INTENSITY** side-event slot (PDF `current_live_ops_calendar_2026.pdf`), rotating with Jigsaw Puzzle, Photoshoot and Mystery Puzzle.

## Player-facing mechanics (core loop)

Stated in the design PDF (pp.1–6):

1. **Event start** — thematic intro text; event badge appears in the main hub; info popup shown until the player starts playing (p.1, p.4 QA).
2. **Collect Notes from levels** — token source is level play. Per the BB config panel: **5 tokens per level** (`tokensPerLevel = 5`) and **`spawnTokensOnlyOnFirstTry = TRUE`** — tokens only spawn on the first attempt at a level (BB sheet rows 4–5). *(Inferred from the flag name: replays/retries of an already-attempted level yield no Notes, so accrual is effectively tied to first-try level progression.)*
3. **Threshold reached** — hub entry point shows an exclamation mark; tapping opens the event popup, UI dims, available boxes are highlighted and shake, Bomb prompts the player via speech bubble ("time to open a box!") (p.2).
4. **Open a Music Box** — player taps any available box; an opening animation plays (dancing Bomb emerges from the box), the reward is revealed, then a Claim button appears. The animation loops and cannot be skipped on first run (pp.2, 5).
5. **Claim** — reward flies to its target; a key/check marks the opened box; a note particle updates the bonus counter (bottom-left chest); Bomb switches to a "keep collecting…" message (pp.2–3, 5). Each Mystery Box contains a quantity of a **single item type** (p.2).
6. **Repeat** until all boxes are opened. Already-opened boxes can be tapped to replay their animation (p.5).
7. **Completion** — opening the last box grants its reward, then a separate **completion reward panel** (different from box rewards) with a chest; if an avatar is configured, an avatar panel asks the player to set it; finale shows curtains opening and **Bomb dancing on stage** (pp.3, 6). After completion the popup only shows the stage/dance section; box animations can no longer be replayed (p.6). The popup stays accessible in finished state as long as the event is scheduled (p.3).

The screenshots in the PDF (pp.1, 5) show an older/smaller layout with **6 boxes** ("0/6" counter, "Bomb's Big Ballet Show" title); the current ECO config has **15 reward levels + completion reward** (see below). *(Box count in the live config is inferred from the 15 ladder rows — one box per reward level.)*

## Reward structure (actual ladder from config — table)

From sheets **BB** and **BB_v2** of `NEW_LIVEOPS_CALENDAR_ECO.xlsx` (rows 8–24). **The ladders are byte-identical between BB and BB_v2** — the only base-vs-v2 diff in the entire sheet pair is `EventDuration (days)`: **BB = 3, BB_v2 = 4**.

"Price" is the **cumulative Note threshold** for that reward level *(inferred from the strictly increasing series and the PDF's tier semantics on p.7)*. All zero columns (SPT, COOP Token, Avatar, star dailies, etc.) omitted.

| Level | Price (Notes, cum.) | Reward |
|---|---|---|
| 1 | 15 | 1 × Chuck (pre-level booster) |
| 2 | 40 | 10 × Unlimited Red *(minutes, inferred)* |
| 3 | 70 | 10 × Unlimited Chuck |
| 4 | 110 | 30 × Unlimited Lives |
| 5 | 160 | 25 × Coins (HC) |
| 6 | 220 | 10 × Unlimited Bomb |
| 7 | 290 | 1 × Red (pre-level booster) |
| 8 | 370 | 60 × Unlimited Lives |
| 9 | 460 | 15 × Unlimited Red |
| 10 | 560 | 25 × Coins (HC) |
| 11 | 670 | 15 × Unlimited Chuck |
| 12 | 790 | 15 × Unlimited Bomb |
| 13 | 920 | 1 × Slingshot (in-level booster) |
| 14 | 1,060 | 60 × Unlimited Lives |
| 15 | 1,210 | 1 × Shuffle (in-level booster) |
| **Completion** | — (open all 15) | **50 × Coins (HC) + 1 × Bomb + 1 × Comet** |

**Full-clear totals:** 100 HC, 1 Red, 1 Chuck, 1 Bomb, 1 Slingshot, 1 Shuffle, 1 Comet, 150 min Unlimited Lives, 25 Unlimited Red, 25 Unlimited Chuck, 25 Unlimited Bomb — exactly the 11 sim resources.

**Token math:** full clear needs 1,210 Notes = **242 first-try level clears** at 5 Notes/level. Measured `avg_final_token_balance` (data_event_inst) ranges from ~47–53 (segment 0-9) to ~734–885 (segment 100+), i.e. **even the top segment does not on average reach the 1,210 full-clear threshold**; typical players land mid-ladder. *(Measured on the historical 5-day instance — see conflict section.)*

**Historical ladder (PDF pp.7–8, older 6-box config, for reference only — superseded by the ECO config):** tier 5 → 15 HC; tier 10 → 1 CherryBomb; tier 20 → 1 Shuffle; tier 30 → 60 UnlimitedLives; tier 40 → 1 CherryBomb + 100 HC; tier 50 → 1 CherryBomb + 100 HC + Avatar1013; completionReward → 500 HC. Note the old version included an **event avatar** and a much larger HC completion payout; the current ECO config has Avatar = 0 on every row and only 50 HC at completion.

## Duration & cadence (incl. the config-vs-calendar conflict)

**⚠ KNOWN CONFLICT — config and calendars move duration in opposite directions:**

| Source | "Current" duration | "New" duration |
|---|---|---|
| Config sheets (BB → BB_v2) | **3 days** (BB!B3) | **4 days** (BB_v2!B3) |
| Calendars (cal_curr → cal_new) | **4 days** (per HAND_OFF; corroborated by 2026 live-ops PDF "Bomb's Ballet, 4 days") | **3 days** (per HAND_OFF: 1×3d) |
| Measured analytics instance (data_event_accrual / data_event_inst) | `instance_length_days` = **5** (1 instance) | — |

So the BB_v2 config implies 3→4d while the calendar plan is 4d→3d. **The calendar wins in the sim engine** (established project fact); the BB/BB_v2 `EventDuration` values need reconciling with the calendar owner. The measured accrual instance being 5 days matches *neither* config nor calendar — a third duration value in play.

**Scheduling:**

- **cal_curr** (33-day window): one instance, "Bomb's Ballet Show" starting **day 21 (Tuesday)** in the row-17 side-event rotation (Jigsaw d1 → Photoshoot d7 → Jigsaw d14 → **Bomb's Ballet Show d21** → Jigsaw d29). Duration 4d per HAND_OFF (start-day cell only; duration not encoded in the sheet).
- **cal_new** (33-day window): one instance, starting **day 10 (Friday)** in the row-17 rotation (Mystery Puzzle d3 → **Bomb's Ballet Show d10** → Jigsaw d17 → Photoshoot d24 → Mystery Puzzle d31), i.e. **1 × 3d**, co-starting with Kite Festival and Team Race weekend.
- **2026 live-ops calendar PDF:** "Bomb's Ballet, 4 days" appears in the LOW INTENSITY slot roughly **every 4 weeks** (weeks 17, 21, 25, 27*, 33, 37, 41, 45, 49, 53 — *some gaps/irregularity around calendar-change week 27), always in **River Rush weeks**, alternating with Jigsaw/Photoshoot/Mystery Puzzle in Kite Festival weeks. Runs alongside Hatchling Hideaway (3d) in the second low-intensity slot.

## Resources paid

All 11 sim resources, from the config ladder + completion reward:

| Resource | Amount per full clear | Where in ladder |
|---|---|---|
| HC (Coins) | 100 | L5 (25), L10 (25), completion (50) |
| Red (pre-level) | 1 | L7 |
| Chuck (pre-level) | 1 | L1 |
| Bomb (pre-level) | 1 | completion |
| Slingshot (in-level) | 1 | L13 |
| Shuffle (in-level) | 1 | L15 |
| Comet (in-level) | 1 | completion |
| Unlimited Lives | 150 (min) | L4 (30), L8 (60), L14 (60) |
| UL Red | 25 (min, inferred) | L2 (10), L9 (15) |
| UL Chuck | 25 | L3 (10), L11 (15) |
| UL Bomb | 25 | L6 (10), L12 (15) |

No SPT, no COOP tokens, no avatar, no star-daily rewards in the current config (all-zero columns). Actual per-player payout is the ladder truncated at the player's final Note balance — most segments do not full-clear (see token math above).

## Simulation notes

- **COLLECTION-type event.** Sim formula: `new = measured × R × D × T` with **R = 1** (reward ladder unchanged between BB and BB_v2 — verified identical row-by-row).
- **D = token accrual share at the new duration**, from `data_event_accrual`, key **'Bombs Ballet'**. Caveat: the measured curve comes from **one instance with `instance_length_days = 5`**, so D for the cal_new 3-day event is the day-3 cumulative token share of a 5-day instance. Mean `cum_token_share` at day 3 by segment (NONPAYER / PAYER): 0-9: 0.733 / 0.744; 10-19: 0.750 / 0.753; 20-39: 0.758 / 0.751; 40-99: 0.777 / 0.759; 100+: 0.810 / 0.783. Day-4 shares are ~0.982–0.990 everywhere (day 5 adds only ~1–2%, so the historical 5-day instance behaved almost like a 4-day one). Using the day-3 share assumes the accrual-curve *shape* transfers to a shorter event (players don't compress effort) — flag as an assumption.
- **Calendar wins on duration:** simulate cal_curr at 4d and cal_new at **1 × 3d** per window, regardless of the BB/BB_v2 `EventDuration` cells.
- **Engagement amplification:** analytics event `bomb_ballet_event` is heavily engagement-amplifying — **~115× HC-ratio between segment 100+ and 1-9**. Per-segment truncation of the ladder matters far more than the mean: `data_event_inst` shows participation_rate 0.56/0.61 (0-9 NP/P) rising to ~0.93–0.95 (20-39 and up), opt-in ~0.90–0.96, recipient_rate 0.70 (0-9) peaking at ~0.86 (10-19) and falling to ~0.37–0.39 for 100+ (recipient definition likely differs for completers), and avg_final_token_balance 53 → 885 Notes across segments.
- Payout is deterministic given a final token balance (linear ladder, no choice effect, single-item boxes) — no RNG needed in the sim.

## Sources (PDF pages / sheets per fact)

| Fact | Source |
|---|---|
| Event concept, name "Bomb's Music Box Event (Bomb's Ballet)", Stella's-shop + threshold hybrid, free box choice | Design PDF p.1 |
| Notes collected from levels; box = quantity of a single item; claim flow, bonus counter | PDF pp.1–3 |
| Reward sequence linear, independent of box choice | PDF p.7 |
| Completion flow: completion panel, avatar prompt, Bomb dancing on stage, curtains | PDF pp.3, 6 |
| QA behaviors (badge, popup auto-open, no-skip animation, replay, quit/kill handling) | PDF pp.4–7 |
| Historical 6-box ladder (tiers 5–50, Avatar1013, 500 HC completion) | PDF pp.7–8; 6-box screenshots p.5 |
| EventDuration 3d; tokensPerLevel 5; spawnTokensOnlyOnFirstTry TRUE | `NEW_LIVEOPS_CALENDAR_ECO.xlsx` sheet BB rows 3–5 |
| EventDuration 4d (only diff vs BB) | sheet BB_v2 row 3 (rows 4–24 identical to BB) |
| 15-level ladder + completion reward (all numbers in table) | sheets BB / BB_v2 rows 8–24 |
| cal_curr: "Bomb's Ballet Show" start day 21 (Tue), 1× per window | sheet cal_curr cell V17 |
| cal_new: "Bomb's Ballet Show" start day 10 (Fri), 1× per window | sheet cal_new cell K17 |
| Calendar durations 4d (curr) / 3d (new); calendar-wins rule; sim formula; ~115× HC ratio | project HAND_OFF facts |
| "Bomb's Ballet, 4 days", low-intensity slot, ~4-week cadence in River Rush weeks | `current_live_ops_calendar_2026.pdf` pp.1, 3, 5, 7, 9, 12, 14, 16, 18 (weeks 17, 21, 25, 27, 33, 37, 41, 45, 49, 53) |
| Measured instance_length 5d, 1 instance; day-by-day cum_token_share by segment/payer | sheet data_event_accrual rows 22–71 (key 'Bombs Ballet') |
| Participation / opt-in / recipient rates, avg_final_token_balance | sheet data_event_inst rows 12–21 (key 'Bombs Ballet') |

## Gaps & open questions

1. **Duration reconciliation (prominent):** BB_v2 says 3→4d, calendars say 4d→3d, and the measured analytics instance was 5d. The calendar wins in the engine, but the BB/BB_v2 `EventDuration` cells should be corrected to match (curr = 4, new = 3) to avoid future mis-reads. Who owns that fix?
2. **D-factor validity:** accrual curve measured on a single 5-day instance; applying its day-3 share to a 3-day event assumes no behavioral compression. No multi-instance variance data exists (n_instances = 1).
3. **Units of Unlimited boosters:** amounts (10/15/30/60) are assumed to be **minutes** (consistent with Unlimited Lives conventions elsewhere) — not stated in the config sheet.
4. **Cumulative vs incremental prices:** treated as cumulative thresholds (strictly increasing, matches PDF tier semantics) — not explicitly labeled in the sheet.
5. **Box count in live config:** inferred as 15 (one per ladder level); PDF screenshots show a 6-box layout from the older design. No current-UI confirmation.
6. **Avatar removed?** Old config granted Avatar1013 at the top tier; current config has Avatar = 0 everywhere, yet the PDF completion flow still includes an avatar prompt ("If avatar…"). Presumably the avatar is simply not configured now — unconfirmed.
7. **First-try-only accrual vs 242-clears requirement:** 1,210 Notes at 5/level on first-try-only means 242 fresh level completions in 3–4 days — plausibly reachable only by extreme progressors, consistent with mean final balances well below 1,210 even in segment 100+. Whether token boosts/multipliers exist (e.g., harder-level bonuses) is not documented anywhere in the materials.
8. **recipient_rate semantics:** drops to ~0.37–0.39 for segment 100+ while participation is ~0.94 — definition of "recipient" in `data_event_inst` (reward-claimer? non-completer?) is not documented.
9. **cal_curr day-21 start is a Tuesday** while the 2026 live-ops PDF shows Bomb's Ballet in River Rush weeks (start day within week not extractable from the PDF text layer) — exact live start weekday unverified.
