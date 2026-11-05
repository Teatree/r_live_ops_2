// Offline gates for D94 (the segment registry: '100+' means '100-249', 250+ reads its parent's config,
// ALL is the pull's own row with the per-segment configs pooled), D95 (data_rm_pace per instance) and
// D96 (the per-event export scale on a by-source feed shorter than the export).
//
//   node harness/_mock_segments.js              (defaults to --data v3p, LIVE_OPS_V3 (20))
//
// Every check is a RULE: a relabel, a config mutation, a rebuilt identity - snapshot, mutate, assert,
// restore. Nothing asserts a number read off the workbook.
const fs = require('fs');
const path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3p');

const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
if (CARDS.indexOf(CUT) < 0) throw new Error('_mock_cards.js prelude marker moved - fix CUT.');
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function GATES() {
  eval(fs.readFileSync(ENGINE('EcoGainsSim_7Day.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('SimPerSegmentFill.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('ChangeSummary.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('SimFill.gs'), 'utf8'));

  const PAYERS = ['NONPAYER', 'PAYER'];
  const snap = (n) => JSON.stringify(data[n]);
  const restore = (n, s) => { if (s === undefined) delete data[n]; else data[n] = JSON.parse(s); };
  const fresh = () => { resetSheetCache_mock(); return Context.get(); };
  const near = (a, b, tol) => Math.abs(num(a) - num(b)) <= (tol || 1e-9) * Math.max(1, Math.abs(num(a)), Math.abs(num(b)));
  const rowsEq = (a, b, tol) => RESOURCES.every(r => near(a[r], b[r], tol));
  const gridEq = (a, b) => a.length === b.length && a.every((row, i) => row.every((x, j) => near(x, b[i][j])));
  const hdrIdx = (v) => { const h = {}; (v[0] || []).forEach((x, i) => { if (x !== '' && x != null) h[String(x)] = i; }); return h; };
  const section = (t) => console.log('\n---------------- ' + t);

  // the per-event export scale reads a pooled table: rebuild it from this dump's feed, as the menu run does
  { const g = exportScaleGrid_(Context.get()); if (g) data['export_scale'] = { values: g, merges: [] }; }
  // The dump's saved album tables are another engine's (LIVE_OPS_V3 (20): written by D93 under '100+ ...'
  // cell labels while the pull already said '100-249', i.e. for a segment that engine could not resolve).
  // They are read by cell label, so they would attach to a cell only when a gate relabels the pull - an
  // artefact of the fixture, not a rule. Every gate here runs the card sim on the model's own level.
  delete data['album_calibration']; delete data['album_gains'];
  let ctx = fresh();
  const ds0 = ctx.ds;
  const behSegs = [];
  (data['data_seg_beh'].values || []).slice(1).forEach(r => { const s = String(r[0] || '').trim(); if (s && behSegs.indexOf(s) < 0) behSegs.push(s); });
  const hasAll = behSegs.indexOf('ALL') >= 0, has250 = behSegs.indexOf('250+') >= 0;
  const TOP = behSegs.indexOf('100-249') >= 0 ? '100-249' : '100+';       // what the pull calls the old top segment
  console.log('segments in data_seg_beh: ' + behSegs.join(', '));

  // ---------------------------------------------------------------- 1. the registry
  section('1. the registry (D94)');
  check("segCanon_: '100+' and 'F. 100+' and 'F. 100-249' are '100-249'; 'B. 1-9' is '0-9'; 'G. 250+' is '250+'; 'All' is 'ALL'; 'A.0' is 'A. 0'",
    segCanon_('100+') === '100-249' && segCanon_('F. 100+') === '100-249' && segCanon_(' F. 100-249 ') === '100-249' &&
    segCanon_('B. 1-9') === '0-9' && segCanon_('G. 250+') === '250+' && segCanon_('All') === 'ALL' && segCanon_('A.0') === 'A. 0' &&
    segCanon_('20-39') === '20-39' && segCanon_('') === '');
  check('the member segments are data_seg_beh\'s own rows, in its order, without ALL',
    JSON.stringify(segMembers_(ds0)) === JSON.stringify(behSegs.filter(s => s !== 'ALL').map(segCanon_)), segMembers_(ds0).join(', '));
  check('the engine prints the label the pull uses for the old top segment', segLabel_('100+', ds0) === TOP && segLabel_('100-249', ds0) === TOP, TOP);
  check("config labels, best first: 100-249 -> [100-249, 100+]; 250+ -> [250+, 100-249, 100+]",
    JSON.stringify(segCfgKeys_('100+')) === JSON.stringify(['100-249', '100+']) &&
    JSON.stringify(segCfgKeys_('250+')) === JSON.stringify(['250+', '100-249', '100+']));

  // ---------------------------------------------------------------- 2. '100+' means '100-249'
  section("2. '100+' means '100-249' (D94)");
  const base = {};
  PAYERS.forEach(p => { base[p] = { sim: ECOGAINS_SIM(p, '100-249'), diff: ECOGAINS_DIFF(p, '100-249'), d7: ECOGAINS_SIM_7_DAY(p, '100-249') }; });
  check("ECOGAINS_SIM / DIFF / SIM_7_DAY: a '100+' argument returns the '100-249' grid, cell for cell",
    PAYERS.every(p => gridEq(ECOGAINS_SIM(p, '100+'), base[p].sim) && gridEq(ECOGAINS_DIFF(p, '100+'), base[p].diff) &&
                      gridEq(ECOGAINS_SIM_7_DAY(p, '100+'), base[p].d7)));
  check('the top segment is not empty on this pull (a label mismatch reads as a table of zeros)',
    PAYERS.every(p => base[p].sim.some(row => row.some(x => num(x) > 0))));
  {
    // relabel the PULL: every data_* sheet says '100+' / 'F. 100+' instead - the engine must not notice
    const names = Object.keys(data).filter(n => /^data_/.test(n)), snaps = {};
    names.forEach(n => {
      snaps[n] = snap(n);
      data[n].values.forEach(row => row.forEach((x, j) => {
        if (x === '100-249') row[j] = '100+'; else if (x === 'F. 100-249') row[j] = 'F. 100+';
      }));
    });
    fresh();
    check("a pull that still says '100+' gives the same grids for '100-249' and for '100+'",
      PAYERS.every(p => gridEq(ECOGAINS_SIM(p, '100-249'), base[p].sim) && gridEq(ECOGAINS_DIFF(p, '100+'), base[p].diff)));
    check('...and the engine then prints 100+', segLabel_('100-249') === '100+' && cloudPermutations_().some(x => x.label === '100+ PAYER'));
    names.forEach(n => restore(n, snaps[n]));
    ctx = fresh();
  }

  // ---------------------------------------------------------------- 3. 250+ reads its parent's config
  if (has250) {
    section('3. 250+ has no config of its own: the 100+ blocks (D94)');
    const nsRow = (seg, p) => resultRow_('Daily Night Sky Prize', seg, p, Context.get());
    const sagaRow = (seg, p) => resultRow_('Saga', seg, p, Context.get());
    const b = { ns250: nsRow('250+', 'PAYER'), nsTop: nsRow('100-249', 'PAYER'), ns40: nsRow('40-99', 'PAYER'),
                sg250: sagaRow('250+', 'PAYER'), sgTop: sagaRow('100-249', 'PAYER'), sg40: sagaRow('40-99', 'PAYER') };
    // Night Sky: the '100+' block of NS_v2 AND NS_v2_weekday pays 3x the coins
    const nsSheets = ['NS_v2', 'NS_v2_weekday'].filter(n => data[n]), nsSnap = {};
    const nsBlock = (v) => { const r = v.findIndex(row => String(row[0]).trim() === '100+'); const h = (v[r + 1] || []).map(x => String(x).trim()); return { r, hc: h.indexOf('HC Reward') }; };
    nsSheets.forEach(n => {
      nsSnap[n] = snap(n);
      const v = data[n].values, bl = nsBlock(v);
      for (let r = bl.r + 2; r < v.length && v[r][0] !== '' && !isNaN(parseFloat(v[r][0])); r++) v[r][bl.hc] = num(v[r][bl.hc]) * 3;
    });
    fresh();
    const m = { ns250: nsRow('250+', 'PAYER'), nsTop: nsRow('100-249', 'PAYER'), ns40: nsRow('40-99', 'PAYER') };
    check("Night Sky: an edit to the '100+' ladder moves 100-249 AND 250+, and nothing else",
      m.nsTop.HC > b.nsTop.HC * 1.5 && m.ns250.HC > b.ns250.HC * 1.5 && near(m.ns40.HC, b.ns40.HC),
      '100-249 ' + b.nsTop.HC.toFixed(1) + ' -> ' + m.nsTop.HC.toFixed(1) + ', 250+ ' + b.ns250.HC.toFixed(1) + ' -> ' + m.ns250.HC.toFixed(1));
    nsSheets.forEach(n => restore(n, nsSnap[n]));
    // ...and a '250+' block, once authored, is read instead of the parent's
    nsSheets.forEach(n => {
      nsSnap[n] = snap(n);
      const v = data[n].values, bl = nsBlock(v), add = [[]];
      for (let r = bl.r; r < v.length && (r <= bl.r + 1 || (v[r][0] !== '' && !isNaN(parseFloat(v[r][0])))); r++) {
        const row = v[r].slice();
        if (r === bl.r) row[0] = '250+'; else if (r > bl.r + 1) row[bl.hc] = num(row[bl.hc]) * 3;
        add.push(row);
      }
      add.forEach(row => v.push(row));
    });
    fresh();
    const o = { ns250: nsRow('250+', 'PAYER'), nsTop: nsRow('100-249', 'PAYER') };
    check("Night Sky: a '250+' block of its own is what 250+ reads, and 100-249 does not move",
      o.ns250.HC > b.ns250.HC * 1.5 && near(o.nsTop.HC, b.nsTop.HC), '250+ ' + b.ns250.HC.toFixed(1) + ' -> ' + o.ns250.HC.toFixed(1));
    nsSheets.forEach(n => restore(n, nsSnap[n]));
    // Saga: the '100+' HC column of c_saga_v2 x2
    {
      const s0 = snap('c_saga_v2'), v = data['c_saga_v2'].values;
      const hr = v.findIndex(row => row.some(x => String(x).trim() === 'Node') && row.some(x => String(x).trim() === 'Levels Req'));
      const lab = v[hr - 1].map(x => String(x).trim()), c0 = lab.indexOf('100+');
      let hc = -1;
      for (let c = c0; c < v[hr].length; c++) if (String(v[hr][c]).trim() === 'HC Reward') { hc = c; break; }
      for (let r = hr + 1; r < v.length && !isNaN(parseFloat(v[r][0])); r++) v[r][hc] = num(v[r][hc]) * 2;
      fresh();
      const s = { sg250: sagaRow('250+', 'PAYER'), sgTop: sagaRow('100-249', 'PAYER'), sg40: sagaRow('40-99', 'PAYER') };
      check("Saga: the '100+' coin ladder x2 doubles the simulated coins of 100-249 AND 250+, and nothing else",
        near(s.sgTop.HC, 2 * b.sgTop.HC, 1e-6) && near(s.sg250.HC, 2 * b.sg250.HC, 1e-6) && near(s.sg40.HC, b.sg40.HC),
        '250+ ' + b.sg250.HC.toFixed(1) + ' -> ' + s.sg250.HC.toFixed(1));
      restore('c_saga_v2', s0); fresh();
    }
    const tcfg = tofConfig_();
    check('ToF: 250+ and 100-249 read the row called 100+ (until they are given their own)',
      !!tcfg && tofBeh_(tcfg, '250+', 'PAYER') === tofBeh_(tcfg, '100+', 'PAYER') && tofBeh_(tcfg, '100-249', 'PAYER') === tofBeh_(tcfg, '100+', 'PAYER'));

    // ---------------------------------------------------------------- 4. own data, parent fallback
    section('4. 250+: its own data; a behaviour row the pull lacks is its parent\'s; a missing gain is a 0 (D94)');
    ctx = fresh();
    const own = ctx.ds.eventInst('Target Day', '250+', 'PAYER'), par = ctx.ds.eventInst('Target Day', '100-249', 'PAYER');
    check('with its own data_event_inst row, 250+ reads it (not the parent\'s)', !!own && !!par && own !== par &&
      JSON.stringify(own) !== JSON.stringify(par));
    {
      const s0 = snap('data_event_inst'), v = data['data_event_inst'].values, h = hdrIdx(v);
      data['data_event_inst'].values = v.filter((r, i) => i === 0 || !(String(r[h['segment']]).trim() === '250+' && String(r[h['event_name']]).trim() === 'Target Day'));
      const c2 = fresh();
      check('...without it, the 100-249 row', JSON.stringify(c2.ds.eventInst('Target Day', '250+', 'PAYER')) === JSON.stringify(par));
      restore('data_event_inst', s0);
    }
    {
      const s0 = snap('data_gains'), v = data['data_gains'].values, h = hdrIdx(v);
      const before = measuredRow_('Kite Festival', '250+', 'NONPAYER', fresh().ds);
      data['data_gains'].values = v.filter((r, i) => i === 0 || !(String(r[h['engagement_segment']]).trim() === 'G. 250+' && String(r[h['category']]).trim() === 'Kite Festival'));
      const after = measuredRowCore_('Kite Festival', '250+', 'NONPAYER', fresh().ds);
      check('a source with no data_gains row for 250+ is a measured 0 - never the parent\'s gains',
        RESOURCES.some(r => num(before[r]) > 0) && RESOURCES.every(r => num(after[r]) === 0));
      restore('data_gains', s0); ctx = fresh();
    }
  }

  // ---------------------------------------------------------------- 5. ALL
  if (hasAll) {
    section('5. ALL: its own rows; the sources configured per segment are the members pooled (D94)');
    ctx = fresh();
    const mem = segMembers_(ctx.ds);
    PAYERS.forEach(p => {
      const sumP = mem.reduce((a, s) => a + ctx.ds.players(s, p), 0);
      console.log('  ' + p + ': players ALL ' + ctx.ds.players('ALL', p) + ', members ' + sumP + ' (' + mem.map(s => s + ' ' + ctx.ds.players(s, p)).join(', ') + ')');
    });
    // its own rows: doubling ALL's Kite coins in the export doubles ALL's Kite and leaves every member alone
    {
      const kb = { all: resultRow_('Kite Festival', 'ALL', 'PAYER', ctx), mAll: measuredRow_('Kite Festival', 'ALL', 'PAYER', ctx.ds),
                   m20: resultRow_('Kite Festival', '20-39', 'PAYER', ctx) };
      const s0 = snap('data_gains'), v = data['data_gains'].values, h = hdrIdx(v);
      v.forEach((r, i) => { if (i && String(r[h['engagement_segment']]).trim() === 'ALL' && String(r[h['category']]).trim() === 'Kite Festival' &&
                               String(r[h['resource']]).trim() === 'HC') r[h['amount_per_earner']] = num(r[h['amount_per_earner']]) * 2; });
      const c2 = fresh();
      const ka = { all: resultRow_('Kite Festival', 'ALL', 'PAYER', c2), mAll: measuredRow_('Kite Festival', 'ALL', 'PAYER', c2.ds),
                   m20: resultRow_('Kite Festival', '20-39', 'PAYER', c2) };
      check('a source configured for everyone (Kite): ALL is priced off ALL\'s own export rows',
        kb.mAll.HC > 0 && near(ka.mAll.HC, 2 * kb.mAll.HC, 1e-6) && near(ka.all.HC, 2 * kb.all.HC, 1e-6) && near(ka.m20.HC, kb.m20.HC),
        'ALL Kite HC ' + kb.all.HC.toFixed(2) + ' -> ' + ka.all.HC.toFixed(2));
      restore('data_gains', s0); ctx = fresh();
    }
    // the mixture identity, rebuilt from the member rows
    let worst = 0, cellsChecked = 0, okMix = true;
    Object.keys(SEG_MIX_CATS).forEach(cat => PAYERS.forEach(p => {
      const got = resultRow_(cat, 'ALL', p, ctx), mA = measuredRow_(cat, 'ALL', p, ctx.ds);
      const nu = {}, de = {};
      RESOURCES.forEach(r => { nu[r] = 0; de[r] = 0; });
      mem.forEach(s => {
        const x = resultRow_(cat, s, p, ctx), m = measuredRow_(cat, s, p, ctx.ds);
        RESOURCES.forEach(r => { const n = segWeight_(ctx.ds, s, p, cat, r); nu[r] += n * num(x[r]); de[r] += n * num(m[r]); });
      });
      RESOURCES.forEach(r => {
        const want = de[r] > 1e-12 ? num(mA[r]) * nu[r] / de[r] : (nu[r] > 0 ? nu[r] / segWeight_(ctx.ds, 'ALL', p, cat, r) : 0);
        cellsChecked++;
        if (!near(got[r], want, 1e-9)) { okMix = false; worst = Math.max(worst, Math.abs(num(got[r]) - want)); }
      });
    }));
    check('Saga / Night Sky / ToF for ALL = ALL measured x the members\' pooled change (players-weighted), bottom-up columns pooled per player',
      okMix, cellsChecked + ' cells' + (okMix ? '' : ', worst off by ' + worst));
    // the Season Pass of ALL: a tier is a per-player threshold, so the rows are the members' pooled - and so
    // is the modelled side of the paid track (the export has no Paid category)
    {
      const mixP = segMix_('PAYER', ctx.ds);
      let want = 0; mixP.forEach(x => { want += x.w * num(measuredRow_('Season Pass (Paid)', x.seg, 'PAYER', ctx.ds).HC); });
      const got = measuredRow_('Season Pass (Paid)', 'ALL', 'PAYER', ctx.ds).HC, ownTier = spPaidSynth_('ALL', 'PAYER', ctx.ds);
      check('Season Pass (Paid), CURRENT side of ALL: the paid tracks of the members pooled by players - not the track of one average player',
        want > 0 && near(got, want, 1e-9), 'coins ' + got.toFixed(1) + ' pooled' + (ownTier ? ' (one average ALL player would read ' + num(ownTier.HC).toFixed(1) + ')' : ''));
      const fr = resultRow_('Season Pass (Free)', 'ALL', 'PAYER', ctx), frM = measuredRow_('Season Pass (Free)', 'ALL', 'PAYER', ctx.ds);
      const noCross = mem.every(sg => rowsEq(resultRow_('Season Pass (Free)', sg, 'PAYER', ctx), measuredRow_('Season Pass (Free)', sg, 'PAYER', ctx.ds), 1e-9));
      check('Season Pass (Free) of ALL moves only as far as its members do (no tier of its own)', !noCross || rowsEq(fr, frM, 1e-9),
        noCross ? 'no member crosses a tier -> ALL unchanged' : 'a member crosses a tier');
    }
    // one member's ladder moves ALL; the other members do not
    {
      const b0 = resultRow_('Saga', 'ALL', 'NONPAYER', ctx).HC;
      const s0 = snap('c_saga_v2'), v = data['c_saga_v2'].values;
      const hr = v.findIndex(row => row.some(x => String(x).trim() === 'Node') && row.some(x => String(x).trim() === 'Levels Req'));
      const c0 = v[hr - 1].map(x => String(x).trim()).indexOf('20-39');
      let hc = -1;
      for (let c = c0; c < v[hr].length; c++) if (String(v[hr][c]).trim() === 'HC Reward') { hc = c; break; }
      const m20b = resultRow_('Saga', '20-39', 'NONPAYER', ctx).HC, mAll = measuredRow_('Saga', 'ALL', 'NONPAYER', ctx.ds).HC;
      let den = 0; mem.forEach(s => { den += segWeight_(ctx.ds, s, 'NONPAYER', 'Saga', 'HC') * num(measuredRow_('Saga', s, 'NONPAYER', ctx.ds).HC); });
      for (let r = hr + 1; r < v.length && !isNaN(parseFloat(v[r][0])); r++) v[r][hc] = num(v[r][hc]) * 2;
      const c2 = fresh();
      const a0 = resultRow_('Saga', 'ALL', 'NONPAYER', c2).HC, m20a = resultRow_('Saga', '20-39', 'NONPAYER', c2).HC;
      const want = b0 + mAll * segWeight_(c2.ds, '20-39', 'NONPAYER', 'Saga', 'HC') * (m20a - m20b) / den;
      check('Saga: doubling ONE member\'s coin ladder (20-39) moves ALL by that member\'s share of the coins', a0 > b0 && near(a0, want, 1e-9),
        'ALL Saga HC ' + b0.toFixed(2) + ' -> ' + a0.toFixed(2));
      restore('c_saga_v2', s0); ctx = fresh();
    }
    // identical configs: no change
    {
      const s0 = snap('c_saga_v2');
      data['c_saga_v2'] = JSON.parse(snap('c_saga'));
      const c2 = fresh();
      check('Saga: c_saga_v2 identical to c_saga -> ALL simulated = ALL measured, every resource (and every member)',
        PAYERS.every(p => rowsEq(resultRow_('Saga', 'ALL', p, c2), measuredRow_('Saga', 'ALL', p, c2.ds), 1e-9) &&
                          mem.every(s => rowsEq(resultRow_('Saga', s, p, c2), measuredRow_('Saga', s, p, c2.ds), 1e-9))));
      restore('c_saga_v2', s0); ctx = fresh();
    }
    // the collection rows: the members' card seasons pooled by their players
    {
      const t0 = Date.now();
      const all = colSimSeasons_('ALL', 'PAYER', ctx, 'new'), mix = segMix_('PAYER', ctx.ds);
      let want = 0, wsum = 0;
      mix.forEach(x => { const one = colSimSeasons_(x.seg, 'PAYER', ctx, 'new'); if (one) { want += x.w * num(one.sets.HC); wsum += x.w; } });
      check('Col - Sets / Col - Albums for ALL: the member segments\' seasons pooled by their players (no ALL cohort is played)',
        !!all && all.pooled === true && wsum > 0 && near(all.sets.HC, want / wsum, 1e-9), 'set coins per player ' + (all ? all.sets.HC.toFixed(2) : 'n/a') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
    }
    // ToF behaviour for one ALL player: the member rows averaged by players
    {
      const tcfg = tofConfig_(), mixN = segMix_('NONPAYER', ctx.ds);
      let want = 0; mixN.forEach(x => { want += x.w * tofBeh_(tcfg, x.seg, 'NONPAYER').continueP; });
      const got = tofBeh_(tcfg, 'ALL', 'NONPAYER');
      check('ToF behaviour of an ALL player: the member rows averaged by their players (no ALL row authored)', !!got && near(got.continueP, want, 1e-12),
        'continue take-up ' + (got ? got.continueP.toFixed(4) : 'n/a'));
      const tofName = (data['ToF_v2'] && data['ToF_v2'].values.length) ? 'ToF_v2' : 'ToF';   // the sheet the redesign side reads
      const s0 = snap(tofName), v = data[tofName].values;
      const r100 = v.findIndex(row => String(row[0]).trim() === '100+' && typeof row[2] === 'number');
      const add = v[r100].slice(); add[0] = 'ALL'; add[2] = 0.123;
      v.splice(r100 + 1, 0, add);
      fresh();
      const g2 = tofBeh_(tofConfig_(), 'ALL', 'NONPAYER');
      check('...and an authored ALL row wins', !!g2 && g2.continueP === 0.123);
      restore(tofName, s0); ctx = fresh();
    }
    // the payer rows of SEGMENT BEHAVIOUR
    {
      const tcfg = tofConfig_(), v = data['ToF'].values;
      const np = v.find(row => String(row[0]).trim() === '0-9' && String(row[1]).trim().toUpperCase() === 'NONPAYER' && typeof row[2] === 'number');
      const pp = v.find(row => String(row[0]).trim() === '0-9' && String(row[1]).trim().toUpperCase() === 'PAYER' && typeof row[2] === 'number');
      if (np && pp && np[2] !== pp[2]) {
        check('TOF_BEH_BY_PAYER off (shipped): every player of a segment reads its LAST row - the engine as it has always run',
          TOF_BEH_BY_PAYER === false && tofBeh_(tcfg, '0-9', 'NONPAYER').continueP === pp[2], 'a 0-9 non-payer continues at ' + pp[2] + ', the sheet authors ' + np[2]);
        TOF_BEH_BY_PAYER = true;
        check('TOF_BEH_BY_PAYER on: each payer flag reads its own row', tofBeh_(tcfg, '0-9', 'NONPAYER').continueP === np[2] && tofBeh_(tcfg, '0-9', 'PAYER').continueP === pp[2]);
        TOF_BEH_BY_PAYER = false;
      } else console.log('SKIP TOF_BEH_BY_PAYER gates: this ToF sheet has no distinct payer rows');
    }

    // ---------------------------------------------------------------- 6. the change summary
    section('6. change_summary: the whole-population band is the ALL segment (D94)');
    ctx = fresh();
    const prices = csPrices_(), extras = csExportOnlyCats_(), cats = CATEGORY_ORDER.concat(extras), popInfo = csPopulation_(ctx);
    const cells = csCellRows_(ctx, extras, popInfo), blocks = csBlocks_(cells, cats, prices, ctx);
    const segsCS = csSegments_(ctx);
    check('one band per segment the pull carries plus ALL, three payer blocks each',
      blocks.length === 3 * (segsCS.length + 1) && blocks.slice(0, 3).every(b => b.seg === 'ALL') &&
      JSON.stringify(blocks.filter(b => b.payer === 'All').map(b => b.seg)) === JSON.stringify(['ALL'].concat(segsCS)), blocks.length + ' blocks');
    const cellOf = (s, p) => cells.filter(x => x.seg === s && x.payer === p)[0];
    const blk = (s, p) => blocks.filter(b => b.seg === s && b.payer === p)[0];
    check('ALL x NONPAYER and ALL x PAYER are the ALL cells themselves',
      ['NONPAYER', 'PAYER'].every(p => cats.every(c => rowsEq(blk('ALL', p).rows[c].cur, cellOf('ALL', p).rows[c].cur) && rowsEq(blk('ALL', p).rows[c].nw, cellOf('ALL', p).rows[c].nw))));
    {
      const a = cellOf('ALL', 'NONPAYER'), b2 = cellOf('ALL', 'PAYER'), w = a.pop + b2.pop;
      check('ALL x All payers is those two cells weighted by their players - no member cell in it',
        near(blk('ALL', 'All').pop, w) && cats.every(c => RESOURCES.every(r =>
          near(blk('ALL', 'All').rows[c].nw[r], (a.pop * num(a.rows[c].nw[r]) + b2.pop * num(b2.rows[c].nw[r])) / w, 1e-9))));
      check('no ALL cell inside a segment band', segsCS.every(s => near(blk(s, 'All').pop, cellOf(s, 'NONPAYER').pop + cellOf(s, 'PAYER').pop)));
    }
    const cmp = csAllCompare_(cells, cats, prices, ctx);
    check('the note compares ALL with the weighted merge it replaces', !!cmp && cmp.all.cur > 0 && cmp.merged.cur > 0,
      'VALUE per player: ALL ' + cmp.all.cur.toFixed(0) + ' -> ' + cmp.all.nw.toFixed(0) + ' (' + (100 * cmp.all.pct).toFixed(2) + '%), weighted merge ' +
      cmp.merged.cur.toFixed(0) + ' -> ' + cmp.merged.nw.toFixed(0) + ' (' + (100 * cmp.merged.pct).toFixed(2) + '%)');
    {
      // a pull with no ALL segment: the old band, a merge of every member cell
      const sb = snap('data_seg_beh'), sg = snap('data_gains');
      data['data_seg_beh'].values = data['data_seg_beh'].values.filter((r, i) => i === 0 || String(r[0]).trim() !== 'ALL');
      const c2 = fresh(), p2 = csPopulation_(c2), cl2 = csCellRows_(c2, extras, p2), bl2 = csBlocks_(cl2, cats, prices, c2);
      check('a pull with no ALL segment keeps the weighted "All" band over every member cell',
        bl2[0].seg === 'All' && bl2[0].cells === cl2.length && bl2.length === 3 * (segsCS.length + 1) && !cl2.some(x => x.all));
      restore('data_seg_beh', sb); restore('data_gains', sg); ctx = fresh();
    }
  }

  // ---------------------------------------------------------------- 7. the card sheets, the views
  section('7. the card cells and the one-segment views (D94)');
  const perms = cloudPermutations_();
  check('the card cloud / totals cells are the member segments x payer - never ALL',
    perms.length === 2 * segMembers_(Context.get().ds).length && !perms.some(x => /^ALL /i.test(x.label)) && (!has250 || perms.some(x => x.label === '250+ NONPAYER')),
    perms.map(x => x.label).join(', '));
  check('Col_Cards_Daily accepts every segment the pull carries, under either spelling', cardSegKnown_('100+') && cardSegKnown_(TOP) &&
    (!has250 || cardSegKnown_('250+')) && (!hasAll || cardSegKnown_('ALL')) && !cardSegKnown_('nonsense'));
  const viewSegs = [].concat(has250 ? ['250+'] : [], hasAll ? ['ALL'] : []);
  viewSegs.forEach(sg => {
    const sim = ECOGAINS_SIM('PAYER', sg), day = ECOGAINS_DAILY('PAYER', sg, 'ALL', 'NEW');
    const colSum = RESOURCES.map((r, j) => sim.reduce((a, row) => a + num(row[j]), 0));
    const daySum = RESOURCES.map((r, j) => day.reduce((a, row) => a + num(row[j]), 0));
    check('ECOGAINS_DAILY ' + sg + ': the days sum to the window grid, every resource', colSum.every((x, j) => near(x, daySum[j], 1e-6)) && colSum[0] > 0,
      'HC ' + colSum[0].toFixed(1));
    const dat = ECOGAINS_DAILY('PAYER', sg, 'ALL', 'DATA');
    check('ECOGAINS_DAILY ' + sg + ' DATA: the measured block has numbers (the feed that carries the segment is read)',
      dat.some(row => typeof row[0] === 'number' && row[0] > 0), econSheet_());
    const prof = ECOGAINS_PBP_PROFILE(sg, 'PAYER'), pbp = ECOGAINS_PBP('cal_new', 9, sg, 'PAYER', 'Expected', 'p50', 1);
    check('play-by-play ' + sg + ': the profile names the config ladders, and the session runs',
      prof.some(row => /^Config ladders/.test(String(row[0]))) && pbp.length > 5 && !/error/i.test(String(pbp[0][0])),
      String((prof.find(row => /^Config ladders/.test(String(row[0]))) || [])[1]));
  });
  if (hasAll) {
    const rep = segCfgRep_('ALL', 'PAYER', Context.get().ds), b = Context.get().ds.beh('ALL', 'PAYER');
    const pace = num(b.saga_completes_per_active_day) * (4 * num(b.weekday_active_rate) + 3 * num(b.weekend_active_rate));
    const lo = +(/^(\d+)/.exec(rep) || [0, -1])[1], mem = segMembers_(Context.get().ds), nxt = mem[mem.indexOf(rep) + 1];
    check('one ALL player stands on the ladders of the segment their weekly saga pace falls in',
      pace >= lo && (!nxt || pace < +(/^(\d+)/.exec(nxt))[1]), rep + ' (pace ' + pace.toFixed(1) + ' a week)');
  }
  {
    const live = snap('data_econ_daily_live'), baseS = snap('data_econ_daily');
    if (data['data_econ_daily_live'] && data['data_econ_daily']) {
      const hb = hdrIdx(data['data_econ_daily'].values);
      if (hb['calendar_date'] != null) {
        check('the daily feed: a base sheet with its own dates reaching as far as the live one is read (the anchor pull\'s feed)', econSheet_() === 'data_econ_daily');
        data['data_econ_daily'].values.forEach(row => { row[hb['calendar_date']] = (row === data['data_econ_daily'].values[0]) ? 'x_calendar_date' : row[hb['calendar_date']]; });
        fresh();
        check('...without dates (the August pull) the live feed keeps winning (D63)', econSheet_() === 'data_econ_daily_live');
        restore('data_econ_daily', baseS); restore('data_econ_daily_live', live); fresh();
      } else console.log('SKIP daily-feed gates: this dump\'s data_econ_daily carries no calendar_date');
    }
  }
  if (data['EcoGainsSim_so_far'] && (has250 || hasAll)) {
    const s0 = snap('EcoGainsSim_so_far'), before = JSON.parse(s0).values;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // the shared mock has no getFormulas: a sheet of values
    const sh0 = ss.getSheetByName('EcoGainsSim_so_far'), gr = sh0.getRange.bind(sh0);
    const mockSS = { getSheetByName: (n) => { const sh = ss.getSheetByName(n); if (!sh) return null;
      const wrap = (rng) => Object.assign(rng, { getFormulas: () => rng.getValues().map(row => row.map(() => '')), getFormula: () => '' });
      return Object.assign({}, sh, { getRange: (a, b, c, d) => wrap(sh.getRange(a, b, c, d)), getDataRange: () => wrap(sh.getDataRange()) }); } };
    const added = simFillAddSegBlocks_(mockSS, 'EcoGainsSim_so_far');
    const after = data['EcoGainsSim_so_far'].values, tags = simFillSegTags_(after);
    check('Fill all sims adds a table for every segment the pull carries and EcoGainsSim_so_far lacks',
      JSON.stringify(added) === JSON.stringify(viewSegs) && viewSegs.every(sg => tags.some(t => t.tag === sg)), 'added ' + added.join(', '));
    check('...under the existing tables, none of which moves', before.every((row, i) => JSON.stringify(row) === JSON.stringify(after[i])) &&
      tags.filter(t => viewSegs.indexOf(t.tag) >= 0).every(t => t.r > before.length));
    const tpl = simFillSegTags_(before).filter(t => t.seg !== 'A. 0').pop(), nw = tags[tags.length - 1];
    check('...with the template\'s labels and none of its numbers',
      JSON.stringify((after[nw.r] || []).slice(0, 8)) === JSON.stringify((before[tpl.r] || []).slice(0, 8)) &&
      (after[nw.r + 1] || [])[0] === (before[tpl.r + 1] || [])[0] && (after[nw.r + 1] || []).slice(1).every(x => typeof x !== 'number') &&
      String((after[nw.r - 1] || [])[1]).indexOf(nw.tag) === 0);
    const lay = simFillLayoutAnchors_('EcoGainsSim_so_far', after, after.length, 60);
    check('...and the fill locates them like any other table (the 7-day functions, the tag cell as the segment)',
      lay.anchors.filter(a => a.row === nw.r + 2).length >= 1 && lay.anchors.filter(a => a.row === nw.r + 2)
        .every(a => a.formula.indexOf('ECOGAINS_') > 0 && a.formula.indexOf('$A$' + nw.r) > 0));
    check('a second run adds nothing', simFillAddSegBlocks_(mockSS, 'EcoGainsSim_so_far').length === 0);
    restore('EcoGainsSim_so_far', s0); fresh();
  }

  // ---------------------------------------------------------------- 8. data_rm_pace per instance (D95)
  section('8. data_rm_pace per instance: instances pooled by participants (D95)');
  {
    const v = data['data_rm_pace'].values, h = hdrIdx(v);
    if (h['instance_id'] == null) console.log('SKIP: this dump\'s data_rm_pace is not per instance');
    else {
      const s0 = snap('data_rm_pace');
      const mine = (r) => String(r[h['segment']]).trim() === '20-39' && String(r[h['payer_flag']]).trim() === 'PAYER' &&
                          (h['ab_variant'] == null || String(r[h['ab_variant']]).trim() === ANCHOR_ARM) && String(r[h['resource']]).trim() === 'ALL';
      const ids = []; v.forEach((r, i) => { if (i && mine(r) && ids.indexOf(r[h['instance_id']]) < 0) ids.push(r[h['instance_id']]); });
      const Ls = Math.max.apply(null, v.slice(1).filter(mine).map(r => num(r[h['instance_length_days']])));
      const last = (id) => v.find((r, i) => i && mine(r) && r[h['instance_id']] === id && num(r[h['instance_length_days']]) === Ls && num(r[h['instance_day']]) === Ls);
      let wsum = 0, p50 = 0, pooledShare = 0;
      ids.forEach(id => { const r = last(id); if (!r) return; const w = num(r[h['n_participants']]); wsum += w; p50 += w * num(r[h['cum_matchables_p50']]); pooledShare += w * num(r[h['cum_pooled_share']]); });
      fresh();
      const live = rmLive_('20-39', 'PAYER'), rec = live ? live.at(Ls, Ls) : null;
      check('the matchables of a cell are its instances\' pooled by participants (' + ids.length + ' instances)', ids.length > 1 && !!rec && near(rec.p50, p50 / wsum, 1e-9),
        'p50 at the end ' + (rec ? rec.p50.toFixed(0) : 'n/a'));
      const pace = rmClaimPace_('20-39', 'PAYER', Ls - 1);
      check('...and so is the claim pace', !!pace && near(pace.share('ALL', Ls - 1), Math.max(0, Math.min(1, v.slice(1).filter(r => mine(r) && num(r[h['instance_length_days']]) === Ls && num(r[h['instance_day']]) === Ls - 1)
        .reduce((a, r) => a + num(r[h['n_participants']]) * num(r[h['cum_pooled_share']]), 0) /
        v.slice(1).filter(r => mine(r) && num(r[h['instance_length_days']]) === Ls && num(r[h['instance_day']]) === Ls - 1).reduce((a, r) => a + num(r[h['n_participants']]), 0))), 1e-9));
      // one instance still running: it is not part of the pool
      const keep = ids[0];
      data['data_rm_pace'].values.forEach((r, i) => { if (i && r[h['instance_id']] !== keep) r[h['instance_complete']] = false; });
      fresh();
      const one = rmLive_('20-39', 'PAYER'), rk = last(keep);
      check('an instance that had not finished when the pull was taken is left out', !!one && near(one.at(Ls, Ls).p50, num(rk[h['cum_matchables_p50']]), 1e-9));
      restore('data_rm_pace', s0); fresh();
    }
  }

  // ---------------------------------------------------------------- 9. the export scale on a shorter feed (D96)
  section('9. the per-event export scale when the by-source feed ends before the export (D96)');
  {
    ctx = fresh();
    const tab = exportScaleTab_(), feedV = data['data_econ_daily_by_source'].values, fh = hdrIdx(feedV);
    const lastIdx = Math.max.apply(null, feedV.slice(1).map(r => num(r[fh['day_index']])));
    console.log('  export days ' + tab.first + '..' + tab.last + ', the feed carries ' + tab.feedFirst + '..' + tab.feedLast);
    check('the table records the days the feed itself carries', tab.feedLast - tab.feedFirst + 1 === lastIdx && tab.feedLast <= tab.last);
    const scaleOf = (cat) => spanScaleEvent_(cat, '20-39', 'PAYER', 'HC', Context.get());
    const rebuild = () => { resetSheetCache_mock(); data['export_scale'] = { values: exportScaleGrid_(Context.get()), merges: [] }; return fresh(); };
    const sFeed = snap('data_econ_daily_by_source'), sTab = snap('export_scale');
    // a feed as long as the export: complete it with the same weekdays a week earlier, then cut it back
    const span = Context.get().dataSpan, missing = tab.last - tab.feedLast;
    const addDays = (n) => {
      const v = data['data_econ_daily_by_source'].values, add = [];
      for (let k = 1; k <= n; k++) v.slice(1).forEach(r => {
        if (num(r[fh['day_index']]) !== lastIdx + k - 7) return;
        const c = r.slice(); c[fh['day_index']] = lastIdx + k;
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(c[fh['calendar_date']]));
        if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + 7 * 86400000); c[fh['calendar_date']] = d.toISOString().slice(0, 10) + ' 00:00:00'; }
        add.push(c);
      });
      add.forEach(r => v.push(r));
    };
    const cands = ['Target Day', 'Hatchling Hideaway', 'Red Challenge', 'Flash Race', 'Kite Festival', "Bomb's Ballet"];
    const short = {}; cands.forEach(c => { short[c] = { chk: exportScaleCheck_(c, 'HC', Context.get()), s: scaleOf(c) }; });
    if (missing > 0) {
      addDays(missing);
      const cF = rebuild(), tF = exportScaleTab_();
      const full = {}; cands.forEach(c => { full[c] = { chk: exportScaleCheck_(c, 'HC', cF), s: scaleOf(c) }; });
      check('a feed as long as the export: no estimate (rho = 0), f = the explained mass over the whole export', tF.feedLast === tF.last &&
        cands.every(c => !full[c].chk.ok || full[c].chk.rho === 0));
      const both = cands.filter(c => short[c].chk.ok && full[c].chk.ok && short[c].chk.rho > 0);
      check('a feed cut ' + missing + ' day(s) short gives the scale the complete feed gives, when the missing days pay like the same weekdays a week before',
        both.length > 0 && both.every(c => Math.abs(short[c].s / full[c].s - 1) < 0.05),
        both.map(c => c + ' x' + short[c].s.toFixed(3) + ' vs x' + full[c].s.toFixed(3)).join(', '));
      restore('data_econ_daily_by_source', sFeed); restore('export_scale', sTab); ctx = fresh();
    } else console.log('SKIP the shorter-feed gates: this dump\'s feed is as long as its export');
    // the zeros of the days the feed does not carry are not a measurement: pre-D96 they were read as one
    {
      const anyRho = cands.filter(c => short[c].chk.ok && short[c].chk.rho > 0);
      if (anyRho.length) {
        const c = anyRho[0], chk = short[c].chk, e = tab.src[c].res[chk.use];
        let all = 0; for (let d = tab.first; d <= tab.last; d++) all += num(e.days[d]);
        check('an event paying on days the feed lacks: f is above the plain share of the table (which counts those days as zero)',
          chk.f > 0 && all > 0, c + ': f ' + chk.f.toFixed(3) + ', rho ' + chk.rho.toFixed(2));
      }
    }
    // a feed that starts after the export: no per-event scale, said so
    {
      const v = data['data_econ_daily_by_source'].values;
      data['data_econ_daily_by_source'].values = v.filter((r, i) => i === 0 || num(r[fh['day_index']]) > 3);
      const c2 = rebuild();
      const chk = exportScaleCheck_('Target Day', 'HC', c2);
      check('a feed that starts after the export does keeps the activity scale, with the reason', !chk.ok && /starts on day/.test(chk.reason) &&
        spanScaleEvent_('Target Day', '20-39', 'PAYER', 'HC', c2) === null, chk.reason);
      restore('data_econ_daily_by_source', sFeed); restore('export_scale', sTab); ctx = fresh();
    }
  }
}

eval(PRELUDE + '\n(' + GATES.toString() + ')();\n' + `
console.log('');
console.log(failures ? (failures + ' CHECK(S) FAILED') : 'ALL D94 / D95 / D96 GATES PASS');
process.exit(failures ? 1 : 0);
`);
