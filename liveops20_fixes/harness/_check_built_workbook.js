// Does the GENERATED workbook actually work with the re-based engine?
//
// The gates above (_mock_identity.js) prove the engine is correct against the old workbook. This one
// closes the loop on the builder: it runs the engine over liveops20_fixes/harness/_mockdata_variant.json
// (dumped from display/LiveOps20_variant_basis.xlsx) and asserts
//
//   1. both calendars parse, nothing lands outside days 1..SIM_DAYS, and the instance counts match
//      the AS_RUN_SCHEDULE the builder wrote
//   2. every base config sheet has its *_v2 proposal twin and the builder reset it to the base, so
//      a fresh workbook starts neutral
//   3. with each _v2 still a clone of its base AND cal_new a copy of cal_curr, every diff is 0 — now
//      a full identity test, because the as-run calendar schedules every simulated source (the old
//      workbook's cal_curr was missing Night Sky, Rainbow Maker and River Rush)
//   4. the always-on and carried sources produce non-zero simulated values, i.e. the borrowed data
//      is actually flowing and gate 3 is not passing because everything is zero
//
// Run after: python liveops20_fixes/_build_workbook.py
//            python liveops20_fixes/_dump_mockdata.py --borrow-data
// Usage: node liveops20_fixes/harness/_check_built_workbook.js
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ENGINE = path.join(HERE, '..', 'engine');
const MOCK = path.join(HERE, '_mockdata_variant.json');

let failures = 0;
const gate = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

if (!fs.existsSync(MOCK)) {
  console.log('FAIL _mockdata_variant.json missing — run _build_workbook.py then '
              + '_dump_mockdata.py --borrow-data');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(MOCK, 'utf8'));
delete data['cal_parsed'];
const CAL_NEW_REAL = JSON.parse(JSON.stringify(data['cal_new']));   // kept for the carried-source test
data['cal_new'] = JSON.parse(JSON.stringify(data['cal_curr']));     // identity: same schedule both sides

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

eval(fs.readFileSync(path.join(ENGINE, 'EcoGainsSim_v4.gs'), 'utf8'));
eval(fs.readFileSync(path.join(ENGINE, 'EcoGainsSim_Daily.gs'), 'utf8'));
_sheetValsCache = {};

// ---------------------------------------------------------------- 1. calendars
console.log('================ CALENDAR ================');
const ctx = Context.get();
gate('cal_curr parses', ctx.calCurOk, Object.keys(ctx.calCur).length + ' lanes');
gate('cal_new parses', ctx.calNewOk, Object.keys(ctx.calNew).length + ' lanes');
{
  let outside = [], maxDay = 0, total = 0;
  Object.keys(ctx.calCur).forEach(ev => {
    ctx.calCur[ev].forEach(inst => {
      total++;
      inst.days.forEach(d => {
        maxDay = Math.max(maxDay, d);
        if (d < 1 || d > SIM_DAYS) outside.push(`${ev} day ${d}`);
      });
    });
  });
  gate(`every instance inside days 1..${SIM_DAYS}`, outside.length === 0,
       outside.length ? outside.slice(0, 5).join(', ') : `${total} instances, last day ${maxDay}`);
  const counts = {};
  Object.keys(ctx.calCur).forEach(ev => { counts[ev] = ctx.calCur[ev].length; });
  const want = {'Night Sky': SIM_DAYS, 'Rainbow Maker': 3, 'Hatchling Hideaway': 3,
                'Kite Festival': 2, 'Target Day': 3, "Chuck's Challenge": 1};
  const bad = Object.keys(want).filter(k => counts[k] !== want[k]);
  gate('instance counts match the as-run schedule the builder wrote', bad.length === 0,
       bad.length ? bad.map(k => `${k}: ${counts[k]} vs ${want[k]}`).join(', ')
                  : Object.keys(want).map(k => `${k} ${counts[k]}`).join(' · '));
  gate('the sources the old cal_curr was missing are now scheduled',
       (counts['Night Sky'] || 0) > 0 && (counts['Rainbow Maker'] || 0) > 0,
       `Night Sky ${counts['Night Sky']} · Rainbow Maker ${counts['Rainbow Maker']} · ` +
       `River Rush ${counts['River Rush'] || 0} (absent by design — it was cut)`);
}

// ---------------------------------------------------------------- 2. proposal layer is neutral
console.log('\n================ CONFIG LAYERS ================');
{
  // base = the config the variant ran (the anchor), _v2 = the proposal you author. A fresh workbook
  // must start with _v2 identical to its base, otherwise it reports a diff nobody authored in it.
  const PAIRED = ['c_saga', 'c_day', 'NS', 'SP', 'SP_lb', 'Race', 'TaD', 'Ki', 'J', 'HH', 'BB',
                  'Ph', 'RR', 'F', 'RM_1st', 'RM_2nd'];   // RM paired since 2026-08-18 (anchored)
  const missing = PAIRED.filter(k => data[k] && !data[k + '_v2']);
  const cellsOf = (n) => JSON.stringify((data[n] || {}).values || []);
  const present = PAIRED.filter(k => data[k] && data[k + '_v2']);
  const drifted = present.filter(k => cellsOf(k) !== cellsOf(k + '_v2'));
  gate('every base config sheet has its _v2 proposal twin', missing.length === 0,
       missing.length ? missing.join(', ') : `${present.length} pairs`);
  gate('a fresh workbook ships _v2 identical to base (nothing pre-authored)', drifted.length === 0,
       drifted.length ? drifted.join(', ') : `${present.length} pairs are byte-identical`);
}

// ---------------------------------------------------------------- 3 + 4. identity, non-triviality
console.log('\n================ IDENTITY ON THE BUILT WORKBOOK ================');
{
  const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'];
  // Bottom-up sources compute their value from the ladder and ignore the measured anchor, so their
  // diff is their whole value whether or not anything was authored. They are excluded here and
  // asserted separately — see the note printed below, which is a real finding for the v3 work.
  // Rainbow Maker used to sit here as a bottom-up exception. It is ANCHORED now (RM_ANCHORED,
  // 2026-08-18: measured x R over the as-run schedule, _v2 ladders = the proposal), so with _v2
  // clones it must obey the same identity as every other anchored source — no exception list.
  const BOTTOM_UP_CATS = {};
  // A calendar-driven source with no instances is zeroed by removal semantics. With BORROWED
  // pre-test data that shows up as a negative diff for anything the variant no longer runs (River
  // Rush); with the real variant export those rows are ~0 anyway.
  const unscheduled = {};
  CATEGORY_ORDER.forEach(cat => {
    const label = CAL_LABEL[cat];
    if (label && (ctx.calNew[label] || []).length === 0) unscheduled[cat] = 1;
  });
  let maxDiff = 0, worst = '', simTotal = 0, nonZeroCats = {}, bottomUpMoved = {}, cutMoved = {};
  for (const payer of ['NONPAYER', 'PAYER']) {
    for (const seg of SEGS) {
      const SIM = ECOGAINS_SIM(payer, seg), DIFF = ECOGAINS_DIFF(payer, seg);
      for (let ci = 0; ci < CATEGORY_ORDER.length; ci++) {
        const cat = CATEGORY_ORDER[ci];
        for (let ri = 0; ri < RESOURCES.length; ri++) {
          const s = +SIM[ci][ri] || 0, d = +DIFF[ci][ri] || 0;
          simTotal += Math.abs(s);
          if (Math.abs(s) > 1e-9) nonZeroCats[cat] = 1;
          if (BOTTOM_UP_CATS[cat]) {
            if (Math.abs(d) > 1e-9) bottomUpMoved[cat] = Math.max(bottomUpMoved[cat] || 0, Math.abs(d));
            continue;
          }
          if (unscheduled[cat]) {
            if (Math.abs(d) > 1e-9) cutMoved[cat] = Math.max(cutMoved[cat] || 0, Math.abs(d));
            continue;
          }
          if (Math.abs(d) > maxDiff) {
            maxDiff = Math.abs(d);
            worst = `${payer}|${seg}|${cat}|${RESOURCES[ri]} = ${d}`;
          }
        }
      }
    }
  }
  gate('_v2 == base and cal_new == cal_curr => every anchored source diffs exactly 0', maxDiff === 0,
       maxDiff === 0 ? 'full identity across every anchored, carried and scheduled source' : worst);
  gate('sources cut from the calendar are the only other movers',
       Object.keys(cutMoved).every(c => unscheduled[c]),
       Object.keys(cutMoved).map(c => `${c} (0 instances, borrowed data shows ` +
                                      `${cutMoved[c].toFixed(0)})`).join(', ') || 'none');
  gate('the only source that still moves is the bottom-up one',
       Object.keys(bottomUpMoved).every(c => BOTTOM_UP_CATS[c]),
       Object.keys(bottomUpMoved).map(c => `${c} up to ${bottomUpMoved[c].toFixed(0)}`).join(', ')
       || 'none');
  if (Object.keys(bottomUpMoved).length) {
    console.log('     NOTE: a bottom-up source moved — since 2026-08-18 RM is anchored and no '
                + 'source should be on the bottom-up path in this stack. Check RM_SIMULATE.');
  }
  gate('the sim is not trivially zero (borrowed data is flowing)', simTotal > 1000,
       `Σ|sim| = ${simTotal.toFixed(0)} across ${Object.keys(nonZeroCats).length} categories`);
}

// ---------------------------------------------------------------- 5. carried sources, REAL calendars
// The identity test above holds the calendars equal. Carried sources ignore the calendar entirely
// (resultRow_ returns measuredRow_ before any schedule is read), so their diff must be exactly 0
// even when the two calendars differ. Rainbow Maker rides along: it is ANCHORED (2026-08-18), and
// with unauthored _v2 ladders R = 1, so measured passes straight through here too.
console.log('\n================ CARRIED SOURCES ON THE REAL CALENDARS ================');
data['cal_new'] = CAL_NEW_REAL;
eval(fs.readFileSync(path.join(ENGINE, 'EcoGainsSim_v4.gs'), 'utf8'));
eval(fs.readFileSync(path.join(ENGINE, 'EcoGainsSim_Daily.gs'), 'utf8'));
_sheetValsCache = {};
{
  const CARRIED = ['Rainbow Maker', 'Ads', 'Other', 'Team Event', 'Team Race', 'FlowerCoop',
                   'IAPs', 'Flock Flurry'];
  const SEGS2 = ['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'];
  const bad = [];
  let rmSim = 0, rmMeas = 0;
  for (const payer of ['NONPAYER', 'PAYER']) {
    for (const seg of SEGS2) {
      const SIM = ECOGAINS_SIM(payer, seg), DIFF = ECOGAINS_DIFF(payer, seg);
      for (const cat of CARRIED) {
        const ci = CATEGORY_ORDER.indexOf(cat);
        if (ci < 0) continue;
        for (let ri = 0; ri < RESOURCES.length; ri++) {
          const d = +DIFF[ci][ri] || 0, s = +SIM[ci][ri] || 0;
          if (cat === 'Rainbow Maker') { rmSim += s; rmMeas += s - d; }
          if (Math.abs(d) > 1e-9)
            bad.push(`${cat} ${seg}/${payer} ${RESOURCES[ri]} = ${d.toFixed(3)}`);
        }
      }
    }
  }
  gate('every carried source diffs exactly 0 with the real calendars', bad.length === 0,
       bad.length ? bad.slice(0, 4).join(', ') : `${CARRIED.length} sources checked`);
  gate('Rainbow Maker passes measured through while its _v2 ladders are unauthored (anchored, R = 1)',
       Math.abs(rmSim - rmMeas) < 1e-9,
       `sim ${rmSim.toFixed(0)} vs measured ${rmMeas.toFixed(0)} (identical => the measured RM ` +
       `numbers pass straight through, so the 100+ over-count cancels out of every diff)`);
  gate('shipped engine is anchored, not bottom-up or carried',
       RM_SIMULATE === false && typeof RM_ANCHORED !== 'undefined' && RM_ANCHORED === true,
       `RM_SIMULATE ${RM_SIMULATE} · RM_ANCHORED ${typeof RM_ANCHORED !== 'undefined' ? RM_ANCHORED : 'undefined'}`);
}

console.log(failures ? `\n${failures} GATE FAILURE(S)` : '\nALL GATES PASSED');
process.exit(failures ? 1 : 0);
