"""Builds display/Mic_v2.xlsx (2026-11-11): the config sheet of MIGHTY ICE CREAM, a new leaderboard event, from the
live server config in builders/mic_server_config.json. One tab, 'Mic_v2' (the _v2 suffix = a redesign-side sheet;
there is no base 'Mic' - the event does not run on cal_curr, so the engine reads Mic_v2 on both sides).

Layout = one block of the 'Race' sheet (builders/_build_race.py), so the engine's leaderboard readers take it as is:
    A1          title
    row 3       'Mighty Ice Cream - Config Panel' bar
    rows 4-6    numberOfPositions 25 / LBSize 60 (= leagueGroupSize) / EventDuration 2
    row 8       'Mighty Ice Cream - Goals and Rewards' bar
    row 9       header  Position | Coins | SPT | SPT x2 | Red .. 6-star Dly | ToF_Ticket   (Race_v2's 23 columns, A..W)
    rows 10-34  places 1..25
    row 36+     'Simulation inputs': Places from (Red), Participation (0.3, design value), the bird challenge length,
                Bomb birds as a share of Chuck's
    row 42+     'Player behaviour (Wager)' (D103): per segment x payer - Submit after (wins), Red / Chuck / Bomb birds
                per win, Opponent weight; every cell a FORMULA holding the measured default, overwritable by typing a
                number (the engine reads what the cell holds and computes the same default when it is blank)
    then        the server config fields the sim does not read, and the item mapping
    AI1         the LOCAL SIM: =ECOGAINS_MIC(payer) - per segment the bank chance, the place p25 / p50 / p75 out of
                60, the chance of a paid place and the payout per festival entered; it re-runs on any edit here

Engine wiring (EcoGainsSim_v4.gs LB_R_SPECS['Mighty Ice Cream']): hdr row 9 -> 0-based 8, ladder rows 10..34 -> 9..33,
columns B..W -> 1..22. Change any of those here and the spec must move with it (harness/_mock_mic.js gates it).

Item mapping (the one approved for the Race sheets 2026-07-10, builders/_build_race.py): HardCoin -> Coins,
SeasonPassToken -> SPT, CherryBomb -> Comet, Hammer -> Slingshot, Pre-Red/Chuck/Bomb -> Red/Chuck/Bomb, Shuffle -> Shuffle.
An item with no mapping stops the build (it would otherwise be priced as nothing).

    python builders/_build_mic.py
"""
import json, os, sys
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.formula import ArrayFormula
from openpyxl.utils import get_column_letter as L

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'mic_server_config.json')
OUT = os.path.join(ROOT, 'display', 'Mic_v2.xlsx')

NAME, SHEET = 'Mighty Ice Cream', 'Mic_v2'
PLACES_FROM = 'Red'               # data_event_inst event whose measured places Mighty Ice Cream borrows (user, 2026-11-11)
DURATION = 2                      # days, as Red's Challenge (the calendar's merge decides the length anyway)
PARTICIPATION = 0.3               # DESIGN VALUE (user, 2026-11-11) - to be replaced
BIRD_LEN = 2                      # days of the Red's / Chuck's Challenge the bird balances were measured on
BOMB_SHARE = 0.5                  # Bomb birds per win = this x Chuck's (user, 2026-11-11: no Bomb rows)
COLS = ['Position', 'Coins', 'SPT', 'SPT x2', 'Red', 'Chuck', 'Bomb', 'Slingshot', 'Shuffle', 'Comet',
        'Unlimited Lives', 'Unlimited Red', 'Unlimited Chuck', 'Unlimited Bomb', 'COOP Token', 'Avatar',
        '1-star Dly', '2-star Dly', '3-star Dly', '4-star Dly', '5-star Dly', '6-star Dly', 'ToF_Ticket']
ITEM_MAP = {'HardCoin': 'Coins', 'Coin': 'Coins', 'SeasonPassToken': 'SPT', 'CherryBomb': 'Comet',
            'ShootingStar': 'Comet', 'Hammer': 'Slingshot', 'Shuffle': 'Shuffle', 'Pre-Red': 'Red',
            'Pre-Chuck': 'Chuck', 'Pre-Bomb': 'Bomb'}
SEGMENTS = ['0-9', '10-19', '20-39', '40-99', '100-249', '250+', 'ALL']

HDR_ROW, LAD0 = 9, 10            # 1-based
LS = 35                          # local sim first column (AI), as on Race_v2 / Ki_v2

F_BAR, F_LBL, F_VAL, F_HDR, F_SIM, F_INP = 'FF000000', 'FFFFD966', 'FFFFF2CC', 'FFF7CB4D', 'FFE2EFDA', 'FFFFF2CC'
fill = lambda rgb: PatternFill('solid', fgColor=rgb)
thin = Side(style='thin')
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
AR = lambda sz=11, **k: Font(name='Arial', size=sz, **k)


def ladder_from(cfg):
    rows = []
    for i, rung in enumerate(cfg['rewards'], 1):
        rew = {}
        for it in rung:
            col = ITEM_MAP.get(it['item'])
            if not col:
                sys.exit(f"place {i}: item '{it['item']}' has no mapping to a sheet column - add it to ITEM_MAP")
            rew[col] = rew.get(col, 0) + it['amount']
        rows.append(rew)
    return rows


def main():
    cfg = json.load(open(SRC, encoding='utf-8'))
    lad = ladder_from(cfg)
    npos, lb = len(lad), int(cfg['leagueGroupSize'])
    last = LAD0 + npos - 1                               # 34
    ncol = len(COLS)                                     # 23 -> A..W
    lastc = L(ncol)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = SHEET
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 24
    for c in range(2, ncol + 1):
        ws.column_dimensions[L(c)].width = 9.5

    def bar(r, text, c0=1, c1=ncol):
        for c in range(c0, c1 + 1):
            ws.cell(r, c).fill = fill(F_BAR)
        ws.cell(r, c0, text).font = AR(bold=True, color='FFFFFFFF')

    def label(r, text, val, note=None, c=1):
        a = ws.cell(r, c, text); a.font = AR(bold=True); a.fill = fill(F_LBL)
        b = ws.cell(r, c + 1, val); b.font = AR(); b.fill = fill(F_VAL); b.alignment = Alignment(horizontal='center')
        if note:
            ws.cell(r, c + 2, note).font = AR(9, color='FF808080')

    ws['A1'] = NAME
    ws['A1'].font = AR(14, bold=True)
    bar(3, f'{NAME} - Config Panel')
    label(4, 'numberOfPositions', npos, 'places that pay (rewards[] in the server config)')
    label(5, 'LBSize', lb, 'players per league (leagueGroupSize) - the engine spreads finishes over 1..LBSize')
    label(6, 'EventDuration', DURATION, 'days; the calendar merge decides the length the sim uses')
    bar(8, f'{NAME} - Goals and Rewards')
    for c, h in enumerate(COLS, 1):
        x = ws.cell(HDR_ROW, c, h); x.font = AR(bold=True); x.fill = fill(F_HDR); x.border = BORDER
        x.alignment = Alignment(horizontal='center', wrap_text=True)
    for i, rew in enumerate(lad):
        r = LAD0 + i
        for c, h in enumerate(COLS, 1):
            v = (i + 1) if c == 1 else rew.get(h, 0)
            x = ws.cell(r, c, v); x.font = AR(); x.border = BORDER; x.alignment = Alignment(horizontal='center')
            if i % 2 == 1:
                x.fill = fill('FFF3F3F3')

    r = last + 2                                          # 36
    bar(r, 'Simulation inputs (read by the engine)')
    label(r + 1, 'Places from', PLACES_FROM,
          "data_event_inst event whose participants per festival weight the league (Opponent weight); its measured "
          "places price the event only if the behaviour table below is removed (D102). Real 'Mighty Ice Cream' rows win")
    label(r + 2, 'Participation', PARTICIPATION,
          'DESIGN VALUE (user, 2026-11-11): share of the players online on a festival\'s days who take part - replace later')
    label(r + 3, 'Bird challenge length (days)', BIRD_LEN,
          "length of the Red's / Chuck's Challenge the bird counts were measured on (2-day weekday events)")
    label(r + 4, 'Bomb birds per win (share of Chuck)', BOMB_SHARE,
          "no Bomb's Challenge rows in the pull: Bomb birds per win = this x Chuck birds per win (user decision)")
    PLACES_CELL, LEN_CELL, SHARE_CELL = f'$B${r + 1}', f'$B${r + 3}', f'$B${r + 4}'

    r += 6                                                # 42: the behaviour table
    bar(r, 'Player behaviour (Wager) - formulas hold the measured defaults; type a number over any cell to change it')
    TH = ['Segment', 'Payer', 'Submit after (wins)', 'Red birds per win', 'Chuck birds per win', 'Bomb birds per win',
          'Opponent weight', 'Points per win', 'Banked score']
    for i, h in enumerate(TH):
        x = ws.cell(r + 1, 1 + i, h); x.font = AR(bold=True); x.fill = fill(F_HDR); x.border = BORDER
        x.alignment = Alignment(horizontal='center', wrap_text=True)
    mult = {b['item']: b['amount'] for b in cfg['boosterMultipliers']}
    for i, (seg, pay) in enumerate([(sg, p) for sg in SEGMENTS for p in ('NONPAYER', 'PAYER')]):
        rr = r + 2 + i
        A, B = f'$A{rr}', f'$B{rr}'
        def V(sheet, col, event=None, seg_ref=A):
            idx = lambda n: f'INDEX({sheet}!$A$2:$ZZ,0,MATCH("{n}",{sheet}!$1:$1,0))'
            conds = [f'{idx("payer_flag")}={B}',
                     f'(({idx("segment")}={seg_ref})+(({seg_ref}="100-249")*({idx("segment")}="100+")))>0']
            if event:
                conds.append(f'{idx("event_name")}={event}')
            # A pull with both A/B arms is read for Variant A only. The choice is a SCALAR IF between two
            # FILTERs: an IF inside FILTER's condition is not array-expanded everywhere in Sheets, and the
            # condition then has the wrong size (the cell errors before IFERROR can help on some builds).
            plain = f'AVERAGE(FILTER({idx(col)},{",".join(conds)}))'
            armed = f'AVERAGE(FILTER({idx(col)},{",".join(conds)},{idx("ab_variant")}="Variant A"))'
            one = f'IFERROR(IF(ISNA(MATCH("ab_variant",{sheet}!$1:$1,0)),{plain},{armed}),"")'
            if seg == '250+':                             # no rows of its own -> its parent's (SEG_PARENT)
                par = one.replace(seg_ref, '"100-249"')
                return f'IF({one}="",{par},{one})'
            return one
        per_win = lambda ev: (f'=IFERROR(LET(bal,{V("data_event_inst", "avg_final_token_balance", ev)},'
                              f'w,{V("data_streaks", "wins_per_day_mean")},p,{V("data_seg_beh", "weekday_active_rate")},'
                              f'L,{LEN_CELL},bal/(w*L*p/(1-(1-p)^L))),"")')
        cells = [seg, pay,
                 f'={V("data_streaks", "max_streak_per_day_p50")}',
                 per_win('"Red"'), per_win('"Chuck"'),
                 f'=IFERROR({SHARE_CELL}*E{rr},"")',
                 f'={V("data_event_inst", "avg_participants_per_instance", PLACES_CELL)}',
                 f'=IFERROR(D{rr}*{mult["red"]}+E{rr}*{mult["chuck"]}+F{rr}*{mult["bomb"]},"")',
                 f'=IFERROR(C{rr}*H{rr},"")']
        for j, v in enumerate(cells):
            x = ws.cell(rr, 1 + j, v); x.border = BORDER
            x.font = AR(bold=(j < 2)); x.alignment = Alignment(horizontal='center')
            if 2 <= j <= 6: x.fill = fill(F_INP)
            elif j >= 7: x.fill = fill(F_SIM)
            if 3 <= j <= 7: x.number_format = '0.00'
            elif j == 8: x.number_format = '#,##0'
    tr = r + 2 + 2 * len(SEGMENTS)
    for i, t in enumerate([
            'Submit after (wins): the player banks their running score after this many wins in a row (default: the '
            'measured median of the day\'s longest win streak, data_streaks max_streak_per_day_p50).',
            'Red / Chuck birds per win: the Red\'s / Chuck\'s Challenge mean final balance / (wins per active day x active '
            'days in that challenge). Bomb = the share above x Chuck. Points per win = Red x1 + Chuck x2 + Bomb x4 (server '
            'boosterMultipliers). Banked score = submit-after x points per win (the median player; the engine spreads it '
            'with Red\'s balance quantiles).',
            'Opponent weight: participants per festival (the "Places from" event) - who fills the 59 other seats.',
            'Chance to bank in a festival = 1 - (1 - share of active days whose longest streak reaches "Submit after")^(active '
            'days in the festival); a player who never banks is not on the board. Place = 1 + the opponents who banked more.']):
        ws.cell(tr + 1 + i, 1, t).font = AR(9, color='FF808080')
    r = tr + 6
    bar(r, 'Server config (live JSON, builders/mic_server_config.json) - not read by the sim')
    info = [('eventType', cfg['eventType']), ('configuration', cfg['configuration']),
            ('assetBundle', cfg['assetBundle']), ('requiredPlayerLevel', cfg['requiredPlayerLevel']),
            ('requiredSagaLevel', cfg['requiredSagaLevel']), ('closingTimeMinutes', cfg['closingTimeMinutes']),
            ('countCreatedBoosters', str(cfg['countCreatedBoosters']).upper()),
            ('scoreDoubler', str(cfg['scoreDoubler']).upper()), ('movesLeftMax', cfg['movesLeftMax'])]
    info += [(f"boosterMultiplier {b['item']}", b['amount']) for b in cfg['boosterMultipliers']]
    for i, (k, v) in enumerate(info, 1):
        a = ws.cell(r + i, 1, k); a.font = AR()
        b = ws.cell(r + i, 2, v); b.font = AR(); b.alignment = Alignment(horizontal='center')
    r += len(info) + 2
    notes = [
        'NOTES',
        'Item mapping (as on the Race sheets, 2026-07-10): HardCoin -> Coins, SeasonPassToken -> SPT, CherryBomb -> Comet, '
        'Hammer -> Slingshot (FLAGGED: Hammer is not a tracked resource), Pre-Red / Pre-Chuck / Pre-Bomb -> Red / Chuck / Bomb.',
        'Places BOTTOM-UP (D103, design_pdfs/Mighty Ice Cream (Wager).md): every bird created in a won level scores '
        '(Red 1 / Chuck 2 / Bomb 4); the running score is banked by submitting after a win and lost on a lost level. '
        'The table above sets when each segment banks and how much a win is worth; the league mixes all segments.',
        'Redesign = expected reward per festival entered (every place weighted by its chance) x Participation x the '
        'share of players online on its days, summed over its cal_new festivals. Today = the same over cal_curr '
        '(0 while cal_curr runs none). No data_gains rows exist for this event.',
        'NOT modelled: +5 moves bought to save a streak, boosters spent on it (no new spend), bots, a player who keeps '
        'going past the target (everyone banks at "Submit after").',
    ]
    for i, t in enumerate(notes):
        ws.cell(r + i, 1, t).font = AR(9, bold=(i == 0), color='FF000000' if i == 0 else 'FF808080')

    # ---- local sim (AI..AT): the engine's own model, one spill ------------------------------------
    widths = [12, 11, 11, 13, 11, 10, 10, 10, 12, 12, 12, 46]
    for i, wd in enumerate(widths):
        ws.column_dimensions[L(LS + i)].width = wd
    bar(1, 'Player Place Simulation (Wager, bottom-up) - SIMULATED: edit the behaviour table (A42) and this re-runs',
        LS, LS + len(widths) - 1)
    x = ws.cell(2, LS, 'Payer'); x.font = AR(bold=True); x.fill = fill(F_LBL)
    y = ws.cell(2, LS + 1, 'NONPAYER'); y.font = AR(); y.fill = fill(F_INP)
    dv = DataValidation(type='list', formula1='"NONPAYER,PAYER"', allow_blank=False)
    ws.add_data_validation(dv); dv.add(f'{L(LS + 1)}2')
    ws.cell(2, LS + 3, 'one festival of EventDuration days starting on a weekday; places out of LBSize').font = AR(9, color='FF808080')
    ws[f'{L(LS)}4'] = f'=ECOGAINS_MIC(${L(LS + 1)}$2, sim_refresh!$A$1)'
    ws[f'{L(LS)}4'].font = AR()
    nr = 4 + 1 + len(SEGMENTS) + 2
    for i, t in enumerate([
            'Chance to bank: reaching "Submit after" wins in a row on at least one active day of the festival. Places: '
            'p25 / p50 / p75 over everyone of the segment who takes part ("not on board" = never banked, paid nothing).',
            'Coins / SPT per festival entered: what the engine prices (every place x its chance); the redesign row is that '
            'x Participation x the share of players online on each festival\'s days.']):
        ws.cell(nr + i, LS, t).font = AR(9, color='FF808080')
    d_ = L(LS + len(widths) - 1)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wb.save(OUT)
    print(f'written {OUT}: {SHEET}, {npos} places on a league of {lb}, ladder rows {LAD0}..{last}, columns A..{lastc}; '
          f'behaviour table header row {tr - 2 * len(SEGMENTS) - 1}; local sim {L(LS)}1:{d_}{nr + 2}')
    return lad, lb


if __name__ == '__main__':
    main()
