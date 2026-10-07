'use strict';
// Optional DOM regression suite: npm install --no-save jsdom, then node this file.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
(async()=>{
 const dom=new JSDOM('<html><body><div id="scarab-heart-ui"><div class="scNav"></div></div></body></html>',{url:'http://signal.test/__game/abcdefabcdefabcdefabcdef/play',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;let fail=false,rotationPosts=0,ruleVersion='room-rule';
 try{
 w.__SC_GAME_CODE='golden-seth';w.phase='idle';w.id='entry';w.auto={active:true,spinsRemaining:50};w.queued=0;
 w.System={get:name=>name.includes('AutoPlayModel')?{default:w.auto}:name.includes('SlotFrameworkEvent')?{SlotFrameworkEvent:{UPDATE_SPIN_STATUS:'phase',STOP_AUTO_SPIN:'stop'}}:null};
 w.prefetches=0;w.directSpins=0;w.dispatch=(event,payload)=>{if(event==='GameEvent:CREATE_EARLY_SPIN_FLOW')w.prefetches++;if(event==='GameEvent:CREATE_SPIN_FLOW')w.directSpins++;if(event==='stop')w.dispatch('GameEvent:CREATE_SPIN_FLOW',{data:{earlySpin:true}});if(event==='phase'){w.phase=payload.data;}if(event==='GameEvent:CREATE_CLOSE_SPIN_FLOW'&&w.auto.active)w.queued++;};
 w.fetch=async(url,options)=>{if(options?.method==='POST'){assert.equal(JSON.parse(options.body).sid,'abcdefabcdefabcdefabcdef');rotationPosts++;ruleVersion='free-rotated';}return ({ok:!fail,status:fail?503:200,json:async()=>({id:ruleVersion,gameName:'賽特二代',strength:58,symbols:[{id:'symbol_09',name:'綠寶石',count:3,asset:'/signal-assets/seth12'},{id:'symbol_04',name:'彎刀',count:1,asset:'/signal-assets/seth7'}]})});};
 const anchor=w.document.createElement('div');anchor.id='scPanel';anchor.getBoundingClientRect=()=>({left:30,bottom:120,top:20,right:230});w.document.body.append(anchor);w.AbortSignal=AbortSignal;let landed;const nativeView={symbolsMap:new Map(),showSymbolsIn(cb){landed=cb;}};const freeView={goToMainGame(){},finishFreeGame(){this.goToMainGame();}};w.__SCARAB_ROOM_SESSION_ID='test-session';w.cc={director:{getScene:()=>({_components:[nativeView,freeView],children:[]})}};
 w.eval(fs.readFileSync(path.join(__dirname,'runtime/signal-data.js'),'utf8'));
 const real=w.__SCARAB_SIGNAL_DATA;
 w.__SCARAB_SIGNAL_DATA={...real,sample:()=>({room:'3272',board:{symbol_09:5,symbol_04:2,symbol_01:23}}),roundState:()=>({spinId:w.id,settled:w.phase==='idle',phase:w.phase,freeGame:!!w.inFree})};
 w.eval(fs.readFileSync(path.join(__dirname,'runtime/signal-runtime.js'),'utf8'));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 await wait(140);assert.equal(w.document.querySelector('.mini').hidden,false);assert.equal(w.document.querySelector('.shell').hidden,true);assert.equal(w.document.querySelector('.scNav [data-signal]'),null);assert.equal(w.document.querySelector('#sc-signal').style.top,'533px');
 const originalRect=anchor.getBoundingClientRect;const signalHost=w.document.querySelector('#sc-signal');
 const back=w.document.createElement('button');back.textContent='返回';back.getBoundingClientRect=()=>({left:760,top:12,right:832,bottom:50,width:72,height:38});w.document.body.append(back);
 w.innerWidth=844;w.innerHeight=390;anchor.getBoundingClientRect=()=>({left:12,top:50,right:210,bottom:360,width:198,height:310});w.dispatchEvent(new w.Event('resize'));
 assert.ok(parseFloat(signalHost.style.left)>=220,'landscape mini must sit outside main assistant');assert.ok(parseFloat(signalHost.style.left)+245<=750,'mini avoids return button');
 const mini=w.document.querySelector('.mini'),head=mini.querySelector('.head');
 const measured=()=>({left:parseFloat(signalHost.style.left),top:parseFloat(signalHost.style.top),right:parseFloat(signalHost.style.left)+245,bottom:parseFloat(signalHost.style.top)+215,width:245,height:215});
 signalHost.getBoundingClientRect=measured;mini.getBoundingClientRect=measured;head.setPointerCapture=()=>{};
 const pos=measured();head.onpointerdown({target:head,clientX:pos.left,clientY:pos.top,pointerId:1});head.onpointermove({clientX:20,clientY:100});
 assert.equal(parseFloat(signalHost.style.left),20);await wait(120);assert.equal(parseFloat(signalHost.style.left),20,'no snapping during drag');
 head.onpointerup();assert.ok(parseFloat(signalHost.style.left)>=220,'overlapping drag snaps into free area after release');

 w.document.querySelector('.expand').click();const full=w.document.querySelector('.shell');assert.ok(parseFloat(signalHost.style.left)>=220);assert.ok(parseFloat(full.style.width)<=460);assert.ok(parseFloat(full.style.maxHeight)<=366);
 w.document.querySelector('.minimize').click();assert.equal(w.document.querySelector('.mini').hidden,false);
 w.innerWidth=390;w.innerHeight=844;anchor.getBoundingClientRect=()=>({left:12,top:50,right:210,bottom:350,width:198,height:300});back.remove();w.dispatchEvent(new w.Event('resize'));assert.equal(signalHost.style.top,'360px','portrait returns below main assistant');
 w.innerWidth=1024;w.innerHeight=768;anchor.getBoundingClientRect=originalRect;w.dispatchEvent(new w.Event('resize'));

 assert.equal(w.document.querySelector('.toast').hidden,true,'spinning must not alert');w.dispatch('GameEvent:CREATE_EARLY_SPIN_FLOW');assert.equal(w.prefetches,1,'unmatched native pre-run must complete normally');
 w.dispatch('GameEvent:CREATE_CLOSE_SPIN_FLOW');assert.equal(w.document.querySelector('.toast').hidden,true,'entry board must never alert or stop autoplay');assert.equal(w.auto.active,true);
 w.inFree=true;w.id='free-spin';w.dispatch('GameEvent:CREATE_CLOSE_SPIN_FLOW');assert.equal(w.document.querySelector('.toast').hidden,true,'matching free board never alerts');assert.equal(w.auto.active,true,'free autoplay remains active');assert.equal(w.document.querySelector('.detect-text').textContent,'免遊暫停');w.inFree=false;
 w.queued=0;w.id='one';w.phase='spining';w.dispatch('GameEvent:CREATE_CLOSE_SPIN_FLOW');
 assert.equal(w.document.querySelector('.toast').hidden,false,'alert shown in same idle-event turn');
 assert.equal(w.queued,0,'stop before idle handler queues next spin');assert.equal(w.directSpins,0,'stop handler cannot start prepared spin');assert.equal(w.auto.spinsRemaining,0);
 await wait(0);assert.equal(w.document.querySelector('.stop-state').textContent,'自動轉已停止');
 assert.equal(w.document.querySelectorAll('.brand-logo').length,3);
 const modal=w.document.querySelector('.signal-modal');assert.ok(modal.hasAttribute('open'));
 const behind=w.document.createElement('button');behind.textContent='背景遊戲操作';let actions=0;behind.onclick=()=>actions++;w.document.body.append(behind);
 behind.click();assert.equal(actions,0,'background click blocked while alert open');
 behind.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(actions,0);
 const escape=new w.Event('cancel',{cancelable:true});modal.dispatchEvent(escape);assert.equal(escape.defaultPrevented,true);assert.ok(modal.hasAttribute('open'),'escape must not dismiss');
 assert.equal(w.document.querySelectorAll('.toast button').length,1,'close is the sole action');

 w.document.querySelector('.toast .row').lastChild.click();assert.equal(modal.hasAttribute('open'),false);behind.click();assert.equal(actions,1);assert.equal(w.auto.active,false,'closing must not resume auto spin');w.dispatch('GameEvent:CREATE_CLOSE_SPIN_FLOW');
 assert.equal(w.document.querySelector('.toast').hidden,true,'same round must not repeat');
 fail=true;await wait(3200);
 assert.equal(w.document.querySelector('.shell .score').textContent,'58%','temporary API failure preserves current recipe');
 w.id='two';w.auto.active=true;w.auto.spinsRemaining=20;w.phase='spining';w.dispatch('GameEvent:CREATE_CLOSE_SPIN_FLOW');
 await wait(0);assert.equal(w.document.querySelector('.stop-state').textContent,'自動轉已停止');assert.equal(w.queued,0);
 // Incomplete board samples must not trigger a new alert using stale counts.
 w.document.querySelector('.toast .row').lastChild.click();w.id='three';w.__SCARAB_SIGNAL_DATA.sample=()=>({room:'3272',board:{symbol_09:3}});w.dispatch('GameEvent:CREATE_CLOSE_SPIN_FLOW');
 assert.equal(w.document.querySelector('.toast').hidden,true);
 w.id='native-auto';w.phase='spining';w.auto.active=true;w.auto.spinsRemaining=99;
 w.__SCARAB_SIGNAL_DATA.sample=()=>({room:'3272',board:{symbol_09:5,symbol_04:2,symbol_01:23}});
 let continuationRan=false;nativeView.showSymbolsIn(()=>{continuationRan=true;});landed();await wait(0);assert.equal(continuationRan,true,'intermediate symbol callback never held');assert.equal(w.document.querySelector('.toast').hidden,true,'matching intermediate cascade must not alert');assert.equal(w.auto.active,true);w.dispatch('GameEvent:CREATE_CLOSE_SPIN_FLOW');await wait(0);
 assert.equal(w.phase,'spining','no idle status event emitted');assert.equal(w.auto.active,false);assert.equal(w.queued,0);assert.equal(w.document.querySelector('.toast').hidden,false);assert.equal(w.__SCARAB_SIGNAL_AUTO_SOURCE.native,true);assert.equal(w.__SCARAB_SIGNAL_AUTO_SOURCE.assistant,false);
 w.document.querySelector('.alert-close').click();assert.equal(continuationRan,true);assert.equal(w.auto.active,false);fail=false;assert.equal(rotationPosts,0);freeView.finishFreeGame();await wait(20);assert.equal(rotationPosts,1);assert.equal(ruleVersion,'free-rotated');
 console.log('PASS: free finish rotates server recommendation; native autoplay without idle event stops only on final close flow; entry board suppressed until first new spin, immediate final-board alert, no next auto spin, cleared queue, deduplication, outage retention, incomplete-board rejection, three logos');
 }finally{dom.window.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
