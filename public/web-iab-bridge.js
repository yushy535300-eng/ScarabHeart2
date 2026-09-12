/* ScarabHeart Render web game window bridge.
   Keeps the existing app.js InAppBrowser contract while rendering the game in
   a full-screen direct frame.  Proxying a WebGL game rewrites asset/socket URLs and
   produces a black screen, so the game itself must stay on its original origin. */
(function () {
  'use strict';
  var nativeFetch = window.fetch.bind(window);

  function needsApiProxy(raw) {
    try {
      var u = new URL(raw, location.href), h = u.hostname.toLowerCase();
      return u.origin !== location.origin &&
        (h === 'seth-eye.com' || /\.seth-eye\.com$/.test(h));
    } catch (_) { return false; }
  }

  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url) || '';
    if (needsApiProxy(raw)) return nativeFetch('/__api?url=' + encodeURIComponent(new URL(raw, location.href).href), init);
    return nativeFetch(input, init);
  };

  var layer, frame, closeButton, toolbar, statusBadge;

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
    toolbar = document.createElement('div');
    toolbar.id = 'scarab-web-float';
    toolbar.innerHTML = '<div class="swf-head"><img src="logo.png" alt=""><b>PNL&nbsp; +0.00</b><i></i></div><div class="swf-grid"><button data-cmd="refresh">↻</button><button data-cmd="speed">»</button><button data-cmd="guard">♢</button><button data-cmd="spoiler">◉</button><button data-cmd="free">◇</button><button data-cmd="home">⌂</button></div>';
    toolbar.style.cssText = 'position:absolute;left:max(8px,env(safe-area-inset-left));top:calc(max(8px,env(safe-area-inset-top)) + 70px);z-index:4;width:132px;padding:8px;border:1px solid #1883a6;border-radius:20px;background:rgba(1,13,24,.9);color:#dff8ff;font:700 12px sans-serif;box-sizing:border-box;touch-action:manipulation';
    var css = document.createElement('style'); css.textContent = '#scarab-web-float .swf-head{display:flex;align-items:center;gap:6px;margin:0 2px 7px}#scarab-web-float .swf-head img{width:24px;height:24px}#scarab-web-float .swf-head i{width:8px;height:8px;border-radius:50%;background:#4cffbd;box-shadow:0 0 9px #4cffbd;margin-left:auto}#scarab-web-float .swf-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}#scarab-web-float button{height:42px;border:1px solid #24698a;border-radius:12px;background:#071b2d;color:#72dcff;font-size:25px;font-weight:800}#scarab-web-float button.on{border-color:#f0c65b;color:#ffe27d;background:#123555}@media(max-width:700px) and (orientation:landscape){#scarab-web-float{transform:scale(.78);transform-origin:left top}}';
    document.head.appendChild(css);
    statusBadge = document.createElement('div'); statusBadge.style.cssText='display:none;position:absolute;left:150px;top:88px;z-index:5;padding:9px 13px;border:1px solid #d2aa42;border-radius:9px;background:rgba(1,13,24,.94);color:#ffe18a;font:700 12px sans-serif';
    layer.appendChild(frame); layer.appendChild(toolbar); layer.appendChild(statusBadge); layer.appendChild(closeButton); document.body.appendChild(layer);
  }

  function makeRef(url, target) {
    var handlers = {}, closed = false, lastUrl = url;
    function emit(name, data) { (handlers[name] || []).slice().forEach(function (fn) { try { fn(data || {}); } catch (_) {} }); }
    var ref = {
      addEventListener: function (n, fn) { (handlers[n] || (handlers[n] = [])).push(fn); },
      removeEventListener: function (n, fn) { var a = handlers[n] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
      executeScript: function (opts, cb) {
        try {
          var result = frame.contentWindow.eval(String(opts && opts.code || ''));
          if (cb) cb([result]);
        } catch (e) { console.warn('[Scarab Web] executeScript', e); if (cb) cb([]); }
      },
      close: function () { if (closed) return; closed = true; frame.src = 'about:blank'; layer.style.display = 'none'; document.documentElement.style.overflow = ''; document.body.style.overflow = ''; emit('exit', {}); },
      show: function () { layer.style.display = 'block'; },
      hide: function () { layer.style.display = 'none'; }
    };
    if (target === '_system') { window.open(url, '_blank', 'noopener'); return ref; }
    ensureLayer(); closed = false; layer.style.display = 'block'; document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden';
    closeButton.onclick = ref.close;
    toolbar.onclick = function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var cmd = b.getAttribute('data-cmd');
      if (cmd === 'home') { ref.close(); return; }
      if (cmd === 'refresh') { try { frame.src = lastUrl; } catch (_) {} return; }
      b.classList.toggle('on');
      statusBadge.textContent = cmd === 'speed' ? '加速：' + (b.classList.contains('on') ? 'X4' : 'X1') : (cmd === 'guard' ? '停利停損' : cmd === 'spoiler' ? '免費遊戲得分劇透' : 'FREE 自動');
      statusBadge.style.display='block'; clearTimeout(statusBadge._t); statusBadge._t=setTimeout(function(){statusBadge.style.display='none';},1600);
      try { frame.contentWindow.postMessage({type:'SCARAB_COMMAND',command:cmd,enabled:b.classList.contains('on')}, '*'); } catch (_) {}
    };
    frame.onload = function () {
      if (closed) return;
      try { lastUrl = frame.contentWindow.__SCARAB_ORIGINAL_URL || frame.contentWindow.location.href; } catch (_) {}
      emit('loadstop', { url: lastUrl });
    };
    emit('loadstart', { url: url });
    frame.src = url;
    return ref;
  }

  window.Capacitor = window.Capacitor || { getPlatform: function () { return 'web'; }, Plugins: {} };
  window.cordova = window.cordova || {};
  window.cordova.InAppBrowser = { open: makeRef };
})();
