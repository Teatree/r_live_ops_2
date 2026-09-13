const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const ctx=Context.get(), cfg=tofConfig_();
  // what the sheet AUTHORS for the nonpayer row, vs what the engine actually uses
  const authored={'0-9':0.05,'10-19':0.1,'20-39':0.2,'40-99':0.35,'100+':0.55};
  console.log('\nP(run banks) - what the sheet MEANS for a nonpayer vs what the engine COMPUTES\n');
  console.log('segment      authored NP   engine uses   pBank(NP)   pBank(engine)   overstated by');
  ['0-9','10-19','20-39','40-99','100+'].forEach(s=>{
    const used=cfg.beh[s].continueP;
    const real=tofRun_(s,'NONPAYER',ctx.ds);
    cfg.beh[s].continueP=authored[s]; _tofBalCache={};
    const want=tofRun_(s,'NONPAYER',ctx.ds);
    cfg.beh[s].continueP=used;
    console.log(s.padEnd(13)+String(authored[s]).padStart(11)+String(used).padStart(14)+
      (100*want.pBank).toFixed(2).padStart(11)+'%'+(100*real.pBank).toFixed(2).padStart(14)+'%'+
      ((real.pBank/want.pBank-1)*100).toFixed(1).padStart(14)+'%');
  });
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
