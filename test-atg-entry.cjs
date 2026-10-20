const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
const catalogue = require('./test-fixtures/atg-catalog-20261020.json');
const sid = 'a'.repeat(24);
const golden = catalogue.find(g => g.code === 'golden-seth');
const upstream = `https://play.godeebxp.com/egames/${golden.checksum}/game/?t=TEST&gn=golden-seth`;

function boot(payload, runtime = true) {
  const ctx = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function scriptJson('), source.indexOf("app.disable('x-powered-by')")), ctx);
  vm.runInContext(source.slice(source.indexOf('function gameBoot('), source.indexOf('function providerBoot(')), ctx);
  return ctx.gameBoot(sid, upstream, { payload }, runtime);
}

test('generated ATG scripts compile for all games, lobby and probe', () => {
  for (const game of catalogue) {
    for (const probe of [false, true]) {
      for (const runtime of [false, true]) {
        const html = boot({kind: 'atg', gameCode: game.code, probe, cfg: {}}, runtime);
        const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
        assert.ok(scripts.length);
        for (const script of scripts) new vm.Script(script[1]);
      }
    }
  }
});

test('generated script actually routes assets, manifest and WebSocket', () => {
  const calls = [];
  class Element { setAttribute() {} }
  class XHR { open() {} }
  class WS {
    static OPEN = 1;
    constructor(url) { calls.push(['socket', url]); }
  }
  const local = 'https://scarab.example';
  const context = {
    URL, Request, Element, XMLHttpRequest: XHR,
    HTMLImageElement: class extends Element {}, HTMLScriptElement: class extends Element {},
    HTMLLinkElement: class extends Element {}, HTMLAudioElement: class extends Element {},
    HTMLVideoElement: class extends Element {}, HTMLSourceElement: class extends Element {},
    navigator: {}, location: {origin: local, host: 'scarab.example', protocol: 'https:'},
    document: {baseURI: `${local}/__game/${sid}/egames/${golden.checksum}/game/`, addEventListener() {}},
    fetch: (url) => { calls.push(['fetch', url]); return Promise.resolve(); }, WebSocket: WS
  };
  context.window = context;
  vm.runInNewContext([...boot({kind: 'atg', cfg: {}}, false).matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], context);
  context.fetch('src/settings.json');
  assert.equal(calls.pop()[1], `${local}/__game/${sid}/egames/${golden.checksum}/game/src/settings.json`);
  context.fetch('/slotFramework/manifest.json?v=1');
  assert.equal(calls.pop()[1], `${local}/__game/${sid}/slotFramework/manifest.json?v=1`);
  context.fetch('/slotFramework/hash/index.js');
  assert.equal(calls.pop()[1], `${local}/__game/${sid}/slotFramework/hash/index.js`);
  context.fetch('https://play.godeebxp.com/api/example');
  assert.equal(calls.pop()[1], `${local}/__game/${sid}/api/example`);
  new context.WebSocket('wss://socket.godeebxp.com/socket.io/?EIO=3&transport=websocket');
  assert.ok(calls.pop()[1].startsWith(`wss://scarab.example/__socket/${sid}?url=`));
  assert.equal(context.WebSocket.OPEN, 1);
  context.fetch('https://unrelated.example/asset.js');
  assert.equal(calls.pop()[1], 'https://unrelated.example/asset.js');
});

test('HAR lobby exchange updates stale metadata and preserves redirected game URL', async () => {
  const GAME_META = Object.fromEntries(catalogue.map(g => [g.code, {checksum: '0'.repeat(40)}]));
  let socket;
  class WS {
    static OPEN = 1;
    readyState = 1;
    constructor() { socket = this; }
    send(frame) { this.frames.push(frame); }
    close() {}
    frames = [];
  }
  const ctx = vm.createContext({WebSocket: WS, GAME_META, URL, setTimeout, clearTimeout});
  vm.runInContext(app.slice(app.indexOf('  function directGameUrlOnce('), app.indexOf('  function directGameUrl(')), ctx);
  const promise = ctx.directGameUrlOnce('TEST_LOBBY_TOKEN', golden.code, 1000);
  socket.onmessage({data: '40'});
  assert.match(socket.frames[0], /^420\["lobbyInitial"/);
  socket.onmessage({data: '430' + JSON.stringify([{status: 200, token: 'TEST_ROTATED_TOKEN', content: {games: catalogue}}])});
  assert.equal(GAME_META[golden.code].checksum, golden.checksum);
  assert.equal(JSON.parse(socket.frames[1].slice(3))[1].token, 'TEST_ROTATED_TOKEN');
  socket.onmessage({data: '431' + JSON.stringify([{status: 200, redirectUrl: upstream}])});
  assert.equal(await promise, upstream);
  const scarlet = catalogue.find(g => g.code === 'scarlet-three-kingdoms');
  assert.equal(GAME_META[scarlet.code].checksum, '0'.repeat(40));
});

test('wrong-game redirect remains rejected', async () => {
  let socket;
  class WS { static OPEN = 1; readyState = 1; constructor() { socket = this; } send() {} close() {} }
  const ctx = vm.createContext({WebSocket: WS, GAME_META: {[golden.code]: {}}, URL, setTimeout, clearTimeout});
  vm.runInContext(app.slice(app.indexOf('  function directGameUrlOnce('), app.indexOf('  function directGameUrl(')), ctx);
  const promise = ctx.directGameUrlOnce('TEST', golden.code, 1000);
  socket.onmessage({data: '40'});
  socket.onmessage({data: '430' + JSON.stringify([{content: {games: catalogue}}])});
  socket.onmessage({data: '431' + JSON.stringify([{redirectUrl: upstream.replace('gn=golden-seth', 'gn=hades')}])});
  await assert.rejects(promise, /錯誤的遊戲入口/);
});
