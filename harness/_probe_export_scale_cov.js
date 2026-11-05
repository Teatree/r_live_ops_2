// What the per-event export scale does on a dump whose by-source feed is shorter than the export
// (LIVE_OPS_V3 (20): feed to Nov 1, data_gains to Nov 3): rebuilds the export_scale table from the feed
// in memory (the menu run's own function) and prints, per source x coins, the scale used and why.
//
//   node harness/_probe_export_scale_cov.js [--data v3p] [--asis]     (--asis: the table as the dump carries it)
const fs = require('fs');
const path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3p');
const ASIS = process.argv.indexOf('--asis') >= 0;
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const _log = console.log; console.log = () => {};
function PROBE() {
  const say = global.__say;
  if (!global.__asis) {
    const grid = exportScaleGrid_(Context.get());
    if (!grid) { say('no grid: the dump has no usable feed or no span'); return; }
    data['export_scale'] = { values: grid, merges: [] };
    resetSheetCache_mock();
  }
  const ctx = Context.get(), tab = exportScaleTab_();
  say('span ' + JSON.stringify(ctx.dataSpan) + '  table days ' + tab.first + '..' + tab.last + '  feed days ' + tab.feedFirst + '..' + tab.feedLast);
  const rep = exportScaleReport_(ctx);
  say(rep[0].join(' | '));
  rep.slice(1).filter(r => r[1] === 'HC' || r[1] === 'SPT').forEach(r => say(r.map(x => (typeof x === 'number') ? Math.round(x * 1000) / 1000 : x).join(' | ')));
  const n = rep.slice(1).filter(r => r[2] === 'per event').length;
  say(n + ' of ' + (rep.length - 1) + ' source x resource amounts scaled per event');
}
global.__say = _log; global.__asis = ASIS;
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
