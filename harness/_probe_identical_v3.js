// D67 evidence: on a workbook whose two calendars are identical, where does ECOGAINS_DIFF still
// differ, and how much of it was the collection rows' silent measured side?
//
//   node harness/_probe_identical_v3.js                 (defaults to --data v3)
//   node harness/_probe_identical_v3.js --data adjust
//
// Prints, per (segment, payer): every non-zero DIFF cell with the anchors on (as shipped) and the
// collection rows with COL_ANCHORED = false (the pre-D67 measured side), plus the one config cell
// behind the Season Pass Slingshot difference. Reuses _mock_cards.js's SpreadsheetApp mock and
// engine loader, like _mock_cloud.js and _mock_simfill.js do.
const fs = require('fs');
const path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function PROBE() {
  const CELLS = [['0-9', 'NONPAYER'], ['10-19', 'NONPAYER'], ['20-39', 'NONPAYER'], ['40-99', 'NONPAYER'], ['100+', 'NONPAYER'],
                 ['0-9', 'PAYER'], ['10-19', 'PAYER'], ['20-39', 'PAYER'], ['40-99', 'PAYER'], ['100+', 'PAYER']];
  const fresh = () => { _sheetValsCache = {}; Context.reset(); return Context.get(); };
  const ctx0 = fresh();
  const lanes = new Set([...Object.keys(ctx0.calCur), ...Object.keys(ctx0.calNew)]);
  const diffLanes = [...lanes].filter(l => JSON.stringify((ctx0.calCur[l] || []).map(i => [i.start, i.dur])) !== JSON.stringify((ctx0.calNew[l] || []).map(i => [i.start, i.dur])));
  console.log('\ncalendar lanes that differ: ' + (diffLanes.length ? diffLanes.join(', ') : 'none'));
  const sweep = (label) => {
    fresh();
    const byCat = {};
    CELLS.forEach(([seg, payer]) => {
      const dif = ECOGAINS_DIFF(payer, seg);
      CATEGORY_ORDER.forEach((cat, i) => RESOURCES.forEach((r, j) => {
        const v = num(dif[i][j]);
        if (Math.abs(v) > 1e-6) { const k = cat + ' / ' + r; byCat[k] = byCat[k] || { n: 0, max: 0, at: '' }; byCat[k].n++; if (Math.abs(v) > byCat[k].max) { byCat[k].max = Math.abs(v); byCat[k].at = seg + ' ' + payer; } }
      }));
    });
    console.log('\n' + label + ': non-zero DIFF cells (category / resource: cells of 10, largest |DIFF| at)');
    const keys = Object.keys(byCat);
    if (!keys.length) console.log('   none - DIFF is exactly 0 everywhere');
    keys.forEach(k => console.log('   ' + k.padEnd(36) + String(byCat[k].n).padStart(3) + '   ' + byCat[k].max.toFixed(3).padStart(10) + '  ' + byCat[k].at));
  };
  COL_ANCHORED = false; sweep('COL_ANCHORED = false (pre-D67)');
  COL_ANCHORED = true;  sweep('COL_ANCHORED = true (D67, as shipped)');
  // and with the one Season Pass challenge cell made identical: SP_lb_v2 := SP_lb
  if (data['SP_lb'] && data['SP_lb_v2']) {
    const keep = data['SP_lb_v2'];
    data['SP_lb_v2'] = JSON.parse(JSON.stringify(data['SP_lb']));
    sweep('D67 + SP_lb_v2 := SP_lb (what the workbook shows once that cell matches)');
    data['SP_lb_v2'] = keep;
  }
  // the Season Pass Slingshot cell
  const a = (data['SP_lb'] || {}).values || [], b = (data['SP_lb_v2'] || {}).values || [];
  const hdr = (a.find(r => String((r || [])[0]).trim() === 'Rank') || []);
  const diffs = [];
  for (let r = 0; r < Math.min(a.length, b.length); r++) for (let c = 0; c < Math.max((a[r] || []).length, (b[r] || []).length); c++) {
    const x = (a[r] || [])[c], y = (b[r] || [])[c];
    const nx = (x === '' || x == null) ? '' : x, ny = (y === '' || y == null) ? '' : y;
    if (String(nx) !== String(ny)) diffs.push('row ' + (r + 1) + ' (' + String((a[r] || [])[0]) + ') col ' + String.fromCharCode(65 + c) + ' (' + String(hdr[c] || '') + '): SP_lb ' + JSON.stringify(nx) + ' vs SP_lb_v2 ' + JSON.stringify(ny));
  }
  console.log('\nSP_lb vs SP_lb_v2 cells that differ: ' + (diffs.length ? '\n   ' + diffs.join('\n   ') : 'none'));
}

eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
