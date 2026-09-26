/* ScarabHeart ATG recommendation probe.
   Runs only inside a short-lived hidden ATG iframe on the recommendation page.
   It observes the authenticated game WebSocket, decodes ATG's deflate payload,
   extracts the real slot-table array, posts it to the parent, then the parent
   destroys the iframe. It never selects a room or spins the game. */
(function () {
  'use strict';
  if (window.__scarabRecommendationProbeInstalled) return;
  window.__scarabRecommendationProbeInstalled = true;

  var gameCode = String(window.__SC_GAME_CODE || '');
  var sent = false;
  var startedAt = Date.now();
  var NativeWebSocket = window.WebSocket;

  function num(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function firstValue(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i=0;i<keys.length;i++) {
      var k=keys[i];
      try { if (obj[k] != null && obj[k] !== '') return obj[k]; } catch (_) {}
    }
    return null;
  }

  function normalizeTable(t) {
    if (!t || typeof t !== 'object') return null;
    var candidates=[t,t.table,t.room,t.info,t.data,t.slotTable,t.slot,t.machine].filter(Boolean);
    var roomId=null, machine=null, src=t;
    for(var i=0;i<candidates.length;i++){
      var x=candidates[i];
      var r=firstValue(x,['roomId','roomID','room_id','rid','tableId','tableID','table_id']);
      var m=firstValue(x,['number','machineNum','machineNo','machineNumber','machine_num','machine_no','tableNo','tableNumber','table_no','no','num']);
      if(r!=null && m!=null){roomId=r;machine=m;src=x;break;}
    }
    if(roomId==null || machine==null) return null;
    var today = src.today && typeof src.today === 'object' ? src.today : {};
    var todayWin = num(firstValue(today,['win','todayWin']) != null ? firstValue(today,['win','todayWin']) : firstValue(src,['todayWin','winToday']));
    var todayBet = num(firstValue(today,['bet','todayBet']) != null ? firstValue(today,['bet','todayBet']) : firstValue(src,['todayBet','betToday']));
    var win = num(firstValue(src,['win','totalWin','payout']));
    var bet = num(firstValue(src,['bet','totalBet','wager']));
    var status = String(firstValue(src,['status','state','roomStatus']) || '');
    var locked = !!firstValue(src,['isLocked','locked','isFull']) || /locked|full|maintenance|disabled/i.test(status);
    return {
      roomId: String(roomId),
      machineNum: String(machine),
      status: status,
      isLocked: locked,
      todayWin: todayWin,
      todayBet: todayBet,
      win: win,
      bet: bet,
      todayRtp: todayBet > 0 ? todayWin / todayBet * 100 : null,
      rtp: bet > 0 ? win / bet * 100 : null,
      rawFree: firstValue(src,['freeGameCount','freeSpinCount','fg']) != null ? num(firstValue(src,['freeGameCount','freeSpinCount','fg'])) : null
    };
  }

  function findBestTables(root) {
    var best = null;
    var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var nodes = 0;
    function walk(value, depth) {
      if (!value || depth > 9 || nodes > 25000) return;
      if (typeof value !== 'object') return;
      nodes++;
      if (seen) {
        try { if (seen.has(value)) return; seen.add(value); } catch (_) {}
      }
      if (Array.isArray(value)) {
        var valid = 0;
        for (var i = 0; i < value.length && i < 20; i++) {
          var x = value[i];
          if (normalizeTable(x)) valid++;
        }
        if (valid >= Math.min(3, value.length) && (!best || value.length > best.length)) best = value;
        for (var j = 0; j < value.length && j < 2000; j++) walk(value[j], depth + 1);
        return;
      }
      var keys;
      try { keys = Object.keys(value); } catch (_) { return; }
      for (var k = 0; k < keys.length && k < 200; k++) {
        var key = keys[k];
        if (key === 'parent' || key === '_parent' || key === 'node' || key === '_node') continue;
        try { walk(value[key], depth + 1); } catch (_) {}
      }
    }
    walk(root, 0);
    return best;
  }

  function publish(array, source) {
    if (sent || !Array.isArray(array)) return false;
    var rows = [];
    var seen = Object.create(null);
    array.forEach(function (item) {
      var row = normalizeTable(item);
      if (!row || !/^\d+$/.test(row.machineNum)) return;
      if (seen[row.machineNum]) return;
      seen[row.machineNum] = true;
      rows.push(row);
    });
    if (rows.length < 1) return false;
    sent = true;
    try {
      parent.postMessage({
        __scarabRecommendationProbe: true,
        ok: true,
        gameCode: gameCode,
        source: source || 'atg-websocket',
        capturedAt: Date.now(),
        tables: rows
      }, location.origin);
    } catch (_) {}
    return true;
  }

  function inspectObject(value, source) {
    if (sent) return;
    try {
      var found = findBestTables(value);
      if (found) publish(found, source);
    } catch (_) {}
  }

  async function inspectBinary(data) {
    if (sent || typeof DecompressionStream === 'undefined') return;
    try {
      var buffer;
      if (data instanceof ArrayBuffer) buffer = data;
      else if (data && typeof data.arrayBuffer === 'function') buffer = await data.arrayBuffer();
      else return;
      var bytes = new Uint8Array(buffer);
      var offset = -1;
      for (var i = 0; i < Math.min(16, bytes.length - 1); i++) {
        if (bytes[i] === 0x78 && (bytes[i+1] === 0x01 || bytes[i+1] === 0x5e || bytes[i+1] === 0x9c || bytes[i+1] === 0xda)) {
          offset = i; break;
        }
      }
      if (offset < 0) return;
      var sliced = offset === 0 ? bytes : bytes.subarray(offset);
      var stream = new Blob([sliced]).stream().pipeThrough(new DecompressionStream('deflate'));
      var text = await new Response(stream).text();
      if (!/(roomId|room_id|tableId|table_id)/.test(text) || !/(number|machineNum|machineNo|machine_num|tableNo|table_no)/.test(text)) return;
      var json = JSON.parse(text);
      inspectObject(json, 'atg-websocket-deflate');
    } catch (_) {}
  }

  function observeMessage(event) {
    try {
      if (event && (event.data instanceof ArrayBuffer || (event.data && typeof event.data.arrayBuffer === 'function'))) {
        inspectBinary(event.data);
      } else if (event && typeof event.data === 'string' && event.data.indexOf('roomId') >= 0) {
        var text = event.data.replace(/^\d+/, '');
        try { inspectObject(JSON.parse(text), 'atg-websocket-text'); } catch (_) {}
      }
    } catch (_) {}
  }

  // Patch WebSocket before the game creates its socket. The original game
  // listeners continue to receive every message unchanged.
  try {
    var nativeAdd = NativeWebSocket.prototype.addEventListener;
    var nativeDesc = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, 'onmessage');
    NativeWebSocket.prototype.addEventListener = function (type, fn, opts) {
      if (type === 'message') {
        try { nativeAdd.call(this, 'message', observeMessage); } catch (_) {}
      }
      return nativeAdd.call(this, type, fn, opts);
    };
    if (nativeDesc && nativeDesc.set && nativeDesc.get) {
      Object.defineProperty(NativeWebSocket.prototype, 'onmessage', {
        configurable: true,
        enumerable: nativeDesc.enumerable,
        get: nativeDesc.get,
        set: function (fn) {
          try { nativeAdd.call(this, 'message', observeMessage); } catch (_) {}
          return nativeDesc.set.call(this, fn);
        }
      });
    }
    window.WebSocket = function (url, protocols) {
      var ws = protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
      try { nativeAdd.call(ws, 'message', observeMessage); } catch (_) {}
      return ws;
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
    ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){
      try { Object.defineProperty(window.WebSocket,k,{value:NativeWebSocket[k],configurable:true}); } catch (_) {}
    });
  } catch (_) {}

  // Fallback: the game can finish decoding before a binary observer catches it.
  // Scan service state briefly for the same roomId/number table array.
  var scanTimer = setInterval(function () {
    if (sent) { clearInterval(scanTimer); return; }
    try {
      var app = window.App;
      var services = app && app.serviceManager && app.serviceManager.services;
      // Some titles (notably the non-zlib table packet variants) are decoded
      // by the game's own service layer before the table list becomes visible.
      // Scan the decoded App/service state too, so the probe is not tied to one
      // wire compression format.
      if (app) inspectObject(app, 'atg-app-state');
      if (Array.isArray(services)) {
        inspectObject(services, 'atg-service-state');
        services.forEach(function(service){
          try {
            var socket = service && service._client && service._client._io;
            if (socket && !socket.__scarabProbeAny && typeof socket.onAny === 'function') {
              socket.__scarabProbeAny = true;
              socket.onAny(function(){ inspectObject([].slice.call(arguments), 'atg-socketio-event'); });
            }
          } catch (_) {}
        });
      }
    } catch (_) {}
    if (Date.now() - startedAt > 16000) {
      clearInterval(scanTimer);
      if (!sent) {
        try { parent.postMessage({__scarabRecommendationProbe:true,ok:false,gameCode:gameCode,error:'ATG 即時機台資料逾時'}, location.origin); } catch (_) {}
      }
    }
  }, 80);
})();
