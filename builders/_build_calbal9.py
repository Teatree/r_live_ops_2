"""Builds display/Calendar_Rebalance_v2.xlsx (2026-11-02): the LIVE_OPS_V3 (9) re-fit.

(9) carries the 2026-11-01 rebalance (display/Calendar_Rebalance_v1.xlsx) as the user applied it - with their own edits
(Target Day as authored, the weekday Night Sky untouched, a new weekend Night Sky envelope pattern, the BB / Jigsaw tickets
kept, Kite's rank-25 1-star and the unlock UL kept, Hatchling requirements unchanged and milestones 4 / 5 at 20 / 30 coins)
and a re-run Precompute. The target stays variant - control ~0 within ~1.5% per resource (5-star envelopes excepted, user
decision 2026-11-01). This re-fit keeps every one of those edits (user decision 2026-11-02) and moves only the other cells.

Tabs
  Summary          how to apply, what was missing or wrong in (9), the result per resource, per source, caveats
  Sim per Segment  the workbook's 'Sim per Segment' layout for (9) + this re-fit on (9)'s cal_new
  Changes          every changed cell: sheet, cell, what it means, LIVE_OPS_V3 (9), proposed
  Held             the cells the re-fit was not allowed to touch (your edits)
  <one per sheet>  the sheet from LIVE_OPS_V3 (9) with every proposed value in RED and the reasoning to the right

Pipeline (regenerate by re-running; never hand-edit the xlsx):
    node harness/_probe_calbal.js --data v3i --quiet --out analysis/out/v3i_eval.json            # (9) as applied
    node harness/_design_calbal.js --data v3i --ref analysis/out/v3i_eval.json --keep-reqs \\
         --lock analysis/out/calbal9_locks.json --out analysis/out/calbal9_patches_p1.json        # pass 1
    node harness/_probe_calbal.js --data v3i --quiet --patches analysis/out/calbal9_patches_p1.json --out analysis/out/calbal9_eval_pass1.json
    node harness/_design_calbal.js --data v3i --ref analysis/out/v3i_eval.json --keep-reqs \\
         --lock analysis/out/calbal9_locks.json --resid analysis/out/calbal9_eval_pass1.json --out analysis/out/calbal9_patches.json
    node harness/_probe_calbal.js --data v3i --quiet --patches analysis/out/calbal9_patches.json --out analysis/out/calbal9_eval.json
    node harness/_calbal_sps.js --bundle analysis/out/calbal9_sps.json --before v3i_eval.json --swap v3i_eval.json \\
         --after calbal9_eval.json --dump _mockdata_v3i.json --held-at-control
    python builders/_build_calbal9.py
"""
import argparse, json, os, re, sys
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter as L, column_index_from_string as CI

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _build_cfgprop import copy_sheet, red, fmt, RED, ARIAL, HDR_FILL, SIM_FILL, IN_FILL   # noqa: E402
from _build_calbal import (SEGS, PAYERS, RES13, PACKS, GROUPS, HDR_MAP, SHORT, LADDER, num, patched_values,  # noqa: E402
                           ladder_sums, sums_text)

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'display', 'Calendar_Rebalance_v2.xlsx')
AO = os.path.join(ROOT, 'analysis', 'out')
WB = os.path.join(ROOT, 'workbooks', '\U0001F3EELIVE_OPS_V3 (9).xlsx')
DUMP = os.path.join(ROOT, 'harness', '_mockdata_v3i.json')
ORDER = ['BB_v2', 'J_v2', 'HH_v2', 'Ki_v2', 'Ki_2d_v2', 'RM_1st_v2', 'RM_2nd_v2', 'NS_v2']
SOURCE = {'BB_v2': "Bomb's Ballet", 'J_v2': 'Jigsaw', 'HH_v2': 'Hatchling Hideaway', 'Ki_v2': 'Kite Festival', 'Ki_2d_v2': 'Kite Festival',
          'RM_1st_v2': 'Rainbow Maker', 'RM_2nd_v2': 'Rainbow Maker', 'NS_v2': 'Daily Night Sky Prize'}
# item_vals row 3 - the change summary's valuation (user decision 2026-11-02): every resource, envelopes priced, tickets at ToF_Value
ALLRES = RES13 + PACKS[:5] + ['ToF_Ticket']
LANES = ["Bomb's Ballet", 'Jigsaw', 'Hatchling Hideaway', 'Kite Festival', 'Target Day', 'Rainbow Maker', 'Daily Night Sky Prize',
         'Flock Flurry', 'Red Challenge', 'Chuck Challenge', 'Season Pass (Free)', 'Season Pass (Paid)', 'ToF', 'Core', 'Col - Sets', 'Col - Albums']


def load(name):
    return json.load(open(os.path.join(AO, name), encoding='utf-8'))


def item_vals(dump):
    v = dump['item_vals']['values']
    out = {}
    for c, h in enumerate(v[1]):
        h = str(h).strip()
        k = 'ToF_Ticket' if h == 'ToF_Value' else HDR_MAP.get(h, h)
        out[k] = num(v[2][c] if c < len(v[2]) else 0)
    return out


def pooled(J, side, cat, res, payer=None, no_col=False):
    t, w = 0.0, 0.0
    for lab, x in J['cells'].items():
        if payer and lab.split(' ')[1] != payer:
            continue
        w += x['pop']
        if cat is None:
            t += x['pop'] * sum(num(x[side][c].get(res, 0)) for c in x[side] if not (no_col and c.startswith('Col - ')))
        else:
            t += x['pop'] * num(x[side][cat].get(res, 0))
    return t / w if w else 0.0


def cell_label(dump, sheet, cell):
    """What a cell means, in words: '<event> milestone 4, coins'."""
    col = CI(''.join(ch for ch in cell if ch.isalpha())) - 1
    row = int(''.join(ch for ch in cell if ch.isdigit())) - 1
    v = dump[sheet]['values']
    if sheet == 'NS_v2':
        seg = next((str(v[k][0]).strip() for k in range(row, -1, -1) if str(v[k][0]).strip() in SEGS), '?')
        hdr = next((v[k] for k in range(row, -1, -1) if str(v[k][0]).strip() == 'Round'), [])
        name = str(hdr[col]).strip() if col < len(hdr) else '?'
        return 'weekend Night Sky %s, round %s, %s' % (seg, fmt(v[row][0]), name)
    h = (LADDER.get(sheet) or (1, 1, 1))[0] - 1
    hdr = v[h] if h < len(v) else []
    name = str(hdr[col]).strip() if col < len(hdr) else '?'
    if sheet in ('Ki_v2', 'Ki_2d_v2'):
        days = '3-day' if sheet == 'Ki_v2' else '2-day'
        if row == 22:
            return 'Kite %s, leaderboard-unlock milestone, %s' % (days, str(v[21][col]).strip())
        return 'Kite %s, rank %s, %s' % (days, fmt(v[row][0]) or row - 25, name)
    if sheet.startswith('RM_'):
        return 'Rainbow Maker %s half, milestone %s, %s' % ('1st' if '1st' in sheet else '2nd', fmt(v[row][0]), name)
    if sheet == 'HH_v2':
        return 'Hatchling gate %d, %s' % (row - 10, name)
    if sheet == 'BB_v2':
        lab = str(v[row][0]).strip()
        return "Bomb's Ballet %s, %s" % ('completion reward' if 'ompletion' in lab else 'milestone %s' % fmt(v[row][0]), name)
    if sheet == 'J_v2':
        return 'Jigsaw milestone %s, %s' % (fmt(v[row][0]), name)
    return '%s %s' % (sheet, cell)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workbook', default=WB)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    P = load('calbal9_patches.json')
    S = load('calbal9_sps.json')
    E9, EF = load('v3i_eval.json'), load('calbal9_eval.json')
    LOCKS = load('calbal9_locks.json')
    dump = json.load(open(DUMP, encoding='utf-8'))
    IV = item_vals(dump)
    print('reading', a.workbook)
    src = openpyxl.load_workbook(a.workbook, data_only=True)
    F = lambda **k: Font(name=ARIAL, **k)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    def value(J, side, cat, payer=None, res_list=ALLRES, no_col=False):
        return sum(pooled(J, side, cat, r, payer, no_col) * IV.get(r, 0) for r in res_list)

    def d(J, res, payer=None, no_col=False, res_list=None):
        if res_list:
            c, s = value(J, 'meas', None, payer, res_list, no_col), value(J, 'sim', None, payer, res_list, no_col)
        else:
            c, s = pooled(J, 'meas', None, res, payer, no_col), pooled(J, 'sim', None, res, payer, no_col)
        return (s - c) / c if abs(c) > 1e-9 else ''

    # ------------------------------------------------------------------------------------------- Summary
    ws = wb.create_sheet('Summary')
    ws.sheet_view.showGridLines = False
    r = 1

    def put(row, col, v, bold=False, fill=None, wrap=False, size=None, italic=False, nf=None, color=None):
        c = ws.cell(row=row, column=col, value=v)
        c.font = Font(name=ARIAL, bold=bold, size=size or 10, italic=italic, color=color)
        if fill:
            c.fill = fill
        if wrap:
            c.alignment = Alignment(wrap_text=True, vertical='top')
        if nf:
            c.number_format = nf
        return c

    def para(text, h=30, bold=False, italic=False):
        nonlocal r
        put(r, 1, text, wrap=True, bold=bold, italic=italic)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=12)
        ws.row_dimensions[r].height = h
        r += 1

    put(r, 1, 'Calendar rebalance v2 - LIVE_OPS_V3 (9) re-fitted around your edits', bold=True, size=14); r += 1
    para('Starting point: LIVE_OPS_V3 (9) exactly as you set it up - Calendar_Rebalance_v1 with your own edits and a re-run Precompute. Target, as '
         'before: variant (new calendar + configs) - control (current calendar and configs) as close to 0 as possible, within ~1.5% for every '
         'resource, 5-star envelopes excepted. Every one of your edits is HELD (tab Held); only the other cells move. Judged by the engine '
         '(EcoGainsSim_v4.gs D84) on (9)\'s cal_new, 28-day window, current side = Variant A.', 44, italic=True)
    r += 1
    put(r, 1, 'HOW TO APPLY', bold=True); r += 1
    for line in ['Re-paste engine/EcoGainsSim_v4.gs (D84 - one fix, see below) and add engine/ChangeSummary.gs as a new script file (menu: EcoGainsSim > '
                 'Fill change summary; it writes the change_summary sheet, created if missing). The project then has twelve .gs files.',
                 'Paste every red cell into the same cell of (9) (the Changes tab lists all %d). No requirement changes, no rows added or cleared.' %
                 sum(len(v) for v in P['patches'].values()),
                 'Then Fill all sims (it is stale now - see below) and Fill change summary. Sim per Segment should read as the tab of the same name here.']:
        para('- ' + line, 30)
    r += 1

    # what was missing or wrong
    put(r, 1, 'WHAT WAS MISSING OR WRONG IN (9)', bold=True); r += 1
    findings = [
        'THE FILLED SHEETS ARE STALE. Fill all sims ran BEFORE your last edits: EcoGainsSim / Sim per Segment still show the BB and Jigsaw tickets '
        'and Target Day\'s 3-star / 2-star / Red removed, Target Day rank 3 at 15 coins and Hatchling milestones 4 / 5 at 25 / 25 coins. 72 cells of '
        'EcoGainsSim differ from what today\'s configs give; the other 2,628 match the engine exactly. Re-run Fill all sims.',
        'THE RE-RUN PRECOMPUTE CHANGED THE BALANCE - correctly. (8)\'s cal_parsed was stale: it had no column AI (day 28) and Chuck\'s Challenge '
        'where cal_curr shows Red\'s. My v1 configs were measured on that stale view. With the fresh one: a 1-day Rainbow Maker on day 28 '
        '(RM_2nd, so SPT x2 +14 points, SPT +1.2, 1-star +5); two cells climb a Season Pass tier (0-9 PAYER, 20-39 NONPAYER: payer coins +2 points); '
        'and Red\'s Challenge halves (cal_curr runs it 4 times in the window, cal_new twice: -12.6 coins per player). This re-fit absorbs all of it.',
        'CAL_CURR\'S CHALLENGE ROWS DISAGREE WITH THE DATA - please check. The export shows Red\'s Challenge payouts on Oct 21 and Oct 23 (cal_curr: '
        'days 1 and 3, correct) and a Chuck\'s Challenge payout on Oct 28 - but cal_curr has Bomb\'s Challenge on days 8-9 (Oct 26-27), no Chuck\'s '
        'at all in the window, and the data has no Bomb\'s Challenge payout anywhere (data_event_inst has no Bomb rows either). If day 8 is really '
        'Chuck\'s, the engine would price Chuck\'s Challenge x2 on the new calendar (it carries it now) and the Red\'s loss is mostly offset (+56 coin-eq '
        'per player at item_vals row 3, 12 of them coins). The re-fit uses cal_curr as it is.',
        'NS_v2_weekday: none of the 15 cells of v1 applied (Unlimited Lives 20 -> 15 and coin trims). Held as your choice: weekdays keep today\'s ladder.',
        'NS_v2 (weekend): a NEW envelope pattern, not from v1 (round 1 a 1-star, round 2 a 2-star, round 3 a 4-star in most segments - the weekday '
        'layout). Held. It is the main reason envelopes are off: 1-star +23 points, 2-star +13-17, 3-star -15-21, 4-star +11-14.',
        'Bomb\'s Ballet / Jigsaw: the 4 tickets v1 removed are back (tickets +8 points). Held - the whole ticket column of both sheets.',
        'Target Day: rank-3 coins 20 (v1: 15) and the 3-star, 2-star and Red v1 dropped are back (Red +1.4 points, 3-star +5-7, 2-star +3-4). '
        'Held - the whole sheet.',
        'Kite: the rank-25 1-star and the 2-day unlock reward (30 minutes) are back. Held - and the 3-day unlock too, so the two match.',
        'Hatchling: requirements unchanged (your note) and milestones 4 / 5 at 20 / 30 coins (v1: 25 / 25). Held. Unchanged requirements cost '
        'nothing in the engine - and that exposed an engine bug (D84, fixed): with a base helper on HH, v1\'s easier boards were never priced. '
        '(9) has no base helper, so its numbers were always right.',
        'Rainbow Maker local sim block (display/RM_LocalSim_v1.xlsx) not pasted: the four RM sheets still carry the old \'Player Reach Simulation - '
        'SIMULATED\' block, which reads data_RM (1.3-2.6x the milestones players actually claim). Display only - the engine does not read it.',
        'Not mine, changed since (8): AlbumConfig, AlbumConfig_v2 and CardPoolConfig (the card sim reads them - see the album caveat), and the '
        'RM_2nd_v2 chest flags in column D (not read by the engine).',
    ]
    for line in findings:
        para('- ' + line, 44)
    r += 1

    # result per resource
    put(r, 1, 'EVERY RESOURCE - variant vs control, overall rows (target ~0, within ~1.5%)', bold=True); r += 1
    hdr = ['Resource', 'NONPAYER (9) as applied', 're-fit', 're-fit, coll. rows held', 'PAYER (9) as applied', 're-fit',
           're-fit, coll. rows held', 'ALL (9)', 'ALL re-fit']
    for i, h in enumerate(hdr):
        put(r, 1 + i, h, bold=True, fill=HDR_FILL, wrap=True)
    ws.row_dimensions[r].height = 30; r += 1
    rows = [('VALUE, 13 basics (Sim per Segment)', None, RES13), ('VALUE, every resource at item_vals row 3', None, ALLRES)] + \
           [(x, x, None) for x in ALLRES]
    for name, res, rl in rows:
        vals = [name]
        for payer in PAYERS:
            vals += [d(E9, res, payer, res_list=rl), d(EF, res, payer, res_list=rl), d(EF, res, payer, True, res_list=rl)]
        vals += [d(E9, res, None, res_list=rl), d(EF, res, None, res_list=rl)]
        for i, v in enumerate(vals):
            c = put(r, 1 + i, v, bold=name.startswith('VALUE'), fill=SIM_FILL if i in (2, 3, 5, 6, 8) else None)
            if i:
                c.number_format = '+0.0%;-0.0%'
            if i in (2, 5) and isinstance(v, float) and abs(v) > 0.015 and res != '5-star Pack':
                c.font = Font(name=ARIAL, bold=True, color=RED)
        r += 1
    para('"coll. rows held": Col - Sets / Col - Albums at their control values. Those two rows are the card sim\'s set and album completions, which '
         'the configs here do not set (album configs are out of scope) - see the album caveat. Red = outside 1.5% on the re-fit.', 30, italic=True)
    r += 1

    # per source
    put(r, 1, 'PER SOURCE - season gain per player, all payers (value = every resource at item_vals row 3, as change_summary)', bold=True); r += 1
    hdr = ['Source', 'Value control', 'Value (9)', 'Value re-fit', 're-fit vs control', 'Coins ctrl / (9) / re-fit', 'UL min ctrl / (9) / re-fit',
           'SPT ctrl / (9) / re-fit', 'Envelopes ctrl / (9) / re-fit', 'Tickets ctrl / (9) / re-fit']
    for i, h in enumerate(hdr):
        put(r, 1 + i, h, bold=True, fill=HDR_FILL, wrap=True)
    ws.row_dimensions[r].height = 30; r += 1
    for cat in LANES:
        c0, c9, cf = value(EF, 'meas', cat), value(E9, 'sim', cat), value(EF, 'sim', cat)
        tri = lambda res, k=1: '%.1f / %.1f / %.1f' % (pooled(EF, 'meas', cat, res) * k, pooled(E9, 'sim', cat, res) * k, pooled(EF, 'sim', cat, res) * k)
        env = lambda J, side: sum(pooled(J, side, cat, p) for p in PACKS[:5])
        vals = [cat, round(c0, 1), round(c9, 1), round(cf, 1), (cf / c0 - 1) if c0 else '', tri('HC'), tri('Unlimited Lives'), tri('SPT'),
                '%.2f / %.2f / %.2f' % (env(EF, 'meas'), env(E9, 'sim'), env(EF, 'sim')),
                '%.2f / %.2f / %.2f' % (pooled(EF, 'meas', cat, 'ToF_Ticket'), pooled(E9, 'sim', cat, 'ToF_Ticket'), pooled(EF, 'sim', cat, 'ToF_Ticket'))]
        for i, v in enumerate(vals):
            c = put(r, 1 + i, v, fill=SIM_FILL if i in (3, 4) else None)
            if i == 4:
                c.number_format = '+0%;-0%'
        r += 1
    r += 1

    # caveats
    put(r, 1, 'CAVEATS', bold=True); r += 1
    def dd(res, payer):
        x = d(EF, res, payer)
        return 100 * x if x != '' else 0
    cav = [
        'ENVELOPES 1-, 2- AND 4-STAR STAY OUTSIDE THE BAND (non-payers / payers: 1-star %+.0f%% / %+.0f%%, 2-star %+.0f%% / %+.0f%%, 4-star %+.0f%% / %+.0f%%). '
        'They come from cells you set and the re-fit holds - the weekend Night Sky pattern, the untouched weekday Night Sky and Target Day - and the '
        'free envelope cells left are few: every 1-star on Rainbow Maker is a milestone\'s only reward, Jigsaw has no 2-star left after this re-fit, and '
        'Hatchling (your "higher rewards") is not cut. Bringing them inside 1.5%% means changing the weekend Night Sky pattern back (v1\'s weekend '
        'cells, measured: 1-star -23, 2-star -13-17, 4-star -11-14 points) or letting me remove those envelopes from Rainbow Maker / Hatchling.' %
        (dd('1-star Pack', 'NONPAYER'), dd('1-star Pack', 'PAYER'), dd('2-star Pack', 'NONPAYER'), dd('2-star Pack', 'PAYER'),
         dd('4-star Pack', 'NONPAYER'), dd('4-star Pack', 'PAYER')),
        '5-STAR ENVELOPES +%.0f%% / +%.0f%%, by your choice (Target Day\'s rank-1 5-star on 20 days instead of 12). At item_vals row 3 an envelope is '
        'worth 24.5 to 399.5 coins, so the envelope tiers are what move the all-resource VALUE line: it reads %+.1f%% (all players) against %+.1f%% '
        'for the 13 basics.' % (dd('5-star Pack', 'NONPAYER'), dd('5-star Pack', 'PAYER'), 100 * d(EF, None, res_list=ALLRES), 100 * d(EF, None, res_list=RES13)),
        'ALBUM COINS: the card sim completes far more albums at 40-99 and 100+ (40-99 PAYER: 26 -> 316 album coins per player over 50 seeded seasons). '
        'More 5-star envelopes and the 3-stars the re-fit restores supply the rare cards albums are gated on. That is what puts overall coins at '
        '%+.1f%% / %+.1f%%; without the two collection rows coins are %+.1f%% / %+.1f%%.' %
        (100 * d(EF, 'HC', 'NONPAYER'), 100 * d(EF, 'HC', 'PAYER'), 100 * d(EF, 'HC', 'NONPAYER', True), 100 * d(EF, 'HC', 'PAYER', True)),
        'TICKETS -0.9% overall, but regressive: 0-9 gets ~10% fewer and 10-19 ~6% fewer (the weekend Night Sky round-1 ticket moves to round 2 there, or goes), '
        '20-39 and up ~15% more (the BB / Jigsaw tickets you kept are reached mostly by higher segments). The weekend Night Sky was the only place a '
        'ticket could come back from: every Rainbow Maker ticket is a milestone\'s only reward.',
        'THE WEEKEND NIGHT SKY ABSORBS MOST UNLIMITED LIVES: round 1 goes to 7-10 minutes (35 at 100+) against 20 on weekdays, because the weekday sheet '
        'is held. If that gap reads badly, release the weekday sheet and both days share the cut (v1 had both at 15).',
        'Season Pass tiers: every cell lands on its control tier (in (9) two cells had climbed one). SPT is held per cell, as in v1.',
        'Per-segment rows swing more than the overall rows on the small resources (e.g. UL Bomb 100+ NONPAYER +22%, 10-19 NONPAYER -13%) - one ladder '
        'serves all ten cells. See Sim per Segment.',
        'Unchanged from v1: Flock Flurry left alone (its 16 -> 12 joins cost ~48 Unlimited Lives minutes per player the engine cannot see); Target '
        'Day\'s Unlimited Lives / Chuck and Kite\'s SPT are not on their sheets and scale with the calendar; Kite opt-in 0.35 for envelopes (D25).',
    ]
    for line in cav:
        para('- ' + line, 46)
    for i, w in enumerate([30, 15, 13, 13, 15, 13, 13, 15, 13, 16, 14, 14]):
        ws.column_dimensions[L(i + 1)].width = w

    # ------------------------------------------------------------------------------------------- Sim per Segment
    wsp = wb.create_sheet('Sim per Segment')
    wsp.sheet_view.showGridLines = False
    BAND = PatternFill('solid', fgColor='FF305496')
    OVR = PatternFill('solid', fgColor='FFDDEBF7')
    wsp.cell(row=1, column=2, value='RESOURCE GAINS - the re-fit on (9)\'s cal_new (per earner, 28-day window)').font = F(bold=True, size=13)
    wsp.cell(row=2, column=2, value='Same layout as the workbook\'s Sim per Segment: CURRENT = the measured side, SIMULATED = the engine (D84) with (9) + '
             'the red cells of this file. Target: Total delta ~0 on every row. The two right-hand columns: (9) as applied, and the re-fit with the two '
             'collection rows held at control.').font = F(italic=True, size=9)
    wsp.merge_cells(start_row=2, start_column=2, end_row=2, end_column=22)
    wsp.row_dimensions[2].height = 30
    rr = 4
    blocks = [('VALUE', '◆ OVERALL VALUE (13 resources x item_vals row 3)')] + [(x, '◆ ' + x) for x in RES13] + [(x, '◆ ' + x) for x in PACKS[:5] + ['ToF_Ticket']]
    for key, title in blocks:
        wsp.cell(row=rr, column=2, value=title).font = F(bold=True, size=11); rr += 1
        for c, t in [(3, '◄ CURRENT ►'), (9, '◄ SIMULATED ►'), (15, 'Δ'), (21, 'Total Δ% (9) as applied'), (22, 'Total Δ% coll. rows held')]:
            wsp.cell(row=rr, column=c, value=t).font = F(bold=True, size=9)
        rr += 1
        hdr = ['Segment'] + GROUPS + ['Total', ''] + GROUPS + ['Total', ''] + GROUPS + ['Total Δ %', '', '(9)', 'held']
        for i, h in enumerate(hdr):
            c = wsp.cell(row=rr, column=2 + i, value=h)
            c.font = F(bold=True, size=9)
            if h:
                c.fill = HDR_FILL
        rr += 1
        for payer in PAYERS:
            c = wsp.cell(row=rr, column=2, value=payer)
            c.font = Font(name=ARIAL, bold=True, color='FFFFFFFF'); c.fill = BAND
            rr += 1
            for seg in SEGS + ['overall']:
                e, b, h = S['after'][key][payer][seg], S['swap'][key][payer][seg], S['afterHeld'][key][payer][seg]
                wsp.cell(row=rr, column=2, value=seg).font = F(bold=(seg == 'overall'))
                for i, g in enumerate(GROUPS + ['Total']):
                    wsp.cell(row=rr, column=3 + i, value=round(e['cur'][g], 2)).number_format = '0.00'
                    c = wsp.cell(row=rr, column=9 + i, value=round(e['sim'][g], 2)); c.fill = SIM_FILL; c.number_format = '0.00'
                    dlt = (e['sim'][g] - e['cur'][g]) / e['cur'][g] if abs(e['cur'][g]) > 1e-9 else None
                    c = wsp.cell(row=rr, column=15 + i, value=(round(dlt, 4) if dlt is not None else '')); c.number_format = '0.0%'
                for col, x in ((21, b), (22, h)):
                    dlt = (x['sim']['Total'] - x['cur']['Total']) / x['cur']['Total'] if abs(x['cur']['Total']) > 1e-9 else None
                    c = wsp.cell(row=rr, column=col, value=(round(dlt, 4) if dlt is not None else '')); c.number_format = '0.0%'
                    c.font = F(italic=True, size=9)
                if seg == 'overall':
                    for col in range(2, 23):
                        wsp.cell(row=rr, column=col).fill = OVR
                rr += 1
        rr += 2
    wsp.column_dimensions['A'].width = 2
    wsp.column_dimensions['B'].width = 11
    for col in range(3, 23):
        wsp.column_dimensions[L(col)].width = 9
    wsp.column_dimensions['U'].width = 12
    wsp.column_dimensions['V'].width = 12

    # ------------------------------------------------------------------------------------------- Changes
    wc = wb.create_sheet('Changes')
    wc.sheet_view.showGridLines = False
    for i, h in enumerate(['Sheet', 'Cell', 'What it is', 'LIVE_OPS_V3 (9)', 'Proposed']):
        c = wc.cell(row=1, column=1 + i, value=h); c.font = F(bold=True); c.fill = HDR_FILL
    rr = 2
    for name in ORDER:
        for p in P['patches'].get(name, []):
            vals = [name, p['cell'], cell_label(dump, name, p['cell']), fmt(p['old']), fmt(p['new'])]
            for i, v in enumerate(vals):
                c = wc.cell(row=rr, column=1 + i, value=v)
                c.font = Font(name=ARIAL, color=RED if i == 4 else None, bold=(i == 4))
            rr += 1
    for k, w in zip('ABCDE', [12, 7, 58, 15, 12]):
        wc.column_dimensions[k].width = w

    # ------------------------------------------------------------------------------------------- Held
    wh = wb.create_sheet('Held')
    wh.sheet_view.showGridLines = False
    wh.cell(row=1, column=1, value='Cells the re-fit did not touch - your edits in (9), held as they are (user decision 2026-11-02)').font = F(bold=True, size=12)
    words = {'TaD_v2': 'Target Day - the whole sheet (as authored: rank-3 coins 20, the 3-star / 2-star / Red kept)',
             'NS_v2_weekday': 'weekday Night Sky - the whole sheet (today\'s weekday ladder)',
             'NS_v2': 'weekend Night Sky - the envelope columns W:AB (your new pattern); coins, lives and tickets are free',
             'BB_v2': "Bomb's Ballet - the ToF ticket column X", 'J_v2': 'Jigsaw - the ToF ticket column X',
             'Ki_v2': 'Kite 3-day - R51 (rank-25 1-star) and L23 (unlock-milestone Unlimited Lives, held at 30 to match the 2-day sheet)',
             'Ki_2d_v2': 'Kite 2-day - L23 (unlock-milestone Unlimited Lives 30)', 'HH_v2': 'Hatchling - B15 / B16 (milestones 4 / 5: 20 / 30 coins) and every envelope, Q:V (you asked Hatchling for higher rewards, so it never absorbs envelopes)'}
    rr = 3
    for sh, what in LOCKS.items():
        if sh.startswith('_'):
            continue
        wh.cell(row=rr, column=1, value=sh).font = F(bold=True)
        wh.cell(row=rr, column=2, value=words.get(sh, str(what))).font = F()
        rr += 1
    wh.cell(row=rr + 1, column=1, value='Requirements: none changed anywhere (Hatchling per your note; BB / Jigsaw / Rainbow Maker keep v1\'s).').font = F(italic=True)
    wh.column_dimensions['A'].width = 16
    wh.column_dimensions['B'].width = 110

    # ------------------------------------------------------------------------------------------- one tab per sheet
    sums = {sh: (ladder_sums(dump[sh]['values'], sh), ladder_sums(patched_values(dump, P, sh), sh)) for sh in ORDER if sh in LADDER}
    for name in ORDER:
        if name not in P['patches']:
            continue
        wsx = wb.create_sheet(name)
        copy_sheet(src[name], wsx)
        for p in P['patches'][name]:
            c = wsx[p['cell']]
            c.value = fmt(p['new'])
            red(c)
        cat = SOURCE[name]
        lines = ['%s: %s.' % (cell_label(dump, name, p['cell']), '%s -> %s' % (fmt(p['old']), fmt(p['new']))) for p in P['patches'][name]]
        if name in sums:
            lines.append('Whole ladder: ' + sums_text(*sums[name]) + '.')
        lines.append('Season per player, all payers (control / (9) / re-fit): value %.0f / %.0f / %.0f at item_vals row 3; coins %.1f / %.1f / %.1f; '
                     'Unlimited Lives %.0f / %.0f / %.0f min; envelopes %.2f / %.2f / %.2f; tickets %.2f / %.2f / %.2f.' %
                     (value(EF, 'meas', cat), value(E9, 'sim', cat), value(EF, 'sim', cat),
                      pooled(EF, 'meas', cat, 'HC'), pooled(E9, 'sim', cat, 'HC'), pooled(EF, 'sim', cat, 'HC'),
                      pooled(EF, 'meas', cat, 'Unlimited Lives'), pooled(E9, 'sim', cat, 'Unlimited Lives'), pooled(EF, 'sim', cat, 'Unlimited Lives'),
                      sum(pooled(EF, 'meas', cat, x) for x in PACKS[:5]), sum(pooled(E9, 'sim', cat, x) for x in PACKS[:5]),
                      sum(pooled(EF, 'sim', cat, x) for x in PACKS[:5]),
                      pooled(EF, 'meas', cat, 'ToF_Ticket'), pooled(E9, 'sim', cat, 'ToF_Ticket'), pooled(EF, 'sim', cat, 'ToF_Ticket')))
        if name in LOCKS:
            lines.append('Held (your edits): ' + words.get(name, str(LOCKS[name])) + '.')
        col = src[name].max_column + 2
        h = wsx.cell(row=1, column=col, value='WHY THESE CHANGES (re-fit of (9), 2026-11-02) - red cells are the proposed values')
        h.font = Font(name=ARIAL, bold=True, color='FF1F4E79', size=11)
        for i, line in enumerate(lines):
            c = wsx.cell(row=2 + i, column=col, value='- ' + line)
            c.font = Font(name=ARIAL, size=10)
            c.alignment = Alignment(wrap_text=True, vertical='top')
            c.fill = IN_FILL
            wsx.row_dimensions[2 + i].height = max(wsx.row_dimensions[2 + i].height or 15, 15 * (1 + len(line) // 95))
        wsx.column_dimensions[L(col)].width = 110
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)
    print('written', a.out, '-', len(wb.sheetnames), 'tabs:', ', '.join(wb.sheetnames))
    print('changed cells:', sum(len(v) for v in P['patches'].values()))


if __name__ == '__main__':
    main()
