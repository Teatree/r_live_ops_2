// The ALL segment against the weighted mean of the member segments it replaced on change_summary (D94):
// per source, VALUE per player (item_vals), CURRENT and NEW, over all players.
//
//   node harness/_probe_all_vs_merged.js [--data v3p] [--res HC]     (--res: one resource instead of VALUE)
const fs = require('fs');
const path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3p');
const ri = process.argv.indexOf('--res');
global.__res = ri >= 0 ? process.argv[ri + 1] : null;
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const _log = console.log; console.log = () => {}; global.__say = _log;
function PROBE() {
  eval(fs.readFileSync(ENGINE('SimPerSegmentFill.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('ChangeSummary.gs'), 'utf8'));
  const say = global.__say, RES = global.__res;
  // the per-event export scale table, rebuilt from this dump's feed as Fill change summary does
  { const g = exportScaleGrid_(Context.get()); if (g) { data['export_scale'] = { values: g, merges: [] }; resetSheetCache_mock(); } }
  const ctx = Context.get();
  const prices = csPrices_(), extras = csExportOnlyCats_(), cats = CATEGORY_ORDER.concat(extras);
  const popInfo = csPopulation_(ctx), cells = csCellRows_(ctx, extras, popInfo);
  const A = csBlocks_(cells, cats, prices, ctx), M = csBlocks_(cells, cats, prices, ctx, true);
  const val = (row) => RES ? num(row[RES]) : csValue_(row, prices);
  ['All', 'NONPAYER', 'PAYER'].forEach(payer => {
    const a = A.filter(b => b.seg === 'ALL' && b.payer === payer)[0], m = M.filter(b => b.seg === 'All' && b.payer === payer)[0];
    if (!a || !m) { say('no ALL segment in this dump'); return; }
    say('\n== ' + payer + ' payers (' + Math.round(a.pop) + ' players)   ' + (RES || 'VALUE') + ' per player:  ALL segment  |  weighted mean of the segments');
    say(['source', 'cur ALL', 'new ALL', 'd%', 'cur merged', 'new merged', 'd%', 'cur ALL/merged', 'new ALL/merged'].join('\t'));
    const tot = [0, 0, 0, 0], rows = [];
    cats.forEach(c => {
      const x = [val(a.rows[c].cur), val(a.rows[c].nw), val(m.rows[c].cur), val(m.rows[c].nw)];
      x.forEach((v, i) => { tot[i] += v; });
      rows.push([c].concat(x));
    });
    const pc = (c, n) => Math.abs(c) < 1e-9 ? '' : (100 * (n / c - 1)).toFixed(1) + '%';
    const rt = (x, y) => Math.abs(y) < 1e-9 ? '' : (x / y).toFixed(3);
    const line = (r) => [r[0], r[1].toFixed(1), r[2].toFixed(1), pc(r[1], r[2]), r[3].toFixed(1), r[4].toFixed(1), pc(r[3], r[4]), rt(r[1], r[3]), rt(r[2], r[4])].join('\t');
    say(line(['TOTAL'].concat(tot)));
    rows.sort((x, y) => y[1] - x[1]).forEach(r => { if (Math.abs(r[1]) + Math.abs(r[3]) > 1e-6) say(line(r)); });
  });
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
