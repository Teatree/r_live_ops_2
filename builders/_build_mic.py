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
    row 36+     'Simulation inputs': Places from = Red (the data_event_inst event whose measured places it borrows)
    then        the server config fields the sim does not read, and the item mapping
    AI1:AM14    the LOCAL SIM: pick a percentile and a payer, see each segment's place out of 60 and what it pays

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
          "data_event_inst event whose measured places (position_p25/p50/p75) and participation_rate this event "
          "borrows while data_event_inst has no 'Mighty Ice Cream' rows; type another event name to switch")
    ws.cell(r + 2, 1, "Participation: not set here, so the borrowed event's measured participation_rate is used. "
                      "To override, add a cell 'Participation' with the rate in the cell to its right.").font = AR(9, color='FF808080')
    PLACES_CELL = f'$B${r + 1}'

    r += 4                                                # 40
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
        'Priced like a race (user, 2026-11-11): the measured places of the event named in "Places from" (Red\'s Challenge), '
        'AS MEASURED, on a league of LBSize players - so places past the measured p75 spread over the rest of the board.',
        'BOTTOM-UP: no data_gains rows exist for this event. Redesign = expected reward per festival entered (every place '
        'weighted by its chance) x participation x the share of players online on its days, summed over its cal_new instances. '
        'Today = the same over cal_curr (0 while cal_curr runs none).',
        'The Wager mechanic (booster multipliers, booster spend) is NOT modelled: the event is priced as a race.',
    ]
    for i, t in enumerate(notes):
        ws.cell(r + i, 1, t).font = AR(9, bold=(i == 0), color='FF000000' if i == 0 else 'FF808080')

    # ---- local sim (AI..AM) ------------------------------------------------------------------
    a, b_, c_, d_ = L(LS), L(LS + 1), L(LS + 2), L(LS + 3)
    for c in range(LS, LS + 4):
        ws.column_dimensions[L(c)].width = 14 if c < LS + 3 else 70
    ws.column_dimensions[a].width = 18
    bar(1, 'Player Place Simulation (measured place percentile -> Mighty Ice Cream reward) - SIMULATED', LS, LS + 3)
    lab = lambda rr, t: ws.cell(rr, LS, t)
    for rr, t, v in [(2, 'Percentile', 'p50'), (3, 'Payer', 'NONPAYER')]:
        x = lab(rr, t); x.font = AR(bold=True); x.fill = fill(F_LBL)
        y = ws.cell(rr, LS + 1, v); y.font = AR(); y.fill = fill(F_INP)
    dv1 = DataValidation(type='list', formula1='"p25,p50,p75"', allow_blank=False)
    dv2 = DataValidation(type='list', formula1='"NONPAYER,PAYER"', allow_blank=False)
    ws.add_data_validation(dv1); ws.add_data_validation(dv2)
    dv1.add(f'{b_}2'); dv2.add(f'{b_}3')
    x = lab(4, 'Places read from'); x.font = AR(bold=True); x.fill = fill(F_LBL)
    # Mighty Ice Cream's own rows win the moment the pull has them (the engine's rule, EVENT_INST_PROXY)
    ev_col = 'INDEX(data_event_inst!$A:$ZZ,0,MATCH("event_name",data_event_inst!$1:$1,0))'
    ws[f'{b_}4'] = f'=IFERROR(IF(COUNTIF({ev_col},"{NAME}")>0,"{NAME}",{PLACES_CELL}),{PLACES_CELL})'
    ws[f'{b_}4'].font = AR(); ws[f'{b_}4'].fill = fill(F_SIM)
    ws.cell(4, LS + 2, 'measured places of this event (data_event_inst)').font = AR(9, color='FF808080')

    hdr = ['Segment', 'Place', 'Out of', 'Reward at that place']
    for i, h in enumerate(hdr):
        x = ws.cell(6, LS + i, h); x.font = AR(bold=True); x.fill = fill(F_HDR); x.border = BORDER
    col = lambda n: f'INDEX(data_event_inst!$A$2:$ZZ,0,MATCH("{n}",data_event_inst!$1:$1,0))'
    for i, seg in enumerate(SEGMENTS):
        rr = 7 + i
        s = ws.cell(rr, LS, seg); s.font = AR(bold=True); s.border = BORDER
        # one row per (event, payer, segment) and arm; '100-249' also matches an older pull's '100+'.
        # A pull carrying both A/B arms is read for Variant A only, as the engine does (ANCHOR_ARM).
        segm = (f'IF({a}{rr}="100-249",({col("segment")}="100-249")+({col("segment")}="100+"),'
                f'{col("segment")}={a}{rr})')
        arm = f'IF(ISNA(MATCH("ab_variant",data_event_inst!$1:$1,0)),1,{col("ab_variant")}="Variant A")'
        m = f'({col("event_name")}=${b_}$4)*({col("payer_flag")}=${b_}$3)*({segm})*({arm})'
        place =(f'=LET(m,{m},n,SUM(m),pc,INDEX(data_event_inst!$A$2:$ZZ,0,MATCH("position_"&${b_}$2,data_event_inst!$1:$1,0)),'
                 f'IF(n=0,"n/a",ROUND(SUMPRODUCT(m,N(+pc))/n,0)))')
        ws[f'{b_}{rr}'] = ArrayFormula(f'{b_}{rr}', place)
        ws[f'{c_}{rr}'] = '=$B$5'
        reward = (f'=LET(p,{b_}{rr},IF(NOT(ISNUMBER(p)),"n/a",IF(p>$B$4,"(below the "&$B$4&" paid places - pays nothing)",'
                  f'LET(s,INDEX($B${LAD0}:${lastc}${last},p,0),t,TEXTJOIN(", ",TRUE,IF(s>0,$B${HDR_ROW}:${lastc}${HDR_ROW}&": "&s,"")),'
                  f'IF(t="","{{}} (place pays nothing)","{{"&t&"}}")))))')
        ws[f'{d_}{rr}'] = ArrayFormula(f'{d_}{rr}', reward)
        for c in range(LS + 1, LS + 4):
            ws.cell(rr, c).font = AR(); ws.cell(rr, c).fill = fill(F_SIM); ws.cell(rr, c).border = BORDER
    nr = 7 + len(SEGMENTS) + 1
    for i, t in enumerate([
            'Place = the measured finishing place at the chosen percentile (p25 = a quarter of finishes at this place or better), '
            'read off data_event_inst for the event in "Places from", AS MEASURED (Red\'s board was ~15 players; here it is one of LBSize).',
            'The engine prices every place 1..LBSize with its chance (a curve through p25 / p50 / p75), not just this one row; '
            'this block shows where the typical player of each segment lands.',
            '"100-249" also reads an older pull\'s "100+". A pull carrying both A/B arms is read for Variant A only.']):
        ws.cell(nr + i, LS, t).font = AR(9, color='FF808080')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wb.save(OUT)
    print(f'written {OUT}: {SHEET}, {npos} places on a league of {lb}, ladder rows {LAD0}..{last}, columns A..{lastc}; '
          f'local sim {a}1:{d_}{nr + 2}')
    return lad, lb


if __name__ == '__main__':
    main()
