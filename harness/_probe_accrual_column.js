// Accrual-column probe (2026-10-14). NOT a gate - a measurement tool. Nothing random, no engine file
// touched, nothing written outside --out.
//
// QUESTION. The Daily allocator places the DAILY_MARGINAL family (Hatchling Hideaway, Bomb's Ballet,
// Jigsaw, Photoshoot) inside each instance by the marginal of the accrual curve, and that curve is
// read from data_event_accrual.cum_token_share_p50 (engine/EcoGainsSim_v4.gs, DataStore.accIndex).
// A fault claim says the P50 is the median PLAYER's cumulative share, not the cohort's, and that
// cum_token_share_mean should be read for day allocation instead. This probe measures what that swap
// would change - ALLOCATION ONLY: every window total W is taken from the UNPATCHED context (so the D
// term inside resultRow_ never sees the patched curve) and only dayWeights_ is handed the patched
// DataStore. It reports:
//   1. the within-instance day shares, p50 vs mean, per cell and instance length;
//   2. the Daily view: largest per-day change per (cell, category, side) and how big it is against the
//      ALL block on that day;
//   3. the 7-day window (WIN7 6..13): which category/resource sums move (instances straddling an edge);
//   4. the fit against data_econ_daily on cal_curr (the plan's own TV metric), base vs mean-curve;
//   5. the D-term blast radius if the column were swapped GLOBALLY at the reader (what the fault's
//      "keep p50 for D" caveat protects): accrualD_ under both columns;
//   6. the _mock_daily.js HH shape gate (day2 > day1 and day4 ~ 0) evaluated under the mean curve;
//   7. the T3 (leaderboard-curve) toggle of the Opus plan: cal_curr instance lengths of its categories
//      and the marginal vectors under both columns.
//   node harness/_probe_accrual_column.js [--data <dump>] [--out <json>]
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA_ARG = arg('--data', '_mockdata.json');
const DATA_PATH = path.isAbsolute(DATA_ARG) || DATA_ARG.indexOf('/') >= 0 || DATA_ARG.indexOf('\\') >= 0
  ? DATA_ARG : path.join(__dirname, DATA_ARG);
const OUT = arg('--out', path.join(__dirname, '..', 'analysis', 'out', 'accrual_column_probe.json'));
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
const r4 = (x) => (x == null || !isFinite(x)) ? null : Math.round(x * 1e4) / 1e4;
const r6 = (x) => (x == null || !isFinite(x)) ? null : Math.round(x * 1e6) / 1e6;
function tv(a, s) { const sa = sum(a), ss = sum(s); if (!(sa > 0) || !(ss > 0)) return null;
  let t = 0; for (let d = 0; d < a.length; d++) t += Math.abs(a[d] / sa - s[d] / ss); return 0.5 * t; }
function mapeShape(a, s) { const sa = sum(a), ss = sum(s); if (!(sa > 0) || !(ss > 0)) return null;
  const xs = []; for (let d = 0; d < a.length; d++) if (a[d] > 0) xs.push(Math.abs(s[d] * sa / ss - a[d]) / a[d]); return xs.length ? mean(xs) : null; }

// ---- the patched DataStore: the MEAN column written where the reader expects the p50 ----
const accVals = sheetVals_('data_event_accrual');
const ah = headerIndex_(accVals[0] || []);
if (ah['cum_token_share_mean'] == null || ah['cum_token_share_p50'] == null) throw new Error('data_event_accrual lacks the mean/p50 columns');
const accMean = accVals.map((r, i) => { const c = r.slice(); if (i) c[ah['cum_token_share_p50']] = r[ah['cum_token_share_mean']]; return c; });
const dsMean = DataStore.fromRanges(sheetVals_('data_gains'), sheetVals_('data_seg_beh'), accMean, sheetVals_('data_event_kite_accrual'),
                                    sheetVals_('data_RM'), sheetVals_('data_streaks'), sheetVals_('data_event_inst'));
const ctx = Context.get();
const MARG = Object.keys(DAILY_MARGINAL);
const SEG_ORDER = ['0-9', '10-19', '20-39', '40-99', '100+'];
const CELLS = []; SEG_ORDER.forEach(seg => ['NONPAYER', 'PAYER'].forEach(payer => { if (Object.keys(ctx.ds.beh(seg, payer)).length) CELLS.push({ seg, payer }); }));
const NONPACK = RESOURCES.filter(r => !isPackRes_(r));
const W7 = win7Bounds_();

function rates(seg, payer) { const b = ctx.ds.beh(seg, payer); let pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)) { pWd = 1; pWe = 1; } return { pWd, pWe, pDay: (d) => isWeekend_(d) ? pWe : pWd }; }
function seriesWith(cat, seg, payer, isNew, ds) {   // W from the UNPATCHED ctx; weights from `ds`
  const W = isNew ? resultRow_(cat, seg, payer, ctx) : measuredRow_(cat, seg, payer, ctx.ds);
  const insts = ((isNew ? ctx.calNew : ctx.calCur)[DAILY_CAL_LABEL[cat]]) || [];
  const { pWd, pWe } = rates(seg, payer);
  const w = hasAmount_(W) ? dayWeights_(cat, insts, pWd, pWe, ds, seg, payer) : new Array(D).fill(0);
  const out = {}; NONPACK.forEach(r => { out[r] = w.map(x => num(W[r]) * x); }); return { W, w, out, insts };
}

const result = { _meta: { probe: 'harness/_probe_accrual_column.js', run: new Date().toISOString(), data: path.relative(path.join(__dirname, '..'), DATA_PATH).replace(/\\/g, '/'),
  data_meta: data._meta || null, daily_build: DAILY_BUILD, win7: W7, marginal_family: MARG, cells: CELLS.map(c => c.seg + ' ' + c.payer) } };

// ---- 0. self-check: the p50 rebuild equals the engine's own dailySeries_ bit for bit ----
let selfMax = 0;
CELLS.forEach(({ seg, payer }) => MARG.forEach(cat => [false, true].forEach(isNew => {
  const mine = seriesWith(cat, seg, payer, isNew, ctx.ds).out, eng = dailySeries_(cat, seg, payer, ctx, isNew);
  NONPACK.forEach(r => { for (let d = 0; d < D; d++) selfMax = Math.max(selfMax, Math.abs(mine[r][d] - num(eng[d][r]))); });
})));
result.self_check = { p50_rebuild_vs_engine_dailySeries_maxabs: r6(selfMax) };

// ---- 1. within-instance day shares, p50 vs mean ----
result.inner_shares = {};
CELLS.forEach(({ seg, payer }) => { const k = seg + ' ' + payer; result.inner_shares[k] = {};
  MARG.forEach(cat => { const { pDay } = rates(seg, payer); const o = {};
    [false, true].forEach(isNew => { const insts = ((isNew ? ctx.calNew : ctx.calCur)[DAILY_CAL_LABEL[cat]]) || [];
      insts.forEach(inst => { const n = inst.days.length; if (o[n]) return;
        o[n] = { p50: innerWeights_(cat, inst, pDay, ctx.ds, seg, payer).map(r4), mean: innerWeights_(cat, inst, pDay, dsMean, seg, payer).map(r4) }; }); });
    result.inner_shares[k][cat] = o; }); });

// ---- 2./3. Daily view and 7-day window ----
const all = { cur: {}, nw: {} };
CELLS.forEach(({ seg, payer }) => { const k = seg + ' ' + payer; all.cur[k] = ECOGAINS_DAILY(payer, seg, 'ALL', 'CURRENT'); all.nw[k] = ECOGAINS_DAILY(payer, seg, 'ALL', 'NEW'); });
result.daily_view = []; result.win7 = [];
const cellMean = {};   // cell -> res -> mean-curve cal_curr series of the marginal cats (for the fit)
const cellBase = {};
CELLS.forEach(({ seg, payer }) => { const k = seg + ' ' + payer; cellMean[k] = {}; cellBase[k] = {}; NONPACK.forEach(r => { cellMean[k][r] = new Array(D).fill(0); cellBase[k][r] = new Array(D).fill(0); });
  MARG.forEach(cat => [false, true].forEach(isNew => {
    const a = seriesWith(cat, seg, payer, isNew, ctx.ds), b = seriesWith(cat, seg, payer, isNew, dsMean);
    if (!hasAmount_(a.W)) return;
    let best = null; const grid = all[isNew ? 'nw' : 'cur'][k];
    NONPACK.forEach(r => { const j = RESOURCES.indexOf(r);
      if (!isNew) for (let d = 0; d < D; d++) { cellBase[k][r][d] += a.out[r][d]; cellMean[k][r][d] += b.out[r][d]; }
      for (let d = 0; d < D; d++) { const delta = b.out[r][d] - a.out[r][d]; if (!delta) continue;
        const allv = num(grid[d][j]);
        const rec = { res: r, day: d + 1, p50: r4(a.out[r][d]), mean: r4(b.out[r][d]), delta: r4(delta), rel_vs_p50: a.out[r][d] > 0 ? r4(delta / a.out[r][d]) : null,
                      all_block_that_day: r4(allv), delta_share_of_all: allv > 0 ? r4(Math.abs(delta) / allv) : null };
        if (!best || Math.abs(rec.delta_share_of_all || 0) > Math.abs(best.delta_share_of_all || 0)) best = rec; } });
    const conserved = NONPACK.every(r => Math.abs(sum(a.out[r]) - sum(b.out[r])) < 1e-9);
    result.daily_view.push({ cell: k, cat, side: isNew ? 'NEW (cal_new)' : 'CURRENT (cal_curr)', instances: a.insts.map(i => i.days[0] + '..' + i.days[i.days.length - 1]), totals_conserved: conserved, largest_change_vs_all_block: best });
    // 7-day window sums (the 7-day view SUMS the daily allocation over W7.a..W7.b)
    NONPACK.forEach(r => { let s50 = 0, smu = 0; for (let d = W7.a; d <= W7.b; d++) { s50 += a.out[r][d - 1]; smu += b.out[r][d - 1]; }
      if (Math.abs(s50 - smu) > 1e-9) result.win7.push({ cell: k, cat, side: isNew ? 'NEW' : 'CURRENT', res: r, win7_p50: r4(s50), win7_mean: r4(smu), delta: r4(smu - s50), rel: s50 > 0 ? r4((smu - s50) / s50) : null }); });
  })); });

// ---- 4. fit against the actuals on cal_curr (the plan's metric) ----
const fit = [];
CELLS.forEach(({ seg, payer }) => { const k = seg + ' ' + payer; const econ = econDaily_(seg, payer); if (!econ) return;
  const base = {}; NONPACK.forEach(r => { base[r] = new Array(D).fill(0); });
  CATEGORY_ORDER.forEach(cat => { const s = dailySeries_(cat, seg, payer, ctx, false); NONPACK.forEach(r => { for (let d = 0; d < D; d++) base[r][d] += num(s[d][r]); }); });
  NONPACK.forEach(r => { const a = econ.gain.map(o => num(o[r])); if (!(sum(a) > 0) || !(sum(base[r]) > 0)) return;
    const alt = base[r].map((x, d) => x - cellBase[k][r][d] + cellMean[k][r][d]);
    const affected = sum(cellBase[k][r]) > 0;
    fit.push({ cell: k, res: r, affected, marg_share_of_sim: r4(sum(cellBase[k][r]) / sum(base[r])), tv_p50: tv(a, base[r]), tv_mean: tv(a, alt), ms_p50: mapeShape(a, base[r]), ms_mean: mapeShape(a, alt), conserved: Math.abs(sum(alt) - sum(base[r])) < 1e-9 }); }); });
function aggFit(rows) { const d = rows.filter(x => x.tv_p50 != null && x.tv_mean != null);
  return { n: d.length, tv_p50_mean: r6(mean(d.map(x => x.tv_p50))), tv_mean_mean: r6(mean(d.map(x => x.tv_mean))), improvement_pct: r6(100 * (mean(d.map(x => x.tv_p50)) - mean(d.map(x => x.tv_mean))) / mean(d.map(x => x.tv_p50))),
    mape_shape_p50: r6(mean(d.map(x => x.ms_p50))), mape_shape_mean: r6(mean(d.map(x => x.ms_mean))),
    improved: d.filter(x => x.tv_mean < x.tv_p50 - 1e-9).length, worsened: d.filter(x => x.tv_mean > x.tv_p50 + 1e-9).length, unchanged: d.filter(x => Math.abs(x.tv_mean - x.tv_p50) <= 1e-9).length, conserved: rows.every(x => x.conserved) }; }
result.fit = { all_pairs: aggFit(fit), affected_pairs: aggFit(fit.filter(x => x.affected)),
  per_resource: NONPACK.reduce((o, r) => { const rows = fit.filter(x => x.res === r && x.affected); if (rows.length) o[r] = aggFit(rows); return o; }, {}),
  largest_moves: fit.filter(x => x.affected).map(x => ({ cell: x.cell, res: x.res, marg_share_of_sim: x.marg_share_of_sim, tv_p50: r4(x.tv_p50), tv_mean: r4(x.tv_mean), d_tv: r4(x.tv_mean - x.tv_p50) })).sort((p, q) => Math.abs(q.d_tv) - Math.abs(p.d_tv)).slice(0, 12) };

// ---- 5. D-term blast radius of a GLOBAL column swap (NOT the fault's proposal; what the caveat protects) ----
const ACCR = { 'Hatchling Hideaway': 'Hatchling Hideaway', "Bomb's Ballet": 'Bombs Ballet', 'Jigsaw': 'Jigsaw', 'Photoshoot': 'Photoshoot' };
result.d_term_if_swapped_globally = {};
MARG.forEach(cat => { const lab = DAILY_CAL_LABEL[cat]; const curDur = modalDur_(ctx.calCur[lab] || []), newDur = modalDur_(ctx.calNew[lab] || []);
  const rows = CELLS.map(({ seg, payer }) => { const d50 = curDur === newDur ? 1 : accrualD_(ctx.ds, ACCR[cat], curDur, newDur, seg, payer, false), dmu = curDur === newDur ? 1 : accrualD_(dsMean, ACCR[cat], curDur, newDur, seg, payer, false);
    return { cell: seg + ' ' + payer, D_p50: r4(d50), D_mean: r4(dmu), new_total_ratio_mean_over_p50: r4(dmu / d50) }; });
  result.d_term_if_swapped_globally[cat] = { curDur, newDur, cells: rows, ratio_range: [Math.min(...rows.map(x => x.new_total_ratio_mean_over_p50)), Math.max(...rows.map(x => x.new_total_ratio_mean_over_p50))] }; });

// ---- 6. the _mock_daily.js HH shape gate under the mean curve ----
{ const seg = '0-9', payer = 'NONPAYER', cat = 'Hatchling Hideaway';
  const a = seriesWith(cat, seg, payer, true, ctx.ds), b = seriesWith(cat, seg, payer, true, dsMean);
  const inst = a.insts.find(i => i.days.length === 4); const UL = 'Unlimited Lives';
  const pick = (s) => inst.days.map(d => s.out[UL][d - 1]);
  const g = (h) => ({ days: pick(h).map(r4), day2_gt_day1: pick(h)[1] > pick(h)[0], day4_approx_0: pick(h)[3] < 1e-9, passes: pick(h)[1] > pick(h)[0] && pick(h)[3] < 1e-9 });
  result.mock_daily_hh_gate = { instance_days: inst.days, under_p50: g(a), under_mean: g(b) }; }

// ---- 7. the plan's T3 toggle: instance lengths of its categories and the marginal vectors under both columns ----
const T3 = { 'Bomb Challenge': 'Bomb', 'Chuck Challenge': 'Chuck', 'Red Challenge': 'Red', 'Flash Race': 'Flash Race', 'Level Race': 'Level Race', 'Target Day': 'Target Day', 'Flock Flurry': 'Flock Flurry' };
function marginalOf(curve, n) { const o = []; for (let j = 1; j <= n; j++) o.push(Math.max(0, curveRaw_(curve, j) - curveRaw_(curve, j - 1))); return normalize_(o); }
result.t3 = {};
Object.keys(T3).forEach(cat => { const insts = ctx.calCur[DAILY_CAL_LABEL[cat]] || []; const lens = [...new Set(insts.map(i => i.days.length))].sort();
  const c50 = ctx.ds.accrualCurve(T3[cat], '20-39', 'NONPAYER', false), cmu = dsMean.accrualCurve(T3[cat], '20-39', 'NONPAYER', false);
  result.t3[cat] = { cal_curr_instance_lengths: lens, curve_days: c50.map(x => x.day), p50_curve: c50.map(x => r4(x.share)), mean_curve: cmu.map(x => r4(x.share)),
    marginal_by_len: lens.reduce((o, n) => { o[n] = { p50: marginalOf(c50, n).map(r4), mean: marginalOf(cmu, n).map(r4), identical: marginalOf(c50, n).every((x, j) => Math.abs(x - marginalOf(cmu, n)[j]) < 1e-12) }; return o; }, {}),
    curvelen_2d: { p50: marginalOf(c50, 2).map(r4), mean: marginalOf(cmu, 2).map(r4) } }; });

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));

// ---- readable summary ----
const f = (x, n) => x == null ? 'n/a' : (Math.round(x * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n);
console.log('ACCRUAL COLUMN PROBE  data=' + result._meta.data + '  ' + DAILY_BUILD + '  WIN7 ' + W7.a + '..' + W7.b);
console.log('self-check: p50 rebuild vs engine dailySeries_ max abs err ' + result.self_check.p50_rebuild_vs_engine_dailySeries_maxabs);
console.log('\n1. WITHIN-INSTANCE DAY SHARES (p50 -> mean), 20-39 PAYER and 0-9 NONPAYER');
['20-39 PAYER', '0-9 NONPAYER'].forEach(k => MARG.forEach(cat => Object.keys(result.inner_shares[k][cat]).forEach(n => { const o = result.inner_shares[k][cat][n];
  console.log('  ' + k.padEnd(14) + cat.padEnd(20) + n + 'd  p50 ' + JSON.stringify(o.p50) + '  mean ' + JSON.stringify(o.mean)); })));
console.log('\n2. DAILY VIEW: largest per-day change per (cell, category, side), measured against the ALL block that day');
result.daily_view.forEach(x => { const b = x.largest_change_vs_all_block; if (!b) return;
  console.log('  ' + x.cell.padEnd(15) + x.cat.padEnd(20) + x.side.padEnd(19) + 'inst ' + x.instances.join(',').padEnd(28) + ' ' + b.res.padEnd(16) + 'day ' + String(b.day).padStart(2) + '  ' + f(b.p50, 3) + ' -> ' + f(b.mean, 3) + '  (' + f(100 * b.rel_vs_p50, 0) + '% of its own, ' + f(100 * b.delta_share_of_all, 1) + '% of ALL ' + f(b.all_block_that_day, 2) + ')  conserved ' + x.totals_conserved); });
console.log('\n3. 7-DAY WINDOW sums that move (' + result.win7.length + ' (cell,cat,side,res) entries):');
const byCatSide = {}; result.win7.forEach(x => { const k = x.cat + ' | ' + x.side; byCatSide[k] = byCatSide[k] || []; byCatSide[k].push(x); });
Object.keys(byCatSide).forEach(k => { const rows = byCatSide[k]; const rel = rows.map(x => x.rel).filter(x => x != null);
  console.log('  ' + k.padEnd(32) + rows.length + ' entries, rel change range ' + f(Math.min(...rel), 3) + ' .. ' + f(Math.max(...rel), 3) + '  e.g. ' + rows[0].cell + ' ' + rows[0].res + ' ' + f(rows[0].win7_p50, 3) + ' -> ' + f(rows[0].win7_mean, 3)); });
console.log('\n4. FIT vs data_econ_daily on cal_curr (TV, lower is better)');
[['all 130 pairs', result.fit.all_pairs], ['pairs where a marginal category carries mass', result.fit.affected_pairs]].forEach(([lab, a]) =>
  console.log('  ' + lab.padEnd(46) + 'n ' + a.n + '  TV p50 ' + f(a.tv_p50_mean, 5) + ' -> mean ' + f(a.tv_mean_mean, 5) + ' (' + f(a.improvement_pct, 2) + '% better)  MAPEshape ' + f(a.mape_shape_p50, 4) + ' -> ' + f(a.mape_shape_mean, 4) + '  improved/worsened/same ' + a.improved + '/' + a.worsened + '/' + a.unchanged + '  conserved ' + a.conserved));
Object.keys(result.fit.per_resource).forEach(r => { const a = result.fit.per_resource[r]; console.log('    ' + r.padEnd(16) + 'n ' + String(a.n).padStart(2) + '  TV ' + f(a.tv_p50_mean, 4) + ' -> ' + f(a.tv_mean_mean, 4) + ' (' + f(a.improvement_pct, 2) + '%)  improved/worsened ' + a.improved + '/' + a.worsened); });
console.log('  largest TV moves: ' + result.fit.largest_moves.slice(0, 6).map(x => x.cell + '/' + x.res + ' ' + f(x.tv_p50, 4) + '->' + f(x.tv_mean, 4) + ' (marg share ' + f(100 * x.marg_share_of_sim, 0) + '%)').join('; '));
console.log('\n5. D TERM if the column were swapped GLOBALLY at the reader (33-day NEW totals would scale by):');
MARG.forEach(cat => { const o = result.d_term_if_swapped_globally[cat]; console.log('  ' + cat.padEnd(20) + 'dur ' + o.curDur + 'd -> ' + o.newDur + 'd   ratio mean/p50 ' + f(o.ratio_range[0], 3) + ' .. ' + f(o.ratio_range[1], 3) + '   e.g. ' + o.cells[4].cell + ' D ' + f(o.cells[4].D_p50, 3) + ' -> ' + f(o.cells[4].D_mean, 3)); });
console.log('\n6. _mock_daily.js:146 HH gate (0-9 NONPAYER, NEW 4d instance ' + result.mock_daily_hh_gate.instance_days + ', UL Lives): p50 ' + JSON.stringify(result.mock_daily_hh_gate.under_p50) + '\n   mean ' + JSON.stringify(result.mock_daily_hh_gate.under_mean));
console.log('\n7. T3 categories on cal_curr (20-39 NONPAYER curves):');
Object.keys(result.t3).forEach(cat => { const o = result.t3[cat]; console.log('  ' + cat.padEnd(16) + 'inst lengths ' + JSON.stringify(o.cal_curr_instance_lengths) + '  p50 ' + JSON.stringify(o.p50_curve) + ' mean ' + JSON.stringify(o.mean_curve) + '  marginal by len ' + JSON.stringify(o.marginal_by_len) + '  curvelen 2d p50 ' + JSON.stringify(o.curvelen_2d.p50) + ' mean ' + JSON.stringify(o.curvelen_2d.mean)); });
console.log('\nwrote ' + OUT);
