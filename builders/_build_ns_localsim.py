"""Builds display/NS_v2_LocalSim_v1.xlsx (2026-11-18): the two Night Sky REDESIGN sheets - NS_v2_weekday and NS_v2
(weekend) - copied cell for cell from the newest 'LiveOps_cal_NS_completions_increase' workbook, with two blocks
added to the right of the ladder (nothing in A:AD changes, so the engine reads them exactly as before):

  AI1:AS12   LOCAL SIM - 'how far players get': for each day of the event (Event duration, AJ4) and each segment,
             the rounds a player at the chosen percentile has completed and what those rounds pay. Avg = the
             expected number of rounds and the expected rewards per Night-Sky-active player-day.
  AI15:AS..  ROUND COMPLETION - one row per round of every segment (the round list is read from column A, so a
             segment with 3 rounds and one with 10 both list correctly, and adding / removing rounds needs no
             edit): Round % (old) = measured, Round % (new) = simulated, diff in pp, plus the columns the
             simulation is built from. The explanation (with the formula) sits next to it from AU15.

THE RULE (user decisions 2026-11-18)
  old_k   = data_ns_reach claim_rate_active of (ladder segment, round k): claimed / NS-active player-days. 0 when the
            old ladder had no round k.
  S(x)    = data_ns_progress: the share of NS-active player-days whose streak progress reached x, pooled over payers
            (and over 100-249 + 250+ for the 100+ ladder) by player_days. Points (0, 1), (1, 1 - share_zero), every
            share_ge_X; linear between them; past the last point the slope extended log-linearly (the engine's D106
            curve).
  c(x)    = the claim factor: c_j = old_j / S(O_j) at every OLD round requirement O_j, linear in x between them,
            flat outside them. It absorbs what S does not see (reached-but-not-claimed, and the ladder segments of
            data_ns_reach counting more player-days than the player segments of data_ns_progress).
  new_k   = MIN(1, c(X_k / D) x S(X_k / D))   X_k = the round's Cum Streak Req on this sheet, D = event duration.
            D = 1 and X_k = O_k gives the measured rate exactly. D > 1: progress CARRIES OVER between days (user)
            and a player keeps their daily pace, so reaching X in D days = reaching X / D in one.
  local sim: a player at percentile q has completed round k by day d when new_k(d) >= 1 - q (counting from round 1
            up to the first round that fails); Avg = SUM new_k(d) rounds and SUM new_k(d) x reward_k.

This is NOT the engine's D106 rule for new rounds (it prices a round the base does not have at the raw S(X), which
runs ~2x the claims from 10-19 up and makes 40-99 round 4 more likely than round 3). The change summary's Night Sky
row therefore differs from this table on the changed 40-99 / 100+ rounds - flagged in the notes block.

Formulas are generated from ONE template (curve_bindings / s_expr / reach_bindings) and emulated by emulate() on the
workbook's cached data, printed as the check table. No LAMBDA / BYROW, so the xlsx import keeps them.

    python builders/_build_ns_localsim.py [--workbook "workbooks/<file>.xlsx"] [--out display/NS_v2_LocalSim_v1.xlsx]
"""
import argparse, glob, math, os, sys
import openpyxl
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import column_index_from_string as CI
from openpyxl.worksheet.datavalidation import DataValidation

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from _build_rm_sheets import copy_sheet             # the cell-for-cell copy (values, formulas, styles, CF, DV)

OUT = os.path.join(ROOT, 'display', 'NS_v2_LocalSim_v1.xlsx')
SHEETS = ['NS_v2_weekday', 'NS_v2']
SEGS = ['0-9', '10-19', '20-39', '40-99', '100+']
RND_COLS = ['AJ', 'AL', 'AN', 'AP', 'AR']           # rounds column per segment; the reward column is the next one
DAY_ROWS = list(range(6, 13))                         # 7 day rows, shown while day <= AJ4
T_HDR, T_FIRST, T_ROWS = 15, 16, 60                   # the completion table: header row, first row, rows allocated
NOTE_COL = 'AU'
CLEAR_FROM = CI('AI')                                 # everything from AI right is rewritten (the user's draft block)
ARIAL = 'Arial'
IN_FILL = PatternFill('solid', fgColor='FFFFF2CC')
SIM_FILL = PatternFill('solid', fgColor='FFE2EFDA')
DATA_FILL = PatternFill('solid', fgColor='FFCFE2F3')
HDR_FILL = PatternFill('solid', fgColor='FFD9D9D9')

PG_H, PG_T = 'data_ns_progress!$A$1:$BZ$1', 'data_ns_progress!$A$1:$BZ$400'
RC_H, RC_T = 'data_ns_reach!$A$1:$BZ$1', 'data_ns_reach!$A$1:$BZ$400'
COL_A, COL_E = '$A$1:$A$500', '$E$1:$E$500'


# ---------------------------------------------------------------------------------------------------------------
# formula template
# ---------------------------------------------------------------------------------------------------------------
def progress_bindings():
    """data_ns_progress, filtered to the segment / arm / day type / config block: shared by every curve."""
    col = lambda n: 'INDEX(g_t,0,MATCH("%s",g_h,0))' % n
    has = lambda n: 'ISNUMBER(MATCH("%s",g_h,0))' % n
    return ('g_h,' + PG_H + ',g_t,' + PG_T + ','
            'g_seg,' + col('segment') + ',g_pay,' + col('payer_flag') + ',g_pd,' + col('player_days') + ','
            'g_arm,IFERROR(' + col('ab_variant') + ',""),g_dt,IFERROR(' + col('day_type') + ',""),'
            'g_cfg,IFERROR(' + col('config_segment') + ',""),'
            'g_sok,(g_seg=seg_)+(seg_="100+")*((g_seg="100-249")+(g_seg="250+")),'
            'g_aok,IF(' + has('ab_variant') + ',IF(LEN(arm_)=0,1,LEFT(g_arm&"",LEN(arm_))=arm_),1),'
            'g_dall,(g_dt="all")+(g_dt=""),'
            'g_dok,IF(' + has('day_type') + ',IF(SUM(g_sok*g_dall)>0,g_dall,1),1),'
            'g_cok,IF(' + has('config_segment') + ',IF(SUM(g_sok*(g_cfg=seg_))>0,g_cfg=seg_,(g_cfg="ALL")+(g_cfg="")),1),'
            'g_w0,IF(ISNUMBER(g_pd),g_pd,0)*g_sok*g_aok*g_dok*g_cok,'
            'g_ge,LEFT(g_h,9)="share_ge_",'
            'g_xs,FILTER(IFERROR(VALUE(MID(g_h,10,12)),0),g_ge),'
            'g_sh,FILTER(g_t,g_ge),g_shn,IF(ISNUMBER(g_sh),g_sh,0),'
            'g_hz,' + has('share_zero') + ',g_zc,IFERROR(' + col('share_zero') + ',0),g_zn,IF(ISNUMBER(g_zc),g_zc,0),'
            'g_n,COLUMNS(g_xs),g_sq,SEQUENCE(1,g_n),'
            'g_xlo,FILTER(g_xs,g_sq<g_n),g_xhi,FILTER(g_xs,g_sq>1),g_dx,g_xhi-g_xlo,'
            'g_x1,INDEX(g_xs,1,1),g_xn,INDEX(g_xs,1,g_n),')


def curve_bindings(t, payer_expr):
    """One pooled curve (tag t) for a payer filter: its shares at every share_ge_X, the piece slopes, the tail."""
    return ('{t}_w,g_w0*IF({p}="ALL",1,g_pay={p}),{t}_wt,SUM({t}_w),'
            '{t}_ss,MMULT(TRANSPOSE({t}_w),g_shn)/{t}_wt,'
            '{t}_z,SUM({t}_w*g_zn)/{t}_wt,'
            '{t}_sf,INDEX({t}_ss,1,1),{t}_sn,INDEX({t}_ss,1,g_n),'
            '{t}_s1,IF(g_hz,1-{t}_z,1-(1-{t}_sf)/g_x1),'
            '{t}_sl,(FILTER({t}_ss,g_sq>1)-FILTER({t}_ss,g_sq<g_n))/g_dx,'
            '{t}_kp,SUM(--({t}_ss>{t}_sn+1E-12)),'
            '{t}_lam,IF(AND({t}_sn>0,{t}_kp>0),LN(INDEX({t}_ss,1,MAX(1,{t}_kp))/{t}_sn)/(g_xn-INDEX(g_xs,1,MAX(1,{t}_kp))),0),'
            ).format(t=t, p=payer_expr)


def s_expr(t, u):
    """S(u) element-wise for a column (or a single value) u, on curve t: (0,1) -> (1, s1) -> share_ge points, linear,
    the last point's slope extended log-linearly past it (0 when the last share is 0)."""
    clamp = 'IF({u}-g_xlo<0,0,IF({u}-g_xlo>g_dx,g_dx,{u}-g_xlo))'.format(u=u)
    return ('IF({u}<=0,1,IF({u}>g_xn,IF({t}_sn>0,{t}_sn*EXP(-{t}_lam*({u}-g_xn)),0),'
            '1-(1-{t}_s1)*IF({u}>1,1,{u})+IF({u}>1,({t}_sf-{t}_s1)/(g_x1-1)*IF({u}>g_x1,g_x1-1,{u}-1),0)'
            '+MMULT(' + clamp + ',TRANSPOSE({t}_sl))))').format(t=t, u=u)


def reach_bindings():
    """data_ns_reach for the segment's ladder: the OLD rounds' requirements o_v and measured rates o_m (column
    vectors, in round order), the claim factor c_j = o_m / S_all(o_v), and the interpolation pieces."""
    col = lambda n: 'INDEX(r_t,0,MATCH("%s",r_h,0))' % n
    return ('r_h,' + RC_H + ',r_t,' + RC_T + ','
            'r_lad,' + col('ladder') + ',r_rd,' + col('round') + ',r_req,' + col('cum_req') + ','
            'r_m,' + col('claim_rate_active') + ',r_arm,IFERROR(' + col('config_arm') + ',""),'
            'r_aok,IF(ISNUMBER(MATCH("config_arm",r_h,0)),IF(LEN(arm_)=0,1,LEFT(r_arm&"",LEN(arm_))=arm_),1),'
            'r_ok,((r_lad=seg_)+(seg_="100+")*(r_lad="100-249"))*r_aok*ISNUMBER(r_m)*ISNUMBER(r_req),'
            'o_k,SUM(r_ok),o_v,IFERROR(FILTER(r_req,r_ok),1),o_m,IFERROR(FILTER(r_m,r_ok),1),'
            'o_c,IFERROR(o_m/' + s_expr('al', 'o_v') + ',1),'
            'o_q,SEQUENCE(MAX(1,o_k)),'
            'o_lo,IFERROR(TRANSPOSE(FILTER(o_v,o_q<o_k)),0),o_dx,IFERROR(TRANSPOSE(FILTER(o_v,o_q>1))-o_lo,1),'
            'o_sl,IFERROR((TRANSPOSE(FILTER(o_c,o_q>1))-TRANSPOSE(FILTER(o_c,o_q<o_k)))/o_dx,0),')


def c_expr(u):
    """c(u): flat at c_1 below the first old requirement, linear between them, flat at c_last past the last one;
    1 (the raw curve) when data_ns_reach has nothing for the segment."""
    return ('IF(o_k=0,1,INDEX(o_c,1,1)+IF(o_k<2,0,MMULT(IF({u}-o_lo<0,0,IF({u}-o_lo>o_dx,o_dx,{u}-o_lo)),'
            'TRANSPOSE(o_sl))))').format(u=u)


def ladder_bindings(seg):
    """The segment's block on THIS sheet: label row lr_ in column A, rounds from lr_+2 down to the first non-number
    (the engine's strict rule), their Cum Streak Req (v_), rewards (rb_, F:AC) and reward headers (hd_)."""
    return ('seg_,"{s}",lr_,MATCH(seg_,{a},0),'
            'nr_,IFERROR(MATCH(TRUE,NOT(ISNUMBER(INDEX({a},lr_+2):INDEX({a},lr_+61))),0)-1,60),'
            'v_,INDEX({e},lr_+2):INDEX({e},lr_+1+MAX(1,nr_)),').format(s=seg, a=COL_A, e=COL_E)


def local_sim_formula(seg, r, reward):
    """AJ6.. (rounds) / AK6.. (rewards) for one segment and day row r."""
    pre = ('=ARRAYFORMULA(IF($AI{r}="","",IFERROR(LET('.format(r=r) + ladder_bindings(seg) +
           'pay_,$AJ$3,arm_,$AM$2,d_,$AI{r},pc_,$AJ$2,'.format(r=r) +
           progress_bindings() + curve_bindings('al', '"ALL"') + curve_bindings('py', 'pay_') + reach_bindings() +
           'u_v,v_/d_,'
           'p0_,' + c_expr('u_v') + '*' + s_expr('py', 'u_v') + ',p_,IF(p0_>1,1,IF(p0_<0,0,p0_)),'
           'q_,SWITCH(pc_,"p10",0.1,"p25",0.25,"p50",0.5,"p75",0.75,"p90",0.9,"p95",0.95,"p99",0.99,0.5),'
           'n_r,IF(nr_<1,0,IF(pc_="Avg",SUM(p_),IFERROR(MATCH(TRUE,p_<1-q_,0)-1,nr_))),')
    if not reward:
        return pre + 'IF(pc_="Avg",ROUND(n_r,2),n_r)),"no data")))'
    return (pre +
            'rb_,INDEX($F$1:$F$500,lr_+2):INDEX($AC$1:$AC$500,lr_+1+MAX(1,nr_)),'
            'hd_,INDEX($F$1:$F$500,lr_+1):INDEX($AC$1:$AC$500,lr_+1),'
            'mk_,(hd_<>"")*(hd_<>"HC per streak"),'
            'wv_,IF(pc_="Avg",p_,--(SEQUENCE(MAX(1,nr_))<=n_r)),'
            's_,MMULT(TRANSPOSE(wv_),IF(ISNUMBER(rb_),rb_,0)),'
            'IF(n_r=0,"{}","{"&TEXTJOIN(", ",TRUE,IF((s_>0.004)*mk_,hd_&": "&ROUND(s_,2),""))&"}")),"no data")))')


def table_formulas(r):
    """One row of the completion table (row r = the i-th round of the sheet, i counted from the rows above, so a row
    inserted through the table shows blank and costs no round)."""
    seg, rnd, req = '$AI{r}'.format(r=r), '$AJ{r}'.format(r=r), '$AO{r}'.format(r=r)
    row_ = '$AS{r}'.format(r=r)
    head = '=IF({row}="","",'.format(row=row_)
    rng = '$A$1:INDEX({a},{row})'.format(a=COL_A, row=row_)
    start = '(ROW({rng})>IFERROR(MATCH("Goals and Rewards",{a},0),7))'.format(rng=rng, a=COL_A)
    reach_one = lambda what: ('LET(seg_,{s},arm_,$AM$2,' + reach_bindings_light() +
                              'INDEX(FILTER({w},r_ok*(r_rd={k})),1,1))').format(s=seg, k=rnd, w=what)
    f = {}
    f['AS'] = ('=IFERROR(INDEX(FILTER(ROW({a}),ISNUMBER({a})),COUNT($AJ${h}:AJ{p})+1),"")'
               .format(a=COL_A, h=T_HDR, p=r - 1))
    f['AI'] = (head + 'ARRAYFORMULA(LOOKUP(2,1/(ISTEXT({rng})*({rng}<>"Round")*{st}),{rng})))'
               .format(rng=rng, st=start))
    f['AJ'] = head + 'INDEX({a},{row}))'.format(a=COL_A, row=row_)
    f['AO'] = head + 'INDEX({e},{row}))'.format(e=COL_E, row=row_)
    f['AN'] = head + 'IFERROR(ARRAYFORMULA(' + reach_one('r_req') + '),""))'
    f['AK'] = head + 'IFERROR(ARRAYFORMULA(' + reach_one('r_m') + '),0))'
    f['AP'] = (head + 'ARRAYFORMULA(IFERROR(LET(seg_,{s},arm_,$AM$2,u_v,{x}/$AJ$4,'.format(s=seg, x=req) +
               progress_bindings() + curve_bindings('al', '"ALL"') + 'INDEX(' + s_expr('al', 'u_v') + ',1,1)),"no data")))')
    f['AQ'] = (head + 'ARRAYFORMULA(IFERROR(LET(seg_,{s},arm_,$AM$2,u_v,{x}/$AJ$4,'.format(s=seg, x=req) +
               progress_bindings() + curve_bindings('al', '"ALL"') + reach_bindings() +
               'INDEX(' + c_expr('u_v') + ',1,1)),"no data")))')
    f['AL'] = head + 'IFERROR(MIN(1,$AP{r}*$AQ{r}),"no data"))'.format(r=r)
    f['AM'] = head + 'IFERROR(($AL{r}-$AK{r})*100,""))'.format(r=r)
    f['AR'] = (head + 'IF({o}="","new round (old = 0)",IF({o}={x},"requirement unchanged","requirement "&{o}&" -> "&{x}))'
               '&IF($AJ$4>1,", over "&$AJ$4&" days","")'
               '&IF({x}/$AJ$4>MAX(ARRAYFORMULA(IF(LEFT({h},9)="share_ge_",IFERROR(VALUE(MID({h},10,12)),0),0))),'
               '", past the last progress point (extended slope)","")'
               '&IF(N({o})=0,IF({x}>MAX(ARRAYFORMULA(IFERROR(LET(seg_,{s},arm_,$AM$2,' + reach_bindings_light() +
               'FILTER(r_req,r_ok)),0))),", claim factor held at the last old round",", claim factor interpolated"),""))'
               ).format(o='$AN{r}'.format(r=r), x=req, h=PG_H, s=seg)
    return f


def reach_bindings_light():
    """data_ns_reach row filter only (no curve) - for the old % / old requirement lookups."""
    col = lambda n: 'INDEX(r_t,0,MATCH("%s",r_h,0))' % n
    return ('r_h,' + RC_H + ',r_t,' + RC_T + ','
            'r_lad,' + col('ladder') + ',r_rd,' + col('round') + ',r_req,' + col('cum_req') + ','
            'r_m,' + col('claim_rate_active') + ',r_arm,IFERROR(' + col('config_arm') + ',""),'
            'r_aok,IF(ISNUMBER(MATCH("config_arm",r_h,0)),IF(LEN(arm_)=0,1,LEFT(r_arm&"",LEN(arm_))=arm_),1),'
            'r_ok,((r_lad=seg_)+(seg_="100+")*(r_lad="100-249"))*r_aok*ISNUMBER(r_m)*ISNUMBER(r_req),')


# ---------------------------------------------------------------------------------------------------------------
# the notes next to the table
# ---------------------------------------------------------------------------------------------------------------
NOTES = [
    ('HOW "ROUND % (NEW)" IS SIMULATED', 'b'),
    ('What the table is. One row per round of every segment on this sheet, in ladder order. The round list is read from '
     'column A (every numbered row under a segment\'s "Round" header, down to the first row that is not a number - the '
     'rule the engine uses), so a segment can have any number of rounds and the table follows when rounds are added or '
     'removed. Rows past the last round stay blank (60 rows allocated).', ''),
    ('Round % (old) - MEASURED. data_ns_reach, column claim_rate_active, for (ladder = Segment, round = Round #): the '
     'share of Night-Sky-active player-days that claimed that round under the ladder that ran (its requirement is shown '
     'in "Cum req (old)"). A round the old ladder did not have shows 0. All payers and all days pooled, so the weekday and '
     'weekend sheets show the same old column. Arm filter: AM2 (rows whose config_arm starts with it).', ''),
    ('Progress share S(x) - MEASURED CURVE. data_ns_progress: the share of NS-active player-days whose cumulative streak '
     'progress reached x (columns share_ge_X), pooled over NONPAYER and PAYER by player_days (the 100+ ladder pools the '
     '100-249 and 250+ rows). The curve runs through (0, 100%), (1, 1 - share_zero) and every share_ge_X point, linear '
     'between them; past the last point the slope of the last two points is extended log-linearly (the engine\'s D106 '
     'curve; the row says so when a round lands there).', ''),
    ('Claim factor c - CALIBRATION. S counts player-days that REACHED x; the old column counts player-days that CLAIMED '
     'the round, on data_ns_reach\'s ladder population. The two differ (c 0.89-1.0 at 0-9, 0.5-0.8 at 10-39, ~0.47-0.5 at 40-99, 0.41-0.62 at 100+), '
     'so the curve alone would show a large fake gain on rounds nobody changed. At every OLD round j: c_j = old_j / S(O_j). '
     'Between old requirements c is interpolated linearly in the requirement; below the first and above the last it is held '
     'at the nearest one.', ''),
    ('THE FORMULA', 'b'),
    ('Round % (new)_k = MIN( 1 , c(X_k / D) x S(X_k / D) )', 'f'),
    ('   X_k = the round\'s Cum Streak Req on this sheet (column E)      D = Event duration, AJ4 (1 today)', 'f'),
    ('   S(x) = data_ns_progress curve, pooled payers      c(x) = interp over the old rounds of  old_j / S(O_j)', 'f'),
    ('   diff (pp) = ( Round % (new) - Round % (old) ) x 100', 'f'),
    ('In the cells: AL = MIN(1, AP x AQ); AP = S(AO / AJ4); AQ = c(AO / AJ4); AK / AN = the data_ns_reach row of (AI, AJ). '
     'AP and AQ are one LET formula each: every data column is found by its header, so a re-pull with more columns or '
     'rows (up to BZ / row 400) needs no edit.', ''),
    ('What follows from it. A round whose requirement did not change shows exactly the measured rate (D = 1). A changed '
     'round moves along the measured curve from the calibrated level. A NEW round (old = 0) gets S at its requirement '
     'times the claim factor of the nearest old rounds - so rounds stay ordered: a harder round never shows more '
     'completions than an easier one.', ''),
    ('Duration (AJ4 > 1) - ASSUMPTION. Streak progress carries over from day to day and each player keeps their daily '
     'pace, so reaching X over D days is as likely as reaching X / D in one day. With D > 1 even unchanged rounds move up.', ''),
    ('THE LOCAL SIM (AI1:AS12)', 'b'),
    ('Same P as the table, per day d (X / d) and for the payer type in AJ3 (the curve of that payer, the claim factor of '
     'the pooled population). A player at percentile q has completed round k by day d when P_k(d) >= 1 - q, counted from '
     'round 1 until the first round that fails (p50: every round at least half the player-days complete; p90: every round '
     'at least 10% complete). The reward cell sums those rounds\' rewards (columns F:AC, HC per streak left out). '
     'Avg = the EXPECTED rounds (SUM P_k) and the expected rewards (SUM P_k x reward_k) per NS-active player-day.', ''),
    ('FLAGS', 'b'),
    ('- Not the engine\'s rule for new rounds. EcoGainsSim (D106) pairs rounds by NUMBER (new_k = measured_k x '
     'S(X_k)/S(O_k)) and prices a round the base does not have at the raw S(X), without the claim factor - about 2x this '
     'table from 10-19 up, and not ordered (40-99: round 4 26% against round 3 24%). The change summary\'s Night Sky row '
     'is therefore higher than this table implies for 20-39 round 4 and 40-99 / 100+ rounds 2-7.', ''),
    ('- data_ns_reach has no weekday / weekend split and data_ns_progress carries day_type = all only: both sheets show the '
     'same numbers until a re-pull splits them (the curve then reads the "all" rows; a pull with weekday / weekend rows '
     'only is pooled).', ''),
    ('- data_ns_reach rows are read in sheet order as rounds 1, 2, 3...: keep them sorted by round.', ''),
    ('- A round that exists in the old ladder but was removed from this one is not listed (the table lists this sheet\'s '
     'rounds).', ''),
    ('- data_ns_progress is keyed by PLAYER segment, data_ns_reach by LADDER segment; the claim factor carries the '
     'difference, and it is assumed to stay what it was at the old requirements.', ''),
]


# ---------------------------------------------------------------------------------------------------------------
# emulation (the same rule in Python, on the workbook's cached values) - the check printed after the build
# ---------------------------------------------------------------------------------------------------------------
def sheet_rows(wb, name):
    return [list(r) for r in wb[name].iter_rows(values_only=True)]


def emu_curve(prog, seg, payer='ALL', arm='Variant A'):
    h = {str(x).strip(): i for i, x in enumerate(prog[0]) if x is not None}
    ges = sorted((float(k[9:]), i) for k, i in h.items() if k.startswith('share_ge_'))
    rows = []
    for r in prog[1:]:
        if not r or r[h['segment']] is None:
            continue
        s = str(r[h['segment']]).strip()
        ok = s == seg or (seg == '100+' and s in ('100-249', '250+'))
        if not ok or (arm and 'ab_variant' in h and not str(r[h['ab_variant']]).startswith(arm)):
            continue
        if payer != 'ALL' and str(r[h['payer_flag']]).strip() != payer:
            continue
        if 'day_type' in h and str(r[h['day_type']] or '').strip() not in ('all', ''):
            continue
        if 'config_segment' in h and str(r[h['config_segment']] or '').strip() not in ('ALL', '', seg):
            continue
        rows.append(r)
    W = sum(float(r[h['player_days']]) for r in rows)
    ss = [sum(float(r[h['player_days']]) * float(r[i] or 0) for r in rows) / W for _, i in ges]
    xs = [x for x, _ in ges]
    z = sum(float(r[h['player_days']]) * float(r[h['share_zero']] or 0) for r in rows) / W
    s1, n = 1 - z, len(xs)
    kp = sum(1 for s in ss if s > ss[-1] + 1e-12)
    lam = math.log(ss[kp - 1] / ss[-1]) / (xs[-1] - xs[kp - 1]) if ss[-1] > 0 and kp > 0 else 0

    def S(u):
        if u <= 0:
            return 1.0
        if u > xs[-1]:
            return ss[-1] * math.exp(-lam * (u - xs[-1])) if ss[-1] > 0 else 0.0
        v = 1 - (1 - s1) * min(u, 1)
        if u > 1:
            v += (ss[0] - s1) / (xs[0] - 1) * (min(u, xs[0]) - 1)
        for j in range(n - 1):
            v += (ss[j + 1] - ss[j]) / (xs[j + 1] - xs[j]) * max(0, min(u - xs[j], xs[j + 1] - xs[j]))
        return v
    return S, xs[-1]


def emu_old(reach, seg, arm='Variant A'):
    h = {str(x).strip(): i for i, x in enumerate(reach[0]) if x is not None}
    out = []
    for r in reach[1:]:
        if not r or r[h['ladder']] is None:
            continue
        lad = str(r[h['ladder']]).strip()
        if not (lad == seg or (seg == '100+' and lad == '100-249')):
            continue
        if arm and 'config_arm' in h and not str(r[h['config_arm']]).startswith(arm):
            continue
        out.append((int(r[h['round']]), float(r[h['cum_req']]), float(r[h['claim_rate_active']])))
    return out


def emu_c(old, S_all):
    cs = [(o, m / S_all(o)) for _, o, m in old]

    def c(u):
        if not cs:
            return 1.0
        v = cs[0][1]
        for (a, ca), (b, cb) in zip(cs, cs[1:]):
            v += (cb - ca) / (b - a) * max(0, min(u - a, b - a))
        return v
    return c


def emu_ladder(ws_vals, seg):
    """(Cum Streak Req, rewards dict) per round of a segment block, the engine's strict rule."""
    col_a = [r[0] if r else None for r in ws_vals]
    lr = next(i for i, a in enumerate(col_a) if a is not None and str(a).strip() == seg)
    hdr = ws_vals[lr + 1]
    out = []
    for r in ws_vals[lr + 2:]:
        a = r[0] if r else None
        if not isinstance(a, (int, float)) or isinstance(a, bool):
            break
        rew = {}
        for ci in range(CI('F') - 1, CI('AC')):
            hname = hdr[ci]
            if hname and hname != 'HC per streak' and isinstance(r[ci], (int, float)) and r[ci]:
                rew[hname] = r[ci]
        out.append((float(r[4]), rew))
    return out


def emulate(vals, sheet, days=1, payer='ALL', pct='p50'):
    prog, reach = sheet_rows(vals, 'data_ns_progress'), sheet_rows(vals, 'data_ns_reach')
    lad_vals = sheet_rows(vals, sheet)
    table, sim = [], {}
    for seg in SEGS:
        S_all, xmax = emu_curve(prog, seg)
        S_pay, _ = emu_curve(prog, seg, payer)
        old = emu_old(reach, seg)
        c = emu_c(old, S_all)
        lad = emu_ladder(lad_vals, seg)
        for k, (x, _) in enumerate(lad, 1):
            o = next((t for t in old if t[0] == k), None)
            new = min(1, c(x / days) * S_all(x / days))
            table.append((seg, k, o[2] if o else 0.0, new, o[1] if o else None, x, S_all(x / days), c(x / days)))
        q = {'p10': .1, 'p25': .25, 'p50': .5, 'p75': .75, 'p90': .9, 'p95': .95, 'p99': .99}.get(pct, .5)
        per = []
        for d in range(1, days + 1):
            p = [max(0, min(1, c(x / d) * S_pay(x / d))) for x, _ in lad]
            if pct == 'Avg':
                n = sum(p)
                w = p
            else:
                n = next((i for i, v in enumerate(p) if v < 1 - q), len(p))
                w = [1 if i < n else 0 for i in range(len(p))]
            rew = {}
            for wi, (_, rw) in zip(w, lad):
                for kname, val in rw.items():
                    rew[kname] = rew.get(kname, 0) + wi * val
            per.append((n, {k: round(v, 2) for k, v in rew.items() if v > 0.004}))
        sim[seg] = per
    return table, sim


# ---------------------------------------------------------------------------------------------------------------
def newest_workbook():
    c = glob.glob(os.path.join(ROOT, 'workbooks', '*LiveOps_cal_NS_completions_increase*.xlsx'))
    return max(c, key=os.path.getmtime) if c else None


def style(c, kind):
    c.font = Font(name=ARIAL, bold=kind in ('title', 'header', 'b'), size=11 if kind == 'title' else 10,
                  italic=kind == 'note')
    if kind == 'input':
        c.fill = IN_FILL
    elif kind in ('sim', 'simpct', 'pp'):
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
    if kind == 'num':
        c.number_format = '0.000'


def write_blocks(ws, day_type):
    put = lambda cell, val, kind: (ws.__setitem__(cell, val), style(ws[cell], kind))
    # ---- local sim -------------------------------------------------------------------------------------------
    put('AI1', 'LOCAL SIM - how far players get in Night Sky (' + day_type + ' ladder)', 'title')
    put('AI2', 'Percentile', 'label'); put('AJ2', 'p50', 'input')
    put('AI3', 'Payer', 'label'); put('AJ3', 'ALL', 'input')
    put('AI4', 'Event duration (days)', 'label'); put('AJ4', 1, 'input')
    put('AL2', 'Arm', 'label'); put('AM2', 'Variant A', 'input')
    put('AL3', 'Rounds completed by the end of each day by a player at the AJ2 percentile (Avg = expected rounds), and '
               'what those rounds pay (Avg = expected rewards per NS-active player-day).', 'note')
    put('AL4', 'Same simulation as the Round % (new) column below - see the notes at ' + NOTE_COL + str(T_HDR) + '.', 'note')
    put('AI5', 'Day_of_event', 'header')
    for seg, c in zip(SEGS, RND_COLS):
        put(c + '5', seg + '_rounds', 'header')
        put(openpyxl.utils.get_column_letter(CI(c) + 1) + '5', seg + '_reward', 'header')
    for i, r in enumerate(DAY_ROWS):
        put('AI%d' % r, '=IF(%d<=$AJ$4,%d,"")' % (i + 1, i + 1), 'sim')
        for seg, c in zip(SEGS, RND_COLS):
            put('%s%d' % (c, r), local_sim_formula(seg, r, False), 'sim')
            put('%s%d' % (openpyxl.utils.get_column_letter(CI(c) + 1), r), local_sim_formula(seg, r, True), 'sim')
    for cell, opts in (('AJ2', '"Avg,p10,p25,p50,p75,p90,p95,p99"'), ('AJ3', '"ALL,NONPAYER,PAYER"')):
        dv = DataValidation(type='list', formula1=opts, allow_blank=False)
        ws.add_data_validation(dv)
        dv.add(cell)
    dv = DataValidation(type='whole', operator='between', formula1='1', formula2=str(len(DAY_ROWS)), allow_blank=False)
    ws.add_data_validation(dv)
    dv.add('AJ4')

    # ---- completion table (rows T_HDR-2, T_HDR-1 left blank) ------------------------------------------------------
    heads = [('AI', 'Segment'), ('AJ', 'Round #'), ('AK', 'Round % (old)'), ('AL', 'Round % (new)'), ('AM', 'diff'),
             ('AN', 'Cum req (old)'), ('AO', 'Cum req (new)'), ('AP', 'Progress share S'), ('AQ', 'Claim factor c'),
             ('AR', 'How it is priced'), ('AS', 'Sheet row')]
    tips = {'AK': 'data_ns_reach claim_rate_active of (Segment, Round #): claimed / NS-active player-days. 0 = the old '
                  'ladder had no such round.',
            'AL': 'MIN(1, Progress share S x Claim factor c) - see the notes at ' + NOTE_COL + str(T_HDR) + '.',
            'AM': '(new - old) x 100, percentage points.',
            'AP': 'data_ns_progress: share of NS-active player-days whose streak progress reached Cum req (new) / AJ4, '
                  'payers pooled.',
            'AQ': 'old / S at the old rounds\' requirements, interpolated to this requirement (held flat outside them).',
            'AS': 'The row of this round on the sheet (column A).'}
    for col, txt in heads:
        put('%s%d' % (col, T_HDR), txt, 'header')
        if col in tips:
            ws['%s%d' % (col, T_HDR)].comment = Comment(tips[col], 'NS local sim')
    kinds = {'AI': 'sim', 'AJ': 'sim', 'AK': 'datapct', 'AL': 'simpct', 'AM': 'pp', 'AN': 'data', 'AO': 'sim',
             'AP': 'simpct', 'AQ': 'num', 'AR': 'sim', 'AS': 'sim'}
    for r in range(T_FIRST, T_FIRST + T_ROWS):
        for col, f in table_formulas(r).items():
            put('%s%d' % (col, r), f, kinds[col])
        ws['AS%d' % r].font = Font(name=ARIAL, size=9, color='FF808080')
    rng = 'AM%d:AM%d' % (T_FIRST, T_FIRST + T_ROWS - 1)
    ws.conditional_formatting.add(rng, CellIsRule(operator='greaterThan', formula=['0.0049'],
                                                  font=Font(name=ARIAL, color='FF006100')))
    ws.conditional_formatting.add(rng, CellIsRule(operator='lessThan', formula=['-0.0049'],
                                                  font=Font(name=ARIAL, color='FF9C0006')))

    # ---- notes next to the table --------------------------------------------------------------------------------
    for i, (txt, k) in enumerate(NOTES):
        c = ws['%s%d' % (NOTE_COL, T_HDR + i)]
        c.value = txt
        c.font = Font(name='Consolas' if k == 'f' else ARIAL, size=10, bold=(k == 'b'))
        c.alignment = Alignment(wrap_text=(k != 'f'), vertical='top')
    widths = {'AI': 16, 'AJ': 12, 'AK': 13, 'AL': 13, 'AM': 13, 'AN': 13, 'AO': 13, 'AP': 14, 'AQ': 13, 'AR': 30,
              'AS': 9, 'AT': 3, NOTE_COL: 120}
    for c in RND_COLS:
        widths[openpyxl.utils.get_column_letter(CI(c) + 1)] = max(widths.get(openpyxl.utils.get_column_letter(CI(c) + 1), 0), 30)
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
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name in SHEETS:
        dropped = [c.coordinate for row in src[name].iter_rows() for c in row
                   if c.column >= CLEAR_FROM and c.value not in (None, '')]
        ws = wb.create_sheet(name)
        copy_sheet(src[name], ws, skip=lambda r, c: c >= CLEAR_FROM)
        write_blocks(ws, 'weekday' if name.endswith('weekday') else 'weekend')
        print('%s: copied A:AH, rewrote AI onwards (%d old cells there replaced: %s)'
              % (name, len(dropped), ', '.join(dropped[:6]) + (' ...' if len(dropped) > 6 else '')))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)
    print('written', a.out)
    lens = [len(local_sim_formula('100+', 6, True)), len(table_formulas(16)['AQ'])]
    print('longest formulas: local sim reward %d chars, table AQ %d chars (Sheets limit 50,000)' % tuple(lens))

    # ---- the check: what the sheets should show after import (same rule, cached data) ---------------------------
    for name in SHEETS:
        table, sim = emulate(vals, name)
        print('\n== %s - Round completion (D = 1)' % name)
        print('  seg     rnd   old      new      diff(pp)  req old->new   S        c')
        for seg, k, old, new, oreq, x, s, c in table:
            print('  %-7s %2d  %6.2f%%  %6.2f%%  %+7.2f   %5s -> %-5g  %6.2f%%  %.3f'
                  % (seg, k, 100 * old, 100 * new, 100 * (new - old), '-' if oreq is None else '%g' % oreq, x, 100 * s, c))
        for pct in ('p50', 'p90', 'Avg'):
            _, sim = emulate(vals, name, days=1, pct=pct)
            print('  local sim day 1, ALL, %s: ' % pct + ' | '.join(
                '%s %s %s' % (seg, ('%.2f' % sim[seg][0][0]) if pct == 'Avg' else sim[seg][0][0], sim[seg][0][1])
                for seg in SEGS))
        if name == SHEETS[0]:
            _, sim2 = emulate(vals, name, days=2, pct='p50')
            print('  local sim D = 2, ALL, p50 (rounds day 1 / day 2): ' +
                  ' | '.join('%s %d/%d' % (seg, sim2[seg][0][0], sim2[seg][1][0]) for seg in SEGS))


if __name__ == '__main__':
    main()
