// Traces the card sim's pack model back to the MEASURED inputs, one source at a time, so the chain
// from data_* telemetry to a discrete grant is inspectable rather than asserted.
const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_mdc2.json'), 'utf8'));

function mkRange(n, r1, c1, nr, nc) {
  const sh = data[n];
  return {
    getValues: () => {
      const o = [];
      for (let r = r1; r < r1 + nr; r++) {
        const row = [];
        for (let c = c1; c < c1 + nc; c++)
          row.push((sh.values[r - 1] && sh.values[r - 1][c - 1] !== undefined) ? sh.values[r - 1][c - 1] : '');
        o.push(row);
      }
      return o;
    },
    getMergedRanges: () => (sh.merges || [])
      .filter(m => m.r >= r1 && m.r + m.nr - 1 <= r1 + nr - 1 && m.c >= c1 && m.c + m.nc - 1 <= c1 + nc - 1)
      .map(m => ({ getRow: () => m.r, getColumn: () => m.c, getNumRows: () => m.nr, getNumColumns: () => m.nc })),
    getValue: () => { const row = sh.values[r1 - 1] || []; return row[c1 - 1] !== undefined ? row[c1 - 1] : ''; },
  };
}
function mkSheet(n) {
  const sh = data[n];
  if (!sh) return null;
  return {
    getDataRange: () => mkRange(n, 1, 1, sh.values.length, sh.values[0] ? sh.values[0].length : 0),
    getLastRow: () => sh.values.length,
    getRange: (a, b, c, d) => {
      if (typeof a === 'string') {
        const m = a.match(/^([A-Z]+)(\d+)$/);
        const col = m[1].split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);
        return mkRange(n, +m[2], col, 1, 1);
      }
      return mkRange(n, a, b, c || 1, d || 1);
    },
  };
}
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: (n) => mkSheet(n) }) };
global.Logger = { log: () => {} };
eval(fs.readFileSync(path.join(__dirname, '..', 'engine', 'EcoGainsSim_v4.gs'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'engine', 'EcoGainsSim_Daily.gs'), 'utf8'));

const SEG = process.env.SEG || '40-99';
const P = 'NONPAYER';
const ctx = Context.get();
const beh = ctx.ds.beh(SEG, P);

console.log('WINDOW: DAILY_DAYS = ' + DAILY_DAYS + '  (cal_curr vs cal_new, no sub-window)');
console.log('');
console.log('MEASURED INPUTS for ' + SEG + ' ' + P + ', straight from the data_* sheets:');
console.log('  data_seg_beh  weekday_active_rate      ' + num(beh.weekday_active_rate).toFixed(4));
console.log('  data_seg_beh  weekend_active_rate      ' + num(beh.weekend_active_rate).toFixed(4));
console.log('  data_seg_beh  levels_completed/act.day ' + num(beh.levels_completed_per_active_day).toFixed(1));
console.log('');

['Hatchling Hideaway', 'Target Day', 'Rainbow Maker'].forEach((cat) => {
  const label = DAILY_CAL_LABEL[cat];
  const insts = (ctx.calNew[label] || []).slice().sort((a, b) => a.start - b.start);
  const rr = packRungs_(cat, SEG, P, ctx, 0);
  console.log('=== ' + cat + ' ===');
  if (!rr) { console.log('  no rung structure (not priced)'); console.log(''); return; }
  const spec = LB_R_SPECS[cat] || COLL_R_SPECS[cat];
  const inst = spec ? ctx.ds.eventInst(spec.inst, SEG, P) : null;
  console.log('  cal_new instances: ' + insts.map(i => 'd' + i.start + 'x' + i.dur).join(' '));
  console.log('  participation_rate (data_event_inst): ' +
    (inst ? num(inst.participation_rate).toFixed(4) : 'none, priced at 1.0'));
  if (inst && num(inst.final_balance_p50) > 0)
    console.log('  final_balance p25/p50/p75 (data_event_inst): ' +
      [inst.final_balance_p25, inst.final_balance_p50, inst.final_balance_p75].join(' / '));
  if (inst && num(inst.position_p50) > 0)
    console.log('  finishing position p25/p50/p75 (data_event_inst): ' +
      [inst.position_p25, inst.position_p50, inst.position_p75].join(' / '));
  if (cat === 'Rainbow Maker') {
    const pct = ctx.ds.rmPct(SEG, P);
    console.log('  matchables p10/p50/p90 (data_RM): ' + [pct.p10, pct.p50, pct.p90].join(' / '));
  }
  insts.forEach((i2, k) => {
    const reach = reachOne_(i2, num(beh.weekday_active_rate), num(beh.weekend_active_rate));
    if (k === 0) console.log('  reach(inst 1) = 1 - PROD(1 - p_day) over days ' +
      i2.days.join(',') + ' = ' + reach.toFixed(4));
  });
  rr.groups.forEach((g, gi) => {
    console.log('  group ' + (gi + 1) + (g.exclusive ? '  EXCLUSIVE (one outcome)' : '  independent rungs'));
    g.rungs.slice(0, 5).forEach(x => {
      console.log('     p=' + x.p.toFixed(4) + '  progress=' + (x.progress == null ? '-' : x.progress.toFixed(3)) +
        '  packs=' + JSON.stringify(x.packs) + '   ' + x.label);
    });
    if (g.rungs.length > 5) console.log('     ... ' + (g.rungs.length - 5) + ' more rungs');
  });
  console.log('');
});
