// engine/ vs engine/pre_collection/ — are the two copies still the same model?
// ---------------------------------------------------------------------------------------------
// CLAUDE.md states the two are kept in sync for everything EXCEPT the pack features, and records a
// hand verification from 2026-08-17. Nothing re-checked it: engine/EcoGainsSim_v4.gs has been
// edited many times since, and a divergence is silent — both copies keep running, they just stop
// agreeing, and which one is right depends on which workbook you pasted into. (That is exactly how
// the DAILY_LASTDAY divergence found on 2026-08-17 happened.)
//
// This runs BOTH copies over the same _mockdata.json in separate child processes (they share a
// global namespace, so they cannot be eval'd into one) and compares every cell of the 13 non-pack
// resources across all 25 categories x 6 segments x 2 payer flags, on both the sim and diff sides.
//
//   node harness/_check_engine_sync.js
//   node harness/_check_engine_sync.js --json harness/_mockdata_wb14.json
//
// Exits 1 on any non-pack divergence. Pack columns and pack-only sources are EXPECTED to differ —
// they are the documented reason the second copy exists — so they are excluded by name, not by
// tolerance.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argJson = (() => {
  const i = process.argv.indexOf('--json');
  return i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1])
                                      : path.join(__dirname, '_mockdata.json');
})();

// ---------------------------------------------------------------- child: run one engine copy
if (process.argv.includes('--engine')) {
  const dir = process.argv[process.argv.indexOf('--engine') + 1];
  const data = JSON.parse(fs.readFileSync(argJson, 'utf8'));

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
      setValue: () => {}, setValues: () => {}, clearContent: () => {},
    };
  }
  function mkSheet(name) {
    const sh = data[name];
    if (!sh || !sh.values) return null;
    return {
      getName: () => name,
      getLastRow: () => sh.values.length,
      getDataRange: () => mkRange(name, 1, 1, sh.values.length, sh.values.reduce((m, r) => Math.max(m, r.length), 0)),
      getRange: (a, b, c, d) => {
        if (typeof a === 'string') {
          const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
          const c1 = m[1].split('').reduce((x, ch) => x * 26 + ch.charCodeAt(0) - 64, 0), r1 = +m[2];
          if (!m[3]) return mkRange(name, r1, c1, 1, 1);
          return mkRange(name, r1, c1, +m[4] - r1 + 1,
            m[3].split('').reduce((x, ch) => x * 26 + ch.charCodeAt(0) - 64, 0) - c1 + 1);
        }
        return mkRange(name, a, b, c || 1, d || 1);
      },
    };
  }
  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({ getSheetByName: mkSheet }),
    getActive: () => ({ toast: () => {} }),
    getUi: () => { throw new Error('no UI'); },
  };
  global.Logger = { log: () => {} };

  eval(fs.readFileSync(path.join(dir, 'EcoGainsSim_v4.gs'), 'utf8'));

  const cells = {};
  const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'];
  for (const payer of ['NONPAYER', 'PAYER']) {
    for (const seg of SEGS) {
      const sim = ECOGAINS_SIM(payer, seg), diff = ECOGAINS_DIFF(payer, seg);
      CATEGORY_ORDER.forEach((cat, i) => {
        RESOURCES.forEach((res, j) => {
          cells[[payer, seg, cat, res].join('|')] = [sim[i][j], diff[i][j]];
        });
      });
    }
  }
  process.stdout.write(JSON.stringify({ cells, resources: RESOURCES, categories: CATEGORY_ORDER }));
  process.exit(0);
}

// ---------------------------------------------------------------- parent
const run = (dir) => JSON.parse(execFileSync(
  process.execPath, [__filename, '--engine', dir, '--json', argJson],
  { maxBuffer: 512 * 1024 * 1024 }).toString());

let failures = 0;
const gate = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

console.log('ENGINE SYNC — engine/ vs engine/pre_collection/  (' + path.basename(argJson) + ')\n');

const A = run(path.join(__dirname, '..', 'engine'));
const B = run(path.join(__dirname, '..', 'engine', 'pre_collection'));

// The documented, intended differences. Anything else is drift.
// NB: renamed off PACK_RES / PACK_ONLY_SPECS on purpose. This file eval()s the engine into its
// own module scope, and a top-level `const` here collides with the engine's `var` of the same name
// — the identical 'Identifier X has already been declared' trap CLAUDE.md documents for Apps
// Script. Parent-side names must not shadow engine globals.
const EXPECT_PACKS = ['1-star Pack', '2-star Pack', '3-star Pack', '4-star Pack', '5-star Pack', '6-star Pack'];
const PACK_ONLY_CATEGORIES = ['Team Event', 'Flock Flurry'];   // carried everywhere but the pack overlay
// Card-collection completion rows (2026-08-19): priced by running CardOpenings.gs, which the
// pre-collections copy does not have. Like the pack columns, their ABSENCE there is the point.
const COLLECTION_ONLY_CATEGORIES = ['Col - Sets', 'Col - Albums'];

gate('engine/ carries the 6 pack resources', EXPECT_PACKS.every(r => A.resources.includes(r)),
     `${A.resources.length} resources`);
gate('pre_collection carries none of them', EXPECT_PACKS.every(r => !B.resources.includes(r)),
     `${B.resources.length} resources`);
gate('engine/ carries the collection completion rows',
     COLLECTION_ONLY_CATEGORIES.every(c => A.categories.includes(c)),
     `${A.categories.length} categories`);
gate('pre_collection carries none of them',
     COLLECTION_ONLY_CATEGORIES.every(c => !B.categories.includes(c)),
     `${B.categories.length} categories`);
gate('the two agree on every OTHER category, in the same order',
     JSON.stringify(A.categories.filter(c => !COLLECTION_ONLY_CATEGORIES.includes(c))) ===
     JSON.stringify(B.categories),
     `${A.categories.length - COLLECTION_ONLY_CATEGORIES.length} shared vs ${B.categories.length}`);

const shared = B.resources.filter(r => A.resources.includes(r));
gate('every pre_collection resource exists in engine/', shared.length === B.resources.length,
     `${shared.length} shared`);

let checked = 0, worst = 0, worstKey = '';
const drift = [];
for (const key of Object.keys(B.cells)) {
  const [, , cat, res] = key.split('|');
  if (!shared.includes(res)) continue;
  if (PACK_ONLY_CATEGORIES.includes(cat)) continue;   // pack overlay legitimately moves these in engine/
  const a = A.cells[key], b = B.cells[key];
  if (!a) { drift.push(`${key} missing from engine/`); continue; }
  checked++;
  for (let i = 0; i < 2; i++) {
    const d = Math.abs(a[i] - b[i]);
    const rel = d / Math.max(1, Math.abs(a[i]), Math.abs(b[i]));
    if (rel > worst) { worst = rel; worstKey = `${key}[${i ? 'diff' : 'sim'}] ${a[i]} vs ${b[i]}`; }
    if (rel > 1e-12) drift.push(`${key}[${i ? 'diff' : 'sim'}] ${a[i]} vs ${b[i]}`);
  }
}

gate(`every non-pack cell agrees (${checked} cells)`, drift.length === 0,
     drift.length ? `${drift.length} divergent — e.g. ${drift.slice(0, 3).join(' · ')}`
                  : `max rel diff ${worst.toExponential(1)}`);

// The pack-only sources must differ ONLY in their pack columns — their carried resources are the
// same measured values in both copies, so a divergence there is real drift, not a pack feature.
let poChecked = 0;
const poDrift = [];
for (const key of Object.keys(B.cells)) {
  const [, , cat, res] = key.split('|');
  if (!PACK_ONLY_CATEGORIES.includes(cat) || !shared.includes(res)) continue;
  const a = A.cells[key], b = B.cells[key];
  if (!a) continue;
  poChecked++;
  for (let i = 0; i < 2; i++)
    if (Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(a[i]), Math.abs(b[i])) > 1e-12)
      poDrift.push(`${key}[${i ? 'diff' : 'sim'}] ${a[i]} vs ${b[i]}`);
}
gate(`pack-only sources agree on their non-pack resources (${poChecked} cells)`, poDrift.length === 0,
     poDrift.length ? poDrift.slice(0, 3).join(' · ') : 'Team Event / Flock Flurry carried alike');

// Shared constants that have bitten before (window length, RM switches, weekend rule).
{
  const grab = (dir, f, re) => {
    const m = fs.readFileSync(path.join(__dirname, '..', dir, f), 'utf8').match(re);
    return m ? m[1] : null;
  };
  const both = (f, re, label) => {
    const a = grab('engine', f, re), b = grab('engine/pre_collection', f, re);
    gate(`${label} matches across both copies`, a !== null && a === b, `engine ${a} · pre_collection ${b}`);
  };
  both('EcoGainsSim_v4.gs', /var SIM_DAYS = (\d+)/, 'SIM_DAYS');
  both('EcoGainsSim_Daily.gs', /var DAILY_DAYS = (\d+)/, 'DAILY_DAYS');
  both('EcoGainsSim_PBP.gs', /var PBP_DAYS = (\d+)/, 'PBP_DAYS');
  both('EcoGainsSim_v4.gs', /var RM_AUTO = (\w+)/, 'RM_AUTO');
  both('EcoGainsSim_v4.gs', /var RM_SIMULATE = (\w+)/, 'RM_SIMULATE');
  both('EcoGainsSim_v4.gs', /var RM_ANCHORED = (\w+)/, 'RM_ANCHORED');
  both('EcoGainsSim_v4.gs', /var NS_SIMULATE = (\w+)/, 'NS_SIMULATE');
  both('EcoGainsSim_v4.gs', /function isWeekend_\(day\)\{ var m = \(day-1\) % 7; return (.*?); \}/, 'weekend rule');
}

console.log(failures ? `\n${failures} SYNC FAILURE(S)` : '\nENGINE COPIES IN SYNC');
process.exit(failures ? 1 : 0);
