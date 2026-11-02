// D86 / D87 / D91 gates (2026-11-02) on the A/B lineage (LIVE_OPS_V3 (15) by default):
//   D86  Chuck's Challenge stands in for two of Red's (user rule): CURRENT 0, NEW = Red's NEW per
//        instance x Chuck's instances, reach-weighted - priced off Red's own row, so it moves WITH it
//   D87  the export is scaled to the window per event (f x W / S', checked against the by-source feed),
//        falling back to the activity scale where cal_curr's payout days disagree with the feed
//   D91  Flock Flurry is a simulated leaderboard (F / F_v2): every resource follows the calendar, not only
//        its envelope
// Every gate snapshots what it mutates and restores it; none asserts a workbook number.
//
//   node harness/_mock_d86.js [--data v3k|v3i|<path>]
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3k');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));

function GATES(){
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-9 : tol) * Math.max(1, Math.abs(a), Math.abs(b));
  const fresh = () => { resetSheetCache_mock(); return Context.get(); };
  const withSheets = (names, fn) => {
    const snap = {}; names.forEach(n => { snap[n] = data[n] ? clone(data[n]) : undefined; });
    try { return fn(); } finally { names.forEach(n => { if (snap[n] === undefined) delete data[n]; else data[n] = snap[n]; }); fresh(); }
  };
  const CELLS = [];
  ['0-9', '10-19', '20-39', '40-99', '100+'].forEach(s => ['NONPAYER', 'PAYER'].forEach(p => CELLS.push([s, p])));
  const reachOf = (ctx, lane, s, p, cal) => { const b = ctx.ds.beh(s, p); return reachSum_((cal || ctx.calNew)[lane] || [], num(b.weekday_active_rate), num(b.weekend_active_rate)); };
  let ctx = fresh();

  console.log('\n================ D86: Chuck\'s Challenge stands in for Red\'s ================');
  check('the rule is wired: LANE_STANDIN maps Chuck Challenge to Red Challenge', LANE_STANDIN['Chuck Challenge'] && LANE_STANDIN['Chuck Challenge'].like === 'Red Challenge');
  check('the fixture runs no Chuck\'s on cal_curr and two on cal_new',
        !(ctx.calCur["Chuck's Challenge"] || []).length && (ctx.calNew["Chuck's Challenge"] || []).length >= 1,
        (ctx.calCur["Chuck's Challenge"] || []).length + ' vs ' + (ctx.calNew["Chuck's Challenge"] || []).length);
  check('the export carries Chuck Challenge rows (the case the rule overrides)', anyAmount_(ctx.ds.dataRow('Chuck Challenge', '20-39', 'PAYER')));
  {
    let zero = 0, prop = 0, n = 0;
    CELLS.forEach(([s, p]) => {
      n++;
      if (!anyAmount_(measuredRow_('Chuck Challenge', s, p, ctx.ds))) zero++;
      const red = resultRow_('Red Challenge', s, p, ctx), ch = resultRow_('Chuck Challenge', s, p, ctx);
      const f = reachOf(ctx, "Chuck's Challenge", s, p) / reachOf(ctx, "Red's Challenge", s, p);
      if (RESOURCES.every(r => near(num(ch[r]), num(red[r]) * f))) prop++;
    });
    check('CURRENT Chuck\'s is 0 in every cell', zero === n, zero + ' of ' + n);
    check('NEW Chuck\'s = Red\'s NEW x reach(Chuck, cal_new) / reach(Red, cal_new), every cell and resource', prop === n, prop + ' of ' + n);
  }
  {
    // on these calendars both lanes run the same weekdays: the user's literal "what Red's loses"
    const s = '20-39', p = 'PAYER', mr = measuredRow_('Red Challenge', s, p, ctx.ds), nr = resultRow_('Red Challenge', s, p, ctx);
    const ch = resultRow_('Chuck Challenge', s, p, ctx);
    const same = near(reachOf(ctx, "Chuck's Challenge", s, p), reachOf(ctx, "Red's Challenge", s, p) * (ctx.calNew["Chuck's Challenge"].length / ctx.calNew["Red's Challenge"].length), 1e-9);
    console.log('  20-39 PAYER coins: Red ' + num(mr.HC).toFixed(2) + ' -> ' + num(nr.HC).toFixed(2) + ', Chuck 0 -> ' + num(ch.HC).toFixed(2) +
                (same ? '  (equal-reach calendars: Chuck = what Red loses when Red runs half as often)' : ''));
  }
  withSheets(['Race_v2'], () => {
    // RULE: doubling Red's v2 rewards moves Chuck's the SAME way (a literal "Red's loss" would invert it)
    const spec = LB_R_SPECS['Red Challenge'], v = data['Race_v2'].values;
    const s = '20-39', p = 'PAYER';
    const before = resultRow_('Chuck Challenge', s, p, fresh());
    for (let r = spec.r0; r <= spec.r1; r++) for (let c = spec.c0; c <= spec.c1; c++) if (num(v[r][c]) > 0) v[r][c] = num(v[r][c]) * 2;
    const after = resultRow_('Chuck Challenge', s, p, fresh());
    check('RULE: doubling Red\'s Race_v2 ladder raises NEW Chuck\'s coins (it follows Red\'s rewards, not their loss)',
          num(after.HC) > num(before.HC) * 1.5, num(before.HC).toFixed(2) + ' -> ' + num(after.HC).toFixed(2));
  });
  withSheets(['cal_new', 'cal_parsed'], () => {
    // RULE: a redesign that drops Red's entirely prices Chuck's per instance off Red's CURRENT payout
    const v = data['cal_new'].values;
    for (let r = 4; r < 26; r++) for (let c = 1; c < (v[r] || []).length; c++) if (String(v[r][c]).trim() === "Red's Challenge") v[r][c] = '';
    delete data['cal_parsed'];
    const c2 = fresh(), s = '20-39', p = 'PAYER';
    const got = resultRow_('Chuck Challenge', s, p, c2), mr = measuredRow_('Red Challenge', s, p, c2.ds);
    const f = reachOf(c2, "Chuck's Challenge", s, p) / reachOf(c2, "Red's Challenge", s, p, c2.calCur);
    check('RULE: with no Red\'s on cal_new, NEW Chuck\'s = Red\'s CURRENT x reach(Chuck new) / reach(Red cur)',
          !(c2.calNew["Red's Challenge"] || []).length && num(got.HC) > 0 && near(num(got.HC), num(mr.HC) * f),
          num(got.HC).toFixed(2) + ' vs ' + (num(mr.HC) * f).toFixed(2));
  });
  {
    // the anchor side runs cal_curr on both slots: no Chuck's there
    const bctx = baseCtx_(ctx); _baseSide = true;
    let row; try { row = laneStandIn_('Chuck Challenge', '20-39', 'PAYER', bctx); } finally { _baseSide = false; }
    check('the anchor side (cal_curr) prices Chuck\'s at 0', row && !anyAmount_(row));
  }
  {
    const keep = LANE_STANDIN;
    try {
      LANE_STANDIN = {}; const c3 = fresh();
      const m = measuredRow_('Chuck Challenge', '20-39', 'PAYER', c3.ds), n = resultRow_('Chuck Challenge', '20-39', 'PAYER', c3);
      check('RULE: LANE_STANDIN = {} restores the plain pricing (Chuck carried at its export: cal_curr runs none)',
            anyAmount_(m) && RESOURCES.every(r => near(num(n[r]), num(m[r]))));
    } finally { LANE_STANDIN = keep; fresh(); }
  }
  withSheets(['cal_curr', 'cal_parsed'], () => {
    // RULE: a cal_curr that schedules the lane itself keeps the anchored pricing (older workbooks untouched)
    const v = data['cal_curr'].values;
    let moved = 0;
    for (let r = 4; r < 26 && !moved; r++) for (let c = 1; c < (v[r] || []).length; c++)
      if (String(v[r][c]).trim() === "Bomb's Challenge"){ v[r][c] = "Chuck's Challenge"; moved++; break; }
    delete data['cal_parsed'];
    const c4 = fresh(), s = '20-39', p = 'PAYER';
    const m = measuredRow_('Chuck Challenge', s, p, c4.ds);
    check('RULE: with a Chuck\'s on cal_curr the stand-in is off: CURRENT = the export, NEW priced the anchored way',
          moved === 1 && (c4.calCur["Chuck's Challenge"] || []).length === 1 && !laneStandInActive_('Chuck Challenge', c4) &&
          anyAmount_(m) && laneStandIn_('Chuck Challenge', s, p, c4) === null);
  });

  console.log('\n================ D87: the export scaled per event ================');
  ctx = fresh();
  check('the fixture has a dated export (the span D87 needs)', !!ctx.dataSpan, ctx.dataSpan ? JSON.stringify(ctx.dataSpan) : 'none');
  const rawGain = (c, cat, s, p, res) => { const keep = c.ds.scaleFn; c.ds.scaleFn = null; try { return c.ds.gains(s, p, cat, res); } finally { c.ds.scaleFn = keep; } };
  {
    // no table -> every export amount on the activity scale (pre-D87 bit for bit)
    delete data['export_scale']; const c0 = fresh();
    let ok = 0, n = 0;
    ['Red Challenge', 'Target Day', 'Rainbow Maker', 'Core', "Bomb's Ballet"].forEach(cat => CELLS.forEach(([s, p]) => {
      const raw = rawGain(c0, cat, s, p, 'HC');
      if (!(raw > 0)) return;
      n++; if (near(c0.ds.gains(s, p, cat, 'HC'), raw * spanScale_(s, p, c0))) ok++;
    }));
    check('no export_scale table: every export amount x the activity scale (D79, bit for bit)', n > 0 && ok === n, ok + ' of ' + n);
  }
  const grid = exportScaleGrid_(fresh());
  check('the pooled feed table builds from data_econ_daily_by_source', !!grid && grid.length > 4, grid ? grid.length + ' rows' : 'none');
  data['export_scale'] = { values: grid, merges: [] };
  ctx = fresh();
  const tab = exportScaleTab_();
  check('the table reads back over the export\'s own days', !!tab && tab.first === ctx.dataSpan.first && tab.last === ctx.dataSpan.last,
        tab ? tab.first + '..' + tab.last : 'none');
  {
    // per event where checked: the amount = export x f x W / S'
    let ok = 0, n = 0, perEvent = 0;
    Object.keys(EXPORT_SCALE_FAMILY).forEach(cat => CELLS.forEach(([s, p]) => {
      const raw = rawGain(ctx, cat, s, p, 'HC');
      if (!(raw > 0)) return;
      n++;
      const e = spanScaleEvent_(cat, s, p, 'HC', ctx), want = raw * ((e != null) ? e : spanScale_(s, p, ctx));
      if (e != null) perEvent++;
      if (near(ctx.ds.gains(s, p, cat, 'HC'), want)) ok++;
    }));
    check('every event amount = export x (its per-event scale, else the activity scale)', ok === n && perEvent > 0, ok + ' of ' + n + ', ' + perEvent + ' per event');
  }
  {
    // RULE: the ratio NEW / CURRENT of a timed lane is untouched - D87 moves levels, never the change
    const cat = 'Red Challenge', s = '20-39', p = 'PAYER';
    const withT = resultRow_(cat, s, p, ctx).HC / measuredRow_(cat, s, p, ctx.ds).HC;
    const snap = data['export_scale']; delete data['export_scale'];
    const c1 = fresh(); const without = resultRow_(cat, s, p, c1).HC / measuredRow_(cat, s, p, c1.ds).HC;
    data['export_scale'] = snap; ctx = fresh();
    check('RULE: per-event scaling leaves Red\'s NEW / CURRENT ratio unchanged (levels move, the change does not)',
          near(withT, without, 1e-9) && spanScaleEvent_(cat, s, p, 'HC', ctx) != null, withT.toFixed(4) + ' vs ' + without.toFixed(4));
  }
  {
    // RULE: scale invariance - a uniform rescale of the feed changes nothing
    const keep = clone(data['export_scale']);
    const s0 = spanScaleEvent_('Target Day', '20-39', 'PAYER', 'HC', ctx);
    data['export_scale'].values.forEach((r, i) => { if (i > 3) for (let c = 3; c < r.length; c++) r[c] = num(r[c]) * 3; });
    const c1 = fresh(); const s1 = spanScaleEvent_('Target Day', '20-39', 'PAYER', 'HC', c1);
    check('RULE: tripling the whole feed leaves the scale unchanged', s0 != null && near(s0, s1), s0 + ' vs ' + s1);
    // RULE: mass granted BEFORE day 1 lowers f, and the scale with it, in proportion
    data['export_scale'] = clone(keep);
    const hdr = data['export_scale'].values[3], ci = hdr.indexOf('d' + ctx.dataSpan.first);
    const row = data['export_scale'].values.find(r => r[0] === 'Target Day' && r[1] === 'HC');
    const tabRow = (exportScaleTab_(), null);
    const tot0 = row.slice(3).reduce((a, x) => a + num(x), 0);
    row[ci] = num(row[ci]) + tot0;                     // as much again, all on the export's first day (lead-in)
    const c2 = fresh(); const s2 = spanScaleEvent_('Target Day', '20-39', 'PAYER', 'HC', c2);
    check('RULE: doubling the export with lead-in mass halves the per-event scale (f counts the window part only)',
          s0 != null && s2 != null && near(s2, s0 / 2, 1e-9), s0.toFixed(4) + ' -> ' + (s2 == null ? 'null' : s2.toFixed(4)));
    data['export_scale'] = keep; ctx = fresh();
  }
  {
    // RULE: a table over other days than the export's is ignored
    const keep = clone(data['export_scale']);
    data['export_scale'].values[3] = data['export_scale'].values[3].map(h => { const m = /^d(-?\d+)$/.exec(String(h)); return m ? 'd' + (+m[1] + 1) : h; });
    const c1 = fresh();
    check('RULE: a stale table (its days do not match data_gains\' span) falls back to the activity scale everywhere',
          Object.keys(EXPORT_SCALE_FAMILY).every(cat => spanScaleEvent_(cat, '20-39', 'PAYER', 'HC', c1) == null),
          exportScaleCheck_('Red Challenge', 'HC', c1).reason);
    data['export_scale'] = keep; ctx = fresh();
  }
  withSheets(['cal_curr', 'cal_parsed'], () => {
    // RULE: a cal_curr that disagrees with the feed falls back - drop Red's second instance inside the window part
    const c0 = fresh(), red = c0.calCurFull["Red's Challenge"].filter(x => x.days[0] >= 1 && x.days[0] <= 10).sort((a, b) => a.days[0] - b.days[0]);
    const col = red.length > 1 ? red[1].days[0] + c0.window.offset : null;   // grid day -> sheet column index (B = 1)
    const v = data['cal_curr'].values;
    let wiped = 0;
    if (col != null) for (let r = 4; r < 26; r++) for (let c = col; c < col + red[1].days.length; c++)
      if (String(v[r] && v[r][c]).trim() === "Red's Challenge") { v[r][c] = ''; wiped++; }
    (data['cal_curr'].merges || []).forEach(m => { if (m.c - 1 === col) m.nc = 1; });
    delete data['cal_parsed'];
    const c1 = fresh();
    const chk = exportScaleCheck_('Red Challenge', 'HC', c1);
    check('RULE: removing a Red\'s instance the feed shows paying -> the check fails and Red\'s keeps the activity scale',
          wiped > 0 && !chk.ok && spanScaleEvent_('Red Challenge', '20-39', 'PAYER', 'HC', c1) == null, chk.reason || ('match ' + chk.score));
  });
  {
    const keep = SPAN_PER_EVENT;
    try { SPAN_PER_EVENT = false; const c1 = fresh();
      check('RULE: SPAN_PER_EVENT = false -> the activity scale everywhere',
            near(c1.ds.gains('20-39', 'PAYER', 'Red Challenge', 'HC'), rawGain(c1, 'Red Challenge', '20-39', 'PAYER', 'HC') * spanScale_('20-39', 'PAYER', c1)));
    } finally { SPAN_PER_EVENT = keep; ctx = fresh(); }
  }
  {
    const rep = exportScaleReport_(ctx);
    const per = rep.filter(r => r[2] === 'per event'), act = rep.filter((r, i) => i > 0 && r[2] !== 'per event');
    check('the report lists every (source, resource) the feed carries, each with a scale or a reason',
          rep.length > 10 && act.every(r => String(r[9]).length > 0), per.length + ' per event, ' + act.length + ' on activity');
    const show = {};
    rep.slice(1).forEach(r => { if (r[1] === 'HC') show[r[0]] = r[2] === 'per event' ? 'x' + Number(r[6]).toFixed(2) : 'activity'; });
    console.log('  HC scale at ' + EXPORT_SCALE_REF.join(' ') + ': ' + Object.keys(show).map(k => k + ' ' + show[k]).join(' | '));
  }

  console.log('\n================ D91: Flock Flurry is a simulated leaderboard ================');
  ctx = fresh();
  check('the route: Flock Flurry in SOURCES and LB_R_SPECS (F / F_v2), not in PACK_ONLY_SPECS',
        SOURCES['Flock Flurry'] === simFlockFlurry && LB_R_SPECS['Flock Flurry'] && LB_R_SPECS['Flock Flurry'].base === 'F' &&
        LB_R_SPECS['Flock Flurry'].v2 === 'F_v2' && !PACK_ONLY_SPECS['Flock Flurry']);
  check('the export carries Flock Flurry beyond its envelope (the resources D19 left carried)',
        ['SPT', 'Red', 'Unlimited Lives'].every(r => num(ctx.ds.dataRow('Flock Flurry', '20-39', 'PAYER')[r]) > 0));
  const flockT = (c, s, p) => timingRatio_(c.calCur['Flock Flurry'] || [], c.calNew['Flock Flurry'] || [], s, p, c.ds);
  withSheets(['F_v2'], () => {
    // RULE: with F_v2 = F every resource Flock pays - envelope included - moves by the calendar factor T
    data['F_v2'] = clone(data['F']);
    const c1 = fresh();
    let n = 0, ok = 0, packs = 0, bad = '';
    CELLS.forEach(([s, p]) => {
      const T = flockT(c1, s, p), m = measuredRow_('Flock Flurry', s, p, c1.ds), x = resultRow_('Flock Flurry', s, p, c1);
      RESOURCES.forEach(r => {
        if (!(num(m[r]) > 0)) return;
        n++; if (BOTTOMUP_RES.indexOf(r) >= 0) packs++;
        if (near(num(x[r]), num(m[r]) * T, 1e-9)) ok++; else if (!bad) bad = s + ' ' + p + ' ' + r + ' ' + num(x[r]) + ' vs ' + num(m[r]) * T;
      });
    });
    check('RULE: F_v2 = F -> NEW = CURRENT x T on every resource the export carries, every cell (envelope included)',
          n > 0 && packs > 0 && ok === n, ok + ' of ' + n + (bad ? '; first miss ' + bad : ''));
    check('the fixture changes Flock\'s calendar (T != 1 at 20-39 PAYER)', Math.abs(flockT(c1, '20-39', 'PAYER') - 1) > 0.01, flockT(c1, '20-39', 'PAYER').toFixed(4));
  });
  withSheets(['F_v2'], () => {
    // RULE: an F_v2 edit moves exactly what it edits: rank 1's SPT x2 -> NEW SPT x2, every other resource unchanged
    data['F_v2'] = clone(data['F']);
    const spec = LB_R_SPECS['Flock Flurry'], v = data['F_v2'].values, c0 = fresh(), s = '20-39', p = 'PAYER';
    const before = resultRow_('Flock Flurry', s, p, c0);
    const sc = v[spec.hdr].findIndex(h => String(h).trim() === 'SPT');
    v[spec.r0][sc] = num(v[spec.r0][sc]) * 2;
    const after = resultRow_('Flock Flurry', s, p, fresh());
    check('RULE: doubling rank 1\'s SPT on F_v2 doubles NEW SPT and leaves every other resource as it was',
          sc > 0 && near(num(after.SPT), 2 * num(before.SPT)) && RESOURCES.every(r => r === 'SPT' || near(num(after[r]), num(before[r]))),
          num(before.SPT).toFixed(3) + ' -> ' + num(after.SPT).toFixed(3));
  });
  withSheets(['cal_new', 'cal_parsed'], () => {
    // RULE: identical calendars + identical ladders -> DIFF 0 on every Flock resource
    data['cal_new'] = clone(data['cal_curr']); delete data['cal_parsed'];
    const keepV2 = data['F_v2']; data['F_v2'] = clone(data['F']);
    try {
      const c1 = fresh();
      let ok = 0;
      CELLS.forEach(([s, p]) => {
        const m = measuredRow_('Flock Flurry', s, p, c1.ds), x = resultRow_('Flock Flurry', s, p, c1);
        if (RESOURCES.every(r => near(num(x[r]), num(m[r]), 1e-9))) ok++;
      });
      check('RULE: cal_new = cal_curr and F_v2 = F -> Flock\'s DIFF is 0 on every resource, every cell', ok === CELLS.length, ok + ' of ' + CELLS.length);
    } finally { data['F_v2'] = keepV2; }
  });
  withSheets(['F_v2'], () => {
    // RULE: the card sim reads F_v2 on the redesign side and F on the anchor side (D90 for this lane too)
    data['F_v2'] = clone(data['F']);
    const spec = LB_R_SPECS['Flock Flurry'], v = data['F_v2'].values, hdr = v[spec.hdr];
    const c2 = hdr.findIndex(h => String(h).trim() === '2-star Dly'), c3 = hdr.findIndex(h => String(h).trim() === '3-star Dly');
    v[spec.r0][c3] = num(v[spec.r0][c2]) || 1; v[spec.r0][c2] = 0;
    const c1 = fresh(), s = '100+', p = 'PAYER';
    const tiers = (rr) => { const o = {}; ((rr && rr.groups) || []).forEach(g => g.rungs.forEach(x => Object.keys(x.packs || {}).forEach(k => { o[k] = 1; }))); return Object.keys(o).sort().join(','); };
    const nw = packRungs_('Flock Flurry', s, p, c1, 0, null);
    let base; _baseSide = true; try { base = packRungs_('Flock Flurry', s, p, baseCtx_(c1), 0, null); } finally { _baseSide = false; }
    check('RULE: a 2-star -> 3-star swap on F_v2 reaches the card sim\'s redesign rungs; the anchor side keeps F\'s 2-star',
          tiers(nw) === '3-star Pack' && tiers(base) === '2-star Pack', 'new ' + tiers(nw) + ' / anchor ' + tiers(base));
  });
  {
    // RULE: FLOCK_SIMULATED = false (flockRoute_(false)) restores D19: every non-envelope resource carried at the export
    try {
      flockRoute_(false); const c1 = fresh();
      let ok = 0;
      CELLS.forEach(([s, p]) => {
        const m = measuredRow_('Flock Flurry', s, p, c1.ds), x = resultRow_('Flock Flurry', s, p, c1);
        if (RESOURCES.every(r => BOTTOMUP_RES.indexOf(r) >= 0 || near(num(x[r]), num(m[r]), 1e-12))) ok++;
      });
      check('RULE: flockRoute_(false) puts Flock back on the D19 route (carried + the F pack overlay)',
            !SOURCES['Flock Flurry'] && !LB_R_SPECS['Flock Flurry'] && PACK_ONLY_SPECS['Flock Flurry'] === FLOCK_PACK_ONLY_SPEC && ok === CELLS.length,
            ok + ' of ' + CELLS.length + ' cells carried');
      check('the change summary names the D19 route \'carried + envelopes\' and the D91 one otherwise',
            typeof csModelOf_ !== 'function' || csModelOf_('Flock Flurry', 0, null) === 'carried + envelopes');
    } finally { flockRoute_(true); ctx = fresh(); }
    check('the change summary no longer calls Flock Flurry carried',
          typeof csModelOf_ !== 'function' || ['anchored', 'anchored + bottom-up', 'bottom-up'].indexOf(csModelOf_('Flock Flurry', 0.01, null)) >= 0);
  }

  console.log('\n' + (failures ? failures + ' FAILED' : 'ALL D86/D87/D91 GATES PASS'));
  process.exitCode = failures ? 1 : 0;
}
eval(PRELUDE + '\n(' + GATES.toString() + ')();\n');
