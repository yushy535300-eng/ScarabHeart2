'use strict';
const crypto = require('crypto');
const games = {'golden-seth':'賽特二代','egyptian-mythology':'賽特一代','tiger-princess':'虎小妹'};
function recipe(game, room, now=Date.now(), anchor=null) {
 if (!games[game] || !/^\d{1,6}$/.test(String(room))) return null;
 room=String(Number(room));
 const epoch=Math.floor((now-(anchor??0))/600000);
 const digest=crypto.createHmac('sha256',process.env.SIGNAL_SEED||'scarab-room-signals-v1').update(`${game}:${room}:${epoch}${anchor==null?'':':reset:'+anchor}`).digest();
 function choose(source){
  let i=0;const rand=n=>source[i++%source.length]%n;
  const pool=Array.from({length:9},(_,i)=>i+1);
  for(let k=8;k>0;k--){const j=rand(k+1);[pool[k],pool[j]]=[pool[j],pool[k]];}
  const sizes=[2,2,2,2,2,2,2,2,2,3,3,3,3,3,3,3,3,4,4,5],size=sizes[rand(sizes.length)];
  const selected=pool.slice(0,size);
  if(selected.every(n=>n>=5))selected[0]=pool.find(n=>n<=4);
  const gemMinimum=size<=3?4:3,gemMaximum=size<=3?6:4;
  const options=selected.map(n=>n>=5?Array.from({length:gemMaximum-gemMinimum+1},(_,j)=>gemMinimum+j):[2,4,6]);
  const limits={2:[6,11],3:[8,14],4:[10,16],5:[12,18]},[lo,hi]=limits[size];
  const candidates=[];
  function enumerate(counts){if(counts.length<size){for(const n of options[counts.length])enumerate([...counts,n]);return;}
   const six=counts.filter((n,j)=>selected[j]<=4&&n===6).length;
   if(six>1)return;
   if(six&&counts.some((n,j)=>selected[j]<=4?n!==6&&n!==2:n!==gemMinimum))return;
   const sum=counts.reduce((a,b)=>a+b,0);if(sum>=lo&&sum<=hi)candidates.push(counts);
  }
  enumerate([]);
  const wantsSix=rand(5)===0,preferred=candidates.filter(c=>c.some((n,j)=>selected[j]<=4&&n===6)===wantsSix);
  const available=preferred.length?preferred:candidates,counts=available[rand(available.length)];
  return {selected,counts};
 }
 const {selected,counts}=choose(digest);
 // Shared recommendation indicator; configured server-side, not a probability or board measurement.
 const step=Math.floor(((now-(anchor??0))%600000)/15000);
 const initialBands=[[35,49],[50,69],[70,89]];
 const [initialLow,initialHigh]=initialBands[digest[29]%initialBands.length];
 let strength=initialLow+digest[30]%(initialHigh-initialLow+1);
 for(let t=1;t<=step;t++){
  const noise=crypto.createHmac('sha256',digest).update('strength:'+t).digest();
  const high=strength>=70;
  let direction=high?-1:(noise[0]%2?1:-1);
  let delta=high&&direction<0?8+noise[1]%8:5+noise[1]%11;
  if(strength+direction*delta>95){direction=-1;delta=high?8+noise[1]%8:delta;}
  if(strength+direction*delta<15)direction=1;
  strength+=direction*delta;
 }
 const names=game==='tiger-princess'?['斧頭','盾牌','啤酒','錢袋','黃寶石','紅寶石','紫寶石','藍寶石','綠寶石']:['眼睛','蛇','弓','彎刀','黃寶石','紅寶石','紫寶石','藍寶石','綠寶石'];
 return {id:`${game}:${room}:${epoch}:${anchor??'global'}:balanced-v4`,game,gameName:games[game],room,strength,strengthSource:'server-recommendation',symbols:selected.map((n,j)=>({id:`symbol_${String(n).padStart(2,'0')}`,name:names[n-1],count:counts[j],asset:`/signal-assets/${game==='tiger-princess'?'tiger'+n:'seth'+(n+3)}`}))};
}
function evaluate(rule,board){
 if(!rule||!board)return null;
 const values=Object.values(board);if(!values.length||values.some(v=>!Number.isInteger(v)||v<0)||values.reduce((a,b)=>a+b,0)>30)return null;
 const hit=rule.symbols.every(s=>(board[s.id]||0)>=s.count);
 const ratio=rule.symbols.reduce((sum,s)=>sum+Math.min(1,(board[s.id]||0)/s.count),0)/rule.symbols.length;
 return {hit,strength:Math.round(15+ratio*70),reason:rule.symbols.map(s=>`${s.name} ${board[s.id]||0} 個`).join('＋')};
}
module.exports={recipe,evaluate};
