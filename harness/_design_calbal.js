// Calendar-rebalance designer (2026-10-30). Not a gate - the tool behind display/Calendar_Rebalance_v1.xlsx.
//
// The question: LIVE_OPS_V3 (8)'s new cal_new changes how often and how long events run (Bomb's Ballet 2x3d -> 4x2d,
// Jigsaw 2x3d -> 4x2d, Hatchling 4d -> 3d, Kite 4x3d -> 4x3d + 4x2d, Target Day 11 -> 19, Rainbow Maker 4x4d -> 8x2d).
// Rebalance the _v2 configs (nothing else from the 2026-10-30 config proposals applied) so that every resource's
// gain lands back where it was BEFORE the calendar swap (cal_new := cal_curr, same configs - analysis/out/
// calbal_base_cur.json), with Kite Festival allowed to grow ~+50% and Target Day ~+35% and the other events absorbing
// that growth (user decisions 2026-10-30). Flock Flurry is left alone (user decision).
//
// HOW. The engine is linear in every ladder entry once the requirements are fixed (R = E_v2/E_base, the pack lane,
// the base-0 additions and the Rainbow Maker walk are all sums of entry x weight). So per ladder the designer
//   1. sets the requirements (completion kept per segment: collections by the accrual pace of the shorter event,
//      Rainbow Maker by the live matchables at the end of day 2 vs day 4),
//   2. measures each entry's weight by perturbing it in the ENGINE (+1, re-run the lane over the 10 cells,
//      population-weighted),
//   3. fits integer rewards (nice steps: coins / SPT / minutes in 5s) to the per-resource target.
// Targets are population-weighted over all ten segment x payer cells (one ladder serves both payer types).
//
//   node harness/_design_calbal.js [--ref analysis/out/calbal_base_cur.json] [--out analysis/out/calbal_patches.json]
//        [--kite 1.5] [--kite2d 0.667] [--tad 1.35] [--resid analysis/out/calbal_eval.json]
//   --resid: a probe run of a previous patch set; its per-resource gap to the reference is added to the absorbers'
//            targets (second pass for the second-order lanes: Season Pass tier, ToF ticket income, Core's buff SPT)
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', path.join(__dirname, '_mockdata_v3h.json'));
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const PRELUDE = CARDS.slice(0, CARDS.indexOf('// ---------------------------------------------------------------- 1. PackConfig reader'));

function DESIGN(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const ROOT = path.dirname(__dirname);
  const refFile = arg('--ref', path.join(ROOT, 'analysis/out/calbal_base_cur.json'));
  const outFile = arg('--out', path.join(ROOT, 'analysis/out/calbal_patches.json'));
  const residFile = arg('--resid', null);
  const KITE = +arg('--kite', 1.5), KITE2D = +arg('--kite2d', 2 / 3), TAD = +arg('--tad', 1.35);
  const REF = JSON.parse(fs.readFileSync(refFile, 'utf8'));
  const log = (...a) => console.log(...a);

  // ------------------------------------------------------------------ sheet access + patch log
  const ORIG = {};                                    // sheet -> deep copy of the values as dumped
  const snap = (s) => { if (!ORIG[s]) ORIG[s] = JSON.parse(JSON.stringify(data[s].values)); };
  const colL = (c) => { let s = ''; c++; while (c > 0){ const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; };
  const get = (s, r, c) => { const v = data[s].values; return (v[r] && v[r][c] !== undefined) ? v[r][c] : ''; };
  const set = (s, r, c, x) => { snap(s); const v = data[s].values; while (v.length <= r) v.push([]); while (v[r].length <= c) v[r].push(''); v[r][c] = x; };
  const N = (x) => { const n = Number(x); return isFinite(n) ? n : 0; };

  // ------------------------------------------------------------------ evaluation
  const cells = cloudPermutations_();
  resetSheetCache_mock();
  let ctx = Context.get();
  const POP = {}; let POPT = 0;
  cells.forEach(c => { POP[c.label] = N(ctx.ds.beh(c.seg, c.payer).unique_players); POPT += POP[c.label]; });
  const evalCat = (cat) => {                          // {label: row}
    resetSheetCache_mock(); ctx = Context.get();
    const out = {}; cells.forEach(c => { out[c.label] = resultRow_(cat, c.seg, c.payer, ctx); }); return out;
  };
  const pooled = (rows, res, filt) => { let s = 0; cells.forEach(c => { if (filt && !filt(c)) return; s += POP[c.label] * N(rows[c.label][res]); }); return s / POPT; };
  // the target each lane / cell is pulled to: 'meas' = the CURRENT economy (control; user decision 2026-11-01:
  // variant - control as close to 0 as possible, within ~1.5% per resource), 'sim' = the before-swap reference
  const SIDE = arg('--target', 'meas');
  const refLane = (cat, res, filt) => { let s = 0; cells.forEach(c => { if (filt && !filt(c)) return; s += POP[c.label] * N(REF.cells[c.label][SIDE][cat][res]); }); return s / POPT; };
  const refMeas = (cat, res, filt) => { let s = 0; cells.forEach(c => { if (filt && !filt(c)) return; s += POP[c.label] * N(REF.cells[c.label].meas[cat][res]); }); return s / POPT; };
  const ITEM = (() => { const v = data['item_vals'].values, o = {}; (v[1] || []).forEach((h, c) => { const k = RES_MAP[String(h || '').trim()]; if (k) o[k] = N((v[2] || [])[c]); });
    o['ToF_Ticket'] = N((v[2] || [])[(v[1] || []).map(x => String(x).trim()).indexOf('ToF_Value')]); return o; })();
  const valueOf = (f) => RESOURCES.reduce((a, r) => a + f(r) * (ITEM[r] || 0), 0);

  // ------------------------------------------------------------------ ladders
  // A ladder = variables {res, at:[[sheet,r,c],...] (0-based; several = linked cells set together), a (current value)}
  // grouped by perturbation key (vars of one group have distinct resources).
  const STEP5 = { 'HC': 1, 'SPT': 1, 'SPTx2': 1, 'Unlimited Lives': 1, 'UL Red': 1, 'UL Chuck': 1, 'UL Bomb': 1 };
  // coins / SPT / buff minutes in steps of 5 once they are 10 or more (no 7-minute boosts)
  // minutes (Unlimited Lives / UL birds / SPT x2) in 5s only from 20 up - below that a 5-minute step is a 25-50%
  // jump and the per-resource totals cannot land inside 1.5% (2026-11-01: the target is variant = control)
  const MINUTES = { 'Unlimited Lives': 1, 'UL Red': 1, 'UL Chuck': 1, 'UL Bomb': 1, 'SPTx2': 1 };
  const stepOf = (res, a) => (STEP5[res] && a >= (MINUTES[res] ? 20 : 10)) ? 5 : 1;
  const isCount = (res) => !STEP5[res];
  const MAX_M = 2;                                    // no entry more than doubled
  // how far one entry may move: a count item (booster, envelope, ticket) never grows past what the rung had
  // when the ladder is cut, and grows by at most its share when it is raised - no piling 13 envelopes onto one
  // cheap rung to hit a decimal; a value (coins, minutes, SPT) stays within 0.6x..1.4x of its share
  function bounds(res, a, m, st){
    if (isCount(res)) return m <= 1 ? [0, a] : [a, Math.max(a, Math.ceil(m * a))];
    const r5 = (x) => Math.round(x / st) * st;
    return [Math.max(0, r5(0.6 * m * a)), r5(1.4 * m * a) + st];
  }
  function rowVars(sheet, r0, cols, key){            // one row, all mapped resource columns
    return Object.keys(cols).map(res => ({ res, at: [[sheet, r0, cols[res]]], a: N(get(sheet, r0, cols[res])), key }));
  }
  function specLadder(spec, sheet, rows){             // LB/COLL spec rows (0-based) on `sheet`
    const v = data[sheet].values, cols = rewCols_(v, spec.hdr, spec.c0, spec.c1);
    let vars = [];
    rows.forEach(r => { vars = vars.concat(rowVars(sheet, r, cols, sheet + ':' + r)); });
    return vars;
  }
  function msVars(spec, sheet){
    if (!spec.ms) return [];
    const v = data[sheet].values, cols = rewCols_(v, spec.ms.hdr, spec.ms.c0, spec.ms.c1);
    let vars = [];
    for (let r = spec.ms.r0; r <= spec.ms.r1; r++) vars = vars.concat(rowVars(sheet, r, cols, sheet + ':ms' + r));
    return vars;
  }
  const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
  function hdrCols(sheet, hdrRow){                    // RES_MAP columns of a header row (0-based)
    const h = data[sheet].values[hdrRow] || [], o = {};
    h.forEach((x, c) => { const k = RES_MAP[String(x == null ? '' : x).trim()]; if (k && o[k] === undefined) o[k] = c; });
    return o;
  }

  // weights: perturb every group by +1, re-run the lane. Returns w[varIndex] (pooled over all cells) and L0.
  function weights(cat, vars){
    const base = evalCat(cat), L0 = {}, L0c = {};
    RESOURCES.forEach(r => { L0[r] = pooled(base, r); L0c[r] = cells.map(c => N(base[c.label][r])); });
    const groups = {}; vars.forEach((x, i) => { (groups[x.key] = groups[x.key] || []).push(i); });
    const w = new Array(vars.length).fill(0), wc = new Array(vars.length).fill(null);
    Object.keys(groups).forEach(k => {
      const idx = groups[k];
      idx.forEach(i => vars[i].at.forEach(([s, r, c]) => set(s, r, c, N(get(s, r, c)) + 1)));
      const pr = evalCat(cat);
      idx.forEach(i => { const res = vars[i].res; w[i] = pooled(pr, res) - L0[res];
        wc[i] = cells.map(c => N(pr[c.label][res]) - N(base[c.label][res])); });
      idx.forEach(i => vars[i].at.forEach(([s, r, c]) => set(s, r, c, N(get(s, r, c)) - 1)));
    });
    return { w, wc, L0, L0c };
  }
  // integer fit of one resource's variables to `target` (= sum w*b, intercept excluded)
  function fitRes(vs, w, target){
    const S = vs.reduce((a, x, i) => a + w[i] * x.a, 0);
    if (!(Math.abs(S) > 1e-12)) return { b: vs.map(x => x.a), m: 1, err: target - S, S };
    const m = Math.min(MAX_M, Math.max(0, target / S));   // no entry more than doubled
    const st = vs.map(x => stepOf(x.res, Math.max(x.a, m * x.a)));
    const bd = vs.map((x, i) => bounds(x.res, x.a, m, st[i]));
    const b = vs.map((x, i) => x.a > 0 ? Math.min(bd[i][1], Math.max(bd[i][0], Math.round(m * x.a / st[i]) * st[i])) : 0);
    let err = target - b.reduce((a, y, i) => a + w[i] * y, 0);
    for (let it = 0; it < 2000; it++){
      let best = null;
      vs.forEach((x, i) => {
        if (!(x.a > 0) || !(w[i] > 1e-12)) return;
        [st[i], -st[i]].forEach(d => {
          if (b[i] + d < bd[i][0] || b[i] + d > bd[i][1]) return;
          const e2 = err - w[i] * d;
          if (Math.abs(e2) >= Math.abs(err) - 1e-12) return;
          const dev = Math.abs(b[i] + d - m * x.a) / Math.max(st[i], m * x.a);
          const score = Math.abs(e2) + 1e-6 * dev;
          if (!best || score < best.score) best = { i, d, e2, score };
        });
      });
      if (!best) break;
      b[best.i] += best.d; err = best.e2;
    }
    return { b, m, err, S };
  }
  // fit a ladder's resources to per-resource targets on the LANE total (intercept handled here)
  function fitLadder(name, cat, vars, targetOf, opts){
    opts = opts || {};
    const { w, L0 } = weights(cat, vars);
    const report = {};
    RESOURCES.forEach(res => {
      const idx = vars.map((x, i) => i).filter(i => vars[i].res === res && (!opts.only || opts.only.indexOf(res) >= 0));
      if (!idx.length) return;
      const tgt = targetOf(res);
      if (tgt == null) return;
      const vs = idx.map(i => vars[i]), ws = idx.map(i => w[i]);
      const lin = vs.reduce((a, x, i) => a + ws[i] * x.a, 0);
      const c0 = (opts.L0 || L0)[res] - lin - (opts.extra ? opts.extra(res) : 0);
      const f = fitRes(vs, ws, tgt - c0);
      if (!(Math.abs(f.S) > 1e-12)) return;
      vs.forEach((x, i) => { x.b = f.b[i]; });
      report[res] = { target: tgt, before: (opts.L0 || L0)[res], fitted: c0 + vs.reduce((a, x, i) => a + ws[i] * x.b, 0), m: f.m };
    });
    vars.forEach(x => { if (x.b !== undefined && x.b !== x.a) x.at.forEach(([s, r, c]) => set(s, r, c, x.b)); });
    log('  ' + name + ': ' + Object.keys(report).map(r => r + ' ' + report[r].before.toFixed(2) + '->' + report[r].fitted.toFixed(2) + ' (tgt ' + report[r].target.toFixed(2) + ', x' + report[r].m.toFixed(2) + ')').join(' | '));
    return { report, w, L0, vars };
  }

  // ------------------------------------------------------------------ completion models
  const dsNow = () => { resetSheetCache_mock(); ctx = Context.get(); return ctx.ds; };
  function collSurv(instName, c){
    const inst = ctx.ds.eventInst(instName, c.seg, c.payer);
    return inst ? survival_([[N(inst.final_balance_p25), .25], [N(inst.final_balance_p50), .5], [N(inst.final_balance_p75), .75]]) : null;
  }
  // per cell: {done: share past the last requirement, frac: expected share of milestones reached}
  function collCompletion(instName, reqs, scale){
    const out = {};
    cells.forEach(c => { const S = collSurv(instName, c); if (!S) return; const k = scale ? scale(c) : 1;
      const live = reqs.filter(x => x > 0);
      out[c.label] = { done: S(live[live.length - 1] / k), frac: live.reduce((a, q) => a + S(q / k), 0) / live.length }; });
    return out;
  }
  const popMean = (obj, f) => { let s = 0, w = 0; cells.forEach(c => { if (!obj[c.label]) return; s += POP[c.label] * f(obj[c.label]); w += POP[c.label]; }); return w ? s / w : 0; };
  const segTable = (before, after) => ['0-9', '10-19', '20-39', '40-99', '100+'].map(seg => {
    const f = (o, k) => { let s = 0, w = 0; cells.forEach(c => { if (c.seg !== seg || !o[c.label]) return; s += POP[c.label] * o[c.label][k]; w += POP[c.label]; }); return w ? s / w : 0; };
    return { seg, doneBefore: f(before, 'done'), doneAfter: f(after, 'done'), fracBefore: f(before, 'frac'), fracAfter: f(after, 'frac') };
  });
  const niceReq = (x) => x < 100 ? Math.max(1, Math.round(x / 5) * 5) : x < 1000 ? Math.round(x / 10) * 10 : x < 10000 ? Math.round(x / 50) * 50 : Math.round(x / 250) * 250;
  const makeIncreasing = (xs) => { for (let i = 1; i < xs.length; i++) if (xs[i] <= xs[i - 1]) xs[i] = niceReq(xs[i - 1] * 1.05 + 1); return xs; };
  // the scale that keeps the per-segment completion closest (share past the end AND share of milestones)
  function bestScale(fnBefore, fnAfter){
    let best = null;
    for (let s = 0.30; s <= 1.0001; s += 0.005){
      const a = fnAfter(s), b = fnBefore;
      let err = 0, w = 0;
      cells.forEach(c => { if (!a[c.label] || !b[c.label]) return; err += POP[c.label] * (Math.pow(a[c.label].done - b[c.label].done, 2) + Math.pow(a[c.label].frac - b[c.label].frac, 2)); w += POP[c.label]; });
      if (!best || err / w < best.err) best = { s, err: err / w };
    }
    return best.s;
  }
  const OUT = { meta: { data: data._meta, ref: refFile, kite: KITE, kite2d: KITE2D, tad: TAD, target: SIDE }, completion: {}, reqs: {}, fits: {}, lanes: {}, notes: {} };
  // Per rung: the requirement that keeps each SEGMENT's share of participants reaching it closest to what it
  // was - segments weighted EQUALLY (cells inside a segment by population), so 100+ (whose pace hardly drops on
  // a shorter event: Jigsaw's accrual share is 1.00 at 100+, 0.70 at 10-19) is not outvoted by 0-9. A rung no
  // segment can tell apart (everyone or no one reaches it either way) follows the pooled scale s0.
  const SEGPOP = {}; cells.forEach(c => { SEGPOP[c.seg] = (SEGPOP[c.seg] || 0) + POP[c.label]; });
  function rungReq(q0, befS, aftS, s0){
    let best = null;
    for (let k = 0.30; k <= 1.0001; k += 0.005){          // never harder than before (the brief: easier)
      let err = 0;
      cells.forEach(c => { if (!befS[c.label] || !aftS[c.label]) return;
        err += (POP[c.label] / SEGPOP[c.seg]) * Math.pow(aftS[c.label](q0 * k) - befS[c.label](q0), 2) / 5; });
      err += 1e-5 * Math.pow(k - s0, 2);
      if (!best || err < best.err) best = { k, err };
    }
    return q0 * best.k;
  }


  // ------------------------------------------------------------------ 0. the base Hatchling sheet gets today's boards
  // D83: with its own 'Cum tokens' helper the base side keeps today's requirement while HH_v2's boards change
  // (without it both sides read HH_v2 and an easier board would only re-weight). Same cells as on HH_v2.
  {
    const vv = data['HH_v2'].values, hit = reqLabelCell_(vv, 'Cum tokens', 4), acc = reqLabelCell_(vv, 'accuracy', 4);
    if (hit && !reqLabelCell_(data['HH'].values, 'Cum tokens', 4)){
      const copy = (r, c) => set('HH', r, c, vv[r][c]);
      if (acc){ copy(acc.r, acc.c); copy(acc.r, acc.c + 1); }
      for (let r = hit.r; r <= hit.r + 5; r++) for (let c = hit.c - 2; c <= hit.c; c++) copy(r, c);
    }
  }

  // ------------------------------------------------------------------ 1. requirements
  dsNow();
  const accD = (acc, cur, nw) => { const o = {}; cells.forEach(c => { o[c.label] = accrualD_(ctx.ds, acc, cur, nw, c.seg, c.payer, false); }); return o; };
  // Bomb's Ballet and Jigsaw: own cumulative req column B
  [["Bomb's Ballet", 'BB_v2', 'BB', 'Bombs Ballet', 3, 2], ['Jigsaw', 'J_v2', 'J', 'Jigsaw', 3, 2]].forEach(([cat, sh, base, inst, cd, nd]) => {
    const spec = COLL_R_SPECS[cat], D = accD(inst, cd, nd);
    const reqs0 = range(spec.r0, spec.r1).map(r => N(get(base, r, spec.reqC)));
    const before = collCompletion(inst, reqs0, null);
    const s = bestScale(before, (k) => collCompletion(inst, reqs0.map(x => x * k), c => D[c.label]));
    const befS = {}, aftS = {};
    cells.forEach(c => { const S = collSurv(inst, c); if (!S) return; befS[c.label] = S; aftS[c.label] = (x) => S(x / D[c.label]); });
    const reqs1 = makeIncreasing(reqs0.map(q => niceReq(rungReq(q, befS, aftS, s))));
    range(spec.r0, spec.r1).forEach((r, i) => set(sh, r, spec.reqC, reqs1[i]));
    const after = collCompletion(inst, reqs1, c => D[c.label]);
    OUT.reqs[sh] = { scale: s, before: reqs0, after: reqs1, D: popMean(D, x => x) ? cells.reduce((a, c) => a + POP[c.label] * D[c.label], 0) / POPT : 1 };
    OUT.completion[cat] = segTable(before, after);
    log(cat + ': requirement scale ' + s.toFixed(3) + '  reqs ' + reqs0.join(',') + ' -> ' + reqs1.join(','));
  });
  // Hatchling: tiles per gate (Y12:Y16 and the helper copy AV5:AV9) - cum tokens (AW, a sheet formula) follow
  {
    const cat = 'Hatchling Hideaway', sh = 'HH_v2', D = accD('Hatchling Hideaway', 4, 3);
    const v = data[sh].values, hit = reqLabelCell_(v, 'Cum tokens', 4), accCell = reqLabelCell_(v, 'accuracy', 4);
    const acc = N(get(sh, accCell.r, accCell.c + 1)) || 0.8;
    const tilesCol = hit.c - 1, r0 = hit.r + 1;
    const ycol = (data[sh].values[10] || []).map(x => String(x).trim()).indexOf('Tiles');
    const tiles0 = range(0, 4).map(i => N(get(sh, r0 + i, tilesCol)));
    const cum = (t) => { let a = 0; return t.map(x => (a += x) / acc); };
    const before = collCompletion('Hatchling Hideaway', cum(tiles0), null);
    const s = bestScale(before, (k) => collCompletion('Hatchling Hideaway', cum(tiles0.map(x => x * k)), c => D[c.label]));
    const befS = {}, aftS = {};
    cells.forEach(c => { const S = collSurv('Hatchling Hideaway', c); if (!S) return; befS[c.label] = S; aftS[c.label] = (x) => S(x / D[c.label]); });
    // per gate on the cumulative axis, then back to whole tiles per board: no board larger than it was, none
    // smaller than the board before it
    const cumT = cum(tiles0).map(q => rungReq(q, befS, aftS, s));
    const tiles1 = [];
    cumT.forEach((q, i) => { const prev = i ? tiles1.reduce((a, t) => a + t, 0) : 0;
      tiles1.push(Math.min(tiles0[i], Math.max(4, i ? tiles1[i - 1] : 4, Math.round(q * acc - prev)))); });
    const cum1 = cum(tiles1);
    tiles1.forEach((t, i) => { set(sh, r0 + i, tilesCol, t); set(sh, r0 + i, hit.c, cum1[i]); if (ycol >= 0) set(sh, 11 + i, ycol, t); });
    const after = collCompletion('Hatchling Hideaway', cum1, c => D[c.label]);
    OUT.reqs[sh] = { scale: s, before: tiles0, after: tiles1, cumBefore: cum(tiles0), cumAfter: cum1, formulaCells: range(0, 4).map(i => colL(hit.c) + (r0 + i + 1)) };
    OUT.completion[cat] = segTable(before, after);
    log(cat + ': tile scale ' + s.toFixed(3) + '  tiles ' + tiles0.join(',') + ' -> ' + tiles1.join(','));
  }
  // Rainbow Maker: 30 -> 25 milestones, requirements re-spaced to the 2-day pace (live matchables, day 2 vs day 4)
  const RM_SHEETS = ['RM_1st_v2', 'RM_2nd_v2'];
  const rmHdr = (sh) => data[sh].values.findIndex(r => r && r.some(x => String(x).trim() === 'Req Accum'));
  const RM_N_NEW = 25;
  {
    const h = rmHdr('RM_1st_v2'), H = data['RM_1st_v2'].values[h].map(x => String(x == null ? '' : x).trim());
    const cA = 0, cInc = H.indexOf('Matchables Req'), cCum = H.indexOf('Req Accum'), cLast = H.indexOf('ToF_Ticket');
    const old = (sh) => { const rows = []; for (let r = h + 1; r < data[sh].values.length && String(get(sh, r, 0)).trim() !== '' && !isNaN(parseFloat(get(sh, r, 0))); r++) rows.push(r); return rows; };
    const oldRows = old('RM_1st_v2'), N0 = oldRows.length;
    const C0 = oldRows.map(r => N(get('RM_1st_v2', r, cCum)));
    const Cint = (x) => {                               // cumulative req at fractional rung x (1..N0), log-linear
      if (x <= 1) return C0[0] * x;
      const i = Math.min(N0 - 1, Math.floor(x)), f = x - i;
      const a = Math.log(C0[i - 1]), b = Math.log(C0[Math.min(N0 - 1, i)]);
      return Math.exp(a + (b - a) * f);
    };
    const baseReqs = readRMLadder_('RM_1st').map(x => x.req);
    const liveBefore = {}, liveFn = {};
    cells.forEach(c => { const L = rmLive_(c.seg, c.payer); if (!L) return; liveFn[c.label] = { d4: rmLiveSurv_(L.at(4, 4)), d2: rmLiveSurv_(L.at(2, 2)) }; });
    cells.forEach(c => { const f = liveFn[c.label]; if (!f) return;
      liveBefore[c.label] = { done: f.d4(baseReqs[baseReqs.length - 1]), frac: baseReqs.reduce((a, q) => a + f.d4(q), 0) / baseReqs.length }; });
    const newReqs = (s) => range(1, RM_N_NEW).map(j => s * Cint(j * N0 / RM_N_NEW));
    const compl = (reqs) => { const o = {}; cells.forEach(c => { const f = liveFn[c.label]; if (!f) return;
      o[c.label] = { done: f.d2(reqs[reqs.length - 1]), frac: reqs.reduce((a, q) => a + f.d2(q), 0) / reqs.length }; }); return o; };
    const s = bestScale(liveBefore, (k) => compl(newReqs(k)));
    const befS = {}, aftS = {};
    cells.forEach(c => { const f = liveFn[c.label]; if (!f) return; befS[c.label] = f.d4; aftS[c.label] = f.d2; });
    const C1 = makeIncreasing(range(1, RM_N_NEW).map(j => niceReq(rungReq(Cint(j * N0 / RM_N_NEW), befS, aftS, s))));
    // rewards: old rung k -> new rung ceil(k x 25/30); merged rungs add up
    RM_SHEETS.forEach(sh => {
      const Hs = data[sh].values[h].map(x => String(x == null ? '' : x).trim());
      const cols = hdrCols(sh, h);
      const oldR = old(sh).map(r => { const o = {}; Object.keys(cols).forEach(res => { o[res] = N(get(sh, r, cols[res])); }); return o; });
      const nw = range(1, RM_N_NEW).map(() => ({}));
      oldR.forEach((o, k) => { const j = Math.min(RM_N_NEW, Math.ceil((k + 1) * RM_N_NEW / N0)) - 1;
        Object.keys(o).forEach(res => { nw[j][res] = (nw[j][res] || 0) + o[res]; }); });
      for (let j = 0; j < Math.max(N0, RM_N_NEW); j++){
        const r = h + 1 + j;
        if (j < RM_N_NEW){
          set(sh, r, cA, j + 1); set(sh, r, cInc, C1[j] - (j ? C1[j - 1] : 0)); set(sh, r, cCum, C1[j]);
          Object.keys(cols).forEach(res => set(sh, r, cols[res], nw[j][res] || 0));
        } else {
          for (let c = 0; c <= cLast; c++) set(sh, r, c, '');   // A..ToF_Ticket only; the helper block to the right is the user's
        }
      }
    });
    OUT.reqs['RM_1st_v2'] = OUT.reqs['RM_2nd_v2'] = { scale: s, before: C0, after: C1, nOld: N0, nNew: RM_N_NEW };
    OUT.completion['Rainbow Maker'] = segTable(liveBefore, compl(C1));
    log('Rainbow Maker: matchables scale ' + s.toFixed(3) + '  25 reqs ' + C1.join(','));
  }

  // ------------------------------------------------------------------ 2. every ladder, one joint fit per resource
  // Lanes and their (soft) targets:
  //   Kite Festival   x KITE on what its sheets pay; the 2-day sheet at KITE2D of the 3-day one per festival
  //   Target Day      x TAD on what its sheet pays
  //   Bomb's Ballet, Jigsaw, Rainbow Maker, Night Sky   give up alpha_r of their own reference gain (absorbers)
  //   Hatchling       neutral (its per-instance rewards rise; the user asked for higher rewards there)
  // and the HARD target is the resource total over all of them = their reference total (the growth is absorbed).
  // What a sheet does not pay (Kite's SPT, Target Day's Unlimited Lives and Chuck: carried x calendar by the
  // engine) sits in the intercepts and is absorbed like any other growth.
  const LADDERS = [];                                 // {name, cat, vars, seg?}
  {
    const spec = LB_R_SPECS['Kite Festival'];
    LADDERS.push({ name: 'Kite 3-day', cat: 'Kite Festival', lb: true, vars: specLadder(spec, 'Ki_v2', range(spec.r0, spec.r1)).concat(msVars(spec, 'Ki_v2')) });
    LADDERS.push({ name: 'Kite 2-day', cat: 'Kite Festival', lb: true, vars: specLadder(spec, 'Ki_2d_v2', range(spec.r0, spec.r1)).concat(msVars(spec, 'Ki_2d_v2')) });
  }
  { const spec = LB_R_SPECS['Target Day']; LADDERS.push({ name: 'Target Day', cat: 'Target Day', lb: true, vars: specLadder(spec, 'TaD_v2', range(spec.r0, spec.r1)) }); }
  { const spec = COLL_R_SPECS["Bomb's Ballet"]; LADDERS.push({ name: "Bomb's Ballet", cat: "Bomb's Ballet", vars: specLadder(spec, 'BB_v2', range(spec.r0, spec.r1).concat([spec.completionRow])) }); }
  { const spec = COLL_R_SPECS['Jigsaw']; LADDERS.push({ name: 'Jigsaw', cat: 'Jigsaw', vars: specLadder(spec, 'J_v2', range(spec.r0, spec.r1)) }); }
  { const spec = COLL_R_SPECS['Hatchling Hideaway']; LADDERS.push({ name: 'Hatchling Hideaway', cat: 'Hatchling Hideaway', vars: specLadder(spec, 'HH_v2', range(spec.r0, spec.r1)) }); }
  {
    // the two RM sheets share every entry they agree on (set together); where they differ each is its own variable
    const h = rmHdr('RM_1st_v2'), c1 = hdrCols('RM_1st_v2', h), c2 = hdrCols('RM_2nd_v2', h);
    const vars = [];
    for (let j = 0; j < RM_N_NEW; j++){
      const r = h + 1 + j;
      Object.keys(c1).forEach(res => {
        const a1 = N(get('RM_1st_v2', r, c1[res])), a2 = N(get('RM_2nd_v2', r, c2[res]));
        // linked only where both pay the same non-zero amount (an empty slot belongs to one sheet, so a boost can
        // move into RM_2nd's next rung without appearing on RM_1st)
        if (a1 === a2 && a1 > 0 && !isCount(res)) vars.push({ res, at: [['RM_1st_v2', r, c1[res]], ['RM_2nd_v2', r, c2[res]]], a: a1, key: 'L' + r });
        else { vars.push({ res, at: [['RM_1st_v2', r, c1[res]]], a: a1, key: '1:' + r }); vars.push({ res, at: [['RM_2nd_v2', r, c2[res]]], a: a2, key: '2:' + r }); }
      });
    }
    LADDERS.push({ name: 'Rainbow Maker', cat: 'Rainbow Maker', vars });
  }
  // Night Sky gives up coins, Unlimited Lives and envelopes only (boosters and tickets stay); one ladder per
  // segment block (both day types), so every segment gives up the same share
  const NS_RES = (r) => r === 'HC' || r === 'Unlimited Lives' || isPackRes_(r);
  // the weekend (NS_v2) and weekday (NS_v2_weekday) ladders share every entry they agree on - a reward that is
  // the same on both days stays the same on both days; where they already differ each day is its own variable
  ['0-9', '10-19', '20-39', '40-99', '100+'].forEach(seg => {
    const vars = [];
    const blk = (sh) => { const v = data[sh].values, r0 = v.findIndex(r => r && String(r[0]).trim() === seg); if (r0 < 0) return null;
      const rows = []; for (let r = r0 + 2; r < v.length && String(get(sh, r, 0)).trim() !== '' && !isNaN(parseFloat(get(sh, r, 0))); r++) rows.push(r);
      return { cols: hdrCols(sh, r0 + 1), rows }; };
    const we = blk('NS_v2'), wd = blk('NS_v2_weekday');
    if (we) we.rows.forEach((r, k) => {
      Object.keys(we.cols).forEach(res => {
        if (!NS_RES(res)) return;
        const a1 = N(get('NS_v2', r, we.cols[res]));
        const r2 = wd && wd.rows[k], c2 = wd && wd.cols[res];
        if (r2 != null && c2 != null && N(get('NS_v2_weekday', r2, c2)) === a1)
          vars.push({ res, at: [['NS_v2', r, we.cols[res]], ['NS_v2_weekday', r2, c2]], a: a1, key: 'L' + k });
        else {
          vars.push({ res, at: [['NS_v2', r, we.cols[res]]], a: a1, key: 'we' + k });
          if (r2 != null && c2 != null) vars.push({ res, at: [['NS_v2_weekday', r2, c2]], a: N(get('NS_v2_weekday', r2, c2)), key: 'wd' + k });
        }
      });
    });
    LADDERS.push({ name: 'Night Sky ' + seg, cat: 'Daily Night Sky Prize', vars, seg });
  });
  // weights per ladder; intercepts per lane (a lane split over several ladders - Kite, Night Sky - shares one L0)
  const L0cat = {};
  const L0cell = {};
  LADDERS.forEach(L => { const W = weights(L.cat, L.vars); L.w = W.w; L.wc = W.wc; L0cat[L.cat] = W.L0; L0cell[L.cat] = W.L0c; });
  const refSeg = (cat, res, seg) => { let s = 0; cells.forEach(c => { if (c.seg === seg) s += POP[c.label] * N(REF.cells[c.label][SIDE][cat][res]); }); return s / POPT; };
  const lin = (L, res, key) => L.vars.reduce((a, x, i) => a + (x.res === res ? L.w[i] * N(x[key]) : 0), 0);
  const CATS = Array.from(new Set(LADDERS.map(L => L.cat)));
  const resid = {};
  if (residFile){
    // second pass: what a previous full probe left off the reference in the lanes this fit does not see (Season
    // Pass tier, ToF ticket income, Core's buff SPT, the collection rows)
    const Rz = JSON.parse(fs.readFileSync(residFile, 'utf8'));
    // the two collection rows are NOT chased: they are the card sim's album / set completions over 50 seeded
    // seasons per cell (100+ PAYER album coins read 83, 133, 133 and 413 on four runs of nearly the same
    // envelope flow) and album configs are out of scope - reported beside the result instead
    const SKIP_CATS = { 'Col - Sets': 1, 'Col - Albums': 1 };
    RESOURCES.forEach(r => {
      let gap = 0;
      cells.forEach(c => { CATEGORY_ORDER.forEach(cat => { if (CATS.indexOf(cat) >= 0 || SKIP_CATS[cat]) return;
        gap += POP[c.label] * (N(Rz.cells[c.label].sim[cat][r]) - N(REF.cells[c.label][SIDE][cat][r])); }); });
      resid[r] = gap / POPT;
    });
    // SPT is NOT re-absorbed: the second-order SPT is Core's buff conversion (+0.3 SPTx2 minutes -> +3.9 SPT),
    // and cutting Rainbow Maker's SPT for it drops 0-9 NONPAYER - the largest cell - one Season Pass tier
    // (Shuffle -1.0 per player there). Measured on the second pass, 2026-10-30; --resid-skip '' turns it off.
    OUT.resid = resid;
    OUT.residCell = {};
    RESOURCES.forEach(r => { OUT.residCell[r] = cells.map(c => { let g = 0; CATEGORY_ORDER.forEach(cat => { if (CATS.indexOf(cat) >= 0 || SKIP_CATS[cat]) return;
      g += N(Rz.cells[c.label].sim[cat][r]) - N(REF.cells[c.label][SIDE][cat][r]); }); return g; }); });
    arg('--resid-skip', 'SPT').split(',').filter(Boolean).forEach(r => { resid[r] = 0; if (OUT.residCell[r]) OUT.residCell[r] = OUT.residCell[r].map(() => 0); });
    log('second-order gap from ' + path.basename(residFile) + ': ' + RESOURCES.filter(r => Math.abs(resid[r]) > 0.005).map(r => r + ' ' + resid[r].toFixed(2)).join(', '));
  }
  const ABS = ["Bomb's Ballet", 'Jigsaw', 'Rainbow Maker', 'Daily Night Sky Prize'];
  // every milestone keeps at least one reward (the sheets flag an empty rung 'NO REWARD!'): non-zero entries per
  // rung, kept current across the per-resource fits, and no step / move may take a rung's last one
  const rungNZ = {}, rungKeys = (x) => x.at.map(([sh, r]) => sh + ':' + r);
  LADDERS.forEach(L => { if (L.lb) return; L.vars.forEach(x => { if (x.a > 0) rungKeys(x).forEach(k => { rungNZ[k] = (rungNZ[k] || 0) + 1; }); }); });
  const guarded = (v) => !v.L.lb;
  const canEmpty = (v) => !guarded(v) || rungKeys(v.x).every(k => (rungNZ[k] || 0) > 1);
  const noteChange = (v, before, after) => { if (!guarded(v)) return;
    if (before > 0 && !(after > 0)) rungKeys(v.x).forEach(k => { rungNZ[k]--; });
    if (!(before > 0) && after > 0) rungKeys(v.x).forEach(k => { rungNZ[k] = (rungNZ[k] || 0) + 1; }); };
  const alpha = {}, fitRep = {};
  // tolerances: values 12%; count items (boosters, envelopes, tickets) 50% - one item is a big step on a ladder and
  // the high tiers sit in the top segments' rows only; Night Sky blocks 50% (they are where a segment absorbs)
  const LAMBDA = 0.5, TOL = 0.12, TOL_NS = 0.5, TOL_COUNT = +arg('--tol-count', 0.2), MOVE_SPAN = 3;
  // the two payer 'overall' rows count as much as five segment rows each: the overall line is what the brief is
  // about, and an L1 sum over 12 rows otherwise lets 100+ (late joiners lose most from a shorter event) pull it
  const OVERALL_W = 5;
  const fitRows = {};
  RESOURCES.forEach(res => {
    // soft targets of the growing lanes
    const k3 = LADDERS.find(L => L.name === 'Kite 3-day'), k2 = LADDERS.find(L => L.name === 'Kite 2-day');
    const S3 = lin(k3, res, 'a'), S2 = lin(k2, res, 'a'), kiteC0 = L0cat['Kite Festival'][res] - S3 - S2;
    const m3 = (S3 + S2 > 1e-12) ? Math.max(0, (KITE * refLane('Kite Festival', res) - kiteC0) / (S3 + KITE2D * S2)) : 1;
    const tadL = LADDERS.find(L => L.name === 'Target Day'), Stad = lin(tadL, res, 'a'), tadC0 = L0cat['Target Day'][res] - Stad;
    const tgtLin = { 'Kite 3-day': m3 * S3, 'Kite 2-day': m3 * KITE2D * S2,
                     'Target Day': Stad > 1e-12 ? Math.max(0, TAD * refLane('Target Day', res) - tadC0) : 0 };
    const growth = (kiteC0 + tgtLin['Kite 3-day'] + tgtLin['Kite 2-day'] - refLane('Kite Festival', res)) +
                   (tadC0 + tgtLin['Target Day'] - refLane('Target Day', res)) + (resid[res] || 0);
    // absorbers: the lanes among ABS with at least one non-zero entry of this resource
    const absCats = Array.from(new Set(LADDERS.filter(L => ABS.indexOf(L.cat) >= 0 && L.vars.some(x => x.res === res && x.a > 0)).map(L => L.cat)));
    const pool = absCats.reduce((a, cat) => a + refLane(cat, res), 0);
    alpha[res] = pool > 1e-9 ? growth / pool : 0;
    LADDERS.forEach(L => {
      if (L.name in tgtLin) return;
      const sib = LADDERS.filter(M => M.cat === L.cat), Ssib = sib.reduce((a, M) => a + lin(M, res, 'a'), 0), S = lin(L, res, 'a');
      const laneC0 = L0cat[L.cat][res] - Ssib;
      // the lane's reference and intercept, split over its ladders (Night Sky: by segment; others: one ladder)
      const ref = L.seg ? refSeg(L.cat, res, L.seg) : refLane(L.cat, res);
      const c0part = L.seg ? (Ssib > 1e-12 ? laneC0 * S / Ssib : 0) : laneC0;
      const want = (absCats.indexOf(L.cat) >= 0) ? ref * (1 - alpha[res]) : ref;
      tgtLin[L.name] = Math.max(0, want - c0part);
    });
    // HARD total over the touched lanes: their reference sum, less what the lanes outside them still gained
    const total = CATS.reduce((a, cat) => a + refLane(cat, res), 0) - (resid[res] || 0);
    let c0 = 0;
    CATS.forEach(cat => { c0 += L0cat[cat][res] - LADDERS.filter(L => L.cat === cat).reduce((a, L) => a + lin(L, res, 'a'), 0); });
    const V = [];
    // a count item (booster, envelope, ticket) may also MOVE to another rung of the same sheet - empty rungs
    // included - which is how a ladder pays one item less often without losing it (a Chuck from the first
    // milestone of a shorter event to a later one); those empty slots only ever take part in a transfer
    LADDERS.forEach(L => L.vars.forEach((x, i) => { if (x.res === res && L.w[i] > 1e-12 && (x.a > 0 || isCount(res) || !L.lb)) V.push({ L, x, w: L.w[i], wc: L.wc[i], zero: !(x.a > 0) }); }));
    if (!V.some(v => !v.zero)) return;
    // start: every ladder scaled to its own target, nice-rounded; then single steps anywhere that bring the
    // total closer, with a soft pull towards each ladder's own target
    const mOf = {};
    LADDERS.forEach(L => { const S = lin(L, res, 'a'); mOf[L.name] = S > 1e-12 ? Math.min(MAX_M, tgtLin[L.name] / S) : 1; });
    V.forEach(v => { v.m = mOf[v.L.name]; v.st = stepOf(res, Math.max(v.x.a, v.m * v.x.a));
      const bb = v.zero ? [0, isCount(res) ? 1 : 0] : bounds(res, v.x.a, v.m, v.st); v.lo = bb[0]; v.hi = bb[1]; v.b = 0; });
    // start: each ladder fitted to its OWN target (fitRes: nice rounding, then single steps that close the gap)
    LADDERS.forEach(L => {
      const mine = V.filter(v => v.L === L && !v.zero);
      if (!mine.length) return;
      if (L.lb && isCount(res)){ mine.forEach(v => { v.b = v.x.a; }); return; }   // trimmed band by band below
      const f = fitRes(mine.map(v => v.x), mine.map(v => v.w), tgtLin[L.name] || 0);
      mine.forEach((v, i) => { v.b = f.b[i]; });
      if (L.lb){                                          // a better rank never pays less than a worse one
        const byRow = mine.slice().sort((p, q) => p.x.at[0][1] - q.x.at[0][1]);
        for (let i = 1; i < byRow.length; i++) if (byRow[i].b > byRow[i - 1].b) byRow[i].b = byRow[i - 1].b;
      }
    });
    V.forEach(v => { if (v.zero || !(v.x.a > 0)) return;
      if (!(v.b > 0)){ if (canEmpty(v)) noteChange(v, v.x.a, 0); else v.b = isCount(res) ? 1 : Math.min(v.x.a, v.st); } });
    const unitCap = {}, units = (L) => V.reduce((a, v) => a + (v.L === L ? v.b : 0), 0);
    LADDERS.forEach(L => { const A = V.reduce((a, v) => a + (v.L === L ? N(v.x.a) : 0), 0); unitCap[L.name] = (mOf[L.name] > 1) ? Math.ceil(mOf[L.name] * A) : A; });
    // leaderboard structure: per (ladder, resource) the entries in rank order, and where each item's band ends
    const lbRows = {};
    V.forEach(v => { if (!v.L.lb) return; (lbRows[v.L.name] = lbRows[v.L.name] || []).push(v); });
    Object.keys(lbRows).forEach(k => { lbRows[k].sort((p, q) => p.x.at[0][1] - q.x.at[0][1]);
      let last = -1; lbRows[k].forEach(v => { if (v.x.a > 0) last = v.x.at[0][1]; }); lbRows[k].origLast = last; });
    // a value step on a leaderboard must keep the ranks in order
    const lbMonoOk = (v, nb) => { const g = lbRows[v.L.name], i = g.indexOf(v);
      const prev = g.slice(0, i).reverse().find(u => !u.zero || u.b > 0), next = g.slice(i + 1).find(u => !u.zero || u.b > 0);
      return (!prev || nb <= prev.b) && (!next || nb >= next.b); };
    // a count item on a leaderboard moves only at the END of its band: dropped from the worst rank that has
    // it, or given back to the next rank (never past where the band ended before)
    const lbBandOk = (v, d) => { const g = lbRows[v.L.name];
      let last = -1; g.forEach(u => { if (u.b > 0) last = u.x.at[0][1]; });
      if (d < 0) return v.x.at[0][1] === last;
      const nxt = g.find(u => u.x.at[0][1] > last);
      return nxt === v && v.x.at[0][1] <= g.origLast; };
    const dev = {};
    LADDERS.forEach(L => { dev[L.name] = (tgtLin[L.name] || 0) - V.reduce((a, v) => a + (v.L === L ? v.w * v.b : 0), 0); });
    let E = total - c0 - V.reduce((a, v) => a + v.w * v.b, 0);
    // the JOINT pass judges the rows of the Sim per Segment sheet: each of the 10 cells and the two payer
    // 'overall' rows, as a share of that row's measured total (so 100+ counts as much as 0-9)
    const NC = cells.length, rc = (OUT.residCell && OUT.residCell[res]) || cells.map(() => 0);
    const Ec = cells.map((c, ci) => {
      let tgt = 0, base = 0;
      CATS.forEach(cat => { tgt += N(REF.cells[c.label][SIDE][cat][res]);
        base += L0cell[cat][res][ci] - LADDERS.filter(L => L.cat === cat).reduce((a, L) => a + L.vars.reduce((t, x, i) => t + (x.res === res ? L.wc[i][ci] * N(x.a) : 0), 0), 0); });
      return tgt - rc[ci] - base - V.reduce((a, v) => a + v.wc[ci] * v.b, 0);
    });
    const Mc = cells.map(c => Math.max(1e-6, CATEGORY_ORDER.reduce((a, cat) => a + N(REF.cells[c.label].meas[cat][res]), 0)));
    const PAYS = ['NONPAYER', 'PAYER'].map(py => { const idx = cells.map((c, i) => i).filter(i => cells[i].payer === py);
      const w = idx.reduce((a, i) => a + POP[cells[i].label], 0);
      return { idx, w, M: Math.max(1e-6, idx.reduce((a, i) => a + POP[cells[i].label] * Mc[i], 0) / w) }; });
    const Mall = Math.max(1e-6, cells.reduce((a, c, i) => a + POP[c.label] * Mc[i], 0) / POPT);
    // SPT moves the Season Pass tier of a cell, and two cells sit right at a threshold: 10-19 NONPAYER dropped a
    // tier at -0.8% SPT (15 UL Red minutes of track) and 0-9 PAYER rose one at +3.3% (+44 coins free, +30 paid,
    // +60 UL). So every cell's SPT is held to its own target ten times harder than the other resources
    const spW = (e) => (res === 'SPT') ? (e > 0 ? 30 : 10) : 1;   // below target three times worse again (a dropped tier)
    const rowJ = (ec) => { let j = 0; for (let i = 0; i < NC; i++) j += spW(ec[i]) * Math.abs(ec[i]) / Mc[i];
      PAYS.forEach(P => { let e = 0; P.idx.forEach(i => { e += POP[cells[i].label] * ec[i]; }); j += OVERALL_W * Math.abs(e / P.w) / P.M; }); return j; };
    // two passes: LANE (every ladder as close to its own target as steps and transfers can get it - this is
    // where a single item on a rung everyone reaches gets moved down the ladder), then JOINT (the total, each
    // ladder allowed to drift only inside its tolerance)
    const dbgRows = (tag) => { if (process.env.CALBAL_ROWS === res) log('  ROWS ' + res + ' ' + tag + ': ' + cells.map((c, i) => c.label.replace('NONPAYER', 'N').replace('PAYER', 'P') + ' ' + (100 * Ec[i] / Mc[i]).toFixed(1) + '%').join(' | ')); };
    dbgRows('start');
    ['lane', 'joint'].forEach(mode => {
      for (let it = 0; it < 4000; it++){
        let best = null;
        const J0 = mode === 'joint' ? rowJ(Ec) : 0;
        const tryMove = (dFit, L, cand, dc) => {
          const dl = dev[L.name], dl2 = dl - dFit, tg = tgtLin[L.name] || 0;
          let dJ;
          if (mode === 'lane') dJ = Math.abs(dl2) - Math.abs(dl);
          else {
            // a ladder may move AWAY from its own target only within its tolerance (TOL of its target, or
            // half a step) - that keeps the absorption proportional instead of piling it on the cheapest
            // ladder. Night Sky's blocks are per segment: they are WHERE a segment's share is absorbed, so
            // they get a wide band
            const tol = Math.max((L.seg ? TOL_NS : isCount(res) ? TOL_COUNT : TOL) * tg, cand.halfStep);
            if (Math.abs(dl2) > Math.abs(dl) + 1e-12 && Math.abs(dl2) > tol) return;
            const ec2 = Ec.map((e, i) => e - dc[i]);
            dJ = rowJ(ec2) - J0 + LAMBDA * (Math.abs(dl2) - Math.abs(dl)) / Mall;
          }
          const score = dJ + cand.tie;
          if (dJ < -1e-12 && (!best || score < best.score)) best = Object.assign({ score, dFit, L, dc }, cand);
        };
        if (isCount(res)) V.forEach((vi, i) => {
          if (vi.b - 1 < vi.lo) return;
          if (vi.L.lb) return;
          if (vi.b - 1 <= 0 && !canEmpty(vi)) return;
          V.forEach((vj, j) => {
            if (j === i || vj.L !== vi.L || vj.x.at[0][0] !== vi.x.at[0][0] || vj.b + 1 > vj.hi) return;
            // a move stays near where the item was: at most MOVE_SPAN rungs / ranks away (a rank-1 envelope may
            // go to rank 3, never to the bottom of a 60-player league)
            if (Math.abs(vj.x.at[0][1] - vi.x.at[0][1]) > MOVE_SPAN) return;
            tryMove(vj.w - vi.w, vi.L, { kind: 't', i, j, halfStep: Math.abs(vj.w - vi.w), tie: 1e-9 },
                    mode === 'joint' ? vj.wc.map((x, c) => x - vi.wc[c]) : null);
          });
        });
        // a VALUE step moved from one entry to another of the same ladder (coins / SPT / minutes shifted between
        // milestones): reshapes who reaches what without changing the ladder's total much - the move that lets one
        // segment's SPT rise while another's falls (joint pass only; never on a leaderboard)
        if (!isCount(res) && mode === 'joint') V.forEach((vi, i) => {
          if (vi.L.lb || vi.zero || vi.b - vi.st < vi.lo) return;
          if (vi.b - vi.st <= 0 && !canEmpty(vi)) return;
          V.forEach((vj, j) => {
            if (j === i || vj.L !== vi.L || vj.zero || vj.b + vi.st > vj.hi || vj.x.at.length !== vi.x.at.length || vj.x.at[0][0] !== vi.x.at[0][0]) return;
            const d = vi.st;
            tryMove((vj.w - vi.w) * d, vi.L, { kind: 'v', i, j, amt: d, halfStep: Math.abs(vj.w - vi.w) * d, tie: 2e-9 },
                    vj.wc.map((x, c) => (x - vi.wc[c]) * d));
          });
        });
        if (!isCount(res)) V.forEach((vi, i) => {
          if (vi.L.lb || !(vi.b > 0) || vi.zero || !canEmpty(vi)) return;
          V.forEach((vj, j) => {
            if (j === i || vj.L !== vi.L || !vj.zero || vj.b > 0 || vj.x.at[0][0] !== vi.x.at[0][0]) return;
            if (Math.abs(vj.x.at[0][1] - vi.x.at[0][1]) > 1) return;          // one rung up or down
            if (mode === 'joint' && vi.L.lb) return;
            tryMove((vj.w - vi.w) * vi.b, vi.L, { kind: 'r', i, j, amt: vi.b, halfStep: Math.abs(vj.w - vi.w) * vi.b, tie: 1e-8 },
                    mode === 'joint' ? vj.wc.map((x, c) => (x - vi.wc[c]) * vi.b) : null);
          });
        });
        V.forEach((v, k) => {
          if (v.zero && !(v.L.lb && isCount(res))) return;
          // the growing leaderboards keep the shape the lane pass gave them (scaled, bands trimmed): the per-row
          // balancing is the absorbers' job, otherwise the optimiser reshapes a ladder to steer one segment
          if (mode === 'joint' && v.L.lb) return;
          [v.st, -v.st].forEach(d => {
            if (v.b + d < v.lo || v.b + d > v.hi) return;
            if (v.L.lb && (isCount(res) ? !lbBandOk(v, d) : !lbMonoOk(v, v.b + d))) return;
            if (v.b > 0 && v.b + d <= 0 && !canEmpty(v)) return;
            // a count item never multiplies: a ladder holds at most the units it had (more only when it is being
            // raised) - otherwise 'give it to the next rung, then step the empty slot back up' creates items
            if (isCount(res) && d > 0 && units(v.L) + d > unitCap[v.L.name]) return;
            tryMove(v.w * d, v.L, { kind: 's', k, d, halfStep: v.w * v.st, tie: 1e-9 * (Math.abs(v.b + d - v.m * v.x.a) - Math.abs(v.b - v.m * v.x.a)) },
                    mode === 'joint' ? v.wc.map(x => x * d) : null);
          });
        });
        if (!best) break;
        if (process.env.CALBAL_TRACE && process.env.CALBAL_TRACE === res + '|' + best.L.name){
          const nm = (v) => v.x.at[0][0] + '!' + colL(v.x.at[0][2]) + (v.x.at[0][1] + 1) + '(' + v.b + ')';
          log('  TRACE ' + mode + ' ' + best.kind + ' ' + (best.kind === 's' ? nm(V[best.k]) + ' d' + best.d : nm(V[best.i]) + ' -> ' + nm(V[best.j])));
        }
        if (best.kind === 'r'){ noteChange(V[best.i], V[best.i].b, 0); noteChange(V[best.j], 0, best.amt); V[best.j].b = best.amt; V[best.i].b = 0;
          // the slot it left becomes the empty one (it may take the amount back); the new one is a real entry
          const a = V[best.i], b = V[best.j]; b.zero = false; a.zero = true; b.lo = 0; b.hi = a.hi; b.st = a.st; b.m = a.m; a.lo = 0; a.hi = 0; }
        else if (best.kind === 'v'){ noteChange(V[best.i], V[best.i].b, V[best.i].b - best.amt); V[best.i].b -= best.amt; V[best.j].b += best.amt; }
        else if (best.kind === 't'){ noteChange(V[best.i], V[best.i].b, V[best.i].b - 1); noteChange(V[best.j], V[best.j].b, V[best.j].b + 1); V[best.i].b -= 1; V[best.j].b += 1; }
        else { noteChange(V[best.k], V[best.k].b, V[best.k].b + best.d); V[best.k].b += best.d; }
        E -= best.dFit; dev[best.L.name] -= best.dFit;
        if (best.dc) for (let i = 0; i < NC; i++) Ec[i] -= best.dc[i];
        else { const dcv = best.kind === 'r' ? V[best.j].wc.map((x, c) => (x - V[best.i].wc[c]) * best.amt)
                         : best.kind === 't' ? V[best.j].wc.map((x, c) => x - V[best.i].wc[c]) : V[best.k].wc.map(x => x * best.d);
               for (let i = 0; i < NC; i++) Ec[i] -= dcv[i]; }
      }
    });
    dbgRows('end');
    fitRows[res] = cells.map((c, i) => Ec[i] / Mc[i]);
    V.forEach(v => { if (!v.zero || v.b > 0 || v.x.a > 0) v.x.b = v.b; });
    if (process.env.CALBAL_DEBUG && process.env.CALBAL_DEBUG.split(',').indexOf(res) >= 0)
      LADDERS.forEach(L => { const mine = V.filter(v => v.L === L); if (mine.length) log('  DEBUG ' + res + ' ' + L.name + ' tgtLin ' + (tgtLin[L.name] || 0).toFixed(3) + ': ' +
        mine.map(v => v.x.at[0][0] + '!' + colL(v.x.at[0][2]) + (v.x.at[0][1] + 1) + ' a' + v.x.a + ' w' + v.w.toFixed(4) + ' b' + v.b).join(' | ')); });
    fitRep[res] = { total, fitted: total - E, alpha: alpha[res], growth };
  });
  OUT.alpha = alpha; OUT.fit = fitRep;
  // every milestone pays something: the sheets flag an empty rung ('NO REWARD!'), and a fit resource by resource
  // can empty one (its only item moved to a neighbour). Repair: bring a count item back from the nearest rung
  // that keeps something after giving it up, else 5 coins.
  const repaired = [];
  LADDERS.forEach(L => {
    if (L.lb) return;
    const val = (x) => (x.b !== undefined ? x.b : x.a);
    const byRung = {};
    L.vars.forEach(x => { rungKeys(x).forEach(k => { (byRung[k] = byRung[k] || []).push(x); }); });   // a linked entry pays on both sheets
    const keys = Object.keys(byRung);
    keys.forEach(k => {
      if (byRung[k].some(x => val(x) > 0)) return;
      const [sh, rs] = k.split(':'), r = +rs;
      if (process.env.CALBAL_DEBUG_EMPTY) log('  EMPTY ' + k + ' nz=' + rungNZ[k] + ' had: ' + byRung[k].filter(x => x.a > 0).map(x => x.res + ' ' + x.a + '->' + val(x) + ' (' + x.at.length + ' cells)').join(', '));
      let done = false;
      for (let dist = 1; dist <= 3 && !done; dist++) for (const rr of [r + dist, r - dist]){
        const nb = byRung[sh + ':' + rr]; if (!nb || done) continue;
        if (nb.filter(x => val(x) > 0).length < 2) continue;
        const give = nb.find(x => isCount(x.res) && val(x) > 0);
        if (!give) continue;
        const take = byRung[k].find(x => x.res === give.res && x.at.length === give.at.length);
        if (!take) continue;
        give.b = val(give) - 1; take.b = val(take) + 1; done = true;
        repaired.push(sh + ' row ' + (r + 1) + ' <- ' + give.res + ' from row ' + (rr + 1));
      }
      if (!done){ const hc = byRung[k].find(x => x.res === 'HC'); if (hc){ hc.b = 5; repaired.push(sh + ' row ' + (r + 1) + ' <- 5 coins'); } }
    });
  });
  if (repaired.length) log('empty milestones repaired: ' + repaired.join('; '));
  OUT.repaired = repaired;
  LADDERS.forEach(L => L.vars.forEach(x => { if (x.b !== undefined && x.b !== x.a) x.at.forEach(([s, r, c]) => set(s, r, c, x.b)); }));
  log('joint fit, touched lanes summed (target/fitted, alpha): ' + RESOURCES.filter(r => fitRep[r]).map(r => r.replace('Unlimited Lives', 'UL').replace(' Pack', '') + ' ' + fitRep[r].total.toFixed(2) + '/' + fitRep[r].fitted.toFixed(2) + ' (' + (100 * fitRep[r].alpha).toFixed(0) + '%)').join(' | '));

  // ------------------------------------------------------------------ 4. what the lanes now pay
  const LANES = ["Bomb's Ballet", 'Jigsaw', 'Hatchling Hideaway', 'Kite Festival', 'Target Day', 'Rainbow Maker', 'Daily Night Sky Prize', 'Flock Flurry'];
  LANES.forEach(cat => {
    const rows = evalCat(cat), o = {};
    RESOURCES.forEach(r => { o[r] = { ref: refLane(cat, r), meas: refMeas(cat, r), now: pooled(rows, r) }; });
    o._value = { ref: valueOf(r => refLane(cat, r)), now: valueOf(r => pooled(rows, r)) };
    OUT.lanes[cat] = o;
    log(cat.padEnd(22) + ' value ' + o._value.ref.toFixed(1) + ' -> ' + o._value.now.toFixed(1) + '  ' +
        RESOURCES.filter(r => o[r].ref > 0.02 || o[r].now > 0.02).map(r => r.replace('Unlimited Lives', 'UL').replace(' Pack', '') + ' ' + o[r].ref.toFixed(2) + '->' + o[r].now.toFixed(2)).join(' '));
  });

  // ------------------------------------------------------------------ 5. patches
  const patches = {};
  Object.keys(ORIG).forEach(sh => {
    const a = ORIG[sh], b = data[sh].values, list = [];
    const R = Math.max(a.length, b.length);
    for (let r = 0; r < R; r++){
      const ra = a[r] || [], rb = b[r] || [], C = Math.max(ra.length, rb.length);
      for (let c = 0; c < C; c++){
        const x = ra[c] === undefined ? '' : ra[c], y = rb[c] === undefined ? '' : rb[c];
        if (String(x) !== String(y)) list.push({ cell: colL(c) + (r + 1), old: x, new: y });
      }
    }
    if (list.length) patches[sh] = list;
  });
  OUT.patches = patches;
  fs.writeFileSync(outFile, JSON.stringify(OUT, null, 1));
  log('written ' + outFile + ' - ' + Object.keys(patches).map(s => s + ' ' + patches[s].length).join(', '));
}
eval(PRELUDE + '\n(' + DESIGN.toString() + ')();\n');
