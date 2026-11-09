"""Builds display/Ki_Sheets_v1.xlsx (2026-11-09): the two Kite Festival redesign sheets, Ki_v2 (3-day) and Ki_2d_v2
(2-day), copied from 'LIVE_OPS_V3 - Kite Festival.xlsx' cell for cell, with the score columns of the "Player Progression
Simulation" block rewritten so a shorter festival earns less score. Two tabs only: copy the formulas across, or import.

What is copied: every value and formula, array formulas, styles, column widths, row heights, conditional formatting and
data validation (builders/_build_rm_sheets.copy_sheet, one definition). The formulas read data_event_inst,
data_event_kite_accrual, item_vals and Ki, which are not in this file, so they show errors until they sit in the workbook.

What changes: AJ / AL / AN / AP / AR on the day rows of the progression block (rows 17..23) - the score a player at the
AJ2 percentile holds by the end of each event day. Everything else, the value columns (AK..AS) and the reach block
(rows 6..13) included, is the source sheet's.

  old: score = balance x share(day, at the AJ2 percentile), and the FULL measured balance on the sheet's last day (B6).
       The balance comes from 3-day festivals, so Ki_2d_v2's day 2 equalled Ki_v2's day 3.
  new: a festival shorter than the measured one (Ki!B6) is the first B6 days of it at the same pace:
       score(d) = balance x mean share(min(d, B6)); the full balance only on the last day of a festival at least as long
       as Ki!B6 (Ki_v2 day 3 is unchanged). Rows past B6 hold the final score.
       The share is cum_token_share_MEAN whatever AJ2 says (AJ2 still picks the balance): the share percentiles pair a
       balance percentile with a different player's time profile - at p50 the 0-9 / 10-19 share is already 1.0 by day 2,
       at p25 a 2-day festival read -97%. ASSUMPTION: no speed-up because the festival is shorter.
       The segment comes from the column's row-16 header; "100" reads "100*" (100+ or 100-249: (24)'s data says
       100-249, so the old "100+" column read 0).

    python builders/_build_ki_sheets.py [--workbook "workbooks/<file>.xlsx"] [--out display/Ki_Sheets_v1.xlsx]
"""
import argparse, fnmatch, os, sys
import openpyxl
from openpyxl.worksheet.formula import ArrayFormula

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from _build_rm_sheets import copy_sheet, unwrap

SRC = os.path.join(ROOT, 'workbooks', '\U0001F3EELIVE_OPS_V3 - Kite Festival.xlsx')
OUT = os.path.join(ROOT, 'display', 'Ki_Sheets_v1.xlsx')
SHEETS = ['Ki_v2', 'Ki_2d_v2']
SCORE_COLS = ['AJ', 'AL', 'AN', 'AP', 'AR']
HDR_ROW = 16                                          # '0-9_score', '10-19_score', ... '100_score'
DAY_COL = 'AI'


def score_formula(r, col):
    h = f'{col}${HDR_ROW}'
    return (f'=IF(${DAY_COL}{r}="","",LET('
            f'segname,LEFT({h},FIND("_",{h})-1),'
            f'segkey,IF(segname="100","100*",segname),'
            f'bal,SUMIFS(INDEX(data_event_inst!$A:$ZZ,0,MATCH(IF($AJ$2="Avg","avg_final_token_balance",'
            f'"final_balance_"&$AJ$2),data_event_inst!$1:$1,0)),data_event_inst!$A:$A,"Kite Festival",'
            f'data_event_inst!$B:$B,$AJ$3,data_event_inst!$C:$C,segkey),'
            f'evday,MIN(${DAY_COL}{r},$B$6),'
            f'shr,MIN(1,IFERROR(AVERAGEIFS(INDEX(data_event_kite_accrual!$A:$ZZ,0,MATCH("cum_token_share_mean",'
            f'data_event_kite_accrual!$1:$1,0)),data_event_kite_accrual!$A:$A,"Kite Festival",'
            f'data_event_kite_accrual!$B:$B,$AJ$3,data_event_kite_accrual!$C:$C,segkey,'
            f'data_event_kite_accrual!$E:$E,evday),1)),'
            f'IF(AND(${DAY_COL}{r}>=$B$6,$B$6>=Ki!$B$6),bal,ROUND(bal*shr,1))))')


def day_rows(ws):
    """The progression block's day rows: below the header, AI holds =IF(n<=MAX($B$6,Ki!$B$6),n,"")."""
    out = []
    for r in range(HDR_ROW + 1, ws.max_row + 1):
        v = ws[f'{DAY_COL}{r}'].value
        if isinstance(v, str) and 'MAX($B$6' in v:
            out.append(r)
        elif out:
            break
    return out


def text(v):
    return unwrap(v.text if isinstance(v, ArrayFormula) else v)


def emulate(vals, sheet, rows):
    """What the new cells should show: the formula's rule, in Python, on the source workbook's cached data."""
    def table(name):
        v = [list(x) for x in vals[name].iter_rows(values_only=True)]
        return {str(k).strip(): i for i, k in enumerate(v[0]) if k is not None}, v[1:]
    ws = vals[sheet]
    b6, kb6 = float(ws['B6'].value), float(vals['Ki']['B6'].value)
    pct, payer = str(ws['AJ2'].value), str(ws['AJ3'].value)
    hi, ri = table('data_event_inst')
    ha, ra = table('data_event_kite_accrual')
    bcol = hi['avg_final_token_balance' if pct == 'Avg' else 'final_balance_' + pct]
    out = {}
    for col in SCORE_COLS:
        name = str(ws[f'{col}{HDR_ROW}'].value).split('_')[0]
        key = '100*' if name == '100' else name
        hit = lambda r, h: (r[h['event_name']] == 'Kite Festival' and r[h['payer_flag']] == payer
                            and fnmatch.fnmatchcase(str(r[h['segment']]), key))
        bal = sum(float(r[bcol] or 0) for r in ri if hit(r, hi))
        vals_col = []
        for i, r in enumerate(rows):
            d = i + 1
            if d > max(b6, kb6):
                vals_col.append('')
                continue
            sh = [float(x[ha['cum_token_share_mean']]) for x in ra if hit(x, ha) and float(x[ha['event_day']]) == min(d, b6)]
            shr = min(1.0, sum(sh) / len(sh)) if sh else 1.0
            vals_col.append(bal if (d >= b6 and b6 >= kb6) else round(bal * shr, 1))
        out[col] = vals_col
    return out, b6, pct, payer


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workbook', default=SRC)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    print('reading', os.path.basename(a.workbook))
    src = openpyxl.load_workbook(a.workbook, data_only=False)
    vals = openpyxl.load_workbook(a.workbook, data_only=True)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    plan = {}
    for name in SHEETS:
        ws = wb.create_sheet(name)
        copy_sheet(src[name], ws, skip=lambda r, c: False)
        rows = day_rows(src[name])
        for col in SCORE_COLS:
            hdr = str(src[name][f'{col}{HDR_ROW}'].value)
            if not hdr.endswith('_score'):
                raise SystemExit(f'{name}!{col}{HDR_ROW} = {hdr!r}: not a score column, the block has moved')
            for r in rows:
                ws[f'{col}{r}'].value = score_formula(r, col)
        plan[name] = rows
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)

    # read the file back: two tabs, every cell the source's bar the rewritten ones, which hold the new formula
    chk = openpyxl.load_workbook(a.out)
    assert chk.sheetnames == SHEETS, chk.sheetnames
    for name in SHEETS:
        s, d, rows = src[name], chk[name], plan[name]
        new = {(r, openpyxl.utils.column_index_from_string(c)) for c in SCORE_COLS for r in rows}
        same = diff = 0
        for row in s.iter_rows():
            for c in row:
                got = d.cell(row=c.row, column=c.column).value
                if (c.row, c.column) in new:
                    assert got == score_formula(c.row, openpyxl.utils.get_column_letter(c.column)), (name, c.coordinate)
                    assert got.count('(') == got.count(')') and got.count('"') % 2 == 0
                    diff += 1
                elif text(c.value) != text(got):
                    raise SystemExit(f'{name}!{c.coordinate} differs from the source: {text(got)!r}')
                else:
                    same += c.value is not None
        exp, b6, pct, payer = emulate(vals, name, rows)
        print(f'{name}: B6 = {b6:g}, {diff} score cells rewritten (rows {rows[0]}..{rows[-1]}), {same} cells as the source')
        print(f'   expected at AJ2 = {pct}, AJ3 = {payer}   (old cached value in brackets)')
        print('   day  ' + '  '.join(f'{str(s[f"{c}{HDR_ROW}"].value):>22}' for c in SCORE_COLS))
        for i, r in enumerate(rows):
            if all(exp[c][i] == '' for c in SCORE_COLS):
                continue
            cells = []
            for c in SCORE_COLS:
                old = vals[name][f'{c}{r}'].value
                cells.append(f'{exp[c][i]:>10.1f} ({old if old in ("", None) else round(float(old), 1):>9})')
            print(f'   {i + 1:<4} ' + '  '.join(f'{x:>22}' for x in cells))
    print('written', a.out)


if __name__ == '__main__':
    main()
