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
}

eval(PRELUDE + '\n(' + GATES.toString() + ')();\n' + `
console.log('');
console.log(failures ? (failures + ' CHECK(S) FAILED') : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
`);
