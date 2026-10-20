'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { serveAtgAsset, isAtgAsset } = require('./server/atg-assets');
const app = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
const catalogue = require('./test-fixtures/atg-catalog-20261020.json');
const lobbyFunction = app.slice(app.indexOf('  function directGameUrlOnce('), app.indexOf('  function directGameUrl('));
const resolverFunction = app.slice(app.indexOf('  function resolveAtgGameUrl('), app.indexOf('  function rankPercent('));

function response() {
  return {statusCode: 0, headers: {}, status(n) {this.statusCode=n;return this;}, type(t) {this.headers.type=t;return this;},
    set(k,v) {this.headers[k]=v;return this;}, send(body) {this.body=body;return this;}};
}

test('all supported game boot configs and framework resources remain proxied without CORS', async t => {
  let calls=0;
  t.mock.method(global, 'fetch', async () => {calls++;return new Response('{"imports":{"cc":"../cocos-js/cc.js"}}', {headers:{'content-type':'application/json'}});});
  for (const game of catalogue) {
    for (const resource of ['src/import-map.json', 'src/settings.json', 'assets/main/config.json', 'assets/main/native/texture.png']) {
      const url=new URL(`https://play.godeebxp.com/egames/${game.checksum}/game/${resource}`);
      assert.equal(isAtgAsset(url),true);
      const res=response();
      assert.equal(await serveAtgAsset({method:'GET',headers:{}},res,url,url.origin),true);
      assert.equal(res.statusCode,200);
      assert.equal(res.headers.Location,undefined);
    }
  }
  const url=new URL('https://play.godeebxp.com/slotFramework/'+'f'.repeat(40)+'/config.json');
  const before=calls;
  await Promise.all(Array.from({length:10},()=>serveAtgAsset({method:'GET',headers:{}},response(),url,url.origin)));
  assert.equal(calls-before,1,'parallel requests share one download');
  await serveAtgAsset({method:'GET',headers:{}},response(),url,url.origin);
  assert.equal(calls-before,1,'versioned resources reuse the bounded cache');
  assert.equal(isAtgAsset(new URL('https://play.godeebxp.com/api/login')),false);
});

test('asset fetch errors are not cached and upstream redirects never escape to CORS', async t => {
  let calls=0;
  t.mock.method(global,'fetch',async()=>{calls++;return new Response('failed',{status:503});});
  const url=new URL('https://play.godeebxp.com/egames/'+'e'.repeat(40)+'/game/src/settings.json');
  for(let i=0;i<2;i++){const res=response();await serveAtgAsset({method:'GET',headers:{}},res,url,url.origin);assert.equal(res.statusCode,503);}
  assert.equal(calls,2);
  t.mock.method(global,'fetch',async()=>new Response(null,{status:302,headers:{location:'https://unrelated.example/'}}));
  const res=response();await serveAtgAsset({method:'GET',headers:{}},res,url,url.origin);assert.equal(res.statusCode,502);assert.equal(res.headers.Location,undefined);
});

test('401 lobbyInitial stops without lobbyPlay; cancellation closes the active socket', async () => {
  let socket;
  class WS { static OPEN=1;readyState=1;frames=[];closed=false;constructor(){socket=this;}send(s){this.frames.push(s);}close(){this.closed=true;} }
  const ctx=vm.createContext({WebSocket:WS,URL,GAME_META:{},setTimeout,clearTimeout});
  vm.runInContext(lobbyFunction,ctx);
  let promise=ctx.directGameUrlOnce('TEST','golden-seth',1000);
  socket.onmessage({data:'40'});socket.onmessage({data:'430[{"status":401,"message":"找不到 Token 資料"}]'});
  await assert.rejects(promise,e=>e.atgStatus===401);
  assert.equal(socket.frames.length,1);assert.equal(socket.closed,true);
  const controller=new AbortController();promise=ctx.directGameUrlOnce('TEST','golden-seth',1000,controller.signal);
  controller.abort();await assert.rejects(promise,/probe-cancelled/);assert.equal(socket.closed,true);
});

test('an expired lobby token gets a fresh TZ entry, never a retry of the same token', async () => {
  let logins=0;const tokens=[];
  const ctx=vm.createContext({session:{game:'golden-seth'},atgEntryQueue:Promise.resolve(),URL,
    requestAtgLobbyUrl:async()=>`https://play.godeebxp.com/egames/lobby/game/?t=TEST_${++logins}`,
    directGameUrl:async token=>{tokens.push(token);if(tokens.length===1)throw new Error('401');return 'OK';}});
  vm.runInContext(resolverFunction,ctx);
  assert.equal(await ctx.resolveAtgGameUrl('golden-seth'),'OK');
  assert.deepEqual(tokens,['TEST_1','TEST_2']);
});

test('entry waits for cancelled probe HTTP to drain before obtaining a fresh token', async () => {
  const events=[];let finishProbe;
  const controller=new AbortController();let calls=0;
  const ctx=vm.createContext({session:{game:'golden-seth'},atgEntryQueue:Promise.resolve(),URL,
    requestAtgLobbyUrl:async()=>{events.push('login'+(++calls));if(calls===1)return new Promise(resolve=>{finishProbe=resolve});return 'https://play.godeebxp.com/?t=TEST_NEW';},
    directGameUrl:async token=>{events.push(token);return 'OK';}});
  vm.runInContext(resolverFunction,ctx);
  const probe=ctx.resolveAtgGameUrl('golden-seth',controller.signal);
  const rejected=assert.rejects(probe,/probe-cancelled/);
  await Promise.resolve();controller.abort();
  const entry=ctx.resolveAtgGameUrl('golden-seth');
  assert.deepEqual(events,['login1']);
  finishProbe('https://play.godeebxp.com/?t=TEST_OLD');
  await rejected;assert.equal(await entry,'OK');
  assert.deepEqual(events,['login1','login2','TEST_NEW']);
});
