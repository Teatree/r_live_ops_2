// 2026-11-05 evidence (LIVE_OPS_V3 (20)): the album pull now counts every player of the cell, and 52-62%
// of them never received an envelope (data_col_season players_nonzero / unique_players = 0.38-0.50; the
// pull behind (17) had 97%). The album run calibrates the cell's MEAN inflow and gives it to every
// simulated player, so nobody gets as far as the players who do have the album: album 1 by the data day
// reads 0.48% simulated against 1.59% measured.
//
// This probe prices the obvious alternative WITHOUT changing the engine: play only the players who have
// the album (every k and carried rate / q), then scale every share and mean by q. It prints, per cell at
// the album data's day: measured | the engine as it is (even spread) | participants x q - for album 1,
// new cards, sets and envelopes opened - and the end-of-season album 1 under both.
// Read-out on (20) at 300 players: mean new cards fit better (20-39 NONPAYER 24.6 measured, 34.5 even,
// 25.8 participants) but album 1 then OVER-shoots (3.07% against 1.59%; 20-39: 8.5% against 2.2%) and
// participants open 15-25% more envelopes than measured (more sets, more chests). Neither is validated:
// the open decision is in SIMULATION_PLAN.md (album population, 2026-11-05).
//
//   node harness/_probe_album_participation.js [--data v3p|<path>] [--n 300]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3p');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function PROBE(){
  const N = +(process.argv.indexOf('--n') >= 0 ? process.argv[process.argv.indexOf('--n') + 1] : 300);
  const SEED = 932341729;
  Logger.log = function(m){ logs.push(String(m)); };
  global.HtmlService = undefined;
  // a dump can carry album tables written under labels the pull no longer uses: start clean
  delete data[ALBUM_CALIB_SHEET]; delete data[ALBUM_SUMMARY_SHEET]; delete data[ALBUM_GAINS_SHEET];
  resetSheetCache_mock(); Context.get();
  const D = albumDataDays_(), meas = albumMeasured_(), ms = albumMeasuredSeason_();
  const sv = data[ALBUM_SEASON_SHEET].values, sh = sv[0].map(String), si = (k) => sh.indexOf(k);
  if (si('players_nonzero') < 0){ console.log(ALBUM_SEASON_SHEET + ' has no players_nonzero column - nothing to price.'); return; }
  const q = {};
  sv.slice(1).forEach(r => {
    const seg = String(r[si('segment')] == null ? '' : r[si('segment')]).trim();
    if (!seg) return;
    q[albumCellLabel_(seg, String(r[si('payer_flag')]).trim().toUpperCase())] = num(r[si('players_nonzero')]) / Math.max(1, num(r[si('unique_players')]));
  });
  const perms = cloudPermutations_();
  const prep = albumPrepare_('current', SEED, D, { calibrate: { meas: meas, nCal: Math.min(N, ALBUM_CALIB_PLAYERS) } });
  const even = albumRunPrepared_(prep, N, SEED, D, {});
  // participants only: every k and every carried rate / q (a source the table has no k for is at the
  // model's level, k = 1 - per cell player too, so it is divided as well)
  const prep2 = Object.assign({}, prep, { pres: prep.pres.map((pre, i) => {
    const qq = q[perms[i].label] || 1, cal = pre.calib;
    if (!cal) return pre;
    const k = {}; for (const kk in cal.k) k[kk] = cal.k[kk] / qq;
    const carried = {}; for (const t in cal.carried) carried[t] = cal.carried[t] / qq;
    return albumPreWith_(pre, { k: k, carried: carried, _q: qq,
                                carriedStreams: Object.keys(carried).length ? [{ cat: ALBUM_CARRIED_SRC, perDay: carried }] : [] });
  }) });
  const keepK = albumK_;
  albumK_ = function(calib, source, tier){
    const k = keepK(calib, source, tier), g = albumCatGroup_(source);
    return (calib && calib._q && calib.k[g + '|' + tier] == null && calib.k[g] == null) ? k / calib._q : k;
  };
  let part;
  try { part = albumRunPrepared_(prep2, N, SEED, D, {}); } finally { albumK_ = keepK; }
  const pc = (x) => (100 * num(x)).toFixed(2).padStart(6) + '%', f1 = (x) => num(x).toFixed(1).padStart(6), f2 = (x) => num(x).toFixed(2).padStart(5);
  console.log('album day ' + D + ', ' + N + ' players per cell.  q = share of the cell\'s album players with at least one envelope');
  console.log('each triple: measured | the engine (even spread) | participants only x q');
  console.log('cell               q     album 1 by day ' + D + '             new cards              sets               envelopes opened      album 1 at the season\'s end (even | participants)');
  let W = 0; const a = [0, 0, 0, 0, 0];
  perms.forEach(p => {
    const m = ms[p.label] || {}, b = even[p.label], pt = part[p.label], qq = q[p.label] || 1;
    if (!b || !pt) return;
    console.log(p.label.padEnd(18) + qq.toFixed(3) + '  ' + pc(m.album1) + ' ' + pc(b.d.album1) + ' ' + pc(qq * pt.d.album1) +
      '   ' + f1(m.unique) + ' ' + f1(b.d.unique) + ' ' + f1(qq * pt.d.unique) +
      '   ' + f2(m.sets) + ' ' + f2(b.d.sets) + ' ' + f2(qq * pt.d.sets) +
      '   ' + f1(m.packs) + ' ' + f1(b.d.packs) + ' ' + f1(qq * pt.d.packs) +
      '   ' + pc(b.full.album1) + ' ' + pc(qq * pt.full.album1));
    const w = num(m.players);
    W += w; a[0] += w * num(m.album1); a[1] += w * b.d.album1; a[2] += w * qq * pt.d.album1; a[3] += w * b.full.album1; a[4] += w * qq * pt.full.album1;
  });
  console.log('All (album players) ' + '      ' + pc(a[0] / W) + ' ' + pc(a[1] / W) + ' ' + pc(a[2] / W) + '   end of season: even ' + pc(a[3] / W) + ', participants ' + pc(a[4] / W));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
