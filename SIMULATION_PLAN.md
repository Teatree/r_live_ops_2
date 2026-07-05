# ABDB LiveOps Eco Sim — PER-SOURCE SIMULATION PLAN v3 (build-ready)

Verified against `NEW_LIVEOPS_CALENDAR_ECO__4_.xlsx` (46 sheets — `data_RM` now present; Saga re-run
landed in `data_gains`; BB and Flash Race config fixes persist; calendars unchanged), `EcoGainsSim.gs`,
`1__Rainbow_Maker_Sim.xlsx`. All labels, values, diffs below re-read from this file.

---

## 0. DECISIONS LOG (cumulative, current state)

| # | Item | Status |
|---|---|---|
| D1 | Flash Race ≈ 0 measured | ✔ Real (1h event, few winners). Anchor accepted; Level Race anchor stands. |
| D2 | Saga category | ✔ **DONE.** `source_sub1 = 'saga_progression'` added to the Saga branch; re-run landed. Conservation verified: old Core = new Core + new Saga exactly (0-9 NP: 88.16 = 19.88 + 68.28) — the saga HC had been sitting inside **Core** (not 'Other'). Saga HC/earner now: 68.28 / 142.94 / 246.47 / 527.45 / 899.31 (B→F, NONPAYER); A.0 = 0.72. |
| D3 | Target Day | ✔ Pure leaderboard today (milestones intentionally pay 0). Leaderboard path; the ~2× cadence result is correct. |
| D4 | River Rush | ✔ Removed from the new calendar → SIMULATED = 0, DIFF = −measured (always negative; up to −102.6 HC/earner @100+ NP). **Revised per review:** RR keeps a REAL simulator, not a hardcoded zero — it runs the calendar-driven path and outputs 0 *because* `cal_new` contains no RR instances. If RR instances or configs are added later, it re-simulates with no code change (see 2.12 branches). |
| D5 | Config-vs-calendar conflicts | ✔ Fixed in-sheet and re-verified in v4: `BB` 4→3; `Race_v2` Flash = 1d. Zero conflicts. |
| D6 | RM matchables | ✔ `data_RM` sheet present: `segment | payer_flag | avg_matchables_window | p10..p90_matchables_window`, 10 rows, values = matchables per player per ONE 4-day RM window. In-code fallback map deleted. |
| D7 | RM method | ✔ Survival-weighted milestone sum over the full percentile distribution (not p50 step). |
| D8 | 0-9 segment | ✔ **DECIDED (review):** every non-gains "0-9" dataset (behaviour, accrual, matchables) already describes **B. 1-9 players only** — A.0 players are excluded from those queries because they don't meaningfully play. So the simulated `0-9` segment anchors to `data_gains` label **`B. 1-9`** (no merge; `MERGE_0_9` concept dropped). **A. 0 is excluded from the simulation but NOT lost:** it gets its own carried-and-annotated appendix block (§3) so its gains stay accounted for. |
| D9 | Saga display row | ✔ NEW: Saga exists in the data but not in `EcoGainsSim_HC`. Add `'Saga'` to `CATEGORY_ORDER` (between `River Rush` and `Season Pass (Free)`) → 25 category rows per block (8–32; fits the 28-row block spacing with one spare row). `Core` row becomes pure carry; `Saga` row shows the nerf as its own line. |
| D10 | `c_saga_v2` r19 `#REF!` | ✔ Waived by request — excluded from the zero-formula-error gate (that sheet, that row only). |
| D11 | RM `Chest` column | ✔ Visual element only; the reward columns fully describe every milestone. Flag dropped. |
| D12 | Live-config principle | ✔ NEW (review): configs of these or other sources may still change. **Nothing numeric lives in code** — every function reads its config sheet, calendar, and `data_*` sheet at run time, so any config/calendar edit re-simulates automatically on recalc. |
| D13 | Night Sky | ⏸ **ON HOLD (2026-07-02): the bottom-up sim's output was judged wrong — NS is CARRIED again** (= data_gains measured, diff 0). `simNightSky` stays in `EcoGainsSim_v4.gs` but is commented out of the SOURCES registry; §2.16 remains the spec to rework against. Original decision: **SIMULATED, bottom-up** (was carried). NS runs as an A/B test today, so measured `Daily Night Sky Prize` is test-diluted — do NOT model it as a change off the measured anchor (no R×D×T). Instead price the configured ladder for the whole population, per the `1_DAY_NS_TD_5_Segs_V3` method: survival over the daily win-streak distribution × the segment's own ladder × expected active days. SIMULATED = full-rollout value; DIFF = sim − (diluted) measured = the rollout effect. Live config (`NS`==`NS_v2`, sheet "Night Sky (5 Segment)"): per segment, 3 rounds × 1 milestone, `Path`='Final' (no L/R branch), columns `Streak Req | Cum Streak Req | HC Reward` + booster columns. |
| D14 | Segmentation | ✔ NEW: two kinds of segmentation, handled differently. **Config-segmented** (the reward/requirement ladder itself differs per segment): `NS`/`NS_v2` (genuinely different ladders) and `c_saga_v2` (5-segment scheme, values currently identical) — their readers select the segment's own block. **Data-segmented** (one global config; per-(segment,payer) inputs): every source — measured anchors, weekday/weekend rates (T), accrual curves (Kite's D strongly segment-dependent), login-streak percentiles (Daily Gift), daily-max-streak percentiles (NS), matchables percentiles (RM). All other config sheets (`c_day`, `Race`, `Ki/HH/BB/J/Ph/TaD`, `RM`, `RR`, `SP`, `F`) are single-config — verified by scan on v5. |
| D15 | Modularity | ✔ NEW: **one named function per source** in the .gs (`simBombChallenge`, `simKite`, `simNightSky`, …), each a thin, readable module that declares its own inputs (calendar label, accrual key, config sheet) and delegates the math to shared helpers (`leaderboardSim_`, `collectionSim_`, survival CDF, reach). No duplicated math; per-source files read top-to-bottom. |

---

## 1. SHARED MACHINERY

**Measured anchor.** `data_gains`, key `engagement_segment | payer_flag | category | resource` →
`amount_per_earner`. Display→gains segment map (D8): `'0-9'→'B. 1-9'`, `'10-19'→'C. 10-19'`,
`'20-39'→'D. 20-39'`, `'40-99'→'E. 40-99'`, `'100+'→'F. 100+'`; `'A. 0'` reserved for the appendix block
(§3). The query emits only amount>0 rows ⇒ **missing row = legitimate measured 0**. Categories (verified
in v4): `Core`, `Saga`, `Daily Gift`, `Bomb Challenge`, `Chuck Challenge`, `Red Challenge`, `Flash Race`,
`Level Race`, `Kite Festival`, `Hatchling Hideaway`, `Bomb's Ballet`, `Jigsaw`, `Photoshoot`,
`Target Day`, `River Rush`, `Rainbow Maker`, `Daily Night Sky Prize` (simulated bottom-up per D13);
carried: `Ads`, `Other`, `Season Pass (Free)`, `Team Event`, `Team Race`, `FlowerCoop`, `IAPs`,
`Flock Flurry`. Resources (11, fixed order):
HC, Slingshot, Shuffle, Comet, Red, Chuck, Bomb, UL Bomb, UL Chuck, UL Red, Unlimited Lives.

**Behaviour.** `data_seg_beh` (labels `0-9`…`100+` = B.1-9-based per D8, × {NONPAYER, PAYER}):
`weekday_active_rate` / `weekend_active_rate` (fractions), `login_streak_p50/p75/p90` (Daily Gift),
`daily_max_streak_p50/p75/p90` (Night Sky — longest single win-streak within a day).

**Survival function (shared helper).** S(x) = 1 − CDF(x) from a piecewise-linear CDF through the
available percentile points, linear tail beyond the last percentile at the preceding slope, capped at 1.
One implementation, three users: RM (matchables percentiles p10…p90), NS (daily-max-streak p50/p75/p90),
Daily Gift weights (login-streak p50/p75/p90).

**Daily events.** Sources that run every day (Night Sky 33×1d; Flock Flurry 18×1d, carried) are NOT
priced with modal-duration/T machinery. For a bottom-up daily source the window total is
`per-active-day expected value × Σ over the calendar's 1-day instances of p_day` — the instance list
still comes from the calendar, so if NS's presence ever changes in `cal_new`, the sim follows.

**Reach.** `reach(inst) = 1 − Π_days (1 − p_day)`; weekend = `(day−1)%7 ∈ {2,3,4}` (Fri/Sat/Sun; both
calendars start Wednesday — verified). `T = Σ_new reach / Σ_cur reach` over the instance sets below.

**Duration multiplier.** `D = share(newDur)/share(curDur)` from `cum_token_share_p50`
(`data_event_accrual`; Kite from `data_event_kite_accrual`), keyed event|payer|segment with `0-9`
fallback; modal durations. Rewrite fix: normalise at **curDur** (not the curve's max day — benign today
since share(curDur)=1.0 in every live case, wrong in general). Lengthening past observed range:
marginal-slope extrapolation capped at proportional, flagged (currently moot — only day-1-saturating
curves lengthen, D=1 there anyway).

**How the calendar drives cadence and duration (the pipeline, explicit).** The calendar sheets are the
single source of truth for WHEN and HOW LONG every event runs; nothing about scheduling comes from
configs. Per calendar (`cal_curr`, `cal_new`), the merge reader turns the grid B5:AH25 into a list of
instances, each carrying `{event label, start day, duration, exact day list}` — one instance per merged
range, one 1-day instance per standalone filled cell, adjacent same-event cells never collapsed. From
that list, per source and per (segment, payer):

1. **Cadence** = the instance list itself. Each instance contributes its own
   `reach = 1 − Π_days(1 − p_day)`, where each day in the instance is priced by its calendar position —
   weekend rate for Fri/Sat/Sun columns, weekday rate otherwise. So an instance's contribution rises with
   its duration (more days → more chance to participate) and with its weekend placement. Cadence is NOT a
   naive instance count: `T = Σ_new reach / Σ_cur reach` weighs every instance by duration and placement.
   That is why Flash Race moves (T=0.991) despite 15 instances on both sides — the slots shifted from a
   weekday/weekend mix to pure weekend — and why Red (3×2d) grows while Chuck (5×1d → 2×2d) shrinks.
2. **Duration** = the modal instance length of each calendar's list (7 for current Kite, 3 for new; 4→3
   for BB; etc.). curDur→newDur feeds `D = share(newDur)/share(curDur)` on the accrual curve, capturing
   how much of the eventual per-participant reward fits into the shorter/longer run. Clipped instances
   (e.g. HH's 2-day at the window edge) keep their REAL day list in the reach sum but do not distort the
   modal duration used for D.
3. Per-instance duration is also used directly where a source is priced bottom-up instead of anchored:
   Rainbow Maker evaluates each instance with the matchables distribution for ITS duration (4-day vs the
   clipped 2-day) and multiplies by that instance's own reach.

Net effect: an event's simulated total responds to all three calendar levers independently — how many
times it runs, how long each run is, and which days of the week each run occupies. Editing a merge in
either calendar re-parses on recalc (D12) and moves T, D, and RM's per-instance sums accordingly.

**Reward ratio R** (base-vs-`_v2` cell-diff on v4):

| Pair | Diff | R |
|---|---|---|
| `c_saga`→`c_saga_v2` | per-cycle HC 210→75 per 100 levels, all 5 segment columns identical | R_HC(Saga) = **0.357** |
| `c_day`→`c_day_v2` | d1 22→12, d4 27→17, d6 33→23; d7 stays 100 (Σ182→152) | streak-weighted per segment |
| `Race`→`Race_v2` | EventDuration 1→2 in r6 Red / r24 Chuck / r42 Bomb / r60 Level; Flash r78 = 1 | R = 1 |
| `Ki_v2` 7→3; `HH_v2` 3→4; `BB_v2` 4→3; `J_v2` 4→3; `Ph_v2` 4→3; `TaD_v2` 7→1 | duration only | R = 1 |
| `RR_v2`==`RR`; `NS_v2`==`NS`; `F_v2`==`F` | identical | carried / 2.12 |

**Calendar instance sets** (merge rule verified: merged range = one instance; filled unmerged cell = one
1-day instance; neighbours never collapsed; aliases `Mystery Puzzle`→`Jigsaw Puzzle`,
`Chuck's Flash Race`→`Flash Race`; day = column − 1):

| Label (exact) | cal_curr | cal_new |
|---|---|---|
| `Bomb's Challenge` | 4×1d @4,13,20,27 | 2×2d @13,15 |
| `Chuck's Challenge` | 5×1d @2,9,16,23,30 | 2×2d @6,8 |
| `Red's Challenge` | 4×1d @5,14,21,28 | 3×2d @1,27,29 |
| `Flash Race` | 15×1d @1,3,5,…,33 (alternating; 10we/5wd) | 15×1d @ weekend clusters (all we) |
| `Level Race` | 4×1d @4,13,20,27 | 2×2d @20,22 |
| `Kite Festival` | 2×7d @3,17 + 1×3d @31 — modal 7 | 5×3d @3,10,17,24,31 |
| `Hatchling Hideaway` | 4×3d + 1×2d @32 — modal 3 | 4×4d + 1×2d @1,6,13,20,27 — modal 4 |
| `Jigsaw Puzzle` | 2×4d + 1×3d — modal 4 | 3×3d @3,17,31 |
| `Photoshoot` | 1×4d @7 | 1×3d @24 |
| `Bomb's Ballet Show` | 1×4d @21 | 1×3d @10 |
| `Target Day` | 2×7d + 1×2d — modal 7 | 15×1d (Flash Race slots) |
| `Rainbow Maker` | — | 4×4d + 1×2d @1,6,13,20,27 |
| `River Rush` | — (runs off-grid today; measured>0) | — (removed) |
| `Night Sky` | 33×1d | 33×1d — SIMULATED bottom-up per 2.16 (instances feed Σ p_day) |
| Flock 18×1d, Team/SP/offers | unchanged | carried |

**Accrual curves** (`0-9|NONPAYER` p50): Bomb/Chuck/Red/Flash/Flock/Target Day: share(1)=share(2)=1.00.
HH 0.18/0.71/**1.00**/1.00 (4d observed → 3→4 is interpolation, D=1). Bombs Ballet …0.94(3)/1.00(4).
Jigsaw …0.86(3)/1.00(4). Photoshoot …0.91(3)/1.00(4). River Rush 8d (idle unless RR returns to the
calendars). Kite: day3 0.315 (0-9 NP) … 0.704 (100+ NP); share(7)=1.0. **No curve for Level Race** (D=1
accepted — rank rewards). Accrual event names: `Bomb`,`Chuck`,`Red`,`Flash Race`,`Flock Flurry`,
`Hatchling Hideaway`,`Jigsaw`,`Photoshoot`,`Bombs Ballet` (no apostrophe),`Target Day`,`River Rush`;
kite sheet: `Kite Festival`.

Worked numbers below = `0-9|NONPAYER` (pWd 0.3292, pWe 0.3207); engine computes per (segment, payer),
reading everything live per D12.

---

## 2. PER-SOURCE SPECS

### 2.1 Core – Saga  [always-on; two display rows per D9]
1. **Type:** always-on progression; reward-ratio-only. Now TWO rows: `Core` (pure carry) and `Saga`
   (the nerf line).
2. **Inputs:** measured `Core` and `Saga` rows; `c_saga` rows 4–13 cols B/C (210 HC/100 lv) vs
   `c_saga_v2` rows 5–14 per-segment pairs (`0-9`→B/C … `100+`→J/K; 75/100 in all five). Read live
   (D12) — if the v2 ladder is edited, R recomputes.
3. **R:** R_HC(Saga) = Σv2/Σbase per segment (today 75/210 = **0.357** for all). Non-HC Saga resources
   carried. Core: R = 1 (nothing in `chapter_complete`/`PlayerLevelUpChest` changed).
4. **D:** 1. 5. **T:** 1.
6. **Formulas:** `Core_sim[res] = Core_meas[res]`; `Saga_sim[res] = Saga_meas[res] × (res=='HC' ? R_HC : 1)`.
   Headline diffs (NONPAYER, HC/earner): −43.9 / −91.9 / −158.5 / −339.2 / **−578.3** (0-9→100+) — the
   single largest negative line in the redesign, ahead of River Rush removal.
7. **Zero-handling:** Saga HC measured at every segment (68.28→899.31) and Core at every segment
   (19.88→416.61 NP) → a 0 in either row = stale-data/label bug. A.0's Saga (0.72) lives in the §3 block.
8. **Flags:** none remaining (D2 done; conservation verified; `#REF!` r19 waived per D10).
9. **Confidence:** HIGH.

### 2.2 Bomb Challenge  [leaderboard]
1. **Type:** top-10 rank ladder (200/100/50 HC + one booster per position, `Race` r39–55).
2. **Inputs:** measured `Bomb Challenge`; cal `Bomb's Challenge` 4×1d @4,13,20,27 → 2×2d @13,15;
   `Race_v2` r42 duration only.
3. **R:** 1. 4. **D:** 1 — rank payout is end-state; token curve saturates day 1 regardless.
5. **T:** Σ_cur = 0.3207+3×0.3292 = 1.308; Σ_new = 2×(1−0.6708²) = 1.100 → **T ≈ 0.84**.
6. **Formula:** `sim = meas × T`.
7. **Zero:** HC measured everywhere (1.42 A.0 → 65.85 F NP); 0 = bug; missing booster rows legit.
8. **Flags:** per-instance rank payout assumed duration-invariant. 9. **Confidence:** HIGH.

### 2.3 Bomb's Ballet  [collection]
1. **Type:** token-priced 15-level track + completion (HC at L5=25, L10=25, completion=50).
2. **Inputs:** measured `Bomb's Ballet`; cal `Bomb's Ballet Show` 1×4d@21 → 1×3d@10; accrual
   `Bombs Ballet`; `BB` 4 → `BB_v2` 3 (fixed, agrees with calendar).
3. **R:** 1. 4. **D:** share(3)/share(4) = **0.942** (0-9 NP), interpolation.
5. **T:** reach(3d @10–12, all we)/reach(4d @21–24) ≈ 0.687/0.799 = **0.86**.
6. **Formula:** `meas × D × T`. 7. **Zero:** HC everywhere (0.079 A.0→); 0 = bug.
8. **Flags:** none. 9. **Confidence:** HIGH.

### 2.4 Chuck Challenge  [leaderboard]
As 2.2. Cal `Chuck's Challenge` 5×1d (all weekdays; Σ1.646) → 2×2d @6,8 (Σ1.100): **T ≈ 0.67** — the
biggest challenge cadence loss. `Race` r21–37 ("Chunk's" sheet-label typo is cosmetic; keys are the
calendar label + accrual `Chuck`). Confidence HIGH.

### 2.5 Daily Gift  [always-on; reward-ratio only]
1. **Type:** streak-gated 7-day ladder.
2. **Inputs:** measured `Daily Gift`; `c_day` col B r4–10 [22,0,0,27,0,33,100] vs `c_day_v2`
   [12,0,0,17,0,23,100]; `login_streak_p50/p75/p90` per (segment, payer).
3. **R:** R_HC = Σ(wₙ·v2ₙ)/Σ(wₙ·baseₙ), wₙ = P(streak ≥ n) from the piecewise 3-point CDF. Worked
   (0-9 NP: percentiles 2/7/19 → weights [1,.75,.5,.45,.4,.35,.3]): **0.762** vs naive 0.835 — day-7's
   untouched 100 shields long streaks; low-streak segments eat the nerf. Non-HC carried.
4. **D:** 1. 5. **T:** 1.
6. **Formula:** `sim = meas; sim.HC ×= R_HC`.
7. **Zero:** biggest low-segment HC line (135.97 NP / 179.36 P @0-9); 0 = bug — the canary row.
8. **Flags:** 3-point CDF is crude (accepted). 9. **Confidence:** HIGH.

### 2.6 Hatchling Hideaway  [collection]
1. **Type:** 5 token gates (HC at gates 2/4/5 = 10/15/40).
2. **Inputs:** measured `Hatchling Hideaway`; cal 4×3d+1×2d → 4×4d+1×2d; accrual `Hatchling Hideaway`;
   `HH_v2` 3→4.
3. **R:** 1. 4. **D = 1.0** — share(3)=1.00 on the observed 4-day curve (median finishes by day 3);
   interpolation, not extrapolation.
5. **T:** ≈ (4×0.796+0.55)/(4×0.691+0.539) = **1.13** — all HH movement is reach.
6. **Formula:** `meas × T`. 7. **Zero:** HC everywhere (0.508 A.0→); 0 = bug.
8. **Flags:** if design expects day 4 to add track restarts/extra gates, the token-share curve can't see
   it. 9. **Confidence:** HIGH.

### 2.7 Jigsaw  [collection]
1. **Type:** 12 cumulative-token milestones (HC at m5/m9 = 25/25).
2. **Inputs:** measured `Jigsaw`; cal `Jigsaw Puzzle` (fold alias `Mystery Puzzle` BEFORE lookup;
   verified 3×3d only after aliasing) 2×4d+1×3d → 3×3d @3,17,31; accrual `Jigsaw`; `J_v2` 4→3.
3. **R:** 1. 4. **D = share(3)/share(4) = 0.856** (0-9 NP).
5. **T:** Σreach(3×3d)/Σ[2×reach(4d)+reach(3d)].
6. **Formula:** `meas × D × T`. 7. **Zero:** HC everywhere (0.374 A.0→); 0 = bug.
8. **Flags:** alias handling only. 9. **Confidence:** HIGH.

### 2.8 Kite Festival  [score event, league LB]
1. **Type:** streak-step scoring; HC in LB positions 1–5 (300/200/150/125/100), SPT to p25; one
   milestone @100 = 30min UL.
2. **Inputs:** measured `Kite Festival`; cal 2×7d+1×3d → 5×3d; KITE curve (`data_event_kite_accrual`,
   event_name `Kite Festival`); `Ki_v2` 7→3.
3. **R:** 1. 4. **D = share(3)/share(7): 0.315 (0-9 NP) … 0.704 (100+ NP)** — segment-dependence is the
   point (whales bank score early); interpolation.
5. **T:** cur 0.937+0.937+0.687 = 2.559; new 5×0.687 = 3.433 → **1.34** (≈1.24 @100+).
6. **Formula:** `meas × D × T` → net 0.42× @0-9, 0.87× @100+. Doubles as the calendar-reader sanity
   check: if Kite stops shrinking, `getMergedRanges` failed in the custom-function context.
7. **Zero:** HC at all 12 (seg,payer) pairs (0.21→38.05); 0 anywhere = bug.
8. **Flags:** score-share D applied to rank payouts assumes rank tracks relative score within a league —
   accepted. 9. **Confidence:** HIGH.

### 2.9 Level Race  [leaderboard]
1. **Type:** top-10 ladder identical to challenges (`Race` r57–73 "Level Challenge").
2. **Inputs:** measured `Level Race`; cal 4×1d @4,13,20,27 → 2×2d @20,22; `Race_v2` r60 duration only;
   no accrual curve.
3. **R:** 1. 4. **D:** 1 (no curve; also the right model for rank rewards — revisit only if durations
   get priced). 5. **T:** 1.100/1.308 = **0.84**.
6. **Formula:** `meas × T`. 7. **Zero:** HC 1.50 (A.0) → 89.96 (E NP) — biggest event coin line; 0 = bug.
8. **Flags:** anchor accepted per D1. 9. **Confidence:** HIGH.

### 2.10 Photoshoot  [collection]
1. **Type:** 30 token-priced items + endless lanes (HC sparse: items 9, 21 pay 25).
2. **Inputs:** measured `Photoshoot`; cal 1×4d@7 → 1×3d@24; accrual `Photoshoot`; `Ph_v2` 4→3.
3. **R:** 1. 4. **D = 0.905** (0-9 NP). 5. **T:** ≈ 0.687/0.799 = **0.86** — single-instance ratio,
   placement-sensitive by construction.
6. **Formula:** `meas × D × T`. 7. **Zero:** HC small but everywhere (0.063 A.0); 0 = bug.
8. **Flags:** n=1 both sides → T noisy. 9. **Confidence:** HIGH method / MEDIUM T stability.

### 2.11 Red Challenge  [leaderboard]
As 2.2. Cal `Red's Challenge` 4×1d @5,14,21,28 (Σ1.308) → **3**×2d @1,27,29 (Σ1.650): **T ≈ 1.26** —
the one challenge that grows. `Race_v2` r6 duration only. Confidence HIGH.

### 2.12 River Rush  [removed from cal_new; live simulator kept per D4/D12]
1. **Type:** collection/race hybrid (15 rounds, 5-player groups; `RR` config; 8-day accrual curve on
   file; `RR_v2`==`RR`).
2. **Method — calendar-driven branches, evaluated live:**
   (a) `cal_new` has 0 RR instances (**current state**) → `sim = 0` for all 11 resources.
       DIFF = 0 − measured = **always negative**: −0.11 (A.0, §3 block) / −2.76 / −16.0 / −36.2 / −67.5 /
       **−102.6** HC/earner (0-9→100+ NP) — exactly the "gains players were getting before, turned to 0"
       requirement.
   (b) RR instances exist in BOTH calendars → generic collection path `meas × D × T` with the existing
       8-day curve (nothing else to build).
   (c) RR instances in `cal_new` only (no cur anchor set) → carry measured × reach-scaled heuristic is
       NOT attempted; the row flags `NEEDS-ANCHOR` and carries measured, loudly — a cur-side reference
       is required before that configuration can be priced.
3. **Zero-handling:** SIMULATED = 0 is the spec under (a); a 0 in the CURRENT/measured column would be
   the bug. 4. **Confidence:** HIGH.

### 2.13 Target Day  [leaderboard — D3]
1. **Type:** milestones intentionally pay 0; rewards on the top-10 LB (200/100/50 HC + boosters).
2. **Inputs:** measured `Target Day`; cal 2×7d+1×2d → 15×1d (weekend clusters); `TaD_v2` 7→1.
3. **R:** 1. 4. **D:** 1 (rank-invariance; the saturating token curve is irrelevant now).
5. **T:** cur ≈ 0.937+0.937+0.539 = 2.412; new = 15×0.3207 = 4.811 → **T ≈ 1.99** — the ~2× is correct.
6. **Formula:** `meas × T`. 7. **Zero:** HC at all segments (0.31→13.66); 0 = bug.
8. **Flags:** in-sheet note only — 15 one-day boards = 15 top-3 chances vs 3 long boards;
   rank-invariance is weakest here but identical to the assumption already accepted for the challenges.
9. **Confidence:** MEDIUM-HIGH.

### 2.14 Flash Race  [leaderboard — anchor ≈0 per D1]
1. **Type:** 1h leaderboard; measured ≈0 everywhere is real.
2. **Inputs:** measured `Flash Race` (trace UL only); cal 15×1d both sides, slots move weekday→weekend;
   `Race_v2` r78 = 1 (fixed).
3. **R:** 1. 4. **D:** 1. 5. **T:** 15×0.3207 / (10×0.3207+5×0.3292) = **0.991 ≈ 1**.
6. **Formula:** `meas × T ≈ meas ≈ 0`.
7. **Zero:** ≈0 output is the correct answer — the one source where a zero row is expected and right.
8. **Flags:** none. 9. **Confidence:** HIGH.

### 2.15 Rainbow Maker  [new-additive; survival-weighted milestone sum — D6/D7]
1. **Ladder:** `RM` sheet, header r15 (`Milestone | Matchables Req | Req Accum | Chest | Coins | SPT |
   SPT x2 | Red | Chuck | Bomb | Slingshot | Shuffle | Comet`); 30 milestones, ReqAccum 160→352,260; HC
   at m2/9/12/18/24/27/30 = 10/20/35/50/100/250/1000. `Chest` = visual only (D11). No UL columns → UL
   resources structurally 0.
2. **Matchables:** `data_RM` (D6) — per (segment, payer): avg + p10/p25/p50/p75/p90 of matchables in one
   4-day window.
3. **Survival function:** per (segment, payer), piecewise-linear CDF through
   (0,0),(p10,.10),(p25,.25),(p50,.50),(p75,.75),(p90,.90); linear tail beyond p90 at the p75→p90 slope,
   capped at 1; S(x) = 1 − CDF(x).
4. **Per-instance expected reward:** `E_4d[res] = Σₖ S(ReqAccumₖ) × rewardₖ[res]`. The clipped 2-day
   instance uses the distribution scaled ×0.5 on the matchables axis (percentiles halved) — flagged
   linear-scaling assumption.
5. **Window total:** `RM[res] = Σ_instances E_dur(inst)[res] × reach(inst)`; instances = `cal_new`
   4×4d + 1×2d; Σreach ≈ 3.7 (0-9 NP).
6. **Anchor/diff:** measured `Rainbow Maker` rows are soft-launch traces (cat totals 15–45) — left in
   the diff, immaterial; diff ≈ full addition.
7. **Sanity:** the old p50-step reproduced +37 HC @0-9 NP and +333 @100+ NP from this exact data; the
   survival method lifts 0-9 NP to ≈ **+68 HC** (per-instance 10×S(460)≈9.4 + 20×S(8,610)≈6.3 +
   35×S(18,410)≈2.7 ≈ 18.4, × Σreach 3.7) — the right tail the median hides.
8. **Zero-handling:** m2 (10 HC) needs 460 matchables; even p10 clears it at every segment → RM HC = 0
   for any simulated segment = lookup/ladder-read bug, never economics. UL columns = structural 0.
9. **Flags & confidence:** TAIL SENSITIVITY — milestones past p90 are priced purely by extrapolation;
   m30 (1000 HC, ReqAccum 352,260) sits just past p90 for 100+ NP (343,988) → ≈ 87 HC/instance from the
   tail alone; conservative bound (S=0 beyond p90) shown alongside at validation. 2-day ×0.5 scaling is
   linear over a nonlinear curve. Confidence MEDIUM-HIGH.

### 2.16 Night Sky  [daily streak event; bottom-up per D13 — A/B test, no measured anchor]
1. **Type:** daily-reset win-streak ladder, config-segmented (D14). Live config `NS` (== `NS_v2`),
   "Night Sky (5 Segment)": per engagement segment 3 rounds × 1 milestone, `Path`='Final', with
   `Cum Streak Req` and `HC Reward` + booster columns (Red/Chuck/Bomb/Slingshot/Shuffle…; SPT out of
   the 11-resource scope). Ladders per segment (CumReq → HC): 0-9: 2→0, 5→10, 10→15;
   10-19: 6→10, 13→30, 26→60; 20-39: 11→15, 26→50, 42→100; 40-99: 28→50, 60→120, 100→250;
   100+: 80→100, 175→300, 280→400.
2. **Inputs:** the segment's OWN ladder block from `NS`; `daily_max_streak_p50/p75/p90` from
   `data_seg_beh`; the `Night Sky` 33×1d instance list from `cal_new` (and `cal_curr` — identical).
   Measured `Daily Night Sky Prize` (A/B-diluted: 9.15 / 23.20 / 40.19 / 72.09 / 62.66 HC/earner NP)
   is the CURRENT column only — never an anchor.
3. **Method (per D13, mirrors `1_DAY_NS_TD_5_Segs_V3` upgraded to survival):**
   `E_day[res] = Σₖ S(CumStreakReqₖ) × rewardₖ[res]` with S from the daily-max-streak percentiles;
   `NS[res] = E_day[res] × Σ_days p_day` over the calendar's 1-day instances (18 wd + 15 we in the
   33-day window). One ladder clear per active day max (daily reset), no L/R branching in live config.
4. **Worked (NONPAYER):** 0-9: S(5)=.25, S(10)≈.06 → E_day ≈ 3.4 HC; Σp ≈ 9.3 → ≈ **+32 HC**/window
   (vs 9.15 measured → diff ≈ +23). 100+: S(80)≈.45, S(175)≈.10, S(280)=0 → E_day ≈ 76 HC; Σp ≈ 6.9 →
   ≈ **+524 HC**/window (vs 62.66 → diff ≈ +461) — full rollout is a very large whale-side HC injection.
5. **Streak-axis choice:** milestone k gated on `Cum Streak Req` vs the daily MAX streak — conservative
   (treats the ladder as one unbroken run within a day; matches the sequential `ns_calc` layout in the
   reference workbook). The optimistic alternative (per-milestone `Streak Req`, streaks chain across
   claims) is a one-line switch; decide at validation against A/B-arm telemetry if available.
6. **Zero-handling:** measured NS > 0 at every segment (it IS live for the test arm) — a 0 in the
   CURRENT column = data bug. SIMULATED 0 for a low segment is possible economics ONLY at 0-9 m1
   (0 HC milestone); any all-zero simulated NS row = ladder-read bug.
7. **Flags:** (a) diff mixes "rollout effect" with "A/B dilution of measured" — label the row in-sheet;
   (b) S(x) tail beyond p90 drives the 100+ number (same tail sensitivity as RM — print the
   S=0-beyond-p90 conservative bound next to it); (c) one-clear-per-day assumption; (d) booster columns
   priced with the same survival sums. 9. **Confidence:** MEDIUM (method HIGH, magnitude tail-sensitive).

---

## 3. A. 0 APPENDIX BLOCK (accounted for, not simulated — D8)

A sixth display block (below the `100+` block, same 25-row layout, tagged `A. 0`) so A.0 gains are never
silently dropped. Treatment per source, chosen so every applied change needs NO behaviour data or is
config-only:
- **Saga:** HC × 0.357 (config-only ratio; measured 0.72/earner NP → −0.46).
- **Daily Gift:** HC × R using the 0-9 (B.1-9) streak weights as PROXY (no A.0 row in `data_seg_beh`),
  flagged: true A.0 streaks are shorter, so the true ratio is ≤ proxy — the block slightly overstates
  their remaining gains. Material: Daily Gift is 94.9 of A.0's ≈137 total HC/earner.
- **River Rush:** 0 (removal is universal; −0.11).
- **Rainbow Maker:** not applied (no A.0 matchables data; participation negligible) — flagged
  understatement.
- **Every timed event + carried category:** SIMULATED = measured, unchanged (no A.0 behaviour/accrual
  exists; their event gains are small: Bomb 1.42, Red 1.32, Chuck 1.21, Level 1.50, Kite 0.49, HH 0.51,
  TaD 0.31, Jigsaw 0.37, BB 0.079, Photoshoot 0.063).
The block header carries the annotation: "A. 0 excluded from simulation (no behavioural data — these
players don't meaningfully play); gains carried; config-only changes applied."

---

## 4. CODE STRUCTURE

**One named function per source (D15)** — `SOURCES` registry dispatches (unlisted → carried). Each
function is its own readable module: it declares its inputs (calendar label, accrual key, config sheet)
and calls shared helpers for the math — no duplicated formulas, no numeric constants in code (D12; the
RM matchables map is deleted; nothing replaces it in code).
- `simCore` (carry), `simSaga` (R_HC from live c_saga/c_saga_v2), `simDailyGift` (R from live c_day pair
  + streak weights).
- `simBombChallenge` / `simChuckChallenge` / `simRedChallenge` / `simLevelRace` / `simFlashRace` /
  `simTargetDay` — each wraps `leaderboardSim_(cat, calLabel)`: `meas × T`, D pinned 1 with comment.
- `simHatchlingHideaway` / `simBombsBallet` / `simJigsaw` / `simPhotoshoot` — each wraps
  `collectionSim_(cat, calLabel, accrKey)`: `meas × D × T`, token curve, D normalised at curDur.
- `simKiteFestival` — `meas × D × T` with the kite score curve.
- `simNightSky` — bottom-up per 2.16: segment ladder from `NS` × survival(daily-max-streak) ×
  Σ p_day over the calendar's 1-day instances. NOT anchored to measured (A/B test, D13).
- `simRainbowMaker` — survival-weighted sum from `RM` + `data_RM` + cal_new instances.
- `simRiverRush` — the 2.12 branch logic (currently → 0 because cal_new has no instances).
- **Display changes (D9 + D8):** `CATEGORY_ORDER` gains `'Saga'` (25 rows, 8–32 per block; block anchors
  B6/B34/B62/B90/B118 unchanged); new `A. 0` appendix block appended below with its own spill call.
Shared: `measuredRow_` ('0-9'→'B. 1-9' direct map), `timingRatio_`/`reachSum_`, `accrualShare_`
(curDur normalisation), config readers, `parseCalendarInstances_` (verified, untouched),
`Context`/`DataStore.fromRanges` for the offline harness. Fallback if live install shows Kite not
shrinking: menu-precompute writes parsed instances to a hidden `cal_parsed` sheet; custom functions read
values. Assumption flags = static legend block on `EcoGainsSim_HC`.

---

## 5. RELEASE GATES

> **VALIDATION RESULTS (2026-07-02, `EcoGainsSim_v4.gs` offline vs workbook v5 data):** all gates pass
> with live-data values (plan estimates used slightly older rates): Bomb T=0.86, Chuck 0.69, Red 1.30,
> Level 0.86, Flash 0.99, TaD 1.81, HH 1.16 (D=1.00), Kite D=0.34 @0-9 / **0.57 @100+** (the plan's
> 0.704 was stale — `data_event_kite_accrual` p50 day-3 for 100+ NP is 0.5694), BB D=0.94, Jigsaw 0.86,
> Photoshoot 0.91, saga ratio 0.357, Daily Gift R=0.74 @0-9 NP, conservation exact (19.88+68.28=88.16).
> Headline sims (NONPAYER HC/earner): Saga diff −43.9 → −578.1; NS +32 @0-9 (bound 23.3) / +524 @100+
> (bound = same, ladder inside p90-tail cap); RM +59.7 @0-9 (bound 51.9) / +789 @100+ (bound 582 —
> tail-sensitive as flagged); RR diff = −measured everywhere (−2.76 → −102.6); A. 0 appendix: Saga
> −0.46, Daily Gift −24.9 (proxy), RR −0.11, all else carried. Precompute path (`cal_parsed`) verified
> bit-identical to live merge parsing with merges disabled.

1. Offline end-to-end on v5 data reproduces: Bomb T≈0.84, Chuck ≈0.67, Red ≈1.26, Level ≈0.84, Kite
   D 0.315 / net 0.42× @0-9 NP, TaD T≈1.99, Flash ≈0, HH T≈1.13, BB D≈0.94, Jigsaw D≈0.856,
   Photoshoot D≈0.905, Saga diff −43.9 @0-9 NP / −578.3 @100+ NP, RR diff = −measured everywhere,
   RM ≈ +68 HC @0-9 NP, NS ≈ +32 HC @0-9 NP / ≈ +524 @100+ NP (RM and NS both printed with their
   S=0-beyond-p90 conservative bounds alongside).
2. Conservation check: for every (segment, payer), new Core + new Saga measured = old Core measured
   (already verified on v4 for 0-9 NP: 19.88 + 68.28 = 88.16).
3. Zero formula errors on all shipped sheets, `c_saga_v2` r19 waived (D10).
4. §4B live-state checklist: segment tags exactly `0-9|10-19|20-39|40-99|100+|A. 0`, payer cell `C3`,
   `data_*` headers row 1, fresh exports.
5. Layout check after adding the Saga row + A.0 block: 25 category rows per block, no overlap with the
   next block anchor.
