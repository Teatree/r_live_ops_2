// Summaries over _probe_calbal.js outputs: per resource, per cell, sim/meas/diff and the
// population-weighted overall per payer type. Usage: node harness/_calbal_sum.js a.json [b.json ...] [--cat]
const fs = require('fs');
const files = process.argv.slice(2).filter(x => !x.startsWith('--'));
const byCat = process.argv.indexOf('--cat') >= 0;
const RES = ['HC','Slingshot','Shuffle','Comet','Red','Chuck','Bomb','UL Bomb','UL Chuck','UL Red','Unlimited Lives','SPT','SPTx2',
             '1-star Pack','2-star Pack','3-star Pack','4-star Pack','5-star Pack','6-star Pack','ToF_Ticket'];
function tot(cellRows, res, cats){ let s = 0; Object.keys(cellRows).forEach(c => { if (cats && cats.indexOf(c) < 0) return; s += Number(cellRows[c][res]) || 0; }); return s; }
function summarize(J, cats){
  const out = {};
  ['NONPAYER', 'PAYER'].forEach(p => {
    const labs = Object.keys(J.cells).filter(l => l.split(' ')[1] === p);   // not endsWith: 'NONPAYER' ends with 'PAYER'
    RES.forEach(r => {
      let ws = 0, wm = 0, w = 0;
      labs.forEach(l => { const c = J.cells[l]; ws += c.pop * tot(c.sim, r, cats); wm += c.pop * tot(c.meas, r, cats); w += c.pop; });
      out[p + '|' + r] = { sim: ws / w, meas: wm / w };
    });
  });
  return out;
}
module.exports = { summarize, RES, tot };
if (require.main === module){
  const Js = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  const S = Js.map(J => summarize(J));
  console.log('overall (pop-weighted) per resource: meas | ' + files.map((f, i) => 'sim' + i + ' (Δ%)').join(' | '));
  ['NONPAYER', 'PAYER'].forEach(p => {
    console.log('--- ' + p);
    RES.forEach(r => {
      const k = p + '|' + r, m = S[0][k].meas;
      console.log(r.padEnd(16) + m.toFixed(2).padStart(10) + S.map(s => { const x = s[k].sim; const mm = s[k].meas; return (x.toFixed(2) + ' (' + (mm ? (100 * (x - mm) / mm).toFixed(1) : '-') + '%)').padStart(20); }).join(''));
    });
  });
  if (byCat){
    const cats = Object.keys(Js[0].cells[Object.keys(Js[0].cells)[0]].sim);
    ['NONPAYER', 'PAYER'].forEach(p => {
      console.log('=== by category, ' + p + ' (HC / SPT / boosters(Red+Chuck+Bomb+Comet+Shuffle+Sling) / UL(all four, min) ) meas -> sims');
      cats.forEach(cat => {
        const parts = Js.map(J => summarize(J, [cat]));
        const grp = (s, kind) => { const ks = kind === 'b' ? ['Red','Chuck','Bomb','Comet','Shuffle','Slingshot'] : kind === 'u' ? ['UL Bomb','UL Chuck','UL Red','Unlimited Lives'] : [kind];
          return ks.reduce((a, r) => a + s[p + '|' + r].sim, 0); };
        const grpM = (s, kind) => { const ks = kind === 'b' ? ['Red','Chuck','Bomb','Comet','Shuffle','Slingshot'] : kind === 'u' ? ['UL Bomb','UL Chuck','UL Red','Unlimited Lives'] : [kind];
          return ks.reduce((a, r) => a + s[p + '|' + r].meas, 0); };
        const line = ['HC', 'SPT', 'b', 'u'].map(k => grpM(parts[0], k).toFixed(1) + '->' + parts.map(s => grp(s, k).toFixed(1)).join('/')).join('  ');
        if (/[1-9]/.test(line)) console.log(cat.padEnd(22) + line);
      });
    });
  }
}
