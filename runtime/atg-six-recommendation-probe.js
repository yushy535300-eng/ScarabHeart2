/* Passive ATG machine-table probe for the six recommendation-only titles.
   Runs only inside the hidden recommendation iframe. It waits for ATG/Cocos to
   finish its own authenticated initialization, then reads SlotFrameworkData.
   It intentionally does NOT monkey-patch WebSocket, SystemJS, Map, WeakMap, or
   the normal game runtime. */
(function () {
  'use strict';
  if (window.__scarabSixRecommendationProbeInstalled) return;
  window.__scarabSixRecommendationProbeInstalled = true;

  var gameCode = String(window.__SC_GAME_CODE || '');
  var startedAt = Date.now();
  var sent = false;
  var busy = false;
  var importedModel = null;

  function num(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeTable(t) {
    if (!t || typeof t !== 'object') return null;
    var roomId = t.roomId != null ? t.roomId : (t.room_id != null ? t.room_id : t.tableId);
    var number = t.number != null ? t.number : (t.machineNum != null ? t.machineNum : t.machineNo);
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
      todayWin: num(today.win != null ? today.win : t.todayWin),
      todayBet: num(today.bet != null ? today.bet : t.todayBet),
      win: num(t.win),
      bet: num(t.bet),
      rawFree: t.freeGameCount != null ? num(t.freeGameCount) :
        (t.freeSpinCount != null ? num(t.freeSpinCount) : (t.fg != null ? num(t.fg) : null))
    };
  }

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var row = normalizeTable(list[i]);
      if (!row || seen[row.machineNum]) continue;
      seen[row.machineNum] = true;
      out.push(row);
    }
    return out;
  }

  function publish(list, source, meta) {
    if (sent) return false;
    var rows = normalizeList(list);
    if (!rows.length) return false;
    sent = true;
    try {
      parent.postMessage({
        __scarabRecommendationProbe: true,
        ok: true,
        gameCode: gameCode,
        source: source || 'slot-framework-data',
        capturedAt: Date.now(),
        tableMeta: meta || null,
        tables: rows
      }, location.origin);
    } catch (_) {}
    return true;
  }

  function extractFromData(data, source) {
    if (!data || typeof data !== 'object') return false;
    var candidates = [
      data.tables,
      data.slotTables,
      data.tableList,
      data.data && data.data.tables,
      data.tables && data.tables.tables
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i]) && publish(candidates[i], source, data.tableMeta || null)) return true;
    }
    return false;
  }

  function getDataFromModel(Model) {
    if (!Model) return null;
    var instance = null;
    try {
      if (typeof Model.getData === 'function') {
        var direct = Model.getData();
        if (direct) return direct;
      }
    } catch (_) {}
    try {
      if (typeof Model.Instance === 'function') instance = Model.Instance();
      else if (typeof Model.getInstance === 'function') instance = Model.getInstance();
      else if (Model.instance) instance = Model.instance;
    } catch (_) {}
    try {
      if (!instance && window.App && App.dataCenter && typeof App.dataCenter.get === 'function') {
        instance = App.dataCenter.get(Model);
      }
    } catch (_) {}
    if (!instance) return null;
    try { if (typeof instance.getData === 'function') return instance.getData(); } catch (_) {}
    try { if (instance.data && typeof instance.data === 'object') return instance.data; } catch (_) {}
    try { if (instance._data && typeof instance._data === 'object') return instance._data; } catch (_) {}
    return null;
  }

  async function importSlotFrameworkData() {
    if (importedModel) return importedModel;
    var sys = window.System;
    if (!sys || typeof sys.import !== 'function') return null;
    var ids = [
      'chunks:///_virtual/SlotFrameworkData.ts',
      'chunks:///_virtual/SlotTableModel.ts'
    ];
    for (var i = 0; i < ids.length; i++) {
      try {
        var mod = await sys.import(ids[i]);
        var Model = mod && (mod.default || mod.SlotFrameworkData || mod.SlotTableModel);
        if (Model) {
          importedModel = Model;
          return importedModel;
        }
      } catch (_) {}
    }
    return null;
  }

  // Shallow, targeted fallback only. Unlike the old probe this never hooks
  // networking and never walks the entire Cocos object graph.
  function shallowFallback() {
    var roots = [];
    try { if (window.App && App.dataCenter) roots.push(App.dataCenter); } catch (_) {}
    try { if (window.App && App.gameView) roots.push(App.gameView); } catch (_) {}
    try {
      if (window.cc && cc.director && typeof cc.director.getScene === 'function') {
        var scene = cc.director.getScene();
        if (scene) roots.push(scene);
      }
    } catch (_) {}
    var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var nodes = 0;
    function walk(value, depth) {
      if (sent || !value || typeof value !== 'object' || depth > 5 || nodes > 5000) return;
      nodes++;
      if (seen) {
        try { if (seen.has(value)) return; seen.add(value); } catch (_) {}
      }
      if (Array.isArray(value)) {
        var normalized = normalizeList(value);
        if (normalized.length >= 10) { publish(value, 'atg-decoded-state', null); return; }
        for (var i = 0; i < value.length && i < 80; i++) walk(value[i], depth + 1);
        return;
      }
      var priority = ['data','_data','tables','slotTables','tableList','model','_model','models','_models'];
      for (var p = 0; p < priority.length; p++) {
        try { if (value[priority[p]]) walk(value[priority[p]], depth + 1); } catch (_) {}
      }
      var keys;
      try { keys = Object.keys(value); } catch (_) { return; }
      for (var k = 0; k < keys.length && k < 50; k++) {
        var key = keys[k];
        if (/^(parent|_parent|node|_node|children|_children)$/i.test(key)) continue;
        try { walk(value[key], depth + 1); } catch (_) {}
        if (sent) return;
      }
    }
    for (var r = 0; r < roots.length && !sent; r++) walk(roots[r], 0);
  }

  async function tick() {
    if (sent || busy) return;
    busy = true;
    try {
      var Model = await importSlotFrameworkData();
      var data = getDataFromModel(Model);
      if (extractFromData(data, 'slot-framework-data')) return;
      shallowFallback();
    } catch (_) {
      shallowFallback();
    } finally {
      busy = false;
    }
  }

  var timer = setInterval(function () {
    if (sent) { clearInterval(timer); return; }
    tick();
    if (Date.now() - startedAt > 25000) {
      clearInterval(timer);
      if (!sent) {
        try {
          parent.postMessage({
            __scarabRecommendationProbe: true,
            ok: false,
            gameCode: gameCode,
            error: 'ATG 機台表尚未完成載入'
          }, location.origin);
        } catch (_) {}
      }
    }
  }, 180);
  tick();
})();
