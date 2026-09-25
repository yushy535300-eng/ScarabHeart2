(function(){
  try {
    var p=window.__SCARAB_WEB_PAYLOAD||{}, c=p.cfg||{};
    var sid=String(c.ROOM_SESSION_ID||Date.now());
    window.__SCARAB_ROOM_SESSION_ID=sid;
    window.__SCARAB_FORCE_MANUAL_ROOM=false;
    window.__SCARAB_ROOM_DONE=false;
    window.__SCARAB_LAST_ROOM=null;
    window.__SCARAB_LAST_MACHINE=null;
    try {
      sessionStorage.setItem('SCARAB_ROOM_SESSION',sid);
      sessionStorage.removeItem('SCARAB_FORCE_MANUAL_ROOM');
      sessionStorage.removeItem('scarab_force_manual_room');
      sessionStorage.removeItem('SCARAB_ROOM_FALLBACK');
      sessionStorage.removeItem('SCARAB_ROOM_DONE');
      sessionStorage.removeItem('SCARAB_LAST_ROOM');
      sessionStorage.removeItem('SCARAB_LAST_MACHINE');
    } catch (_) {}
    if(c.MACHINENUM){
      // Keep TARGET/TARGET_KIND untouched. The ATG engine needs the roomId
      // as TARGET and uses MACHINENUM only as the visible-machine fallback.
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
  var overlayRecovering = false;
  var loaded = Object.create(null);
  var watchdogTimer = null;

  function status(state, message){
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({__scarabStatus:true,state:state,message:message||''}, location.origin);
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
        if (isRoomWait()) {
          if (!roomWaitSince) roomWaitSince=Date.now();
          var payload=window.__SCARAB_WEB_PAYLOAD||{}, cfg=payload.cfg||{};

          var exact=!!cfg.EXACT_ROOM;
          if (!exact && !window.__SCARAB_FORCE_MANUAL_ROOM && Date.now()-roomWaitSince>=ROOM_TIMEOUT_MS) {
            forceManualRoom();
          } else if (exact && Date.now()-roomWaitSince>=ROOM_TIMEOUT_MS) {
            // Do not throw away the selected room. Keep ATG interactive and continue
            // exact matching in the background until the live table map is ready.
            status('room-exact-wait','正在等待指定機台 '+String(cfg.MACHINENUM||'')+' 的即時房間資料');
            roomWaitSince=Date.now();
          }
        } else roomWaitSince=0;
        recoverOverlay();
      } catch (_) {}
    },1000);
  }

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
    } catch (e) {
      status('engine-error', String(e && e.message || e));
    }
  });
})();
