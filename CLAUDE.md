# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this workspace is

LiveOps economy simulation work for **Angry Birds Dream Blast** (ABDB, Rovio; sometimes aliased "Gymnastics Dream" in older docs). Not a software project — no git, no CI.

## Folder layout

```
(root)        CLAUDE.md + the context .md docs (reading order below)
engine/       live Apps Script files (.gs) — paste into the Sheets Apps Script project
harness/      offline verification: _dump_mockdata.py, _mockdata.json, _mock_*.js
builders/     current _build_*.py display-sheet generators + _sps_values.json
display/      the generated display xlsx files (import into the Google workbook)
workbooks/    Google Sheets exports: NEW_LIVEOPS_CALENDAR_ECO (N), RM/NS reference workbooks + csv
sqls/         Athena queries (one per data_* sheet) + the Python Sheets-export step
design_pdfs/  game-design PDFs (DRBL* = Dream Blast events, NEST* = related events)
source_docs/  per-source game-mechanics reference (.md, one per event)
archive/      superseded versions (engine v1, old builders/xlsx) — never extend these;
              archived scripts keep their old flat-root paths and won't run as-is
```

All scripts anchor their paths to their own file location, so run them from anywhere (commands below assume the root). The artifacts are:

- **Google Apps Script** (`engine/`) — the simulation engine, edited locally and pasted into the Apps Script project of a Google Sheets workbook. **Current engine: `EcoGainsSim_v4.gs`** (custom functions `ECOGAINS_SIM(payer, segment)` / `ECOGAINS_DIFF(payer, segment)`, each spilling 25 categories × 11 resources). Companions in the same Apps Script project: `EcoGainsSim_Daily.gs` (per-day 33-row view, `ECOGAINS_DAILY`), `EcoGainsSim_PBP.gs` (play-by-play session sim, `ECOGAINS_PBP`/`_EVENTS`/`_PROFILE` — see SIMULATION_METHODOLOGY §14), `SimPerSegmentFill.gs` (menu-run filler for the 'Sim per Segment' rollup), `calParseTest.gs` (calendar-parser verification). `archive/EcoGainsSim.gs` is the superseded v1 — don't extend it.
- **Athena/Trino SQL** (`sqls/`) — queries against schema `abgbproduction_174525b3_gdpr` that produce the `data_*` sheets the engine reads. Each file is named after the sheet it feeds (`data_seg_beh.sql`, `data_event_inst.sql`, `data_event_accrual.sql`, `data_event_kite_accrual.sql`); `resource_share_by_category_period_v2.sql` produces `data_gains`. Exception: `sqls/daily_gains.sql` is actually **Python** despite the extension — the notebook export step that pushes the query dataframes into the workbook's `data_*` sheets via the Sheets API, and the authoritative source for every `data_*` column's meaning (its `HEADER_NOTES` dict).
- **Excel exports** (`workbooks/`) — Google Sheets workbooks exported for reference. The workbook of record is the **highest-numbered `workbooks/NEW_LIVEOPS_CALENDAR_ECO (N).xlsx`**. Sheets-native `LET`/dynamic-array formulas do NOT recalc in Excel/openpyxl; only cached values survive (as `__xludf.DUMMYFUNCTION`).
- **Python builders** (`builders/_build_*.py`, openpyxl) — generate the display-sheet xlsx files in `display/` (`EcoGainsSim_HC_v4`, `EcoGainsSim_Daily`, `EventReach_v1`, `EventReach_LB_v1`, `Sim_per_Segment_v2`, `EcoGainsSim_PlybyPly_v5`) which are then imported into the Google workbook. Regenerate by editing the script and re-running it — never hand-edit the xlsx. Superseded builder/xlsx versions live in `archive/`: when a new version supersedes a builder, move the old one there.
- **PDFs** (`design_pdfs/`) — game-design docs per event (DRBL* = Dream Blast events, NEST* = related events).
- **Markdown context docs** — the authoritative project state (see reading order below). Per-source game mechanics live in `source_docs/`.

## Reading order for any task touching the simulation

1. `HAND_OFF.md` — project history and rationale (describes the v1-era state; code details there are superseded).
2. `SIMULATION_PLAN.md` — per-source specs + decisions log D1–D15.
3. `SIMULATION_METHODOLOGY.md` — **reflects the code as shipped** (v4 engine vs workbook v5): calendar/cadence/duration/segmentation machinery, leaderboard vs streak vs milestone families, recalc plumbing, zero-semantics debugging table, verification workflow.
4. `source_docs/` for the mechanics of whichever event you're touching, then the code. Its `README.md` has the per-source index (doc quality per event) and the consolidated open questions / data conflicts (TaD zero-reward ladder, Core/Saga nerf scaling, Flash Race SPT, etc.).

## Commands (offline verification — run before shipping engine changes)

```
python harness/_dump_mockdata.py # regenerate harness/_mockdata.json from the highest-numbered workbook (run after every re-export)
node harness/_mock_run.js        # end-to-end EcoGainsSim_v4.gs over _mockdata.json (mock SpreadsheetApp): all segments, per-source results + release-gate checks
node harness/_mock_daily.js      # same for EcoGainsSim_Daily.gs
node harness/_mock_pbp.js        # same for EcoGainsSim_PBP.gs (~20 checks incl. determinism + calibration)
python builders/_build_hc_v4.py  # rebuild a display xlsx into display/ (same pattern for the other _build_*.py)
```

`harness/_mockdata.json` is a dump of the live workbook's sheets (values + merges). The Kite row is the canary: it must shrink (D≈0.32 from the 7→3 duration cut) — if it shows "no change", calendar parsing fell back to carry-measured.

## The big picture

The goal: a per-segment, per-resource simulation comparing the CURRENT calendar (`cal_curr`, measured) vs a REDESIGNED calendar (`cal_new`) over a 33-day window.

**Core model** — for each anchored event source, per resource:
`SIMULATED = measured × R × D × T`

- **R** = reward-config ratio (v2 ladder / base). Only Saga and Daily Gift have R≠1; all event `_v2` configs changed only `EventDuration`.
- **D** = duration multiplier from the accrual curves (`data_event_accrual`; Kite has its own score-based curve in `data_event_kite_accrual`). Leaderboard events pin D=1 (rank payouts are end-state). Shortening = reliable interpolation; lengthening = flagged extrapolation.
- **T** = cadence × reach ratio across calendar instances, using weekday/weekend active rates from `data_seg_beh`.
- Always-on sources (Core/Saga, Daily Gift): D=T=1. Unlisted categories are **carried** (= measured, diff 0). Rainbow Maker is new (no measured anchor) → bottom-up survival-weighted milestone reach from `data_RM`. River Rush has no `cal_new` instances → 0 (removal semantics). Night Sky's bottom-up sim exists but is **unwired/on hold** — currently carried.

**Data flow:** SQL queries → `data_*` sheets in the live workbook (headers on row 1, data from row 2) → `EcoGainsSim_v4.gs` reads them plus the visual calendar grids, all LIVE at recalc (decision D12: no numbers in code) → spills per segment block in `EcoGainsSim_HC`.

**Calendar reader rule (subtle, verified):** in `cal_curr`/`cal_new` each MERGED range = one instance (duration = column width); each filled non-merged cell = one 1-day instance; neighbours are never collapsed. Day = column − 1; calendars start Wednesday, so weekend = `((day−1) % 7) ∈ {2,3,4}`.

**Segments (decision D8):** raw buckets in `data_gains` (`A. 0` … `F. 100+`) vs merged labels elsewhere (`0-9`, `10-19`, …) — `SEG_TO_GAINS` maps `'0-9' → 'B. 1-9'` (NOT a merge of A.0∪B.1-9). `A. 0` is an appendix block: carried except config-only changes; RM and NS not applied. A label mismatch is the prime suspect whenever a whole segment table reads zero. `data_gains` only emits amount>0 rows, so a missing row is a legitimate measured 0 — most events pay boosters, not HC; check non-HC columns before calling a source dead.

## Apps Script gotchas (learned the hard way)

- **All `.gs` files share one global namespace.** A test file re-declaring `parseCalendarInstances_` once silently overrode the engine's parser. Helper/test files must define no duplicate names.
- Custom functions sometimes can't read merges → menu **EcoGainsSim ▸ Precompute calendars** writes parsed instances to a hidden `cal_parsed` sheet, which the engine prefers. Re-run after editing merges (merge edits fire no `onEdit` trigger; value edits are caught by `AUTO_REFRESH`).
- Google only re-runs a custom function when its ARGUMENTS change; `AUTO_REFRESH = true` + the `onEdit` trigger re-touch the formulas after input-sheet edits.

## Related but separate work in this folder

- `NS_Economy_Sim_Summary.md` — Night Sky (daily streak event) HC simulation; different workbook (`1_DAY_NS_TD_5_Segs_V3`), different model (streak-percentile milestone reach).
- `Event_Eco_Investigation_Context.md` — the May 2026 free-HC source investigation: segmentation definitions, standard filters (geo NOT IN ('FI','PL'), orphans exclusion, max_level > 200, 0–9999 amount cap), and findings. Reuse its conventions for any new economy SQL.
- `spreadsheet_style_and_river_rush_context.md` — spreadsheet style rules and River Rush event design.

## Conventions (strict — from HAND_OFF.md §9 and the style doc)

- **HC = coins only.** The 11-resource column order is fixed; column changes are append-only.
- Zero formula errors is a release gate. Real data only in cells labelled "(data)"; loudly flag every assumption.
- Formulas reference data sheets — never bake static values into sheets or code. If a value is computable from inputs, compute it.
- **SQL:** compose via the incremental Python generator pattern (labelled string blocks → validate → write file); separate `.sql` files, never edit SQL in place; read all referenced project files before writing SQL. Athena gotchas: cast `processdate` to INT for partition pruning; `client_events` currency amounts have a 0–9999 cap that silently zeroes large grants (derive HC from `player_daily.hc_gain`); no `COUNT(DISTINCT)` inside a window; `ARBITRARY()` is non-deterministic; Night Sky is logged as *Dream Heist*; `event_tokens` is a MAP on the level-summary view.
- **Simulation sheets:** Arial, no gridlines, no frozen panes; palette #CFE2F3 data / #E2EFDA sim / #FFF2CC input.
- **Design/config sheets (Ph style):** never merge cells; everything starts at column A; 0 (not blank) for empty numeric cells; punch-card rule — include ALL in-game currency columns even when unused (zeros); conditional formatting (not static fills) for value-driven styling; zebra-stripe at the logical group level.
- Communication: terse, implementation-over-questions; make defensible choices and flag them.
- Before entering plan mode or writing any plan, ask me clarifying questions in batches until ambiguity is resolved — aim for 10–15 questions across multiple rounds if needed. Do not assume defaults for anything I haven't specified. Prefer asking over guessing.
