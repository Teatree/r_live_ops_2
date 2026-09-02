/************************************************************************************************
 * HCPerWin.gs — HC earned / spent per LEVEL WIN, per segment (33-day window estimate).
 * ---------------------------------------------------------------------------------------------
 * STANDALONE by design (like CalStats.gs in the main stack): own readers, own constants, no
 * dependence on EcoGainsSim_v4.gs internals — an engine rewrite cannot delete it. It shares the
 * Apps Script global namespace with the engine files, so every identifier here is hcw-prefixed
 * (or ECOGAINS_-prefixed for the custom function) and declared with var, never const.
 *
 * CUSTOM FUNCTION (spills header + one row per payer flag):
 *   =ECOGAINS_HC_PER_WIN("10-19")
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
 * FLAGGED assumptions & basis choices:
 *   - PER-ACTIVE-PLAYER basis on both axes (data_econ per_active_player over the wins of the
 *     same average active player), NOT per-earner — the two bases must not be mixed.
 *   - gain_per_active_player counts EVERY HC inflow in the daily ledger (events, saga, gifts,
 *     purchased HC, piggy etc.), and spend every outflow (continues, boosters, ...). This is
 *     "the economy per win", not "event rewards per win".
 *   - data_econ is a WINDOW total per active player and the active-days sum reconstructs the
 *     same window from behaviour rates — if data_econ is re-pulled for a different window,
 *     HCW_DAYS must follow it (the harness gates HCW_DAYS == SIM_DAYS).
 *   - No collection (set/album) rewards here — this variant has no card packs. See
 *     engine/HCPerWin.gs for the Collections build.
 ************************************************************************************************/

// 33-day window, day 1 = Wednesday. Declared here as well as in EcoGainsSim_v4.gs (SIM_DAYS)
// because Apps Script loads files alphabetically and a load-time read of another file's var is
// undefined. harness/_mock_run.js gates that they match — change them together.
// NOTE: this is the PRE-COLLECTIONS copy — no set/album completion rewards. engine/HCPerWin.gs
// adds those; keep the two in sync for everything else.
var HCW_DAYS = 33;
var HCW_DAY_ONE_DOW = 3;          // 1 = Monday .. 7 = Sunday

/** @customfunction */
function ECOGAINS_HC_PER_WIN(segment){
  try {
    var seg = String(segment == null ? '' : segment).trim();
    if (!seg) return [['ECOGAINS_HC_PER_WIN: pass a segment, e.g. "10-19"']];
    if (seg === 'A. 0' || seg === 'A.0')
      return [['A. 0 has no behaviour telemetry (appendix segment) — per-win rates cannot be estimated']];
    var header = ['payer', 'active days (est)', 'level wins (est)',
                  'HC gain / win', 'HC spend / win', 'HC net / win'];
    var out = [header];
    ['NONPAYER', 'PAYER'].forEach(function(payer){
      var b = hcwRow_('data_seg_beh', 'segment', seg, 'payer_flag', payer);
      var e = hcwEconHC_(seg, payer);
      if (!b){ out.push([payer, 'no data_seg_beh row for ' + seg, '', '', '', '']); return; }
      if (!e){ out.push([payer, 'no data_econ HC row for ' + seg, '', '', '', '']); return; }
      var lvl = hcwNum_(b['levels_completed_per_active_day']);
      var pWd = hcwNum_(b['weekday_active_rate']), pWe = hcwNum_(b['weekend_active_rate']);
      var days = 0;
      for (var d = 1; d <= HCW_DAYS; d++) days += hcwWeekend_(d) ? pWe : pWd;
      var wins = lvl * days;
      if (!(wins > 0)){ out.push([payer, hcwR2_(days), 0, 'no wins (behaviour row empty)', '', '']); return; }
      var gain = hcwNum_(e['gain_per_active_player']), spend = hcwNum_(e['spend_per_active_player']);
      out.push([payer, hcwR2_(days), hcwR2_(wins),
                hcwR2_(gain / wins), hcwR2_(spend / wins), hcwR2_((gain - spend) / wins)]);
    });
    return out;
  } catch (err){
    return [['ECOGAINS_HC_PER_WIN error: ' + err.message]];
  }
}

// Monday-start weekend rule (Fri/Sat/Sun), same shape as the engine's isWeekend_.
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
