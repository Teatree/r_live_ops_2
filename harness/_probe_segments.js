// Per-block totals of the change summary's own numbers (CURRENT / NEW per player, VALUE and a few
// resources) for one dump, so two engines or two segment sets can be compared block by block.
//
//   node harness/_probe_segments.js --data v3p [--out f.json] [--engine-dir <dir>] [--quiet] [--asis]
//
// Uses ChangeSummary.gs's own functions (csPopulation_, csCellRows_, csBlocks_), so what it prints is
// what Fill change summary would write on the TOTAL rows. Like that fill, it first rebuilds the per-event
// export scale from the dump's own feed (a dump's export_scale sheet can be from an older pull, and a
// table over other days is ignored: every source then falls back to the activity scale). --asis keeps
// the dump's table.
const fs = require('fs');
const path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3p');
const di = process.argv.indexOf('--engine-dir');
const engineDir = di >= 0 ? path.resolve(process.argv[di + 1]) : path.join(__dirname, '..', 'engine');
const oi = process.argv.indexOf('--out');
const outFile = oi >= 0 ? process.argv[oi + 1] : null;
const QUIET = process.argv.indexOf('--quiet') >= 0;

const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
let PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
PRELUDE = PRELUDE.replace("const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);",
                          'const ENGINE = (f) => path.join(' + JSON.stringify(engineDir) + ', f);');
if (PRELUDE.indexOf(JSON.stringify(engineDir)) < 0) throw new Error('_mock_cards.js ENGINE line moved - fix the probe');
if (QUIET) { const _log = console.log; console.log = () => {}; global.__say = _log; } else global.__say = console.log;

function PROBE() {
  eval(fs.readFileSync(ENGINE('SimPerSegmentFill.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('ChangeSummary.gs'), 'utf8'));
  const say = global.__say;
  if (process.argv.indexOf('--asis') < 0 && typeof exportScaleGrid_ === 'function'){
    const g = exportScaleGrid_(Context.get());
    if (g){ data['export_scale'] = { values: g, merges: [] }; resetSheetCache_mock(); }
  }
  const ctx = Context.get();
  const prices = csPrices_(), extras = csExportOnlyCats_(), cats = CATEGORY_ORDER.concat(extras);
  const popInfo = csPopulation_(ctx);
  const cells = csCellRows_(ctx, extras, popInfo);
  const blocks = csBlocks_(cells, cats, prices);
  const RES = ['HC', 'SPT', 'Unlimited Lives', 'Red', '2-star Pack', 'ToF_Ticket'];
  const out = { build: ENGINE_BUILD, window: ctx.window && ctx.window.days, span: ctx.dataSpan, blocks: {} };
  say('engine ' + ENGINE_BUILD + '  window ' + out.window + ' days  span ' + JSON.stringify(ctx.dataSpan) + '  perPlayer ' + popInfo.perPlayer);
  say(['block', 'players', 'VALUE cur', 'VALUE new', 'd%'].concat(RES.map(r => r + ' cur|new|d%')).join('\t'));
  blocks.forEach(b => {
    const tot = { cur: { VALUE: 0 }, nw: { VALUE: 0 } }, bySrc = {};
    RESOURCES.forEach(r => { tot.cur[r] = 0; tot.nw[r] = 0; });
    cats.forEach(cat => {
      const row = b.rows[cat];
      bySrc[cat] = { cur: csValue_(row.cur, prices), nw: csValue_(row.nw, prices), curHC: num(row.cur.HC), nwHC: num(row.nw.HC),
                     curSPT: num(row.cur.SPT), nwSPT: num(row.nw.SPT) };
      tot.cur.VALUE += bySrc[cat].cur; tot.nw.VALUE += bySrc[cat].nw;
      RESOURCES.forEach(r => { tot.cur[r] += num(row.cur[r]); tot.nw[r] += num(row.nw[r]); });
    });
    const key = b.seg + ' | ' + b.payer;
    out.blocks[key] = { pop: b.pop, cells: b.cells, tot: tot, bySrc: bySrc };
    const pc = (c, n) => (Math.abs(c) < 1e-12) ? (Math.abs(n) < 1e-12 ? '' : 'new') : (100 * (n / c - 1)).toFixed(1) + '%';
    say([key, Math.round(b.pop), tot.cur.VALUE.toFixed(0), tot.nw.VALUE.toFixed(0), pc(tot.cur.VALUE, tot.nw.VALUE)]
        .concat(RES.map(r => tot.cur[r].toFixed(1) + '|' + tot.nw[r].toFixed(1) + '|' + pc(tot.cur[r], tot.nw[r]))).join('\t'));
  });
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
