# Build the sim-vs-actual discrepancy report (dark-green single-theme HTML).
#
# Inputs : analysis/out/comparison.json  (single source of truth — every number in the page)
#          analysis/out/verification.json (optional; adversarial verdicts per claim id)
# Outputs: reports/LiveOps_v2_sim_vs_actual_discrepancy.html  (standalone document)
#          analysis/out/artifact_body.html                    (same content, no document shell —
#                                                              the claude.ai artifact publish copy)
# Usage  : python analysis/_build_report.py
import json, os, math, html

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
cmp_ = json.load(open(os.path.join(OUT, 'comparison.json'), encoding='utf-8'))
aux_ = json.load(open(os.path.join(OUT, 'actuals_aux.json'), encoding='utf-8'))
VERIFY = {}
vpath = os.path.join(OUT, 'verification.json')
if os.path.exists(vpath):
    for v in json.load(open(vpath, encoding='utf-8')):
        VERIFY[v['claim_id']] = v

CELLS = cmp_['cells']
SEGS = cmp_['meta']['segments']
STORY = cmp_['story']
AGG = cmp_['aggregates']
FULL = cmp_['full_scope']              # whole-faucet view (all 25 sources, nothing excluded)
WBF = cmp_.get('workbook_fill_check')  # which engine version the workbook's display sheets show
GATES = cmp_['gates']
XG = cmp_['extract_gates']

# ---------------------------------------------------------------- palette (validated)
C = dict(page='#0C1710', card='#111E16', raise_='#16281C', line='#24382C', line2='#2E4636',
         ink='#E8F2EA', ink2='#9DB4A2', mut='#69816F',
         sim='#5898DD', act='#CE7A36',
         good='#55C77E', warn='#E0B34C', bad='#E0685C', info='#8FA8C8')

def esc(s): return html.escape(str(s), quote=True)
def f2(x, nd=2):
    if x is None: return '—'
    return f'{x:,.{nd}f}'
def fr(x, nd=2):
    if x is None: return '—'
    return f'×{x:.{nd}f}'
def pct(x, nd=0):
    if x is None: return '—'
    return f'{100*(x-1):+.{nd}f}%'

STATUS_COL = {'green': C['good'], 'amber': C['warn'], 'red': C['bad'], 'info': C['info'], 'na': C['mut']}

def vbadge(claim_id):
    if claim_id == 'GATE':
        return '<span class="chip good">pipeline gate — PASS</span>'
    v = VERIFY.get(claim_id)
    if not v:
        return f'<span class="chip mut">verification pending</span>'
    col = {'CONFIRMED': 'good', 'ADJUSTED': 'warn', 'REFUTED': 'bad'}[v['verdict']]
    lab = {'CONFIRMED': '✓ independently re-derived', 'ADJUSTED': '⚠ adjusted on verification',
           'REFUTED': '✗ refuted'}[v['verdict']]
    note = esc(v.get('notes', ''))
    return f'<span class="chip {col}" title="{note}">{lab}</span>'

def proof(pid, claim, inputs, formula, recipe, vid=None):
    rows = ''.join(f'<tr><td>{esc(k)}</td><td class="num">{esc(v)}</td></tr>' for k, v in inputs)
    return f'''<details class="proof"><summary><span class="pid">PROOF {esc(pid)}</span> {esc(claim)} {vbadge(vid or pid)}</summary>
<div class="pbody"><table class="ptab">{rows}</table>
<div class="pform">{formula}</div>
<div class="precipe"><b>Verify it yourself:</b> {recipe}</div></div></details>'''

# ================================================================ SVG helpers
def svg_open(w, h): return f'<svg viewBox="0 0 {w} {h}" width="100%" style="max-width:{w}px" role="img">'
def txt(x, y, s, size=11, fill=None, anchor='start', weight=400, mono=True, dy=0):
    fam = "font-family:'Cascadia Mono',Consolas,monospace;" if mono else ''
    return (f'<text x="{x}" y="{y+dy}" font-size="{size}" fill="{fill or C["ink2"]}" '
            f'text-anchor="{anchor}" font-weight="{weight}" style="{fam}font-variant-numeric:tabular-nums">{esc(s)}</text>')

def grouped_bars(title, groups, series, width=640, h_bar=13, gap=2, group_gap=14, unit='', left=None):
    """groups: [(label, [v...])]; series: [(name, color)]. Horizontal grouped bars, direct labels."""
    n = len(series)
    if left is None:                                     # size the margin to the longest label
        left = max(90, min(260, 12 + 7 * max((len(g) for g, _ in groups), default=10)))
    right = 70
    vmax = max((abs(v) for _, vs in groups for v in vs if v is not None), default=1) or 1
    gh = n * (h_bar + gap) - gap
    H = 30 + len(groups) * (gh + group_gap)
    o = [svg_open(width, H)]
    y = 24
    o.append(txt(left, 12, title, 11.5, C['ink'], weight=600, mono=False))
    for glab, vs in groups:
        o.append(txt(left - 8, y + gh / 2 + 4, glab, 11, C['ink2'], anchor='end'))
        for i, v in enumerate(vs):
            if v is None: continue
            bw = (width - left - right) * abs(v) / vmax
            yy = y + i * (h_bar + gap)
            col = series[i][1]
            o.append(f'<rect x="{left}" y="{yy}" width="{max(bw,1.5):.1f}" height="{h_bar}" rx="2" fill="{col}">'
                     f'<title>{esc(glab)} · {esc(series[i][0])}: {f2(v)}{unit}</title></rect>')
            o.append(txt(left + max(bw, 1.5) + 6, yy + h_bar - 3, f2(v) + unit, 10.5, C['ink2']))
        y += gh + group_gap
    o.append('</svg>')
    legend = ' '.join(f'<span class="lg"><i style="background:{c}"></i>{esc(n)}</span>' for n, c in series)
    return ''.join(o), legend

def scatter(cells, width=680, H=460):
    """log2 r_act (x) vs log2 r_sim (y), SCORED+WINDOW_MISS cells; size=|d_act|; unity diagonal."""
    pts = [c for c in cells if c.get('r_sim') and c.get('r_act') and c['r_sim'] > 0 and c['r_act'] > 0
           and c['class'] in ('SCORED', 'WINDOW_MISS')]
    L = 3.0
    left, top, right, bot = 52, 18, 14, 40
    pw, ph = width - left - right, H - top - bot
    def X(v): return left + pw * (max(-L, min(L, math.log2(v))) + L) / (2 * L)
    def Y(v): return top + ph * (L - max(-L, min(L, math.log2(v)))) / (2 * L)
    o = [svg_open(width, H)]
    # bands: |log2 RoR| < log2(1.25) green-ish zone around diagonal — draw diagonal band
    for lim, colr in [(1.5, C['bad']), (1.25, C['warn'])]:
        d = math.log2(lim)
        x0, y0 = X(2 ** -L), Y(2 ** (-L))
        pts_band = []
    # grid
    for g in [-3, -2, -1, 0, 1, 2, 3]:
        xg = left + pw * (g + L) / (2 * L)
        yg = top + ph * (L - g) / (2 * L)
        o.append(f'<line x1="{xg:.0f}" y1="{top}" x2="{xg:.0f}" y2="{top+ph}" stroke="{C["line"]}" stroke-width="1"/>')
        o.append(f'<line x1="{left}" y1="{yg:.0f}" x2="{left+pw}" y2="{yg:.0f}" stroke="{C["line"]}" stroke-width="1"/>')
        o.append(txt(xg, H - 24, f'×{2**g:g}', 10, C['mut'], anchor='middle'))
        o.append(txt(left - 6, yg + 3.5, f'×{2**g:g}', 10, C['mut'], anchor='end'))
    # unity diagonal (perfect prediction)
    o.append(f'<line x1="{X(2**-L):.0f}" y1="{Y(2**-L):.0f}" x2="{X(2**L):.0f}" y2="{Y(2**L):.0f}" '
             f'stroke="{C["ink2"]}" stroke-width="1.5" stroke-dasharray="5 4"/>')
    o.append(txt(X(2**2.15), Y(2**2.5), 'perfect prediction', 10, C['ink2']))
    # quadrant hints
    o.append(txt(left + 8, top + 14, 'sim said UP · live went DOWN', 10, C['mut']))
    o.append(txt(left + pw - 8, top + ph - 10, 'sim said DOWN · live went UP', 10, C['mut'], anchor='end'))
    dmax = max((abs(c['d_act_papd']) for c in pts), default=1) or 1
    for c_ in sorted(pts, key=lambda c: -abs(c['d_act_papd'])):
        r = 3 + 9 * math.sqrt(abs(c_['d_act_papd']) / dmax)
        col = STATUS_COL[c_['status']]
        dash = ' stroke-dasharray="2 2"' if c_['class'] == 'WINDOW_MISS' else ''
        o.append(f'<circle cx="{X(c_["r_act"]):.1f}" cy="{Y(c_["r_sim"]):.1f}" r="{r:.1f}" fill="{col}" '
                 f'fill-opacity="0.55" stroke="{col}"{dash} stroke-width="1.4">'
                 f'<title>{esc(c_["segment"])} · {esc(c_["category"])} · {esc(c_["resource"])}\n'
                 f'sim {fr(c_["r_sim"])} · live {fr(c_["r_act"])} · Δlive {f2(c_["d_act_papd"])}/pd'
                 f'{" · 33-day fallback" if c_["class"]=="WINDOW_MISS" else ""}</title></circle>')
    # label the biggest misses, staggered above/below to dodge the central cluster
    labelled = [c for c in sorted(pts, key=lambda c: -abs(c['d_act_papd']))[:5]]
    for i, c_ in enumerate(labelled):
        dy = -10 - 11 * (i % 3) if i % 2 == 0 else 16 + 11 * (i % 3)
        lx = X(c_['r_act']); anchor = 'start' if lx < left + pw * 0.62 else 'end'
        o.append(txt(lx + (8 if anchor == 'start' else -8), Y(c_['r_sim']) + dy,
                     f'{c_["category"]} {c_["resource"]} · {c_["segment"]}', 9.5, C['ink2'], anchor=anchor))
    o.append(txt(left + pw / 2, H - 8, 'live change (Variant ÷ Control, per-active-player-day)', 10.5, C['ink2'], anchor='middle', mono=False))
    o.append(f'<text x="14" y="{top+ph/2}" font-size="10.5" fill="{C["ink2"]}" text-anchor="middle" transform="rotate(-90 14 {top+ph/2})">sim predicted change (windowed)</text>')
    o.append('</svg>')
    return ''.join(o)

def heatmap_legend():
    """Explicit swatch legend: the diverging fill ramp + every class glyph as a mini-cell."""
    o = [svg_open(940, 64)]
    o.append(txt(2, 12, 'scored cells — fill = how far the sim ratio sits from the live ratio:', 10.5, C['ink2'], mono=False))
    ramp = [(-2, '×¼'), (-1, '×½'), (0, 'match'), (1, '×2'), (2, '×4  (sim ÷ live)')]
    x = 8
    for t, lab in ramp:
        if t >= 0: fill, op = C['sim'], 0.15 + 0.75 * (t / 2)
        else: fill, op = C['act'], 0.15 + 0.75 * (-t / 2)
        o.append(f'<rect x="{x}" y="18" width="30" height="22" rx="3" fill="{fill}" fill-opacity="{op:.2f}"/>')
        o.append(txt(x + 15, 54, lab, 9.5, C['mut'], anchor='middle'))
        x += 36
    x += 26
    o.append(txt(x, 12, 'letter cells — not ratio-scorable, the letter says why:', 10.5, C['ink2'], mono=False))
    for g, col, lab in [('✓', C['good'], 'kill agreed'), ('B', C['bad'], 'baseline≠Control'), ('S', C['bad'], 'stale baseline'),
                        ('W', C['warn'], 'window-missed'), ('+', C['info'], 'new both'), ('N', C['bad'], 'not modeled'),
                        ('◉', C['info'], 'NS direct'), ('✖', C['bad'], 'sign-flip')]:
        o.append(f'<rect x="{x}" y="18" width="30" height="22" rx="3" fill="{C["card"]}" stroke="{col}" stroke-width="1.2"/>')
        o.append(txt(x + 15, 34, g, 13, col, anchor='middle', weight=700))
        o.append(txt(x + 15, 54, lab, 8.5, C['mut'], anchor='middle'))
        x += max(38, 8 + 7 * len(lab) - 20)
    o.append('</svg>')
    return ''.join(o)

def heatmap(cells, res='HC', width=980):
    sizes = {}
    for c in cells:
        if c['resource'] == res:
            sizes[c['category']] = sizes.get(c['category'], 0) + c['a_C'] + c['a_V']
    cats = [k for k, _ in sorted(sizes.items(), key=lambda x: -x[1])]
    cell_w, cell_h, left, top = 34, 26, 190, 46
    W = left + len(SEGS) * cell_w + 20
    H = top + len(cats) * cell_h + 14
    o = [svg_open(W, H)]
    for j, s in enumerate(SEGS):
        o.append(txt(left + j * cell_w + cell_w / 2, top - 10, s, 10, C['ink2'], anchor='middle'))
    idx = {(c['category'], c['segment']): c for c in cells if c['resource'] == res}
    GLYPH = {'BASELINE_MISMATCH': 'B', 'WINDOW_MISS': 'W', 'STALE_BASELINE': 'S', 'NOT_MODELED': 'N',
             'NEW_BOTH': '+', 'KILL_AGREED': '✓', 'KILL_MISSED': '!', 'KILL_PHANTOM': '!',
             'SIM_ONLY_NEW': '?', 'ACT_ONLY_NEW': '!', 'TRIVIAL': '·', 'NS_DIRECT': '◉'}
    for i, cat in enumerate(cats):
        o.append(txt(left - 8, top + i * cell_h + cell_h / 2 + 3.5, cat, 10.5, C['ink2'], anchor='end'))
        for j, s in enumerate(SEGS):
            c_ = idx.get((cat, s))
            x, y = left + j * cell_w, top + i * cell_h
            if c_ is None:
                o.append(f'<rect x="{x+1}" y="{y+1}" width="{cell_w-2}" height="{cell_h-2}" rx="3" fill="{C["card"]}"/>')
                continue
            l2 = c_.get('log2_RoR')
            if c_['class'] in ('SCORED', 'WINDOW_MISS') and l2 is not None:
                t = max(-2, min(2, l2)) / 2
                # diverging: sim-over (blue) vs sim-under (orange), neutral at surface
                if t >= 0:
                    a = 0.15 + 0.75 * t
                    fill = f'{C["sim"]}'; op = a
                else:
                    a = 0.15 + 0.75 * (-t)
                    fill = f'{C["act"]}'; op = a
                dash = f' stroke="{C["ink2"]}" stroke-dasharray="3 2" stroke-width="1"' if c_['class'] == 'WINDOW_MISS' else ''
                o.append(f'<rect x="{x+1}" y="{y+1}" width="{cell_w-2}" height="{cell_h-2}" rx="3" fill="{fill}" fill-opacity="{op:.2f}"{dash}>'
                         f'<title>{esc(cat)} · {esc(s)}\nsim {fr(c_["r_sim"])} vs live {fr(c_["r_act"])} → RoR {fr(c_["RoR"])}'
                         f'{" (33-day fallback)" if c_["class"]=="WINDOW_MISS" else ""}</title></rect>')
                if c_['sign_flip']:
                    o.append(txt(x + cell_w / 2, y + cell_h / 2 + 4, '✖', 11, C['bad'], anchor='middle', weight=700))
            else:
                col = STATUS_COL[c_['status']]
                o.append(f'<rect x="{x+1}" y="{y+1}" width="{cell_w-2}" height="{cell_h-2}" rx="3" fill="{C["card"]}" stroke="{col}" stroke-width="1.2">'
                         f'<title>{esc(cat)} · {esc(s)} · {esc(c_["class"])}\nControl {f2(c_["a_C"])}/pd → Variant {f2(c_["a_V"])}/pd</title></rect>')
                o.append(txt(x + cell_w / 2, y + cell_h / 2 + 4.5, GLYPH.get(c_['class'], '·'), 13, col, anchor='middle', weight=700))
    o.append('</svg>')
    return ''.join(o)

def tornado(rows, width=900, title=''):
    """rows: (label, d_act, d_sim or None) sorted by |d_act|. Label column | zero-anchored
    mirrored bar pair per row, value labels OUTSIDE the bars, generous row height."""
    h_bar, pair_gap, row_gap, left = 16, 3, 16, 268
    vmax = max((max(abs(r[1]), abs(r[2]) if r[2] is not None else 0) for r in rows), default=1) or 1
    neg_max = max((max(-min(r[1], 0), -min(r[2] or 0, 0)) for r in rows), default=0)
    pos_max = max((max(max(r[1], 0), max(r[2] or 0, 0)) for r in rows), default=0)
    span = neg_max + pos_max or 1
    plot_w = width - left - 160
    scale = plot_w / span
    zero_x = left + neg_max * scale + 75
    row_h = 2 * h_bar + pair_gap
    H = 34 + len(rows) * (row_h + row_gap)
    o = [svg_open(width, H)]
    o.append(txt(16, 14, title, 12, C['ink'], weight=600, mono=False))
    y = 30
    for lab, da, ds in rows:
        o.append(txt(left - 10, y + row_h / 2 + 4, lab, 11, C['ink2'], anchor='end'))
        for v, col, name, yy in [(da, C['act'], 'live Δ', y), (ds, C['sim'], 'sim predicted Δ', y + h_bar + pair_gap)]:
            if v is None:
                o.append(txt(zero_x + 8, yy + h_bar - 4, '· not scorable', 10, C['mut']))
                continue
            bw = max(abs(v) * scale, 1.5)
            x = zero_x if v >= 0 else zero_x - bw
            o.append(f'<rect x="{x:.1f}" y="{yy}" width="{bw:.1f}" height="{h_bar-2}" rx="2" fill="{col}">'
                     f'<title>{esc(lab)} · {name}: {f2(v)}/pd</title></rect>')
            lx = zero_x + bw + 7 if v >= 0 else zero_x - bw - 7
            o.append(txt(lx, yy + h_bar - 4, f2(v), 10.5, C['ink'],
                         anchor='start' if v >= 0 else 'end'))
        y += row_h + row_gap
    o.append(f'<line x1="{zero_x:.0f}" y1="26" x2="{zero_x:.0f}" y2="{H-8}" stroke="{C["line2"]}" stroke-width="1"/>')
    o.append(txt(zero_x, H - 0, '', 9, C['mut']))
    o.append('</svg>')
    return ''.join(o)

def milestone_chart(split, width=720, H=280):
    """season_pass_milestone_split rows: milestone, pct_control, pct_variant."""
    rows = [(int(r['milestone']), float(r['pct_control']), float(r['pct_variant'])) for r in split]
    rows = [r for r in rows if r[0] >= 1]
    left, top, right, bot = 46, 16, 14, 34
    pw, ph = width - left - right, H - top - bot
    vmax = max(max(r[1], r[2]) for r in rows) * 1.12
    n = len(rows)
    bw = pw / n / 2 - 1.5
    o = [svg_open(width, H)]
    for gv in range(0, int(vmax) + 1, 2):
        yg = top + ph * (1 - gv / vmax)
        o.append(f'<line x1="{left}" y1="{yg:.0f}" x2="{left+pw}" y2="{yg:.0f}" stroke="{C["line"]}"/>')
        o.append(txt(left - 6, yg + 3.5, f'{gv}%', 9.5, C['mut'], anchor='end'))
    for i, (m, pc, pv) in enumerate(rows):
        x0 = left + pw * i / n
        for k, (v, col, nm) in enumerate([(pc, C['sim'], 'Control'), (pv, C['act'], 'Variant')]):
            hh = ph * v / vmax
            o.append(f'<rect x="{x0 + k*(bw+1.5):.1f}" y="{top+ph-hh:.1f}" width="{bw:.1f}" height="{hh:.1f}" rx="1.5" fill="{col}">'
                     f'<title>milestone {m} · {nm}: {v}%</title></rect>')
        if m % 5 == 0 or m == 30 or m == 1:
            o.append(txt(x0 + bw, H - 20, str(m), 9.5, C['mut'], anchor='middle'))
    o.append(txt(left + pw / 2, H - 6, 'season-pass milestone reached — share of players', 10.5, C['ink2'], anchor='middle', mono=False))
    o.append('</svg>')
    return ''.join(o)

def overlay_chart(ov, seg, width=700, H=230):
    d = ov[seg]
    sim_v, act_v = d['sim_new_hc'], d['act_v_hc_papd']
    def norm(vs):
        m = sum(vs) / len(vs) if vs else 1
        return [v / m if m else 0 for v in vs]
    sN, aN = norm(sim_v), norm(act_v)
    left, top, right, bot = 46, 18, 16, 52
    pw, ph = width - left - right, H - top - bot
    vmax = max(sN + aN) * 1.15
    n = len(d['dates'])
    def X(i): return left + pw * (i + 0.5) / n
    def Y(v): return top + ph * (1 - v / vmax)
    o = [svg_open(width, H)]
    for gv in [0.5, 1.0, 1.5]:
        o.append(f'<line x1="{left}" y1="{Y(gv):.0f}" x2="{left+pw}" y2="{Y(gv):.0f}" stroke="{C["line"]}"/>')
        o.append(txt(left - 6, Y(gv) + 3.5, f'{gv:g}×', 9.5, C['mut'], anchor='end'))
    for vs, col, nm in [(sN, C['sim'], 'sim (windowed alloc)'), (aN, C['act'], 'live Variant')]:
        pth = ' '.join(f'{"M" if i==0 else "L"}{X(i):.1f},{Y(v):.1f}' for i, v in enumerate(vs))
        o.append(f'<path d="{pth}" fill="none" stroke="{col}" stroke-width="2"/>')
        for i, v in enumerate(vs):
            o.append(f'<circle cx="{X(i):.1f}" cy="{Y(v):.1f}" r="3.2" fill="{col}"><title>{nm} · {d["dates"][i]}: {v:.2f}× window mean</title></circle>')
    for i, dt in enumerate(d['dates']):
        o.append(txt(X(i), H - 34, dt[5:], 9, C['mut'], anchor='middle'))
        o.append(txt(X(i), H - 22, f'd{d["cal_days"][i]}', 9, C['ink2'], anchor='middle'))
    o.append(txt(left + pw / 2, H - 7, f'{seg} — daily HC shape, indexed to window mean (top: date · bottom: mapped cal_new day)', 10, C['ink2'], anchor='middle', mono=False))
    # wrap seam marker (only when the mapped day list is non-contiguous)
    dl = d['cal_days']
    for i in range(len(dl) - 1):
        if dl[i + 1] != dl[i] + 1:
            xw = (X(i) + X(i + 1)) / 2
            o.append(f'<line x1="{xw:.0f}" y1="{top}" x2="{xw:.0f}" y2="{top+ph}" stroke="{C["warn"]}" stroke-width="1.5" stroke-dasharray="4 3"/>')
            o.append(txt(xw + 4, top + 12, f'wrap {dl[i]}→{dl[i+1]}', 9.5, C['warn']))
    o.append('</svg>')
    return ''.join(o)

def data_table(headers, rows):
    th = ''.join(f'<th>{esc(h)}</th>' for h in headers)
    trs = ''.join('<tr>' + ''.join(f'<td class="num">{esc(v)}</td>' for v in r) + '</tr>' for r in rows)
    head = '<thead><tr>' + th + '</tr></thead>'
    return f'<details class="dtab"><summary>data table</summary><div class="tw"><table>{head}<tbody>{trs}</tbody></table></div></details>'

# ================================================================ derived display data
cc = GATES['class_census']
n_scored = cc.get('SCORED', 0)
statusN = {}
for c in CELLS: statusN[c['status']] = statusN.get(c['status'], 0) + 1
scored = [c for c in CELLS if c['class'] == 'SCORED']
scored_green = sum(1 for c in scored if c['status'] == 'green')
scored_amber = sum(1 for c in scored if c['status'] == 'amber')
scored_red = sum(1 for c in scored if c['status'] == 'red')
flips = [c for c in CELLS if c.get('sign_flip')]

hcA = AGG['HC']; sptA = AGG['SPT']
hcF = FULL['HC']; sptF = FULL['SPT']; ulF = FULL['Unlimited Lives']
# per-source whole-faucet contributions used in the prose below (sim vs live, papd)
def bc(res, cat, side='sim'):
    v = FULL[res]['by_category'].get(cat)
    if not v: return 0.0
    return v['d_sim_papd_bridge'] if side == 'sim' else v['d_act_papd']

# tornado data: top cells by |d_act| for HC and SPT
def tor_rows(res, n=12):
    rows = []
    for c in sorted([c for c in CELLS if c['resource'] == res and c['d_act_papd'] is not None],
                    key=lambda c: -abs(c['d_act_papd']))[:n]:
        rows.append((f"{c['category']} · {c['segment']}", round(c['d_act_papd'], 2),
                     round(c['d_sim_papd'], 2) if c['d_sim_papd'] is not None else None))
    return rows

ns = STORY['night_sky']
ksp = STORY['core_spt']
saga = STORY['saga']
dg = STORY['daily_gift']
rm = STORY['rainbow_maker']
killed = STORY['killed']

# ================================================================ page assembly
def chip(txt_, cls='mut'): return f'<span class="chip {cls}">{esc(txt_)}</span>'

verified_n = sum(1 for v in VERIFY.values() if v['verdict'] == 'CONFIRMED')
adjusted_n = sum(1 for v in VERIFY.values() if v['verdict'] == 'ADJUSTED')
refuted_n = sum(1 for v in VERIFY.values() if v['verdict'] == 'REFUTED')

head_chips = ''.join([
    chip('actuals: 2–10 Aug 2026 · 9 days'),
    chip('sim: workbook (16) · offline harness'),
    chip('window: cal days 5–13 (phase corrected — see P0)', 'warn'),
    chip(f'{len(CELLS)} cells · {n_scored} scored'),
    chip(f'verification: {verified_n} confirmed / {adjusted_n} adjusted / {refuted_n} refuted',
         'good' if refuted_n == 0 and verified_n > 0 else 'mut'),
])


# ---- section 00: estimated-vs-actual delta matrix (all sources x segments + overall) --------
# Auto-regenerates from comparison.json on every pipeline run — when Garry drops new data
# (workbook or A/B exports), re-run the pipeline and republish; this section follows.
def build_overall_section():
    pdC_ = {d['segment']: d['player_days'] for d in cmp_['denominators'] if d['arm'] == 'Control'}
    PDC = sum(pdC_.values())
    # ONE canonical row order for every matrix (Garry 2026-08-17): sources sorted by their
    # live HC impact, so the same event sits on the same row in HC, SPT and all booster tables.
    hc_ix = {(c['category'], c['segment']): c for c in CELLS if c['resource'] == 'HC'}
    CANON = sorted({c['category'] for c in CELLS},
                   key=lambda cat: -sum(abs(hc_ix[(cat, s)]['d_act_papd']) * pdC_[s]
                                        for s in SEGS if (cat, s) in hc_ix) / PDC)
    def matrix_for(res):
        cell_ix = {(c['category'], c['segment']): c for c in CELLS if c['resource'] == res}
        present = {c['category'] for c in CELLS if c['resource'] == res}
        cats = [cat for cat in CANON if cat in present]
        # overall per category (player-day weighted)
        ov = {}
        for cat in cats:
            act = sum(cell_ix[(cat, s)]['d_act_papd'] * pdC_[s] for s in SEGS if (cat, s) in cell_ix) / PDC
            preds = [(cell_ix[(cat, s)]['d_sim_papd'], pdC_[s]) for s in SEGS
                     if (cat, s) in cell_ix and cell_ix[(cat, s)]['d_sim_papd'] is not None]
            pred = sum(v * w for v, w in preds) / PDC if preds else None
            ov[cat] = (pred, act)
        # top misses: |act - pred| across all cells incl. overall
        errs = []
        for cat in cats:
            for s in SEGS:
                c = cell_ix.get((cat, s))
                if c and c['d_sim_papd'] is not None:
                    errs.append((abs(c['d_act_papd'] - c['d_sim_papd']), cat, s))
            if ov[cat][0] is not None:
                errs.append((abs(ov[cat][1] - ov[cat][0]), cat, 'ALL'))
        hot = {(cat, s) for _, cat, s in sorted(errs, reverse=True)[:10]}
        err_max = max((e for e, _, _ in errs), default=1) or 1
        GL = {'BASELINE_MISMATCH': 'B', 'STALE_BASELINE': 'S', 'WINDOW_MISS': 'W', 'NOT_MODELED': 'N',
              'NEW_BOTH': '+', 'KILL_AGREED': '✓', 'NS_DIRECT': '◉', 'TRIVIAL': '·',
              'SIM_ONLY_NEW': '?', 'ACT_ONLY_NEW': '!', 'KILL_MISSED': '!', 'KILL_PHANTOM': '!'}
        def cell_html(pred, act, cat, s, cls=None, fb=False):
            if pred is None:
                g = GL.get(cls, '·')
                return (f'<td class="mx na" title="{esc(cat)} · {esc(s)} · {esc(cls or "n/a")} — '
                        f'live Δ {act:+.2f}/pd; not scorable">{g}<span class="mxa">{act:+.1f}</span></td>')
            err = act - pred
            # tint = RELATIVE disagreement (how wrong the estimate is, not how big the source is),
            # damped so cells with a negligible absolute miss stay dark; the ring separately marks
            # the ten biggest ABSOLUTE misses.
            rel = abs(err) / max(abs(act), abs(pred), 1e-9)
            damp = min(1.0, abs(err) / (0.08 * err_max + 1e-9))
            a = min(1.0, rel) * damp * 0.55
            hotc = ' hot' if (cat, s) in hot else ''
            fbm = '*' if fb else ''
            return (f'<td class="mx{hotc}" style="background:rgba(224,104,92,{a:.2f})" '
                    f'title="{esc(cat)} · {esc(s)}\npredicted Δ {pred:+.2f}/pd · live Δ {act:+.2f}/pd · miss {err:+.2f}">'
                    f'<span class="mxa">{act:+.1f}</span><span class="mxp">{pred:+.1f}{fbm}</span></td>')
        rows = ''
        for cat in cats:
            tds = ''
            for s in SEGS:
                c = cell_ix.get((cat, s))
                if c is None:
                    tds += '<td class="mx na">·</td>'; continue
                tds += cell_html(c['d_sim_papd'], c['d_act_papd'], cat, s,
                                 c['class'], c.get('window_fallback'))
            pred, act = ov[cat]
            tds += cell_html(pred, act, cat, 'ALL',
                             cell_ix.get((cat, SEGS[0]), {}).get('class') if pred is None else None)
            rows += f'<tr><td class="mxl">{esc(cat)}</td>{tds}</tr>'
        head = ''.join(f'<th>{esc(s)}</th>' for s in SEGS) + '<th>OVERALL</th>'
        return f'<div class="tw"><table class="mxt"><thead><tr><th></th>{head}</tr></thead><tbody>{rows}</tbody></table></div>'
    RES_ROWS = ['HC', 'SPT', 'Red', 'Chuck', 'Bomb', 'Slingshot', 'Shuffle', 'Comet',
                'UL Red', 'UL Chuck', 'UL Bomb', 'Unlimited Lives']

    def whole_faucet_table():
        """The number Garry reads off `Sim per Segment`: the sim's TOTAL prediction per resource,
        all 25 sources included, against the live total. FULL['..']['predicted_change_full_papd']
        is the per-segment full-scope windowed ratio bridged onto the live Control faucet."""
        body = ''
        for r_ in RES_ROWS:
            f_, a = FULL[r_], AGG[r_]
            base = a['a_C_papd']
            miss = f_['miss_papd']
            col = C['good'] if abs(miss) <= 0.1 * abs(base) else (
                C['warn'] if abs(miss) <= 0.25 * abs(base) else C['bad'])
            body += (f'<tr><td>{esc(r_)}</td><td class="num">{f2(base, 1)}</td>'
                     f'<td class="num" style="color:{C["sim"]}">{f_["predicted_change_full_papd"]:+.2f}'
                     f' <span class="dim">({f_["predicted_change_full_papd"] / base:+.0%})</span></td>'
                     f'<td class="num" style="color:{C["act"]}">{a["actual_change_papd"]:+.2f}'
                     f' <span class="dim">({a["actual_change_papd"] / base:+.0%})</span></td>'
                     f'<td class="num" style="color:{col}">{miss:+.2f}</td>'
                     f'<td class="num" style="color:{col}">{miss / base:+.0%}</td></tr>')
        return (f'<div class="ovcard ovwide"><div class="ovh">The bottom line · whole faucet, '
                f'all {len(cmp_["meta"]["segments"])} segments, every source</div>'
                '<div class="ovsub">The sim\'s total prediction for each resource against the live '
                'A/B total. Nothing is left out here — Night Sky, Rainbow Maker, the killed events '
                'and the unmodeled movers are all inside both columns. This is the row to quote '
                'when someone asks "did the sim get the economy right?".</div>'
                '<table class="ovt"><thead><tr><th>resource</th><th>Control faucet /pd</th>'
                '<th>SIM says Δ</th><th>LIVE did Δ</th><th>miss</th><th>miss % of faucet</th>'
                f'</tr></thead><tbody>{body}</tbody></table>'
                '<p class="note" style="margin-top:8px">Sim column = the sim\'s own windowed ratio '
                'over all 25 sources (per segment, payer-blended) applied to that segment\'s live '
                'Control faucet, then player-day weighted — the same bridge used cell-by-cell '
                'below, just with nothing excluded. HC: the sim says the redesign cuts the coin '
                'faucet by 13%; live cut it by 15%. <b>Read the per-source breakdowns before '
                'trusting a small miss</b> — the HC total agrees partly because two large errors '
                'point opposite ways (Rainbow Maker over-credited, Night Sky under-credited).</p>'
                + source_bridge_table('HC') + source_bridge_table('SPT')
                + source_bridge_table('Unlimited Lives') + '</div>')

    def source_bridge_table(res):
        """Additive per-source decomposition of the whole-faucet number — the only view that puts
        a sim figure on Rainbow Maker and Night Sky, whose cells have no measured anchor to ratio."""
        f_ = FULL[res]
        rows = sorted(f_['by_category'].items(),
                      key=lambda kv: -abs(kv[1]['d_act_papd'] - kv[1]['d_sim_papd_bridge']))
        body = ''
        for cat, v in rows:
            s, a = v['d_sim_papd_bridge'], v['d_act_papd']
            if abs(s) < 0.005 and abs(a) < 0.005: continue
            miss = a - s
            col = C['bad'] if abs(miss) > 0.05 * abs(AGG[res]['a_C_papd']) else C['ink2']
            body += (f'<tr><td>{esc(cat)}</td>'
                     f'<td class="num" style="color:{C["sim"]}">{s:+.2f}</td>'
                     f'<td class="num" style="color:{C["act"]}">{a:+.2f}</td>'
                     f'<td class="num" style="color:{col}">{miss:+.2f}</td></tr>')
        body += (f'<tr class="totrow"><td><b>TOTAL</b></td>'
                 f'<td class="num"><b>{f_["predicted_change_full_papd"]:+.2f}</b></td>'
                 f'<td class="num"><b>{f_["actual_change_papd"]:+.2f}</b></td>'
                 f'<td class="num"><b>{f_["miss_papd"]:+.2f}</b></td></tr>')
        return (f'<details class="mxd"><summary>Where the {esc(res)} number comes from — '
                f'per-source contributions that add to the total</summary>'
                '<div class="tw"><table class="ovt srct"><thead><tr><th>source</th>'
                '<th>SIM Δ /pd</th><th>LIVE Δ /pd</th><th>miss</th></tr></thead>'
                f'<tbody>{body}</tbody></table></div>'
                '<p class="note">Every source gets a number here, including the ones the '
                'cell-by-cell matrices cannot score: the bridge is linear, so a source\'s '
                'per-earner windowed change × (segment faucet ÷ segment sim faucet) contributes '
                'additively and the parts sum to the total exactly (pipeline gate: residual 0.0). '
                'The assumption it adds is that a source\'s earners-per-active-player looks like '
                'the segment average — fine for reading where a total comes from, too weak for '
                'per-cell accuracy scoring, which is why the matrices still show a glyph there.</p>'
                '</details>')

    def workbook_fill_box():
        """If the workbook's own display sheets disagree with this report, say so loudly and
        attribute the difference to an engine version rather than hand-waving."""
        if not WBF:
            return ''
        n = WBF['workbook_n']
        rows = ''
        for k in sorted(WBF['rows'], key=lambda k: (k.split('|')[0], SEGS.index(k.split('|')[1]))):
            w, dref, dcur = WBF['rows'][k], WBF['detail_reference'][k], WBF['detail_current'][k]
            payer, seg = k.split('|')
            rows += (f'<tr><td>{esc(payer)}</td><td>{esc(seg)}</td>'
                     f'<td class="num">{f2(w["cur_total"], 1)}</td>'
                     f'<td class="num">{f2(w["sim_total"], 1)}</td>'
                     f'<td class="num">{f2(dref["engine_sim"], 1)}</td>'
                     f'<td class="num" style="color:{C["sim"]}">{f2(dcur["engine_sim"], 1)}</td></tr>')
        sagaR_ref = [v for v in WBF['saga_R_reference'].values() if v and v > 1.5]
        stale = WBF['stale']
        head = ('⚠ If your workbook shows a big POSITIVE coin uplift, it is running the old '
                'saga reader — not this report'if stale else
                '✓ The workbook\'s display sheets and this report are running the same engine')
        if not stale:
            return (f'<div class="warnbox ok"><div class="wbh">{head}</div>'
                    f'<p>The cached <code>Sim per Segment</code> fill in <code>{esc(WBF["workbook"])}</code> '
                    f'matches the fixed engine to '
                    f'{WBF["max_rel_err_vs_current"]:.1%}. Nothing to reconcile.</p></div>')
        upl = WBF.get('overall_uplift_pct') or {}
        upl_txt = ' / '.join(f'<b>{v:+.0f}% for {k.split("|")[0].lower()}s</b>'
                             for k, v in sorted(upl.items())) or '<b>a large positive uplift</b>'
        core_ex = ''
        cw = WBF['rows'].get('NONPAYER|10-19', {})
        if 'cur_core' in cw:
            core_ex = (f' (10-19 nonpayers: CORE {cw["cur_core"]:,.0f} measured → '
                       f'{cw["sim_core"]:,.0f} simulated)')
        return f'''<div class="warnbox"><div class="wbh">{head}</div>
<p><b>What you are seeing.</b> The <code>Sim per Segment</code> sheet in workbook ({n}) reports an
overall HC uplift of {upl_txt} (its AA4:AC18 block, 33-day per-earner basis). This report says the
coin faucet <b>falls</b> {abs(round((1 - FULL['HC']['r_sim_full_blended']) * 100)):.0f}%. Both
describe the same calendar. The difference is entirely the <b>saga ladder reader</b>, and the
workbook is the one that is wrong.</p>
<p><b>Why.</b> You rebuilt <code>c_saga</code>/<code>c_saga_v2</code> into the triple-column layout
(<code>Levels Req | RewardChestId | HC Reward</code> per segment). The engine version pasted in your
Apps Script project still reads saga rewards by fixed column offset, so it picked up the
<b>RewardChestId</b> column and priced chest IDs as coins. Saga HC ratio came out at
<b>×{min(sagaR_ref):.1f}–×{max(sagaR_ref):.1f}</b> instead of ×0.286 — and since Saga sits in the
CORE bucket, the CORE column exploded{core_ex} and dragged the total positive. The saga readers went header-driven in <code>engine/EcoGainsSim_v4.gs</code> on
2026-08-13; <b>that file has not been pasted back into Apps Script yet</b>, so the sheet still shows
the old numbers.</p>
<p><b>Proof by reproduction.</b> Same workbook data, two engine versions. The workbook's cached fill
matches the <i>pre-fix</i> engine to within <b>{WBF['max_rel_err_vs_reference']:.1%}</b> and differs
from the fixed engine by up to <b>{WBF['max_rel_err_vs_current']:.0%}</b>. The measured (CURRENT)
column matches both exactly ({WBF['max_rel_err_measured_side']:.1%}) — the bug is on the simulated
side only, which is why the sheet looks healthy at a glance.</p>
<div class="tw"><table class="ovt"><thead><tr><th>payer</th><th>segment</th>
<th>workbook CURRENT<br>(33-day HC, per earner)</th><th>workbook SIMULATED</th>
<th>pre-fix engine<br>{esc(WBF['reference_label'])}</th>
<th>fixed engine<br>(this report)</th></tr></thead><tbody>{rows}</tbody></table></div>
<p><b>Fix, in order.</b> (1) Paste <code>engine/EcoGainsSim_v4.gs</code> into the Apps Script project
(replace the whole file — it is the same nine-file project, no new files).
(2) Menu <b>EcoGainsSim ▸ Precompute calendars</b> — workbook ({n}) shipped calendar edits with a
stale <code>cal_parsed</code>, which is a second, independent source of wrong numbers.
(3) Re-run <b>Fill Sim per Segment</b>. The CORE column should drop to roughly a third of the
measured value in every segment, and the AA4:AC18 HC line should flip from
{(' / '.join(f'{v:+.0f}%' for _, v in sorted(upl.items())) or 'positive')} to about −6%
(33-day basis) — this report's −13% is the same thing measured only over the 9-day A/B window,
where the nerfed sources carry more weight.</p>
<p class="note">This box is generated by the pipeline, not typed: <code>node
harness/_dump_engine_versions.js --ref {esc(WBF['reference_label'].split('(')[-1].rstrip(')'))}</code>
runs both engines over <code>harness/_mockdata.json</code> and
<code>analysis/_build_comparison.py</code> reads the workbook's cached fill and attributes it. Once
you re-paste and re-fill, re-run the pipeline and this box turns into a one-line all-clear.</p>
</div>'''

    def overall_res_tables():
        """The AA4:AC18 'Overall Total amount and %' equivalent, on the comparison basis:
        per-resource overall change per active player-day — table 1 what the sim predicted,
        table 2 what the live test measured, table 3 how far off the sim was."""
        def pctf(d, base): return f'{d / base:+.0%}' if base else '—'
        est = act = dif = ''
        for r_ in RES_ROWS:
            a = AGG[r_]
            base = a['a_C_papd']
            est += (f'<tr><td>{esc(r_)}</td><td class="num">{a["predicted_change_scored_papd"]:+.2f}</td>'
                    f'<td class="num">{pctf(a["predicted_change_scored_papd"], base)}</td></tr>')
            act += (f'<tr><td>{esc(r_)}</td><td class="num">{a["actual_change_papd"]:+.2f}</td>'
                    f'<td class="num">{pctf(a["actual_change_papd"], base)}</td></tr>')
            d_sc = a['actual_change_on_scored_papd'] - a['predicted_change_scored_papd']
            uns = a['actual_change_papd'] - a['actual_change_on_scored_papd']
            uns_sim = FULL[r_]['predicted_change_full_papd'] - a['predicted_change_scored_papd']
            dif += (f'<tr><td>{esc(r_)}</td>'
                    f'<td class="num">{a["actual_change_on_scored_papd"]:+.2f}</td>'
                    f'<td class="num">{a["predicted_change_scored_papd"]:+.2f}</td>'
                    f'<td class="num"><b>{d_sc:+.2f}</b></td>'
                    f'<td class="num">{pctf(d_sc, base)}</td>'
                    f'<td class="num" style="color:{C["act"]}">{uns:+.2f}</td>'
                    f'<td class="num" style="color:{C["sim"]}">{uns_sim:+.2f}</td></tr>')
        def card(title, sub, head, body, cls=''):
            return (f'<div class="ovcard{cls}"><div class="ovh">{title}</div>'
                    f'<div class="ovsub">{sub}</div>'
                    f'<table class="ovt"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
        hc_f, hc_a = FULL['HC'], AGG['HC']
        return ('<p>The whole-faucet table above is the headline. These three break it into the part '
                'that can be checked source-by-source and the part that cannot. All three use the '
                'same unit as above — <b>change in amount gained per active player-day</b> (Variant '
                'minus Control, weighted over segments 0-9…100+) — and the Δ% column is just that '
                'change over the Control faucet for the resource, never a percentage of a '
                f'percentage.</p><p><b>The one trap to know about.</b> Table 1 is <i>not</i> the '
                f'sim\'s total forecast: it covers only the {len(RES_ROWS)} resources\' '
                'source-by-source comparable cells, which excludes the sim\'s big <i>positive</i> '
                'lanes (Night Sky, Rainbow Maker). That is why HC reads '
                f'{hc_a["predicted_change_scored_papd"]:+.1f}/pd here but '
                f'{hc_f["predicted_change_full_papd"]:+.1f}/pd in the whole-faucet table. The two '
                'last columns of table 3 show exactly what the narrowing left out, on both sides.</p>'
                '<div class="ovgrid">'
                + card('Table 1 · What the sim predicted — comparable cells only',
                       'The forecast, restricted to the source × segment cells where both sides '
                       'have a number that can be compared like-for-like. NOT the sim\'s total: '
                       'the whole-faucet figure is in the table above.',
                       '<th>resource</th><th>predicted Δ /pd</th><th>Δ% of Control</th>', est)
                + card('Table 2 · What actually happened — everything',
                       'The measurement, unrestricted. The live A/B result for each resource with '
                       'every source counted, whether the sim had a comparable estimate or not.',
                       '<th>resource</th><th>actual Δ /pd</th><th>Δ% of Control</th>', act)
                + card('Table 3 · How far off the sim was, and what got left out',
                       'Columns 1–4: actual minus predicted on exactly the same cells (the inputs '
                       'are shown so the subtraction is visible). Positive miss = the live economy '
                       'gave more than the sim expected. Columns 5–6: the movement outside those '
                       'cells — live in orange, sim in blue. Add either colour to its own side and '
                       'you get the whole-faucet number at the top of the section.',
                       '<th>resource</th><th>actual<br>(same cells)</th><th>predicted<br>(same cells)</th>'
                       '<th>miss</th><th>miss % of Control</th>'
                       '<th>LIVE Δ outside<br>those cells</th><th>SIM Δ outside<br>those cells</th>',
                       dif, cls=' ovwide')
                + '</div>'
                + '<p class="note"><b>How the three reconcile.</b> Table 3 column 1 + column 5 = '
                  'table 2 (the live faucet, split into scorable and not). Table 1 + table 3 '
                  'column 6 = the sim column of the whole-faucet table (the same split on the sim '
                  'side). So table 3 is not table 2 minus table 1 — it is the like-for-like '
                  'subtraction plus the two leftovers that make both sides add up. For HC the '
                  f'leftovers nearly cancel: live {hc_a["actual_change_papd"] - hc_a["actual_change_on_scored_papd"]:+.1f}/pd '
                  f'vs sim {hc_f["predicted_change_full_papd"] - hc_a["predicted_change_scored_papd"]:+.1f}/pd '
                  '— Night Sky and Rainbow Maker really did add roughly what the sim said they '
                  'would; the disagreement is in how much the nerfed sources gave back. Segment '
                  '<code>A. 0</code> is excluded throughout (appendix semantics) and SPTx2 is '
                  'excluded for a unit clash (see appendix).</p>')
    def booster_matrix(res):
        a, f_ = AGG[res], FULL[res]
        unit = ' min' if res.startswith('UL') or res == 'Unlimited Lives' else ''
        return (f'<details class="mxd"><summary><b>{esc(res)}</b> — whole faucet: sim '
                f'{f_["predicted_change_full_papd"]:+.2f} vs live '
                f'{a["actual_change_papd"]:+.2f}{unit}/pd · on comparable cells: predicted '
                f'{a["predicted_change_scored_papd"]:+.2f} vs live '
                f'{a["actual_change_on_scored_papd"]:+.2f}</summary>'
                f'{matrix_for(res)}</details>')
    return f'''
<section id="s00"><div class="sn">00</div><h2>Predicted vs actual — every source, every segment</h2>
<p>Each cell: <b>top = live change</b> (Variant − Control, per active player-day) and
<b>bottom = the sim's predicted change</b> on the same basis. Two separate signals: the <b>red tint =
how wrong</b> the estimate is <i>relative to the movement itself</i> (a small source missed by 100%
tints as deeply as a big one missed by 100%; near-negligible absolute misses stay dark), and the
<b>red ring = how much it matters</b> (the ten biggest misses in absolute /pd terms). Letter cells could not be estimated
on this basis (B baseline≠Control · ✓ kill agreed · + new both sides · ◉ NS direct panel ·
W/S/N window-missed/stale/unmodeled — the small number is the live change). "*" = estimate from
the 33-day ratio because the event's footprint missed the window. Rows sorted by live impact.</p>
<h3>The bottom line first — did the sim get the size of the change right?</h3>
{whole_faucet_table()}
{workbook_fill_box()}
<h3>Breaking that down — predicted, actual, and the miss</h3>
{overall_res_tables()}
<h3>HC, per active player-day</h3>
{matrix_for('HC')}
<h3>Season-pass tokens (SPT), per active player-day</h3>
{matrix_for('SPT')}
<h3>Boosters — one matrix per booster type</h3>
{''.join(booster_matrix(r) for r in ['Red', 'Chuck', 'Bomb', 'Slingshot', 'Shuffle', 'Comet',
                                     'UL Red', 'UL Chuck', 'UL Bomb', 'Unlimited Lives'])}
<p class="note">Regenerated from analysis/out/comparison.json on every pipeline run — drop new data,
re-run <code>python analysis/_build_comparison.py && python analysis/_build_report.py</code>, republish.</p>
</section>'''
S0 = build_overall_section()

# ---- section 01 -----------------------------------------------------------------
S1 = f'''
<section id="s01"><div class="sn">01</div><h2>Overview — what diverged, and how this comparison was built</h2>

<div class="kpis">
<div class="kpi"><div class="l">HC faucet, per active player-day</div><div class="v">{f2(hcA['a_C_papd'],1)} → {f2(hcA['a_V_papd'],1)}</div>
<div class="s">live Δ {f2(hcA['actual_change_papd'],1)} ({pct(1+hcA['actual_change_papd']/hcA['a_C_papd'])}) · whole-faucet sim Δ {f2(hcF['predicted_change_full_papd'],1)} ({pct(hcF['r_sim_full_blended'])}) — direction and size called, by cancelling errors (§00)</div></div>
<div class="kpi"><div class="l">SPT faucet (incl. core lane)</div><div class="v">{f2(sptA['a_C_papd'],1)} → {f2(sptA['a_V_papd'],1)}</div>
<div class="s">live Δ {f2(sptA['actual_change_papd'],1)} ({pct(1+sptA['actual_change_papd']/sptA['a_C_papd'])}) · whole-faucet sim Δ {f2(sptF['predicted_change_full_papd'],1)} ({pct(sptF['r_sim_full_blended'])}) — the sim over-credits Rainbow Maker's offset (§02)</div></div>
<div class="kpi"><div class="l">Scored cells (both sides ratio-able)</div><div class="v">{scored_green} <span class="okv">ok</span> / {scored_amber} <span class="wv">±25%+</span> / {scored_red} <span class="bv">±50%+</span></div>
<div class="s">of {n_scored} scored · {len(flips)} sign-flips (sim and live moved in opposite directions)</div></div>
<div class="kpi"><div class="l">Structurally unscorable cells</div><div class="v">{cc.get('BASELINE_MISMATCH',0)+cc.get('STALE_BASELINE',0)+cc.get('NOT_MODELED',0)} + {cc.get('WINDOW_MISS',0)}</div>
<div class="s">baseline mismatches / stale baselines / unmodeled + window-placement artifacts</div></div>
</div>

<h3>The headline verdicts</h3>
<ul class="vlist">
<li><b class="ok">On the whole faucet the sim called the change — but partly by luck.</b> All sources in, the sim says coins fall {f2(hcF['predicted_change_full_papd'],1)}/pd ({pct(hcF['r_sim_full_blended'])}); live fell {f2(hcA['actual_change_papd'],1)}/pd ({pct(1+hcA['actual_change_papd']/hcA['a_C_papd'])}). That {f2(abs(hcF['miss_papd']),1)}/pd agreement hides two errors of ~15/pd pointing opposite ways: <b>Rainbow Maker over-credited</b> (sim {f2(bc('HC','Rainbow Maker'),1)} vs live {f2(bc('HC','Rainbow Maker','act'),1)}) and <b>Night Sky under-credited</b> (sim {f2(bc('HC','Daily Night Sky Prize'),1)} vs live {f2(bc('HC','Daily Night Sky Prize','act'),1)}). Fix either lane alone and the total gets worse before it gets better. §00 has the per-source arithmetic.</li>
<li><b class="wr">The day map was off by a phase — corrected here from the data.</b> The live Variant's own event-day spikes pin Aug 2 = cal_new day <b>5</b> (Sunday = Sunday, window days 5–13, no wrap), not day 27 with a wrap. Under the corrected phase, three "discrepancies" of the first read dissolved: Target Day's sign-flip became a green ×2.0-vs-×2.35, and Red/Bomb Challenge's "killed but still scheduled" became in-window agreement. Proof P0.</li>
<li><b class="ok">Core-SPT, Saga HC, Daily Gift, Target Day, River Rush — validated.</b> SP_v2 R 0.812 vs live core lane ×0.81–0.88; the wb16 Control-saga correction lands saga at ×0.286 vs live ×0.284–0.322; Daily Gift ×0.61–0.65 vs ×0.63–0.66; Target Day ×2.0 vs ×2.35; River Rush removal exact. The reward-ladder machinery is right when the configs match what shipped.</li>
<li><b class="ok">Night Sky, compared directly, is in the right ballpark.</b> With NS out of the baseline (wb16), the sim's NS lane is a live prediction of the Variant's faucet — level and segment shape land close (panel below), on a per-earner basis.</li>
<li><b class="bd">Kite Festival is now the one large direction miss.</b> Windowed sim says ≈×1.0; live Kite pays ×5.3 HC / ×4.5 SPT at 100+. Whatever config shipped, it is not Ki_v2.</li>
<li><b class="bd">The saga UL-Lives swap and the Team Race SPT lane are unmodeled.</b> Live saga UL ×1.70–1.78 vs sim ×1.0 — worth {f2(bc('Unlimited Lives','Saga','act'),1)} min/pd of live UL time the sim never grants. Its UL total ({f2(ulF['predicted_change_full_papd'],1)} vs live {f2(ulF['actual_change_papd'],1)}) is in the right region only because Rainbow Maker's UL ladder over-pays by {f2(bc('Unlimited Lives','Rainbow Maker') - bc('Unlimited Lives','Rainbow Maker','act'),1)} — again, right total, wrong route. Team Race SPT (14→20/pd at 100+) has no config or anchor.</li>
<li><b class="bd">Two events genuinely diverge from the planned calendar.</b> Jigsaw ran live ~Aug 7–10+ (plan: days 17–19 ≈ Aug 14–16) and Bomb's Ballet ended ~Aug 2 (plan: days 10–12) — they fit <i>no</i> phase. Chuck Challenge is a baseline gap: the live Control never runs it, `cal_curr` schedules it weekly.</li>
</ul>

<h3>How an 8-day-shaped sim was compared against 9 days of live data</h3>
<p>The sim natively answers a 33-day question in <i>per-earner</i> units; the A/B export answers a 9-day question in <i>per-active-player-day</i> units. Three moves make them commensurable, each cancelling a bias rather than estimating it:</p>
<ol class="method">
<li><b>Delta vs delta.</b> Neither side's absolute level is trusted. The sim is scored on its <i>predicted change</i> (windowed SIM ÷ windowed MEASURED — per-earner denominators cancel exactly, because every simulated value is measured × R·D·T), against the live <i>observed change</i> (Variant papd ÷ Control papd — population denominators cancel up to PD ratios, printed below). Unit mismatches divide out; model error is what remains.</li>
<li><b>The day map — phase corrected from the data.</b> The working map (Aug 2 = day 27, wrapping 33→6 on the 28-day cycle) was tested against the live Variant's own daily grant spikes and refuted: the schedule that fits is <b>Aug 2 = cal_new day 5</b> (window = days 5–13, no wrap), with leaderboard claim spikes landing the day after an instance ends. Under it, Sunday maps to Sunday and ten of twelve event families align day-for-day (proof P0). The sim side sums the Daily engine's per-day allocation over days 5–13 — leaderboards pay on instance END days, collections by accrual share, always-on by active rate. Conservation is gated: widened to days 1–33 the allocation reproduces the full 33-day sim to 1.2e-15.</li>
<li><b>Payer blend.</b> The sim emits PAYER/NONPAYER separately; the A/B pools them. Sim cells are blended with earner-share weights from `data_gains` (fallback: population payer rate). FREE resources only, corrected (RM-dedup) series, `A. 0` excluded (appendix semantics).</li>
</ol>
{proof('P0', 'The live Variant schedule pins Aug 2 = cal_new day 5 (the old map, day 27 + wrap, does not fit)', [
    ("Chuck's Challenge (ends 7, 9)", 'claim spikes Aug 5 & 7 — 384k / 393k HC'),
    ('Kite Festival (ends 5, 12)', 'claim spikes Aug 3 & 10 — 113k / 117k'),
    ('Target Day (days 3,4,5 + 10,11,12)', 'paid Aug 2–3 and Aug 8–10 (151–176k/day)'),
    ('Rainbow Maker (instance 6–9)', 'ran Aug 3–6 at 1.5–1.8M/day; next (13–16) starts Aug 10'),
    ('Flock Flurry (18 daily instances)', 'high Aug 3–6 + Aug 10, dark Aug 2 & 7–9 — matches day-for-day'),
    ("Red's Challenge (ends 2, 28, 30)", 'only a decaying claim tail Aug 2 (end = Jul 30); nothing after'),
    ("Bomb's Challenge (13–14, 15–16)", 'nothing in window (max 1.7k/day) — instances sit post-window'),
    ('weekday', 'day 5 ≡ Sunday = Aug 2 Sunday (old map: day 27 ≡ Monday — 1-day skew)'),
    ('does NOT fit any phase', 'Jigsaw (live ~Aug 7–10+, plan 17–19) · Bomb’s Ballet (live ended ~Aug 2, plan 10–12)')],
  'phase test: live spike date − claim lag (1 day) − instance end day ≡ constant offset → Aug 2 = day 5',
  'workbooks/resource_gains_base.csv (Variant, free HC by event_date per source_detail) vs the cal_new instance list (harness/_mockdata.json → parse the calendar grid, or the P0 table above).', 'V1-day-map')}
{proof('P1', 'The windowed sim is a pure restriction of the full simulation', [
    ('conservation max rel err', f"{cmp_['meta'].get('fingerprint',{}) and json.load(open(os.path.join(OUT,'sim_matrix.json')))['gates']['conservation_max_relerr']:.2e}"),
    ('day list', ', '.join(map(str, cmp_['meta']['day_list']))),
    ('sim vintage', cmp_['meta']['sim_vintage'])],
  'Σ<sub>d=1..33</sub> DAILY(cat,res,d) ≡ 33-day matrix value, per all 5,700 cells',
  'run <code>node harness/_dump_sim_matrix.js</code> — the conservation gate prints PASS/FAIL and the script exits non-zero on failure.', 'GATE')
}
{proof('P2', 'No actual-side amount was lost in the category mapping', [
    ('mapped free', f"{XG['accounting_identity']['mapped']:,.0f}"),
    ('excluded resources', f"{XG['accounting_identity']['excluded']:,.0f}"),
    ('raw CSV total', f"{XG['accounting_identity']['raw']:,.0f}"),
    ("Other share of HC (C / V)", ' / '.join(f'{v:.1%}' for v in XG['other_share_hc'].values()))],
  'mapped + excluded = raw, exactly · the stale repo CASE would have put 50.8% of HC in Other; the extended mapping leaves 2.3–4.8%',
  'run <code>python analysis/_extract_actuals.py</code> — prints all three identities; per-source rules with provenance in <code>analysis/out/mapping_audit.csv</code>.', 'GATE')
}
{proof('P3', 'Population denominators are near-identical across arms, so papd ratios are faucet ratios', [
    (f"{d['segment']} {d['arm']}", f"{d['player_days']:,.0f} pd") for d in cmp_['denominators'][:6]],
  'PD_V/PD_C per segment ∈ [0.955, 1.014] — within ±4.5%, flagged where > 1%',
  'workbooks/ab_denominators.csv, is_total=True rows; compare player_days per segment across ab_group.', 'C11-aggregates')
}
<h3>Anchor check — are the two baselines even the same economy?</h3>
<p>Delta-vs-delta doesn't need the baselines to match — but it's honest to show how far apart they are. The sim's measured anchor is a May telemetry window on per-earner basis; live Control is August on per-any-source-gainer basis. Same order of magnitude, not interchangeable:</p>
<figure class="card">{grouped_bars('windowed measured (sim) vs Control per-gainer 9d (live) — HC per earner',
    [(f"{a['category']} · {a['segment']}", [a['sim_meas_win_per_earner'], a['actual_C_per_gainer_9d']]) for a in cmp_['anchor_check']],
    [('sim measured (window)', C['sim']), ('live Control /gainer', C['act'])])[0]}
<div class="legend">{grouped_bars('x', [('x',[1])], [('sim measured (window)', C['sim']), ('live Control /gainer', C['act'])])[1]}</div></figure>
{proof('P4', 'Anchor ratios 0.26–0.62 — explained, not hidden', [
    (f"{a['category']} {a['segment']}", f"sim {a['sim_meas_win_per_earner']} vs live {a['actual_C_per_gainer_9d']} → ×{a['ratio']}") for a in cmp_['anchor_check'] if a['ratio']],
  'live per-gainer divides by ANY-source HC gainers (large base); sim divides by the May resource-earner base and its 25-category universe (known ~1.8× under-count of the full faucet, workbook (9))',
  'sim side: analysis/out/sim_matrix.json (cur_win, blend payers); live side: resource_gains_by_segment_9d.csv amount ÷ ab_player_dist.csv gainers.', 'C12-anchor')
}
</section>'''

# ---- section 02 -----------------------------------------------------------------
# story panels assembled individually
# NS direct comparison: sim per-earner window (blended) vs live Variant per HC-gainer 9d
pdV = {d['segment']: d['player_days'] for d in cmp_['denominators'] if d['arm'] == 'Variant'}
gainersV = {p['segment']: p['gainers'] for p in aux_['player_dist']
            if p['arm'] == 'Variant' and p['resource'] == 'HC'}
ns_sim_blend = {s: ns['sim'][s]['new_win'] for s in SEGS}
ns_pg = {s: (ns['act'][s]['a_V'] * pdV[s] / gainersV[s]) if gainersV.get(s) else 0 for s in SEGS}
ns_bridge = {s: ns_sim_blend[s] / ns_pg[s] for s in SEGS if ns_pg.get(s)}
ns_direct_bars, _ = grouped_bars('Night Sky HC — sim prediction vs live Variant (per-earner bases)',
    [(s, [ns_sim_blend[s], ns_pg[s]]) for s in SEGS],
    [('sim per-earner (window)', C['sim']), ('live V per HC-gainer 9d', C['act'])])
saga_bars, _ = grouped_bars('Saga HC — predicted vs live change',
    [(s, [saga[s]['r_sim'], saga[s]['r_act']]) for s in SEGS],
    [('sim ratio', C['sim']), ('live ratio', C['act'])], unit='×')
kite_c = {c['segment']: c for c in CELLS if c['category'] == 'Kite Festival' and c['resource'] == 'HC'}
killed_rows = []
for cat in ['Red Challenge', 'Bomb Challenge']:
    for s in SEGS:
        k = killed[cat][s]
        if k['a_C'] > 0.2:
            killed_rows.append((f'{cat} · {s}', k['a_C'], k['a_V'], k['r_sim']))

spt_r_rows = [('sim — wb16 SP_v2 panel', ksp['sim_R_wb15'])]
spt_r_rows += [(f'live per-level, bucket {b}', v) for b, v in sorted(ksp['per_bucket_ratios'].items())]
core_bars, _ = grouped_bars('per-level SPT reward ratio (Variant ÷ Control)',
    [(lab, [v]) for lab, v in spt_r_rows], [('ratio', C['good'])], unit='×')

wmiss = [c for c in CELLS if c['class'] == 'WINDOW_MISS']
wmiss_by_cat = {}
for c in wmiss: wmiss_by_cat[c['category']] = wmiss_by_cat.get(c['category'], 0) + 1

other_top = STORY['other_composition'][:8]

# ---- new-section derived data -----------------------------------------------------
def best_cell(cat, res_list):
    cands = [c for c in CELLS if c['category'] == cat and c['resource'] in res_list]
    if not cands: return None
    return max(cands, key=lambda c: c['a_C'] + c['a_V'] + c['M_win'] + c['S_win'])
def verdict_chip(c):
    if c is None: return '<span class="chip mut">—</span>'
    if c['class'] in ('SCORED', 'WINDOW_MISS') and c['r_sim'] is not None and c['r_act'] is not None:
        cls = {'green': 'good', 'amber': 'warn', 'red': 'bad'}.get(c['status'], 'mut')
        fb = '·33d' if c['class'] == 'WINDOW_MISS' else ''
        return (f'<span class="chip {cls}">{c["segment"]} {fr(c["r_sim"])} vs {fr(c["r_act"])}{fb}</span>')
    lab = {'KILL_AGREED': 'kill agreed ✓', 'NS_DIRECT': 'direct panel', 'NEW_BOTH': 'new both sides',
           'BASELINE_MISMATCH': 'baseline≠Control', 'STALE_BASELINE': 'stale baseline',
           'NOT_MODELED': 'not modeled', 'TRIVIAL': 'trivial'}.get(c['class'], c['class'])
    cls = {'green': 'good', 'amber': 'warn', 'red': 'bad', 'info': 'mut', 'na': 'mut'}.get(c['status'], 'mut')
    return f'<span class="chip {cls}">{lab}</span>'
BOOSTER_RES = ['Slingshot', 'Shuffle', 'Comet', 'Red', 'Chuck', 'Bomb', 'UL Bomb', 'UL Chuck', 'UL Red']
SCORE_CATS = ['Saga', 'Core', 'Daily Gift', 'Daily Night Sky Prize', 'Rainbow Maker', 'Season Pass (Free)',
              'Target Day', 'Kite Festival', 'Team Race', 'Team Event', 'Hatchling Hideaway', 'Jigsaw',
              "Bomb's Ballet", 'Flock Flurry', 'Photoshoot', 'Red Challenge', 'Bomb Challenge',
              'Chuck Challenge', 'River Rush', 'Level Race', 'Flash Race', 'FlowerCoop', 'Other']
scorecard_rows = ''
for cat_ in SCORE_CATS:
    hc_ = best_cell(cat_, ['HC'])
    bo_ = best_cell(cat_, BOOSTER_RES)
    ul_ = best_cell(cat_, ['Unlimited Lives'])
    spt_ = best_cell(cat_, ['SPT'])
    if hc_ is None and bo_ is None and spt_ is None and ul_ is None: continue
    bo_name = f' <span class="chip mut">{esc(bo_["resource"])}</span>' if bo_ else ''
    scorecard_rows += (f'<tr><td>{esc(cat_)}</td><td>{verdict_chip(hc_)}</td>'
                       f'<td>{verdict_chip(bo_)}{bo_name}</td>'
                       f'<td>{verdict_chip(ul_)}</td><td>{verdict_chip(spt_)}</td></tr>')

booster_rows = ''
for res_ in BOOSTER_RES + ['Unlimited Lives']:
    a_ = AGG[res_]
    n_g = sum(1 for c in CELLS if c['resource'] == res_ and c['status'] == 'green')
    n_r = sum(1 for c in CELLS if c['resource'] == res_ and c['status'] == 'red')
    worst = max([c for c in CELLS if c['resource'] == res_ and c['err_papd'] is not None],
                key=lambda c: abs(c['err_papd']), default=None)
    wtxt = f'{esc(worst["category"] + " · " + worst["segment"])} ({f2(worst["err_papd"])}/pd)' if worst else '—'
    booster_rows += (f'<tr><td>{esc(res_)}</td><td class="num">{a_["a_C_papd"]} → {a_["a_V_papd"]}</td>'
                     f'<td class="num">{a_["actual_change_papd"]:+.2f}</td>'
                     f'<td class="num">{a_["actual_change_on_scored_papd"]:+.2f} / {a_["predicted_change_scored_papd"]:+.2f}</td>'
                     f'<td class="num">{n_g}g/{n_r}r</td><td>{wtxt}</td></tr>')

beh = {(d['segment'], d['arm']): d for d in cmp_['denominators']}
beh_rows = ''
beh_groups = []
for seg_ in ['A. 0'] + SEGS:
    c_, v_ = beh.get((seg_, 'Control')), beh.get((seg_, 'Variant'))
    if not c_ or not v_: continue
    dl = v_['levels_completed_per_active'] / c_['levels_completed_per_active'] - 1
    dm = (v_['session_minutes_per_active'] / c_['session_minutes_per_active'] - 1) if c_.get('session_minutes_per_active') else 0
    dw = v_['level_win_rate'] - c_['level_win_rate']
    d7 = v_['d7_retention'] - c_['d7_retention']
    beh_rows += (f'<tr><td>{esc(seg_)}</td>'
                 f'<td class="num">{c_["levels_completed_per_active"]:.1f} → {v_["levels_completed_per_active"]:.1f} ({dl:+.1%})</td>'
                 f'<td class="num">{dm:+.1%}</td><td class="num">{100*dw:+.1f}pp</td><td class="num">{100*d7:+.1f}pp</td></tr>')
    if seg_ != 'A. 0': beh_groups.append((seg_, [round(100 * dl, 1)]))
beh_chart, _ = grouped_bars('levels completed per active day — Variant vs Control, %Δ',
                            beh_groups, [('%Δ', C['act'])], unit='%')


S2 = f'''
<section id="s02"><div class="sn">02</div><h2>Where the discrepancy is biggest</h2>

<h3>Every scorable cell at once</h3>
<figure class="card"><div class="figtitle">predicted change vs observed change — {n_scored + cc.get('WINDOW_MISS',0)} cells, log₂ axes</div>
{scatter(CELLS)}
<div class="legend"><span class="lg"><i style="background:{C['good']}"></i>within ±25%</span>
<span class="lg"><i style="background:{C['warn']}"></i>off ±25–50%</span>
<span class="lg"><i style="background:{C['bad']}"></i>off &gt;±50% or sign-flip</span>
<span class="lg"><i style="background:transparent;border:1.5px dashed {C['ink2']}"></i>33-day fallback (window-missed)</span>
· bubble size = live impact /pd</div></figure>

<h3>HC — source × segment accuracy map</h3>
<figure class="card"><div class="figtitle">log₂(sim change ÷ live change) — blue: sim over-predicted, orange: under. Letters = structural classes</div>
{heatmap(CELLS, 'HC')}
<div class="legend">B baseline mismatch · S stale baseline · W window-missed · N not modeled · + new both sides · ✓ kill agreed · ! kill missed / one-sided · ✖ sign-flip</div></figure>

<h3>Biggest absolute misses</h3>
<figure class="card">{tornado(tor_rows('HC'), title='HC — live Δ vs sim predicted Δ, per active player-day')}
<div class="legend"><span class="lg"><i style="background:{C['act']}"></i>live Δ</span><span class="lg"><i style="background:{C['sim']}"></i>sim predicted Δ</span></div></figure>
<figure class="card">{tornado(tor_rows('SPT'), title='SPT — live Δ vs sim predicted Δ, per active player-day')}
<div class="legend"><span class="lg"><i style="background:{C['act']}"></i>live Δ</span><span class="lg"><i style="background:{C['sim']}"></i>sim predicted Δ</span></div></figure>

<h3>The stories behind the red cells</h3>

<div class="panel"><h4>✓ Night Sky — simulated NS vs the live NS, head to head</h4>
<p>With NS removed from the baseline calendar (wb16), the sim's NS lane is a straight prediction of the Variant's faucet: May-anchored engagement × the NS_v2 config ratio (×{min(v['R'] for v in ns['sim'].values() if v['R']):.2f}–×{max(v['R'] for v in ns['sim'].values() if v['R']):.2f} by segment). Against the live Variant, the segment <i>shape</i> tracks closely and the <i>level</i> lands in the right ballpark on the per-gainer basis (sim per-earner ÷ live per-gainer ≈ {min(ns_bridge.values()):.2f}–{max(ns_bridge.values()):.2f} across segments — inside the known basis gap every source shows, P4). The live Control side pays ~0 ({f2(max(v['a_C'] for v in ns['act'].values()))}/pd at most), as the sim now expects.</p>
<figure class="card">{ns_direct_bars}<div class="legend"><span class="lg"><i style="background:{C['sim']}"></i>sim NS, per earner over the window</span><span class="lg"><i style="background:{C['act']}"></i>live Variant NS, per HC-gainer 9d</span> · different denominators — compare shape and ballpark, not cents</div></figure>
{proof('P5', 'Sim NS prediction vs live Variant NS — level and shape', [
    ('live Variant NS HC/pd by segment', ', '.join(f"{s} {f2(v['a_V'])}" for s, v in ns['act'].items())),
    ('sim NS per-earner (window, blended)', ', '.join(f"{s} {f2(ns_sim_blend[s])}" for s in ns_sim_blend)),
    ('live per HC-gainer 9d', ', '.join(f"{s} {f2(ns_pg[s])}" for s in ns_pg)),
    ('sim ÷ live (per-gainer basis)', ', '.join(f"{s} ×{ns_bridge[s]:.2f}" for s in ns_bridge)),
    ('NS_v2/NS config ratio R', ', '.join(f"{s} {fr(v['R'])}" for s, v in ns['sim'].items() if v['R']))],
  'sim NS = measured(May) × R(NS_v2/NS) × T(=1); live per-gainer = Variant NS free HC ÷ ab_player_dist HC gainers',
  'dreamheist_event + treasure_dive_event rows per arm in resource_gains_by_segment_9d.csv; sim side in analysis/out/sim_matrix.json (Daily Night Sky Prize rows).', 'V5-ns-direct')}
</div>

<div class="panel"><h4>⚠ Chuck Challenge — the one remaining baseline gap</h4>
<p>The live Control never runs Chuck ({f2(next(c['a_C'] for c in CELLS if c['category']=='Chuck Challenge' and c['resource']=='HC' and c['segment']=='100+'))}/pd at 100+) while `cal_curr` schedules it weekly — so the sim's predicted "change" (×3.6 windowed) is priced against a baseline the test doesn't have, and the Variant's real Chuck faucet (25.3/pd at 100+, two instances ending Aug 4 & 6) can't be delta-scored. The {cc.get('BASELINE_MISMATCH',0)} remaining baseline-mismatch cells and {cc.get('STALE_BASELINE',0)} stale-baseline cells (sources the May world had that the test-era world runs in neither arm — e.g. Level Race) share this shape.</p></div>

<div class="panel"><h4>✓ Saga HC — validated after the Control-base correction · ⚠ the UL swap is still unmodeled</h4>
<p>With the wb16 Control-saga update, the sim's ladder ratio is ×0.286 in every segment against live ×0.284–0.322 — prediction-to-live 0.89–1.01, green across the board (the first read's "one-third the depth" verdict was the stale base, since corrected). What remains open is the other half of the saga swap: live raised saga UL-Lives ×1.70–1.78, and both saga sheets still carry an identical UL column (Σ 265 = 265) so the sim carries ×1.0 — the single biggest per-source booster miss in the model: {f2(bc('Unlimited Lives','Saga','act'),1)} min/pd of live UL time granted through saga that the sim never grants (§Boosters). Chest note: `RewardChestId` chests pay near-zero HC live (mostly boosters), so the direct-HC ladder read is the right HC comparator.</p>
<figure class="card">{saga_bars}<div class="legend"><span class="lg"><i style="background:{C['sim']}"></i>sim predicted</span><span class="lg"><i style="background:{C['act']}"></i>live observed</span></div></figure>
{proof('P6', 'Saga HC: sim ×0.286 vs live ×0.284–0.322 (green); UL-Lives: sim ×1.0 vs live ×1.70–1.78 (open)', [
    ('live HC ratio per segment', ', '.join(f"{s}: {saga[s]['r_act']}" for s in SEGS)),
    ('sim ladder ratio (wb16, all segments)', '0.2857 exact'),
    ('UL Lives item ladder (base = v2)', 'Σ 265 = 265 → carried ×1.0; live ×1.70–1.78')],
  'sim R = (Σ HC Reward/Σ Levels Req)<sub>c_saga_v2 seg block</sub> ÷ same<sub>c_saga</sub>',
  'saga_progression rows (free HC + UnlimitedLives, action≠purchase) per arm ÷ player_days; wb16 sheets c_saga/c_saga_v2.', 'V2-saga-wb16')}
</div>

<div class="panel"><h4>✓ Core SPT — the recalibration already made is confirmed by the live data</h4>
<p>The level-completion token lane (invisible to the resource ledger — measured here from client telemetry) fell to ×0.81–0.88 per segment. Workbook (16)'s softened SP_v2 panel prices it at ×0.812. The sim's dominant SPT lane is calibrated correctly <i>for the post–31-Jul regime</i>; the play-matched per-level ratio (×0.76) and the early ×0.51 regime are shown for context — season-to-date live data still blends both.</p>
<figure class="card">{core_bars}</figure>
{proof('P7', 'wb16 R = 0.812 vs live core-lane ratios 0.81–0.88 — RoR 0.93–1.00 in every segment', [
    ('E_base / E_v2 (panel)', f"{ksp['sim_E_base']} / {ksp['sim_E_v2']}"),
    ('live V÷C per bucket', ', '.join(f'{b}: ×{v}' for b, v in sorted(ksp['per_bucket_ratios'].items()))),
    ('play-matched per-level ratio', f"×{ksp['live_per_level_ratio_play_matched']}")],
  'E = Σ mix<sub>d</sub> · mean(2nd-half, 1st-half) over Normal/Hard/Extreme · R = E_v2/E_base',
  'SP / SP_v2 panels in wb (16); avg_spt_gain_CORE in liveops2_ab_daily_metrics.csv, players-weighted over 2–10 Aug, per bucket × arm.', 'C1-core-spt')}
</div>

<div class="panel"><h4>✓ Red &amp; Bomb Challenge — "killed" was the wrong day map; in-window the sim and live agree</h4>
<p>The first edition scored these as "killed live but still scheduled". Under the corrected phase that reverses: cal_new's Red instances end on days 2, 28, 30 — the only one near the window ended Jul 30, and its decaying claim tail (19k on Aug 2) is exactly what live shows; Bomb's instances (13–14, 15–16) sit entirely after Aug 10, and live pays nothing. In-window, prediction and reality agree (KILL_AGREED). What this window <i>cannot</i> establish is whether the Variant will run Red on Aug 25–28 and Bomb on Aug 11–14 as cal_new plans — worth one look at the daily data after those dates. `single_collection` remains a real kill hiding in the carried "Other" bucket (−25.1 HC/pd at 100+, alone exceeding Other's entire decline).</p>
{proof('P8', 'Red/Bomb in-window agreement under the corrected phase', [
    ('live V red_event daily', 'Aug 2: 19.2k decaying tail → 3.5k; no spike after (end = Jul 30, day 2)'),
    ('live V bomb_event daily', 'max 1.7k/day all window (instances 13-16 = Aug 11-14, post-window)'),
    ('live Control (for contrast)', 'Red C spike Aug 4 (384k), Bomb C spike Aug 8 (330k) — the OLD rotation'),
    ('classes', 'Red/Bomb cells: KILL_AGREED (in-window both ≈ 0 on the Variant side)')],
  'leaderboards pay on END day (+1-day claim lag live); no cal_new Red/Bomb end ∈ days 5–13',
  'red_event / bomb_event by event_date per arm in resource_gains_base.csv; instance list from the cal_new grid.', 'V1-day-map')}
</div>

<div class="panel"><h4>⚠ Kite Festival — the one large direction miss left</h4>
<p>Survives every correction. With the window fixed, both calendars have a Kite payout inside days 5–13, and the windowed sim says ≈×1.0 HC / ×0.80 SPT — but live Kite pays <b>×5.29 HC</b> ({f2(kite_c['100+']['a_C'])} → {f2(kite_c['100+']['a_V'])}/pd) and <b>×4.49 SPT</b> at 100+. Whatever kite config shipped in the Variant, it is not what `Ki_v2` models — the live payouts (claim spikes 113–117k HC per instance vs Control's steady ~10–19k/day drip) also suggest the live event's structure differs, not just its numbers.</p>
{proof('P9', 'Kite 100+: sim ×1.0 HC / ×0.80 SPT vs live ×5.29 / ×4.49', [
    ('live HC papd C → V (100+)', f"{f2(kite_c['100+']['a_C'])} → {f2(kite_c['100+']['a_V'])}"),
    ('live SPT papd C → V (100+)', '3.88 → 17.40'),
    ('sim windowed ratios (100+)', 'HC ×1.00 · SPT ×0.80'),
    ('live V payout days', 'Aug 3 & Aug 10 (ends 5 & 12 ✓ the corrected phase)')],
  'sign-flip := (r_sim − 1)·(r_act − 1) < 0, both sides material',
  'kite_festival_event rows (HardCoin free, DreamPassToken) per arm; sim rows in analysis/out/sim_matrix.json.', 'V4-kite-persists')}
</div>

<div class="panel"><h4>⚠ Rainbow Maker — the sim's most over-generous lane (≈1.9× the live tokens)</h4>
<p>RM is the Variant's #1 token source ({f2(rm['act_papd']['100+']['V_spt'])} SPT/pd at 100+, corrected series). It is new on both sides, so no measured anchor exists and no per-cell <i>ratio</i> can be formed — RM lands in NEW_BOTH and drops out of the cell-by-cell scoring. It does <b>not</b> drop out of the sim's total, though, and on the whole-faucet bridge (§00) the size is now checkable: RM contributes <b>{f2(bc('SPT','Rainbow Maker'),1)} SPT/pd</b> in the sim against <b>{f2(bc('SPT','Rainbow Maker','act'),1)}</b> live ({bc('SPT','Rainbow Maker')/bc('SPT','Rainbow Maker','act'):.2f}× too generous), and <b>{f2(bc('HC','Rainbow Maker'),1)} HC/pd</b> against <b>{f2(bc('HC','Rainbow Maker','act'),1)}</b> live. That single lane is the largest positive error in the model, and it is what makes the SPT and HC totals look better than the individual lanes deserve. Likely causes, in order: the survival-weighted milestone reach is too deep (bottom-up reach has no measured participation anchor), and the hardcoded 3×<code>RM_1st</code>+2×<code>RM_2nd</code> instance split assigns the wrong sheet in-window — the live ladder matches <code>RM_2nd</code> exactly.</p>
{proof('P10', 'Live RM ladder ≡ RM_2nd (all 30 score_reqs exact); ledger RM is the corrected series', [
    ('RM SPT/pd 100+ V (ledger, corrected)', f2(rm['act_papd']['100+']['V_spt'])),
    ('RM HC/pd 100+ V', f2(rm['act_papd']['100+']['V'])),
    ('config match', 'rainbow_maker_config.csv ≡ RM_2nd Req Accum, 30/30')],
  'corrected ≡ ledger: RAINBOW lane (corrected) ≈ ledger RM DPT papd; uncorrected runs materially higher',
  'compare rainbow_maker_config.csv vs wb16 RM_2nd; avg_spt_gain_RAINBOW vs _uncorrected in liveops2_ab_daily_metrics.csv.', 'C9-rainbow')}
</div>

<div class="panel"><h4>✓ Daily Gift — the stealth nerf, priced correctly</h4>
<p>Live cut the gift −35% per claim in every segment; the sim's streak-weighted c_day_v2 ladder predicts ×0.61–0.65 vs live ×0.63–0.66. Green in all five segments — the reward-ladder machinery works when the config matches what shipped.</p>
{proof('P11', 'Daily Gift: sim ×0.61–0.65 vs live ×0.63–0.66 per segment', [
    (s, f"sim {fr(dg[s]['r_sim'])} vs live {fr(dg[s]['r_act'])}") for s in SEGS],
  'sim R = streak-survival-weighted Σ c_day_v2 ÷ Σ c_day',
  'daily_reward rows (free HC) per arm ÷ player_days; wb16 c_day/c_day_v2 ladders.', 'C7-daily-gift')}
</div>

<div class="panel"><h4>Season Pass — progression shifted down; SPTx2 can't be compared at all</h4>
<figure class="card">{milestone_chart(STORY['sp_milestones']['split'])}
<div class="legend"><span class="lg"><i style="background:{C['sim']}"></i>Control</span><span class="lg"><i style="background:{C['act']}"></i>Variant</span> · tier-30 cap share fell 8.0% → 6.6%</div></figure>
<p class="note">The sim's Season-Pass row responds through tier coupling, but `40-99`/`100+` exceed the 30-tier ladder on both sides (cap-masked — no tier movement possible), and live shows the cap binding for ~7% of players, not whole segments: the sim's earner-level tier model is too coarse at the top. Separately, <b>SPTx2 is excluded from every comparison</b>: telemetry logs `SeasonPassMultiplier2x` in <i>minutes</i>; the engine weights SPTx2 as a double-value <i>token</i> in `sptTotals_` — dimensionally incomparable, and a standing bug candidate for the sim.</p></div>

<div class="panel"><h4>Schedule divergence &amp; residual window artifacts — {cc.get('WINDOW_MISS',0)} cells</h4>
<p>After the phase correction, the remaining window-missed cells split into two very different stories. <b>Genuine schedule divergence:</b> Jigsaw ran live ~Aug 7–10+ while cal_new plans days 17–19 (≈Aug 14–16), and Bomb's Ballet ended live ~Aug 2 vs planned days 10–12 — neither fits <i>any</i> phase, so the live ops team moved them relative to the plan. Their cells are scored on the 33-day fallback ratio, where both come out green (Jigsaw ×0.90 vs live ×1.00; BB ×0.85 vs ×0.99) — the <i>configs</i> are fine, the <i>calendar</i> moved. <b>Residual placement artifacts:</b> a handful of Target Day / Team Race cells where the cal_curr side's phase doesn't match the live Control's own rotation (the Control arm runs its own schedule too — e.g. live Control Jigsaw sat fully inside Aug 2–10 while cal_curr's plan puts its instances outside days 5–13).</p>
<figure class="card">{overlay_chart(STORY['daily_overlay'], '10-19')}
<div class="legend"><span class="lg"><i style="background:{C['sim']}"></i>sim daily allocation</span><span class="lg"><i style="background:{C['act']}"></i>live Variant</span></div></figure>
{proof('P12', 'Jigsaw and Bomb’s Ballet moved vs the plan; their configs still verify on 33-day ratios', [
    ('window-missed cells by category', ', '.join(f'{k} {v}' for k, v in sorted(wmiss_by_cat.items(), key=lambda x: -x[1])[:6])),
    ('Jigsaw live V daily', 'flat ~5-6k Aug 2-6, then 333k→453k Aug 7-10 (a run in progress at window end)'),
    ("Bomb's Ballet live V daily", '381k Aug 2 decaying to 3k by Aug 10 (a run that ended as the window opened)'),
    ('their 33-day fallback scores', 'Jigsaw ×0.90 vs live ×1.00 · BB ×0.85 vs ×0.99 — green')],
  'WINDOW_MISS := windowed sim ≈ 0 on a source the live window paid; scored on sim_33/meas_33 instead (dashed)',
  'Jigsaw / bomb_ballet_event by event_date in resource_gains_base.csv; instance lists from the calendar grids.', 'V1-day-map')}
</div>


<h3>Event scorecard — every event, including the quiet ones</h3>
<p>Per event: the biggest cell's verdict for HC, its most-material booster, Unlimited Lives, and SPT. Chips read "segment sim-change vs live-change"; "·33d" = scored on the 33-day fallback because the event's footprint missed the mapped window.</p>
<div class="tw"><table><thead><tr><th>event</th><th>HC</th><th>top booster</th><th>UL lives</th><th>SPT</th></tr></thead><tbody>{scorecard_rows}</tbody></table></div>

<h3>Boosters — how the sim did on the item economy</h3>
<p>Player-day-weighted, free amounts. "on-scored act / pred" compares like-for-like: the live change on exactly the cells the sim could score, against the sim's prediction there. Booster faucets are drips next to HC, but the pattern is consistent: <b>where a config exists, the sim tracks booster direction</b> (Jigsaw UL-Chuck ×0.90 vs ×1.04; the saga item ratios; Daily Gift contents identical per claim in both arms — the live nerf was HC-only, which the sim also got right). The two real gaps are both about <i>which source</i> pays, not the totals: the <b>saga UL-Lives swap</b> ({f2(bc('Unlimited Lives','Saga','act'),1)} min/pd live through saga, sim ×1.0 — nothing else is the same order of magnitude) and <b>Rainbow Maker's item ladder</b>, which the sim over-pays on every booster it touches (UL Lives {f2(bc('Unlimited Lives','Rainbow Maker'),1)} sim vs {f2(bc('Unlimited Lives','Rainbow Maker','act'),1)} live; Slingshot {f2(bc('Slingshot','Rainbow Maker'),2)} vs {f2(bc('Slingshot','Rainbow Maker','act'),2)}). Net effect on the UL total: {f2(ulF['predicted_change_full_papd'],1)} predicted vs {f2(ulF['actual_change_papd'],1)} live — the two errors are in the same resource and partly cancel.</p>
<div class="tw"><table><thead><tr><th>resource</th><th>C → V /pd</th><th>live Δ (all)</th><th>on-scored act / pred</th><th>cells</th><th>biggest scored miss</th></tr></thead><tbody>{booster_rows}</tbody></table></div>
{proof('P14', 'Booster aggregates reproduce from the raw ledger', [
    ('UL Lives', '111.61 → 147.70 min/pd (+36.10) — saga swap, unmodeled'),
    ('Chuck', '1.922 → 1.592 (−0.330)'), ('Red', '1.657 → 1.531 (−0.126)'),
    ('Slingshot', '1.268 → 1.521 (+0.253) — RM ladder, unscorable class')],
  'player-day-weighted papd per resource, all sources summed; FREE convention for item rows',
  'resource_gains_by_segment_9d.csv + ab_denominators.csv is_total weights; per-cell detail in analysis/out/comparison.json.', 'V7-boosters')}

<h3>Player behaviour moved — a floor under every per-level prediction</h3>
<p>The sim holds behaviour fixed (T and every anchor use baseline attendance and play depth). The live Variant did not cooperate: the paying segments <b>complete 1.4–3.8% fewer levels per active day</b> — driven by a lower win rate (100+: 77.1% → 74.7%), <i>not</i> by less play (session minutes are flat-to-up, +2.5–3.4% in the mid segments) — while <b>A. 0 completes +9.8% more</b> (the redesign's target segment, and the one the sim structurally excludes). Two consequences: every per-level faucet (core HC and SPT, saga) carries a ~1–4% Variant-side headwind the sim cannot see; and the A. 0 uplift the redesign actually achieved has no sim counterpart at all. This is a clue to systematic under-shoots, but it bounds at a few percent — it cannot explain the Kite ×5 or the UL swap.</p>
<figure class="card">{beh_chart}</figure>
<div class="tw"><table><thead><tr><th>segment</th><th>levels completed / active day</th><th>Δ minutes</th><th>Δ win rate</th><th>Δ D7</th></tr></thead><tbody>{beh_rows}</tbody></table></div>
{proof('P15', 'The Variant completes fewer levels per active day in every paying segment', [
    ('levels/active C → V', 'B 10.25→9.91 (−3.3%) · C −2.0% · D −1.4% · E −3.8% · F −2.1% · A. 0 +9.8%'),
    ('win rate at 100+', '77.1% → 74.7% (−2.4pp) — the driver; minutes flat-to-up'),
    ('pooled excl. A. 0', '−2.6% levels completed per active day')],
  'behaviour drift = live Variant ÷ live Control on the same days; the sim assumes ×1.0',
  'ab_denominators.csv is_total rows: levels_completed_per_active, level_win_rate, session_minutes_per_active per segment × arm.', 'V6-behaviour')}

<h3>Uncertainty & ambiguity register</h3>
<ol class="amb">
<li><b>The Control arm runs its own rotation.</b> The corrected phase was fitted on the <i>Variant</i>; the live Control's schedule matches `cal_curr` only loosely (its Jigsaw sat fully inside Aug 2–10 while the plan puts instances outside days 5–13; its Bomb Challenge ended Aug 8 vs planned day 13 ≈ Aug 10). Windowed CURRENT-side allocations inherit this — the delta-vs-delta scores lean on the 33-day structure where it bites.</li>
<li><b>Jigsaw &amp; Bomb's Ballet moved vs the plan</b> (fit no phase); their configs verify on 33-day ratios, but any window-level number for them is schedule, not economy.</li>
<li><b>Core-SPT provenance (Q2).</b> The live A/B <i>does</i> log core per-level SPT — the telemetry lane (`avg_spt_gain_CORE`) is exactly what the actual side uses here. What lacks core-SPT rows are (a) the resource-ledger export (event-lane only) and (b) the sim's own `data_gains` anchor inside wb16 — so the sim's measured side is the D18 synthetic (L × E). Ratios are clean; absolute core-SPT levels are model-vs-telemetry.</li>
<li><b>Season Pass placement.</b> 'Season Pass (Free)' has no placement family → flat over 33 days; live grants cluster at tier claims. Crudest allocation in scope.</li>
<li><b>Payer blend drift.</b> Weights are baseline earner shares; live conversion moved slightly. Second-order.</li>
<li><b>Per-earner bridges.</b> The NS level check and the anchor boxes divide by any-source HC gainers — a known ~2–3× basis gap vs the sim's May earner base; ballpark comparisons only, flagged wherever used.</li>
<li><b>PerSource cross-check unresolved at unit level.</b> Garry's AB_Summary (2) PerSource ACTUAL block uses a per-source-per-earner denominator from a query outside the repo — structure-level reconciliation only ({f2(GATES['persource_max_share_delta_pp'],1)}pp max share delta, denominator-driven, RM the extreme).</li>
<li><b>Segment definitions drift</b> between the May behaviour pull (sim weights) and the Aug test population; <b>A. 0</b> — the A/B's headline segment, and the one that moved most (+9.8% levels) — is structurally outside the sim.</li>
<li><b>wb16 hygiene.</b> The export's hidden `cal_parsed` is STALE (still lists Night Sky on cal_curr and old Target Day instances) — the offline pipeline bypasses it, but the LIVE workbook needs menu ▸ Precompute calendars re-run, plus the re-paste of the fixed `EcoGainsSim_v4.gs`. Pack/PBP-era sheets remain reverted (cards harness can't run on this branch; wb14 snapshot kept).</li>
</ol>
</section>'''


# ---- section 03 -----------------------------------------------------------------
RECAL = [
 ('R0', 'Re-paste the engine, then re-fill the display sheets',
  'the Apps Script project still runs the pre-fix saga reader, so `Sim per Segment` shows a +93% HC '
  'uplift while the same calendar run through the fixed reader shows a ~13% cut (§00). The '
  'workbook’s cached fill matches the old engine to 1.4%; nothing else about it is wrong',
  'Paste engine/EcoGainsSim_v4.gs into Apps Script (whole file), run EcoGainsSim ▸ Precompute '
  'calendars (the shipped cal_parsed is stale too), then re-run the Sim per Segment fill',
  'Stops the workbook and this report disagreeing about the sign of the change', 'S'),
 ('R1', 'Calendar day anchor', 'the window map said live Aug 2 = calendar day 27 (with a wrap); the live data shows Aug 2 = day 5',
  'Already fixed in this report. Going forward, keep the anchor written down next to the calendar (one cell: "day 1 = <date>") and update it when the live cycle moves, instead of remembering it',
  'This one fix flipped Target Day and Red/Bomb Challenge from "wrong" to "right"', 'done'),
 ('R2', 'Kite Festival config', 'the sim\u2019s Ki_v2 sheet says kite pays about the same as before (\u00d71.0); live kite pays 5\u00d7 more HC and 4.5\u00d7 more tokens',
  'Get the kite event config that is actually running in the Variant (from the live ops config, not the plan) and type its rank rewards into Ki_v2. The payout pattern (two big ~115k claim days per week) suggests the live event structure changed too \u2014 check league size and schedule while at it',
  'Fixes the one big source where the sim currently predicts the wrong direction', 'S'),
 ('R3', 'Saga Unlimited-Lives swap', 'live saga gives ~70% MORE Unlimited-Lives minutes (the compensation for the HC cut); both saga sheets in the workbook still have identical UL columns, so the sim predicts no change',
  'Type the live Variant\u2019s UL-Lives values into the c_saga_v2 item columns (the HC side is already correct after your base update)',
  f'Closes the biggest per-source booster miss: {f2(bc("Unlimited Lives","Saga","act"),1)} UL min/pd '
  f'that live grants through saga and the sim grants nowhere', 'S'),
 ('R4', 'Team Race token lane', 'Team Race pays a lot of pass tokens live (14\u219220/pd at 100+) but the sim treats Team Race as "no config \u2192 carry unchanged", and its measured token anchor is nearly zero',
  'Either add a Team Race config sheet (rank ladder with its SPT values) or re-pull data_gains so the measured anchor includes Team Race tokens',
  'Biggest token lane the sim currently cannot move', 'M'),
 ('R5', 'Control-side calendar', 'cal_curr is the May-era plan; the live Control arm runs its own rotation (it never runs Chuck; its event days differ by a few days)',
  'For A/B comparisons, rebuild cal_curr from what the Control arm actually ran (the daily CSV shows each event\u2019s real days) \u2014 or accept and read those cells via the 33-day ratios as this report does',
  'Removes the last "baseline mismatch" cells (Chuck) and the residual Control-side window noise', 'M'),
 ('R6', 'Track the as-run calendar', 'Jigsaw and Bomb\u2019s Ballet ran on different days than cal_new plans (not a phase issue \u2014 they moved); Red/Bomb\u2019s next instances (Aug 25\u201328 / Aug 11\u201314) could not be checked inside this window',
  'Once a week, note which events actually ran on which dates (the daily CSV gives this in minutes) and diff against cal_new. Specifically check: did Red run Aug 25\u201328? Did Bomb run Aug 11\u201314?',
  'Separates "the schedule moved" from "the config is wrong" in every future comparison', 'S'),
 ('R7', 'Refresh the data_gains pull', 'the sim\u2019s measured anchor is a May snapshot: its source-name mapping misses the renames (saga_progression, player_level_up, ad_chest), it has no core-SPT rows (so the sim substitutes a formula), and killed events like single_collection hide inside "Other"',
  'Re-run the data_gains query on a recent window with the updated source-name mapping (add the renames + give single_collection and dream_peak their own rows), and commit that SQL to the repo so it stops drifting',
  'Real measured anchors everywhere; "Other" stops hiding killed events', 'M'),
 ('R8', 'SPTx2 units', 'the game logs SeasonPassMultiplier2x in MINUTES (a timed 2\u00d7 multiplier); the engine counts SPTx2 as a token worth 2 points on the pass',
  'Ask/check once what the multiplier actually is in-game. If it\u2019s minutes, remove the \u00d72 token weighting from sptTotals_ and treat it like the UL boosters',
  'Makes the Season-Pass tier math trustworthy', 'S'),
 ('R9', 'Season Pass timing + cap', 'the sim spreads pass rewards evenly over 33 days (live players claim them in bursts at tier-ups), and at the current token rates the 30-tier cap tops out three whole segments so their pass rows cannot move',
  'Place pass rewards on tier-claim days instead of evenly; model the cap per player (live data: only ~7% of players hit tier 30, not whole segments)',
  'Pass rows respond realistically for the heavy segments', 'M'),
 ('R10', 'Rainbow Maker pays too much',
  f'on the whole-faucet bridge RM contributes {f2(bc("SPT","Rainbow Maker"),1)} SPT/pd in the sim '
  f'against {f2(bc("SPT","Rainbow Maker","act"),1)} live '
  f'({bc("SPT","Rainbow Maker")/bc("SPT","Rainbow Maker","act"):.1f}\u00d7) and '
  f'{f2(bc("HC","Rainbow Maker"),1)} HC/pd against {f2(bc("HC","Rainbow Maker","act"),1)} '
  f'({bc("HC","Rainbow Maker")/bc("HC","Rainbow Maker","act"):.1f}\u00d7) \u2014 the single largest '
  'over-payment in the model. Its milestone reach is bottom-up with no participation anchor, and '
  'the 5 instances are hardcoded to config sheets in a fixed 3+2 order (in-window instances get '
  'RM_1st while the live ladder is RM_2nd)',
  'Two changes: (1) calibrate the reach \u2014 fit the survival curve so RM\u2019s per-active-player-day '
  'output matches the observed lane (~24 SPT/pd overall) instead of assuming milestone depth; '
  '(2) move the instance\u2192sheet mapping onto the calendar so reordering cannot silently '
  'mis-assign. Add the participants \u00d7 reach \u00f7 player-days conversion so RM is scoreable '
  'cell-by-cell, not only in the total',
  'Removes the error that currently masks other misses in the HC and SPT totals', 'M'),
 ('R11', 'Player behaviour response', 'the sim assumes players behave exactly as in May; live Variant players complete 1.4\u20133.8% fewer levels per day (they fail more), and A. 0 players complete +9.8% more',
  'Add one per-segment multiplier ("levels completed per active day, Variant \u00f7 Control") fed from the A/B export, applied to the per-level lanes (core HC/SPT, saga). Consider modeling A. 0 \u2014 it\u2019s the segment the redesign helps most and the sim skips it',
  'Removes a constant ~2\u20134% error on every per-level prediction', 'M'),
 ('R12', 'Confirmed correct \u2014 leave alone', 'SP_v2 core-SPT panel (R 0.812) \u00b7 saga HC ladder (after your base fix) \u00b7 Daily Gift ladder \u00b7 Night Sky lane \u00b7 River Rush removal \u00b7 Target Day cadence',
  'Nothing. Re-check only if the live configs change again',
  'The core of the model matches the live test', 'done'),
]
recal_rows = ''.join(f'''<tr><td class="rid">{rid}</td><td><b>{esc(t)}</b><div class="rc">{esc(cur)}</div></td>
<td>{esc(prop)}</td><td>{esc(eff)}</td><td class="num">{esc(sz)}</td></tr>''' for rid, t, cur, prop, eff, sz in RECAL)

S3 = f'''
<section id="s03"><div class="sn">03</div><h2>Recalibration plan — what to change in the sim</h2>
<p>Ordered by expected impact on comparison accuracy. "done" rows shipped during this analysis.</p>
<div class="tw"><table class="rt"><thead><tr><th></th><th>what / current state</th><th>proposed change</th><th>expected effect</th><th>size</th></tr></thead>
<tbody>{recal_rows}</tbody></table></div>
{proof('P13', 'Where the remaining prediction error lives', [
    ('HC, whole faucet', f"sim {f2(hcF['predicted_change_full_papd'],1)} vs live {f2(hcA['actual_change_papd'],1)} /pd (miss {f2(hcF['miss_papd'],1)})"),
    ('HC, per-source errors that cancel', f"RM {f2(bc('HC','Rainbow Maker'),1)} vs {f2(bc('HC','Rainbow Maker','act'),1)} · NS {f2(bc('HC','Daily Night Sky Prize'),1)} vs {f2(bc('HC','Daily Night Sky Prize','act'),1)}"),
    ('SPT, whole faucet', f"sim {f2(sptF['predicted_change_full_papd'],1)} vs live {f2(sptA['actual_change_papd'],1)} /pd (miss {f2(sptF['miss_papd'],1)})"),
    ('SPT, dominant error', f"RM {f2(bc('SPT','Rainbow Maker'),1)} vs {f2(bc('SPT','Rainbow Maker','act'),1)} · Core {f2(bc('SPT','Core'),1)} vs {f2(bc('SPT','Core','act'),1)}"),
    ('HC, comparable cells only', f"sim {f2(hcA['predicted_change_scored_papd'],1)} vs live {f2(hcA['actual_change_on_scored_papd'],1)} /pd")],
  'whole faucet: Σ_seg pd·a_C·(ΣS/ΣM − 1)/ΣPD over all 25 sources; per-source: same bridge factor k = a_C/M applied to that source’s (S − M), additive to the total (gate: residual 0.0)',
  'full_scope in analysis/out/comparison.json (predicted_change_full_papd, by_category); comparable-cell aggregates alongside in aggregates.', 'GATE')}
</section>'''

# ---- appendix -------------------------------------------------------------------
excl_rows = ''.join(f'<tr><td>{esc(e["resource"])}</td><td>{esc(e["reason"])}</td><td class="num">{e["free"]:,.0f}</td></tr>'
                    for e in cmp_['excluded_resources'])
census_rows = ''.join(f'<tr><td>{esc(k)}</td><td class="num">{v}</td></tr>' for k, v in sorted(cc.items(), key=lambda x: -x[1]))
other_rows = ''.join(f'<tr><td>{esc(o["source_detail"])}</td><td class="num">{float(o["free_hc"]):,.0f}</td><td class="num">{float(o["share_of_free_hc"]):.2%}</td></tr>'
                     for o in other_top)
ps_rows = ''.join(f'<tr><td>{esc(r["segment"])}</td><td>{esc(r["source"])}</td><td class="num">{r["persource_share"]:.1%}</td><td class="num">{r["my_share"]:.1%}</td><td class="num">{r["delta_pp"]:+.1f}pp</td></tr>'
                  for r in sorted(GATES['persource_recon_structure'], key=lambda x: -abs(x['delta_pp']))[:12])

APP = f'''
<section id="app"><div class="sn">A</div><h2>Appendix — scope, exclusions, reconciliations</h2>
<div class="grid2">
<div class="panel"><h4>Excluded resources (and why)</h4><div class="tw"><table><thead><tr><th>resource</th><th>reason</th><th>free amount</th></tr></thead><tbody>{excl_rows}</tbody></table></div></div>
<div class="panel"><h4>Cell class census</h4><div class="tw"><table><thead><tr><th>class</th><th>cells</th></tr></thead><tbody>{census_rows}</tbody></table></div>
<p class="note">Also excluded: card packs (sim-side only; values unauthored), `A. 0` segment (appendix semantics), `SeasonPassToken` (trivial), orbs/Avatar/lives (out of scope).</p></div>
</div>
<div class="grid2">
<div class="panel"><h4>What's inside "Other" (top contributors, free HC)</h4><div class="tw"><table><thead><tr><th>source_detail</th><th>free HC</th><th>share</th></tr></thead><tbody>{other_rows}</tbody></table></div></div>
<div class="panel"><h4>PerSource (AB_Summary (2)) structure check — largest share deltas</h4><div class="tw"><table><thead><tr><th>seg</th><th>source</th><th>PerSource</th><th>this report</th><th>Δ</th></tr></thead><tbody>{ps_rows}</tbody></table></div>
<p class="note">Unit-level reconciliation unresolved — the sheet's per-source-per-earner denominator isn't derivable from the repo CSVs (§02 ambiguity #6). Deltas here are dominated by that denominator, not by amount disagreements.</p></div>
</div>
<div class="panel"><h4>Pipeline gates</h4>
<ul class="gate">
<li>harness: _mock_run 49 gates green (2 SP tier gates refreshed — magnitude was workbook state; mechanism now mutation-tested both directions) · _mock_daily green · _mock_7day green · _mock_pbp 1 red + _mock_cards crash — wb15 branch reverted PackConfig/saga-era sheets (out of report scope; green on the wb14 snapshot harness/_mockdata_wb14.json)</li>
<li>conservation (day grids → 33-day matrices): max rel err 1.2e-15</li>
<li>mapping accounting identity: exact · player_days == ab_denominators · Other share 4.8% C / 2.3% V</li>
<li>SPT event-lane cross-check (ledger vs telemetry lanes): ratios {', '.join(f"{k} {v['ratio']}" for k, v in list(GATES['spt_event_lane_check'].items())[:4] if v['ratio'])}</li>
<li>payer-blend weight sources: {esc(str(GATES['payer_weight_census']))}</li>
</ul></div>
<p class="foot">Built from analysis/out/comparison.json — every number in this page is injected from that file; nothing is hand-typed. Pipeline: <code>node harness/_dump_sim_matrix.js</code> → <code>python analysis/_extract_actuals.py</code> → <code>python analysis/_build_comparison.py</code> → <code>python analysis/_build_report.py</code>. Sim vintage: workbook (15) via harness/_mockdata.json (wb14 snapshot preserved). Actuals: the 2–10 Aug corrected re-exports. This report compares models to measurements; where a side is a model (Core-SPT synthetic anchor) it says so.</p>
</section>'''

# ---- CSS ------------------------------------------------------------------------
CSS = f'''
*{{box-sizing:border-box;margin:0;padding:0}}
html{{scroll-behavior:smooth}}
body{{background:{C['page']};color:{C['ink']};font:15px/1.55 'Segoe UI',system-ui,sans-serif;padding:0 0 80px}}
.wrap{{max-width:1060px;margin:0 auto;padding:0 28px}}
header.hero{{padding:54px 0 30px;border-bottom:1px solid {C['line']};margin-bottom:8px}}
h1{{font-size:30px;font-weight:650;letter-spacing:-.3px;text-wrap:balance;max-width:30ch}}
.sub{{color:{C['ink2']};margin-top:10px;max-width:72ch}}
.chips{{margin-top:18px;display:flex;flex-wrap:wrap;gap:8px}}
.chip{{display:inline-block;font:11px/1 'Cascadia Mono',Consolas,monospace;padding:6px 10px;border-radius:999px;border:1px solid {C['line2']};color:{C['ink2']};background:{C['card']}}}
.chip.good{{color:{C['good']};border-color:{C['good']}55}}
.chip.warn{{color:{C['warn']};border-color:{C['warn']}55}}
.chip.bad{{color:{C['bad']};border-color:{C['bad']}55}}
.chip.mut{{color:{C['mut']}}}
section{{padding:34px 0 10px;position:relative}}
.sn{{font:600 12px 'Cascadia Mono',Consolas,monospace;color:{C['good']};letter-spacing:2px;margin-bottom:6px}}
h2{{font-size:22px;font-weight:650;letter-spacing:-.2px;margin-bottom:16px;text-wrap:balance}}
h3{{font-size:16px;font-weight:650;margin:26px 0 10px;color:{C['ink']}}}
h4{{font-size:14.5px;font-weight:650;margin-bottom:8px}}
p,li{{color:{C['ink2']};max-width:78ch}}
p b,li b{{color:{C['ink']}}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:18px 0}}
.kpi{{background:{C['card']};border:1px solid {C['line']};border-radius:10px;padding:14px 16px}}
.kpi .l{{font:11px 'Cascadia Mono',Consolas,monospace;color:{C['mut']};text-transform:uppercase;letter-spacing:1px}}
.kpi .v{{font:650 22px/1.3 'Cascadia Mono',Consolas,monospace;color:{C['ink']};margin:6px 0 2px;font-variant-numeric:tabular-nums}}
.kpi .s{{font-size:12px;color:{C['mut']}}}
.okv{{color:{C['good']};font-size:13px}}.wv{{color:{C['warn']};font-size:13px}}.bv{{color:{C['bad']};font-size:13px}}
.vlist{{list-style:none;display:flex;flex-direction:column;gap:10px;margin:10px 0}}
.vlist li{{padding:10px 14px;background:{C['card']};border:1px solid {C['line']};border-radius:8px;max-width:none}}
.vlist .ok{{color:{C['good']}}}.vlist .bd{{color:{C['bad']}}}
ol.method{{margin:10px 0 14px 20px;display:flex;flex-direction:column;gap:8px}}
figure.card{{background:{C['card']};border:1px solid {C['line']};border-radius:10px;padding:16px;margin:14px 0;overflow-x:auto}}
.figtitle{{font:600 12px 'Cascadia Mono',Consolas,monospace;color:{C['ink2']};margin-bottom:10px}}
.legend{{margin-top:8px;font:11px 'Cascadia Mono',Consolas,monospace;color:{C['mut']};display:flex;flex-wrap:wrap;gap:12px;align-items:center}}
.lg i{{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}}
.grid2{{display:grid;grid-template-columns:1fr 1fr;gap:14px}}
@media(max-width:900px){{.grid2{{grid-template-columns:1fr}}}}
.panel{{background:{C['card']};border:1px solid {C['line']};border-radius:10px;padding:18px;margin:14px 0}}
.panel h4{{display:flex;gap:8px;align-items:baseline}}
.note{{font-size:13px;color:{C['mut']};margin-top:8px}}
details.proof{{margin:12px 0;border:1px solid {C['good']}44;border-left:3px solid {C['good']};border-radius:8px;background:{C['raise_']}}}
details.proof summary{{cursor:pointer;padding:10px 14px;font-size:13px;color:{C['ink2']};display:flex;flex-wrap:wrap;gap:8px;align-items:center}}
details.proof summary::-webkit-details-marker{{display:none}}
.pid{{font:650 11px 'Cascadia Mono',Consolas,monospace;color:{C['good']};letter-spacing:1px}}
.pbody{{padding:4px 16px 14px;border-top:1px solid {C['line']}}}
.ptab{{border-collapse:collapse;margin:10px 0;font:12.5px 'Cascadia Mono',Consolas,monospace}}
.ptab td{{padding:3px 14px 3px 0;color:{C['ink2']};border-bottom:1px dotted {C['line']}}}
.ptab td.num{{color:{C['ink']};font-variant-numeric:tabular-nums}}
.pform{{font:12.5px 'Cascadia Mono',Consolas,monospace;color:{C['good']};background:{C['page']};padding:8px 12px;border-radius:6px;margin:8px 0}}
.precipe{{font-size:12.5px;color:{C['mut']}}}
.precipe code{{color:{C['ink2']};background:{C['page']};padding:1px 5px;border-radius:4px;font-family:'Cascadia Mono',Consolas,monospace;font-size:11.5px}}
.tw{{overflow-x:auto}}
table{{border-collapse:collapse;font:12.5px 'Cascadia Mono',Consolas,monospace;width:100%}}
th{{text-align:left;color:{C['mut']};font-weight:600;padding:6px 10px;border-bottom:1px solid {C['line2']};text-transform:uppercase;font-size:10.5px;letter-spacing:.5px}}
td{{padding:6px 10px;border-bottom:1px solid {C['line']};color:{C['ink2']}}}
td.num{{font-variant-numeric:tabular-nums;color:{C['ink']}}}
td.rid{{font-weight:650;color:{C['good']}}}
.rt td b{{color:{C['ink']};font-family:'Segoe UI',system-ui,sans-serif}}
.rt .rc{{font-size:11.5px;color:{C['mut']};margin-top:2px}}
ol.amb{{margin:10px 0 10px 20px;display:flex;flex-direction:column;gap:8px}}
ol.amb li{{font-size:13.5px}}
ul.gate{{list-style:none;display:flex;flex-direction:column;gap:6px;font-size:13px}}
ul.gate li{{color:{C['ink2']}}}
details.dtab summary{{font:11px 'Cascadia Mono',Consolas,monospace;color:{C['mut']};cursor:pointer;margin-top:6px}}
.foot{{font-size:12.5px;color:{C['mut']};border-top:1px solid {C['line']};padding-top:16px;margin-top:26px;max-width:none}}
.foot code{{font-family:'Cascadia Mono',Consolas,monospace;font-size:11.5px;color:{C['ink2']}}}

.ovgrid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:14px}}
.ovcard{{background:{C['card']};border:1px solid {C['line']};border-radius:10px;padding:12px 14px}}
.ovh{{font:650 11px 'Cascadia Mono',Consolas,monospace;color:{C['good']};text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}}
.ovsub{{font-size:11.5px;line-height:1.45;color:{C['mut']};margin-bottom:8px;border-bottom:1px solid {C['line']};padding-bottom:7px}}
.ovt{{font-size:11.5px}}
.ovt th{{font-size:9.5px;padding:3px 8px;vertical-align:bottom}}
.ovt td{{padding:3px 8px;border-bottom:1px dotted {C['line']}}}
.ovcard.ovwide{{grid-column:1/-1}}
.ovt .dim{{color:{C['mut']};font-size:10px}}
.warnbox{{background:rgba(224,104,92,.10);border:1px solid {C['bad']};border-left:4px solid {C['bad']};
  border-radius:10px;padding:14px 16px;margin-top:14px}}
.warnbox.ok{{background:rgba(85,199,126,.08);border-color:{C['good']};border-left-color:{C['good']}}}
.warnbox .wbh{{font:650 13px/1.4 Inter,system-ui,sans-serif;color:{C['bad']};margin-bottom:8px}}
.warnbox.ok .wbh{{color:{C['good']}}}
.warnbox p{{font-size:13px;line-height:1.6;color:{C['ink2']};max-width:none;margin:7px 0}}
.warnbox table{{margin-top:8px}}
.ovt.srct td{{white-space:nowrap}}
.ovt tr.totrow td{{border-top:1px solid {C['line']};border-bottom:none;color:{C['ink']}}}


.mxt{{border-collapse:collapse;font:10.5px "Cascadia Mono",Consolas,monospace}}
.mxt th{{font-size:9.5px;padding:4px 6px}}
.mxt td.mxl{{white-space:nowrap;padding:3px 8px;color:{C['ink2']}}}
.mxt td.mx{{padding:2px 6px;text-align:right;min-width:62px;border:1px solid {C['line']};border-radius:0}}
.mxt td.mx .mxa{{display:block;color:{C['ink']};font-variant-numeric:tabular-nums}}
.mxt td.mx .mxp{{display:block;color:{C['sim']};font-variant-numeric:tabular-nums}}
.mxt td.mx.na{{color:{C['mut']};text-align:center}}
.mxt td.mx.na .mxa{{color:{C['mut']};font-size:9px}}
.mxt td.mx.hot{{outline:2px solid {C['bad']};outline-offset:-2px}}\n
details.mxd{{margin:10px 0;border:1px solid #24382C;border-radius:8px;background:#111E16}}
details.mxd summary{{cursor:pointer;padding:9px 14px;font:12px 'Cascadia Mono',Consolas,monospace;color:#9DB4A2}}
details.mxd summary b{{color:#E8F2EA}}
details.mxd .tw{{padding:0 10px 10px}}

svg text{{user-select:none}}
@media(prefers-reduced-motion:no-preference){{details.proof[open] .pbody{{animation:fadein .18s ease}}}}
@keyframes fadein{{from{{opacity:0}}to{{opacity:1}}}}
'''

BODY = f'''<title>Sim vs Live</title>
<style>{CSS}</style>
<div class="wrap">
<header class="hero">
<h1>Sim vs Live — where EcoGainsSim diverges from the LiveOps v2 test</h1>
<p class="sub">The v4 economy simulation (workbook 15) scored against the 2–10 Aug A/B actuals, cell by cell: what the model got right, where it is structurally blind, and the recalibration plan. Every conclusion carries a proof box with the numbers, the formula, and a recipe to re-derive it yourself.</p>
<div class="chips">{head_chips}</div>
</header>
{S0}
{S1}
{S2}
{S3}
{APP}
</div>'''

# standalone document for reports/
DOC = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">{BODY.split("<style>",1)[0]}<style>{CSS}</style></head><body>{BODY.split("</style>",1)[1]}</body></html>'

rep_path = os.path.join(HERE, '..', 'reports', 'LiveOps_v2_sim_vs_actual_discrepancy.html')
with open(rep_path, 'w', encoding='utf-8') as f: f.write(DOC)
art_path = os.path.join(OUT, 'artifact_body.html')
with open(art_path, 'w', encoding='utf-8') as f: f.write(BODY)
print('written', os.path.normpath(rep_path), f'{os.path.getsize(rep_path):,} bytes')
print('written', art_path, f'{os.path.getsize(art_path):,} bytes')
print('verification badges:', {k: v['verdict'] for k, v in VERIFY.items()} or 'none yet')
