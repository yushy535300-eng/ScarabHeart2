(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const log = (...args) => { try { console.log('[ScarabHeart]', ...args); } catch (_) {} };
  const APP_VERSION = 'v3.03-mobile-login-clean-fit';
  const GAMES = [
    ['golden-seth', '戰神賽特2 覺醒之力', 'media/game2.png'],
    ['egyptian-mythology', '戰神賽特', 'media/game8.png'],
    ['tiger-princess', '虎小妹', 'media/game5.png'],
    ['hades', '古神巴風特', 'media/game3.png'],
    ['scarlet-three-kingdoms', '赤三國', 'media/game1.png'],
    ['wuxia-caishen', '武俠', 'media/game0.png'],
    ['son-go-ku', '孫行者', 'media/game4.png'],
    ['new-vampire-hunter', '惡魔血域', 'media/game6.png'],
    ['new-jinlian', '金蓮三缺一', 'media/game9.png']
  ];
  // 2026-09-25: verified from the user's ATG HAR captures.
  // Keeping the real ATG identity beside each game prevents stale/foreign
  // room state from being reused when switching games quickly.
  // v2.99: these ATG titles use the portrait room/game layout.
  // Keep the proven v2.98 room flow, but never let the generic 12-second
  // landscape watchdog cancel an exact machine selection for these games.
  const PORTRAIT_ROOM_GAMES = new Set([
    'wuxia-caishen',
    'son-go-ku',
    'new-vampire-hunter',
    'new-jinlian'
  ]);

  const GAME_META = {
    'golden-seth': { gameId: 123, mechanism: 'slot-erase-any-times-2', checksum: '3d2f2320da720b4a5c0da29079776e107daa3a79' },
    'new-jinlian': { gameId: 134, mechanism: 'slot-expanding-wild-1', checksum: 'f8d1b0cae05078122191ba04093254c6b9efb09a' },
    'new-vampire-hunter': { gameId: 133, mechanism: 'slot-pick-one-of-three-1', checksum: '05439f232a321501c3791d60b88a53420638e0df' },
    'hades': { gameId: 127, mechanism: 'slot-erase-cluster-times-1', checksum: '37ab205b0990c6a3643e0dbb8c9ee4adb698123c' },
    'tiger-princess': { gameId: 130, mechanism: 'slot-erase-any-times-2', checksum: 'a21ec50d4a0db8456e8814164723d753969947dc' },
    'egyptian-mythology': { gameId: 114, mechanism: 'slot-erase-any-times-1', checksum: 'fc0932025c774421a21fe1f2e7702c10e33a7487' },
    'scarlet-three-kingdoms': { gameId: 122, mechanism: 'slot-erase-any-times-1', checksum: '7c2dbf0bb8988bcd674d026e0ff428fa9c0caa41' },
    'wuxia-caishen': { gameId: 121, mechanism: 'slot-erase-link-times-1', checksum: '1b87ecd58a8dc56437f49e2d0e04f1870d01671a' },
    'son-go-ku': { gameId: 118, mechanism: 'slot-erase-link-times-2', checksum: '3935504edb3857524d7a3125c0cf284f07d0fb45' }
  };
  const BOARD_META = {
    composite: ['綜合分數', '綜合'],
    volatility: ['爆分榜', '爆發'],
    premium: ['精品排行', '精品'],
    freegame: ['免遊未開', '未開']
  };

  let session = null;
  let accessWatchTimer = null;
  let loginPlatform = 'TZ';
  let boards = null;
  let activeBoard = 'composite';
  let pendingPick = null;
  let boardLoadSerial = 0;
  let gameOpenSerial = 0;
  let roomSessionSerial = 0;
  let recommendationProbe = null;
  let recommendationProbeSerial = 0;
  let currentRoomSessionId = '';
  let preparedGameEntry = null;
  let preparedGameEntrySerial = 0;
  const PREPARED_ENTRY_MS = 20000;
  const boardCache = Object.create(null);
  const BOARD_CACHE_MS = 15000;
  const REAL_BOARD_STORAGE_MS = 5 * 60 * 1000;

  function realBoardStorageKey(game) {
    return 'scarab_real_boards_v275_' + String(game || '');
  }
  function saveRealBoardStorage(game, value) {
    try {
      if (!game || !value || usableBoardCount(value) < 1) return;
      localStorage.setItem(realBoardStorageKey(game), JSON.stringify({ at: Date.now(), value: value }));
    } catch (_) {}
  }
  function loadRealBoardStorage(game) {
    try {
      const raw = JSON.parse(localStorage.getItem(realBoardStorageKey(game)) || 'null');
      if (!raw || !raw.value || Date.now() - Number(raw.at || 0) > REAL_BOARD_STORAGE_MS) return null;
      return normalizeBoards(raw.value);
    } catch (_) { return null; }
  }

  function emptyBoards() {
    return { composite: [], volatility: [], premium: [], freegame: [], updatedAt: Date.now() };
  }

  function normalizeBoards(value) {
    const out = value && typeof value === 'object' ? value : {};
    ['composite', 'volatility', 'premium', 'freegame'].forEach(key => {
      if (!Array.isArray(out[key])) out[key] = [];
    });
    if (!out.updatedAt) out.updatedAt = Date.now();
    return out;
  }

  function usableBoardCount(value) {
    if (!value) return 0;
    return ['composite', 'volatility', 'premium', 'freegame'].reduce((sum, key) => {
      const list = Array.isArray(value[key]) ? value[key] : [];
      return sum + list.filter(item => item && (item.roomId || item.machineNum != null)).length;
    }, 0);
  }

  window.SETH_APP_VER = APP_VERSION;
  document.querySelectorAll('.seth-ver').forEach(el => { el.textContent = APP_VERSION; });

  function deviceId() {
    let value = localStorage.getItem('scarab_device_id');
    if (!value) {
      value = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const n = Math.floor(Math.random() * 16);
        return (c === 'x' ? n : (n & 3) | 8).toString(16);
      });
      localStorage.setItem('scarab_device_id', value);
    }
    return value;
  }

  async function postJson(url, body, token) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers,
        body: JSON.stringify(body)
      });
    } catch (error) {
      const e = new Error('無法連線到 ' + loginPlatform + '，請確認網路後重試');
      e.cause = error;
      throw e;
    }
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!response.ok) {
      const e = new Error((data && data.message) || ('伺服器回應 HTTP ' + response.status));
      e.status = response.status;
      throw e;
    }
    if (!data) throw new Error('娛樂城回傳格式錯誤');
    return data;
  }

  function accessReasonText(reason) {
    const map = { not_whitelisted:'此帳號目前無使用資格', disabled:'此帳號授權已停用', expired:'此帳號授權已到期', database_unavailable:'授權服務暫時無法使用', session_invalid:'授權工作階段已失效，請重新登入' };
    return map[String(reason||'')] || '白名單驗證失敗';
  }
  async function localAccess(path, body) {
    const response = await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Accept':'application/json','Content-Type':'application/json'}:{'Accept':'application/json'},body:body?JSON.stringify(body):undefined});
    let data={}; try{data=await response.json()}catch(_){} return {response,data:data||{}};
  }
  function stopAccessWatch(){if(accessWatchTimer)clearInterval(accessWatchTimer);accessWatchTimer=null;}
  function startAccessWatch(){stopAccessWatch();accessWatchTimer=setInterval(async()=>{const current=session;if(!current||!current.accessSessionId)return;try{const r=await localAccess('/api/access/check?sessionId='+encodeURIComponent(current.accessSessionId));if(r.response.status>=500||r.data.temporary)return;if(!r.data.valid){const message=accessReasonText(r.data.reason);logout(true);$('err').textContent=message;}}catch(_){}},5000);}

  function directGameUrlOnce(lobbyToken, gameCode, timeoutMs) {
    return new Promise((resolve, reject) => {
      let ws;
      let settled = false;
      let ack = 0;
      let token = lobbyToken;
      let initialAck = -1;
      let playAck = -1;
      let canonicalCode = gameCode;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws && ws.close(); } catch (_) {}
        fn(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('ATG 遊戲連線逾時')), timeoutMs || 12000);
      try {
        ws = new WebSocket('wss://socket.godeebxp.com/socket.io/?EIO=3&transport=websocket');
      } catch (error) {
        finish(reject, error);
        return;
      }
      const send = (name, data) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return -1;
        const id = ack++;
        ws.send('42' + id + JSON.stringify([name, data]));
        return id;
      };
      ws.onmessage = event => {
        const message = String(event.data || '');
        if (message === '2') { try { ws.send('3'); } catch (_) {} return; }
        if (message === '40') {
          if (initialAck < 0) initialAck = send('lobbyInitial', { token: lobbyToken, clientType: 'web' });
          return;
        }
        const match = message.match(/^43(\d+)([\s\S]*)/);
        if (!match) return;
        const id = Number(match[1]);
        let result = null;
        try { result = JSON.parse(match[2]); } catch (_) {}
        const packet = result && result[0];
        if (packet && packet.token) token = packet.token;
        if (id === initialAck && playAck < 0) {
          // HAR shows the canonical game code in lobbyInitial. Resolve against it
          // before lobbyPlay so fast game switching cannot reuse a stale identity.
          try {
            const games = packet && packet.content && packet.content.games;
            const wanted = Array.isArray(games) && games.find(g => String(g && g.code || '') === String(gameCode));
            if (wanted && wanted.code) canonicalCode = String(wanted.code);
          } catch (_) {}
          playAck = send('lobbyPlay', { token, clientType: 'web', code: canonicalCode });
          return;
        }
        if (id === playAck) {
          if (packet && packet.redirectUrl) {
            try {
              const parsed = new URL(packet.redirectUrl);
              const returnedCode = parsed.searchParams.get('gn');
              if (returnedCode && returnedCode !== canonicalCode) {
                finish(reject, new Error('ATG 回傳了錯誤的遊戲入口'));
                return;
              }
            } catch (_) {}
            finish(resolve, packet.redirectUrl);
          } else if (packet && packet.message) {
            finish(reject, new Error(String(packet.message)));
          }
        }
      };
      ws.onerror = () => finish(reject, new Error('ATG 遊戲連線失敗'));
      ws.onclose = () => { if (!settled) finish(reject, new Error('ATG 遊戲連線中斷')); };
    });
  }

  async function directGameUrl(lobbyToken, gameCode) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await directGameUrlOnce(lobbyToken, gameCode, attempt === 0 ? 12000 : 9000);
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 180));
      }
    }
    throw lastError || new Error('ATG 遊戲連線失敗');
  }

  function setPlatform(value) {
    loginPlatform = value === 'OFA' ? 'OFA' : 'TZ';
    $('platformPickerText').textContent = loginPlatform + ' ONLINE';
    $('base').value = loginPlatform === 'OFA' ? 'https://www.ofa1188.net' : 'https://www.tz6868.cc';
    $('platformMenu').classList.add('hide');
    $('platformPicker').setAttribute('aria-expanded', 'false');
    $('err').textContent = '';
  }

  function showOnly(id) {
    ['loginView', 'gameCenterView', 'roomView'].forEach(view => $(view).classList.toggle('hide', view !== id));
  }

  function syncShellOrientation() {
    const portrait = window.innerHeight >= window.innerWidth;
    document.documentElement.classList.toggle('scarab-portrait', portrait);
    document.documentElement.classList.toggle('scarab-landscape', !portrait);
    document.body.classList.toggle('scarab-portrait', portrait);
    document.body.classList.toggle('scarab-landscape', !portrait);
    return portrait;
  }

  function resetShellLayout() {
    syncShellOrientation();
    // ATG itself may have just been landscape/full-screen. Never let any stale
    // inline dimensions/transforms leak into the app shell after closing it.
    ['gameCenterView','roomView','gcGames'].forEach(id => {
      const el = $(id);
      if (!el) return;
      ['width','height','minWidth','minHeight','maxWidth','maxHeight','transform','zoom','position','left','right','top','bottom','overflow'].forEach(k => {
        try { el.style[k] = ''; } catch (_) {}
      });
    });
    document.querySelectorAll('#gcGames .game-card').forEach(card => {
      ['height','minHeight','maxHeight','transform','top','left','right','bottom','position'].forEach(k => {
        try { card.style[k] = ''; } catch (_) {}
      });
    });
    // Recreate the grid formatting context after iOS rotates back from an ATG
    // landscape document. This avoids the stacked/overlapping card state.
    const grid = $('gcGames');
    if (grid && !$('gameCenterView').classList.contains('hide')) {
      const prior = grid.style.display;
      grid.style.display = 'none';
      void grid.offsetHeight;
      grid.style.display = prior || '';
    }
  }

  function showGameCenter() {
    stopRecommendationProbe();
    showOnly('gameCenterView');
    $('gcWho').textContent = '● ' + (session ? session.platform : loginPlatform) + ' ONLINE';
    renderGames();
    resetShellLayout();
    requestAnimationFrame(resetShellLayout);
    setTimeout(resetShellLayout, 220);
    setTimeout(resetShellLayout, 520);
    window.scrollTo(0, 0);
  }

  function renderGames() {
    const box = $('gcGames');
    box.innerHTML = '';
    GAMES.forEach(game => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'game-card';
      button.style.setProperty('--game-bg', 'url("' + game[2] + '")');
      button.innerHTML = '<img src="' + game[2] + '" alt=""><span class="game-shade"></span><span class="game-meta"><small>ATG · GAME</small><b>' + game[1] + '</b></span><span class="game-arrow">›</span>';
      button.onclick = () => chooseGame(game[0]);
      box.appendChild(button);
    });
  }

  async function login() {
    const button = $('loginBtn');
    const account = $('u').value.trim();
    const password = $('p').value;
    $('err').style.color = '';
    $('err').textContent = '';
    if (!account || !password) {
      $('err').textContent = '請輸入 ' + loginPlatform + ' 帳號與密碼';
      return;
    }
    button.disabled = true;
    button.textContent = '登入中…';
    try {
      const base = loginPlatform === 'OFA' ? 'https://www.ofa1188.net' : 'https://www.tz6868.cc';
      const result = await postJson(base + '/api/v1/login', {
        username: account,
        password,
        device_id: deviceId()
      });
      const token = result && result.data && result.data.token;
      if (!token) throw new Error((result && result.message) || '帳號或密碼錯誤');
      const access = await localAccess('/api/access/login', { username: account, platform: loginPlatform });
      if (!access.response.ok || !access.data.success || !access.data.sessionId) throw new Error(accessReasonText(access.data.reason));
      session = { base, token, account, password, platform: loginPlatform, game: '', accessSessionId: access.data.sessionId };
      startAccessWatch();
      if ($('r').checked) localStorage.setItem('scarab_login', JSON.stringify({ platform: loginPlatform, account }));
      else localStorage.removeItem('scarab_login');
      showGameCenter();
      refreshMember();
      if (window.SethEyeAPI && SethEyeAPI.bindLogin) {
        Promise.resolve(SethEyeAPI.bindLogin(account)).then(refreshMember).catch(error => log('會員資料暫時無法同步', error && error.message));
      }
    } catch (error) {
      session = null;
      $('err').textContent = error && error.message ? error.message : '登入失敗，請稍後重試';
    } finally {
      button.disabled = false;
      button.textContent = '登入聖甲之心';
    }
  }

  function logout(silent) {
    if (window.ScarabWebLauncher) ScarabWebLauncher.close();
    stopAccessWatch();
    const accessSessionId = session && session.accessSessionId;
    if (accessSessionId) localAccess('/api/access/logout', { sessionId: accessSessionId }).catch(() => null);
    session = null;
    boards = null;
    pendingPick = null;
    try { if (window.SethEyeAPI) SethEyeAPI.logout(); } catch (_) {}
    showOnly('loginView');
  }

  async function chooseGame(code) {
    if (!session || !GAME_META[code]) return;
    clearPreparedGameEntry();
    stopRecommendationProbe();
    // Invalidate every async result belonging to the previous game first.
    boardLoadSerial++;
    gameOpenSerial++;
    session.game = code;
    boards = null;
    pendingPick = null;
    activeBoard = 'composite';
    $('game').innerHTML = '<option value="' + code + '">' + code + '</option>';
    $('game').value = code;
    const item = GAMES.find(game => game[0] === code);
    $('who').textContent = item ? item[1] : code;
    $('room').value = '';
    $('err2').textContent = '';
    showOnly('roomView');
    loadBoards(code);
  }

  function operatorCode() {
    return session && session.platform === 'OFA' ? 'ofa' : '';
  }

  function probeBase64url(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value || {}));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function stopRecommendationProbe() {
    const p = recommendationProbe;
    recommendationProbe = null;
    recommendationProbeSerial++;
    if (!p) return;
    try { clearTimeout(p.timer); } catch (_) {}
    try { window.removeEventListener('message', p.listener); } catch (_) {}
    try { if (p.frame) { p.frame.src = 'about:blank'; p.frame.remove(); } } catch (_) {}
    try { if (p.reject) p.reject(new Error('probe-cancelled')); } catch (_) {}
  }

  async function requestAtgLobbyUrl() {
    if (!session) throw new Error('尚未登入');
    const request = async token => {
      const body = session.platform === 'OFA'
        ? { game_return_url: 'https://www.ofa1188.net', game_kind: 'SLOT', game_device: 'Desktop', game_money: '' }
        : { game_return_url: session.base, game_kind: '', game_type: '', game_device: 'Desktop' };
      const result = await postJson(session.base + '/api/v2/game/ATG/login', body, token);
      return result && result.data && result.data.game_url;
    };
    let url = await request(session.token);
    if (!url) {
      const relogin = await postJson(session.base + '/api/v1/login', {
        username: session.account,
        password: session.password,
        device_id: deviceId()
      });
      const token = relogin && relogin.data && relogin.data.token;
      if (!token) throw new Error('登入已過期，請重新登入');
      session.token = token;
      url = await request(token);
    }
    if (!url) throw new Error('ATG 沒有回傳遊戲網址');
    return url;
  }

  async function resolveAtgGameUrl(gameCode) {
    const lobbyUrl = await requestAtgLobbyUrl();
    const tokenMatch = lobbyUrl.match(/[?&]t=([^&]+)/);
    if (!tokenMatch) return lobbyUrl;
    return directGameUrl(tokenMatch[1], gameCode);
  }

  function clearPreparedGameEntry() {
    preparedGameEntry = null;
    preparedGameEntrySerial++;
  }

  function prepareGameEntry(gameCode) {
    const game = String(gameCode || '');
    if (!session || !game || session.game !== game) return Promise.resolve(null);
    const now = Date.now();

    if (preparedGameEntry &&
        preparedGameEntry.game === game &&
        now - preparedGameEntry.at < PREPARED_ENTRY_MS) {
      return preparedGameEntry.promise;
    }

    const serial = ++preparedGameEntrySerial;
    const promise = resolveAtgGameUrl(game)
      .then(url => {
        if (!session || session.game !== game || serial !== preparedGameEntrySerial) return null;
        return url;
      })
      .catch(error => {
        if (preparedGameEntry && preparedGameEntry.serial === serial) preparedGameEntry = null;
        throw error;
      });

    preparedGameEntry = { game, at: now, serial, promise };
    return promise;
  }

  async function consumePreparedGameEntry(gameCode) {
    const game = String(gameCode || '');
    const item = preparedGameEntry;
    if (item && item.game === game && Date.now() - item.at < PREPARED_ENTRY_MS) {
      preparedGameEntry = null;
      try {
        const url = await item.promise;
        if (url) return url;
      } catch (_) {}
    }
    return resolveAtgGameUrl(game);
  }

  function rankPercent(rows, getter, descending) {
    const sorted = rows.slice().sort((a,b) => {
      const av = Number(getter(a) || 0), bv = Number(getter(b) || 0);
      return descending === false ? av - bv : bv - av;
    });
    const map = new Map();
    const denom = Math.max(1, sorted.length - 1);
    sorted.forEach((row, i) => map.set(row.machineNum, 1 - i / denom));
    return map;
  }

  function realBoardsFromTables(tables) {
    const rows = (Array.isArray(tables) ? tables : []).map(raw => {
      const machineNum = String(raw.machineNum == null ? '' : raw.machineNum);
      const roomId = String(raw.roomId == null ? '' : raw.roomId);
      const status = String(raw.status || '');
      const todayBet = Number(raw.todayBet || 0);
      const todayWin = Number(raw.todayWin || 0);
      const bet = Number(raw.bet || 0);
      const win = Number(raw.win || 0);
      const liveBet = todayBet > 0 ? todayBet : bet;
      const liveWin = todayBet > 0 ? todayWin : win;
      const rtp = liveBet > 0 ? liveWin / liveBet * 100 : 0;
      return {
        roomId,
        machineNum,
        status,
        isLocked: !!raw.isLocked || /locked/i.test(status),
        available: !raw.isLocked && !/locked/i.test(status) && !/full/i.test(status),
        rtp: Number.isFinite(rtp) ? Math.round(rtp * 100) / 100 : 0,
        bet: liveBet,
        win: liveWin,
        profit: liveWin - liveBet,
        rawFree: raw.rawFree == null ? null : Number(raw.rawFree)
      };
    }).filter(x => /^\d+$/.test(x.machineNum) && x.roomId);

    const unique = [];
    const seen = new Set();
    rows.forEach(row => { if (!seen.has(row.machineNum)) { seen.add(row.machineNum); unique.push(row); } });
    const available = unique.filter(x => x.available);
    const pool = available.length >= 10 ? available : unique.filter(x => !x.isLocked);
    if (!pool.length) return emptyBoards();

    const rtpRank = rankPercent(pool, x => x.rtp, true);
    const betRank = rankPercent(pool, x => Math.log10(Math.max(1, x.bet)), true);
    const profitRank = rankPercent(pool, x => x.profit, true);
    const lowProfitRank = rankPercent(pool, x => x.profit, false);

    pool.forEach(row => {
      const rr = rtpRank.get(row.machineNum) || 0;
      const br = betRank.get(row.machineNum) || 0;
      const pr = profitRank.get(row.machineNum) || 0;
      row.score = Math.round(600 + rr * 240 + br * 120 + pr * 39);
    });

    const cloneRank = (sorter, label) => pool.slice().sort(sorter).slice(0,10).map(x => Object.assign({}, x, {source:'ATG', metric:label}));
    const composite = cloneRank((a,b) => b.score - a.score, '即時綜合');
    const volatility = cloneRank((a,b) => (b.rtp - a.rtp) || (b.bet - a.bet), '即時RTP');
    const premium = cloneRank((a,b) => (b.bet - a.bet) || (b.rtp - a.rtp), '投注熱度');
    let freegame;
    if (pool.some(x => x.rawFree != null && Number.isFinite(x.rawFree))) {
      freegame = cloneRank((a,b) => (Number(a.rawFree || 0) - Number(b.rawFree || 0)) || (b.bet - a.bet), '免遊次數');
    } else {
      // ATG table packets do not expose free-game history for every title.
      // Keep this tab real-data-only by ranking low paid-out profit with high play volume;
      // never fabricate a free-game count.
      freegame = pool.slice().sort((a,b) => {
        const al = lowProfitRank.get(a.machineNum) || 0, bl = lowProfitRank.get(b.machineNum) || 0;
        const ab = betRank.get(a.machineNum) || 0, bb = betRank.get(b.machineNum) || 0;
        return (bl * .7 + bb * .3) - (al * .7 + ab * .3);
      }).slice(0,10).map(x => Object.assign({}, x, {source:'ATG', metric:'即時低派彩/高投注'}));
    }
    return { composite, volatility, premium, freegame, updatedAt: Date.now(), source: 'ATG_REALTIME' };
  }

  const SIM_RECOMMEND_GAMES = new Set([
    'tiger-princess',
    'hades',
    'wuxia-caishen',
    'son-go-ku',
    'new-vampire-hunter',
    'new-jinlian'
  ]);

  // ONLY these six titles use instant simulated recommendation rows.
  // Other titles continue to use the real recommendation pipeline.
  const SIM_MACHINE_POOLS = {
    // 虎小妹：1~3000，10 台分散在整個區間。
    'tiger-princess': [
      '218','558','908','1274','1508','1769','2045','2376','2745','2988'
    ],

    // 古神巴風特：只使用 1~1000，10 台分散在整個區間。
    'hades': [
      '84','176','253','368','474','509','624','731','846','997'
    ],

    // 武俠：只有 1~110。
    'wuxia-caishen': [
      '8','18','30','44','57','69','84','97','104','109'
    ],

    // 孫行者：只有 1~100。
    'son-go-ku': [
      '7','18','29','41','54','66','73','84','95','99'
    ],

    // 惡魔血域：只有 1~200。
    'new-vampire-hunter': [
      '18','30','51','73','84','109','128','147','176','198'
    ],

    // 金蓮三缺一：只有 1~500。
    'new-jinlian': [
      '18','73','109','176','251','303','368','421','475','497'
    ]
  };

  function instantSimBoards(gameCode) {
    const machines = (SIM_MACHINE_POOLS[gameCode] || []).slice(0, 10);

    // Deterministic shuffle so each game has a stable but non-obvious ranking.
    const ranked = machines.map(machineNum => ({
      machineNum: String(machineNum),
      seed: simHash(gameCode + ':' + machineNum)
    })).sort((a,b) => (b.seed % 100000) - (a.seed % 100000));

    function makeRow(entry, rank, salt) {
      const machineNum = entry.machineNum;
      const seed = simHash(gameCode + ':' + machineNum + ':' + salt);

      // RTP is ALWAYS below 100%.
      // Top 1-3 are the only noticeably stronger recommendations.
      // The rest deliberately spread down into normal-looking ranges.
      let rtp;
      if (rank === 0) {
        rtp = 94.60 + (seed % 210) / 100;      // 94.60 ~ 96.69
      } else if (rank === 1) {
        rtp = 91.20 + (seed % 260) / 100;      // 91.20 ~ 93.79
      } else if (rank === 2) {
        rtp = 84.50 + (seed % 360) / 100;      // 84.50 ~ 88.09
      } else {
        const floors = [78.8, 72.6, 66.4, 59.8, 53.2, 46.8, 40.5];
        const spans  = [4.2,  4.4,  4.6,  4.8,  5.0,  5.2,  4.8];
        const idx = Math.min(rank - 3, floors.length - 1);
        const base = floors[idx];
        const span = spans[idx];
        rtp = base + ((seed % Math.round(span * 100)) / 100);
      }
      rtp = Math.min(96.69, Math.round(rtp * 100) / 100);

      // Scores also taper instead of clustering near 900.
      const scoreBands = [895, 874, 856, 822, 803, 785, 766, 748, 731, 715];
      const score = Math.max(700, scoreBands[rank] - (seed % 11));

      const bet = 1200 + ((seed >>> 7) % 7800);
      const win = Math.round(bet * rtp / 100);

      return {
        roomId: '__machine__' + machineNum,
        machineNum,
        status: 'test',
        isLocked: false,
        available: true,
        rtp,
        bet,
        win,
        profit: win - bet,
        score,
        simulated: true,
        source: 'TEST_RECOMMENDATION',
        metric: ''
      };
    }

    const composite = ranked.map((x,i) => makeRow(x,i,'composite'));
    const volatility = ranked
      .map((x,i) => makeRow(x,i,'hot'))
      .sort((a,b) => b.rtp - a.rtp);
    const premium = ranked
      .map((x,i) => makeRow(x,i,'premium'))
      .sort((a,b) => b.bet - a.bet);
    const freegame = ranked
      .map((x,i) => makeRow(x,i,'free'))
      .sort((a,b) => a.score - b.score);

    return {
      composite,
      volatility,
      premium,
      freegame,
      updatedAt: Date.now(),
      source: 'TEST_RECOMMENDATION',
      simulated: true
    };
  }


  function simHash(text) {
    let h = 2166136261 >>> 0;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function simulatedBoardsFromTables(gameCode, tables) {
    // IMPORTANT: only the displayed recommendation metrics are simulated.
    // machineNum / roomId / availability always come from the live ATG table.
    const rawRows = (Array.isArray(tables) ? tables : []).map(raw => {
      const machineNum = String(raw.machineNum == null ? '' : raw.machineNum);
      const roomId = String(raw.roomId == null ? '' : raw.roomId);
      const status = String(raw.status || '');
      const locked = !!raw.isLocked || /locked/i.test(status);
      if (!/^\d+$/.test(machineNum) || !roomId || locked) return null;

      const liveRtp = Number(raw.todayBet || 0) > 0
        ? Number(raw.todayWin || 0) / Number(raw.todayBet || 1) * 100
        : (Number(raw.bet || 0) > 0 ? Number(raw.win || 0) / Number(raw.bet || 1) * 100 : NaN);

      const seed = simHash(gameCode + ':' + machineNum);
      // Keep values deliberately moderate. If a real RTP exists, stay close to it;
      // otherwise use a conservative 82~122% range.
      let rtp;
      if (Number.isFinite(liveRtp) && liveRtp > 0) {
        const jitter = ((seed % 700) / 100) - 3.5; // -3.5 ~ +3.49
        rtp = Math.max(78, Math.min(128, liveRtp + jitter));
      } else {
        rtp = 82 + (seed % 4000) / 100; // 82.00 ~ 121.99
      }

      const score = 760 + (seed % 151); // 760 ~ 910
      const heat = 1000 + ((seed >>> 8) % 9000);
      return {
        roomId,
        machineNum,
        status,
        isLocked: false,
        available: true,
        rtp: Math.round(rtp * 100) / 100,
        bet: heat,
        win: Math.round(heat * rtp / 100),
        profit: Math.round(heat * (rtp / 100 - 1)),
        score,
        simulated: true,
        source: 'ATG_REAL_ROOM_SIM_METRIC'
      };
    }).filter(Boolean);

    const seen = new Set();
    const rows = rawRows.filter(row => {
      if (seen.has(row.machineNum)) return false;
      seen.add(row.machineNum);
      return true;
    });
    if (!rows.length) return emptyBoards();

    // Pick a stable top 10 from real currently available machines.
    const composite = rows.slice().sort((a,b) => (b.score - a.score) || (b.rtp - a.rtp)).slice(0,10)
      .map(x => Object.assign({}, x, {metric:'模擬綜合'}));
    const volatility = rows.slice().sort((a,b) => (b.rtp - a.rtp) || (b.score - a.score)).slice(0,10)
      .map(x => Object.assign({}, x, {metric:'模擬爆分'}));
    const premium = rows.slice().sort((a,b) => (b.bet - a.bet) || (b.score - a.score)).slice(0,10)
      .map(x => Object.assign({}, x, {metric:'模擬熱度'}));
    const freegame = rows.slice().sort((a,b) => {
      const ah = simHash('fg:'+gameCode+':'+a.machineNum);
      const bh = simHash('fg:'+gameCode+':'+b.machineNum);
      return (ah - bh) || (b.score - a.score);
    }).slice(0,10).map(x => Object.assign({}, x, {metric:'模擬免遊'}));

    return {
      composite,
      volatility,
      premium,
      freegame,
      updatedAt: Date.now(),
      source: 'ATG_REAL_ROOM_SIM_METRIC',
      simulated: true
    };
  }

  async function probeAtgTables(gameCode) {
    stopRecommendationProbe();
    const serial = ++recommendationProbeSerial;
    const finalUrl = await resolveAtgGameUrl(gameCode);
    if (!session || session.game !== gameCode || serial !== recommendationProbeSerial) throw new Error('probe-cancelled');

    const target = new URL(finalUrl);
    target.searchParams.set('table', '1');
    const payload = { kind:'atg', probe:true, gameCode:gameCode, gameMeta:GAME_META[gameCode] || {}, cfg:{ GAME_CODE:gameCode, PROBE:true } };
    const encoded = probeBase64url(payload);

    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden','true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed!important;left:-10000px!important;top:-10000px!important;width:16px!important;height:16px!important;opacity:0!important;pointer-events:none!important;border:0!important;';
      const cleanup = () => {
        try { clearTimeout(timer); } catch (_) {}
        try { window.removeEventListener('message', listener); } catch (_) {}
        try { frame.src='about:blank'; frame.remove(); } catch (_) {}
        if (recommendationProbe && recommendationProbe.frame === frame) recommendationProbe = null;
      };
      const listener = event => {
        if (event.source !== frame.contentWindow) return;
        const data = event.data;
        if (!data || data.__scarabRecommendationProbe !== true || String(data.gameCode || '') !== gameCode) return;
        if (data.ok && Array.isArray(data.tables) && data.tables.length >= 10) {
          cleanup(); resolve(data.tables);
        } else if (data.ok === false) {
          cleanup(); reject(new Error(data.error || 'ATG 即時機台資料讀取失敗'));
        }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('ATG 即時機台資料逾時')); }, 22000);
      recommendationProbe = {frame, listener, timer, reject};
      window.addEventListener('message', listener);
      document.body.appendChild(frame);
      frame.src = '/__game/open?url=' + encodeURIComponent(target.href) + '&cfg=' + encodeURIComponent(encoded);
    });
  }

  async function loadBoards(gameCode, options) {
    const game = String(gameCode || (session && session.game) || '');
    if (!game || !session || session.game !== game) return;

    const serial = ++boardLoadSerial;
    if (SIM_RECOMMEND_GAMES.has(game)) {
      stopRecommendationProbe();
      pendingPick = null;
      const simulated = normalizeBoards(instantSimBoards(game));
      boards = simulated;
      boardCache[game] = { at: Date.now(), value: simulated };
      $('updTime').textContent = '更新 ' + formatTime(simulated.updatedAt);
      renderBoard();
      return;
    }

    const box = $('recommend');
    pendingPick = null;

    // Show the last REAL result immediately while refreshing.
    // This removes the blank 10~20 second wait when returning to this game.
    let instant = null;
    const memory = boardCache[game] && boardCache[game].value;
    if (memory && usableBoardCount(memory) > 0) instant = normalizeBoards(memory);
    if (!instant) instant = loadRealBoardStorage(game);

    if (instant && usableBoardCount(instant) > 0) {
      boards = instant;
      $('updTime').textContent = '更新中';
      renderBoard();
    } else {
      boards = null;
      box.innerHTML = '<div style="color:#7893a9;font-size:12px;padding:16px">正在讀取真實機台資料…</div>';
      $('updTime').textContent = '讀取中';
    }

    let renderedFresh = false;

    const showFresh = (value, source) => {
      if (!session || session.game !== game || serial !== boardLoadSerial) return false;
      const normalized = normalizeBoards(value);
      if (usableBoardCount(normalized) < 1) return false;
      normalized.updatedAt = Date.now();
      normalized.source = source || normalized.source || 'REAL';
      boards = normalized;
      boardCache[game] = { at: Date.now(), value: normalized };
      saveRealBoardStorage(game, normalized);
      $('updTime').textContent = '更新 ' + formatTime(normalized.updatedAt);
      renderBoard();
      renderedFresh = true;
      return true;
    };

    // Run BOTH real-data sources in parallel.
    // API can be much faster for titles it already supports.
    // ATG probe remains authoritative and replaces API data when it arrives.
    let apiPromise = Promise.resolve(null);
    if (window.SethEyeAPI && SethEyeAPI.boards) {
      apiPromise = SethEyeAPI.boards(game, operatorCode())
        .then(value => {
          if (!session || session.game !== game || serial !== boardLoadSerial) return null;
          const normalized = normalizeBoards(value);
          if (usableBoardCount(normalized) > 0) {
            showFresh(normalized, 'REAL_API');
            return normalized;
          }
          return null;
        })
        .catch(error => {
          log('推薦 API 快速來源未取得資料', game, error && error.message);
          return null;
        });
    }

    const probePromise = probeAtgTables(game)
      .then(tables => {
        if (!session || session.game !== game || serial !== boardLoadSerial) return null;
        const value = SIM_RECOMMEND_GAMES.has(game)
          ? normalizeBoards(simulatedBoardsFromTables(game, tables))
          : normalizeBoards(realBoardsFromTables(tables));
        if (usableBoardCount(value) < 1) throw new Error('ATG 沒有回傳可用機台');
        showFresh(value, SIM_RECOMMEND_GAMES.has(game) ? 'ATG_REAL_ROOM_SIM_METRIC' : 'ATG_REALTIME');
        return value;
      })
      .catch(error => {
        if (String(error && error.message || '') !== 'probe-cancelled') {
          log('ATG 即時推薦讀取失敗', game, error && error.message);
        }
        return null;
      });

    const [apiResult, probeResult] = await Promise.all([apiPromise, probePromise]);
    if (!session || session.game !== game || serial !== boardLoadSerial) return;

    if (!renderedFresh && !apiResult && !probeResult) {
      if (instant && usableBoardCount(instant) > 0) {
        boards = instant;
        $('updTime').textContent = '暫用最近真實資料';
        renderBoard();
      } else {
        boards = emptyBoards();
        $('updTime').textContent = '讀取失敗';
        box.innerHTML = '<div style="color:#ff9a82;font-size:12px;padding:16px">目前無法取得真實機台資料，請按「刷新」重試。</div>';
      }
    }
  }

  function formatTime(value) {
    let date = value ? new Date(Number(value) < 1e12 && Number(value) > 0 ? Number(value) * 1000 : value) : new Date();
    if (Number.isNaN(date.getTime())) date = new Date();
    return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function renderBoard() {
    document.querySelectorAll('.board-tab').forEach(button => button.classList.toggle('active', button.dataset.k === activeBoard));
    const box = $('recommend');
    let list = (boards && Array.isArray(boards[activeBoard])) ? boards[activeBoard] : [];
    let usingFallback = false;
    if (!list.length && activeBoard !== 'composite' && boards && Array.isArray(boards.composite) && boards.composite.length) {
      list = boards.composite;
      usingFallback = true;
    }
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div style="color:#7893a9;font-size:12px;padding:16px">推薦資料正在同步；你也可以輸入機台號碼或進入大廳。</div>';
      return;
    }
    if (usingFallback) {
      const note = document.createElement('div');
      note.style.cssText = 'color:#7893a9;font-size:11px;padding:2px 4px 6px';
      note.textContent = '此分類暫無資料，先顯示綜合推薦';
      box.appendChild(note);
    }
    list.slice(0, 10).forEach((item, index) => {
      const machine = item.machineNum == null ? '—' : String(item.machineNum);
      const locked = !item.roomId || item.isLocked === true;
      const row = document.createElement('div');
      row.className = 'room-card';
      const metric = item.metric ? ' · ' + item.metric : '';
      const simMark = '';
      row.innerHTML = '<span class="room-rank">' + (index + 1) + '</span><span><b>' + (locked ? '🔒 ' + machine.padStart(3, '0') + ' 號機台' : machine.padStart(3, '0') + ' 號機台') + '</b><small>' + BOARD_META[activeBoard][0] + (item.rtp != null ? ' · RTP ' + item.rtp + '%' : '') + metric + simMark + '</small></span><span class="score">' + (item.score == null ? '—' : item.score) + '</span>';
      if (!locked) {
        row.style.cursor = 'pointer';
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.setAttribute('aria-label', '選擇 ' + machine + ' 號機台');
        row.onclick = () => selectRoom(item);
        row.onkeydown = event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectRoom(item);
          }
        };
      } else row.style.opacity = '.58';
      box.appendChild(row);
    });
  }

  function ensureRoomConfirmModal() {
    let modal = document.getElementById('roomConfirmModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'roomConfirmModal';
    modal.className = 'hide';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML =
      '<div class="room-confirm-backdrop"></div>' +
      '<section class="room-confirm-card" role="dialog" aria-modal="true" aria-labelledby="roomConfirmTitle">' +
        '<div id="roomConfirmTitle" class="room-confirm-title">確定選擇此機台嗎？</div>' +
        '<div class="room-confirm-machine">編號 <b id="roomConfirmMachine">#—</b></div>' +
        '<div class="room-confirm-actions">' +
          '<button id="roomConfirmCancel" type="button" class="secondary">取消</button>' +
          '<button id="roomConfirmOk" type="button" class="primary">確定</button>' +
        '</div>' +
      '</section>';
    document.body.appendChild(modal);

    const style = document.createElement('style');
    style.id = 'roomConfirmStyle';
    style.textContent =
      '#roomConfirmModal{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px}' +
      '#roomConfirmModal.hide{display:none}' +
      '#roomConfirmModal .room-confirm-backdrop{position:absolute;inset:0;background:rgba(0,8,18,.72);backdrop-filter:blur(5px)}' +
      '#roomConfirmModal .room-confirm-card{position:relative;width:min(420px,calc(100vw - 36px));background:#071827;border:1px solid #1e4963;border-radius:18px;padding:28px 24px 22px;box-shadow:0 20px 70px rgba(0,0,0,.46);text-align:center}' +
      '#roomConfirmModal .room-confirm-title{font-size:22px;font-weight:900;color:#eef8ff;margin-bottom:15px}' +
      '#roomConfirmModal .room-confirm-machine{font-size:17px;color:#91aabd;margin-bottom:24px}' +
      '#roomConfirmModal .room-confirm-machine b{display:inline-block;margin-left:5px;font-size:25px;color:#58d9ff;letter-spacing:.5px}' +
      '#roomConfirmModal .room-confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
      '#roomConfirmModal button{min-height:48px;font-size:16px;font-weight:850;border-radius:12px}' +
      '@media(max-width:520px){#roomConfirmModal .room-confirm-card{padding:24px 18px 18px}#roomConfirmModal .room-confirm-title{font-size:20px}}';
    document.head.appendChild(style);
    return modal;
  }

  function confirmRoom(machineNum) {
    return new Promise(resolve => {
      const modal = ensureRoomConfirmModal();
      const machine = document.getElementById('roomConfirmMachine');
      const ok = document.getElementById('roomConfirmOk');
      const cancel = document.getElementById('roomConfirmCancel');
      const backdrop = modal.querySelector('.room-confirm-backdrop');
      machine.textContent = '#' + String(machineNum || '');
      modal.classList.remove('hide');
      modal.setAttribute('aria-hidden', 'false');

      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        modal.classList.add('hide');
        modal.setAttribute('aria-hidden', 'true');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onKey = event => {
        if (event.key === 'Escape') finish(false);
        else if (event.key === 'Enter') finish(true);
      };
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKey);
      setTimeout(() => ok.focus(), 0);
    });
  }

  async function selectRoom(item) {
    if (!item || item.machineNum == null) return;
    const machineNum = String(item.machineNum);
    prepareGameEntry(session && session.game).catch(() => null);
    const accepted = await confirmRoom(machineNum);
    if (!accepted) return;

    pendingPick = {
      roomId: String(item.roomId || ''),
      machineNum,
      board: activeBoard,
      boardName: BOARD_META[activeBoard][0]
    };
    $('room').value = machineNum;
    $('err2').style.color = '#70e7b0';
    $('err2').textContent = '正在進入 #' + machineNum + ' 機台…';
    await enterGame('target');
  }

  async function refreshMember() {
    const element = $('coinBal');
    if (!element || !window.SethEyeAPI || !SethEyeAPI.member || !SethEyeAPI.token) {
      if (element) element.textContent = '會員資料尚未同步';
      return;
    }
    try {
      const member = await SethEyeAPI.member();
      element.textContent = '金幣 ' + (member.gold == null ? '—' : member.gold) + '　銀幣 ' + (member.silver == null ? '—' : member.silver);
    } catch (_) {
      element.textContent = '會員資料暫時無法同步';
    }
  }

  function showRoomPickToast(machineNum, gameCode) {
    const toast = $('roomPickToast');
    const num = String(machineNum || '').trim();
    if (!toast) return;
    const portraitGame = PORTRAIT_ROOM_GAMES.has(String(gameCode || ''));
    if (!portraitGame || !num) {
      toast.classList.add('hide');
      return;
    }
    const n = $('roomPickNumber');
    const s = $('roomPickState');
    if (n) n.textContent = '#' + num;
    if (s) s.textContent = '正在定位機台中…';
    toast.classList.remove('hide');
  }

  function hideRoomPickToast() {
    const toast = $('roomPickToast');
    if (toast) toast.classList.add('hide');
  }

  function gameConfig(target, machineNum, boardName, boardList, targetKind) {
    const goodRooms = ((boards && boards.composite) || []).filter(x => x && x.machineNum != null).slice(0, 3).map(x => ({
      roomId: x.roomId,
      machineNum: x.machineNum,
      rtp: x.rtp != null ? x.rtp : x.todayRtp,
      bet: x.bet != null ? x.bet : x.todayBet,
      profit: x.profit != null ? x.profit : x.todayPnl
    }));
    return {
      TARGET: String(target || ''),
      TARGET_KIND: targetKind || null,
      MACHINENUM: String(machineNum || ''),
      MUTE: true,
      DEBUG: false,
      TAKE_PROFIT: 0,
      STOP_LOSS: 0,
      SPEED: 1,
      UI: 'none',
      NO_SHIFT: true,
      BOARD_NAME: boardName || '',
      BOARD_LIST: boardList || null,
      GOOD_ROOMS: goodRooms,
      GAME_CODE: session.game,
      GAME_ID: (GAME_META[session.game] || {}).gameId || null,
      GAME_MECHANISM: (GAME_META[session.game] || {}).mechanism || '',
      GAME_CHECKSUM: (GAME_META[session.game] || {}).checksum || '',
      FULL_ROOM_ID: pendingPick && pendingPick.roomId ? String(pendingPick.roomId) : '',
      EXACT_ROOM: PORTRAIT_ROOM_GAMES.has(String(session.game || '')) && !!String(machineNum || '').trim(),
      PORTRAIT_ROOM_MODE: PORTRAIT_ROOM_GAMES.has(String(session.game || '')),
      VISUAL_TARGET: String(machineNum || target || ''),
      VISUAL_TARGET_KIND: 'machineNum',
      ROOM_SESSION_ID: currentRoomSessionId,
      FORCE_ROOM_RESET: true,
      SETH_ACCOUNT: session.account,
      APP_VER: APP_VERSION,
      AGENT_MODE: true
    };
  }

  async function enterGame(mode) {
    if (!session || !session.game) return;
    // Recommendation probe must never overlap the real game session.
    stopRecommendationProbe();
    // A previous room timeout must never disable the next exact-room request.
    try {
      sessionStorage.removeItem('SCARAB_FORCE_MANUAL_ROOM');
      sessionStorage.removeItem('scarab_force_manual_room');
      sessionStorage.removeItem('SCARAB_ROOM_FALLBACK');
      // Actual keys used by atg-engine-runtime:
      sessionStorage.removeItem('seth_seated');
      sessionStorage.removeItem('seth_switched');
    } catch (_) {}
    const requestedGame = session.game;
    const openSerial = ++gameOpenSerial;
    currentRoomSessionId = String(Date.now()) + '-' + String(++roomSessionSerial);
    const buttons = [$('enterBtn'), $('skipBtn')];
    buttons.forEach(button => { button.disabled = true; });
    $('err2').style.color = '';
    $('err2').textContent = '正在取得 ATG 遊戲連線…';
    try {
      let target = '';
      let machineNum = '';
      let targetKind = null;
      let boardName = '';
      let boardList = null;
      if (mode === 'manual') {
        target = '';
      } else if (pendingPick && String($('room').value).trim() === pendingPick.machineNum) {
        // Seth-eye roomId is NOT guaranteed to be ATG's current live roomId.
        // The user's video proved this: recommended machine 2169 became "#23".
        // Therefore machineNum is the only authoritative auto-room target.
        //
        // Keep TARGET non-numeric so the engine enters its auto-room path,
        // but force its built-in machine fallback to the real visible machineNum.
        machineNum = String(pendingPick.machineNum || '');
        target = '__machine__' + machineNum;
        targetKind = 'roomId';
        boardName = pendingPick.boardName;
        const source = (boards && boards[pendingPick.board]) || [];
        boardList = source.filter(x => x && x.roomId && x.machineNum != null).map(x => ({ roomId: String(x.roomId), machineNum: String(x.machineNum), score: x.score }));
      } else {
        machineNum = String($('room').value || '').trim();
        if (!machineNum) throw new Error('請輸入機台號碼，或選擇「進入大廳自行選擇」');
        target = '__machine__' + machineNum;
        targetKind = 'roomId';
      }

      let finalUrl;
      try { finalUrl = await consumePreparedGameEntry(requestedGame); }
      catch (error) {
        log('ATG 遊戲入口取得失敗', requestedGame, error && error.message);
        finalUrl = await requestAtgLobbyUrl();
      }
      if (!session || session.game !== requestedGame || openSerial !== gameOpenSerial) return;
      try {
        const parsedFinal = new URL(finalUrl);
        const returnedCode = parsedFinal.searchParams.get('gn');
        if (returnedCode && returnedCode !== requestedGame) throw new Error('ATG 遊戲入口與目前選擇不一致，請再試一次');
      } catch (error) {
        if (error && /目前選擇/.test(String(error.message))) throw error;
      }
      const config = gameConfig(target, machineNum, boardName, boardList, targetKind);
      if (!window.ScarabWebLauncher) throw new Error('程式內遊戲載入器未就緒');
      showRoomPickToast(machineNum, requestedGame);
      ScarabWebLauncher.open(finalUrl, { kind: 'atg', gameCode: requestedGame, gameMeta: GAME_META[requestedGame], cfg: config });
      $('err2').textContent = '';
    } catch (error) {
      hideRoomPickToast();
      $('err2').textContent = error && error.message ? error.message : '進入遊戲失敗';
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function closeGame(destination) {
    clearPreparedGameEntry();
    hideRoomPickToast();
    // Invalidate async work from the game instance that is being closed.
    // This does NOT alter room selection/fallback logic; it only prevents
    // an old iframe/session from taking control after the user picks again.
    gameOpenSerial++;
    currentRoomSessionId = '';
    if (window.ScarabWebLauncher) ScarabWebLauncher.close();
    try {
      sessionStorage.removeItem('seth_seated');
      sessionStorage.removeItem('seth_switched');
      sessionStorage.removeItem('SCARAB_FORCE_MANUAL_ROOM');
      sessionStorage.removeItem('SCARAB_ROOM_FALLBACK');
    } catch (_) {}
    if (destination === 'home') showGameCenter();
    else {
      showOnly('roomView');
      resetShellLayout();
      requestAnimationFrame(resetShellLayout);
      setTimeout(resetShellLayout, 220);
      pendingPick = null;
      $('room').value = '';
      $('err2').style.color = '';
      $('err2').textContent = '';
      // Returning from a real ATG session must always calculate a fresh
      // recommendation set. Never reuse the pre-game in-memory list.
      if (session && session.game) {
        delete boardCache[session.game];
        boards = null;
        loadBoards(session.game, { force: true });
      }
    }
  }

  function handleGameCommand(url) {
    const command = String(url || '');
    if (!command) return;
    if (/__sethcmd__\/pick/.test(command)) {
      let found = null;
      try {
        const parsed = new URL(command);
        const roomId = parsed.searchParams.get('ri') || '';
        const machineNum = parsed.searchParams.get('mn') || '';
        found = ((boards && boards.composite) || []).find(x => String(x.roomId || '') === roomId || String(x.machineNum || '') === machineNum) || null;
      } catch (_) {}
      // Close the old game first so its callbacks are invalidated, then start
      // the newly selected room. The original selection rules are untouched.
      closeGame('rooms');
      if (found) setTimeout(() => selectRoom(found), 0);
      return;
    }
    if (/__sethcmd__\/rooms/.test(command)) { closeGame('rooms'); return; }
    if (/__sethcmd__\/home/.test(command)) { closeGame('home'); return; }
    if (/__sethcmd__\/deposit/.test(command)) {
      closeGame('rooms');
      $('err2').textContent = '請回娛樂城完成儲值後再重新進入遊戲。';
    }
  }

  function safeAnnouncementUrl(raw) {
    try {
      const url = new URL(String(raw || ''));
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || host === 'line.me' || host.endsWith('.line.me') || host === 'lin.ee' || host.endsWith('.lin.ee') || host.includes('line-apps')) return '';
      return url.href;
    } catch (_) { return ''; }
  }

  async function loadAnnouncement() {
    const box = $('announce');
    if (!box) return;
    $('announceImg').src = 'media/scarab-heart-launch.png';
    $('announceImg').classList.remove('hide');
    $('announceTitle').textContent = '🔥 聖甲之心 正式登場 🛡️';
    $('announceTitle').classList.remove('hide');
    $('announceText').textContent = '全新遊戲現已開放！點擊遊戲，立即進入《聖甲之心》!!';
    $('announceText').classList.remove('hide');
    $('announceBtn').classList.add('hide');
    box.classList.remove('hide');
  }

  $('platformPicker').onclick = function () {
    $('platformMenu').classList.toggle('hide');
    this.setAttribute('aria-expanded', $('platformMenu').classList.contains('hide') ? 'false' : 'true');
  };
  document.querySelectorAll('#platformMenu [data-platform]').forEach(button => {
    button.onclick = () => setPlatform(button.dataset.platform);
  });
  document.querySelectorAll('.board-tab').forEach(button => {
    button.onclick = () => { activeBoard = button.dataset.k; renderBoard(); };
  });
  $('loginBtn').onclick = login;
  $('p').addEventListener('keydown', event => { if (event.key === 'Enter') login(); });
  $('gcLogout').onclick = logout;
  $('logoutBtn').onclick = logout;
  $('roomBack').onclick = showGameCenter;
  $('refreshBtn').onclick = async function () {
    this.disabled = true;
    this.textContent = '刷新中…';
    await loadBoards(session && session.game, { force: true });
    await refreshMember();
    this.disabled = false;
    this.textContent = '↻ 刷新';
  };
  ['enterBtn','skipBtn'].forEach(id => {
    const button = $(id);
    if (!button) return;
    const warm = () => { prepareGameEntry(session && session.game).catch(() => null); };
    button.addEventListener('pointerdown', warm, { passive: true });
    button.addEventListener('touchstart', warm, { passive: true });
  });
  $('enterBtn').onclick = () => enterGame();
  $('skipBtn').onclick = () => enterGame('manual');
  $('gameExit').onclick = () => closeGame('rooms');
  window.addEventListener('scarab:web-command', event => handleGameCommand(event && event.detail && event.detail.url));

  syncShellOrientation();
  window.addEventListener('resize', () => {
    syncShellOrientation();
    if (!$('gameCenterView').classList.contains('hide')) {
      requestAnimationFrame(resetShellLayout);
    }
  }, { passive: true });
  window.addEventListener('orientationchange', () => {
    setTimeout(resetShellLayout, 120);
    setTimeout(resetShellLayout, 360);
    setTimeout(resetShellLayout, 700);
  }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (!$('gameCenterView').classList.contains('hide')) requestAnimationFrame(resetShellLayout);
    }, { passive: true });
  }

  try {
    const saved = JSON.parse(localStorage.getItem('scarab_login') || 'null');
    if (saved && saved.account) {
      setPlatform(saved.platform);
      $('u').value = saved.account;
      $('r').checked = true;
    }
  } catch (_) {}
  renderGames();
  loadAnnouncement();
})();
