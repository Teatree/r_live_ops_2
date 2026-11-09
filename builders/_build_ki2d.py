"""The 2-day Kite Festival config (Ki_2d_v2) and its 28-day estimate (2026-11-09).

    python builders/_build_ki2d.py      -> display/Ki_2d_v2_v1.xlsx

Inputs
  builders/_ki2d_rewards.json      the proposal (bands, rewards, milestone)
  harness/_mockdata_v3t.json       LIVE_OPS_V3 (24): the Ki_2d_v2 layout, Ki (the 3-day Kite), item_vals
  analysis/out/ki2d_both.json      the engine's change summary on the isolated fixture:
      node harness/_make_kite2d_fixture.js --in _mockdata_v3t.json --out _mockdata_v3t_ki2d_both.json --kite both
      node harness/_probe_segments.js --data _mockdata_v3t_ki2d_both.json --quiet --out analysis/out/ki2d_both.json

Tabs
  README     what this is, how to paste it, the flags
  Ki_2d_v2   the full config sheet (A..X), changed cells vs the workbook's current Ki_2d_v2 in red
  Compare    place by place: the 3-day (Ki) against the 2-day, value per place by formula off a price row
  Estimate   per segment x payer: VALUE and HC per player over the 28-day window, CURRENT vs NEW
"""
import json
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter as L

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROP = json.load(open(os.path.join(ROOT, 'builders', '_ki2d_rewards.json'), encoding='utf8'))
DUMP = json.load(open(os.path.join(ROOT, 'harness', '_mockdata_v3t.json'), encoding='utf8'))
EST = json.load(open(os.path.join(ROOT, 'analysis', 'out', 'ki2d_both.json'), encoding='utf8'))
OUT = os.path.join(ROOT, 'display', 'Ki_2d_v2_v1.xlsx')

F = Font(name='Arial', size=10)
FB = Font(name='Arial', size=10, bold=True)
FR = Font(name='Arial', size=10, color='FF0000', bold=True)
FT = Font(name='Arial', size=12, bold=True)
DATA = PatternFill('solid', fgColor='CFE2F3')
SIM = PatternFill('solid', fgColor='E2EFDA')
INP = PatternFill('solid', fgColor='FFF2CC')


def sheet_vals(name):
    return [list(r) for r in DUMP[name]['values']]


def row_of(v, label):
    for i, r in enumerate(v):
        if r and str(r[0]).strip() == label:
            return i
    raise KeyError(label)


cur = sheet_vals('Ki_2d_v2')
ki = sheet_vals('Ki')
hdr_i = row_of(cur, 'Position')
ms_i = row_of(cur, 'Milestone')
H = [str(x).strip() for x in cur[hdr_i]]
C0, C1 = H.index('Coins'), H.index('ToF_Ticket')
RES = H[C0:C1 + 1]
WIDTH = C1 + 1                                     # A..X


def apply(v):
    v = [list(r) + [''] * max(0, WIDTH - len(r)) for r in v]
    for i in range(hdr_i + 1, len(v)):
        try:
            p = int(float(v[i][0]))
        except (TypeError, ValueError):
            continue
        band = next((b for b in PROP['bands'] if b['from'] <= p <= b['to']), None)
        for j in range(C0, C1 + 1):
            v[i][j] = 0
        if band:
            for k, x in band['rewards'].items():
                v[i][H.index(k)] = x
    for j in range(C0, C1 + 1):
        v[ms_i + 1][j] = 0
    for k, x in PROP['milestone'].items():
        v[ms_i + 1][H.index(k)] = x
    return v


new = apply(cur)

# prices: item_vals row 3 (row 2 = names), envelopes priced, tickets at ToF_Value
iv = DUMP['item_vals']['values']
names = [str(x).strip() for x in iv[1]]
alias = {'ToF_Ticket': 'ToF_Value'}
PRICE = {}
for r in RES:
    n = alias.get(r, r)
    PRICE[r] = float(iv[2][names.index(n)]) if n in names and str(iv[2][names.index(n)]).strip() != '' else 0.0

wb = Workbook()

# ---------------------------------------------------------------- README
ws = wb.active
ws.title = 'README'
ws.sheet_view.showGridLines = False
lines = [
    ('2-day Kite Festival (Ki_2d_v2) - proposal and 28-day estimate', FT),
    ('Built 2026-11-09 by builders/_build_ki2d.py from LIVE_OPS_V3 (24). Regenerate, never hand-edit.', F),
    ('', F),
    ('WHAT TO PASTE', FB),
    ('Into the workbook\'s Ki_2d_v2: the milestone row (C%d:%s%d) and the leaderboard block (C%d:%s%d) of the Ki_2d_v2 tab here.'
     % (ms_i + 2, L(WIDTH), ms_i + 2, hdr_i + 2, L(WIDTH), hdr_i + 26), F),
    ('Red cells are the ones that differ from the Ki_2d_v2 now in the workbook. Nothing else on the sheet changes.', F),
    ('', F),
    ('THE DESIGN (user decisions 2026-11-09)', FB),
    ('Same paid places and bands as the 3-day Kite (Ki): 1, 2, 3, 4, 5, 6-10, 11-12, 13-16, 17-25. Each band pays more than the next.', F),
    ('About 67% of the 3-day Kite\'s value, place for place (item_vals row 3, envelopes priced). See Compare.', F),
    ('Place 1 pays only items the 3-day place 1 pays (coins + 5-star): the 250+ cells all finish 1st, and an item the 3-day', F),
    ('  place 1 never pays is priced by the engine as measured x a ratio over almost nothing (a 4-star there read x134).', F),
    ('At most 3 items per place (the UI limit noted on the sheet). Milestone (score 100): 20 min Unlimited Lives (30 on the 3-day).', F),
    ('', F),
    ('THE ESTIMATE (Estimate tab)', FB),
    ('Calendar: cal_curr with the Kite row replaced by 2-day Kite Tue-Wed + 3-day Kite Fri-Sun every week (4 + 4 in the window);', F),
    ('  cal_curr runs the 3-day Mon-Wed. Every other source: same calendar, same config both sides (every _v2 := base), so only Kite moves.', F),
    ('Per player over the 28-day window (the change summary\'s footing), VALUE = item_vals row 3. Engine D96 on the (24) dump.', F),
    ('Moving the 3-day from Mon-Wed to Fri-Sun alone changes VALUE by 0.00-0.06% (measured separately): the increase is the 2-day Kite.', F),
    ('', F),
    ('FLAGS', FB),
    ('1. Kite\'s SPT is not on the config sheet: the engine carries it x calendar, so each 2-day instance pays the 3-day\'s SPT per', F),
    ('   instance (x its reach), not 67%. Kite SPT rises ~80% (20-39 PAYER 8.0 -> 14.5 per player). No Season Pass tier moves.', F),
    ('2. Col - Sets / Col - Albums (the card sim) are left out: on identical calendars the 50-season batch already differs by up to', F),
    ('   ~80 VALUE per player, more than the effect. The extra envelopes (0.1-0.3 per player) would reach album completion via the', F),
    ('   Album completion run.', F),
    ('3. The 2-day instance uses the 3-day\'s measured rank distribution and opt-in (no 2-day Kite has run). Its reach is the', F),
    ('   2-day reach from data_seg_beh (lower than 3 days).', F),
    ('4. 250+ is 32 non-payers and 16 payers in Variant A; every one of them finishes 1st in the data. Read as indicative.', F),
    ('5. Places 6-10 pay a Chuck where the 3-day pays a Bomb, so Chuck boosters rise x4-9 from a small base (20-39 PAYER 0.06 -> 0.26).', F),
]
for i, (t, f) in enumerate(lines, 1):
    c = ws.cell(i, 1, t)
    c.font = f
ws.column_dimensions['A'].width = 140

# ---------------------------------------------------------------- Ki_2d_v2 and Ki (reference)
def write_sheet(name, v, ref=None):
    s = wb.create_sheet(name)
    s.sheet_view.showGridLines = False
    for i, r in enumerate(v):
        for j in range(WIDTH):
            x = r[j] if j < len(r) else ''
            if x == '' or x is None:
                continue
            c = s.cell(i + 1, j + 1, x)
            c.font = F
            if i in (0, hdr_i, ms_i) or str(r[0]).startswith(('Config', 'Milestone Rewards', 'Leaderboard', 'Score Per')):
                c.font = FB
            if ref is not None:
                y = ref[i][j] if i < len(ref) and j < len(ref[i]) else ''
                if str(x) != str(y) and j >= C0:
                    c.font = FR
    s.column_dimensions['A'].width = 34
    for j in range(2, WIDTH + 1):
        s.column_dimensions[L(j)].width = 11
    return s


write_sheet('Ki_2d_v2', new, ref=cur)
write_sheet('Ki (3-day, ref)', [list(r) + [''] * max(0, WIDTH - len(r)) for r in ki])

# ---------------------------------------------------------------- Compare
cs = wb.create_sheet('Compare')
cs.sheet_view.showGridLines = False
cs.cell(1, 1, 'Place by place: the 3-day Kite (Ki) against the 2-day (Ki_2d_v2). Value = SUMPRODUCT(prices, rewards).').font = FT
cs.cell(3, 1, 'Price (item_vals row 3)').font = FB
for k, r in enumerate(RES):
    c = cs.cell(2, 3 + k, r)
    c.font = FB
    c.alignment = Alignment(wrap_text=True)
    p = cs.cell(3, 3 + k, PRICE[r])
    p.font = F
    p.fill = DATA
PR = '$%s$3:$%s$3' % (L(3), L(2 + len(RES)))
rc = 3 + len(RES) + 1
heads = ['3-day rewards', '3-day value', '2-day rewards', '2-day value', '2-day / 3-day']
for k, h in enumerate(heads):
    cs.cell(5, rc + k, h).font = FB
cs.cell(5, 1, 'Place').font = FB


def items(v, i):
    out = []
    for j in range(C0, C1 + 1):
        x = v[i][j] if j < len(v[i]) else 0
        try:
            x = float(x)
        except (TypeError, ValueError):
            x = 0
        if x:
            out.append(('%g x %s' % (x, H[j])) if H[j] not in ('Coins', 'Unlimited Lives') else
                       ('%g %s' % (x, 'coins' if H[j] == 'Coins' else 'min Unlimited Lives')))
    return ', '.join(out) or '-'


def rng(sheet, i):
    return "'%s'!$%s$%d:$%s$%d" % (sheet, L(C0 + 1), i + 1, L(C1 + 1), i + 1)


rows = [('Milestone (score 100)', ms_i + 1)] + [(str(p), hdr_i + p) for p in range(1, 26)]
for n, (lab, i) in enumerate(rows):
    R = 6 + n
    cs.cell(R, 1, lab).font = F
    cs.cell(R, rc, items(ki, i)).font = F
    c = cs.cell(R, rc + 1, '=SUMPRODUCT(%s,%s)' % (PR, rng('Ki (3-day, ref)', i)))
    c.font = F
    c.number_format = '0.0'
    cs.cell(R, rc + 2, items(new, i)).font = F
    c = cs.cell(R, rc + 3, '=SUMPRODUCT(%s,%s)' % (PR, rng('Ki_2d_v2', i)))
    c.font = F
    c.number_format = '0.0'
    c = cs.cell(R, rc + 4, '=IF(%s%d=0,"",%s%d/%s%d)' % (L(rc + 1), R, L(rc + 3), R, L(rc + 1), R))
    c.font = F
    c.number_format = '0%'
cs.column_dimensions['A'].width = 22
for k in range(len(RES)):
    cs.column_dimensions[L(3 + k)].width = 7
cs.column_dimensions[L(rc)].width = 40
cs.column_dimensions[L(rc + 2)].width = 40
for k in (1, 3, 4):
    cs.column_dimensions[L(rc + k)].width = 12

# ---------------------------------------------------------------- Estimate
es = wb.create_sheet('Estimate')
es.sheet_view.showGridLines = False
es.cell(1, 1, 'Adding the 2-day Kite (Tue-Wed) to the 3-day Kite (Fri-Sun): per player over the 28-day window (sim)').font = FT
es.cell(2, 1, 'CURRENT = cal_curr (3-day Mon-Wed). NEW = 2-day Tue-Wed + 3-day Fri-Sun. Every other source identical. '
              'Excludes Col - Sets / Col - Albums (card-sim noise, see README).').font = F
cols = ['Segment', 'Payer', 'Players', 'VALUE current', 'VALUE new', 'VALUE +', 'VALUE %',
        'HC current', 'HC new', 'HC +', 'HC %', 'Kite VALUE current', 'Kite VALUE new', 'Kite HC current', 'Kite HC new']
for k, h in enumerate(cols):
    c = es.cell(4, k + 1, h)
    c.font = FB
    c.alignment = Alignment(wrap_text=True)
R = 5
for key, b in EST['blocks'].items():
    seg, payer = [x.strip() for x in key.split('|')]
    cv = nv = ch = nh = 0.0
    for cat, x in b['bySrc'].items():
        if cat.startswith('Col'):
            continue
        cv += x['cur']; nv += x['nw']; ch += x['curHC']; nh += x['nwHC']
    k = b['bySrc']['Kite Festival']
    vals = [seg, payer, round(b['pop']), cv, nv, None, None, ch, nh, None, None, k['cur'], k['nw'], k['curHC'], k['nwHC']]
    for j, x in enumerate(vals):
        c = es.cell(R, j + 1)
        if j == 5:
            c.value = '=E%d-D%d' % (R, R)
        elif j == 6:
            c.value = '=IF(D%d=0,"",E%d/D%d-1)' % (R, R, R)
        elif j == 9:
            c.value = '=I%d-H%d' % (R, R)
        elif j == 10:
            c.value = '=IF(H%d=0,"",I%d/H%d-1)' % (R, R, R)
        else:
            c.value = x
        c.font = FB if seg == 'ALL' else F
        if j >= 3:
            c.number_format = '0.00%' if j in (6, 10) else ('0.0' if j not in (2,) else '0')
            c.fill = SIM
        if j == 2:
            c.number_format = '#,##0'
    R += 1
es.cell(R + 1, 1, 'ALL = the pull\'s own whole-population row (not the weighted mean of the segments). '
                  'Engine %s on the (24) dump, window %s days.' % (EST.get('build', ''), EST.get('window', ''))).font = F
es.column_dimensions['A'].width = 10
es.column_dimensions['B'].width = 11
for j in range(3, len(cols) + 1):
    es.column_dimensions[L(j)].width = 12

wb.save(OUT)
print('written', OUT)
