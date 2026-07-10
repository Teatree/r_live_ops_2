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
        ' | ULL sim=' + fmt(sim[i][10]).padStart(8) +
        ' | SPT sim=' + fmt(sim[i][11]).padStart(8) +
        ' diff=' + fmt(diff[i][11]).padStart(8);
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

// R must be exactly 1 wherever the v2 config region is IDENTICAL to base (untouched pair).
// Since workbook (8) real _v2 edits exist (TaD_v2, Ki_v2 …), so touched pairs are excluded from
// the assertion and REPORTED instead — the R term flowing for them is the feature working.
{
  const regionEq = (spec) => {
    const sub = (sheet, hdr, r0, r1, c0, c1) => {
      const rows = [hdr].concat(Array.from({ length: r1 - r0 + 1 }, (_, i) => r0 + i));
      return rows.map(r => ((data[sheet].values[r - 1]) || []).slice(c0 - 1, c1));
    };
    let eq = JSON.stringify(sub(spec.base, spec.hdr, spec.r0, spec.r1, spec.c0, spec.c1)) ===
             JSON.stringify(sub(spec.v2,   spec.hdr, spec.r0, spec.r1, spec.c0, spec.c1));
    if (eq && spec.ms)                                     // Kite score-milestone rows too
      eq = JSON.stringify(sub(spec.base, spec.ms.hdr, spec.ms.r0, spec.ms.r1, spec.ms.c0, spec.ms.c1)) ===
           JSON.stringify(sub(spec.v2,   spec.ms.hdr, spec.ms.r0, spec.ms.r1, spec.ms.c0, spec.ms.c1));
    return eq;
  };
  let worst = 1; const edited = [];
  for (const cat of Object.keys(LB_R_SPECS).concat(Object.keys(COLL_R_SPECS))) {
    const spec = LB_R_SPECS[cat] || COLL_R_SPECS[cat];
    const R = rewardR_(cat, '40-99', 'NONPAYER', ds);
    if (!regionEq(spec)) {
      if (R) {
        const off = Object.keys(R).filter(r => Math.abs(R[r] - 1) > 1e-9)
          .reduce((o, k) => (o[k] = +R[k].toFixed(3), o), {});
        edited.push(cat + ' ' + JSON.stringify(off));
      }
      continue;
    }
    if (R) for (const res in R) if (Math.abs(R[res] - 1) > Math.abs(worst - 1)) worst = R[res];
  }
  if (edited.length) console.log('  v2 config edits present in the workbook: ' + edited.join(' · '));
  gate('R == 1 for every event whose v2 config matches base', Math.abs(worst - 1) < 1e-9, 'worst ' + worst);
}
// Kite re-classification: leaderboard semantics, sim == measured x R x T exactly (D pinned 1).
// Canary: sim must DIFFER from measured — if every timed event equals measured, the calendar
// parse fail-safe engaged (run Precompute). R folds in any real Ki_v2 edits (workbook 8: 0.833).
{
  const c2 = Context.get();
  const measK = num(measuredRow_('Kite Festival', '40-99', 'NONPAYER', c2.ds)['HC']);
  const tK = timingRatio_(c2.calCur['Kite Festival'] || [], c2.calNew['Kite Festival'] || [], '40-99', 'NONPAYER', c2.ds);
  const RK = rewardR_('Kite Festival', '40-99', 'NONPAYER', c2.ds);
  const rK = (RK && RK['HC'] != null) ? RK['HC'] : 1;
  gate('Kite = measured x R x T (zero-sum rank payouts; canary: differs from measured)',
       Math.abs(baseline[idx('Kite Festival')][0] - measK * rK * tK) < 1e-9 &&
       Math.abs(measK * rK * tK - measK) > 1e-6,
       `sim ${baseline[idx('Kite Festival')][0].toFixed(2)} vs ${(measK * rK * tK).toFixed(2)} (R=${rK.toFixed(3)}, T=${tK.toFixed(2)})`);
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

// ---------- SPT / Season Pass gates (D16, added 2026-07-10) ----------
// Data-aware by design: tiers/ratios are recomputed through the engine's own functions, never
// hardcoded (40-99 NONPAYER sits only ~1.65 pts above a tier edge — a re-pull could move it).
console.log('\n================ SPT GATES ================');
gate('spill width == 13 resources', baseline[0].length === RESOURCES.length && RESOURCES.length === 13,
     'got ' + baseline[0].length);

// SPT-1: SPT flows through the leaderboard machinery — Kite SPT == measured x R_SPT x T, with
// R_SPT != 1 from the real Ki_v2 SPT ladder cut (workbook 10: pot 2960 -> 1890). Canary: a
// "no change" SPT row here means SPT fell out of the R/T plumbing.
{
  const c2 = Context.get();
  const iSPT = RESOURCES.indexOf('SPT');
  const measK = num(measuredRow_('Kite Festival', '40-99', 'NONPAYER', c2.ds)['SPT']);
  const tK = timingRatio_(c2.calCur['Kite Festival'] || [], c2.calNew['Kite Festival'] || [], '40-99', 'NONPAYER', c2.ds);
  const RK = rewardR_('Kite Festival', '40-99', 'NONPAYER', c2.ds);
  const rK = (RK && RK['SPT'] != null) ? RK['SPT'] : 1;
  const simK = ECOGAINS_SIM('NONPAYER', '40-99')[idx('Kite Festival')][iSPT];
  gate('Kite SPT = measured x R_SPT x T (R_SPT != 1: real Ki_v2 SPT edits)',
       Math.abs(simK - measK * rK * tK) < 1e-9 && Math.abs(rK - 1) > 0.05 && Math.abs(simK - measK) > 1e-6,
       `sim ${simK.toFixed(2)} vs meas ${measK.toFixed(2)} (R_SPT=${rK.toFixed(3)}, T=${tK.toFixed(2)})`);
}

// SPT-2: Season Pass tier coupling with SP_v2 / SP_lb_v2 ABSENT (fallback path — the dump has
// no v2 sheets until the user duplicates them). Verifies the per-resource identity:
// anchored -> measured x cum(Ts)/cum(Tm) x T_cal; no anchor + no tier gain -> carried.
{
  const c2 = Context.get();
  gate('SP_v2/SP_lb_v2 absent -> engine falls back to base sheets',
       spV2Sheet_('SP') === 'SP' && spV2Sheet_('SP_lb') === 'SP_lb');
  const t = sptTotals_('40-99', 'NONPAYER', c2);
  gate('SPT totals: simulated < measured (RR removal + Ki_v2 cut + T factors)',
       t.meas > 100 && t.sim < t.meas - 50, `meas ${t.meas.toFixed(2)} sim ${t.sim.toFixed(2)}`);
  const track = readSPTrack_('SP');
  const Tm = spTier_(t.meas, track.cum), Ts = spTier_(t.sim, track.cum);   // seasonDays=33 default
  gate('tier reached drops with the SPT loss (Ts < Tm)', Tm > 0 && Ts < Tm, `Tm ${Tm} -> Ts ${Ts}`);
  const cb = spCumTo_(track, Tm, 'NONPAYER'), cs = spCumTo_(track, Ts, 'NONPAYER');
  const tSP = timingRatio_(c2.calCur['Season Pass'] || [], c2.calNew['Season Pass'] || [], '40-99', 'NONPAYER', c2.ds);
  const spRow = ECOGAINS_SIM('NONPAYER', '40-99')[idx('Season Pass (Free)')];
  const measRow = measuredRow_('Season Pass (Free)', '40-99', 'NONPAYER', c2.ds);
  let maxE = 0; const scaled = [];
  RESOURCES.forEach((r, j) => {
    const m = num(measRow[r]);
    const expected = (m > 0 && num(cb[r]) > 0) ? m * (num(cs[r]) / num(cb[r])) * tSP : m;
    maxE = Math.max(maxE, Math.abs(spRow[j] - expected));
    if (m > 0 && Math.abs(expected - m) > 1e-9) scaled.push(`${r} x${(expected / m).toFixed(3)}`);
  });
  gate('Season Pass row == tier-coupling identity per resource', maxE < 1e-9,
       `max err ${maxE.toExponential(2)}; moved: ${scaled.join(', ') || '(none — suspicious)'}`);
  gate('at least one Season Pass resource moved (coupling is live)', scaled.length > 0, scaled.join(', '));
  const iSPT = RESOURCES.indexOf('SPT');
  gate("Season Pass row's own SPT carried (track pays no SPT; no-anchor + no tier gain -> carry)",
       Math.abs(spRow[iSPT] - num(measRow['SPT'])) < 1e-9,
       `sim ${spRow[iSPT].toFixed(2)} == meas ${num(measRow['SPT']).toFixed(2)}`);
}

// SPT-3: synthetic SP_v2 with the Cumul ladder halved -> tiers RISE: anchored resources scale
// UP (cum ratio > 1) and the no-anchor ADDITIVE path fires for resources the track pays inside
// the newly unlocked tiers but measured never saw. Restores + re-checks baseline after.
{
  const clone = JSON.parse(JSON.stringify(data['SP']));
  for (let r = 4; r < clone.values.length; r++) {              // 0-based rows 4.. = tier rows 5..
    const v = +clone.values[r][2];
    if (v > 0) clone.values[r][2] = v / 2;                     // Cumul col C halved
  }
  data['SP_v2'] = clone;
  eval(engineSrc); resetSheetCache();
  const c3 = Context.get();
  const t = sptTotals_('40-99', 'NONPAYER', c3);
  const base = readSPTrack_('SP'), v2 = readSPTrack_('SP_v2');
  const Tm = spTier_(t.meas, base.cum), Ts = spTier_(t.sim, v2.cum);
  const row = ECOGAINS_SIM('NONPAYER', '40-99')[idx('Season Pass (Free)')];
  const measRow = measuredRow_('Season Pass (Free)', '40-99', 'NONPAYER', c3.ds);
  gate('SP_v2 Cumul x0.5 -> tier rises (Ts > Tm)', Ts > Tm, `Tm ${Tm} -> Ts ${Ts}`);
  // any no-anchor resource paid in (Tm, Ts] must now be > measured (additive path)
  let additive = null;
  for (const r of RESOURCES) {
    if (num(measRow[r]) > 0) continue;
    let add = 0;
    for (let i = Tm; i < Ts; i++) add += num(v2.free[i] && v2.free[i][r]);
    if (add > 0) { additive = { res: r, add, got: row[RESOURCES.indexOf(r)] }; break; }
  }
  gate('no-anchor additive path pays newly unlocked tier rewards',
       additive === null || Math.abs(additive.got - additive.add) < 1e-9,
       additive ? `${additive.res}: +${additive.add.toFixed(2)} got ${additive.got.toFixed(2)}` : '(no additive-eligible resource in the gap — skipped)');
  delete data['SP_v2'];
  eval(engineSrc); resetSheetCache();
  const again = ECOGAINS_SIM('NONPAYER', '40-99');
  gate('SP_v2 mutation restored (baseline reproduces)',
       CATEGORY_ORDER.every((c, i) => RESOURCES.every((r, j) => Math.abs(again[i][j] - baseline[i][j]) < 1e-12)));
}
// ---------- Rainbow Maker split-config gates (2026-07-10 hardcode: RM_1st x3 / RM_2nd x2) ----
console.log('\n================ RM SPLIT GATES ================');
// Fallback path first: with RM_1st/RM_2nd absent from the dump, every instance must read 'RM'
// and reproduce the pre-split simRainbowMaker exactly (== the baseline row).
{
  gate('RM_1st/RM_2nd absent -> all instances fall back to RM',
       rmConfigFor_(0).sheet === 'RM' && rmConfigFor_(4).sheet === 'RM');
  const parts = rmInstanceRows_('40-99', 'NONPAYER', Context.get());
  const sum = parts.reduce((s, p) => s + num(p.row['HC']), 0);
  gate('per-instance rows sum to the RM row (fallback)',
       Math.abs(sum - baseline[idx('Rainbow Maker')][0]) < 1e-9,
       `${sum.toFixed(2)} vs ${baseline[idx('Rainbow Maker')][0].toFixed(2)}`);
}
// Synthetic split: RM_1st = clone of RM; RM_2nd = clone with 'SPT x2' = 2 on every milestone.
// Expect: SPTx2 flows ONLY from the last two start-sorted instances; HC identical to baseline.
{
  const findLadder = (sh) => {
    for (let r = 0; r < sh.values.length; r++) {
      const row = sh.values[r].map(x => String(x).trim());
      const req = row.indexOf('Req Accum'), x2 = row.indexOf('SPT x2');
      if (req >= 0 && x2 >= 0) return { hdr: r, x2 };
    }
    return null;
  };
  const rm2 = JSON.parse(JSON.stringify(data['RM']));
  const lad = findLadder(rm2);
  let msRows = 0;
  for (let r = lad.hdr + 1; r < rm2.values.length; r++) {
    const first = rm2.values[r][0];
    if (first === '' || first == null || isNaN(parseFloat(first))) break;
    rm2.values[r][lad.x2] = 2;
    msRows++;
  }
  data['RM_1st'] = JSON.parse(JSON.stringify(data['RM']));
  data['RM_2nd'] = rm2;
  eval(engineSrc); resetSheetCache();
  const iX2 = RESOURCES.indexOf('SPTx2');
  const parts = rmInstanceRows_('40-99', 'NONPAYER', Context.get());
  const firstX2 = parts.slice(0, 3).reduce((s, p) => s + num(p.row['SPTx2']), 0);
  const lastX2 = parts.slice(3).reduce((s, p) => s + num(p.row['SPTx2']), 0);
  const row = ECOGAINS_SIM('NONPAYER', '40-99')[idx('Rainbow Maker')];
  gate(`RM split: SPTx2 only from instances #4-#5 (${msRows} milestones injected)`,
       parts.length === 5 && firstX2 < 1e-12 && lastX2 > 0 &&
       Math.abs(row[iX2] - lastX2) < 1e-9,
       `first3 ${firstX2.toFixed(3)} · last2 ${lastX2.toFixed(3)} · row ${row[iX2].toFixed(3)}`);
  gate('RM split: HC unchanged (both configs share the HC ladder)',
       Math.abs(row[0] - baseline[idx('Rainbow Maker')][0]) < 1e-9,
       `${row[0].toFixed(2)} vs ${baseline[idx('Rainbow Maker')][0].toFixed(2)}`);
  delete data['RM_1st']; delete data['RM_2nd'];
  eval(engineSrc); resetSheetCache();
  const again = ECOGAINS_SIM('NONPAYER', '40-99');
  gate('RM split mutation restored (baseline reproduces)',
       CATEGORY_ORDER.every((c, i) => RESOURCES.every((r, j) => Math.abs(again[i][j] - baseline[i][j]) < 1e-12)));
}
console.log(failures ? `\n${failures} GATE FAILURE(S)` : '\nALL GATES PASSED');
process.exit(failures ? 1 : 0);
