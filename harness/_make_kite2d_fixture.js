// The 2-day Kite Festival evaluation fixture (2026-11-09). Isolates the Kite calendar change: every other
// source runs the same calendar and the same config on both sides, so every difference is the Kite row.
//   * cal_new := cal_curr (values + merges), then cal_new's KITE ROW from the dump's own cal_new
//     (--kite both: 2-day Tue-Wed + 3-day Fri-Sun, the user's layout; --kite move: the 3-day Fri-Sun only)
//   * every X_v2 sheet := its base X (NS_v2_weekday := NS_weekday), so R = 1 for every source
//   * Ki_2d_v2 := the 2-day proposal in builders/_ki2d_rewards.json (Ki_2d does not exist, so the anchor
//     side reads Ki); --milestone N overrides the proposal's milestone Unlimited Lives minutes
//   * cal_parsed rebuilt over B..AI (as _make_eval_fixture.js)
//
//   node harness/_make_kite2d_fixture.js --in _mockdata_v3t.json --out _mockdata_v3t_ki2d.json [--kite both|move|none]
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const inFile = path.join(__dirname, arg('--in', '_mockdata_v3t.json'));
const outFile = path.join(__dirname, arg('--out', '_mockdata_v3t_ki2d.json'));
const KITE = arg('--kite', 'both');
const MS = arg('--milestone', null);
const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

// 1. calendars
const origNew = clone(data['cal_new']);
const kiteRow = (cal) => cal.values.findIndex(r => r.some(x => /^Kite Festival/.test(String(x).trim()))) + 1;
const rN = kiteRow(origNew), rC = kiteRow(data['cal_curr']);
if (rN < 1 || rN !== rC) throw new Error('Kite row not found or differs: cal_new ' + rN + ', cal_curr ' + rC);
const cal = clone(data['cal_curr']);
if (KITE !== 'none') {
  cal.merges = cal.merges.filter(m => !(m.r <= rN && rN < m.r + m.nr));
  const row = cal.values[rN - 1];
  for (let c = 1; c < row.length; c++) row[c] = '';
  const src = origNew.values[rN - 1];
  origNew.merges.filter(m => m.r === rN).forEach(m => {
    const lab = String(src[m.c - 1]).trim();
    if (KITE === 'move' && /\(2d\)/.test(lab)) return;
    row[m.c - 1] = src[m.c - 1];
    cal.merges.push(clone(m));
  });
}
data['cal_new'] = cal;

// 2. configs: every _v2 := base
const twins = { 'NS_v2_weekday': 'NS_weekday' };
const copied = [];
Object.keys(data).forEach(k => {
  if (!/_v2/.test(k) || k === 'Ki_2d_v2') return;
  const base = twins[k] || k.replace(/_v2$/, '');
  if (data[base]) { data[k] = clone(data[base]); copied.push(k + ' := ' + base); }
});

// 3. Ki_2d_v2 := proposal, on the dump's own Ki_2d_v2 layout
const prop = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'builders', '_ki2d_rewards.json'), 'utf8'));
const sh = data['Ki_2d_v2'].values;
const hdrRow = sh.findIndex(r => String(r[0]).trim() === 'Position');
const msRow = sh.findIndex(r => String(r[0]).trim() === 'Milestone');
const H = sh[hdrRow].map(x => String(x).trim());
const col = (name) => { const j = H.indexOf(name); if (j < 0) throw new Error('no column ' + name); return j; };
const firstRes = col('Coins'), lastRes = col('ToF_Ticket');
for (let i = hdrRow + 1; i < sh.length; i++) {
  const p = Number(sh[i][0]); if (!(p >= 1)) continue;
  for (let j = firstRes; j <= lastRes; j++) sh[i][j] = 0;
  const band = prop.bands.find(b => p >= b.from && p <= b.to);
  if (band) Object.keys(band.rewards).forEach(r => { sh[i][col(r)] = band.rewards[r]; });
}
const ms = clone(prop.milestone);
if (MS != null) ms['Unlimited Lives'] = Number(MS);
for (let j = firstRes; j <= lastRes; j++) sh[msRow + 1][j] = 0;
Object.keys(ms).forEach(r => { sh[msRow + 1][col(r)] = ms[r]; });

// 4. cal_parsed over B..AI
const FIRST_ROW = 5, LAST_ROW = 25, FIRST_COL = 2, LAST_COL = 35;
const CAL_ALIAS = { 'Mystery Puzzle': 'Jigsaw Puzzle', 'Mystery Box': 'Jigsaw Puzzle', "Chuck's Flash Race": 'Flash Race' };
const norm = (v) => { const s = String(v).replace(/\n/g, ' ').trim(); return CAL_ALIAS[s] || s; };
const rows = [['calendar', 'event', 'start', 'dur']];
['cal_curr', 'cal_new'].forEach(n => {
  const v = data[n].values, merges = data[n].merges || [], covered = {};
  merges.forEach(m => {
    if (m.r < FIRST_ROW || m.r > LAST_ROW || m.c < FIRST_COL || m.c + m.nc - 1 > LAST_COL) return;
    const x = (v[m.r - 1] || [])[m.c - 1];
    if (x !== '' && x != null && String(x).trim() !== '') rows.push([n, norm(x), m.c - 1, m.nc]);
    for (let r = m.r; r < m.r + m.nr; r++) for (let c = m.c; c < m.c + m.nc; c++) covered[r + ',' + c] = true;
  });
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) for (let c = FIRST_COL; c <= LAST_COL; c++) {
    if (covered[r + ',' + c]) continue;
    const x = (v[r - 1] || [])[c - 1];
    if (x !== '' && x != null && String(x).trim() !== '') rows.push([n, norm(x), c - 1, 1]);
  }
});
data['cal_parsed'] = { values: rows, merges: [] };
// the album run's cached tables describe another calendar
['album_calibration', 'album_gains', 'album_summary'].forEach(k => { delete data[k]; });
data._meta = Object.assign({}, data._meta || {}, {
  fixture: 'kite2d (' + KITE + '): cal_new := cal_curr + cal_new Kite row; every _v2 := base; Ki_2d_v2 := proposal',
  built: new Date().toISOString() });
fs.writeFileSync(outFile, JSON.stringify(data));
console.log('written ' + outFile);
console.log('Kite on cal_new: ' + rows.filter(r => r[0] === 'cal_new' && /^Kite/.test(r[1])).map(r => r[1] + '@' + r[2] + 'x' + r[3]).join(', '));
console.log('Kite on cal_curr: ' + rows.filter(r => r[0] === 'cal_curr' && /^Kite/.test(r[1])).map(r => r[1] + '@' + r[2] + 'x' + r[3]).join(', '));
console.log('configs := base: ' + copied.length);
