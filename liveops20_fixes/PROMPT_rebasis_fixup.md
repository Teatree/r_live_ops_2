# Prompt — finish the re-basis: the last drop moved only part of the notebook

Paste this to the query LLM together with the export notebook, as a follow-up to the
"re-base every simulation input query on the A/B summary's population" request.

---

Your latest drop applied the re-basis to **some** queries but not all, so the sheets now describe
two different populations and the drop cannot be used: my engine joins sheets by
(segment, payer_flag) inside single formulas, and a `data_gains` anchor on one population times a
`data_seg_beh` reach on another is silently wrong everywhere.

What I measured in the drop:

- **Correctly re-based** (keep this basis exactly): `data_gains`, `data_econ`, `data_econ_daily` —
  new population with the appended `player_days` / `active_players_day` columns. `data_gains`
  validates: C. 10-19 `player_days` = 121,963 = `Raw_Data_Period`'s, and HC per player-day = 80.0
  vs the summary's free-HC 84.75-total/79.05-free (+1.2% on free). Do not regress these.
- **Still on the old filtered cohort**: `data_seg_beh` (17.9k players, `active_days_mean`
  7.95/8.78 — unchanged from the previous drop), `data_RM`, `data_event_inst`,
  `data_event_accrual`, `data_event_kite_accrual` (byte-identical values to the previous drop),
  and `data_streaks` (player-days still tie to the old cohort).
- **The reference file too**: `data_gains_ab_summary` still carries the old cohort
  (`segment_player_days` 10-19 = 115,585/30,952 = the old `data_seg_beh`), which is why my loader's
  tie-check reads 31% off against the new `data_gains`.
- **The payer split diverged**: `data_econ` 10-19 has 1,891 PAYER HC-earners vs `data_seg_beh`'s
  3,452 payers. The previous drop had these in 99.7% agreement, so the moved and unmoved sheets
  are now also using different `payer_flag` conventions.

## Fix

1. Re-issue **on exactly the population and bucketing the new `data_gains` uses** (every
   window-active Variant player, A/B-summary rules, in-period `avg_completions_7d` buckets):
   `data_seg_beh`, `data_streaks`, `data_RM`, `data_event_inst`, `data_event_accrual`,
   `data_event_kite_accrual`, `data_core_spt`, `data_spend_action`, `data_ns_rounds`.
2. **One `payer_flag` definition across every sheet in the drop** — the one the new
   `data_gains`/`data_econ` use. State the definition explicitly in your reply.
3. Rebuild `data_gains_ab_summary` (and `_wide`) on the same basis, so the reference describes the
   same population as the sheets it checks.
4. Everything else as before: same schemas, column names and order (append-only), NONPAYER/PAYER
   split with no blended rows, Variant arm only, window 2026-07-27…2026-08-16, same push step.

## Validation (include the numbers in your reply)

- Per bucket: Σ HC gain totals ÷ Σ `player_days` within ~5% of `Raw_Data_Period`'s
  `avg_hc_gain_total` (Variant).
- `data_seg_beh` player-days per bucket = `Raw_Data_Period`'s `player_days` per bucket.
- Head counts agree across sheets: the same (segment, payer_flag) cell has consistent player
  counts in `data_seg_beh`, `data_streaks`, `data_econ` and `data_gains_ab_summary`.
- `data_gains` HC totals tie to the rebuilt `data_gains_ab_summary` within 1%.

If any of these cannot be met, say which rule forces the difference — do not adjust numbers to fit.
