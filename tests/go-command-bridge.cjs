const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require.resolve('../runtime/overlay-runtime.js'),'utf8');
const a=src.indexOf('function goCmd(url){'),b=src.indexOf('\nfunction toast',a);assert(a>=0&&b>a);
const fn=src.slice(a,b);
function setup({parentDistinct=true,opener=false,prefix=false}={}){
 const sent=[],dispatched=[],navigations=[];const self={closed:false};
 const parent=parentDistinct?{postMessage:(...x)=>sent.push(x)}:self;
 const openerObj=opener?{closed:false,postMessage:(...x)=>sent.push(x)}:null;
 const win={parent,opener:openerObj,__SCARAB_ROOM_SESSION_ID:'room-session'};
 const ctx=vm.createContext({window:win,location:{origin:'https://assistant.example',set href(v){navigations.push(v)}},CustomEvent:function(type,init){this.type=type;this.detail=init.detail},setTimeout:()=>{},console:{error:()=>{}}});
 win.dispatchEvent=e=>dispatched.push(e);vm.runInContext(fn,ctx);return{ctx,sent,dispatched,navigations};
}
let t=setup({parentDistinct:true,prefix:false});t.ctx.goCmd('https://__sethcmd__/pick?mn=21');assert.equal(t.sent.length,1);assert.equal(t.sent[0][1],'*');assert.equal(t.sent[0][0].url,'https://__sethcmd__/pick?mn=21');assert.deepEqual(t.navigations,[]);assert.equal(t.dispatched.length,0);
t=setup({parentDistinct:false,opener:true});t.ctx.goCmd('https://__sethcmd__/pick?mn=22');assert.equal(t.sent.length,1);assert.equal(t.sent[0][0].roomSessionId,'room-session');assert.equal(t.navigations.length,0);
t=setup({parentDistinct:false,opener:false});t.ctx.goCmd('https://__sethcmd__/pick?mn=23');assert.equal(t.dispatched[0].type,'scarab:web-command');assert.deepEqual(t.navigations,[]);
console.log('PASS: iframe sends command without proxy-prefix gate; opener/local fallbacks never navigate to __sethcmd__.');
