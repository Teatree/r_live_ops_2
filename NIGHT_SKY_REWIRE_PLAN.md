# Night Sky Re-wire Plan

**Status: IMPLEMENTED 2026-07-06 — but PARKED OFF behind `NS_SIMULATE = false`** (added later the
same day): the user judged the model to OVERESTIMATE actual NS gains even with unchanged configs;
rather than re-open the model, NS is carried in all three views until the flag in
`EcoGainsSim_v4.gs` is set true. The machinery below stays verified and ready.

Implementation notes (same day, per user instruction to proceed). Choices made on
the open items, all the recommended ones — flag if any should change:
- **§3 fork → Option A** (survival distribution scaled by N; constant `NS_STREAK_N = 1.25` lives
  in `EcoGainsSim_v4.gs`, shared by the PBP sim).
- **§6.3 → realized longest run from the trace** for PBP Sampled mode; Expected mode = p50 × 1.25
  (per §4.3 as written — note Luck deliberately does NOT move the NS streak percentile).
- **§6.4 → N = 1.25 uniform** across all segments and payers.
Verification (§5) all green; one gate reinterpreted: monotonicity is asserted on **E_day**, not
the window TOTAL — the 100+ TOTAL (775 HC) legitimately lands below 40-99 (944 HC) because the
100+ cohort's measured Σ p_day is 6.9 days vs 10.5 (data_seg_beh active rates), while E_day is
strictly monotone (5.8 / 22.6 / 42.6 / 89.7 / 112.3 HC per active day, NONPAYER).
Doc updates: SIMULATION_METHODOLOGY §1/§2/§3/§7.2/§8/§12/§13/§14, SIMULATION_PLAN §2.16 + §4.
Original design below, kept for the rationale record.

---

**Original status:** DESIGN. Written 2026-07-06 from a decision round with the user.

**Why NS is on hold today.** Night Sky's bottom-up sim (`simNightSky` in `EcoGainsSim_v4.gs`) was
judged wrong on 2026-07-02 and is commented out of the `SOURCES` registry, so NS is **carried**
(= `data_gains` measured, diff 0) in the 33-day sim. The play-by-play sim prices NS with a separate,
broken handler (§4.3). This plan makes all three views price NS the same way, per the method from the
standalone NS Excel study (`1_DAY_NS_TD_5_Segs_V3`).

There are **two NS implementations** in this repo — don't confuse them:
- **(a)** the standalone Excel study (`1_DAY_NS_TD_5_Segs_V3`) — the SUMPRODUCT-over-streak-percentile
  model. Considered sorted; it's the method we are porting.
- **(b)** its port into the engine (`simNightSky`) feeding the 33-day sheet — the thing that's on hold.

---

## 1. Locked decisions (from this round)

| # | Decision |
|---|---|
| Axis | **Cumulative** — gate each milestone on `Cum Streak Req` (finishers tend to run the whole streak clean). |
| Effective budget | `effStreak = max_streak_per_day × N`, **N = 1.25 fixed** (a chosen constant from the Excel study; represents landing ~a second streak of similar size, and absorbs streak resets). |
| Method form | **Keep the survival-weighted version** (integrate across percentiles) — NOT a single-percentile hard threshold. |
| Streak source | **`data_streaks`** (`max_streak_per_day_p25/p50/p75/p90`) — this is the clean, un-A/B-diluted source. **NS only** (other sources keep `data_seg_beh`). |
| Config | **Config is king.** Price the live `NS` sheet exactly as-is: per segment, 3 rounds × 1 milestone, single `Final` path (no L/R branch). Ignore the 5-round L/R design shape. |
| Gating | **Honest — no free milestone.** A milestone is only earned when `effStreak` clears its `Cum Streak Req`; round 1 is not granted for free. |
| Tail | Accepted as-is — do NOT worry about milestones past p90 (user call). |
| A/B validation | Not needed on the streak side (`data_streaks` is clean). |

**Live `NS` config (workbook 6), `Cum Streak Req → HC`, + booster at milestone 1:**

| Seg | m1 | m2 | m3 | m1 booster |
|---|---|---|---|---|
| 0-9   | 2→0    | 5→10    | 10→15   | 20 UL Lives |
| 10-19 | 6→10   | 13→30   | 26→60   | 20 UL Lives |
| 20-39 | 11→15  | 26→50   | 42→100  | 20 UL Lives |
| 40-99 | 28→50  | 60→120  | 100→250 | 30 UL Lives |
| 100+  | 80→100 | 175→300 | 280→400 | 60 UL Lives |

(m2 also grants 1 Red; m3 grants 1 Chuck + 1 Slingshot [or 1 Bomb + 1 Comet for 40-99/100+]. Read live
from the config — no numbers in code.)

**`data_streaks` `max_streak_per_day` (NONPAYER p25/p50/p75/p90), and ×1.25:**

| Seg | p25 | p50 | p75 | p90 | ×1.25 (p25/p50/p75/p90) |
|---|---|---|---|---|---|
| 0-9   | 1  | 3  | 5   | 9   | 1.25 / 3.75 / 6.25 / 11.25 |
| 10-19 | 4  | 7  | 13  | 20  | 5 / 8.75 / 16.25 / 25 |
| 20-39 | 7  | 14 | 25  | 38  | 8.75 / 17.5 / 31.25 / 47.5 |
| 40-99 | 15 | 29 | 52  | 79  | 18.75 / 36.25 / 65 / 98.75 |
| 100+  | 32 | 69 | 120 | 176 | 40 / 86.25 / 150 / 220 |

(PAYER rows exist too — priced identically off the payer streak percentiles.)

---

## 2. The pricing math (agreed shape)

Per (segment, payer), daily-reset event:

```
S(x)      = survival over the max_streak_per_day distribution, x-axis scaled by N=1.25
E_day[res]= Σ over milestones k of  S(Cum Streak Req_k) × reward_k[res]     // survival-weighted
NS[res]   = E_day[res] × Σ over the 33×1d Night Sky instances of p_day       // expected active days
```

- `S` built with the shared `survival_()` helper from points `(0,0),(p25·N,.25),(p50·N,.50),
  (p75·N,.75),(p90·N,.90)`, linear tail, capped at 1. Scaling the percentile x-axis by N is exactly
  how `simRainbowMaker` already applies its duration `scale` factor — same pattern, reuse it.
- `Σ p_day` uses `reachSum_` over the calendar's `Night Sky` 1-day instances (weekday vs weekend
  active rate), so if NS ever leaves `cal_new`, the total follows the calendar (removal semantics).
- Boosters priced with the same survival sums.

---

## 3. THE ONE OPEN FORK — how N combines with survival (pick next session)

Decisions §1 say "keep survival" AND "effStreak = max_streak × 1.25 (pass/fail vs cumulative)". Those
are two different shapes; we must choose how they marry. Three concrete options:

**Option A — Scale the survival distribution by N (RECOMMENDED).**
Build `S` from percentile points each × 1.25, then `E_day = Σ_k S(CumReq_k) × reward_k`. Keeps the
survival integral; N shifts the whole streak distribution up 25%, so a larger fraction of the
population clears each milestone. Mirrors `simRainbowMaker` exactly. *Equivalent by algebra to
evaluating unscaled `S(CumReq_k / 1.25)`.*
- Pro: honours "keep survival-weighted"; smooth; one-line change to the existing `simNightSky`.
- Con: N is baked into the reachability curve rather than being a visible pass/fail budget.

**Option B — Single-percentile hard threshold × N (literal Excel).**
Pick ONE percentile (the Excel study had a P25/P50/P75/P90 selector), `effStreak = pXX × 1.25`, pay
**all** milestones with `CumReq ≤ effStreak` (0/1 gate). This is the literal spreadsheet SUMPRODUCT.
- Pro: exactly matches the sheet; N is a visible budget; matches the user's #1 phrasing.
- Con: **drops the survival weighting** the user asked to keep; result jumps as segments cross a
  threshold; needs a percentile selector input on the sheet.

**Option C — Survival for reachability, N as a stated budget cap.**
Survival as Option A, but additionally hard-zero any milestone whose `CumReq > effStreak` at a chosen
percentile (belt-and-suspenders). Probably over-engineered; listed for completeness.

**Recommendation: Option A.** It's the only one that satisfies both "keep survival" and "apply
N=1.25" without adding a percentile selector, and it's a minimal diff. Confirm before building.

> Whichever we pick, it must be applied **identically** in all three sims so the views reconcile.

---

## 4. Per-sim change plan

### 4.0 Shared data plumbing (prerequisite for all three)
`data_streaks` is currently loaded only by the PBP path (`PBPData.streaks`), NOT by the main
`DataStore`. Add it so `simNightSky` can read it in the 33-day + daily views:
- `DataStore.build(...)` — add a `streaksVals` arg; index by `segment|payer_flag` → `{p25,p50,p75,p90}`
  from `max_streak_per_day_p25/50/75/90`. Expose `ds.nsStreak(seg, payer)`.
- `DataStore.get()` — load `vals_(ss,'data_streaks')`; `fromRanges(...)` — add the param (update the
  harness `_mock_run.js` / `_mock_daily.js` / `_dump_mockdata.py` to pass it; `data_streaks` is
  already in `_mockdata.json`).
- Add `data_streaks` to `REFRESH_WATCH` so edits re-trigger recalc.

### 4.1 33-day sim — `EcoGainsSim_v4.gs`
1. **Re-enable NS:** uncomment `'Daily Night Sky Prize': simNightSky` in `SOURCES` (lines 82–84).
2. **Switch streak source + apply N** in `simNightSky` (lines 312–329): replace the
   `ds.beh(seg,payer).daily_max_streak_p*` survival points with `ds.nsStreak(seg,payer)` percentiles,
   each **× 1.25** (Option A). Add p25 to the survival points (currently p50/p75/p90 only).
3. Everything else in `simNightSky` (cum-req ladder read via `readNSLadder_`, `Σ p_day` over
   `Night Sky` instances, booster sums) already matches the agreed math — no change.
4. **Diff semantics:** `data_gains` `Daily Night Sky Prize` is A/B-diluted → it stays the CURRENT
   column, DIFF = simulated − diluted-measured. Label the row in-sheet as "rollout effect (measured
   is A/B-diluted)". (Unchanged from the existing §2.16 spec.)

### 4.2 Daily sim — `EcoGainsSim_Daily.gs`
**No NS-specific code change.** `dailySeries_` takes the NEW total straight from
`resultRow_('Daily Night Sky Prize', …)` — the same dispatch as the 33-day sim — so once §4.1 wires
NS into `SOURCES`, the daily NEW column becomes the simulated total automatically. It is already
allocated ∝ p_day over the 33×1d `Night Sky` instances (`DAILY_PDAY_INST` + the NS branch of
`innerWeights_`). **Verify only:** column sums reconcile with `ECOGAINS_SIM` NS row to ~1e-13.

### 4.3 Play-by-play sim — `EcoGainsSim_PBP.gs`  (biggest change; currently broken)
`pbpNightSky_` (lines 355–361) is wrong and must be rewritten:
```js
// CURRENT (broken): exact-match on Cum Streak Req, seg_beh p50, no N, single milestone.
var night = Math.round(num(beh.daily_max_streak_p50));
ladder.forEach(function(ms){ if (ms.req === night) hit = ms; });   // 0-9: p50=3 vs reqs 2/5/10 → NO MATCH → NS pays 0
```
Rewrite to the agreed model, reconciled with the window sim. PBP is ONE concrete day for ONE player,
so we need a per-night realization, not an expected value. Two consistent options (pick with §3):
- **If Option A/survival (recommended):** the night's effective streak = the player's realized
  `max_streak_per_day` for this session. In **Expected** mode use `p50 × 1.25` from `data_streaks`; in
  **Sampled** mode use the actual longest win-run produced by the play trace (already simulated!) × 1.25.
  Pay **every** milestone with `Cum Streak Req ≤ effStreak` (honest cumulative gate) as its own ledger
  claim on the night it's crossed. This makes PBP the integral realization whose expectation is §4.1.
- **If Option B/threshold:** identical but effStreak = chosen percentile × 1.25.
Also: read streaks from `data_streaks` (already loaded in PBP via `PBPData.streaks`), not
`beh.daily_max_streak_p50`; update the profile note (line 610–611) accordingly. Keep "milestone pays
only on the night it is reached," but pay **all** reached milestones, not one, and never pay an
unreached one.

**Reconciliation check:** averaging Sampled-mode PBP NS HC over many seeds for a (segment,payer) must
approach the 33-day `simNightSky` per-active-day `E_day`. Add this to the PBP harness checks.

---

## 5. Verification (after implementing)
- `python harness/_dump_mockdata.py` (data_streaks already dumped) → `node harness/_mock_run.js`:
  new gate — NS simulated HC per segment (NONPAYER) is nonzero and monotonic in segment; print the
  S=0-beyond-p90 conservative bound alongside (tail is accepted, but show it).
- `node harness/_mock_daily.js`: NS daily column sums reconcile with the 33-day NS row (~1e-13).
- `node harness/_mock_pbp.js`: NS pays all reached milestones and none unreached; 0-9 no longer
  silently zero; Sampled-seed-average ≈ 33-day `E_day`.
- Conservation / zero-formula-error release gates stay green.

## 6. Confirm-before-build checklist (open sub-decisions)
1. **§3 fork** — Option A (recommended), B, or C.
2. If Option B: which percentile is the NS budget (P50? P75?), and does it need a sheet selector?
3. PBP Sampled-mode effStreak — realized longest run from the trace (recommended) vs `p50×1.25`?
4. Confirm N = 1.25 applies to ALL segments/payers uniformly (yes per this round; flagging in case
   payers should differ).
