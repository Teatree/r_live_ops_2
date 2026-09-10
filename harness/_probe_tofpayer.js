// Current payer vs nonpayer difference in ToF, before any model change. Baseline for D53.
const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const ctx=Context.get();
  console.log('');
  console.log('ToF TODAY: the only payer/nonpayer channels are the measured coin balance and');
  console.log('TOF_PAYER_TOPUPS = '+TOF_PAYER_TOPUPS+' (one free purchased continue per run).');
  console.log('');
  console.log('segment    payer      pBank   spend   wallet p25..p90');
  ['0-9','10-19','20-39','40-99','100+'].forEach(s=>{
    const out={};
    ['NONPAYER','PAYER'].forEach(p=>{
      const r=tofRun_(s,p,ctx.ds);
      const b=tofBalances_(s,p);
      out[p]=r;
      console.log(s.padEnd(11)+p.padEnd(11)+
        (r?(100*r.pBank).toFixed(2)+'%':'  -').padStart(7)+
        (r?r.spend.toFixed(1):'-').padStart(8)+'   '+
        (b.length?b.map(x=>Math.round(x)).join(' / '):'(none)'));
    });
    if(out.NONPAYER&&out.PAYER)
      console.log('           PAYER/NONPAYER'.padEnd(22)+
        (out.PAYER.pBank/out.NONPAYER.pBank).toFixed(2)+'x'.padStart(4)+
        (out.NONPAYER.spend>0?(out.PAYER.spend/out.NONPAYER.spend).toFixed(2)+'x':'  n/a').padStart(9));
  });
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
