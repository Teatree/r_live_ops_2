// Build the 28-day-window fixture from a dump (2026-10-28):
//   * cal_new := cal_new_%NEW (values AND merges) - the user's stated next step
//   * row 4 of cal_curr and cal_new renumbered the way the user will do it: B4:F4 cleared,
//     G4 .. AH4 = 1 .. 28 (the window starts on the Monday in column G)
//   * cal_parsed: rebuilt from the merges for the two calendars, in GRID days (column - 1), exactly
//     what precomputeCalendars writes - so the fixture exercises the windowing on precomputed input
//
//   node harness/_make_window_fixture.js [--in _mockdata_v3d.json] [--out _mockdata_v3d_w28.json]
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const inFile = path.join(__dirname, arg('--in', '_mockdata_v3d.json'));
const outFile = path.join(__dirname, arg('--out', '_mockdata_v3d_w28.json'));
const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
if (!data['cal_new_%NEW']) throw new Error('no cal_new_%NEW in ' + inFile);

data['cal_new'] = JSON.parse(JSON.stringify(data['cal_new_%NEW']));
const FIRST = 7, LAST = 34;                      // G .. AH, 1-based columns
['cal_curr', 'cal_new'].forEach(n => {
  const row = data[n].values[3];                 // row 4
  for (let c = 2; c <= 34; c++) row[c - 1] = (c >= FIRST && c <= LAST) ? (c - FIRST + 1) : '';
});

// cal_parsed in grid days, from values + merges (the same rule as parseCalendarLive_)
const CAL_ALIAS = { 'Mystery Puzzle': 'Jigsaw Puzzle', 'Mystery Box': 'Jigsaw Puzzle', "Chuck's Flash Race": 'Flash Race' };
const norm = (v) => { const s = String(v).replace(/\n/g, ' ').trim(); return CAL_ALIAS[s] || s; };
const rows = [['calendar', 'event', 'start', 'dur']];
['cal_curr', 'cal_new'].forEach(n => {
  const v = data[n].values, merges = data[n].merges || [], covered = {};
  merges.forEach(m => {
    if (m.r < 5 || m.r > 25 || m.c < 2 || m.c > 34) return;
    const x = (v[m.r - 1] || [])[m.c - 1];
    if (x !== '' && x != null && String(x).trim() !== '') rows.push([n, norm(x), m.c - 1, m.nc]);
    for (let r = m.r; r < m.r + m.nr; r++) for (let c = m.c; c < m.c + m.nc; c++) covered[r + ',' + c] = true;
  });
  for (let r = 5; r <= 25; r++) for (let c = 2; c <= 34; c++) {
    if (covered[r + ',' + c]) continue;
    const x = (v[r - 1] || [])[c - 1];
    if (x !== '' && x != null && String(x).trim() !== '') rows.push([n, norm(x), c - 1, 1]);
  }
});
data['cal_parsed'] = { values: rows, merges: [] };
data._meta = Object.assign({}, data._meta || {}, {
  fixture: 'cal_new := cal_new_%NEW; row 4 renumbered G=1..AH=28 on both calendars; cal_parsed rebuilt',
  built: new Date().toISOString() });
fs.writeFileSync(outFile, JSON.stringify(data));
console.log('written ' + outFile + ' (' + (rows.length - 1) + ' parsed instances)');
