# Mighty Ice Cream — Mechanics

**Type:** leaderboard (server `eventType: Wager`) | **Sim category:** `Mighty Ice Cream` | **Calendar name:** `MiC 🍦` (also read: `MIC`, `Mighty Ice Cream`) | **Config sheet:** `Mic_v2` (no base sheet - the event has never run) | **Places from:** `Red` (data_event_inst)

> **Documentation status: server config + design doc + LIVE RESULTS (2026-11-11, `data_mic`).** The live JSON is kept verbatim at `builders/mic_server_config.json`; the design is `design_pdfs/Mighty Ice Cream (Wager).md`. No telemetry: the behaviour inputs are measured on other events (data_streaks, Red's / Chuck's Challenge) and sit as editable cells on Mic_v2.

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

## What the live event showed (data_mic, D105)

| Segment | Participation (of active) | Top score p25 / p50 / p75 / p90 | Avg | Share of a board |
|---|---|---|---|---|
| 0-9 | 0.512 | 77 / 124 / 196 / 349 | 184 | 0.56 |
| 10-19 | 0.713 | 162 / 242 / 441 / 863 | 411 | 0.26 |
| 20-39 | 0.761 | 239 / 400 / 856 / 1,671 | 756 | 0.13 |
| 40-99 | 0.812 | 366 / 725 / 1,722 / 3,657 | 1,532 | 0.045 |
| 100-249 | 0.882 | 562 / 1,284 / 3,574 / 7,318 | 2,979 | 0.003 |
| 250+ (18 players) | 1.0 | 877 / 4,218 / 8,053 / 27,957 | 6,984 | 0.0 |

- Leaderboards held **16.3 players on average** (28,142 boards), not the 60 of leagueGroupSize: with 25 paid places every participant is paid.
- Mixed boards confirmed (0-9 sits on 93.5% of boards, 40-99 on 50%). No payer split in the pull.
- The D103 streak model ran 1.6-1.8x high from 10-19 up; the places are now built from these scores (D105).

## How the sim prices it (D105 - on the measured scores)

- A participant's score = their segment's measured top-score distribution; the board = `League size` seats (16.3) drawn by opponent share; place = 1 + the opponents who scored more.
- Participation = the segment's measured share (or the override cell); every input is a cell on Mic_v2 reading data_mic.
- The local sim adds the reward's VALUE at item_vals row 3 per festival entered and per player online.

## How the sim prices it (D103 - places bottom-up, the D104-layout table)

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
- Why 16.3 players per board when leagueGroupSize is 60? (Matchmaking window, or boards closing as the event ends?)
- Participation is measured (0.51-0.88 of active players); the override cell on Mic_v2 sets one value for every segment.
