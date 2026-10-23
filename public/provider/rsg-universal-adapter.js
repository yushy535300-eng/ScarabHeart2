/* RSG common engine adapter: only supports controls verified on the live
 * engine instance. Does not forge balance, PNL, RTP, game rounds or result data.
 * Does not alter RSG requests or intercept input. */
(function(){
 'use strict';
 if(window.__scarabRsgUniversalAdapter)return;
 window.__scarabRsgUniversalAdapter=true;
 var valid=/^\/(?:Web\/SlotGame\d+)(?:\/|$)/i.test((function(){try{return new URL(window.__SCARAB_ORIGINAL_URL||location.href).pathname}catch(_){return location.pathname}})());
 if(!valid)return;
 var lastSig='',lastReportedAt=0;
 function origin(){return location.origin;}
 function send(event){try{parent.postMessage(Object.assign({__scarabRsgEngine:true,provider:'rsg'},event),origin())}catch(_){}}
 function adapter(){
   // Some RSG games render inside an additional same-origin child iframe.
   // Read only documented engine handles and never traverse cross-origin data.
   var frames=[window],seen=[];
   for(var index=0;index<frames.length&&frames.length<=12;index++){
     var context=frames[index];if(seen.indexOf(context)>=0)continue;seen.push(context);
     try {
       var cc=context.cc;
       var sch=cc&&cc.director&&typeof cc.director.getScheduler==='function'&&cc.director.getScheduler();
       if(sch&&typeof sch.setTimeScale==='function'&&typeof sch.getTimeScale==='function'){
         var value=sch.getTimeScale();
         if(Number.isFinite(Number(value))&&Number(value)>0)
           return {name:'Cocos Scheduler',read:function(){return Number(sch.getTimeScale())},
             write:function(n){sch.setTimeScale(n);return Number(sch.getTimeScale())}};
       }
       var lay=context.Laya;
       if(lay&&lay.timer&&Number.isFinite(Number(lay.timer.scale))&&Number(lay.timer.scale)>0){
         var timer=lay.timer;
         return {name:'Laya Timer',read:function(){return Number(timer.scale)},
           write:function(n){timer.scale=n;return Number(timer.scale)}};
       }
     }catch(_){}
     try {
       for(var i=0;i<context.frames.length&&frames.length<12;i++){
         var child=context.frames[i];
         if(child&&child.location&&child.location.origin===location.origin)frames.push(child);
       }
     }catch(_){}
   }
   return null;
 }
 function report(force){
   var a=adapter(),key=a?a.name:'unavailable';
   if(!force&&key===lastSig&&Date.now()-lastReportedAt<2800)return;
   lastSig=key;lastReportedAt=Date.now();
   send({type:'capabilities',canSpeed:!!a,adapter:a&&a.name||'',speed:a?a.read():null});
 }
 window.addEventListener('message',function(event){
   if(event.source!==parent||event.origin!==origin())return;
   var d=event.data;
   if(!d||d.__scarabRsgControl!==true||d.action!=='speed')return;
   var n=Number(d.value),id=String(d.requestId||'');
   if(![1,2,4,8].includes(n))return send({type:'speedAck',requestId:id,success:false,reason:'無效倍率'});
   var a=adapter();
   if(!a)return send({type:'speedAck',requestId:id,success:false,reason:'此遊戲尚未偵測到可驗證的加速引擎'});
   try{
     var after=a.write(n);
     var ok=Number.isFinite(after)&&Math.abs(after-n)<0.01;

     send({type:'speedAck',requestId:id,success:ok,speed:ok?after:null,
       adapter:a.name,reason:ok?'引擎倍率已套用':'引擎沒有確認倍率'});
   }catch(_){send({type:'speedAck',requestId:id,success:false,reason:'此遊戲引擎拒絕變更倍率'})}
 });
 report(true);
 var timer=setInterval(function(){if(document.visibilityState!=='hidden')report(false)},1100);
 window.addEventListener('pagehide',function(){clearInterval(timer)},{once:true});
})();