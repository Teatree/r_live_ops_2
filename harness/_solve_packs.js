// Pack-reward calibration driver (D21).
//
// Authors the pack ladders described by builders/_pack_spec.json into an in-memory copy of the
// workbook, prices them through the REAL engine (packLane_ / simSeasonPass / simRainbowMaker /
// simNightSky), then opens the resulting packs through the REAL card sim (CardOpenings.gs) to
// measure cards drawn and album-1 completion.
//
// Why the population is modelled as segment x ACTIVITY rather than segment alone: packLane_
// returns ONE expected value per (segment, payer), but the user's targets are population
// percentiles. Segment shares alone cannot separate payer p25 from payer p50 — segment 0-9 spans
// 0-51.8% of payers. Within-segment activity does: data_seg_beh carries active_days p25/p50/p75/p90
// (payer 0-9: 3/10/21/28 days), a ~10x spread. So each (segment, payer) is expanded into activity
// cells by scaling weekday/weekend_active_rate by lambda = active_days_q / active_days_mean, and
// the population distribution is the share-weighted pool of all cells.
//
// Run:  node harness/_solve_packs.js            # full calibration report
//       node harness/_solve_packs.js --price    # pricing only (fast, no card sim)
//       node harness/_solve_packs.js --seeds=5  # seeds per activity cell (default 3)

const fs = require('fs');
const path = require('path');

const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);
const RAW = fs.readFileSync(path.join(__dirname, '_mockdata.json'), 'utf8');
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'builders', '_pack_spec.json'), 'utf8'));

const ARGS = process.argv.slice(2);
const PRICE_ONLY = ARGS.includes('--price');
const VERBOSE = ARGS.includes('--verbose');
const SEEDS = Number((ARGS.find(a => a.startsWith('--seeds=')) || '--seeds=3').split('=')[1]);
const SCALE_OVERRIDE = ARGS.find(a => a.startsWith('--scale='));
if (SCALE_OVERRIDE) SPEC.scale = Number(SCALE_OVERRIDE.split('=')[1]);

const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+'];
const PAYERS = ['NONPAYER', 'PAYER'];
const SEASON_DAYS = 28;          // user decision: a season is 28 days = 4 weeks
const WINDOW_DAYS = 33;          // the engine's cal_new window
const SEASON_SCALE = SEASON_DAYS / WINDOW_DAYS;
const ALBUM_CARDS = 72;

// targets: [cards/week] by band, free then payer
const TARGETS = {
  NONPAYER: { p25: 3.5, p50: 12.5, p75: 31.9, p90: 49.5 },
  PAYER:    { p25: 4.8, p50: 16.8, p75: 43.1, p90: 67.1 },
};
const COMPLETION_TARGET = { p25: 0.18, p50: 0.55, p75: 0.85, p90: 0.95 };  // free; p25 relaxed (decision 13)

const src = {
  v4: fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8'),
  daily: fs.readFileSync(ENGINE('EcoGainsSim_Daily.gs'), 'utf8'),
  cards: fs.readFileSync(ENGINE('CardOpenings.gs'), 'utf8'),
};

// ------------------------------------------------------------------ writable sheet mock
let data;
function ensure(sheet, r, c) {
  while (sheet.values.length < r) sheet.values.push([]);
  const row = sheet.values[r - 1];
  while (row.length < c) row.push('');
  return row;
}
const colToNum = (s) => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);

function mkRange(name, r1, c1, nr, nc) {
  const sh = data[name];
  return {
    getRow: () => r1, getColumn: () => c1, getNumRows: () => nr, getNumColumns: () => nc,
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
    setValue: (v) => { ensure(sh, r1, c1)[c1 - 1] = v; },
    setValues: (grid) => {
      for (let i = 0; i < grid.length; i++)
        for (let j = 0; j < grid[i].length; j++) ensure(sh, r1 + i, c1 + j)[c1 + j - 1] = grid[i][j];
    },
    clearContent: () => {
      for (let r = r1; r < r1 + nr; r++)
        for (let c = c1; c < c1 + nc; c++) if (sh.values[r - 1]) ensure(sh, r, c)[c - 1] = '';
    },
    setHorizontalAlignment: () => {},
  };
}
function mkSheet(name) {
  const sh = data[name];
  if (!sh) return null;
  return {
    getName: () => name,
    getLastRow: () => sh.values.length,
    getDataRange: () => mkRange(name, 1, 1, sh.values.length, sh.values.reduce((m, r) => Math.max(m, r.length), 0)),
    getRange: (a, b, c, d) => {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
        const c1 = colToNum(m[1]), r1 = +m[2];
        if (!m[3]) return mkRange(name, r1, c1, 1, 1);
        return mkRange(name, r1, c1, +m[4] - r1 + 1, colToNum(m[3]) - c1 + 1);
      }
      return mkRange(name, a, b, c || 1, d || 1);
    },
  };
}
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({ getSheetByName: (n) => mkSheet(n) }),
  getActive: () => ({ toast: () => {} }),
};
global.Logger = { log: () => {} };

// ------------------------------------------------------------------ spec -> ladder cells
// Returns the 0-based sheet rows that carry one pack of `star` for this block.
function tierRows(block, starCfg, scale) {
  // Explicit row list: an authored ramp that frac/every cannot express (uneven spacing — sparse
  // low on the ladder, dense at the top). `scale` deliberately does NOT apply to these.
  if (starCfg.rows) return starCfg.rows.filter(r => r >= block.r0 && r <= block.r1);
  const n = block.r1 - block.r0 + 1;
  let frac = starCfg.frac != null ? starCfg.frac : 1;
  let every = starCfg.every || 1;
  const need = frac * (scale == null ? 1 : scale);
  if (need <= 1) frac = need;
  else { frac = 1; every = Math.max(1, Math.round(every / need)); }
  const k = Math.max(0, Math.min(n, Math.ceil(frac * n)));
  const out = [];
  // Default: walk from the GOOD end (best rank / deepest milestone). `from:'low'` walks from the
  // ENTRY end instead — needed for 1-star, whose whole point is to reach players who never get
  // deep into a ladder. Sampling a long ladder from the top with a wide `every` skips the early
  // rows entirely, which is how segment 0-9 ended up earning no 1-star packs at all.
  const lowFirst = starCfg.from === 'low';
  for (let i = 0; i < k; i += every) {
    if (lowFirst) out.push(block.dir === 'rank' ? block.r1 - i : block.r0 + i);
    else          out.push(block.dir === 'rank' ? block.r0 + i : block.r1 - i);
  }
  return out;
}

function applySpec(spec) {
  const placed = [];   // {block, star, rows}
  spec.blocks.forEach((b) => {
    const sh = data[b.sheet];
    if (!sh) { console.log('  !! spec block references missing sheet: ' + b.sheet); return; }
    Object.keys(b.tiers).forEach((star) => {
      const rows = tierRows(b, b.tiers[star], spec.scale);
      const col = b.colBase + (Number(star) - 1);
      rows.forEach((r) => { ensure(sh, r + 1, col + 1)[col] = 1; });
      placed.push({ id: b.id, sheet: b.sheet, star: Number(star), rows: rows.slice() });
    });
  });
  return placed;
}

// ------------------------------------------------------------------ activity model
// Scale a segment's weekday/weekend active rates so the player is active lambda x as often.
const SB = { wd: 12, we: 13, mean: 7, p25: 8, p50: 9, p75: 10, p90: 11, seg: 0, payer: 1, users: 3 };
function segBehRows(d) {
  const v = d['data_seg_beh'].values;
  return v.slice(1).filter(r => r[SB.seg]);
}
function patchActivity(lambda) {
  const v = data['data_seg_beh'].values;
  for (let i = 1; i < v.length; i++) {
    if (!v[i] || !v[i][SB.seg]) continue;
    const base = JSON.parse(RAW)['data_seg_beh'].values[i];
    v[i][SB.wd] = Math.min(1, Number(base[SB.wd]) * lambda);
    v[i][SB.we] = Math.min(1, Number(base[SB.we]) * lambda);
  }
}

function reload() {
  eval(src.v4); eval(src.daily); eval(src.cards);
  _sheetValsCache = {};
  return { dailyPacksFor_, Context, SimulatePackOpenings, PACK_RES, DAILY_DAYS };
}

// ------------------------------------------------------------------ measurement
function packFlow(api, seg, payer) {
  const flow = api.dailyPacksFor_(seg, payer, api.Context.get());
  const byTier = [0, 0, 0, 0, 0, 0];
  flow.total.forEach(row => row.forEach((v, i) => { byTier[i] += v; }));
  const bySource = {};
  (flow.bySource || []).forEach((s) => {          // dailyPacksFor_ returns {cat, days}
    const name = s.cat;
    bySource[name] = bySource[name] || [0, 0, 0, 0, 0, 0];
    (s.days || []).forEach(row => row.forEach((v, i) => { bySource[name][i] += v; }));
  });
  return { byTier, bySource, flow };
}

function runCards(api, seg, payer, seed) {
  const so = data['SimOutput'];
  ensure(so, 2, 2)[1] = seg;
  ensure(so, 2, 4)[3] = payer;
  ensure(so, 2, 7)[6] = seed;
  api.SimulatePackOpenings();
  const tally = (r) => Number(so.values[42 - 1 + r] ? so.values[42 - 1 + r][1] : 0);
  const packsOpened = tally(0), cardsDrawn = tally(1);
  // daily block: [day, balance, collectionSize, completionFrac, sets, albumNum, packs].
  // completionFrac is per-CURRENT-album and resets on album advance, so album-1 completion is the
  // max frac observed while still on album 1 — or a flat 1.0 if the player ever reached album 2.
  let a1 = 0, advanced = false;
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const row = so.values[6 - 1 + i];
    if (!row) continue;
    const album = Number(row[5]) || 1;
    if (album > 1) advanced = true;
    else a1 = Math.max(a1, Number(row[3]) || 0);
  }
  return { packsOpened, cardsDrawn, completion: advanced ? 1 : a1 };
}

// ------------------------------------------------------------------ main
console.log('PACK CALIBRATION — spec scale ' + SPEC.scale + ', season ' + SEASON_DAYS + 'd, seeds ' + SEEDS);

data = JSON.parse(RAW);
const placed = applySpec(SPEC);
let api = reload();

// --- invariant: every authored cell is exactly 1, and no 6-star anywhere
{
  let bad = 0, sixStar = 0;
  placed.forEach(p => p.rows.forEach(() => {}));
  Object.keys(data).forEach((name) => {
    const sh = data[name];
    if (!sh.values) return;
    sh.values.forEach((row) => (row || []).forEach((v) => {}));
  });
  SPEC.blocks.forEach((b) => {
    Object.keys(b.tiers).forEach((star) => {
      if (Number(star) === 6) sixStar++;
      tierRows(b, b.tiers[star], SPEC.scale).forEach((r) => {
        const val = data[b.sheet].values[r][b.colBase + Number(star) - 1];
        if (Number(val) !== 1) bad++;
      });
    });
  });
  console.log('  invariant: all authored cells == 1 -> ' + (bad === 0 ? 'OK' : bad + ' BAD'));
  console.log('  invariant: no 6-star tier in spec  -> ' + (sixStar === 0 ? 'OK' : 'VIOLATED'));
}

console.log('\n--- authored ladder rows (per block) ---');
placed.filter(p => p.rows.length).forEach((p) => {
  console.log('  ' + p.id.padEnd(26) + ' ' + p.star + '-star x' + String(p.rows.length).padStart(3) +
    '  rows ' + p.rows.slice(0, 12).join(',') + (p.rows.length > 12 ? ',...' : ''));
});

console.log('\n--- pack flow per season (28d), lambda = 1 (segment mean activity) ---');
console.log('  seg      payer      1*     2*     3*     4*     5*   total   cards');
const cardsPerOpen = [2, 3, 4, 5, 6, 7];
for (const payer of PAYERS) {
  for (const seg of SEGS) {
    const { byTier } = packFlow(api, seg, payer);
    const s = byTier.map(v => v * SEASON_SCALE);
    const tot = s.reduce((a, b) => a + b, 0);
    const cards = s.reduce((a, b, i) => a + b * cardsPerOpen[i], 0);
    console.log('  ' + seg.padEnd(8) + payer.padEnd(10) +
      s.slice(0, 5).map(v => v.toFixed(1).padStart(6)).join(' ') +
      tot.toFixed(1).padStart(8) + cards.toFixed(1).padStart(8));
  }
}

// --- per-source share, population-weighted -----------------------------------------------------
// Weighted by unique_players so the share reflects the faucet as the whole player base sees it,
// not an unweighted average over segments (0-9 alone is ~half the base).
{
  const behAll = segBehRows(JSON.parse(RAW));
  const users = (seg, payer) => {
    const r = behAll.find(x => x[SB.seg] === seg && x[SB.payer] === payer);
    return r ? Number(r[SB.users]) : 0;
  };
  const acc = {};                       // source -> [6 tiers] of population-weighted packs
  const accByPayer = { NONPAYER: {}, PAYER: {} };
  let totW = 0;
  for (const payer of PAYERS) {
    for (const seg of SEGS) {
      const w = users(seg, payer);
      totW += w;
      const { bySource } = packFlow(api, seg, payer);
      Object.keys(bySource).forEach((s) => {
        acc[s] = acc[s] || [0, 0, 0, 0, 0, 0];
        accByPayer[payer][s] = accByPayer[payer][s] || [0, 0, 0, 0, 0, 0];
        bySource[s].forEach((v, i) => { acc[s][i] += v * w; accByPayer[payer][s][i] += v * w; });
      });
    }
  }
  const grand = Object.values(acc).reduce((s, a) => s + a.reduce((x, y) => x + y, 0), 0);
  console.log('\n--- % SHARE OF PACKS BY SOURCE (population-weighted, all tiers) ---');
  console.log('  source                     share      1*     2*     3*     4*     5*');
  Object.entries(acc).sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0))
    .forEach(([s, a]) => {
      const tot = a.reduce((x, y) => x + y, 0);
      console.log('  ' + s.padEnd(26) + (100 * tot / grand).toFixed(1).padStart(6) + '%' +
        a.slice(0, 5).map(v => (100 * v / grand).toFixed(1).padStart(7)).join(''));
    });
  console.log('\n--- tier mix (population-weighted) ---');
  const tierTot = [0, 0, 0, 0, 0, 0];
  Object.values(acc).forEach(a => a.forEach((v, i) => { tierTot[i] += v; }));
  console.log('  ' + tierTot.map((v, i) => (i + 1) + '*: ' + (100 * v / grand).toFixed(1) + '%').join('   '));
}

if (PRICE_ONLY) { console.log('\n(--price: stopping before the card sim)'); process.exit(0); }

// --- activity grid -------------------------------------------------------------------------
const behBase = segBehRows(JSON.parse(RAW));

// Uniform grid over the within-segment activity quantile function. data_seg_beh gives active_days
// at q = .25/.50/.75/.90 only, so the curve is piecewise-linear through those anchors, pinned at
// q=0 (a floor of ~half the p25 day count) and extrapolated to q=1. Sampling on a UNIFORM q grid
// means every cell carries equal within-segment weight — no hand-assigned band widths.
const Q_GRID = [];
for (let q = 0.025; q < 1; q += 0.05) Q_GRID.push(Math.round(q * 1000) / 1000);

function lambdasFor(seg, payer) {
  const row = behBase.find(r => r[SB.seg] === seg && r[SB.payer] === payer);
  if (!row) return null;
  const mean = Number(row[SB.mean]) || 1;
  const p = [SB.p25, SB.p50, SB.p75, SB.p90].map(i => Number(row[i]));
  const anchors = [[0, Math.max(0.5, p[0] * 0.5)], [0.25, p[0]], [0.5, p[1]],
                   [0.75, p[2]], [0.9, p[3]], [1, p[3] * 1.25]];
  const daysAt = (q) => {
    for (let i = 1; i < anchors.length; i++) {
      if (q <= anchors[i][0]) {
        const [q0, d0] = anchors[i - 1], [q1, d1] = anchors[i];
        return d0 + (d1 - d0) * (q1 === q0 ? 0 : (q - q0) / (q1 - q0));
      }
    }
    return anchors[anchors.length - 1][1];
  };
  return {
    mean, users: Number(row[SB.users]),
    q: Q_GRID.map(q => ({ q, days: daysAt(q), lambda: Math.max(0.01, daysAt(q) / mean) })),
  };
}

console.log('\n--- card sim over the segment x activity grid ---');
console.log('  seg      payer     q    lam   packs   cards  cards/wk   compl');
const cells = [];
for (const payer of PAYERS) {
  for (const seg of SEGS) {
    const L = lambdasFor(seg, payer);
    if (!L) continue;
    for (const band of L.q) {
      data = JSON.parse(RAW);
      applySpec(SPEC);
      patchActivity(band.lambda);
      api = reload();
      let cards = 0, compl = 0, packs = 0;
      for (let s = 1; s <= SEEDS; s++) {
        const r = runCards(api, seg, payer, 1000 + s);
        cards += r.cardsDrawn; compl += r.completion; packs += r.packsOpened;
      }
      cards /= SEEDS; compl /= SEEDS; packs /= SEEDS;
      const cardsSeason = cards * SEASON_SCALE, packsSeason = packs * SEASON_SCALE;
      const cw = cardsSeason / 4;
      cells.push({ seg, payer, q: band.q, users: L.users, cards: cardsSeason, packs: packsSeason, cw, compl });
      if (VERBOSE)
        console.log('  ' + seg.padEnd(8) + payer.padEnd(9) + String(band.q).padStart(5) +
          band.lambda.toFixed(2).padStart(7) + packsSeason.toFixed(1).padStart(8) +
          cardsSeason.toFixed(1).padStart(8) + cw.toFixed(1).padStart(10) +
          (compl * 100).toFixed(1).padStart(8) + '%');
    }
  }
}

// --- population percentiles ------------------------------------------------------------------
// Each cell is one activity quantile band of a segment; weight = segment share x band width.
// Every cell is one equal-width activity slice of its segment, so its population weight is just
// the segment's share of players divided by the number of slices.
function percentiles(payer) {
  const rows = cells.filter(c => c.payer === payer);
  const w = (c) => c.users / Q_GRID.length;
  const totW = rows.reduce((s, c) => s + w(c), 0);
  const sorted = rows.slice().sort((a, b) => a.cw - b.cw);
  // Interpolate between adjacent cells at the cell MIDPOINTS. Taking the first cell whose
  // cumulative weight crosses p is a step function: with a plateau in the distribution (segment
  // 0-9 is ~half the base and caps out) the reported band jumps between cells on tiny changes.
  const pts = [];
  let acc = 0;
  for (const c of sorted) {
    const wt = w(c) / totW;
    pts.push({ q: acc + wt / 2, c });
    acc += wt;
  }
  const out = {};
  [0.25, 0.5, 0.75, 0.9].forEach((p) => {
    if (p <= pts[0].q) { out[p] = { cw: pts[0].c.cw, compl: pts[0].c.compl, cell: pts[0].c }; return; }
    const last = pts[pts.length - 1];
    if (p >= last.q) { out[p] = { cw: last.c.cw, compl: last.c.compl, cell: last.c }; return; }
    for (let i = 1; i < pts.length; i++) {
      if (p <= pts[i].q) {
        const a = pts[i - 1], b = pts[i];
        const f = (p - a.q) / (b.q - a.q);
        out[p] = { cw: a.c.cw + (b.c.cw - a.c.cw) * f,
                   compl: a.c.compl + (b.c.compl - a.c.compl) * f,
                   cell: f < 0.5 ? a.c : b.c };
        return;
      }
    }
  });
  return out;
}

console.log('\n================ POPULATION PERCENTILES vs TARGETS ================');
for (const payer of PAYERS) {
  const P = percentiles(payer);
  const T = TARGETS[payer];
  console.log('\n' + payer);
  console.log('  band   cards/wk   target    ratio   compl   compl-target   cell');
  [['p25', 0.25], ['p50', 0.5], ['p75', 0.75], ['p90', 0.9]].forEach(([name, p]) => {
    const c = P[p], t = T[name];
    const ct = payer === 'NONPAYER' ? COMPLETION_TARGET[name] : null;
    console.log('  ' + name.padEnd(6) + c.cw.toFixed(1).padStart(8) + t.toFixed(1).padStart(9) +
      (c.cw / t).toFixed(2).padStart(9) + (c.compl * 100).toFixed(1).padStart(8) + '%' +
      (ct ? (ct * 100).toFixed(0).padStart(13) + '%' : ''.padStart(14)) +
      '   ~' + c.cell.seg + ' q' + c.cell.q);
  });
}
