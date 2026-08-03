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
gate('spill width == 19 resources (13 + 6 pack tiers, D19)',
     baseline[0].length === RESOURCES.length && RESOURCES.length === 19,
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

// SPT-2: Season Pass tier coupling. Verifies the per-resource identity:
// anchored -> measured x cum(Ts)/cum(Tm) x T_cal; no anchor + no tier gain -> carried.
//
// REFRESHED 2026-08-03. These gates were written when the dump had NO _v2 sheets and asserted the
// fallback path; workbook (13) ships real SP_v2 / SP_lb_v2, so they asserted the opposite of
// reality and had been red (documented as "stale, deferred") ever since. Two changes:
//   1. presence is asserted, and the FALLBACK path is exercised by temporarily removing the
//      sheets (snapshot-and-restore) instead of relying on them being missing;
//   2. the tier gates moved off '40-99' — that segment's SPT total exceeds the 30-tier ladder on
//      BOTH sides, so Tm == Ts == 30 (cap) and no tier movement is possible there. That cap is a
//      real open modeling question, so it now gets its own REPORTING gate rather than silently
//      breaking the mechanism gates.
const SP_SEG = '10-19';        // headroom on both sides (Tm 23 -> Ts 18) — see the cap gate below
{
  const c2 = Context.get();
  gate('SP_v2 / SP_lb_v2 present -> engine prices the redesigned track',
       spV2Sheet_('SP') === 'SP_v2' && spV2Sheet_('SP_lb') === 'SP_lb_v2',
       `${spV2Sheet_('SP')} / ${spV2Sheet_('SP_lb')}`);
  {   // fallback path: with the v2 sheets gone the base sheets must serve both sides (ratios 1)
    const s1 = data['SP_v2'], s2 = data['SP_lb_v2'];
    delete data['SP_v2']; delete data['SP_lb_v2'];
    eval(engineSrc); resetSheetCache();
    const ok = spV2Sheet_('SP') === 'SP' && spV2Sheet_('SP_lb') === 'SP_lb';
    if (s1) data['SP_v2'] = s1;
    if (s2) data['SP_lb_v2'] = s2;
    eval(engineSrc); resetSheetCache();
    gate('SP_v2 / SP_lb_v2 removed -> engine falls back to the base sheets', ok);
    gate('SP fallback mutation restored (baseline reproduces)',
         CATEGORY_ORDER.every((c, i) => RESOURCES.every((r, j) =>
           Math.abs(ECOGAINS_SIM('NONPAYER', '40-99')[i][j] - baseline[i][j]) < 1e-12)));
  }
  const c2b = Context.get();
  const t = sptTotals_(SP_SEG, 'NONPAYER', c2b);
  gate('SPT totals: simulated < measured (RR removal + Ki_v2 cut + T factors)',
       t.meas > 100 && t.sim < t.meas - 50, `meas ${t.meas.toFixed(2)} sim ${t.sim.toFixed(2)}`);
  const base = readSPTrack_('SP'), v2t = readSPTrack_(spV2Sheet_('SP'));
  const dB = readSPSeasonDays_('SP') || 33;
  const dV = (spV2Sheet_('SP') !== 'SP' && readSPSeasonDays_(spV2Sheet_('SP'))) || dB;
  const Tm = spTier_(t.meas * dB / 33, base.cum), Ts = spTier_(t.sim * dV / 33, v2t.cum);
  gate(`tier reached drops with the SPT loss (Ts < Tm) [${SP_SEG}]`, Tm > 0 && Ts < Tm,
       `Tm ${Tm} -> Ts ${Ts}`);
  const cb = spCumTo_(base, Tm, 'NONPAYER'), cs = spCumTo_(v2t, Ts, 'NONPAYER');
  const Rlb = spChallengeR_();
  const tSP = timingRatio_(c2b.calCur['Season Pass'] || [], c2b.calNew['Season Pass'] || [], SP_SEG, 'NONPAYER', c2b.ds);
  const spRow = ECOGAINS_SIM('NONPAYER', SP_SEG)[idx('Season Pass (Free)')];
  const measRow = measuredRow_('Season Pass (Free)', SP_SEG, 'NONPAYER', c2b.ds);
  let maxE = 0; const scaled = [];
  RESOURCES.forEach((r, j) => {
    if (isPackRes_(r)) return;               // packs take the bottom-up lane, not this identity
    const m = num(measRow[r]);
    let expected;
    if (m > 0 && num(cb[r]) > 0) expected = m * (num(cs[r]) / num(cb[r])) * ((Rlb[r] != null) ? Rlb[r] : 1) * tSP;
    else if (Ts > Tm) {
      let add = 0;
      for (let i = Tm; i < Ts; i++) add += num(v2t.free[i] && v2t.free[i][r]);
      expected = m + add;
    } else expected = m;
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

  // OPEN QUESTION (reported, not asserted): the SP ladder tops out at 30 tiers, so heavy segments
  // sit at the cap on BOTH sides and their Season Pass row cannot respond to an SPT change at all.
  // If this list ever covers every segment, the tier coupling has gone completely inert.
  const capped = [];
  for (const s of ['0-9', '10-19', '20-39', '40-99', '100+'])
    for (const p of ['NONPAYER', 'PAYER']) {
      const tt = sptTotals_(s, p, c2b);
      const a = spTier_(tt.meas * dB / 33, base.cum), b = spTier_(tt.sim * dV / 33, v2t.cum);
      if (a === base.cum.length && b === v2t.cum.length) capped.push(`${s}/${p}`);
    }
  gate(`tier-30 cap does not mask EVERY segment (open flag: L calibration)`,
       capped.length < 10, `cap-masked: ${capped.join(', ') || '(none)'}`);
}

// SPT-3: synthetic SP_v2 with the Cumul ladder halved -> tiers RISE: anchored resources scale
// UP (cum ratio > 1) and the no-anchor ADDITIVE path fires for resources the track pays inside
// the newly unlocked tiers but measured never saw. Restores + re-checks baseline after.
{
  // (13)+: SP_v2 may already exist in the dump — save it and RESTORE it (deleting it would
  // poison every later gate: spV2Sheet_ falls back to SP and R degrades to 1).
  const origSP_v2 = data['SP_v2'] ? JSON.parse(JSON.stringify(data['SP_v2'])) : null;
  const clone = JSON.parse(JSON.stringify(data['SP']));
  for (let r = 4; r < clone.values.length; r++) {              // 0-based rows 4.. = tier rows 5..
    const v = +clone.values[r][2];
    if (v > 0) clone.values[r][2] = v / 2;                     // Cumul col C halved
  }
  data['SP_v2'] = clone;
  eval(engineSrc); resetSheetCache();
  const c3 = Context.get();
  const t = sptTotals_(SP_SEG, 'NONPAYER', c3);
  const base = readSPTrack_('SP'), v2 = readSPTrack_('SP_v2');
  const dB = readSPSeasonDays_('SP') || 33, dV = readSPSeasonDays_('SP_v2') || dB;
  const Tm = spTier_(t.meas * dB / 33, base.cum), Ts = spTier_(t.sim * dV / 33, v2.cum);
  const row = ECOGAINS_SIM('NONPAYER', SP_SEG)[idx('Season Pass (Free)')];
  const measRow = measuredRow_('Season Pass (Free)', SP_SEG, 'NONPAYER', c3.ds);
  gate(`SP_v2 Cumul x0.5 -> tier rises (Ts > Tm) [${SP_SEG}]`, Ts > Tm, `Tm ${Tm} -> Ts ${Ts}`);
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
  if (origSP_v2) data['SP_v2'] = origSP_v2; else delete data['SP_v2'];
  eval(engineSrc); resetSheetCache();
  const again = ECOGAINS_SIM('NONPAYER', '40-99');
  gate('SP_v2 mutation restored (baseline reproduces)',
       CATEGORY_ORDER.every((c, i) => RESOURCES.every((r, j) => Math.abs(again[i][j] - baseline[i][j]) < 1e-12)));
}
// ---------- Core SPT gates (D17: level-completion tokens priced off the SP / SP_v2 panel) -----
console.log('\n================ CORE SPT GATES ================');
// D18 model: data_gains has no Core SPT rows -> the anchor is SYNTHETIC (L x E_base) and the
// sim side is L x E_v2 = meas x R. E is the difficulty-mix per-level SPT AVERAGED over the two
// season-half columns of the SP / SP_v2 panel. All expectations recomputed via engine fns +
// independent sheet reads — never hardcoded.
{
  const c = Context.get();
  const iSPT = RESOURCES.indexOf('SPT');
  const rawCore = c.ds.gains('40-99', 'NONPAYER', 'Core', 'SPT');
  const measCore = num(measuredRow_('Core', '40-99', 'NONPAYER', c.ds)['SPT']);
  const coreSPT = ECOGAINS_SIM('NONPAYER', '40-99')[idx('Core')][iSPT];
  const R = coreSptR_(c);
  // independent E recompute straight off the sheet values (label row -> [2nd half, 1st half])
  const panelE = (sheet) => {
    const mix = { 'Normal': null, 'Hard': null, 'Extreme': null };
    let E = 0;
    for (const d of Object.keys(mix)) {
      let rew = null, pct = null;
      for (const row of data[sheet].values) for (let k = 0; k < row.length; k++) {
        const cell = String(row[k]).trim();
        if (cell === d) rew = [num(row[k + 1]), (row[k + 2] == null || row[k + 2] === '') ? null : num(row[k + 2])];
        if (cell === d + ' (%)') pct = num(row[k + 1]);
      }
      if (!rew) return 0;
      E += (pct != null ? pct : { 'Normal': 0.55, 'Hard': 0.30, 'Extreme': 0.15 }[d])
           * (rew[1] != null ? (rew[0] + rew[1]) / 2 : rew[0]);
    }
    return E;
  };
  const eBase = panelE('SP'), eV2 = panelE(spV2Sheet_('SP'));
  gate('Core SPT E halves-averaged (engine == independent panel read)',
       eBase > 0 && Math.abs(coreSptE_('SP', coreSptMix_('SP')) - eBase) < 1e-9,
       `E_base ${eBase.toFixed(2)}, E_v2 ${eV2.toFixed(2)}`);
  // independent L recompute: levels/active-day x Σ p_day over the 33-day window
  const beh = c.ds.beh('40-99', 'NONPAYER');
  let expDays = 0;
  for (let d = 1; d <= 33; d++) expDays += isWeekend_(d) ? num(beh.weekend_active_rate) : num(beh.weekday_active_rate);
  const Lexp = num(beh.levels_completed_per_active_day) * expDays;
  gate('Core SPT anchor synthetic: raw data 0, meas = L x E_base',
       rawCore === 0 && measCore > 0 && Math.abs(measCore - Lexp * eBase) < 1e-6,
       `raw ${rawCore} · meas ${measCore.toFixed(2)} vs L ${Lexp.toFixed(1)} x E ${eBase.toFixed(2)}`);
  gate('Core SPT sim = meas x R (= L x E_v2)',
       Math.abs(coreSPT - measCore * R) < 1e-6 && Math.abs(coreSPT - Lexp * eV2) < 1e-6,
       `sim ${coreSPT.toFixed(2)} vs ${(measCore * R).toFixed(2)} (R=${R.toFixed(3)})`);
  // both sides of the tier coupling must include the synthetic Core faucet
  const t = sptTotals_('40-99', 'NONPAYER', Context.get());
  let rawMeasTotal = 0;
  CATEGORY_ORDER.forEach((cat) => {
    rawMeasTotal += c.ds.gains('40-99', 'NONPAYER', cat, 'SPT') + 2 * c.ds.gains('40-99', 'NONPAYER', cat, 'SPTx2');
  });
  gate('sptTotals_ measured side includes synthetic Core (raw total + L x E_base)',
       Math.abs(t.meas - (rawMeasTotal + Lexp * eBase)) < 1e-6,
       `meas ${t.meas.toFixed(2)} vs raw ${rawMeasTotal.toFixed(2)} + ${(Lexp * eBase).toFixed(2)}`);
}
// Real-data precedence: inject a data_gains Core SPT row -> the synthetic anchor must stand
// down (measuredRow_ returns the raw value; sim = raw x R; no double count).
{
  const orig = JSON.parse(JSON.stringify(data['data_gains']));
  const hdr = data['data_gains'].values[0];
  const col = (n) => hdr.indexOf(n);
  const inj = new Array(hdr.length).fill('');
  inj[col('engagement_segment')] = 'E. 40-99'; inj[col('payer_flag')] = 'NONPAYER';
  inj[col('resource')] = 'SPT'; inj[col('category')] = 'Core'; inj[col('amount_per_earner')] = 123.45;
  data['data_gains'].values.push(inj);
  eval(engineSrc); resetSheetCache();
  const c = Context.get(), iSPT = RESOURCES.indexOf('SPT');
  const measCore = num(measuredRow_('Core', '40-99', 'NONPAYER', c.ds)['SPT']);
  const coreSPT = ECOGAINS_SIM('NONPAYER', '40-99')[idx('Core')][iSPT];
  const R = coreSptR_(c);
  gate('real Core SPT data present -> synthetic stands down (meas = raw, sim = raw x R)',
       Math.abs(measCore - 123.45) < 1e-9 && Math.abs(coreSPT - 123.45 * R) < 1e-6,
       `meas ${measCore.toFixed(2)}, sim ${coreSPT.toFixed(2)}, R ${R.toFixed(3)}`);
  data['data_gains'] = orig;
  eval(engineSrc); resetSheetCache();
  const again = ECOGAINS_SIM('NONPAYER', '40-99');
  gate('Core SPT mutation restored (baseline reproduces)',
       CATEGORY_ORDER.every((cat, i) => RESOURCES.every((r, j) => Math.abs(again[i][j] - baseline[i][j]) < 1e-12)));
}
// ---------- Rainbow Maker split-config gates (2026-07-10 hardcode: RM_1st x3 / RM_2nd x2) ----
console.log('\n================ RM SPLIT GATES ================');
// REFRESHED 2026-08-03: workbook (13) DELETED the base 'RM' sheet and ships real RM_1st / RM_2nd
// ladders, so the old "RM_1st/RM_2nd absent -> fall back to RM" gate asserted the opposite of
// reality and had been red (documented as stale). Now: assert the real split, exercise the
// fallback by temporarily REMOVING the split sheets, and drive the SPTx2 placement gate off
// whichever ladder actually exists.
{
  gate('RM split live: instances #1-#3 read RM_1st, #4-#5 read RM_2nd',
       [0, 1, 2].every(i => rmConfigFor_(i).sheet === 'RM_1st') &&
       [3, 4].every(i => rmConfigFor_(i).sheet === 'RM_2nd'),
       [0, 1, 2, 3, 4].map(i => rmConfigFor_(i).sheet).join(','));
  const parts = rmInstanceRows_('40-99', 'NONPAYER', Context.get());
  const sum = parts.reduce((s, p) => s + num(p.row['HC']), 0);
  gate('per-instance rows sum to the 33-day RM row',
       Math.abs(sum - baseline[idx('Rainbow Maker')][0]) < 1e-9,
       `${sum.toFixed(2)} vs ${baseline[idx('Rainbow Maker')][0].toFixed(2)}`);
  const s1 = data['RM_1st'], s2 = data['RM_2nd'];
  delete data['RM_1st']; delete data['RM_2nd'];
  eval(engineSrc); resetSheetCache();
  const fellBack = [0, 4].every(i => rmConfigFor_(i).sheet === 'RM');
  if (s1) data['RM_1st'] = s1;
  if (s2) data['RM_2nd'] = s2;
  eval(engineSrc); resetSheetCache();
  gate('RM_1st/RM_2nd removed -> every instance falls back to RM', fellBack);
}
// SPTx2 placement: clone whichever split ladder exists, force SPT x2 = 0 on the 1st-half config
// and 2 on the 2nd-half one, then assert SPTx2 flows ONLY from the last two start-sorted
// instances. Snapshot-and-restore — never bake workbook state into the assertion.
{
  const baseName = data['RM_1st'] ? 'RM_1st' : (data['RM_2nd'] ? 'RM_2nd' : (data['RM'] ? 'RM' : null));
  if (!baseName) {
    gate('RM split SPTx2 placement (no RM ladder sheet in this dump -> skipped)', true);
  } else {
    const setX2 = (sh, val) => {
      let hdr = -1, x2 = -1;
      for (let r = 0; r < sh.values.length; r++) {
        const row = sh.values[r].map(x => String(x).trim());
        if (row.indexOf('Req Accum') >= 0 && row.indexOf('SPT x2') >= 0) { hdr = r; x2 = row.indexOf('SPT x2'); break; }
      }
      if (hdr < 0) return 0;
      let n = 0;
      for (let r = hdr + 1; r < sh.values.length; r++) {
        const first = sh.values[r][0];
        if (first === '' || first == null || isNaN(parseFloat(first))) break;
        sh.values[r][x2] = val; n++;
      }
      return n;
    };
    const stash1 = data['RM_1st'], stash2 = data['RM_2nd'];
    const clone = (n) => JSON.parse(JSON.stringify(data[n] || data[baseName]));
    const first = clone('RM_1st'), second = clone('RM_2nd');
    setX2(first, 0);
    const msRows = setX2(second, 2);
    data['RM_1st'] = first; data['RM_2nd'] = second;
    eval(engineSrc); resetSheetCache();
    const iX2 = RESOURCES.indexOf('SPTx2');
    const parts = rmInstanceRows_('40-99', 'NONPAYER', Context.get());
    const firstX2 = parts.slice(0, 3).reduce((s, p) => s + num(p.row['SPTx2']), 0);
    const lastX2 = parts.slice(3).reduce((s, p) => s + num(p.row['SPTx2']), 0);
    const row = ECOGAINS_SIM('NONPAYER', '40-99')[idx('Rainbow Maker')];
    gate(`RM split: SPTx2 only from instances #4-#5 (${msRows} milestones injected)`,
         parts.length === 5 && firstX2 < 1e-12 && lastX2 > 0 && Math.abs(row[iX2] - lastX2) < 1e-9,
         `first3 ${firstX2.toFixed(3)} · last2 ${lastX2.toFixed(3)} · row ${row[iX2].toFixed(3)}`);
    if (stash1 !== undefined) data['RM_1st'] = stash1; else delete data['RM_1st'];
    if (stash2 !== undefined) data['RM_2nd'] = stash2; else delete data['RM_2nd'];
    eval(engineSrc); resetSheetCache();
    const again = ECOGAINS_SIM('NONPAYER', '40-99');
    gate('RM split mutation restored (baseline reproduces)',
         CATEGORY_ORDER.every((c, i) => RESOURCES.every((r, j) => Math.abs(again[i][j] - baseline[i][j]) < 1e-12)));
  }
}
console.log(failures ? `\n${failures} GATE FAILURE(S)` : '\nALL GATES PASSED');
process.exit(failures ? 1 : 0);
