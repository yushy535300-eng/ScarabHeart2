/* ATG live adapter v3.08.
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
          try { collectRooms([].slice.call(arguments)); publishRooms(); } catch (_) {}
        };
        try {
          socket.on(event, handler);
          handlers.push([event, handler]);
        } catch (_) {}
      });
      try {
        if (typeof socket.onAny === 'function') {
          var anyHandler=function(){try{collectRooms([].slice.call(arguments));publishRooms()}catch(_){}};
          socket.onAny(anyHandler); handlers.push(['__any__',anyHandler]);
        }
      } catch (_) {}
      watched.set(socket, handlers);
    });
    live.sockets = watched.size;
    live.connected = Array.from(watched.keys()).some(function (socket) { return !!socket.connected; });
  }

  var realRooms = new Map();
  var lastRoomSig = '';
  var lastRoomPostAt = 0;
  function first(obj,keys){for(var i=0;i<keys.length;i++){try{var v=obj&&obj[keys[i]];if(v!=null&&v!=='')return v}catch(_){}}return null}
  function digits(v){if(v==null)return'';var s=String(v).trim().replace(/^#/,'');var m=s.match(/^0*(\d{1,5})$/);return m?String(Number(m[1])):''}
  function normRoom(t){
    if(!t||typeof t!=='object')return null;var base=t.table&&typeof t.table==='object'?Object.assign({},t,t.table):t;
    var machine=first(base,['machineNum','machineNo','machineNumber','machine_num','machine_no','number','num','tableNo','tableNumber','table_num','seatNo','seatNumber','no']);
    if(machine==null)try{machine=base.machine&&(base.machine.number??base.machine.no)}catch(_){ }
    machine=digits(machine);if(!machine)return null;
    var room=first(base,['roomId','roomID','room_id','tableId','tableID','table_id','rid']);
    if(room==null)try{room=base.room&&(base.room.id??base.room.roomId)}catch(_){ }
    if(room==null&&first(base,['machineNum','machineNo','machineNumber','machine_num','number','num'])!=null)room=base.id;
    var status=String(first(base,['status','state','roomStatus','tableStatus'])||'');
    var locked=!!first(base,['isLocked','locked','is_lock','disabled'])||/locked|disable|maintenance|closed/i.test(status);
    var today=base.today&&typeof base.today==='object'?base.today:{};
    var todayBet=Number(first(today,['bet','amount','stake'])??first(base,['todayBet','betToday'])??0)||0;
    var todayWin=Number(first(today,['win','payout','award'])??first(base,['todayWin','winToday'])??0)||0;
    var bet=Number(first(base,['bet','stake','amount','totalBet'])??0)||0;
    var win=Number(first(base,['win','payout','award','totalWin'])??0)||0;
    return {roomId:room==null?'':String(room),machineNum:machine,status:status,isLocked:locked,todayBet:todayBet,todayWin:todayWin,bet:bet,win:win};
  }
  function collectRooms(root){
    var seen=typeof WeakSet!=='undefined'?new WeakSet():null,nodes=0;
    function walk(v,d){if(!v||d>8||nodes>22000||typeof v!=='object')return;nodes++;if(seen)try{if(seen.has(v))return;seen.add(v)}catch(_){ }
      var r=normRoom(v);if(r){var old=realRooms.get(r.machineNum)||{};realRooms.set(r.machineNum,Object.assign({},old,r,{roomId:r.roomId||old.roomId||''}))}
      if(Array.isArray(v)){for(var i=0;i<v.length&&i<1500;i++)walk(v[i],d+1);return}
      var ks;try{ks=Object.keys(v)}catch(_){return}for(var j=0;j<ks.length&&j<180;j++){var k=ks[j];if(/^(parent|_parent|node|_node|children|_children)$/i.test(k))continue;try{walk(v[k],d+1)}catch(_){}}
    }walk(root,0);
  }
  function hash(s){var h=2166136261>>>0;s=String(s||'');for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0}return h>>>0}
  function indicatorRtp(rank,machine){var seed=hash(String(window.__SC_GAME_CODE||'')+':'+machine+':live');var r;if(rank===0)r=94.60+(seed%210)/100;else if(rank===1)r=91.20+(seed%260)/100;else if(rank===2)r=84.50+(seed%360)/100;else{var f=[78.8,72.6,66.4,59.8,53.2,46.8,40.5],sp=[4.2,4.4,4.6,4.8,5,5.2,4.8],x=Math.min(rank-3,6);r=f[x]+(seed%Math.round(sp[x]*100))/100}return Math.min(96.69,Math.round(r*100)/100)}
  function liveRoomRows(){return Array.from(realRooms.values()).filter(function(r){return /^\d+$/.test(r.machineNum)&&!r.isLocked})}
  function refreshGoodRooms(){
    var e=window.__sethEngine;if(!e)return;var game=String(window.__SC_GAME_CODE||''),six=/^(tiger-princess|hades|wuxia-caishen|son-go-ku|new-vampire-hunter|new-jinlian)$/.test(game),rows=liveRoomRows();
    if(!rows.length)return;
    var byMachine=new Map(rows.map(function(r){return [String(r.machineNum),r]}));
    var base=Array.isArray(window.__SC_GOOD_ROOMS)?window.__SC_GOOD_ROOMS.slice():[];
    var out=[],used=new Set();
    base.forEach(function(c){var m=String(c&&c.machineNum||'');var liveRow=byMachine.get(m);if(!liveRow||used.has(m))return;used.add(m);out.push(Object.assign({},c,liveRow,{roomId:liveRow.roomId||String(c.roomId||'')}))});
    rows.slice().sort(function(a,b){return (hash(game+':'+b.machineNum)%100000)-(hash(game+':'+a.machineNum)%100000)}).forEach(function(r){if(used.has(r.machineNum))return;used.add(r.machineNum);out.push(Object.assign({},r))});
    out=out.slice(0,10).map(function(r,i){if(six){r.rtp=indicatorRtp(i,r.machineNum);r.score=[895,874,856,822,803,785,766,748,731,715][i]||715;r.metric='RTP 指標'}return r});
    window.__SC_GOOD_ROOMS=out;e.__goodRooms=out;
  }
  function publishRooms(){
    var list=liveRoomRows();if(!list.length)return;var sig=list.map(function(r){return r.machineNum+':'+r.roomId+':'+r.status}).sort().join('|');
    window.__SCARAB_REAL_TABLES=list;refreshGoodRooms();
    if(sig===lastRoomSig&&Date.now()-lastRoomPostAt<2500)return;lastRoomSig=sig;lastRoomPostAt=Date.now();
    try{if(window.parent&&window.parent!==window)window.parent.postMessage({__scarabLiveTables:true,gameCode:String(window.__SC_GAME_CODE||''),roomSessionId:String(window.__SCARAB_ROOM_SESSION_ID||''),tables:list},location.origin)}catch(_){ }
  }
  function scanRealRooms(){
    try{
      var tap=window.__SCARAB_ATG_ROOM_TAP;
      if(tap){
        try{if(typeof tap.scan==='function')tap.scan()}catch(_){ }
        try{if(typeof tap.getTables==='function')collectRooms(tap.getTables())}catch(_){ }
      }
      var e=window.__sethEngine;if(e){collectRooms(e.tables);collectRooms(e.__goodRooms)}
      var app=window.App,services=app&&app.serviceManager&&app.serviceManager.services;
      if(app)collectRooms(app);if(Array.isArray(services))services.forEach(function(s){collectRooms(s)});
      publishRooms();
    }catch(_){ }
  }
  window.addEventListener('scarab:atg-tables',function(ev){try{collectRooms(ev&&ev.detail&&ev.detail.tables);publishRooms()}catch(_){ }});

  var timer = setInterval(function () {
    try {
      attachEngine();
      scanSockets();
      scanRealRooms();
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
        try { if (pair[0]==='__any__' && typeof socket.offAny==='function') socket.offAny(pair[1]); else if (typeof socket.off === 'function') socket.off(pair[0], pair[1]); } catch (_) {}
      });
    });
    watched.clear();
  }, { once: true });
})();
