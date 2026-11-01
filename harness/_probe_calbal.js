// Calendar-rebalance probe (2026-10-30). Not a gate - the measurement tool behind the cal_new
// rebalance configs (builders/_design_calbal.py -> builders/_build_calbal.py). Runs the engine
// over a dump (default v3h = LIVE_OPS_V3 (8) as re-exported 12:37), optionally with a patch set on
// the _v2 sheets, and reports per cell x category x resource the SIM and MEASURED rows, plus the
// calendar instances per lane. No card sim (the rebalance does not touch album / pack configs).
//
//   node harness/_probe_calbal.js [--data v3h] [--patches f.json] [--calcur] [--out f.json] [--quiet]
//   --calcur: cal_new := cal_curr (the "before the calendar change" reference)
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', path.join(__dirname, '_mockdata_v3h.json'));
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function PROBE(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const patchFile = arg('--patches', null), outFile = arg('--out', null);
  const quiet = process.argv.indexOf('--quiet') >= 0, calcur = process.argv.indexOf('--calcur') >= 0;
  const colNum = (s) => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
  let patchCount = 0;
  if (patchFile){
    const P = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
    Object.keys(P.patches || {}).forEach(sheet => {
      if (!data[sheet]) throw new Error('patch targets a sheet the dump does not have: ' + sheet);
      (P.patches[sheet] || []).forEach(e => {
        const m = /^([A-Z]+)(\d+)$/.exec(e.cell), c = colNum(m[1]), r = +m[2];
        const v = data[sheet].values;
        while (v.length < r) v.push([]);
        while (v[r - 1].length < c) v[r - 1].push('');
        v[r - 1][c - 1] = (e.new !== undefined) ? e.new : e.value;
        patchCount++;
      });
    });
  }
  // --copysheet DST=SRC[,DST2=SRC2]: replace a sheet by a copy of another before the run (e.g. ToF_v2=ToF to see how
  // much of a lane's difference is its config and how much is the model)
  const cps = arg('--copysheet', '');
  cps.split(',').filter(Boolean).forEach(kv => { const [dst, src] = kv.split('='); if (!data[src]) throw new Error('no sheet ' + src);
    data[dst] = JSON.parse(JSON.stringify(data[src])); });
  if (calcur){
    // cal_new := cal_curr, cal_parsed's cal_new rows := its cal_curr rows
    data['cal_new'] = JSON.parse(JSON.stringify(data['cal_curr']));
    const cp = data['cal_parsed'];
    if (cp){
      const h = cp.values[0].map(x => String(x).trim()), ci = h.indexOf('calendar');
      if (ci >= 0){
        const keep = cp.values.filter((r, i) => i === 0 || String(r[ci]) !== 'cal_new');
        const add = cp.values.filter((r, i) => i > 0 && String(r[ci]) === 'cal_curr').map(r => { const x = r.slice(); x[ci] = 'cal_new'; return x; });
        cp.values = keep.concat(add);
      }
    }
  }
  resetSheetCache_mock();
  if (typeof Context !== 'undefined' && Context.reset) Context.reset();
  const ctx = Context.get(), W = windowDays_();
  const cells = cloudPermutations_();
  const res = { meta: { data: data._meta, patches: patchFile, patchCount, window: W, calcur }, cal: {}, cells: {} };
  // calendar instances per lane, window days
  ['calCur', 'calNew'].forEach(k => {
    res.cal[k] = {};
    Object.keys(ctx[k] || {}).forEach(lane => {
      res.cal[k][lane] = (ctx[k][lane] || []).map(x => ({ s: x.start, d: x.dur, v: x.variant || '', cs: x.clipStart, ce: x.clipEnd, fd: x.fullDur }));
    });
  });
  cells.forEach(cell => {
    const out = { sim: {}, meas: {} };
    CATEGORY_ORDER.forEach(cat => {
      out.sim[cat] = resultRow_(cat, cell.seg, cell.payer, ctx);
      out.meas[cat] = measuredRow_(cat, cell.seg, cell.payer, ctx.ds);
    });
    const b = ctx.ds.beh(cell.seg, cell.payer);
    out.pop = Number(b.unique_players) || 0;
    res.cells[cell.label] = out;
  });
  if (!quiet){
    console.log('window ' + W + ' days, patches ' + patchCount + (calcur ? ', cal_new := cal_curr' : ''));
    const lanes = Array.from(new Set(Object.keys(res.cal.calCur).concat(Object.keys(res.cal.calNew)))).sort();
    lanes.forEach(l => {
      const f = (xs) => (xs || []).filter(x => x.s >= 1 || (x.s + x.d - 1) >= 1).map(x => x.s + 'x' + x.d + (x.v ? '(' + x.v + ')' : '')).join(' ');
      console.log(l.padEnd(26) + ' CUR ' + f(res.cal.calCur[l]));
      console.log(''.padEnd(26) + ' NEW ' + f(res.cal.calNew[l]));
    });
  }
  if (outFile){ fs.writeFileSync(outFile, JSON.stringify(res)); console.log('written ' + outFile); }
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
