// Price the v3 config proposals through the SAME engine that produces the sim, so every number in
// the proposals report is a model output rather than an assertion.
//
// Method
//   1. Load harness/_mockdata.json (workbook of record) and eval engine/EcoGainsSim_v4.gs +
//      EcoGainsSim_Daily.gs — identical bootstrap to the other harnesses.
//   2. For each scenario, patch the in-memory config sheets (the same cells a designer would edit),
//      re-eval the engine (resets Context/DataStore/sheetVals_ caches) and read the windowed sums
//      over the A/B window (cal_new days 5..13) with ECOGAINS_DAILY.
//   3. Payer-blend with data_gains resource_earners (same weights as analysis/_build_comparison.py)
//      and convert per-earner windowed deltas onto the live per-active-player-day axis with the
//      bridge k = a_C / M_win read from comparison.json (full_scope) — so proposal costs are
//      directly comparable to the A/B numbers in the report.
//   4. Night Sky also gets a per-round reach diagnostic (survival S at each Cum Streak Req) because
//      that is the mechanism the NS proposals act on.
//
// Output: analysis/out/proposal_pricing.json
// Usage: node analysis/_price_proposals.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness', '_mockdata.json'), 'utf8'));
delete data['cal_parsed'];                    // stale export — parse the visual grids
const cmp = JSON.parse(fs.readFileSync(path.join(OUT, 'comparison.json'), 'utf8'));

// ---------------------------------------------------------------- mock SpreadsheetApp
function mkRange(sheetName, r1, c1, nr, nc) {
  const sh = data[sheetName];
  return {
    getValues: () => {
      const out = [];
      for (let r = r1; r < r1 + nr; r++) {
        const row = [];
        for (let c = c1; c < c1 + nc; c++)
          row.push((sh.values[r - 1] && sh.values[r - 1][c - 1] !== undefined) ? sh.values[r - 1][c - 1] : '');
        out.push(row);
      }
      return out;
    },
    getMergedRanges: () => (sh.merges || [])
      .filter(m => m.r >= r1 && m.r + m.nr - 1 <= r1 + nr - 1 && m.c >= c1 && m.c + m.nc - 1 <= c1 + nc - 1)
      .map(m => ({ getRow: () => m.r, getColumn: () => m.c, getNumRows: () => m.nr, getNumColumns: () => m.nc })),
    getValue: () => { const row = sh.values[r1 - 1] || []; return row[c1 - 1] !== undefined ? row[c1 - 1] : ''; },
  };
}
function mkSheet(name) {
  const sh = data[name];
  if (!sh) return null;
  return {
    getDataRange: () => mkRange(name, 1, 1, sh.values.length, sh.values[0] ? sh.values[0].length : 0),
    getRange: (a, b, c, d) => {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d+)$/);
        const col = m[1].split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);
        return mkRange(name, +m[2], col, 1, 1);
      }
      return mkRange(name, a, b, c || 1, d || 1);
    },
  };
}
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: (n) => mkSheet(n) }) };

const engineSrc = fs.readFileSync(path.join(ROOT, 'engine', 'EcoGainsSim_v4.gs'), 'utf8');
const dailySrc = fs.readFileSync(path.join(ROOT, 'engine', 'EcoGainsSim_Daily.gs'), 'utf8');
// NOTE: every eval of the engine must happen at MODULE top level. eval() inside a function would
// bind the engine's `var`s in that function's scope, leaving module-scope helpers (measure(), the
// patches) looking at stale or undefined bindings. Re-evaling is the reset: it rebuilds Context's
// and DataStore's caches, which is why patched config sheets are picked up. Same trick the other
// harnesses use; the engine is all `var`, so re-declaration is safe.
eval(engineSrc); eval(dailySrc); _sheetValsCache = {};

const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+'];
const DAY_LIST = cmp.meta.day_list;              // [5..13] — the A/B window, phase-corrected
const TRACK_RES = ['HC', 'SPT', 'Unlimited Lives', 'Slingshot', 'Red', 'Chuck'];
const STORY_CATS = ['Daily Night Sky Prize', 'Saga', 'Daily Gift', 'Core', 'Rainbow Maker',
                    'River Rush', 'Photoshoot', 'Hatchling Hideaway'];

// ---------------------------------------------------------------- payer blend + papd bridge
const dg = data['data_gains'].values;
const dgi = {}; dg[0].forEach((h, i) => { dgi[h] = i; });
const SEG_TO_GAINS_ = {'0-9': 'B. 1-9', '10-19': 'C. 10-19', '20-39': 'D. 20-39',
                       '40-99': 'E. 40-99', '100+': 'F. 100+'};
const earners = {};
for (let i = 1; i < dg.length; i++) {
  const r = dg[i];
  const k = [r[dgi['engagement_segment']], r[dgi['payer_flag']], r[dgi['resource']]].join('|');
  if (!(k in earners)) { const v = parseFloat(r[dgi['resource_earners']]); if (!isNaN(v)) earners[k] = v; }
}
const sb = data['data_seg_beh'].values;
const sbi = {}; sb[0].forEach((h, i) => { sbi[h] = i; });
const segPlayers = {};
for (let i = 1; i < sb.length; i++) {
  const r = sb[i];
  if (r[sbi['segment']]) segPlayers[r[sbi['segment']] + '|' + r[sbi['payer_flag']]] = parseFloat(r[sbi['unique_players']]);
}
function payerWeight(seg, res) {                 // -> w_PAYER
  const g = SEG_TO_GAINS_[seg];
  const np = earners[[g, 'NONPAYER', res].join('|')], p = earners[[g, 'PAYER', res].join('|')];
  if (np && p) return p / (np + p);
  const np2 = segPlayers[seg + '|NONPAYER'], p2 = segPlayers[seg + '|PAYER'];
  if (np2 && p2) return p2 / (np2 + p2);
  return 0;
}
const pdC = {};
cmp.denominators.filter(d => d.arm === 'Control').forEach(d => { pdC[d.segment] = d.player_days; });
const PDC = SEGS.reduce((s, g) => s + (pdC[g] || 0), 0);
// bridge: per-earner windowed -> per-active-player-day, per (resource, segment)
const kBridge = {};
TRACK_RES.forEach(res => {
  const f = cmp.full_scope[res];
  kBridge[res] = {};
  SEGS.forEach(seg => {
    const ps = f && f.per_segment[seg];
    kBridge[res][seg] = (ps && ps.M_win > 1e-9) ? ps.a_C / ps.M_win : null;
  });
});

// ---------------------------------------------------------------- measure one scenario
function measure() {
  const out = { byResource: {}, byCategory: {}, ns: {} };
  TRACK_RES.forEach(res => { out.byResource[res] = {}; });
  STORY_CATS.forEach(c => { out.byCategory[c] = {}; });
  const ri = {}; RESOURCES.forEach((r, i) => { ri[r] = i; });
  for (const seg of SEGS) {
    const acc = {}, accCat = {};
    TRACK_RES.forEach(res => { acc[res] = 0; });
    STORY_CATS.forEach(c => { accCat[c] = {}; TRACK_RES.forEach(res => { accCat[c][res] = 0; }); });
    for (const payer of ['NONPAYER', 'PAYER']) {
      for (const cat of CATEGORY_ORDER) {
        const NEW = ECOGAINS_DAILY(payer, seg, cat, 'NEW');
        for (const res of TRACK_RES) {
          const w = (payer === 'PAYER') ? payerWeight(seg, res) : (1 - payerWeight(seg, res));
          let s = 0;
          for (const d of DAY_LIST) s += +NEW[d - 1][ri[res]] || 0;
          acc[res] += w * s;
          if (accCat[cat]) accCat[cat][res] += w * s;
        }
      }
    }
    TRACK_RES.forEach(res => { out.byResource[res][seg] = acc[res]; });
    STORY_CATS.forEach(c => { out.byCategory[c][seg] = accCat[c]; });
    // NS round diagnostic: survival at each Cum Streak Req, both ladders
    const ds = Context.get().ds, st = ds.nsStreak(seg, 'NONPAYER');
    if (st) {
      const S = survival_([[st.p25 * NS_STREAK_N, .25], [st.p50 * NS_STREAK_N, .50],
                           [st.p75 * NS_STREAK_N, .75], [st.p90 * NS_STREAK_N, .90]]);
      const ladder = readNSLadder_(seg, 'NS_v2');
      out.ns[seg] = {
        streak_pct: st,
        rounds: ladder.map((ms, i) => ({
          round: i + 1, req: ms.req, reach: S ? S(ms.req) : null,
          hc: +(ms.rew['HC'] || 0), e_hc: S ? S(ms.req) * (+(ms.rew['HC'] || 0)) : null,
        })),
      };
      out.ns[seg].e_hc_day = out.ns[seg].rounds.reduce((s, r) => s + (r.e_hc || 0), 0);
    }
  }
  return out;
}

// ---------------------------------------------------------------- scenario patches
// Layout constants verified against workbook (16):
//   NS_v2   per-segment blocks, milestone rows (0-based) below each segment label;
//           col 3 = 'Streak Req', col 4 = 'Cum Streak Req', col 5 = 'HC Reward'
//   c_day_v2 rows 3..9 (0-based) = days 1..7, col 1 = 'HC Reward'
//   c_saga_v2 node rows 4..13 (0-based), HC Reward col = 3 + 3*segment_index
const NS_ROWS = {'0-9': [9, 10, 11], '10-19': [15, 16, 17], '20-39': [21, 22, 23],
                 '40-99': [27, 28, 29], '100+': [33, 34, 35]};
const NS_COL_CUM = 4, NS_COL_REQ = 3, NS_COL_HC = 5;
const CDAY_ROWS = [3, 4, 5, 6, 7, 8, 9], CDAY_COL = 1;
const SAGA_ROWS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const SAGA_HC_COL = {'0-9': 3, '10-19': 6, '20-39': 9, '40-99': 12, '100+': 15};

const snapshots = [];
function setCell(sheet, r, c, v) {
  snapshots.push([sheet, r, c, data[sheet].values[r][c]]);
  data[sheet].values[r][c] = v;
}
function addMerge(sheet, m) {
  data[sheet].merges = data[sheet].merges || [];
  data[sheet].merges.push(m);
  snapshots.push(['__merge', sheet, data[sheet].merges.length - 1, null]);
}
function restoreAll() {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const [sheet, r, c, v] = snapshots[i];
    if (sheet === '__merge') data[r].merges.splice(c, 1);
    else data[sheet].values[r][c] = v;
  }
  snapshots.length = 0;
}

// streak percentiles per segment (for the gate re-cut), from the engine's own DataStore
function streakPct(seg) {
  const st = Context.get().ds.nsStreak(seg, 'NONPAYER');
  if (!st) return null;
  return {p25: st.p25 * NS_STREAK_N, p50: st.p50 * NS_STREAK_N,
          p75: st.p75 * NS_STREAK_N, p90: st.p90 * NS_STREAK_N};
}

const SCENARIOS = [
  {
    id: 'BASE',
    label: 'Workbook (16) as shipped (NS_v2 = the proposed coin ladder)',
    sheets: [], patch: () => {},
  },
  {
    id: 'A-ns-gates',
    label: 'NS gates re-cut to reach targets 75/50/25% (NS_v2 Cum Streak Req)',
    sheets: ['NS_v2'],
    patch: () => {
      SEGS.forEach(seg => {
        const p = streakPct(seg);
        if (!p) return;
        const gates = [p.p25, p.p50, p.p75].map(x => Math.max(1, Math.round(x)));
        NS_ROWS[seg].forEach((row, i) => {
          setCell('NS_v2', row, NS_COL_CUM, gates[i]);
          setCell('NS_v2', row, NS_COL_REQ, i === 0 ? gates[0] : gates[i] - gates[i - 1]);
        });
      });
    },
  },
  {
    id: 'A2-ns-gate-r1',
    label: 'NS round-1 gate only, lowered to ~75% reach for 0-9/10-19/20-39 (NS_v2 Cum Streak Req)',
    sheets: ['NS_v2'],
    patch: () => {
      ['0-9', '10-19', '20-39'].forEach(seg => {
        const p = streakPct(seg);
        if (!p) return;
        const g = Math.max(1, Math.round(p.p25));
        setCell('NS_v2', NS_ROWS[seg][0], NS_COL_CUM, g);
        setCell('NS_v2', NS_ROWS[seg][0], NS_COL_REQ, g);
      });
    },
  },
  {
    id: 'B-ns-reshape',
    label: 'NS rewards re-weighted onto reachable rounds at constant expected cost',
    sheets: ['NS_v2'],
    patch: () => {
      SEGS.forEach(seg => {
        const st = Context.get().ds.nsStreak(seg, 'NONPAYER');
        if (!st) return;
        const S = survival_([[st.p25 * NS_STREAK_N, .25], [st.p50 * NS_STREAK_N, .50],
                             [st.p75 * NS_STREAK_N, .75], [st.p90 * NS_STREAK_N, .90]]);
        const ladder = readNSLadder_(seg, 'NS_v2');
        if (!S || ladder.length < 3) return;
        const reach = ladder.map(ms => S(ms.req));
        const hc = ladder.map(ms => +(ms.rew['HC'] || 0));
        const E0 = hc.reduce((s, h, i) => s + h * reach[i], 0);
        if (!(E0 > 0)) return;
        // halve the deepest round's nominal reward, put the freed EXPECTED value on rounds 1-2
        const hcNew = hc.slice();
        hcNew[2] = Math.round(hc[2] * 0.5);
        const freed = E0 - hcNew.reduce((s, h, i) => s + h * reach[i], 0);
        const w = [reach[0], reach[1]];
        const wsum = w[0] * reach[0] + w[1] * reach[1];
        if (wsum > 1e-9) {
          hcNew[0] = Math.round(hc[0] + freed * w[0] / wsum);
          hcNew[1] = Math.round(hc[1] + freed * w[1] / wsum);
        }
        NS_ROWS[seg].forEach((row, i) => setCell('NS_v2', row, NS_COL_HC, hcNew[i]));
      });
    },
  },
  {
    id: 'C-daily-gift',
    label: 'Daily Gift early rungs restored to the Control ladder (c_day_v2 days 1-6)',
    sheets: ['c_day_v2'],
    patch: () => {
      const base = data['c_day'].values;
      CDAY_ROWS.forEach((row, i) => {
        if (i === 6) return;                                    // day 7 anchor unchanged
        setCell('c_day_v2', row, CDAY_COL, base[row][CDAY_COL]);
      });
    },
  },
  {
    id: 'C2-daily-gift-half',
    label: 'Daily Gift early rungs restored HALFWAY (c_day_v2 days 1-6)',
    sheets: ['c_day_v2'],
    patch: () => {
      const base = data['c_day'].values;
      CDAY_ROWS.forEach((row, i) => {
        if (i === 6) return;
        const b = +base[row][CDAY_COL] || 0, v2 = +data['c_day_v2'].values[row][CDAY_COL] || 0;
        setCell('c_day_v2', row, CDAY_COL, Math.round((b + v2) / 2));
      });
    },
  },
  {
    id: 'D-saga-lowseg',
    label: 'Saga coin give-back for 0-9 and 10-19 only (c_saga_v2 HC Reward: fill the 0 nodes)',
    sheets: ['c_saga_v2'],
    patch: () => {
      ['0-9', '10-19'].forEach(seg => {
        const c = SAGA_HC_COL[seg];
        SAGA_ROWS.forEach(row => {
          if (!(+data['c_saga_v2'].values[row][c] > 0)) setCell('c_saga_v2', row, c, 10);
        });
      });
    },
  },
  {
    id: 'E-river-rush',
    label: 'Restore the River Rush lane on cal_new (4 weekly 4-day instances)',
    sheets: ['cal_new'],
    patch: () => {
      // row 22 of the grid is empty in workbook (16); day = column - 1
      [5, 12, 19, 26].forEach(startDay => {
        const col = startDay + 1;
        setCell('cal_new', 21, col - 1, 'River Rush');
        addMerge('cal_new', {r: 22, c: col, nr: 1, nc: 4});
      });
    },
  },
];
const byId = (id) => SCENARIOS.find(s => s.id === id).patch;
SCENARIOS.push({
  id: 'PKG-newuser',
  label: 'Package (full): NS gates re-cut + Daily Gift restored + saga give-back at 0-9/10-19',
  sheets: ['NS_v2', 'c_day_v2', 'c_saga_v2'],
  patch: () => { byId('A-ns-gates')(); byId('C-daily-gift')(); byId('D-saga-lowseg')(); },
});
SCENARIOS.push({
  id: 'PKG-cheap',
  label: 'Package (cheap): NS reward reshape (free) + half Daily Gift restore + saga give-back',
  sheets: ['NS_v2', 'c_day_v2', 'c_saga_v2'],
  patch: () => { byId('B-ns-reshape')(); byId('C2-daily-gift-half')(); byId('D-saga-lowseg')(); },
});
SCENARIOS.push({
  id: 'PKG-funded',
  label: 'Package (self-funded): the cheap package paid for by trimming saga coins at 40-99/100+',
  sheets: ['NS_v2', 'c_day_v2', 'c_saga_v2'],
  patch: () => {
    byId('B-ns-reshape')(); byId('C2-daily-gift-half')(); byId('D-saga-lowseg')();
    // the top two segments took the UL-Lives compensation instead of coins; take the last coin
    // node off them to pay for the low-segment give-back (keeps the total faucet roughly flat)
    ['40-99', '100+'].forEach(seg => {
      const c = SAGA_HC_COL[seg];
      SAGA_ROWS.forEach(row => {
        const v = +data['c_saga_v2'].values[row][c] || 0;
        if (v > 0) setCell('c_saga_v2', row, c, Math.max(0, Math.round(v * 0.5)));
      });
    });
  },
});

// ---------------------------------------------------------------- run
const results = {};
for (const sc of SCENARIOS) {
  eval(engineSrc); eval(dailySrc); _sheetValsCache = {};   // clean state before patching
  sc.patch();
  eval(engineSrc); eval(dailySrc); _sheetValsCache = {};   // engine re-reads the patched sheets
  results[sc.id] = { label: sc.label, sheets: sc.sheets, m: measure() };
  restoreAll();
  eval(engineSrc); eval(dailySrc); _sheetValsCache = {};
}

// deltas vs BASE, on the live per-active-player-day axis
const base = results['BASE'].m;
const out = { generated: new Date().toISOString(), day_list: DAY_LIST,
              bridge_note: 'papd = per-earner windowed delta x (a_C / M_win) from comparison.json',
              scenarios: {} };
for (const id of Object.keys(results)) {
  const r = results[id], d = { label: r.label, sheets: r.sheets, resources: {}, categories: {}, ns: r.m.ns };
  TRACK_RES.forEach(res => {
    const per = {}; let overall = 0, overallBase = 0;
    SEGS.forEach(seg => {
      const k = kBridge[res][seg];
      const dw = r.m.byResource[res][seg] - base.byResource[res][seg];
      const papd = (k != null) ? dw * k : null;
      per[seg] = {win_per_earner: r.m.byResource[res][seg], delta_win: dw, delta_papd: papd,
                  a_C: cmp.full_scope[res] ? cmp.full_scope[res].per_segment[seg].a_C : null};
      if (papd != null) overall += papd * (pdC[seg] || 0);
      if (cmp.full_scope[res]) overallBase += cmp.full_scope[res].per_segment[seg].a_C * (pdC[seg] || 0);
    });
    d.resources[res] = {per_segment: per, delta_papd_overall: overall / PDC,
                        control_faucet_papd: overallBase / PDC};
  });
  STORY_CATS.forEach(cat => {
    const per = {};
    SEGS.forEach(seg => {
      const k = kBridge['HC'][seg];
      const dw = r.m.byCategory[cat][seg]['HC'] - base.byCategory[cat][seg]['HC'];
      per[seg] = {delta_papd: (k != null) ? dw * k : null};
    });
    d.categories[cat] = per;
  });
  out.scenarios[id] = d;
}
// ---------------------------------------------------------------- model reach vs MEASURED reach
// The A/B export now reports actual Night Sky round completion per bucket. That is the ground
// truth the engine's survival model should be calibrated against — and it disagrees sharply at
// both ends (model too generous at 10-19, far too harsh at 100+), so every NS number priced above
// carries that error. Published here rather than buried.
const SEG_TO_BUCKET = {'0-9': '1-9', '10-19': '10-19', '20-39': '20-39',
                       '40-99': '40-99', '100+': '100+'};
let abs = null;
try { abs = JSON.parse(fs.readFileSync(path.join(OUT, 'ab_summary.json'), 'utf8')); } catch (e) {}
out.ns_reach_check = {};
if (abs) {
  const pick = (label, bucket) => {
    const row = abs.buckets[bucket] && abs.buckets[bucket][label];
    return row ? (row.variant != null ? row.variant : row.control) : null;
  };
  SEGS.forEach(seg => {
    const b = SEG_TO_BUCKET[seg], ns = base.ns[seg];
    if (!ns) return;
    const meas = [1, 2, 3].map(i => {
      const keys = Object.keys(abs.buckets[b] || {}).filter(k => k.startsWith(`R${i} finished`));
      return keys.length ? pick(keys[0], b) : null;
    });
    out.ns_reach_check[seg] = ns.rounds.map((r, i) => ({
      round: r.round, req: r.req, model_reach_pct: 100 * r.reach,
      measured_finished_pct: meas[i], hc: r.hc,
      ratio: (meas[i] != null && meas[i] > 0) ? (100 * r.reach) / meas[i] : null,
    }));
  });
}

// ---------------------------------------------------------------- the ladders themselves
// Published so the report can show the exact cells a designer would edit without re-reading the
// workbook (and so the numbers in the prose cannot drift from the ones that were priced).
out.ladders = {
  c_day: CDAY_ROWS.map((r, i) => ({day: i + 1, hc: +data['c_day'].values[r][CDAY_COL] || 0})),
  c_day_v2: CDAY_ROWS.map((r, i) => ({day: i + 1, hc: +data['c_day_v2'].values[r][CDAY_COL] || 0})),
  saga: {},
  ns: {},
};
SEGS.forEach(seg => {
  const c = SAGA_HC_COL[seg];
  const hc = SAGA_ROWS.map(r => +data['c_saga_v2'].values[r][c] || 0);
  const lv = SAGA_ROWS.map(r => +data['c_saga_v2'].values[r][c - 2] || 0);
  const baseHc = SAGA_ROWS.map(r => +data['c_saga'].values[r][c] || 0);
  const baseLv = SAGA_ROWS.map(r => +data['c_saga'].values[r][c - 2] || 0);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  out.ladders.saga[seg] = {
    v2_nodes: hc, v2_hc_total: sum(hc), v2_levels: sum(lv),
    v2_hc_per_level: sum(lv) ? sum(hc) / sum(lv) : null,
    base_hc_per_level: sum(baseLv) ? sum(baseHc) / sum(baseLv) : null,
  };
  out.ladders.ns[seg] = readNSLadder_(seg, 'NS_v2').map((ms, i) => ({
    round: i + 1, cum_req: ms.req, hc: +(ms.rew['HC'] || 0),
    base_hc: (readNSLadder_(seg, 'NS')[i] ? +(readNSLadder_(seg, 'NS')[i].rew['HC'] || 0) : null),
  }));
});

fs.mkdirSync(OUT, {recursive: true});
fs.writeFileSync(path.join(OUT, 'proposal_pricing.json'), JSON.stringify(out, null, 1));

// ---------------------------------------------------------------- console summary
const f = (x, n = 2) => (x == null ? '   n/a' : (x >= 0 ? '+' : '') + x.toFixed(n));
console.log('NS round reach at the shipped gates (NS_v2, nonpayer streak percentiles x ' + NS_STREAK_N + '):');
SEGS.forEach(seg => {
  const ns = base.ns[seg];
  if (!ns) return;
  const parts = ns.rounds.map(r => `R${r.round} req ${r.req} reach ${(100 * r.reach).toFixed(1)}% ` +
                                   `hc ${r.hc} -> E ${r.e_hc.toFixed(1)}`);
  console.log(`  ${seg.padEnd(6)} p50 streak ${ns.streak_pct.p50} | ` + parts.join(' | '));
});
console.log('\nscenario deltas (per active player-day, overall pd-weighted):');
console.log('  id                    HC        SPT     UL Lives   (Control HC faucet ' +
            out.scenarios['BASE'].resources['HC'].control_faucet_papd.toFixed(1) + '/pd)');
Object.keys(out.scenarios).forEach(id => {
  const s = out.scenarios[id];
  console.log(`  ${id.padEnd(20)} ${f(s.resources['HC'].delta_papd_overall).padStart(8)} ` +
              `${f(s.resources['SPT'].delta_papd_overall).padStart(9)} ` +
              `${f(s.resources['Unlimited Lives'].delta_papd_overall).padStart(9)}   ${s.label}`);
});
if (Object.keys(out.ns_reach_check).length) {
  console.log('\nNS reach: engine model vs MEASURED round completion (Variant):');
  SEGS.forEach(seg => {
    const rows = out.ns_reach_check[seg];
    if (!rows) return;
    console.log('  ' + seg.padEnd(6) + rows.map(r =>
      `R${r.round} model ${r.model_reach_pct.toFixed(1)}% vs live ` +
      (r.measured_finished_pct == null ? 'n/a' : r.measured_finished_pct.toFixed(1) + '%') +
      (r.ratio ? ` (x${r.ratio.toFixed(2)})` : '')).join(' | '));
  });
}
console.log('\nwritten analysis/out/proposal_pricing.json');
