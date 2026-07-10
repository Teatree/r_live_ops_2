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
    const winSim = ECOGAINS_SIM(payer, seg);          // 25 cats x 13
    const winDiff = ECOGAINS_DIFF(payer, seg);
    const ctx = Context.get();
    const dCur = ECOGAINS_DAILY(payer, seg, 'ALL', 'CURRENT');
    const dNew = ECOGAINS_DAILY(payer, seg, 'ALL', 'NEW');
    const dDif = ECOGAINS_DAILY(payer, seg, 'ALL', 'DIFF');
    let maxE = 0;
    for (let j = 0; j < RESOURCES.length; j++) {
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
// NS re-wire (NIGHT_SKY_REWIRE_PLAN §4.2): daily NS column sums == 33-day simulated NS row
{
  const NS_I = CATEGORY_ORDER.indexOf('Daily Night Sky Prize');
  let maxE = 0;
  for (const seg of ['0-9', '100+']) {
    const win = ECOGAINS_SIM('NONPAYER', seg)[NS_I];
    const g = ECOGAINS_DAILY('NONPAYER', seg, 'Daily Night Sky Prize', 'NEW');
    for (let j = 0; j < RESOURCES.length; j++) maxE = Math.max(maxE, Math.abs(colSum(g, j) - win[j]));
  }
  check('NS daily sums reconcile with simulated 33-day NS row', maxE < 1e-9, 'max err ' + maxE.toExponential(2));
}
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
  const acc = Array.from({length: 33}, () => Array(RESOURCES.length).fill(0));
  CATEGORY_ORDER.forEach(cat => {
    const g = ECOGAINS_DAILY('NONPAYER', '0-9', cat, 'NEW');
    for (let d = 0; d < 33; d++) for (let j = 0; j < RESOURCES.length; j++) acc[d][j] += g[d][j];
  });
  let maxE = 0;
  for (let d = 0; d < 33; d++) for (let j = 0; j < RESOURCES.length; j++) maxE = Math.max(maxE, Math.abs(acc[d][j] - all[d][j]));
  check('Σ single-source series == ALL', maxE < 1e-9, 'max err ' + maxE.toExponential(2));
}

// ---- 4. error handling ----
check('unknown source -> message', String(ECOGAINS_DAILY('NONPAYER', '0-9', 'Nope', 'NEW')[0][0]).indexOf('Unknown source') === 0);
check('unknown block -> message', String(ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'YO')[0][0]).indexOf('Unknown block') === 0);

// ---- 5. NET blocks (SPEND / CURNET / NEWNET — data_econ_daily, per earner) ----
const isBlankGrid = g => Array.isArray(g) && g.length === 33 &&
  g.every(row => Array.isArray(row) && row.length === RESOURCES.length && row.every(x => x === ''));

// 5a. fail-safe: without a data_econ_daily sheet every NET block spills a 33x13 grid of ''
{
  const stash = data['data_econ_daily'];
  delete data['data_econ_daily'];
  _sheetValsCache = {};                                   // eval'd var leaks into module scope
  const g = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'CURNET');
  check("NET fail-safe: no data_econ_daily -> 33x13 grid of ''", isBlankGrid(g));
  if (stash !== undefined) data['data_econ_daily'] = stash;
}

// 5b. synthetic fixture (deterministic; segments 0-9 and 100+ only — 10-19 deliberately missing)
function synthEconDaily() {
  const rows = [['segment', 'payer_flag', 'currency', 'day_index', 'gain_total', 'spend_total',
                 'resource_earners', 'gain_per_earner_day', 'spend_per_earner_day', 'net_per_earner_day']];
  for (const seg of ['0-9', '100+'])
    for (const payer of ['NONPAYER', 'PAYER'])
      RESOURCES.forEach((res, j) => {
        for (let d = 1; d <= 33; d++) {
          const gain = 10 + 0.1 * d + j, spend = 8 + 0.05 * d;
          rows.push([seg, payer, res, d, gain * 1000, spend * 1000, 1000, gain, spend, gain - spend]);
        }
      });
  return { values: rows, merges: [] };
}
{
  const stash = data['data_econ_daily'];
  data['data_econ_daily'] = synthEconDaily();
  _sheetValsCache = {};
  for (const payer of ['NONPAYER', 'PAYER']) {
    for (const seg of ['0-9', '100+']) {
      const spend = ECOGAINS_DAILY(payer, seg, 'ALL', 'SPEND');
      const curnet = ECOGAINS_DAILY(payer, seg, 'ALL', 'CURNET');
      const newnet = ECOGAINS_DAILY(payer, seg, 'ALL', 'NEWNET');
      const dif = ECOGAINS_DAILY(payer, seg, 'ALL', 'DIFF');
      let eS = 0, eC = 0, eN = 0;
      for (let d = 0; d < 33; d++) for (let j = 0; j < RESOURCES.length; j++) {
        const gain = 10 + 0.1 * (d + 1) + j, sp = 8 + 0.05 * (d + 1);
        eS = Math.max(eS, Math.abs(spend[d][j] - sp));
        eC = Math.max(eC, Math.abs(curnet[d][j] - (gain - sp)));
        eN = Math.max(eN, Math.abs(newnet[d][j] - curnet[d][j] - dif[d][j]));
      }
      check(`NET SPEND == fixture (${seg} ${payer})`, eS < 1e-9, 'max err ' + eS.toExponential(2));
      check(`NET CURNET == gain - spend (${seg} ${payer})`, eC < 1e-9, 'max err ' + eC.toExponential(2));
      check(`NET NEWNET - CURNET == DIFF (${seg} ${payer})`, eN < 1e-9, 'max err ' + eN.toExponential(2));
    }
  }
  // blank-unless-ALL: spend is game-wide, single-source views must stay blank
  check('NET blank when Source != ALL', isBlankGrid(ECOGAINS_DAILY('NONPAYER', '0-9', 'Kite Festival', 'CURNET')));
  // per-key missing -> blank (fixture has no 10-19 rows)
  check('NET blank for segment missing from data_econ_daily', isBlankGrid(ECOGAINS_DAILY('NONPAYER', '10-19', 'ALL', 'CURNET')));
  if (stash !== undefined) data['data_econ_daily'] = stash; else delete data['data_econ_daily'];
  _sheetValsCache = {};
}

// ---- 6. RM split configs (2026-07-10 hardcode): SPTx2 only on RM_2nd instance days ----
{
  const v4Src = fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8');
  const dailySrc = fs.readFileSync(ENGINE('EcoGainsSim_Daily.gs'), 'utf8');
  const rm2 = JSON.parse(JSON.stringify(data['RM']));
  let hdrR = -1, x2C = -1;
  for (let r = 0; r < rm2.values.length; r++) {
    const row = rm2.values[r].map(x => String(x).trim());
    if (row.indexOf('Req Accum') >= 0 && row.indexOf('SPT x2') >= 0) { hdrR = r; x2C = row.indexOf('SPT x2'); break; }
  }
  for (let r = hdrR + 1; r < rm2.values.length; r++) {
    const first = rm2.values[r][0];
    if (first === '' || first == null || isNaN(parseFloat(first))) break;
    rm2.values[r][x2C] = 2;
  }
  data['RM_1st'] = JSON.parse(JSON.stringify(data['RM']));
  data['RM_2nd'] = rm2;
  eval(v4Src); eval(dailySrc); _sheetValsCache = {};
  const g = ECOGAINS_DAILY('NONPAYER', '0-9', 'Rainbow Maker', 'NEW');
  const iX2 = RESOURCES.indexOf('SPTx2');
  const insts = rmSortedInsts_(Context.get().calNew);
  const lastDays = new Set(insts.slice(3).flatMap(i => i.days));
  const x2Days = g.map((row, d) => row[iX2] > 1e-12 ? d + 1 : 0).filter(Boolean);
  check('RM split: daily SPTx2 only on instance #4-#5 days',
    x2Days.length > 0 && x2Days.every(d => lastDays.has(d)) && x2Days.length === lastDays.size,
    `days ${JSON.stringify(x2Days)} expect ${JSON.stringify([...lastDays].sort((a, b) => a - b))}`);
  const win = ECOGAINS_SIM('NONPAYER', '0-9')[CATEGORY_ORDER.indexOf('Rainbow Maker')];
  let maxE = 0;
  for (let j = 0; j < RESOURCES.length; j++) maxE = Math.max(maxE, Math.abs(colSum(g, j) - win[j]));
  check('RM split: daily sums == 33-day RM row (incl. SPTx2)', maxE < 1e-9, 'max err ' + maxE.toExponential(2));
  delete data['RM_1st']; delete data['RM_2nd'];
  eval(v4Src); eval(dailySrc); _sheetValsCache = {};
}

// ---- 7. eyeball: HC daily NEW totals, 0-9 NONPAYER ----
const allNew = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'NEW');
const allDif = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'DIFF');
const DOW = ['Wed','Thu','Fri','Sat','Sun','Mon','Tue'];
console.log('\nday | dow | NEW HC | DIFF HC   (0-9 NONPAYER, ALL sources)');
for (let d = 1; d <= 33; d++)
  console.log(String(d).padStart(3), DOW[(d-1)%7], allNew[d-1][HC].toFixed(2).padStart(8), allDif[d-1][HC].toFixed(2).padStart(8));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
