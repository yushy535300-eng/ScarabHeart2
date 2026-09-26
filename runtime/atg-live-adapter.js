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
      requested = numeric;
      applied = actual;
      lastManager = time;
      live.timeScale = actual;
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
        if (!applyTimeScale(numeric)) return false;
        try { if (original) original(numeric); } catch (_) {}
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
      engine.getLiveRoomTables = function(){ try { return Array.isArray(engine.tables) ? engine.tables.slice() : []; } catch (_) { return []; } };
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

  function scanSockets() {
    var services;
    try { services = window.App && window.App.serviceManager && window.App.serviceManager.services; }
    catch (_) { services = null; }
    if (!Array.isArray(services)) return;
    services.forEach(function (service) {
      var socket = service && service._client && service._client._io;
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
