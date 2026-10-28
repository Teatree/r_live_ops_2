# Rainbow Maker sheets — the local "Player Reach Simulation" on the live matchables

The block at `AI1:AS12` of `RM_1st`, `RM_1st_v2`, `RM_2nd` and `RM_2nd_v2` shows, for the
percentile in `AJ2` and the payer type in `AJ3`, the milestone each segment has reached at the end
of every event day. It used to read `data_RM` (pre-launch telemetry, 3-13x too many matchables) and
scale it linearly by `day / EventDuration`. It now reads the event's own distribution from
`data_rm_pace`: the cumulative matchables per participant at the end of each day of the measured
4-day instances.

**One formula serves all four sheets and all five segment columns.** It reads the segment from the
column's own header (`0-9_ms` … `100_ms`), the event length from the sheet's `B3`, and every
`data_rm_pace` column by its header name, so a re-pull with moved columns needs no edit.

## Paste

Into `AJ6`, then copy `AJ6` to `AL6`, `AN6`, `AP6`, `AR6`, then fill `AJ6:AR6` down to row 12, on
each of the four sheets. Leave the `_reward` columns (`AK`, `AM`, `AO`, `AQ`, `AS`) as they are:
they already turn the milestone count into the reward text.

```
=ARRAYFORMULA(IF($AI6="","",LET(
seg,IF(SUBSTITUTE(AJ$5,"_ms","")="100","100+",SUBSTITUTE(AJ$5,"_ms","")),
hdr,data_rm_pace!$1:$1,
tbl,data_rm_pace!$A:$ZZ,
seg_c,INDEX(tbl,0,MATCH("segment",hdr,0)),
pay_c,INDEX(tbl,0,MATCH("payer_flag",hdr,0)),
len_c,INDEX(tbl,0,MATCH("instance_length_days",hdr,0)),
day_c,INDEX(tbl,0,MATCH("instance_day",hdr,0)),
res_c,INDEX(tbl,0,MATCH("resource",hdr,0)),
ok_r,(seg_c=seg)*(pay_c=$AJ$3)*(res_c="ALL"),
len_s,MAX(FILTER(len_c,ok_r)),
dte,IF(AND($AI6>=$B$3,$B$3>=len_s-1),len_s,MIN($AI6,len_s)),
hit_r,ok_r*(len_c=len_s)*(day_c=dte),
low_q,INDEX(FILTER(INDEX(tbl,0,MATCH("cum_matchables_p25",hdr,0)),hit_r),1),
mid_q,INDEX(FILTER(INDEX(tbl,0,MATCH("cum_matchables_p50",hdr,0)),hit_r),1),
upp_q,INDEX(FILTER(INDEX(tbl,0,MATCH("cum_matchables_p75",hdr,0)),hit_r),1),
avg_m,INDEX(FILTER(INDEX(tbl,0,MATCH("cum_matchables_mean",hdr,0)),hit_r),1),
top_m,MAX(upp_q,8*avg_m-2*(low_q+mid_q+upp_q)),
mat,IFERROR(SWITCH($AJ$2,"Avg",avg_m,"p25",low_q,"p50",mid_q,"p75",upp_q,"p90",upp_q+0.6*(top_m-upp_q)),0),
COUNTIF($C$16:$C$45,"<="&mat))))
```

## What it does — the same rule the engine uses (D77)

- **Day d of the event** reads the measured event's date `d`. The **last day of an event as long as
  the measured one** (4 days) reads the final date, which holds the closing hours. A 2-day event's
  day 2 therefore reads date 2 — "the first two days of the 4-day event", the same-play-rate
  assumption the model always made.
- `Avg`, `p25`, `p50`, `p75` are read directly. **`p90` is derived**: the pull stops at p75, so the
  upper tail runs from p75 to the point where the distribution's mean equals the measured mean,
  `8 x mean - 2 x (p25 + p50 + p75)`, and p90 is 60% of the way along it.
- The count is milestones **reached**. The engine also applies a per-cell claim factor (claiming is
  manual; 5-18% of reached milestones are never claimed at the low segments) — this view does not,
  it shows what a player at that percentile could have claimed.
- `AL2` ("Share of Players who complete the whole RM: 0.325%") is typed text from the pre-launch
  data, not a formula. It is no longer current; delete it or leave it as a note.

## Check after pasting — `p50`, `NONPAYER`, as the sheets stand on LIVE_OPS_V3 (8)

| sheet (`B3`) | day | 0-9 | 10-19 | 20-39 | 40-99 | 100+ |
|---|---|---|---|---|---|---|
| `RM_1st`, `RM_2nd` (4) | 1 | 0 | 4 | 8 | 11 | 14 |
| | 2 | 4 | 8 | 11 | 14 | 18 |
| | 3 | 5 | 10 | 13 | 17 | 21 |
| | 4 | 7 | 11 | 14 | 19 | 23 |
| `RM_1st_v2`, `RM_2nd_v2` (2) | 1 | 0 | 4 | 8 | 11 | 14 |
| | 2 | 4 | 8 | 11 | 14 | 18 |

The old formula showed 14 / 17 / 21 / 26 / 29 on day 4 of the 4-day sheets.
