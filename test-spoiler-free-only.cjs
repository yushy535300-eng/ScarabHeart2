const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('runtime/overlay-runtime.js','utf8');
const start=src.indexOf('setInterval(function(){var e=eng(),p=pan(),r=null');
const end=src.indexOf(' ,500);',start);
assert(start>=0&&end>start);
function run(result){
 const panel={spoilerWin:result};const engine={panel};const shown=[];
 const ctx={eng:()=>engine,pan:()=>panel,__spoilerWatchEngine:engine,__watchSpoiler(){},__lastSpoilerResult:null,__lastSpoilerSig:'',spoil:true,document:{getElementById(){return null}},__fitNum(){},legacyRoot(){return null},toast:(...x)=>shown.push(x),setInterval:fn=>fn()};
 vm.runInNewContext(src.slice(start,end)+' ,500);',ctx);
 return shown;
}
assert.equal(run({totalWin:1250,fg:0}).length,0);
assert.equal(run({totalWin:1250}).length,0);
assert.equal(run({totalWin:1250,fg:15}).length,1);
assert.equal(run({totalWin:1250,fg:0,isFreeGame:true}).length,1);
console.log('PASS: overlay rejects ordinary-spin scores and retains free-game scores.');
