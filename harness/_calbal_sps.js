// 'Sim per Segment' rollup of a _probe_calbal.js run: per resource (the sheet's 13 + envelopes / tickets) and the
// OVERALL VALUE block (13 resources x item_vals row 3, as the workbook's sheet does), groups PAID / ADS / CORE / META
// exactly as engine/SimPerSegmentFill.gs, CURRENT = measured, SIMULATED = sim, overall rows weighted by unique_players.
//   node harness/_calbal_sps.js run.json [--json out.json] [--print HC,Unlimited Lives]
const fs = require('fs'), path = require('path');
const SPS_GROUPS = {
  'PAID': ['IAPs','Season Pass (Paid)'], 'ADS': ['Ads'], 'CORE': ['Core','Saga','Daily Gift'],
  'META': ['Bomb Challenge',"Bomb's Ballet",'Chuck Challenge','Daily Night Sky Prize','Flock Flurry','Hatchling Hideaway','Jigsaw',
           'Kite Festival','Level Race','Other','Photoshoot','Red Challenge','River Rush','Season Pass (Free)','Target Day','Team Event',
           'Team Race','Flash Race','FlowerCoop','Rainbow Maker','ToF','Col - Sets','Col - Albums'] };
const GROUPS = ['PAID', 'ADS', 'CORE', 'META'];
const RES13 = ['HC','Slingshot','Shuffle','Comet','Red','Chuck','Bomb','UL Bomb','UL Chuck','UL Red','Unlimited Lives','SPT','SPTx2'];
const RESX = ['1-star Pack','2-star Pack','3-star Pack','4-star Pack','5-star Pack','6-star Pack','ToF_Ticket'];
const SEGS = ['0-9', '10-19', '20-39', '40-99', '100+'];
function itemVals(dumpFile){
  const d = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));
  const v = d['item_vals'].values, map = { 'Coins': 'HC', 'SPT x2': 'SPTx2', 'Unlimited Red': 'UL Red', 'Unlimited Chuck': 'UL Chuck', 'Unlimited Bomb': 'UL Bomb' };
  const o = {}; (v[1] || []).forEach((h, c) => { const k = map[String(h).trim()] || String(h).trim(); o[k] = Number((v[2] || [])[c]) || 0; });
  return o;
}
function rollup(J, IV){
  const groupOf = {}; GROUPS.forEach(g => SPS_GROUPS[g].forEach(c => { groupOf[c] = g; }));
  const out = {};                                   // out[res][payer][seg|'overall'] = {cur:{g..,Total}, sim:{..}}
  const cell = (lab, side, res) => { const o = { Total: 0 }; GROUPS.forEach(g => { o[g] = 0; });
    const rows = J.cells[lab][side];
    Object.keys(rows).forEach(cat => { const g = groupOf[cat] || 'META'; const x = Number(rows[cat][res]) || 0; o[g] += x; o.Total += x; });
    return o; };
  const resList = RES13.concat(RESX).concat(['VALUE']);
  resList.forEach(res => {
    out[res] = {};
    ['NONPAYER', 'PAYER'].forEach(p => {
      out[res][p] = {}; let w = 0; const acc = { cur: {}, sim: {} };
      SEGS.forEach(seg => {
        const lab = seg + ' ' + p, pop = J.cells[lab].pop;
        const val = (side) => { if (res !== 'VALUE') return cell(lab, side, res);
          const o = { Total: 0 }; GROUPS.forEach(g => { o[g] = 0; });
          RES13.forEach(r => { const c = cell(lab, side, r); GROUPS.forEach(g => { o[g] += c[g] * (IV[r] || 0); }); o.Total += c.Total * (IV[r] || 0); });
          return o; };
        const e = { cur: val('meas'), sim: val('sim') };
        out[res][p][seg] = e;
        ['cur', 'sim'].forEach(s => Object.keys(e[s]).forEach(k => { acc[s][k] = (acc[s][k] || 0) + pop * e[s][k]; }));
        w += pop;
      });
      ['cur', 'sim'].forEach(s => Object.keys(acc[s]).forEach(k => { acc[s][k] /= w; }));
      out[res][p].overall = acc;
    });
  });
  return out;
}
module.exports = { rollup, itemVals, RES13, RESX, SEGS, GROUPS };
if (require.main === module && process.argv.indexOf('--bundle') < 0){
  const args = process.argv.slice(2), file = args.find(a => a.endsWith('.json') && !a.startsWith('--'));
  const J = JSON.parse(fs.readFileSync(file, 'utf8'));
  const IV = itemVals(path.join(__dirname, '_mockdata_v3h.json'));
  const R = rollup(J, IV);
  const pr = (args.indexOf('--print') >= 0 ? args[args.indexOf('--print') + 1] : 'VALUE,HC').split(',');
  const pc = (a, b) => b ? ((100 * (a - b) / b).toFixed(1) + '%') : '-';
  pr.forEach(res => {
    console.log('=== ' + res);
    ['NONPAYER', 'PAYER'].forEach(p => {
      console.log(' ' + p.padEnd(9) + ' | CURRENT PAID ADS CORE META Total | SIMULATED PAID ADS CORE META Total | d% PAID ADS CORE META Total');
      SEGS.concat(['overall']).forEach(seg => { const e = R[res][p][seg];
        console.log('  ' + seg.padEnd(8) + ' | ' + GROUPS.concat(['Total']).map(g => e.cur[g].toFixed(1)).join(' ') + ' | ' + GROUPS.concat(['Total']).map(g => e.sim[g].toFixed(1)).join(' ') + ' | ' + GROUPS.concat(['Total']).map(g => pc(e.sim[g], e.cur[g])).join(' ')); });
    });
  });
  const jo = args.indexOf('--json'); if (jo >= 0) fs.writeFileSync(args[jo + 1], JSON.stringify(R));
}

// --bundle out.json: the four rollups the Calendar_Rebalance builder renders (before the swap, the swap alone,
// rebalanced, rebalanced with the two collection rows held at their before-swap values)
if (require.main === module && process.argv.indexOf('--bundle') >= 0){
  const out = process.argv[process.argv.indexOf('--bundle') + 1], dir = path.join(path.dirname(__dirname), 'analysis', 'out');
  const rd = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
  const IV = itemVals(path.join(__dirname, '_mockdata_v3h.json'));
  const R1 = rd('calbal_base_cur.json'), R2 = rd('calbal_base_new.json'), F = rd('calbal_eval.json');
  const held = JSON.parse(JSON.stringify(F));
  Object.keys(held.cells).forEach(l => ['Col - Sets', 'Col - Albums'].forEach(c => { held.cells[l].sim[c] = R1.cells[l].sim[c]; }));
  const lanes = {};
  Object.keys(F.cells).forEach(l => { lanes[l] = { pop: F.cells[l].pop, ref: R1.cells[l].sim, swap: R2.cells[l].sim, after: F.cells[l].sim, meas: R1.cells[l].meas }; });
  fs.writeFileSync(out, JSON.stringify({ itemVals: IV, before: rollup(R1, IV), swap: rollup(R2, IV), after: rollup(F, IV), afterHeld: rollup(held, IV), lanes }));
  console.log('written ' + out);
}
