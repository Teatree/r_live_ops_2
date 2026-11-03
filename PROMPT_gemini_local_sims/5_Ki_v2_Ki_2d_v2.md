Edit only sheets `Ki_v2` and `Ki_2d_v2`, only cells `AI1:AS23`. Both sheets end at column Z: add columns
so `AI:AS` exist, change nothing in `A:Z`. Formulas only — no Apps Script, no typed numbers in computed
cells. Read sheet `Ki` (the old config for **both**) but never edit it.
Find every `data_*` column by its row-1 header (`INDEX(sheet!$A:$ZZ,0,MATCH("name",sheet!$1:$1,0))`),
never by letter. Neither sheet has a local sim yet: **build it**.

**Inputs:** `AI2` `Percentile` / `AJ2` dropdown `Avg, p25, p50, p75` (start at `p50`); `AI3` `Payer` /
`AJ3` dropdown `NONPAYER, PAYER` (start at `NONPAYER`).

**Days:** new duration `$B$6`, old duration `Ki!$B$6`. Day cells `AI6:AI12` and `AI17:AI23` = 1…7, blank
past `MAX(new, old)`. A day > new duration is a **grey day**: show only the old
number, and grey the whole row (`#999999`) with conditional formatting `=AND(ISNUMBER($AI6),$AI6>$B$6)` on
`AI6:AS12` (same with `$AI17` on `AI17:AS23`).

**Score on day d** (per segment `0-9`, `10-19`, `20-39`, `40-99`, `100+`, same for old and new):
- `bal` = SUMIFS of `data_event_inst` column `IF($AJ$2="Avg","avg_final_token_balance","final_balance_"&$AJ$2)`
  where `event_name`="Kite Festival", `payer_flag`=`$AJ$3`, `segment`=seg
- `share` = AVERAGEIFS of `data_event_kite_accrual` column `IF($AJ$2="Avg","cum_token_share_mean","cum_token_share_"&$AJ$2)`,
  same filters plus `event_day` = d
- `score = IF(d>=old, bal, bal*MIN(1,IFERROR(share,1)))`

**Rank:** `data_event_inst` `position_*` for `Kite Festival`, **mirrored** (lower rank = better): p25 →
`position_p75`, p50 and Avg → `position_p50`, p75 → `position_p25`. Round to a whole rank, at least 1.

**Ladders** (same layout on `Ki`, `Ki_v2`, `Ki_2d_v2`):
- Score milestones from row 23 (`B23` = Score Req, rewards `C23:X23`, headers `C22:X22`), down to the
  first row whose column A is not a number. `m` = requirements ≤ score.
- Rank rewards: positions `A27:A86`, rewards `C27:X86`, headers `C26:X26`; rank past the last row = 0.
- The rank reward is paid on a side's **last day** (new: day new-duration; old: day old-duration) and
  counts from then on.
- Value = Σ amount × price; price by header **name** from `item_vals` (names `B2:U2`, prices `B3:U3`;
  `ToF_Ticket` uses `ToF_Value`; no match = 0).

**Part A — block `AI1:AS13`:** `AI1` = `Player Reach Simulation (per event day) - old config -> new config`.
`AI5:AS5` = `Day_of_event | 0-9_ms | 0-9_reward | 10-19_ms | 10-19_reward | 20-39_ms | 20-39_reward | 40-99_ms | 40-99_reward | 100_ms | 100_reward`.
- `AJ`, `AL`, `AN`, `AP`, `AR` (rows 6-12): milestones `m_old & " -> " & m_new`; grey day: `m_old`.
- `AK`, `AM`, `AO`, `AQ`, `AS`: text `{Coins: 250, Comet: 1, …}` of everything collected so far
  (milestones + the rank reward from the last day on, zeros omitted) on the new ladders; grey day: old.
- `AI13` = `Final rank`; `AJ13`, `AL13`, `AN13`, `AP13`, `AR13` = the rank (number).

**Part B — new table:** `AI15` = `Player Progression (per event day) - score and value collected so far, old -> new`.
`AI16:AS16` = `Day_of_event | 0-9_score | 0-9_val | 10-19_score | 10-19_val | 20-39_score | 20-39_val | 40-99_score | 40-99_val | 100_score | 100_val`.
- `_score`: the score as a number, format `#,##0` (shown on grey days too).
- `_val`: value collected so far (milestones + rank reward from that side's last day on),
  `TEXT(old,"#,##0") & " -> " & TEXT(new,"#,##0")`; grey day: old only.

**Style:** Arial 10; `AI1`, `AI15` bold 11; header rows 5 and 16 bold, fill `#CFE2F3`; `AJ2:AJ3` fill
`#FFF2CC`; formula cells fill `#E2EFDA`; no merges, no borders. Widths: `AI` 14, ms/score 14, reward text
40, val 18.

**Check:** day rows run to the longer of the two durations and only the days past the new duration are grey; on a side's last day its value includes the rank reward, and not before; changing `AJ2` or `AJ3` changes both tables; no errors anywhere in `AI1:AS23`. Fix formulas, never type numbers.
