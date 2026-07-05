# Builds EcoGainsSim_Daily.xlsx — per-day view of the 33-day sim, driven by ECOGAINS_DAILY
# (EcoGainsSim_Daily.gs). Rows = days 1-33 (+DoW), blocks = CURRENT / NEW / DIFF x 11 resources,
# filters = Payer / Segment / Source dropdowns.
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter as CL

DISPLAY = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'display')

RES = ['HC', 'Slingshot', 'Shuffle', 'Comet', 'Red', 'Chuck', 'Bomb',
       'UL Bomb', 'UL Chuck', 'UL Red', 'Unlimited Lives']
CATS = ['Ads', 'Bomb Challenge', "Bomb's Ballet", 'Chuck Challenge', 'Core', 'Daily Gift',
        'Daily Night Sky Prize', 'Flock Flurry', 'Hatchling Hideaway', 'Jigsaw', 'Kite Festival',
        'Level Race', 'Other', 'Photoshoot', 'Red Challenge', 'River Rush', 'Saga',
        'Season Pass (Free)', 'Target Day', 'Team Event', 'Team Race', 'Flash Race',
        'FlowerCoop', 'Rainbow Maker', 'IAPs']
DOW = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']

F_CUR, F_NEW, F_DIF = 'FF2E75B6', 'FF548235', 'FF666666'
F_HCUR, F_HNEW, F_HDIF = 'FFCFE2F3', 'FFE2EFDA', 'FFEFEFEF'
F_YELLOW, F_HDRSEG = 'FFFFF2CC', 'FFD9D9D9'
F_WEEKEND = 'FFFEF8E3'
fill = lambda rgb: PatternFill('solid', fgColor=rgb)
thin = Side(style='thin')
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
FMT_VAL, FMT_DIFF = '#,##0.00', '#,##0.00;-#,##0.00'

BLOCKS = [(4, 'CURRENT', '◄ CURRENT (cal_curr, measured) ►', F_CUR, F_HCUR, FMT_VAL),
          (16, 'NEW', '◄ NEW (cal_new, simulated) ►', F_NEW, F_HNEW, FMT_VAL),
          (28, 'DIFF', 'Δ  NEW − CURRENT (same day)', F_DIF, F_HDIF, FMT_DIFF)]
D0, DN = 9, 41            # data rows (33 days)
TOT = 42

wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'EcoGainsSim_Daily'
ws.sheet_view.showGridLines = False
ws.column_dimensions['A'].width = 1.75
ws.column_dimensions['B'].width = 5.5
ws.column_dimensions['C'].width = 5.0
for c0, *_ in BLOCKS:
    for j in range(11):
        ws.column_dimensions[CL(c0 + j)].width = 8.0
ws.column_dimensions['O'].width = 2.88
ws.column_dimensions['AA'].width = 2.88
ws.column_dimensions['AN'].width = 21.0

ws['B1'] = 'DAILY RESOURCE GAINS — 33-day calendar, per earner (day 1 = Wednesday)'
ws['B1'].font = Font(name='Arial', size=13, bold=True)

# ---- filters ----
filters = [('Payer', 'NONPAYER', '"NONPAYER,PAYER"'),
           ('Segment', '0-9', '"0-9,10-19,20-39,40-99,100+"'),
           ('Source', 'ALL', '=$AN$2:$AN$27')]
for i, (label, default, f1) in enumerate(filters):
    r = 3 + i
    ws.cell(r, 2, label).font = Font(name='Arial', size=10, bold=True)
    v = ws.cell(r, 3, default)
    v.font = Font(name='Arial', size=10, bold=True)
    v.fill = fill(F_YELLOW)
    v.alignment = Alignment(horizontal='center')
    v.border = BORDER
    dv = DataValidation(type='list', formula1=f1, allow_blank=False, showDropDown=False)
    ws.add_data_validation(dv)
    dv.add(ws.cell(r, 3))
ws['D3'] = '◀ filters (dropdowns) — the whole table re-simulates on change'
ws['D3'].font = Font(name='Arial', size=9, color='FF808080')

# source dropdown list (range-based: 26 items exceed the 255-char inline validation limit)
ws['AN1'] = 'source dropdown list'
ws['AN1'].font = Font(name='Arial', size=8, color='FF808080')
for i, s in enumerate(['ALL'] + CATS):
    ws.cell(2 + i, 40, s).font = Font(name='Arial', size=8, color='FF808080')

# ---- band row (7) + header row (8) ----
for c0, key, txt, band, hdr, fmt in BLOCKS:
    for j in range(11):
        cell = ws.cell(7, c0 + j)
        cell.fill = fill(band)
        cell.font = Font(name='Arial', size=11, bold=True, color='FFFFFFFF')
    ws.cell(7, c0).value = txt
    for j, r in enumerate(RES):
        cell = ws.cell(8, c0 + j, r)
        cell.font = Font(name='Arial', size=9, bold=True)
        cell.fill = fill(hdr)
        cell.alignment = Alignment(horizontal='center')
        cell.border = BORDER
for col, label in ((2, 'Day'), (3, 'DoW')):
    cell = ws.cell(8, col, label)
    cell.font = Font(name='Arial', size=9, bold=True)
    cell.fill = fill(F_HDRSEG)
    cell.alignment = Alignment(horizontal='center')
    cell.border = BORDER

# ---- day rows ----
for d in range(1, 34):
    r = D0 + d - 1
    b = ws.cell(r, 2, d)
    c = ws.cell(r, 3, DOW[(d - 1) % 7])
    for cell in (b, c):
        cell.font = Font(name='Arial', size=10)
        cell.alignment = Alignment(horizontal='center')
    for c0, key, txt, band, hdr, fmt in BLOCKS:
        for j in range(11):
            cell = ws.cell(r, c0 + j)
            cell.font = Font(name='Arial', size=10)
            cell.alignment = Alignment(horizontal='center')
            cell.number_format = fmt

# spill anchors
for c0, key, *_ in BLOCKS:
    ws.cell(D0, c0).value = (f'=LET(payer,$C$3, segment,$C$4, source,$C$5, '
                             f'ECOGAINS_DAILY(payer, segment, source, "{key}"))')

# ---- TOTAL row ----
tc = ws.cell(TOT, 2, 'TOTAL')
tc.font = Font(name='Arial', size=9, bold=True)
tc.fill = fill(F_HDRSEG)
tc.border = BORDER
ws.cell(TOT, 3).fill = fill(F_HDRSEG)
ws.cell(TOT, 3).border = BORDER
for c0, key, txt, band, hdr, fmt in BLOCKS:
    for j in range(11):
        col = CL(c0 + j)
        cell = ws.cell(TOT, c0 + j, f'=SUM({col}{D0}:{col}{DN})')
        cell.font = Font(name='Arial', size=10, bold=True)
        cell.fill = fill(hdr)
        cell.alignment = Alignment(horizontal='center')
        cell.number_format = fmt
        cell.border = BORDER

# ---- conditional formatting ----
# red/green on the DIFF block first (stopIfTrue so it wins over the weekend tint)
diff_rng = f'AB{D0}:AL{DN}'
ws.conditional_formatting.add(diff_rng, CellIsRule(
    operator='lessThan', formula=['0'], stopIfTrue=True,
    font=Font(color='FF990000'), fill=fill('FFF4CCCC')))
ws.conditional_formatting.add(diff_rng, CellIsRule(
    operator='greaterThan', formula=['0'], stopIfTrue=True,
    font=Font(color='FF006100'), fill=fill('FFD9EAD3')))
# weekend tint across the whole table (Fri/Sat/Sun)
ws.conditional_formatting.add(f'B{D0}:AL{DN}', FormulaRule(
    formula=[f'OR($C{D0}="Fri",$C{D0}="Sat",$C{D0}="Sun")'], fill=fill(F_WEEKEND)))

# ---- legend ----
legend = [
    'LEGEND / ALLOCATION RULES (claim-day realistic — EcoGainsSim_Daily.gs)',
    'Window totals are exactly the main sim’s numbers (CURRENT = measured on cal_curr, NEW = simulated on cal_new); this view only places them on days — column TOTALs reconcile with EcoGainsSim_HC.',
    'Leaderboard events (Bomb/Chuck/Red Challenge, Level Race, Flash Race, Target Day, Kite) pay on each instance’s LAST day → expect end-day spikes. Instance slices are split by reach.',
    'Collections (Hatchling Hideaway, Bomb’s Ballet, Jigsaw, Photoshoot) spread across instance days by the accrual curve’s marginal share; Rainbow Maker spreads ∝ active rate within its instances (no curve — flagged).',
    'Core / Saga / Daily Gift pay daily ∝ weekday/weekend active rate; Night Sky over its daily instances. Non-calendar sources (Ads, Teams, Season Pass, Other, IAPs; River Rush current side) are flat ÷33 — their DIFF is uniform.',
    'Weekend rows (Fri/Sat/Sun) are tinted. Filters: Payer / Segment / Source — Source=ALL sums every category; pick one to isolate its daily contribution.',
]
for i, txt in enumerate(legend):
    cell = ws.cell(TOT + 2 + i, 2, txt)
    cell.font = Font(name='Arial', size=9, bold=(i == 0), color='FF000000' if i == 0 else 'FF808080')

wb.save(os.path.join(DISPLAY, 'EcoGainsSim_Daily.xlsx'))
print('written EcoGainsSim_Daily.xlsx — blocks at D/P/AB, data rows', D0, '-', DN, ', TOTAL', TOT)
