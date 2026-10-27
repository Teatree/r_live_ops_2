# Builds EcoGainsSim_Daily_v3.xlsx — per-day view of the 33-day sim, driven by ECOGAINS_DAILY
# (EcoGainsSim_Daily.gs). Rows = days 1-33 (+DoW). v3 (D60, 2026-10-14) is the layout the user
# asked for, in his order: CURRENT GAINS (data) / NEW GAINS (sim) / Δ GAINS (data − sim) /
# CURRENT SPEND (data) / CURRENT NET (data) / NEW NET (sim) / Δ NET (data − sim), plus one more
# block on the far right, the SIM of cal_curr - the validation lane: data − that = model error,
# which is the only way to tell a model error from the redesign effect while cal_curr is the live
# calendar (data − sim_new = (data − sim_curr) + (sim_curr − sim_new)). Every data-anchored block is
# BLANK past the last day data_econ_daily carries, so a 2-of-33-day pull breaks nothing; the sign
# convention is data − sim everywhere (positive = the data sits above the sim).
# Filters = Payer / Segment / Source dropdowns; the data blocks are game-wide (Source = ALL only).
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter as CL

DISPLAY = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'display')

# 20 since 2026-09-02 (append-only): ToF_Ticket (D28). 19 since 2026-08-03: the six pack tiers (D19).
# 13 since 2026-07-10: SPT/SPTx2 = season pass tokens (D16).
RES = ['HC', 'Slingshot', 'Shuffle', 'Comet', 'Red', 'Chuck', 'Bomb',
       'UL Bomb', 'UL Chuck', 'UL Red', 'Unlimited Lives', 'SPT', 'SPTx2',
       '1-star Pack', '2-star Pack', '3-star Pack', '4-star Pack', '5-star Pack', '6-star Pack',
       'ToF_Ticket']   # 20 since D28 (2026-09-02): the engine spills RESOURCES-wide, and a 19-wide
                       # block let the ticket column land in the gap. Gains-only, blank in data blocks.
# Packs are gains-only (D19/8): there is no spend model for them, so their NET cells would only
# restate the gain. ECOGAINS_DAILY blanks the six pack columns inside the SPEND / CURNET / NEWNET
# spills (netGrid_), and the net-Δ block's IFERROR turns the resulting '' arithmetic into blanks
# too. Every block therefore stays the SAME width — blanking is a value concern, not a layout one
# (a narrower NET block would be overrun by the spill, which is always RESOURCES-wide).
CATS = ['Ads', 'Bomb Challenge', "Bomb's Ballet", 'Chuck Challenge', 'Core', 'Daily Gift',
        'Daily Night Sky Prize', 'Flock Flurry', 'Hatchling Hideaway', 'Jigsaw', 'Kite Festival',
        'Level Race', 'Other', 'Photoshoot', 'Red Challenge', 'River Rush', 'Saga',
        'Season Pass (Free)', 'Target Day', 'Team Event', 'Team Race', 'Flash Race',
        'FlowerCoop', 'Rainbow Maker', 'IAPs']
DOW = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']

F_CUR, F_NEW, F_DIF = 'FF2E75B6', 'FF548235', 'FF666666'
F_HCUR, F_HNEW, F_HDIF = 'FFCFE2F3', 'FFE2EFDA', 'FFEFEFEF'
F_NET, F_HNET = 'FF7030A0', 'FFE9DEF3'          # NET bands: same purple family as Sim per Segment
F_YELLOW, F_HDRSEG = 'FFFFF2CC', 'FFD9D9D9'
F_WEEKEND = 'FFFEF8E3'
fill = lambda rgb: PatternFill('solid', fgColor=rgb)
thin = Side(style='thin')
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
FMT_VAL, FMT_DIFF = '#,##0.00', '#,##0.00;-#,##0.00'
FMT_NET = '#,##0.00;[Red]-#,##0.00'             # net can be negative (spend > gain)

# Block geometry is DERIVED from len(RES): 7 blocks of len(RES) columns, one gap column between
# them, starting at column D. Widening the resource universe must never mean re-deriving column
# letters by hand (pitch was 12 at 11 resources, 14 at 13, 20 at 19).
BLOCK_SPECS = [
    # the seven blocks, in the user's order (D60). DATA-anchored blocks are blank past the last
    # pulled day and blank unless Source = ALL.
    ('DATA', '◄ CURRENT GAINS (data: data_econ_daily, per earner) ►', F_CUR, F_HCUR, FMT_VAL),
    ('NEW', '◄ NEW GAINS (sim, cal_new) ►', F_NEW, F_HNEW, FMT_VAL),
    ('DATADIFF', 'Δ GAINS   data − sim', F_DIF, F_HDIF, FMT_DIFF),
    ('SPEND', '◄ CURRENT SPEND (data, per earner) ►', F_NET, F_HNET, FMT_VAL),
    ('CURNET', '◄ CURRENT NET (data: gain − spend) ►', F_NET, F_HNET, FMT_NET),
    ('NEWNET', '◄ NEW NET (sim: data gain + sim Δ − spend) ►', F_NET, F_HNET, FMT_NET),
    # Δ NET = CURNET − NEWNET, plain sheet formulas: data − sim, the same sign as Δ GAINS
    ('NETD', 'Δ NET   data − sim', F_DIF, F_HDIF, FMT_DIFF),
    # the validation lane: the sim placed on cal_curr. data − this = MODEL error, with no
    # calendar change mixed in. Hide it if it is in the way; never delete it.
    ('CURRENT', '◄ SIM of cal_curr — validation lane (data − this = model error) ►', F_CUR, F_HCUR, FMT_VAL),
]
FIRST_COL, PITCH = 4, len(RES) + 1              # D; 20 columns per block at 19 resources
STYLE_BLOCKS, GAPS = [], []
for _i, (_k, _t, _b, _h, _f) in enumerate(BLOCK_SPECS):
    _c0 = FIRST_COL + _i * PITCH
    STYLE_BLOCKS.append((_c0, _k, _t, _b, _h, _f))
    GAPS.append(CL(_c0 + len(RES)))
BLOCKS = STYLE_BLOCKS[:3]                       # DATA / NEW / DATADIFF (spills)
NET_SPILL = STYLE_BLOCKS[3:6]                   # SPEND / CURNET / NEWNET (spills)
NETD = STYLE_BLOCKS[6]                          # Δ NET (formulas)
VALID = STYLE_BLOCKS[7]                         # SIM of cal_curr (spill)
DATA_KEYS = ('DATA', 'DATADIFF', 'SPEND', 'CURNET', 'NEWNET', 'NETD')   # blank past the pull
DROP_COL = FIRST_COL + len(BLOCK_SPECS) * PITCH  # first free column after the last gap
D0, DN = 9, 41            # data rows (33 days)
TOT = 42

wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'EcoGainsSim_Daily'
ws.sheet_view.showGridLines = False
ws.column_dimensions['A'].width = 1.75
ws.column_dimensions['B'].width = 5.5
ws.column_dimensions['C'].width = 5.0
for c0, *_ in STYLE_BLOCKS:
    for j in range(len(RES)):
        ws.column_dimensions[CL(c0 + j)].width = 8.0
for g in GAPS:
    ws.column_dimensions[g].width = 2.88
ws.column_dimensions[CL(DROP_COL)].width = 21.0

ws['B1'] = 'DAILY RESOURCE GAINS + NET — data vs sim, 33-day calendar, per earner (weekdays from the calendar sheets)'
ws['B1'].font = Font(name='Arial', size=13, bold=True)

# ---- filters ----
filters = [('Payer', 'NONPAYER', '"NONPAYER,PAYER"'),
           ('Segment', '0-9', '"0-9,10-19,20-39,40-99,100+"'),
           ('Source', 'ALL', f'=${CL(DROP_COL)}$2:${CL(DROP_COL)}$27')]
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
ws.cell(1, DROP_COL, 'source dropdown list').font = Font(name='Arial', size=8, color='FF808080')
for i, s in enumerate(['ALL'] + CATS):
    ws.cell(2 + i, DROP_COL, s).font = Font(name='Arial', size=8, color='FF808080')

# ---- band row (7) + header row (8) ----
for c0, key, txt, band, hdr, fmt in STYLE_BLOCKS:
    for j in range(len(RES)):
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
    for c0, key, txt, band, hdr, fmt in STYLE_BLOCKS:
        for j in range(len(RES)):
            cell = ws.cell(r, c0 + j)
            cell.font = Font(name='Arial', size=10)
            cell.alignment = Alignment(horizontal='center')
            cell.number_format = fmt

# spill anchors (CURRENT/NEW/DIFF + the three NET spills). The trailing sim_refresh!$A$1 is the
# engine's refresh NONCE (ignored by the function; changing it is what re-runs the sim — the
# engine no longer clears/re-sets formulas, which is what used to wipe them periodically).
for c0, key, *_ in BLOCKS + NET_SPILL + [VALID]:
    ws.cell(D0, c0).value = (f'=LET(payer,$C$3, segment,$C$4, source,$C$5, '
                             f'ECOGAINS_DAILY(payer, segment, source, "{key}", sim_refresh!$A$1))')

# Δ NET block: per-cell formulas CURNET − NEWNET (data − sim), BLANK when either side is blank
# (source ≠ ALL, no data_econ_daily, or a day past the pull). The blank test is explicit since
# 2026-10-27: IFERROR alone relied on the LIVE spill emitting '' text cells, so the subtraction
# errored and the Δ came out blank - but Fill all sims writes VALUES, a written '' is an empty
# cell, an empty cell subtracts as 0, and days 2..33 read a false 0.00 on LIVE_OPS_V3.
# `X=""` is TRUE for an empty cell and for '' text alike, so this reads the same either way.
for r in range(D0, DN + 1):
    for j in range(len(RES)):
        cur, new = f'{CL(NET_SPILL[1][0]+j)}{r}', f'{CL(NET_SPILL[2][0]+j)}{r}'
        ws.cell(r, NETD[0] + j).value = f'=IF(OR({cur}="",{new}=""),"",IFERROR({cur}-{new},""))'

# ---- TOTAL row ----
tc = ws.cell(TOT, 2, 'TOTAL')
tc.font = Font(name='Arial', size=9, bold=True)
tc.fill = fill(F_HDRSEG)
tc.border = BORDER
ws.cell(TOT, 3).fill = fill(F_HDRSEG)
ws.cell(TOT, 3).border = BORDER
for c0, key, txt, band, hdr, fmt in STYLE_BLOCKS:
    is_net = key in DATA_KEYS
    for j in range(len(RES)):
        col = CL(c0 + j)
        # NET totals blank out when the block is blank ('' cells → COUNT 0); a plain SUM would
        # show 0 and read as "net is zero" instead of "no data / not applicable".
        f = (f'=IF(COUNT({col}{D0}:{col}{DN})=0,"",SUM({col}{D0}:{col}{DN}))' if is_net
             else f'=SUM({col}{D0}:{col}{DN})')
        cell = ws.cell(TOT, c0 + j, f)
        cell.font = Font(name='Arial', size=10, bold=True)
        cell.fill = fill(hdr)
        cell.alignment = Alignment(horizontal='center')
        cell.number_format = fmt
        cell.border = BORDER

# ---- conditional formatting ----
# red/green on the DIFF and net-Δ blocks first (stopIfTrue so they win over the weekend tint)
for rng in (f'{CL(BLOCKS[2][0])}{D0}:{CL(BLOCKS[2][0] + len(RES) - 1)}{DN}',      # Δ GAINS
            f'{CL(NETD[0])}{D0}:{CL(NETD[0] + len(RES) - 1)}{DN}'):                # Δ NET
    ws.conditional_formatting.add(rng, CellIsRule(
        operator='lessThan', formula=['0'], stopIfTrue=True,
        font=Font(color='FF990000'), fill=fill('FFF4CCCC')))
    ws.conditional_formatting.add(rng, CellIsRule(
        operator='greaterThan', formula=['0'], stopIfTrue=True,
        font=Font(color='FF006100'), fill=fill('FFD9EAD3')))
# weekend tint across the whole table (Fri/Sat/Sun)
ws.conditional_formatting.add(f'B{D0}:{CL(VALID[0] + len(RES) - 1)}{DN}', FormulaRule(
    formula=[f'OR($C{D0}="Fri",$C{D0}="Sat",$C{D0}="Sun")'], fill=fill(F_WEEKEND)))

# ---- legend ----
legend = [
    'LEGEND / ALLOCATION RULES (D60, 2026-10-14 — EcoGainsSim_Daily.gs, DAILY_ALLOC_MODEL = settle)',
    'CURRENT GAINS, CURRENT SPEND, CURRENT NET are DATA: data_econ_daily, per earner per day (window-earner denominator, so the 33 days sum to the data_econ window total). They are BLANK past the last day the pull carries — a day with no row is "not pulled yet", never 0 — and blank unless Source = ALL (the data is game-wide).',
    'NEW GAINS is the SIM of cal_new. Δ GAINS = data − sim: positive means the data sits above the sim. While cal_curr is the live calendar this Δ mixes the redesign with model error; the validation lane on the far right (SIM of cal_curr) separates them: data − sim_new = (data − sim_curr) + (sim_curr − sim_new).',
    'NEW NET = data gain + the sim’s day shift (sim NEW − sim cal_curr) − data spend: anchored to the data, so when the redesign changes nothing it equals CURRENT NET exactly. Δ NET = CURRENT NET − NEW NET (data − sim).',
    'PLACEMENT (measured against the data before it was built, harness/_probe_daily_alloc*.js): rank-family lumps (Bomb/Chuck/Red Challenge, Level Race, Flash Race, Target Day, Kite, Team Event, Team Race, Flock Flurry) land the DATE AFTER the grid cell — a 1-day cell is a 2-date event, the board settles and pays on the next date. Authored per source on the optional sim_settle sheet (settle_days; lag_0..2 to spread a payout over +0/+1/+2 once the lag data exists). The 7-day view sums the EARN day instead.',
    'Collections (Hatchling Hideaway, Bomb’s Ballet, Jigsaw, Photoshoot) spread by the MEAN accrual curve’s marginal; Season Pass (Free/Paid) spreads ∝ active rate over every day its lane is open (no reach split — the 3-day stub artefact is gone); Core / Saga / Daily Gift pay daily ∝ weekday/weekend active rate; Night Sky over its daily instances; Rainbow Maker ∝ active rate within its instances. Non-calendar sources (Ads, Other, IAPs, FlowerCoop) are flat ÷33. River Rush must be DRAWN on cal_curr (days 2–8, 16–22, 30–33) — off-grid it is flat and SPTx2 is placed on the wrong days.',
    'Reading the comparison: a single day’s % is NOT a verdict — the data’s own day-to-day CV is 17–29% for the smooth resources. Read cumulative-through-day-N (N ≥ 7) against the resource’s week-over-week CV (HC 2–12%, boosters 3–22%, UL 10–30%), and timing on 3-day centred sums (±1 day). SPT is dominated by the synthetic Core anchor and SPTx2 by River Rush’s schedule until those are fixed.',
    'Weekend rows (Fri/Sat/Sun) are tinted. Window totals of the SIM blocks reconcile with EcoGainsSim_HC (TOTAL row); the data blocks total only the days pulled (blank = no data, not zero).',
    'PACKS and ToF_Ticket are gains-only and simulated-side only: the data blocks leave their columns BLANK (no telemetry is not a measured 0).',
]
for i, txt in enumerate(legend):
    cell = ws.cell(TOT + 2 + i, 2, txt)
    cell.font = Font(name='Arial', size=9, bold=(i == 0), color='FF000000' if i == 0 else 'FF808080')

wb.save(os.path.join(DISPLAY, 'EcoGainsSim_Daily_v3.xlsx'))
print('written EcoGainsSim_Daily_v3.xlsx — blocks at',
      '/'.join(CL(c0) for c0, *_ in STYLE_BLOCKS), f'({len(RES)} res each, pitch {PITCH}), data rows',
      D0, '-', DN, ', TOTAL', TOT, ', dropdown col', CL(DROP_COL))
