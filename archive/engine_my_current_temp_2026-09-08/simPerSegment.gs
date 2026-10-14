/************************************************************************************************
 * SimPerSegmentFill.gs — fills the 'Sim per Segment' rollup sheet from the v4 engine.
 * ---------------------------------------------------------------------------------------------
 * REQUIRES EcoGainsSim_v4.gs (Context, CATEGORY_ORDER, RESOURCES, resultRow_, measuredRow_, num).
 * NOT a custom function. Run via menu EcoGainsSim > Fill Sim per Segment.
 *
 * GAINS block (per EARNER, from the engine): C:F current groups + G total, I:L simulated + M total,
 * O:S delta. Unchanged.
 *
 * NET block (cols U:X, per EARNER — same resource_earners denominator as the gains block — spend
 * held constant):
 *   cur spend (U) · cur net (V) · new net (W) · net Δ (X, = W-V formula)
 * ADDITIVE projection (2026-07-10, user decision — same model as the Daily NET blocks, so the two
 * views reconcile: SPS net Δ == the Daily net-Δ TOTAL == M − G):
 *   cur_net   = gain_pe - spend_pe
 *   new_net   = gain_pe + (M - G) - spend_pe      // M-G = the engine's ABSOLUTE gain movement
 *   net_diff  = new_net - cur_net = M - G         // spend constant
 * Why additive, not gain_pe*(M/G): the engine's G covers only the 25 modelled categories while
 * data_econ sees the whole faucet (workbook (9): gain_pe ~ 1.8x G for HC/Slingshot) — the ratio
 * form extrapolated the redesign onto unmodelled faucets and overstated the movement by that
 * factor; additive moves only what the engine actually models.
 * gain_pe / spend_pe / resource_earners come from the 'data_econ' sheet (see the SQL prompt, v2
 * per-earner columns). If data_econ is absent OR lacks the per-earner columns, the NET columns are
 * left blank and everything else still fills.
 *
 * OVERALL row (last row of each payer block): weighted average of the 5 segments —
 * gains groups weighted by unique_players, NET columns weighted by resource_earners (per-earner
 * metrics get the "average earner", per-earner-basis-consistent).
 *
 * Row layout per table (marker m): m+1 band · m+2 header ·
 *   m+3 NONPAYER · m+4..m+8 segs · m+9 overall · m+10 PAYER · m+11..m+15 segs · m+16 overall.
 ************************************************************************************************/

// Build stamp. Read back by ECOGAINS_BUILD() so "is the pasted code current?"
// is answerable from the sheet instead of from memory.
var SPS_BUILD     = 'SimPerSegmentFill.gs D36 2026-09-03';


var SPS_SHEET = 'Sim per Segment';
var SPS_SEGMENTS = ['0-9','10-19','20-39','40-99','100+'];
var SPS_NET_C0 = 21;                                   // NET block first column (U)
var SPS_ECON_SHEET = 'data_econ';                      // seg | payer_flag | currency -> per-EARNER gain/spend

// THE FOUR GROUP COLUMNS. This list and CATEGORY_ORDER must PARTITION each other, and until
// 2026-09-03 they did not: the engine grew 'Season Pass (Paid)', 'ToF', 'Col - Sets' and
// 'Col - Albums' and none of them was added here, so groupSums silently skipped all four. The rows
// still filled and the totals still looked plausible - at 20-39 PAYER the sheet dropped 268 HC and
// 436 Unlimited Lives, and the HC delta came out -7.01 where the engine says +61.09. The SIGN was
// wrong, not just the size, and the NET block inherited it through the additive (M - G) term.
// Same failure class as CATEGORY_ORDER vs the sheet's row labels: two lists that must agree, with
// nothing checking that they do.
//
// 'Season Pass (Paid)' sits in PAID on the user's call (2026-09-03): that column reads as "what
// only purchasers get". ToF and the two collection rows are ordinary calendar/feature payouts, so
// they join META.
var SPS_GROUPS = {
  'PAID': ['IAPs','Season Pass (Paid)'],
  'ADS' : ['Ads'],
  'CORE': ['Core','Saga','Daily Gift','Daily Night Sky Prize'],
  'META': ['Bomb Challenge',"Bomb's Ballet",'Chuck Challenge','Flock Flurry','Hatchling Hideaway',
           'Jigsaw','Kite Festival','Level Race','Other','Photoshoot','Red Challenge','River Rush',
           'Season Pass (Free)','Target Day','Team Event','Team Race','Flash Race','FlowerCoop',
           'Rainbow Maker','ToF','Col - Sets','Col - Albums']
};
var SPS_GROUP_ORDER = ['PAID','ADS','CORE','META'];
// Which group any category NOT named above falls into. A partition that has to be maintained by
// hand will be wrong again the next time a source is added, and the failure is invisible: the sheet
// keeps filling and only the totals are short. So the mapping is TOTAL by construction - an
// unlisted category lands in this group and is LOGGED, rather than dropping out of the sums.
var SPS_DEFAULT_GROUP = 'META';

// category -> group, with every CATEGORY_ORDER entry guaranteed a home. Returns {map, unlisted}.
function spsGroupOf_(){
  var map = {}, unlisted = [];
  SPS_GROUP_ORDER.forEach(function(g){
    (SPS_GROUPS[g] || []).forEach(function(cat){ map[cat] = g; });
  });
  CATEGORY_ORDER.forEach(function(cat){
    if (!map[cat]){ map[cat] = SPS_DEFAULT_GROUP; unlisted.push(cat); }
  });
  return { map: map, unlisted: unlisted };
}

// one engine pass for a (segment, payer): every category's simulated and measured row.
function spsCatRows_(seg, payer, ctx){
  var e = {};
  CATEGORY_ORDER.forEach(function(cat){
    e[cat] = { sim: resultRow_(cat, seg, payer, ctx),
               cur: measuredRow_(cat, seg, payer, ctx.ds) };
  });
  return e;
}

// The four group columns for one resource. Top-level and pure so harness/_mock_run.js can gate the
// SHIPPED summation instead of a copy of it: the bug this replaced was a partition that disagreed
// with CATEGORY_ORDER, and a gate written against its own copy of the sum would not have caught it.
function spsGroupSums_(ent, res, map){
  var byG = {}, cur = [], sim = [];
  SPS_GROUP_ORDER.forEach(function(g){ byG[g] = { c: 0, s: 0 }; });
  CATEGORY_ORDER.forEach(function(cat){
    var g = byG[map[cat]];
    if (!g) return;                                    // group not shown on the sheet
    g.c += num(ent[cat].cur[res]);
    g.s += num(ent[cat].sim[res]);
  });
  SPS_GROUP_ORDER.forEach(function(g){
    cur.push(round2_(byG[g].c)); sim.push(round2_(byG[g].s));
  });
  return { cur: cur, sim: sim };
}

function fillSimPerSegment(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SPS_SHEET);
  if (!sh){ throw new Error("Sheet '" + SPS_SHEET + "' not found."); }
  var vals = sh.getDataRange().getValues();
  var ctx = Context.get();
  var econ = readEcon_(ss);                            // seg|payer|currency -> {gain, spend} or null

  // one engine pass per (payer, segment)
  var rows = {};
  ['NONPAYER','PAYER'].forEach(function(payer){
    SPS_SEGMENTS.forEach(function(seg){
      rows[payer + '|' + seg] = spsCatRows_(seg, payer, ctx);
    });
  });
  // Summed off the TOTAL category->group map, so the four group columns always add up to exactly
  // what ECOGAINS_SIM / ECOGAINS_DIFF report for the same (segment, payer, resource).
  var grp = spsGroupOf_();
  if (grp.unlisted.length)
    Logger.log('Sim per Segment: ' + grp.unlisted.length + ' categor(ies) are in CATEGORY_ORDER but ' +
               'not in SPS_GROUPS, so they were counted under ' + SPS_DEFAULT_GROUP + ': ' +
               grp.unlisted.join(', ') + '. Add them to SPS_GROUPS to place them deliberately.');
  function groupSums(payer, seg, res){
    return spsGroupSums_(rows[payer + '|' + seg], res, grp.map);
  }
  // net per (res, seg, payer): per-earner gain/spend from data_econ + the engine's absolute gain
  // movement (M − G). ADDITIVE: the redesign shifts the modelled categories by (M − G) per earner;
  // faucets outside the 25 categories are left untouched.
  function netRow(payer, seg, res, gs){
    if (!econ) return null;
    var ec = econ[[seg, payer, res].join('|')];
    if (!ec) return null;
    var G = 0, M = 0;
    for (var i = 0; i < gs.cur.length; i++){ G += gs.cur[i]; M += gs.sim[i]; }
    var curNet = ec.gain - ec.spend, newNet = ec.gain + (M - G) - ec.spend;
    return { spend: round2_(ec.spend), curNet: round2_(curNet), newNet: round2_(newNet),
             earners: ec.earners };
  }

  var filled = 0, skipped = [], netFilled = 0;
  for (var r = 0; r < vals.length; r++){
    var mMatch = String(vals[r][1] || '').match(/^◆\s*(.+)$/);
    if (!mMatch) continue;
    var res = mMatch[1].trim();
    if (RESOURCES.indexOf(res) === -1){ skipped.push(res); continue; }
    var m = r + 1;                                     // marker row (1-based)

    ['NONPAYER','PAYER'].forEach(function(payer, pb){
      var band = m + 3 + pb * 7, overRow = band + 6;
      if (String(vals[band - 1] && vals[band - 1][1] || '').trim() !== payer) return;

      // accumulate for the overall row: gains weighted by unique_players, NET by resource_earners
      var wSumCur = [0,0,0,0], wSumSim = [0,0,0,0], wTot = 0;
      var wSpend = 0, wCurNet = 0, wNewNet = 0, wEarn = 0;

      SPS_SEGMENTS.forEach(function(seg, i){
        var segRow = band + 1 + i;
        var gs = groupSums(payer, seg, res);
        if (String(vals[segRow - 1] && vals[segRow - 1][1] || '').trim() !== seg)
          skipped.push(res + ' ' + payer + ' r' + segRow);
        writeGainsRow_(sh, segRow, gs);
        var up = num(ctx.ds.beh(seg, payer).unique_players);
        for (var j = 0; j < 4; j++){ wSumCur[j] += gs.cur[j] * up; wSumSim[j] += gs.sim[j] * up; }
        var nr = netRow(payer, seg, res, gs);
        if (nr){
          writeNetRow_(sh, segRow, nr); netFilled++;
          var we = num(nr.earners);
          wSpend += nr.spend * we; wCurNet += nr.curNet * we; wNewNet += nr.newNet * we;
          wEarn += we;
        } else clearNetRow_(sh, segRow);
        wTot += up;
      });

      // overall = weighted average
      var w = wTot > 0 ? wTot : 1;
      writeGainsRow_(sh, overRow, { cur: wSumCur.map(function(x){ return round2_(x / w); }),
                                    sim: wSumSim.map(function(x){ return round2_(x / w); }) });
      if (econ && wEarn > 0)
        writeNetRow_(sh, overRow, { spend: round2_(wSpend / wEarn),
                                    curNet: round2_(wCurNet / wEarn), newNet: round2_(wNewNet / wEarn) });
      else clearNetRow_(sh, overRow);
    });
    filled++;
  }
  var msg = 'Sim per Segment: ' + filled + ' tables filled' +
            (econ ? ' · ' + netFilled + ' net rows'
                  : ' · NET skipped (data_econ missing or lacks per-earner columns)') +
            (skipped.length ? ' · flagged: ' + skipped.join(', ') : '');
  try { ss.toast(msg, 'EcoGainsSim', 8); } catch(e){}
  Logger.log(msg);
}

// C:F current groups, I:L simulated, G/M Total (=SUM), O:S delta (=sim/cur-1)
function writeGainsRow_(sh, row, gs){
  sh.getRange(row, 3, 1, 4).setValues([gs.cur]);
  sh.getRange(row, 9, 1, 4).setValues([gs.sim]);
  sh.getRange(row, 7 ).setFormula('=SUM(C' + row + ':F' + row + ')');
  sh.getRange(row, 13).setFormula('=SUM(I' + row + ':L' + row + ')');
  for (var j = 0; j < 5; j++){
    var curC = String.fromCharCode(67 + j), simC = String.fromCharCode(73 + j);   // C..G / I..M
    sh.getRange(row, 15 + j).setFormula('=IFERROR(' + simC + row + '/' + curC + row + '-1,"")');
  }
}
// U cur spend, V cur net, W new net, X net Δ (=W-V)
function writeNetRow_(sh, row, nr){
  sh.getRange(row, SPS_NET_C0,     1, 3).setValues([[nr.spend, nr.curNet, nr.newNet]]);
  sh.getRange(row, SPS_NET_C0 + 3).setFormula('=IFERROR(W' + row + '-V' + row + ',"")');
}
function clearNetRow_(sh, row){ sh.getRange(row, SPS_NET_C0, 1, 4).clearContent(); }

// data_econ: segment | payer_flag | currency -> gain_per_earner, spend_per_earner, resource_earners
// (per-EARNER v2 columns; a v1 per-active-player-only data_econ has no gain_per_earner header ->
// returns null -> NET left blank, same fail-safe as a missing sheet)
function readEcon_(ss){
  var sh = ss.getSheetByName(SPS_ECON_SHEET);
  if (!sh) return null;
  var v = sh.getDataRange().getValues();
  if (!v.length) return null;
  var h = headerIndex_(v[0]);
  if (h['currency'] == null || h['gain_per_earner'] == null ||
      h['spend_per_earner'] == null || h['resource_earners'] == null) return null;
  var m = {};
  for (var i = 1; i < v.length; i++){ var r = v[i];
    if (!r[h['segment']]) continue;
    m[[r[h['segment']], r[h['payer_flag']], r[h['currency']]].join('|')] =
      { gain: num(r[h['gain_per_earner']]), spend: num(r[h['spend_per_earner']]),
        earners: num(r[h['resource_earners']]) };
  }
  return m;
}

function round2_(x){ return Math.round(x * 100) / 100; }
