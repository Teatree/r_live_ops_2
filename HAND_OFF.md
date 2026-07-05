# ABDB LiveOps Economy Simulation — HAND_OFF

**Game:** Angry Birds Dream Blast (ABDB / Dream Album), match-3, Rovio.
**Goal of this work:** a per-segment, per-resource simulation that compares **CURRENT** (measured, the calendar we run today = `cal_curr`) vs **SIMULATED** (a redesigned calendar = `cal_new`) resource gains over a 33-day window, so we can see how a calendar/config redesign moves the economy before shipping it.

**Environment:** Athena/Trino via pyathena, schema `abgbproduction_174525b3_gdpr`. Workbook authored in Google Sheets, exported to `.xlsx`. Procedural sim logic is a Google **Apps Script** file (`EcoGainsSim.gs`) that backs two custom functions used inside the `EcoGainsSim_HC` sheet.

**Latest files (in /mnt/user-data/outputs from this session):**
- `EcoGainsSim.gs` — the simulation engine (custom functions `ECOGAINS_SIM` / `ECOGAINS_DIFF`).
- `EcoGainsSim_HC_v2.xlsx` — the display sheet: 5 stacked per-segment tables + a Difference table each, Level Race added.
- `TestCalendarParse.gs` — standalone harness that prints how the engine reads the calendar merges (run `=TEST_CAL_NEW()`).
- Working workbook the engine reads: `NEW_LIVEOPS_CALENDAR_ECO_b.xlsx` (45 sheets: config sheets + `_v2` variants, the `data_*` query-output sheets, `cal_curr`, `cal_new`).

---

## 1. THE DATA PIPELINE (what each query produces and why)

Everything the sim reads comes from four query-output sheets (headers on **row 1**, data from row 2) plus config sheets. The queries live in `/outputs` as `.sql`. Standing Athena/Trino gotchas are in `match3_query_learnings.md` — obey them (cast `processdate` to INT for partition pruning; never put `FROM_UNIXTIME_NANOS` in a final SELECT without `DATE_FORMAT`/`DATE_TRUNC`; no `COUNT(DISTINCT)` inside a window; `ARBITRARY()` is non-deterministic; harmonise `processdate` bounds across CTEs; `client_events_view_currency_gain` has a 0–9999 cap that silently zeroes large grants — derive HC from `player_daily.hc_gain`; Night Sky is logged as *Dream Heist*; `event_tokens` is a MAP on the level-summary view; Team uses `m_event_start_time`; Kite is the `event_action`/`m_score_reached` score path).

**a) `resource_share_by_category_period_v2.sql` → `data_gains`** — THE ANCHOR.
Per `(engagement_segment, payer_flag, category, resource)` over the window it emits `amount_per_earner = total_amount / resource_earners`. This is the measured "what a player who earned this resource from this source got, on average." Key design points:
- **HC = coins only** (not the summed value of all items). Resources are the 11 the sheet shows: HC, Slingshot, Shuffle, Comet, Red, Chuck, Bomb, UL Bomb, UL Chuck, UL Red, Unlimited Lives.
- **Core is split into two categories**: `Core` (chapter_complete, PlayerLevelUpChest) and `Saga` (SagaPath, SagaChestRewards%). This split was added so the Saga reward change can be simulated as a bounded delta without the old negative-gains bug. The sheet re-folds them into one `Core` row.
- Segments are the RAW buckets: `A. 0`, `B. 1-9`, `C. 10-19`, `D. 20-39`, `E. 40-99`, `F. 100+`.
- `Level Race` is now its own category (you moved `race_event` there).

**b) `segment_behaviour_31d_v1.sql` → `data_seg_beh`** — the "who is online when" table.
Per `(segment, payer_flag)`: `weekday_active_rate`, `weekend_active_rate` (fraction of weekday/weekend days a player is active), `login_streak_p50/p75/p90`, `daily_max_streak_*`, `levels_played_per_active_day`, etc. Segments here are the **merged** labels (`0-9`, `10-19`, …). Presence is taken from `player_daily` (the correct online signal — not saga completions, which cause survivorship bias). `sessions_per_active_day` is NULL (no session column exists). Used for **reach** (does a player catch a given event instance) and Daily-Gift streak weighting.

**c) `event_accrual_curve_31d_v1.sql` → `data_event_accrual`** — the duration curve.
Per `(event_name, payer_flag, segment, event_day, instance_length_days)`: `cum_token_share_p50` = the cumulative fraction of an instance's eventual reward a player has earned by day N. Events present: Bomb, Chuck, Red, Flash Race, Flock Flurry, Hatchling Hideaway, Jigsaw, Photoshoot, Bombs Ballet, Target Day, River Rush (+ Dream Heist/Dream Pass). This is what lets us re-price an event when its **duration** changes: a 3-day version of a 7-day event pays `cum_share(3)`. Bug fixed in-session: use `ls.event_tokens[a.event_name]`, not `a.event_tokens`.

**d) Kite via score-LAG path → `data_event_kite_accrual`** — same shape as (c) but Kite is score-based (`eventtype='event_action'`, `m_event_name='KiteFestival'`, `m_score_reached`), so it needs its own query. Kite curve e.g. day3≈0.32, day4≈0.97, day5≈1.0.

**e) `event_inst` → `data_event_inst`** — instance metadata (positions, participant counts). Available for leaderboard rank context; not yet heavily used.

---

## 2. THE SIMULATION MODEL (the theory we agreed on)

For each **event** source, per resource:

```
new_per_earner[res] = measured[res]  ×  R[res]  ×  D  ×  T
```

- **R — reward/requirement ratio** (`v2 ladder / base ladder`). We diffed every base vs `_v2` config this session. **Result: only `c_saga` (Core/Saga) and `c_day` (Daily Gift) changed rewards.** Every event `_v2` (`Race`, `Ki`, `HH`, `BB`, `J`, `Ph`, `TaD`) changed **only `EventDuration`**; `F_v2`/`NS_v2`/`RR_v2` are byte-identical to their base. So **for all events R = 1** and the movement is duration + cadence. (If a future `_v2` changes reward values or milestone thresholds, R must be computed from the ladder.)
- **D — duration multiplier** = `cum_share(new_duration)` from the accrual curve, normalised to 1 at the current instance length. Shortening (e.g. Kite 7→3) is a reliable interpolation; lengthening (e.g. challenges 1→2, HH 3→4) is extrapolation past observed days → capped and flagged.
- **T — cadence × reach ratio** = `Σ over cal_new instances reach(days) / Σ over cal_curr instances reach(days)`, where `reach(instance) = 1 − Π_days(1 − p_day)` and `p_day` is the weekday/weekend active rate. This carries both how many instances run and the fact that longer instances catch more of a population that isn't online daily.

**Always-on sources** (Core/Saga, Daily Gift) have no calendar instances: D = T = 1, only R.
**Anchoring:** `measured` (from `data_gains`) reflects `cal_curr`, so it is the correct baseline; `T` is `new/cur`.
**Rainbow Maker** is the exception — it's new (not in `cal_curr`), so there's no measured anchor and it is computed bottom-up from milestone reach (see §6).
**Difference table = `simulated − measured` (real difference).** Cadence differences SHOULD show up there — that's the point.

### The calendar reader (this was the subtle part — get it right)
`cal_curr`/`cal_new` are visual grids (event rows 5–25, day columns B..AH = day 1..33; `day = column − 1`). **Rule: each MERGED range = one instance (duration = its column width); each filled NON-merged cell = one 1-day instance; neighbours are NEVER collapsed.** Two 2-day merges side by side = two 2-day events, not one 4-day event; three filled 1-day cells in a row = three 1-day events. Aliases: `Chuck's Flash Race`→`Flash Race`, `Mystery Puzzle`/`Mystery Box`→`Jigsaw`. Weekend = Fri/Sat/Sun = `((day−1) % 7) ∈ {2,3,4}` (calendars start Wednesday). This reader is verified against the analyst's hand-checked instance list.

**Confirmed cal_new instances:** Flash Race 15×1d; Chuck 2×2d; Bomb 2×2d; Red 3×2d (one clipped); Level Race 2×2d; Flock 18×1d; Kite 5×3d; Hatchling Hideaway 5×4d (one clipped); Target Day 15×1d; Jigsaw 3×3d (incl Mystery); Photoshoot 1×3d; Bomb's Ballet 1×3d; Rainbow Maker 5×4d (one clipped); Night Sky 33×1d. `cal_curr` differs mainly in: challenges 1-day, Kite 3×7d, Target Day 3×7d, HH 5×3d, RM absent.

---

## 3. ENGINE ARCHITECTURE (`EcoGainsSim.gs`)

- **Custom functions** `ECOGAINS_SIM(payer, segment)` and `ECOGAINS_DIFF(payer, segment)`: each returns a 24×11 spill (categories × resources). Called per segment table via `=LET(payer,$C$3, segment,$B$<headerRow>, ECOGAINS_SIM(payer,segment))`.
- **`CATEGORY_ORDER`** (24 rows, must match the sheet row order) and **`RESOURCES`** (11 cols).
- **`SEG_TO_GAINS`** maps sheet segment → `data_gains` label: `'0-9'→'B. 1-9'`, `'10-19'→'C. 10-19'`, etc. (Behaviour/accrual sheets use the merged `'0-9'` directly.)
- **`SOURCES` registry** maps each simulated category to a `{sim: fn, cal, accr, kite}` record. `resultRow_` dispatches: listed → its sim fn; unlisted → carried (returns measured).
- **`Context` / `DataStore`**: all sheet reads are isolated here (data_gains, data_seg_beh, both accrual sheets, both parsed calendars), so the reads can later be parameterised for offline testing (`DataStore.fromRanges`).
- **`parseCalendarInstances_`**: the verified merge reader. **Hardened this session** with `getMergedRanges() || []` and a `reachSum_` that skips malformed instances, because custom-function contexts can return odd shapes.

---

## 4. ⚠️ KNOWN PROBLEM #1 — "the sims give zeros" (DIAGNOSIS + FIXES)

Two separate things are being read as "broken." Work through them in order.

### (A) The anchored model returns 0 whenever `measured = 0` — and that is often correct.
`new = measured × R × D × T`. If `measured[res] = 0`, the result is 0 no matter what. Most zeros are this, and legitimately so:
- **The sheet's primary column is HC (coins). Most events pay boosters, not coins**, so their HC cell is genuinely 0 in `data_gains` — but their **Slingshot / Comet / Shuffle / Red / Chuck / Bomb** columns are nonzero and DO move. **Check the non-HC columns before concluding a source is dead.** (E.g. Target Day, HH, Kite give ~0 HC to low segments but real boosters.)
- **Some events pay 0 to low-engagement segments** (a 0-9 player never places top-3 in a leaderboard, so Flash Race HC = 0 for 0-9). That's a real economy fact, not a bug.

**Action:** don't judge by the HC column alone. In the display, consider showing a total-value column or verifying the booster columns. A source is only "not simulating" if `measured > 0` for that (segment,resource) yet the sim shows 0.

### (B) The **0-9 segment giving ALL zeros** (even Core/Daily, which DO pay HC) is a real bug — almost certainly a **segment-label or data-population mismatch**.
In the delivered workbook the labels line up and an offline run of the exact engine produced Core≈88, Daily≈104, RM≈37 for 0-9 NONPAYER — so the logic is fine; the live sheet's *state* is the suspect. Check, in this order:
1. **`data_gains` segment labels in the LIVE sheet.** The engine maps `'0-9' → 'B. 1-9'`. If the query was re-run and now emits a **merged `'0-9'`** (or only `'A. 0'`) for that bucket, the lookup misses and the whole 0-9 table is 0. Fix = make `SEG_TO_GAINS['0-9']` match whatever label `data_gains` actually uses. (This is the long-standing open "is 1-9 the canonical merged 0-9 (A.0 ∪ B.1-9)?" question — resolve it: if merged, sum `A. 0`+`B. 1-9` amounts and earners then divide, don't average.)
2. **The segment tag cell.** The `LET` reads `$B$<headerRow>`. That cell must contain exactly `0-9` (no note text, no stray spaces). In `EcoGainsSim_HC_v2` it's B6/B34/B62/B90/B118.
3. **Data actually present, headers on row 1.** The reader does `headerIndex_(vals[0])`. If any `data_*` sheet is empty, stale, or has its header not on row 1, every lookup for that sheet returns 0. Re-export the four `data_*` sheets fresh.
4. **PAYER cell** `$C$3` must be exactly `NONPAYER` or `PAYER`.

### (C) `getMergedRanges()` in custom functions (affects durations/cadence, NOT zeros).
If, in the custom-function context, `getMergedRanges()` returns empty, every event parses as anchor-only 1-day instances → wrong D and T (e.g. Kite stops shrinking). Events still show *measured* (via the `if(!nw.length) return measured` fallback), so this looks like "no change," not zeros. **Sanity check after install:** Kite should show the 7→3 shrink (D≈0.32). If it doesn't, switch the calendar read to a **menu-triggered precompute**: a normal function (full permissions) parses both calendars once and writes the instance list to a hidden helper sheet as values; the custom function reads that sheet instead of calling `getMergedRanges()` at query time.

---

## 5. ⚠️ KNOWN PROBLEM #2 — "one generic function is too opaque" → DETAILED PER-SOURCE PLAN

The current engine routes most events through a single `simTimedEvent` (`measured × R × D × T`). It's correct in aggregate but hides per-source intent and makes bespoke cases (Target Day) awkward. **Recommendation: split it into explicit, named per-source functions** (or a clearly-commented dispatch), one per source below, so each is visible and independently tunable. Here is the intended logic for every source:

| Source | Type | R | D | T | Status / what to build |
|---|---|---|---|---|---|
| **Core** (Saga folded in) | always-on | Saga HC × (v2Avg/baseAvg) | 1 | 1 | ✅ works. Ratio from `c_saga` vs `c_saga_v2` cycle-avg HC/level. Non-HC carried. |
| **Daily Gift** | always-on | streak-weighted v2/base day-ladder | 1 | 1 | ✅ works. Ladders `c_day` vs `c_day_v2`; weights from login-streak percentiles. |
| **Bomb / Chuck / Red Challenge** | leaderboard | 1 | accrual(2)/(1) *(lengthen→extrapolate, ≈1)* | cadence×reach | ✅ works where measured HC>0. Reward is rank-based; D via accrual is a proxy; flag 1→2 extrapolation. |
| **Flash Race** | leaderboard | 1 | 1 (dur unchanged) | 1 (15×1d both) | ✅ unchanged by design → equals measured. HC=0 for low segs is real. |
| **Level Race** | leaderboard | 1 | **1 (no accrual curve!)** | cadence (4×1d→2×2d) | ✅ works, biggest coin event (~9 HC @0-9). **TODO: add a Level Race accrual curve so D≠1.** |
| **Kite Festival** | score-leaderboard | 1 | kite accrual(3)/(7)=0.32 | 3×7d→5×3d | ✅ works, shrinks correctly. |
| **Hatchling Hideaway** | collection | 1 | accrual(4) *(saturates day3→≈1)* | 5×3d→5×4d | ✅ works. |
| **Bomb's Ballet / Jigsaw / Photoshoot** | collection | 1 | accrual(newDur)<1 | shortening | ✅ works. **Flag: BB config says 3→4 but calendar says 4→3 — calendar wins, reconcile the config.** |
| **Target Day** | **milestone/score (SPECIAL)** | 1 | **broken — see §6** | 3×7d→15×1d | ❌ over-estimates. Token/levels accrual saturates day1 → D=1, so the 5× cadence rise doubles it. Its rewards are at milestones 26+; a 1-day run can't reach them. **Needs a cumulative-SCORE-by-day curve.** |
| **Rainbow Maker** | **milestone/matchables (NEW)** | — | — | milestone reach × active-instances | ✅ now simulated (see §6). current=0, so diff = full addition. |
| **Daily Night Sky Prize** | carried | — | — | — | ✅ carried. `NS_v2==NS`, timing unchanged. If NS config changes, use streak method `Σ P(reach Rₖ)×HC_Rₖ`. |
| **Flock Flurry** | carried | — | — | — | ✅ carried. `F_v2==F`, 18×1d both calendars. |
| **River Rush** | stub | — | — | — | carried by request; `RR_v2==RR`. |
| **Ads / Other / Season Pass (Free) / Team Event / Team Race / FlowerCoop / IAPs** | carried | — | — | — | not in the calendar / no config change → measured, diff 0. |

**Per-source build notes for a rewrite (make each its own function):**
- `simCore` / `simDailyGift`: keep as-is (reward-ratio only).
- `simLeaderboard(cat)` for Bomb/Chuck/Red/Flash/Level: `measured × D × T`. Duration effect on a *rank* reward is weak, so consider D=1 for these and let T carry them (Level already does). Flag lengthening.
- `simScoreEvent(cat)` for Kite: `measured × D × T` with the kite score curve.
- `simCollection(cat)` for HH/BB/Jigsaw/Photoshoot: `measured × D × T` with the token curve.
- `simTargetDay`: bespoke milestone-reach-by-duration (see §6) — do NOT reuse the generic path.
- `simRainbowMaker`: bottom-up milestone reach (see §6).
- Keep the `SOURCES` registry so `resultRow_` still dispatches cleanly; the win is one readable function per source.

---

## 6. THE TWO MILESTONE EVENTS (Target Day + Rainbow Maker)

Both work the same way conceptually: **expected reward per instance = Σ over milestones k of P(reach k) × reward_k**, where P(reach k) depends on how much a player accumulates (score for Target Day, matchables for RM) in the instance's duration.

**Rainbow Maker (implemented this session):**
- Milestone ladder (`Req Accum` cumulative-matchables + per-resource rewards) is read live from the `RM` sheet.
- `matchables_p50` per (segment,payer) comes from `1__Rainbow_Maker_Sim.xlsx` → `Sim Per Segment` (0-9 NP=3935 … 100+ NP=127482; PAYER similar). The engine looks for an **`RM_matchables`** sheet first (`segment | payer_flag | matchables`) and falls back to a built-in map. **TODO: move those numbers into an `RM_matchables` data sheet** to honour "data in sheets, not code."
- `per_instance[res] = Σ_{ReqAccum[k] ≤ matchables_p50} reward_k[res]`; `RM[res] = per_instance × nEff`, `nEff = Σ reach over the 5 cal_new RM instances`.
- Result: 0-9 reaches milestone 6 (+37 HC), 100+ reaches 23 (+333 HC). **Assumption flagged: `matchables_p50` treated as PER-INSTANCE; if it's per-window, divide by `nEff`.** Verify which it is.

**Target Day (still wrong — highest-priority fix):**
- Same milestone structure, but rewards sit at **milestones 26+** requiring huge cumulative SCORE. A 7-day run reaches them; a 1-day run does not — so shortening 7→1 should **collapse** per-instance reward, offsetting the 3→15 cadence rise.
- The current engine uses the token/levels accrual for D, but **both saturate at day 1** (data `instance_length=2` while the calendar runs it 7d), so D=1 and the sim doubles Target Day instead of shrinking it.
- **Fix:** add a **cumulative-SCORE-by-day** column to the accrual query for Target Day (score → which milestone → summed reward), then `D_TaD = Σ_{milestones reachable at newDur} reward ÷ Σ_{reachable at curDur} reward`. Also reconcile the calendar (7d) vs data (`instance_length=2`) duration mismatch. Until then, treat Target Day as an **upper bound**.

---

## 7. WHAT WE DID THIS SESSION (chronological)

1. **Rebuilt the calendar reader** after establishing the merge rule (each merge = 1 instance; never collapse neighbours). Verified against the analyst's hand-checked cal_new list via `TestCalendarParse.gs`.
2. **Diffed every base vs `_v2` config** → found only Core/Saga and Daily Gift changed rewards; all event `_v2`s changed only `EventDuration`; Flock/NS/RR unchanged. This is why R=1 for events.
3. **Built the R×D×T engine**: calendar timing (T) + accrual duration (D) + reward ratio (R), anchored on `data_gains`.
4. **Added Level Race** as its own source/row (maps to `race_event` / `data_gains` 'Level Race').
5. **Rebuilt `EcoGainsSim_HC`** as 5 per-segment tables + Difference tables, Level Race row, formatting rules kept (blue=data, gray=sim, yellow=input/always-on, pink=event sim, red/green diff, orange segment tags, Arial, no gridlines, no frozen panes).
6. **Validated numbers** against real data (Kite shrinks, challenges move on cadence, Target Day flagged as over-estimate).
7. **Fixed a runtime crash** (`inst.days.forEach` at line 195) by hardening `getMergedRanges`/`reachSum_`.
8. **Implemented Rainbow Maker** (milestone-reach) instead of stubbing it.
9. Ran the whole engine end-to-end offline (mock `SpreadsheetApp`, real data) — no runtime error; sensible per-source numbers.

---

## 8. OPEN ITEMS / NEXT STEPS (priority order)

1. **Resolve the 0-9 zeros** — confirm the LIVE `data_gains` segment label for 0-9 and fix `SEG_TO_GAINS` (and the merged-0-9 per-earner recompute if it's `A.0 ∪ B.1-9`). Confirm the segment tag cell and that the four `data_*` sheets are populated with headers on row 1. (§4B)
2. **Split `simTimedEvent` into per-source functions** (§5) for transparency and to enable bespoke cases.
3. **Fix Target Day** with a score-accrual curve (§6). Reconcile its calendar-vs-data duration.
4. **Add a Level Race accrual curve** so its D isn't forced to 1.
5. **Move RM `matchables_p50` into an `RM_matchables` data sheet**; confirm per-instance vs per-window.
6. **Reconcile Bomb's Ballet** config duration (3→4) vs calendar (4→3).
7. If durations look wrong in-sheet, switch the calendar read to the **menu-precompute-to-helper-sheet** pattern (§4C).
8. Decide whether the display needs a non-HC or total-value view so booster-only events don't read as "zero." (§4A)

---

## 9. CONVENTIONS (strict — keep these)
- **HC = coins only.** 11-resource order fixed; append-only column changes; never edit existing column positions.
- **Zero formula errors** as a release gate. **Real data only** in cells labelled "(data)"; loudly flag every assumption.
- Formulas reference data sheets; no static values baked into sheets. (The RM matchables map in code is the one flagged exception — move it to a sheet.)
- Google-Sheets-native dynamic-array/`LET` functions don't recalc in Excel/openpyxl (only cached values survive as `__xludf.DUMMYFUNCTION`).
- No frozen panes. Arial. No gridlines.
- SQL: incremental Python generator pattern (compose labelled string blocks → validate → write file); separate `.sql` files, never edit SQL in place; read all referenced project files before writing SQL.
- Communication: terse, implementation-over-questions, make defensible choices and flag them.

## 10. KEY FILES
- Engine: `EcoGainsSim.gs`. Display: `EcoGainsSim_HC_v2.xlsx`. Calendar test: `TestCalendarParse.gs`.
- Live data workbook: `NEW_LIVEOPS_CALENDAR_ECO_b.xlsx` (config + `_v2` + `data_*` + `cal_curr`/`cal_new` + `RM`).
- RM reference (matchables source): `1__Rainbow_Maker_Sim.xlsx` (`Sim Per Segment`, `milestone_4day_new`).
- Queries: `resource_share_by_category_period_v2.sql`, `segment_behaviour_31d_v1.sql`, `event_accrual_curve_31d_v1.sql`, kite accrual, `event_inst`. Gotcha log: `match3_query_learnings.md`.
