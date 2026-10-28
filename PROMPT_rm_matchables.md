# Prompt — matchables per participant per LIVE Rainbow Maker instance, a re-pull of `data_RM`

Paste this to the analytics LLM **together with `sqls/event_accrual_curve_31d_v2.sql`,
`sqls/data_seg_beh.sql` and the `data_rm_pace` query it wrote** (same cohort, segmentation, filters
and instance logic). It replaces my `data_RM` sheet, which was built before Rainbow Maker launched.

---

You wrote my `data_rm_pace` query. Its own numbers show that my `data_RM` sheet, the distribution of
matchables a player collects in ONE Rainbow Maker instance, cannot be right: priced on my `RM_1st`
ladder (30 milestones, last `Req Accum` 352,260), `data_RM` puts the average `0-9 NONPAYER`
participant on **14.6** milestones at the end of a 4-day instance, and your
`cum_milestones_claimed_mean` says **5.6**; at `100+ PAYER` it is **27.2** against **21.5**. Every cell
overshoots, by 1.3x to 2.6x in milestones; matching your counts would take about 3x to 13x fewer
matchables. `data_RM` was measured before the event existed (matchables from normal level play
over a 4-day window), so it was never the event's own number. I now need the event's own number.

## 1. Purpose

Per (segment, payer_flag): the distribution over participants of matchables COLLECTED in one Rainbow
Maker instance, measured on the live event. My model walks a player up the milestone ladder with
it (`S(Req Accum)` over these percentiles), so it decides how much of the ladder each segment
reaches and how much a shorter (2-day) instance is worth against a 4-day one.

## 2. Instances

- Every Rainbow Maker (`Milestone`) instance that **ended** in the last 60 complete days, exactly the
  instances behind `data_rm_pace` (same identity, start and end).
- `instance_length_days` = calendar dates the instance spans, as in `data_rm_pace` (5 for the 4-day
  event). Deliver every length that ran; if a 2-day instance has run, its rows matter most. Do not
  synthesise a length that did not run.

## 3. Cohort and segmentation

Identical to `data_rm_pace`: the modal 7-day saga play-rate tier (`0-9` … `100+`), lifetime
`payer_flag`, the standard filters (geo NOT IN ('FI','PL'), orphans excluded, max_level > 200), no
`A. 0`. **Participants only** (≥ 1 matchable collected in the instance). A participant contributes one
value per instance: matchables collected in THAT instance, from its first to its last date, counted
the way the event counts them (on level wins only, if that is how the event banks them — say which).

## 4. Output schema — one row per (segment, payer_flag, instance_length_days)

Keep my existing column names so the sheet drops in for `data_RM` unchanged:

| column | meaning |
|---|---|
| `segment`, `payer_flag` | as §3 |
| `instance_length_days` | as §2 |
| `n_instances`, `n_participants` | instances, and distinct (player, instance) pairs, behind the row |
| `avg_matchables_window` | mean matchables collected per participant per instance |
| `p10_matchables_window` … `p90_matchables_window` | percentiles over (player, instance) pairs: p10, p25, p50, p75, p90 |
| `p95_matchables_window`, `p98_matchables_window` | the upper tail |
| `milestones_reached_mean` | mean milestones REACHED per participant per instance (from matchables against the ladder that ran) |
| `share_completing_ladder` | share of participants reaching the last milestone |
| `status` | `MEASURED` |

## 5. Reconciliation (run it, report the numbers)

1. `milestones_reached_mean` against `data_rm_pace`'s `cum_milestones_claimed_mean` at the last
   `instance_day`, per (segment, payer_flag): claims lag progress by under 1% in your pace data, so
   the two must agree within ±0.5 milestones. Report every cell that does not.
2. The ladder the instances ran: its `Req Accum` per milestone (from the event configuration), so I
   can check it against my `RM_1st` / `RM_2nd` sheets. If it changed inside the 60 days, split the
   rows by ladder version and say which dates each covers.
3. One line per segment: p50 and p90 matchables against the ladder's last `Req Accum`.

## 6. Deliverables

- The query, composed in labelled blocks like your earlier ones, as `sqls/data_RM_live.sql`.
- The result as a sheet named exactly `data_RM`, headers exactly as §4, data from row 2 (keep the old
  sheet as `data_RM_prelaunch`).
- Notes: instance count per length, whether matchables bank on wins only, the reconciliation
  numbers, and anything you had to approximate.
