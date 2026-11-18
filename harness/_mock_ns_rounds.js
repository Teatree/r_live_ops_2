// D106 gates: Night Sky with any number of rounds per segment, priced on the pull's own round data.
//   node harness/_mock_ns_rounds.js [--data v3x | <dump.json>]
// v3x = 'LIVE_OPS_V3 - NS_test': NS_v2 (weekend) with 7 rounds at 40-99 and 10 at 100+. Every gate
// asserts a RULE with a fixture built here (snapshot -> mutate -> assert -> restore), never the dump's
// numbers. The data_ns_* sheets are SYNTHETIC (the pull of PROMPT_ns_rounds_progress.md has not landed):
// a geometric progress curve per cell and day type, measured claims = 0.9 x the curve at each base round.
//   A  structure (no data sheets): every round of every block is read; a block may grow or shrink and only
//      its own segment moves, by measured x dE_v2 / E_base x T; the daily view sums to the window row;
//      a missing spacer row never turns a segment label into a round
//   B  the ladder audit names exactly the rounds whose Cum Streak Req is not the running sum of Streak Req
//   C  the data path: an old-schema data_ns_rounds is ignored; identical configs -> DIFF 0; base round =
//      its measured claim rate (by day type); a changed requirement = m x S(new) / S(old); a new round =
//      S(req); past the last point the slope is extended (and noted); censored_at; config_segment pick;
//      250+ reads its parent; day-typed data on ONE ladder splits the daily view by day type; card-sim
//      rungs and the play-by-play view read the same chances; NS_ROUND_DATA = false = no data
//   D  V2Diff compares segment blocks of different lengths block by block
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3x');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
let PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
// --engine-dir <dir>: run the gates on another copy of the engine (used to check each gate FAILS on broken code)
const di = process.argv.indexOf('--engine-dir');
if (di >= 0){
  const ed = path.resolve(process.argv[di + 1]);
  PRELUDE = PRELUDE.replace("const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);", 'const ENGINE = (f) => path.join(' + JSON.stringify(ed) + ', f);');
  if (PRELUDE.indexOf(JSON.stringify(ed)) < 0) throw new Error('_mock_cards.js ENGINE line moved - fix the harness');
}
const _log = console.log; global.__say = _log; console.log = () => {};

function GATES(){
  const say = global.__say;
  let pass = 0, fail = 0;
  const gate = (name, ok, detail) => { ok ? pass++ : fail++; say((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };
  const close = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-9) * Math.max(1, Math.abs(b));
  const fresh = () => { resetSheetCache_mock(); _sheetValsCache = {}; Context.reset(); return Context.get(); };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const CAT = 'Daily Night Sky Prize';
  eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('V2Diff.gs'), 'utf8'));
  const NSS = ['NS', 'NS_weekday', 'NS_v2', 'NS_v2_weekday', 'data_ns_rounds', 'data_ns_progress', 'data_ns_per_day_reach', 'data_ns_streak_dist'];
  const snapAll = () => { const o = {}; NSS.forEach(n => { o[n] = data[n] ? JSON.stringify(data[n]) : null; }); return o; };
  const restore = (o) => { NSS.forEach(n => { if (o[n] == null) delete data[n]; else data[n] = JSON.parse(o[n]); }); fresh(); };
  const SNAP0 = snapAll();
  let ctx = fresh();
  const cells = []; segMembers_(ctx.ds).forEach(s => ['NONPAYER', 'PAYER'].forEach(p => cells.push([s, p])));
  const rowsOf = () => { const c = fresh(), o = {}; cells.forEach(([s, p]) => { o[s + '|' + p] = resultRow_(CAT, s, p, c); }); return o; };
  const sameRow = (a, b) => RESOURCES.every(r => Math.abs(num(a[r]) - num(b[r])) <= 1e-9 * Math.max(1, Math.abs(num(b[r]))));
  // a segment's block on a sheet: { label row index, header row index, round rows [index] }
  const block = (nm, label) => {
    const v = data[nm].values;
    const lr = v.findIndex(r => String(r[0]).trim() === label);
    if (lr < 0) return null;
    // as the engine reads it (D107b): rounds from the first numbered row within 3 rows of the label; the header is the
    // block's own row between the two, else the sheet's FIRST one (hr < lr then - a v2 sheet may keep only 0-9's)
    const isRd = (x) => /^\s*\d+(\.\d+)?\s*$/.test(String(x));
    let g0 = lr + 1; while (g0 < v.length && g0 <= lr + 3 && !isRd(v[g0][0])) g0++;
    const hasH = (row) => (row || []).some(x => String(x).trim() === 'Cum Streak Req');
    let hr = -1; for (let q = lr + 1; q < g0; q++) if (hasH(v[q])){ hr = q; break; }
    if (hr < 0) hr = v.findIndex(hasH);
    const rows = []; for (let r = g0; r < v.length && isRd(v[r][0]); r++) rows.push(r);
    return { lr, hr, g0, rows, col: (h) => v[hr].findIndex(x => String(x).trim() === h) };
  };
  // NS_v2 := NS, NS_v2_weekday := NS_weekday (or NS): a redesign identical to the base
  const identicalConfigs = () => {
    data['NS_v2'] = clone(data['NS']);
    data['NS_v2_weekday'] = clone(data['NS_weekday'] || data['NS']);
  };

  say('data: ' + (data._meta ? data._meta.source : '?') + '   engine ' + ENGINE_BUILD);
  // ================================================================ A. STRUCTURE (no data sheets)
  say('\n================ A. ANY NUMBER OF ROUNDS PER SEGMENT (no data_ns_* sheets) ================');
  delete data['data_ns_rounds']; delete data['data_ns_progress']; delete data['data_ns_per_day_reach']; delete data['data_ns_streak_dist'];
  ctx = fresh();
  {
    // every numbered row of every block is a round
    let ok = true, det = [];
    ['NS', 'NS_v2', 'NS_v2_weekday', 'NS_weekday'].forEach(nm => {
      if (!data[nm]) return;
      ['0-9', '10-19', '20-39', '40-99', '100+'].forEach(lab => {
        const b = block(nm, lab); if (!b) return;
        const seg = segCanon_(lab), got = nsLadderOn_(nm, seg).length;
        if (got !== b.rows.length){ ok = false; det.push(nm + ' ' + lab + ' ' + got + '/' + b.rows.length); }
        else if (nm === 'NS_v2') det.push(lab + ' ' + got);
      });
    });
    gate('A1: every numbered row under a block\'s header is a round (any count per segment)', ok, 'NS_v2: ' + det.join(', '));
  }
  {
    // a missing spacer row: the next segment's label ('100+' parses as 100) is never read as a round
    const snap = snapAll(), v = data['NS_v2'].values;
    const b = block('NS_v2', '40-99'), lr100 = v.findIndex(r => String(r[0]).trim() === '100+');
    const before = nsLadderOn_('NS_v2', '40-99').length;
    if (lr100 > 0 && !v[lr100 - 1].some(x => String(x).trim() !== '')) v.splice(lr100 - 1, 1);
    fresh();
    const after = nsLadderOn_('NS_v2', '40-99').length, n100 = nsLadderOn_('NS_v2', '100-249').length;
    restore(snap);
    gate('A2: with the blank row before \'100+\' deleted, 40-99 keeps its rounds and the label is not a round', after === before && after === b.rows.length && n100 > 0,
      '40-99 ' + before + ' -> ' + after + ', 100+ ' + n100);
  }
  {
    // A2b (D107b): blocks whose header row was CLEARED (the 2026-11-18 workbook: only 0-9 kept one) read with the
    // sheet's first header - same ladders, no fallback to NS, and the audit still walks them
    // Fixture in both directions, whatever the dump holds: WITH = every block after 0-9 carries its own header (the
    // first header written into the row between label and rounds), WITHOUT = those rows cleared
    const snap = snapAll(), labs = ['0-9', '10-19', '20-39', '40-99', '100+'];
    const setHeaders = (on) => {
      const v = data['NS_v2'].values, h0 = v.find(r => (r || []).some(x => String(x).trim() === 'Cum Streak Req'));
      let n = 0;
      labs.slice(1).forEach(l => { const b = block('NS_v2', l); if (!b || b.g0 - b.lr < 2) return;
        v[b.g0 - 1] = on ? h0.slice() : v[b.g0 - 1].map(() => ''); n++; });
      fresh(); return n;
    };
    const read = () => ({ lad: labs.map(l => JSON.stringify(nsLadderOn_('NS_v2', segCanon_(l)))),
                          audit: nsLadderAudit_().filter(x => /^NS_v2 /.test(x)).length });
    const nOn = setHeaders(true), A = read();
    const nOff = setHeaders(false), B = read();
    restore(snap);
    gate('A2b: blocks whose repeated header row is cleared (' + nOff + ' of them) read the same ladders off the first header as with every header written, and the audit still walks them',
      nOn > 0 && nOn === nOff && A.lad.every((x, i) => x === B.lad[i] && x !== '[]') && A.audit === B.audit, 'audit ' + A.audit + ' / ' + B.audit + ' rounds flagged');
  }
  const R0 = rowsOf();
  // add a round to one segment's weekend block: only that segment moves, by measured x dE / E_base x T
  const addRound = (lab, req, hc) => {
    const v = data['NS_v2'].values, b = block('NS_v2', lab), last = b.rows[b.rows.length - 1];
    const nr = clone(v[last]); nr[0] = Number(v[last][0]) + 1;
    for (let c = 1; c < nr.length; c++) if (typeof nr[c] === 'number' && c !== b.col('Milestone')) nr[c] = 0;
    nr[b.col('Cum Streak Req')] = req; nr[b.col('Streak Req')] = req - num(v[last][b.col('Cum Streak Req')]); nr[b.col('HC Reward')] = hc;
    v.splice(last + 1, 0, nr);
  };
  const ruleCheck = (lab, mutate, name) => {
    const snap = snapAll();
    const seg = segCanon_(lab), c0 = fresh();
    const E0 = {}, meas = {}, T = {};
    ['NONPAYER', 'PAYER'].forEach(p => {
      E0[p] = nsE_(seg, p, c0.ds, c0); meas[p] = measuredRow_(CAT, seg, p, c0.ds);
      T[p] = timingRatio_(c0.calCur['Night Sky'] || [], c0.calNew['Night Sky'] || [], seg, p, c0.ds);
    });
    mutate();
    const c1 = fresh(), R1 = rowsOf(), c2 = fresh();
    let worst = 0, others = 0, n = 0;
    ['NONPAYER', 'PAYER'].forEach(p => {
      const E1 = nsE_(seg, p, c2.ds, c2), sim = R1[seg + '|' + p], sim0 = R0[seg + '|' + p];
      const eb = num(E0[p].eBase.HC);
      if (!(eb > 0) || !(num(meas[p].HC) > 0)) return;
      const want = num(meas[p].HC) * (num(E1.eV2.HC) - num(E0[p].eV2.HC)) / eb * T[p];
      worst = Math.max(worst, Math.abs((num(sim.HC) - num(sim0.HC)) - want) / Math.max(1, Math.abs(want)));
      n++;
    });
    cells.forEach(([s, p]) => { if (segCanon_(s) !== seg && !segIsAll_(s) && SEG_PARENT[segCanon_(s)] !== seg && !sameRow(R1[s + '|' + p], R0[s + '|' + p])) others++; });
    restore(snap);
    gate(name, n > 0 && worst < 1e-9 && others === 0, n + ' payer cells, worst rel err ' + worst.toExponential(2) + ', other segments moved: ' + others);
  };
  ruleCheck('20-39', () => addRound('20-39', 30, 120),
    'A3: a round ADDED to 20-39 on NS_v2 moves 20-39 HC by measured x dE_v2 / E_base x T, and no other segment');
  ruleCheck('10-19', () => { const b = block('NS_v2', '10-19'); data['NS_v2'].values.splice(b.rows[b.rows.length - 1], 1); },
    'A4: a round REMOVED from 10-19 on NS_v2 moves 10-19 HC by measured x dE_v2 / E_base x T, and no other segment');
  {
    // the daily view and the 7-day view are built on the same row: per cell the 28 days sum to the window row
    const c = fresh(); let worst = 0;
    cells.forEach(([s, p]) => {
      const W = resultRow_(CAT, s, p, c), d = dailySeries_(CAT, s, p, c, true);
      RESOURCES.forEach(r => { const sum = d.reduce((a, x) => a + num(x && x[r]), 0);
        worst = Math.max(worst, Math.abs(sum - num(W[r])) / Math.max(1, Math.abs(num(W[r])))); });
    });
    gate('A5: the daily view sums to the window row on every cell (NEW side, longer blocks included)', worst < 1e-9, 'worst ' + worst.toExponential(2));
  }

  // ================================================================ B. THE LADDER AUDIT
  say('\n================ B. Cum Streak Req vs Streak Req (read as typed, named where they disagree) ================');
  {
    const snap = snapAll();
    data['NS_v2'] = clone(data['NS']); fresh();
    const clean = nsLadderAudit_().filter(x => /^NS_v2 /.test(x));
    const b = block('NS_v2', '20-39'), r2 = b.rows[1];
    data['NS_v2'].values[r2][b.col('Cum Streak Req')] = 99; fresh();
    const bad = nsLadderAudit_().filter(x => /^NS_v2 /.test(x));
    restore(snap);
    gate('B1: a ladder whose Cum is the running sum of Streak Req is not flagged; one edited Cum is (and the round after it)',
      clean.length === 0 && bad.length === 2 && /20-39 round 2/.test(bad[0]) && /20-39 round 3/.test(bad[1]), bad.join(' | '));
    const draft = nsLadderAudit_().filter(x => /^NS_v2 /.test(x));
    say('   the dump\'s NS_v2 (' + draft.length + ' rounds flagged):\n     ' + draft.join('\n     '));
    gate('B2: the audit reaches the change summary\'s note row and the fill\'s pop-up (nsNotes_ carries it)',
      nsNotes_().length >= draft.length);
  }

  // ================================================================ C. THE DATA PATH
  say('\n================ C. MEASURED CLAIMS + THE PROGRESS CURVE (synthetic data_ns_* sheets) ================');
  // the synthetic pull: share_ge(x) = A exp(-x / mu), mu per cell and day type; claims = 0.9 x the curve
  const XS = [2, 5, 10, 20, 40, 60, 100, 150, 200, 300, 400, 500], QS = [10, 25, 50, 75, 90, 95, 99], A = 0.85;
  const muOf = (s, p, dt) => {
    const st = ctx.ds.nsStreak(s, p) || {};
    return Math.max(2, num(st.max_streak_per_day_p50) * 1.5) * (dt === 'weekend' ? 1.2 : dt === 'weekday' ? 0.9 : 1);
  };
  const shareGe = (x, mu) => A * Math.exp(-x / mu);
  const cfgLab = (s) => (segCanon_(s) === '100-249') ? '100+' : segCanon_(s);
  const ownCells = cells.filter(([s]) => segCanon_(s) !== '250+');
  const progressSheet = (opts) => {
    opts = opts || {};
    const hdr = ['ab_variant', 'segment', 'payer_flag', 'config_segment', 'day_type', 'player_days', 'share_zero']
      .concat(XS.map(x => 'share_ge_' + x)).concat(QS.map(q => 'progress_p' + q)).concat(opts.cens ? ['censored_at'] : []);
    const rows = [hdr];
    (opts.cells || ownCells).forEach(([s, p]) => ['all', 'weekday', 'weekend'].forEach(dt => {
      if (opts.noDayType && dt !== 'all') return;
      const mu = muOf(s, p, opts.noDayType ? 'all' : dt);
      rows.push(['Variant A', segLabel_(s), p, opts.cfg || cfgLab(s), dt, 1000, 1 - A]
        .concat(XS.map(x => shareGe(x, mu))).concat(QS.map(q => (1 - q / 100) < A ? -mu * Math.log((1 - q / 100) / A) : 0))
        .concat(opts.cens ? [opts.cens] : []));
    }));
    return { values: rows, merges: [] };
  };
  const roundsSheet = (opts) => {
    opts = opts || {};
    const hdr = ['ab_variant', 'segment', 'payer_flag', 'config_segment', 'round', 'cum_streak_req', 'hc_reward', 'ladder_version',
                 'player_days', 'players', 'claims_total', 'claim_rate_per_player_day', 'hc_granted_total', 'hc_per_claim',
                 'claims_weekday', 'claims_weekend', 'player_days_weekday', 'player_days_weekend'];
    const rows = [hdr];
    (opts.cells || ownCells).forEach(([s, p]) => {
      const base = nsLadderOn_('NS', segCanon_(s));
      base.forEach((ms, k) => {
        const f = opts.factor || 0.9;
        const all = f * shareGe(ms.req, muOf(s, p, 'all')), wd = f * shareGe(ms.req, muOf(s, p, 'weekday')), we = f * shareGe(ms.req, muOf(s, p, 'weekend'));
        rows.push(['Variant A', segLabel_(s), p, opts.cfg || cfgLab(s), k + 1, ms.req, num(ms.rew.HC), 'v1',
                   10000, 3000, all * 10000, all, 0, num(ms.rew.HC), wd * 6000, we * 4000, 6000, 4000]);
      });
    });
    return { values: rows, merges: [] };
  };
  // the hand curve: linear between (0,1), (1, 1 - share_zero), the share_ge points, then the percentiles past
  // the last X; past the last point exp-extended off the last two points
  const handS = (mu, x) => {
    const pts = [[0, 1], [1, A]].concat(XS.map(X => [X, shareGe(X, mu)]));
    QS.forEach(q => { const px = (1 - q / 100) < A ? -mu * Math.log((1 - q / 100) / A) : 0;
      if (px > 500 && (1 - q / 100) < shareGe(500, mu)) pts.push([px, 1 - q / 100]); });
    pts.sort((a, b) => a[0] - b[0]);
    if (x <= 0) return 1;
    for (let j = 1; j < pts.length; j++) if (x <= pts[j][0]) { const a = pts[j - 1], b = pts[j]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    const l = pts[pts.length - 1], pr = pts[pts.length - 2], lam = Math.log(pr[1] / l[1]) / (l[0] - pr[0]);
    return l[1] * Math.exp(-lam * (x - l[0]));
  };
  {
    // C1: the old-schema data_ns_rounds (cum_streak_req empty) is not read
    const snap = snapAll();
    const old = [['segment', 'payer_flag', 'round', 'claims_total', 'player_days', 'cum_streak_req', 'claim_rate_per_player_day']];
    ownCells.forEach(([s, p]) => [1, 2, 3].forEach(k => old.push([segLabel_(s), p, k, 50, 1000, '', 0.05])));
    data['data_ns_rounds'] = { values: old, merges: [] };
    const R1 = rowsOf(), noted = nsNotes_().some(x => /no cum_streak_req/.test(x));
    restore(snap);
    gate('C1: a data_ns_rounds with no cum_streak_req (the pull attributed by coin amount) is not read - every NS row as with no sheet',
      cells.every(([s, p]) => sameRow(R1[s + '|' + p], R0[s + '|' + p])) && noted);
  }
  data['data_ns_progress'] = progressSheet(); data['data_ns_rounds'] = roundsSheet();
  const SNAPD = snapAll();
  ctx = fresh();
  {
    // C2: identical configs -> DIFF 0 on every cell and resource (the pull on both sides)
    const snap = snapAll();
    identicalConfigs();
    const c = fresh(); let bad = 0;
    cells.forEach(([s, p]) => { if (!sameRow(resultRow_(CAT, s, p, c), measuredRow_(CAT, s, p, c.ds))) bad++; });
    const E = nsE_('40-99', 'PAYER', c.ds, c);
    restore(snap);
    gate('C2: with the pull read, NS_v2 == NS and NS_v2_weekday == NS_weekday give a Night Sky DIFF of 0 on every cell',
      bad === 0 && E && E.source === 'progress', bad + ' cells differ; source ' + (E && E.source));
  }
  const SEG = '40-99', PAY = 'NONPAYER';
  {
    // C3: the base side = the measured claim rate of each round for the day type
    const E = nsE_(SEG, PAY, ctx.ds, ctx), L = E.ladders;
    const want = (dt) => L.bWe.map(ms => 0.9 * shareGe(ms.req, muOf(SEG, PAY, dt)));
    const okWe = L.pbWe.every((p, k) => close(p, want('weekend')[k], 1e-12));
    const okWd = L.pbWd.every((p, k) => close(p, 0.9 * shareGe(L.bWd[k].req, muOf(SEG, PAY, 'weekday')), 1e-12));
    gate('C3: a base round is priced at its measured claim rate, weekend rows on weekends and weekday rows on weekdays',
      okWe && okWd && E.dayTyped, L.pbWe.map(x => x.toFixed(4)).join(' ') + ' | ' + L.pbWd.map(x => x.toFixed(4)).join(' '));
  }
  {
    // C4: changed requirement = m x S(new) / S(old); unchanged = m; a NEW round = S(req); past the last point: extended
    const snap = snapAll();
    identicalConfigs();
    const v = data['NS_v2'].values, b = block('NS_v2', SEG), cc = b.col('Cum Streak Req');
    const oldReq = num(v[b.rows[1]][cc]); v[b.rows[1]][cc] = oldReq + 7;                  // round 2 harder
    addRound(SEG, 180, 300); addRound(SEG, 900, 500);                                       // round 4 inside the data, round 5 past it
    const c = fresh(), E = nsE_(SEG, PAY, c.ds, c), L = E.ladders, mu = muOf(SEG, PAY, 'weekend');
    const m = (req) => 0.9 * shareGe(req, mu);
    const p1 = L.pvWe[0], p2 = L.pvWe[1], p4 = L.pvWe[3], p5 = L.pvWe[4];
    const w2 = m(oldReq) * handS(mu, oldReq + 7) / handS(mu, oldReq);
    const notes = nsNotes_().filter(x => /past the last measured point/.test(x));
    restore(snap);
    gate('C4a: an unchanged round on NS_v2 = its measured claim rate', close(p1, m(L.bWe[0].req), 1e-12), p1.toFixed(5));
    gate('C4b: a round whose requirement changed = measured x S(new) / S(old) on the progress curve (by hand)', close(p2, w2, 1e-9), p2.toFixed(5) + ' vs ' + w2.toFixed(5));
    gate('C4c: a NEW round = the curve at its requirement (by hand, linear between measured points)', close(p4, handS(mu, 180), 1e-9), p4.toFixed(5) + ' vs ' + handS(mu, 180).toFixed(5));
    gate('C4d: a round past the last measured point = the slope extended off the last two points (by hand), and it is named',
      close(p5, handS(mu, 900), 1e-9) && notes.some(x => /900/.test(x)), p5.toExponential(3) + ' vs ' + handS(mu, 900).toExponential(3) + '; ' + notes.length + ' note(s)');
  }
  {
    // C5: censored_at - points past it are dropped and the slope is extended from below it
    const snap = snapAll();
    data['data_ns_progress'] = progressSheet({ cens: 60 });
    const c = fresh(), S = nsCurve_(SEG, PAY, c.ds, 'weekend').S, mu = muOf(SEG, PAY, 'weekend');
    const lam = Math.log(shareGe(40, mu) / shareGe(60, mu)) / 20, want = shareGe(60, mu) * Math.exp(-lam * 40);
    const got = S(100);
    restore(snap);
    gate('C5: censored_at 60 - the curve at 100 is the slope extended from the points up to 60', close(got, want, 1e-9), got.toFixed(6) + ' vs ' + want.toFixed(6));
  }
  {
    // C6: config_segment - a segment reads its own block's rows; with none, the pooled ALL rows
    const snap = snapAll();
    // own block's rows + rows served another block + pooled ALL rows, in that order and reversed
    const extra = roundsSheet({ cfg: '20-39', factor: 0.3 }).values.slice(1).concat(roundsSheet({ cfg: 'ALL', factor: 0.5 }).values.slice(1));
    data['data_ns_rounds'].values = [data['data_ns_rounds'].values[0]].concat(extra, data['data_ns_rounds'].values.slice(1));
    let c = fresh();
    const pOwn = nsE_(SEG, PAY, c.ds, c).ladders.pbWe[0];
    data['data_ns_rounds'] = roundsSheet({ cfg: 'ALL', factor: 0.5 });
    c = fresh();
    const pAll = nsE_(SEG, PAY, c.ds, c).ladders.pbWe[0];
    const L0 = nsLadderOn_('NS', SEG), mu = muOf(SEG, PAY, 'weekend');
    restore(snap);
    gate('C6: a segment reads the rows of its own config block (rows served another block ignored), else the pooled ALL rows',
      close(pOwn, 0.9 * shareGe(L0[0].req, mu), 1e-12) && close(pAll, 0.5 * shareGe(L0[0].req, mu), 1e-12), pOwn.toFixed(4) + ' / ' + pAll.toFixed(4));
  }
  {
    // C7: 250+ reads its parent's rows when the pull has none of its own, its own when it has
    let c = fresh();
    const E250 = nsE_('250+', 'PAYER', c.ds, c), E100 = nsE_('100-249', 'PAYER', c.ds, c);
    const sameAsParent = E250 && E100 && E250.ladders.pbWe.every((p, k) => close(p, E100.ladders.pbWe[k], 1e-12));
    const snap = snapAll();
    data['data_ns_rounds'].values = data['data_ns_rounds'].values.concat(roundsSheet({ cells: [['250+', 'PAYER']], factor: 0.2, cfg: '100+' }).values.slice(1));
    c = fresh();
    const own = nsE_('250+', 'PAYER', c.ds, c).ladders.pbWe[0], L0 = nsLadderOn_('NS', '250+');
    restore(snap);
    gate('C7: 250+ reads 100-249\'s rows when it has none, its own rows when the pull carries them', sameAsParent && close(own, 0.2 * shareGe(L0[0].req, muOf('250+', 'PAYER', 'weekend')), 1e-12),
      own.toFixed(4));
  }
  {
    // C8: day-typed data on ONE ladder (no weekday sheets): the daily view still splits by day type, sums to the row
    const snap = snapAll();
    delete data['NS_v2_weekday']; delete data['NS_weekday'];
    const c = fresh(), E = nsE_(SEG, PAY, c.ds, c);
    const W = resultRow_(CAT, SEG, PAY, c), d = dailySeries_(CAT, SEG, PAY, c, true);
    let we = 0, wd = 0;
    d.forEach((x, i) => { if (isWeekend_(i + 1)) we += num(x && x.HC); else wd += num(x && x.HC); });
    const b = c.ds.beh(SEG, PAY), sp = nsSplitDays_(c.calNew['Night Sky'], num(b.weekday_active_rate), num(b.weekend_active_rate));
    const mWe = num(E.eV2Weekend.HC) * sp.sumWe, mWd = num(E.eV2Weekday.HC) * sp.sumWd, want = num(W.HC) * mWe / (mWe + mWd);
    restore(snap);
    gate('C8: day-typed data on one ladder - the daily view puts HC on weekend days by E_weekend x weekend days, and sums to the row',
      E.dayTyped && !E.hasWeekdayVariant && close(we, want, 1e-9) && close(we + wd, num(W.HC), 1e-9), we.toFixed(3) + ' vs ' + want.toFixed(3));
  }
  {
    // C9: card-sim rungs and the play-by-play view read the same chances
    const c = fresh(), insts = (c.calNew['Night Sky'] || []).slice().sort((x, y) => x.start - y.start);
    const E = nsE_(SEG, PAY, c.ds, c), L = E.ladders;
    let bad = 0, n = 0;
    insts.forEach((inst, k) => {
      const pr = packRungs_(CAT, SEG, PAY, c, k);
      if (!pr) return;
      const arr = isWeekend_(inst.start) ? L.pvWe : L.pvWd;
      pr.groups[0].rungs.forEach((rg, j) => { n++; if (!close(rg.p, arr[j], 1e-12)) bad++; });
    });
    gate('C9a: the card sim\'s Night Sky rungs = the chances the gains model prices, by day type', n > 0 && bad === 0, n + ' rungs, ' + bad + ' off');
    let det = '', ok = false;
    try {
      const day = insts.find(x => isWeekend_(x.start)).start;
      const a = { day: day, seg: SEG, payer: PAY, luck: 'p50', cal: CAL_NEW, sampled: false };
      const dr = nsDayRounds_(SEG, PAY, c.ds, day, false);
      const want = dr.p.map((p, k) => p >= 0.5 ? k + 1 : null).filter(x => x);
      det = 'rounds with P >= 50%: ' + want.join(',') + ' of ' + dr.ladder.length;
      ok = dr.ladder.length === L.vWe.length && dr.p.every((p, k) => close(p, L.pvWe[k], 1e-12));
    } catch (e) { det = 'threw ' + e.message; }
    gate('C9b: the play-by-play view\'s day ladder and chances = the weekend ladder the gains model prices', ok, det);
  }
  {
    // C9c: the play-by-play ledger (Expected) pays exactly the rounds at least half the player-days clear
    const snap = snapAll();
    data['data_ns_rounds'] = roundsSheet({ factor: 2 });       // lifts some rounds over 50%
    const c = fresh(), S9 = '0-9', P9 = 'NONPAYER';
    const insts = (c.calNew['Night Sky'] || []).slice().sort((x, y) => x.start - y.start);
    let ok = true, det = [];
    [insts.find(x => isWeekend_(x.start)), insts.find(x => !isWeekend_(x.start))].forEach(inst => {
      if (!inst) return;
      [CAL_NEW, CAL_CUR].forEach(cal => {
        const a = pbpArgs_(cal, inst.start, S9, P9, 'Expected', 'p50', 1, 0);
        const sim = pbpSimulate_(a), got = sim.grantsE.filter(g => g.cat === CAT).length;
        const dr = nsDayRounds_(S9, P9, c.ds, inst.start, cal !== CAL_NEW), want = dr.p.filter(p => p >= 0.5).length;
        det.push(cal + ' day ' + inst.start + ': ' + got + '/' + want);
        if (got !== want || !sim.grantsE.filter(g => g.cat === CAT).every(g => /P\(clear\)/.test(g.note))) ok = false;
      });
    });
    restore(snap);
    gate('C9c: the play-by-play ledger (Expected) pays exactly the rounds whose chance is >= 50%, on both calendars and day types', ok && det.length === 4, det.join(', '));
  }
  {
    // C10: NS_ROUND_DATA = false = no data sheets, bit for bit
    NS_ROUND_DATA = false;
    const R1 = rowsOf();
    NS_ROUND_DATA = true; fresh();
    gate('C10: NS_ROUND_DATA = false reads no data_ns_* sheet - every NS row as with none', cells.every(([s, p]) => sameRow(R1[s + '|' + p], R0[s + '|' + p])));
  }
  {
    // C11: with the pull, the daily view still sums to the window row everywhere
    const c = fresh(); let worst = 0;
    cells.forEach(([s, p]) => [true, false].forEach(isNew => {
      const W = isNew ? resultRow_(CAT, s, p, c) : measuredRow_(CAT, s, p, c.ds), d = dailySeries_(CAT, s, p, c, isNew);
      RESOURCES.forEach(r => { const sum = d.reduce((a, x) => a + num(x && x[r]), 0);
        worst = Math.max(worst, Math.abs(sum - num(W[r])) / Math.max(1, Math.abs(num(W[r])))); });
    }));
    gate('C11: with the pull read, the daily view sums to the window row on every cell, both sides', worst < 1e-9, 'worst ' + worst.toExponential(2));
  }

  // ================================================================ E. D107: per-day claims + the streak curve
  say('\n================ E. D107 - data_ns_per_day_reach (base claims) + data_ns_streak_dist (the curve) ================');
  // synthetic per-day pull: two weekday and two weekend dates per ladder with different actives; claims =
  // active x rate(ladder, k, day type) x a per-date wobble, so the pooled rate is SUM claimed / SUM active by hand.
  // Optional: a defect date (round 1 claims > actives); rows of another arm.
  const LADS = ['0-9', '10-19', '20-39', '40-99', '100+'];
  const rateOf = (lab, k, dt) => 0.8 * Math.pow(0.55, k) * (dt === 'weekend' ? 1.1 : 0.95) * (1 + 0.1 * LADS.indexOf(lab));
  const DATES = [['2026-10-14', 'weekday', 1000, 1.0], ['2026-10-15', 'weekday', 3000, 1.2],
                 ['2026-10-16', 'weekend', 2000, 0.9], ['2026-10-17', 'weekend', 500, 1.3]];
  const DEFECT = ['2026-10-13', 'weekday', 900, 3.0];
  const perDaySheet = (opts) => {
    opts = opts || {};
    const hdr = ['event_date', 'day_type', 'event_id', 'event_name', 'ladder', 'config_arm', 'round', 'rounds_total', 'round_req',
                 'cum_req', 'players_eligible', 'players_joined', 'players_active', 'players_reached_streak', 'players_reached_longest',
                 'players_reached', 'players_claimed'];
    const rows = [hdr];
    const dates = (opts.defect ? [DEFECT.concat([true])] : []).concat(DATES.map(d => d.concat([false])));
    LADS.forEach(lab => {
      const base = nsLadderOn_('NS', segCanon_(lab));
      dates.forEach(([d, dt, act, wob, bad]) => base.forEach((ms, k) => {
        const claimed = bad && k === 0 ? act * 1.5 : act * rateOf(lab, k + 1, dt) * wob;
        rows.push([d, dt, 'e' + d + lab, 'NS ' + lab, lab, 'Variant A (Dream Album)', k + 1, base.length, 0, ms.req,
                   act * 5, act * 1.2, act, 0, 0, 0, claimed]);
        if (opts.otherArm) rows.push([d, dt, 'c' + d + lab, 'NS ' + lab, lab, 'Control', k + 1, base.length, 0, ms.req, 1, 1, 10, 0, 0, 0, 9]);
      }));
    });
    return { values: rows, merges: [] };
  };
  const handRate = (lab, k, dt) => {
    let a = 0, c = 0;
    DATES.forEach(([d, t, act, wob]) => { if (t === dt){ a += act; c += act * rateOf(lab, k, dt) * wob; } });
    return c / a;
  };
  // synthetic streak sheet (PROMPT_ns_streak_curve.md): per (date, ladder, payer) players_ge_X = active x A2 exp(-X / mu),
  // mu by ladder, day type and payer - the same on every date, so the pooled per-payer curve is that shape at the points.
  // The defect date (when asked) carries a very different shape, so reading it would show.
  const XG = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512], A2 = 0.9;
  const muS = (lab, dt, pay) => 10 * (1 + LADS.indexOf(lab)) * (dt === 'weekend' ? 1.2 : 1) * (pay === 'PAYER' ? 0.9 : 1);
  const streakSheet = (opts) => {
    opts = opts || {};
    const rows = [['event_date', 'day_type', 'ladder', 'config_arm', 'payer_flag', 'players_active', 'players_zero', 'progress_sum',
                   'progress_max'].concat(XG.map(x => 'players_ge_' + x))];
    const dates = (opts.defect ? [DEFECT.concat([true])] : []).concat(DATES.map(d => d.concat([false])));
    LADS.forEach(lab => dates.forEach(([d, dt, act, wob, bad]) => ['NONPAYER', 'PAYER'].forEach(pay => {
      const a = act * (pay === 'PAYER' ? 0.4 : 0.6), mu = bad ? 1 : muS(lab, dt, pay);
      rows.push([d, dt, lab, 'Variant A (Dream Album)', pay, a, a * (1 - A2), 0, 0].concat(XG.map(x => a * A2 * Math.exp(-x / mu))));
    })));
    return { values: rows, merges: [] };
  };
  // D107c: the curve is read up to the ladder's old FINAL round requirement (fin; the data_ns_per_day_reach
  // cum_req of its last round) and extended past it on the slope from the last point <= fin / 2 to the last point.
  // fin = Infinity reads every point (NS_STREAK_CENSOR = false): extended past 512 off the last two points.
  const finOf = (lab) => { const L = nsLadderOn_('NS', segCanon_(lab)); return L.length ? L[L.length - 1].req : Infinity; };
  const handSt = (mu, x, fin) => {
    fin = (fin == null) ? Infinity : fin;
    const pts = [[0, 1]].concat(XG.filter(X => X <= fin + 1e-9).map(X => [X, A2 * Math.exp(-X / mu)]));
    if (x <= 0) return 1;
    for (let j = 1; j < pts.length; j++) if (x <= pts[j][0]) { const a = pts[j - 1], b = pts[j]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); }
    const l = pts[pts.length - 1];
    let pr = pts[pts.length - 2];
    if (isFinite(fin)) for (let j = pts.length - 2; j >= 0; j--) if (pts[j][0] <= fin / 2 + 1e-9){ pr = pts[j]; break; }
    return l[1] * Math.exp(-Math.log(pr[1] / l[1]) / (l[0] - pr[0]) * (x - l[0]));
  };
  const both = (opts) => { data['data_ns_per_day_reach'] = perDaySheet(opts); data['data_ns_streak_dist'] = streakSheet(opts); };
  {
    // E0: the coherence rule - data_ns_per_day_reach WITHOUT the streak curve is not read (D106 bit for bit)
    const R0d = rowsOf();
    const snap = snapAll();
    data['data_ns_per_day_reach'] = perDaySheet();
    const R1 = rowsOf();
    restore(snap);
    gate('E0: data_ns_per_day_reach without data_ns_streak_dist is not read - every NS row as D106 (claims on one footing, the curve on another priced 250+ at 3.7x)',
      cells.every(([s, p]) => sameRow(R1[s + '|' + p], R0d[s + '|' + p])));
  }
  {
    // E1: base rounds = SUM claimed / SUM active per day type, the ladder's rate for BOTH payers (data_ns_rounds present, not read)
    const snap = snapAll();
    both();
    const c = fresh();
    let bad = 0, n = 0, det = '';
    [['40-99', '40-99'], ['10-19', '10-19'], ['100-249', '100+']].forEach(([seg, lab]) => ['NONPAYER', 'PAYER'].forEach(p => {
      const L = nsE_(seg, p, c.ds, c).ladders;
      L.pbWe.forEach((x, k) => { n++; if (!close(x, handRate(lab, k + 1, 'weekend'), 1e-12)) bad++; });
      L.pbWd.forEach((x, k) => { n++; if (!close(x, handRate(lab, k + 1, 'weekday'), 1e-12)) bad++; });
      if (seg === '40-99' && p === 'PAYER') det = L.pbWe.map(x => x.toFixed(4)).join(' ') + ' | ' + L.pbWd.map(x => x.toFixed(4)).join(' ');
    }));
    restore(snap);
    gate('E1: a base round = SUM claimed / SUM active of its ladder for the day type, the same for NONPAYER and PAYER (data_ns_rounds not read)',
      n > 0 && bad === 0, n + ' rounds, ' + bad + ' off; 40-99 we | wd: ' + det);
  }
  {
    // E2: the defect rule - a date on which a round counts more claims than actives is left out (both sheets), and named
    const snap = snapAll();
    both({ defect: true });
    const c = fresh(), L = nsE_('20-39', 'NONPAYER', c.ds, c).ladders;
    const ok = L.pbWd.every((x, k) => close(x, handRate('20-39', k + 1, 'weekday'), 1e-12));
    const S = nsCurve_('20-39', 'NONPAYER', c.ds, 'weekday').S, mu = muS('20-39', 'weekday', 'NONPAYER');
    const okS = [3, 16, 50].every(x => close(S(x), handSt(mu, x, finOf('20-39')), 1e-12));
    const noted = nsNotes_().some(x => /more claims than active players/.test(x) && /2026-10-13/.test(x));
    NS_PERDAY_DROP_DEFECT = false;
    const c2 = fresh(), L2 = nsE_('20-39', 'NONPAYER', c2.ds, c2).ladders;
    NS_PERDAY_DROP_DEFECT = true;
    const r2 = (4000 * handRate('20-39', 2, 'weekday') + 900 * rateOf('20-39', 2, 'weekday') * 3.0) / 4900;
    restore(snap);
    gate('E2: a date on which a round counts more claims than actives is left out of the claims AND the streak curve, and named',
      ok && okS && noted, L.pbWd.map(x => x.toFixed(4)).join(' ') + (okS ? ', curve ok' : ', curve OFF') + (noted ? ' (noted)' : ' (no note)'));
    gate('E2b: NS_PERDAY_DROP_DEFECT = false keeps that date (round 2 pools it in, by hand)', close(L2.pbWd[1], r2, 1e-12),
      L2.pbWd[1].toFixed(5) + ' vs ' + r2.toFixed(5));
  }
  {
    // E3: rows of another arm than ANCHOR_ARM are skipped
    const snap = snapAll();
    both({ otherArm: true });
    const c = fresh(), L = nsE_('0-9', 'PAYER', c.ds, c).ladders;
    const ok = L.pbWe.every((x, k) => close(x, handRate('0-9', k + 1, 'weekend'), 1e-12));
    restore(snap);
    gate('E3: rows whose config_arm is not ANCHOR_ARM are skipped', ok, L.pbWe.map(x => x.toFixed(4)).join(' '));
  }
  {
    // E4: 250+ reads the 100+ ladder's claims and curve
    const snap = snapAll();
    both();
    const c = fresh(), L = nsE_('250+', 'NONPAYER', c.ds, c).ladders, S = nsCurve_('250+', 'NONPAYER', c.ds, 'weekend').S;
    const ok = L.pbWe.every((x, k) => close(x, handRate('100+', k + 1, 'weekend'), 1e-12)) &&
               close(S(100), handSt(muS('100+', 'weekend', 'NONPAYER'), 100, finOf('100+')), 1e-12);
    restore(snap);
    gate('E4: 250+ reads the claims and the streak curve of the 100+ ladder it plays', ok, L.pbWe.map(x => x.toFixed(4)).join(' '));
  }
  {
    // E5: identical configs -> DIFF 0 with both sheets read
    const snap = snapAll();
    both({ defect: true, otherArm: true });
    identicalConfigs();
    const c = fresh(); let bad = 0;
    cells.forEach(([s, p]) => { if (!sameRow(resultRow_(CAT, s, p, c), measuredRow_(CAT, s, p, c.ds))) bad++; });
    restore(snap);
    gate('E5: with both sheets read, NS_v2 == NS (and the weekday pair) gives a Night Sky DIFF of 0 on every cell', bad === 0, bad + ' cells differ');
  }
  {
    // E6: the curve = SUM players_ge_X / SUM players_active of the cell's payer and day type (by hand, at a point and between)
    const snap = snapAll();
    both();
    const c = fresh();
    let bad = 0, n = 0;
    [['40-99', '40-99'], ['0-9', '0-9']].forEach(([seg, lab]) => ['NONPAYER', 'PAYER'].forEach(p => ['weekday', 'weekend'].forEach(dt => {
      const C = nsCurve_(seg, p, c.ds, dt), mu = muS(lab, dt, p), fin = finOf(lab);
      [4, 10, 64, 100, 700].forEach(x => { n++; if (!(C && C.src === 'streak' && close(C.S(x), handSt(mu, x, fin), 1e-12))) bad++; });
    })));
    const E = nsE_('40-99', 'NONPAYER', c.ds, c);
    restore(snap);
    gate('E6: the curve = SUM players_ge_X / SUM players_active for the cell\'s payer and day type, read up to the ladder\'s old final round and extended past it on the fin/2 -> fin slope (by hand)',
      n > 0 && bad === 0 && E.source === 'streak', n + ' points, ' + bad + ' off; source ' + E.source);
  }
  {
    // E6b: NS_STREAK_CENSOR = false reads every delivered point (the uncensored hand curve)
    const snap = snapAll();
    both();
    NS_STREAK_CENSOR = false;
    const c = fresh(), C = nsCurve_('40-99', 'PAYER', c.ds, 'weekend'), mu = muS('40-99', 'weekend', 'PAYER');
    const ok = [64, 150, 300, 700].every(x => close(C.S(x), handSt(mu, x), 1e-12));
    NS_STREAK_CENSOR = true;
    const c2 = fresh(), C2 = nsCurve_('40-99', 'PAYER', c2.ds, 'weekend');
    const differs = !close(C2.S(150), handSt(mu, 150), 1e-6);
    restore(snap);
    gate('E6b: NS_STREAK_CENSOR = false reads every delivered point; true moves the curve past the old final round', ok && differs,
      'S(150) uncensored ' + handSt(mu, 150).toFixed(5) + ' / censored ' + C2.S(150).toFixed(5));
  }
  {
    // E7: a changed requirement = per-day claims x S(new) / S(old); a NEW round = S(req) on the streak curve
    const snap = snapAll();
    both();
    identicalConfigs();
    const v = data['NS_v2'].values, b = block('NS_v2', SEG), cc = b.col('Cum Streak Req');
    const oldReq = num(v[b.rows[1]][cc]); v[b.rows[1]][cc] = oldReq + 7;
    addRound(SEG, 180, 300);
    const c = fresh(), L = nsE_(SEG, PAY, c.ds, c).ladders, mu = muS(SEG, 'weekend', PAY), fin = finOf(SEG);
    const want2 = handRate(SEG, 2, 'weekend') * handSt(mu, oldReq + 7, fin) / handSt(mu, oldReq, fin), wantN = handSt(mu, 180, fin);
    const p2 = L.pvWe[1], pN = L.pvWe[L.pvWe.length - 1];
    restore(snap);
    gate('E7: a changed requirement = per-day claims x S(new) / S(old), a new round = S(req), both on the streak curve (by hand)',
      close(p2, want2, 1e-9) && close(pN, wantN, 1e-9), p2.toFixed(5) + ' vs ' + want2.toFixed(5) + '; new ' + pN.toFixed(5) + ' vs ' + wantN.toFixed(5));
  }
  {
    // E8: NS_PERDAY_READ = false = D106 bit for bit with both sheets present; true moves the rows
    const R0d = rowsOf();
    const snap = snapAll();
    both();
    NS_PERDAY_READ = false;
    const Roff = rowsOf();
    NS_PERDAY_READ = true;
    const Ron = rowsOf();
    restore(snap);
    const moved = cells.filter(([s, p]) => !sameRow(Ron[s + '|' + p], R0d[s + '|' + p])).length;
    gate('E8: NS_PERDAY_READ = false reads neither sheet (every NS row as D106); true moves the rows',
      cells.every(([s, p]) => sameRow(Roff[s + '|' + p], R0d[s + '|' + p])) && moved > 0, moved + ' cells move with the sheets read');
  }
  restore(SNAP0);

  // ================================================================ D. V2DIFF
  say('\n================ D. V2Diff - segment blocks of different lengths ================');
  {
    const blank = (v) => v.map(r => r.map(() => ''));
    // fixture (whatever the dump's NS_v2 holds): NS_v2 := NS with two rounds added to 40-99 and one to 100+
    const snapD = snapAll();
    data['NS_v2'] = clone(data['NS']);
    addRound('40-99', 400, 50); addRound('40-99', 500, 60); addRound('100+', 900, 70);
    fresh();
    const bv = data['NS'].values, vv = data['NS_v2'].values, cols = bv[0].length;
    const mk = v2diffMarks_(bv, blank(bv), vv, blank(vv), Math.max(...bv.map(r => r.length)));
    const inBlock = (lab) => { const b = block('NS_v2', lab); const next = vv.findIndex((r, i) => i > b.lr && /^(\d+\s*-\s*\d+|\d+\s*\+)$/.test(String(r[0]).trim()));
      return (rc) => rc[0] > b.lr && (next < 0 || rc[0] < next); };
    const lowMarks = mk.cells.filter(rc => inBlock('0-9')(rc) || inBlock('10-19')(rc)).length;
    const b40 = block('NS_v2', '40-99'), b40b = block('NS', '40-99');
    const addedRows = new Set(mk.cells.filter(rc => inBlock('40-99')(rc) && rc[0] >= b40.g0 + b40b.rows.length).map(rc => rc[0]));
    say('   ' + mk.cells.length + ' cells marked; added: ' + mk.added.join(' / ') + '; removed: ' + (mk.removed.join(' / ') || 'none'));
    gate('D1: blocks of a different length are compared block by block - 0-9 / 10-19 (unchanged) carry no mark, 40-99\'s extra rounds are marked whole',
      lowMarks === 0 && addedRows.size === b40.rows.length - b40b.rows.length && mk.added.some(x => /^40-99 rounds/.test(x)) && mk.added.some(x => /^100\+ rounds/.test(x)),
      lowMarks + ' marks in 0-9/10-19, ' + addedRows.size + ' new 40-99 rows');
    restore(snapD);
    // a same-shape pair is the plain cell-by-cell compare - built here (a clone of the base with three reward
    // cells edited), not read off the dump: the dump's weekday pair may differ in shape (workbook (2): it does)
    const wb = (data['NS_weekday'] || data['NS']).values, wv = clone(wb);
    const hcCol = wb.findIndex(r => r.some(x => String(x).trim() === 'HC Reward')) >= 0
      ? wb[wb.findIndex(r => r.some(x => String(x).trim() === 'HC Reward'))].findIndex(x => String(x).trim() === 'HC Reward') : 5;
    const edits = []; wb.forEach((r, i) => { if (edits.length < 3 && /^\s*\d+\s*$/.test(String(r[0]))) edits.push(i); });
    edits.forEach(i => { wv[i][hcCol] = num(wv[i][hcCol]) + 7; });
    const mk2 = v2diffMarks_(wb, blank(wb), wv, blank(wv), cols);
    let plain = 0; for (let r = 0; r < Math.min(wb.length, wv.length); r++) for (let c = 0; c < cols; c++) if (!v2diffEqual_(wb[r][c], (wv[r] || [])[c])) plain++;
    gate('D2: a pair of the same shape is the plain cell-by-cell compare (bit for bit)',
      mk2.cells.length === plain && plain === edits.length && !mk2.added.length, mk2.cells.length + ' vs ' + plain + ' (' + edits.length + ' edited)');
  }
  say('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
