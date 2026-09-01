# Builds MD_v1.xlsx — the 'MD' config sheet for Mighty Doors (Tower of Fortune), the push-your-luck
# event from design_pdfs/DRBL-Mighty Doors (DB Tower of Fortune)-010926-212845.pdf.
# See source_docs/mighty-doors.md for the mechanics this encodes.
#
# REWARDS LIVE ON THE NODES (rewritten 2026-09-02 after review)
#   Every config sheet in this workbook defines rewards per NODE with the full 21-column grammar:
#   RM_1st_v2 one row per milestone, HH_v2 one row per gate, NS_v2 one row per streak milestone.
#   The first draft of this sheet grouped rewards into six TIER rows, which was an invention. There
#   is now one row per stage, 60 of them, each carrying all 21 reward columns. 'Tier' survives only
#   as a derived reference column.
#
# SLOT COMPOSITION, NOT SLOT POSITION
#   Deck p5: "The Failure outcome can appear randomly in any of the available choice positions."
#   Which door hides the Pig is therefore a runtime draw and cannot be configured. What a node CAN
#   declare is how many doors it has and how many of those are Pig / Reward / Empty - the slot
#   composition. 'Slots OK?' self-checks that the three add up to Choices, because if they do not,
#   every survival number below it is meaningless and nothing else would say so.
#   Empty slots are not failures: they end the stage with no reward and no loss. That is why
#   survival and P(reward | survived) are two separate derived columns rather than one.
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

TOTAL_STAGES = 60
N_TIERS = 6

F_BAR, F_HDR, F_IN, F_OUT, F_DATA = 'FF000000', 'FFF7CB4D', 'FFFFF2CC', 'FFE2EFDA', 'FFCFE2F3'
fill = lambda rgb: PatternFill('solid', fgColor=rgb)
ARIAL = lambda **kw: Font(name='Arial', **kw)
thin = Side(style='thin')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'MD'
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


ws['A1'] = 'MIGHTY DOORS (Tower of Fortune) — event configuration'
ws['A1'].font = ARIAL(size=14, bold=True)
note(2, 'Yellow = input you author. Green = derived by formula, do not type over. Blue = fixed by '
        'the design deck. Every reward VALUE ships at 0: the deck specifies structure only.')

r = 4

# ---------------------------------------------------------------- RUN CONFIG
bar(r, 'RUN CONFIG', 4); r += 1
hdr(r, ['Parameter', 'Value', 'Source', 'Note']); r += 1
RUN_FIRST = r
RUN = {}
run_rows = [
    ('Total Stages',                60,    'data', 'deck p5', 'configurable; 60 default'),
    ('Choices per Stage (default)', 4,     'in',   'deck p5', 'min 2, max 4 — the primary difficulty dial'),
    ('Failure Outcomes per Stage',  1,     'data', 'deck p5', 'HARD RULE: only one Pig can ever appear per stage'),
    ('Safe Stage Every N Stages',   5,     'in',   'deck p6', 'stages 5,10,15,... carry no Pig'),
    ('Major Milestone Stage',       30,    'in',   'deck p6', 'safe, Special rewards'),
    ('Aspirational Milestone Stage', 60,   'in',   'deck p6', 'safe, Higher rewards; completing it auto-claims'),
    ('Reward Tier Size (stages)',   10,    'in',   'deck p6', 'six tiers: 1-10, 11-20, ... 51-60 (reference only — rewards are per NODE)'),
    ('Tickets per Run',             1,     'in',   'deck p9', 'no storage cap exists for tickets'),
    ('Empty Outcomes Enabled',      'FALSE', 'in', 'deck p22', 'supported but off by default; set Empty Slots per node to use them'),
    ('Cash-Out Variant',            'A',   'in',   'deck p23', 'A = cash out after any successful stage · B = safe stages only (A/B pending)'),
    ('Event Duration (days)',       0,     'in',   'UNKNOWN',  '⚠ deck gives no default — blocks the calendar lane and T'),
    ('Runs per Player per Instance', 0,    'in',   'UNKNOWN',  '⚠ set by ticket supply, which is unconfigured — the faucet scales linearly with this'),
]
for name, val, kind, src, nt in run_rows:
    ws.cell(r, 1, name).font = ARIAL(size=10)
    put(r, 2, val, kind)
    ws.cell(r, 3, src).font = ARIAL(size=9, color='FF666666')
    ws.cell(r, 4, nt).font = ARIAL(size=9, italic=True, color='FF666666')
    RUN[name] = '$B$%d' % r
    r += 1
r += 1

# ---------------------------------------------------------------- SEGMENT BEHAVIOUR
SEGMENTS = ['0-9', '10-19', '20-39', '40-99', '100+']
bar(r, 'SEGMENT BEHAVIOUR (no telemetry exists — these are the answer, not a detail)', 6); r += 1
note(r, 'What separates player types in this event. Mighty Doors has no accrual — a run is walked '
        'in one sitting — so a whale and a new player differ only in how often they pay to continue '
        'and how deep they push before cashing out. Deck p2: the feature exists to create '
        '"additional spending opportunities for whales and highly engaged players".'); r += 1
hdr(r, ['Segment', 'Continue Take-Up', 'Cash-Out Stage', 'Runs per Active Day',
        'Max Continues per Run', 'Note']); r += 1
SEG_FIRST = r
for seg in SEGMENTS:
    put(r, 1, seg, 'data')
    put(r, 2, 0, 'in', '0.0%')      # P(pay to continue when the Pig appears)
    put(r, 3, 0, 'in')              # stage this segment walks away at (0 = never cashes out)
    put(r, 4, 0, 'in', '0.00')      # runs started per active day — set by ticket supply
    put(r, 5, 0, 'in')              # 0 = unlimited (user decision 2026-09-02)
    ws.cell(r, 6, 'take-up 1.0 removes the Pig entirely for this segment'
            if seg == '100+' else '').font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
SEG_ROW = {seg: SEG_FIRST + i for i, seg in enumerate(SEGMENTS)}
r += 1

# ---------------------------------------------------------------- STAGE NODES
# One row per node with the full 21-column reward grammar, exactly like RM_1st_v2's milestone rows,
# HH_v2's gates and NS_v2's streak milestones. Tier-level reward blocks were a departure from the
# house pattern and are gone: the tier is now a derived REFERENCE column only.
#
# SLOT COMPOSITION, not slot POSITION. Deck p5: "The Failure outcome can appear randomly in any of
# the available choice positions" — so which door hides the Pig is a runtime draw, not config. What
# a node declares is how many doors it has and how many of them are Pig / Reward / Empty. 'Slots OK?'
# is a self-check: the three must add up to Choices, or the survival maths below is meaningless.
NODE_LEAD = ['Stage', 'Type', 'Tier', 'Choices', 'Reward Slots', 'Pig Slots', 'Empty Slots',
             'Slots OK?', 'Survive p', 'P(reward | survived)']
bar(r, 'STAGE NODES — one row per node, rewards in the standard 21-column grammar',
    len(NODE_LEAD) + len(REWARD_COLS)); r += 1
note(r, 'Author the reward behind a REWARD door at each node. Pig Slots is the slot COMPOSITION — '
        'the deck places the Pig randomly among the doors, so position is not configurable. Empty '
        'Slots pay nothing and are not a failure, which is why survival and reward-odds are two '
        'separate columns.'); r += 1
hdr(r, NODE_LEAD + REWARD_COLS); r += 1
NODE_FIRST = r
NODE_C0 = len(NODE_LEAD) + 1                        # first reward column (K)
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
    put(row, 6, '=IF($B{r}="Standard",{p},0)'.format(r=row, p=RUN['Failure Outcomes per Stage']))
    put(row, 7, 0, 'in')                            # empty slots — off unless authored
    put(row, 5, '=MAX(0,$D{r}-$F{r}-$G{r})'.format(r=row))          # rewards fill what is left
    put(row, 8, '=IF($E{r}+$F{r}+$G{r}=$D{r},"OK","MISMATCH")'.format(r=row))
    put(row, 9, '=IF($D{r}<=0,0,($D{r}-$F{r})/$D{r})'.format(r=row), 'out', '0.0%')
    put(row, 10, '=IF($D{r}-$F{r}<=0,0,$E{r}/($D{r}-$F{r}))'.format(r=row), 'out', '0.0%')
    for j in range(len(REWARD_COLS)):
        put(row, NODE_C0 + j, 0, 'in')
NODE_LAST = NODE_FIRST + TOTAL_STAGES - 1
NODE_NCOL = len(NODE_LEAD) + len(REWARD_COLS)
# A safe node (no Pig) is tinted by RULE, and a bad slot composition is shouted about.
ws.conditional_formatting.add(
    'A%d:%s%d' % (NODE_FIRST, CL(NODE_NCOL), NODE_LAST),
    FormulaRule(formula=['$F%d=0' % NODE_FIRST], fill=fill('FFE8F5E9')))
ws.conditional_formatting.add(
    'H%d:H%d' % (NODE_FIRST, NODE_LAST),
    CellIsRule(operator='equal', formula=['"MISMATCH"'], fill=fill('FFF4CCCC'),
               font=ARIAL(size=10, bold=True)))
ws.conditional_formatting.add(
    '%s%d:%s%d' % (CL(NODE_C0), NODE_FIRST, CL(NODE_NCOL), NODE_LAST),
    CellIsRule(operator='greaterThan', formula=['0'], fill=fill('FFD9EAD3'),
               font=ARIAL(size=10, bold=True)))
r = NODE_LAST + 2

# ---------------------------------------------------------------- PER-SEGMENT PROGRESSION
SEG_SUB = ['Survive (w/ cont.)', 'Reach p', 'P(end here)', 'Cum P(ended)']
SEG_C0 = 2
bar(r, 'PER-SEGMENT PROGRESSION (derived from STAGE NODES + SEGMENT BEHAVIOUR)',
    1 + len(SEGMENTS) * len(SEG_SUB)); r += 1
note(r, 'The tower is the same for everyone; the odds of getting anywhere are not. A segment that '
        'always continues never meets the Pig at all. Cum P(ended) is what the reach simulation '
        'reads for its percentile.'); r += 1
hdr(r, ['Stage'])
for i, seg in enumerate(SEGMENTS):
    for j, lbl in enumerate(SEG_SUB):
        cell = ws.cell(r, SEG_C0 + i * len(SEG_SUB) + j, seg + ' ' + lbl)
        cell.font = ARIAL(size=9, bold=True); cell.fill = fill(F_HDR); cell.border = BOX
        cell.alignment = Alignment(horizontal='center', wrap_text=True, vertical='center')
r += 1
PRG_FIRST = r
for st in range(1, TOTAL_STAGES + 1):
    row = PRG_FIRST + st - 1
    nrow = NODE_FIRST + st - 1
    put(row, 1, '=$A{n}'.format(n=nrow), 'data')
    for i, seg in enumerate(SEGMENTS):
        c0 = SEG_C0 + i * len(SEG_SUB)
        C = lambda k: CL(c0 + k)
        take, stop = '$B$%d' % SEG_ROW[seg], '$C$%d' % SEG_ROW[seg]
        put(row, c0 + 0, '=$I{n}+(1-$I{n})*{t}'.format(n=nrow, t=take), 'out', '0.0%')
        if st == 1:
            put(row, c0 + 1, 1, 'out', '0.000%')
        else:
            p = row - 1
            put(row, c0 + 1, '={c1}{p}*{c0}{p}*IF(AND({s}>0,$A{p}>={s}),0,1)'.format(
                c1=C(1), c0=C(0), p=p, s=stop), 'out', '0.000%')
        put(row, c0 + 2, ('={c1}{r}*(IF(AND({s}>0,$A{r}>={s}),{c0}{r},0)+(1-$I{n})*(1-{t}))').format(
            c1=C(1), c0=C(0), r=row, n=nrow, s=stop, t=take), 'out', '0.000%')
        put(row, c0 + 3, '=SUM({c2}${f}:{c2}{r})'.format(c2=C(2), f=PRG_FIRST, r=row), 'out', '0.000%')
PRG_LAST = PRG_FIRST + TOTAL_STAGES - 1
r = PRG_LAST + 2

# ---------------------------------------------------------------- RUN EXPECTATION
bar(r, 'RUN EXPECTATION BY PLAYER TYPE (derived)', 1 + len(SEGMENTS)); r += 1
note(r, 'Rewards banked in a run are LOST on an un-continued Pig (deck p7), so "pays anything" is '
        'not the same as "reaches a stage". A segment that never cashes out and never continues '
        'walks away with nothing almost every run, however rich the ladder is.'); r += 1
hdr(r, ['Metric'] + SEGMENTS); r += 1
EXP_FIRST = r
SC = lambda i, k: CL(SEG_C0 + i * len(SEG_SUB) + k)
exp_rows = [
    ('P(reach Major Milestone)',
     lambda i, seg: '=IFERROR(INDEX({c}{a}:{c}{b},MATCH({m},$A{a}:$A{b},0)),0)'.format(
         c=SC(i, 1), a=PRG_FIRST, b=PRG_LAST, m=RUN['Major Milestone Stage']), '0.000%'),
    ('P(reach Final Stage)',
     lambda i, seg: '=IFERROR(INDEX({c}{a}:{c}{b},MATCH({m},$A{a}:$A{b},0)),0)'.format(
         c=SC(i, 1), a=PRG_FIRST, b=PRG_LAST, m=RUN['Aspirational Milestone Stage']), '0.00000%'),
    ('P(run pays NOTHING)',
     lambda i, seg: '=SUMPRODUCT({c}{a}:{c}{b},(1-$I${nf}:$I${nl}),(1-$B${sr}))'.format(
         c=SC(i, 1), a=PRG_FIRST, b=PRG_LAST, nf=NODE_FIRST, nl=NODE_LAST,
         sr=SEG_ROW[seg]), '0.0%'),
    # EXP_FIRST + 2, not r + 2: these lambdas are called inside the loop that increments r, so a
    # relative reference late-binds to whatever row the loop has reached.
    ('P(run pays ANYTHING)',
     lambda i, seg: '=1-{c}{r}'.format(c=CL(2 + i), r=EXP_FIRST + 2), '0.0%'),
    ('Expected stage reached',
     lambda i, seg: '=SUM({c}{a}:{c}{b})'.format(c=SC(i, 1), a=PRG_FIRST, b=PRG_LAST), '0.00'),
    ('Expected continues per run',
     lambda i, seg: '=SUMPRODUCT({c}{a}:{c}{b},(1-$I${nf}:$I${nl}),$B${sr})'.format(
         c=SC(i, 1), a=PRG_FIRST, b=PRG_LAST, nf=NODE_FIRST, nl=NODE_LAST,
         sr=SEG_ROW[seg]), '0.000'),
    # Single source of truth for "how far does this player type get": both the cumulative reward
    # helper and the AH1 reach simulation read THIS row rather than recomputing it.
    ('Stage reached at percentile',
     lambda i, seg: '=MIN({t},COUNTIF({c}{a}:{c}{b},"<"&$AI$2)+1)'.format(
         t=TOTAL_STAGES, c=SC(i, 3), a=PRG_FIRST, b=PRG_LAST), '0'),
]
for name, fn, numfmt in exp_rows:
    ws.cell(r, 1, name).font = ARIAL(size=10, bold=True)
    for i, seg in enumerate(SEGMENTS):
        put(r, 2 + i, fn(i, seg), 'out', numfmt)
    r += 1
PCT_ROW = r - 1
r += 1

# ---------------------------------------------------------------- CUMULATIVE REWARD
bar(r, 'CUMULATIVE REWARD AT THE REACHED STAGE (derived)', 1 + len(SEGMENTS)); r += 1
note(r, 'Everything a segment has banked by its reached stage: every node up to it, each weighted '
        'by the odds that door held a reward rather than an empty. One SUMPRODUCT per resource — '
        'no tier bookkeeping, because rewards live on the nodes now.'); r += 1
hdr(r, ['Resource'] + SEGMENTS); r += 1
CUM_FIRST = r
for k, res in enumerate(REWARD_COLS):
    ws.cell(r, 1, res).font = ARIAL(size=10)
    col = CL(NODE_C0 + k)
    for i, seg in enumerate(SEGMENTS):
        m = '{c}${pr}'.format(c=CL(2 + i), pr=PCT_ROW)
        put(r, 2 + i, '=SUMPRODUCT(($A${a}:$A${b}<={m})*$J${a}:$J${b}*{c}${a}:{c}${b})'.format(
            a=NODE_FIRST, b=NODE_LAST, m=m, c=col), 'out', '0.00')
    r += 1
CUM_LAST = r - 1
r += 1

# ---------------------------------------------------------------- CONTINUE COSTS
bar(r, 'CONTINUE COST LADDER (this is a COIN SINK, not a faucet)', 4); r += 1
note(r, 'Deck p8/p24: costs MUST escalate after each consecutive continue within the same run; the '
        'curve is configurable and undefined. Unlimited continues (user, 2026-09-02).'); r += 1
hdr(r, ['Continue #', 'Cost (Coins)', 'Cumulative', 'Note']); r += 1
CONT_FIRST = r
for i in range(1, 11):
    put(r, 1, i, 'data')
    put(r, 2, 0, 'in')
    put(r, 3, '=SUM($B${a}:$B{r})'.format(a=CONT_FIRST, r=r), 'out')
    if i == 1:
        ws.cell(r, 4, 'first continue in a run').font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
ws.conditional_formatting.add('B%d:B%d' % (CONT_FIRST, r - 1),
                              CellIsRule(operator='greaterThan', formula=['0'], fill=fill('FFF4CCCC')))
r += 1

# ---------------------------------------------------------------- REWARD POOL MAP
bar(r, 'REWARD POOL MAP (deck p7 -> the 19-resource sim universe)', 3); r += 1
note(r, 'Why some deck rewards have no column above: they are outside the resource universe. '
        'Recorded so the omission reads as a decision, not an oversight.'); r += 1
hdr(r, ['Deck reward', 'Sim resource', 'Modelled?']); r += 1
for deck_name, sim_res, modelled in [
    ('Coins', 'Coins', 'yes'),
    ('Boosters', 'Red / Chuck / Bomb', 'yes'),
    ('Power-ups', 'Slingshot / Shuffle / Comet', 'yes'),
    ('Unlimited Lives', 'Unlimited Lives', 'yes'),
    ('Event Tokens', 'SPT / SPT x2', 'yes — feeds the Season Pass tier coupling (D16)'),
    ('Dream Album Envelopes', '1-star Dly .. 6-star Dly', 'yes — routes through packLane_, inherits the D26 cutoff'),
    ('Avatars', 'Avatar', 'column exists; no economy value in the model'),
    ('Album Badges', '—', 'NO — no sim resource'),
    ('Event Tickets', '—', "NO — tickets are this feature's own entry currency, outside the 19"),
    ('Skins', '—', 'NO — deck lists as FUTURE'),
    ('Frames', '—', 'NO — deck lists as FUTURE'),
]:
    put(r, 1, deck_name, 'data')
    put(r, 2, sim_res, 'data')
    ws.cell(r, 3, modelled).font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1

# ------------------------------------------- PLAYER REACH SIMULATION (AH1, house grammar)
# Anchored at AH1 with EXACTLY the layout every other collection _v2 sheet uses, so anyone who can
# read HH_v2 or RM_1st_v2 can read this one. Note the last pair is '100_ms' / '100_reward' — no plus
# sign — because that is what the other sheets write.
RS_C = 34                                    # AH
ws.cell(1, RS_C, 'Player Reach Simulation (per event day) - SIMULATED').font = ARIAL(size=11, bold=True)
ws.cell(2, RS_C, 'Percentile').font = ARIAL(size=10, bold=True)
put(2, RS_C + 1, 0.5, 'in', '0.00')
ws.cell(3, RS_C, 'Payer').font = ARIAL(size=10, bold=True)
put(3, RS_C + 1, 'NONPAYER', 'in')
ws.cell(4, RS_C, 'stage reached at that percentile of the run-outcome distribution; reward = what '
                 'is banked there').font = ARIAL(size=9, italic=True, color='FF666666')
rs_hdr = ['Day_of_event']
for seg in SEGMENTS:
    lbl = seg[:-1] if seg.endswith('+') else seg          # house writes '100_ms', not '100+_ms'
    rs_hdr += [lbl + '_ms', lbl + '_reward']
for j, t in enumerate(rs_hdr):
    c = ws.cell(5, RS_C + j, t)
    c.font = ARIAL(size=10, bold=True); c.fill = fill(F_HDR); c.border = BOX
    c.alignment = Alignment(horizontal='center', wrap_text=True, vertical='center')

RS_DAYS = 14
dur = RUN['Event Duration (days)']
for d in range(1, RS_DAYS + 1):
    row = 5 + d
    put(row, RS_C, d, 'data')
    for i, seg in enumerate(SEGMENTS):
        put(row, RS_C + 1 + i * 2, '=IF(AND({dur}>0,$AH{r}>{dur}),"",{c}${pr})'.format(
            dur=dur, r=row, c=CL(2 + i), pr=PCT_ROW), 'out')
        put(row, RS_C + 2 + i * 2,
            ('=IF({msc}{r}="","","{{"&TEXTJOIN(", ",TRUE,IF({cc}${cf}:{cc}${cl}>0,'
             '$A${cf}:$A${cl}&": "&{cc}${cf}:{cc}${cl},""))&"}}")').format(
                msc=CL(RS_C + 1 + i * 2), r=row, cc=CL(2 + i), cf=CUM_FIRST, cl=CUM_LAST), 'out')

ws.column_dimensions['A'].width = 30.0
ws.column_dimensions['B'].width = 22.0
ws.column_dimensions['C'].width = 20.0
ws.column_dimensions['D'].width = 20.0
for c in range(5, 5 + len(REWARD_COLS) + 30):
    ws.column_dimensions[CL(c)].width = 12.0

out = os.path.join(DISPLAY, 'MD_v1.xlsx')
wb.save(out)
print('written MD_v1.xlsx  (sheet "MD")')
print('  RUN CONFIG            rows %d..%d' % (RUN_FIRST, RUN_FIRST + len(run_rows) - 1))
print('  STAGE NODES           rows %d..%d  (%d nodes x %d reward cols)'
      % (NODE_FIRST, NODE_LAST, TOTAL_STAGES, len(REWARD_COLS)))
print('  PER-SEGMENT PROGRESS  rows %d..%d' % (PRG_FIRST, PRG_LAST))
print('  RUN EXPECTATION       rows %d..%d   (percentile stage on row %d)'
      % (EXP_FIRST, PCT_ROW, PCT_ROW))
print('  CUMULATIVE REWARD     rows %d..%d' % (CUM_FIRST, CUM_LAST))
print('  reach simulation at AH1; every reward cell ships 0')
print('  duplicate the imported sheet as "MD_v2" before wiring the engine')
