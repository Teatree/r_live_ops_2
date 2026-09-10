# Who finishes album 1, and what would move it

Measured against `workbooks/COLLECTIONS_UNDER_NEW_CALENDAR (9).xlsx`, 120 simulated players per
(segment x payer) cell, seed 20260910, via `harness/_probe_album.js`. Population weights are
`data_seg_beh.unique_players`, 54,521 players over ten cells.

---

## 1. Where workbook (9) already stands

```
cell               pop%   rate%   share%  index   envelopes  album%
40-99 NONPAYER     10.5     5.0    39.3   3.73      40.5       77
40-99 PAYER         2.8    18.3    37.7  13.66      47.4       87
100+ NONPAYER       1.3    10.8    10.6   8.07      36.3       75
100+ PAYER          0.4    30.8     9.8  22.98      50.7       98
20-39 PAYER         4.2     0.8     2.6   0.62      38.9       76
20-39 NONPAYER     17.3     0.0     0.0   0.00      31.9       67
10-19 PAYER         5.2     0.0     0.0   0.00      38.7       75
10-19 NONPAYER     18.9     0.0     0.0   0.00      29.3       61
0-9  PAYER         10.8     0.0     0.0   0.00      31.3       64
0-9  NONPAYER      28.6     0.0     0.0   0.00      23.5       49
```

*Population rate 1.34%. A finisher opens 68 envelopes and draws 259 cards.*

**The ask is close to already satisfied.** 40-99 PAYER + 100+ PAYER are **47.5% of all finishers**
from **3.19% of the player base**. Add the two nonpayer halves of those segments and 40-99 plus
100+ account for **97.4%** of everyone who completes the album. Nobody at 10-19 or below finishes
at all.

The one cell ahead of 40-99 PAYER is **40-99 NONPAYER** at 39.3%, and only because it is 3.7x the
population. Per capita the payers are 2.7x more likely to finish.

**100+ PAYER cannot be the biggest block, arithmetically.** It is 233 players — 0.43% of the base.
Even at a 100% completion rate it produces at most 233 finishers, so for it to be the largest single
group the population rate would have to fall below ~0.43% with essentially nobody else finishing.
The closest measured case (Night Sky's envelopes removed entirely) gets 100+ PAYER to 23.1% of
finishers, still behind 40-99 PAYER at 60.9%.

---

## 2. The trade-off that governs everything

Every change tested that **raises** total completion **lowers** the payer share.

| variant | pop rate | 40-99 P | 100+ P | 40-99 NP | payers, % of finishers | target share |
|---|---|---|---|---|---|---|
| Night Sky envelopes off | 0.34% | 7.5% | 18.3% | 0.0% | **84.0%** | 84.0% |
| snap pool flattened | 1.10% | 16.7% | 16.7% | 2.5% | 66.0% | 48.5% |
| **workbook (9) as shipped** | **1.34%** | **18.3%** | **30.8%** | **5.0%** | **50.1%** | **47.5%** |
| skew steeper (100/50/25…) | 1.57% | 17.5% | 23.3% | 7.5% | 41.5% | 37.0% |
| **SP (Paid) retiered to 5-star** | **2.13%** | **29.2%** | **32.5%** | **5.0%** | **68.7%** | 44.3% |
| Cards/Open widened 1/2/4/6/9/11 | 2.69% | 28.3% | 38.3% | 11.7% | 45.7% | 35.2% |
| skew mild (4/3/2.5/2/1.5…) | 3.10% | 33.3% | 40.8% | 10.0% | 51.8% | 35.3% |
| **widened + SP retiered** | **3.56%** | **34.2%** | **54.2%** | **11.7%** | **58.9%** | 33.0% |
| Cards/Open 1/2/3/6/12/14 | 3.96% | 33.3% | 45.8% | 13.3% | 39.8% | 28.2% |
| skew flat (all 1) | 3.99% | 33.3% | 45.0% | 17.5% | 39.4% | 27.9% |
| guaranteed new card, big tiers | 5.50% | 36.7% | 54.2% | 20.8% | 40.4% | 22.6% |
| Night Sky -> progress ladders | 6.64% | 38.3% | 53.3% | 30.8% | 36.0% | 19.4% |
| progress ladders x2 | 8.97% | 42.5% | 55.0% | 40.8% | 29.5% | 15.7% |

Album completion is a **threshold**, and the mid segments sit just below the line in enormous
numbers — 20-39 NONPAYER alone is 17.3% of the base and reaches 67% of the album. Any lever that
adds cards to everyone pulls them over the line first, simply because there are so many of them.

So: **decide which one you want.** A high completion rate and a payer-dominated finisher list are
opposing goals under a single shared envelope pool.

---

## 3. The mechanism: envelopes are earned by attendance, cards by tier

Envelopes per season by tier, per player:

```
cell                 1*    2*    3*    4*    5*    6*   TOT  cards
0-9 NONPAYER       10.8   4.4   4.0   1.9   1.3   0.0  22.4     68
40-99 PAYER         6.4  15.7  10.6   5.6   7.5   0.0  45.7    175
100+ PAYER          7.3  13.2  13.3   8.0  10.6   0.0  52.4    211

100+ PAYER / 0-9 NONPAYER:  1*=0.67x  2*=3.02x  3*=3.35x  4*=4.32x  5*=7.94x
```

**Tier is the only dimension already sorted by engagement, and it is sorted steeply.** A 100+ payer
receives *fewer* 1-star envelopes than a 0-9 nonpayer, and eight times the 5-stars.

But `Cards/Open` is **2 / 3 / 4 / 5 / 6 / 7**. That converts an 8x volume gradient into a 3.1x card
gradient (68 cards vs 211). The tier ladder is doing far less work than the tier distribution
already earns.

`6-star Pack (Paid)` is authored — 7 cards, GuaranteedMinRarity 4 — and **nothing pays it**. Zero
for every cell.

### Where the regressive 1-star flow comes from

Envelopes per season, source x tier, for the bottom cell:

| source | 1-star | 3-star | note |
|---|---|---|---|
| Daily Night Sky Prize | **5.2** | 2.4 | pays 0 1-stars to 40-99 P and 100+ P |
| Rainbow Maker | **3.5** | – | 3.1 / 3.8 at the top cells: flat |
| Season Pass (Free) | 1.0 | 1.0 | flat by design |
| Photoshoot | 0.4 | 0.1 | |
| Star Chest (Bronze) | 0.3 | – | |

Night Sky pays 0-9 NONPAYER **7.6** envelopes and 100+ PAYER **2.8**, because it is a daily event
and 100+ is active 13.1 days against 0-9's 15.1. It is the biggest single anti-engagement flow in
the calendar. Rainbow Maker's *early* rungs are similarly flat — its 4-star and 5-star rungs are the
part that scales (1.3 -> 8.5).

---

## 4. What I would change, in order

### First — retier Season Pass (Paid) without adding an envelope

The paid track pays **2x 2-star + 2x 3-star + 1x 4-star + 1x 5-star** = 6 envelopes, 25 cards.
Retype the same six rows as 5-star (or the unused 6-star Paid tier): **6 envelopes, 36 cards**.

Measured: population rate **1.34% -> 2.13%**, 40-99 PAYER **18.3% -> 29.2%**, 20-39 PAYER
**0.8% -> 9.2%**, and **every nonpayer cell unchanged** — 40-99 NONPAYER stays at exactly 5.0%.
Payers go from 50.1% to **68.7%** of all finishers.

This is the only lever that is payer-only, and it respects the constraint literally: the envelope
*count* on the paid track does not move.

### Second — widen the Cards/Open gradient

`2/3/4/5/6/7` -> `1/2/4/6/9/11`. Measured on its own: rate **1.34% -> 2.69%**, 100+ PAYER
**30.8% -> 38.3%**, and **0-9, 10-19 and 20-39 NONPAYER all stay at exactly 0%**. It is the most
selective volume lever available, because it multiplies a distribution that is already sorted by
engagement.

Combined with the retier: rate **3.56%**, 40-99 PAYER **34.2%**, 100+ PAYER **54.2%**, payers
**58.9%** of finishers, and still nothing below 20-39 PAYER completes.

### Third — take the 1-stars off Night Sky and Rainbow Maker's early rungs

Not to add volume elsewhere — just to stop paying attendance. This is what makes the tier gradient
bite: 1-star is 48% of the bottom cell's envelopes and 14% of the top's.

### What I would *not* do

* **Album set skew is close to neutral for this question.** 50/25/12/6/3/1/0.8/0.6 -> flat raised
  the rate 1.34% -> 3.99% and dropped the payer share 50.1% -> 39.4%. It changes how hard the album
  is for everyone, roughly equally. The current steep skew is making completion harder across the
  board (it front-loads set 1 duplicates); flattening it is a pure volume knob with no selectivity.
* **The snap pool is a bad lever and points the wrong way.** Flattening it to ~69 copies per rarity
  *lowered* the rate to 1.10% and hurt the top cell hardest — 100+ PAYER fell 30.8% -> 16.7%. The
  players who open the most envelopes are the most exposed to a long tail.
* **Guaranteed-new-card on the big tiers is a volume lever wearing a selectivity costume.** It
  raised the rate to 5.50% but pulled 20-39 NONPAYER (17.3% of the base) over the line at 4.2%,
  dropping the payer share to 40.4%.

---

## Caveats

* 120 players per cell. A 30% cell rate carries roughly +/-8pp of Monte-Carlo error, a 1% population
  rate roughly +/-0.4pp. Directions are solid; two variants within a few points of each other are
  not separable at this sample size.
* Every variant here was applied to the **simulation's** config, not to the workbook. Nothing in
  `workbooks/` was edited.
* The plan mutators (`ns_off`, `progress_up`, `sp_paid_retier`) re-price a source's envelopes on the
  grant plan rather than by re-authoring a `_v2` ladder. That prices the *move* correctly; the
  actual authoring still has to land on specific rungs, and which rung matters (a leaderboard's top
  three rows are reached ~5% of the time by a mid segment).
* Kite Festival runs at the assumed 0.35 opt-in, not its measured 1-3%. See CLAUDE.md D25.
