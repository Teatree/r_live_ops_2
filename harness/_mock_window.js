// Offline harness for the COUNTED WINDOW (D70+, 2026-10-28): the window read off the calendar's
// day-number row, the measured rescale to it (D71), the Rainbow Maker split and cut-off pace (D72)
// and the 2-day Kite lane (D73).
//
//   node harness/_mock_window.js                 (defaults to the 28-day fixture, --data w28)
//   node harness/_mock_window.js --data v3d      (today's sheets: row 4 = 1..30, 1, 2, 3)
//
// The fixture is BUILT, not authored: harness/_make_window_fixture.js takes the LIVE_OPS_V3 (3) dump,
// puts cal_new_%NEW in place of cal_new and renumbers row 4 G = 1 .. AH = 28 on both calendars -
// exactly the edits the user said they will make. Every gate asserts a RULE against whatever the
// fixture holds, so it survives the next calendar edit.
const fs = require('fs');
const path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'w28');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function GATES() {
  eval(fs.readFileSync(ENGINE('EcoGainsSim_7Day.gs'), 'utf8'));
  const fresh = () => { _sheetValsCache = {}; Context.reset(); return Context.get(); };
  const row4 = (n) => data[n].values[3];
  const numbered = (n) => row4(n).slice(1, 34).filter(x => String(x).trim() !== '').length;
  const ctx = fresh();
  const w = ctx.window;
  console.log('\n================ D70: THE COUNTED WINDOW ================');
  console.log('window ' + JSON.stringify(w) + ' | numbered cells on cal_new row 4: ' + numbered('cal_new'));

  // the window is the contiguous numbered span from the first 1
  {
    const r = row4('cal_new'), first = r.findIndex((x, i) => i >= 1 && i <= 33 && String(x).trim() !== '' && Number(x) === 1);
    let n = 0; while (first + n <= 33 && String(r[first + n] ?? '').trim() !== '' && isFinite(parseFloat(r[first + n]))) n++;
    check('D70: day 1 is the first column holding 1 on the day-number row, and the window is the numbered span from it',
      w.col1 === first + 1 && w.days === n && w.offset === first + 1 - 2, 'col1 ' + w.col1 + ' days ' + w.days + ' (expected col ' + (first + 1) + ', ' + n + ' days)');
    check('D70: DAILY_DAYS follows the window', DAILY_DAYS === w.days, String(DAILY_DAYS));
  }
  // the weekday of day 1 is read at the window's day-1 column
  {
    const wd = String(data['cal_new'].values[2][w.col1 - 1]).trim().toLowerCase();
    check('D70: day 1\'s weekday is read at the window\'s first column (' + wd + ')', DOW_NAMES[calDay1Dow_() - 1] === wd, String(calDay1Dow_()));
    const weekend = []; for (let d = 1; d <= w.days; d++) if (isWeekend_(d)) weekend.push(d);
    const want = []; for (let d = 1; d <= w.days; d++) { const k = (DOW_NAMES.indexOf(wd) + d - 1) % 7; if (k >= 4) want.push(d); }
    check('D70: the weekend is Fri/Sat/Sun counted from that weekday', JSON.stringify(weekend) === JSON.stringify(want), weekend.join(','));
    check('D70: isWeekend_ is defined for pre-window days (day <= 0) and continues the week backwards',
      [0, -1, -2, -3, -4, -5, -6].every(d => isWeekend_(d) === isWeekend_(d + 7)));
  }
  // every in-window instance lies inside 1..N; the full view keeps the pre-window ones
  {
    let out = 0, pre = 0, clipped = 0;
    ['calCur', 'calNew'].forEach(k => Object.values(ctx[k]).forEach(l => l.forEach(i => {
      if (i.start < 1 || i.start + i.dur - 1 > w.days) out++;
      if (i.clipStart || i.clipEnd) clipped++;
    })));
    Object.values(ctx.calCurFull).forEach(l => l.forEach(i => { if (i.start < 1) pre++; }));
    check('D70: every instance on calCur / calNew lies inside days 1..' + w.days, out === 0, out + ' outside');
    check('D70: calCurFull keeps what lies before day 1 (for the measured rescale)', w.offset === 0 || pre > 0, pre + ' pre-window instances');
    // a clipped instance is exactly the in-window part of its full instance
    let bad = 0;
    ['Cur', 'New'].forEach(side => Object.keys(ctx['cal' + side + 'Full']).forEach(l => {
      const full = ctx['cal' + side + 'Full'][l];
      const win = (ctx['cal' + side][l] || []);
      const want = full.map(i => { const s = Math.max(1, i.start), e = Math.min(w.days, i.start + i.dur - 1); return s <= e ? s + '-' + e : null; }).filter(Boolean).sort();
      const got = win.map(i => i.start + '-' + (i.start + i.dur - 1)).sort();
      if (JSON.stringify(want) !== JSON.stringify(got)) bad++;
    }));
    check('D70: the window view is exactly the full view clipped to 1..' + w.days + ' (' + clipped + ' instance(s) cross an edge)', bad === 0, bad + ' lanes differ');
  }
  // the daily view: N rows, and its days sum to the window totals
  {
    const g = ECOGAINS_DAILY('NONPAYER', '0-9', 'ALL', 'NEW');
    check('D70: the daily view has one row per window day', g.length === w.days, g.length + ' rows');
    let worst = 0;
    [['NONPAYER', '0-9'], ['PAYER', '40-99']].forEach(([p, s]) => {
      const sim = ECOGAINS_SIM(p, s);
      CATEGORY_ORDER.forEach((cat, i) => {
        const daily = ECOGAINS_DAILY(p, s, cat, 'NEW');
        RESOURCES.forEach((r, j) => {
          let t = 0; daily.forEach(row => { t += Number(row[j]) || 0; });
          worst = Math.max(worst, Math.abs(t - Number(sim[i][j])));
        });
      });
    });
    check('D70: conservation - each category\'s daily NEW rows sum to its window total', worst < 1e-6, 'max err ' + worst.toExponential(2));
    const r7 = win7Range_();
    check('D70: the 7-day view is the first Monday-to-Monday span of the window', !isWeekend_(r7[0]) && isWeekend_(r7[0] - 1) && r7[1] === r7[0] + 7, JSON.stringify(r7));
  }
  // today's sheets (row 4 = 1..30, 1, 2, 3) are the whole grid: the restart does not end the window
  {
    const snap = JSON.stringify(row4('cal_new')), snapC = JSON.stringify(row4('cal_curr'));
    ['cal_new', 'cal_curr'].forEach(n => { const r = row4(n); for (let c = 2; c <= 34; c++) r[c - 1] = (c - 1 <= 30) ? c - 1 : c - 31; });
    const c2 = fresh();
    check('D70: a day-number row that restarts (1..30 then 1, 2, 3 - today\'s sheets) is the whole 33-day grid', c2.window.days === 33 && c2.window.offset === 0, JSON.stringify(c2.window));
    data['cal_new'].values[3] = JSON.parse(snap); data['cal_curr'].values[3] = JSON.parse(snapC);
    // no day-number row at all -> the whole grid
    const k = JSON.stringify(data['cal_new'].values[3]), kc = JSON.stringify(data['cal_curr'].values[3]);
    data['cal_new'].values[3] = data['cal_new'].values[3].map(() => ''); data['cal_curr'].values[3] = data['cal_curr'].values[3].map(() => '');
    const c3 = fresh();
    check('D70: no day-number row on either calendar -> the whole grid (the pre-D70 engine)', c3.window.days === 33 && c3.window.offset === 0, JSON.stringify(c3.window));
    data['cal_new'].values[3] = JSON.parse(k); data['cal_curr'].values[3] = JSON.parse(kc);
    fresh();
  }

  // ================================================================ D71: THE MEASURED RESCALE
  console.log('\n================ D71: THE MEASURED SIDE, RESCALED TO THE WINDOW ================');
  {
    const c = fresh(), w = c.window, whole = windowIsWholeGrid_(w);
    // (1) exactly the scale, on the export: measured core row = raw export x windowScale_
    const seg = '20-39', payer = 'PAYER', cat = 'Daily Gift';
    const raw = (() => { const fn = c.ds.scaleFn; c.ds.scaleFn = null; const v = c.ds.gains(seg, payer, cat, 'HC'); c.ds.scaleFn = fn; return v; })();
    const k = windowScale_(cat, seg, payer, c), got = c.ds.gains(seg, payer, cat, 'HC');
    check('D71: an export amount is read at the window level - raw x windowScale_ (' + k.toFixed(4) + ')',
      Math.abs(got - raw * k) < 1e-9 && (whole ? k === 1 : (k < 1 && k > 0)), 'raw ' + raw + ' read ' + got);
    // (2) an always-on source scales by the window's share of expected active days
    const b = c.ds.beh(seg, payer), pWd = Number(b.weekday_active_rate), pWe = Number(b.weekend_active_rate);
    let pf = 0, pw = 0; for (let d = 1 - w.offset; d <= 33 - w.offset; d++) { const p = isWeekend_(d) ? pWe : pWd; pf += p; if (d >= 1 && d <= w.days) pw += p; }
    check('D71: an always-on source (Daily Gift) scales by Σ p_day over the window / over the whole grid', Math.abs(k - pw / pf) < 1e-12, k + ' vs ' + (pw / pf));
    // (3) an event lane scales by the reach ratio of cal_curr's in-window instances
    const lane = DAILY_CAL_LABEL['Target Day'];
    const sf = reachSum_(c.calCurFull[lane] || [], pWd, pWe), sw = reachSum_(c.calCur[lane] || [], pWd, pWe);
    check('D71: an event lane (Target Day) scales by Σ reach in the window / Σ reach on the whole grid',
      Math.abs(windowScale_('Target Day', seg, payer, c) - (sf > 0 ? sw / sf : 1)) < 1e-12, windowScale_('Target Day', seg, payer, c) + ' vs ' + (sw / sf));
    // (4) the rule the user asked for: identical calendars + identical configs -> DIFF exactly 0,
    //     on the window. Fixture: cal_curr := cal_new (parsed), every _v2 := its base.
    const snap = JSON.stringify(data);
    const cp = data['cal_parsed'], hdr = cp.values[0], ci = hdr.indexOf('calendar');
    const nRows = cp.values.slice(1).filter(r => String(r[ci]) === 'cal_new');
    cp.values = [hdr].concat(cp.values.slice(1).filter(r => String(r[ci]) !== 'cal_curr')).concat(nRows.map(r => { const x = r.slice(); x[ci] = 'cal_curr'; return x; }));
    Object.keys(data).filter(n => n.endsWith('_v2') && data[n.slice(0, -3)]).forEach(n => { data[n] = JSON.parse(JSON.stringify(data[n.slice(0, -3)])); });
    if (data['NS_weekday']) data['NS_v2_weekday'] = JSON.parse(JSON.stringify(data['NS_weekday']));
    if (data['Ki_2d_v2'] && data['Ki']) data['Ki_2d_v2'] = JSON.parse(JSON.stringify(data['Ki']));
    fresh();
    let nz = 0, worst = 0, at = '';
    [['NONPAYER', '0-9'], ['PAYER', '20-39'], ['PAYER', '100+']].forEach(([p, s2]) => {
      const dif = ECOGAINS_DIFF(p, s2);
      CATEGORY_ORDER.forEach((ct, i) => RESOURCES.forEach((r, j) => { const v = Math.abs(Number(dif[i][j])); if (v > 1e-6) nz++; if (v > worst) { worst = v; at = s2 + ' ' + p + ' ' + ct + ' ' + r; } }));
    });
    check('D71: identical calendars + identical configs -> DIFF exactly 0 on the ' + w.days + '-day window', nz === 0, nz ? nz + ' cells, worst ' + worst.toFixed(4) + ' at ' + at : 'all zero');
    const back = JSON.parse(snap); Object.keys(data).forEach(x => { delete data[x]; }); Object.keys(back).forEach(x => { data[x] = back[x]; });
    fresh();
    // (5) off-switch: WINDOW_RESCALE = false -> the export is read raw again
    WINDOW_RESCALE = false; const c5 = fresh();
    const raw5 = c5.ds.gains(seg, payer, cat, 'HC');
    WINDOW_RESCALE = true; fresh();
    check('D71: WINDOW_RESCALE = false reads the export raw (the measured side at its data-window level)', Math.abs(raw5 - raw) < 1e-12, raw5 + ' vs ' + raw);
  }

  // ================================================================ D72: RAINBOW MAKER
  console.log('\n================ D72: RAINBOW MAKER - HALVES AND CUT-OFFS ================');
  // this section tests the data_RM + pace path; a pull carrying the live matchables (D77) prices
  // ahead of it, and D77's own section tests that path - so it runs with the live path off
  const LIVE0 = RM_LIVE_MATCHABLES; RM_LIVE_MATCHABLES = false;
  {
    const c = fresh(), N = c.window.days, half = Math.floor(N / 2);
    const seg = '20-39', payer = 'PAYER';
    const pct = c.ds.rmPct(seg, payer);
    // the per-instance table, so a reader sees what the calendar holds
    const insts = rmSortedInsts_(c.calNew);
    console.log('cal_new Rainbow Maker instances (window days 1..' + N + ', half = ' + half + '), ' + seg + ' ' + payer + ':');
    const parts = rmInstanceRows_(seg, payer, c) || [];
    RM_CUTOFF_PACE = false; fresh();
    const lin = rmInstanceRows_(seg, payer, Context.get()) || [];
    RM_CUTOFF_PACE = true; const c1 = fresh();
    insts.forEach((i, k) => {
      const cfg = rmConfigForInst_(i), cut = rmCutoff_(i, cfg, 1, N, rmCalLen_(c.calNew, cfg));
      console.log('  #' + (k + 1) + ' days ' + i.start + '..' + (i.start + i.dur - 1) + ' (' + i.dur + 'd' +
        (i.clipStart ? ', ' + i.clipStart + ' before day 1' : '') + (i.clipEnd ? ', ' + i.clipEnd + ' after day ' + N : '') + ') ' +
        cfg.sheet + ' cfgDur ' + cfg.cfgDur + (cut ? ' | ' + cut.side.toUpperCase() + ' CUT-OFF ' + cut.k + ' of ' + cut.L : '') +
        ' | HC ' + (parts[k] ? parts[k].row.HC.toFixed(1) : '-') + ' SPT ' + (parts[k] ? parts[k].row.SPT.toFixed(1) : '-') +
        (cut && lin[k] ? '  (linear pre-D72: HC ' + lin[k].row.HC.toFixed(1) + ' SPT ' + lin[k].row.SPT.toFixed(1) + ')' : ''));
    });
    // (1) the halves rule
    const wrong = insts.filter(i => rmConfigForInst_(i).sheet.indexOf(i.start <= half ? 'RM_1st' : 'RM_2nd') !== 0 &&
                                    rmConfigForInst_(i).sheet !== 'RM');
    check('D72: an instance starting on days 1..' + half + ' reads RM_1st, a later one RM_2nd', wrong.length === 0,
      wrong.map(i => i.start + ' -> ' + rmConfigForInst_(i).sheet).join(', ') || insts.length + ' instances');
    check('D72: a pre-window instance (start <= 0, the measured rescale\'s full view) reads RM_1st',
      rmConfigForInst_(mkInst_(-3, 4)).sheet.indexOf('RM_1st') === 0 || rmConfigForInst_(mkInst_(-3, 4)).sheet === 'RM');
    // (2) the split rule: an L-day instance cut at day k is an END cut-off of k days plus a START
    //     cut-off of L - k days, and the two pay exactly the whole instance between them
    const cfg = rmConfigForInst_(mkInst_(1, 4)), geo = rmGeo_(c1, c1.calNew, cfg), L = geo.Lcal || cfg.cfgDur;
    console.log('  measured RM length (cal_curr modal) ' + geo.Dm + ' days, cal_new usual length ' + geo.Lcal + ' days');
    let worst = 0;
    check('D72: the gates price against a real cut-off length (L >= 2)', L >= 2, String(L));
    for (let k = 1; k < L; k++) {
      const endI = mkInst_(N - k + 1, k), startI = mkInst_(1, L - k);
      const pe = rmRungP_(endI, cfg, pct, seg, payer, c1.ds, 1, N, geo), ps = rmRungP_(startI, cfg, pct, seg, payer, c1.ds, 1, N, geo);
      const pf = rmRungP_(mkInst_(5, L), cfg, pct, seg, payer, c1.ds, 1, N, geo);
      cfg.ladder.forEach(ms => { worst = Math.max(worst, Math.abs(pe(ms.req, 'HC') + ps(ms.req, 'HC') - pf(ms.req, 'HC'))); });
    }
    check('D72: end cut-off (first k days) + start cut-off (last L-k days) = the whole instance, rung by rung', worst < 1e-12,
      'max err ' + worst.toExponential(2) + ' over k = 1..' + (L - 1));
    // (3) the pace is monotone: an end cut-off claims more, rung by rung, the more days it keeps,
    //     and keeps the whole instance at k = L. Priced on the 4-day measured geometry so k has room.
    //     The HC split of a cut 2-day instance is PRINTED, not asserted: whether the first day pays
    //     more than half depends on where the ladder puts its HC, which is a property of the ladder.
    {
      const g4 = { Dm: geo.Dm, Lcal: geo.Dm }, L4 = geo.Dm;
      let bad = 0, prevP = null;
      for (let k = 1; k <= L4; k++) {
        const p = (k < L4) ? rmRungP_(mkInst_(N - k + 1, k), cfg, pct, seg, payer, c1.ds, 1, N, g4)
                           : rmRungP_(mkInst_(5, L4), cfg, pct, seg, payer, c1.ds, 1, N, g4);
        const v = cfg.ladder.map(ms => p(ms.req, 'HC'));
        if (prevP && v.some((x, i) => x < prevP[i] - 1e-12)) bad++;
        prevP = v;
      }
      check('D72: an end cut-off claims more of every rung the more days it keeps (k = 1..' + L4 + ', the last = the whole instance)', bad === 0, bad + ' steps fall');
      const k = Math.floor(L / 2);
      const pe = rmRungP_(mkInst_(N - k + 1, k), cfg, pct, seg, payer, c1.ds, 1, N, geo);
      const ps = rmRungP_(mkInst_(1, L - k), cfg, pct, seg, payer, c1.ds, 1, N, geo);
      const sum = (p, r) => cfg.ladder.reduce((acc, ms) => acc + (ms.rew[r] || 0) * p(ms.req, r), 0);
      const sh = rmMatchShare_(c1.ds, seg, payer, k, L);
      console.log('  ' + seg + ' ' + payer + ': the first ' + k + ' of ' + L + ' days = ' + (100 * sh).toFixed(1) + '% of matchables, ' +
        ['HC', 'SPT', 'Shuffle'].map(r => (100 * sum(pe, r) / Math.max(1e-12, sum(pe, r) + sum(ps, r))).toFixed(1) + '% of ' + r).join(', '));
    }
    // (4) the pace mapping: a curve one date longer than the instance is read date for date
    {
      const curve = c1.ds.accrualCurveMean(RM_ACCR_EVENT, seg, payer);
      if (curve.length) {
        const Lc = curve[curve.length - 1].day;
        check('D72: matchables pace - instance day t is curve date t when the curve spans L+1 dates (' + Lc + ' for L = ' + (Lc - 1) + ')',
          Math.abs(rmMatchShare_(c1.ds, seg, payer, 2, Lc - 1) - curve[1].share) < 1e-12, rmMatchShare_(c1.ds, seg, payer, 2, Lc - 1) + ' vs ' + curve[1].share);
      } else check('D72: no Milestone curve in this dump -> the pace is linear', rmMatchShare_(c1.ds, seg, payer, 1, 4) === 0.25);
    }
    // (5) data_rm_pace takes over (mutation fixture), FAKE rows are ignored, and it is read per resource
    {
      const snap = data['data_rm_pace'];
      const hdr = ['segment', 'payer_flag', 'instance_length_days', 'instance_day', 'resource', 'cum_pooled_share', 'status'];
      const rows = [hdr];
      for (let d = 1; d <= L; d++) rows.push([seg, payer, L, d, 'ALL', d === 1 ? 0.7 : Math.min(1, 0.7 + 0.3 * (d - 1) / (L - 1)), '']);
      rows.push([seg, payer, L, 1, 'SPT', 0.9, '']);
      for (let d = 1; d <= L; d++) rows.push(['0-9', 'NONPAYER', L, d, 'ALL', 0.99, 'FAKE']);
      data['data_rm_pace'] = { values: rows, merges: [] };
      const c5 = fresh();
      const pe = rmRungP_(mkInst_(N, 1), cfg, pct, seg, payer, c5.ds, 1, N, geo);
      const Sf = rmRungP_(mkInst_(5, L), cfg, pct, seg, payer, c5.ds, 1, N, geo);
      const ms = cfg.ladder[Math.floor(cfg.ladder.length / 2)];
      check('D72: with data_rm_pace, an end cut-off of 1 day claims S_full x the sheet\'s day-1 share (0.7)',
        Math.abs(pe(ms.req, 'HC') - 0.7 * Sf(ms.req, 'HC')) < 1e-12, pe(ms.req, 'HC') + ' vs ' + 0.7 * Sf(ms.req, 'HC'));
      check('D72: a resource row on data_rm_pace overrides the ALL row (SPT 0.9)',
        Math.abs(pe(ms.req, 'SPT') - 0.9 * Sf(ms.req, 'SPT')) < 1e-12, String(pe(ms.req, 'SPT')));
      const ps = rmRungP_(mkInst_(1, 1), cfg, pct, seg, payer, c5.ds, 1, N, geo);
      check('D72: with data_rm_pace, a start cut-off of 1 day claims S_full x (1 - share at day L-1)',
        Math.abs(ps(ms.req, 'HC') - (1 - rows[L - 1][5]) * Sf(ms.req, 'HC')) < 1e-12, String(ps(ms.req, 'HC')));
      check('D72: FAKE rows on data_rm_pace are not read (a cell with only FAKE rows keeps the matchables pace)',
        rmClaimPace_('0-9', 'NONPAYER', L) === null);
      // the pull counts DATES spanned: an L-day instance prefers the L+1 curve over an L one
      for (let d = 1; d <= L + 1; d++) rows.push([seg, payer, L + 1, d, 'ALL', d === 1 ? 0.2 : 1, '']);
      data['data_rm_pace'] = { values: rows, merges: [] };
      fresh();
      const pp = rmClaimPace_(seg, payer, L);
      check('D72: an L-day instance reads the (L+1)-date curve when the pull has both (dates spanned, as the prompt defines it)',
        !!pp && pp.L === L + 1 && pp.share('ALL', 1) === 0.2, pp ? 'L ' + pp.L + ', day 1 ' + pp.share('ALL', 1) : 'none');
      if (snap === undefined) delete data['data_rm_pace']; else data['data_rm_pace'] = snap;
      fresh();
    }
    // (6) the measured side: Rainbow Maker's window scale is the BASE walk's window share, per resource
    {
      const c6 = fresh();
      if (windowIsWholeGrid_(c6.window)) {
        check('D72: whole-grid window -> Rainbow Maker reads the export raw', windowScale_('Rainbow Maker', seg, payer, c6, 'HC') === 1);
      } else {
        const rw = rmWindowShare_(seg, payer, c6);
        const fn = c6.ds.scaleFn; c6.ds.scaleFn = null; const raw = c6.ds.gains(seg, payer, 'Rainbow Maker', 'HC'); c6.ds.scaleFn = fn;
        const got = c6.ds.gains(seg, payer, 'Rainbow Maker', 'HC');
        check('D72: the export\'s Rainbow Maker HC is read at the base walk\'s window share (' + (rw.win.HC / rw.full.HC).toFixed(4) + ')',
          raw === 0 || Math.abs(got - raw * rw.win.HC / rw.full.HC) < 1e-9, raw + ' -> ' + got);
      }
    }
    // (7) the card sim draws the same per-instance rung probability the gains model prices
    {
      const c7 = fresh();
      let bad = 0, n = 0;
      insts.forEach((inst, k) => {
        const pr = packRungs_('Rainbow Maker', seg, payer, c7, k);
        const P = rmRungP_(inst, rmConfigForInst_(inst), pct, seg, payer, c7.ds, 1, N);
        if (!pr || !P) return;
        pr.groups[0].rungs.forEach(x => { n++; if (Math.abs(x.p - P(x.req, 'ALL')) > 1e-12) bad++; });
      });
      check('D72: the card sim\'s Rainbow Maker rungs carry the gains model\'s in-window probability, instance by instance',
        bad === 0, n + ' rungs, ' + bad + ' differ');
    }
    // (8) off-switch: RM_CUTOFF_PACE = false is the linear duration scale everywhere
    {
      RM_CUTOFF_PACE = false; const c8 = fresh();
      const Dm = rmMatchDays_(c8, cfg), i = mkInst_(1, 1), P = rmRungP_(i, cfg, pct, seg, payer, c8.ds, 1, N, rmGeo_(c8, c8.calNew, cfg));
      const S = survival_([[pct.p10 / Dm, .10], [pct.p25 / Dm, .25], [pct.p50 / Dm, .50], [pct.p75 / Dm, .75], [pct.p90 / Dm, .90]]);
      const ms = cfg.ladder[0];
      RM_CUTOFF_PACE = true; fresh();
      check('D72: RM_CUTOFF_PACE = false prices a cut-off at the linear scale (dur / measured length)',
        Math.abs(P(ms.req) - S(ms.req)) < 1e-12, P(ms.req) + ' vs ' + S(ms.req));
    }
    // (9) the calendar wins on length: an EventDuration edit moves no Rainbow Maker number
    {
      const sumRows = (ps) => (ps || []).reduce((a, p) => a + p.row.HC + p.row.SPT, 0);
      const before = sumRows(rmInstanceRows_(seg, payer, fresh()));
      const snap = {};
      Object.keys(data).filter(n => /^RM(_1st|_2nd)?(_v2)?$/.test(n)).forEach(n => {
        snap[n] = JSON.stringify(data[n]);
        data[n].values.forEach(r => { if (String(r[0]) === 'EventDuration') r[1] = 7; });
      });
      const after = sumRows(rmInstanceRows_(seg, payer, fresh()));
      RM_MATCH_DAYS_FROM_CAL = false;
      const legacy = sumRows(rmInstanceRows_(seg, payer, fresh()));
      RM_MATCH_DAYS_FROM_CAL = true;
      Object.keys(snap).forEach(n => { data[n] = JSON.parse(snap[n]); });
      fresh();
      check('D72: EventDuration set to 7 on every RM sheet moves no Rainbow Maker number (the calendar wins on length)',
        Math.abs(after - before) < 1e-9, before.toFixed(4) + ' vs ' + after.toFixed(4));
      check('D72: RM_MATCH_DAYS_FROM_CAL = false reads EventDuration again (the same edit then moves the row)',
        Math.abs(legacy - after) > 1e-6, 'legacy ' + legacy.toFixed(2) + ' vs ' + after.toFixed(2));
    }
  }
  RM_LIVE_MATCHABLES = LIVE0; fresh();

  // ================================================================ D73: THE 2-DAY KITE FESTIVAL
  console.log('\n================ D73: CALENDAR VARIANTS - THE 2-DAY KITE FESTIVAL ================');
  {
    const c = fresh(), seg = '20-39', payer = 'PAYER', lane = 'Kite Festival';
    const rawLabels = (cal) => { const cp = data['cal_parsed']; if (!cp) return [];
      const h = cp.values[0]; return cp.values.slice(1).filter(r => String(r[h.indexOf('calendar')]) === cal).map(r => String(r[h.indexOf('event')])); };
    const nVarRaw = rawLabels('cal_new').filter(l => l === 'Kite Festival (2d)').length;
    const kn = c.calNew[lane] || [], kc = c.calCur[lane] || [];
    console.log('cal_new Kite Festival: ' + kn.map(i => i.start + '+' + i.dur + (i.variant ? '(' + i.variant + ')' : '')).join(' ') +
      ' | cal_curr: ' + kc.map(i => i.start + '+' + i.dur + (i.variant ? '(' + i.variant + ')' : '')).join(' '));
    // (1) the fold
    check('D73: no lane is left under the label "Kite Festival (2d)" - it is folded into Kite Festival', !c.calNew['Kite Festival (2d)'] && !c.calNewFull['Kite Festival (2d)']);
    check('D73: every "(2d)" instance on the calendar is a Kite Festival instance tagged variant 2d (in the window)',
      kn.filter(i => i.variant === '2d').length === (c.calNewFull[lane] || []).filter(i => i.variant === '2d' && i.start + i.dur - 1 >= 1 && i.start <= c.window.days).length &&
      (c.calNewFull[lane] || []).filter(i => i.variant === '2d').length === nVarRaw, nVarRaw + ' raw, ' + kn.filter(i => i.variant === '2d').length + ' in the window');
    // sorted only where something was folded: a lane with no variant keeps its parse order (bit identity)
    check('D73: a lane that received variant instances is start-sorted (one with none keeps its parse order)',
      hasVariant_(kn) ? kn.every((i, k) => k === 0 || kn[k - 1].start <= i.start) : true,
      hasVariant_(kn) ? kn.length + ' instances' : 'no variant instance on this calendar - nothing folded');
    check('D73: a label that is itself a lane is never folded, and an unknown stem is left alone',
      (() => { const t = { 'Kite Festival': [], 'Nonsense (2d)': [mkInst_(1, 1)] }; calFoldVariants_(t); return !!t['Nonsense (2d)']; })());
    // (2) the rule: measured x sum_new reach_i E_v2(variant_i) / (E_base x sum_cur reach)  (D = 1)
    const b = c.ds.beh(seg, payer), pWd = Number(b.weekday_active_rate), pWe = Number(b.weekend_active_rate);
    const E0 = rewardE_(lane, seg, payer, c.ds), E2 = rewardE_(lane, seg, payer, c.ds, '2d');
    const meas = measuredRow_(lane, seg, payer, c.ds), sim = resultRow_(lane, seg, payer, c);
    const rc = kc.reduce((a, i) => a + reachOne_(i, pWd, pWe), 0);
    let worst = 0, n = 0;
    RESOURCES.filter(r => !isPackRes_(r) && r !== 'ToF_Ticket').forEach(r => {
      const eb = Number(E0.eBase[r]) || 0;
      if (!(eb > 1e-9) || !(Number(meas[r]) > 0)) return;
      const num_ = kn.reduce((a, i) => a + reachOne_(i, pWd, pWe) * (Number((i.variant ? E2 : E0).eV2[r]) || 0), 0);
      const want = meas[r] * num_ / (eb * rc);
      n++; worst = Math.max(worst, Math.abs(sim[r] - want) / Math.max(1e-9, Math.abs(want)));
    });
    check('D73: Kite = measured x sum over cal_new of reach_i x E_v2(instance config) / (E_base x sum reach on cal_curr)', n > 0 && worst < 1e-9,
      n + ' resources, worst rel err ' + worst.toExponential(2));
    // (3) mutation: a reward edit on Ki_2d_v2 moves the Kite row by the 2-day instances' reach share only
    {
      const snap = JSON.stringify(data['Ki_2d_v2']);
      const spec = LB_R_SPECS[lane], hdrRow = data['Ki_2d_v2'].values[spec.hdr];
      const hcCol = hdrRow.findIndex((x, j) => j >= spec.c0 && j <= spec.c1 && /^(HC|Coins)$/.test(String(x).trim()));
      data['Ki_2d_v2'].values.forEach((row, ri) => { if (ri >= spec.r0 && ri <= spec.r1) row[hcCol] = (Number(row[hcCol]) || 0) * 2 + 1; });
      const c3 = fresh();
      const sim3 = resultRow_(lane, seg, payer, c3);
      const E2b = rewardE_(lane, seg, payer, c3.ds, '2d');
      const d2 = kn.filter(i => i.variant === '2d').reduce((a, i) => a + reachOne_(i, pWd, pWe), 0) * (E2b.eV2.HC - E2.eV2.HC);
      const want = meas.HC * d2 / (Number(E0.eBase.HC) * rc);
      data['Ki_2d_v2'] = JSON.parse(snap); fresh();
      check('D73: an HC edit on Ki_2d_v2 moves Kite HC by measured x (2-day reach x dE) / (E_base x reach on cal_curr), nothing else',
        hcCol >= 0 && Math.abs((sim3.HC - sim.HC) - want) < 1e-6 * Math.max(1, Math.abs(want)), (sim3.HC - sim.HC).toFixed(4) + ' vs ' + want.toFixed(4));
    }
    // (4) packs: a pack typed on Ki_2d_v2 pays on the 2-day instances only (lane and card sim)
    {
      const one = (cx) => kn.map((inst, k) => { const pr = packRungs_(lane, seg, payer, cx, k);
        return pr ? pr.groups.reduce((a, g) => a + g.rungs.filter(x => x.packs && x.packs['1-star Pack'] > 0).length, 0) : 0; });
      const c40 = fresh(), before = resultRow_(lane, seg, payer, c40)['1-star Pack'], E40 = rewardE_(lane, seg, payer, c40.ds, '2d'), rb = one(c40);
      const snap = JSON.stringify(data['Ki_2d_v2']);
      const spec = LB_R_SPECS[lane], hdrRow = data['Ki_2d_v2'].values[spec.hdr];
      const pc = hdrRow.findIndex((x, j) => j >= spec.c0 && j <= spec.c1 && /1-star/i.test(String(x)));
      data['Ki_2d_v2'].values.forEach((row, ri) => { if (ri >= spec.r0 && ri <= spec.r1) row[pc] = (Number(row[pc]) || 0) + 1; });
      const c4 = fresh();
      const after = resultRow_(lane, seg, payer, c4)['1-star Pack'];
      const E4 = rewardE_(lane, seg, payer, c4.ds, '2d'), part = packParticipation_(lane, E4.inst);
      const want = part * seasonInsts_(kn, lane).filter(i => i.variant === '2d').reduce((a, i) => a + reachOne_(i, pWd, pWe), 0) *
                   (E4.eV2['1-star Pack'] - E40.eV2['1-star Pack']);
      const ra = one(c4);
      data['Ki_2d_v2'] = JSON.parse(snap); fresh();
      const n2 = kn.filter(i => i.variant === '2d').length;
      check('D73: +1 1-star Pack on every Ki_2d_v2 rank moves the lane by part x sum of the 2-day instances\' reach x dE (the 3-day ones not at all)',
        pc >= 0 && (n2 ? want > 0 : want === 0) && Math.abs((after - before) - want) < 1e-9,
        (after - before) + ' vs ' + want + (n2 ? '' : ' (no 2-day instance on this calendar: nothing may move)'));
      const moved2 = kn.filter((i, k) => i.variant === '2d' && ra[k] > rb[k]).length, moved3 = kn.filter((i, k) => !i.variant && ra[k] !== rb[k]).length;
      check('D73: the card sim gains that pack rung on every 2-day instance and on no 3-day one',
        moved2 === kn.filter(i => i.variant === '2d').length && moved3 === 0, moved2 + ' of 2-day moved, ' + moved3 + ' of 3-day');
    }
    // (5) no Ki_2d_v2 sheet -> the 2-day instances are priced on Ki_v2 (and say so)
    {
      const snap = data['Ki_2d_v2']; delete data['Ki_2d_v2'];
      const c5 = fresh();
      const E5 = rewardE_(lane, seg, payer, c5.ds, '2d'), E5b = rewardE_(lane, seg, payer, c5.ds);
      data['Ki_2d_v2'] = snap; fresh();
      check('D73: without a Ki_2d_v2 sheet the 2-day instances read Ki_v2', JSON.stringify(E5.eV2) === JSON.stringify(E5b.eV2));
    }
    // (6) the play-by-play view reads the instance's own sheet
    {
      eval(fs.readFileSync(ENGINE('EcoGainsSim_PBP.gs'), 'utf8'));
      const sp = PBP_EVENTS[lane];
      let got = '', gotPlain = '';
      try {
        const a = { day: 1, seg: seg, payer: payer, luck: 'p50', cal: CAL_NEW };
        got = pbpEventState_(sp, lane, { start: 1, dur: 2, days: [1, 2], variant: '2d' }, a, c, {}, 1).spec.cfg;
        gotPlain = pbpEventState_(sp, lane, { start: 1, dur: 3, days: [1, 2, 3] }, a, c, {}, 1).spec.cfg;
      } catch (e) { got = 'threw ' + e.message; }
      check('D73: the play-by-play view reads Ki_2d_v2 for a 2-day instance and Ki_v2 for a 3-day one', got === 'Ki_2d_v2' && gotPlain === sp.cfg, got + ' / ' + gotPlain);
    }
  }

  // ================================================================ D74: THE DAILY VIEW'S DATA DAYS
  console.log('\n================ D74: WHICH FEED DAY IS WINDOW DAY d ================');
  {
    const c = fresh(), off = c.window.offset, N = c.window.days, seg = '20-39', payer = 'PAYER';
    const snapB = data['data_econ_daily'], snapL = data['data_econ_daily_live'];
    // a synthetic feed whose HC gain on feed day k is 10 k, so a misalignment reads as a wrong number
    const feed = (withDow, dowOf) => {
      const hdr = ['segment', 'payer_flag', 'currency', 'day_index', 'gain_per_earner_day', 'spend_per_earner_day'].concat(withDow ? ['dow'] : []);
      const rows = [hdr];
      for (let k = 1; k <= 33; k++) rows.push([seg, payer, 'HC', k, 10 * k, 1].concat(withDow ? [DOW_NAMES[dowOf(k) - 1].slice(0, 3)] : []));
      return { values: rows, merges: [] };
    };
    const dataHC = () => { fresh(); const g = ECOGAINS_DAILY(payer, seg, 'ALL', 'DATA'); return g.map(r => r[0]); };
    // (1) a feed with no weekday column is the August pull: aligned to the grid
    delete data['data_econ_daily_live'];
    data['data_econ_daily'] = feed(false);
    const a = dataHC();
    // D78: such a feed starts the day BEFORE the grid's first column (the August pull, proven by
    // Rainbow Maker's instance days), so window day d reads feed day d + offset + 1
    check('D78: a feed with no weekday column starts the day before the grid - window day d reads feed day d + ' + (off + 1),
      a.length === N && a.slice(0, N - 1).every((x, i) => x === 10 * (i + 2 + off)), 'day 1 reads ' + a[0] + ', day ' + N + ' reads ' + a[N - 1]);
    // (2) a feed whose weekdays match the window: pulled from window day 1, no shift
    data['data_econ_daily'] = feed(true, k => windowDow_(k));
    const b = dataHC();
    check('D74: a feed whose weekdays match the window\'s is read day for day', b.every((x, i) => x === 10 * (i + 1)), 'day 1 reads ' + b[0]);
    // (3) a feed whose weekdays match the grid: shifted by the offset
    data['data_econ_daily'] = feed(true, k => windowDow_(k - off));
    const g3 = dataHC();
    check('D74: a feed whose weekdays match the grid\'s first column is shifted by the window offset',
      g3.every((x, i) => x === 10 * (i + 1 + off)), 'day 1 reads ' + g3[0]);
    // (3b) D78: weekdays that put feed day 1 the day before the grid's first column
    data['data_econ_daily'] = feed(true, k => windowDow_(k - off - 1));
    const g3b = dataHC();
    check('D78: a feed whose weekdays put its day 1 the day before the grid is shifted by the offset + 1',
      g3b.slice(0, N - 1).every((x, i) => x === 10 * (i + 2 + off)), 'day 1 reads ' + g3b[0]);
    // (4) a feed whose weekdays match none of the four starts is read day for day (and logged)
    if (off % 7) {
      data['data_econ_daily'] = feed(true, k => windowDow_(k - 3));
      const d4 = dataHC();
      check('D74: a feed whose weekdays match neither is read day for day', d4.every((x, i) => x === 10 * (i + 1)), 'day 1 reads ' + d4[0]);
    }
    // (5) the switch
    data['data_econ_daily'] = feed(false);
    DAILY_ECON_ALIGN = 'window'; const e5 = dataHC(); DAILY_ECON_ALIGN = 'auto';
    data['data_econ_daily'] = feed(false);
    DAILY_ECON_PULL_LEAD = 0; const e6 = dataHC(); DAILY_ECON_PULL_LEAD = 1;
    check('D78: DAILY_ECON_PULL_LEAD = 0 restores the D74a reading (feed day 1 = the grid\'s first column)', e6.every((x, i) => x === 10 * (i + 1 + off)), 'day 1 reads ' + e6[0]);
    check('D74: DAILY_ECON_ALIGN = \'window\' reads day for day whatever the feed', e5.every((x, i) => x === 10 * (i + 1)), 'day 1 reads ' + e5[0]);
    data['data_econ_daily'] = snapB;
    if (snapL === undefined) delete data['data_econ_daily_live']; else data['data_econ_daily_live'] = snapL;
    fresh();
  }

  // ================================================================ D74c: THE CARD SIM'S 33-ROW BLOCKS
  console.log('\n================ D74c: Col_Cards_Cloud UNDER A SHORTER WINDOW ================');
  {
    const c = fresh(), N = c.window.days;
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Col_Cards_Cloud');
    if (!sh) {
      check('D74c: no Col_Cards_Cloud on this dump - nothing to write', true);
    } else {
      const vals = sh.getDataRange().getValues();
      const rBands = findBlockRow_(vals, CLOUD_BAR_BANDS);
      const perms = cloudPermutations_();
      // a synthetic aggregate: every statistic of every metric reads its own day number
      const agg = perms.map(() => { const series = {};
        CLOUD_METRICS.forEach(m => { series[m.key] = []; for (let d = 0; d < N; d++) { const o = {}; CLOUD_STATS.forEach(st => { o[st] = d + 1; }); series[m.key].push(o); } });
        return { series }; });
      // junk in the rows past the window of every band block, as a previous 33-day run would leave
      perms.forEach((p, j) => { const r0 = rBands + 2 + j * CLOUD_BAND_STRIDE;
        for (let k = N; k < CLOUD_BLOCK_DAYS; k++) sh.getRange(r0 + 3 + k, 1, 1, SIM_BAND_W).setValues([new Array(SIM_BAND_W).fill(999)]); });
      writeCloudSheet_(sh, agg, 1, 1);
      let stale = 0, wrong = 0;
      perms.forEach((p, j) => { const r0 = rBands + 2 + j * CLOUD_BAND_STRIDE;
        for (let k = 0; k < CLOUD_BLOCK_DAYS; k++) {
          const row = sh.getRange(r0 + 3 + k, 1, 1, SIM_BAND_W).getValues()[0];
          if (k < N) { if (row[0] !== k + 1 || row[1] !== k + 1) wrong++; }
          else if (row.some(x => x !== '' && x != null)) stale++;
        } });
      check('D74c: every band block holds the window\'s ' + N + ' days and nothing below them (rows ' + (N + 1) + '..' + CLOUD_BLOCK_DAYS + ' blank)',
        stale === 0 && wrong === 0, wrong + ' wrong in-window rows, ' + stale + ' stale rows past day ' + N);
    }
    data = JSON.parse(RAW); fresh();
  }

  // ================================================================ D74d/e: THE CARD SIM'S PLAYERS
  console.log('\n================ D74d/e: ATTENDANCE UNDER A SHORTER WINDOW ================');
  {
    const c = fresh(), N = DAILY_DAYS, G33 = CAL_LAST_COL - CAL_FIRST_COL + 1;
    // (d) the measured active-day percentiles are a SHARE of the 33-day data window
    const seg = '20-39', payer = 'PAYER', b = c.ds.beh(seg, payer);
    const pts = activeDaysAnchors_(b, N);
    const keys = [['active_days_p25', .25], ['active_days_p50', .5], ['active_days_p75', .75], ['active_days_p90', .9], ['active_days_p95', .95], ['active_days_p98', .98]];
    let bad = 0;
    keys.forEach(([k, u]) => { const x = Number(b[k]); if (!(x > 0)) return;
      const p = pts.find(q => Math.abs(q[0] - u) < 1e-12); const want = Math.min(N, x * (N < G33 ? N / G33 : 1));
      if (!p || Math.abs(p[1] - want) > 1e-12) bad++; });
    check('D74d: active-day anchors are read as a share of the ' + G33 + '-day data window (x ' + (N < G33 ? (N / G33).toFixed(4) : '1') + ')', bad === 0, bad + ' anchors off');
    if (N < G33) {
      // the property it exists for: a cell whose measured p75 < p90 < 33 keeps p75 < p90 after the level correction
      const cv = attendanceCurve_(b, N), at = (u) => curveAt_(cv, u);
      const raw75 = Number(b.active_days_p75), raw90 = Number(b.active_days_p90);
      if (raw75 < raw90 && raw90 < G33)
        check('D74d: the top quarter keeps its spread under the ' + N + '-day window (p75 < p90 < p98)',
          at(0.75) < at(0.9) - 1e-6 && at(0.9) <= at(0.98) + 1e-9, 'p75 ' + at(0.75).toFixed(2) + ' p90 ' + at(0.9).toFixed(2) + ' p98 ' + at(0.98).toFixed(2));
    }
    // (e) a season with no active day opens no envelope, and no season has more pack days than active days
    const cfg = loadPackConfig_(), cat = loadCardCatalog_(cfg, SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ALBUM));
    let zero = 0, zeroPacks = 0, over = 0, runs = 300;
    [['100+', 'PAYER'], ['0-9', 'NONPAYER']].forEach(([sg, py]) => {
      const pre = cardSeasonPre_(sg, py, c, null);
      for (let i = 0; i < runs; i++) {
        const r = runOneCardSeason_(sg, py, 1000 + i, cfg, cat, pre);
        // GRANTED packs only: the end-of-season spend-down (user, 2026-09-09) converts leftover
        // stars into chests on the album's last day whether or not the player plays it - a rule,
        // not a leak - so chest rows are left out of this count
        const gd = {};
        // ...and, when the album closes BEFORE the window ends (33-day grids), its last day: D26
        // settles a straddler's late envelopes there in full whether or not the player plays it
        const settleDay = (SEASON_CUTOFF && SEASON_LAST_DAY < N) ? SEASON_LAST_DAY : -1;
        r.log.forEach(l => { if (String(l[1]).trim() && !/Chest Opened/.test(String(l[2])) && Number(l[0]) !== settleDay) gd[l[0]] = 1; });
        if (Object.keys(gd).length > r.activeDays) over++;
        if (!r.activeDays) { zero++; if (r.packsOpenedTotal > 0) zeroPacks++; }
      }
    });
    check('D74e: a season with no active day opens no envelope (no pass envelope without an in-album session)', zeroPacks === 0,
      zero + ' seasons with no active day of ' + (2 * runs) + ', ' + zeroPacks + ' opened envelopes');
    check('D74e: no season has more days with a GRANTED pack than days played (spend-down chests and the D26 settle day aside)', over === 0, over + ' seasons over');
    fresh();
  }

  // ================================================================ D75: THE CLAIM PACE, STRETCHED
  console.log('\n================ D75: data_rm_pace AT A LENGTH THE PULL DOES NOT CARRY ================');
  {
    const c0 = fresh(), N = c0.window.days, seg = '20-39', payer = 'PAYER', pct = c0.ds.rmPct(seg, payer);
    // what the workbook's own sheet does for this calendar's cut-offs
    rmSortedInsts_(c0.calNew).forEach(inst => {
      const cfg = rmConfigForInst_(inst), cut = rmCutoff_(inst, cfg, 1, N, rmCalLen_(c0.calNew, cfg));
      if (!cut) return;
      const p = rmClaimPace_(seg, payer, cut.L);
      console.log('  cal_new ' + cut.side + ' cut-off days ' + inst.start + '..' + (inst.start + inst.dur - 1) + ' (' + cut.k + ' of ' + cut.L + '): pace = ' +
        (p ? 'data_rm_pace' + (p.stretchedFrom ? ', the ' + p.stretchedFrom + '-date curve stretched' : ' at ' + p.L + ' dates') : 'matchables curve (no data_rm_pace for this cell)'));
    });
    const snap = data['data_rm_pace'];
    const hdr = ['segment', 'payer_flag', 'instance_length_days', 'instance_day', 'resource', 'cum_pooled_share', 'status'];
    const curve5 = [0.25, 0.5, 0.7, 0.95, 1];
    const rows = [hdr];
    curve5.forEach((x, i) => rows.push([seg, payer, 5, i + 1, 'ALL', x, 'MEASURED']));
    data['data_rm_pace'] = { values: rows, merges: [] };
    const c1 = fresh();
    // (1) day t of an L-day instance = date t x 4 / L of the 5-date (4-day) curve
    const p2 = rmClaimPace_(seg, payer, 2);
    check('D75: a 2-day instance with only the 4-day (5-date) curve reads it stretched - its day 1 is date 2',
      !!p2 && p2.stretchedFrom === 5 && Math.abs(p2.share('ALL', 1) - 0.5) < 1e-12, p2 ? 'share ' + p2.share('ALL', 1) : 'none');
    const p3 = rmClaimPace_(seg, payer, 3);
    check('D75: fractional dates interpolate (3-day instance, day 1 = date 4/3)',
      !!p3 && Math.abs(p3.share('ALL', 1) - (0.25 + 0.25 / 3)) < 1e-12 && p3.share('ALL', 3) === 1, p3 ? String(p3.share('ALL', 1)) : 'none');
    // (2) a cut-off prices off it: an end cut-off of 1 of 2 days claims S_full x the stretched share
    const cfg = rmConfigForInst_(mkInst_(N, 1)), geo = { Dm: rmMatchDays_(c1, cfg), Lcal: 2 };
    const Pe = rmRungP_(mkInst_(N, 1), cfg, pct, seg, payer, c1.ds, 1, N, geo);
    const Ps = rmRungP_(mkInst_(1, 1), cfg, pct, seg, payer, c1.ds, 1, N, geo);
    const Pf = rmRungP_(mkInst_(5, 2), cfg, pct, seg, payer, c1.ds, 1, N, geo);
    let worst = 0;
    cfg.ladder.forEach(ms => { worst = Math.max(worst, Math.abs(Pe(ms.req, 'HC') - 0.5 * Pf(ms.req, 'HC')), Math.abs(Ps(ms.req, 'HC') - 0.5 * Pf(ms.req, 'HC'))); });
    check('D75: both 1-of-2-day cut-offs price at S_full x the stretched claim share (0.5 here), rung by rung', worst < 1e-12, 'max err ' + worst.toExponential(2));
    // (3) the switch
    RM_PACE_STRETCH = false; fresh();
    check('D75: RM_PACE_STRETCH = false -> a length the pull does not carry has no pace (the matchables curve takes over)', rmClaimPace_(seg, payer, 2) === null);
    RM_PACE_STRETCH = true;
    // (4) a carried length always wins over a stretch
    [0.6, 0.9, 1].forEach((x, i) => rows.push([seg, payer, 3, i + 1, 'ALL', x, 'MEASURED']));
    data['data_rm_pace'] = { values: rows, merges: [] };
    fresh();
    const pE = rmClaimPace_(seg, payer, 2);
    check('D75: when the pull carries the instance length (3 dates for a 2-day event) it is read as is, never stretched',
      !!pE && pE.L === 3 && !pE.stretchedFrom && pE.share('ALL', 1) === 0.6, pE ? 'L ' + pE.L + ' day 1 ' + pE.share('ALL', 1) : 'none');
    if (snap === undefined) delete data['data_rm_pace']; else data['data_rm_pace'] = snap;
    fresh();
  }

  // ================================================================ D76: THE LIVE FEED BY DATE
  console.log('\n================ D76: A DATE ABOVE DAY 1 ALIGNS A FEED THAT CARRIES calendar_date ================');
  {
    const c = fresh(), N = c.window.days, col1 = c.window.col1, seg = '20-39', payer = 'PAYER';
    const snapB = data['data_econ_daily'], snapL = data['data_econ_daily_live'], snapC = JSON.stringify(data['cal_new'].values[0]);
    // a 14-day feed from Tue 2026-10-13 whose HC gain on feed day k is 10 k (dates and weekdays real)
    const feed = () => {
      const hdr = ['segment', 'payer_flag', 'currency', 'day_index', 'calendar_date', 'dow', 'gain_per_earner_day', 'spend_per_earner_day'];
      const rows = [hdr];
      for (let k = 1; k <= 14; k++) { const dt = new Date(Date.UTC(2026, 9, 12 + k));
        rows.push([seg, payer, 'HC', k, dt.toISOString().slice(0, 10) + ' 00:00:00', ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()], 10 * k, 1]); }
      return { values: rows, merges: [] };
    };
    const dataHC = () => { fresh(); return ECOGAINS_DAILY(payer, seg, 'ALL', 'DATA').map(r => r[0]); };
    data['data_econ_daily_live'] = feed();
    // (1) window day 1 = Mon 2026-10-19 = feed day 7, typed as a date string above day 1
    data['cal_new'].values[0][col1 - 1] = '2026-10-19';
    const a = dataHC();
    check('D76: a date above day 1 aligns the feed by calendar_date - window day 1 (2026-10-19) reads feed day 7, and the days past the pull are blank',
      a[0] === 70 && a[7] === 140 && a.slice(8).every(x => x === ''), 'day 1 ' + a[0] + ', day 8 ' + a[7] + ', day 9 ' + JSON.stringify(a[8]));
    // (2) the same date as a real Date object (how Apps Script returns a date cell)
    data['cal_new'].values[0][col1 - 1] = new Date(2026, 9, 19);
    const b = dataHC();
    check('D76: a Date cell reads the same as a typed date', b[0] === 70, 'day 1 ' + b[0]);
    // (3) a window day 1 BEFORE the feed starts: that day is blank, not 0
    data['cal_new'].values[0][col1 - 1] = '2026-10-12';
    const e = dataHC();
    check('D76: window days before the feed starts are blank (2026-10-12 -> day 1 blank, day 2 = feed day 1)',
      e[0] === '' && e[1] === 10, 'day 1 ' + JSON.stringify(e[0]) + ', day 2 ' + e[1]);
    // (4) a feed with no calendar_date ignores the date (the D74/D78 weekday rule decides): a date a
    //     week later than the weekdays imply makes the difference visible
    data['cal_new'].values[0][col1 - 1] = '2026-10-26';
    const f0 = dataHC();
    const nd = feed(); nd.values = nd.values.map(r => r.filter((x, i) => i !== 4));
    data['data_econ_daily_live'] = nd;
    const f = dataHC();
    check('D76: a feed without calendar_date is not aligned by the date (with it: day 1 = 2026-10-26 = feed day 14)',
      f0[0] === 140 && f[0] !== 140, 'with calendar_date ' + f0[0] + ', without ' + f[0]);
    // (5) no date typed -> unchanged from D74 (the live feed reads day for day when its weekdays fit neither rule)
    data['data_econ_daily_live'] = feed();
    data['cal_new'].values[0] = JSON.parse(snapC);
    const g = dataHC();
    const sh = econShift_(data['data_econ_daily_live'].values, headerIndex_(data['data_econ_daily_live'].values[0]));
    check('D76: no date above day 1 -> the D74 rule, unchanged (shift ' + sh + ')', g[0] === 10 * (1 + sh), 'day 1 ' + g[0]);
    // (6) the switch
    data['cal_new'].values[0][col1 - 1] = '2026-10-19';
    DAILY_ECON_ALIGN = 'window'; const w = dataHC(); DAILY_ECON_ALIGN = 'auto';
    check("D76: DAILY_ECON_ALIGN = 'window' reads day for day even with a date", w[0] === 10, 'day 1 ' + w[0]);
    data['cal_new'].values[0] = JSON.parse(snapC);
    data['data_econ_daily'] = snapB;
    if (snapL === undefined) delete data['data_econ_daily_live']; else data['data_econ_daily_live'] = snapL;
    fresh();
  }

  // ================================================================ D77: RM ON THE LIVE MATCHABLES
  console.log('\n================ D77: RAINBOW MAKER ON THE LIVE MATCHABLES DISTRIBUTION ================');
  {
    const c0 = fresh(), N = c0.window.days, seg = '20-39', payer = 'PAYER';
    const realLive = rmLive_(seg, payer);
    console.log('  this dump carries the live matchables: ' + (realLive ? 'yes (' + realLive.Ls + ' dates, claim factor ' + realLive.kappa.toFixed(3) + ')' : 'no - pre-D77 pricing'));
    if (realLive) {
      // the real data: modelled vs measured milestones at the end of each date, every cell
      const base = rmConfigByName_(RM_HALF_SHEETS[0], true).ladder;
      let worst = 0, at = '';
      ['NONPAYER', 'PAYER'].forEach(p => ['0-9', '10-19', '20-39', '40-99', '100+'].forEach(sg => {
        const L = rmLive_(sg, p); if (!L) return;
        const q = L.at(L.Ls - 1, L.Ls - 1), S = rmLiveSurv_(q), ms = L.kappa * base.reduce((a, m) => a + S(m.req), 0);
        const gap = Math.abs(ms - q.ms); if (gap > worst) { worst = gap; at = sg + ' ' + p + ' ' + ms.toFixed(2) + ' vs ' + q.ms.toFixed(2); }
      }));
      check('D77: on the real pull, the calibrated live distribution reproduces the measured milestones at the end of the event in every cell', worst < 1e-9, 'worst ' + worst.toExponential(2) + (at ? ' (' + at + ')' : ''));
    }
    // ---- rule fixtures on a synthetic pull (any dump)
    const snap = data['data_rm_pace'];
    const hdr = ['segment', 'payer_flag', 'instance_length_days', 'instance_day', 'resource', 'cum_pooled_share',
                 'cum_milestones_claimed_mean', 'cum_matchables_mean', 'cum_matchables_p25', 'cum_matchables_p50', 'cum_matchables_p75', 'status'];
    const rows = [hdr];
    const D = [[0, 4000, 12000, 10000], [5000, 15000, 30000, 20000], [10000, 24000, 42000, 29000], [15000, 30000, 52000, 38000], [16000, 31000, 53000, 39000]];
    D.forEach((q, i) => rows.push([seg, payer, 5, i + 1, 'ALL', [0.3, 0.55, 0.75, 0.96, 1][i], 0, q[3], q[0], q[1], q[2], 'MEASURED']));
    data['data_rm_pace'] = { values: rows, merges: [] };
    let c = fresh();
    const base = rmConfigByName_(RM_HALF_SHEETS[0], true).ladder;
    const S5 = rmLiveSurv_({ p25: 16000, p50: 31000, p75: 53000, mean: 39000 });
    const modelMs = base.reduce((a, m) => a + S5(m.req), 0);
    // claim factor: set the measured milestones to 80% of the modelled ones
    rows.slice(1).forEach(r => { r[6] = 0.8 * modelMs; });
    data['data_rm_pace'] = { values: rows, merges: [] };
    c = fresh();
    const L = rmLive_(seg, payer);
    check('D77: the claim factor is measured / modelled milestones at the end of the event (0.8 here)', !!L && Math.abs(L.kappa - 0.8) < 1e-12, L ? String(L.kappa) : 'none');
    // (1) the date an instance reads
    check('D77: a 4-day instance reads the final date (5: the closing hours), a 2-day one date 2, a 1-day one date 1',
      L.at(4, 4).p50 === 31000 && L.at(2, 2).p50 === 15000 && L.at(1, 1).p50 === 4000 && L.at(0, 2) === null && L.at(3, 4).p50 === 24000);
    // (2) the survival: mean-matched top, and a zero p25 is a block at zero
    const S1 = rmLiveSurv_({ p25: 0, p50: 4000, p75: 12000, mean: 10000 });
    check('D77: a zero p25 means a quarter of participants have nothing yet (S just above 0 is 0.75)', Math.abs(S1(1e-6) - 0.75) < 1e-6, String(S1(1e-6)));
    const top = 8 * 39000 - 2 * (16000 + 31000 + 53000);
    check('D77: the tail ends where the distribution mean equals the measured mean (top ' + top + ')', S5(top - 1) > 0 && S5(top + 1) === 0, S5(top - 1) + ' / ' + S5(top + 1));
    // (3) pricing: interior / end cut-off / start cut-off, and the partition
    const cfg = rmConfigForInst_(mkInst_(5, 2)), geo = { Dm: 4, Lcal: 2 };
    const Pi = rmRungP_(mkInst_(5, 2), cfg, c.ds.rmPct(seg, payer), seg, payer, c.ds, 1, N, geo);
    const Pe = rmRungP_(mkInst_(N, 1), cfg, c.ds.rmPct(seg, payer), seg, payer, c.ds, 1, N, geo);
    const Ps = rmRungP_(mkInst_(1, 1), cfg, c.ds.rmPct(seg, payer), seg, payer, c.ds, 1, N, geo);
    const S2 = rmLiveSurv_({ p25: 5000, p50: 15000, p75: 30000, mean: 20000 }), S1b = rmLiveSurv_({ p25: 0, p50: 4000, p75: 12000, mean: 10000 });
    let e1 = 0, e2 = 0;
    cfg.ladder.forEach(m => { e1 = Math.max(e1, Math.abs(Pi(m.req) - 0.8 * S2(m.req)), Math.abs(Pe(m.req) - 0.8 * S1b(m.req)));
                              e2 = Math.max(e2, Math.abs(Pe(m.req) + Ps(m.req) - Pi(m.req))); });
    check('D77: a 2-day instance prices at the claim factor x the date-2 distribution, its first day alone at date 1', e1 < 1e-12, 'max err ' + e1.toExponential(2));
    check('D77: end cut-off (first day) + start cut-off (last day) = the whole 2-day instance, rung by rung', e2 < 1e-12, 'max err ' + e2.toExponential(2));
    // (4) the play-by-play quantile
    check('D77: the play-by-play luck reads the live quantile (p50 of the date-2 distribution = 15000)', Math.abs(rmLiveQuantile_(L.at(2, 2), 0.5) - 15000) < 1e-9);
    // (5) the switch
    RM_LIVE_MATCHABLES = false; const cOff = fresh();
    const Poff = rmRungP_(mkInst_(5, 2), cfg, cOff.ds.rmPct(seg, payer), seg, payer, cOff.ds, 1, N, geo);
    RM_LIVE_MATCHABLES = true;
    check('D77: RM_LIVE_MATCHABLES = false prices on data_RM again', rmLive_(seg, payer) !== null && (Poff === null || cfg.ladder.some(m => Math.abs(Poff(m.req) - Pi(m.req)) > 1e-9)));
    // (6) a pull without the matchables columns is read the pre-D77 way
    data['data_rm_pace'] = { values: rows.map(r => r.slice(0, 7).concat([r[11]])), merges: [] };
    fresh();
    check('D77: a data_rm_pace without the matchables columns leaves the live path off', rmLive_(seg, payer) === null);
    if (snap === undefined) delete data['data_rm_pace']; else data['data_rm_pace'] = snap;
    fresh();
  }
}

eval(PRELUDE + '\n(' + GATES.toString() + ')();\n' + `
console.log('');
console.log(failures ? (failures + ' CHECK(S) FAILED') : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
`);
