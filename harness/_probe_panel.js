// Renders the album panel's composition table as text, to eyeball what the dialog will show.
const fs=require('fs'),path=require('path');
const CARDS=fs.readFileSync(path.join(__dirname,'_mock_cards.js'),'utf8');
const CUT='// ---------------------------------------------------------------- 1. PackConfig reader';
const PRELUDE=CARDS.slice(0,CARDS.indexOf(CUT));
function PROBE(){
  const N=120,SEED=20260910;
  const cfg=loadPackConfig_();
  const cat=loadCardCatalog_(cfg, SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AlbumConfig'));
  const ctx=Context.get(), byCell={};
  cloudPermutations_().forEach((p,pi)=>{
    const pre=cardSeasonPre_(p.seg,p.payer,ctx), runs=[];
    for(let k=0;k<N;k++) runs.push(runOneCardSeason_(p.seg,p.payer,playerSeed_(SEED,pi,k),cfg,cat,pre));
    byCell[p.label]=albumCellStats_(runs);
  });
  const popInfo=cellPopulations_(ctx);
  const pop=albumPopulationStats_(byCell,popInfo);
  const html=albumCompositionHtml_(pop);
  const txt=html.replace(/<\/tr>/g,'\n').replace(/<t[hd][^>]*>/g,'| ').replace(/<[^>]+>/g,'')
                .replace(/&plusmn;/g,'+/-').replace(/\n\s*\n/g,'\n');
  console.log('\nHEADLINE  '+(100*pop.rate).toFixed(2)+'% of '+pop.population.toLocaleString());
  console.log(txt);
}
eval(PRELUDE + '\n(' + PROBE.toString() + ')();\n');
