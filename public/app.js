(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const log = (...args) => { try { console.log('[ScarabHeart]', ...args); } catch (_) {} };
  const APP_VERSION = 'v2.53-atg-inapp';
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
  const BOARD_META = {
    composite: ['綜合分數', '綜合'],
    volatility: ['爆分榜', '爆發'],
    premium: ['精品排行', '精品'],
    freegame: ['免遊未開', '未開']
  };

  let session = null;
  let loginPlatform = 'TZ';
  let boards = null;
  let activeBoard = 'composite';
  let pendingPick = null;

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

  function directGameUrl(lobbyToken, gameCode) {
    return new Promise((resolve, reject) => {
      let ws;
      let settled = false;
      let ack = 0;
      let token = lobbyToken;
      let initialAck = -1;
      let playAck = -1;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws && ws.close(); } catch (_) {}
        fn(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('ATG 遊戲連線逾時')), 20000);
      try {
        ws = new WebSocket('wss://socket.godeebxp.com/socket.io/?EIO=3&transport=websocket');
      } catch (error) {
        finish(reject, error);
        return;
      }
      const send = (name, data) => {
        const id = ack++;
        ws.send('42' + id + JSON.stringify([name, data]));
        return id;
      };
      ws.onmessage = event => {
        const message = String(event.data || '');
        if (message === '2') { ws.send('3'); return; }
        if (message === '40') {
          initialAck = send('lobbyInitial', { token: lobbyToken, clientType: 'web' });
          return;
        }
        const match = message.match(/^43(\d+)([\s\S]*)/);
        if (!match) return;
        const id = Number(match[1]);
        let result = null;
        try { result = JSON.parse(match[2]); } catch (_) {}
        if (result && result[0] && result[0].token) token = result[0].token;
        if (id === initialAck && playAck < 0) {
          playAck = send('lobbyPlay', { token, clientType: 'web', code: gameCode });
          return;
        }
        if (id === playAck && result && result[0] && result[0].redirectUrl) {
          finish(resolve, result[0].redirectUrl);
        }
      };
      ws.onerror = () => finish(reject, new Error('ATG 遊戲連線失敗'));
      ws.onclose = () => { if (!settled) finish(reject, new Error('ATG 遊戲連線中斷')); };
    });
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

  function showGameCenter() {
    showOnly('gameCenterView');
    $('gcWho').textContent = '● ' + (session ? session.platform : loginPlatform) + ' ONLINE';
    renderGames();
    window.scrollTo(0, 0);
  }

  function renderGames() {
    const box = $('gcGames');
    box.innerHTML = '';
    GAMES.forEach(game => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'game-card';
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
      session = { base, token, account, password, platform: loginPlatform, game: '' };
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

  function logout() {
    if (window.ScarabWebLauncher) ScarabWebLauncher.close();
    session = null;
    boards = null;
    pendingPick = null;
    try { if (window.SethEyeAPI) SethEyeAPI.logout(); } catch (_) {}
    showOnly('loginView');
  }

  async function chooseGame(code) {
    if (!session) return;
    session.game = code;
    pendingPick = null;
    $('game').innerHTML = '<option value="' + code + '">' + code + '</option>';
    $('game').value = code;
    const item = GAMES.find(game => game[0] === code);
    $('who').textContent = item ? item[1] : code;
    $('room').value = '';
    $('err2').textContent = '';
    showOnly('roomView');
    await loadBoards();
  }

  function operatorCode() {
    return session && session.platform === 'OFA' ? 'ofa' : '';
  }

  async function loadBoards() {
    const box = $('recommend');
    box.innerHTML = '<div style="color:#7893a9;font-size:12px;padding:16px">正在取得即時排行…</div>';
    try {
      if (!window.SethEyeAPI || !SethEyeAPI.boards) throw new Error('排行服務未載入');
      const result = await SethEyeAPI.boards(session.game, operatorCode());
      boards = result || {};
      $('updTime').textContent = '更新 ' + formatTime(result && result.updatedAt);
      renderBoard();
    } catch (error) {
      boards = { composite: [], volatility: [], premium: [], freegame: [] };
      box.innerHTML = '<div style="color:#ff9a82;font-size:12px;padding:16px">目前無法取得排行；仍可輸入機台號碼或進入大廳。</div>';
      log('排行讀取失敗', error && error.message);
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
    const list = (boards && Array.isArray(boards[activeBoard])) ? boards[activeBoard] : [];
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div style="color:#7893a9;font-size:12px;padding:16px">這個榜單目前沒有資料。</div>';
      return;
    }
    list.slice(0, 12).forEach((item, index) => {
      const machine = item.machineNum == null ? '—' : String(item.machineNum);
      const locked = !item.roomId;
      const row = document.createElement('div');
      row.className = 'room-card';
      row.innerHTML = '<span class="room-rank">' + (index + 1) + '</span><span><b>' + (locked ? '🔒 精品機台' : machine.padStart(3, '0') + ' 號機台') + '</b><small>' + BOARD_META[activeBoard][0] + (item.rtp != null ? ' · RTP ' + item.rtp + '%' : '') + '</small></span><span class="score">' + (item.score == null ? '—' : item.score) + '</span>';
      if (!locked) row.onclick = () => selectRoom(item);
      else row.style.opacity = '.58';
      box.appendChild(row);
    });
  }

  function selectRoom(item) {
    pendingPick = {
      roomId: String(item.roomId || ''),
      machineNum: String(item.machineNum || ''),
      board: activeBoard,
      boardName: BOARD_META[activeBoard][0]
    };
    $('room').value = pendingPick.machineNum;
    $('err2').style.color = '#70e7b0';
    $('err2').textContent = '已選擇 ' + pendingPick.machineNum + ' 號機台，按下方按鈕進入。';
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
      SETH_ACCOUNT: session.account,
      APP_VER: APP_VERSION,
      AGENT_MODE: true
    };
  }

  async function enterGame(mode) {
    if (!session || !session.game) return;
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
        target = pendingPick.roomId || pendingPick.machineNum;
        machineNum = pendingPick.machineNum;
        targetKind = pendingPick.roomId ? 'roomId' : null;
        boardName = pendingPick.boardName;
        const source = (boards && boards[pendingPick.board]) || [];
        boardList = source.filter(x => x && x.roomId && x.machineNum != null).map(x => ({ roomId: String(x.roomId), machineNum: String(x.machineNum), score: x.score }));
      } else {
        machineNum = String($('room').value || '').trim();
        if (!machineNum) throw new Error('請輸入機台號碼，或選擇「進入大廳自行選擇」');
        target = machineNum;
      }

      const requestGameUrl = async token => {
        const body = session.platform === 'OFA'
          ? { game_return_url: 'https://www.ofa1188.net', game_kind: 'SLOT', game_device: 'Desktop', game_money: '' }
          : { game_return_url: session.base, game_kind: '', game_type: '', game_device: 'Desktop' };
        const result = await postJson(session.base + '/api/v2/game/ATG/login', body, token);
        return result && result.data && result.data.game_url;
      };

      let url = await requestGameUrl(session.token);
      if (!url) {
        const relogin = await postJson(session.base + '/api/v1/login', {
          username: session.account,
          password: session.password,
          device_id: deviceId()
        });
        const token = relogin && relogin.data && relogin.data.token;
        if (!token) throw new Error('登入已過期，請重新登入');
        session.token = token;
        url = await requestGameUrl(token);
      }
      if (!url) throw new Error('ATG 沒有回傳遊戲網址');

      let finalUrl = url;
      const tokenMatch = url.match(/[?&]t=([^&]+)/);
      if (tokenMatch) {
        try { finalUrl = await directGameUrl(tokenMatch[1], session.game); }
        catch (error) { log('直連交換失敗，改載入 ATG 大廳', error && error.message); }
      }
      const config = gameConfig(target, machineNum, boardName, boardList, targetKind);
      if (!window.ScarabWebLauncher) throw new Error('程式內遊戲載入器未就緒');
      ScarabWebLauncher.open(finalUrl, { kind: 'atg', gameCode: session.game, cfg: config });
      $('err2').textContent = '';
    } catch (error) {
      $('err2').textContent = error && error.message ? error.message : '進入遊戲失敗';
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function closeGame(destination) {
    if (window.ScarabWebLauncher) ScarabWebLauncher.close();
    if (destination === 'home') showGameCenter();
    else {
      showOnly('roomView');
      loadBoards();
    }
  }

  function handleGameCommand(url) {
    const command = String(url || '');
    if (!command) return;
    if (/__sethcmd__\/pick/.test(command)) {
      try {
        const parsed = new URL(command);
        const roomId = parsed.searchParams.get('ri') || '';
        const machineNum = parsed.searchParams.get('mn') || '';
        const found = ((boards && boards.composite) || []).find(x => String(x.roomId || '') === roomId || String(x.machineNum || '') === machineNum);
        if (found) selectRoom(found);
      } catch (_) {}
      closeGame('rooms');
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
    if (!window.SethEyeAPI || !SethEyeAPI.announcement) return;
    try {
      const item = await SethEyeAPI.announcement();
      if (!item || !item.enabled) return;
      const box = $('announce');
      const title = String(item.title || '').trim();
      const text = String(item.text || '').trim();
      const image = safeAnnouncementUrl(item.imageUrl);
      const action = safeAnnouncementUrl(item.buttonUrl);
      if (title) { $('announceTitle').textContent = title; $('announceTitle').classList.remove('hide'); }
      if (text) { $('announceText').textContent = text; $('announceText').classList.remove('hide'); }
      if (image) {
        $('announceImg').onload = () => $('announceImg').classList.remove('hide');
        $('announceImg').src = image;
      }
      if (action && item.buttonText) {
        $('announceBtn').href = action;
        $('announceBtn').textContent = String(item.buttonText);
        $('announceBtn').classList.remove('hide');
      }
      if (title || text || image || (action && item.buttonText)) box.classList.remove('hide');
    } catch (_) {}
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
    await loadBoards();
    await refreshMember();
    this.disabled = false;
    this.textContent = '↻ 刷新';
  };
  $('enterBtn').onclick = () => enterGame();
  $('skipBtn').onclick = () => enterGame('manual');
  $('gameExit').onclick = () => closeGame('rooms');
  window.addEventListener('scarab:web-command', event => handleGameCommand(event && event.detail && event.detail.url));

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
