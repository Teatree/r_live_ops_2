# Prompt for Gemini in Google Sheets — local sims: old → new comparison + player progression table

Paste everything below the line into Gemini in the 🏮LIVE_OPS_V3 (19) workbook. Built against (19) on
2026-11-03; the cell addresses below are that workbook's.

---

You are editing this Google Sheets workbook. Work **only with formulas** (no Apps Script, no pasted static
numbers, no manual values except labels and dropdown inputs). Work **only on these eight sheets**:
`J_v2`, `BB_v2`, `HH_v2`, `Ki_v2`, `Ki_2d_v2`, `TaD_v2`, `RM_1st_v2`, `RM_2nd_v2`. Every other sheet is
read-only for you: you may reference it in formulas, never edit it.

On each of the eight sheets you may write **only** inside `AI1:AS23` (and the conditional-formatting /
data-validation rules on that range). Do not move, insert, delete or reformat anything else — the ladders
in columns A:AH are read by a simulation engine by position. Exception: `Ki_v2` and `Ki_2d_v2` end at
column Z; add columns so that `AI:AS` exist, and change nothing in A:Z. `HH_v2` has a helper block at
`AU2:AW9` — leave it as it is (you will read `AW5:AW9`).

There are two jobs on every sheet:

- **Part A** — the existing "Player Reach Simulation" block at `AI1:AS13` (on `Ki_v2` / `Ki_2d_v2` it does
  not exist yet: build it). Its milestone columns must show the **old config vs the new config**, and its
  score must use the real percentile.
- **Part B** — a new, smaller table at `AI15:AS23`: the player's **score** per day and the **value of what
  they have collected so far, old → new**, per segment.

Read the whole prompt before writing anything. The shared rules come first, then one section per sheet.

---

## 1. Shared rules

### 1.1 Old vs new: which sheets are compared

Each `_v2` sheet is the **new** config. Its **old** config is the base sheet named below. The old sheet is
only read, never written.

| new sheet (edit) | old sheet (read only) | event name in `data_event_inst` | new duration | old duration |
|---|---|---|---|---|
| `J_v2` | `J` | `Jigsaw` | `J_v2!$B$3` (2) | `J!$B$3` (3) |
| `BB_v2` | `BB` | `Bombs Ballet` | `BB_v2!$B$3` (2) | `BB!$B$3` (3) |
| `HH_v2` | `HH` | `Hatchling Hideaway` | `HH_v2!$B$3` (3) | `HH!$B$3` (4) |
| `Ki_v2` | `Ki` | `Kite Festival` | `Ki_v2!$B$6` (3) | `Ki!$B$6` (3) |
| `Ki_2d_v2` | `Ki` | `Kite Festival` | `Ki_2d_v2!$B$6` (2) | `Ki!$B$6` (3) |
| `TaD_v2` | `TaD` | `Target Day` | `TaD_v2!$B$7` (1) | `TaD!$B$7` (1) |
| `RM_1st_v2` | `RM_1st` | (uses `data_rm_pace`) | `RM_1st_v2!$B$3` (2) | `RM_1st!$B$3` (4) |
| `RM_2nd_v2` | `RM_2nd` | (uses `data_rm_pace`) | `RM_2nd_v2!$B$3` (2) | `RM_2nd!$B$3` (4) |

Always reference the duration **cells**, never the numbers in brackets (they are today's values).

### 1.2 Inputs (top of every block)

- `AI2` = `Percentile`, `AJ2` = the input. Data-validation dropdown: `Avg, p25, p50, p75` on every sheet
  except the two RM sheets, which get `Avg, p10, p25, p50, p75, p90`.
- `AI3` = `Payer`, `AJ3` = dropdown `NONPAYER, PAYER`.
- RM sheets only: `AI4` = `Config`, `AJ4` = dropdown `RM_1st, RM_2nd` — set it to `RM_1st` on `RM_1st_v2`
  and `RM_2nd` on `RM_2nd_v2`.
- Keep whatever value `AJ2` / `AJ3` hold today on the sheets that already have them.
- **Both tables (Part A and Part B) read these same inputs.** Part B has no inputs of its own.

The percentile means **the player's performance percentile**: p75 = a player who does better than 75% of
the segment. For scores that is `final_balance_p75`. For a **rank** (lower is better) the same player sits
at `position_p25` — so a rank always reads the **mirrored** position quantile: p25 → `position_p75`,
p50 → `position_p50`, p75 → `position_p25`, Avg → `position_p50`. (This replaces `TaD_v2`'s current direct
mapping on purpose, so the score and the rank describe the same player.)

### 1.3 Reading the data sheets

- Find every column of a `data_*` sheet **by its header name in row 1** (`INDEX(sheet!$A:$ZZ,0,MATCH("name",
  sheet!$1:$1,0))`), never by column letter — these sheets are re-pulled and their columns move.
- If a data sheet has an `ab_variant` column, read only rows where it equals `Variant A` (none do today).
- Filters are always: event name (where the sheet has one), `payer_flag` = `$AJ$3`, `segment` = the
  column's segment (`0-9`, `10-19`, `20-39`, `40-99`, `100+`).

### 1.4 Day rows and "grey days"

- Day rows: `AI6:AI12` (Part A) and `AI17:AI23` (Part B), day 1 to 7:
  `=IF(n<=MAX(new_duration, old_duration), n, "")`. Rows past both durations stay blank.
- A day `<=` new duration is a **comparison day**: show `old -> new`.
- A day `>` new duration (the old event ran longer — e.g. Jigsaw day 3) is a **grey day**: show **only the
  old config's** number (no arrow, no new number) and render the **whole row** of that table in grey font
  (`#999999`) with a conditional-formatting rule, custom formula
  `=AND(ISNUMBER($AI6), $AI6>new_duration_cell)` on `AI6:AS12` (and `$AI17` on `AI17:AS23`).
  Static font colours are not allowed for this — it must follow the duration cells.
- The new event is over after its last day; on a grey day the new side is simply not shown.

### 1.5 The player's score on day d (one definition, used by both tables)

`score(d)` = what a participant at the selected percentile has accumulated by the **end of day d**. It is
the same number for the old and the new config (same player, same play per day — only the ladders differ).

**Collections and leaderboards (J, BB, HH, Kite, TaD):**

```
bal      = SUMIFS( data_event_inst column  IF($AJ$2="Avg","avg_final_token_balance","final_balance_"&$AJ$2),
                   event_name = <event>, payer_flag = $AJ$3, segment = <seg> )
share(d) = AVERAGEIFS( <accrual sheet> column  IF($AJ$2="Avg","cum_token_share_mean","cum_token_share_"&$AJ$2),
                       event_name = <event>, payer_flag = $AJ$3, segment = <seg>, event_day = d )
score(d) = IF( d >= old_duration,  bal,  bal * MIN(1, IFERROR(share(d), 1)) )
```

`<accrual sheet>` = `data_event_accrual`, except Kite, which uses `data_event_kite_accrual`. On the old
event's last day (and after) the player has their full final balance. Use `SUMIFS` / `AVERAGEIFS` with the
`INDEX/MATCH` header columns from 1.3.

**Rainbow Maker (RM sheets):** the score is cumulative **matchables** from `data_rm_pace`. Use exactly this
formula (shown for segment `0-9`, day cell `$AI17`, old duration `RM_1st!$B$3`; on `RM_2nd_v2` use
`RM_2nd!$B$3`; change the day cell for each row and the segment literal per column):

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

What it does (do not change the rule): day d reads date d of the measured event; the old event's last day
reads the measured event's closing date; `data_rm_pace` has no p10/p90 yet, so they are derived; when a
re-pull adds `rm_config`, the `AJ4` config is used. This **replaces `data_RM` entirely** — no formula on
the RM sheets may reference `data_RM` any more.

### 1.6 Milestones reached and their value

- **Milestones on a ladder**: the rows from the first ladder row down to the first row whose column A is
  not a number (a cleared row ends the ladder, like the engine reads it). HH's gates are labelled
  `Gate 1`…`Gate 5`: there the ladder is the rows with a non-blank column A.
- **Milestones reached** `m(d)` = how many of those requirements are `<= score(d)`. Requirements rise down
  the ladder, so the first `m` rows are the ones reached.
- **Value** of the first `m` rows = Σ over those rows and every reward column of
  `amount × price(column header)`.
  - `price(header)` comes from `item_vals`: names in row 2 (`B2:U2`), prices in row 3 (`B3:U3`). Match by
    **name**, not position (the orders differ). The ladder header `ToF_Ticket` is priced by
    `item_vals`' `ToF_Value`. A header with no price (`COOP Token`, `Avatar`) is worth 0.
  - Suggested pattern (wrap in `ARRAYFORMULA`):
    `SUMPRODUCT( (ROW(rewards)-ROW(first_reward_row)<m) * IFERROR(rewards*1,0) *
    IFERROR(HLOOKUP(SUBSTITUTE(header_row,"ToF_Ticket","ToF_Value"),item_vals!$B$2:$U$3,2,FALSE),0) )`
- Old side = the old sheet's ladder, new side = this sheet's ladder, **same `score(d)`**.

### 1.7 Number formats in text cells

- Old → new numbers: `old & " -> " & new`, e.g. `10 -> 12`. Values with `TEXT(x,"#,##0")`, e.g.
  `1,204 -> 1,443`. Milestone counts as integers.
- Grey days: only the old number, e.g. `14`.
- Score cells are numbers (not text), format `#,##0`.

### 1.8 Style (match the existing local sim exactly)

- Font Arial 10 everywhere in `AI1:AS23`; titles (`AI1`, `AI15`) bold Arial 11.
- Header rows (`AI5:AS5`, `AI16:AS16`): bold, fill `#CFE2F3`.
- Input cells (`AJ2`, `AJ3`, RM `AJ4`): fill `#FFF2CC`.
- Formula cells: fill `#E2EFDA`.
- Labels (`AI2`, `AI3`, `AI4`, notes): no fill.
- No merged cells, no borders, do not change gridlines or frozen panes.
- Column widths: `AI` 14; milestone / score columns 14; reward-text columns 40; value columns 18.
- Comparison-day text black, grey-day rows `#999999` via conditional formatting only (1.4).

---

## 2. Part A — the existing block `AI1:AS13`

Layout (unchanged where it exists): `AI1` title, inputs in rows 2-4, `AI5:AS5` headers
`Day_of_event | 0-9_ms | 0-9_reward | 10-19_ms | 10-19_reward | 20-39_ms | 20-39_reward | 40-99_ms |
40-99_reward | 100_ms | 100_reward`, day rows 6-12.

For every sheet except `TaD_v2`:

- **`_ms` columns (`AJ`, `AL`, `AN`, `AP`, `AR`)** — rewrite: comparison day → `m_old(d) -> m_new(d)`;
  grey day → `m_old(d)`. Both from the shared `score(d)` (1.5) — this also fixes the percentile, which the
  current J / BB / HH formulas ignore (they always used the average final balance).
- **`_reward` columns (`AK`, `AM`, `AO`, `AQ`, `AS`)** — keep today's output format (`{Coins: 15, Red: 1,
  …}` = the summed rewards of the reached milestones, items with 0 omitted) for the **new** ladder on
  comparison days; on grey days show the same text for the **old** ladder. Keep the existing `MMULT` /
  `TEXTJOIN` style.
- Title `AI1`: `Player Reach Simulation (per event day) - old config -> new config`.

### Per sheet

**`J_v2`** (old `J`): ladder rows 11-22; requirement `B11:B22`; rewards `C11:X22`, headers `C10:X10`.
Same on `J`.

**`BB_v2`** (old `BB`): ladder rows 9-23; requirement `B9:B23` (cumulative); rewards `C9:X23`, headers
`C8:X8`. **Completion row 24** (`C24:X24`): paid when all 15 levels are reached — add it to the reward
text and to the value when `m = 15`. Same layout on `BB`.

**`HH_v2`** (old `HH`): gates rows 12-16; rewards `B12:W16`, headers `B11:W11` (same on `HH`).
Requirement for **both** sides = `HH_v2!$AW$5:$AW$9` (cumulative tokens; `HH` has no requirement column of
its own). If `HH` ever gets its own block labelled `Cum tokens`, the old side should read that instead —
write the old-side lookup so it uses `HH`'s `Cum tokens` column when one exists, else `HH_v2!AW5:AW9`.

**`RM_1st_v2`** (old `RM_1st`) and **`RM_2nd_v2`** (old `RM_2nd`): ladder rows 16-45, requirement
`C16:C45` (Req Accum), rewards `E16:Z45`, headers `E15:Z15`; the ladder ends at the first non-number in
`A` (the v2 sheets have 25 milestones, the old ones 30). Replace the whole current block (it still reads
`data_RM`) with:
- `AI1` title, `AI2:AJ4` inputs (1.2), `AL2` = `Share completing the whole RM by the last day: row 13`,
  `AL3` = `Milestones read`, `AM3` = `=IFERROR(MATCH(TRUE,INDEX(NOT(ISNUMBER($A$16:$A$45)),0),0)-1,ROWS($A$16:$A$45))`,
  `AL4` = `AJ4: RM_1st on RM_1st_v2, RM_2nd on RM_2nd_v2`.
- `_ms` / `_reward` columns as above, score = the RM formula of 1.5 with the row's day cell.
- `AI13` = `Completes the whole RM`; `AJ13`, `AL13`, `AN13`, `AP13`, `AR13` = share of participants past the
  last milestone, as text `old% -> new%` (each side: its own ladder's last requirement and its own last
  day — old on `old_duration`, new on `new_duration`). Per side, with `x` = that ladder's last requirement
  and the date record of that side's last day (same `dte` rule as 1.5 with `$AI` replaced by that side's
  duration):
  `u = IFS(x<=0,0, x<=p25,0.25*x/MAX(p25,1E-9), x<=p50,0.25+0.25*(x-p25)/MAX(p50-p25,1E-9),
  x<=p75,0.5+0.25*(x-p50)/MAX(p75-p50,1E-9), x<=top,0.75+0.25*(x-p75)/MAX(top-p75,1E-9), TRUE,1)`,
  share = `1-u`; format each side `TEXT(share,"0.0%")`.

**`Ki_v2`** (old `Ki`) and **`Ki_2d_v2`** (old `Ki`) — **build the block from scratch** in the layout
above (same title, inputs, headers, day rows). Kite is a 60-rank league plus score milestones:
- Score milestones: row 23 (`B23` = Score Req, rewards `C23:X23`, headers `C22:X22`); treat rows from 23
  down to the first non-number in `A` as the milestone ladder (one row today). Same on `Ki`.
- Rank reward: positions in `A27:A86`, rewards `C27:X86`, headers `C26:X26`. The player's rank =
  `data_event_inst` position for `Kite Festival` with the **mirrored** quantile (1.2), rounded to a whole
  rank, at least 1; a rank past the last row pays nothing.
- The rank reward is paid on the event's **last day** only: on the new event's last day the new side
  includes it; on the old event's last day the old side includes it (for `Ki_2d_v2` that is grey day 3).
- `_ms` = score milestones reached `old -> new`; `_reward` = items collected so far (milestones, plus the
  rank reward from the last day on), format as 2. Add `AI13` = `Final rank`, and in `AJ13`, `AL13`, `AN13`,
  `AP13`, `AR13` the rank (a number).

**`TaD_v2`** (old `TaD`) — a 1-day leaderboard. The block today has header `AI5` = `Event` and one row
(row 6). Keep that shape:
- `_pos` columns (`AJ`, `AL`, …): keep showing the rank, now with the mirrored quantile (1.2), `n/a` when
  the data has no position.
- `_reward` columns (`AK`, `AM`, …): change to the **value** `old -> new` of what that rank pays on `TaD`
  vs `TaD_v2` (rank rewards `C36:X55`, headers `C35:X35`, rank past 20 = 0) plus the score milestones
  reached (`B11:B30` requirements, rewards `C11:X30`, headers `C10:X10`; they pay 0 today, include them
  anyway). Text `100 -> 120`.

---

## 3. Part B — new table `AI15:AS23` (every sheet)

- `AI15` = `Player Progression (per event day) - score and value collected so far, old -> new` (bold 11).
- `AI16:AS16` headers: `Day_of_event | 0-9_score | 0-9_val | 10-19_score | 10-19_val | 20-39_score |
  20-39_val | 40-99_score | 40-99_val | 100_score | 100_val`.
- `AI17:AI23` day rows (1.4). For `TaD_v2` that is one row.
- `_score` (`AJ`, `AL`, `AN`, `AP`, `AR`): `score(d)` of 1.5 — tokens for J / BB / HH, score for Kite /
  Target Day, matchables for RM. A number, shown on grey days too (grey font).
- `_val` (`AK`, `AM`, `AO`, `AQ`, `AS`): total item value collected from this event **up to and including
  that day**, `old -> new` (1.6 / 1.7): milestones reached by `score(d)` on each ladder, BB's completion
  reward when all 15 are reached, and for Kite / Target Day the rank reward from that side's last day on.
  Grey days: the old value only.
- Same inputs (`AJ2`, `AJ3`, RM `AJ4`) as Part A, same styling, same grey-day conditional formatting.

---

## 4. Do not

- Write any static number into a computed cell, or any Apps Script.
- Use `LAMBDA`, `BYROW`, `BYCOL`, `MAP` or named functions — `LET`, `INDEX/MATCH`, `SUMIFS`, `AVERAGEIFS`,
  `FILTER`, `SUMPRODUCT`, `MMULT`, `TEXTJOIN`, `SWITCH`, `IFS` are enough (the workbook is exported to
  xlsx and read by offline tools).
- Reference columns of `data_*` sheets by letter, or reference `data_RM` anywhere.
- Edit anything outside `AI1:AS23` on the eight sheets, or anything on any other sheet.
- Merge cells or add borders.

## 5. Check before you finish

1. No cell in `AI1:AS23` of the eight sheets shows an error (`#N/A`, `#REF!`, `#VALUE!`, `#ERROR!`).
2. Changing `AJ2` or `AJ3` changes both tables on that sheet.
3. Grey rows appear only on `J_v2` (day 3), `BB_v2` (day 3), `HH_v2` (day 4), `Ki_2d_v2` (day 3),
   `RM_1st_v2` / `RM_2nd_v2` (days 3-4) — and disappear if you temporarily set the new duration equal to
   the old one (then undo).
4. With `AJ2 = p50`, `AJ3 = NONPAYER`, the Part B table on `J_v2` reads (score | val):

   | day | 0-9 | 10-19 | 20-39 | 40-99 | 100+ |
   |---|---|---|---|---|---|
   | 1 | 17 \| 0 -> 0 | 66 \| 50 -> 88 | 175 \| 299 -> 151 | 375 \| 458 -> 430 | 748 \| 805 -> 567 |
   | 2 | 63 \| 50 -> 88 | 177 \| 299 -> 151 | 411 \| 458 -> 430 | 789 \| 805 -> 567 | 1,292 \| 943 -> 736 |
   | 3 (grey) | 85 \| 126 | 253 \| 433 | 605 \| 653 | 1,089 \| 918 | 1,292 \| 943 |

   and Part A's `_ms` on `J_v2` day 2: `1 -> 2`, `3 -> 3`, `5 -> 6`, `7 -> 8`, `9 -> 10`
   (day 3 grey: `2`, `4`, `6`, `8`, `9`).
5. With the same inputs, `RM_1st_v2` Part A `_ms`:

   | day | 0-9 | 10-19 | 20-39 | 40-99 | 100+ |
   |---|---|---|---|---|---|
   | 1 | 0 -> 1 | 4 -> 7 | 8 -> 9 | 11 -> 12 | 14 -> 14 |
   | 2 | 4 -> 6 | 8 -> 9 | 11 -> 12 | 14 -> 16 | 18 -> 19 |
   | 3 (grey) | 5 | 10 | 13 | 17 | 21 |
   | 4 (grey) | 7 | 11 | 14 | 19 | 23 |

   and Part B `_score` day 1 / day 4: `94 / 4,617`, `1,973 / 15,644`, `6,102 / 33,372`,
   `16,316 / 73,451`, `27,148 / 136,193`.

Values may differ by ±1 in the last digit through rounding. If a check does not match, fix the formula —
do not type the expected number.

Finally, list what you changed per sheet (cells and a one-line description).
