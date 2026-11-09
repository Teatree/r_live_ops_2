"""Builds display/Ki_Sheets_v2.xlsx (2026-11-09): the two Kite Festival redesign sheets, Ki_v2 (3-day) and Ki_2d_v2
(2-day), copied from 'LIVE_OPS_V3 - Kite Festival.xlsx' cell for cell, with the local sim (AI1:AS23) rewritten so it
follows the festival's length, shows what the player actually receives, and reads the 100 group. Two tabs only: copy
the formulas across, or import.

What is copied: every value and formula, array formulas, styles, column widths, row heights, conditional formatting and
data validation (builders/_build_rm_sheets.copy_sheet, one definition). The formulas read data_event_inst,
data_event_kite_accrual, item_vals and Ki, which are not in this file, so they show errors until they sit in the workbook.
Every rewritten cell is written as an array formula, like the cells Google exported around it.

What changes (both tabs, the five segment column pairs AJ:AK .. AR:AS):

  Player Progression, score (AJ/AL/AN/AP/AR, rows 17..23)
     old: balance x share(day, at the AJ2 percentile), and the FULL measured balance on the sheet's last day (B6). The
          balance comes from 3-day festivals, so Ki_2d_v2's day 2 equalled Ki_v2's day 3.
     new: a festival shorter than the measured one (Ki!B6) is the first B6 days of it at the same pace:
          score(d) = balance x mean share(min(d, B6)); the full balance only on the last day of a festival at least as
          long as Ki!B6 (Ki_v2 day 3 is unchanged). Rows past B6 hold the final score. The share is
          cum_token_share_MEAN whatever AJ2 says (AJ2 still picks the balance): the share percentiles pair a balance
          percentile with a different player's time profile - at p50 the 0-9 / 10-19 share is already 1.0 by day 2,
          at p25 a 2-day festival read -97%. ASSUMPTION: no speed-up because the festival is shorter.
  Player Progression, value (AK/AM/AO/AQ/AS, rows 17..23)
     the leaderboard value is paid only to a player who reached milestonesRequiredForLeaderboard (B7) milestones.
  Player Reach, milestones (AJ/AL/AN/AP/AR, rows 6..12)
     old: its own score - the AVG balance whatever AJ2 says, x the AJ2-percentile share, no festival-length rule.
     new: COUNTIF of the milestone requirement against the progression block's score for the same day (one definition).
  Player Reach, reward (AK/AM/AO/AQ/AS, rows 6..12)
     old: the milestone rewards only - '{Unlimited Lives: 30}' on every row, the leaderboard never in it.
     new: everything received by the end of that day: the milestone rewards reached, plus the row-13 rank's leaderboard
          reward from the festival's last day (B6) on, if the player reached B7 milestones and the rank pays (1..25).
  Player Reach, leaderboard rank (AJ/AL/AN/AP/AR, row 13)
     old: position_p25 for the p25 player - the GOOD end of the board for the low-balance player (0-9 NONPAYER: rank 22).
     new: the opposite percentile (p25 player -> position_p75, p75 -> position_p25, p50 / Avg -> position_p50): every
          segment's data has a higher balance at a better rank. Columns found by header.
  All of them: the segment comes from the column's header ('0-9_ms', '0-9_score'); "100" reads "100*" (100+ or 100-249:
  the data says 100-249 since (20), so the 100 column read 0 and 'n/a').

    python builders/_build_ki_sheets.py [--workbook "workbooks/<file>.xlsx"] [--out display/Ki_Sheets_v2.xlsx]
"""
import argparse, fnmatch, os, re, sys
import openpyxl
from openpyxl.utils import get_column_letter as L, column_index_from_string as CI
from openpyxl.worksheet.formula import ArrayFormula

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from _build_rm_sheets import copy_sheet, unwrap

SRC = os.path.join(ROOT, 'workbooks', '\U0001F3EELIVE_OPS_V3 - Kite Festival.xlsx')
OUT = os.path.join(ROOT, 'display', 'Ki_Sheets_v2.xlsx')
SHEETS = ['Ki_v2', 'Ki_2d_v2']
SEG_COLS = ['AJ', 'AL', 'AN', 'AP', 'AR']           # each followed by its reward / value column
DAY_COL = 'AI'
REACH_HDR, PROG_HDR = 5, 16                          # '0-9_ms' / '0-9_score' header rows
LB_LABEL = 'Kite Festival (LB)'
CONFIG = {'B6': 'Event Duration (days)', 'B7': 'milestonesRequiredForLeaderboard'}
MS_REQ, MS_REW, MS_HDR = '$B$23', '$C$23:$X$23', '$C$22:$X$22'   # the one milestone: score req, rewards, headers
LB_REW, LB_PAID = '$C$27:$X$51', 25                  # leaderboard rewards, positions 1..25
DAY_RE = re.compile(r'^=IF\((\d+)<=MAX\(\$B\$6,Ki!\$B\$6\),\1,""\)$')


def nxt(col):
    return L(CI(col) + 1)


def seg_key(hdr_cell):
    """LET bindings: the segment from the column header ('0-9_ms' -> '0-9'); '100' -> '100*' (100+ or 100-249)."""
    return (f'segname,LEFT({hdr_cell},FIND("_",{hdr_cell})-1),'
            f'segkey,IF(segname="100","100*",segname),')


def score_formula(r, col):
    return (f'=IF(${DAY_COL}{r}="","",LET(' + seg_key(f'{col}${PROG_HDR}') +
            f'bal,SUMIFS(INDEX(data_event_inst!$A:$ZZ,0,MATCH(IF($AJ$2="Avg","avg_final_token_balance",'
            f'"final_balance_"&$AJ$2),data_event_inst!$1:$1,0)),data_event_inst!$A:$A,"Kite Festival",'
            f'data_event_inst!$B:$B,$AJ$3,data_event_inst!$C:$C,segkey),'
            f'evday,MIN(${DAY_COL}{r},$B$6),'
            f'shr,MIN(1,IFERROR(AVERAGEIFS(INDEX(data_event_kite_accrual!$A:$ZZ,0,MATCH("cum_token_share_mean",'
            f'data_event_kite_accrual!$1:$1,0)),data_event_kite_accrual!$A:$A,"Kite Festival",'
            f'data_event_kite_accrual!$B:$B,$AJ$3,data_event_kite_accrual!$C:$C,segkey,'
            f'data_event_kite_accrual!$E:$E,evday),1)),'
            f'IF(AND(${DAY_COL}{r}>=$B$6,$B$6>=Ki!$B$6),bal,ROUND(bal*shr,1))))')


def value_formula(src_text, r):
    """The source's value formula with the leaderboard gated on B7 milestones reached."""
    old = f'IF(AND(${DAY_COL}{r}>=$B$6,ISNUMBER(pos)'
    if src_text.count(old) != 1:
        raise SystemExit(f'value formula on row {r} no longer has the expected leaderboard test: {src_text[:120]}')
    return src_text.replace(old, f'IF(AND(${DAY_COL}{r}>=$B$6,m>=$B$7,ISNUMBER(pos)')


def ms_formula(r, prog_r, col):
    return f'=IF(${DAY_COL}{r}="","",COUNTIF({MS_REQ},"<="&{col}{prog_r}))'


def reward_formula(r, col):
    return (f'=IF(${DAY_COL}{r}="","",LET(m,{col}{r},pos,{col}${{lb}},'
            f'paid,AND(${DAY_COL}{r}>=$B$6,m>=$B$7,ISNUMBER(pos),N(pos)>=1,N(pos)<={LB_PAID}),'
            f'ms,MMULT(SEQUENCE(1,MAX(m,1),IF(m>0,1,0),0),{MS_REW}),'
            f'lb,MMULT(SEQUENCE(1,1,IF(paid,1,0),0),INDEX({LB_REW},MIN({LB_PAID},MAX(1,N(pos))),0)),'
            f's,MAP(ms,lb,LAMBDA(a,b,a+b)),'
            f'txt,TEXTJOIN(", ",TRUE,MAP({MS_HDR},s,LAMBDA(h,v,IF(v>0,h&": "&ROUND(v,2),"")))),'
            f'IF(txt="","{{}}","{{"&txt&"}}")))')


def position_formula(col):
    return ('=LET(' + seg_key(f'{col}${REACH_HDR}') +
            'q,IF($AJ$2="p25","p75",IF($AJ$2="p75","p25","p50")),'
            'pos,IFERROR(SUMIFS(INDEX(data_event_inst!$A:$ZZ,0,MATCH("position_"&q,data_event_inst!$1:$1,0)),'
            'data_event_inst!$A:$A,"Kite Festival",data_event_inst!$B:$B,$AJ$3,data_event_inst!$C:$C,segkey),0),'
            'IF(pos=0,"n/a",pos))')


def text(v):
    return unwrap(v.text if isinstance(v, ArrayFormula) else v)


def layout(ws):
    """Day rows of both blocks keyed by day number, and the leaderboard row; stops on anything unexpected."""
    for cell, label in CONFIG.items():
        a = ws[cell.replace('B', 'A')].value
        if str(a).strip() != label:
            raise SystemExit(f'{ws.title}!{cell.replace("B", "A")} = {a!r}, expected {label!r}: the config panel moved')
    lb = [r for r in range(1, PROG_HDR) if ws[f'{DAY_COL}{r}'].value == LB_LABEL]
    if len(lb) != 1:
        raise SystemExit(f'{ws.title}: {LB_LABEL!r} not found once in column {DAY_COL}')
    reach, prog = {}, {}
    for r in range(REACH_HDR + 1, ws.max_row + 1):
        m = DAY_RE.match(str(text(ws[f'{DAY_COL}{r}'].value)))
        if m:
            (reach if r < lb[0] else prog)[int(m.group(1))] = r
    if sorted(reach) != sorted(prog) or min(prog.values()) <= PROG_HDR:
        raise SystemExit(f'{ws.title}: reach days {sorted(reach)} vs progression days {sorted(prog)}')
    for col in SEG_COLS:
        for row, suf in ((REACH_HDR, ('_ms', '_reward')), (PROG_HDR, ('_score', '_val'))):
            h = (str(ws[f'{col}{row}'].value), str(ws[f'{nxt(col)}{row}'].value))
            if not (h[0].endswith(suf[0]) and h[1].endswith(suf[1])):
                raise SystemExit(f'{ws.title}!{col}{row}:{nxt(col)}{row} = {h}: the block has moved')
    return reach, prog, lb[0]


def rewrite(src_ws, ws):
    """Every rewritten cell -> its formula (written as an array formula, like the export around it)."""
    reach, prog, lb = layout(src_ws)
    cells = {}
    for col in SEG_COLS:
        cells[f'{col}{lb}'] = position_formula(col)
        for d, r in prog.items():
            cells[f'{col}{r}'] = score_formula(r, col)
            cells[f'{nxt(col)}{r}'] = value_formula(text(src_ws[f'{nxt(col)}{r}'].value), r)
        for d, r in reach.items():
            cells[f'{col}{r}'] = ms_formula(r, prog[d], col)
            cells[f'{nxt(col)}{r}'] = reward_formula(r, col).replace('{lb}', str(lb))
    for a, f in cells.items():
        if f.count('(') != f.count(')') or f.count('"') % 2:
            raise SystemExit(f'{ws.title}!{a}: unbalanced formula {f[:80]}')
        ws[a].value = ArrayFormula(ref=a, text=f)
    return cells, reach, prog, lb


def emulate(vals, sheet, reach, prog, lb):
    """What the rewritten cells should show: each formula's rule, in Python, on the source workbook's cached data."""
    def table(name):
        v = [list(x) for x in vals[name].iter_rows(values_only=True)]
        return {str(k).strip(): i for i, k in enumerate(v[0]) if k is not None}, v[1:]
    ws = vals[sheet]
    num = lambda x: float(x or 0)
    b6, b7, kb6 = num(ws['B6'].value), num(ws['B7'].value), num(vals['Ki']['B6'].value)
    pct, payer = str(ws['AJ2'].value), str(ws['AJ3'].value)
    hi, ri = table('data_event_inst')
    ha, ra = table('data_event_kite_accrual')
    iv = vals['item_vals']
    price = {str(iv.cell(2, c).value).strip(): num(iv.cell(3, c).value) for c in range(2, 22) if iv.cell(2, c).value}
    hdrs = [str(ws.cell(22, c).value) for c in range(3, 25)]
    prices = [price.get('ToF_Value' if h == 'ToF_Ticket' else h, 0.0) for h in hdrs]
    ms_req, ms_rew = num(ws['B23'].value), [num(ws.cell(23, c).value) for c in range(3, 25)]
    lb_rew = {p: [num(ws.cell(26 + p, c).value) for c in range(3, 25)] for p in range(1, LB_PAID + 1)}
    z = {p: num(ws.cell(26 + p, 26).value) for p in range(1, LB_PAID + 1)}
    bcol = hi['avg_final_token_balance' if pct == 'Avg' else 'final_balance_' + pct]
    qpos = {'p25': 'p75', 'p75': 'p25'}.get(pct, 'p50')
    fmt = lambda s: '{' + ', '.join(f'{h}: {round(v, 2):g}' for h, v in zip(hdrs, s) if v > 0) + '}'
    out = {}
    for col in SEG_COLS:
        name = str(ws[f'{col}{PROG_HDR}'].value).split('_')[0]
        key = '100*' if name == '100' else name
        hit = lambda r, h: (r[h['event_name']] == 'Kite Festival' and r[h['payer_flag']] == payer
                            and fnmatch.fnmatchcase(str(r[h['segment']]), key))
        bal = sum(num(r[bcol]) for r in ri if hit(r, hi))
        pos = sum(num(r[hi['position_' + qpos]]) for r in ri if hit(r, hi))
        days = []
        for d in sorted(prog):
            if d > max(b6, kb6):
                continue
            sh = [num(x[ha['cum_token_share_mean']]) for x in ra if hit(x, ha) and num(x[ha['event_day']]) == min(d, b6)]
            score = bal if (d >= b6 and b6 >= kb6) else round(bal * min(1.0, sum(sh) / len(sh) if sh else 1.0), 1)
            m = 1 if score >= ms_req else 0
            paid = d >= b6 and m >= b7 and 1 <= pos <= LB_PAID
            s = [(a if m else 0) + (lb_rew[int(pos)][i] if paid else 0) for i, a in enumerate(ms_rew)]
            value = round((sum(a * p for a, p in zip(ms_rew, prices)) if m else 0) + (z[int(pos)] if paid else 0), 1)
            days.append((d, score, m, fmt(s), value))
        out[col] = (int(pos) if pos else 'n/a', days)
    return out, b6, b7, pct, payer


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
        plan[name] = rewrite(src[name], ws)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)

    # read the file back: two tabs, every cell the source's bar the rewritten ones, which hold their new formula
    chk = openpyxl.load_workbook(a.out)
    assert chk.sheetnames == SHEETS, chk.sheetnames
    for name in SHEETS:
        s, d = src[name], chk[name]
        cells, reach, prog, lb = plan[name]
        same = 0
        for row in s.iter_rows():
            for c in row:
                got = d.cell(row=c.row, column=c.column).value
                if c.coordinate in cells:
                    assert isinstance(got, ArrayFormula) and got.text == cells[c.coordinate], (name, c.coordinate)
                elif text(c.value) != text(got):
                    raise SystemExit(f'{name}!{c.coordinate} differs from the source: {text(got)!r}')
                else:
                    same += c.value is not None
        exp, b6, b7, pct, payer = emulate(vals, name, reach, prog, lb)
        print(f'\n{name}: B6 = {b6:g}, B7 = {b7:g}, {len(cells)} cells rewritten, {same} cells as the source; '
              f'expected at AJ2 = {pct}, AJ3 = {payer}')
        for col in SEG_COLS:
            pos, days = exp[col]
            seg = str(s[f'{col}{PROG_HDR}'].value).split('_')[0]
            print(f'  {seg:>5}  rank {pos} (was {vals[name][f"{col}{lb}"].value})')
            for dd, score, m, rew, value in days:
                old = vals[name][f'{nxt(col)}{reach[dd]}'].value
                print(f'      day {dd}: score {score:>9.1f}  ms {m}  value {value:>6.1f}  reward {rew}   (was {old})')
    print('\nwritten', a.out)


if __name__ == '__main__':
    main()
