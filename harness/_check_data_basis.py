# What basis is the workbook of record actually on?
# ---------------------------------------------------------------------------------------------
# The main stack had no equivalent of liveops20_fixes/_load_data.py: a re-exported workbook could
# change window, cohort or segment labelling and every harness would stay green, because the gates
# check the ENGINE against the data rather than the data against its own claims. This script asks
# the data what it is, and prints one verdict per question. It is a REPORT, not a release gate —
# most answers are legitimately "depends what you asked analytics for" — but each line is derived
# from the data itself, so nothing here depends on remembering a previous export.
#
#   python harness/_check_data_basis.py                # the dumped _mockdata.json
#   python harness/_check_data_basis.py --json <path>  # a different dump (e.g. _mockdata_wb14.json)
#
# Exits 1 only on the things that are unambiguously broken (a sheet the engine requires is absent,
# or a segment label no reader can match), so it is safe to wire into a pre-flight.
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, '..', 'engine')

# The Windows console default codepage mangles the em-dashes below into replacement chars.
try:
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError):
    pass

# Sheets the v4 engine cannot run without. Everything else degrades to a documented fallback.
REQUIRED = ['data_gains', 'data_seg_beh', 'cal_curr', 'cal_new']
# base -> _v2 config pairs. A missing _v2 is NOT an error: the engine reads it as "unchanged".
PAIRS = ['c_saga', 'c_day', 'NS', 'SP', 'SP_lb', 'Race', 'TaD', 'Ki', 'J', 'HH', 'BB', 'Ph',
         'RR', 'F', 'TE', 'RM_1st', 'RM_2nd']
# label vocabularies: data_gains uses the raw buckets, every other sheet the merged labels (D8)
GAINS_SEGS = ['A. 0', 'B. 1-9', 'C. 10-19', 'D. 20-39', 'E. 40-99', 'F. 100+']
MERGED_SEGS = ['0-9', '10-19', '20-39', '40-99', '100+']

ok_count = 0
problems = []
notes = []


def say(tag, label, detail=''):
    global ok_count
    if tag == 'OK':
        ok_count += 1
    print(f'  {tag:5s} {label}' + (f' — {detail}' if detail else ''))


def sheet(data, name):
    s = data.get(name)
    return s['values'] if s and s.get('values') else None


def header_map(vals):
    return {str(c).strip(): i for i, c in enumerate(vals[0]) if str(c).strip()} if vals else {}


def col_values(vals, colname):
    h = header_map(vals)
    if colname not in h:
        return []
    i = h[colname]
    return [r[i] for r in vals[1:] if i < len(r) and str(r[i]).strip() != '']


def fnum(x):
    try:
        return float(str(x).replace(',', ''))
    except (TypeError, ValueError):
        return 0.0


def engine_const(fname, pattern):
    try:
        with open(os.path.join(ENGINE, fname), encoding='utf-8') as f:
            m = re.search(pattern, f.read())
        return int(m.group(1)) if m else None
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', default=os.path.join(HERE, '_mockdata.json'))
    args = ap.parse_args()
    with open(args.json, encoding='utf-8') as f:
        data = json.load(f)

    print('=' * 78)
    print('DATA BASIS —', os.path.basename(args.json))
    print('=' * 78)

    # ---- provenance ------------------------------------------------------------------------
    print('\nPROVENANCE')
    meta = data.get('_meta')
    if not meta:
        say('NOTE', 'no _meta block',
            'dumped before provenance was recorded — re-run harness/_dump_mockdata.py')
        notes.append('mockdata has no provenance block')
    else:
        say('OK', 'source workbook', f"{meta['source']} (modified {meta['source_mtime']})")
        say('OK', 'dumped at', meta['dumped_at'])
        if meta.get('newest_on_disk') and meta['newest_on_disk'] != meta['source']:
            say('WARN', 'a NEWER workbook exists on disk', meta['newest_on_disk'])
            notes.append('the dump is not from the newest workbook on disk')
        if meta.get('missing'):
            say('NOTE', f"{len(meta['missing'])} requested sheet(s) absent from the workbook",
                ', '.join(meta['missing']))

    # ---- sheet inventory -------------------------------------------------------------------
    print('\nSHEETS')
    for name in REQUIRED:
        v = sheet(data, name)
        if v:
            say('OK', name, f'{len(v) - 1} data rows')
        else:
            say('FAIL', name, 'REQUIRED by the engine and absent')
            problems.append(f'{name} missing')

    # ---- window ----------------------------------------------------------------------------
    print('\nWINDOW')
    sim_days = engine_const('EcoGainsSim_v4.gs', r'var SIM_DAYS = (\d+)')
    say('OK', 'engine SIM_DAYS', str(sim_days))
    daily = sheet(data, 'data_econ_daily')
    if not daily:
        say('NOTE', 'data_econ_daily absent', 'the NET blocks stay blank; window not checkable here')
    else:
        days = sorted({int(fnum(d)) for d in col_values(daily, 'day_index')})
        if not days:
            say('WARN', 'data_econ_daily has no day_index values')
        elif len(days) == sim_days:
            say('OK', 'data_econ_daily window matches SIM_DAYS',
                f'{len(days)} days (day_index {days[0]}..{days[-1]})')
        else:
            say('WARN', 'data_econ_daily window DISAGREES with the engine',
                f'{len(days)} day indices ({days[0]}..{days[-1]}) vs SIM_DAYS {sim_days}')
            notes.append(f'data_econ_daily carries {len(days)} days, engine simulates {sim_days}')
    for cal in ('cal_curr', 'cal_new'):
        v = sheet(data, cal)
        if v:
            width = max((len(r) for r in v), default=0)
            say('OK' if width >= sim_days + 1 else 'WARN', f'{cal} grid width',
                f'{width} columns (need >= {sim_days + 1} for {sim_days} day columns)')

    # ---- segment labelling (D8) — the prime suspect when a whole table reads zero -----------
    print('\nSEGMENT LABELS')
    gains = sheet(data, 'data_gains')
    if gains:
        seen = sorted({str(s).strip() for s in col_values(gains, 'engagement_segment')})
        unknown = [s for s in seen if s not in GAINS_SEGS]
        if unknown:
            say('FAIL', 'data_gains has labels no reader can map', ', '.join(unknown))
            problems.append('data_gains segment labels unmappable')
        else:
            say('OK', 'data_gains uses the raw buckets', ', '.join(seen))
        missing = [s for s in GAINS_SEGS if s not in seen]
        if missing:
            say('NOTE', 'buckets with no rows at all', ', '.join(missing))
    beh = sheet(data, 'data_seg_beh')
    if beh:
        seen = sorted({str(s).strip() for s in col_values(beh, 'segment')})
        unknown = [s for s in seen if s not in MERGED_SEGS]
        if unknown:
            say('FAIL', 'data_seg_beh has unexpected labels', ', '.join(unknown))
            problems.append('data_seg_beh segment labels unmappable')
        else:
            say('OK', 'data_seg_beh uses the merged labels', ', '.join(seen))

    # ---- cohort ties -----------------------------------------------------------------------
    print('\nCOHORT')
    beh_pd = sum(fnum(x) for x in col_values(beh, 'player_days')) if beh else 0
    if beh_pd:
        say('OK', 'data_seg_beh player-days', f'{beh_pd:,.0f}')
        streaks = sheet(data, 'data_streaks')
        if streaks:
            st_pd = sum(fnum(x) for x in col_values(streaks, 'player_days'))
            ratio = st_pd / beh_pd if beh_pd else 0
            say('OK' if 0.8 <= ratio <= 1.25 else 'WARN', 'data_streaks vs data_seg_beh',
                f'{st_pd:,.0f} player-days = {ratio:.2f}x')
            if not 0.8 <= ratio <= 1.25:
                notes.append(f'data_streaks is {ratio:.1f}x data_seg_beh — different populations?')

    # ---- model-state switches the data decides ---------------------------------------------
    print('\nWHAT THE DATA SWITCHES ON')
    if gains:
        h = header_map(gains)
        core_spt = 0
        if {'category', 'resource'} <= set(h):
            for r in gains[1:]:
                cat = str(r[h['category']]).strip() if h['category'] < len(r) else ''
                res = str(r[h['resource']]).strip() if h['resource'] < len(r) else ''
                if cat == 'Core' and res == 'SPT':
                    core_spt += 1
        if core_spt:
            say('OK', 'Core SPT rows present', f'{core_spt} rows — the D18 SYNTHETIC anchor stands down')
        else:
            say('NOTE', 'no Core SPT rows in data_gains',
                'the D18 synthetic anchor is ACTIVE (meas = L x E_base); Core SPT is modelled, not measured')
            notes.append('Core SPT is synthetic on this workbook')
    rm_v2 = [n for n in ('RM_1st_v2', 'RM_2nd_v2') if sheet(data, n)]
    if rm_v2:
        say('OK', 'RM proposal ladders present', ', '.join(rm_v2) + ' — the sim side prices these')
    else:
        say('NOTE', 'no RM_1st_v2 / RM_2nd_v2',
            'the RM proposal layer falls back to base (R = 1). Authoring one needs the sheets first.')
        notes.append('RM proposal ladders not authored in this workbook')

    # ---- config pairs ----------------------------------------------------------------------
    print('\nCONFIG PAIRS (missing _v2 = "unchanged", not an error)')
    have, absent = [], []
    for b in PAIRS:
        (have if sheet(data, b + '_v2') else absent).append(b)
    say('OK', f'{len(have)} of {len(PAIRS)} base sheets have a _v2 twin',
        ', '.join(have) if have else '(none)')
    if absent:
        say('NOTE', 'no _v2 twin', ', '.join(absent))

    # ---- verdict ---------------------------------------------------------------------------
    print('\n' + '=' * 78)
    if problems:
        print(f'{len(problems)} PROBLEM(S): ' + '; '.join(problems))
    else:
        print(f'No blocking problems ({ok_count} checks OK).')
    if notes:
        print('\nRead before quoting a number:')
        for n in notes:
            print('  -', n)
    print('=' * 78)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
