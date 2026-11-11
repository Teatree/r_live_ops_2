// D105 gates: Mighty Ice Cream priced on its own results (data_mic), Mic_v2's measured layout.
//   node harness/_mock_mic_data.js [--data v3v] [--seg 40-99 --payer PAYER]
// v3v = 'LIVE_OPS_V3 - Kite Festival - MiC' (data_mic, MiC on cal_new row 14) with display/Mic_v2.xlsx overlaid.
// cal_parsed is rebuilt the way Precompute calendars does it (the workbook's is stale: no MiC rows).
// Rules asserted (never the dump's numbers):
//   1  the sheet: the measured layout is found, every label the engine reads is on it
//   2  defaults = data_mic, read by an INDEPENDENT parse here; a typed number wins; no payer split
//   3  the score quantiles: median = p50, mean = the measured average (the tail is set by it)
//   4  league size: data_mic's average; the cell wins; a fraction is the mix of the two whole sizes
//   5  places by hand for one cell (quantiles, opponent mix, binomial mixture) = the engine's, every place
//   6  participation: per segment; the override cell sets every cell; the pack lane and card sim read the same
//   7  redesign = SUM_festivals E x participation x reach, by hand; TODAY 0; identical calendars -> DIFF 0
//   8  the local sim: VALUE = SUM_r e[r] x item_vals row 3 (tickets at ToF_Value); x participation; = the engine
//   9  the D104 layout (streak table) still prices the streak model; no data at all -> the D102 places
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3v');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
global.__SEG = arg('--seg', '40-99'); global.__PAY = arg('--payer', 'PAYER');
const _log = console.log; global.__say = _log; console.log = () => {};

function GATES(){
  const say = global.__say, SEG = global.__SEG, PAY = global.__PAY;
  let pass = 0, fail = 0;
  const gate = (name, ok, detail) => { ok ? pass++ : fail++; say((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };
  const close = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-9) * Math.max(1, Math.abs(b));
  const reset = () => { resetSheetCache_mock(); Context.reset(); };
  const MIC = 'Mighty Ice Cream', SH = 'Mic_v2', WS = WAGER_SPECS[MIC], clone = x => JSON.parse(JSON.stringify(x));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!data[SH] || !data['data_mic']){ say('FAIL the dump needs Mic_v2 (overlay) and data_mic'); process.exitCode = 1; return; }
  const precompute = () => {
    const rows = [['calendar', 'event', 'start', 'dur']];
    [CAL_CUR, CAL_NEW].forEach(cal => { const inst = parseCalendarLive_(cal);
      Object.keys(inst).forEach(ev => inst[ev].forEach(x => rows.push([cal, ev, x.start, x.dur]))); });
    data[CAL_PARSED_SHEET] = { values: rows, merges: [] }; reset();
  };
  const eg = exportScaleGrid_(Context.get());
  if (eg) data['export_scale'] = { values: eg, merges: [] };
  precompute();
  const ctx0 = Context.get(), cells = [];
  segMembers_(ctx0.ds).concat(['ALL']).forEach(s => ['NONPAYER', 'PAYER'].forEach(p => cells.push([s, p])));
  const micV = data[SH].values;
  const insts = (Context.get().calNew[MIC] || []).slice().sort((a, b) => a.start - b.start);
  gate('0  cal_new runs Mighty Ice Cream (row 14, read through the loose alias)', insts.length > 0, insts.map(x => x.start + '+' + x.dur).join(' '));

  // ---- 1 the sheet ------------------------------------------------------------------------------
  const tab = wagerTable_(SH, WS);
  gate('1  the behaviour table is the measured layout', !!tab && tab.mode === 'scores');
  const hr = micV.findIndex(r => String(r[0]).trim() === 'Segment' && r.indexOf(WS.scoreLabel) >= 0), th = micV[hr] || [];
  const need = ['Participation (share of active)', 'Avg top score', 'Opponent share'].concat(MIC_SCORE_COLS.map(c => c[0]));
  gate('1  every column the engine reads is on the sheet', need.every(n => th.indexOf(n) >= 0), need.filter(n => th.indexOf(n) < 0).join(', '));
  const lab = n => micV.findIndex(r => String(r[0]).trim() === n);
  gate('1  the override and league cells are on the sheet', lab(WS.partLabel) >= 0 && lab(WS.leagueLabel) >= 0);
  gate("1  no plain 'Participation' label (it would override every source's pack lane)", lab('Participation') < 0);

  // ---- 2 defaults = data_mic (independent parse) --------------------------------------------------------
  const dm = data['data_mic'].values, t1 = dm.findIndex(r => String(r[0]).trim().toLowerCase() === 'segment');
  const h1 = dm[t1].map(x => String(x || '').trim().toLowerCase());
  const t3 = dm.findIndex(r => String(r[1]).trim() === 'Leaderboards'), h3 = dm[t3].map(x => String(x || '').trim().toLowerCase());
  const raw = (seg, col) => { const r = dm.slice(t1 + 1).find(x => String(x[0]).trim() === seg); return r ? Number(r[h1.indexOf(col)]) : null; };
  const pooled = seg => { const r = dm.slice(t3 + 1).find(x => String(x[0]).trim() === seg); return r ? Number(r[h3.indexOf('pooled share')]) : 0; };
  const league = Number(dm[t3 + 1][h3.indexOf('avg lb size')]);
  let defOk = true; const bad = [];
  cells.forEach(([s, p]) => { const c = wagerCell_(MIC, s, p, SH), lbl = segLabel_(s, ctx0.ds);
    const ok = c.part === raw(lbl, 'participation') && c.avg === raw(lbl, 'avg top score') && c.p50 === raw(lbl, 'p50') &&
               c.weight === pooled(lbl) && c.pcts.length >= 5;
    if (!ok){ defOk = false; bad.push(s + ' ' + p); } });
  gate('2  defaults = data_mic table 1 (participation, avg, p25..p98) + table 3 (pooled share), every cell', defOk, bad.join(', '));
  gate('2  no payer split: both payer rows of a segment read the same', cells.every(([s]) => same(wagerCell_(MIC, s, 'NONPAYER', SH).scores, wagerCell_(MIC, s, 'PAYER', SH).scores)));
  const rowOf = (sg, p) => micV.findIndex((r, i) => i > hr && segCanon_(String(r[0])) === segCanon_(sg) && String(r[1]).trim() === p);
  const tr = rowOf(SEG, PAY), keep = micV[tr].slice();
  micV[tr][th.indexOf('Top score p50')] = 999; micV[tr][th.indexOf('Participation (share of active)')] = 0.42; reset();
  const cT = wagerCell_(MIC, SEG, PAY, SH);
  gate('2  a typed number wins (p50 999, participation 0.42)', cT.p50 === 999 && cT.part === 0.42 && cT.typed['Top score p50']);
  micV[tr] = keep; reset();

  // ---- 3 quantiles ---------------------------------------------------------------------------------------
  let qOk = true; const qBad = [];
  segMembers_(ctx0.ds).forEach(s => { const c = wagerCell_(MIC, s, 'PAYER', SH), q = c.scores, n = q.length;
    const mean = q.reduce((a, x) => a + x, 0) / n, med = (q[n / 2 - 1] + q[n / 2]) / 2;
    // the average is unreachable when even a flat tail at the last percentile overshoots it (250+: p95 = p98 =
    // 30,900 on 18 players): then the tail stays flat there - the smallest mean the percentiles allow
    const top = Math.max(...c.pcts.map(p => p[0])), flat = Math.abs(Math.max(...q) - top) < 1e-9 && mean > c.avg;
    if ((!flat && Math.abs(mean - c.avg) > 0.02 * c.avg) || Math.abs(med - c.p50) > 0.03 * c.p50){ qOk = false; qBad.push(s + ' mean ' + mean.toFixed(0) + '/' + c.avg + ' p50 ' + med.toFixed(0) + '/' + c.p50); } });
  gate('3  quantiles: mean = the measured average (2%) - or a flat tail where it cannot be reached - and median = p50 (3%)', qOk, qBad.join('; '));

  // ---- 4 league ------------------------------------------------------------------------------------------
  gate('4  league size = data_mic avg LB size', close(wagerLeague_(MIC, SH), league, 1e-12), String(league));
  const x0 = insts[0], lr = lab(WS.leagueLabel), lKeep = micV[lr][1];
  micV[lr][1] = 20; reset();
  const d20 = wagerRankDist_(MIC, SEG, PAY, x0, SH);
  micV[lr][1] = 20.25; reset();
  const d2025 = wagerRankDist_(MIC, SEG, PAY, x0, SH);
  micV[lr][1] = 21; reset();
  const d21 = wagerRankDist_(MIC, SEG, PAY, x0, SH);
  micV[lr][1] = lKeep; reset();
  const mix = d2025.dist.map((d, i) => 0.75 * ((d20.dist[i] || { p: 0 }).p) + 0.25 * d21.dist[i].p);
  gate('4  the cell wins: 20 seats -> places 1..20', d20.dist.length === 20 && d21.dist.length === 21);
  gate('4  20.25 seats = 75% boards of 20 + 25% of 21, every place', d2025.dist.every((d, i) => close(d.p, mix[i], 1e-12)));

  // ---- 5 places by hand ------------------------------------------------------------------------------------
  const quant = (pcts, avg, n) => {      // restated: (0,0), the percentiles, the tail to where the mean = avg
    const pts = [[0, 0]]; pcts.forEach(p => { const l = pts[pts.length - 1]; if (p[0] > l[0] && p[1] > l[1]) pts.push(p); });
    let m = 0; for (let i = 1; i < pts.length; i++) m += (pts[i][1] - pts[i - 1][1]) * (pts[i][0] + pts[i - 1][0]) / 2;
    const z = pts[pts.length - 1]; if (z[1] < 1) pts.push([Math.max(z[0], 2 * (avg - m) / (1 - z[1]) - z[0]), 1]);
    const Q = u => { for (let j = 1; j < pts.length; j++) if (u <= pts[j][1]){ const a = pts[j - 1], b = pts[j]; return a[0] + (b[0] - a[0]) * (u - a[1]) / (b[1] - a[1]); } };
    return Array.from({ length: n }, (_, k) => Q((k + 0.5) / n));
  };
  const handScores = lbl => quant([['p25', .25], ['p50', .5], ['p75', .75], ['p90', .9], ['p95', .95], ['p98', .98]].map(([c, q]) => [raw(lbl, c), q]), raw(lbl, 'avg top score'), 100);
  const opp = []; let W = 0;
  segMembers_(ctx0.ds).forEach(s => ['NONPAYER', 'PAYER'].forEach(() => { const lbl = segLabel_(s, ctx0.ds), w = pooled(lbl); if (w > 0){ opp.push({ w, sc: handScores(lbl) }); W += w; } }));
  const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  const L = league - 1, nLo = Math.floor(L), nHi = Math.ceil(L), f = L - nLo, hand = Array(nHi + 1).fill(0);
  const mine = handScores(segLabel_(SEG, ctx0.ds));
  mine.forEach(s => {
    let B = 0; opp.forEach(o => { let g = 0; o.sc.forEach(y => { g += y > s ? 1 : (y === s ? 0.5 : 0); }); B += (o.w / W) * g / o.sc.length; });
    for (let k = 0; k <= nLo; k++) hand[k] += (1 - f) * choose(nLo, k) * Math.pow(B, k) * Math.pow(1 - B, nLo - k) / mine.length;
    for (let k = 0; k <= nHi; k++) hand[k] += f * choose(nHi, k) * Math.pow(B, k) * Math.pow(1 - B, nHi - k) / mine.length;
  });
  const eng = wagerRankDist_(MIC, SEG, PAY, x0, SH);
  const gap = Math.max(...hand.map((hh, i) => Math.abs(hh - eng.dist[i].p)));
  gate('5  places by hand = the engine, every place (' + SEG + ' ' + PAY + ')', gap < 1e-9 && eng.q === 1, 'worst gap ' + gap.toExponential(2));

  // ---- 6 participation ------------------------------------------------------------------------------------
  const lblS = segLabel_(SEG, ctx0.ds);
  gate('6  participation = the segment\'s measured share', wagerPart_(MIC, SEG, PAY, SH) === raw(lblS, 'participation'));
  const instRow = ctx0.ds.eventInst(MIC, SEG, PAY);
  gate('6  the pack lane reads the same participation', packParticipation_(MIC, wagerInstFor_(MIC, instRow, SEG, PAY, SH)) === raw(lblS, 'participation'));
  const pr = lab(WS.partLabel), pKeep = micV[pr][1];
  micV[pr][1] = 0.6; reset();
  gate('6  the override cell sets every cell (0.6)', cells.every(([s, p]) => wagerPart_(MIC, s, p, SH) === 0.6));
  micV[pr][1] = pKeep; reset();
  const kInst = ctx0.ds.eventInst('Kite Festival', SEG, PAY);
  gate("6  another source never takes the wager participation (the cell is attached for wager events only)",
    wagerInstFor_('Kite Festival', kInst, SEG, PAY, SH) === kInst);

  // ---- 7 the redesign row ---------------------------------------------------------------------------------
  const ctx = Context.get(), b = ctx.ds.beh(SEG, PAY), pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  const lad = lbLadder_(SH, LB_R_SPECS[MIC]), want = {}, part = wagerPart_(MIC, SEG, PAY, SH);
  insts.forEach(x => { const wd = wagerRankDist_(MIC, SEG, PAY, x, SH), q = reachOne_(x, pWd, pWe);
    wd.dist.forEach(d => { const rw = lad[d.rank] || {}; for (const r in rw) want[r] = (want[r] || 0) + part * q * d.p * rw[r]; }); });
  const got = resultRow_(MIC, SEG, PAY, ctx);
  const g7 = Math.max(...RESOURCES.filter(r => BOTTOMUP_RES.indexOf(r) < 0).map(r => Math.abs(num(got[r]) - num(want[r])) / Math.max(1e-6, Math.abs(num(want[r])))));
  gate('7  redesign = SUM_festivals E x participation x reach, by hand', g7 < 1e-9, 'worst rel gap ' + g7.toExponential(2));
  gate('7  TODAY = 0 on every cell (cal_curr runs none)', cells.every(([s, p]) => rowToArray_(measuredRow_(MIC, s, p, ctx.ds)).every(x => x === 0)));
  const curSave = clone(data['cal_curr']);
  data['cal_curr'] = clone(data['cal_new']); precompute();
  let diff0 = true;
  cells.forEach(([s, p]) => { const m = rowToArray_(measuredRow_(MIC, s, p, Context.get().ds)), r = rowToArray_(resultRow_(MIC, s, p, Context.get()));
    if (r.some((x, i) => !close(x, m[i], 1e-12)) || !m.some(x => x > 0)) diff0 = false; });
  gate('7  identical calendars -> DIFF 0 (and a non-zero TODAY), every cell', diff0);
  data['cal_curr'] = curSave; precompute();

  // ---- 8 the local sim -----------------------------------------------------------------------------------
  const iv = data['item_vals'].values, price = {};
  (iv[1] || []).forEach((n, c) => { const nm = String(n || '').trim(); if (!nm) return;
    price[nm === 'ToF_Value' ? 'ToF_Ticket' : (RES_MAP[nm] || nm)] = Number(iv[2][c]) || 0; });
  const ls = ECOGAINS_MIC(PAY, 0), lh = ls[0], row = ls.find(r => segCanon_(String(r[0])) === segCanon_(SEG));
  const dur = Math.round(num(readSPLabel_(SH, 'EventDuration'))) || 2;
  let st = 1; for (let d = 1; d <= 14; d++){ let ok = true; for (let j = 0; j < dur; j++) if (isWeekend_(d + j)) ok = false; if (ok){ st = d; break; } }
  const we = wagerE_(MIC, SEG, PAY, mkInst_(st, dur), SH).e;
  const val = RESOURCES.reduce((a, r) => a + num(we[r]) * num(price[r]), 0);
  gate('8  local sim: value per festival entered = SUM e x item_vals row 3', close(row[lh.indexOf('Value per festival entered (item_vals)')], val, 1e-12), val.toFixed(2));
  gate('8  local sim: value per player online = value x participation', close(row[lh.indexOf('Value per player online (x Participation)')], val * part, 1e-12));
  gate('8  local sim: coins / SPT = the engine', close(row[lh.indexOf('Coins per festival entered')], num(we.HC), 1e-12) && close(row[lh.indexOf('SPT per festival entered')], num(we.SPT), 1e-12));
  gate('8  local sim: one row per segment + ALL, 13 columns', ls.length === 1 + segMembers_(ctx.ds).length + 1 && lh.length === 13);
  // an envelope priced: 2 x 1-star on place 1 -> the value moves by exactly P(place 1) x 2 x the 1-star price
  const eCol = micV[8].indexOf('1-star Dly'), eKeep = micV[9][eCol];
  micV[9][eCol] = 2; reset();
  const row2 = ECOGAINS_MIC(PAY, 1).find(r => segCanon_(String(r[0])) === segCanon_(SEG)), p1 = wagerRankDist_(MIC, SEG, PAY, mkInst_(st, dur), SH).dist[0].p;
  micV[9][eCol] = eKeep; reset();
  gate('8  an envelope on place 1 is valued at P(place 1) x 2 x the 1-star price',
    close(row2[lh.indexOf('Value per festival entered (item_vals)')] - val, p1 * 2 * price['1-star Pack'], 1e-9));

  // ---- 9 the other layouts ---------------------------------------------------------------------------------
  const v3u = JSON.parse(fs.readFileSync(path.join(__dirname, '_mockdata_v3u.json'), 'utf8'));
  const newSheet = data[SH];
  data[SH] = v3u[SH]; reset(); precompute();
  const tOld = wagerTable_(SH, WS), lsOld = ECOGAINS_MIC(PAY, 2);
  gate('9  the D104 layout (streak table) still reads the streak model', !!tOld && tOld.mode === 'streak' && lsOld[0].indexOf('Chance to reach Submit after') >= 0);
  data[SH] = newSheet; reset(); precompute();
  // no numbers anywhere (formulas offline AND no data_mic): the cells have no scores -> D102's borrowed places
  const dmSave = data['data_mic'];
  delete data['data_mic']; reset(); precompute();
  const noData = cells.map(([s, p]) => rowToArray_(resultRow_(MIC, s, p, Context.get())));
  WAGER_BOTTOMUP = false; reset(); precompute();
  const d102 = cells.map(([s, p]) => rowToArray_(resultRow_(MIC, s, p, Context.get())));
  WAGER_BOTTOMUP = true; data['data_mic'] = dmSave; reset(); precompute();
  gate('9  no data_mic and no typed numbers -> the D102 pricing exactly', same(noData, d102));

  say('\n     cell              part   p50 top   place p50  coins/window  SPT/window  value/window');
  cells.forEach(([s, p]) => { const r = resultRow_(MIC, s, p, Context.get()), c = wagerCell_(MIC, s, p, SH), d = wagerRankDist_(MIC, s, p, insts[0], SH);
    let cum = 0, p50 = '-'; d.dist.forEach(x => { cum += x.p; if (p50 === '-' && cum >= 0.5) p50 = x.rank; });
    say('     ' + (s + ' ' + p).padEnd(17) + (100 * c.part).toFixed(0).padStart(4) + '%' + String(c.p50).padStart(9) + String(p50).padStart(11) +
        num(r.HC).toFixed(1).padStart(14) + num(r.SPT).toFixed(1).padStart(12) + RESOURCES.reduce((a, q) => a + num(r[q]) * num(price[q]), 0).toFixed(1).padStart(14)); });
  say('\n' + pass + ' pass, ' + fail + ' fail');
  if (fail) process.exitCode = 1;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
