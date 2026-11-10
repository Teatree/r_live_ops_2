// D100 gates: Kite opt-in and join days measured off the join grant (kite_joiners).
//   node harness/_mock_kite_join.js [--data v3t | <dump.json>] [--seg 40-99 --payer PAYER]
// Builds the kite_joiners table from the dump's own by-source feed (as Compute export scale does),
// then asserts the RULES with fixtures - never the dump's numbers:
//   1  the table: one row per cell, shares sum to 1, opt_in_active = opt_in / reach_measured
//   2  a festival of the measured length (or longer, or cut by the window) keeps the plain reach
//   3  a shorter festival = reach(L0 from the same start) x (K + SHIFT x (1 - K)), by hand
//   4  weekend adjustment: the same festival on a weekend reads the weekend activity (pWe != pWd)
//   5  opt-in: the pack lane reads opt_in_active; a 'Participation' label on Ki_v2 still wins
//   6  a cell with too few joiners reads its parent's row
//   7  identical calendars -> Kite DIFF 0 on every cell (table on)
//   8  no table / KITE_JOIN = false -> every Kite row bit-identical to D99 (table absent)
//   9  every NON-Kite row is identical with and without the table, on every cell
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3t');
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
  const KC = 'Kite Festival';

  // the export scale table, as the menu run writes it (the change summary does the same)
  const eg = exportScaleGrid_(Context.get());
  if (eg){ data['export_scale'] = { values: eg, merges: [] }; reset(); }
  const ctx0 = Context.get(), cells = [];
  segMembers_(ctx0.ds).concat(ctx0.ds.segs().indexOf('ALL') >= 0 ? ['ALL'] : []).forEach(s =>
    ['NONPAYER', 'PAYER'].forEach(p => cells.push([s, p])));
  const snapshot = () => { const o = {}; cells.forEach(c => CATEGORY_ORDER.forEach(cat => {
    o[c.join('|') + '|' + cat] = rowToArray_(resultRow_(cat, c[0], c[1], Context.get())).concat(
      rowToArray_(measuredRow_(cat, c[0], c[1], Context.get().ds))); })); return o; };

  // ---- 8/9 baseline: no table
  delete data[KITE_JOIN_SHEET]; reset();
  const before = snapshot();

  // ---- 1 the table
  const grid = kiteJoinGrid_(Context.get());
  gate('1  table built from the feed', !!grid, grid ? grid[1].join(' ') : kiteJoinGrid_.why);
  if (!grid){ say('\n' + pass + ' pass, ' + fail + ' fail'); process.exitCode = 1; return; }
  data[KITE_JOIN_SHEET] = { values: grid, merges: [] }; reset();
  const tab = kiteJoinTab_(), L0 = tab.L0, hdr = grid[3], ix = n => hdr.indexOf(n);
  let sharesOk = true, actOk = true;
  grid.slice(4).forEach(r => {
    let s = 0, u = 0; for (let j = 1; j <= L0; j++){ s += r[ix('s' + j)]; u += r[ix('u' + j)]; }
    if (r[ix('joiners_per_instance')] > 0 && (!close(s, 1, 1e-4) || !close(u, 1, 1e-4))) sharesOk = false;
    if (r[ix('reach_measured')] > 0 && !close(r[ix('opt_in_active')], Math.min(1, r[ix('opt_in')] / r[ix('reach_measured')]), 1e-4)) actOk = false;
  });
  gate('1  join shares and weights sum to 1 in every cell', sharesOk);
  gate('1  opt_in_active = opt_in / reach_measured', actOk);
  say('     cell             opt-in  active  day shares');
  grid.slice(4).forEach(r => say('     ' + (r[0] + ' ' + r[1]).padEnd(17) + (100 * r[ix('opt_in')]).toFixed(1).padStart(5) + '%  ' +
    (100 * r[ix('opt_in_active')]).toFixed(1).padStart(5) + '%  ' +
    Array.from({ length: L0 }, (_, j) => (100 * r[ix('s' + (j + 1))]).toFixed(0) + '%').join(' / ') + '   ' + r[r.length - 1]));

  // ---- 2/3/4 the reach rule on one cell
  const J = kiteJoin_(SEG, PAY), b = Context.get().ds.beh(SEG, PAY);
  const pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  const day = (wk) => { for (let d = 1; d <= 28; d++) if (isWeekend_(d) === wk && isWeekend_(d + L0 - 1) === wk) return d; return 1; };
  // a festival whose days are ALL one type re-weights nothing (the activity ratio cancels); the
  // adjustment shows on a MIXED one - a weekend start whose L0-day reference runs into the week
  const mixed = () => { for (let d = 1; d <= 28; d++) if (isWeekend_(d) && !isWeekend_(d + L0 - 1)) return d; return 1; };
  const wdS = day(false), weS = mixed();
  const full = mkInst_(wdS, L0);
  gate('2  a festival of the measured length keeps the plain reach', laneReach_(KC, full, pWd, pWe, SEG, PAY) === reachOne_(full, pWd, pWe));
  const longer = mkInst_(wdS, L0 + 1);
  gate('2  a longer festival keeps the plain reach', laneReach_(KC, longer, pWd, pWe, SEG, PAY) === reachOne_(longer, pWd, pWe));
  const cut = mkInst_(1, L0 - 1); cut.clipStart = 1; cut.fullDur = L0;
  gate('2  a festival cut by the window keeps the plain reach', laneReach_(KC, cut, pWd, pWe, SEG, PAY) === reachOne_(cut, pWd, pWe));
  gate('2  other lanes are untouched', laneReach_('Target Day', mkInst_(wdS, 1), pWd, pWe, SEG, PAY) === reachOne_(mkInst_(wdS, 1), pWd, pWe));
  const hand = (start, dur) => { let all = 0, kept = 0;
    for (let i = 0; i < L0; i++){ const w = J.u[i] * (isWeekend_(start + i) ? pWe : pWd); all += w; if (i < dur) kept += w; }
    const K = kept / all; return { v: reachOne_(mkInst_(start, L0), pWd, pWe) * (K + KITE_JOIN_SHIFT * (1 - K)), K: K }; };
  const short = mkInst_(wdS, L0 - 1), h3 = hand(wdS, L0 - 1);
  gate('3  a shorter weekday festival = reach(L0) x (K + 0.5 (1 - K))', close(laneReach_(KC, short, pWd, pWe, SEG, PAY), h3.v),
       'K ' + h3.K.toFixed(3) + '  keeps ' + (100 * laneReach_(KC, short, pWd, pWe, SEG, PAY) / reachOne_(mkInst_(wdS, L0), pWd, pWe)).toFixed(1) +
       '% of a ' + L0 + '-day festival (plain reach said ' + (100 * reachOne_(short, pWd, pWe) / reachOne_(mkInst_(wdS, L0), pWd, pWe)).toFixed(1) + '%)');
  const wshort = mkInst_(weS, L0 - 1), h4 = hand(weS, L0 - 1);
  gate('4  a shorter weekend festival reads weekend activity', close(laneReach_(KC, wshort, pWd, pWe, SEG, PAY), h4.v) &&
       (pWd === pWe || !close(h4.v, reachOne_(mkInst_(weS, L0), pWd, pWe) * (h3.K + 0.5 * (1 - h3.K)), 1e-12)),
       'start day ' + weS + '  K ' + h4.K.toFixed(3));
  // pWe moved alone must move the weekend festival and leave the weekday one
  const bump = laneReach_(KC, wshort, pWd, pWe * 1.2, SEG, PAY), keepWd = laneReach_(KC, short, pWd, pWe * 1.2, SEG, PAY);
  gate('4  weekend activity moves the weekend festival only', !close(bump, laneReach_(KC, wshort, pWd, pWe, SEG, PAY), 1e-9) &&
       close(keepWd, laneReach_(KC, short, pWd, pWe, SEG, PAY), 1e-12));

  // ---- 5 opt-in
  const inst = Context.get().ds.eventInst('Kite Festival', SEG, PAY);
  gate('5  the pack lane reads the measured opt-in', close(packParticipation_(KC, inst), J.optinActive), packParticipation_(KC, inst).toFixed(4) + ' (was ' + PACK_PARTICIPATION[KC] + ')');
  const ki = data['Ki_v2'].values, saved = JSON.stringify(ki);
  ki[1] = (ki[1] || []).slice(); while (ki[1].length < 30) ki[1].push(''); ki[1][27] = 'Participation'; ki[1][28] = 0.123; reset();
  gate('5  a Participation label on Ki_v2 still wins', close(packParticipation_(KC, Context.get().ds.eventInst('Kite Festival', SEG, PAY)), 0.123));
  data['Ki_v2'].values = JSON.parse(saved); reset();

  // ---- 6 parent
  const tg = JSON.parse(JSON.stringify(grid)), pr = tg.slice(4).find(r => segCanon_(r[0]) === '100-249' && r[1] === PAY);
  const ch = tg.slice(4).find(r => segCanon_(r[0]) === '250+' && r[1] === PAY);
  if (pr && ch){
    ch[ix('joiners_per_instance')] = KITE_JOIN_MIN - 1; ch[ix('opt_in_active')] = 0.999;
    data[KITE_JOIN_SHEET] = { values: tg, merges: [] }; reset();
    gate('6  a cell under ' + KITE_JOIN_MIN + ' joiners reads its parent', close(kiteJoin_('250+', PAY).optinActive, pr[ix('opt_in_active')]));
    ch[ix('joiners_per_instance')] = KITE_JOIN_MIN; reset();
    gate('6  ...and its own row from ' + KITE_JOIN_MIN + ' joiners', close(kiteJoin_('250+', PAY).optinActive, 0.999));
    data[KITE_JOIN_SHEET] = { values: grid, merges: [] }; reset();
  } else say('SKIP 6  no 100-249 / 250+ rows in this pull');

  // ---- 9 non-Kite rows identical, table on vs off
  const after = snapshot();
  // the card sim's two rows open Kite envelopes, whose count follows the measured opt-in - they are
  // expected to move and are reported, not gated
  const CARD = { 'Col - Sets': 1, 'Col - Albums': 1 };
  let moved = [], kiteMoved = 0, cardMoved = 0;
  Object.keys(before).forEach(k => {
    const same = before[k].every((x, i) => x === after[k][i]);
    if (same) return;
    const cat = k.split('|')[2];
    if (cat === KC) kiteMoved++; else if (CARD[cat]) cardMoved++; else moved.push(k);
  });
  gate('9  every row but Kite and the card sim is identical with and without the table', !moved.length, moved.slice(0, 6).join(', '));
  say('     Kite rows that moved: ' + kiteMoved + ' of ' + cells.length + ' cells; card-sim rows (Kite envelopes opened): ' + cardMoved);

  // ---- 8 flag off == no table
  KITE_JOIN = false; reset();
  const off = snapshot(); KITE_JOIN = true; reset();
  gate('8  KITE_JOIN = false restores D99 bit for bit', Object.keys(before).every(k => before[k].every((x, i) => x === off[k][i])));

  // ---- 7 identical calendars
  const savedNew = data['cal_new'], savedParsed = data['cal_parsed'];
  data['cal_new'] = JSON.parse(JSON.stringify(data['cal_curr']));
  if (savedParsed){ const pv = JSON.parse(JSON.stringify(savedParsed));
    pv.values = pv.values.filter((r, i) => i === 0 || r[0] !== 'cal_new').concat(
      pv.values.filter((r, i) => i > 0 && r[0] === 'cal_curr').map(r => ['cal_new'].concat(r.slice(1))));
    data['cal_parsed'] = pv; }
  // a calendar of measured-length festivals: the table must not move the Kite DIFF at all (a _v2 ladder
  // edit can make the DIFF itself non-zero - that is the config, not D100)
  const diffs = () => { reset(); const o = {}; cells.forEach(c => {
    const res = resultRow_(KC, c[0], c[1], Context.get()), m = measuredRow_(KC, c[0], c[1], Context.get().ds);
    o[c.join('|')] = RESOURCES.map(r => num(res[r]) - num(m[r])); }); return o; };
  const dOn = diffs(); delete data[KITE_JOIN_SHEET]; const dOff = diffs(); data[KITE_JOIN_SHEET] = { values: grid, merges: [] };
  let worst = 0, level = 0;
  Object.keys(dOn).forEach(k => dOn[k].forEach((x, i) => { worst = Math.max(worst, Math.abs(x - dOff[k][i])); level = Math.max(level, Math.abs(x)); }));
  gate('7  identical calendars -> the table moves no Kite DIFF', worst < 1e-9 * Math.max(1, level),
       'max |DIFF on - DIFF off| ' + worst.toExponential(2) + '  (max |DIFF| ' + level.toFixed(3) + ' = the config edits)');
  data['cal_new'] = savedNew; if (savedParsed) data['cal_parsed'] = savedParsed; reset();

  say('\n' + pass + ' pass, ' + fail + ' fail');
  if (fail) process.exitCode = 1;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
