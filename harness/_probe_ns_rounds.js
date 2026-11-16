// Night Sky round by round on a dump (D106): each ladder's rounds (cum req, coins) with the chance the
// engine prices each round at on each side and day type, E per active day, and the NS row in every view
// (window grid, daily sum, 7-day window). With the pull of PROMPT_ns_rounds_progress.md in the dump it
// also runs the prompt's reconciliations: data_ns_rounds vs data_ns_dayend (claims per player-day two
// ways) and each round's measured claim rate vs data_ns_progress at its requirement.
//   node harness/_probe_ns_rounds.js [--data v3x] [--seg 40-99] [--payer NONPAYER]
const fs = require('fs');
const path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3x');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const _log = console.log; console.log = () => {}; global.__say = _log;

function PROBE(){
  const say = global.__say;
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  eval(fs.readFileSync(ENGINE('EcoGainsSim_7Day.gs'), 'utf8'));
  const ctx = Context.get(), ds = ctx.ds, CAT = 'Daily Night Sky Prize';
  const segs = arg('--seg', null) ? [arg('--seg')] : segMembers_(ds);
  const payers = arg('--payer', null) ? [arg('--payer')] : ['NONPAYER', 'PAYER'];
  const D = nsData_();
  say('engine ' + ENGINE_BUILD + '   data_ns_rounds ' + (D.rounds ? 'READ' : 'not read') + ', data_ns_progress ' + (D.progress ? 'READ' : 'not read'));
  // the prompt's reconciliation sheets (not engine inputs)
  const rowsOf = (nm) => { const v = (data[nm] || {}).values || []; if (v.length < 2) return [];
    const h = v[0].map(x => String(x).trim()); return v.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
  const dayend = rowsOf('data_ns_dayend'), rounds = rowsOf('data_ns_rounds');
  segs.forEach(seg => payers.forEach(payer => {
    const E = nsE_(seg, payer, ds, ctx);
    if (!E) { say(seg, payer, 'no E'); return; }
    const L = E.ladders;
    const show = (nm, lad, p) => say('  ' + nm + ': ' + lad.map((m, k) => 'R' + (k + 1) + ' req ' + m.req +
      ' P ' + num(p[k]).toFixed(3) + ' HC ' + (m.rew.HC || 0)).join(' | '));
    say('== ' + seg + ' ' + payer + '  curve: ' + E.source + (E.dayTyped ? ' (by day type)' : '') +
        '  split we/wd ' + E.split.we.toFixed(2) + '/' + E.split.wd.toFixed(2));
    show('base weekend', L.bWe, L.pbWe); show('base weekday', L.bWd, L.pbWd);
    show('NS_v2 weekend', L.vWe, L.pvWe); show('NS_v2 weekday', L.vWd, L.pvWd);
    const meas = measuredRow_(CAT, seg, payer, ds), sim = resultRow_(CAT, seg, payer, ctx);
    const s7 = win7Row_(CAT, seg, payer, ctx, true), m7 = win7Row_(CAT, seg, payer, ctx, false);
    const dl = dailySeries_(CAT, seg, payer, ctx, true);
    const dsum = dl.reduce((a, row) => a + num(row && row.HC), 0);
    say('  E/day HC base ' + E.eBase.HC.toFixed(2) + '  v2 ' + E.eV2.HC.toFixed(2) + '  (weekend ' +
        E.eV2Weekend.HC.toFixed(2) + ', weekday ' + E.eV2Weekday.HC.toFixed(2) + ')');
    say('  NS HC window: measured ' + num(meas.HC).toFixed(1) + '  sim ' + num(sim.HC).toFixed(1) +
        '  daily sum ' + dsum.toFixed(1) + '  7-day cur ' + num(m7.HC).toFixed(1) + ' new ' + num(s7.HC).toFixed(1));
    // reconciliation 1: sum of round claim rates vs sum of k x share of the day-end table (own config, all days)
    const own = (r) => segCanon_(r.segment) === segCanon_(seg) && String(r.payer_flag).trim() === payer &&
                      (r.config_segment == null || segCfgKeys_(seg).map(segCanon_).indexOf(segCanon_(r.config_segment)) >= 0);
    const rr = rounds.filter(own), de = dayend.filter(own);
    if (rr.length && de.length){
      const a = rr.reduce((s, r) => s + num(r.claims_total) / Math.max(1, num(r.player_days)), 0);
      const b = de.reduce((s, r) => s + num(r.rounds_completed) * num(r.share), 0);
      say('  check: claims per player-day from data_ns_rounds ' + a.toFixed(4) + ' vs data_ns_dayend ' + b.toFixed(4) +
          ' (' + (100 * (a / Math.max(1e-12, b) - 1)).toFixed(1) + '%)');
    }
    // reconciliation 2: each measured round against the progress curve at its requirement
    if (rr.length && D.progress){
      const C = nsCurve_(seg, payer, ds, 'all');
      say('  check: round claim rate vs progress share at its req: ' + rr.map(r => 'R' + r.round + ' ' +
          (num(r.claims_total) / Math.max(1, num(r.player_days))).toFixed(3) + ' / ' + C.S(num(r.cum_streak_req)).toFixed(3)).join(', '));
    }
  }));
  const notes = nsNotes_();
  if (notes.length) say('\nNIGHT SKY NOTES (change summary row 4 / the fill\'s pop-up):\n  ' + notes.join('\n  '));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
