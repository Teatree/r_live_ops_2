# `item_vals` — the six pack tiers, as a formula

Drop this in **`item_vals!O3`** and drag right to **T3** (`1-star Dly` … `6-star Dly`).
It is one self-contained cell — no helper rows, nothing to maintain.

```
=LET(
  A,       Col_Cards_Totals!$A:$A,
  ecoBar,  MATCH("ECONOMY IMPACT - TOTAL*", A, 0),
  resLab,  OFFSET(Col_Cards_Totals!$A$1, ecoBar+1, 0, 21, 1),
  resVal,  ARRAYFORMULA(IFERROR(OFFSET(Col_Cards_Totals!$B$1, ecoBar+1, 0, 21, 10)*1, 0)),
  price,   ARRAYFORMULA(IFERROR(HLOOKUP(resLab, item_vals!$B$2:$N$3, 2, FALSE), 0)),
  vTotal,  SUM(MMULT(TRANSPOSE(price), resVal)),
  cardRow, MATCH("Total Cards Drawn", A, 0),
  allCards,SUM(OFFSET(Col_Cards_Totals!$B$1, cardRow-1, 0, 1, 10)),
  srcBar,  MATCH("CARDS PER SOURCE (*", A, 0),
  srcLab,  OFFSET(Col_Cards_Totals!$A$1, srcBar+1, 0, 30, 1),
  srcVal,  ARRAYFORMULA(IFERROR(OFFSET(Col_Cards_Totals!$B$1, srcBar+1, 0, 30, 10)*1, 0)),
  chest,   SUM(MMULT(TRANSPOSE(ARRAYFORMULA(--(LEFT(srcLab,10)="Star Chest"))), srcVal)),
  vCard,   vTotal / (allCards - chest),
  cardsOpen, INDEX(PackConfig!$B:$B,
                   MATCH(SUBSTITUTE(O$2, " Dly", " Pack") & "*", PackConfig!$A:$A, 0)),
  ROUND(cardsOpen * vCard, 2)
)
```

## What it computes

It is the D51 attribution, collapsed to the one number a price table can hold:

```
vCard   = V_total / cards drawn from CALENDAR envelopes
value(tier) = Cards/Open(tier) x vCard
```

* `V_total` — every set + album reward the simulated season actually paid, priced through
  `item_vals` row 3 itself. Not the config's face value: what the players in the run received.
* `allCards - chest` — cards from envelopes the calendar granted. Star-chest cards are removed
  because a chest envelope is bought with duplicate stars that a calendar envelope produced;
  counting it in the denominator would credit an envelope twice.
* Because the two conserve — `sum over tiers of (Cards/Open x envelopes) x vCard = V_total` — the
  six prices add back exactly to the reward value the feature pays. That is the same identity the
  engine gate holds to 2.73e-12 coins.

**The value gradient across tiers IS the Cards/Open gradient**, and that is a finding rather than a
simplification: the engine's per-tier measurement came out at 5.66 / 5.51 / 3.94 / 5.68 / 4.78 coins
per card, flat within about +/-15%. A tier's only real advantage is how many cards it holds.

## Yes, it uses the sim results

| Input | Source | Moves when |
|---|---|---|
| `Cards/Open` | `PackConfig` PACK DEFINITIONS | you retype it |
| `V_total` | `Col_Cards_Totals` ECONOMY IMPACT - TOTAL | you re-run **Simulate card cloud** |
| cards drawn | `Col_Cards_Totals` TOTALS + CARDS PER SOURCE | you re-run **Simulate card cloud** |
| resource prices | `item_vals` B3:N3 | you retype them |

So it follows the ladders, the snap pool, the album set skew and the calendar — but only through the
last cloud run. **Re-run the cloud sim first, then read these cells.** A config edit alone does not
move them.

## Three things to know

1. **Columns B:K only — the MAX column is excluded on purpose.** MAX opens 223 envelopes against a
   cohort's 23-52. Including a synthetic ceiling player in a ratio of sums would let one non-existent
   player set the price.

2. **The price lookup stops at column N (`Unlimited Bomb`), not T.** That is what stops the circular
   reference: O3:T3 are the cells being written. It costs nothing — no set or album reward in this
   workbook contains an envelope, so those columns would look up to zero anyway.

3. **This is an ATTRIBUTED value, not a marginal one.** Album and set rewards are threshold outcomes:
   the 87th envelope completes the album and the 5th does not. These numbers say "of the reward value
   the season paid, this much rode on an envelope of that tier". They do **not** say what one extra
   envelope is worth to a specific player — that depends entirely on how close they already are.

## What it reads on the 2026-09-10 workbook (9)

`V_total` 11,064 coins over the ten cells, 1,385 cards drawn, 68 of them from chests
→ **vCard = 8.40 coins**.

| Cell | Tier | Cards/Open | Value |
|---|---|---|---|
| O3 | 1-star Dly | 2 | **16.80** |
| P3 | 2-star Dly | 3 | **25.20** |
| Q3 | 3-star Dly | 4 | **33.61** |
| R3 | 4-star Dly | 5 | **42.01** |
| S3 | 5-star Dly | 6 | **50.41** |
| T3 | 6-star Dly | 7 | **58.81** |

Row 4 (the dollar row) follows the same pattern the other columns use: `=B4/B3*O3` style, or leave
it blank — nothing reads it.
