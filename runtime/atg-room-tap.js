/* ScarabHeart ATG room tap v3.08
   Installed before ATG's own game scripts. It observes the already-authenticated
   ATG slot framework and exposes the framework-decoded room table without
   replacing ATG's socket/session logic. */
(function () {
  'use strict';
  if (window.__SCARAB_ATG_ROOM_TAP && window.__SCARAB_ATG_ROOM_TAP.version === '3.08') return;

  var gameCode = String(window.__SC_GAME_CODE || '');
  var rowsByMachine = new Map();
  var statusByRoom = new Map();
  var candidates = new Set();
  var capturedModules = [];
  var tableMeta = null;
  var lastPublishSig = '';
  var lastPublishAt = 0;
  var latestToken = '';
  var lastRequestedPage = 0;
  var maxPagesSeen = 1;
  var websocketHooks = new WeakSet();
  var socketHooks = new WeakSet();
  var systemPatched = false;
  var systemSlotInstalled = false;
  var scanCount = 0;

  function num(v) { var x = Number(v); return Number.isFinite(x) ? x : 0; }
  function first(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      try { var v = obj && obj[keys[i]]; if (v != null && v !== '') return v; } catch (_) {}
    }
    return null;
  }
  function digits(v) {
    if (v == null) return '';
    var s = String(v).trim().replace(/^#/, '');
    var m = s.match(/^0*(\d{1,6})$/);
    return m ? String(Number(m[1])) : '';
  }
  function roomIdOf(base) {
    var room = first(base, ['roomId','roomID','room_id','tableId','tableID','table_id','rid']);
    if (room == null) {
      try { room = base.room && (base.room.id != null ? base.room.id : base.room.roomId); } catch (_) {}
    }
    if (room == null && first(base, ['machineNum','machineNo','machineNumber','machine_num','number','num']) != null) {
      try { room = base.id; } catch (_) {}
    }
    return room == null ? '' : String(room).trim();
  }
  function normalizeTable(value) {
    if (!value || typeof value !== 'object') return null;
    var base = value.table && typeof value.table === 'object' ? Object.assign({}, value, value.table) : value;
    var machine = first(base, ['machineNum','machineNo','machineNumber','machine_num','machine_no','number','num','tableNo','tableNumber','table_num','seatNo','seatNumber','no']);
    if (machine == null) {
      try { machine = base.machine && (base.machine.number != null ? base.machine.number : base.machine.no); } catch (_) {}
    }
    machine = digits(machine);
    if (!machine) return null;
    var roomId = roomIdOf(base);
    if (!roomId || !/^\d+$/.test(roomId)) return null;
    var today = base.today && typeof base.today === 'object' ? base.today : {};
    var status = String(first(base, ['status','state','roomStatus','tableStatus']) || statusByRoom.get(roomId) || '');
    var isLocked = !!first(base, ['isLocked','locked','is_lock','disabled']) || /locked|disable|maintenance|closed/i.test(status);
    return {
      roomId: roomId,
      machineNum: machine,
      status: status,
      isLocked: isLocked,
      todayBet: num(first(today, ['bet','amount','stake']) != null ? first(today, ['bet','amount','stake']) : first(base, ['todayBet','betToday'])),
      todayWin: num(first(today, ['win','payout','award']) != null ? first(today, ['win','payout','award']) : first(base, ['todayWin','winToday'])),
      bet: num(first(base, ['bet','stake','amount','totalBet'])),
      win: num(first(base, ['win','payout','award','totalWin'])),
      user: base.user && typeof base.user === 'object' ? base.user : {},
      raw: base
    };
  }
  function addTable(value) {
    var row = normalizeTable(value);
    if (!row) return false;
    var old = rowsByMachine.get(row.machineNum) || {};
    var merged = Object.assign({}, old, row);
    if (!merged.status && statusByRoom.has(merged.roomId)) merged.status = String(statusByRoom.get(merged.roomId));
    merged.isLocked = !!merged.isLocked || /locked|disable|maintenance|closed/i.test(String(merged.status || ''));
    rowsByMachine.set(merged.machineNum, merged);
    return true;
  }
  function updateStatusMap(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    var keys;
    try { keys = Object.keys(obj); } catch (_) { return false; }
    var changed = false;
    for (var i = 0; i < keys.length; i++) {
      var key = String(keys[i]);
      var val;
      try { val = obj[keys[i]]; } catch (_) { continue; }
      if (/^\d{5,9}$/.test(key) && typeof val === 'string' && /^(?:Empty|Full|Locked|Close)$/i.test(val)) {
        statusByRoom.set(key, val);
        changed = true;
      }
    }
    if (changed) {
      rowsByMachine.forEach(function (row, machine) {
        if (statusByRoom.has(row.roomId)) {
          row.status = String(statusByRoom.get(row.roomId));
          row.isLocked = /locked|close/i.test(row.status);
          rowsByMachine.set(machine, row);
        }
      });
    }
    return changed;
  }
  function captureMeta(obj) {
    if (!obj || typeof obj !== 'object') return;
    var meta = null;
    try {
      if (obj.tableMeta && typeof obj.tableMeta === 'object') meta = obj.tableMeta;
      else if (obj.data && obj.data.tableMeta && typeof obj.data.tableMeta === 'object') meta = obj.data.tableMeta;
    } catch (_) {}
    if (!meta) return;
    var out = {
      currentPage: num(meta.currentPage),
      tablePerPage: num(meta.tablePerPage),
      totalPages: Math.max(1, num(meta.totalPages) || 1),
      totalTableCount: num(meta.totalTableCount)
    };
    if (out.totalPages > maxPagesSeen) maxPagesSeen = out.totalPages;
    tableMeta = out;
  }
  function inspect(root, budget) {
    var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var nodes = 0;
    var maxNodes = budget || 26000;
    function walk(v, depth) {
      if (!v || typeof v !== 'object' || depth > 9 || nodes > maxNodes) return;
      nodes++;
      if (seen) { try { if (seen.has(v)) return; seen.add(v); } catch (_) {} }
      addTable(v);
      updateStatusMap(v);
      captureMeta(v);
      var directTables = null;
      try {
        if (Array.isArray(v.tables)) directTables = v.tables;
        else if (v.data && Array.isArray(v.data.tables)) directTables = v.data.tables;
      } catch (_) {}
      if (directTables) {
        for (var q = 0; q < directTables.length; q++) addTable(directTables[q]);
      }
      if (Array.isArray(v)) {
        for (var i = 0; i < v.length && i < 3500; i++) walk(v[i], depth + 1);
        return;
      }
      var keys;
      try { keys = Object.keys(v); } catch (_) { return; }
      for (var j = 0; j < keys.length && j < 240; j++) {
        var k = keys[j];
        if (/^(?:parent|_parent|node|_node|children|_children|texture|spriteFrame|_renderData)$/i.test(k)) continue;
        try { walk(v[k], depth + 1); } catch (_) {}
      }
    }
    walk(root, 0);
  }
  function rememberCandidate(v) {
    if (!v || (typeof v !== 'object' && typeof v !== 'function')) return;
    try { candidates.add(v); } catch (_) {}
    try {
      var d = v.data;
      if (d && typeof d === 'object') candidates.add(d);
      if (Array.isArray(v.tables) || (d && Array.isArray(d.tables)) || v.tableMeta || (d && d.tableMeta)) inspect(v, 14000);
    } catch (_) {}
  }

  // Catch singleton models as ATG stores them. These wrappers preserve native behavior.
  try {
    var nativeMapSet = Map.prototype.set;
    if (!nativeMapSet.__scarabWrapped) {
      var mapSet = function (key, value) {
        try {
          var keyName = String(key && (key.name || key.constructor && key.constructor.name) || key || '');
          var valueName = String(value && value.constructor && value.constructor.name || '');
          var shaped = !!(value && typeof value === 'object' && (Array.isArray(value.tables) || value.tableMeta || (value.data && (Array.isArray(value.data.tables) || value.data.tableMeta)) || typeof value.getSlotTablesData === 'function' || typeof value.sendGetSlotTableData === 'function'));
          if (/Model|SlotTable|InitialModel|SocketModel/i.test(keyName+' '+valueName) || shaped) rememberCandidate(value);
        } catch (_) {}
        return nativeMapSet.call(this, key, value);
      };
      try { Object.defineProperty(mapSet, '__scarabWrapped', {value:true}); } catch (_) { mapSet.__scarabWrapped = true; }
      Map.prototype.set = mapSet;
    }
  } catch (_) {}
  try {
    var nativeWeakSet = WeakMap.prototype.set;
    if (!nativeWeakSet.__scarabWrapped) {
      var weakSet = function (key, value) {
        try {
          var name=String(value&&value.constructor&&value.constructor.name||'');
          var shaped=!!(value&&typeof value==='object'&&(Array.isArray(value.tables)||value.tableMeta||(value.data&&(Array.isArray(value.data.tables)||value.data.tableMeta))));
          if(/InitialModel|SlotTableModel|SocketModel/i.test(name)||shaped)rememberCandidate(value);
        } catch (_) {}
        return nativeWeakSet.call(this, key, value);
      };
      try { Object.defineProperty(weakSet, '__scarabWrapped', {value:true}); } catch (_) { weakSet.__scarabWrapped = true; }
      WeakMap.prototype.set = weakSet;
    }
  } catch (_) {}

  function captureModuleExport(moduleId, name, value) {
    try {
      if (!/InitialModel|SlotTableModel|SocketModel|SlotFrameworkEntry|Sender/i.test(String(moduleId || ''))) return;
      capturedModules.push({id:String(moduleId || ''), name:String(name || ''), value:value});
      rememberCandidate(value);
      inspect(value, 16000);
    } catch (_) {}
  }
  function wrapRegister(sys, original) {
    if (typeof original !== 'function' || original.__scarabWrapped) return original;
    function wrappedRegister() {
      var args = Array.prototype.slice.call(arguments);
      var moduleId = typeof args[0] === 'string' ? args[0] : '';
      var declarationIndex = typeof args[0] === 'string' ? 2 : 1;
      var declaration = args[declarationIndex];
      if (typeof declaration === 'function' && /InitialModel|SlotTableModel|SocketModel|SlotFrameworkEntry|Sender/i.test(moduleId)) {
        args[declarationIndex] = function (exportFn, context) {
          function wrappedExport(name, value) {
            try {
              if (name && typeof name === 'object' && arguments.length === 1) {
                Object.keys(name).forEach(function (key) { captureModuleExport(moduleId, key, name[key]); });
              } else captureModuleExport(moduleId, name, value);
            } catch (_) {}
            return exportFn.apply(this, arguments);
          }
          return declaration.call(this, wrappedExport, context);
        };
      }
      return original.apply(sys, args);
    }
    try { Object.defineProperty(wrappedRegister, '__scarabWrapped', {value:true}); } catch (_) { wrappedRegister.__scarabWrapped = true; }
    return wrappedRegister;
  }
  function patchSystem(sys) {
    if (!sys || (typeof sys !== 'object' && typeof sys !== 'function')) return;
    try {
      if (typeof sys.register === 'function' && !sys.register.__scarabWrapped) {
        sys.register = wrapRegister(sys, sys.register);
        systemPatched = true;
      }
    } catch (_) {}
  }
  function installSystemSlot() {
    if (systemSlotInstalled) return;
    systemSlotInstalled = true;
    try {
      if (window.System) { patchSystem(window.System); return; }
      var stored;
      Object.defineProperty(window, 'System', {
        configurable: true,
        enumerable: true,
        get: function () { return stored; },
        set: function (value) {
          stored = value;
          try {
            if (value && !Object.prototype.hasOwnProperty.call(value, 'register')) {
              var reg;
              Object.defineProperty(value, 'register', {
                configurable: true,
                enumerable: true,
                get: function () { return reg; },
                set: function (fn) { reg = wrapRegister(value, fn); systemPatched = true; }
              });
            } else patchSystem(value);
          } catch (_) { patchSystem(value); }
        }
      });
    } catch (_) {}
  }
  installSystemSlot();

  // Capture ATG's rotating token and page requests at transport level. We do not
  // forge requests here; ATG remains responsible for encryption/decryption.
  function parseOutgoingText(text) {
    if (typeof text !== 'string') return;
    if (text.indexOf('getSlotTables') < 0 && text.indexOf('getSlotTableDetail') < 0 && text.indexOf('updateSlotTable') < 0) return;
    try {
      var start = text.indexOf('[');
      if (start < 0) return;
      var arr = JSON.parse(text.slice(start));
      if (!Array.isArray(arr)) return;
      var event = String(arr[0] || '');
      var body = arr[1] || {};
      if (body.token) latestToken = String(body.token);
      if (event === 'getSlotTables' && body.page != null) lastRequestedPage = Number(body.page) || 0;
      if (event === 'updateSlotTable' && body.table) addTable(body.table);
    } catch (_) {}
  }
  function hookWebSocketInstance(ws) {
    if (!ws || websocketHooks.has(ws)) return;
    websocketHooks.add(ws);
    try {
      var nativeSend = ws.send;
      if (typeof nativeSend === 'function' && !nativeSend.__scarabWrapped) {
        ws.send = function (data) { try { parseOutgoingText(data); } catch (_) {} return nativeSend.apply(this, arguments); };
      }
    } catch (_) {}
  }
  try {
    var WS = window.WebSocket;
    if (WS && WS.prototype && typeof WS.prototype.send === 'function' && !WS.prototype.send.__scarabRoomTapWrapped) {
      var send0 = WS.prototype.send;
      var send1 = function (data) { try { parseOutgoingText(data); hookWebSocketInstance(this); } catch (_) {} return send0.apply(this, arguments); };
      try { Object.defineProperty(send1, '__scarabRoomTapWrapped', {value:true}); } catch (_) { send1.__scarabRoomTapWrapped = true; }
      WS.prototype.send = send1;
    }
  } catch (_) {}

  function onSocketEvent(name, args) {
    try {
      if (name === 'slotTableUpdated') updateStatusMap(args && args[0]);
      inspect(args, 12000);
      publish(false, 'socket:' + name);
    } catch (_) {}
  }
  function hookSocket(socket) {
    if (!socket || socketHooks.has(socket)) return;
    socketHooks.add(socket);
    try {
      if (typeof socket.on === 'function') {
        ['slotTableUpdated','slotTablesUpdated','slotTables','initial'].forEach(function (name) {
          try { socket.on(name, function () { onSocketEvent(name, Array.prototype.slice.call(arguments)); }); } catch (_) {}
        });
      }
      if (typeof socket.onAny === 'function') {
        try { socket.onAny(function (name) { onSocketEvent(String(name || 'any'), Array.prototype.slice.call(arguments, 1)); }); } catch (_) {}
      }
      // Wrap emit so we can inspect tables/detail callbacks after ATG's own codec
      // has processed them. Existing callback behavior remains unchanged.
      if (typeof socket.emit === 'function' && !socket.emit.__scarabWrapped) {
        var originalEmit = socket.emit;
        var wrappedEmit = function (name) {
          var args = Array.prototype.slice.call(arguments, 1);
          try {
            if (/^getSlotTables$|^getSlotTableDetail$|^updateSlotTable$/.test(String(name || ''))) {
              var body = args[0] || {};
              if (body.token) latestToken = String(body.token);
              if (name === 'getSlotTables' && body.page != null) lastRequestedPage = Number(body.page) || 0;
              var last = args.length ? args[args.length - 1] : null;
              if (typeof last === 'function') {
                args[args.length - 1] = function () {
                  var cbArgs = Array.prototype.slice.call(arguments);
                  try { inspect(cbArgs, 18000); publish(false, 'socket-ack:' + name); } catch (_) {}
                  return last.apply(this, cbArgs);
                };
              }
            }
          } catch (_) {}
          return originalEmit.apply(this, [name].concat(args));
        };
        try { Object.defineProperty(wrappedEmit, '__scarabWrapped', {value:true}); } catch (_) { wrappedEmit.__scarabWrapped = true; }
        socket.emit = wrappedEmit;
      }
    } catch (_) {}
  }

  function scanKnownRoots() {
    scanCount++;
    try { if (window.System) patchSystem(window.System); } catch (_) {}
    try {
      candidates.forEach(function (v) { inspect(v, rowsByMachine.size ? 4500 : 10000); });
    } catch (_) {}
    try {
      var app = window.App;
      if (app) {
        var services = app.serviceManager && app.serviceManager.services;
        // Deep App traversal is a discovery fallback only. Once the native model
        // is captured, avoid rescanning the whole Cocos graph on every tick.
        if (!rowsByMachine.size || scanCount % 12 === 0) inspect(app, rowsByMachine.size ? 5000 : 16000);
        if (Array.isArray(services)) services.forEach(function (service) {
          if (!rowsByMachine.size || scanCount % 8 === 0) inspect(service, rowsByMachine.size ? 2600 : 7000);
          try {
            var socket = service && service._client && service._client._io;
            if (socket) hookSocket(socket);
          } catch (_) {}
        });
      }
    } catch (_) {}
    // Explicitly query Cocos class registry for titles whose classes are registered.
    try {
      var getClass = window.cc && window.cc.js && window.cc.js.getClassByName;
      if (typeof getClass === 'function') {
        ['InitialModel','SlotTableModel','SocketModel','SlotFrameworkEntry'].forEach(function (name) {
          try {
            var klass = getClass(name);
            if (!klass) return;
            rememberCandidate(klass);
            ['instance','Instance','_instance','shared','singleton'].forEach(function (key) {
              try { if (klass[key]) rememberCandidate(klass[key]); } catch (_) {}
            });
          } catch (_) {}
        });
      }
    } catch (_) {}
    // Capture game assistant engine tables if already present.
    try {
      if (window.__sethEngine) {
        inspect(window.__sethEngine.tables, 8000);
        inspect(window.__sethEngine.__goodRooms, 8000);
      }
    } catch (_) {}
  }

  function tableRows() {
    var list = Array.from(rowsByMachine.values()).map(function (row) {
      var out = Object.assign({}, row);
      delete out.raw;
      if (statusByRoom.has(out.roomId)) out.status = String(statusByRoom.get(out.roomId));
      out.isLocked = !!out.isLocked || /locked|close/i.test(String(out.status || ''));
      return out;
    });
    list.sort(function (a, b) { return Number(a.machineNum) - Number(b.machineNum); });
    return list;
  }
  function publish(force, source) {
    var list = tableRows();
    if (!list.length) return false;
    var sig = list.length + '|' + list.slice(0, 16).map(function (r) { return r.machineNum + ':' + r.roomId + ':' + r.status; }).join('|') + '|' + (tableMeta ? tableMeta.totalTableCount : '');
    if (!force && sig === lastPublishSig && Date.now() - lastPublishAt < 1200) return false;
    lastPublishSig = sig;
    lastPublishAt = Date.now();
    window.__SCARAB_REAL_TABLES = list;
    window.__SCARAB_ATG_TABLE_META = tableMeta;
    var payload = {
      __scarabLiveTables: true,
      gameCode: gameCode,
      roomSessionId: String(window.__SCARAB_ROOM_SESSION_ID || ''),
      source: source || 'ATG_FRAMEWORK_TABLE_MODEL',
      tableMeta: tableMeta,
      tables: list
    };
    try { if (window.parent && window.parent !== window) window.parent.postMessage(payload, location.origin); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('scarab:atg-tables', {detail:payload})); } catch (_) {}
    return true;
  }

  function walkSceneComponents(visitor) {
    try {
      var scene=window.cc&&cc.director&&typeof cc.director.getScene==='function'&&cc.director.getScene();
      if(!scene)return null;
      var stack=[scene],seen=typeof WeakSet!=='undefined'?new WeakSet():null,steps=0;
      while(stack.length&&steps++<30000){
        var node=stack.pop();if(!node)continue;if(seen)try{if(seen.has(node))continue;seen.add(node)}catch(_){ }
        var comps=[];try{comps=node._components||node.components||[]}catch(_){ }
        if(Array.isArray(comps))for(var i=0;i<comps.length;i++){try{var result=visitor(comps[i],node);if(result)return result}catch(_){ }}
        var kids=[];try{kids=node.children||node._children||[]}catch(_){ }
        if(Array.isArray(kids))for(var j=0;j<kids.length;j++)stack.push(kids[j]);
      }
    }catch(_){ }
    return null;
  }
  function findSlotTableView(){
    var hit=walkSceneComponents(function(c){if(c&&typeof c.getSlotTablesData==='function'&&typeof c.getSlotTableDetail==='function'&&typeof c.sendChangeSlotTable==='function')return c;});
    if(hit)return hit;
    try{for(const c of candidates){if(c&&typeof c.getSlotTablesData==='function'&&typeof c.getSlotTableDetail==='function'&&typeof c.sendChangeSlotTable==='function')return c}}catch(_){ }
    return null;
  }
  function mapHasRoom(map,roomId){
    if(!map||typeof map.has!=='function')return false;var n=Number(roomId);
    try{return map.has(n)||map.has(String(roomId))}catch(_){return false}
  }
  function sleep(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
  async function waitForPage(page,timeout){
    var end=Date.now()+(timeout||3500);while(Date.now()<end){scanKnownRoots();var meta=tableMeta;if(meta&&Number(meta.currentPage)===Number(page))return true;await sleep(100)}return false;
  }
  var pageCollectPromise=null;
  async function collectAllPages(){
    if(pageCollectPromise)return pageCollectPromise;
    pageCollectPromise=(async function(){
      scanKnownRoots();var view=findSlotTableView(),meta=tableMeta;if(!view||!meta||Number(meta.totalPages||1)<=1)return tableRows();
      var total=Math.min(12,Math.max(1,Number(meta.totalPages)||1)),original=Number(meta.currentPage||view.selectPage||1)||1;
      for(var page=1;page<=total;page++){
        if(page===Number(tableMeta&&tableMeta.currentPage||0)){scanKnownRoots();continue}
        try{view.selectPage=page;view.getSlotTablesData()}catch(_){continue}
        await waitForPage(page,4200);scanKnownRoots();publish(false,'ATG_NATIVE_PAGE_'+page);await sleep(80);
      }
      if(original>=1&&original<=total&&Number(tableMeta&&tableMeta.currentPage||0)!==original){try{view.selectPage=original;view.getSlotTablesData();await waitForPage(original,3000)}catch(_){ }}
      scanKnownRoots();publish(true,'ATG_NATIVE_ALL_PAGES');return tableRows();
    })().finally(function(){pageCollectPromise=null});
    return pageCollectPromise;
  }
  async function nativeViewSwitch(roomId,machineNum){
    var view=findSlotTableView();if(!view)return false;
    var rid=String(roomId||''),ridNum=Number(rid),machine=Number(machineNum||0);if(!rid||!Number.isFinite(ridNum))return false;
    try{
      // When the target lives on a different native page, request that page via
      // ATG's own SlotTableView dispatcher (same session/token/codec).
      if(!mapHasRoom(view.slotTableMap,rid)){
        var per=Number(tableMeta&&tableMeta.tablePerPage||500)||500,page=machine>0?Math.ceil(machine/per):0;
        if(page>0&&page<=Math.max(1,Number(tableMeta&&tableMeta.totalPages||page))){view.selectPage=page;view.getSlotTablesData();await waitForPage(page,4200)}
      }
      if(!mapHasRoom(view.slotTableMap,rid))return false;
      view.selectRoomId=ridNum;
      // This exactly mirrors ATG's machine item click -> detail -> change flow.
      view.getSlotTableDetail(ridNum);
      await sleep(650);
      view.selectRoomId=ridNum;
      view.sendChangeSlotTable();
      return true;
    }catch(_){return false}
  }

  // Room switching is intentionally delegated to the already-running ATG/game
  // selection code. This helper only uses ATG's native SlotTableView dispatcher,
  // existing assistant routes, or visible Cocos machine buttons. It never creates
  // a second ATG login/session.
  function nodeText(node) {
    try {
      var out = [String(node && node.name || '')];
      if (window.cc && cc.Label && node.getComponent) { var l = node.getComponent(cc.Label); if (l && l.string != null) out.push(String(l.string)); }
      if (window.cc && cc.RichText && node.getComponent) { var r = node.getComponent(cc.RichText); if (r && r.string != null) out.push(String(r.string).replace(/<[^>]+>/g,'')); }
      return out.join(' ').trim();
    } catch (_) { return String(node && node.name || ''); }
  }
  function nearestButtonNode(node) {
    try {
      for (var cur = node, i = 0; cur && i < 6; cur = cur.parent, i++) {
        if (window.cc && cc.Button && cur.getComponent && cur.getComponent(cc.Button)) return cur;
      }
    } catch (_) {}
    return node;
  }
  async function clickMachine(machineNum) {
    var e = window.__sethEngine;
    if (!e || typeof e.walk !== 'function' || typeof e.tap !== 'function' || typeof e.toClient !== 'function') return false;
    var want = String(Number(machineNum));
    var nodes = [];
    try {
      nodes = e.walk(function (node) {
        var t = nodeText(node).replace(/\s+/g,'');
        return t === want || t === ('#'+want) || t === want.padStart(3,'0') || t.indexOf('#'+want) >= 0;
      }) || [];
    } catch (_) {}
    if (!nodes.length) return false;
    try {
      var node = nearestButtonNode(nodes[0]);
      var p = e.toClient(node.worldPosition);
      await e.tap(p.x, p.y, 70);
      return true;
    } catch (_) { return false; }
  }
  async function engineSwitch(roomId, machineNum) {
    var e = window.__sethEngine;
    if (!e) return false;
    var names = ['jumpToRoom','switchRoom','selectRoom','pickRoom','gotoRoom','goToRoom','chooseRoom','locateRoom','selectMachine','pickMachine'];
    for (var i=0;i<names.length;i++) {
      var fn;
      try { fn = e[names[i]]; } catch (_) { fn = null; }
      if (typeof fn !== 'function') continue;
      try {
        var arg = /Machine/i.test(names[i]) ? String(machineNum || '') : String(roomId || '');
        if (!arg) continue;
        var out = fn.call(e, arg, {roomId:String(roomId||''), machineNum:String(machineNum||'')});
        if (out && typeof out.then === 'function') out = await out;
        if (out !== false) return true;
      } catch (_) {}
    }
    return false;
  }
  async function switchRoom(roomId, machineNum) {
    roomId = String(roomId || '');
    machineNum = digits(machineNum);
    if (!roomId && machineNum) {
      var hit = rowsByMachine.get(machineNum);
      if (hit) roomId = hit.roomId;
    }
    if (!machineNum && roomId) {
      rowsByMachine.forEach(function (row) { if (row.roomId === roomId) machineNum = row.machineNum; });
    }
    if (!roomId && !machineNum) return false;
    if (await nativeViewSwitch(roomId, machineNum)) return true;
    if (await engineSwitch(roomId, machineNum)) return true;
    if (machineNum && await clickMachine(machineNum)) return true;
    return false;
  }

  var api = {
    version: '3.08',
    get gameCode() { return gameCode; },
    get tableMeta() { return tableMeta; },
    get latestToken() { return latestToken; },
    get lastRequestedPage() { return lastRequestedPage; },
    get totalPages() { return Math.max(maxPagesSeen, tableMeta && tableMeta.totalPages || 1); },
    getTables: tableRows,
    inspect: inspect,
    publish: function () { scanKnownRoots(); return publish(true, 'manual'); },
    collectAllPages: collectAllPages,
    nativeViewSwitch: nativeViewSwitch,
    switchRoom: switchRoom,
    scan: scanKnownRoots
  };
  window.__SCARAB_ATG_ROOM_TAP = api;

  var timer = setInterval(function () {
    scanKnownRoots();
    publish(false, 'ATG_FRAMEWORK_TABLE_MODEL');
  }, 280);
  scanKnownRoots();

  window.addEventListener('pagehide', function () { clearInterval(timer); }, {once:true});
})();
