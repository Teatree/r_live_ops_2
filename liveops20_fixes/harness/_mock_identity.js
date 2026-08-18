// Gates for the LiveOps 2.0 fixes engine — the two things Garry required before any number from it
// is quoted (2026-08-17):
//
//   A. REPRODUCTION — with the window back at 33 days and the modelling switches restored, this
//      engine must be bit-identical to engine/pre_collection on the same workbook data. Proves the
//      re-base itself introduced no drift; anything that differs is a bug I wrote, not a choice.
//   B. IDENTITY — with each _v2 sheet made a clone of its base sheet (nothing authored) and cal_new
//      made identical to cal_curr, every DIFF cell must be exactly 0. Proves the engine only
//      reports a change when a change was actually authored.
//   C. CONSERVATION — summing the Daily engine's per-day grids over days 1..SIM_DAYS must reproduce
//      the 21-day totals (the identity the main stack's 7-day view proved for the 33-day model).
//   D. WINDOW CONSTANTS — SIM_DAYS, DAILY_DAYS and PBP_DAYS are declared in three files because of
//      Apps Script load order; they must agree.
//   E. AUTHORING — editing a _v2 sheet actually moves the sim, and B's zero is not a dead engine
//      (snapshot, mutate, assert, restore — never bake workbook state into a gate).
//
// The _v3 remap this file used to gate was removed 2026-08-18: base = the config the variant ran,
// _v2 = the proposal. B and E are the pair that matters — B says "silent unless authored", E says
// "loud when authored". A gate that only proved B could be passed by an engine that does nothing.
//
// Usage: node liveops20_fixes/harness/_mock_identity.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const NEW_ENGINE = path.join(HERE, '..', 'engine');
const OLD_ENGINE = path.join(ROOT, 'engine', 'pre_collection');
const MOCK = path.join(ROOT, 'harness', '_mockdata.json');

let failures = 0;
const gate = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
};

// ---------------------------------------------------------------- child mode: run one engine
// Every config sheet that comes in a base/_v2 pair. Kept in sync with CONFIG_PAIRED in the engine;
// gate D asserts the two lists match, so adding a config sheet there can't silently escape gate B.
// RM_1st / RM_2nd joined 2026-08-18 (RM anchored: base = as-run ladder, _v2 = proposal).
const PAIRED = ['c_saga', 'c_day', 'NS', 'SP', 'SP_lb', 'Race', 'TaD', 'Ki',
                'J', 'HH', 'BB', 'Ph', 'RR', 'F', 'TE', 'RM_1st', 'RM_2nd'];

// argv: --engine <dir> [--legacy] [--identity] [--author] [--rm-lane] [--author-rm] [--rm-thin]
//   --legacy    : window forced back to 33 + modelling switches restored (reproduction gate)
//   --identity  : cal_new := cal_curr AND every _v2 := its base sheet (nothing authored, so the
//                 only thing left that could move a number is a bug)
//   --author    : on top of --identity, edit c_day_v2's day-1 reward (proves the engine is live)
//   --rm-lane   : paint a synthetic 2-instance Rainbow Maker lane onto cal_curr BEFORE the
//                 identity copy (the main workbook's cal_curr has no RM lane — RM was new in the
//                 redesign — and the anchored path carries without as-run instances)
//   --author-rm : create RM_1st_v2/RM_2nd_v2 as clones, then bump RM_1st_v2's first coin rung
//   --rm-thin   : AFTER the identity copy, delete the LAST RM instance from cal_new only — the
//                 anchored row must not move (T pinned; a T-reading engine would shrink)
if (process.argv.includes('--engine')) {
  const dir = process.argv[process.argv.indexOf('--engine') + 1];
  const legacy = process.argv.includes('--legacy');
  const identity = process.argv.includes('--identity');
  const author = process.argv.includes('--author');
  const rmLane = process.argv.includes('--rm-lane');
  const authorRM = process.argv.includes('--author-rm');
  const rmThin = process.argv.includes('--rm-thin');
  const data = JSON.parse(fs.readFileSync(MOCK, 'utf8'));
  delete data['cal_parsed'];                       // stale precompute; parse the visual grids

  if (rmLane) {
    // grid = rows 5..25, cols B..V (day = col - 1). Two 4-day instances at days 2-5 and 9-12,
    // written into the first fully-empty grid row so no real lane is disturbed.
    const cal = data['cal_curr'];
    let row = -1;
    for (let r = 5; r <= 25; r++) {
      const vr = cal.values[r - 1] || [];
      let empty = true;
      for (let c = 2; c <= 22; c++) {
        const v = vr[c - 1];
        if (v !== undefined && v !== null && String(v).trim() !== '') { empty = false; break; }
      }
      if (empty) { row = r; break; }
    }
    if (row < 0) throw new Error('--rm-lane: no empty cal_curr grid row to paint');
    while (cal.values.length < row) cal.values.push([]);
    const vr = cal.values[row - 1];
    while (vr.length < 22) vr.push('');
    vr[2] = 'Rainbow Maker';                       // col 3 = day 2
    vr[9] = 'Rainbow Maker';                       // col 10 = day 9
    cal.merges = cal.merges || [];
    cal.merges.push({ r: row, c: 3, nr: 1, nc: 4 }, { r: row, c: 10, nr: 1, nc: 4 });
    // The main workbook's measured RM rows are soft-launch traces with NO HC row (RM was new in
    // the redesign), so the anchored ratio path would have nothing to scale and the authoring
    // gate would vacuously pass on a dead path. Inject one measured anchor cell the same way the
    // lane is injected — in the child's memory only.
    const gv = data['data_gains'].values, gh = {};
    (gv[0] || []).forEach((x, i) => { if (x !== null && x !== '') gh[String(x)] = i; });
    const anchor = new Array(gv[0].length).fill('');
    anchor[gh['engagement_segment']] = 'C. 10-19';
    anchor[gh['payer_flag']] = 'NONPAYER';
    anchor[gh['resource']] = 'HC';
    anchor[gh['category']] = 'Rainbow Maker';
    anchor[gh['amount_per_earner']] = 100;
    gv.push(anchor);
  }
  if (identity) {
    data['cal_new'] = JSON.parse(JSON.stringify(data['cal_curr']));
    // Blank the proposal layer by cloning each base sheet over its _v2. The workbook ships REAL v2
    // edits, so without this the identity gate would be asserting against live workbook content —
    // exactly the "gate bakes in workbook state" failure mode. Mutating the child's in-memory copy
    // means there is nothing to restore: the file on disk is never touched.
    PAIRED.forEach((k) => {
      if (data[k] && data[k + '_v2']) data[k + '_v2'] = JSON.parse(JSON.stringify(data[k]));
    });
  }
  if (author) {
    // author a proposal the ordinary way: edit the _v2 sheet
    const c = data['c_day_v2'];
    if (c) c.values[3][1] = (+c.values[3][1] || 0) * 2 + 50;
  }
  if (authorRM) {
    ['RM_1st', 'RM_2nd'].forEach((k) => {
      if (data[k]) data[k + '_v2'] = JSON.parse(JSON.stringify(data[k]));
    });
    // bump the first coin-paying rung of RM_1st_v2, located by headers (never by fixed indices —
    // gates must not bake sheet layout in)
    const sh = data['RM_1st_v2'];
    if (!sh) throw new Error('--author-rm: RM_1st missing from the mockdata');
    let hr = -1, reqC = -1, coinC = -1;
    for (let r = 0; r < sh.values.length; r++) {
      const idx = {};
      (sh.values[r] || []).forEach((x, i) => { if (x !== null && x !== undefined && x !== '') idx[String(x).trim()] = i; });
      if (idx['Req Accum'] !== undefined && idx['Coins'] !== undefined) {
        hr = r; reqC = idx['Req Accum']; coinC = idx['Coins']; break;
      }
    }
    if (hr < 0) throw new Error('--author-rm: RM_1st_v2 ladder header (Req Accum + Coins) not found');
    let edited = false;
    for (let r = hr + 1; r < sh.values.length; r++) {
      const row = sh.values[r] || [];
      if (row[0] === null || row[0] === undefined || row[0] === '' || isNaN(parseFloat(row[0]))) break;
      if (+row[coinC] > 0) { row[coinC] = +row[coinC] * 2 + 50; edited = true; break; }
    }
    if (!edited) throw new Error('--author-rm: no coin-paying rung found on RM_1st_v2');
  }
  if (rmThin) {
    // delete the LAST RM instance from cal_new only (label cell + its merge)
    const cal = data['cal_new'];
    let br = -1, bc = -1;
    for (let r = 5; r <= 25; r++) {
      const vr = cal.values[r - 1] || [];
      for (let c = 2; c <= 22; c++) {
        if (String(vr[c - 1] || '').trim() === 'Rainbow Maker' && c > bc) { br = r; bc = c; }
      }
    }
    if (br < 0) throw new Error('--rm-thin: no Rainbow Maker instance on cal_new to remove');
    cal.values[br - 1][bc - 1] = '';
    cal.merges = (cal.merges || []).filter((m) => !(m.r <= br && br < m.r + m.nr && m.c <= bc && bc < m.c + m.nc));
  }

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

  eval(fs.readFileSync(path.join(dir, 'EcoGainsSim_v4.gs'), 'utf8'));
  eval(fs.readFileSync(path.join(dir, 'EcoGainsSim_Daily.gs'), 'utf8'));
  const hcwPath = path.join(dir, 'HCPerWin.gs');           // standalone; absent in the old engine
  if (fs.existsSync(hcwPath)) eval(fs.readFileSync(hcwPath, 'utf8'));
  if (legacy) {
    // behave exactly like the main stack: no layer shift, 33-day window, 33-column calendar
    if (typeof SIM_DAYS !== 'undefined') SIM_DAYS = 33;
    DAILY_DAYS = 33;
    CAL_LAST_COL = 34;
    // the 33-day plan calendars start on a Wednesday; dow 3 reproduces the main stack's
    // (day-1)%7 in {2,3,4} weekend rule exactly
    if (typeof SIM_DAY_ONE_DOW !== 'undefined') SIM_DAY_ONE_DOW = 3;
    // Three sources are deliberately modelled differently in this stack (carried / zeroed). Those
    // are MODELLING decisions, not part of the re-base, so restore the main stack's behaviour —
    // otherwise this gate stops measuring "is the re-based engine bit-identical?" and starts
    // reporting every product decision as a regression.
    if (typeof RM_SIMULATE !== 'undefined') RM_SIMULATE = true;        // bottom-up, not carried
    if (typeof JIGSAW_SIMULATE !== 'undefined') JIGSAW_SIMULATE = true; // measured x R x D x T
    if (typeof RIVER_RUSH_ZERO !== 'undefined') RIVER_RUSH_ZERO = false; // measured anchor kept
    Context = (function (orig) {                    // rebuild Context with the widened calendar
      let c = null;
      return { get: function () {
        if (c) return c;
        const cur = sanitizeCal_(parseCalendarInstances_(CAL_CUR));
        const nw = sanitizeCal_(parseCalendarInstances_(CAL_NEW));
        c = { ds: DataStore.get(), calCur: cur, calNew: nw,
              calCurOk: hasKeys_(cur), calNewOk: hasKeys_(nw) };
        return c;
      } };
    })(Context);
  }
  _sheetValsCache = {};

  const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'];
  const out = { days: (typeof SIM_DAYS !== 'undefined' ? SIM_DAYS : null), daily: DAILY_DAYS,
                cells: {}, diffMax: 0, conservation: 0, paired: null,
                catDiff: {}, catInstances: {} };
  if (!legacy && typeof CONFIG_PAIRED !== 'undefined') out.paired = Object.keys(CONFIG_PAIRED);
  {
    // instances per category on the NEW calendar — a calendar-driven source with none of them is
    // SUPPOSED to go to zero (removal semantics), so the identity gate must not count it as drift
    const ctx0 = Context.get();
    CATEGORY_ORDER.forEach(function (cat) {
      const label = CAL_LABEL[cat];
      out.catInstances[cat] = label ? ((ctx0.calNew[label] || []).length) : null;
    });
  }
  for (const payer of ['NONPAYER', 'PAYER']) {
    for (const seg of SEGS) {
      const SIM = ECOGAINS_SIM(payer, seg), DIFF = ECOGAINS_DIFF(payer, seg);
      for (let ci = 0; ci < CATEGORY_ORDER.length; ci++) {
        const cat = CATEGORY_ORDER[ci];
        const CUR = ECOGAINS_DAILY(payer, seg, cat, 'CURRENT');
        const NEW = ECOGAINS_DAILY(payer, seg, cat, 'NEW');
        for (let ri = 0; ri < RESOURCES.length; ri++) {
          const s = +SIM[ci][ri] || 0, d = +DIFF[ci][ri] || 0, m = s - d;
          if (s || d) out.cells[[payer, seg, cat, RESOURCES[ri]].join('|')] = [s, d];
          out.diffMax = Math.max(out.diffMax, Math.abs(d));
          out.catDiff[cat] = Math.max(out.catDiff[cat] || 0, Math.abs(d));
          let cf = 0, nf = 0;
          for (let k = 0; k < DAILY_DAYS; k++) { cf += +CUR[k][ri] || 0; nf += +NEW[k][ri] || 0; }
          const scale = Math.max(1, Math.abs(s), Math.abs(m));
          out.conservation = Math.max(out.conservation,
                                      Math.abs(cf - m) / scale, Math.abs(nf - s) / scale);
        }
      }
    }
  }
  if (typeof ECOGAINS_HC_PER_WIN === 'function') out.hcw = ECOGAINS_HC_PER_WIN('10-19');
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------- parent
const run = (dir, ...flags) => JSON.parse(execFileSync(
  process.execPath, [__filename, '--engine', dir, ...flags], { maxBuffer: 512 * 1024 * 1024 }).toString());

console.log('================ WINDOW CONSTANTS ================');
const src = (f) => fs.readFileSync(path.join(NEW_ENGINE, f), 'utf8');
const grab = (f, re) => { const m = src(f).match(re); return m ? +m[1] : null; };
const simDays = grab('EcoGainsSim_v4.gs', /var SIM_DAYS = (\d+)/);
const dailyDays = grab('EcoGainsSim_Daily.gs', /var DAILY_DAYS = (\d+)/);
const pbpDays = grab('EcoGainsSim_PBP.gs', /var PBP_DAYS = (\d+)/);
gate('SIM_DAYS == DAILY_DAYS == PBP_DAYS',
     simDays === dailyDays && dailyDays === pbpDays,
     `SIM_DAYS ${simDays} · DAILY_DAYS ${dailyDays} · PBP_DAYS ${pbpDays}`);
gate('window is the A/B test length, not the 33-day plan', simDays === 21, String(simDays));
{
  // the weekend mapping must match the real weekday of day 1, or every reach/T is mis-weighted
  const dow = grab('EcoGainsSim_v4.gs', /var SIM_DAY_ONE_DOW = (\d+)/);
  const dayOne = (src('EcoGainsSim_v4.gs').match(/SIM_DAY_ONE = '([\d-]+)'/) || [])[1];
  const realDow = dayOne ? ((new Date(dayOne + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1 : null;
  gate('SIM_DAY_ONE_DOW matches the real weekday of day 1',
       dow === realDow, `${dayOne} is weekday ${realDow}, constant says ${dow}`);
  const weekendDays = [];
  for (let d = 1; d <= 7; d++) if ((((dow - 1 + (d - 1)) % 7) + 1) >= 5) weekendDays.push(d);
  gate('weekend falls on three days of the first week', weekendDays.length === 3,
       `days ${weekendDays.join(',')} of the window are Fri/Sat/Sun`);
}

console.log('\n================ A. REPRODUCTION (33 days, switches restored) ================');
const legacyNew = run(NEW_ENGINE, '--legacy');
const legacyOld = run(OLD_ENGINE, '--legacy');
{
  const ka = Object.keys(legacyOld.cells), kb = Object.keys(legacyNew.cells);
  let worst = 0, worstKey = '';
  for (const k of new Set([...ka, ...kb])) {
    const a = legacyOld.cells[k] || [0, 0], b = legacyNew.cells[k] || [0, 0];
    for (let i = 0; i < 2; i++) {
      const rel = Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(a[i]), Math.abs(b[i]));
      if (rel > worst) { worst = rel; worstKey = `${k}[${i ? 'diff' : 'sim'}] ${a[i]} vs ${b[i]}`; }
    }
  }
  gate('cell count matches engine/pre_collection', ka.length === kb.length,
       `${ka.length} vs ${kb.length}`);
  gate('every cell identical to engine/pre_collection', worst === 0,
       worst === 0 ? `${kb.length} cells, max rel diff 0` : worstKey);
}

console.log('\n================ B. IDENTITY (_v2 := base, cal_new := cal_curr) ================');
const ident = run(NEW_ENGINE, '--identity');
{
  // With both calendars identical and no proposal authored, the only sources allowed to move are
  // the calendar-driven ones that have NO instances on that calendar: the engine zeroes those by
  // design (removal semantics), which is a schedule fact rather than a config difference. Every
  // other source — always-on, carried, and every scheduled event — must be exactly 0.
  const moved = Object.keys(ident.catDiff).filter(c => ident.catDiff[c] > 1e-9);
  const unscheduled = moved.filter(c => ident.catInstances[c] === 0);
  const shouldBeZero = moved.filter(c => ident.catInstances[c] !== 0);
  gate('no scheduled or always-on source moves when nothing is authored',
       shouldBeZero.length === 0,
       shouldBeZero.length ? shouldBeZero.map(c => `${c} ${ident.catDiff[c].toFixed(1)}`).join(', ')
                           : `${Object.keys(ident.cells).length} cells checked`);
  gate('the sources that do move are exactly the ones absent from the calendar',
       moved.length === unscheduled.length,
       moved.length ? moved.map(c => `${c} (${ident.catInstances[c]} instances)`).join(', ') : 'none');
  console.log('     note: those are zeroed by removal semantics, not by anything this stack changed — the same '
              + 'thing happens in the main stack when a source is dropped from cal_new.');
}

console.log('\n================ C. CONSERVATION ================');
const live = run(NEW_ENGINE);
gate('daily grids integrate to the window totals (rel tol 1e-9)', live.conservation < 1e-9,
     `max rel err ${live.conservation.toExponential(2)} over ${live.daily} days`);
gate('daily grid is SIM_DAYS long', live.daily === simDays, String(live.daily));

console.log('\n================ D. CONFIG REGISTRY ================');
{
  // The engine derives its auto-refresh watch list from CONFIG_PAIRED, and this harness derives
  // gate B's "blank the proposal layer" step from PAIRED. If those two drift, a newly added config
  // sheet would be neither refreshed on edit nor covered by the identity gate — silently.
  const eng = (live.paired || []).slice().sort();
  const harn = PAIRED.slice().sort();
  const missing = harn.filter(k => eng.indexOf(k) === -1);
  const extra = eng.filter(k => harn.indexOf(k) === -1);
  gate('engine CONFIG_PAIRED matches the harness list',
       missing.length === 0 && extra.length === 0,
       missing.length || extra.length
         ? `missing from engine: [${missing}] · not gated here: [${extra}]`
         : `${eng.length} paired config sheets`);
}

console.log('\n================ E. AUTHORING A _v2 MOVES THE SIM ================');
{
  // B proves the engine is SILENT when nothing is authored. On its own that is also what a broken
  // engine returning zeros would do, so E proves it is LOUD when something is: same identity setup,
  // one _v2 cell changed.
  const authored = run(NEW_ENGINE, '--identity', '--author');
  const gi = (o) => {
    const k = ['NONPAYER', '10-19', 'Daily Gift', 'HC'].join('|');
    return o.cells[k] ? o.cells[k] : [0, 0];
  };
  const before = gi(ident), after = gi(authored);
  gate('editing c_day_v2 changes the Daily Gift row', after[0] !== before[0],
       `sim ${before[0].toFixed(2)} -> ${after[0].toFixed(2)}`);
  gate('and its DIFF stops being zero', Math.abs(after[1]) > 1e-9,
       `diff ${after[1].toFixed(3)} (was ${before[1]})`);
  const others = Object.keys(authored.catDiff)
    .filter(c => c !== 'Daily Gift' && authored.catDiff[c] > 1e-9 && ident.catInstances[c] !== 0);
  gate('and nothing unrelated moves with it', others.length === 0,
       others.length ? others.join(', ') : 'only Daily Gift responded');
  // no restore needed: the edit lives only in the child process's copy of the mock data
}

console.log('\n================ F. RAINBOW MAKER (ANCHORED — config moves it, cadence does not) ================');
{
  // The anchored RM path (2026-08-18): SIM = measured x R over ONE schedule (cal_curr) for both
  // sides. Three properties, each its own gate: silent when the _v2 ladders are clones; loud when
  // an RM_1st_v2 rung is edited; and INDIFFERENT to cal_new cadence edits (T pinned) — the exact
  // behaviour Garry asked for ("simulate the changes with T the same, don't read cal_new").
  const rmKeys = (o) => Object.keys(o.cells).filter((k) => k.indexOf('|Rainbow Maker|') !== -1);
  const lane = run(NEW_ENGINE, '--identity', '--rm-lane');
  gate('anchored RM is silent when no RM _v2 is authored',
       (lane.catDiff['Rainbow Maker'] || 0) <= 1e-9,
       `max |diff| ${(lane.catDiff['Rainbow Maker'] || 0).toExponential(1)} with the lane on both calendars`);
  const rmA = run(NEW_ENGINE, '--identity', '--rm-lane', '--author-rm');
  const hcMoved = rmKeys(rmA).filter((k) => k.slice(-3) === '|HC' && Math.abs(rmA.cells[k][1]) > 1e-9);
  gate('editing an RM_1st_v2 coin rung moves the RM HC row', hcMoved.length > 0,
       hcMoved.length ? `${hcMoved.length} (payer,seg) cells moved, e.g. ${hcMoved[0]} diff ${rmA.cells[hcMoved[0]][1].toFixed(3)}`
                      : 'no RM HC diff responded');
  const othersF = Object.keys(rmA.catDiff)
    .filter((c) => c !== 'Rainbow Maker' && rmA.catDiff[c] > 1e-9 && rmA.catInstances[c] !== 0);
  gate('nothing unrelated moves with it', othersF.length === 0,
       othersF.length ? othersF.join(', ') : 'only Rainbow Maker responded');
  const rmT = run(NEW_ENGINE, '--identity', '--rm-lane', '--author-rm', '--rm-thin');
  let worstT = 0, worstTK = '';
  for (const k of new Set([...rmKeys(rmA), ...rmKeys(rmT)])) {
    const a = rmA.cells[k] || [0, 0], b = rmT.cells[k] || [0, 0];
    for (let i = 0; i < 2; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > worstT) { worstT = d; worstTK = `${k}[${i ? 'diff' : 'sim'}] ${a[i]} vs ${b[i]}`; }
    }
  }
  gate('a cal_new cadence edit does NOT move the anchored RM row (T pinned)', worstT < 1e-9,
       worstT < 1e-9 ? 'RM row identical after deleting a cal_new RM instance' : worstTK);
}

console.log('\n================ G. HC PER LEVEL WIN (HCPerWin.gs) ================');
{
  // Standalone script, standalone constants — the same Apps Script load-order reality that
  // forces SIM_DAYS/DAILY_DAYS/PBP_DAYS to be declared thrice. Gate the copies, then smoke the
  // function end to end on the mock workbook.
  const hDays = grab('HCPerWin.gs', /var HCW_DAYS = (\d+)/);
  const hDow = grab('HCPerWin.gs', /var HCW_DAY_ONE_DOW = (\d+)/);
  const engDow = grab('EcoGainsSim_v4.gs', /var SIM_DAY_ONE_DOW = (\d+)/);
  gate('HCW_DAYS / HCW_DAY_ONE_DOW match the engine window',
       hDays === simDays && hDow === engDow,
       `HCW_DAYS ${hDays} (SIM_DAYS ${simDays}) · HCW_DAY_ONE_DOW ${hDow} (engine ${engDow})`);
  const t = live.hcw || [];
  const numOk = (i) => [2, 3, 4, 5].every((c) => typeof t[i][c] === 'number' && isFinite(t[i][c]));
  const ok = t.length === 3 && t[0].length === 6 && t[1][0] === 'NONPAYER' && t[2][0] === 'PAYER'
             && numOk(1) && numOk(2) && t[1][3] > 0 && t[2][3] > 0 && t[1][4] >= 0 && t[2][4] >= 0;
  gate('ECOGAINS_HC_PER_WIN("10-19") returns finite per-win rates for both payer rows', ok,
       ok ? `NONPAYER gain/win ${t[1][3]} spend/win ${t[1][4]} · PAYER gain/win ${t[2][3]} spend/win ${t[2][4]}`
          : JSON.stringify(t).slice(0, 220));
}

console.log(failures ? `\n${failures} GATE FAILURE(S)` : '\nALL GATES PASSED');
process.exit(failures ? 1 : 0);
