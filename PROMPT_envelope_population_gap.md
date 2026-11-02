# Two pulls of the same A/B arm disagree on players and envelopes

Written 2026-11-02 for the analyst who owns the A/B pulls. It is about `data_gains`, `data_seg_beh`,
`data_col_season` and `data_col_envelopes` in LIVE_OPS_V3 (15).

All four describe **Variant A, Tue 2026-10-13 → Wed 2026-10-28 (16 days)**, split into the same ten
cells (segment `0-9 … 100+` × `NONPAYER / PAYER`). They should describe the same players. They don't.

## 1. Different populations per cell

| cell | `data_gains` players_in_cell | `data_seg_beh` unique_players | `data_col_season` unique_players |
|---|---:|---:|---:|
| 0-9 NONPAYER | 29,660 | 22,413 | 20,893 |
| 0-9 PAYER | 15,817 | 13,725 | 15,620 |
| 10-19 NONPAYER | 17,323 | 11,069 | 10,370 |
| 10-19 PAYER | 8,860 | 6,130 | 6,489 |
| 20-39 NONPAYER | 11,876 | 7,686 | 6,892 |
| 20-39 PAYER | 5,637 | 4,152 | 3,835 |
| 40-99 NONPAYER | 6,349 | 3,539 | 3,634 |
| 40-99 PAYER | 2,664 | 1,928 | 1,725 |
| 100+ NONPAYER | 1,103 | 386 | 487 |
| 100+ PAYER | 414 | 241 | 245 |
| **total** | **99,703** | **71,269** | **70,190** |

Total player-days are close between `data_gains` and `data_seg_beh` (0.70–1.26× per cell). But
`data_gains` spreads them over more players. Its players average 4.5–7.3 active days in the 16, while
`data_seg_beh`'s average 8.4–10.7. The gap varies by cell (100+ NONPAYER is 2.9×, 0-9 PAYER 1.15×), so
this looks like a different segment assignment, not just a different filter.

## 2. Different envelope counts per source

Envelopes granted over the same 16 days, all ten cells together:

| source (album data name) | `data_gains` | album data | ratio |
|---|---:|---:|---:|
| Night Sky (`dreamheist_event`) | 444,173 | 545,554 | 1.23 |
| Rainbow Maker | 297,505 | 357,593 | 1.20 |
| Season Pass (`dream_pass_event`) | 140,300 | 159,786 | 1.14 |
| Target Day (`ArcheryArena`) | 107,333 | 145,102 | 1.35 |
| Hatchling Hideaway | 74,723 | 101,067 | 1.35 |
| Jigsaw | 43,297 | 61,591 | 1.42 |
| Daily Gift | 29,979 | 52,985 | 1.77 |
| Flock Flurry (`FlockRush`) | 32,893 | 44,819 | 1.36 |
| Tower of Fortune | 35,863 | 43,656 | 1.22 |
| Bomb's Ballet (`bomb_ballet_event`) | 27,152 | 34,545 | 1.27 |
| Team Race (`race_event`) | 17,068 | 22,148 | 1.30 |
| Kite Festival | 11,913 | 19,528 | 1.64 |
| Red's Challenge (`red_event`) | 11,730 | 14,687 | 1.25 |
| Chuck's Challenge (`chuck_event`) | 5,721 | 6,992 | 1.22 |
| **all sources** | **1,320,744** | **1,677,431** | **1.27** |

The album data counts 1.14–1.77× more envelopes for every source, despite covering 30% fewer players.
Per player, 0-9 NONPAYER received 6.6 envelopes in `data_gains` against 16.4 in `data_col_season`.

## 3. What I need

1. **How is each pull segmented and filtered?** Which window is the modal 7-day play-rate tier taken
   over, and do all four apply the same filters (geo, orphans, `max_level > 200`)? They should give the
   same players per cell.
2. **Which envelope count is right?** Does `data_gains` miss some grant events (amount bands, the
   breakdown-string mapping)? Or does the album pipeline count something twice?
3. **Map the album data's source names.** Most of `data_col_envelopes`' `source` values are
   `UNMAPPED:<event>`. Please use the same category names as `data_gains` (the list in
   `PROMPT_ab_data_refresh.md` §0.5).

## How the sim deals with it until then

- **Eco sim and change summary:** these stay on `data_gains`. The change summary is now per player
  of `data_gains`' own population.
- **Album completion sim:** this is calibrated to the album data (user decision), because that's the
  pipeline album completion is measured on. Its populations match `data_seg_beh`, which supplies the
  activity rates.
- **What that means:** the two views disagree on envelope levels by the ratios above. Whichever pull
  is wrong, one of the two views is off by that much.
