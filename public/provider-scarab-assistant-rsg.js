/* 聖甲之心助手 — RSG companion for game engines not yet exposing the
   native Thor assistant. SlotGame5 keeps its fully functional original HUD.
   This does not invent winnings, RTP, unpaid spins or unsupported commands. */
(function(){
  'use strict';
  var root=null, active=false, currentPage='closed', drag=null, minimized=false;
  var lastData=null, maxAge=4000;
  var engineState={canSpeed:false,lastSeen:0,name:'',speed:1,hint:'未識別'},commandSeq=0;
  function $(id){return root&&root.querySelector('#'+id)}
  function put(id,value){var el=$(id);if(el)el.textContent=value;}
  function fmt(value,kind){
    var n=Number(value);
    if(!Number.isFinite(n))return '—';
    if(kind==='pnl')return (n>=0?'+':'')+n.toLocaleString('zh-TW',{maximumFractionDigits:2});
    if(kind==='rtp')return n.toFixed(1)+'%';
    return n.toLocaleString('zh-TW',{maximumFractionDigits:2});
  }
  function verifiedFrame(src){
    var frame=document.getElementById('gameFrame');
    if(!frame||!src)return false;
    try{for(var i=0;i<8;i++){
      if(src===frame.contentWindow)return true;
      if(src===src.parent)break;
      src=src.parent;
    }}catch(_){}
    return false;
  }
  function canUseSpeed(){return engineState.canSpeed&&Date.now()-engineState.lastSeen<6500;}
  function speedButtons(){
    if(!root)return;
    var ready=canUseSpeed();
    root.querySelectorAll('.sh-speeds button').forEach(function(b){
      b.disabled=!ready;
      b.classList.toggle('speed-verified',ready&&Number(b.dataset.sp)===engineState.speed);
      b.setAttribute('aria-pressed',String(ready&&Number(b.dataset.sp)===engineState.speed));
      b.title=ready?'透過已驗證的'+engineState.name+'調整遊戲引擎時間倍率':'遊戲尚未提供可驗證的加速引擎';
    });
  }
  function changeSpeed(n){
    if(!canUseSpeed()){put('shRsgStatus','尚未偵測到可用的遊戲引擎');return;}
    var frame=document.getElementById('gameFrame'),requestId=String(++commandSeq);
    if(!frame||!frame.contentWindow)return;
    put('shRsgStatus','正在套用 '+n+'x，等待引擎確認…');
    frame.contentWindow.postMessage({__scarabRsgControl:true,action:'speed',value:n,requestId:requestId},location.origin);
  }
  function knownNative(){
    var frame=document.getElementById('gameFrame');
    try {
      var doc=frame&&frame.contentDocument;
      if(!doc)return false;
      for(var el of doc.querySelectorAll('#__thorHud,#__lunarHud')){
        var style=doc.defaultView.getComputedStyle(el);
        if(style.display!=='none'&&style.visibility!=='hidden'&&el.getBoundingClientRect().width>5)return true;
      }
    } catch(_) {}
    return false;
  }
  function addStyle(){
    if(document.getElementById('sh-rsg-correct-style'))return;
    var st=document.createElement('style');
    st.id='sh-rsg-correct-style';
    st.textContent=`
#scarab-rsg-correct{position:absolute;z-index:9;top:calc(env(safe-area-inset-top,0px) + 12px);left:9px;
  width:250px;max-width:calc(100vw - 18px);box-sizing:border-box;
  background:linear-gradient(145deg,rgba(7,36,30,.98),rgba(9,27,24,.97));
  border:1px solid #b49e63;border-radius:17px;color:#e9d499;
  font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","PingFang TC",sans-serif;
  font-size:12px;box-shadow:0 8px 25px #0009,inset 0 1px #f9dc8840;overflow:hidden;
  -webkit-user-select:none;user-select:none;touch-action:auto}
#scarab-rsg-correct[hidden]{display:none!important}
#scarab-rsg-correct .sh-head{height:48px;display:flex;align-items:center;gap:9px;padding:0 12px;
  border-bottom:1px solid #baa75c55;cursor:grab;touch-action:none}
#scarab-rsg-correct .sh-head:active{cursor:grabbing}
#scarab-rsg-correct .sh-head img{width:32px;height:32px;object-fit:contain}
#scarab-rsg-correct .sh-name{font-size:15px;font-weight:900;color:#f1d48e;flex:1;white-space:nowrap}
#scarab-rsg-correct button{appearance:none;-webkit-appearance:none;cursor:pointer;font-family:inherit;
  touch-action:manipulation;-webkit-tap-highlight-color:transparent}
#scarab-rsg-correct .sh-min{background:transparent;color:#eed69c;font-size:23px;border:0;min-width:30px;min-height:38px}
#scarab-rsg-correct .sh-body{padding:10px 11px 12px}
#scarab-rsg-correct .sh-summary{border:1px solid #b49b5888;border-radius:12px;padding:10px 8px;
  background:#08231ddd;text-align:center}
#scarab-rsg-correct .sh-cap{font-size:11px;color:#a4afb3}
#scarab-rsg-correct .sh-profit{font-size:29px;font-weight:950;color:#a9ff22;line-height:1.45;min-height:38px}
#scarab-rsg-correct .sh-balance{font-size:12px;color:#bba477;min-height:18px}
#scarab-rsg-correct .sh-stats{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:9px;
  padding-top:8px;border-top:1px solid #b49b5866}
#scarab-rsg-correct .sh-stats>div:first-child{border-right:1px solid #b49b5850}
#scarab-rsg-correct .sh-stats strong{display:block;font-size:16px;color:#f3d48a;line-height:1.45}
#scarab-rsg-correct .sh-title{font-size:12px;color:#d7bd82;margin:10px 0 6px;display:flex;align-items:center;gap:6px}
#scarab-rsg-correct .sh-speeds{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
#scarab-rsg-correct .sh-speeds button{height:36px;border-radius:10px;border:1px solid #bbaa715e;
  background:#19342b;color:#ebcf88;font-weight:850;font-size:13px}
#scarab-rsg-correct button:disabled{opacity:.45!important;cursor:not-allowed!important}
#scarab-rsg-correct .sh-speeds button.speed-verified{background:linear-gradient(#f5d584,#b8862e);color:#10211b;border-color:#f7e6aa;box-shadow:0 0 12px #e8b34866}
#scarab-rsg-correct .sh-row{display:flex;align-items:center;justify-content:space-between;gap:5px;
  min-height:37px;color:#f2d499}
#scarab-rsg-correct .sh-row button{background:transparent;border:0;color:#ebd7a2}
#scarab-rsg-correct .sh-toggle{width:40px;height:24px;border-radius:14px!important;border:1px solid #9b9d8a!important;
  background:#41524d!important;position:relative}
#scarab-rsg-correct .sh-toggle::before{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;
  border-radius:50%;background:#cfd1c9}
#scarab-rsg-correct .sh-risk{width:100%;min-height:38px;border-radius:10px;border:1px solid #ae955c;
  color:#f1d18e;background:#122b24;font-weight:900;font-size:13px;margin:3px 0}
#scarab-rsg-correct .sh-status{text-align:center;font-size:11px;color:#baa778;min-height:20px;margin:4px 0}
#scarab-rsg-correct .sh-actions{display:flex;gap:5px}
#scarab-rsg-correct .sh-actions button{flex:1;min-height:37px;border-radius:9px;
  border:1px solid #bca266;background:#17382d;color:#eed99f;font-weight:750}
#scarab-rsg-correct .sh-hint{display:none;color:#bdd0c5;font-size:11px;line-height:1.5;
  margin:7px 0 3px;padding:8px;border:1px solid #7f9d8355;border-radius:9px}
#scarab-rsg-correct .sh-hint.open{display:block}
#scarab-rsg-correct .sh-compact{display:none}
#scarab-rsg-correct.sh-collapsed{width:205px}
#scarab-rsg-correct.sh-collapsed .sh-body{display:none}
#scarab-rsg-correct.sh-collapsed .sh-compact{display:block;margin:0 11px 7px;color:#acc2b4;font-size:10px}
#scarab-rsg-correct button:focus-visible{outline:2px solid #f7d178;outline-offset:2px}
@media(max-width:650px){#scarab-rsg-correct{width:190px;top:calc(env(safe-area-inset-top,0px) + 7px);left:6px;border-radius:14px}
#scarab-rsg-correct .sh-head{height:39px;padding:0 7px;gap:5px}
#scarab-rsg-correct .sh-head img{width:26px;height:26px}
#scarab-rsg-correct .sh-name{font-size:12px}
#scarab-rsg-correct .sh-body{padding:7px}
#scarab-rsg-correct .sh-summary{padding:6px}
#scarab-rsg-correct .sh-profit{font-size:23px;min-height:29px}
#scarab-rsg-correct .sh-speeds button{height:30px;font-size:11px}
#scarab-rsg-correct .sh-title{margin:7px 0 4px}
#scarab-rsg-correct .sh-actions button{min-height:32px}
#scarab-rsg-correct.sh-collapsed{width:158px}}
`;
    document.head.appendChild(st);
  }
  function mount(){
    if(root)return;
    var view=document.getElementById('gameView');
    if(!view)return;
    addStyle();
    root=document.createElement('section');
    root.id='scarab-rsg-correct';root.hidden=true;root.setAttribute('aria-label','聖甲之心助手');
    root.innerHTML=`
<div class="sh-head"><img src="/logo.png" alt="聖甲之心"><span class="sh-name">聖甲之心助手</span>
<button class="sh-min" type="button" aria-label="收合或展開">−</button></div>
<div class="sh-compact">RSG · 聖甲之心</div>
<div class="sh-body">
  <div class="sh-summary"><div class="sh-cap">本場輸贏</div><div class="sh-profit" id="shRsgPnl">—</div>
    <div class="sh-balance" id="shRsgBal">餘額 —</div>
    <div class="sh-stats"><div><span class="sh-cap">未開免遊</span><strong id="shRsgUnopened">—</strong></div>
    <div><span class="sh-cap">本場RTP</span><strong id="shRsgRtp">—</strong></div></div>
  </div>
  <div class="sh-title">🚀 加速器</div>
  <div class="sh-speeds"><button data-sp="1" disabled>1x</button><button data-sp="2" disabled>2x</button><button data-sp="4" disabled>4x</button><button data-sp="8" disabled>8x</button></div>
  <div class="sh-row"><span>🔔 訊號</span><button class="sh-signal" type="button" aria-label="訊號說明">›</button></div>
  <div class="sh-row"><span>🎰 免遊自動跳過</span><button type="button" class="sh-toggle" disabled aria-label="免遊自動跳過尚未接通"></button></div>
  <button type="button" class="sh-risk" disabled>止盈 / 止損 · 設定</button>
  <div class="sh-hint" role="status">此款 RSG 遊戲尚未完成專用資料和操作接入；只有取得真實遊戲回傳數據後，才會啟用分析與控制功能。</div>
  <div class="sh-status" id="shRsgStatus">正在確認遊戲資料…</div>
  <div class="sh-actions"><button type="button" class="sh-info">說明</button><button type="button" class="sh-exit">退出</button></div>
</div>`;
    view.appendChild(root);
    var bar=root.querySelector('.sh-head'),min=root.querySelector('.sh-min');
    min.addEventListener('click',function(e){e.stopPropagation();minimized=!minimized;root.classList.toggle('sh-collapsed',minimized);min.textContent=minimized?'+':'−';});
    bar.addEventListener('pointerdown',function(e){
      if(e.target.closest('button'))return;
      drag={id:e.pointerId,x:e.clientX-root.getBoundingClientRect().left,y:e.clientY-root.getBoundingClientRect().top};
      try{bar.setPointerCapture(e.pointerId)}catch(_){}
      e.preventDefault();
    });
    bar.addEventListener('pointermove',function(e){if(!drag||drag.id!==e.pointerId)return;var x=Math.max(0,Math.min(innerWidth-root.offsetWidth,e.clientX-drag.x)),y=Math.max(0,Math.min(innerHeight-root.offsetHeight,e.clientY-drag.y));root.style.left=x+'px';root.style.top=y+'px';});
    ['pointerup','pointercancel','lostpointercapture'].forEach(function(n){bar.addEventListener(n,function(){drag=null;});});
    root.querySelectorAll('.sh-speeds button').forEach(function(btn){btn.addEventListener('click',function(){changeSpeed(Number(btn.dataset.sp))});});
    root.querySelector('.sh-signal').addEventListener('click',toggleInfo);
    root.querySelector('.sh-info').addEventListener('click',toggleInfo);
    root.querySelector('.sh-exit').addEventListener('click',function(){var p=window.ScarabWebLauncher;if(p&&p.returnToRsgLobby&&p.returnToRsgLobby())return;put('shRsgStatus','請點右上角返回 RSG 大廳');});
  }
  function toggleInfo(){var info=root.querySelector('.sh-hint');info.classList.toggle('open');}
  function state(page){
    currentPage=page;active=page==='game';
    if(page!=='game'){engineState.canSpeed=false;engineState.lastSeen=0;engineState.hint='未識別';lastData=null;}
    render();
  }
  function render(){
    mount();if(!root)return;
    root.hidden=!active||knownNative();
    if(root.hidden)return;
    var fresh=lastData&&Date.now()-lastData.at<maxAge;
    var d=fresh?lastData.value:null;
    put('shRsgPnl',d&&Number.isFinite(d.pnl)?fmt(d.pnl,'pnl'):'—');
    put('shRsgBal',d&&Number.isFinite(d.balance)?'餘額 '+fmt(d.balance):'餘額 —');
    put('shRsgUnopened',d&&Number.isInteger(d.unopened)?d.unopened+' 轉':'—');
    put('shRsgRtp',d&&Number.isFinite(d.rtp)?fmt(d.rtp,'rtp'):'—');
    speedButtons();
    if(!canUseSpeed())put('shRsgStatus', '引擎：'+engineState.hint+' · 尚未取得可控制的時間接口');
    else if(!d)put('shRsgStatus',engineState.name+' 已接通 · 輸贏等資料仍待遊戲回傳');
  }
  window.addEventListener('scarab:rsg-page',function(e){state(e.detail&&e.detail.page)});
  // Verified same-iframe telemetry only. Never guess values from artwork.
  window.addEventListener('message',function(e){
    if(e.origin!==location.origin||!active||!e.data||e.data.provider!=='rsg'||!verifiedFrame(e.source))return;
    if(e.data.__scarabRsgEngine===true){
      var event=e.data;
      if(event.type==='capabilities'){
        engineState.canSpeed=event.canSpeed===true;
        engineState.name=String(event.adapter||'').slice(0,42);
        engineState.hint=String(event.engineHint||'未識別').slice(0,50);
        engineState.lastSeen=Date.now();
        if(engineState.canSpeed&&[1,2,4,8].includes(Number(event.speed)))engineState.speed=Number(event.speed);
        speedButtons();
        return;
      }
      if(event.type==='speedAck'){
        if(event.success===true&&[1,2,4,8].includes(Number(event.speed))){
          engineState.speed=Number(event.speed);
          engineState.canSpeed=true;engineState.lastSeen=Date.now();
          speedButtons();
          put('shRsgStatus','已確認 '+engineState.speed+'x 引擎倍率');
        }else put('shRsgStatus',String(event.reason||'倍率未套用').slice(0,80));
        return;
      }
    }
    if(e.data.__scarabProviderTelemetry!==true)return;
    var d=e.data.value||{},v={};
    ['pnl','balance','rtp','unopened'].forEach(function(k){if(d[k]!==null&&d[k]!==''&&Number.isFinite(Number(d[k])))v[k]=Number(d[k]);});
    lastData={at:Date.now(),value:v};render();
  });
  window.addEventListener('resize',function(){if(root&&!root.hidden){var r=root.getBoundingClientRect();if(r.right>innerWidth)root.style.left=Math.max(0,innerWidth-root.offsetWidth)+'px';if(r.bottom>innerHeight)root.style.top=Math.max(0,innerHeight-root.offsetHeight)+'px';}});
  window.setInterval(function(){if(active)render()},1100);
  mount();
})();