# Regenerates _mockdata.json from the current workbook of record (highest NEW_LIVEOPS_CALENDAR_ECO).
# Dumps values (data_only=True — cached results of live formulas) + merges for every sheet the
# engines read: EcoGainsSim_v4.gs, EcoGainsSim_Daily.gs, EcoGainsSim_PBP.gs. Run after every
# workbook re-export, before offline harness runs (_mock_run.js / _mock_daily.js / _mock_pbp.js).
import glob
import json
import os
import re
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
books = glob.glob(os.path.join(HERE, '..', 'workbooks', 'NEW_LIVEOPS_CALENDAR_ECO*.xlsx'))
books.sort(key=lambda n: int((re.search(r'\((\d+)\)', n) or [0, 0])[1]))
SRC = books[-1]

SHEETS = [
    # v4 engine
    'data_gains', 'data_seg_beh', 'data_event_accrual', 'data_event_kite_accrual', 'data_RM',
    'cal_curr', 'cal_new', 'cal_parsed',
    'c_saga', 'c_saga_v2', 'c_day', 'c_day_v2', 'RM', 'NS', 'Sim per Segment',
    # PBP engine additions
    'data_streaks', 'data_event_inst',
    'J_v2', 'HH_v2', 'BB_v2', 'Ph_v2', 'Ki_v2', 'TaD_v2', 'Race_v2', 'F_v2',
    # base config sheets (R-term pairs: reward-config ratio v2/base, added 2026-07-06)
    'J', 'HH', 'BB', 'Ph', 'Ki', 'TaD', 'Race', 'F',
    # NET inputs (SimPerSegmentFill per-earner NET / ECOGAINS_DAILY net blocks) — expected MISSING
    # until the per-earner data_econ re-pull and the new data_econ_daily sheet land in the workbook
    'data_econ', 'data_econ_daily',
]

wb = openpyxl.load_workbook(SRC, data_only=True)
out = {}
for name in SHEETS:
    if name not in wb.sheetnames:
        print('MISSING sheet:', name)
        continue
    ws = wb[name]
    vals = []
    for row in ws.iter_rows(values_only=True):
        vals.append(['' if v is None else (v if isinstance(v, (int, float, bool)) else str(v))
                     for v in row])
    while vals and all(v == '' for v in vals[-1]):
        vals.pop()
    merges = [{'r': m.min_row, 'c': m.min_col,
               'nr': m.max_row - m.min_row + 1, 'nc': m.max_col - m.min_col + 1}
              for m in ws.merged_cells.ranges]
    out[name] = {'values': vals, 'merges': merges}

with open(os.path.join(HERE, '_mockdata.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f)
print('written _mockdata.json from', SRC, '—', len(out), 'sheets')
