/* ScarabHeart ATG recommendation probe v3.08
   Reads real machine identities from the parser-blocking ATG room tap. For
   zlib titles it also keeps a transport fallback; encrypted titles are read
   after ATG's own framework has decoded InitialModel / SlotTableModel. */
(function () {
  'use strict';
  if (window.__scarabRecommendationProbeInstalled) return;
  window.__scarabRecommendationProbeInstalled = true;

  var gameCode = String(window.__SC_GAME_CODE || '');
  var started = Date.now();
  var sent = false;
  var collectStarted = false, collectDone = false;
  var fallbackRows = new Map();
  var NativeWebSocket = window.WebSocket;

  function n(v) { var x = Number(v); return Number.isFinite(x) ? x : 0; }
  function first(o, ks) { for (var i=0;i<ks.length;i++){try{var v=o&&o[ks[i]];if(v!=null&&v!=='')return v}catch(_){}} return null; }
  function digits(v) { if(v==null)return'';var s=String(v).trim().replace(/^#/,'');var m=s.match(/^0*(\d{1,6})$/);return m?String(Number(m[1])):''; }
  function normalize(t) {
    if(!t||typeof t!=='object')return null;
    var b=t.table&&typeof t.table==='object'?Object.assign({},t,t.table):t;
    var m=digits(first(b,['machineNum','machineNo','machineNumber','machine_num','number','num','tableNo','tableNumber','no']));
    if(!m)return null;
    var r=first(b,['roomId','roomID','room_id','tableId','tableID','table_id','rid']);
    r=r==null?'':String(r).trim();
    if(!/^\d+$/.test(r))return null;
    var td=b.today&&typeof b.today==='object'?b.today:{};
    var status=String(first(b,['status','state','roomStatus','tableStatus'])||'');
    return {roomId:r,machineNum:m,status:status,isLocked:!!first(b,['isLocked','locked','disabled'])||/locked|close|maintenance/i.test(status),todayBet:n(first(td,['bet','amount','stake'])??first(b,['todayBet','betToday'])),todayWin:n(first(td,['win','payout','award'])??first(b,['todayWin','winToday'])),bet:n(first(b,['bet','stake','amount','totalBet'])),win:n(first(b,['win','payout','award','totalWin']))};
  }
  function inspect(v,depth,seen){
    if(!v||typeof v!=='object'||depth>8)return;
    if(seen)try{if(seen.has(v))return;seen.add(v)}catch(_){}
    var row=normalize(v);if(row)fallbackRows.set(row.machineNum,row);
    if(Array.isArray(v)){for(var i=0;i<v.length&&i<3000;i++)inspect(v[i],depth+1,seen);return;}
    var direct=null;try{direct=Array.isArray(v.tables)?v.tables:(v.data&&Array.isArray(v.data.tables)?v.data.tables:null)}catch(_){}
    if(direct)for(var q=0;q<direct.length;q++){var rr=normalize(direct[q]);if(rr)fallbackRows.set(rr.machineNum,rr)}
    var keys;try{keys=Object.keys(v)}catch(_){return}
    for(var j=0;j<keys.length&&j<180;j++){var k=keys[j];if(/^(parent|_parent|node|_node|children|_children)$/i.test(k))continue;try{inspect(v[k],depth+1,seen)}catch(_){}}
  }
  function tapRows(){
    try { var tap=window.__SCARAB_ATG_ROOM_TAP;if(tap&&typeof tap.scan==='function')tap.scan();if(tap&&typeof tap.getTables==='function')return tap.getTables()||[]; } catch (_) {}
    return [];
  }
  function rows(){
    var list=tapRows();
    if(list&&list.length)return list;
    return Array.from(fallbackRows.values());
  }
  function publish(force,source){
    if(sent)return false;
    var list=rows().filter(function(r){return r&&/^\d+$/.test(String(r.machineNum||''))&&/^\d+$/.test(String(r.roomId||''))});
    if(!list.length)return false;
    if(!force&&list.length<10)return false;
    sent=true;
    var meta=null;try{meta=window.__SCARAB_ATG_ROOM_TAP&&window.__SCARAB_ATG_ROOM_TAP.tableMeta||null}catch(_){}
    try{parent.postMessage({__scarabRecommendationProbe:true,ok:true,gameCode:gameCode,source:source||'ATG_FRAMEWORK_TABLE_MODEL',capturedAt:Date.now(),tableMeta:meta,tables:list},location.origin)}catch(_){}
    return true;
  }

  // Transport fallback for titles whose room table is zlib-compressed. The
  // actual ATG packet starts with one binary attachment marker byte (0x04).
  function parseText(text,source){
    if(!text)return;var s=String(text),starts=[s.indexOf('{'),s.indexOf('[')].filter(function(x){return x>=0}).sort(function(a,b){return a-b});if(!starts.length)return;
    try{var data=JSON.parse(s.slice(starts[0]));inspect(data,0,new WeakSet());publish(false,source)}catch(_){}
  }
  async function inspectBinary(data){
    try{
      var buf=data instanceof ArrayBuffer?data:(data&&typeof data.arrayBuffer==='function'?await data.arrayBuffer():null);if(!buf)return;
      var bytes=new Uint8Array(buf),variants=[bytes];if(bytes.length>1&&bytes[0]===4)variants.unshift(bytes.slice(1));
      if(typeof DecompressionStream!=='undefined'){
        for(var vi=0;vi<variants.length;vi++)for(const type of ['deflate','deflate-raw','gzip']){try{var stream=new Blob([variants[vi]]).stream().pipeThrough(new DecompressionStream(type));var text=await new Response(stream).text();parseText(text,'ATG_WS_'+type);if(fallbackRows.size>=10)return}catch(_){}}
      }
      for(var x=0;x<variants.length;x++)try{parseText(new TextDecoder().decode(variants[x]),'ATG_WS_TEXT')}catch(_){}
    }catch(_){}
  }
  function observe(e){try{if(typeof e.data==='string')parseText(e.data,'ATG_WS_TEXT');else inspectBinary(e.data)}catch(_){} }
  try{
    var add=NativeWebSocket&&NativeWebSocket.prototype&&NativeWebSocket.prototype.addEventListener;
    if(typeof add==='function'){
      var Old=window.WebSocket;
      window.WebSocket=function(url,protocols){var ws=protocols?new Old(url,protocols):new Old(url);try{add.call(ws,'message',observe)}catch(_){}return ws};
      window.WebSocket.prototype=Old.prototype;
      ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){try{Object.defineProperty(window.WebSocket,k,{value:Old[k],configurable:true})}catch(_){}});
    }
  }catch(_){}

  window.addEventListener('scarab:atg-tables',function(e){try{inspect(e.detail,0,new WeakSet());publish(false,'ATG_FRAMEWORK_TABLE_MODEL')}catch(_){} });
  var timer=setInterval(function(){
    var tap=null;
    try{tap=window.__SCARAB_ATG_ROOM_TAP;if(tap&&typeof tap.scan==='function')tap.scan()}catch(_){}
    try{
      if(tap&&!collectStarted&&tap.tableMeta&&Number(tap.tableMeta.totalPages||1)>1&&typeof tap.collectAllPages==='function'){
        collectStarted=true;
        Promise.resolve(tap.collectAllPages()).then(function(){collectDone=true;publish(true,'ATG_NATIVE_ALL_PAGES')}).catch(function(){collectDone=true});
      }
    }catch(_){}
    var age=Date.now()-started;
    // Single-page games publish immediately. Multi-page games wait briefly for
    // the native page collector so tiger/hades recommendations can see all pages.
    if((!collectStarted||collectDone||age>14000)&&publish(false,'ATG_FRAMEWORK_TABLE_MODEL')){clearInterval(timer);return;}
    if(age>16000&&publish(true,'ATG_FRAMEWORK_PARTIAL')){clearInterval(timer);return;}
    if(age>32000){clearInterval(timer);if(!sent)try{parent.postMessage({__scarabRecommendationProbe:true,ok:false,gameCode:gameCode,error:'ATG 真實機台資料尚未完成同步'},location.origin)}catch(_){}}
  },160);
})();
