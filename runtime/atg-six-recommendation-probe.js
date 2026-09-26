/* v3.10 passive six-game ATG recommendation probe.
   IMPORTANT: this file runs only in the hidden recommendation iframe.
   It never patches WebSocket, System.register, Map, WeakMap, or normal game code.
   ATG's own `initial` response populates PlatformModel.platform.tables; we read
   that already-decoded state and return one bounded snapshot to the parent. */
(function () {
  'use strict';
  if (window.__scarabSixRecommendationProbeInstalled) return;
  window.__scarabSixRecommendationProbeInstalled = true;

  var gameCode = String(window.__SC_GAME_CODE || '');
  var startedAt = Date.now();
  var sent = false;
  var busy = false;
  var timer = null;
  var importedPlatform = null;
  var importedFallback = null;

  function numberValue(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeTable(t) {
    if (!t || typeof t !== 'object') return null;
    var roomId = t.roomId != null ? t.roomId : (t.room_id != null ? t.room_id : (t.tableId != null ? t.tableId : t.id));
    var number = t.number != null ? t.number : (t.machineNum != null ? t.machineNum : (t.machineNo != null ? t.machineNo : t.roomNumber));
    if (roomId == null || number == null) return null;
    var machineNum = String(number);
    if (!/^\d+$/.test(machineNum)) return null;
    var today = t.today && typeof t.today === 'object' ? t.today : {};
    var status = String(t.status || t.tableStatus || '');
    return {
      roomId: String(roomId),
      machineNum: machineNum,
      status: status,
      isLocked: !!t.isLocked || /locked/i.test(status),
      todayWin: numberValue(today.win != null ? today.win : t.todayWin),
      todayBet: numberValue(today.bet != null ? today.bet : t.todayBet),
      win: numberValue(t.win),
      bet: numberValue(t.bet),
      rawFree: t.freeGameCount != null ? numberValue(t.freeGameCount) :
        (t.freeSpinCount != null ? numberValue(t.freeSpinCount) : (t.fg != null ? numberValue(t.fg) : null))
    };
  }

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    var seen = Object.create(null);
    var limit = Math.min(list.length, 3500);
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
    importedPlatform = null;
    importedFallback = null;
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
        source: source || 'atg-platform-model',
        capturedAt: Date.now(),
        tableMeta: meta || null,
        tables: rows
      }, location.origin);
    } catch (_) {}
    return true;
  }

  function envelopeFromObject(value) {
    if (!value || typeof value !== 'object') return null;
    var direct = [
      { list:value.tables, meta:value.tableMeta },
      { list:value.slotTables, meta:value.tableMeta },
      { list:value.tableList, meta:value.tableMeta },
      { list:value.platform && value.platform.tables, meta:value.platform && value.platform.tableMeta },
      { list:value.data && value.data.tables, meta:value.data && value.data.tableMeta },
      { list:value.data && value.data.platform && value.data.platform.tables, meta:value.data && value.data.platform && value.data.platform.tableMeta },
      { list:value._data && value._data.tables, meta:value._data && value._data.tableMeta },
      { list:value._data && value._data.platform && value._data.platform.tables, meta:value._data && value._data.platform && value._data.platform.tableMeta }
    ];
    for (var i=0;i<direct.length;i++) {
      if (Array.isArray(direct[i].list) && normalizeList(direct[i].list).length) return direct[i];
    }
    return null;
  }

  function walkForTables(root, maxDepth) {
    var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var nodes = 0;
    var found = null;
    function walk(value, depth) {
      if (found || !value || typeof value !== 'object' || depth > maxDepth || nodes > 2500) return;
      nodes++;
      if (seen) { try { if (seen.has(value)) return; seen.add(value); } catch (_) {} }
      var env = envelopeFromObject(value);
      if (env) { found = env; return; }
      if (typeof Map !== 'undefined' && value instanceof Map) {
        var c = 0;
        value.forEach(function(v){ if (!found && c++ < 120) walk(v, depth+1); });
        return;
      }
      if (typeof Set !== 'undefined' && value instanceof Set) {
        var c2 = 0;
        value.forEach(function(v){ if (!found && c2++ < 120) walk(v, depth+1); });
        return;
      }
      if (Array.isArray(value)) {
        for (var i=0;i<Math.min(value.length,80)&&!found;i++) walk(value[i],depth+1);
        return;
      }
      var priority = ['platform','data','_data','model','_model','models','_models','value','_value','state','_state'];
      for (var p=0;p<priority.length && !found;p++) {
        try { if (value[priority[p]]) walk(value[priority[p]], depth+1); } catch (_) {}
      }
      var keys;
      try { keys = Object.keys(value); } catch (_) { return; }
      for (var k=0;k<Math.min(keys.length,45)&&!found;k++) {
        var key = keys[k];
        if (/^(parent|_parent|node|_node|children|_children|scene|_scene)$/i.test(key)) continue;
        try { walk(value[key], depth+1); } catch (_) {}
      }
    }
    walk(root,0);
    return found;
  }

  function dataCenterRoots(model, moduleObject) {
    var roots = [];
    if (moduleObject) roots.push(moduleObject);
    if (model) roots.push(model);
    try {
      if (model && typeof model.getData === 'function') roots.push(model.getData());
    } catch (_) {}
    try {
      if (model && typeof model.Instance === 'function') roots.push(model.Instance());
      else if (model && typeof model.getInstance === 'function') roots.push(model.getInstance());
      else if (model && model.instance) roots.push(model.instance);
    } catch (_) {}
    try {
      var dc = window.App && App.dataCenter;
      if (dc) {
        roots.push(dc);
        var methods = ['get','getModel','getData','model','find'];
        for (var i=0;i<methods.length;i++) {
          var fn = dc[methods[i]];
          if (typeof fn !== 'function') continue;
          try { if (model) roots.push(fn.call(dc, model)); } catch (_) {}
          try { roots.push(fn.call(dc, 'PlatformModel')); } catch (_) {}
          try { roots.push(fn.call(dc, 'platform')); } catch (_) {}
        }
      }
    } catch (_) {}
    return roots.filter(Boolean);
  }

  async function systemImport(ids) {
    var sys = window.System;
    if (!sys || typeof sys.import !== 'function') return null;
    for (var i=0;i<ids.length;i++) {
      try { var mod = await sys.import(ids[i]); if (mod) return mod; } catch (_) {}
    }
    return null;
  }

  async function platformModule() {
    if (importedPlatform) return importedPlatform;
    importedPlatform = await systemImport([
      'chunks:///_virtual/PlatformModel.ts',
      './PlatformModel.ts',
      'PlatformModel.ts'
    ]);
    return importedPlatform;
  }

  async function fallbackModule() {
    if (importedFallback) return importedFallback;
    importedFallback = await systemImport([
      'chunks:///_virtual/SlotTableModel.ts',
      'chunks:///_virtual/SlotFrameworkData.ts',
      './SlotTableModel.ts',
      './SlotFrameworkData.ts'
    ]);
    return importedFallback;
  }

  function exportedModels(mod, preferredNames) {
    var out = [];
    if (!mod || typeof mod !== 'object') return out;
    try { if (mod.default) out.push(mod.default); } catch (_) {}
    for (var i=0;i<preferredNames.length;i++) {
      try { if (mod[preferredNames[i]]) out.push(mod[preferredNames[i]]); } catch (_) {}
    }
    try {
      Object.keys(mod).slice(0,30).forEach(function(k){ if (mod[k] && out.indexOf(mod[k]) < 0) out.push(mod[k]); });
    } catch (_) {}
    return out;
  }

  async function tick() {
    if (sent || busy) return;
    busy = true;
    try {
      // Primary source confirmed from HAR: initial -> PlatformModel.platform.tables.
      var pmod = await platformModule();
      var pmodels = exportedModels(pmod, ['PlatformModel']);
      for (var i=0;i<pmodels.length && !sent;i++) {
        var roots = dataCenterRoots(pmodels[i], pmod);
        for (var r=0;r<roots.length && !sent;r++) {
          var env = walkForTables(roots[r], 5);
          if (env && publish(env.list, 'atg-platform-model', env.meta)) return;
        }
      }
      // Some builds expose PlatformModel only through App.dataCenter's internal Map.
      try {
        var dc = window.App && App.dataCenter;
        if (dc) {
          var env2 = walkForTables(dc, 6);
          if (env2 && publish(env2.list, 'atg-platform-datacenter', env2.meta)) return;
        }
      } catch (_) {}

      // Late fallback only after ATG has had time to populate SlotTableModel.
      if (Date.now() - startedAt > 7000) {
        var fmod = await fallbackModule();
        var fmodels = exportedModels(fmod, ['SlotTableModel','SlotFrameworkData']);
        for (var j=0;j<fmodels.length && !sent;j++) {
          var froots = dataCenterRoots(fmodels[j], fmod);
          for (var fr=0;fr<froots.length && !sent;fr++) {
            var env3 = walkForTables(froots[fr], 5);
            if (env3 && publish(env3.list, 'atg-slot-table-fallback', env3.meta)) return;
          }
        }
      }
    } catch (_) {
    } finally {
      busy = false;
    }
  }

  timer = setInterval(function () {
    if (sent) return finish();
    tick();
    if (Date.now() - startedAt > 26000) {
      finish();
      if (!sent) {
        sent = true;
        try { parent.postMessage({__scarabRecommendationProbe:true,ok:false,gameCode:gameCode,error:'ATG PlatformModel 機台表尚未完成載入'},location.origin); } catch (_) {}
      }
    }
  }, 220);
  try { window.addEventListener('pagehide', finish, {once:true}); } catch (_) {}
  try { window.addEventListener('beforeunload', finish, {once:true}); } catch (_) {}
  tick();
})();
