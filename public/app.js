(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const log = (...args) => { try { console.log('[ScarabHeart]', ...args); } catch (_) {} };
  const APP_VERSION = 'v3.29-overlay-command-bridge-fix';
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
    const controller = new AbortController();
    const requestTimer = setTimeout(() => controller.abort(), 15000);
    try {
      response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('連線娛樂城逾時，請按刷新重試');
      const e = new Error('無法連線到 ' + loginPlatform + '，請確認網路後重試');
      e.cause = error;
      throw e;
    } finally {
      clearTimeout(requestTimer);
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
    prepareGameEntry(code).catch(error => log('ATG 遊戲入口預先連線失敗', code, error && error.message));
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
      // ATG HAR snapshots use `number`; the live probe normalizes it to
      // `machineNum`. Accept both shapes so captured room tables are not
      // silently filtered out.
      const machineNum = String(raw.machineNum == null ? (raw.number == null ? '' : raw.number) : raw.machineNum);
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
        roomIdSource: 'ATG_REALTIME',
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

  // Latest Wuxia Socket.IO initial snapshot (2026-09-27 17:19 Taipei), captured after entering #004.
  // Keep only room identity, status and public table aggregates; player/account fields are excluded.
  const WUXIA_HAR_ROOM_ROWS = [
    [1,"310102","Full",149117.0,143804.94000000006,179876.0,158245.05000000002], [2,"310103","Locked",60182.0,39129.46999999999,89009.0,85793.56999999999], [3,"310104","Full",44083.0,42777.50000000002,81897.0,76485.31999999998],
    [4,"310105","Full",203577.0,170207.77000000005,232823.0,191659.07000000004], [5,"310106","Empty",35618.0,30437.340000000022,113862.0,111891.64000000001], [6,"310107","Empty",42305.0,30380.8,74873.0,65624.25],
    [7,"310108","Full",67722.0,57145.10999999995,84446.0,69213.06], [8,"310109","Empty",19641.0,27570.359999999975,70776.0,64594.15999999999], [9,"310110","Empty",103424.0,110933.25000000004,141552.0,150063.51000000004],
    [10,"310111","Locked",60576.0,63229.42999999993,148401.0,114885.93], [11,"310112","Full",123787.0,100414.3499999999,130501.0,105082.35], [12,"310113","Empty",17387.19999999991,14543.240000000027,24818.2,21141.489999999998],
    [13,"310114","Empty",4971.0,3649.3999999999996,24919.0,21239.72], [14,"310115","Empty",213941.0,181620.41000000006,188115.0,151721.25000000003], [15,"310116","Empty",15429.0,11527.900000000007,20344.0,13359.85],
    [16,"310117","Empty",34137.0,27889.899999999998,56592.0,42081.45], [17,"310118","Empty",50761.0,38948.00999999995,78985.0,68034.81], [18,"310119","Empty",123098.59999999998,93407.43000000015,138422.2,106014.22],
    [19,"310120","Full",32035.2,28099.800000000003,40842.2,33672.65], [20,"310121","Empty",39549.0,70153.11999999998,57327.0,97928.77000000003], [21,"310122","Empty",120557.0,184578.95,203391.0,256156.55],
    [22,"310123","Empty",21895.0,25915.920000000002,67654.0,106992.37000000001], [23,"310124","Empty",25410.0,15815.59999999999,56264.0,31535.4], [24,"310125","Empty",76420.0,90638.35999999997,101212.0,112293.66],
    [25,"310126","Full",19870.0,54466.18000000001,20618.0,55201.68], [26,"310127","Empty",59882.0,72872.25999999998,71814.0,82797.70999999999], [27,"310128","Empty",15146.0,10884.649999999998,21682.0,13835.65],
    [28,"310129","Empty",13015.0,19511.410000000014,36229.0,40259.619999999995], [29,"310130","Full",15534.6,10641.07999999999,21965.6,16230.0], [30,"310131","Empty",38832.0,36151.62000000002,67256.0,65219.98999999999],
    [31,"310132","Empty",39303.0,24976.30000000003,51265.0,40401.0], [32,"310133","Empty",28969.0,17558.07000000001,31409.0,19633.220000000005], [33,"310134","Full",64246.0,74619.86999999982,39192.0,49699.92999999999],
    [34,"310135","Full",21199.0,27204.669999999976,47624.0,41119.06999999999], [35,"310136","Empty",60137.0,59534.019999999924,126061.0,103142.77], [36,"310137","Full",47573.0,27675.949999999993,49845.0,29800.350000000002],
    [37,"310138","Empty",51349.0,39978.69999999999,70616.0,56952.66000000002], [38,"310139","Empty",57834.0,76823.80999999998,59324.0,78726.35999999999], [39,"310140","Full",16288.0,29493.250000000007,29300.600000000002,49554.33],
    [40,"310141","Empty",7861.0,3347.3999999999996,17693.0,21426.600000000002], [41,"310142","Empty",19228.0,10985.84999999999,22332.0,13777.449999999997], [42,"310143","Empty",41767.0,28696.059999999998,57477.0,38822.46000000001],
    [43,"310144","Empty",40570.0,36796.70000000001,42847.0,44694.50000000001], [44,"310145","Empty",136791.0,156120.06999999998,139238.0,158559.97999999998], [45,"310146","Empty",82477.0,101488.76000000002,83394.0,102274.45999999998],
    [46,"310147","Empty",30268.0,21555.809999999994,48326.0,38861.76000000001], [47,"310148","Empty",28304.0,22475.94999999999,28504.0,23151.750000000004], [48,"310149","Empty",16069.0,10138.05,26786.0,30161.070000000003],
    [49,"310150","Empty",11159.0,11699.219999999998,25520.0,21738.62], [50,"310151","Empty",19008.0,30883.590000000007,40569.0,49840.140000000014], [51,"310152","Full",13754.0,10627.849999999997,20907.0,17363.83],
    [52,"310153","Locked",55593.0,52197.89999999999,59651.0,54035.05], [53,"310154","Empty",90030.0,78828.75000000004,96825.0,86235.45], [54,"310155","Empty",5595.0,7866.799999999999,9793.0,11613.799999999997],
    [55,"310156","Empty",22446.0,16728.19999999999,32091.0,23066.499999999996], [56,"310157","Empty",5400.0,3604.900000000001,8294.0,5905.699999999999], [57,"310158","Empty",7085.0,15240.950000000008,9825.0,16654.250000000007],
    [58,"310159","Empty",48155.0,66781.99000000005,81909.0,86653.28], [59,"310160","Locked",27196.0,28504.920000000046,36984.0,42890.12], [60,"310161","Full",6715.0,8006.249999999996,6725.0,8010.449999999999],
    [61,"310162","Empty",7207.0,3480.1500000000005,23113.0,12186.7], [62,"310163","Empty",64806.0,57200.89000000003,69722.0,60582.79000000001], [63,"310164","Empty",50308.0,44119.82,50308.0,44119.82],
    [64,"310165","Empty",58677.2,48314.12000000001,64431.799999999996,51182.89000000001], [65,"310166","Full",19872.0,18569.550000000003,20384.0,18748.1], [66,"310167","Empty",344119.0,176965.69999999998,351123.0,184852.90000000002],
    [67,"310168","Empty",1608.0,940.0500000000002,9002.0,9408.65], [68,"310169","Empty",26405.0,17682.2,32049.0,20621.900000000005], [69,"310170","Empty",20935.0,23599.34999999999,21887.0,25135.45000000001],
    [70,"310171","Full",26068.0,16566.810000000005,29560.0,22953.660000000007], [71,"310172","Empty",39088.0,42852.97999999993,43756.0,47021.98], [72,"310173","Empty",99442.0,111801.81999999999,108890.0,118036.46999999999],
    [73,"310174","Empty",19902.0,20022.800000000003,27517.0,24566.3], [74,"310175","Empty",1967.0,1302.1,23935.0,18888.989999999998], [75,"310176","Empty",48788.0,40735.69999999999,55628.0,46496.100000000006],
    [76,"310177","Empty",1947.4,839.1199999999999,2550.4,1270.82], [77,"310178","Empty",14468.0,11404.909999999996,18777.4,15088.490000000002], [78,"310179","Empty",9221.0,6413.909999999996,30943.0,62878.36],
    [79,"310180","Full",37470.0,30730.129999999997,48322.0,36132.530000000006], [80,"310181","Empty",2218.0,1779.75,2978.0,1948.15], [81,"310182","Full",28477.0,26176.919999999995,31511.0,27967.219999999994],
    [82,"310183","Empty",12445.0,12745.750000000007,15653.0,18198.15], [83,"310184","Empty",27632.0,24007.61,34476.0,37434.610000000015], [84,"310185","Empty",24252.0,13367.449999999999,48163.0,36568.55],
    [85,"310186","Empty",8636.0,19945.54999999998,8636.0,19945.550000000003], [86,"310187","Empty",9749.0,13919.550000000001,35767.0,34578.75], [87,"310188","Full",17216.0,11673.149999999998,17236.0,11679.549999999997],
    [88,"310189","Empty",78503.0,94571.54999999997,80981.0,95315.69999999998], [89,"310190","Empty",37994.6,26067.41,38594.6,26536.209999999995], [90,"310191","Empty",27695.0,34767.149999999994,50471.0,100518.95],
    [91,"310192","Empty",15847.0,9628.83000000001,15847.0,9628.829999999998], [92,"310193","Empty",40314.0,93456.20000000006,63262.0,122567.64999999997], [93,"310194","Empty",15328.0,11286.300000000005,33186.0,23382.450000000004],
    [94,"310195","Empty",4940.0,8683.51,4940.0,8683.51], [95,"310196","Empty",1600.0,866.4000000000001,3932.0,5096.830000000001], [96,"310197","Empty",28764.0,43640.310000000005,31244.0,47935.51],
    [97,"310198","Empty",44026.0,35276.209999999985,44399.0,35716.409999999996], [98,"310199","Empty",19833.0,16921.700000000004,21389.0,17650.61], [99,"310200","Empty",1980.0,1261.6,15106.0,7599.3499999999985],
    [100,"310201","Empty",13555.6,17869.1,39310.6,47617.25], [101,"353814","Empty",31420.0,38558.80000000003,49339.6,67904.62999999999], [102,"353807","Empty",15296.0,17109.79999999999,19535.0,20208.6],
    [103,"353808","Empty",22020.0,17377.300000000003,30510.0,23491.050000000003], [104,"353811","Empty",3696.0,2464.600000000001,4872.0,2666.2000000000007], [105,"353810","Empty",15534.0,11367.500000000004,47094.0,48350.899999999994],
    [106,"353812","Empty",17024.0,13336.980000000003,11145.0,10211.43], [107,"353815","Locked",11572.0,11099.0,19100.0,25428.750000000004], [108,"353809","Empty",24655.0,11952.650000000005,24655.0,11952.650000000001],
    [109,"353813","Full",61225.80000000004,40091.430000000015,61225.80000000004,40091.43], [110,"353806","Empty",29354.0,21786.450000000004,33040.0,24374.449999999997]
  ];
  const SON_GO_KU_HAR_ROWS = [[1,"310002","Empty",127467,110175.32999999999,157105,138107.83],[2,"310003","Locked",72398,60765.94999999996,148512,118670.24],[3,"310004","Empty",76071.6,56133.59000000003,108638.6,84564.29],[4,"310005","Empty",55166,64348.949999999946,107957,114470.81000000001],[5,"310006","Empty",127815,175110.54999999993,179474,227565.46000000002],[6,"310007","Full",63295,56685.72000000009,93436,82781.64],[7,"310008","Empty",63086,66466.08999999994,71338,74264.09000000003],[8,"310009","Empty",88847,86088.44999999995,119849,114570.4],[9,"310010","Empty",54998,59626.360000000044,514455,418478.5600000001],[10,"310011","Empty",25097,19491.550000000032,36418,35342.2],[11,"310012","Empty",112744,246371.72000000044,139627,383973.7700000001],[12,"310013","Empty",136551,184777.37999999986,156855,200190.08000000002],[13,"310014","Empty",32150,23169.849999999995,54080,40591.759999999995],[14,"310015","Empty",755072.7999999998,687675.5900000015,442078,402362.9899999999],[15,"310016","Full",25291,24141.700000000023,43210,39218.84999999999],[16,"310017","Full",78011,53336.62999999991,91580,65335.080000000016],[17,"310018","Empty",38783,32836.15,54532,50080.59999999999],[18,"310019","Empty",41049,34833.75000000001,67928,76406.99],[19,"310020","Empty",2304047,2173276.799999997,2193960,2069387.4399999995],[20,"310021","Empty",15097,13451.349999999995,63159,53642.96000000001],[21,"310022","Empty",45346,50386.76,321486,328904.34],[22,"310023","Full",305088,233994.84999999995,427561,289446.19999999984],[23,"310024","Empty",52375,45623.829999999936,62412.8,56079.21],[24,"310025","Empty",37737,28910.800000000003,105283.4,75522.79999999999],[25,"310026","Empty",60483,48602.25000000002,98383,88853.8],[26,"310027","Empty",106839,110261.04999999999,180151,183072.15],[27,"310028","Empty",339577,363868.7599999999,243669,267766.21],[28,"310029","Empty",104114,139705.28000000012,155868,183431.56],[29,"310030","Empty",212277,157366.1499999996,238820,186192.08000000002],[30,"310031","Empty",41059,32210.910000000018,47415,42425.11],[31,"310032","Empty",30862,40705.359999999986,79610,101944.01],[32,"310033","Full",16395,30200.949999999997,35988,50227.369999999995],[33,"310034","Empty",101637,130416.4099999999,111017,135731.06000000003],[34,"310035","Empty",84454.6,78077.36,108322.6,94117.26000000002],[35,"310036","Full",38557,39457.66000000002,48434,51874.11999999999],[36,"310037","Empty",14014,15509.85,75317,59699.08999999999],[37,"310038","Empty",35076,29810.049999999974,56931,77270.35],[38,"310039","Empty",58011,79925.96000000006,72300,89988.60999999999],[39,"310040","Empty",41764,33499.44000000001,69493,55089.29000000002],[40,"310041","Full",94273,90775.20000000007,168223,175195.97],[41,"310042","Empty",15795,10340.950000000004,24327,17648.3],[42,"310043","Empty",68455,66416.21000000002,79603,72344.06],[43,"310044","Empty",44770,48375.50000000003,75406,90154.84999999998],[44,"310045","Empty",32836,35594.84999999998,64822,76618.46999999997],[45,"310046","Empty",367964,300765.4599999998,370070,303951.91000000003],[46,"310047","Empty",30976,21281.819999999992,87662,68122.81999999999],[47,"310048","Empty",18602,9770.749999999998,51780,39828.42999999999],[48,"310049","Empty",13832,9516.359999999999,27154,19313.260000000002],[49,"310050","Empty",7151,11503.900000000001,30355,67413.95],[50,"310051","Full",30108,38173.25000000001,55549,59664.29999999999],[51,"310052","Full",137735,86010.67999999993,147888,95046.18000000001],[52,"310053","Full",503,384.70000000000005,7308,8805.05],[53,"310054","Empty",318113,290361.77999999997,357037,336372.83],[54,"310055","Empty",52509,49375.64999999997,76410,71797.6],[55,"310056","Empty",3376,5002.450000000001,19053,31146.3],[56,"310057","Empty",41053,35833.44999999999,49151,45424.54],[57,"310058","Empty",34972,35760.32000000002,36119,36307.920000000006],[58,"310059","Empty",11647,9877.250000000002,27327,32162],[59,"310060","Empty",30830,25763.689999999973,66934,81588.70000000001],[60,"310061","Empty",16772,10555.899999999996,23690,17803.249999999996],[61,"310062","Empty",45105,26702.050000000003,74642,53139.150000000016],[62,"310063","Empty",24887,18717.750000000004,32316,36886.7],[63,"310064","Empty",21509,14916.800000000007,41686,54069.30000000003],[64,"310065","Empty",16564,10912.700000000008,19132,12291.750000000004],[65,"310066","Empty",45282,53444.90000000005,61730,68207.2],[66,"310067","Empty",6853,8790.400000000001,18575,20861.5],[67,"310068","Full",28684,19263.84999999999,37573,28187.290000000005],[68,"310069","Empty",22759,30487.700000000015,49434,52550.599999999984],[69,"310070","Empty",29596,51670.450000000004,57508,81944.85],[70,"310071","Full",2226,2004.6499999999994,26913,19670.8],[71,"310072","Empty",576,434.40000000000003,576,434.40000000000003],[72,"310073","Empty",6746,10939.050000000003,7553,11335.2],[73,"310074","Empty",9445,18351.349999999988,24225,34407.149999999994],[74,"310075","Empty",6333,7674.849999999998,7925,9035.749999999998],[75,"310076","Empty",33518,41751.17,33518,41751.17],[76,"310077","Empty",85779,79295.69999999994,86858,80663.9],[77,"310078","Empty",4171,2861.979999999999,4483,3327.9800000000005],[78,"310079","Empty",21796,28506.450000000004,24857,34142.100000000006],[79,"310080","Empty",13059,15897.649999999992,17065,17521.149999999998],[80,"310081","Empty",18675,12530.25,20675,13897.050000000001],[81,"310082","Empty",11541,16184.50000000001,15193,26915.1],[82,"310083","Empty",4143,6799.350000000005,30437,38798.7],[83,"310084","Empty",2729,2842.3500000000004,7734,7681],[84,"310085","Empty",10627,7249.15,10627,7249.15],[85,"310086","Empty",24937,46080.90000000002,39479,58646.66000000001],[86,"310087","Empty",20086,57060.599999999984,26905,62064],[87,"310088","Empty",6594,6035.000000000002,15774,17072.1],[88,"310089","Empty",5064,7831.450000000002,67436,96005.85],[89,"310090","Empty",2132,3415.2000000000003,3102,3643.7],[90,"310091","Full",178735,134372.1699999998,196501,147603.06000000003],[91,"310092","Empty",3140,5865.419999999999,10880,16509.969999999998],[92,"310093","Empty",23008,14131.199999999988,27931,20958.999999999996],[93,"310094","Empty",26887,18382.09999999999,50130.200000000004,39932.67000000001],[94,"310095","Empty",9840,13552.700000000006,14374,15791.350000000004],[95,"310096","Full",15921,30898.450000000008,23869,44181.00000000001],[96,"310097","Empty",10372,17719.1,21400,23504.300000000007],[97,"310098","Empty",56434.4,45782.940000000024,11649.4,12948.12],[98,"310099","Full",92724,99306.90000000002,149148,155375.15],[99,"310100","Empty",16725,21105.050000000014,51878,73939.75000000001],[100,"310101","Empty",7422,12707.799999999997,13473,19109.07]];
  const VERIFIED_ROOM_ID_MAPS = {
    'tiger-princess': { '1018':'354859' },
    'wuxia-caishen': Object.fromEntries(WUXIA_HAR_ROOM_ROWS.map(row => [String(row[0]), String(row[1])])),
    'son-go-ku': Object.fromEntries(SON_GO_KU_HAR_ROWS.map(row => [String(row[0]), String(row[1])])),
    'new-jinlian': { '349':'378330', '20':'377763' }
  };

  function applyVerifiedRoomIds(gameCode, value) {
    const roomMap = VERIFIED_ROOM_ID_MAPS[gameCode];
    if (!roomMap || !value) return value;
    ['composite', 'volatility', 'premium', 'freegame'].forEach(key => {
      (Array.isArray(value[key]) ? value[key] : []).forEach(row => {
        const machineNum = String(row && row.machineNum != null ? row.machineNum : '').replace(/^0+(?=\d)/, '');
        if (roomMap[machineNum]) {
          row.roomId = roomMap[machineNum];
          row.roomIdSource = 'ATG_HAR_VERIFIED';
        }
      });
    });
    return value;
  }

  function capturedRoomBoards(gameCode) {
    const rows = gameCode === 'wuxia-caishen' ? WUXIA_HAR_ROOM_ROWS :
      (gameCode === 'son-go-ku' ? SON_GO_KU_HAR_ROWS : null);
    if (!rows) return emptyBoards();
    const tables = rows.map(row => ({
      number: row[0], roomId: row[1], status: row[2],
      today: { bet: row[3], win: row[4] }, bet: row[5], win: row[6]
    }));
    const ranked = realBoardsFromTables(tables);
    const capturedAt = gameCode === 'wuxia-caishen'
      ? Date.parse('2026-09-27T17:19:16+08:00')
      : Date.parse('2026-09-27T17:47:23.581Z');
    ['composite', 'volatility', 'premium', 'freegame'].forEach(key => {
      ranked[key] = (ranked[key] || []).map(row => Object.assign({}, row, {
        source: 'CAPTURED_SNAPSHOT', metric: ''
      }));
    });
    ranked.updatedAt = capturedAt;
    ranked.source = 'CAPTURED_SNAPSHOT';
    return ranked;
  }


  async function probeAtgTables(gameCode) {
    stopRecommendationProbe();
    const serial = ++recommendationProbeSerial;
    const finalUrl = await prepareGameEntry(gameCode);
    if (!finalUrl) throw new Error('ATG 遊戲入口尚未準備好，請按刷新重試');
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
    // Every selectable recommendation carries a roomId from the same game's
    // recommendation feed or current ATG table list.

    const box = $('recommend');
    pendingPick = null;

    // Reuse the captured, ranked room list only for Wuxia; all other titles
    // must fill this same screen from the recommendation API or live ATG feed.
    const snapshot = ['wuxia-caishen', 'son-go-ku'].includes(game)
      ? normalizeBoards(capturedRoomBoards(game)) : null;
    if (snapshot && usableBoardCount(snapshot) > 0) {
      boards = snapshot;
      boardCache[game] = { at: Date.now(), value: snapshot };
      $('updTime').textContent = '正在更新機台資料…';
      renderBoard();
    } else if (SIM_RECOMMEND_GAMES.has(game)) {
      boards = emptyBoards();
      box.innerHTML = '<div style="color:#7893a9;font-size:12px;padding:16px">正在讀取推薦機台…</div>';
      $('updTime').textContent = '讀取中';
    }

    // Show the last REAL result immediately while refreshing.
    // This removes the blank 10~20 second wait when returning to this game.
    let instant = null;
    const memory = boardCache[game] && boardCache[game].value;
    if (!snapshot && memory && !memory.simulated && usableBoardCount(memory) > 0) instant = normalizeBoards(memory);
    if (!instant) instant = loadRealBoardStorage(game);

    if (instant && usableBoardCount(instant) > 0) {
      boards = instant;
      $('updTime').textContent = '更新中';
      renderBoard();
    } else if (!snapshot) {
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
          const normalized = applyVerifiedRoomIds(game, normalizeBoards(value));
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
        const value = normalizeBoards(realBoardsFromTables(tables));
        if (usableBoardCount(value) < 1) throw new Error('ATG 沒有回傳可用機台');
        showFresh(value, 'ATG_REALTIME');
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
      if (snapshot && usableBoardCount(snapshot) > 0) {
        boards = snapshot;
        boardCache[game] = { at: Date.now(), value: snapshot };
        $('updTime').textContent = '即時更新暫不可用';
        renderBoard();
      } else if (instant && usableBoardCount(instant) > 0) {
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
      row.innerHTML = '<span class="room-rank">' + (index + 1) + '</span><span><b>' + (locked ? '🔒 ' + machine.padStart(3, '0') + ' 號機台' : machine.padStart(3, '0') + ' 號機台') + '</b><small>' + BOARD_META[activeBoard][0] + (item.rtp != null ? ' · ' + (item.simulated ? 'RTP 指標 ' : 'RTP ') + item.rtp + '%' : '') + metric + simMark + '</small></span><span class="score">' + (item.score == null ? '—' : item.score) + '</span>';
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

  async function selectRoom(item, options) {
    if (!item || item.machineNum == null) return;
    const machineNum = String(item.machineNum);
    if (item.board && BOARD_META[item.board]) activeBoard = item.board;
    prepareGameEntry(session && session.game).catch(() => null);
    const accepted = options && options.fromOverlay ? true : await confirmRoom(machineNum);
    if (!accepted) return;

    pendingPick = {
      roomId: String(item.roomId || ''),
      roomIdSource: String(item.roomIdSource || (item.source === 'ATG' ? 'ATG_REALTIME' : '')),
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
      // The recommendation API's roomId is metadata and can differ from the
      // live ATG room key. Room selection is by the visible ATG machine number.
      // Keep the longer wait protection for that exact machine-number search.
      EXACT_ROOM: ['machineNum', 'roomId'].includes(targetKind) && /^\d+$/.test(String(machineNum || '').trim()),
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
        machineNum = String(pendingPick.machineNum || '');
        const verifiedAtgRoom = ['ATG_REALTIME', 'ATG_HAR_VERIFIED'].includes(String(pendingPick.roomIdSource || ''));
        targetKind = verifiedAtgRoom ? 'roomId' : 'machineNum';
        boardName = pendingPick.boardName;
        const source = (boards && boards[pendingPick.board]) || [];
        boardList = source.filter(x => x && x.roomId && x.machineNum != null).map(x => ({ roomId: String(x.roomId), machineNum: String(x.machineNum), score: x.score }));

        // Use roomId only when it came from the live ATG table or a verified
        // ATG HAR pair. SethEye/API roomIds are not assumed to be ATG keys.
        // Keep machine-number text intact (including leading zeroes) for the
        // engine's exact table-label lookup.
        target = verifiedAtgRoom && /^\d+$/.test(String(pendingPick.roomId || ''))
          ? String(pendingPick.roomId)
          : '__machine__' + machineNum;
        if (!/^\d+$/.test(machineNum)) throw new Error('這台機台號碼無效，請刷新機台資料');
      } else {
        machineNum = String($('room').value || '').trim();
        if (!machineNum) throw new Error('請輸入機台號碼，或選擇「進入大廳自行選擇」');
        target = '__machine__' + machineNum;
        targetKind = 'machineNum';
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
      hideRoomPickToast();
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
    const handled = window.ScarabRoomCommand && ScarabRoomCommand.dispatchGameCommand(url, boards, {
      navigate: destination => closeGame(destination),
      pick: item => setTimeout(() => selectRoom(item, {fromOverlay:true}), 0),
      invalid: () => log('懸浮前往指令無有效機台號碼')
    });
    if (handled) return;
    if (/__sethcmd__\/deposit/.test(String(url || ''))) {
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
  window.addEventListener('message', event => {
    // Support a detached floating-panel window. Embedded game commands are
    // handled by web-iab-bridge.js and intentionally ignored here to avoid duplicates.
    if (!event || event.source === window || event.origin !== location.origin) return;
    const frame = document.getElementById('gameFrame');
    if (frame && event.source === frame.contentWindow) return;
    const data = event.data;
    if (data && data.__scarabCommand === true && typeof data.url === 'string') handleGameCommand(data.url);
  });


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
