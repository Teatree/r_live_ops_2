Edit only sheet `BB_v2`, only cells `AI1:AS23`. Formulas only — no Apps Script, no typed numbers in
computed cells. Read sheet `BB` (the old config) but never edit it. Find
every `data_*` column by its row-1 header (`INDEX(sheet!$A:$ZZ,0,MATCH("name",sheet!$1:$1,0))`), never by
letter.

**Inputs (keep their current values):** `AJ2` percentile, dropdown `Avg, p25, p50, p75`. `AJ3` payer,
dropdown `NONPAYER, PAYER`.

**Days:** new duration `$B$3`, old duration `BB!$B$3`. Day cells `AI6:AI12` and `AI17:AI23` = 1…7, blank
past `MAX(new, old)`. A day > new duration is a **grey day**: show only the old number, and grey the whole
row (`#999999`) with conditional formatting `=AND(ISNUMBER($AI6),$AI6>$B$3)` on `AI6:AS12` (same with
`$AI17` on `AI17:AS23`).

**Score on day d** (per segment `0-9`, `10-19`, `20-39`, `40-99`, `100+`, same for old and new):
- `bal` = SUMIFS of `data_event_inst` column `IF($AJ$2="Avg","avg_final_token_balance","final_balance_"&$AJ$2)`
  where `event_name`="Bombs Ballet", `payer_flag`=`$AJ$3`, `segment`=seg
- `share` = AVERAGEIFS of `data_event_accrual` column `IF($AJ$2="Avg","cum_token_share_mean","cum_token_share_"&$AJ$2)`,
  same filters plus `event_day` = d
- `score = IF(d>=old, bal, bal*MIN(1,IFERROR(share,1)))`

**Ladders** (same layout on `BB` and `BB_v2`): requirement `B9:B23` (cumulative), rewards `C9:X23`,
headers `C8:X8`; the ladder ends at the first row whose column A is not a number. `m` = requirements ≤
score. **Completion row 24** (`C24:X24`) is also paid when all 15 levels are reached. Value = Σ amount ×
price over the reached rows (+ row 24 when complete); price by header **name** from `item_vals` (names
`B2:U2`, prices `B3:U3`; `ToF_Ticket` uses `ToF_Value`; no match = 0).

**Part A — existing block `AI1:AS13`:** `AI1` = `Player Reach Simulation (per event day) - old config -> new config`.
- `AJ`, `AL`, `AN`, `AP`, `AR` (rows 6-12): `m_old & " -> " & m_new`; grey day: `m_old`.
- `AK`, `AM`, `AO`, `AQ`, `AS`: keep today's text format `{Coins: 15, Red: 1, …}` (summed rewards of the
  reached levels + completion row when complete, zeros omitted) for the new ladder; grey day: the old one's.

**Part B — new table:** `AI15` = `Player Progression (per event day) - score and value collected so far, old -> new`.
`AI16:AS16` = `Day_of_event | 0-9_score | 0-9_val | 10-19_score | 10-19_val | 20-39_score | 20-39_val | 40-99_score | 40-99_val | 100_score | 100_val`.
- `_score`: the score as a number, format `#,##0` (shown on grey days too).
- `_val`: `TEXT(old,"#,##0") & " -> " & TEXT(new,"#,##0")`; grey day: old only.

**Style:** Arial 10; `AI1`, `AI15` bold 11; header rows 5 and 16 bold, fill `#CFE2F3`; `AJ2:AJ3` fill
`#FFF2CC`; formula cells fill `#E2EFDA`; no merges, no borders. Widths: `AI` 14, ms/score 14, reward text
40, val 18.

**Check:** day rows run to the longer of the two durations, and only the days past the new duration are grey (none when the new event is as long as the old one); changing `AJ2` or `AJ3` changes both tables; no errors anywhere in `AI1:AS23`. Fix formulas, never type numbers.
