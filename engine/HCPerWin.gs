/************************************************************************************************
 * HCPerWin.gs — HC earned / spent per LEVEL WIN, per segment (COLLECTIONS build).
 * ---------------------------------------------------------------------------------------------
 * STANDALONE by design (like CalStats.gs): own readers, own constants, no dependence on
 * EcoGainsSim_v4.gs internals — an engine rewrite cannot delete it. It shares the Apps Script
 * global namespace with the engine files, so every identifier here is hcw-prefixed (or
 * ECOGAINS_-prefixed for the custom function) and declared with var, never const.
 *
 * The ONE soft dependency is CardOpenings.gs: if SimulatePackOpenings is present and PackConfig /
 * AlbumConfig are readable, the collection columns are priced; otherwise they come back blank with
 * a reason. The function never fails because collections are unconfigured.
 *
 * CUSTOM FUNCTION (spills header + one row per payer flag):
 *   =ECOGAINS_HC_PER_WIN("10-19")
 *   =ECOGAINS_HC_PER_WIN("10-19", 5)      // optional: number of card-sim seeds to average
 *   segment: '0-9' | '10-19' | '20-39' | '40-99' | '100+'  ('A. 0' has no behaviour telemetry
 *   and no data_econ row -> returns an explanatory message instead of numbers)
 *
 * MODEL (an ESTIMATE, all inputs are live sheet reads — D12):
 *   level wins over the window = levels_completed_per_active_day (data_seg_beh)
 *                                x Σ_{d=1..HCW_DAYS} p(active on day d)
 *     — the same construction the engine's synthetic Core-SPT anchor uses (L in coreSptSynth_),
 *     with p(active) = weekday_active_rate / weekend_active_rate by the Wednesday-start weekend
 *     rule (Fri/Sat/Sun). "Wins" = completed levels: ABDB completes a level exactly on a win.
 *   HC gain / win  = gain_per_active_player  (data_econ, currency = 'HC') / wins
 *   HC spend / win = spend_per_active_player (data_econ, currency = 'HC') / wins
 *
 * COLLECTIONS (this build only): card collections also pay HC for COMPLETING A SET and for
 * COMPLETING AN ALBUM. Those grants are priced by running the real card simulator headlessly —
 * SimulatePackOpenings({headless:true}) — and reading back its completion-reward totals. Running
 * the actual simulator rather than re-deriving completions means the per-win figure, the SimOutput
 * sheet and the pack lane all move together; a second model of "how many sets does this segment
 * finish" would drift the moment anyone touched the pool, the pity table or the chapter weights.
 *
 *   collection HC / win = (HC from set completions + HC from album completions) / wins
 *
 * FLAGGED assumptions & basis choices:
 *   - PER-ACTIVE-PLAYER basis on both axes (data_econ per_active_player over the wins of the
 *     same average active player), NOT per-earner — the two bases must not be mixed. The card sim
 *     also simulates ONE representative player of the (segment, payer) cell over the same window,
 *     so its HC lands on the same basis.
 *   - gain_per_active_player counts EVERY HC inflow in the daily ledger (events, saga, gifts,
 *     purchased HC, piggy etc.), and spend every outflow (continues, boosters, ...). This is
 *     "the economy per win", not "event rewards per win".
 *   - **The collection HC is ADDITIVE and is NOT in data_econ** — card collections are not live,
 *     so the measured ledger structurally cannot contain set/album grants. THE DAY COLLECTIONS
 *     SHIP, this stops being additive and starts being a double count: at that point drop the
 *     collection columns (or subtract the measured grant) rather than leaving both in.
 *   - The card sim is stochastic. HCW_SEEDS runs are averaged and the seeds are FIXED, because a
 *     custom function must be deterministic — Google caches on the argument list, so a run that
 *     varied per recalc would make the cell disagree with itself. More seeds = steadier estimate
 *     and a slower recalc; the count is the optional second argument.
 *   - data_econ is a WINDOW total per active player and the active-days sum reconstructs the same
 *     window from behaviour rates — if data_econ is re-pulled for a different window, HCW_DAYS
 *     must follow it (the harness gates HCW_DAYS == SIM_DAYS).
 ************************************************************************************************/

// 33-day window, day 1 = Wednesday. Declared here as well as in EcoGainsSim_v4.gs (SIM_DAYS)
// because Apps Script loads files alphabetically and a load-time read of another file's var is
// undefined. harness/_mock_run.js gates that they match — change them together.
var HCW_DAYS = 33;
var HCW_DAY_ONE_DOW = 3;          // 1 = Monday .. 7 = Sunday; the 33-day calendars start Wednesday
var HCW_SEEDS = 3;                // card-sim runs to average (fixed seeds -> deterministic)
var HCW_SEED_BASE = 101;

/** @customfunction */
function ECOGAINS_HC_PER_WIN(segment, seedCount){
  try {
    var seg = String(segment == null ? '' : segment).trim();
    if (!seg) return [['ECOGAINS_HC_PER_WIN: pass a segment, e.g. "10-19"']];
    if (seg === 'A. 0' || seg === 'A.0')
      return [['A. 0 has no behaviour telemetry (appendix segment) — per-win rates cannot be estimated']];
    var nSeeds = Math.max(1, Math.round(hcwNum_(seedCount) || HCW_SEEDS));

    var header = ['payer', 'active days (est)', 'level wins (est)',
                  'HC gain / win', 'HC spend / win', 'HC net / win',
                  'sets completed (est)', 'albums completed (est)', 'collection HC / win',
                  'HC gain incl. collections / win', 'HC net incl. collections / win'];
    var out = [header];
    var blanks = ['', '', '', '', ''];
    var reasons = {};

    ['NONPAYER', 'PAYER'].forEach(function(payer){
      var b = hcwRow_('data_seg_beh', 'segment', seg, 'payer_flag', payer);
      var e = hcwEconHC_(seg, payer);
      if (!b){ out.push([payer, 'no data_seg_beh row for ' + seg, '', '', '', ''].concat(blanks)); return; }
      if (!e){ out.push([payer, 'no data_econ HC row for ' + seg, '', '', '', ''].concat(blanks)); return; }
      var lvl = hcwNum_(b['levels_completed_per_active_day']);
      var pWd = hcwNum_(b['weekday_active_rate']), pWe = hcwNum_(b['weekend_active_rate']);
      var days = 0;
      for (var d = 1; d <= HCW_DAYS; d++) days += hcwWeekend_(d) ? pWe : pWd;
      var wins = lvl * days;
      if (!(wins > 0)){
        out.push([payer, hcwR2_(days), 0, 'no wins (behaviour row empty)', '', ''].concat(blanks));
        return;
      }
      var gain = hcwNum_(e['gain_per_active_player']), spend = hcwNum_(e['spend_per_active_player']);

      var coll = hcwCollections_(seg, payer, nSeeds);
      if (coll.reason) reasons[coll.reason] = 1;
      var collHC = coll.ok ? (coll.hcFromSets + coll.hcFromAlbums) : 0;

      out.push([payer, hcwR2_(days), hcwR2_(wins),
                hcwR2_(gain / wins), hcwR2_(spend / wins), hcwR2_((gain - spend) / wins),
                coll.ok ? hcwR2_(coll.sets) : '',
                coll.ok ? hcwR2_(coll.albums) : '',
                coll.ok ? hcwR2_(collHC / wins) : '',
                coll.ok ? hcwR2_((gain + collHC) / wins) : '',
                coll.ok ? hcwR2_((gain + collHC - spend) / wins) : '']);
    });

    for (var why in reasons){
      out.push(['collection columns blank — ' + why, '', '', '', '', '', '', '', '', '', '']);
      break;
    }
    return out;
  } catch (err){
    return [['ECOGAINS_HC_PER_WIN error: ' + err.message]];
  }
}

// Expected set/album completions and their HC, averaged over nSeeds fixed-seed card-sim runs.
// Never throws: an unconfigured or broken collection setup returns {ok:false, reason} and the
// caller blanks those columns rather than failing the whole function.
function hcwCollections_(seg, payer, nSeeds){
  if (typeof SimulatePackOpenings !== 'function')
    return { ok: false, reason: 'CardOpenings.gs is not in this project' };
  var key = seg + '|' + payer + '|' + nSeeds;
  if (_hcwCollCache[key] !== undefined) return _hcwCollCache[key];
  var sets = 0, albums = 0, hcS = 0, hcA = 0, runs = 0, lastErr = '';
  for (var i = 0; i < nSeeds; i++){
    try {
      var r = SimulatePackOpenings({ headless: true, seg: seg, payer: payer,
                                     seed: HCW_SEED_BASE + i * 97 });
      if (!r) continue;
      sets += hcwNum_(r.setsCompleted);
      albums += hcwNum_(r.albumsCompleted);
      hcS += hcwNum_(r.hcFromSets);
      hcA += hcwNum_(r.hcFromAlbums);
      runs++;
    } catch (err){ lastErr = err.message; }
  }
  var res = runs
    ? { ok: true, sets: sets / runs, albums: albums / runs,
        hcFromSets: hcS / runs, hcFromAlbums: hcA / runs, runs: runs }
    : { ok: false, reason: lastErr || 'the card simulator produced no runs' };
  return (_hcwCollCache[key] = res);
}
var _hcwCollCache = {};

// Weekend rule (Fri/Sat/Sun), same shape as the engine's isWeekend_.
function hcwWeekend_(day){
  var dow = ((HCW_DAY_ONE_DOW - 1 + (day - 1)) % 7) + 1;
  return dow >= 5;
}

// first data row matching two (headerName, value) pairs, as {header: value}; null if absent.
function hcwRow_(sheetName, k1, v1, k2, v2){
  var v = hcwVals_(sheetName);
  if (!v.length) return null;
  var h = {}, c;
  for (c = 0; c < (v[0] || []).length; c++)
    if (v[0][c] != null && v[0][c] !== '') h[String(v[0][c])] = c;
  if (h[k1] == null || h[k2] == null) return null;
  for (var r = 1; r < v.length; r++){
    if (String(v[r][h[k1]]) === v1 && String(v[r][h[k2]]) === v2){
      var o = {};
      for (var name in h) o[name] = v[r][h[name]];
      return o;
    }
  }
  return null;
}
// the data_econ row for (segment, payer, currency = 'HC'); null if absent.
function hcwEconHC_(seg, payer){
  var v = hcwVals_('data_econ');
  if (!v.length) return null;
  var h = {}, c;
  for (c = 0; c < (v[0] || []).length; c++)
    if (v[0][c] != null && v[0][c] !== '') h[String(v[0][c])] = c;
  if (h['segment'] == null || h['payer_flag'] == null || h['currency'] == null) return null;
  for (var r = 1; r < v.length; r++){
    if (String(v[r][h['segment']]) === seg && String(v[r][h['payer_flag']]) === payer &&
        String(v[r][h['currency']]) === 'HC'){
      var o = {};
      for (var name in h) o[name] = v[r][h[name]];
      return o;
    }
  }
  return null;
}

var _hcwCache = {};
function hcwVals_(name){
  if (_hcwCache[name] !== undefined) return _hcwCache[name];
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  return (_hcwCache[name] = sh ? sh.getDataRange().getValues() : []);
}
function hcwNum_(x){ var n = parseFloat(x); return isNaN(n) ? 0 : n; }
function hcwR2_(x){ return Math.round(x * 100) / 100; }
