# Builds display/cal_day1_oct13_v1.xlsx: cal_curr and cal_new from LIVE_OPS_V3 (2) with DAY 1 = Tue
# 2026-10-13 (column B), the layout the "thus far" plan needs (PLAN_thus_far_ab_window.md section 9).
#
#   python builders/_build_cal_day1.py [--workbook "workbooks/🏮LIVE_OPS_V3 (2).xlsx"]
#
# What it changes, on BOTH sheets, and nothing else:
#   rows 1-4   B1 keeps the date; row 3 = weekday names B (Tuesday) .. AC (Monday); row 4 = 1..28 in
#              B..AC; AD:AI (Nov 10-15, after the season) lose their weekday and day number and are
#              greyed; the black-out fill on C:G is removed.
#   rows 5-25  columns B:G (Oct 13-18) are re-drawn as real instances: Oct 13's events typed in
#              column B, multi-day events merged (they were 1-day cells after the column insert).
#              cal_new gets the SAME B:G as cal_curr - the redesign still starts at H (Oct 19), so
#              days 1-6 differ only by config, never by calendar. Columns H onward are untouched,
#              except that Season Pass and ToF start one column earlier (B instead of C).
# Every changed cell carries a comment saying what changed and why; the CHANGES sheet lists them all.
# cal_new's summary block (rows 28+) holds formulas over other sheets; they are written as their
# cached values so the file opens without #REF!. Only rows 1-25 are meant to be copied back.
import argparse
import copy
import datetime
import os

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import PatternFill
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--workbook', default=os.path.join('workbooks', '🏮LIVE_OPS_V3 (2).xlsx'))
ap.add_argument('--out', default=os.path.join('display', 'cal_day1_oct13_v1.xlsx'))
args = ap.parse_args()
SRC = args.workbook if os.path.isabs(args.workbook) else os.path.join(HERE, '..', args.workbook)
OUT = args.out if os.path.isabs(args.out) else os.path.join(HERE, '..', args.out)

DAY1 = datetime.date(2026, 10, 13)
N_DAYS = 28
COL_B = 2
COL_LAST = COL_B + N_DAYS - 1            # AC = Mon 2026-11-09
COL_GRID_END = 35                        # AI, the last column the sheets use
PRE_LAST = 7                             # G = Sun 2026-10-18, the last of the six newly counted days
WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
GREY = PatternFill('solid', fgColor='FFD9D9D9')

def date_of(col):
    return DAY1 + datetime.timedelta(days=col - COL_B)

def L(col):
    return get_column_letter(col)

def span(c0, c1):
    d0, d1 = date_of(c0), date_of(c1)
    return d0.strftime('%a %b %d') + ('' if c0 == c1 else ' - ' + d1.strftime('%a %b %d'))

# Oct 13-18 (B:G), one entry per instance: (row, first col, last col, why). Read off the A/B
# dashboard export (both arms pay on these dates) and the D78 re-merge list, shifted one column
# right by the Oct 13 insert. Single-day cells are one entry each.
LANES_B_TO_G = [
    (6,  5, 7, 'Team Race Fri-Sun, as every later week (was a 1-day cell in E)'),
    (7,  2, 4, 'Team Event Mon Oct 12 - Thu Oct 15: its board paid Fri Oct 16 in both arms'),
    (8,  2, 7, 'Top Teams Leaderboard, weekly Mon-Sun: Oct 12-18'),
    (9,  5, 5, "Chuck's Flash Race Fri, as every later week"),
    (9,  6, 6, "Chuck's Flash Race Sat"),
    (9,  7, 7, "Chuck's Flash Race Sun"),
    (12, 2, 2, 'Flock Flurry Tue Oct 13 - the weekly Mon-Thu pattern (CHECK)'),
    (12, 3, 3, 'Flock Flurry Wed'),
    (12, 4, 4, 'Flock Flurry Thu'),
    (14, 3, 4, "Red's Challenge Oct 14-15 (D78 re-merge; was a 1-day cell)"),
    (15, 2, 3, 'Kite Festival Mon Oct 12 - Wed Oct 14: it paid Thu Oct 15 in both arms (missing before)'),
    (16, 2, 7, 'Top Players Leaderboard, weekly Mon-Sun: Oct 12-18'),
    (17, 5, 7, 'Mystery Puzzle Fri-Sun (D78 re-merge; was a 1-day cell)'),
    (18, 2, 4, 'Rainbow Maker Mon Oct 12 - Thu Oct 15: paid Oct 12-15 in both arms (was a 1-day cell)'),
    (19, 5, 5, 'Target Day Fri, as every later week'),
    (19, 6, 6, 'Target Day Sat'),
    (19, 7, 7, 'Target Day Sun'),
    (20, 4, 7, 'Hatchling Hideaway Thu Oct 15 - Sun Oct 18: paid Oct 15-19 in both arms (was a 1-day cell)'),
] + [(21, c, c, 'Night Sky runs every day' + (' - added for Oct 13' if c == 2 else ''))
     for c in range(2, 8)] + [
    (23, 2, 7, 'Season Offers, weekly Tue-Sun of this week (CHECK: was C:G)'),
    (24, 5, 7, 'Progress Pack Fri-Sun (unchanged)'),
    (25, 6, 7, 'Special Offer Sat-Sun (unchanged)'),
]
# Lanes that run through the window: only their START moves, from C to B.
# (row, name, why, last column or None = keep the lane's own end)
LONG_LANES = [
    (5,  'Season Pass', 'the new pass season paid out on Tue Oct 13 in both arms; starts at B, not C (CHECK: end column kept)', None),
    # ToF ran C:AI, one column past AH, where the engine's grid read stops; a merge that crosses the
    # grid edge is read as a 1-day cell by the offline harness. Ending it with the season (AC) keeps
    # it inside the grid and changes no number: the window stops at AC anyway.
    (22, 'ToF',         'Tower of Fortune paid from Tue Oct 13 in Variant A; starts at B, not C, and ends with the season (AC) instead of AI', COL_LAST),
]

changes = []

def note(ws, cell, text):
    ws[cell].comment = Comment(text, 'cal_day1 builder')
    ws[cell].comment.width, ws[cell].comment.height = 300, 90
    changes.append((ws.title, cell, text))

def style_from(dst, src):
    dst.font = copy.copy(src.font)
    dst.fill = copy.copy(src.fill)
    dst.border = copy.copy(src.border)
    dst.alignment = copy.copy(src.alignment)
    dst.number_format = src.number_format

def unmerge_touching(ws, row, c0, c1):
    gone = []
    for mr in list(ws.merged_cells.ranges):
        if mr.min_row <= row <= mr.max_row and mr.min_col <= c1 and mr.max_col >= c0:
            gone.append((mr.min_col, mr.max_col, ws.cell(mr.min_row, mr.min_col).value))
            ws.unmerge_cells(str(mr))
    return gone

# The text each lane is drawn with, matched by a keyword in that row of the UNTOUCHED source sheet:
# the first label in the row is not enough (row 17 carries Mystery Puzzle, Bomb's Ballet and Jigsaw).
LANE_KEY = {6: 'Team Race', 7: 'Team Event', 8: 'Top Teams', 9: 'Flash', 12: 'Flock', 14: "Red's",
            15: 'Kite', 16: 'Top Players', 17: 'Mystery', 18: 'Rainbow', 19: 'Target', 20: 'Hatchling',
            21: 'Night Sky', 23: 'Season Off', 24: 'Progress', 25: 'Special'}
def row_label(ws, row):
    key = LANE_KEY.get(row, '')
    for c in range(COL_B, COL_GRID_END + 1):
        v = ws.cell(row, c).value
        if isinstance(v, str) and v.strip() and key in v:
            return v
    raise SystemExit('no label containing %r on row %d of %s' % (key, row, ws.title))

def label_cell(ws, row):
    """the first cell at H or later drawn with that lane's label - its style is the lane's style"""
    lbl = row_label(ws, row)
    for c in range(8, COL_GRID_END + 1):
        if ws.cell(row, c).value == lbl:
            return ws.cell(row, c)
    return None

def row_templates(ws, row):
    """(event-cell style, empty-cell style) taken from the row at H or later, never from the old
    black-out columns."""
    ev = empty = None
    for c in range(8, COL_GRID_END + 1):
        cell = ws.cell(row, c)
        if cell.__class__.__name__ == 'MergedCell':
            continue
        if ev is None and isinstance(cell.value, str) and cell.value.strip():
            ev = cell
        if empty is None and cell.value is None:
            empty = cell
        if ev is not None and empty is not None:
            break
    return ev, empty

def build_sheet(ws, labels_from):
    # ---- rows 1-4 --------------------------------------------------------------------------
    h1, h2, h3, h4 = ws['H1'], ws['H2'], ws['H3'], ws['H4']
    wk = None
    for c in range(8, COL_GRID_END + 1):
        if str(ws.cell(2, c).value or '').strip() == 'WEEKEND':
            wk = ws.cell(2, c); break
    for r in (1, 2, 3, 4):
        unmerge_touching(ws, r, COL_B, PRE_LAST)
    for c in range(3, PRE_LAST + 1):                       # B1 keeps its date
        style_from(ws.cell(1, c), h1); ws.cell(1, c).value = None
    for c in range(COL_B, PRE_LAST + 1):
        style_from(ws.cell(2, c), h2); ws.cell(2, c).value = None
    if wk is not None:                                     # Fri-Sun Oct 16-18
        ws['E2'] = 'WEEKEND'; style_from(ws['E2'], wk); ws.merge_cells('E2:G2')
        note(ws, 'E2', 'Cosmetic: the first weekend (Fri Oct 16 - Sun Oct 18) is now inside the season. '
                       'The engine does not read this row.')
    ws['B1'] = datetime.datetime(DAY1.year, DAY1.month, DAY1.day)
    ws['B1'].number_format = 'yyyy-mm-dd'
    note(ws, 'B1', 'The date of day 1. The engine reads the date typed directly ABOVE the 1 in row 4, '
                   'so it must sit in the same column as the 1 (B).')
    for c in range(COL_B, COL_LAST + 1):
        d = date_of(c)
        style_from(ws.cell(3, c), h3); ws.cell(3, c).value = WEEKDAYS[d.weekday()]
        style_from(ws.cell(4, c), h4); ws.cell(4, c).value = c - COL_B + 1
    note(ws, 'B3', 'Weekday names now start at day 1: B = Tuesday. The engine works out weekends '
                   '(Fri/Sat/Sun) from the name above the 1.')
    note(ws, 'B4', 'Day 1 = Tue 2026-10-13 (B) through day 28 = Mon 2026-11-09 (AC): the A/B start '
                   'to the album season end. Was 1 at H (Oct 19) through 28 at AI, and the engine '
                   'only reads up to AH, so it saw 27 days.')
    for c in range(COL_LAST + 1, COL_GRID_END + 1):
        for r in (3, 4):
            cell = ws.cell(r, c)
            if cell.__class__.__name__ == 'MergedCell':
                continue
            cell.value = None; cell.fill = copy.copy(GREY)
    note(ws, L(COL_LAST + 1) + '4', 'AD:AI (Nov 10-15) are after the season end: no weekday, no day '
                                    'number, so the engine stops at day 28. Events here are kept '
                                    'and ignored.')

    # ---- long lanes: move the start from C to B ----------------------------------------------
    for row, name, why, last in LONG_LANES:
        gone = [g for g in unmerge_touching(ws, row, COL_B, COL_B + 1)]
        end = last or max([g[1] for g in gone] or [3])
        lbl = labels_from.cell(row, 3).value or name
        tmpl = labels_from.cell(row, 3)
        for c in range(COL_B, end + 1):
            ws.cell(row, c).value = None
        ws.cell(row, COL_B).value = lbl
        style_from(ws.cell(row, COL_B), tmpl)
        ws.merge_cells(start_row=row, start_column=COL_B, end_row=row, end_column=end)
        note(ws, L(COL_B) + str(row), name + ': ' + span(COL_B, end) + ' (merged B:' + L(end) + '). ' + why)

    # ---- rows 5-25, columns B:G ------------------------------------------------------------
    long_rows = {r for r, _, _, _ in LONG_LANES}
    for row in range(5, 26):
        if row in long_rows:
            continue
        unmerge_touching(ws, row, COL_B, PRE_LAST)
        _, empty_t = row_templates(labels_from, row)
        ev_t = label_cell(labels_from, row) if any(r == row for r, _, _, _ in LANES_B_TO_G) else None
        for c in range(COL_B, PRE_LAST + 1):
            cell = ws.cell(row, c)
            cell.value = None
            if empty_t is not None:
                style_from(cell, empty_t)
            else:
                cell.fill = PatternFill(fill_type=None)
        for (r, c0, c1, why) in LANES_B_TO_G:
            if r != row:
                continue
            lbl = row_label(labels_from, row)
            cell = ws.cell(row, c0)
            cell.value = lbl
            if ev_t is not None:
                style_from(cell, ev_t)
            if c1 > c0:
                ws.merge_cells(start_row=row, start_column=c0, end_row=row, end_column=c1)
            note(ws, L(c0) + str(row), (lbl or '').replace('\n', ' ') + ': ' + span(c0, c1) +
                 ('' if c1 == c0 else ' (merged ' + L(c0) + ':' + L(c1) + ')') + '. ' + why)

wb = openpyxl.load_workbook(SRC)
wbv = openpyxl.load_workbook(SRC, data_only=True)
cur, new = wb['cal_curr'], wb['cal_new']

# cal_new's summary block: formulas over sheets this file does not carry -> their cached values
for ws in (cur, new):
    vs = wbv[ws.title]
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.startswith('='):
                cell.value = vs[cell.coordinate].value

# labels/styles for B:G come from the UNTOUCHED cal_curr (the calendar that ran; wbv is a second,
# unmodified load); cal_new copies the same B:G
src_cur = wbv['cal_curr']
build_sheet(cur, src_cur)
build_sheet(new, src_cur)

for ws in list(wb.worksheets):
    if ws.title not in ('cal_curr', 'cal_new'):
        wb.remove(ws)
for name in list(wb.defined_names.keys()) if hasattr(wb.defined_names, 'keys') else []:
    del wb.defined_names[name]

ch = wb.create_sheet('CHANGES')
intro = [
    'WHY: the engine finds day 1 by the 1 in row 4, its weekday by the name above it (row 3) and its',
    'date by the date above it (row 1). The A/B data and the album season start Tue Oct 13, so day 1',
    'must be the Oct 13 column (B), and Oct 13-18 must be drawn as the events that actually ran, merged',
    'like every other week - otherwise they count as six days with nothing on them.',
    'cal_new gets the same Oct 13-18 as cal_curr: the redesign starts at H (Oct 19) exactly as before,',
    'so old vs new compares calendars from Oct 19 and only configs on Oct 13-18.',
    'Copy rows 1-25 of each sheet over the workbook\'s own, then run EcoGainsSim > Precompute calendars.',
    'Cells marked CHECK are read off the data pattern, not the live schedule - confirm them.',
    '',
]
for i, t in enumerate(intro, 1):
    ch.cell(i, 1, t)
hdr = len(intro) + 1
for j, h in enumerate(['sheet', 'cell', 'change'], 1):
    ch.cell(hdr, j, h).font = openpyxl.styles.Font(bold=True)
for i, (s, c, t) in enumerate(changes, hdr + 1):
    ch.cell(i, 1, s); ch.cell(i, 2, c); ch.cell(i, 3, t)
ch.column_dimensions['C'].width = 140
os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
print('written', OUT, '-', len(changes), 'changed cells')
