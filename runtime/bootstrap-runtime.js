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
  var portraitLastTargetClick = 0;
  var portraitLastNextClick = 0;
  var portraitPageTurns = 0;
  var goodRoomRetrySent = false;
  var loaded = Object.create(null);
  var watchdogTimer = null;

  function status(state, message){
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({__scarabStatus:true,state:state,message:message||'',roomSessionId:String(window.__SCARAB_ROOM_SESSION_ID||window.__SC_ROOM_SESSION_ID||'')}, location.origin);
      }
    } catch (_) {}
  }

  function command(url){
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({__scarabCommand:true,url:String(url||''),roomSessionId:String(window.__SCARAB_ROOM_SESSION_ID||window.__SC_ROOM_SESSION_ID||'')}, location.origin);
      }
    } catch (_) {}
  }

  function visibleElement(el){
    try {
      if(!el || el.nodeType!==1) return false;
      var cs=getComputedStyle(el),r=el.getBoundingClientRect();
      return cs.display!=='none' && cs.visibility!=='hidden' && Number(cs.opacity||1)>0 && r.width>8 && r.height>8 && r.bottom>0 && r.right>0 && r.top<innerHeight && r.left<innerWidth;
    } catch (_) { return false; }
  }

  function portraitIgnore(el){
    try { return !!(el && el.closest && el.closest('#scarab-heart-ui,.shLegacyNotice,#shToast,script,style')); } catch (_) { return false; }
  }

  function machineTextMatch(el,target){
    try {
      if(!el || portraitIgnore(el) || !visibleElement(el)) return false;
      var tx=String(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
      if(!tx || tx.length>90) return false;
      var raw=String(parseInt(target,10));
      var pad=raw.padStart(3,'0');
      var exact=(tx===raw||tx===pad||tx==='#'+raw||tx==='#'+pad);
      var tagged=new RegExp('(?:^|[^0-9])0*'+raw+'(?:[^0-9]|$)').test(tx) && /房|機台|机台|號|号|machine|room/i.test(tx);
      var hint=String((el.id||'')+' '+(el.className||'')).toLowerCase();
      var semantic=new RegExp('(?:^|[^0-9])0*'+raw+'(?:[^0-9]|$)').test(tx) && /room|machine|table|slot|card|item/.test(hint);
      return exact||tagged||semantic;
    } catch (_) { return false; }
  }

  function clickableForMachine(el){
    var cur=el;
    for(var i=0;i<6&&cur&&cur!==document.body;i++,cur=cur.parentElement){
      if(portraitIgnore(cur)) return null;
      var tag=String(cur.tagName||'').toLowerCase();
      var role=String(cur.getAttribute&&cur.getAttribute('role')||'').toLowerCase();
      var hint=String((cur.id||'')+' '+(cur.className||'')).toLowerCase();
      if(tag==='button'||tag==='a'||role==='button'||cur.hasAttribute&&cur.hasAttribute('onclick')||/room|machine|table|slot|card|item/.test(hint)) return cur;
    }
    return el;
  }

  function clickPortraitTarget(cfg){
    var target=String(cfg&&cfg.MACHINENUM||'').trim();
    if(!target||window.__SCARAB_ROOM_DONE) return false;
    var list=document.querySelectorAll('button,[role="button"],a,li,div,section');
    for(var i=0;i<list.length;i++){
      var el=list[i];
      if(!machineTextMatch(el,target)) continue;
      var hit=clickableForMachine(el);
      if(!hit||!visibleElement(hit)) continue;
      var now=Date.now();
      if(now-portraitLastTargetClick<1800) return true;
      portraitLastTargetClick=now;
      try { hit.scrollIntoView({block:'center',inline:'center'}); } catch (_) {}
      try { hit.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'})); } catch (_) {}
      try { hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); } catch (_) {}
      try { hit.click(); } catch (_) { try { hit.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); } catch(__){} }
      status('room-searching','已找到機台 #'+target+'，正在進房…');
      return true;
    }
    return false;
  }

  function findPortraitNext(){
    var selectors=[
      '.el-pagination .btn-next:not([disabled])',
      '[class*="pagination"] [class*="next"]:not([disabled])',
      'button[aria-label*="next" i]:not([disabled])',
      'button[title*="next" i]:not([disabled])',
      '[role="button"][aria-label*="next" i]'
    ];
    for(var i=0;i<selectors.length;i++){
      try { var n=document.querySelector(selectors[i]); if(n&&visibleElement(n)&&!portraitIgnore(n)) return n; } catch(_){}
    }
    var nodes=document.querySelectorAll('button,[role="button"],a');
    for(var j=0;j<nodes.length;j++){
      var el=nodes[j]; if(!visibleElement(el)||portraitIgnore(el)||el.disabled) continue;
      var tx=String(el.innerText||el.textContent||'').replace(/\s+/g,'').trim();
      var aria=String(el.getAttribute&&el.getAttribute('aria-label')||'');
      var title=String(el.getAttribute&&el.getAttribute('title')||'');
      var hint=String((el.id||'')+' '+(el.className||'')).toLowerCase();
      if(/^(下一頁|下一页|›|»|>)$/.test(tx)||/下一頁|下一页|next/i.test(aria+' '+title)||/next/.test(hint)) return el;
    }
    return null;
  }

  function portraitFinderTick(){
    try {
      var payload=window.__SCARAB_WEB_PAYLOAD||{},cfg=payload.cfg||{};
      if(!cfg.PORTRAIT_ROOM_MODE||!String(cfg.MACHINENUM||'').trim()||window.__SCARAB_ROOM_DONE) return;
      if(clickPortraitTarget(cfg)) return;
      // The legacy engine already flips pages on many builds. This is a
      // portrait-only backup: if the target is not visible, operate the real
      // visible next-page control instead of guessing an ATG roomId.
      var now=Date.now();
      if(now-portraitLastNextClick<2400) return;
      var next=findPortraitNext();
      if(next){
        portraitLastNextClick=now; portraitPageTurns++;
        try { next.click(); } catch (_) { try { next.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})); } catch(__){} }
        status('room-searching','第 '+String(portraitPageTurns+1)+' 頁搜尋機台 #'+String(cfg.MACHINENUM||'')+'…');
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
    if(!portraitFinderTimer) portraitFinderTimer=setInterval(portraitFinderTick,320);
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
          var autoGood=!!cfg.AUTO_GOOD_ROOM_CHAIN;
          var retryMs=portraitRoom?18000:12000;
          if(autoGood && !goodRoomRetrySent && Date.now()-roomWaitSince>=retryMs){
            goodRoomRetrySent=true;
            status('room-recommend-next','目前推薦房未定位成功，正在改找下一個推薦');
            command('https://__sethcmd__/retry-good?mn='+encodeURIComponent(String(cfg.MACHINENUM||'')));
          } else if (!autoGood && !exact && !portraitRoom && !window.__SCARAB_FORCE_MANUAL_ROOM && Date.now()-roomWaitSince>=ROOM_TIMEOUT_MS) {
            forceManualRoom();
          } else if (!autoGood && (exact||portraitRoom) && Date.now()-roomWaitSince>=ROOM_TIMEOUT_MS) {
            status('room-exact-wait','正在等待指定機台 #'+String(cfg.MACHINENUM||'')+' 的即時房間資料');
            roomWaitSince=Date.now();
          }
        } else {
          roomWaitSince=0;
          goodRoomRetrySent=false;
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
