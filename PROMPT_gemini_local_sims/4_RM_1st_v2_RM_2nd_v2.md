Edit only sheets `RM_1st_v2` and `RM_2nd_v2`, only cells `AI1:AS23`. Formulas only — no Apps Script, no
typed numbers in computed cells, no LAMBDA / BYROW / BYCOL / MAP. Read `RM_1st` / `RM_2nd` (the old
configs) but never edit them. **Replace the whole current block** — it reads `data_RM`; nothing may
reference `data_RM` any more.

Pairs: `RM_1st_v2` (new) vs `RM_1st` (old); `RM_2nd_v2` vs `RM_2nd`. Below, "old sheet" = the pair's old one.

**Inputs:** `AI2` `Percentile` / `AJ2` dropdown `Avg, p10, p25, p50, p75, p90`; `AI3` `Payer` / `AJ3`
dropdown `NONPAYER, PAYER`; `AI4` `Config` / `AJ4` dropdown `RM_1st, RM_2nd` — `RM_1st` on `RM_1st_v2`,
`RM_2nd` on `RM_2nd_v2`. `AL3` = `Milestones read`, `AM3` =
`=IFERROR(MATCH(TRUE,INDEX(NOT(ISNUMBER($A$16:$A$45)),0),0)-1,ROWS($A$16:$A$45))`.

**Days:** new duration `$B$3`, old duration = old sheet `!$B$3`. Day cells `AI6:AI12` and `AI17:AI23` =
1…7, blank past `MAX(new, old)`. A day > new duration is a **grey day**: show only the old number, and grey
the whole row (`#999999`) with conditional formatting `=AND(ISNUMBER($AI6),$AI6>$B$3)` on `AI6:AS12`
(same with `$AI17` on `AI17:AS23`).

**Score on day d = matchables.** Use exactly this (segment `0-9`, day cell `$AI17`; change the segment
literal per column, the day cell per row, and `RM_1st!$B$3` to `RM_2nd!$B$3` on `RM_2nd_v2`):

```
=ARRAYFORMULA(IF($AI17="","",LET(seg,"0-9",hdr,data_rm_pace!$1:$1,tbl,data_rm_pace!$A:$ZZ,
 seg_c,INDEX(tbl,0,MATCH("segment",hdr,0)),pay_c,INDEX(tbl,0,MATCH("payer_flag",hdr,0)),
 len_c,INDEX(tbl,0,MATCH("instance_length_days",hdr,0)),day_c,INDEX(tbl,0,MATCH("instance_day",hdr,0)),
 res_c,IFERROR(INDEX(tbl,0,MATCH("resource",hdr,0)),"ALL"),cfg_c,IFERROR(INDEX(tbl,0,MATCH("rm_config",hdr,0)),""),
 ok0,(seg_c=seg)*(pay_c=$AJ$3)*(res_c="ALL"),ok,IF(SUM(ok0*(cfg_c=$AJ$4))>0,ok0*(cfg_c=$AJ$4),ok0),
 len_s,MAX(FILTER(len_c,ok)),old,RM_1st!$B$3,
 dte,IF(AND($AI17>=old,old>=len_s-1),len_s,MIN($AI17,len_s)),hit,ok*(len_c=len_s)*(day_c=dte),
 p25,N(IFERROR(AVERAGE(FILTER(INDEX(tbl,0,MATCH("cum_matchables_p25",hdr,0)),hit)),"")),
 p50,N(IFERROR(AVERAGE(FILTER(INDEX(tbl,0,MATCH("cum_matchables_p50",hdr,0)),hit)),"")),
 p75,N(IFERROR(AVERAGE(FILTER(INDEX(tbl,0,MATCH("cum_matchables_p75",hdr,0)),hit)),"")),
 avg,N(IFERROR(AVERAGE(FILTER(INDEX(tbl,0,MATCH("cum_matchables_mean",hdr,0)),hit)),"")),
 top,MAX(p75,8*avg-2*(p25+p50+p75)),
 p10x,IFERROR(AVERAGE(FILTER(INDEX(tbl,0,MATCH("cum_matchables_p10",hdr,0)),hit)),""),
 p90x,IFERROR(AVERAGE(FILTER(INDEX(tbl,0,MATCH("cum_matchables_p90",hdr,0)),hit)),""),
 p90,IF(ISNUMBER(p90x),p90x,p75+0.6*(top-p75)),p10,IF(ISNUMBER(p10x),p10x,0.4*p25),
 IFERROR(SWITCH($AJ$2,"Avg",avg,"p10",p10,"p25",p25,"p50",p50,"p75",p75,"p90",p90),0))))
```

**Ladders** (same layout on all four sheets): requirement `C16:C45` (Req Accum), rewards `E16:Z45`,
headers `E15:Z15`; the ladder ends at the first row whose column A is not a number (25 milestones on the
`_v2` sheets, 30 on the old ones). `m` = requirements ≤ score. Value of the first `m` rows = Σ amount ×
price; price by header **name** from `item_vals` (names `B2:U2`, prices `B3:U3`; `ToF_Ticket` uses
`ToF_Value`; no match = 0).

**Part A — block `AI1:AS13`:** `AI1` = `Player Reach Simulation (per event day) - old config -> new config`.
`AI5:AS5` = `Day_of_event | 0-9_ms | 0-9_reward | 10-19_ms | 10-19_reward | 20-39_ms | 20-39_reward | 40-99_ms | 40-99_reward | 100_ms | 100_reward`.
- `AJ`, `AL`, `AN`, `AP`, `AR` (rows 6-12): `m_old & " -> " & m_new`; grey day: `m_old`.
- `AK`, `AM`, `AO`, `AQ`, `AS`: text `{Coins: 20, SPT: 65, …}` (summed rewards of the reached milestones,
  zeros omitted) for the new ladder; grey day: the old ladder's.
- `AI13` = `Completes the whole RM`; `AJ13`, `AL13`, `AN13`, `AP13`, `AR13` = `old% -> new%`: per side,
  with the score formula's `p25 / p50 / p75 / top` taken on that side's last day and `x` = that ladder's
  last requirement: `u = IFS(x<=0,0, x<=p25,0.25*x/MAX(p25,1E-9), x<=p50,0.25+0.25*(x-p25)/MAX(p50-p25,1E-9),
  x<=p75,0.5+0.25*(x-p50)/MAX(p75-p50,1E-9), x<=top,0.75+0.25*(x-p75)/MAX(top-p75,1E-9), TRUE,1)`,
  share = `TEXT(1-u,"0.0%")`.

**Part B — new table:** `AI15` = `Player Progression (per event day) - score and value collected so far, old -> new`.
`AI16:AS16` = `Day_of_event | 0-9_score | 0-9_val | 10-19_score | 10-19_val | 20-39_score | 20-39_val | 40-99_score | 40-99_val | 100_score | 100_val`.
- `_score`: the matchables as a number, format `#,##0` (shown on grey days too).
- `_val`: `TEXT(old,"#,##0") & " -> " & TEXT(new,"#,##0")`; grey day: old only.

**Style:** Arial 10; `AI1`, `AI15` bold 11; header rows 5 and 16 bold, fill `#CFE2F3`; `AJ2:AJ4` fill
`#FFF2CC`; formula cells fill `#E2EFDA`; no merges, no borders. Widths: `AI` 14, ms/score 14, reward text
40, val 18.

**Check** on `RM_1st_v2` (`p50`, `NONPAYER`), Part A ms per segment 0-9 / 10-19 / 20-39 / 40-99 / 100+:
- day 1: `0 -> 1`, `4 -> 7`, `8 -> 9`, `11 -> 12`, `14 -> 14`
- day 2: `4 -> 6`, `8 -> 9`, `11 -> 12`, `14 -> 16`, `18 -> 19`
- day 3 (grey): `5`, `10`, `13`, `17`, `21`; day 4 (grey): `7`, `11`, `14`, `19`, `23`
- Part B score day 1 / day 4: `94 / 4,617`, `1,973 / 15,644`, `6,102 / 33,372`, `16,316 / 73,451`, `27,148 / 136,193`

No errors anywhere in `AI1:AS23`. If a check fails, fix the formula, never type the number.
