// Col - Sets / Col - Albums, current vs redesign, for one cell: where each side's number comes from (album_gains or the
// 50-season batch), the album inputs fingerprint, whether the two calendars differ lane by lane, and the envelopes the
// card sim's season core grants per side and source.
//   node harness/_probe_col_sides.js [--data v3z2] [--seg 0-9] [--payer NONPAYER] [--samecal]
// --samecal: cal_new := cal_curr before the run (a redesign that changes nothing - the two sides must agree)
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3z2');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const CUT = '// ---------------------------------------------------------------- 1. PackConfig reader';
let PRELUDE = CARDS.slice(0, CARDS.indexOf(CUT));
const di = process.argv.indexOf('--engine-dir');
if (di >= 0){
  const ed = path.resolve(process.argv[di + 1]);
  PRELUDE = PRELUDE.replace("const ENGINE = (f) => path.join(__dirname, '..', 'engine', f);", 'const ENGINE = (f) => path.join(' + JSON.stringify(ed) + ', f);');
}
const _log = console.log; console.log = () => {}; global.__say = _log;

function PROBE(){
  const say = global.__say;
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
  const SEG = arg('--seg', '0-9'), PAY = arg('--payer', 'NONPAYER');
  if (process.argv.indexOf('--samecal') >= 0){
    data['cal_new'] = JSON.parse(JSON.stringify(data['cal_curr']));
    if (data['cal_parsed']) delete data['cal_parsed'];
  }
  resetSheetCache_mock(); _sheetValsCache = {}; Context.reset();
  const ctx = Context.get();
  say('engine ' + ENGINE_BUILD + '   data: ' + (data._meta ? data._meta.source : '?') + '   cell ' + SEG + ' ' + PAY);
  // the album inputs fingerprint
  let saved = null; try { saved = (sheetVals_('album_gains')[1] || [])[1]; } catch (e) {}
  say('album_gains inputs ' + saved + '   now ' + albumFingerprint_() + '   -> ' + (String(saved) === albumFingerprint_() ? 'album_gains READ' : 'album_gains ignored, 50-season batch'));
  // the calendars, lane by lane
  const lanes = {};
  [['cur', ctx.calCur], ['new', ctx.calNew]].forEach(([k, cal]) => Object.keys(cal || {}).forEach(l => {
    lanes[l] = lanes[l] || {}; lanes[l][k] = (cal[l] || []).map(x => x.start + '+' + x.dur).join(',');
  }));
  const diffL = Object.keys(lanes).filter(l => lanes[l].cur !== lanes[l].new);
  say('calendar lanes that differ: ' + (diffL.length ? diffL.join(', ') : 'none'));
  // envelopes per side and source as the card sim's season core grants them (dailyPacksFor_, both sides)
  const env = (side) => {
    const was = _baseSide; let c = ctx;
    if (side === 'cur'){ c = baseCtx_(ctx); _baseSide = true; }
    let out = null; try { out = dailyPacksFor_(SEG, PAY, c); } catch (e) { out = { err: e.message }; }
    _baseSide = was; return out;
  };
  const sum = (g) => { const t = {}; if (!g || !g.bySource) return t;
    g.bySource.forEach(e => { t[e.cat] = 0; (e.days || []).forEach(d => (d || []).forEach(x => { t[e.cat] += num(x); })); }); return t; };
  // the discrete plan the card sim draws from: expected envelopes = participation x reach x SUM rung p x packs
  const plan = (side) => {
    const was = _baseSide; let c = ctx;
    if (side === 'cur'){ c = baseCtx_(ctx); _baseSide = true; }
    const t = {};
    try {
      packGrantPlan_(SEG, PAY, c).forEach(e => {
        let x = 0;
        (e.groups || []).forEach(g => (g.rungs || []).forEach(r => { let pk = 0; for (const k in (r.packs || {})) pk += num(r.packs[k]); x += num(r.p) * pk; }));
        t[e.cat] = num(t[e.cat]) + num(e.participation) * num(e.reach) * x;
      });
    } catch (err) { t.err = err.message; }
    _baseSide = was; return t;
  };
  const pc = plan('cur'), pn = plan('new');
  say('the card sim grant plan (expected envelopes per season, participation x reach x rungs), by source:');
  Array.from(new Set(Object.keys(pc).concat(Object.keys(pn)))).sort().forEach(s => {
    const a = num(pc[s]), b = num(pn[s]);
    if (a > 1e-6 || b > 1e-6 || s === 'err') say('  ' + s.padEnd(26) + a.toFixed(3).padStart(9) + ' -> ' + b.toFixed(3).padStart(9) + (Math.abs(a - b) > 1e-9 ? '   <-- differs' : '') + (s === 'err' ? ' ' + pc.err + ' / ' + pn.err : ''));
  });
  const ec = env('cur'), en = (_cardModelLevel = true, env('new')); _cardModelLevel = false;
  if (ec && ec.err) say('dailyPacksFor_ threw: ' + ec.err);
  const sc = sum(ec), sn = sum(en);
  say('envelopes per player-season the card sim grants (all tiers), by source:');
  Array.from(new Set(Object.keys(sc).concat(Object.keys(sn)))).sort().forEach(s => {
    const a = num(sc[s]), b = num(sn[s]);
    if (a > 1e-6 || b > 1e-6) say('  ' + s.padEnd(26) + a.toFixed(3).padStart(9) + ' -> ' + b.toFixed(3).padStart(9) + (Math.abs(a - b) > 1e-9 ? '   <-- differs' : ''));
  });
  const cur = colSimSeasons_(SEG, PAY, ctx, 'cur'), nw = colSimSeasons_(SEG, PAY, ctx, 'new');
  ['sets', 'albums'].forEach(w => say('Col - ' + w + ' HC per season: ' + num(cur && cur[w].HC).toFixed(3) + ' -> ' + num(nw && nw[w].HC).toFixed(3) +
    '   (albums per season ' + num(cur && cur.albumsPerSeason).toFixed(4) + ' -> ' + num(nw && nw.albumsPerSeason).toFixed(4) + ')'));
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
