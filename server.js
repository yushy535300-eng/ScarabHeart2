'use strict';
const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const path = require('path');
const crypto = require('crypto');

const app = express();
const sessions = new Map();
const publicDir = path.join(__dirname, 'public');

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
    h === 'tz6868.cc' || h.endsWith('.tz6868.cc');
}

function apiURL(req) {
  try {
    const u = new URL(String(req.query.url || ''));
    return apiAllowed(u) ? u : null;
  } catch (_) { return null; }
}

app.get('/healthz', (req, res) => res.status(200).json({ ok: true, version: '2.48' }));

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

function session(req) { return req.scarabSession || sessions.get(req.scarabSid || (req.params && req.params.sid)); }
function proxyPrefix(req) { return '/__game/' + (req.scarabSid || (req.params && req.params.sid)); }
function originalURL(req) {
  if (req.scarabURL) return req.scarabURL;
  const s = session(req); if (!s) return null;
  const tail = req.params[0] || '/';
  return new URL(tail + (req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : ''), s.origin);
}

app.get('/__game/open', (req, res) => {
  let u; try { u = new URL(String(req.query.url || '')); } catch (_) { return res.status(400).send('Invalid game URL'); }
  if (!allowed(u)) return res.status(403).send('Game host is not allowed');
  const sid = crypto.randomBytes(12).toString('hex');
  sessions.set(sid, { origin: u.origin, createdAt: Date.now() });
  res.redirect(302, '/__game/' + sid + u.pathname + u.search);
});

const gameProxy = createProxyMiddleware({
  target: 'https://tz6868.cc', changeOrigin: true, ws: true, secure: true, selfHandleResponse: true,
  router: req => { const u = originalURL(req); return u ? u.origin : 'https://tz6868.cc'; },
  pathRewrite: (p, req) => { const u = originalURL(req); return u ? u.pathname + u.search : '/'; },
  on: {
    proxyReq: (proxyReq, req) => {
      const u = originalURL(req); if (!u || !allowed(u)) return proxyReq.destroy();
      proxyReq.setHeader('origin', u.origin); proxyReq.setHeader('referer', u.origin + '/');
    },
    proxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
      const s = session(req); if (!s) return buffer;
      const location = proxyRes.headers.location;
      if (location) {
        const next = new URL(location, s.origin);
        if (allowed(next)) { s.origin = next.origin; proxyRes.headers.location = proxyPrefix(req) + next.pathname + next.search; }
      }
      const type = String(proxyRes.headers['content-type'] || '');
      if (!/text\/html|javascript|text\/css/.test(type)) return buffer;
      let text = buffer.toString('utf8');
      const prefix = proxyPrefix(req);
      text = text.replaceAll(s.origin, prefix);
      if (/text\/html/.test(type)) {
        const original = originalURL(req);
        req.params = req.params || {}; req.params.sid = req.scarabSid;
        const boot = '<script>window.__SCARAB_ORIGINAL_URL=' + JSON.stringify(original ? original.href : s.origin) + ';(function(){var N=window.WebSocket;window.WebSocket=function(u,p){try{var x=new URL(u,window.__SCARAB_ORIGINAL_URL);if(/^wss?:$/.test(x.protocol)){var q=(location.protocol===\"https:\"?\"wss:\":\"ws:\")+\"//\"+location.host+\"/__socket/' + req.params.sid + '?url=\"+encodeURIComponent(x.href);return p?new N(q,p):new N(q)}}catch(e){}return p?new N(u,p):new N(u)};window.WebSocket.prototype=N.prototype;Object.keys(N).forEach(function(k){try{window.WebSocket[k]=N[k]}catch(e){}})})();<\/script>';
        const head = '<head><base href="' + prefix + '/"><meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><style>html,body{margin:0!important;width:100%!important;height:100%!important;overflow:hidden!important;overscroll-behavior:none!important}</style>' + boot;
        text = text.replace(/<head(?:\s[^>]*)?>/i, head);
      }
      proxyRes.headers['content-length'] = Buffer.byteLength(text);
      delete proxyRes.headers['content-security-policy']; delete proxyRes.headers['x-frame-options'];
      return text;
    })
  }
});

app.use('/__game/:sid/*', express.raw({ type: '*/*', limit: '8mb' }), async (req, res) => {
  const sid = req.params.sid, s = sessions.get(sid);
  if (!s) return res.status(403).send('Invalid game session');
  const tail = req.params[0] || '/';
  const u = new URL(tail + (req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : ''), s.origin);
  if (!allowed(u)) return res.status(403).send('Invalid game session');
  try {
    const headers = { accept: req.headers.accept || '*/*', 'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 Chrome/126 Safari/537.36', origin: u.origin, referer: u.origin + '/' };
    ['content-type','authorization','cookie','range','accept-language','accept-encoding'].forEach(k => { if (req.headers[k]) headers[k] = req.headers[k]; });
    const init = { method: req.method, headers, redirect: 'follow' };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && req.body.length) init.body = req.body;
    const upstream = await fetch(u, init);
    const finalURL = new URL(upstream.url || u.href); if (allowed(finalURL)) s.origin = finalURL.origin;
    let bytes = Buffer.from(await upstream.arrayBuffer());
    const type = String(upstream.headers.get('content-type') || 'application/octet-stream');
    if (/text\/html|javascript|text\/css/.test(type)) {
      let body = bytes.toString('utf8'), prefix = '/__game/' + sid;
      body = body.replaceAll(s.origin, prefix);
      if (/text\/html/.test(type)) {
        const boot = '<script>window.__SCARAB_ORIGINAL_URL=' + JSON.stringify(finalURL.href) + ';(function(){var N=window.WebSocket;window.WebSocket=function(u,p){try{var x=new URL(u,window.__SCARAB_ORIGINAL_URL);if(/^wss?:$/.test(x.protocol)){var q=(location.protocol==="https:"?"wss:":"ws:")+"//"+location.host+"/__socket/' + sid + '?url="+encodeURIComponent(x.href);return p?new N(q,p):new N(q)}}catch(e){}return p?new N(u,p):new N(u)};window.WebSocket.prototype=N.prototype})();<\/script>';
        const head = '<head><base href="' + prefix + '/"><meta name="viewport" content="width=device-width,height=device-height,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><style>html,body{margin:0!important;width:100%!important;height:100%!important;overflow:hidden!important;overscroll-behavior:none!important}</style>' + boot;
        body = body.replace(/<head(?:\s[^>]*)?>/i, head);
      }
      bytes = Buffer.from(body);
    }
    res.status(upstream.status); res.type(type); res.set('Cache-Control', upstream.headers.get('cache-control') || 'no-store');
    const setCookies = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : [];
    if (setCookies.length) res.set('Set-Cookie', setCookies.map(c => c.replace(/;\s*Domain=[^;]+/ig, '').replace(/;\s*Path=[^;]*/ig, '; Path=/__game/' + sid + '/')));
    res.send(bytes);
  } catch (err) {
    res.status(502).send('遊戲資源載入失敗：' + String(err && err.message || err));
  }
});

const socketProxy = createProxyMiddleware({
  target: 'wss://socket.godeebxp.com', changeOrigin: true, ws: true, secure: true,
  router: req => { try { const u = new URL(String(new URL(req.url, 'http://local').searchParams.get('url') || '')); return allowed(u) ? u.origin.replace(/^http/, 'ws') : 'wss://socket.godeebxp.com'; } catch (_) { return 'wss://socket.godeebxp.com'; } },
  pathRewrite: p => { try { const u = new URL(String(new URL(p, 'http://local').searchParams.get('url') || '')); return u.pathname + u.search; } catch (_) { return '/'; } }
});
app.use('/__socket/:sid', socketProxy);

app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

setInterval(() => { const cutoff = Date.now() - 6 * 60 * 60 * 1000; for (const [id, s] of sessions) if (s.createdAt < cutoff) sessions.delete(id); }, 30 * 60 * 1000).unref();
app.listen(process.env.PORT || 3000, '0.0.0.0');
