// How deep does a ToF run go as a function of COINS AVAILABLE? The continue ladder is
// 75/150/300/600/1200/2400/4800..., so this is the curve a coin bag has to climb.
const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const ctx=Context.get();
  const pre=cardSeasonPre_('40-99','PAYER',ctx);
  const W=pre.tof&&pre.tof.walk;
  if(!W){console.log('no ToF walk config');return;}
  console.log('\n40-99 PAYER, cash-out stage '+pre.tof.cashOut+
              ', continue take-up '+W.continueP+', ladder '+W.costs.slice(0,6).join('/'));
  console.log('\n  coins available     banked     mean stage   continues   coins spent');
  [0,75,225,500,1000,1125,2000,2325,5000,10000,24000].forEach(bal=>{
    const rnd=mulberry32(99);
    let bank=0,stage=0,cont=0,spent=0;const N=20000;
    for(let i=0;i<N;i++){
      const wallet={coins:bal};
      const r=walkTofRun_(W,rnd,wallet);
      if(r.banked)bank++; stage+=r.stage; cont+=r.continues; spent+=r.coinsSpent;
    }
    console.log('  '+String(bal).padStart(15)+(100*bank/N).toFixed(2).padStart(10)+'%'+
      (stage/N).toFixed(1).padStart(13)+(cont/N).toFixed(2).padStart(12)+
      (spent/N).toFixed(0).padStart(14));
  });
  console.log('\n  (take-up is the OTHER gate: at continueP='+W.continueP+
              ' a player declines ~'+((1-W.continueP)*100).toFixed(0)+'% of affordable continues)');
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
