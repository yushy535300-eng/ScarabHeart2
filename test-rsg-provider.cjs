const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync(__dirname+'/server.js','utf8'),ctx=vm.createContext({URL});
for(const [a,b] of [['function gameAllowed(','function apiAllowed('],['function scriptJson(',"app.disable('x-powered-by')"],['function providerBoot(','function upstreamHeaders(']])vm.runInContext(s.slice(s.indexOf(a),s.indexOf(b)),ctx);
const sid='a'.repeat(24);
function scripts(path){return [...ctx.providerBoot(sid,'https://gameweb.rsgaming888.com'+path,{provider:'rsg',payload:{cfg:{}}},true).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);}
test('recorded and legacy hosts accepted, unrelated hosts rejected',()=>{
 for(const z of ['666','888','955','977'])for(const r of ['gameweb','gameresource','gameresource3','gameserver'])assert.equal(ctx.gameAllowed(new URL(`https://${r}.rsgaming${z}.com/`),'rsg'),true);
 for(const h of ['gameweb.rsgaming888.com.evil.test','evil.rsgaming888.com','evil.rsgaming955.com','localhost'])assert.equal(ctx.gameAllowed(new URL('https://'+h),'rsg'),false);
});
test('generated proxy routes new resource and socket hosts',()=>{
 const calls=[];class Element{setAttribute(){}}class XHR{open(){}}class WS{constructor(u){calls.push(u)}}
 const c={URL,Request,Element,HTMLIFrameElement:class extends Element{},XMLHttpRequest:XHR,WebSocket:WS,location:{origin:'https://scarab.test',host:'scarab.test',protocol:'https:'},document:{baseURI:`https://scarab.test/__game/${sid}/Web/`},fetch:u=>{calls.push(u);return Promise.resolve()}};c.window=c;
 vm.runInNewContext(scripts('/Web/SlotGame5')[0],c);
 c.fetch('https://gameresource3.rsgaming888.com/WebUI3/content/PowerOfThor2/settings.json');assert.equal(calls.pop(),'https://gameresource3.rsgaming888.com/WebUI3/content/PowerOfThor2/settings.json');
 new c.WebSocket('wss://gameserver.rsgaming888.com/ws');assert.ok(calls.pop().startsWith(`wss://scarab.test/__socket/${sid}?url=`));
 c.fetch('/provider-rsg-nav.js');assert.equal(calls.pop(),'/provider-rsg-nav.js');
 c.fetch('https://evil.test/x');assert.equal(calls.pop(),'https://evil.test/x');
});
test('Thor runtime is limited to SlotGame5; lobby uses the data-backed selector',()=>{
 const gameScripts=scripts('/Web/SlotGame5');
 assert.equal(gameScripts.length,2);
 gameScripts.forEach(x=>new vm.Script(x));
 let tick,started=0;
 const c={URL,console,location:{pathname:`/__game/${sid}/__remote`,href:'https://scarab.test/ignored'},__SCARAB_ORIGINAL_URL:'https://gameweb.rsgaming888.com/Web/SlotGame5',setInterval:f=>{tick=f;return 1},clearInterval(){},thorEngine:()=>started++};
 c.window=c;
 vm.runInNewContext(gameScripts[1],c);
 tick();
 assert.equal(started,1);
 const lobby=ctx.providerBoot(sid,'https://gameweb.rsgaming955.com/Lobby2/Index',{provider:'rsg',payload:{cfg:{}}},true);
 assert.ok(lobby.includes('provider-rsg-lobby-rescue.js'));
 assert.ok(!lobby.includes('thor-engine-code.js'));
 assert.ok(!lobby.includes('provider-rsg-nav.js'));
});
test('RSG lobby replacement uses live GameData and dynamic game selection',()=>{
 const selector=fs.readFileSync(__dirname+'/public/provider-rsg-lobby-rescue.js','utf8');
 new vm.Script(selector);
 assert.ok(selector.includes('/Lobby2/GameData'));
 assert.ok(selector.includes('/Lobby2/GetGameURL'));
 assert.match(selector,/__navigate/);
 assert.ok(!selector.includes('id=129'));
});
test('only public RSG CDN resources bypass proxies',()=>{
 const c=vm.createContext({});vm.runInContext(s.slice(s.indexOf('function rsgPublicAsset('),s.indexOf('function apiAllowed(')),c);
 for(const ext of ['webp','bin','ttf','mp3','css','js'])assert.equal(c.rsgPublicAsset(new URL('https://gameresource3.rsgaming888.com/WebUI3/content/PowerOfThor2/a.'+ext),'rsg','GET'),true);
 for(const [url,kind,method] of [['https://gameweb.rsgaming888.com/Web/SessionInfo','rsg','GET'],['https://gameresource3.rsgaming888.com/WebUI3/a.bin','qt','GET'],['https://gameresource3.rsgaming888.com/WebUI3/a.bin','rsg','POST'],['https://gameresource3.rsgaming888.com.evil.test/WebUI3/a.bin','rsg','GET']])assert.equal(c.rsgPublicAsset(new URL(url),kind,method),false);
});
