(function(){
  try {
    var p=window.__SCARAB_WEB_PAYLOAD||{}, c=p.cfg||{};
    var sid=String(c.ROOM_SESSION_ID||'');
    var previousSid='';
    try { previousSid=String(sessionStorage.getItem('SCARAB_ROOM_SESSION')||''); } catch (_) {}

    // IMPORTANT:
    // A new launch from the ScarabHeart room page gets a new ROOM_SESSION_ID.
    // Only that event may clear the previous seated/switched state.
    //
    // ATG itself can reload the game document after a successful room selection.
    // That reload keeps the same ROOM_SESSION_ID, so seth_seated/seth_switched
    // MUST survive or the auto-room engine will search for the room a second time.
    var freshLaunch = !!sid && previousSid !== sid;

    window.__SCARAB_ROOM_SESSION_ID=sid;
    window.__SCARAB_FORCE_MANUAL_ROOM=false;
    window.__SCARAB_LAST_ROOM=null;
    window.__SCARAB_LAST_MACHINE=null;

    try {
      if (freshLaunch) {
        sessionStorage.removeItem('seth_seated');
        sessionStorage.removeItem('seth_switched');
        sessionStorage.removeItem('SCARAB_ROOM_DONE');
        sessionStorage.removeItem('SCARAB_LAST_ROOM');
        sessionStorage.removeItem('SCARAB_LAST_MACHINE');
        sessionStorage.removeItem('SCARAB_FORCE_MANUAL_ROOM');
        sessionStorage.removeItem('scarab_force_manual_room');
        sessionStorage.removeItem('SCARAB_ROOM_FALLBACK');
      }
      if (sid) sessionStorage.setItem('SCARAB_ROOM_SESSION',sid);
    } catch (_) {}

    // Do not reset ROOM_DONE on an internal ATG reload.
    try {
      window.__SCARAB_ROOM_DONE =
        sessionStorage.getItem('seth_seated') === '1' ||
        sessionStorage.getItem('SCARAB_ROOM_DONE') === '1';
    } catch (_) {
      window.__SCARAB_ROOM_DONE=false;
    }

    if(c.MACHINENUM){
      c.VISUAL_TARGET=String(c.MACHINENUM);
      window.__SC_VISUAL_MACHINE=String(c.MACHINENUM);
    }
  }catch(_){}
})();
(function(){
  'use strict';
  if (window.__scarabBootstrapStarted) return;
  window.__scarabBootstrapStarted = true;

  var ROOM_TIMEOUT_MS = 12000;
  var READY_STABLE_MS = 650;
  var GAME_READY_TIMEOUT_MS = 90000;
  var roomWaitSince = 0;
  var portraitWasWaiting = false;
  var portraitClearSince = 0;
  var overlayRecovering = false;
  var loaded = Object.create(null);
  var watchdogTimer = null;

  function status(state, message){
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({__scarabStatus:true,state:state,message:message||'',roomSessionId:String(window.__SCARAB_ROOM_SESSION_ID||window.__SC_ROOM_SESSION_ID||'')}, location.origin);
      }
    } catch (_) {}
  }

  function domReady(){
    if (document.body) return Promise.resolve();
    return new Promise(function(resolve){
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve, {once:true});
      } else {
        var t=setInterval(function(){ if(document.body){clearInterval(t);resolve();} },20);
      }
    });
  }

  function load(src, key){
    if (loaded[key]) return loaded[key];
    loaded[key] = new Promise(function(resolve,reject){
      var s=document.createElement('script');
      s.src=src;
      s.async=false;
      s.onload=function(){ resolve(); };
      s.onerror=function(){ reject(new Error('runtime load failed: '+src)); };
      (document.head || document.documentElement).appendChild(s);
    });
    return loaded[key];
  }

  function visibleCanvas(){
    try {
      var list=document.querySelectorAll('canvas');
      for(var i=0;i<list.length;i++){
        var c=list[i],r=c.getBoundingClientRect();
        if(r.width>=240&&r.height>=140&&getComputedStyle(c).display!=='none') return c;
      }
    } catch (_) {}
    return null;
  }

  function timeManager(){
    try {
      var klass=window.cc&&window.cc.js&&typeof window.cc.js.getClassByName==='function'&&window.cc.js.getClassByName('TimeManager');
      return klass&&klass.instance||null;
    } catch (_) { return null; }
  }

  function cocosSceneReady(){
    try {
      if (!window.cc) return false;
      if (window.cc.director && typeof window.cc.director.getScene === 'function' && window.cc.director.getScene()) return true;
      if (window.cc.game && window.cc.game.canvas) return true;
    } catch (_) {}
    return false;
  }

  function atgServicesReady(){
    try {
      var services=window.App&&window.App.serviceManager&&window.App.serviceManager.services;
      if(!Array.isArray(services)||!services.length) return false;
      return services.some(function(service){
        var socket=service&&service._client&&service._client._io;
        return !!(socket&&(socket.connected||socket.active||socket.io));
      });
    } catch (_) { return false; }
  }

  function gameReadyNow(){
    if (!document.body || !visibleCanvas()) return false;
    return !!(timeManager() || cocosSceneReady() || atgServicesReady());
  }

  function waitForGameReady(){
    return new Promise(function(resolve){
      var started=Date.now(), stableSince=0, lastNotice=0;
      var timer=setInterval(function(){
        var now=Date.now();
        if(gameReadyNow()){
          if(!stableSince) stableSince=now;
          if(now-stableSince>=READY_STABLE_MS){ clearInterval(timer); resolve(true); return; }
        } else stableSince=0;
        if(now-lastNotice>3000){
          lastNotice=now;
          status('engine-wait','ATG 遊戲載入中，等待遊戲引擎完成…');
        }
        if(now-started>=GAME_READY_TIMEOUT_MS){
          // Do not force the assistant into a half-created Cocos scene. Keep the
          // ATG game untouched and continue waiting in a lightweight loop.
          started=now;
          status('engine-wait','ATG 仍在載入，懸浮工具會在遊戲完成後自動接上');
        }
      },400);
    });
  }

  function assistantText(){
    try {
      var root=document.getElementById('scarab-heart-ui');
      var text=root&&root.innerText||'';
      if(text) return text;
      return (document.body&&document.body.innerText)||'';
    } catch (_) { return ''; }
  }

  function isRoomWait(){
    return /定位機台中|定位推薦房|自動帶你進房|正在帶你進房|找房\s*\d+/i.test(assistantText());
  }

  function forceManualRoom(){
    window.__SCARAB_FORCE_MANUAL_ROOM=true;
    try { sessionStorage.removeItem('SCARAB_FORCE_MANUAL_ROOM'); } catch (_) {}
    try {
      var e=window.__sethEngine;
      if(e){
        if(typeof e.cancelRoomTarget==='function') e.cancelRoomTarget();
        if(typeof e.setRoomTarget==='function') e.setRoomTarget(null);
      }
    } catch (_) {}
    status('room-fallback','自動定位逾時，已切換手動選房');
  }

  function recoverOverlay(){
    if (!window.__SCARAB_WEB_ACTIVE || overlayRecovering || !document.body) return;
    if (document.getElementById('scarab-heart-ui')) return;
    if (!window.__scarabOverlayEverLoaded || !window.__sethEngine) return;
    overlayRecovering=true;
    try { window.__scarabHeartUI=false; } catch (_) {}
    var s=document.createElement('script');
    s.src=location.origin+'/__runtime/overlay-runtime.js?recover='+Date.now();
    s.onload=function(){
      overlayRecovering=false;
      load(location.origin+'/__runtime/stability-runtime.js?recover='+Date.now(),'stability-recover-'+Date.now()).catch(function(){});
      status('overlay-recovered');
    };
    s.onerror=function(){ overlayRecovering=false; status('overlay-recover-error'); };
    (document.head||document.documentElement).appendChild(s);
  }

  function startWatchdogs(){
    if(watchdogTimer) return;
    watchdogTimer=setInterval(function(){
      try {
        var waiting=isRoomWait();
        var payload=window.__SCARAB_WEB_PAYLOAD||{}, cfg=payload.cfg||{};
        var portraitRoom=!!cfg.PORTRAIT_ROOM_MODE && !!String(cfg.MACHINENUM||'');
        if (waiting) {
          if (!roomWaitSince) roomWaitSince=Date.now();
          if(portraitRoom){
            portraitWasWaiting=true;
            portraitClearSince=0;
            // Portrait room pages can take longer to build their table/page map.
            // Never let the generic watchdog cancel the user's exact machine.
            window.__SCARAB_FORCE_MANUAL_ROOM=false;
            status('room-searching','正在定位機台 #'+String(cfg.MACHINENUM||'')+'…');
          }

          var exact=!!cfg.EXACT_ROOM;
          if (!exact && !portraitRoom && !window.__SCARAB_FORCE_MANUAL_ROOM && Date.now()-roomWaitSince>=ROOM_TIMEOUT_MS) {
            forceManualRoom();
          } else if ((exact||portraitRoom) && Date.now()-roomWaitSince>=ROOM_TIMEOUT_MS) {
            status('room-exact-wait','正在等待指定機台 #'+String(cfg.MACHINENUM||'')+' 的即時房間資料');
            roomWaitSince=Date.now();
          }
        } else {
          roomWaitSince=0;
          if(portraitRoom&&portraitWasWaiting){
            if(!portraitClearSince) portraitClearSince=Date.now();
            if(Date.now()-portraitClearSince>=1600){
              portraitWasWaiting=false;
              portraitClearSince=0;
              status('room-entered','已完成指定機台定位');
            }
          } else portraitClearSince=0;
        }
        recoverOverlay();
      } catch (_) {}
    },1000);
  }

  var roomSwitchGeneration=0;
  function readRealRooms(){
    var src=Array.isArray(window.__SCARAB_REAL_TABLES)?window.__SCARAB_REAL_TABLES:[];
    return src.filter(function(r){return r&&/^\d+$/.test(String(r.machineNum||''))&&!r.isLocked});
  }
  function seatedNow(){try{return window.__SCARAB_ROOM_DONE===true||sessionStorage.getItem('seth_seated')==='1'||sessionStorage.getItem('SCARAB_ROOM_DONE')==='1'}catch(_){return !!window.__SCARAB_ROOM_DONE}}
  function resolveLiveCandidate(c){
    c=c||{};var m=String(c.machineNum||'').replace(/^#/,'').trim(),rid=String(c.roomId||'').trim(),rooms=readRealRooms();
    var hit=rooms.find(function(r){return (rid&&String(r.roomId||'')===rid)||(m&&String(r.machineNum||'')===m)});
    return hit?Object.assign({},c,hit):{roomId:rid,machineNum:m};
  }
  async function waitSeat(gen,ms){var end=Date.now()+ms;while(gen===roomSwitchGeneration&&Date.now()<end){if(seatedNow())return true;await new Promise(function(r){setTimeout(r,350)})}return false}
  function nodeText(n){try{var out=[String(n&&n.name||'')];if(window.cc&&cc.Label){var l=n.getComponent&&n.getComponent(cc.Label);if(l&&l.string!=null)out.push(String(l.string))}if(window.cc&&cc.RichText){var rt=n.getComponent&&n.getComponent(cc.RichText);if(rt&&rt.string!=null)out.push(String(rt.string))}return out.join(' ').trim()}catch(_){return String(n&&n.name||'')}}
  function clickableNode(n){try{var cur=n;for(var i=0;i<5&&cur;i++,cur=cur.parent){if(window.cc&&cc.Button&&cur.getComponent&&cur.getComponent(cc.Button))return cur}}catch(_){}return n}
  async function clickVisibleMachine(machine){
    var e=window.__sethEngine;if(!e||typeof e.walk!=='function'||typeof e.tap!=='function'||typeof e.toClient!=='function')return false;
    var want=String(Number(machine)),nodes=[];try{nodes=e.walk(function(n){var t=nodeText(n).replace(/\s+/g,'');return t===want||t==='#'+want||t===String(want).padStart(3,'0')||t.indexOf('#'+want)>=0})||[]}catch(_){nodes=[]}
    if(!nodes.length)return false;var n=clickableNode(nodes[0]);try{var p=e.toClient(n.worldPosition);await e.tap(p.x,p.y,70);return true}catch(_){return false}
  }
  async function clickNextPortraitPage(){
    var e=window.__sethEngine;if(!e||typeof e.walk!=='function'||typeof e.tap!=='function'||typeof e.toClient!=='function')return false;var nodes=[];
    try{nodes=e.walk(function(n){var t=nodeText(n).toLowerCase().replace(/\s+/g,'');return /下一頁|下頁|next|pageright|rightpage|nextpage|arrowright|右頁/.test(t)})||[]}catch(_){nodes=[]}
    if(!nodes.length)return false;var n=clickableNode(nodes[0]);try{var p=e.toClient(n.worldPosition);await e.tap(p.x,p.y,60);return true}catch(_){return false}
  }
  async function tryCandidate(c,gen,portrait){
    if(gen!==roomSwitchGeneration)return false;c=resolveLiveCandidate(c);var e=window.__sethEngine,m=String(c.machineNum||''),rid=String(c.roomId||'');if(!m&&!rid)return false;
    status('room-searching','正在定位機台 #'+(m||rid)+'…');
    // Preferred route: use the parser-blocking room tap, which stays inside the
    // current authenticated ATG session and delegates to ATG/game selection.
    try{
      var tap=window.__SCARAB_ATG_ROOM_TAP;
      if(tap&&typeof tap.switchRoom==='function'){
        var tapped=await tap.switchRoom(rid,m);
        if(tapped!==false&&await waitSeat(gen,12000))return true;
      }
    }catch(_){ }
    // Compatibility route for engines that expose a direct room switch.
    if(rid&&e&&typeof e.jumpToRoom==='function'){
      try{var ok=await e.jumpToRoom(rid);if(ok!==false&&await waitSeat(gen,12000))return true}catch(_){ }
    }
    // Portrait fallback: scan visible machine labels, then use the REAL next-page control.
    if(portrait&&m){
      for(var page=0;page<24&&gen===roomSwitchGeneration;page++){
        if(await clickVisibleMachine(m)){if(await waitSeat(gen,9000))return true}
        if(!(await clickNextPortraitPage()))break;
        await new Promise(function(r){setTimeout(r,700)});
      }
    }
    return false;
  }
  async function switchRoomInSession(req){
    var gen=++roomSwitchGeneration,game=String(window.__SC_GAME_CODE||''),portrait=/^(wuxia-caishen|son-go-ku|new-vampire-hunter|new-jinlian)$/.test(game),queue=[],seen=new Set(),lastCycle=0;
    try{sessionStorage.removeItem('seth_seated');sessionStorage.removeItem('SCARAB_ROOM_DONE');window.__SCARAB_ROOM_DONE=false}catch(_){ }
    function add(c){if(!c)return;var m=String(c.machineNum||'').replace(/^#/,'').trim(),rid=String(c.roomId||'').trim(),key=m||rid;if(!key||seen.has(key))return;seen.add(key);queue.push({roomId:rid,machineNum:m})}
    add(req);(Array.isArray(req.candidates)?req.candidates:[]).forEach(add);readRealRooms().forEach(add);
    while(gen===roomSwitchGeneration){
      while(queue.length&&gen===roomSwitchGeneration){var c=queue.shift();if(await tryCandidate(c,gen,portrait)){status('room-entered','已進入機台 #'+String(c.machineNum||''));return true}}
      // Real room feed can arrive after the room scene/socket finishes loading.
      await new Promise(function(r){setTimeout(r,1300)});seen.clear();readRealRooms().forEach(add);(Array.isArray(req.candidates)?req.candidates:[]).forEach(add);
      if(!queue.length&&Date.now()-lastCycle>4000){lastCycle=Date.now();status('room-searching','目前推薦房不可用，正在繼續尋找其他機台…')}
    }
    return false;
  }
  window.addEventListener('message',function(event){
    if(event.origin!==location.origin)return;var d=event.data;if(!d||d.__scarabRoomSwitch!==true)return;var sid=String(d.roomSessionId||'');if(sid&&window.__SCARAB_ROOM_SESSION_ID&&sid!==String(window.__SCARAB_ROOM_SESSION_ID))return;switchRoomInSession(d).catch(function(){})
  });

  domReady().then(async function(){
    try {
      status('engine-wait','ATG 遊戲本體載入中…');
      await waitForGameReady();
      status('engine-loading','ATG 已就緒，正在連接懸浮工具…');
      await load(location.origin+'/__runtime/atg-engine-runtime.js','engine');
      if (!window.__sethBooted) {
        window.__sethBooted=true;
        try {
          var p=window.__SCARAB_WEB_PAYLOAD||{};
          if (typeof window.engine !== 'function') throw new Error('engine() missing');
          window.engine(p.cfg||{});
        } catch (e) {
          window.__sethBooted=false;
          throw e;
        }
      }
      await load(location.origin+'/__runtime/atg-live-adapter.js','live');
      await load(location.origin+'/__runtime/overlay-runtime.js','overlay');
      window.__scarabOverlayEverLoaded=true;
      await load(location.origin+'/__runtime/stability-runtime.js','stability');
      startWatchdogs();
      status('engine-ready','懸浮工具已連線');
      try {
        var cfg=(window.__SCARAB_WEB_PAYLOAD&&window.__SCARAB_WEB_PAYLOAD.cfg)||{},game=String(window.__SC_GAME_CODE||'');
        if(/^(wuxia-caishen|son-go-ku|new-vampire-hunter|new-jinlian)$/.test(game)&&cfg.MACHINENUM){
          setTimeout(function(){if(!seatedNow())switchRoomInSession({roomId:String(cfg.FULL_ROOM_ID||''),machineNum:String(cfg.MACHINENUM||''),candidates:Array.isArray(cfg.BOARD_LIST)?cfg.BOARD_LIST:(Array.isArray(cfg.GOOD_ROOMS)?cfg.GOOD_ROOMS:[])}).catch(function(){})},5000);
        }
      } catch (_) {}
    } catch (e) {
      status('engine-error', String(e && e.message || e));
    }
  });
})();
