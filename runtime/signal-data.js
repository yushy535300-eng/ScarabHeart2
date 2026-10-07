/* Reads only current scene / current-game metadata. Never treats a launch target as a seated room. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.__SCARAB_SIGNAL_DATA=api;})(typeof window==='object'?window:globalThis,function(){
'use strict';
function normalizeRoom(value){
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const s=String(value).trim();const match=s.match(/^(?:房間|房號|機台|桌號|第|room|table)?\s*#?\s*(\d{1,6})\s*(?:號房|號桌|號|房|桌)?$/i);
 return match&&Number(match[1])>0?String(Number(match[1])):null;
}
function active(node){return node&&node.active!==false&&node.activeInHierarchy!==false;}
function nodes(w){let scene=null;try{scene=w.cc?.director?.getScene?.();}catch(_){}if(!scene)return [];const result=[],stack=[scene];while(stack.length&&result.length<16000){const n=stack.pop();if(!active(n))continue;result.push(n);const c=n.children||n._children||[];for(let i=c.length-1;i>=0;i--)stack.push(c[i]);}return result;}
function component(n,type){try{return type&&n.getComponent?.(type);}catch(_){return null;}}
function label(n,w){const c=component(n,w.cc?.Label)||component(n,'cc.Label');return c?.string??c?._string??null;}
function ancestors(n){const out=[];for(let i=0;n&&i<12;i++,n=n.parent)out.push(n);return out;}
function symbolId(frame){const name=frame?.name||frame?._name||'';const m=String(name).match(/^(?:symbol|sym)[_-]?(\d{1,2})(?:[_-](?:normal|idle|sprite|frame)(?:[_-]\d+)?)?$/i);return m&&+m[1]>0&&+m[1]<=99?'symbol_'+String(+m[1]).padStart(2,'0'):null;}
function validBoard(board){if(!board||typeof board!=='object')return false;const vals=Object.values(board);return vals.length>0&&vals.every(v=>Number.isInteger(v)&&v>=0)&&vals.reduce((a,b)=>a+b,0)<=30;}
function visibleInMask(n,w){try{const b=n.getBoundingBoxToWorld?.();if(!b)return true;const x=b.x+b.width/2,y=b.y+b.height/2;for(const parent of ancestors(n.parent)){const mask=component(parent,w.cc?.Mask);if(!mask||mask.enabled===false)continue;const r=parent.getBoundingBoxToWorld?.();if(r&&(x<r.x||y<r.y||x>r.x+r.width||y>r.y+r.height))return false;}return true;}catch(_){return true;}}
function getModel(w,name){try{return w.System?.get?.('chunks:///_virtual/'+name+'.ts')?.default||null;}catch(_){return null;}}
function platformRoom(w,board){if(!board)return null;try{const model=getModel(w,'PlatformModel'),d=model?.getData?.()||model?.data;const table=d?.table;if(table&&table.roomId!=null)return normalizeRoom(table.number);}catch(_){}return null;}
function componentBoard(w,list){
 for(const n of list){let components=n.components||n._components||[];if(!Array.isArray(components))continue;
 for(const c of components){if(!c||c.enabled===false||!c.symbolsMap||typeof c.symbolsMap.entries!=='function')continue;const counts={},positions=new Set();let bad=false;
 for(const [key,item]of c.symbolsMap.entries()){if(!item||!active(item.node))continue;const id=Number(item.symbolID),pos=Number(item.posId??key);if(!Number.isInteger(id)||id<1||id>99||!Number.isInteger(pos)||pos<0||pos>=30||positions.has(pos)){bad=true;break;}positions.add(pos);const symbol='symbol_'+String(id).padStart(2,'0');counts[symbol]=(counts[symbol]||0)+1;}
 if(!bad&&validBoard(counts))return {board:counts,source:'SymbolView.symbolsMap',candidateCount:positions.size,frames:[]};
 }}return null;
}
function readBoard(w,list){const live=componentBoard(w,list);if(live)return live;const counts={},frames=new Set(),positions=new Set();let candidateCount=0;
 for(const n of list){const chain=ancestors(n),path=chain.map(p=>p.name||'').join('/');if(/paytable|pay[_-]?table|help|rules|symbolPool|template/i.test(path))continue;
 const sprite=component(n,w.cc?.Sprite)||component(n,'cc.Sprite');if(!sprite||sprite.enabled===false||n.opacity===0)continue;const frame=sprite.spriteFrame||sprite._spriteFrame,id=symbolId(frame);if(/symbol|reel|roller|column|grid|board/i.test(path)&&frame&&(frame.name||frame._name)&&frames.size<30)frames.add(frame.name||frame._name);if(!id)continue;
 frames.add(frame.name||frame._name);if(!/symbol|reel|roller|column|grid|board/i.test(path))continue;candidateCount++;if(!visibleInMask(n,w))continue;
 let position=null;try{const b=n.getBoundingBoxToWorld?.();if(b&&b.width>0&&b.height>0)position=id+':'+Math.round(b.x+b.width/2)+':'+Math.round(b.y+b.height/2);}catch(_){}
 if(position&&positions.has(position))continue;if(position)positions.add(position);counts[id]=(counts[id]||0)+1;
 }
 if(validBoard(counts))return {board:counts,source:'cocos-visible-sprites',candidateCount,frames:[...frames].slice(0,30)};
 try{const legacy=w.__sethEngine?.readBoard?.();if(validBoard(legacy))return {board:legacy,source:'engine-readBoard',candidateCount,frames:[...frames].slice(0,30)};}catch(_){}
 return {board:null,source:'none',candidateCount,frames:[...frames].slice(0,30),error:Object.values(counts).reduce((a,b)=>a+b,0)>30?'too-many-symbols':'no-symbols'};
}
function mappedRoom(id,tables){if(id==null||!Array.isArray(tables))return null;const key=String(id).replace(/^.*_/, '');const matches=tables.filter(t=>String(t.roomId)===key).map(t=>normalizeRoom(t.number)).filter(Boolean);const unique=[...new Set(matches)];return unique.length===1?unique[0]:null;}
function modelRoom(w){
 const services=w.App?.serviceManager?.services;if(!Array.isArray(services))return null;const found=[];
 for(const service of services){if(!service?._client?._io?.connected)continue;const contexts=[service,service._client,service.currentSlotTable,service.slotTable,service._slotTable,service.model?.currentSlotTable,service.data?.currentSlotTable];
 for(const c of contexts){if(!c||typeof c!=='object')continue;for(const key of ['currentRoomId','currentSlotTableId','roomId','_roomId','slotTableId','_slotTableId']){const n=mappedRoom(c[key],w.__sethEngine?.tables);if(n)found.push(n);}for(const key of ['currentRoomNumber','currentTableNumber','slotTableNumber']){const n=normalizeRoom(c[key]);if(n)found.push(n);}}
 }
 const unique=[...new Set(found)];return unique.length===1?unique[0]:null;
}
function readRoom(w,list,board){const direct=platformRoom(w,board);if(direct)return {room:direct,source:'PlatformModel.table.number'};let v=null;try{v=normalizeRoom(w.__sethEngine?.seatedNum?.());}catch(_){}if(v)return {room:v,source:'engine-seatedNum'};
 const candidates=[];
 for(const n of list){const name=String(n.name||''),path=ancestors(n).map(p=>String(p.name||'')).join('/');if(/lobby|machineList|slotTableItem|paytable|help|rules/i.test(path))continue;
 const isButton=/slotTable2Btn|(?:current|seated)(?:Room|Table|Machine)/i.test(path);
 const isRoomLabel=/^(?:roomNumber|roomNo|tableNumber|machineNumber|slotTableNumber|currentRoomLabel|currentTableLabel)$/i.test(name);
 if(!isButton&&!isRoomLabel)continue;const r=normalizeRoom(label(n,w));if(r&&(isButton||board))candidates.push(r);
 }
 const unique=[...new Set(candidates)];if(unique.length===1)return {room:unique[0],source:'cocos-room-label'};
 const live=board&&modelRoom(w);if(live)return {room:live,source:'connected-game-room-model'};
 const packet=w.__SCARAB_SIGNAL_PACKET_ROOM;if(board&&packet?.room&&Date.now()-packet.at<120000)return {room:packet.room,source:'current-game-packet'};
 // The old engine only updates seated after it enters its real spin loop.

 return {room:null,source:'none',error:unique.length>1?'ambiguous-room':'no-room-label'};
}
function modelInstance(w,name){
 const m=getModel(w,name);if(!m)return null;
 // GameDataBase exports constructors; the active instances live in App.dataCenter.
 // SingletonT.get's second argument disables creation of an uninitialized instance.
 if(typeof m==='function'){try{const live=w.App?.dataCenter?.get?.(m,false);if(live)return live;}catch(_){}return m.ins||null;}
 return m.ins||m;
}
function roundState(w){try{const framework=modelInstance(w,'SlotFrameworkData'),game=modelInstance(w,'GameData');const phase=framework?.spinStatus??framework?.getData?.()?.spinStatus??framework?.data?.spinStatus;const d=game?.getData?.()||game?.data;const type=game?.currentGameType;const freeGame=type!=null?type==='freeGame'||type==='superFreeGame':!!w.__sethEngine?.freeGame;return {spinId:d?.spinId==null?null:String(d.spinId),settled:phase==='idle',phase:phase||'unknown',freeGame};}catch(_){return {spinId:null,settled:false,phase:'unknown'};}}
function autoState(w){
 const model=modelInstance(w,'AutoPlayModel'),panel=w.__sethEngine?.panel;
 const native=model?.active??model?.getData?.()?.active??model?.data?.active;
 return {native:typeof native==='boolean'?native:null,assistant:!!(panel?.autoWanted||panel?.freeAuto),remaining:model?.spinsRemaining??null};
}
function watchBoard(w,onComplete){
 const installed=new Map();
 function refresh(){for(const n of nodes(w))for(const c of n.components||n._components||[]){
  if(!c?.symbolsMap||typeof c.symbolsMap.entries!=='function')continue;
  for(const name of ['showSymbolsIn','showSymbolsQuickIn','showNewSymbolFall']){
   if(typeof c[name]!=='function')continue;
   const key=c;let methods=installed.get(key);if(!methods){methods=new Map();installed.set(key,methods);}
   if(methods.get(name)?.wrapped===c[name])continue;
   const original=c[name];
   const wrapped=function(callback,...args){
    if(typeof callback!=='function')return original.call(this,callback,...args);
    let completed=false;
    const done=function(...values){if(completed)return;completed=true;let hold=false;try{hold=onComplete()===true;}catch(error){w.__SCARAB_SIGNAL_EVENT_ERROR=String(error);}
     const resume=()=>callback.apply(this,values);
     if(hold){(w.__SCARAB_SIGNAL_PENDING_CONTINUATIONS||(w.__SCARAB_SIGNAL_PENDING_CONTINUATIONS=[])).push(resume);return;}
     return resume();
    };
    return original.call(this,done,...args);
   };
   methods.set(name,{original,wrapped});c[name]=wrapped;
  }
 }}
 function dispose(){for(const [c,methods]of installed)for(const [name,entry]of methods)if(c[name]===entry.wrapped)c[name]=entry.original;installed.clear();}
 refresh();return {refresh,dispose};
}
function watchFreeFinish(w,onFinish){
 const installed=new Map();
 function refresh(){for(const n of nodes(w))for(const c of n.components||n._components||[]){
  if(typeof c?.finishFreeGame!=='function'||typeof c?.goToMainGame!=='function')continue;
  if(installed.get(c)?.wrapped===c.finishFreeGame)continue;
  const original=c.finishFreeGame;
  const wrapped=function(...args){const result=original.apply(this,args);try{onFinish();}catch(error){w.__SCARAB_SIGNAL_EVENT_ERROR=String(error);}return result;};
  installed.set(c,{original,wrapped});c.finishFreeGame=wrapped;
 }}
 function dispose(){for(const [c,e]of installed)if(c.finishFreeGame===e.wrapped)c.finishFreeGame=e.original;installed.clear();}
 refresh();return {refresh,dispose};
}
async function stopAuto(w){
 const source=autoState(w);w.__SCARAB_SIGNAL_AUTO_SOURCE=source;const engine=w.__sethEngine;try{if(engine?.panel){engine.panel.autoWanted=false;engine.panel.freeAuto=false;}engine?.setFreeAuto?.(false);}catch(_){}
 // Disable the actual game queue synchronously, before idle handlers schedule another spin.
 try{const model=modelInstance(w,'AutoPlayModel');if(model&&'active' in model)model.active=false;if(model&&'spinsRemaining' in model)model.spinsRemaining=0;}catch(_){}
 let sent=false;try{const event=w.System?.get?.('chunks:///_virtual/SlotFrameworkEvent.ts')?.SlotFrameworkEvent?.STOP_AUTO_SPIN;if(event&&typeof w.dispatch==='function'){w.dispatch(event);sent=true;}}catch(_){}
 try{if(typeof engine?.stopAuto==='function'){Promise.resolve(engine.stopAuto()).catch(()=>{});sent=true;}}catch(_){}
 for(let i=0;i<30;i++){if(i>0){try{const event=w.System?.get?.('chunks:///_virtual/SlotFrameworkEvent.ts')?.SlotFrameworkEvent?.STOP_AUTO_SPIN;if(event&&typeof w.dispatch==='function')w.dispatch(event);}catch(_){}}const model=modelInstance(w,'AutoPlayModel');const value=model?.active??model?.getData?.()?.active??model?.data?.active;if(value===false)return {stopped:true,sent};await new Promise(resolve=>setTimeout(resolve,100));}
 return {stopped:false,sent};
}
function sample(w){const list=nodes(w),b=readBoard(w,list),r=readRoom(w,list,b.board);return {...b,room:r.room,roomSource:r.source,boardSource:b.source,roomError:r.error||null,nodeCount:list.length,engineReady:!!w.__sethEngine};}
function packetRoom(packet,tables){if(!packet||typeof packet!=='object'||(packet.status!=null&&packet.status!==200))return null;if(!['initial','spin','closeSpin'].includes(packet.eventName))return null;const contexts=[packet,packet.engine,packet.slotTable,packet.engine?.slotTable,packet.currentSlotTable,packet.engine?.currentSlotTable];const values=[];for(const c of contexts){if(!c||typeof c!=='object'||Array.isArray(c))continue;for(const key of ['roomId','slotTableId','currentRoomId','currentSlotTableId']){const n=mappedRoom(c[key],tables);if(n)values.push(n);}for(const key of ['slotTableNumber','machineNumber','tableNumber','roomNumber','roomNo']){const n=normalizeRoom(c[key]);if(n)values.push(n);}}
 const unique=[...new Set(values)];return unique.length===1?unique[0]:null;
}
return {normalizeRoom,symbolId,validBoard,sample,packetRoom,roundState,autoState,watchBoard,watchFreeFinish,stopAuto};
});
