// Every SIM / DIFF / 7-day / Daily cell an engine produces over one dump, written as JSON, so two
// engine versions can be compared cell for cell (the refactor check of memory note
// "verify refactors by output hash").
//
//   node harness/_probe_engine_identity.js --data v3d --out a.json [--engine-dir <dir>]
//   node harness/_probe_engine_identity.js --compare a.json b.json
//
// --engine-dir points at a folder holding EcoGainsSim_v4.gs / EcoGainsSim_Daily.gs /
// CardOpenings.gs / EcoGainsSim_7Day.gs (e.g. `git show <ref>:engine/<f>` exported to scratch), so
// the SAME dump runs through an older engine without touching the working tree.
const fs = require('fs');
const path = require('path');

const ci = process.argv.indexOf('--compare');
if (ci >= 0) {
  const a = JSON.parse(fs.readFileSync(process.argv[ci + 1], 'utf8'));
  const b = JSON.parse(fs.readFileSync(process.argv[ci + 2], 'utf8'));
  let n = 0, diff = 0, worst = 0, at = '';
  Object.keys(a).forEach(k => {
    const x = a[k], y = b[k];
    if (y === undefined) { diff++; if (!at) at = k + ' missing in second'; return; }
    n++;
    const dx = (typeof x === 'number' && typeof y === 'number') ? Math.abs(x - y) : (String(x) === String(y) ? 0 : Infinity);
    if (dx > 1e-9) { diff++; if (dx > worst) { worst = dx; at = k + ': ' + x + ' vs ' + y; } }
  });
  Object.keys(b).forEach(k => { if (a[k] === undefined) { diff++; if (!at) at = k + ' missing in first'; } });
  console.log(diff === 0 ? 'IDENTICAL: ' + n + ' cells' : 'DIFFERENT: ' + diff + ' of ' + n + ' cells, worst ' + worst + ' at ' + at);
  process.exit(diff ? 1 : 0);
}

const di = process.argv.indexOf('--engine-dir');
const engineDir = di >= 0 ? path.resolve(process.argv[di + 1]) : path.join(__dirname, '..', 'engine');
const oi = process.argv.indexOf('--out');
const outFile = oi >= 0 ? process.argv[oi + 1] : null;

const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
let PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
PRELUDE = PRELUDE.replace("const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);",
                          'const ENGINE = (f) => path.join(' + JSON.stringify(engineDir) + ', f);');
if (PRELUDE.indexOf(JSON.stringify(engineDir)) < 0) throw new Error('_mock_cards.js ENGINE line moved - fix the probe');

function PROBE() {
  eval(fs.readFileSync(ENGINE('EcoGainsSim_7Day.gs'), 'utf8'));
  const out = {};
  const put = (key, grid) => grid.forEach((row, i) => (Array.isArray(row) ? row : [row]).forEach((v, j) => {
    out[key + '|' + i + '|' + j] = (typeof v === 'number') ? Math.round(v * 1e9) / 1e9 : v; }));
  const segs = ['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'];
  ['NONPAYER', 'PAYER'].forEach(p => segs.forEach(s => {
    put('SIM|' + p + '|' + s, ECOGAINS_SIM(p, s));
    put('DIFF|' + p + '|' + s, ECOGAINS_DIFF(p, s));
    put('SIM7|' + p + '|' + s, ECOGAINS_SIM_7_DAY(p, s));
  }));
  [['NONPAYER', '0-9'], ['PAYER', '40-99'], ['PAYER', '100+']].forEach(([p, s]) =>
    ['NEW', 'CURRENT', 'DATA'].forEach(k => put('DAILY|' + p + '|' + s + '|' + k, ECOGAINS_DAILY(p, s, 'ALL', k))));
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out));
  console.log('cells: ' + Object.keys(out).length + (outFile ? ' -> ' + outFile : ''));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
