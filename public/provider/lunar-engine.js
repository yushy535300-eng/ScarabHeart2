// 月兔 Lunar Rabbit（GameArt RGS，OFA/金盈匯走 RPGA 廠商）外掛模組 — 2026-09-25 v1（B3）
// 用法：跟雷神一樣，App 在 RPGA login 拿 game_url → InAppBrowser 載入 → loadstop 時 executeScript：
//   (turnover.js 原始碼) + ";" + (本檔) + ";if(!window.__lunarBooted){window.__lunarBooted=true;lunarEngine(cfg);}"
//   cfg 欄位：SETH_ACCOUNT / SETH_API / SETH_KEY / SETH_TOKEN / SETH_TASK / SETH_TIME / SETH_DEVICE / APP_VER / GAME_CODE('qt-lunar-rabbit')
//            / SPEED(1|2|4|8) / DEBUG / UI('overlay'|'none')。注入哪一頁都行(自己找遊戲 iframe、找不到就閒置)。
// 結構（2026-09-25 discovery 探針實測，desktop-app/probe-lunar-discovery.js）：
//   game_url(richpanda game-launch) → 302 → 外層 https://<rgs host>/rgs/views/gameart/embed.html?sid=… → 同源 iframe
//   …/SG_LunarRabbit/GA_LunarRabbit_ALLNEW/index.html#{"sid":…}。遊戲引擎 PIXI 6.4.2（gsap 打包在 main.js 內）。
//   協定明文 HTTP POST /rgs/engine?sid=&seq= ，request=action 陣列 [{action:'bet',context:[25,4]},{action:'play'}]，
//   response={events:[{event,context}], platform:{balance(分), gameRound:{id}}}。
//   規則（docs/流水計算規則-ATG封包實測-2026-09-22.md 附錄 A）：request 含 bet action 的那次 → 流水 + bet.context.total/100；
//   collect/config/init 不算；gameEnd.context.win(分)=本轉總贏(回應先到、動畫後播→可劇透)；featureMeter=特色計量。
//   ⚠ 免遊/買特色格式未實測(測試站無買特色 UI、沒自然中)：買特色請求若含 /buy/i action → kind:'buy'；
//     免遊內若 request 仍帶 bet 但 balance 沒扣 → 不計(用餘額差交叉驗證)。上線前要補實測。
// 對外狀態 window.__lunarEngine：status / balance / bet / pnl / speed / spins / lastWin / freeGame / freeLeft / meter / setSpeed(n) / getLog()
// ★v2（2026-09-25 正式站實測後改）：流水/餘額/免遊改「讀畫面」模式——側錄 PIXI 舞台、讀遊戲自己畫在畫面上的 投注/余额/奖金/免费旋转 文字
//   （同 ATG 讀 Cocos label 的做法）。一轉＝餘額扣款金額等於投注額；扣款不等於投注額(且不在免遊)＝買特色、以扣款金額計；免遊中餘額不扣不計。
//   正式站(金盈匯 QT 大廳→GameArt)實測：按下轉動約 0.2s 餘額先扣、動畫後才播 → 讀畫面即時且準。
//   封包路徑只剩「測試站明文時」的劇透(gameEnd.win)與餘額校正；正式站劇透不可用(畫面/狀態物件無提前結果)。
function lunarEngine(cfg) {
  cfg = cfg || {};
  const log = (...a) => { if (cfg.DEBUG) try { console.log('[lunar]', ...a); } catch (e) {} };
  const S = (window.__lunarEngine = window.__lunarEngine || {});
  const SPEEDS = [1, 2, 4, 8];
  const initialSpeed = Number(cfg.SPEED);
  S.status = '等待遊戲載入'; S.speed = SPEEDS.includes(initialSpeed) ? initialSpeed : 1; S.balance = null; S.pnl = null; S.spins = 0; S.lastWin = null;
  S.freeGame = false; S.meter = null; S.spoilerOn = true; S.gameWin = null; S.roundId = null;
  const state = { baseBalance: null, lastBalance: null, seenEvents: {}, pendingBet: null, log: [] };
  const GAME = cfg.GAME_CODE || 'qt-lunar-rabbit';
  const cents = v => Math.round(+v || 0) / 100;

  // ---------- 找遊戲視窗（同源 iframe；注入在外層 embed.html 或直接在遊戲頁都行） ----------
  function gameWindows() {
    const out = [];
    const tryWin = (w) => { try { if (w && w.document && w.location && w.location.href) out.push(w); } catch (e) {} };
    tryWin(window);
    try { const ifr = document.querySelectorAll('iframe'); for (let i = 0; i < ifr.length; i++) tryWin(ifr[i].contentWindow); } catch (e) {}
    return out;
  }
  function isGameWin(w) { try { return !!(w.PIXI || /LunarRabbit|gameart\/games/i.test(w.location.href)); } catch (e) { return false; } }

  // ---------- 網路 hook：fetch + XHR 兩路都包（遊戲用哪個沒差） ----------
  function installNetHook(w) {
    if (w.__lunarNetHook) return true; w.__lunarNetHook = true;
    const isEngine = u => /\/rgs\/engine/.test(String(u || ''));
    try {
      const of = w.fetch;
      if (typeof of === 'function') w.fetch = function (input, init) {
        const u = (input && input.url) || input; const body = init && init.body;
        const p = of.apply(this, arguments);
        if (isEngine(u)) p.then(r => { try { r.clone().text().then(t => onPacket(String(body || ''), t)); } catch (e) {} }).catch(() => {});
        return p;
      };
    } catch (e) { log('fetch hook err', e && e.message); }
    try {
      const XP = w.XMLHttpRequest && w.XMLHttpRequest.prototype;
      if (XP) {
        const oo = XP.open, os = XP.send;
        XP.open = function (m, u) { this.__lunarEng = isEngine(u); return oo.apply(this, arguments); };
        XP.send = function (body) {
          if (this.__lunarEng) { const req = String(body || ''); this.addEventListener('load', () => { try { onPacket(req, this.responseText); } catch (e) {} }); }
          return os.apply(this, arguments);
        };
      }
    } catch (e) { log('xhr hook err', e && e.message); }
    log('net hook 已掛', (function () { try { return w.location.href.slice(0, 80); } catch (e) { return '?'; } })());
    return true;
  }

  // ---------- 封包處理 ----------
  function onPacket(reqText, resText) {
    let req = [], res = null;
    try { req = JSON.parse(reqText); if (!Array.isArray(req)) req = []; } catch (e) {}
    try { res = JSON.parse(resText); } catch (e) { return; }
    const actions = req.map(a => a && a.action).filter(Boolean);
    const events = (res && res.events) || [];
    const ev = {}; events.forEach(e => { if (e && e.event) { (ev[e.event] = ev[e.event] || []).push(e.context); if (!state.seenEvents[e.event]) { state.seenEvents[e.event] = 1; log('新事件', e.event); } } });
    const bal = res && res.platform && res.platform.balance != null ? cents(res.platform.balance) : null;
    if (res && res.platform && res.platform.gameRound) S.roundId = res.platform.gameRound.id || S.roundId;
    const prevBal = state.lastBalance;
    if (bal != null) { state.lastBalance = bal; if (ui.lastBal == null) { S.balance = bal; if (state.baseBalance == null) state.baseBalance = bal; S.pnl = Math.round((bal - state.baseBalance) * 100) / 100; } }
    state.log.push({ t: Date.now(), actions, events: Object.keys(ev), bal }); if (state.log.length > 200) state.log.shift();

    // 免遊/特色偵測（格式未實測 → 用事件名關鍵字 + 請求 action 保守判）
    const evNames = Object.keys(ev).join(',');
    const freeStart = /freeSpin|freespin|bonusStart|featureStart/i.test(evNames) && !/freeSpinsEnd|bonusEnd|featureEnd/i.test(evNames);
    const freeEnd = /freeSpinsEnd|bonusEnd|featureEnd/i.test(evNames);
    if (freeStart) S.freeGame = true; if (freeEnd || ev.gameRoundOver) { if (S.freeGame && (freeEnd || ev.gameRoundOver)) S.freeGame = false; }

    // 流水改由 UI 模式(readUI/tickUI)計，封包路徑不重複計；這裡只記 stake 供劇透倍數用
    const hasBet = actions.some(a => /^bet$/i.test(a));
    const betCtx = ev.bet && ev.bet[0]; const stake = betCtx && betCtx.total != null ? cents(betCtx.total) : null;
    // 劇透：gameEnd.win(分) 在回應就到、動畫後播
    if (ev.gameEnd && ev.gameEnd[0] && ev.gameEnd[0].win != null) { S.lastWin = cents(ev.gameEnd[0].win); S.gameWin = S.lastWin; if (S.spoilerOn) showSpoiler(S.lastWin, stake); }
    if (ev.gameRoundOver && ev.gameRoundOver[0] && ev.gameRoundOver[0].win != null) S.lastWin = cents(ev.gameRoundOver[0].win);
    // 特色計量（月兔 EXP）
    const fm = ev.featureMeter && ev.featureMeter.filter(Boolean).pop();
    if (fm && fm.feats && fm.feats.length) S.meter = { name: fm.feats[0].name, meter: fm.feats[0].meter, triggered: fm.triggered, count: fm.count };
    if (ev.config) { try { const c = ev.config[0] || {}; S.buyOutcomes = c.buyOutcomes || null; } catch (e) {} S.status = '已連線'; }
    if (hasBet) S.status = S.freeGame ? '🎰 免遊中' : '轉動中';
  }

  // ---------- UI 模式：側錄 PIXI 舞台、讀畫面文字 ----------
  function installStageHook(w) {
    if (w.__lunarStageHook) return true;
    try { const P = w.PIXI; const R = P && P.Renderer && P.Renderer.prototype; if (!R || !R.render) return false;
      w.__lunarStages = w.__lunarStages || []; const orig = R.render;
      R.render = function (obj) { try { if (obj && !obj.parent && w.__lunarStages.indexOf(obj) < 0) w.__lunarStages.push(obj); } catch (e) {} return orig.apply(this, arguments); };
      w.__lunarStageHook = true; log('舞台側錄已掛'); return true;
    } catch (e) { return false; }
  }
  const LBL = { bet: /^(投注|投註|下注|BET|TOTAL BET)$/i, bal: /^(余额|餘額|结余|結餘|BALANCE|CREDIT)$/i, win: /^(奖金|獎金|赢分|贏分|WIN)$/i, free: /^(免费旋转|免費旋轉|FREE SPINS?)$/i };
  const num = t => { const m = String(t || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? +m[0] : null; };
  function readUI(w) {
    const out = { bet: null, bal: null, win: null, free: null };
    try {
      const stages = w.__lunarStages || []; if (!stages.length) return null;
      const texts = []; const seen = new Set();
      const walk = (n, d) => { if (!n || d > 40 || seen.has(n)) return; seen.add(n); if (n.text != null && typeof n.text === 'string' && n.worldVisible) { const wt = n.worldTransform; texts.push({ t: String(n.text).trim(), x: Math.round(wt ? wt.tx : 0), y: Math.round(wt ? wt.ty : 0), n: n }); } const ch = n.children; if (ch) for (let i = 0; i < ch.length; i++) walk(ch[i], d + 1); };
      stages.forEach(st => walk(st, 0));
      const near = (t) => texts.find(u => u !== t && Math.abs(u.x - t.x) < 4 && u.y < t.y && u.y > t.y - 48 && num(u.t) != null);   // 標籤上方的數字
      const beside = (t) => texts.find(u => u !== t && Math.abs(u.y - t.y) < 4 && u.x > t.x && u.x < t.x + 260 && num(u.t) != null);   // 標籤右邊的數字
      for (const t of texts) {
        if (out.bet == null && LBL.bet.test(t.t)) { const v = near(t); if (v) out.bet = num(v.t); }
        else if (out.bal == null && LBL.bal.test(t.t)) { const v = near(t); if (v) { out.bal = num(v.t); out.balNode = v.n; } }
        else if (out.win == null && LBL.win.test(t.t)) { const v = near(t); if (v) out.win = num(v.t); }
        else if (out.free == null && LBL.free.test(t.t)) { const v = beside(t); if (v) out.free = num(v.t); }
      }
      return out;
    } catch (e) { return null; }
  }
  const ui = { lastBal: null, bet: null, hookedNode: null };
  function onBalance(bal) {   // 餘額變動處理（setter 即時觸發；輪詢後備）
    if (bal == null) return;
    if (ui.lastBal == null) { ui.lastBal = bal; S.balance = bal; if (state.baseBalance == null) state.baseBalance = bal; S.status = '已連線'; return; }
    if (bal === ui.lastBal) return;
    const d = Math.round((ui.lastBal - bal) * 100) / 100;   // 正=扣款
    if (d > 0 && !S.freeGame) {
      const isSpin = ui.bet != null && Math.abs(d - ui.bet) < 0.005;
      S.spins++;
      try { if (window.__sethTurnover) window.__sethTurnover.add(d, { game: GAME, kind: isSpin ? 'spin' : 'buy' }); } catch (e) {}
      log(isSpin ? '下注' : '買特色(以扣款計)', d, '餘額', bal); S.status = '轉動中';
    } else if (d > 0 && S.freeGame) log('免遊中扣款(不計)', d);
    ui.lastBal = bal; S.balance = bal; S.pnl = Math.round((bal - state.baseBalance) * 100) / 100;
  }
  function hookBalanceNode(node) {   // 在餘額 Text 物件上包一層 text setter：遊戲一改字就立刻算，不靠輪詢
    if (!node || ui.hookedNode === node) return;
    try {
      let proto = Object.getPrototypeOf(node), desc = null; while (proto && !desc) { desc = Object.getOwnPropertyDescriptor(proto, 'text'); proto = Object.getPrototypeOf(proto); }
      if (!desc || !desc.set) return;
      Object.defineProperty(node, 'text', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); try { onBalance(num(v)); } catch (e) {} } });
      ui.hookedNode = node; log('餘額節點已掛即時觸發');
    } catch (e) {}
  }
  function tickUI() {
    if (!gameWin) return; installStageHook(gameWin);
    const r = readUI(gameWin); if (!r || r.bal == null) return;
    if (r.bet != null) { ui.bet = r.bet; S.bet = r.bet; }
    if (r.free != null) { S.freeGame = r.free > 0; S.freeLeft = r.free; }
    if (r.win != null) S.lastWin = r.win;
    if (r.balNode) hookBalanceNode(r.balNode);
    onBalance(r.bal);
  }
  setInterval(() => { try { tickUI(); } catch (e) {} }, 100);


  // ---------- 加速：PIXI ticker 直接加速遊戲更新，並縮短旋轉停輪計時 ----------
  // PIXI 的 ticker 先載入、外掛後注入時，改 rAF 時間戳不會影響已綁定的原生 rAF。
  // 因此攔截 PIXI.Ticker.prototype.update，直接調整每一個 ticker 的 speed。
  function installClock(w) {
    if (w.__lunarClock) return w.__lunarClock;
    const mk = (realNow) => { const c = { k: 1, vBase: realNow(), rBase: realNow(), now() { return this.vBase + (realNow() - this.rBase) * this.k; }, set(k) { const r = realNow(); this.vBase = this.now(); this.rBase = r; this.k = k; } }; return c; };
    const perf = w.performance, rp = perf.now.bind(perf), NativeDate = w.Date, rd = NativeDate.now.bind(NativeDate);
    const pc = mk(rp), dc = mk(rd);
    try { perf.now = function () { return pc.now(); }; } catch (e) {}
    try {
      // LunarRabbit's ReelsSpinner measures its 1500ms minimum spin with
      // new Date().getTime(), so replacing Date.now alone leaves reel stop
      // timing at real speed. Virtualize no-argument Date construction too;
      // explicit Date(value) parsing stays native.
      function LunarDate() {
        if (!new.target) return new NativeDate(dc.now()).toString();
        return arguments.length ? new NativeDate(...arguments) : new NativeDate(dc.now());
      }
      LunarDate.prototype = NativeDate.prototype;
      Object.setPrototypeOf(LunarDate, NativeDate);
      LunarDate.now = function () { return Math.round(dc.now()); };
      w.Date = LunarDate;
    } catch (e) {
      try { NativeDate.now = function () { return Math.round(dc.now()); }; } catch (_) {}
    }
    const oraf = w.requestAnimationFrame.bind(w);
    // Keep rAF timestamps real. PIXI gets its multiplier through Ticker.speed,
    // so scaling both would accidentally multiply the selected rate twice.
    w.requestAnimationFrame = function (cb) { return oraf(function (t) { return cb(t); }); };
    const ost = w.setTimeout.bind(w), osi = w.setInterval.bind(w);
    w.setTimeout = function (fn, d) { const a = Array.prototype.slice.call(arguments); if (pc.k !== 1 && +d > 0) a[1] = (+d) / pc.k; return ost.apply(null, a); };
    w.setInterval = function (fn, d) { const a = Array.prototype.slice.call(arguments); if (pc.k !== 1 && +d > 0) a[1] = (+d) / pc.k; return osi.apply(null, a); };
    let probeCount = 0, probeTimer = null;
    const tickers = new Set();
    function syncTicker(ticker) {
      try {
        const k = pc.k;
        const previousMultiplier = Number(ticker.__lunarAppliedMultiplier) || 1;
        const currentSpeed = Number(ticker.speed);
        if (!Number.isFinite(currentSpeed)) return false;
        if (k !== previousMultiplier) {
          const baseSpeed = currentSpeed / previousMultiplier;
          ticker.speed = baseSpeed * k;
          ticker.__lunarBaseSpeed = baseSpeed;
          ticker.__lunarAppliedMultiplier = k;
        }
        return Math.abs(Number(ticker.speed) - (Number(ticker.__lunarBaseSpeed) || currentSpeed) * k) < 0.001;
      } catch (_) { return false; }
    }
    function patchPixiTicker() {
      try {
        const Ticker = w.PIXI && w.PIXI.Ticker;
        const proto = Ticker && Ticker.prototype;
        if (!proto || typeof proto.update !== 'function') return false;
        if (proto.__lunarSpeedPatch) return true;
        const original = proto.update;
        Object.defineProperty(proto, '__lunarSpeedPatch', { value: true, configurable: true });
        proto.update = function () {
          tickers.add(this);
          syncTicker(this);
          return original.apply(this, arguments);
        };
        log('PIXI ticker 加速已接上', w.PIXI.VERSION || '');
        return true;
      } catch (e) { log('PIXI ticker 加速失敗', e && e.message); return false; }
    }
    function probePixiTicker() {
      if (patchPixiTicker()) { if (probeTimer != null) { w.clearInterval(probeTimer); probeTimer = null; } return; }
      if (++probeCount >= 240 && probeTimer != null) { w.clearInterval(probeTimer); probeTimer = null; }
    }
    const clock = {
      set(k) { pc.set(k); dc.set(k); probePixiTicker(); tickers.forEach(syncTicker); return this.verify(); },
      verify() { probePixiTicker(); return tickers.size > 0 && Array.from(tickers).every(syncTicker); },
      get k() { return pc.k; }
    };
    w.__lunarClock = clock; log('虛擬時鐘已裝');
    probePixiTicker();
    if (!w.__lunarClockTickerProbe) {
      w.__lunarClockTickerProbe = true;
      probeTimer = osi(probePixiTicker, 250);
    }
    return clock;
  }
  let gameWin = null, clock = null;
  function setSpeedImpl(k) {
    k = Number(k); if (!SPEEDS.includes(k)) return false; S.speed = k;
    try { S.speedApplied = !!(clock && clock.set(k)); } catch (e) { S.speedApplied = false; }
    try { localStorage.setItem('lunar_speed', String(k)); } catch (e) {}
    log('setSpeed', k + 'x');
    return true;
  }
  S.setSpeed = setSpeedImpl; S.getLog = () => state.log.slice(); S.setSpoiler = (on) => { S.spoilerOn = !!on; if (!on) hideSpoiler(); };

  // ---------- 掛上遊戲視窗（輪詢：iframe 可能晚出現；hook 要在遊戲送第一個請求前，config 沒攔到也沒關係） ----------
  let tries = 0;
  const hookTimer = setInterval(() => {
    tries++;
    try {
      const ws = gameWindows();
      for (const w of ws) { if (w.__lunarNetHook) continue; if (isGameWin(w) || w !== window) { installNetHook(w); if (isGameWin(w)) { gameWin = w; clock = installClock(w); if (S.speed !== 1) clock.set(S.speed); } } }
      if (gameWin && gameWin.__lunarNetHook) { S.status = S.status === '等待遊戲載入' ? '已掛上遊戲' : S.status; clearInterval(hookTimer); }
    } catch (e) {}
    if (tries > 240) clearInterval(hookTimer);   // 2 分鐘還沒有就放棄(不是月兔頁)
  }, 500);
  // 外層自己也先掛(遊戲若在本頁直接跑)
  try { if (isGameWin(window)) { installNetHook(window); gameWin = window; clock = installClock(window); } } catch (e) {}

  // ---------- 劇透卡 + HUD ----------
  const g = id => document.getElementById(id);
  const GOLD = '#52e4ff', LINE = '#28445f';
  function showSpoiler(win, stake) {
    try {
      let el = g('__lunarSpoil'); if (!el) { el = document.createElement('div'); el.id = '__lunarSpoil'; el.style.cssText = 'position:fixed;top:14%;left:50%;transform:translateX(-50%);z-index:2147483646;padding:8px 16px;border-radius:12px;background:rgba(21,17,11,.92);border:1px solid ' + GOLD + ';color:#f3e3b8;font:700 16px/1.3 -apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.6);pointer-events:none;transition:opacity .3s'; document.body.appendChild(el); }
      const x = stake ? (win / stake) : 0;
      el.textContent = win > 0 ? ('結果提示：贏 ' + win.toLocaleString() + (x >= 5 ? '（' + Math.round(x) + ' 倍！）' : '')) : '結果提示：未中';
      el.style.color = win > 0 ? (x >= 5 ? '#ffd93d' : '#9fe8b0') : '#9c8a66'; el.style.opacity = '1';
      clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, win > 0 ? 3500 : 1500);
    } catch (e) {}
  }
  function hideSpoiler() { try { const el = g('__lunarSpoil'); if (el) el.style.opacity = '0'; } catch (e) {} }

  function buildOverlay() {
    if (g('__lunarHud')) return;
    const wrap = document.createElement('div'); wrap.id = '__lunarHud';
    wrap.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;width:150px;font:12px/1.4 -apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;color:#e8dcc0;background:rgba(5,17,31,.94);border:1px solid ' + LINE + ';border-radius:12px;padding:7px 8px;box-shadow:0 6px 22px rgba(0,0,0,.6);touch-action:none;user-select:none;-webkit-user-select:none';
    wrap.innerHTML =
      '<div id="__lunarBar" style="display:flex;align-items:center;justify-content:center;cursor:move;margin-bottom:6px;position:relative"><img src="/logo.png" alt="聖甲之心" style="width:22px;height:22px;object-fit:contain"><span style="font-size:11px;color:' + GOLD + ';margin-left:4px">聖甲之心</span>' +
        '<span id="__lunarMin" style="cursor:pointer;color:#9c8a66;padding:0 3px;position:absolute;right:0;top:50%;transform:translateY(-50%)">－</span></div>' +
      '<div id="__lunarBody">' +
        '<div style="text-align:center;padding:5px 0;margin-bottom:6px;border:1px solid ' + LINE + ';border-radius:9px;background:rgba(40,32,18,.4)">' +
          '<div style="font-size:9px;color:#9c8a66">本場輸贏</div><div id="__lunarPnl" style="font-size:20px;font-weight:800;color:#7CFC00">—</div>' +
          '<div id="__lunarBal" style="font-size:9px;color:#9c8a66"></div>' +
          '<div style="display:flex;justify-content:space-around;margin-top:5px;padding-top:5px;border-top:1px solid ' + LINE + '">' +
            '<div style="text-align:center"><div style="font-size:8px;color:#9c8a66">本轉</div><div id="__lunarWin" style="font-size:13px;font-weight:700;color:#ffd08c">—</div></div>' +
            '<div style="text-align:center"><div style="font-size:8px;color:#9c8a66">特色計量</div><div id="__lunarMeter" style="font-size:13px;font-weight:700;color:#9fe8b0">—</div></div>' +
          '</div><div id="__lunarStatus" style="font-size:9px;color:#9c8a66;margin-top:4px"></div></div>' +
        '<div id="__lunarTv"></div>' +
        '<div style="font-size:9px;color:#9c8a66;margin:4px 0 3px">🚀 加速器</div>' +
      '<div id="__lunarSpeed" style="display:flex;gap:3px">' + SPEEDS.map(k => '<button data-s="' + k + '" aria-label="旋轉加速 ' + k + ' 倍" style="flex:1;height:26px;border:1px solid ' + LINE + ';border-radius:7px;background:#15110b;color:#c9b890;font-size:11px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent">' + k + 'x</button>').join('') + '</div>' +
        '<div id="__lunarSpeedStatus" aria-live="polite" style="min-height:13px;margin-top:3px;text-align:center;font-size:9px;color:#e2c26a">尚未確認遊戲旋轉倍率</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;font-size:10px;color:#c9b890"><span>結果提示</span><button id="__lunarSpoilBtn" style="width:32px;height:17px;border:0;border-radius:9px;background:' + GOLD + ';position:relative;cursor:pointer"></button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend'].forEach(n => wrap.addEventListener(n, e => e.stopPropagation()));
    // 最小化
    let min = false; g('__lunarMin').onclick = () => { min = !min; g('__lunarBody').style.display = min ? 'none' : ''; g('__lunarMin').textContent = min ? '＋' : '－'; wrap.style.width = min ? '70px' : '150px'; };
    // 拖曳
    const bar = g('__lunarBar'); let dx = 0, dy = 0, drag = false;
    const start = (x, y) => { drag = true; const r = wrap.getBoundingClientRect(); dx = x - r.left; dy = y - r.top; };
    const move = (x, y) => { if (!drag) return; wrap.style.left = Math.max(0, Math.min(window.innerWidth - wrap.offsetWidth, x - dx)) + 'px'; wrap.style.top = Math.max(0, Math.min(window.innerHeight - 30, y - dy)) + 'px'; };
    bar.addEventListener('mousedown', e => start(e.clientX, e.clientY)); window.addEventListener('mousemove', e => move(e.clientX, e.clientY)); window.addEventListener('mouseup', () => { drag = false; });
    bar.addEventListener('touchstart', e => { const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true }); window.addEventListener('touchmove', e => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true }); window.addEventListener('touchend', () => { drag = false; });
    // 速度鈕
    const paint = () => g('__lunarSpeed').querySelectorAll('button').forEach(x => { const on = +x.dataset.s === S.speed; x.style.background = on ? 'linear-gradient(180deg,#e2c26a,' + GOLD + ')' : '#15110b'; x.style.color = on ? '#1a1206' : '#c9b890'; x.style.fontWeight = on ? '700' : '400'; x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    const paintSpeedStatus = () => {
      const status = g('__lunarSpeedStatus'); if (!status) return;
      const ready = !!(clock && clock.verify()); S.speedApplied = ready;
      status.textContent = ready ? ('旋轉加速已生效：' + S.speed + 'x') : ('已選 ' + S.speed + 'x，正在套用到旋轉…');
      status.style.color = ready ? '#7CFC00' : '#e2c26a';
    };
    const buttons = g('__lunarSpeed').querySelectorAll('button');
    let lastSpeedPressAt = -Infinity;
    const selectSpeed = (b, ev) => {
      const now = performance.now();
      if (ev && ev.type === 'click' && now - lastSpeedPressAt < 500) return;
      lastSpeedPressAt = now;
      if (ev && ev.cancelable) ev.preventDefault();
      setSpeedImpl(+b.dataset.s); paint(); paintSpeedStatus();
    };
    buttons.forEach(b => {
      b.addEventListener('pointerdown', ev => selectSpeed(b, ev), { passive: false });
      b.onclick = ev => selectSpeed(b, ev);
    });
    paint(); paintSpeedStatus(); setInterval(paintSpeedStatus, 100);
    // 劇透開關
    const sb = g('__lunarSpoilBtn'); const paintS = () => { sb.style.background = S.spoilerOn ? GOLD : '#3a3020'; sb.innerHTML = '<i style="position:absolute;top:2px;' + (S.spoilerOn ? 'left:17px' : 'left:2px') + ';width:13px;height:13px;border-radius:50%;background:#f3e3b8"></i>'; };
    sb.onclick = () => { S.setSpoiler(!S.spoilerOn); paintS(); }; paintS();
    // 流水/任務（turnover.js）
    try {
      if (window.__sethTurnover) {
        window.__sethTurnover.init({ account: cfg.SETH_ACCOUNT || '', api: cfg.SETH_API || '', key: cfg.SETH_KEY || '', token: cfg.SETH_TOKEN || '', task: cfg.SETH_TASK || null, time: cfg.SETH_TIME || null, game: GAME, device: cfg.SETH_DEVICE || '', appVer: cfg.APP_VER || '' });
        window.__sethTurnover.mount(g('__lunarTv'), 'land');
        try { const btn = window.__sethTurnover.button('land'); if (btn) { btn.style.marginTop = '4px'; g('__lunarTv').appendChild(btn); } } catch (e) {}
      }
    } catch (e) { log('turnover init err', e && e.message); }
    // 自我更新
    setInterval(() => { try {
      const pnl = g('__lunarPnl'); if (S.pnl != null) { pnl.textContent = (S.pnl >= 0 ? '+' : '') + S.pnl.toLocaleString(); pnl.style.color = S.pnl < 0 ? '#ff7a7a' : '#7CFC00'; }
      g('__lunarBal').textContent = S.balance != null ? ('餘額 ' + S.balance.toLocaleString()) : '';
      g('__lunarWin').textContent = S.lastWin != null ? S.lastWin.toLocaleString() : '—';
      g('__lunarMeter').textContent = S.meter ? (S.meter.meter + (S.meter.count ? '/' + S.meter.count : '')) : '—';
      g('__lunarStatus').textContent = (S.freeGame ? '🎰 免遊中' : S.status) + '  ' + S.spins + ' 轉';
    } catch (e) {} }, 500);
    log('overlay HUD 已建');
  }
  try { const sp = +localStorage.getItem('lunar_speed'); if (SPEEDS.includes(sp) && (!cfg.SPEED || Number(cfg.SPEED) === 1)) S.speed = sp; } catch (e) {}
  if (cfg.UI !== 'none') { let bt = 0; const bv = setInterval(() => { bt++; try { if (document.body) { buildOverlay(); clearInterval(bv); } } catch (e) {} if (bt > 100) clearInterval(bv); }, 150); }
  log('lunarEngine 啟動', GAME, 'speed', S.speed);
  return S;
}
