# ABDB Economy Simulation — Methodology Reference

**Audience:** an LLM (or human) continuing this work. This explains HOW every source is simulated,
how the calendar drives cadence and duration, how segmentation flows through everything, and the
conceptual differences between leaderboard, streak, and milestone event simulation. It reflects the
code as shipped in `EcoGainsSim_v4.gs` / `EcoGainsSim_Daily.gs` / `SimPerSegmentFill.gs` against
workbook `NEW_LIVEOPS_CALENDAR_ECO (5).xlsx`.

**Reading order for a new session:** `HAND_OFF.md` (project history) → `SIMULATION_PLAN.md`
(per-source specs + decisions log D1–D15) → this document (method) → `source_docs/` (per-source
game mechanics) → the code. `CLAUDE.md` holds workspace conventions.

---

## 1. The core idea: anchor on telemetry, simulate only what changed

The simulation compares two 33-day LiveOps calendars — `cal_curr` (what runs today) and `cal_new`
(the redesign) — per **engagement segment × payer flag × source category × resource**. The output
unit is **per-earner gains over the 33-day window** ("what a player who earned this resource from
this source got, on average").

The central equation for anchored sources:

```
SIMULATED[res] = measured[res] × R[res] × D × T
```

- **measured** — telemetry from `data_gains` (`amount_per_earner`). This is the ground truth for
  the CURRENT calendar. Anchoring means we never price a live event's rewards bottom-up from
  config when telemetry exists; we only *scale* reality by what changed. This automatically
  absorbs mechanics we can't model (matchmaking, rank distributions, Hatchling Hideaway's endless
  gate, loop grinding) because they're inside the measured number.
- **R — reward ratio** (config change): `v2 ladder / base ladder`, per resource, computed live
  from the config sheet pairs. **Since 2026-07-06 R is wired for EVERY simulated source**, not
  just Saga/Daily Gift: leaderboards price the rank ladder at the measured `position_p25/50/75`
  (`data_event_inst`), collections price the milestone ladder at survival over
  `final_balance_p25/50/75` — so editing rewards AND requirements on any `_v2` sheet moves the
  sim (see §7.1/§7.4 and `rewardR_` in the engine). R = 1 exactly while `_v2` rewards are
  untouched (verified by harness gate). E_base = 0 with E_v2 > 0 → carried (no anchor — this is
  why NEW milestone rewards on TaD_v2 don't flow; that rework needs a bottom-up score model).
- **D — duration multiplier** (instance length change): from accrual curves, §5.
- **T — cadence × reach ratio** (scheduling change): from the calendars, §4.

Three departures from anchoring:
- **Carried sources** (nothing changed / no schedule): SIMULATED = measured, DIFF = 0.
- **Bottom-up sources** (no valid anchor): Rainbow Maker (new event, measured ≈ 0) is priced from
  its config ladder × a population distribution. Night Sky is priced the same way (measured is
  A/B-diluted, so its DIFF row = the ROLLOUT EFFECT, not a redesign delta) — re-wired 2026-07-06
  per `NIGHT_SKY_REWIRE_PLAN.md` (§7.2).
- **Removal**: a simulated event with zero `cal_new` instances gets SIMULATED = 0 (River Rush).

**DIFF = SIMULATED − measured** is the deliverable: the real per-earner movement caused by the
redesign. Cadence differences are *supposed* to show up there.

---

## 2. Data inputs (all read LIVE at recalc — decision D12: no numbers in code)

| Sheet | Key | Used for |
|---|---|---|
| `data_gains` | `engagement_segment \| payer_flag \| category \| resource` → `amount_per_earner` | the measured anchor. Segments are RAW labels `A. 0`, `B. 1-9` … `F. 100+`. The query emits only amount>0 rows ⇒ **a missing row is a legitimate measured 0.** |
| `data_seg_beh` | `segment \| payer_flag` (merged labels `0-9`…`100+`) | `weekday_active_rate`/`weekend_active_rate` (reach), `login_streak_p50/75/90` (Daily Gift). (`daily_max_streak_p*` still present but no longer used — NS moved to `data_streaks`.) |
| `data_event_accrual` | `event_name \| payer_flag \| segment \| event_day` → `cum_token_share_p50` | duration curves (D) for collections/challenges |
| `data_event_kite_accrual` | same shape | Kite's score-based curve (score events need their own accrual path) |
| `data_RM` | `segment \| payer_flag` → `p10/p25/p50/p75/p90_matchables_window` | Rainbow Maker matchables distribution (per ONE 4-day window) |
| `data_streaks` | `segment \| payer_flag` → `max_streak_per_day_p25/p50/p75/p90` | Night Sky streak distribution (clean, un-A/B-diluted; `ds.nsStreak`). Also the PBP sim's behaviour source. |
| `data_event_inst` | `event_name \| segment \| payer_flag` → `position_p25/50/75`, `final_balance_p25/50/75` | the R-term's player distribution (`ds.eventInst`): rank quantiles for leaderboard R, progress survival for collection R. Also the PBP sim's placement/progress source. |
| `cal_curr` / `cal_new` | visual grids | instances (§4) |
| config pairs `c_saga(_v2)`, `c_day(_v2)`, `Race(_v2)`, `Ki/HH/BB/J/Ph/TaD(_v2)`, `RM`, `NS` | | R ratios, ladders, durations |

**Segment label mapping (decision D8).** The display segments are `0-9, 10-19, 20-39, 40-99,
100+`. `SEG_TO_GAINS` maps `'0-9' → 'B. 1-9'` (NOT a merge of A.0∪B.1-9): every non-gains "0-9"
dataset already describes B.1-9 players only, because A.0 players barely play and are excluded
from behaviour queries. **A. 0 is not simulated but not dropped**: `ECOGAINS_SIM(payer, 'A. 0')`
returns an appendix row set — everything carried at measured value except config-only changes
(Saga ratios; Daily Gift ratio using 0-9 streaks as an admittedly-overstating proxy; River Rush →
0). Rainbow Maker and Night Sky are NOT applied to A.0 (no behaviour data).

**The 11-resource universe (fixed order, append-only):** HC (coins ONLY), Slingshot, Shuffle,
Comet, Red, Chuck, Bomb, UL Bomb, UL Chuck, UL Red, Unlimited Lives. SPT/COOP/Avatar/Dly items are
out of scope (this is why Flash Race legitimately shows ≈0 — it pays SPT).

---

## 3. Registry & dispatch (one function per source — decision D15)

`CATEGORY_ORDER` (25 rows, must match the `EcoGainsSim_HC` block rows 8–32) drives the spill order.
The `SOURCES` registry maps category → its own named simulator; **anything unlisted is carried**:

```
simCore (carried)      simSaga                simDailyGift
simBombChallenge       simChuckChallenge      simRedChallenge     simLevelRace
simFlashRace           simTargetDay           simKiteFestival
simHatchlingHideaway   simBombsBallet         simJigsaw           simPhotoshoot
simRainbowMaker        simRiverRush           simNightSky (re-wired 2026-07-06)
```

Each function is a thin module declaring its inputs (calendar label, accrual key, config sheet)
and delegating math to shared helpers (`timedCore_`, `leaderboardSim_`, `collectionSim_`,
`survival_`, `reachSum_`, `accrualD_`). Carried: Ads, Core, Other, Season Pass (Free), Team Event,
Team Race, FlowerCoop, IAPs, Flock Flurry.

---

## 4. Calendar machinery: cadence (T)

### 4.1 Parsing (the verified merge rule)
The calendars are visual grids, rows 5–25, columns B..AH; **day = column − 1** (B = day 1, AH =
day 33). Rule: **each MERGED range = ONE instance whose duration is its column width; each filled
NON-merged cell = one 1-day instance; adjacent same-event cells are NEVER collapsed** (three filled
1-day cells = three 1-day events; two 2-wide merges side by side = two 2-day events). Aliases
folded before lookup: `Mystery Puzzle`/`Mystery Box` → `Jigsaw Puzzle`, `Chuck's Flash Race` →
`Flash Race`. Parsed instances are `{start, dur, days:[...]}` (1-indexed days).

Both calendars start **Wednesday**, so weekend (Fri/Sat/Sun) = `((day−1) % 7) ∈ {2,3,4}`.

Clipped instances (cut by the window edge — they exist at the START of the window in v5, e.g. RM's
and HH's 2-day first instances) keep their REAL day list for reach but are excluded from modal
duration via `modalDur_` (most-common duration).

### 4.2 Robustness (learned the hard way)
- Custom functions sometimes can't read merges → menu **EcoGainsSim ▸ Precompute calendars**
  parses with full permissions and writes `[calendar, event, start, dur]` rows to a hidden
  `cal_parsed` sheet, which the engine PREFERS over live parsing. Re-run it after editing merges
  (value edits are caught by `onEdit`; merge edits fire no trigger).
- **Namespace collision trap:** all Apps Script files share one global namespace; a test file
  defining `parseCalendarInstances_` with a different instance shape once silently overrode the
  engine's parser and zeroed/crashed everything. `Context.get()` therefore passes all parsed
  calendars through `sanitizeCal_` (rebuilds `days` from `start/end/dur` whatever the shape), and
  `calParseTest.gs` deliberately defines no parser of its own.
- If a whole calendar parses EMPTY, `timedCore_` fail-safes to carried (diff 0, reads as "no
  change") rather than zeros. **Sanity canary: the Kite Festival row must GROW ≈ ×1.3** (measured
  × T; re-classified 2026-07-06 — before that the canary direction was SHRINK via the score-curve D).

### 4.3 Reach and T
A player doesn't participate in every instance. For each instance:

```
reach(inst) = 1 − Π over inst.days of (1 − p_day),   p_day = weekend or weekday active rate
T = Σ over cal_new instances of reach / Σ over cal_curr instances of reach
```

T is therefore NOT an instance count ratio: it prices **how many times the event runs, how long
each run is (longer runs catch more of a non-daily population), and which days of the week it
occupies** — all per (segment, payer), because the rates are. This is why Flash Race moves
slightly (T≈0.99) despite 15×1d on both sides (slots moved weekday→weekend), and why Red's
Challenge grows (4×1d → 3×2d, T≈1.30 @0-9) while Chuck's shrinks (5×1d → 2×2d, T≈0.69).

`timedCore_` branch semantics (uniform for every calendar-driven source):
`cal_new` has no instances → SIMULATED = **0** (removal — this is how River Rush works, not a
stub); instances only in `cal_new` (no anchor side) → carried + NEEDS-ANCHOR (can't be priced);
both sides → `measured × D × T`; a calendar failed to parse → carried (fail-safe).

---

## 5. Duration (D) and the accrual curves

When an instance's length changes (Kite 7d→3d, Photoshoot 4d→3d, challenges 1d→2d…), a
participant has less/more time to earn. The accrual curves give `cum_token_share_p50(day)` = the
median fraction of a participant's *own eventual instance total* earned by day N — per
(event, payer, segment), with a `0-9` fallback.

```
D = share(newDur) / share(curDur)        // normalised at the CURRENT modal duration
```

- **Shortening = interpolation** on observed days → reliable (Kite 7→3: D = 0.34 @0-9 NP rising to
  0.57 @100+ NP — whales bank score earlier, so the shrink hurts them less; this
  segment-dependence is the whole point of keeping curves per segment).
- **Lengthening = extrapolation** past observed days → marginal-slope extrapolation capped at
  proportional, treated as low-confidence. In practice moot today: every lengthening case
  (challenges 1→2, HH 3→4) sits on a curve that saturates before the new duration → D = 1.
- Because the curve measures share of a player's own total, behaviors like HH's endless gate are
  *inside* the curve. Blind spot: it's a p50 curve — tail behavior (heavy loopers on an added
  day) is invisible. Flagged, accepted.

---

## 6. Segmentation: two different kinds, handled differently

1. **Data segmentation** (applies to EVERY source): all lookups are keyed by (segment, payer) —
   the measured anchor, active rates (T), accrual curves (D), streak and matchables percentiles.
   Every sim function takes `(seg, payer)` and passes them down; nothing is population-averaged.
2. **Config segmentation** (the ladder itself differs per segment): only `c_saga_v2` (5 per-segment
   Levels/HC column pairs — currently identical values, but the reader `readSagaV2_(seg)` selects
   the segment's own columns so future per-segment tuning "just works") and `NS` (genuinely
   different 3-milestone ladders per segment; `readNSLadder_(seg)` finds the segment's block).
   All other config sheets are single-config (verified by scan).

Payer flag is a full second dimension everywhere (NONPAYER/PAYER rows exist in every data sheet).

---

## 7. The three event families — how they differ and why it matters

This is the core conceptual section. What differs is **what gates the reward**, which determines
what duration does, what data can price a change, and what a zero means.

### 7.1 Leaderboard events (rank-gated): Bomb/Chuck/Red Challenge, Level Race, Flash Race, Target Day, Kite Festival
- **Reward gate:** your final RANK against other players. The payout ladder (200/100/50 HC +
  boosters, top-10) is a fixed pot per bucket — a participant's expected value depends on where
  they place, not how much they accumulate in absolute terms.
- **Duration is nearly irrelevant per instance (D pinned to 1):** if everyone gets 2 days instead
  of 1, everyone scores more but *ranks barely move* (rank is relative). The token accrual curve
  would mis-price this (it saturates day 1 anyway). So `sim = measured × R × T` — **cadence and
  reach carry the calendar movement; R carries reward-ladder edits** (2026-07-06): R[res] =
  E_v2/E_base where E = mean ladder payout at the measured `position_p25/50/75` rank quantiles
  (three-quantile approximation; pot-ratio fallback when an event has no position data).
  More instances = more chances at rank rewards.
- **Zero semantics:** low segments legitimately earn 0 HC (they never place top-3) — a zero here
  is real economics, not a bug. Check booster columns before declaring a row dead.
- **Target Day** is structurally a milestone+leaderboard hybrid, but its milestone ladder pays 0
  by design today (decision D3), so it is simulated as pure leaderboard. Its 3×7d → 15×1d change
  gives T≈1.8 (15 one-day boards = 15 rank chances). If milestones ever get rewards, it must move
  to the milestone family (§7.3) with a cumulative-SCORE-by-day curve — the generic token curve
  saturates day 1 and would double-count (this was the original "Target Day is broken" bug).
- **Kite Festival** — RE-CLASSIFIED 2026-07-06 (user decision): it is a *score* leaderboard, and
  its payouts are **rank-based and zero-sum per league of 60** (fixed pot 875 HC/league, no bots
  in the data; the single score milestone at req 100 pays no HC and is trivially reached — p25
  banked score @0-9 ≈ 100). Everyone scoring less in a 3-day instance leaves ranks, and therefore
  payouts, unchanged → **D pinned to 1 like every other leaderboard; the old score-curve D
  (0.32–0.70, the v1-era "flagship shrink") no longer applies.** Kite = measured × R × T ≈ ×1.3
  (a mild inflator via cadence, 3×7d → 5×3d). Kite's R also prices the score-milestone term
  (survival over `final_balance`), so milestone reward edits on Ki_v2 flow too. The
  `data_event_kite_accrual` curve remains in use by the PBP sim only (within-session progress).
  ⚠ This FLIPS the parse canary: the Kite row must now GROW vs measured, not shrink.

### 7.2 Streak events (threshold-gated by consecutive wins): Night Sky, Daily Gift
- **Reward gate:** a personal streak crossing a fixed threshold — no competition, no pot. Expected
  value = Σ over milestones of P(player's streak ≥ requirement) × reward.
- **The pricing tool is a distribution, not a curve:** `survival_()` builds S(x) = 1 − CDF(x) as a
  piecewise-linear CDF through the known percentiles (login-streak p50/75/90 for Daily Gift,
  daily-max-streak p50/75/90 for Night Sky), linear tail at the last observed slope, capped at 1.
- **Daily Gift** (live): the config pair changed HC values on a 7-day login ladder. R_HC =
  Σ(wₙ·v2ₙ)/Σ(wₙ·baseₙ) with wₙ = P(login streak ≥ n) = S(n−1). Day 7's untouched 100 HC shields
  long-streak players; low-streak segments eat more of the nerf (R = 0.74 @0-9 NP vs naive 0.835).
  D = T = 1 (always-on).
- **Night Sky** (re-wired 2026-07-06, `NIGHT_SKY_REWIRE_PLAN.md` Option A; **shipped OFF behind
  `NS_SIMULATE = false`** — same day, user call: even unchanged, the model OVERESTIMATES actual NS
  gains, cause not yet investigated, so NS is CARRIED in all three views until the flag is set
  true in `EcoGainsSim_v4.gs`): bottom-up because NS
  runs as an A/B test, so measured is test-diluted and NOT an anchor:
  `E_day = Σₖ S(CumStreakReqₖ) × rewardₖ` using the segment's OWN ladder (cumulative gating,
  honest — no free milestone), × Σ p_day over the 33 daily instances. Daily-reset means NS is a
  *rate*, not cumulative across days. S is built over the **`data_streaks`
  `max_streak_per_day_p25/50/75/90`** percentiles (clean source), each scaled by
  **`NS_STREAK_N` = 1.25** — the effective-streak factor from the standalone NS Excel study
  (landing ~a second streak of similar size; absorbs resets) — the same x-axis-scaling pattern
  RM uses for duration. The DIFF row is the ROLLOUT EFFECT (full-rollout sim − diluted measured),
  labeled in-sheet. Tail accepted as-is past p90 (user call); the harness prints the
  S=0-beyond-p90×N conservative bound alongside. E_day is monotonic in segment; the window TOTAL
  legitimately dips for 100+ (their measured Σ p_day is lower than 40-99's).
- **Zero semantics:** a simulated 0 is possible economics only where a milestone pays 0; an
  all-zero row = ladder-read bug.

### 7.3 Milestone events (accumulation-gated): Rainbow Maker (and Target Day if its milestones get rewards)
- **Reward gate:** cumulative personal accumulation (matchables banked, score reached) crossing
  fixed thresholds. No competition; everyone who accumulates enough gets paid.
- **Bottom-up pricing** (used when there's no measured anchor — RM is new):
  `E_instance[res] = Σ over milestones k of S(ReqAccumₖ) × rewardₖ[res]` where S is the survival
  function over the population's accumulation distribution (`data_RM` percentiles p10..p90,
  measured per one 4-day window ⇒ per-instance).
  Then `TOTAL[res] = Σ over cal_new instances of E_dur(inst)[res] × reach(inst)`.
- **Duration enters through the distribution, not a curve:** a clipped 2-day instance uses the
  matchables axis scaled by dur/4 (percentiles halved — flagged linear assumption). Contrast with
  collections, where duration enters via the accrual curve, and leaderboards, where it doesn't
  enter at all.
- **Tail sensitivity flag:** milestones past p90 are priced purely by the extrapolated tail (m30
  = 1000 HC sits just past p90 for 100+); always report the conservative S=0-beyond-p90 bound
  alongside (the harness prints both: 0-9 NP +59.7 vs bound 51.9; 100+ +789 vs bound 582).
- **Why an anchored R×D×T can't do this:** shortening a milestone event doesn't scale rewards
  linearly — it collapses which *thresholds are reachable*. That's the original Target Day lesson:
  a 1-day run reaches milestone ~3, a 7-day run reaches ~11; a saturating token curve sees D=1 and
  amplifies instead of collapsing.

### 7.4 Collections (for completeness): HH, Bomb's Ballet, Jigsaw, Photoshoot
Accumulation-gated like milestones, BUT live with full telemetry → anchored `measured × R × D × T`
with the token accrual curve for D. The curve does what the survival function does for RM, but
empirically. Rewards arrive progressively (mid-instance claims), which also matters for the daily
allocator (§9). **R (2026-07-06):** E = Σ_k S(req_k) × rew_k with S = survival over the measured
`final_balance_p25/50/75`; R[res] = E_v2/E_base. J and BB read each sheet's own native requirement
column, so requirement edits flow fully; HH and Ph have no native cumulative req column on the
base sheet, so BOTH sides share the v2 EventReach helper column as the req axis (reward edits
flow; req edits only re-weight which rows' rewards differ — flagged limitation).

### 7.5 River Rush — removal semantics
A real simulator on the generic collection path: `cal_new` has 0 RR instances → the removal branch
returns 0, DIFF = −measured (up to −102.6 HC/earner @100+ NP). Re-adding RR instances to both
calendars re-prices it with no code change (its 8-day accrual curve is already on file); instances
in `cal_new` only would flag NEEDS-ANCHOR and carry.

### 7.6 Saga & Core (always-on, ratio-only)
`data_gains` splits base-game progression into `Core` (chapter_complete, PlayerLevelUpChest —
unchanged, carried) and `Saga` (SagaPath/SagaChestRewards — the nerf line). D = T = 1.
`simSaga` applies per-resource ratios, all read live: HC from the per-segment `c_saga_v2` HC
columns ÷ `c_saga` (0.357 today, −43.9 → −578 HC/earner NP); every item from the per-node item
ladders on both sheets (`readSagaItems_`: per-level totals; e.g. UL Lives 150→265 min/cycle ⇒
×1.77). Rules: item column missing from one sheet's header → carried (don't zero on a layout
edit); base total 0 with v2 > 0 → carried (no anchor to scale; a new saga item needs bottom-up).

---

## 8. The survival function (shared helper — one implementation, three users)

`survival_(points)` builds a piecewise-linear CDF through (0,0) + given (x, percentile) points,
linear tail beyond the last point at the preceding segment's slope, capped at 1; returns
S(x) = 1 − CDF(x). Users: RM (p10..p90 matchables), Night Sky (data_streaks max-streak
p25/50/75/90 × NS_STREAK_N), Daily Gift weights (login-streak p50/75/90). Degenerate inputs (no
positive percentiles) → null →
caller carries. For anything priced off the tail, also compute the S=0-beyond-p90 bound.

---

## 9. The per-day view (`EcoGainsSim_Daily.gs`) — allocation, not re-simulation

`ECOGAINS_DAILY(payer, segment, source, block)` (block = CURRENT | NEW | DIFF) spills 33×11.
It re-uses the engine's window totals (CURRENT = measured, NEW = simulated) and ONLY distributes
them over days — column sums reconcile with the main sim to ~1e-13. "Claim-day realistic" rules:

| Source type | Instance split | Within-instance placement |
|---|---|---|
| leaderboard (incl. Kite, TaD) | ∝ reach(inst) | **all on the LAST day** (rank rewards at event end) |
| collections | ∝ reach(inst) | accrual-curve **marginal** share/day (share(d)−share(d−1)) |
| Rainbow Maker | ∝ reach(inst) | ∝ p_day within instance (no curve — flagged) |
| Core/Saga/Daily Gift | — | every day ∝ p_day |
| Night Sky | — | over its 33×1d instances ∝ p_day |
| non-calendar (Ads, Teams, SP, Other, IAPs; RR current side) | — | flat ÷33 (diff uniform) |

Expected reading: weekday/weekend texture from always-on sources, end-day spikes from leaderboard
instances (e.g. days 21/23 = Level Race's 2×2d), RM/collection humps across instance days.

---

## 10. Display & recalculation plumbing (Google Sheets specifics an LLM must know)

- **Custom functions only re-run when their ARGUMENTS change**, and results are cached on argument
  values. `SpreadsheetApp` reads inside the function are invisible to the dependency graph. Config
  edits therefore don't recalc anything by themselves. Solution: `AUTO_REFRESH = true` (top of
  engine) + a simple `onEdit` trigger watching every input sheet (`REFRESH_WATCH`) that calls
  `refreshSims_()` — which finds every formula containing `ECOGAINS_` on the display sheets
  (`REFRESH_SHEETS = ['EcoGainsSim_HC','EcoGainsSim_Daily']`), clears and re-sets it. Calendar
  MERGE edits fire no trigger → the Precompute menu action refreshes instead. Manual:
  menu ▸ Refresh simulations.
- **Custom functions & spills:** `ECOGAINS_SIM/ECOGAINS_DIFF(payer, segment)` spill 25×11 per
  segment block (blocks anchored at `$B$6/35/64/93/122/151`, the last being A. 0);
  `ECOGAINS_CAL_STATS("cal_curr"|"cal_new")` spills 25×2 (instance count, total event-days —
  REAL days, clipped instances count what fits) for the AB:AC / AE:AF columns; blank for
  non-calendar categories (its own `CAL_LABEL` map includes Flock Flurry, which is carried in the
  sim but scheduled). Spill target ranges must be empty.
- **`SimPerSegmentFill.gs`** is deliberately NOT a custom function: `fillSimPerSegment()` (menu ▸
  Fill Sim per Segment) writes the grouped rollup (PAID/ADS/CORE/META × segments × payers ×
  11 resources, `SPS_GROUPS` mapping editable at the top) as static values + Total/Δ formulas.
- **Sheet-generation:** display sheets are generated by Python/openpyxl scripts (`_build_hc_v4.py`,
  `_build_sps.py`, `_build_daily.py`) and imported into the Google workbook. Google-only formulas
  (LET, custom functions) are written as strings and only compute after import. Data-validation
  dropdowns with >255 chars of inline items must use a range-based list (see the Source filter).
- **Apps Script namespace:** one global scope across all project files; duplicate function names
  silently override (file order decides). Never re-define engine names in helper files.

---

## 11. Zero-value semantics (debugging decision table)

| Observation | Verdict |
|---|---|
| Event HC = 0 for a low segment, boosters nonzero | REAL (rank-gated economics) |
| Flash Race ≈ 0 everywhere | REAL (pays SPT, outside the 11 resources) |
| Missing `data_gains` row | REAL measured 0 (query emits only >0) |
| River Rush SIMULATED = 0, diff = −measured | SPEC (removed from cal_new) |
| A source with measured>0 sims 0 and it's not RR | BUG — check calendar labels, `cal_parsed` staleness, seg/payer labels |
| EVERY timed event = measured (diff 0) at once | calendar parse fail-safe engaged — run Precompute; check the Kite canary |
| Whole segment block zero | segment tag cell / label mismatch (`SEG_TO_GAINS`), or data sheet headers not on row 1 |
| `.length of undefined` errors | duplicate function name in another project file (§10) |

---

## 12. Verification workflow (do this after ANY engine change)

Offline Node harness (no Sheets needed): `python` dumps the workbook to `_mockdata.json`
(sheets: data_*, config pairs, RM, NS, calendars with merges), `_mock_run.js` / `_mock_daily.js`
mock `SpreadsheetApp` and `eval` the .gs files. Checks that must stay green:
- **Gates** (plan §5, values as of v5): Bomb T≈0.86, Chuck 0.69, Red 1.30, Level 0.86, Flash 0.99,
  TaD 1.81, HH 1.16 (D=1), Kite D 0.34@0-9 / 0.57@100+, BB D 0.94, Jigsaw 0.86, Photoshoot 0.91,
  saga HC ratio 0.357 + item ratios (Red .75, Bomb 1.5, Comet 2, UL Lives 1.77), Daily Gift R 0.74@0-9.
- **Conservation**: measured Core + Saga = old Core (88.16 @0-9 NP); daily columns sum to window
  totals (~1e-13); Σ single-source daily series = ALL.
- **Placement**: Kite pays only on instance last days; RM only on its instance days; NS daily.
- **NS gates** (2026-07-06 re-wire): simulated NS HC nonzero for every segment; E_day (HC per
  active day) monotonic in segment (the window TOTAL is NOT asserted monotone — 100+ has a lower
  measured Σ p_day than 40-99); NS still carried for A. 0; daily NS column sums == the simulated
  33-day NS row; PBP seed-averaged Sampled NS ≈ E_day.
- **R gates** (2026-07-06 R term): R == 1 exactly for every event with untouched v2 configs;
  Kite == measured × T exactly; TaD_v2 Coins ×2 → Target Day HC ×2; J_v2 Coins ×0.5 → Jigsaw HC
  ×0.5; J_v2 reqs ×10 → Jigsaw HC collapses (requirement edits flow); Race_v2 Red Coins = 0 →
  Red Challenge HC 0; all mutations restore to baseline. (The harness mutates the in-memory mock
  data and re-evals the engine to reset its caches.)
- **Collision resilience**: engine results identical when a foreign `{start,end,dur}` parser
  overrides `parseCalendarInstances_`.
Cheap sanity numbers live in `SIMULATION_PLAN.md` §5 (validation results block).

---

## 13. Open work & standing flags

1. **Night Sky: RE-WIRED 2026-07-06 but SHIPPED OFF** (`NIGHT_SKY_REWIRE_PLAN.md`, Option A —
   survival scaled by N=1.25 off `data_streaks`; master switch `NS_SIMULATE = false` in
   `EcoGainsSim_v4.gs`, NS carried in all three views). OPEN: the model overestimates actual NS
   gains even without config changes (user observation, cause not investigated — candidates: the
   N=1.25 factor, the one-clear-per-day×every-milestone-daily assumption, the linear tail).
   Other acknowledged simplifications: N uniform across segments/payers; tail past p90 as-is;
   A/B-arm telemetry unused for validation.
2. **Target Day**: if milestones ever pay, build the cumulative-SCORE-by-day curve and move it to
   the milestone family; also reconcile its calendar (7d) vs data (`instance_length=2`) duration.
3. **Level Race**: no accrual curve (D forced 1 — acceptable for rank rewards, revisit if priced).
4. **RM**: per-instance vs per-window interpretation of `data_RM` (naming says window = one 4-day
   run ⇒ per-instance; verify); 2-day ×0.5 linear scaling; tail sensitivity (report both bounds).
5. **HH endless gate**: p50 curve can't see tail loopers on an added day (§5, §7.4).
6. **Photoshoot**: n=1 instance both calendars → T is placement-noise-sensitive.
7. **Saga items**: base-0 → v2-positive additions carried (need bottom-up if it ever happens).
8. **A. 0 appendix**: Daily Gift ratio uses 0-9 streak proxy (overstates their remaining gains).
9. Measured anchors reflect a specific telemetry window; re-running the SQL refreshes the world —
   labels/headers must stay stable (`match3_query_learnings.md` has the Athena gotchas; note the
   0–9999 currency-gain cap and that Night Sky logs as *Dream Heist*).


---

## 14. Play-by-play session sim (EcoGainsSim_PBP.gs — the EcoGainsSim_PlybyPly sheet)

A different lens on the same data: ONE typical (segment x payer) player, ONE calendar day,
simulated play by play, to show how concurrently-running events interact inside a session.
Spec'd by the mock EcoGainsSim_PlybyPly_v3.xlsx (_build_pbp_mock_v3.py); requires
EcoGainsSim_v4.gs (Context, calendars, ladder readers) plus the workbook (6) data extensions
data_streaks and data_event_inst v2 (Kite rows + inal_balance_p25/50/75).

**Custom functions** (all spill, header row included):
ECOGAINS_PBP(calendar, day, segment, payer, mode, luck, seed, [levels], [startLevel]) — the
22-column ledger with ONE CLAIM PER ROW (2026-07-04 feedback round: openingInv removed, no em
dashes in any output; the first claim rides on its play row, further claims spill onto
continuation rows with blank play cells): S block (session-start claims: Daily Gift, Flock
Flurry 60-min UL opt-in grant) + N play rows + E block (day-end claims: LB payouts + Night Sky
nightly milestones) + Session Summary per source x 11 resources (styled identically to the
ledger on the sheet). ECOGAINS_PBP_EVENTS(...) — the Active Events table (6 columns; Family / Inst (days) /
Event day dropped). ECOGAINS_PBP_PROFILE(segment, payer) — the behaviour block: 7 rows, each
with a plain-language note (Daily Gift claim rate removed; p(active weekday/weekend) hidden
behind PBP_SHOW_ACTIVITY_RATES = false since the sim conditions on playing).

**Model.** N plays / win rate p / streak persistence q = data_streaks
(attempts_per_day_mean, win_rate_mean, p_continue_after_win). Win draws: 2-state Markov chain,
P(W|W)=q, P(W|L) solved so the stationary rate is p. Expected mode builds a deterministic
representative day instead (win quota N x p in runs of mean_streak_len); Sampled uses a
seeded mulberry32 PRNG — deterministic per seed, never RAND(). Event progress at session start
= final_balance_pXX (Luck dial) x accrual-curve share(k-1); milestones banked on earlier days
never appear in the ledger.

**Per-win earning is MECHANICAL where documented** (2026-07-04 — replaces the earlier smeared
fb x delta-share / wins average for these events):
- Hatchling Hideaway: flat **1.5 tokens/win** (config 1/2/3 by difficulty; level-mix average,
  user-approved constant). Gate unlock reqs stay the EventReach helper column (board cost
  x 1.25 bad-tile buffer) — unlock timing only; gains are always the exact gate bundles.
- Bomb's Ballet: **tokensPerLevel (config, 5) on FIRST-TRY wins only**
  (spawnTokensOnlyOnFirstTry); first-try = no failed attempt at that level in the trace.
- Jigsaw: **Completion Bonus tiers 3/5/7/10** (Copper/Bronze/Silver/Gold from the 2021
  Valentine's origin design PDF; a win awards the current tier then steps it up, a loss steps
  it down, floor Copper; session starts at Copper — flagged). Measured ~5.8 tokens/win
  corroborates the ladder; see source_docs/jigsaw.md.
- Photoshoot: first-try **streak multiplier ladder x1/2/4/6/10** from config; the per-win base
  is undocumented, so it is calibrated to the measured day total (shape = mechanics, level =
  measurement).
- Rainbow Maker: per-win matchables rounded to whole matchables.
Saga pays the **FULL node bundle** (HC + boosters + Unlimited minutes) read from c_saga /
c_saga_v2 per segment — in c_saga_v2 the even nodes pay 0 HC but still grant boosters + UL, so
an HC-only read would drop half the nodes. Daily Gift is **ALWAYS claimed** at S (a login is a
claim; the old claim-rate gate is gone) and pays ONE concrete config variant (Expected:
Variant 1; Sampled: seeded pick) — never an average, so claim bundles are integral.
Score events (Kite, Target Day) stay STREAK-driven with their config
step ladders (Ki_v2 1/10/100/200/500/1000; TaD 1/5/10/20/100); the raw streak model overshoots,
so per-play increments are scaled to hit the measured day target — model gives the shape,
measurement pins the level. LB payouts land on E only for instances ending that day, at the
Luck percentile of position_pXX (Sampled: +/-0.25-quantile jitter).
Night Sky (re-wired 2026-07-06; gated on the v4 master switch NS_SIMULATE, default OFF -> no
NS claims anywhere) pays on the E row: effective streak = base x NS_STREAK_N (1.25,
shared v4 constant); base = data_streaks max_streak_per_day_p50 (Expected) or the trace's
longest realized win run (Sampled). EVERY milestone whose Cum Streak Req is cleared pays, each
on its own row — honest cumulative gate, nothing unreached ever pays (the old handler
exact-matched the p50 against a req and silently zeroed most segments). Seed-averaging Sampled
NS reproduces the 33-day sim's per-active-day E_day (~x0.72 today — the Markov trace's best-run
tail is slightly lighter than the measured percentiles; within the x0.5..x2 harness gate).

**Standing flags:** conditions on the player being active AND participating in every running
event; HH/Ph milestone requirements come from the EventReach helper columns imported on
HH_v2/Ph_v2 (keep them); FF 60-min UL join grant, HH 1.5 tokens/win and Jigsaw 3/5/7/10 tiers
are design-doc constants (flagged, not sheet-read); the player walks in at a Starting Saga Level (input, or seeded random 100-400; Expected mode seed-independent) and Saga pays at config node boundaries anchored to that ABSOLUTE level (10-level nodes cycling every 100); Core chapter chests not simulated; Jigsaw
session-start tier = Copper (assumption); SPT/COOP/Avatar/Dly untracked.

**Verification:** python harness/_dump_mockdata.py && node harness/_mock_pbp.js — 32 checks:
spill shape, N from data, one-claim-per-row, no em dashes in any spill, determinism per seed /
seed sensitivity / Expected seed-independence, TOTAL == sum of ledger bundles == final
inventory, 6-column events table, TaD day score == measured target, Kite below-ladder payout,
Jigsaw tier deltas + crossings == grants + accrual text, Daily Gift variant tag + integral
bundle, Saga all-nodes-pay + bundle contents, 7-row profile with notes, HH/BB/Photoshoot
mechanical accrual texts, FF join grant, NS Expected pays-all-reached/none-unreached per
segment (incl. 0-9) + Sampled claims == best-run x N gate + seed-average ~ E_day, 100+ (N~147)
and cal_curr smoke tests.

**Display sheet:** display/EcoGainsSim_PlybyPly_v6.xlsx (builders/_build_pbp_v6.py) in the
workbook (6) green-simulation style the user hand-applied to the live sheet: 548235 section
bars w/ white bold text, E2EFDA labels/headers, FFF2CC inputs (each with a plain-language
note in column C), F3F3F3 profile values, EFEFEF spill areas, 999999 italic notes, Arial,
no gridlines / merges / em dashes. The whole ledger region incl. Session Summary is
pre-styled uniformly (user feedback). Opening Inventory section removed.
