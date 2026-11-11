# Mighty Ice Cream — Mechanics

**Type:** leaderboard (server `eventType: Wager`) | **Sim category:** `Mighty Ice Cream` | **Calendar name:** `MiC 🍦` (also read: `MIC`, `Mighty Ice Cream`) | **Config sheet:** `Mic_v2` (no base sheet - the event has never run) | **Places from:** `Red` (data_event_inst)

> **Documentation status: server config only (2026-11-11).** The live JSON is kept verbatim at `builders/mic_server_config.json`; there is no design PDF and no telemetry. Everything about player behaviour is BORROWED from Red's Challenge, by user decision ("treat it like a Race event for now, same as Red's Challenge").

## What the server config says

- League (`leagueGroupSize`) of **60**, **25 paid places** (`rewards[]`), `closingTimeMinutes` 60, `requiredSagaLevel` 34, `requiredPlayerLevel` 1.
- `eventType` / `configuration` **Wager**, `boosterMultipliers` red ×1 / chuck ×2 / bomb ×4, `countCreatedBoosters` true, `scoreDoubler` false. The wager mechanic (what a player stakes and how the multipliers apply) is **not documented** and **not modelled**.
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

## How the sim prices it (D102)

- **Places:** Red's Challenge's measured `position_p25 / p50 / p75` per segment × payer, **as measured** (not rescaled to the 60-player board). Red's board was ~15 players, so the place curve puts 75% of finishes at Red's p75 (≤ 15th) and spreads the rest over 16..60: **81-85% of finishes land in the paid 25** in every cell. Real `Mighty Ice Cream` rows in `data_event_inst` take over automatically; another borrowed event is one cell on `Mic_v2` (`Places from`).
- **Bottom-up**, every resource: per instance `E × participation × reach`, E = Σ P(place) × reward(place), participation = Red's `participation_rate` (0.35-0.45), reach = share of the segment online on at least one of the instance's days. No duration term (a race pays by place).
- **Today** = the same over `cal_curr` (0 while it runs none); once the export carries the event, the export is the level and the model the change.
- SPT reaches the Season Pass tier on the redesign side (so the Season Pass rows and the card sim can move).

## Open questions

- What does a player wager, and what does a booster multiplier do to score? (Changes the place distribution, possibly the booster sink.)
- Is the league really filled to 60, and are there bots? (Red's measured places say nothing about a 60-player board.)
- Does opt-in match Red's (participation_rate) - is the event opt-in at all?
