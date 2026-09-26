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
  var portraitFinderTimer = null;
  var portraitTargetAttemptAt = 0;
  var portraitPageAttemptAt = 0;
  var portraitPageIndex = 1;
  var portraitEngineSwitching = false;
  var loaded = Object.create(null);
  var watchdogTimer = null;

  function status(state, message){
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({__scarabStatus:true,state:state,message:message||'',roomSessionId:String(window.__SCARAB_ROOM_SESSION_ID||window.__SC_ROOM_SESSION_ID||'')}, location.origin);
      }
    } catch (_) {}
  }

  function visibleElement(el){
    try{if(!el||el.nodeType!==1)return false;var cs=getComputedStyle(el),r=el.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity||1)>0&&r.width>8&&r.height>8&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;}catch(_){return false;}
  }
  function portraitTargetText(text,target){
    var tx=String(text||'').replace(/\s+/g,' ').trim(); if(!tx||tx.length>80)return false;
    var raw=String(parseInt(target,10)); if(!/^\d+$/.test(raw))return false;
    var pad=raw.padStart(3,'0');
    return tx===raw||tx===pad||tx==='#'+raw||tx==='#'+pad||new RegExp('(?:^|[^0-9])0*'+raw+'(?:[^0-9]|$)').test(tx)&&/房|機台|机台|號|号|machine|room/i.test(tx);
  }
  function liveRoomForMachine(e,target){
    try{
      var list=e&&Array.isArray(e.tables)?e.tables:[];var raw=String(parseInt(target,10));
      for(var i=0;i<list.length;i++){
        var x=list[i]||{};var n=x.number!=null?x.number:(x.machineNum!=null?x.machineNum:(x.machineNo!=null?x.machineNo:x.machine_num));
        if(String(parseInt(n,10))===raw)return {roomId:String(x.roomId!=null?x.roomId:(x.room_id!=null?x.room_id:(x.tableId!=null?x.tableId:''))),machineNum:String(n)};
      }
    }catch(_){} return null;
  }
  async function portraitSwitchByEngine(cfg){
    if(portraitEngineSwitching)return false;
    var e=window.__sethEngine,target=String(cfg&&cfg.MACHINENUM||'').trim(); if(!e||!target)return false;
    var row=liveRoomForMachine(e,target); if(!row)return false;
    portraitEngineSwitching=true;
    try{
      status('room-searching','已找到機台 #'+target+'，正在進房…');
      var ok=false;
      if(row.roomId&&typeof e.selectByRoom==='function'){var r=e.selectByRoom(row.roomId);if(r&&typeof r.then==='function')r=await r;ok=r!==false;}
      if(!ok&&typeof e.switchRoomInGame==='function'){var s=e.switchRoomInGame(target);if(s&&typeof s.then==='function')s=await s;ok=s!==false;}
      if(ok){status('room-entered','已定位機台 #'+target);return true;}
    }catch(_){}finally{setTimeout(function(){portraitEngineSwitching=false;},900)}
    return false;
  }
  function cocosNodeText(e,node){
    var parts=[];try{if(typeof e.label==='function')parts.push(e.label(node)||'');}catch(_){}try{if(typeof e.btnText==='function')parts.push(e.btnText(node)||'');}catch(_){}try{parts.push(node&&node.name||'');}catch(_){}return parts.join(' ').trim();
  }
  function portraitPressTargetNode(cfg){
    var e=window.__sethEngine,target=String(cfg&&cfg.MACHINENUM||'').trim();if(!e||typeof e.walk!=='function'||!target)return false;
    try{
      var nodes=e.walk(function(n){return portraitTargetText(cocosNodeText(e,n),target);})||[];
      if(nodes.length){var n=nodes[0];if(typeof e.press==='function'){e.press(n);status('room-searching','已找到機台 #'+target+'，正在進房…');return true;}}
    }catch(_){} return false;
  }
  function portraitNextCocos(){
    var e=window.__sethEngine;if(!e||typeof e.walk!=='function')return false;
    try{
      var nodes=e.walk(function(n){var tx=cocosNodeText(e,n).replace(/\s+/g,'').toLowerCase();return /下一頁|下一页|next|pageright|rightpage/.test(tx)||tx==='>'||tx==='›'||tx==='»';})||[];
      if(!nodes.length)nodes=e.walk(function(n){var nm=String(n&&n.name||'').toLowerCase();return /next|right.*page|page.*right/.test(nm);})||[];
      if(!nodes.length)nodes=e.walk(function(n){var nm=String(n&&n.name||'');return nm==='Toggle'||nm==='allToggle';})||[];
      if(nodes.length&&typeof e.press==='function'){e.press(nodes[(portraitPageIndex-1)%nodes.length]);return true;}
    }catch(_){} return false;
  }
  function portraitPressDomTarget(cfg){
    var target=String(cfg&&cfg.MACHINENUM||'').trim();if(!target)return false;
    try{var els=document.querySelectorAll('button,[role="button"],a,li,div');for(var i=0;i<els.length;i++){var el=els[i];if(!visibleElement(el)||el.closest&&el.closest('#scarab-heart-ui,.shLegacyNotice'))continue;if(!portraitTargetText(el.innerText||el.textContent,target))continue;var hit=el;for(var j=0;j<5&&hit&&hit!==document.body;j++,hit=hit.parentElement){if(hit.matches&&hit.matches('button,a,[role="button"],[onclick]'))break;}hit=hit||el;try{hit.click();status('room-searching','已找到機台 #'+target+'，正在進房…');return true;}catch(_){}}}catch(_){}return false;
  }
  function portraitNextDom(){
    var sels=['.el-pagination .btn-next:not([disabled])','[class*="pagination"] [class*="next"]:not([disabled])','button[aria-label*="next" i]:not([disabled])','button[title*="next" i]:not([disabled])'];
    for(var i=0;i<sels.length;i++){try{var el=document.querySelector(sels[i]);if(el&&visibleElement(el)){el.click();return true;}}catch(_){}}
    return false;
  }
  async function portraitFinderTick(){
    try{
      var payload=window.__SCARAB_WEB_PAYLOAD||{},cfg=payload.cfg||{};if(!cfg.PORTRAIT_ROOM_MODE||!String(cfg.MACHINENUM||'').trim()||window.__SCARAB_ROOM_DONE)return;
      var now=Date.now();
      if(now-portraitTargetAttemptAt>900){portraitTargetAttemptAt=now;if(await portraitSwitchByEngine(cfg))return;if(portraitPressTargetNode(cfg))return;if(portraitPressDomTarget(cfg))return;}
      if(now-portraitPageAttemptAt>1800){portraitPageAttemptAt=now;var moved=portraitNextCocos()||portraitNextDom();if(moved){portraitPageIndex++;status('room-searching','第 '+portraitPageIndex+' 頁搜尋機台 #'+String(cfg.MACHINENUM||'')+'…');}}
    }catch(_){}
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
    if(!portraitFinderTimer) portraitFinderTimer=setInterval(function(){portraitFinderTick();},420);
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
