// D108 evidence: Hatchling Hideaway per segment block - for every cell, the ladder each side reads (gate requirements in
// cumulative tokens, coins per gate), E on both sides and the Hatchling row (measured / simulated, coins + value).
//   node harness/_probe_hh_blocks.js [--data v3z] [--engine-dir <dir>]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3z');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
let PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const di = process.argv.indexOf('--engine-dir');
if (di >= 0){
  const ed = path.resolve(process.argv[di + 1]);
  PRELUDE = PRELUDE.replace("const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);", 'const ENGINE = (f) => path.join(' + JSON.stringify(ed) + ', f);');
}
const _log = console.log; console.log = () => {}; global.__say = _log;

function PROBE(){
  const say = global.__say, CAT = 'Hatchling Hideaway';
  const ctx = Context.get(), ds = ctx.ds, coll = COLL_R_SPECS[CAT];
  say('engine ' + ENGINE_BUILD + '   data: ' + (data._meta ? data._meta.source : '?'));
  const blocks = typeof collHasBlocks_ === 'function';
  say('blocks: HH ' + (blocks && collHasBlocks_('HH')) + ', HH_v2 ' + (blocks && collHasBlocks_('HH_v2')));
  segMembers_(ds).concat(['ALL']).forEach(seg => ['NONPAYER', 'PAYER'].forEach(p => {
    const E = rewardE_(CAT, seg, p, ds), m = measuredRow_(CAT, seg, p, ds), s = resultRow_(CAT, seg, p, ctx);
    const lb = blocks ? collBlockLadder_('HH', coll, seg, 'HH_v2') : null, lv = blocks ? collBlockLadder_('HH_v2', coll, seg, 'HH') : null;
    const f = (l) => l ? l.reqs.map((q, i) => q.toFixed(1) + ':' + num(l.rews[i].HC)).join(' ') : '-';
    say((seg + ' ' + p).padEnd(18) + ' base [' + f(lb) + ']  v2 [' + f(lv) + ']');
    say(''.padEnd(18) + ' E coins ' + (E ? num(E.eBase.HC).toFixed(2) + ' -> ' + num(E.eV2.HC).toFixed(2) : 'n/a') +
        '   row coins ' + num(m.HC).toFixed(2) + ' -> ' + num(s.HC).toFixed(2) + '   UL ' + num(m['Unlimited Lives']).toFixed(1) + ' -> ' + num(s['Unlimited Lives']).toFixed(1));
  }));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
