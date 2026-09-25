(function(){
  'use strict';
  if (window.__scarabBootstrapStarted) return;
  window.__scarabBootstrapStarted = true;

  var ROOM_TIMEOUT_MS = 35000;
  var READY_STABLE_MS = 1200;
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
      },250);
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
    try { sessionStorage.setItem('SCARAB_FORCE_MANUAL_ROOM','1'); } catch (_) {}
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
    s.src='/__runtime/overlay-runtime.js?recover='+Date.now();
    s.onload=function(){
      overlayRecovering=false;
      load('/__runtime/stability-runtime.js?recover='+Date.now(),'stability-recover-'+Date.now()).catch(function(){});
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
          if (!window.__SCARAB_FORCE_MANUAL_ROOM && Date.now()-roomWaitSince>=ROOM_TIMEOUT_MS) forceManualRoom();
        } else roomWaitSince=0;
        recoverOverlay();
      } catch (_) {}
    },750);
  }

  domReady().then(async function(){
    try {
      status('engine-wait','ATG 遊戲本體載入中…');
      await waitForGameReady();
      status('engine-loading','ATG 已就緒，正在連接懸浮工具…');
      await load('/__runtime/atg-engine-runtime.js','engine');
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
      await load('/__runtime/atg-live-adapter.js','live');
      await load('/__runtime/overlay-runtime.js','overlay');
      window.__scarabOverlayEverLoaded=true;
      await load('/__runtime/stability-runtime.js','stability');
      startWatchdogs();
      status('engine-ready','懸浮工具已連線');
    } catch (e) {
      status('engine-error', String(e && e.message || e));
    }
  });
})();
