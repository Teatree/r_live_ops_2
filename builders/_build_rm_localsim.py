"""Builds display/RM_LocalSim_v1.xlsx (2026-10-30): the Rainbow Maker "Player Reach Simulation" block as ONE sheet
to copy into the four RM sheets (RM_1st, RM_2nd, RM_1st_v2, RM_2nd_v2).

The block sits at AI1:AS13 on this sheet - exactly where it goes on an RM sheet - so: select AI1:AS13 here, copy,
click AI1 on the RM sheet, paste. Then set AJ4 to RM_1st or RM_2nd (the only cell that differs between sheets).

What is new against RM_local_sim_formula.md v2 (the cell-by-cell text list in Config_Proposals_v1.xlsx):
  * it reads the number of milestones off the sheet, the way the engine does (readLadder_: rows from 16 down to the
    first blank / non-numeric cell in column A). Clearing rows 41-45 (a 25-milestone ladder) or deleting them both
    work, and a Req Accum cell left behind in a cleared row is not counted
  * AM3 shows that count, so a ladder change is visible at a glance
  * no LAMBDA / BYCOL: column lookups are spelled out and the reward sum is an MMULT, so the formulas survive the
    xlsx import (plain LET is what the other display builders already ship)

    python builders/_build_rm_localsim.py [--dump harness/_mockdata_v3h.json]
"""
import argparse, json, os, sys
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter as L, column_index_from_string as CI

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'display', 'RM_LocalSim_v1.xlsx')
ARIAL = 'Arial'
SEGS = ['0-9', '10-19', '20-39', '40-99', '100+']
MS_COLS = ['AJ', 'AL', 'AN', 'AP', 'AR']
IN_FILL = PatternFill('solid', fgColor='FFFFF2CC')
SIM_FILL = PatternFill('solid', fgColor='FFE2EFDA')
HDR_FILL = PatternFill('solid', fgColor='FFCFE2F3')

# the number of milestones the ENGINE reads: rows 16.. until the first cell in column A that is not a number
N_MS = 'IFERROR(MATCH(TRUE,INDEX(NOT(ISNUMBER($A$16:$A$45)),0),0)-1,ROWS($A$16:$A$45))'


def lookups(day_expr):
    """The LET bindings every formula shares: the cell's rows of data_rm_pace and the matchables quantiles at the
    date `day_expr` resolves to. Every column is found by its header name."""
    col = lambda n: 'INDEX(tbl,0,MATCH("%s",hdr,0))' % n
    q = lambda n: 'IFERROR(AVERAGE(FILTER(%s,hit)),"")' % col(n)
    return ('hdr,data_rm_pace!$1:$1,tbl,data_rm_pace!$A:$ZZ,'
            'seg_c,' + col('segment') + ',pay_c,' + col('payer_flag') + ','
            'len_c,' + col('instance_length_days') + ',day_c,' + col('instance_day') + ','
            'res_c,IFERROR(' + col('resource') + ',"ALL"),cfg_c,IFERROR(' + col('rm_config') + ',""),'
            'ok0,(seg_c=seg)*(pay_c=$AJ$3)*(res_c="ALL"),'
            'ok,IF(SUM(ok0*(cfg_c=$AJ$4))>0,ok0*(cfg_c=$AJ$4),ok0),'
            'len_s,MAX(FILTER(len_c,ok)),'
            'dte,' + day_expr + ','
            'hit,ok*(len_c=len_s)*(day_c=dte),'
            'p25,N(' + q('cum_matchables_p25') + '),p50,N(' + q('cum_matchables_p50') + '),'
            'p75,N(' + q('cum_matchables_p75') + '),avg,N(' + q('cum_matchables_mean') + '),'
            'top,MAX(p75,8*avg-2*(p25+p50+p75)),')


def seg_of(c):
    return 'seg,IF(SUBSTITUTE({c}$5,"_ms","")="100","100+",SUBSTITUTE({c}$5,"_ms","")),'.format(c=c)


def ms_formula(r, c):
    col = lambda n: 'INDEX(tbl,0,MATCH("%s",hdr,0))' % n
    q = lambda n: 'IFERROR(AVERAGE(FILTER(%s,hit)),"")' % col(n)
    return ('=ARRAYFORMULA(IF($AI{r}="","",LET('.format(r=r) + seg_of(c) +
            lookups('IF(AND($AI{r}>=$B$3,$B$3>=len_s-1),len_s,MIN($AI{r},len_s))'.format(r=r)) +
            'p10x,' + q('cum_matchables_p10') + ',p90x,' + q('cum_matchables_p90') + ','
            'p90,IF(ISNUMBER(p90x),p90x,p75+0.6*(top-p75)),p10,IF(ISNUMBER(p10x),p10x,0.4*p25),'
            'mat,IFERROR(SWITCH($AJ$2,"Avg",avg,"p10",p10,"p25",p25,"p50",p50,"p75",p75,"p90",p90),0),'
            'n,' + N_MS + ','
            'IF(n<1,0,COUNTIF(INDEX($C$16:$C$45,1):INDEX($C$16:$C$45,n),"<="&mat)))))')


def reward_formula(r, ms):
    # the column sums of the reward block over the milestones reached, as one MMULT (no BYCOL / LAMBDA)
    return ('=IF($AI{r}="","",IF(N({ms}{r})=0,"{{}}",LET(m,{ms}{r},rng,$E$16:INDEX($Z$16:$Z$45,m),'
            's,MMULT(SEQUENCE(1,m,1,0),ARRAYFORMULA(IF(ISNUMBER(rng),rng,0))),'
            '"{{"&TEXTJOIN(", ",TRUE,ARRAYFORMULA(IF(s>0,$E$15:$Z$15&": "&ROUND(s,2),"")))&"}}")))').format(r=r, ms=ms)


def complete_formula(c):
    return ('=ARRAYFORMULA(LET(' + seg_of(c) + lookups('IF($B$3>=len_s-1,len_s,MIN($B$3,len_s))') +
            'n,' + N_MS + ',x,IF(n<1,0,INDEX($C$16:$C$45,n)),'
            'u,IFS(x<=0,0,x<=p25,0.25*x/MAX(p25,1E-9),x<=p50,0.25+0.25*(x-p25)/MAX(p50-p25,1E-9),'
            'x<=p75,0.5+0.25*(x-p50)/MAX(p75-p50,1E-9),x<=top,0.75+0.25*(x-p75)/MAX(top-p75,1E-9),TRUE,1),'
            '1-u))')


def block():
    """[(cell, value, kind)] for AI1:AS13; kind = title / label / input / header / formula / pct"""
    out = [('AI1', 'Player Reach Simulation (per event day) - from data_rm_pace', 'title'),
           ('AI2', 'Percentile', 'label'), ('AJ2', 'p50', 'input'),
           ('AL2', 'Share completing the whole RM by the last day: row 13', 'label'),
           ('AI3', 'Payer', 'label'), ('AJ3', 'NONPAYER', 'input'),
           ('AL3', 'Milestones read', 'label'), ('AM3', '=' + N_MS, 'formula'),
           ('AI4', 'Config', 'label'), ('AJ4', 'RM_1st', 'input'),
           ('AL4', 'AJ4: RM_1st on RM_1st / RM_1st_v2, RM_2nd on RM_2nd / RM_2nd_v2', 'label'),
           ('AI5', 'Day_of_event', 'header')]
    for seg, c in zip(SEGS, MS_COLS):
        tag = '100' if seg == '100+' else seg
        out.append((c + '5', tag + '_ms', 'header'))
        out.append((L(CI(c) + 1) + '5', tag + '_reward', 'header'))
    for i, r in enumerate(range(6, 13)):
        out.append(('AI%d' % r, '=IF(%d<=$B$3,%d,"")' % (i + 1, i + 1), 'formula'))
        for c in MS_COLS:
            out.append(('%s%d' % (c, r), ms_formula(r, c), 'formula'))
            out.append(('%s%d' % (L(CI(c) + 1), r), reward_formula(r, c), 'formula'))
    out.append(('AI13', 'Completes the whole RM', 'label'))
    for c in MS_COLS:
        out.append(('%s13' % c, complete_formula(c), 'pct'))
    return out


def emulate(dump, ladder_reqs):
    """p50 / NONPAYER milestones reached per day for a ladder, emulated from the dump's data_rm_pace with the same
    rule the formulas use (pooled rows, the longest instance, day d = date d, the last day = the closing date)."""
    v = dump['data_rm_pace']['values']
    h = {str(x).strip(): i for i, x in enumerate(v[0]) if str(x).strip()}
    rows = [r for r in v[1:] if r and str(r[h['payer_flag']]).strip() == 'NONPAYER'
            and ('resource' not in h or str(r[h['resource']]).strip() == 'ALL')]
    out = {}
    for seg in SEGS:
        rs = [r for r in rows if str(r[h['segment']]).strip() == seg]
        if not rs:
            continue
        ls = max(int(float(r[h['instance_length_days']])) for r in rs)
        by = {}
        for r in rs:
            if int(float(r[h['instance_length_days']])) == ls:
                by.setdefault(int(float(r[h['instance_day']])), []).append(float(r[h['cum_matchables_p50']]))
        out[seg] = (ls, {d: sum(x) / len(x) for d, x in by.items()})
    table = {}
    for days in (2, 4):
        for d in range(1, days + 1):
            row = []
            for seg in SEGS:
                ls, m = out[seg]
                dte = ls if (d >= days and days >= ls - 1) else min(d, ls)
                mat = m.get(dte, 0)
                row.append(sum(1 for q in ladder_reqs if q <= mat))
            table[(days, d)] = row
    return table


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dump', default=os.path.join(ROOT, 'harness', '_mockdata_v3h.json'))
    ap.add_argument('--patches', default=os.path.join(ROOT, 'analysis', 'out', 'calbal_patches.json'))
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'RM local sim'
    ws.sheet_view.showGridLines = False
    f = lambda **k: Font(name=ARIAL, **k)
    notes = [
        ('RAINBOW MAKER - LOCAL SIM BLOCK (copy AI1:AS13 into every RM sheet)', dict(bold=True, size=13)),
        ('1. Select AI1:AS13 on this sheet, copy.', {}),
        ('2. On RM_1st, RM_2nd, RM_1st_v2 and RM_2nd_v2: click AI1, paste (replaces the old block).', {}),
        ('3. On RM_2nd and RM_2nd_v2 set AJ4 to RM_2nd (the pasted value is RM_1st).', {}),
        ('4. Format AJ13 / AL13 / AN13 / AP13 / AR13 as %.', {}),
        ('', {}),
        ('What the block reads', dict(bold=True)),
        ('- B3 (EventDuration): how many day rows show. The calendar sets the real length (the engine ignores B3).', {}),
        ('- The ladder: A16:A45 (milestone #), C16:C45 (Req Accum), E15:Z45 (rewards).', {}),
        ('- data_rm_pace, every column found by its header: cum_matchables_p25 / p50 / p75 / mean per instance date,', {}),
        ('  plus p10 / p90 and rm_config when a re-pull carries them (until then p90 is derived, p10 = 0.4 x p25).', {}),
        ('', {}),
        ('Fewer milestones', dict(bold=True)),
        ('- The block counts milestones the way the engine reads them: from row 16 down to the first cell in column A', {}),
        ('  that is not a number. A 25-milestone ladder (rows 41-45 cleared, or deleted) reads 25 - AM3 shows the count.', {}),
        ('- A Req Accum value left in a cleared row is NOT counted, so clearing column A of a row is enough to drop it.', {}),
        ('- Deleting rows also works: every range shrinks with the sheet.', {}),
        ('', {}),
        ('The rule (same as the engine, D77)', dict(bold=True)),
        ('- Day d of the event reads date d of the measured 4-day event; the last day of an event as long as the', {}),
        ('  measured one reads its final (closing) date. A 2-day instance is the first two days of the 4-day event.', {}),
        ('- Row 6..12: milestones REACHED at the end of that day by a player at the AJ2 percentile (AJ3 payer type),', {}),
        ('  and what those milestones pay. Row 13: the share of participants past the last milestone on the last day.', {}),
        ('- The engine also applies a claim factor (5-18% of reached milestones are never claimed at low segments);', {}),
        ('  this view shows what could be claimed.', {}),
    ]
    for i, (t, st) in enumerate(notes):
        c = ws.cell(row=1 + i, column=1, value=t)
        c.font = f(**st)
    ws.column_dimensions['A'].width = 110
    for col in range(2, CI('AH') + 1):
        ws.column_dimensions[L(col)].width = 2
    for cell, val, kind in block():
        c = ws[cell]
        c.value = val
        c.font = f(bold=(kind in ('title', 'header')), size=(11 if kind == 'title' else 10))
        if kind == 'input':
            c.fill = IN_FILL
        elif kind in ('formula', 'pct'):
            c.fill = SIM_FILL
            if kind == 'pct':
                c.number_format = '0.0%'
        elif kind == 'header':
            c.fill = HDR_FILL
    for col in ['AI'] + MS_COLS:
        ws.column_dimensions[col].width = 14
    for c in MS_COLS:
        ws.column_dimensions[L(CI(c) + 1)].width = 40

    # check table: what the block should show once pasted, p50 NONPAYER, on the dump's data_rm_pace
    dump = json.load(open(a.dump, encoding='utf-8'))
    r0 = len(notes) + 3
    ws.cell(row=r0, column=1, value='Check after pasting - p50, NONPAYER, milestones reached (emulated from the same rule on '
            + dump['_meta']['source'] + ')').font = f(bold=True)
    ladders = []
    base = [float(x[2]) for x in dump['RM_1st_v2']['values'][15:45] if x and str(x[0]).strip() not in ('', None)]
    ladders.append(('RM_1st / RM_1st_v2 as in the workbook (30 milestones)', base))
    if os.path.exists(a.patches):
        P = json.load(open(a.patches, encoding='utf-8'))
        new = P.get('reqs', {}).get('RM_1st_v2', {}).get('after')
        if new:
            ladders.append(('the 25-milestone ladder of Calendar_Rebalance_v1.xlsx', [float(x) for x in new]))
    r = r0 + 1
    for name, reqs in ladders:
        t = emulate(dump, reqs)
        ws.cell(row=r, column=1, value=name).font = f(italic=True)
        r += 1
        ws.cell(row=r, column=1, value='B3 / day        ' + '   '.join('%-6s' % s for s in SEGS)).font = Font(name='Consolas', size=9)
        r += 1
        for (days, d), row in sorted(t.items()):
            ws.cell(row=r, column=1, value=('B3=%d  day %d     ' % (days, d)) + '   '.join('%-6d' % x for x in row)).font = Font(name='Consolas', size=9)
            r += 1
        r += 1
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)
    print('written', a.out)


if __name__ == '__main__':
    main()
