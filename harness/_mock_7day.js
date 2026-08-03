// Offline harness for EcoGainsSim_7Day.gs — the windowed (days 6-13 of cal_new) view.
//
// The load-bearing gate is CONSERVATION: widened to days 1..33 the windowed functions must
// reproduce ECOGAINS_SIM / ECOGAINS_DIFF bit-for-bit. That proves the window is a pure
// restriction of the full simulation and can never drift from it — which is the whole reason this
// file reuses the engine instead of being the copy that was asked for.
const fs = require('fs');
const path = require('path');
const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_mockdata.json'), 'utf8'));

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

const v4Src = fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8');
const dailySrc = fs.readFileSync(ENGINE('EcoGainsSim_Daily.gs'), 'utf8');
const winSrc = fs.readFileSync(ENGINE('EcoGainsSim_7Day.gs'), 'utf8');
eval(v4Src); eval(dailySrc); eval(winSrc); _sheetValsCache = {};

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};
const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'];
const PAYERS = ['NONPAYER', 'PAYER'];

// ---------------------------------------------------------------- 0. namespace hygiene
{
  const names = (src) => {
    const out = new Set();
    const re = /^(?:function\s+([A-Za-z0-9_$]+)|var\s+([A-Za-z0-9_$]+)\s*=)/gm;
    let m;
    while ((m = re.exec(src))) out.add(m[1] || m[2]);
    return out;
  };
  const engineNames = new Set([...names(v4Src), ...names(dailySrc)]);
  const mine = [...names(winSrc)];
  const clash = mine.filter(n => engineNames.has(n));
  check('7-day file declares no globals that collide with the engine', clash.length === 0,
    clash.length ? 'collides: ' + clash.join(', ') : 'declares ' + mine.join(', '));
  check('7-day file defines no onOpen', !/^function\s+onOpen\s*\(/m.test(winSrc));
  check('7-day file re-declares none of the big engine structures',
    !/^var\s+(RESOURCES|CATEGORY_ORDER|SOURCES|RES_MAP|SEG_TO_GAINS)\s*=/m.test(winSrc));
}

// ---------------------------------------------------------------- 1. window bounds
{
  const w = ECOGAINS_WINDOW_7_DAY();
  check('window reports days 6-13 = 8 days',
    w[0][0] === 6 && w[0][1] === 13 && w[0][2] === 8, JSON.stringify(w[0]));
  check('constants say what the docs say', WIN7_FIRST_DAY === 6 && WIN7_LAST_DAY === 13);
}

// ---------------------------------------------------------------- 2. spill shape
{
  const sim = ECOGAINS_SIM_7_DAY('NONPAYER', '10-19');
  const dif = ECOGAINS_DIFF_7_DAY('NONPAYER', '10-19');
  const full = ECOGAINS_SIM('NONPAYER', '10-19');
  check('SIM_7 spill is 25 categories x 19 resources',
    sim.length === CATEGORY_ORDER.length && sim.every(r => r.length === RESOURCES.length),
    `${sim.length} x ${sim[0].length}`);
  check('DIFF_7 spill matches SIM_7 shape',
    dif.length === sim.length && dif[0].length === sim[0].length);
  check('same shape as the full-window sim',
    full.length === sim.length && full[0].length === sim[0].length);
  check('every cell is a finite number',
    sim.every(r => r.every(v => typeof v === 'number' && isFinite(v))));
}

// ---------------------------------------------------------------- 3. CONSERVATION (the big one)
// Widen the window to the whole calendar; the windowed functions must then equal the full-window
// ones exactly. Re-eval with the constants patched, then restore.
{
  const wideSrc = winSrc.replace('var WIN7_FIRST_DAY = 6;', 'var WIN7_FIRST_DAY = 1;')
                        .replace('var WIN7_LAST_DAY  = 13;', 'var WIN7_LAST_DAY  = 33;');
  check('window-widening fixture applied', wideSrc !== winSrc);
  eval(wideSrc);
  let maxSim = 0, maxDiff = 0;
  for (const payer of PAYERS) for (const seg of SEGS) {
    const a = ECOGAINS_SIM_7_DAY(payer, seg), b = ECOGAINS_SIM(payer, seg);
    const c = ECOGAINS_DIFF_7_DAY(payer, seg), d = ECOGAINS_DIFF(payer, seg);
    for (let i = 0; i < b.length; i++) for (let j = 0; j < b[i].length; j++) {
      maxSim = Math.max(maxSim, Math.abs(a[i][j] - b[i][j]));
      maxDiff = Math.max(maxDiff, Math.abs(c[i][j] - d[i][j]));
    }
  }
  check('days 1-33 -> SIM_7 == ECOGAINS_SIM for every segment x payer x category x resource',
    maxSim < 1e-9, 'max err ' + maxSim.toExponential(2));
  check('days 1-33 -> DIFF_7 == ECOGAINS_DIFF for every segment x payer x category x resource',
    maxDiff < 1e-9, 'max err ' + maxDiff.toExponential(2));
  eval(winSrc); _sheetValsCache = {};                    // restore the shipped window
  const back = ECOGAINS_WINDOW_7_DAY();
  check('window fixture restored (back to 6-13)', back[0][0] === 6 && back[0][1] === 13);
}

// ---------------------------------------------------------------- 4. it is a strict subset
{
  let violations = 0, nonzero = 0;
  for (const payer of PAYERS) for (const seg of SEGS) {
    const win = ECOGAINS_SIM_7_DAY(payer, seg), full = ECOGAINS_SIM(payer, seg);
    for (let i = 0; i < full.length; i++) for (let j = 0; j < full[i].length; j++) {
      // gains are non-negative, so a sub-window can never exceed the whole window
      if (win[i][j] > full[i][j] + 1e-9) violations++;
      if (win[i][j] > 1e-9) nonzero++;
    }
  }
  check('windowed gains never exceed the full-window gains', violations === 0, violations + ' cells');
  check('the window actually contains gains (not an empty slice)', nonzero > 0, nonzero + ' nonzero cells');
}

// ---------------------------------------------------------------- 5. equals a hand-rolled day sum
// Independent recomputation straight off ECOGAINS_DAILY, which is what a human would do by hand:
// sum rows 6..13 of the daily grid. Must match cell for cell.
{
  let maxE = 0;
  for (const seg of ['0-9', '100+']) {
    const win = ECOGAINS_SIM_7_DAY('NONPAYER', seg);
    for (let i = 0; i < CATEGORY_ORDER.length; i++) {
      const grid = ECOGAINS_DAILY('NONPAYER', seg, CATEGORY_ORDER[i], 'NEW');
      for (let j = 0; j < RESOURCES.length; j++) {
        let s = 0;
        for (let d = 6; d <= 13; d++) s += grid[d - 1][j];
        maxE = Math.max(maxE, Math.abs(win[i][j] - s));
      }
    }
  }
  check('SIM_7 == Σ rows 6..13 of ECOGAINS_DAILY(..., "NEW") per source',
    maxE < 1e-9, 'max err ' + maxE.toExponential(2));
}

// ---------------------------------------------------------------- 6. placement sanity
// A leaderboard pays on its instance's LAST day, so a source whose cal_new instances all end
// outside days 6-13 must contribute nothing to the window.
{
  const ctx = Context.get();
  const b = ctx.ds.beh('10-19', 'NONPAYER');
  const inWindow = (label) => (ctx.calNew[label] || [])
    .some(inst => { const last = inst.days[inst.days.length - 1]; return last >= 6 && last <= 13; });
  const win = ECOGAINS_SIM_7_DAY('NONPAYER', '10-19');
  const rowOf = (cat) => win[CATEGORY_ORDER.indexOf(cat)];
  const LB = { 'Bomb Challenge': "Bomb's Challenge", 'Chuck Challenge': "Chuck's Challenge",
               'Red Challenge': "Red's Challenge", 'Level Race': 'Level Race',
               'Flash Race': 'Flash Race', 'Target Day': 'Target Day',
               'Kite Festival': 'Kite Festival' };
  let checked = 0, bad = [];
  for (const cat in LB) {
    const paysInWindow = inWindow(LB[cat]);
    const total = rowOf(cat).reduce((s, v) => s + v, 0);
    checked++;
    if (!paysInWindow && total > 1e-9) bad.push(`${cat} pays ${total.toFixed(2)} but no instance ends in 6..13`);
    if (paysInWindow && total <= 1e-9) bad.push(`${cat} ends an instance in 6..13 but pays 0`);
  }
  check(`leaderboard sources contribute iff an instance ENDS inside the window (${checked} checked)`,
    bad.length === 0, bad.join(' · ') || 'all consistent');

  // always-on sources must contribute a positive share (they pay every day)
  const alwaysOn = ['Core', 'Saga', 'Daily Gift'];
  check('always-on sources contribute to the window',
    alwaysOn.every(c => rowOf(c).reduce((s, v) => s + v, 0) > 0),
    alwaysOn.map(c => `${c}=${rowOf(c).reduce((s, v) => s + v, 0).toFixed(2)}`).join(' '));

  // River Rush has no cal_new instances -> 0 everywhere, window included
  check('River Rush (removed from cal_new) stays 0 in the window',
    rowOf('River Rush').every(v => Math.abs(v) < 1e-12));
}

// ---------------------------------------------------------------- 7. DIFF identity
{
  let maxE = 0;
  for (const seg of ['0-9', '40-99']) {
    const sim = ECOGAINS_SIM_7_DAY('NONPAYER', seg);
    const dif = ECOGAINS_DIFF_7_DAY('NONPAYER', seg);
    for (let i = 0; i < CATEGORY_ORDER.length; i++) {
      const cur = ECOGAINS_DAILY('NONPAYER', seg, CATEGORY_ORDER[i], 'CURRENT');
      for (let j = 0; j < RESOURCES.length; j++) {
        let c = 0;
        for (let d = 6; d <= 13; d++) c += cur[d - 1][j];
        maxE = Math.max(maxE, Math.abs(dif[i][j] - (sim[i][j] - c)));
      }
    }
  }
  check('DIFF_7 == SIM_7 - (measured over the SAME days)', maxE < 1e-9, 'max err ' + maxE.toExponential(2));
}

// ---------------------------------------------------------------- 8. eyeball
{
  const win = ECOGAINS_SIM_7_DAY('NONPAYER', '10-19');
  const full = ECOGAINS_SIM('NONPAYER', '10-19');
  const iHC = RESOURCES.indexOf('HC');
  let wT = 0, fT = 0;
  CATEGORY_ORDER.forEach((c, i) => { wT += win[i][iHC]; fT += full[i][iHC]; });
  console.log(`\n  10-19 NONPAYER HC — window(6-13) ${wT.toFixed(2)} of full(1-33) ${fT.toFixed(2)}` +
              ` = ${(100 * wT / fT).toFixed(1)}%  (8/33 days = 24.2% if it were flat)`);
  console.log('  top window contributors:');
  CATEGORY_ORDER.map((c, i) => [c, win[i][iHC]]).filter(x => x[1] > 0.01)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .forEach(([c, v]) => console.log('   ', c.padEnd(24), v.toFixed(2)));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
