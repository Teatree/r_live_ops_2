# Hatchling Hideaway — Mechanics

**Type:** collection/interactive | **Sim category:** Hatchling Hideaway | **Calendar name:** Hatchling Hideaway | **Accrual key:** Hatchling Hideaway | **Config sheets:** HH / HH_v2

## What it is

Hatchling Hideaway (design doc title: **"Hatchling Hideaway (Interactive Event)"**; spelled "Hatchling Hideway" in the 2026 live-ops calendar PDF) is a solo, time-limited **interactive mini-game event**: players earn **event tokens by beating regular levels**, then spend those tokens as "moves" to reveal squares on a grid-based hidden-object board — a Battleship-style "find the hidden shapes" game (benchmark: Royal Match's Hidden Temple, cited throughout the PDF). Revealing all hidden objects in a room opens a **Gate**, which grants a narrative Hatchling reveal, a **chest of in-game rewards**, and the next (bigger) board. The event always runs as **5 Gates** (PDF pp.1–2, 10).

Theme: a fantasy castle in the clouds where mischievous Hatchlings are playing hide-and-seek; room progression Garden/Courtyard → Ballroom → Gallery → Throne Room → Treasure Room, with a comic final reveal (Bomb trapped in the castle) (PDF pp.2–3). Design intent: a **low-stakes, non-competitive "break" event** that adds variety to the rotation and mildly counters streak-event churn (PDF pp.1–2). Stated analytics success metric: **+6% player velocity / level wins per day** (PDF p.10).

In the 2026 live calendar it occupies a weekly **LOW INTENSITY** slot as "Hatchling Hideway, 3 days **WITH COOP EVENT TOKENS**" — matching the COOP Token column in the config ladder.

## Player-facing mechanics (core loop)

Stated in the design PDF unless marked inferred:

1. **Event start** — unlocks at "level ??? [TODO]" in the PDF (p.2); the ECO config resolves this: `requiredPlayerLevel = 1`, `requiredSagaLevel = 15` (HH rows 4–5). Runs 3 days, configurable (PDF p.2). Local notifications at event start and ~12h before end (PDF p.11). Players **start with 2 tokens** (3 during FTUE) (PDF pp.2, 10).
2. **Earn tokens from levels** — completing a regular level grants tokens; Hard and Extreme levels grant more (PDF pp.1, 6). PDF spec: Regular = 1, Hard = 3, Extreme = 5, "all three values are configurable" (pp.6, 10). **The live ECO config differs: Normal = 1, Hard = 2, Extreme = 3** (HH rows 6–8) — config supersedes PDF. Collected tokens fly from the Play button to the event badge (PDF p.4).
3. **Spend tokens on the board** — each token reveals one grid square (tap). The gate face shows indents for each hidden object as hints (shape sizes + orientation); a Hint UI lists the shapes hidden in the current board (PDF pp.2, 5). Objects are **predefined per gate, cannot rotate** (1×2 ≠ 2×1), may have duplicates; board layouts are **randomized per player** (except a preset FTUE board for Gate 1) (PDF pp.5, 10–11).
4. **Open the gate** — revealing all hidden objects in a room opens the gate: Hatchling reveal + reward chest + next board (PDF p.2). Rewards sit in a 5-chest Rewards UI; the **player chooses when to claim**; unclaimed chests animate on the event badge ("Claim" button) (PDF p.4).
5. **End states** — event ends when all 5 gates are done or the timer runs out. "Last Chance" state takes the player to the event screen one final time (double-confirm on quit); if token inventory ≥ all squares left across all remaining boards, a **"Reveal All"** fast-forward state auto-plays the rest (PDF pp.4–5). Online needed only to serve/start the event, not to progress or collect (PDF p.10).

**Boards per gate** (PDF pp.5, 10; sizes are squares horizontal×vertical):

| Gate | Grid | # objects | Objects (h×v) | Object footprint (sq) *(inferred: min tokens to clear w/ perfect guesses)* |
|---|---|---|---|---|
| 1 | 4×4 (16 sq) | 4 | 2×2, 3×1, 1×2 (×2) | 11 |
| 2 | 5×5 (25 sq) | 5 | 2×3, 2×1 (×2), 1×3 (×2) | 16 |
| 3 | 6×6 (36 sq) | 6 | 2×1, 2×2, 3×1 (×2), 2×3 (×2) | 24 |
| 4 | 7×7 (49 sq) | 7 | 3×2, 3×3, 1×2, 1×4 (×2), 2×2 (×2) | 33 |
| 5 | 8×8 (64 sq) | 8 | 2×4, 4×4, 2×1 (×2), 3×1 (×2), 1×5 (×2) | 44 |

*(Inferred token math: full clear costs between 128 tokens — every reveal hits an object — and 190 tokens — all squares revealed; minus the 2 free starting tokens. At 1/2/3 tokens per level, that is roughly 130–190 level-clears-equivalent for a full clear.)*

FTUE preset board (Gate 1, PDF p.11): 2×2 @ (1,2), 3×1 @ (2,4), 1×2 @ (1,4), 1×2 @ (3,3) (x,y = top-left corner).

Future considerations (not live, PDF p.12): daily token multiplier/doubler; purchasable token bundles. A graveyarded design (preset board variants with 0°/180° rotations, cheat prevention) was superseded by full randomization (PDF pp.12–13).

## Reward structure (actual ladder from config — table)

From sheets **HH** and **HH_v2** of `NEW_LIVEOPS_CALENDAR_ECO.xlsx` (rows 11–16). **The ladders are cell-identical between HH and HH_v2** — the only base-vs-v2 diff in the whole sheet pair is `EventDuration`: **HH = 3, HH_v2 = 4** (row 3). There is no token "price" column: the cost of each tier is the hidden-object board itself (see footprint table above). All-zero columns (SPT, SPT×2, UL Bomb, Avatar, star dailies) omitted.

| Gate | Coins (HC) | Red | Chuck | Bomb | Slingshot | Shuffle | Comet | Unlim. Lives | UL Red | UL Chuck | COOP Token |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gate 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 60 | 0 | 0 | 5 |
| Gate 2 | 10 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 10 |
| Gate 3 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 30 | 0 | 0 | 20 |
| Gate 4 | 15 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 10 | 0 | 50 |
| Gate 5 | 40 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 10 | 70 |
| **Total (full clear)** | **65** | **1** | **1** | **1** | **1** | **1** | **1** | **90** | **10** | **10** | **155** |

Unlimited Lives / UL Red / UL Chuck amounts are *(inferred)* minutes, per project convention; not stated in the sheet. **UL Bomb is 0 on every row** in this event's ladder.

Measured reach (data_event_inst, `avg_final_token_balance` by segment NONPAYER/PAYER): 0-9: 19.6/18.6; 10-19: 49.9/48.5; 20-39: 87.0/81.9; 40-99: 141.1/127.7; 100+: 194.2/169.0. Read against the 128–190 full-clear cost, low segments plateau around Gate 2–3 while 100+ can plausibly full-clear — **if** that column means cumulative tokens earned rather than leftover balance (semantics not documented; see Gaps).

## Duration & cadence

| Source | Duration | Cadence |
|---|---|---|
| Design PDF (p.2) | 3 days (configurable) | — |
| Config HH (`EventDuration`, B3) | **3 days** | — |
| Config HH_v2 (B3) | **4 days** | — |
| `cal_curr` (33-day window, row 20) | 3 days | **5 × 3d**, weekly, **Sat–Mon** starts (days 4, 11, 18, 25, and Sat day 2 of next month — last one clipped at window edge, merge AG20:AH20) |
| `cal_new` (33-day window, row 20) | 4 days | **5 × 4d**, weekly, **Mon–Thu** starts (days 6, 13, 20, 27, plus a clipped run occupying days 1–2, i.e. a 4d run started before the window; merges B20:C20, G20:J20, N20:Q20, U20:X20, AB20:AE20) |
| 2026 live-ops calendar PDF | "Hatchling Hideway, **3 days**" | Every week (weeks 17–53 + weeks 2–3 of next year), LOW INTENSITY slot, "WITH COOP EVENT TOKENS", mostly "Released"/"Repeating Event" |
| Measured analytics (data_event_accrual / data_event_inst) | `instance_length_days` = **4** | `n_instances` = 4 |

Config, cal_curr and the live 2026 calendar all agree the current event is **3 days weekly**; the planned change (HH_v2 / cal_new) is a **lengthening to 4 days**, same 5-per-window cadence, and a start-day shift from weekend (Sat) to weekday (Mon). Note the wrinkle: the measured accrual instances are recorded as 4 days long even though the event is configured at 3d — day 4 adds only ~1–2.5% of tokens, consistent with a 3-day active event plus a trailing partial/claim day (see Gaps #2).

`cal_new` row 20 also contains empty merged Fri–Sun blocks (D20:F20, K20:M20, R20:T20, Y20:AA20, AF20:AH20) with no event name — formatting leftovers or reserved slots; they carry no value and are not HH instances.

## Resources paid

Per HAND_OFF, the sim tracks **11 resources** for this event: HC, Slingshot, Shuffle, Comet, Red, Chuck, Bomb, UL Bomb, UL Chuck, UL Red, Unlimited Lives. From the config ladder:

| Resource | Full-clear amount | Where |
|---|---|---|
| HC (Coins) | 65 | G2 (10), G4 (15), G5 (40) |
| Red (pre-level) | 1 | G1 |
| Chuck (pre-level) | 1 | G2 |
| Bomb (pre-level) | 1 | G3 |
| Slingshot (in-level) | 1 | G5 |
| Shuffle (in-level) | 1 | G4 |
| Comet (in-level) | 1 | G3 |
| Unlimited Lives | 90 (min) | G1 (60), G3 (30) |
| UL Red | 10 (min) | G4 |
| UL Chuck | 10 (min) | G5 |
| UL Bomb | **0** | — (in the sim's 11-resource set but zero in this ladder; `data_gains` has **no UL Bomb rows** for category 'Hatchling Hideaway' — its measured resources are exactly the other 10) |

Also paid but **outside the 11-resource sim scope: COOP Token, 155 per full clear** (the event feeds the co-op event economy — the live calendar explicitly runs HH "WITH COOP EVENT TOKENS"). No SPT, no avatar, no star-daily rewards (all-zero columns).

Actual per-player payout is the gate ladder truncated at the player's furthest opened gate — low segments realistically bank Gates 1–2 (Red, Chuck, 60 UL Lives, a little HC), while HC is concentrated in Gates 4–5. This matches the HAND_OFF observation that HH pays ~0 HC to low segments but real boosters.

## Simulation notes

- **COLLECTION-type event** (established). Sim: `new = measured × R × D × T` via `simCollection('Hatchling Hideaway')`. **Sim currently works** (HAND_OFF status ✅).
- **R = 1** — verified this session: HH_v2 differs from HH **only** in `EventDuration` (3→4); every reward cell identical.
- **D — duration multiplier** from `data_event_accrual`, key **'Hatchling Hideaway'** (n_instances = 4, instance_length_days = 4). Mean `cum_token_share` by event day (NONPAYER/PAYER): day 1: 0.311/0.320 (0-9), 0.332/0.336 (10-19), 0.341/0.340 (20-39), 0.405/0.390 (40-99), 0.539/0.515 (100+); day 2: ~0.63–0.79; **day 3: 0.975/0.978, 0.980/0.981, 0.981/0.980, 0.987/0.985, 0.990/0.986** — i.e. **the accrual saturates around day 3 (≈1)**; day 4 = 1.0 by construction. Medians hit 1.0 at day 3 in every segment.
- **Calendar movement is a LENGTHENING**: 5×3d (cal_curr) → 5×4d (cal_new). Per the established HAND_OFF treatment this is **extrapolation past observed days → D is capped at 1 and flagged**. Practical impact is tiny either way: with day-3 share ≈ 0.98, D for 3→4d is at most ≈ 1/0.98 ≈ 1.02.
- **T — cadence × reach ratio**: instance count is unchanged (5 → 5), so T only moves through per-instance reach (4d Mon–Thu catches slightly more not-daily-active players than 3d Sat–Mon; weekday-vs-weekend active rates apply). *(T mechanics per HAND_OFF §D definitions; exact value computed in-engine.)*
- Engagement/participation (data_event_inst, NONPAYER/PAYER): participation_rate 0.560/0.647 (0-9) rising to ~0.92–0.94 (20-39 and up); opt_in_rate 0.89–0.95 everywhere; recipient_rate recorded as 0.0 for all rows (metric evidently not populated for this event). Strong, broad participation → the event is a stable booster faucet across segments.
- Rewards are **deterministic given furthest gate reached** (fixed chest per gate, no choice, no RNG in payout); the only stochastic element is board-reveal efficiency, which affects tokens-per-gate cost, not chest contents.
- Token-per-level config (1/2/3 for Normal/Hard/Extreme) is unchanged between HH and HH_v2, so measured token accrual remains valid for the v2 sim.

## Sources (PDF pages / sheets per fact)

| Fact | Source |
|---|---|
| Event concept: tokens from levels = moves to reveal hidden objects; extra tokens for Hard/Extreme; 5 gates; gate → narrative + chest + next board; 3-day duration (configurable); 2 starting tokens | Design PDF pp.1–2 |
| Theme (castle in clouds), room progression Garden→Treasure Room, Hatchling/Bomb reveals | PDF pp.2–3 |
| Event badge states (token blip, Reveal / Reveal All / Claim buttons, "Finished") | PDF pp.3–4 |
| Rewards UI: 5 reward tiers/chests, claim-when-you-want, progress bar | PDF p.4 |
| Board table per gate (grids 4×4→8×8, object lists), no-rotation rule, randomized boards | PDF pp.5, 10 (repeated p.13) |
| Token awards PDF spec 1/3/5 (configurable); default tokens 2, FTUE 3 | PDF pp.6, 10 |
| Last Chance & Reveal All (theoretical-max) states | PDF pp.4–5 |
| Analytics goals incl. +6% level wins/day; offline behavior; local notifications (start, T-12h); FTUE preset board; audio; cheats | PDF pp.10–11 |
| Future: token doubler, purchasable tokens; graveyard: board variants w/ 0°/180° rotation, cheat prevention | PDF pp.12–13 |
| EventDuration 3; requiredPlayerLevel 1; requiredSagaLevel 15; token rewards 1/2/3 | `NEW_LIVEOPS_CALENDAR_ECO.xlsx` sheet HH rows 3–8 |
| EventDuration 4 = the **only** diff vs HH | sheet HH_v2 row 3 (rows 4–16 identical to HH) |
| 5-gate reward ladder (all numbers in table above) | sheets HH / HH_v2 rows 11–16 |
| cal_curr 5×3d Sat starts (days 4/11/18/25/+2 clipped) | sheet cal_curr row 20 (merges E20:G20, L20:N20, S20:U20, Z20:AB20, AG20:AH20) |
| cal_new 5×4d Mon starts (days 6/13/20/27 + clipped days 1–2) | sheet cal_new row 20 (merges B20:C20, G20:J20, N20:Q20, U20:X20, AB20:AE20) |
| "Hatchling Hideway, 3 days WITH COOP EVENT TOKENS", weekly LOW INTENSITY slot | `current_live_ops_calendar_2026.pdf` (every week page, weeks 17–53 + 2–3) |
| Accrual curve (day 1–4 cum_token_share by segment/payer; n_instances 4; length 4d) | sheet data_event_accrual, rows with event_name 'Hatchling Hideaway' |
| Participation/opt-in rates, avg_final_token_balance 18.6–194.2 | sheet data_event_inst, rows with event_name 'Hatchling Hideaway' |
| Measured resource set (10 resources, no UL Bomb) | sheet data_gains, category 'Hatchling Hideaway' (120 rows) |
| Sim formula, R=1, D saturates day 3, 5×3d→5×4d lengthening capped+flagged, 11-resource list, sim works | project HAND_OFF facts (§§ R/D/T, status table row 'Hatchling Hideaway') |

## Gaps & open questions

1. **Token-award conflict:** PDF specifies Regular/Hard/Extreme = 1/3/5; ECO config says 1/2/3. Config assumed authoritative (values were explicitly "configurable" in the PDF), but worth confirming which was live during the measured window — it changes the levels-per-token interpretation of the accrual curve, though not the sim (which works on token *shares*).
2. **Measured 4d vs configured 3d:** `data_event_accrual` records `instance_length_days = 4` while config/calendars say the current event is 3 days. Likely a trailing claim/partial day in analytics (day 4 adds only ~1–2.5% of tokens), but it muddies the HAND_OFF framing of 3→4d as "extrapolation past observed days": day 4 *is* nominally observed. Either way D ≈ 1; flag, don't fix.
3. **`avg_final_token_balance` semantics:** total tokens earned, or unspent leftover at event end? Tokens are *spent* in this event (unlike pure threshold events), so leftover ≠ earned; interpretation changes the gate-reach inference in the reward section.
4. **Unlock level:** PDF left it "??? [TODO]"; config says saga level 15 — no third source confirms what's live.
5. **UL Bomb:** in the project's 11-resource list for HH but zero in the ladder and absent from `data_gains` — harmless (contributes 0), but the resource list could be trimmed to 10 for this event.
6. **COOP Token flow (155/full clear) is outside the sim's resource set** — if the co-op event's economy is ever simulated, HH is a scheduled faucet for it (and the 5→5 instance count keeps that flow flat, but 3→4d may raise per-instance completion slightly).
7. **`recipient_rate` = 0.0** for all HH rows in data_event_inst — metric not populated; recipients cannot be cross-checked against participation.
8. **cal_new empty Fri–Sun merges in row 20** (D:F, K:M, R:T, Y:AA, AF:AH) — unlabeled; presumed formatting leftovers, unconfirmed.
9. **Reveal-efficiency distribution** (how many tokens players actually spend per gate between the 128 floor and 190 ceiling) is not in any source; irrelevant to reward sizing (chests are per-gate) but relevant if token purchasing (PDF "Future Considerations") ever ships.
