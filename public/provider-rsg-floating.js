/* Shared RSG overlay: runs OUTSIDE the game iframe, so it cannot intercept
   Cocos input or change any original RSG resources. All RSG SlotGame pages
   receive the same panel; Thor keeps its separate native-specific HUD. */
(function(){
  'use strict';
  var root, title, details, mini=false, dragging=false, pointId=null;
  var offsetX=0,offsetY=0,started=false;
  var state='closed';
  function ensure(){
    if(root)return root;
    var view=document.getElementById('gameView');if(!view)return null;
    var style=document.createElement('style');
    style.textContent=
      '#scarabRsgFloating{position:absolute;z-index:8;top:calc(env(safe-area-inset-top,0px) + 78px);left:12px;width:218px;max-width:calc(100vw - 24px);border:1px solid #e3b65e;border-radius:14px;background:linear-gradient(150deg,rgba(7,27,45,.97),rgba(4,10,21,.96));box-shadow:0 0 20px rgba(23,147,220,.27),0 8px 28px rgba(0,0,0,.55);color:#f6dd9d;font:500 12px/1.4 system-ui,"Noto Sans TC",sans-serif;overflow:hidden;box-sizing:border-box;touch-action:auto}'+
      '#scarabRsgFloating[hidden]{display:none!important}'+
      '#scarabRsgFloating .srhud-head{min-height:42px;display:flex;align-items:center;gap:7px;padding:0 9px;cursor:grab;touch-action:none;user-select:none;background:linear-gradient(110deg,#17436a,#091728)}'+
      '#scarabRsgFloating .srhud-head:active{cursor:grabbing}'+
      '#scarabRsgFloating .srhud-gem{color:#ffd674;font-size:19px}'+
      '#scarabRsgFloating .srhud-title{flex:1;min-width:0;white-space:nowrap;font-weight:800;font-size:13px}'+
      '#scarabRsgFloating .srhud-toggle{border:1px solid rgba(217,179,100,.3);border-radius:7px;min-width:30px;min-height:30px;color:#ffe3a3;background:rgba(1,9,18,.55);font-size:15px;cursor:pointer}'+
      '#scarabRsgFloating .srhud-body{padding:11px 10px 12px;display:flex;flex-direction:column;gap:10px}'+
      '#scarabRsgFloating .srhud-detail{color:#a6c5db;font-size:11px}'+
      '#scarabRsgFloating .srhud-back{min-height:39px;padding:6px 10px;border:1px solid #bd9459;border-radius:9px;background:linear-gradient(110deg,#243e53,#142639);color:#ffe6ae;font:700 12px system-ui,"Noto Sans TC",sans-serif;cursor:pointer}'+
      '#scarabRsgFloating .srhud-back:focus-visible,#scarabRsgFloating .srhud-toggle:focus-visible{outline:2px solid #8bebff;outline-offset:2px}'+
      '#scarabRsgFloating.srhud-mini{width:145px}'+
      '#scarabRsgFloating.srhud-mini .srhud-body{display:none}'+
      '@media(max-width:600px){#scarabRsgFloating{width:184px;top:calc(env(safe-area-inset-top,0px) + 65px);left:8px}#scarabRsgFloating .srhud-body{padding:8px}#scarabRsgFloating.srhud-mini{width:136px}}';
    document.head.appendChild(style);
    root=document.createElement('section');root.id='scarabRsgFloating';root.hidden=true;
    root.setAttribute('aria-label','RSG 懸浮面板');
    var head=document.createElement('div');head.className='srhud-head';
    var gem=document.createElement('span');gem.className='srhud-gem';gem.textContent='✦';
    title=document.createElement('span');title.className='srhud-title';title.textContent='RSG 遊戲輔助';
    var toggle=document.createElement('button');toggle.type='button';toggle.className='srhud-toggle';
    toggle.title='收合或展開 RSG 懸浮面板';toggle.textContent='−';
    toggle.addEventListener('click',function(e){e.stopPropagation();mini=!mini;root.classList.toggle('srhud-mini',mini);toggle.textContent=mini?'+':'−';});
    head.append(gem,title,toggle);root.appendChild(head);
    var body=document.createElement('div');body.className='srhud-body';
    details=document.createElement('div');details.className='srhud-detail';
    details.textContent='RSG 遊戲已開啟';
    var back=document.createElement('button');back.type='button';back.className='srhud-back';
    back.textContent='‹ 返回 RSG 選遊戲';
    back.addEventListener('click',function(){
      if(window.ScarabWebLauncher&&window.ScarabWebLauncher.returnToRsgLobby&&window.ScarabWebLauncher.returnToRsgLobby())return;
      if(details)details.textContent='正在確認 RSG 大廳，請用右上角返回';
    });
    body.append(details,back);root.appendChild(body);view.appendChild(root);
    head.addEventListener('pointerdown',function(e){
      if(e.target===toggle||e.target.closest('button'))return;
      dragging=true;pointId=e.pointerId;
      var r=root.getBoundingClientRect();offsetX=e.clientX-r.left;offsetY=e.clientY-r.top;
      head.setPointerCapture(e.pointerId);e.preventDefault();
    });
    head.addEventListener('pointermove',function(e){
      if(!dragging||e.pointerId!==pointId)return;
      var w=root.offsetWidth,h=root.offsetHeight,sw=window.innerWidth,sh=window.innerHeight;
      root.style.left=Math.max(0,Math.min(sw-w,e.clientX-offsetX))+'px';
      root.style.top=Math.max(0,Math.min(sh-h,e.clientY-offsetY))+'px';
    });
    function release(e){if(e.pointerId!==pointId)return;dragging=false;pointId=null;}
    head.addEventListener('pointerup',release);head.addEventListener('pointercancel',release);
    return root;
  }
  function update(next){
    if(!/^(?:game|lobby|closed|loading)$/.test(String(next)))return;
    state=next;
    var panel=ensure();if(!panel)return;
    var frameVisible=!!document.getElementById('gameView')&&!document.getElementById('gameView').classList.contains('hide');
    panel.hidden=!(state==='game'&&frameVisible);
    if(!panel.hidden&&details) details.textContent='RSG 遊戲進行中 · 拖曳標題可移動';
  }
  window.addEventListener('scarab:rsg-page',function(e){update(e.detail&&e.detail.page)});
  window.addEventListener('resize',function(){
    if(!root||root.hidden)return;
    var rect=root.getBoundingClientRect();
    if(rect.right>innerWidth)root.style.left=Math.max(0,innerWidth-root.offsetWidth-8)+'px';
    if(rect.bottom>innerHeight)root.style.top=Math.max(0,innerHeight-root.offsetHeight-8)+'px';
  });
  // Explicit initialization keeps this script inert for ATG and Lunar Rabbit.
  ensure();
})();