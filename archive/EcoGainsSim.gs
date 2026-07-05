/************************************************************************************************
 * EcoGainsSim.gs — simulation engine for EcoGainsSim_HC   (calendar-aware: reward x duration x cadence)
 * ---------------------------------------------------------------------------------------------
 * PER-EVENT MODEL:  new_per_earner[res] = measured[res] x R[res] x D x T
 *   R  reward-config ratio  (v2 ladder / base ladder, per resource) - from the diff, only Core/Saga
 *      and Daily Gift actually changed rewards; every event _v2 changed ONLY EventDuration, so R=1
 *      for the events. Flock (F_v2==F) and Night Sky (NS_v2==NS) did not change at all -> carried.
 *   D  duration multiplier  = accrualShare(new_dur) with the curve normalised to 1 at the current
 *      length - from data_event_accrual (data_event_kite_accrual for Kite). Shortening = interpolation
 *      (reliable); lengthening = extrapolation past observed days (capped + flagged).
 *   T  cadence x reach ratio = SUM over cal_new instances of reach(days) / SUM over cal_curr instances.
 *      reach(days)=1-PROD(1-p_d), p_d = weekend/weekday active rate (data_seg_beh). Captures both the
 *      number of instances AND that longer instances catch more of a population that is not on daily.
 *   Core/Saga and Daily Gift are always-on (no calendar instances): D=T=1, only R.  measured comes
 *   from data_gains, which reflects the CURRENT calendar (cal_curr) - the correct anchor.
 *
 * CALL (per-segment tables, named LET refs):
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_SIM(payer, segment))    // C8  (spills 25x11)
 *   =LET(payer, $C$3, segment, $B$6, ECOGAINS_DIFF(payer, segment))   // O8  (result - data)
 *   v3: 'Saga' is its own row (SagaPath/SagaChestRewards); 'Core' (chapter_complete +
 *   PlayerLevelUpChest) is carried unchanged. The c_saga v2/base HC ratio applies to Saga only.
 *
 * FLAGS: (1) BB's EventDuration (3->4) contradicts the calendar (4->3); calendar wins here.
 *   (2) Challenges/HH lengthen, so D is extrapolated - treat as lower-confidence, capped.
 *   (3) Level Race has no accrual curve -> D=1 (leaderboard reward is rank-based; cadence carries it).
 *   (4) Rainbow Maker is simulated via the milestone-reach method (current=0 since it is not in
 *   cal_curr, so the diff is the full addition); River Rush stays a stub by request.  (5) reach
 *   assumes the calendars start on a Wednesday (both do) for weekend detection.
 *   (6) TARGET DAY (special): its accrual token AND levels shares both saturate at day 1 (data
 *   instance_length=2, but the calendar runs it 7d), so D defaults to 1 and the sim likely OVER-states
 *   the shortened 7->1 event. Target Day rewards sit at milestones 26+ (very high cumulative score),
 *   which a 1-day run rarely reaches - so per-instance reward should FALL, offsetting the 5x cadence
 *   rise, not amplify it. A correct D needs a cumulative-SCORE-by-day curve (score->milestone->reward),
 *   which the token/levels accrual does not provide. Treat Target Day's result as an upper bound.
 ************************************************************************************************/

// ============================== LAYOUT CONSTANTS =============================================
var SHEET = 'EcoGainsSim_HC';
var PAYER_CELL = 'C3';
var SEG_CELL   = 'C4';   // fallback only
var CAL_CUR = 'cal_curr', CAL_NEW = 'cal_new';

var RESOURCES = ['HC','Slingshot','Shuffle','Comet','Red','Chuck','Bomb',
                 'UL Bomb','UL Chuck','UL Red','Unlimited Lives'];

// Sheet row order (must match EcoGainsSim_HC). Level Race added; Saga split out of Core (25 rows).
var CATEGORY_ORDER = [
  'Ads','Bomb Challenge',"Bomb's Ballet",'Chuck Challenge','Core','Daily Gift','Daily Night Sky Prize',
  'Flock Flurry','Hatchling Hideaway','Jigsaw','Kite Festival','Level Race','Other','Photoshoot',
  'Red Challenge','River Rush','Saga','Season Pass (Free)','Target Day','Team Event','Team Race','Flash Race',
  'FlowerCoop','Rainbow Maker','IAPs'
];

var SEG_TO_GAINS = {'0-9':'B. 1-9','10-19':'C. 10-19','20-39':'D. 20-39','40-99':'E. 40-99','100+':'F. 100+'};

// category -> {sim fn, and (for timed events) the calendar + accrual names}
var SOURCES = {
  'Saga'                  : {sim: simSaga },
  'Daily Gift'            : {sim: simDailyGift },
  'Bomb Challenge'        : {sim: simTimedEvent, cal:"Bomb's Challenge",   accr:'Bomb'              },
  'Chuck Challenge'       : {sim: simTimedEvent, cal:"Chuck's Challenge",  accr:'Chuck'             },
  'Red Challenge'         : {sim: simTimedEvent, cal:"Red's Challenge",    accr:'Red'               },
  'Flash Race'            : {sim: simTimedEvent, cal:'Flash Race',         accr:'Flash Race'        },
  'Level Race'            : {sim: simTimedEvent, cal:'Level Race',         accr:null                },  // no accrual curve
  'Kite Festival'         : {sim: simTimedEvent, cal:'Kite Festival',      accr:'Kite Festival', kite:true },
  'Hatchling Hideaway'    : {sim: simTimedEvent, cal:'Hatchling Hideaway', accr:'Hatchling Hideaway'},
  "Bomb's Ballet"         : {sim: simTimedEvent, cal:"Bomb's Ballet Show", accr:'Bombs Ballet'      },
  'Jigsaw'                : {sim: simTimedEvent, cal:'Jigsaw Puzzle',      accr:'Jigsaw'            },
  'Photoshoot'            : {sim: simTimedEvent, cal:'Photoshoot',         accr:'Photoshoot'        },
  'Target Day'            : {sim: simTimedEvent, cal:'Target Day',         accr:'Target Day'        },
  'Rainbow Maker'         : {sim: simRainbowMaker },
  'River Rush'            : {sim: simRiverRush }
  // NOT listed => carried: Ads, Core, Daily Night Sky Prize, Flock Flurry, Other, Season Pass (Free),
  // Team Event, Team Race, FlowerCoop, IAPs.  (Core carries: the reward change lives in the Saga row.)
};

// ============================== CUSTOM FUNCTIONS =============================================
/** @customfunction */
function ECOGAINS_SIM(payer, segment){
  var p = payer   || readCell_(PAYER_CELL) || 'NONPAYER';
  var s = segment || readCell_(SEG_CELL)   || '0-9';
  var ctx = Context.get();
  return CATEGORY_ORDER.map(function(cat){ return rowToArray_(resultRow_(cat, s, p, ctx)); });
}
/** @customfunction */
function ECOGAINS_DIFF(payer, segment){
  var p = payer   || readCell_(PAYER_CELL) || 'NONPAYER';
  var s = segment || readCell_(SEG_CELL)   || '0-9';
  var ctx = Context.get();
  return CATEGORY_ORDER.map(function(cat){
    var res = resultRow_(cat, s, p, ctx), dat = measuredRow_(cat, s, p, ctx.ds);
    return RESOURCES.map(function(r){ return num(res[r]) - num(dat[r]); });
  });
}

function resultRow_(cat, seg, payer, ctx){
  var src = SOURCES[cat];
  if (!src) return measuredRow_(cat, seg, payer, ctx.ds);        // carried
  return src.sim(seg, payer, ctx, cat) || measuredRow_(cat, seg, payer, ctx.ds);
}

// measured value shown for a category. Core and Saga are now SEPARATE rows (data_gains emits both),
// so no folding here — folding again would double-count Saga.
function measuredRow_(cat, seg, payer, ds){
  return ds.dataRow(cat, seg, payer);
}

// ============================== CONTEXT (all sheet reads live here) ===========================
// Bundles the DataStore + both parsed calendars. Replace .get() internals with passed ranges to param.
var Context = (function(){
  var _c = null;
  return { get: function(){
    if (_c) return _c;
    _c = { ds: DataStore.get(),
           calCur: parseCalendarInstances_(CAL_CUR),
           calNew: parseCalendarInstances_(CAL_NEW) };
    return _c;
  }};
})();

// ---- data_gains + data_seg_beh + accrual sheets (headers on ROW 1 after the query update) ----
var DataStore = (function(){
  var _cache = null;
  function build(gainsVals, behVals, accVals, kiteVals){
    var gh = headerIndex_(gainsVals[0]), gMap = {};
    for (var i=1;i<gainsVals.length;i++){ var r=gainsVals[i]; if(!r[gh['engagement_segment']]) continue;
      gMap[[r[gh['engagement_segment']],r[gh['payer_flag']],r[gh['category']],r[gh['resource']]].join('|')] = num(r[gh['amount_per_earner']]); }
    var bh = headerIndex_(behVals[0]), bMap = {};
    for (var j=1;j<behVals.length;j++){ var b=behVals[j]; if(!b[bh['segment']]) continue;
      var o={}; for (var nm in bh) o[nm]=b[bh[nm]]; bMap[[b[bh['segment']],b[bh['payer_flag']]].join('|')]=o; }
    // accrual: event|payer|segment -> [{day, share}] sorted; merge normal + kite sheets
    function accIndex(vals){ if(!vals||!vals.length) return {}; var h=headerIndex_(vals[0]), m={};
      for (var k=1;k<vals.length;k++){ var r=vals[k]; var ev=r[h['event_name']]; if(!ev) continue;
        var key=[ev,r[h['payer_flag']],r[h['segment']]].join('|'); (m[key]=m[key]||[]).push({day:num(r[h['event_day']]), share:num(r[h['cum_token_share_p50']])}); }
      for (var kk in m) m[kk].sort(function(a,b){return a.day-b.day;}); return m; }
    var aMap = accIndex(accVals); var kMap = accIndex(kiteVals);
    return {
      gains: function(seg,payer,cat,res){ return num(gMap[[SEG_TO_GAINS[seg]||seg,payer,cat,res].join('|')]); },
      dataRow: function(cat,seg,payer){ var o={},self=this; RESOURCES.forEach(function(r){o[r]=self.gains(seg,payer,cat,r);}); return o; },
      beh: function(seg,payer){ return bMap[[seg,payer].join('|')] || {}; },
      accrualCurve: function(ev,seg,payer,kite){ var m=kite?kMap:aMap; return m[[ev,payer,seg].join('|')] || m[[ev,payer,'0-9'].join('|')] || []; }
    };
  }
  return {
    get: function(){ if(_cache) return _cache; var ss=SpreadsheetApp.getActiveSpreadsheet();
      _cache = build(vals_(ss,'data_gains'), vals_(ss,'data_seg_beh'),
                     vals_(ss,'data_event_accrual'), vals_(ss,'data_event_kite_accrual')); return _cache; },
    fromRanges: function(g,b,a,k){ return build(g,b,a,k); }
  };
  function vals_(ss,name){ var sh=ss.getSheetByName(name); return sh?sh.getDataRange().getValues():[]; }
})();

// ============================== CALENDAR READER (verified: merge = instance, no collapsing) ===
var CAL_FIRST_ROW=5, CAL_LAST_ROW=25, CAL_FIRST_COL=2, CAL_LAST_COL=34;   // event grid B5:AH25
var CAL_ALIAS = { 'Mystery Puzzle':'Jigsaw Puzzle', "Chuck's Flash Race":'Flash Race' };
// returns { event: [ {days:[d..], dur} ] };  day = column - 1  (col B = day 1 ... AH = day 33)
function parseCalendarInstances_(sheetName){
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if(!sh) return {};
  var rng = sh.getRange(CAL_FIRST_ROW, CAL_FIRST_COL, CAL_LAST_ROW-CAL_FIRST_ROW+1, CAL_LAST_COL-CAL_FIRST_COL+1);
  var vals = rng.getValues(), merges = rng.getMergedRanges() || [], inst = {}, covered = {};
  function norm(v){ var s=String(v).replace(/\n/g,' ').trim(); return CAL_ALIAS[s]||s; }
  function add(name,c1,c2){ name=norm(name); var days=[]; for(var c=c1;c<=c2;c++) days.push(c-1);
    (inst[name]=inst[name]||[]).push({days:days, dur:c2-c1+1}); }
  merges.forEach(function(m){ var r1=m.getRow(),c1=m.getColumn(),nc=m.getNumColumns(),nr=m.getNumRows(),c2=c1+nc-1;
    var v=vals[r1-CAL_FIRST_ROW][c1-CAL_FIRST_COL];
    if(v!=='' && v!=null && String(v).trim()!=='') add(v,c1,c2);
    for(var r=r1;r<r1+nr;r++) for(var c=c1;c<=c2;c++) covered[r+','+c]=true; });
  for(var i=0;i<vals.length;i++) for(var j=0;j<vals[i].length;j++){
    var r=CAL_FIRST_ROW+i,c=CAL_FIRST_COL+j,v=vals[i][j];
    if(covered[r+','+c]) continue;
    if(v!=='' && v!=null && String(v).trim()!=='') add(v,c,c); }
  return inst;
}

// ============================== TIMED-EVENT SIM (R x D x T) ===================================
function simTimedEvent(seg, payer, ctx, cat){
  var src = SOURCES[cat], ds = ctx.ds;
  var cur = ctx.calCur[src.cal] || [], nw = ctx.calNew[src.cal] || [];
  if (!nw.length) return measuredRow_(cat, seg, payer, ds);          // not in new calendar -> unchanged
  var T = timingRatio_(cur, nw, seg, payer, ds);                     // cadence x reach
  var curDur = modalDur_(cur), newDur = modalDur_(nw);
  var D = (curDur === newDur || !src.accr) ? 1
        : accrualShare_(ds, src.accr, newDur, seg, payer, !!src.kite);   // curve normalised to 1 at curDur
  var m = measuredRow_(cat, seg, payer, ds), out = {};
  RESOURCES.forEach(function(r){ out[r] = num(m[r]) * D * T; });       // R = 1 for events (ladders unchanged)
  return out;
}

// SUM_new reach / SUM_cur reach.  reach(instance) = 1 - PROD_days(1 - p_day)
function timingRatio_(cur, nw, seg, payer, ds){
  var b = ds.beh(seg, payer);
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  var sc = reachSum_(cur, pWd, pWe); return sc > 0 ? reachSum_(nw, pWd, pWe)/sc : 0;
}
// SUM over instances of reach(days). Hardened: tolerates undefined lists / malformed instances
// (custom-function contexts can hand back odd shapes), so it degrades to 0 instead of throwing.
function reachSum_(list, pWd, pWe){
  if (!list || !list.length) return 0;
  var s = 0;
  for (var i=0;i<list.length;i++){ var inst=list[i]; if(!inst||!inst.days||!inst.days.length) continue;
    var q=1; for(var j=0;j<inst.days.length;j++){ q *= (1 - (isWeekend_(inst.days[j])?pWe:pWd)); }
    s += 1-q; }
  return s;
}
function isWeekend_(day){ var m=(day-1)%7; return m===2||m===3||m===4; }   // Fri/Sat/Sun (calendars start Wed)
function modalDur_(list){ if(!list||!list.length) return 0; var c={}; list.forEach(function(x){ c[x.dur]=(c[x.dur]||0)+1; });
  var best=0,bc=-1; for(var d in c) if(c[d]>bc){bc=c[d];best=+d;} return best; }

// cumulative reward fraction earned by day `dur`, normalised to 1 at the measured instance length.
function accrualShare_(ds, ev, dur, seg, payer, kite){
  var curve = ds.accrualCurve(ev, seg, payer, kite);
  if(!curve.length) return 1;
  var maxDay = curve[curve.length-1].day, maxShare = curve[curve.length-1].share || 1;
  function raw(d){
    if(d<=0) return 0;
    if(d>=maxDay){ // extrapolate (lengthening): add marginal of last observed step, cap at proportional
      var prev = curve.length>1 ? curve[curve.length-2] : {day:0,share:0};
      var marg = (maxShare - prev.share) / Math.max(1, maxDay - prev.day);
      return Math.min(maxShare + (d-maxDay)*marg, maxShare * d/maxDay);
    }
    for(var i=1;i<curve.length;i++){ if(d<=curve[i].day){ var a=curve[i-1],c=curve[i];
      return a.share + (c.share-a.share)*(d-a.day)/Math.max(1e-9,(c.day-a.day)); } }
    return maxShare;
  }
  return raw(dur) / (maxShare || 1);   // normalise so share(maxDay)=1 => D = share(newDur)
}

// ============================== ALWAYS-ON SIMS (reward ratio only) ============================
// Saga (own row since v3): Saga_sim[HC] = Saga_data[HC] x (v2Avg/baseAvg); non-HC carried.
// Core is a separate CARRIED row now (chapter_complete / PlayerLevelUpChest rewards unchanged).
function simSaga(seg, payer, ctx){
  var ds = ctx.ds, sagaRow = ds.dataRow('Saga', seg, payer);
  var baseAvg = sagaCycleAvg_(readSagaBase_()), v2Avg = sagaCycleAvg_(readSagaV2_(seg));
  var ratio = (baseAvg && baseAvg>0 && v2Avg!=null) ? v2Avg/baseAvg : 1, out = {};
  RESOURCES.forEach(function(r){ out[r] = (r==='HC' ? num(sagaRow[r])*ratio : num(sagaRow[r])); });
  return out;
}
// Daily Gift: measured gift HC x streak-weighted new/old day-ladder ratio (HC only).
function simDailyGift(seg, payer, ctx){
  var ds = ctx.ds, out = ds.dataRow('Daily Gift', seg, payer);
  var base = readDayLadder_('c_day'), v2 = readDayLadder_('c_day_v2');
  if (laddersEqual_(base, v2)) return out;
  var w = reachWeights_(ds.beh(seg,payer)), sOld = weightedSum_(base,w), sNew = weightedSum_(v2,w);
  out['HC'] = num(out['HC']) * (sOld>0 ? sNew/sOld : 1);
  return out;
}

// ============================== STUBS =========================================================
/**
 * RAINBOW MAKER - milestone-reach sim. Added in cal_new (5x4d) and absent from cal_curr, so the
 * measured/current value is ~0 and the DIFF shows the full addition. Method:
 *   per-instance reward[res] = SUM over milestones k with ReqAccum[k] <= matchables_p50(seg,payer)
 *                              of reward_k[res]            (config read live from the 'RM' sheet)
 *   RM[res] = per-instance reward[res] x nEff,  nEff = expected # of the 5 new instances a player is
 *             active for (reach over cal_new 'Rainbow Maker' instances).
 * matchables_p50 is read from an 'RM_matchables' sheet if present (cols: segment | payer_flag |
 * matchables), else from the built-in map below (from 1__Rainbow_Maker_Sim.xlsx 'Sim Per Segment').
 * ASSUMPTION (flagged): matchables_p50 is treated as PER-INSTANCE; if it is per-window, divide by nEff.
 */
var RM_MATCHABLES = {  // fallback from RM reference sim ('Sim Per Segment' matchables p50) - move to an RM_matchables data sheet to override
  'NONPAYER':{'0-9':3935,'10-19':15214,'20-39':30450,'40-99':67452,'100+':127482},
  'PAYER'   :{'0-9':4410,'10-19':15870,'20-39':30740,'40-99':65920,'100+':138432}
};
function simRainbowMaker(seg, payer, ctx){
  var ds = ctx.ds, cfg = readRMConfig_(), M = rmMatchables_(seg, payer);
  var per = {}; RESOURCES.forEach(function(r){ per[r]=0; });
  cfg.forEach(function(ms){ if(M >= ms.req){ for(var res in ms.rew){ per[res] = num(per[res]) + ms.rew[res]; } } });
  var b = ds.beh(seg, payer);
  var nEff = reachSum_(ctx.calNew['Rainbow Maker'] || [], num(b.weekday_active_rate), num(b.weekend_active_rate));
  var out = {}; RESOURCES.forEach(function(r){ out[r] = num(per[r]) * nEff; });
  return out;
}
function rmMatchables_(seg, payer){
  var v = sheetVals_('RM_matchables');
  if (v && v.length>1){ var h=headerIndex_(v[0]), pc=(h['payer_flag']!=null?h['payer_flag']:h['payer']), mc=(h['matchables']!=null?h['matchables']:h['matchables_p50']);
    for(var i=1;i<v.length;i++){ if(String(v[i][h['segment']])===seg && String(v[i][pc])===payer) return num(v[i][mc]); } }
  return ((RM_MATCHABLES[payer]||{})[seg]) || 0;
}
// live 'RM' sheet: Milestone | Matchables Req | Req Accum | Chest | Coins | SPT | SPT x2 | Red | ... reward cols
function readRMConfig_(){
  var v = sheetVals_('RM'), out = [], hr = -1;
  for(var r=0;r<v.length;r++){ if(String(v[r][0]).indexOf('Milestone')>=0){ hr=r; break; } }
  if(hr<0) return out;
  var h = {}; v[hr].forEach(function(x,i){ if(x!=null && x!=='') h[String(x).trim()]=i; });
  var map = {'Coins':'HC','Coin':'HC','Slingshot':'Slingshot','Shuffle':'Shuffle','Comet':'Comet','Red':'Red',
             'Chuck':'Chuck','Bomb':'Bomb','Unlimited Bomb':'UL Bomb','Unlimited Chuck':'UL Chuck',
             'Unlimited Red':'UL Red','Unlimited Lives':'Unlimited Lives'};
  for(var r2=hr+1;r2<v.length;r2++){ var row=v[r2]; if(row[0]==null||row[0]==='') break;
    var rew={}; for(var col in map){ if(h[col]!=null && num(row[h[col]])) rew[map[col]]=num(row[h[col]]); }
    out.push({ req:num(row[h['Req Accum']]), rew:rew }); }
  return out;
}

// RIVER RUSH - data-only stub (by request; RR_v2==RR, absent from both calendars).
function simRiverRush(seg, payer, ctx){ return measuredRow_('River Rush', seg, payer, ctx.ds); }

// ============================== CONFIG READERS ===============================================
function readSagaBase_(){ var v=sheetVals_('c_saga'), out=[];
  for(var r=3;r<v.length;r++){ if(v[r][0]==null||v[r][0]==='') break; out.push([num(v[r][1]),num(v[r][2])]); } return out; }
function readSagaV2_(seg){ var v=sheetVals_('c_saga_v2'); var col={'0-9':1,'10-19':3,'20-39':5,'40-99':7,'100+':9}[seg];
  if(col==null) return null; var out=[];
  for(var r=4;r<v.length;r++){ if(v[r][0]==null||v[r][0]==='') break; out.push([num(v[r][col]),num(v[r][col+1])]); } return out; }
function sagaCycleAvg_(l){ if(!l||!l.length) return null; var hc=0,lv=0; l.forEach(function(n){lv+=n[0];hc+=n[1];}); return lv>0?hc/lv:null; }
function readDayLadder_(name){ var v=sheetVals_(name), out=[];
  for(var r=3;r<v.length && out.length<7;r++){ if(v[r][0]==null||v[r][0]==='') break; out.push(num(v[r][1])); } return out; }

// ============================== HELPERS ======================================================
function reachWeights_(b){ var p50=num(b.login_streak_p50),p75=num(b.login_streak_p75),p90=num(b.login_streak_p90);
  var pts=[[0,0],[p50,0.5],[p75,0.75],[p90,0.9]];
  function cdf(x){ if(x<=0) return 0; for(var i=1;i<pts.length;i++){ if(x<=pts[i][0]){ var a=pts[i-1],c=pts[i],d=(c[0]-a[0])||1; return a[1]+(c[1]-a[1])*(x-a[0])/d; } } return Math.min(1,0.9+(x-p90)*0.1/((p90)||1)); }
  var w=[]; for(var n=1;n<=7;n++) w.push(Math.max(0,1-cdf(n-1))); return w; }
function weightedSum_(vals,w){ var s=0; for(var i=0;i<vals.length;i++) s+=num(vals[i])*num(w[i]||0); return s; }
function laddersEqual_(a,b){ if(a.length!==b.length) return false; for(var i=0;i<a.length;i++) if(num(a[i])!==num(b[i])) return false; return true; }
function rowToArray_(o){ return RESOURCES.map(function(r){ return num(o[r]); }); }
function headerIndex_(row){ var m={}; row.forEach(function(h,i){ if(h!=null && h!=='') m[String(h)]=i; }); return m; }
function num(x){ var n=parseFloat(x); return isNaN(n)?0:n; }
function readCell_(a1){ try{ return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET).getRange(a1).getValue(); }catch(e){ return null; } }
function sheetVals_(name){ var sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); return sh?sh.getDataRange().getValues():[]; }