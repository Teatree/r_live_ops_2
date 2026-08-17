// Which engine version produced the numbers currently sitting in the workbook's display sheets?
//
// The saga readers went header-driven on 2026-08-13 (wb15/wb16 rebuilt c_saga in the triple
// `Levels Req | RewardChestId | HC Reward` layout; the old fixed-column read priced chest IDs as
// coins, inflating Saga HC ~7x). Until EcoGainsSim_v4.gs is re-pasted into the Apps Script
// project, `Sim per Segment` / `EcoGainsSim` keep showing the INFLATED numbers, so a reader
// comparing the workbook against reports/ sees two different simulations.
//
// This script runs the SAME mockdata through two engine revisions and dumps their 33-day totals
// so the report can say which one the workbook's cached fill matches (analysis/_build_comparison.py
// does the attribution; the report renders the warning).
//
// Usage: node harness/_dump_engine_versions.js [--ref <git-rev>]   (default ref: HEAD)
//        node harness/_dump_engine_versions.js --engine <path>     (internal: one version -> stdout)
//
// Emits analysis/out/engine_versions.json: per version, per payer x segment, per-resource 33-day
// totals over all categories + the Saga row's sim/meas (the bug's signature).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };

// ---------------------------------------------------------------- child mode: one engine -> stdout
const engineArg = argOf('--engine');
if (engineArg) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_mockdata.json'), 'utf8'));
  delete data['cal_parsed'];                       // stale export; parse the visual grids
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

  eval(fs.readFileSync(engineArg, 'utf8'));
  _sheetValsCache = {};

  const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+'];
  const out = { totals: {}, saga: {} };
  for (const payer of ['NONPAYER', 'PAYER']) {
    for (const seg of SEGS) {
      const SIM = ECOGAINS_SIM(payer, seg);
      const DIFF = ECOGAINS_DIFF(payer, seg);
      const key = payer + '|' + seg;
      out.totals[key] = {};
      for (let ri = 0; ri < RESOURCES.length; ri++) {
        let s = 0, m = 0;
        for (let ci = 0; ci < CATEGORY_ORDER.length; ci++) {
          const sv = +SIM[ci][ri] || 0, dv = +DIFF[ci][ri] || 0;
          s += sv; m += sv - dv;
        }
        out.totals[key][RESOURCES[ri]] = { meas_33: m, sim_33: s };
      }
      const si = CATEGORY_ORDER.indexOf('Saga'), hi = RESOURCES.indexOf('HC');
      const ss = +SIM[si][hi] || 0, sd = +DIFF[si][hi] || 0;
      out.saga[key] = { meas_33: ss - sd, sim_33: ss, R: (ss - sd) ? ss / (ss - sd) : null };
    }
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------- parent mode: two versions
const ref = argOf('--ref') || 'HEAD';
const refSha = execFileSync('git', ['rev-parse', '--short', ref], { cwd: ROOT }).toString().trim();
const refSrc = execFileSync('git', ['show', `${ref}:engine/EcoGainsSim_v4.gs`],
                            { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }).toString();
const refPath = path.join(os.tmpdir(), `EcoGainsSim_v4_ref_${refSha}.gs`);
fs.writeFileSync(refPath, refSrc);
const curPath = path.join(ROOT, 'engine', 'EcoGainsSim_v4.gs');
const curSrc = fs.readFileSync(curPath, 'utf8');

const run = (p) => JSON.parse(execFileSync(process.execPath, [__filename, '--engine', p],
                                           { maxBuffer: 64 * 1024 * 1024 }).toString());
const versions = {
  reference: { label: `git ${ref} (${refSha})`, rev: refSha, ...run(refPath) },
  current: { label: 'engine/EcoGainsSim_v4.gs (working copy)', rev: 'working', ...run(curPath) },
};
versions.reference_equals_current = refSrc === curSrc;

const outDir = path.join(ROOT, 'analysis', 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'engine_versions.json'),
                 JSON.stringify({ generated: new Date().toISOString(), versions }, null, 1));

console.log(`written analysis/out/engine_versions.json — reference ${versions.reference.label}` +
            (versions.reference_equals_current ? ' (IDENTICAL to working copy)' : ''));
for (const k of ['reference', 'current']) {
  const v = versions[k];
  const seg = 'NONPAYER|10-19';
  console.log(`  ${k.padEnd(9)} HC 33d ${seg}: meas ${v.totals[seg].HC.meas_33.toFixed(1)} ` +
              `sim ${v.totals[seg].HC.sim_33.toFixed(1)} | Saga R ` +
              (v.saga[seg].R === null ? 'n/a' : v.saga[seg].R.toFixed(3)));
}
