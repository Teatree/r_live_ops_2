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

// ---- SPILL ALIGNMENT ------------------------------------------------------------------------
// ECOGAINS_SIM returns one row per CATEGORY_ORDER entry, in order, and the display sheet's row
// labels in column B are static text that nothing ever checked against it. A label added to the
// sheet without a matching entry does NOT read blank: it shifts every row beneath it onto the next
// source's numbers, silently. That happened when 'Season Pass (Paid)', 'Col - Sets' and
// 'Col - Albums' were added to the workbook - Rainbow Maker's HC was being read as FlowerCoop's,
// and Rainbow Maker's own row showed 0. Compare the two lists whenever the sheet is in the dump.
(function alignmentGate(){
  const sheetName = ['EcoGainsSim', 'EcoGainsSim_HC'].find(n => data[n] && data[n].values.length);
  if (!sheetName) {
    console.log('SKIP spill alignment: no display sheet in the mockdata dump');
    return;
  }
  const vals = data[sheetName].values;
  // the labels sit in column B under the 'Source' header of the first segment block
  let hdr = -1;
  for (let r = 0; r < vals.length; r++)
    if (String((vals[r] || [])[1]).trim() === 'Source') { hdr = r; break; }
  if (hdr < 0) { console.log('SKIP spill alignment: no "Source" header on ' + sheetName); return; }
  const labels = [];
  for (let r = hdr + 1; r < vals.length; r++) {
    const t = String((vals[r] || [])[1] == null ? '' : (vals[r] || [])[1]).trim();
    if (!t) break;
    labels.push(t);
  }
  const bad = [];
  const n = Math.max(labels.length, CATEGORY_ORDER.length);
  for (let i = 0; i < n; i++)
    if (labels[i] !== CATEGORY_ORDER[i])
      bad.push('row ' + (hdr + 2 + i) + ': sheet=' + (labels[i] || '(none)') +
               ' engine=' + (CATEGORY_ORDER[i] || '(none)'));
  if (bad.length) {
    console.log('FAIL spill alignment: CATEGORY_ORDER does not match ' + sheetName +
                ' labels - ' + bad.slice(0, 4).join(' | '));
    failures = (typeof failures === 'number' ? failures : 0) + 1;
  } else {
    console.log('PASS spill alignment: CATEGORY_ORDER matches all ' + labels.length +
                ' ' + sheetName + ' row labels');
  }
})();

// ---- SEASON PASS (PAID) IS A CHANGE, NOT AN ADD ----------------------------------------------
// The paid track has no measured category in data_gains, so without a synthetic anchor its DIFF is
// the WHOLE track and the row reads as a brand-new source. Payers held the pass last season too, so
// the anchor is the paid track up to the tier their MEASURED SPT reached, and the diff is the
// movement. Three assertions, because any one alone is passable by a broken implementation:
//   nothing authored  -> diff 0        (an un-anchored row shows the whole track here)
//   SPT economy moves -> diff > 0      (a hardcoded anchor never moves)
//   ...and the MEASURED side must NOT move with it (an anchor read off the SIMULATED tier would)
function fmtNum(x){ return (Math.round(x * 100) / 100).toFixed(2); }
function rebuildCtx_(){
  _sheetValsCache = {};
  _measSptCache = {};
  Context = (function(){ let c = null; return { get: function(){
    if (c) return c;
    const cur = sanitizeCal_(parseCalendarInstances_(CAL_CUR));
    const nw = sanitizeCal_(parseCalendarInstances_(CAL_NEW));
    c = { ds: DataStore.get(), calCur: cur, calNew: nw,
          calCurOk: hasKeys_(cur), calNewOk: hasKeys_(nw) };
    return c; } }; })();
}
(function seasonPassPaidGate(){
  const i = (typeof CATEGORY_ORDER !== 'undefined') ? CATEGORY_ORDER.indexOf('Season Pass (Paid)') : -1;
  if (typeof simSeasonPassPaid !== 'function' || i < 0){
    console.log('SKIP SP(Paid): not in this engine'); return;
  }
  const hc = RESOURCES.indexOf('HC');
  const track = readSPTrack_('SP');
  // The tier ladder CAPS: a segment already at the top tier cannot climb, so boosting SPT there
  // would show no movement for a correct implementation too. Pick one with headroom.
  let SEG = null;
  ['0-9', '10-19', '20-39', '40-99', '100+'].forEach((sg) => {
    if (SEG) return;
    const ds = Context.get().ds;
    const tm = spTier_(measuredSptTotal_(sg, 'PAYER', ds) * (readSPSeasonDays_('SP') || 33) / 33, track.cum);
    if (tm > 0 && tm < track.cum.length) SEG = sg;
  });
  if (!SEG){ console.log('SKIP SP(Paid) movement: every segment is at the tier cap on this dump'); return; }

  const P = 'PAYER';
  const baseMeas = num(measuredRow_('Season Pass (Paid)', SEG, P, Context.get().ds)['HC']);
  const baseDiff = ECOGAINS_DIFF(P, SEG)[i][hc];

  const snap = JSON.stringify(data['SP_v2'].values);
  const v = data['SP_v2'].values;
  ['Normal', 'Hard', 'Extreme'].forEach((d) => {
    for (let r = 0; r < v.length; r++)
      for (let c = 0; c < (v[r] || []).length; c++)
        if (String(v[r][c]).trim() === d){
          v[r][c + 1] = (parseFloat(v[r][c + 1]) || 0) * 3;
          v[r][c + 2] = (parseFloat(v[r][c + 2]) || 0) * 3;
        }
  });
  rebuildCtx_();
  const movedMeas = num(measuredRow_('Season Pass (Paid)', SEG, P, Context.get().ds)['HC']);
  const movedDiff = ECOGAINS_DIFF(P, SEG)[i][hc];

  if (Math.abs(baseDiff) > 1e-6){
    console.log('FAIL SP(Paid) diff is 0 when nothing is authored - got ' + fmtNum(baseDiff)); failures++;
  } else console.log('PASS SP(Paid) diff is 0 when nothing is authored (' + SEG + ', anchor ' + fmtNum(baseMeas) + ' HC)');

  if (!(movedDiff > 1e-6)){
    console.log('FAIL SP(Paid) does not move when the SPT economy moves - diff ' + fmtNum(movedDiff)); failures++;
  } else console.log('PASS SP(Paid) moves when the SPT economy moves - diff ' + fmtNum(movedDiff) + ' HC');

  if (Math.abs(movedMeas - baseMeas) > 1e-6){
    console.log('FAIL SP(Paid) measured anchor moved with the simulation (' + fmtNum(baseMeas) +
                ' -> ' + fmtNum(movedMeas) + ') - it is not anchored'); failures++;
  } else console.log('PASS SP(Paid) measured anchor stays put while the sim climbs - ' + fmtNum(baseMeas) + ' HC');

  data['SP_v2'].values = JSON.parse(snap);
  rebuildCtx_();
  if (JSON.stringify(data['SP_v2'].values) !== snap){ console.log('FAIL SP(Paid) fixture NOT restored'); failures++; }
  else console.log('PASS SP(Paid) fixture restored');
})();

// ---- NIGHT SKY: anchored change vs new source ------------------------------------------------
// NS_SIMULATE and NS_ANCHORED answer DIFFERENT questions and the names invite confusion:
// NS_SIMULATE=false CARRIES the lane (diff exactly 0, "nothing changed"), while NS_ANCHORED=false
// makes it a NEW source (measured forced to 0, the whole lane lands in the diff). Assert the
// shipped combination produces what its comment claims, so the two can never quietly swap meaning.
(function nightSkyModeGate(){
  if (typeof NS_ANCHORED === 'undefined'){ console.log('SKIP NS mode: not in this engine'); return; }
  const SEG = '20-39', P = 'PAYER';
  const i = CATEGORY_ORDER.indexOf('Daily Night Sky Prize');
  const hc = RESOURCES.indexOf('HC');
  const meas = num(measuredRow_('Daily Night Sky Prize', SEG, P, Context.get().ds)['HC']);
  const sim = ECOGAINS_SIM(P, SEG)[i][hc];
  const diff = ECOGAINS_DIFF(P, SEG)[i][hc];
  if (NS_ANCHORED){
    console.log('PASS NS is ANCHORED (change only) - measured ' + fmtNum(meas) + ', diff ' + fmtNum(diff));
  } else if (Math.abs(meas) < 1e-9 && Math.abs(diff - sim) < 1e-6){
    console.log('PASS NS is a NEW SOURCE - measured 0, whole lane in the diff (' + fmtNum(diff) + ' HC)');
  } else {
    console.log('FAIL NS_ANCHORED=false must zero the measured anchor and put the whole lane in the ' +
                'diff - measured ' + fmtNum(meas) + ', sim ' + fmtNum(sim) + ', diff ' + fmtNum(diff));
    failures++;
  }
})();


// ---- NIGHT SKY: anchored change vs new source ------------------------------------------------
// NS_SIMULATE and NS_ANCHORED answer DIFFERENT questions and the names invite confusion:
// NS_SIMULATE=false carries the lane (diff exactly 0, "nothing changed"), while NS_ANCHORED=false
// makes it a NEW source (measured forced to 0, the whole lane lands in the diff). Assert the
// shipped combination actually produces what its comment claims.
(function nightSkyModeGate(){
  if (typeof NS_ANCHORED === 'undefined'){ console.log('SKIP NS mode: not in this engine'); return; }
  const SEG = '20-39', P = 'PAYER';
  const i = CATEGORY_ORDER.indexOf('Daily Night Sky Prize');
  const hc = RESOURCES.indexOf('HC');
  const meas = num(measuredRow_('Daily Night Sky Prize', SEG, P, Context.get().ds)['HC']);
  const sim = ECOGAINS_SIM(P, SEG)[i][hc];
  const diff = ECOGAINS_DIFF(P, SEG)[i][hc];
  if (NS_ANCHORED){
    console.log('PASS NS is ANCHORED (change only) - measured ' + fmtNum(meas) + ', diff ' + fmtNum(diff));
  } else {
    const ok = Math.abs(meas) < 1e-9 && Math.abs(diff - sim) < 1e-6;
    if (!ok){ console.log('FAIL NS_ANCHORED=false must zero the measured anchor and put the whole lane in the diff - measured ' + fmtNum(meas) + ', sim ' + fmtNum(sim) + ', diff ' + fmtNum(diff)); failures++; }
    else console.log('PASS NS is a NEW SOURCE - measured 0, whole lane in the diff (' + fmtNum(diff) + ' HC)');
  }
})();

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

// ---------- NS gates (D22 anchored model + NS_SIMULATE switch) ----------
// NS was re-anchored 2026-08-05 (D22): sim = measured x R x T with R = E(NS_v2)/E(NS), instead of
// the old bottom-up absolute total. These gates assert the MECHANISM (the reconstruction identity,
// the R=1-when-configs-match property, the switch) rather than any particular number — NS_v2 is a
// verbatim clone of NS in workbook (14), so "the diff moves" is no longer a valid assertion and
// would red the moment someone clones the sheet honestly.
console.log('\n================ NS GATES ================');
let failures = 0;
const gate = (name, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
  if (!ok) failures++;
};
const engineSrc = fs.readFileSync(ENGINE('EcoGainsSim_v4.gs'), 'utf8');
// Gate the SWITCH, not the shipped value: NS_SIMULATE flipped to true in D21 (packs must flow
// from the NS ladder), so an assertion hardcoding `=== false` would only be testing what the
// constant happens to say today. Build both variants and assert each behaviour.
const nsVariant = (on) => engineSrc.replace(/var NS_SIMULATE = (?:true|false)/,
                                            'var NS_SIMULATE = ' + (on ? 'true' : 'false'));
const engineSrcNsOn = nsVariant(true), engineSrcNsOff = nsVariant(false);
const NS_I = CATEGORY_ORDER.indexOf('Daily Night Sky Prize');
const SEG5 = ['0-9', '10-19', '20-39', '40-99', '100+'];
gate('NS_SIMULATE variants are distinct (the flip actually rewrites the source)',
     engineSrcNsOn !== engineSrcNsOff);
// switch OFF -> NS carried (= measured, diff 0) everywhere
eval(engineSrcNsOff); _sheetValsCache = {};
gate('NS_SIMULATE OFF -> NS carried (diff 0) for every segment',
     NS_SIMULATE === false && SEG5.every(s => Math.abs(ECOGAINS_DIFF('NONPAYER', s)[NS_I][0]) < 1e-9));
// flip the switch on and gate the model itself
eval(engineSrcNsOn); _sheetValsCache = {};
gate('NS_SIMULATE ON -> NS is priced through the anchored model (not carried raw)',
     NS_SIMULATE === true && typeof nsE_ === 'function' && !!nsE_('40-99', 'NONPAYER', ds));
gate('NS_v2 sheet present (dumped by _dump_mockdata)', !!data['NS_v2']);

// Reconstruction identity: the NS row IS measured x R x T (+ bottom-up base-0 additions),
// rebuilt here from the engine's own parts. This is the gate that can't rot — it holds for any
// NS/NS_v2 pair, edited or not.
{
  const c2 = Context.get(), ds2 = c2.ds;
  let worstErr = 0, worstWhere = '';
  const nsPart = {};
  for (const seg of SEG5) {
    const E = nsE_(seg, 'NONPAYER', ds2);
    const b = ds2.beh(seg, 'NONPAYER');
    const T = timingRatio_(c2.calCur['Night Sky'] || [], c2.calNew['Night Sky'] || [], seg, 'NONPAYER', ds2);
    const days = reachSum_(c2.calNew['Night Sky'] || [], num(b.weekday_active_rate), num(b.weekend_active_rate));
    const meas = measuredRow_('Daily Night Sky Prize', seg, 'NONPAYER', ds2);
    const row = ECOGAINS_SIM('NONPAYER', seg)[NS_I];
    nsPart[seg] = { T, days };
    RESOURCES.forEach((r, i) => {
      if (typeof isPackRes_ === 'function' && isPackRes_(r)) return;   // packs gated separately
      const base = num(E.eBase[r]), v2 = num(E.eV2[r]);
      // Two SHIPPED models, and the gate must follow whichever is switched on rather than pinning
      // one of them. NS_ANCHORED=true is the D22 anchored form; false makes Night Sky a NEW source
      // (measured forced to 0, priced bottom-up on cal_new), which is what "the old calendar had no
      // Night Sky" means. Hardcoding the anchored identity here would fail the moment the lane is
      // legitimately switched to a new source, which is a gate reporting a decision as a defect.
      let want;
      if (typeof NS_ANCHORED !== 'undefined' && !NS_ANCHORED){
        want = v2 * days;
      } else {
        want = num(meas[r]) * (base > 1e-9 ? v2 / base : 1) * T;
        if (base <= 1e-9 && v2 > 0) want += v2 * days;
      }
      const err = Math.abs(row[i] - want);
      if (err > worstErr) { worstErr = err; worstWhere = `${seg}/${r}`; }
    });
  }
  const nsForm = (typeof NS_ANCHORED !== 'undefined' && !NS_ANCHORED)
    ? 'NS row == E_v2 x Σp_day (NEW SOURCE mode), every segment x resource'
    : 'NS row == measured x R x T (+ base-0 bottom-up additions), every segment x resource';
  gate(nsForm, worstErr < 1e-9, `worst |err| ${worstErr.toExponential(2)} at ${worstWhere}`);
  console.log('  T/Σp_day per segment: ' + SEG5.map(s => `${s} T=${fmt(nsPart[s].T)} days=${fmt(nsPart[s].days)}`).join(' · '));
}

// The property the re-anchor exists for: identical configs => identical rewards. Asserted only
// when NS_v2 really is a clone of NS; once you edit NS_v2 the gate REPORTS the resulting R
// instead (the feature working), and the mutation gates below cover the edited path.
{
  const nsRegion = (sheet) => JSON.stringify((data[sheet] || { values: [] }).values.map(r => (r || []).slice(0, 20)));
  const clone = data['NS_v2'] && nsRegion('NS') === nsRegion('NS_v2');
  const ds2 = Context.get().ds;
  const offs = [];
  for (const seg of SEG5) {
    const E = nsE_(seg, 'NONPAYER', ds2);
    RESOURCES.forEach(r => {
      const b = num(E.eBase[r]), v = num(E.eV2[r]);
      if (b > 1e-9 && Math.abs(v / b - 1) > 1e-9) offs.push(`${seg}/${r}=${(v / b).toFixed(3)}`);
      else if (b <= 1e-9 && v > 0) offs.push(`${seg}/${r}=+${fmt(v)}/day (no anchor)`);
    });
  }
  if (clone) {
    gate('NS_v2 == NS -> R == 1 for every segment x resource (same config, same rewards)',
         offs.length === 0, offs.join(' '));
    gate('NS_v2 == NS -> sim == measured x T, diff = 0 while both calendars run NS daily',
         SEG5.every(s => Math.abs(ECOGAINS_DIFF('NONPAYER', s)[NS_I][0]) < 1e-6));
  } else {
    console.log('  NS_v2 carries real edits vs NS: ' + (offs.join(' ') || '(no priced effect)'));
    gate('NS_v2 edited -> R departs from 1 somewhere (the edit reaches the sim)', offs.length > 0);
  }
}

// E_day monotonicity is a property of the ladder+streak model that still feeds R, so keep it.
const nsEday = {};
for (const seg of SEG5) {
  const st = ds.nsStreak(seg, 'NONPAYER');
  const S = survival_([[st.p25 * NS_STREAK_N, .25], [st.p50 * NS_STREAK_N, .5],
                       [st.p75 * NS_STREAK_N, .75], [st.p90 * NS_STREAK_N, .9]]);
  let e = 0; readNSLadder_(seg, 'NS').forEach(ms => { e += (ms.rew.HC || 0) * S(ms.req); });
  nsEday[seg] = e;
  console.log(`NS ${seg.padEnd(6)} NONPAYER: simHC=${fmt(ECOGAINS_SIM('NONPAYER', seg)[NS_I][0]).padStart(8)}  E_day=${fmt(e).padStart(7)}  conservative(S=0>p90xN)=${fmt(nsBound(seg, 'NONPAYER')).padStart(8)}  measured(anchor)=${fmt(ds.dataRow('Daily Night Sky Prize', seg, 'NONPAYER').HC).padStart(8)}`);
}
gate('NS E_day (HC per active day) monotonic in segment', SEG5.every((s, i) => i === 0 || nsEday[s] > nsEday[SEG5[i - 1]]),
     SEG5.map(s => fmt(nsEday[s])).join(' < '));
gate('NS carried for A. 0 (appendix, intercepted before the sim)',
     Math.abs(ECOGAINS_DIFF('NONPAYER', 'A. 0')[NS_I][0]) < 1e-9);
// Removal semantics: no cal_new Night Sky instances -> 0 (same rule as River Rush). Asserted on a
// doctored ctx rather than by editing the calendar, because the engine reads cal_parsed.
{
  const c2 = Context.get();
  const gone = { ds: c2.ds, calCur: c2.calCur, calNewOk: c2.calNewOk,
                 calNew: Object.assign({}, c2.calNew, { 'Night Sky': [] }) };
  const row = simNightSky('40-99', 'NONPAYER', gone);
  gate('NS removed from cal_new -> 0 for every resource (removal semantics)',
       RESOURCES.every(r => Math.abs(num(row[r])) < 1e-9));
}
eval(engineSrc);   // back to the shipped value for the R gates

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

// ---------- NS anchor gates (D22): mutate NS_v2 and assert the R term reaches the sim ----------
// These are the edited-config half of the NS gates above (which cover the clone case). Every
// expectation is recomputed through the engine's own functions, so nothing here bakes in a number.
console.log('\n================ NS ANCHOR GATES ================');
{
  // locate a segment's ladder block on an NS-shaped sheet: header row + 0-based ladder row indices
  const nsBlock = (sheet, seg) => {
    const v = (data[sheet] || { values: [] }).values;
    for (let r = 0; r < v.length; r++) {
      if (String(v[r][0]).trim() !== seg) continue;
      const hdr = r + 1, h = {};
      (v[hdr] || []).forEach((x, i) => { if (x !== '' && x != null) h[String(x).trim()] = i; });
      const rows = [];
      for (let k = hdr + 1; k < v.length && String(v[k][0]).trim() !== ''; k++) rows.push(k);
      return { hdr, h, rows };
    }
    return null;
  };
  const SEG = '40-99';
  const blk = data['NS_v2'] && nsBlock('NS_v2', SEG);
  const nsHCOf = (seg) => ECOGAINS_SIM('NONPAYER', seg)[NS_I][0];
  const nsResOf = (seg, res) => ECOGAINS_SIM('NONPAYER', seg)[NS_I][RESOURCES.indexOf(res)];
  // sptTotals_ memoises on the ctx (ctx._spt), which would survive a mutation in this process —
  // drop the memo so each read prices the CURRENT config.
  const sptSim = (seg) => { const c = Context.get(); delete c._spt; return sptTotals_(seg, 'NONPAYER', c).sim; };

  if (!blk) {
    gate('NS_v2 has a readable ' + SEG + ' ladder block', false);
  } else {
    const hcCells = blk.rows.map(r => [r, blk.h['HC Reward']]);
    const reqCells = blk.rows.map(r => [r, blk.h['Cum Streak Req']]);
    const base = nsHCOf(SEG);

    // rewards: doubling every NS_v2 HC reward doubles E_v2 -> doubles R -> doubles the NS row
    const dbl = mutate('NS_v2', hcCells, (x) => x * 2, () => nsHCOf(SEG));
    gate('NS_v2 HC rewards x2 -> NS row x2 (R = E_v2/E_base flows)',
         base > 0 && Math.abs(dbl - 2 * base) < 1e-6, `${fmt(base)} -> ${fmt(dbl)}`);

    // requirements: pushing the streak gates out lowers survival on the v2 side only -> R < 1
    const harder = mutate('NS_v2', reqCells, (x) => x * 3, () => nsHCOf(SEG));
    gate('NS_v2 requirements x3 -> NS row falls (requirement edits flow through the same S)',
         harder < base - 1e-9, `${fmt(base)} -> ${fmt(harder)}`);

    // base-0 addition: SPT is 0 on both ladders and 0 in data_gains, so typing it into NS_v2 has
    // no anchor -> the engine must ADD E_v2[SPT] x Σp_day. Expectation recomputed via nsE_.
    if (blk.h['SPT'] != null) {
      const sptCells = blk.rows.map(r => [r, blk.h['SPT']]);
      const got = mutate('NS_v2', sptCells, 5, () => {
        const c3 = Context.get(), b = c3.ds.beh(SEG, 'NONPAYER');
        const E = nsE_(SEG, 'NONPAYER', c3.ds);
        const days = reachSum_(c3.calNew['Night Sky'] || [], num(b.weekday_active_rate), num(b.weekend_active_rate));
        return { sim: nsResOf(SEG, 'SPT'), want: num(E.eV2['SPT']) * days,
                 measSPT: num(measuredRow_('Daily Night Sky Prize', SEG, 'NONPAYER', c3.ds)['SPT']) };
      });
      gate('NS_v2 SPT with no measured anchor -> added bottom-up (E_v2 x Σp_day)',
           got.measSPT < 1e-9 && got.want > 0 && Math.abs(got.sim - got.want) < 1e-6,
           `sim ${fmt(got.sim)} vs ${fmt(got.want)}`);
      const sptBefore = sptSim(SEG);
      const sptAfter = mutate('NS_v2', sptCells, 5, () => sptSim(SEG));
      gate('NS SPT reaches the Season Pass faucet (sptTotals_ sees it)',
           sptAfter > sptBefore + 1e-9, `${fmt(sptBefore)} -> ${fmt(sptAfter)}`);
    }

    // packs: no anchor either, but they take the standard pack lane (participation x reach), NOT
    // the base-0 bottom-up addition — that distinction is the whole of the D22 pack decision.
    if (blk.h['3-star Dly'] != null && typeof packLane_ === 'function') {
      const packCells = blk.rows.map(r => [r, blk.h['3-star Dly']]);
      const got = mutate('NS_v2', packCells, 1, () => {
        const c5 = Context.get(), b = c5.ds.beh(SEG, 'NONPAYER');
        const E = nsE_(SEG, 'NONPAYER', c5.ds);
        const inst = c5.ds.eventInst('Night Sky', SEG, 'NONPAYER');
        const part = (inst && num(inst.participation_rate) > 0) ? num(inst.participation_rate) : 1;
        // D26: the reach sum runs over the IN-SEASON instances only — an instance wholly past the
        // envelope cutoff pays no packs, and Night Sky is the source that feels it most (4 of its
        // 33 one-day instances fall outside). Recomputing the expectation with seasonInsts_ keeps
        // this a test of the PRICING RULE rather than of a particular calendar's length.
        const nsInsts = seasonInsts_(c5.calNew['Night Sky'] || [], 'Night Sky');
        const reach = reachSum_(nsInsts, num(b.weekday_active_rate), num(b.weekend_active_rate));
        return { sim: nsResOf(SEG, '3-star Pack'), want: num(E.eV2['3-star Pack']) * part * reach,
                 part, nIn: nsInsts.length, nAll: (c5.calNew['Night Sky'] || []).length };
      });
      gate('NS packs priced through packLane_ (E_v2 x participation x Σreach, in-season instances)',
           got.want > 0 && Math.abs(got.sim - got.want) < 1e-6,
           `sim ${fmt(got.sim)} vs ${fmt(got.want)} (participation ${fmt(got.part)}, ` +
           `${got.nIn}/${got.nAll} instances in season)`);
    }

    // missing NS_v2 entirely -> fall back to NS -> R = 1 -> sim == measured x T
    const savedSheet = data['NS_v2'];
    delete data['NS_v2'];
    eval(engineSrc); resetSheetCache();
    const c4 = Context.get();
    const T4 = timingRatio_(c4.calCur['Night Sky'] || [], c4.calNew['Night Sky'] || [], SEG, 'NONPAYER', c4.ds);
    const meas4 = num(measuredRow_('Daily Night Sky Prize', SEG, 'NONPAYER', c4.ds)['HC']);
    // The fallback's POINT is "an unauthored NS_v2 reads as config-unchanged", i.e. R = 1 against a
    // measured anchor. In NEW SOURCE mode there is no measured anchor by construction, so the
    // assertion to make is the other one: the lane still prices off the NS ladder and is non-zero.
    if (typeof NS_ANCHORED !== 'undefined' && !NS_ANCHORED){
      gate('NS_v2 sheet absent -> falls back to the NS ladder (new-source mode: still priced, not zero)',
           nsHCOf(SEG) > 0, `sim ${fmt(nsHCOf(SEG))} off the NS ladder`);
    } else {
      gate('NS_v2 sheet absent -> falls back to NS (R = 1): sim == measured x T',
           Math.abs(nsHCOf(SEG) - meas4 * T4) < 1e-6, `sim ${fmt(nsHCOf(SEG))} vs ${fmt(meas4 * T4)}`);
    }
    data['NS_v2'] = savedSheet;
    eval(engineSrc); resetSheetCache();
  }
}

// ---------- NS weekday/weekend split gates (D23) ----------------------------------------------
// The redesign runs TWO Night Skies: 'NS_v2' is the WEEKEND ladder, 'NS_v2_weekday' the weekday
// one, and the engine folds them into one expected-per-active-day value weighted by the expected
// active days of each day type. Workbooks predating the split have no weekday sheet, so every
// gate here INJECTS one (snapshot -> mutate -> assert -> restore) instead of depending on the
// dump shipping it: that way the gates hold on any workbook, and the no-sheet case is itself an
// assertion rather than an accident.
console.log('\n================ NS DAY-TYPE SPLIT GATES (D23) ================');
{
  const SEG = '40-99';
  const nsRow = (seg) => ECOGAINS_SIM('NONPAYER', seg)[NS_I];
  const nsHC = (seg) => nsRow(seg)[0];
  const savedWd = data['NS_v2_weekday'] ? JSON.parse(JSON.stringify(data['NS_v2_weekday'])) : null;
  const restore = () => {
    if (savedWd) data['NS_v2_weekday'] = savedWd; else delete data['NS_v2_weekday'];
    eval(engineSrc); resetSheetCache();
  };
  const withWeekdaySheet = (build, fn) => {
    data['NS_v2_weekday'] = build();
    eval(engineSrc); resetSheetCache();
    const out = fn();
    restore();
    return out;
  };
  // Weekend share recomputed HERE, from the engine's isWeekend_ rule and data_seg_beh, so the
  // gate never just re-reads the number the engine wrote.
  const shareOf = (seg) => {
    const c = Context.get(), b = c.ds.beh(seg, 'NONPAYER');
    let pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
    if (!(pWd > 0) && !(pWe > 0)) { pWd = 1; pWe = 1; }
    let wd = 0, we = 0, wdD = [], weD = [];
    (c.calNew['Night Sky'] || []).forEach(inst => (inst.days || []).forEach(d => {
      if (isWeekend_(d)) { we += pWe; weD.push(d); } else { wd += pWd; wdD.push(d); }
    }));
    return { we: wd + we > 0 ? we / (wd + we) : 0, wdDays: wdD, weDays: weD };
  };

  const baseRow = nsRow(SEG).slice();
  const sh = shareOf(SEG);

  gate('cal_new Night Sky days split into both day types (isWeekend_ = Fri/Sat/Sun)',
       sh.wdDays.length > 0 && sh.weDays.length > 0 &&
       sh.weDays.every(d => [2, 3, 4].indexOf((d - 1) % 7) !== -1) &&
       sh.wdDays.every(d => [2, 3, 4].indexOf((d - 1) % 7) === -1),
       `${sh.wdDays.length} weekday + ${sh.weDays.length} weekend days, weekend share of active days ${(sh.we * 100).toFixed(1)}%`);

  // (a) no weekday sheet -> no variant -> the blend collapses to NS_v2 and the D22 model is
  //     reproduced EXACTLY. This is the gate that keeps the split from touching older workbooks.
  {
    if (data['NS_v2_weekday']) { delete data['NS_v2_weekday']; eval(engineSrc); resetSheetCache(); }
    const c = Context.get(), E = nsE_(SEG, 'NONPAYER', c.ds, c);
    const same = E && RESOURCES.every(r => Math.abs(num(E.eV2[r]) - num(E.eV2Weekend[r])) < 1e-12);
    gate("no 'NS_v2_weekday' sheet -> blend collapses to NS_v2 (pre-D23 behaviour reproduced)",
         !!E && !E.hasWeekdayVariant && same);
    restore();
  }

  // (b) weekday ladder == weekend ladder -> the split must be INVISIBLE. Same property the D22
  //     re-anchor exists for: the model cannot invent a change nobody configured.
  {
    const row = withWeekdaySheet(() => JSON.parse(JSON.stringify(data['NS_v2'])), () => nsRow(SEG));
    let worst = 0;
    RESOURCES.forEach((r, i) => { worst = Math.max(worst, Math.abs(row[i] - baseRow[i])); });
    gate('NS_v2_weekday == NS_v2 -> NS row unchanged (a split into two identical ladders is a no-op)',
         worst < 1e-9, `worst |delta| ${worst.toExponential(2)}`);
  }

  // (c) the weight itself: zero every HC reward on the WEEKDAY ladder and the NS row must fall to
  //     exactly the weekend share of itself — "the weekend event only runs on weekend days".
  {
    const zeroHC = () => {
      const cl = JSON.parse(JSON.stringify(data['NS_v2']));
      for (let r = 0; r < cl.values.length; r++) {
        const hdrRow = cl.values[r] || [];
        const hc = hdrRow.indexOf('HC Reward');
        if (hc === -1) continue;
        for (let k = r + 1; k < cl.values.length && String((cl.values[k] || [])[0]).trim() !== ''; k++)
          cl.values[k][hc] = 0;
      }
      return cl;
    };
    const got = withWeekdaySheet(zeroHC, () => {
      const c = Context.get(), E = nsE_(SEG, 'NONPAYER', c.ds, c);
      return { hc: nsHC(SEG), eV2: num(E.eV2['HC']), eWe: num(E.eV2Weekend['HC']),
               eWd: num(E.eV2Weekday['HC']), we: E.split.we, variant: E.hasWeekdayVariant };
    });
    gate('weekday HC zeroed -> E_v2[HC] == E_weekend[HC] x weekend share of active days',
         got.variant && got.eWd < 1e-12 && got.eWe > 0 &&
         Math.abs(got.eV2 - got.eWe * got.we) < 1e-12,
         `E_v2 ${fmt(got.eV2)} vs ${fmt(got.eWe * got.we)} (weekend share ${(got.we * 100).toFixed(1)}%)`);
    gate('weekday HC zeroed -> the NS row falls to exactly that share of itself',
         baseRow[0] > 0 && Math.abs(got.hc - baseRow[0] * sh.we) < 1e-6,
         `${fmt(baseRow[0])} -> ${fmt(got.hc)} (expected ${fmt(baseRow[0] * sh.we)})`);

    // (d) master switch: the same injected weekday sheet must be IGNORED with the split off.
    const engineSplitOff = engineSrc.replace(/var NS_DAYTYPE_SPLIT = (?:true|false)/,
                                             'var NS_DAYTYPE_SPLIT = false');
    gate('NS_DAYTYPE_SPLIT variants are distinct (the flip actually rewrites the source)',
         engineSplitOff !== engineSrc);
    data['NS_v2_weekday'] = zeroHC();
    eval(engineSplitOff); resetSheetCache();
    const offHC = nsHC(SEG);
    restore();
    gate('NS_DAYTYPE_SPLIT = false -> the weekday sheet is ignored, NS_v2 prices every day',
         Math.abs(offHC - baseRow[0]) < 1e-6, `${fmt(offHC)} vs baseline ${fmt(baseRow[0])}`);
  }

  gate('NS day-type mutations restored (baseline reproduces)',
       Math.abs(nsHC(SEG) - baseRow[0]) < 1e-9, `${fmt(nsHC(SEG))} vs ${fmt(baseRow[0])}`);
}


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
// Was `RESOURCES.length === 19`, which froze the resource count and went red the moment
// ToF_Ticket was appended as #20 (2026-09-02) - a deliberate, correct change. What matters here is
// that the spill is exactly as wide as the resource list; the stronger check - that those columns
// match the DISPLAY SHEET's headers name for name - lives in _mock_cards.js, because this dump has
// no EcoGainsSim sheet to compare against (the ECO workbook is on the 13-resource lineage).
gate('spill width == RESOURCES.length',
     baseline[0].length === RESOURCES.length,
     baseline[0].length + ' columns vs ' + RESOURCES.length + ' resources');

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
  // (15)+: whether the loss CROSSES a tier boundary is workbook state (wb13/14 R=0.495 -> Ts 18;
  // wb15 R=0.812 -> Ts 23 == Tm). Assert direction only; the SP_v2 Cumul x2 mutation below
  // exercises the actual drop mechanism regardless of the shipped panel magnitude.
  gate(`tier does not rise with the SPT loss (Ts <= Tm) [${SP_SEG}]`, Tm > 0 && Ts <= Tm,
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
       `max err ${maxE.toExponential(2)}; moved: ${scaled.join(', ') || `(none — Ts==Tm ${Ts}==${Tm}, ladders/pot/timing flat; movement mechanism gated by the x2 mutation below)`}`);
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

// SPT-3b: mirrored mutation — SP_v2 Cumul ladder DOUBLED -> tiers DROP (Ts < Tm) and anchored
// resources scale DOWN through the cum ratio. Magnitude-independent replacement for the old
// "tier drops with the shipped panel" gate, which rotted when wb15 softened SP_v2 (R 0.495 -> 0.812).
{
  const origSP_v2 = data['SP_v2'] ? JSON.parse(JSON.stringify(data['SP_v2'])) : null;
  const clone = JSON.parse(JSON.stringify(data['SP']));
  for (let r = 4; r < clone.values.length; r++) {              // 0-based rows 4.. = tier rows 5..
    const v = +clone.values[r][2];
    if (v > 0) clone.values[r][2] = v * 2;                     // Cumul col C doubled
  }
  data['SP_v2'] = clone;
  eval(engineSrc); resetSheetCache();
  const c4 = Context.get();
  const t = sptTotals_(SP_SEG, 'NONPAYER', c4);
  const base = readSPTrack_('SP'), v2 = readSPTrack_('SP_v2');
  const dB = readSPSeasonDays_('SP') || 33, dV = readSPSeasonDays_('SP_v2') || dB;
  const Tm = spTier_(t.meas * dB / 33, base.cum), Ts = spTier_(t.sim * dV / 33, v2.cum);
  gate(`SP_v2 Cumul x2 -> tier drops (Ts < Tm) [${SP_SEG}]`, Ts < Tm, `Tm ${Tm} -> Ts ${Ts}`);
  const cb = spCumTo_(base, Tm, 'NONPAYER'), cs = spCumTo_(v2, Ts, 'NONPAYER');
  const row = ECOGAINS_SIM('NONPAYER', SP_SEG)[idx('Season Pass (Free)')];
  const measRow = measuredRow_('Season Pass (Free)', SP_SEG, 'NONPAYER', c4.ds);
  const moved = RESOURCES.filter(r => !isPackRes_(r) && num(measRow[r]) > 0 && num(cb[r]) > 0 &&
        Math.abs(num(cs[r]) / num(cb[r]) - 1) > 1e-9 &&
        Math.abs(row[RESOURCES.indexOf(r)] - num(measRow[r])) > 1e-9);
  gate('forced tier drop -> at least one anchored Season Pass resource moves (coupling is live)',
       moved.length > 0,
       moved.map(r => `${r} ${num(measRow[r]).toFixed(2)}->${row[RESOURCES.indexOf(r)].toFixed(2)}`).join(', ') || '(none moved)');
  if (origSP_v2) data['SP_v2'] = origSP_v2; else delete data['SP_v2'];
  eval(engineSrc); resetSheetCache();
  const again2 = ECOGAINS_SIM('NONPAYER', '40-99');
  gate('SP_v2 x2 mutation restored (baseline reproduces)',
       CATEGORY_ORDER.every((c, i) => RESOURCES.every((r, j) => Math.abs(again2[i][j] - baseline[i][j]) < 1e-12)));
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
  // DATA-AWARE (D18): the synthetic anchor fires only while data_gains has no Core SPT rows.
  // Workbook (14)'s re-pull DOES carry them, so the synthetic stands down and the raw value is
  // the anchor — that is the designed takeover, not a regression. Gate whichever path is live.
  const synthetic = (rawCore === 0);
  const anchor = synthetic ? Lexp * eBase : rawCore;
  gate(`Core SPT anchor ${synthetic ? 'SYNTHETIC (raw 0, meas = L x E_base)' : 'RAW (data_gains carries Core SPT)'}`,
       measCore > 0 && Math.abs(measCore - anchor) < 1e-6,
       `raw ${rawCore.toFixed(2)} · meas ${measCore.toFixed(2)} vs anchor ${anchor.toFixed(2)}` +
       (synthetic ? ` (L ${Lexp.toFixed(1)} x E ${eBase.toFixed(2)})` : ''));
  gate('Core SPT sim = meas x R' + (synthetic ? ' (= L x E_v2)' : ''),
       Math.abs(coreSPT - measCore * R) < 1e-6 &&
       (!synthetic || Math.abs(coreSPT - Lexp * eV2) < 1e-6),
       `sim ${coreSPT.toFixed(2)} vs ${(measCore * R).toFixed(2)} (R=${R.toFixed(3)})`);
  // both sides of the tier coupling must include the Core faucet, whichever anchor is live
  const t = sptTotals_('40-99', 'NONPAYER', Context.get());
  let rawMeasTotal = 0;
  CATEGORY_ORDER.forEach((cat) => {
    rawMeasTotal += c.ds.gains('40-99', 'NONPAYER', cat, 'SPT') + 2 * c.ds.gains('40-99', 'NONPAYER', cat, 'SPTx2');
  });
  const expectTotal = synthetic ? rawMeasTotal + Lexp * eBase : rawMeasTotal;
  gate('sptTotals_ measured side includes the Core faucet',
       Math.abs(t.meas - expectTotal) < 1e-6,
       `meas ${t.meas.toFixed(2)} vs ${expectTotal.toFixed(2)}`);
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
