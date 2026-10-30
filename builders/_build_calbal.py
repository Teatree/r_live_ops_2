"""Builds display/Calendar_Rebalance_v1.xlsx (2026-10-30): the configs rebalanced for LIVE_OPS_V3 (8)'s new cal_new.

The brief: NONE of the 2026-10-30 config proposals applied - only the new calendar - with Bomb's Ballet, Flock Flurry,
Hatchling, Jigsaw, Kite Festival, Target Day and Rainbow Maker rebalanced (Flock Flurry left alone on the user's call)
so every resource lands back on the difference it showed BEFORE the calendar swap; Kite ~+50% and Target Day ~+35% may
grow and the other events absorb that growth. Album, Season Pass and Team configs are not touched.

Tabs
  Summary          what changed per source, before -> after, the per-resource totals, completion per segment, caveats
  Sim per Segment  the workbook's 'Sim per Segment' layout for the rebalanced configs on the new calendar
  Changes          every changed cell: sheet, cell, LIVE_OPS_V3 (8), proposed
  <one per sheet>  the _v2 sheet from LIVE_OPS_V3 (8) with every proposed value in RED and the reasoning to the right

Pipeline (regenerate by re-running; never hand-edit the xlsx):
    node harness/_probe_calbal.js --calcur --quiet --out analysis/out/calbal_base_cur.json   # before the swap
    node harness/_probe_calbal.js --quiet --out analysis/out/calbal_base_new.json            # the swap alone
    node harness/_design_calbal.js                                                            # pass 1
    node harness/_probe_calbal.js --quiet --patches analysis/out/calbal_patches.json --out analysis/out/calbal_eval_pass1.json
    node harness/_design_calbal.js --resid analysis/out/calbal_eval_pass1.json                # pass 2
    node harness/_probe_calbal.js --quiet --patches analysis/out/calbal_patches.json --out analysis/out/calbal_eval.json
    node harness/_calbal_sps.js --bundle analysis/out/calbal_sps.json
    python builders/_build_calbal.py
"""
import argparse, copy, json, os, sys
import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter as L, column_index_from_string as CI

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _build_cfgprop import copy_sheet, red, fmt, RED, ARIAL, HDR_FILL, SIM_FILL, IN_FILL   # noqa: E402

ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'display', 'Calendar_Rebalance_v1.xlsx')
AO = os.path.join(ROOT, 'analysis', 'out')
WB = os.path.join(ROOT, 'workbooks', '\U0001F3EELIVE_OPS_V3 (8).xlsx')
SEGS = ['0-9', '10-19', '20-39', '40-99', '100+']
PAYERS = ['NONPAYER', 'PAYER']
RES13 = ['HC', 'Slingshot', 'Shuffle', 'Comet', 'Red', 'Chuck', 'Bomb', 'UL Bomb', 'UL Chuck', 'UL Red', 'Unlimited Lives', 'SPT', 'SPTx2']
PACKS = ['1-star Pack', '2-star Pack', '3-star Pack', '4-star Pack', '5-star Pack', '6-star Pack']
GROUPS = ['PAID', 'ADS', 'CORE', 'META']
ORDER = ['BB_v2', 'J_v2', 'HH_v2', 'Ki_v2', 'Ki_2d_v2', 'TaD_v2', 'RM_1st_v2', 'RM_2nd_v2', 'NS_v2', 'NS_v2_weekday']
SHEET_SOURCE = {'BB_v2': "Bomb's Ballet", 'J_v2': 'Jigsaw', 'HH_v2': 'Hatchling Hideaway', 'Ki_v2': 'Kite Festival',
                'Ki_2d_v2': 'Kite Festival', 'TaD_v2': 'Target Day', 'RM_1st_v2': 'Rainbow Maker', 'RM_2nd_v2': 'Rainbow Maker',
                'NS_v2': 'Daily Night Sky Prize', 'NS_v2_weekday': 'Daily Night Sky Prize'}
HDR_MAP = {'Coins': 'HC', 'HC Reward': 'HC', 'SPT': 'SPT', 'SPT x2': 'SPTx2', 'Red': 'Red', 'Chuck': 'Chuck', 'Bomb': 'Bomb',
           'Slingshot': 'Slingshot', 'Shuffle': 'Shuffle', 'Comet': 'Comet', 'Unlimited Lives': 'Unlimited Lives',
           'Unlimited Red': 'UL Red', 'Unlimited Chuck': 'UL Chuck', 'Unlimited Bomb': 'UL Bomb',
           '1-star Dly': '1-star Pack', '2-star Dly': '2-star Pack', '3-star Dly': '3-star Pack', '4-star Dly': '4-star Pack',
           '5-star Dly': '5-star Pack', '6-star Dly': '6-star Pack', 'ToF_Ticket': 'ToF_Ticket'}
SHORT = {'Unlimited Lives': 'UL min', 'UL Red': 'UL Red min', 'UL Chuck': 'UL Chuck min', 'UL Bomb': 'UL Bomb min',
         'SPTx2': 'SPTx2 min', 'HC': 'coins', 'ToF_Ticket': 'ToF tickets'}
for p in PACKS:
    SHORT[p] = p.replace(' Pack', ' env.')
# reward block of each sheet: (header row, first row, last row) 1-based, as the engine reads them (LB/COLL specs)
LADDER = {'BB_v2': (8, 9, 24), 'J_v2': (10, 11, 22), 'HH_v2': (11, 12, 16), 'Ki_v2': (26, 27, 86), 'Ki_2d_v2': (26, 27, 86),
          'TaD_v2': (35, 36, 55), 'RM_1st_v2': (15, 16, 45), 'RM_2nd_v2': (15, 16, 45)}


def load(name):
    return json.load(open(os.path.join(AO, name), encoding='utf-8'))


def pct(x, d=1):
    return ('%+.' + str(d) + 'f%%') % (100 * x)


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def patched_values(dump, P, sheet):
    v = [list(r) for r in dump[sheet]['values']]
    for p in P['patches'].get(sheet, []):
        col = CI(''.join(ch for ch in p['cell'] if ch.isalpha()))
        row = int(''.join(ch for ch in p['cell'] if ch.isdigit()))
        while len(v) < row:
            v.append([])
        while len(v[row - 1]) < col:
            v[row - 1].append('')
        v[row - 1][col - 1] = p['new']
    return v


def ladder_sums(values, sheet):
    h, r0, r1 = LADDER[sheet]
    hdr = values[h - 1]
    cols = {}
    for c, x in enumerate(hdr):
        k = HDR_MAP.get(str(x).strip())
        if k and k not in cols:
            cols[k] = c
    out = {}
    for r in range(r0, r1 + 1):
        row = values[r - 1] if r - 1 < len(values) else []
        if not row or str(row[0]).strip() in ('', 'None'):
            continue
        for k, c in cols.items():
            out[k] = out.get(k, 0) + num(row[c] if c < len(row) else 0)
    if sheet in ('Ki_v2', 'Ki_2d_v2'):        # the score milestone (leaderboard unlock): row 23
        row = values[22]
        hdr2 = values[21]
        for c, x in enumerate(hdr2):
            k = HDR_MAP.get(str(x).strip())
            if k:
                out[k] = out.get(k, 0) + num(row[c] if c < len(row) else 0)
    return out


def sums_text(a, b):
    keys = [k for k in ['HC', 'SPT', 'SPTx2', 'Unlimited Lives', 'UL Red', 'UL Chuck', 'UL Bomb', 'Red', 'Chuck', 'Bomb', 'Slingshot',
                        'Shuffle', 'Comet'] + PACKS + ['ToF_Ticket'] if a.get(k, 0) or b.get(k, 0)]
    return ', '.join('%s %g -> %g' % (SHORT.get(k, k), a.get(k, 0), b.get(k, 0)) for k in keys if a.get(k, 0) != b.get(k, 0))


def lane_pooled(S, cat, side, res, payer=None):
    tot, w = 0.0, 0.0
    for lab, x in S['lanes'].items():
        if payer and not lab.endswith(payer):
            continue
        tot += x['pop'] * num(x[side][cat].get(res, 0))
        w += x['pop']
    return tot / w if w else 0.0


def lane_value(S, cat, side):
    iv = S['itemVals']
    return sum(lane_pooled(S, cat, side, r) * iv.get(r, 0) for r in RES13)


def sim_per_segment(wb, S):
    ws = wb.create_sheet('Sim per Segment')
    ws.sheet_view.showGridLines = False
    F = lambda **k: Font(name=ARIAL, **k)
    BAND = PatternFill('solid', fgColor='FF305496')
    OVR = PatternFill('solid', fgColor='FFDDEBF7')
    ws.cell(row=1, column=2, value='RESOURCE GAINS - rebalanced configs on the new cal_new (per player, 28-day window)').font = F(bold=True, size=13)
    ws.cell(row=2, column=2, value='Same layout as the workbook\'s Sim per Segment: CURRENT = the measured side, SIMULATED = the engine '
            '(D81) with the configs of this file on LIVE_OPS_V3 (8)\'s cal_new. The two right-hand columns compare the Total delta '
            'with the one BEFORE the calendar swap (cal_new := cal_curr, configs as in (8)), and show it with the two collection '
            'rows held at their before-swap values (album / set completions in the card sim are noisy - see Summary).').font = F(italic=True, size=9)
    ws.merge_cells(start_row=2, start_column=2, end_row=2, end_column=22)
    ws.row_dimensions[2].height = 36
    r = 4
    blocks = [('VALUE', '◆ OVERALL VALUE (13 resources x item_vals row 3)')] + [(x, '◆ ' + x) for x in RES13] + \
             [(x, '◆ ' + x) for x in PACKS[:5] + ['ToF_Ticket']]
    for key, title in blocks:
        ws.cell(row=r, column=2, value=title).font = F(bold=True, size=11)
        r += 1
        for c, t in [(3, '◄ CURRENT ►'), (9, '◄ SIMULATED ►'), (15, 'Δ'), (21, 'Total Δ% before swap'),
                     (22, 'Total Δ% collection rows held')]:
            ws.cell(row=r, column=c, value=t).font = F(bold=True, size=9)
        r += 1
        hdr = ['Segment'] + GROUPS + ['Total', ''] + GROUPS + ['Total', ''] + GROUPS + ['Total Δ %', '', 'before', 'held']
        for i, h in enumerate(hdr):
            c = ws.cell(row=r, column=2 + i, value=h)
            c.font = F(bold=True, size=9)
            if h:
                c.fill = HDR_FILL
        r += 1
        for payer in PAYERS:
            c = ws.cell(row=r, column=2, value=payer)
            c.font = Font(name=ARIAL, bold=True, color='FFFFFFFF')
            c.fill = BAND
            r += 1
            for seg in SEGS + ['overall']:
                e = S['after'][key][payer][seg]
                b = S['before'][key][payer][seg]
                h = S['afterHeld'][key][payer][seg]
                ws.cell(row=r, column=2, value=seg).font = F(bold=(seg == 'overall'))
                for i, g in enumerate(GROUPS + ['Total']):
                    ws.cell(row=r, column=3 + i, value=round(e['cur'][g], 2))
                    ws.cell(row=r, column=9 + i, value=round(e['sim'][g], 2)).fill = SIM_FILL
                    d = (e['sim'][g] - e['cur'][g]) / e['cur'][g] if abs(e['cur'][g]) > 1e-9 else None
                    c = ws.cell(row=r, column=15 + i, value=(round(d, 4) if d is not None else ''))
                    c.number_format = '0.0%'
                db = (b['sim']['Total'] - b['cur']['Total']) / b['cur']['Total'] if abs(b['cur']['Total']) > 1e-9 else None
                dh = (h['sim']['Total'] - h['cur']['Total']) / h['cur']['Total'] if abs(h['cur']['Total']) > 1e-9 else None
                for col, d in ((21, db), (22, dh)):
                    c = ws.cell(row=r, column=col, value=(round(d, 4) if d is not None else ''))
                    c.number_format = '0.0%'
                    c.font = F(italic=True, size=9)
                if seg == 'overall':
                    for col in range(2, 23):
                        ws.cell(row=r, column=col).fill = OVR
                for col in range(3, 20):
                    ws.cell(row=r, column=col).number_format = ws.cell(row=r, column=col).number_format if col >= 15 else '0.00'
                r += 1
        r += 2
    ws.column_dimensions['A'].width = 2
    ws.column_dimensions['B'].width = 11
    for col in range(3, 23):
        ws.column_dimensions[L(col)].width = 9
    ws.column_dimensions['U'].width = 11
    ws.column_dimensions['V'].width = 11
    return ws


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workbook', default=WB)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    P = load('calbal_patches.json')
    S = load('calbal_sps.json')
    dump = json.load(open(os.path.join(ROOT, 'harness', '_mockdata_v3h.json'), encoding='utf-8'))
    print('reading', a.workbook)
    src = openpyxl.load_workbook(a.workbook, data_only=True)
    F = lambda **k: Font(name=ARIAL, **k)
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    # ------------------------------------------------------------------------------------------- per-sheet facts
    sums = {}
    for sh in LADDER:
        sums[sh] = (ladder_sums(dump[sh]['values'], sh), ladder_sums(patched_values(dump, P, sh), sh))
    def lane_line(cat):
        b, s, n = lane_value(S, cat, 'ref'), lane_value(S, cat, 'swap'), lane_value(S, cat, 'after')
        return b, s, n
    comp = P['completion']
    def comp_text(cat):
        return '; '.join('%s %.0f%% -> %.0f%%' % (x['seg'], 100 * x['fracBefore'], 100 * x['fracAfter']) for x in comp[cat])
    def done_text(cat):
        return '; '.join('%s %.1f%% -> %.1f%%' % (x['seg'], 100 * x['doneBefore'], 100 * x['doneAfter']) for x in comp[cat] if x['doneBefore'] or x['doneAfter'])
    def lane_res(cat, res):
        return lane_pooled(S, cat, 'ref', res), lane_pooled(S, cat, 'swap', res), lane_pooled(S, cat, 'after', res)
    def res_line(cat, keys):
        out = []
        for k in keys:
            b, s, n = lane_res(cat, k)
            if max(b, s, n) < 0.005:
                continue
            out.append('%s %.2f / %.2f / %.2f' % (SHORT.get(k, k), b, s, n))
        return ', '.join(out)
    al = P['alpha']
    rq = P['reqs']

    reasons = {}
    b_, s_, n_ = lane_line("Bomb's Ballet")
    reasons['BB_v2'] = [
        'CALENDAR: 2 shows of 3 days -> 4 shows of 2 days (days 3, 10, 17, 24). The shorter show (EventDuration 2) was already on this sheet.',
        'EASIER: the price ladder %s -> %s. Set milestone by milestone so each segment reaches each milestone about as often in 2 days as it '
        'did in 3: in 2 days players collect 70-78%% of the tokens of a 3-day show (accrual curves), the 100+ segment most of them.' %
        (','.join('%g' % x for x in rq['BB_v2']['before']), ','.join('%g' % x for x in rq['BB_v2']['after'])),
        'Share of the ladder reached per segment (before -> after): ' + comp_text("Bomb's Ballet") + '. Full completion: ' + done_text("Bomb's Ballet") + '.',
        'FEWER REWARDS per show, because there are twice as many shows. Whole ladder (completion reward included): ' + sums_text(*sums['BB_v2']) + '.',
        'Over the season Bomb\'s Ballet pays (per player, before swap / swap with old configs / rebalanced): value %.0f / %.0f / %.0f; %s. '
        'It gives up about %.0f%% of its coins and %.0f%% of its Unlimited Lives on top of standing still, which pays for the growth '
        'of Kite Festival and Target Day.' % (b_, s_, n_, res_line("Bomb's Ballet", ['HC', 'Unlimited Lives', 'UL Red', 'UL Bomb', 'Chuck', 'ToF_Ticket']),
                                                 100 * al['HC'], 100 * al['Unlimited Lives']),
        'Single boosters / envelopes / tickets were removed or moved to a later milestone (never doubled up on one milestone); every milestone still pays something.',
    ]
    b_, s_, n_ = lane_line('Jigsaw')
    reasons['J_v2'] = [
        'CALENDAR: 2 puzzles of 3 days -> 4 puzzles of 2 days (days 1, 8, 15, 22). EventDuration 2 was already on this sheet.',
        'EASIER: cumulative tokens %s -> %s. The early milestones drop most (low segments collect ~70%% of their 3-day tokens in 2 days); '
        'the last two barely move because only 100+ reach them and 100+ collect all their tokens within 2 days anyway.' %
        (','.join('%g' % x for x in rq['J_v2']['before']), ','.join('%g' % x for x in rq['J_v2']['after'])),
        'Share of the ladder reached per segment: ' + comp_text('Jigsaw') + '. Full completion: ' + done_text('Jigsaw') + '.',
        'FEWER REWARDS per puzzle (twice as many puzzles). Whole ladder: ' + sums_text(*sums['J_v2']) + '.',
        'Season per player (before swap / swap only / rebalanced): value %.0f / %.0f / %.0f; %s.' % (b_, s_, n_, res_line('Jigsaw', ['HC', 'Unlimited Lives', 'UL Red', 'UL Chuck', 'UL Bomb', 'ToF_Ticket'])),
        'So the distribution stays the same: each segment completes the same share of a puzzle, and the season total is what it was (less the share given up for Kite / Target Day).',
    ]
    b_, s_, n_ = lane_line('Hatchling Hideaway')
    reasons['HH_v2'] = [
        'CALENDAR: 4 instances of 4 days -> 4 instances of 3 days. Same count, one day shorter.',
        'EASIER: boards (tiles per gate, Y12:Y16 and the helper copy AV5:AV9) %s -> %s. The cumulative token requirement (AW5:AW9, a sheet '
        'formula) follows: %s -> %s. Gates 4-5 keep their size: only 40+ reach them, and 40+ collect all their tokens within 3 days.' %
        (','.join('%g' % x for x in rq['HH_v2']['before']), ','.join('%g' % x for x in rq['HH_v2']['after']),
         ','.join('%g' % x for x in rq['HH_v2']['cumBefore']), ','.join('%g' % round(x, 2) for x in rq['HH_v2']['cumAfter'])),
        'Share of the ladder reached per segment: ' + comp_text('Hatchling Hideaway') + '. Full completion: ' + done_text('Hatchling Hideaway') + '.',
        'HIGHER REWARDS per instance (a day shorter, same count): ' + sums_text(*sums['HH_v2']) + '. The early gates go up most (the segments that '
        'lose a day reach only those); two coin entries at the top gates come down a little because 40+ lose nothing from the shorter event.',
        'Season per player (before swap / swap only / rebalanced): value %.0f / %.0f / %.0f; %s. Hatchling is NOT an absorber: it is brought back to where it was.' %
        (b_, s_, n_, res_line('Hatchling Hideaway', ['HC', 'Unlimited Lives', 'UL Red', 'UL Chuck', 'UL Bomb', 'ToF_Ticket'])),
        'AW5:AW9 are formulas in the workbook (=SUM($AV$5:AV5)/$AV$2): paste Y12:Y16 and AV5:AV9 only; AW is shown with its new value for reference.',
    ]
    b_, s_, n_ = lane_line('Kite Festival')
    kite_lines = [
        'CALENDAR: 4 festivals of 3 days -> 4 of 3 days PLUS 4 of 2 days (the 2-day ones read Ki_2d_v2). Eight festivals instead of four.',
        'Season per player (before swap / swap with old configs / rebalanced): value %.0f / %.0f / %.0f (%+.0f%% vs before the swap; target ~+50%%). %s.' %
        (b_, s_, n_, 100 * (n_ / b_ - 1) if b_ else 0, res_line('Kite Festival', ['HC', 'Unlimited Lives', 'SPT'] + PACKS[:2])),
        'Kite\'s SPT is NOT on these sheets (the live event pays it; the ladders say 0): the engine carries it x the calendar, +90%, whatever the configs say.',
    ]
    reasons['Ki_v2'] = ['3-DAY FESTIVAL: the rank coins trimmed ~6%% (rank 1-5: %s); one 1-star envelope dropped at the end of its band (rank 25).' %
                        ', '.join('%g -> %g' % (p['old'], p['new']) for p in P['patches']['Ki_v2'] if p['cell'].startswith('C'))] + kite_lines
    reasons['Ki_2d_v2'] = ['2-DAY FESTIVAL: pays about 60%% of the 3-day festival - coins rank 1-5 %s; the leaderboard-unlock milestone (row 23) 30 -> 20 '
                           'minutes of Unlimited Lives; boosters and envelopes trimmed from the END of each band (worse ranks lose them first).' %
                           ', '.join('%g -> %g' % (p['old'], p['new']) for p in P['patches']['Ki_2d_v2'] if p['cell'].startswith('C'))] + \
                          ['Whole ladder per league: ' + sums_text(*sums['Ki_2d_v2']) + '.'] + kite_lines
    b_, s_, n_ = lane_line('Target Day')
    reasons['TaD_v2'] = [
        'CALENDAR: 11 Target Days -> 19 (1-day each).',
        'Rank coins 100 / 50 / 25 -> 80 / 40 / 15; the 3-star envelope at rank 3, the 2-star at rank 6 and the Red at rank 10 are dropped '
        '(band ends). Whole ladder: ' + sums_text(*sums['TaD_v2']) + '.',
        'Season per player (before swap / swap only / rebalanced): value %.0f / %.0f / %.0f (%+.0f%%). %s. Coins from the leaderboard: +35%% (target).' %
        (b_, s_, n_, 100 * (n_ / b_ - 1) if b_ else 0, res_line('Target Day', ['HC', 'Unlimited Lives', 'Red'] + PACKS[1:5])),
        'Target Day\'s Unlimited Lives (and its Chuck) are NOT on this sheet - the live event pays them, the milestone ladder here is all zeros - '
        'so the engine carries them x the calendar: +73% (+49 minutes per player) whatever this sheet says. The other events absorb that.',
    ]
    b_, s_, n_ = lane_line('Rainbow Maker')
    rmr = rq['RM_1st_v2']
    rm_common = [
        'CALENDAR: 4 instances of 4 days -> 8 of 2 days (the one starting on day 0 is a cut-off). Days 1-14 read RM_1st_v2, days 15-28 RM_2nd_v2.',
        'FEWER MILESTONES: 30 -> 25. Rows 41-45 are CLEARED (columns A..Z; the helper block to the right is untouched): the engine reads the ladder '
        'down to the first empty cell in column A. Use the new local sim block (display/RM_LocalSim_v1.xlsx) - it counts the milestones the same way.',
        'EASIER: Req Accum %s (30) -> %s (25). Each new milestone sits where the matching point of the old ladder was (milestone j at old position '
        '1.2 x j), scaled to what each segment collects by the end of day 2 of the measured 4-day event (live matchables: 40-52%% of the 4-day '
        'total), milestone by milestone, segments weighted equally.' % (', '.join('%g' % x for x in rmr['before'][:3]) + ' ... ' + '%g' % rmr['before'][-1],
                                                                         ', '.join('%g' % x for x in rmr['after'][:3]) + ' ... ' + '%g' % rmr['after'][-1]),
        'Share of the ladder reached per segment (4-day/30 -> 2-day/25): ' + comp_text('Rainbow Maker') + '. Full completion: ' + done_text('Rainbow Maker') +
        '. 100+ reaches less: a quarter of 100+ participants have barely started by the end of day 2 (late joiners), which no requirement can give back.',
        'REWARDS: each old milestone\'s rewards moved to the new milestone it maps to (two old ones merge every sixth), then scaled down for twice the '
        'instances. Whole ladder per instance: ' + sums_text(*sums['RM_1st_v2']) + '.',
        'Season per player (before swap / swap with old configs / rebalanced): value %.0f / %.0f / %.0f; %s. Rainbow Maker stays the biggest event '
        'payout; it gives up ~%.0f%% of its coins and ~%.0f%% of its Unlimited Lives for Kite / Target Day, and takes Kite\'s extra SPT (SPT %.0f -> %.0f).' %
        (b_, s_, n_, res_line('Rainbow Maker', ['HC', 'Unlimited Lives', 'SPTx2', 'ToF_Ticket'] + PACKS[:5]), 100 * al['HC'], 100 * al['Unlimited Lives'],
         lane_res('Rainbow Maker', 'SPT')[0], lane_res('Rainbow Maker', 'SPT')[2]),
    ]
    reasons['RM_1st_v2'] = rm_common
    reasons['RM_2nd_v2'] = rm_common + ['RM_2nd keeps its SPT x2 (buff minutes) on two milestones (7 and 16, 10 minutes each) - the 2-day second-half instances '
                                        'run three times instead of twice. Shared coins / SPT / minutes are identical to RM_1st_v2; single items (boosters, '
                                        'envelopes, tickets) may sit on a different milestone on each half.',
                                        'Whole ladder per instance: ' + sums_text(*sums['RM_2nd_v2']) + '.']
    b_, s_, n_ = lane_line('Daily Night Sky Prize')
    ns_lines = [
        'CALENDAR: unchanged (every day). Night Sky is the ABSORBER of last resort for coins and Unlimited Lives: it runs per segment, so it is where '
        'each segment gives back what Kite Festival and Target Day add to it.',
        'Round-1 Unlimited Lives 20 -> 15 minutes (40-99: 30 -> 15, 100+: 60 -> 45); round coins trimmed per segment (0-9 round 3 up 15 -> 20 to keep 0-9 whole). '
        'Weekday and weekend get the same edits wherever they had the same reward.',
        'Season per player (before swap / swap only / rebalanced): value %.0f / %.0f / %.0f; %s.' % (b_, s_, n_, res_line('Daily Night Sky Prize', ['HC', 'Unlimited Lives'] + PACKS[:4])),
        'Why so much Unlimited Lives: Target Day\'s carried UL (+49 min) and Kite\'s unlock UL add ~%.0f minutes per player; the four absorbers each give up '
        '%.0f%% of their own UL. If you trust that Flock Flurry\'s 25%% fewer joins also cost ~48 minutes (the engine does not see it), you can keep '
        'Night Sky\'s round-1 UL at 20 and still land close in reality.' % (al['Unlimited Lives'] * (lane_pooled(S, "Bomb's Ballet", 'ref', 'Unlimited Lives') + lane_pooled(S, 'Jigsaw', 'ref', 'Unlimited Lives') + lane_pooled(S, 'Rainbow Maker', 'ref', 'Unlimited Lives') + lane_pooled(S, 'Daily Night Sky Prize', 'ref', 'Unlimited Lives')), 100 * al['Unlimited Lives']),
    ]
    reasons['NS_v2'] = ['WEEKEND ladder (Fri/Sat/Sun).'] + ns_lines
    reasons['NS_v2_weekday'] = ['WEEKDAY ladder (Mon-Thu).'] + ns_lines

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
    put(r, 1, 'Calendar rebalance - configs for the new cal_new, nothing else', bold=True, size=14); r += 1
    put(r, 1, 'On top of the _v2 sheets of LIVE_OPS_V3 (8) with NONE of the 2026-10-30 config proposals. Judged by the engine (EcoGainsSim_v4.gs D81) on '
              '(8)\'s cal_new, 28-day window, measured side = Variant A. Target: every resource back on the difference it showed BEFORE the calendar '
              'swap (cal_new := cal_curr, same configs); Kite Festival may grow ~+50% and Target Day ~+35%, the other events absorb it.', italic=True, wrap=True)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=12); ws.row_dimensions[r].height = 42; r += 2
    put(r, 1, 'HOW TO APPLY', bold=True); r += 1
    for line in ['Re-paste engine/EcoGainsSim_v4.gs first (D80 + D81). D81 changes how a shorter collection event is priced (players\' tokens shrink, '
                 'the rewards are not cut); without it Bomb\'s Ballet, Jigsaw and Hatchling read differently. D80 fixes Hatchling\'s requirement axis on V3.',
                 'Every red cell on a sheet tab is a proposed value - paste it into the same cell of the workbook (the Changes tab lists all of them). '
                 'Cells filled light red on RM_1st_v2 / RM_2nd_v2 rows 41-45 are to be CLEARED (25 milestones).',
                 'HH_v2: paste Y12:Y16 and AV5:AV9; AW5:AW9 are formulas and follow.',
                 'Paste the new Rainbow Maker local sim block (display/RM_LocalSim_v1.xlsx, AI1:AS13) into all four RM sheets.',
                 'Then Precompute calendars and Fill all sims; Sim per Segment should read as the tab of the same name here (same seeds, same inputs).']:
        put(r, 1, '- ' + line, wrap=True); ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=12); ws.row_dimensions[r].height = 30; r += 1
    r += 1
    put(r, 1, 'PER SOURCE - season gain per player (all payers, population-weighted)', bold=True); r += 1
    hdr = ['Source', 'Calendar change', 'Value before swap', 'Swap, old configs', 'Rebalanced', 'vs before', 'Coins before -> after', 'UL min before -> after',
           'SPT before -> after', 'Envelopes before -> after']
    for i, h in enumerate(hdr):
        put(r, 1 + i, h, bold=True, fill=HDR_FILL, wrap=True)
    ws.row_dimensions[r].height = 30; r += 1
    cal = {"Bomb's Ballet": '2 x 3d -> 4 x 2d', 'Jigsaw': '2 x 3d -> 4 x 2d', 'Hatchling Hideaway': '4 x 4d -> 4 x 3d',
           'Kite Festival': '4 x 3d -> 4 x 3d + 4 x 2d', 'Target Day': '11 -> 19 (1d)', 'Rainbow Maker': '4 x 4d -> 8 x 2d, 30 -> 25 milestones',
           'Daily Night Sky Prize': 'unchanged (absorber)', 'Flock Flurry': '16 -> 12 (1d), NOT touched'}
    for cat in ["Bomb's Ballet", 'Jigsaw', 'Hatchling Hideaway', 'Kite Festival', 'Target Day', 'Rainbow Maker', 'Daily Night Sky Prize', 'Flock Flurry']:
        b, s, n = lane_line(cat)
        env = lambda side: sum(lane_pooled(S, cat, side, p) for p in PACKS)
        vals = [cat, cal[cat], round(b, 1), round(s, 1), round(n, 1), (n / b - 1) if b else '',
                '%.1f -> %.1f' % (lane_res(cat, 'HC')[0], lane_res(cat, 'HC')[2]),
                '%.1f -> %.1f' % (lane_res(cat, 'Unlimited Lives')[0], lane_res(cat, 'Unlimited Lives')[2]),
                '%.1f -> %.1f' % (lane_res(cat, 'SPT')[0], lane_res(cat, 'SPT')[2]),
                '%.2f -> %.2f' % (env('ref'), env('after'))]
        for i, v in enumerate(vals):
            c = put(r, 1 + i, v, fill=SIM_FILL if i >= 2 else None)
            if i == 5:
                c.number_format = '+0%;-0%'
        r += 1
    put(r, 1, 'Value = the 13 Sim-per-Segment resources x item_vals row 3 (envelopes not included). Flock Flurry: the engine carries it, so the '
              'value moves only through its envelopes; see caveats.', italic=True, wrap=True, size=9)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=10); ws.row_dimensions[r].height = 26; r += 2

    put(r, 1, 'EVERY RESOURCE - Total delta vs current, overall rows (the brief: rebalanced = before swap)', bold=True); r += 1
    hdr = ['Resource', 'NONPAYER before swap', 'swap only', 'rebalanced', 'rebalanced, coll. rows held', 'PAYER before swap', 'swap only', 'rebalanced',
           'rebalanced, coll. rows held']
    for i, h in enumerate(hdr):
        put(r, 1 + i, h, bold=True, fill=HDR_FILL, wrap=True)
    ws.row_dimensions[r].height = 30; r += 1
    def tot_d(side, res, payer):
        e = S[side][res][payer]['overall']
        return (e['sim']['Total'] - e['cur']['Total']) / e['cur']['Total'] if abs(e['cur']['Total']) > 1e-9 else ''
    for res in ['VALUE'] + RES13 + PACKS[:5] + ['ToF_Ticket']:
        vals = [res if res != 'VALUE' else 'OVERALL VALUE']
        for payer in PAYERS:
            vals += [tot_d('before', res, payer), tot_d('swap', res, payer), tot_d('after', res, payer), tot_d('afterHeld', res, payer)]
        for i, v in enumerate(vals):
            c = put(r, 1 + i, v, bold=(res == 'VALUE'), fill=SIM_FILL if i in (3, 4, 7, 8) else None)
            if i:
                c.number_format = '+0.0%;-0.0%'
        r += 1
    r += 1
    put(r, 1, 'COMPLETION PER SEGMENT - share of the ladder reached in one instance (before = the old event as it ran, after = the new event)', bold=True); r += 1
    for cat in ["Bomb's Ballet", 'Jigsaw', 'Hatchling Hideaway', 'Rainbow Maker']:
        put(r, 1, cat, bold=True)
        for i, x in enumerate(comp[cat]):
            put(r, 2 + i, '%s: %.0f%% -> %.0f%%' % (x['seg'], 100 * x['fracBefore'], 100 * x['fracAfter']), fill=SIM_FILL)
        r += 1
        put(r, 1, '  full completion', italic=True)
        for i, x in enumerate(comp[cat]):
            put(r, 2 + i, '%.1f%% -> %.1f%%' % (100 * x['doneBefore'], 100 * x['doneAfter']), italic=True)
        r += 1
    r += 1
    put(r, 1, 'CAVEATS', bold=True); r += 1
    held = lambda res, payer: (S['after'][res][payer]['overall']['sim']['Total'] - S['afterHeld'][res][payer]['overall']['sim']['Total'])
    cav = [
        'Target Day\'s Unlimited Lives and Chuck, and Kite Festival\'s SPT, are not on their config sheets (the live events pay them; the sheets say 0). '
        'The engine carries them x the calendar: +73% and +90% whatever the configs say. They are absorbed by Night Sky, Rainbow Maker, Bomb\'s Ballet and Jigsaw.',
        'Flock Flurry is left alone (your call) and the engine carries it, so its 16 -> 12 joins (-25% of its ~194-minute Unlimited Lives join grant, about '
        '-48 minutes per player) are NOT in these numbers. In the game Unlimited Lives would land ~3% below what the sheet shows - roughly the size of '
        'Target Day\'s carried +49. Keeping Night Sky round-1 UL at 20 would offset it.',
        'Col - Sets / Col - Albums are the card sim\'s set / album completions over 50 seeded seasons per cell; a handful of album completions swing a cell '
        '(100+ NONPAYER album coins: 61 before the swap, 206 on the swap alone). They were not chased: overall coins +%.1f (NONPAYER) / +%.1f (PAYER) per '
        'player come from these two rows here. The "collection rows held" columns show the totals without that noise.' % (held('HC', 'NONPAYER'), held('HC', 'PAYER')),
        'One ladder serves both payer types and all five segments, so per-segment rows move a little even where the overall row is exact: the biggest are UL Bomb '
        '(10-19 NONPAYER -15%, 100+ +33%), SPT x2 at 100+ (-25%: late joiners in a 2-day Rainbow Maker) and Chuck at 0-9 (+4% vs +8%). Overall Unlimited Red '
        'lands at -5% (NONPAYER) against -2% before the swap.',
        'Season Pass, ToF and the collection rows are not configured here; they move only through the SPT / ticket / envelope income above (SPT is kept at its '
        'before-swap level so 0-9 NONPAYER stays on its Season Pass tier).',
        'Engine assumptions carried over: Kite opt-in 0.35 for the pack lane (D25); Rainbow Maker priced on the live matchables (D77); the D81 pace model for '
        'collection events; measured anchor = Variant A (16 days of (8)\'s export scaled to the window).',
    ]
    for line in cav:
        put(r, 1, '- ' + line, wrap=True); ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=12); ws.row_dimensions[r].height = 44; r += 1
    for i, w in enumerate([24, 26, 13, 13, 13, 10, 18, 18, 18, 20, 14, 14]):
        ws.column_dimensions[L(i + 1)].width = w

    sim_per_segment(wb, S)

    # ------------------------------------------------------------------------------------------- Changes
    wc = wb.create_sheet('Changes')
    wc.sheet_view.showGridLines = False
    for i, h in enumerate(['Sheet', 'Cell', 'LIVE_OPS_V3 (8)', 'Proposed', 'Note']):
        c = wc.cell(row=1, column=1 + i, value=h)
        c.font = F(bold=True); c.fill = HDR_FILL
    rr = 2
    hh_formula = set(rq['HH_v2'].get('formulaCells', []))
    for name in ORDER:
        for p in P['patches'].get(name, []):
            note = ''
            if name == 'HH_v2' and p['cell'] in hh_formula:
                note = 'formula in the workbook - recalculates, do not paste'
            elif p['new'] == '' or p['new'] is None:
                note = 'clear (25 milestones)'
            vals = [name, p['cell'], fmt(p['old']), fmt(p['new']) if p['new'] != '' else '(clear)', note]
            for i, v in enumerate(vals):
                c = wc.cell(row=rr, column=1 + i, value=v)
                c.font = Font(name=ARIAL, color=RED if i == 3 else None, bold=(i == 3))
            rr += 1
    for k, w in zip('ABCDE', [16, 8, 16, 16, 44]):
        wc.column_dimensions[k].width = w

    # ------------------------------------------------------------------------------------------- one tab per sheet
    CLEAR = PatternFill('solid', fgColor='FFF4CCCC')
    for name in ORDER:
        if name not in P['patches']:
            continue
        ws = wb.create_sheet(name)
        copy_sheet(src[name], ws)
        for p in P['patches'][name]:
            c = ws[p['cell']]
            if p['new'] == '' or p['new'] is None:
                c.value = None
                c.fill = CLEAR
                continue
            c.value = fmt(p['new'])
            if name == 'HH_v2' and p['cell'] in hh_formula:
                c.font = Font(name=ARIAL, italic=True, color='FF7F7F7F')      # formula cell: new value for reference only
            else:
                red(c)
        col = src[name].max_column + 2
        h = ws.cell(row=1, column=col, value='WHY THESE CHANGES (calendar rebalance 2026-10-30) - red cells are the proposed values')
        h.font = Font(name=ARIAL, bold=True, color='FF1F4E79', size=11)
        for i, line in enumerate(reasons.get(name, [])):
            c = ws.cell(row=2 + i, column=col, value='- ' + line)
            c.font = Font(name=ARIAL, size=10)
            c.alignment = Alignment(wrap_text=True, vertical='top')
            c.fill = IN_FILL
            ws.row_dimensions[2 + i].height = max(ws.row_dimensions[2 + i].height or 15, 15 * (1 + len(line) // 95))
        ws.column_dimensions[L(col)].width = 110
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)
    print('written', a.out, '-', len(wb.sheetnames), 'tabs:', ', '.join(wb.sheetnames))
    print('changed cells:', sum(len(v) for v in P['patches'].values()))


if __name__ == '__main__':
    main()
