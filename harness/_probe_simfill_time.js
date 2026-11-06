// WHERE FILL ALL SIMS SPENDS ITS TIME (2026-11-06) - evidence, asserts nothing.
//
// Runs fillAllSims on a dump with the time budget lifted and prints: every sheet the run reads (rows x
// columns), the seconds per sim block, the seconds of the Sim per Segment step, and the total. Node is
// several times faster than Apps Script, so read the SHARES and the block count, not the seconds.
//
//   node harness/_probe_simfill_time.js [--data v3q] [--engine-dir <dir>] [--budget]
//     --engine-dir   another engine revision (e.g. `git archive <sha> engine | tar -x -C <tmp>`)
//     --budget       keep SIMFILL_BUDGET_MS as shipped (shows where the run would stop)
//     --drop a,b     delete these sheets from the dump first (e.g. album_gains,album_calibration: the
//                    state of a live workbook whose album tables are stale, so the Col rows run their
//                    own card seasons)
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3q');
const di = process.argv.indexOf('--engine-dir');
const engineDir = di >= 0 ? path.resolve(process.argv[di + 1]) : path.join(__dirname, '..', 'engine');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
let PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const ELINE = "const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);";
if (PRELUDE.indexOf(ELINE) < 0) throw new Error('_mock_cards.js ENGINE line moved - fix the probe');
PRELUDE = PRELUDE.replace(ELINE, 'const ENGINE = (f) => path.join(' + JSON.stringify(engineDir) + ', f);');
// the formula / properties mock of _mock_simfill.js, up to its first gate
const SF = fs.readFileSync(path.join(__dirname, '_mock_simfill.js'), 'utf8');
const a = SF.indexOf('function GATES() {'), b = SF.indexOf('  // ---------------------------------------------------------------- 0. namespace hygiene');
if (a < 0 || b < 0) throw new Error('_mock_simfill.js markers moved - fix the probe');
const SETUP = SF.slice(a + 'function GATES() {'.length, b);

function PROBE(){
  const keepBudget = process.argv.indexOf('--budget') >= 0;
  const dr = process.argv.indexOf('--drop');
  if (dr >= 0){ process.argv[dr + 1].split(',').forEach(n => { delete data[n.trim()]; }); resetSheetCache_mock(); }
  if (!keepBudget) SIMFILL_BUDGET_MS = 1e12;
  Logger.log = function(){};
  const now = () => Number(process.hrtime.bigint()) / 1e9;
  // every sheet the engine pulls whole
  const reads = {};
  const sv0 = sheetVals_;
  sheetVals_ = function(n){
    if (!(n in _sheetValsCache) && data[n]){
      const v = data[n].values; reads[n] = [v.length, v.reduce((m, r) => Math.max(m, (r || []).length), 0)];
    }
    return sv0(n);
  };
  // seconds per block
  const per = [];
  const fn0 = simFillFn_;
  simFillFn_ = function(name){
    const f = fn0(name);
    if (!f) return f;
    return function(){ const t = now(); const out = f.apply(null, arguments); per.push([name, Array.prototype.slice.call(arguments).join(' | '), now() - t]); return out; };
  };
  // Sheets calls per phase: in Apps Script each one is a round trip, which is where a fill that
  // computes in seconds spends its minutes
  let phase = 'sim blocks'; const calls = {};
  const COUNT = ['getValues', 'getFormulas', 'getFormula', 'getValue', 'setValues', 'setValue', 'setFormula', 'setFormulas', 'clearContent'];
  const countRange = (rng) => {
    const o = Object.create(null);
    Object.keys(rng).forEach(k => {
      o[k] = (COUNT.indexOf(k) < 0 || typeof rng[k] !== 'function') ? rng[k]
           : function(){ const c = (calls[phase] = calls[phase] || {}); c[k] = (c[k] || 0) + 1; return rng[k].apply(rng, arguments); };
    });
    return o;
  };
  const ss0 = SpreadsheetApp.getActiveSpreadsheet;
  const countSheet = (sh) => !sh ? sh : Object.assign(Object.create(null), sh, {
    getRange: function(){ return countRange(sh.getRange.apply(sh, arguments)); },
    getDataRange: function(){ return countRange(sh.getDataRange()); } });
  SpreadsheetApp.getActiveSpreadsheet = function(){
    const ss = ss0();
    return Object.assign({}, ss, { getSheetByName: (n) => countSheet(ss.getSheetByName(n)),
                                   getSheets: () => ss.getSheets().map(countSheet) });
  };
  let spsT = 0;
  if (typeof fillSimPerSegment === 'function'){
    const sps0 = fillSimPerSegment;
    fillSimPerSegment = function(){ const t = now(); phase = 'Sim per Segment'; try { return sps0(); } finally { spsT = now() - t; phase = 'after'; } };
  }
  console.log('engine: ' + ENGINE_BUILD + '  |  ' + (typeof CARDSIM_BUILD !== 'undefined' ? CARDSIM_BUILD : '') + '   dir: ' + ENGINE(''));
  const t0 = now();
  let n; try { n = fillAllSims(); } catch (e){ console.log('fillAllSims THREW: ' + (e && e.stack || e)); }
  const total = now() - t0;

  console.log('\nblocks filled: ' + n + '   total ' + total.toFixed(1) + 's   (Sim per Segment step ' + spsT.toFixed(1) + 's)');
  const by = {};
  per.forEach(p => { const k = p[0]; (by[k] = by[k] || { n: 0, t: 0, max: 0, arg: '' }); by[k].n++; by[k].t += p[2]; if (p[2] > by[k].max){ by[k].max = p[2]; by[k].arg = p[1]; } });
  console.log('\nper function            blocks   seconds   share   slowest block');
  Object.keys(by).sort((x, y) => by[y].t - by[x].t).forEach(k => {
    console.log(k.padEnd(24) + String(by[k].n).padStart(6) + by[k].t.toFixed(1).padStart(10) + (100 * by[k].t / total).toFixed(0).padStart(7) + '%   ' + by[k].max.toFixed(1) + 's  (' + by[k].arg.slice(0, 60) + ')');
  });
  console.log('\nSheets calls (each one a round trip in Apps Script)');
  Object.keys(calls).forEach(ph => { const c = calls[ph]; let t = 0; Object.keys(c).forEach(k => t += c[k]);
    console.log('  ' + ph.padEnd(18) + String(t).padStart(6) + '   ' + Object.keys(c).sort((x, y) => c[y] - c[x]).map(k => k + ' ' + c[k]).join(', ')); });
  console.log('\nthe ten slowest blocks');
  per.slice().sort((x, y) => y[2] - x[2]).slice(0, 10).forEach(p => console.log('  ' + p[2].toFixed(1).padStart(6) + 's  ' + p[0] + '(' + p[1].slice(0, 70) + ')'));
  console.log('\nsheets read whole by the engine (rows x cols = cells)');
  let cells = 0;
  Object.keys(reads).sort((x, y) => reads[y][0] * reads[y][1] - reads[x][0] * reads[x][1]).forEach((k, i) => {
    const c = reads[k][0] * reads[k][1]; cells += c;
    if (i < 12) console.log('  ' + k.padEnd(28) + String(reads[k][0]).padStart(7) + ' x ' + String(reads[k][1]).padStart(3) + ' = ' + c.toLocaleString().padStart(10));
  });
  console.log('  ' + Object.keys(reads).length + ' sheets, ' + cells.toLocaleString() + ' cells in all');
  const feed = (typeof EXPORT_SCALE_FEED !== 'undefined') ? EXPORT_SCALE_FEED : 'data_econ_daily_by_source';
  console.log('\n' + feed + ' read by this run: ' + (reads[feed] ? 'YES' : 'NO') +
              (data[feed] ? '   (the sheet holds ' + data[feed].values.length + ' rows)' : '   (not in this dump)'));
  if (alerts.length) console.log('\nthe pop-up:\n  ' + alerts[alerts.length - 1].split('\n').filter(x => x.trim()).map(x => x.slice(0, 220)).join('\n  '));
}
// the two companions the fill calls, evaluated in the scope simFillFn_ / fillAllSims look names up in
const MORE = "eval(fs.readFileSync(ENGINE('SimPerSegmentFill.gs'), 'utf8')); eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));";
eval(PRELUDE + '\n(function(){' + SETUP + '\n' + MORE + '\n(' + PROBE.toString() + ')();\n})();\n');
