const assert=require('node:assert/strict');
const {recipe,evaluate}=require('./signal-rules.cjs');
const t=1800000000000;
assert.deepEqual(recipe('golden-seth','022',t),recipe('golden-seth','22',t));
assert.notEqual(recipe('golden-seth','22',t).id,recipe('golden-seth','22',t+600000).id);
assert.equal(recipe('unknown','22',t),null);assert.equal(recipe('golden-seth','bad',t),null);
const sizes=new Set(),quantities=new Set();
for(let i=1;i<=600;i++){
 const r=recipe('golden-seth',i,t);sizes.add(r.symbols.length);
 assert.equal(new Set(r.symbols.map(s=>s.id)).size,r.symbols.length);
 const total=r.symbols.reduce((a,s)=>a+s.count,0);const [lo,hi]=({2:[6,11],3:[8,14],4:[10,16],5:[12,18]})[r.symbols.length];assert(total>=lo&&total<=hi);
 assert(r.symbols.some(s=>Number(s.id.slice(-2))<=4));
 const big=r.symbols.filter(s=>Number(s.id.slice(-2))<=4),six=big.filter(s=>s.count===6);
 assert(six.length<=1);
 r.symbols.forEach(s=>{quantities.add(s.count);const gem=Number(s.id.slice(-2))>=5;if(gem){assert(s.count>=(r.symbols.length<=3?4:3));assert(s.count<=(r.symbols.length<=3?6:4));if(six.length)assert.equal(s.count,r.symbols.length<=3?4:3);}else{assert([2,4,6].includes(s.count));if(six.length&&s.count!==6)assert.equal(s.count,2);}});
 const b=Object.fromEntries(r.symbols.map(s=>[s.id,s.count]));assert(evaluate(r,b).hit);
 b[r.symbols[0].id]=0;assert(!evaluate(r,b).hit);
 assert.equal(evaluate(r,{}),null);
}
assert.equal(sizes.size,4);assert(quantities.size>=3);
console.log('Room synchronization, rollover, variable counts and live matching passed');
// Recommendation strength exists before a board or spin and is shared by server time.
for(const game of ['golden-seth','egyptian-mythology','tiger-princess']){
 for(let room=1;room<=50;room++){
  const start=1800000000000;let previous=null;
  for(let t=0;t<40;t++){
   const r=recipe(game,String(room),start+t*15000);
   assert.equal(r.strengthSource,'server-recommendation');assert.ok(r.strength>=15&&r.strength<=95);if(t===0)assert.ok(r.strength>=35&&r.strength<=89);
   assert.equal(r.strength,recipe(game,String(room).padStart(3,'0'),start+t*15000).strength);
   if(previous!==null){const delta=r.strength-previous;assert.ok(Math.abs(delta)>=5&&Math.abs(delta)<=15);if(previous>=70){assert.ok(delta<0);assert.ok(-delta>=8);}}
   previous=r.strength;
  }
 }
}
console.log('PASS: shared server strength without spin, 35–89 initial range, high-strength decline and bounded updates');

// Every recipe size can start low, medium or high, independently of symbol count.
{const seen=new Map([2,3,4,5].map(n=>[n,new Set()]));
 for(let room=1;room<=5000;room++){const r=recipe('golden-seth',String(room),1800000);seen.get(r.symbols.length).add(r.strength<50?'low':r.strength<70?'medium':'high');}
 for(const [size,bands] of seen)assert.equal(bands.size,3,'all strength bands for '+size+' symbol types');
 console.log('PASS: 2–5 symbol recipes each receive low/medium/high initial strength');}

{for(let room=1;room<=500;room++){const start=1800000;const initial=recipe('golden-seth',String(room),start);if(initial.strength>=70)assert.ok([1,2,3].some(step=>recipe('golden-seth',String(room),start+step*15000).strength<70));}
 console.log('PASS: high initial strength falls below 70 within 45 seconds');}
