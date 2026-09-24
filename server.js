'use strict';
const express = require('express');
const { WebSocket, WebSocketServer } = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const path = require('path');
const crypto = require('crypto');

const app = express();
const sessions = new Map();
const publicDir = path.join(__dirname, 'public');
const outboundProxy = process.env.WSS_PROXY || process.env.wss_proxy || process.env.HTTPS_PROXY || process.env.https_proxy;
const websocketAgent = /^https?:\/\//i.test(String(outboundProxy || '')) ? new HttpsProxyAgent(outboundProxy) : undefined;

function allowed(u) {
  if (u.protocol !== 'https:' && u.protocol !== 'wss:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'tz6868.cc' || h.endsWith('.tz6868.cc') ||
    h === 'godeebxp.com' || h.endsWith('.godeebxp.com') ||
    /(^|\.)rsgaming[\w-]*\.com$/.test(h) ||
    /(^|\.)royalgaming[\w-]*\.com$/.test(h);
}

function apiAllowed(u) {
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return h === 'seth-eye.com' || h.endsWith('.seth-eye.com') ||
    h === 'tz6868.cc' || h.endsWith('.tz6868.cc') ||
    h === 'ofa1188.net' || h.endsWith('.ofa1188.net');
}

function apiURL(req) {
  try {
    const u = new URL(String(req.query.url || ''));
    return apiAllowed(u) ? u : null;
  } catch (_) { return null; }
}

app.get('/healthz', (req, res) => res.status(200).json({ ok: true, version: '2.51-real-engine' }));

app.use('/__api', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const u = apiURL(req);
  if (!u) return res.status(403).json({ ok: false, error: 'API host is not allowed' });
  try {
    const headers = { accept: req.headers.accept || 'application/json', 'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 Chrome/126 Safari/537.36', origin: u.origin, referer: u.origin + '/' };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.headers['x-copilot-key']) headers['x-copilot-key'] = req.headers['x-copilot-key'];
    const init = { method: req.method, headers, redirect: 'follow' };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && req.body.length) init.body = req.body;
    const upstream = await fetch(u, init);
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.type(upstream.headers.get('content-type') || 'application/octet-stream');
    res.set('Cache-Control', upstream.headers.get('cache-control') || 'no-store');
    res.send(bytes);
  } catch (err) {
    res.status(502).json({ ok: false, error: '上游服務連線失敗', detail: String(err && err.message || err) });
  }
});

function gameBoot(sid, originalHref) {
  const prefix = '/__game/' + sid;
  return '<script>window.__SCARAB_ORIGINAL_URL=' + JSON.stringify(originalHref) +
    ';window.__SCARAB_PROXY_PREFIX=' + JSON.stringify(prefix) +
    ';(function(){var O=window.__SCARAB_ORIGINAL_URL,P=' + JSON.stringify(prefix) +
    ';function A(x){var h=x.hostname.toLowerCase();return h==="tz6868.cc"||/\\.tz6868\\.cc$/.test(h)||h==="godeebxp.com"||/\\.godeebxp\\.com$/.test(h)||/(^|\\.)rsgaming[\\w-]*\\.com$/.test(h)||/(^|\\.)royalgaming[\\w-]*\\.com$/.test(h)}' +
    'function H(raw){try{var x=new URL(String(raw),O);if(/^https?:$/.test(x.protocol)&&A(x))return P+"/__remote?url="+encodeURIComponent(x.href)}catch(e){}return raw}' +
    'var F=window.fetch;if(F)window.fetch=function(i,n){var raw=typeof i==="string"?i:(i&&i.url)||String(i),u=H(raw);try{if(i instanceof Request&&u!==raw)i=new Request(u,i);else if(u!==raw)i=u}catch(e){i=u}return F.call(this,i,n)};' +
    'var XO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=H(u);return XO.apply(this,arguments)};' +
    'if(window.EventSource){var ES=window.EventSource;window.EventSource=function(u,o){return new ES(H(u),o)};window.EventSource.prototype=ES.prototype}' +
    'if(navigator.sendBeacon){var SB=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){return SB(H(u),d)}}' +
    'var N=window.WebSocket;window.WebSocket=function(u,p){try{var x=new URL(u,O);if(/^wss?:$/.test(x.protocol)&&A(x)){var q=(location.protocol==="https:"?"wss:":"ws:")+"//"+location.host+"/__socket/' + sid + '?url="+encodeURIComponent(x.href);return p?new N(q,p):new N(q)}}catch(e){}return p?new N(u,p):new N(u)};window.WebSocket.prototype=N.prototype;Object.keys(N).forEach(function(k){try{window.WebSocket[k]=N[k]}catch(e){}})' +
    '})();<\/script>';
}

function upstreamHeaders(req, u) {
  const headers = {
    accept: req.headers.accept || '*/*',
    'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 Chrome/126 Safari/537.36',
    origin: u.origin,
    referer: u.origin + '/'
  };
  ['content-type', 'authorization', 'cookie', 'range', 'accept-language'].forEach(k => { if (req.headers[k]) headers[k] = req.headers[k]; });
  return headers;
}

function sendCookies(res, upstream, sid) {
  const setCookies = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [];
  if (setCookies.length) res.set('Set-Cookie', setCookies.map(c => c.replace(/;\s*Domain=[^;]+/ig, '').replace(/;\s*Path=[^;]*/ig, '; Path=/__game/' + sid + '/')));
}

app.get('/__game/open', (req, res) => {
  let u; try { u = new URL(String(req.query.url || '')); } catch (_) { return res.status(400).send('Invalid game URL'); }
  if (!allowed(u)) return res.status(403).send('Game host is not allowed');
  const sid = crypto.randomBytes(12).toString('hex');
  sessions.set(sid, { origin: u.origin, createdAt: Date.now() });
  res.redirect(302, '/__game/' + sid + u.pathname + u.search);
});

// fetch/XHR from the proxied game may call another approved game host. Keep
// those requests on this origin too so browser CORS does not disable the engine.
app.all('/__game/:sid/__remote', express.raw({ type: '*/*', limit: '8mb' }), async (req, res) => {
  const sid = req.params.sid, s = sessions.get(sid);
  if (!s) return res.status(403).send('Invalid game session');
  let u; try { u = new URL(String(req.query.url || '')); } catch (_) { return res.status(400).send('Invalid upstream URL'); }
  if (!allowed(u) || !/^https:$/.test(u.protocol)) return res.status(403).send('Invalid upstream URL');
  try {
    const init = { method: req.method, headers: upstreamHeaders(req, u), redirect: 'manual' };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && req.body.length) init.body = req.body;
    const upstream = await fetch(u, init);
    const location = upstream.headers.get('location');
    if (location && upstream.status >= 300 && upstream.status < 400) {
      const next = new URL(location, u);
      if (!allowed(next)) return res.status(403).send('Invalid redirect URL');
      sendCookies(res, upstream, sid);
      return res.status(upstream.status).set('Location', '/__game/' + sid + '/__remote?url=' + encodeURIComponent(next.href)).end();
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status); res.type(upstream.headers.get('content-type') || 'application/octet-stream');
    ['content-range', 'accept-ranges', 'etag', 'last-modified'].forEach(k => { const v = upstream.headers.get(k); if (v) res.set(k, v); });
    res.set('Cache-Control', upstream.headers.get('cache-control') || 'no-store');
    sendCookies(res, upstream, sid); res.send(bytes);
  } catch (err) { res.status(502).send('遊戲資料載入失敗：' + String(err && err.message || err)); }
});

app.use('/__game/:sid/*', express.raw({ type: '*/*', limit: '8mb' }), async (req, res) => {
  const sid = req.params.sid, s = sessions.get(sid);
  if (!s) return res.status(403).send('Invalid game session');
  const tail = req.params[0] || '/';
  const query = new URL(req.originalUrl, 'http://local').search;
  const u = new URL((tail.startsWith('/') ? tail : '/' + tail) + query, s.origin + '/');
  if (!allowed(u)) return res.status(403).send('Invalid game session');
  try {
    const headers = upstreamHeaders(req, u);
    const init = { method: req.method, headers, redirect: 'manual' };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && req.body.length) init.body = req.body;
    const upstream = await fetch(u, init);
    const redirectLocation = upstream.headers.get('location');
    if (redirectLocation && upstream.status >= 300 && upstream.status < 400) {
      const next = new URL(redirectLocation, u);
      if (!allowed(next)) return res.status(403).send('Invalid redirect URL');
      s.origin = next.origin; sendCookies(res, upstream, sid);
      return res.status(upstream.status).set('Location', '/__game/' + sid + next.pathname + next.search).end();
    }
    const finalURL = new URL(upstream.url || u.href); if (allowed(finalURL)) s.origin = finalURL.origin;
    let bytes = Buffer.from(await upstream.arrayBuffer());
    const type = String(upstream.headers.get('content-type') || 'application/octet-stream');
    if (/text\/html|javascript|text\/css/.test(type)) {
      let body = bytes.toString('utf8'), prefix = '/__game/' + sid;
      body = body.replaceAll(s.origin, prefix);
      body = body.replace(/\b(src|href|action)=(['"])\/(?!\/|__game\/)/gi, (m, a, q) => a + '=' + q + prefix + '/');
      if (/text\/css/.test(type)) body = body.replace(/url\((['"]?)\/(?!\/|__game\/)/gi, 'url($1' + prefix + '/');
      if (/text\/html/.test(type)) {
        const boot = gameBoot(sid, finalURL.href);
        const head = '<head><base href="' + prefix + finalURL.pathname + '"><meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><style>html,body{margin:0!important;width:100%!important;height:100%!important;overflow:hidden!important;overscroll-behavior:none!important}</style>' + boot;
        body = body.replace(/<head(?:\s[^>]*)?>/i, head);
      }
      bytes = Buffer.from(body);
    }
    res.status(upstream.status); res.type(type); res.set('Cache-Control', upstream.headers.get('cache-control') || 'no-store');
    sendCookies(res, upstream, sid);
    res.send(bytes);
  } catch (err) {
    res.status(502).send('遊戲資源載入失敗：' + String(err && err.message || err));
  }
});

// These paths are WebSocket-only. A normal HTTP request gets an explicit
// response instead of falling through to index.html.
app.all(['/__socket/:sid', '/__lobby-socket'], (req, res) => res.status(426).send('WebSocket upgrade required'));

app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

setInterval(() => { const cutoff = Date.now() - 6 * 60 * 60 * 1000; for (const [id, s] of sessions) if (s.createdAt < cutoff) sessions.delete(id); }, 30 * 60 * 1000).unref();
const server = app.listen(process.env.PORT || 3000, '0.0.0.0');
const socketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });

function rejectUpgrade(socket, status, message) {
  if (socket.destroyed) return;
  const body = message || 'WebSocket connection rejected';
  socket.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
}

function bridgeSockets(client, upstream) {
  client.on('message', (data, binary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
  });
  upstream.on('message', (data, binary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
  });
  client.on('close', (code, reason) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close(code === 1005 ? 1000 : code, reason);
    else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
  });
  upstream.on('close', (code, reason) => {
    if (client.readyState === WebSocket.OPEN) client.close(code === 1005 ? 1000 : code, reason);
    else if (client.readyState === WebSocket.CONNECTING) client.terminate();
  });
  client.on('error', () => upstream.terminate());
  upstream.on('error', () => client.terminate());
}

server.on('upgrade', (req, socket, head) => {
  try {
    const m = String(req.url || '').match(/^\/__socket\/([a-f0-9]{24})(?:\?|$)/);
    const target = new URL(String(new URL(req.url, 'http://local').searchParams.get('url') || ''));
    const lobby = /^\/__lobby-socket(?:\?|$)/.test(String(req.url || ''));
    if ((!lobby && (!m || !sessions.has(m[1]))) || !allowed(target)) return rejectUpgrade(socket, '403 Forbidden');

    const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map(v => v.trim()).filter(Boolean);
    const headers = {};
    ['cookie', 'authorization', 'user-agent'].forEach(k => { if (req.headers[k]) headers[k] = req.headers[k]; });
    const options = { headers, perMessageDeflate: false, handshakeTimeout: 15000, maxPayload: 16 * 1024 * 1024 };
    if (websocketAgent) options.agent = websocketAgent;
    const upstream = protocols.length ? new WebSocket(target.href, protocols, options) : new WebSocket(target.href, options);
    let accepted = false;

    upstream.on('unexpected-response', (_ws, response) => {
      if (!accepted) rejectUpgrade(socket, '502 Bad Gateway', 'Upstream WebSocket returned HTTP ' + response.statusCode);
    });
    upstream.on('error', () => {
      if (!accepted) rejectUpgrade(socket, '502 Bad Gateway', 'Upstream WebSocket connection failed');
    });
    upstream.once('open', () => {
      if (socket.destroyed) return upstream.terminate();
      accepted = true;
      if (upstream.protocol) req.headers['sec-websocket-protocol'] = upstream.protocol;
      else delete req.headers['sec-websocket-protocol'];
      socketServer.handleUpgrade(req, socket, head, client => bridgeSockets(client, upstream));
    });
  } catch (_) { rejectUpgrade(socket, '400 Bad Request'); }
});
