// How CURRENT is extrapolated from the export's own days to the counted window, step by step, with the
// workbook's numbers (2026-11-03, for the user's explainer).
//
//   node harness/_probe_export_scale.js [--data v3o] [--seg 20-39] [--payer PAYER]
//
// Prints: the export span and the window in window days; the activity scale (sum of p_day over the window /
// over the span) with its pieces; then per event source the per-event scale f x W / S' with every piece
// (feed mass in / out of the window part, cal_curr's predicted payout days vs the feed's, W, S'), or the
// reason it fell back to activity; and one worked amount per source (export -> CURRENT).
const fs = require('fs'), path = require('path');
if (process.argv.indexOf('--data') < 0) process.argv.push('--data', 'v3o');
const arg = (k, d) => { const i = process.argv.indexOf(k); return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : d; };
const SEG = arg('--seg', '20-39'), PAY = arg('--payer', 'PAYER');
const CARDS = fs.readFileSync(path.join(__dirname, '_mock_cards.js'), 'utf8');
const PRELUDE = CARDS.slice(0, CARDS.indexOf('// ---------------------------------------------------------------- 1. PackConfig reader'));

function PROBE(){
  _sheetValsCache = {}; Context.reset();
  const ctx = Context.get(), sp = ctx.dataSpan, w = ctx.window;
  const iso = (d) => new Date(d * 86400000).toISOString().slice(0, 10);
  const d1 = calDay1Date_();
  const dateOf = (wd) => iso(d1 + wd - 1);
  console.log('\n=== 1. the two time frames');
  console.log('window: days 1..' + w.days + ' = ' + dateOf(1) + ' .. ' + dateOf(w.days));
  console.log('export span: window days ' + sp.first + '..' + sp.last + ' = ' + dateOf(sp.first) + ' .. ' + dateOf(sp.last) + ' (' + sp.days + ' days)');
  const ov = exportScaleOverlap_(ctx);
  console.log('overlap (export days inside the window): ' + (ov ? ov.o1 + '..' + ov.o2 + ' (' + (ov.o2 - ov.o1 + 1) + ' days)' : 'none'));

  const b = ctx.ds.beh(SEG, PAY), pWd = num(b.weekday_active_rate), pWe = num(b.weekend_active_rate);
  const num_ = pDaySum_(1, w.days, pWd, pWe), den = pDaySum_(sp.first, sp.last, pWd, pWe);
  let nWe = 0; for (let d = sp.first; d <= sp.last; d++) if (isWeekend_(d)) nWe++;
  let wWe = 0; for (let d = 1; d <= w.days; d++) if (isWeekend_(d)) wWe++;
  console.log('\n=== 2. the activity scale (' + SEG + ' ' + PAY + ')');
  console.log('weekday active rate ' + pWd.toFixed(4) + ', weekend ' + pWe.toFixed(4) + ' (Fri/Sat/Sun are weekend)');
  console.log('window: ' + (w.days - wWe) + ' weekdays + ' + wWe + ' weekend days -> sum p_day = ' + num_.toFixed(3));
  console.log('span:   ' + (sp.days - nWe) + ' weekdays + ' + nWe + ' weekend days -> sum p_day = ' + den.toFixed(3));
  console.log('activity scale = ' + num_.toFixed(3) + ' / ' + den.toFixed(3) + ' = ' + (num_ / den).toFixed(4) + '   (plain day ratio ' + w.days + '/' + sp.days + ' = ' + (w.days / sp.days).toFixed(4) + ')');

  console.log('\n=== 3. per event (EXPORT_SCALE_FAMILY), resource HC unless the source pays none');
  const cats = Object.keys(EXPORT_SCALE_FAMILY);
  cats.forEach(cat => {
    const row = ctx.ds.dataRow(cat, SEG, PAY);
    let res = 'HC';
    if (!num(row.HC)) {
      const best = RESOURCES.filter(r => num(row[r]) > 0).sort((a, c) => num(row[c]) - num(row[a]))[0];
      if (best) res = best;
    }
    const chk = exportScaleCheck_(cat, res, ctx);
    const ev = spanScaleEvent_(cat, SEG, PAY, res, ctx);
    const used = (ev != null) ? ev : num_ / den;
    console.log('\n' + cat + '  [' + EXPORT_SCALE_FAMILY[cat] + ', ' + res + ']');
    const lane = exportScaleLane_(cat);
    const inst = l => (l || []).map(i => i.start + (i.dur > 1 ? '..' + (i.start + i.dur - 1) : '')).join(', ') || 'none';
    console.log('   cal_curr instances (window days, lead-in <= 0): ' + inst(ctx.calCurFull[lane]));
    if (chk.f != null) console.log('   f = share of the span\'s granted ' + chk.use + ' that falls inside days ' + (ov ? ov.o1 + '..' + ov.o2 : '-') + ' (explained by cal_curr) = ' + chk.f.toFixed(3));
    if (chk.predDays.length || chk.feedDays.length) console.log('   payout days: cal_curr predicts ' + chk.predDays.join(',') + ' | the feed shows ' + chk.feedDays.join(',') + '  (match ' + (100 * chk.score).toFixed(0) + '%)');
    if (ev != null) {
      const ws = (cat === 'Rainbow Maker') ? rmExportWS_(SEG, PAY, ctx, res, ov.o1, ov.o2, chk.off) : exportScaleProfile_(cat, SEG, PAY, ctx, ov.o1, ov.o2, chk.off);
      console.log('   W  = cal_curr\'s window instances (reach-weighted) = ' + ws.W.toFixed(3));
      console.log('   S\' = cal_curr\'s payouts inside the overlap (reach-weighted) = ' + ws.S.toFixed(3));
      console.log('   scale = f x W / S\' = ' + chk.f.toFixed(3) + ' x ' + ws.W.toFixed(3) + ' / ' + ws.S.toFixed(3) + ' = ' + ev.toFixed(4) + '   (activity would be ' + (num_ / den).toFixed(4) + ')');
    } else {
      console.log('   -> activity scale ' + (num_ / den).toFixed(4) + ' because: ' + (chk.reason || 'per-event check did not pass'));
    }
    const raw = num(ctx.ds.gains ? (function(){ const keep = ctx.ds.scaleFn; ctx.ds.scaleFn = null; const v = ctx.ds.gains(SEG, PAY, cat, res); ctx.ds.scaleFn = keep; return v; })() : 0);
    if (raw) console.log('   example: export ' + res + ' per earner over the span ' + raw.toFixed(2) + ' x ' + used.toFixed(4) + ' = CURRENT ' + (raw * used).toFixed(2) + ' over the window');
  });

  console.log('\n=== 4. always-on sources use the activity scale');
  ['Core', 'Saga', 'Daily Gift', 'Daily Night Sky Prize', 'Season Pass (Free)'].forEach(cat => {
    const keep = ctx.ds.scaleFn; ctx.ds.scaleFn = null; const raw = num(ctx.ds.gains(SEG, PAY, cat, 'HC')); ctx.ds.scaleFn = keep;
    const sc = num(ctx.ds.gains(SEG, PAY, cat, 'HC')) / (raw || 1);
    if (raw) console.log('   ' + cat.padEnd(24) + ' HC export ' + raw.toFixed(2) + ' x ' + sc.toFixed(4) + ' = ' + (raw * sc).toFixed(2));
  });
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
