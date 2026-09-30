// Album-completion matrix probe (2026-09-30). NOT a gate - a measurement tool.
// Runs the card sim for the ten real segment x payer cells under any ENGINE directory and any DATA
// dump, with paired seeds, and writes per-cell statistics as JSON - so two engine revisions, two
// workbooks, or any combination can be compared cell for cell. Written for the vacation-changes
// review (reports/vacation_changes_review_2026-09-30.html); the JSON it produced is under
// analysis/out/vacation_review/.
//   node harness/_probe_album_matrix.js --engine <dir> --data <dump.json> --n 200 --seed 932341729
//        --out <file.json> [--flat-weights]
// --engine may point at engine/ or at a directory holding another revision of the .gs files.
// --data is resolved by the _mock_cards.js prelude (a bare file name is relative to harness/).
// --flat-weights injects a RarityWeights column of [1,1,1,1,1,1] into the mock PackConfig, which is
// what lets a rarity-weighting engine run on a pre-weights config (without the column that engine
// degrades to "every card is the lowest rarity" - see the report, finding C5).
// The prelude of _mock_cards.js declares `const data`, so it and the body below are evaluated as
// ONE string (same trick as _probe_album.js) - a separate eval would not see it.
const fs = require('fs'), path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ENGDIR = arg('--engine'), N = +arg('--n', 200), SEED = +arg('--seed', 932341729);
const OUT = arg('--out'), FLAT = process.argv.includes('--flat-weights');

const cards = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = cards.indexOf('// ---------------------------------------------------------------- 1. PackConfig reader');
if (CUT < 0) throw new Error('cut marker not found in _mock_cards.js');
const prelude = cards.slice(0, CUT)
  .replace("path.join(__dirname, '..', 'engine', f)", "path.join(" + JSON.stringify(ENGDIR) + ", f)");

function BODY() {
  if (FLAT) {
    const pc = data['PackConfig'].values;
    let hdr = -1;
    for (let i = 0; i < pc.length; i++) if (String(pc[i][0]).trim() === 'PACK DEFINITIONS') { hdr = i + 1; break; }
    if (hdr < 0) throw new Error('PACK DEFINITIONS not found');
    while (pc[hdr].length < 5) pc[hdr].push('');
    pc[hdr][4] = 'RarityWeights';
    for (let r = hdr + 1; r < pc.length && String(pc[r][0]).trim() !== ''; r++) {
      while (pc[r].length < 5) pc[r].push('');
      pc[r][4] = '[1, 1, 1, 1, 1, 1]';
    }
    _sheetValsCache = {};
  }
  const cfg = loadPackConfig_();
  const albumSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AlbumConfig');
  const cat = loadCardCatalog_(cfg, albumSheet);
  const ctx = Context.get();
  const perms = cloudPermutations_().filter(p => p.payer === 'PAYER' || p.payer === 'NONPAYER')
    .filter(p => ['0-9', '10-19', '20-39', '40-99', '100+'].includes(p.seg) && !(p.prof));
  const poolSize = Object.values(cat.buildFreshPool()).reduce((a, b) => a + b, 0);
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

  const out = { engine: ENGDIR, n: N, seed: SEED, flatWeights: FLAT, poolSize: poolSize,
                cardsimBuild: (typeof CARDSIM_BUILD !== 'undefined') ? CARDSIM_BUILD : '?',
                dataMeta: data._meta || null, cells: {} };
  const t0 = Date.now();
  perms.forEach((p, pi) => {
    const pre = cardSeasonPre_(p.seg, p.payer, ctx);
    const runs = [];
    for (let k = 0; k < N; k++) runs.push(runOneCardSeason_(p.seg, p.payer, playerSeed_(SEED, pi, k), cfg, cat, pre));
    const byTier = {}, bySrc = {};
    runs.forEach(r => {
      Object.keys(r.packsOpenedByTier || {}).forEach(t => { byTier[t] = (byTier[t] || 0) + (r.packsOpenedByTier[t] || 0) / N; });
      if (r.bySource) Object.keys(r.bySource).forEach(s => {
        const v = r.bySource[s]; const n = (typeof v === 'number') ? v : (v && typeof v.packs === 'number' ? v.packs : 0);
        bySrc[s] = (bySrc[s] || 0) + n / N;
      });
    });
    const cell = {
      label: p.label, seg: p.seg, payer: p.payer,
      albumRate: mean(runs.map(r => r.albumIdx >= 1 ? 1 : 0)),
      albumsMean: mean(runs.map(r => r.albumIdx)),
      packs: mean(runs.map(r => r.packsOpenedTotal)),
      cards: mean(runs.map(r => r.totalCardsDrawn)),
      cardsP95: pct(runs.map(r => r.totalCardsDrawn), 0.95),
      newCards: mean(runs.map(r => r.totalNew)),
      dupes: mean(runs.map(r => r.totalDupes)),
      starsEarned: mean(runs.map(r => r.starsEarned)),
      starsSpent: mean(runs.map(r => r.starsSpent)),
      chests: mean(runs.map(r => r.chestsBought || 0)),
      sets: mean(runs.map(r => r.setsCompletedTotal)),
      tofRuns: mean(runs.map(r => r.tofRuns || 0)),
      tofBanked: mean(runs.map(r => r.tofBanked || 0)),
      activeDays: mean(runs.map(r => r.activeDays || 0)),
      sharePoolExhausted: mean(runs.map(r => r.totalCardsDrawn > poolSize ? 1 : 0)),
      dayAlbumMean: mean(runs.filter(r => r.albumIdx >= 1).map(r => r.dayAlbumCompleted || 0)),
      byTier: byTier, bySource: bySrc,
      cellStats: (typeof albumCellStats_ === 'function') ? albumCellStats_(runs) : null
    };
    out.cells[p.label] = cell;
    console.error(p.label.padEnd(16), 'album', cell.albumRate.toFixed(3), 'packs', cell.packs.toFixed(1),
                  'cards', cell.cards.toFixed(1), 'poolExhausted', cell.sharePoolExhausted.toFixed(2),
                  ((Date.now() - t0) / 1000).toFixed(0) + 's');
  });
  out.popInfo = (typeof cellPopulations_ === 'function') ? cellPopulations_(ctx) : null;
  if (typeof albumPopulationStats_ === 'function' && out.popInfo) {
    const byCell = {}; Object.keys(out.cells).forEach(k => { byCell[k] = out.cells[k].cellStats; });
    try { out.popStats = albumPopulationStats_(byCell, out.popInfo); } catch (e) { out.popStatsError = String(e); }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.error('written', OUT, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
eval(prelude + '\n(' + BODY.toString() + ')();');
