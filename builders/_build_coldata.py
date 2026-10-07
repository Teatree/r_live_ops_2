# Builds the FOUR collection-telemetry data sheets the AlbumConfig_v2 / PackConfig_v2 / ToF_v2
# change simulation needs (D56, 2026-10-07):
#
#   data_col_season     display/data_col_season_v1.xlsx     10 rows, one per segment x payer
#   data_col_envelopes  display/data_col_envelopes_v1.xlsx  long: segment x payer x source x tier
#   data_tof_runs       display/data_tof_runs_v1.xlsx       10 rows, one per segment x payer
#   data_tof_stages     display/data_tof_stages_v1.xlsx     long: stage x door outcome
#
# WHY THESE EXIST
#   The three new _v2 config sheets are the first ones with NO measured anchor in data_gains: it
#   carries no pack rows, no set/album reward rows and no ToF rows, so `measured x R x D x T` has
#   nothing to multiply. User decision 2026-10-07 was ratio-on-measured rather than a twin
#   bottom-up run (recall phrase: THIS WAS A DELIBERATE DECISION TO NOT SIMULATE BOTTOM-UP), which
#   means the anchor has to come from telemetry instead. These sheets ARE that anchor.
#
# EVERY VALUE HERE IS FAKE, AND SAYS SO
#   Each row carries a `status` column reading FAKE. The engine readers treat a FAKE row as absent
#   and fall back to the modelled assumption, logging that they did - so a placeholder can never
#   quietly drive a balancing number. The analytics LLM is asked to return status = MEASURED.
#   See PROMPT_collection_data_request.md for the column dictionary handed to it.
#
# WHY THE PLACEHOLDERS ARE THE SIM'S OWN OUTPUT
#   The per-cell numbers below are what the D55 engine actually produced - 1000 players x 10 cells
#   on the intended calendar, analysis/out/vacation_review/P2b_fixed_livecal_n1000.json. Inventing
#   round numbers would have made the first real pull show a delta that was pure placeholder error.
#   Starting from the model's own output means the first pull shows a TRUE sim-vs-actual gap.
#   They are still FAKE as data: they are the model talking to itself.
#
# DATA-SHEET CONVENTIONS FOLLOWED (sqls/daily_gains.sql is the authority for data_* columns)
#   * headers on row 1, data from row 2 - what every data_* reader in the engine assumes;
#   * only non-zero rows are emitted in the long tables, exactly like data_gains, so a MISSING row
#     is a legitimate measured zero rather than a hole;
#   * segment / payer_flag keys are spelled as data_seg_beh spells them ('0-9' .. '100+',
#     NONPAYER / PAYER), NOT as data_gains spells them ('B. 1-9'), because these sheets are read
#     through the merged-label axis. A label mismatch is the prime suspect for a zero table.
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

DISPLAY = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'display')

SEGMENTS = ['0-9', '10-19', '20-39', '40-99', '100+']
PAYERS = ['NONPAYER', 'PAYER']
SEASON_DAYS = 28          # SEASON_LAST_DAY in engine/EcoGainsSim_v4.gs. The album is expected to
                          # last EXACTLY the season, so a pull whose window differs is a finding.
STATUS_FAKE = 'FAKE'

# ---- placeholder per-cell values: the D55 sim's own 1000-player output (see header) -------------
CELL = {
    ('0-9',   'NONPAYER'): dict(pop=107126, packs=26.914, cards=77.459,  new=40.254, dupes=37.205,
                                sets=1.877, stars_e=76.708,  stars_s=54.2,   chests=0.880,
                                tof_runs=11.057, tof_bank=1.611, album=0.000, active=15.131),
    ('0-9',   'PAYER'):    dict(pop=64267,  packs=37.257, cards=117.390, new=53.060, dupes=64.330,
                                sets=2.930, stars_e=144.149, stars_s=117.95, chests=1.778,
                                tof_runs=12.205, tof_bank=1.820, album=0.000, active=18.064),
    ('10-19', 'NONPAYER'): dict(pop=54334,  packs=34.946, cards=110.464, new=49.843, dupes=60.621,
                                sets=2.752, stars_e=137.800, stars_s=112.90, chests=1.641,
                                tof_runs=13.027, tof_bank=1.951, album=0.000, active=15.128),
    ('10-19', 'PAYER'):    dict(pop=25992,  packs=44.999, cards=151.019, new=59.478, dupes=91.541,
                                sets=3.978, stars_e=222.655, stars_s=195.95, chests=2.768,
                                tof_runs=13.201, tof_bank=2.216, album=0.020, active=16.366),
    ('20-39', 'NONPAYER'): dict(pop=42079,  packs=40.859, cards=140.256, new=55.707, dupes=84.549,
                                sets=3.526, stars_e=203.812, stars_s=179.40, chests=2.451,
                                tof_runs=13.484, tof_bank=2.402, album=0.019, active=15.214),
    ('20-39', 'PAYER'):    dict(pop=19794,  packs=51.562, cards=183.505, new=64.692, dupes=118.813,
                                sets=4.878, stars_e=298.809, stars_s=272.50, chests=3.575,
                                tof_runs=14.498, tof_bank=2.655, album=0.157, active=16.103),
    ('40-99', 'NONPAYER'): dict(pop=22010,  packs=53.351, cards=190.752, new=66.755, dupes=123.997,
                                sets=5.106, stars_e=312.076, stars_s=287.15, chests=3.475,
                                tof_runs=13.596, tof_bank=2.901, album=0.280, active=15.644),
    ('40-99', 'PAYER'):    dict(pop=10805,  packs=60.776, cards=223.152, new=78.417, dupes=144.735,
                                sets=6.168, stars_e=374.016, stars_s=348.15, chests=4.142,
                                tof_runs=12.929, tof_bank=3.005, album=0.445, active=15.167),
    ('100+',  'NONPAYER'): dict(pop=2536,   packs=49.948, cards=189.388, new=72.302, dupes=117.086,
                                sets=5.332, stars_e=311.258, stars_s=287.60, chests=3.178,
                                tof_runs=10.588, tof_bank=3.055, album=0.411, active=13.972),
    ('100+',  'PAYER'):    dict(pop=1362,   packs=61.589, cards=234.738, new=86.288, dupes=148.450,
                                sets=6.784, stars_e=397.016, stars_s=372.10, chests=4.186,
                                tof_runs=11.101, tof_bank=3.605, album=0.521, active=15.866),
}

# Per-source envelope shares. The pack lane prices each source bottom-up today; this table is what
# would ANCHOR it. Shares are the sim's own per-source mix at 40-99 PAYER (the vacation review's
# envelope table), applied across cells - a placeholder shape, not a measurement.
SOURCE_SHARE = [
    ('Rainbow Maker',             0.356),
    ('Season Pass',               0.163),
    ('Night Sky',                 0.119),
    ('Target Day',                0.075),
    ('Tower of Fortune',          0.067),
    ('Hatchling Hideaway',        0.055),
    ('Star Chest - Bronze',       0.028),
    ('Star Chest - Silver',       0.037),
    ('Star Chest - Gold',         0.002),
    ('Jigsaw',                    0.028),
    ("Bomb's Ballet",             0.021),
    ('Kite Festival',             0.021),
    ('Team Event',                0.016),
    ('Flock Flurry',              0.012),
]
# Tier mix of the envelopes a source hands out (1-star .. 5-star). The 6-star tier was retired in
# Sep 2026, so it is absent rather than zero - a tier with no row is a measured zero.
TIER_MIX = [('1-star Pack', 0.213), ('2-star Pack', 0.331), ('3-star Pack', 0.272),
            ('4-star Pack', 0.111), ('5-star Pack', 0.073)]

# ToF stage structure, mirroring the authored ToF sheet: 35 stages, 4 doors, one pig on a standard
# stage, safe every 5th, milestones at 20 and 30. Door outcomes are what a pull should MEASURE
# against the authored `card type` slots.
TOF_STAGES = 35
TOF_SAFE_EVERY = 5
TOF_MILESTONES = (20, 30)


def stage_type(n):
    if n == 1:
        return 'Safe (Start)'
    if n in TOF_MILESTONES:
        return 'Major Milestone'
    if n % TOF_SAFE_EVERY == 0:
        return 'Safe'
    return 'Standard'


# ---- sheet plumbing ---------------------------------------------------------------------------
HDR_FILL = PatternFill('solid', fgColor='CFE2F3')      # #CFE2F3 = the data palette
FAKE_FILL = PatternFill('solid', fgColor='FBE3E0')
ARIAL = lambda **kw: Font(name='Arial', **kw)


def new_sheet(title):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = title
    ws.sheet_view.showGridLines = False
    return wb, ws


def write(ws, headers, rows, widths=None):
    for c, h in enumerate(headers, start=1):
        cell = ws.cell(1, c, h)
        cell.font = ARIAL(bold=True, size=9)
        cell.fill = HDR_FILL
        cell.alignment = Alignment(horizontal='center', wrap_text=True, vertical='center')
        ws.column_dimensions[openpyxl.utils.get_column_letter(c)].width = (
            (widths or {}).get(h, max(11, min(22, len(str(h)) + 3))))
    ws.row_dimensions[1].height = 30
    status_col = headers.index('status') + 1 if 'status' in headers else None
    for r, row in enumerate(rows, start=2):
        for c, v in enumerate(row, start=1):
            cell = ws.cell(r, c, v)
            cell.font = ARIAL(size=9)
            if isinstance(v, float):
                cell.number_format = '0.000' if abs(v) < 10 else '0.00'
        if status_col:
            ws.cell(r, status_col).fill = FAKE_FILL
            ws.cell(r, status_col).font = ARIAL(size=9, bold=True)
    ws.freeze_panes = 'A2'
    return ws


def save(wb, name):
    os.makedirs(DISPLAY, exist_ok=True)
    p = os.path.join(DISPLAY, name)
    wb.save(p)
    print('wrote', os.path.relpath(p))


# ---- 1. data_col_season -----------------------------------------------------------------------
H1 = ['segment', 'payer_flag', 'unique_players', 'season_days',
      'envelopes_received_mean', 'envelopes_opened_mean',
      'envelopes_received_p25', 'envelopes_received_p50', 'envelopes_received_p75',
      'envelopes_received_p90',
      'cards_drawn_mean', 'new_cards_mean', 'duplicate_cards_mean', 'new_card_share',
      'sets_completed_mean', 'album1_completion_rate', 'album1_completion_day_p50',
      'albums_completed_mean',
      'stars_earned_mean', 'stars_spent_mean', 'star_balance_end_mean',
      'chests_bought_bronze_mean', 'chests_bought_silver_mean', 'chests_bought_gold_mean',
      'active_days_mean', 'status']
rows1 = []
for seg in SEGMENTS:
    for pay in PAYERS:
        d = CELL[(seg, pay)]
        # A completion DAY only exists for a cell that completes at all; 0 would read as "day 0".
        day50 = round(SEASON_DAYS * 0.78, 1) if d['album'] >= 0.5 else ''
        rows1.append([
            seg, pay, d['pop'], SEASON_DAYS,
            d['packs'], round(d['packs'] * 0.995, 3),
            round(d['packs'] * 0.42, 3), round(d['packs'] * 0.93, 3),
            round(d['packs'] * 1.42, 3), round(d['packs'] * 1.78, 3),
            d['cards'], d['new'], d['dupes'], round(d['new'] / d['cards'], 4),
            d['sets'], d['album'], day50, round(d['album'], 3),
            d['stars_e'], d['stars_s'], round(d['stars_e'] - d['stars_s'], 2),
            round(d['chests'] * 0.41, 3), round(d['chests'] * 0.55, 3),
            round(d['chests'] * 0.04, 3),
            d['active'], STATUS_FAKE])
wb, ws = new_sheet('data_col_season')
write(ws, H1, rows1)
save(wb, 'data_col_season_v1.xlsx')

# ---- 2. data_col_envelopes --------------------------------------------------------------------
H2 = ['segment', 'payer_flag', 'source', 'pack_tier', 'envelopes_mean',
      'envelopes_per_instance_mean', 'instances', 'participation_rate', 'status']
rows2 = []
for seg in SEGMENTS:
    for pay in PAYERS:
        total = CELL[(seg, pay)]['packs']
        for src, share in SOURCE_SHARE:
            for tier, tmix in TIER_MIX:
                v = total * share * tmix
                if v < 0.005:                      # data_gains convention: no zero rows
                    continue
                inst = 1 if src.startswith('Star Chest') or src == 'Season Pass' else 4
                part = 0.0327 if src == 'Kite Festival' else ''
                rows2.append([seg, pay, src, tier, round(v, 4),
                              round(v / inst, 4), inst, part, STATUS_FAKE])
wb, ws = new_sheet('data_col_envelopes')
write(ws, H2, rows2)
save(wb, 'data_col_envelopes_v1.xlsx')

# ---- 3. data_tof_runs -------------------------------------------------------------------------
H3 = ['segment', 'payer_flag', 'runs_played_mean', 'runs_banked_mean', 'bank_rate',
      'mean_stage_reached', 'stage_reached_p50', 'stage_reached_p90',
      'continues_bought_mean', 'coins_spent_continues_mean', 'topups_bought_mean',
      'tickets_earned_mean', 'tickets_unspent_mean', 'cashout_stage_p50', 'status']
# Coins spent per run, by segment, from the ToF sheet's own RUN ECONOMICS block (fake like the rest).
SPEND = {'0-9': 2.321, '10-19': 6.251, '20-39': 14.610, '40-99': 33.567, '100+': 72.354}
rows3 = []
for seg in SEGMENTS:
    for pay in PAYERS:
        d = CELL[(seg, pay)]
        runs, bank = d['tof_runs'], d['tof_bank']
        rows3.append([
            seg, pay, runs, bank, round(bank / runs, 4),
            round(6.0 + 2.5 * bank / runs * 4, 2), 6.0, 10.0,
            round(runs * 0.23, 3), round(SPEND[seg] * runs * (1.3 if pay == 'PAYER' else 1.0), 2),
            round(runs * (0.08 if pay == 'PAYER' else 0.0), 3),
            round(runs * 1.04, 3), round(runs * 0.035, 3), 10.0, STATUS_FAKE])
wb, ws = new_sheet('data_tof_runs')
write(ws, H3, rows3)
save(wb, 'data_tof_runs_v1.xlsx')

# ---- 4. data_tof_stages -----------------------------------------------------------------------
H4 = ['stage_n', 'stage_type', 'doors_shown', 'door_outcome', 'picks', 'pick_share',
      'survive_rate', 'status']
rows4 = []
reach = 1.0
for n in range(1, TOF_STAGES + 1):
    st = stage_type(n)
    pigs = 0 if st.startswith('Safe') or st == 'Major Milestone' else 1
    doors = 4
    surv = 1.0 - pigs / doors
    # picks can legitimately reach 0 on the deep stages - nobody in the sample got there without
    # continues. A ZERO picks row is information ("reached by nobody"); a MISSING stage row would
    # be a hole in the schema, so every one of the 35 stages is emitted either way.
    picks_total = round(10000 * reach)
    mix = [('reward', (doors - pigs) / doors), ('pig', pigs / doors)]
    for outcome, share in mix:
        if share <= 0:
            continue
        rows4.append([n, st, doors, outcome, int(round(picks_total * share)),
                      round(share, 4), round(surv, 4), STATUS_FAKE])
    reach *= surv
wb, ws = new_sheet('data_tof_stages')
write(ws, H4, rows4)
save(wb, 'data_tof_stages_v1.xlsx')

print('\nAll four sheets carry status = FAKE on every row. The engine readers treat FAKE as absent')
print('and fall back to the modelled assumption, so these cannot move a balancing number.')
