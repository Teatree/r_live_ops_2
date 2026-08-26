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
 *            column AND are totalled as ECO GAINS (2026-08-21) into the SIMULATION TALLY, per
 *            source, so the collection feature's contribution to the economy is a number rather
 *            than only note text. Sourced from the PackConfig SET REWARDS / ALBUM REWARDS blocks. If a Set and
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
// COLLECTION ECO GAINS block: labels in column D, values in column E, four rows from this one.
// Beside the tally, not below it - the tally starts at row 42 and the pack log's bar is at row 55,
// so appending rows there would run the two blocks into each other.
var REWARD_TALLY_ROW = 42;
var REWARD_TALLY_COL = 4;                  // D = labels, E = values
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
// ONE definition of where the grid block starts, shared with builders/_build_simoutput.py
// (GRID_C0 = len(LOG_HDRS) + GRID_COL_OFFSET). They drifted once already: the engine's self-heal
// wrote at K while the builder wrote at L, which would have left two label blocks in the scan range
// and made the anchors ambiguous. Keep the two in step.
var GRID_COL_OFFSET = 2;
function gridCol_(){ return LOG_COLS.length + GRID_COL_OFFSET; }
// The SCAN still starts one column earlier than the block, so a legacy sheet whose grids butt
// straight against the log is still found rather than silently ignored.
function gridScanRange_(){
  return colLetter_(LOG_COLS.length + 1) + '55:' + colLetter_(LOG_COLS.length + 20) + '260';
}
function colLetter_(n){
  var s = '';
  while (n > 0){ var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}
// Grid shape. 3x3 is only the DEFAULT: the real shape is derived from PackConfig 'Cards per Set' so
// raising that value cannot make the painter index past the end of a hardcoded 3-row array.
var GRID_DIM        = 3;
function gridShape_(cardsPerSet){
  var n = Math.max(1, Math.round(cardsPerSet || GRID_DIM * GRID_DIM));
  var w = Math.ceil(Math.sqrt(n));
  return { w: w, h: Math.ceil(n / w) };
}

// PackConfig block labels (column A). Order matters only for bounding a block's scan.
var PC_BLOCKS = ['SEASON BASICS', 'RARITY DEFINITIONS', 'SNAP POOL', 'PACK DEFINITIONS',
                 'PACK PITY CONFIG', 'STAR CHEST COSTS & REWARDS', 'CHEST PURCHASING',
                 'SET REWARDS', 'ALBUM REWARDS', 'ALBUM SET SKEW'];

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
//
// AUTHORED ON THE SHEET: `beforeCompleted` below is only the FALLBACK. The live weights come from
// PackConfig's 'ALBUM SET SKEW' block (one row per album, one 'SET #n' column per set), read by
// loadPackConfig_ into cfg.albumSetSkew and applied in chapterMultFor. The block was ignored until
// 2026-08-25 — a 900 typed on the sheet was inert and the run silently used these constants.
// `afterCompleted` stays in code: the sheet has no before/after dimension to author.
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

  // ALBUM SET SKEW: one row per ALBUM (col A 'Album 1', 'Album 2', ...), one column per set,
  // located by its 'SET #n' header rather than by position — so the sheet can grow a column or
  // re-order without silently re-assigning every weight. Read into a dense array indexed by
  // set-1, blanks defaulting to 1.0 (NEUTRAL, not "skip"): an earlier reader dropped empty cells
  // with `continue`, which shifted every later set one place left the moment one cell was blank.
  // Absent block -> [] -> chapterMultFor falls back to the CHAPTER_WEIGHTS constant, so older
  // PackConfig sheets keep working unchanged.
  var albumSetSkew = [];
  (function(){
    var b = labelRow('ALBUM SET SKEW');
    if (b < 0) return;
    var setCol = {}, maxSet = 0;                       // 'SET #n' header -> column index
    for (var r = b + 1; r < v.length; r++){
      var row = v[r] || [], hit = false;
      for (var c = 1; c < row.length; c++){
        var m = /^SET\s*#?\s*(\d+)$/i.exec(String(row[c]).trim());
        if (!m) continue;
        hit = true;
        var n = Number(m[1]);
        if (setCol[n] == null){ setCol[n] = c; if (n > maxSet) maxSet = n; }
      }
      if (hit) break;
      if (/^album\s*\d+/i.test(String(row[0]).trim())) break;   // rows started; no header found
    }
    if (!maxSet) return;                               // header row absent -> leave the fallback
    blockRows('ALBUM SET SKEW', function(row){ return /^album\s*\d+/i.test(String(row[0]).trim()); })
      .forEach(function(row){
        var w = [];
        for (var s = 1; s <= maxSet; s++){
          var raw = (setCol[s] != null) ? row[setCol[s]] : '';
          var x = parseFloat(String(raw).trim());
          w.push((isFinite(x) && x >= 0) ? x : 1.0);   // blank / junk / negative -> neutral
        }
        albumSetSkew.push(w);
      });
  })();

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
    albumRewards: rewardTable('ALBUM REWARDS'),
    albumSetSkew: albumSetSkew
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
// Every function this file needs from its companions, and which file each lives in. All .gs files
// in an Apps Script project share one namespace, so a companion that was not re-pasted fails at the
// moment of use with a bare "X is not defined" that names no file. Checked up front instead, so the
// message says exactly which file to paste.
var CARD_SIM_COMPANIONS = [
  ['Context',         'EcoGainsSim_v4.gs'],
  ['packRungs_',      'EcoGainsSim_v4.gs'],
  ['spPackTiers_',    'EcoGainsSim_v4.gs'],
  ['isWeekend_',      'EcoGainsSim_v4.gs'],
  ['dailyPacksFor_',  'EcoGainsSim_Daily.gs'],
  ['packGrantPlan_',  'EcoGainsSim_Daily.gs'],
  ['DAILY_LASTDAY',   'EcoGainsSim_Daily.gs']
];
function requireCompanions_(){
  var missingBy = {};
  CARD_SIM_COMPANIONS.forEach(function(pair){
    var ok;
    try { ok = (eval('typeof ' + pair[0]) !== 'undefined'); } catch (e){ ok = false; }
    if (!ok) (missingBy[pair[1]] = missingBy[pair[1]] || []).push(pair[0]);
  });
  var files = Object.keys(missingBy);
  if (!files.length) return;
  throw new Error('CardOpenings.gs needs code that is not in this project yet. Re-paste ' +
    files.map(function(f){ return f + ' (missing: ' + missingBy[f].join(', ') + ')'; }).join(' and ') +
    ' from the repo, then run the sim again. All .gs files share one namespace, so a file that was ' +
    'not updated shows up only as a bare "not defined" at the point of use.');
}

function SimulatePackOpenings() {
  requireCompanions_();
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
  // Stage 1 (which packs are EARNED) and Stage 2 (what is INSIDE them) are separate processes, and
  // they get separate streams. Sharing one meant any change to the acquisition model reshuffled
  // every card draw downstream, so unrelated distribution gates moved whenever the grant logic was
  // touched. Derived from the same seed, so a run is still fully reproducible.
  var grantRand = mulberry32((seed | 0) ^ 0x27d4eb2f);

  var SEASON_DAYS = DAILY_DAYS;                        // the engine's calendar window (33)

  // ---- catalog (AlbumConfig) ----------------------------------------------------------------
  var validRarities = {};
  cfg.rarityOrder.forEach(function(x){ validRarities[x] = true; });
  var catLastRow  = album.getLastRow();
  var catalogData = catLastRow >= 3 ? album.getRange(3, 1, catLastRow - 2, 5).getValues() : [];

  // RARITY NAME RECONCILIATION. AlbumConfig and PackConfig are authored separately and had drifted:
  // AlbumConfig labels its top tier '6-star' while PackConfig RARITY DEFINITIONS calls the 6th tier
  // 'Gold'. The old filter simply DROPPED every card whose rarity was not a defined name, so 10 of
  // the 72 cards vanished from the simulation without a word: six of the eight sets could never be
  // completed, no album could ever finish, and the 41 'Gold' copies in the SNAP POOL had no card to
  // attach to. A silent drop of a tenth of the catalog is exactly the failure this reader must not
  // have, so an 'N-star' name is resolved POSITIONALLY to the Nth defined rarity (rarityOrder is
  // low->high), and anything still unresolved is a hard error naming the offenders.
  function resolveRarity(raw){
    var r = String(raw == null ? '' : raw).trim();
    if (validRarities[r]) return r;
    var m = r.match(/^(\d+)\s*[-\s]?\s*(?:star|\u2605|\*)?$/i);
    if (m){
      var idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < cfg.rarityOrder.length) return cfg.rarityOrder[idx];
    }
    return null;
  }
  var aliased = {}, unresolved = {};
  var catalog = [];
  catalogData.forEach(function(r){
    if (!(r[0] && r[1] && r[4] && /^CARD/i.test(String(r[0])))) return;
    var raw = String(r[4]).trim(), rar = resolveRarity(raw);
    if (!rar){ unresolved[raw] = (unresolved[raw] || 0) + 1; return; }
    if (rar !== raw) aliased[raw + ' -> ' + rar] = (aliased[raw + ' -> ' + rar] || 0) + 1;
    catalog.push({ name: r[1], setNum: Number(r[2]), setName: String(r[3] == null ? '' : r[3]).trim(),
                   rarity: rar, key: r[1] + ' ' + rar });
  });
  Object.keys(aliased).forEach(function(k){
    Logger.log('AlbumConfig rarity ' + k + ' (' + aliased[k] + ' cards) resolved by tier position - ' +
               'the two sheets name the same tier differently.');
  });
  if (Object.keys(unresolved).length){
    var list = Object.keys(unresolved).map(function(k){ return '"' + k + '" x' + unresolved[k]; });
    throw new Error('AlbumConfig uses ' + list.join(', ') + ', which PackConfig RARITY DEFINITIONS ' +
                    'does not define (' + cfg.rarityOrder.join(', ') + '). Those cards would be ' +
                    'silently uncollectable, so the run is stopped. Fix the rarity names on one of ' +
                    'the two sheets.');
  }
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
  // ECO GAINS from the collection feature itself. Set and album completions pay real currency out
  // of the PackConfig SET REWARDS / ALBUM REWARDS blocks, and until now that payout only ever
  // appeared as TEXT in the Note column - it was never totalled, so the feature's contribution to
  // the economy could not be read off the sheet at all. Kept per source, because a set completion
  // and an album completion are different levers.
  var setRewardGains   = {};                 // {resourceName: amount} from SET REWARDS
  var albumRewardGains = {};                 // {resourceName: amount} from ALBUM REWARDS
  function addRewardGains_(into, rewards){
    if (!rewards) return;
    REWARD_COLUMNS.forEach(function(rc){
      var v = num(rewards[rc.name]);
      if (v > 0) into[rc.name] = num(into[rc.name]) + v;
    });
  }

  function owned(key){ return collection[key] === true; }
  function acquire(key){ if (!owned(key)){ collection[key] = true; collectionSize++; return true; } return false; }

  // Effective draw multiplier for a card of `setNum`, for the album currently in progress.
  //   completed in this album -> CHAPTER_WEIGHTS.afterCompleted (only duplicates remain, so the
  //                              skew is switched off; the sheet has no before/after dimension,
  //                              which is why this half stays in code)
  //   otherwise               -> the PackConfig 'ALBUM SET SKEW' row for this album, so the skew
  //                              is a property of WHICH ALBUM the player is on. Beyond the last
  //                              authored album row the last row repeats (same convention as
  //                              getAlbumReward_). No block on the sheet -> CHAPTER_WEIGHTS.
  function chapterMultFor(setNum) {
    if (setNum === undefined || setNum === null) return 1.0;
    var idx = (setNum - 1) | 0;
    var arr;
    if (setsCompletedInAlbum[setNum]) {
      arr = CHAPTER_WEIGHTS.afterCompleted;
    } else {
      var rows = cfg.albumSetSkew || [];
      arr = rows.length ? rows[Math.min(albumIdx, rows.length - 1)]
                        : CHAPTER_WEIGHTS.beforeCompleted;
    }
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
            addRewardGains_(setRewardGains, cfg.setRewards.map[setId]);
            setCompletionNotes.push(setId + ' completed | Rewards: ' +
              formatRewards_(cfg.setRewards.map[setId]) + ' | packs opened: ' +
              formatPacksOpened_(packsOpenedByTier));
          }
        }

        if (collectionSize === totalUnique){
          var completedAlbumNum = albumIdx + 1;
          var albumReward = getAlbumReward_(cfg.albumRewards, completedAlbumNum);
          addRewardGains_(albumRewardGains, albumReward);
          var albumRewardStr = formatRewards_(albumReward);
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
  // === Stage 1: pack acquisition, drawn PER INSTANCE ==========================================
  // Replaces the old per-(source,tier) accumulator, which walked the days adding up the fractional
  // expectation and emitted a pack every time the running total crossed 1. That was unbiased over
  // the window but wrong about days, in two ways the live log showed plainly:
  //   * it granted Target Day "rank 4", "rank 2" and "rank 1" on the SAME day. A leaderboard
  //     instance pays exactly one rank; those outcomes are mutually exclusive.
  //   * it back-loaded packs into the final week and left busy days empty, because every tier of
  //     every source held its own separate counter and a 0.3/day lane needs four days to emit.
  // The plan below carries the discrete structure instead: per instance, did the player take part,
  // and then which rung(s) did they hit. Expectation per (source, tier) is unchanged, so window
  // totals still reconcile with the gains model (see packRungs_).
  var packOpens = [], expectedTotal = 0;
  var plan = packGrantPlan_(seg, payer, simCtx);

  plan.forEach(function(pl){
    pl.groups.forEach(function(g){
      g.rungs.forEach(function(rg){
        for (var t in rg.packs)
          expectedTotal += pl.participation * pl.reach * rg.p * num(rg.packs[t]);
      });
    });
  });

  // Landing day inside an instance. A rung with a place on the requirement axis is put where that
  // progress falls (ladders are climbed in order), otherwise the day is sampled from the same
  // weights the daily gains view uses (last day for rank rewards, accrual share for collections).
  function pickDay(pl, rung){
    if (rung && rung.progress != null && pl.days.length > 1 && !DAILY_LASTDAY[pl.cat]){
      var idx = Math.ceil(rung.progress * pl.days.length) - 1;
      return pl.days[Math.max(0, Math.min(pl.days.length - 1, idx))];
    }
    var x = grantRand(), acc = 0;
    for (var i = 0; i < pl.days.length; i++){
      acc += pl.dayW[i];
      if (x <= acc) return pl.days[i];
    }
    return pl.days[pl.days.length - 1];
  }
  function emitRung(cat, rung, day){
    for (var t in rung.packs){
      var n = num(rung.packs[t]);
      var whole = Math.floor(n);
      if (n - whole > 1e-12 && grantRand() < (n - whole)) whole += 1;   // fractional counts stay unbiased
      for (var k = 0; k < whole; k++)
        packOpens.push({ day: day, packName: t, source: cat, detail: rung.label });
    }
  }

  plan.forEach(function(pl){
    // one draw for "did this player take part in this instance at all"
    if (!(grantRand() < pl.participation * pl.reach)) return;
    pl.groups.forEach(function(g){
      if (g.exclusive){
        // a rank ladder: the player finishes in exactly ONE place
        var x = grantRand(), acc = 0, chosen = null;
        for (var i = 0; i < g.rungs.length; i++){
          acc += g.rungs[i].p;
          if (x <= acc){ chosen = g.rungs[i]; break; }
        }
        if (chosen) emitRung(pl.cat, chosen, pickDay(pl, chosen));
      } else {
        // a milestone ladder: each rung is reached (or not) on its own survival probability
        g.rungs.forEach(function(rg){
          if (grantRand() < rg.p) emitRung(pl.cat, rg, pickDay(pl, rg));
        });
      }
    });
  });

  // Season Pass is not instance-shaped: its packs sit on the season track and are collected as the
  // player climbs it, so every tier up to the one they reach pays out with certainty. Granting them
  // on the day that tier is reached (linear through the season) gives real provenance instead of the
  // blank Source_Detail the old path produced, and keeps the total equal to the track's cs value.
  var spPacks = spPackTiers_(seg, payer, simCtx);
  spPacks.forEach(function(tp){
    for (var t in tp.packs){
      var n = num(tp.packs[t]);
      var whole = Math.floor(n);
      if (n - whole > 1e-12 && grantRand() < (n - whole)) whole += 1;
      expectedTotal += n;
      for (var k = 0; k < whole; k++)
        packOpens.push({ day: tp.day, packName: t, source: 'Season Pass (Free)',
                         detail: tp.label });
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
  Logger.log('Collection ECO GAINS - set rewards: ' + formatRewards_(setRewardGains) +
             ' | album rewards: ' + formatRewards_(albumRewardGains));

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

  // --- collection eco gains (2026-08-21) ------------------------------------------------------
  // What the collection feature PAYS OUT, as numbers. Set and album completions grant real currency
  // from the PackConfig SET REWARDS / ALBUM REWARDS blocks, and that payout previously existed only
  // as text in a Note cell, so the feature's contribution to the economy could not be read off the
  // sheet. Written as its OWN block beside the tally rather than appended to it: the tally column
  // starts at row 42 and the pack log's bar sits at row 55, so four more rows would collide.
  // Coins get their own cell because that is the currency every other lane is measured in.
  simOut.getRange(REWARD_TALLY_ROW, REWARD_TALLY_COL + 1, 4, 1).setValues([
    [num(setRewardGains['Coins'])],
    [formatRewards_(setRewardGains)],
    [num(albumRewardGains['Coins'])],
    [formatRewards_(albumRewardGains)]
  ]);

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

  writeAlbumGrids_(simOut, catalog, collection, albumIdx, CARDS_PER_SET, ALBUM_NAMES.length);

  SpreadsheetApp.getActive().toast(
    'Opened ' + packsOpenedTotal + ' packs (expected ' + expectedTotal.toFixed(1) + '), ' +
    seg + ' ' + payer + ', ' + ALBUM_NAMES[albumIdx] + ' (catalog ' + totalUnique +
    ', balance ' + balance + ', seed ' + seed + ') | set rewards ' +
    formatRewards_(setRewardGains) + ' | album rewards ' + formatRewards_(albumRewardGains),
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

/** Writes a fresh Album/Set scaffold to the right of the pack log and returns its anchors.
 *  Layout per album:  'Album #N' <album name>
 *                     'Set #K'   <set name>
 *                     3 x GRID_DIM rows of grid
 *  Set numbers and names come from the CATALOG, so the scaffold always matches AlbumConfig.
 *  Only called when no anchors exist at all: a sheet that still has its labels is never rewritten,
 *  so a hand-arranged layout survives untouched. */
function buildGridScaffold_(simOut, catalog, cardsPerSet, albumCount){
  var setNums = [], seen = {}, nameOf = {};
  catalog.forEach(function(c){
    if (c.setNum == null || isNaN(c.setNum) || seen[c.setNum]) return;
    seen[c.setNum] = true;
    setNums.push(c.setNum);
    nameOf[c.setNum] = c.setName || '';
  });
  setNums.sort(function(a, b){ return a - b; });
  if (!setNums.length) return {};
  var col = gridCol_();                          // shared with the builder's GRID_C0
  var shape = gridShape_(cardsPerSet);
  var blank = []; for (var q0 = 0; q0 < shape.w; q0++) blank.push('');
  var top = OUT_START_ROW - 1;                   // the log's header row; the grid block starts here
                                                 // so an existing 'Album #1' is overwritten in place
                                                 // rather than duplicated one row below it
  var albums = Math.max(1, Math.round(albumCount || 1));
  var rows = [], anchors = {};
  for (var a = 1; a <= albums; a++){
    anchors[a] = {};
    rows.push(['Album #' + a].concat(blank.slice(1)));
    for (var i = 0; i < setNums.length; i++){
      var sn = setNums[i];
      anchors[a][sn] = { row: top + rows.length, col: col };   // sheet row this Set label lands on
      rows.push(['Set #' + sn, nameOf[sn]].concat(blank.slice(2)));
      for (var g = 0; g < shape.h; g++) rows.push(blank.slice());
    }
    rows.push(blank.slice());                    // blank spacer between albums
  }
  // Clear the whole grid region first, INCLUDING any column between the log and the block. A damaged
  // sheet keeps a legacy block one column to the left (that is how the live sheet ended up with a
  // 2-wide grid), and writing the new scaffold beside it would leave two 'Album #1' labels inside
  // the scan range - after which findGridAnchors_ has two candidate origins and picks by row order.
  // Cleared to the block's full height so a shrunk scaffold cannot leave ghost rows below it either.
  var legacyFrom = LOG_COLS.length + 1;
  var wipeCols = (col + shape.w) - legacyFrom;
  simOut.getRange(top, legacyFrom, rows.length + GRID_DIM, wipeCols).clearContent();
  simOut.getRange(top, col, rows.length, shape.w).setValues(rows);
  Logger.log('Rebuilt grid scaffold: ' + albums + ' albums x ' + setNums.length +
             ' sets at column ' + colLetter_(col) + ', ' + rows.length + ' rows.');
  return anchors;
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
function writeAlbumGrids_(simOut, catalog, collection, albumIdx, cardsPerSet, albumCount) {
  var anchors = findGridAnchors_(simOut);
  // Rebuild on PARTIAL damage, not just total absence. Checking only for "no anchors at all" meant a
  // scaffold missing a few 'Set #N' labels stayed broken forever: the survivors suppressed the
  // rebuild and the missing sets simply never painted. The check is therefore structural - every
  // album must carry every set in the catalog.
  var wantSets = {}, nWant = 0;
  catalog.forEach(function(c){ if (c.setNum != null && !isNaN(c.setNum) && !wantSets[c.setNum]){ wantSets[c.setNum] = 1; nWant++; } });
  var wantAlbums = Math.max(1, Math.round(albumCount || 1));
  var complete = Object.keys(anchors).length >= wantAlbums;
  if (complete){
    for (var a = 1; a <= wantAlbums && complete; a++){
      var got = anchors[a];
      if (!got || Object.keys(got).length < nWant){ complete = false; break; }
      for (var sn in wantSets) if (!got[sn]){ complete = false; break; }
    }
  }
  if (!complete){
    // SELF-HEAL. The writer used to give up here, which is how the live sheet ended up showing a
    // stale 2-column grid with no set headers: the 'Set #N' labels had been cleared at some point
    // (an older, wider log clear reached the column they lived in), and nothing could ever put them
    // back because painting only ever wrote INTO labels it found. A missing scaffold is now built
    // from the catalog itself, so the grids cannot stay broken across runs.
    Logger.log('Album/Set scaffold missing or incomplete in ' + gridScanRange_() +
                ' - rebuilding it (' + wantAlbums + ' albums x ' + nWant + ' sets).');
    anchors = buildGridScaffold_(simOut, catalog, cardsPerSet, albumCount);
    if (!Object.keys(anchors).length){
      Logger.log('Could not rebuild the album/set scaffold (no catalog sets).');
      return;
    }
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
      var shape = gridShape_(cardsPerSet), grid = [];
      for (var gr = 0; gr < shape.h; gr++){
        var gline = [];
        for (var gc = 0; gc < shape.w; gc++) gline.push('');
        grid.push(gline);
      }
      cards.slice(0, cardsPerSet).forEach(function(c, i){
        if (use[c.key]) grid[Math.floor(i / shape.w)][i % shape.w] = c.rarity;
      });
      var rng = simOut.getRange(anchor.row + 1, anchor.col, shape.h, shape.w);
      rng.setValues(grid);
      rng.setHorizontalAlignment('center');
    });
  });
}
