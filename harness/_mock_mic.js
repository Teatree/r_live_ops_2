// D102 gates: Mighty Ice Cream, a NEW leaderboard (Mic_v2), priced bottom-up on Red's measured places.
//   node harness/_mock_mic.js [--data v3u | <dump.json>] [--seg 40-99 --payer PAYER]
// v3u = 'LIVE_OPS_V3 - Kite Festival - 2d and 3d (1)' with display/Mic_v2.xlsx overlaid (the sheet is not in
// the workbook yet). The calendar edits the user described are made here, in memory, then cal_parsed is
// rebuilt the way Precompute calendars does it (parseCalendarLive_ on both calendars):
//   cal_new: Red's Challenge of days 22-25 (row 14) MOVED to row 10; 'Mighty Ice Cream' on row 14, same days.
// Rules asserted (never the dump's numbers):
//   1  the sheet: 25 places on a league of 60, the ladder the server JSON pays, every column mapped
//   2  places: borrowed from the 'Places from' event (Red), switchable, real rows win
//   3  the calendar move: Red's instances and Red's rows identical before / after the move
//   4  TODAY = 0 (cal_curr runs none); REDESIGN = SUM_inst E x participation x reach, by hand
//   5  Red's rows untouched by Mighty Ice Cream; only the SPT-coupled rows may move
//   6  identical calendars + configs -> DIFF 0 on every resource and cell
//   7  once the export carries it: measured = export, redesign = export x walk_new / walk_cur
//   8  daily view: conserves the window total, pays the day after each instance
//   9  change summary model = bottom-up; Sim per Segment group = META
//  10  Fill all sims writes the 'Mighty Ice Cream' label under 'Col - Albums' and maps it
//  11  play-by-play: the lane is read (no error); calendar stats count it
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3u');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
global.__SEG = arg('--seg', '40-99'); global.__PAY = arg('--payer', 'PAYER');
const _log = console.log; global.__say = _log; console.log = () => {};

function GATES(){
  eval(fs.readFileSync(ENGINE('SimFill.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('ChangeSummary.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('SimPerSegmentFill.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('CalStats.gs'), 'utf8'));
  const say = global.__say, SEG = global.__SEG, PAY = global.__PAY;
  let pass = 0, fail = 0;
  const gate = (name, ok, detail) => { ok ? pass++ : fail++; say((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };
  const close = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-9) * Math.max(1, Math.abs(b));
  const reset = () => { resetSheetCache_mock(); Context.reset(); };
  const MIC = 'Mighty Ice Cream', RED = 'Red Challenge', clone = x => JSON.parse(JSON.stringify(x));
  if (!data['Mic_v2']){ say('FAIL no Mic_v2 sheet in the dump - run python harness/_dump_mockdata.py --overlay-into ... --pending "Mic_v2=Mic_v2.xlsx"'); process.exitCode = 1; return; }

  const eg = exportScaleGrid_(Context.get());
  if (eg){ data['export_scale'] = { values: eg, merges: [] }; reset(); }
  const ctx0 = Context.get(), cells = [];
  segMembers_(ctx0.ds).concat(ctx0.ds.segs().indexOf('ALL') >= 0 ? ['ALL'] : []).forEach(s =>
    ['NONPAYER', 'PAYER'].forEach(p => cells.push([s, p])));
  const rowsOf = (cat) => { const o = {}; cells.forEach(c => {
    o[c.join('|')] = { sim: rowToArray_(resultRow_(cat, c[0], c[1], Context.get())),
                       meas: rowToArray_(measuredRow_(cat, c[0], c[1], Context.get().ds)) }; }); return o; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const precompute = () => {
    const rows = [['calendar', 'event', 'start', 'dur']];
    [CAL_CUR, CAL_NEW].forEach(cal => { const inst = parseCalendarLive_(cal);
      Object.keys(inst).forEach(ev => inst[ev].forEach(x => rows.push([cal, ev, x.start, x.dur]))); });
    data[CAL_PARSED_SHEET] = { values: rows, merges: [] }; reset();
  };
  const instList = (cal, lane) => (Context.get()[cal][lane] || []).map(x => x.start + '+' + x.dur).join(' ');

  // ---- 1 the sheet ------------------------------------------------------------------------------
  const spec = LB_R_SPECS[MIC], lad = lbLadder_(spec.v2, spec);
  const nPlaces = Object.keys(lad).length;
  gate('1  25 places read off Mic_v2', nPlaces === 25, String(nPlaces));
  gate('1  league size 60 (LBSize)', lbSize_(spec.v2, spec.hdr) === 60, String(lbSize_(spec.v2, spec.hdr)));
  const want1 = { HC: 300, Comet: 1, SPT: 400 }, want6 = { Slingshot: 1, SPT: 140 }, want11 = { Bomb: 1, SPT: 105 },
        want13 = { Chuck: 1, SPT: 95 }, want15 = { Red: 1, SPT: 85 }, want25 = { SPT: 30 };
  const eqRung = (k, w) => RESOURCES.every(r => num(lad[k][r]) === num(w[r]));
  gate('1  the server JSON ladder (places 1 / 6 / 11 / 13 / 15 / 25)',
    eqRung(1, want1) && eqRung(6, want6) && eqRung(11, want11) && eqRung(13, want13) && eqRung(15, want15) && eqRung(25, want25));
  // every place against the server JSON itself (the builder's item mapping, restated here independently)
  const JMAP = { HardCoin: 'HC', SeasonPassToken: 'SPT', CherryBomb: 'Comet', Hammer: 'Slingshot', Shuffle: 'Shuffle',
                 'Pre-Red': 'Red', 'Pre-Chuck': 'Chuck', 'Pre-Bomb': 'Bomb' };
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'builders', 'mic_server_config.json'), 'utf8'));
  let jsonOk = json.rewards.length === nPlaces;
  json.rewards.forEach((rung, i) => { const w = {}; rung.forEach(it => { w[JMAP[it.item]] = (w[JMAP[it.item]] || 0) + it.amount; });
    if (!eqRung(i + 1, w)) jsonOk = false; });
  gate('1  every place = the server JSON (all ' + json.rewards.length + ')', jsonOk);
  gate('1  no base sheet: the anchor side reads Mic_v2', lbBaseSheet_(spec) === 'Mic_v2');

  // ---- 2 places -----------------------------------------------------------------------------------
  let proxyOk = true;
  cells.forEach(c => { const m = ctx0.ds.eventInst(spec.inst, c[0], c[1]), r = ctx0.ds.eventInst('Red', c[0], c[1]);
    if (!same(m, r)) proxyOk = false; });
  gate("2  places = Red's measured places in every cell", proxyOk);
  const micV = data['Mic_v2'].values, pfRow = micV.findIndex(r => String(r[0]).trim() === 'Places from');
  gate("2  'Places from' cell present (Red)", pfRow >= 0 && String(micV[pfRow][1]).trim() === 'Red');
  micV[pfRow][1] = 'Chuck'; reset();
  gate("2  'Places from' = Chuck switches to Chuck's places",
    same(Context.get().ds.eventInst(spec.inst, SEG, PAY), Context.get().ds.eventInst('Chuck', SEG, PAY)));
  micV[pfRow][1] = 'Red'; reset();
  const inst0 = data['data_event_inst'].values, h = inst0[0];
  const redRow = inst0.find(r => r[h.indexOf('event_name')] === 'Red' && r[h.indexOf('payer_flag')] === PAY && segCanon_(r[h.indexOf('segment')]) === segCanon_(SEG));
  const own = redRow.slice(); own[h.indexOf('event_name')] = MIC; own[h.indexOf('position_p50')] = 33;
  inst0.push(own); reset();
  gate('2  real Mighty Ice Cream rows win', num(Context.get().ds.eventInst(spec.inst, SEG, PAY).position_p50) === 33);
  inst0.pop(); reset();
  const rd = lbRankDist_(spec.v2, spec, ctx0.ds.eventInst(spec.inst, SEG, PAY));
  let pSum = 0; rd.dist.forEach(d => pSum += d.p);
  gate('2  the place curve runs to the 60-player board and sums to 1', rd.dist.length === 60 && close(pSum, 1, 1e-9),
    rd.dist.length + ' places, ' + pSum.toFixed(12));

  // ---- 3 the calendar move ------------------------------------------------------------------------
  precompute();                                         // the dump's own calendars, freshly parsed
  const redBefore = rowsOf(RED), allBefore = {};
  CATEGORY_ORDER.forEach(cat => { allBefore[cat] = rowsOf(cat); });
  const redInstBefore = instList('calNew', "Red's Challenge");
  const cn = data['cal_new'], v = cn.values;
  const r14 = 13, r10 = 9;                              // 0-based rows 14 / 10
  const late = cn.merges.filter(m => m.r === 14 && m.c >= 29);
  gate("3  fixture: Red's Challenge on row 14, days 22-25", late.length === 2 && late.every(m => /Red's/.test(v[r14][m.c - 1])),
    late.map(m => m.c + '+' + m.nc).join(' '));
  late.forEach(m => {
    for (let c = m.c; c < m.c + m.nc; c++){ v[r10][c - 1] = v[r14][c - 1]; v[r14][c - 1] = ''; }
    if ((v[r10].slice(m.c - 1, m.c - 1 + m.nc)).some(x => x === undefined)) throw new Error('row 10 too short');
    m.r = 10;
  });
  precompute();
  gate("3  Red's moved to row 10: same instances", instList('calNew', "Red's Challenge") === redInstBefore, redInstBefore);
  gate("3  Red's moved to row 10: every Red's row identical", same(rowsOf(RED), redBefore));
  // Mighty Ice Cream on row 14, the same two 2-day blocks
  // the user's label (2026-11-11): 'MiC 🍦' - the other spellings must read the same lane
  const LABEL = 'MiC 🍦';
  late.forEach(m => cn.merges.push({ r: 14, c: m.c, nr: 1, nc: m.nc }));
  ['Mighty Ice Cream', 'MIC', 'mic\n🍦'].forEach(alt => {
    late.forEach(m => { v[r14][m.c - 1] = alt; });
    precompute();
    gate('3  label ' + JSON.stringify(alt) + ' reads the Mighty Ice Cream lane', instList('calNew', MIC) === '22+2 24+2');
  });
  late.forEach(m => { v[r14][m.c - 1] = LABEL; });
  // a cal_parsed written with the raw label (by an engine without the alias) is normalised on read
  precompute();
  data[CAL_PARSED_SHEET].values.forEach(r => { if (r[1] === MIC) r[1] = LABEL; }); reset();
  gate('3  a cal_parsed holding the raw label reads the same lane', instList('calNew', MIC) === '22+2 24+2');
  precompute();
  const micInst = Context.get().calNew[MIC] || [];
  gate('3  ' + LABEL + ' parsed from cal_new row 14', micInst.length === 2, instList('calNew', MIC));

  // ---- 4 bottom-up by hand ------------------------------------------------------------------------
  let zeroCur = true;
  cells.forEach(c => { if (measuredRow_(MIC, c[0], c[1], Context.get().ds) && rowToArray_(measuredRow_(MIC, c[0], c[1], Context.get().ds)).some(x => x !== 0)) zeroCur = false; });
  gate('4  TODAY = 0 on every cell (cal_curr runs none)', zeroCur);
  const ctx = Context.get(), ds = ctx.ds, ins = ds.eventInst('Red', SEG, PAY), b = ds.beh(SEG, PAY);
  const pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  // E by hand: the rank CDF through Red's p25/p50/p75 to 60, the Mic_v2 ladder read off the raw values
  const hdr = micV[8], E = {};
  const dist = rankDist_(ins, 60);
  dist.forEach(d => { const row = micV[8 + d.rank]; if (!row || d.rank > 25) return;
    hdr.forEach((name, ci) => { const res = RES_MAP[String(name).trim()]; if (ci >= 1 && res) E[res] = (E[res] || 0) + d.p * num(row[ci]); }); });
  const part = num(ins.participation_rate);
  let reachSum = 0; micInst.forEach(x => { reachSum += reachOne_(x, pWd, pWe); });
  const sim = resultRow_(MIC, SEG, PAY, ctx);
  const nonPack = RESOURCES.filter(r => BOTTOMUP_RES.indexOf(r) < 0);
  const worst = Math.max(...nonPack.map(r => Math.abs(num(sim[r]) - num(E[r]) * part * reachSum) / Math.max(1e-9, Math.abs(num(E[r]) * part * reachSum), 1e-6)));
  gate('4  REDESIGN = E x participation x SUM reach, by hand (' + SEG + ' ' + PAY + ')', worst < 1e-9, 'worst rel gap ' + worst.toExponential(2));
  say('     E per festival entered: coins ' + num(E.HC).toFixed(2) + ', SPT ' + num(E.SPT).toFixed(1) + ', participation ' + part +
      ', reach sum ' + reachSum.toFixed(3) + ' -> coins ' + num(sim.HC).toFixed(2) + ', SPT ' + num(sim.SPT).toFixed(1) + ' per earner-window');
  say('     cell              p25/p50/p75   paid     coins     SPT  Slingshot  Shuffle');
  cells.forEach(c => { const s = resultRow_(MIC, c[0], c[1], ctx), x = ds.eventInst('Red', c[0], c[1]) || {};
    const dd = rankDist_(x, 60) || []; let paid = 0; dd.forEach(d => { if (d.rank <= 25) paid += d.p; });
    say('     ' + (c[0] + ' ' + c[1]).padEnd(17) + ([x.position_p25, x.position_p50, x.position_p75].join('/')).padStart(12) +
        (100 * paid).toFixed(0).padStart(6) + '%' + num(s.HC).toFixed(1).padStart(10) + num(s.SPT).toFixed(1).padStart(8) +
        num(s.Slingshot).toFixed(2).padStart(10) + num(s.Shuffle).toFixed(2).padStart(9)); });

  // ---- 5 what else moves ---------------------------------------------------------------------------
  gate("5  Red's rows untouched by Mighty Ice Cream", same(rowsOf(RED), redBefore));
  const COUPLED = { 'Season Pass (Free)':1, 'Season Pass (Paid)':1, 'ToF':1, 'Col - Sets':1, 'Col - Albums':1 };
  const moved = [], coupledMoved = [];
  CATEGORY_ORDER.forEach(cat => { if (cat === MIC || !allBefore[cat]) return;
    if (!same(rowsOf(cat), allBefore[cat])) (COUPLED[cat] ? coupledMoved : moved).push(cat); });
  gate('5  no other row moves except the SPT-coupled ones', !moved.length, moved.join(', ') + (coupledMoved.length ? '  (moved, coupled: ' + coupledMoved.join(', ') + ')' : ''));

  // ---- 6 identical calendars ------------------------------------------------------------------------
  const curSave = clone(data['cal_curr']);
  data['cal_curr'] = clone(data['cal_new']); precompute();
  let diff0 = true, nonzero = false;
  cells.forEach(c => { const m = rowToArray_(measuredRow_(MIC, c[0], c[1], Context.get().ds)), s = rowToArray_(resultRow_(MIC, c[0], c[1], Context.get()));
    if (s.some((x, i) => !close(x, m[i], 1e-12))) diff0 = false; if (m.some(x => x > 0)) nonzero = true; });
  gate('6  identical calendars + configs -> DIFF 0, every resource and cell', diff0 && nonzero);
  data['cal_curr'] = curSave; precompute();

  // ---- 7 the export carries it ------------------------------------------------------------------------
  const gv = data['data_gains'].values, gh = gv[0], gi = n => gh.indexOf(n);
  const tmpl = gv.find(r => String(r[gi('category')]) === 'Red Challenge' && String(r[gi('resource')] || r[gi('currency')]) !== '');
  if (tmpl){
    const walkNew = resultRow_(MIC, SEG, PAY, Context.get());
    const added = [];
    const sc = gi('engagement_segment') >= 0 ? gi('engagement_segment') : gi('segment');
    gv.forEach(r => { if (String(r[gi('category')]) === 'Red Challenge' && String(r[gi('payer_flag')]) === PAY && segCanon_(r[sc]) === segCanon_(SEG)){
      const x = r.slice(); x[gi('category')] = MIC; added.push(x); } });
    added.forEach(x => gv.push(x));
    data['cal_curr'] = clone(data['cal_new']); precompute();          // cal_curr runs it, so a walk exists on both sides
    const ctx7 = Context.get(), exp = measuredRowCore_(MIC, SEG, PAY, ctx7.ds), meas7 = measuredRow_(MIC, SEG, PAY, ctx7.ds);
    const cur7 = newLbAnchor_(MIC, SEG, PAY), new7 = newLbWalk_(MIC, SEG, PAY, ctx7), sim7 = resultRow_(MIC, SEG, PAY, ctx7);
    gate('7  the export is the measured side', RESOURCES.every(r => num(meas7[r]) === num(exp[r])) && RESOURCES.some(r => num(exp[r]) > 0));
    gate('7  redesign = export x walk_new / walk_cur (anchorOne_)', RESOURCES.every(r => close(num(sim7[r]), anchorOne_(num(exp[r]), num(cur7[r]), num(new7[r])), 1e-12)));
    gv.splice(gv.length - added.length, added.length);
    data['cal_curr'] = curSave; precompute();
  } else gate('7  (skipped: no Red Challenge rows in data_gains)', true);

  // ---- 8 daily ---------------------------------------------------------------------------------------
  const ctx8 = Context.get(), tot = resultRow_(MIC, SEG, PAY, ctx8);
  const nw = ECOGAINS_DAILY(PAY, SEG, MIC, 'NEW'), cu = ECOGAINS_DAILY(PAY, SEG, MIC, 'CURRENT');
  const hc = RESOURCES.indexOf('HC'), spt = RESOURCES.indexOf('SPT');
  let sHC = 0, sSPT = 0, cAny = false; const paidDays = [];
  nw.forEach((row, d) => { sHC += num(row[hc]); sSPT += num(row[spt]); if (num(row[spt]) > 0) paidDays.push(d + 1); });
  cu.forEach(row => row.forEach(x => { if (num(x) !== 0) cAny = true; }));
  gate('8  daily NEW sums to the window total (coins, SPT)', close(sHC, num(tot.HC), 1e-9) && close(sSPT, num(tot.SPT), 1e-9),
    sHC.toFixed(3) + ' / ' + num(tot.HC).toFixed(3));
  const ends = micInst.map(x => x.start + x.dur);       // the day after the last day (settle +1)
  gate('8  daily NEW pays the day after each instance', paidDays.length && paidDays.every(d => ends.indexOf(d) >= 0), 'days ' + paidDays.join(',') + ' / ends ' + ends.join(','));
  gate('8  daily CURRENT is 0', !cAny);

  // ---- 9 change summary / Sim per Segment -------------------------------------------------------------
  gate('9  change summary model: bottom-up', csModelOf_(MIC, 1, {}) === 'bottom-up');
  const g = spsGroupOf_();
  gate('9  Sim per Segment: META, not unlisted', g.map[MIC] === 'META' && (g.unlisted || []).indexOf(MIC) < 0);

  // ---- 10 Fill all sims appends the row -----------------------------------------------------------------
  const SH = 'EcoGainsSim';
  if (data[SH]){
    const v0 = clone(data[SH].values);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tags = simFillSegTags_(data[SH].values);
    const added = simFillAppendSources_(ss, SH);
    const vv = data[SH].values;
    let under = 0, blocks = 0;
    tags.forEach(t => { const r = vv.findIndex((row, i) => i > t.r && String(row[t.c - 1]).trim() === 'Col - Albums');
      if (r < 0) return; blocks++; if (String((vv[r + 1] || [])[t.c - 1]).trim() === MIC) under++; });
    gate('10 the label lands under Col - Albums wherever a blank row follows', added.length === under && under > 0,
      under + ' of ' + blocks + ' tables (' + added.join('; ') + ')');
    gate('10 a second run adds nothing', simFillAppendSources_(ss, SH).length === 0);
    const lay = simFillLayoutAnchors_(SH, vv, vv.length, 60);
    const mapped = lay.anchors.filter(a => a.map && a.map.rows[MIC] !== undefined).length;
    gate('10 the fill maps the new row (SIM and DIFF blocks)', mapped === 2 * under, mapped + ' anchors');
    let othersSame = true;
    v0.forEach((row, r) => row.forEach((x, c) => { if (String(x) !== String((vv[r] || [])[c]) && String((vv[r] || [])[c]) !== MIC) othersSame = false; }));
    gate('10 nothing else on the sheet changes', othersSame);
    data[SH].values = v0;
  } else gate('10 (skipped: no EcoGainsSim sheet in the dump)', true);

  // ---- 11 PBP / calendar stats ----------------------------------------------------------------------------
  let pbpOk = true, pbpErr = '';
  try { eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));
        const day = micInst[0].start + micInst[0].dur - 1;
        const led = ECOGAINS_PBP('cal_new', day, SEG, PAY, 'Expected', 'p50', 1);
        if (!Array.isArray(led) || /error/i.test(String(led[0] && led[0][0]))){ pbpOk = false; pbpErr = String(led[0] && led[0][0]); }
        else if (!JSON.stringify(led).includes(MIC)){ pbpOk = false; pbpErr = 'no Mighty Ice Cream line in the ledger'; } }
  catch (e){ pbpOk = false; pbpErr = String(e); }
  gate('11 play-by-play reads the lane', pbpOk, pbpErr);
  gate('11 calendar stats know the lane', CALSTATS_LABEL[MIC] === MIC && CAL_LABEL[MIC] === MIC && DAILY_CAL_LABEL[MIC] === MIC);

  say('\n' + pass + ' pass, ' + fail + ' fail');
  if (fail) process.exitCode = 1;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
