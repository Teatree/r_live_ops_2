// One-off diagnostic for workbook (13): Season Pass tier-coupling internals per segment.
// Reuses the _mock_run.js mock environment. Delete after the investigation.
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
const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+'];

const base = readSPTrack_('SP');
const v2Name = spV2Sheet_('SP');
const v2 = (v2Name === 'SP') ? base : readSPTrack_(v2Name);
const daysBase = readSPSeasonDays_('SP') || 33;
const daysV2 = (v2Name !== 'SP' && readSPSeasonDays_(v2Name)) || daysBase;
console.log(`SP_v2 sheet in use: ${v2Name} | seasonDays base=${daysBase} v2=${daysV2}`);
console.log(`SP_lb_v2 in use: ${spV2Sheet_('SP_lb')}`);
const Rlb = spChallengeR_();
console.log('R_challenge per resource:', JSON.stringify(Rlb));
console.log(`base track tiers: ${base.cum.length}, cum[0..4]=${base.cum.slice(0, 5)} ... cum[29]=${base.cum[29]}`);
console.log(`v2   track tiers: ${v2.cum.length}, cum[0..4]=${v2.cum.slice(0, 5)} ... cum[29]=${v2.cum[29]}`);

for (const payer of ['NONPAYER', 'PAYER']) {
  for (const seg of SEGS) {
    const ctx = Context.get();
    const t = sptTotals_(seg, payer, ctx);
    const Tm = spTier_(t.meas * daysBase / 33, base.cum);
    const Ts = spTier_(t.sim * daysV2 / 33, v2.cum);
    const cb = spCumTo_(base, Tm, payer), cs = spCumTo_(v2, Ts, payer);
    const T = timingRatio_(ctx.calCur['Season Pass'] || [], ctx.calNew['Season Pass'] || [], seg, payer, ctx.ds);
    console.log(`\n===== ${seg} ${payer} =====`);
    console.log(`SPT totals: meas ${fmt(t.meas)} -> sim ${fmt(t.sim)} | points meas ${fmt(t.meas * daysBase / 33)} sim ${fmt(t.sim * daysV2 / 33)} | tier ${Tm} -> ${Ts} | T_cal ${fmt(T)}`);
    // per-category SPT contributions
    const rows = [];
    CATEGORY_ORDER.forEach(function (cat) {
      const mSPT = ctx.ds.gains(seg, payer, cat, 'SPT'), mX2 = ctx.ds.gains(seg, payer, cat, 'SPTx2');
      let sSPT = mSPT, sX2 = mX2;
      if (cat !== 'Season Pass (Free)') {
        const row = resultRow_(cat, seg, payer, ctx);
        sSPT = num(row['SPT']); sX2 = num(row['SPTx2']);
      }
      const m = mSPT + 2 * mX2, s = sSPT + 2 * sX2;
      if (m > 0.005 || s > 0.005) rows.push(`  ${cat.padEnd(22)} meas ${fmt(m).padStart(8)} -> sim ${fmt(s).padStart(8)}  (SPT ${fmt(sSPT)}, x2 ${fmt(sX2)})`);
    });
    console.log(rows.join('\n'));
    // engine row vs correct v2 identity
    const spRow = resultRow_('Season Pass (Free)', seg, payer, ctx);
    const measRow = measuredRow_('Season Pass (Free)', seg, payer, ctx.ds);
    let maxE = 0; const moved = [];
    RESOURCES.forEach(function (r) {
      const m = num(measRow[r]);
      let expected;
      if (m > 0 && num(cb[r]) > 0) expected = m * (num(cs[r]) / num(cb[r])) * ((Rlb[r] != null) ? Rlb[r] : 1) * T;
      else if (Ts > Tm) {
        let add = 0;
        for (let i = Tm; i < Ts; i++) {
          add += num(v2.free[i] && v2.free[i][r]);
          if (payer === 'PAYER') add += num(v2.paid[i] && v2.paid[i][r]);
        }
        expected = m + add;
      } else expected = m;
      maxE = Math.max(maxE, Math.abs(num(spRow[r]) - expected));
      if (Math.abs(num(spRow[r]) - m) > 0.005) moved.push(`${r}: ${fmt(m)} -> ${fmt(num(spRow[r]))}`);
    });
    console.log(`  SP row vs v2-identity max err: ${maxE.toExponential(2)} | moved: ${moved.join(' · ') || '(none)'}`);
  }
}
