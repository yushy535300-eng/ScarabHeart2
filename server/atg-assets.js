'use strict';

// ATG's JSON, WebGL textures and framework assets do not advertise CORS.
// Keep them same-origin, deduplicate downloads and bound memory/concurrency.
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ITEM = 4 * 1024 * 1024;
const cache = new Map();
const pending = new Map();
let bytesUsed = 0;
let active = 0;
const queue = [];

function isAtgAsset(url) {
  return /^\/(?:egames\/(?:[a-f0-9]{40}|lobby)\/game\/|slotFramework\/|images\/|avatars\/)/i.test(url.pathname) &&
    /\.(?:js|mjs|json|css|png|jpe?g|webp|gif|svg|ico|mp3|ogg|wav|m4a|mp4|webm|woff2?|ttf|otf|bin|wasm|cconb|atlas|plist|ktx2?|pvr|astc)$/i.test(url.pathname);
}

async function limited(task) {
  if (active >= 8) await new Promise(resolve => queue.push(resolve));
  else active++;
  try { return await task(); }
  finally { const next = queue.shift(); if (next) next(); else active--; }
}

async function serveAtgAsset(req, res, url, origin) {
  if (req.method !== 'GET' || req.headers.range || !isAtgAsset(url)) return false;
  const key = url.href;
  const versioned = /^\/(?:egames\/[a-f0-9]{40}\/game\/|slotFramework\/[a-f0-9]{40}\/)/i.test(url.pathname) && !url.search;
  let item = versioned && cache.get(key);
  if (item) { cache.delete(key); cache.set(key, item); }
  if (!item) {
    let work = pending.get(key);
    if (!work) {
      work = limited(async () => {
        const upstream = await fetch(url, {
          headers: { accept: '*/*', origin, referer: origin + '/' },
          redirect: 'manual', signal: AbortSignal.timeout(30000)
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        const result = { status: upstream.status, type: upstream.headers.get('content-type') || 'application/octet-stream', body };
        if (versioned && result.status === 200 && body.length <= MAX_ITEM && !/text\/html/i.test(result.type)) {
          while (bytesUsed + body.length > MAX_BYTES && cache.size) {
            const first = cache.keys().next().value;
            bytesUsed -= cache.get(first).body.length;
            cache.delete(first);
          }
          cache.set(key, result); bytesUsed += body.length;
        }
        return result;
      });
      pending.set(key, work);
    }
    try { item = await work; }
    finally { if (pending.get(key) === work) pending.delete(key); }
  }
  // Never send an unvalidated upstream redirect back to a CORS fetch.
  if (item.status >= 300 && item.status < 400) {
    res.status(502).type('text/plain').send('ATG 資源入口已變更，請重新進入遊戲');
  } else {
    res.status(item.status).type(item.type).set('Cache-Control', item.status === 200 && versioned ? 'public, max-age=300' : 'no-store').send(item.body);
  }
  return true;
}

module.exports = { isAtgAsset, serveAtgAsset };
