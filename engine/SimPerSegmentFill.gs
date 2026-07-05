/************************************************************************************************
 * SimPerSegmentFill.gs — fills the 'Sim per Segment' rollup sheet from the v4 engine.
 * ---------------------------------------------------------------------------------------------
 * REQUIRES EcoGainsSim_v4.gs in the same Apps Script project (uses its Context, CATEGORY_ORDER,
 * RESOURCES, resultRow_, measuredRow_).
 *
 * NOT a custom function. Run fillSimPerSegment() from the script editor, or via the menu
 * EcoGainsSim ▸ Fill Sim per Segment. It:
 *   1. scans column B of 'Sim per Segment' for resource markers ('◆ HC', '◆ Slingshot', ...);
 *   2. for each table, computes CURRENT (measured) and SIMULATED per (payer, segment), summed
 *      into the SPS_GROUPS source categories below;
 *   3. writes the group values as plain VALUES into C:F (current) and I:L (simulated), and
 *      (re)writes the Total (=SUM) and Δ (=sim/cur-1) formulas so the sheet stays interactive.
 *
 * Table layout expected under each marker row m (matches Sim_per_Segment_v2.xlsx):
 *   m+1 band row · m+2 headers · m+3 'NONPAYER' · m+4..m+8 segments · m+9 'PAYER' · m+10..m+14.
 ************************************************************************************************/

var SPS_SHEET = 'Sim per Segment';
var SPS_SEGMENTS = ['0-9','10-19','20-39','40-99','100+'];

// Source-category grouping — edit freely; every CATEGORY_ORDER entry should appear exactly once.
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

  // one engine pass per (payer, segment) — reused for all 11 resource tables
  var rows = {};   // payer|seg -> {cat: {sim, cur}}
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

  var filled = 0, skipped = [];
  for (var r = 0; r < vals.length; r++){
    var mMatch = String(vals[r][1] || '').match(/^◆\s*(.+)$/);   // column B markers
    if (!mMatch) continue;
    var res = mMatch[1].trim();
    if (RESOURCES.indexOf(res) === -1){ skipped.push(res); continue; }
    var m = r + 1;                                               // marker row, 1-based
    [{band: m + 3, payer: 'NONPAYER'}, {band: m + 9, payer: 'PAYER'}].forEach(function(blk){
      if (String(vals[blk.band - 1] && vals[blk.band - 1][1] || '').trim() !== blk.payer) return;
      var curOut = [], simOut = [];
      SPS_SEGMENTS.forEach(function(seg, i){
        var segRow = blk.band + 1 + i;
        var got = String(vals[segRow - 1] && vals[segRow - 1][1] || '').trim();
        var gs = groupSums(blk.payer, seg, res);
        if (got !== seg) skipped.push(res + ' ' + blk.payer + ' r' + segRow + " (label '" + got + "')");
        curOut.push(gs.cur); simOut.push(gs.sim);
        // Total + Δ formulas (rewrite so hand-edited tables heal themselves)
        sh.getRange(segRow, 7 ).setFormula('=SUM(C' + segRow + ':F' + segRow + ')');
        sh.getRange(segRow, 13).setFormula('=SUM(I' + segRow + ':L' + segRow + ')');
        for (var j = 0; j < 5; j++){
          var curC = String.fromCharCode(67 + j), simC = String.fromCharCode(73 + j);  // C..G / I..M
          sh.getRange(segRow, 15 + j)
            .setFormula('=IFERROR(' + simC + segRow + '/' + curC + segRow + '-1,"")');
        }
      });
      sh.getRange(blk.band + 1, 3, SPS_SEGMENTS.length, 4).setValues(curOut);   // C:F current
      sh.getRange(blk.band + 1, 9, SPS_SEGMENTS.length, 4).setValues(simOut);   // I:L simulated
    });
    filled++;
  }
  var msg = 'Sim per Segment: ' + filled + ' resource tables filled' +
            (skipped.length ? ' · skipped/flagged: ' + skipped.join(', ') : '');
  try { ss.toast(msg, 'EcoGainsSim', 8); } catch(e){}
  Logger.log(msg);
}

function round2_(x){ return Math.round(x * 100) / 100; }
