// D107 evidence: the Night Sky row per cell (measured / simulated, HC + 4 resources) and the base / redesign
// chance of every round, for one engine copy - run it on two engines to see what data_ns_per_day_reach moved.
//   node harness/_probe_ns_perday.js [--data v3y] [--engine-dir <dir>] [--json out.json]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3y');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
let PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const di = process.argv.indexOf('--engine-dir');
if (di >= 0){
  const ed = path.resolve(process.argv[di + 1]);
  PRELUDE = PRELUDE.replace("const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);", 'const ENGINE = (f) => path.join(' + JSON.stringify(ed) + ', f);');
  if (PRELUDE.indexOf(JSON.stringify(ed)) < 0) throw new Error('_mock_cards.js ENGINE line moved - fix the probe');
}
const _log = console.log; console.log = () => {}; global.__say = _log;

function PROBE(){
  const say = global.__say;
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const ctx = Context.get(), ds = ctx.ds, CAT = 'Daily Night Sky Prize';
  const RES = ['HC', 'Unlimited Lives', 'Red', '2-star Pack', '3-star Pack'];
  const out = { engine: ENGINE_BUILD, cells: {} };
  say('engine ' + ENGINE_BUILD + '   data: ' + (data._meta ? data._meta.source : '?'));
  say('cell                 ' + RES.map(r => ('meas ' + r).slice(0, 14).padStart(14) + ('sim ' + r).slice(0, 14).padStart(14)).join(''));
  segMembers_(ds).forEach(seg => ['NONPAYER', 'PAYER'].forEach(payer => {
    const m = measuredRow_(CAT, seg, payer, ds), s = resultRow_(CAT, seg, payer, ctx);
    const E = nsE_(seg, payer, ds, ctx), L = E && E.ladders;
    out.cells[seg + '|' + payer] = { meas: m, sim: s, pbWe: L && L.pbWe, pbWd: L && L.pbWd, pvWe: L && L.pvWe, pvWd: L && L.pvWd };
    say((seg + ' ' + payer).padEnd(21) + RES.map(r => num(m[r]).toFixed(2).padStart(14) + num(s[r]).toFixed(2).padStart(14)).join(''));
  }));
  say('\nround chances (weekend | weekday), base -> redesign:');
  Object.keys(out.cells).filter(k => /NONPAYER/.test(k)).forEach(k => {
    const c = out.cells[k], f = (a) => (a || []).map(x => (100 * num(x)).toFixed(1)).join(' ');
    say('  ' + k.padEnd(20) + ' base ' + f(c.pbWe) + ' | ' + f(c.pbWd) + '   new ' + f(c.pvWe) + ' | ' + f(c.pvWd));
  });
  if (arg('--json', null)) fs.writeFileSync(arg('--json'), JSON.stringify(out));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
