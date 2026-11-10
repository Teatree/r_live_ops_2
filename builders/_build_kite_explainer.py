"""Kite Festival explainer sheet (D101, 2026-11-10) -> display/Kite_Explainer_v1.xlsx

One sheet, 'Kite_Explainer', for designers and stakeholders: pick a segment and a payer flag and the
sheet explains, in sentences that carry the live numbers, how the simulation prices Kite Festival:
today vs the redesign, the core formula (Redesign = Today x R x T x D), where the players finish,
which festivals they show up for (activity, measured opt-in, measured join days, the late-joiner
assumption, weekend re-weighting), and what makes two calendar versions differ.

Every number comes from ONE engine function, ECOGAINS_KITE (engine/KiteExplain.gs), spilled in four
blocks; the sheet only builds sentences (VLOOKUP into the PARAMS spill) and charts. Nothing here is a
second copy of a model rule.

Import into the workbook as a new sheet named Kite_Explainer. Needs in the Apps Script project:
EcoGainsSim_v4.gs (D100+), EcoGainsSim_Daily.gs, ChangeSummary.gs and KiteExplain.gs; run
EcoGainsSim > Compute export scale once so kite_joiners exists (without it the sheet still works and
says the opt-in is the design guess).
"""
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.chart import BarChart, Reference
from openpyxl.utils import get_column_letter as L

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'display' / 'Kite_Explainer_v1.xlsx'
SHEET = 'Kite_Explainer'

# ---- geometry (row bands; every spill gets room for its longest case) --------------------------
SEG, PAY = 'B4', 'B5'
R_HEAD = 8           # section 1
R_FORM = 13          # section 2
R_RES = 23           # RESULT spill header (10 rows)
R_RES_CHART = 34     # chart band (16 rows)
R_RANK_TXT = 51      # section 4
R_RANKS = 56         # RANKS spill (<= 61 rows)
R_FEST_TXT = 120     # section 5
R_FEST = 127         # FESTIVALS spill (<= 31 rows)
R_FEST_CHART = 160   # chart band
R_WHY = 177          # section 6
R_PARAMS = 190       # PARAMS spill (<= 110 rows)
PRANGE = f'$A${R_PARAMS + 1}:$B${R_PARAMS + 110}'
N_RES_COLS = 22      # Coins .. ToF_Ticket on the Kite sheets

ARIAL = 'Arial'
F_TITLE = Font(name=ARIAL, size=16, bold=True, color='1F3864')
F_SUB = Font(name=ARIAL, size=10, italic=True, color='595959')
F_BAR = Font(name=ARIAL, size=11, bold=True, color='FFFFFF')
F_TXT = Font(name=ARIAL, size=10)
F_KEY = Font(name=ARIAL, size=10, bold=True)
F_NOTE = Font(name=ARIAL, size=9, italic=True, color='7F7F7F')
FILL_BAR = PatternFill('solid', fgColor='1F4E78')
FILL_IN = PatternFill('solid', fgColor='FFF2CC')     # input
FILL_SIM = PatternFill('solid', fgColor='E2EFDA')    # sim output
FILL_FORM = PatternFill('solid', fgColor='DDEBF7')
THIN = Side(style='thin', color='BFBFBF')


def V(key):
    """The value of one PARAMS row, by its label."""
    return f'VLOOKUP("{key}",{PRANGE},2,FALSE)'


def pct(key, f='0%'):
    return f'TEXT({V(key)},"{f}")'


def n(key, f='0.00'):
    return f'TEXT({V(key)},"{f}")'


WHO = f'{SEG}&" "&IF({PAY}="PAYER","payers","non-payers")'


def build():
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET
    ws.sheet_view.showGridLines = False

    def bar(r, text):
        for c in range(1, 25):
            ws.cell(r, c).fill = FILL_BAR
        ws.cell(r, 1, text).font = F_BAR

    def txt(r, formula_or_text, font=F_TXT):
        c = ws.cell(r, 1, formula_or_text)
        c.font = font
        return c

    def spill(r, block):
        c = ws.cell(r, 1, f'=ECOGAINS_KITE({PAY},{SEG},"{block}",sim_refresh!$A$1)')
        c.font = F_TXT
        return c

    # ---- title + inputs ----------------------------------------------------------------------------
    ws['A1'] = 'Kite Festival - how the simulation prices it'
    ws['A1'].font = F_TITLE
    ws['A2'] = ('Pick a player group below. Every number on this sheet comes from the simulation engine itself '
                '(ECOGAINS_KITE); the sentences re-read them, so they always match the change summary.')
    ws['A2'].font = F_SUB
    ws['A4'], ws[SEG] = 'Player segment', '40-99'
    ws['A5'], ws[PAY] = 'Payer', 'PAYER'
    for a in ('A4', 'A5'):
        ws[a].font = F_KEY
    for a in (SEG, PAY):
        ws[a].fill = FILL_IN
        ws[a].font = F_KEY
        ws[a].alignment = Alignment(horizontal='center')
        ws[a].border = Border(top=THIN, bottom=THIN, left=THIN, right=THIN)
    ws['C4'] = '<- 0-9, 10-19, 20-39, 40-99, 100-249, 250+ or ALL (behaviour data changes with it)'
    ws['C5'] = '<- PAYER or NONPAYER'
    ws['C4'].font = ws['C5'].font = F_NOTE
    dv1 = DataValidation(type='list', formula1='"0-9,10-19,20-39,40-99,100-249,250+,ALL"', allow_blank=False)
    dv2 = DataValidation(type='list', formula1='"PAYER,NONPAYER"', allow_blank=False)
    ws.add_data_validation(dv1); ws.add_data_validation(dv2)
    dv1.add(SEG); dv2.add(PAY)

    # ---- 1. the answer -------------------------------------------------------------------------------
    r = R_HEAD - 1
    bar(r, '1. The answer')
    txt(r + 1, '="For "&' + WHO + '&", Kite Festival is worth "&' + n('Value today (coins-eq)', '#,##0') +
        '&" coins-equivalent per player over the "&' + V('Window days') + '&" days today, and "&' +
        n('Value redesign (coins-eq)', '#,##0') + '&" on the redesign ("&' + pct('Value change', '+0%;-0%') + '&")."',
        F_KEY)
    txt(r + 2, '="Coins: "&' + n('Coins today per player', '0.0') + '&" -> "&' + n('Coins redesign per player', '0.0') +
        '&" ("&' + pct('Coins change', '+0%;-0%') + '&").   Envelopes (all tiers): "&' + n('Envelopes today per player') +
        '&" -> "&' + n('Envelopes redesign per player') + '&" ("&' + pct('Envelopes change', '+0%;-0%') + '&")."')
    txt(r + 3, '="Values are per player of the group (as in change_summary), over the comparison window. '
               'Coins-equivalent prices every resource with item_vals."', F_NOTE)

    # ---- 2. the formula ------------------------------------------------------------------------------
    r = R_FORM - 1
    bar(r, '2. The formula: Redesign = Today x R x T x D')
    f = ws.cell(r + 1, 1, 'Redesign  =  Today  x  R  x  T  x  D')
    f.font = Font(name=ARIAL, size=13, bold=True, color='1F3864')
    for c in range(1, 9):
        ws.cell(r + 1, c).fill = FILL_FORM
    txt(r + 2, '="Today = what these players actually received from Kite (the data), stretched from the "&'
               '"export days to the comparison window (x"&' + n('Export scale coins') + '&" for coins)."')
    txt(r + 3, '="T = "&' + n('T') + '&": today "&' + V('Festivals today') + '&" festivals of "&' + V('Today festival length') +
        '&" days ("&' + V('Today festival days') + '&") each reach "&' + pct('Average reach today') +
        '&" of these players, "&' + n('Reach sum today') + '&" festivals\' worth in total. The redesign runs "&' +
        V('Festivals redesign') + '&" festivals reaching "&' + pct('Average reach redesign') + '&" on average: "&' +
        n('Reach sum redesign') + '&". "&' + n('Reach sum redesign') + '&" / "&' + n('Reach sum today') + '&" = "&' + n('T') + '&"."')
    txt(r + 4, '="R (coins) = "&' + n('R coins') + '&": one festival entered pays "&' + n('Coins per festival entered today', '0.0') +
        '&" coins on average today (every place\'s coins x the chance of finishing there) and "&' +
        n('Coins per festival entered redesign', '0.0') + '&" on the redesign\'s reward sheets. Each resource has its own R (table below)."')
    txt(r + 5, '="D = 1: Kite pays by finishing place in a league, so a shorter festival does not pay less per place. '
               'The model (like the local sim) keeps every player\'s finishing place whatever the length; length only changes who takes part (T)."')
    txt(r + 6, '="Coins: "&' + n('Coins today per player', '0.0') + '&" today x R "&' + n('R coins') + '&" x T "&' + n('T') +
        '&" x D 1 = "&TEXT(' + V('Coins today per player') + '*' + V('R coins') + '*' + V('T') + ',"0.0")&" coins on the redesign."', F_KEY)
    txt(r + 7, '="Envelopes start from the data too, but the redesign changes which envelope each place pays, so their change is the model\'s own: '
               'model envelopes on the redesign / model envelopes today (row \'Envelope model change\'), applied to the data."')
    txt(r + 8, '="Opt-in: "&' + pct('Opt-in used for envelopes') + '&" of the players who are online join a festival - "&' +
        f'VLOOKUP("Opt-in used for envelopes",{PRANGE.replace("$B$", "$C$")},3,FALSE)' +
        '&" (the old guess was "&' + pct('Old opt-in guess') + '&"). It is the same today and on the redesign, so it cancels out of the change."')

    # ---- 3. today vs redesign ------------------------------------------------------------------------
    bar(R_RES - 1, '3. Today vs redesign, per player, every resource (same columns as the Kite reward sheets)')
    spill(R_RES, 'RESULT')
    for c in range(1, 3 + N_RES_COLS):
        ws.cell(R_RES, c).font = F_KEY
        for rr in range(R_RES + 1, R_RES + 10):
            ws.cell(rr, c).fill = FILL_SIM
            ws.cell(rr, c).font = F_TXT
    last = L(2 + N_RES_COLS)
    fmts = {1: '0.00', 2: '0.00', 3: '+0%;-0%;0%', 4: '0.00', 5: '0.00', 6: '0', 7: '0.00', 9: '0%'}
    for off, fm in fmts.items():
        for c in range(3, 3 + N_RES_COLS):
            ws.cell(R_RES + off, c).number_format = fm
    txt(R_RES + 11, 'Change % per resource (redesign vs today):', F_KEY)
    ch = BarChart()
    ch.type = 'col'
    ch.title = 'Change per resource, redesign vs today'
    ch.y_axis.number_format = '0%'
    ch.legend = None
    ch.add_data(Reference(ws, min_col=3, max_col=2 + N_RES_COLS, min_row=R_RES + 3, max_row=R_RES + 3), from_rows=True, titles_from_data=False)
    ch.set_categories(Reference(ws, min_col=3, max_col=2 + N_RES_COLS, min_row=R_RES, max_row=R_RES))
    ch.height, ch.width = 7.5, 26
    ws.add_chart(ch, f'A{R_RES_CHART}')

    # ---- 4. where players finish ---------------------------------------------------------------------
    r = R_RANK_TXT - 1
    bar(r, '4. Where these players finish')
    txt(r + 1, '="Measured finishing places: a quarter of finishes are place "&' + V('Place p25') + '&" or better, half are place "&' +
        V('Place p50') + '&" or better, three quarters place "&' + V('Place p75') + '&" or better (data_event_inst). "&'
        '"Between those points the chances are spread evenly."')
    txt(r + 2, '="So the chance of 1st place is "&' + pct('Chance of 1st place', '0.0%') + '&", of the top 3 "&' + pct('Chance of top 3') +
        '&", of the top 10 "&' + pct('Chance of top 10') + '&", and of any paid place "&' + pct('Chance of a paid place') +
        '&". Average place: "&' + n('Average place', '0.0') + '&" of "&' + V('League size') + '&"."')
    txt(r + 3, '="The places are the same for every festival, 2-day or 3-day, weekday or weekend. What differs is what each place pays '
               '(the columns per reward sheet below) and how many players take part (section 5)."')
    spill(R_RANKS, 'RANKS')
    for c in range(1, 12):
        ws.cell(R_RANKS, c).font = F_KEY
    for rr in range(R_RANKS + 1, R_RANKS + 62):
        for c in range(1, 12):
            ws.cell(rr, c).fill = FILL_SIM
            ws.cell(rr, c).font = F_TXT
        ws.cell(rr, 2).number_format = '0.0%'
        ws.cell(rr, 3).number_format = '0%'
    ch2 = BarChart()
    ch2.type = 'col'
    ch2.title = 'Chance to finish in each place (first 30 places)'
    ch2.y_axis.number_format = '0%'
    ch2.legend = None
    ch2.add_data(Reference(ws, min_col=2, min_row=R_RANKS + 1, max_row=R_RANKS + 30), titles_from_data=False)
    ch2.set_categories(Reference(ws, min_col=1, min_row=R_RANKS + 1, max_row=R_RANKS + 30))
    ch2.height, ch2.width = 9, 18
    ws.add_chart(ch2, f'M{R_RANKS}')

    # ---- 5. festivals: who shows up ------------------------------------------------------------------
    r = R_FEST_TXT - 1
    bar(r, '5. The festivals: who takes part')
    txt(r + 1, '="A festival reaches a player who is online on at least one of its days. These players are online on "&' + pct('Weekday activity') +
        '&" of weekdays and "&' + pct('Weekend activity') + '&" of weekend days (Fri-Sun), so a 3-day weekday festival reaches 1 - (1 - "&' +
        n('Weekday activity') + '&")^3 = "&' + pct('Reach of a 3-day weekday festival') + '&" of them and a 2-day one "&' +
        pct('Reach of a 2-day weekday festival (activity only)') + '&"."')
    txt(r + 2, '="Kite is opt-in, and its joiners were measured (the 30-minute Unlimited Lives join reward): "&' +
        pct('Opt-in (measured)', '0.0%') + '&" of these players joined each of today\'s festivals. Of the joiners, "&' +
        pct('Joined on day 1') + '&" joined on day 1, "&' + pct('Joined on day 2') + '&" on day 2 and "&' + pct('Joined on day 3') + '&" on day 3."')
    txt(r + 3, '="A 2-day festival loses the day-3 joiners - but we assume "&' + pct('Late joiners who join earlier') +
        '&" of them would join a day earlier instead. So a 2-day weekday festival keeps "&' + pct('2-day weekday festival keeps', '0.0%') +
        '&" of a 3-day festival\'s players, where online activity alone would say "&' + pct('2-day keeps (activity only)', '0.0%') + '&"."')
    txt(r + 4, '=IF(' + V('Weekend festivals') + '=0,"This calendar has no weekend festival.",IF(' + V('Weekend festival joiner keep') +
        '>=1,"Weekend festivals on this calendar last "&' + V('Weekend festival length') + '&" days ("&' + V('Weekend festival days') +
        '&"), as long as the measured ones, so they keep every joiner.","Weekend festivals ("&' + V('Weekend festival days') +
        '&") re-weight the join days by weekend activity ("&' + pct('Weekend activity') + '&" vs "&' + pct('Weekday activity') +
        '&" on weekdays), so a "&' + V('Weekend festival length') + '&"-day weekend festival keeps "&' + pct('Weekend festival joiner keep', '0.0%') + '&"."))')
    txt(r + 5, '="In the table: Reach from activity only x Joiner keep, measured against a full-length festival starting the same day = Reach used. '
               'The per-resource columns split each total over the festivals that pay it (they add up to the table in section 3)."', F_NOTE)
    spill(R_FEST, 'FESTIVALS')
    for c in range(1, 15 + N_RES_COLS):
        ws.cell(R_FEST, c).font = F_KEY
    for rr in range(R_FEST + 1, R_FEST + 31):
        for c in range(1, 15 + N_RES_COLS):
            ws.cell(rr, c).fill = FILL_SIM
            ws.cell(rr, c).font = F_TXT
        for c in (10, 11, 12):
            ws.cell(rr, c).number_format = '0.0%'
        ws.cell(rr, 13).number_format = '0.0'
        ws.cell(rr, 14).number_format = '0.00'
        for c in range(15, 15 + N_RES_COLS):
            ws.cell(rr, c).number_format = '0.00'
    ch3 = BarChart()
    ch3.type = 'col'
    ch3.grouping = 'clustered'
    ch3.title = 'Share of players each festival reaches: activity only vs used (after joiner keep)'
    ch3.y_axis.number_format = '0%'
    ch3.add_data(Reference(ws, min_col=10, min_row=R_FEST, max_row=R_FEST + 20), titles_from_data=True)
    ch3.add_data(Reference(ws, min_col=12, min_row=R_FEST, max_row=R_FEST + 20), titles_from_data=True)
    ch3.set_categories(Reference(ws, min_col=4, min_row=R_FEST + 1, max_row=R_FEST + 20))
    ch3.height, ch3.width = 8, 26
    ws.add_chart(ch3, f'A{R_FEST_CHART}')

    # ---- 6. why calendar versions differ ------------------------------------------------------------
    r = R_WHY - 1
    bar(r, '6. Why two calendar versions give different results')
    txt(r + 1, '="This calendar\'s redesign runs "&' + V('Weekday festivals') + '&" weekday festivals ("&' + V('Weekday festival days') + '&", "&' +
        V('Weekday festival length') + '&" days, sheet "&' + V('Weekday festival sheet') + '&") and "&' + V('Weekend festivals') +
        '&" weekend festivals ("&' + V('Weekend festival days') + '&", "&' + V('Weekend festival length') + '&" days, sheet "&' + V('Weekend festival sheet') + '&")."')
    for i, kind in enumerate(('Weekday', 'Weekend')):
        txt(r + 2 + i, f'=IF({V(kind + " festivals")}=0,"No {kind.lower()} festival.","{kind} festival: reaches "&' +
            pct(kind + ' festival reach used', '0.0%') + '&" of these players (activity alone: "&' + pct(kind + ' festival reach (activity only)', '0.0%') +
            '&", joiner keep "&' + pct(kind + ' festival joiner keep', '0.0%') + '&") and pays "&' + n(kind + ' festival coins per entry', '0.0') +
            '&" coins and "&' + n(kind + ' festival envelopes per entry') + '&" envelopes per festival entered ("&' +
            n(kind + ' festival 4/5-star per entry') + '&" of them 4- or 5-star).")', F_KEY)
    txt(r + 4, '="To compare two calendar versions, paste this sheet into both workbooks and read the two lines above side by side. '
               'A festival\'s total = reach used x what it pays per festival entered, summed over the festivals."')
    txt(r + 5, '="2-day + 2-day vs 2-day + 3-day: the weekend festival is the difference. Its reward sheets pay the same envelope for each place, '
               'and the places do not change, so the envelope gap is entirely how many players the weekend festival reaches:"')
    txt(r + 6, '="a 3-day (Fri-Sun) festival keeps every joiner; a 2-day (Sat-Sun) one keeps the share above. 4- and 5-star envelopes '
               'come ONLY from the weekend festivals (the weekday sheet\'s best is a 3-star), so they move one for one with the weekend reach."')
    txt(r + 7, '="Coins differ for a second reason as well: the 3-day weekend festival pays from its own sheet, whose places pay more coins than the 2-day '
               'weekend sheet (compare the coins per festival entered above, and the coin columns in section 4)."')
    txt(r + 8, '="Assumptions behind section 5: the join days were measured on two Mon-Wed festivals only (none on a weekend), and the late-joiner share is a '
               'design assumption. Lost joiners are assumed to take an average share of every place\'s rewards."', F_NOTE)

    # ---- 7. every parameter -------------------------------------------------------------------------
    bar(R_PARAMS - 1, '7. Every parameter the simulation used for this group')
    spill(R_PARAMS, 'PARAMS')
    for c in range(1, 4):
        ws.cell(R_PARAMS, c).font = F_KEY
    for rr in range(R_PARAMS + 1, R_PARAMS + 110):
        for c in range(1, 4):
            ws.cell(rr, c).fill = FILL_SIM
            ws.cell(rr, c).font = F_TXT
        ws.cell(rr, 3).font = F_NOTE

    # ---- widths ---------------------------------------------------------------------------------------
    ws.column_dimensions['A'].width = 34
    ws.column_dimensions['B'].width = 16
    ws.column_dimensions['C'].width = 14
    for c in range(4, 15 + N_RES_COLS):
        ws.column_dimensions[L(c)].width = 12
    OUT.parent.mkdir(exist_ok=True)
    wb.save(OUT)
    print('written', OUT)


if __name__ == '__main__':
    build()
