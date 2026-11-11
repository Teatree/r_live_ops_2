# Mighty Ice Cream sim: accuracy review (2026-11-11)

Workbook: `🔦LIVE_OPS_V3 - Kite Festival - MiC 🍦 (1)` (dump `harness/_mockdata_v3w.json`). Engine D105b.
Sensitivities: `node harness/_probe_mic_risk.js --data v3w`.

The engine reproduces its inputs exactly (local sim = engine to 3e-16, hand-computed places = engine, gates 28/28).
The prices rest on three assumptions nothing in the data verifies: board size, the segment mapping, and the places themselves.

Values below are item_vals coins-equivalent per player per 28-day window, current ladder, for four reference cells:
0-9 NONPAYER / 20-39 PAYER / 40-99 PAYER / 100-249 PAYER = **65 / 270 / 404 / 424**.

## 1. Workbook issues

| # | Issue | Effect | Status |
|---|---|---|---|
| 1 | The league label was renamed to "League size (players per **lb**)"; the engine looked for "...per board" | Typing a league size did nothing (hidden because the fallback is the same 16.3) | Fixed in D105b (labels match on their first words). Re-paste the engine. |
| 2 | SPT is 0 on all 25 places (the plan was to halve it) | MiC pays no SPT, so the Season Pass rows don't move | Confirm this is intended |
| 3 | Envelopes per player online are 3–13x Kite 2d weekday's | Places 1–3 pay 3/2/1-star, and on a 16-player board those places are common; participation is also about 2x Kite's measured opt-in | Scale to about 1/5–1/10. Compare per player online, not place by place. |
| 4 | Places 18–25 can't be reached on boards of 16–17 | The 8 Red there are never paid | Harmless |

1–3★ envelopes per player online, one weekday festival (PAYER):

| Cell | MiC | Kite 2d weekday | Ratio |
|---|---|---|---|
| 0-9 | 0.035 | 0.005 | 7x |
| 10-19 | 0.167 | 0.014 | 12x |
| 20-39 | 0.321 | 0.033 | 10x |
| 40-99 | 0.496 | 0.100 | 5x |
| 100-249 | 0.653 | 0.223 | 3x |

## 2. Risks, ranked by impact

### R1. League size, the biggest risk
16.3 is data_mic's average board (458,401 participants / 28,142 boards); the server config says 60.

| League size | 0-9 NP | 20-39 P | 40-99 P | 100-249 P |
|---|---|---|---|---|
| 16.3 (used) | 65 | 270 | 404 | 424 |
| 20.4 | −13% | −11% | −8% | −5% |
| 25 | −22% | −20% | −15% | −10% |
| 60 | −82% | −55% | −42% | −31% |

- **The average understates what a player experiences.** Bigger boards hold more players, so the average player sits on a board larger than 16.3; by how much depends on the board-size spread, which data_mic doesn't give.
- **Boards are not perfectly random.** 6.5% of boards have no 0-9 player, where random mixing predicts almost none. That points to uneven board sizes or partly sorted boards.
- **Direction: the sim likely overpays.**

### R2. data_mic's segments don't match this workbook's
The ratio of data_mic population to data_seg_beh players is 3.9x at 0-9, 4.2x at 10-19, 3.0x at 20-39, 2.3x at 40-99 and 1.2x at 100-249. A 3.5x spread is the same warning sign as the album pull (D59): a different segment definition or window.

- **The opponent mix may not fit today's players.** Re-deriving it from today's players gives 40-99 a 7.8% share, not 4.5%, and moves value −6% to −9%.
- **Participation and scores may be mapped to the wrong cells.**

### R3. Nothing checks the predicted places
data_mic has no final positions, so outputs like "40-99 median place 3" or "every participant is paid" are untested. A position p25/p50/p75 per segment from the live run would check them directly.

### R4. Who counts as a "participant"
The "share of active players" reading holds up: 100-249 participation (0.88) exceeds its online chance (0.52), so the denominator can't be the whole segment. But the model puts every participant on the board and pays them. If participants include players who entered but never submitted, it overpays. The p25 scores are above 0, so at least 75% submitted; the bottom quarter is unknown.

### R5. No payer split
Giving payers 1.5x the score moves value −11% (0-9 NONPAYER) to +11% (20-39 PAYER).

### R6. Score levels are fairly safe
Places depend only on the order of scores, so a uniform error cancels (all scores ×0.5 changes nothing). Only shifts between segments matter: raising 0-9 by 30% moves 0-9 +9% and the others −2% to −5%. The scores come from one run of unknown length; every 2-day weekday festival on cal_new uses them unchanged.

### R7. Not modelled
- **Spend:** the +5 moves and boosters the event is designed to sell.
- **Repeat fatigue:** four festivals in 28 days, from data on a single run.
- **Overlap with Red's Challenge** on days 22–23.
- **Play-by-play view:** still prices MiC on Red's places, so it disagrees with the main grid.
- **250+ (18 players):** p95 = p98 = 30,900 can't match its average of 6,984, so the tail is clamped. Its weight is close to zero.

## 3. Checked and correct
- **Local sim:** the workbook's values match the engine to 3e-16.
- **data_mic is consistent with itself:** segment participants add up to the ALL total, and participants / boards = 16.3.
- **Defaults:** every behaviour-table default equals data_mic, and hand-calculated places match the engine at every place.
- **Random mixing holds from 20-39 up:** the chance a board contains the segment is 0.90 / 0.53 / 0.048 for random boards against 0.86 / 0.50 / 0.048 measured.
- **Calendar:** cal_parsed has all four festivals (days 1, 8, 15, 22), and identical calendars give a DIFF of 0.

## 4. What would make this trustworthy
Ask the analyst for:
1. The board-size distribution weighted by players, and the leagueGroupSize the live run used (R1).
2. Final position p25/p50/p75 per segment (R3).
3. How data_mic assigns segments, and over which window (R2).
4. A payer split (R5).
5. Whether every participant submitted a score (R4).

On the workbook side:
1. Re-paste the engine. **Check code versions** should show build D105b.
2. Decide whether SPT should really be 0.
3. Scale the envelopes down to the Kite level using the local sim's per-player figures.
