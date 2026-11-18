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

THE RULE (user decisions 2026-11-18; the old side re-based on data_ns_per_day_reach the same day)
  old_k   = data_ns_per_day_reach for (ladder segment, round k): SUM players_claimed / SUM players_active over the
            dates of the sheet's DAY TYPE (AM3: weekday on NS_v2_weekday, weekend on NS_v2, or all), leaving out every
            date on which some round counts more claims than active players (AM4 = Yes; Oct 13 on the first pull).
            0 when the old ladder had no round k. data_ns_reach (the same pull summed over all dates) is not read.
  S(x)    = the share of active player-days whose daily peak streak reached x. PREFERRED: data_ns_streak_dist
            (PROMPT_ns_streak_curve.md, requested 2026-11-18): counts per (date, ladder, payer) on the counter the
            round claim fires on and on data_ns_per_day_reach's own denominator - S = SUM players_ge_X / SUM
            players_active over the day type's kept dates, points (0, 1) + every players_ge_X. FALLBACK, while the
            sheet is missing: data_ns_progress pooled over payers (and 100-249 + 250+ for the 100+ ladder) by
            player_days, points (0, 1), (1, 1 - share_zero), every share_ge_X. Both: linear between points, past the
            last point the slope extended log-linearly (the engine's D106 curve). data_ns_progress runs ~2x the
            claims from 20-39 up (it behaves like data_ns_reach's 'reached', not 'reached_streak'), which is what the
            claim factor below has to undo; on the streak sheet c should sit near 1.
  c(x)    = the claim factor: c_j = old_j / S(O_j) at every OLD round requirement O_j, linear in x between them,
            flat outside them. It absorbs what S does not see (reached-but-not-claimed, and the ladder segments of
            data_ns_per_day_reach counting more player-days than the player segments of data_ns_progress) - and, since S is
            all-days, the weekday / weekend difference of the claims.
  new_k   = MIN(1, c(X_k / D) x S(X_k / D))   X_k = the round's Cum Streak Req on this sheet, D = event duration.
            D = 1 and X_k = O_k gives the measured rate exactly. D > 1: progress CARRIES OVER between days (user)
            and a player keeps their daily pace, so reaching X in D days = reaching X / D in one.
  local sim: a player at percentile q has completed round k by day d when new_k(d) >= 1 - q (counting from round 1
            up to the first round that fails); Avg = SUM new_k(d) rounds and SUM new_k(d) x reward_k.

The engine (D107) reads the same two sheets, but ONLY once data_ns_streak_dist exists (until then it is D106 bit for
bit: per-day claims against data_ns_progress priced 250+ at 3.7x). It still prices a NEW round at the raw S(X), without
the claim factor - on the streak curve c should sit near 1, so the two should then agree closely; on today's fallback
curve they do not (flagged in the notes block).

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
RC_H, RC_T = 'data_ns_per_day_reach!$A$1:$BZ$1', 'data_ns_per_day_reach!$A$1:$BZ$3000'
ST_SHEET = 'data_ns_streak_dist'                      # PROMPT_ns_streak_curve.md - the curve on the claim's counter
ST_H, ST_T = ST_SHEET + '!$A$1:$DZ$1', ST_SHEET + '!$A$1:$DZ$3000'
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


def streak_bindings():
    """data_ns_streak_dist (PROMPT_ns_streak_curve.md): counts per (date, ladder, payer) of active players whose daily
    peak on the claim's counter reached X (players_ge_<X>). Rows: the segment's ladder, the arm, the day type and -
    when drop_ - not a date data_ns_per_day_reach flags (a round with more claims than actives). Every binding is
    IFERROR-wrapped: until the sheet exists the curve falls back to data_ns_progress (s_comb)."""
    col = lambda n: 'INDEX(t_t,0,MATCH("%s",t_h,0))' % n
    bc = lambda n: 'INDEX(b_t,0,MATCH("%s",b_h,0))' % n
    return ('b_h,' + RC_H + ',b_t,' + RC_T + ','
            'b_a,IFERROR(' + bc('players_active') + ',0),b_c,IFERROR(' + bc('players_claimed') + ',0),'
            'b_bd,IFERROR(FILTER(' + bc('event_date') + ',IF(ISNUMBER(b_c),b_c,0)>IF(ISNUMBER(b_a),b_a,0)),"none"),'
            'b_lad,IFERROR(' + bc('ladder') + ',""),b_req,IFERROR(' + bc('cum_req') + ',0),'
            'b_arm,IFERROR(' + bc('config_arm') + ',""),'
            't_fin,IF(cens_,IFERROR(MAX(FILTER(IF(ISNUMBER(b_req),b_req,0),((b_lad=seg_)+(seg_="100+")*(b_lad="100-249"))'
            '*IF(LEN(arm_)=0,1,LEFT(b_arm&"",LEN(arm_))=arm_))),1E9),1E9),'
            't_h,IFERROR(' + ST_H + ',""),t_t,IFERROR(' + ST_T + ',""),'
            't_lad,IFERROR(' + col('ladder') + ',""),t_pay,IFERROR(' + col('payer_flag') + ',""),'
            't_act,IFERROR(' + col('players_active') + ',0),t_dt,IFERROR(' + col('day_type') + ',"all"),'
            't_dte,IFERROR(' + col('event_date') + ',0),t_arm,IFERROR(' + col('config_arm') + ',""),'
            't_aok,IF(ISNUMBER(MATCH("config_arm",t_h,0)),IF(LEN(arm_)=0,1,LEFT(t_arm&"",LEN(arm_))=arm_),1),'
            't_w0,IFERROR(IF(ISNUMBER(t_act),t_act,0)*((t_lad=seg_)+(seg_="100+")*(t_lad="100-249"))*t_aok'
            '*IF(OR(dt_="all",dt_=""),1,t_dt=dt_)*IF(drop_,ISNA(MATCH(t_dte,b_bd,0)),1),0),'
            't_gx,IFERROR(VALUE(MID(t_h,12,12)),0),'
            't_ge,IFERROR((LEFT(t_h,11)="players_ge_")*(t_gx<=t_fin)>0,FALSE),'
            't_xs,IFERROR(FILTER(IFERROR(VALUE(MID(t_h,12,12)),0),t_ge),1),'
            't_cn,IFERROR(FILTER(t_t,t_ge),0),t_cnn,IF(ISNUMBER(t_cn),t_cn,0),'
            't_n,COLUMNS(t_xs),t_sq,SEQUENCE(1,t_n),'
            't_xlo,IFERROR(FILTER(t_xs,t_sq<t_n),0),t_dx,IFERROR(FILTER(t_xs,t_sq>1)-t_xlo,1),'
            't_x1,INDEX(t_xs,1,1),t_xn,INDEX(t_xs,1,t_n),')


def streak_curve(t, payer_expr):
    """One pooled streak curve (tag t, names {t}k_*): S at every players_ge_X = SUM count / SUM players_active over
    the kept rows (payer filter), piece slopes, the tail; {t}k_use = the sheet has active players for it."""
    return ('{t}k_w,t_w0*IF({p}="ALL",1,t_pay={p}),{t}k_wt,IFERROR(SUM({t}k_w),0),{t}k_use,{t}k_wt>0,'
            '{t}k_ss,IFERROR(MMULT(TRANSPOSE(--({t}k_w>0)),t_cnn)/{t}k_wt,0),'
            '{t}k_sf,IFERROR(INDEX({t}k_ss,1,1),0),{t}k_sn,IFERROR(INDEX({t}k_ss,1,t_n),0),'
            '{t}k_sl,IFERROR((FILTER({t}k_ss,t_sq>1)-FILTER({t}k_ss,t_sq<t_n))/t_dx,0),'
            '{t}k_kp0,IFERROR(SUM(--({t}k_ss>{t}k_sn+1E-12)),0),'
            '{t}k_kp1,IF(t_fin<1E9,IFERROR(MAX(IF((t_xs<=t_fin/2)*({t}k_ss>{t}k_sn+1E-12),t_sq,0)),0),0),'
            '{t}k_kp,IF({t}k_kp1>0,{t}k_kp1,{t}k_kp0),'
            '{t}k_lam,IFERROR(IF(AND({t}k_sn>0,{t}k_kp>0),LN(INDEX({t}k_ss,1,MAX(1,{t}k_kp))/{t}k_sn)'
            '/(t_xn-INDEX(t_xs,1,MAX(1,{t}k_kp))),0),0),'
            ).format(t=t, p=payer_expr)


def s_cnt(t, u):
    """S(u) on the streak curve t: (0,1) -> the players_ge points, linear, the tail extended log-linearly."""
    clamp = 'IF({u}-t_xlo<0,0,IF({u}-t_xlo>t_dx,t_dx,{u}-t_xlo))'.format(u=u)
    return ('IF({u}<=0,1,IF({u}>t_xn,IF({t}k_sn>0,{t}k_sn*EXP(-{t}k_lam*({u}-t_xn)),0),'
            '1+({t}k_sf-1)/t_x1*IF({u}>t_x1,t_x1,{u})+MMULT(' + clamp + ',TRANSPOSE({t}k_sl))))').format(t=t, u=u)


def s_comb(t, u):
    """The curve the sheet prices on: data_ns_streak_dist when it has active players for the ladder (and payer),
    else data_ns_progress."""
    return 'IF({t}k_use,IFERROR('.format(t=t) + s_cnt(t, u) + ',0),IFERROR(' + s_expr(t, u) + ',0))'


def perday_rows():
    """data_ns_per_day_reach rows the old side reads: the segment's ladder, the arm (AM2), the day type (dt_: weekday /
    weekend / all) and - when drop_ - not a date on which some round counts more claims than active players."""
    col = lambda n: 'INDEX(r_t,0,MATCH("%s",r_h,0))' % n
    return ('r_h,' + RC_H + ',r_t,' + RC_T + ','
            'r_lad,' + col('ladder') + ',r_rd,' + col('round') + ',r_req,' + col('cum_req') + ','
            'r_act,' + col('players_active') + ',r_clm,' + col('players_claimed') + ','
            'r_dt,IFERROR(' + col('day_type') + ',"all"),r_dte,IFERROR(' + col('event_date') + ',0),'
            'r_arm,IFERROR(' + col('config_arm') + ',""),'
            'r_aok,IF(ISNUMBER(MATCH("config_arm",r_h,0)),IF(LEN(arm_)=0,1,LEFT(r_arm&"",LEN(arm_))=arm_),1),'
            'r_tok,IF(OR(dt_="all",dt_=""),1,r_dt=dt_),'
            'r_an0,IF(ISNUMBER(r_act),r_act,0),r_cn0,IF(ISNUMBER(r_clm),r_clm,0),'
            'r_bd,IFERROR(FILTER(r_dte,r_cn0>r_an0),"none"),'
            'r_dok,IF(drop_,ISNA(MATCH(r_dte,r_bd,0)),1),'
            'r_ok,((r_lad=seg_)+(seg_="100+")*(r_lad="100-249"))*r_aok*r_tok*r_dok*ISNUMBER(r_act)*ISNUMBER(r_rd),'
            'r_an,r_an0*r_ok,r_cn,r_cn0*r_ok,')


def reach_bindings():
    """The OLD rounds of the segment's ladder from data_ns_per_day_reach: o_r (round numbers), o_v (their cum_req),
    o_m (SUM claimed / SUM active over the rows kept), column vectors in round order; the claim factor
    c_j = o_m / S_all(o_v) and its interpolation pieces."""
    return (perday_rows() +
            'o_r,IFERROR(SORT(UNIQUE(FILTER(r_rd,r_ok))),0),o_k,IF(SUM(r_ok)=0,0,ROWS(o_r)),'
            'o_mx,--(r_rd=TRANSPOSE(o_r)),'
            'o_m,IFERROR(TRANSPOSE(MMULT(TRANSPOSE(r_cn),o_mx)/MMULT(TRANSPOSE(r_an),o_mx)),1),'
            'o_v,IFERROR(TRANSPOSE(MMULT(TRANSPOSE(IF(ISNUMBER(r_req),r_req,0)*r_ok),o_mx)/MMULT(TRANSPOSE(r_ok),o_mx)),1),'
            'o_c,IFERROR(o_m/' + s_comb('al', 'o_v') + ',1),'
            'o_q,SEQUENCE(MAX(1,o_k)),'
            'o_lo,IFERROR(TRANSPOSE(FILTER(o_v,o_q<o_k)),0),o_dx,IFERROR(TRANSPOSE(FILTER(o_v,o_q>1))-o_lo,1),'
            'o_sl,IFERROR((TRANSPOSE(FILTER(o_c,o_q>1))-TRANSPOSE(FILTER(o_c,o_q<o_k)))/o_dx,0),')


def c_expr(u):
    """c(u): flat at c_1 below the first old requirement, linear between them, flat at c_last past the last one;
    1 (the raw curve) when data_ns_per_day_reach has nothing for the segment."""
    return ('IF(o_k=0,1,INDEX(o_c,1,1)+IF(o_k<2,0,MMULT(IF({u}-o_lo<0,0,IF({u}-o_lo>o_dx,o_dx,{u}-o_lo)),'
            'TRANSPOSE(o_sl))))').format(u=u)


def ladder_bindings(seg):
    """The segment's block on THIS sheet: label row lr_ in column A, the first round row fr_ (the first number in
    column A within 3 rows - a block with its header row deleted starts right under its label), rounds down to the
    first non-number (the engine's strict rule), their Cum Streak Req (v_); the header row hr_ is the block's own
    'Round' row, else the sheet's FIRST one (2026-11-18: the user cleared the repeated headers on the v2 sheets -
    the columns are shared, so the 0-9 header names every block's rewards)."""
    return ('seg_,"{s}",lr_,MATCH(seg_,{a},0),'
            'fr_,lr_+IFERROR(MATCH(TRUE,ISNUMBER(INDEX({a},lr_+1):INDEX({a},lr_+3)),0),2),'
            'hr_,IFERROR(lr_+MATCH("Round",INDEX({a},lr_+1):INDEX({a},fr_),0),MATCH("Round",{a},0)),'
            'nr_,IFERROR(MATCH(TRUE,NOT(ISNUMBER(INDEX({a},fr_):INDEX({a},fr_+59))),0)-1,60),'
            'v_,INDEX({e},fr_):INDEX({e},fr_-1+MAX(1,nr_)),').format(s=seg, a=COL_A, e=COL_E)


def local_sim_formula(seg, r, reward):
    """AJ6.. (rounds) / AK6.. (rewards) for one segment and day row r."""
    pre = ('=ARRAYFORMULA(IF($AI{r}="","",IFERROR(LET('.format(r=r) + ladder_bindings(seg) +
           'pay_,$AJ$3,arm_,$AM$2,dt_,$AM$3,drop_,$AM$4="Yes",cens_,$AP$2="Yes",d_,$AI{r},pc_,$AJ$2,'.format(r=r) +
           progress_bindings() + curve_bindings('al', '"ALL"') + curve_bindings('py', 'pay_') +
           streak_bindings() + streak_curve('al', '"ALL"') + streak_curve('py', 'pay_') + reach_bindings() +
           'u_v,v_/d_,'
           'p0_,' + c_expr('u_v') + '*' + s_comb('py', 'u_v') + ',p_,IF(p0_>1,1,IF(p0_<0,0,p0_)),'
           'q_,SWITCH(pc_,"p10",0.1,"p25",0.25,"p50",0.5,"p75",0.75,"p90",0.9,"p95",0.95,"p99",0.99,0.5),'
           'n_r,IF(nr_<1,0,IF(pc_="Avg",SUM(p_),IFERROR(MATCH(TRUE,p_<1-q_,0)-1,nr_))),')
    if not reward:
        return pre + 'IF(pc_="Avg",ROUND(n_r,2),n_r)),"no data")))'
    return (pre +
            'rb_,INDEX($F$1:$F$500,fr_):INDEX($AC$1:$AC$500,fr_-1+MAX(1,nr_)),'
            'hd_,INDEX($F$1:$F$500,hr_):INDEX($AC$1:$AC$500,hr_),'
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
    lets = 'LET(seg_,{s},arm_,$AM$2,dt_,$AM$3,drop_,$AM$4="Yes",cens_,$AP$2="Yes",'.format(s=seg)
    # old % of round k = SUM claimed / SUM active over the rows kept; old cum req = their mean cum_req
    old_pct = lets + perday_rows() + 'k_m,(r_rd={k}),IF(SUM(r_an*k_m)=0,0,SUM(r_cn*k_m)/SUM(r_an*k_m)))'.format(k=rnd)
    old_req = lets + perday_rows() + 'k_m,r_ok*(r_rd={k}),IF(SUM(k_m)=0,"",SUM(IF(ISNUMBER(r_req),r_req,0)*k_m)/SUM(k_m)))'.format(k=rnd)
    f = {}
    f['AS'] = ('=IFERROR(INDEX(FILTER(ROW({a}),ISNUMBER({a})),COUNT($AJ${h}:AJ{p})+1),"")'
               .format(a=COL_A, h=T_HDR, p=r - 1))
    f['AI'] = (head + 'ARRAYFORMULA(LOOKUP(2,1/(ISTEXT({rng})*({rng}<>"Round")*{st}),{rng})))'
               .format(rng=rng, st=start))
    f['AJ'] = head + 'INDEX({a},{row}))'.format(a=COL_A, row=row_)
    f['AO'] = head + 'INDEX({e},{row}))'.format(e=COL_E, row=row_)
    f['AN'] = head + 'IFERROR(ARRAYFORMULA(' + old_req + '),""))'
    f['AK'] = head + 'IFERROR(ARRAYFORMULA(' + old_pct + '),0))'
    f['AP'] = (head + 'ARRAYFORMULA(IFERROR(LET(seg_,{s},arm_,$AM$2,dt_,$AM$3,drop_,$AM$4="Yes",cens_,$AP$2="Yes",u_v,{x}/$AJ$4,'.format(s=seg, x=req) +
               progress_bindings() + curve_bindings('al', '"ALL"') + streak_bindings() + streak_curve('al', '"ALL"') +
               'INDEX(' + s_comb('al', 'u_v') + ',1,1)),"no data")))')
    f['AQ'] = (head + 'ARRAYFORMULA(IFERROR(LET(seg_,{s},arm_,$AM$2,dt_,$AM$3,drop_,$AM$4="Yes",cens_,$AP$2="Yes",u_v,{x}/$AJ$4,'.format(s=seg, x=req) +
               progress_bindings() + curve_bindings('al', '"ALL"') + streak_bindings() + streak_curve('al', '"ALL"') +
               reach_bindings() + 'INDEX(' + c_expr('u_v') + ',1,1)),"no data")))')
    f['AL'] = head + 'IFERROR(MIN(1,$AP{r}*$AQ{r}),"no data"))'.format(r=r)
    f['AM'] = head + 'IFERROR(($AL{r}-$AK{r})*100,""))'.format(r=r)
    f['AR'] = (head + 'IF({o}="","new round (old = 0)",IF({o}={x},"requirement unchanged","requirement "&{o}&" -> "&{x}))'
               '&IF($AJ$4>1,", over "&$AJ$4&" days","")'
               '&IF({x}/$AJ$4>MAX(ARRAYFORMULA(IFERROR(' + lets + perday_rows() + 'FILTER(r_req,r_ok)),0))),'
               '", above the old final round: streak curve extended, claim factor held at the last old round",'
               'IF(N({o})=0,", claim factor interpolated",""))'
               ')'
               ).format(o='$AN{r}'.format(r=r), x=req, h=PG_H, s=seg)
    return f


# ---------------------------------------------------------------------------------------------------------------
# the notes next to the table
# ---------------------------------------------------------------------------------------------------------------
NOTES = [
    ('THE INPUTS (yellow cells)', 'b'),
    ('Percentile (AJ2) - which player the top block follows. p50 = the median NS-active player-day: a round counts as '
     'completed when at least 50% of player-days complete it (p90: at least 10%; p10: at least 90%). Avg = no single '
     'player: the expected number of rounds and the expected rewards per player-day (fractions).', ''),
    ('Payer (AJ3) - ALL pools non-payers and payers. NONPAYER / PAYER uses that payer type\'s streak curve; the claim '
     'factor and the Round % (old) column stay pooled (the claim data has no payer split). The table below is always ALL.', ''),
    ('Event duration (AJ4) - days in one Night Sky event (1 today). Above 1 the streak keeps counting across the days at '
     'the same daily pace (an assumption), so a round of X is as likely as a round of X / days in one day. Rows 6..12 show '
     'day 1..7; the table uses the full duration.', ''),
    ('Arm (AM2) - the A/B arm the data is read for (rows whose config_arm starts with it). Blank = every arm pooled.', ''),
    ('Day type (AM3) - which dates the measured claims (and the streak curve) are read from: weekday (Mon-Thu) on '
     'NS_v2_weekday, weekend (Fri-Sun) on NS_v2, or all.', ''),
    ('Leave out days with claims > active (AM4) - Yes drops every date on which a round counts more claims than active '
     'players (Oct 13 on the 2026-11-18 pull, the first day of the A/B); No reads every date.', ''),
    ('Stop the streak curve at the old final round (AP2) - Yes: data_ns_streak_dist is read only up to the requirement of '
     'the old ladder\'s LAST round and extended past it (see below), because the counter stops when that round is claimed '
     '(40-99: 4.4% of player-days reach 100, 0.36% reach 102). No: every point as delivered - a new round above the old final '
     'one then reads ~0.', ''),
    ('', ''),
    ('HOW "ROUND % (NEW)" IS SIMULATED', 'b'),
    ('What the table is. One row per round of every segment on this sheet, in ladder order. The round list is read from '
     'column A (every numbered row under a segment\'s "Round" header, down to the first row that is not a number - the '
     'rule the engine uses), so a segment can have any number of rounds and the table follows when rounds are added or '
     'removed. Rows past the last round stay blank (60 rows allocated).', ''),
    ('Round % (old) - MEASURED. data_ns_per_day_reach for (ladder = Segment, round = Round #): SUM players_claimed / '
     'SUM players_active over the dates of the day type in AM3 (weekday on NS_v2_weekday, weekend on NS_v2; "all" pools '
     'every date) - the share of Night-Sky-active player-days that claimed that round under the ladder that ran (its '
     'requirement is in "Cum req (old)"). A round the old ladder did not have shows 0. Payers pooled (the sheet has no '
     'payer split). Arm filter: AM2 (config_arm starts with it). AM4 = Yes leaves out every date on which some round '
     'counts more claims than active players (Oct 13 on the 2026-11-18 pull: 0-9 round 1, 7,075 claims / 4,761 active); '
     'No reads every date. data_ns_reach is the same pull summed over all dates and is no longer read.', ''),
    ('Streak share S(x) - MEASURED CURVE (source in AO4). PREFERRED: data_ns_streak_dist (PROMPT_ns_streak_curve.md): per '
     'date, ladder and payer, how many active players\' daily peak on the counter the round claim fires on reached at least '
     'X (players_ge_X), on exactly data_ns_per_day_reach\'s active players. S(X) = SUM players_ge_X / SUM players_active '
     'over the dates kept by AM3 / AM4, payers pooled; the curve runs through (0, 100%) and every players_ge_X point. '
     'FALLBACK until that sheet is in the workbook: data_ns_progress (share_ge_X, pooled over payers by player_days, the '
     '100+ ladder pooling 100-249 and 250+; points (0, 100%), (1, 1 - share_zero), every share_ge_X). Both: linear between '
     'points; past the last point the slope of the last two is extended log-linearly (the row says so when a round lands '
     'there). data_ns_progress behaves like data_ns_reach\'s "reached" column, ~2x the claims from 20-39 up; '
     '"reached_streak" tracks the claims, which is why the streak sheet was requested. CENSORING (AP2 = Yes): '
     'data_ns_streak_dist is read only up to the old ladder\'s final requirement F (0-9: 10, 10-19: 26, 20-39: 42, '
     '40-99: 100, 100+: 280) and past it extended log-linearly on the slope from the last point at or below F / 2 to F '
     '(40-99: S(142) ~1.8% instead of the censored 0.02%) - an assumption until the analyst delivers the counter past '
     'the final round (PROMPT_ns_streak_curve.md section 2.5).', ''),
    ('Blocks without a header row: only 0-9 keeps its "Round | ... | Cum Streak Req" row on the v2 sheets; every other '
     'block is read with that first header (the columns are shared). The engine does the same.', ''),
    ('Claim factor c - CALIBRATION. S counts player-days that REACHED x; the old column counts player-days that CLAIMED '
     'the round, on data_ns_per_day_reach\'s ladder population, for one day type. On today\'s curve they differ '
     '(C_RANGES), so the curve alone would show a large fake gain on rounds nobody changed. At every OLD round j: '
     'c_j = old_j / S(O_j). On data_ns_streak_dist c should sit near 1 (claims vs reached_streak: 0.9-1.3 today). '
     'Between old requirements c is interpolated linearly in the requirement; below the first and above the last it is held '
     'at the nearest one.', ''),
    ('THE FORMULA', 'b'),
    ('Round % (new)_k = MIN( 1 , c(X_k / D) x S(X_k / D) )', 'f'),
    ('   X_k = the round\'s Cum Streak Req on this sheet (column E)      D = Event duration, AJ4 (1 today)', 'f'),
    ('   S(x) = data_ns_progress curve, pooled payers      c(x) = interp over the old rounds of  old_j / S(O_j)', 'f'),
    ('   diff (pp) = ( Round % (new) - Round % (old) ) x 100', 'f'),
    ('In the cells: AL = MIN(1, AP x AQ); AP = S(AO / AJ4); AQ = c(AO / AJ4); AK / AN = the data_ns_per_day_reach rows of (AI, AJ) kept by AM2:AM4. '
     'AP and AQ are one LET formula each: every data column is found by its header, so a re-pull with more columns or '
     'rows (up to BZ; row 400 of data_ns_progress, row 3000 of data_ns_per_day_reach) needs no edit.', ''),
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
    ('- The engine (EcoGainsSim D107) reads data_ns_per_day_reach and data_ns_streak_dist only together: until the streak '
     'sheet is in the workbook the change summary\'s Night Sky row is priced as before (D106: data_ns_rounds / '
     'data_ns_progress). Even then it pairs rounds by NUMBER (new_k = measured_k x S(X_k) / S(O_k)) and prices a round the '
     'base does not have at S(X) without the claim factor; on the streak curve (c near 1) that is close to this table, on '
     'the data_ns_progress fallback it is ~2x and not ordered.', ''),
    ('- On the data_ns_progress fallback the curve is all-days (that sheet has day_type = all only), so the day type reaches '
     'the new column through the claim factor alone; data_ns_streak_dist is split by day type itself.', ''),
    ('- The claims are per LADDER with no payer split: Payer = NONPAYER / PAYER in the local sim changes the curve only.', ''),
    ('- A round that exists in the old ladder but was removed from this one is not listed (the table lists this sheet\'s '
     'rounds).', ''),
    ('- data_ns_progress is keyed by PLAYER segment, data_ns_per_day_reach by LADDER segment; the claim factor carries the '
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


def emu_bad_dates(perday):
    h = {str(x).strip(): i for i, x in enumerate(perday[0]) if x is not None}
    return {r[h['event_date']] for r in perday[1:] if r and r[h['ladder']] is not None
            and float(r[h['players_claimed']] or 0) > float(r[h['players_active']] or 0)}


def emu_curve_streak(stk, seg, payer, day_type, bad, arm='Variant A', fin=None):
    """S on data_ns_streak_dist (counts): SUM players_ge_X / SUM players_active over the kept rows, (0,1) first,
    linear between points, the tail extended log-linearly. None when the sheet has no active players for it."""
    h = {str(x).strip(): i for i, x in enumerate(stk[0]) if x is not None}
    ges = sorted((float(k[11:]), i) for k, i in h.items() if k.startswith('players_ge_'))
    if fin is not None:
        ges = [(x, i) for x, i in ges if x <= fin + 1e-9]           # censored past the old final round
    W, cnt = 0.0, [0.0] * len(ges)
    for r in stk[1:]:
        if not r or r[h['ladder']] is None:
            continue
        lad = str(r[h['ladder']]).strip()
        if not (lad == seg or (seg == '100+' and lad == '100-249')) or r[h['event_date']] in bad:
            continue
        if arm and 'config_arm' in h and not str(r[h['config_arm']]).startswith(arm):
            continue
        if day_type not in ('all', '') and str(r[h['day_type']]).strip() != day_type:
            continue
        if payer != 'ALL' and str(r[h['payer_flag']]).strip() != payer:
            continue
        W += float(r[h['players_active']] or 0)
        for j, (_, i) in enumerate(ges):
            cnt[j] += float(r[i] or 0)
    if W <= 0:
        return None
    xs, ss = [x for x, _ in ges], [c / W for c in cnt]
    kp = sum(1 for v in ss if v > ss[-1] + 1e-12)
    if fin is not None:
        kp1 = max([j + 1 for j in range(len(xs)) if xs[j] <= fin / 2 + 1e-9 and ss[j] > ss[-1] + 1e-12] or [0])
        kp = kp1 or kp
    lam = math.log(ss[kp - 1] / ss[-1]) / (xs[-1] - xs[kp - 1]) if ss[-1] > 0 and kp > 0 else 0

    def S(u):
        if u <= 0:
            return 1.0
        if u > xs[-1]:
            return ss[-1] * math.exp(-lam * (u - xs[-1])) if ss[-1] > 0 else 0.0
        v = 1 + (ss[0] - 1) / xs[0] * min(u, xs[0])
        for j in range(len(xs) - 1):
            v += (ss[j + 1] - ss[j]) / (xs[j + 1] - xs[j]) * max(0, min(u - xs[j], xs[j + 1] - xs[j]))
        return v
    return S


def emu_old(perday, seg, day_type, drop=True, arm='Variant A'):
    """[(round, cum_req, SUM claimed / SUM active)] for the ladder over the day type's dates, defect dates left out."""
    h = {str(x).strip(): i for i, x in enumerate(perday[0]) if x is not None}
    rows = [r for r in perday[1:] if r and r[h['ladder']] is not None
            and (not arm or 'config_arm' not in h or str(r[h['config_arm']]).startswith(arm))]
    bad = ({r[h['event_date']] for r in rows if float(r[h['players_claimed']] or 0) > float(r[h['players_active']] or 0)}
           if drop else set())
    agg = {}
    for r in rows:
        lad = str(r[h['ladder']]).strip()
        if not (lad == seg or (seg == '100+' and lad == '100-249')) or r[h['event_date']] in bad:
            continue
        if day_type not in ('all', '') and str(r[h['day_type']]).strip() != day_type:
            continue
        a = agg.setdefault(int(r[h['round']]), [0.0, 0.0, 0.0, 0])
        a[0] += float(r[h['players_active']]); a[1] += float(r[h['players_claimed']])
        a[2] += float(r[h['cum_req']]); a[3] += 1
    return [(k, a[2] / a[3], a[1] / a[0]) for k, a in sorted(agg.items()) if a[0] > 0]


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
    isnum = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)
    fr = next((q for q in range(lr + 1, lr + 4) if q < len(col_a) and isnum(col_a[q])), lr + 2)
    own = [q for q in range(lr + 1, fr) if str(col_a[q] or '').strip() == 'Round']
    hdr = ws_vals[own[0] if own else next(i for i, a in enumerate(col_a) if str(a or '').strip() == 'Round')]
    out = []
    for r in ws_vals[fr:]:
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


def emulate(vals, sheet, days=1, payer='ALL', pct='p50', day_type=None, drop=True, censor=True):
    day_type = day_type or ('weekday' if sheet.endswith('weekday') else 'weekend')
    prog, perday = sheet_rows(vals, 'data_ns_progress'), sheet_rows(vals, 'data_ns_per_day_reach')
    stk = sheet_rows(vals, ST_SHEET) if ST_SHEET in vals.sheetnames else None
    bad = emu_bad_dates(perday) if drop else set()
    lad_vals = sheet_rows(vals, sheet)
    table, sim = [], {}
    for seg in SEGS:
        fin = max([q for _, q, _ in emu_old(perday, seg, 'all', drop)] or [None]) if censor else None
        S_all = (stk and emu_curve_streak(stk, seg, 'ALL', day_type, bad, fin=fin)) or emu_curve(prog, seg)[0]
        S_pay = (stk and emu_curve_streak(stk, seg, payer, day_type, bad, fin=fin)) or emu_curve(prog, seg, payer)[0]
        old = emu_old(perday, seg, day_type, drop)
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
    c = []
    for pat in ('*LiveOps_cal_NS_completions_increase*.xlsx', '*LiveOpsCal_NS*.xlsx'):
        c += glob.glob(os.path.join(ROOT, 'workbooks', pat))
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


def c_ranges(vals, day_type):
    """'0-9 0.90-0.99, 10-19 ...': the claim factor at the old rounds per ladder, for the notes (from the emulation)."""
    prog, perday = sheet_rows(vals, 'data_ns_progress'), sheet_rows(vals, 'data_ns_per_day_reach')
    stk = sheet_rows(vals, ST_SHEET) if ST_SHEET in vals.sheetnames else None
    bad = emu_bad_dates(perday)
    out = []
    for seg in SEGS:
        fin = max([q for _, q, _ in emu_old(perday, seg, 'all')] or [None])
        S_all = (stk and emu_curve_streak(stk, seg, 'ALL', day_type, bad, fin=fin)) or emu_curve(prog, seg)[0]
        cs = [m / S_all(o) for _, o, m in emu_old(perday, seg, day_type)]
        if cs:
            out.append('%s %.2f-%.2f' % (seg, min(cs), max(cs)))
    src = ST_SHEET if (stk and emu_curve_streak(stk, SEGS[0], 'ALL', day_type, bad)) else 'data_ns_progress'
    return day_type + ' on ' + src + ': c = ' + ', '.join(out)


def write_blocks(ws, day_type, crange):
    put = lambda cell, val, kind: (ws.__setitem__(cell, val), style(ws[cell], kind))
    # ---- local sim -------------------------------------------------------------------------------------------
    put('AI1', 'LOCAL SIM - how far players get in Night Sky (' + day_type + ' ladder)', 'title')
    put('AI2', 'Percentile', 'label'); put('AJ2', 'p50', 'input')
    put('AI3', 'Payer', 'label'); put('AJ3', 'ALL', 'input')
    put('AI4', 'Event duration (days)', 'label'); put('AJ4', 1, 'input')
    put('AL2', 'Arm', 'label'); put('AM2', 'Variant A', 'input')
    put('AL3', 'Day type', 'label'); put('AM3', day_type, 'input')
    put('AL4', 'Leave out days with claims > active', 'label'); put('AM4', 'Yes', 'input')
    put('AO2', 'Stop the streak curve at the old final round', 'label'); put('AP2', 'Yes', 'input')
    put(NOTE_COL + '2', 'Rounds completed by the end of each day by a player at the AJ2 percentile (Avg = expected rounds), '
                        'and what those rounds pay (Avg = expected rewards per NS-active player-day). Same simulation as '
                        'the Round % (new) column below - the inputs are explained at ' + NOTE_COL + str(T_HDR) + '.', 'note')
    put(NOTE_COL + '3', 'Old claims: data_ns_per_day_reach for the AM3 day type.', 'note')
    put(NOTE_COL + '4', '="Streak curve S: "&IF(IFERROR(COUNTA(' + ST_SHEET + '!$A$2:$A$3000)>0,FALSE),"' + ST_SHEET + '",'
                        '"data_ns_progress (' + ST_SHEET + ' not in the workbook yet - PROMPT_ns_streak_curve.md)")', 'note')
    put('AI5', 'Day_of_event', 'header')
    for seg, c in zip(SEGS, RND_COLS):
        put(c + '5', seg + '_rounds', 'header')
        put(openpyxl.utils.get_column_letter(CI(c) + 1) + '5', seg + '_reward', 'header')
    for i, r in enumerate(DAY_ROWS):
        put('AI%d' % r, '=IF(%d<=$AJ$4,%d,"")' % (i + 1, i + 1), 'sim')
        for seg, c in zip(SEGS, RND_COLS):
            put('%s%d' % (c, r), local_sim_formula(seg, r, False), 'sim')
            put('%s%d' % (openpyxl.utils.get_column_letter(CI(c) + 1), r), local_sim_formula(seg, r, True), 'sim')
    for cell, opts in (('AJ2', '"Avg,p10,p25,p50,p75,p90,p95,p99"'), ('AJ3', '"ALL,NONPAYER,PAYER"'),
                       ('AM3', '"weekday,weekend,all"'), ('AM4', '"Yes,No"'), ('AP2', '"Yes,No"')):
        dv = DataValidation(type='list', formula1=opts, allow_blank=False)
        ws.add_data_validation(dv)
        dv.add(cell)
    dv = DataValidation(type='whole', operator='between', formula1='1', formula2=str(len(DAY_ROWS)), allow_blank=False)
    ws.add_data_validation(dv)
    dv.add('AJ4')

    # ---- completion table (rows T_HDR-2, T_HDR-1 left blank) ------------------------------------------------------
    heads = [('AI', 'Segment'), ('AJ', 'Round #'), ('AK', 'Round % (old)'), ('AL', 'Round % (new)'), ('AM', 'diff'),
             ('AN', 'Cum req (old)'), ('AO', 'Cum req (new)'), ('AP', 'Streak share S'), ('AQ', 'Claim factor c'),
             ('AR', 'How it is priced'), ('AS', 'Sheet row')]
    tips = {'AK': 'data_ns_per_day_reach for (Segment, Round #): SUM claimed / SUM active over the AM3 day type\'s dates '
                  '(AM4 = Yes: days with claims > active left out). 0 = the old ladder had no such round.',
            'AL': 'MIN(1, Progress share S x Claim factor c) - see the notes at ' + NOTE_COL + str(T_HDR) + '.',
            'AM': '(new - old) x 100, percentage points.',
            'AP': 'Share of active player-days whose daily peak streak reached Cum req (new) / AJ4, payers pooled: '
                  'data_ns_streak_dist (counts, the claim\'s counter) when the workbook has it, else data_ns_progress.',
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
        c.value = txt.replace('C_RANGES', crange)
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
        dtype = 'weekday' if name.endswith('weekday') else 'weekend'
        write_blocks(ws, dtype, c_ranges(vals, dtype))
        print('  ' + c_ranges(vals, dtype))
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
