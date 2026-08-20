# Prompt — re-base every simulation input query on the A/B summary's population

Paste this to the query LLM **together with the same LiveOps v2 A/B export notebook** as before
(the one that produced the current `data_*` sheets and the `LiveOps_v2_AB_Summary` export), so it
can reuse the arm assignment, bucketing and Sheets-push steps.

---

You built the `data_*` sheets feeding my economy simulation and also the `LiveOps_v2_AB_Summary`
export. Reconciling the two showed they describe **different populations**: the summary's
`Raw_Data_Period` counts every window-active player per bucket, while the `data_*` sheets keep only
the filtered sim cohort (max-level floor, orphan exclusion, etc.) — for the 10-19 bucket that is
45k players averaging 2.7 active days vs 18k earners averaging 8. I want **every query in the
notebook that feeds a `data_*` sheet re-issued so the two sources describe the same players**.
Same schemas, same push step, new basis.

## What changes (apply to ALL `data_*` queries consistently)

1. **Population = the A/B summary's.** Every Variant-arm player active in the window qualifies —
   drop the sim-only eligibility rules (the `max_level` floor, orphan exclusion, and any other
   filter the summary export does not apply). Keep the geo/cleaning rules the summary itself uses.
   One shared population definition across every sheet in the drop.
2. **Segment assignment = the A/B summary's.** Bucket players by the same in-period
   `avg_completions_7d` logic and windows `Raw_Data_Period` uses, so a player lands in the same
   bucket in both sources. Keep each sheet's existing label convention (`B. 1-9` style in
   `data_gains`, `10-19` style everywhere else).
3. **HC cleaning = the A/B summary's.** Use its correction/exclusion rules (excluded-player logic,
   over-config/cap handling) instead of the sim pipeline's own, so corrected HC means the same
   thing in both sources.
4. **Make per-player-day rates derivable, append-only.** Keep every existing column — name, order
   AND meaning (per-earner columns stay per-earner). Where a sheet does not already carry both the
   raw total and the player-days of its (segment, payer) cell, append a `player_days` column at the
   end (`data_econ`, `data_gains`); in `data_econ_daily` append that day's active player count
   (`active_players_day`). Do not change what any existing column divides by.

## What does NOT change

- **Variant arm only, window `2026-07-27` … `2026-08-16` (21 days)**, `day_index` 1 = 2026-07-27.
- **NONPAYER / PAYER split on every sheet, exactly as today. No blended rows** — I compare against
  the summary's blended numbers by summing totals over the payer split myself.
- **Column names and order** — my engine reads by header; renames or reorders silently zero a
  source. New columns are appended after the last existing one only.
- The Sheets push step, sheet names, and header conventions.

## Validation (include the check in your reply)

For each bucket: Σ HC gain totals (both payer rows) ÷ Σ `player_days` must land within a few
percent of `Raw_Data_Period`'s `avg_hc_gain_total` for the Variant arm (e.g. ~84.7 for
`C. 10-19`). Report the per-bucket comparison; if any bucket is off by more than ~5%, tell me
which rule still differs rather than adjusting numbers to fit.

If any instruction conflicts with how the notebook currently works, ask — do not pick a default.
