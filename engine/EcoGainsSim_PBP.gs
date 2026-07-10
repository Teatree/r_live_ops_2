/************************************************************************************************
 * EcoGainsSim_PBP.gs - play-by-play session simulation (EcoGainsSim_PlybyPly sheet).
 * ---------------------------------------------------------------------------------------------
 * REQUIRES EcoGainsSim_v4.gs in the same Apps Script project (uses Context, DataStore,
 * RESOURCES, CATEGORY_ORDER, CAL_CUR/CAL_NEW, RES_MAP, readLadder_, readRMLadder_,
 * readRMDuration_, readNSLadder_, sheetVals_, headerIndex_, num, zeroRow_).
 *
 * ONE player, ONE calendar day, play by play: how a typical (segment x payer) player moves
 * through every event running that day.
 *
 * CUSTOM FUNCTIONS (all spill; header row included in the spill):
 *   =ECOGAINS_PBP(calendar, day, segment, payer, mode, luck, seed, [levels], [startLevel])
 *      -> ledger: header + S row (session-start claims) + N play rows + E row (day-end LB
 *         payouts) + blank + Session Summary (per-source x 13 resources + TOTAL).
 *         24 columns: Row | Play # | Level | Win? | Streak | Mult | CLAIMS (one milestone /
 *         node / claim PER ROW, as "Source what -> {bundle}"; extra claims on a play spill
 *         onto continuation rows) | 4 event-progress slots | 13 resources (running inventory).
 *         SPT/SPTx2 tracked since 2026-07-10 (D16); season-pass TIER claims are NOT simulated
 *         in the session view (window-sim only) — SPT appears here only as event payouts.
 *   =ECOGAINS_PBP_EVENTS(calendar, day, segment, payer, luck)   -> Active Events table.
 *   =ECOGAINS_PBP_PROFILE(segment, payer)                       -> Player Profile block.
 *   calendar 'cal_curr'|'cal_new'; day 1-33; segment '0-9'..'100+'; payer NONPAYER|PAYER;
 *   mode 'Expected'|'Sampled'; luck 'p25'|'p50'|'p75'; seed any integer (Sampled only);
 *   levels overrides N plays; startLevel = the saga level the player walks in on (blank ->
 *   seeded random 100-400; seed-independent in Expected mode).
 *
 * MODEL (keep the sheet notes in sync):
 *   1. N plays / win rate / streak persistence from data_streaks. Win draws are a 2-state
 *      Markov chain: P(W|W) = p_continue_after_win, P(W|L) solved so the stationary rate =
 *      win_rate_mean. The sim CONDITIONS on the player being active AND participating.
 *   2. Session-start event progress = measured final_balance_p25/50/75 (Luck) x accrual share
 *      (cum_token_share_mean curves; Kite has its own sheet). Milestones banked before today
 *      never appear in the ledger.
 *   3. Per-win token earning is MECHANICAL where the design docs give a rule (2026-07-04):
 *        - Hatchling Hideaway: flat 1.5 tokens / win (config 1/2/3 by difficulty; the level
 *          mix averages to 1.5 - user-approved constant). Gate unlock requirements stay the
 *          EventReach helper column (grid cost x 1.25 tile-inefficiency buffer): the buffer
 *          models bad tile picks and affects ONLY unlock timing, never the gains.
 *        - Bomb's Ballet: tokensPerLevel (config, 5) on FIRST-TRY wins only
 *          (spawnTokensOnlyOnFirstTry = TRUE). First try = no failed attempt at that level.
 *        - Jigsaw: Completion Bonus tiers from the 2021 Valentine's origin design doc
 *          (Copper 3 / Bronze 5 / Silver 7 / Gold 10 points per completion; win steps the
 *          tier up, loss steps it down, floor Copper, cap Gold; session starts at Copper -
 *          flagged assumption). Measured ~5.8 tokens/win corroborates; tokenMultiplier NOT
 *          applied (would double it). See source_docs/jigsaw.md.
 *        - Photoshoot: first-try streak multiplier ladder from config (x1/2/4/6/10); the
 *          per-win base is undocumented, so it is calibrated so the day total matches the
 *          measured accrual (shape = mechanics, level = measurement).
 *        - Rainbow Maker: no curve; measured matchables spread over the instance, per-win
 *          rounded to a whole number of matchables.
 *   4. Score events are STREAK-driven and share one engine: Kite score/win = Ki_v2 streak-step
 *      ladder, Target Day = TaD_v2 winStreakMultipliers. The raw streak model overshoots
 *      measured day-scores, so per-play increments are SCALED so the day total hits the
 *      measured target (model = SHAPE, measurement = LEVEL; user-approved).
 *   5. LB payouts land on the E row only for instances ENDING today: position = the Luck
 *      percentile of data_event_inst position_p25/50/75; Sampled mode jitters +/-0.25
 *      quantile with the seeded PRNG (deterministic per seed; custom functions cannot RAND()).
 *   6. Daily Gift is ALWAYS claimed at S (a login IS a claim; the old claim-rate gate is
 *      removed). Bundle = ONE concrete config variant (Expected: Variant 1; Sampled: seeded
 *      pick), never an average - claims are real integral bundles.
 *      Night Sky (re-wired 2026-07-06, NIGHT_SKY_REWIRE_PLAN): pays at day end. Effective
 *      streak = base x NS_STREAK_N (1.25, v4 constant); base = data_streaks
 *      max_streak_per_day_p50 (Expected) or the trace's longest win run (Sampled). EVERY
 *      milestone whose Cum Streak Req is cleared pays, each on its own row; nothing else does.
 *      Seed-averaged Sampled NS ≈ the 33-day sim's per-active-day E_day (reconciliation).
 *   7. Saga pays the FULL node bundle (HC + boosters + Unlimited minutes) read from c_saga
 *      (cal_curr) / c_saga_v2 per-segment (cal_new), at node boundaries anchored to the
 *      ABSOLUTE level (10-level nodes cycling every 100 levels). The player walks in
 *      mid-progress at startLevel. Core chapter chests are NOT simulated (cadence unknown).
 *   8. Flock Flurry opt-in grants 60 min Unlimited Lives at S (design-PDF constant, flagged).
 *   9. Ladders are read from the _v2 config sheets for BOTH calendars (project fact: _v2
 *      changed only EventDuration). HH/Ph milestone requirements come from the EventReach
 *      helper columns imported on HH_v2 (AV5:AV9) / Ph_v2 (AU5:AU34) - keep those sheets.
 *  10. SPT / COOP / Avatar / Dly rewards are outside the 11-resource universe -> not tracked.
 ************************************************************************************************/

var PBP_SHEET = 'EcoGainsSim_PlybyPly';
var PBP_FF_JOIN_UL = 60;   // min Unlimited Lives on opt-in (Flock Flurry design PDF; note 8)
var PBP_HH_TOKENS_PER_WIN = 1.5;  // HH config 1/2/3 by difficulty, level mix ~1.5 (note 3)
var PBP_JIGSAW_TIERS = [3, 5, 7, 10];  // Valentine's doc Copper/Bronze/Silver/Gold (note 3)
var PBP_PROGRESS_SLOTS = 4;
var PBP_SHOW_ACTIVITY_RATES = false;  // TRUE -> profile also shows p(active weekday/weekend)

// display names for bundles (engine resource -> sheet vocabulary)
var PBP_RES_DISPLAY = {'HC':'Coins','UL Red':'Unlimited Red','UL Chuck':'Unlimited Chuck',
                       'UL Bomb':'Unlimited Bomb','SPTx2':'SPT x2'};

// calendar label -> event spec. Ranges are 0-based [row, col] into sheetVals_(cfg).
// req: milestone requirement column; rew/hdr: reward block; lb: leaderboard ladder
// (posCol + first/last data row + reward cols + header row); completion: extra final row.
// earn: how tokens accrue per play ('tiers'|'flat'|'firstTry'|'streakmult'; default = spread
// of the measured day accrual over expected wins).
var PBP_EVENTS = {
  'Jigsaw Puzzle': {cat:'Jigsaw', family:'token', inst:'Jigsaw', cfg:'J_v2', earn:'tiers',
    req:{r0:10,r1:21,c:1}, rew:{r0:10,r1:21,c0:2,c1:22}, hdr:{r:9,c0:2,c1:22}},
  'Hatchling Hideaway': {cat:'Hatchling Hideaway', family:'token', inst:'Hatchling Hideaway',
    cfg:'HH_v2', earn:'flat', req:{r0:4,r1:8,c:47}, rew:{r0:11,r1:15,c0:1,c1:21},
    hdr:{r:10,c0:1,c1:21}},
  "Bomb's Ballet Show": {cat:"Bomb's Ballet", family:'token', inst:'Bombs Ballet', cfg:'BB_v2',
    earn:'firstTry', req:{r0:8,r1:22,c:1}, rew:{r0:8,r1:23,c0:2,c1:22}, hdr:{r:7,c0:2,c1:22},
    completion:true},
  'Photoshoot': {cat:'Photoshoot', family:'token', inst:'Photoshoot', cfg:'Ph_v2',
    earn:'streakmult', req:{r0:4,r1:33,c:46}, rew:{r0:24,r1:53,c0:7,c1:27},
    hdr:{r:23,c0:7,c1:27}},
  'Rainbow Maker': {cat:'Rainbow Maker', family:'rm'},
  'Kite Festival': {cat:'Kite Festival', family:'score', inst:'Kite Festival', cfg:'Ki_v2',
    kite:true, steps:{r0:13,r1:18}, msReqHdr:'Score Req',
    lb:{posCol:0, r0:26, r1:85, c0:2, c1:22, hdr:25}},
  'Target Day': {cat:'Target Day', family:'score', inst:'Target Day', cfg:'TaD_v2',
    multCell:[2,1],   // B3 'winStreakMultipliers'
    lb:{posCol:0, r0:35, r1:54, c0:2, c1:22, hdr:34}},
  "Red's Challenge":   {cat:'Red Challenge',   family:'lb', inst:'Red',        cfg:'Race_v2',
    lb:{posCol:0, r0:9,  r1:18, c0:1, c1:21, hdr:8}},
  "Chuck's Challenge": {cat:'Chuck Challenge', family:'lb', inst:'Chuck',      cfg:'Race_v2',
    lb:{posCol:0, r0:27, r1:36, c0:1, c1:21, hdr:26}},
  "Bomb's Challenge":  {cat:'Bomb Challenge',  family:'lb', inst:'Bomb',       cfg:'Race_v2',
    lb:{posCol:0, r0:45, r1:54, c0:1, c1:21, hdr:44}},
  'Level Race':        {cat:'Level Race',      family:'lb', inst:'Level Race', cfg:'Race_v2',
    lb:{posCol:0, r0:63, r1:72, c0:1, c1:21, hdr:62}},
  'Flash Race':        {cat:'Flash Race',      family:'lb', inst:'Flash Race', cfg:'Race_v2',
    lb:{posCol:0, r0:81, r1:90, c0:1, c1:21, hdr:80}},
  'Flock Flurry':      {cat:'Flock Flurry',    family:'lb', inst:'Flock Flurry', cfg:'F_v2',
    joinUL:true, lb:{posCol:0, r0:10, r1:14, c0:1, c1:21, hdr:9}},
  'Night Sky':         {cat:'Daily Night Sky Prize', family:'nightsky'}
};

// ============================== CUSTOM FUNCTIONS =============================================
/** @customfunction */
function ECOGAINS_PBP(calendar, day, segment, payer, mode, luck, seed, levels, startLevel){
  try { return pbpLedger_(pbpArgs_(calendar, day, segment, payer, mode, luck, seed, levels, startLevel)); }
  catch(e){ return [['ECOGAINS_PBP error: ' + e.message]]; }
}
/** @customfunction */
function ECOGAINS_PBP_EVENTS(calendar, day, segment, payer, luck){
  try { return pbpEventsTable_(pbpArgs_(calendar, day, segment, payer, 'Expected', luck, 0, 0)); }
  catch(e){ return [['ECOGAINS_PBP_EVENTS error: ' + e.message]]; }
}
/** @customfunction */
function ECOGAINS_PBP_PROFILE(segment, payer){
  try { return pbpProfile_(String(segment||'0-9').trim(), String(payer||'NONPAYER').trim()); }
  catch(e){ return [['ECOGAINS_PBP_PROFILE error: ' + e.message]]; }
}

function pbpArgs_(calendar, day, segment, payer, mode, luck, seed, levels, startLevel){
  var cal = String(calendar||CAL_NEW).trim();
  if (cal !== CAL_CUR && cal !== CAL_NEW) throw new Error('calendar must be cal_curr / cal_new');
  var lk = String(luck||'p50').trim().toLowerCase();
  if (['p25','p50','p75'].indexOf(lk) < 0) throw new Error('luck must be p25 / p50 / p75');
  return { cal: cal, day: Math.max(1, Math.min(33, Math.round(num(day)||1))),
           seg: String(segment||'0-9').trim(), payer: String(payer||'NONPAYER').trim(),
           sampled: String(mode||'Expected').trim().toLowerCase() === 'sampled',
           luck: lk, seed: Math.round(num(seed)) || 42, levels: Math.round(num(levels)) || 0,
           startLevel: Math.round(num(startLevel)) || 0 };
}

// ============================== SIMULATION CORE ==============================================
function pbpSimulate_(a){
  var ctx = Context.get();
  var st = PBPData.streaks(a.seg, a.payer);
  if (!st) throw new Error('no data_streaks row for ' + a.seg + ' ' + a.payer);
  var beh = ctx.ds.beh(a.seg, a.payer);
  var N = a.levels > 0 ? a.levels : Math.max(1, Math.round(num(st.attempts_per_day_mean)));
  var p = Math.min(.99, Math.max(.01, num(st.win_rate_mean)));
  var q = Math.min(.99, Math.max(.01, num(st.p_continue_after_win)));
  var pWL = Math.min(.99, Math.max(0, p*(1-q)/(1-p)));   // stationary win rate = p
  var rng = mulberry32_(mixSeed_(a));

  // starting saga level: input, or seeded random 100-400. In Expected mode the draw must be
  // seed-independent (own PRNG keyed without the seed), so Expected output never varies by seed.
  var startLevel = a.startLevel > 0 ? a.startLevel
    : 100 + Math.floor(mulberry32_(mixSeed_({cal:a.cal, day:a.day, seg:a.seg, payer:a.payer,
        luck:a.luck, seed: a.sampled ? a.seed : 0}))() * 301);

  // --- win/streak trace (pass 1) ---
  // Sampled: 2-state Markov chain (P(W|W)=q, P(W|L)=pWL) with the seeded PRNG.
  // Expected: deterministic representative day - win quota = round(N x p) laid out as streak
  // runs of the measured mean streak length, single losses between runs, losses padded at end.
  var winPlan = null;
  if (!a.sampled){
    winPlan = [];
    var winsLeft = Math.round(N * p), runLen = Math.max(1, Math.round(num(st.mean_streak_len)) || 1);
    while (winPlan.length < N){
      var run = Math.min(runLen, winsLeft);
      for (var w = 0; w < run && winPlan.length < N; w++) winPlan.push(true);
      winsLeft -= run;
      if (winPlan.length < N) winPlan.push(winsLeft > 0 ? false : false);
      if (winsLeft <= 0) while (winPlan.length < N) winPlan.push(false);
    }
  }
  var plays = [], streak = 0, level = startLevel;
  for (var i = 1; i <= N; i++){
    var win = winPlan ? winPlan[i-1]
                      : rng() < ((i === 1) ? p : (streak > 0 ? q : pWL));
    streak = win ? streak + 1 : 0;
    plays.push({ n: i, level: level, win: win, streak: streak });
    if (win) level++;
  }
  var wins = plays.filter(function(x){ return x.win; }).length;

  // --- active events on this day ---
  var parsed = (a.cal === CAL_CUR) ? ctx.calCur : ctx.calNew;
  var active = [], grantsS = [], grantsE = [];
  Object.keys(PBP_EVENTS).forEach(function(label){
    var spec = PBP_EVENTS[label], insts = parsed[label] || [];
    for (var j = 0; j < insts.length; j++){
      var inst = insts[j];
      if (a.day < inst.start || a.day > inst.start + inst.dur - 1) continue;
      active.push(pbpEventState_(spec, label, inst, a, ctx, st, wins));
      break;                                              // one instance per event per day
    }
  });

  // --- session-start claims (Daily Gift is ALWAYS claimed: a login is a claim) ---
  grantsS.push(pbpDailyGift_(a, beh, rng));
  active.forEach(function(ev){
    if (ev.spec.joinUL) grantsS.push({ cat: ev.cat, rew: {'Unlimited Lives': PBP_FF_JOIN_UL},
                                       note: 'opt-in grant (1h UL, design-PDF constant)' });
  });

  // --- per-play increments (pass 2: scale calibrated events to their measured day target) ---
  // Saga node ladder ({levels, rew} per node, cycled every sum(levels) levels): a node pays its
  // FULL bundle on the win whose ABSOLUTE level lands on that node's cumulative boundary.
  var sagaNodes = pbpSagaNodes_(a.cal, a.seg);
  var sagaEnds = [], sagaCycle = 0;
  sagaNodes.forEach(function(n){ sagaCycle += Math.max(1, n.levels); sagaEnds.push(sagaCycle); });
  var progress = active.filter(function(ev){ return ev.family === 'token' || ev.family === 'rm' || ev.family === 'score'; });
  progress.forEach(function(ev){
    if (ev.family === 'score' || ev.earn === 'streakmult'){
      var raw = 0, fn = ev.family === 'score' ? ev.stepFn : ev.multFn;
      plays.forEach(function(pl){ if (pl.win) raw += fn(pl.streak); });
      ev.scale = raw > 0 ? ev.todayTarget / raw : 0;
    }
    if (ev.earn === 'tiers') ev.tierIdx = 0;   // session starts at Copper (flagged assumption)
  });
  plays.forEach(function(pl){
    pl.inc = {}; pl.grants = [];
    if (!pl.win){
      progress.forEach(function(ev){                       // a loss steps completion tiers down
        if (ev.earn === 'tiers') ev.tierIdx = Math.max(0, ev.tierIdx - 1);
      });
      return;
    }
    if (sagaNodes.length){
      var posInCycle = ((pl.level - 1) % sagaCycle) + 1;   // pl.level = level completed by this win
      var nodeIdx = sagaEnds.indexOf(posInCycle);
      if (nodeIdx >= 0 && hasKeys_(sagaNodes[nodeIdx].rew))
        pl.grants.push({ cat: 'Saga', rew: sagaNodes[nodeIdx].rew,
                         note: 'node ' + (nodeIdx + 1) + ' at level ' + pl.level });
    }
    var firstTry = pl.n === 1 || plays[pl.n - 2].win;      // no failed attempt at this level
    progress.forEach(function(ev){
      var inc;
      if (ev.family === 'score')          inc = ev.stepFn(pl.streak) * ev.scale;
      else if (ev.earn === 'streakmult')  inc = ev.multFn(pl.streak) * ev.scale;
      else if (ev.earn === 'tiers'){      inc = ev.tierPts[ev.tierIdx];
                                          ev.tierIdx = Math.min(ev.tierPts.length - 1, ev.tierIdx + 1); }
      else if (ev.earn === 'firstTry')    inc = firstTry ? ev.tokensPerLevel : 0;
      else if (ev.earn === 'flat')        inc = ev.flatPerWin;
      else                                inc = ev.perWin;
      var before = ev.cum; ev.cum += inc; pl.inc[ev.cat] = ev.cum;
      (ev.ladder || []).forEach(function(ms, mi){
        if (ms.req > before + 1e-9 && ms.req <= ev.cum + 1e-9){
          pl.grants.push({ cat: ev.cat, rew: ms.rew, note: 'm' + (mi+1) + ' @ ' + ms.req });
          if (ev.spec.completion && mi === ev.ladder.length - 1 && ev.completionRew)
            pl.grants.push({ cat: ev.cat, rew: ev.completionRew, note: 'completion bonus' });
        }
      });
    });
  });

  // --- day-end LB payouts ---
  active.forEach(function(ev){
    if (!ev.spec.lb || !ev.endsToday) return;
    var pos = pbpPlacement_(ev, a, rng);
    if (pos == null){ grantsE.push({ cat: ev.cat, rew: {}, note: 'rank n/a (no position data)' }); return; }
    var rew = ev.lbLadder[pos] || null;
    grantsE.push({ cat: ev.cat, rew: rew || {},
                   note: 'rank ' + pos + (rew ? '' : ' (below ladder / pays nothing)') });
  });

  // --- Night Sky nightly milestones (day end; NIGHT_SKY_REWIRE_PLAN Option A realization) ---
  // Effective streak budget = base streak x NS_STREAK_N (v4 constant, 1.25): Expected mode uses
  // the data_streaks max_streak_per_day p50; Sampled mode uses the longest win run the play
  // trace actually produced. Cumulative gate, honest: EVERY milestone whose Cum Streak Req is
  // cleared pays (each on its own ledger row); an unreached milestone never pays.
  // NS_SIMULATE (v4 master switch) off -> no NS claims here either: all three views stay
  // consistent (NS carried in the window/daily sims, silent in the ledger).
  if (NS_SIMULATE && active.some(function(ev){ return ev.family === 'nightsky'; })){
    var bestRun = 0;
    plays.forEach(function(pl){ if (pl.streak > bestRun) bestRun = pl.streak; });
    var baseStreak = a.sampled ? bestRun : num(st.max_streak_per_day_p50);
    var effStreak = baseStreak * NS_STREAK_N;
    readNSLadder_(a.seg).forEach(function(ms, mi){
      if (ms.req <= effStreak + 1e-9)
        grantsE.push({ cat: 'Daily Night Sky Prize', rew: ms.rew,
          note: 'm' + (mi + 1) + ' @ ' + ms.req + ' (eff streak ' + Math.round(effStreak*100)/100 +
                ' = ' + (a.sampled ? 'best run ' + bestRun : 'p50 ' + baseStreak) +
                ' x ' + NS_STREAK_N + ')' });
    });
  }

  return { N: N, p: p, q: q, startLevel: startLevel, plays: plays, active: active,
           progress: progress, grantsS: grantsS, grantsE: grantsE, beh: beh, st: st };
}

// one active-event state record
function pbpEventState_(spec, label, inst, a, ctx, st, expWins){
  var k = a.day - inst.start + 1;
  var ev = { spec: spec, cat: spec.cat, family: spec.family, earn: spec.earn || '', label: label,
             inst: inst, k: k, endsToday: (a.day === inst.start + inst.dur - 1),
             cum: 0, perWin: 0, todayTarget: 0 };
  if (spec.family === 'nightsky' || spec.family === 'lb'){
    if (spec.lb) ev.lbLadder = pbpLbLadder_(spec);
    if (spec.inst) ev.instRow = PBPData.inst(spec.inst, a.seg, a.payer);
    return ev;
  }
  if (spec.family === 'rm'){
    // split configs (2026-07-10, hardcoded in v4's RM_INSTANCE_SHEETS): find this instance's
    // ordinal among the calendar's start-sorted RM instances -> RM_1st / RM_2nd (fallback RM)
    var rmList = rmSortedInsts_((a.cal === CAL_CUR) ? ctx.calCur : ctx.calNew), ri = 0;
    for (var q = 0; q < rmList.length; q++){
      if (rmList[q].start === inst.start && rmList[q].dur === inst.dur){ ri = q; break; }
    }
    var rmCfg = rmConfigFor_(ri);
    var pct = ctx.ds.rmPct(a.seg, a.payer), cfgDur = rmCfg.cfgDur;
    var fb = (pct ? num(pct[a.luck]) : 0) * Math.min(1, inst.dur / cfgDur);
    ev.ladder = rmCfg.ladder;
    ev.rmSheet = rmCfg.sheet;                                  // shown nowhere yet; debug aid
    ev.start = fb * (k - 1) / inst.dur;
    ev.today = fb / inst.dur;
    ev.cum = ev.start;
    ev.perWin = Math.round(ev.today / Math.max(1, expWins));   // whole matchables per win
    return ev;
  }
  // token / score: session-start progress = measured final balance x accrual share
  ev.instRow = PBPData.inst(spec.inst, a.seg, a.payer);
  var fb = ev.instRow ? num(ev.instRow['final_balance_' + a.luck]) : 0;
  var share = PBPData.shareFn(spec.inst, a.seg, a.payer, !!spec.kite);
  ev.start = fb * share(k - 1);
  ev.today = Math.max(0, fb * (share(k) - share(k - 1)));
  ev.cum = ev.start;
  if (spec.family === 'token'){
    ev.ladder = pbpMsLadder_(spec);
    if (spec.completion) ev.completionRew = pbpRewRow_(spec, spec.rew.r1);
    if (spec.earn === 'flat')       ev.flatPerWin = PBP_HH_TOKENS_PER_WIN;
    else if (spec.earn === 'firstTry') ev.tokensPerLevel = pbpCfgNum_(spec.cfg, 'tokensPerLevel') || 5;
    else if (spec.earn === 'tiers') ev.tierPts = PBP_JIGSAW_TIERS.slice();
    else if (spec.earn === 'streakmult'){ ev.multFn = pbpPhMultFn_(spec.cfg); ev.todayTarget = ev.today; }
    else ev.perWin = ev.today / Math.max(1, expWins);
  } else {                                                  // score
    ev.todayTarget = ev.today;
    ev.stepFn = pbpStepFn_(spec);
    ev.ladder = spec.msReqHdr ? readLadder_(sheetVals_(spec.cfg), spec.msReqHdr) : [];
    if (spec.lb) ev.lbLadder = pbpLbLadder_(spec);
  }
  return ev;
}

// ============================== CLAIMS =======================================================
// Daily Gift: always claimed at S. ONE concrete config variant (never an average): Expected
// mode uses Variant 1, Sampled mode picks a variant with the seeded PRNG.
function pbpDailyGift_(a, beh, rng){
  var day = ((Math.max(1, Math.round(num(beh.login_streak_p50))) - 1) % 7) + 1;
  var blocks = pbpGiftVariants_(a.cal === CAL_NEW ? 'c_day_v2' : 'c_day');
  if (!blocks.length) return { cat: 'Daily Gift', rew: {}, note: 'no variant blocks found' };
  var vi = a.sampled ? Math.floor(rng() * blocks.length) : 0;
  var hdr = blocks[vi].hdr, row = blocks[vi].rows[day - 1] || [], rew = {};
  for (var c in hdr){ var amt = num(row[c]); if (amt) rew[hdr[c]] = amt; }
  return { cat: 'Daily Gift', rew: rew,
           note: 'cycle day ' + day + ' (login streak p50), variant ' + (vi + 1) };
}
// variant blocks in c_day / c_day_v2: each 'Day'|'Coin' header row + the 7 rows under it
function pbpGiftVariants_(sheet){
  var v = sheetVals_(sheet), blocks = [];
  for (var r = 0; r < v.length; r++){
    if (String(v[r][11]).trim() !== 'Day' || String(v[r][12]).trim() !== 'Coin') continue;
    var hdr = {};
    for (var c = 12; c < v[r].length; c++){
      var name = String(v[r][c] || '').trim();
      var res = (name === 'Coin') ? 'HC' : RES_MAP[name];
      if (res) hdr[c] = res;
    }
    blocks.push({ hdr: hdr, rows: v.slice(r + 1, r + 8) });
  }
  return blocks;
}

// ============================== LADDER / PLACEMENT HELPERS ===================================
// Saga node ladder with FULL bundles. c_saga (cal_curr): header row has 'Node', HC at
// 'HC Reward', resource columns matched by RES_MAP names on the same header row.
// c_saga_v2 (cal_new): per-segment 'Levels Req'/'HC Reward' pairs under the segment label row,
// shared resource columns matched by RES_MAP names on the header row.
function pbpSagaNodes_(cal, seg){
  var name = (cal === CAL_NEW) ? 'c_saga_v2' : 'c_saga';
  var v = sheetVals_(name), hdrRow = -1;
  for (var r = 0; r < v.length; r++)
    if (String(v[r][0]).trim() === 'Node'){ hdrRow = r; break; }
  if (hdrRow < 0) return [];
  var lvCol = 1, hcCol = 2;
  if (cal === CAL_NEW){
    var segRow = v[hdrRow - 1] || [];
    for (var c = 0; c < segRow.length; c++)
      if (String(segRow[c]).trim() === seg){ lvCol = c; hcCol = c + 1; break; }
  }
  var resCols = {};
  for (var c2 = 0; c2 < v[hdrRow].length; c2++){
    var res = RES_MAP[String(v[hdrRow][c2] || '').trim()];
    if (res && res !== 'HC') resCols[c2] = res;            // HC comes from the per-seg column
  }
  var out = [];
  for (var r2 = hdrRow + 1; r2 < v.length; r2++){
    var node = num(v[r2][0]);
    if (!(node > 0)) break;
    var rew = {}, hc = num(v[r2][hcCol]);
    if (hc) rew['HC'] = hc;
    for (var c3 in resCols){ var amt = num(v[r2][c3]); if (amt) rew[resCols[c3]] = amt; }
    out.push({ levels: Math.max(1, num(v[r2][lvCol])), rew: rew });
  }
  return out;
}
// milestone ladder: req column rows map 1:1 (in order) onto the reward block rows - the req
// column may live at a different row offset (the EventReach helper columns on HH_v2 / Ph_v2).
function pbpMsLadder_(spec){
  var v = sheetVals_(spec.cfg), out = [];
  for (var r = spec.req.r0; r <= spec.req.r1; r++){
    var req = num(v[r] && v[r][spec.req.c]);
    if (!(req > 0)) continue;
    out.push({ req: req, rew: pbpRewRow_(spec, spec.rew.r0 + out.length) });
  }
  return out;
}
function pbpRewRow_(spec, r){
  var v = sheetVals_(spec.cfg), rew = {};
  for (var c = spec.hdr.c0; c <= spec.hdr.c1; c++){
    var res = RES_MAP[String(v[spec.hdr.r][c] || '').trim()];
    var amt = num(v[r] && v[r][c]);
    if (res && amt) rew[res] = amt;
  }
  return rew;
}
function pbpLbLadder_(spec){
  var v = sheetVals_(spec.cfg), out = {};
  for (var r = spec.lb.r0; r <= spec.lb.r1; r++){
    var pos = Math.round(num(v[r] && v[r][spec.lb.posCol]));
    if (!(pos > 0)) pos = r - spec.lb.r0 + 1;              // formula-numbered rows (Ki_v2)
    var rew = {};
    for (var c = spec.lb.c0; c <= spec.lb.c1; c++){
      var res = RES_MAP[String(v[spec.lb.hdr][c] || '').trim()];
      var amt = num(v[r] && v[r][c]);
      if (res && amt) rew[res] = amt;
    }
    if (hasKeys_(rew)) out[pos] = rew;
  }
  return out;
}
function pbpStepFn_(spec){
  var v = sheetVals_(spec.cfg);
  if (spec.steps){                                          // Kite: streak-step score ladder
    var steps = [];
    for (var r = spec.steps.r0; r <= spec.steps.r1; r++)
      steps.push(num(v[r] && v[r][1]));
    return function(streak){ return steps[Math.min(Math.max(streak,1), steps.length) - 1] || 0; };
  }
  var raw = String((v[spec.multCell[0]] || [])[spec.multCell[1]] || '');
  var mult = raw.split(/[,;]/).map(function(x){ return num(x); }).filter(function(x){ return x > 0; });
  if (!mult.length) mult = [1];
  return function(streak){ return mult[Math.min(Math.max(streak,1), mult.length) - 1]; };
}
// Photoshoot first-try streak multiplier ladder: 'Tier'|'Token Multiplier' table ('1x'..'10x')
function pbpPhMultFn_(cfg){
  var v = sheetVals_(cfg), mult = [];
  for (var r = 0; r < v.length; r++){
    if (String(v[r][0]).trim() !== 'Tier') continue;
    for (var r2 = r + 1; r2 < v.length; r2++){
      var m = parseFloat(String(v[r2][1] || ''));
      if (!(m > 0)) break;
      mult.push(m);
    }
    break;
  }
  if (!mult.length) mult = [1];
  return function(streak){ return mult[Math.min(Math.max(streak,1), mult.length) - 1]; };
}
// numeric config-panel value by row label (col 0 label, col 1 value)
function pbpCfgNum_(cfg, label){
  var v = sheetVals_(cfg);
  for (var r = 0; r < v.length; r++)
    if (String(v[r][0]).trim() === label) return num(v[r][1]);
  return 0;
}
// placement: Luck quantile of position_p25/50/75 (+ seeded +/-0.25-quantile jitter when Sampled)
function pbpPlacement_(ev, a, rng){
  var row = ev.instRow;
  if (!row) return null;
  var pts = [[.25, num(row.position_p25)], [.5, num(row.position_p50)], [.75, num(row.position_p75)]]
            .filter(function(x){ return x[1] > 0; });
  if (!pts.length) return null;
  var uq = {p25:.25, p50:.5, p75:.75}[a.luck];
  if (a.sampled) uq = Math.min(.75, Math.max(.25, uq + (rng() - .5) * .5));
  var pos = pts[0][1];
  if (uq <= pts[0][0]) pos = pts[0][1];
  else if (uq >= pts[pts.length-1][0]) pos = pts[pts.length-1][1];
  else for (var i = 1; i < pts.length; i++){
    if (uq <= pts[i][0]){
      var A = pts[i-1], B = pts[i];
      pos = A[1] + (B[1] - A[1]) * (uq - A[0]) / (B[0] - A[0]);
      break;
    }
  }
  return Math.max(1, Math.round(pos));
}

// ============================== OUTPUT BUILDERS ==============================================
var PBP_SLOT_SUFFIX = { token: ' tokens', score: ' score', rm: ' matchables' };
function pbpLedger_(a){
  var sim = pbpSimulate_(a);
  var slots = sim.progress.slice(0, PBP_PROGRESS_SLOTS);
  var header = ['Row','Play #','Level','Win?','Streak','Mult',
                'Claims (milestones & rewards landing on this play)'];
  for (var s = 0; s < PBP_PROGRESS_SLOTS; s++)
    header.push(slots[s] ? slots[s].cat + (PBP_SLOT_SUFFIX[slots[s].family] || '') : '');
  header = header.concat(RESOURCES);
  var W = header.length;
  var inv = zeroRow_();
  var rows = [header];
  // Emit ONE ROW PER CLAIM: the first claim rides on the play row, every further claim gets
  // its own continuation row (blank play cells) so each grant is readable on its own line.
  function emitRows_(tag, playCells, grants, cums){
    var slotCells = [];
    for (var s2 = 0; s2 < PBP_PROGRESS_SLOTS; s2++)
      slotCells.push(slots[s2] ? Math.round(num(cums && cums[slots[s2].cat] != null ? cums[slots[s2].cat] : slots[s2].cum) * 10) / 10 : '');
    var list = (grants || []).filter(function(g){ return g; });
    var count = Math.max(1, list.length);
    for (var gi = 0; gi < count; gi++){
      var g = list[gi];
      if (g) for (var r in g.rew) inv[r] = num(inv[r]) + num(g.rew[r]);
      var row = (gi === 0) ? [tag].concat(playCells)
                           : ['', '', '', '', '', ''];
      row.push(g ? (g.cat + (g.note ? ' ' + g.note : '') + ' -> ' + fmtBundle_(g.rew)) : '');
      for (var s3 = 0; s3 < PBP_PROGRESS_SLOTS; s3++) row.push(gi === 0 ? slotCells[s3] : '');
      RESOURCES.forEach(function(r2){ row.push(Math.round(num(inv[r2]) * 100) / 100); });
      rows.push(row);
    }
  }
  // S row (progress shows session-start states)
  var startCums = {};
  slots.forEach(function(ev){ if (ev) startCums[ev.cat] = ev.start || 0; });
  emitRows_('S', [0, sim.startLevel, 'session start', '', ''], sim.grantsS, startCums);
  // play rows
  var runCums = {};
  slots.forEach(function(ev){ if (ev) runCums[ev.cat] = ev.start || 0; });
  sim.plays.forEach(function(pl){
    slots.forEach(function(ev){ if (ev && pl.inc[ev.cat] != null) runCums[ev.cat] = pl.inc[ev.cat]; });
    var mult = '';
    if (pl.win) sim.progress.forEach(function(ev){
      if (ev.family === 'score') mult += (mult ? ' ' : '') + ev.cat.charAt(0) + 'x' + ev.stepFn(pl.streak);
      else if (ev.earn === 'streakmult') mult += (mult ? ' ' : '') + ev.cat.charAt(0) + 'x' + ev.multFn(pl.streak);
    });
    var snapshot = {};
    slots.forEach(function(ev){ if (ev) snapshot[ev.cat] = runCums[ev.cat]; });
    emitRows_(pl.n, [pl.n, pl.level, pl.win ? 'WIN' : 'LOSS', pl.streak, mult || '-'],
              pl.grants, snapshot);
  });
  // E row
  emitRows_('E', ['-', '-', 'day end', '', ''], sim.grantsE, runCums);
  // summary
  var totals = {}, order = [];
  function addTot(grants){ (grants || []).forEach(function(g){
    if (!totals[g.cat]){ totals[g.cat] = zeroRow_(); order.push(g.cat); }
    for (var r in g.rew) totals[g.cat][r] = num(totals[g.cat][r]) + num(g.rew[r]);
  }); }
  addTot(sim.grantsS); sim.plays.forEach(function(pl){ addTot(pl.grants); }); addTot(sim.grantsE);
  var pad = function(row){ while (row.length < W) row.push(''); return row; };
  rows.push(pad(['']));
  rows.push(pad(['Session Summary','Source'].concat(RESOURCES)));
  var grand = zeroRow_();
  order.forEach(function(cat){
    var line = ['', cat];
    RESOURCES.forEach(function(r){ var x = Math.round(num(totals[cat][r])*100)/100;
      grand[r] = num(grand[r]) + x; line.push(x); });
    rows.push(pad(line));
  });
  rows.push(pad(['', 'TOTAL'].concat(RESOURCES.map(function(r){ return Math.round(num(grand[r])*100)/100; }))));
  return rows;
}

function pbpEventsTable_(a){
  var sim = pbpSimulate_(a);
  var rows = [['Event','Ends today?','Progress @ start','Accrual today','Next milestone','End-of-day payout']];
  sim.active.forEach(function(ev){
    var nextMs = '-';
    (ev.ladder || []).some(function(ms, mi){
      if (ms.req > (ev.start || 0)){ nextMs = 'm' + (mi+1) + ' @ ' + ms.req + ' -> ' + fmtBundle_(ms.rew); return true; }
      return false;
    });
    var payout = '-';
    if ((ev.spec.lb && ev.endsToday) || ev.family === 'nightsky'){
      var gs = sim.grantsE.filter(function(x){ return x.cat === ev.cat; });
      if (gs.length) payout = gs.map(function(g){ return fmtBundle_(g.rew) + ' (' + g.note + ')'; }).join('; ');
    }
    var accr = '-';
    if (ev.family === 'score')            accr = 'target +' + Math.round(ev.todayTarget);
    else if (ev.earn === 'tiers')         accr = '+' + ev.tierPts.join('/') + ' per win (completion tier)';
    else if (ev.earn === 'flat')          accr = '+' + ev.flatPerWin + ' / win';
    else if (ev.earn === 'firstTry')      accr = '+' + ev.tokensPerLevel + ' / first-try win';
    else if (ev.earn === 'streakmult')    accr = 'streak x-mult, target +' + Math.round(ev.todayTarget);
    else if (ev.perWin)                   accr = '+' + Math.round(ev.perWin*100)/100 + ' / win';
    rows.push([ev.cat, ev.endsToday ? 'YES' : 'no',
               Math.round(num(ev.start)*10)/10, accr, nextMs, payout]);
  });
  sim.grantsS.forEach(function(g){
    rows.push([g.cat, 'claim @ S', '-', '-', '-', fmtBundle_(g.rew) + ' (' + g.note + ')']);
  });
  return rows;
}

// Player Profile: parameter, value, what it represents (source in the note).
function pbpProfile_(seg, payer){
  var st = PBPData.streaks(seg, payer);
  if (!st) return [['no data_streaks row for ' + seg + ' ' + payer]];
  var beh = Context.get().ds.beh(seg, payer);
  var rows = [
    ['Attempts / active day', Math.round(num(st.attempts_per_day_mean)*10)/10,
     'How many level attempts this player makes on a day they play (data_streaks) = N ledger rows'],
    ['Win rate', Math.round(num(st.win_rate_mean)*1000)/10 + '%',
     'Share of attempts that complete the level (data_streaks)'],
    ['P(win | prev win)', Math.round(num(st.p_continue_after_win)*1000)/10 + '%',
     'Chance to win again right after a win: streak persistence incl. OOM saves (data_streaks)'],
    ['Max win streak / day (p50)', num(st.max_streak_per_day_p50),
     'Median best win streak within a day (data_streaks)'],
    ['Mean streak length', Math.round(num(st.mean_streak_len)*10)/10,
     'Average length of a win run; shapes the Expected-mode win layout (data_streaks)'],
    ['Login streak (p50)', num(beh.login_streak_p50),
     'Median consecutive-day login run; sets the Daily Gift cycle day (data_seg_beh)'],
    ['NS effective streak (p50 x ' + NS_STREAK_N + ')',
     Math.round(num(st.max_streak_per_day_p50) * NS_STREAK_N * 100) / 100,
     'Night Sky streak budget: max win streak p50 x ' + NS_STREAK_N +
     ' (second-streak allowance); gates which NS milestones pay (data_streaks)']
  ];
  if (PBP_SHOW_ACTIVITY_RATES)
    rows.push(['P(active weekday / weekend)', Math.round(num(beh.weekday_active_rate)*1000)/10 + '% / ' +
       Math.round(num(beh.weekend_active_rate)*1000)/10 + '%',
       'Chance this cohort plays at all on a given day; the sim already conditions on playing (data_seg_beh)']);
  return rows;
}

// ============================== PBP DATA LAYER ===============================================
var PBPData = (function(){
  var _c = null;
  function get(){
    if (_c) return _c;
    var sv = sheetVals_('data_streaks'), sh = headerIndex_(sv[0] || []), sMap = {};
    for (var i = 1; i < sv.length; i++){ var r = sv[i];
      if (!r[sh['segment']]) continue;
      var o = {}; for (var nm in sh) o[nm] = r[sh[nm]];
      sMap[[r[sh['segment']], r[sh['payer_flag']]].join('|')] = o; }
    var iv = sheetVals_('data_event_inst'), ih = headerIndex_(iv[0] || []), iMap = {};
    for (var j = 1; j < iv.length; j++){ var w = iv[j];
      if (!w[ih['event_name']]) continue;
      var o2 = {}; for (var nm2 in ih) o2[nm2] = w[ih[nm2]];
      iMap[[w[ih['event_name']], w[ih['segment']], w[ih['payer_flag']]].join('|')] = o2; }
    function meanCurve(name){
      var v = sheetVals_(name);
      if (!v.length) return {};
      var h = headerIndex_(v[0]), m = {};
      for (var k = 1; k < v.length; k++){ var row = v[k], ev = row[h['event_name']];
        if (!ev) continue;
        var key = [ev, row[h['segment']], row[h['payer_flag']]].join('|');
        (m[key] = m[key] || []).push({ day: num(row[h['event_day']]), share: num(row[h['cum_token_share_mean']]) }); }
      for (var kk in m) m[kk].sort(function(x,y){ return x.day - y.day; });
      return m;
    }
    _c = { s: sMap, i: iMap, a: meanCurve('data_event_accrual'), k: meanCurve('data_event_kite_accrual') };
    return _c;
  }
  return {
    streaks: function(seg, payer){ return get().s[[seg, payer].join('|')] || null; },
    inst: function(ev, seg, payer){ return get().i[[ev, seg, payer].join('|')] || null; },
    // absolute cumulative-share interpolator raw(d): 0 at 0, curve through measured days,
    // capped at the curve max (shortened instances scale down; we never extrapolate up).
    shareFn: function(ev, seg, payer, kite){
      var m = kite ? get().k : get().a;
      var curve = m[[ev, seg, payer].join('|')] || [];
      if (!curve.length) return function(d){ return d > 0 ? 1 : 0; };
      var maxShare = curve[curve.length-1].share || 1;
      return function(d){
        if (d <= 0) return 0;
        var prev = { day: 0, share: 0 };
        for (var i = 0; i < curve.length; i++){
          if (d <= curve[i].day){
            var A = prev, B = curve[i];
            return (A.share + (B.share - A.share) * (d - A.day) / Math.max(1e-9, B.day - A.day)) / maxShare;
          }
          prev = curve[i];
        }
        return 1;
      };
    }
  };
})();

// ============================== RNG / FORMATTING =============================================
function mulberry32_(seed){
  var t = seed >>> 0;
  return function(){
    t = (t + 0x6D2B79F5) >>> 0;
    var x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function mixSeed_(a){
  var s = [a.cal, a.day, a.seg, a.payer, a.luck, a.seed].join('|');
  var h = 2166136261;
  for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function fmtBundle_(rew){
  var parts = [];
  for (var r in rew){
    if (!num(rew[r])) continue;
    parts.push((PBP_RES_DISPLAY[r] || r) + ': ' + Math.round(num(rew[r])*100)/100);
  }
  return '{' + parts.join(', ') + '}';
}

// ============================== v4 INTEGRATION ================================================
// Register the PBP sheet + its data sheets with v4's AUTO_REFRESH plumbing (guarded: the arrays
// exist only when EcoGainsSim_v4.gs is present, which is a hard requirement anyway).
try {
  if (typeof REFRESH_SHEETS !== 'undefined' && REFRESH_SHEETS.indexOf(PBP_SHEET) === -1)
    REFRESH_SHEETS.push(PBP_SHEET);
  if (typeof REFRESH_WATCH !== 'undefined'){
    ['data_streaks','data_event_inst'].forEach(function(n){
      if (REFRESH_WATCH.indexOf(n) === -1) REFRESH_WATCH.push(n);
    });
  }
} catch(e){}
