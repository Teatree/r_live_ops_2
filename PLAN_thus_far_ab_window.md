# Plan — "thus far" on the A/B window: incomplete data, Rainbow Maker's two configs, four album columns

2026-10-29. Not implemented. The data side is `PROMPT_ab_data_refresh.md`.

**Decisions (user, 2026-10-29):**
- **Day 1 = Tue 2026-10-13.** That is the A/B start and the album season start, and it replaces D70's Monday Oct 19.
- **CURRENT = the `Variant A` arm.** `Control` is pulled too, as a measured reference.
- **Season-end estimates are pure model.** The day-N gap between model and data is shown, never applied.
- **Album columns = share of players with ≥ 1 album completed**, weighted by `Variant A` players.

---

## 0. Three numbers every view agrees on

| | value | where it comes from |
|---|---|---|
| **day 1** | Tue 2026-10-13 | a new column for Oct 13, inserted before B on `cal_curr` and `cal_new`. Row 4 is renumbered 1..28 from it (B..AC = Oct 13 → Nov 9), and 2026-10-13 is typed above it in row 1. No code change: D70 already reads the window off row 4, and D76 already reads the date |
| **L** | 28 | the window, which is also the album season (`SEASON_LAST_DAY` = L, D70). The season ends Mon 2026-11-09 |
| **N** | the data-through day (16 on 2026-10-29) | new `dataThroughDay_()`. An authored `Data through` date on `cal_new` wins; otherwise the latest `data_through_date` on the anchor sheets (`data_gains` first); otherwise L, which is today's engine. Clamped to 1..L and logged |

A new `ECOGAINS_PERIOD()` spills day-1 date, N, data-through date, L and season-end date. Every sheet's title row reads it.

**Rule: N is never a window length.** `windowDays_()`, the Rainbow Maker halves, the envelope cut-off, the Season Pass track and the 7-day auto range all keep reading L. If N leaked into any of them, the halves would split at day 8 instead of day 14 and silently mis-assign every Rainbow Maker instance in between. Gated.

## 1. Readers: the arm and each sheet's own dates

**The arm filter.** Every data reader keeps only the rows where `ab_variant` = `ANCHOR_ARM`. The readers are `DataStore`, `econDaily_`, the `data_rm_pace` reader and the `data_col_*` formulas.
- `ANCHOR_ARM` defaults to `Variant A`. An `Anchor arm` label on `cal_new` overrides it.
- A sheet without the column is read whole, which keeps the August sheets working as they do today.

**This must be pasted before any re-pulled sheet.** `DataStore` keys rows on (segment, payer, category, resource), and the last row wins. A two-arm sheet read by today's engine would silently price whichever arm happens to come last. Gate: a two-arm sheet read with the filter must equal the one-arm sheet.

**Each sheet's span.** `window_start_date` and `data_through_date` map to window days [d0, d1].
- A sheet with no dates is treated as pre-test. It supplies shapes only (accrual curves, rank percentiles, streak survival), never levels.
- The run log lists those sheets, so a half-refreshed workbook says which sheets are still August.

**Found on the way: a Night Sky name mismatch.** The card sim's envelope rungs ask `data_event_inst` for `'Night Sky'`, but the sheet calls it `'Dream Heist'`. So Night Sky's envelope participation reads as 1.0. An alias fixes it in the same pass.

## 2. CURRENT thus far is the Variant A data, exactly

**The rescale, generalised.** D71's `windowScale_` maps "export over the whole grid → the window". It becomes "export over its own span [d0, d1] → any target span [a, b]":

`scale = share_cur(a..b) ÷ share_cur(d0..d1)`

The shares are taken on `cal_curr`, per lane family, exactly as D71 does:
- event lanes by reach;
- continuous lanes by Σ p_day;
- Rainbow Maker per resource and per half, by its own walk;
- everything else by Σ p_day.

**Thus far.** The target equals the data span, [1, N], so the scale is 1 and CURRENT thus far is identical to `data_gains`. Gated for every source × resource.

**Balance day, not earn day.** The data counts what reached the balance by day N. So a Kite board that closes on day N, and pays on N+1, is outside "thus far". The 7-day view sums the earn day (D60, your decision) and stays as it is.

**Season.** The target is [1, L], so the scale is share(1..L) ÷ share(1..N), which is at least 1. The header labels it as a projection from N days.

**A source that has paid nothing by day N** (its first instance comes later in the season):
- CURRENT thus far is 0, which is correct.
- But there is nothing to project the season from. Its season anchor falls back to the August export, D71-rescaled as today, and the log marks the cell as prior-anchored. Flag: those numbers were earned under pre-test configs.

**Envelopes, tickets, ToF and the collection rows.** The re-pulled `Variant A` `data_gains` carries them. `PACK_ANCHORED`, `TOF_ANCHORED` and `COL_ANCHORED` then take D61's per-resource Rainbow Maker rule: export × walk_new ÷ walk_cur where the export has a number, synthetic where it is silent. Nothing new to build; each anchor switches on by itself, resource by resource.

**Season Pass coupling.** Tiers reached by day N come from cumulative SPT through N, on both sides. `sptTotals_` and `measuredSptTotal_` take the span, and their caches are keyed on it. This is D62's rule: a value computed in one mode must never land in a cache another mode reads.

## 3. NEW thus far

- `NEW_season = CURRENT_season × R × D × T`. The model is unchanged.
- `NEW_thus_far` = Σ over days 1..N of NEW_season's balance-day placement on `cal_new`.

Two gates hold it together:
- **Identity.** With identical calendars and configs, NEW thus far equals CURRENT thus far, so DIFF is 0 at every N. Gated at N = 1, 7, 16 and 28.
- **Conservation.** N = L reproduces today's full-window numbers bit for bit.

## 4. Daily view (`EcoGainsSim_Daily`)

**Blank past N.** Every block is blank for days after N, and for days before the first data day. `clipGrid_(…, N)` already does this for DATA, SPEND and the NET blocks; it now also covers CURRENT, NEW and DIFF. `DAILY_BLANK_PAST_DATA = false` restores today's full-length sim rows.

**What each block shows on days 1..N:**
- CURRENT summed over days 1..N equals `data_gains` thus far, by construction. Gated.
- DATA is `data_econ_daily_live` (`Variant A`), day by day.
- DATADIFF = DATA − NEW.
- DATA − CURRENT, day by day, is the placement error.

**Alignment.** The live feed's day 1 is Oct 13, which is now window day 1, and the feed carries `calendar_date`. So D76 aligns it with shift 0. D78's +1 lead applies only to feeds without dates. Pre-period rows (`period = 'pre'`) are skipped.

**Builder.** 28 rows. The title row reads `ECOGAINS_PERIOD()` instead of the static "day 1 = Wednesday" text.

## 5. Summary sheets

**`EcoGainsSim_so_far` shows thus far.** Its own A2 already says "the period that we have data for thus far". It gets new `ECOGAINS_SIM_SO_FAR` / `ECOGAINS_DIFF_SO_FAR` functions: same 29 × 20 spill, span [1, N], balance day. `SimFill`'s family rule for the sheet switches to them. The 7-day functions stay for any sheet that wants the Monday window.

**`EcoGainsSim` shows the season.** Pure model, projected from N days, and the header says so.

**`Sim per Segment` shows both.** It gets a thus-far block beside its season block. Its `data_econ` net row becomes `Variant A`'s `data_econ` thus far.

**A validation block** (pure model: shown, never applied):
- **Unanchored lanes.** For the lanes the model prices without data (envelope income per source, ToF, the Rainbow Maker walk, the card sim), the bottom-up `cal_curr` prediction thus far sits beside the `Variant A` data.
- **Control.** The measured `Variant A` − `Control` effect thus far, per source, beside NEW − CURRENT. There is no model of `Control`: its pre-test configs are not in the workbook.
- **A/A check.** The pre-period check (Oct 7–12) shows the two arms were comparable before the test.

## 6. Rainbow Maker's two configs

1. **Which config an instance reads.** `RM_1st` if it starts on days 1..14 (Oct 13–26), `RM_2nd` on days 15..28 (Oct 27 – Nov 9). The split is floor(L/2) of the season, never of N; gated so the assignment is the same at N = 5, 16 and 28. The instance running on Oct 13 started on Mon Oct 12, so it is a start cut-off on `RM_1st` (D72).
2. **The live calendar's instances take their config from the data.** When `data_rm_pace` carries `rm_config`, it wins: `cal_curr` is what actually ran, so the data knows. The half rule applies to `cal_new` and to instances that have not run yet.
   - Watch Oct 26: it is day 14, so the rule says `RM_1st`. If the game actually switched on Oct 26, the data will say `RM_2nd`.
   - In that case the split day becomes an authored `RM 2nd half from day` cell (default floor(L/2) + 1), and the mismatch is logged.
3. **Anchoring per half.** For each half h and each resource:

   `sim_h = export_h × walk_new_h ÷ walk_cur_h`

   This is D61's rule, applied per half.
   - export_h is `data_rm_pace`'s per-instance claimed amounts, reconciled to `data_gains`' Rainbow Maker rows.
   - Both walks cover the same span, each instance on its own half's ladder.
   - Cut-offs at N are priced on the live claim pace (D72/D77). At N = 16, the Oct 26–29 instance is an end cut-off at day 3 of 4 on `cal_curr`.
4. **A half with no data yet.** That is the second half, until an `RM_2nd` instance has run. It is priced by the bottom-up walk on `RM_2nd`, driven by the `RM_1st` instances' live matchables, with no calibration carried over from the first half (pure model). `SPTx2` stays bottom-up until then. Once the data lands, the half is anchored automatically.
5. **The card sim's Rainbow Maker rungs** already go through `rmConfigForInst_`, so they follow the halves with no extra work.

## 7. Album completions: four new columns on `Players completing the album`

Each column shows, per segment × payer, the share of players with at least one album completed, the player count, and population-weighted totals. All four columns use the same weights, `Variant A` players per cell (`data_seg_beh`'s `Variant A` row), so their totals compare directly.

| # | column | how |
|---|---|---|
| 1 | **Actual, thus far** | `album1_completers` and `album1_completion_rate` from `data_col_season`, as of its `data_through_date` (requested; until it arrives, the as-of day is `data_col_daily`'s last `day`). Sheet formulas, as D57 does, so a re-pull shows up without a sim run |
| 2 | **Sim, `cal_curr`, thus far** | card sim over `cal_curr` with the base ladders, `PackConfig`, `AlbumConfig` and `ToF`. Share with `albumPct` ≥ 100 on day N. New `'cur'` side of `SimulateCardCloud`, reusing D67's `baseCtx_` path |
| 3 | **Sim, `cal_new` + new configs, thus far** | `cal_new`, the `_v2` ladders, `PackConfig_v2`, `AlbumConfig_v2` and `ToF_v2`, read on day N |
| 4 | **Sim, `cal_new` + new configs, season end** | the same seasons as column 3, read on day L = 28 (Nov 9) |

- **The `_v2` card configs are not wired today.** The card sim reads only `PackConfig` and `AlbumConfig` (D67 flag). They get wired, with a fallback to the base sheets. Without this, columns 3 and 4 would ignore every album, envelope and ToF config edit.
- **Same seeds on both sides.** Columns 2 and 3 then differ only by calendar and config.
- **Columns 3 and 4 come from the same seasons**, so column 4 ≥ column 3 for every player. Gated.
- **1000 players per cell, with a binomial 90% interval per share.** Completion by day 16 is near zero, and even at season end it is rare (0 to 0.56 albums per player in the current run). A share whose interval reaches 0 prints as "< x%".
- **Attendance** comes from `Variant A`'s `data_seg_beh`, counted over `days_available`. Thus far uses it directly; the season scales it to L, which extrapolates 16 days of attendance to 28 (flagged). This replaces D74d's ×N/33.
- **Pure model.** Column 1 ÷ column 2 is printed as the model check. It is never applied to column 4.
- **The existing column** (all players, end of a 33-day run) shows the same thing as column 4 on a different population and period. I'd retire it once column 4 exists.

## 8. Gates (rules with mutation fixtures; snapshot, mutate, assert, restore)

1. A two-arm sheet read with the filter equals the one-arm sheet. A sheet without `ab_variant` reads as today.
2. CURRENT thus far equals the export, per source × resource, at the data span.
3. Identity: identical calendars and configs give DIFF 0 at N = 1, 7, 16 and 28, for every block, including the collection rows.
4. Conservation: N = L reproduces today's engine bit for bit (`_probe_engine_identity`).
5. The Rainbow Maker half assignment does not change with N. A data `rm_config` overrides the rule only on `cal_curr`.
6. The daily view is blank past N in every block, and summing days 1..N of CURRENT gives the thus-far anchor.
7. An injected ToF SPT row moves the thus-far and season Season Pass tiers identically, whatever the evaluation order (D62's test, with spans).
8. Album: column 4 ≥ column 3 per player. With identical calendars and configs, column 2 = column 3 (common random numbers). The actual column is blank past the last day the pull carries, never 0.

## 9. Your workbook steps, in order

Status checked on LIVE_OPS_V3 (2), 2026-10-29: the column for Oct 13 is inserted on both calendars
and B1 holds 2026-10-13; everything below that is still to do.

1. Row 4 on **both** calendars: 1 in B4 (Oct 13) through 28 in AC4 (Nov 9); clear H4:AI4. While the
   1 sits in H, the engine starts on Oct 19, ignores B1 (it reads the date only above the 1), and
   counts 27 days, because its grid stops at column AH and day 28 is in AI.
2. Row 3 on both: weekday names from B (Tuesday) through AC (Monday). The weekend rule is read from
   the name above the 1.
3. Column B (Oct 13) on both: type what ran that day. The A/B data shows Rainbow Maker, Kite
   Festival, Team Event, Night Sky, the new Season Pass season and ToF paying or running; the weekly
   lanes (Top Players / Top Teams, Season Offers, Flock Flurry) follow their pattern. Check against
   the live schedule.
4. Merge every multi-day instance in B:G on both. They are inside the season now, and Precompute
   has already turned them into 1-day instances (`cal_parsed` in (2) starts Rainbow Maker, Team Event
   and Hatchling with 1-day pieces). From the live data: Rainbow Maker B:D, Kite B:C, Team Event
   B:D, Top Players and Top Teams B:G, Hatchling D:G, Team Race E:G, Mystery Puzzle E:G, Red's
   Challenge C:D. Season Pass (C:AF) and ToF (C:AI) start at C: if both started with the test, they
   begin at B.
5. `cal_new`: B:G is still the live layout and the redesign starts at H (Oct 19). For a 28-day
   redesign from Oct 13, either copy the redesign's Tuesday–Sunday cells (I:N) into B:G, which keeps
   every event on its weekday, or keep B:G as the live layout and accept that days 1–6 compare
   configs only. Columns AD:AI (Nov 10–15) are past the season and are not read once row 4 ends at AC.
6. Run Precompute calendars after the merges.
7. `data_econ_daily_live` is empty, so the daily view falls back to the August sheet and shows
   August days on October rows. Paste `workbooks/data_econ_daily_live_2026-10-26.csv` (the 1,820
   rows of the last delivery, both arms pooled, Oct 13 → Oct 26) as a stopgap until the re-pull.
8. Paste the re-pulled sheets **only after** the §1 engine change is in the Apps Script project.
9. Delete the two stray blocks on `data_seg_beh` (O13:W22, G27:Z37).

## 10. Order of work (one commit each, harness green before the next)

1. Arm and span readers (§1), plus the Night Sky alias.
2. N, `ECOGAINS_PERIOD`, and the span-generalised rescale (§0, §2).
3. Thus-far functions, daily blanking and the `SimFill` rule (§3–§5).
4. Rainbow Maker per-half anchoring and the data-driven config assignment (§6).
5. Card sim sides, the `_v2` card configs, the day-N snapshot and the album table (§7).
6. Docs: `SIMULATION_METHODOLOGY.md`, plus `CLAUDE.md` decisions D79 onward.

Steps 1–5 are built against a fixture dump with fabricated two-arm rows, labelled FAKE and never mixed with a real dump, so the engine is ready when the pull lands.

## Flagged

- Pure-model season estimates extrapolate 16 days of behaviour to 28.
- Sources that have not run by N use August pre-test numbers in the season view, and are marked as such.
- `Control` has no config sheets, so there is no model of `Control`; it is a measured reference only.
- `engine/pre_collection/` (the 13-resource copy) is not touched.
