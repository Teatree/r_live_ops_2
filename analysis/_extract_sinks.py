# Where coins GO, and where the low segments' coins come FROM — the two facts the v3 proposals
# stand on that no other pipeline step extracts.
#
# Inputs (workbooks/, the 9-day A/B exports):
#   resource_spend_by_segment_9d.csv — spend side: segment x arm x action/context, amounts + events
#   resource_gains_by_segment_9d.csv — gain side: segment x arm x source_detail
# Output: analysis/out/sinks.json
#   sinks    : HC spend by action and by context, both arms, share of total, delta
#   continue : per segment — coins per continue event, continues per 1000 player-days, coins/pd
#   sources  : per segment — top HC and UnlimitedLives sources per active player-day, both arms
#   exposure : distinct paying sources per segment (event-exposure proxy)
#
# Usage: python analysis/_extract_sinks.py
import csv
import json
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
WB = os.path.join(HERE, '..', 'workbooks')
ARMS = ('Control', 'Variant')
SEG_ORDER = ['A. 0', 'B. 1-9', 'C. 10-19', 'D. 20-39', 'E. 40-99', 'F. 100+']


def read(name):
    with open(os.path.join(WB, name), encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def free_amount(r):
    """Currency rows carry amount_gained_free; item rows leave it blank (then amount_gained is
    free unless the row is a purchase). Same convention as _extract_actuals.py."""
    f = r.get('amount_gained_free')
    if f not in (None, '', 'NULL'):
        return num(f)
    return 0.0 if (r.get('action') or '') == 'purchase' else num(r.get('amount_gained'))


def main():
    spend = read('resource_spend_by_segment_9d.csv')
    gains = read('resource_gains_by_segment_9d.csv')
    out = {}

    # ---- sinks: what coins are spent on -----------------------------------------------------
    for key, field in (('by_action', 'action'), ('by_context', 'spend_context')):
        agg = defaultdict(lambda: defaultdict(float))
        for r in spend:
            if r['resource'] != 'HardCoin':
                continue
            agg[r[field] or '(blank)'][r['ab_group']] += num(r['amount_spent'])
        tot = {a: sum(v[a] for v in agg.values()) for a in ARMS}
        rows = []
        for k, v in sorted(agg.items(), key=lambda kv: -kv[1]['Control']):
            rows.append({'key': k, 'control': v['Control'], 'variant': v['Variant'],
                         'share_control': v['Control'] / tot['Control'] if tot['Control'] else None,
                         'd_pct': (v['Variant'] / v['Control'] - 1) if v['Control'] else None})
        out[key] = {'rows': rows, 'total': tot,
                    'total_d_pct': tot['Variant'] / tot['Control'] - 1 if tot['Control'] else None}

    # ---- the continue: price and frequency --------------------------------------------------
    cont = defaultdict(lambda: defaultdict(lambda: {'amt': 0.0, 'events': 0.0, 'pdays': 0.0}))
    for r in spend:
        if r['resource'] != 'HardCoin' or r['action'] != 'extra_moves':
            continue
        c = cont[r['segment']][r['ab_group']]
        c['amt'] += num(r['amount_spent'])
        c['events'] += num(r['spend_events'])
        c['pdays'] = max(c['pdays'], num(r['player_days']))
    continue_rows = {}
    for seg, arms in cont.items():
        continue_rows[seg] = {}
        for arm, c in arms.items():
            if not c['events']:
                continue
            continue_rows[seg][arm] = {
                'coins_per_continue': c['amt'] / c['events'],
                'continues_per_1000_player_days': 1000 * c['events'] / c['pdays'] if c['pdays'] else None,
                'coins_per_player_day': c['amt'] / c['pdays'] if c['pdays'] else None}
    out['continue'] = continue_rows

    # ---- sources: where each segment's faucet comes from ------------------------------------
    src = {}
    for res in ('HardCoin', 'UnlimitedLives'):
        per_seg = {}
        for seg in SEG_ORDER:
            agg = defaultdict(lambda: defaultdict(float))
            for r in gains:
                if r['resource'] != res or r['segment'] != seg:
                    continue
                agg[r['source_detail']][r['ab_group']] += num(r['amount_per_active_player_day'])
            tot = {a: sum(v[a] for v in agg.values()) for a in ARMS}
            rows = []
            for k, v in sorted(agg.items(), key=lambda kv: -max(kv[1]['Control'], kv[1]['Variant'])):
                if max(v['Control'], v['Variant']) < 0.01 * max(tot['Control'], 1e-9):
                    continue
                rows.append({'source': k, 'control': v['Control'], 'variant': v['Variant'],
                             'share_control': v['Control'] / tot['Control'] if tot['Control'] else None,
                             'd_pct': (v['Variant'] / v['Control'] - 1) if v['Control'] > 1e-9 else None})
            per_seg[seg] = {'rows': rows[:10], 'total': tot,
                            'total_d_pct': (tot['Variant'] / tot['Control'] - 1) if tot['Control'] else None}
        src[res] = per_seg
    out['sources'] = src

    # ---- exposure proxy ---------------------------------------------------------------------
    ex = defaultdict(lambda: defaultdict(set))
    for r in gains:
        if free_amount(r) > 0:
            ex[r['segment']][r['ab_group']].add(r['source_detail'])
    out['exposure'] = {seg: {arm: sorted(v) for arm, v in arms.items()} for seg, arms in ex.items()}

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'sinks.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)

    # gates: the continue must be a single flat price (the whole point of proposal P6), and the
    # action split must account for essentially all coin spend.
    prices = {round(v[a]['coins_per_continue'], 2)
              for v in continue_rows.values() for a in v}
    top = out['by_action']['rows'][0]
    print(f'HC spend total: C {out["by_action"]["total"]["Control"]:,.0f} -> '
          f'V {out["by_action"]["total"]["Variant"]:,.0f} ({out["by_action"]["total_d_pct"]:+.1%})')
    print(f'top action: {top["key"]} = {top["share_control"]:.1%} of coin spend ({top["d_pct"]:+.1%})')
    print(f'distinct continue prices observed: {sorted(prices)}')
    print(f'segments with continue data: {sorted(continue_rows)}')
    print('written analysis/out/sinks.json')
    if len(prices) != 1:
        print('NOTE: continue price is not flat across segments/arms — proposal P6 must say so')


if __name__ == '__main__':
    main()
