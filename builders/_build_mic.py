"""Builds display/Mic_v2.xlsx: the config sheet of MIGHTY ICE CREAM, a leaderboard event, from the live server config in
builders/mic_server_config.json. One tab, 'Mic_v2' (the _v2 suffix = a redesign-side sheet; there is no base 'Mic' -
the event does not run on cal_curr, so the engine reads Mic_v2 on both sides).

D105 (2026-11-11): the places are built from the event's OWN results (data_mic: participation, each participant's
highest submitted score, the opponent mix and the leaderboard size), not from the streak model of D103 / D104. The
style is the one the user gave the sheet in the workbook (2026-11-11): the explanatory notes beside the labels are
WHITE text (there to be read by selecting the cell), the notes under the behaviour table and the NOTES block are on
HIDDEN rows, the input cells of the behaviour table are grey (#EFEFEF), the local sim's header row is #D9D9D9 Arial 9
and its rows #EFEFEF Calibri, the ladder has a 'greater than 0' highlight.

Layout = one block of the 'Race' sheet (builders/_build_race.py), so the engine's leaderboard readers take it as is:
    A1          title
    row 3       'Mighty Ice Cream - Config Panel' bar
    rows 4-6    numberOfPositions 25 / LBSize 60 (= leagueGroupSize) / EventDuration 2
    row 8       'Mighty Ice Cream - Req and Rewards' bar
    row 9       header  Position | Coins | SPT | SPT x2 | Red .. 6-star Dly | ToF_Ticket   (Race_v2's 23 columns, A..W)
    rows 10-34  places 1..25 (the server JSON ladder)
    row 36+     'Simulation inputs': Places from (Red - used only if the behaviour table is removed, D102),
                Participation override (all segments; blank = each segment's own), League size (players per board;
                data_mic's average leaderboard size)
    row 42+     'Player behaviour (Data - mostly)' (D105): per segment x payer - Participation (share of active), Avg top
                score, Top score p25..p98, Opponent share; every cell a FORMULA reading data_mic, overwritable by typing a
                number (the engine reads what the cell holds and reads data_mic itself when it is blank)
    then        the server config fields the sim does not read, and the NOTES (hidden rows)
    AI1         the LOCAL SIM: =ECOGAINS_MIC(payer) - per segment the participation, the measured top score, the places
                p25 / p50 / p75 on a board of the league size, the chance of a paid place, coins / SPT / VALUE (item_vals
                row 3) per festival entered, the value per player online, the reward at the median place

Engine wiring (EcoGainsSim_v4.gs LB_R_SPECS['Mighty Ice Cream']): hdr row 9 -> 0-based 8, ladder rows 10..34 -> 9..33,
columns B..W -> 1..22. Change any of those here and the spec must move with it (harness/_mock_mic.js gates it).
The behaviour table is found by its header row ('Segment' in column A and 'Top score p50' in it) and its columns by
their header text (WAGER_SPECS / MIC_SCORE_COLS) - harness/_mock_mic_data.js gates the labels.

Item mapping (the one approved for the Race sheets 2026-07-10, builders/_build_race.py): HardCoin -> Coins,
SeasonPassToken -> SPT, CherryBomb -> Comet, Hammer -> Slingshot, Pre-Red/Chuck/Bomb -> Red/Chuck/Bomb, Shuffle -> Shuffle.
An item with no mapping stops the build (it would otherwise be priced as nothing).

    python builders/_build_mic.py
"""
import json, os, sys
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule, Rule
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.utils import get_column_letter as L

sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'mic_server_config.json')
OUT = os.path.join(ROOT, 'display', 'Mic_v2.xlsx')

NAME, SHEET = 'Mighty Ice Cream', 'Mic_v2'
PLACES_FROM = 'Red'               # D102 fallback: data_event_inst event whose places are borrowed if the table is removed
DURATION = 2                      # days (the calendar's merge decides the length anyway)
DATA = 'data_mic'                 # D105: the live event's results
COLS = ['Position', 'Coins', 'SPT', 'SPT x2', 'Red', 'Chuck', 'Bomb', 'Slingshot', 'Shuffle', 'Comet',
        'Unlimited Lives', 'Unlimited Red', 'Unlimited Chuck', 'Unlimited Bomb', 'COOP Token', 'Avatar',
        '1-star Dly', '2-star Dly', '3-star Dly', '4-star Dly', '5-star Dly', '6-star Dly', 'ToF_Ticket']
ITEM_MAP = {'HardCoin': 'Coins', 'Coin': 'Coins', 'SeasonPassToken': 'SPT', 'CherryBomb': 'Comet',
            'ShootingStar': 'Comet', 'Hammer': 'Slingshot', 'Shuffle': 'Shuffle', 'Pre-Red': 'Red',
            'Pre-Chuck': 'Chuck', 'Pre-Bomb': 'Bomb'}
SEGMENTS = ['0-9', '10-19', '20-39', '40-99', '100-249', '250+', 'ALL']
# the engine's labels (EcoGainsSim_v4.gs WAGER_SPECS / MIC_SCORE_COLS) - keep in step
PART_OVR_LABEL = 'Participation override (all segments)'
LEAGUE_LABEL = 'League size (players per board)'
# behaviour table: header -> (data_mic column it reads, number format)
TABLE = [('Participation (share of active)', 'Participation', '0.00%'),
         ('Avg top score', 'Avg top score', '#,##0'),
         ('Top score p25', 'p25', '#,##0'), ('Top score p50', 'p50', '#,##0'), ('Top score p75', 'p75', '#,##0'),
         ('Top score p90', 'p90', '#,##0'), ('Top score p95', 'p95', '#,##0'), ('Top score p98', 'p98', '#,##0'),
         ('Opponent share', 'Pooled share', '0.00%')]

HDR_ROW, LAD0 = 9, 10            # 1-based
LS = 35                          # local sim first column (AI), as on Race_v2 / Ki_v2

# the user's palette on this sheet (2026-11-11)
F_BAR, F_LBL, F_VAL, F_HDR, F_SIM, F_DATA = 'FF000000', 'FFFFD966', 'FFFFF2CC', 'FFF7CB4D', 'FFE2EFDA', 'FFEFEFEF'
F_LSHDR, F_ZEBRA, F_POS = 'FFD9D9D9', 'FFF3F3F3', 'FFB7E1CD'
WHITE, GREY = 'FFFFFFFF', 'FF808080'
fill = lambda rgb: PatternFill('solid', fgColor=rgb)
thin = Side(style='thin')
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
AR = lambda sz=11, **k: Font(name='Arial', size=sz, **k)
CAL = lambda sz=11, **k: Font(name='Calibri', size=sz, **k)
# column widths as the user left them (others default)
WIDTHS = {'A': 24, 'B': 14, 'C': 8.25, 'D': 12.63, 'X': 4.13, 'AI': 10.5, 'AJ': 16.25, 'AK': 9.63, 'AL': 11.38,
          'AM': 9.63, 'AN': 8.75, 'AP': 13.25, 'AQ': 10.5, 'AT': 11.13, 'AU': 23.75}


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


# Plain INDEX / MATCH / OFFSET only: LET written by openpyxl has no _xlfn prefix and can import as #NAME?.
D_ALL, D_A, D_B = f'{DATA}!$A$1:$Z$300', f'{DATA}!$A$1:$A$300', f'{DATA}!$B$1:$B$300'
H1 = f'MATCH("Segment",{D_A},0)'                         # table 1's header row (the first 'Segment' in column A)
H3 = f'MATCH("Leaderboards",{D_B},0)'                    # the leaderboard-mix table's header row


def data_formula(seg_ref, column):
    """data_mic, table 1: the segment's row (its first occurrence in column A - table 1 comes first) at the column
    whose header is `column`. Blank when anything is missing."""
    return (f'=IFERROR(INDEX({D_ALL},MATCH({seg_ref},{D_A},0),'
            f'MATCH("{column}",INDEX({D_ALL},{H1},0),0)),"")')


def pooled_formula(seg_ref):
    """data_mic, the leaderboard-mix table (the header row with 'Leaderboards' in column B): 'Pooled share'."""
    return (f'=IFERROR(INDEX({D_ALL},{H3}+MATCH({seg_ref},OFFSET({DATA}!$A$1,{H3},0,30,1),0),'
            f'MATCH("Pooled share",INDEX({D_ALL},{H3},0),0)),"")')


def league_formula():
    return f'=IFERROR(INDEX({D_ALL},{H3}+1,MATCH("Avg LB size",INDEX({D_ALL},{H3},0),0)),"")'


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
    for c, w in WIDTHS.items():
        ws.column_dimensions[c].width = w

    def bar(r, text, c0=1, c1=ncol):
        for c in range(c0, c1 + 1):
            ws.cell(r, c).fill = fill(F_BAR)
        ws.cell(r, c0, text).font = AR(bold=True, color=WHITE)

    def label(r, text, val, note=None, c=1, nf=None):
        a = ws.cell(r, c, text); a.font = AR(bold=True); a.fill = fill(F_LBL)
        b = ws.cell(r, c + 1, val); b.font = AR(); b.fill = fill(F_VAL); b.alignment = Alignment(horizontal='center')
        if nf:
            b.number_format = nf
        if note:                                          # the user's style: notes in WHITE (select the cell to read)
            ws.cell(r, c + 2, note).font = AR(9, color=WHITE)

    def hidden_note(r, text, bold=False, color=GREY):
        ws.cell(r, 1, text).font = AR(9, bold=bold, color=color)
        ws.row_dimensions[r].hidden = True

    ws['A1'] = NAME
    ws['A1'].font = AR(14, bold=True)
    bar(3, f'{NAME} - Config Panel')
    label(4, 'numberOfPositions', npos, 'places that pay (rewards[] in the server config)')
    label(5, 'LBSize', lb, 'players per league in the server config (leagueGroupSize); the sim uses "League size" below')
    label(6, 'EventDuration', DURATION, 'days; the calendar merge decides the length the sim uses')
    bar(8, f'{NAME} - Req and Rewards')
    for c, h in enumerate(COLS, 1):
        x = ws.cell(HDR_ROW, c, h); x.font = AR(bold=True); x.fill = fill(F_HDR); x.border = BORDER
        x.alignment = Alignment(horizontal='center', wrap_text=True)
    for i, rew in enumerate(lad):
        r = LAD0 + i
        for c, h in enumerate(COLS, 1):
            v = (i + 1) if c == 1 else rew.get(h, 0)
            x = ws.cell(r, c, v); x.font = AR(); x.border = BORDER; x.alignment = Alignment(horizontal='center')
            if i % 2 == 1:
                x.fill = fill(F_ZEBRA)
    ws.conditional_formatting.add(f'B{LAD0}:{lastc}{last}',
                                  CellIsRule(operator='greaterThan', formula=['0'], fill=fill(F_POS)))

    r = last + 2                                          # 36
    bar(r, 'Simulation inputs (read by the engine)')
    label(r + 1, 'Places from', PLACES_FROM,
          "data_event_inst event whose measured places price the event ONLY if the behaviour table below is removed "
          "(D102). Real 'Mighty Ice Cream' rows in data_event_inst win")
    label(r + 2, PART_OVR_LABEL, None,
          'blank = each segment\'s own participation (the table below, data_mic); a number here (e.g. 0.6) is used for '
          'every segment and payer. Participation = share of the players online on a festival\'s days who take part',
          nf='0.00%')
    label(r + 3, LEAGUE_LABEL, league_formula(),
          'players on one leaderboard: data_mic\'s average leaderboard size (16.3 on the live event; the server config '
          'says 60). Type a number to change it; a fraction is the mix of the two whole sizes around it', nf='0.0')

    r += 6                                                # 42: the behaviour table
    bar(r, 'Player behaviour (Data - mostly)')
    TH = ['Segment', 'Payer'] + [t[0] for t in TABLE]
    for i, h in enumerate(TH):
        x = ws.cell(r + 1, 1 + i, h); x.font = AR(bold=True); x.fill = fill(F_HDR); x.border = BORDER
        x.alignment = Alignment(horizontal='center', wrap_text=True)
    for i, (seg, pay) in enumerate([(sg, p) for sg in SEGMENTS for p in ('NONPAYER', 'PAYER')]):
        rr = r + 2 + i
        A = f'$A{rr}'
        cells = [seg, pay] + [pooled_formula(A) if src == 'Pooled share' else data_formula(A, src)
                              for _, src, _ in TABLE]
        for j, v in enumerate(cells):
            x = ws.cell(rr, 1 + j, v); x.border = BORDER
            x.font = AR(bold=(j < 2)); x.alignment = Alignment(horizontal='center')
            if j >= 2:
                x.fill = fill(F_DATA)
                x.number_format = TABLE[j - 2][2]
    tr = r + 2 + 2 * len(SEGMENTS)                         # 58
    for i, t in enumerate([
            'Every cell reads data_mic (the live event): participation = participants / players active during the event; '
            'top score = each participant\'s highest submitted score; opponent share = the segment\'s share of the '
            'participants on a leaderboard (pooled). data_mic has no payer split, so both payer rows read the segment.',
            'Type a number over any cell to change it; a blank cell is read from data_mic by the engine.',
            'Place = 1 + the opponents who scored more, on a board of "League size" players drawn by Opponent share; '
            'every participant is on the board (a participant is someone who submitted a score).',
            'The scores were measured on the festival as it ran; every festival on cal_new uses them as they are.']):
        hidden_note(tr + 1 + i, t)
    r = tr + 6                                            # 64
    bar(r, 'Server config (not used by the sim)')
    info = [('eventType', cfg['eventType']), ('configuration', cfg['configuration']),
            ('assetBundle', cfg['assetBundle']), ('requiredPlayerLevel', cfg['requiredPlayerLevel']),
            ('requiredSagaLevel', cfg['requiredSagaLevel']), ('closingTimeMinutes', cfg['closingTimeMinutes']),
            ('countCreatedBoosters', str(cfg['countCreatedBoosters']).upper()),
            ('scoreDoubler', str(cfg['scoreDoubler']).upper()), ('movesLeftMax', cfg['movesLeftMax'])]
    info += [(f"boosterMultiplier {b['item']}", b['amount']) for b in cfg['boosterMultipliers']]
    for i, (k, v) in enumerate(info, 1):
        label(r + i, k, v)
    r += len(info) + 2
    notes = [
        'NOTES',
        'Item mapping (as on the Race sheets, 2026-07-10): HardCoin -> Coins, SeasonPassToken -> SPT, CherryBomb -> Comet, '
        'Hammer -> Slingshot (FLAGGED: Hammer is not a tracked resource), Pre-Red / Pre-Chuck / Pre-Bomb -> Red / Chuck / Bomb.',
        'Places from the live event (D105): every bird created in a won level scores (Red 1 / Chuck 2 / Bomb 4); the '
        'running score is banked by submitting after a win and lost on a lost level; data_mic measures what that '
        'produced - each participant\'s highest submitted score - and the league mixes all segments.',
        'Redesign = expected reward per festival entered (every place weighted by its chance) x Participation x the '
        'share of players online on its days, summed over its cal_new festivals. Today = the same over cal_curr '
        '(0 while cal_curr runs none). No data_gains rows exist for this event yet.',
        'NOT modelled: +5 moves bought to save a streak, boosters spent on it (no new spend), payer differences '
        '(data_mic has none).',
    ]
    for i, t in enumerate(notes):
        hidden_note(r + i, t, bold=(i == 0), color='FF000000' if i == 0 else GREY)

    # ---- local sim (AI..AU): the engine's own model, one spill ------------------------------------
    LH = ['Segment', 'Participation (share of active)', 'Top score p50', 'Avg top score', 'Place p25', 'Place p50',
          'Place p75', 'Chance of a paid place', 'Coins per festival entered', 'SPT per festival entered',
          'Value per festival entered (item_vals)', 'Value per player online (x Participation)', 'Reward at the p50 place']
    LNF = [None, '0.00%', '#,##0', '#,##0', None, None, None, '0.00%', '0.00', '0.00', '0.00', '0.00', None]
    c1 = LS + len(LH) - 1
    bar(1, 'Player Place (bottom-up) - SIMULATED', LS, c1)
    x = ws.cell(2, LS, 'Payer'); x.font = AR(bold=True); x.fill = fill(F_LBL)
    y = ws.cell(2, LS + 1, 'PAYER'); y.font = AR(); y.fill = fill(F_VAL)
    dv = DataValidation(type='list', formula1='"NONPAYER,PAYER"', allow_blank=False)
    ws.add_data_validation(dv); dv.add(f'{L(LS + 1)}2')
    ws.cell(2, LS + 3, 'one festival of EventDuration days starting on a weekday; places on a board of "League size"; '
                       'value = item_vals row 3').font = AR(9, color=WHITE)
    for j, h in enumerate(LH):                            # the spill writes the header text too; the style is the sheet's
        x = ws.cell(4, LS + j); x.font = AR(9, bold=True); x.fill = fill(F_LSHDR)
        x.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        for rr in range(5, 5 + len(SEGMENTS)):
            z = ws.cell(rr, LS + j); z.font = CAL(); z.fill = fill(F_DATA); z.alignment = Alignment(horizontal='center')
            if LNF[j]:
                z.number_format = LNF[j]
    ws[f'{L(LS)}4'] = f'=ECOGAINS_MIC(${L(LS + 1)}$2, sim_refresh!$A$1)'
    pr = f'{L(LS + 4)}5:{L(LS + 6)}{4 + len(SEGMENTS)}'
    ws.conditional_formatting.add(pr, Rule(type='containsText', operator='containsText', text='not on board',
                                           formula=[f'NOT(ISERROR(SEARCH("not on board",{L(LS + 4)}5)))'],
                                           dxf=DifferentialStyle(font=Font(color='FF990000'))))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wb.save(OUT)
    print(f'written {OUT}: {SHEET}, {npos} places (server LBSize {lb}), ladder rows {LAD0}..{last}, columns A..{lastc}; '
          f'behaviour table header row {tr - 2 * len(SEGMENTS) - 1}; local sim {L(LS)}1:{L(c1)}{4 + len(SEGMENTS)}')
    return lad, lb


if __name__ == '__main__':
    main()
