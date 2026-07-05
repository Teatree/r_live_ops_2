# Level Race — Mechanics

**Type:** leaderboard | **Sim category:** `Level Race` (analytics: `race_event`) | **Calendar names/aliases:** `Level Race` (both calendar grids and both PDFs) | **Accrual key:** none (no curve exists) | **Config sheets:** `Race` / `Race_v2`, block **"Level Challenge"** (the `Race` sheet is titled "All LB Challenges" and holds five config blocks: Red's, Chuck's ["Chunk's"], Bomb's Challenge, **Level Challenge = Level Race**, and Flash Race)

> **No dedicated design PDF exists for this event.** Everything below is mined from the redesign deck, the two calendars, and the workbook config/data sheets.

## What it is

A solo **leaderboard event** in the "daily leaderboard" family (with the Red/Chuck/Bomb bird challenges), scored by level completion rather than booster activation. The redesign deck (p25) describes it verbatim:

> "LEVEL RACE — Players climb the leaderboard to win rewards by completing levels. Type: Solo, Competitive, Win levels."

It is the **biggest coin event for low-engagement segments** (~9 HC per earner at 1–9 non-payers), because its scoring (just complete levels) doesn't gate low-skill players out the way booster-activation challenges do.

## Player-facing mechanics (core loop)

- **CONFIRMED** (redesign PDF p25): complete core levels → climb a leaderboard → rank at event end pays rewards.
- **CONFIRMED** (config sheet `Race`, "Level Challenge" block): leaderboard of **10 players** (`LBSize = 10`), rewards for all **10 positions** (`numberOfPositions = 10`).
- **INFERRED**: players are bucketed into 10-player groups like the sibling bird challenges (same sheet, same structure); scoring is presumably 1 point per level completed (name + "Win levels" type), but no scoring rule is documented.
- **UNKNOWN**: matchmaking/bucketing rules, tie-breaking, whether failed attempts matter, opt-in vs auto-enroll.

## Reward structure (from config sheets)

The "Level Challenge" ladder in `Race` is **identical to all five LB-challenge blocks** (and identical in `Race_v2` — only EventDuration changes):

| Position | Reward |
|---|---|
| 1 | **200 Coins + 1 Comet** |
| 2 | 100 Coins + 1 Shuffle |
| 3 | 50 Coins + 1 Shuffle |
| 4–5 | 1 Shuffle |
| 6–10 | 1 Slingshot |

Caveat: the five blocks being byte-identical suggests this sheet is a **generic modeling template** for the LB family, not necessarily a live-ops export of Level-Race-specific values (see Gaps).

Measured corroboration (`data_gains`, NONPAYER, HC per earner): 1.50 (A. 0), **9.36 (B. 1–9)**, 37.3 (C. 10–19), 58.7 (D. 20–39), 90.0 (E. 40–99), 88.2 (F. 100+); HC recipient rate 2.6% → 59.8% by segment. Rank-gating is much softer than for Flash Race / bird challenges — low segments actually receive coins here.

## Duration & cadence

- **Live today** (`current_live_ops_calendar_2026.pdf`): lives on the weekly **DAILY LEADERBOARD** row — "Red's Challenge / Chuck's Challenge / Bomb's Challenge / Level Race" — i.e. one 1-day Level Race slot per week, every week of 2026.
- **Redesign** (deck p26): the four daily-leaderboard events move to **Monday–Tuesday and Wednesday–Thursday pairs, one event family per week**. Rationale: "By splitting it into two short competitions, players get frequent resets and multiple opportunities to compete without requiring a full-week commitment", creating a midweek reset that supports Rainbow Maker / Hatchling Hideaway progression; Flock Flurry provides the session-start layer these build on.
- **Sim calendars** (`NEW_LIVEOPS_CALENDAR_ECO.xlsx`, 33-day grid starting Wednesday):

| Calendar | Instances | Placement |
|---|---|---|
| `cal_curr` | **4 × 1d** | days 4, 13, 20, 27 (roughly weekly) |
| `cal_new` | **2 × 2d** | days 20–21 (Mon–Tue) + 22–23 (Wed–Thu) — its one dedicated week per 4-week cycle |

- **Config EventDuration:** `Race` = **1** → `Race_v2` = **2** (matches the 1d→2d calendar change). Reward ladder unchanged.

## Resources paid

HC-dominant (see table above) plus the ladder's 1 Comet / Shuffles / Slingshots per bucket of 10 players. Within the 11-resource universe (HC, Slingshot, Shuffle, Comet, Red, Chuck, Bomb, UL Bomb, UL Chuck, UL Red, Unlimited Lives) it pays HC, Comet, Shuffle, Slingshot only (per config ladder).

## Simulation notes

- Model: **new = measured × R × D × T** (`simTimedEvent`; `SOURCES['Level Race'] = {cal:'Level Race', accr:null}`). Maps to `data_gains` category **'Level Race'** (analytics `race_event` was moved into this category).
- **R = 1** — `Race_v2` changed only EventDuration.
- **D = 1 (forced)** — **no accrual curve exists** for Level Race in `data_event_accrual` (confirmed: event list is Bomb, Bombs Ballet, Chuck, Dream Heist, Dream Pass, Flash Race, Flock Flurry, Hatchling Hideaway, Jigsaw, Photoshoot, Red, River Rush, Target Day — no Level Race). Known TODO: build one. Mitigation: reward is rank-based, so duration's effect on payout is weak and T carries the change; HAND_OFF flags this as acceptable ("✅ works").
- **T** = cadence × reach for 4×1d → 2×2d.
- Level Race is also **absent from `data_event_inst`** (no participation/position metadata).
- **Analytics warning:** `race_event` had a clean step-change **UP ~2026-04-13 (+30–40%**, ~3.4 → ~4.7), strongly suggesting a reward tuning increase (`Event_Eco_Investigation_Context.md` §5.5). Any measured anchor spanning that date mixes two reward regimes.

## Sources

- `D:\_projects\r_liveops_2_sim_work\Angry Birds Dream Blast Event Calendar Redesign.pdf` — p25 (description), p26 (Mon–Tue / Wed–Thu split rationale), p29 (Flock Flurry synergy).
- `D:\_projects\r_liveops_2_sim_work\current_live_ops_calendar_2026.pdf` — weekly DAILY LEADERBOARD row.
- `D:\_projects\r_liveops_2_sim_work\NEW_LIVEOPS_CALENDAR_ECO.xlsx` — sheets `Race`/`Race_v2` ("Level Challenge" block), `cal_curr`, `cal_new`, `data_gains`.
- `D:\_projects\r_liveops_2_sim_work\EcoGainsSim.gs` — `SOURCES['Level Race']` (accr:null), header flag (3).
- `D:\_projects\r_liveops_2_sim_work\HAND_OFF.md` / `Event_Eco_Investigation_Context.md` — sim status, cal instances, 04-13 tuning step.

## Gaps & open questions

- **No design doc at all** — the loop is one sentence in the redesign deck plus a generic config block.
- **No accrual curve → D forced to 1.** Highest-priority data gap (explicit project TODO). Needs a cumulative-score/rank-by-day curve for 1-day instances extended to 2 days.
- **Config ladder authenticity**: the "Level Challenge" ladder is identical to all other LB blocks — is 200/100/50 HC the real live ladder for Level Race, and is it pre- or post- the **2026-04-13 +30–40% reward tuning**? Needs user/live-config confirmation.
- **Scoring rule** (points per level, fails, tie-breaks) and **bucket/matchmaking** rules undocumented.
- **No instance metadata** (`data_event_inst` has no Level Race rows) — participation, opt-in, and typical finishing position are unknown; can't validate the recipient-rate story the way we can for Flash Race.
- Why does the biggest low-seg coin event pay ~9 HC per earner at 1–9 when position 3 alone pays 50 HC? (Likely most earners place 4th–10th and earn boosters, with per-earner HC diluted — INFERRED, unverified.)
