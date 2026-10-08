(function(){
  'use strict';
  if(window.__scarabStabilityRuntimeStarted) return;
  window.__scarabStabilityRuntimeStarted=true;

  var style=document.createElement('style');
  style.textContent='#scarab-heart-ui{pointer-events:none!important}#scarab-heart-ui #scPanel,#scarab-heart-ui .scPane,#scarab-heart-ui button,#scarab-heart-ui input,#scarab-heart-ui select,#scarab-heart-ui textarea{pointer-events:auto!important}';
  (document.head||document.documentElement).appendChild(style);

  function engine(){ return window.__sethEngine||null; }
  // Cap Red Three Kingdoms at the engine boundary as well as its buttons.
  function limitGameSpeed(){
    if(window.__SC_GAME_CODE!=='scarlet-three-kingdoms')return;
    var e=engine();if(!e||typeof e.setSpeed!=='function')return;
    if(!e.setSpeed.__scarabRed3kLimit){
      var original=e.setSpeed;
      var limited=function(v){if([1,2,4].indexOf(Number(v))<0)return false;return original.apply(this,arguments);};
      limited.__scarabRed3kLimit=true;e.setSpeed=limited;
    }
    if(Number(e.speed)>4)e.setSpeed(4);
  }
  limitGameSpeed();
  function keyForSpeed(v){
    v=Number(v);
    if(v===999||v===32) return 'max';
    return [1,2,4,8,16].indexOf(v)>=0?String(v):null;
  }
  function syncSpeedVisual(){
    var e=engine();
    if(!e) return;
    var requested=Number(e.speed);
    var key=keyForSpeed(requested);
    if(!key&&typeof e.getTimeScale==='function') key=keyForSpeed(e.getTimeScale());
    if(!key) return;
    var buttons=document.querySelectorAll('#scarab-heart-ui [data-sp]');
    for(var i=0;i<buttons.length;i++){
      var yes=String(buttons[i].dataset.sp)===key;
      buttons[i].classList.toggle('on',yes);
      buttons[i].classList.toggle('speedActive',yes);
      buttons[i].setAttribute('aria-pressed',yes?'true':'false');
    }
  }

  function keepInsideViewport(){
    var host=document.getElementById('scarab-heart-ui');
    if(!host) return;
    try{
      var r=host.getBoundingClientRect();
      var x=Math.min(Math.max(0,r.left),Math.max(0,innerWidth-r.width));
      var y=Math.min(Math.max(0,r.top),Math.max(0,innerHeight-r.height));
      if(Math.abs(x-r.left)>1||Math.abs(y-r.top)>1){host.style.left=x+'px';host.style.top=y+'px';host.style.right='auto';host.style.bottom='auto';}
    }catch(_){}
  }

  var timer=setInterval(function(){
    try{ limitGameSpeed(); syncSpeedVisual(); keepInsideViewport(); }catch(_){}
  },900);
  addEventListener('resize',keepInsideViewport,{passive:true});
  addEventListener('orientationchange',function(){setTimeout(keepInsideViewport,180);},{passive:true});
  addEventListener('pagehide',function(){clearInterval(timer);},{once:true});
})();
