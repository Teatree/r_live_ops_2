# Col_Cards_* — what to change in the workbook (2026-09-09)

Three things landed in the engine: the chest reporting rows came off `Col_Cards_Totals`, `Col_Cards_Cloud`
grew **p95/p98**, and `Col_Cards_Totals` grew an eleventh column, **MAX**. Underneath all of it, the card
sim stopped giving every simulated player the same attendance and started drawing each one's intensity
off the segment's active-day percentile curve — which is the change that makes a p98 mean anything.

No sheet is re-imported. This is the full list of edits to make by hand.

Row numbers below are **your current sheets** (`Col_Cards_Totals` 611 rows, `Col_Cards_Cloud` 415 rows).
Every block is found by its column-A **bar label** at run time, so if your rows have drifted, find the bar
and count from there — the row numbers are a convenience, not a contract.

---

## 0. Re-paste three `.gs` files

| File | Why |
|---|---|
| `engine/CardOpenings.gs` | attendance model, p95/p98, the P98 block, MAX, chest rows removed |
| `engine/EcoGainsSim_v4.gs` | the profile seams (`profP_` / `profPart_` / `topRankOf_`), full-pass override |
| `engine/EcoGainsSim_Daily.gs` | `packGrantPlan_` takes a profile |

All three, or none — `CardOpenings.gs` calls into the other two with an extra argument.

> The project should still contain exactly ten `.gs` files, one copy each. A second copy of any of them is
> a `const` redeclaration away from killing every `ECOGAINS_*` function in the project.

---

## 1. `data_seg_beh` — insert two columns at M and N

Right-click column M (`weekday_active_rate`) ▸ **Insert 2 columns left**. Then:

| Cell | Value |
|---|---|
| `M1` | `active_days_p95` |
| `N1` | `active_days_p98` |
| `M2:N11` | the numbers, per (segment, payer) row |

Everything to the right shifts to O and beyond. **Nothing breaks** — the engine reads `data_seg_beh` by
header name (`headerIndex_`), never by column position, so no other formula or script cares where these sit.

`sqls/data_seg_beh.sql` has been updated to emit both, so the next export carries them without a manual step.

**These columns are optional.** With them absent the model interpolates from p90 straight to the window
length and still works; the curve is just coarser at the top, which is the end you added them for.

---

## 2. `Col_Cards_Cloud` — the p98 block, and wider bands

### 2a. The band blocks get 12 more columns

Each per-permutation band block went from `p10 p25 p50 p75 p90 MEAN` (6) to
`p10 p25 p50 p75 p90 p95 p98 MEAN` (8) per metric, so a block is now **49 columns wide (A..AW)** instead
of 37 (A..AK). **No rows move** — the block height is unchanged, so `CLOUD_BAND_STRIDE` is still 37 and
every block stays where it is.

The engine writes the new cells whether or not they are formatted, so **this step is cosmetic** — the
numbers are correct either way.

The quickest way to style them: select columns **B:AK**, copy, then paste-format-only into **AL:AW**
(Edit ▸ Paste special ▸ Format only). One paste covers every block at once.

The ten band-block label rows are at **43, 80, 117, 154, 191, 228, 265, 302, 339, 376**; each block's
header row is its label row **+ 2**, and its 33 data rows follow.

### 2b. Add the `P98 - ALL PERMUTATIONS` block at the bottom

The MEANS block at the top now has a twin at p98 — all ten permutations of a metric on one axis, so a
cross-segment chart of "the top of each segment" is possible. The bands can't do that; they put each
permutation in its own table.

1. Select rows **4:39** (the whole MEANS block: bar, group row, header row, 33 data rows — 36 rows).
2. Copy.
3. Paste into row **417** (leave 416 blank as a separator). It lands on 417..452.
4. Set `A417` to exactly:

```
P98 - ALL PERMUTATIONS
```

That is the only cell you must type. The engine writes the group row, the header row and all 33 data rows.

> If you'd rather put it directly under the MEANS block (where the builder puts it), that works too —
> insert 36 rows above the `PER-PERMUTATION BANDS` bar and paste there. Everything is found by label, so
> only the row numbers differ. Appending at the bottom is safer if you have charts anchored to rows.

**If you skip this block entirely, nothing breaks.** The engine logs "block skipped" and the p95/p98
columns still appear in every band block.

---

## 3. `Col_Cards_Totals` — the MAX column, and its mix table

### 3a. Column L (and M) — formatting only

Every block now writes **11 permutation columns instead of 10**, so:

| Block | Wrote | Now writes |
|---|---|---|
| TOTALS, TOTALS band, CADENCE, the three ECONOMY IMPACT blocks, the four PER SOURCE blocks | `A..K` | `A..L` |
| UNLIMITED BOOSTERS IN MINUTES (starts at C — B is your minutes input) | `A..L` | `A..M` |

Nothing to insert; the engine just writes one column further right. Copy the formatting of column K into
column L (and L into M for the UL block) so it doesn't look like an afterthought.

The header cell of each block will read `MAX`.

### 3b. The three `Chests Bought - …` rows — do nothing

They're gone from the engine. The TOTALS blocks reserve 16 rows and the engine now writes 13, and it
**clears a block's whole reserved height before writing**, so rows 19:21 and 38:40 blank themselves on the
next run. You can delete those six rows afterwards if you want the sheet tighter, but you don't have to.

`Stars Earned`, `Stars Spent on Chests` and `Final Star Balance` all stay — chest buying still runs, it just
no longer gets a per-tier breakdown.

### 3c. Add the `PACK & CARD MIX - MAX` block

Your last mix block, `PACK & CARD MIX - 100+ PAYER`, is bar row **579**, header **580**, data **581:611**.

1. Select rows **579:611** (33 rows: bar + header + 31 data rows).
2. Copy.
3. Paste into row **613** (leave 612 blank). It lands on 613..645.
4. Set `A613` to exactly:

```
PACK & CARD MIX - MAX
```

> ### ⚠ Copy the whole block, not just the bar
>
> The mix writer **clamps to the room it finds** — it counts the rows between its bar and the next thing
> that looks like a bar, and writes at most that many. A bar with nothing underneath it measures a room of
> zero and writes **nothing at all**, which on the sheet is indistinguishable from a block that was skipped.
> Copying an existing block brings the 31 reserved rows (and the formatting) with it.
>
> This is gated in `harness/_mock_cloud.js` (§10c) — the fixture adds the bar *and* the rows, exactly as
> you will.

### 3d. Add the `ALBUM COMPLETION (population-weighted)` block

New on 2026-09-10 (D50). Written by its **own** menu run, not by the cloud sweep.

It is exactly the same shape as the `CADENCE` block — bar + header + 8 data rows, 12 columns — so
copy that one rather than building it by hand. Do this **after** step 3c, so the sheet already ends
at row 645:

1. Select rows **42:51** (the `CADENCE` block: bar 42, header 43, data 44:51).
2. Copy.
3. Paste into row **647** (leave 646 blank). It lands on 647..656.
4. Set `A647` to exactly:

```
ALBUM COMPLETION (population-weighted)
```

> Same trap as the mix block, for the same reason: **empty rows do not extend the used range.** A
> bar with genuinely blank rows under it measures a room of zero and writes nothing. Copying a block
> brings real cell contents (and the formatting) with it, which is what makes the rows count.

Its columns are `Metric | POPULATION | <the 10 measured cells>` — **MAX is deliberately absent**, a
ceiling player is not part of a population. The block is found by bar label, so it can live anywhere;
the bottom is simply the only place that moves nothing else.

---

## 4. Run it

**EcoGainsSim ▸ Simulate card cloud** — everything except the album block.

**EcoGainsSim ▸ Album completion across the population** — the album block only. Separate on purpose:
this is the one number that wants a big sample (see below), and running it alone lets you crank `B2`
up without also paying for the full Cloud sheet.

Both toasts name any block whose bar they couldn't find, so if something reads stale, that line says
which. Both read `B2` (players per cell) and `D2` (seed) from `Col_Cards_Totals`, so a cell simulated
by both contains exactly the same players.

---

# What actually changed in the model

## Per-player attendance intensity (D48)

Before: every one of the 50 simulated players in a permutation shared one pair of activity rates, so the
cohort's active-day count was Binomial(33, p) — a narrow bell around the mean. The model could not produce
a hardcore player, and its p98 was its p90 plus card-draw luck.

Now: each player draws `u ~ U(0,1)`, reads an active-day target off the segment's percentile curve
(p25/p50/p75/p90, plus p95/p98 once you add them), and their weekday/weekend rates are scaled to hit it
while keeping the measured weekday:weekend shape.

Active days, 100+ PAYER:

| | mean | p25 | p50 | p75 | p90 |
|---|---|---|---|---|---|
| **measured** (`data_seg_beh`) | 11.5 | 4 | 5 | 18 | 33 |
| model **before** | 11.4 | 9 | 11 | 13 | 15 |
| model **after** | 11.4 | 4 | 6 | 21 | 31 |

The **level is anchored, deliberately, to the activity rates' own `Σ p_day` and not to `active_days_mean`.**
`data_seg_beh` carries both and they disagree by ~4% (0-9 NONPAYER: 10.91 vs 10.49) — they're computed
differently, and the SQL flags it as `[F2]`. Everything downstream in this engine — reach, the daily
allocation, `packLane_`, the gains model — is built on the rates. Anchoring to `active_days_mean` would have
moved the cohort's expected active days by 4% *on top of* the shape change, and the two effects could no
longer be told apart. So the shape comes from the percentiles and the level from the rates, and **exactly
one thing changed: the spread.**

### What this does to the numbers

Mean packs per season fall 4–14%, and the tail roughly doubles:

| permutation | mean before → after | p90 before → after | p98 after |
|---|---|---|---|
| 0-9 NONPAYER | 39.9 → 38.5 | 56 → 81 | 101 |
| 20-39 PAYER | 48.8 → 44.2 | 65 → 83 | 97 |
| 40-99 PAYER | 49.5 → 43.6 | 64 → 77 | 90 |
| 100+ PAYER | 44.2 → 38.9 | 57 → 68 | 80 |

### The mean falls for a real reason, and it is worth knowing

`reach = 1 - Π(1 - p_d)` is **concave** in intensity. By Jensen, a mixed cohort reaches a *multi-day*
instance less often than a uniform cohort on the same mean — half the players never showing up and half
showing up every day gives a 5-day instance reach 0.50, where everyone at 50% gives 0.97.

So **the homogeneous model overstates multi-day reach**, and `packLane_` / `ECOGAINS_SIM` still use it.
The card sim and the gains model no longer agree to the cent on multi-day instances. They still agree
**exactly** on every 1-day instance, and exactly everywhere when the model is switched off.

Both halves are gated (`harness/_mock_cards.js`): a 1-day instance reaches the same cohort under both
models to floating-point; a multi-day instance is strictly lower and both rise with duration; and the
cohort mean active days is preserved exactly.

### To turn it off

`SEG_ATTENDANCE_MODEL = 'homogeneous'` in `engine/CardOpenings.gs` restores the pre-2026-09-09 numbers
**bit for bit**, random stream included (the intensity draw is skipped, not drawn-and-discarded).

## p95 / p98 — read the sample size

`p98` of 50 players interpolates between the **49th and 50th** of 50 sorted values. That is the
**near-maximum of the cohort**, not an estimate of a population percentile, and it moves a lot between
seeds. The run stamp on `Col_Cards_Cloud` now says so whenever `B2 < 200`; the warning disappears on its
own once you raise it. At 200 players the 98th percentile has four players above it and starts to mean
what it says — and 200 × 11 permutations still fits inside the Apps Script time budget (the sweep stops
early and says so if it ever doesn't).

## MAX — the ceiling column

`MAX` reads **40-99 PAYER** data — the config sheets, the event instances, the accrual curves, the levels
and minutes per active day — and forces only these:

| forced | effect |
|---|---|
| attendance 1.0 | in the game all 33 days |
| first place | the top authored rank of every leaderboard, every instance, and every Team Event block |
| every rung | milestone / streak / matchables survival = 1 on every ladder |
| opt-in 1.0 | takes part in everything, **including Kite** (overrides the 0.35 assumption) |
| whole Season Pass | all 30 tiers, FREE and PAID |
| ToF `MAX` row | the ToF sheet's own authored MAX row — see below |

He is a **bound, not a forecast**, and never mixed into the ten measured columns. The card *draws* are
still random for him, so he gets a p10–p90 band like everyone else — that spread is purely how the cards
fell, because nothing else is left to vary.

He is deliberately **not** on `Col_Cards_Cloud`: those blocks are per-day distributions of a cohort, and
sitting a bound on the same axis as a p10–p90 band invites reading it as the band's top end.

MAX vs 40-99 PAYER, packs per season:

| | 40-99 PAYER | MAX | |
|---|---|---|---|
| **TOTAL PACKS** | 43.3 | **205.7** | 4.8× |
| Daily Night Sky Prize | 9.1 | 87.0 | 9.6× |
| Rainbow Maker | 9.2 | 20.0 | 2.2× |
| Hatchling Hideaway | 3.4 | 15.0 | 4.4× |
| Target Day | 1.7 | 12.0 | 7.1× |
| Flash Race | 0.4 | 12.0 | 30× |
| Season Pass (Free + Paid) | 8.0 | 8.0 | 1.0× |
| Star Chest (all tiers) | 2.0 | 9.7 | 4.9× |
| **ToF** | **2.7** | **0.0** | — |
| cards drawn | 143 | 746 | 5.2× |
| sets completed | 3.4 | 22.8 | 6.6× |
| albums finished | 0.13 | 2.0 | 15× |

Season Pass is 1.0× because 40-99 PAYER already reaches the top of the track — there is no headroom there.

> ### ⚠ MAX's ToF row reads 0, and that is the sheet talking, not a bug
>
> The `ToF` sheet has carried its own authored **`MAX` segment row** (row 281) since the event was built:
> continue take-up 1.0, **cash-out stage 60**, 99 runs per active day, a 100,000-coin balance override.
> The engine reads that row rather than inventing one, so the ceiling stays editable where every other ToF
> input lives.
>
> The continue-cost ladder has **10 rungs**, so a run survives at most 10 pigs. Reaching stage 60 needs
> ~15 pigs survived. MAX therefore plays **165 runs a season and banks 0 of them** — which the
> `ToF Runs Played` / `ToF Runs Banked` rows on the sheet show directly.
>
> That is faithful to "goes for everything": maximum greed in this event returns nothing. If you'd rather
> MAX cashed out somewhere reachable, change **one cell** — `Cash-Out Stage` on the ToF sheet's MAX row:
>
> | Cash-Out Stage | ToF packs | MAX total packs | runs banked of 165 |
> |---|---|---|---|
> | 6 | 322.9 | 535.6 | 98.4% |
> | 10 | 241.9 | 452.6 | 49.0% |
> | 15 | 143.4 | 353.7 | 17.4% |
> | 20 | 51.8 | 259.6 | 4.5% |
> | **60 (as authored)** | **0.0** | **205.7** | **0.0%** |
>
> The same arithmetic applies to the five real segments — the engine already notes that 100+ banks
> 1 run in 7,900 at its authored cash-out.

---

# Afterwards

`harness/_mockdata_collections.json` is a dump of the **9th Sep** workbook, so it predates all of this. Once
your sheets carry the new blocks, re-dump so the harness tests the real layout instead of a fixture:

```
python harness/_dump_mockdata.py --workbook "workbooks/<newest COLLECTIONS workbook>.xlsx" \
       --out harness/_mockdata_collections.json
node harness/_mock_cloud.js
node harness/_mock_cards.js
```

Two lines in `_mock_cloud.js` are informational until then and will go quiet on their own:

- `SKIP p98 block: this dump has no "P98 - ALL PERMUTATIONS" bar`
- `every PACK & CARD MIX block this sheet reserves is found by label — 10 of 11 present`

Neither is a failure. Both blocks are already proven end-to-end by the §10c fixture, which adds the bars to
the mock sheets, runs, checks that the P98 table reconciles cell-for-cell with the p98 column of every band
block and that the MAX mix table's tier columns sum to its Packs column, and then restores.

`display/Col_Cards_Cloud_v1.xlsx` and `display/Col_Cards_Totals_v1.xlsx` have been regenerated to the new
layout. You are **not** importing them — they exist so a future clean import is right and so the builder
can't drift from the engine. Their row numbers differ from yours (the TOTALS block lost 3 rows and the
Cloud sheet gained a block), which is harmless: everything is located by bar label.


---

# Album completion across the population (D50)

**EcoGainsSim ▸ Album completion across the population.** Three numbers, plus the basis they rest on:

| row | what it is |
|---|---|
| Population finishing album 1 | `P(albums finished ≥ 1)` — a **rate**, not the `Albums Completed` mean already on the sheet |
| Envelopes opened to complete it (finishers) | mean envelopes **up to and including the one that finished it**, among finishers only |
| Cards drawn to complete it (finishers) | mean cards **including duplicates**, among finishers only |
| Finishers in sample / Players simulated | so you can see whether a cell's numbers mean anything |
| Population represented / 95% CI / Basis | the denominator, the Monte-Carlo error, and the stamp |

**You choose where the % also lands.** Type `Album % output cell` into any cell on
`Col_Cards_Totals`, and an A1 address in the cell to its right:

```
Album % output cell  |  Dashboard!B2
Album % output cell  |  O3            ← no sheet name = Col_Cards_Totals
```

The run mirrors the headline rate there as a **raw fraction** (0.0276), so format that cell as a
percentage — it is then a number you can chart or reference, not a string. Blank or missing means
nothing extra is written; a typo is logged and skipped, never thrown, so a mistyped address cannot
kill a run that already has its answer.

**The result panel carries two breakdowns** below the headline numbers:

- **Which players finished it** - each engagement group's share of all finishers, its share of the
  player base, and the ratio between them. Both columns matter and they disagree: `100+` supplies
  only **1.5%** of finishers (it is 1.7% of the base), while `40-99 PAYER` is **2.8x** more likely
  to finish than an average player. Headcount alone would say the hardcore do not matter; the ratio
  alone would say they dominate.
- **Where a finisher's cards came from** - cards, not envelopes, by source in CATEGORY_ORDER with a
  green colour scale on the share. Sums to the "Cards drawn to complete it" row exactly, because the
  per-source counts are frozen at the moment album 1 completes rather than read at season end.
- **What an envelope is worth** - coins of set and album reward attributed to each pack tier. Every
  reward is split across the NEW cards that unlocked it, each card's share going to the pack that
  supplied it; duplicates carry the chest packs their stars funded. Attributed, NOT marginal: a
  threshold reward has no value in isolation, so what can be stated is a share of value really paid.
  **The 1-star tier delivers 39% of all collection reward value** on volume alone, while the premium
  tiers are worth 2-3x each and arrive 12x less often.

**It also shows a result panel** when it finishes — the rate, the two finisher averages, the CI and
the basis. If `B2` is under 200 the panel carries a red warning, because reading a ~3% rate off 50
players is the one way to misread this badly.

**How long it takes.** Measured: ~6.6s of fixed setup (the calendar + every config sheet, ten
times) plus **10.5ms per player-season**.

| `B2` | node | Apps Script (3× / 6× / 10×) |
|---|---|---|
| 100 | 11.4s | 34s / 1m09s / 1m54s |
| **200** | 21.6s | **1m05s / 2m09s / 3m36s** |
| 500 | 36.4s | 1m49s / 3m39s / **6m04s** |

The menu limit is 6 minutes and the run self-stops at 5, writing what it has — so **500 can produce
a partial sweep**. A partial run renormalises over the cells that actually ran and says
`PARTIAL RUN — only N% of the player base` in the block, the panel and the toast; it never quietly
reports a low rate as though it were complete. **200 is the setting I'd use.**

**Why it is not a formula.** A custom function gets **30 seconds**. Walking the calendar and every
config sheet for the ten cells costs 6.6s in Node alone — before a single player is simulated — and
Apps Script is several times slower. The setup would blow the cap with nothing to show. A menu run
gets six minutes.

**Two different weightings, on purpose.** The *rate* is weighted by `data_seg_beh.unique_players`. The
two finisher averages are weighted by the **finishers each cell contributes** (population × rate) —
the mean over all finishers, not the mean of ten cell means, which would let a cell with three
finishers pull as hard as one with three hundred.

**The denominator.** The ten cells `data_seg_beh` carries — 54,521 players. **`A. 0` is not in it**,
and cannot be: that segment has no behaviour telemetry anywhere in this workbook. So this is "of
players with at least one saga completion in the window", not "of everyone who opened the app". The
block prints the population so the claim can't drift from the number.

**Sample size — this one needs it.** The rate is ~3%, so:

| players per cell | 95% CI on the population rate |
|---|---|
| 50 (the default) | ±1.69 pp |
| 200 | ±0.84 pp |
| 500 (the cap) | ±0.53 pp |

At 50 the answer is "somewhere between 1% and 6%", which is not an answer. **Set `B2` to at least
200 before trusting this block**; the CI is printed in it so you never have to guess. Per-*cell*
numbers stay noisy even at 500 — separating a 1.5% cell from a 4% cell needs ~4,500 each.

> ### ⚠ It reacts to the pack ladders, and it reacts HARD
>
> This is the number you asked for, so this is the caveat that matters: album completion is a
> **threshold** outcome, and the population piles up just short of the line. Mean album completion
> runs ~61% while only ~3% actually finish. A 10% cut in envelope volume does **not** move the rate
> by 10% — it can plausibly halve it. Read this as a statement about the current ladders, not about
> the players.
>
> Gated: blanking every authored `*-star Dly` cell takes the rate to **exactly 0**, and restoring
> them brings it back to the cent.
