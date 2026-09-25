// 聖甲之心助手 copilot API client（外掛端）。含 mock 模式：聖甲之心助手端點還沒上線前先用假資料把整條串通。
// 端點上線後：把 USE_MOCK=false + 填 API_BASE/COPILOT_KEY 即接真的。
// 合約：docs/cross-machine 合約 v3 + 6-26 三榜整合確認(聖甲之心助手已回覆)。
(function (global) {
  'use strict';
  const L = (...a) => { try { console.log('[聖甲之心助手API]', ...a); } catch (e) {} };

  const CFG = {
    USE_MOCK: false,                         // 真 API（聖甲之心助手 2026-06-26 上線）；要用假資料開發改 true
    API_BASE: 'https://seth-eye.com/api/copilot',
    COPILOT_KEY: 'cpk_f36916e3355b89a0af85111ea0aa208a59b732de68e8b21c',   // header X-Copilot-Key
  };

  let TOKEN = null;
  // 通行證狀態（真實會由 passes/buy-pass 維護；mock 在本地模擬）
  let MOCK_PASSES = { gold: { active: false, remainSec: 0 }, silver: { active: false, remainSec: 0 } };
  let MOCK_COINS = { gold: 3, silver: 2 };

  // ===== 代理版(AGENT_MODE)：不綁聖甲之心助手、登 OFA 直接進；金幣各3(每次登入重置補3)、買通行證/解精品本地扣；榜單仍走真 OFA API =====
  const AGENT = !!global.AGENT_MODE;
  let AGENT_COINS = { gold: 3, silver: 3 };
  let AGENT_PASSES = { gold: { active: false, remainSec: 0 }, silver: { active: false, remainSec: 0 } };
  function agentLoad() { try { const c = JSON.parse(localStorage.getItem('seth_agent_coins') || 'null'); if (c) AGENT_COINS = c; const p = JSON.parse(localStorage.getItem('seth_agent_passes') || 'null'); if (p) AGENT_PASSES = p; } catch (e) {} }
  function agentSave() { try { localStorage.setItem('seth_agent_coins', JSON.stringify(AGENT_COINS)); localStorage.setItem('seth_agent_passes', JSON.stringify(AGENT_PASSES)); } catch (e) {} }
  function agentReset() { AGENT_COINS = { gold: 3, silver: 3 }; AGENT_PASSES = { gold: { active: false, remainSec: 0 }, silver: { active: false, remainSec: 0 } }; agentSave(); }   // 登入重置：金幣補滿3、通行證清空

  // 正式網站不使用代理測試權限；不要把代理專用 key 放進公開前端。
  const AGENT_KEY = '';

  // ---- 真實 HTTP（CapacitorHttp 繞 CORS；mock 模式不會走到）----
  function capacitorHttp() {
    try {
      const cap = global.Capacitor;
      if (!cap) return null;
      if (cap.Plugins && cap.Plugins.CapacitorHttp) return cap.Plugins.CapacitorHttp;
      if (typeof cap.registerPlugin === 'function' && (!cap.isPluginAvailable || cap.isPluginAvailable('CapacitorHttp'))) {
        return cap.registerPlugin('CapacitorHttp');
      }
    } catch (e) {}
    return null;
  }

  async function http(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    if (CFG.COPILOT_KEY) headers['X-Copilot-Key'] = CFG.COPILOT_KEY;
    if (AGENT && opts.agentKey) headers['X-Agent-Key'] = AGENT_KEY;   // 只代理版的 boards 帶 agent key
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    if (opts.body) headers['Content-Type'] = 'application/json';
    const url = CFG.API_BASE + path;
    const method = opts.method || 'GET';
    const CH = capacitorHttp();
    if (CH) {
      const r = await CH.request({ url, method, headers, data: opts.body || undefined, dataType: 'json', connectTimeout: 15000, readTimeout: 15000 });
      if (!r || r.status < 200 || r.status >= 300) throw new Error('伺服器回應 ' + (r && r.status != null ? r.status : '失敗'));
      if (typeof r.data === 'string') {
        try { return JSON.parse(r.data); } catch (_) { throw new Error('伺服器資料格式錯誤'); }
      }
      return r.data;
    }
    const r = await fetch(url, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (!r.ok) throw new Error('伺服器回應 ' + r.status);
    return r.json();
  }

  // ===== API =====
  // 登入（驗會員+資格）→ 回 {token}。舊流程：聖甲之心助手會員帳密（密碼須==金盈匯密碼才過）。
  async function login(account, password) {
    if (AGENT) { TOKEN = 'agent-' + String(account || '').trim(); agentReset(); L('代理版登入(本地，金幣重置3/3)', account); return { token: TOKEN, isMember: true, eligible: true }; }
    if (CFG.USE_MOCK) { TOKEN = 'mock-token-' + account; L('mock 登入', account); return { token: TOKEN, isMember: true, eligible: true }; }
    const acc = String(account || '').trim().toLowerCase();   // ★帳號正規化：娛樂城大小寫不敏感(Dg20005能登)但聖甲之心助手敏感→統一轉小寫，打大寫也能登
    const j = await http('/login', { method: 'POST', body: { account: acc, password } });
    if (j && j.token) TOKEN = j.token;
    return j;
  }

  // ★金盈匯帳密直登：外掛已在金盈匯 /api/v1/login 驗過帳密 → 這裡只傳 account、
  //   後端自動建帳本(無感綁定、預設密碼)+補幣+發 token。取代舊 login 的「密碼須==金盈匯密碼」限制。
  //   → 回 {token, account, created}
  async function bindLogin(account) {
    if (AGENT) { TOKEN = 'agent-' + String(account || '').trim(); agentReset(); L('代理版直登(本地，金幣重置3/3)', account); return { token: TOKEN, account, created: false }; }
    if (CFG.USE_MOCK) { TOKEN = 'mock-token-' + account; L('mock 直登', account); return { token: TOKEN, account, created: true }; }
    const acc = String(account || '').trim().toLowerCase();   // 帳號正規化同 login
    const j = await http('/bind-login', { method: 'POST', body: { account: acc } });
    if (j && j.token) TOKEN = j.token;
    return j;
  }

  // 會員資料（金/銀幣餘額）
  async function member() {
    if (AGENT) { agentLoad(); return { isMember: true, account: '代理版', gold: AGENT_COINS.gold, silver: AGENT_COINS.silver, displayName: '代理版' }; }
    if (CFG.USE_MOCK) return { isMember: true, account: 'dg20006', gold: MOCK_COINS.gold, silver: MOCK_COINS.silver, displayName: '測試會員' };
    return http('/member');
  }

  // ★登入頁公告（登入前打、不需 token）→ {enabled, title, text, imageUrl, buttonText, buttonUrl}
  //   ★鐵律：抓不到/出錯一律回 {enabled:false}，公告區不顯示、絕不影響登入（app.js 端還會再包一層 try/catch）。
  async function announcement() {
    try {
      if (CFG.USE_MOCK) return { enabled: false };
      // 短 timeout：公告抓太久也不能拖累登入頁，逾時就當沒公告
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
      const headers = { 'Accept': 'application/json' };
      if (CFG.COPILOT_KEY) headers['X-Copilot-Key'] = CFG.COPILOT_KEY;
      const CH = capacitorHttp();
      let j;
      if (CH) {
        const r = await CH.request({ url: CFG.API_BASE + '/announcement', method: 'GET', headers, dataType: 'json', connectTimeout: 6000, readTimeout: 6000 });
        j = r && r.data;
        if (typeof j === 'string') j = JSON.parse(j);
      } else {
        const r = await fetch(CFG.API_BASE + '/announcement', { headers, signal: ctrl ? ctrl.signal : undefined });
        j = await r.json();
      }
      if (t) clearTimeout(t);
      return (j && j.enabled) ? j : { enabled: false };
    } catch (e) { L('公告抓取失敗(不影響登入)', e && e.message); return { enabled: false }; }
  }

  // ★使用資格（按「開始」即時打、不快取）→ {eligible, reason}
  async function eligibility(game) {
    if (AGENT) return { eligible: true, reason: null };
    if (CFG.USE_MOCK) return { eligible: true, reason: null };
    return http('/eligibility' + (game ? '?game=' + encodeURIComponent(game) : ''));
  }

  function logout() { TOKEN = null; }

  // ATG game code -> recommendation backend aliases.
  // The older client only knew the first five aliases. New ATG titles were
  // sent using their raw ATG code, which is why several games returned empty boards.
  const GAME_ALIASES = {
    'golden-seth': ['seth2', 'golden-seth', '123'],
    'egyptian-mythology': ['seth1', 'egyptian-mythology', '114'],
    'tiger-princess': ['tiger', 'tiger-princess', '130'],
    'hades': ['hades', 'baphomet', '127'],
    'scarlet-three-kingdoms': ['red3k', 'scarlet-three-kingdoms', '122'],
    'wuxia-caishen': ['wuxia', 'wuxia-caishen', '121'],
    'son-go-ku': ['goku', 'son-go-ku', '118'],
    'new-vampire-hunter': ['vampire', 'new-vampire-hunter', '133'],
    'new-jinlian': ['jinlian', 'new-jinlian', '134']
  };
  const RESOLVED_GAME = Object.create(null);

  function aliasesFor(game) {
    const list = GAME_ALIASES[game] || [String(game || '')];
    const resolved = RESOLVED_GAME[game];
    return Array.from(new Set((resolved ? [resolved] : []).concat(list).filter(Boolean)));
  }

  function eyeGame(game) {
    return RESOLVED_GAME[game] || (GAME_ALIASES[game] && GAME_ALIASES[game][0]) || game;
  }

  function usableRows(board) {
    if (!board || typeof board !== 'object') return 0;
    return ['composite','volatility','freegame','premium'].reduce((n, key) => {
      const arr = Array.isArray(board[key]) ? board[key] : [];
      return n + arr.filter(x => x && x.machineNum != null).length;
    }, 0);
  }

  function topTenBoard(board) {
    board = board && typeof board === 'object' ? board : {};
    const keys = ['composite','volatility','freegame','premium'];
    keys.forEach(key => { if (!Array.isArray(board[key])) board[key] = []; });

    // Build a same-game pool only from real rows returned by the backend.
    // No fake machine numbers are created.
    const seen = new Set();
    const pool = [];
    keys.forEach(key => {
      board[key].forEach(item => {
        if (!item || item.machineNum == null) return;
        const id = String(item.machineNum);
        if (seen.has(id)) return;
        seen.add(id);
        pool.push(item);
      });
    });
    pool.sort((a,b) => Number(b.score || 0) - Number(a.score || 0));

    // The main "綜合分數" recommendation list is always up to 10 unique
    // actual machines from this game's returned ranking data.
    const compositeSeen = new Set();
    const composite = [];
    (board.composite || []).concat(pool).forEach(item => {
      if (!item || item.machineNum == null || composite.length >= 10) return;
      const id = String(item.machineNum);
      if (compositeSeen.has(id)) return;
      compositeSeen.add(id);
      composite.push(item);
    });
    composite.sort((a,b) => Number(b.score || 0) - Number(a.score || 0));
    board.composite = composite.slice(0,10);
    return board;
  }

  function cacheKey(game) {
    return 'scarab_boards_v272_' + String(game || '');
  }

  function saveBoardCache(game, value) {
    try {
      localStorage.setItem(cacheKey(game), JSON.stringify({at:Date.now(),value:value}));
    } catch (_) {}
  }

  function loadBoardCache(game) {
    try {
      const raw = JSON.parse(localStorage.getItem(cacheKey(game)) || 'null');
      if (!raw || !raw.value || Date.now() - Number(raw.at || 0) > 30 * 60 * 1000) return null;
      return raw.value;
    } catch (_) { return null; }
  }

  // 三榜(扁平)：{composite, volatility, premium, updatedAt}。每台 roomId+machineNum+score+tier(精品)+rtp/bet/profit...
  // premium 未解鎖→roomId=null(只遮編號)。占用狀態(空滿)不在這、由引擎解密 S.tables 讀。
  async function boards(game, operator) {
    if (CFG.USE_MOCK) return topTenBoard(mockBoards(game));

    const candidates = aliasesFor(game);
    let lastError = null;
    let emptyResult = null;

    for (let i = 0; i < candidates.length; i++) {
      const eg = candidates[i];
      try {
        const path = '/boards?game=' + encodeURIComponent(eg) +
          (operator ? '&operator=' + encodeURIComponent(operator) : '') +
          (AGENT ? '&agent=1' : '');
        let result = await http(path, AGENT ? { agentKey: true } : undefined);
        result = topTenBoard(result);

        if (usableRows(result) > 0) {
          RESOLVED_GAME[game] = eg;
          saveBoardCache(game, result);
          return result;
        }
        if (!emptyResult) emptyResult = result;
      } catch (error) {
        lastError = error;
        // Small one-time pause after transient 429/5xx before trying the next
        // known alias. This prevents rapid empty-state flashing.
        if (i === 0) {
          await new Promise(resolve => setTimeout(resolve, 450));
        }
      }
    }

    const cached = loadBoardCache(game);
    if (cached && usableRows(cached) > 0) return topTenBoard(cached);
    if (emptyResult) return topTenBoard(emptyResult);
    throw lastError || new Error('此遊戲推薦資料尚未同步');
  }

  // 通行證狀態
  async function passes(game) {
    // ★代理版：精品榜恆解鎖 + 假裝從 8 分鐘倒數（模擬玩家花幣解鎖後的真實使用體驗，給代理錄宣傳影片用）。
    //   不查真通行證、不扣金幣；每次呼叫都回「gold+silver 都 active、剩 480 秒」。精品定位靠 boards 的 agent 全解遮拿到真 roomId。
    if (AGENT) return { gold: { active: true, remainSec: 480 }, silver: { active: true, remainSec: 480 } };
    if (CFG.USE_MOCK) return JSON.parse(JSON.stringify(MOCK_PASSES));
    return http('/passes?game=' + encodeURIComponent(eyeGame(game)));   // 與 boards 一致轉 seth2，否則查不到通行證狀態
  }

  // 買通行證：扣 1 對應幣、開 10 分鐘看該榜
  async function buyPass(coinType) {
    if (AGENT) {
      agentLoad();
      if (AGENT_COINS[coinType] < 1) return { success: false, reason: '餘額不足', gold: AGENT_COINS.gold, silver: AGENT_COINS.silver };
      AGENT_COINS[coinType] -= 1; AGENT_PASSES[coinType] = { active: true, remainSec: 600 }; agentSave();
      L('代理版買通行證(本地扣)', coinType, '剩', AGENT_COINS);
      return { success: true, expiresAt: 0, gold: AGENT_COINS.gold, silver: AGENT_COINS.silver, remainSec: 600 };
    }
    if (CFG.USE_MOCK) {
      if (MOCK_COINS[coinType] < 1) return { success: false, reason: '餘額不足', gold: MOCK_COINS.gold, silver: MOCK_COINS.silver };
      MOCK_COINS[coinType] -= 1; MOCK_PASSES[coinType] = { active: true, remainSec: 600 };
      L('mock 買通行證', coinType, '剩', MOCK_COINS);
      return { success: true, expiresAt: 0 /*mock*/, gold: MOCK_COINS.gold, silver: MOCK_COINS.silver, remainSec: 600 };
    }
    return http('/buy-pass', { method: 'POST', body: { coinType } });
  }

  // roomId strip 前綴（seth2_308425→308425；seth1 純數字不動）。引擎端 S.numForRoom 也是同邏輯。
  function plainRoom(roomId) { return String(roomId).replace(/^.*_/, ''); }

  // ---- mock 三榜資料（對齊真 API 扁平格式+欄位名：roomId/machineNum/score/tier/rtp/bet/profit/...）----
  function mockBoards(game) {
    const eg = eyeGame(game); const pfx = (eg === 'seth1') ? '' : eg + '_';   // seth1 無前綴
    const card = (rid, mnum, score, tier) => ({ roomId: rid ? pfx + rid : null, machineNum: mnum, score, tier, c0: score % 5, c1: 100 + score % 90, c2: 60 + score % 50, rtp: (80 + score % 60).toFixed(2), bet: 100000 + score * 137, profit: (score % 2 ? 1 : -1) * (score * 211), rtp_30: (90 + score % 120).toFixed(2), bet_30: 80000000 + score * 9999 });
    const top5 = (rb, mb) => [0, 1, 2, 3, 4].map(i => card(rb + i, mb + i, 990 - i * 7, null));
    const goldP = MOCK_PASSES.gold.active, silverP = MOCK_PASSES.silver.active;
    const premium = [
      { rid: 308425, m: 3798, score: 997, tier: 'gold' }, { rid: 307940, m: 3122, score: 994, tier: 'gold' },
      { rid: 306850, m: 2440, score: 833, tier: 'silver' }, { rid: 305120, m: 1980, score: 798, tier: 'silver' }, { rid: 304333, m: 1500, score: 761, tier: 'silver' },
    ].map(p => { const full = card(p.rid, p.m, p.score, p.tier); if (!((p.tier === 'gold') ? goldP : silverP)) full.roomId = null; return full; });   // ⭐只遮 roomId
    return { composite: top5(306500, 1490), volatility: top5(307000, 1700), premium, updatedAt: 0 };
  }

  global.SethEyeAPI = { CFG, login, bindLogin, member, eligibility, logout, boards, passes, buyPass, announcement, plainRoom, get token() { return TOKEN; } };
  L('client 載入', CFG.USE_MOCK ? '(mock 模式)' : '(真 API)');
})(window);
