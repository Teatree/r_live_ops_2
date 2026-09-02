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
// D23 weekday/weekend split: with a weekday ladder present the per-day series must SEPARATE the
// two day types per resource, and must still sum to the 33-day row. Injected here (no workbook
// predating the split ships 'NS_v2_weekday'), so the gate holds on any dump.
{
  const NS_I = CATEGORY_ORDER.indexOf('Daily Night Sky Prize');
  const SEG = '40-99';
  const saved = data['NS_v2_weekday'] ? JSON.parse(JSON.stringify(data['NS_v2_weekday'])) : null;
  const cl = JSON.parse(JSON.stringify(data['NS_v2']));
  for (let r = 0; r < cl.values.length; r++) {            // zero the HC rewards on WEEKDAYS
    const hc = (cl.values[r] || []).indexOf('HC Reward');
    if (hc === -1) continue;
    for (let k = r + 1; k < cl.values.length && String((cl.values[k] || [])[0]).trim() !== ''; k++)
      cl.values[k][hc] = 0;
  }
  data['NS_v2_weekday'] = cl;
  _sheetValsCache = {};
  const g = ECOGAINS_DAILY('NONPAYER', SEG, 'Daily Night Sky Prize', 'NEW');
  const win = ECOGAINS_SIM('NONPAYER', SEG)[NS_I];
  const paid = g.map((row, d) => row[HC] > 1e-12 ? d + 1 : 0).filter(Boolean);
  const nsDays = [...new Set((Context.get().calNew['Night Sky'] || []).flatMap(i => i.days))];
  const wantWeekend = nsDays.filter(d => d >= 1 && d <= 33 && isWeekend_(d)).sort((a, b) => a - b);
  check('NS weekday HC zeroed -> HC lands on WEEKEND days only',
        JSON.stringify(paid) === JSON.stringify(wantWeekend),
        'got ' + JSON.stringify(paid) + ' expect ' + JSON.stringify(wantWeekend));
  let mx = 0;
  for (let j = 0; j < RESOURCES.length; j++) mx = Math.max(mx, Math.abs(colSum(g, j) - win[j]));
  check('NS split daily sums still reconcile with the 33-day NS row', mx < 1e-9,
        'max err ' + mx.toExponential(2));
  if (saved) data['NS_v2_weekday'] = saved; else delete data['NS_v2_weekday'];
  _sheetValsCache = {};
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
      // D19/8: the GAINS-ONLY columns are deliberately BLANK ('') in every NET block — the six
      // pack tiers have no spend model at all, and ToF_Ticket's spend is internal to the ToF run
      // sim (one per run, consumed immediately), so neither has a net position. Widened from
      // isPackRes_ to isGainsOnlyRes_ 2026-09-02: the old form asserted the ticket column carried a
      // NUMBER, so appending the resource reddened eight gates that were all describing the pack
      // rule correctly. The fixture feeds every resource precisely so this stays asserted.
      let eS = 0, eC = 0, eN = 0, packLeak = 0, packBlank = 0;
      for (let d = 0; d < 33; d++) for (let j = 0; j < RESOURCES.length; j++) {
        const gain = 10 + 0.1 * (d + 1) + j, sp = 8 + 0.05 * (d + 1);
        if (isGainsOnlyRes_(RESOURCES[j])) {
          packBlank++;
          if (spend[d][j] !== '' || curnet[d][j] !== '' || newnet[d][j] !== '') packLeak++;
          continue;
        }
        eS = Math.max(eS, Math.abs(spend[d][j] - sp));
        eC = Math.max(eC, Math.abs(curnet[d][j] - (gain - sp)));
        eN = Math.max(eN, Math.abs(newnet[d][j] - curnet[d][j] - dif[d][j]));
      }
      check(`NET SPEND == fixture (${seg} ${payer})`, eS < 1e-9, 'max err ' + eS.toExponential(2));
      check(`NET CURNET == gain - spend (${seg} ${payer})`, eC < 1e-9, 'max err ' + eC.toExponential(2));
      check(`NET NEWNET - CURNET == DIFF (${seg} ${payer})`, eN < 1e-9, 'max err ' + eN.toExponential(2));
      // 33 * however many gains-only resources there are - was a frozen `33 * 6`, which counted
      // the pack tiers and nothing else, so appending ToF_Ticket made the expected total wrong.
      const nGainsOnly = RESOURCES.filter(isGainsOnlyRes_).length;
      check(`NET gains-only columns blank, never 0 (${seg} ${payer})`,
        packLeak === 0 && packBlank === 33 * nGainsOnly,
        `${packLeak} numeric of ${packBlank} cells (${nGainsOnly} gains-only resources x 33 days)`);
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
// Snapshot-and-restore, base-sheet agnostic: workbook (13) DELETED the base 'RM' sheet and ships
// real RM_1st / RM_2nd ladders, so this gate must not assume any particular sheet exists. It
// clones whichever ladder it can find, forces SPTx2 to 0 on the 1st-half config and 2 on the
// 2nd-half one, asserts the placement, then puts the originals back untouched.
{
  const v4Src = fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8');
  const dailySrc = fs.readFileSync(ENGINE('EcoGainsSim_Daily.gs'), 'utf8');
  const baseName = data['RM_1st'] ? 'RM_1st' : (data['RM_2nd'] ? 'RM_2nd' : (data['RM'] ? 'RM' : null));
  if (!baseName) {
    console.log('SKIP RM split gates — no RM / RM_1st / RM_2nd sheet in the dump');
  } else {
    const stash1 = data['RM_1st'], stash2 = data['RM_2nd'];
    const setX2 = (sheet, val) => {
      let hdrR = -1, x2C = -1;
      for (let r = 0; r < sheet.values.length; r++) {
        const row = sheet.values[r].map(x => String(x).trim());
        if (row.indexOf('Req Accum') >= 0 && row.indexOf('SPT x2') >= 0) { hdrR = r; x2C = row.indexOf('SPT x2'); break; }
      }
      if (hdrR < 0) return false;
      for (let r = hdrR + 1; r < sheet.values.length; r++) {
        const first = sheet.values[r][0];
        if (first === '' || first == null || isNaN(parseFloat(first))) break;
        sheet.values[r][x2C] = val;
      }
      return true;
    };
    const clone = (n) => JSON.parse(JSON.stringify(data[n] || data[baseName]));
    const first = clone('RM_1st'), second = clone('RM_2nd');
    const ok = setX2(first, 0) && setX2(second, 2);
    data['RM_1st'] = first; data['RM_2nd'] = second;
    eval(v4Src); eval(dailySrc); _sheetValsCache = {};
    const g = ECOGAINS_DAILY('NONPAYER', '0-9', 'Rainbow Maker', 'NEW');
    const iX2 = RESOURCES.indexOf('SPTx2');
    const insts = rmSortedInsts_(Context.get().calNew);
    const lastDays = new Set(insts.slice(3).flatMap(i => i.days));
    const x2Days = g.map((row, d) => row[iX2] > 1e-12 ? d + 1 : 0).filter(Boolean);
    check('RM split: daily SPTx2 only on instance #4-#5 days',
      ok && x2Days.length > 0 && x2Days.every(d => lastDays.has(d)) && x2Days.length === lastDays.size,
      `days ${JSON.stringify(x2Days)} expect ${JSON.stringify([...lastDays].sort((a, b) => a - b))}`);
    const win = ECOGAINS_SIM('NONPAYER', '0-9')[CATEGORY_ORDER.indexOf('Rainbow Maker')];
    let maxE = 0;
    for (let j = 0; j < RESOURCES.length; j++) maxE = Math.max(maxE, Math.abs(colSum(g, j) - win[j]));
    check('RM split: daily sums == 33-day RM row (incl. SPTx2)', maxE < 1e-9, 'max err ' + maxE.toExponential(2));
    if (stash1 !== undefined) data['RM_1st'] = stash1; else delete data['RM_1st'];
    if (stash2 !== undefined) data['RM_2nd'] = stash2; else delete data['RM_2nd'];
    eval(v4Src); eval(dailySrc); _sheetValsCache = {};
  }
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
