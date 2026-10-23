(function () {
  'use strict';
  if (window.__scarabRsgLobbyRescue) return;
  window.__scarabRsgLobbyRescue = true;
  // GameData and GetGameURL are the real RSG lobby APIs. No game is hard-coded.
  var original = String(window.__SCARAB_ORIGINAL_URL || location.href);
  var source;
  try { source = new URL(original); } catch (_) { return; }
  if (!/^\/Lobby2?\/Index/i.test(source.pathname)) return;
  var prefix = String(window.__SCARAB_PROXY_PREFIX || '');
  if (!/^\/__game\/[a-f0-9]{24}$/i.test(prefix)) return;
  var root = null, dataReady = false, loadingData = false, key = '', timer = 0, pollCount = 0;
  var state = { games: [], order: [], query: '', busy: false };
  var safeName = function (v) { return String(v == null ? '' : v).slice(0, 90); };
  function getKey() {
    try { return String(sessionStorage.getItem('LobbySession') || ''); }
    catch (_) { return ''; }
  }
  function api(path, params) {
    var dest = new URL(path, source.origin);
    Object.keys(params).forEach(function (k) { dest.searchParams.set(k, params[k]); });
    return fetch(dest.href, { credentials: 'same-origin', cache: 'no-store',
      headers: { 'Accept': 'application/json, text/javascript, */*; q=0.01' } })
      .then(function (r) { if (!r.ok) throw new Error('RSG 回應 HTTP ' + r.status); return r.json(); });
  }
  function pickData(payload) {
    if (!payload || !Array.isArray(payload.gameList) || !payload.gameList.length) return;
    if (dataReady) return;
    state.games = payload.gameList.filter(function (g) {
      return g && /^\d{1,5}$/.test(String(g.gameId || '')) && !!g.gameName;
    });
    if (!state.games.length) return;
    state.order = Array.isArray(payload.gameSort) ? payload.gameSort.map(String) : [];
    dataReady = true;
    if (timer) clearInterval(timer);
    // Show immediately once the real lobby data is available, replacing a stalled spinner.
    mount();
  }
  function captureKeyFromUrl(u) {
    try {
      var text = decodeURIComponent(String(u || ''));
      var m = text.match(/[?&]k=([^&#]+)/);
      if (m && m[1]) key = m[1];
    } catch (_) {}
  }
  // Observe the native lobby's already-authenticated GameData response.
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    var uri = String(arguments[1] || '');
    if (uri.indexOf('GameData') !== -1) {
      captureKeyFromUrl(uri);
      this.addEventListener('load', function () {
        try { if (this.status === 200) pickData(JSON.parse(this.responseText)); } catch (_) {}
      }, { once: true });
    }
    return open.apply(this, arguments);
  };
  var nativeFetch = window.fetch;
  window.fetch = function (request, options) {
    var u = typeof request === 'string' ? request : request && request.url || '';
    var p = nativeFetch.apply(this, arguments);
    if (String(u).indexOf('GameData') !== -1) {
      captureKeyFromUrl(u);
      p.then(function (r) { if (r.ok) r.clone().json().then(pickData).catch(function () {}); })
        .catch(function () {});
    }
    return p;
  };
  function node(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }
  function status(message) {
    var el = root && root.querySelector('.srsg-status');
    if (el) el.textContent = message || '';
  }
  function renderCards() {
    var holder = root.querySelector('.srsg-grid');
    if (!holder) return;
    holder.textContent = '';
    var q = state.query.toLowerCase();
    var ranks = Object.create(null);
    state.order.forEach(function (n, i) { ranks[n] = i; });
    var games = state.games.filter(function (g) {
      return !q || String(g.gameName).toLowerCase().includes(q) || String(g.gameId).includes(q);
    }).sort(function (a, b) {
      return (ranks[String(a.gameId)] == null ? 9999 : ranks[String(a.gameId)]) -
        (ranks[String(b.gameId)] == null ? 9999 : ranks[String(b.gameId)]);
    });
    root.querySelector('.srsg-count').textContent = games.length + ' 款遊戲';
    var frag = document.createDocumentFragment();
    games.forEach(function (game) {
      var item = node('button', 'srsg-item');
      item.type = 'button';
      var emblem = node('span', 'srsg-emblem', String(game.gameName).slice(0, 1));
      item.appendChild(emblem);
      var content = node('span', 'srsg-label');
      content.appendChild(node('strong', '', safeName(game.gameName)));
      content.appendChild(node('small', '', game.newgame ? '全新遊戲' : game.hotgame ? '熱門遊戲' : 'RSG · GAME'));
      item.appendChild(content);
      item.appendChild(node('span', 'srsg-chevron', '›'));
      item.addEventListener('click', function () { choose(game.gameId); });
      frag.appendChild(item);
    });
    if (!games.length) holder.appendChild(node('p', 'srsg-empty', '沒有符合的遊戲'));
    holder.appendChild(frag);
  }
  function mount() {
    if (root || !document.body) {
      if (!root) setTimeout(mount, 120);
      return;
    }
    root = node('section', 'srsg-root');
    root.setAttribute('aria-label', 'RSG 遊戲選擇大廳');
    var header = node('header', 'srsg-header');
    var brand = node('div', 'srsg-brand');
    brand.appendChild(node('strong', '', 'RSG 平台'));
    brand.appendChild(node('small', '', '選擇遊戲後即可進入'));
    header.appendChild(brand);
    header.appendChild(node('span', 'srsg-count', ''));
    root.appendChild(header);
    var toolbar = node('div', 'srsg-toolbar');
    var search = node('input', 'srsg-search');
    search.type = 'search'; search.placeholder = '搜尋 RSG 遊戲名稱';
    search.setAttribute('aria-label', '搜尋遊戲');
    search.addEventListener('input', function () { state.query = this.value.trim(); renderCards(); });
    toolbar.appendChild(search); root.appendChild(toolbar);
    root.appendChild(node('p', 'srsg-status', ''));
    root.appendChild(node('div', 'srsg-grid'));
    document.body.appendChild(root);
    renderCards();
  }
  function choose(id) {
    if (state.busy) return;
    var current = key || getKey();
    if (!current) { status('登入階段尚未完成，請返回 RSG 入口重新進入。'); return; }
    state.busy = true;
    root.classList.add('srsg-busy');
    status('正在開啟選擇的遊戲…');
    api('/Lobby2/GetGameURL', { k: current, id: String(id), lobby: '2' })
      .then(function (d) {
        if (!d || !d.newsession || !d.nextpage) throw new Error('RSG 沒有回傳有效的遊戲入口');
        var target = new URL(String(d.nextpage), source);
        if (target.protocol !== 'https:' ||
            !/^gameweb\.rsgaming(?:666|888|955|977)\.com$/i.test(target.hostname) ||
            !/^\/Web\/SlotGame\d+(?:\/|$)/i.test(target.pathname)) throw new Error('RSG 遊戲入口不符合安全規則');
        sessionStorage.setItem('GameWebSession2', String(d.newsession));
        localStorage.setItem('backupSession', String(d.newsession));
        // Update the RSG proxy's upstream host before a cross-host game is opened.
        location.assign(prefix + '/__navigate?url=' + encodeURIComponent(target.href));
      })
      .catch(function (e) {
        status(e && e.message || '進入失敗，請再試一次');
        state.busy = false;
        if (root) root.classList.remove('srsg-busy');
      });
  }
  function load() {
    var k = key || getKey();
    if (!k || dataReady || loadingData) return;
    key = k;
    loadingData = true;
    api('/Lobby2/GameData', { k: k, _: String(Date.now()) }).then(pickData)
      .catch(function () { /* native network listener is a second source */ })
      .finally(function () { loadingData = false; });
  }
  timer = setInterval(function () {
    if (dataReady) return clearInterval(timer);
    if (getKey()) load();
    if (++pollCount > 30) {
      clearInterval(timer);
      // No game list means no valid authorized lobby data; never invent games.
    }
  }, 400);
  if (getKey()) load();
  var style = document.createElement('style');
  style.textContent = [
    '.srsg-root{position:fixed!important;inset:0!important;z-index:2147483600!important;box-sizing:border-box!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-y!important;background:linear-gradient(160deg,#08192b,#030912)!important;color:#f0e8d8!important;padding:20px max(14px,env(safe-area-inset-right)) 40px max(14px,env(safe-area-inset-left))!important;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif!important;}',
    '.srsg-header{display:flex;justify-content:space-between;gap:12px;align-items:center;max-width:1140px;margin:0 auto 18px;}',
    '.srsg-brand{display:flex;flex-direction:column;gap:4px}.srsg-brand strong{font-size:25px;color:#f8d17f;letter-spacing:.06em}.srsg-brand small,.srsg-count{font-size:12px;color:#9bb8d0}',
    '.srsg-toolbar{max-width:1140px;margin:0 auto 12px}.srsg-search{box-sizing:border-box;width:100%;min-height:48px;padding:10px 15px;font-size:16px;color:white;background:#112b42;border:1px solid #53748f;border-radius:12px;outline-color:#efcf8b;}',
    '.srsg-status{max-width:1140px;min-height:22px;margin:6px auto;color:#f9d18e;font-size:13px}',
    '.srsg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;max-width:1140px;margin:auto;padding-bottom:40px}',
    '.srsg-item{display:flex;align-items:center;gap:10px;min-width:0;min-height:94px;padding:12px;text-align:left;background:linear-gradient(130deg,#163350,#071728);color:#fff;border:1px solid #385672;border-radius:14px;cursor:pointer;box-sizing:border-box;}',
    '.srsg-item:active{background:#224968}.srsg-item:focus-visible{outline:2px solid #ffd67d}.srsg-emblem{display:grid;place-items:center;flex:none;width:48px;height:48px;border-radius:12px;background:linear-gradient(145deg,#b68035,#55320c);color:#fff0c0;font-size:25px;font-weight:900;}',
    '.srsg-label{display:flex;flex:1;min-width:0;flex-direction:column;gap:6px}.srsg-label strong{font-size:15px;line-height:1.3}.srsg-label small{font-size:10px;color:#9eb7ca}.srsg-chevron{font-size:25px;color:#f6d47c}',
    '.srsg-busy .srsg-item{opacity:.6;pointer-events:none}',
    '.srsg-empty{color:#a5b7c7;grid-column:1/-1}',
    '@media(max-width:500px){.srsg-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.srsg-item{min-height:111px;padding:8px;gap:7px;flex-wrap:wrap;align-content:center}.srsg-emblem{width:37px;height:37px;font-size:22px}.srsg-label strong{font-size:13px}.srsg-label small{font-size:9px}.srsg-brand strong{font-size:21px}.srsg-chevron{display:none}}'
  ].join('');
  (document.head || document.documentElement).appendChild(style);
})();