/************************************************************************************************
 * KiteExplain.gs - the Kite Festival explainer (D101, 2026-11-10).
 * ---------------------------------------------------------------------------------------------
 * REQUIRES EcoGainsSim_v4.gs (and EcoGainsSim_Daily.gs) in the same project. Defines no rule of its
 * own: every number below is read off the engine's own functions (rewardE_, laneVariantE_,
 * laneReachDetail_, timingRatio_, measuredRow_, resultRow_, lbRankDist_, kiteJoin_ ...), so the sheet
 * can never disagree with ECOGAINS_SIM or the change summary. Standalone like CalStats.gs / HCPerWin.gs,
 * so an engine rewrite cannot delete it.
 *
 *   =ECOGAINS_KITE(payer, segment, "PARAMS",    sim_refresh!$A$1)   label | value | what it is
 *   =ECOGAINS_KITE(payer, segment, "RESULT",    sim_refresh!$A$1)   today vs redesign, R / T / D, per resource
 *   =ECOGAINS_KITE(payer, segment, "FESTIVALS", sim_refresh!$A$1)   one row per festival on both calendars
 *   =ECOGAINS_KITE(payer, segment, "RANKS",     sim_refresh!$A$1)   chance of each finishing place + what it pays
 *
 * Resource columns are the Kite config sheet's own (Coins .. ToF_Ticket, COOP Token and Avatar included),
 * read off Ki_v2's ladder header, so the tables read like every config sheet. Per PLAYER, like the change
 * summary (D88): an amount the export carries is x its earners / the cell's players.
 ************************************************************************************************/
var KITEX_BUILD = 'KiteExplain.gs D101  2026-11-10';
var KX_CAT = 'Kite Festival', KX_LANE = 'Kite Festival';
var KX_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** @customfunction */
function ECOGAINS_KITE(payer, segment, block, nonce){
  var p = String(payer || 'NONPAYER').trim().toUpperCase();
  var s = String(segment || '0-9').trim();
  var blk = String(block || 'PARAMS').trim().toUpperCase();
  var m;
  try { m = kxModel_(p, s); } catch (e){ return [['Kite explainer could not run: ' + e.message]]; }
  if (!m.ok) return [[m.why]];
  if (blk === 'PARAMS') return kxPad_(m.params);
  if (blk === 'RESULT') return kxPad_(m.result);
  if (blk === 'FESTIVALS') return kxPad_(m.festivals);
  if (blk === 'RANKS') return kxPad_(m.ranks);
  return [['Unknown block: ' + blk + ' (use PARAMS / RESULT / FESTIVALS / RANKS)']];
}
function kxPad_(g){
  var w = g.reduce(function(a, r){ return Math.max(a, r.length); }, 0);
  return g.map(function(r){ var x = r.slice(); while (x.length < w) x.push(''); return x; });
}

/** The Kite config header, Coins .. ToF_Ticket, as the ladder block writes it: [{name, res}]. */
function kxCols_(){
  var spec = LB_R_SPECS[KX_CAT], v = sheetVals_(spec.v2);
  if (!v || !v.length) v = sheetVals_(spec.base);
  var row = (v && v[spec.hdr]) || [], out = [];
  for (var c = spec.c0; c < row.length; c++){
    var name = String(row[c] == null ? '' : row[c]).trim();
    if (!name) break;
    out.push({ name: name, res: RES_MAP[name] || null });
  }
  return out;
}

function kxDate_(day){
  var d1 = (typeof calDay1Date_ === 'function') ? calDay1Date_() : null;
  if (d1 == null) return '';
  var t = new Date((d1 + day - 1) * 86400000);
  var p2 = function(x){ return (x < 10 ? '0' : '') + x; };
  return t.getUTCFullYear() + '-' + p2(t.getUTCMonth() + 1) + '-' + p2(t.getUTCDate());
}
function kxDowName_(day){
  var k = (calDay1Dow_() - 1 + (day - 1)) % 7;
  if (k < 0) k += 7;
  return KX_DOW[k];
}
function kxEnvTier_(rew){
  var parts = [];
  PACK_RES.forEach(function(r){ var n = num(rew && rew[r]); if (n > 0) parts.push((n === 1 ? '' : n + 'x ') + r.replace(' Pack', '')); });
  return parts.join(' + ');
}

/** Everything the sheet shows for one cell, memoised per execution. */
function kxModel_(payer, segInput){
  var ctx = Context.get(), ds = ctx.ds;
  ctx._kx = ctx._kx || {};
  var seg = segCanon_(segInput), key = seg + '|' + payer;
  if (ctx._kx[key]) return ctx._kx[key];
  var fail = function(why){ return (ctx._kx[key] = { ok: false, why: why }); };
  if (!ctx.calCurOk || !ctx.calNewOk) return fail('The calendars could not be read - run EcoGainsSim > Precompute calendars.');
  var spec = LB_R_SPECS[KX_CAT];
  if (!spec) return fail('Kite Festival is not priced as a leaderboard in this engine.');
  var b = ds.beh(seg, payer) || {};
  var pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  if (!(pWd > 0) && !(pWe > 0)) return fail('No activity data for ' + segInput + ' ' + payer + ' in data_seg_beh.');
  var cur = (ctx.calCur[KX_LANE] || []).slice().sort(function(a, c){ return a.start - c.start; });
  var nw = (ctx.calNew[KX_LANE] || []).slice().sort(function(a, c){ return a.start - c.start; });
  var inst = ds.eventInst(spec.inst, seg, payer);
  var E = rewardE_(KX_CAT, seg, payer, ds, null, 1);
  if (!E) return fail('No Kite ladder could be priced for ' + segInput + ' ' + payer + '.');
  var eCache = { '': E };
  var eOf = function(v){ v = v || ''; if (eCache[v] === undefined) eCache[v] = rewardE_(KX_CAT, seg, payer, ds, v, 1) || E; return eCache[v]; };
  var VE = laneVariantE_(KX_CAT, cur, nw, seg, payer, ctx, E, 1);
  var Eb = VE ? VE.eBase : E.eBase, Ev = VE ? VE.eV2 : E.eV2;
  var T = timingRatio_(cur, nw, seg, payer, ds, KX_LANE), Tplain = timingRatio_(cur, nw, seg, payer, ds);
  var meas = measuredRow_(KX_CAT, seg, payer, ds), res = resultRow_(KX_CAT, seg, payer, ctx);
  var exp = measuredRowCore_(KX_CAT, seg, payer, ds);
  var cols = kxCols_();
  // per player (D88): an amount the export carries is per earner of that resource
  var players = ds.players(seg, payer), f = {};
  RESOURCES.forEach(function(r){
    f[r] = (players > 0 && ds.hasGain(seg, payer, KX_CAT, r) && ds.earners(seg, payer, r) > 0) ? ds.earners(seg, payer, r) / players : 1;
  });
  var pp = function(row){ var o = {}; RESOURCES.forEach(function(r){ o[r] = num(row[r]) * f[r]; }); return o; };
  var curP = pp(meas), newP = pp(res);
  var prices = (typeof csPrices_ === 'function') ? csPrices_() : itemVals_();
  var value = function(row){ var t = 0; RESOURCES.forEach(function(r){ t += num(row[r]) * num(prices[r]); }); return t; };

  // ---- festivals ------------------------------------------------------------------------------
  var fest = [], sides = [['Today', cur, 'eBase'], ['Redesign', nw, 'eV2']];
  var sumRE = { Today: {}, Redesign: {} }, sumR = { Today: 0, Redesign: 0 };
  var info = [];
  sides.forEach(function(sd){
    sd[1].forEach(function(x, i){
      var det = laneReachDetail_(KX_LANE, x, pWd, pWe, seg, payer);
      var v = x.variant || '', sp = v ? variantSpec_(spec, v) : spec;
      var sheet = (sd[0] === 'Today') ? sp.base : sp.v2;
      var e = eOf(v)[sd[2]] || {};
      var days = (x.days || []).filter(function(d){ return d >= 1; });
      var we = days.filter(isWeekend_).length;
      info.push({ side: sd[0], i: i + 1, x: x, det: det, sheet: sheet, e: e, days: days, we: we });
      sumR[sd[0]] += det.reach;
      RESOURCES.forEach(function(r){ sumRE[sd[0]][r] = num(sumRE[sd[0]][r]) + det.reach * num(e[r]); });
    });
  });
  var festHdr = ['Calendar', 'Festival', 'Start (window day)', 'Date', 'Days of the week', 'Length (days)', 'Weekend days',
                 'Type', 'Reward sheet', 'Reach from activity only', 'Joiner keep', 'Reach used',
                 'Coins per festival entered', 'Envelopes per festival entered']
                 .concat(cols.map(function(c){ return c.name + ' (per player)'; }));
  fest.push(festHdr);
  info.forEach(function(it){
    var tot = (it.side === 'Today') ? curP : newP, row = [];
    var envE = 0; PACK_RES.forEach(function(r){ envE += num(it.e[r]); });
    var typ = (it.we * 2 >= it.days.length && it.we > 0) ? 'Weekend' : 'Weekday';
    row.push(it.side, it.i, it.x.start, kxDate_(it.x.start), it.days.map(kxDowName_).join('-'), it.x.dur, it.we, typ, it.sheet,
             it.det.plain, it.det.applied ? it.det.keep : 1, it.det.reach, num(it.e['HC']), envE);
    cols.forEach(function(c){
      if (!c.res){ row.push(0); return; }
      var den = num(sumRE[it.side][c.res]);
      var share = (den > 1e-12) ? it.det.reach * num(it.e[c.res]) / den : (sumR[it.side] > 0 ? it.det.reach / sumR[it.side] : 0);
      row.push(num(tot[c.res]) * share);
    });
    fest.push(row);
  });
  var pick = function(side, typ){ return info.filter(function(it){ return it.side === side && ((it.we * 2 >= it.days.length && it.we > 0) ? 'Weekend' : 'Weekday') === typ; }); };
  var avg = function(list, fn){ if (!list.length) return ''; var t = 0; list.forEach(function(it){ t += fn(it); }); return t / list.length; };
  var modeStr = function(list, fn){ var c = {}, best = '', bc = 0; list.forEach(function(it){ var k = String(fn(it)); c[k] = (c[k] || 0) + 1; if (c[k] > bc){ bc = c[k]; best = k; } }); return best; };

  // ---- places ---------------------------------------------------------------------------------
  var rd = lbRankDist_(spec.base, spec, inst), dist = rd.dist || [];
  var cum = 0, pTop = function(k){ var t = 0; dist.forEach(function(d){ if (d.rank <= k) t += d.p; }); return t; };
  var meanRank = 0; dist.forEach(function(d){ meanRank += d.rank * d.p; });
  var sheetsUsed = [];
  info.forEach(function(it){ if (sheetsUsed.indexOf(it.sheet) < 0) sheetsUsed.push(it.sheet); });
  var ladders = sheetsUsed.map(function(sh){
    var sp = spec;
    info.forEach(function(it){ if (it.sheet === sh && it.x.variant) sp = variantSpec_(spec, it.x.variant); });
    return { sheet: sh, lad: lbLadder_(sh, sp) };
  });
  var ranks = [['Place', 'Chance to finish here', 'Chance to finish here or better']
               .concat([].concat.apply([], ladders.map(function(l){ return [l.sheet + ': Coins', l.sheet + ': Envelope']; })))];
  var lastPaid = 0;
  ladders.forEach(function(l){ for (var k in l.lad) if (num(l.lad[k]['HC']) > 0 || kxEnvTier_(l.lad[k])) lastPaid = Math.max(lastPaid, +k); });
  dist.forEach(function(d){
    cum += d.p;
    var row = [d.rank, d.p, Math.min(1, cum)];
    ladders.forEach(function(l){ var rw = l.lad[d.rank] || {}; row.push(num(rw['HC']), kxEnvTier_(rw)); });
    ranks.push(row);
  });

  // ---- score milestone ------------------------------------------------------------------------
  var msReq = '', msP = '';
  if (spec.ms && inst){
    var vv = sheetVals_(spec.v2);
    msReq = num(vv[spec.ms.r0] && vv[spec.ms.r0][spec.ms.reqC]);
    var Sk = survival_([[num(inst.final_balance_p25), .25], [num(inst.final_balance_p50), .5], [num(inst.final_balance_p75), .75]]);
    msP = (Sk && msReq > 0) ? Sk(msReq) : '';
  }

  // ---- opt-in ---------------------------------------------------------------------------------
  var J = kiteJoin_(seg, payer), lbl = readSPLabel_(spec.v2, 'Participation');
  var used = packParticipation_(KX_CAT, inst);
  var optSrc = (lbl !== null && lbl !== '' && isFinite(parseFloat(lbl))) ? 'typed on ' + spec.v2 + ' (Participation)'
             : (J ? 'measured (kite_joiners)' : 'design guess (no kite_joiners table)');

  // ---- result ---------------------------------------------------------------------------------
  var expHasBU = bottomUpHasData_(exp);
  var how = function(r){
    if (!r) return 'not simulated';
    if (BOTTOMUP_RES.indexOf(r) >= 0) return expHasBU ? 'data x model change' : 'model (bottom-up)';
    if (num(Eb[r]) > 1e-9) return 'today x R x T';
    if (num(Ev[r]) > 1e-9) return 'new reward, priced bottom-up';
    if (num(meas[r]) > 0) return 'today x T (not on the ladder)';
    return '';
  };
  var anc = (typeof packAnchorRow_ === 'function') ? (packAnchorRow_(KX_CAT, seg, payer) || {}) : {};
  var walk = SOURCES[KX_CAT](seg, payer, ctx, KX_CAT) || {};
  var result = [['What', ''].concat(cols.map(function(c){ return c.name; }))];
  var line = function(lbl2, note, fn){ result.push([lbl2, note].concat(cols.map(function(c){ return c.res ? fn(c.res) : ''; }))); };
  line('Today, per player', '28-day window', function(r){ return num(curP[r]); });
  line('Redesign, per player', '28-day window', function(r){ return num(newP[r]); });
  line('Change', 'redesign / today - 1', function(r){ var a = num(curP[r]), n = num(newP[r]); return a > 1e-12 ? n / a - 1 : (n > 1e-12 ? 'new' : ''); });
  line('R', 'reward per festival entered, redesign / today', function(r){
    if (BOTTOMUP_RES.indexOf(r) >= 0) return '';
    return num(Eb[r]) > 1e-9 ? num(Ev[r]) / num(Eb[r]) : ''; });
  line('T', 'festivals x reach, redesign / today', function(r){ return (how(r) === 'today x R x T' || how(r) === 'today x T (not on the ladder)') ? T : ''; });
  line('D', 'duration (fixed: paid by place)', function(r){ return (how(r) === 'today x R x T' || how(r) === 'today x T (not on the ladder)') ? 1 : ''; });
  line('Envelope model change', 'model redesign / model today', function(r){
    if (BOTTOMUP_RES.indexOf(r) < 0) return '';
    var c = num(anc[r]), n = num(walk[r]); return c > 1e-12 ? n / c : (n > 1e-12 ? 'new' : ''); });
  line('How it is priced', '', how);
  line('Share of players who earn it today', 'earners / players', function(r){ return f[r]; });

  // ---- params ---------------------------------------------------------------------------------
  var wkd = pick('Redesign', 'Weekday'), wke = pick('Redesign', 'Weekend'), tdy = info.filter(function(it){ return it.side === 'Today'; });
  var r3 = 1 - Math.pow(1 - pWd, 3), r2 = 1 - Math.pow(1 - pWd, 2);
  var keep2wd = laneReachDetail_(KX_LANE, mkInst_(kxFirstWeekday_(), 2), pWd, pWe, seg, payer);
  var curVal = value(curP), newVal = value(newP);
  var params = [['Parameter', 'Value', 'What it is']];
  var rnd = function(x){
    if (typeof x !== 'number' || !isFinite(x)) return x;
    return Math.abs(x) >= 100 ? Math.round(x * 10) / 10 : Math.round(x * 1e4) / 1e4;
  };
  var P = function(k, v2, d){ params.push([k, (v2 == null) ? '' : rnd(v2), d || '']); };
  P('Segment', segLabel_(seg, ds), 'the selected players');
  P('Payer', payer, '');
  P('Players in this group', players, 'players_in_cell (data_gains)');
  P('Window days', windowDays_(), 'days compared (row 4 of the calendars)');
  P('Weekday activity', pWd, 'share of weekdays these players are online (data_seg_beh)');
  P('Weekend activity', pWe, 'share of Fri/Sat/Sun these players are online (data_seg_beh)');
  P('Place p25', inst ? num(inst.position_p25) : '', 'a quarter of finishes are at this place or better (data_event_inst)');
  P('Place p50', inst ? num(inst.position_p50) : '', 'half of finishes are at this place or better');
  P('Place p75', inst ? num(inst.position_p75) : '', 'three quarters of finishes are at this place or better');
  P('Chance of 1st place', pTop(1), 'from the measured places');
  P('Chance of top 3', pTop(3), 'top 3 pay the 5/4/3-star envelopes');
  P('Chance of top 10', pTop(10), '');
  P('Chance of a paid place', pTop(lastPaid || 25), 'places 1-' + (lastPaid || 25) + ' pay something');
  P('Average place', meanRank, '');
  P('League size', dist.length, 'places the model spreads finishes over');
  P('Score milestone (points)', msReq, 'the join reward: reaching it pays 30 min Unlimited Lives');
  P('Chance of the score milestone', msP, 'among players who take part');
  P('Opt-in (measured)', J ? J.optin : '', 'joiners per festival / players (kite_joiners)');
  P('Opt-in among active players', J ? J.optinActive : '', 'opt-in / reach of a measured festival');
  P('Opt-in used for envelopes', used, optSrc);
  P('Old opt-in guess', (typeof PACK_PARTICIPATION !== 'undefined') ? num(PACK_PARTICIPATION[KX_CAT]) : '', 'D25 design guess, replaced by the measurement');
  P('Measured festival length', J ? J.u.length : '', 'days of the festivals the joiners were measured on');
  P('Joined on day 1', J ? kxShare_(seg, payer, 0) : '', 'share of joiners, measured');
  P('Joined on day 2', J ? kxShare_(seg, payer, 1) : '', '');
  P('Joined on day 3', J ? kxShare_(seg, payer, 2) : '', '');
  P('Late joiners who join earlier', (typeof KITE_JOIN_SHIFT !== 'undefined') ? KITE_JOIN_SHIFT : '', 'assumption: of the joiners a shorter festival loses, this share joins on an earlier day instead');
  P('Reach of a 3-day weekday festival', r3, '1 - (1 - weekday activity)^3');
  P('Reach of a 2-day weekday festival (activity only)', r2, '1 - (1 - weekday activity)^2');
  P('2-day weekday festival keeps', keep2wd.applied ? keep2wd.keep : r2 / r3, keep2wd.applied ? 'share of a 3-day festival\'s joiners (measured join days + late joiners)' : 'activity only (no kite_joiners table)');
  P('2-day keeps (activity only)', r2 / r3, 'what average activity alone would say');
  P('Festivals today', tdy.length, 'cal_curr, inside the window');
  P('Festival days today', tdy.reduce(function(a, it){ return a + it.days.length; }, 0), '');
  P('Reach sum today', sumR.Today, 'sum of every festival\'s reach');
  P('Average reach today', tdy.length ? sumR.Today / tdy.length : '', '');
  P('Festivals redesign', wkd.length + wke.length, 'cal_new, inside the window');
  P('Festival days redesign', wkd.concat(wke).reduce(function(a, it){ return a + it.days.length; }, 0), '');
  P('Reach sum redesign', sumR.Redesign, '');
  P('Average reach redesign', (wkd.length + wke.length) ? sumR.Redesign / (wkd.length + wke.length) : '', '');
  P('T', T, 'reach sum redesign / reach sum today');
  P('T from activity only', Tplain, 'what T would be without the measured join days');
  P('D', 1, 'duration factor - fixed at 1: Kite pays by finishing place, not by tokens collected');
  P('R coins', num(Eb['HC']) > 1e-9 ? num(Ev['HC']) / num(Eb['HC']) : '', 'coins per festival entered, redesign / today');
  P('Coins per festival entered today', num(Eb['HC']), 'every place weighted by its chance');
  P('Coins per festival entered redesign', num(Ev['HC']), 'average over the redesign\'s festivals, weighted by reach');
  P('Export scale coins', ds.scaleFn ? ds.scaleFn(KX_CAT, seg, payer, 'HC') : 1, 'the 22-day export stretched to the 28-day window');
  P('Coins today per player', num(curP['HC']), '');
  P('Coins redesign per player', num(newP['HC']), '');
  P('Coins change', num(curP['HC']) > 0 ? num(newP['HC']) / num(curP['HC']) - 1 : '', '');
  P('Value today (coins-eq)', curVal, 'every resource priced with item_vals');
  P('Value redesign (coins-eq)', newVal, '');
  P('Value change', curVal > 0 ? newVal / curVal - 1 : '', '');
  var envCur = 0, envNew = 0; PACK_RES.forEach(function(r){ envCur += num(curP[r]); envNew += num(newP[r]); });
  P('Envelopes today per player', envCur, 'all tiers');
  P('Envelopes redesign per player', envNew, '');
  P('Envelopes change', envCur > 0 ? envNew / envCur - 1 : '', '');
  [['Weekday', wkd], ['Weekend', wke]].forEach(function(g){
    var L = g[1];
    P(g[0] + ' festivals', L.length, 'redesign festivals of this type');
    P(g[0] + ' festival length', L.length ? +modeStr(L, function(it){ return it.x.dur; }) : '', 'days');
    P(g[0] + ' festival days', L.length ? modeStr(L, function(it){ return it.days.map(kxDowName_).join('-'); }) : '', '');
    P(g[0] + ' festival sheet', L.length ? modeStr(L, function(it){ return it.sheet; }) : '', 'reward sheet');
    P(g[0] + ' festival reach (activity only)', avg(L, function(it){ return it.det.plain; }), '');
    P(g[0] + ' festival joiner keep', avg(L, function(it){ return it.det.applied ? it.det.keep : 1; }), '1 = full-length festival');
    P(g[0] + ' festival reach used', avg(L, function(it){ return it.det.reach; }), '');
    P(g[0] + ' festival coins per entry', avg(L, function(it){ return num(it.e['HC']); }), '');
    P(g[0] + ' festival envelopes per entry', avg(L, function(it){ var t = 0; PACK_RES.forEach(function(r){ t += num(it.e[r]); }); return t; }), '');
    P(g[0] + ' festival 4/5-star per entry', avg(L, function(it){ return num(it.e['4-star Pack']) + num(it.e['5-star Pack']); }), '');
  });
  P('Today festival length', tdy.length ? +modeStr(tdy, function(it){ return it.x.dur; }) : '', 'days');
  P('Today festival days', tdy.length ? modeStr(tdy, function(it){ return it.days.map(kxDowName_).join('-'); }) : '', '');
  P('Today festival sheet', tdy.length ? modeStr(tdy, function(it){ return it.sheet; }) : '', '');
  P('Engine', ENGINE_BUILD + ' / ' + KITEX_BUILD, '');

  return (ctx._kx[key] = { ok: true, params: params, result: result, festivals: fest, ranks: ranks });
}
function kxShare_(seg, payer, j){
  var J = kiteJoin_(seg, payer);
  if (!J) return '';
  // the stored s_j are the measured shares; recover them from the table row (u is activity-free)
  var tab = sheetVals_(KITE_JOIN_SHEET), hr = -1, h = {};
  for (var r = 0; r < tab.length && hr < 0; r++){
    var hh = {}; (tab[r] || []).forEach(function(x, i){ var k = String(x == null ? '' : x).trim(); if (k) hh[k] = i; });
    if (hh['segment'] != null && hh['opt_in_active'] != null){ hr = r; h = hh; }
  }
  if (hr < 0 || h['s' + (j + 1)] == null) return '';
  var want = segCanon_(seg), c = want, hops = 0;
  while (c && hops++ < 4){
    for (var i = hr + 1; i < tab.length; i++){
      var x = tab[i] || [];
      if (segCanon_(x[h['segment']]) === c && String(x[h['payer_flag']]).trim().toUpperCase() === payer &&
          num(x[h['joiners_per_instance']]) >= KITE_JOIN_MIN) return num(x[h['s' + (j + 1)]]);
    }
    c = SEG_PARENT[c];
  }
  return '';
}
function kxFirstWeekday_(){
  for (var d = 1; d <= 14; d++) if (!isWeekend_(d) && !isWeekend_(d + 2)) return d;
  return 1;
}
