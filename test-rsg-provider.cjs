const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync(__dirname+'/server.js','utf8'),ctx=vm.createContext({URL});
for(const [a,b] of [['function gameAllowed(','function apiAllowed('],['function scriptJson(',"app.disable('x-powered-by')"],['function providerBoot(','function upstreamHeaders(']])vm.runInContext(s.slice(s.indexOf(a),s.indexOf(b)),ctx);
const sid='a'.repeat(24);
function scripts(path){return [...ctx.providerBoot(sid,'https://gameweb.rsgaming888.com'+path,{provider:'rsg',payload:{cfg:{}}},true).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);}
test('recorded and legacy hosts accepted, unrelated hosts rejected',()=>{
 for(const z of ['666','888','955','977','999'])for(const r of ['gameweb','gameresource','gameresource3','gameserver'])assert.equal(ctx.gameAllowed(new URL(`https://${r}.rsgaming${z}.com/`),'rsg'),true);
 for(const h of ['gameweb.rsgaming888.com.evil.test','evil.rsgaming888.com','evil.rsgaming955.com','evil.rsgaming999.com','localhost'])assert.equal(ctx.gameAllowed(new URL('https://'+h),'rsg'),false);
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
test('original RSG lobby is preserved, with no forced game entry or replacement menu',()=>{
 const lobby=ctx.providerBoot(sid,'https://gameweb.rsgaming955.com/Lobby2/Index',{provider:'rsg',payload:{cfg:{}}},true);
 assert.equal((lobby.match(/<script>/g) || []).length, 2);
 assert.ok(lobby.includes('__scarabProviderPage:true'));
 assert.ok(lobby.includes('page:"lobby"'));
 assert.ok(!lobby.includes('provider-rsg-lobby-rescue.js'));
 assert.ok(!lobby.includes('<script src="/provider-rsg-nav.js"></script>'));
 assert.ok(!lobby.includes('<script src="/provider/thor-engine-code.js"></script>'));
});
test('Thor engine only starts for SlotGame5 and not in the native lobby',()=>{
 const scriptsOnGame=scripts('/Web/SlotGame5');
 assert.equal(scriptsOnGame.length,3);
 assert.ok(scriptsOnGame[2].includes('page:"game"'));
 scriptsOnGame.forEach(x=>new vm.Script(x));
 const c={URL,console,location:{pathname:`/__game/${sid}/__remote`,href:'https://scarab.test/ignored'},
   __SCARAB_ORIGINAL_URL:'https://gameweb.rsgaming888.com/Web/SlotGame5',
   setInterval:f=>{c.tick=f;return 1},clearInterval(){},thorEngine:()=>{c.started=(c.started||0)+1}};
 c.window=c;
 vm.runInNewContext(scriptsOnGame[1],c);c.tick();
 assert.equal(c.started,1);
});
test('RSG game return only navigates to its recorded native lobby',()=>{
 const backend=fs.readFileSync(__dirname+'/server.js','utf8');
 assert.ok(backend.includes("app.get('/__game/:sid/__rsg-return'"));
 assert.ok(backend.includes('session.rsgLobbyUrl = finalUrl.href'));
 assert.ok(backend.includes('session.rsgLobbyUrl = returnedUrl.href'));
 assert.ok(!backend.includes("provider-rsg-lobby-rescue.js"));
});
test('RSG unsupported games receive the screenshot-one Scarab Heart panel with no fake statistics',()=>{
 const local=fs.readFileSync(__dirname+'/public/provider-scarab-assistant-rsg.js','utf8');
 new vm.Script(local);
 for (const text of ['聖甲之心助手','本場輸贏','本場RTP','未開免遊','免遊自動跳過','止盈 / 止損','加速器','returnToRsgLobby','scarab:rsg-page'])
   assert.ok(local.includes(text), 'Missing original panel feature: '+text);
 assert.ok(local.includes('knownNative()'), 'Original Thor HUD must take precedence');
 assert.ok(local.includes('Number.isFinite'), 'No fabricated results');
 assert.ok(!local.includes('scPanel'), 'Old ATG grid must not be shown');
 assert.ok(!local.includes('RSG 遊戲輔助'), 'Custom RSG panel must be gone');
 assert.ok(s.includes('provider-scarab-assistant-rsg'));
});
test('only public RSG CDN resources bypass proxies',()=>{
 const c=vm.createContext({});vm.runInContext(s.slice(s.indexOf('function rsgPublicAsset('),s.indexOf('function apiAllowed(')),c);
 for(const ext of ['webp','bin','ttf','mp3','css','js'])assert.equal(c.rsgPublicAsset(new URL('https://gameresource3.rsgaming888.com/WebUI3/content/PowerOfThor2/a.'+ext),'rsg','GET'),true);
 for(const [url,kind,method] of [['https://gameweb.rsgaming888.com/Web/SessionInfo','rsg','GET'],['https://gameresource3.rsgaming888.com/WebUI3/a.bin','qt','GET'],['https://gameresource3.rsgaming888.com/WebUI3/a.bin','rsg','POST'],['https://gameresource3.rsgaming888.com.evil.test/WebUI3/a.bin','rsg','GET']])assert.equal(c.rsgPublicAsset(new URL(url),kind,method),false);
});
