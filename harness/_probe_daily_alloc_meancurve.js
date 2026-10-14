// Daily-allocation probe, stage 3 (2026-10-14): the ACCRUAL-CURVE COLUMN. NOT a gate - a measurement tool.
// The DAILY_MARGINAL family (Hatchling Hideaway, Bomb's Ballet, Jigsaw, Photoshoot) spreads an instance's
// slice over its days by the marginal of the accrual curve the DataStore hands it, and the DataStore
// reads `cum_token_share_p50` (EcoGainsSim_v4.gs accIndex). This probe re-runs the SAME engine with
// `innerWeights_` re-pointed at `cum_token_share_mean` for that family only - the D term, every other
// family, the calendars and the window totals are untouched - and measures what moves:
//   1. the within-instance weight vectors themselves (p50 vs mean), per cell and category
//   2. the Daily view, CURRENT (cal_curr) and NEW (cal_new) sides, per category and the ALL series
//   3. the fit of the ALL CURRENT series against the data_econ_daily actuals (TV / MAPE_shape), both ways
//   4. the 7-day window (ECOGAINS_SIM_7_DAY / _DIFF_7_DAY), both ways
//   5. packGrantPlan_ dayW (the card sim's grant-day axis), both ways - totals and reach are unchanged by
//      construction, only the per-instance day weights can move
//   6. for the record, what the SAME column choice would do to the D term (not proposed by the finding):
//      D = share(newDur)/share(curDur) under p50 vs mean for the four collection sources
// Deterministic: no randomness anywhere, no engine file touched, nothing written outside --out.
//   node harness/_probe_daily_alloc_meancurve.js [--data <dump>] [--out <json>]
// --data: a bare file name is relative to harness/ (default _mockdata.json, the ECO lineage).
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA_ARG = arg('--data', '_mockdata.json');
const DATA_PATH = path.isAbsolute(DATA_ARG) || DATA_ARG.indexOf('/') >= 0 || DATA_ARG.indexOf('\\') >= 0
  ? DATA_ARG : path.join(__dirname, DATA_ARG);
const OUT = arg('--out', path.join(__dirname, '..', 'analysis', 'out', 'daily_alloc_meancurve.json'));
const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);

// ---- mock SpreadsheetApp: byte-for-byte the _mock_daily.js / _probe_daily_alloc.js prelude ----
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
function mkRange(sheetName, r1, c1, nr, nc) {
  const sh = data[sheetName];
  return {
    getValues: () => { const out = [];
      for (let r = r1; r < r1 + nr; r++) { const row = [];
        for (let c = c1; c < c1 + nc; c++) row.push((sh.values[r-1] && sh.values[r-1][c-1] !== undefined) ? sh.values[r-1][c-1] : '');
        out.push(row); } return out; },
    getMergedRanges: () => (sh.merges || [])
      .filter(m => m.r >= r1 && m.r + m.nr - 1 <= r1 + nr - 1 && m.c >= c1 && m.c + m.nc - 1 <= c1 + nc - 1)
      .map(m => ({ getRow: () => m.r, getColumn: () => m.c, getNumRows: () => m.nr, getNumColumns: () => m.nc })),
    getValue: () => { const row = data[sheetName].values[r1-1] || []; return row[c1-1] !== undefined ? row[c1-1] : ''; },
  };
}
function mkSheet(name) { const sh = data[name]; if (!sh) return null;
  return { getDataRange: () => mkRange(name, 1, 1, sh.values.length, sh.values[0] ? sh.values[0].length : 0),
    getRange: (a,b,c,d) => { if (typeof a === 'string') { const m = a.match(/^([A-Z]+)(\d+)$/);
        const col = m[1].split('').reduce((s,ch) => s*26 + ch.charCodeAt(0) - 64, 0);
        return mkRange(name, +m[2], col, 1, 1); } return mkRange(name, a, b, c||1, d||1); } };
}
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: (n) => mkSheet(n) }) };
eval(fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8'));
eval(fs.readFileSync(ENGINE('EcoGainsSim_Daily.gs'), 'utf8'));
eval(fs.readFileSync(ENGINE('EcoGainsSim_7Day.gs'), 'utf8'));

// ---- helpers (plain arithmetic) ----
const D = DAILY_DAYS;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => a.length ? sum(a) / a.length : 0;
const r6 = (x) => (x == null || !isFinite(x)) ? null : Math.round(x * 1e6) / 1e6;
const zeros = () => new Array(D).fill(0);
function tv(a, s) { const sa = sum(a), ss = sum(s); if (!(sa > 0) || !(ss > 0)) return null;
  let t = 0; for (let d = 0; d < a.length; d++) t += Math.abs(a[d] / sa - s[d] / ss); return 0.5 * t; }
function mapeShape(a, s) { const sa = sum(a), ss = sum(s); if (!(sa > 0) || !(ss > 0)) return null;
  const xs = []; for (let d = 0; d < a.length; d++) if (a[d] > 0) xs.push(Math.abs(s[d] * sa / ss - a[d]) / a[d]); return xs.length ? mean(xs) : null; }
function ma7(a) { return a.map((_, d) => { const lo = Math.max(0, d - 3), hi = Math.min(a.length - 1, d + 3); let s = 0; for (let k = lo; k <= hi; k++) s += a[k]; return s / (hi - lo + 1); }); }
function quantiles(xs) { const v = xs.filter(x => x != null && isFinite(x)).sort((p, q) => p - q); if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  return { n: v.length, min: r6(v[0]), p25: r6(q(0.25)), median: r6(q(0.5)), p75: r6(q(0.75)), max: r6(v[v.length - 1]), mean: r6(mean(v)) }; }
// sheetVals_ is the ENGINE's own reader (eval'd above), reading through the mock SpreadsheetApp.

// ---- the two curve columns, indexed exactly as the engine's accIndex does (key ev|payer|seg, '0-9' fallback) ----
const accVals = sheetVals_('data_event_accrual'), ah = headerIndex_(accVals[0] || []);
function buildIdx(col) { const m = {};
  for (let i = 1; i < accVals.length; i++) { const r = accVals[i], ev = r[ah['event_name']]; if (!ev) continue;
    const key = [ev, r[ah['payer_flag']], r[ah['segment']]].join('|');
    (m[key] = m[key] || []).push({ day: num(r[ah['event_day']]), share: num(r[ah[col]]) }); }
  Object.keys(m).forEach(k => m[k].sort((a, b) => a.day - b.day)); return m; }
const IDX = { p50: buildIdx('cum_token_share_p50'), mean: buildIdx('cum_token_share_mean') };
const curveOf = (which, ev, seg, payer) => IDX[which][[ev, payer, seg].join('|')] || IDX[which][[ev, payer, '0-9'].join('|')] || [];

// ---- the switch: re-point innerWeights_ at the chosen column for the DAILY_MARGINAL family only ----
// innerWeights_ is an eval'd (sloppy-mode) declaration in this module's scope, so the assignment below
// rebinds the name dayWeights_ resolves at call time. Nothing else in the engine changes.
let CURVE_COL = 'p50';
const innerWeightsEngine_ = innerWeights_;
innerWeights_ = function (cat, inst, pDay, ds, seg, payer) {
  if (CURVE_COL === 'engine' || !DAILY_MARGINAL[cat]) return innerWeightsEngine_(cat, inst, pDay, ds, seg, payer);
  const days = (inst && inst.days) || [], n = days.length, out = [];
  if (!n) return out;
  const curve = curveOf(CURVE_COL, DAILY_MARGINAL[cat], seg, payer);
  if (curve.length) { for (let j = 1; j <= n; j++) out.push(Math.max(0, curveRaw_(curve, j) - curveRaw_(curve, j - 1))); return normalize_(out); }
  for (let j = 0; j < n; j++) out.push(pDay(days[j]));
  return normalize_(out);
};

// ---- cells, actuals ----
const SEG_ORDER = ['0-9', '10-19', '20-39', '40-99', '100+'];
const behVals = sheetVals_('data_seg_beh'), bh = headerIndex_(behVals[0] || []);
const cellSet = {};
for (let i = 1; i < behVals.length; i++) { const seg = String(behVals[i][bh['segment']] || '').trim(), payer = String(behVals[i][bh['payer_flag']] || '').trim();
  if (SEG_ORDER.indexOf(seg) >= 0 && (payer === 'NONPAYER' || payer === 'PAYER')) cellSet[seg + '|' + payer] = { seg, payer }; }
const CELLS = []; SEG_ORDER.forEach(seg => ['NONPAYER', 'PAYER'].forEach(payer => { if (cellSet[seg + '|' + payer]) CELLS.push({ seg, payer }); }));
const edVals = sheetVals_('data_econ_daily'), eh = headerIndex_(edVals[0] || []);
const actual = {};   // cell|res -> 33 days
for (let i = 1; i < edVals.length; i++) { const r = edVals[i]; if (!r || r[eh['segment']] == null || r[eh['segment']] === '') continue;
  const seg = String(r[eh['segment']]).trim(), payer = String(r[eh['payer_flag']]).trim(), cur = String(r[eh['currency']]).trim();
  const d = Math.round(num(r[eh['day_index']])); if (d < 1 || d > D || RESOURCES.indexOf(cur) === -1) continue;
  const k = seg + ' ' + payer + '|' + cur; actual[k] = actual[k] || zeros(); actual[k][d - 1] += num(r[eh['gain_per_earner_day']]); }
const RES = RESOURCES.filter(r => Object.keys(actual).some(k => k.endsWith('|' + r)));
const ctx = Context.get();
const MARG = Object.keys(DAILY_MARGINAL);

// ---- run the engine both ways ----
function series(which, cat, seg, payer, isNew) { CURVE_COL = which; const s = dailySeries_(cat, seg, payer, ctx, isNew); CURVE_COL = 'p50'; return s; }
function col(s, res) { return s.map(o => num(o[res])); }
function sevenDay(which, fn, seg, payer) { CURVE_COL = which; const m = fn(payer, seg); CURVE_COL = 'p50'; return m; }
function instList(cal, cat) { const lab = DAILY_CAL_LABEL[cat]; return ((cal[lab] || []).slice()).sort((a, b) => a.start - b.start).map(i => i.days.slice()); }
function straddles(days, boundary) { return days.some(d => d <= boundary) && days.some(d => d > boundary); }   // boundary|boundary+1

const out = { _meta: { probe: 'harness/_probe_daily_alloc_meancurve.js', run: new Date().toISOString(), data: path.relative(path.join(__dirname, '..'), DATA_PATH).replace(/\\/g, '/'),
                       engine: { v4: 'engine/EcoGainsSim_v4.gs', daily: 'engine/EcoGainsSim_Daily.gs', daily_build: DAILY_BUILD, seven: 'engine/EcoGainsSim_7Day.gs' },
                       window7: win7Bounds_(), season_last_day: (typeof SEASON_LAST_DAY !== 'undefined') ? SEASON_LAST_DAY : null, marginal_family: DAILY_MARGINAL },
              self_check: {}, curves: {}, within_instance: {}, daily_view: { CURRENT: {}, NEW: {} }, fit_vs_actuals: {}, seven_day: {}, pack_plan: {}, d_term: {}, gate_146: {} };

// 0. self-checks: (a) the p50 index equals what ctx.ds hands the engine; (b) the override at 'p50' reproduces the engine bit for bit
let idxMax = 0; MARG.forEach(cat => CELLS.forEach(c => { const a = ctx.ds.accrualCurve(DAILY_MARGINAL[cat], c.seg, c.payer, false), b = curveOf('p50', DAILY_MARGINAL[cat], c.seg, c.payer);
  if (a.length !== b.length) { idxMax = Infinity; return; } a.forEach((p, i) => { idxMax = Math.max(idxMax, Math.abs(p.day - b[i].day), Math.abs(p.share - b[i].share)); }); }));
let overrideMax = 0; CELLS.forEach(c => CATEGORY_ORDER.forEach(cat => [false, true].forEach(isNew => {
  const e = series('engine', cat, c.seg, c.payer, isNew), p = series('p50', cat, c.seg, c.payer, isNew);
  for (let d = 0; d < D; d++) RESOURCES.forEach(r => { overrideMax = Math.max(overrideMax, Math.abs(num(e[d][r]) - num(p[d][r]))); }); })));
out.self_check = { p50_index_vs_engine_accrualCurve_maxabs: r6(idxMax), override_at_p50_vs_engine_dailySeries_maxabs: r6(overrideMax) };

// 1. the curves and the within-instance weight vectors
MARG.forEach(cat => { out.curves[cat] = {}; out.within_instance[cat] = {};
  CELLS.forEach(c => { const k = c.seg + ' ' + c.payer, p = curveOf('p50', DAILY_MARGINAL[cat], c.seg, c.payer), m = curveOf('mean', DAILY_MARGINAL[cat], c.seg, c.payer);
    out.curves[cat][k] = { p50: p.map(x => x.share), mean: m.map(x => x.share), instance_length_days: p.length ? p[p.length - 1].day : null };
    const rows = {};
    [['cal_curr', ctx.calCur], ['cal_new', ctx.calNew]].forEach(([side, cal]) => {
      const lens = [...new Set(instList(cal, cat).map(ds => ds.length))].sort((a, b) => a - b);
      rows[side] = lens.map(n => { const inst = { days: Array.from({ length: n }, (_, j) => j + 1) };
        const w50 = innerWeights_.call(null, cat, inst, () => 1, ctx.ds, c.seg, c.payer);
        CURVE_COL = 'mean'; const wM = innerWeights_(cat, inst, () => 1, ctx.ds, c.seg, c.payer); CURVE_COL = 'p50';
        return { n, p50: w50.map(r6), mean: wM.map(r6), tv_p50_vs_mean: r6(tv(w50, wM)) }; });
    });
    out.within_instance[cat][k] = rows; }); });

// 2. the Daily view both sides: per category series under both columns, and the ALL series
const dailyAll = { CURRENT: {}, NEW: {} };   // cell -> res -> {p50:[], mean:[]}
[['CURRENT', false], ['NEW', true]].forEach(([side, isNew]) => {
  const perCat = {}, perCell = {};
  CELLS.forEach(c => { const k = c.seg + ' ' + c.payer; dailyAll[side][k] = {}; RESOURCES.forEach(r => { dailyAll[side][k][r] = { p50: zeros(), mean: zeros() }; });
    CATEGORY_ORDER.forEach(cat => {
      const s50 = series('p50', cat, c.seg, c.payer, isNew), sM = MARG.indexOf(cat) >= 0 ? series('mean', cat, c.seg, c.payer, isNew) : s50;
      RESOURCES.forEach(r => { for (let d = 0; d < D; d++) { dailyAll[side][k][r].p50[d] += num(s50[d][r]); dailyAll[side][k][r].mean[d] += num(sM[d][r]); } });
      if (MARG.indexOf(cat) >= 0) { perCat[cat] = perCat[cat] || {};
        const resOut = {}; RESOURCES.forEach(r => { const a = col(s50, r), b = col(sM, r); if (!(sum(a) > 0)) return;
          let maxRel = 0, maxAbs = 0; for (let d = 0; d < D; d++) { maxAbs = Math.max(maxAbs, Math.abs(b[d] - a[d])); if (a[d] > 1e-12 || b[d] > 1e-12) maxRel = Math.max(maxRel, Math.abs(b[d] - a[d]) / Math.max(a[d], b[d])); }
          resOut[r] = { window_total: r6(sum(a)), total_conserved_absdiff: r6(Math.abs(sum(a) - sum(b))), tv_p50_vs_mean: r6(tv(a, b)), max_abs_day_delta: r6(maxAbs), max_rel_day_change: r6(maxRel),
                        p50: a.map(r6), mean: b.map(r6) }; });
        perCat[cat][k] = resOut; } });
    // ALL series
    const cellOut = {}; RESOURCES.forEach(r => { const a = dailyAll[side][k][r].p50, b = dailyAll[side][k][r].mean; if (!(sum(a) > 0)) return;
      let maxRel = 0, maxAbs = 0, margMass = 0; for (let d = 0; d < D; d++) { maxAbs = Math.max(maxAbs, Math.abs(b[d] - a[d])); if (a[d] > 1e-12) maxRel = Math.max(maxRel, Math.abs(b[d] - a[d]) / a[d]); }
      MARG.forEach(cat => { if (perCat[cat] && perCat[cat][k] && perCat[cat][k][r]) margMass += perCat[cat][k][r].window_total; });
      cellOut[r] = { window_total: r6(sum(a)), marginal_family_share_of_total: r6(margMass / sum(a)), tv_p50_vs_mean: r6(tv(a, b)), max_abs_day_delta: r6(maxAbs),
                     max_abs_day_delta_over_daily_mean: r6(maxAbs / (sum(a) / D)), max_rel_day_change: r6(maxRel) }; });
    perCell[k] = cellOut; });
  out.daily_view[side] = { per_category: perCat, all_series: perCell,
    all_series_summary: { tv_p50_vs_mean: quantiles(Object.values(perCell).flatMap(o => Object.values(o).map(x => x.tv_p50_vs_mean))),
                          max_rel_day_change: quantiles(Object.values(perCell).flatMap(o => Object.values(o).map(x => x.max_rel_day_change))),
                          pairs_with_any_change: Object.values(perCell).flatMap(o => Object.values(o)).filter(x => x.tv_p50_vs_mean > 1e-9).length,
                          pairs: Object.values(perCell).flatMap(o => Object.values(o)).length } };
});

// 3. fit vs the actuals (CURRENT side only - the actuals were earned under cal_curr)
const rows = [];
CELLS.forEach(c => { const k = c.seg + ' ' + c.payer; RES.forEach(r => { const a = actual[k + '|' + r]; if (!a) return;
  const s50 = dailyAll.CURRENT[k][r].p50, sM = dailyAll.CURRENT[k][r].mean;
  const m = ma7(a), tvNoise = tv(a, m);
  rows.push({ cell: k, res: r, tv_p50: tv(a, s50), tv_mean: tv(a, sM), mape_shape_p50: mapeShape(a, s50), mape_shape_mean: mapeShape(a, sM), tv_noise_ma7: tvNoise,
              tv_sim_p50_vs_mean: tv(s50, sM), marginal_share: (() => { let mm = 0; MARG.forEach(cat => { const pc = out.daily_view.CURRENT.per_category[cat]; if (pc && pc[k] && pc[k][r]) mm += pc[k][r].window_total; }); const t = sum(s50); return t > 0 ? mm / t : 0; })() }); }); });
const def = rows.filter(x => x.tv_p50 != null && x.tv_mean != null);
const better = def.filter(x => x.tv_mean < x.tv_p50 - 1e-9).length, worse = def.filter(x => x.tv_mean > x.tv_p50 + 1e-9).length;
const touched = def.filter(x => x.tv_sim_p50_vs_mean > 1e-9);
out.fit_vs_actuals = {
  n_pairs: def.length, tv_p50_mean: r6(mean(def.map(x => x.tv_p50))), tv_mean_mean: r6(mean(def.map(x => x.tv_mean))),
  improvement_pct: r6(100 * (mean(def.map(x => x.tv_p50)) - mean(def.map(x => x.tv_mean))) / mean(def.map(x => x.tv_p50))),
  mape_shape_p50: r6(mean(def.map(x => x.mape_shape_p50))), mape_shape_mean: r6(mean(def.map(x => x.mape_shape_mean))),
  improved_pairs: better, worsened_pairs: worse, unchanged_pairs: def.length - better - worse,
  touched_pairs: touched.length, tv_change_on_touched_pairs: quantiles(touched.map(x => x.tv_mean - x.tv_p50)),
  sim_shift_vs_noise: { pairs_sim_shift_below_actuals_noise_floor: touched.filter(x => x.tv_sim_p50_vs_mean < x.tv_noise_ma7).length, touched: touched.length,
                        sim_shift_quantiles: quantiles(touched.map(x => x.tv_sim_p50_vs_mean)), noise_floor_quantiles: quantiles(touched.map(x => x.tv_noise_ma7)) },
  per_resource: RES.reduce((o, r) => { const q = def.filter(x => x.res === r); if (!q.length) return o;
    o[r] = { n: q.length, tv_p50: r6(mean(q.map(x => x.tv_p50))), tv_mean: r6(mean(q.map(x => x.tv_mean))), marginal_share_mean: r6(mean(q.map(x => x.marginal_share))),
             improved: q.filter(x => x.tv_mean < x.tv_p50 - 1e-9).length, worsened: q.filter(x => x.tv_mean > x.tv_p50 + 1e-9).length }; return o; }, {}),
  per_cell: CELLS.reduce((o, c) => { const k = c.seg + ' ' + c.payer, q = def.filter(x => x.cell === k); if (!q.length) return o;
    o[k] = { tv_p50: r6(mean(q.map(x => x.tv_p50))), tv_mean: r6(mean(q.map(x => x.tv_mean))), improved: q.filter(x => x.tv_mean < x.tv_p50 - 1e-9).length, worsened: q.filter(x => x.tv_mean > x.tv_p50 + 1e-9).length }; return o; }, {}),
  rows: rows.map(x => Object.keys(x).reduce((o, kk) => { o[kk] = typeof x[kk] === 'number' ? r6(x[kk]) : x[kk]; return o; }, {})) };

// 4. the 7-day window, both ways
const w7 = win7Bounds_(); const sevenRows = [];
CELLS.forEach(c => { const k = c.seg + ' ' + c.payer;
  const a = sevenDay('p50', ECOGAINS_SIM_7_DAY, c.seg, c.payer), b = sevenDay('mean', ECOGAINS_SIM_7_DAY, c.seg, c.payer);
  const da = sevenDay('p50', ECOGAINS_DIFF_7_DAY, c.seg, c.payer), db = sevenDay('mean', ECOGAINS_DIFF_7_DAY, c.seg, c.payer);
  CATEGORY_ORDER.forEach((cat, i) => RESOURCES.forEach((r, j) => { const d1 = num(b[i][j]) - num(a[i][j]), d2 = num(db[i][j]) - num(da[i][j]);
    if (Math.abs(d1) > 1e-9 || Math.abs(d2) > 1e-9) sevenRows.push({ cell: k, cat, res: r, sim7_p50: r6(a[i][j]), sim7_mean: r6(b[i][j]), diff7_p50: r6(da[i][j]), diff7_mean: r6(db[i][j]) }); })); });
const strad = {}; MARG.forEach(cat => { strad[cat] = {}; [['cal_curr', ctx.calCur], ['cal_new', ctx.calNew]].forEach(([side, cal]) => {
  const L = instList(cal, cat); strad[cat][side] = { instances: L, straddles_window_start: L.filter(ds => straddles(ds, w7.a - 1)).length, straddles_window_end: L.filter(ds => straddles(ds, w7.b)).length,
                                                      straddles_season_cutoff: out._meta.season_last_day ? L.filter(ds => straddles(ds, out._meta.season_last_day)).length : null }; }); });
out.seven_day = { window: w7, cells_x_cats_x_res_changed: sevenRows.length, max_abs_change_sim7: r6(Math.max(0, ...sevenRows.map(x => Math.abs(x.sim7_mean - x.sim7_p50)))),
                  max_abs_change_diff7: r6(Math.max(0, ...sevenRows.map(x => Math.abs(x.diff7_mean - x.diff7_p50)))), changed_rows: sevenRows.slice(0, 60), instance_straddles: strad };

// 5. packGrantPlan_ dayW both ways (packs have no D term, so swapping the DataStore curve is safe here)
const dsCurve = ctx.ds.accrualCurve;
function planWith(which, seg, payer) { ctx.ds.accrualCurve = (ev, s, p, kite) => kite ? dsCurve.call(ctx.ds, ev, s, p, kite) : curveOf(which, ev, s, p); const pl = packGrantPlan_(seg, payer, ctx); ctx.ds.accrualCurve = dsCurve; return pl; }
const planRows = [];
CELLS.forEach(c => { const k = c.seg + ' ' + c.payer; const A = planWith('p50', c.seg, c.payer), B = planWith('mean', c.seg, c.payer);
  if (A.length !== B.length) { planRows.push({ cell: k, note: 'plan length differs ' + A.length + ' vs ' + B.length }); return; }
  A.forEach((pa, i) => { const pb = B[i]; if (pa.cat !== pb.cat) { planRows.push({ cell: k, note: 'cat order differs at ' + i }); return; }
    const t = tv(pa.dayW, pb.dayW); if (t != null && t > 1e-9) planRows.push({ cell: k, cat: pa.cat, days: pa.days, reach_same: Math.abs(pa.reach - pb.reach) < 1e-12, dayW_p50: pa.dayW.map(r6), dayW_mean: pb.dayW.map(r6), tv: r6(t) }); }); });
out.pack_plan = { instances_with_changed_dayW: planRows.length, reach_unchanged_everywhere: planRows.every(x => x.reach_same !== false), rows: planRows.slice(0, 40) };

// 6. the D term under the same column choice (NOT proposed by the finding; recorded for completeness)
const COLL = { 'Hatchling Hideaway': ['Hatchling Hideaway', 'Hatchling Hideaway'], "Bomb's Ballet": ["Bomb's Ballet Show", 'Bombs Ballet'], 'Jigsaw': ['Jigsaw Puzzle', 'Jigsaw'], 'Photoshoot': ['Photoshoot', 'Photoshoot'], 'River Rush': ['River Rush', 'River Rush'] };
Object.keys(COLL).forEach(cat => { const [lab, key] = COLL[cat]; const cur = ctx.calCur[lab] || [], nw = ctx.calNew[lab] || [];
  const cd = modalDur_(cur), nd = modalDur_(nw); const per = {};
  CELLS.forEach(c => { const k = c.seg + ' ' + c.payer; const Dof = (which) => { const cv = curveOf(which, key, c.seg, c.payer); if (!cv.length || cd === nd || !cur.length || !nw.length) return 1; const b = curveRaw_(cv, cd); return b > 0 ? curveRaw_(cv, nd) / b : 1; };
    per[k] = { D_p50: r6(Dof('p50')), D_mean: r6(Dof('mean')) }; });
  out.d_term[cat] = { cal_curr_instances: cur.length, cal_new_instances: nw.length, modal_dur_curr: cd, modal_dur_new: nd, applies: cur.length > 0 && nw.length > 0 && cd !== nd, per_cell: per }; });

// 7. the harness gate at _mock_daily.js:146 under the mean column (HH 0-9 NONPAYER, the 4-day instance, UL Lives)
{ const hhNew50 = series('p50', 'Hatchling Hideaway', '0-9', 'NONPAYER', true), hhNewM = series('mean', 'Hatchling Hideaway', '0-9', 'NONPAYER', true);
  const inst = (ctx.calNew['Hatchling Hideaway'] || []).find(i => i.dur === 4); const r = RESOURCES[10];
  if (inst) { const g = (s) => inst.days.map(d => num(s[d - 1][r])); const a = g(hhNew50), b = g(hhNewM);
    out.gate_146 = { resource: r, days: inst.days, p50: a.map(r6), mean: b.map(r6), passes_p50: a[1] > a[0] && a[3] < 1e-9, passes_mean: b[1] > b[0] && b[3] < 1e-9 }; } }

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));

// ---- console summary ----
const f = (x, n) => (x == null ? 'n/a' : (+x).toFixed(n));
console.log('ACCRUAL COLUMN PROBE  data=' + out._meta.data + '  build=' + DAILY_BUILD);
console.log('self-check: p50 index vs engine curve maxabs ' + out.self_check.p50_index_vs_engine_accrualCurve_maxabs + ' | override@p50 vs engine dailySeries_ maxabs ' + out.self_check.override_at_p50_vs_engine_dailySeries_maxabs);
console.log('\nWITHIN-INSTANCE WEIGHTS (p50 -> mean), TV = share of the instance slice that changes day');
MARG.forEach(cat => CELLS.forEach(c => { const k = c.seg + ' ' + c.payer, w = out.within_instance[cat][k];
  ['cal_curr', 'cal_new'].forEach(side => w[side].forEach(x => console.log('  ' + cat.padEnd(20) + k.padEnd(16) + side.padEnd(9) + 'n=' + x.n + '  p50 ' + JSON.stringify(x.p50) + '  mean ' + JSON.stringify(x.mean) + '  TV ' + f(x.tv_p50_vs_mean, 3)))); }));
['CURRENT', 'NEW'].forEach(side => { const s = out.daily_view[side].all_series_summary;
  console.log('\nDAILY ' + side + ' ALL series (cell x resource pairs): changed ' + s.pairs_with_any_change + '/' + s.pairs + '  TV(p50,mean) ' + JSON.stringify(s.tv_p50_vs_mean) + '\n   max per-day relative change ' + JSON.stringify(s.max_rel_day_change)); });
const F = out.fit_vs_actuals;
console.log('\nFIT VS ACTUALS (CURRENT, ' + F.n_pairs + ' pairs): TV p50 ' + f(F.tv_p50_mean, 4) + ' -> mean ' + f(F.tv_mean_mean, 4) + ' (' + f(F.improvement_pct, 2) + '% better)  improved/worsened/unchanged ' + F.improved_pairs + '/' + F.worsened_pairs + '/' + F.unchanged_pairs);
console.log('   MAPE_shape p50 ' + f(F.mape_shape_p50, 4) + ' -> mean ' + f(F.mape_shape_mean, 4) + '   sim shift below the actuals noise floor on ' + F.sim_shift_vs_noise.pairs_sim_shift_below_actuals_noise_floor + '/' + F.sim_shift_vs_noise.touched + ' touched pairs');
console.log('   sim shift TV quantiles ' + JSON.stringify(F.sim_shift_vs_noise.sim_shift_quantiles) + '\n   noise floor quantiles  ' + JSON.stringify(F.sim_shift_vs_noise.noise_floor_quantiles));
Object.keys(F.per_resource).forEach(r => { const q = F.per_resource[r]; console.log('   ' + r.padEnd(16) + 'TV ' + f(q.tv_p50, 4) + ' -> ' + f(q.tv_mean, 4) + '  marginal-family share of window ' + f(q.marginal_share_mean, 3) + '  improved/worsened ' + q.improved + '/' + q.worsened); });
console.log('\n7-DAY window ' + JSON.stringify(out.seven_day.window) + ': changed (cell,cat,res) ' + out.seven_day.cells_x_cats_x_res_changed + '  max|dSIM7| ' + out.seven_day.max_abs_change_sim7 + '  max|dDIFF7| ' + out.seven_day.max_abs_change_diff7);
MARG.forEach(cat => ['cal_curr', 'cal_new'].forEach(side => { const s = out.seven_day.instance_straddles[cat][side]; console.log('   ' + cat.padEnd(20) + side.padEnd(9) + JSON.stringify(s.instances) + '  straddle start/end/cutoff ' + s.straddles_window_start + '/' + s.straddles_window_end + '/' + s.straddles_season_cutoff); }));
console.log('\nPACK PLAN: instances with changed dayW ' + out.pack_plan.instances_with_changed_dayW + '  reach unchanged everywhere ' + out.pack_plan.reach_unchanged_everywhere);
console.log('\nD TERM (same column choice, NOT proposed):');
Object.keys(out.d_term).forEach(cat => { const t = out.d_term[cat]; console.log('   ' + cat.padEnd(20) + 'inst cur/new ' + t.cal_curr_instances + '/' + t.cal_new_instances + '  modal dur ' + t.modal_dur_curr + '->' + t.modal_dur_new + '  applies ' + t.applies + (t.applies ? '  ' + Object.keys(t.per_cell).map(k => k + ' ' + t.per_cell[k].D_p50 + '/' + t.per_cell[k].D_mean).join(', ') : '')); });
console.log('\nGATE _mock_daily.js:146 (HH NEW 4d, UL Lives): ' + JSON.stringify(out.gate_146));
console.log('\nwrote ' + OUT);
