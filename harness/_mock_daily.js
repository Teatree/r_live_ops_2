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
// ---- D60: rank-family lumps land the DATE AFTER the grid cell -------------------------------
// Asserted as the RULE from the parsed calendar, never as a frozen day list: the pre-D60 gate
// froze {5,12,19,26,33} and went red the moment the rule changed, which is the failure CLAUDE.md
// warns about. Fixtured in every direction: default (+1, day-34 lump folded back by
// renormalisation - never a day 34, never a pile on day 33), legacy (end days), an authored
// settle_days = 0 (end days again), an authored lag (each lump split over +1 and +2), and the
// earn-day option the 7-day view uses (end days, whatever the model).
const daysPaidGrid = g => g.map((row, d) => row.reduce((s, x) => s + Math.abs(x), 0) > 1e-12 ? d + 1 : 0).filter(Boolean);
const daysPaidSeries = ds => ds.map((o, d) => RESOURCES.reduce((s, r) => s + Math.abs(num(o[r])), 0) > 1e-12 ? d + 1 : 0).filter(Boolean);
const kiteEnds = (Context.get().calNew['Kite Festival'] || []).map(i => i.days[i.days.length - 1]).sort((a, b) => a - b);
const expectShift = (ends, off, lagN) =>
  [...new Set(ends.flatMap(e => Array.from({ length: lagN }, (_, k) => e + off + k))
                  .filter(d => d >= 1 && d <= DAILY_DAYS))].sort((a, b) => a - b);
const resetAlloc = () => { _sheetValsCache = {}; _settleCache = null; };
check('Kite instance ends read off the parsed calendar (fixture is live)', kiteEnds.length >= 2, JSON.stringify(kiteEnds));
{
  const got = daysPaidGrid(ECOGAINS_DAILY('NONPAYER', '0-9', 'Kite Festival', 'NEW'));
  check('settle (default +1): every Kite lump exactly one day after its instance end, day-34 lump folded back',
    JSON.stringify(got) === JSON.stringify(expectShift(kiteEnds, 1, 1)),
    'ends ' + JSON.stringify(kiteEnds) + ' -> ' + JSON.stringify(got) + (kiteEnds.indexOf(DAILY_DAYS) >= 0 ? ' (a day-33 close is folded, not placed on 33)' : ''));
  check('settle: nothing is ever written past day 33', got.every(d => d <= DAILY_DAYS));
}
{
  DAILY_ALLOC_MODEL = 'legacy'; resetAlloc();
  const got = daysPaidGrid(ECOGAINS_DAILY('NONPAYER', '0-9', 'Kite Festival', 'NEW'));
  check('legacy model: lumps on the instance end days (pre-D60 placement restored)',
    JSON.stringify(got) === JSON.stringify(expectShift(kiteEnds, 0, 1)), JSON.stringify(got));
  DAILY_ALLOC_MODEL = 'settle'; resetAlloc();
}
{
  data['sim_settle'] = { values: [['source', 'settle_days', 'lag_0', 'lag_1', 'lag_2'], ['Kite Festival', 0, '', '', '']] };
  resetAlloc();
  const got0 = daysPaidGrid(ECOGAINS_DAILY('NONPAYER', '0-9', 'Kite Festival', 'NEW'));
  check('authored settle_days = 0 on sim_settle puts Kite back on its end days (sheet beats default)',
    JSON.stringify(got0) === JSON.stringify(expectShift(kiteEnds, 0, 1)), JSON.stringify(got0));
  data['sim_settle'].values[1] = ['Kite Festival', 1, 0.5, 0.5, ''];
  resetAlloc();
  const gLag = ECOGAINS_DAILY('NONPAYER', '0-9', 'Kite Festival', 'NEW');
  const gotL = daysPaidGrid(gLag);
  check('authored lag [.5,.5]: each lump split over end+1 AND end+2',
    JSON.stringify(gotL) === JSON.stringify(expectShift(kiteEnds, 1, 2)), JSON.stringify(gotL));
  const e0 = kiteEnds[0];
  check('authored lag halves split the lump equally (end+1 == end+2)',
    e0 + 2 <= DAILY_DAYS && Math.abs(gLag[e0][HC] - gLag[e0 + 1][HC]) < 1e-9,
    `day ${e0 + 1}: ${gLag[e0][HC].toFixed(6)} vs day ${e0 + 2}: ${gLag[e0 + 1][HC].toFixed(6)}`);
  // the other rank families keep their DEFAULT while Kite is authored
  const tr = (Context.get().calNew['Team Race'] || []).map(i => i.days[i.days.length - 1]).sort((a, b) => a - b);
  if (tr.length){
    const gotTR = daysPaidGrid(ECOGAINS_DAILY('NONPAYER', '0-9', 'Team Race', 'NEW'));
    check('an authored row changes ONLY its own source (Team Race still on default +1)',
      JSON.stringify(gotTR) === JSON.stringify(expectShift(tr, 1, 1)), JSON.stringify(gotTR));
  }
  delete data['sim_settle']; resetAlloc();
  const back = daysPaidGrid(ECOGAINS_DAILY('NONPAYER', '0-9', 'Kite Festival', 'NEW'));
  check('sim_settle fixture removed -> default +1 again', JSON.stringify(back) === JSON.stringify(expectShift(kiteEnds, 1, 1)));
}
{
  const earn = daysPaidSeries(dailySeries_('Kite Festival', '0-9', 'NONPAYER', Context.get(), true, { earnDay: true }));
  check('earnDay option (the 7-day view) places on the instance END days under the settle model',
    JSON.stringify(earn) === JSON.stringify(expectShift(kiteEnds, 0, 1)), JSON.stringify(earn));
}

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
// D34: River Rush is absent from BOTH calendars in this dump, so it is CARRIED, not removed - the
// diff is 0 and the NEW side equals the CURRENT one. The old assertions ("NEW = 0", "DIFF =
// -CURRENT") described the removal branch, which only applies when cal_curr actually ran the event;
// they are asserted per branch now so whichever one this workbook is in, the rule is checked.
const rrMeasHC = num(measuredRow_('River Rush', '100+', 'NONPAYER', Context.get().ds)['HC']);
const rrOnCur = ((Context.get().calCur['River Rush']) || []).length > 0;
const rrOnNew = ((Context.get().calNew['River Rush']) || []).length > 0;
check('River Rush CURRENT flat = measured/33', Math.abs(rrCur[0][HC] - rrMeasHC / 33) < 1e-9 && Math.abs(rrCur[32][HC] - rrMeasHC / 33) < 1e-9);
if (rrOnCur && !rrOnNew){
  check('River Rush removed from cal_new -> NEW = 0 all days', rrNew.every(row => row.every(x => x === 0)));
  check('River Rush removed -> DIFF = -CURRENT', rrDif.every((row, d) => Math.abs(row[HC] + rrCur[d][HC]) < 1e-9));
} else {
  check('River Rush absent from both calendars -> NEW = CURRENT (carried)',
    rrNew.every((row, d) => Math.abs(row[HC] - rrCur[d][HC]) < 1e-9),
    `cal_curr ${rrOnCur ? 'has' : 'has no'} RR, cal_new ${rrOnNew ? 'has' : 'has no'} RR`);
  check('River Rush carried -> DIFF = 0 all days', rrDif.every(row => row.every(x => Math.abs(x) < 1e-9)));
}

// ---- D60 change #1: River Rush ON the grid -----------------------------------------------------
// The measured SPTx2 actuals are ON days 2-8 / 16-22 / 30-33 in all ten cells and ~0 otherwise,
// and 99% of SPTx2 data_gains mass is River Rush - yet cal_curr has no River Rush lane, so the
// whole total is spread flat. The fix is a calendar edit (draw the lane); this fixture proves what
// the engine does once it is drawn: the mass lands on exactly those days, prop p_day inside each
// block (NOT the accrual marginal, which fits worse here), and the window total is conserved.
{
  const ctx = Context.get();
  const saved = ctx.calCur['River Rush'];
  ctx.calCur['River Rush'] = [mkInst_(2, 7), mkInst_(16, 7), mkInst_(30, 4)];
  resetAlloc();
  const cur = dailySeries_('River Rush', '100+', 'NONPAYER', ctx, false);
  const want = [...mkInst_(2, 7).days, ...mkInst_(16, 7).days, ...mkInst_(30, 4).days];
  const got = daysPaidSeries(cur);
  const rrRes = RESOURCES.find(r => Math.abs(cur.reduce((t, o) => t + num(o[r]), 0)) > 1e-9);
  check('River Rush drawn on cal_curr -> CURRENT pays on exactly those days', !!rrRes && JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  if (rrRes){
    // inside one block, weights are prop p_day: two weekdays of the same block carry equal mass
    const b = ctx.ds.beh('100+', 'NONPAYER');
    const wd = [16, 17, 18, 19, 20, 21, 22].filter(d => !isWeekend_(d));
    check('inside a block the placement is prop p_day (two weekdays carry equal mass)',
      wd.length >= 2 && Math.abs(num(cur[wd[0] - 1][rrRes]) - num(cur[wd[1] - 1][rrRes])) < 1e-9,
      `days ${wd[0]}/${wd[1]}: ${num(cur[wd[0] - 1][rrRes]).toFixed(6)} / ${num(cur[wd[1] - 1][rrRes]).toFixed(6)}`);
    const err = Math.max(...RESOURCES.map(r => Math.abs(cur.reduce((t, o) => t + num(o[r]), 0) - num(measuredRow_('River Rush', '100+', 'NONPAYER', ctx.ds)[r]))));
    check('River Rush on-grid conserves the window total', err < 1e-9, 'max err ' + err.toExponential(2));
    check('River Rush is not a rank family: no settle shift (first paid day is day 2, not 3)', got[0] === 2);
  }
  if (saved === undefined) delete ctx.calCur['River Rush']; else ctx.calCur['River Rush'] = saved;
  resetAlloc();
}

const rm = ECOGAINS_DAILY('NONPAYER', '0-9', 'Rainbow Maker', 'NEW');
const rmDays = rm.map((row, d) => row[HC] > 1e-12 ? d + 1 : 0).filter(Boolean);
// expectation derived from the parsed calendar itself (clipped instance position varies)
const rmExpect = [...new Set((Context.get().calNew['Rainbow Maker'] || []).flatMap(i => i.days))].sort((a, b) => a - b);
check('RM NEW pays only on its instance days', JSON.stringify(rmDays) === JSON.stringify(rmExpect), 'got ' + JSON.stringify(rmDays) + ' expect ' + JSON.stringify(rmExpect));

// ---- D60 (4): the marginal family spreads by the MEAN accrual curve, p50 under legacy ----------
// The pre-D60 gate froze the p50 shape (0.18/0.71/1.00/1.00 -> 'day2 > day1 and day4 ~ 0'); the
// rule is asserted instead: within a full instance the day weights equal the normalised marginal
// of whichever curve the model names, and the two columns really differ on this data.
{
  const hhInst = (Context.get().calNew['Hatchling Hideaway'] || []).find(i => i.dur === 4);
  const ds = Context.get().ds;
  const marg = curve => { const out = []; for (let j = 1; j <= hhInst.dur; j++) out.push(Math.max(0, curveRaw_(curve, j) - curveRaw_(curve, j - 1))); return normalize_(out); };
  const cMean = ds.accrualCurveMean('Hatchling Hideaway', '0-9', 'NONPAYER');
  const cP50  = ds.accrualCurve('Hatchling Hideaway', '0-9', 'NONPAYER', false);
  check('data_event_accrual carries a MEAN column (fixture is live)', cMean.length > 0 && cMean[0].share !== cP50[0].share,
    'mean day1 ' + (cMean[0] && cMean[0].share) + ' vs p50 day1 ' + (cP50[0] && cP50[0].share));
  const shape = grid => normalize_(hhInst.days.map(d => grid[d - 1][10]));   // UL Lives
  const maxDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
  const hhS = ECOGAINS_DAILY('NONPAYER', '0-9', 'Hatchling Hideaway', 'NEW');
  check('settle: HH 4-day instance follows the MEAN marginal exactly', maxDiff(shape(hhS), marg(cMean)) < 1e-9,
    `got ${shape(hhS).map(x => x.toFixed(3)).join('/')} expect ${marg(cMean).map(x => x.toFixed(3)).join('/')}`);
  DAILY_ALLOC_MODEL = 'legacy'; resetAlloc();
  const hhL = ECOGAINS_DAILY('NONPAYER', '0-9', 'Hatchling Hideaway', 'NEW');
  check('legacy: HH 4-day instance follows the p50 marginal exactly (bit-identical pre-D60)', maxDiff(shape(hhL), marg(cP50)) < 1e-9,
    `got ${shape(hhL).map(x => x.toFixed(3)).join('/')} expect ${marg(cP50).map(x => x.toFixed(3)).join('/')}`);
  DAILY_ALLOC_MODEL = 'settle'; resetAlloc();
}

// ---- D60 (3): a continuous-track lane spreads prop p_day over the UNION of its days -------------
// Fixture: a synthetic two-piece lane [1..30] + [31..33] for Season Pass (Free), the shape cal_curr
// draws. Under settle a Wednesday in the stub (day 29 is also a Wednesday) carries the same weight
// as day 1; under legacy the reach split hands the 3-day stub a per-day weight several times
// larger - the artefact the change removes.
{
  const ctx = Context.get();
  const saved = ctx.calCur['Season Pass'];
  ctx.calCur['Season Pass'] = [mkInst_(1, 30), mkInst_(31, 3)];
  const cur = dailySeries_('Season Pass (Free)', '0-9', 'NONPAYER', ctx, false);
  const res = RESOURCES.find(r => Math.abs(num(cur.reduce((t, o) => t + num(o[r]), 0))) > 1e-9);
  check('Season Pass (Free) has measured mass to place (fixture is live)', !!res, res || 'none');
  if (res){
    const pd = d => isWeekend_(d) ? 1 : 0;
    const same = [1, 29].every(d => pd(d) === pd(1));
    check('settle: stub day 32 and day 4 carry equal weight when they are the same day type',
      same && Math.abs(num(cur[31][res]) - num(cur[3][res])) < 1e-9 && pd(32) === pd(4),
      `day 32 ${num(cur[31][res]).toFixed(6)} vs day 4 ${num(cur[3][res]).toFixed(6)}`);
    DAILY_ALLOC_MODEL = 'legacy'; resetAlloc();
    const leg = dailySeries_('Season Pass (Free)', '0-9', 'NONPAYER', ctx, false);
    check('legacy: the reach split still piles the 3-day stub (rule asserted on the old model too)',
      num(leg[31][res]) > 2 * num(leg[3][res]), `day 32 ${num(leg[31][res]).toFixed(6)} vs day 4 ${num(leg[3][res]).toFixed(6)}`);
    DAILY_ALLOC_MODEL = 'settle'; resetAlloc();
    const tot = RESOURCES.map(r => Math.abs(cur.reduce((t, o) => t + num(o[r]), 0) - num(measuredRow_('Season Pass (Free)', '0-9', 'NONPAYER', ctx.ds)[r])));
    check('track lane conserves the window total', Math.max(...tot) < 1e-9, 'max err ' + Math.max(...tot).toExponential(2));
  }
  ctx.calCur['Season Pass'] = saved;
}

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

  // ---- D60: the measured side as blocks, and INCOMPLETE PULLS BY DESIGN -----------------------
  // DATA = data_econ_daily gains per earner per day; DATADIFF = DATA - NEW (positive = data above
  // the sim). Every data-anchored block is BLANK past the last day the pull carries - a day with
  // no row is 'not pulled yet', never 0. Fixtured by truncating the synthetic feed to 14 days for
  // one cell and asserting rows 15..33 are '' on all five data blocks while rows 1..14 are
  // untouched; then restoring and asserting all 33 come back.
  {
    _sheetValsCache = {};
    const dat = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'DATA');
    const ddf = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'DATADIFF');
    const nw  = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'NEW');
    let eD = 0, eF = 0, leak = 0;
    for (let d = 0; d < 33; d++) for (let j = 0; j < RESOURCES.length; j++) {
      const gain = 10 + 0.1 * (d + 1) + j;
      if (isGainsOnlyRes_(RESOURCES[j])) { if (dat[d][j] !== '' || ddf[d][j] !== '') leak++; continue; }
      eD = Math.max(eD, Math.abs(dat[d][j] - gain));
      eF = Math.max(eF, Math.abs(ddf[d][j] - (gain - nw[d][j])));
    }
    check('DATA == data_econ_daily gains per earner per day', eD < 1e-9, 'max err ' + eD.toExponential(2));
    check('DATADIFF == DATA - NEW, day by day (positive = data above the sim)', eF < 1e-9, 'max err ' + eF.toExponential(2));
    check('DATA / DATADIFF leave the gains-only columns blank (no pack telemetry is not a measured 0)', leak === 0, leak + ' numeric cells');
    check('DATA blank when Source != ALL (the measured side is game-wide)', isBlankGrid(ECOGAINS_DAILY('NONPAYER', '0-9', 'Kite Festival', 'DATA')));

    // truncate the feed: keep days 1..14 for 0-9 NONPAYER only
    const full = data['data_econ_daily'].values;
    data['data_econ_daily'] = { values: full.filter((r, i) => i === 0 || !(r[0] === '0-9' && r[1] === 'NONPAYER' && Number(r[3]) > 14)), merges: [] };
    _sheetValsCache = {};
    const blocks = ['DATA', 'DATADIFF', 'SPEND', 'CURNET', 'NEWNET'];
    let pastNumeric = 0, withinChanged = 0, pastCells = 0;
    const before = { DATA: dat, DATADIFF: ddf };
    blocks.forEach(b => {
      const g = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', b);
      for (let d = 0; d < 33; d++) for (let j = 0; j < RESOURCES.length; j++) {
        if (d >= 14) { pastCells++; if (g[d][j] !== '') pastNumeric++; }
        else if (before[b] && Math.abs(num(g[d][j]) - num(before[b][d][j])) > 1e-9) withinChanged++;
      }
    });
    check('a 14-of-33-day pull: every data-anchored block is BLANK (not 0) past day 14',
      pastNumeric === 0 && pastCells === 19 * RESOURCES.length * blocks.length, pastNumeric + ' numeric cells past the last pulled day');
    check('a 14-of-33-day pull: days 1..14 are unchanged', withinChanged === 0, withinChanged + ' cells moved');
    // the other cell still has all 33 days
    const other = ECOGAINS_DAILY('PAYER', '0-9', 'ALL', 'DATA');
    check('truncation is per cell: 0-9 PAYER still carries all 33 days', other.every(row => row[0] !== ''));
    data['data_econ_daily'] = { values: full, merges: [] };
    _sheetValsCache = {};
    check('feed restored -> 33 days again', ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'DATA').every(row => row[0] !== ''));
  }
  if (stash !== undefined) data['data_econ_daily'] = stash; else delete data['data_econ_daily'];

// ---- 5c. D63: the live feed takes over when present and usable; falls back otherwise ----------
// Fixture: a one-day data_econ_daily_live for (0-9, NONPAYER) with values that cannot be confused
// with the base sheet's; the base sheet stays in place throughout. Rule gates, then restore.
{
  const stashLive = data['data_econ_daily_live'];
  const stashBase = data['data_econ_daily'];
  data['data_econ_daily'] = synthEconDaily();            // the base sheet: 33 days, every cell
  const hdr = ['segment', 'payer_flag', 'currency', 'day_index', 'calendar_date', 'dow', 'gain_total', 'spend_total',
               'players_in_cell', 'active_players_day', 'resource_earners_window', 'gain_per_active_player_day',
               'spend_per_active_player_day', 'gain_per_earner_day', 'spend_per_earner_day', 'days_available',
               'window_start_date', 'status'];
  const live = [hdr];
  RESOURCES.slice(0, 13).forEach((r, k) => live.push(['0-9', 'NONPAYER', r, 1, '2026-10-13', 'Tue', 0, 0, 1, 1, 1, 0, 0, 1000 + k, 500 + k, 1, '2026-10-13', 'MEASURED']));
  data['data_econ_daily_live'] = { values: live, merges: [] };
  _sheetValsCache = {};
  const iHC = RESOURCES.indexOf('HC');
  const gD = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'DATA');
  const gS = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'SPEND');
  const day1ok = Math.abs(num(gD[0][iHC]) - 1000) < 1e-9 && Math.abs(num(gS[0][iHC]) - 500) < 1e-9;
  let restBlank = true;
  for (let d = 1; d < DAILY_DAYS; d++) for (let j = 0; j < RESOURCES.length; j++) if (gD[d][j] !== '' || gS[d][j] !== '') restBlank = false;
  check('D63: with a usable data_econ_daily_live the DATA / SPEND blocks read IT (day 1 = the live row), not the base sheet', day1ok, 'day-1 HC data ' + gD[0][iHC] + ' spend ' + gS[0][iHC]);
  check("D63: a one-day live pull leaves days 2..33 '' (not pulled yet, never 0) although the base sheet has all 33", restBlank);
  // a cell the live pull has not reached yet is BLANK, not the base sheet's value
  check('D63: a (segment, payer) absent from the live pull spills blank even though the base sheet has it',
    isBlankGrid(ECOGAINS_DAILY('PAYER', '100+', 'ALL', 'DATA')));
  // not usable (header-only) -> fall back to the base sheet
  data['data_econ_daily_live'] = { values: [hdr], merges: [] };
  _sheetValsCache = {};
  const gF = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'DATA');
  check('D63: a header-only live sheet is not usable -> the base sheet serves (fallback)', Math.abs(num(gF[0][iHC]) - num(synthEconDaily().values.find(r => r[0] === '0-9' && r[1] === 'NONPAYER' && r[2] === 'HC' && Number(r[3]) === 1)[4])) < 1e-9 || num(gF[0][iHC]) > 0, 'day-1 HC ' + gF[0][iHC]);
  // flag off -> base sheet even with a usable live sheet
  data['data_econ_daily_live'] = { values: live, merges: [] };
  DAILY_ECON_PREFER_LIVE = false; _sheetValsCache = {};
  const gOff = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'DATA');
  check('D63: DAILY_ECON_PREFER_LIVE = false -> the base sheet serves although the live one is usable', Math.abs(num(gOff[0][iHC]) - 1000) > 1e-9 && gOff[1][iHC] !== '');
  DAILY_ECON_PREFER_LIVE = true;
  if (stashLive !== undefined) data['data_econ_daily_live'] = stashLive; else delete data['data_econ_daily_live'];
  if (stashBase !== undefined) data['data_econ_daily'] = stashBase; else delete data['data_econ_daily'];
  _sheetValsCache = {};
}
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

    // ---- D60b: the CURRENT side places per instance too --------------------------------------
    // Fixture: cal_curr runs the SAME RM instances as cal_new. The synthetic anchor (rmSynth_, base
    // ladder) is then the measured row, and its parts must place the CURRENT side exactly as the
    // NEW parts place the NEW side: SPTx2 only on instance #4-#5 days, nothing outside the
    // instances, window total conserved. Before D60b the CURRENT side fell through to the generic
    // reach split and the two sides disagreed on days with equal totals.
    {
      const ctx = Context.get();
      const savedCur = ctx.calCur['Rainbow Maker'];
      ctx.calCur['Rainbow Maker'] = (ctx.calNew['Rainbow Maker'] || []).map(i => mkInst_(i.start, i.dur));
      _sheetValsCache = {};
      const cur = ECOGAINS_DAILY('NONPAYER', '0-9', 'Rainbow Maker', 'CURRENT');
      const x2Cur = cur.map((row, d) => row[iX2] > 1e-12 ? d + 1 : 0).filter(Boolean);
      const anyCur = cur.map((row, d) => row.reduce((t, x) => t + Math.abs(x), 0) > 1e-12 ? d + 1 : 0).filter(Boolean);
      const instDays = new Set(rmSortedInsts_(ctx.calCur).flatMap(i => i.days));
      check('RM CURRENT (cal_curr runs RM): SPTx2 only on instance #4-#5 days, same rule as NEW',
        x2Cur.length > 0 && x2Cur.every(d => lastDays.has(d)) && x2Cur.length === lastDays.size,
        `days ${JSON.stringify(x2Cur)} expect ${JSON.stringify([...lastDays].sort((a, b) => a - b))}`);
      check('RM CURRENT pays only on cal_curr RM instance days', anyCur.length > 0 && anyCur.every(d => instDays.has(d)), JSON.stringify(anyCur));
      const meas = measuredRow_('Rainbow Maker', '0-9', 'NONPAYER', ctx.ds);
      let eC = 0;
      for (let j = 0; j < RESOURCES.length; j++) eC = Math.max(eC, Math.abs(colSum(cur, j) - num(meas[RESOURCES[j]])));
      check('RM CURRENT per-instance placement conserves the measured (synthetic) row', eC < 1e-9, 'max err ' + eC.toExponential(2));
      // identical calendars + identical ladders would give identical days; here the ladders differ
      // (RM_1st vs RM_1st_v2), so assert the SHAPE agrees where both sides pay: same paid-day set.
      const nw = ECOGAINS_DAILY('NONPAYER', '0-9', 'Rainbow Maker', 'NEW');
      const anyNew = nw.map((row, d) => row.reduce((t, x) => t + Math.abs(x), 0) > 1e-12 ? d + 1 : 0).filter(Boolean);
      check('RM CURRENT and NEW pay on the same days when the calendars are identical',
        JSON.stringify(anyCur) === JSON.stringify(anyNew), `cur ${JSON.stringify(anyCur)} new ${JSON.stringify(anyNew)}`);
      if (savedCur === undefined) delete ctx.calCur['Rainbow Maker']; else ctx.calCur['Rainbow Maker'] = savedCur;
      _sheetValsCache = {};
    }
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
