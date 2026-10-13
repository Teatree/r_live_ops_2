# THEIR SIM vs OUR SIM (YOU ASKED FOR THIS)

What the colleagues' Hex notebooks simulate, and how it differs from `engine/`. Written 2026-10-13
from `hex_folder/album/album_notebook_export` and `hex_folder/ToF/tof_simulation_notebook`.

**Two sentences up front.** The album notebook contains **no simulation at all** — it queries real
player data and then compares it against *our* numbers, which it reads in as a pasted file. The ToF
notebook is the opposite: **pure simulation, zero measured data**, a million synthetic players run
through a hand-typed ladder.

---

## 1. The album notebook is already grading us

`01_input_bands_file_uploaded.tsv` is **our `Col_Cards_Cloud` sheet**, pasted in. The header reads
`1000 players x 10 permutations | seed 932341729 | 33-day cal_new window | 2026-10-05 15:55`, and
the parser in `02_parse_percentile_bands.py` looks for exactly our metric labels (`Packs Opened`,
`Cards Drawn`, `Unique Cards`, `Sets Completed`, `Album %`, `Star Balance`) and our permutation
labels (`0-9 NONPAYER` …).

So they built, in Hex, the same sim-vs-actual overlay we just built into `Col_Charts` — ours draws
the actuals onto the simulation, theirs draws the simulation onto the actuals. Same comparison, two
directions. Their charts index (`06_charts_index.txt`) lists 36 of them: six metrics × six segments,
each plotting `p10 / mean / p90 / actual_mean`.

**Three things worth knowing about how they read us:**

- They take **3 of our 8 statistics** — `_STAT_MAP` maps only `MEAN`, `P10`, `P90`. Everything at
  p25/p50/p75/p95/p98 is silently dropped. (This is also why our overlay now writes all eight: so
  the comparison can go either way at full resolution.)
- They derive **`album_pct = unique_cards / 72.0 * 100`**, with 72 hardcoded. Ours is
  `(albums_done + progress_in_current) × 100`, so it **passes 100** — album 2 at 30% reads 130.
  Theirs cannot exceed 100. At the top segments (where ~50% of `100+ PAYER` finish album 1) our
  curve will run above theirs for a reason that is definitional, not a disagreement.
- They have **no actual for Star Balance.** The metric is in their map so the *predicted* band
  charts, but their SQL produces only four metrics and `album_pct` derived from one of them. Our
  star-balance curve has nothing to be compared against yet.

Their per-player query (`03_album_actuals_player.sql`) is good and we should reuse it — it is the
basis of `PROMPT_hex_notebook_album.md`. It already produces our exact keys (`0-9`…`100+`,
`PAYER`/`NONPAYER`), day-of-season as `DATE_DIFF(start, date) + 1` capped at 28, and a cumulative
window total per player per metric.

---

## 2. The ToF notebook: where the two simulations actually differ

Both simulate the same event over 35 stages with the same continue-cost ladder
(`75, 150, 300, 500, 750, 1000, 1250, 1500, 1750, 2000` — identical to our `ToF` sheet), and both
agree that an *n*-star envelope holds *n+1* cards. Everything below that diverges.

| | **Theirs** (`13_tof_simulation.py`) | **Ours** (`tofRunOnce_`, `walkTofRun_`) |
|---|---|---|
| **Who plays** | 1,000,000 synthetic players, **no segments** | 10 real `segment × payer` cells from `data_seg_beh`, 50–2,000 players each |
| **What makes players differ** | Two numbers drawn per player: a *ready-to-lose* coin budget and a *cash-out target*, coupled by a 0.5 rank correlation | Measured per-segment continue take-up (0.05 → 0.83) and a real coin wallet drawn from `hc_balance` percentiles, depleted across the season |
| **Where those numbers come from** | **Assumed** — power laws, 10→2,500 coins (α 1.3) and 20→10,000 coins (α 1.1), set by notebook sliders | **Measured** — telemetry, with the authored cash-out stage as the one assumption |
| **When a player stops** | **Adaptively, on value**: stop once collected rewards hit your target (unless the next pig is cheap relative to winnings), or once you have spent past your budget | **At a fixed authored stage** — stage 10 for every real segment — plus a willingness roll × affordability per pig |
| **Pig odds** | A **typed per-stage table**: 0% on every 5th stage, otherwise 25% / 33% / 50%, **rising with depth** | **Derived from the door layout**: `1 − pigs ÷ non-empty doors`, so 1 pig behind 4 doors = 75% survival, **flat with depth** |
| **How deep a run can go** | Up to **35** pigs paid (ladder extended flat at 2,000) | At most **10** — the authored rungs are the cap |
| **Reward at a stage** | Pick **one of 3–4 hand-typed options** uniformly, each pre-converted to a single coin value | Analytic walk takes the **mean of the reward doors** given survival; the card sim's played walk picks one door uniformly |
| **How many runs** | **Exactly one per player**, no tickets, no calendar | Tickets earned from every other source, spent at up to *Runs per Active Day*, only on days the player plays and the event is live, inside the 33-day window |
| **On a bust** | You lose **everything** — cards zeroed, coins won zeroed, net = −spend | The pot is lost; coins spent stay spent and are reported on the ToF sheet rather than netted into the gains row |
| **What comes out** | A distribution over 1M players: net coin gain, coins won, coins paid, cards, stages cleared, pigs passed — percentiles + a trimmed mean | Per-segment resource gains (coins, SPT, boosters, envelopes, tickets) feeding the economy grid, and envelopes feeding the card sim |
| **Randomness** | numpy, one global seed (42) | mulberry32, per-player avalanched seeds, separate streams for acquisition vs card draws |

### What each one is actually for

Theirs answers **"is this ladder fun and profitable for a player who thinks like this?"** — a
push-your-luck tuning tool. The adaptive stop rule is a genuinely better model of how a human plays
a gambling ladder than our fixed stage, and a million players gives it clean tails.

Ours answers **"what does this event add to each segment's resource faucet over a 33-day
calendar?"** — it has to connect to tickets, the season, the envelope cutoff and the other 28
sources, and it has to be per-segment because that is what the economy grid is.

Neither subsumes the other. But two of their choices are worth taking seriously:

### Two things their sim says that ours should answer

1. **The pig odds may rise with depth, and ours do not.** They type 25% → 33% → 50% as stages get
   deeper; we derive a flat 75% survival from four doors with one pig. If their table reflects the
   live config, our survival is **too generous deep in the ladder**, which would overstate ToF
   coins, SPT and envelopes for anyone who gets past stage 10. `data_tof_stages` (`survive_rate`
   per stage) is the measurement that settles it, which is why that table is in the ToF prompt.
2. **Our 10-rung cap may understate whales.** Their ladder runs 35 rungs flat at 2,000 coins, so a
   rich player can pay 35 pigs; ours stops offering continues after 10 because that is all the
   sheet authors. A player with a 100,000-coin balance would keep going in their model and cannot
   in ours. This is the same mechanism behind the known **MAX column reads 0** oddity — our ceiling
   player cashes out at stage 60 against a 10-rung ladder and therefore banks nothing.

### One thing ours says that theirs cannot

Their cash-out rule is in **coins of reward value**, so it needs every reward priced in coins — and
the notebook does that **by hand**, in the `stage_rows` table, one coin value per option. Ours
prices rewards through `item_vals`, the same table the rest of the economy uses.

**They have already drifted, and it is measurable:**

| Envelope | Their notebook | Our `item_vals`, vacation workbook | Our `item_vals`, current workbook |
|---|---|---|---|
| 1-star | 25 | 25 | **24.5** |
| 2-star | 45 | 45 | **49.5** |
| 3-star | 110 | 110 | **124.5** |
| 4-star | 220 | 220 | **249.5** |
| 5-star | 335 | 335 | **399.5** |

Their column is an exact copy of our item_vals **as of the vacation workbook** — so the prices were
lifted from us, and the workbook has since moved on without them. The 5-star envelope is now priced
19% higher on our side than in their cash-out rule.

Worse, the vacation review already found that *those* numbers were wrong: finding **K3** showed the
25/45/110/220/335 column assumed odds the simulation does not produce (unnormalised weights, the
wrong 5-star row, and the copies multiplier left out) and recomputed them as 21/38/68/121/207 on
their own unit scale. So their cash-out thresholds are driven by a price column that was (a) copied
from us, (b) already known to be over-priced at the top tiers, and (c) now stale as well. Any
conclusion their sim reaches about *when* a player cashes out inherits all three.

---

## 3. The practical upshot

- Reuse their album SQL; it is correct and it already produces our keys.
- Ask for `data_tof_stages` with real `survive_rate` per stage — it is the one measurement that
  could change our ToF output materially, and neither sim has it today.
- Expect our `Album %` curve to sit above theirs at the top segments. That is album 2, not an error.
- Their star-balance band has no actual behind it, in either direction. Ours now has a column for
  it; nothing has measured it yet.
