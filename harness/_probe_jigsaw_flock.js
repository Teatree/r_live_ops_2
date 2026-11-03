// LIVE_OPS_V3 (18) questions (2026-11-03): why Flock Flurry moves with no config change, and why
// EcoGainsSim_so_far shows Jigsaw Unlimited Red going UP while change_summary shows it going down.
//
//   node harness/_probe_jigsaw_flock.js [--data v3n]
//
// Prints both calendars' Jigsaw / Flock Flurry instances in window days, the 7-day ("so far") window,
// and per cell the CURRENT / NEW / DIFF of the three Unlimited-booster resources over the whole window
// and over the 7-day window, with the per-instance pieces that make them up (measured per instance x R).
// Reuses _mock_cards.js's SpreadsheetApp mock and engine loader, like the other probes.
const fs = require('fs');
const path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3n');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const W7 = fs.readFileSync(path.join(__dirname, '..', 'engine', 'EcoGainsSim_7Day.gs'), 'utf8');

function PROBE() {
  const CELLS = [['0-9', 'NONPAYER'], ['10-19', 'NONPAYER'], ['20-39', 'NONPAYER'], ['40-99', 'NONPAYER'], ['100+', 'NONPAYER'],
                 ['0-9', 'PAYER'], ['10-19', 'PAYER'], ['20-39', 'PAYER'], ['40-99', 'PAYER'], ['100+', 'PAYER']];
  _sheetValsCache = {}; Context.reset();
  const ctx = Context.get();
  const w7 = win7Bounds_();
  console.log('\nwindow: ' + ctx.window.days + ' days; 7-day ("so far") window: days ' + w7.a + '..' + w7.b);
  const show = (lane) => {
    const f = (l) => (l || []).map(i => i.start + (i.dur > 1 ? '..' + (i.start + i.dur - 1) : '')).join(', ') || '(none)';
    console.log('\n' + lane);
    console.log('   cal_curr in window: ' + f(ctx.calCur[lane]));
    console.log('   cal_new  in window: ' + f(ctx.calNew[lane]));
    const inW7 = (l) => (l || []).filter(i => i.days.some(d => d >= w7.a && d <= w7.b)).length;
    console.log('   instances touching days ' + w7.a + '..' + w7.b + ': cal_curr ' + inW7(ctx.calCur[lane]) + ', cal_new ' + inW7(ctx.calNew[lane]));
  };
  show('Jigsaw Puzzle'); show('Flock Flurry');
  const RES = ['UL Red', 'UL Chuck', 'UL Bomb', 'Unlimited Lives', 'HC', 'SPT', '2-star Pack'];
  const f2 = (x) => (Math.abs(x) < 5e-5 ? '0' : x.toFixed(3)).padStart(9);
  ['Jigsaw', 'Flock Flurry'].forEach(cat => {
    console.log('\n==== ' + cat + '   (whole window | 7-day window)   CURRENT -> NEW (DIFF)');
    CELLS.forEach(([seg, payer]) => {
      const m = measuredRow_(cat, seg, payer, ctx.ds), s = resultRow_(cat, seg, payer, ctx);
      const m7 = win7Row_(cat, seg, payer, ctx, false), s7 = win7Row_(cat, seg, payer, ctx, true);
      const line = RES.filter(r => num(m[r]) || num(s[r]) || num(m7[r]) || num(s7[r])).map(r =>
        r + ': ' + f2(num(m[r])) + ' ->' + f2(num(s[r])) + ' |' + f2(num(m7[r])) + ' ->' + f2(num(s7[r])) + ' (' + (num(s7[r]) - num(m7[r]) >= 0 ? '+' : '') + (num(s7[r]) - num(m7[r])).toFixed(3) + ')');
      console.log('  ' + (seg + ' ' + payer).padEnd(16) + line.join('\n' + ' '.repeat(18)));
    });
  });
  // the ratio R per resource for Jigsaw: E_v2 / E_base, each the ladder priced on the survival over the measured
  // final balances (the v2 side on the paced balance, D81). E_base = 0 -> no R -> the resource is CARRIED x T: at 0-9
  // the linear survival tail ends near 1.5 x p75, below milestone 6, so UL Bomb / HC / the big UL grants carry there.
  console.log('\nJigsaw E_base / E_v2 / R per resource (R missing = carried x T)');
  [['0-9', 'NONPAYER'], ['10-19', 'NONPAYER'], ['20-39', 'PAYER'], ['100+', 'PAYER']].forEach(([seg, payer]) => {
    const inst = ctx.ds.eventInst('Jigsaw', seg, payer), pace = collPace_('Jigsaw', seg, payer, ctx);
    const E = rewardE_('Jigsaw', seg, payer, ctx.ds, null, pace);
    console.log('  ' + (seg + ' ' + payer).padEnd(16) + 'final_balance p25/50/75 ' + [inst.final_balance_p25, inst.final_balance_p50, inst.final_balance_p75].map(x => num(x).toFixed(0)).join(' / ') + '   pace ' + pace);
    ['UL Red', 'UL Chuck', 'UL Bomb', 'Unlimited Lives', 'HC'].forEach(r => console.log('      ' + r.padEnd(16) + ' E_base ' + num(E.eBase[r]).toFixed(3).padStart(8) +
      '   E_v2 ' + num(E.eV2[r]).toFixed(3).padStart(8) + '   R ' + (num(E.eBase[r]) > 1e-9 ? (num(E.eV2[r]) / num(E.eBase[r])).toFixed(3) : 'none -> carried x T')));
  });
}

eval(PRELUDE + '\n' + W7 + '\n(' + PROBE.toString() + ')();\n');
