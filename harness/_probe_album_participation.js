// OPTION A PREVIEW (2026-11-06) - what the album run reads when its inputs are pulled on the players who
// have the album, built from columns the unfiltered pull already carries. Evidence for D97 and for
// PROMPT_album_players_pull.md; it changes nothing in the engine and asserts nothing.
//
// The unfiltered album pull (LIVE_OPS_V3 (20) / (21)) counts every player of the cell present on day 1,
// and 50-62% of them never opened an envelope (data_col_season players_nonzero / unique_players =
// 0.38-0.50; the pull behind (17): 0.97). The run calibrates the cell MEAN inflow and plays it on every
// simulated player, so album 1 by the data day reads 0.48% against 1.59% measured.
//
// Three runs of the engine's own album path (albumPrepare_ + albumRunPrepared_, calibration computed
// in each), every figure as a share / mean of ALBUM PLAYERS so the three are on one footing:
//   1  as pulled        the dump as it is (its numbers divided by q to land on the same footing)
//   2  album sheets     data_col_season / data_col_envelopes rewritten per album player (means and the
//                       completion rate / q, players x q) - exact: a player with no envelope has zero of
//                       everything. Attendance still data_seg_beh = every player of the cell.
//   3  + attendance     run 2 plus a data_col_beh sheet: data_seg_beh's rows with both activity rates set
//                       to data_col_season's active_days_mean / data days. The pull has no percentiles
//                       for these players, so the rows carry none and attendance is drawn homogeneously -
//                       a stand-in for the real rows, which is why this is a preview and not a result.
// Read-out on (21) at 300 players, album 1 by day 22, all cells: measured 3.4% of album players;
// run 1 1.0%, run 2 6.6%, run 3 3.0%. Run 2 over-shoots because the cell's activity is the wrong
// population's (0-9 NONPAYER: 7.3 active days of 22, p25 1 / p90 21, against 14.8 for the album pull).
//
//   node harness/_probe_album_participation.js [--data v3q|<path>] [--n 300]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3q');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function PROBE(){
  const N = +(process.argv.indexOf('--n') >= 0 ? process.argv[process.argv.indexOf('--n') + 1] : 300);
  const SEED = 932341729;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  Logger.log = function(m){ logs.push(String(m)); };
  global.HtmlService = undefined;
  // a dump can carry album tables written under labels the pull no longer uses: start clean
  delete data[ALBUM_CALIB_SHEET]; delete data[ALBUM_SUMMARY_SHEET]; delete data[ALBUM_GAINS_SHEET];
  resetSheetCache_mock(); Context.get();
  const D = albumDataDays_(), perms = cloudPermutations_();
  const sv0 = data[ALBUM_SEASON_SHEET].values, sh = sv0[0].map(String), si = (k) => sh.indexOf(k);
  if (si('players_nonzero') < 0){ console.log(ALBUM_SEASON_SHEET + ' has no players_nonzero column - nothing to preview.'); return; }
  const cellKey = (seg, payer) => segCanon_(seg) + '|' + String(payer).trim().toUpperCase();
  const q = {}, adm = {};
  sv0.slice(1).forEach(r => {
    if (!r || !r[si('segment')]) return;
    const k = cellKey(r[si('segment')], r[si('payer_flag')]);
    q[k] = num(r[si('players_nonzero')]) / Math.max(1, num(r[si('unique_players')]));
    if (si('active_days_mean') >= 0) adm[k] = num(r[si('active_days_mean')]);
  });
  const qOf = (p) => q[cellKey(p.seg, p.payer)] || 1;

  // the album sheets per ALBUM PLAYER
  const albumOnly = () => {
    const s = data[ALBUM_SEASON_SHEET].values;
    const perPlayer = sh.filter(c => /_mean$/.test(c) && c !== 'active_days_mean').concat(['album1_completion_rate']);
    for (let i = 1; i < s.length; i++){
      if (!s[i] || !s[i][si('segment')]) continue;
      const qq = q[cellKey(s[i][si('segment')], s[i][si('payer_flag')])] || 1;
      perPlayer.forEach(c => { const j = si(c); if (j >= 0 && s[i][j] !== '' && s[i][j] != null) s[i][j] = num(s[i][j]) / qq; });
      s[i][si('unique_players')] = num(s[i][si('players_nonzero')]);
    }
    const e = data[ALBUM_ENV_SHEET].values, eh = e[0].map(String), ei = (k) => eh.indexOf(k);
    for (let i = 1; i < e.length; i++){
      if (!e[i] || !e[i][ei('segment')]) continue;
      const qq = q[cellKey(e[i][ei('segment')], e[i][ei('payer_flag')])] || 1;
      e[i][ei('envelopes_mean')] = num(e[i][ei('envelopes_mean')]) / qq;
      if (ei('cell_players') >= 0) e[i][ei('cell_players')] = num(e[i][ei('cell_players')]) * qq;
    }
  };
  // the album players' behaviour rows, at the album pull's own activity level (no percentiles in the pull)
  const albumBeh = () => {
    const b = clone(data['data_seg_beh'].values), bh = b[0].map(String), bi = (k) => bh.indexOf(k);
    const out = [b[0]];
    for (let i = 1; i < b.length; i++){
      if (!b[i] || !b[i][bi('segment')]) continue;
      if (bi('ab_variant') >= 0 && String(b[i][bi('ab_variant')]).trim() !== ANCHOR_ARM) continue;
      const m = adm[cellKey(b[i][bi('segment')], b[i][bi('payer_flag')])];
      if (!(m > 0)) continue;
      const rate = Math.min(0.98, m / D);
      b[i][bi('weekday_active_rate')] = rate; b[i][bi('weekend_active_rate')] = rate; b[i][bi('active_days_mean')] = m;
      ['active_days_p25', 'active_days_p50', 'active_days_p75', 'active_days_p90', 'active_days_p95', 'active_days_p98'].forEach(c => { if (bi(c) >= 0) b[i][bi(c)] = ''; });
      out.push(b[i]);
    }
    data[ALBUM_BEH_SHEET] = { values: out, merges: [] };
  };
  const run = (mutators) => {
    const snap = { s: clone(data[ALBUM_SEASON_SHEET]), e: clone(data[ALBUM_ENV_SHEET]), b: data[ALBUM_BEH_SHEET] };
    try {
      mutators.forEach(f => f());
      resetSheetCache_mock(); Context.get();
      const prep = albumPrepare_('current', SEED, D, { calibrate: { meas: albumMeasured_(), nCal: Math.min(N, ALBUM_CALIB_PLAYERS) } });
      return { res: albumRunPrepared_(prep, N, SEED, D, {}), ms: albumMeasuredSeason_(),
               src: perms.map(p => cardBeh_(p.seg, p.payer, Context.get()).source.split(' (')[0]).filter((x, i, a) => a.indexOf(x) === i).join(' + ') };
    } finally {
      data[ALBUM_SEASON_SHEET] = snap.s; data[ALBUM_ENV_SHEET] = snap.e;
      if (snap.b) data[ALBUM_BEH_SHEET] = snap.b; else delete data[ALBUM_BEH_SHEET];
      resetSheetCache_mock(); Context.get();
    }
  };
  const r1 = run([]), r2 = run([albumOnly]), r3 = run([albumOnly, albumBeh]);

  const pc = (x) => (100 * num(x)).toFixed(2).padStart(6) + '%', f1 = (x) => num(x).toFixed(1).padStart(6), f2 = (x) => num(x).toFixed(2).padStart(5);
  console.log('album day ' + D + ', ' + N + ' players per cell. Every figure is per ALBUM PLAYER (at least one envelope by day ' + D + '); x q gives the share of the whole pull.');
  console.log('attendance: run 1 ' + r1.src + ', run 2 ' + r2.src + ', run 3 ' + r3.src);
  console.log('each group: measured | 1 as pulled | 2 album sheets | 3 + attendance');
  console.log('cell               q    active days of ' + D + '      album 1 by day ' + D + '                    new cards                     sets                        envelopes opened            album 1 at the season end (1 | 2 | 3)');
  console.log('                        cell | album pull');
  let W = 0; const a = [0, 0, 0, 0, 0, 0, 0];
  perms.forEach(p => {
    const qq = qOf(p), m = r2.ms[p.label] || {}, x1 = r1.res[p.label], x2 = r2.res[p.label], x3 = r3.res[p.label];
    if (!x1 || !x2 || !x3) return;
    const b = Context.get().ds.beh(p.seg, p.payer) || {};
    const g = (key, fmt, full) => [fmt(full ? null : m[key]), fmt((full ? x1.full : x1.d)[key] / qq), fmt((full ? x2.full : x2.d)[key]), fmt((full ? x3.full : x3.d)[key])];
    console.log(p.label.padEnd(18) + qq.toFixed(2) + '  ' + f1(b.active_days_mean) + ' | ' + f1(adm[cellKey(p.seg, p.payer)]) + '   ' +
      g('album1', pc).join(' ') + '   ' + g('unique', f1).join(' ') + '   ' + g('sets', f2).join(' ') + '   ' + g('packs', f1).join(' ') + '   ' + g('album1', pc, true).slice(1).join(' '));
    const w = num(m.players);
    W += w; a[0] += w * num(m.album1); a[1] += w * x1.d.album1 / qq; a[2] += w * x2.d.album1; a[3] += w * x3.d.album1;
    a[4] += w * x1.full.album1 / qq; a[5] += w * x2.full.album1; a[6] += w * x3.full.album1;
  });
  console.log('All (album players)                      ' + [a[0], a[1], a[2], a[3]].map(x => pc(x / W)).join(' ') + '   season end: ' + [a[4], a[5], a[6]].map(x => pc(x / W)).join(' '));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
