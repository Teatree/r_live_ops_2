// Offline verification for EcoGainsSim_Daily.gs against _mockdata.json (workbook v5).
const fs = require('fs');
const path = require('path');
const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_mockdata.json'), 'utf8'));
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

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
}
const colSum = (grid, j) => grid.reduce((s, row) => s + row[j], 0);

// ---- 1. conservation: sum of days == window totals, per resource ----
for (const payer of ['NONPAYER', 'PAYER']) {
  for (const seg of ['0-9', '100+']) {
    const winSim = ECOGAINS_SIM(payer, seg);          // 25 cats x 11
    const winDiff = ECOGAINS_DIFF(payer, seg);
    const ctx = Context.get();
    const dCur = ECOGAINS_DAILY(payer, seg, 'ALL', 'CURRENT');
    const dNew = ECOGAINS_DAILY(payer, seg, 'ALL', 'NEW');
    const dDif = ECOGAINS_DAILY(payer, seg, 'ALL', 'DIFF');
    let maxE = 0;
    for (let j = 0; j < 11; j++) {
      let wCur = 0, wNew = 0, wDif = 0;
      CATEGORY_ORDER.forEach((cat, i) => {
        wNew += winSim[i][j]; wDif += winDiff[i][j];
        wCur += num(measuredRow_(cat, seg, payer, ctx.ds)[RESOURCES[j]]);
      });
      maxE = Math.max(maxE,
        Math.abs(colSum(dCur, j) - wCur),
        Math.abs(colSum(dNew, j) - wNew),
        Math.abs(colSum(dDif, j) - wDif));
    }
    check(`conservation ${seg} ${payer}`, maxE < 1e-6, 'max err ' + maxE.toExponential(2));
  }
}

// ---- 2. placement checks (0-9 NONPAYER) ----
const HC = 0;
const kite = ECOGAINS_DAILY('NONPAYER', '0-9', 'Kite Festival', 'NEW');
const kiteDays = kite.map((row, d) => row.reduce((s, x) => s + Math.abs(x), 0) > 1e-12 ? d + 1 : 0).filter(Boolean);
check('Kite NEW pays only on last days {5,12,19,26,33}', JSON.stringify(kiteDays) === JSON.stringify([5, 12, 19, 26, 33]), 'got ' + JSON.stringify(kiteDays));

const ns = ECOGAINS_DAILY('NONPAYER', '0-9', 'Daily Night Sky Prize', 'NEW');
check('Night Sky NEW pays every day', ns.every(row => row[HC] > 0));
// weekend days should carry slightly less for 0-9 (pWe 0.2763 < pWd 0.2868)
check('NS weekday > weekend allocation', ns[0][HC] > ns[2][HC], `wed ${ns[0][HC].toFixed(4)} vs fri ${ns[2][HC].toFixed(4)}`);

const rrNew = ECOGAINS_DAILY('NONPAYER', '100+', 'River Rush', 'NEW');
const rrDif = ECOGAINS_DAILY('NONPAYER', '100+', 'River Rush', 'DIFF');
const rrCur = ECOGAINS_DAILY('NONPAYER', '100+', 'River Rush', 'CURRENT');
check('River Rush NEW = 0 all days', rrNew.every(row => row.every(x => x === 0)));
const rrMeasHC = num(measuredRow_('River Rush', '100+', 'NONPAYER', Context.get().ds)['HC']);
check('River Rush CURRENT flat = measured/33', Math.abs(rrCur[0][HC] - rrMeasHC / 33) < 1e-9 && Math.abs(rrCur[32][HC] - rrMeasHC / 33) < 1e-9);
check('River Rush DIFF = -CURRENT', rrDif.every((row, d) => Math.abs(row[HC] + rrCur[d][HC]) < 1e-9));

const rm = ECOGAINS_DAILY('NONPAYER', '0-9', 'Rainbow Maker', 'NEW');
const rmDays = rm.map((row, d) => row[HC] > 1e-12 ? d + 1 : 0).filter(Boolean);
// expectation derived from the parsed calendar itself (clipped instance position varies)
const rmExpect = [...new Set((Context.get().calNew['Rainbow Maker'] || []).flatMap(i => i.days))].sort((a, b) => a - b);
check('RM NEW pays only on its instance days', JSON.stringify(rmDays) === JSON.stringify(rmExpect), 'got ' + JSON.stringify(rmDays) + ' expect ' + JSON.stringify(rmExpect));

const hh = ECOGAINS_DAILY('NONPAYER', '0-9', 'Hatchling Hideaway', 'NEW');
// marginal spread on a full 4-day HH instance: curve 0.18/0.71/1.00/1.00 -> day2 biggest, day4 ~0
const hhInst = (Context.get().calNew['Hatchling Hideaway'] || []).find(i => i.dur === 4);
const [h1, h2, h3, h4] = hhInst.days.map(d => hh[d - 1][10]);   // UL Lives
check('HH marginal spread (4d instance): day2 > day1 and day4 ≈ 0',
  h2 > h1 && h4 < 1e-9, `days ${hhInst.days}: ${[h1, h2, h3, h4].map(x => x.toFixed(3)).join(' / ')}`);

// ---- 3. source filter consistency: sum of all single-source series == ALL ----
{
  const all = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'NEW');
  const acc = Array.from({length: 33}, () => Array(11).fill(0));
  CATEGORY_ORDER.forEach(cat => {
    const g = ECOGAINS_DAILY('NONPAYER', '0-9', cat, 'NEW');
    for (let d = 0; d < 33; d++) for (let j = 0; j < 11; j++) acc[d][j] += g[d][j];
  });
  let maxE = 0;
  for (let d = 0; d < 33; d++) for (let j = 0; j < 11; j++) maxE = Math.max(maxE, Math.abs(acc[d][j] - all[d][j]));
  check('Σ single-source series == ALL', maxE < 1e-9, 'max err ' + maxE.toExponential(2));
}

// ---- 4. error handling ----
check('unknown source -> message', String(ECOGAINS_DAILY('NONPAYER', '0-9', 'Nope', 'NEW')[0][0]).indexOf('Unknown source') === 0);
check('unknown block -> message', String(ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'YO')[0][0]).indexOf('Unknown block') === 0);

// ---- 5. eyeball: HC daily NEW totals, 0-9 NONPAYER ----
const allNew = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'NEW');
const allDif = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'DIFF');
const DOW = ['Wed','Thu','Fri','Sat','Sun','Mon','Tue'];
console.log('\nday | dow | NEW HC | DIFF HC   (0-9 NONPAYER, ALL sources)');
for (let d = 1; d <= 33; d++)
  console.log(String(d).padStart(3), DOW[(d-1)%7], allNew[d-1][HC].toFixed(2).padStart(8), allDif[d-1][HC].toFixed(2).padStart(8));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
