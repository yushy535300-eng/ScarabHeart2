(function(){
  'use strict';
  if (window.__scarabBootstrapStarted) return;
  window.__scarabBootstrapStarted = true;

  var ROOM_TIMEOUT_MS = 35000;
  var roomWaitSince = 0;
  var overlayRecovering = false;
  var loaded = Object.create(null);

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

  function bodyText(){
    try { return (document.body && document.body.innerText) || ''; }
    catch (_) { return ''; }
  }

  function isRoomWait(){
    var t=bodyText();
    return /定位機台中|定位推薦房|自動帶你進房|正在帶你進房|找房\s*\d+/i.test(t);
  }

  function recoverOverlay(){
    if (!window.__SCARAB_WEB_ACTIVE || overlayRecovering || !document.body) return;
    if (document.getElementById('scarab-heart-ui')) return;
    if (!window.__scarabOverlayEverLoaded) return;
    overlayRecovering=true;
    try { window.__scarabHeartUI=false; } catch (_) {}
    var s=document.createElement('script');
    s.src='/__runtime/overlay-runtime.js?recover='+Date.now();
    s.onload=function(){ overlayRecovering=false; status('overlay-recovered'); };
    s.onerror=function(){ overlayRecovering=false; status('overlay-recover-error'); };
    (document.head||document.documentElement).appendChild(s);
  }

  function startWatchdogs(){
    setInterval(function(){
      try {
        if (isRoomWait()) {
          if (!roomWaitSince) roomWaitSince=Date.now();
          if (!window.__SCARAB_FORCE_MANUAL_ROOM && Date.now()-roomWaitSince>=ROOM_TIMEOUT_MS) {
            window.__SCARAB_FORCE_MANUAL_ROOM=true;
            status('room-fallback','自動定位逾時，已切換手動選房');
          }
        } else {
          roomWaitSince=0;
        }
        recoverOverlay();
      } catch (_) {}
    },1000);
  }

  domReady().then(async function(){
    try {
      status('engine-loading');
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
      status('engine-ready');
      await load('/__runtime/atg-live-adapter.js','live');
      status('live-ready');
      await load('/__runtime/overlay-runtime.js','overlay');
      window.__scarabOverlayEverLoaded=true;
      status('overlay-ready');
      startWatchdogs();
    } catch (e) {
      status('engine-error', String(e && e.message || e));
    }
  });
})();
