Edit only sheet `TaD_v2`, only cells `AI1:AS23`. Formulas only — no Apps Script, no typed numbers in
computed cells. Read sheet `TaD` (the old config) but never edit it. Find
every `data_*` column by its row-1 header (`INDEX(sheet!$A:$ZZ,0,MATCH("name",sheet!$1:$1,0))`), never by
letter. Target Day is a 1-day leaderboard; the block at `AI1:AS6` shows each segment's rank.

**Inputs (keep their current values):** `AJ2` percentile, dropdown `Avg, p25, p50, p75`. `AJ3` payer,
dropdown `NONPAYER, PAYER`.

**Rank** (per segment `0-9`, `10-19`, `20-39`, `40-99`, `100+`): `data_event_inst` `position_*` for
`event_name`="Target Day", `payer_flag`=`$AJ$3`, **mirrored** (lower rank = better): p25 → `position_p75`,
p50 and Avg → `position_p50`, p75 → `position_p25`. Round to a whole rank; `n/a` when the data has none.

**Score** = `data_event_inst` column `IF($AJ$2="Avg","avg_final_token_balance","final_balance_"&$AJ$2)`,
same filters (one day, so no accrual).

**Value of a side** (old = `TaD`, new = `TaD_v2`, same layout): rank reward at that rank (`C36:X55`,
headers `C35:X35`, rank past 20 = 0) + score milestones reached (requirements `B11:B30`, rewards `C11:X30`,
headers `C10:X10`; they pay 0 today, include them anyway). Σ amount × price; price by header **name** from
`item_vals` (names `B2:U2`, prices `B3:U3`; `ToF_Ticket` uses `ToF_Value`; no match = 0).

**Part A — existing block (keep its shape: header `AI5` = `Event`, one row 6):**
- `AJ`, `AL`, `AN`, `AP`, `AR` (`_pos`): the rank, using the mirrored rule above.
- `AK`, `AM`, `AO`, `AQ`, `AS` (`_reward`): the value `TEXT(old,"#,##0") & " -> " & TEXT(new,"#,##0")`.

**Part B — new table:** `AI15` = `Player Progression (per event day) - score and value collected so far, old -> new`.
`AI16:AS16` = `Day_of_event | 0-9_score | 0-9_val | 10-19_score | 10-19_val | 20-39_score | 20-39_val | 40-99_score | 40-99_val | 100_score | 100_val`.
One day row, `AI17` = `=IF(1<=MAX($B$7,TaD!$B$7),1,"")`.
- `_score`: the score as a number, format `#,##0`.
- `_val`: same value text as Part A.

**Style:** Arial 10; `AI1`, `AI15` bold 11; header rows 5 and 16 bold, fill `#CFE2F3`; `AJ2:AJ3` fill
`#FFF2CC`; formula cells fill `#E2EFDA`; no merges, no borders. Widths: `AI` 14, pos/score 14, val 18.

**Check:** changing `AJ2` from p25 to p75 makes every rank better (smaller) and every score larger; no
errors anywhere in `AI1:AS23`. Fix formulas, never type numbers.
