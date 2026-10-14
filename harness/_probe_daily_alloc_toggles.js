// Daily-allocation probe, stage 2 (2026-10-14): PLUGGABLE ALLOCATORS. NOT a gate - a measurement tool.
// Requires harness/_probe_daily_alloc.js (stage 1) for the mock SpreadsheetApp, the engine load, the
// baseline per-category day series, the actuals and the metrics; then RE-PLACES every category's
// cal_curr window total with its own kernels so each proposed change to EcoGainsSim_Daily.gs can be
// scored ALONE against the baseline, then all together. No engine file is touched; nothing random.
//   node harness/_probe_daily_alloc_toggles.js [--data <dump>] [--out <json>]
//
// Model: w = place (x) settle (x) collect, per (category, cell, resource), renormalised over days 1..33
// (conservation: every category's window total is unchanged; mass that would land past day 33 is
// spread back over the window unless a variant says otherwise).
//   place   = baseline family rule (always-on p_day / flat / last-day lump / accrual marginal /
//             p_day-within-instance), modified by T3 (milestone share s along the curve), T4 (Season
//             Pass tier crossings), T5 (flat -> p_day).
//   settle  = +1 day for the rank LUMPS of DAILY_LASTDAY categories (T1); 0 for everything else.
//   collect = attendance kernel P(collect on s+k) = p_(s+k) PROD_(j<k)(1 - p_(s+j)) from the cell's
//             weekday/weekend active rates (T2 on every non-always-on component, T2b on lumps only),
//             with a rate multiplier m (p' = min(0.99, m p)) swept because the rates describe the whole
//             segment while the actuals are per EARNER.
// Self-check: with every toggle off the rebuilt series equals the engine's dailySeries_ output.
const fs = require('fs');
const path = require('path');
const P = require('./_probe_daily_alloc.js');
const E = P.engine;
const { ctx, CELLS, RES, D, catSeries, allMetrics, tv, mape, sum, mean, r6, quantiles, agg, ma7 } = P;
const { reachOne_, isWeekend_, curveRaw_, normalize_, sptTotals_, readSPTrack_, readSPSeasonDays_, spTier_, num,
        DAILY_ALWAYS, DAILY_LASTDAY, DAILY_MARGINAL, DAILY_PDAY_INST } = E;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', path.join(__dirname, '..', 'analysis', 'out', 'daily_alloc_toggles.json'));
const zeros = () => new Array(D).fill(0);

// ---- per-cell inputs ----
const T3_CURVE = { 'Bomb Challenge': 'Bomb', 'Chuck Challenge': 'Chuck', 'Red Challenge': 'Red', 'Flash Race': 'Flash Race',
                   'Level Race': 'Level Race', 'Target Day': 'Target Day', 'Flock Flurry': 'Flock Flurry' };
const SP_CATS = { 'Season Pass (Free)': 'free', 'Season Pass (Paid)': 'paid' };
const spTrack = readSPTrack_('SP');
const cellInfo = {};
CELLS.forEach(({ seg, payer }) => {
  const b = ctx.ds.beh(seg, payer);
  let pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)) { pWd = 1; pWe = 1; }
  const pDay = (d) => isWeekend_(d) ? pWe : pWd;
  const spt = sptTotals_(seg, payer, ctx);
  cellInfo[seg + ' ' + payer] = { seg, payer, pWd, pWe, pDay, pVec: Array.from({ length: D }, (_, i) => pDay(i + 1)), sptMeas: spt.meas };
});
const catTotals = {};   // cell -> cat -> res -> window total (sum of the engine's baseline series)
const catList = {};     // cell -> [cat] with any mass
CELLS.forEach(({ seg, payer }) => { const k = seg + ' ' + payer; catTotals[k] = {}; const set = {};
  RES.forEach(res => { const cs = catSeries[k][res]; Object.keys(cs.cats).forEach(cat => { catTotals[k][cat] = catTotals[k][cat] || {}; catTotals[k][cat][res] = sum(cs.cats[cat]); set[cat] = 1; }); });
  catList[k] = Object.keys(set); });

// ---- placement components: [{ kind:'lump'|'spread', exempt, w:[33+] }], total mass 1 ----
function marginalOfCurve(curve, n) { const out = []; for (let j = 1; j <= n; j++) out.push(Math.max(0, curveRaw_(curve, j) - curveRaw_(curve, j - 1))); return normalize_(out); }
function instShares(insts, ci) { const r = insts.map(inst => reachOne_(inst, ci.pWd, ci.pWe)), sR = sum(r); return insts.map((_, i) => sR > 0 ? r[i] / sR : 1 / insts.length); }
function spTierWeights(cellKey, track, mode) {
  // tier-crossing days: the window SPT total (sptTotals_.meas, i.e. INCLUDING the D18 synthetic Core
  // anchor) accrues prop p_day; each cal_curr Season Pass instance is its own season starting at 0;
  // tier i lands on the first day its cumulative points reach SP.cum[i]. 'linear' = spPackTiers_'s
  // own rule (tier i on day ceil(n * i / Ts) of the instance) instead of the crossing day.
  // Variants: '<base>_spread' pays each tier CONTINUOUSLY over the days between the previous crossing
  // and its own (prop p_day) instead of as a delta on the crossing day; '<base>_actualspt' takes the
  // SPT rate from the cell's ACTUAL SPT window total (data_econ_daily) instead of sptTotals_.meas.
  const spread = /_spread/.test(mode), actualSpt = /_actualspt/.test(mode), base = mode.replace(/_spread|_actualspt/g, '');
  const ci = cellInfo[cellKey], insts = (P.calCurInst('Season Pass (Free)') || []).slice().sort((a, b) => a.days[0] - b.days[0]);
  const cum = spTrack.cum; if (!cum.length || !insts.length) return null;
  const sptTotal = actualSpt ? sum(catSeries[cellKey]['SPT'].a) : ci.sptMeas;
  if (!(sptTotal > 0)) return null;
  const rate = sptTotal / sum(ci.pVec);
  const rows = track === 'paid' ? spTrack.paid : spTrack.free;
  const crossings = [];   // {tier (1-based), day, from (first day of the accrual interval)}
  insts.forEach(inst => {
    const days = inst.days.filter(d => d >= 1 && d <= D).slice().sort((a, b) => a - b); if (!days.length) return;
    let prev = days[0];
    if (base === 'linear') {
      const Ts = spTier_(rate * sum(days.map(ci.pDay)), cum);
      for (let i = 1; i <= Ts; i++) { const day = days[Math.max(0, Math.min(days.length - 1, Math.ceil(days.length * i / Ts) - 1))]; crossings.push({ tier: i, day, from: prev }); prev = Math.min(days[days.length - 1], day + 1); }
      return;
    }
    let running = 0, t = 0;
    days.forEach(d => { running += rate * ci.pDay(d); while (t < cum.length && running >= cum[t]) { crossings.push({ tier: t + 1, day: d, from: prev }); t++; prev = Math.min(days[days.length - 1], d + 1); } });
  });
  if (!crossings.length) return null;
  return (res) => {
    let masses = crossings.map(c => num((rows[c.tier - 1] || {})[res]));
    if (!(sum(masses) > 0)) masses = crossings.map(() => 1);          // resource not on this track: equal mass per tier
    const w = zeros();
    crossings.forEach((c, i) => {
      if (!spread || c.from > c.day) { w[c.day - 1] += masses[i]; return; }
      const span = []; for (let d = c.from; d <= c.day; d++) span.push(ci.pDay(d));
      const nz = normalize_(span); for (let d = c.from; d <= c.day; d++) w[d - 1] += masses[i] * nz[d - c.from];
    });
    return normalize_(w);
  };
}
function components(cellKey, cat, res, o) {
  const ci = cellInfo[cellKey];
  if (DAILY_ALWAYS[cat]) return [{ kind: 'spread', exempt: true, w: normalize_(ci.pVec.slice()) }];
  const insts = P.calCurInst(cat);
  if (!insts.length) return [{ kind: 'spread', exempt: false, w: o.t5 ? normalize_(ci.pVec.slice()) : normalize_(zeros().map(() => 1)) }];
  if (SP_CATS[cat] && o.t4 && o.t4 !== 'off') {
    const f = spTierWeights(cellKey, SP_CATS[cat], o.t4);
    if (f) return [{ kind: 'spread', exempt: false, w: f(res) }];
  }
  const shares = instShares(insts, ci), out = [];
  if (DAILY_LASTDAY[cat]) {
    const curve = T3_CURVE[cat] ? ctx.ds.accrualCurve(T3_CURVE[cat], ci.seg, ci.payer, false) : [];
    const s = (curve.length && o.t3s && o.t3s[cat]) ? o.t3s[cat] : 0;
    const lump = zeros(), mile = zeros();
    insts.forEach((inst, i) => {
      let days = inst.days.slice().sort((a, b) => a - b);
      if (o.t3mode === 'curvelen' && curve.length) {              // the curve's OWN length (instance_length_days), not the grid's
        const len = Math.max(days.length, curve[curve.length - 1].day);
        days = Array.from({ length: len }, (_, j) => days[0] + j);
      }
      const last = days[days.length - 1];
      if (last - 1 < lump.length) lump[last - 1] += shares[i] * (1 - s); else { while (lump.length < last) lump.push(0); lump[last - 1] += shares[i] * (1 - s); }
      if (s > 0) { const inn = marginalOfCurve(curve, days.length); days.forEach((d, j) => { while (mile.length < d) mile.push(0); mile[d - 1] += shares[i] * s * inn[j]; }); }
    });
    out.push({ kind: 'lump', exempt: false, w: lump });
    if (s > 0) out.push({ kind: 'spread', exempt: false, w: mile });
    return out;
  }
  const w = zeros();
  insts.forEach((inst, i) => {
    const days = inst.days, n = days.length; let inn = null;
    if (DAILY_MARGINAL[cat]) { const curve = ctx.ds.accrualCurve(DAILY_MARGINAL[cat], ci.seg, ci.payer, false); if (curve.length) inn = marginalOfCurve(curve, n); }
    if (!inn) inn = normalize_(days.map(ci.pDay));
    days.forEach((d, j) => { if (d >= 1 && d <= D) w[d - 1] += shares[i] * inn[j]; });
  });
  return [{ kind: 'spread', exempt: false, w }];
}

// ---- settle + collect + window handling ----
function shiftW(w, k, pastEnd) {            // k >= 0 days later; mass past day 33: 'renorm'/'drop' -> lost, 'fold33' -> day 33
  const out = zeros(); let lost = 0;
  w.forEach((v, d) => { if (!v) return; const j = d + k; if (j <= D - 1) out[j] += v; else if (pastEnd === 'fold33') out[D - 1] += v; else lost += v; });
  return { w: out, lost };
}
function collectW(w, pVec, mult) {          // first active day >= source day; uncollected by day 33 -> lost
  const p = pVec.map(x => Math.min(0.99, x * (mult || 1)));
  const out = zeros(); let lost = 0;
  w.forEach((m, s) => { if (!m) return; let rem = m;
    for (let d = s; d < D; d++) { const take = rem * p[d]; out[d] += take; rem -= take; }
    lost += rem; });
  return { w: out, lost };
}
function allocate(cellKey, cat, res, o) {
  const ci = cellInfo[cellKey], comps = components(cellKey, cat, res, o);
  const out = zeros(); let lost = 0;
  comps.forEach(c => {
    let w = c.w.slice(); if (w.length > D) { for (let d = D; d < w.length; d++) { if (o.pastEnd === 'fold33') w[D - 1] += w[d]; else lost += w[d]; } w.length = D; }
    const settle = (!c.exempt && c.kind === 'lump') ? ((o.settle && o.settle[cat] != null) ? o.settle[cat] : (o.settleAll || 0)) : 0;
    if (settle > 0) { const r = shiftW(w, settle, o.pastEnd); w = r.w; lost += r.lost; }
    const col = !c.exempt && (o.collect === 'all' || (o.collect === 'lumps' && c.kind === 'lump'));
    if (col) { const r = collectW(w, ci.pVec, o.collectMult); w = r.w; lost += r.lost; }
    // CONTROL, not a model: a symmetric centred box of width 3/5/7 on the same components T2 'all'
    // touches. If it fits as well as the forward-only attendance kernel, TV is rewarding smoothing
    // (a population average of staggered players) rather than a collection lag.
    if (!c.exempt && /^box\d$/.test(String(o.collect))) { const h = (+o.collect.slice(3) - 1) / 2, b = zeros();
      w.forEach((m, s) => { if (!m) return; const lo = Math.max(0, s - h), hi = Math.min(D - 1, s + h); for (let d = lo; d <= hi; d++) b[d] += m / (2 * h + 1); lost += m * (1 - (hi - lo + 1) / (2 * h + 1)); });
      w = b; }
    for (let d = 0; d < D; d++) out[d] += w[d];
  });
  if (o.pastEnd === 'drop') return { w: out, lost };
  const s = sum(out);
  return { w: s > 0 ? out.map(x => x / s) : normalize_(out), lost };
}

// ---- evaluation ----
function evaluate(o, keepSeries) {
  const rows = [], series = {};
  CELLS.forEach(({ seg, payer }) => { const k = seg + ' ' + payer;
    RES.forEach(res => {
      const cs = catSeries[k][res], s = zeros(), byCat = {};
      Object.keys(cs.cats).forEach(cat => { const t = catTotals[k][cat][res]; const a = allocate(k, cat, res, o); const ser = a.w.map(x => x * t); byCat[cat] = ser; for (let d = 0; d < D; d++) s[d] += ser[d]; });
      const sA = sum(cs.a), sS = sum(s), sh = (sA > 0 && sS > 0) ? s.map(x => x * sA / sS) : s;
      const base = allMetrics.find(m => m.cell === k && m.res === res);
      rows.push({ cell: k, res, sum_actual: sA, sum_sim: sS, tv: tv(cs.a, s), mape: mape(cs.a, s), mape_shape: mape(cs.a, sh), tv_base: base.tv, mape_base: base.mape, mape_shape_base: base.mape_shape });
      if (keepSeries) { series[k] = series[k] || {}; series[k][res] = { sim: s, byCat }; }
    }); });
  const def = rows.filter(r => r.tv != null && r.tv_base != null);
  const res = { tv: agg(rows, 'tv'), mape: agg(rows, 'mape'), mape_shape: agg(rows, 'mape_shape'),
    improved: def.filter(r => r.tv < r.tv_base - 1e-9).length, worsened: def.filter(r => r.tv > r.tv_base + 1e-9).length, unchanged: def.filter(r => Math.abs(r.tv - r.tv_base) <= 1e-9).length,
    per_resource: RES.reduce((acc, rr) => { const q = rows.filter(r => r.res === rr); acc[rr] = { tv: agg(q, 'tv').unweighted_mean, tv_base: agg(q, 'tv_base').unweighted_mean, mape_shape: agg(q, 'mape_shape').unweighted_mean }; return acc; }, {}),
    per_cell: CELLS.reduce((acc, c) => { const k = c.seg + ' ' + c.payer, q = rows.filter(r => r.cell === k); acc[k] = { tv: agg(q, 'tv').unweighted_mean, tv_base: agg(q, 'tv_base').unweighted_mean }; return acc; }, {}),
    conserved_maxabs: r6(Math.max(...rows.map(r => { const b = allMetrics.find(m => m.cell === r.cell && m.res === r.res); return Math.abs(r.sum_sim - b.sum_sim); }))) };
  if (keepSeries) res.series = series;
  res.rows = rows;
  return res;
}
const BASE_TV = P.result.baseline_fit.overall.tv.unweighted_mean;
const BASE_MAPE = P.result.baseline_fit.overall.mape.unweighted_mean;
const BASE_MAPE_SHAPE = P.result.baseline_fit.overall.mape_shape.unweighted_mean;
const BASE_TV_MW = P.result.baseline_fit.overall.tv.actual_mass_weighted;
const pct = (b, x) => r6(100 * (b - x) / b);
function summarise(name, ev, extra) {
  return Object.assign({ name, tv_baseline: r6(BASE_TV), tv_alone: r6(ev.tv.unweighted_mean), improvement_pct: pct(BASE_TV, ev.tv.unweighted_mean),
    tv_mass_weighted: { baseline: r6(BASE_TV_MW), alone: r6(ev.tv.actual_mass_weighted) }, tv_median: { baseline: r6(P.result.baseline_fit.overall.tv.quantiles.median), alone: ev.tv.quantiles.median },
    mape_baseline: r6(BASE_MAPE), mape_alone: r6(ev.mape.unweighted_mean), mape_improvement_pct: pct(BASE_MAPE, ev.mape.unweighted_mean),
    mape_shape_baseline: r6(BASE_MAPE_SHAPE), mape_shape_alone: r6(ev.mape_shape.unweighted_mean), mape_shape_improvement_pct: pct(BASE_MAPE_SHAPE, ev.mape_shape.unweighted_mean),
    improved_pairs: ev.improved, worsened_pairs: ev.worsened, unchanged_pairs: ev.unchanged, conserved_maxabs: ev.conserved_maxabs,
    per_resource_tv: RES.reduce((o, r) => { o[r] = { baseline: r6(ev.per_resource[r].tv_base), alone: r6(ev.per_resource[r].tv) }; return o; }, {}) }, extra || {});
}
const BASE_OPTS = { settleAll: 0, collect: 'none', collectMult: 1, t3s: {}, t3mode: 'instance', t4: 'off', t5: false, pastEnd: 'renorm' };
const out = { _meta: { probe: 'harness/_probe_daily_alloc_toggles.js', requires: 'harness/_probe_daily_alloc.js', run: new Date().toISOString(), data: P.result._meta.data, data_meta: P.result._meta.data_meta, engine: P.result._meta.engine },
  activity_rates_used: CELLS.reduce((o, c) => { const k = c.seg + ' ' + c.payer; o[k] = { weekday: cellInfo[k].pWd, weekend: cellInfo[k].pWe, expected_active_days: r6(sum(cellInfo[k].pVec)) }; return o; }, {}),
  baseline: { tv: P.result.baseline_fit.overall.tv, mape: P.result.baseline_fit.overall.mape, mape_shape: P.result.baseline_fit.overall.mape_shape } };

// 0. self-check: all toggles off == engine
const rebuilt = evaluate(BASE_OPTS, true);
let rebuildMax = 0;
CELLS.forEach(({ seg, payer }) => { const k = seg + ' ' + payer; RES.forEach(res => { const cs = catSeries[k][res]; Object.keys(cs.cats).forEach(cat => { const ser = rebuilt.series[k][res].byCat[cat]; for (let d = 0; d < D; d++) rebuildMax = Math.max(rebuildMax, Math.abs(ser[d] - cs.cats[cat][d])); }); }); });
out.self_check = { rebuilt_vs_engine_dailySeries_maxabs: r6(rebuildMax), tv_rebuilt: r6(rebuilt.tv.unweighted_mean), tv_engine: r6(BASE_TV) };

// ---- T1 SETTLE+1 ----
const t1 = evaluate(Object.assign({}, BASE_OPTS, { settleAll: 1 }));
const t1drop = evaluate(Object.assign({}, BASE_OPTS, { settleAll: 1, pastEnd: 'drop' }));
const t1fold = evaluate(Object.assign({}, BASE_OPTS, { settleAll: 1, pastEnd: 'fold33' }));
// per-category settle choice (empirical): each DAILY_LASTDAY category alone at +1, others at 0
const lastdayCats = Object.keys(DAILY_LASTDAY).filter(c => CELLS.some(cl => catList[cl.seg + ' ' + cl.payer].indexOf(c) >= 0));
const t1percat = {};
lastdayCats.forEach(cat => { const ev = evaluate(Object.assign({}, BASE_OPTS, { settle: { [cat]: 1 } }));
  const aff = ev.rows.filter(r => catTotals[r.cell][cat] && catTotals[r.cell][cat][r.res]);
  t1percat[cat] = { tv_all: r6(ev.tv.unweighted_mean), tv_affected_pairs: r6(mean(aff.map(r => r.tv))), tv_affected_base: r6(mean(aff.map(r => r.tv_base))), affected_pairs: aff.length, improved: ev.improved, worsened: ev.worsened,
                    mass_share_of_actual: r6(mean(aff.map(r => catTotals[r.cell][cat][r.res] / Math.max(1e-9, r.sum_actual)))) }; });
out.T1 = summarise('T1 SETTLE+1', t1, {
  what_it_does: 'every DAILY_LASTDAY lump moves from the instance last day to last day + 1; mass past day 33 renormalised over 1..33',
  variants: { renorm: { tv: r6(t1.tv.unweighted_mean), mape: r6(t1.mape.unweighted_mean), mape_shape: r6(t1.mape_shape.unweighted_mean) },
              drop_past_33: { tv: r6(t1drop.tv.unweighted_mean), mape: r6(t1drop.mape.unweighted_mean), note: 'TV is scale-free so it equals renorm; only the level (MAPE) differs; sum of sim days then < window total' },
              fold_onto_day_33: { tv: r6(t1fold.tv.unweighted_mean), mape: r6(t1fold.mape.unweighted_mean), note: 'stage-1 E2 semantics' } },
  per_category_plus1_alone: t1percat });

// ---- T2 COLLECT (all non-always-on) and T2b (lumps only), rate multiplier sweep ----
const MULTS = [1, 1.25, 1.5, 2, 2.5, 3];
const t2sweep = {}, t2bsweep = {};
MULTS.forEach(m => { t2sweep[m] = evaluate(Object.assign({}, BASE_OPTS, { collect: 'all', collectMult: m })); t2bsweep[m] = evaluate(Object.assign({}, BASE_OPTS, { collect: 'lumps', collectMult: m })); });
const bestM = (sw) => MULTS.reduce((b, m) => sw[m].tv.unweighted_mean < sw[b].tv.unweighted_mean ? m : b, MULTS[0]);
const m2 = bestM(t2sweep), m2b = bestM(t2bsweep);
const kernelStats = CELLS.reduce((o, c) => { const k = c.seg + ' ' + c.payer, p = cellInfo[k].pVec; // E[lag] for a day-1 grant under the raw rates (no truncation)
  let rem = 1, el = 0; for (let d = 0; d < D; d++) { el += d * rem * p[d]; rem *= (1 - p[d]); } o[k] = { p_same_day: r6(p[0]), expected_lag_days: r6(el / (1 - rem)), uncollected_by_day33_from_day1: r6(rem) }; return o; }, {});
out.T2 = summarise('T2 COLLECT (all non-always-on)', t2sweep[1], {
  what_it_does: 'every non-always-on component convolved with the attendance kernel P(collect on s+k) = p_(s+k) PROD_(j<k)(1-p_(s+j)); truncated at day 33 and renormalised',
  mult_sweep: MULTS.reduce((o, m) => { o[m] = { tv: r6(t2sweep[m].tv.unweighted_mean), mape_shape: r6(t2sweep[m].mape_shape.unweighted_mean), improved: t2sweep[m].improved, worsened: t2sweep[m].worsened }; return o; }, {}),
  best_mult: m2, tv_at_best_mult: r6(t2sweep[m2].tv.unweighted_mean), improvement_pct_at_best_mult: pct(BASE_TV, t2sweep[m2].tv.unweighted_mean),
  kernel_at_mult_1: kernelStats });
out.T2b = summarise('T2b COLLECT (rank lumps only)', t2bsweep[1], {
  what_it_does: 'the same kernel applied ONLY to DAILY_LASTDAY lumps; milestone / accrual / p_day-placed mass is collected same-day by construction',
  mult_sweep: MULTS.reduce((o, m) => { o[m] = { tv: r6(t2bsweep[m].tv.unweighted_mean), mape_shape: r6(t2bsweep[m].mape_shape.unweighted_mean), improved: t2bsweep[m].improved, worsened: t2bsweep[m].worsened }; return o; }, {}),
  best_mult: m2b, tv_at_best_mult: r6(t2bsweep[m2b].tv.unweighted_mean), improvement_pct_at_best_mult: pct(BASE_TV, t2bsweep[m2b].tv.unweighted_mean) });

// ---- T3 LEADERBOARD CURVES: milestone share s sweep per category ----
const S_GRID = [0, 0.25, 0.5, 0.75, 1];
function t3sweep(baseOpts, label) {
  const table = {}, best = {};
  Object.keys(T3_CURVE).forEach(cat => {
    if (!CELLS.some(cl => catList[cl.seg + ' ' + cl.payer].indexOf(cat) >= 0)) return;
    table[cat] = {};
    S_GRID.forEach(s => { const o = Object.assign({}, baseOpts, { t3s: Object.assign({}, baseOpts.t3s || {}, { [cat]: s }) }); const ev = evaluate(o);
      const aff = ev.rows.filter(r => catTotals[r.cell][cat] && catTotals[r.cell][cat][r.res]);
      table[cat][s] = { tv_all: r6(ev.tv.unweighted_mean), tv_affected_pairs: r6(mean(aff.map(r => r.tv))), affected_pairs: aff.length }; });
    const vals = S_GRID.map(s => table[cat][s].tv_all), mn = Math.min(...vals), mx = Math.max(...vals);
    best[cat] = { s: S_GRID[vals.indexOf(mn)], tv_all: r6(mn), spread_over_grid: r6(mx - mn), no_op: mx - mn < 1e-9 };
  });
  return { label, table, best };
}
const t3alone = t3sweep(BASE_OPTS, 'T3 alone (no settle, no collect): s only changes PLACEMENT');
const t3aloneBest = {}; Object.keys(t3alone.best).forEach(c => { t3aloneBest[c] = t3alone.best[c].s; });
const t3ev = evaluate(Object.assign({}, BASE_OPTS, { t3s: t3aloneBest }));
const t3curvelen = evaluate(Object.assign({}, BASE_OPTS, { t3mode: 'curvelen', t3s: Object.keys(T3_CURVE).reduce((o, c) => { o[c] = 1; return o; }, {}) }));
const t3curvelen0 = evaluate(Object.assign({}, BASE_OPTS, { t3mode: 'curvelen', t3s: {} }));
const instDur = Object.keys(T3_CURVE).reduce((o, cat) => { const ins = P.calCurInst(cat); const cv = ctx.ds.accrualCurve(T3_CURVE[cat], '20-39', 'NONPAYER', false);
  o[cat] = { cal_curr_instance_days: ins.map(i => i.days.length), curve_length_days: cv.length ? cv[cv.length - 1].day : null, curve_day1_share_20_39_NP: cv.length ? r6(cv[0].share) : null }; return o; }, {});
out.T3 = summarise('T3 LEADERBOARD CURVES', t3ev, {
  what_it_does: 'for DAILY_LASTDAY categories with a data_event_accrual curve, a MILESTONE share s of each instance is placed along the marginal of cum_token_share (settle 0, collected same-day under T2b) and 1-s stays the end lump; s swept per category - an EMPIRICAL CALIBRATION, not the model (the model needs packRungs_/rewardE_ ladder pricing per resource)',
  instance_vs_curve_lengths: instDur,
  sweep_alone: t3alone, best_s_alone: t3aloneBest,
  curvelen_variant: { note: 'place along the curve over its OWN length (instance_length_days) starting on the grid day, so a 1-day grid instance with a 2-day curve pays ~93% on day d and ~7% on d+1, and its lump moves to d+1 - this is the mechanism behind T1 for these events (a 1-day event that starts mid-day ends on the next calendar date)',
                      tv_s1_all_curve_cats: r6(t3curvelen.tv.unweighted_mean), tv_s0_lump_at_curve_end: r6(t3curvelen0.tv.unweighted_mean), improvement_pct_s1: pct(BASE_TV, t3curvelen.tv.unweighted_mean), improvement_pct_s0: pct(BASE_TV, t3curvelen0.tv.unweighted_mean) } });

// ---- T2 control: symmetric smoothing of the same scope as T2 'all' ----
const boxCtl = {}; ['box3', 'box5', 'box7'].forEach(b => { const ev = evaluate(Object.assign({}, BASE_OPTS, { collect: b })); boxCtl[b] = { tv: r6(ev.tv.unweighted_mean), improved: ev.improved, worsened: ev.worsened };
  const e1 = evaluate(Object.assign({}, BASE_OPTS, { settleAll: 1, collect: b })); boxCtl['T1+' + b] = { tv: r6(e1.tv.unweighted_mean), improved: e1.improved, worsened: e1.worsened }; });
MULTS.forEach(m => { const e = evaluate(Object.assign({}, BASE_OPTS, { settleAll: 1, collect: 'all', collectMult: m })); boxCtl['T1+T2all@' + m] = { tv: r6(e.tv.unweighted_mean), improved: e.improved, worsened: e.worsened }; });
out.T2.symmetric_smoothing_control = Object.assign({ note: 'centred box on every non-always-on component (same scope as T2 all); a model-free smoother that also moves mass EARLIER, which a payout cannot do. If it matches T2, the TV gain is de-lumping a population average, not a collection lag; the T1+box vs T1+T2 rows ask the same question after the rank lumps have been moved to their settle day.' }, boxCtl);

// ---- T4 SEASON PASS tier crossings ----
const T4_VARIANTS = ['sptproxy', 'linear', 'sptproxy_spread', 'linear_spread', 'sptproxy_actualspt', 'sptproxy_spread_actualspt'];
const t4ev = {}; T4_VARIANTS.forEach(v => { t4ev[v] = evaluate(Object.assign({}, BASE_OPTS, { t4: v })); });
const t4best = T4_VARIANTS.reduce((b, v) => t4ev[v].tv.unweighted_mean < t4ev[b].tv.unweighted_mean ? v : b, T4_VARIANTS[0]);
const t4lin = t4ev.linear, t4spt = t4ev.sptproxy;
const spTierInfo = CELLS.reduce((o, c) => { const k = c.seg + ' ' + c.payer, ci = cellInfo[k]; const insts = P.calCurInst('Season Pass (Free)').slice().sort((a, b) => a.days[0] - b.days[0]);
  const rate = ci.sptMeas / sum(ci.pVec); o[k] = { spt_window_total_incl_synthetic_core: r6(ci.sptMeas), tiers_reached_per_instance: insts.map(i => spTier_(rate * sum(i.days.map(ci.pDay)), spTrack.cum)), tier_cap: spTrack.cum.length }; return o; }, {});
out.T4 = summarise('T4 SEASON PASS', t4ev[t4best], {
  what_it_does: 'Season Pass (Free)/(Paid) mass placed on tier-crossing days instead of p_day over the lane; per resource the tier masses are the base SP track rewards of that resource (equal per tier when the track pays none of it); each cal_curr pass instance is its own season',
  route: 'spPackTiers_ IS callable offline but returns 0 entries on this dump (no envelope authored on the SP ladder; it also places tiers linearly in days, not by points). Used instead: cumulative p_day as the SPT proxy - window SPT total from sptTotals_(seg,payer,ctx).meas (includes the D18 synthetic Core anchor) accrued prop p_day, tier i on the first day the running total reaches SP.cum[i]. The engine-linear rule, a continuous-accrual (_spread) form and the ACTUAL SPT total (_actualspt, data_econ_daily sum) are reported as alternatives.',
  variants: T4_VARIANTS.reduce((o, v) => { o[v] = { tv: r6(t4ev[v].tv.unweighted_mean), mape_shape: r6(t4ev[v].mape_shape.unweighted_mean), improved: t4ev[v].improved, worsened: t4ev[v].worsened }; return o; }, {}),
  best_variant: t4best, sp_track: { tiers: spTrack.cum.length, cum_first_last: [spTrack.cum[0], spTrack.cum[spTrack.cum.length - 1]], season_days_on_sheet: readSPSeasonDays_('SP'), cal_curr_lane: P.calCurInst('Season Pass (Free)').map(i => i.days[0] + '..' + i.days[i.days.length - 1]),
              free_track_hc_by_tier: spTrack.free.map(r => num(r['HC'])), paid_track_hc_by_tier: spTrack.paid.map(r => num(r['HC'])) },
  per_cell_tiers: spTierInfo, actual_spt_window_total: CELLS.reduce((o, c) => { const k = c.seg + ' ' + c.payer; o[k] = r6(sum(catSeries[k]['SPT'].a)); return o; }, {}),
  stage1_E3_sigma_p_for_reference: r6(P.result.experiments.runs['E3 SP sigma-p'].tv.unweighted_mean) });

// ---- T5 FLAT -> p_day ----
const t5 = evaluate(Object.assign({}, BASE_OPTS, { t5: true }));
out.T5 = summarise('T5 FLAT->p_day', t5, { what_it_does: 'categories with no cal_curr instance (Ads, Other, IAPs, FlowerCoop, River Rush, Rainbow Maker where present) spread prop p_day instead of 1/33',
  flat_categories_per_cell: P.result.flat_branch });

// ---- T3 under the Opus-plan structure (T1 + T2b): the milestone share is what skips settle AND collect ----
const t3t1t2b = t3sweep(Object.assign({}, BASE_OPTS, { settleAll: 1, collect: 'lumps', collectMult: m2b, t5: true }), 'T3 under T1 + T2b(lumps only) + T5: s decides which share is paid same-day (milestone) vs settled +1 and collected (rank)');
out.T3.sweep_under_T1_T2b = t3t1t2b;

// ---- COMBINED ----
// (a) AS SPECIFIED: every toggle on, each at its best parameters (T4 at its least-bad variant even
//     though it loses alone). (b) BEST COMBINATION: coordinate descent over the same toggle set with
//     'off' allowed for each, so a toggle that hurts is left out. Both report ablations.
function describe(o) { return { settle: o.settleAll ? '+1 on every DAILY_LASTDAY lump (T1)' : 'off', collect: o.collect, collect_rate_multiplier: o.collect === 'none' ? null : o.collectMult, t3_milestone_share_s: o.t3s, t4: o.t4, t5: !!o.t5, pastEnd: o.pastEnd }; }
function report(o, label) {
  const ev = evaluate(o, true), ablations = {};
  [['T1', { settleAll: 0 }], ['T2', { collect: 'none' }], ['T3', { t3s: {} }], ['T4', { t4: 'off' }], ['T5', { t5: false }]].forEach(([k, patch]) => {
    const on = (k === 'T1' && o.settleAll) || (k === 'T2' && o.collect !== 'none') || (k === 'T3' && Object.keys(o.t3s).some(c => o.t3s[c] > 0)) || (k === 'T4' && o.t4 !== 'off') || (k === 'T5' && o.t5);
    if (!on) { ablations['without_' + k] = { tv: null, note: 'not in this combination' }; return; }
    const e2 = evaluate(Object.assign({}, o, patch)); ablations['without_' + k] = { tv: r6(e2.tv.unweighted_mean), tv_loss_vs_combined: r6(e2.tv.unweighted_mean - ev.tv.unweighted_mean) }; });
  const settle = {};
  if (o.settleAll) lastdayCats.forEach(cat => { const ev0 = evaluate(Object.assign({}, o, { settle: { [cat]: 0 } })); settle[cat] = { tv_if_this_category_settles_0: r6(ev0.tv.unweighted_mean), prefers: ev0.tv.unweighted_mean < ev.tv.unweighted_mean - 1e-9 ? '0' : '+1' }; });
  return { label, params: describe(o), ev,
    summary: { tv_baseline: r6(BASE_TV), tv_combined: r6(ev.tv.unweighted_mean), improvement_pct: pct(BASE_TV, ev.tv.unweighted_mean),
      tv_mass_weighted: { baseline: r6(BASE_TV_MW), combined: r6(ev.tv.actual_mass_weighted) }, tv_quantiles: ev.tv.quantiles,
      mape_baseline: r6(BASE_MAPE), mape_combined: r6(ev.mape.unweighted_mean), mape_shape_baseline: r6(BASE_MAPE_SHAPE), mape_shape_combined: r6(ev.mape_shape.unweighted_mean),
      improved_pairs: ev.improved, worsened_pairs: ev.worsened, unchanged_pairs: ev.unchanged, conserved_maxabs: ev.conserved_maxabs,
      per_resource_tv: RES.reduce((acc, r) => { acc[r] = { baseline: r6(ev.per_resource[r].tv_base), combined: r6(ev.per_resource[r].tv), mape_shape: r6(ev.per_resource[r].mape_shape) }; return acc; }, {}),
      per_cell_tv: ev.per_cell,
      tv_within_noise: { le_1x_tv_ma7: ev.rows.filter(r => { const b = allMetrics.find(m => m.cell === r.cell && m.res === r.res); return b.tv_ma7 != null && r.tv <= b.tv_ma7; }).length,
                         le_2x_tv_ma7: ev.rows.filter(r => { const b = allMetrics.find(m => m.cell === r.cell && m.res === r.res); return b.tv_ma7 != null && r.tv <= 2 * b.tv_ma7; }).length, n: 130,
                         baseline_le_1x: P.result.noise_floor.tv_within_noise.le_1x_tv_ma7, baseline_le_2x: P.result.noise_floor.tv_within_noise.le_2x_tv_ma7 } },
    ablations, per_category_settle: settle, curvelen_variant_tv: r6(evaluate(Object.assign({}, o, { t3mode: 'curvelen' })).tv.unweighted_mean) };
}
// (a) as specified
const t2choice = (t2sweep[m2].tv.unweighted_mean <= t2bsweep[m2b].tv.unweighted_mean) ? { collect: 'all', collectMult: m2 } : { collect: 'lumps', collectMult: m2b };
let specOpts = Object.assign({}, BASE_OPTS, { settleAll: 1 }, t2choice, { t4: t4best, t5: true, t3s: {} });
const t3spec = t3sweep(specOpts, 'T3 under T1 + best T2 + best T4 + T5');
const t3specBest = {}; Object.keys(t3spec.best).forEach(c => { t3specBest[c] = t3spec.best[c].s; });
specOpts = Object.assign({}, specOpts, { t3s: t3specBest });
const specT2 = {}; ['all', 'lumps'].forEach(mode => MULTS.forEach(m => { specT2[mode + '@' + m] = r6(evaluate(Object.assign({}, specOpts, { collect: mode, collectMult: m })).tv.unweighted_mean); }));
const specKey = Object.keys(specT2).reduce((b, k) => specT2[k] < specT2[b] ? k : b, Object.keys(specT2)[0]);
specOpts = Object.assign({}, specOpts, { collect: specKey.split('@')[0], collectMult: +specKey.split('@')[1] });
const spec = report(specOpts, 'ALL TOGGLES ON, as specified (T4 at its least-bad variant)');
spec.t3_sweep = t3spec; spec.t2_recheck = specT2;
// (b) best combination by coordinate descent, 'off' allowed everywhere
const COORDS = [
  { name: 'T1', values: [{ settleAll: 0 }, { settleAll: 1 }] },
  { name: 'T2', values: [{ collect: 'none' }].concat(['all', 'lumps'].flatMap(mode => MULTS.map(m => ({ collect: mode, collectMult: m })))) },
  { name: 'T4', values: ['off'].concat(T4_VARIANTS).map(v => ({ t4: v })) },
  { name: 'T5', values: [{ t5: false }, { t5: true }] },
].concat(Object.keys(T3_CURVE).filter(c => CELLS.some(cl => catList[cl.seg + ' ' + cl.payer].indexOf(c) >= 0)).map(cat => ({ name: 'T3 ' + cat, values: S_GRID.map(s => ({ t3s_cat: cat, s })) })));
function applyCoord(o, v) { if (v.t3s_cat) return Object.assign({}, o, { t3s: Object.assign({}, o.t3s, { [v.t3s_cat]: v.s }) }); return Object.assign({}, o, v); }
let bestOpts = Object.assign({}, BASE_OPTS), bestTv = BASE_TV, passes = 0, trace = [];
for (;;) { let moved = false; passes++;
  COORDS.forEach(c => { let cb = null, cbTv = bestTv;
    c.values.forEach(v => { const o = applyCoord(bestOpts, v), t = evaluate(o).tv.unweighted_mean; if (t < cbTv - 1e-9) { cbTv = t; cb = o; } });
    if (cb) { bestOpts = cb; bestTv = cbTv; moved = true; trace.push(c.name + ' -> ' + r6(cbTv)); } });
  if (!moved || passes >= 4) break; }
const best = report(bestOpts, 'BEST COMBINATION (coordinate descent, off allowed)');
best.descent = { passes, trace };
const combined = best.ev;   // the samples and T6 use the best combination
out.all_combined = {
  headline: { tv_baseline: r6(BASE_TV), tv_all_toggles_as_specified: spec.summary.tv_combined, tv_best_combination: best.summary.tv_combined, improvement_pct_best: best.summary.improvement_pct, improvement_pct_as_specified: spec.summary.improvement_pct },
  as_specified: { label: spec.label, params: spec.params, summary: spec.summary, ablations: spec.ablations, per_category_settle: spec.per_category_settle, t3_sweep: spec.t3_sweep, t2_recheck: spec.t2_recheck, curvelen_variant_tv: spec.curvelen_variant_tv },
  best_combination: { label: best.label, params: best.params, summary: best.summary, ablations: best.ablations, per_category_settle: best.per_category_settle, descent: best.descent, curvelen_variant_tv: best.curvelen_variant_tv },
};

// ---- T6 ALIGNMENT: shift the ACTUAL series, sim untouched (baseline and combined) ----
function shiftA(a, k) { const o = zeros(); for (let d = 0; d < D; d++) { const j = d - k; if (j >= 0 && j < D) o[d] = a[j]; } return o; }
function shiftTest(simSeriesOf) { const o = {}; [-1, 0, 1].forEach(k => { const xs = []; CELLS.forEach(c => { const ck = c.seg + ' ' + c.payer; RES.forEach(res => { const a = catSeries[ck][res].a; const v = tv(shiftA(a, k), simSeriesOf(ck, res)); if (v != null) xs.push(v); }); }); o[k] = r6(mean(xs)); }); return o; }
const baseSim = (ck, res) => rebuilt.series[ck][res].sim, combSim = (ck, res) => combined.series[ck][res].sim;
const t1Sim = (() => { const ev = evaluate(Object.assign({}, BASE_OPTS, { settleAll: 1 }), true); return (ck, res) => ev.series[ck][res].sim; })();
// sim-free: where the actuals spike relative to each last-day category's instance END days (value / window mean), pooled over the (cell, resource) pairs the category pays
const spike = {};
lastdayCats.forEach(cat => { const insts = P.calCurInst(cat); if (!insts.length) return; const ends = insts.map(i => Math.max(...i.days)), starts = insts.map(i => Math.min(...i.days));
  const acc = { end: [], end_plus_1: [], end_plus_2: [], start: [], other: [] };
  CELLS.forEach(c => { const ck = c.seg + ' ' + c.payer; if (!catTotals[ck][cat]) return; RES.forEach(res => { if (!catTotals[ck][cat][res]) return; const a = catSeries[ck][res].a, mu = mean(a); if (!(mu > 0)) return;
    const tag = (d) => ends.indexOf(d) >= 0 ? 'end' : ends.indexOf(d - 1) >= 0 ? 'end_plus_1' : ends.indexOf(d - 2) >= 0 ? 'end_plus_2' : starts.indexOf(d) >= 0 ? 'start' : 'other';
    const g = { end: [], end_plus_1: [], end_plus_2: [], start: [], other: [] }; for (let d = 1; d <= D; d++) g[tag(d)].push(a[d - 1] / mu);
    Object.keys(g).forEach(t => { if (g[t].length) acc[t].push(mean(g[t])); });
    ends.forEach(e => { acc['e' + e] = acc['e' + e] || []; acc['e' + e].push(a[e - 1] / mu); if (e < D) { acc['e' + e + '+1'] = acc['e' + e + '+1'] || []; acc['e' + e + '+1'].push(a[e] / mu); } }); }); });
  // per end day too: Bomb Challenge / Level Race run on days 4,13,20,27 and 13/20/27 are ALSO Team Race's end+1 (Mondays), so
  // only their day-4 instance (a Saturday, no other payout due) separates "same day" from "the Monday Team Race spike"
  const perEnd = {}; ends.forEach(e => { perEnd[e] = { end: r6(mean(acc['e' + e])), end_plus_1: acc['e' + e + '+1'] ? r6(mean(acc['e' + e + '+1'])) : null }; });
  spike[cat] = { instance_end_days: ends, pairs: acc.end.length, actual_over_mean: ['end', 'end_plus_1', 'end_plus_2', 'start', 'other'].reduce((o, t) => { o[t] = acc[t].length ? r6(mean(acc[t])) : null; return o; }, {}), per_end_day: perEnd }; });
// edge diagnostic for the stage-1 lag scan: shifting the SIM by +1 pushes its day-33 lumps (Team Race,
// Kite Festival, Flash Race all end on day 33) out of the window, so part of that scan's '+1 fits
// better' can be the pile-up leaving rather than the timing - measured here by zeroing day 33 alone.
const dropLast = (s) => { const o = s.slice(); o[D - 1] = 0; return o; };
const tvAll = (fnA, fnS) => { const xs = []; CELLS.forEach(c => { const ck = c.seg + ' ' + c.payer; RES.forEach(res => { const v = tv(fnA(ck, res), fnS(ck, res)); if (v != null) xs.push(v); }); }); return r6(mean(xs)); };
const day33 = { baseline: r6(BASE_TV), sim_day33_zeroed: tvAll((ck, res) => catSeries[ck][res].a, (ck, res) => dropLast(baseSim(ck, res))), actual_day33_zeroed: tvAll((ck, res) => dropLast(catSeries[ck][res].a), baseSim),
  sim_shift_plus1_as_in_stage1: P.result.baseline_fit.lag_scan.mean_tv_by_lag[1], sim_day33_share_of_window_mean_over_pairs: r6(mean(CELLS.flatMap(c => RES.map(res => { const s = baseSim(c.seg + ' ' + c.payer, res); const t = sum(s); return t > 0 ? s[D - 1] / t : 0; })))),
  actual_day33_share_of_window_mean_over_pairs: r6(mean(CELLS.flatMap(c => RES.map(res => { const a = catSeries[c.seg + ' ' + c.payer][res].a; const t = sum(a); return t > 0 ? a[D - 1] / t : 0; })))) };
out.T6 = { what_it_does: 'the ACTUAL series shifted by k days (k=+1: actual moved one day LATER, i.e. a[d] <- a[d-1]; k=-1: earlier), sim untouched, window-truncated; TV against the baseline sim, the T1-only sim and the best-combination sim',
  tv_by_actual_shift: { baseline_sim: shiftTest(baseSim), t1_settle_plus1_sim: shiftTest(t1Sim), combined_sim: shiftTest(combSim) },
  stage1_sim_lag_scan_for_reference: P.result.baseline_fit.lag_scan.mean_tv_by_lag,
  day33_edge_diagnostic: day33,
  actual_spikes_vs_instance_end_days: spike,
  weekday_weekend_rates_note: 'data_seg_beh weekday vs weekend rates in this dump differ by < 0.03, so always-on sources carry almost no day-of-week signal; the day-axis test rests on the event lumps' };

// ---- the four samples under the combined allocation ----
out.samples_new = P.SAMPLES.map(sm => { const ck = sm.seg + ' ' + sm.payer, d = sm.day - 1, cs = catSeries[ck][sm.res]; const sNew = combined.series[ck][sm.res], sOld = rebuilt.series[ck][sm.res];
  const act = cs.a[d], nw = sNew.sim[d], old = sOld.sim[d];
  const rowNew = combined.rows.find(r => r.cell === ck && r.res === sm.res), rowOld = allMetrics.find(m => m.cell === ck && m.res === sm.res);
  return { cell: ck, resource: sm.res, day: sm.day, weekend: isWeekend_(sm.day), actual: r6(act), sim_new: r6(nw), delta: r6(nw - act), delta_pct: act > 0 ? r6(100 * (nw - act) / act) : null,
    sim_old: r6(old), delta_old: r6(old - act), delta_old_pct: act > 0 ? r6(100 * (old - act) / act) : null, actual_ma7: r6(ma7(cs.a)[d]),
    window: { tv_old: r6(rowOld.tv), tv_new: r6(rowNew.tv), tv_noise_ma7: r6(rowOld.tv_ma7), mape_shape_old: r6(rowOld.mape_shape), mape_shape_new: r6(rowNew.mape_shape), level_ratio: r6(rowOld.level_ratio) },
    composition_new: Object.keys(sNew.byCat).map(cat => ({ category: cat, value: r6(sNew.byCat[cat][d]), was: r6(sOld.byCat[cat][d]) })).filter(x => x.value || x.was).sort((p, q) => q.value - p.value) }; });

// ---- ranking ----
const toggles = [out.T1, out.T2, out.T2b, out.T3, out.T4, out.T5];
const rankRows = [ { name: 'T1 SETTLE+1', tv: out.T1.tv_alone }, { name: 'T2 COLLECT all (best mult ' + out.T2.best_mult + ')', tv: out.T2.tv_at_best_mult }, { name: 'T2b COLLECT lumps only (best mult ' + out.T2b.best_mult + ')', tv: out.T2b.tv_at_best_mult },
  { name: 'T3 LEADERBOARD CURVES (best s alone)', tv: out.T3.tv_alone }, { name: 'T4 SEASON PASS (' + t4best + ')', tv: out.T4.tv_alone }, { name: 'T5 FLAT->p_day', tv: out.T5.tv_alone } ];
out.ranking = rankRows.sort((p, q) => p.tv - q.tv).map((r, i) => (i + 1) + '. ' + r.name + ': TV ' + r6(r.tv) + ' (' + pct(BASE_TV, r.tv) + '% better than baseline ' + r6(BASE_TV) + ')');
const abl = best.ablations;
out.ablation_ranking = Object.keys(abl).filter(k => abl[k].tv != null).sort((p, q) => abl[q].tv_loss_vs_combined - abl[p].tv_loss_vs_combined).map(k => k + ': TV without it ' + abl[k].tv + ' (+' + abl[k].tv_loss_vs_combined + ' vs best combination ' + best.summary.tv_combined + ')');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const slim = JSON.parse(JSON.stringify(out, (k, v) => (k === 'rows' || k === 'series') ? undefined : v));
fs.writeFileSync(OUT, JSON.stringify(slim, null, 1));

// ---- readable summary ----
const f = (x, n) => x == null ? '   n/a' : (Math.round(x * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n).padStart(7);
console.log('DAILY ALLOCATION TOGGLES  data=' + out._meta.data + '  baseline TV ' + f(BASE_TV, 4) + ' (massw ' + f(BASE_TV_MW, 4) + ')  MAPE ' + f(BASE_MAPE, 3) + '  MAPEshape ' + f(BASE_MAPE_SHAPE, 3));
console.log('self-check: rebuilt baseline vs engine dailySeries_ max abs err ' + out.self_check.rebuilt_vs_engine_dailySeries_maxabs + '  (TV rebuilt ' + out.self_check.tv_rebuilt + ' vs engine ' + out.self_check.tv_engine + ')');
console.log('activity rates in this dump: ' + CELLS.map(c => { const k = c.seg + ' ' + c.payer; return k + ' ' + cellInfo[k].pWd + '/' + cellInfo[k].pWe; }).join('; '));
console.log('\nTOGGLES ALONE                              TV alone   impr%   massw   MAPE    MAPEshape  impr/wors/same');
toggles.forEach(t => console.log('  ' + t.name.padEnd(40) + f(t.tv_alone, 4) + ' ' + f(t.improvement_pct, 1) + ' ' + f(t.tv_mass_weighted.alone, 4) + ' ' + f(t.mape_alone, 3) + ' ' + f(t.mape_shape_alone, 3) + '   ' + t.improved_pairs + '/' + t.worsened_pairs + '/' + t.unchanged_pairs));
console.log('  T1 variants: renorm TV ' + out.T1.variants.renorm.tv + ' MAPE ' + out.T1.variants.renorm.mape + ' | drop TV ' + out.T1.variants.drop_past_33.tv + ' MAPE ' + out.T1.variants.drop_past_33.mape + ' | fold33 TV ' + out.T1.variants.fold_onto_day_33.tv);
console.log('  T1 per-category +1 alone (tv_all / affected pairs base->new): ' + Object.keys(t1percat).map(c => c + ' ' + t1percat[c].tv_all + ' (' + t1percat[c].tv_affected_base + '->' + t1percat[c].tv_affected_pairs + ', n=' + t1percat[c].affected_pairs + ')').join('; '));
console.log('  T2 mult sweep: ' + MULTS.map(m => m + ':' + out.T2.mult_sweep[m].tv).join(' ') + '  best ' + m2 + '   T2b: ' + MULTS.map(m => m + ':' + out.T2b.mult_sweep[m].tv).join(' ') + '  best ' + m2b);
console.log('  T2 kernel at mult 1 (p same day / E[lag] days): ' + CELLS.map(c => { const k = c.seg + ' ' + c.payer; return k + ' ' + kernelStats[k].p_same_day + '/' + kernelStats[k].expected_lag_days; }).join('; '));
console.log('  T3 alone s-sweep: ' + Object.keys(t3alone.best).map(c => c + ' best s=' + t3alone.best[c].s + (t3alone.best[c].no_op ? ' (NO-OP: grid instances 1 day)' : ' spread ' + t3alone.best[c].spread_over_grid)).join('; '));
console.log('  T3 curvelen variant: s=1 TV ' + out.T3.curvelen_variant.tv_s1_all_curve_cats + ', s=0 (lump at curve end) TV ' + out.T3.curvelen_variant.tv_s0_lump_at_curve_end);
console.log('  T2 symmetric box control: ' + Object.keys(boxCtl).map(b => b + ' TV ' + boxCtl[b].tv).join(', ') + '   (T2 all@1 ' + out.T2.mult_sweep[1].tv + ')');
console.log('  T3 under T1+T2b: ' + Object.keys(t3t1t2b.best).map(c => c + ' s=' + t3t1t2b.best[c].s + (t3t1t2b.best[c].no_op ? ' (no-op)' : ' spread ' + t3t1t2b.best[c].spread_over_grid)).join('; '));
console.log('  T4 variants: ' + T4_VARIANTS.map(v => v + ' ' + out.T4.variants[v].tv).join(', ') + '  best ' + t4best + ' (stage-1 E3 sigma-p ' + out.T4.stage1_E3_sigma_p_for_reference + ')');
console.log('  T4 tiers/instance (sptproxy, synthetic-anchored SPT): ' + CELLS.map(c => { const k = c.seg + ' ' + c.payer; return k + ' ' + JSON.stringify(spTierInfo[k].tiers_reached_per_instance); }).join('; '));
console.log('  T4 actual SPT window totals: ' + JSON.stringify(out.T4.actual_spt_window_total) + '  SP cum ladder ' + spTrack.cum[0] + '..' + spTrack.cum[spTrack.cum.length - 1] + ' over ' + spTrack.cum.length + ' tiers');
[spec, best].forEach(cb => {
  console.log('\n' + cb.label + '\n  params ' + JSON.stringify(cb.params));
  console.log('  TV ' + cb.summary.tv_combined + ' (' + cb.summary.improvement_pct + '% better)  massw ' + cb.summary.tv_mass_weighted.combined + '  MAPE ' + cb.summary.mape_combined + '  MAPEshape ' + cb.summary.mape_shape_combined + '  impr/wors/same ' + cb.summary.improved_pairs + '/' + cb.summary.worsened_pairs + '/' + cb.summary.unchanged_pairs + '  conserved maxabs ' + cb.summary.conserved_maxabs);
  console.log('  per-resource TV base->combined: ' + RES.map(r => r + ' ' + cb.summary.per_resource_tv[r].baseline + '->' + cb.summary.per_resource_tv[r].combined).join(', '));
  console.log('  settle per category: ' + Object.keys(cb.per_category_settle).map(c => c + ' ' + cb.per_category_settle[c].prefers + ' (0: ' + cb.per_category_settle[c].tv_if_this_category_settles_0 + ')').join('; '));
  console.log('  ablations: ' + Object.keys(cb.ablations).map(k => k + ' ' + (cb.ablations[k].tv == null ? '(not in)' : cb.ablations[k].tv + ' (+' + cb.ablations[k].tv_loss_vs_combined + ')')).join(' | ') + '  curvelen variant ' + cb.curvelen_variant_tv);
  console.log('  within noise: <=1x ' + cb.summary.tv_within_noise.le_1x_tv_ma7 + ' (base ' + cb.summary.tv_within_noise.baseline_le_1x + '), <=2x ' + cb.summary.tv_within_noise.le_2x_tv_ma7 + ' (base ' + cb.summary.tv_within_noise.baseline_le_2x + ') of 130');
  if (cb.descent) console.log('  descent: ' + cb.descent.passes + ' passes: ' + cb.descent.trace.join(' > '));
});
console.log('\nT6 ALIGNMENT (TV by ACTUAL shift k; +1 = actual later): baseline sim ' + JSON.stringify(out.T6.tv_by_actual_shift.baseline_sim) + '  T1 sim ' + JSON.stringify(out.T6.tv_by_actual_shift.t1_settle_plus1_sim) + '  best-combination sim ' + JSON.stringify(out.T6.tv_by_actual_shift.combined_sim));
console.log('  day-33 edge diagnostic: ' + JSON.stringify(out.T6.day33_edge_diagnostic));
Object.keys(spike).forEach(c => console.log('  spikes ' + c.padEnd(16) + ' ends ' + JSON.stringify(spike[c].instance_end_days).padEnd(28) + ' actual/mean: ' + JSON.stringify(spike[c].actual_over_mean)));
console.log('\nSAMPLES (combined)');
out.samples_new.forEach(s => { console.log('  ' + s.cell + ' / ' + s.resource + ' / day ' + s.day + ': actual ' + s.actual + '  sim_new ' + s.sim_new + ' (' + s.delta_pct + '%)  sim_old ' + s.sim_old + ' (' + s.delta_old_pct + '%)  TV ' + s.window.tv_old + '->' + s.window.tv_new + ' noise ' + s.window.tv_noise_ma7);
  s.composition_new.slice(0, 6).forEach(x => console.log('      ' + x.category.padEnd(22) + f(x.value, 4) + '  was ' + f(x.was, 4))); });
console.log('\nRANKING\n  ' + out.ranking.join('\n  '));
console.log('\nwrote ' + OUT);
