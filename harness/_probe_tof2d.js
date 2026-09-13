const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const ctx=Context.get();
  const pre=cardSeasonPre_('40-99','PAYER',ctx);
  const W0=pre.tof.walk;
  const BAL=[87,500,2325,10000];      // p50 wallet, small bag, ladder-to-5, deep
  const TU=[0.25,0.4,0.6,0.8,1.0];
  console.log('\nP(run banks), 40-99 PAYER, cash-out 10.  rows = Continue Take-Up, cols = coins available\n');
  console.log('  take-up |'+BAL.map(b=>String(b).padStart(9)).join('')+'    <- coins');
  console.log('  --------+'+'-'.repeat(9*BAL.length));
  TU.forEach(tu=>{
    const row=BAL.map(bal=>{
      const W=Object.assign({},W0,{continueP:tu});
      const rnd=mulberry32(99); let bank=0; const N=20000;
      for(let i=0;i<N;i++){ if(walkTofRun_(W,rnd,{coins:bal}).banked) bank++; }
      return (100*bank/N).toFixed(2).padStart(8)+'%';
    });
    console.log('  '+tu.toFixed(2).padStart(7)+' |'+row.join(''));
  });
  console.log('\n  baseline today: take-up 0.25, wallet p50 = 87 coins');
  console.log('  cash-out stage is 10; the ladder only has 10 rungs, so continues cap there too');
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
