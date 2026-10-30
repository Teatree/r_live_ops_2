"""Config-proposal DESIGN (2026-10-30, D79): turns the design rules below into cell patches on the
_v2 config sheets of LIVE_OPS_V3 (8), so the engine probe (harness/_probe_cfgprop.js) and the Excel
builder (builders/_build_cfgprop.py) read ONE set of edits.

Every rule is written against the sheet's own header labels, never a column letter, and every patch
records the value it replaces - the builder colours exactly these cells red.

    python builders/_design_cfgprop.py [--params builders/_cfgprop_params.json]
        -> analysis/out/cfgprop_patches.json

The tunable numbers live in PARAMS (overridable from a JSON file) so a calibration pass changes a
number, not the rules.
"""
import argparse, json, math, os, sys
from openpyxl.utils import get_column_letter as L

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DUMP = os.path.join(ROOT, 'harness', '_mockdata_v3g.json')
OUT = os.path.join(ROOT, 'analysis', 'out', 'cfgprop_patches.json')

PARAMS = {
    # ---- Saga: per node (1..10) of the 100-level chapter cycle
    'saga_nodes': {
        # node: {resource label: value}; HC Reward is zeroed on every segment block separately
        1: {'Unlimited Lives': 25},
        2: {'Red': 1, 'Unlimited Lives': 15},
        3: {'Unlimited Lives': 25},
        4: {'Slingshot': 0, 'Chuck': 1, 'Unlimited Lives': 20},
        5: {'Chuck': 1, 'Unlimited Lives': 20},
        6: {'Comet': 0, 'Bomb': 1, 'Unlimited Lives': 30},
        7: {'Unlimited Lives': 40},
        8: {'Bomb': 1, 'Unlimited Lives': 45},
        9: {'Unlimited Lives': 70},
        10: {'Shuffle': 0, 'Red': 1, '1-star Dly': 1, 'Unlimited Lives': 70},
    },
    # ---- SPT on events (the 50/50 split)
    'rm_spt_mult': 2.0,                       # existing SPT on every RM milestone x this
    'rm_spt_add': {2: 10, 5: 15, 8: 20},      # milestones that paid no SPT get some (early, every segment reaches them)
    'ns_spt': {                               # Night Sky, SPT per round 1/2/3, per segment (weekend AND weekday ladders)
        '0-9': [5, 10, 15], '10-19': [10, 20, 35], '20-39': [15, 30, 50],
        '40-99': [25, 50, 80], '100+': [40, 80, 120]},
    'hh_spt': [10, 20, 40, 60, 100],          # Hatchling gates 1..5
    'j_spt_per_token': 0.10,                  # Jigsaw / Mystery: SPT = this x the milestone's own token step
    'bb_spt_per_token': 0.20,                 # Bomb's Ballet: SPT = this x the reward level's price step
    'ki_spt': [150, 120, 100, 80, 70, 60, 50, 45, 40, 35, 30, 30, 25, 25, 20, 20, 20, 15, 15, 15, 10, 10, 10, 10, 10],
    'ki_ms_spt': 20,                          # Kite score milestone
    'race_spt': [100, 80, 60, 50, 40, 30, 25, 20, 15, 10],   # Red's / Bomb's challenges, Level Race, ranks 1..10
    'tad_spt': [100, 80, 60, 50, 40, 35, 30, 25, 20, 20, 15, 15, 10, 10, 10, 5, 5, 5, 5, 5],
    'scale': {'rm': 1.0, 'ns': 1.0, 'hh': 1.0, 'j': 1.0, 'bb': 1.0, 'ki': 1.0, 'race': 1.0, 'tad': 1.0},
    # ---- Season Pass requirement growth: m(t) = 1 + (M - 1) * ramp(t), ramp 0 at tier 1 -> 1 at tier T0
    'sp_growth_M': 1.5, 'sp_growth_T0': 20, 'sp_growth_gamma': 1.3, 'sp_round': 5,
}


def load(params_path):
    p = json.loads(json.dumps(PARAMS))
    if params_path:
        with open(params_path, encoding='utf-8') as f:
            over = json.load(f)
        for k, v in over.items():
            if isinstance(v, dict) and isinstance(p.get(k), dict):
                p[k].update(v)
            else:
                p[k] = v
    return p


class Sheet:
    def __init__(self, name, data):
        self.name = name
        s = data[name]
        self.v = s['values'] if isinstance(s, dict) else s
        self.patches = []

    def get(self, r, c):                       # 1-based
        row = self.v[r - 1] if r - 1 < len(self.v) else []
        x = row[c - 1] if c - 1 < len(row) else ''
        return '' if x is None else x

    def num(self, r, c):
        try:
            return float(self.get(r, c))
        except (TypeError, ValueError):
            return 0.0

    def set(self, r, c, val, note=''):
        old = self.get(r, c)
        try:
            same = abs(float(old) - float(val)) < 1e-9
        except (TypeError, ValueError):
            same = (str(old) == str(val))
        if same:
            return
        while len(self.v) < r:
            self.v.append([])
        while len(self.v[r - 1]) < c:
            self.v[r - 1].append('')
        self.v[r - 1][c - 1] = val
        self.patches.append({'cell': f'{L(c)}{r}', 'old': old, 'new': val, 'note': note})

    def find_row(self, text, col=1, start=1):
        for r in range(start, len(self.v) + 1):
            if str(self.get(r, col)).strip() == text:
                return r
        return None

    def header_cols(self, r):
        return {str(self.get(r, c)).strip(): c for c in range(1, len(self.v[r - 1]) + 1)
                if str(self.get(r, c)).strip()}


def rnd(x, step=5):
    return int(step * round(float(x) / step))


# ------------------------------------------------------------------------------- Saga
def design_saga(data, P, reasons):
    s = Sheet('c_saga_v2', data)
    h = s.find_row('Node')
    cols = s.header_cols(h)
    hc_cols = [c for c in range(1, len(s.v[h - 1]) + 1) if str(s.get(h, c)).strip() == 'HC Reward']
    for n in range(1, 11):
        r = h + n
        for c in hc_cols:
            s.set(r, c, 0, 'no coins from Saga')
        for lab, val in P['saga_nodes'][str(n)].items():
            s.set(r, cols[lab], val, 'Saga rebalance')
    tot = s.find_row('Total per cycle')
    per = s.find_row('HC per level')
    for c in hc_cols:
        if tot: s.set(tot, c, 0, 'total HC per cycle')
        if per: s.set(per, c, 0, 'HC per level')
    reasons[s.name] = [
        'No coins: HC Reward is 0 on every node of all five segment blocks (60 HC per 100-level cycle before).',
        'No boosters: Slingshot (hammer), Comet (cherry bomb / star) and Shuffle are removed from nodes 4, 6 and 10.',
        'Their place is taken by the power-ups already on the chapter ladder: a second Red, Chuck and Bomb per cycle '
        '(nodes 10, 4 and 6), so each cycle pays 2 Red, 2 Chuck and 2 Bomb.',
        'One low-value envelope per 100 levels: a 1-star envelope on node 10, the rarest node. It is the cheapest '
        'tier (24.5 coin-eq, 2 cards, almost always 1- to 3-star cards). 1 per 100 levels is the rarest the 10-node '
        'cycle allows: about 0.7 a season at 0-9 and about 11 at 100+.',
        'Value is kept: the nodes that lost their coins get more Unlimited Lives (310 -> 360 minutes per cycle). '
        'At item_vals "new" (row 6, the valuation the ToF sheet uses) the cycle is worth 525.0 before and 524.5 after.',
        'No new resource types: Unlimited Lives, Red, Chuck and Bomb were already on the ladder; the envelope is the '
        'one addition you asked for.',
        'Through the engine (which scales each MEASURED chapter reward by its config ratio) the value per player moves '
        '0% at 100+, -1% at 20-39 and -11% at 0-9: the measured chapter rewards of the low segment lean more on '
        'boosters than the ladder implies, so removing them costs that segment more than the cycle average.',
    ]
    return s


# ------------------------------------------------------------------------------- Rainbow Maker
def design_rm(data, P, reasons, name):
    s = Sheet(name, data)
    h = None
    for r in range(1, len(s.v) + 1):
        if str(s.get(r, 1)).strip() == 'Milestone' and str(s.get(r, 3)).strip() == 'Req Accum':
            h = r
            break
    cols = s.header_cols(h)
    c_spt = cols['SPT']
    k = P['rm_spt_mult'] * P['scale']['rm']
    for r in range(h + 1, len(s.v) + 1):
        try:
            m = int(float(s.get(r, 1)))
        except (TypeError, ValueError):
            break
        old = s.num(r, c_spt)
        if old > 0:
            s.set(r, c_spt, rnd(old * k), 'SPT x %.2f' % k)
        elif str(m) in P['rm_spt_add']:
            s.set(r, c_spt, rnd(P['rm_spt_add'][str(m)] * P['scale']['rm']), 'new early SPT')
    reasons[name] = [
        'Every SPT reward on the milestone ladder is multiplied by %.2f, and milestones %s, which paid no SPT, now pay '
        'some. Rainbow Maker is the event whose SPT already scales with how much a player plays (it is 19-22%% of Core '
        'SPT in every segment), so raising it lifts the event share by the same proportion for everyone, engaged '
        'players included.' % (k, ', '.join(str(x) for x in sorted(P['rm_spt_add'], key=int))),
        'The early additions give the low segments, who rarely pass milestone 8, SPT from their first claims.',
    ]
    return s


# ------------------------------------------------------------------------------- Night Sky
def design_ns(data, P, reasons, name):
    s = Sheet(name, data)
    seg_rows = {}
    for r in range(1, len(s.v) + 1):
        lab = str(s.get(r, 1)).strip()
        if lab in P['ns_spt']:
            seg_rows[lab] = r
    for seg, r0 in seg_rows.items():
        h = r0 + 1
        cols = s.header_cols(h)
        for i in range(3):
            s.set(h + 1 + i, cols['SPT'], rnd(P['ns_spt'][seg][i] * P['scale']['ns']), 'NS SPT round %d' % (i + 1))
    reasons[name] = [
        'Each of the three rounds now pays SPT, more on later rounds and more in the higher segments (whose streak '
        'requirements are higher). Night Sky runs every day, so this is the source that makes the SPT split felt '
        'DAILY rather than only over the season.',
        'Per round (0-9 / 10-19 / 20-39 / 40-99 / 100+): ' + '; '.join(
            seg + ' ' + '/'.join(str(rnd(x * P['scale']['ns'])) for x in P['ns_spt'][seg]) for seg in P['ns_spt']) + '.',
    ]
    return s


# ------------------------------------------------------------------------------- collections
def design_hh(data, P, reasons):
    s = Sheet('HH_v2', data)
    h = s.find_row('Gate number')
    cols = s.header_cols(h)
    for i, v in enumerate(P['hh_spt']):
        s.set(h + 1 + i, cols['SPT'], rnd(v * P['scale']['hh']), 'HH SPT')
    reasons['HH_v2'] = ['Every gate pays SPT, rising with the gate (%s). Hatchling runs Thursday to Sunday, so it '
                        'carries SPT into the days Rainbow Maker does not cover.' % '/'.join(
                            str(rnd(v * P['scale']['hh'])) for v in P['hh_spt'])]
    return s


def design_token_ladder(data, P, reasons, name, hdr_text, req_label, per_token, scale_key, label):
    s = Sheet(name, data)
    h = s.find_row(hdr_text)
    cols = s.header_cols(h)
    prev = 0.0
    vals = []
    for r in range(h + 1, len(s.v) + 1):
        try:
            float(s.get(r, 1))
        except (TypeError, ValueError):
            break
        req = s.num(r, cols[req_label])
        step = req - prev                      # both ladders carry the CUMULATIVE requirement
        prev = req
        v = max(5, rnd(step * per_token * P['scale'][scale_key]))
        vals.append(v)
        s.set(r, cols['SPT'], v, label + ' SPT')
    reasons[name] = ['Every milestone pays SPT in proportion to its own token step (%.2f SPT per token, %s), so a '
                     'player earns SPT at a steady rate for as long as they keep playing the event - the deeper '
                     'milestones engaged players reach pay the most.' % (per_token * P['scale'][scale_key],
                                                                        '/'.join(str(x) for x in vals))]
    return s


# ------------------------------------------------------------------------------- leaderboards
def design_rank(data, P, reasons, name, hdr_row, label_col, ranks, scale_key, title, first_label='Position'):
    s = Sheet(name, data)
    cols = s.header_cols(hdr_row)
    c = cols['SPT']
    for i, v in enumerate(ranks):
        s.set(hdr_row + 1 + i, c, rnd(v * P['scale'][scale_key]), title + ' rank %d' % (i + 1))
    return s, [rnd(v * P['scale'][scale_key]) for v in ranks]


def design_race(data, P, reasons):
    s = Sheet('Race_v2', data)
    out = []
    for title in ("Red's Challenge", "Bomb's Challenge", 'Level Challenge'):
        r0 = s.find_row(title + ' - Goals and Rewards')
        h = r0 + 1
        cols = s.header_cols(h)
        vals = [rnd(v * P['scale']['race']) for v in P['race_spt']]
        for i, v in enumerate(vals):
            s.set(h + 1 + i, cols['SPT'], v, title + ' SPT')
        out.append(title)
    reasons['Race_v2'] = ["Red's Challenge, Bomb's Challenge and Level Race pay SPT on ranks 1-10 (%s). These are the "
                          'Monday-to-Wednesday events of three of the four weeks, so their SPT lands early in the '
                          'week, alongside Rainbow Maker. (Chuck\'s Challenge is not on the A/B calendar, so its '
                          'block is unchanged; Flash Race is not touched - see PROBLEMS: its rewards are counted '
                          'under Team Race in the data, so the model cannot see a change to it.)' %
                          '/'.join(str(rnd(v * P['scale']['race'])) for v in P['race_spt'])]
    return s


def design_tad(data, P, reasons):
    s = Sheet('TaD_v2', data)
    h = s.find_row('LB#')
    cols = s.header_cols(h)
    vals = [rnd(v * P['scale']['tad']) for v in P['tad_spt']]
    for i, v in enumerate(vals):
        s.set(h + 1 + i, cols['SPT'], v, 'TaD SPT')
    reasons['TaD_v2'] = ['Every rank of the leaderboard pays SPT (%s). Target Day runs Friday to Sunday every week, '
                         'so it carries SPT into the weekend days.' % '/'.join(str(v) for v in vals)]
    return s


def design_kite(data, P, reasons):
    s = Sheet('Ki_v2', data)
    h = s.find_row('Position')
    cols = s.header_cols(h)
    vals = [rnd(v * P['scale']['ki']) for v in P['ki_spt']]
    for i, v in enumerate(vals):
        s.set(h + 1 + i, cols['SPT'], v, 'Kite SPT')
    hm = s.find_row('Milestone')
    cm = s.header_cols(hm)
    s.set(hm + 1, cm['SPT'], rnd(P['ki_ms_spt'] * P['scale']['ki']), 'Kite milestone SPT')
    reasons['Ki_v2'] = ['The top 25 positions pay SPT (%s) and the score milestone pays %d. Kite runs Monday to '
                        'Wednesday every week. NOTE the envelope lane prices Kite at the 0.35 opt-in assumption '
                        '(D25), and SPT added here is priced the same way - see PROBLEMS.' %
                        ('/'.join(str(v) for v in vals), rnd(P['ki_ms_spt'] * P['scale']['ki']))]
    return s


# ------------------------------------------------------------------------------- Season Pass
def design_sp(data, P, reasons):
    s = Sheet('SP_v2', data)
    h = None
    for r in range(1, len(s.v) + 1):
        if str(s.get(r, 1)).strip() == 'Tier' and str(s.get(r, 3)).strip() == 'Cumul':
            h = r
            break
    M, T0, g, step = P['sp_growth_M'], P['sp_growth_T0'], P['sp_growth_gamma'], P['sp_round']
    cum = 0
    rows = []
    for t in range(1, 31):
        r = h + t
        inc = s.num(r, 2)
        ramp = min(1.0, ((t - 1) / float(T0 - 1)) ** g) if t > 1 else 0.0
        m = 1 + (M - 1) * ramp
        new_inc = max(step, rnd(inc * m, step))
        cum += new_inc
        rows.append((t, inc, new_inc, cum))
        s.set(r, 2, new_inc, 'SPT requirement x %.2f' % m)
        s.set(r, 3, cum, 'cumulative requirement')
    reasons['SP_v2'] = [
        'Tier requirements rise by a factor that starts at 1.0 on tier 1 and ramps to %.2f by tier %d (ramp exponent '
        '%.1f), so the lower tiers stay where they were - and arrive sooner, because events now pay SPT - while the '
        'upper tiers grow by about as much as total SPT does and are reached roughly when they were before. '
        'Tier 30 now needs %d SPT (3557 before).' % (M, T0, g, cum),
    ]
    return s, rows



# ------------------------------------------------------------------------------- Season Pass envelopes
PACK_LABELS = ['1-star Dly', '2-star Dly', '3-star Dly', '4-star Dly', '5-star Dly', '6-star Dly']


def design_sp_envelopes(s, P, reasons):
    """s: the SP_v2 Sheet already carrying the requirement edits. Free = first pack block, Paid = second."""
    h = None
    for r in range(1, len(s.v) + 1):
        if str(s.get(r, 1)).strip() == 'Tier' and str(s.get(r, 3)).strip() == 'Cumul':
            h = r
            break
    hdr = [str(s.get(h, c)).strip() for c in range(1, len(s.v[h - 1]) + 1)]
    free = {lab: hdr.index(lab) + 1 for lab in PACK_LABELS}                     # first occurrence
    paid = {lab: len(hdr) - hdr[::-1].index(lab) for lab in PACK_LABELS}       # last occurrence
    for track, cols in (('free', free), ('paid', paid)):
        plan = P['sp_env'][track]
        for t in range(1, 31):
            want = plan.get(str(t), {})
            for lab in PACK_LABELS:
                s.set(h + t, cols[lab], want.get(lab, 0), 'SP %s envelopes' % track)

    def summary(track):
        n = {}
        for t, d in P['sp_env'][track].items():
            for lab, k in d.items():
                n[lab] = n.get(lab, 0) + k
        return ', '.join('%d x %s' % (n[l], l.replace(' Dly', '')) for l in PACK_LABELS if n.get(l))
    reasons['SP_v2'] = reasons.get('SP_v2', []) + [
        'Free track envelopes, before: 1 x 1-star, 1 x 2-star, 2 x 3-star (4 envelopes, 13 cards). After: %s - more, '
        'cheaper envelopes spread over the whole track, one 3-star kept on tier 30 as the finish.' % summary('free'),
        'Paid track envelopes, before: 2 x 2-star, 2 x 3-star, 1 x 4-star, 1 x 5-star (6 envelopes, 25 cards). After: %s. '
        'No Legendary (5-star) on the pass any more - the deck reserves them for event winners and ToF - and about '
        'twice the cards, which is the paid track part in getting spenders through album 2.' % summary('paid'),
    ]


# ------------------------------------------------------------------------------- ToF
TOF_RES = ['Coins', 'SPT', 'SPT x2', 'Red', 'Chuck', 'Bomb', 'Slingshot', 'Shuffle', 'Comet', 'Unlimited Lives',
           'Unlimited Red', 'Unlimited Chuck', 'Unlimited Bomb', 'COOP Token', 'Avatar'] + PACK_LABELS + ['ToF_Ticket']


def design_tof(data, P, reasons):
    s = Sheet('ToF_v2', data)
    h = None
    for r in range(1, len(s.v) + 1):
        if str(s.get(r, 1)).strip() == 'Stage' and str(s.get(r, 2)).strip() == 'Type':
            h = r
            break
    cols = s.header_cols(h)
    rows_by_stage = {}
    for r in range(h + 1, len(s.v) + 1):
        try:
            n = int(float(s.get(r, 1)))
        except (TypeError, ValueError):
            break
        rows_by_stage.setdefault(n, []).append(r)
    for st, doors in P['tof_stages'].items():
        rows = rows_by_stage[int(st)]
        assert len(rows) == len(doors), 'stage %s has %d door rows, design has %d' % (st, len(rows), len(doors))
        for r, door in zip(rows, doors):
            kind = 'pig' if door.get('kind') == 'pig' else 'reward'
            s.set(r, cols['card type'], kind, 'ToF door')
            if door.get('p') is not None:
                s.set(r, cols['p'], door['p'], 'ToF door probability')
            if kind == 'pig':
                continue
            for lab in TOF_RES:
                if lab in cols:
                    s.set(r, cols[lab], door.get(lab, 0), 'ToF door reward')
    if P.get('tof_cashout') is not None:
        sb = s.find_row('SEGMENT BEHAVIOUR')
        hb = sb + 1
        cb = s.header_cols(hb)
        for r in range(hb + 1, hb + 12):
            if str(s.get(r, 1)).strip() in ('0-9', '10-19', '20-39', '40-99', '100+'):
                s.set(r, cb['Cash-Out Stage'], P['tof_cashout'], 'calibration: measured cash-out stage')
    reasons['ToF_v2'] = P.get('tof_reasons', [])
    return s


# ------------------------------------------------------------------------------- PackConfig
def design_pack(data, P, reasons):
    s = Sheet('PackConfig_v2', data)
    pc = P['pack']
    if 'skew' in pc:
        b = s.find_row('ALBUM SET SKEW')
        for r in range(b + 1, b + 8):
            lab = str(s.get(r, 1)).strip()
            if lab in pc['skew']:
                for i, v in enumerate(pc['skew'][lab]):
                    s.set(r, 2 + i, v, 'album set skew')
        w = s.find_row('WEIGHT DETAILS')
        if w:
            for r in range(w + 1, w + 6):
                lab = str(s.get(r, 1)).strip()
                key = {'ChapterWeights, 1st album': 'Album 1', 'ChapterWeights, 2+ album': 'Album 2'}.get(lab)
                if key and key in pc['skew']:
                    for i, v in enumerate(pc['skew'][key]):
                        s.set(r, 2 + i, v, 'weight details mirror')
    for block, key in (('PACK DEFINITIONS', 'defs'), ('PACK PITY CONFIG', 'pity'),
                       ('STAR CHEST COSTS & REWARDS', 'chests')):
        if key not in pc:
            continue
        b = s.find_row(block)
        hc = s.header_cols(b + 1)
        for r in range(b + 2, b + 9):
            lab = str(s.get(r, 1)).strip()
            if lab in pc[key]:
                for k, v in pc[key][lab].items():
                    s.set(r, hc[k], v, block.lower())
    reasons['PackConfig_v2'] = pc.get('reasons', [])
    return s

# ------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--params', default=None)
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    P = load(a.params)
    with open(DUMP, encoding='utf-8') as f:
        data = json.load(f)
    reasons = {}
    sheets = [design_saga(data, P, reasons),
              design_rm(data, P, reasons, 'RM_1st_v2'), design_rm(data, P, reasons, 'RM_2nd_v2'),
              design_ns(data, P, reasons, 'NS_v2'), design_ns(data, P, reasons, 'NS_v2_weekday'),
              design_hh(data, P, reasons),
              design_token_ladder(data, P, reasons, 'J_v2', 'Milestone', 'Cumul token req', P['j_spt_per_token'], 'j', 'Jigsaw'),
              design_token_ladder(data, P, reasons, 'BB_v2', 'Reward level', 'price', P['bb_spt_per_token'], 'bb', "Bomb's Ballet"),
              design_kite(data, P, reasons), design_race(data, P, reasons), design_tad(data, P, reasons)]
    sp, sp_rows = design_sp(data, P, reasons)
    if P.get('sp_env'):
        design_sp_envelopes(sp, P, reasons)
    sheets.append(sp)
    if P.get('tof_stages'):
        sheets.append(design_tof(data, P, reasons))
    if P.get('pack'):
        sheets.append(design_pack(data, P, reasons))
    out = {'params': P, 'patches': {}, 'reasons': reasons, 'sp_rows': sp_rows}
    for s in sheets:
        if s.patches:
            out['patches'][s.name] = s.patches
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, default=str)
    n = sum(len(v) for v in out['patches'].values())
    print('written %s: %d cells on %d sheets' % (a.out, n, len(out['patches'])))
    for k, v in out['patches'].items():
        print('  %-16s %3d cells' % (k, len(v)))


if __name__ == '__main__':
    main()
