/* v3.11 passive six-game ATG recommendation probe.
   Runs only inside the hidden recommendation iframe.
   Read-only: never patches WebSocket, System.register, Map, WeakMap, fetch, XHR,
   or any normal game runtime. The ATG room-table screen is allowed to initialize
   normally; this probe reads its already-decoded model state from SystemJS/App. */
(function () {
  'use strict';
  if (window.__scarabSixRecommendationProbeInstalled) return;
  window.__scarabSixRecommendationProbeInstalled = true;

  var gameCode = String(window.__SC_GAME_CODE || '');
  var startedAt = Date.now();
  var sent = false;
  var busy = false;
  var timer = null;
  var lastProgress = '';
  var registryScanAt = 0;

  function num(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function progress(stage, detail) {
    if (sent) return;
    var key = String(stage || '') + '|' + String(detail || '');
    if (key === lastProgress) return;
    lastProgress = key;
    try {
      parent.postMessage({
        __scarabRecommendationProbe: true,
        progress: true,
        gameCode: gameCode,
        stage: String(stage || ''),
        detail: String(detail || '')
      }, location.origin);
    } catch (_) {}
  }

  function normalizeTable(t) {
    if (!t || typeof t !== 'object') return null;
    var roomId = t.roomId != null ? t.roomId :
      (t.room_id != null ? t.room_id :
      (t.tableId != null ? t.tableId :
      (t.table_id != null ? t.table_id : t.id)));
    var number = t.number != null ? t.number :
      (t.machineNum != null ? t.machineNum :
      (t.machineNo != null ? t.machineNo :
      (t.machine_no != null ? t.machine_no :
      (t.roomNumber != null ? t.roomNumber : t.tableNumber))));
    if (roomId == null || number == null) return null;
    var machineNum = String(number).trim();
    if (!/^\d+$/.test(machineNum)) return null;
    var today = t.today && typeof t.today === 'object' ? t.today : {};
    var status = String(t.status != null ? t.status : (t.tableStatus != null ? t.tableStatus : ''));
    return {
      roomId: String(roomId),
      machineNum: machineNum,
      status: status,
      isLocked: !!t.isLocked || !!t.locked || /locked/i.test(status),
      todayWin: num(today.win != null ? today.win : t.todayWin),
      todayBet: num(today.bet != null ? today.bet : t.todayBet),
      win: num(t.win),
      bet: num(t.bet),
      rawFree: t.freeGameCount != null ? num(t.freeGameCount) :
        (t.freeSpinCount != null ? num(t.freeSpinCount) :
        (t.fg != null ? num(t.fg) : null))
    };
  }

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    var seen = Object.create(null);
    var limit = Math.min(list.length, 4000);
    for (var i = 0; i < limit; i++) {
      var row = normalizeTable(list[i]);
      if (!row) continue;
      var key = row.roomId + ':' + row.machineNum;
      if (seen[key]) continue;
      seen[key] = true;
      out.push(row);
    }
    return out;
  }

  function finish() {
    if (timer) { clearInterval(timer); timer = null; }
    busy = false;
  }

  function publish(list, source, meta) {
    if (sent) return false;
    var rows = normalizeList(list);
    if (!rows.length) return false;
    sent = true;
    finish();
    try {
      parent.postMessage({
        __scarabRecommendationProbe: true,
        ok: true,
        gameCode: gameCode,
        source: source || 'atg-system-registry',
        capturedAt: Date.now(),
        tableMeta: meta || null,
        tables: rows
      }, location.origin);
    } catch (_) {}
    return true;
  }

  function envelope(value) {
    if (!value || typeof value !== 'object') return null;
    var candidates = [];
    try { candidates.push({ list:value.tables, meta:value.tableMeta }); } catch (_) {}
    try { candidates.push({ list:value.slotTables, meta:value.tableMeta }); } catch (_) {}
    try { candidates.push({ list:value.tableList, meta:value.tableMeta }); } catch (_) {}
    try { candidates.push({ list:value.platform && value.platform.tables, meta:value.platform && value.platform.tableMeta }); } catch (_) {}
    try { candidates.push({ list:value.data && value.data.tables, meta:value.data && value.data.tableMeta }); } catch (_) {}
    try { candidates.push({ list:value.data && value.data.platform && value.data.platform.tables, meta:value.data && value.data.platform && value.data.platform.tableMeta }); } catch (_) {}
    try { candidates.push({ list:value._data && value._data.tables, meta:value._data && value._data.tableMeta }); } catch (_) {}
    try { candidates.push({ list:value._data && value._data.platform && value._data.platform.tables, meta:value._data && value._data.platform && value._data.platform.tableMeta }); } catch (_) {}
    try { candidates.push({ list:value.model && value.model.tables, meta:value.model && value.model.tableMeta }); } catch (_) {}
    try { candidates.push({ list:value.state && value.state.tables, meta:value.state && value.state.tableMeta }); } catch (_) {}
    for (var i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i].list) && normalizeList(candidates[i].list).length) return candidates[i];
    }
    return null;
  }

  function walk(root, maxDepth, nodeLimit) {
    if (!root || typeof root !== 'object') return null;
    var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var nodes = 0;
    var found = null;
    function visit(value, depth) {
      if (found || !value || typeof value !== 'object' || depth > maxDepth || nodes >= nodeLimit) return;
      nodes++;
      if (seen) {
        try { if (seen.has(value)) return; seen.add(value); } catch (_) {}
      }
      var env = envelope(value);
      if (env) { found = env; return; }
      try {
        if (typeof Map !== 'undefined' && value instanceof Map) {
          var mc = 0;
          value.forEach(function(v){ if (!found && mc++ < 300) visit(v, depth + 1); });
          return;
        }
      } catch (_) {}
      try {
        if (typeof Set !== 'undefined' && value instanceof Set) {
          var sc = 0;
          value.forEach(function(v){ if (!found && sc++ < 300) visit(v, depth + 1); });
          return;
        }
      } catch (_) {}
      if (Array.isArray(value)) {
        for (var ai = 0; ai < Math.min(value.length, 120) && !found; ai++) visit(value[ai], depth + 1);
        return;
      }
      var priority = ['default','data','_data','platform','model','_model','models','_models','state','_state','value','_value','instance','_instance'];
      for (var p = 0; p < priority.length && !found; p++) {
        try { if (value[priority[p]]) visit(value[priority[p]], depth + 1); } catch (_) {}
      }
      var keys;
      try { keys = Object.keys(value); } catch (_) { return; }
      for (var k = 0; k < Math.min(keys.length, 80) && !found; k++) {
        var key = keys[k];
        if (/^(parent|_parent|node|_node|children|_children|scene|_scene)$/i.test(key)) continue;
        try { visit(value[key], depth + 1); } catch (_) {}
      }
    }
    visit(root, 0);
    return found;
  }

  function candidateIds(sys) {
    var ids = [
      'chunks:///_virtual/PlatformModel.ts',
      'chunks:///_virtual/SlotTableModel.ts',
      'chunks:///_virtual/SlotFrameworkData.ts'
    ];
    try {
      var reg = sys && sys.registerRegistry;
      if (reg && typeof reg === 'object') {
        Object.keys(reg).forEach(function(id){
          if (/\/(?:PlatformModel|SlotTableModel|SlotFrameworkData)\.ts(?:$|\?)/i.test(id) && ids.indexOf(id) < 0) ids.push(id);
        });
      }
    } catch (_) {}
    try {
      if (sys && typeof sys.entries === 'function') {
        var iterator = sys.entries();
        var step, guard = 0;
        while (iterator && !(step = iterator.next()).done && guard++ < 2500) {
          var id = step.value && step.value[0];
          if (typeof id === 'string' && /\/(?:PlatformModel|SlotTableModel|SlotFrameworkData)\.ts(?:$|\?)/i.test(id) && ids.indexOf(id) < 0) ids.push(id);
        }
      }
    } catch (_) {}
    return ids;
  }

  function scanSystemExecuted(sys) {
    if (!sys) return null;
    var ids = candidateIds(sys);
    for (var i = 0; i < ids.length; i++) {
      try {
        if (typeof sys.get === 'function') {
          var mod = sys.get(ids[i]);
          var env = walk(mod, 6, 5000);
          if (env) return { env:env, source:'atg-system-get:' + ids[i] };
        }
      } catch (_) {}
    }
    // Registry-wide scan is the robust path for Cocos/SystemJS named modules.
    try {
      if (typeof sys.entries === 'function') {
        var it = sys.entries();
        var step, count = 0;
        while (it && !(step = it.next()).done && count++ < 2500) {
          var pair = step.value || [];
          var id = String(pair[0] || '');
          var mod2 = pair[1];
          // Model/framework modules first; generic modules only if they expose a plausible table array.
          if (/PlatformModel|SlotTableModel|SlotFrameworkData/i.test(id)) {
            var env2 = walk(mod2, 7, 7000);
            if (env2) return { env:env2, source:'atg-system-entry:' + id };
          } else {
            var direct = envelope(mod2);
            if (direct) return { env:direct, source:'atg-system-entry-direct:' + id };
          }
        }
      }
    } catch (_) {}
    return null;
  }

  async function importRegistryCandidates(sys) {
    if (!sys || typeof sys.import !== 'function') return null;
    var ids = candidateIds(sys);
    for (var i = 0; i < ids.length; i++) {
      try {
        var mod = await sys.import(ids[i]);
        var env = walk(mod, 7, 7000);
        if (env) return { env:env, source:'atg-system-import:' + ids[i] };
      } catch (_) {}
    }
    return null;
  }

  function scanApp() {
    var roots = [];
    try { if (window.App) roots.push(window.App); } catch (_) {}
    try { if (window.App && window.App.dataCenter) roots.push(window.App.dataCenter); } catch (_) {}
    try { if (window.cc) roots.push(window.cc); } catch (_) {}
    for (var i = 0; i < roots.length; i++) {
      var env = walk(roots[i], 8, 10000);
      if (env) return { env:env, source:'atg-app-datacenter' };
    }
    return null;
  }

  async function tick() {
    if (sent || busy) return;
    busy = true;
    try {
      var sys = window.System;
      if (!sys) {
        progress('boot', '等待 ATG framework');
        return;
      }
      progress('system', 'ATG framework 已載入');

      var hit = scanSystemExecuted(sys);
      if (hit && publish(hit.env.list, hit.source, hit.env.meta)) return;

      var appHit = scanApp();
      if (appHit && publish(appHit.env.list, appHit.source, appHit.env.meta)) return;

      // Do not continuously import. Once per second is enough and avoids needless work.
      if (Date.now() - registryScanAt >= 1000) {
        registryScanAt = Date.now();
        var imported = await importRegistryCandidates(sys);
        if (imported && publish(imported.env.list, imported.source, imported.env.meta)) return;
      }

      progress('tables', '等待 ATG 機台表');
    } catch (_) {
      progress('retry', '重新讀取 ATG 機台表');
    } finally {
      busy = false;
    }
  }

  timer = setInterval(function () {
    if (sent) return finish();
    tick();
    if (Date.now() - startedAt > 32000) {
      finish();
      if (!sent) {
        sent = true;
        try {
          parent.postMessage({
            __scarabRecommendationProbe:true,
            ok:false,
            gameCode:gameCode,
            error:'ATG 機台表已載入逾時（System registry 未取得 tables）'
          }, location.origin);
        } catch (_) {}
      }
    }
  }, 250);
  try { window.addEventListener('pagehide', finish, {once:true}); } catch (_) {}
  try { window.addEventListener('beforeunload', finish, {once:true}); } catch (_) {}
  tick();
})();
