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

# ---------------------------------------------------------------- SEGMENT BEHAVIOUR
SEGMENTS = ['0-9', '10-19', '20-39', '40-99', '100+']
bar(r, 'SEGMENT BEHAVIOUR (no telemetry exists — these are the answer, not a detail)', 6); r += 1
note(r, 'These move the result more than every reward value combined, and they are what makes the '
        'five player types differ: Mighty Doors has no accrual, so a whale and a new player are '
        'separated only by how often they pay to continue and how deep they push before cashing '
        'out. Printed on every harness run for the same reason PACK_PARTICIPATION is (D25).'); r += 1
hdr(r, ['Segment', 'Continue Take-Up', 'Cash-Out Stage', 'Runs per Active Day',
        'Max Continues per Run', 'Note']); r += 1
SEG_FIRST = r
for seg in SEGMENTS:
    put(r, 1, seg, 'data')
    put(r, 2, 0, 'in', '0.0%')      # P(pay to continue when the Pig appears)
    put(r, 3, 0, 'in')              # stage the segment typically walks away at (0 = never cash out)
    put(r, 4, 0, 'in', '0.00')      # runs started per active day — set by ticket supply
    put(r, 5, 0, 'in')              # 0 = unlimited (user decision 2026-09-02)
    ws.cell(r, 6, 'continue take-up 1.0 removes the Pig entirely for this segment'
            if seg == '100+' else '').font = ARIAL(size=9, italic=True, color='FF666666')
    r += 1
SEG_LAST = r - 1
SEG_ROW = {seg: SEG_FIRST + i for i, seg in enumerate(SEGMENTS)}
r += 1

# ---------------------------------------------------------------- STAGE CONFIG
# Six structural columns that are the same for everybody (A..F), then one four-column group PER
# SEGMENT (H..AA). The structure of the tower does not depend on who is climbing it; the odds of
# getting anywhere do, because continue take-up and the cash-out stage are per-segment.
STAGE_COLS = ['Stage', 'Type', 'Choices', 'Pigs', 'Tier', 'Survive p']
SEG_SUB = ['Survive (w/ cont.)', 'Reach p', 'P(end here)', 'Cum P(ended)']
SEG_C0 = 8                                            # first per-segment column (H)
bar(r, 'STAGE CONFIG', SEG_C0 + len(SEGMENTS) * len(SEG_SUB) - 1); r += 1
note(r, 'Columns A-F are structural and shared. Each segment then gets its own survival and reach, '
        'because continue take-up differs by player type; a segment that always continues never '
        'meets the Pig at all. Cum P(ended) is what the reach simulation reads for its percentile.'); r += 1
SEG_HDR_ROW = r
hdr(r, STAGE_COLS)
for i, seg in enumerate(SEGMENTS):                     # per-segment group headers
    c0 = SEG_C0 + i * len(SEG_SUB)
    ws.cell(r - 0, c0)
    for j, lbl in enumerate(SEG_SUB):
        cell = ws.cell(r, c0 + j, seg + ' ' + lbl)
        cell.font = ARIAL(size=9, bold=True)
        cell.fill = fill(F_HDR)
        cell.border = BOX
        cell.alignment = Alignment(horizontal='center', wrap_text=True, vertical='center')
r += 1
STG_FIRST = r
for st in range(1, TOTAL_STAGES + 1):
    row = STG_FIRST + st - 1
    put(row, 1, st, 'data')
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
    for i, seg in enumerate(SEGMENTS):
        c0 = SEG_C0 + i * len(SEG_SUB)
        C = lambda k: CL(c0 + k)
        take = '$B$%d' % SEG_ROW[seg]                  # continue take-up for this segment
        stop = '$C$%d' % SEG_ROW[seg]                  # cash-out stage (0 = never walks away)
        # continuing removes the Pig and guarantees a reward, so it converts a fail into a survival
        put(row, c0 + 0, '=$F{r}+(1-$F{r})*{t}'.format(r=row, t=take), 'out', '0.0%')
        if st == 1:
            put(row, c0 + 1, 1, 'out', '0.000%')
        else:
            pr = row - 1
            # reached only if the previous stage was survived AND not cashed out on it
            put(row, c0 + 1, '={c1}{p}*{c0}{p}*IF(AND({stop}>0,$A{p}>={stop}),0,1)'.format(
                c1=C(1), c0=C(0), p=pr, stop=stop), 'out', '0.000%')
        # a run ENDS here either by cashing out or by meeting a Pig and declining to continue
        put(row, c0 + 2, ('={c1}{r}*(IF(AND({stop}>0,$A{r}>={stop}),{c0}{r},0)'
                          '+(1-$F{r})*(1-{t}))').format(
            c1=C(1), c0=C(0), r=row, stop=stop, t=take), 'out', '0.000%')
        put(row, c0 + 3, '=SUM({c2}${f}:{c2}{r})'.format(c2=C(2), f=STG_FIRST, r=row), 'out', '0.000%')
STG_LAST = STG_FIRST + TOTAL_STAGES - 1
SEG_LASTCOL = SEG_C0 + len(SEGMENTS) * len(SEG_SUB) - 1
# Value-driven styling via conditional formatting, never a static fill: a safe stage is one with
# no Pig, so the rule reads the Pigs column rather than trusting the label.
# FormulaRule, not CellIsRule: the condition tests ANOTHER column ($D, the pig count) rather than
# the cell's own value, so a CellIs rule would compare every cell against TRUE/FALSE instead.
ws.conditional_formatting.add(
    'A%d:%s%d' % (STG_FIRST, CL(SEG_LASTCOL), STG_LAST),
    FormulaRule(formula=['$D%d=0' % STG_FIRST], fill=fill('FFE8F5E9')))
r = STG_LAST + 2

# ---------------------------------------------------------------- RUN EXPECTATION
# One row per metric, one column per player type. This is the block that answers "does this event
# actually pay anybody anything", and it is deliberately placed above the reward ladders: if
# P(run pays ANYTHING) is near zero, no amount of reward authoring will save the design.
bar(r, 'RUN EXPECTATION BY PLAYER TYPE (derived)', 1 + len(SEGMENTS)); r += 1
note(r, 'Rewards banked in a run are LOST on an un-continued Pig (deck p7), so "pays anything" is '
        'not the same as "reaches a stage". A segment that never cashes out and never continues '
        'walks away with nothing almost every run, however rich the ladder is.'); r += 1
hdr(r, ['Metric'] + SEGMENTS); r += 1
EXP_FIRST = r
SC = lambda i, k: CL(SEG_C0 + i * len(SEG_SUB) + k)     # per-segment column letter
exp_rows = [
    ('P(reach Major Milestone)',
     lambda i, seg: '=IFERROR(INDEX({c}{a}:{c}{b},MATCH({maj},$A{a}:$A{b},0)),0)'.format(
         c=SC(i, 1), a=STG_FIRST, b=STG_LAST, maj=RUN['Major Milestone Stage']), '0.000%'),
    ('P(reach Final Stage)',
     lambda i, seg: '=IFERROR(INDEX({c}{a}:{c}{b},MATCH({asp},$A{a}:$A{b},0)),0)'.format(
         c=SC(i, 1), a=STG_FIRST, b=STG_LAST, asp=RUN['Aspirational Milestone Stage']), '0.00000%'),
    ('P(run pays NOTHING)',
     lambda i, seg: '=SUMPRODUCT({c}{a}:{c}{b},(1-$F{a}:$F{b}),(1-$B${sr}))'.format(
         c=SC(i, 1), a=STG_FIRST, b=STG_LAST, sr=SEG_ROW[seg]), '0.0%'),
    # EXP_FIRST + 2, not r + 2: the lambdas are called inside the loop that increments r, so a
    # relative reference here would late-bind to whatever row the loop had reached (it pointed at
    # 'Expected continues per run' and read 1 - continues as a probability).
    ('P(run pays ANYTHING)',
     lambda i, seg: '=1-{c}{r}'.format(c=CL(2 + i), r=EXP_FIRST + 2), '0.0%'),
    ('Expected stage reached',
     lambda i, seg: '=SUM({c}{a}:{c}{b})'.format(c=SC(i, 1), a=STG_FIRST, b=STG_LAST), '0.00'),
    ('Expected continues per run',
     lambda i, seg: '=SUMPRODUCT({c}{a}:{c}{b},(1-$F{a}:$F{b}),$B${sr})'.format(
         c=SC(i, 1), a=STG_FIRST, b=STG_LAST, sr=SEG_ROW[seg]), '0.000'),
    # The single source of truth for "how far does this player type get". Both the cumulative
    # reward helper and the AH1 reach simulation read THIS row rather than recomputing it, so the
    # sheet cannot end up quoting two different stages for the same segment.
    ('Stage reached at percentile',
     lambda i, seg: '=MIN({tot},COUNTIF({c}{a}:{c}{b},"<"&$AI$2)+1)'.format(
         tot=TOTAL_STAGES, c=SC(i, 3), a=STG_FIRST, b=STG_LAST), '0'),
]
for name, fn, numfmt in exp_rows:
    ws.cell(r, 1, name).font = ARIAL(size=10, bold=True)
    for i, seg in enumerate(SEGMENTS):
        put(r, 2 + i, fn(i, seg), 'out', numfmt)
    r += 1
EXP_LAST = r - 1
PCT_ROW = EXP_LAST            # 'Stage reached at percentile' — read by the helper and AH1
r += 1


BLOCK_AT = {}


def reward_block(r, title, note_text, first_col_labels, rows, key=None):
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
    if key:
        BLOCK_AT[key] = (first, r - 1, len(first_col_labels) + 1)
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
    [(t, (t - 1) * 10 + 1, t * 10) for t in range(1, N_TIERS + 1)], key='std')

r = reward_block(
    r, 'SAFE STAGE REWARDS BY TIER',
    'Safe stages carry no Pig and pay "typically more valuable" rewards than standard stages '
    '(deck p6). Separate block because the uplift is a design choice, not a multiplier we can derive.',
    ['Tier', 'Stage From', 'Stage To'],
    [(t, (t - 1) * 10 + 1, t * 10) for t in range(1, N_TIERS + 1)], key='safe')

r = reward_block(
    r, 'MILESTONE REWARDS',
    'The two named milestones (deck p6). These are the aspirational hooks; note from RUN '
    'EXPECTATION above how rarely they are actually reached without continues.',
    ['Stage', 'Milestone'],
    [(30, 'Major'), (60, 'Aspirational')], key='ms')

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

# ------------------------------------------- CUMULATIVE REWARD AT THE REACHED STAGE (derived)
# One row per resource, one column per player type: everything a segment has banked by the time it
# reaches its percentile stage. Counts the stages of each TYPE up to that stage and multiplies by
# the matching tier ladder, so authoring a tier value immediately moves every downstream number.
# 'Safe*' is a wildcard so it catches both 'Safe' and 'Safe (Start)'.
STD_F, STD_L, STD_C = BLOCK_AT['std']
SAFE_F, SAFE_L, SAFE_C = BLOCK_AT['safe']
MS_F, MS_L, MS_C = BLOCK_AT['ms']

bar(r, 'CUMULATIVE REWARD AT THE REACHED STAGE (derived)', 1 + len(SEGMENTS)); r += 1
note(r, 'Reads the three ladders above. All zeros until they are authored — that is the sheet '
        'telling you the truth, not a broken formula.'); r += 1
hdr(r, ['Resource'] + SEGMENTS); r += 1
CUM_FIRST = r
for k, res in enumerate(REWARD_COLS):
    ws.cell(r, 1, res).font = ARIAL(size=10)
    for i, seg in enumerate(SEGMENTS):
        m = '{c}${mr}'.format(c=CL(2 + i), mr=PCT_ROW)   # the reached stage for this segment
        std_col, safe_col, ms_col = CL(STD_C + k), CL(SAFE_C + k), CL(MS_C + k)
        f = ('=SUMPRODUCT(COUNTIFS($A${a}:$A${b},"<="&{m},$E${a}:$E${b},$A${tf}:$A${tl},'
             '$B${a}:$B${b},"Standard"),{sc}${tf}:{sc}${tl})'
             '+SUMPRODUCT(COUNTIFS($A${a}:$A${b},"<="&{m},$E${a}:$E${b},$A${qf}:$A${ql},'
             '$B${a}:$B${b},"Safe*"),{fc}${qf}:{fc}${ql})'
             '+IF({m}>={maj},{mc}${m1},0)+IF({m}>={asp},{mc}${m2},0)').format(
            a=STG_FIRST, b=STG_LAST, m=m, tf=STD_F, tl=STD_L, sc=std_col,
            qf=SAFE_F, ql=SAFE_L, fc=safe_col, mc=ms_col, m1=MS_F, m2=MS_F + 1,
            maj=RUN['Major Milestone Stage'], asp=RUN['Aspirational Milestone Stage'])
        put(r, 2 + i, f, 'out', '0.00')
    r += 1
CUM_LAST = r - 1
r += 1

# ------------------------------------------- PLAYER REACH SIMULATION (AH1, house grammar)
# Anchored at AH1 with EXACTLY the layout every other collection _v2 sheet uses, so anyone who can
# read HH_v2 or RM_1st_v2 can read this one: AH2/AI2 Percentile, AH3/AI3 Payer, header on row 5,
# one row per event day, and <segment>_ms / <segment>_reward pairs. Note the last pair is '100_ms'
# / '100_reward' -- no plus sign -- because that is what the other sheets write.
RS_C = 34                                    # AH
ws.cell(1, RS_C, 'Player Reach Simulation (per event day) - SIMULATED').font = ARIAL(size=11, bold=True)
ws.cell(2, RS_C, 'Percentile').font = ARIAL(size=10, bold=True)
put(2, RS_C + 1, 0.5, 'in', '0.00')
ws.cell(3, RS_C, 'Payer').font = ARIAL(size=10, bold=True)
put(3, RS_C + 1, 'NONPAYER', 'in')
ws.cell(4, RS_C, 'stage reached at that percentile of the run-outcome distribution; '
                 'reward = what is banked there').font = ARIAL(size=9, italic=True, color='FF666666')
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
        # reads the RUN EXPECTATION row, so there is exactly one definition of the reached stage
        ms = '=IF(AND({dur}>0,$AH{r}>{dur}),"",{c}${pr})'.format(
            dur=dur, r=row, c=CL(2 + i), pr=PCT_ROW)
        put(row, RS_C + 1 + i * 2, ms, 'out')
        # reward bundle at that stage, rendered as the same '{Coins: 15, Red: 1}' dict string
        cumcol = CL(2 + i)
        rw = ('=IF({msc}{r}="","","{{"&TEXTJOIN(", ",TRUE,IF({cc}${cf}:{cc}${cl}>0,'
              '$A${cf}:$A${cl}&": "&{cc}${cf}:{cc}${cl},""))&"}}")').format(
            msc=CL(RS_C + 1 + i * 2), r=row, cc=cumcol, cf=CUM_FIRST, cl=CUM_LAST)
        put(row, RS_C + 2 + i * 2, rw, 'out')

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
