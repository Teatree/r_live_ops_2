// Offline harness for EcoGainsSim_v4.gs: mock SpreadsheetApp over _mockdata.json (dumped from
// the live workbook), run the engine end-to-end, print per-source results + release-gate checks.
const fs = require('fs');
const path = require('path');
const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_mockdata.json'), 'utf8'));

function mkRange(sheetName, r1, c1, nr, nc) {
  const sh = data[sheetName];
  return {
    getValues: () => {
      const out = [];
      for (let r = r1; r < r1 + nr; r++) {
        const row = [];
        for (let c = c1; c < c1 + nc; c++) {
          row.push((sh.values[r - 1] && sh.values[r - 1][c - 1] !== undefined) ? sh.values[r - 1][c - 1] : '');
        }
        out.push(row);
      }
      return out;
    },
    getMergedRanges: () => (sh.merges || [])
      .filter(m => m.r >= r1 && m.r + m.nr - 1 <= r1 + nr - 1 && m.c >= c1 && m.c + m.nc - 1 <= c1 + nc - 1)
      .map(m => ({
        getRow: () => m.r, getColumn: () => m.c,
        getNumRows: () => m.nr, getNumColumns: () => m.nc,
      })),
    getValue: () => {
      const row = sh.values[r1 - 1] || [];
      return row[c1 - 1] !== undefined ? row[c1 - 1] : '';
    },
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

eval(fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8'));

const fmt = (x) => (Math.round(x * 100) / 100).toFixed(2);
const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+', 'A. 0'];

for (const payer of ['NONPAYER']) {
  for (const seg of SEGS) {
    console.log(`\n===== ${seg} ${payer} =====`);
    const sim = ECOGAINS_SIM(payer, seg);
    const diff = ECOGAINS_DIFF(payer, seg);
    console.log('spill:', sim.length, 'x', sim[0].length);
    CATEGORY_ORDER.forEach((cat, i) => {
      const line = cat.padEnd(22) +
        ' simHC=' + fmt(sim[i][0]).padStart(9) +
        ' diffHC=' + fmt(diff[i][0]).padStart(9) +
        ' | ULL sim=' + fmt(sim[i][10]).padStart(8);
      console.log(line);
    });
  }
}

// ---------- release-gate internals (§5) ----------
console.log('\n================ GATES ================');
const ctx = Context.get();
const ds = ctx.ds;
function T(calLabel, seg) { return timingRatio_(ctx.calCur[calLabel] || [], ctx.calNew[calLabel] || [], seg, 'NONPAYER', ds); }
console.log('T Bomb   (0-9):', fmt(T("Bomb's Challenge", '0-9')), ' [~0.84]');
console.log('T Chuck  (0-9):', fmt(T("Chuck's Challenge", '0-9')), ' [~0.67]');
console.log('T Red    (0-9):', fmt(T("Red's Challenge", '0-9')), ' [~1.26]');
console.log('T Level  (0-9):', fmt(T('Level Race', '0-9')), ' [~0.84]');
console.log('T Flash  (0-9):', fmt(T('Flash Race', '0-9')), ' [~0.99]');
console.log('T TaD    (0-9):', fmt(T('Target Day', '0-9')), ' [~1.99]');
console.log('T HH     (0-9):', fmt(T('Hatchling Hideaway', '0-9')), ' [~1.13]');
console.log('T Kite   (0-9):', fmt(T('Kite Festival', '0-9')));
console.log('D Kite 7->3 (0-9):', fmt(accrualD_(ds, 'Kite Festival', 7, 3, '0-9', 'NONPAYER', true)), ' [~0.315]');
console.log('D Kite 7->3 (100+):', fmt(accrualD_(ds, 'Kite Festival', 7, 3, '100+', 'NONPAYER', true)), ' [~0.70]');
console.log('D BB 4->3  (0-9):', fmt(accrualD_(ds, 'Bombs Ballet', 4, 3, '0-9', 'NONPAYER', false)), ' [~0.94]');
console.log('D Jig 4->3 (0-9):', fmt(accrualD_(ds, 'Jigsaw', 4, 3, '0-9', 'NONPAYER', false)), ' [~0.856]');
console.log('D Ph 4->3  (0-9):', fmt(accrualD_(ds, 'Photoshoot', 4, 3, '0-9', 'NONPAYER', false)), ' [~0.905]');
console.log('D HH 3->4  (0-9):', fmt(accrualD_(ds, 'Hatchling Hideaway', 3, 4, '0-9', 'NONPAYER', false)), ' [~1.0]');
console.log('saga ratio:', fmt(sagaRatio_('0-9')), ' [0.357]');
console.log('dailyGift R (0-9 NP):', fmt(dailyGiftRatio_(ds.beh('0-9', 'NONPAYER'))));

// conservation: measured Core+Saga vs HAND_OFF old Core
for (const seg of ['0-9', '100+']) {
  const c = ds.dataRow('Core', seg, 'NONPAYER'), s = ds.dataRow('Saga', seg, 'NONPAYER');
  console.log(`conservation ${seg}: Core ${fmt(c.HC)} + Saga ${fmt(s.HC)} = ${fmt(c.HC + s.HC)}`);
}
// NS conservative bound (S=0 beyond p90): recompute with capped survival
function nsBound(seg, payer) {
  const b = ds.beh(seg, payer);
  const S = survival_([[num(b.daily_max_streak_p50), .5], [num(b.daily_max_streak_p75), .75], [num(b.daily_max_streak_p90), .9]]);
  const ladder = readNSLadder_(seg);
  let e = 0;
  ladder.forEach(ms => { const s = ms.req > num(b.daily_max_streak_p90) ? 0 : S(ms.req); e += (ms.rew.HC || 0) * s; });
  const days = reachSum_(ctx.calNew['Night Sky'] || [], num(b.weekday_active_rate), num(b.weekend_active_rate));
  return e * days;
}
console.log('NS conservative bound HC (0-9):', fmt(nsBound('0-9', 'NONPAYER')));
console.log('NS conservative bound HC (100+):', fmt(nsBound('100+', 'NONPAYER')));
// RM conservative bound
function rmBound(seg, payer) {
  const pct = ds.rmPct(seg, payer), ladder = readRMLadder_(), b = ds.beh(seg, payer);
  let out = 0;
  (ctx.calNew['Rainbow Maker'] || []).forEach(inst => {
    const scale = Math.min(1, inst.dur / 4);
    const S = survival_([[pct.p10 * scale, .10], [pct.p25 * scale, .25], [pct.p50 * scale, .50], [pct.p75 * scale, .75], [pct.p90 * scale, .90]]);
    const reach = reachOne_(inst, num(b.weekday_active_rate), num(b.weekend_active_rate));
    ladder.forEach(ms => { const s = ms.req > pct.p90 * scale ? 0 : S(ms.req); out += (ms.rew.HC || 0) * s * reach; });
  });
  return out;
}
console.log('RM conservative bound HC (0-9):', fmt(rmBound('0-9', 'NONPAYER')));
console.log('RM conservative bound HC (100+):', fmt(rmBound('100+', 'NONPAYER')));
