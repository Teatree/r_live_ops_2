# Red's Challenge (Red Collection) — Mechanics

**Type:** leaderboard | **Sim category:** `Red Challenge` | **Calendar name:** `Red's Challenge` | **Accrual key:** `Red` | **Config sheets:** `Race` / `Race_v2` — the sheet is titled **"All LB Challenges"** and contains a Red's Challenge config block (plus Chuck's, Bomb's, Level Challenge, Flash Race)

> **Documentation status: NO DEDICATED DESIGN DOC EXISTS for Red's Challenge** in this project's materials. Everything below about mechanics is **INFERRED** from the Bomb variant's design doc (`DRBLBomb Collection Bombs Challenge240626125320.pdf`), which explicitly states the Bomb event is "almost exactly the same as Red Collection and Chuck Collection events" and calls Red/Chuck the pre-existing variants. That sentence CONFIRMS family membership and the shared frame; the Red-specific details are inference by symmetry, marked below.

## What it is

A short, repeating **bucketed leaderboard event** — one of the three "bird challenge" variants (Red / Chuck / Bomb). Players score points by activating the event's themed bird (here: **Red**) in the core match-3 game, are placed into competition buckets, and compete for top positions within the event's time limit. Rank at event end determines the reward. Per the Bomb doc, Red Collection **pre-dates** the Bomb variant (Bomb was added as "long hanging fruit" on top of the existing Red and Chuck events); Red is plausibly the original variant, themed on the game's most basic bird.

## Player-facing mechanics

### Shared family mechanics (CONFIRMED for Bomb by its PDF; the PDF asserts the family is "almost exactly the same" across Red/Chuck/Bomb)

- Activate the event's themed bird in core-game levels to score points.
- Players are put into **buckets** and compete against other players for first position within a given time frame.
- Rewards are granted by **final leaderboard position** at event end.
- Design intent: players "will have to approach levels a bit differently for maximum score" — the event nudges play style toward creating/using the themed bird.
- Surfacing: event start popup + persistent event popup (with tooltip or always-visible score element).

### Variant specifics — Red (INFERRED, no source doc)

- **Scoring action (INFERRED):** create and activate **Red birds** in core gameplay, by symmetry with the documented Bomb variant.
- **Unknown:** whether the event includes a Red creation guide (the Bomb variant included one because Bomb was the least-communicated bird; Red, as the most common/basic bird, likely needs no tutorialisation — INFERRED).
- **Unknown:** any Red-specific scoring rules, popup layout, or tutorialisation differences.

## Reward structure (rank-based)

No Red-specific design doc gives rewards, but the workbook DOES hold a config: the `Race` / `Race_v2` sheets are titled **"All LB Challenges"** and contain five config blocks (Red's Challenge, "Chunk's" [sic] Challenge, Bomb's Challenge, Level Challenge, Flash Race), each with `numberOfPositions` 10, `LBSize` 10, and this ladder (identical across all five blocks AND identical in base vs `_v2`):

| Position | Coins (HC) | Booster |
|---|---|---|
| 1 | 200 | 1 Comet |
| 2 | 100 | 1 Shuffle |
| 3 | 50 | 1 Shuffle |
| 4–5 | 0 | 1 Shuffle |
| 6–10 | 0 | 1 Slingshot |

**Caveat:** the same ladder is copy-pasted across all five leaderboard events, so it may be a simplified/modeling ladder rather than the exact live per-event config — unverified against live.

Analytics corroborate the rank-gating: `red_event` pays roughly **100× more HC to the 100+ engagement segment than to 1–9** — last-4-week HC/player/day ≈ **0.2 (1–9) → 19.9 (100+)**. Low-engagement players essentially never place in paying ranks; this is a real economy fact, not missing data.

## Duration & cadence

Live ops today (`current_live_ops_calendar_2026.pdf`): all three challenges live on the weekly **"DAILY LEADERBOARD"** row (alongside Level Race) — one 1-day slot per bird per week, repeating every week of 2026 (Red's is listed first in the row each week).

Sim calendars (`NEW_LIVEOPS_CALENDAR_ECO.xlsx`, 30-day cycle starting Wednesday; grid B5:AH25, merge = instance):

| Calendar | Instances | Days (cycle day #) |
|---|---|---|
| `cal_curr` | **4 × 1d** | 5 (Sun), 14, 21, 28 (Tuesdays) |
| `cal_new` | **3 × 2d** | 1–2 (Wed–Thu), 27–28 (Mon–Tue), 29–30 (Wed–Thu) |

So the redesign **lengthens 1d → 2d and cuts instance count 4 → 3**; `HAND_OFF.md` records it as "Red 3×2d (one clipped)" — the last instance runs to day 30, the exact cycle boundary. Red keeps the most cadence of the three variants and gets a back-to-back pair at cycle end.

## Resources paid

Anchored to `data_gains` (11-resource universe: HC, Slingshot, Shuffle, Comet, Red, Chuck, Bomb, UL Bomb, UL Chuck, UL Red, Unlimited Lives). Headline: HC/player/day ≈ 0.2 (1–9) vs 19.9 (100+), last 4 weeks. Per project guidance, check the non-HC (booster) columns before concluding any segment gets nothing — but for the challenges the dominant story is HC concentrated in high-engagement/high-rank players.

## Simulation notes

- Simulated by `simTimedEvent` in `EcoGainsSim.gs`: **new = measured × R × D × T**, with `cal: "Red's Challenge"`, `accr: 'Red'`.
- **R = 1** — confirmed from `Race` vs `Race_v2`: the Red's Challenge reward ladder is identical in both; only `EventDuration` changes (1 → 2), consistent with the calendars.
- **D** = accrual-curve share at the new duration, normalised to 1 at the current 1-day length, using the `Red` token accrual curve from `data_event_accrual`. The 1→2-day lengthening is **EXTRAPOLATION past observed data** (all measured instances are 1-day) — capped and flagged, comes out **≈ 1**.
- Because the reward is **rank-based**, extra duration barely changes what a given rank pays; the accrual curve is only a proxy. **Recommendation: set D ≈ 1 and let T carry the change.**
- **T** = cadence × reach ratio = Σ reach(days) over `cal_new` instances / Σ over `cal_curr` instances, with reach(days) = 1 − Π(1 − p_d) from weekend/weekday active rates (`data_seg_beh`). For Red this nets 4×1d → 3×2d — the smallest cadence cut in the family, so Red's T should sit highest of the three.
- Works where measured HC > 0; zeros for low segments are legitimate (rank rewards gate them out).

## Sources

- `D:\_projects\r_liveops_2_sim_work\DRBLBomb Collection Bombs Challenge240626125320.pdf` — Bomb variant's doc; source of the family-frame inference (names "Red Collection" as an existing same-family event). **No Red-specific doc exists.**
- `D:\_projects\r_liveops_2_sim_work\current_live_ops_calendar_2026.pdf` — weekly DAILY LEADERBOARD scheduling.
- `D:\_projects\r_liveops_2_sim_work\NEW_LIVEOPS_CALENDAR_ECO.xlsx` — `cal_curr` / `cal_new` grids; `Race` / `Race_v2` ("All LB Challenges") config blocks.
- `D:\_projects\r_liveops_2_sim_work\EcoGainsSim.gs` — `SOURCES['Red Challenge']`, `simTimedEvent`, calendar reader.
- `D:\_projects\r_liveops_2_sim_work\HAND_OFF.md` — sim model, confirmed instance counts ("Red 3×2d (one clipped)"), analytics.

## Gaps & open questions

- **No design doc at all** — every mechanic beyond "same family, Red-themed" is inferred; obtain the original Red Collection design doc if it exists at Rovio.
- **Reward ladder is generic**: the only numbers available are the shared "All LB Challenges" ladder in `Race`/`Race_v2` (identical across all five leaderboard events) — whether it matches the live per-event config is unverified. Bucket size/matchmaking are live-config only. The sim sidesteps this by anchoring to measured `data_gains`.
- **No scoring rule detail**: points per Red activated, combo scoring — undocumented.
- **"One clipped" instance**: the third `cal_new` instance ends exactly on cycle day 30; confirm the calendar reader counts its reach correctly across the cycle boundary (grid columns 31–33 belong to the next cycle's overlap).
- **D for lengthening is extrapolated** — treat as lower-confidence; the D≈1 recommendation makes this moot but should be revisited if a rank-payout-by-duration curve ever becomes available.
