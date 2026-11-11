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
// D103 (the wager places, bottom-up):
//  12  the behaviour table: defaults = the data, a typed number wins, the share label moves Bomb
//  13  places by hand for one cell (bank chance, spread, league, binomial) = the engine's, every place
//  14  the redesign row = SUM_festivals E_wager(festival) x Participation x reach, by hand
//  15  rules: mass = bank chance; a later 'Submit after' trades bank chance for score; WAGER_BOTTOMUP = false = D102
//  16  the local sim (ECOGAINS_MIC) = the engine's numbers and follows a table edit; the card sim draws the same places
// D104 (the fallback: a player who never reaches 'Submit after' banks their best streak of the festival):
//  17  on the board = P(best streak >= 1); levels below k = G(j) - G(j+1); the switch cell; off = D103's places
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

  // ---- 4 bottom-up by hand (D102 places: the wager model OFF) --------------------------------------
  WAGER_BOTTOMUP = false; reset(); precompute();
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
  const pRow = micV.findIndex(r => String(r[0]).trim() === 'Participation');
  const part = (pRow >= 0 && isFinite(parseFloat(micV[pRow][1]))) ? parseFloat(micV[pRow][1]) : num(ins.participation_rate);
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
  const d102 = rowsOf(MIC);                              // kept for gate 15
  WAGER_BOTTOMUP = true; reset(); precompute();

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

  // ================================ D103: the wager places ================================
  reset(); precompute();
  const WS = WAGER_SPECS[MIC], SH2 = spec.v2;
  const tabRow = micV.findIndex(r => String(r[0]).trim() === 'Segment' && r.indexOf(WS.hdrLabel) >= 0);
  gate('12 the behaviour table is on Mic_v2', tabRow >= 0, 'header row ' + (tabRow + 1));
  const th = micV[tabRow] || [], tcol = n => th.indexOf(n);
  const rowOf = (sg, p) => micV.findIndex((r, i) => i > tabRow && segCanon_(String(r[0])) === segCanon_(sg) && String(r[1]).trim() === p);
  // offline the defaults are formulas with no cached value - the engine computes them from the data
  const ds3 = Context.get().ds, st3 = ds3.nsStreak(SEG, PAY), b3 = ds3.beh(SEG, PAY);
  const pW = num(b3.weekday_active_rate), Lc = 2, act = Lc * pW / (1 - Math.pow(1 - pW, Lc));
  const red3 = num(ds3.eventInst('Red', SEG, PAY).avg_final_token_balance) / (num(st3.wins_per_day_mean) * act);
  const chuck3 = num(ds3.eventInst('Chuck', SEG, PAY).avg_final_token_balance) / (num(st3.wins_per_day_mean) * act);
  const c3 = wagerCell_(MIC, SEG, PAY, SH2);
  gate('12 defaults: k = max_streak_per_day_p50, Red / Chuck per win off the challenge balances, Bomb = 0.5 x Chuck',
    c3.k === num(st3.max_streak_per_day_p50) && close(c3.red, red3, 1e-12) && close(c3.chuck, chuck3, 1e-12) &&
    close(c3.bomb, 0.5 * chuck3, 1e-12) && close(c3.pts, red3 + 2 * chuck3 + 4 * 0.5 * chuck3, 1e-12),
    'k ' + c3.k + ', red ' + c3.red.toFixed(2) + ', chuck ' + c3.chuck.toFixed(2) + ', points/win ' + c3.pts.toFixed(2));
  const tr3 = rowOf(SEG, PAY), keep3 = micV[tr3].slice();
  micV[tr3][tcol(WS.hdrLabel)] = 7; micV[tr3][tcol('Red birds per win')] = 3; reset();
  const c3b = wagerCell_(MIC, SEG, PAY, SH2);
  gate('12 a typed number wins over the default (Submit after 7, Red 3)', c3b.k === 7 && c3b.red === 3 && c3b.typed.k && c3b.typed.red);
  micV[tr3] = keep3; reset();
  const shRow = micV.findIndex(r => String(r[0]).trim() === 'Bomb birds per win (share of Chuck)'), shKeep = micV[shRow][1];
  micV[shRow][1] = 1; reset();
  gate('12 the Bomb share cell moves Bomb birds per win', close(wagerCell_(MIC, SEG, PAY, SH2).bomb, chuck3, 1e-12));
  micV[shRow][1] = shKeep; reset(); precompute();

  // ---- 13 places by hand ------------------------------------------------------------------------------
  const lin = (pts, x) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]){ const a = pts[i - 1], z = pts[i];
    return a[1] + (z[1] - a[1]) * (x - a[0]) / Math.max(1e-9, z[0] - a[0]); } return null; };
  const handCell = (sg, p) => {
    const d = Context.get().ds, st = d.nsStreak(sg, p) || {}, bb = d.beh(sg, p) || {};
    const pw = num(bb.weekday_active_rate), pe = num(bb.weekend_active_rate);
    const a2 = 2 * pw / (1 - Math.pow(1 - pw, 2)), w = num(st.wins_per_day_mean);
    const pr = ev => { const e = d.eventInst(ev, sg, p); return (e && w > 0 && a2 > 0) ? num(e.avg_final_token_balance) / (w * a2) : 0; };
    const r = pr('Red'), ch = pr('Chuck'), k = num(st.max_streak_per_day_p50);
    // streak survival: piecewise linear through the four percentiles, the last slope continued
    const sp = [[0, 0]]; [[st.max_streak_per_day_p25, .25], [st.max_streak_per_day_p50, .5], [st.max_streak_per_day_p75, .75], [st.max_streak_per_day_p90, .9]]
      .forEach(q => { if (num(q[0]) > sp[sp.length - 1][0]) sp.push([num(q[0]), q[1]]); });
    const sl = (sp[sp.length - 1][1] - sp[sp.length - 2][1]) / (sp[sp.length - 1][0] - sp[sp.length - 2][0]);
    const cdf = x => { const v = lin(sp, x); return v !== null ? v : Math.min(1, sp[sp.length - 1][1] + (x - sp[sp.length - 1][0]) * sl); };
    // spread: Red's balance quantiles, mean 1
    const re = d.eventInst('Red', sg, p) || {}, bp = [[0, 0]];
    [[re.final_balance_p25, .25], [re.final_balance_p50, .5], [re.final_balance_p75, .75]].forEach(q => { if (num(q[0]) > bp[bp.length - 1][0] && q[1] > bp[bp.length - 1][1]) bp.push([num(q[0]), q[1]]); });
    let f = Array(40).fill(1);
    if (bp.length >= 2){
      const za = bp[bp.length - 2], zz = bp[bp.length - 1], s2 = (zz[1] - za[1]) / (zz[0] - za[0]);
      if (zz[1] < 1 && s2 > 0) bp.push([zz[0] + (1 - zz[1]) / s2, 1]);
      const Q = u => { for (let i = 1; i < bp.length; i++) if (u <= bp[i][1]){ const a = bp[i - 1], z = bp[i]; return a[0] + (z[0] - a[0]) * (u - a[1]) / (z[1] - a[1]); } return bp[bp.length - 1][0]; };
      const qs = Array.from({ length: 40 }, (_, i) => Q((i + 0.5) / 40)), m = qs.reduce((x, y) => x + y, 0) / 40;
      f = qs.map(x => x / m);
    }
    const wt = num((d.eventInst('Red', sg, p) || {}).avg_participants_per_instance);
    return { k, pts: r + 2 * ch + 4 * 0.5 * ch, S: j => Math.max(0, 1 - cdf(j)), f, pw, pe, wt };
  };
  // the festival's best streak: G(j) = 1 - (1 - S(j))^D; banked at k if reached, else (fallback) at the best j
  const handSide = (c, x, fb) => { let q = 1, spd = 0; x.days.forEach(dd => { const pd = isWeekend_(dd) ? c.pe : c.pw; q *= 1 - pd; spd += pd; });
    const reach = 1 - q, D = reach > 0 ? spd / reach : 0, G = j => D > 0 ? 1 - Math.pow(1 - Math.min(1, c.S(j)), D) : 0;
    const lv = []; if (fb !== false) for (let j = 1; j < c.k; j++) lv.push([j, G(j) - G(Math.min(j + 1, c.k))]);
    lv.push([c.k, G(c.k)]);
    const tot = lv.reduce((a, l) => a + l[1], 0), sc = [];
    lv.forEach(l => c.f.forEach(fi => sc.push([l[0] * c.pts * fi, l[1] / tot / c.f.length])));
    return { q: tot, qk: G(c.k), sc }; };
  const x13 = micInst[0];
  const opp = []; let W = 0;
  segMembers_(Context.get().ds).forEach(sg => ['NONPAYER', 'PAYER'].forEach(p => { const c = handCell(sg, p); if (c.wt > 0){ opp.push({ w: c.wt, s: handSide(c, x13) }); W += c.wt; } }));
  const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  const handPlaces = (sg, p, x, fb) => {
    const opp = []; let W = 0;
    segMembers_(Context.get().ds).forEach(s2 => ['NONPAYER', 'PAYER'].forEach(p2 => { const c = handCell(s2, p2); if (c.wt > 0){ opp.push({ w: c.wt, s: handSide(c, x, fb) }); W += c.wt; } }));
    const me = handSide(handCell(sg, p), x, fb), hand = Array(60).fill(0);
    me.sc.forEach(([sv, wv]) => {
      let B = 0; opp.forEach(o => { let g = 0; o.s.sc.forEach(([y, wy]) => { g += wy * (y > sv ? 1 : (y === sv ? 0.5 : 0)); }); B += (o.w / W) * o.s.q * g; });
      for (let k = 0; k < 60; k++) hand[k] += me.q * wv * choose(59, k) * Math.pow(B, k) * Math.pow(1 - B, 59 - k);
    });
    return { hand, me };
  };
  const { hand, me } = handPlaces(SEG, PAY, x13);
  const eng = wagerRankDist_(MIC, SEG, PAY, x13, SH2);
  const gap = Math.max(...hand.map((h, i) => Math.abs(h - eng.dist[i].p)));
  gate('13 places by hand = the engine, every place (' + SEG + ' ' + PAY + ', festival 1)', gap < 1e-12 && close(eng.q, me.q, 1e-12),
    'on the board ' + me.q.toFixed(4) + ' (reach k ' + me.qk.toFixed(4) + '), worst place gap ' + gap.toExponential(2));

  // ---- 14 the redesign row by hand -------------------------------------------------------------------
  const lad14 = lbLadder_(SH2, spec), b14 = Context.get().ds.beh(SEG, PAY);
  const part14 = parseFloat(micV[pRow][1]);
  gate('14 Participation = the design cell (0.3) on both sides', part14 === 0.3 && packParticipation_(MIC, Context.get().ds.eventInst(spec.inst, SEG, PAY)) === 0.3);
  const want14 = {};
  micInst.forEach(x => { const wd = wagerRankDist_(MIC, SEG, PAY, x, SH2), q = reachOne_(x, num(b14.weekday_active_rate), num(b14.weekend_active_rate));
    wd.dist.forEach(dd => { const rw = lad14[dd.rank] || {}; for (const r in rw) want14[r] = (want14[r] || 0) + part14 * q * dd.p * rw[r]; }); });
  const got14 = resultRow_(MIC, SEG, PAY, Context.get());
  const g14 = Math.max(...RESOURCES.filter(r => BOTTOMUP_RES.indexOf(r) < 0).map(r => Math.abs(num(got14[r]) - num(want14[r])) / Math.max(1e-6, Math.abs(num(want14[r])))));
  gate('14 redesign = SUM_festivals E_wager x Participation x reach, by hand', g14 < 1e-9, 'worst rel gap ' + g14.toExponential(2));
  say('     cell              k   pts/win board%   p25    p50    p75   paid%   coins/entry  SPT/entry   coins   SPT (window)');
  cells.forEach(c => { const wd = wagerRankDist_(MIC, c[0], c[1], x13, SH2), cc = wd.cell, we = wagerE_(MIC, c[0], c[1], x13, SH2).e;
    let cum = 0, paid = 0; const pl = {}; wd.dist.forEach(dd => { cum += dd.p; if (dd.rank <= 25) paid += dd.p; [.25, .5, .75].forEach(t => { if (pl[t] === undefined && cum >= t) pl[t] = dd.rank; }); });
    const s = resultRow_(MIC, c[0], c[1], Context.get()), P = t => String(pl[t] === undefined ? '-' : pl[t]).padStart(6);
    say('     ' + (c[0] + ' ' + c[1]).padEnd(17) + String(cc.k).padStart(3) + cc.pts.toFixed(1).padStart(9) + (100 * wd.q).toFixed(0).padStart(6) + '%' +
        P(.25) + ' ' + P(.5) + ' ' + P(.75) + (100 * paid).toFixed(0).padStart(7) + '%' + num(we.HC).toFixed(1).padStart(13) + num(we.SPT).toFixed(1).padStart(11) +
        num(s.HC).toFixed(1).padStart(8) + num(s.SPT).toFixed(1).padStart(7)); });

  // ---- 15 rules ---------------------------------------------------------------------------------------
  let massOk = true;
  cells.forEach(c => { const wd = wagerRankDist_(MIC, c[0], c[1], x13, SH2); let m = 0; wd.dist.forEach(dd => m += dd.p);
    if (!close(m, wd.q, 1e-9) || wd.q < 0 || wd.q > 1) massOk = false; });
  gate('15 place mass = bank chance (never banked = not on the board), every cell', massOk);
  const keep15 = micV[tr3].slice(), d0 = wagerRankDist_(MIC, SEG, PAY, x13, SH2), k0 = wagerCell_(MIC, SEG, PAY, SH2).k;
  micV[tr3][tcol(WS.hdrLabel)] = k0 + 5; reset();
  const d1 = wagerRankDist_(MIC, SEG, PAY, x13, SH2);
  micV[tr3] = keep15; reset();
  const top = d => Math.max(...d.side.scores);
  gate('15 submitting later: lower chance to reach it, higher top score, same chance on the board',
    d1.side.qk < d0.side.qk && top(d1) > top(d0) && close(d1.q, d0.q, 1e-12),
    'k ' + k0 + ' -> ' + (k0 + 5) + ': reach ' + d0.side.qk.toFixed(3) + ' -> ' + d1.side.qk.toFixed(3) + ', on board ' + d0.q.toFixed(3));
  WAGER_BOTTOMUP = false; reset(); precompute();
  const off = rowsOf(MIC);
  WAGER_BOTTOMUP = true; reset(); precompute();
  gate('15 WAGER_BOTTOMUP = false = the D102 pricing exactly', same(off, d102));
  const tKeep = micV[tabRow][0]; micV[tabRow][0] = 'Segments (renamed)'; reset(); precompute();
  gate('15 no behaviour table = the D102 pricing exactly', same(rowsOf(MIC), d102));
  micV[tabRow][0] = tKeep; reset(); precompute();

  // ---- 16 local sim + card sim -----------------------------------------------------------------------
  const ls = ECOGAINS_MIC(PAY, 0), lh = ls[0], lrow = ls.find(r => segCanon_(String(r[0])) === segCanon_(SEG));
  const dur16 = Math.round(num(readSPLabel_(SH2, 'EventDuration'))) || 2;
  let st16 = 1; for (let dd = 1; dd <= 14; dd++){ let ok = true; for (let j = 0; j < dur16; j++) if (isWeekend_(dd + j)) ok = false; if (ok){ st16 = dd; break; } }
  const we16 = wagerE_(MIC, SEG, PAY, mkInst_(st16, dur16), SH2);
  gate('16 local sim: one row per segment, coins / SPT per festival entered = the engine', ls.length === 1 + segMembers_(Context.get().ds).length + 1 &&
    close(lrow[lh.indexOf('Coins per festival entered')], num(we16.e.HC), 1e-12) && close(lrow[lh.indexOf('SPT per festival entered')], num(we16.e.SPT), 1e-12));
  const keep16 = micV[tr3].slice(); micV[tr3][tcol(WS.hdrLabel)] = 3; reset();
  const lrow2 = ECOGAINS_MIC(PAY, 1).find(r => segCanon_(String(r[0])) === segCanon_(SEG));
  micV[tr3] = keep16; reset();
  gate('16 local sim follows a table edit (Submit after 3)', lrow2[lh.indexOf('Submit after (wins)')] === 3 &&
    lrow2[lh.indexOf('Chance to reach Submit after')] > lrow[lh.indexOf('Chance to reach Submit after')] &&
    close(lrow[lh.indexOf('Chance on the board')], wagerRankDist_(MIC, SEG, PAY, mkInst_(st16, dur16), SH2).q, 1e-12));
  // an envelope on place 1: the card sim's rung at rank 1 has the wager's probability
  const env = th.length ? micV[9] : null, eCol = micV[8].indexOf('1-star Dly'), keepE = micV[9][eCol];
  micV[9][eCol] = 1; reset(); precompute();
  const rg = packRungs_(MIC, SEG, PAY, Context.get(), 0, null), r1 = rg && rg.groups[0].rungs.find(x => x.label === 'rank 1');
  const wd16 = wagerRankDist_(MIC, SEG, PAY, (Context.get().calNew[MIC] || []).slice().sort((a, z) => a.start - z.start)[0], SH2);
  gate('16 the card sim draws the wager places (rank-1 rung = the wager chance)', !!r1 && close(r1.p, wd16.dist[0].p, 1e-12),
    r1 ? r1.p.toFixed(5) + ' vs ' + wd16.dist[0].p.toFixed(5) : 'no rung');
  micV[9][eCol] = keepE; reset(); precompute();

  // ---- 17 the fallback (D104) ---------------------------------------------------------------------------
  const c17 = handCell(SEG, PAY), s17 = handSide(c17, x13), D17 = (() => { let q = 1, spd = 0; x13.days.forEach(dd => {
    const pd = isWeekend_(dd) ? c17.pe : c17.pw; q *= 1 - pd; spd += pd; }); return spd / (1 - q); })();
  gate('17 on the board = P(the festival\'s best streak >= 1 win)', close(s17.q, 1 - Math.pow(1 - Math.min(1, c17.S(1)), D17), 1e-12) && s17.q >= s17.qk,
    'on board ' + s17.q.toFixed(4) + ' vs reach k ' + s17.qk.toFixed(4));
  let fbOk = true;
  cells.forEach(c => { const a = wagerRankDist_(MIC, c[0], c[1], x13, SH2); if (!(a.q >= a.side.qk - 1e-12) || (a.cell.k > 1 && !(a.q > a.side.qk))) fbOk = false; });
  gate('17 every cell: on the board >= reaches Submit after (strictly, where Submit after > 1)', fbOk);
  const fbRow = micV.findIndex(r => String(r[0]).trim() === WAGER_FALLBACK_LABEL);
  gate('17 the switch is a cell on Mic_v2 (1 = on)', fbRow >= 0 && Number(micV[fbRow][1]) === 1);
  const fbKeep = micV[fbRow][1]; micV[fbRow][1] = 0; reset();
  const off17 = wagerRankDist_(MIC, SEG, PAY, x13, SH2), h17 = handPlaces(SEG, PAY, x13, false);
  const gap17 = Math.max(...h17.hand.map((h, i) => Math.abs(h - off17.dist[i].p)));
  gate('17 switch 0 = submit at k only (D103), places by hand', gap17 < 1e-12 && close(off17.q, off17.side.qk, 1e-12),
    'on board ' + off17.q.toFixed(4) + ', worst gap ' + gap17.toExponential(2));
  micV[fbRow][1] = fbKeep; reset();
  const on17 = wagerE_(MIC, SEG, PAY, x13, SH2).e; micV[fbRow][1] = 0; reset();
  const of17 = wagerE_(MIC, SEG, PAY, x13, SH2).e; micV[fbRow][1] = fbKeep; reset(); precompute();
  say('     ' + SEG + ' ' + PAY + ' per festival entered, fallback off -> on: coins ' + num(of17.HC).toFixed(1) + ' -> ' + num(on17.HC).toFixed(1) + ', SPT ' + num(of17.SPT).toFixed(1) + ' -> ' + num(on17.SPT).toFixed(1));

  say('\n' + pass + ' pass, ' + fail + ' fail');
  if (fail) process.exitCode = 1;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
