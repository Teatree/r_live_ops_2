// Build the config-proposal evaluation fixture from a dump (2026-10-30, D79):
//   * cal_new := cal_curr (values AND merges) - user decision 2026-10-30: the proposals are judged
//     as a CONFIG-ONLY change on the A/B calendar, so both sides run the same calendar and every
//     difference is a config difference
//   * cal_parsed rebuilt from the merges for both calendars over B..AI (D79: the reader goes to AI),
//     in GRID days (column - 1), exactly what precomputeCalendars writes - the dump's own cal_parsed
//     is stale (the user had not re-run Precompute after moving the window to H..AI)
//
//   node harness/_make_eval_fixture.js [--in _mockdata_v3g.json] [--out _mockdata_v3g_eval.json]
const fs = require('fs');
const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const inFile = path.join(__dirname, arg('--in', '_mockdata_v3g.json'));
const outFile = path.join(__dirname, arg('--out', '_mockdata_v3g_eval.json'));
const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));

data['cal_new'] = JSON.parse(JSON.stringify(data['cal_curr']));

const FIRST_ROW = 5, LAST_ROW = 25, FIRST_COL = 2, LAST_COL = 35;     // B5:AI25
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
data._meta = Object.assign({}, data._meta || {}, {
  fixture: 'cal_new := cal_curr (values + merges); cal_parsed rebuilt over B..AI',
  built: new Date().toISOString() });
fs.writeFileSync(outFile, JSON.stringify(data));
console.log('written ' + outFile + ' (' + (rows.length - 1) + ' parsed instances)');
