# `item_vals` — the six pack tiers

## The sentence

> **An envelope is worth its cards. A card is worth about 18 coins: four times in ten it is new and
> unlocks set and album reward, six times in ten it is a duplicate that pays stars, and stars buy
> chests.**

That is the whole model. Everything below is that sentence in cells.

---

## Step 1 — two one-off sheet edits

Both reuse the `val` helper column already on `PackConfig`, so nothing new is invented.

1. **Copy `PackConfig!X62` down to `X73`.** It is already
   `=SUMPRODUCT({B62:G62, J62, I62, H62, K62:N62}, item_vals!$B$3:$N$3)` and the ALBUM REWARDS block
   uses the identical 21-column grammar, so it prices Album 1 with no change. `X73` should read
   **2300**.

2. **Add the same helper to the STAR CHEST block** — put in `PackConfig!Y50` and fill to `Y52`
   (the chest block starts two columns later, so the letters shift by two):

   ```
   =SUMPRODUCT({D50:I50, L50, K50, J50, M50:P50}, item_vals!$B$3:$N$3)
   ```

   Y50:Y52 should read **334 / 668 / 768**. This deliberately ignores the envelope inside the chest —
   that envelope is priced by this table, and counting it here would price it twice.

---

## Step 2 — the input block, on `item_vals` rows 6-12

| cell | label | formula / value | reads |
|---|---|---|---|
| `A6` | `PACK VALUE INPUTS` | | |
| `A7` `B7` | New-card share of draws | **0.42** *(input)* | 0.42 |
| `A8` `B8` | Share of face value realized | **0.29** *(input)* | 0.29 |
| `A9` `B9` | Coins a new card unlocks | `=ROUND((SUM(PackConfig!$X$62:$X$69)+PackConfig!$X$73)/PackConfig!$B$5*$B$8,2)` | 20.24 |
| `A10` `B10` | Avg stars per duplicate | `=ROUND(SUMPRODUCT(PackConfig!$B$22:$B$27,PackConfig!$B$13:$B$18)/SUM(PackConfig!$B$22:$B$27),3)` | 2.440 |
| `A11` `B11` | Coins per star | `=ROUND(MAX(ARRAYFORMULA(PackConfig!$Y$50:$Y$52/PackConfig!$B$50:$B$52)),2)` | 6.68 |
| `A12` `B12` | **COINS PER CARD** | `=ROUND($B$7*$B$9+(1-$B$7)*$B$10*$B$11,2)` | **17.95** |

Only **B7 and B8 are typed**. Everything else follows PackConfig.

* **B7** — of the cards a player draws, what share are ones they do not already own.
  Sim, population-weighted: `Unique Cards / Total Cards Drawn` = **0.42**.
* **B8** — a new card is only worth its share of a set reward if that set actually completes, and
  most never do. Sim: the collection lane pays **29%** of face value.

---

## Step 3 — the tier formula

**`item_vals!O3`**, dragged right to **T3**:

```
=ROUND(INDEX(PackConfig!$B:$B,
             MATCH(SUBSTITUTE(O$2, " Dly", " Pack") & "*", PackConfig!$A:$A, 0)) * $B$12, 2)
```

One `INDEX/MATCH` for Cards/Open, times one number. That is it.

| Cell | Tier | Cards/Open | Value |
|---|---|---|---|
| O3 | 1-star Dly | 2 | **35.90** |
| P3 | 2-star Dly | 3 | **53.85** |
| Q3 | 3-star Dly | 4 | **71.80** |
| R3 | 4-star Dly | 5 | **89.75** |
| S3 | 5-star Dly | 6 | **107.70** |
| T3 | 6-star Dly | 7 | **125.65** |

---

## Accuracy

Checked against the full per-pack attribution the engine runs (D51), on the same workbook, with the
chest lane added on the measured side too:

| | 1-star | 2-star | 3-star | 4-star | 5-star | 6-star |
|---|---|---|---|---|---|---|
| this formula | 35.9 | 53.8 | 71.8 | 89.8 | 107.7 | 125.7 |
| engine attribution | 34.2 | 51.4 | 68.5 | 85.6 | 102.7 | 119.8 |

**+4.8% high across the board.** The simple model slightly over-credits duplicates because it
assumes every star gets spent; in the sim ~25 stars per player are left on the table at season end,
and some go on Gold chests, which are worth 2.56 coins/star rather than 6.68.

---

## Why this is roughly double the previous numbers

The previous version priced **set + album rewards only**. You asked for chests to be included, and
the chest lane turns out to be **as large as the album lane**:

| | coins per player, population-weighted |
|---|---|
| set + album rewards | 11,064 |
| star-chest rewards | 11,478 |

**More than half the value the collection feature pays out comes from duplicates, not from
completing anything.** Most players never finish album 1; every player banks duplicates. That is
worth knowing on its own.

**To go back to collection-only numbers, set `B11` (coins per star) to 0.** Coins per card falls to
8.50 and the tiers read 17.0 / 25.5 / 34.0 / 42.5 / 51.0 / 59.5 — within 1% of the earlier figures.

---

## The rarity multiplier: measured, and not worth carrying

You asked about rarity as a multiplier. It exists — a pack's `GuaranteedMinRarity` forces one card
at or above a rarity floor, and rarer duplicates pay more stars — but it is small:

| tier | rarity floor | avg stars/duplicate | multiplier |
|---|---|---|---|
| 1-star | 1★ | 2.440 | 1.00x |
| 2-star | 1★ | 2.440 | 1.00x |
| 3-star | 2★ | 2.628 | 1.08x |
| 4-star | 3★ | 2.747 | 1.13x |
| 5-star | 4★ | 2.825 | 1.16x |
| 6-star | 4★ | 2.770 | 1.14x |

**At most 16%, against a 3.5x spread from Cards/Open.** The engine's own per-tier measurement agreed
independently: coins per card came out 5.66 / 5.51 / 3.94 / 5.68 / 4.78 — flat within noise. The
guarantee only binds on one card of the pack, and only when it is a duplicate.

If you want it anyway, multiply the O3 formula by the per-tier figure from the table above. I would
not: it adds a term to explain for a 16% effect that the data cannot cleanly separate from noise.

---

## What this is, and is not

* **Not marginal.** Album and set rewards are thresholds — the 87th envelope completes the album and
  the 5th does not. This says "of the value the season pays, this much rides on an envelope of that
  tier". It does not say what one extra envelope is worth to a specific player.
* **It follows config, not the sim, except for B7 and B8.** Retype a set reward, a chest cost or a
  Cards/Open and every tier moves immediately. B7 and B8 are player behaviour and only move when you
  re-run the cloud sim and update them.
* **Sanity check on B7/B8:** if you change the album set skew, the snap pool or envelope volume,
  re-read `Unique Cards / Total Cards Drawn` off `Col_Cards_Totals` and update B7. B8 moves with how
  many sets people actually complete.
