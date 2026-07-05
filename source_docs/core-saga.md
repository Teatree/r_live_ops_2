# Core / Saga Progression — Mechanics

**Type:** always-on | **Sim category:** Core (Saga folded in; one `Core` row in the display sheet) | **data_gains category label(s):** `Core` (= `chapter_complete`, `PlayerLevelUpChest`) and `Saga` (= `SagaPath`, `SagaChestRewards%`) | **Config sheets:** `c_saga`, `c_saga_v2` in `NEW_LIVEOPS_CALENDAR_ECO.xlsx` (mirrored as `saga_progression_old` / `saga_progression_new` in `1_DAY_NS_TD_5_Segs_V3 (1).xlsx` and, with an older draft of the v2 ladder, in `1. Rainbow_Maker_Sim.xlsx`)

## What it is

The base-game progression reward stream of ABDB: what a player earns simply by beating saga (main-map) match-3 levels, with no live-ops event involved. It is the single largest HC source in the game and the most engagement-amplified one — per the source-disparity analysis, `chapter_complete` is the #1 HC source by absolute gap between segments (1-9: 9.62 HC/day vs 100+: 235.4 HC/day, 24×) and `PlayerLevelUpChest` is #2 (2.6 vs 104.3 HC/day, 40×). Because it is always on, the calendar redesign cannot move it via duration or cadence — only via the reward ladder itself, which is exactly what the `c_saga_v2` redesign does (a −64% HC nerf per progression cycle).

Terminology warning (important): the MVP PDF ("DRBLMVP Dream Album") uses "chapter" for **Dream Album chapters** (sets of 9 collectible snaps). That is NOT the `chapter_complete` of this source. `chapter_complete` here is the saga-map progression reward (inferred: the chest granted every 10 saga levels — see Gaps for the evidence).

## Player-facing mechanics (core loop)

- The player advances through a linear saga map of match-3 levels (the game's "linear progression of the map", contrasted in the PDF with the Album's non-linear track).
- **Saga node / chapter chest (config: `c_saga`):** every **10 completed saga levels** ("Levels Req" = 10 per node) the player claims a node reward — a package of HC (coins) + boosters + Unlimited-Lives minutes. The ladder is a **repeating 10-node cycle** (100 levels per cycle): HC per node escalates within the cycle, then wraps back to node 1. The MVP PDF corroborates a 10-level reward beat: new players see "the 10-level reward animation" (p.32).
- **PlayerLevelUpChest:** a chest granted on player level-up. Its contents are not present in any local config sheet; only measured amounts exist (data_gains `Core` row includes it). The PDF notes the Dream Album is "deeply woven into Win Streaks and Level Chests" (p.7) and envelopes are sourced from "low-tier chests" (p.26) — i.e. level chests are planned to carry Album envelopes as well. (Which chest — the 10-level saga chest vs a separate XP level-up chest — is not distinguished in the docs; inferred to be distinct because the data logs them under different source_details.)
- **SagaPath / SagaChestRewards:** separate saga-related reward source_details grouped as the `Saga` category in data_gains. No design doc or config describing their player-facing mechanics exists in this repo; in the measured 33-day window they pay ≈0 per earner in every segment/resource (see Simulation notes).
- Core progression interacts with live-ops: the Event Eco investigation found `chapter_complete` HC/day declined ~10% (25.2 → 22.6 overall) in weeks when Dream Heist / events spiked — hypothesised as **behavioural substitution** (players spending their session on events instead of saga levels), not a reward tuning change. `PlayerLevelUpChest` declined in step (100+: 113 → 99 HC/day, −12%), consistent with "less progression ⇒ fewer level-ups".
- Feature gating rides on saga progress (e.g. Dream Album unlocks "after level 27 (configurable)", PDF p.31) — saga level is the game's spine.

## Reward structure (actual ladders/numbers from configs)

### Base config (`c_saga` — "Saga Progression - OLD Config")

10-node repeating cycle, 10 levels per node (100 levels/cycle). Non-HC items per node, with the sheet's coin-equivalent "Coin Val" for the item package (basis of the valuation is the sheet's own; it matches `item_vals` for node 1 — Red 33.33 + Bomb 66.67 = 100 — but not obviously for all nodes, so treat as sheet-given):

| Node | Levels req | HC | Items | Coin Val |
|---|---|---|---|---|
| 1 | 10 | 15 | Red ×1, Bomb ×1 | 100 |
| 2 | 10 | 15 | Chuck ×1, Unlimited Lives 15 min | 112.55 |
| 3 | 10 | 15 | Red ×1, Unlimited Lives 15 min | 95.55 |
| 4 | 10 | 20 | Red ×1, Unlimited Lives 15 min | 95.55 |
| 5 | 10 | 20 | Red ×1, Shuffle ×1 | 100 |
| 6 | 10 | 20 | Slingshot ×1, Unlimited Lives 15 min | 229.55 |
| 7 | 10 | 25 | Shuffle ×1, Unlimited Lives 30 min | 192.1 |
| 8 | 10 | 25 | Chuck ×1, Slingshot ×1 | 217 |
| 9 | 10 | 25 | Chuck ×1, Unlimited Lives 60 min | 300.2 |
| 10 | 10 | 30 | Bomb ×1, Comet ×1 | 117 |
| **Total/cycle** | **100** | **210** | | |

**HC per level = 2.1** (210 HC / 100 levels).

### Redesigned config (`c_saga_v2` — "NEW Config (5-segment scheme)")

The sheet carries five segment columns (`0-9`, `10-19`, `20-39`, `40-99`, `100+`) but **all five are currently identical** — the scheme allows per-segment ladders, none are differentiated yet. HC moves to an alternating pattern (odd nodes pay, even nodes pay 0 HC but still give items); item composition also changes:

| Node | Levels req | HC (all segs) | Items (new) | Coin Val new | Coin Val old | Δ |
|---|---|---|---|---|---|---|
| 1 | 10 | 10 | Red ×1, UL Lives 15 min | 95.55 | 100 | −4.45 |
| 2 | 10 | 0 | Red ×1, Chuck ×1, UL Lives 15 min | 145.55 | 112.55 | +33 |
| 3 | 10 | 10 | Bomb ×1, UL Lives 15 min | 129.55 | 95.55 | +34 |
| 4 | 10 | 0 | Red ×1, Shuffle ×1, UL Lives 15 min | 162.55 | 95.55 | +67 |
| 5 | 10 | 10 | Bomb ×1, UL Lives 15 min | 129.55 | 100 | +29.55 |
| 6 | 10 | 0 | Chuck ×1, Comet ×1, UL Lives 20 min | 183.4 | 229.55 | −46.15 |
| 7 | 10 | 10 | Bomb ×1, UL Lives 20 min | 150.4 | 192.1 | −41.7 |
| 8 | 10 | 0 | Chuck ×1, Slingshot ×1, UL Lives 30 min | 342.1 | 217 | +125.1 |
| 9 | 10 | 10 | Shuffle ×1, UL Lives 60 min | 317.2 | 300.2 | +17 |
| 10 | 10 | 25 | Comet ×1, UL Lives 60 min | 300.2 | 117 | +183.2 |
| **Total/cycle** | **100** | **75** | | | | |

**HC per level = 0.75.** `% of not nerfed` = **0.3571** (75/210).

### Reference ladders in `c_saga_v2` ("Original" / "Old Nerf" columns)

- **Original**: 15, 15, 15, 20, 20, 20, 25, 25, 25, 30 = **210**/cycle (2.1/level) — identical to `c_saga`.
- **Old Nerf**: 10, 10, 10, 10, 10, 15, 15, 15, 15, 20 = **130**/cycle (1.3/level; 0.619 of original). Inferred to be the earlier nerf variant tested with the Night Sky test — the Rainbow Maker workbook's old sheets warn: "This is the old saga BEFORE NS Test. If NS gets baselined, it would be prudent to update this."

### Earlier draft of the v2 ladder (`1. Rainbow_Maker_Sim.xlsx` → `saga_progression_new`)

Single-segment sheet, harsher nerf; superseded by the 75-HC ladder above:
HC per node = 10, 0, 10, 0, **0**, 0, 10, 0, 10, **20** → **60**/cycle, **0.6 HC/level, 0.2857 of base**. (Differences vs current v2: node 5 pays 0 instead of 10 and node 10 pays 20 instead of 25; some item packages differ, e.g. node 5 = Chuck+Bomb+UL 15 min.) The `1_DAY_NS_TD_5_Segs_V3 (1).xlsx` sheets are byte-identical in values to `c_saga`/`c_saga_v2` — the RM workbook is the only one that diverges.

### Measured anchor (`data_gains`, 33-day window, amount_per_earner, NONPAYER, HC)

| Segment | Core (chapter_complete + PlayerLevelUpChest) | Saga (SagaPath + SagaChestRewards%) | Daily rate cross-check (Event Eco, chapter_complete only) |
|---|---|---|---|
| A. 0 | 1.1 | 0.0 | — |
| B. 1-9 | 88.2 | 0.0 | 9.62 HC/day |
| C. 10-19 | 183.4 | 0.0 | — |
| D. 20-39 | 323.2 | 0.0 | — |
| E. 40-99 | 710.5 | 0.01 | — |
| F. 100+ | 1315.8 | 0.0 | 235.4 HC/day |

(PAYER rows similar but slightly lower for high segments: 100+ PAYER Core = 1141.2.) Core also pays measured boosters, e.g. B. 1-9 NONPAYER: Red 1.79, Chuck 1.70, Shuffle 1.42, Slingshot 1.25, Comet 0.86, Bomb 0.60, Unlimited Lives 70.2 min per earner.

## Base vs v2 (redesign) changes

- **HC: 210 → 75 per 100-level cycle (R = 75/210 = 0.357, a −64.3% nerf).** Delivery pattern changes from "every node pays, escalating 15→30" to "only odd nodes + node 10 pay (10 each, 25 at node 10); even nodes pay 0 HC".
- **Item packages are reshaped, mostly upward** (per the sheet's Coin Val: net +396.55 coin-equivalent per cycle across the 10 nodes) — Unlimited Lives minutes appear on every node in v2 (15/15/15/15/15/20/20/30/60/60 min = 265 min/cycle vs 150 min/cycle in base), partially compensating the HC cut with untradeable value.
- **Per-segment differentiation is scaffolded but unused** — all five segment columns in `c_saga_v2` are identical today.
- Levels-per-node (10) and cycle length (10 nodes) are unchanged — so the nerf is purely a reward-ladder R, no pacing change.
- History of the nerf target: Original 2.1 HC/level → "Old Nerf" (NS test) 1.3 → RM-sim draft 0.6 → current v2 0.75.

## Resources paid

Of the 11 sim resources: **HC** (coins), **Red**, **Chuck**, **Bomb**, **Slingshot**, **Shuffle**, **Comet**, **Unlimited Lives** (minutes). Never in either saga config: **UL Bomb, UL Chuck, UL Red** (all-zero columns), and SPT. Measured `Core` in data_gains confirms the same set (plus ≈0 traces elsewhere). `PlayerLevelUpChest` contents are only visible through the aggregated measured Core row.

## Simulation notes (R×D×T mapping, modeling approaches used so far)

- **Model:** `new_per_earner = measured × R × D × T` with **D = T = 1** (always-on, no calendar instances). Only R applies. R is computed as **cycle-average HC/level ratio: (75/100) / (210/100) = 0.357**.
- **data_gains split:** the query emits two categories — `Core` (`chapter_complete`, `PlayerLevelUpChest`) and `Saga` (`SagaPath`, `SagaChestRewards%`). The split was introduced so the saga reward change could be simulated as a bounded delta (avoiding an earlier negative-gains bug). The display sheet re-folds them into a single `Core` row.
- **Current engine (`EcoGainsSim.gs` → `simCoreSaga`):** `Core_sim[HC] = Core_measured[HC] + Saga_measured[HC] × (v2CycleAvg / baseCycleAvg)`; non-HC resources are carried through unchanged (`Core + Saga` measured). `readSagaV2_` picks the segment column from `c_saga_v2`, so per-segment ladders are supported the moment the sheet differentiates them.
- **⚠️ Consequence of measured Saga ≈ 0:** because the ratio is applied only to the `Saga` row and that row is ≈0 per earner in the current data_gains snapshot, **the simulated Core HC is currently ≈ the measured Core HC — the −64% c_saga nerf produces almost no visible delta in the sim output.** If the `c_saga` ladder actually corresponds to `chapter_complete` (evidence below), the ratio is being applied to the wrong row and the nerf's effect is materially under-stated. Flagged as the key open modeling question for this source.
- **Earlier sim #1 (NS Economy sim, per `NS_Economy_Sim_Summary.md`):** deterministic — `levels/day ÷ 10 = nodes claimed/day`, each node paying from the repeating 10-node table via MOD/INDEX; cumulative tables via SUMPRODUCT. (That summary quotes the node range as "12–30 HC", which matches neither the base 15–30 nor any local ladder — see Gaps.)
- **Earlier sim #2 (`1_DAY_NS_TD_5_Segs_V3 (1).xlsx` → `Sim per Segment`):** `saga_new (sim) = avg_completes/day (data) × saga_progression_new HC-per-level` (cell `$C$17` = 0.75, per-segment columns E/G/I/K identical), compared against `saga old (data)` from `data_processed`. Mathematically equivalent to the nodes/day approach (both use cycle-average HC/level), and it anchors on measured completes rather than assuming node alignment.
- Evidence that `c_saga` ≈ `chapter_complete` (inferred, strong): base 2.1 HC/level × ~112 levels/day ≈ 235 HC/day = the measured `chapter_complete` rate for 100+ (235.4); for 1-9, 9.62/2.1 ≈ 4.6 levels/day, plausible for that segment.

## Sources

- `NEW_LIVEOPS_CALENDAR_ECO.xlsx` → `c_saga`, `c_saga_v2` (full ladders, totals, HC/level, Original/Old Nerf columns, Coin Val); → `data_gains` (measured Core/Saga per-earner values, category list).
- `1_DAY_NS_TD_5_Segs_V3 (1).xlsx` → `saga_progression_old/new` (identical to c_saga/c_saga_v2), `Sim per Segment` (saga_new formula), `notes` (Redash query refresh order).
- `1. Rainbow_Maker_Sim.xlsx` → `saga_progression_old/new` (earlier 60-HC v2 draft; "BEFORE NS Test" warning), `item_vals` (coin-equivalent item values).
- `resource_share_by_category_period_v2.sql` lines 250–251 (source_detail → category mapping; note this local v2 file maps all four source_details into `Core` — the Core/Saga split seen in `data_gains` comes from a newer query revision not present in the repo).
- `DRBLMVP Dream Album190526105102.pdf` p.7 ("Level Chests", "linear progression of the map"), p.26 (envelopes from "low-tier chests"), p.31 (Album unlock after level 27), p.32 ("10-level reward animation").
- `HAND_OFF.md` §1a, §2, §5 (model, split rationale, per-source table); `Event_Eco_Investigation_Context.md` §5.3, §5.7, §5.8 (chapter_complete / PlayerLevelUpChest trends and disparity); `NS_Economy_Sim_Summary.md` (earlier saga model).

## Gaps & open questions

1. **Which data label does `c_saga` configure?** Inferred (not stated anywhere) that the 10-node ladder = `chapter_complete`. If true, the engine's ratio should apply to the measured `Core` row (or at least its chapter_complete share), not the ≈0 `Saga` row — otherwise the redesign's biggest single nerf is invisible in the sim. Needs confirmation against the live game config / a source_detail-level query.
2. **What are `SagaPath` and `SagaChestRewards` mechanically?** No design doc; measured ≈0 per earner in this window. Are they deprecated, dormant, or capped out of the 33-day window?
3. **`PlayerLevelUpChest` contents/config are absent** from the repo — the sim can only carry its measured value; a reward-ladder R cannot be computed for it. Also unresolved: is it the same thing as the 10-level chest or a separate XP-level chest?
4. **NS summary discrepancy:** `NS_Economy_Sim_Summary.md` describes the saga node table as "12–30 HC", which matches no ladder here (base is 15–30, Old Nerf 10–20, v2 0–25). Probably an older config revision in that (absent) workbook.
5. **Coin Val basis is unclear** — matches `item_vals` for node 1 but not reproducible for all nodes with the listed per-item values; treat as sheet-given.
6. The MVP PDF is a **Dream Album** spec; it contains almost nothing about saga-map reward tuning. No PDF in the repo documents the saga chest flow itself — everything above the config level is inferred from configs + data.
7. The v2 per-segment columns are identical today; if they diverge later, R becomes segment-dependent (the engine already supports this via `readSagaV2_(seg)`).
