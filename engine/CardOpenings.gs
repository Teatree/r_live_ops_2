/************************************************************************************************
 * CardOpenings.gs — card-collection (pack opening) simulator.
 * ---------------------------------------------------------------------------------------------
 * REQUIRES EcoGainsSim_v4.gs + EcoGainsSim_Daily.gs in the same project (uses Context, RESOURCES,
 * PACK_RES, SEG_TO_GAINS, num, sheetVals_, DAILY_DAYS, dailyPacksFor_).
 *
 * REWIRED 2026-08-03 (D19). What changed:
 *   - Pack ACQUISITION no longer comes from the 'EcoPackGains' sheet (deleted): its per-source
 *     rate table and hardcoded '1/0/0/1...' schedule strings were a parallel universe that never
 *     saw the redesigned calendar. Packs now come from dailyPacksFor_() — the same engine path
 *     that renders EcoGainsSim_Daily — priced off the _v2 reward ladders against cal_new.
 *   - Player archetypes no longer come from 'PlayerBehavior' (deleted): the sim runs a real
 *     (segment x payer) pair from data_seg_beh, selected in Col_Cards_Daily.
 *   - Season length is the engine's 33-day calendar window, not a 29-entry attendance array.
 *   - The draw is COUNT-PROPORTIONAL over the snap pool. The old per-pack rarity-probability grid
 *     is gone: it multiplied the pool counts, so rarity was applied twice. Pack tier now differs
 *     only by Cards/Open and the (newly implemented) pity table.
 *   - Chest buying reads the PackConfig CHEST PURCHASING panel (min stars / urgency ramp) instead
 *     of a hardcoded 0.85-of-season greedy sweep.
 *   - onOpen() REMOVED: it collided with EcoGainsSim_v4.gs's onOpen in the shared global
 *     namespace (one silently overrode the other). The menu item lives in that file now.
 *
 *  Stage 1 — acquisition: per-day expected packs per tier per source, on cal_new, for the
 *            selected segment x payer. Fractional expectations are accumulated into whole packs;
 *            the trailing fraction is resolved by a SEEDED Bernoulli so the granted count is
 *            unbiased (the old code always rounded the remainder UP, inflating every source).
 *  Stage 2 — opening: draw cards per pack (without replacement), classify new/dupe, accrue stars.
 *  Pity:     two independent mechanisms chasing DIFFERENT things.
 *            (a) RARITY pity — PackConfig PACK PITY CONFIG. `PityProbabilities` is indexed by the
 *                number of CONSECUTIVE MISSES of the target rarity, not by card slot:
 *                [0, 0.8, 0.8, 1.0] = "no help at first; miss once and the next pull has an 80%
 *                chance of the target; miss again, 80% again; miss a third time and the next pull
 *                is GUARANTEED". Entries past the end reuse the last value. The counter resets on
 *                any hit (forced or natural) and starts at 0 on every pack — it does NOT carry
 *                between packs. Target = the highest rarity that STILL HAS COPIES when
 *                PityForceHighestRarity is TRUE (so the empty Gold tier falls back to 5-star
 *                rather than making the pity unsatisfiable), else any rarity above the pool's
 *                most-stocked one.
 *            (b) DRY-STREAK pity — chases a NEW card, not a rare one: after
 *                PITY_CONFIG.threshold consecutive packs with zero new cards, the next pack
 *                forces its last card to be an unowned type. Reset on any new card (forced or
 *                natural) and on album advance.
 *  Chests:   once day >= Urgency Start Day and balance >= Min Stars, each triggering pack rolls
 *            the urgency probability (linear ramp from 0 at Urgency Start Day to End-of-Season
 *            Buy Probability on the final day); on success the player buys the most expensive
 *            affordable chest and opens its reward pack. Repeats while the roll keeps passing.
 *  Rewards:  Set completions (per album) and Album completions append reward info to the Note
 *            column, sourced from the PackConfig SET REWARDS / ALBUM REWARDS blocks. If a Set and
 *            an Album complete on the same pack the two blocks are separated by ` ====== `.
 *            Cumulative packs opened per star tier are shown with each Set completion (never
 *            reset). An album index beyond the defined rows reuses the last row (loops).
 *
 * SHEET CONTRACT — every PackConfig block is located by its column-A LABEL at run time, so the
 * sheet can be re-ordered or grown without touching this file. Blocks read:
 *   SEASON BASICS · RARITY DEFINITIONS · SNAP POOL · PACK DEFINITIONS · PACK PITY CONFIG
 *   STAR CHEST COSTS & REWARDS · CHEST PURCHASING · SET REWARDS · ALBUM REWARDS
 * (builders/_build_packconfig.py generates the sheet — never hand-edit it.)
 *
 * Col_Cards_Daily inputs:  B2 = segment ('0-9'…'100+', 'A. 0')   D2 = payer (NONPAYER|PAYER)
 *                    G2 = seed (blank -> generated and written back, so a run is reproducible)
 ************************************************************************************************/

var SHEET_SIM   = 'Col_Cards_Daily';   // renamed from 'SimOutput' 2026-08-18
var SHEET_PACK  = 'PackConfig';
var SHEET_ALBUM = 'AlbumConfig';

var SIM_SEG_CELL   = 'B2';
var SIM_PAYER_CELL = 'D2';
var SIM_SEED_CELL  = 'G2';

var OUT_START_ROW    = 57;                 // first row of the day-by-day pack log
var TOTALS_FIRST_ROW = 6;                  // running-totals block: one row per calendar day
var TALLY_FIRST_ROW  = 42;                 // SIMULATION TALLY value column (B)
var ALBUM_NAMES_POOL = ['Main', 'Super', 'Ultra', 'Mythic', 'Legendary'];

// Column order of the day-by-day pack log. THE ENGINE OWNS THIS, not the sheet: Col_Cards_Daily's header
// row is written by builders/_build_simoutput.py and lags behind until the sheet is re-imported, so
// anything deriving indices from the live header reads a stale layout. openPack builds its row from
// this list and harness/_mock_cards.js reads its indices from it — one definition, no drift.
// 'Source_Detail' added 2026-08-18: the ladder row a pack came from (rank / milestone / NS round).
var LOG_COLS = ['Day', 'Pack', 'Source', 'Source_Detail', 'Album', 'Cards Drawn', 'New', 'Dupes',
                'Stars Balance', 'Note'];
// Album/set grids live to the RIGHT of the pack log. The scan starts at the FIRST column past the
// log and runs wide, rather than assuming an exact offset: the builder leaves one spacer column
// (grids at L) but a hand-arranged sheet may butt them straight against the log (grids at K), and a
// scan starting at L silently finds no anchors there, paints nothing, and leaves whatever stale
// grid was on the sheet. Starting at LOG_COLS.length + 1 covers both and still cannot overlap the
// log, which ends at LOG_COLS.length.
function gridScanRange_(){
  return colLetter_(LOG_COLS.length + 1) + '55:' + colLetter_(LOG_COLS.length + 20) + '260';
}
function colLetter_(n){
  var s = '';
  while (n > 0){ var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
var GRID_DIM        = 3;

// PackConfig block labels (column A). Order matters only for bounding a block's scan.
var PC_BLOCKS = ['SEASON BASICS', 'RARITY DEFINITIONS', 'SNAP POOL', 'PACK DEFINITIONS',
                 'PACK PITY CONFIG', 'STAR CHEST COSTS & REWARDS', 'CHEST PURCHASING',
                 'SET REWARDS', 'ALBUM REWARDS'];

// Reward columns of the SET/ALBUM REWARDS blocks — the 21-column block every config sheet in the
// workbook shares (Coins .. 6-star Dly). row[0] is the ID; row[1..21] are these, in order.
var REWARD_COLUMNS = [
  { col: 1,  name: 'Coins' },            { col: 2,  name: 'SPT' },
  { col: 3,  name: 'SPT x2' },           { col: 4,  name: 'Red' },
  { col: 5,  name: 'Chuck' },            { col: 6,  name: 'Bomb' },
  { col: 7,  name: 'Slingshot' },        { col: 8,  name: 'Shuffle' },
  { col: 9,  name: 'Comet' },            { col: 10, name: 'Unlimited Lives' },
  { col: 11, name: 'Unlimited Red' },    { col: 12, name: 'Unlimited Chuck' },
  { col: 13, name: 'Unlimited Bomb' },   { col: 14, name: 'COOP Token' },
  { col: 15, name: 'Avatar' },           { col: 16, name: '1-star Dly' },
  { col: 17, name: '2-star Dly' },       { col: 18, name: '3-star Dly' },
  { col: 19, name: '4-star Dly' },       { col: 20, name: '5-star Dly' },
  { col: 21, name: '6-star Dly' }
];

// Dry-streak pity (mechanism (b) — the per-slot table is mechanism (a), read from the sheet).
var PITY_CONFIG = { enabled: true, threshold: 3 };

// --- Chapter (set) weight multipliers ----------------------------------
// Per-card draw multipliers indexed by set number (1-based: index 0 = Set 1). During each draw a
// card's effective weight = poolCount x chapterMult. (The per-card rarity weight was REMOVED
// 2026-08-03 — it was the second rarity multiplier the user asked to eliminate; rarity now enters
// only through how many copies of each card sit in the pool.)
//
//   beforeCompleted : multiplier while that set is still in progress in the current album
//   afterCompleted  : multiplier once that set has been completed in the current album
//
// State source: `setsCompletedInAlbum` (resets on album advance), so chapter weighting resets per
// album. Out-of-range / missing / non-finite / negative entries default to 1.0.
var CHAPTER_WEIGHTS = {
  beforeCompleted: [3.0, 2.5, 2.0, 1.5, 1.2, 1.0, 0.8, 0.6],
  afterCompleted:  [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
};

// -----------------------------------------------------------------------

function mulberry32(seed) {
  return function() {
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// '3-star Pack' / '3-star Dly' / '3-star' -> '3-star Pack' (the RESOURCES / PACK_RES spelling).
function normalizePackKey(name) {
  var m = String(name).match(/^(\d+)[-\s]*star/i);
  return m ? m[1] + '-star Pack' : String(name).trim();
}

// ============================== PackConfig reader ============================================
// Every block is found by scanning column A for its label; the block's rows are everything
// between it and the NEXT block label, filtered by a predicate. Note/annotation rows therefore
// cost nothing and row numbers are never load-bearing.
function loadPackConfig_(){
  var v = sheetVals_(SHEET_PACK);
  if (!v.length) throw new Error("Sheet '" + SHEET_PACK + "' is missing or empty.");

  function labelRow(label){
    for (var r = 0; r < v.length; r++) if (String(v[r][0]).trim() === label) return r;
    return -1;
  }
  // rows of a block, filtered by `keep(row)`. Bounded by the next block label so a runaway
  // predicate can never swallow the rest of the sheet.
  function blockRows(label, keep){
    var b = labelRow(label);
    if (b < 0) return [];
    var end = v.length;
    for (var i = 0; i < PC_BLOCKS.length; i++){
      var o = labelRow(PC_BLOCKS[i]);
      if (o > b && o < end) end = o;
    }
    var out = [];
    for (var r = b + 1; r < end; r++) if (keep(v[r])) out.push(v[r]);
    return out;
  }
  function isNum(x){ return x !== '' && x != null && isFinite(parseFloat(x)); }
  // a label -> value panel (col A label, col B value)
  function panel(label){
    var m = {};
    blockRows(label, function(row){ return String(row[0]).trim() !== '' && isNum(row[1]); })
      .forEach(function(row){ m[String(row[0]).trim()] = num(row[1]); });
    return m;
  }

  var basics = panel('SEASON BASICS');

  // rarity order, low -> high, from the RARITY DEFINITIONS block; also stars paid per duplicate
  var rarityOrder = [], starsOnDupe = {};
  blockRows('RARITY DEFINITIONS', function(row){ return String(row[0]).trim() !== '' && isNum(row[1]); })
    .forEach(function(row){
      var name = String(row[0]).trim();
      rarityOrder.push(name);
      starsOnDupe[name] = num(row[1]);
    });

  // SNAP POOL — the authoritative pool. 'TOTAL' and note rows are excluded by requiring the col-A
  // value to be a defined rarity.
  var validRarity = {};
  rarityOrder.forEach(function(x){ validRarity[x] = true; });
  var qtyByRarity = {};
  blockRows('SNAP POOL', function(row){ return validRarity[String(row[0]).trim()] && isNum(row[1]); })
    .forEach(function(row){ qtyByRarity[String(row[0]).trim()] = num(row[1]); });

  var isPackRow = function(row){ return /^\d+[-\s]*star/i.test(String(row[0]).trim()); };

  var cardsPerOpen = {};
  blockRows('PACK DEFINITIONS', function(row){ return isPackRow(row) && isNum(row[1]); })
    .forEach(function(row){ cardsPerOpen[normalizePackKey(row[0])] = Math.round(num(row[1])); });

  // PACK PITY CONFIG: 'PityProbabilities' is a bracketed list, one entry per card slot.
  var pity = {};
  blockRows('PACK PITY CONFIG', isPackRow).forEach(function(row){
    var probs = String(row[1] || '').replace(/[\[\]]/g, '').split(',')
      .map(function(s){ return parseFloat(s); })
      .filter(function(x){ return isFinite(x); });
    var force = String(row[2]).trim().toUpperCase();
    pity[normalizePackKey(row[0])] = {
      probs: probs.length ? probs : [0],
      forceHighest: (force === 'TRUE' || force === 'YES' || force === '1')
    };
  });

  var chests = blockRows('STAR CHEST COSTS & REWARDS', function(row){
      return String(row[0]).trim() !== '' && isNum(row[1]) && num(row[1]) > 0 &&
             String(row[2]).trim() !== '';
    })
    .map(function(row){ return { tier: String(row[0]).trim(), cost: num(row[1]),
                                 rewardPack: normalizePackKey(row[2]) }; })
    .sort(function(a, b){ return b.cost - a.cost; });

  var buy = panel('CHEST PURCHASING');

  function rewardTable(label){
    var map = {}, order = [];
    blockRows(label, function(row){ return String(row[0]).trim() !== '' && isNum(row[1]); })
      .forEach(function(row){
        var id = String(row[0]).trim(), rew = {};
        REWARD_COLUMNS.forEach(function(rc){ rew[rc.name] = num(row[rc.col]); });
        map[id] = rew;
        order.push(id);
      });
    return { map: map, order: order };
  }

  var cardsPerSet = Math.round(basics['Cards per Set'] || 0);
  var albumCount  = Math.round(basics['Album Count (before loop)'] || 0);
  if (!(cardsPerSet > 0)) throw new Error("PackConfig 'Cards per Set' is missing or <= 0.");
  if (!(albumCount > 0))  throw new Error("PackConfig 'Album Count (before loop)' is missing or <= 0.");
  if (!rarityOrder.length) throw new Error('PackConfig RARITY DEFINITIONS block is empty.');
  if (!Object.keys(cardsPerOpen).length) throw new Error('PackConfig PACK DEFINITIONS block is empty.');

  var albumNames = [];
  for (var i = 0; i < albumCount; i++) albumNames.push(ALBUM_NAMES_POOL[i] || ('Album ' + (i + 1)));

  return {
    cardsPerSet: cardsPerSet, albumCount: albumCount, albumNames: albumNames,
    rarityOrder: rarityOrder, starsOnDupe: starsOnDupe, qtyByRarity: qtyByRarity,
    cardsPerOpen: cardsPerOpen, pity: pity, chests: chests,
    buyMinStars:  buy['Min Stars to Consider Buying'],
    buyStartDay:  buy['Urgency Start Day'],
    buyEndProb:   buy['End-of-Season Buy Probability'],
    setRewards:   rewardTable('SET REWARDS'),
    albumRewards: rewardTable('ALBUM REWARDS')
  };
}

// ============================== formatting helpers ===========================================
function formatRewards_(rewards) {
  if (!rewards) return '(no rewards defined)';
  var parts = [];
  REWARD_COLUMNS.forEach(function(rc){
    var v = rewards[rc.name];
    if (v && v > 0) parts.push(rc.name + ': ' + v);
  });
  return parts.length ? parts.join(', ') : '(none)';
}
function getAlbumReward_(tbl, albumNum) {
  var id = 'Album ' + albumNum;
  if (tbl.map[id]) return tbl.map[id];
  if (!tbl.order.length) return null;
  return tbl.map[tbl.order[tbl.order.length - 1]];     // beyond the table -> last row loops
}
function formatPacksOpened_(packsOpenedByTier) {
  var parts = [];
  for (var tier = 1; tier <= 6; tier++){
    var cnt = packsOpenedByTier[tier] || 0;
    if (cnt > 0) parts.push(tier + '★: ' + cnt);
  }
  return parts.length ? parts.join(', ') : '(none)';
}

// ============================== main =========================================================
function SimulatePackOpenings() {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var simOut = ss.getSheetByName(SHEET_SIM);
  var album  = ss.getSheetByName(SHEET_ALBUM);
  if (!simOut) throw new Error("Sheet '" + SHEET_SIM + "' not found.");
  if (!album)  throw new Error("Sheet '" + SHEET_ALBUM + "' not found.");

  var cfg           = loadPackConfig_();
  var CARDS_PER_SET = cfg.cardsPerSet;
  var ALBUM_NAMES   = cfg.albumNames;

  // ---- selection: a real (segment x payer) pair, same keys the rest of the engine uses -------
  var seg   = String(simOut.getRange(SIM_SEG_CELL).getValue()   || '').trim();
  var payer = String(simOut.getRange(SIM_PAYER_CELL).getValue() || '').trim().toUpperCase();
  if (!seg)   throw new Error(SHEET_SIM + '!' + SIM_SEG_CELL + ' is empty, pick a player segment.');
  if (SEG_TO_GAINS[seg] == null)
    throw new Error('Unknown segment "' + seg + '" (use ' + Object.keys(SEG_TO_GAINS).join(' / ') + ').');
  if (payer !== 'NONPAYER' && payer !== 'PAYER')
    throw new Error(SHEET_SIM + '!' + SIM_PAYER_CELL + ' must be NONPAYER or PAYER (got "' + payer + '").');

  var seed = Number(simOut.getRange(SIM_SEED_CELL).getValue());
  if (!seed || !isFinite(seed)) {
    seed = Math.floor(Math.random() * 2147483647) + 1;
    simOut.getRange(SIM_SEED_CELL).setValue(seed);
  }
  var rand = mulberry32(seed | 0);
  // SEPARATE stream for the pack-log's "Earned From" labelling. Provenance is a reporting concern:
  // drawing it from `rand` would consume from the same sequence the card draws use, so simply
  // turning the labels on would shift every downstream pull and silently change results that have
  // nothing to do with labelling. Deterministic (derived from the same seed), independent of it.
  var provRand = mulberry32((seed | 0) ^ 0x5f3759df);

  var SEASON_DAYS = DAILY_DAYS;                        // the engine's calendar window (33)

  // ---- catalog (AlbumConfig) ----------------------------------------------------------------
  var validRarities = {};
  cfg.rarityOrder.forEach(function(x){ validRarities[x] = true; });
  var catLastRow  = album.getLastRow();
  var catalogData = catLastRow >= 3 ? album.getRange(3, 1, catLastRow - 2, 5).getValues() : [];
  var catalog = catalogData
    .filter(function(r){
      return r[0] && r[1] && r[4] && /^CARD/i.test(String(r[0])) && validRarities[String(r[4]).trim()];
    })
    .map(function(r){
      return { name: r[1], setNum: Number(r[2]), setName: String(r[3] == null ? '' : r[3]).trim(),
               rarity: String(r[4]).trim(), key: r[1] + ' ' + String(r[4]).trim() };
    });
  if (!catalog.length)
    throw new Error('AlbumConfig has no usable card rows (need a Card ID starting with "CARD" and ' +
                    'a Rarity defined in PackConfig RARITY DEFINITIONS).');

  var rarityOf = {}, setOf = {};
  catalog.forEach(function(c){ rarityOf[c.key] = c.rarity; setOf[c.key] = c.setNum; });
  var totalUnique = catalog.length;
  var rarityRank = {};
  cfg.rarityOrder.forEach(function(x, i){ rarityRank[x] = i; });   // higher index = rarer

  var cardKeysBySet = {};
  catalog.forEach(function(c){ (cardKeysBySet[c.setNum] = cardKeysBySet[c.setNum] || []).push(c.key); });

  // The pool: SNAP POOL quantities spread evenly across the catalog cards of each rarity
  // (remainder to the lowest indices). Rarity probability is therefore purely a pool property.
  function buildFreshPool() {
    var byRarity = {};
    catalog.forEach(function(c){ (byRarity[c.rarity] = byRarity[c.rarity] || []).push(c); });
    var p = {};
    for (var rarity in byRarity){
      var qty = cfg.qtyByRarity[rarity];
      if (!qty) { Logger.log('No SNAP POOL Qty Count for rarity "' + rarity + '", skipping'); continue; }
      var cards = byRarity[rarity], base = Math.floor(qty / cards.length), rem = qty - base * cards.length;
      cards.forEach(function(c, i){ p[c.key] = (i < rem) ? base + 1 : base; });
    }
    return p;
  }
  function poolBreakdown(p) {
    var counts = {}, total = 0;
    for (var key in p){
      var cnt = p[key];
      if (cnt <= 0) continue;
      counts[rarityOf[key]] = (counts[rarityOf[key]] || 0) + cnt;
      total += cnt;
    }
    return cfg.rarityOrder.map(function(r){ return r + '=' + (counts[r] || 0); }).join(', ') +
           ' (' + total + ' total)';
  }

  // === Mutable simulation state ==============================================================
  var albumIdx             = 0;
  var pool                 = buildFreshPool();
  var collection           = {};
  var collectionSize       = 0;
  var pityCounter          = 0;
  var balance              = 0;
  var starsEarned          = 0;
  var starsSpent           = 0;
  var totalCardsDrawn      = 0;
  var totalNew             = 0;
  var totalDupes           = 0;
  var setsCompletedTotal   = 0;
  var dayAlbumCompleted    = 0;
  var finalAlbumNoted      = false;
  var setsCompletedInAlbum = {};
  var packsOpenedByTier    = {1:0,2:0,3:0,4:0,5:0,6:0};
  var packsOpenedTotal     = 0;

  function owned(key){ return collection[key] === true; }
  function acquire(key){ if (!owned(key)){ collection[key] = true; collectionSize++; return true; } return false; }

  function chapterMultFor(setNum) {
    if (setNum === undefined || setNum === null) return 1.0;
    var idx = (setNum - 1) | 0;
    var arr = setsCompletedInAlbum[setNum] ? CHAPTER_WEIGHTS.afterCompleted
                                           : CHAPTER_WEIGHTS.beforeCompleted;
    if (!arr || idx < 0 || idx >= arr.length) return 1.0;
    var v = Number(arr[idx]);
    return (isFinite(v) && v >= 0) ? v : 1.0;
  }

  // One draw from the pool. Count-proportional (weight = copies x chapter multiplier) — the
  // rarity odds fall out of the pool composition and drift as copies are removed.
  // `filter` optionally restricts the eligible keys (pity). Returns null if nothing is eligible.
  function drawOne(filter) {
    var keys = [], wts = [], total = 0;
    for (var key in pool){
      var cnt = pool[key];
      if (cnt <= 0) continue;
      if (filter && !filter(key)) continue;
      var w = cnt * chapterMultFor(setOf[key]);
      if (w <= 0) continue;
      keys.push(key); wts.push(w); total += w;
    }
    if (total <= 0) return null;
    var r = rand() * total;
    for (var i = 0; i < keys.length; i++){
      r -= wts[i];
      if (r < 0){ pool[keys[i]] -= 1; return keys[i]; }
    }
    var last = keys[keys.length - 1];
    pool[last] -= 1;
    return last;
  }

  // copies remaining per rarity, from the live pool
  function poolRarityCounts() {
    var counts = {};
    for (var key in pool){
      if (pool[key] <= 0) continue;
      counts[rarityOf[key]] = (counts[rarityOf[key]] || 0) + pool[key];
    }
    return counts;
  }

  // The rarities a pity pull is CHASING — i.e. what counts as a "hit" and what a forced draw is
  // restricted to. Recomputed per draw because the pool depletes as the season runs.
  //   forceHighest TRUE  -> exactly the highest rarity that STILL HAS COPIES. This is also the
  //                         empty-tier fallback (user decision): Gold ships at Qty 0, so a 6-star
  //                         pack's pity resolves to 5★ until Gold has stock, instead of never
  //                         being satisfiable.
  //   forceHighest FALSE -> any rarity strictly ABOVE the most-stocked rarity in the pool
  //                         ("better than what the pack usually gives" — a softer pity).
  // Returns a {rarity: true} set, or null when nothing qualifies (pity then does nothing).
  function pityTargets(forceHighest) {
    var counts = poolRarityCounts(), out = {}, any = false, r;
    if (forceHighest){
      var best = null, bestRank = -1;
      for (r in counts){
        var rk = rarityRank[r];
        if (rk > bestRank){ bestRank = rk; best = r; }
      }
      if (best == null) return null;
      out[best] = true;
      return out;
    }
    var modal = null, modalCnt = -1;
    for (r in counts) if (counts[r] > modalCnt){ modalCnt = counts[r]; modal = r; }
    if (modal == null) return null;
    for (r in counts) if (rarityRank[r] > rarityRank[modal]){ out[r] = true; any = true; }
    return any ? out : null;
  }

  function openPack(packName, source, day, detail) {
    var key   = normalizePackKey(packName);
    var nCard = cfg.cardsPerOpen[key];
    if (!nCard) { Logger.log('No PACK DEFINITIONS row for "' + packName + '", skipping'); return null; }
    var pityCfg = cfg.pity[key] || { probs: [0], forceHighest: false };

    var tierMatch = key.match(/^(\d+)-star/);
    if (tierMatch){
      var tier = Number(tierMatch[1]);
      packsOpenedByTier[tier] = (packsOpenedByTier[tier] || 0) + 1;
    }
    packsOpenedTotal++;

    var dryPityActive = PITY_CONFIG.enabled && pityCounter >= PITY_CONFIG.threshold;
    var startAlbum = ALBUM_NAMES[albumIdx];
    var drawn = [], newCards = [], dupes = [];
    var setCompletionNotes = [];
    var albumNote = '';

    // (a) RARITY PITY — `PityProbabilities` is indexed by the number of CONSECUTIVE MISSES so far,
    // not by card slot: probs[0] applies to a pull with no misses behind it, probs[1] after one
    // miss, probs[2] after two, and so on; entries past the end reuse the last value. So
    // [0, 0.8, 0.8, 1.0] reads "no help at first; miss once and the next pull has an 80% chance;
    // miss again, another 80%; miss a third time and the next pull is GUARANTEED".
    // The counter RESETS to 0 the moment a pull lands on the target rarity — whether pity forced
    // it or the player got there naturally — and starts at 0 on every pack open (it does NOT
    // carry between packs).
    var pityMiss = 0;

    for (var i = 0; i < nCard; i++){
      var isLast = (i === nCard - 1);
      var targets = pityTargets(pityCfg.forceHighest);
      var p = pityCfg.probs[Math.min(pityMiss, pityCfg.probs.length - 1)];
      var cardKey = null;
      if (targets && p > 0 && rand() < p)
        cardKey = drawOne(function(k){ return targets[rarityOf[k]] === true; });
      // (b) dry-streak pity on the last card (independent mechanism: chases a NEW card, not a rare one)
      if (!cardKey && dryPityActive && isLast && newCards.length === 0)
        cardKey = drawOne(function(k){ return !owned(k); });
      if (!cardKey) cardKey = drawOne(null);
      if (!cardKey) { Logger.log('Pool exhausted mid-pack on day ' + day); break; }

      // hit -> reset, miss -> escalate. `targets` is recomputed each draw off the live pool, so a
      // rarity that runs out mid-pack stops counting as the thing being chased.
      pityMiss = (targets && targets[rarityOf[cardKey]] === true) ? 0 : pityMiss + 1;

      drawn.push(cardKey);
      totalCardsDrawn++;

      if (acquire(cardKey)){
        newCards.push(cardKey);
        totalNew++;

        var setNum = setOf[cardKey];
        if (setNum !== undefined && !setsCompletedInAlbum[setNum]){
          var setCards = cardKeysBySet[setNum] || [];
          if (setCards.length && setCards.every(owned)){
            setsCompletedInAlbum[setNum] = true;
            setsCompletedTotal++;
            var setId = 'Set ' + setNum;
            setCompletionNotes.push(setId + ' completed | Rewards: ' +
              formatRewards_(cfg.setRewards.map[setId]) + ' | packs opened: ' +
              formatPacksOpened_(packsOpenedByTier));
          }
        }

        if (collectionSize === totalUnique){
          var completedAlbumNum = albumIdx + 1;
          var albumRewardStr = formatRewards_(getAlbumReward_(cfg.albumRewards, completedAlbumNum));
          if (!dayAlbumCompleted) dayAlbumCompleted = day;
          if (albumIdx < ALBUM_NAMES.length - 1){
            albumNote = ALBUM_NAMES[albumIdx] + ' -> ' + ALBUM_NAMES[albumIdx + 1] +
                        ' | Album rewards: ' + albumRewardStr + ' | Pool leftover: ' + poolBreakdown(pool);
            albumIdx            += 1;
            pool                 = buildFreshPool();
            collection           = {};
            collectionSize       = 0;
            pityCounter          = 0;
            setsCompletedInAlbum = {};
          } else if (!finalAlbumNoted){
            albumNote = ALBUM_NAMES[albumIdx] + ' completed (final album) | Album rewards: ' +
                        albumRewardStr + ' | Pool leftover: ' + poolBreakdown(pool);
            finalAlbumNoted = true;
          }
        }
      } else {
        dupes.push(cardKey);
        totalDupes++;
        var st = cfg.starsOnDupe[rarityOf[cardKey]] || 0;
        balance += st;
        starsEarned += st;
      }
    }

    pityCounter = newCards.length > 0 ? 0 : pityCounter + 1;

    var note = '', setBlock = setCompletionNotes.join(' | ');
    if (setBlock && albumNote)  note = albumNote + ' ====== ' + setBlock;
    else if (setBlock)          note = setBlock;
    else if (albumNote)         note = albumNote;

    return [day, packName, source, detail || '', startAlbum,
            drawn.join(', '), newCards.join(', '), dupes.join(', '), balance, note];
  }

  // Chest purchasing: gated by Min Stars + a linear urgency ramp to the final day (PackConfig
  // CHEST PURCHASING). Missing/blank parameters degrade to "never buy" rather than to the old
  // hardcoded greedy sweep — a silent behaviour change would be worse than an obvious zero.
  var minStars  = isFinite(cfg.buyMinStars) ? cfg.buyMinStars : Infinity;
  var startDay  = isFinite(cfg.buyStartDay) ? cfg.buyStartDay : Infinity;
  var endProb   = isFinite(cfg.buyEndProb)  ? cfg.buyEndProb  : 0;
  function buyProbability(day){
    if (!(day >= startDay) || !(endProb > 0)) return 0;
    var span = SEASON_DAYS - startDay;
    if (span <= 0) return endProb;
    return Math.max(0, Math.min(1, endProb * (day - startDay) / span));
  }
  function tryBuyChests(day, output) {
    if (!cfg.chests.length) return;
    var p = buyProbability(day);
    if (p <= 0) return;
    while (balance >= minStars && rand() < p){
      var chest = null;
      for (var i = 0; i < cfg.chests.length; i++)
        if (balance >= cfg.chests[i].cost){ chest = cfg.chests[i]; break; }
      if (!chest) break;
      balance     -= chest.cost;
      starsSpent  += chest.cost;
      var row = openPack(chest.rewardPack, chest.tier + ' Chest Opened - ' + chest.rewardPack, day,
                         'bought with ' + chest.cost + ' stars');
      if (!row){
        Logger.log("Couldn't open " + chest.tier + ' chest reward "' + chest.rewardPack + '" - refunding');
        balance    += chest.cost;
        starsSpent -= chest.cost;
        break;
      }
      output.push(row);
    }
  }

  // === Stage 1: pack acquisition from the simulated calendar ================================
  var simCtx = Context.get();
  var packFlow = dailyPacksFor_(seg, payer, simCtx);

  // ---- attendance + session detail for the empty-day rows -------------------------------------
  // An empty row used to say only '(nothing)', which conflates two very different days: the player
  // never opened the game, or they played a full session and no source happened to drop a pack.
  // Attendance is drawn per day from the segment's weekday/weekend active rate, on its OWN seeded
  // stream so it cannot perturb a card draw. REPORTING LAYER ONLY — the pack expectations already
  // carry attendance inside reach(), so this draw explains the day, it does not gate any grant.
  // Consistency: a day that granted a pack is shown as played regardless of the draw, since
  // receiving a reward implies activity.
  var beh = simCtx.ds.beh(seg, payer);
  var pWd = num(beh.weekday_active_rate), pWe = num(beh.weekend_active_rate);
  var attRand = mulberry32((seed | 0) ^ 0x9e3779b9);
  var playedOn = [];
  for (var ad = 1; ad <= SEASON_DAYS; ad++)
    playedOn[ad] = attRand() < (isWeekend_(ad) ? pWe : pWd);
  // Per ACTIVE day, from data_seg_beh — what an average day in this segment looks like.
  var mins  = num(beh.minutes_per_active_day);
  var sess  = num(beh.sessions_per_active_day);
  var lvlsP = num(beh.levels_played_per_active_day);
  var lvlsC = num(beh.levels_completed_per_active_day);
  function sessionNote_(){
    var bits = [];
    if (mins  > 0) bits.push(mins.toFixed(0) + ' min');
    if (sess  > 0) bits.push(sess.toFixed(1) + ' sessions');
    if (lvlsC > 0) bits.push(lvlsC.toFixed(0) + ' levels completed' +
                             (lvlsP > 0 ? ' of ' + lvlsP.toFixed(0) + ' played' : ''));
    return bits.length ? bits.join(', ') + '  (segment average for an active day)' : '';
  }
  var packOpens = [], expectedTotal = 0;
  // A source's pack expectation for a tier is a SUM over ladder rows (ranks / milestones / rounds),
  // so a single granted pack has no one true origin — it is a draw from that mixture. Pick the row
  // proportional to its share of E, off provRand — a SEPARATE seeded stream, so switching labelling
  // on cannot perturb a single card draw — and the long-run mix of labels matches the model that
  // produced the count.
  function pickOrigin(src, tierName){
    var rows = src.prov && src.prov[tierName];
    if (!rows || !rows.length) return '';
    var tot = 0, i;
    for (i = 0; i < rows.length; i++) tot += rows[i].weight;
    if (!(tot > 0)) return '';
    if (rows.length === 1) return rows[0].label;
    var x = provRand() * tot;
    for (i = 0; i < rows.length; i++){ x -= rows[i].weight; if (x <= 0) return rows[i].label; }
    return rows[rows.length - 1].label;
  }
  packFlow.bySource.forEach(function(src){
    for (var tier = 0; tier < PACK_RES.length; tier++){
      var acc = 0, lastDay = -1;
      for (var d = 0; d < SEASON_DAYS; d++){
        var rate = num(src.days[d][tier]);
        if (rate <= 0) continue;
        expectedTotal += rate;
        lastDay = d;
        acc += rate;
        while (acc >= 1){
          packOpens.push({ day: d + 1, packName: PACK_RES[tier], source: src.cat,
                           detail: pickOrigin(src, PACK_RES[tier]) });
          acc -= 1;
        }
      }
      // Trailing fraction: a SEEDED Bernoulli, so the granted count is unbiased (E[granted] ==
      // the simulated expectation). The old EcoPackGains path always rounded this up.
      if (acc > 1e-12 && lastDay >= 0 && rand() < acc)
        packOpens.push({ day: lastDay + 1, packName: PACK_RES[tier], source: src.cat,
                         detail: pickOrigin(src, PACK_RES[tier]) });
    }
  });
  packOpens.sort(function(a, b){ return a.day - b.day; });
  Logger.log('Stage 1: ' + packOpens.length + ' packs granted (expected ' +
             expectedTotal.toFixed(2) + ') for ' + seg + ' ' + payer);

  // === Stage 2: walk every day; open packs, sweep chests, snapshot running totals ============
  var output = [], daily = [], packIdx = 0;
  for (var day = 1; day <= SEASON_DAYS; day++){
    var rowsBefore = output.length;

    while (packIdx < packOpens.length && packOpens[packIdx].day === day){
      var open = packOpens[packIdx];
      var row = openPack(open.packName, open.source, day, open.detail);
      if (row){
        output.push(row);
        tryBuyChests(day, output);
      }
      packIdx++;
    }

    if (output.length === rowsBefore){
      var played = playedOn[day];
      output.push([day, '', played ? '(played, no pack dropped)' : '(did not play)',
                   played ? sessionNote_() : '', ALBUM_NAMES[albumIdx],
                   '', '', '', balance, '']);
    }

    daily.push([day, balance, collectionSize,
                totalUnique ? collectionSize / totalUnique : 0,
                countKeys_(setsCompletedInAlbum), albumIdx + 1, packsOpenedTotal]);
  }
  Logger.log('Stage 2: ' + output.length + ' output rows.');

  // --- write running totals ------------------------------------------------------------------
  simOut.getRange(TOTALS_FIRST_ROW, 1, SEASON_DAYS, daily[0].length).setValues(daily);

  // --- write tally ---------------------------------------------------------------------------
  var tally = [
    [packsOpenedTotal], [totalCardsDrawn], [totalNew], [totalDupes],
    [starsEarned], [starsSpent], [balance], [setsCompletedTotal],
    [albumIdx + 1], [dayAlbumCompleted || '-'],
    [Math.round(expectedTotal * 100) / 100], [seg + ' / ' + payer]
  ];
  simOut.getRange(TALLY_FIRST_ROW, 2, tally.length, 1).setValues(tally);

  // --- write pack log ------------------------------------------------------------------------
  // STALE-SHEET GUARD. The log clear below wipes LOG_COLS.length columns. If Col_Cards_Daily is still the
  // pre-2026-08-18 layout its Album/Set labels sit in column J, INSIDE that span, so the clear would
  // silently destroy the first column of every 3x3 grid — the grids then render 2 wide and nothing
  // reports an error. Detect it and stop before writing anything.
  var stale = staleGridColumn_(simOut);
  if (stale){
    var msg = 'Col_Cards_Daily is the OLD layout: Album/Set labels found in column ' + stale +
              ', inside the pack log (A..' + colLetter_(LOG_COLS.length) + '). Re-import ' +
              'display/SimOutput_v2.xlsx: the log gained a "Source_Detail" column and the grids ' +
              'moved to ' + colLetter_(LOG_COLS.length + 2) + '. Nothing was written.';
    Logger.log(msg);
    SpreadsheetApp.getActive().toast(msg, 'SimulatePackOpenings - STOPPED', 15);
    throw new Error(msg);
  }
  var outCols = LOG_COLS.length;
  var lastRow = simOut.getLastRow();
  if (lastRow >= OUT_START_ROW)
    simOut.getRange(OUT_START_ROW, 1, lastRow - OUT_START_ROW + 1, outCols).clearContent();
  if (output.length)
    simOut.getRange(OUT_START_ROW, 1, output.length, outCols).setValues(output);

  writeAlbumGrids_(simOut, catalog, collection, albumIdx, CARDS_PER_SET);

  SpreadsheetApp.getActive().toast(
    'Opened ' + packsOpenedTotal + ' packs (expected ' + expectedTotal.toFixed(1) + '), ' +
    seg + ' ' + payer + ', ' + ALBUM_NAMES[albumIdx] + ' (catalog ' + totalUnique +
    ', balance ' + balance + ', seed ' + seed + ')',
    'SimulatePackOpenings', 6);
  return packsOpenedTotal;
}

function countKeys_(o){ var n = 0; for (var k in o) if (o[k]) n++; return n; }

/** Column LETTER of any 'Album #N' / 'Set #N' label sitting inside the pack log's own columns,
 *  or '' when the sheet layout is current. Cheap scan of the log block's header-ish rows. */
function staleGridColumn_(simOut){
  var n = LOG_COLS.length;
  var rng = simOut.getRange(OUT_START_ROW - 2, 1, 8, n);
  var v = rng.getValues();
  for (var r = 0; r < v.length; r++)
    for (var c = 0; c < v[r].length; c++){
      var t = String(v[r][c] == null ? '' : v[r][c]).trim();
      if (/^(Album|Set)\s*#\s*\d+$/i.test(t)) return colLetter_(c + 1);
    }
  return '';
}

/** Finds "Album #N" and "Set #N" labels in the grid area. Returns { albumNum: { setNum: {row,col} } }
 *  where each Set is attached to the most recent Album label above-left of it. */
function findGridAnchors_(simOut) {
  var range  = simOut.getRange(gridScanRange_());
  var values = range.getValues();
  var r0 = range.getRow(), c0 = range.getColumn();
  var labels = [];
  values.forEach(function(row, ri){
    row.forEach(function(cell, ci){
      if (!cell) return;
      var s = String(cell).trim(), m;
      if ((m = s.match(/^Album\s*#\s*(\d+)$/i)))
        labels.push({ type:'album', num:Number(m[1]), row:r0 + ri, col:c0 + ci });
      else if ((m = s.match(/^Set\s*#\s*(\d+)$/i)))
        labels.push({ type:'set', num:Number(m[1]), row:r0 + ri, col:c0 + ci });
    });
  });
  labels.sort(function(a, b){ return a.row - b.row || a.col - b.col; });
  var anchors = {}, currentAlbum = 1;
  labels.forEach(function(l){
    if (l.type === 'album'){ currentAlbum = l.num; return; }
    anchors[currentAlbum] = anchors[currentAlbum] || {};
    if (!anchors[currentAlbum][l.num]) anchors[currentAlbum][l.num] = { row: l.row, col: l.col };
  });
  return anchors;
}

/** Paints each labeled Album's 3x3 set grids:
 *   Album # < current -> every card shown (that album was completed)
 *   Album # == current -> the in-progress collection
 *   Album # > current -> blank (not reached) */
function writeAlbumGrids_(simOut, catalog, collection, albumIdx, cardsPerSet) {
  var anchors = findGridAnchors_(simOut);
  if (!Object.keys(anchors).length){
    Logger.log('No Album/Set labels found in ' + gridScanRange_());
    return;
  }
  var bySet = {};
  catalog.forEach(function(c){ (bySet[c.setNum] = bySet[c.setNum] || []).push(c); });
  var full = {};
  catalog.forEach(function(c){ full[c.key] = true; });
  var currentAlbumNum = albumIdx + 1;

  Object.keys(anchors).forEach(function(albumNumStr){
    var albumNum = Number(albumNumStr), use;
    if (albumNum < currentAlbumNum)       use = full;
    else if (albumNum === currentAlbumNum) use = collection;
    else                                   use = {};
    var setAnchors = anchors[albumNumStr];
    Object.keys(setAnchors).forEach(function(setNumStr){
      var setNum = Number(setNumStr), anchor = setAnchors[setNumStr];
      var cards = bySet[setNum] || [];
      if (cards.length > cardsPerSet)
        Logger.log('Set #' + setNum + ' has ' + cards.length + ' cards, clipping to ' + cardsPerSet);
      // Set NAME beside the 'Set #N' anchor. AlbumConfig has carried a 'Set Name' column all along
      // ('Skull Isle', ...) and nothing was writing it, so every grid read as an anonymous 'Set #3'.
      // Written to the RIGHT of the label, never over it: findGridAnchors_ locates grids by that
      // exact 'Set #N' text, so overwriting it would make the grids unfindable on the next run.
      var label = cards.length ? cards[0].setName : '';
      if (label) simOut.getRange(anchor.row, anchor.col + 1).setValue(label);
      var grid = [['','',''],['','',''],['','','']];
      cards.slice(0, cardsPerSet).forEach(function(c, i){
        if (use[c.key]) grid[Math.floor(i / GRID_DIM)][i % GRID_DIM] = c.rarity;
      });
      var rng = simOut.getRange(anchor.row + 1, anchor.col, GRID_DIM, GRID_DIM);
      rng.setValues(grid);
      rng.setHorizontalAlignment('center');
    });
  });
}
