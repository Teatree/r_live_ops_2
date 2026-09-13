// How many MORE payers finish album 1 because of the 11-row ToF block?
// Three conditions, PAIRED (same seeds), so the difference is not swamped by noise.
//   A  pre-D53          every cell runs on its segment's NONPAYER take-up   (the old 6-row sheet)
//   B  today's engine   every cell runs on its segment's PAYER take-up      (payer row wins)
//   C  correct keying   each cell runs on its OWN row                       (after the reader lands)
const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const N=200, SEED=20260914;
  const cfg=loadPackConfig_();
  const cat=loadCardCatalog_(cfg,SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AlbumConfig'));
  const ctx=Context.get();
  // the sheet's own two rows per segment (wb9, hand-built)
  const NP={'0-9':0.05,'10-19':0.10,'20-39':0.20,'40-99':0.35,'100+':0.55};
  const PA={'0-9':0.08,'10-19':0.15,'20-39':0.30,'40-99':0.53,'100+':0.83};
  const tof=tofConfig_();
  const pop={};
  cloudPermutations_().forEach(p=>{pop[p.label]=num(ctx.ds.beh(p.seg,p.payer).unique_players);});
  function sweep(pick){
    const out={};
    cloudPermutations_().forEach((p,pi)=>{
      tof.beh[p.seg].continueP = pick(p);
      _tofBalCache={};
      const pre=cardSeasonPre_(p.seg,p.payer,ctx);
      let fin=0;
      for(let k=0;k<N;k++){
        const r=runOneCardSeason_(p.seg,p.payer,playerSeed_(SEED,pi,k),cfg,cat,pre);
        if(num(r.albumIdx)>=1) fin++;
      }
      out[p.label]=fin/N;
    });
    return out;
  }
  const A=sweep(p=>NP[p.seg]);
  const B=sweep(p=>PA[p.seg]);
  const C=sweep(p=>p.payer==='PAYER'?PA[p.seg]:NP[p.seg]);
  console.log('\nALBUM 1 COMPLETION RATE, '+N+' players/cell, paired seeds\n');
  console.log('cell                players    A pre-D53   B today    C correct   C-A');
  let tA=0,tB=0,tC=0,payA=0,payC=0,payN=0;
  cloudPermutations_().forEach(p=>{
    const w=pop[p.label];
    tA+=w*A[p.label]; tB+=w*B[p.label]; tC+=w*C[p.label];
    if(p.payer==='PAYER'){ payA+=w*A[p.label]; payC+=w*C[p.label]; payN+=w; }
    console.log(p.label.padEnd(20)+Math.round(w).toLocaleString().padStart(8)+
      (100*A[p.label]).toFixed(1).padStart(11)+'%'+(100*B[p.label]).toFixed(1).padStart(9)+'%'+
      (100*C[p.label]).toFixed(1).padStart(11)+'%'+
      ((C[p.label]-A[p.label])*100).toFixed(1).padStart(7)+'pp');
  });
  const W=Object.values(pop).reduce((a,b)=>a+b,0);
  console.log('-'.repeat(72));
  console.log('POPULATION'.padEnd(20)+Math.round(W).toLocaleString().padStart(8)+
    (100*tA/W).toFixed(2).padStart(11)+'%'+(100*tB/W).toFixed(2).padStart(9)+'%'+
    (100*tC/W).toFixed(2).padStart(11)+'%');
  console.log('\nFINISHERS (real players):');
  console.log('  A pre-D53   '+Math.round(tA).toLocaleString());
  console.log('  B today     '+Math.round(tB).toLocaleString()+'   <- what the sheet produces RIGHT NOW');
  console.log('  C correct   '+Math.round(tC).toLocaleString());
  console.log('\nPAYERS ONLY ('+Math.round(payN).toLocaleString()+' players):');
  console.log('  pre-D53     '+Math.round(payA).toLocaleString()+'  ('+(100*payA/payN).toFixed(1)+'%)');
  console.log('  correct     '+Math.round(payC).toLocaleString()+'  ('+(100*payC/payN).toFixed(1)+'%)');
  console.log('  DELTA       '+(payC>=payA?'+':'')+Math.round(payC-payA).toLocaleString()+' more paying finishers');
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
