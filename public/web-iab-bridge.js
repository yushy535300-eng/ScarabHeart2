/* ScarabHeart Render web game window bridge.
   The game is loaded through the same-origin /__game proxy. This is required:
   browsers do not allow executeScript/eval inside a third-party cross-origin frame. */
(function () {
  'use strict';
  var nativeFetch = window.fetch.bind(window);
  window.__SCARAB_PROXY_MODE = true;

  function needsApiProxy(raw) {
    try {
      var u = new URL(raw, location.href), h = u.hostname.toLowerCase();
      return u.origin !== location.origin &&
        (h === 'seth-eye.com' || /\.seth-eye\.com$/.test(h) ||
          h === 'tz6868.cc' || /\.tz6868\.cc$/.test(h) ||
          h === 'ofa1188.net' || /\.ofa1188\.net$/.test(h));
    } catch (_) { return false; }
  }

  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url) || '';
    if (needsApiProxy(raw)) return nativeFetch('/__api?url=' + encodeURIComponent(new URL(raw, location.href).href), init);
    return nativeFetch(input, init);
  };

  // 登入後換取 ATG 直連網址時也要經本站 WebSocket，避免上游因
  // Render 網址的 Origin 而拒絕連線。
  var NativeWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    try {
      var u = new URL(url, location.href), h = u.hostname.toLowerCase();
      if (/^wss?:$/.test(u.protocol) && (h === 'godeebxp.com' || /\.godeebxp\.com$/.test(h))) {
        var local = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/__lobby-socket?url=' + encodeURIComponent(u.href);
        return protocols ? new NativeWebSocket(local, protocols) : new NativeWebSocket(local);
      }
    } catch (_) {}
    return protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
  Object.keys(NativeWebSocket).forEach(function (key) { try { window.WebSocket[key] = NativeWebSocket[key]; } catch (_) {} });

  var layer, frame, closeButton;

  function proxyable(raw) {
    try {
      var u = new URL(raw, location.href), h = u.hostname.toLowerCase();
      return u.protocol === 'https:' && (h === 'tz6868.cc' || /\.tz6868\.cc$/.test(h) ||
        h === 'godeebxp.com' || /\.godeebxp\.com$/.test(h) ||
        /(^|\.)rsgaming[\w-]*\.com$/.test(h) || /(^|\.)royalgaming[\w-]*\.com$/.test(h));
    } catch (_) { return false; }
  }

  function ensureLayer() {
    if (layer) return;
    layer = document.createElement('div');
    layer.id = 'scarab-web-game-layer';
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000;overflow:hidden;display:none;touch-action:none';
    frame = document.createElement('iframe');
    frame.id = 'scarab-web-game-frame';
    frame.allow = 'autoplay;fullscreen;clipboard-read;clipboard-write';
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;display:block';
    closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', '關閉遊戲');
    closeButton.style.cssText = 'position:absolute;right:max(8px,env(safe-area-inset-right));top:max(8px,env(safe-area-inset-top));z-index:3;width:38px;height:38px;min-height:38px;margin:0;padding:0;border:1px solid #31536c;border-radius:12px;background:rgba(3,14,25,.82);color:#dff7ff;font:700 25px/36px sans-serif;box-shadow:none';
    layer.appendChild(frame); layer.appendChild(closeButton); document.body.appendChild(layer);
  }

  function makeRef(url, target) {
    var handlers = {}, closed = false, lastUrl = url;
    function emit(name, data) { (handlers[name] || []).slice().forEach(function (fn) { try { fn(data || {}); } catch (_) {} }); }
    function onMessage(ev) {
      if (!frame || ev.source !== frame.contentWindow || !ev.data || ev.data.__scarabCommand !== true) return;
      emit('loadstart', { url: String(ev.data.url || '') });
    }
    var ref = {
      addEventListener: function (n, fn) { (handlers[n] || (handlers[n] = [])).push(fn); },
      removeEventListener: function (n, fn) { var a = handlers[n] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
      executeScript: function (opts, cb) {
        try {
          var result = frame.contentWindow.eval(String(opts && opts.code || ''));
          if (cb) cb([result]);
        } catch (e) { console.warn('[Scarab Web] executeScript', e); if (cb) cb([]); }
      },
      close: function () { if (closed) return; closed = true; window.removeEventListener('message', onMessage); frame.src = 'about:blank'; layer.style.display = 'none'; document.documentElement.style.overflow = ''; document.body.style.overflow = ''; if (window.__unmountScarabWebOverlay) window.__unmountScarabWebOverlay(); emit('exit', {}); },
      show: function () { layer.style.display = 'block'; },
      hide: function () { layer.style.display = 'none'; }
    };
    if (target === '_system') { window.open(url, '_blank', 'noopener'); return ref; }
    ensureLayer(); closed = false; layer.style.display = 'block'; document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';
    window.addEventListener('message', onMessage);
    closeButton.onclick = ref.close;
    frame.onload = function () {
      if (closed) return;
      try { lastUrl = frame.contentWindow.__SCARAB_ORIGINAL_URL || frame.contentWindow.location.href; } catch (_) {}
      emit('loadstop', { url: lastUrl });
    };
    emit('loadstart', { url: url });
    frame.src = proxyable(url) ? ('/__game/open?url=' + encodeURIComponent(url)) : url;
    return ref;
  }

  window.Capacitor = window.Capacitor || { getPlatform: function () { return 'web'; }, Plugins: {} };
  window.cordova = window.cordova || {};
  window.cordova.InAppBrowser = { open: makeRef };
})();
