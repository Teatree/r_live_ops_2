// Mighty Ice Cream league-size sweep, read the way change_summary reads it: Mic_v2's 'League size' cell set to each
// size, then the change summary's own pass (csPopulation_ -> csCellRows_ -> csBlocks_), NEW per player per window.
// Prints the MiC row (VALUE + every resource it pays) for every segment band, whether any OTHER row moves, and
// whether album_gains stays valid (Mic_v2 is in the album inputs tag: an edit sends the Col rows to their own
// 50-season batch until Album completion is re-run).
//   node harness/_probe_mic_league.js [--data v3w] [--sizes 10,16.3,25,60]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3w');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const PRELUDE = CARDS.slice(0, CARDS.indexOf('// ---------------------------------------------------------------- 1. PackConfig reader'));
const _log = console.log; global.__say = _log; console.log = () => {};
function PROBE(){
  const say = global.__say, MIC = 'Mighty Ice Cream', SH = 'Mic_v2', WS = WAGER_SPECS[MIC];
  eval(fs.readFileSync(ENGINE('SimPerSegmentFill.gs'), 'utf8'));
  eval(fs.readFileSync(ENGINE('ChangeSummary.gs'), 'utf8'));
  const arg = k => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
  const micV = data[SH].values, stem = WS.leagueLabel.split(' (')[0].toLowerCase();
  const lr = micV.findIndex(r => String(r[0]).trim().toLowerCase().indexOf(stem) === 0);
  if (lr < 0) throw new Error('no League size row on ' + SH);
  const sheetLeague = micV[lr][1];
  const sizes = (arg('--sizes') || ('10,' + sheetLeague + ',20,25,30,40,50,60')).split(',').map(Number);
  const prices = csPrices_();
  const val = row => RESOURCES.reduce((a, r) => a + num(row[r]) * num(prices[r]), 0);
  const realFp = albumFingerprint_;   // the album inputs tag album_gains is saved under
  resetSheetCache_mock(); Context.reset();
  const run = (n) => {
    micV[lr][1] = n;
    resetSheetCache_mock(); Context.reset();
    const ctx = Context.get();
    const pop = csPopulation_(ctx), extras = csExportOnlyCats_(), cats = CATEGORY_ORDER.concat(extras);
    const t0 = Date.now(), cells = csCellRows_(ctx, extras, pop), blocks = csBlocks_(cells, cats, prices, ctx);
    const fp = realFp(), agFp = String(((sheetVals_('album_gains') || [])[1] || [])[1] || '');
    return { n, blocks, cats, secs: (Date.now() - t0) / 1000, colFromAlbumGains: fp === agFp, fp, agFp,
             league: wagerLeague_(MIC, SH) };
  };
  say('data: ' + (data._meta ? data._meta.source : '?') + '   League size cell (row ' + (lr + 1) + ') holds ' + sheetLeague);
  const runs = sizes.map(run);
  micV[lr][1] = sheetLeague;
  const baseIdx = Math.max(0, runs.findIndex(x => x.n === sheetLeague)), B = runs[baseIdx];
  runs.forEach(x => say('  league ' + String(x.n).padEnd(6) + ' engine reads ' + x.league.toFixed(2) + '   ' + x.secs.toFixed(1) + ' s   Col rows from album_gains: ' +
                        (x.colFromAlbumGains ? 'yes' : 'NO (inputs #' + x.fp + ' vs album_gains #' + x.agFp + ' -> 50 seeded seasons)')));
  const bands = B.blocks.filter(b => b.payer === 'All' || b.seg === B.blocks[0].seg);
  const bandKey = b => b.seg + ' / ' + b.payer;
  // 1. the MiC row: VALUE per player per window, NEW (CURRENT is 0: cal_curr runs no MiC)
  say('\nMighty Ice Cream row, NEW VALUE per player per window (change_summary table 3); CURRENT = ' +
      val(B.blocks[0].rows[MIC].cur).toFixed(1) + ' in every band');
  say('  ' + 'band'.padEnd(26) + runs.map(x => ('L=' + x.n).padStart(11)).join(''));
  bands.forEach(b => {
    const i = B.blocks.indexOf(b);
    say('  ' + bandKey(b).padEnd(26) + runs.map(x => val(x.blocks[i].rows[MIC].nw).toFixed(1).padStart(11)).join(''));
  });
  // 2. per resource, the top band
  const top = 0, paid = RESOURCES.filter(r => runs.some(x => Math.abs(num(x.blocks[top].rows[MIC].nw[r])) > 1e-9));
  say('\nMighty Ice Cream row, NEW per player per window by resource, band ' + bandKey(B.blocks[top]));
  say('  ' + 'resource'.padEnd(26) + runs.map(x => ('L=' + x.n).padStart(11)).join(''));
  paid.forEach(r => say('  ' + r.padEnd(26) + runs.map(x => num(x.blocks[top].rows[MIC].nw[r]).toFixed(3).padStart(11)).join('')));
  // 3. every other row: largest NEW VALUE move vs the sheet's league, over all bands
  say('\nOther rows: largest |NEW VALUE| move vs L=' + B.n + ' over all 21 bands (per player per window)');
  const moved = {};
  runs.forEach(x => x.blocks.forEach((b, i) => B.cats.forEach(cat => {
    if (cat === MIC) return;
    const d = Math.abs(val(b.rows[cat].nw) - val(B.blocks[i].rows[cat].nw)) + Math.abs(val(b.rows[cat].cur) - val(B.blocks[i].rows[cat].cur));
    if (d > 1e-9 && (!moved[cat] || d > moved[cat].d)) moved[cat] = { d, n: x.n, band: bandKey(b) };
  })));
  const mk = Object.keys(moved);
  if (!mk.length) say('  none - every other row is identical at every league size');
  mk.sort((a, b) => moved[b].d - moved[a].d).forEach(c => say('  ' + c.padEnd(26) + moved[c].d.toFixed(2).padStart(10) + '  (L=' + moved[c].n + ', ' + moved[c].band + ')'));
  // 3b. the card-sim rows (they draw MiC's places for its envelopes), per band
  ['Col - Sets', 'Col - Albums'].forEach(cat => {
    say('\n' + cat + ' row, NEW VALUE per player per window');
    say('  ' + 'band'.padEnd(26) + runs.map(x => ('L=' + x.n).padStart(11)).join(''));
    bands.forEach(b => { const i = B.blocks.indexOf(b);
      say('  ' + bandKey(b).padEnd(26) + runs.map(x => val(x.blocks[i].rows[cat].nw).toFixed(1).padStart(11)).join('')); });
  });
  // 4. the TOTAL row of the top bands: NEW VALUE and % vs CURRENT
  say('\nTOTAL row (all sources), VALUE per player per window: NEW and % vs CURRENT');
  say('  ' + 'band'.padEnd(26) + 'CURRENT'.padStart(10) + runs.map(x => ('L=' + x.n).padStart(16)).join(''));
  bands.forEach(b => {
    const i = B.blocks.indexOf(b), tot = (x, side) => B.cats.reduce((a, c) => a + val(x.blocks[i].rows[c][side]), 0);
    const cur = tot(B, 'cur');
    say('  ' + bandKey(b).padEnd(26) + cur.toFixed(0).padStart(10) +
        runs.map(x => { const nw = tot(x, 'nw'); return (nw.toFixed(0) + ' ' + (100 * (nw / cur - 1)).toFixed(2) + '%').padStart(16); }).join(''));
  });
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
