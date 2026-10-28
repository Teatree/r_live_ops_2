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
}

eval(PRELUDE + '\n(' + GATES.toString() + ')();\n' + `
console.log('');
console.log(failures ? (failures + ' CHECK(S) FAILED') : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
`);
