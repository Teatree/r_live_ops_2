# Jigsaw Puzzle (Jigsaw Challenge / Mystery Puzzle) — Mechanics

**Type:** collection | **Sim category:** `Jigsaw` | **Calendar names/aliases:** `Jigsaw Puzzle` (cal_curr/cal_new), `Mystery Puzzle` (cal_new; alias → Jigsaw), `Mystery Box` (alias listed in HAND_OFF's calendar-reader alias table), "Jigsaw (Generic skin)" / "Jigsaw (Mystery skin)" (2026 live calendar) | **Accrual key:** `Jigsaw` | **Config sheets:** `J` (base) / `J_v2` (redesign)

> **Origin design doc found (2026-07-04):** `design_pdfs/DRBL-ABDB 2021 Valentine's Event-040726-122952.pdf` — the 2021 Valentine's Event spec whose **V3 is the reusable "jigsaw puzzle / threshold collection" backbone** this event reskins ("Valentine themed, but generic backbone that can be used later with other themes … Easy to produce more images for the puzzle"). Everything else below is mined from the redesign deck, the two calendars, and the workbook config/data sheets.

## What it is

A solo **collection event** in the "low intensity" rotation. The redesign deck (p47) describes it verbatim:

> "JIGSAW CHALLENGE / MYSTERY PUZZLE — A collection event where players complete main progression levels to collect small purple puzzle tokens to reveal the Golden Puzzle pieces for rewards. Type: Solo, Collect."

"Mystery Puzzle" / "Mystery skin" is the same event with a different skin — the 2026 live calendar alternates "Jigsaw (Generic skin)" and "Jigsaw (Mystery skin)" every other run, and the sim's calendar reader maps `Mystery Puzzle`/`Mystery Box` → `Jigsaw`.

## Player-facing mechanics (core loop)

- **CONFIRMED** (redesign PDF p47): play main progression levels → collect small purple **puzzle tokens** → tokens reveal **Golden Puzzle pieces** → rewards. Solo, non-competitive.
- **CONFIRMED** (config sheet `J`): progression is a **cumulative-token milestone ladder** — 12 milestones from 30 to 1,930 tokens, each paying a reward bundle.
- **CONFIRMED** (config sheet `J`): gating/tuning knobs: `requiredPlayerLevel = 1`, `requiredSagaLevel = 15`, `tokenMultiplier = 2`, `scoreDoubler = TRUE`.
- **INFERRED**: `tokenMultiplier`/`scoreDoubler` suggest some earn-rate boosting mechanic (e.g. doubled token drops), but their exact player-facing meaning is undocumented.

## Origin design (2021 Valentine's Event PDF — the jigsaw backbone)

The Valentine's doc iterated through three versions; **V1 (season pass + team gifts) and V2 are struck through / superseded, V3 is the shipped framework**:

- **V3 (final): standard token collection + jigsaw threshold reveal.** "Collect event tokens from levels" — tokens spawn in-level ("token spawn rules" are a config), are received on level completion, then fly to the event badge. Each **threshold** reached adds the next jigsaw puzzle piece (12 pieces, predetermined reveal order) and pays that threshold's reward box — i.e. the Golden-Puzzle reveal **is** the milestone ladder, not a separate choice mechanic (V3 explicitly follows "same principles as Halloween"). Configs named in the doc: threshold requirements, rewards per threshold, scheduling, token spawn rules. Event length "around 7 days" in 2021; today's calendar runs it at 4d (3d in cal_new).
- **V2 (designed, cut from V3, "becomes its own generic feature … implemented later"): Completion Bonus tiers.** Points per **level completion**, based on attempts: **Copper 3 / Bronze 5 / Silver 7 / Gold 10** (config-driven defaults). A win steps the tier up one (cap Gold), a loss steps it down one (floor Copper — "players can never drop out of copper"; the harsher reset-to-Copper variant was left to an A/B test). Q&A confirms the tier persists across levels ("does a new level always start with copper? Nope — dependent on player performance, earned and lost just like win streak").
- **Challenge Mode (V3):** after all thresholds are claimed the event flips to a **PvP bucket competition** — players keep scoring, highest total in the bucket wins **medals and avatars** (outside the 11-resource universe; no resource impact).
- **End-of-event rewards:** season-themed avatar + challenge avatar (cosmetic, no resource impact).

**Per-win token model for the play-by-play sim (adopted 2026-07-04):** the V2 tier ladder is the best available mechanical model for what a level completion yields, and the measurement corroborates it: measured `final_balance_p50` (10-19 NONPAYER) ≈ 317 over a 4-day instance ≈ **5.8 tokens per win** at 13.7 wins/day, squarely inside the Copper→Gold mix a 52.6% win rate produces (weighted average of 3/5/7/10 ≈ 5–7). Two corollaries: (a) `tokenMultiplier = 2` is evidently **not** applied on top of the tier points (that would predict ~11/win, double the measured rate); (b) the sim awards the CURRENT tier on each win, then steps the tier (up on win / down on loss), starting the session at Copper — the start tier is an assumption, flagged.

## Reward structure (from config sheets — `J` and `J_v2` ladders are IDENTICAL; only EventDuration differs)

| Milestone | Cumul. tokens | Reward |
|---|---|---|
| 1 | 30 | 1 Chuck booster |
| 2 | 80 | Unlimited Red 10 |
| 3 | 150 | Unlimited Chuck 10 |
| 4 | 250 | Unlimited Lives 30 |
| 5 | 370 | 25 Coins |
| 6 | 520 | 1 Red booster + Unlimited Bomb 10 |
| 7 | 690 | Unlimited Lives 60 |
| 8 | 890 | Unlimited Red 15 |
| 9 | 1,110 | 25 Coins |
| 10 | 1,360 | Unlimited Chuck 15 |
| 11 | 1,630 | 1 Slingshot |
| 12 | 1,930 | Unlimited Lives 60 + Unlimited Bomb 15 |

Full-clear totals: **50 HC**, 1 Red, 1 Chuck, 1 Slingshot, UL Red 25, UL Chuck 25, UL Bomb 25, Unlimited Lives 150 (UL units are presumably minutes — **INFERRED**, not stated anywhere).

Reality check from `data_event_inst` (avg final token balance): 0–9 ≈ 125 (≈ milestone 2–3), 10–19 ≈ 385 (≈ M5), 20–39 ≈ 749 (≈ M7), 40–99 ≈ 1,244 (≈ M9), 100+ ≈ 1,560 (≈ M10). **Even the most engaged players do not on average reach milestone 12**, so the tail rewards are mostly aspirational.

## Duration & cadence

- **Live today** (`current_live_ops_calendar_2026.pdf`): LOW INTENSITY slot, **4 days**, **every 2nd week**, in a weekly rotation with Photoshoot and Bomb's Ballet (cycle: Bomb's Ballet → Jigsaw Generic → Photoshoot → Jigsaw Mystery). Runs all year.
- **Redesign** (deck p46–48): moved into the alternating **weekend collection slot (Friday–Sunday)**, rotating with Bomb's Ballet Show and Photoshoot. Rationale: weekend players complete more levels → more collection opportunities; provides the non-competitive counterweight to the competitive weekend schedule.
- **Sim calendars** (`NEW_LIVEOPS_CALENDAR_ECO.xlsx`, 33-day grid starting Wednesday):

| Calendar | Instances | Placement |
|---|---|---|
| `cal_curr` | **3 × 4d** | starts days 1, 14, 28 (biweekly, midweek start) |
| `cal_new` | **3 × 3d** (incl. Mystery alias) | days 3–5, 17–19, 31–33 (Fri–Sun weekends) |

- **Config EventDuration:** `J` = **4** → `J_v2` = **3**. This is the ONLY base→v2 change (reward ladder byte-identical), consistent with the project-wide finding that every event `_v2` changed only EventDuration.

## Resources paid

Measured (`data_gains`, NONPAYER, HC per earner): 0.37 (A. 0), **0.55 (B. 1–9)**, 7.55 (C. 10–19), 14.0 (D. 20–39), 31.8 (E. 40–99), 32.5 (F. 100+); HC recipient rate 1.2% → 44.8% by segment. The config ladder confirms Jigsaw is mostly a **booster/unlimited-time event** — only 50 HC sits in the whole ladder (M5 + M9), which is why low segments see near-zero coins. Also pays Red/Chuck/Slingshot boosters and UL Red/Chuck/Bomb + Unlimited Lives minutes (all within the 11-resource universe).

## Simulation notes

- Model: **new = measured × R × D × T** (`simTimedEvent` in `EcoGainsSim.gs`, `SOURCES['Jigsaw'] = {cal:'Jigsaw Puzzle', accr:'Jigsaw'}`; calendar alias `Mystery Puzzle`→`Jigsaw Puzzle`).
- **R = 1** — `J_v2` reward ladder identical to `J`; only EventDuration changed.
- **D**: accrual curve **exists** in `data_event_accrual` (`event_name = 'Jigsaw'`). 4d→3d is a **shortening → reliable interpolation** of `cum_token_share_p50`.
- **T**: cadence×reach ratio for 3×4d → 3×3d (same instance count, shorter instances, moved to weekends — weekend active rates from `data_seg_beh` partially offset the lost day).
- Per HAND_OFF: **sim works** for this event ("Bomb's Ballet / Jigsaw / Photoshoot … ✅ works").
- **Impact of the Valentine's doc on the sims (checked 2026-07-04):** the 33-day v4 model (measured × R × D × T), the Daily view and EventReach are all **measured-anchored** — the new mechanics change none of them. The only consumer of the per-win model is `EcoGainsSim_PBP.gs` (play-by-play), which now earns Jigsaw tokens via the V2 tier ladder instead of a smeared average. Challenge Mode pays only medals/avatars → no resource impact anywhere.

## Sources

- `design_pdfs/DRBL-ABDB 2021 Valentine's Event-040726-122952.pdf` — V3 token-collection + jigsaw threshold backbone; V2 Completion Bonus tiers (Copper 3 / Bronze 5 / Silver 7 / Gold 10); Challenge Mode; config list.
- `D:\_projects\r_liveops_2_sim_work\Angry Birds Dream Blast Event Calendar Redesign.pdf` — pp. 46–48 (event description + weekend-slot rationale).
- `D:\_projects\r_liveops_2_sim_work\current_live_ops_calendar_2026.pdf` — LOW INTENSITY row: "Jigsaw (Generic/Mystery skin), 4 days", biweekly all year.
- `D:\_projects\r_liveops_2_sim_work\NEW_LIVEOPS_CALENDAR_ECO.xlsx` — sheets `J`, `J_v2`, `cal_curr`, `cal_new`, `data_gains`, `data_event_inst`, `data_event_accrual`.
- `D:\_projects\r_liveops_2_sim_work\EcoGainsSim.gs` — `SOURCES['Jigsaw']`, `CAL_ALIAS`.
- `D:\_projects\r_liveops_2_sim_work\HAND_OFF.md` — confirmed cal_new 3×3d incl. Mystery; sim-status table.

## Gaps & open questions

- **Which earn rule is live today**: V3 ships "standard token collection" with config-driven spawn rules, while the V2 tier system was deferred to "its own generic feature … later". The measured ~5.8 tokens/win matching the tier mix strongly suggests the tier ladder (or something numerically equivalent) is live, but the live config values (3/5/7/10 were "defaults") are unverified.
- **`tokenMultiplier = 2` / `scoreDoubler = TRUE`**: player-facing meaning still undocumented; measurement argues the multiplier is NOT applied to the tier points (see per-win model above).
- **Session-start tier**: the tier persists across levels/sessions per the Q&A; the PBP sim starts each simulated day at Copper — flagged assumption.
- **UL reward units** (10/15/30/60) are assumed to be minutes of unlimited booster/lives — not confirmed anywhere.
- **Skin variants**: no evidence the Generic vs Mystery skins differ in config/rewards (they map to the same sim event), but this is unverified.
- Whether the live event ladder matches the `J` sheet ladder (the sheet may be a modeling copy, not a live-ops export) — unverified.
