process.on('unhandledRejection', (reason) => {
  try { console.error('[unhandledRejection]', reason); } catch (_) {}
});
process.on('uncaughtException', (error) => {
  try { console.error('[uncaughtException]', error); } catch (_) {}
});
'use strict';

const express = require('express');
const { WebSocket, WebSocketServer } = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const path = require('path');
const crypto = require('crypto');

const app = express();
const sessions = new Map();
const recommendationProxyCache = new Map();
const publicDir = path.join(__dirname, 'public');
const runtimeDir = path.join(__dirname, 'runtime');
const outboundProxy = process.env.WSS_PROXY || process.env.wss_proxy ||
  process.env.HTTPS_PROXY || process.env.https_proxy;
const websocketAgent = /^https?:\/\//i.test(String(outboundProxy || ''))
  ? new HttpsProxyAgent(outboundProxy)
  : undefined;

function gameAllowed(url) {
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'wss:')) return false;
  const host = url.hostname.toLowerCase();
  return host === 'godeebxp.com' || host.endsWith('.godeebxp.com');
}

function apiAllowed(url) {
  if (!url || url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'seth-eye.com' || host.endsWith('.seth-eye.com');
}

function apiUrl(req) {
  try {
    const url = new URL(String(req.query.url || ''));
    return apiAllowed(url) ? url : null;
  } catch (_) {
    return null;
  }
}

function decodePayload(raw) {
  try {
    const input = String(raw || '');
    if (!input || input.length > 180000) return null;
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload || payload.kind !== 'atg' || !payload.cfg ||
        typeof payload.cfg !== 'object' || Array.isArray(payload.cfg)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

app.disable('x-powered-by');
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, version: '2.57-atg-direct-base' });
});

app.use('/__api', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const url = apiUrl(req);
  if (!url) return res.status(403).json({ ok: false, error: 'API host is not allowed' });
  try {
    const isBoardsGet = req.method === 'GET' && /\/api\/copilot\/boards$/i.test(url.pathname);
    const cacheKey = isBoardsGet ? url.href : '';
    const cached = cacheKey ? recommendationProxyCache.get(cacheKey) : null;
    if (cached && Date.now() - cached.at < 15000) {
      res.status(200);
      res.type(cached.type || 'application/json');
      res.set('Cache-Control', 'private, max-age=5');
      return res.send(cached.bytes);
    }

    const headers = {
      accept: req.headers.accept || 'application/json',
      'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 Chrome/126 Safari/537.36',
      origin: url.origin,
      referer: url.origin + '/'
    };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.headers['x-copilot-key']) headers['x-copilot-key'] = req.headers['x-copilot-key'];
    const init = { method: req.method, headers, redirect: 'follow' };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && req.body.length) {
      init.body = req.body;
    }
    const upstream = await fetch(url, init);
    const bytes = Buffer.from(await upstream.arrayBuffer());
    const responseType = upstream.headers.get('content-type') || 'application/octet-stream';

    if (isBoardsGet && upstream.status >= 429 && cached && Date.now() - cached.at < 10 * 60 * 1000) {
      res.status(200);
      res.type(cached.type || 'application/json');
      res.set('X-Scarab-Recommendation-Cache', 'stale');
      res.set('Cache-Control', 'private, no-store');
      return res.send(cached.bytes);
    }
    if (isBoardsGet && upstream.ok && /application\/json/i.test(responseType)) {
      recommendationProxyCache.set(cacheKey, {at:Date.now(), bytes, type:responseType});
    }

    res.status(upstream.status);
    res.type(responseType);
    res.set('Cache-Control', upstream.headers.get('cache-control') || 'no-store');
    res.send(bytes);
  } catch (error) {
    res.status(502).json({
      ok: false,
      error: '上游服務連線失敗',
      detail: String(error && error.message || error)
    });
  }
});

// Only the three ATG runtime files required by the in-app game are exposed.
app.get('/__runtime/atg-engine-runtime.js', (_req, res) => {
  res.sendFile(path.join(runtimeDir, 'atg-engine-runtime.js'));
});
app.get('/__runtime/atg-live-adapter.js', (_req, res) => {
  res.sendFile(path.join(runtimeDir, 'atg-live-adapter.js'));
});
app.get('/__runtime/overlay-runtime.js', (_req, res) => {
  res.sendFile(path.join(runtimeDir, 'overlay-runtime.js'));
});
app.get('/__runtime/bootstrap-runtime.js', (_req, res) => {
  res.sendFile(path.join(runtimeDir, 'bootstrap-runtime.js'));
});
app.get('/__runtime/stability-runtime.js', (_req, res) => {
  res.sendFile(path.join(runtimeDir, 'stability-runtime.js'));
});

function gameBoot(sid, originalHref, session, withRuntime) {
  const prefix = '/__game/' + sid;
  const payload = session.payload || { kind: 'atg', gameCode: '', cfg: {} };
  const config = payload.cfg || {};
  const proxyBoot = '<script>window.__SCARAB_ORIGINAL_URL=' + scriptJson(originalHref) +
    ';window.__SCARAB_PROXY_PREFIX=' + scriptJson(prefix) +
    ';(function(){var O=window.__SCARAB_ORIGINAL_URL,P=' + scriptJson(prefix) +
    ';function A(x){var h=x.hostname.toLowerCase();return h==="godeebxp.com"||/\\.godeebxp\\.com$/.test(h)}' +
    'function S(x){var p=x.pathname;return /^\/egames\/[a-f0-9]{40}\/game\/(?:assets|src|public|images|cocos-js)\//i.test(p)||/^\/egames\/[a-f0-9]{40}\/game\/(?:style\.css|game\.css|app\.js|index\.js|application\.js)$/i.test(p)||/\.(?:js|mjs|css|json|png|jpe?g|gif|webp|svg|ico|mp3|ogg|wav|m4a|mp4|webm|woff2?|ttf|otf|bin|wasm)(?:$|\?)/i.test(p+x.search)}' +
    'function U(raw){try{var str=String(raw),x=new URL(str,document.baseURI||O),here=location.origin;if(x.origin===here){var m=x.pathname.match(/^\/__game\/[a-f0-9]{24}(\/.*)$/i);if(m)x=new URL(m[1]+x.search,O);else if(/^\/(?:slotFramework|egames)\//i.test(x.pathname))x=new URL(x.pathname+x.search,O)}return x}catch(e){return null}}' +
    'function H(raw){try{var x=U(raw);if(x&&/^https?:$/.test(x.protocol)&&A(x)){if(/^\/slotFramework\//i.test(x.pathname)){if(/^\/slotFramework\/manifest\.json$/i.test(x.pathname))return location.origin+x.pathname+x.search;return x.href}if(S(x))return x.href;return location.origin+P+"/__remote?url="+encodeURIComponent(x.href)}}catch(e){}return raw}' +
    'function D(raw){try{var x=U(raw);if(x&&A(x)&&(/^\/slotFramework\//i.test(x.pathname)||S(x)))return x.href}catch(e){}return raw}' +
    'var F=window.fetch;if(F)window.fetch=function(i,n){var raw=typeof i==="string"?i:(i&&i.url)||String(i),u=H(raw);try{if(i instanceof Request&&u!==raw)i=new Request(u,i);else if(u!==raw)i=u}catch(e){i=u}return F.call(this,i,n)};' +
    'var XO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=H(u);return XO.apply(this,arguments)};' +
    'var SA=Element.prototype.setAttribute;Element.prototype.setAttribute=function(k,v){try{if(/^(?:src|href)$/i.test(String(k)))v=D(v)}catch(e){}return SA.call(this,k,v)};' +
    'function PS(C,k){try{var d=Object.getOwnPropertyDescriptor(C.prototype,k);if(!d||!d.set||!d.get)return;Object.defineProperty(C.prototype,k,{configurable:d.configurable,enumerable:d.enumerable,get:d.get,set:function(v){return d.set.call(this,D(v))}})}catch(e){}}' +
    '[HTMLImageElement,HTMLScriptElement,HTMLLinkElement,HTMLAudioElement,HTMLVideoElement,HTMLSourceElement].forEach(function(C){if(C)PS(C,C===HTMLLinkElement?"href":"src")});' +
    'try{var FP=window.HTMLFormElement&&HTMLFormElement.prototype,fd=FP&&Object.getOwnPropertyDescriptor(FP,"action");if(fd&&fd.get&&fd.set){Object.defineProperty(FP,"action",{configurable:true,enumerable:fd.enumerable,get:fd.get,set:function(v){try{var x=U(v);if(x&&A(x))return fd.set.call(this,location.origin+P+x.pathname+x.search)}catch(e){}return fd.set.call(this,v)}})}}catch(e){}' +
    'try{document.addEventListener("click",function(ev){var a=ev.target&&ev.target.closest&&ev.target.closest("a[href]");if(!a)return;try{var x=U(a.getAttribute("href"));if(x&&A(x)&&!S(x)&&!/^\/slotFramework\//i.test(x.pathname))a.setAttribute("href",P+x.pathname+x.search)}catch(e){}},true)}catch(e){}' +
    'if(window.Worker){var W=window.Worker;window.Worker=function(u,o){return new W(D(u),o)};window.Worker.prototype=W.prototype}' +
    'if(window.SharedWorker){var SW=window.SharedWorker;window.SharedWorker=function(u,o){return new SW(D(u),o)};window.SharedWorker.prototype=SW.prototype}' +
    'if(window.EventSource){var ES=window.EventSource;window.EventSource=function(u,o){return new ES(H(u),o)};window.EventSource.prototype=ES.prototype}' +
    'if(navigator.sendBeacon){var SB=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){return SB(H(u),d)}}' +
    'var N=window.WebSocket;window.WebSocket=function(u,p){try{var x=new URL(u,O);if(/^wss?:$/.test(x.protocol)&&A(x)){var q=(location.protocol==="https:"?"wss:":"ws:")+"//"+location.host+"/__socket/' + sid + '?url="+encodeURIComponent(x.href);return p?new N(q,p):new N(q)}}catch(e){}return p?new N(u,p):new N(u)};window.WebSocket.prototype=N.prototype;Object.keys(N).forEach(function(k){try{window.WebSocket[k]=N[k]}catch(e){}});["CONNECTING","OPEN","CLOSING","CLOSED"].forEach(function(k){try{Object.defineProperty(window.WebSocket,k,{value:N[k],configurable:true})}catch(e){}});' +
    '})();<\/script>';

  if (!withRuntime) return proxyBoot;

  const runtimeBoot = '<script>' +
    'window.__SCARAB_WEB_ACTIVE=true;' +
    'window.__SCARAB_WEB_PAYLOAD=' + scriptJson(payload) + ';' +
    'window.__SC_GAME_CODE=' + scriptJson(String(payload.gameCode || config.GAME_CODE || '')) + ';' +
    'window.__SC_GOOD_ROOMS=' + scriptJson(config.GOOD_ROOMS || []) + ';' +
    'window.__SC_ROOM_SESSION_ID=' + scriptJson(String(config.ROOM_SESSION_ID || '')) + ';' +
    'window.__SCARAB_FORCE_MANUAL_ROOM=false;' +
    'try{parent.postMessage({__scarabStatus:true,state:"engine-wait"},location.origin)}catch(e){}' +
    '<\/script>' +
    '<script>(function(){var s=document.createElement("script");s.src=location.origin+"/__runtime/bootstrap-runtime.js";s.defer=true;(document.head||document.documentElement).appendChild(s)})()<\/script>';
  return proxyBoot + runtimeBoot;
}

function upstreamHeaders(req, url, sessionOrigin) {
  const origin = sessionOrigin || url.origin;
  const headers = {
    accept: req.headers.accept || '*/*',
    'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 Chrome/126 Safari/537.36',
    origin,
    referer: origin + '/'
  };
  ['content-type', 'authorization', 'cookie', 'range', 'accept-language'].forEach(key => {
    if (req.headers[key]) headers[key] = req.headers[key];
  });
  return headers;
}

function sendCookies(res, upstream, sid) {
  const cookies = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [];
  if (!cookies.length) return;
  res.set('Set-Cookie', cookies.map(cookie => cookie
    .replace(/;\s*Domain=[^;]+/ig, '')
    .replace(/;\s*Path=[^;]*/ig, '; Path=/__game/' + sid + '/')));
}

app.get('/__game/open', (req, res) => {
  let url;
  try { url = new URL(String(req.query.url || '')); }
  catch (_) { return res.status(400).send('Invalid game URL'); }
  if (!gameAllowed(url) || url.protocol !== 'https:') {
    return res.status(403).send('Game host is not allowed');
  }
  const payload = decodePayload(req.query.cfg);
  if (!payload) return res.status(400).send('Invalid game configuration');
  const sid = crypto.randomBytes(12).toString('hex');
  sessions.set(sid, {
    origin: url.origin,
    createdAt: Date.now(),
    payload,
    documentReady: false,
    lastGoodDocumentUrl: ''
  });
  res.redirect(302, '/__game/' + sid + url.pathname + url.search);
});

app.all('/__game/:sid/__remote', express.raw({ type: '*/*', limit: '16mb' }), async (req, res) => {
  const sid = req.params.sid;
  const session = sessions.get(sid);
  if (!session) return res.status(403).send('Invalid game session');
  let url;
  try { url = new URL(String(req.query.url || '')); }
  catch (_) { return res.status(400).send('Invalid upstream URL'); }
  if (!gameAllowed(url) || url.protocol !== 'https:') {
    return res.status(403).send('Invalid upstream URL');
  }
  try {
    const init = {
      method: req.method,
      headers: upstreamHeaders(req, url, session.origin),
      redirect: 'manual'
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && req.body.length) {
      init.body = req.body;
    }
    const upstream = await fetch(url, init);
    const remoteDest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
    const remoteIsDocument = remoteDest === 'document' ||
      /text\/html/i.test(String(req.headers.accept || ''));
    if (remoteIsDocument && session.documentReady && upstream.status >= 500) {
      try { if (upstream.body && upstream.body.cancel) await upstream.body.cancel(); } catch (_) {}
      console.warn('[ATG_REMOTE_NAV_BLOCK]', sid, upstream.status, url.href);
      res.set('X-Scarab-Recovered-From', String(upstream.status));
      res.set('Cache-Control', 'no-store');
      return res.status(204).end();
    }
    const location = upstream.headers.get('location');
    if (location && upstream.status >= 300 && upstream.status < 400) {
      const next = new URL(location, url);
      if (!gameAllowed(next)) return res.status(403).send('Invalid redirect URL');
      sendCookies(res, upstream, sid);
      return res.status(upstream.status)
        .set('Location', '/__game/' + sid + '/__remote?url=' + encodeURIComponent(next.href))
        .end();
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.type(upstream.headers.get('content-type') || 'application/octet-stream');
    ['content-range', 'accept-ranges', 'etag', 'last-modified'].forEach(key => {
      const value = upstream.headers.get(key);
      if (value) res.set(key, value);
    });
    res.set('Cache-Control', upstream.headers.get('cache-control') || 'no-store');
    sendCookies(res, upstream, sid);
    res.send(bytes);
  } catch (error) {
    res.status(502).send('遊戲資料載入失敗：' + String(error && error.message || error));
  }
});

app.use('/__game/:sid/*', express.raw({ type: '*/*', limit: '16mb' }), async (req, res) => {
  const sid = req.params.sid;
  const session = sessions.get(sid);
  if (!session) return res.status(403).send('Invalid game session');
  const tail = req.params[0] || '/';
  const query = new URL(req.originalUrl, 'http://local').search;
  const url = new URL((tail.startsWith('/') ? tail : '/' + tail) + query, session.origin + '/');
  if (!gameAllowed(url)) return res.status(403).send('Invalid game session');

  try {
    const dest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
    const isDocumentRequest = dest === 'document' ||
      /text\/html/i.test(String(req.headers.accept || ''));
    const mediaExt = /\.(?:png|jpe?g|gif|webp|svg|ico|mp3|ogg|wav|m4a|mp4|webm|woff2?|ttf|otf)(?:$|\?)/i.test(url.pathname + url.search);
    const isSlotFramework = /^\/slotFramework\//i.test(url.pathname);
    const directStatic =
      /^\/egames\/[a-f0-9]{40}\/game\/(?:assets|src|public|images|cocos-js)\//i.test(url.pathname) ||
      /^\/egames\/[a-f0-9]{40}\/game\/(?:style\.css|game\.css|app\.js|index\.js|application\.js)$/i.test(url.pathname);
    if ((req.method === 'GET' || req.method === 'HEAD') &&
        (directStatic || dest === 'image' || dest === 'audio' || dest === 'video' || dest === 'font' || mediaExt)) {
      return res.redirect(302, url.href);
    }
    const init = {
      method: req.method,
      headers: upstreamHeaders(req, url, session.origin),
      redirect: 'manual'
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && req.body.length) {
      init.body = req.body;
    }
    const upstream = await fetch(url, init);

    // ATG room changes can occasionally trigger a secondary document navigation
    // that returns nginx 500/502/503. Normal manual room selection in the user's
    // HAR completes over WebSocket (getSlotTableDetail -> updateSlotTable) and
    // does not require replacing the current game document. Once a healthy game
    // document is already running, cancel only those later 5xx navigations.
    if (isDocumentRequest && session.documentReady && upstream.status >= 500) {
      try { if (upstream.body && upstream.body.cancel) await upstream.body.cancel(); } catch (_) {}
      console.warn('[ATG_NAV_BLOCK]', sid, upstream.status, url.href);
      res.set('X-Scarab-Recovered-From', String(upstream.status));
      res.set('Cache-Control', 'no-store');
      return res.status(204).end();
    }

    const redirectLocation = upstream.headers.get('location');
    if (redirectLocation && upstream.status >= 300 && upstream.status < 400) {
      const next = new URL(redirectLocation, url);
      if (!gameAllowed(next)) return res.status(403).send('Invalid redirect URL');
      sendCookies(res, upstream, sid);
      const isDocument = isDocumentRequest;
      // Only a real page navigation may change the session's document origin.
      // A cross-host asset redirect must keep its full origin encoded, or later
      // relative game requests would accidentally be sent to the asset host.
      if (!isDocument && next.origin !== session.origin) {
        return res.status(upstream.status)
          .set('Location', '/__game/' + sid + '/__remote?url=' + encodeURIComponent(next.href))
          .end();
      }
      if (isDocument) session.origin = next.origin;
      return res.status(upstream.status)
        .set('Location', '/__game/' + sid + next.pathname + next.search)
        .end();
    }

    const finalUrl = new URL(upstream.url || url.href);
    let bytes = Buffer.from(await upstream.arrayBuffer());
    const type = String(upstream.headers.get('content-type') || 'application/octet-stream');
    if (isDocumentRequest && upstream.status >= 200 && upstream.status < 400 &&
        /text\/html/i.test(type)) {
      session.documentReady = true;
      session.lastGoodDocumentUrl = finalUrl.href;
    }
    if (!isSlotFramework && /text\/html/i.test(type)) {
      let body = bytes.toString('utf8');
      body = body
        .replace(/<meta\b[^>]*http-equiv=(['"])Content-Security-Policy\1[^>]*>/gi, '')
        .replace(/\s+integrity=(['"])[^'"]*\1/gi, '')
        .replace(/<base\b[^>]*>/gi, '');
      const isLobby = /\/egames\/lobby\//i.test(finalUrl.pathname);
      const boot = gameBoot(sid, finalUrl.href, session, !isLobby);
      // Keep document navigation inside the session proxy.
      // Static assets are already rewritten to the real ATG origin by D()/H()
      // and server directStatic/slotFramework handling. A remote <base> caused
      // room-confirm/navigation actions to bypass the proxy and hit raw ATG nginx 500.
      const remoteDir = new URL('.', finalUrl).pathname;
      const proxyBase = '/__game/' + sid + remoteDir;
      const head = '<head><base href="' + proxyBase.replace(/"/g, '&quot;') + '">' +
        '<meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">' +
        '<style>html,body{margin:0!important;width:100%!important;height:100%!important;overflow:hidden!important;overscroll-behavior:none!important}</style>' +
        boot;
      if (/<head(?:\s[^>]*)?>/i.test(body)) body = body.replace(/<head(?:\s[^>]*)?>/i, head);
      else body = head + body;
      bytes = Buffer.from(body);
    }
    res.status(upstream.status);
    res.type(type);
    res.set('Cache-Control', upstream.headers.get('cache-control') || 'no-store');
    sendCookies(res, upstream, sid);
    res.send(bytes);
  } catch (error) {
    res.status(502).send('遊戲資源載入失敗：' + String(error && error.message || error));
  }
});

app.all(['/__socket/:sid', '/__lobby-socket'], (_req, res) => {
  res.status(426).send('WebSocket upgrade required');
});

// ATG's manifest does not advertise cross-origin access, so keep only that
// tiny bootstrap JSON on our same-origin bridge. All versioned slotFramework
// assets (config/index/import/native/...) are CORS-enabled by ATG and must go
// straight to play.godeebxp.com; proxying hundreds of them through Render
// causes 502/503 bursts followed by 429 throttling.
app.all('/slotFramework/*', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  let sid = '';
  try {
    const ref = String(req.headers.referer || '');
    const match = ref.match(/\/__game\/([a-f0-9]{24})\//i);
    if (match) sid = match[1];
  } catch (_) {}
  const session = sid && sessions.get(sid);
  if (!session) return res.status(409).send('ATG session not ready');

  let url;
  try { url = new URL(req.originalUrl, 'https://play.godeebxp.com/'); }
  catch (_) { return res.status(400).send('Invalid slotFramework URL'); }

  const isManifest = /^\/slotFramework\/manifest\.json$/i.test(url.pathname);

  // Never make Render download versioned ATG framework/assets.
  if (!isManifest && (req.method === 'GET' || req.method === 'HEAD')) {
    const direct = 'https://play.godeebxp.com' + url.pathname + url.search;
    res.set('Cache-Control', 'public, max-age=300');
    return res.redirect(307, direct);
  }

  // Only the tiny manifest stays bridged.
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: upstreamHeaders(req, url, 'https://play.godeebxp.com'),
      redirect: 'follow'
    });
    let bytes = Buffer.from(await upstream.arrayBuffer());
    let contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    if (isManifest && upstream.ok) {
      try {
        const manifest = JSON.parse(bytes.toString('utf8'));
        if (manifest && typeof manifest.url === 'string') {
          let raw = manifest.url.trim();
          if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw.replace(/^\/+/, '');
          manifest.url = new URL(raw).href.replace(/\/$/, '');
        }
        bytes = Buffer.from(JSON.stringify(manifest));
        contentType = 'application/json; charset=utf-8';
      } catch (_) {}
    }
    res.status(upstream.status);
    res.type(contentType);
    res.set('Cache-Control', 'no-store');
    res.send(bytes);
  } catch (error) {
    res.status(502).send('ATG manifest 載入失敗：' + String(error && error.message || error));
  }
});

app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
}, 30 * 60 * 1000).unref();

const server = app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('ScarabHeart ATG web service listening on ' + (process.env.PORT || 3000));
});
const socketServer = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  maxPayload: 16 * 1024 * 1024
});

function rejectUpgrade(socket, status, message) {
  if (socket.destroyed) return;
  const body = message || 'WebSocket connection rejected';
  socket.end('HTTP/1.1 ' + status +
    '\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ' +
    Buffer.byteLength(body) + '\r\n\r\n' + body);
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
    const requestUrl = String(req.url || '');
    const match = requestUrl.match(/^\/__socket\/([a-f0-9]{24})(?:\?|$)/);
    const lobby = /^\/__lobby-socket(?:\?|$)/.test(requestUrl);
    const session = match ? sessions.get(match[1]) : null;
    const target = new URL(String(new URL(requestUrl, 'http://local').searchParams.get('url') || ''));
    if ((!lobby && (!match || !session)) || !gameAllowed(target)) {
      return rejectUpgrade(socket, '403 Forbidden');
    }

    const protocols = String(req.headers['sec-websocket-protocol'] || '')
      .split(',').map(value => value.trim()).filter(Boolean);
    const headers = {};
    ['cookie', 'authorization', 'user-agent'].forEach(key => {
      if (req.headers[key]) headers[key] = req.headers[key];
    });
    // HAR proves ATG rejects the proxy socket unless Origin is the play site.
    const origin = lobby ? 'https://play.godeebxp.com' : session.origin;
    const options = {
      headers,
      origin,
      perMessageDeflate: false,
      handshakeTimeout: 15000,
      maxPayload: 16 * 1024 * 1024
    };
    if (websocketAgent) options.agent = websocketAgent;
    const upstream = protocols.length
      ? new WebSocket(target.href, protocols, options)
      : new WebSocket(target.href, options);
    let accepted = false;

    upstream.on('unexpected-response', (_ws, response) => {
      if (!accepted) rejectUpgrade(socket, '502 Bad Gateway',
        'Upstream WebSocket returned HTTP ' + response.statusCode);
    });
    upstream.on('error', () => {
      if (!accepted) rejectUpgrade(socket, '502 Bad Gateway',
        'Upstream WebSocket connection failed');
    });
    upstream.once('open', () => {
      if (socket.destroyed) return upstream.terminate();
      accepted = true;
      if (upstream.protocol) req.headers['sec-websocket-protocol'] = upstream.protocol;
      else delete req.headers['sec-websocket-protocol'];
      socketServer.handleUpgrade(req, socket, head, client => {
        bridgeSockets(client, upstream);
      });
    });
  } catch (_) {
    rejectUpgrade(socket, '400 Bad Request');
  }
});
