"""Builds display/HH_v2_LocalSim_v1.xlsx (2026-11-18): the Hatchling Hideaway redesign sheet HH_v2 configured PER SEGMENT,
copied cell for cell from the newest workbook that carries the block layout ('LiveOpsCal_NS_HH_segs' ...), with:

  A:Z        the user's blocks unchanged (label '0-9' ... '100+', the 0-9 header row only, 'Gate n' rows, Tiles in Y) plus
             a 'Cum tokens req' column (Z) in every block = the block's cumulative Tiles / accuracy (AV2) - the requirement
             the engine (D108) and the local sim read for that segment
  AU2:AV2    'accuracy' (tiles cleared per token) kept; the old SHARED helper AU4:AW9 (Gate | Tiles | Cum tokens req, one
             ladder for every segment) is dropped - nothing reads it once the blocks exist
  AI1:AS12   LOCAL SIM - gates reached and their rewards per event day for each segment, each on ITS OWN block
  AI15:AS..  GATE COMPLETION - one row per gate of every block: % of players reaching it today (base HH block) and with
             the redesign (this sheet's block, paced by the event duration), diff, and the numbers behind them
  AU15..     the explanation, with the formula

THE RULE (the engine's, D81 / D108)
  balance    a player's final token balance in one event: data_event_inst final_balance_p25 / p50 / p75 (Avg:
             avg_final_token_balance) for Hatchling Hideaway, the payer type (AJ3) and the segment ('100+' reads 100-249)
  by day d   tokens(d) = final balance x A(d) / A(L_old), A(d) = data_event_accrual cum_token_share_p50 at event_day d
             (1 past the last measured day), L_old = the event's length on the base sheet HH!B3 - the measured balance
             is the balance of an event that long
  S(x)       share of players whose balance reaches x: piecewise linear through (0,0), (p25,.25), (p50,.5), (p75,.75),
             past p75 at the p50->p75 slope, capped (survival_)
  reached    percentile q: gates whose Cum tokens req <= the q player's tokens(d); Avg: SUM S(req x A(L_old) / A(d))
  % old      S(req_old) on the base HH block (cumulative Tiles / accuracy)
  % new      S(req_new x A(L_old) / A(L_new)), L_new = Event duration (AJ4, default HH_v2!B3) - D81: a shorter event
             shrinks the tokens, not the rewards

    python builders/_build_hh_localsim.py [--workbook "workbooks/<file>.xlsx"] [--out display/HH_v2_LocalSim_v1.xlsx]
"""
import argparse, glob, os, sys
import openpyxl
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import column_index_from_string as CI, get_column_letter as L
from openpyxl.worksheet.datavalidation import DataValidation

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from _build_rm_sheets import copy_sheet

OUT = os.path.join(ROOT, 'display', 'HH_v2_LocalSim_v1.xlsx')
SEGS = ['0-9', '10-19', '20-39', '40-99', '100+']
GCOLS = ['AJ', 'AL', 'AN', 'AP', 'AR']                # gates column per segment; the reward column is the next one
DAY_ROWS = list(range(6, 13))
T_HDR, T_FIRST, T_ROWS = 15, 16, 40
NOTE_COL = 'AU'
CLEAR_FROM = CI('AI')
ARIAL = 'Arial'
IN_FILL = PatternFill('solid', fgColor='FFFFF2CC')
SIM_FILL = PatternFill('solid', fgColor='FFE2EFDA')
DATA_FILL = PatternFill('solid', fgColor='FFCFE2F3')
HDR_FILL = PatternFill('solid', fgColor='FFD9D9D9')
EI_H, EI_T = 'data_event_inst!$A$1:$Z$1', 'data_event_inst!$A$1:$Z$1000'
AC_H, AC_T = 'data_event_accrual!$A$1:$Z$1', 'data_event_accrual!$A$1:$Z$5000'
EV = 'Hatchling Hideaway'
REW_C0, REW_C1, TILES_C, CUM_C = 'B', 'W', 'Y', 'Z'


# ---------------------------------------------------------------------------------------------------------------
# formula template
# ---------------------------------------------------------------------------------------------------------------
def num_(x):
    """x as numbers, a text cell (the header row) as 0 - array-safe (N() is not, in Sheets)."""
    return 'IF(ISNUMBER({x}),{x},0)'.format(x=x)


def data_bindings():
    """data_event_inst (the balance percentiles) and data_event_accrual (the share by day) for seg_ / pay_."""
    ci = lambda n: 'INDEX(e_t,0,MATCH("%s",e_h,0))' % n
    ca = lambda n: 'INDEX(a_t,0,MATCH("%s",a_h,0))' % n
    return ('sd_,IF(seg_="100+","100-249",seg_),'
            'e_h,' + EI_H + ',e_t,' + EI_T + ','
            'e_ok,(' + ci('event_name') + '="' + EV + '")*(' + ci('payer_flag') + '=pay_)*(' + ci('segment') + '=sd_),'
            'q_25,SUMPRODUCT(e_ok,' + num_(ci('final_balance_p25')) + '),q_50,SUMPRODUCT(e_ok,' + num_(ci('final_balance_p50')) + '),'
            'q_75,SUMPRODUCT(e_ok,' + num_(ci('final_balance_p75')) + '),q_av,SUMPRODUCT(e_ok,' + num_(ci('avg_final_token_balance')) + '),'
            'a_h,' + AC_H + ',a_t,' + AC_T + ','
            'a_ok,(' + ca('event_name') + '="' + EV + '")*(' + ca('payer_flag') + '=pay_)*(' + ca('segment') + '=sd_),'
            'a_day,' + ca('event_day') + ',a_sh,' + ca('cum_token_share_p50') + ','
            'a_max,MAX(IF(a_ok,a_day,0)),')


def share(day_expr):
    """A(day): the mean cum_token_share_p50 of the rows at that event_day; 1 past the last measured day."""
    return ('IF({d}>=a_max,1,IFERROR(SUMPRODUCT(a_ok*(a_day={d}),IF(ISNUMBER(a_sh),a_sh,0))/SUMPRODUCT(a_ok*(a_day={d})),1))'
            .format(d='(' + day_expr + ')'))


def surv(x):
    """S(x) element-wise: 1 - CDF through (0,0), (q25,.25), (q50,.5), (q75,.75), the p50->p75 slope past q75, capped."""
    return ('(1-IF({x}<=0,0,IF({x}<=q_25,0.25*{x}/MAX(q_25,1E-9),IF({x}<=q_50,0.25+0.25*({x}-q_25)/MAX(q_50-q_25,1E-9),'
            'IF({x}<=q_75,0.5+0.25*({x}-q_50)/MAX(q_75-q_50,1E-9),IF(0.75+0.25*({x}-q_75)/MAX(q_75-q_50,1E-9)>1,1,'
            '0.75+0.25*({x}-q_75)/MAX(q_75-q_50,1E-9)))))))').format(x=x)


def block_bindings(prefix, sheet, seg_expr):
    """A segment's block on `sheet` ('' = this sheet): label row, first gate row, gate count, header row (own, else the
    sheet's first 'Gate number' row), cumulative tokens per gate (the 'Cum tokens' column of the header when there is
    one, else Tiles summed / accuracy)."""
    sh = (sheet + '!') if sheet else ''
    A = sh + '$A$1:$A$500'
    rng = lambda c: sh + '$' + c + '$1:$' + c + '$500'
    p = prefix
    return ('{p}lr,MATCH({s},{A},0),'
            '{p}fr,{p}lr+IFERROR(MATCH(1,(LEFT(INDEX({A},{p}lr+1):INDEX({A},{p}lr+3),5)="Gate ")'
            '*ISNUMBER(VALUE(MID(INDEX({A},{p}lr+1):INDEX({A},{p}lr+3),6,6))),0),1),'
            '{p}ng,IFERROR(MATCH(0,ISNUMBER(VALUE(MID(INDEX({A},{p}fr):INDEX({A},{p}fr+40),6,6)))*(LEFT(INDEX({A},{p}fr):INDEX({A},{p}fr+40),5)="Gate "),0)-1,0),'
            '{p}hr,IFERROR({p}lr+MATCH("Gate number",INDEX({A},{p}lr+1):INDEX({A},{p}fr),0),MATCH("Gate number",{A},0)),'
            '{p}hd,INDEX({ry},{p}hr):INDEX({rz},{p}hr),'
            '{p}cc,IFERROR(MATCH("Cum tokens*",{p}hd,0),0),'
            '{p}tl,INDEX({ry},{p}fr):INDEX({ry},{p}fr-1+MAX(1,{p}ng)),'
            '{p}rq,IF({p}cc>0,INDEX(INDEX({ry},{p}fr):INDEX({rz},{p}fr-1+MAX(1,{p}ng)),0,{p}cc),'
            'MMULT(--(SEQUENCE(MAX(1,{p}ng))>=TRANSPOSE(SEQUENCE(MAX(1,{p}ng)))),IF(ISNUMBER({p}tl),{p}tl,0))/acc_),'
            ).format(p=p, s=seg_expr, A=A, ry=rng(TILES_C), rz=rng('AH'))


def local_sim_formula(seg, r, reward):
    pre = ('=ARRAYFORMULA(IF($AI{r}="","",IFERROR(LET(seg_,"{s}",pay_,$AJ$3,pc_,$AJ$2,d_,$AI{r},acc_,$AV$2,lold_,$AM$3,'
           .format(r=r, s=seg) + block_bindings('n_', '', 'seg_') + data_bindings() +
           'aold_,' + share('lold_') + ',ad_,' + share('d_') + ',k_,aold_/MAX(ad_,1E-9),'
           'bq_,SWITCH(pc_,"p25",q_25,"p50",q_50,"p75",q_75,q_av),'
           'reached_,IF(n_ng<1,0,IF(pc_="Avg",SUM(' + surv('n_rq*k_') + '),SUM(--(n_rq<=bq_/k_+1E-9)))),')
    if not reward:
        return pre + 'IF(pc_="Avg",ROUND(reached_,2),reached_)),"no data")))'
    return (pre +
            'rb_,INDEX($' + REW_C0 + '$1:$' + REW_C0 + '$500,n_fr):INDEX($' + REW_C1 + '$1:$' + REW_C1 + '$500,n_fr-1+MAX(1,n_ng)),'
            'hd_,INDEX($' + REW_C0 + '$1:$' + REW_C0 + '$500,n_hr):INDEX($' + REW_C1 + '$1:$' + REW_C1 + '$500,n_hr),'
            'wv_,IF(pc_="Avg",' + surv('n_rq*k_') + ',--(n_rq<=bq_/k_+1E-9)),'
            's_,MMULT(TRANSPOSE(wv_),IF(ISNUMBER(rb_),rb_,0)),'
            'IF(SUM(wv_)=0,"{}","{"&TEXTJOIN(", ",TRUE,IF((s_>0.004)*(hd_<>""),hd_&": "&ROUND(s_,2),""))&"}")),"no data")))')


def table_formulas(r):
    """Row r = the i-th gate row of this sheet (counted from the rows above, so an inserted row costs no gate)."""
    row_ = '$AS{r}'.format(r=r)
    head = '=IF({row}="","",'.format(row=row_)
    A = '$A$1:$A$500'
    lets = ('LET(seg_,$AI{r},pay_,$AJ$3,acc_,$AV$2,lold_,$AM$3,lnew_,$AJ$4,'.format(r=r))
    f = {}
    f['AS'] = ('=IFERROR(INDEX(FILTER(ROW({a}),(LEFT({a},5)="Gate ")*ISNUMBER(VALUE(MID({a},6,6)))),COUNT($AJ${h}:AJ{p})+1),"")'
               .format(a=A, h=T_HDR, p=r - 1))
    rng = '$A$1:INDEX({a},{row})'.format(a=A, row=row_)
    f['AI'] = (head + 'ARRAYFORMULA(LOOKUP(2,1/(ISTEXT({rng})*(LEFT({rng},4)<>"Gate")*(ROW({rng})>IFERROR(MATCH("Goals and Rewards",{a},0),9))),{rng})))'
               .format(rng=rng, a=A))
    f['AJ'] = head + 'VALUE(MID(INDEX({a},{row}),6,6)))'.format(a=A, row=row_)
    # the requirement of gate k on each side: the k-th entry of that side's block (old: the base sheet HH)
    req_new = lets + block_bindings('n_', '', 'seg_') + 'IF($AJ{r}>n_ng,"",INDEX(n_rq,$AJ{r},1)))'.format(r=r)
    req_old = lets + block_bindings('o_', 'HH', 'seg_') + 'IF($AJ{r}>o_ng,"",INDEX(o_rq,$AJ{r},1)))'.format(r=r)
    f['AO'] = head + 'IFERROR(ARRAYFORMULA(' + req_new + '),""))'
    f['AN'] = head + 'IFERROR(ARRAYFORMULA(' + req_old + '),""))'
    pace = lets + data_bindings() + 'aold_,' + share('lold_') + ',anew_,' + share('lnew_') + ',aold_/MAX(anew_,1E-9))'
    f['AP'] = head + 'IFERROR(ARRAYFORMULA(' + pace + '),1))'
    pct = lambda x: lets + data_bindings() + surv(x) + ')'
    f['AK'] = head + 'IF($AN{r}="",0,IFERROR(ARRAYFORMULA('.format(r=r) + pct('$AN{r}'.format(r=r)) + '),"no data")))'
    f['AL'] = head + 'IF($AO{r}="",0,IFERROR(ARRAYFORMULA('.format(r=r) + pct('$AO{r}*$AP{r}'.format(r=r)) + '),"no data")))'
    f['AM'] = head + 'IFERROR(($AL{r}-$AK{r})*100,""))'.format(r=r)
    f['AQ'] = (head + 'IF($AN{r}="","new gate (old = 0)",IF(ABS($AN{r}-$AO{r})<1E-9,"requirement unchanged",'
               '"requirement "&ROUND($AN{r},1)&" -> "&ROUND($AO{r},1)))&IF(ABS($AP{r}-1)>1E-9,", tokens x "&ROUND(1/$AP{r},3)&" (duration)",""))'
               ).format(r=r)
    return f


# ---------------------------------------------------------------------------------------------------------------
NOTES = [
    ('THE INPUTS (yellow cells)', 'b'),
    ('Percentile (AJ2) - which player the top block follows: p25 / p50 / p75 = the player with that final token balance '
     '(data_event_inst final_balance_p25 / p50 / p75 of the segment and payer type); a gate counts once that player\'s '
     'tokens reach its requirement. Avg = no single player: the EXPECTED number of gates (and rewards) per player, '
     'SUM over gates of the share of players who reach it.', ''),
    ('Payer (AJ3) - NONPAYER or PAYER: whose balances and accrual pace are read. The table below follows it too.', ''),
    ('Event duration (AJ4) - days of the redesigned event (default = this sheet\'s EventDuration, B3). Rows 6..12 show '
     'day 1..7 up to it.', ''),
    ('Old event duration (AM3) - days of the event the balances were measured on (default = HH!B3). A redesigned event '
     'shorter than that gives the players fewer tokens (the share of tokens earned by that day), not smaller rewards - '
     'the engine\'s rule (D81).', ''),
    ('accuracy (AV2) - tiles cleared per token: a gate\'s token requirement = its cumulative Tiles / accuracy (column Z, '
     'per block). The base sheet HH has no accuracy cell and reads this one.', ''),
    ('', ''),
    ('HOW THE GATES ARE PRICED', 'b'),
    ('Every segment has its own block on HH_v2 (and on HH): label in column A, the gates below it, rewards in B:W, Tiles '
     'in Y, the requirement in Z. A block reads its own header row when it has one, else the sheet\'s first ("Gate '
     'number" row) - the columns are shared. 250+ plays the 100+ block; ALL is the segments pooled.', ''),
    ('Tokens by day d = final balance x A(d) / A(L_old). A(d) = data_event_accrual cum_token_share_p50 at event_day d '
     '(the median player\'s share of the event\'s tokens earned by then; 1 past the last measured day). L_old = the old '
     'duration (AM3).', ''),
    ('S(x) = share of players whose final balance reaches x: linear through (0, 0%), (p25, 25%), (p50, 50%), (p75, 75%) '
     'of the balance distribution, past p75 on the p50 -> p75 slope until everyone is counted. The engine prices every '
     'collection on this curve (survival_).', ''),
    ('THE FORMULAS', 'b'),
    ('% reaching (old)_k = S( req_old_k )                      req_old = HH block, cum Tiles / accuracy', 'f'),
    ('% reaching (new)_k = S( req_new_k x A(L_old) / A(L_new) )  req_new = this block (column Z)', 'f'),
    ('Local sim, day d:  p25/p50/p75: gates with  req_k <= balance_q x A(d) / A(L_old)', 'f'),
    ('                   Avg:         SUM_k S( req_k x A(L_old) / A(d) )   (rewards: SUM_k S(.) x reward_k)', 'f'),
    ('   diff (pp) = ( % new - % old ) x 100;  "Pace" (AP) = A(L_old) / A(L_new) - 1 when the duration is unchanged', 'f'),
    ('What the engine does with it: the Hatchling row = measured x E_new / E_old x calendar timing, E = SUM_k % reaching_k '
     'x reward_k per segment - so this table\'s % columns, times each gate\'s rewards, are exactly the two E the engine '
     'prices (change_summary, EcoGainsSim and Sim per Segment follow after Fill change summary / Fill all sims).', ''),
    ('FLAGS', 'b'),
    ('- The balance distribution is measured on the event that ran (its ladder, its duration). A requirement change moves '
     'who reaches a gate along that distribution; it does not model players playing more because a gate is closer.', ''),
    ('- The engine takes the durations from the CALENDARS (cal_curr / cal_new); this sheet takes them from AM3 / AJ4. '
     'Keep them in line to compare.', ''),
    ('- data_event_inst has no 250+ / ALL block here: 250+ players are priced on their own balances against the 100+ block '
     'in the engine; the table shows the five authored blocks.', ''),
]


# ---------------------------------------------------------------------------------------------------------------
# emulation (same rule, cached data) - the check printed after the build
# ---------------------------------------------------------------------------------------------------------------
def rows_of(wb, name):
    return [list(r) for r in wb[name].iter_rows(values_only=True)]


def emu_block(rows, seg, acc):
    col_a = [str(r[0]).strip() if r and r[0] is not None else '' for r in rows]
    lr = col_a.index(seg)
    fr = next(q for q in range(lr + 1, lr + 4) if col_a[q].startswith('Gate ') and col_a[q][5:].strip().isdigit())
    own = [q for q in range(lr + 1, fr) if col_a[q] == 'Gate number']
    hr = own[0] if own else col_a.index('Gate number')
    hdr = rows[hr]
    yc, zc = CI(TILES_C) - 1, CI(CUM_C) - 1
    out, cum = [], 0
    q = fr
    while q < len(rows) and col_a[q].startswith('Gate ') and col_a[q][5:].strip().isdigit():
        r = rows[q]
        cum += float(r[yc] or 0)
        rq = float(r[zc]) if (len(hdr) > zc and str(hdr[zc] or '').startswith('Cum tokens') and isinstance(r[zc], (int, float))) else cum / acc
        rew = {str(hdr[c]).strip(): r[c] for c in range(CI(REW_C0) - 1, CI(REW_C1)) if hdr[c] and isinstance(r[c], (int, float)) and r[c]}
        out.append((rq, rew))
        q += 1
    return out


def emu_data(vals, seg, pay):
    ei = rows_of(vals, 'data_event_inst'); h = {str(x): i for i, x in enumerate(ei[0]) if x is not None}
    sd = '100-249' if seg == '100+' else seg
    row = next(r for r in ei[1:] if r and r[h['event_name']] == EV and r[h['payer_flag']] == pay and r[h['segment']] == sd)
    q = {k: float(row[h['final_balance_' + k]]) for k in ('p25', 'p50', 'p75')}
    q['Avg'] = float(row[h['avg_final_token_balance']])
    ac = rows_of(vals, 'data_event_accrual'); ha = {str(x): i for i, x in enumerate(ac[0]) if x is not None}
    by = {}
    for r in ac[1:]:
        if r and r[ha['event_name']] == EV and r[ha['payer_flag']] == pay and r[ha['segment']] == sd:
            by.setdefault(int(r[ha['event_day']]), []).append(float(r[ha['cum_token_share_p50']]))
    mx = max(by)
    A = lambda d: 1.0 if d >= mx else (sum(by[d]) / len(by[d]) if d in by else 1.0)

    def S(x):
        p25, p50, p75 = q['p25'], q['p50'], q['p75']
        if x <= 0: c = 0
        elif x <= p25: c = 0.25 * x / max(p25, 1e-9)
        elif x <= p50: c = 0.25 + 0.25 * (x - p25) / max(p50 - p25, 1e-9)
        elif x <= p75: c = 0.5 + 0.25 * (x - p50) / max(p75 - p50, 1e-9)
        else: c = min(1, 0.75 + 0.25 * (x - p75) / max(p75 - p50, 1e-9))
        return 1 - c
    return q, A, S


def emulate(vals, sheet_rows, pay='NONPAYER', pct='p50', l_new=None):
    v2, base = sheet_rows['HH_v2'], sheet_rows['HH']
    acc = next(float(r[CI('AV') - 1]) for r in v2 if r and len(r) > CI('AV') - 1 and str(r[CI('AU') - 1] or '').strip() == 'accuracy')
    l_old, l_new = float(base[2][1]), float(l_new or v2[2][1])
    table, sim = [], {}
    for seg in SEGS:
        q, A, S = emu_data(vals, seg, pay)
        bn, bo = emu_block(v2, seg, acc), emu_block(base, seg, acc)
        pace = A(l_old) / max(A(l_new), 1e-9)
        for k, (rq, _) in enumerate(bn, 1):
            ro = bo[k - 1][0] if k <= len(bo) else None
            table.append((seg, k, S(ro) if ro is not None else 0.0, S(rq * pace), ro, rq))
        per = []
        for d in range(1, int(l_new) + 1):
            kk = A(l_old) / max(A(d), 1e-9)
            w = [S(rq * kk) for rq, _ in bn] if pct == 'Avg' else [1 if rq <= q[pct] / kk + 1e-9 else 0 for rq, _ in bn]
            rew = {}
            for wi, (_, rw) in zip(w, bn):
                for kname, val in rw.items():
                    rew[kname] = rew.get(kname, 0) + wi * val
            per.append((round(sum(w), 2), {k2: round(v, 2) for k2, v in rew.items() if v > 0.004}))
        sim[seg] = per
    return table, sim


# ---------------------------------------------------------------------------------------------------------------
def newest_workbook():
    best = None
    for p in glob.glob(os.path.join(ROOT, 'workbooks', '*.xlsx')):
        if 'HH' in os.path.basename(p) and (best is None or os.path.getmtime(p) > os.path.getmtime(best)):
            best = p
    return best


def style(c, kind):
    c.font = Font(name=ARIAL, bold=kind in ('title', 'header'), size=11 if kind == 'title' else 10, italic=kind == 'note')
    if kind == 'input':
        c.fill = IN_FILL
    elif kind in ('sim', 'simpct', 'pp', 'num'):
        c.fill = SIM_FILL
    elif kind in ('data', 'datapct'):
        c.fill = DATA_FILL
    elif kind == 'header':
        c.fill = HDR_FILL
        c.alignment = Alignment(wrap_text=True, vertical='center')
    if kind in ('simpct', 'datapct'):
        c.number_format = '0.00%'
    if kind == 'pp':
        c.number_format = '+0.00"pp";-0.00"pp";0.00"pp"'
    if kind in ('num', 'data'):
        c.number_format = '0.00'


def add_cum_column(ws):
    """'Cum tokens req' (Z) in every block: the first header row gets the label, each gate row its block's cumulative
    Tiles / accuracy."""
    col_a = {r: str(ws.cell(row=r, column=1).value or '').strip() for r in range(1, ws.max_row + 1)}
    hdr_rows = [r for r, a in col_a.items() if a == 'Gate number']
    for r in hdr_rows:
        c = ws[CUM_C + str(r)]
        c.value = 'Cum tokens req'
        c.font = Font(name=ARIAL, bold=True, size=10)
    is_gate = lambda a: a.startswith('Gate ') and a[5:].strip().isdigit()
    first = None
    n = 0
    for r in range(1, ws.max_row + 1):
        if is_gate(col_a[r]):
            if first is None:
                first = r
            c = ws[CUM_C + str(r)]
            c.value = '=SUM(${y}${f}:{y}{r})/$AV$2'.format(y=TILES_C, f=first, r=r)
            c.font = Font(name=ARIAL, size=10)
            c.fill = SIM_FILL
            n += 1
        else:
            first = None
    return n, hdr_rows


def write_blocks(ws, acc, l_old_default):
    put = lambda cell, val, kind: (ws.__setitem__(cell, val), style(ws[cell], kind))
    put('AU2', 'accuracy', 'label'); put('AV2', acc, 'input')
    put('AI1', 'LOCAL SIM - how far players get in Hatchling Hideaway (each segment on its own block)', 'title')
    put('AI2', 'Percentile', 'label'); put('AJ2', 'p50', 'input')
    put('AI3', 'Payer', 'label'); put('AJ3', 'NONPAYER', 'input')
    put('AI4', 'Event duration (days)', 'label'); put('AJ4', '=$B$3', 'input')
    put('AL3', 'Old event duration (days)', 'label'); put('AM3', l_old_default, 'input')
    put('AL2', 'Gates reached by the end of each day by the AJ2 player (Avg = expected gates) and what they pay', 'note')
    put('AL4', 'Inputs and formulas explained at ' + NOTE_COL + str(T_HDR), 'note')
    put('AI5', 'Day_of_event', 'header')
    for seg, c in zip(SEGS, GCOLS):
        put(c + '5', seg + '_gates', 'header')
        put(L(CI(c) + 1) + '5', seg + '_reward', 'header')
    for i, r in enumerate(DAY_ROWS):
        put('AI%d' % r, '=IF(%d<=$AJ$4,%d,"")' % (i + 1, i + 1), 'sim')
        for seg, c in zip(SEGS, GCOLS):
            put('%s%d' % (c, r), local_sim_formula(seg, r, False), 'sim')
            put('%s%d' % (L(CI(c) + 1), r), local_sim_formula(seg, r, True), 'sim')
    for cell, opts in (('AJ2', '"Avg,p25,p50,p75"'), ('AJ3', '"NONPAYER,PAYER"')):
        dv = DataValidation(type='list', formula1=opts, allow_blank=False)
        ws.add_data_validation(dv); dv.add(cell)

    heads = [('AI', 'Segment'), ('AJ', 'Gate #'), ('AK', '% reaching (old)'), ('AL', '% reaching (new)'), ('AM', 'diff'),
             ('AN', 'Cum tokens req (old)'), ('AO', 'Cum tokens req (new)'), ('AP', 'Pace'), ('AQ', 'How it is priced'),
             ('AS', 'Sheet row')]
    tips = {'AK': 'S(requirement on the base HH block): share of players whose final token balance reaches it '
                  '(data_event_inst p25/p50/p75). 0 = the old block had no such gate.',
            'AL': 'S(requirement on this block x Pace).', 'AM': '(new - old) x 100, percentage points.',
            'AP': 'A(old duration) / A(new duration): token share by the end of the event (data_event_accrual). 1 = same length.'}
    for col, txt in heads:
        put('%s%d' % (col, T_HDR), txt, 'header')
        if col in tips:
            ws['%s%d' % (col, T_HDR)].comment = Comment(tips[col], 'HH local sim')
    kinds = {'AI': 'sim', 'AJ': 'sim', 'AK': 'datapct', 'AL': 'simpct', 'AM': 'pp', 'AN': 'data', 'AO': 'num', 'AP': 'num',
             'AQ': 'sim', 'AS': 'sim'}
    for r in range(T_FIRST, T_FIRST + T_ROWS):
        for col, f in table_formulas(r).items():
            put('%s%d' % (col, r), f, kinds[col])
        ws['AS%d' % r].font = Font(name=ARIAL, size=9, color='FF808080')
    rng = 'AM%d:AM%d' % (T_FIRST, T_FIRST + T_ROWS - 1)
    ws.conditional_formatting.add(rng, CellIsRule(operator='greaterThan', formula=['0.0049'], font=Font(name=ARIAL, color='FF006100')))
    ws.conditional_formatting.add(rng, CellIsRule(operator='lessThan', formula=['-0.0049'], font=Font(name=ARIAL, color='FF9C0006')))
    for i, (txt, k) in enumerate(NOTES):
        c = ws['%s%d' % (NOTE_COL, T_HDR + i)]
        c.value = txt
        c.font = Font(name='Consolas' if k == 'f' else ARIAL, size=10, bold=(k == 'b'))
        c.alignment = Alignment(wrap_text=(k != 'f'), vertical='top')
    widths = {'AI': 16, 'AJ': 10, 'AK': 13, 'AL': 13, 'AM': 12, 'AN': 13, 'AO': 13, 'AP': 9, 'AQ': 34, 'AS': 9, 'AT': 3, NOTE_COL: 120}
    for c in GCOLS:
        widths[L(CI(c) + 1)] = max(widths.get(L(CI(c) + 1), 0), 30)
    for k, w in widths.items():
        ws.column_dimensions[k].width = w


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workbook', default=None)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    src_path = a.workbook or newest_workbook()
    print('reading', os.path.basename(src_path))
    src = openpyxl.load_workbook(src_path, data_only=False)
    vals = openpyxl.load_workbook(src_path, data_only=True, read_only=True)
    s2 = src['HH_v2']
    acc = s2['AV2'].value if isinstance(s2['AV2'].value, (int, float)) else 0.8
    dropped = [c.coordinate for row in s2.iter_rows() for c in row if c.column >= CLEAR_FROM and c.value not in (None, '')]
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet('HH_v2')
    copy_sheet(s2, ws, skip=lambda r, c: c >= CLEAR_FROM)
    n, hdrs = add_cum_column(ws)
    write_blocks(ws, acc, '=HH!$B$3')
    print('HH_v2: copied A:AH, %d gate rows got a Cum tokens req (Z) formula, header rows %s; rewrote AI onwards '
          '(%d old cells replaced, the shared AU4:AW9 helper dropped); accuracy %s' % (n, hdrs, len(dropped), acc))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)
    print('written', a.out)
    lens = [len(local_sim_formula('100+', 6, True)), max(len(f) for f in table_formulas(16).values())]
    print('longest formulas: local sim reward %d chars, table %d chars' % tuple(lens))

    rows = {nm: rows_of(vals, nm) for nm in ('HH', 'HH_v2')}
    for pay in ('NONPAYER', 'PAYER'):
        table, _ = emulate(vals, rows, pay)
        print('\n== Gate completion, %s (durations old %s / new %s)' % (pay, rows['HH'][2][1], rows['HH_v2'][2][1]))
        print('  seg     gate  old      new      diff(pp)  req old -> new')
        for seg, k, o, nw, ro, rq in table:
            print('  %-7s %2d  %6.2f%%  %6.2f%%  %+7.2f   %s -> %.1f' % (seg, k, 100 * o, 100 * nw, 100 * (nw - o), '-' if ro is None else '%.1f' % ro, rq))
    for pct in ('p50', 'Avg'):
        _, sim = emulate(vals, rows, 'NONPAYER', pct)
        print('\n  local sim NONPAYER %s, gates by day: ' % pct + ' | '.join('%s %s' % (s, '/'.join(str(x[0]) for x in sim[s])) for s in SEGS))
        print('  last day rewards: ' + ' | '.join('%s %s' % (s, sim[s][-1][1]) for s in SEGS))


if __name__ == '__main__':
    main()
