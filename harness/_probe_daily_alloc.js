// Daily-allocation probe (2026-10-14). NOT a gate - a measurement tool.
// Measures how wrong the CURRENT (cal_curr, measured-anchored) day-by-day allocation of
// EcoGainsSim_Daily.gs is against the real per-day actuals in data_econ_daily, for every
// (segment x payer) cell and every currency the daily pull carries. Deterministic: no randomness
// anywhere, no engine file touched, nothing written outside --out.
//   node harness/_probe_daily_alloc.js [--data <dump.json>] [--out <file.json>]
// --data: a bare file name is relative to harness/ (default _mockdata.json, the ECO lineage the
//         daily harness runs on). The engine is loaded EXACTLY the way _mock_daily.js loads it.
//
// Per (cell, resource):
//   actual[d]   = data_econ_daily.gain_per_earner_day, d = 1..33 (engine reader econDaily_ AND an
//                 independent reader; the two are cross-checked)
//   sim_curr[d] = sum over CATEGORY_ORDER of dailySeries_(cat, seg, payer, ctx, false) - the
//                 cal_curr allocation of the measured window total, i.e. the Daily view's CURRENT
//                 block (cross-checked against ECOGAINS_DAILY(payer, seg, 'ALL', 'CURRENT')).
//   TV          = 0.5 * sum_d |a[d]/sum(a) - s[d]/sum(s)|  (share of mass on the wrong day; level-free)
//   MAPE        = mean over days with a[d] > 0 of |s[d] - a[d]| / a[d]      (raw: level + shape)
//   MAPE_shape  = same with s rescaled so sum(s) == sum(a)                   (shape only)
//   noise floor = CV of a[d] around its 7-day centred moving average (window clipped to 1..33 at
//                 the edges), TV(a, MA7(a)) (the same noise in TV units), and the weekend amplitude
//                 mean(a on Fri/Sat/Sun) / mean(a on Mon-Thu) with isWeekend_ (day 1 = Wednesday).
//   lag scan    = TV(a, s shifted by k days) for k in -3..3, truncated at the window edges and
//                 renormalised; a best lag != 0 says the two day axes may not start on the same day.
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA_ARG = arg('--data', '_mockdata.json');
const DATA_PATH = path.isAbsolute(DATA_ARG) || DATA_ARG.indexOf('/') >= 0 || DATA_ARG.indexOf('\\') >= 0
  ? DATA_ARG : path.join(__dirname, DATA_ARG);
const OUT = arg('--out', path.join(__dirname, '..', 'analysis', 'out', 'daily_alloc_probe.json'));
const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);

// ---- mock SpreadsheetApp: byte-for-byte the _mock_daily.js prelude ----
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

// ---- helpers (plain arithmetic, no randomness) ----
const D = DAILY_DAYS;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => a.length ? sum(a) / a.length : 0;
const r6 = (x) => (x == null || !isFinite(x)) ? null : Math.round(x * 1e6) / 1e6;
function tv(a, s) {                                        // total variation between normalised shapes
  const sa = sum(a), ss = sum(s);
  if (!(sa > 0) || !(ss > 0)) return null;
  let t = 0;
  for (let d = 0; d < a.length; d++) t += Math.abs(a[d] / sa - s[d] / ss);
  return 0.5 * t;
}
function mape(a, s) {
  const xs = [];
  for (let d = 0; d < a.length; d++) if (a[d] > 0) xs.push(Math.abs(s[d] - a[d]) / a[d]);
  return xs.length ? mean(xs) : null;
}
function ma7(a) {                                          // centred, window clipped to the 33 days
  return a.map((_, d) => {
    const lo = Math.max(0, d - 3), hi = Math.min(a.length - 1, d + 3);
    let s = 0; for (let k = lo; k <= hi; k++) s += a[k];
    return s / (hi - lo + 1);
  });
}
function noise(a) {
  const m = ma7(a), mu = mean(a);
  if (!(mu > 0)) return { cv_ma7: null, tv_ma7: null, weekend_amp: null, nonzero_days: a.filter(x => x > 0).length };
  let ss = 0; for (let d = 0; d < a.length; d++) ss += (a[d] - m[d]) * (a[d] - m[d]);
  const we = [], wd = [];
  for (let d = 0; d < a.length; d++) (isWeekend_(d + 1) ? we : wd).push(a[d]);
  return { cv_ma7: Math.sqrt(ss / a.length) / mu, tv_ma7: tv(a, m),
           weekend_amp: mean(wd) > 0 ? mean(we) / mean(wd) : null,
           nonzero_days: a.filter(x => x > 0).length };
}
function shifted(s, k) {                                   // s[d-k], zero outside the window
  const out = new Array(s.length).fill(0);
  for (let d = 0; d < s.length; d++) { const j = d - k; if (j >= 0 && j < s.length) out[d] = s[j]; }
  return out;
}
function quantiles(xs) {
  const v = xs.filter(x => x != null && isFinite(x)).sort((p, q) => p - q);
  if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  return { n: v.length, min: r6(v[0]), p25: r6(q(0.25)), median: r6(q(0.5)), p75: r6(q(0.75)), max: r6(v[v.length - 1]), mean: r6(mean(v)) };
}
function family(cat, nInst) {
  if (DAILY_ALWAYS[cat]) return 'always-on (p_day over 33 days)';
  if (!nInst) return 'FLAT (no cal_curr instances -> total/33)';
  if (DAILY_LASTDAY[cat]) return 'last-day (instance end), instances prop reach';
  if (DAILY_MARGINAL[cat]) return 'marginal accrual curve, instances prop reach';
  if (DAILY_PDAY_INST[cat]) return 'p_day within instance, instances prop reach';
  return 'timed default (p_day within instance, instances prop reach)';
}

// ---- cells and resources ----
const SEG_ORDER = ['0-9', '10-19', '20-39', '40-99', '100+'];
const behVals = sheetVals_('data_seg_beh'), bh = headerIndex_(behVals[0] || []);
const cellSet = {};
for (let i = 1; i < behVals.length; i++) {
  const seg = String(behVals[i][bh['segment']] || '').trim(), payer = String(behVals[i][bh['payer_flag']] || '').trim();
  if (SEG_ORDER.indexOf(seg) >= 0 && (payer === 'NONPAYER' || payer === 'PAYER')) cellSet[seg + '|' + payer] = { seg, payer };
}
const CELLS = [];
SEG_ORDER.forEach(seg => ['NONPAYER', 'PAYER'].forEach(payer => { if (cellSet[seg + '|' + payer]) CELLS.push({ seg, payer }); }));

// independent data_econ_daily reader (the engine's econDaily_ is cross-checked against it)
const edVals = sheetVals_('data_econ_daily'), eh = headerIndex_(edVals[0] || []);
const ownGain = {}, ownRows = { total: 0, dup: 0, outOfWindow: 0, maxDay: 0 }, econCurr = new Set();
for (let i = 1; i < edVals.length; i++) {
  const r = edVals[i]; if (!r || r[eh['segment']] == null || r[eh['segment']] === '') continue;
  ownRows.total++;
  const seg = String(r[eh['segment']]).trim(), payer = String(r[eh['payer_flag']]).trim(), cur = String(r[eh['currency']]).trim();
  const d = Math.round(num(r[eh['day_index']]));
  econCurr.add(cur);
  ownRows.maxDay = Math.max(ownRows.maxDay, d);
  if (d < 1 || d > D) { ownRows.outOfWindow++; continue; }
  const k = seg + '|' + payer + '|' + cur;
  if (!ownGain[k]) ownGain[k] = new Array(D).fill(null);
  if (ownGain[k][d - 1] != null) ownRows.dup++;
  ownGain[k][d - 1] = (ownGain[k][d - 1] || 0) + num(r[eh['gain_per_earner_day']]);
}
const ECON_RES = [...econCurr].sort();
const RES = ECON_RES.filter(r => RESOURCES.indexOf(r) >= 0);
const unmappedEcon = ECON_RES.filter(r => RESOURCES.indexOf(r) < 0);
const enginesWithoutActual = RESOURCES.filter(r => ECON_RES.indexOf(r) < 0);

// data_econ window totals (gain_per_earner) for the actuals' additivity check
const ecVals = sheetVals_('data_econ'), ech = headerIndex_(ecVals[0] || []), econWin = {};
for (let i = 1; i < ecVals.length; i++) {
  const r = ecVals[i]; if (!r || !r[ech['segment']]) continue;
  econWin[String(r[ech['segment']]).trim() + '|' + String(r[ech['payer_flag']]).trim() + '|' + String(r[ech['currency']]).trim()]
    = num(r[ech['gain_per_earner']]);
}

// ---- main loop ----
const ctx = Context.get();
const calCurInst = (cat) => { const lab = DAILY_CAL_LABEL[cat]; return lab ? (ctx.calCur[lab] || []) : []; };
const result = {
  _meta: { probe: 'harness/_probe_daily_alloc.js', run: new Date().toISOString(), data: path.relative(path.join(__dirname, '..'), DATA_PATH).replace(/\\/g, '/'),
           data_meta: data._meta || null, engine: { v4: 'engine/EcoGainsSim_v4.gs', daily: 'engine/EcoGainsSim_Daily.gs', daily_build: DAILY_BUILD },
           cal_curr_ok: ctx.calCurOk, days: D, season_last_day: typeof SEASON_LAST_DAY !== 'undefined' ? SEASON_LAST_DAY : null },
  how_sim_curr_was_built: 'sim_curr[d] = sum over CATEGORY_ORDER of dailySeries_(cat, seg, payer, Context.get(), false): measuredRow_ window total (data_gains amount_per_earner, plus the synthetic anchors measuredRow_ adds - Core SPT D18, Season Pass (Paid), Rainbow Maker D29) spread over cal_curr by dayWeights_/innerWeights_ (always-on: p_day over 33 days; last-day family: instance end, instances prop reach; marginal family: accrual-curve marginal share; no instances: flat total/33). Cross-checked against ECOGAINS_DAILY(payer, seg, "ALL", "CURRENT").',
  resources: { econ_daily_currencies: ECON_RES, mapped: RES, unmapped_in_econ_daily: unmappedEcon, engine_resources_without_actuals: enginesWithoutActual },
  econ_daily_rows: ownRows,
  cells: CELLS.map(c => c.seg + ' ' + c.payer),
  reconcile: { sim_vs_measured_window: [], actual_vs_data_econ: [], engine_reader_vs_own_reader_maxabs: 0, probe_vs_ECOGAINS_DAILY_maxabs: 0, measured_window_vs_data_econ: [] },
  flat_branch: {},
  per_cell: {},
};
let readerMax = 0, viewMax = 0;
const allMetrics = [];   // {cell, res, sumA, sumS, tv, mape, mape_shape, noise...}
const catSeries = {};    // cell -> res -> { a: actual[33], cats: {cat: sim[33]} }  (for the experiments)

CELLS.forEach(({ seg, payer }) => {
  const cellKey = seg + ' ' + payer;
  const econ = econDaily_(seg, payer);
  const perCat = {};               // cat -> 33 x {res: v}
  const catInst = {};
  CATEGORY_ORDER.forEach(cat => {
    perCat[cat] = dailySeries_(cat, seg, payer, ctx, false);
    catInst[cat] = calCurInst(cat).length;
  });
  const measuredWin = {}; RESOURCES.forEach(r => { measuredWin[r] = 0; });
  const rawWin = {}; RESOURCES.forEach(r => { rawWin[r] = 0; });
  CATEGORY_ORDER.forEach(cat => {
    const W = measuredRow_(cat, seg, payer, ctx.ds), raw = ctx.ds.dataRow(cat, seg, payer);
    RESOURCES.forEach(r => { measuredWin[r] += num(W[r]); rawWin[r] += num(raw[r]); });
  });
  // flat-branch categories: a nonzero measured total and no cal_curr instance, not always-on
  result.flat_branch[cellKey] = CATEGORY_ORDER.filter(cat =>
    hasAmount_(measuredRow_(cat, seg, payer, ctx.ds)) && !DAILY_ALWAYS[cat] && catInst[cat] === 0);

  const view = ECOGAINS_DAILY(payer, seg, 'ALL', 'CURRENT');
  const cellOut = { resources: {}, flat_branch_categories: result.flat_branch[cellKey] };
  RES.forEach(res => {
    const j = RESOURCES.indexOf(res);
    const a = (econ ? econ.gain.map(o => num(o[res])) : new Array(D).fill(0));
    const own = ownGain[seg + '|' + payer + '|' + res] || new Array(D).fill(null);
    for (let d = 0; d < D; d++) readerMax = Math.max(readerMax, Math.abs(a[d] - (own[d] || 0)));
    const s = new Array(D).fill(0), cats = {};
    CATEGORY_ORDER.forEach(cat => {
      const ser = perCat[cat].map(o => num(o[res]));
      if (ser.some(x => x !== 0)) { cats[cat] = ser; for (let d = 0; d < D; d++) s[d] += ser[d]; }
    });
    for (let d = 0; d < D; d++) viewMax = Math.max(viewMax, Math.abs(s[d] - view[d][j]));
    const sumA = sum(a), sumS = sum(s);
    const nz = noise(a);
    const lag = {};
    for (let k = -3; k <= 3; k++) lag[k] = r6(tv(a, shifted(s, k)));
    let bestLag = 0, bestTv = lag[0];
    for (let k = -3; k <= 3; k++) if (lag[k] != null && (bestTv == null || lag[k] < bestTv)) { bestTv = lag[k]; bestLag = k; }
    const sShape = sumA > 0 && sumS > 0 ? s.map(x => x * sumA / sumS) : s;
    const m = { cell: cellKey, seg, payer, res, sum_actual: sumA, sum_sim: sumS,
                level_ratio: sumA > 0 ? sumS / sumA : null,
                tv: tv(a, s), mape: mape(a, s), mape_shape: mape(a, sShape),
                cv_ma7: nz.cv_ma7, tv_ma7: nz.tv_ma7, weekend_amp: nz.weekend_amp, nonzero_days: nz.nonzero_days,
                best_lag: bestLag, tv_at_best_lag: bestTv };
    allMetrics.push(m);
    cellOut.resources[res] = {
      sum_actual: r6(sumA), sum_sim: r6(sumS), level_ratio_sim_over_actual: r6(m.level_ratio),
      measured_window_total: r6(measuredWin[res]), raw_data_gains_window_total: r6(rawWin[res]),
      data_econ_gain_per_earner: econWin[seg + '|' + payer + '|' + res] != null ? r6(econWin[seg + '|' + payer + '|' + res]) : null,
      tv: r6(m.tv), mape: r6(m.mape), mape_shape: r6(m.mape_shape),
      noise: { cv_ma7: r6(nz.cv_ma7), tv_ma7: r6(nz.tv_ma7), weekend_amp: r6(nz.weekend_amp), nonzero_days: nz.nonzero_days },
      lag_scan_tv: lag, best_lag: bestLag,
      actual: a.map(r6), sim: s.map(r6), delta: s.map((x, d) => r6(x - a[d])),
      delta_pct: s.map((x, d) => a[d] > 0 ? r6(100 * (x - a[d]) / a[d]) : null),
      sim_by_category: Object.keys(cats).reduce((o, cat) => { o[cat] = { family: family(cat, catInst[cat]), cal_curr_instances: catInst[cat], days: cats[cat].map(r6) }; return o; }, {}),
    };
    result.reconcile.sim_vs_measured_window.push({ cell: cellKey, res, sum_sim_days: r6(sumS), measured_window: r6(measuredWin[res]), abs_err: r6(Math.abs(sumS - measuredWin[res])) });
    const ew = econWin[seg + '|' + payer + '|' + res];
    result.reconcile.actual_vs_data_econ.push({ cell: cellKey, res, sum_actual_days: r6(sumA), data_econ_gain_per_earner: ew != null ? r6(ew) : null,
      abs_err: ew != null ? r6(Math.abs(sumA - ew)) : null, rel_err: ew > 0 ? r6(Math.abs(sumA - ew) / ew) : null });
    result.reconcile.measured_window_vs_data_econ.push({ cell: cellKey, res, measured_window: r6(measuredWin[res]), raw_data_gains: r6(rawWin[res]),
      data_econ_gain_per_earner: ew != null ? r6(ew) : null, ratio_measured_over_econ: ew > 0 ? r6(measuredWin[res] / ew) : null,
      ratio_raw_over_econ: ew > 0 ? r6(rawWin[res] / ew) : null });
    catSeries[cellKey] = catSeries[cellKey] || {};
    catSeries[cellKey][res] = { a, cats };
  });
  result.per_cell[cellKey] = cellOut;
});
result.reconcile.engine_reader_vs_own_reader_maxabs = r6(readerMax);
result.reconcile.probe_vs_ECOGAINS_DAILY_maxabs = r6(viewMax);
result.reconcile.sim_vs_measured_window_maxabs = r6(Math.max(...result.reconcile.sim_vs_measured_window.map(x => x.abs_err)));
result.reconcile.actual_vs_data_econ_max_rel = r6(Math.max(...result.reconcile.actual_vs_data_econ.map(x => x.rel_err == null ? 0 : x.rel_err)));
result.reconcile.actual_vs_data_econ_missing = result.reconcile.actual_vs_data_econ.filter(x => x.data_econ_gain_per_earner == null).length;

// ---- aggregation ----
function agg(rows, key) {
  const v = rows.filter(r => r[key] != null && isFinite(r[key]));
  const w = v.reduce((s, r) => s + r.sum_actual, 0);
  return { n: v.length, unweighted_mean: r6(mean(v.map(r => r[key]))),
           actual_mass_weighted: w > 0 ? r6(v.reduce((s, r) => s + r[key] * r.sum_actual, 0) / w) : null,
           quantiles: quantiles(v.map(r => r[key])) };
}
const defined = allMetrics.filter(m => m.tv != null);
result.baseline_fit = {
  note: 'actual-mass weighting MIXES UNITS across resources (SPT tokens and Unlimited-Lives minutes outweigh booster counts by 2-4 orders of magnitude); the per-resource rows weight within one unit and are the ones to read. unweighted = plain mean over (cell,resource) pairs with a defined TV.',
  overall: { tv: agg(allMetrics, 'tv'), mape: agg(allMetrics, 'mape'), mape_shape: agg(allMetrics, 'mape_shape'), level_ratio: agg(allMetrics, 'level_ratio') },
  per_resource: RES.reduce((o, res) => { const rows = allMetrics.filter(m => m.res === res);
    o[res] = { tv: agg(rows, 'tv'), mape: agg(rows, 'mape'), mape_shape: agg(rows, 'mape_shape'), level_ratio: agg(rows, 'level_ratio'),
               total_actual_mass: r6(rows.reduce((s, r) => s + r.sum_actual, 0)), best_lag_votes: rows.reduce((c, r) => { c[r.best_lag] = (c[r.best_lag] || 0) + 1; return c; }, {}) }; return o; }, {}),
  per_cell: CELLS.reduce((o, c) => { const k = c.seg + ' ' + c.payer, rows = allMetrics.filter(m => m.cell === k);
    o[k] = { tv: agg(rows, 'tv'), mape: agg(rows, 'mape'), mape_shape: agg(rows, 'mape_shape'), level_ratio: agg(rows, 'level_ratio') }; return o; }, {}),
  undefined_tv: allMetrics.filter(m => m.tv == null).map(m => ({ cell: m.cell, res: m.res, sum_actual: r6(m.sum_actual), sum_sim: r6(m.sum_sim) })),
  lag_scan: { best_lag_votes_all: defined.reduce((c, r) => { c[r.best_lag] = (c[r.best_lag] || 0) + 1; return c; }, {}),
              hc_best_lag_votes: defined.filter(r => r.res === 'HC').reduce((c, r) => { c[r.best_lag] = (c[r.best_lag] || 0) + 1; return c; }, {}),
              mean_tv_by_lag: [-3, -2, -1, 0, 1, 2, 3].reduce((o, k) => { const xs = []; CELLS.forEach(c => RES.forEach(res => {
                const q = result.per_cell[c.seg + ' ' + c.payer].resources[res].lag_scan_tv[k]; if (q != null) xs.push(q); })); o[k] = r6(mean(xs)); return o; }, {}) },
};
const withNoise = allMetrics.filter(m => m.cv_ma7 != null);
result.noise_floor = {
  definition: 'cv_ma7 = RMS(actual[d] - MA7[d]) / mean(actual), MA7 centred and clipped to days 1..33; tv_ma7 = TV(actual, MA7(actual)) i.e. the same noise in the allocation metric\'s units; weekend_amp = mean(actual on Fri/Sat/Sun) / mean(actual on Mon-Thu) with isWeekend_ (calendar starts Wednesday: weekend days are 3,4,5,10,11,12,...).',
  overall: { cv_ma7: agg(withNoise, 'cv_ma7'), tv_ma7: agg(withNoise, 'tv_ma7'), weekend_amp: agg(withNoise, 'weekend_amp') },
  per_resource: RES.reduce((o, res) => { const rows = withNoise.filter(m => m.res === res);
    o[res] = { cv_ma7: agg(rows, 'cv_ma7'), tv_ma7: agg(rows, 'tv_ma7'), weekend_amp: agg(rows, 'weekend_amp') }; return o; }, {}),
  per_cell: CELLS.reduce((o, c) => { const k = c.seg + ' ' + c.payer, rows = withNoise.filter(m => m.cell === k);
    o[k] = { cv_ma7: agg(rows, 'cv_ma7'), tv_ma7: agg(rows, 'tv_ma7'), weekend_amp: agg(rows, 'weekend_amp') }; return o; }, {}),
  // how many (cell,res) pairs the allocation already lands within the actuals' own noise
  tv_within_noise: { le_1x_tv_ma7: defined.filter(m => m.tv_ma7 != null && m.tv <= m.tv_ma7).length,
                     le_2x_tv_ma7: defined.filter(m => m.tv_ma7 != null && m.tv <= 2 * m.tv_ma7).length,
                     n: defined.filter(m => m.tv_ma7 != null).length,
                     tv_minus_tv_ma7: quantiles(defined.filter(m => m.tv_ma7 != null).map(m => m.tv - m.tv_ma7)) },
};

// ---- EXPERIMENTS: re-place the per-category series in the probe (engine untouched) ----
// Each experiment is a pure transform of the baseline per-category series, conserving every
// category's 33-day total, and is scored with the same TV against the same actuals. They exist to
// put a number on each finding, not to propose the implementation.
//   E1 all +1       every category shifted one day later (mass past day 33 folds onto day 33) -
//                   the "day axes do not start on the same day" hypothesis.
//   E2 lastday +1   only the DAILY_LASTDAY family shifted one day later - the "rank rewards are
//                   collected the day AFTER the instance ends" hypothesis.
//   E3 SP sigma-p   Season Pass (Free)/(Paid) re-spread over the union of their lane days prop
//                   p_day, i.e. instance share prop EXPECTED ACTIVE DAYS instead of reach. In this
//                   cal_curr the lane is [1..30] + [31..33]: the 3-day stub has reach ~0.64 against
//                   ~1.0 for the 30-day season, so it takes ~39% of the whole window total.
//   E4 RR on-grid   River Rush has NO cal_curr lane (flat branch) but data_event_inst says it ran,
//                   and the SPTx2 actuals - 99% of that resource's data_gains mass is River Rush -
//                   are ON on days 2-8, 16-22, 30-33 in all ten cells (7 on / 7 off). Place it on
//                   those instances, share prop reach, within-instance by the River Rush accrual
//                   curve's marginal share (the DAILY_MARGINAL rule). THIS USES THE ACTUALS'
//                   SCHEDULE AS THE CALENDAR INPUT: it measures what fixing the calendar would
//                   recover, it is not a model fit.
//   E5 E2+E3+E4     the three together.
function foldShift(ser, k) {
  const out = new Array(D).fill(0);
  ser.forEach((v, d) => { let j = d + k; if (j > D - 1) j = D - 1; if (j < 0) j = 0; out[j] += v; });
  return out;
}
const RR_DAYS = [[2, 3, 4, 5, 6, 7, 8], [16, 17, 18, 19, 20, 21, 22], [30, 31, 32, 33]];
// inner = 'accrual' (DAILY_MARGINAL rule: accrual curve marginal share) or 'pday' (p_day within
// the instance, the RM / Night Sky rule). Both are tried: the SPTx2 actuals are FLAT inside each
// 7-day block, so the gap between the two says whether the token-accrual curve is the right
// claim-day shape for this event at all.
function rrWeights(seg, payer, inner) {
  const b = ctx.ds.beh(seg, payer);
  let pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)) { pWd = 1; pWe = 1; }
  const pDay = (d) => isWeekend_(d) ? pWe : pWd;
  const reaches = RR_DAYS.map(days => reachOne_({ days }, pWd, pWe)), sumR = sum(reaches);
  const curve = inner === 'accrual' ? ctx.ds.accrualCurve('River Rush', seg, payer, false) : [];
  const w = new Array(D).fill(0);
  RR_DAYS.forEach((days, i) => {
    let inn = curve.length ? days.map((_, j) => Math.max(0, curveRaw_(curve, j + 1) - curveRaw_(curve, j))) : days.map(pDay);
    inn = normalize_(inn);
    days.forEach((d, j) => { w[d - 1] += (sumR > 0 ? reaches[i] / sumR : 1 / RR_DAYS.length) * inn[j]; });
  });
  return normalize_(w);
}
function spWeights(seg, payer) {
  const b = ctx.ds.beh(seg, payer);
  let pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)) { pWd = 1; pWe = 1; }
  const days = {};
  (ctx.calCur['Season Pass'] || []).forEach(inst => (inst.days || []).forEach(d => { if (d >= 1 && d <= D) days[d] = 1; }));
  const w = new Array(D).fill(0);
  Object.keys(days).forEach(d => { w[d - 1] = isWeekend_(+d) ? pWe : pWd; });
  return sum(w) > 0 ? normalize_(w) : null;
}
const EXPERIMENTS = {
  'E1 all +1':      (cat, ser) => foldShift(ser, 1),
  'E2 lastday +1':  (cat, ser) => DAILY_LASTDAY[cat] ? foldShift(ser, 1) : ser,
  'E3 SP sigma-p':  (cat, ser, seg, payer) => { if (cat !== 'Season Pass (Free)' && cat !== 'Season Pass (Paid)') return ser;
                       const w = spWeights(seg, payer); if (!w) return ser; const t = sum(ser); return w.map(x => x * t); },
  'E4 RR on-grid':  (cat, ser, seg, payer) => { if (cat !== 'River Rush') return ser; const t = sum(ser); return rrWeights(seg, payer, 'accrual').map(x => x * t); },
  'E4b RR pday':    (cat, ser, seg, payer) => { if (cat !== 'River Rush') return ser; const t = sum(ser); return rrWeights(seg, payer, 'pday').map(x => x * t); },
};
EXPERIMENTS['E5 E2+E3+E4'] = (cat, ser, seg, payer) => EXPERIMENTS['E4 RR on-grid'](cat, EXPERIMENTS['E3 SP sigma-p'](cat, EXPERIMENTS['E2 lastday +1'](cat, ser), seg, payer), seg, payer);
EXPERIMENTS['E5b E2+E3+E4b'] = (cat, ser, seg, payer) => EXPERIMENTS['E4b RR pday'](cat, EXPERIMENTS['E3 SP sigma-p'](cat, EXPERIMENTS['E2 lastday +1'](cat, ser), seg, payer), seg, payer);
result.experiments = { note: 'post-processing of the baseline per-category series inside the probe; every category total conserved; TV against the same actuals. E4 takes its schedule from the actuals (see header) - a calendar-input fix, not a model fit.', runs: {} };
Object.keys(EXPERIMENTS).forEach(name => {
  const fn = EXPERIMENTS[name], rows = [];
  CELLS.forEach(({ seg, payer }) => {
    const cellKey = seg + ' ' + payer;
    RES.forEach(res => {
      const cs = catSeries[cellKey][res];
      const s = new Array(D).fill(0);
      Object.keys(cs.cats).forEach(cat => { const t = fn(cat, cs.cats[cat], seg, payer); for (let d = 0; d < D; d++) s[d] += t[d]; });
      const base = allMetrics.find(m => m.cell === cellKey && m.res === res);
      rows.push({ cell: cellKey, res, sum_actual: cs.a.reduce((p, q) => p + q, 0), tv: tv(cs.a, s), tv_base: base.tv, conserved: Math.abs(sum(s) - base.sum_sim) < 1e-9 });
    });
  });
  const def = rows.filter(r => r.tv != null && r.tv_base != null);
  result.experiments.runs[name] = {
    tv: agg(rows, 'tv'), tv_baseline: agg(rows, 'tv_base'),
    improved: def.filter(r => r.tv < r.tv_base - 1e-9).length, worsened: def.filter(r => r.tv > r.tv_base + 1e-9).length, unchanged: def.filter(r => Math.abs(r.tv - r.tv_base) <= 1e-9).length,
    totals_conserved: rows.every(r => r.conserved),
    per_resource: RES.reduce((o, res) => { const rr = rows.filter(r => r.res === res); o[res] = { tv_mean: agg(rr, 'tv').unweighted_mean, tv_base_mean: agg(rr, 'tv_base').unweighted_mean }; return o; }, {}),
  };
});
// the Season Pass stub artifact, quantified: per-day Season Pass HC on days 31-33 vs days 1-30
result.experiments.sp_stub_ratio = CELLS.reduce((o, c) => {
  const k = c.seg + ' ' + c.payer, cs = catSeries[k]['HC'];
  let head = 0, tail = 0;
  ['Season Pass (Free)', 'Season Pass (Paid)'].forEach(cat => { const s = cs.cats[cat]; if (!s) return;
    for (let d = 0; d < 30; d++) head += s[d]; for (let d = 30; d < D; d++) tail += s[d]; });
  o[k] = head > 0 ? r6((tail / 3) / (head / 30)) : null; return o;
}, {});

// ---- the four requested samples ----
const SAMPLES = [ { seg: '20-39', payer: 'NONPAYER', res: 'Chuck', day: 4 }, { seg: '40-99', payer: 'PAYER', res: 'HC', day: 12 },
                  { seg: '0-9', payer: 'NONPAYER', res: 'SPT', day: 20 }, { seg: '100+', payer: 'PAYER', res: 'Red', day: 27 } ];
result.samples = SAMPLES.map(sm => {
  const cell = result.per_cell[sm.seg + ' ' + sm.payer], R = cell && cell.resources[sm.res];
  if (!R) return { ...sm, error: 'cell/resource not present' };
  const d = sm.day - 1, act = R.actual[d], sim = R.sim[d];
  const comp = Object.keys(R.sim_by_category).map(cat => ({ category: cat, value: R.sim_by_category[cat].days[d],
      share_of_sim_day: sim > 0 ? r6(R.sim_by_category[cat].days[d] / sim) : null, family: R.sim_by_category[cat].family,
      cal_curr_instances: R.sim_by_category[cat].cal_curr_instances })).filter(x => x.value !== 0).sort((p, q) => q.value - p.value);
  return { cell: sm.seg + ' ' + sm.payer, resource: sm.res, day: sm.day, weekend: isWeekend_(sm.day),
           actual: act, sim_old: sim, delta: r6(sim - act), delta_pct: act > 0 ? r6(100 * (sim - act) / act) : null,
           actual_ma7: r6(ma7(R.actual.map(x => x || 0))[d]),
           window: { sum_actual: R.sum_actual, sum_sim: R.sum_sim, level_ratio: R.level_ratio_sim_over_actual, tv: R.tv, tv_noise_ma7: R.noise.tv_ma7, mape: R.mape, mape_shape: R.mape_shape },
           sim_composition: comp };
});

// Stage 2 (2026-10-14): harness/_probe_daily_alloc_toggles.js require()s this file for its loader,
// baseline series and metrics. When required, nothing is written or printed - the baseline is
// computed and handed over through module.exports at the bottom.
if (require.main === module) {
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));

// ---- readable summary ----
const f = (x, n) => x == null ? '   n/a' : (Math.round(x * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n).padStart(7);
console.log('DAILY ALLOCATION PROBE  data=' + result._meta.data + '  meta=' + (data._meta ? data._meta.source : '(no _meta record in dump)') + '  ' + DAILY_BUILD);
console.log('cells: ' + CELLS.length + '  econ_daily currencies: ' + ECON_RES.length + ' (' + RES.length + ' mapped' + (unmappedEcon.length ? '; UNMAPPED: ' + unmappedEcon.join(', ') : '') + ')' +
            '  engine resources with no actuals: ' + enginesWithoutActual.join(', '));
console.log('econ_daily rows ' + ownRows.total + ', max day_index ' + ownRows.maxDay + ', rows outside 1..33 ' + ownRows.outOfWindow + ', duplicate keys ' + ownRows.dup);
console.log('\nRECONCILIATION');
console.log('  sum_d sim_curr == measured window total (all cells x res): max abs err ' + result.reconcile.sim_vs_measured_window_maxabs);
console.log('  probe per-category sum == ECOGAINS_DAILY ALL/CURRENT:        max abs err ' + result.reconcile.probe_vs_ECOGAINS_DAILY_maxabs);
console.log('  engine econDaily_ == independent reader:                     max abs err ' + result.reconcile.engine_reader_vs_own_reader_maxabs);
console.log('  sum_d actual == data_econ.gain_per_earner:                   max rel err ' + result.reconcile.actual_vs_data_econ_max_rel + ', missing data_econ rows ' + result.reconcile.actual_vs_data_econ_missing);
console.log('  LEVEL: measured window (sim anchor) / data_econ window, by resource (median over cells; raw = data_gains only, meas = incl. synthetic anchors):');
RES.forEach(res => { const rows = result.reconcile.measured_window_vs_data_econ.filter(x => x.res === res);
  console.log('    ' + res.padEnd(16) + ' meas/econ ' + f(quantiles(rows.map(x => x.ratio_measured_over_econ)).median, 3) + '  raw/econ ' + f(quantiles(rows.map(x => x.ratio_raw_over_econ)).median, 3) +
              '  [min ' + f(quantiles(rows.map(x => x.ratio_measured_over_econ)).min, 3) + ' max ' + f(quantiles(rows.map(x => x.ratio_measured_over_econ)).max, 3) + ']'); });
console.log('\nBASELINE FIT (current allocation vs actual)        TV unw  TV massw | MAPE unw | MAPEshape | noise tv_ma7 | CV_ma7 | we/wd amp | best-lag votes');
RES.forEach(res => { const b = result.baseline_fit.per_resource[res], n = result.noise_floor.per_resource[res];
  console.log('  ' + res.padEnd(16) + f(b.tv.unweighted_mean, 3) + ' ' + f(b.tv.actual_mass_weighted, 3) + ' | ' + f(b.mape.unweighted_mean, 3) + ' | ' + f(b.mape_shape.unweighted_mean, 3) +
              ' |  ' + f(n.tv_ma7.unweighted_mean, 3) + '    | ' + f(n.cv_ma7.unweighted_mean, 3) + ' | ' + f(n.weekend_amp.unweighted_mean, 3) + ' | ' + JSON.stringify(b.best_lag_votes)); });
const O = result.baseline_fit.overall, N = result.noise_floor.overall;
console.log('  ' + 'ALL (n=' + O.tv.n + ')'.padEnd(10) + f(O.tv.unweighted_mean, 3) + ' ' + f(O.tv.actual_mass_weighted, 3) + ' | ' + f(O.mape.unweighted_mean, 3) + ' | ' + f(O.mape_shape.unweighted_mean, 3) +
            ' |  ' + f(N.tv_ma7.unweighted_mean, 3) + '    | ' + f(N.cv_ma7.unweighted_mean, 3) + ' | ' + f(N.weekend_amp.unweighted_mean, 3));
console.log('  TV quantiles ' + JSON.stringify(O.tv.quantiles) + '\n  noise tv_ma7 quantiles ' + JSON.stringify(N.tv_ma7.quantiles));
console.log('  TV <= 1x noise: ' + result.noise_floor.tv_within_noise.le_1x_tv_ma7 + '/' + result.noise_floor.tv_within_noise.n + ', <= 2x noise: ' + result.noise_floor.tv_within_noise.le_2x_tv_ma7 + '/' + result.noise_floor.tv_within_noise.n);
console.log('  mean TV by sim lag (days): ' + JSON.stringify(result.baseline_fit.lag_scan.mean_tv_by_lag) + '  best-lag votes all ' + JSON.stringify(result.baseline_fit.lag_scan.best_lag_votes_all) + ' HC ' + JSON.stringify(result.baseline_fit.lag_scan.hc_best_lag_votes));
if (result.baseline_fit.undefined_tv.length) console.log('  undefined TV (zero mass on one side): ' + result.baseline_fit.undefined_tv.map(x => x.cell + '/' + x.res + ' a=' + x.sum_actual + ' s=' + x.sum_sim).join('; '));
console.log('\nPER CELL (TV unweighted mean / mass-weighted / noise tv_ma7 / level ratio median)');
CELLS.forEach(c => { const k = c.seg + ' ' + c.payer, b = result.baseline_fit.per_cell[k], n = result.noise_floor.per_cell[k];
  console.log('  ' + k.padEnd(16) + f(b.tv.unweighted_mean, 3) + ' ' + f(b.tv.actual_mass_weighted, 3) + '  noise ' + f(n.tv_ma7.unweighted_mean, 3) + '  level ' + f(b.level_ratio.quantiles.median, 3)); });
console.log('\nFLAT-BRANCH categories (nonzero measured total, no cal_curr instance, not always-on):');
CELLS.forEach(c => { const k = c.seg + ' ' + c.payer; console.log('  ' + k.padEnd(16) + result.flat_branch[k].join(', ')); });
console.log('\nSAMPLES');
result.samples.forEach(sm => {
  console.log('  ' + sm.cell + ' / ' + sm.resource + ' / day ' + sm.day + (sm.weekend ? ' (weekend)' : ' (weekday)') + ':  actual ' + sm.actual + '  sim_old ' + sm.sim_old + '  delta ' + sm.delta + ' (' + sm.delta_pct + '%)  actual MA7 ' + sm.actual_ma7 +
              '  | window: level ' + sm.window.level_ratio + ' TV ' + sm.window.tv + ' noiseTV ' + sm.window.tv_noise_ma7 + ' MAPE ' + sm.window.mape + ' MAPEshape ' + sm.window.mape_shape);
  sm.sim_composition.forEach(x => console.log('      ' + x.category.padEnd(22) + f(x.value, 4) + '  ' + (x.share_of_sim_day == null ? '' : (100 * x.share_of_sim_day).toFixed(1) + '%') + '  ' + x.family + ' [' + x.cal_curr_instances + ' inst]'));
});
console.log('\nEXPERIMENTS (TV unweighted mean over 130 pairs; baseline ' + f(result.baseline_fit.overall.tv.unweighted_mean, 3) + ')');
Object.keys(result.experiments.runs).forEach(name => { const e = result.experiments.runs[name];
  console.log('  ' + name.padEnd(16) + 'TV ' + f(e.tv.unweighted_mean, 3) + '  massw ' + f(e.tv.actual_mass_weighted, 3) + '  improved/worsened/same ' + e.improved + '/' + e.worsened + '/' + e.unchanged + '  conserved ' + e.totals_conserved +
              '  | per-res: ' + RES.map(r => r + ' ' + (e.per_resource[r].tv_mean == null ? 'n/a' : e.per_resource[r].tv_mean.toFixed(3))).join(', ')); });
console.log('  Season Pass stub: per-day SP HC on days 31-33 / days 1-30 = ' + JSON.stringify(result.experiments.sp_stub_ratio));
console.log('\nwrote ' + OUT);
}

module.exports = {
  data, ctx, CELLS, RES, D, catSeries, allMetrics, result, SAMPLES, DATA_PATH,
  tv, mape, sum, mean, r6, quantiles, agg, ma7, noise, shifted, family, calCurInst,
  // engine globals the toggles need: eval'd into THIS module's scope, so they have to be handed over explicitly
  engine: { reachOne_, isWeekend_, curveRaw_, normalize_, measuredRow_, sptTotals_, readSPTrack_, readSPSeasonDays_, spTier_,
            num, hasAmount_, DAILY_ALWAYS, DAILY_LASTDAY, DAILY_MARGINAL, DAILY_PDAY_INST, DAILY_CAL_LABEL, CATEGORY_ORDER, RESOURCES, DAILY_BUILD },
};
