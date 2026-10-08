(function(){
'use strict';
if(window.__SCARAB_SIGNALS)return;
const game=window.__SC_GAME_CODE;
if(!['golden-seth','egyptian-mythology','tiger-princess'].includes(game))return;
window.__SCARAB_SIGNALS=true;
let room='',rule=null,enabled=true,board=null,signature='',stableAt=0,strength=null,spin=0,lastSpinAt=0,notified=-1,request=0,lastFetch=0,history=[],mode='mini',lastRoomAt=0,scoredSignature='',lastDragAt=0;
let confirmedRoom=false,entrySpinId=null,entryCaptured=false,alertLocked=false,pendingRotation=null,rotating=false,lastRotateTry=0;
const seen=new Set();let round={spinId:null,settled:false},alertVersion=0;
const host=document.createElement('div');host.id='sc-signal';
host.innerHTML=`<style>
#sc-signal{position:fixed;left:12px;top:100px;z-index:2147483647;color:#eaf7ff;font:14px system-ui,sans-serif;font-weight:500;max-width:calc(100vw - 24px)}#sc-signal *{box-sizing:border-box}#sc-signal [hidden]{display:none!important}#sc-signal .shell{width:620px;max-width:calc(100vw - 24px);background:rgba(5,19,29,.96);border:1px solid #36d9ee;border-radius:20px;box-shadow:0 12px 30px #0005}#sc-signal .head{padding:14px;background:rgba(13,34,49,.95);border-radius:14px 14px 0 0;touch-action:none;cursor:move;display:flex;align-items:center;justify-content:space-between}#sc-signal .room{font-size:12px;color:#9cd7ef;margin-top:7px}#sc-signal button{font:inherit;color:#eaf7ff;background:#173a50;border:1px solid #32627c;border-radius:8px;padding:9px 12px;cursor:pointer}#sc-signal .close{background:none;border:0;padding:5px 9px}#sc-signal .body{padding:14px}#sc-signal .row{display:flex;justify-content:space-between;align-items:center;gap:10px}#sc-signal .content{display:grid;grid-template-columns:3fr 2fr;gap:16px;margin:16px 0}#sc-signal .symbols{display:flex;gap:8px;align-items:center;justify-content:space-around}#sc-signal .symbol{flex:1;min-width:0;text-align:center}#sc-signal img{width:100%;height:65px;object-fit:contain;background:none;display:block;margin:0 auto 8px}#sc-signal .count{font-weight:600}#sc-signal .current,#sc-signal .note{font-size:12px;color:#93c8df;margin-top:10px}#sc-signal .score{font-size:21px;color:#4de0ff}#sc-signal .track{height:5px;background:#203c4b;border-radius:5px;margin:10px 0}#sc-signal .fill{height:100%;width:0;background:#4de0ff;border-radius:5px;transition:width .4s}#sc-signal .status{padding:12px;margin-top:14px;border-radius:9px;background:#102f38;color:#65e6eb;text-align:center}#sc-signal .foot{border-top:1px solid #2d5268;padding-top:10px;display:flex;justify-content:space-between;align-items:center}#sc-signal summary{cursor:pointer;color:#9cd7ef}#sc-signal .logs{font-size:12px;color:#b6d5e2;padding:8px 0;overflow-wrap:anywhere}#sc-signal .mini{width:245px;padding:12px;background:#101b2e;border:1px solid #29405e;border-radius:18px;box-shadow:0 12px 30px #0005}#sc-signal .mini .head{padding:0;background:none}#sc-signal .mini .symbols{margin:12px 0}#sc-signal .mini img{height:38px;margin-bottom:6px}#sc-signal .mini .score{font-size:16px}#sc-signal .mini .row{margin-top:12px;font-size:12px}#sc-signal .toast{position:fixed;left:50%;top:12%;transform:translateX(-50%);width:460px;max-width:calc(100vw - 24px);z-index:2147483647;background:#102637;border:1px solid #3b939e;border-radius:10px;padding:12px;color:#b8faff}#sc-signal .hit{box-shadow:0 0 18px #42dae855}#sc-signal .mini-status{font-size:12px;color:#9cd7ef}@media(max-width:480px){#sc-signal .content{grid-template-columns:1fr}#sc-signal img{height:52px}}@media(prefers-reduced-motion:reduce){#sc-signal .fill{transition:none}}

#sc-signal{font-family:-apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif;color:#edf7ff}
#sc-signal .shell{padding:18px;border-radius:22px;background:linear-gradient(180deg,#071a29,#06121d);border:1px solid rgba(72,219,255,.48);border-top:2px solid #55dfff;box-shadow:0 24px 70px rgba(0,0,0,.72),inset 0 1px 0 rgba(255,255,255,.04);backdrop-filter:blur(12px)}
#sc-signal .shell .head{padding:2px 2px 13px;background:transparent;border-radius:0}
#sc-signal .shell .head b{font-size:15px;font-weight:900;letter-spacing:1.4px;color:#f0f9ff}
#sc-signal .body{padding:0}#sc-signal .room{color:#7895aa}
#sc-signal button{border:1px solid #294a62;border-radius:14px;background:#081725;color:#dff4ff;font-size:14px;font-weight:800;min-height:40px}
#sc-signal .close{background:transparent;border:0;min-height:32px}
#sc-signal .toggle{min-width:76px;height:40px;border-radius:999px;border-color:#3b5365;background:#111b24;color:#9aabb7;font-weight:900}
#sc-signal .toggle[aria-pressed="true"]{background:linear-gradient(135deg,#178dff,#38c8ff);color:#fff;border-color:#65d8ff;box-shadow:0 0 12px rgba(36,174,255,.38)}
#sc-signal .status{border:1px solid #1d7270;border-radius:12px;background:#051622;color:#65e6bb;text-align:left}
#sc-signal .foot{border-color:#173247}#sc-signal .count{font-size:18px;font-weight:800;color:#dff4ff}
#sc-signal .mini{background:linear-gradient(160deg,rgba(4,13,25,.86),rgba(2,7,14,.91));border-color:rgba(75,220,255,.42);backdrop-filter:blur(12px)}

#sc-signal .signal-title{display:flex;align-items:center;gap:14px;flex-wrap:wrap}#sc-signal .title-detection{font-size:12px;color:#9cd7ef;font-weight:500;letter-spacing:0}
#sc-signal .detect-label{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
#sc-signal .detect-dot{width:7px;height:7px;flex:none;border-radius:50%;background:#45e99b;box-shadow:0 0 5px #45e99b,0 0 10px #45e99b80;animation:sc-signal-breathe 2.4s ease-in-out infinite}
#sc-signal .detect-dot.off{background:#728594;box-shadow:none;animation:none}
@keyframes sc-signal-breathe{0%,100%{opacity:.5;box-shadow:0 0 3px #45e99b60}50%{opacity:1;box-shadow:0 0 6px #45e99b,0 0 12px #45e99b80}}
@media(prefers-reduced-motion:reduce){#sc-signal .detect-dot{animation:none}}

#sc-signal .toast{top:50%;transform:translate(-50%,-50%);width:430px;border:1px solid #36d9ee;border-radius:20px;padding:22px;background:linear-gradient(145deg,rgba(12,35,49,.98),rgba(5,19,29,.98));box-shadow:0 20px 60px #0009,0 0 28px #36d9ee18;color:#eaf7ff}
#sc-signal .toast h3{font-size:21px;letter-spacing:.5px;color:#eaf7ff}
#sc-signal .toast p{font-size:13px;color:#93c8df;margin:8px 0 16px}
#sc-signal .toast .symbols{padding:14px 0;border-top:1px solid #2d5268;border-bottom:1px solid #2d5268;margin-bottom:16px}
#sc-signal .toast img{height:64px;object-fit:contain}
#sc-signal .toast p.stop-state{color:#70e6b2;font-size:16px;font-weight:600;margin:16px 0}
#sc-signal .toast .note{white-space:nowrap;font-size:clamp(9px,2.5vw,12px)}
#sc-signal .toast .row button{flex:1;border-radius:12px;padding:11px}
#sc-signal .toast .row button:first-child{background:#169cde;border-color:#39d9ff;box-shadow:0 0 12px #25bdff30}
#sc-signal img.brand-logo{width:30px;height:30px;flex:0 0 30px;object-fit:contain;margin:0;background:none}
#sc-signal .mini-brand,#sc-signal .alert-heading{display:flex;align-items:center;gap:8px}
#sc-signal .mini-brand{min-width:0;flex:1}#sc-signal .mini-brand .room{margin:0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#sc-signal .toast .brand-logo{width:36px;height:36px;flex-basis:36px}
#sc-signal .alert-heading h3{margin:0!important}
#sc-signal .signal-modal{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:rgba(0,8,15,.55);color:inherit;z-index:2147483647}
#sc-signal .signal-modal:not([open]){display:none}
#sc-signal .signal-modal::backdrop{background:rgba(0,8,15,.4)}
@media(max-width:900px),(max-height:500px){
#sc-signal .mini{width:195px;padding:9px;border-radius:13px}
#sc-signal .mini .symbols{gap:3px;margin:8px 0}
#sc-signal .mini img:not(.brand-logo){height:30px;margin-bottom:4px}
#sc-signal .mini .count{font-size:13px}
#sc-signal .mini .brand-logo{width:22px;height:22px;flex-basis:22px}
#sc-signal .mini .mini-brand{gap:5px}
#sc-signal .mini .room{font-size:10px}
#sc-signal .mini .row{margin-top:8px;font-size:11px;gap:4px}
#sc-signal .mini .score{font-size:14px}
#sc-signal .mini .expand{padding:5px 8px;min-height:30px}
#sc-signal .mini .mini-status{font-size:10px}
#sc-signal .mini .note{font-size:8px;white-space:nowrap;margin-top:7px}

#sc-signal .shell{padding:12px;border-radius:17px}
#sc-signal .shell .head{padding-bottom:8px}
#sc-signal .shell .head b{font-size:14px;letter-spacing:.5px}
#sc-signal .shell .signal-title{gap:7px}
#sc-signal .shell .content{grid-template-columns:1fr;gap:9px;margin:10px 0}
#sc-signal .shell img:not(.brand-logo){height:46px;margin-bottom:5px}
#sc-signal .shell .count{font-size:16px}
#sc-signal .shell .current{margin-top:5px;font-size:11px}
#sc-signal .shell .note{margin-top:6px}
#sc-signal .shell .score{font-size:18px}
#sc-signal .shell button{min-height:34px;padding:6px 9px}
#sc-signal .shell .toggle{height:34px}
#sc-signal .shell .track{margin:7px 0}
}
</style><section class="shell" hidden><header class="head"><div><div class="signal-title"><img class="brand-logo" src="/media/scarab-logo.webp" alt="聖甲之心"><b>訊號推薦</b><span class="detect-label title-detection"><span class="detect-text">偵測中</span><span class="detect-dot" aria-hidden="true"></span></span></div><div class="room">等待房間資料</div></div><button class="close" aria-label="關閉">×</button></header><div class="body"><div class="row"><b>即時盤面偵測</b><button class="toggle" aria-pressed="true">開啟 ●</button></div><div class="content"><div class="symbols"></div><div><div class="row"><span>訊號強度</span><span class="score">—</span></div><div class="track"><div class="fill"></div></div><div class="note">訊號強度不代表中獎率或爆分保證</div></div></div><div class="foot"><details><summary>近期命中紀錄</summary><div class="logs">尚無命中紀錄</div></details><button class="minimize">↘ 縮小</button></div><details style="margin-top:10px"><summary>讀取狀態</summary><div class="read-state note"></div></details></div></section><section class="mini" hidden><header class="head"><div class="mini-brand"><img class="brand-logo" src="/media/scarab-logo.webp" alt="聖甲之心"><span class="room">等待房間資料</span></div><button class="expand" aria-label="展開">↗</button></header><div class="row"><span class="detect-label"><span class="mini-on detect-text">偵測中</span><span class="detect-dot" aria-hidden="true"></span></span><span>訊號強度 <b class="score">—</b></span></div><div class="symbols"></div><div class="mini-status">等待盤面資料</div></section><dialog class="signal-modal" aria-label="推薦訊號符合提醒"><div class="toast" hidden></div></dialog>`;
document.body.append(host);
const q=s=>host.querySelector(s),all=s=>host.querySelectorAll(s);
let previousFocus=null;const inertBackup=new Map();
function lockAlert(){
 alertLocked=true;previousFocus=document.activeElement;
 const modal=q('.signal-modal');
 if(typeof modal.showModal==='function'){modal.showModal();}
 else{modal.setAttribute('open','');for(const el of document.body.children){if(el===host)continue;inertBackup.set(el,el.inert);el.inert=true;}}
}
function closeAlert(){
 q('.toast').hidden=true;const modal=q('.signal-modal');
 if(typeof modal.close==='function'&&modal.open)modal.close();else modal.removeAttribute('open');
 alertLocked=false;for(const [el,value]of inertBackup)el.inert=value;inertBackup.clear();
 if(previousFocus?.isConnected)previousFocus.focus();previousFocus=null;
 const continuations=window.__SCARAB_SIGNAL_PENDING_CONTINUATIONS||[];window.__SCARAB_SIGNAL_PENDING_CONTINUATIONS=[];for(const resume of continuations)resume();
}
q('.signal-modal').addEventListener('cancel',e=>e.preventDefault());
document.addEventListener('focusin',e=>{if(alertLocked&&!q('.signal-modal').contains(e.target))q('.alert-close')?.focus();},true);
function blockBehindAlert(e){
 if(!alertLocked)return;
 const close=q('.alert-close');
 if(e.type==='keydown'||e.type==='keyup'){
  if(e.key==='Tab'){e.preventDefault();close?.focus();return;}
  if((e.key==='Enter'||e.key===' ')&&e.target===close)return;
  e.preventDefault();e.stopImmediatePropagation();return;
 }
 if(close&&(e.target===close||close.contains(e.target)))return;
 e.preventDefault();e.stopImmediatePropagation();
}
for(const type of ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','click','dblclick','wheel','keydown','keyup'])document.addEventListener(type,blockBehindAlert,{capture:true,passive:false});

const button=document.createElement('button');button.title='訊號推薦';button.setAttribute('aria-label','訊號推薦');button.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6M12 2v2M22 12h-2M12 22v-2M2 12h2"/></svg>';button.type='button';button.dataset.signal='true';
function mount(){const original=document.getElementById('scarab-heart-ui');if(original){const css=getComputedStyle(original);host.style.fontFamily=css.fontFamily;}if(!miniPlaced)placeMini();}
let miniPlaced=false,miniPosition=null,layoutDragging=false,miniDragged=false;
function miniSize(){const mobile=innerWidth<=900||innerHeight<=500;return {width:mobile?195:245,height:q('.mini').offsetHeight||(mobile?160:215)};}
function clampPosition(p,width,height){const b=layoutBounds();return {left:Math.max(b.left,Math.min(b.right-width,p.left)),top:Math.max(b.top,Math.min(b.bottom-height,p.top))};}
function nearestPosition(p,width,height){const candidates=freeRegions().filter(r=>r.right-r.left>=width&&r.bottom-r.top>=height).map(r=>({left:Math.max(r.left,Math.min(r.right-width,p.left)),top:Math.max(r.top,Math.min(r.bottom-height,p.top))}));return candidates.sort((a,b)=>((a.left-p.left)**2+(a.top-p.top)**2)-((b.left-p.left)**2+(b.top-p.top)**2))[0];}
function layoutBounds(){return {left:12,top:12,right:innerWidth-12,bottom:innerHeight-12};}
function layoutObstacles(){const result=[];const panel=document.getElementById('scPanel');if(panel){const r=panel.getBoundingClientRect();if(r.right>r.left&&r.bottom>r.top)result.push(r);}
 for(const el of document.querySelectorAll('button,a,[role="button"]')){if(host.contains(el)||el.textContent.trim()!=='返回')continue;const r=el.getBoundingClientRect();if(r.width>0&&r.height>0)result.push(r);}
 return result;
}
function freeRegions(){const bounds=layoutBounds();let regions=[bounds];
 for(const r of layoutObstacles()){const o={left:r.left-10,top:r.top-10,right:r.right+10,bottom:r.bottom+10},next=[];
 for(const area of regions){if(o.right<=area.left||o.left>=area.right||o.bottom<=area.top||o.top>=area.bottom){next.push(area);continue;}
 for(const candidate of [{...area,bottom:Math.min(area.bottom,o.top)},{...area,top:Math.max(area.top,o.bottom)},{...area,right:Math.min(area.right,o.left)},{...area,left:Math.max(area.left,o.right)}])if(candidate.right>candidate.left&&candidate.bottom>candidate.top)next.push(candidate);
 }regions=next;
 }return regions;
}
function fits(position,width,height){const b=layoutBounds();return position.left>=b.left&&position.top>=b.top&&position.left+width<=b.right&&position.top+height<=b.bottom&&!layoutObstacles().some(r=>position.left<r.right+10&&position.left+width>r.left-10&&position.top<r.bottom+10&&position.top+height>r.top-10);}
function placeMini(preferSaved=true){const anchor=document.getElementById('scPanel')?.getBoundingClientRect();if(!anchor)return;
 const mini=q('.mini'),{width,height}=miniSize();mini.style.transform='';
 const below={left:Math.max(12,Math.min(anchor.left,innerWidth-width-12)),top:innerWidth>900&&innerHeight>500?Math.max(anchor.bottom+10,innerHeight-height-20):anchor.bottom+10};
 let position=preferSaved&&miniPosition&&fits(miniPosition,width,height)?miniPosition:null;
 if(!position&&miniDragged&&miniPosition)position=nearestPosition(clampPosition(miniPosition,width,height),width,height);
 if(!position&&fits(below,width,height))position=below;
 if(!position){position=freeRegions().filter(r=>r.right-r.left>=width&&r.bottom-r.top>=height).sort((a,b)=>a.top-b.top||b.right-a.right).map(r=>({left:r.right-width,top:r.top}))[0];}
 if(!position){const regions=freeRegions().map(r=>({r,scale:Math.min(1,(r.right-r.left)/width,(r.bottom-r.top)/height)})).sort((a,b)=>b.scale-a.scale);const best=regions[0];if(!best){mini.hidden=true;miniPlaced=false;return;}mini.style.transform='scale('+best.scale+')';mini.style.transformOrigin='top left';position={left:best.r.right-width*best.scale,top:best.r.top};}
 if(mode==='mini')mini.hidden=false;miniPosition=position;host.style.left=position.left+'px';host.style.top=position.top+'px';miniPlaced=true;
}
function hideFull(){q('.shell').hidden=true;button.classList.remove('on');}
function placeFull(){const shell=q('.shell'),mobile=innerWidth<=900||innerHeight<=500;
 const areas=freeRegions().sort((a,b)=>(b.right-b.left)*(b.bottom-b.top)-(a.right-a.left)*(a.bottom-a.top));
 const area=areas[0];if(!area){show('mini');return;}
 const width=Math.min(mobile?460:620,area.right-area.left),height=area.bottom-area.top;
 shell.style.width=width+'px';shell.style.maxHeight=height+'px';shell.style.overflowY='auto';shell.style.overflowX='hidden';
 host.style.left=(area.right-width)+'px';host.style.top=area.top+'px';
}
function reconcileLayout(){if(alertLocked||layoutDragging)return;if(mode==='full'){const shell=q('.shell'),r=shell.getBoundingClientRect();if(r.width&&r.height&&!fits({left:r.left,top:r.top},r.width,r.height))placeFull();}
 else{const r=q('.mini').getBoundingClientRect();if(r.width&&r.height&&!fits({left:r.left,top:r.top},r.width,r.height))placeMini(true);}}
function show(m){document.body.appendChild(host);mode=m;q('.shell').hidden=m!=='full';q('.mini').hidden=m!=='mini';button.classList.toggle('on',m==='full');
 if(m==='full'){document.querySelectorAll('#scarab-heart-ui .scPane.on').forEach(el=>el.classList.remove('on'));document.querySelectorAll('#scarab-heart-ui .scNav button[data-tab].on').forEach(el=>el.classList.remove('on'));placeFull();}
 else placeMini();
}
button.onclick=()=>{if(!q('.shell').hidden)hideFull();else show('full');};
document.addEventListener('pointerdown',function(e){if(q('.shell').hidden||host.contains(e.target)||button.contains(e.target))return;show('mini');},true);
window.addEventListener('resize',()=>{if(!q('.shell').hidden)placeFull();else{miniPlaced=false;placeMini();}});
q('.close').onclick=()=>show('mini');q('.minimize').onclick=()=>show('mini');q('.expand').onclick=()=>show('full');q('.mini').onclick=e=>{if(e.target.closest('button')||Date.now()-lastDragAt<300)return;show('full');};
q('.toggle').onclick=()=>{enabled=!enabled;board=null;q('.toggle').textContent=enabled?'開啟 ●':'關閉 ○';q('.toggle').setAttribute('aria-pressed',String(enabled));render();};
all('.head').forEach(el=>{let drag=null;el.onpointerdown=e=>{if(e.target.closest('button'))return;const r=host.getBoundingClientRect();layoutDragging=true;drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};el.setPointerCapture(e.pointerId);};el.onpointermove=e=>{if(!drag)return;if(Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y)>5)lastDragAt=Date.now();const size=mode==='mini'?miniSize():{width:q('.shell').getBoundingClientRect().width||host.offsetWidth,height:q('.shell').getBoundingClientRect().height||50};const position=clampPosition({left:drag.left+e.clientX-drag.x,top:drag.top+e.clientY-drag.y},size.width,size.height);host.style.left=position.left+'px';host.style.top=position.top+'px';if(mode==='mini'){miniDragged=true;miniPlaced=true;miniPosition={left:parseFloat(host.style.left),top:parseFloat(host.style.top)};}};el.onpointerup=el.onpointercancel=el.onlostpointercapture=()=>{if(!drag)return;drag=null;layoutDragging=false;reconcileLayout();};});
function icons(){all('.symbols').forEach(box=>{box.replaceChildren();if(!rule)return;rule.symbols.forEach(s=>{const item=document.createElement('div');item.className='symbol';const img=document.createElement('img');img.src=location.origin+s.asset;img.alt=s.name;const count=document.createElement('div');count.className='count';count.textContent='×'+s.count;item.append(img,count);if(!box.closest('.mini')){const cur=document.createElement('div');cur.className='current';cur.dataset.symbol=s.id;cur.textContent='本盤 —';item.append(cur);}box.append(item);});});}
function render(){const diag=window.__SCARAB_SIGNAL_DIAG;const state=q('.read-state');if(state)state.textContent='房號：'+(room||'尚未取得')+'｜盤面：'+(diag?.board?Object.values(diag.board).reduce((a,b)=>a+b,0)+' 個圖形':'尚未取得')+'｜房間訊號：'+(rule?'已取得':'尚未取得');const usable=enabled&&!round.freeGame&&board&&rule;const played=entryCaptured&&round.spinId&&round.spinId!==entrySpinId;const hit=usable&&!pendingRotation&&played&&round.settled&&rule.symbols.every(s=>(board[s.id]||0)>=s.count);const status=!enabled?'已暫停偵測':round.freeGame?'免費遊戲中，暫停偵測':!room?(window.__SCARAB_SIGNAL_DIAG?.board?'已讀到盤面，等待房號':'等待房間資料'):!usable?(window.__SCARAB_SIGNAL_API_ERROR?'訊號載入失敗，稍後重試':'等待盤面資料'):!played?'完成一轉後開始比對':!round.settled?'盤面更新中':hit?'本盤符合訊號':'本轉未符合訊號條件';q('.mini-status').textContent=round.freeGame?status:usable?status:(!enabled?'已暫停偵測':'');all('.detect-text').forEach(el=>el.textContent=enabled?(round.freeGame?'免遊暫停':'偵測中'):'已關閉');all('.detect-dot').forEach(el=>el.classList.toggle('off',!enabled||!!round.freeGame));all('.score').forEach(el=>el.textContent=rule&&strength!==null?strength+'%':'—');q('.fill').style.width=(rule?strength||0:0)+'%';all('[data-symbol]').forEach(el=>el.textContent=(usable&&!round.settled?'上盤 ':'本盤 ')+(usable?board[el.dataset.symbol]||0:'—'));button.style.boxShadow=hit?'0 0 14px #42dae8':'';q('.mini').classList.toggle('hit',!!hit);
if(hit&&round.settled&&round.spinId&&!seen.has(room+':'+round.spinId)){seen.add(room+':'+round.spinId);if(seen.size>100)seen.delete(seen.values().next().value);notified=spin;const reason='本盤 '+rule.symbols.map(s=>`${board[s.id]||0} 個${s.name}`).join('＋');history.unshift(new Date().toLocaleTimeString('zh-TW',{hour12:false})+'　'+reason);history=history.slice(0,8);q('.logs').replaceChildren(...history.map(t=>{const el=document.createElement('div');el.textContent=t;return el;}));notify(reason,{...board});}}
async function notify(reason,counts){
 alertLocked=true;const stopping=window.__SCARAB_SIGNAL_DATA.stopAuto(window);const token=++alertVersion,box=q('.toast');box.replaceChildren();box.setAttribute('role','alertdialog');box.setAttribute('aria-label','偵測到推薦訊號');
 const title=document.createElement('h3');title.textContent='推薦訊號已符合';title.style.margin='0 0 10px';
 const subtitle=document.createElement('p');subtitle.textContent=(rule.gameName||'')+' · '+room.padStart(3,'0')+' 號房';
 const symbols=document.createElement('div');symbols.className='symbols';
 rule.symbols.forEach(s=>{const item=document.createElement('div');item.className='symbol';const img=document.createElement('img');img.src=location.origin+s.asset;img.alt=s.name;const text=document.createElement('div');text.textContent='×'+(counts[s.id]||0);text.className='count';item.append(img,text);symbols.append(item);});
 const status=document.createElement('p');status.textContent='正在確認停轉…';status.className='stop-state';
 const note=document.createElement('p');note.textContent='訊號強度不代表中獎率或爆分保證';note.className='note';
 const actions=document.createElement('div');actions.className='row';const close=document.createElement('button');close.className='alert-close';close.textContent='關閉';close.onclick=closeAlert;actions.append(close);const heading=document.createElement('div');heading.className='alert-heading';const logo=document.createElement('img');logo.className='brand-logo';logo.src=location.origin+'/media/scarab-logo.webp';logo.alt='聖甲之心';heading.append(logo,title);box.append(heading,subtitle,symbols,status,note,actions);box.hidden=false;lockAlert();close.focus();
 try{const result=await stopping;if(token===alertVersion)status.textContent=result.stopped?'自動轉已停止':result.sent?'已送出停止指令，請確認自動轉已關閉':'無法確認自動轉狀態，請手動停止';}catch(_){if(token===alertVersion)status.textContent='請確認自動轉已關閉';}
}
window.addEventListener('scarab:signal-spin',()=>{lastSpinAt=Date.now();round={...round,settled:false};signature='';scoredSignature='';render();});
function freeFinished(){entrySpinId=round.spinId;entryCaptured=!!round.spinId;board=null;if(!room||!rule||pendingRotation)return;pendingRotation={room,ruleId:rule.id};request++;rotateAfterFree();}
async function rotateAfterFree(){
 if(!pendingRotation||rotating)return;rotating=true;lastRotateTry=Date.now();const target=pendingRotation;
 try{if(!target.prepared){const current=await fetch(location.origin+'/api/signals?game='+encodeURIComponent(game)+'&room='+encodeURIComponent(target.room),{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!current.ok)throw Error('HTTP '+current.status);target.ruleId=(await current.json()).id;target.prepared=true;}const sid=location.pathname.match(/^\/__game\/([a-f0-9]{24})(?:\/|$)/i)?.[1]||document.cookie.match(/(?:^|;\s*)scarab_provider_sid=([a-f0-9]{24})(?:;|$)/i)?.[1]||window.__SCARAB_ROOM_SESSION_ID||window.__SC_ROOM_SESSION_ID||window.__SCARAB_WEB_PAYLOAD?.cfg?.ROOM_SESSION_ID;
 const response=await fetch(location.origin+'/api/signals/free-finished',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid,game,room:target.room,ruleId:target.ruleId}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('HTTP '+response.status);const r=await response.json();if(target===pendingRotation){pendingRotation=null;if(room===target.room){request++;rule=r;board=null;signature='';strength=r.strength;lastFetch=Date.now();icons();render();}}}
 catch(error){window.__SCARAB_SIGNAL_ROTATE_ERROR=String(error);}finally{rotating=false;}
}
async function fetchRule(){if(!room)return;const target=room,token=++request;lastFetch=Date.now();try{const response=await fetch(location.origin+'/api/signals?game='+encodeURIComponent(game)+'&room='+encodeURIComponent(target),{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok){window.__SCARAB_SIGNAL_API_ERROR='HTTP '+response.status;throw Error('unavailable');}window.__SCARAB_SIGNAL_API_ERROR=null;const r=await response.json();if(token!==request||target!==room)return;if(rule?.id!==r.id){rule=r;board=null;signature='';icons();}strength=Number.isFinite(r.strength)?r.strength:null;render();all('.room').forEach(el=>el.textContent=r.gameName+' · '+room.padStart(3,'0')+' 號房');}catch(error){if(token===request){window.__SCARAB_SIGNAL_API_ERROR=error.message||'載入失敗';}}}
let finalSpinId=null;
function tick(committedIdle=false){if(alertLocked)return;mount();round=window.__SCARAB_SIGNAL_DATA.roundState(window);if(committedIdle){finalSpinId=round.spinId;round={...round,settled:true,phase:'idle'};}else if(round.spinId!==finalSpinId)round={...round,settled:false};const eng=window.__sethEngine;let sample={room:null,board:null};try{sample=window.__SCARAB_SIGNAL_DATA.sample(window);}catch(_){}window.__SCARAB_SIGNAL_DIAG={...sample,round:{...round},auto:window.__SCARAB_SIGNAL_DATA.autoState?.(window),board:sample.board?{...sample.board}:null,ruleLoaded:!!rule,room,updatedAt:new Date().toISOString()};let actual=sample.room;if(actual)confirmedRoom=true;
if(!actual&&!confirmedRoom){try{actual=window.__SCARAB_SIGNAL_DATA.normalizeRoom(window.__sethEngine?.selectedNum?.());}catch(_){}const payload=window.__SCARAB_WEB_PAYLOAD;if(!actual)actual=window.__SCARAB_SIGNAL_DATA.normalizeRoom(payload?.cfg?.MACHINENUM??payload?.config?.MACHINENUM??payload?.MACHINENUM);}
if(actual&&/^\d{1,6}$/.test(String(actual).trim())){lastRoomAt=Date.now();actual=String(Number(actual));if(actual!==room){room=actual;entrySpinId=null;entryCaptured=false;rule=null;board=null;signature='';scoredSignature='';alertVersion++;q('.toast').hidden=true;icons();all('.room').forEach(el=>el.textContent=room.padStart(3,'0')+' 號房 · 載入訊號中');history=[];q('.logs').textContent='尚無命中紀錄';strength=null;request++;fetchRule();}}else if(Date.now()-lastRoomAt>2000){room='';rule=null;board=null;strength=null;request++;all('.room').forEach(el=>el.textContent='等待房間資料');icons();}
if(sample.room===room&&!entryCaptured&&round.spinId){entrySpinId=round.spinId;entryCaptured=true;}
if(room&&!round.freeGame&&Date.now()-lastFetch>3000)fetchRule();
if(enabled&&!round.freeGame&&room&&rule){try{if(sample.room!==room)throw Error('not-seated');if(window.__SCARAB_LIVE?.sockets>0&&!window.__SCARAB_LIVE.connected)throw Error('disconnected');const b=sample.board;if(!b)throw Error('board');const keys=Object.keys(b).sort(),values=keys.map(k=>b[k]),total=values.reduce((a,b)=>a+b,0);if(!keys.length||total>30||total!==30||values.some(v=>!Number.isInteger(v)||v<0))throw Error('board');const sig=keys.map(k=>k+':'+b[k]).join(',');signature=sig;if(round.settled)board=b;}catch(_){signature='';round={...round,settled:false};}}render();}
// Observe the committed idle event before other handlers enqueue the next auto spin.
// Never trigger on spin packet arrival or unfinished cascading symbols.
let originalDispatch=null,wrappedDispatch=null;
function hookDispatch(){if(wrappedDispatch&&window.dispatch===wrappedDispatch)return;if(typeof window.dispatch!=='function')return;
 originalDispatch=window.dispatch;const original=originalDispatch;
 wrappedDispatch=function(event,payload){
 const gameEvents=window.System?.get?.('chunks:///_virtual/GameEvent.ts')?.GameEvent;
 const early=gameEvents?.CREATE_EARLY_SPIN_FLOW||'GameEvent:CREATE_EARLY_SPIN_FLOW';
 const next=gameEvents?.CREATE_SPIN_FLOW||'GameEvent:CREATE_SPIN_FLOW';
 // Native early-spin flow participates in the current spin completion.
 // Suppressing it before a match leaves the game waiting indefinitely.
 // Never discard a game flow for a wager already accepted by the server.
 // Native autoplay is stopped; normal settlement must continue.
 const idleEvent=window.System?.get?.('chunks:///_virtual/SlotFrameworkEvent.ts')?.SlotFrameworkEvent?.UPDATE_SPIN_STATUS;
 const finalEvent=gameEvents?.CREATE_CLOSE_SPIN_FLOW||'GameEvent:CREATE_CLOSE_SPIN_FLOW';
 if(event===finalEvent){try{tick(true);}catch(error){window.__SCARAB_SIGNAL_EVENT_ERROR=String(error);}}
 return original.apply(this,arguments);
 };window.dispatch=wrappedDispatch;}
const freeWatcher=window.__SCARAB_SIGNAL_DATA.watchFreeFinish?.(window,freeFinished);
// Symbol landing and cascade callbacks are intermediate boards, never match here.
const boardWatcher=null;
const earlyWatcher=window.__SCARAB_SIGNAL_DATA.watchEarlyDecision?.(window,()=>enabled);
show('mini');hookDispatch();const timer=setInterval(()=>{hookDispatch();earlyWatcher?.refresh();boardWatcher?.refresh();freeWatcher?.refresh();reconcileLayout();if(pendingRotation&&Date.now()-lastRotateTry>3000)rotateAfterFree();tick();},100);tick();window.addEventListener('pagehide',()=>{clearInterval(timer);boardWatcher?.dispose();earlyWatcher?.dispose();freeWatcher?.dispose();if(window.dispatch===wrappedDispatch)window.dispatch=originalDispatch;},{once:true});
})();
