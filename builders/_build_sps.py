# Builds Sim_per_Segment_v2.xlsx — the 'Sim per Segment' rollup sheet with one table per
# resource (HC first), replicating the existing mock's style, prefilled with computed values
# from _sps_values.json (offline run of EcoGainsSim_v4.gs on the live workbook data).
import json
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

HERE = os.path.dirname(os.path.abspath(__file__))
VALS = json.load(open(os.path.join(HERE, '_sps_values.json')))
RES = ['HC', 'Slingshot', 'Shuffle', 'Comet', 'Red', 'Chuck', 'Bomb',
       'UL Bomb', 'UL Chuck', 'UL Red', 'Unlimited Lives']
GROUPS = ['PAID', 'ADS', 'CORE', 'META']
SEGS = ['0-9', '10-19', '20-39', '40-99', '100+']

F_MARK, F_CUR, F_SIM, F_DELTA = 'FF1F4E78', 'FF2E75B6', 'FF548235', 'FF666666'
F_HDRSEG, F_HDRCUR, F_HDRSIM, F_HDRDL = 'FFD9D9D9', 'FFCFE2F3', 'FFE2EFDA', 'FFEFEFEF'
F_PAYERBAND = 'FF305496'
fill = lambda rgb: PatternFill('solid', fgColor=rgb)
thin = Side(style='thin')
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
FMT_VAL, FMT_PCT = '#,##0.0', '+0%;-0%;0%'
CL = lambda i: openpyxl.utils.get_column_letter(i)

wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'Sim per Segment'
ws.sheet_view.showGridLines = False
for col, w in {'A': 2.0, 'B': 11.0, 'H': 2.88, 'N': 2.88}.items():
    ws.column_dimensions[col].width = w
for c in list(range(3, 8)) + list(range(9, 14)) + list(range(15, 20)):
    ws.column_dimensions[CL(c)].width = 8.5

ws['A1'] = 'RESOURCE GAINS (33 day period)'
ws['A1'].font = Font(name='Arial', size=13, bold=True)

PITCH = 17
for t, res in enumerate(RES):
    m = 3 + t * PITCH                       # marker row
    mk = ws.cell(m, 2, f'◆ {res}')
    mk.font = Font(name='Arial', size=11, bold=True, color='FFFFFFFF')
    mk.fill = fill(F_MARK)
    # band row
    bands = [(3, 7, '◄ CURRENT (actuals: data + calc) ►', F_CUR),
             (9, 13, '◄ SIMULATED (EcoGainsSim v4: sim + calc) ►', F_SIM),
             (15, 19, 'Δ', F_DELTA)]
    for c1, c2, txt, rgb in bands:
        for c in range(c1, c2 + 1):
            cell = ws.cell(m + 1, c)
            cell.fill = fill(rgb)
            cell.font = Font(name='Arial', size=11, bold=True, color='FFFFFFFF')
        ws.cell(m + 1, c1).value = txt
    # header row
    hr = m + 2
    sgh = ws.cell(hr, 2, 'Segment')
    sgh.font = Font(name='Arial', size=9, bold=True)
    sgh.fill = fill(F_HDRSEG)
    sgh.alignment = Alignment(horizontal='center')
    sgh.border = BORDER
    for base, rgb in ((3, F_HDRCUR), (9, F_HDRSIM), (15, F_HDRDL)):
        for j, g in enumerate(GROUPS + ['Total']):
            cell = ws.cell(hr, base + j, g)
            cell.font = Font(name='Arial', size=9, bold=True)
            cell.fill = fill(rgb)
            cell.alignment = Alignment(horizontal='center')
            cell.border = BORDER
    # payer blocks
    for pb, payer in enumerate(['NONPAYER', 'PAYER']):
        band_r = m + 3 + pb * 6
        bc = ws.cell(band_r, 2, payer)
        bc.font = Font(name='Arial', size=10, bold=True, color='FFFFFFFF')
        bc.fill = fill(F_PAYERBAND)
        for i, seg in enumerate(SEGS):
            r = band_r + 1 + i
            sc = ws.cell(r, 2, seg)
            sc.font = Font(name='Arial', size=11)
            sc.alignment = Alignment(horizontal='center')
            cell_vals = VALS[res][payer][seg]
            for j, g in enumerate(GROUPS):
                for base, key in ((3, 'cur'), (9, 'sim')):
                    c = ws.cell(r, base + j, cell_vals[key][g])
                    c.font = Font(name='Arial', size=11)
                    c.alignment = Alignment(horizontal='center')
                    c.number_format = FMT_VAL
            for base in (3, 9):                              # Total = SUM formula
                c = ws.cell(r, base + 4, f'=SUM({CL(base)}{r}:{CL(base+3)}{r})')
                c.font = Font(name='Arial', size=11)
                c.alignment = Alignment(horizontal='center')
                c.number_format = FMT_VAL
            for j in range(5):                               # Δ = sim/cur - 1 per group + total
                cur_c, sim_c = CL(3 + j), CL(9 + j)
                c = ws.cell(r, 15 + j, f'=IFERROR({sim_c}{r}/{cur_c}{r}-1,"")')
                c.font = Font(name='Arial', size=11)
                c.alignment = Alignment(horizontal='center')
                c.number_format = FMT_PCT

wb.save(os.path.join(HERE, '..', 'display', 'Sim_per_Segment_v2.xlsx'))
print('written Sim_per_Segment_v2.xlsx —', len(RES), 'tables, markers at rows',
      [3 + t * PITCH for t in range(len(RES))])
