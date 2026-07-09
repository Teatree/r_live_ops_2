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

var SPS_SHEET = 'Sim per Segment';
var SPS_SEGMENTS = ['0-9','10-19','20-39','40-99','100+'];
var SPS_NET_C0 = 21;                                   // NET block first column (U)
var SPS_ECON_SHEET = 'data_econ';                      // seg | payer_flag | currency -> per-EARNER gain/spend

var SPS_GROUPS = {
  'PAID': ['IAPs'],
  'ADS' : ['Ads'],
  'CORE': ['Core','Saga','Daily Gift','Daily Night Sky Prize'],
  'META': ['Bomb Challenge',"Bomb's Ballet",'Chuck Challenge','Flock Flurry','Hatchling Hideaway',
           'Jigsaw','Kite Festival','Level Race','Other','Photoshoot','Red Challenge','River Rush',
           'Season Pass (Free)','Target Day','Team Event','Team Race','Flash Race','FlowerCoop',
           'Rainbow Maker']
};
var SPS_GROUP_ORDER = ['PAID','ADS','CORE','META'];

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
      var e = {};
      CATEGORY_ORDER.forEach(function(cat){
        e[cat] = { sim: resultRow_(cat, seg, payer, ctx),
                   cur: measuredRow_(cat, seg, payer, ctx.ds) };
      });
      rows[payer + '|' + seg] = e;
    });
  });
  function groupSums(payer, seg, res){
    var e = rows[payer + '|' + seg], cur = [], sim = [];
    SPS_GROUP_ORDER.forEach(function(g){
      var c = 0, s = 0;
      SPS_GROUPS[g].forEach(function(cat){ c += num(e[cat].cur[res]); s += num(e[cat].sim[res]); });
      cur.push(round2_(c)); sim.push(round2_(s));
    });
    return { cur: cur, sim: sim };
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
