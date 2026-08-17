# Prompt — variant-only re-pull of the simulation input sheets (21-day A/B window)

Paste this to the query LLM **together with the LiveOps v2 A/B test export notebook** (the one that
built `resource_gains_by_segment`, `resource_spend_by_segment`, `liveops2_ab_daily_metrics`,
`ab_denominators`, `ab_player_dist` and pushed the `data_*` sheets to the calendar workbook), so it
reuses the same cohort, arm assignment, segmentation, cleaning and Sheets-push step.

---

You built my LiveOps v2 A/B export notebook and the `data_*` sheets that feed my economy simulation.
I need those simulation input sheets **re-pulled on a variant-only basis over the live A/B window**,
plus three new sheets. Same schemas, same push step, new numbers.

## Why (one paragraph, then the spec)

The `data_*` sheets currently in the workbook are a pre-test snapshot covering both arms. My
simulation uses them as its measured anchor and then prices config changes against them, which means
it can only ever answer "v2 vs the old world". The variant is now live and I want to price the *next*
set of changes on top of it — so the anchor has to become the variant itself, measured over exactly
the window the test has been running.

## Non-negotiables

1. **A/B test filter on, `ab_group = 'Variant'` only.** Every row in every sheet below. No Control,
   no blended, no "all players". If a grain cannot be restricted to the variant cohort, stop and tell
   me rather than widening it.
2. **Window: `2026-07-27` … `2026-08-16` inclusive — 21 days.** The same window in every sheet. Where
   a sheet has a day index, `day_index = 1` is `2026-07-27` and `day_index = 21` is `2026-08-16`.
3. **Inherit every filter and data fix from the LiveOps v2 A/B export notebook, verbatim.** Cohort
   and arm assignment, geo exclusions, orphan handling, the `max_level` floor, the single-transaction
   amount cap, the free-vs-paid convention, the corrected (de-duplicated) Rainbow Maker series, the
   `source_detail` → category mapping including the renames, and anything else it does — including
   steps that live outside the SQL. Do not improve, simplify or modernise any of them. If a rule
   looks like a bug, apply it anyway and tell me separately. If you cannot tell how something was
   cleaned, **ask me — do not pick a default.**
4. **Column names and order must not change.** My engine reads these sheets by header name, so a
   renamed or reordered column silently zeroes a whole source. Keep every column that exists today
   even if it is unused, and keep the exact spelling.
5. **Segment labels keep their two existing conventions** — `data_gains` uses `A. 0`, `B. 1-9`,
   `C. 10-19`, `D. 20-39`, `E. 40-99`, `F. 100+`; every other sheet uses `0-9`, `10-19`, `20-39`,
   `40-99`, `100+`. Do not harmonise them. `A. 0` appears only in `data_gains`, as today.
6. **Push to the sheets, same as today** — reuse the notebook's Sheets-API export step with the same
   `HEADER_NOTES` behaviour, writing to the workbook ID I will give you (a new copy of the calendar
   workbook, not the current one). Headers on row 1, data from row 2, one sheet per result set,
   sheet cleared before write.

## Part A — the nine existing sheets, variant-only, 21 days

Same schema and grain as the versions currently in the workbook. For the avoidance of doubt, the
columns I read are:

| sheet | columns (exact) |
|---|---|
| `data_gains` | `engagement_segment, payer_flag, resource, unit, category, resource_earners, recipients, recipient_rate_pct, pct_of_resource_pool, mean_share_all_earners_pct, category_amount, resource_pool_amount, amount_per_earner, amount_per_recipient` |
| `data_seg_beh` | `segment, payer_flag, seg_rank, unique_players, player_days, dau, payer_rate_pct, active_days_mean, active_days_p25, active_days_p50, active_days_p75, active_days_p90, weekday_active_rate, weekend_active_rate, mon_active_rate, tue_active_rate, wed_active_rate, thu_active_rate, fri_active_rate, sat_active_rate, sun_active_rate, login_streak_mean, login_streak_p50, login_streak_p75, login_streak_p90, sessions_per_active_day, saga_completes_per_active_day, levels_played_per_active_day, levels_completed_per_active_day, minutes_per_active_day, daily_gift_claim_rate_pct, gift_hc_free_per_active_day, daily_max_streak_mean, daily_max_streak_p50, daily_max_streak_p75, daily_max_streak_p90` |
| `data_event_inst` | `event_name, payer_flag, segment, seg_rank, n_instances, active_window_player_instances, avg_participants_per_instance, participation_rate, opt_in_rate, recipient_rate, position_p25, position_p50, position_p75, avg_final_token_balance, avg_bots, final_balance_p25, final_balance_p50, final_balance_p75` |
| `data_event_accrual` | `event_name, payer_flag, segment, seg_rank, event_day, instance_length_days, n_instances, n_participants, cum_token_share_mean, cum_token_share_p50, cum_token_share_p25, cum_token_share_p75, cum_levels_share_mean` |
| `data_event_kite_accrual` | same columns as `data_event_accrual`, Kite Festival only |
| `data_RM` | `segment, payer_flag, avg_matchables_window, p10_matchables_window, p25_matchables_window, p50_matchables_window, p75_matchables_window, p90_matchables_window` |
| `data_streaks` | `segment, payer_flag, seg_rank, players, player_days, attempts_per_day_mean, wins_per_day_mean, win_rate_mean, max_streak_per_day_p25, max_streak_per_day_p50, max_streak_per_day_p75, max_streak_per_day_p90, mean_streak_len, p_continue_after_win` |
| `data_econ` | `segment, payer_flag, currency, gain_per_active_player, spend_per_active_player, net_per_active_player, resource_earners, gain_per_earner, spend_per_earner, net_per_earner, gain_p25, gain_p50, gain_p75, gain_p90, spend_p25, spend_p50, spend_p75, spend_p90, net_p25, net_p50, net_p75, net_p90` |
| `data_econ_daily` | `segment, payer_flag, currency, day_index, gain_total, spend_total, resource_earners, gain_per_earner_day, spend_per_earner_day, net_per_earner_day` |

Notes on specific sheets, because the window change bites differently in each:

- **`data_gains`** — `amount_per_earner` must now be "per earner over the 21-day window", not over
  the old window. Keep emitting only rows with amount > 0 (a missing row is a legitimate zero to me).
  Keep all 13 resources (`HC, Slingshot, Shuffle, Comet, Red, Chuck, Bomb, UL Bomb, UL Chuck, UL Red,
  Unlimited Lives, SPT, SPTx2`) and the 25 categories, including the ones that pay nothing.
- **`data_seg_beh`** — every rate is over the 21 days. `weekday_active_rate` / `weekend_active_rate`
  keep the existing weekend definition (Fri/Sat/Sun) because my calendar reader assumes it.
- **`data_event_inst` / the two accrual sheets** — restrict to instances that ran **inside** the
  window. Where an instance straddles the window edge, drop it rather than pro-rating, and tell me
  how many you dropped per event. `event_day` stays 1-based within the instance.
- **`data_econ_daily`** — 21 `day_index` values, not 33.
- **`data_streaks`** — `max_streak_per_day_*` is the in-day win-streak distribution, unchanged in
  definition; it is the axis my Night Sky model runs on.

## Part B — three new sheets (the blind spots)

These are the three things the current export structurally cannot answer, and each one currently
forces the simulation to guess.

### `data_core_spt` — season-pass tokens from level completion

The single largest token faucet in the game is invisible to the resource ledger, so my sim
synthesises it from behaviour × an assumed reward table. Please measure it instead.

`segment, payer_flag, player_days, levels_completed_total, levels_completed_per_active_day,
spt_from_level_completes_total, spt_per_level_completed, spt_per_active_player_day`

and, if the difficulty tier of a completed level is available, the same split by tier:
`difficulty_tier` ∈ {`Normal`, `Hard`, `Extreme`} with `levels_completed_total`,
`spt_from_level_completes_total`, `spt_per_level_completed` per tier. If the tier is not derivable,
say so explicitly rather than bucketing by guesswork — I will keep using an assumed mix and I need to
know that is what I am doing.

### `data_spend_action` — the coin sink

The gains side is fully modelled and the spend side is not modelled at all, which makes every
"give players more coins" conclusion untestable.

`segment, payer_flag, resource, action, spend_context, spend_events, spender_days,
amount_spent, amount_spent_free, amount_spent_paid, spend_per_event,
amount_per_active_player_day, pct_of_resource_spent`

Same `action` / `spend_context` vocabulary as the A/B spend export (`extra_moves`,
`purchase_lives`, `purchase_powerup`, `purchase_pre_level_booster`, `level_movesplus5` …). Keep
`extra_moves` split by its move-count context, because the price ladder is the thing I want to look
at.

### `data_ns_rounds` — Night Sky round delivery

My model prices Night Sky by a survival curve over daily win streaks, and comparing it against the
round-completion figures in the A/B summary shows it is wrong by ×1.4–2.8 in both directions. The
measured claim rate is the calibration target.

`segment, payer_flag, round, cum_streak_req, claims_total, player_days,
claim_rate_per_player_day, players_finished_pct, hc_granted_total, hc_per_claim`

with one row per (segment × payer × round 1…3). Two definitional points, because the A/B summary
currently carries both and they disagree at `100+`:

- `claim_rate_per_player_day` = claims ÷ player-days in the window (the daily-frequency measure).
- `players_finished_pct` = share of the segment's players who completed that round **at least once
  inside the window** — please make the "inside the window" part explicit, since the existing
  `R3 finished (%)` figure looks like it may be lifetime.

If those two cannot be made consistent, tell me which one the existing summary's
`R1/R2/R3 finished (%)` rows actually are.

## What I will do with it

Drop the sheets into a fresh copy of the calendar workbook, point the simulation's anchor at the
variant, and price a new set of config changes against it. So the thing that matters most is not
precision — it is that these sheets are on **exactly** the same cohort, cleaning and window as each
other, and that the column names are unchanged.

## Please tell me, in your reply

1. Row counts per sheet, and for `data_gains` the count by `engagement_segment`.
2. Any instance dropped at the window edge, per event.
3. Anything you had to define rather than inherit, and what you chose.
4. Whether the level-difficulty tier and the two Night Sky definitions above were available.
