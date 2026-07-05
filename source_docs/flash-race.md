# Flash Race (Chuck's Flash Race) — Mechanics

**Type:** leaderboard (speed race) | **Sim category:** `Flash Race` | **Calendar names/aliases:** `Chuck's Flash Race` (cal grids + redesign deck; alias → `Flash Race`), "Flash Race, With SPT" (2026 live calendar) | **Accrual key:** `Flash Race` | **Config sheets:** `Race` / `Race_v2`, block **"Flash Race"** (the `Race` sheet is "All LB Challenges": Red's/Chuck's/Bomb's Challenge + Level Challenge + Flash Race)

> **No dedicated design PDF exists for this event.** Everything below is mined from the redesign deck, the two calendars, and the workbook config/data sheets.

## What it is

The game's **speed-competition leaderboard event**: matched groups race to finish a fixed set of levels fastest. The redesign deck (p36) describes it verbatim:

> "CHUCK'S FLASH RACE — Competitive event-format where players are matched into a group of 7 players total. The idea of the event is to complete 10 levels as quickly as possible. The Top 3 fastest get rewards accordingly. Winners won't be able to play again on the same day. Type: Solo, Competitive, Win levels. This event requires players to be allowed to play again regardless of whether they win or lose."

The deck calls it "one of the most intense competitive formats in the calendar" (p37).

## Player-facing mechanics (core loop)

- **CONFIRMED** (redesign PDF p36): opt in → matched into a **7-player group** → race to **complete 10 levels as quickly as possible** → **top 3 fastest** get rewards → winners are locked out for the rest of the day; losers may re-enter.
- **CONFIRMED** (2026 live calendar): every live instance is annotated **"With SPT"** — the event pays **Season Pass Tokens** (SPT — INFERRED expansion, consistent with the SPT reward columns used across all workbook config sheets).
- **PROVIDED (project context, not found in these sources):** matchmaking takes **~30–45 s** — treat as analyst-supplied until confirmed.
- **CONFIRMED** (`data_event_inst`): opt-in rate 60–75%, participation of active-window players 18% (0–9) → 67% (100+), median finishing position 4 (0–9) → 2 (100+), `avg_bots = 0` in the measured window.
- **UNKNOWN**: timer mechanics (wall-clock vs play-time), whether level fails cost time or attempts, level pool (current saga levels vs dedicated), re-entry limits for non-winners.

## Reward structure

**Config sheet** (`Race`, "Flash Race" block; identical in `Race_v2`): the same generic LB ladder as all five blocks — `numberOfPositions = 10`, `LBSize = 10`:

| Position | Reward |
|---|---|
| 1 | 200 Coins + 1 Comet |
| 2 | 100 Coins + 1 Shuffle |
| 3 | 50 Coins + 1 Shuffle |
| 4–5 | 1 Shuffle |
| 6–10 | 1 Slingshot |

**This conflicts with the design description** (7-player group, top-3-only rewards) — the config block looks like a generic family template, not a live Flash Race export. **Flag.**

**Measured reality** (`data_gains`): Flash Race pays **essentially zero of the 11 tracked resources across ALL segments** — the only rows present are trace UL Chuck / UL Bomb / Unlimited Lives amounts (≤ 0.0006 per earner) and **no HC rows at all**. Combined with "With SPT", the live reward mix appears dominated by **Season Pass Tokens, which sit outside the 11-resource sim universe**. The HAND_OFF note "HC = 0 for low segments is real (a 0–9 player never places top-3)" is confirmed and in the measured window extends to every segment.

## Duration & cadence

- **Live today** (`current_live_ops_calendar_2026.pdf`): its own **FLASH RACE row**, "Flash Race, With SPT" **3× per week** (spread across the week), every week of 2026, 1-day instances.
- **Redesign** (deck p36–37): moved to **Friday–Sunday weekends**. Rationale: needs long uninterrupted sessions ("complete levels quickly"); synergy with win-streak events — time pressure forces impulsive streak decisions.
- **Sim calendars** (`NEW_LIVEOPS_CALENDAR_ECO.xlsx`, 33-day grid starting Wednesday):

| Calendar | Instances | Placement |
|---|---|---|
| `cal_curr` | **15 × 1d** | days 1, 3, 5, 8, 10, 12, … (Wed / Fri / Sun each week) |
| `cal_new` | **15 × 1d** | days 3–5, 10–12, 17–19, 24–26, 31–33 (Fri + Sat + Sun each weekend, as three 1-day instances) |

Instance count and per-instance duration are **unchanged** — only placement moves (midweek Wed slots → Saturdays).

- **Config EventDuration:** `Race` = 1 → `Race_v2` = **2** for the Flash Race block too — **this contradicts both calendars (still 1-day) and the established fact "duration unchanged"**. Almost certainly an artifact of the v2 sheet setting EventDuration=2 uniformly across all five LB blocks (only the challenges/Level Race actually go to 2 days). The calendar wins. **Flag.**

## Resources paid

Within the 11-resource universe: **effectively nothing measurable** (trace UL minutes only; zero HC in `data_gains` for the window). The real payout is SPT (untracked) plus whatever the live rank ladder grants top-3 — invisible to this dataset. Any sim row for Flash Race will therefore be ≈ 0 by construction.

## Simulation notes

- Model: **new = measured × R × D × T** (`simTimedEvent`; `SOURCES['Flash Race'] = {cal:'Flash Race', accr:'Flash Race'}`; calendar alias `Chuck's Flash Race` → `Flash Race`).
- **R = 1** (ladder identical base vs v2). **D = 1** (duration unchanged 1d→1d; the `Race_v2 EventDuration=2` is treated as an artifact — the sim takes durations from the calendar grids, which keep 1d). An accrual curve **does exist** (`data_event_accrual` `event_name='Flash Race'`) if duration ever changes.
- **T ≈ 1**: 15×1d in both calendars. Note the placement shift (Wed→Sat) means T is not *exactly* 1 for segments whose weekend active rate differs from weekday — a small, intentional effect of the reach model.
- Net per HAND_OFF: **"unchanged by design → sim equals measured."** HC = 0 for low segments is a real economy fact, not a bug.
- `data_event_inst`: 16 instances in the measured window, consistent with the 15×1d cadence.

## Sources

- `D:\_projects\r_liveops_2_sim_work\Angry Birds Dream Blast Event Calendar Redesign.pdf` — p36 (full mechanics), p37 (weekend rationale), pp. 42/45 (synergy mentions).
- `D:\_projects\r_liveops_2_sim_work\current_live_ops_calendar_2026.pdf` — FLASH RACE row, "Flash Race, With SPT" 3×/week all year.
- `D:\_projects\r_liveops_2_sim_work\NEW_LIVEOPS_CALENDAR_ECO.xlsx` — sheets `Race`/`Race_v2` ("Flash Race" block), `cal_curr`, `cal_new`, `data_gains`, `data_event_inst`, `data_event_accrual`.
- `D:\_projects\r_liveops_2_sim_work\EcoGainsSim.gs` — `SOURCES['Flash Race']`, `CAL_ALIAS`.
- `D:\_projects\r_liveops_2_sim_work\HAND_OFF.md` — 15×1d both calendars; sim-status table.

## Gaps & open questions

- **No design doc**; the loop rests on one redesign-deck slide.
- **Config-vs-design conflict**: config block says 10-position ladder / LBSize 10; design says 7-player groups with top-3 rewards. Which is live? Needs user confirmation.
- **`Race_v2` EventDuration = 2 discrepancy**: presumed sheet artifact (calendar keeps 1d) — should be reconciled in the workbook.
- **SPT amounts are unknown** and outside the 11-resource universe — Flash Race's main economic output is invisible to the sim. Decide whether SPT should ever be modeled.
- **Matchmaking window (~30–45 s)** is analyst-provided; not found in any project document.
- **Zero measured HC in every segment** contradicts the nominal 200/100/50 HC ladder — either the live event pays SPT-only, or top-3 HC lands under a different analytics category. Worth a data check.
- Re-entry rules for losers (how many races/day), timer semantics, and bot backfill policy (data shows `avg_bots = 0`) undocumented.
