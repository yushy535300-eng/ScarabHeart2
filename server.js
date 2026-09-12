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

app.get('/healthz', (req, res) => res.status(200).json({ ok: true, version: '2.47' }));

const apiProxy = createProxyMiddleware({
  target: 'https://seth-eye.com', changeOrigin: true, secure: true,
  router: req => { const u = apiURL(req); return u ? u.origin : 'https://seth-eye.com'; },
  pathRewrite: (p, req) => { const u = apiURL(req); return u ? u.pathname + u.search : '/'; },
  on: {
    proxyReq: (proxyReq, req) => {
      const u = apiURL(req); if (!u) return proxyReq.destroy();
      proxyReq.setHeader('origin', u.origin);
      proxyReq.setHeader('referer', u.origin + '/');
    },
    proxyRes: (proxyRes) => {
      delete proxyRes.headers['access-control-allow-origin'];
      delete proxyRes.headers['content-security-policy'];
    }
  }
});

app.use('/__api', (req, res, next) => {
  if (!apiURL(req)) return res.status(403).json({ ok: false, error: 'API host is not allowed' });
  next();
}, apiProxy);

function session(req) { return sessions.get(req.params.sid); }
function proxyPrefix(req) { return '/__game/' + req.params.sid; }
function originalURL(req) {
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

app.use('/__game/:sid/*', (req, res, next) => {
  const u = originalURL(req); if (!u || !allowed(u)) return res.status(403).send('Invalid game session');
  next();
}, gameProxy);

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
