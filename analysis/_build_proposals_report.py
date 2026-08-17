# Build the v3 economy design report (bluish theme) from the extracted A/B facts + engine pricing.
#
# Reads (nothing is hand-typed; every figure in the HTML comes from these):
#   analysis/out/ab_summary.json       — the A/B summary workbook, reshaped (_extract_ab_summary.py)
#   analysis/out/sinks.json            — coin sinks, continue economics, per-segment sources
#   analysis/out/proposal_pricing.json — engine-priced scenarios + NS reach model-vs-measured
#   analysis/out/comparison.json       — faucet context from the sim-vs-actual pipeline
#
# Writes: reports/LiveOps_v3_economy_playbook.html  (+ analysis/out/proposals_body.html for the
# artifact, same content without the standalone document shell)
#
# Usage: python analysis/_build_proposals_report.py
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
REPORTS = os.path.join(HERE, '..', 'reports')

AB = json.load(open(os.path.join(OUT, 'ab_summary.json'), encoding='utf-8'))
SK = json.load(open(os.path.join(OUT, 'sinks.json'), encoding='utf-8'))
PR = json.load(open(os.path.join(OUT, 'proposal_pricing.json'), encoding='utf-8'))
CMP = json.load(open(os.path.join(OUT, 'comparison.json'), encoding='utf-8'))

BUCKETS = ['1-9', '10-19', '20-39', '40-99', '100+']        # bucket 0 handled separately
SEGS = ['0-9', '10-19', '20-39', '40-99', '100+']           # sim segment labels
SEG_OF_BUCKET = dict(zip(BUCKETS, SEGS))
GAINS_SEG = {'1-9': 'B. 1-9', '10-19': 'C. 10-19', '20-39': 'D. 20-39',
             '40-99': 'E. 40-99', '100+': 'F. 100+', '0': 'A. 0'}

# ---------------------------------------------------------------- accessors
def pop(metric, key='all', field='d_pct'):
    m = AB['population'].get(key, {}).get(metric)
    return None if m is None else m.get(field)

def buck(metric, bucket, field='d_pct'):
    m = AB['buckets'].get(bucket, {}).get(metric)
    return None if m is None else m.get(field)

def nsc(row, bucket):
    r = AB['ns_config'].get(row)
    return None if r is None else r['by_segment'].get(bucket)

def sc(sid):
    return PR['scenarios'][sid]

def hc_cost(sid):
    return sc(sid)['resources']['HC']['delta_papd_overall']

FAUCET = sc('BASE')['resources']['HC']['control_faucet_papd']

def esc(s):
    return html.escape(str(s), quote=True)

def f(x, nd=2, plus=False):
    if x is None:
        return '—'
    return f'{x:+,.{nd}f}' if plus else f'{x:,.{nd}f}'

def pc(x, nd=1, plus=True):
    if x is None:
        return '—'
    return f'{100 * x:+.{nd}f}%' if plus else f'{100 * x:.{nd}f}%'

# ---------------------------------------------------------------- design tokens
C = dict(
    ground='#0B1220', surface='#121C2E', surface2='#17233B', line='#22314C', line2='#2C3E5E',
    ink='#E7EEF9', ink2='#AABDD9', mut='#7A8FB0',
    model='#5B9CE6',      # engine / simulated
    live='#E0895B',       # measured live
    good='#55C77E',       # free / validated
    warn='#E0B34C',       # costs coins
    bad='#E0685C',        # the problem
    bench='#9B8BE8',      # benchmark citations
)

# ---------------------------------------------------------------- svg helpers
def svg(w, h, body, maxw=None):
    mw = maxw or w
    return (f'<svg viewBox="0 0 {w} {h}" width="100%" style="max-width:{mw}px" role="img" '
            f'aria-hidden="false">{body}</svg>')

def txt(x, y, s, size=11, fill=None, anchor='start', weight=400, mono=True):
    fam = ("font-family:'Cascadia Mono',Consolas,monospace;" if mono
           else "font-family:var(--body);")
    return (f'<text x="{x:.1f}" y="{y:.1f}" style="{fam}font-size:{size}px;font-weight:{weight}" '
            f'fill="{fill or C["ink2"]}" text-anchor="{anchor}">{esc(s)}</text>')

def rect(x, y, w, h, fill, extra=''):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(0.0, w):.1f}" height="{max(0.0, h):.1f}" fill="{fill}" {extra}/>'

def paired_bars(rows, series, title, unit='', w=760, rowh=30, labw=92, fmt=lambda v: f'{v:+.1f}'):
    """rows = [(label, [v1, v2...])]; series = [(name, colour)] — signed horizontal bars."""
    h = 34 + len(rows) * rowh + 24
    vmax = max((abs(v) for _, vs in rows for v in vs if v is not None), default=1) or 1
    plot = w - labw - 74
    zero = labw + plot / 2
    o = [txt(0, 12, title, 11.5, C['ink'], weight=650, mono=False)]
    o.append(f'<line x1="{zero}" y1="26" x2="{zero}" y2="{34 + len(rows) * rowh}" stroke="{C["line2"]}"/>')
    for i, (lab, vs) in enumerate(rows):
        y0 = 32 + i * rowh
        o.append(txt(labw - 8, y0 + rowh / 2 + 1, lab, 10.5, C['ink2'], anchor='end'))
        bh = (rowh - 12) / max(1, len(vs))
        for j, v in enumerate(vs):
            if v is None:
                continue
            wd = abs(v) / vmax * (plot / 2 - 6)
            x = zero if v >= 0 else zero - wd
            y = y0 + 5 + j * bh
            o.append(rect(x, y, wd, bh - 1.5, series[j][1]))
            o.append(txt(zero + (wd + 5 if v >= 0 else -wd - 5), y + bh - 3.5,
                         fmt(v), 9.5, series[j][1], anchor='start' if v >= 0 else 'end'))
    leg = ' '.join(f'<tspan fill="{col}">■</tspan> <tspan fill="{C["mut"]}">{esc(n)}</tspan>'
                   for n, col in series)
    if unit:
        leg += f' <tspan fill="{C["mut"]}">{esc(unit)}</tspan>'
    o.append(f'<text x="{labw}" y="{h - 6}" style="font-family:var(--body);font-size:10.5px">{leg}</text>')
    return svg(w, h, ''.join(o))

def column_chart(cats, series, title, w=760, h=210, fmt=lambda v: f'{v:.0f}'):
    """cats = [label]; series = [(name, colour, [values])] — grouped vertical columns."""
    padl, padb, padt = 42, 34, 30
    plotw, ploth = w - padl - 14, h - padb - padt
    vmax = max((v for _, _, vs in series for v in vs if v is not None), default=1) or 1
    o = [txt(0, 12, title, 11.5, C['ink'], weight=650, mono=False)]
    for gl in range(5):
        y = padt + ploth - gl / 4 * ploth
        o.append(f'<line x1="{padl}" y1="{y:.1f}" x2="{w - 14}" y2="{y:.1f}" stroke="{C["line"]}"/>')
        o.append(txt(padl - 6, y + 3, fmt(vmax * gl / 4), 9, C['mut'], anchor='end'))
    gw = plotw / len(cats)
    bw = min(26, (gw - 12) / len(series))
    for i, cat in enumerate(cats):
        cx = padl + i * gw + gw / 2
        o.append(txt(cx, padt + ploth + 15, cat, 10, C['ink2'], anchor='middle'))
        for j, (_, col, vs) in enumerate(series):
            v = vs[i]
            if v is None:
                continue
            bh = v / vmax * ploth
            x = cx - (len(series) * bw) / 2 + j * bw
            o.append(rect(x, padt + ploth - bh, bw - 2, bh, col))
            if bh > 14:
                o.append(txt(x + (bw - 2) / 2, padt + ploth - bh - 4, fmt(v), 8.5, col, anchor='middle'))
    leg = ' '.join(f'<tspan fill="{col}">■</tspan> <tspan fill="{C["mut"]}">{esc(n)}</tspan>'
                   for n, col, _ in series)
    o.append(f'<text x="{padl}" y="{h - 4}" style="font-family:var(--body);font-size:10.5px">{leg}</text>')
    return svg(w, h, ''.join(o))

# ---------------------------------------------------------------- components
def chip(text, kind='mut', title=''):
    return f'<span class="chip {kind}" title="{esc(title)}">{esc(text)}</span>'

def kpi(label, value, sub, tone='ink'):
    return (f'<div class="kpi"><div class="kl">{label}</div>'
            f'<div class="kv" style="color:{C[tone]}">{value}</div><div class="ks">{sub}</div></div>')

def table(headers, rows, cls='', note=''):
    th = ''.join(f'<th>{h}</th>' for h in headers)
    tb = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    n = f'<p class="tnote">{note}</p>' if note else ''
    return f'<div class="tw"><table class="{cls}"><thead><tr>{th}</thead><tbody>{tb}</tbody></table></div>{n}'

def bench(source_type, text):
    """source_type: 'published' | 'observed' | 'inference' — the label Garry asked for."""
    lab = {'published': 'published', 'observed': 'observed design', 'inference': 'inference'}[source_type]
    return (f'<div class="bench"><span class="bl {source_type}">{lab}</span>'
            f'<div class="bt">{text}</div></div>')

def proposal(pid, title, area, state, cost, thesis, evidence, change, benchmarks, risk, wide=None):
    """state: ('priced'|'model'|'gap'|'flag', label). cost: HTML string or None.
    wide: evidence too wide for the two-column grid (a table of 6+ columns) — rendered full width
    above the grid rather than squeezed into a 400px column with a scrollbar."""
    skind, slabel = state
    cost_html = f'<div class="pcost">{cost}</div>' if cost else ''
    wide_html = f'<div class="pwide">{wide}</div>' if wide else ''
    return f'''<article class="prop" id="{pid}">
<header class="ph">
  <div class="pid">{pid}</div>
  <div class="pt"><h4>{title}</h4>
    <div class="pmeta">{chip(area, 'area')}{chip(slabel, skind)}</div></div>
</header>
<p class="thesis">{thesis}</p>
{wide_html}
<div class="pgrid">
  <section class="pb"><h5>What the data says</h5>{evidence}</section>
  <section class="pb"><h5>What to change, exactly</h5>{change}</section>
</div>
<div class="pb bwrap"><h5>Evidence from comparable games</h5>{''.join(benchmarks)}</div>
{cost_html}
<div class="prisk"><span class="rl">Risk / watch-out</span> {risk}</div>
</article>'''

# ================================================================ headline numbers
rev_all, rev_new, rev_old = pop('Total revenue'), pop('Total revenue', 'new'), pop('Total revenue', 'old')
streak_all = pop('Avg daily streak')
spend_all = pop('HC spent / player')
spend_att = pop('HC spent / attempt')
gain_all = pop('HC gain total / player')
churn_new = pop('D1 churn rate', 'new')
time_new = pop('Time spent (mins)', 'new')
compl_new = pop('Level completes / player', 'new')
time_old = pop('Time spent (mins)', 'old')
booster_new = pop('Booster gain total / player', 'new')

KPIS = ''.join([
    kpi('New users — level completes / player',
        pc(compl_new), f'time spent {pc(time_new)} · D1 churn {pc(churn_new)} · '
        f'free boosters {pc(booster_new)}', 'bad'),
    kpi('Avg daily streak', pc(streak_all),
        f'100+ {pc(buck("Avg daily streak", "100+"))} · P75 {pc(pop("P75 daily streak"))} · '
        f'P99 {pc(pop("P99 daily streak"))}', 'bad'),
    kpi('Coins spent / player', pc(spend_all),
        f'per attempt {pc(spend_att)} · faucet {pc(gain_all)} · '
        f'net {pc(pop("HC net (gain - spend) / player"))}', 'bad'),
    kpi('Revenue', pc(rev_all),
        f'100+ {pc(buck("Total revenue", "100+"))} · ARPPU {pc(pop("ARPPU"))} · '
        f'paid coins {pc(pop("HC gain PAID / player"))}', 'bad'),
])

# ================================================================ diagnosis charts
sub_rows = []
for b in BUCKETS:
    hc = SK['sources']['HardCoin'][GAINS_SEG[b]]['total_d_pct']
    ul = SK['sources']['UnlimitedLives'][GAINS_SEG[b]]['total_d_pct']
    sub_rows.append((b, [100 * hc if hc is not None else None, 100 * ul if ul is not None else None]))
SUBST = paired_bars(sub_rows, [('coins / active player-day', C['bad']),
                               ('unlimited-lives minutes / active player-day', C['model'])],
                    'The v2 swap, per segment: coins out, free lives in',
                    unit='(% change, Variant vs Control)', fmt=lambda v: f'{v:+.0f}%')

sink_rows = [(r['key'].replace('purchase_', '').replace('_', ' '),
              [100 * r['share_control']]) for r in SK['by_action']['rows'] if r['share_control'] > 0.001]
SINKS = paired_bars(sink_rows, [('share of all coin spend', C['warn'])],
                    'Every coin players spend, by what they spend it on (Control)',
                    unit='(% of coin spend)', fmt=lambda v: f'{v:.1f}%')

gift_base = [r['hc'] for r in PR['ladders']['c_day']]
gift_v2 = [r['hc'] for r in PR['ladders']['c_day_v2']]
GIFT = column_chart([f'day {i + 1}' for i in range(7)],
                    [('Control ladder (c_day)', C['live'], gift_base),
                     ('v2 ladder (c_day_v2)', C['bad'], gift_v2)],
                    'Daily gift: the first six rungs carried the cut, day 7 did not')

claim_series = []
for i, col in enumerate([C['good'], C['warn'], C['bad']]):
    claim_series.append((f'round {i + 1}', col,
                         [nsc(f'Claim rate / player-day - R{i + 1} (%)', b) for b in BUCKETS]))
NS_CLAIM = column_chart(BUCKETS, claim_series,
                        'Night Sky: how often each round is actually claimed (% of player-days)',
                        fmt=lambda v: f'{v:.0f}')

# ---- NS reallocation arithmetic (Garry's own delivery model: claim rate x reward) -------------
realloc_rows = []
for b in BUCKETS:
    cr = [nsc(f'Claim rate / python{i}', b) for i in ()]  # placeholder removed below
for b in BUCKETS:
    cr = [nsc(f'Claim rate / player-day - R{i} (%)', b) for i in (1, 2, 3)]
    cur = [nsc(f'Current HC reward - R{i}', b) for i in (1, 2, 3)]
    new = [nsc(f'NEW HC reward - R{i}', b) for i in (1, 2, 3)]
    if None in cr or None in cur or None in new:
        continue
    nominal_add = sum(new) - sum(cur)
    delivered = sum((new[i] - cur[i]) * cr[i] / 100 for i in range(3))
    if_on_r1 = nominal_add * cr[0] / 100
    realloc_rows.append([
        f'<b>{b}</b>',
        f'{cr[0]:.1f}% / {cr[1]:.1f}% / {cr[2]:.1f}%',
        ' / '.join(f'{int(v)}' for v in cur),
        ' / '.join(f'{int(v)}' for v in new),
        f'+{int(nominal_add)}',
        f'<b style="color:{C["live"]}">{delivered:+.2f}</b>',
        f'<b style="color:{C["good"]}">{if_on_r1:+.2f}</b>',
        (f'<b>×{if_on_r1 / delivered:.1f}</b>' if delivered > 0.001 else '—'),
    ])
REALLOC = table(
    ['segment', 'claim rate R1 / R2 / R3', 'coins now', 'coins proposed', 'nominal added',
     'delivered coins/pd', 'if the same total sat on R1', 'gain'],
    realloc_rows, cls='num',
    note='Delivery = Σ (claim rate of the round × coins on that round) — the identity your own '
         'NS_Config_Change_Est sheet uses (its “NS HC with new Config” row reproduces exactly '
         'from these three claim rates). The last two columns hold the nominal budget constant '
         'and only move it to the round players actually reach.')

# ---- model vs measured reach ------------------------------------------------------------------
reach_rows = []
for seg in SEGS:
    rows = PR['ns_reach_check'].get(seg)
    if not rows:
        continue
    for r in rows:
        ratio = r.get('ratio')
        tone = C['bad'] if (ratio is None or ratio > 1.4 or ratio < 0.7) else C['good']
        reach_rows.append([
            f'<b>{seg}</b>' if r['round'] == 1 else '',
            f'R{r["round"]}', f'{r["req"]:.0f}', f'{int(r["hc"])}',
            f'{r["model_reach_pct"]:.1f}%',
            ('—' if r['measured_finished_pct'] is None else f'{r["measured_finished_pct"]:.1f}%'),
            (f'<span style="color:{tone}">×{ratio:.2f}</span>' if ratio else
             f'<span style="color:{C["bad"]}">model says nobody</span>'),
        ])
r3_100 = PR['ns_reach_check']['100+'][2]['measured_finished_pct']
r3_100_claim = nsc('Claim rate / player-day - R3 (%)', '100+')
REACH = table(['segment', 'round', 'cum-streak gate', 'coins', 'engine model reach',
               'live players who finished it', 'model ÷ live'], reach_rows, cls='num',
              note='Engine reach = the survival curve in EcoGainsSim_v4.gs '
                   '(<code>data_streaks</code> max-streak percentiles × NS_STREAK_N 1.25). '
                   'No single scale factor reconciles the two columns: the model is ~1.4–2.8× too '
                   'generous below 40-99 and far too harsh at 100+, where it calls round 3 '
                   f'unreachable and {r3_100:.0f}% of players finish it.')

# ---- the one measurement conflict I could not resolve from the workbook ------------------------
CONFLICT = f'''<div class="conflict"><span class="cl">needs your answer</span>
<p>Two Night Sky metrics in the workbook disagree about the top segment, and which one is right
changes a recommendation. <code>By Bucket → R3 finished (%)</code> reports
<b>{r3_100:.1f}%</b> for 100+, while <code>NS_Config_Change_Est → Claim rate / player-day - R3</code>
reports <b>{r3_100_claim:.2f}%</b> of player-days. Over a 9-day window the second implies roughly
{9 * r3_100_claim:.0f}% of players ever claiming round 3, not {r3_100:.0f}% — so the two are
measuring different populations (lifetime completion vs in-window claims), different denominators, or
one is stale.</p>
<p>It matters because the delivery arithmetic in P4 runs on the <i>claim rate</i> (it reproduces your
own sheet exactly), and P9's case for paying 100+ through the deep rounds runs on the
<i>finished</i> figure. If the claim rate is the right basis for the top segment too, then 100+
should be included in P4's reshape and P9 becomes redundant. Everything else in this report is
unaffected.</p></div>'''

# ---- cost ladder ------------------------------------------------------------------------------
COST_IDS = ['B-ns-reshape', 'D-saga-lowseg', 'C2-daily-gift-half', 'PKG-funded', 'PKG-cheap',
            'E-river-rush', 'C-daily-gift', 'A-ns-gates', 'PKG-newuser']
cost_rows = [(sid.replace('-', ' '), [hc_cost(sid)]) for sid in COST_IDS]
COSTS = paired_bars(cost_rows, [('coins / active player-day', C['warn'])],
                    f'What each change costs the coin faucet (Control faucet = {FAUCET:.0f} coins/pd)',
                    unit='(+ = gives coins back)', fmt=lambda v: f'{v:+.2f}', labw=142)

cost_table_rows = []
for sid in COST_IDS:
    s = sc(sid)
    d = s['resources']['HC']['delta_papd_overall']
    ul = s['resources']['Unlimited Lives']['delta_papd_overall']
    cost_table_rows.append([
        f'<code>{esc(sid)}</code>', esc(s['label']),
        ', '.join(f'<code>{esc(x)}</code>' for x in s['sheets']) or '—',
        f'<b style="color:{C["warn"] if d > 0.5 else C["good"]}">{d:+.2f}</b>',
        f'{d / FAUCET * 100:+.1f}%',
        f'{ul:+.2f}',
    ])
COST_TABLE = table(['scenario', 'what it is', 'sheets edited', 'coins/pd', '% of faucet',
                    'UL min/pd'], cost_table_rows, cls='num',
                   note='Priced by patching those sheets in <code>harness/_mockdata.json</code>, '
                        're-running <code>EcoGainsSim_v4.gs</code> + the Daily engine over the A/B '
                        'window (cal_new days 5–13) and converting per-earner deltas onto the live '
                        'per-active-player-day axis with the bridge from the sim-vs-actual '
                        'pipeline. Reproduce with <code>node analysis/_price_proposals.js</code>.')

# ================================================================ proposals
saga = PR['ladders']['saga']
low_saga = saga['0-9']
ns_ladder = PR['ladders']['ns']
cont_100 = SK['continue']['F. 100+']
cont_low = SK['continue']['B. 1-9']
ul_100 = SK['sources']['UnlimitedLives']['F. 100+']
hc_low = SK['sources']['HardCoin']['B. 1-9']
saga_ul_100 = next((r for r in ul_100['rows'] if r['source'] == 'saga_progression'), None)
gift_low = next((r for r in hc_low['rows'] if r['source'] == 'daily_reward'), None)
saga_low = next((r for r in hc_low['rows'] if r['source'] == 'saga_progression'), None)

P = []

P.append(proposal(
    'P4', 'Move the Night Sky coins onto the round players actually reach',
    'streaks · new users', ('priced', f'priced: {hc_cost("B-ns-reshape"):+.2f} coins/pd — free'),
    f'<b>Same nominal budget, up to 20× the delivered value.</b> Reallocating the coins already on '
    f'the NS ladder from round 3 to round 1 costs the faucet nothing '
    f'({hc_cost("B-ns-reshape"):+.2f} coins/pd in the sim) because expected cost is held constant '
    f'by construction — it only changes who gets paid.',
    'The single highest-leverage change available, and it is free.',
    f'''<p>Round 3 is claimed on {nsc('Claim rate / player-day - R3 (%)', '10-19'):.1f}% of
player-days at 10-19 and {nsc('Claim rate / player-day - R3 (%)', '100+'):.2f}% at 100+, while round 1
is claimed on {nsc('Claim rate / player-day - R1 (%)', '10-19'):.1f}% and
{nsc('Claim rate / player-day - R1 (%)', '100+'):.1f}%. The proposed uplift put its biggest
increases on the deepest round — <code>Diff HC - R3</code> is
{esc(nsc('Diff HC - R3', '20-39'))} at 20-39 and {esc(nsc('Diff HC - R3', '100+'))} at 100+ — which is
where delivery is thinnest.</p>''',
    f'''<p>Sheet <code>NS_v2</code>, the <b>HC Reward</b> column (F) inside each per-segment block —
rows R1/R2/R3 under the segment label. Leave <code>Cum Streak Req</code> alone (that is P5).</p>
<p>Concretely, for 10-19 the ladder is
{' / '.join(str(int(r['hc'])) for r in ns_ladder['10-19'])} coins across the three rounds; shifting
half of round 3's coins onto rounds 1–2 (weighted by their reach) is what the priced scenario does.
For 100+ the ladder is {' / '.join(str(int(r['hc'])) for r in ns_ladder['100+'])}.</p>
<p><b>How the engine sees it:</b> <code>readNSLadder_</code> reads the block, <code>nsE_</code>
builds E = Σ S(CumStreakReq) × reward, and Night Sky is anchored, so
SIM = measured × (E<sub>v2</sub>/E<sub>base</sub>) × T. Reward edits therefore flow with no code
change — this is a config-only edit that the sim prices the same day.</p>''',
    [bench('published',
           'Puzzle-category benchmarks put day-1 retention in the ~30–40% band and day-7 near '
           '10–15% (GameAnalytics / Liftoff annual benchmark reports). A reward tier reached by '
           'under 10% of player-days is, in benchmark terms, invisible to the retention curve it '
           'is supposed to move.'),
     bench('observed',
           'Royal Match and Candy Crush Saga both put their largest daily-loop rewards where the '
           'median player lands — Candy Crush\'s login calendar escalates to a day-7 payout most '
           'returning players do reach, and Royal Match\'s daily missions are sized to a single '
           'session. Neither hangs its headline reward off a streak most players never hold.'),
     bench('inference',
           'A reward is a promise about behaviour. Paying at round 3 tells the 95% of low-level '
           'players who never get there that the event is not for them — which is consistent with '
           f'the {pc(buck("NS active rate (%)", "10-19"))} fall in NS participation at 10-19.')],
    'Reallocation changes the <i>shape</i> of the top-end reward. At 100+, 42% of players do finish '
    'round 3, so exclude that segment from the reshape — see P9. Also re-check the deep rounds\' '
    'aspirational role: a ladder with no visible summit can read as less exciting even when it pays '
    'more on average.',
    wide=REALLOC))

P.append(proposal(
    'P1', 'Put the first six rungs of the daily gift back',
    'new users', ('priced', f'priced: {hc_cost("C2-daily-gift-half"):+.2f} to '
                            f'{hc_cost("C-daily-gift"):+.2f} coins/pd'),
    f'''<b>Half restore {hc_cost("C2-daily-gift-half"):+.2f} coins/pd ({hc_cost("C2-daily-gift-half") / FAUCET * 100:.1f}% of the faucet), full restore {hc_cost("C-daily-gift"):+.2f}.</b>
Aimed almost entirely at players who have not yet reached day 7.''',
    'The cut fell on exactly the rungs a new player sees, and the daily gift is their biggest single coin source.',
    GIFT + f'''<p>The v2 ladder keeps day 7 at 100 coins and takes the rest apart:
{' + '.join(str(int(x)) for x in gift_base[:6])} = {int(sum(gift_base[:6]))} coins across days 1–6
becomes {' + '.join(str(int(x)) for x in gift_v2[:6])} = {int(sum(gift_v2[:6]))} — a
{100 * (sum(gift_v2[:6]) / sum(gift_base[:6]) - 1):.0f}% cut on the early week against
{100 * (sum(gift_v2) / sum(gift_base) - 1):.0f}% on the cycle as a whole.</p>
<p>For a 1-9 player <code>daily_reward</code> is the <b>largest</b> coin source at
{gift_low['share_control'] * 100:.1f}% of their faucet, and it fell {pc(gift_low['d_pct'])}. Their
measured outcome: level completes {pc(compl_new)}, time spent {pc(time_new)}, D1 churn
{pc(churn_new)}, free boosters {pc(booster_new)} — while <i>old</i> players' time went
{pc(time_old)}.</p>''',
    f'''<p>Sheet <code>c_day_v2</code>, column <b>B</b> (“HC Reward”), rows 4–10 = days 1–7.
Current: {', '.join(f'd{i + 1}&nbsp;{int(v)}' for i, v in enumerate(gift_v2))}. The priced full
restore copies <code>c_day</code>'s days 1–6 across and leaves day 7 at 100; the half restore takes
the midpoint of each rung.</p>
<p><b>How the engine sees it:</b> <code>readDayLadder_</code> reads the seven cells and
<code>dailyGiftRatio_</code> weights them by login-streak survival —
R = Σ<sub>n</sub> w<sub>n</sub>·v2<sub>n</sub> ÷ Σ<sub>n</sub> w<sub>n</sub>·base<sub>n</sub> with
w<sub>n</sub> = P(streak ≥ n) from <code>data_seg_beh</code>. Because the weights fall with n, early
rungs dominate the ratio — which is exactly why cutting days 1–6 hurt more than the headline −29%
suggests.</p>
<p><b>Wanted, needs a small engine change:</b> one ladder currently serves every segment. A
<code>c_day_v2</code> with per-segment blocks (like <code>c_saga_v2</code> already has) would let
you restore the early rungs for new players only and keep the cut for veterans — roughly a
20-line change to <code>readDayLadder_</code> to make it header/segment-driven.</p>''',
    [bench('published',
           'Daily-reward calendars are the most consistently reported retention feature in casual '
           'mobile: benchmark reports across 2023–2025 put a functioning day-1 to day-7 loop among '
           'the highest-effect-size retention levers at the top of the funnel, where our own D1 '
           'churn sits at {:.0f}% for new users.'.format(100 * (AB['population']['new']['D1 churn rate']['variant'] or 0))),
     bench('observed',
           'Candy Crush Saga, Royal Match and Gardenscapes all escalate the first week rather than '
           'back-loading it: something lands on day 1, and each day visibly beats the last. Our v2 '
           'ladder pays 10 coins on days 1, 4 and 6 and nothing on 2, 3 and 5 — a new player\'s '
           'first three days can return 10 coins total, which is one tenth of a single continue.'),
     bench('inference',
           'The day-7 anchor only works if players believe they will get there. Gutting the rungs '
           'that build that belief while keeping the prize is the least efficient possible way to '
           'save 52 coins a cycle.')],
    'This is the give-back most likely to leak to veterans, because the ladder is shared. If the '
    'per-segment version is not built, prefer the half restore and monitor the mid segments\' faucet.'))

P.append(proposal(
    'P2', 'Give the saga coins back at the bottom of the level curve, not the top',
    'new users · HC sink', ('priced', f'priced: {hc_cost("D-saga-lowseg"):+.2f} coins/pd '
                                      f'(self-funded package {hc_cost("PKG-funded"):+.2f})'),
    f'''<b>{hc_cost("D-saga-lowseg"):+.2f} coins/pd for the 0-9 and 10-19 blocks alone</b>, or net
{hc_cost("PKG-funded"):+.2f} for the whole cheap package if you pay for it by halving the top two
segments' saga coins — they took their compensation in unlimited lives.''',
    'The saga nerf was applied uniformly, but only the top segments got the compensation.',
    f'''<p>Saga coins went from {low_saga['base_hc_per_level']:.2f} to
{low_saga['v2_hc_per_level']:.2f} coins per level required — a
{100 * (low_saga['v2_hc_per_level'] / low_saga['base_hc_per_level'] - 1):.0f}% cut, uniform across
every segment block. The v2 ladder pays on 4 of 10 nodes
({', '.join(str(int(x)) for x in low_saga['v2_nodes'])}).</p>
<p>The compensation was unlimited-lives minutes, and it is heavily skewed: at 100+
<code>saga_progression</code> UL went {pc(saga_ul_100['d_pct'])} and their UL total
{pc(ul_100['total_d_pct'])}, while a 1-9 player's coin faucet fell {pc(hc_low['total_d_pct'])} with
saga coins {pc(saga_low['d_pct'])}.</p>
<p><b>And lives are the wrong compensation for them, mechanically.</b> An unlimited-lives window lets
you <i>re-attempt</i>; it does not help you <i>win</i>. The only thing that converts a nearly-finished
board into a completion is the +5 moves continue, and that costs 100 coins. Level 1-9 players have the
worst board odds in the game — pass rate
{100 * (AB['buckets']['1-9']['Pass rate']['variant'] or 0):.0f}% and out-of-moves rate
{100 * (AB['buckets']['1-9']['OOM rate']['variant'] or 0):.0f}%, both the weakest of any band — so
they meet that 100-coin decision constantly on a faucet of
{SK['sources']['HardCoin']['B. 1-9']['total']['Variant']:.0f} coins a day. Giving them retries instead
of coins hands them more attempts at a level they still cannot close.</p>''',
    f'''<p>Sheet <code>c_saga_v2</code>, the <b>HC Reward</b> column of the 0-9 and 10-19 blocks
(columns D and G in the triple <code>Levels Req | RewardChestId | HC Reward</code> layout). The
priced change fills the zero nodes with 10 coins, taking those segments from
{low_saga['v2_hc_per_level']:.2f} to about 1.2 coins/level — still well under the Control
{low_saga['base_hc_per_level']:.2f}.</p>
<p>To self-fund it, halve the surviving coin nodes in the <b>40-99</b> and <b>100+</b> blocks
(columns M and P). Those segments keep the UL-lives upside.</p>
<p><b>How the engine sees it:</b> <code>readSagaLadder_</code> is header-driven since 2026-08-13, so
it finds each segment block by its label and pairs that block's <code>Levels Req</code> with the
next <code>HC Reward</code> to its right; <code>sagaRatio_</code> divides the v2 coins-per-level by
the base to get R, and Saga is always-on (D = T = 1), so SIM = measured × R per segment. Per-segment
edits therefore land on exactly one segment — no spillover.</p>''',
    [bench('published',
           'Early-progression generosity is the standard shape in the category: teardowns of the '
           'top-grossing match-3 titles consistently show currency-per-level falling as level '
           'number rises, not held flat. Our v2 does the opposite of what the category does — it '
           'applies one multiplier to every level band.'),
     bench('observed',
           'Royal Match front-loads its area/decor progression so the first sessions produce '
           'visible completion, then lengthens the loop. The equivalent lever here is coins per '
           'saga node for players under level 20.'),
     bench('inference',
           'Retries and wins are different goods. Compensating a coin cut with unlimited lives '
           'assumes the binding constraint is attempts; for players failing half their boards it '
           'is moves. Paying in the currency that does not remove the block is a cut with extra '
           'steps.')],
    'Watch the saga item ladder at the same time — see P6. If the live UL grants stay as generous '
    'as they are, adding coins at the bottom fixes supply without restoring any coin <i>pressure</i>.'))

P.append(proposal(
    'P5', 'Re-cut the Night Sky streak gates per segment — after calibrating the model',
    'streaks', ('model', f'model-priced upper bound: {hc_cost("A-ns-gates"):+.2f} coins/pd'),
    f'''<b>The gates were never touched.</b> <code>NS</code> and <code>NS_v2</code> carry
<i>identical</i> <code>Cum Streak Req</code> columns — the v2 redesign raised rewards and left every
requirement where it was, so the difficulty of the streak loop is unchanged while participation
fell {pc(buck('NS active rate (%)', '20-39'))} at 20-39.''',
    'The v2 pass raised NS rewards without touching a single requirement.',
    f'''<p>Gates today (cumulative streak): {', '.join(f"<b>{b}</b> " + '/'.join(str(int(nsc(f'Cum streak req - R{i}', b))) for i in (1, 2, 3)) for b in BUCKETS)}.</p>
<p>Set against measured streaks, the mid segments are the mismatch: 20-39 needs
{int(nsc('Cum streak req - R3', '20-39'))} cumulative streak for round 3 with a p50 daily streak of
{nsc('Daily streak p50', '20-39'):.1f} and p90 of {nsc('Daily streak p90', '20-39'):.1f}. Round-3
claim rate there is {nsc('Claim rate / player-day - R3 (%)', '20-39'):.1f}% of player-days.</p>''',
    f'''<p>Sheet <code>NS_v2</code>, columns <b>D</b> (“Streak Req”) and <b>E</b> (“Cum Streak Req”)
in each segment block. The engine reads column E; keep D consistent for readability.</p>
<p><b>How the engine sees it:</b> requirement edits flow through the <i>same</i> survival curve that
prices rewards — E = Σ S(CumStreakReq<sub>k</sub>) × reward<sub>k</sub> — so lowering a gate raises R
and the sim prices it immediately. That is the good news. The bad news is the calibration table
above: the survival curve is built from <code>data_streaks</code> max-streak percentiles × a single
global <code>NS_STREAK_N</code> = 1.25, and it disagrees with live completion by ×1.4–2.8 in the low
and mid segments while calling round 3 unreachable at 100+ where 42% finish it.</p>
<p><b>Therefore: do P10 first.</b> The priced {hc_cost("A-ns-gates"):+.2f} coins/pd for a full re-cut
to 75/50/25% modelled reach is an upper bound computed with a curve we know is wrong; the
same edit priced against live claim rates will land lower for low segments and higher at
100+.</p>''',
    [bench('published',
           'Duolingo has publicly credited streak mechanics — and specifically streak protection — '
           'as a major driver of its DAU growth, discussing streak freezes and repair in its own '
           'engineering and investor communications. The published lesson is not “make streaks '
           'long”, it is “make them survivable”.'),
     bench('observed',
           'Monopoly Go and Royal Match both gate their daily-return rewards on same-day activity '
           'rather than long consecutive chains, and where longer chains exist they sell or grant '
           'protection. Our gates ask 20-39 players for a 42-deep cumulative streak with no '
           'forgiveness mechanic at all.'),
     bench('inference',
           'A cumulative gate with a hard reset converts one missed day into losing the whole '
           'ladder. That is the mechanic most likely to explain a participation fall that is '
           'largest in the middle segments, where players are engaged enough to start the chain '
           'and not yet engaged enough to hold it.')],
    'Lowering gates is the one change here that can cost real coins at scale — the full re-cut is '
    '9% of the faucet. Do it segment by segment, low segments first, and price each step after '
    'P10 lands. Also consider a streak-forgiveness token instead of lower gates: same reachability, '
    'lower faucet cost, but it needs game-side work rather than a config edit.',
    wide=REACH))

P.append(proposal(
    'P6', 'Stop paying free lives into the coin sink',
    'HC sink · revenue', ('gap', 'not simulatable today — config gap'),
    f'''<b>{SK['by_action']['rows'][0]['share_control'] * 100:.1f}% of every coin players spend goes
on one action:</b> buying extra moves when a level is about to fail. Unlimited-lives minutes remove
the cost of failing, and v2 raised them {pc(pop('Booster gain total / player', 'old')) if False else pc(SK['sources']['UnlimitedLives']['F. 100+']['total_d_pct'])} at 100+ while cutting coins.''',
    'The redesign cut coin supply and coin demand at the same time.',
    SINKS + f'''<p>Coins have essentially one job in this economy: continues. Lives purchases are
{[r for r in SK['by_action']['rows'] if r['key'] == 'purchase_lives'][0]['share_control'] * 100:.1f}%
of coin spend and fell {pc([r for r in SK['by_action']['rows'] if r['key'] == 'purchase_lives'][0]['d_pct'])};
pre-level boosters {[r for r in SK['by_action']['rows'] if r['key'] == 'purchase_pre_level_booster'][0]['share_control'] * 100:.1f}%.</p>
<p>What v2 did to demand: unlimited lives {pc(ul_100['total_d_pct'])} at 100+
(<code>saga_progression</code> alone {pc(saga_ul_100['d_pct'])}), out-of-moves rate
{pc(buck('OOM rate', '100+'))}, attempts per completion {pc(buck('Attempts per completion', '100+'))} —
players fail <i>more</i> and pay <i>less</i>: continues per 1000 player-days went
{cont_100['Control']['continues_per_1000_player_days']:,.0f} → {cont_100['Variant']['continues_per_1000_player_days']:,.0f}
at 100+ and coins spent per attempt {pc(spend_att)} overall. Their paid coin purchases fell
{pc(buck('HC gain PAID / player', '100+'))}.</p>''',
    f'''<p><b>The config gap first.</b> The saga UL-lives swap is <i>not in the workbook</i>: after
the triple-column rebuild, <code>c_saga</code>/<code>c_saga_v2</code> carry only
<code>Levels Req | RewardChestId | HC Reward</code> per segment — no item columns. So
<code>readSagaItems_</code> finds nothing, saga item ratios come back empty, and the sim prices saga
UL at ×1.0 while live raised it ~×1.7. <b>Add the item columns back</b> (any header in
<code>RES_MAP</code> — “Unlimited Lives”, “Unlimited Red”, …) to both sheets and the swap becomes
priceable with no code change; the reader already maps them.</p>
<p><b>Then the design change.</b> Grant the same generosity as <i>more, shorter</i> windows rather
than long ones — the sink only survives if a fail can still cost something. The levers that already
exist in config: the UL columns on <code>c_saga_v2</code> (once restored), <code>NS_v2</code>,
<code>F</code> (Flock Flurry), <code>HH_v2</code>, <code>TaD_v2</code>. Duration is a game-side
parameter, so window length itself is an engineering ask, not a sheet edit.</p>''',
    [bench('published',
           'Continues and booster purchases — not lives — are repeatedly reported as the bulk of '
           'non-ad IAP in match-3, which is consistent with our own 94.5% figure. The sink being '
           'monetised is the fail moment.'),
     bench('observed',
           'Royal Match hands out unlimited-lives windows constantly, but in short bursts tied to '
           'events, and its hearts refill on a timer that keeps the fail moment costly. The '
           'grant pattern is “often and brief”, not “long and free”.'),
     bench('inference',
           'A long unlimited-lives window converts a paid retry economy into a free one for its '
           'duration. Handing 100+ players 41% more of it while removing 18% of their coins '
           'is a coherent explanation for a 31% revenue fall in that segment without any change '
           'to prices or offers.')],
    'This is the proposal most likely to be unpopular with players, and the one with the largest '
    'revenue upside. Do not pair a UL trim with the P2 coin give-back at the top — pick one lever '
    'per segment, or you will re-inflate the faucet you just cut.'))

P.append(proposal(
    'P7', 'Make the continue price a ladder instead of a flat 100 coins',
    'HC sink', ('flag', 'not simulatable — no sink model in the engine'),
    f'''<b>Every continue costs the same 100 coins</b> — at every level, in every segment, for both
arms (observed range {min(v[a]['coins_per_continue'] for v in SK['continue'].values() for a in v):.2f}–{max(v[a]['coins_per_continue'] for v in SK['continue'].values() for a in v):.2f}).
That single price is simultaneously trivial for a 100+ player and unreachable for a new one.''',
    'One flat price cannot serve a faucet that ranges from 42 to 620 coins a day.',
    f'''<p>At 100+ players buy {cont_100['Control']['continues_per_1000_player_days'] / 1000:.1f}
continues per player-day — {cont_100['Control']['coins_per_player_day']:,.0f} coins/day, which is
essentially their entire free faucet. At 1-9 it is
{cont_low['Control']['continues_per_1000_player_days'] / 1000:.2f} continues/day
({cont_low['Control']['coins_per_player_day']:.0f} coins/day) against a daily gift that now pays
{sum(gift_v2) / 7:.1f} coins/day — <b>a new player needs about
{100 / (sum(gift_v2) / 7):.0f} days of daily gifts to afford one continue</b>.</p>
<p>Consequence in the data: coins spent per attempt fell {pc(spend_att)} while the out-of-moves rate
rose {pc(pop('OOM rate'))} — the fail moments are there, the purchases are not.</p>''',
    f'''<p>Not a LiveOps sheet — this is the level-economy price table (the <code>extra_moves</code>
action, <code>level_movesplus5</code> context in the spend export). Two shapes worth testing:</p>
<p>1. <b>Session-progressive:</b> first continue of a session cheaper (e.g. 50), each subsequent one
dearer. Protects new players, raises the marginal cost for the players buying six a day.</p>
<p>2. <b>Level-band priced:</b> scale with the level's coin faucet so the price is a constant share
of daily income rather than a constant number.</p>
<p><b>Why the sim cannot price this:</b> the engine models the faucet only —
<code>data_econ_daily</code> carries spend as a measured series and no sink is simulated. Pricing
this needs either an A/B on the price itself or a new spend model in the engine (a real piece of
work: a per-attempt OOM → purchase conversion curve per segment).</p>''',
    [bench('published',
           'Casual-puzzle ARPDAU benchmarks sit in roughly the $0.05–0.15 band and ours is '
           f'${AB["population"]["all"]["ARPDAU"]["control"]:.3f} → '
           f'${AB["population"]["all"]["ARPDAU"]["variant"]:.3f}. The category monetises through '
           'many small purchase decisions, which requires prices that scale with the player.'),
     bench('observed',
           'Top match-3 titles vary continue cost and bundle contents by context — level type, '
           'attempt count, event state — rather than holding one number for everyone.'),
     bench('inference',
           'A price only creates pressure inside a band: below it, the purchase is automatic and '
           'you leave money on the table; above it, players stop considering it. A flat 100 with a '
           '15× spread in daily income between segments cannot be inside the band for all of them.')],
    'Price changes are the sharpest tool here and the easiest to get wrong — they interact with '
    'perceived fairness and with the offer wall (out of scope in this report). Test on one level '
    'band before touching the curve globally.'))

P.append(proposal(
    'P3', 'Give the low levels a coin lane back on the calendar',
    'new users', ('priced', f'priced: {hc_cost("E-river-rush"):+.2f} coins/pd'),
    f'''<b>Exposure is not the problem — density is.</b> A 1-9 player already earns from
{len(SK['exposure']['B. 1-9']['Variant'])} distinct sources in the window; an A. 0 player from
{len(SK['exposure']['A. 0']['Variant'])}. What changed is that several always-available lanes were
zeroed at once.''',
    'The removed events took their steady, low-variance coins with them.',
    f'''<p>River Rush went to zero on <code>cal_new</code> — it was
{[r for r in SK['sources']['HardCoin']['A. 0']['rows'] if r['source'] == 'river_rush'][0]['share_control'] * 100:.1f}%
of an A. 0 player's coins and is now {pc([r for r in SK['sources']['HardCoin']['A. 0']['rows'] if r['source'] == 'river_rush'][0]['d_pct'])}.
Photoshoot keeps a single instance (day 24) and Level Race two (days 20, 22) in a 33-day window.</p>
<p>Low-level players depend on always-on lanes far more than event lanes: for 1-9,
<code>daily_reward</code> + <code>saga_progression</code> + <code>player_level_up</code> alone are
{sum(r['share_control'] for r in hc_low['rows'] if r['source'] in ('daily_reward', 'saga_progression', 'player_level_up')) * 100:.0f}%
of their coins. Leaderboard events pay them almost nothing because they cannot compete for rank.</p>''',
    f'''<p>Sheet <code>cal_new</code> — the visual grid. The priced scenario writes “River Rush” into
row 22 (empty in workbook 16) as four weekly 4-day instances starting days 5, 12, 19, 26, each cell
merged across its duration.</p>
<p><b>How the engine sees it:</b> each merged range is one instance and its width is the duration;
day = column − 1. T = Σ<sub>new</sub> reach ÷ Σ<sub>cur</sub> reach with
reach(inst) = 1 − Π(1 − p<sub>day</sub>) from <code>data_seg_beh</code> weekday/weekend active
rates. Remember to re-run <b>EcoGainsSim ▸ Precompute calendars</b> after editing merges — merge
edits fire no <code>onEdit</code>, so the hidden <code>cal_parsed</code> sheet goes stale and the
engine will keep reading the old schedule.</p>
<p>A cohort-relative first-week schedule would be better than any global lane, but the calendar is
global — that one is a real engineering ask, not a config edit.</p>''',
    [bench('published',
           'Top-grossing casual titles run a much denser LiveOps calendar than one event per lane '
           'per month; industry LiveOps surveys through 2024–25 describe multiple concurrent, '
           'always-available loops as table stakes in the category.'),
     bench('observed',
           'Royal Match keeps several always-available loops (team, pass, daily) running under '
           'whatever the rotating headline event is, so a player who ignores the headline still has '
           'somewhere to earn. Our low segments lost two of those steady lanes at once.'),
     bench('inference',
           'Event coins are variance; always-on coins are income. New players need income — they '
           'have no stock to smooth a bad week, which shows up in their P90 coin balance falling '
           f'{pc(pop("P90 HC balance", "new"))}.')],
    'Re-adding lanes is a pure faucet increase with no behavioural upside if the lane is not fun; '
    f'{hc_cost("E-river-rush"):+.2f} coins/pd is {hc_cost("E-river-rush") / FAUCET * 100:.1f}% of '
    'the faucet for an event that was cut deliberately. Prefer raising the cadence of a lane you '
    'kept (Hatchling Hideaway, Target Day) if the goal is only income.'))

P.append(proposal(
    'P8', 'Rebalance Rainbow Maker — it pays in the currencies that do least for return',
    'streaks · HC sink', ('flag', 'sim over-prices this lane — see the discrepancy report'),
    f'''<b>The new headline event pays tokens and slingshots, not daily-return value.</b> Slingshot
net stock rose {pc(pop('Slingshot NET (gain - spend) / player'))} overall
({pc(buck('Slingshot NET (gain - spend) / player', '100+'))} at 100+) while the streak metric fell
{pc(streak_all)}.''',
    'A brand-new event is the cheapest place to buy daily-return behaviour, and it was spent elsewhere.',
    f'''<p>Rainbow Maker is the Variant's biggest new faucet: SPT per player
{pop('SPT gain / player (RAINBOW)', 'all', 'variant'):,.1f} from a standing start, and it pays
slingshots heavily — slingshot gains {pc(pop('Slingshot gain total / player'))} against spend
{pc(pop('Slingshot spent / player'))}, i.e. players are accumulating them, not using them.</p>
<p>Meanwhile the sim over-prices this lane: the discrepancy report puts RM at ~1.9× the live token
delivery and ~3.7× the live coin delivery, so its budget looks bigger on paper than what players
actually received. Both numbers point the same way — RM's ladder is the loosest in the model.</p>''',
    f'''<p>Sheets <code>RM_1st</code> and <code>RM_2nd</code> — the <code>Req Accum</code>
milestone column plus the reward columns (mapped through <code>RES_MAP</code>, so “SPT x2”,
“Slingshot”, “Coins” and the pack columns all read from the same header row).</p>
<p>Two concrete edits: (1) move part of the slingshot/token weight into the <b>daily</b> loops
(NS rounds 1–2, the daily gift) where it converts into returns; (2) fix the instance→sheet
assignment — <code>RM_INSTANCE_SHEETS</code> in <code>EcoGainsSim_v4.gs</code> hardcodes
<code>['RM_1st','RM_1st','RM_1st','RM_2nd','RM_2nd']</code> by start order, and the live ladder
matches <code>RM_2nd</code>, so the in-window instances are priced off the wrong sheet.</p>
<p><b>How the engine sees it:</b> RM is bottom-up — per instance,
Σ<sub>k</sub> S<sub>dur</sub>(ReqAccum<sub>k</sub>) × reward<sub>k</sub> × reach(inst), with
S<sub>dur</sub> from <code>data_RM</code> matchables percentiles scaled by
instance duration ÷ configured EventDuration. There is no measured anchor, so requirement edits move
the whole lane immediately and errors here do not self-correct.</p>''',
    [bench('published',
           'Booster inflation is a recognised failure mode in the category: when consumable stock '
           'outruns consumption, the difficulty pressure that drives both engagement and spend '
           'falls away. Our slingshot stock is the clearest instance — gains up, spend flat.'),
     bench('observed',
           'Royal Match ties booster grants to event completion and keeps them consumable within '
           'the event window rather than letting them pool indefinitely.'),
     bench('inference',
           'A currency that accumulates without a sink is a discount on future difficulty. Given '
           'the goal is daily return and coin-sink health, tokens and slingshots are the two least '
           'useful things a new event could be paying.')],
    'RM is the Variant\'s most popular new content — trimming it is the change most likely to be '
    'felt as a takeaway. Reallocate rather than cut, and fix the instance-sheet mapping first so '
    'you can see what you are actually changing.'))

P.append(proposal(
    'P11', 'Get the Kite Festival config that actually shipped into Ki_v2',
    'accuracy', ('flag', 'blocks accurate v3 budgeting'),
    '''<b>The live Kite Festival pays about 5× what its config sheet says.</b> Until that is
reconciled, every faucet budget built on the workbook is wrong by the size of one event.''',
    'You cannot budget v3 against a config that is not what ran.',
    '''<p>The sim-vs-actual work put windowed Kite at ≈×1.0 against live ×5.3 coins and ×4.5 tokens
at 100+ — the single largest directional miss in the model, and it survived adversarial
verification. Either the live event ran a different rank ladder, a different league size, or a
different schedule than <code>Ki_v2</code> describes.</p>''',
    '''<p>Sheet <code>Ki_v2</code> — the rank ladder (rows 26–85, reward columns C..W) and the score
milestone block (row 22, requirement in column B). Pull the config that the Variant actually ran
from live ops and type it in.</p>
<p><b>How the engine sees it:</b> Kite is priced as a zero-sum leaderboard — E = mean ladder payout
at the measured <code>position_p25/p50/p75</code> from <code>data_event_inst</code>, plus a survival
term for the score milestone; D is pinned to 1 because rank payouts are end-state. So the ladder
values and the league size both matter, and neither can be inferred from the payout total
alone.</p>''',
    [bench('inference',
           'This is not a design proposal — it is the precondition for the others. Every coins/pd '
           'figure in this report is computed against the workbook\'s configs; one event mispriced '
           'by 5× is larger than most of the changes proposed here.')],
    'Low risk, pure accuracy work. The only cost is the time to find the live config.'))

P.append(proposal(
    'P10', 'Calibrate the Night Sky reach model against the completion data you now have',
    'model', ('flag', 'sim work — unblocks P4 and P5'),
    f'''<b>The engine\'s streak-survival curve disagrees with live completion by up to ×2.8, in both
directions.</b> The A/B export now reports actual round completion per segment, which is the
calibration target that did not exist when the model was built.''',
    'The proposals above are priced with a curve we can now prove is wrong.',
    f'''<p>The table above is the whole argument: at 0-9 the model believes
{PR['ns_reach_check']['0-9'][0]['model_reach_pct']:.0f}% of players clear round 1 where
{PR['ns_reach_check']['0-9'][0]['measured_finished_pct']:.0f}% actually do, and at 100+ it believes
<i>nobody</i> clears round 3 where {PR['ns_reach_check']['100+'][2]['measured_finished_pct']:.0f}%
do.</p>''',
    f'''<p>Code: <code>NS_STREAK_N</code> (currently 1.25) and <code>nsE_</code>/<code>survival_</code>
in <code>EcoGainsSim_v4.gs</code>, fed by <code>data_streaks</code> max-streak percentiles.</p>
<p>The mismatch is in shape, not scale — the low segments need a <i>less</i> generous curve and 100+
needs a much more generous one, so no single N fixes it. Two options: (a) per-segment N fitted so
modelled round-1 reach matches the measured claim rate; (b) drop the proxy and read the measured
per-round claim rates straight off the A/B export as the reach vector, keeping the survival curve
only for segments with no measurement. Option (b) is what your own
<code>NS_Config_Change_Est</code> sheet already does by hand — its estimate reproduces exactly as
Σ claim-rate × reward — so adopting it would make the sheet and the engine agree.</p>''',
    [bench('inference',
           'A model calibrated on a proxy (max daily streak × 1.25) should be replaced by the '
           'measurement as soon as the measurement exists. Everything downstream — NS coins, the '
           'season-pass token flow that NS feeds, and the whole-faucet total — inherits this '
           'error.')],
    'Recalibration will move published NS numbers, including ones already circulated. Version the '
    'change and re-run the sim-vs-actual report in the same pass so the two stay consistent.',
    wide=REACH))

P.append(proposal(
    'P12', 'Read every economy change against the difficulty change that shipped with it',
    'cross-cutting', ('flag', 'out of scope here — level design owns it'),
    f'''<b>Levels got harder at the same time as the faucet got smaller.</b> Pass rate
{pc(pop('Pass rate'))}, out-of-moves {pc(pop('OOM rate'))}, attempts per completion
{pc(pop('Attempts per completion'))} — small numbers that multiply against every proposal here.''',
    'Two independent tightenings landed in the same release.',
    f'''<p>Per segment the difficulty move is consistent and largest where the faucet cut was
largest: attempts per completion {pc(buck('Attempts per completion', '20-39'))} at 20-39,
{pc(buck('Attempts per completion', '100+'))} at 100+, and pass rate
{pc(buck('Pass rate', '100+'))} at 100+.</p>
<p>Interaction to keep in view: harder levels raise the <i>number</i> of fail moments (good for the
coin sink) while lower pass rates shorten win streaks (bad for the NS gates in P4/P5, which are
denominated in streak length). The same change helps one target and hurts another.</p>''',
    '''<p>No sheet in this workbook. What belongs here is a shared read-out: whenever the level
team changes pacing, re-check the NS gate reachability (P5) and the continue conversion (P7),
because both are denominated in outcomes the level curve controls.</p>''',
    [bench('inference',
           'Streak-based rewards are difficulty-coupled by construction: a 2-point pass-rate fall '
           'compounds across a chain, so a cumulative-streak gate silently gets harder when levels '
           'do. That coupling is invisible in a reward-only design review.')],
    'Naming this is the whole action. The risk is assuming an economy fix will show up cleanly in '
    'the metrics while difficulty moves underneath it.'))

P.append(proposal(
    'P9', 'Pay the top segment through the rounds they actually finish',
    'revenue', ('flag', 'conditional — depends on which NS metric is right'),
    f'''<b>At 100+ the deep Night Sky rounds may already work.</b> On the
<code>R3 finished (%)</code> measure {r3_100:.0f}% of them finish round 3 — the only segment where the
deepest tier delivers — while their coin faucet fell
{pc(buck('HC gain total / player', '100+'))} and their revenue {pc(buck('Total revenue', '100+'))}.
<b>Read the conflict box first:</b> the claim-rate measure says the opposite, and this proposal only
stands under the first one.''',
    'The efficient place to pay heavy players is the one tier the rest of the game cannot reach — if it really is reached.',
    CONFLICT + f'''<p>100+ round completion runs
{PR['ns_reach_check']['100+'][0]['measured_finished_pct']:.0f}% →
{PR['ns_reach_check']['100+'][1]['measured_finished_pct']:.0f}% →
{r3_100:.0f}%, a shallow funnel, against a 20-39 funnel of
{nsc('Claim rate / player-day - R1 (%)', '20-39'):.0f}% → … →
{nsc('Claim rate / player-day - R3 (%)', '20-39'):.1f}% per player-day. Their revenue picture:
ARPPU {pc(buck('ARPPU', '100+'))}, payer-days {pc(buck('AVG Payer day (%)', '100+'))}, paid coin
purchases {pc(buck('HC gain PAID / player', '100+'))}, coin balance P75
{pc(buck('P75 HC balance', '100+'))}.</p>
<p>They were compensated in unlimited lives ({pc(ul_100['total_d_pct'])}), which is precisely the
substitution P6 identifies as the revenue problem. Paying them in coins through a tier they reach
puts the value back without removing the fail cost.</p>''',
    f'''<p>Sheet <code>NS_v2</code>, the <b>100+</b> block only: keep rounds 2–3 heavy
(currently {' / '.join(str(int(r['hc'])) for r in ns_ladder['100+'])} coins) and exclude this
segment from P4's reshape. If more is needed, raise round 2 —
{buck('R2 finished (%) [actual]', '100+', 'variant') or 49.5:.0f}% completion makes it the highest-delivery
cell in the whole ladder.</p>
<p><b>Why this is the coin route rather than the lives route:</b> coins re-enter the sink at the
continue; unlimited-lives minutes remove the sink. Same nominal generosity, opposite effect on
spend.</p>''',
    [bench('published',
           'Whale revenue in casual puzzle is concentrated in continue-type purchases, so top-segment '
           'value delivered as coins recirculates into the monetised action, while value delivered '
           'as free retries does not.'),
     bench('observed',
           'Royal Match reserves its deepest event tiers for its most engaged cohort and keeps the '
           'currency it pays there spendable, rather than granting time-based immunity.'),
     bench('inference',
           'This segment is 6.5% of players and was 10% of revenue before the test; a targeted '
           'reward-placement change is cheap relative to the 31% revenue fall it addresses.')],
    'Do not stack this with a saga coin give-back at the top (P2’s funding half) — that would '
    'restore the faucet you are using to pay for the low-segment changes.'))

# ================================================================ document
def section(sid, eyebrow, title, lead, body):
    return f'''<section class="sec" id="{sid}">
<div class="eyebrow">{eyebrow}</div><h2>{title}</h2>
<p class="lead">{lead}</p>
{body}
</section>'''

ns_uplift_note = (f"your NS proposal is already in NS_v2 and is treated here as the baseline: it adds "
                  f"{nsc('Diff NS HC / player-day', '20-39')} coins/pd at 20-39 and "
                  f"{nsc('Diff NS HC / player-day', '100+')} at 100+")

# Section bodies are built as separate values, never as f-strings nested inside the document
# f-string: on Python 3.10 an inner ''' terminates the outer one (Python 3.12 relaxed this).
lives_pct = pc([r for r in SK['by_action']['rows'] if r['key'] == 'purchase_lives'][0]['d_pct'])
extra_share = SK['by_action']['rows'][0]['share_control'] * 100
gift_cut6 = 100 * (1 - sum(gift_v2[:6]) / sum(gift_base[:6]))
lowseg_always = sum(r['share_control'] for r in hc_low['rows']
                    if r['source'] in ('daily_reward', 'saga_progression', 'player_level_up')) * 100

DIAG_BODY = SUBST + f'''
<div class="cols">
<div><p>Follow it through. <b>Coins</b> fell {pc(gain_all)} per player and the saga lane took most of
the cut ({pc(pop('HC gain from saga / player'))}). <b>Unlimited lives</b> rose sharply, mostly from
the same saga nodes. Because {extra_share:.0f}% of all coin spend is the extra-moves continue, and an
unlimited-lives window makes failing free, demand for coins fell along with supply: coins spent per
attempt {pc(spend_att)}, lives bought with coins {lives_pct}.</p>
<p>Meanwhile the two loops that bring players back daily were tightened at the same time. The
<b>daily gift</b> lost {gift_cut6:.0f}% of its first six rungs while keeping its day-7 prize, and
<b>Night Sky</b> got bigger rewards with <i>unchanged</i> requirements — so the streak loop became
more valuable to finish and no easier to hold. Streaks fell {pc(streak_all)} overall and
{pc(buck('Avg daily streak', '100+'))} at 100+.</p></div>
<div><p>The four problems, one sentence each:</p>
<ul class="diag">
<li><b>New users.</b> Their biggest coin source was the daily gift
({gift_low['share_control'] * 100:.0f}% of their faucet, {pc(gift_low['d_pct'])}) and their second was
saga ({pc(saga_low['d_pct'])}). Completes {pc(compl_new)}, D1 churn {pc(churn_new)}.</li>
<li><b>Streaks.</b> Night Sky is the streak engine and its rewards moved without its gates; the
deepest round is claimed on {nsc('Claim rate / player-day - R3 (%)', '10-19'):.1f}% of player-days at
10-19.</li>
<li><b>Coin spend.</b> One action is {extra_share:.1f}% of the whole sink, and v2 removed the
pressure behind it.</li>
<li><b>Top-segment revenue.</b> 100+ lost {pc(buck('HC gain total / player', '100+'))} of coins, gained
{pc(ul_100['total_d_pct'])} of free lives, and bought {pc(buck('HC gain PAID / player', '100+'))} fewer
coin packs. Revenue {pc(buck('Total revenue', '100+'))}.</li>
</ul></div></div>
<p class="note">Baseline note: {ns_uplift_note}. Everything priced below is <i>on top of</i> that.
The season pass, level difficulty and all IAP/offer configuration are out of scope by your
instruction; where they matter they are named rather than proposed (P7, P12).</p>'''

HOWTO_BODY = f'''<div class="legend">
{chip('priced', 'priced')} run through the engine — the coins/pd figure is a model output you can
reproduce<br>
{chip('model-priced', 'model')} priced, but the model behind it is known to be miscalibrated
(see P10)<br>
{chip('config gap', 'gap')} cannot be priced today because the workbook does not represent the
mechanic<br>
{chip('flag', 'flag')} no sim number exists; the proposal stands on measured data and mechanism
</div>
<p>Every proposal names the sheet and column to edit and how <code>EcoGainsSim_v4.gs</code> consumes
it, so you can check that the change would do what the argument claims. Benchmark evidence is
labelled: <span class="bl published">published</span> for figures attributable to a public source,
<span class="bl observed">observed design</span> for patterns visible in a shipped game, and
<span class="bl inference">inference</span> for my own reasoning.</p>'''

BUDGET_BODY = COSTS + COST_TABLE + f'''<p>The shape of the recommendation: <b>P4 is free</b> and
should ship regardless. <code>PKG-funded</code> — the free NS reshape, a half daily-gift restore and
the low-segment saga give-back, paid for by halving saga coins at 40-99/100+ — nets
{hc_cost('PKG-funded'):+.2f} coins/pd, which is {hc_cost('PKG-funded') / FAUCET * 100:.1f}% of the
faucet, and concentrates every coin of it on the segments that lost engagement. The full package
({hc_cost('PKG-newuser'):+.2f} coins/pd) would undo most of the v2 cut and is here as an upper bound,
not a recommendation.</p>'''

METHOD_BODY = f'''<div class="cols">
<div><h5>Pipeline</h5>
<ol class="steps">
<li><code>python analysis/_extract_ab_summary.py</code> — reshapes {esc(AB['source'])}
(<code>Overall</code>, <code>Overall (new users)</code>, <code>Overall (old players)</code>,
<code>By Bucket</code>, <code>NS_Config_Change_Est</code>) into <code>ab_summary.json</code>, gated on
the headline metrics being present.</li>
<li><code>python analysis/_extract_sinks.py</code> — coin sinks by action and context, continue price
and frequency per segment, per-segment source mix, exposure counts → <code>sinks.json</code>.</li>
<li><code>node analysis/_price_proposals.js</code> — patches config sheets in memory, re-runs
<code>EcoGainsSim_v4.gs</code> + <code>EcoGainsSim_Daily.gs</code> over the A/B window (cal_new days
{esc(', '.join(str(d) for d in PR['day_list']))}), payer-blends with <code>data_gains</code> earner
shares and converts to per-active-player-day → <code>proposal_pricing.json</code>.</li>
<li><code>python analysis/_build_proposals_report.py</code> — this page.</li>
</ol></div>
<div><h5>What the pricing covers</h5>
<p>The engine models the <b>faucet</b> only. It has no sink model, so nothing that changes what
players <i>spend</i> (P7) or how long a lives window lasts (P6) can be priced here — those carry
mechanism and measured evidence instead of a number.</p>
<p>Conversion to per-active-player-day uses the bridge from the sim-vs-actual pipeline (k = live
Control faucet ÷ sim measured windowed per-earner, per segment and resource), so proposal costs sit
on the same axis as the A/B numbers. That bridge assumes earner-share stability between arms.</p>
<p>Two known model errors are inherited and stated where they bite: the Night Sky reach curve (P10)
and Rainbow Maker's over-generous ladder (P8).</p></div></div>'''

BODY = f'''
<header class="mast">
  <div class="eyebrow">LiveOps v2 → v3 · economy design · {esc(AB['source'])}</div>
  <h1>What to change for v3</h1>
  <p class="dek">Twelve config changes aimed at the four problems the A/B test surfaced — each one
  named down to the sheet and column, priced through the same engine that produced the simulation,
  and argued against how comparable games handle the same loop.</p>
  <div class="meta">
    <span>Window {esc(CMP['meta']['window'][0])} – {esc(CMP['meta']['window'][-1])} ({len(CMP['meta']['window'])} days)</span>
    <span>Control {AB['population']['all']['Players (sum)']['control']:,.0f} vs Variant {AB['population']['all']['Players (sum)']['variant']:,.0f} players</span>
    <span>Sim: {esc(CMP['meta']['sim_vintage'].split(' via')[0])}</span>
    <span>Priority: new users → streaks → coin sink → revenue</span>
  </div>
</header>

<div class="kpis">{KPIS}</div>

{section('diagnosis', 'the read', 'One decision explains most of it',
 'The v2 redesign cut coins and paid the compensation in unlimited-lives minutes. That single '
 'substitution reaches all four problems, because coins and lives are not interchangeable: coins '
 'are the only thing players spend, and lives are what makes them want to.',
 DIAG_BODY)}

{section('howto', 'how to read these', 'Twelve proposals, each with the same five parts',
 'Ordered by the priority you set: new-user engagement first, then streaks, then coin-sink health, '
 'then top-segment revenue. The state chip on each says how much confidence its number carries.',
 HOWTO_BODY)}

{section('newusers', 'problem 1', 'New users: engagement, time spent, first-week retention',
 f'New users lost {pc(pop("HC gain total / player", "new"))} of their coin faucet and '
 f'{pc(booster_new)} of their free boosters. Their completes fell {pc(compl_new)} and D1 churn rose '
 f'{pc(churn_new)} — while old players’ time spent rose {pc(time_old)}. The install cohort passes '
 f'{100 * AB["population"]["new"]["Pass rate"]["variant"]:.0f}% of its attempts, so this is not a '
 'difficulty wall; they were simply given less reason to come back.',
 P[1] + P[2] + P[6])}

{section('streaks', 'problem 2', 'Streaks and daily return',
 f'Streaks fell {pc(streak_all)} overall, {pc(buck("Avg daily streak", "100+"))} at 100+, with the '
 f'P99 down {pc(pop("P99 daily streak"))} — the longest chains broke hardest. Night Sky is the '
 'streak engine, and v2 raised its rewards while leaving every requirement untouched.',
 NS_CLAIM + P[0] + P[3])}

{section('sink', 'problem 3', 'Coin spend and sink health',
 f'Coins spent per player fell {pc(spend_all)} and per attempt {pc(spend_att)}, with net coins '
 f'{pc(pop("HC net (gain - spend) / player"))}. Spend did not fall because players hoarded — '
 'balances fell too. It fell because the faucet shrank and, at the same time, the thing that makes '
 'coins worth spending was given away for free.',
 P[4] + P[5] + P[7])}

{section('revenue', 'problem 4', 'Revenue from the most engaged players',
 f'Revenue fell {pc(rev_all)} overall, {pc(rev_old)} among established players and '
 f'{pc(buck("Total revenue", "100+"))} in the 100+ bucket, where ARPPU fell {pc(pop("ARPPU"))} and '
 'paid coin purchases fell '
 f'{pc(buck("HC gain PAID / player", "100+"))}. You ranked this fourth; the levers are mostly the '
 'sink ones above, plus where the top segment gets paid.',
 P[11])}

{section('trust', 'before you trust these numbers', 'Three things that limit everything above',
 'Two of the proposals are priced with a model we can now prove is miscalibrated, one large event '
 'is mispriced by roughly 5×, and a difficulty change landed in the same release as the economy '
 'change. None of these are design proposals; all three change how much weight the rest deserves.',
 P[9] + P[8] + P[10])}

{section('budget', 'the bill', 'What the whole set costs',
 'Priced against the Control faucet of '
 f'{FAUCET:.0f} coins per active player-day. Positive means giving coins back — the v2 cut was '
 f'{pc(gain_all)}, so a package at +5 coins/pd returns roughly a third of it.',
 BUDGET_BODY)}

{section('method', 'method', 'How these numbers were produced',
 'Everything above is generated from four JSON artefacts; no figure is typed into the page.',
 METHOD_BODY)}
'''

CSS = f'''
:root {{
  --ground: {C['ground']}; --surface: {C['surface']}; --surface2: {C['surface2']};
  --line: {C['line']}; --line2: {C['line2']};
  --ink: {C['ink']}; --ink2: {C['ink2']}; --mut: {C['mut']};
  --model: {C['model']}; --live: {C['live']}; --good: {C['good']}; --warn: {C['warn']};
  --bad: {C['bad']}; --bench: {C['bench']};
  --display: 'Iowan Old Style','Palatino Linotype',Palatino,Georgia,ui-serif,serif;
  --body: -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  --mono: 'Cascadia Mono',Consolas,'SF Mono',monospace;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; background: var(--ground); color: var(--ink);
  font-family: var(--body); font-size: 15px; line-height: 1.62;
  -webkit-font-smoothing: antialiased;
}}
.wrap {{ max-width: 1120px; margin: 0 auto; padding: 44px 26px 90px; }}
p {{ max-width: 74ch; }}
h1, h2, h3, h4 {{ font-family: var(--display); font-weight: 600; text-wrap: balance; margin: 0; }}
h1 {{ font-size: clamp(34px, 5vw, 52px); line-height: 1.06; letter-spacing: -0.015em; }}
h2 {{ font-size: 27px; line-height: 1.16; margin-bottom: 10px; }}
h4 {{ font-size: 19px; line-height: 1.25; }}
h5 {{ font: 650 10.5px/1.4 var(--mono); text-transform: uppercase; letter-spacing: 0.09em;
      color: var(--mut); margin: 0 0 8px; }}
.eyebrow {{ font: 650 10.5px/1.4 var(--mono); text-transform: uppercase; letter-spacing: 0.14em;
            color: var(--model); margin-bottom: 12px; }}
.mast {{ border-bottom: 1px solid var(--line); padding-bottom: 26px; margin-bottom: 26px; }}
.dek {{ font-size: 17.5px; color: var(--ink2); margin: 16px 0 20px; max-width: 68ch; }}
.meta {{ display: flex; flex-wrap: wrap; gap: 8px 20px; font: 11.5px/1.5 var(--mono); color: var(--mut); }}
.meta span::before {{ content: '·'; margin-right: 8px; color: var(--line2); }}
.meta span:first-child::before {{ content: none; }}

.kpis {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(212px, 1fr)); gap: 12px;
         margin-bottom: 40px; }}
.kpi {{ background: var(--surface); border: 1px solid var(--line); border-radius: 3px; padding: 14px 15px; }}
.kl {{ font: 11px/1.35 var(--mono); color: var(--mut); text-transform: uppercase; letter-spacing: 0.05em;
       min-height: 2.6em; }}
.kv {{ font-family: var(--display); font-size: 30px; line-height: 1.1; margin: 6px 0 4px;
       font-variant-numeric: tabular-nums; }}
.ks {{ font: 11.5px/1.5 var(--mono); color: var(--ink2); }}

.sec {{ margin-bottom: 54px; scroll-margin-top: 20px; }}
.sec > .lead {{ font-size: 16.5px; color: var(--ink2); margin: 0 0 22px; max-width: 76ch; }}
.cols {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 8px 34px; }}
.cols p, .cols li {{ max-width: 62ch; }}
ul.diag, ol.steps {{ padding-left: 20px; }}
ul.diag li, ol.steps li {{ margin-bottom: 9px; color: var(--ink2); font-size: 14px; }}
.note {{ font-size: 13px; color: var(--mut); border-left: 2px solid var(--line2); padding-left: 12px;
         margin-top: 22px; max-width: 82ch; }}
.legend {{ font: 12.5px/2 var(--mono); color: var(--ink2); background: var(--surface);
           border: 1px solid var(--line); border-radius: 3px; padding: 12px 15px; margin-bottom: 16px; }}

.prop {{ background: var(--surface); border: 1px solid var(--line); border-radius: 3px;
         padding: 22px 24px 20px; margin: 20px 0; }}
.ph {{ display: flex; gap: 16px; align-items: baseline; border-bottom: 1px solid var(--line);
       padding-bottom: 14px; margin-bottom: 15px; }}
.pid {{ font: 650 13px/1 var(--mono); color: var(--model); background: rgba(91,156,230,.11);
        border: 1px solid rgba(91,156,230,.3); border-radius: 2px; padding: 6px 8px; flex: none; }}
.pt {{ flex: 1; }}
.pmeta {{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }}
.thesis {{ font-size: 15.5px; color: var(--ink); background: var(--surface2);
           border-left: 2px solid var(--model); padding: 11px 14px; margin: 0 0 18px; max-width: none; }}
.conflict {{ background: rgba(224,179,76,.07); border: 1px solid rgba(224,179,76,.3);
             border-left: 3px solid var(--warn); border-radius: 3px; padding: 12px 14px;
             margin: 0 0 16px; }}
.conflict p {{ font-size: 13.5px; color: var(--ink2); margin: 7px 0 0; max-width: none; }}
.cl {{ font: 650 9.5px/1.7 var(--mono); text-transform: uppercase; letter-spacing: 0.08em;
       color: var(--warn); }}
.pwide {{ margin: 0 0 18px; }}
.pwide table {{ font-size: 12.5px; }}
.pgrid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 22px 30px; }}
.pb {{ min-width: 0; }}
.pb p {{ font-size: 14px; color: var(--ink2); margin: 0 0 10px; }}
.pb.bwrap {{ margin-top: 20px; }}
.pcost {{ font: 12.5px/1.6 var(--mono); color: var(--warn); background: rgba(224,179,76,.08);
          border: 1px solid rgba(224,179,76,.28); border-radius: 3px; padding: 10px 13px; margin-top: 18px; }}
.prisk {{ font-size: 13.5px; color: var(--ink2); margin-top: 14px; padding-top: 13px;
          border-top: 1px solid var(--line); max-width: none; }}
.rl {{ font: 650 10px/1 var(--mono); text-transform: uppercase; letter-spacing: 0.1em;
       color: var(--bad); margin-right: 8px; }}

.bench {{ display: flex; gap: 12px; align-items: flex-start; margin-bottom: 11px; }}
.bl {{ font: 650 9.5px/1.7 var(--mono); text-transform: uppercase; letter-spacing: 0.07em;
       padding: 1px 7px; border-radius: 2px; flex: none; white-space: nowrap; }}
.bl.published {{ color: var(--bench); background: rgba(155,139,232,.14); border: 1px solid rgba(155,139,232,.36); }}
.bl.observed {{ color: var(--model); background: rgba(91,156,230,.12); border: 1px solid rgba(91,156,230,.32); }}
.bl.inference {{ color: var(--mut); background: rgba(122,143,176,.12); border: 1px solid var(--line2); }}
.bt {{ font-size: 13.5px; color: var(--ink2); max-width: 70ch; }}

.chip {{ font: 650 10px/1.7 var(--mono); text-transform: uppercase; letter-spacing: 0.06em;
         padding: 1px 8px; border-radius: 2px; border: 1px solid var(--line2); color: var(--mut); }}
.chip.area {{ color: var(--ink2); }}
.chip.priced {{ color: var(--good); border-color: rgba(85,199,126,.4); background: rgba(85,199,126,.1); }}
.chip.model {{ color: var(--warn); border-color: rgba(224,179,76,.4); background: rgba(224,179,76,.1); }}
.chip.gap {{ color: var(--bad); border-color: rgba(224,104,92,.4); background: rgba(224,104,92,.1); }}
.chip.flag {{ color: var(--mut); }}

.tw {{ overflow-x: auto; margin: 14px 0; }}
table {{ border-collapse: collapse; width: 100%; font-size: 13px; }}
th {{ font: 650 10px/1.4 var(--mono); text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--mut); text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line2);
      white-space: nowrap; }}
td {{ padding: 6px 10px; border-bottom: 1px solid var(--line); color: var(--ink2);
      vertical-align: top; }}
table.num td {{ font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }}
table.num td:nth-child(2), table.num td:nth-child(3) {{ color: var(--ink2); }}
/* the descriptive column in the cost table must wrap, or the numeric columns fall off the edge */
table.num td:nth-child(2) {{ white-space: normal; min-width: 24ch; }}
.tnote {{ font-size: 12.5px; color: var(--mut); margin: 8px 0 0; max-width: 88ch; }}
code {{ font-family: var(--mono); font-size: 0.88em; color: var(--ink);
        background: rgba(91,156,230,.09); padding: 1px 4px; border-radius: 2px; }}
svg {{ display: block; margin: 6px 0 4px; }}
svg text {{ user-select: none; }}
a {{ color: var(--model); }}
:focus-visible {{ outline: 2px solid var(--model); outline-offset: 2px; }}
@media (prefers-reduced-motion: reduce) {{ * {{ transition: none !important; animation: none !important; }} }}
@media (max-width: 620px) {{
  .wrap {{ padding: 28px 16px 60px; }}
  .ph {{ flex-direction: column; gap: 10px; }}
}}
'''

DOC = f'''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>What to Change for v3</title>
<style>{CSS}</style>
</head><body><div class="wrap">{BODY}</div></body></html>'''

ART = f'''<title>What to Change for v3</title>
<style>{CSS}</style>
<div class="wrap">{BODY}</div>'''

os.makedirs(REPORTS, exist_ok=True)
rp = os.path.join(REPORTS, 'LiveOps_v3_economy_playbook.html')
with open(rp, 'w', encoding='utf-8') as f:
    f.write(DOC)
ap = os.path.join(OUT, 'proposals_body.html')
with open(ap, 'w', encoding='utf-8') as f:
    f.write(ART)
print(f'written {rp} {len(DOC):,} bytes')
print(f'written {ap} {len(ART):,} bytes')
print(f'proposals: {len(P)} | faucet {FAUCET:.1f} coins/pd | '
      f'free fix {hc_cost("B-ns-reshape"):+.2f} | funded package {hc_cost("PKG-funded"):+.2f}')
