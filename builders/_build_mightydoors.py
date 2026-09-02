# Builds ToF_v1.xlsx — the 'ToF' config sheet for Mighty Doors / Tower of Fortune, the push-your-luck
# event from design_pdfs/DRBL-Mighty Doors (DB Tower of Fortune)-010926-212845.pdf.
# See source_docs/mighty-doors.md for the mechanics this encodes.
#
# WHAT IS AUTHORED HERE vs WHAT IS DERIVED
#   The deck specifies the STRUCTURE completely (60 stages, 4 doors, 1 Pig per standard stage, safe
#   stages every 5th plus milestones at 30/60, six reward tiers of 10 stages) and gives NOT ONE
#   numeric reward value, continue cost, or duration. So this sheet ships with the structure fully
#   populated and every VALUE at 0 — the same convention the D19/D21 pack ladders shipped under: a
#   zero is "not authored yet", which is correct rather than a plumbing failure.
#
# WHY THE STAGE TABLE CARRIES FORMULAS
#   Stage type, pig count, tier, survival and reach are all COMPUTABLE from the RUN CONFIG panel, so
#   per the project rule they are computed, not typed. Change 'Safe Stage Every N' or 'Total Stages'
#   in the panel and all 60 rows re-derive. Only the yellow cells are inputs.
#
# THE ACCUMULATION MODEL (why 'Reach p' is not enough on its own)
#   Rewards banked during a run are LOST if the player meets a Pig and declines to continue (deck
#   p7). Expected payout is therefore NOT sum(reach x reward) — it is
#       E[payout] = SUM_s P(cash out at s) x CumReward(s) + P(complete final stage) x CumReward(last)
#   A player who never cashes out and never continues expects ~nothing: P(reach 60) unaided is
#   0.75^47 ~ 1.3e-6. Cash-Out is the ONLY thing that converts a run into income, which is why the
#   Cash-Out % column is an input per stage rather than a single policy constant.
#
# CONTINUES (user decision 2026-09-02: unlimited for now, limit later)
#   Continuing removes the Pig and guarantees a reward from the remaining doors, so with take-up c
#   the effective survival is s + (1-s)*c. At c = 1 the Pig stops mattering entirely and every run
#   walks to the final stage — depth is set by take-up, not by the 3/4 odds.
#
# PLAYER REACH SIMULATION (added 2026-09-02 after review)
#   Every collection/milestone _v2 sheet in the workbook carries a 'Player Reach Simulation (per
#   event day) - SIMULATED' block anchored at AH1 - HH_v2, BB_v2, J_v2, Ph_v2, RM_1st_v2, RM_2nd_v2
#   all have it; the leaderboards (Ki, Race, F), TaD and NS do not, because rank and daily-reset
#   events have no progress to show. Mighty Doors is a progression ladder, so it belongs in the
#   first family and gets the block, with the SAME grammar: AH2/AI2 Percentile, AH3/AI3 Payer,
#   header row 5 = Day_of_event + <segment>_ms / <segment>_reward pairs, one row per event day.
#   For this event '_ms' is the STAGE reached (the milestone analogue) and '_reward' is the bundle
#   banked at that stage, rendered as the same '{Coins: 15, Red: 1}' dict string the others use.
#
# WHY BEHAVIOUR IS PER SEGMENT
#   The five _ms columns only say something if the segments differ. For a collection event they
#   differ through measured accrual; Mighty Doors has no accrual - a run is walked in one sitting -
#   so what separates a whale from a new player here is how often they PAY TO CONTINUE and how long
#   they push before cashing out. The deck's own business goal is 'additional spending opportunities
#   for whales and highly engaged players' (p2), so continue take-up is exactly the segment axis.
#   Global assumptions would render five identical columns, which would be worse than none.
#
# Sheet name is 'MD' (user decision: the calendar lane is 'MD', not the full event name). Duplicate
# the imported sheet as 'MD_v2' — the engine reads the _v2 sheet for the redesign side, exactly as
# NS_v2 shipped as a verbatim clone of NS.
import json
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.utils import get_column_letter as CL

DISPLAY = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'display')

# The 21-column reward grammar every config sheet in the workbook shares (engine REWARD_COLUMNS).
# Punch-card rule: ALL currency columns are present even when this event never pays them.
REWARD_COLS = ['Coins', 'SPT', 'SPT x2', 'Red', 'Chuck', 'Bomb', 'Slingshot', 'Shuffle', 'Comet',
               'Unlimited Lives', 'Unlimited Red', 'Unlimited Chuck', 'Unlimited Bomb',
               'COOP Token', 'Avatar', '1-star Dly', '2-star Dly', '3-star Dly', '4-star Dly',
               '5-star Dly', '6-star Dly']

# The reward ladder is keyed by ENGINE resource names; the sheet's columns use the config-sheet
# spelling. One map, so the two lists cannot drift apart silently.
RES_ALIAS = {'Coins': 'HC', 'SPT x2': 'SPTx2',
             'Unlimited Red': 'UL Red', 'Unlimited Chuck': 'UL Chuck',
             'Unlimited Bomb': 'UL Bomb',
             '1-star Dly': '1-star Pack', '2-star Dly': '2-star Pack',
             '3-star Dly': '3-star Pack', '4-star Dly': '4-star Pack',
             '5-star Dly': '5-star Pack', '6-star Dly': '6-star Pack'}

TOTAL_STAGES = 60
N_TIERS = 6

F_BAR, F_HDR, F_IN, F_OUT, F_DATA = 'FF000000', 'FFF7CB4D', 'FFFFF2CC', 'FFE2EFDA', 'FFCFE2F3'
fill = lambda rgb: PatternFill('solid', fgColor=rgb)
ARIAL = lambda **kw: Font(name='Arial', **kw)
thin = Side(style='thin')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'ToF'      # renamed from 'MD' 2026-09-02: ToF is the preferred name
ws.sheet_view.showGridLines = False


def bar(r, text, ncol):
    """Black section bar. Blocks are located by this column-A label, never by row number."""
    for c in range(1, ncol + 1):
        ws.cell(r, c).fill = fill(F_BAR)
    ws.cell(r, 1, text).font = ARIAL(size=11, bold=True, color='FFFFFFFF')


def hdr(r, labels):
    for i, t in enumerate(labels, start=1):
        c = ws.cell(r, i, t)
        c.font = ARIAL(size=10, bold=True)
        c.fill = fill(F_HDR)
        c.border = BOX
        c.alignment = Alignment(horizontal='center', wrap_text=True, vertical='center')


def note(r, text):
    ws.cell(r, 1, text).font = ARIAL(size=9, italic=True, color='FF666666')


def put(r, c, v, kind='out', numfmt=None):
    """kind: 'in' = author types here (yellow) · 'out' = derived (green) · 'data' = fixed (blue)."""
    cell = ws.cell(r, c, v)
    cell.font = ARIAL(size=10)
    cell.fill = fill({'in': F_IN, 'out': F_OUT, 'data': F_DATA}[kind])
    cell.border = BOX
    if numfmt:
        cell.number_format = numfmt
    return cell


LAD = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '_md_ladder.json')))
LADDER = LAD['ladder']

# Guard against the failure this map exists to prevent: the first build silently dropped every
# UL Bomb / UL Chuck / UL Red payout because those three aliases were missing, and a zero column
# looks exactly like "not authored yet". Fail the build instead.
_sheet_keys = {RES_ALIAS.get(c, c) for c in REWARD_COLS}
_lost = sorted({k for node in LADDER for k in node} - _sheet_keys)
if _lost:
    raise SystemExit('reward ladder produces resources with no sheet column: %s' % _lost)

ws['A1'] = 'MIGHTY DOORS (Tower of Fortune)'
ws['A1'].font = ARIAL(size=14, bold=True)

r = 3

# ---------------------------------------------------------------- RUN CONFIG
bar(r, 'RUN CONFIG', 4); r += 1
hdr(r, ['Parameter', 'Value', 'What it means']); r += 1
RUN_FIRST = r
RUN = {}
# Five parameters were removed 2026-09-02 because nothing read them and nothing could:
#   Total Stages          the ladder length IS the number of STAGES rows; a second number could
#                         only disagree with it
#   Tickets per Run       always 1 (deck p9); the engine assumes 1 when it is absent
#   Empty Outcomes        the Empty Slots column is 0 throughout and no reader consults the flag
#   Ticket Recharge       tickets are EARNED, not recharged (user decision) -- there is no recharge
#   Runs per Player       was derived from the recharge; runs now come from the ticket budget
# Cash-Out Variant STAYS: it is a real design switch in the deck (A p9/p19, B p23) and the engine
# reads it. Default A -- bank at any successful node.
run_rows = [
    ('Choices per Stage (default)', 4, 'in', 'How many doors are shown at a node. Min 2, max 4.'),
    ('Failure Outcomes per Stage', 1, 'in', 'Base number of Pigs. The STAGES table raises this on later tiers.'),
    ('Safe Stage Every N Stages', 5, 'in', 'Every Nth node carries no Pig at all.'),
    ('Major Milestone Stage', 30, 'in', 'A safe node with a large bundle.'),
    ('Aspirational Milestone Stage', 60, 'in', 'The final node. Reaching it auto claims everything.'),
    ('Reward Tier Size (stages)', 10, 'in', 'Only used to label the Tier column.'),
    ('Starting Tickets', LAD['start_tickets'], 'in',
     'Tickets the player already holds when the event opens. Everything after this is EARNED.'),
    ('Cash-Out Variant', 'A', 'in', 'A: bank at any node. B: bank only on safe nodes.'),
    ('Event Duration (days)', 3, 'in', 'Length of ONE instance. The event is always-on today: '
                                       'cal_new row 22 is a single merged 33-day lane.'),
]
for name, val, kind, meaning in run_rows:
    ws.cell(r, 1, name).font = ARIAL(size=10)
    put(r, 2, val, kind)
    ws.cell(r, 3, meaning).font = ARIAL(size=9, italic=True, color='FF666666')
    RUN[name] = '$B$%d' % r
    r += 1
# 'Runs per Player per Instance' was removed with the recharge it derived from. Runs are no longer
# a config number at all: the engine walks the calendar day by day, banks whatever ToF_Ticket the
# other sources paid that day, and spends up to 'Runs per Active Day'. Read the answer off
# ECOGAINS_TOF(payer,"RUN") below rather than typing one here.
RUNS_ROW = r
r += 1

# ---------------------------------------------------------------- SEGMENT BEHAVIOUR
# MAX is not a real engagement segment: it is the ceiling case -- a player with effectively
# unlimited tickets and coins who never voluntarily stops. It exists to price the deep ladder, which
# no real segment reaches (the deepest measured cash-out is stage 20, and 80% of the ladder's value
# sits on stages 30 and 60). Cash-Out Stage 0 means "never cash out", which the engine already reads
# as "run to the last stage".
SEGMENTS = ['0-9', '10-19', '20-39', '40-99', '100+', 'MAX']
bar(r, 'SEGMENT BEHAVIOUR', 7); r += 1
hdr(r, ['Segment', 'Continue Take-Up', 'Cash-Out Stage', 'Runs per Active Day',
        'Max Continues per Run', 'Coin Balance override',
        'What this row says about this player type']); r += 1
SEG_FIRST = r
BEH_NOTE = {
    '0-9': 'Rarely pays to revive, banks early at the first safe node.',
    '10-19': 'Occasionally revives, pushes one safe node further.',
    '20-39': 'Revives one time in five, comfortable going past the halfway safe node.',
    '40-99': 'Often revives, pushes deep because the coins are affordable.',
    '100+': 'Revives more often than not, so the Pig rarely stops the run.',
    'MAX': 'CEILING CASE, not a real player: always revives, never banks early, and holds enough '
           'coins that price never stops them. Shows what the deep ladder is worth to someone who '
           'actually reaches it.',
}
# Runs per Active Day is a CAP, not the driver. The engine spends whatever tickets the calendar
# paid, up to this many runs a day; 2 matches the old 12-hour recharge cadence.
RUNS_PER_DAY = {'0-9': 2, '10-19': 2, '20-39': 2, '40-99': 2, '100+': 2, 'MAX': 99}
MAX_BEH = {'take': 1.0, 'stop': 0, 'balance': 100000}
for seg in SEGMENTS:
    put(r, 1, seg, 'data')
    put(r, 2, MAX_BEH['take'] if seg == 'MAX' else LAD['take'][seg], 'in', '0%')
    put(r, 3, MAX_BEH['stop'] if seg == 'MAX' else LAD['stop'][seg], 'in')
    put(r, 4, RUNS_PER_DAY[seg], 'in', '0')
    put(r, 5, 0, 'in')
    put(r, 6, MAX_BEH['balance'] if seg == 'MAX' else '', 'in', '#,##0')
    ws.cell(r, 7, BEH_NOTE[seg]).font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
SEG_ROW = {seg: SEG_FIRST + i for i, seg in enumerate(SEGMENTS)}
# Column meanings, written once under the block so nobody has to guess.
for txt in [
    'Continue Take-Up: the chance this player PAYS COINS to revive when a Pig ends their run. '
    'It is not a retention number. At 100% the Pig never stops them and every run reaches the end.',
    'Cash-Out Stage: the node where this player voluntarily stops and banks what they have. '
    'They only get paid if they actually REACH it, because a Pig before then loses everything.',
    'Runs per Active Day: a CAP, not the driver. Tickets are EARNED, so the engine walks the '
    'calendar day by day, banks whatever ToF_Ticket the other sources paid, and spends up to this '
    'many runs. Unspent tickets carry forward with no cap.',
    'Max Continues per Run: 0 means "as many as the CONTINUE COST LADDER has rungs" - the ladder '
    'length is the real cap, because a rung with no price cannot be sold. A number here lowers it.',
    'Coin Balance override: normally BLANK, and the sim reads the four hc_balance percentiles '
    '(p25/p50/p75/p90) for this segment straight from data_econ, walking the run at each and '
    'averaging. A number here replaces all four for this segment - which is how MAX gets a wallet '
    'no real player has.',
]:
    ws.cell(r, 1, txt).font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
r += 1

# ---------------------------------------------------------------- CONTINUE COST LADDER (INPUT)
# Moved above the SIM PART divider: it is something you author, not something the sheet works out.
bar(r, 'CONTINUE COST LADDER', 4); r += 1
for txt in [
    'What it is: the COIN PRICE of reviving after a Pig, within a single run. The first revive in '
    'a run costs row 1, the second costs row 2, and so on. Costs must rise each time (deck p8).',
    'This is an INPUT you author. It is a coin SINK, the only one this event has, and it is how '
    'the feature is meant to make money.',
]:
    ws.cell(r, 1, txt).font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
# The first four rungs are ANCHORED to real wallet percentiles from data_econ, so each one is the
# rung a named slice of the population can still just afford. Pooled across all ten segment/payer
# rows: p25 ~ 50 coins, p50 ~ 99, p75 ~ 258, p90 ~ 716.
#     rung 1 cum   25  - under every segment's p25, so the FIRST continue is affordable to everyone
#     rung 2 cum  100  - the median player
#     rung 3 cum  260  - p75
#     rung 4 cum  720  - p90
# Past that the population has run out, so growth is a plain multiplier and the rungs exist for the
# MAX case. The CAP is expressed as a rung INDEX, not a price: change the multiplier and the ceiling
# re-derives itself instead of needing a new number invented for it.
CONT_ANCHORED = [25, 75, 160, 460]      # percentile-anchored, authored
CONT_MULT     = 2.5                     # growth per rung past the anchored four
CONT_CAP_RUNG = 7                       # growth STOPS at this rung; later rungs repeat its price
CONT_RUNGS    = 10
for txt in [
    'The first four rungs are priced against real wallets (data_econ hc_balance): rung 1 sits under '
    'every segment p25 so the first continue always feels affordable, and rungs 2-4 sit at the p50, '
    'p75 and p90 cumulative. Rung 5 onward is where the population has run out.',
    'Growth multiplier and "growth stops after rung" are INPUTS. The cap is a rung INDEX rather '
    'than a price, so changing the multiplier moves the ceiling with it and no new cap has to be '
    'invented. Rungs past the cap repeat the capped price - a revive never gets more expensive '
    'than the cap, it just stays there.',
]:
    ws.cell(r, 1, txt).font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
ws.cell(r, 1, 'Growth multiplier (rung 5+)').font = ARIAL(size=10)
put(r, 2, CONT_MULT, 'in', '0.0"x"'); MULT_REF = '$B$%d' % r; r += 1
ws.cell(r, 1, 'Growth stops after rung #').font = ARIAL(size=10)
put(r, 2, CONT_CAP_RUNG, 'in'); CAP_REF = '$B$%d' % r; r += 1
r += 1
hdr(r, ['Continue # in this run', 'Cost (Coins)', 'Cumulative if they revive this many times']); r += 1
CONT_FIRST = r
for i in range(1, CONT_RUNGS + 1):
    put(r, 1, i, 'data')
    if i <= len(CONT_ANCHORED):
        put(r, 2, CONT_ANCHORED[i - 1], 'in')
    else:
        # Grow from the LAST ANCHORED rung by an exponent that stops climbing at the cap. Chaining
        # off the row above instead (=IF(rung>cap, <capped row>, prev*mult)) makes the capped rung's
        # own formula name its own cell, which Sheets reports as a circular reference even though
        # the branch is never taken. This form references only fixed cells above it, and both the
        # multiplier AND the cap rung stay live inputs.
        #   price_i = anchor_last x mult ^ clamp(i - n_anchored, 0, cap - n_anchored)
        anchor_row = CONT_FIRST + len(CONT_ANCHORED) - 1
        n = len(CONT_ANCHORED)
        put(r, 2, '=ROUND($B${ar}*{mult}^MAX(0,MIN($A{row}-{n},{cap}-{n})),0)'.format(
            ar=anchor_row, mult=MULT_REF, row=r, n=n, cap=CAP_REF), 'out', '#,##0')
    put(r, 3, '=SUM($B${a}:$B{r})'.format(a=CONT_FIRST, r=r), 'out', '#,##0')
    r += 1
CONT_LAST = r - 1
r += 1

# ---------------------------------------------------------------- STAGES
NODE_LEAD = ['Stage', 'Type', 'Tier', 'Choices', 'Reward Slots', 'Pig Slots', 'Empty Slots',
             'Survive p', 'P(reward | survived)']
bar(r, 'STAGES', len(NODE_LEAD) + len(REWARD_COLS)); r += 1
for txt in [
    'One row per node. Pig Slots rises with depth (1 for stages 1 to 20, 2 for 21 to 40, 3 for 41 '
    'to 60) and never goes above 3, so later nodes are far more dangerous. Safe nodes carry none.',
    'Which door hides the Pig is drawn at random when the player arrives, so only the COUNT is '
    'configurable, never the position.',
    'Rewards are tuned so the event pays each segment roughly 75% of what Rainbow Maker pays, '
    'allowing for 3 days against Rainbow Maker 4. See builders/_md_ladder.py for the solve.',
]:
    ws.cell(r, 1, txt).font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
hdr(r, NODE_LEAD + REWARD_COLS); r += 1
NODE_FIRST = r
NODE_C0 = len(NODE_LEAD) + 1
for st in range(1, TOTAL_STAGES + 1):
    row = NODE_FIRST + st - 1
    put(row, 1, st, 'data')
    put(row, 2, ('=IF(A{r}=1,"Safe (Start)",IF(OR(A{r}={maj},A{r}={asp}),"Milestone",'
                 'IF(AND({every}>0,MOD(A{r},{every})=0),"Safe","Standard")))').format(
        r=row, maj=RUN['Major Milestone Stage'], asp=RUN['Aspirational Milestone Stage'],
        every=RUN['Safe Stage Every N Stages']))
    put(row, 3, '=MIN({nt},MAX(1,ROUNDUP(A{r}/{ts},0)))'.format(
        r=row, nt=N_TIERS, ts=RUN['Reward Tier Size (stages)']))
    put(row, 4, '=%s' % RUN['Choices per Stage (default)'], 'in')
    # Pig ramp: 1 / 2 / 3 by tier pair, never above 3, and never on a safe node.
    put(row, 6, '=IF($B{r}<>"Standard",0,MIN(3,MAX({p},IF($C{r}<=2,1,IF($C{r}<=4,2,3)))))'.format(
        r=row, p=RUN['Failure Outcomes per Stage']))
    put(row, 7, 0, 'in')
    put(row, 5, '=MAX(0,$D{r}-$F{r}-$G{r})'.format(r=row))
    put(row, 8, '=IF($D{r}<=0,0,($D{r}-$F{r})/$D{r})'.format(r=row), 'out', '0.0%')
    put(row, 9, '=IF($D{r}-$F{r}<=0,0,$E{r}/($D{r}-$F{r}))'.format(r=row), 'out', '0.0%')
    payout = LADDER[st - 1]
    for j, res in enumerate(REWARD_COLS):
        put(row, NODE_C0 + j, payout.get(RES_ALIAS.get(res, res), 0), 'in')
NODE_LAST = NODE_FIRST + TOTAL_STAGES - 1
NODE_NCOL = len(NODE_LEAD) + len(REWARD_COLS)
ws.conditional_formatting.add(
    'A%d:%s%d' % (NODE_FIRST, CL(NODE_NCOL), NODE_LAST),
    FormulaRule(formula=['$F%d=0' % NODE_FIRST], fill=fill('FFE8F5E9')))
ws.conditional_formatting.add(
    'F%d:F%d' % (NODE_FIRST, NODE_LAST),
    CellIsRule(operator='greaterThanOrEqual', formula=['2'], fill=fill('FFF4CCCC')))
ws.conditional_formatting.add(
    '%s%d:%s%d' % (CL(NODE_C0), NODE_FIRST, CL(NODE_NCOL), NODE_LAST),
    CellIsRule(operator='greaterThan', formula=['0'], fill=fill('FFD9EAD3'),
               font=ARIAL(size=10, bold=True)))
r = NODE_LAST + 2

# ================================================================ SIM PART

# ---------------------------------------------------------------- SIM PART (engine spills)
# Everything below is SPILLED BY THE ENGINE, not computed in formulas.
#
# It used to be four formula blocks -- PER-SEGMENT PROGRESSION, RUN EXPECTATION, CUMULATIVE REWARD
# and PLAYER REACH SIMULATION -- carrying a survival recursion in ~2,000 cells. They were removed
# 2026-09-02 because they had become a SECOND, DISAGREEING model: they blend survive-and-revive into
# one number, which cannot price a continue ladder whose rungs escalate (it never knows which rung
# you are on), cannot see the player's wallet, and cannot express the payer top-up. The engine walks
# (stage, continues used, top-ups used) at four wallet percentiles and averages. Two models on one
# sheet is the bug we keep re-finding, so there is now one.
bar(r, 'SIM PART  —  spilled by ECOGAINS_TOF, do not type here', 12); r += 1
for txt in [
    'Everything below is written by the engine. The yellow cells above are the only inputs.',
    'Payer picks which flag the three blocks are computed for. The trailing sim_refresh!$A$1 in each '
    'formula is the refresh nonce: Google only re-runs a custom function when its ARGUMENTS change, '
    'so without it an edit to the ladder above would leave a stale spill sitting here.',
]:
    ws.cell(r, 1, txt).font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
ws.cell(r, 1, 'Payer').font = ARIAL(size=10, bold=True)
put(r, 2, 'NONPAYER', 'in')
PAYER_REF = '$B$%d' % r
ws.cell(r, 3, 'NONPAYER or PAYER.').font = ARIAL(size=9, italic=True, color='FF666666')
r += 2

# A spill OWNS the rows under its anchor, so the next block has to start past them or Sheets
# reports #REF! and writes nothing. Reserve exactly what the engine returns, plus a gap.
def spill(title, block, notes, rows):
    global r
    bar(r, title, 8); r += 1
    for t in notes:
        ws.cell(r, 1, t).font = ARIAL(size=9, italic=True, color='FF666666')
        r += 1
    ws.cell(r, 1, '=ECOGAINS_TOF({p}, "{b}", sim_refresh!$A$1)'.format(p=PAYER_REF, b=block)).font =         ARIAL(size=10)
    first = r
    r += rows + 2
    return first

RUN_SPILL = spill('RUN ECONOMICS', 'RUN', [
    'One row per segment: runs taken in the 33-day window, the chance a run pays anything at all, '
    'the coins spent on continues per run and across the window, and the ticket flow.',
    'Runs are NOT a config number. The engine banks whatever ToF_Ticket the rest of the calendar '
    'paid that day and spends it, up to Runs per Active Day, carrying leftovers forward.',
    'MAX spills BLANK in the window columns: data_seg_beh has no MAX row, so there are no activity '
    'rates to price reach with. Its per-run columns are the point of it.',
], 1 + len(SEGMENTS))
REW_SPILL = spill('BANKED REWARD PER RUN', 'REWARD', [
    'What one run actually banks, per resource, already multiplied by the chance of banking it. '
    'A run that meets a Pig and stops pays NOTHING, so these are well below the ladder face value.',
], 1 + len(REWARD_COLS) + 4)   # engine spills one row per RESOURCE
GS_SPILL = spill('GAIN VS SPEND', 'GAINSPEND', [
    'Per stage and per segment: gain (raw) is what the ladder holds if you get there; gain (exp) '
    'prices in the chance of getting there AND banking it; spend is the expected coins paid for '
    'continues along the way; net is exp minus spend.',
    'Net is in COINS, not a percentage. The ratio version reached +53,190% at stage 60 and no chart '
    'survives that -- the crossover point is the thing this block exists to show.',
    'Rows past a segment cash-out stage are BLANK, not zero: that player stops before them, so a '
    'flat negative net across stages nobody plays would read as a loss that never happens.',
    'Values come from item_vals, so SPT and boosters count -- coins alone are a small part of what '
    'this event pays.',
], 1 + (NODE_LAST - NODE_FIRST + 1))


ws.column_dimensions['A'].width = 30.0
ws.column_dimensions['B'].width = 20.0
ws.column_dimensions['C'].width = 18.0
for c in range(4, 4 + len(REWARD_COLS) + 30):
    ws.column_dimensions[CL(c)].width = 12.0

out = os.path.join(DISPLAY, 'ToF_v1.xlsx')
wb.save(out)
print('written ToF_v1.xlsx  (sheet "ToF")')
print('  RUN CONFIG        rows %d..%d' % (RUN_FIRST, RUNS_ROW))
print('  SEGMENT BEHAVIOUR rows %d..%d' % (SEG_FIRST, SEG_FIRST + len(SEGMENTS) - 1))
print('  CONTINUE COSTS    rows %d..%d   (INPUT, above the SIM PART divider)' % (CONT_FIRST, CONT_LAST))
print('  STAGES            rows %d..%d' % (NODE_FIRST, NODE_LAST))
print('  SIM PART          RUN row %d, REWARD row %d, GAIN VS SPEND row %d  (engine spills)'
      % (RUN_SPILL, REW_SPILL, GS_SPILL))
print('  the four formula sim blocks are GONE - one model, in the engine')
