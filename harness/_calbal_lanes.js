// Per lane x resource: population-weighted SIM in reference files (all payers pooled, and NONPAYER/PAYER).
// node harness/_calbal_lanes.js ref.json a.json [b.json ...] [--payer PAYER] [--min 0.05]
const fs = require('fs'); const { summarize, RES } = require('./_calbal_sum.js');
const args = process.argv.slice(2), files = args.filter(x => x.endsWith('.json'));
const pay = args.indexOf('--payer') >= 0 ? args[args.indexOf('--payer') + 1] : 'NONPAYER';
const minv = args.indexOf('--min') >= 0 ? +args[args.indexOf('--min') + 1] : 0.05;
const Js = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const cats = Object.keys(Js[0].cells[Object.keys(Js[0].cells)[0]].sim);
console.log('payer ' + pay + '; columns: ' + files.map((f, i) => i === 0 ? 'ref' : 'f' + i).join(' | ') + '   (meas in [])');
cats.forEach(cat => {
  const S = Js.map(J => summarize(J, [cat]));
  const lines = [];
  RES.forEach(r => {
    const k = pay + '|' + r, vals = S.map(s => s[k].sim), m = S[0][k].meas;
    if (Math.max(...vals.map(Math.abs), Math.abs(m)) < minv) return;
    if (vals.every(v => Math.abs(v - vals[0]) < 1e-6) && Math.abs(vals[0] - m) < 1e-6) return;
    lines.push('   ' + r.padEnd(14) + ('[' + m.toFixed(2) + ']').padStart(11) + vals.map((v, i) => (v.toFixed(2) + (i ? ' (' + (vals[0] ? (100 * (v / vals[0] - 1)).toFixed(0) : '-') + '%)' : '')).padStart(17)).join(''));
  });
  if (lines.length){ console.log(cat); lines.forEach(l => console.log(l)); }
});
