/* ATG live adapter.
   Connects the existing ScarabHeart engine to the real Cocos TimeManager and
   observes the already-authenticated game's Socket.IO services. */
(function () {
  'use strict';
  if (window.__scarabAtgLiveAdapter) return;
  window.__scarabAtgLiveAdapter = true;

  var specialGames = /^(golden-seth|egyptian-mythology|tiger-princess)$/;
  var requested = 1;
  var applied = 1;
  var attachedEngine = null;
  var lastManager = null;
  var announced = false;
  var watched = new Map();
  var live = window.__SCARAB_LIVE = {
    connected: false,
    sockets: 0,
    lastEvent: '',
    lastEventAt: 0,
    timeScale: 1
  };

  function manager() {
    try {
      var klass = window.cc && window.cc.js &&
        typeof window.cc.js.getClassByName === 'function' &&
        window.cc.js.getClassByName('TimeManager');
      return klass && klass.instance || null;
    } catch (_) {
      return null;
    }
  }

  function sendStatus(state, message) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          __scarabStatus: true,
          state: state,
          message: message || ''
        }, location.origin);
      }
    } catch (_) {}
  }

  function requestedToActual(value) {
    // The UI's MAX sentinel is 999. Passing 999 directly into Cocos can freeze
    // the renderer, so MAX is implemented as a persistent 32x time scale.
    return value === 999 ? 32 : value;
  }

  function validSpeed(value) {
    if ([1, 2, 4, 8].indexOf(value) >= 0) return true;
    var game = String(window.__SC_GAME_CODE || '');
    return specialGames.test(game) && (value === 16 || value === 999);
  }

  function applyTimeScale(value) {
    var time = manager();
    var numeric = Number(value);
    if (!time || typeof time.setTimeScale !== 'function' || !validSpeed(numeric)) {
      return false;
    }
    var actual = requestedToActual(numeric);
    if (!Number.isFinite(actual) || actual < 1 || actual > 32) return false;
    try {
      time.setTimeScale(actual);
      if (Number(time._timeScale) !== actual) return false;

      // Some ATG builds expose a TimeManager whose _timeScale changes but is
      // not wired into Cocos' scheduler. Mirror the value into the scheduler
      // when the manager did not already do so. This makes the multiplier
      // affect scheduled game updates and actions, rather than only the HUD.
      var scheduler = null;
      try {
        var director = window.cc && window.cc.director;
        scheduler = director && typeof director.getScheduler === 'function'
          ? director.getScheduler()
          : director && director._scheduler;
      } catch (_) {}
      if (scheduler && typeof scheduler.setTimeScale === 'function') {
        var schedulerScale = NaN;
        try {
          schedulerScale = typeof scheduler.getTimeScale === 'function'
            ? Number(scheduler.getTimeScale())
            : Number(scheduler._timeScale);
        } catch (_) {}
        if (schedulerScale !== actual) {
          scheduler.setTimeScale(actual);
          var verifiedScale = NaN;
          try {
            verifiedScale = typeof scheduler.getTimeScale === 'function'
              ? Number(scheduler.getTimeScale())
              : Number(scheduler._timeScale);
          } catch (_) {}
          if (Number.isFinite(verifiedScale) && verifiedScale !== actual) return false;
        }
      }
      requested = numeric;
      applied = actual;
      lastManager = time;
      live.timeScale = actual;
      live.schedulerScale = scheduler && Number(scheduler._timeScale);
      return true;
    } catch (_) {
      return false;
    }
  }

  function attachEngine() {
    var engine = window.__sethEngine;
    var time = manager();
    if (!engine || !time) return false;
    if (engine !== attachedEngine || !engine.__scarabTimeManagerPatched) {
      var original = typeof engine.setSpeed === 'function'
        ? engine.setSpeed.bind(engine)
        : null;
      try {
        Object.defineProperty(engine, '__scarabOriginalSetSpeed', {
          value: original,
          configurable: true
        });
      } catch (_) {
        engine.__scarabOriginalSetSpeed = original;
      }
      engine.setSpeed = function (value) {
        var numeric = Number(value);
        if (!validSpeed(numeric)) return false;
        // Keep the engine's own speed bookkeeping first; some game builds
        // reset their time manager from the original method.
        try { if (original) original(numeric); } catch (_) {}
        if (!applyTimeScale(numeric)) return false;
        // Overlay verifies this requested value. MAX stays 999 here while the
        // real Cocos scale is the safe 32x value above.
        engine.speed = numeric;
        return true;
      };
      engine.getTimeScale = function () {
        var current = manager();
        return current && Number(current._timeScale);
      };
      engine.live = live;
      engine.__scarabTimeManagerPatched = true;
      attachedEngine = engine;
    }
    if (!announced) {
      announced = true;
      sendStatus('engine-ready');
    }
    return true;
  }

  function rememberEvent(name) {
    live.lastEvent = name;
    live.lastEventAt = Date.now();
  }

  var wsAttached = typeof WeakSet === 'function' ? new WeakSet() : null;
  function publishSpoilerPacket(packet) {
    try {
      if (!packet || typeof packet !== 'object' || Array.isArray(packet) ||
          (packet.status != null && packet.status !== 200) || packet.eventName !== 'spin') return;
      var engine = packet.engine, games = engine && engine.gameState;
      var panel = window.__sethEngine && window.__sethEngine.panel;
      if (!panel || !panel.spoilerOn || !Array.isArray(games) || !games.length ||
          games.some(function (g) { return !g || typeof g !== 'object'; })) return;
      var isFree = engine.buyFeatureType === 'freeGame' ||
        games.some(function (g) { return +g.freeGameCount > 0 || g.startFreeGame === true; });
      if (!isFree) return;
      var lastWin = games[games.length - 1].totalWinnings;
      if ((typeof lastWin !== 'number' && typeof lastWin !== 'string') ||
          String(lastWin).trim() === '' || !Number.isFinite(+lastWin) || +lastWin < 0) return;
      var freeCount = Math.max.apply(null, games.map(function (g) { return +g.freeGameCount || 0; }));
      panel.spoilerWin = {
        totalWin: Math.round(+lastWin * 100) / 100,
        fg: freeCount,
        ts: Date.now()
      };
      rememberEvent('spin');
    } catch (_) {}
  }
  function parseCompressedFrame(bytes) {
    try {
      if (!bytes || bytes.length < 4 || typeof DecompressionStream !== 'function' ||
          typeof Blob !== 'function' || typeof Response !== 'function') return;
      var start = -1;
      for (var i = 0; i < Math.min(8, bytes.length - 1); i++) {
        if (bytes[i] === 0x78 && (bytes[i + 1] === 0x9c || bytes[i + 1] === 0x01 || bytes[i + 1] === 0xda)) { start = i; break; }
      }
      if (start < 0) return;
      var compressed = bytes.subarray(start);
      new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')))
        .text().then(function (text) {
          try { publishSpoilerPacket(JSON.parse(text)); } catch (_) {}
        }).catch(function () {});
    } catch (_) {}
  }
  function attachWebSocket(ws) {
    if (!ws || !ws.addEventListener || (wsAttached && wsAttached.has(ws))) return;
    if (wsAttached) wsAttached.add(ws);
    try {
      ws.addEventListener('message', function (event) {
        try {
          var data = event && event.data;
          if (data instanceof ArrayBuffer) parseCompressedFrame(new Uint8Array(data));
          else if (ArrayBuffer.isView(data)) parseCompressedFrame(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          else if (data && typeof data.arrayBuffer === 'function') data.arrayBuffer().then(function (buffer) { parseCompressedFrame(new Uint8Array(buffer)); }).catch(function () {});
        } catch (_) {}
      });
    } catch (_) {}
  }
  function parseCompressedText(text) {
    try {
      if (typeof text !== 'string' || text.length < 4 || typeof DecompressionStream !== 'function' ||
          typeof Blob !== 'function' || typeof Response !== 'function') return;
      var bytes = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
      parseCompressedFrame(bytes);
    } catch (_) {}
  }
  function installCryptoToolPeek() {
    try {
      var sys = window.System;
      var mod = sys && typeof sys.get === 'function' && sys.get('chunks:///_virtual/CryptoTool.ts');
      var tool = mod && (mod.CryptoTool || (mod.default && mod.default.CryptoTool));
      if (tool && tool.variant === 'custom' && typeof tool.decrypt === 'function') {
        if (tool.decrypt.__scarabDecodedObserver) return true;
        var original = tool.decrypt;
        var wrapped = function () {
          var result = original.apply(this, arguments);
          try {
            if (result && typeof result.then === 'function') result.then(publishSpoilerPacket, function () {});
            else publishSpoilerPacket(result);
          } catch (_) {}
          return result;
        };
        wrapped.__scarabDecodedObserver = true;
        tool.decrypt = wrapped;
        return true;
      }
    } catch (_) {}
    return false;
  }
  function installForgePeek() {
    try {
      var forge = window.forge, proto = forge && forge.cipher && forge.cipher.BlockCipher && forge.cipher.BlockCipher.prototype;
      if (!proto || typeof proto.finish !== 'function') return false;
      if (proto.__scarabDecodedObserver) return true;
      Object.defineProperty(proto, '__scarabDecodedObserver', { value: true, configurable: true });
      var original = proto.finish;
      proto.finish = function () {
        var result = original.apply(this, arguments);
        try {
          var output = this.output, data = output && output.data;
          if (typeof data === 'string' && data.charCodeAt(0) === 0x78) parseCompressedText(data);
        } catch (_) {}
        return result;
      };
      return true;
    } catch (_) { return false; }
  }
  var decodeRetry = 0;
  function installDecodedPacketHooks() {
    var cryptoReady = installCryptoToolPeek();
    var forgeReady = installForgePeek();
    if ((!cryptoReady || !forgeReady) && decodeRetry++ < 120) setTimeout(installDecodedPacketHooks, 250);
  }
  installDecodedPacketHooks();

  function installWsPeek() {
    try {
      var Original = window.WebSocket, proto = Original && Original.prototype;
      if (!proto || proto.__scarabBinaryPeek) return;
      Object.defineProperty(proto, '__scarabBinaryPeek', { value: true, configurable: true });
      var originalAdd = proto.addEventListener;
      if (typeof originalAdd === 'function') {
        proto.addEventListener = function (type, listener, options) {
          if (type === 'message') attachWebSocket(this);
          return originalAdd.call(this, type, listener, options);
        };
      }
      try {
        var descriptor = Object.getOwnPropertyDescriptor(proto, 'onmessage');
        if (descriptor && descriptor.set && originalAdd) {
          Object.defineProperty(proto, 'onmessage', {
            configurable: true, enumerable: descriptor.enumerable, get: descriptor.get,
            set: function (listener) { attachWebSocket(this); return descriptor.set.call(this, listener); }
          });
        }
      } catch (_) {}
      window.WebSocket = function (url, protocols) {
        var ws = protocols === undefined ? new Original(url) : new Original(url, protocols);
        attachWebSocket(ws);
        return ws;
      };
      window.WebSocket.prototype = proto;
      try { Object.setPrototypeOf(window.WebSocket, Original); } catch (_) {}
    } catch (_) {}
  }
  installWsPeek();

  function scanSockets() {
    var services;
    try { services = window.App && window.App.serviceManager && window.App.serviceManager.services; }
    catch (_) { services = null; }
    if (!Array.isArray(services)) return;
    services.forEach(function (service) {
      var socket = service && service._client && service._client._io;
      try {
        var manager = socket && (socket.io || socket);
        var engineSocket = (manager && manager.engine) || (socket && socket.engine);
        var transport = engineSocket && engineSocket.transport;
        attachWebSocket(transport && (transport.ws || transport._ws));
      } catch (_) {}
      if (!socket || typeof socket.on !== 'function' || watched.has(socket)) return;
      var handlers = [];
      ['connect', 'disconnect', 'connect_error', 'initial', 'slotTableUpdated', 'spin', 'closeSpin'].forEach(function (event) {
        var handler = function () {
          rememberEvent(event);
          live.connected = event === 'connect' ? true :
            (event === 'disconnect' || event === 'connect_error' ? false : !!socket.connected);
        };
        try {
          socket.on(event, handler);
          handlers.push([event, handler]);
        } catch (_) {}
      });
      watched.set(socket, handlers);
    });
    live.sockets = watched.size;
    live.connected = Array.from(watched.keys()).some(function (socket) { return !!socket.connected; });
  }

  var timer = setInterval(function () {
    try {
      attachEngine();
      scanSockets();
      var time = manager();
      if (time && requested !== 1 &&
          (time !== lastManager || Number(time._timeScale) !== applied)) {
        applyTimeScale(requested);
      } else if (time) {
        live.timeScale = Number(time._timeScale) || 1;
      }
    } catch (_) {}
  }, 400);

  window.addEventListener('pagehide', function () {
    clearInterval(timer);
    watched.forEach(function (handlers, socket) {
      handlers.forEach(function (pair) {
        try { if (typeof socket.off === 'function') socket.off(pair[0], pair[1]); } catch (_) {}
      });
    });
    watched.clear();
  }, { once: true });
})();
