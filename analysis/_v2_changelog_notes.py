"""
Authored prose for the v2 config changelog: the per-source "why", and the flags.

SEPARATE FILE ON PURPOSE. Everything in _build_v2_changelog.py is derived from the workbook and
re-derives itself when the workbook changes. Everything in HERE is a JUDGEMENT - a reading of what
a group of edits does together - and judgements do not re-derive. Keeping them apart means a
re-run cannot silently restate an old opinion as if it were a fresh measurement.

Every WHY below is INFERRED from the diff. None of it was told to me, and the output says so.
"""

WHY = {
 'Core Saga progression':
   ('Chest tier cut, playtime raised. RewardChestId drops 2->1 at milestone 3 and 3->2 at '
    'milestone 6 across all five segment blocks, while Unlimited Lives rises 15->20, 20->30 and '
    '30->45 at milestones 4-8. Reads as trading a one-off chest for time-limited playtime, and it '
    'moves value later in the ladder.'),
 'Daily Gift':
   ('A guaranteed envelope for showing up. Day 9 of each of the five streak cycles now pays a '
    '4-star envelope and one ToF ticket. This is the only always-on envelope source, so it is the '
    'floor for a player who touches nothing else - which matters, because 0-9 cannot reach the '
    'first envelope in any of the four token events.'),
 'Season Pass':
   ('Envelopes bought with boosters, tier for tier. Free-track tiers 3, 7, 12, 13, 17, 21, 23 and '
    '29 gain envelopes on an escalating ladder (1-star up to 5-star), and the SAME tiers lose '
    'Unlimited Lives, Coins, Red, Chuck or Shuffle. The track keeps roughly its old value and '
    'changes what that value is made of.'),
 'Hatchling Hideaway':
   ('A real requirement axis, at last. The new Tiles column (16/25/36/49/64 - the squares of 4 to '
    '8) gives each gate a native requirement, which this event never had: the engine was pricing '
    'BOTH sides of its R ratio off the v2 EventReach helper because there was nothing else to '
    'use. Envelopes land on gates 2, 3 and 5, tickets on 3 and 5.'),
 'Jigsaw Puzzle':
   ('Envelope-and-ticket bundled on alternating milestones (3, 4, 7, 11), with Unlimited Lives '
    'halved at milestone 4 to pay for it. The first envelope moved from milestone 2 to 3, which is '
    '80 to 150 tokens - a 88% increase in what it costs to reach.'),
 "Bomb's Ballet":
   ('The same bundle pattern: envelopes at reward levels 4, 5, 9 and 15, tickets at 3, 4, 9 and '
    '15, paid for by Coins 25->20 and Unlimited Red 15->0. The first envelope moved from level 2 '
    'to 3, which is 40 to 70 tokens (+75%).'),
 'Photoshoot':
   ('Envelopes pushed deep, and the token maths worked out on the sheet. Envelopes now sit at '
    'items 12, 15, 21, 24 and 30 - item 12 is in SET 4, behind a six-item unlock gate, so the '
    'first envelope costs 900 tokens on the cheapest legal path against 155 before. Unlimited '
    'Lives is stripped at items 6, 12 and 24 to pay for them. The scratch block beside the streak '
    'table is the earn ramp being derived: base 4 tokens per first-try win, multiplier stepping '
    'on EVERY win.'),
 'Kite Festival':
   ('A systematic ~20% currency nerf, with envelopes as the replacement. Every rank from 1 to 25 '
    'has Coins and SPT cut (rank 1: 250->200 coins, 260->210 SPT), and ranks 1-19 gain envelopes '
    'on a sliding scale - rank 1 takes a 4-star and a 5-star, rank 19 takes a single 1-star. '
    'Cutting Kite SPT also lowers Season Pass tier pressure, since the pass is driven by total '
    'SPT across every source.'),
 'Night Sky (weekend ladder)':
   ('Envelopes and tickets across all five segment blocks, paid for by HC cuts of roughly 17-20% '
    'at rounds 2 and 3 and Unlimited Lives cut or zeroed at round 1. Night Sky is the largest '
    'envelope source for low-engagement players, so what lands here decides their supply.'),
 'Night Sky (weekday ladder)':
   ('The same treatment, and slightly RICHER than the weekend ladder: weekday rounds 1-3 pay '
    '1-star / 2-star / 4-star where the weekend pays nothing / 1-star / 3-star. Spreading supply '
    'onto the 18 weekday days rather than the 15 weekend ones would explain it, but it is worth '
    'confirming the two were not swapped. SEE THE FLAGS TAB - this sheet is not being read.'),
 'Flock Flurry':
   ('One 2-star envelope at rung 1, and nothing else. Flock Flurry is CARRIED in the sim - '
    'measured values for every other resource, pack overlay only - so a single envelope is the '
    'whole of what a config edit can do here.'),
 'Level Race':
   ('Envelopes on the top three ranks of each of the four leaderboard blocks, descending 4-star / '
    '3-star / 2-star. Worth knowing before tuning further: the workbook itself notes a mid segment '
    'reaches ranks 1-3 about 5% of the time, so an envelope placed there is worth roughly 0.006 '
    'envelopes a season. Most of this supply will not arrive.'),
 'Target Day':
   ('The duration is the real change: EventDuration 7 -> 1, so Target Day becomes a single-day '
    'event. Envelopes then land on leaderboard ranks 1-6 on a sliding scale, with Slingshot and '
    'Chuck removed to pay and a Red added at rank 7.'),
 'Rainbow Maker (1st half)':
   ('A new requirement curve, plus deep envelopes. The helper block adds Matchables Req, Req '
    'Accum, Levels Req, a Polynomial Power of 1.25, three step multipliers and 500 matchables per '
    'level - a re-derivation of how the milestone requirements scale. Envelopes go on milestones '
    '2, 16, 20, 26 and 30, so nearly all the supply sits at the deep end.'),
 'Rainbow Maker (2nd half)':
   ('The same reward edits as the first-half config - envelopes at 2, 16, 20, 26 and 30, boosters '
    'cut at 6, 12 and 30, Coins 20->10 at 9 - but WITHOUT the new requirement-curve helper block. '
    'If the curve rework was meant to apply to both halves, the second half has not had it yet.'),
}

FLAGS = [
 ('THE WEEKDAY NIGHT SKY SHEET IS NOT BEING READ',
  'Night Sky (weekday ladder)',
  'The engine looks for a sheet named NS_v2_weekday (EcoGainsSim_v4.gs, NS_V2_WEEKDAY_SHEET). '
  'This workbook calls it NS_weekday_v2. A missing weekday sheet is a SUPPORTED state - the engine '
  'falls back to NS_v2 for every day of the week - so nothing errors and nothing looks wrong on '
  'the sheet. All 27 authored weekday edits, envelopes included, currently do nothing at all. '
  'Fix: rename the sheet to NS_v2_weekday.'),
 ('LEVEL RACE ENVELOPES SIT ON RANKS ALMOST NOBODY REACHES',
  'Level Race',
  'All twelve envelopes are on ranks 1-3. The workbook itself notes that a mid segment reaches '
  'those about 5% of the time, which prices each one at roughly 0.006 envelopes a season. The '
  'supply is authored but will not arrive. If Level Race is meant to contribute, the envelopes '
  'need to be further down the ladder.'),
 ('THE PHOTOSHOOT FIRST ENVELOPE MOVED FROM 155 TOKENS TO 900',
  'Photoshoot',
  'Item 3 (set 1, no unlock gate) to item 12 (set 4, behind a six-item gate). On the cheapest '
  'legal path that is 900 tokens against 155 - a 5.8x increase. Measured consequence: 8 of the 10 '
  'segment x payer cells can no longer reach the first envelope inside the 3-day event, including '
  'every 10-19 cell and 40-99 PAYER.'),
 ('THE RAINBOW MAKER CURVE REWORK IS ONLY ON THE FIRST-HALF SHEET',
  'Rainbow Maker (2nd half)',
  'RM_1st_v2 gained a requirement-curve helper block - Polynomial Power 1.25, three step '
  'multipliers, 500 matchables per level. RM_2nd_v2 did not, though its reward edits match its '
  'twin exactly. Deliberate or unfinished is worth confirming before either ships.'),
 ('ONE BOOSTER WENT UP NINEFOLD, AGAINST THE PATTERN',
  "Bomb's Ballet",
  'Reward level 15 raises Shuffle from 1 to 9, while nearly every other booster edit in the '
  'workbook is a cut. Nine of a single booster on one rung is far out of pattern - worth a look '
  'in case it was meant to be nine of something else, or a 1 that gained a digit.'),
]
