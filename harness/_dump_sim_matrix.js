// Dump the full offline sim matrices for the sim-vs-actual comparison (reports/ pipeline).
//
// Emits analysis/out/sim_matrix.json:
//   rows[]  — 2 payers x 6 segments x 25 categories x 19 resources, long format:
//             sim_33 / diff_33 / meas_33 (33-day per-earner totals, wb of record via _mockdata.json)
//             cur_win / new_win — the same quantities restricted to DAY_LIST, the cal_new day
//             indices Garry mapped onto the actual A/B ledger window (2..10 Aug 2026):
//             day 27,28,29,30,31,32,33 then WRAP to 6,7 (28-day live cycle: day 34 == day 6).
//   daily{} — full 33x19 CURRENT/NEW grids for the story categories + 'ALL', per segment x payer.
//   gates   — conservation: summing the daily grids over days 1..33 must reproduce meas_33/sim_33
//             (same identity _mock_7day.js proves for the windowed view). Non-zero exit on FAIL.
//
// Usage: node harness/_dump_sim_matrix.js
const fs = require('fs');
const path = require('path');
const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_mockdata.json'), 'utf8'));
// The engine PREFERS the hidden cal_parsed precompute over the visual grids, but workbook
// exports can carry a STALE one (wb16 shipped calendar edits without a re-Precompute — its
// cal_parsed still listed Night Sky on cal_curr). The mock parses merges fine, so always
// drop it here and parse the real grids. (The LIVE workbook still needs menu ▸ Precompute
// calendars after any calendar edit.)
delete data['cal_parsed'];

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
eval(v4Src); eval(dailySrc); _sheetValsCache = {};

// ---------------------------------------------------------------------------------------------
// Aug 2..10 -> cal_new day indices. Garry's original map was [27..33, 6, 7] (wrap at 33->6);
// the live Variant's own event-day spikes pin the phase 23 days earlier: Aug 2 = day 5 (a
// Sunday = Sunday, no wrap). Evidence (resource_gains_base.csv, Variant, claim spikes land the
// day AFTER a leaderboard instance ends): Chuck ends 7,9 -> Aug 5,7; Kite ends 5,12 -> Aug 3,10;
// Target Day 10,11,12 -> Aug 8,9,10; RM instance 6-9 runs Aug 3-6; Flock Flurry's 18-day on/off
// pattern matches day-for-day; Red's only trace is the day-2 end's claim tail; Bomb (13-16) sits
// post-window. Jigsaw and Bomb's Ballet do NOT fit any phase (live schedule diverges from plan).
const DAY_LIST = [5, 6, 7, 8, 9, 10, 11, 12, 13];
const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'];
const PAYERS = ['NONPAYER', 'PAYER'];
const STORY_CATS = ['Daily Night Sky Prize', 'Core', 'Rainbow Maker', 'Saga', 'Daily Gift',
                    'Season Pass (Free)', 'Red Challenge', 'Bomb Challenge', 'ALL'];

let failures = 0;
const gate = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

gate('DAY_LIST: 9 entries, all within 1..33',
     DAY_LIST.length === 9 && DAY_LIST.every(d => d >= 1 && d <= 33), DAY_LIST.join(','));

const rows = [];
const daily = {};
let maxRelErr = 0;
for (const payer of PAYERS) {
  for (const seg of SEGS) {
    const SIM = ECOGAINS_SIM(payer, seg);
    const DIFF = ECOGAINS_DIFF(payer, seg);
    for (let ci = 0; ci < CATEGORY_ORDER.length; ci++) {
      const cat = CATEGORY_ORDER[ci];
      const CUR = ECOGAINS_DAILY(payer, seg, cat, 'CURRENT');
      const NEW = ECOGAINS_DAILY(payer, seg, cat, 'NEW');
      for (let ri = 0; ri < RESOURCES.length; ri++) {
        const sim33 = +SIM[ci][ri] || 0;
        const diff33 = +DIFF[ci][ri] || 0;
        const meas33 = sim33 - diff33;
        let curWin = 0, newWin = 0, curFull = 0, newFull = 0;
        for (const d of DAY_LIST) { curWin += +CUR[d - 1][ri] || 0; newWin += +NEW[d - 1][ri] || 0; }
        for (let d = 1; d <= 33; d++) { curFull += +CUR[d - 1][ri] || 0; newFull += +NEW[d - 1][ri] || 0; }
        // conservation: the daily allocation must integrate back to the 33-day totals
        const scale = Math.max(1, Math.abs(meas33), Math.abs(sim33));
        maxRelErr = Math.max(maxRelErr,
                             Math.abs(curFull - meas33) / scale, Math.abs(newFull - sim33) / scale);
        if (sim33 || meas33 || curWin || newWin)     // skip all-zero cells: 5700 -> the live ones
          rows.push({ payer, segment: seg, category: cat, resource: RESOURCES[ri],
                      sim_33: sim33, meas_33: meas33, diff_33: diff33,
                      cur_win: curWin, new_win: newWin });
      }
      if (STORY_CATS.includes(cat)) {
        const key = seg + '|' + cat + '|' + payer;
        daily[key] = { cur: CUR.map(r => r.map(Number)), new: NEW.map(r => r.map(Number)) };
      }
    }
    // 'ALL' daily series for the overlay charts
    const key = seg + '|ALL|' + payer;
    daily[key] = { cur: ECOGAINS_DAILY(payer, seg, 'ALL', 'CURRENT').map(r => r.map(Number)),
                   new: ECOGAINS_DAILY(payer, seg, 'ALL', 'NEW').map(r => r.map(Number)) };
  }
}
gate('conservation: daily grids integrate to the 33-day matrices (rel tol 1e-9)',
     maxRelErr < 1e-9, 'max rel err ' + maxRelErr.toExponential(2));
gate('row count sane (non-zero cells of 5700)', rows.length > 500 && rows.length <= 5700, String(rows.length));

const out = {
  meta: {
    generated: new Date().toISOString(),
    day_list: DAY_LIST,
    resources: RESOURCES,
    categories: CATEGORY_ORDER,
    segments: SEGS,
    payers: PAYERS,
    ns_simulate: (typeof NS_SIMULATE !== 'undefined') ? NS_SIMULATE : null,
    mockdata_fingerprint: {
      data_gains_rows: data['data_gains'].values.length,
      sp_v2_normal_2nd: data['SP_v2'].values[3][1],       // 10 in wb15 (was 6 in wb14)
      packconfig_rows: data['PackConfig'].values.length,
    },
  },
  rows,
  daily,
  gates: { conservation_max_relerr: maxRelErr },
};
const outDir = path.join(__dirname, '..', 'analysis', 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'sim_matrix.json'), JSON.stringify(out));
console.log('written analysis/out/sim_matrix.json — ' + rows.length + ' rows, ' +
            Object.keys(daily).length + ' daily series');
if (failures) { console.log(failures + ' GATE FAILURE(S)'); process.exit(1); }
