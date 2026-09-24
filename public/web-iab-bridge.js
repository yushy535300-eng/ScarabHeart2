/* ScarabHeart browser bridge.
   API calls stay on the Render service, while games open on their official
   origin. The bundled Chrome extension injects the engine there. */
(function () {
  'use strict';

  var nativeFetch = window.fetch.bind(window);
  var reservedWindow = null;

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
    if (needsApiProxy(raw)) {
      return nativeFetch('/__api?url=' + encodeURIComponent(new URL(raw, location.href).href), init);
    }
    return nativeFetch(input, init);
  };

  // ATG uses this socket only to exchange the lobby URL for the official play
  // URL. The actual game no longer runs through the Render reverse proxy.
  var NativeWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    try {
      var u = new URL(url, location.href), h = u.hostname.toLowerCase();
      if (/^wss?:$/.test(u.protocol) && (h === 'godeebxp.com' || /\.godeebxp\.com$/.test(h))) {
        var local = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host +
          '/__lobby-socket?url=' + encodeURIComponent(u.href);
        return protocols ? new NativeWebSocket(local, protocols) : new NativeWebSocket(local);
      }
    } catch (_) {}
    return protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
  Object.keys(NativeWebSocket).forEach(function (key) {
    try { window.WebSocket[key] = NativeWebSocket[key]; } catch (_) {}
  });

  function base64url(value) {
    var bytes = new TextEncoder().encode(JSON.stringify(value));
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function launchUrl(raw, payload) {
    var u = new URL(raw, location.href);
    payload = payload || {};
    payload.returnUrl = location.origin + location.pathname + location.search;
    u.hash = 'scarab_cfg=' + base64url(payload);
    return u.href;
  }

  function reserve() {
    if (reservedWindow && !reservedWindow.closed) return reservedWindow;
    try {
      reservedWindow = window.open('about:blank', 'scarabheart_game');
      if (reservedWindow) {
        reservedWindow.document.title = '聖甲之心｜遊戲載入中';
        reservedWindow.document.body.style.cssText = 'margin:0;background:#020711;color:#e8cb72;display:grid;place-items:center;height:100vh;font:700 18px system-ui';
        reservedWindow.document.body.textContent = '遊戲載入中…';
      }
    } catch (_) { reservedWindow = null; }
    return reservedWindow;
  }

  function cancelReserve() {
    try {
      if (reservedWindow && !reservedWindow.closed && reservedWindow.location.href === 'about:blank') reservedWindow.close();
    } catch (_) {}
    reservedWindow = null;
  }

  function openOfficial(raw, payload) {
    var target = launchUrl(raw, payload);
    var win = reservedWindow && !reservedWindow.closed ? reservedWindow : null;
    reservedWindow = null;
    try {
      if (!win) win = window.open('about:blank', 'scarabheart_game');
      if (win) {
        win.location.replace(target);
        try { win.focus(); } catch (_) {}
        return true;
      }
    } catch (_) {}

    // Reliable fallback when a popup blocker rejects delayed window.open.
    location.href = target;
    return true;
  }

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || data.__scarabCommand !== true || typeof data.url !== 'string') return;
    window.dispatchEvent(new CustomEvent('scarab:web-command', { detail: { url: data.url } }));
  });

  // Same-tab fallback returns here with a command in the fragment.
  function consumeReturnCommand() {
    try {
      var p = new URLSearchParams(location.hash.slice(1));
      var command = p.get('scarab_command');
      if (!command) return;
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(function () {
        window.dispatchEvent(new CustomEvent('scarab:web-command', { detail: { url: command } }));
      }, 50);
    } catch (_) {}
  }

  window.ScarabWebLauncher = {
    isWeb: true,
    reserve: reserve,
    cancelReserve: cancelReserve,
    open: openOfficial
  };
  window.Capacitor = window.Capacitor || { getPlatform: function () { return 'web'; }, Plugins: {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', consumeReturnCommand);
  else consumeReturnCommand();
})();
