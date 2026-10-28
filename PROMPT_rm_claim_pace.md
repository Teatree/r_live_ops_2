# Prompt — when Rainbow Maker rewards are CLAIMED inside an instance, `data_rm_pace`

Paste this to the analytics LLM **together with `sqls/event_accrual_curve_31d_v2.sql` and
`sqls/data_seg_beh.sql`**, which it wrote: this is the same cohort, segmentation, filters and
event-instance logic, with one new measure (rewards CLAIMED, not tokens collected).

---

You wrote my `event_accrual_curve_31d_v2` query (pasted below). Its `Milestone` rows are Rainbow
Maker (asset bundle `event-milestone`, configuration `Milestone`). They tell me how fast players
COLLECT matchables inside an instance. I now need how fast they CLAIM REWARDS, because the two are
not the same: the milestone ladder is front-loaded (the first rungs are cheap), rewards are claimed
manually (`manualRewardClaiming = true`), and my calendar now cuts Rainbow Maker instances at both
ends of a 28-day window. For an instance whose first day is inside the window and whose second day
is outside it, I need to know what share of that instance's rewards a player of each segment has
already claimed by the end of its first day.

## 1. Purpose

One curve per (segment, payer_flag, instance length): the cumulative share of Rainbow Maker reward
value claimed by the end of each day of the instance. I use it to put the right share of a clipped
instance inside my window, and to place Rainbow Maker rewards on the right days of my daily view.

## 2. Instances

- Every Rainbow Maker (`Milestone`) instance that **ended** in the last 60 complete days
  (`processdate` ≤ yesterday). Instance identity, start and end exactly as
  `event_accrual_curve_31d_v2` derives them.
- `instance_length_days` = calendar dates the instance spans, exactly as that query computes it (a
  4-day event that spans 5 dates is 5).
- **Both lengths matter.** The calendar is moving from 4-day to **2-day** Rainbow Maker instances.
  If any 2-day instance has run, its rows are the ones I need most. If none has run yet, say so
  explicitly in the notes and deliver the longer instances only. Do not synthesise a 2-day curve.
- `instance_day` = 1 on the instance's start date, 2 on the next calendar date, and so on.

## 3. Cohort and segmentation

Identical to `data_seg_beh` and `event_accrual_curve_31d_v2`: the modal 7-day saga play-rate tier
(`0-9`, `10-19`, `20-39`, `40-99`, `100+`; same CASE, same thresholds, same modal rule), lifetime
`payer_flag`, the standard filters (geo NOT IN ('FI','PL'), orphans excluded, max_level > 200). No
`A. 0`. **Participants only**: a player counts for an instance if they collected ≥ 1 matchable in it.

## 4. Output schema — one row per (segment, payer_flag, instance_length_days, instance_day, resource)

| column | meaning |
|---|---|
| `segment` | as §3 |
| `payer_flag` | `NONPAYER` / `PAYER` |
| `instance_length_days` | as §2 |
| `instance_day` | 1..`instance_length_days` |
| `resource` | `ALL` (coin-equivalent value, see below), then one row per reward resource the ladder pays: `HC`, `SPT`, `SPTx2`, `Red`, `Chuck`, `Bomb`, `Slingshot`, `Shuffle`, `Comet`, `Unlimited Lives`, `UL Red`, `UL Chuck`, `UL Bomb` |
| `n_instances` | instances behind the row |
| `n_participants` | distinct (player, instance) pairs behind the row |
| `cum_claimed_share_mean` | mean over participants of: amount of `resource` claimed from this instance by the END of `instance_day` ÷ total claimed from this instance by its end. Participants who claimed 0 of this resource in the instance are excluded from that resource's mean (state how many) |
| `cum_claimed_share_p25`, `_p50`, `_p75` | the same share, percentiles over participants |
| `cum_pooled_share` | Σ claimed by end of day ÷ Σ claimed in total, pooled over all participants (the cohort's share, which is what I actually use) |
| `cum_milestones_claimed_mean` | mean count of milestones claimed by end of day |
| `cum_matchables_share_mean` | mean share of the instance's matchables collected by end of day (should reproduce your `cum_token_share_mean`; it is the cross-check) |
| `claimed_after_end_share` | share of the instance's rewards claimed AFTER its last day (late manual claims), on the last-day rows only, else blank |
| `status` | `MEASURED` |

For `resource = ALL`, value each claimed reward at the coin-equivalent prices in the attached
`item_vals` row (HC = 1); if you cannot attach it, emit `ALL` as the HC-only share and say so.

The last `instance_day` must read `cum_pooled_share = 1` for every group unless
`claimed_after_end_share` > 0 (then `1 − claimed_after_end_share`). Check it and report any group
that fails.

## 5. Reconciliation (run it, report the numbers)

1. `cum_matchables_share_mean` on the 5-date instances reproduces the `Milestone` rows of
   `event_accrual_curve_31d_v2` within ±0.02 per (segment, payer_flag, day).
2. Total HC claimed from Rainbow Maker over the instances, per earner, is within ±5% of the
   `Rainbow Maker` HC row of `resource_share_by_category_period_v2` over the same dates.
3. Day 1's `cum_pooled_share` for `ALL` per segment: one line each, so I can see the front-loading.

## 6. Deliverables

- The query, composed in labelled blocks like your earlier ones, as `sqls/data_rm_pace.sql`.
- The result as a sheet named exactly `data_rm_pace`, headers exactly as §4, data from row 2.
- Notes: instance count per length, whether any 2-day instance exists, the reconciliation numbers,
  and anything you had to approximate.
