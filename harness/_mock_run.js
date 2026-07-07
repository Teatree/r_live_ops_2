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
// NS conservative bound (S=0 beyond p90 x N): recompute with capped survival, same source as
// the engine (data_streaks percentiles x NS_STREAK_N; NIGHT_SKY_REWIRE_PLAN Option A)
function nsBound(seg, payer) {
  const st = ds.nsStreak(seg, payer), b = ds.beh(seg, payer);
  const S = survival_([[st.p25 * NS_STREAK_N, .25], [st.p50 * NS_STREAK_N, .5],
                       [st.p75 * NS_STREAK_N, .75], [st.p90 * NS_STREAK_N, .9]]);
  const ladder = readNSLadder_(seg);
  let e = 0;
  ladder.forEach(ms => { const s = ms.req > st.p90 * NS_STREAK_N ? 0 : S(ms.req); e += (ms.rew.HC || 0) * s; });
  const days = reachSum_(ctx.calNew['Night Sky'] || [], num(b.weekday_active_rate), num(b.weekend_active_rate));
  return e * days;
}
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

// ---------- NS re-wire release gates (NIGHT_SKY_REWIRE_PLAN §5 + NS_SIMULATE switch) ----------
console.log('\n================ NS GATES ================');
let failures = 0;
const gate = (name, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
  if (!ok) failures++;
};
const engineSrc = fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8');
const engineSrcNsOn = engineSrc.replace('var NS_SIMULATE = false', 'var NS_SIMULATE = true');
const NS_I = CATEGORY_ORDER.indexOf('Daily Night Sky Prize');
const SEG5 = ['0-9', '10-19', '20-39', '40-99', '100+'];
// default state: NS_SIMULATE = false -> NS carried (= measured, diff 0) everywhere
gate('NS_SIMULATE default OFF -> NS carried (diff 0) for every segment',
     NS_SIMULATE === false && SEG5.every(s => Math.abs(ECOGAINS_DIFF('NONPAYER', s)[NS_I][0]) < 1e-9));
// flip the switch on and gate the model itself
eval(engineSrcNsOn);
const nsHC = {}, nsEday = {};
for (const seg of SEG5) {
  nsHC[seg] = ECOGAINS_SIM('NONPAYER', seg)[NS_I][0];
  const st = ds.nsStreak(seg, 'NONPAYER');
  const S = survival_([[st.p25 * NS_STREAK_N, .25], [st.p50 * NS_STREAK_N, .5],
                       [st.p75 * NS_STREAK_N, .75], [st.p90 * NS_STREAK_N, .9]]);
  let e = 0; readNSLadder_(seg).forEach(ms => { e += (ms.rew.HC || 0) * S(ms.req); });
  nsEday[seg] = e;
  console.log(`NS ${seg.padEnd(6)} NONPAYER: simHC=${fmt(nsHC[seg]).padStart(8)}  E_day=${fmt(e).padStart(7)}  conservative(S=0>p90xN)=${fmt(nsBound(seg, 'NONPAYER')).padStart(8)}  measured(diluted)=${fmt(ds.dataRow('Daily Night Sky Prize', seg, 'NONPAYER').HC).padStart(8)}`);
}
gate('NS simulated HC nonzero for every segment', SEG5.every(s => nsHC[s] > 0), JSON.stringify(nsHC));
// monotonicity is asserted on E_day (the model quantity): window totals also fold in the
// cohort's Σ p_day active-day factor, which the data says is NOT monotone (100+ plays fewer
// days than 40-99), so the 100+ TOTAL legitimately lands below 40-99.
gate('NS E_day (HC per active day) monotonic in segment', SEG5.every((s, i) => i === 0 || nsEday[s] > nsEday[SEG5[i - 1]]),
     SEG5.map(s => fmt(nsEday[s])).join(' < '));
gate('NS carried for A. 0 (appendix, no streak data)',
     Math.abs(ECOGAINS_DIFF('NONPAYER', 'A. 0')[NS_I][0]) < 1e-9);
eval(engineSrc);   // back to the shipped default (NS_SIMULATE = false) for the R gates

// ---------- R-term gates (reward-config ratio v2/base, added 2026-07-06) ----------
// Mutate _v2 rewards/requirements in the in-memory mock data, re-eval the engine (fresh
// Context/DataStore caches), and assert the sim responds. Restores after each test.
console.log('\n================ R GATES ================');
const idx = (cat) => CATEGORY_ORDER.indexOf(cat);
const baseline = ECOGAINS_SIM('NONPAYER', '40-99');

// today (v2 rewards untouched) every R must be exactly 1
{
  let worst = 1;
  for (const cat of Object.keys(LB_R_SPECS).concat(Object.keys(COLL_R_SPECS))) {
    const R = rewardR_(cat, '40-99', 'NONPAYER', ds);
    if (R) for (const res in R) if (Math.abs(R[res] - 1) > Math.abs(worst - 1)) worst = R[res];
  }
  gate('R == 1 for every event with untouched v2 configs', Math.abs(worst - 1) < 1e-9, 'worst ' + worst);
}
// Kite re-classification: leaderboard semantics, sim == measured x T exactly (D pinned 1, R=1)
{
  const c2 = Context.get();
  const measK = num(measuredRow_('Kite Festival', '40-99', 'NONPAYER', c2.ds)['HC']);
  const tK = timingRatio_(c2.calCur['Kite Festival'] || [], c2.calNew['Kite Festival'] || [], '40-99', 'NONPAYER', c2.ds);
  gate('Kite = measured x T (zero-sum rank payouts; canary now GROWS)',
       Math.abs(baseline[idx('Kite Festival')][0] - measK * tK) < 1e-9,
       `sim ${baseline[idx('Kite Festival')][0].toFixed(2)} vs ${(measK * tK).toFixed(2)} (T=${tK.toFixed(2)})`);
}
// Reset the engine's per-execution sheetVals_ cache. In real Sheets every recalc is a fresh
// execution (empty cache); this harness fakes several "executions" in one process, so we clear the
// module-level cache by hand. Defined at module scope so it targets the SAME binding the engine's
// module-level sheetVals_ closes over (not a local shadow from the eval() inside mutate()).
const resetSheetCache = () => { try { _sheetValsCache = {}; } catch (e) {} };
// helper: run fn with a mutation applied, caches reset before AND after (so mutated config is read)
const mutate = (sheet, cells, factorOrValue, fn) => {
  const saved = cells.map(([r, c]) => data[sheet].values[r][c]);
  cells.forEach(([r, c]) => {
    const old = +data[sheet].values[r][c] || 0;
    data[sheet].values[r][c] = (typeof factorOrValue === 'function') ? factorOrValue(old) : factorOrValue;
  });
  eval(engineSrc); resetSheetCache();
  const out = fn();
  cells.forEach(([r, c], i) => { data[sheet].values[r][c] = saved[i]; });
  eval(engineSrc); resetSheetCache();
  return out;
};
const range = (r0, r1, c) => Array.from({length: r1 - r0 + 1}, (_, i) => [r0 + i, c]);

// 1. LB reward edit: double every TaD_v2 ladder Coins cell -> Target Day HC exactly x2
{
  const hc = mutate('TaD_v2', range(35, 54, 2), (v) => v * 2,
                    () => ECOGAINS_SIM('NONPAYER', '40-99')[idx('Target Day')][0]);
  gate('TaD_v2 Coins x2 -> Target Day HC x2', Math.abs(hc - 2 * baseline[idx('Target Day')][0]) < 1e-9,
       `${hc.toFixed(2)} vs 2x${baseline[idx('Target Day')][0].toFixed(2)}`);
}
// 2. collection reward edit: halve every J_v2 milestone Coins cell -> Jigsaw HC exactly x0.5
{
  const hc = mutate('J_v2', range(10, 21, 2), (v) => v / 2,
                    () => ECOGAINS_SIM('NONPAYER', '40-99')[idx('Jigsaw')][0]);
  gate('J_v2 Coins x0.5 -> Jigsaw HC x0.5', Math.abs(hc - 0.5 * baseline[idx('Jigsaw')][0]) < 1e-9,
       `${hc.toFixed(2)} vs 0.5x${baseline[idx('Jigsaw')][0].toFixed(2)}`);
}
// 3. collection REQUIREMENT edit: J_v2 reqs x10 -> fewer players reach -> Jigsaw HC drops
{
  const hc = mutate('J_v2', range(10, 21, 1), (v) => v * 10,
                    () => ECOGAINS_SIM('NONPAYER', '40-99')[idx('Jigsaw')][0]);
  gate('J_v2 reqs x10 -> Jigsaw HC drops (requirement edits flow)',
       hc < baseline[idx('Jigsaw')][0] * 0.7, `${hc.toFixed(2)} vs ${baseline[idx('Jigsaw')][0].toFixed(2)}`);
}
// 4. zero-out: Race_v2 Red block Coins = 0 -> Red Challenge HC -> 0 (other resources intact)
{
  const row = mutate('Race_v2', range(9, 18, 1), 0,
                     () => ECOGAINS_SIM('NONPAYER', '40-99')[idx('Red Challenge')]);
  gate('Race_v2 Red Coins = 0 -> Red Challenge HC 0', Math.abs(row[0]) < 1e-9, 'HC ' + row[0]);
}
// 5. restore clean: baseline reproduces after all mutations reverted
{
  const again = ECOGAINS_SIM('NONPAYER', '40-99');
  const same = CATEGORY_ORDER.every((c, i) => RESOURCES.every((r, j) => Math.abs(again[i][j] - baseline[i][j]) < 1e-12));
  gate('mutations fully restored (baseline reproduces)', same);
}
console.log(failures ? `\n${failures} GATE FAILURE(S)` : '\nALL GATES PASSED');
process.exit(failures ? 1 : 0);
