// Config-proposal evaluation probe (2026-10-30, D79). Not a gate - the measurement tool behind
// builders/_build_cfgprop.py. Runs the engine over the eval fixture (cal_new := cal_curr: the
// proposals are judged as a config-only change on the A/B calendar), optionally with a patch set
// applied to the _v2 sheets, and reports what the user's targets are stated in:
//   * SPT: Core vs events, over the window and DAY BY DAY (the 50/50 target is a daily one)
//   * Season Pass: the tier each segment reaches, the day each tier is reached, and the tier at the
//     p25 / p50 / p75 / p90 of the segment's activity curve
//   * envelopes per player by tier and by source
//   * album completion from the card sim: album 1 among ACTIVE participants (opened >= 1 envelope
//     and active >= 14 of the 28 album days - user decision 2026-10-30), albums 2 and 3 among payers
//   * ToF: the row, the ToF_model "net cumulative EV" per floor (rewards at item_vals 'new' minus the
//     expected continue spend of a player who always continues), envelopes per banked run
//   * Saga: the value of one 100-level chapter cycle at item_vals 'new' (row 6) and the old row 3
//
//   node harness/_probe_cfgprop.js [--data eval] [--patches analysis/out/cfgprop_patches.json]
//                                  [--n 200] [--out analysis/out/cfgprop_eval.json] [--nocards]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'eval');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function PROBE(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const patchFile = arg('--patches', null), N = Number(arg('--n', 200)), outFile = arg('--out', null);
  const noCards = process.argv.indexOf('--nocards') >= 0;
  const SEED = 20261030;
  const colNum = (s) => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);

  // ---------------------------------------------------------------- patches
  let patchCount = 0;
  if (patchFile){
    const P = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
    Object.keys(P.patches || {}).forEach(sheet => {
      if (!data[sheet]) throw new Error('patch targets a sheet the dump does not have: ' + sheet);
      (P.patches[sheet] || []).forEach(e => {
        const m = /^([A-Z]+)(\d+)$/.exec(e.cell), c = colNum(m[1]), r = +m[2];
        const v = data[sheet].values;
        while (v.length < r) v.push([]);
        while (v[r - 1].length < c) v[r - 1].push('');
        v[r - 1][c - 1] = e.value;
        patchCount++;
      });
    });
  }
  resetSheetCache_mock();
  const ctx = Context.get(), W = windowDays_();
  const cells = cloudPermutations_();
  const iv = (function(){            // item_vals: row 6 ('new', the ToF sheet's own valuation) and row 3
    const v = data['item_vals'].values, out = { 'new': {}, old: {} };
    (v[1] || []).forEach((h, c) => { const name = String(h || '').trim(); if (!name) return;
      const res = RES_MAP[name] || name;
      out['new'][res] = Number((v[5] || [])[c]) || 0; out.old[res] = Number((v[2] || [])[c]) || 0; });
    return out;
  })();
  const value = (row, which) => RESOURCES.reduce((a, r) => a + (Number(row[r]) || 0) * (iv[which][r] || 0), 0);

  const res = { meta: { data: data._meta, patches: patchFile, patchCount, window: W, n: N }, cells: {} };
  const sp = spPaidTracks_();

  cells.forEach(cell => {
    const seg = cell.seg, payer = cell.payer, key = cell.label;
    const b = ctx.ds.beh(seg, payer), pWd = Number(b.weekday_active_rate), pWe = Number(b.weekend_active_rate);
    const out = { sim: {}, meas: {} };
    CATEGORY_ORDER.forEach(cat => {
      out.sim[cat] = resultRow_(cat, seg, payer, ctx);
      out.meas[cat] = measuredRow_(cat, seg, payer, ctx.ds);
    });
    // ---- SPT split, window and per day
    const sptOf = (rows) => { let core = 0, ev = 0;
      CATEGORY_ORDER.forEach(cat => { const v = Number(rows[cat]['SPT']) || 0; if (cat === 'Core') core += v; else ev += v; });
      return { core, event: ev, share: (core + ev) > 0 ? ev / (core + ev) : 0 }; };
    out.spt = { sim: sptOf(out.sim), meas: sptOf(out.meas) };
    const day = { simCore: [], simEvent: [], measCore: [], measEvent: [] };
    for (let d = 0; d < W; d++){ day.simCore.push(0); day.simEvent.push(0); day.measCore.push(0); day.measEvent.push(0); }
    const bySrcDay = {};
    CATEGORY_ORDER.forEach(cat => {
      const sN = dailySeries_(cat, seg, payer, ctx, true), sC = dailySeries_(cat, seg, payer, ctx, false);
      for (let d = 0; d < W; d++){
        const vn = Number(sN[d]['SPT']) || 0, vc = Number(sC[d]['SPT']) || 0;
        if (cat === 'Core'){ day.simCore[d] += vn; day.measCore[d] += vc; }
        else { day.simEvent[d] += vn; day.measEvent[d] += vc; if (vn) (bySrcDay[cat] = bySrcDay[cat] || Array(W).fill(0))[d] += vn; }
      }
    });
    const shares = (c, e) => c.map((x, i) => (x + e[i]) > 0 ? e[i] / (x + e[i]) : null).filter(x => x != null);
    out.daily = { simShare: shares(day.simCore, day.simEvent), measShare: shares(day.measCore, day.measEvent),
                  simCore: day.simCore, simEvent: day.simEvent, measCore: day.measCore, measEvent: day.measEvent,
                  bySrc: bySrcDay };
    // ---- Season Pass
    const t = sptTotals_(seg, payer, ctx);
    const totSim = t.sim * sp.daysV2 / W, totMeas = t.meas * sp.daysBase / W;
    const curve = attendanceCurve_(b, W);
    const expDays = pDaySum_(1, W, pWd, pWe);
    const tierAt = (tot, cum) => spTier_(tot, cum);
    out.sp = { simTotal: totSim, measTotal: totMeas,
               simTier: tierAt(totSim, sp.v2.cum), measTier: tierAt(totMeas, sp.base.cum),
               pct: {} };
    [0.25, 0.5, 0.75, 0.9].forEach(u => {
      const ad = curve ? curveAt_(curve, u) : expDays;
      out.sp.pct['p' + Math.round(u * 100)] = { activeDays: ad,
        simTier: tierAt(totSim * ad / expDays, sp.v2.cum), measTier: tierAt(totMeas * ad / expDays, sp.base.cum) };
    });
    // the day each tier is reached by the cohort's mean player (cumulative SPT by day)
    const reachDays = (core, ev, cum) => { const out2 = []; let acc = 0, k = 0;
      for (let d = 0; d < W; d++){ acc += core[d] + ev[d]; while (k < cum.length && cum[k] <= acc){ out2.push(d + 1); k++; } }
      return out2; };
    out.sp.simTierDay = reachDays(day.simCore, day.simEvent, sp.v2.cum);
    out.sp.measTierDay = reachDays(day.measCore, day.measEvent, sp.base.cum);
    // ---- envelopes
    const env = (rows) => { const tot = {}, bySrc = {};
      CATEGORY_ORDER.forEach(cat => PACK_RES.forEach(tr => { const v = Number(rows[cat][tr]) || 0; if (!v) return;
        tot[tr] = (tot[tr] || 0) + v; (bySrc[cat] = bySrc[cat] || {})[tr] = v; }));
      return { tot, bySrc }; };
    out.env = { sim: env(out.sim), meas: env(out.meas) };
    out.tickets = { sim: CATEGORY_ORDER.reduce((a, c) => a + (Number(out.sim[c]['ToF_Ticket']) || 0), 0),
                    meas: CATEGORY_ORDER.reduce((a, c) => a + (Number(out.meas[c]['ToF_Ticket']) || 0), 0) };
    out.value = { sim: {}, meas: {} };
    CATEGORY_ORDER.forEach(cat => { out.value.sim[cat] = value(out.sim[cat], 'new'); out.value.meas[cat] = value(out.meas[cat], 'new'); });
    out.beh = { pWd, pWe, expDays, levels: Number(b.levels_completed_per_active_day), saga: Number(b.saga_completes_per_active_day),
                pop: Number(b.unique_players) };
    res.cells[key] = out;
  });

  // ---------------------------------------------------------------- ToF_model net cumulative EV (ToF_v2 and ToF)
  function tofModel(sheet){
    const v = data[sheet].values, hdr = v.findIndex(r => r && String(r[0]).trim() === 'Stage' && String(r[1]).trim() === 'Type');
    const H = v[hdr].map(x => String(x || '').trim());
    const ci = (n) => H.indexOf(n);
    const costs = []; { const c0 = v.findIndex(r => r && String(r[0]).trim() === 'Continue # in this run');
      for (let r = c0 + 1; r < v.length && v[r] && v[r][0] !== '' && !isNaN(parseFloat(v[r][0])); r++) costs.push(Number(v[r][1]) || 0); }
    const stages = {};
    for (let r = hdr + 1; r < v.length && v[r] && v[r][0] !== '' && !isNaN(parseFloat(v[r][0])); r++){
      const n = Number(v[r][0]); const kind = String(v[r][ci('card type')] || '').trim().toLowerCase();
      const p = Number(v[r][ci('p')]) || 0, rew = {};
      Object.keys(RES_MAP).forEach(lab => { const c = ci(lab); if (c >= 0) rew[RES_MAP[lab]] = (rew[RES_MAP[lab]] || 0) + (Number(v[r][c]) || 0); });
      (stages[n] = stages[n] || { n, type: String(v[r][1]), doors: [] }).doors.push({ kind, p, rew });
    }
    const list = Object.keys(stages).map(Number).sort((a, b) => a - b).map(k => stages[k]);
    let pk = [1], cumI = 0, cumK = 0; const rows = [];
    list.forEach(st => {
      const pig = st.doors.filter(d => d.kind === 'pig').reduce((a, d) => a + d.p, 0);
      const rewDoors = st.doors.filter(d => d.kind !== 'pig');
      const C = rewDoors.length ? rewDoors.reduce((a, d) => a + value(d.rew, 'new'), 0) / rewDoors.length : 0;
      const envs = rewDoors.length ? rewDoors.reduce((a, d) => a + PACK_RES.reduce((x, t2) => x + (d.rew[t2] || 0), 0), 0) / rewDoors.length : 0;
      const spt = rewDoors.length ? rewDoors.reduce((a, d) => a + (d.rew['SPT'] || 0), 0) / rewDoors.length : 0;
      let G = 0; pk.forEach((q, k) => { G += q * (costs[Math.min(k, costs.length - 1)] || 0); });
      const Hs = pig * G; cumI += Hs; cumK += C;
      rows.push({ stage: st.n, type: st.type, pig, rewardCoin: C, envPerDoor: envs, sptPerDoor: spt, expContinueCost: G, spend: Hs, cumSpend: cumI, cumReward: cumK, net: cumK - cumI });
      const nx = Array(pk.length + 1).fill(0);           // prior-continue count distribution, Poisson-binomial
      pk.forEach((q, k) => { nx[k] += q * (1 - pig); nx[k + 1] += q * pig; });
      pk = nx;
    });
    return rows;
  }
  res.tofModel = { v2: tofModel('ToF_v2'), base: tofModel('ToF') };

  // ---------------------------------------------------------------- Saga cycle value
  function sagaCycle(sheet){
    const v = data[sheet].values, h = v.findIndex(r => r && r[0] === 'Node'), H = v[h];
    const tot = {}; let levels = 0, hc = 0;
    for (let r = h + 1; r < v.length && v[r] && v[r][0] !== '' && !isNaN(parseFloat(v[r][0])); r++){
      levels += Number(v[r][1]) || 0; hc += Number(v[r][3]) || 0;
      H.forEach((lab, c) => { const res2 = RES_MAP[String(lab || '').trim()]; if (!res2 || res2 === 'HC' || String(lab).trim() === 'HC Reward') return;
        tot[res2] = (tot[res2] || 0) + (Number(v[r][c]) || 0); });
    }
    tot['HC'] = hc;
    return { levels, items: tot, valueNew: value(tot, 'new'), valueOld: value(tot, 'old') };
  }
  res.saga = { v2: sagaCycle('c_saga_v2'), base: sagaCycle('c_saga') };

  // ---------------------------------------------------------------- card sim
  if (!noCards){
    const cfg = loadPackConfig_(), cat = loadCardCatalog_(cfg, SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cardSheet_('AlbumConfig')));
    const t0 = Date.now();
    res.cards = {};
    cells.forEach((cell, pi) => {
      const pre = cardSeasonPre_(cell.seg, cell.payer, ctx);
      const runs = [];
      for (let k = 0; k < N; k++) runs.push(runOneCardSeason_(cell.seg, cell.payer, playerSeed_(SEED, pi, k), cfg, cat, pre));
      const q = runs.filter(r => r.activeDays >= 14 && r.packsOpenedTotal >= 1);
      const m = (xs, f) => xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0;
      const tiers = {}; runs.forEach(r => { for (const t2 in r.packsOpenedByTier) tiers[t2] = (tiers[t2] || 0) + r.packsOpenedByTier[t2] / N; });
      const src = {}; runs.forEach(r => { for (const s in r.bySource) src[s] = (src[s] || 0) + r.bySource[s].packs / N; });
      res.cards[cell.label] = { n: N, qualifying: q.length / N,
        a1Q: m(q, r => r.albumIdx >= 1 ? 1 : 0), a2Q: m(q, r => r.albumIdx >= 2 ? 1 : 0), a3Q: m(q, r => r.albumIdx >= 3 ? 1 : 0),
        a1All: m(runs, r => r.albumIdx >= 1 ? 1 : 0), a2All: m(runs, r => r.albumIdx >= 2 ? 1 : 0), a3All: m(runs, r => r.albumIdx >= 3 ? 1 : 0),
        packs: m(runs, r => r.packsOpenedTotal), packsQ: m(q, r => r.packsOpenedTotal),
        unique: m(runs, r => r.albumIdx >= 1 ? cat.totalUnique : r.collectionSize), uniqueQ: m(q, r => r.albumIdx >= 1 ? cat.totalUnique : r.collectionSize),
        activeDays: m(runs, r => r.activeDays), spTier: m(runs, r => Number(r.spTier) || 0),
        tofRuns: m(runs, r => r.tofRuns), tofBanked: m(runs, r => r.tofBanked), chests: m(runs, r => r.chestsBought),
        byTier: tiers, bySource: src };
    });
    // population roll-up: weights = unique_players x the qualifying share the sim found in that cell
    const pop = cellPopulations_(ctx);
    const roll = (fld, filt, qual) => { let w = 0, s = 0;
      cells.forEach(c => { if (filt && !filt(c)) return; const x = res.cards[c.label]; const wt = (pop.pop[c.label] || 0) * (qual ? x.qualifying : 1);
        w += wt; s += wt * x[fld]; }); return w > 0 ? s / w : 0; };
    res.cardsPop = { album1_active: roll('a1Q', null, true), album1_all: roll('a1All', null, false),
                     album2_payers_active: roll('a2Q', c => c.payer === 'PAYER', true), album2_payers_all: roll('a2All', c => c.payer === 'PAYER', false),
                     album3_payers_active: roll('a3Q', c => c.payer === 'PAYER', true), album3_payers_all: roll('a3All', c => c.payer === 'PAYER', false),
                     secs: (Date.now() - t0) / 1000 };
  }

  // ---------------------------------------------------------------- console summary
  const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1), pc = (x) => (100 * x).toFixed(1) + '%';
  console.log('\n=== CONFIG PROPOSAL PROBE  ' + (patchFile ? path.basename(patchFile) + ' (' + patchCount + ' cells)' : 'BASELINE (no patches)') + '  window ' + W + ' days ===');
  console.log('\ncell             SPT core   event  share(win) | daily share min/med/max | SP tier meas->sim (p25/p50/p75/p90)   env/player meas->sim');
  cells.forEach(c => { const x = res.cells[c.label]; const ds = x.daily.simShare.slice().sort((a, b) => a - b);
    const envT = (o) => PACK_RES.reduce((a, t2) => a + (o.tot[t2] || 0), 0);
    console.log(c.label.padEnd(16) + f1(x.spt.sim.core).padStart(9) + f1(x.spt.sim.event).padStart(8) + pc(x.spt.sim.share).padStart(8) + ' (' + pc(x.spt.meas.share) + ')' +
      ' | ' + pc(ds[0]) + '/' + pc(ds[Math.floor(ds.length / 2)]) + '/' + pc(ds[ds.length - 1]) +
      ' | ' + x.sp.measTier + '->' + x.sp.simTier + ' (' + ['p25', 'p50', 'p75', 'p90'].map(k => x.sp.pct[k].simTier).join('/') + ')' +
      '   ' + f1(envT(x.env.meas)) + '->' + f1(envT(x.env.sim)));
  });
  if (res.cards){
    console.log('\ncell             qual%  album1(active)  album2  album3 | packs  unique  spTier  tofRuns banked');
    cells.forEach(c => { const x = res.cards[c.label];
      console.log(c.label.padEnd(16) + pc(x.qualifying).padStart(6) + pc(x.a1Q).padStart(14) + pc(x.a2Q).padStart(8) + pc(x.a3Q).padStart(8) +
        ' | ' + f1(x.packs).padStart(5) + f1(x.unique).padStart(8) + f1(x.spTier).padStart(8) + f1(x.tofRuns).padStart(8) + f1(x.tofBanked).padStart(7)); });
    const P = res.cardsPop;
    console.log('\nPOPULATION: album 1 among active participants ' + pc(P.album1_active) + ' (all players ' + pc(P.album1_all) + ')' +
      ' | album 2 payers ' + pc(P.album2_payers_active) + ' active / ' + pc(P.album2_payers_all) + ' all' +
      ' | album 3 payers ' + pc(P.album3_payers_active) + ' / ' + pc(P.album3_payers_all) + '   (' + P.secs.toFixed(0) + 's)');
  }
  console.log('\nToF_model net cumulative EV (ToF_v2), floors 1-10: ' + res.tofModel.v2.slice(0, 10).map(r => f1(r.net)).join(' '));
  console.log('Saga cycle value (item_vals new / old): base ' + f1(res.saga.base.valueNew) + ' / ' + f1(res.saga.base.valueOld) +
              '   v2 ' + f1(res.saga.v2.valueNew) + ' / ' + f1(res.saga.v2.valueOld));
  if (outFile){ fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(res)); console.log('written ' + outFile); }
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
