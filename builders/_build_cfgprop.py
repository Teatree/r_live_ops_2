"""Builds display/Config_Proposals_v1.xlsx (2026-10-30, D79): the proposed config changes as ONE workbook.

Tabs
  Summary              targets vs what the engine measures, before -> after, per segment
  Changes              every changed cell: sheet, cell, value in LIVE_OPS_V3 (8), proposed value, why
  <one tab per sheet>  a copy of the _v2 sheet from LIVE_OPS_V3 (8) (values and formatting) with every
                       proposed value in RED, and the reasoning block to the right of the sheet's data
  RM local sim         every formula of the 'Player Reach Simulation' block on the four RM sheets,
                       rewritten for data_rm_pace (see RM_local_sim_formula.md)

Inputs: the workbook of record, analysis/out/cfgprop_patches.json (builders/_design_cfgprop.py) and
analysis/out/cfgprop_eval.json + cfgprop_baseline.json (harness/_probe_cfgprop.js). Regenerate by
re-running those three steps; never hand-edit the xlsx.

    python builders/_build_cfgprop.py [--workbook "workbooks/🏮LIVE_OPS_V3 (8).xlsx"]
"""
import argparse, copy, glob, json, os, sys
import openpyxl
sys.stdout.reconfigure(encoding="utf-8")
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L, column_index_from_string as CI

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'display', 'Config_Proposals_v1.xlsx')
PATCHES = os.path.join(ROOT, 'analysis', 'out', 'cfgprop_patches.json')
EVAL = os.path.join(ROOT, 'analysis', 'out', 'cfgprop_eval.json')
BASE = os.path.join(ROOT, 'analysis', 'out', 'cfgprop_baseline.json')

RED = 'FFFF0000'
ARIAL = 'Arial'
HDR_FILL = PatternFill('solid', fgColor='FFCFE2F3')
SIM_FILL = PatternFill('solid', fgColor='FFE2EFDA')
IN_FILL = PatternFill('solid', fgColor='FFFFF2CC')
THIN = Side(style='thin', color='FFBFBFBF')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
SEGS = ['0-9', '10-19', '20-39', '40-99', '100+']
CELLS = [s + ' ' + p for s in SEGS for p in ('NONPAYER', 'PAYER')]
ORDER = ['c_saga_v2', 'NS_v2', 'NS_v2_weekday', 'RM_1st_v2', 'RM_2nd_v2', 'HH_v2', 'J_v2', 'BB_v2', 'Ki_v2',
         'Race_v2', 'TaD_v2', 'SP_v2', 'ToF_v2', 'PackConfig_v2']


def newest_workbook():
    c = [p for p in glob.glob(os.path.join(ROOT, 'workbooks', '*LIVE_OPS_V3 (*).xlsx'))]
    c.sort(key=lambda p: int(p.rsplit('(', 1)[1].split(')')[0]))
    return c[-1]


def copy_sheet(src, dst):
    for row in src.iter_rows():
        for c in row:
            if c.value is None and not c.has_style:
                continue
            d = dst.cell(row=c.row, column=c.column, value=c.value)
            if c.has_style:
                d.font = copy.copy(c.font)
                # red marks ONLY the proposals in this file: text the workbook already had in red (the V2Diff
                # marks, a few titles) is shown black here, so a red cell can never be misread as a change
                if c.font is not None and c.font.color is not None and c.font.color.rgb == RED:
                    f = c.font
                    d.font = Font(name=f.name, size=f.size, bold=f.bold, italic=f.italic, underline=f.underline,
                                  color='FF000000')
                d.fill = copy.copy(c.fill)
                d.border = copy.copy(c.border)
                d.alignment = copy.copy(c.alignment)
                d.number_format = c.number_format
    for k, dim in src.column_dimensions.items():
        if dim.width:
            dst.column_dimensions[k].width = dim.width
    for k, dim in src.row_dimensions.items():
        if dim.height:
            dst.row_dimensions[k].height = dim.height
    for m in src.merged_cells.ranges:
        dst.merge_cells(str(m))
    dst.sheet_view.showGridLines = src.sheet_view.showGridLines
    dst.freeze_panes = src.freeze_panes


def red(cell):
    f = copy.copy(cell.font) if cell.has_style else Font(name=ARIAL)
    cell.font = Font(name=f.name or ARIAL, size=f.size, bold=True, italic=f.italic, color=RED)


def fmt(v):
    if isinstance(v, float) and abs(v - round(v)) < 1e-9:
        return int(round(v))
    return v


def pct(x):
    return '%.1f%%' % (100 * x)


# ------------------------------------------------------------------------------- RM formulas
def rm_ms_formula(r, c):
    return ('=ARRAYFORMULA(IF($AI{r}="","",LET(seg,IF(SUBSTITUTE({c}$5,"_ms","")="100","100+",SUBSTITUTE({c}$5,"_ms","")),'
            'hdr,data_rm_pace!$1:$1,tbl,data_rm_pace!$A:$ZZ,col,LAMBDA(n,IFERROR(INDEX(tbl,0,MATCH(n,hdr,0)),"")),'
            'seg_c,col("segment"),pay_c,col("payer_flag"),len_c,col("instance_length_days"),day_c,col("instance_day"),'
            'res_c,col("resource"),cfg_c,col("rm_config"),ok0,(seg_c=seg)*(pay_c=$AJ$3)*(res_c="ALL"),'
            'ok,IF(SUM(ok0*(cfg_c=$AJ$4))>0,ok0*(cfg_c=$AJ$4),ok0),len_s,MAX(FILTER(len_c,ok)),'
            'dte,IF(AND($AI{r}>=$B$3,$B$3>=len_s-1),len_s,MIN($AI{r},len_s)),hit,ok*(len_c=len_s)*(day_c=dte),'
            'q,LAMBDA(n,IFERROR(AVERAGE(FILTER(col(n),hit)),"")),p25,q("cum_matchables_p25"),p50,q("cum_matchables_p50"),'
            'p75,q("cum_matchables_p75"),avg,q("cum_matchables_mean"),p10x,q("cum_matchables_p10"),p90x,q("cum_matchables_p90"),'
            'top,MAX(p75,8*avg-2*(p25+p50+p75)),p90,IF(ISNUMBER(p90x),p90x,p75+0.6*(top-p75)),'
            'p10,IF(ISNUMBER(p10x),p10x,0.4*p25),'
            'mat,IFERROR(SWITCH($AJ$2,"Avg",avg,"p10",p10,"p25",p25,"p50",p50,"p75",p75,"p90",p90),0),'
            'COUNTIF($C$16:$C$45,"<="&mat))))').format(r=r, c=c)


def rm_reward_formula(r, ms):
    return ('=IF($AI{r}="","",IF(N({ms}{r})=0,"{{}}",LET(m,{ms}{r},s,BYCOL($E$16:INDEX($Z$16:$Z$45,m),LAMBDA(x,SUM(x))),'
            '"{{"&TEXTJOIN(", ",TRUE,IF(s>0,$E$15:$Z$15&": "&ROUND(s,2),""))&"}}")))').format(r=r, ms=ms)


def rm_complete_formula(c):
    return ('=ARRAYFORMULA(LET(seg,IF(SUBSTITUTE({c}$5,"_ms","")="100","100+",SUBSTITUTE({c}$5,"_ms","")),'
            'hdr,data_rm_pace!$1:$1,tbl,data_rm_pace!$A:$ZZ,col,LAMBDA(n,IFERROR(INDEX(tbl,0,MATCH(n,hdr,0)),"")),'
            'seg_c,col("segment"),pay_c,col("payer_flag"),len_c,col("instance_length_days"),day_c,col("instance_day"),'
            'res_c,col("resource"),cfg_c,col("rm_config"),ok0,(seg_c=seg)*(pay_c=$AJ$3)*(res_c="ALL"),'
            'ok,IF(SUM(ok0*(cfg_c=$AJ$4))>0,ok0*(cfg_c=$AJ$4),ok0),len_s,MAX(FILTER(len_c,ok)),'
            'dte,IF($B$3>=len_s-1,len_s,MIN($B$3,len_s)),hit,ok*(len_c=len_s)*(day_c=dte),'
            'q,LAMBDA(n,IFERROR(AVERAGE(FILTER(col(n),hit)),"")),p25,q("cum_matchables_p25"),p50,q("cum_matchables_p50"),'
            'p75,q("cum_matchables_p75"),avg,q("cum_matchables_mean"),top,MAX(p75,8*avg-2*(p25+p50+p75)),'
            'x,MAX($C$16:$C$45),'
            'u,IFS(x<=0,0,x<=p25,0.25*x/MAX(p25,1E-9),x<=p50,0.25+0.25*(x-p25)/MAX(p50-p25,1E-9),'
            'x<=p75,0.5+0.25*(x-p50)/MAX(p75-p50,1E-9),x<=top,0.75+0.25*(x-p75)/MAX(top-p75,1E-9),TRUE,1),'
            '1-u))').format(c=c)


def rm_formulas(sheet):
    cfg = 'RM_1st' if sheet.startswith('RM_1st') else 'RM_2nd'
    out = [('AI1', 'Player Reach Simulation (per event day) - from data_rm_pace', 'title (text)'),
           ('AI2', 'Percentile', 'label'), ('AJ2', 'p50', 'INPUT: Avg / p10 / p25 / p50 / p75 / p90'),
           ('AL2', 'Share completing the whole RM by the last day: row 13', 'note (replaces the old 0.325% text)'),
           ('AI3', 'Payer', 'label'), ('AJ3', 'NONPAYER', 'INPUT: NONPAYER / PAYER'),
           ('AI4', 'Config', 'label (new)'),
           ('AJ4', cfg, 'INPUT (new): which data_rm_pace rows to read once the pull carries rm_config; ignored until then'),
           ('AI5', 'Day_of_event', 'header')]
    msc = ['AJ', 'AL', 'AN', 'AP', 'AR']
    for seg, c in zip(SEGS, msc):
        nxt = L(CI(c) + 1)
        out.append((c + '5', ('100' if seg == '100+' else seg) + '_ms', 'header - the segment is read from this text'))
        out.append((nxt + '5', ('100' if seg == '100+' else seg) + '_reward', 'header'))
    for i, r in enumerate(range(6, 13)):
        out.append(('AI%d' % r, '=IF(%d<=$B$3,%d,"")' % (i + 1, i + 1), 'event day %d (rows past EventDuration stay blank)' % (i + 1)))
        for c in msc:
            nxt = L(CI(c) + 1)
            out.append(('%s%d' % (c, r), rm_ms_formula(r, c), 'milestones reached at the end of this day'))
            out.append(('%s%d' % (nxt, r), rm_reward_formula(r, c), 'everything those milestones pay'))
    out.append(('AI13', 'Completes the whole RM', 'label (new)'))
    for c in msc:
        out.append(('%s13' % c, rm_complete_formula(c), 'share of participants past the last milestone (format as %)'))
    return out


# ------------------------------------------------------------------------------- Summary
def summary_sheet(wb, P, E, B):
    ws = wb.create_sheet('Summary', 0)
    ws.sheet_view.showGridLines = False
    r = 1
    def put(row, col, v, bold=False, fill=None, wrap=False, size=None, italic=False, fmt_=None):
        c = ws.cell(row=row, column=col, value=v)
        c.font = Font(name=ARIAL, bold=bold, size=size or 10, italic=italic)
        if fill: c.fill = fill
        if wrap: c.alignment = Alignment(wrap_text=True, vertical='top')
        if fmt_: c.number_format = fmt_
        return c
    put(r, 1, 'Config proposals - Saga, SPT split, Season Pass, albums, Tower of Fortune', bold=True, size=14); r += 1
    put(r, 1, 'Proposed 2026-10-30 on top of the _v2 sheets of LIVE_OPS_V3 (8). Judged as a CONFIG-ONLY change on the A/B '
              'calendar (cal_new := cal_curr), 28-day window Mon 19 Oct - Sun 15 Nov, engine D79, measured side = Variant A '
              '(16 days of data scaled to the window). Card sim: %d seasons per segment x payer.' % E['meta']['n'],
        italic=True); r += 2
    put(r, 1, 'HOW TO APPLY', bold=True); r += 1
    for line in ['Every red cell on a sheet tab is a proposed value; every other cell is LIVE_OPS_V3 (8) unchanged. The layouts '
                 'are identical, so paste the red cells into the same cells of the workbook (the Changes tab lists them all). '
                 'Text that was already red in the workbook (the V2Diff marks) is shown black here.',
                 'Formula cells on these tabs are copies of the values (8) had cached - totals and helper columns next to red '
                 'cells recalculate once pasted into the workbook.',
                 'Re-paste the D79 engine first: without it the engine cannot see half of these changes (SPT added to events '
                 'that paid none, Saga envelopes, PackConfig_v2 / AlbumConfig_v2 / ToF_v2).',
                 'To see the comparison these numbers come from: cal_new = cal_curr, run Precompute calendars, refresh.']:
        put(r, 1, '- ' + line, wrap=True); ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=12); ws.row_dimensions[r].height = 30; r += 1
    r += 1
    # ---- targets
    put(r, 1, 'TARGETS', bold=True); r += 1
    hdr = ['Target', 'Before', 'After', 'Verdict']
    for i, h in enumerate(hdr): put(r, 1 + i * 3, h, bold=True, fill=HDR_FILL)
    r += 1
    cp, bp = E['cardsPop'], B['cardsPop']
    sb, sv = B['saga']['base'], E['saga']['v2']
    def share(cell, side, src):
        x = src['cells'][cell]['spt'][side]
        return x['share']
    eng = ['40-99 NONPAYER', '40-99 PAYER', '100+ NONPAYER', '100+ PAYER']
    rows = [
        ('Saga: no coins, no boosters, value kept (item_vals "new")',
         'HC %d per 100 levels; value %.1f' % (sb['items']['HC'], sb['valueNew']),
         'HC %d; value %.1f' % (sv['items']['HC'], sv['valueNew']), 'met'),
        ('SPT ~50/50 Core vs events (engaged segments), share from events over the window',
         ', '.join('%s %s' % (c.replace('NONPAYER', 'NP').replace('PAYER', 'P'), pct(share(c, 'meas', B))) for c in eng),
         ', '.join('%s %s' % (c.replace('NONPAYER', 'NP').replace('PAYER', 'P'), pct(share(c, 'sim', E))) for c in eng),
         'met (48-53%)'),
        ('Album 1 among active participants (>= 14 of 28 days, >= 1 envelope)', pct(bp['album1_active']),
         pct(cp['album1_active']), 'met' if cp['album1_active'] >= 0.8 else 'not met'),
        ('Album 2 among spenders (all payers / active payers)', '%s / %s' % (pct(bp['album2_payers_all']), pct(bp['album2_payers_active'])),
         '%s / %s' % (pct(cp['album2_payers_all']), pct(cp['album2_payers_active'])), 'close to 10%'),
        ('Album 3 among spenders (all payers / active payers)', '%s / %s' % (pct(bp['album3_payers_all']), pct(bp['album3_payers_active'])),
         '%s / %s' % (pct(cp['album3_payers_all']), pct(cp['album3_payers_active'])), 'not reached - see the message'),
        ('ToF first five floors: net cumulative value (player who always continues)',
         ' / '.join('%.1f' % x['net'] for x in B['tofModel']['v2'][:5]),
         ' / '.join('%.1f' % x['net'] for x in E['tofModel']['v2'][:5]), 'milder, dip kept'),
    ]
    for t in rows:
        for i, v in enumerate(t):
            c = put(r, 1 + i * 3, v, wrap=True)
        ws.row_dimensions[r].height = 42
        r += 1
    r += 1
    # ---- per cell
    put(r, 1, 'PER SEGMENT x PAYER (before -> after)', bold=True); r += 1
    head = ['Cell', 'SPT from events (window)', 'Daily share median', 'Daily share min', 'SP tier reached (mean player)',
            'Day tier 10', 'Day tier 20', 'Day tier 30', 'Envelopes per player (gains model)', 'Envelopes opened (card sim)',
            'Album 1 (active)', 'Album 2', 'ToF envelopes (card sim)']
    for i, h in enumerate(head):
        c = put(r, 1 + i, h, bold=True, fill=HDR_FILL, wrap=True)
    ws.row_dimensions[r].height = 42
    r += 1
    def env_tot(src, cell, side):
        return sum(src['cells'][cell]['env'][side]['tot'].values())
    def day(arr, t):
        return str(arr[t - 1]) if len(arr) >= t else '-'
    for cell in CELLS:
        xb, xe = B['cells'][cell], E['cells'][cell]
        db = sorted(xb['daily']['measShare']); de = sorted(xe['daily']['simShare'])
        vals = [cell,
                '%s -> %s' % (pct(xb['spt']['meas']['share']), pct(xe['spt']['sim']['share'])),
                '%s -> %s' % (pct(db[len(db) // 2]), pct(de[len(de) // 2])),
                '%s -> %s' % (pct(db[0]), pct(de[0])),
                '%d -> %d' % (xb['sp']['measTier'], xe['sp']['simTier']),
                '%s -> %s' % (day(xb['sp']['measTierDay'], 10), day(xe['sp']['simTierDay'], 10)),
                '%s -> %s' % (day(xb['sp']['measTierDay'], 20), day(xe['sp']['simTierDay'], 20)),
                '%s -> %s' % (day(xb['sp']['measTierDay'], 30), day(xe['sp']['simTierDay'], 30)),
                '%.1f -> %.1f' % (env_tot(B, cell, 'meas'), env_tot(E, cell, 'sim')),
                '%.1f -> %.1f' % (B['cards'][cell]['packs'], E['cards'][cell]['packs']),
                '%s -> %s' % (pct(B['cards'][cell]['a1Q']), pct(E['cards'][cell]['a1Q'])),
                '%s -> %s' % (pct(B['cards'][cell]['a2All']), pct(E['cards'][cell]['a2All'])),
                '%.1f -> %.1f' % (B['cards'][cell]['bySource'].get('ToF', 0), E['cards'][cell]['bySource'].get('ToF', 0))]
        for i, v in enumerate(vals):
            put(r, 1 + i, v, fill=SIM_FILL if i else None)
        r += 1
    r += 1
    put(r, 1, '"Before" = the configs as in LIVE_OPS_V3 (8) on the same engine and calendar. SPT and envelope numbers are '
              'per player over the 28-day window. Day tier N = the day the segment\'s mean player reaches tier N (- = not '
              'reached). Album 2 per cell is among all players of the cell.', italic=True, wrap=True)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=13)
    ws.row_dimensions[r].height = 30
    r += 2
    put(r, 1, 'TABS', bold=True); r += 1
    for name in ORDER:
        if name in P['patches']:
            put(r, 1, name); put(r, 2, '%d cells changed' % len(P['patches'][name])); r += 1
    put(r, 1, 'RM local sim'); put(r, 2, 'every formula of the Player Reach Simulation block, all four RM sheets'); r += 1
    widths = [18, 22, 16, 14, 18, 11, 11, 11, 18, 18, 14, 12, 16]
    for i, w in enumerate(widths):
        ws.column_dimensions[L(i + 1)].width = w
    return ws


def changes_sheet(wb, P):
    ws = wb.create_sheet('Changes', 1)
    ws.sheet_view.showGridLines = False
    for i, h in enumerate(['Sheet', 'Cell', 'LIVE_OPS_V3 (8)', 'Proposed', 'What']):
        c = ws.cell(row=1, column=1 + i, value=h)
        c.font = Font(name=ARIAL, bold=True); c.fill = HDR_FILL
    r = 2
    for name in ORDER:
        for p in P['patches'].get(name, []):
            vals = [name, p['cell'], fmt(p['old']), fmt(p['new']), p.get('note', '')]
            for i, v in enumerate(vals):
                c = ws.cell(row=r, column=1 + i, value=v)
                c.font = Font(name=ARIAL, color=RED if i == 3 else None, bold=(i == 3))
            r += 1
    for k, w in zip('ABCDE', [16, 8, 16, 16, 40]):
        ws.column_dimensions[k].width = w
    ws.freeze_panes = 'A2'
    return ws


def rm_sheet(wb):
    ws = wb.create_sheet('RM local sim')
    ws.sheet_view.showGridLines = False
    ws.cell(row=1, column=1, value='Rainbow Maker - the local "Player Reach Simulation" block (AI1:AS13) on data_rm_pace').font = Font(name=ARIAL, bold=True, size=12)
    notes = ['One formula set serves all four sheets; only AJ4 (the config tag) differs. Paste each formula into the cell named '
             'on the same row of the sheet named in column A. The formulas are stored here as TEXT (a leading apostrophe) so '
             'this file does not try to evaluate them - remove nothing, Sheets drops the apostrophe on paste.',
             'Every data_rm_pace column is found by its header name, so a re-pull with moved or added columns needs no edit. '
             'Rows past EventDuration (B3) stay blank. Day d reads the measured event\'s date d; the last day of an event as '
             'long as the measured one reads the final date, which holds the closing hours (the D77 rule, unchanged).',
             'Ready for the re-pull asked for in PROMPT_ab_data_missing.md: when data_rm_pace carries rm_config, AJ4 picks the '
             'RM_1st or RM_2nd rows; per-instance rows are averaged; cum_matchables_p10 / p90 are read directly when present '
             '(today p90 is derived from the mean and p10 = 0.4 x p25). Until then every sheet reads the pooled rows.',
             'The count is milestones REACHED. The engine also applies a claim factor (claiming is manual); this view does not.']
    r = 2
    for n in notes:
        c = ws.cell(row=r, column=1, value=n); c.font = Font(name=ARIAL, italic=True); c.alignment = Alignment(wrap_text=True)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4); ws.row_dimensions[r].height = 45; r += 1
    r += 1
    for i, h in enumerate(['Sheet', 'Cell', 'Formula / value', 'What']):
        c = ws.cell(row=r, column=1 + i, value=h); c.font = Font(name=ARIAL, bold=True); c.fill = HDR_FILL
    r += 1
    for sheet in ['RM_1st', 'RM_2nd', 'RM_1st_v2', 'RM_2nd_v2']:
        for cell, f, what in rm_formulas(sheet):
            ws.cell(row=r, column=1, value=sheet).font = Font(name=ARIAL)
            ws.cell(row=r, column=2, value=cell).font = Font(name=ARIAL)
            c = ws.cell(row=r, column=3, value=("'" + f) if str(f).startswith('=') else f)
            c.font = Font(name='Consolas', size=9, color=RED if cell in ('AJ4', 'AI4', 'AI13') or cell.endswith('13') else None)
            ws.cell(row=r, column=4, value=what).font = Font(name=ARIAL, size=9)
            r += 1
    for k, w in zip('ABCD', [12, 7, 150, 60]):
        ws.column_dimensions[k].width = w
    ws.freeze_panes = ws.cell(row=8, column=1)
    return ws


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workbook', default=None)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    src_path = a.workbook or newest_workbook()
    P = json.load(open(PATCHES, encoding='utf-8'))
    E = json.load(open(EVAL, encoding='utf-8'))
    B = json.load(open(BASE, encoding='utf-8'))
    print('reading', src_path)
    src = openpyxl.load_workbook(src_path, data_only=True)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    summary_sheet(wb, P, E, B)
    changes_sheet(wb, P)
    for name in ORDER:
        if name not in P['patches']:
            continue
        ws = wb.create_sheet(name)
        copy_sheet(src[name], ws)
        for p in P['patches'][name]:
            c = ws[p['cell']]
            c.value = fmt(p['new'])
            red(c)
        # reasoning block, right of the sheet's own data (never over a used column)
        col = src[name].max_column + 2
        h = ws.cell(row=1, column=col, value='WHY THESE CHANGES (proposal 2026-10-30) - red cells are the proposed values')
        h.font = Font(name=ARIAL, bold=True, color='FF1F4E79', size=11)   # not red: red marks proposals only
        for i, line in enumerate(P['reasons'].get(name, [])):
            c = ws.cell(row=2 + i, column=col, value='- ' + line)
            c.font = Font(name=ARIAL, size=10)
            c.alignment = Alignment(wrap_text=True, vertical='top')
            c.fill = IN_FILL
            ws.row_dimensions[2 + i].height = max(ws.row_dimensions[2 + i].height or 15, 15 * (1 + len(line) // 95))
        ws.column_dimensions[L(col)].width = 110
    rm_sheet(wb)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)
    print('written', a.out, '-', len(wb.sheetnames), 'tabs:', ', '.join(wb.sheetnames))


if __name__ == '__main__':
    main()
