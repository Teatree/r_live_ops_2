Spreadsheet Style & River Rush Context
A reference document for Claude (and future-me) covering my preferred spreadsheet conventions, the River Rush event design, and the reward-name mapping used in the RR sheet of the Dream Album simulation workbook.

1. Spreadsheet Style Preferences
These are derived from how the Ph (Photoshoot) sheet was built and codified during the RR rework. Apply them to any new sheet I'm building, and match existing sheet conventions when editing pre-existing sheets.
1.1 Hard rules

Never merge cells. Merged cells break formulas and are a pain to refactor. Style section headers by applying fill + font across individual cells in the row instead. The result looks identical and avoids the downstream headaches.
Make sheets interactive — use formulas, never hardcode calculated values. This is non-negotiable. The point of a spreadsheet is that I can change one input and see everything downstream update. If I find myself reaching for a calculator, the sheet is doing it wrong. Concretely:

Identify the irreducible inputs first. Things I genuinely want to twiddle (e.g., for River Rush: per-round Level Req, per-place reward amounts, config params like numberOfRounds and groupSize).
Everything else is a formula. Sequence/index columns (Round number, Place ordinal), cumulative totals, summaries, cross-references — all derived. If the value is computable from inputs, compute it.
Wire formulas to the config cells, not to hardcoded constants. =SUMIFS(..., ">="&$B$6) referencing the loopbackPoint cell, not =SUMIFS(..., ">=10").
Mirror via formula when one input drives multiple cells. Example from RR: Level Req is an input on the 1st-place row of each round, but the 4 other rows in that round show the same value via =INDEX($C:$C, ROW()-MOD(ROW()-ROW($A$firstrow),$B$groupsize)). Editing the input once updates all five rows.
Use conditional formatting, not static fills, for value-driven styling. The green non-zero reward highlight and the zebra striping should both react when values change. Static fills get stale.


Use 0, not blank, for numeric cells with no value. Empty cells break SUM ranges semantically and create ambiguity ("missing data" vs "zero").
Punch-card rule: always include all in-game currencies as columns, even unused ones. When a sheet has reward / currency columns, list every currency or item type that exists in the game, regardless of whether the current event uses it. Unused ones get 0 across all rows. The sheet then doubles as a checklist — a "punch card" showing which currencies a given event touches and which it doesn't, with the gaps visually obvious. Never drop a column just because "this event doesn't reward COOP Token / Avatar / X-star Dly." Add it with zeros instead.
Everything starts at column A. No empty spacer columns or rows for visual breathing room. Tight, left-anchored layout.

1.2 Font
Arial throughout, regular weight for data, bold for headers and labels.
1.3 Color palette (Ph-style)
HexRole#000000 + white textSection header bands (full-width, applied per-cell, no merge)#FFD966 (gold)Input-parameter labels in config panels#FFF2CC (light yellow)Input-parameter values in config panels#F7CB4D (gold)Main table column headers#FFFFFF (white)Zebra stripe A — data row#FEF8E3 (cream)Zebra stripe B — data row#B7E1CD (light green)Highlight for non-zero / notable cell values#D9D9D9 (light grey)Thin cell borders on data cells
Note: separate from these, my HC simulation work uses a different palette (#CFE2F3 data, #E2EFDA sim/auto, #FFF2CC difference). That palette is specific to simulation sheets — the Ph palette above is for design/config sheets.
1.4 Standard layout
Top-to-bottom structure for a typical design sheet:

Sheet title in A1, bold, ~14pt
Config Panel section header band — black fill, white bold text, applied per-cell across the panel width (typically A:B)
Input parameters — label in column A (gold fill, bold, left-aligned), value in column B (light-yellow fill, centered)
Computed summary fields — same styling as inputs, but value cell holds a formula
Main section header band — black fill, white bold text, applied per-cell across the full table width
Column headers row — gold fill, bold, centered, with borders
Data rows with zebra striping and thin grey borders

1.5 Zebra striping
At the logical grouping level, not per-row, when rows belong to natural groups. River Rush has 5 rows per round (one per place), so the zebra alternates per round (5-row blocks of one color, then 5 of the other) — not every individual row. This makes the round boundaries visually obvious without needing separators.
When rows are atomic (e.g., one row per item in Ph), zebra by row is fine.
1.6 Alignment

Headers and labels: center, bold (or left-aligned for labels in config panel)
Numeric data: center
Text labels in data cells: left
Reward / currency column headers: Rotate Down (vertical text, reading top-to-bottom). When a table has many reward columns (Coins, SPT, SPT x2, Red, Chuck, Bomb, Slingshot, Shuffle, Comet, Unlimited Lives, Unlimited Red, Unlimited Chuck, Unlimited Bomb, COOP Token, Avatar, 1-star Dly … 6-star Dly), rotated headers keep the column widths compact (~3 chars wide is enough for the data) while still letting the full label read clearly. In Google Sheets this is Format → Rotation → Rotate down. In openpyxl: Alignment(text_rotation=90, horizontal='center', vertical='bottom') on the header cells.

1.7 Freeze panes
Place at the first data row + the first non-key column. Keeps key/ID columns (Round, Place, etc.) visible while scrolling rewards horizontally and rows vertically.
1.8 Highlighting
Non-zero values in reward/output columns get the light-green #B7E1CD fill, sitting on top of the zebra. Makes it easy to scan a sparse table for "where the action is" without reading every cell.

2. River Rush Event Context
2.1 What it is
River Rush is a streak-based competitive event for a F2P match-3 mobile game (Gymnastics Dream / similar Dream Blast-style title). The hypothesis: introducing a competitive event with scarcity-driven rewards and an engaging narrative will increase ARPDAU by ≥10% for highly competitive players who've spent at least once.
Players cross a river by jumping between stones. Each stone = one match-3 level. Win the level → jump to the next stone. Fail the level → fall into the river, restart the round from the beginning. Reach the final stone → choose your reward from the bundle available to your finishing position.
2.2 Core mechanics

Round structure: each round requires winning N levels in a row (N configurable per round). 15 rounds total in the current design.
Group size: 5 players compete per round (hard-coded at 5, not configurable per design Q&A). Bots fill empty slots if real players aren't available.
Scarcity reward picking: 1st player to finish the round gets first pick from the round's reward pool. 2nd player picks from what remains. And so on through 5th place. There are 5 reward bundles per round (one per position).
Failure penalty: failing a level restarts the round at level 1 with a new set of competitors (matchmaking, ~30-45s, similar to Flash Race).
Cycling: after the last round, the event loops back to a configured loopbackPoint round (round 10 in current data). This means rounds 10-15 are the recurring "loop" rounds that players will play repeatedly during the event.
Variable rewards: optional in-map rewards on specific stones — first player to reach that stone gets the reward automatically. Configurable on/off (nice-to-have).

2.3 Configurable parameters
Surface these as inputs in the Config Panel of any sheet modeling this event:

numberOfRounds — total rounds in the event (15)
groupSize — players per round (5, hard-coded)
cycleRounds — does the event loop after the last round (true)
loopbackPoint — which round the event loops back to (10)
levels per round — how many levels to win in a row to complete that round
rewardCandidates per round — list of reward bundles (one per place)

2.4 Round progression in current data
RoundLevels ReqCumulativeNotes1–45, 6, 10, 155, 11, 21, 36First peak, escalating warm-up5–98, 10, 12, 15, 1744, 54, 66, 81, 98Build to mid-game climax108106Loop start (loopbackPoint) — resets difficulty11–1410, 12, 15, 17116, 128, 143, 160Loop builds again1525185Loop end — biggest round, biggest rewards, then cycles back to Round 10
Total: 185 levels until full first run; 87 levels per loop cycle thereafter.
2.5 Reward structure (the key design point)
Rewards are awarded per finishing place, not summed across the round. A player finishing 3rd in Round 9 gets only the 3rd-place bundle for that round, not all five bundles.
A bundle for a single place can contain multiple items. Example, Round 15 1st place: Coins 150 + Unlimited Red 30 + Slingshot 1 — all three go to the player who finishes 1st.
2.6 Standard sheet structure for RR-style data
One row per (Round, Place) pair → 75 rows for 15 rounds × 5 places. Columns: Round | Place | Level Req | Level Req Cum | <reward item columns...>. Each reward column shows the amount of that item given to the player at that (Round, Place). Zero-pad cells where the bundle doesn't include that item.
2.7 Formula architecture (the RR pattern, generalizable)
This is what makes the RR sheet interactive. Reuse the same pattern for similar event-design sheets.
Inputs (the only cells with raw values):

numberOfRounds, groupSize, cycleRounds, loopbackPoint, firstPeakLastRound — in the Config Panel (column B values)
Level Req — entered once per round, on the 1st-place row only
Reward amounts — per (Round, Place, ItemType), hardcoded per the design

Derived (formulas):
ColumnFormulaWhat it doesRound=INT((ROW()-ROW($A$<firstdata>))/$B$<groupSize>)+1Computes round number from row position. Anchors to first data row via ROW($A$N) so it survives row insertions above.Place=CHOOSE(MOD(ROW()-ROW($A$<firstdata>),$B$<groupSize>)+1,"1st","2nd",...,"10th")Maps position-within-round to ordinal text. Supports groupSize up to 10.Level Req (non-1st rows)=INDEX($C:$C,ROW()-MOD(ROW()-ROW($A$<firstdata>),$B$<groupSize>))Looks up the Level Req from the 1st-place row of the current round. So Level Req is a single input that propagates to all 5 rows.Level Req Cum=SUMIFS($C$<first>:C<this>,$B$<first>:B<this>,"1st")Running cumulative — sums Level Req only on 1st-place rows. Naturally repeats the same cumulative value across all 5 rows of a round.
Summary aggregates (also formulas, wired to config cells):
SummaryFormulaTotal levels=SUMIFS($C$<range>,$B$<range>,"1st")Levels during loop=SUMIFS($C$<range>,$B$<range>,"1st",$A$<range>,">="&$B$<loopbackPoint>)Levels until 1st peak=SUMIFS($C$<range>,$B$<range>,"1st",$A$<range>,"<="&$B$<firstPeakLastRound>)
The summaries reference config cells (not constants), so changing loopbackPoint from 10 to 8 immediately re-aggregates.
Conditional formatting (not static fills):

Green #B7E1CD for reward cells > 0 — CellIsRule with operator='greaterThan', formula=['0'], stopIfTrue=True. Applies to the reward range only.
Cream #FEF8E3 zebra for even rounds — FormulaRule with formula=['ISEVEN(INT((ROW()-ROW($A$<firstdata>))/$B$<groupSize>)+1)']. Applies to the full data range. The stopIfTrue on the green rule means green wins over cream where both would apply.

Caveat: the number of data rows is built at construction time (numberOfRounds × groupSize). If numberOfRounds is later changed in the config, the rows don't auto-expand — the user has to add or remove rows manually (the formulas in any new rows just need to be copy-pasted from existing rows, since they're all relative-position formulas). The other config params (groupSize, loopbackPoint, firstPeakLastRound) are fully reactive without row changes.

3. Prize Name Mapping (Original Top-Section → Reward Column Headers)
When the original RR sheet had a separate top section with old/abbreviated prize names, here's how they map to the canonical reward column headers used in Ph and the new RR format. Useful if I ever resurface old data or someone hands me a spec using the old shorthand.
Old prize nameNew column headerNotesCoinsCoinsIdenticalSPSPTStrong Power Token — "SP" was the shorthandDoubler SPSPT x2The double-value variantRedRedCharacter boosterChuckChuckCharacter boosterBombBombCharacter boosterSlingshotSlingshotIdenticalShuffleShuffleIdenticalShooting StarCometVisual rename of the same in-game assetULUnlimited LivesBare "UL" = unlimited lives boosterUL RedUnlimited RedUL prefix + characterUL ChuckUnlimited ChuckUL prefix + characterUL BombUnlimited BombUL prefix + character
Reward columns in current Ph/RR format with no River-Rush source data: Avatar, 1-star Dly, 2-star Dly, 3-star Dly, 4-star Dly, 5-star Dly, 6-star Dly, and COOP Token (which appears in the Ph sheet's column set). Per the punch-card rule in §1.1, these columns must be present in any RR-style sheet with 0 across all rows — they're part of the canonical currency list and the zero values are themselves informative ("this event doesn't touch these"). Do not drop them on the grounds that the event doesn't use them.