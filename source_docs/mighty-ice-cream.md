# Mighty Ice Cream — Mechanics

**Type:** leaderboard (server `eventType: Wager`) | **Sim category:** `Mighty Ice Cream` | **Calendar name:** `MiC 🍦` (also read: `MIC`, `Mighty Ice Cream`) | **Config sheet:** `Mic_v2` (no base sheet - the event has never run) | **Places from:** `Red` (data_event_inst)

> **Documentation status: server config + design doc (2026-11-11).** The live JSON is kept verbatim at `builders/mic_server_config.json`; the design is `design_pdfs/Mighty Ice Cream (Wager).md`. No telemetry: the behaviour inputs are measured on other events (data_streaks, Red's / Chuck's Challenge) and sit as editable cells on Mic_v2.

## What the server config says

- League (`leagueGroupSize`) of **60**, **25 paid places** (`rewards[]`), `closingTimeMinutes` 60, `requiredSagaLevel` 34, `requiredPlayerLevel` 1.
- `eventType` / `configuration` **Wager**, `boosterMultipliers` red ×1 / chuck ×2 / bomb ×4, `countCreatedBoosters` true, `scoreDoubler` false. The multipliers are the score per bird created (see the design doc below).
- Rewards (mapped like the Race sheets: HardCoin → Coins, SeasonPassToken → SPT, CherryBomb → Comet, Hammer → Slingshot ⚠ not a tracked resource, Pre-Red/Chuck/Bomb → Red/Chuck/Bomb):

| Place | Coins | SPT | Item |
|---|---|---|---|
| 1 | 300 | 400 | Comet |
| 2 / 3 / 4 / 5 | 200 / 150 / 125 / 100 | 300 / 240 / 200 / 160 | Shuffle |
| 6-10 | - | 140 / 125 / 120 / 115 / 110 | Slingshot |
| 11-12 | - | 105 / 100 | Bomb |
| 13-14 | - | 95 / 90 | Chuck |
| 15-16 | - | 85 / 80 | Red |
| 17-25 | - | 75 / 70 / 65 / 60 / 55 / 50 / 45 / 40 / 30 | - |

SPT over the 25 places: 2,955.

## The wager (design doc)

- Every bird created in a level scores - including pre-level boosters and win-streak birds - with Red < Chuck < Bomb (server: 1 / 2 / 4). The level must be WON for its birds to count.
- After each win the player either **submits** (the score goes to the leaderboard, the running score resets to 0) or **keeps going**. A lost level (or a killed app) resets the running score to 0. The choice is forced before returning to the map.
- Leaderboard of 50 by default (configurable; the live JSON says 60), places paid at the close; non-submitted score is discarded.
- Goals: sell +5 moves and boosters to protect a streak; high risk, high reward; a mid-length competitive event.

## How the sim prices it (D103 - places bottom-up)

- A player banks **k x points per win** when they reach **k wins in a row**; k = the measured median of the day's longest win streak (`max_streak_per_day_p50`). Chance to reach k in a festival = 1 - (1 - share of active days reaching k)^(active days in the festival) - measured streaks, not a coin-flip model.
- **Fallback (D104):** a player who never reaches k banks their best streak of the festival instead, so everyone who wins a level is on the board (81-99% of participants by cell). Assumes they bank it at its peak (optimistic). Switch on Mic_v2 row 41.
- Points per win = Red + 2 x Chuck + 4 x Bomb birds per win (Red / Chuck from those challenges' balances per win; Bomb = half of Chuck's), spread across players by Red's balance quantiles.
- League: 59 opponents drawn from all segments by participants per festival (user, 2026-11-11: keep mixed - Red's measured places fall steeply with segment, which is what mixed boards produce; the design doc says nothing about matchmaking); place = 1 + the opponents who banked more. Never banking (no win in the festival) = not on the board, no reward.
- Participation = 0.3 (design value), every input editable on Mic_v2's `Player behaviour (Wager)` table; the local sim (`ECOGAINS_MIC`) re-runs on edit.

## How the sim prices it (D102 - the fallback, `WAGER_BOTTOMUP = false`)

- **Places:** Red's Challenge's measured `position_p25 / p50 / p75` per segment × payer, **as measured** (not rescaled to the 60-player board). Red's board was ~15 players, so the place curve puts 75% of finishes at Red's p75 (≤ 15th) and spreads the rest over 16..60: **81-85% of finishes land in the paid 25** in every cell. Real `Mighty Ice Cream` rows in `data_event_inst` take over automatically; another borrowed event is one cell on `Mic_v2` (`Places from`).
- **Bottom-up**, every resource: per instance `E × participation × reach`, E = Σ P(place) × reward(place), participation = Red's `participation_rate` (0.35-0.45), reach = share of the segment online on at least one of the instance's days. No duration term (a race pays by place).
- **Today** = the same over `cal_curr` (0 while it runs none); once the export carries the event, the export is the level and the model the change.
- SPT reaches the Season Pass tier on the redesign side (so the Season Pass rows and the card sim can move).

## Open questions

- When do real players submit? (k = their median daily max streak is an assumption; nothing measures the decision.)
- How many +5 moves / boosters does protecting a streak sell? (Not modelled - no new spend.)
- Is the league really filled to 60, and are there bots? (Red's measured places say nothing about a 60-player board.)
- Participation: the design doc has no opt-in (the event starts for everyone eligible); the sim uses the design value 0.3 until it is measured.
