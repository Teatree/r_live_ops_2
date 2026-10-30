// D79 gates (2026-10-30): the engine changes the config-proposal work needed before a single
// proposal could be priced on LIVE_OPS_V3 (8).
//   a. the calendar grid reads to AI, and "the whole grid" is the last column actually used
//   b. A/B arm filter: a data_* sheet with ab_variant is read for ANCHOR_ARM only
//   c. the export's own span (window_start_date..data_through_date) scales it to the window
//   d. a resource the BASE ladder never pays is priced bottom-up when a _v2 ladder adds it
//   e. Saga: an item the base chapter chests never pay (an envelope) is priced off saga completions
//   f. the card sim reads PackConfig_v2 / AlbumConfig_v2 on the redesign side, the base on the anchor
//   g. ToF reads ToF_v2 on the redesign side; the measured anchor keeps the base ToF sheet
//   h. always-on envelopes (Daily Gift, Saga) reach the card sim, per active day
// Every gate snapshots the sheet it mutates and restores it; none asserts a workbook number.
//
//   node harness/_mock_d79.js [--data eval|v3g|<path>]      (default: the eval fixture)
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'eval');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function GATES(){
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol) * Math.max(1, Math.abs(a), Math.abs(b));
  const fresh = () => { resetSheetCache_mock(); return Context.get(); };
  const colOf = (sheet, hdrRow, label) => {               // 1-based header row -> 0-based column
    const h = data[sheet].values[hdrRow - 1] || [];
    for (let c = 0; c < h.length; c++) if (String(h[c]).trim() === label) return c;
    return -1;
  };
  const withSheets = (names, fn) => {                       // snapshot -> mutate -> restore
    const snap = {}; names.forEach(n => { snap[n] = clone(data[n]); });
    try { return fn(); } finally { names.forEach(n => { data[n] = snap[n]; }); fresh(); }
  };
  const SEG = '20-39', PAY = 'PAYER';
  let ctx = fresh();

  console.log('\n================ D79a: the grid reads to AI ================');
  check('the grid is 34 days on a calendar that uses column AI', calGridDays_() === 34, 'got ' + calGridDays_());
  check('the counted window is 28 days (H..AI)', windowDays_() === 28, 'got ' + windowDays_());
  const sp = (ctx.calNew['Season Pass'] || [])[0], tf = (ctx.calNew['ToF'] || [])[0];
  check('the Season Pass lane merged H:AI spans window days 1..28', !!sp && sp.days[0] === 1 && sp.days[sp.days.length - 1] === 28,
        sp ? sp.days[0] + '..' + sp.days[sp.days.length - 1] : 'missing');
  check('the ToF lane merged H:AI spans window days 1..28', !!tf && tf.days.length === 28);
  withSheets(['cal_curr', 'cal_new', 'cal_parsed'], () => {
    ['cal_curr', 'cal_new'].forEach(n => { for (let r = 4; r <= 25; r++){ const row = data[n].values[r - 1]; if (row && row.length >= 35) row[34] = ''; } });
    delete data['cal_parsed'];
    fresh();
    check('RULE: with column AI empty the grid is the 33-day B..AH layout (older workbooks bit-identical)',
          calGridDays_() === 33, 'got ' + calGridDays_());
  });

  console.log('\n================ D79b: the A/B arm filter ================');
  const gv = data['data_gains'].values, gh = gv[0];
  const ix = (n) => gh.indexOf(n);
  const pick = (arm) => gv.find(r => r[ix('ab_variant')] === arm && r[ix('engagement_segment')] === 'D. 20-39' &&
                                     r[ix('payer_flag')] === PAY && r[ix('category')] === 'Core' && r[ix('resource')] === 'HC');
  const rA = pick('Variant A'), rC = pick('Control');
  check('the fixture carries both arms for one key', !!rA && !!rC && rA[ix('amount_per_earner')] !== rC[ix('amount_per_earner')]);
  const raw = () => { const ds = DataStore.fromRanges(data['data_gains'].values, data['data_seg_beh'].values, [], [], [], [], []);
                      return ds.gains(SEG, PAY, 'Core', 'HC'); };
  check('ANCHOR_ARM = Variant A reads the Variant A row', near(raw(), rA[ix('amount_per_earner')]));
  const keepArm = ANCHOR_ARM;
  try {
    ANCHOR_ARM = 'Control';
    check('RULE: ANCHOR_ARM = Control reads the Control row', near(raw(), rC[ix('amount_per_earner')]));
    ANCHOR_ARM = 'Nobody';
    check('RULE: an arm with no rows reads the sheet whole (last row wins, as before)', near(raw(), rA[ix('amount_per_earner')]));
  } finally { ANCHOR_ARM = keepArm; }
  withSheets(['data_gains'], () => {
    // without the column, rows are read exactly as before D79: Control first, Variant A second
    const c = ix('ab_variant'); data['data_gains'].values.forEach((r, i) => { r[c] = i ? '' : 'x_ab_variant'; });
    check('RULE: no ab_variant column -> every row read (pre-D79 behaviour)', near(raw(), rA[ix('amount_per_earner')]));
  });

  console.log('\n================ D79c: the export\'s own span ================');
  ctx = fresh();
  const span = ctx.ds.span, ws = ctx.dataSpan;
  check('data_gains carries a 16-day span', !!span && span.days === 16, span ? JSON.stringify(span) : 'none');
  check('the span sits on window days -5..10 (Oct 13 .. Oct 28 against day 1 = Oct 19)', !!ws && ws.first === -5 && ws.last === 10,
        ws ? ws.first + '..' + ws.last : 'none');
  const b = ctx.ds.beh(SEG, PAY), pwd = Number(b.weekday_active_rate), pwe = Number(b.weekend_active_rate);
  let num_ = 0, den_ = 0;
  for (let d = 1; d <= 28; d++) num_ += isWeekend_(d) ? pwe : pwd;
  for (let d = -5; d <= 10; d++) den_ += isWeekend_(d) ? pwe : pwd;
  const rawCore = rA[ix('amount_per_earner')];
  check('an export amount is scaled by SUM p_day(window) / SUM p_day(span)',
        near(ctx.ds.gains(SEG, PAY, 'Core', 'HC'), rawCore * num_ / den_, 1e-9),
        (num_ / den_).toFixed(4) + 'x');
  withSheets(['cal_curr', 'cal_new'], () => {
    ['cal_curr', 'cal_new'].forEach(n => { data[n].values[0][7] = ''; });
    const c2 = fresh();
    check('RULE: no date above day 1 -> the span cannot be placed, the D71 grid rule applies',
          c2.dataSpan === null && near(c2.ds.gains(SEG, PAY, 'Core', 'HC'), rawCore * windowScale_('Core', SEG, PAY, c2), 1e-9));
  });
  const keepSpan = DATA_SPAN_RESCALE;
  try { DATA_SPAN_RESCALE = false; const c3 = fresh();
        check('RULE: DATA_SPAN_RESCALE = false restores the D71 rule', c3.dataSpan === null); }
  finally { DATA_SPAN_RESCALE = keepSpan; fresh(); }

  console.log('\n================ D79d: base-0 additions on timed sources ================');
  ctx = fresh();
  const hhSpt = colOf('HH_v2', 11, 'SPT');
  const before = simHatchlingHideaway(SEG, PAY, ctx), measBefore = measuredRow_('Hatchling Hideaway', SEG, PAY, ctx.ds);
  check('Hatchling pays no SPT on either ladder today (the case D79 exists for)', hhSpt >= 0 &&
        !(Number(rewardE_('Hatchling Hideaway', SEG, PAY, ctx.ds).eBase['SPT']) > 0));
  withSheets(['HH_v2'], () => {
    data['HH_v2'].values[11][hhSpt] = 100;                 // Gate 1 pays 100 SPT on the redesign
    const c = fresh();
    const E = rewardE_('Hatchling Hideaway', SEG, PAY, c.ds);
    const insts = c.calNew['Hatchling Hideaway'] || [];
    const bb = c.ds.beh(SEG, PAY);
    let reach = 0; insts.forEach(x => { reach += reachOne_(x, Number(bb.weekday_active_rate), Number(bb.weekend_active_rate)); });
    const expect = Number(E.eV2['SPT']) * packParticipation_('Hatchling Hideaway', E.inst) * reach;
    const after = simHatchlingHideaway(SEG, PAY, c);
    check('an SPT typed on a _v2 rung the base never paid is priced bottom-up: E_v2 x participation x SUM reach',
          expect > 0 && near(Number(after['SPT']) - Number(before['SPT']), expect, 1e-9),
          (Number(after['SPT']) - Number(before['SPT'])).toFixed(2) + ' vs ' + expect.toFixed(2));
    check('every other resource of the row is untouched', RESOURCES.every(r => r === 'SPT' || near(Number(after[r]), Number(before[r]))));
    check('the measured side adds nothing (its E is the base)', near(Number(measuredRow_('Hatchling Hideaway', SEG, PAY, c.ds)['SPT']), Number(measBefore['SPT'])));
    const keep = BASE0_BOTTOMUP;
    try { BASE0_BOTTOMUP = false; fresh();
          check('RULE: BASE0_BOTTOMUP = false carries it (pre-D79)', near(Number(simHatchlingHideaway(SEG, PAY, Context.get())['SPT']), Number(before['SPT']))); }
    finally { BASE0_BOTTOMUP = keep; }
  });
  // a resource the base DOES pay keeps the ratio path: doubling it on Kite adds nothing bottom-up
  withSheets(['Ki_v2'], () => {
    const c0 = fresh(), E0 = rewardE_('Kite Festival', SEG, PAY, c0.ds);
    const res = RESOURCES.find(r => BOTTOMUP_RES.indexOf(r) < 0 && Number(E0.eBase[r]) > 0);
    const spec = LB_R_SPECS['Kite Festival'], kv = data['Ki_v2'].values;
    const lab = Object.keys(RES_MAP).find(k => RES_MAP[k] === res && colOf('Ki_v2', spec.hdr + 1, k) >= 0);
    const kc = colOf('Ki_v2', spec.hdr + 1, lab);
    const s0 = simKiteFestival(SEG, PAY, c0);
    for (let r = spec.r0; r <= spec.r1; r++) if (kv[r] && Number(kv[r][kc]) > 0) kv[r][kc] = 2 * Number(kv[r][kc]);
    const c1 = fresh(), s1 = simKiteFestival(SEG, PAY, c1);
    const R1 = Number(rewardE_('Kite Festival', SEG, PAY, c1.ds).eV2[res]) / Number(E0.eBase[res]);
    check('RULE: a resource the base pays stays measured x R x T (no bottom-up on top) - Kite ' + res,
          !!res && kc >= 0 && near(Number(s1[res]), Number(s0[res]) * R1, 1e-9),
          res + ': ' + Number(s0[res]).toFixed(2) + ' x ' + (R1 || 0).toFixed(3) + ' = ' + Number(s1[res]).toFixed(2));
  });

  console.log('\n================ D79e: Saga base-0 additions ================');
  ctx = fresh();
  const sv = data['c_saga_v2'].values, hdrS = sv.findIndex(r => r && r[0] === 'Node');
  const c1s = sv[hdrS].indexOf('1-star Dly');
  const sagaBefore = simSaga(SEG, PAY, ctx);
  withSheets(['c_saga_v2'], () => {
    data['c_saga_v2'].values[hdrS + 10][c1s] = 1;           // node 10 pays one 1-star envelope
    const c = fresh();
    const L = sagaCompletions_(SEG, PAY, c);
    const s = simSaga(SEG, PAY, c);
    check('a chapter envelope is priced off saga completions: (1 envelope / 100 levels) x completions',
          L > 0 && near(Number(s['1-star Pack']), L / 100, 1e-9), Number(s['1-star Pack']).toFixed(3) + ' vs ' + (L / 100).toFixed(3));
    check('the rest of the Saga row is untouched', RESOURCES.every(r => r === '1-star Pack' || near(Number(s[r]), Number(sagaBefore[r]))));
    check('the measured Saga row has no envelope', !(Number(measuredRow_('Saga', SEG, PAY, c.ds)['1-star Pack']) > 0));
    const ao = alwaysOnPacks_(SEG, PAY, c, Number(c.ds.beh(SEG, PAY).weekday_active_rate), Number(c.ds.beh(SEG, PAY).weekend_active_rate));
    const sg = ao.find(x => x.cat === 'Saga');
    let pd = 0; for (let d = 1; d <= DAILY_DAYS; d++) pd += isWeekend_(d) ? Number(c.ds.beh(SEG, PAY).weekend_active_rate) : Number(c.ds.beh(SEG, PAY).weekday_active_rate);
    check('the card sim pays it per active day at total / SUM p_day', !!sg && near(sg.perDay['1-star Pack'], Number(s['1-star Pack']) / pd, 1e-9));
  });

  console.log('\n================ D79f: the card sim reads the _v2 card sheets ================');
  ctx = fresh();
  check('the redesign side reads PackConfig_v2 / AlbumConfig_v2', cardSheet_('PackConfig') === 'PackConfig_v2' && cardSheet_('AlbumConfig') === 'AlbumConfig_v2');
  withSheets(['PackConfig_v2'], () => {
    const pv = data['PackConfig_v2'].values, pr = pv.findIndex(r => r && String(r[0]).trim() === '1-star Pack');
    const was = Number(pv[pr][1]); pv[pr][1] = was + 5;
    fresh();
    const cfgNew = loadPackConfig_();
    const wasBase = _baseSide; _baseSide = true; let cfgBase;
    try { cfgBase = loadPackConfig_(); } finally { _baseSide = wasBase; }
    check('an edit to PackConfig_v2 reaches the redesign side', Number(cfgNew.cardsPerOpen['1-star Pack']) === was + 5,
          'cards/open ' + cfgNew.cardsPerOpen['1-star Pack']);
    check('the anchor side (_baseSide) keeps PackConfig', Number(cfgBase.cardsPerOpen['1-star Pack']) === was);
    const keep = CARD_V2_CONFIGS;
    try { CARD_V2_CONFIGS = false; fresh();
          check('RULE: CARD_V2_CONFIGS = false reads PackConfig on both sides', Number(loadPackConfig_().cardsPerOpen['1-star Pack']) === was); }
    finally { CARD_V2_CONFIGS = keep; }
  });

  console.log('\n================ D79g: ToF reads ToF_v2 on the redesign side ================');
  ctx = fresh();
  const tofBefore = simToF(SEG, PAY, ctx, 'ToF'), synthBefore = measuredRow_('ToF', SEG, PAY, ctx.ds);
  withSheets(['ToF_v2'], () => {
    const tv = data['ToF_v2'].values, hdrT = tv.findIndex(r => r && String(r[0]).trim() === 'Stage' && String(r[1]).trim() === 'Type');
    const sptC = tv[hdrT].indexOf('SPT');
    for (let r = hdrT + 1; r < tv.length && tv[r] && tv[r][0] !== '' && !isNaN(parseFloat(tv[r][0])); r++)
      if (Number(tv[r][sptC]) > 0) tv[r][sptC] = 10 * Number(tv[r][sptC]);
    const c = fresh();
    const after = simToF(SEG, PAY, c, 'ToF'), synthAfter = measuredRow_('ToF', SEG, PAY, c.ds);
    check('an edit to ToF_v2 reaches the simulated ToF row', Number(after['SPT']) > 5 * Number(tofBefore['SPT']),
          Number(tofBefore['SPT']).toFixed(1) + ' -> ' + Number(after['SPT']).toFixed(1));
    check('the measured ToF anchor keeps the base ToF sheet', near(Number(synthAfter['SPT']), Number(synthBefore['SPT'])));
    const keep = TOF_V2_CONFIG;
    try { TOF_V2_CONFIG = false; const c2 = fresh();
          check('RULE: TOF_V2_CONFIG = false reads ToF on both sides', near(Number(simToF(SEG, PAY, c2, 'ToF')['SPT']), Number(tofBefore['SPT']))); }
    finally { TOF_V2_CONFIG = keep; }
  });

  console.log('\n================ D79h: always-on envelopes reach the card sim ================');
  ctx = fresh();
  const dg = resultRow_('Daily Gift', SEG, PAY, ctx);
  const dgPacks = PACK_RES.reduce((a, t) => a + Number(dg[t] || 0), 0);
  check('the daily gift pays envelopes in the gains model on this dump', dgPacks > 0, dgPacks.toFixed(2) + ' per player');
  const cfg = loadPackConfig_(), cat = loadCardCatalog_(cfg, SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cardSheet_('AlbumConfig')));
  const pre = cardSeasonPre_(SEG, PAY, ctx);
  let got = 0; const N = 300;
  for (let k = 0; k < N; k++){ const r = runOneCardSeason_(SEG, PAY, 777 + 13 * k, cfg, cat, pre); got += Number((r.bySource['Daily Gift'] || {}).packs || 0); }
  got /= N;
  // Bernoulli/attendance noise over 300 seasons: well inside 10% at these counts
  check('the card sim opens the daily gift\'s envelopes: mean per season = the gains model\'s total (+/-10%)',
        near(got, dgPacks, 0.10), got.toFixed(2) + ' vs ' + dgPacks.toFixed(2));
  const keepAO = CARD_ALWAYS_ON_PACKS;
  try { CARD_ALWAYS_ON_PACKS = false; const c2 = fresh();
        const pre2 = cardSeasonPre_(SEG, PAY, c2);
        const r2 = runOneCardSeason_(SEG, PAY, 777, cfg, cat, pre2);
        check('RULE: CARD_ALWAYS_ON_PACKS = false grants none', !r2.bySource['Daily Gift'] && !pre2.alwaysOn.length); }
  finally { CARD_ALWAYS_ON_PACKS = keepAO; fresh(); }

  console.log('\n================ D79i: each player climbs the Season Pass on their own SPT ================');
  ctx = fresh();
  {
    const preP = cardSeasonPre_(SEG, PAY, ctx);
    const tr = preP.spTrack;
    check('the card sim carries the track at every tier', !!tr && tr.byTier.length === tr.cum.length + 1);
    const runs = [];
    for (let k = 0; k < 120; k++) runs.push(runOneCardSeason_(SEG, PAY, 4242 + 31 * k, cfg, cat, preP));
    // the tier follows the player's own active days: the rule, checked player by player
    const bad = runs.filter(r => r.spTier !== spTier_(tr.total * r.activeDays / tr.expDays, tr.cum)).length;
    check('every player\'s tier = spTier_(cohort SPT x own active days / expected active days)', bad === 0, bad + ' off');
    const lo = runs.filter(r => r.activeDays <= 8), hi = runs.filter(r => r.activeDays >= 20);
    const mean = (xs, f) => xs.reduce((a, x) => a + f(x), 0) / Math.max(1, xs.length);
    check('a player with 20+ active days sits higher on the track than one with 8 or fewer',
          lo.length && hi.length && mean(hi, r => r.spTier) > mean(lo, r => r.spTier),
          mean(lo, r => r.spTier).toFixed(1) + ' vs ' + mean(hi, r => r.spTier).toFixed(1));
    const keepSP = CARD_SP_PER_PLAYER;
    try { CARD_SP_PER_PLAYER = false; const c2 = fresh(); const pre2 = cardSeasonPre_(SEG, PAY, c2);
          check('RULE: CARD_SP_PER_PLAYER = false opens the cohort tier for everyone', pre2.spTrack === null &&
                runOneCardSeason_(SEG, PAY, 4242, cfg, cat, pre2).spTier === null); }
    finally { CARD_SP_PER_PLAYER = keepSP; fresh(); }
  }

  console.log('\n================ D79j: missing event telemetry borrows a sibling ================');
  ctx = fresh();
  {
    const hasBomb = data['data_event_inst'].values.some(r => r && r[0] === 'Bomb');
    const red = ctx.ds.eventInst('Red', SEG, PAY), bomb = ctx.ds.eventInst('Bomb', SEG, PAY);
    if (!hasBomb){
      check('no Bomb rows in the pull -> Bomb\'s Challenge reads Red\'s distribution', !!red && bomb === red);
      withSheets(['data_event_inst'], () => {
        const v = data['data_event_inst'].values, row = v.find(r => r && r[0] === 'Red' && r[2] === SEG && r[1] === PAY).slice();
        row[0] = 'Bomb'; v.push(row);
        const c = fresh(), b2 = c.ds.eventInst('Bomb', SEG, PAY);
        check('RULE: a real Bomb row takes over from the proxy', !!b2 && b2 !== c.ds.eventInst('Red', SEG, PAY) && b2.event_name === 'Bomb');
      });
    } else check('SKIP proxy gate: this dump carries Bomb rows', true);
  }

  console.log('\n' + (failures ? failures + ' FAILED' : 'ALL D79 GATES PASS'));
  process.exitCode = failures ? 1 : 0;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
