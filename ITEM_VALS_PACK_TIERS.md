# `item_vals` — the six pack tiers

## How it works, in plain words

An envelope is nothing but a bundle of cards. So:

> **An envelope is worth its cards. A card is worth about 14 coins.**

Where does 14 come from? A card you draw is one of two things.

* **New — 42% of draws.** It goes in the album and moves you toward completing a set. A new card
  returns about **15.4 coins** of set and album reward on average.
* **A duplicate — 58% of draws.** It pays stars. Stars buy chests, and chests pay coins and
  boosters. A duplicate is worth about **2.4 stars**, a star is worth about **6.7 coins**, and
  players spend about **83%** of the stars they earn — so call it **13.5 coins** a duplicate.

Multiply and add:

```
COINS PER CARD = 0.42 x 15.43  +  0.58 x 0.83 x 2.44 x 6.68  =  6.5 + 7.8  =  14.3
```

A 1-star envelope holds 2 cards, so it is worth about 29 coins. A 5-star holds 6, so about 86.

**That is the entire model.** Everything below is where each of those five numbers comes from.

---

## "Coins a new card unlocks" — what 15.4 actually means

This replaced the badly-named *"share of face value realized"*. You read that as *"the chance the
new card completes a set"* — **your instinct was right about the structure.** Here is the exact
version.

A new card is worth nothing at all **until it is the ninth card of a set**. Cards 1 through 8 of a
set pay zero; the 9th pays the whole set reward. So averaged across all new cards:

```
coins a new card unlocks  =  P(this new card completes a set)  x  what that set pays
```

Measured on workbook (9), population-weighted:

* a player collects **45.8** unique cards and completes **3.0** sets
* so **6.6%** of new cards are the one that completes something
* the sets they complete pay about **234 coins** each
* `0.066 x 234 = 15.4 coins` per new card

**Why 234 and not 341?** The eight sets are worth 129 / 163 / 197 / 284 / 450 / 434 / 301 / 768 —
average 341. But the album set skew is 50 / 25 / 12 / 6 / 3 / 1 / 0.8 / 0.6, which pours draws into
Set 1 first. **Players finish the cheap sets and stop before the expensive ones.** So the sets
actually completed average 234, not 341.

And why the old name was bad: 15.4 against a full-album face value of 5,025 / 72 = **69.8 coins** is
**22%**. That 22% is not a probability of anything — it is just what is left over once you accept
that most players never finish. True, and unhelpful. The number to type is the 15.4.

---

## Two one-off sheet edits

Both reuse the `val` helper column already on `PackConfig`.

1. **Copy `PackConfig!X62` down to `X73`.** It is already
   `=SUMPRODUCT({B62:G62, J62, I62, H62, K62:N62}, item_vals!$B$3:$N$3)` and ALBUM REWARDS uses the
   same 21-column grammar. `X73` should read **2300**.

2. **Add the same helper to the STAR CHEST block** — `PackConfig!Y50`, filled to `Y52`. That block
   starts two columns later, so every letter shifts by two:

   ```
   =SUMPRODUCT({D50:I50, L50, K50, J50, M50:P50}, item_vals!$B$3:$N$3)
   ```

   Y50:Y52 should read **334 / 668 / 768**. This ignores the envelope inside the chest on purpose —
   that envelope is priced by this very table, and counting it here would price it twice.

---

## The input block, `item_vals` rows 6-12

| cell | label | formula / value | reads |
|---|---|---|---|
| `A6` | `PACK VALUE INPUTS` | | |
| `A7` `B7` | New-card share of draws | **0.42** *(typed)* | 0.42 |
| `A8` `B8` | Coins a new card unlocks | **15.43** *(typed)* | 15.43 |
| `A9` `B9` | Share of stars actually spent | **0.83** *(typed)* | 0.83 |
| `A10` `B10` | Avg stars per duplicate | `=ROUND(SUMPRODUCT(PackConfig!$B$22:$B$27,PackConfig!$B$13:$B$18)/SUM(PackConfig!$B$22:$B$27),3)` | 2.440 |
| `A11` `B11` | Coins per star | `=ROUND(MAX(ARRAYFORMULA(PackConfig!$Y$50:$Y$52/PackConfig!$B$50:$B$52)),2)` | 6.68 |
| `A12` `B12` | **COINS PER CARD** | `=ROUND($B$7*$B$8+(1-$B$7)*$B$9*$B$10*$B$11,2)` | **14.29** |

Three typed cells, and all three are read off `Col_Cards_Totals` after a cloud run,
**population-weighted across columns B:K** (see the correction below):

* **B7** = `Unique Cards` ÷ `Total Cards Drawn`
* **B8** = (priced `ECONOMY IMPACT - TOTAL`) ÷ `Unique Cards`
* **B9** = `Stars Spent on Chests` ÷ `Stars Earned`

---

## The tier formula

**`item_vals!O3`**, dragged right to **T3**:

```
=ROUND(INDEX(PackConfig!$B:$B,
             MATCH(SUBSTITUTE(O$2, " Dly", " Pack") & "*", PackConfig!$A:$A, 0)) * $B$12, 2)
```

| Cell | Tier | Cards/Open | Value |
|---|---|---|---|
| O3 | 1-star Dly | 2 | **28.58** |
| P3 | 2-star Dly | 3 | **42.87** |
| Q3 | 3-star Dly | 4 | **57.16** |
| R3 | 4-star Dly | 5 | **71.45** |
| S3 | 5-star Dly | 6 | **85.74** |
| T3 | 6-star Dly | 7 | **100.03** |

Against the engine's full per-pack attribution on the same workbook (27.4 / 41.0 / 54.7 / 68.4 /
82.1 / 95.8): **+4.5% across the board**, the residual being Gold chests at 2.56 coins/star where
Bronze and Silver pay 6.68.

---

## ⚠ A correction to the numbers I gave first

The first version of this file quoted **8.40 coins per card** (tiers 16.80 … 58.81) and then
**17.12** with chests (tiers 35.90 … 125.65).

**Those were weighted equally across the ten segment cells.** The cells are wildly different sizes —
15,595 players in `0-9 NONPAYER` against 233 in `100+ PAYER` — and the big cells are the low-value
ones. Weighting them equally let a 233-player cell push the price up as hard as a 15,595-player one.

Population-weighted, the correct figures are:

| | coins per card | 1-star … 6-star |
|---|---|---|
| collection only (set + album) | **6.48** | 13.0 / 19.4 / 25.9 / 32.4 / 38.9 / 45.4 |
| **with the chest lane (this file)** | **13.68 measured, 14.29 modelled** | 28.6 / 42.9 / 57.2 / 71.5 / 85.8 / 100.0 |

---

## The chest lane is half the value

| | coins per player, population-weighted |
|---|---|
| set + album rewards | 707 |
| star-chest rewards | 786 |

**More than half of what the collection feature pays out comes from duplicates, not from completing
anything.** Most players never finish album 1; every player banks duplicates. To price the
collection lane alone, set `B9` (share of stars spent) to 0.

---

## The rarity multiplier: measured, and not worth carrying

| tier | rarity floor | avg stars/duplicate | multiplier |
|---|---|---|---|
| 1-star | 1★ | 2.440 | 1.00x |
| 2-star | 1★ | 2.440 | 1.00x |
| 3-star | 2★ | 2.628 | 1.08x |
| 4-star | 3★ | 2.747 | 1.13x |
| 5-star | 4★ | 2.825 | 1.16x |
| 6-star | 4★ | 2.770 | 1.14x |

**At most 16%, against a 3.5x spread from Cards/Open.** `GuaranteedMinRarity` binds on one card of
the pack, and only when that card turns out to be a duplicate. The engine's independent per-tier
measurement agreed: coins per card 5.66 / 5.51 / 3.94 / 5.68 / 4.78, flat within noise. Multiply the
O3 formula by the table above if you want it; I would not.

---

## What this is, and is not

* **Not marginal.** Set and album rewards are thresholds — the 87th envelope completes the album and
  the 5th does not. This says "of the value the season pays, this much rides on an envelope of that
  tier". It does not say what one extra envelope is worth to a player who is already close.
* **Config is live; behaviour is not.** Retype a set reward, a chest cost or a Cards/Open and every
  tier moves at once. B7, B8 and B9 are player behaviour and only move when you re-run the cloud sim
  and update them.
