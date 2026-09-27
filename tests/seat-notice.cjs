const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../runtime/atg-engine-runtime.js'),'utf8');
const helpers=source.slice(source.indexOf('// v3.26: display-only'),source.indexOf('// End v3.26 display-only helpers.'));
let roomText=null, timers=0;const notices=[];
const room={name:'slotTable2Btn',activeInHierarchy:true,children:[{name:'holder',children:[{name:'numberText',get text(){return roomText;}}]}]};
let scene=room;
for(let i=0;i<24;i++)scene={name:'nested',children:[scene]};
const ctx=vm.createContext({cc:{director:{getScene:()=>scene}},a6:{label:n=>n.text||null,seatedNum:()=>null},h:{},
scarabMachineKey:v=>v==null?null:String(v).trim().replace(/^0+(?=\d)/,''),am:(...args)=>notices.push(args),an:()=>{},
setTimeout:()=>++timers,clearTimeout:()=>{}});
vm.runInContext(helpers,ctx);
assert.equal(ctx.scarabReadSeatNoticeRoom(),null);
ctx.scarabShowSeatNotice(null);assert.equal(notices[0][0],'✅ 你已進入遊戲');assert.ok(!notices[0][0].includes('?'));
roomText='021';const number=ctx.scarabReadSeatNoticeRoom();assert.equal(number,'21');ctx.scarabShowSeatNotice(number);
assert.equal(notices[1][0],'✅ 你已進入遊戲 #21');ctx.scarabShowSeatNotice(number);assert.equal(notices.length,2);
roomText='022';ctx.scarabShowSeatNotice(ctx.scarabReadSeatNoticeRoom());assert.equal(notices.at(-1)[0],'✅ 你已進入遊戲 #22');
room.activeInHierarchy=false;assert.equal(ctx.scarabReadSeatNoticeRoom(),null);
room.activeInHierarchy=true;room.children.push({name:'unrelated',text:'999'});assert.equal(ctx.scarabReadSeatNoticeRoom(),null);
console.log('PASS: delayed label updates, depth-24 portrait label, changed room, hidden/ambiguous labels, no repeated toast.');
