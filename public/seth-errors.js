// ===== 聖甲之心 · 本機錯誤記錄 =====
//   ① 每個錯誤 → 生成診斷碼 E<HTTP>-<步驟>-<唯一碼>，並存進本機最近 20 筆記錄
//   ② 用戶可開「錯誤記錄」詳情卡，一張截圖就含全部資訊(時間/帳號/娛樂城/步驟/技術細節)
//   ③ 之後接後端：詳情卡多一顆「回報客服」自動上傳 + TG 通知（API 規格另交接）
(function () {
  var STEP = { LGN: '登入', ROOM: '選房', ENTER: '進房', GAME: '遊戲', COIN: '金幣', BOARD: '榜單', GATE: '資格', PASS: '通行證', NET: '連線', GEN: '一般' };

  // HTTP / 錯誤 → 用戶看的白話（真實狀況，不露代碼）
  function human(status, raw) {
    raw = raw || '';
    if (status === 403) return '此帳號目前無法登入，請確認站台與帳號權限';
    if (status === 401 || status === 422 || status === 400) return '帳號或密碼錯誤，請重新確認';
    if (status === 404) return '找不到資料，請稍後再試';
    if (status === 429) return '操作太頻繁，請等 30 秒再試一次';
    if (status >= 500) return '伺服器忙碌中，請稍後再試';
    if (/逾時|timeout|timed out|WS ?逾時/i.test(raw)) return '連線逾時，網路不太穩，請檢查網路後重試';
    if (/network|failed to fetch|WS ?錯誤|connect|斷|離線|offline/i.test(raw)) return '網路連線異常，請檢查網路後重試';
    return raw || '發生未預期的問題，請記下診斷碼';
  }

  function code(status, stepKey) {
    var rnd = Math.floor(Math.random() * 0xffff).toString(16).toUpperCase();
    while (rnd.length < 4) rnd = '0' + rnd;
    return 'E' + (status || 'X') + '-' + (stepKey || 'GEN') + '-' + rnd;
  }

  function fmtTime(ms) {
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function read() { try { return JSON.parse(localStorage.getItem('seth_errlog') || '[]'); } catch (e) { return []; } }
  function save(arr) { try { localStorage.setItem('seth_errlog', JSON.stringify(arr)); } catch (e) {} }

  // 主入口：吃 (步驟, 錯誤物件, 上下文) → 生碼＋白話＋記錄，回 { code, human }
  function handle(stepKey, error, ctx) {
    ctx = ctx || {};
    var status = (error && (error.status || error.httpStatus)) || 0;
    var raw = (error && error.message) || (typeof error === 'string' ? error : '') || '';
    var c = code(status, stepKey);
    var rec = {
      code: c, t: Date.now(),
      step: STEP[stepKey] || stepKey, stepKey: stepKey,
      status: status, raw: raw,
      account: ctx.account || '', base: ctx.base || '', game: ctx.game || '',
      ver: window.SETH_APP_VER || '', plat: (window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform()) || 'web'
    };
    var arr = read(); arr.unshift(rec); if (arr.length > 20) arr.length = 20; save(arr);
    try { console.log('[SETH][ERR]', c, status, stepKey, raw); } catch (e) {}
    return { code: c, human: human(status, raw), rec: rec };
  }

  // 純文字化（給複製 / 之後上傳）
  function recToText(r) {
    return [
      '診斷碼：' + r.code,
      '時間：' + fmtTime(r.t),
      '步驟：' + r.step,
      '狀況：' + human(r.status, r.raw),
      '帳號：' + (r.account || '—'),
      '娛樂城：' + (r.base || '—') + '　遊戲：' + (r.game || '—'),
      '技術：HTTP ' + (r.status || '-') + ' / ' + (r.raw || '-') + ' / ' + r.plat + ' / ' + (r.ver || '?')
    ].join('\n');
  }
  function allText() {
    var a = read(); if (!a.length) return '（目前沒有錯誤記錄）';
    return '【聖甲之心 錯誤記錄】\n' + a.map(function (r, i) { return (i + 1) + '. ' + recToText(r); }).join('\n\n');
  }

  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); return true; }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true;
    } catch (e) { return false; }
  }

  // 詳情卡：列最近錯誤，一張截圖含全部資訊；頂部「複製全部」；每筆可單獨複製
  function showLog() {
    var old = document.getElementById('sethErrModal'); if (old) old.remove();
    var arr = read();
    var mask = document.createElement('div'); mask.id = 'sethErrModal';
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.66);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    var box = document.createElement('div');
    box.style.cssText = 'background:#1a140d;border:1px solid #6b5630;border-radius:16px;max-width:360px;width:100%;max-height:80vh;overflow:auto;box-shadow:0 14px 44px rgba(0,0,0,.6)';
    var head = '<div style="position:sticky;top:0;background:#1a140d;padding:16px 16px 10px;border-bottom:1px solid #3a3020">'
      + '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:16px;font-weight:800;color:#e8c878">錯誤記錄</span>'
      + '<span style="font-size:12px;color:#9c8a66">最近 ' + arr.length + ' 筆</span>'
      + '<button id="sethErrClose" style="margin-left:auto;width:30px;height:30px;border-radius:8px;background:#2a2018;border:1px solid #5a4a2a;color:#c9b890;font-size:15px;font-weight:800">✕</button></div>'
      + '<div style="font-size:11.5px;color:#7a6a48;margin-top:6px;line-height:1.5">可保留這頁截圖，或點下方複製診斷資料。</div></div>';
    var body = '<div style="padding:12px 16px">';
    if (!arr.length) {
      body += '<div style="color:#7a6a48;font-size:13px;text-align:center;padding:24px 0">目前沒有錯誤記錄 🎉</div>';
    } else {
      arr.forEach(function (r) {
        body += '<div style="border:1px solid #3a3020;border-radius:11px;padding:11px 12px;margin-bottom:10px;background:#15110b">'
          + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-family:monospace;font-size:13px;font-weight:800;color:#7fdc8f">' + r.code + '</span>'
          + '<span style="font-size:11px;color:#9c8a66;margin-left:auto">' + fmtTime(r.t) + '</span></div>'
          + '<div style="font-size:13px;color:#f5e6c8;line-height:1.6;margin-bottom:6px">' + human(r.status, r.raw) + '</div>'
          + '<div style="font-size:11px;color:#8a7a58;line-height:1.6">步驟 ' + r.step + '　帳號 ' + (r.account || '—') + '<br>技術 HTTP ' + (r.status || '-') + ' · ' + (r.raw || '-') + ' · ' + r.plat + ' · ' + (r.ver || '?') + '</div>'
          + '</div>';
      });
    }
    body += '</div>';
    var foot = '<div style="position:sticky;bottom:0;background:#1a140d;padding:10px 16px 16px;border-top:1px solid #3a3020;display:flex;gap:10px">'
      + '<button id="sethErrCopy" style="flex:1;min-height:46px;border:0;border-radius:11px;background:linear-gradient(180deg,#e8c878,#c79a3e);color:#2a1e08;font-size:14px;font-weight:800">📋 複製全部</button></div>';
    box.innerHTML = head + body + foot; mask.appendChild(box); document.body.appendChild(mask);
    document.getElementById('sethErrClose').onclick = function () { mask.remove(); };
    mask.onclick = function (e) { if (e.target === mask) mask.remove(); };
    document.getElementById('sethErrCopy').onclick = function (e) {
      var ok = copy(allText()); e.target.textContent = ok ? '✅ 已複製' : '請長按上方文字複製';
      setTimeout(function () { e.target.textContent = '📋 複製全部'; }, 1600);
    };
  }

  window.SethErr = { handle: handle, human: human, read: read, showLog: showLog, allText: allText, fmtTime: fmtTime };
})();
