// Three measurements for D53 Part B, on one dump:
//   1. the EcoGains-vs-Totals gap  (tofRunOnce_ pBank   vs   walkTofRun_ realised bank rate)
//   2. ToF envelopes and runs per player, by payer flag
//   3. how much of album completion rides on ToF, by payer flag
const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const N=80, SEED=20260913;
  const cfg=loadPackConfig_();
  const cat=loadCardCatalog_(cfg, SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AlbumConfig'));
  const ctx=Context.get();
  console.log('\n1. THE TWO MODELS ON THE SAME RUN  (this is the EcoGains vs Totals gap)\n');
  console.log('cell                model pBank   walk banked   gap    runs   ToF envelopes');
  const perms=cloudPermutations_();
  const res={};
  perms.forEach((p,pi)=>{
    const pre=cardSeasonPre_(p.seg,p.payer,ctx);
    let runs=0,bank=0,env=0,packs=0;
    for(let k=0;k<N;k++){
      const r=runOneCardSeason_(p.seg,p.payer,playerSeed_(SEED,pi,k),cfg,cat,pre);
      runs+=r.tofRuns; bank+=r.tofBanked; packs+=r.packsOpenedTotal;
      const bs=r.bySource['ToF']; if(bs) env+=bs.packs;
    }
    const model=pre.tof?pre.tof.pBank:0;
    const walk=runs>0?bank/runs:0;
    res[p.label]={model,walk,runs:runs/N,env:env/N,packs:packs/N};
    console.log(p.label.padEnd(20)+(100*model).toFixed(2).padStart(8)+'%'+
      (100*walk).toFixed(2).padStart(13)+'%'+
      ((walk-model)*100).toFixed(2).padStart(8)+'pp'+
      (runs/N).toFixed(1).padStart(8)+(env/N).toFixed(2).padStart(16));
  });
  console.log('\n2. ALBUM COMPLETION - what ToF is carrying, by payer flag\n');
  console.log('cell                 with ToF   ToF off    ToF share of finishers');
  perms.forEach((p,pi)=>{
    const out=[];
    [false,true].forEach(off=>{
      const pre=cardSeasonPre_(p.seg,p.payer,ctx);
      if(off && pre.tof) pre.tof.runsPerDay=0;
      let fin=0;
      for(let k=0;k<N;k++){
        const r=runOneCardSeason_(p.seg,p.payer,playerSeed_(SEED,pi,k),cfg,cat,pre);
        if(num(r.albumIdx)>=1) fin++;
      }
      out.push(fin/N);
    });
    const share=out[0]>0?(out[0]-out[1])/out[0]:0;
    console.log(p.label.padEnd(20)+(100*out[0]).toFixed(1).padStart(8)+'%'+
      (100*out[1]).toFixed(1).padStart(10)+'%'+(100*share).toFixed(0).padStart(20)+'%');
  });
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
