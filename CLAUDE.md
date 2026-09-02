# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this workspace is

LiveOps economy simulation work for **Angry Birds Dream Blast** (ABDB, Rovio; sometimes aliased "Gymnastics Dream" in older docs). Not a software project in the usual sense — git-tracked locally (since 2026-07-05, no remote, no CI); binaries (workbooks, PDFs, display xlsx) are versioned alongside code and docs.

## Folder layout

```
(root)        CLAUDE.md + the context .md docs (reading order below)
engine/       live Apps Script files (.gs) — paste into the Sheets Apps Script project
engine/pre_collection/  the PRE-COLLECTIONS variant of the engine (v4 + Daily + PBP + simPerSegment,
              13 resources, no card packs) — kept in sync with engine/ for everything EXCEPT the
              D19/D21 pack features; harnesses do NOT scan this folder. **The workbook of record
              (16) is the 13-resource workbook, so THIS is the copy that belongs in its Apps Script
              project** (a 20-resource engine spills 20 columns into 13-wide blocks). Verified in
              sync 2026-08-17: identical function inventory bar the 7 pack functions, and
              bit-identical output on all 2306 non-pack cells + all 257,400 non-pack daily values.
              Divergence found and closed that day: `DAILY_LASTDAY`/`DAILY_CAL_LABEL` were missing
              Team Event / Team Race / Flock Flurry, so their totals spread flat over 33 days
              instead of landing on their calendar lanes (33-day totals unaffected). PBP differs by
              comments only; simPerSegment.gs is byte-identical to SimPerSegmentFill.gs
harness/      offline verification: _dump_mockdata.py, _mockdata.json, _mock_*.js
liveops20_fixes/  SEPARATE, ADDITIVE stack (2026-08-17): simulates changes ON TOP OF the live variant
              instead of vs Control. Third engine copy (anchor = `*_v2`, proposal = `*_v3`, window =
              21 days from Mon 2026-07-27), a workbook builder that clones the newest calendar
              workbook and adds the `_v3` layer, and PROMPT_variant_data_request.md for the analytics
              LLM. Read its README first — the main stack is untouched and stays authoritative for
              the v2-vs-Control question
builders/     current _build_*.py display-sheet generators + _sps_values.json
analysis/     sim-vs-actual A/B comparison pipeline (2026-08-13): _extract_actuals.py ->
              _build_comparison.py -> _build_report.py; derived data in analysis/out/,
              report lands in reports/. Since 2026-08-17 it also hosts the **v3 design pipeline**:
              _extract_ab_summary.py (the AB_Summary workbook -> ab_summary.json) +
              _extract_sinks.py (coin sinks / continue economics / per-segment source mix ->
              sinks.json) + _price_proposals.js (patches config sheets in memory, re-runs the
              engine, prices each proposal in coins per active player-day) ->
              _build_proposals_report.py
reports/      shipped HTML read-outs (LiveOps_v2_resource_ledger, LiveOps_v2_sim_vs_actual_discrepancy,
              LiveOps_v3_economy_playbook — the 12 v3 config proposals, bluish theme)
display/      the generated display xlsx files (import into the Google workbook)
workbooks/    Google Sheets exports: NEW_LIVEOPS_CALENDAR_ECO (N), RM/NS reference workbooks + csv
sqls/         Athena queries (one per data_* sheet) + the Python Sheets-export step
design_pdfs/  game-design PDFs (DRBL* = Dream Blast events, NEST* = related events)
source_docs/  per-source game-mechanics reference (.md, one per event)
archive/      superseded versions (engine v1, old builders/xlsx) — never extend these;
              archived scripts keep their old flat-root paths and won't run as-is
```

All scripts anchor their paths to their own file location, so run them from anywhere (commands below assume the root). The artifacts are:

- **Google Apps Script** (`engine/`) — the simulation engine, edited locally and pasted into the Apps Script project of a Google Sheets workbook. **Current engine: `EcoGainsSim_v4.gs`** (custom functions `ECOGAINS_SIM(payer, segment)` / `ECOGAINS_DIFF(payer, segment)`, each spilling 25 categories × 19 resources — SPT/SPTx2 appended 2026-07-10 D16, the six card pack tiers 2026-08-03 D19). Companions in the same Apps Script project: `EcoGainsSim_Daily.gs` (per-day 33-row view, `ECOGAINS_DAILY`), `EcoGainsSim_PBP.gs` (play-by-play session sim, `ECOGAINS_PBP`/`_EVENTS`/`_PROFILE` — see SIMULATION_METHODOLOGY §14), `SimPerSegmentFill.gs` (menu-run filler for the 'Sim per Segment' rollup), `calParseTest.gs` (calendar-parser verification), `CalStats.gs` (`ECOGAINS_CAL_COUNTS` — instances/event-days per source, spills into the `cal_new` summary block E38:K62; deliberately standalone so engine rewrites can't delete it), `V2Diff.gs` (menu-run: paints changed cells red on every `_v2` config sheet vs its base, skipping formulas and the helper blocks to the right of the base used-range), `HCPerWin.gs` (`ECOGAINS_HC_PER_WIN(segment)` — HC earned/spent per level win; standalone like CalStats.gs so an engine rewrite cannot delete it). `EcoGainsSim_7Day.gs` (windowed view: `ECOGAINS_SIM_7_DAY`/`ECOGAINS_DIFF_7_DAY`/`ECOGAINS_WINDOW_7_DAY`, same args + same 25×19 spill, restricted to cal_new days `WIN7_FIRST_DAY`..`WIN7_LAST_DAY` — currently 6..13 = **8 days**; it sums the Daily engine's claim-day allocation, so widening to 1..33 reproduces the full sim exactly, gated). `CardOpenings.gs` is the card-collection (pack-opening) simulator — it CONSUMES the pack flow rather than contributing to the 25-category universe (D19, see below). **Two menu-run entry points over ONE shared season core** (`runOneCardSeason_`, pure — no SpreadsheetApp, no `Math.random`, the seed fully determines it; D24 2026-09-01): `SimulatePackOpenings` plays one player and writes `Col_Cards_Daily`, and `SimulateCardCloud` plays N players (default 50) across all 10 segment × payer permutations and writes `Col_Cards_Cloud` + `Col_Cards_Totals`. Neither has its own copy of the rules, which is what stops the single-player log and the distribution describing different games. `archive/EcoGainsSim.gs` is the superseded v1 — don't extend it.
- **Athena/Trino SQL** (`sqls/`) — queries against schema `abgbproduction_174525b3_gdpr` that produce the `data_*` sheets the engine reads. Each file is named after the sheet it feeds (`data_seg_beh.sql`, `data_event_inst.sql`, `data_event_accrual.sql`, `data_event_kite_accrual.sql`); `resource_share_by_category_period_v2.sql` produces `data_gains`. Exception: `sqls/daily_gains.sql` is actually **Python** despite the extension — the notebook export step that pushes the query dataframes into the workbook's `data_*` sheets via the Sheets API, and the authoritative source for every `data_*` column's meaning (its `HEADER_NOTES` dict).
- **Excel exports** (`workbooks/`) — Google Sheets workbooks exported for reference. The workbook of record is the **highest-numbered `workbooks/NEW_LIVEOPS_CALENDAR_ECO (N).xlsx`**. Sheets-native `LET`/dynamic-array formulas do NOT recalc in Excel/openpyxl; only cached values survive (as `__xludf.DUMMYFUNCTION`).
- **Python builders** (`builders/_build_*.py`, openpyxl) — generate the display-sheet xlsx files in `display/` (`EcoGainsSim_HC_v4`, `EcoGainsSim_Daily_v2`, `EventReach_v1`, `EventReach_LB_v1`, `Sim_per_Segment_v3`, `EcoGainsSim_PlybyPly_v6`, `Race_v1` — the base `Race` config sheet regenerated from live server configs 2026-07-10 — plus `PackConfig_v2` and `SimOutput_v2`, the card-collection config + output sheets, D19, and `Col_Cards_Cloud_v1` + `Col_Cards_Totals_v1`, the stochastic sim's two sheets, D24 — both emitted by the ONE script `_build_cardcloud.py` because they share every geometry constant) which are then imported into the Google workbook. Regenerate by editing the script and re-running it — never hand-edit the xlsx. Superseded builder/xlsx versions live in `archive/`: when a new version supersedes a builder, move the old one there.
- **PDFs** (`design_pdfs/`) — game-design docs per event (DRBL* = Dream Blast events, NEST* = related events).
- **Markdown context docs** — the authoritative project state (see reading order below). Per-source game mechanics live in `source_docs/`.

## Reading order for any task touching the simulation

1. `HAND_OFF.md` — project history and rationale (describes the v1-era state; code details there are superseded).
2. `SIMULATION_PLAN.md` — per-source specs + decisions log D1–D20.
3. `SIMULATION_METHODOLOGY.md` — **reflects the code as shipped** (v4 engine vs workbook v5): calendar/cadence/duration/segmentation machinery, leaderboard vs streak vs milestone families, recalc plumbing, zero-semantics debugging table, verification workflow.
4. `source_docs/` for the mechanics of whichever event you're touching, then the code. Its `README.md` has the per-source index (doc quality per event) and the consolidated open questions / data conflicts (TaD zero-reward ladder, Core/Saga nerf scaling, Flash Race SPT, etc.).

## Commands (offline verification — run before shipping engine changes)

```
python harness/_dump_mockdata.py # regenerate harness/_mockdata.json from the highest-numbered NEW_LIVEOPS_CALENDAR_ECO workbook (run after every re-export)
python harness/_dump_mockdata.py --workbook "workbooks/COLLECTIONS_UNDER_NEW_CALENDAR (LATEST_2nd_SEP_b).xlsx" \
       --out harness/_mockdata_collections.json   # the CARD + ToF lineage - the card sim and Mighty Doors live only in these workbooks
node harness/_mock_run.js        # end-to-end EcoGainsSim_v4.gs over _mockdata.json (mock SpreadsheetApp): all segments, per-source results + release-gate checks
node harness/_mock_daily.js      # same for EcoGainsSim_Daily.gs
node harness/_mock_pbp.js        # same for EcoGainsSim_PBP.gs (~20 checks incl. determinism + calibration)
node harness/_mock_cards.js      # same for CardOpenings.gs (D19): PackConfig reader, pool/draw, pity, chests, determinism, namespace hygiene
                                 # --data <collections|main|wb14|path>; DEFAULTS to the collections dump (the ECO one has no usable PackConfig)
node harness/_mock_cloud.js      # same for SimulateCardCloud (D24): shared-core equivalence, percentile ordering, unbiased grant, seeding, determinism
node harness/_mock_7day.js       # same for EcoGainsSim_7Day.gs (D20): CONSERVATION (days 1-33 == full sim), day-sum equivalence, leaderboard edge placement, namespace hygiene
node harness/_dump_sim_matrix.js # full 25x19 sim/measured/diff matrices + the days 5..13 A/B-window sums -> analysis/out/sim_matrix.json (conservation-gated)
node harness/_dump_engine_versions.js --ref <sha>  # same mockdata through TWO engine revisions -> analysis/out/engine_versions.json; lets the pipeline attribute the workbook's cached display-sheet fill to a version (the pre-fix saga reader still lives in the Apps Script project: `Sim per Segment` shows HC +93% where the fixed reader shows -13%)
python analysis/_extract_actuals.py   # A/B export CSVs -> sim axes (extended category CASE, identity-gated) -> analysis/out/
python analysis/_build_comparison.py  # delta-vs-delta scoring + classes + whole-faucet (full_scope, additive per-source bridge) + workbook_fill_check -> analysis/out/comparison.json
python analysis/_build_report.py      # -> reports/LiveOps_v2_sim_vs_actual_discrepancy.html (+ artifact body)
python analysis/_extract_ab_summary.py   # newest workbooks/LiveOps_v2_AB_Summary*.xlsx -> analysis/out/ab_summary.json (Overall / new users / old players / By Bucket / NS_Config_Change_Est)
python analysis/_extract_sinks.py        # HC sinks by action+context, continue price/frequency, per-segment source mix -> analysis/out/sinks.json
node analysis/_price_proposals.js        # prices the v3 proposals: patches config sheets in _mockdata.json, re-runs the engine over the A/B window, converts to coins per active player-day -> analysis/out/proposal_pricing.json (also NS model-vs-measured reach)
python analysis/_build_proposals_report.py  # -> reports/LiveOps_v3_economy_playbook.html (+ artifact body)
python builders/_build_cardcloud.py # -> display/Col_Cards_Cloud_v1.xlsx + Col_Cards_Totals_v1.xlsx (D24)
python builders/_build_mightydoors.py # -> display/ToF_v1.xlsx, the Mighty Doors / Tower of Fortune config sheet (D28).
                                 # Authored inputs only: the SIM blocks are ECOGAINS_TOF spills, not formulas
python builders/_build_hc_v4.py  # rebuild a display xlsx into display/ (same pattern for the other _build_*.py)
```

All six harnesses are GREEN as of 2026-09-01 (`_mock_run` 55/0, `_mock_daily` 37/0, `_mock_7day` 20/0, `_mock_cards` 82/0 on the collections dump, `_mock_cloud` 26/0; `_mock_pbp` has one known saga-shape failure against the wb15 `_mockdata.json`) — a FAIL means you broke something, not that a gate is stale. Gates must never bake workbook state into an assertion: snapshot the sheet, mutate, assert, restore. This has bitten repeatedly — three gates had rotted into asserting sheets were ABSENT which the workbook now ships (D19), and five more froze a past config in D24b: a pity gate naming the tier that forces highest rarity (the ladder shifted down when the 6th pack tier was retired), a gate asserting no pack ladder had been authored yet, one asserting the attributed source set was exactly the fixture's three, and a single-seed rarity check that was a coin flip dressed as an assertion. **The fix is always to assert the RULE with a mutation fixture, never to weaken the assertion.**

`harness/_mockdata.json` is a dump of the live workbook's sheets (values + merges). **There are TWO dumps, because there are two workbook lineages:** `_mockdata.json` from `NEW_LIVEOPS_CALENDAR_ECO*` (the engine harnesses) and `_mockdata_collections.json` from `COLLECTIONS_UNDER_NEW_CALENDAR*` (the card harnesses — the card sim exists only there, and the ECO workbook of record reverted `PackConfig` pre-D19, which made `loadPackConfig_` throw before a single gate could run). Each dump carries a `_meta` record naming its source workbook and dump time, so the two cannot be confused. `_dump_mockdata.py` also OVERLAYS any sheet listed in its `PENDING_IMPORT` map from the freshly built `display/*.xlsx`, so the harness tests the layout the engine expects even before you import the sheet (currently `Col_Cards_Cloud` and `Col_Cards_Totals`; drop an entry once imported — leaving one there makes the overlay replace the REAL sheet, and any formulas you added to it, with a builder artefact).

The Kite row is the canary: it must DIFFER from measured (= measured × R × T; ≈ ×1.09 with the real Ki_v2 edits since workbook (8), ×1.3 back when v2 was untouched; Kite re-classified as a zero-sum leaderboard 2026-07-06) — if it shows "no change", calendar parsing fell back to carry-measured. Second canary since D16: the Kite **SPT** column must also differ (measured × R_SPT 0.638 × T) and the Season Pass row must move (tier coupling). Third canary since D17/D18: **Core SPT** — the `CORE SPT GATES` block asserts the D18 synthetic anchor (`meas = L × E_base`, `sim = L × E_v2`, halves-averaged panel E) and that injected real `data_gains` Core SPT rows make the synthetic stand down.

Workbook (15) state (2026-08-13, workbook of record; `_mockdata.json` dumped from it, wb14 snapshot kept at `harness/_mockdata_wb14.json`): a **(13)-lineage branch** — 13-resource `EcoGainsSim` sheet, `PackConfig` reverted pre-D19 (so `_mock_cards` CRASHES and one `_mock_pbp` saga-shape gate is red on this dump; both are wb15 content, not harness bugs — green on the wb14 snapshot), `data_gains` has NO Core-SPT rows (the D18 synthetic anchor is ACTIVE again). Real edits vs (13): `SP_v2` Core-SPT panel softened to E 12.225 → **R 0.812, validated against the live A/B core lane (0.81–0.88)**; `NS_v2` carries 10 HC edits (R 1.00–1.35 by segment); `c_saga`/`c_saga_v2` REBUILT in a triple-column layout (`Levels Req | RewardChestId | HC Reward` per segment block, base segmented too) — the engine's saga readers are **header-driven since 2026-08-13** (both `engine/` and `engine/pre_collection/`; the old fixed-column read silently priced chest IDs as HC, Saga R ×7–10) — **re-paste `EcoGainsSim_v4.gs` into the live Apps Script project**. The base `RM` sheet is DELETED (`RM_1st`/`RM_2nd` carry the ladders). **Season-Pass tier-30 cap (open flag):** at R 0.812 the cap masks `20-39`/`40-99`/`100+` on both sides — SPT gates run on `SP_SEG = '10-19'` (headroom, though the shipped panel no longer crosses a tier there; the drop mechanism is mutation-gated via SP_v2 Cumul ×2); `_mock_run` reports which segments are cap-masked.

## The big picture

The goal: a per-segment, per-resource simulation comparing the CURRENT calendar (`cal_curr`, measured) vs a REDESIGNED calendar (`cal_new`) over a 33-day window.

**Core model** — for each anchored event source, per resource:
`SIMULATED = measured × R × D × T`

- **R** = reward-config ratio (v2 ladder / base), wired for EVERY simulated source since 2026-07-06: Saga/Daily Gift (streak-weighted), leaderboards (rank ladder priced over a rank **distribution** — D27, 2026-09-02: a piecewise-linear CDF anchored on measured `position_p25/50/75` from `data_event_inst`, `E = Σ_k P(rank=k) × ladder_k`, so every position on the board carries mass; it was the mean of those three ranks alone, which paid a top-heavy ladder an exact 0 whenever none of them landed in the paying band. `LB_RANK_MODEL='quantiles'` reverts), collections (milestone ladder × survival over `final_balance_p25/50/75` — reward AND requirement edits flow; HH/Ph share the v2 helper req axis). R=1 while `_v2` rewards are untouched; base-0 → v2>0 additions are carried (no anchor — TaD milestone rewards won't flow).
- **D** = duration multiplier from the accrual curves (`data_event_accrual`). Leaderboard events pin D=1 (rank payouts are end-state) — including Kite Festival since 2026-07-06 (zero-sum league pot; `data_event_kite_accrual` is now PBP-only). Shortening = reliable interpolation; lengthening = flagged extrapolation.
- **T** = cadence × reach ratio across calendar instances, using weekday/weekend active rates from `data_seg_beh`.
- Always-on sources (Core/Saga, Daily Gift): D=T=1. Unlisted categories are **carried** (= measured, diff 0). **Core is SPT-simulated since D17, with a SYNTHETIC anchor since D18 (2026-07-30):** level completions pay a difficulty-tiered SPT reward (Normal/Hard/Extreme, per season half — base 12/20/30 2nd half & 10/15/20 1st half, `SP_v2` halved) under an assumed difficulty mix. `data_gains` has NO Core SPT rows (live pays them; the export can't see them), so `measuredRow_` synthesizes the anchor: `L = levels_completed_per_active_day × Σ p_day` over the window (`data_seg_beh`), `meas[Core,SPT] = L × E_base`, `SIM = L × E_v2` where `E = Σ mix · mean(half1, half2)` priced off the `SP`/`SP_v2` panel (`readSPLabelPair_`; wb13/14: E 15.05 → 7.45, R 0.495; wb15: E 15.05 → 12.225, **R 0.812 — validated against the live A/B core-SPT lane, 0.81–0.88 per segment**). The synthetic fires ONLY while the raw data read is 0 — real Core SPT rows in a future re-pull take over automatically. Every OTHER Core resource stays carried (measured Core SPTx2 = 0). Core dominates the SPT faucet, so this drives the Season Pass tier (via `sptTotals_`, both sides). Applies to the 33-day/Daily/SPS views; PBP adds it as one day-end claim = wins × E_SPT (shared `coreSptE_` → halves-averaged too). Rainbow Maker is new (no measured anchor) → bottom-up survival-weighted milestone reach from `data_RM`. River Rush has no `cal_new` instances → 0 (removal semantics). **Night Sky is ANCHORED since D22 (2026-08-05):** `NS` is the base config (the measured rows were earned under it) and `NS_v2` the redesign, so `SIM = measured × R × T` with `R[res] = E_v2/E_base`, `E[res] = Σ_k S(CumStreakReq_k) × reward_k[res]`, D=1 (1-day instances) — the SAME survival S (re-wired 2026-07-06 per `NIGHT_SKY_REWIRE_PLAN.md`: `data_streaks` max-streak percentiles × 1.25 `NS_STREAK_N`) prices both sides, so requirement edits flow too. `NS_v2 == NS` ⇒ R=1 ⇒ sim = measured × T, and both calendars run NS on all 33 days ⇒ **diff exactly 0** (that zero is the model working; workbook (14) ships NS_v2 as a clone). Missing `NS_v2`/segment row → falls back to `NS` (R=1). Base-0 & v2>0 → no anchor → ADD `E_v2 × Σp_day` (an SPT typed into `NS_v2` therefore reaches the Season Pass tier); packs take `packLane_` instead. No `cal_new` NS instances → 0. `A. 0` carried. PBP reads `NS` on cal_curr / `NS_v2` on cal_new (the one exception to "_v2 for both calendars"). `NS_SIMULATE` (v4) is still the lane on/off: `false` → carried, T not applied, no PBP claims. **Two Night Skies since D23 (2026-08-27):** when `NS_v2_weekday` exists, `NS_v2` is the WEEKEND ladder and `NS_v2_weekday` the weekday one; `E_v2` becomes the day-type-weighted average `(E_wd × Σweekday p_day + E_we × Σweekend p_day) / Σall p_day` over the cal_new NS days (`isWeekend_` = Fri/Sat/Sun, 15 of 33), so R / the base-0 addition / `packLane_` are untouched and a weekend-only reward is paid at ~41–46% of face value. The daily view (`nsDayTypeRows_`), the PBP ledger (`nsLadderForDay_`) and the card sim's pack rungs pick the ladder per DAY and still sum to the blend. Missing weekday sheet falls back to `NS_v2` (NOT `NS`); `NS_DAYTYPE_SPLIT = false` disables the split. FLAGGED: the old bottom-up sim's ~5× overestimate was never diagnosed — anchoring side-steps it (level right by construction, same unvalidated model behind R), and the A/B dilution now cancels inside R so the full-rollout "rollout effect" number is gone.
- **Rainbow Maker split configs (2026-07-10 — HARDCODED, revisit):** the 5 `cal_new` RM instances (start-sorted; the clipped 2-day instance at days 1–2 is #1) read different config sheets — #1–#3 → `RM_1st` (no SPTx2), #4–#5 → `RM_2nd` (SPTx2). The map is the `RM_INSTANCE_SHEETS` array in `EcoGainsSim_v4.gs` (`rmConfigFor_`); a missing/unreadable split sheet falls back to `RM`. All four views share it (33-day + SPS via `simRainbowMaker`, daily via `rmInstanceRows_` per-instance placement, PBP via day→instance ordinal). **TODO — un-hardcode:** a general per-instance config mechanism (e.g. a config-panel row on the calendar or per-sheet instance ranges) should replace the array; if the calendar's RM instance count/order changes, the hardcoded 3+2 split silently mis-assigns.
- **Season Pass (D16):** per-earner SPT+2×SPTx2 totals across all sources (measured vs simulated) land on the `SP`/`SP_v2` 30-tier Cumul ladder; the row scales by the cumulative-track-reward ratio through the reached tier (FREE for nonpayers, FREE+PAID for payers — flagged assumption) × `SP_lb_v2`/`SP_lb` challenge pot ratio × calendar T (D=1). No anchor → additive tier rewards when tiers rise, carry otherwise. `SP_v2`/`SP_lb_v2` missing → base sheets (ratios 1). See `SIMULATION_METHODOLOGY.md` §6.11 / `source_docs/season-pass.md`.

**Card-collection PACKS (D19, 2026-08-03).** The six pack tiers (`1-star Pack`…`6-star Pack`) are resources 14–19 and are **simulated-side only**: `data_gains` has no pack rows, so the measured anchor is 0 and `measured × R × D × T` can never produce one. Every source instead prices packs **bottom-up on `cal_new`** (`packLane_`):

`packs[res] = E_v2[res] × participation_rate × Σ_instances reach(inst)`   — no D term

`E_v2` is the *same* expected ladder payout the R ratio is built from (`rewardE_`, split out of `rewardR_` for exactly this), so a pack typed into a `_v2` ladder is priced like a coin on the same row. Sources with a config sheet all pay packs, **including the carried ones** — `Team Event` and `Flock Flurry` keep measured values for all 13 other resources and get only a pack overlay (`PACK_ONLY_SPECS` → `TE`/`F` sheets). `Team Race`, `Ads` and `IAPs` have no config sheet → 0. `A. 0` has no behaviour telemetry to price reach → 0. Season Pass prices the whole reached track; RM is bottom-up so its packs flow through `RES_MAP` alone; Night Sky was too until D22 re-anchored it, and now routes its packs through `packLane_` like everyone else.

**Pack values are authored by hand** on the `1-star Dly`…`6-star Dly` columns that already exist on every ladder — until a number is typed there, every pack column reads 0, which is correct rather than a plumbing failure. Flagged: `reach × participation_rate` mildly under-counts high-participation events, and `Team Event` has no `data_event_inst` rows so its ladder is priced at a flat rank average (crudest pricing in the model).

**ENVELOPE SEASON CUTOFF (D26, 2026-09-01).** The collection season is shorter than the 33-day window: after `SEASON_LAST_DAY` (29) no source pays envelopes — the in-game name for the six `*-star Pack` resources. **Only envelopes stop.** HC, SPT, SPTx2, boosters and Unlimited Lives keep paying on all 33 days, and no non-pack number changes at all. An instance wholly past the cutoff leaves `packLane_`'s reach sum (so the window total drops); an instance straddling it pays its envelopes IN FULL, with any pack landing past the cutoff settling on day 29. `Season Pass` is exempt via `SEASON_EXEMPT_LANES` (its track is climbed during the season). `SEASON_CUTOFF = false` restores the pre-D26 model exactly. `engine/pre_collection/` needs no mirror — it has no pack lane.

> ### ⚠ HARDCODED ASSUMPTION — Kite Festival opt-in = 0.35 (D25, 2026-09-01)
>
> **If a Kite pack number ever looks odd, this is why. It is an assumption, not a measurement — 15-31× the observed rate.**
>
> `PACK_PARTICIPATION = { 'Kite Festival': 0.35 }` in `engine/EcoGainsSim_v4.gs`, applied by `packParticipation_`.
> (Set to 0.75 first, lowered to 0.35 the same day — 75% read as implausibly high for an opt-in league.)
> Measured Kite opt-in in `data_event_inst` is **1–3%** (0.0096 at `0-9` NONPAYER … 0.0327 at `100+` PAYER) — the
> Festival is a league you have to JOIN. At the measured rate the card sim's per-instance gate
> (`participation × reach`) was 1.6%, so a pack typed onto every one of the 60 `Ki_v2` rank rows produced a Kite pack
> in only ~8% of runs and read as "Kite isn't simulated". User decision 2026-09-01: price the redesign at 0.35.
> **Effect (20-39 PAYER): Kite packs/season 0.0816 → 1.1855; runs granting ≥1 Kite pack 23/200 → 146/200.**
>
> **Scope: the pack lane ONLY.** `rewardR_` is a v2/base ratio, so participation cancels out of it — Kite's HC,
> boosters and SPT are untouched, and pack flow for every other source is unchanged to the cent.
>
> **To change it without touching code:** put a `Participation` label anywhere on `Ki_v2` with the value in the cell
> to its right. `packParticipation_` resolves sheet label → `PACK_PARTICIPATION` → measured rate → 1.0.
>
> Same mechanism guards a real trap: a rate that exports rounded to `0.0` is indistinguishable from "no telemetry",
> and both readers then price at FULL participation (~40× too high). The `_LIVEOPS_CALENDAR` export has exactly that
> for Kite, Level Race, Photoshoot, River Rush, Dream Pass and Season Pass Leaderboard.
>
> `harness/_mock_cards.js` section 0 PRINTS every active override on every run, so it cannot rot quietly.

**Card sim (`CardOpenings.gs`, menu ▸ Simulate card pack openings).** Consumes that pack flow: `dailyPacksFor_(seg, payer)` in `EcoGainsSim_Daily.gs` returns a 33×6 per-day grid broken down by source, which the card sim turns into discrete pack opens (trailing fraction resolved by a **seeded Bernoulli** so the granted count is unbiased). Draws are **count-proportional over the `PackConfig` SNAP POOL, without replacement** — rarity is a property of the pool and drifts as it depletes; the old per-pack rarity-probability grid was deleted because it multiplied the pool counts and applied rarity twice. Pack tier now differs only by `Cards/Open` + the pity table. `EcoPackGains` and `PlayerBehavior` are **deleted** — segments/attendance come from `data_seg_beh`, the schedule from `cal_new`. See `source_docs/card-collection.md`.

**Data flow:** SQL queries → `data_*` sheets in the live workbook (headers on row 1, data from row 2) → `EcoGainsSim_v4.gs` reads them plus the visual calendar grids, all LIVE at recalc (decision D12: no numbers in code) → spills per segment block in `EcoGainsSim_HC`.

**Calendar reader rule (subtle, verified):** in `cal_curr`/`cal_new` each MERGED range = one instance (duration = column width); each filled non-merged cell = one 1-day instance; neighbours are never collapsed. Day = column − 1; calendars start Wednesday, so weekend = `((day−1) % 7) ∈ {2,3,4}`.

**Segments (decision D8):** raw buckets in `data_gains` (`A. 0` … `F. 100+`) vs merged labels elsewhere (`0-9`, `10-19`, …) — `SEG_TO_GAINS` maps `'0-9' → 'B. 1-9'` (NOT a merge of A.0∪B.1-9). `A. 0` is an appendix block: carried except config-only changes; RM, NS and the Season Pass tier coupling not applied. A label mismatch is the prime suspect whenever a whole segment table reads zero. `data_gains` only emits amount>0 rows, so a missing row is a legitimate measured 0 — most events pay boosters, not HC; check non-HC columns before calling a source dead.

## Apps Script gotchas (learned the hard way)

- **A cross-file `const`/`let` redeclaration is a HARD load error that kills EVERY custom function in the project.** Duplicate `function`/`var` names silently override by load order (bad but survivable); duplicate `const` throws `Identifier 'X' has already been declared` at load, and Sheets then reports `Unknown function: 'ECOGAINS_...'` for *every* engine function while already-spilled cells keep showing stale cached values — so the sheet looks half-working. The usual cause is TWO COPIES of a file in the project after a rewrite (e.g. an old `CardOpenings.gs` using `const SHEET_SIM` alongside the new one using `var SHEET_SIM`). Diagnose by running any zero-argument function from the Apps Script editor: it either logs, or names the duplicate identifier and its file. The project should contain exactly ten `.gs` files, one copy each (CalStats, CardOpenings, EcoGainsSim_7Day, EcoGainsSim_Daily, EcoGainsSim_PBP, EcoGainsSim_v4, HCPerWin, SimPerSegmentFill, V2Diff, calParseTest).
- **All `.gs` files share one global namespace.** A test file re-declaring `parseCalendarInstances_` once silently overrode the engine's parser. Helper/test files must define no duplicate names. Worked example (found + fixed 2026-08-03): `CardOpenings.gs` defined its own `onOpen()` building a 'Sim' menu, which collided with `EcoGainsSim_v4.gs`'s `onOpen()` — one silently replaced the other, so whichever loaded second was the only menu you got. **There is exactly one `onOpen`, in `EcoGainsSim_v4.gs`; add menu items there.** `harness/_mock_cards.js` and `harness/_mock_cloud.js` both gate this (no cross-file duplicate globals, exactly one `onOpen`).
- Custom functions sometimes can't read merges → menu **EcoGainsSim ▸ Precompute calendars** writes parsed instances to a hidden `cal_parsed` sheet, which the engine prefers. Re-run after editing merges (merge edits fire no `onEdit` trigger; value edits are caught by `AUTO_REFRESH`).
- Google only re-runs a custom function when its ARGUMENTS change; every `ECOGAINS_*` formula therefore carries a trailing `sim_refresh!$A$1` nonce argument, and `AUTO_REFRESH = true` + the `onEdit` trigger bump that nonce after input-sheet edits (one atomic write — formulas are NEVER cleared/re-set; the old clear→restore refresh is what periodically wiped them: onEdit's ~30s hard kill skips `finally`). `refreshSims_` self-heals: adds the nonce to formulas missing it and restores vanished anchors from a document-properties snapshot.

## Related but separate work in this folder

- `NS_Economy_Sim_Summary.md` — Night Sky (daily streak event) HC simulation; different workbook (`1_DAY_NS_TD_5_Segs_V3`), different model (streak-percentile milestone reach).
- `Event_Eco_Investigation_Context.md` — the May 2026 free-HC source investigation: segmentation definitions, standard filters (geo NOT IN ('FI','PL'), orphans exclusion, max_level > 200, 0–9999 amount cap), and findings. Reuse its conventions for any new economy SQL.
- `spreadsheet_style_and_river_rush_context.md` — spreadsheet style rules and River Rush event design.

## Conventions (strict — from HAND_OFF.md §9 and the style doc)

- **HC = coins only.** The 20-resource column order is fixed (SPT/SPTx2 appended as cols 12–13 in D16; the six `1-star Pack`…`6-star Pack` tiers as cols 14–19 in D19; `ToF_Ticket` as col 20 in D28); column changes are append-only. Builders derive every block position from `len(RES)` — never hardcode a column letter (that is what rotted `_restore_formulas.py`).
- Zero formula errors is a release gate. Real data only in cells labelled "(data)"; loudly flag every assumption.
- Formulas reference data sheets — never bake static values into sheets or code. If a value is computable from inputs, compute it.
- **SQL:** compose via the incremental Python generator pattern (labelled string blocks → validate → write file); separate `.sql` files, never edit SQL in place; read all referenced project files before writing SQL. Athena gotchas: cast `processdate` to INT for partition pruning; `client_events` currency amounts have a 0–9999 cap that silently zeroes large grants (derive HC from `player_daily.hc_gain`); no `COUNT(DISTINCT)` inside a window; `ARBITRARY()` is non-deterministic; Night Sky is logged as *Dream Heist*; `event_tokens` is a MAP on the level-summary view.
- **Simulation sheets:** Arial, no gridlines, no frozen panes; palette #CFE2F3 data / #E2EFDA sim / #FFF2CC input.
- **Design/config sheets (Ph style):** never merge cells; everything starts at column A; 0 (not blank) for empty numeric cells; punch-card rule — include ALL in-game currency columns even when unused (zeros); conditional formatting (not static fills) for value-driven styling; zebra-stripe at the logical group level.
- **Git: COMMIT after every change, NEVER push.** Each completed change lands as its own commit,
  as soon as it is made and verified. Do not batch several changes into one commit, and do not
  wait to be asked. Pushing to `r_live_ops_2` is Garry's call alone - never run `git push`.
  Reason: the workbooks and .gs files are edited from more than one place, so an uncommitted
  working tree is what turns a routine `git pull` into a merge that can lose work.
- Communication: terse, implementation-over-questions; make defensible choices and flag them.
- **Before entering plan mode or writing any plan, ALWAYS ask exactly 15 clarifying questions**, in batches of 4 (4+4+4+3). This is not a ceiling to approach or a target to approximate — ask all 15 every time, even when the task looks clear. The questions must be split between:
  - **things you did not immediately understand** from the request or the code (ambiguous scope, conflicting data, undefined semantics), and
  - **my intentions** — what I am trying to achieve and why — but only where a different intention would produce a *different implementation*. Don't ask about preferences that change nothing.
  - Ask more than 15 if genuine ambiguity remains after the first 15. Never assume a default for anything I haven't specified; prefer asking over guessing. If you spot an ambiguity mid-implementation, surface it rather than silently picking.
