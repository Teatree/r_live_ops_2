// Runs the menu's "Album completion across the population" on a dump and prints the album_summary it
// writes: per cell the MEASURED share with album 1 complete at the album data's day next to the CURRENT
// and REDESIGN seasons at that day and at the season's end, the run line, and which cells borrowed a
// calibration (D94). Nothing is asserted - it is the read-out for a new pull.
//
//   node harness/_probe_album_summary.js [--data v3p|<path>] [--n 300]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3p');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function PROBE(){
  const N = +(process.argv.indexOf('--n') >= 0 ? process.argv[process.argv.indexOf('--n') + 1] : 300);
  const SEED = 932341729;
  const fresh = () => { resetSheetCache_mock(); return Context.get(); };
  Logger.log = function(m){ logs.push(String(m)); };
  global.HtmlService = undefined;
  // a dump can carry album tables written under labels the pull no longer uses: start clean
  delete data[ALBUM_CALIB_SHEET]; delete data[ALBUM_SUMMARY_SHEET]; delete data[ALBUM_GAINS_SHEET];
  const t = data['Col_Cards_Totals'];
  t.values[1][1] = N; t.values[1][3] = SEED;
  fresh();
  const t0 = Date.now();
  SimulateAlbumCompletion();
  console.log('run: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s, ' + N + ' players per cell asked for');
  const v = data[ALBUM_SUMMARY_SHEET].values;
  const pct = (x) => (x === '' || x == null || isNaN(+x)) ? String(x == null ? '' : x) : (100 * +x).toFixed(2) + '%';
  for (let r = 0; r < Math.min(v.length, 4); r++) console.log(((v[r] || []).filter(x => String(x).trim() !== '').join('  |  ')).slice(0, 900));
  const hi = v.findIndex(r => String((r || [])[0]).indexOf('HISTORY') === 0);
  const hdr = v[4] || [];
  // shares (album 1, the +-95% half-width) print as %, everything else (envelopes, cards, sets) as a number
  const isShare = hdr.map(h => /album 1|\+-/.test(String(h)));
  const fx = (x) => (x === '' || x == null || isNaN(+x)) ? String(x == null ? '' : x) : (+x).toFixed(2);
  console.log('\ncolumns:');
  hdr.forEach((h, i) => console.log('  [' + i + '] ' + h));
  console.log('');
  for (let r = 5; r < (hi > 0 ? hi : v.length); r++){
    const row = v[r] || [];
    if (!String(row[0]).trim()) continue;
    console.log(row.map((x, i) => (i < 2 ? String(x).padEnd(i ? 9 : 8) : (i === 2 ? String(Math.round(+x)).padStart(7) : (isShare[i] ? pct(x) : fx(x)).padStart(8)))).join(' '));
  }
  const c = data[ALBUM_CALIB_SHEET].values, h = c[3], nc = h.indexOf('note');
  const borrowed = {};
  c.slice(4).forEach(r => { if (/^borrowed from /.test(String(r[nc]))) borrowed[r[0]] = String(r[nc]).split(' - ')[0]; });
  console.log('\ncalibration borrowed (D94): ' + (Object.keys(borrowed).length ? Object.keys(borrowed).map(k => k + ': ' + borrowed[k]).join('; ') : 'none'));
}

eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
