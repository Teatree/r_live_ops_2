// D89 / D90 gates (2026-11-02) on the A/B lineage (LIVE_OPS_V3 (15) by default):
//   D90  the card sim's ANCHOR side draws its rungs off the BASE ladders (packRungs_ read _v2 whatever the side)
//   D89  album completion: the current season as it ran (withWindow_ from column B) and the redesign season, on
//        an inflow calibrated to the album data (k per cell x source x tier, carried streams where the model has
//        no ladder), saved to album_summary with a history; the k table cached on album_calibration
// Every gate snapshots what it mutates and restores it; none asserts a workbook number.
//
//   node harness/_mock_album.js [--data v3k|<path>] [--n 60]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3k');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function GATES(){
  const N = +(process.argv[process.argv.indexOf('--n') + 1] || 60);
  const SEED = 932341729;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol) * Math.max(1, Math.abs(a), Math.abs(b));
  const fresh = () => { resetSheetCache_mock(); return Context.get(); };
  const quiet = Logger.log; Logger.log = function(m){ logs.push(String(m)); };
  global.HtmlService = undefined;
  let ctx = fresh();

  console.log('\n================ D90: the anchor side draws off the BASE ladders ================');
  const onBase = (fn) => { const b = baseCtx_(Context.get()); _baseSide = true; try { return fn(b); } finally { _baseSide = false; } };
  const rungPacks = (rr) => (rr ? rr.groups.map(g => g.rungs.map(x => JSON.stringify(x.packs || {}))).flat() : []);
  {
    const seg = '0-9', payer = 'NONPAYER';
    const insts = (Context.get().calCur['Night Sky'] || []).slice().sort((a, b) => a.start - b.start);
    const iWe = insts.findIndex(x => isWeekend_(x.start)), iWd = insts.findIndex(x => !isWeekend_(x.start));
    const want = (lad) => lad.map(ms => { const o = {}; PACK_RES.forEach(r => { if (num(ms.rew[r]) > 0) o[r] = num(ms.rew[r]); }); return JSON.stringify(o); });
    const gotWe = onBase(b => rungPacks(packRungs_('Daily Night Sky Prize', seg, payer, b, iWe)));
    const gotWd = onBase(b => rungPacks(packRungs_('Daily Night Sky Prize', seg, payer, b, iWd)));
    const baseWe = want(nsLadderOn_('NS', seg)).filter(x => x !== '{}'), baseWd = want(nsBaseWeekdayLadder_(seg) || nsLadderOn_('NS', seg)).filter(x => x !== '{}');
    check('Night Sky on the anchor side: a weekend day pays the BASE weekend ladder (NS), a weekday the base weekday one (NS_weekday)',
          JSON.stringify(gotWe.filter(x => x !== '{}')) === JSON.stringify(baseWe) && JSON.stringify(gotWd.filter(x => x !== '{}')) === JSON.stringify(baseWd),
          'weekend ' + gotWe.join(' ') + ' | weekday ' + gotWd.join(' '));
    // RULE (mutation, no workbook state assumed): a 5-star typed on every NS_v2 round of the segment reaches the
    // redesign side's weekend rungs and not the anchor side's
    const snapNS = clone(data['NS_v2']), v = data['NS_v2'].values;
    let blk = -1;
    for (let r = 0; r < v.length; r++){ if (String((v[r] || [])[0]).trim() === seg){ blk = r; break; } }
    const hr = blk + 1, c5 = (v[hr] || []).map(x => String(x).trim()).indexOf('5-star Dly');
    for (let r = hr + 1; r <= hr + 3; r++) if (v[r] && typeof v[r][0] === 'number') v[r][c5] = num(v[r][c5]) + 1;
    fresh();
    const v2We = rungPacks(packRungs_('Daily Night Sky Prize', seg, payer, Context.get(), iWe));
    const baseWe2 = onBase(b => rungPacks(packRungs_('Daily Night Sky Prize', seg, payer, b, iWe)));
    check('RULE: a 5-star typed on NS_v2 reaches the redesign side\'s Night Sky rungs and not the anchor side\'s',
          blk >= 0 && c5 > 0 && v2We.some(x => /5-star/.test(x)) && !baseWe2.some(x => /5-star/.test(x)) &&
          JSON.stringify(baseWe2) === JSON.stringify(gotWe), v2We.join(' '));
    data['NS_v2'] = snapNS; fresh();
  }
  {
    const seg = '20-39', payer = 'PAYER';
    const lb = LB_R_SPECS['Target Day'], inst = Context.get().ds.eventInst(lb.inst, seg, payer);
    const ladOf = (sheet) => lbRankDist_(sheet, lb, inst).ladder;
    const packsOfL = (L) => Object.keys(L).sort((a, b) => a - b).map(k => { const o = {}; PACK_RES.forEach(r => { if (num(L[k][r]) > 0) o[r] = num(L[k][r]); }); return JSON.stringify(o); });
    const flat = (rr) => rr.groups[0].rungs.map(x => x.label + ':' + JSON.stringify(x.packs || {})).join(' ');
    const matches = (rr, L) => rr.groups[0].rungs.every(x => { const rk = +String(x.label).replace('rank ', ''); const want = {};
      PACK_RES.forEach(r => { if (num((L[rk] || {})[r]) > 0) want[r] = num(L[rk][r]); }); return JSON.stringify(x.packs || {}) === JSON.stringify(want); });
    const b0 = onBase(b => packRungs_('Target Day', seg, payer, b, 0)), v0 = packRungs_('Target Day', seg, payer, Context.get(), 0);
    check('Target Day: the anchor side\'s rank rungs pay the TaD ladder, the redesign\'s the TaD_v2 ladder',
          matches(b0, ladOf('TaD')) && matches(v0, ladOf('TaD_v2')), flat(b0).slice(0, 160));
    // RULE (mutation): a 1-star added to every TaD_v2 rank moves the redesign's rungs and leaves the anchor's alone
    const snapT = clone(data['TaD_v2']), tv = data['TaD_v2'].values;
    const c1 = (tv[lb.hdr] || []).map(x => String(x).trim()).indexOf('1-star Dly');
    for (let r = lb.r0; r <= lb.r1; r++) if (tv[r]) tv[r][c1] = num(tv[r][c1]) + 1;
    fresh();
    const b1 = onBase(b => packRungs_('Target Day', seg, payer, b, 0)), v1 = packRungs_('Target Day', seg, payer, Context.get(), 0);
    check('RULE: a 1-star added to every TaD_v2 rank reaches the redesign\'s rungs and not the anchor\'s',
          c1 > 0 && flat(b1) === flat(b0) && flat(v1) !== flat(v0) && v1.groups[0].rungs.every(x => num((x.packs || {})['1-star Pack']) >= 1));
    data['TaD_v2'] = snapT; fresh();
  }
  {
    const keep = PACK_RUNGS_BASE;
    try {
      PACK_RUNGS_BASE = false;
      const a = onBase(b => rungPacks(packRungs_('Daily Night Sky Prize', '0-9', 'NONPAYER', b, 3)));
      const v = rungPacks(packRungs_('Daily Night Sky Prize', '0-9', 'NONPAYER', Context.get(), 3));
      check('RULE: PACK_RUNGS_BASE = false restores the v2-only read (the anchor side draws the redesign ladder)', JSON.stringify(a) === JSON.stringify(v));
    } finally { PACK_RUNGS_BASE = keep; fresh(); }
  }
  {
    // identical ladders -> identical rungs on both sides (the D67 property the fix must keep)
    const snap = clone(data['NS']), snap2 = data['NS_weekday'] ? clone(data['NS_weekday']) : null;
    data['NS'] = clone(data['NS_v2']); if (snap2) data['NS_weekday'] = clone(data['NS_v2_weekday']);
    fresh();
    let same = true;
    for (let i = 0; i < 7; i++){
      const a = onBase(b => rungPacks(packRungs_('Daily Night Sky Prize', '20-39', 'PAYER', b, i)));
      const v = rungPacks(packRungs_('Daily Night Sky Prize', '20-39', 'PAYER', Context.get(), i));
      if (JSON.stringify(a) !== JSON.stringify(v)) same = false;
    }
    check('RULE: with the base Night Sky ladders set equal to the redesign\'s, both sides draw identical rungs', same);
    data['NS'] = snap; if (snap2) data['NS_weekday'] = snap2; fresh();
  }

  console.log('\n================ D89: the album season window ================');
  ctx = fresh();
  const w0 = calWindow_(), dow0 = calDay1Dow_(), d10 = calDay1Date_();
  const inside = withWindow_(ALBUM_SEASON_GRID_START - 1, ALBUM_SEASON_DAYS, (sctx) => ({
    col1: calWindow_().col1, days: DAILY_DAYS, dow: calDay1Dow_(), d1: calDay1Date_(), span: sctx.dataSpan ? sctx.dataSpan.first + '..' + sctx.dataSpan.last : 'none' }));
  check('withWindow_ reads the calendars from column B for 28 days, day 1 six days before the comparison window\'s',
        inside.col1 === 2 && inside.days === ALBUM_SEASON_DAYS && inside.d1 === d10 - w0.offset && inside.dow === (((dow0 - 1 - w0.offset) % 7) + 7) % 7 + 1,
        JSON.stringify(inside));
  check('...the export then covers album days ' + inside.span + ' (the album data counts from the same day 1)', inside.span === '1..16' || /^1\.\./.test(inside.span), inside.span);
  ctx = fresh();
  check('...and everything is restored afterwards (window, weekday, date, DAILY_DAYS)',
        calWindow_().col1 === w0.col1 && calDay1Dow_() === dow0 && calDay1Date_() === d10 && DAILY_DAYS === w0.days);

  console.log('\n================ D89: the calibration rules ================');
  check('album data sources map to the card sim\'s groups (prefix stripped; set rewards and chests are the core\'s own output)',
        albumSrcGroup_('UNMAPPED:dreamheist_event') === 'Daily Night Sky Prize' && albumSrcGroup_('UNMAPPED:chuck_event') === 'Challenges' &&
        albumSrcGroup_('UNMAPPED:dream_pass_event') === 'Season Pass' && albumSrcGroup_('Single Collection') === null &&
        albumSrcGroup_('UNMAPPED:open_big_reward_chest') === null && albumSrcGroup_('UNMAPPED:special_event') === 'carried' &&
        albumCatGroup_('Season Pass (Paid)') === 'Season Pass' && albumCatGroup_('Bomb Challenge') === 'Challenges');
  {
    const P = [{ label: 'X Y' }];
    const meas = { 'X Y': { players: 10000, g: { A: { '1-star Pack': 2, '3-star Pack': 0.5 }, B: { '2-star Pack': 0.004 }, carried: { '1-star Pack': 0.3 } } } };
    const model = { 'X Y': { grants: { 'A|1-star Pack': 1, 'A|3-star Pack': 0.001, 'B|2-star Pack': 0.003, 'B|1-star Pack': 0.05 }, actD: 8 } };
    const rows = albumCalibRows_(meas, model, 200, P), by = {};
    rows.forEach(r => { by[r.group + '|' + r.tier] = r; });
    check('RULE: a tier the model grants often enough is scaled: k = measured / modelled', by['A|1-star Pack'].kind === 'tier' && near(by['A|1-star Pack'].k, 2));
    check('RULE: a tier the data shows in volume but the model (nearly) never grants is carried at measured / expected active days',
          by['A|3-star Pack'].kind === 'carried' && near(by['A|3-star Pack'].carried, 0.5 / 8));
    check('RULE: a source the model has no ladder for is carried', by['carried|1-star Pack'].kind === 'carried' && near(by['carried|1-star Pack'].carried, 0.3 / 8));
    check('RULE: small on both sides -> the source\'s pooled k, or left alone', (by['B|2-star Pack'].kind === 'source' || by['B|2-star Pack'].kind === 'none'));
    const cells = albumCalibCells_(rows)['X Y'];
    check('the parsed table: carried tiers drop the model\'s sliver (k 0) and add a per-active-day stream',
          cells.k['A|3-star Pack'] === 0 && cells.carriedStreams.length === 1 && near(cells.carriedStreams[0].perDay['1-star Pack'], 0.3 / 8));
  }
  {
    // the thinning is unbiased and touches nothing else: same seeds, k 0.5 on one group
    const cfg = loadPackConfig_(), cat = loadCardCatalog_(cfg, SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cardSheet_(SHEET_ALBUM)));
    const pre = albumPreWith_(cardSeasonPre_('20-39', 'PAYER', Context.get()), null);
    const half = albumPreWith_(pre, { k: { 'Daily Night Sky Prize|1-star Pack': 0.5, 'Rainbow Maker|1-star Pack': 2.5 }, carriedStreams: [] });
    pre.collectGrants = half.collectGrants = 28;
    let ns0 = 0, ns1 = 0, rm0 = 0, rm1 = 0, otherSame = true;
    for (let k = 0; k < 120; k++){
      const a = runOneCardSeason_('20-39', 'PAYER', playerSeed_(SEED, 4, k), cfg, cat, pre);
      const b = runOneCardSeason_('20-39', 'PAYER', playerSeed_(SEED, 4, k), cfg, cat, half);
      ns0 += num(a.grantsBy['Daily Night Sky Prize|1-star Pack']); rm0 += num(a.grantsBy['Rainbow Maker|1-star Pack']);
      if (JSON.stringify(a.grantsBy) !== JSON.stringify(b.grantsBy)) otherSame = false;   // the tally is taken BEFORE calibration
      ns1 += num(((b.bySource['Daily Night Sky Prize'] || {}).tiers || {})['1-star Pack']);
    }
    check('the calibration pass\'s tally is taken before the calibration (identical seeds -> identical tallies)', otherSame);
    // the opened packs: count NS 1-star opened under k 0.5 vs 1, over the same seeds
    const opened = (p) => { let s = 0; for (let k = 0; k < 120; k++){ const r = runOneCardSeason_('20-39', 'PAYER', playerSeed_(SEED, 4, k), cfg, cat, p); s += num(((r.bySource['Daily Night Sky Prize'] || {}).tiers || {})['1-star Pack']); } return s; };
    const o0 = opened(pre), o1 = opened(half);
    check('RULE: k 0.5 on Night Sky 1-star halves the 1-star envelopes it opens (unbiased thinning)', o0 > 100 && Math.abs(o1 / o0 - 0.5) < 0.08, o0 + ' -> ' + o1);
  }

  console.log('\n================ D89: the run, the k table, the summary ================');
  const t = data['Col_Cards_Totals'];
  const snapT = clone(t.values);
  t.values[1][1] = N; t.values[1][3] = SEED;
  delete data[ALBUM_CALIB_SHEET]; delete data[ALBUM_SUMMARY_SHEET]; delete data[ALBUM_GAINS_SHEET];
  fresh();
  const t0 = Date.now();
  SimulateAlbumCompletion();
  console.log('  run 1: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s at ' + N + ' players per cell');
  const S = () => data[ALBUM_SUMMARY_SHEET].values;
  check('a run writes album_calibration and album_summary', !!data[ALBUM_CALIB_SHEET] && !!data[ALBUM_SUMMARY_SHEET]);
  const tab = (fresh(), albumCalibTab_());
  check('the k table reads back: ten cells, the data day, the inputs fingerprint', !!tab && Object.keys(tab.cells).length === 10 && tab.D > 0 && /^[0-9a-f]{8}$/.test(tab.fp),
        tab ? tab.D + ' days, #' + tab.fp : 'none');
  {
    // the central property: the calibrated inflow per cell equals the measured external inflow
    const c = data[ALBUM_CALIB_SHEET].values, h = c[3], ix = (k) => h.indexOf(k), by = {};
    c.slice(4).forEach(r => { if (!r[0]) return; const b = by[r[0]] || (by[r[0]] = { m: 0, e: 0 });
      const m = +r[ix('measured per player')], mo = +r[ix('model per player')], k = r[ix('k')], kind = r[ix('kind')];
      b.m += m; b.e += (kind === 'carried') ? m : (kind === 'none' ? mo : mo * (+k)); });
    const worst = Object.keys(by).reduce((w, cl) => Math.max(w, Math.abs(by[cl].e / by[cl].m - 1)), 0);
    check('RULE: in every cell the calibrated inflow (k x model + carried) equals the album data\'s external envelopes within 3%',
          Object.keys(by).length === 10 && worst < 0.03, 'worst ' + (100 * worst).toFixed(2) + '%');
  }
  {
    const v = S(), hdr = v[4] || [];
    const allRow = v.find(r => r[0] === 'All' && r[1] === 'All');
    check('the summary: the measured column next to both seasons at day D and the end, ten cells and an All row',
          /MEASURED album 1 \(day \d+\)/.test(String(hdr[3])) && /CURRENT sim album 1/.test(String(hdr[4])) && /REDESIGN sim album 1/.test(String(hdr[6])) &&
          v.filter(r => CLOUD_PAYERS.indexOf(r[1]) >= 0).length === 10 && !!allRow);
    const hi = v.findIndex(r => String(r[0]).indexOf('HISTORY') === 0);
    check('a history block with one row for this run', hi > 0 && v.slice(hi + 2).filter(r => String(r[0]).trim()).length === 1);
    // the All row is the album-population-weighted mean of the cells
    const cells = v.filter(r => CLOUD_PAYERS.indexOf(r[1]) >= 0);
    const W = cells.reduce((a, r) => a + num(r[2]), 0), want = cells.reduce((a, r) => a + num(r[2]) * num(r[4]), 0) / W;
    check('the All row is the album-population-weighted mean of its cells', near(num(allRow[4]), want), num(allRow[4]) + ' vs ' + want);
  }
  {
    const t1 = Date.now();
    SimulateAlbumCompletion();
    const v = S(), hi = v.findIndex(r => String(r[0]).indexOf('HISTORY') === 0), rows = v.slice(hi + 2).filter(r => String(r[0]).trim());
    check('a second run on the same inputs re-uses the k table and appends a second history row',
          rows.length === 2 && rows[1][3] === 'reused' && rows[0][3] === 'computed', rows.map(r => r[3]).join(', ') + ' (' + ((Date.now() - t1) / 1000).toFixed(1) + ' s)');
  }
  {
    // D89b: the collection rows read the run's own seasons while the inputs are unchanged
    const c1 = fresh();
    const saved = albumGainsFor_('100+', 'NONPAYER', 'new'), savedCur = albumGainsFor_('100+', 'NONPAYER', 'cur');
    const viaNew = colSimSeasons_('100+', 'NONPAYER', c1, 'new'), viaCur = colSimSeasons_('100+', 'NONPAYER', c1, 'cur');
    check('D89b: album_gains is written and the Col rows read it on both sides (the album run\'s seasons, not 50 seeded ones)',
          !!data[ALBUM_GAINS_SHEET] && !!saved && !!savedCur && JSON.stringify(viaNew) === JSON.stringify(saved) &&
          JSON.stringify(viaCur) === JSON.stringify(savedCur) && saved.n === N);
    const snap = clone(data['NS_v2']);
    data['NS_v2'].values[16][5] = num(data['NS_v2'].values[16][5]) + 1;
    fresh();
    check('RULE: after an input edit the saved seasons are ignored (fingerprint) and the Col rows simulate again',
          albumGainsFor_('100+', 'NONPAYER', 'new') === null);
    data['NS_v2'] = snap; fresh();
  }
  {
    // an input edit changes the fingerprint -> the next run recomputes the table
    const fp0 = albumFingerprint_(), snap = clone(data['NS_v2']);
    data['NS_v2'].values[16][5] = num(data['NS_v2'].values[16][5]) + 1;
    fresh();
    const fp1 = albumFingerprint_();
    check('RULE: an edit to a config sheet changes the inputs fingerprint (the k table is then recomputed)', fp0 !== fp1);
    data['NS_v2'] = snap; fresh();
  }
  {
    const ok1 = albumMarkStale_('NS_v2'), a2 = String(S()[1][0]);
    check('an input edit marks album_summary STALE in A2', ok1 && /^STALE - NS_v2 was edited/.test(a2), a2.slice(0, 60));
    check('onEdit calls the album stale mark', /albumMarkStale_\(name\)/.test(v4Src));
  }
  {
    const keep = ALBUM_CALIBRATE;
    try {
      ALBUM_CALIBRATE = false; fresh();
      const pre = cardSeasonPre_('20-39', 'PAYER', Context.get());
      check('RULE: ALBUM_CALIBRATE = false -> no calibration and no carried streams reach the season core',
            pre.calib === null && pre.alwaysOn.length === pre.alwaysOnModel.length);
    } finally { ALBUM_CALIBRATE = keep; fresh(); }
  }
  console.log('\n================ D89c: the run sized on every cell\'s cost; short cells and the All row ================');
  {
    // the set-up: every cell has a pre and a cost, and the costs differ by cell (the first cell is not the mean)
    fresh();
    const D = albumDataDays_() || 16;
    const prep = albumPrepare_('redesign', SEED, D, {});
    const perms = cloudPermutations_();
    check('the set-up prepares all ten cells with a pre and a positive cost per player-season',
          prep._stoppedAt < 0 && perms.every((p, i) => !!prep.pres[i] && prep.ms[i] > 0),
          perms.map((p, i) => p.label + ' ' + (prep.ms[i] || 0).toFixed(1) + 'ms').join(', '));
    const mean = prep.ms.reduce((a, x) => a + x, 0) / prep.ms.length;
    console.log('  cost per player-season: first cell ' + prep.ms[0].toFixed(1) + ' ms, mean ' + mean.toFixed(1) + ' ms (x' + (mean / prep.ms[0]).toFixed(2) + ')');
    // RULE: running the same prep twice gives the same numbers (the set-up's timing seasons draw no player seed)
    const nS = 40;
    const r1 = albumRunPrepared_(prep, nS, SEED, D, {}), r2 = albumRunPrepared_(prep, nS, SEED, D, {});
    check('RULE: the player pass is deterministic over a prepared season (same prep, same seed, same means)',
          perms.every(p => r1[p.label] && JSON.stringify(r1[p.label].full) === JSON.stringify(r2[p.label].full)));
    // RULE: a later cell that no longer fits runs SHORT (named), never silently dropped; one that cannot reach half the floor stops the pass
    const keepMs = prep.ms.slice(), far = 1e9;
    try {
      prep.ms[2] = far / 79.5;                         // ~79 fit in the budget: between ALBUM_MIN_PLAYERS / 2 and n
      const n = 120, rs = albumRunPrepared_(prep, n, SEED, D, { deadline: new Date().getTime() + far });
      check('RULE: a cell that no longer fits at n runs at the count that does and is named as short',
            rs._stoppedAt < 0 && rs[perms[2].label] && rs[perms[2].label].n >= Math.ceil(ALBUM_MIN_PLAYERS / 2) && rs[perms[2].label].n < n &&
            rs._short.length === 1 && rs._short[0].indexOf(perms[2].label) === 0 && perms.every(p => !!rs[p.label]),
            rs._short.join(', ') + '; ' + perms[2].label + ' n = ' + (rs[perms[2].label] || {}).n);
      prep.ms[2] = far / 10;                           // 10 fit: below half the floor
      const rk = albumRunPrepared_(prep, n, SEED, D, { deadline: new Date().getTime() + far });
      check('RULE: a cell that cannot reach half of ALBUM_MIN_PLAYERS stops the pass there (the cells before it keep their numbers)',
            rk._stoppedAt === 2 && !!rk[perms[1].label] && !rk[perms[2].label]);
      prep.ms[0] = far;                                // the first cell always runs at n
      const r0 = albumRunPrepared_(prep, 30, SEED, D, { deadline: new Date().getTime() + 1 });
      check('RULE: the first cell always runs at n, whatever the deadline', r0[perms[0].label] && r0[perms[0].label].n === 30);
    } finally { prep.ms = keepMs; }
    // RULE: the All row of album_summary is over the cells a pass ran - a missing cell is not a zero - and the run line names it
    const fake = (v) => { const o = {}; perms.forEach((p, i) => { o[p.label] = { n: 100, d: { album1: v * (i + 1), packs: 10 * (i + 1), cards: 0, unique: 0, sets: 0 },
                                                                     full: { album1: 2 * v * (i + 1), packs: 20 * (i + 1), cards: 0, unique: 0, sets: 0 } }; });
                                    o._days = 28; o._short = []; return o; };
    const cur = fake(0.01), red = fake(0.02), gone = perms[perms.length - 1].label;
    delete red[gone];
    const pop = {}; perms.forEach((p, i) => { pop[p.label] = 1000 * (10 - i); });
    const keepSum = data[ALBUM_SUMMARY_SHEET];
    try {
      const sum = albumWriteSummary_(SpreadsheetApp.getActiveSpreadsheet(), cur, red, {}, { pop: pop, source: 'test' },
                                     { status: 'computed', note: 'test' }, 100, SEED, D, '0', 'abcd1234');
      const ran = perms.filter(p => p.label !== gone);
      const want = (key, vals, list) => list.reduce((a, p) => a + pop[p.label] * vals[p.label][key].album1, 0) / list.reduce((a, p) => a + pop[p.label], 0);
      check('RULE: the All row\'s REDESIGN columns are the weighted mean of the cells that ran; CURRENT stays over all ten',
            near(num(sum.all[7]), want('full', red, ran)) && near(num(sum.all[5]), want('full', cur, perms)),
            num(sum.all[7]).toFixed(5) + ' vs ' + want('full', red, ran).toFixed(5) + ' (zero-filled it would read ' +
            (ran.reduce((a, p) => a + pop[p.label] * red[p.label].full.album1, 0) / perms.reduce((a, p) => a + pop[p.label], 0)).toFixed(5) + ')');
      const line = String(data[ALBUM_SUMMARY_SHEET].values[1][0]);
      check('the run line names the cell a pass did not run', line.indexOf('redesign season did not run ' + gone) >= 0, line.slice(line.indexOf('TIME BUDGET')));
    } finally { if (keepSum) data[ALBUM_SUMMARY_SHEET] = keepSum; else delete data[ALBUM_SUMMARY_SHEET]; }
  }

  t.values = snapT;
  delete data[ALBUM_CALIB_SHEET]; delete data[ALBUM_SUMMARY_SHEET]; delete data[ALBUM_GAINS_SHEET];
  Logger.log = quiet;
  console.log('\n' + (failures ? failures + ' FAILED' : 'ALL D89/D90/D89c GATES PASS'));
  process.exitCode = failures ? 1 : 0;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
