# Builds MD_v1.xlsx — the 'MD' config sheet for Mighty Doors (Tower of Fortune), the push-your-luck
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
    ('Reward Tier Size (stages)',   10,    'in',   'deck p6', 'six tiers: 1-10, 11-20, ... 51-60'),
    ('Tickets per Run',             1,     'in',   'deck p9', 'no storage cap exists for tickets'),
    ('Empty Outcomes Enabled',      'FALSE', 'in', 'deck p22', 'supported but off by default; changes the EV maths if on'),
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

# ---------------------------------------------------------------- BEHAVIOUR ASSUMPTIONS
bar(r, 'BEHAVIOUR ASSUMPTIONS (no telemetry exists — these are the answer, not a detail)', 4); r += 1
note(r, 'These two numbers move the result more than every reward value combined. They are printed '
        'on every harness run for the same reason PACK_PARTICIPATION is (D25).'); r += 1
hdr(r, ['Parameter', 'Value', 'Source', 'Note']); r += 1
beh_rows = [
    ('Continue Take-Up Rate', 0, 'in', 'ASSUMPTION',
     'P(player pays to continue when a Pig appears). At 1.0 the Pig stops mattering and every run reaches the final stage.'),
    ('Max Continues per Run', 0, 'in', 'user 2026-09-02',
     '0 = UNLIMITED (current decision). Deck p24 leaves the cap "Decision Pending".'),
]
BEH = {}
for name, val, kind, src, nt in beh_rows:
    ws.cell(r, 1, name).font = ARIAL(size=10)
    put(r, 2, val, kind, '0.00%' if 'Rate' in name else None)
    ws.cell(r, 3, src).font = ARIAL(size=9, color='FF666666')
    ws.cell(r, 4, nt).font = ARIAL(size=9, italic=True, color='FF666666')
    BEH[name] = '$B$%d' % r
    r += 1
r += 1

# ---------------------------------------------------------------- STAGE CONFIG
STAGE_COLS = ['Stage', 'Type', 'Choices', 'Pigs', 'Tier', 'Survive p', 'Survive p (w/ cont.)',
              'Cash-Out %', 'Reach p', 'P(cash out here)', 'P(lose it all here)', 'E[continues]']
bar(r, 'STAGE CONFIG', len(STAGE_COLS)); r += 1
note(r, 'Type / Pigs / Tier / Survive / Reach are FORMULAS off the RUN CONFIG panel — change the '
        'panel and all 60 rows follow. Cash-Out % is the one input: it is the stop distribution, '
        'and rewards are LOST on an un-continued Pig, so with no cash-out a run pays ~nothing.'); r += 1
hdr(r, STAGE_COLS); r += 1
STG_FIRST = r
for s in range(1, TOTAL_STAGES + 1):
    row = STG_FIRST + s - 1
    put(row, 1, s, 'data')
    # Type: stage 1 is the safe opener; named milestones; every Nth is safe; else standard.
    put(row, 2, ('=IF(A{r}=1,"Safe (Start)",IF(OR(A{r}={maj},A{r}={asp}),"Milestone",'
                 'IF(AND({every}>0,MOD(A{r},{every})=0),"Safe","Standard")))').format(
        r=row, maj=RUN['Major Milestone Stage'], asp=RUN['Aspirational Milestone Stage'],
        every=RUN['Safe Stage Every N Stages']))
    put(row, 3, '=%s' % RUN['Choices per Stage (default)'], 'in')
    put(row, 4, '=IF($B{r}="Standard",{pigs},0)'.format(r=row, pigs=RUN['Failure Outcomes per Stage']))
    put(row, 5, '=MIN({nt},MAX(1,ROUNDUP(A{r}/{ts},0)))'.format(
        r=row, nt=N_TIERS, ts=RUN['Reward Tier Size (stages)']))
    put(row, 6, '=IF($C{r}<=0,0,($C{r}-$D{r})/$C{r})'.format(r=row), 'out', '0.0%')
    # Continuing removes the Pig and guarantees a reward, so it converts a fail into a survival.
    put(row, 7, '=$F{r}+(1-$F{r})*{c}'.format(r=row, c=BEH['Continue Take-Up Rate']), 'out', '0.0%')
    put(row, 8, 0, 'in', '0.0%')
    if s == 1:
        put(row, 9, 1, 'out', '0.000%')
    else:
        p = row - 1
        put(row, 9, '=$I{p}*$G{p}*(1-$H{p})'.format(p=p), 'out', '0.000%')
    put(row, 10, '=$I{r}*$G{r}*$H{r}'.format(r=row), 'out', '0.000%')
    put(row, 11, '=$I{r}*(1-$F{r})*(1-{c})'.format(r=row, c=BEH['Continue Take-Up Rate']), 'out', '0.000%')
    put(row, 12, '=$I{r}*(1-$F{r})*{c}'.format(r=row, c=BEH['Continue Take-Up Rate']), 'out', '0.0000')
    if s % 2 == 0:                                     # zebra at the logical group level
        for c in range(1, len(STAGE_COLS) + 1):
            ws.cell(row, c).font = ARIAL(size=10, bold=False)
STG_LAST = STG_FIRST + TOTAL_STAGES - 1
# Value-driven styling via conditional formatting, never a static fill: a safe stage is one with
# no Pig, so the rule reads the Pigs column rather than trusting the label.
# FormulaRule, not CellIsRule: the condition tests ANOTHER column ($D, the pig count) rather than
# the cell's own value, so a CellIs rule would compare every cell against TRUE/FALSE instead.
ws.conditional_formatting.add(
    'A%d:L%d' % (STG_FIRST, STG_LAST),
    FormulaRule(formula=['$D%d=0' % STG_FIRST], fill=fill('FFE8F5E9')))
r = STG_LAST + 2

# ---------------------------------------------------------------- RUN EXPECTATION
bar(r, 'RUN EXPECTATION (derived — the numbers that make the design legible)', 4); r += 1
hdr(r, ['Metric', 'Value', 'Formula reads', 'Why it matters']); r += 1
exp_rows = [
    ('Standard stages in the run', '=COUNTIF($B{a}:$B{b},"Standard")'.format(a=STG_FIRST, b=STG_LAST),
     'STAGE CONFIG', 'Each is a 1-in-4 chance of losing everything banked so far.'),
    ('P(reach Major Milestone)',
     '=IFERROR(INDEX($I{a}:$I{b},MATCH({maj},$A{a}:$A{b},0)),0)'.format(a=STG_FIRST, b=STG_LAST, maj=RUN['Major Milestone Stage']),
     'Reach p at stage 30', 'The first genuinely aspirational target.'),
    ('P(reach Final Stage)',
     '=IFERROR(INDEX($I{a}:$I{b},MATCH({asp},$A{a}:$A{b},0)),0)'.format(a=STG_FIRST, b=STG_LAST, asp=RUN['Aspirational Milestone Stage']),
     'Reach p at stage 60', 'Unaided this is ~0.0001% — deep runs are advertising, not income.'),
    ('P(run pays ANYTHING)',
     '=SUM($J{a}:$J{b})+IFERROR(INDEX($I{a}:$I{b},MATCH({asp},$A{a}:$A{b},0)),0)'.format(
         a=STG_FIRST, b=STG_LAST, asp=RUN['Aspirational Milestone Stage']),
     'cash-outs + completion', 'THE diagnostic. With no cash-out and no continues this is ~0: rewards are lost on a Pig.'),
    ('P(run pays NOTHING)', '=SUM($K{a}:$K{b})'.format(a=STG_FIRST, b=STG_LAST),
     'sum of lose-it-all', 'Complement of the above. Should alarm you if it is near 1.'),
    ('Expected stages reached', '=SUM($I{a}:$I{b})'.format(a=STG_FIRST, b=STG_LAST),
     'sum of Reach p', 'How deep a typical run actually goes.'),
    ('Expected continues per run', '=SUM($L{a}:$L{b})'.format(a=STG_FIRST, b=STG_LAST),
     'sum of E[continues]', 'Multiply by the cost ladder below for the COIN SINK this feature creates.'),
]
for name, f, reads, why in exp_rows:
    ws.cell(r, 1, name).font = ARIAL(size=10, bold=True)
    put(r, 2, f, 'out', '0.0000')
    ws.cell(r, 3, reads).font = ARIAL(size=9, color='FF666666')
    ws.cell(r, 4, why).font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
r += 1


def reward_block(r, title, note_text, first_col_labels, rows):
    """A reward ladder in the shared 21-column grammar. Values ship at 0 (nothing is authored yet);
    conditional formatting lights a cell the moment a real number is typed into it."""
    ncol = len(first_col_labels) + len(REWARD_COLS)
    bar(r, title, ncol); r += 1
    note(r, note_text); r += 1
    hdr(r, first_col_labels + REWARD_COLS); r += 1
    first = r
    for lead in rows:
        for i, v in enumerate(lead, start=1):
            put(r, i, v, 'data')
        for j in range(len(REWARD_COLS)):
            put(r, len(lead) + 1 + j, 0, 'in')
        r += 1
    rng = '%s%d:%s%d' % (CL(len(first_col_labels) + 1), first, CL(ncol), r - 1)
    ws.conditional_formatting.add(
        rng, CellIsRule(operator='greaterThan', formula=['0'],
                        fill=fill('FFD9EAD3'), font=ARIAL(size=10, bold=True)))
    return r + 1


r = reward_block(
    r, 'STANDARD STAGE REWARDS BY TIER',
    'Expected payout of ONE reward door at this tier. Deck p6: values rise with tier; p7/p25: no '
    'reward type is restricted to any tier. All 0 until authored — a zero here is "not set yet".',
    ['Tier', 'Stage From', 'Stage To'],
    [(t, (t - 1) * 10 + 1, t * 10) for t in range(1, N_TIERS + 1)])

r = reward_block(
    r, 'SAFE STAGE REWARDS BY TIER',
    'Safe stages carry no Pig and pay "typically more valuable" rewards than standard stages '
    '(deck p6). Separate block because the uplift is a design choice, not a multiplier we can derive.',
    ['Tier', 'Stage From', 'Stage To'],
    [(t, (t - 1) * 10 + 1, t * 10) for t in range(1, N_TIERS + 1)])

r = reward_block(
    r, 'MILESTONE REWARDS',
    'The two named milestones (deck p6). These are the aspirational hooks; note from RUN '
    'EXPECTATION above how rarely they are actually reached without continues.',
    ['Stage', 'Milestone'],
    [(30, 'Major'), (60, 'Aspirational')])

# ---------------------------------------------------------------- CONTINUE COSTS
bar(r, 'CONTINUE COST LADDER (this is a COIN SINK, not a faucet)', 4); r += 1
note(r, 'Deck p8/p24: costs MUST escalate after each consecutive continue within the same run; the '
        'curve is configurable and undefined. Unlimited continues (user, 2026-09-02), so the ladder '
        'runs past any realistic depth — the last authored row repeats for continues beyond it.'); r += 1
hdr(r, ['Continue #', 'Cost (Coins)', 'Cumulative', 'Note']); r += 1
CONT_FIRST = r
for i in range(1, 11):
    put(r, 1, i, 'data')
    put(r, 2, 0, 'in')
    put(r, 3, '=SUM($B${a}:$B{r})'.format(a=CONT_FIRST, r=r), 'out')
    if i == 1:
        ws.cell(r, 4, 'first continue in a run').font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
ws.conditional_formatting.add(
    'B%d:B%d' % (CONT_FIRST, r - 1),
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
    ('Event Tickets', '—', 'NO — tickets are this feature\'s own entry currency, outside the 19'),
    ('Skins', '—', 'NO — deck lists as FUTURE'),
    ('Frames', '—', 'NO — deck lists as FUTURE'),
]:
    put(r, 1, deck_name, 'data')
    put(r, 2, sim_res, 'data')
    ws.cell(r, 3, modelled).font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1

ws.column_dimensions['A'].width = 30.0
ws.column_dimensions['B'].width = 22.0
ws.column_dimensions['C'].width = 20.0
ws.column_dimensions['D'].width = 34.0
for c in range(5, 5 + len(REWARD_COLS) + 8):
    ws.column_dimensions[CL(c)].width = 12.0

out = os.path.join(DISPLAY, 'MD_v1.xlsx')
wb.save(out)
print('written MD_v1.xlsx  (sheet "MD")')
print('  RUN CONFIG rows      %d..%d' % (RUN_FIRST, RUN_FIRST + len(run_rows) - 1))
print('  STAGE CONFIG rows    %d..%d  (%d stages)' % (STG_FIRST, STG_LAST, TOTAL_STAGES))
print('  reward blocks ship all-zero: the deck specifies structure, not values')
print('  duplicate the imported sheet as "MD_v2" before wiring the engine')
