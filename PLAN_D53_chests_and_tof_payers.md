# Plan D53 — a chest source in EcoGains, and a real payer/nonpayer split in ToF

Two independent pieces of work. They share nothing but this file, so either can ship alone.

---

# PART A — `Col - Chests`, the third collection source

## What is missing today

`buyOneChest` in `CardOpenings.gs` spends stars and opens the chest's **reward pack**. The chest's
own printed payout — Bronze pays **50 coins + 1 Slingshot + 1 Shuffle + 1 Comet** — is read by
nobody. `loadPackConfig_` takes three fields off each STAR CHEST row (`tier`, `cost`, `rewardPack`)
and ignores the 21 reward columns beside them.

Measured on workbook (9): the chest lane pays **786 coins per player, population-weighted** —
slightly *more* than the 707 coins of set and album rewards that `Col - Sets` and `Col - Albums`
already report. **More than half of what the collection feature pays out is currently invisible to
EcoGains.**

## Scope, as decided

**Chest direct payout only.** The reward pack's cards keep flowing to `Col - Sets` /
`Col - Albums`, so nothing is double-counted. `Col - Chests` is a clean new faucet.

## The changes

### A1. `loadPackConfig_` reads the chest reward block (`CardOpenings.gs`)

The STAR CHEST header is the same 21-column reward grammar every config sheet shares, shifted two
columns right (`Chest Tier | Cost (Stars) | Reward Pack Type | Coins | SPT | ...`). So:

```js
.map(function(row){
  var rew = {};
  REWARD_COLUMNS.forEach(function(rc){ rew[rc.name] = num(row[rc.col + 2]); });
  return { tier: ..., cost: ..., rewardPack: ..., rewards: rew };
})
```

**One flagged decision.** The block also carries `1-star Dly` … `6-star Dly` columns. A number
there would be a *second* envelope on top of `Reward Pack Type`, which is not a mechanic the sim
implements. Those six columns are therefore **excluded from the gains row and LOGGED if non-zero**,
rather than silently summed into coins-equivalent or silently dropped. Today they are all 0.

### A2. Accumulate on purchase (`runOneCardSeason_`)

A new `chestRewardGains = {}` beside `setRewardGains` / `albumRewardGains`, filled in
`buyOneChest` at the point `chestsByTier` is already incremented — i.e. **after** the reward pack
opened successfully, so the refund path cannot leave a credited chest that was never opened.

Returned on the run object as `chestRewardGains`.

### A3. A third row out of `colSimSeasons_` (`EcoGainsSim_v4.gs`)

It already runs `COL_SIM_SEASONS` (50) real seasons per (segment, payer) and caches on `ctx`, so
this is a third accumulator in a loop that already exists. **Zero extra cost.**

```js
out = { sets: sets, albums: albums, chests: chests, n: n, albumsPerSeason: ... };
function simColChests(seg, payer, ctx){ return colRewardRow_('chests', seg, payer, ctx); }
```

### A4. Register the source — the three lists that must agree

1. `CATEGORY_ORDER` — insert `'Col - Chests'` immediately after `'Col - Albums'` (last position).
2. `SOURCES['Col - Chests'] = simColChests`.
3. `sptTotals_` line ~3006 — add `'Col - Chests'` to the guard beside `'Col - Sets'` /
   `'Col - Albums'`. Without it the Season Pass tier a player reaches would depend on rewards
   priced off that tier.

### A5. The sheet edit you have to make

**Add a `Col - Chests` label row to `EcoGainsSim` directly under `Col - Albums`** (and to
`EcoGainsSim_so_far` if it carries the same label list).

This is the [two-lists-that-must-agree] trap in its purest form: a 30-entry `CATEGORY_ORDER` spilling
into a 29-label block does not read blank, it **shifts every row below the insertion point onto the
wrong source**. Because the new row is *last*, nothing shifts — the 30th row simply falls off the
bottom and reads as missing. That is the benign case, and it is why last position was chosen.

The existing gate `EcoGainsSim source labels == CATEGORY_ORDER, row for row` will go **RED** until
the sheet is edited. That is correct behaviour, not a broken gate.

### A6. Gates

| gate | asserts |
|---|---|
| chest rewards conserve | Σ over chests bought of (that tier's authored payout) == `chestRewardGains`, exactly, per season |
| chest gains are non-zero where chests are bought | a cell with `Stars Spent on Chests > 0` has `Col - Chests` coins > 0 — catches the reader silently returning an empty row |
| the pack columns are excluded | a fixture that types `2` into a chest's `3-star Dly` leaves `Col - Chests` unchanged and logs |
| no double count | `Col - Sets` + `Col - Albums` are byte-identical before and after the change |
| the label lists agree | existing gate, extended to 30 |

### A7. Effort and risk

Small. ~60 lines across two files, one sheet edit, five gates. The only real risk is A5, and it
fails loudly.

---

# PART B — payers and nonpayers in ToF

## What the model says today, and why it is wrong

`cfg.beh` is keyed by **segment only**. Every ToF parameter — continue take-up, cash-out stage, runs
per day, max continues — is identical for a payer and a nonpayer. Exactly two things differ:

1. `TOF_PAYER_TOPUPS = 1`, a hardcoded global: one free purchased continue per run, payers only.
2. `tofBalances_(seg, payer)`, the measured coin percentiles from `data_econ`.

**And channel 2 points the wrong way.** Payers hold *less* coin than nonpayers at every percentile
of every segment:

| | p25 | p50 | p75 | p90 |
|---|---|---|---|---|
| 40-99 NONPAYER | 67 | 159 | 652 | 2,740 |
| 40-99 PAYER | 46 | 87 | 234 | 700 |
| **payer / nonpayer** | 0.69x | 0.55x | 0.36x | **0.26x** |

A balance is a **stock, not a flow**. Payers spend theirs; nonpayers hoard because they cannot
replenish. So the affordability curve `tofAfford_` currently makes payers *worse* at continuing, and
the single free top-up is the only thing rescuing them.

Net result, measured (`harness/_probe_tofpayer.js`):

```
segment    payer      pBank   spend   wallet p25..p90
0-9        NONPAYER     9.31%     5.4   65 / 133 / 673 / 3810
0-9        PAYER        9.94%     8.6   51 / 91 / 247 / 1406
40-99      NONPAYER    11.22%    16.6   67 / 159 / 652 / 2740
40-99      PAYER       12.43%    22.3   46 / 87 / 234 / 700
100+       NONPAYER    12.15%    22.8   65 / 162 / 860 / 5264
100+       PAYER       13.59%    29.3   51 / 86 / 274 / 969
```

**Payers bank only 1.07x - 1.12x as often as nonpayers**, and all of it comes from one hardcoded
constant. That is the number this work exists to fix.

## The model, as decided: purchase-on-demand

A payer's advantage is not the coins they are holding — it is that **they can get more at the moment
they need them.** So:

> At a pig, a player who cannot afford the continue from their wallet may **buy coins**. A payer
> rolls `Coin Purchase Take-Up`; on success their wallet is topped up by `Coins per Purchase` (a
> real coin-pack size, not exactly the price), they pay for the continue, and **the remainder stays
> in the wallet for later continues in the same season.**

That last clause is the whole mechanic. Buying a 500-coin pack to pay a 100-coin continue leaves 400
behind, which is what makes payers progressively deeper rather than one rung better. It replaces
`TOF_PAYER_TOPUPS` entirely.

Nonpayers author `Coin Purchase Take-Up = 0` and behave exactly as they do now.

## The ToF sheet, as it would look

**SEGMENT BEHAVIOUR goes from 6 rows to 11** (five segments x two payer flags, plus MAX). A new
`Payer` column at B, and three new parameter columns.

```
SEGMENT BEHAVIOUR
┌──────────┬──────────┬──────────┬──────────┬────────────┬───────────┬──────────────┬───────────────┬───────────┬───────────────┐
│ Segment  │ Payer    │ Continue │ Cash-Out │ Runs per   │ Max Cont. │ Coin Balance │ Coin Purchase │ Coins per │ Max Purchases │
│          │          │ Take-Up  │ Stage    │ Active Day │ per Run   │ override     │ Take-Up   ⚠   │ Purchase  │ per Run       │
├──────────┼──────────┼──────────┼──────────┼────────────┼───────────┼──────────────┼───────────────┼───────────┼───────────────┤
│ 0-9      │ NONPAYER │   0.10   │    10    │     10     │     0     │      0       │     0.00      │     0     │       0       │
│ 0-9      │ PAYER    │   0.10   │    10    │     10     │     0     │      0       │     0.04      │    500    │       2       │
│ 10-19    │ NONPAYER │   0.15   │    10    │     10     │     0     │      0       │     0.00      │     0     │       0       │
│ 10-19    │ PAYER    │   0.15   │    10    │     10     │     0     │      0       │     0.06      │    500    │       2       │
│ 20-39    │ NONPAYER │   0.20   │    10    │     10     │     0     │      0       │     0.00      │     0     │       0       │
│ 20-39    │ PAYER    │   0.20   │    12    │     10     │     0     │      0       │     0.08      │    500    │       3       │
│ 40-99    │ NONPAYER │   0.25   │    10    │     10     │     0     │      0       │     0.00      │     0     │       0       │
│ 40-99    │ PAYER    │   0.25   │    12    │     10     │     0     │      0       │     0.12      │   1200    │       3       │
│ 100+     │ NONPAYER │   0.30   │    10    │     10     │     0     │      0       │     0.00      │     0     │       0       │
│ 100+     │ PAYER    │   0.30   │    15    │     10     │     0     │      0       │     0.18      │   1200    │       4       │
│ MAX      │ PAYER    │   1.00   │    60    │     99     │     0     │   100000     │     1.00      │  100000   │      99       │
└──────────┴──────────┴──────────┴──────────┴────────────┴───────────┴──────────────┴───────────────┴───────────┴───────────────┘
⚠ Coin Purchase Take-Up is an ASSUMPTION, not a measurement. See "the flagged assumption" below.

(the 'What this row says about this player type' prose column stays at the far right)
```

**The values above are illustrative starting points, not proposals I can defend.** Only the
`NONPAYER` rows are safe — they reproduce today's behaviour exactly. Everything in the payer rows is
yours to set; see the sensitivity table I would produce before you pick.

### Why a `Payer` column and not ten combined labels

Two columns filter and sort; a `0-9 PAYER` string does not. The reader keys on `A + '|' + B`.

### What does NOT change on the sheet

`SIM PART` already has a **`Payer` selector at B272**, and `ECOGAINS_TOF(payer, block, nonce)`
already takes it. So `RUN ECONOMICS`, `BANKED REWARD PER RUN` and `GAIN/SPEND PER STAGE` stay at six
segment columns and simply answer for whichever flag B272 holds. **No output block changes width.**

### One new RUN block row, so the money is visible

```
Coin purchases per run        0.00   0.08   0.00   0.11   ...
Coins bought per run          0.0    40.0   0.0    55.0   ...
```

Without this the mechanic is a free win with no cost anywhere on the sheet.

## The code changes

### B1. `tofConfig_` reads the payer dimension (`EcoGainsSim_v4.gs`)

The reader is already **header-driven** (`bc['Cash-Out Stage']` etc.), so inserting a column shifts
nothing. Two changes: read the `Payer` column, and key the map on `seg|payer`.

**Back-compat is required, not optional** — workbook (9) has the 6-row block. If there is no
`Payer` header, key on segment alone and have every lookup fall back:

```js
function tofBeh_(cfg, seg, payer){
  return cfg.beh[seg + '|' + String(payer).toUpperCase()] || cfg.beh[seg] || null;
}
```

### B2. Route every lookup through it — six call sites

| site | file | note |
|---|---|---|
| `tofRun_` | v4:1525 | has `payer` |
| `tofRunBudget_` | v4:1599 | has `payer` |
| `tofCashOutN_(cfg, seg)` | v4:1728 | **signature change** — needs `payer` threaded from 3 callers |
| `tofStageCurve_` | v4:1855 | has `payer` |
| `tofRunOnce_(cfg, beh, ...)` | v4:1553 | already takes a resolved `beh` |
| `cardTofConfig_` | CardOpenings.gs | `prof.tofRow` must resolve `'MAX\|PAYER'` then `'MAX'` |

### B3. The purchase mechanic, in BOTH walkers

This is the risk in the whole plan. ToF is simulated **twice**, by two different algorithms that
must agree:

* **`tofRunOnce_`** (`EcoGainsSim_v4.gs`) — a forward probability walk over a
  `(stage, continues, top-ups)` grid. Feeds `ECOGAINS_TOF`, `simToF`, and therefore EcoGains.
* **`walkTofRun_`** (`CardOpenings.gs`) — an actual door-by-door walk with a depleting wallet.
  Feeds the card sim, and therefore `Col_Cards_Totals`.

The grid in `tofRunOnce_` currently indexes top-ups as a small `t` dimension. **Purchases carry a
wallet remainder, which a probability grid cannot represent without a wallet axis.** Two options,
and I would take the second:

1. Add a coarse wallet axis to the grid. Exact, and turns a `(k x t)` grid into `(k x t x w)` — a
   real cost on every recalc, on the hot path.
2. **Keep the grid, but make the top-up dimension carry a purchase-funded budget**: `t` becomes
   "purchases made", and the affordability at each rung is evaluated against
   `wallet + t x CoinsPerPurchase - (coins spent so far)`. That is exact for the remainder
   arithmetic, keeps the grid two-dimensional, and matches `walkTofRun_` step for step.

`walkTofRun_` takes the same rule directly — it already has a real wallet.

### B4. `TOF_PAYER_TOPUPS` is removed

It becomes `Max Purchases per Run` on the sheet. Keeping both would leave two mechanics granting the
same thing, and the constant is exactly the kind of undocumented override this project has been
burned by.

### B5. The flagged assumption

`Coin Purchase Take-Up` gets the full **Kite Festival treatment** (CLAUDE.md D25):

* a warning block in `CLAUDE.md` naming the value, what it is not, and how to change it without code
* printed by **every harness run**, next to the number it is replacing, so it cannot rot quietly
* a sensitivity table produced before you choose: take-up 0 / 0.05 / 0.10 / 0.20 against payer
  `pBank`, coins bought per player, and the resulting payer/nonpayer ratio

I would not ship a number without showing you that table first.

### B6. Gates

| gate | asserts |
|---|---|
| **the two walkers agree** | `walkTofRun_` realised bank rate over many seeds converges to `tofRunOnce_`'s `pBank`, within Monte-Carlo error, **with purchases on**. This is the one that matters — two models of one event is the failure this project keeps re-finding, and today it is only *reported*, not gated |
| take-up 0 is bit-identical | a sheet with `Coin Purchase Take-Up = 0` everywhere reproduces the pre-D53 numbers exactly, random stream included |
| back-compat | a 6-row block with no `Payer` column still runs, and every payer/nonpayer pair reads the same |
| purchases are bounded | never more than `Max Purchases per Run`; coins bought == purchases x `Coins per Purchase` |
| the remainder carries | a run that buys once and continues twice spends less than two purchases |
| MAX still resolves | `tofRow: 'MAX'` finds the MAX row under both keying schemes |
| monotone in take-up | raising `Coin Purchase Take-Up` never lowers `pBank` |

### B7. Effort and risk

Substantially bigger than Part A. The sheet builder, the reader, six call sites, **two walkers**,
and seven gates. The grid change in `tofRunOnce_` is the part I would want to land and gate on its
own before touching the card sim.

---

## Suggested order

1. **A** end to end (small, independent, immediately useful — it surfaces 786 coins/player that
   EcoGains cannot currently see).
2. **B1 + B2 + back-compat**, with take-up 0 everywhere. Gated bit-identical. No behaviour change,
   sheet and reader ready.
3. The sensitivity table. **You pick the take-up values.**
4. **B3** in `tofRunOnce_`, gated against `walkTofRun_`.
5. **B3** in `walkTofRun_`, plus the RUN block rows.

## Open questions I would want answered before step 3

* Is a coin purchase during ToF distinguishable in `data_econ` or the IAP data? If it is, the
  assumption becomes a measurement and B5 mostly goes away.
* Should `Cash-Out Stage` really differ by payer flag? It is a *behaviour* (when do I bank), not an
  affordability constraint, and I have no evidence payers bank later. The illustrative table above
  assumes they do; that assumption is separable and could stay segment-wide.
