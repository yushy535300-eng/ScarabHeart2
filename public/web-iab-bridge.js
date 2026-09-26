/* Browser launcher: TZ/OFA login stays in the browser; ATG runs inside the
   ScarabHeart page through the same-origin game proxy. */
(function () {
  'use strict';

  var nativeFetch = window.fetch.bind(window);
  var NativeWebSocket = window.WebSocket;
  var loadTimer = null;
  // Remove the v2.60 root worker. It is no longer needed and an old worker
  // should never affect a fresh deploy/recovery.
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(list) {
        list.forEach(function(reg) { try { reg.unregister(); } catch (_) {} });
      }).catch(function(){});
    }
  } catch (_) {}

  var frameLoaded = false;
  var currentOpenId = 0;
  var currentRoomSessionId = '';

  function needsBackendProxy(raw) {
    try {
      var url = new URL(raw, location.href);
      var host = url.hostname.toLowerCase();
      return url.origin !== location.origin &&
        (host === 'seth-eye.com' || /\.seth-eye\.com$/.test(host));
    } catch (_) {
      return false;
    }
  }

  // Only the ScarabHeart member API uses the server proxy. TZ/OFA must be
  // requested directly from the user's browser; routing it through Render is
  // what produced the repeated HTTP 403 responses.
  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url) || '';
    if (needsBackendProxy(raw)) {
      return nativeFetch('/__api?url=' + encodeURIComponent(new URL(raw, location.href).href), init);
    }
    return nativeFetch(input, init);
  };

  // The short lobby exchange is proxied because the ATG Socket.IO endpoint
  // validates Origin. The game itself gets its own session-bound socket route.
  window.WebSocket = function (url, protocols) {
    try {
      var parsed = new URL(url, location.href);
      var host = parsed.hostname.toLowerCase();
      if (/^wss?:$/.test(parsed.protocol) &&
          (host === 'godeebxp.com' || /\.godeebxp\.com$/.test(host))) {
        var local = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' +
          location.host + '/__lobby-socket?url=' + encodeURIComponent(parsed.href);
        return protocols ? new NativeWebSocket(local, protocols) : new NativeWebSocket(local);
      }
    } catch (_) {}
    return protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
  Object.keys(NativeWebSocket).forEach(function (key) {
    try { window.WebSocket[key] = NativeWebSocket[key]; } catch (_) {}
  });
  // Chrome exposes these constants as non-enumerable properties. Socket.IO
  // checks them on the constructor, so copy them explicitly to the wrapper.
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (key) {
    try {
      Object.defineProperty(window.WebSocket, key, {
        value: NativeWebSocket[key],
        configurable: true
      });
    } catch (_) {}
  });

  function base64url(value) {
    var bytes = new TextEncoder().encode(JSON.stringify(value || {}));
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function elements() {
    return {
      view: document.getElementById('gameView'),
      frame: document.getElementById('gameFrame'),
      loading: document.getElementById('gameLoading'),
      status: document.getElementById('gameLoadStatus')
    };
  }

  function setLoading(message, done) {
    var ui = elements();
    if (ui.status && message) ui.status.textContent = message;
    if (ui.loading) ui.loading.classList.toggle('done', !!done);
  }

  function roomPickVisual(){ /* v3.08: original in-game locator only */ }

  function openInApp(raw, payload) {
    currentRoomSessionId = String(payload && payload.cfg && payload.cfg.ROOM_SESSION_ID || '');
    try {
      sessionStorage.removeItem('SCARAB_FORCE_MANUAL_ROOM');
      sessionStorage.removeItem('scarab_force_manual_room');
      sessionStorage.removeItem('SCARAB_ROOM_FALLBACK');
      sessionStorage.removeItem('SCARAB_ROOM_DONE');
      sessionStorage.removeItem('SCARAB_LAST_ROOM');
      sessionStorage.removeItem('SCARAB_LAST_MACHINE');
      sessionStorage.removeItem('SCARAB_ROOM_SESSION');
      sessionStorage.removeItem('seth_seated');
      sessionStorage.removeItem('seth_switched');
    } catch (_) {}
    var source;
    try {
      source = new URL(raw, location.href);
      if (source.protocol !== 'https:') throw new Error('invalid protocol');
    } catch (_) {
      throw new Error('ATG 遊戲網址無效');
    }
    var ui = elements();
    if (!ui.view || !ui.frame) throw new Error('找不到程式內遊戲視窗');
    clearTimeout(loadTimer);
    frameLoaded = false;
    var openId = ++currentOpenId;
    setLoading('正在連線 ATG 遊戲…', false);
    ui.view.classList.remove('hide');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    var encoded = base64url(payload || {});
    try {
      ui.frame.setAttribute('loading', 'eager');
      ui.frame.setAttribute('fetchpriority', 'high');
    } catch (_) {}

    ui.frame.onload = function () {
      if (openId !== currentOpenId) return;
      frameLoaded = true;
      setLoading('遊戲已載入，懸浮工具背景連線中…', true);
      clearTimeout(loadTimer);
    };

    try {
      var currentSrc = String(ui.frame.getAttribute('src') || '');
      if (currentSrc && currentSrc !== 'about:blank') ui.frame.src = 'about:blank';
    } catch (_) {}

    ui.frame.src = '/__game/open?url=' + encodeURIComponent(source.href) +
      '&cfg=' + encodeURIComponent(encoded);
    return true;
  }

  function closeInApp() {
    var ui = elements();
    clearTimeout(loadTimer);
    frameLoaded = false;
    currentOpenId++;
    currentRoomSessionId = '';
    if (ui.frame) {
      ui.frame.onload = null;
      ui.frame.src = 'about:blank';
    }
    if (ui.view) ui.view.classList.add('hide');
    roomPickVisual('hide');
    if (ui.loading) ui.loading.classList.remove('done');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  window.addEventListener('message', function (event) {
    var ui = elements();
    if (!ui.frame || event.source !== ui.frame.contentWindow) return;
    var data = event.data;
    var messageRoomSessionId = data && data.roomSessionId != null ? String(data.roomSessionId) : '';
    // Old game documents are allowed to finish loading, but they are never
    // allowed to control the current room selection.
    if (messageRoomSessionId && currentRoomSessionId && messageRoomSessionId !== currentRoomSessionId) return;
    if (data && data.__scarabLiveTables === true && Array.isArray(data.tables)) {
      window.dispatchEvent(new CustomEvent('scarab:live-tables', {detail:data}));
      return;
    }
    if (data && data.__scarabCommand === true && typeof data.url === 'string') {
      window.dispatchEvent(new CustomEvent('scarab:web-command', {
        detail: { url: data.url, roomSessionId: messageRoomSessionId }
      }));
      return;
    }
    if (data && data.__scarabStatus === true) {
      if (data.state === 'engine-ready') {
        setLoading('懸浮工具已連線', true);
      } else if (data.state === 'engine-wait' || data.state === 'engine-loading') {
        // Before iframe load this is useful progress. After iframe load it must
        // stay non-blocking or the user sees a fake "game cannot enter" screen.
        setLoading(data.message || '遊戲載入中…', frameLoaded);
      } else if (data.state === 'room-fallback') {
        setLoading(data.message || '已切換手動選房', true);
      } else if (data.state === 'room-searching') {
        roomPickVisual('show', data.message || '正在定位機台中…');
      } else if (data.state === 'room-entered') {
        roomPickVisual('done');
      } else if (data.state === 'room-exact-wait') {
        roomPickVisual('show', data.message || '正在等待指定機台資料');
        setLoading(data.message || '正在等待指定機台資料', true);
      } else if (data.state === 'engine-error') {
        // Assistant failure must never take down the real ATG game.
        setLoading('遊戲可繼續操作；懸浮工具暫時未連線', true);
      }
    }
  });

  function switchRoomInApp(options) {
    var ui=elements();
    if(!ui.frame||!ui.frame.contentWindow||!currentRoomSessionId)return false;
    var data=options||{};
    try {
      ui.frame.contentWindow.postMessage({
        __scarabRoomSwitch:true,
        roomSessionId:currentRoomSessionId,
        roomId:String(data.roomId||''),
        machineNum:String(data.machineNum||''),
        candidates:Array.isArray(data.candidates)?data.candidates:[]
      },location.origin);
      return true;
    } catch (_) { return false; }
  }

  window.ScarabWebLauncher = {
    isWeb: true,
    reserve: function () { return true; },
    cancelReserve: function () {},
    open: openInApp,
    switchRoom: switchRoomInApp,
    close: closeInApp
  };
  window.Capacitor = window.Capacitor || {
    getPlatform: function () { return 'web'; },
    Plugins: {}
  };
})();
