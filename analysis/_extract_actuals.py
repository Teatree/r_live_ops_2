# Actual-side extraction for the sim-vs-actual discrepancy report.
#
# Reads the LiveOps v2 A/B export CSVs (workbooks/) and reshapes them onto the simulation's
# axes: 25 CATEGORY_ORDER categories x 19 RESOURCES x sim segment labels x Control/Variant.
#
# THE MAPPING (the load-bearing part): the repo's category CASE in
# sqls/resource_share_by_category_period_v2.sql:230 is STALE — the live query that produced
# data_gains gained extra branches (D2's saga_progression, the player_level_up rename, the
# ad_chest/ad_life rename) that only exist in the Query-LLM's history. Applying the repo CASE
# verbatim to the A/B export dumps 50.8% of HC into 'Other'. This file therefore carries the
# repo CASE (provenance 'repo_sql') plus the minimal EXTENDED rules (provenance 'extended',
# each justified inline). Everything else falls to 'Other' — deliberately MIRRORING the live
# query's ELSE so the sim's measured 'Other' anchor and the actual 'Other' bucket mean the same
# thing; Other's composition is fully audited in mapping_audit.csv (single_collection and
# dream_peak — events the model never itemized — live there, and the report calls them out).
#
# FREE-only: the sim's measured anchor (data_gains) is free gains only, so every comparison
# series here uses amount_gained_free. Totals are kept alongside for context.
#
# Outputs (analysis/out/):
#   actuals_long.csv     segment, ab_group, category, resource, amount_free, amount_total,
#                        player_days, papd_free
#   mapping_audit.csv    source_detail x rule x provenance x free HC amount x share
#   actuals_aux.json     Core-SPT telemetry lane, NS reach, daily overlays, pass diagnostics,
#                        per-gainer bases, denominators, excluded-resource census, gate results
#
# Usage: python analysis/_extract_actuals.py
import csv, json, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
WB = os.path.join(HERE, '..', 'workbooks')
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)

def read(name):
    with open(os.path.join(WB, name), encoding='utf-8') as f:
        return list(csv.DictReader(f))

# ---------------------------------------------------------------- category mapping
# repo CASE, verbatim (sqls/resource_share_by_category_period_v2.sql:230-267)
REPO_SQL = {
    'red_event': 'Red Challenge', 'chuck_event': 'Chuck Challenge', 'bomb_event': 'Bomb Challenge',
    'solo_race_event': 'Flash Race',
    'season_pass_event': 'Season Pass (Free)', 'SeasonPass': 'Season Pass (Free)',
    'SeasonPassHoliday': 'Season Pass (Free)', 'SeasonPassHalloween': 'Season Pass (Free)',
    'SeasonPassSummer': 'Season Pass (Free)', 'dream_pass_event': 'Season Pass (Free)',
    'FlowerCoop': 'FlowerCoop', 'Hatchling Hideaway': 'Hatchling Hideaway',
    'bomb_ballet_event': "Bomb's Ballet", 'MusicBoxes': "Bomb's Ballet",
    'Jigsaw': 'Jigsaw', 'PuzzleValentine': 'Jigsaw',
    'Photoshoot': 'Photoshoot', 'MakeupHarvest': 'Photoshoot', 'MakeupEaster': 'Photoshoot',
    'kite_festival_event': 'Kite Festival',
    'dreamheist_event': 'Daily Night Sky Prize', 'treasure_dive_event': 'Daily Night Sky Prize',
    'ArcheryArena': 'Target Day', 'river_rush': 'River Rush', 'FlockRush': 'Flock Flurry',
    'team_collection': 'Team Event',
    'team_versus': 'Team Race', 'team_versus_contribution': 'Team Race', 'race_event': 'Team Race',
    'daily_reward': 'Daily Gift', 'day_1': 'Daily Gift', 'day_2': 'Daily Gift',
    'day_3': 'Daily Gift', 'day_4': 'Daily Gift', 'day_5': 'Daily Gift', 'day_6': 'Daily Gift',
    'day_7': 'Daily Gift', 'gift': 'Daily Gift',
    'Rainbow Maker': 'Rainbow Maker',
    'chapter_complete': 'Core', 'PlayerLevelUpChest': 'Core', 'SagaPath': 'Core',
    'RewardVideo.Chest': 'Ads', 'shop_purchase': 'IAPs',
}
# extended rules — branches the LIVE query must contain but the repo .sql never received
EXTENDED = {
    'saga_progression': 'Saga',    # D2 (SIMULATION_PLAN): saga HC split out of Core; 19.5% of A/B HC
    'player_level_up': 'Core',     # rename of the chapter_complete/PlayerLevelUpChest lane; 19.2% of HC
    'ad_chest': 'Ads',             # rename of RewardVideo.Chest (absent from this export)
    'ad_life': 'Ads',
    'wager_event': 'Level Race',   # Level Race logs as wager; trivial in-window (2.9k HC/9d, both arms)
}
def category_for(sd, source_main):
    if sd in REPO_SQL: return REPO_SQL[sd], 'repo_sql'
    if sd.startswith('SagaChestRewards'): return 'Core', 'repo_sql'   # LIKE 'SagaChestRewards%'
    if sd in EXTENDED: return EXTENDED[sd], 'extended'
    # everything else — including the IAP SKU universe (coin_purchase, bundle_*, *_offer*,
    # *_coins*) — mirrors the live query's ELSE -> 'Other'. The May data_gains anchor put
    # offer-granted items there (only shop_purchase maps to IAPs), so faithfulness to the
    # anchor semantics beats semantic tidiness. Composition is audited in mapping_audit.csv.
    return 'Other', 'else'

# ---------------------------------------------------------------- resource crosswalk
RESOURCE_MAP = {
    'HardCoin': 'HC',
    'powerup_1': 'Comet', 'powerup_2': 'Slingshot', 'powerup_3': 'Shuffle',
    'pre_level_booster_1': 'Red', 'pre_level_booster_2': 'Chuck', 'pre_level_booster_3': 'Bomb',
    'UnlimitedBooster1': 'UL Red', 'UnlimitedBooster2': 'UL Chuck', 'UnlimitedBooster3': 'UL Bomb',
    'UnlimitedLives': 'Unlimited Lives',
    'DreamPassToken': 'SPT',
}
EXCLUDED_RESOURCES = {   # -> reason (the report's excluded-cells appendix)
    'SeasonPassMultiplier2x': 'unit clash: telemetry logs MINUTES of a 2x multiplier; the engine '
                              'weights SPTx2 as a double-value TOKEN in sptTotals_ — dimensionally '
                              'incomparable (and a standing sim bug candidate)',
    'SeasonPassToken': 'economically trivial (~0.12/pd) legacy currency; the real pass currency '
                       'is DreamPassToken',
    'Avatar': 'out of sim scope (methodology: COOP Token / Avatar / star-daily items)',
    'life': 'out of sim scope (lives are not one of the 19 sim resources)',
    'liferefill': 'out of sim scope',
    'Movie_Magic': 'event-internal currency, out of sim scope',
    'Ocean_rescue': 'event-internal currency, out of sim scope',
    'Reds_Greatest_Challenge': 'event-internal currency, out of sim scope',
    'unknown': 'unattributed telemetry',
}
SEG_MAP = {'A. 0': 'A. 0', 'B. 1-9': '0-9', 'C. 10-19': '10-19', 'D. 20-39': '20-39',
           'E. 40-99': '40-99', 'F. 100+': '100+'}
WINDOW = [f'2026-08-{d:02d}' for d in range(2, 11)]        # the 9 ledger days

# ================================================================ main ledger reshape
gains = read('resource_gains_by_segment_9d.csv')
cells = defaultdict(lambda: {'free': 0.0, 'total': 0.0})
audit = defaultdict(lambda: {'free_hc': 0.0, 'free_all': 0.0, 'rule': '', 'prov': '', 'cat': ''})
excluded_census = defaultdict(lambda: {'free': 0.0, 'total': 0.0})
player_days = {}
raw_free_total = defaultdict(float)                        # (segment, arm, resource) — identity gate

for r in gains:
    seg = SEG_MAP[r['segment']]; arm = r['ab_group']
    tot = float(r['amount_gained'] or 0)
    # FREE series, mirroring data_gains: currency uses the export's free/paid split (populated
    # for currency rows only); items are free iff action <> 'purchase' (the SQL's item rule) —
    # the export leaves amount_gained_free BLANK on all item rows.
    if r['amount_gained_free'] != '':
        free = float(r['amount_gained_free'] or 0)
    else:
        free = tot if r['action'] != 'purchase' else 0.0
    player_days[(seg, arm)] = float(r['player_days'])
    res_raw = r['resource']
    raw_free_total[(seg, arm, res_raw)] += free
    cat, prov = category_for(r['source_detail'], r['source_main'])
    a = audit[r['source_detail']]
    a['rule'], a['prov'], a['cat'] = r['source_detail'], prov, cat
    a['free_all'] += free
    if res_raw == 'HardCoin': a['free_hc'] += free
    if res_raw in EXCLUDED_RESOURCES:
        excluded_census[(res_raw, EXCLUDED_RESOURCES[res_raw])]['free'] += free
        excluded_census[(res_raw, EXCLUDED_RESOURCES[res_raw])]['total'] += tot
        continue
    res = RESOURCE_MAP.get(res_raw)
    if res is None:
        sys.exit(f'UNMAPPED RESOURCE {res_raw!r} — extend RESOURCE_MAP or EXCLUDED_RESOURCES')
    c = cells[(seg, arm, cat, res)]
    c['free'] += free; c['total'] += tot

# ---------------------------------------------------------------- gates
gates = {}
# G1: accounting identity — mapped + excluded == raw, exactly
mapped_free = sum(c['free'] for c in cells.values())
excl_free = sum(c['free'] for c in excluded_census.values())
raw_free = sum(raw_free_total.values())
gates['accounting_identity'] = {'mapped': mapped_free, 'excluded': excl_free, 'raw': raw_free,
                                'ok': abs(mapped_free + excl_free - raw_free) < 1e-6}
# G2: player_days consistency vs ab_denominators is_total rows
den = read('ab_denominators.csv')
den_tot = {(SEG_MAP[r['segment']], r['ab_group']): float(r['player_days'])
           for r in den if r['is_total'] in ('True', 'TRUE', 'true')}
gates['player_days_match'] = {'ok': all(abs(player_days[k] - den_tot[k]) < 0.5 for k in player_days),
                              'detail': {f'{k[0]}|{k[1]}': [player_days[k], den_tot[k]] for k in player_days}}
# G3: Other-share per arm (free HC) — the live-ELSE bucket, reported not hidden
other_hc = {arm: sum(c['free'] for (s, a, cat, res), c in cells.items()
                     if a == arm and cat == 'Other' and res == 'HC') for arm in ('Control', 'Variant')}
hc_tot = {arm: sum(c['free'] for (s, a, cat, res), c in cells.items()
                   if a == arm and res == 'HC') for arm in ('Control', 'Variant')}
gates['other_share_hc'] = {arm: other_hc[arm] / hc_tot[arm] for arm in other_hc}
gates['other_share_ok'] = all(v < 0.10 for v in gates['other_share_hc'].values())

# ================================================================ aux datasets
aux = {'window': WINDOW}

# Core-SPT telemetry lane (invisible to the resource ledger): pooled papd per bucket x arm,
# players-weighted over the 9-day window, corrected series.
dm = read('liveops2_ab_daily_metrics.csv')
core_spt = defaultdict(lambda: defaultdict(float))
for r in dm:
    if r['event_date'] not in WINDOW: continue
    seg = SEG_MAP[r['avg_completions_7d_bucket']]; arm = r['ab_group']
    p = float(r['players'] or 0)
    k = (seg, arm)
    core_spt[k]['players'] += p
    for lane in ('CORE', 'RAINBOW', 'OFFER', 'EVENT', 'OTHER'):
        core_spt[k][lane] += p * float(r.get(f'avg_spt_gain_{lane}') or 0)
    core_spt[k]['total'] += p * float(r.get('avg_spt_gain_total') or 0)
    core_spt[k]['RAINBOW_uncorrected'] += p * float(r.get('avg_spt_gain_RAINBOW_uncorrected') or 0)
    for m in ('pct_player_days_passed_R1', 'pct_player_days_passed_R2', 'pct_player_days_passed_R3',
              'avg_level_completes' if 'avg_level_completes' in r else 'avg_player_performance'):
        if r.get(m): core_spt[k]['ns_' + m] = core_spt[k].get('ns_' + m, 0) + p * float(r[m])
aux['spt_lanes_papd'] = {f'{k[0]}|{k[1]}': {m: (v / core_spt[k]['players'] if m != 'players' else v)
                                            for m, v in core_spt[k].items()}
                         for k in core_spt}

# daily overlays (papd by day): HC free + SPT total
aux['hc_daily'] = [{'date': r['event_date'], 'segment': SEG_MAP[r['segment']], 'arm': r['ab_group'],
                    'players': float(r['players']), 'hc_free_papd': float(r['avg_hc_gain_free'] or 0),
                    'hc_papd': float(r['avg_hc_gain_total'] or 0)}
                   for r in read('hc_gains_by_segment.csv') if r['event_date'] in WINDOW]
aux['spt_daily'] = [{'date': r['event_date'], 'segment': SEG_MAP[r['segment']], 'arm': r['ab_group'],
                     'players': float(r['players']), 'spt_papd': float(r['avg_spt_gain_total'] or 0)}
                    for r in read('spt_gains_by_segment.csv') if r['event_date'] in WINDOW]

# pass diagnostics + RM config, verbatim (small)
for name, key in [('per_level_spt_rate.csv', 'per_level_spt_rate'),
                  ('pass_accrual_play_matched.csv', 'pass_accrual_play_matched'),
                  ('spt_vs_pass_progression_diag.csv', 'spt_vs_pass_diag'),
                  ('season_pass_milestone_summary.csv', 'sp_milestone_summary'),
                  ('season_pass_milestone_split.csv', 'sp_milestone_split'),
                  ('rainbow_maker_config.csv', 'rm_config'),
                  ('rainbow_spt_config_conformance.csv', 'rm_spt_conformance')]:
    aux[key] = read(name)

# per-gainer bases (the one actual-side column on the sim's per-earner basis)
aux['player_dist'] = [{'segment': SEG_MAP[r['segment']], 'arm': r['ab_group'],
                       'resource': RESOURCE_MAP.get(r['resource'], 'EXCLUDED:' + r['resource']),
                       'players': float(r['players'] or 0), 'gainers': float(r['gainers'] or 0),
                       'gain_per_gainer': float(r['gain_per_gainer'] or 0)}
                      for r in read('ab_player_dist.csv')]

# denominators (is_total slice) + the behaviour columns the sim holds constant
aux['denominators'] = [{'segment': SEG_MAP[r['segment']], 'arm': r['ab_group'],
                        'player_days': float(r['player_days']), 'players_active': float(r['players_active']),
                        'conversion_rate': float(r['conversion_rate'] or 0),
                        'levels_completed_per_active': float(r['levels_completed_per_active'] or 0),
                        'levels_attempted_per_active': float(r['levels_attempted_per_active'] or 0),
                        'level_win_rate': float(r['level_win_rate'] or 0),
                        'session_minutes_per_active': float(r['session_minutes_per_active'] or 0),
                        'd1_retention': float(r['d1_retention'] or 0),
                        'd7_retention': float(r['d7_retention'] or 0),
                        'activation_rate': float(r['activation_rate'] or 0)}
                       for r in den if r['is_total'] in ('True', 'TRUE', 'true')]

aux['excluded_resources'] = [{'resource': res, 'reason': reason, **v}
                             for (res, reason), v in sorted(excluded_census.items())]
aux['gates'] = gates

# ================================================================ write outputs
with open(os.path.join(OUT, 'actuals_long.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['segment', 'ab_group', 'category', 'resource', 'amount_free', 'amount_total',
                'player_days', 'papd_free'])
    for (seg, arm, cat, res), c in sorted(cells.items()):
        pd_ = player_days[(seg, arm)]
        w.writerow([seg, arm, cat, res, round(c['free'], 4), round(c['total'], 4),
                    pd_, round(c['free'] / pd_, 6)])

with open(os.path.join(OUT, 'mapping_audit.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['source_detail', 'category', 'provenance', 'free_hc', 'free_all_resources',
                'share_of_free_hc'])
    tot_hc = sum(a['free_hc'] for a in audit.values())
    for sd, a in sorted(audit.items(), key=lambda x: -x[1]['free_hc']):
        w.writerow([sd, a['cat'], a['prov'], round(a['free_hc'], 2), round(a['free_all'], 2),
                    round(a['free_hc'] / tot_hc, 6) if tot_hc else 0])

with open(os.path.join(OUT, 'actuals_aux.json'), 'w', encoding='utf-8') as f:
    json.dump(aux, f, indent=1)

ok = gates['accounting_identity']['ok'] and gates['player_days_match']['ok'] and gates['other_share_ok']
print('accounting identity :', 'PASS' if gates['accounting_identity']['ok'] else 'FAIL',
      f"(mapped {mapped_free:,.0f} + excluded {excl_free:,.0f} == raw {raw_free:,.0f})")
print('player_days match   :', 'PASS' if gates['player_days_match']['ok'] else 'FAIL')
print('Other share of HC   :', {k: f'{v:.1%}' for k, v in gates['other_share_hc'].items()},
      '=> ' + ('PASS' if gates['other_share_ok'] else 'FAIL (>10%)'))
print(f'cells: {len(cells)}  |  audit rows: {len(audit)}  |  excluded resources: {len(excluded_census)}')
sys.exit(0 if ok else 1)
