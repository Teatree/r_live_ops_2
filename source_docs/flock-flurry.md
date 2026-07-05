# Flock Flurry (Flock Rush) — Mechanics

**Type:** leaderboard (1-hour sprint) | **Sim category:** `Flock Flurry` (analytics source_detail: `FlockRush`) | **Calendar name:** `Flock Flurry` (both grids) | **Accrual key:** `Flock Flurry` (exists; saturates day 1) | **Config sheets:** `F` / `F_v2` (byte-identical)

## What it is

A **1-hour competitive sprint**: 5 players (configurable) compete to collect the most **tokens**; the top finisher takes the rewards. Internally named **Flock Rush** — which is why grant telemetry logs it as `source_detail = 'FlockRush'`. The redesign deck positions it as the daily "session-start layer" the longer events build on.

## Player-facing mechanics (core loop)

All CONFIRMED from the design PDF unless noted:

1. **Opt in** → the event **grants 1 hour of Unlimited Lives** and the 1-hour session starts. ⚠ This join grant — not the reward ladder — is what shows up as the large Unlimited Lives amounts in `data_gains` (see Resources paid).
2. **Scoring:** tokens are awarded from points = (chain multiplier for successive bird explosions in one move) × (sum of per-bird points; higher-level birds score more) × (level difficulty multiplier).
3. **Availability vs session:** the event is **available for 24 hours** but a joined session **lasts 1 hour**; joinable at any point in the availability window (even at 23:59, with Ghosts as fallback). Ops note: the calendar slot is set up 1 hour longer than what the player sees (a "24-hour" event runs 25h).
4. **Rewards:** granted "primarily only" to the **top player**; config allows paying more positions (live config pays position 1 only).
5. **Ghost system (flagged TO BE UPDATED in the PDF):** boards are backfilled with ghost archetypes that accrue a preassigned final score in 180-second ticks over the hour. Measured `avg_bots = 0` in `data_event_inst`, so real-player fill dominated the measured window.
6. **CS compensation macro** (PDF): players who couldn't participate get "1 of each bird power-up and one slingshot power-up" — i.e. the position-1 bundle minus SPT. Corroborates the live ladder contents.

**UNKNOWN:** matchmaking rules, re-entry (once per 24h availability?), the exact per-bird point values and chain multiplier steps (the PDF's reward sheet link is an inaccessible Google Drive doc).

## Reward structure (config sheets F / F_v2 — identical)

Config panel: `Total Players = 5`, `Days = 1`, `Level unlock = 27`, `EventDuration = 1`.

| Position | Reward |
|---|---|
| 1 | **20 SPT + 1 Red + 1 Chuck + 1 Bomb + 1 Slingshot** |
| 2–5 | nothing (all-zero rows) |

Winner-take-all. Note SPT is outside the 11-resource sim universe (same situation as Flash Race), so the tracked portion of the win bundle is the four boosters.

## Duration & cadence

- **Live today** (`current_live_ops_calendar_2026.pdf`): near-daily 1-day slots.
- **Sim calendars:** `cal_curr` **18×1d** and `cal_new` **18×1d** — cadence and duration unchanged; `F_v2 == F` exactly, so **R = 1, D = 1, T ≈ 1** (placement identical). This is why the engine **carries** Flock Flurry (= measured, diff 0).
- `data_event_accrual` has Flock Flurry rows (`instance_length_days = 2`, day-1 share ≈ 0.98) — trivially saturated, unused.

## Resources paid (measured, `data_gains`, 30-day window)

Two distinct streams, both confirmed by the mechanics above:

- **Unlimited Lives (join grant, not a prize):** 36 → 143 min/earner rising with segment; per-recipient 114–264 min ≈ 2–4 joins × 60 min; recipient rates 31% → 74% closely track the opt-in rates in `data_event_inst` (0.32 → 0.68). Flock Flurry is one of the game's biggest free UL-minutes sources.
- **Bird boosters + Slingshot (the position-1 prize):** Red/Chuck/Bomb/Slingshot each ~0.06 (A. 0) → ~1.1 (E. 40-99) per earner; per-recipient 1.1–2.4 of each (multiple wins across ~18 instances). No HC, no Comet/Shuffle — matches the ladder exactly.

`data_event_inst` (NONPAYER): participation 0.24 → 0.67, opt-in 0.32 → 0.68, `position_p50` 3 (0-9) → 1 (40-99, 100+), avg final tokens 1,123 → 8,884, bots 0.

## Simulation notes

- **Main engine:** carried (`SOURCES` has no Flock Flurry entry) — correct while `F_v2 == F` and the calendars match. If a future `_v2` changes the ladder or cadence, it becomes a standard leaderboard sim: `measured × T` with R from the ladder pair.
- **Reach sheet (`EventReach_LB_v1.xlsx`):** rank-percentile lookup — `position_pXX` from `data_event_inst` → F_v2 ladder row. A p50 player in low segments (rank 3) lands **below the ladder's paying range**; only rank 1 pays. The UL join grant is NOT in the reach table (it's unconditional on rank; see stream split above).
- Zero-semantics reminder: Flock Flurry's HC cell in any sim table is a **legitimate 0** (event pays no coins at any rank).

## Sources

- `D:\_projects\r_liveops_2_sim_work\NESTFlock Flurry180526132620.pdf` — design doc (4 pp.): 1-hour/5-player loop, token scoring, 24h+1h duration rule, opt-in UL grant, top-1 rewards, ghost system, CS compensation macro. Reward-sheet link inaccessible (Drive sign-in).
- `D:\_projects\r_liveops_2_sim_work\NEW_LIVEOPS_CALENDAR_ECO (5).xlsx` — sheets `F`/`F_v2` (config + ladder), `cal_curr`/`cal_new` (18×1d both), `data_gains` category "Flock Flurry", `data_event_inst` / `data_event_accrual` rows.
- `resource_share_by_category_period_v2.sql` — `source_detail = 'FlockRush'` → category "Flock Flurry".
- `HAND_OFF.md` — carried status, 18×1d cadence.

## Gaps & open questions

1. **Token scoring values** (per-bird points, chain multiplier steps, difficulty multipliers) live in an inaccessible Drive sheet — irrelevant while the event is carried, needed only if a redesign touches scoring.
2. **Re-entry rule** within the 24h availability window undocumented (per-recipient ≈ 2–4 UL grants/window is consistent with one join per instance across ~18 instances, not multiple joins per day — INFERRED).
3. **Ghost score ranges** were "best estimates" pending a Tier-3 launch; measured `avg_bots = 0` suggests ghosts rarely fire in practice — unverified.
4. **SPT (20 per win)** is untracked by the 11-resource universe; if SPT ever enters scope, Flock Flurry is a daily source of it for high segments (p50 rank 1).
