(function () {
  'use strict';

  function decode(raw) {
    try {
      var s = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      var binary = atob(s), bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      console.error('[ScarabHeart] 啟動資料無法解析', e);
      return null;
    }
  }

  function readPayload() {
    var raw = '';
    try { raw = new URLSearchParams(location.hash.slice(1)).get('scarab_cfg') || ''; } catch (_) {}
    if (raw) {
      try { sessionStorage.setItem('__scarab_cfg', raw); } catch (_) {}
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    } else {
      try { raw = sessionStorage.getItem('__scarab_cfg') || ''; } catch (_) {}
    }
    return { raw: raw, payload: decode(raw) };
  }

  var state = readPayload(), payload = state.payload;
  if (!payload || !payload.kind || !payload.cfg) return;

  window.__SCARAB_WEB_PAYLOAD = payload;
  window.__SCARAB_RETURN_URL = String(payload.returnUrl || '');

  function bootATG() {
    if (payload.kind !== 'atg' || !/\/egames(?:\/|$)/i.test(location.pathname)) return;
    window.__SCARAB_WEB_ACTIVE = true;
    window.__SC_GAME_CODE = String(payload.gameCode || payload.cfg.GAME_CODE || '');
    window.__SC_GOOD_ROOMS = payload.cfg.GOOD_ROOMS || [];
    if (window.__sethBooted) return;
    window.__sethBooted = true;
    try {
      engine(payload.cfg);
      console.log('[ScarabHeart] ATG 引擎已載入');
    } catch (e) {
      window.__sethBooted = false;
      console.error('[ScarabHeart] ATG 引擎啟動失敗', e);
    }
  }

  function bootRSGGame() {
    if (payload.kind !== 'rsg' || !/\/Web\/SlotGame\d/i.test(location.pathname)) return;
    window.__SCARAB_WEB_ACTIVE = true;
    window.__SC_GAME_CODE = 'rsg-' + String(payload.gameId || payload.cfg.GAME_ID || '');
    if (window.__thorBooted) return;
    window.__thorBooted = true;
    try {
      thorEngine(payload.cfg);
      console.log('[ScarabHeart] RSG 引擎已載入');
    } catch (e) {
      window.__thorBooted = false;
      console.error('[ScarabHeart] RSG 引擎啟動失敗', e);
    }
  }

  function enterRSGFromLobby() {
    if (payload.kind !== 'rsg' || !/\/Lobby2?\//i.test(location.pathname) || window.__scarabRsgNavigating) return;
    window.__scarabRsgNavigating = true;
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      var key = '';
      try { key = sessionStorage.getItem('LobbySession') || ''; } catch (_) {}
      if (!key) {
        if (tries > 40) {
          clearInterval(timer);
          window.__scarabRsgNavigating = false;
          console.error('[ScarabHeart] 找不到 RSG LobbySession');
        }
        return;
      }
      clearInterval(timer);
      fetch('../Lobby/GetGameURL?k=' + encodeURIComponent(key) + '&id=' + encodeURIComponent(payload.gameId || payload.cfg.GAME_ID) + '&lobby=2', { cache: 'no-cache' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data || !data.nextpage) throw new Error('RSG 未回傳遊戲頁');
          try {
            sessionStorage.setItem('GameWebSession2', data.newsession || '');
            localStorage.setItem('backupSession', data.newsession || '');
          } catch (_) {}
          var next = new URL(String(data.nextpage), location.href);
          next.hash = 'scarab_cfg=' + state.raw;
          location.href = next.href;
        })
        .catch(function (e) {
          window.__scarabRsgNavigating = false;
          console.error('[ScarabHeart] RSG 導頁失敗', e);
        });
    }, 500);
  }

  enterRSGFromLobby();
  bootATG();
  bootRSGGame();
})();
