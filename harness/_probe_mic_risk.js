// D105 risk probe: how far each Mighty Ice Cream assumption moves the priced row (40-99 PAYER and 0-9 NONPAYER),
// plus the random-mixing check of data_mic's leaderboard table.   node harness/_probe_mic_risk.js [--data v3w]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3w');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const PRELUDE = CARDS.slice(0, CARDS.indexOf('// ---------------------------------------------------------------- 1. PackConfig reader'));
const _log = console.log; global.__say = _log; console.log = () => {};
function PROBE(){
  const say = global.__say, MIC = 'Mighty Ice Cream', SH = 'Mic_v2', WS = WAGER_SPECS[MIC];
  const reset = () => { resetSheetCache_mock(); Context.reset(); };
  const micV = data[SH].values, lab = n => micV.findIndex(r => String(r[0]).trim().toLowerCase().indexOf(n.toLowerCase().split(' (')[0]) === 0);
  const hr = micV.findIndex(r => String(r[0]).trim() === 'Segment' && r.indexOf(WS.scoreLabel) >= 0), th = micV[hr];
  // ladder as the user left it
  const lad = lbLadder_(SH, LB_R_SPECS[MIC]), tot = {};
  Object.keys(lad).forEach(k => { for (const r in lad[k]) tot[r] = (tot[r] || 0) + lad[k][r]; });
  say('ladder totals over 25 places: ' + JSON.stringify(tot));
  const top16 = {}; Object.keys(lad).filter(k => +k <= 17).forEach(k => { for (const r in lad[k]) top16[r] = (top16[r] || 0) + lad[k][r]; });
  say('ladder totals over places 1-17 (all a 16-17 board can reach): ' + JSON.stringify(top16));
  const prices = itemVals_(), val = r => RESOURCES.reduce((a, q) => a + num(r[q]) * num(q === 'ToF_Ticket' ? prices['ToF_Value'] : prices[q]), 0);
  const cells = [['0-9', 'NONPAYER'], ['20-39', 'PAYER'], ['40-99', 'PAYER'], ['100-249', 'PAYER']];
  const snap = tag => { reset(); const ctx = Context.get();
    return cells.map(([s, p]) => { const r = resultRow_(MIC, s, p, ctx); return { hc: num(r.HC), v: val(r) }; }); };
  const show = (tag, rows, base) => say('  ' + tag.padEnd(58) + rows.map((x, i) => (x.v.toFixed(0) + (base ? ' (' + (100 * (x.v / base[i].v - 1)).toFixed(0) + '%)' : '')).padStart(14)).join(''));
  say('\nVALUE per player per window (item_vals), cells: ' + cells.map(c => c.join(' ')).join(' | '));
  const base = snap(); show('baseline (league 16.3, measured participation)', base);
  // league size
  const lr = lab(WS.leagueLabel), lk = micV[lr][1];
  [10, 20.4, 25, 30, 60].forEach(n => { micV[lr][1] = n; show('league ' + n, snap(), base); });
  micV[lr][1] = lk;
  // participation: if Population were the whole segment, divide by the festival reach
  const ctx0 = (reset(), Context.get());
  say('\nreach of one weekday 2-day festival vs data_mic participation:');
  segMembers_(ctx0.ds).forEach(s => { const b = ctx0.ds.beh(s, 'PAYER'), bn = ctx0.ds.beh(s, 'NONPAYER');
    const x = mkInst_(1, 2), rp = reachOne_(x, num(b.weekday_active_rate), num(b.weekend_active_rate)), rn = reachOne_(x, num(bn.weekday_active_rate), num(bn.weekend_active_rate));
    say('  ' + s.padEnd(8) + ' reach NP ' + rn.toFixed(2) + ' P ' + rp.toFixed(2) + '   participation ' + wagerCell_(MIC, s, 'PAYER', SH).part +
        '   players data_seg_beh NP+P ' + (ctx0.ds.players(s, 'NONPAYER') + ctx0.ds.players(s, 'PAYER')).toFixed(0)); });
  // relative score shift (uniform scaling is a no-op: places depend on order only)
  const keep = clone(micV), scoreCols = MIC_SCORE_COLS.map(c => th.indexOf(c[0])).concat([th.indexOf('Avg top score')]);
  const scaleSeg = (pred, f) => { data[SH].values.forEach((r, i) => { if (i > hr && i <= hr + 14 && pred(String(r[0]).trim())) scoreCols.forEach(c => { r[c] = num(keep[i][c] || micDataRow_(r[0])[th[c] === 'Avg top score' ? 'avg top score' : th[c].replace('Top score ', '')]) * f; }); }); };
  scaleSeg(() => true, 0.5); show('every score x0.5 (must be identical)', snap(), base);
  data[SH].values = clone(keep); scaleSeg(s => s === '0-9', 1.3); show('0-9 scores x1.3 only', snap(), base);
  data[SH].values = clone(keep); scaleSeg(s => s !== '0-9' && s !== 'ALL', 1.3); show('everyone but 0-9 x1.3', snap(), base);
  data[SH].values = keep; reset();
  // payer uplift: payers score more (they buy +5 moves / boosters) - x1.5 on the PAYER rows only
  const keep2 = clone(data[SH].values), v2 = data[SH].values;
  v2.forEach((r, i) => { if (i > hr && i <= hr + 14 && String(r[1]).trim() === 'PAYER') scoreCols.forEach(c => { const k = th[c] === 'Avg top score' ? 'avg top score' : th[c].replace('Top score ', ''); r[c] = num(micDataRow_(r[0])[k]) * 1.5; }); });
  show('PAYER rows scores x1.5', snap(), base);
  data[SH].values = keep2; reset();
  // random-mixing check
  const dm = data['data_mic'].values, t3 = dm.findIndex(r => String(r[1]).trim() === 'Leaderboards'), h3 = dm[t3].map(x => String(x || '').toLowerCase());
  say('\nrandom mixing check (boards of 16.3, binomial seats):  segment | pooled share | P(on a board) random | measured | share/LB p25-p75 random | measured');
  const n = 15.3;
  dm.slice(t3 + 1).forEach(r => { if (!String(r[0]).trim()) return; const s = Number(r[h3.indexOf('pooled share')]);
    const pres = 1 - Math.pow(1 - s, 16.3), sd = Math.sqrt(s * (1 - s) / 16.3);
    say('  ' + String(r[0]).padEnd(8) + s.toFixed(3).padStart(8) + pres.toFixed(3).padStart(10) + Number(r[h3.indexOf('% lbs with segment')]).toFixed(3).padStart(10) +
        ('  ' + Math.max(0, s - 0.674 * sd).toFixed(3) + '-' + (s + 0.674 * sd).toFixed(3)).padStart(16) + ('  ' + r[h3.indexOf('p25')] + '-' + r[h3.indexOf('p75')]).padStart(14)); });
}
eval(PRELUDE + '\nconst clone = x => JSON.parse(JSON.stringify(x));\n(' + PROBE.toString() + ')();\n');
