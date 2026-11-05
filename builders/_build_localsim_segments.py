"""Builds display/LocalSims_100-249_v1.xlsx (2026-11-05, D94): the config sheets whose local sims ("Player Reach
Simulation" blocks, AI:AS) look a segment up in a data_* sheet by a label typed INSIDE the formula, copied from the
newest LIVE_OPS_V3 workbook with those formulas made to read the old top segment under either of its names.

Why: LIVE_OPS_V3 (20)'s pull calls the old '100+' segment '100-249' (250+ is split out of it). The engine reads
'100+' as '100-249' everywhere (segCanon_), but a sheet formula is not the engine: the '100+' column of every local
sim asks data_event_inst / data_event_accrual / data_RM / data_rm_pace for the literal "100+", finds no row and
shows 0 or n/a. User decision: wherever a column is still called 100+, it means 100-249.

What changes - formulas only, two text rules (the cell values, labels, styles, widths, conditional formatting and
data validation are copied as they are; Sheets-only formulas are unwrapped from the xlsx export's
=IFERROR(__xludf.DUMMYFUNCTION("..."), cached) form):
  1. "100+"  ->  "100*"      a SUMIFS / AVERAGEIFS / COUNTIFS criterion; the wildcard matches '100+' AND '100-249'
                             (no other segment label starts with 100), so the same formula works on either pull.
  2. (_seg_c=seg)  ->  ((_seg_c=seg)+(seg="100*")*((_seg_c="100-249")+(_seg_c="100+"))>0)
                             the data_rm_pace blocks compare a column with a LET variable; '=' has no wildcards, so
                             the 100 column (seg is "100*" after rule 1) accepts both labels explicitly.
The 250+ and ALL segments get NO local-sim column (user decision: not in the local sims for now).

The same two rules can be applied in the live workbook without importing anything: Edit > Find and replace, tick
'Also search within formulas', All sheets - rule 1 first, then rule 2. The README tab of the output says so.

    python builders/_build_localsim_segments.py [--workbook "workbooks/<file>.xlsx"] [--out display/LocalSims_100-249_v1.xlsx]
"""
import argparse, glob, os, re, sys
from copy import copy
import openpyxl
from openpyxl.styles import Font
from openpyxl.worksheet.formula import ArrayFormula

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'display', 'LocalSims_100-249_v1.xlsx')
# sheets the engine writes itself are not local sims: their formulas are rebuilt by the next run
SKIP = {'Col_Cards_Cloud', 'Col_Cards_Cloud w ToF'}
DUMMY = '__xludf.DUMMYFUNCTION("'
OLD_LIT, NEW_LIT = '"100+"', '"100*"'
OLD_EQ = '(_seg_c=seg)'
NEW_EQ = '((_seg_c=seg)+(seg="100*")*((_seg_c="100-249")+(_seg_c="100+"))>0)'


def newest_workbook():
    best, bn = None, -1
    for p in glob.glob(os.path.join(ROOT, 'workbooks', '*LIVE_OPS_V3*.xlsx')):
        m = re.search(r'\((\d+)\)\.xlsx$', p)
        n = int(m.group(1)) if m else 0
        if n > bn:
            best, bn = p, n
    return best


def unwrap(f):
    """=IFERROR(__xludf.DUMMYFUNCTION("<f>"), cached) -> =<f>; anything else unchanged. The export writes a long
    formula as several string literals joined with & ("...part"&"part..."), so the argument is read as that: literal,
    then &"literal" for as long as one follows. (Stopping at the first closing quote truncates every long formula.)"""
    if not isinstance(f, str) or DUMMY not in f:
        return f
    i, out = f.index(DUMMY) + len(DUMMY), []
    while i < len(f):
        ch = f[i]
        if ch == '"':
            if i + 1 < len(f) and f[i + 1] == '"':
                out.append('"')
                i += 2
                continue
            if f[i + 1:i + 3] == '&"':                    # the literal ends here and another one follows
                i += 3
                continue
            break
        out.append(ch)
        i += 1
    return '=' + ''.join(out)


def fix(f, stats):
    """The two rules on one formula text. Returns the new text."""
    if not isinstance(f, str) or not f.startswith('='):
        return f
    n1 = f.count(OLD_LIT)
    if n1:
        f = f.replace(OLD_LIT, NEW_LIT)
        stats['criteria'] += n1
    n2 = f.count(OLD_EQ)
    if n2:
        f = f.replace(OLD_EQ, NEW_EQ)
        stats['equalities'] += n2
    return f


def balanced(f):
    """Parentheses and quotes of a formula still pair up (a text patch must not break either)."""
    depth, in_str, i = 0, False, 0
    while i < len(f):
        ch = f[i]
        if in_str:
            if ch == '"':
                if i + 1 < len(f) and f[i + 1] == '"':
                    i += 2
                    continue
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth < 0:
                return False
        i += 1
    return depth == 0 and not in_str


def formulas_of(ws):
    out = {}
    for row in ws.iter_rows():
        for c in row:
            v = c.value
            if isinstance(v, ArrayFormula):
                out[c.coordinate] = unwrap(v.text)
            elif isinstance(v, str) and v.startswith('='):
                out[c.coordinate] = unwrap(v)
    return out


def copy_sheet(src, dst, stats):
    bad = []
    for row in src.iter_rows():
        for c in row:
            v = c.value
            if isinstance(v, ArrayFormula):
                t = fix(unwrap(v.text), stats)
                if not balanced(t):
                    bad.append(c.coordinate)
                v = ArrayFormula(ref=v.ref, text=t)
            elif isinstance(v, str) and v.startswith('='):
                v = fix(unwrap(v), stats)
                if not balanced(v):
                    bad.append(c.coordinate)
            if v is None and not c.has_style:
                continue
            d = dst.cell(row=c.row, column=c.column, value=v)
            if c.has_style:
                d.font, d.fill, d.border = copy(c.font), copy(c.fill), copy(c.border)
                d.alignment, d.number_format, d.protection = copy(c.alignment), c.number_format, copy(c.protection)
    for k, dim in src.column_dimensions.items():
        dst.column_dimensions[k].width = dim.width
        dst.column_dimensions[k].hidden = dim.hidden
    for k, dim in src.row_dimensions.items():
        if dim.height is not None:
            dst.row_dimensions[k].height = dim.height
    for rng in src.merged_cells.ranges:
        dst.merge_cells(str(rng))
    for cf in src.conditional_formatting:
        for rule in cf.rules:
            dst.conditional_formatting.add(str(cf.sqref), rule)
    for dv in src.data_validations.dataValidation:
        dst.add_data_validation(copy(dv))
    dst.sheet_view.showGridLines = src.sheet_view.showGridLines
    dst.freeze_panes = src.freeze_panes
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workbook', default=None)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    src_path = a.workbook or newest_workbook()
    print('reading', os.path.basename(src_path))
    src = openpyxl.load_workbook(src_path, data_only=False)

    # the sheets to rebuild: every sheet whose formulas carry the "100+" literal (found, not listed)
    targets = []
    for ws in src.worksheets:
        if ws.title in SKIP:
            continue
        fl = formulas_of(ws)
        if any(OLD_LIT in f for f in fl.values()):
            targets.append(ws.title)
    if not targets:
        raise SystemExit('no sheet formula carries the literal "100+" - nothing to rebuild')

    wb = openpyxl.Workbook()
    readme = wb.active
    readme.title = 'LocalSims_README'
    report = []
    for name in targets:
        stats = {'criteria': 0, 'equalities': 0}
        ws = wb.create_sheet(name)
        bad = copy_sheet(src[name], ws, stats)
        left = [k for k, f in formulas_of(ws).items() if OLD_LIT in f.replace(NEW_EQ, '')]   # rule 2's own text names "100+"
        if bad or left:
            raise SystemExit('%s: %d formula(s) unbalanced after the patch (%s), %d still carry "100+" (%s)'
                             % (name, len(bad), ', '.join(bad[:5]), len(left), ', '.join(left[:5])))
        report.append((name, stats['criteria'], stats['equalities']))
        print('%-12s %4d criteria "100+" -> "100*", %3d data_rm_pace comparisons widened' % (name, stats['criteria'], stats['equalities']))

    lines = [
        ('LOCAL SIMS - the 100+ column reads the 100-249 segment (D94, 2026-11-05)', dict(bold=True, size=13)),
        ('Copied from ' + os.path.basename(src_path) + ': every value, formula, style, width, conditional format and '
         'validation of the sheets below. Only formulas differ, by two text rules.', {}),
        ('', {}),
        ('Why', dict(bold=True)),
        ('The re-pulled data calls the old 100+ segment 100-249 (250+ is split out of it). The engine reads 100+ as '
         '100-249 by itself; a sheet formula does not, so every local sim\'s 100+ column was asking the data sheets '
         'for a label they no longer carry and showing 0 or n/a.', {}),
        ('', {}),
        ('The two rules', dict(bold=True)),
        ('1.   ' + OLD_LIT + '   ->   ' + NEW_LIT + '      (the criterion of SUMIFS / AVERAGEIFS / COUNTIFS; the * wildcard '
         'matches both 100+ and 100-249, and no other segment starts with 100)', {}),
        ('2.   ' + OLD_EQ + '   ->   ' + NEW_EQ + '      (RM_1st_v2 / RM_2nd_v2 only: the data_rm_pace block compares '
         'with =, which has no wildcards)', {}),
        ('', {}),
        ('EASIER THAN IMPORTING: the same two rules as Find and replace in the live workbook', dict(bold=True)),
        ('Edit > Find and replace. Tick "Also search within formulas", search "All sheets". Run rule 1 (Find ' + OLD_LIT +
         ', Replace with ' + NEW_LIT + ', Replace all), then rule 2 (Find ' + OLD_EQ + ', Replace with the text of rule 2, '
         'Replace all). Nothing else in the workbook carries either text, so nothing else changes; Col_Cards_Cloud\'s '
         'own formulas are rewritten by the next Simulate card cloud run anyway.', {}),
        ('', {}),
        ('Or import', dict(bold=True)),
        ('File > Import > Upload this file > "Insert new sheet(s)", then for each sheet below copy the block AI1:AS'
         ' (the Player Reach Simulation) from the imported tab over the same range of the live tab (Paste special > '
         'Formula only), and delete the imported tabs. Replacing a whole tab would break the references other sheets '
         'hold to it.', {}),
        ('', {}),
        ('Not changed', dict(bold=True)),
        ('The 250+ and ALL segments have no local-sim column (decided: not in the local sims for now). The data_rm_pace '
         'blocks average every instance and both A/B arms the pull now carries (the engine pools instances by '
         'participants and reads Variant A only) - close, but not the engine\'s number.', {}),
        ('', {}),
        ('Sheet', dict(bold=True)),
    ]
    for i, (t, st) in enumerate(lines):
        readme.cell(row=1 + i, column=1, value=t).font = Font(name='Arial', **st)
    r = len(lines) + 1
    for name, n1, n2 in report:
        readme.cell(row=r, column=1, value='%s: %d criteria, %d data_rm_pace comparisons' % (name, n1, n2)).font = Font(name='Arial')
        r += 1
    readme.column_dimensions['A'].width = 150
    readme.sheet_view.showGridLines = False
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)
    print('written', a.out, '-', len(report), 'sheets,', sum(x[1] for x in report), 'criteria,', sum(x[2] for x in report), 'comparisons')

    # read the artifact back: no "100+" literal left, both rules present where they were applied
    chk = openpyxl.load_workbook(a.out, data_only=False)
    for name, n1, n2 in report:
        fl = formulas_of(chk[name])
        assert not any(OLD_LIT in f.replace(NEW_EQ, '') for f in fl.values()), name + ': "100+" survived the save'
        assert sum(f.count(NEW_LIT) for f in fl.values()) >= n1, name + ': rule 1 lost on save'
        assert sum(f.count(NEW_EQ) for f in fl.values()) == n2, name + ': rule 2 lost on save'
        assert len(fl) == len(formulas_of(src[name])), name + ': formula count changed'
    print('read back OK: %d sheets, formula counts unchanged' % len(report))


if __name__ == '__main__':
    main()
