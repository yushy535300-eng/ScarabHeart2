'use strict';

// These resources already redirect to the upstream game host. Resolve them in
// the HTML so the browser need not request a redirect from our server first.
function rewriteGameAssetHtml(html, documentUrl) {
  const base = new URL(documentUrl);
  if (!/^\/egames\/[a-f0-9]{40}\/game\//i.test(base.pathname)) return html;
  const directPath = /^\/egames\/[a-f0-9]{40}\/game\/(?:(?:assets|src|public|images|cocos-js)\/|(?:style\.css|game\.css|app\.js|index\.js|application\.js)$)/i;
  const mediaPath = /\.(?:png|jpe?g|gif|webp|svg|ico|mp3|ogg|wav|m4a|mp4|webm|woff2?|ttf|otf)$/i;
  function rewriteTag(tag) {
    return tag.replace(/(\s(?:src|href)\s*=\s*)(["'])(.*?)\2/gi, (all, lead, quote, raw) => {
      try {
        if (!raw || /^(?:#|data:|blob:)/i.test(raw)) return all;
        const url = new URL(raw.replace(/&amp;/gi, '&'), base);
        if (url.origin !== base.origin || !(directPath.test(url.pathname) || mediaPath.test(url.pathname))) return all;
        const encoded = url.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        return lead + quote + encoded + quote;
      } catch (_) { return all; }
    });
  }
  return html.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<(?:link|img|source)\b[^>]*>/gi, block => {
    if (block.startsWith('<!--')) return block;
    if (/^<script\b/i.test(block)) {
      const end = block.indexOf('>') + 1;
      return rewriteTag(block.slice(0, end)) + block.slice(end);
    }
    return rewriteTag(block);
  });
}
module.exports = { rewriteGameAssetHtml };
