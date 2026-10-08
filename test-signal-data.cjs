'use strict';
const assert=require('node:assert/strict'),data=require('./runtime/signal-data.js');
function node(name,comps={},children=[],active=true){const n={name,active,activeInHierarchy:active,children,getComponent:type=>comps[type]||null};for(const child of children)child.parent=n;return n;}
function sprite(id){return node('symbolSprite',{Sprite:{spriteFrame:{name:'symbol_'+id}}});}
function world(scene,engine={}){return {cc:{director:{getScene:()=>scene},Sprite:'Sprite',Label:'Label',Mask:'Mask'},__sethEngine:engine};}
assert.equal(data.normalizeRoom('第 022 號房'),'22');assert.equal(data.normalizeRoom('abc22'),null);assert.equal(data.normalizeRoom('6ac4148db69a05f6f1de521a'),null);
// A nested label under the seated-room control, missed by the old direct-parent reader.
let scene=node('Canvas',{},[node('slotTable2Btn',{},[node('content',{},[node('roomText',{Label:{string:'房間 022'}})])]),node('reels',{},[sprite('1'),sprite('01'),sprite('02')])]);
let sample=data.sample(world(scene,{seatedNum:()=>null}));assert.equal(sample.room,'22');assert.equal(sample.board.symbol_01,2);assert.equal(sample.board.symbol_02,1);assert.equal(sample.roomSource,'cocos-room-label');
// Hidden templates and paytable symbols must not inflate the visible board.
scene.children.push(node('paytable',{},[sprite('01')]),node('reels',{},[sprite('01')],false));assert.equal(data.sample(world(scene)).board.symbol_01,2);
// A launch target alone is insufficient evidence that the player is seated.
assert.equal(data.sample(world(node('lobby'),{selectedNum:()=>22})).room,null);
const w=world(node('Canvas',{},[node('reels',{},[sprite('01')])]));w.__SCARAB_SIGNAL_PACKET_ROOM={room:'22',at:Date.now()};assert.equal(data.sample(w).room,'22');
assert.equal(data.packetRoom({eventName:'spin',engine:{roomNumber:'022'}}),'22');assert.equal(data.packetRoom({eventName:'slotTableUpdated',roomNumber:22}),null);assert.equal(data.packetRoom({eventName:'spin',status:403,roomNumber:22}),null);assert.equal(data.packetRoom({eventName:'spin',roomId:'6ac4148db69a05f6f1de521a'}),null);
assert.equal(data.packetRoom({eventName:'spin',roomNumber:22,engine:{roomNumber:23}}),null);
// Clip offscreen row sprites to the actual reel mask.
const outside=sprite('01');outside.getBoundingBoxToWorld=()=>({x:200,y:200,width:10,height:10});const reel=node('reels',{Mask:{enabled:true}},[outside,sprite('02')]);reel.getBoundingBoxToWorld=()=>({x:0,y:0,width:100,height:100});assert.deepEqual(data.sample(world(node('Canvas',{},[reel]))).board,{symbol_02:1});
console.log('PASS: nested current-room labels, symbol normalization, inactive/paytable exclusion, mask clipping, packet room validation, no launch-target guessing');

const id='6ac4148db69a05f6f1de521a',tables=[{roomId:id,number:'022'}];
assert.equal(data.packetRoom({eventName:'spin',engine:{roomId:id}},tables),'22');
const modelWorld=world(node('Canvas',{},[node('reels',{},[sprite('01')])]),{tables});
modelWorld.App={serviceManager:{services:[{_client:{_io:{connected:true}},roomId:id}]}};
assert.equal(data.sample(modelWorld).room,'22');
modelWorld.App.serviceManager.services[0]._client._io.connected=false;assert.equal(data.sample(modelWorld).room,null);
console.log('PASS: actual connected roomId mapped through live table list; disconnected service excluded');

// Names and field access verified against all three uploaded game bundles.
const view=node('gameSymbols');view._components=[{symbolsMap:new Map([[0,{symbolID:1,posId:0,node:node('0')}],[1,{symbolID:2,posId:1,node:node('1')}],[2,{symbolID:1,posId:2,node:node('2')}]])}];
const loaded=world(node('Canvas',{},[view]));loaded.System={get:name=>name==='chunks:///_virtual/PlatformModel.ts'?{default:{getData:()=>({table:{roomId:'current-room',number:'022'}})}}:null};
assert.equal(data.sample(loaded).room,'22');assert.equal(data.sample(loaded).roomSource,'PlatformModel.table.number');assert.equal(data.sample(loaded).boardSource,'SymbolView.symbolsMap');assert.deepEqual(data.sample(loaded).board,{symbol_01:2,symbol_02:1});
console.log('PASS: HAR-confirmed PlatformModel and live SymbolView map access');
const roundWorld={System:{get:name=>({default:name.includes('SlotFrameworkData')?{getData:()=>({spinStatus:'spining'})}:name.includes('GameData')?{ins:{getData:()=>({spinId:'round-1'})}}:null})}};
assert.deepEqual(data.roundState(roundWorld),{spinId:'round-1',settled:false,phase:'spining',freeGame:false});
roundWorld.System.get=name=>({default:name.includes('SlotFrameworkData')?{getData:()=>({spinStatus:'idle'})}:name.includes('GameData')?{ins:{getData:()=>({spinId:'round-1'})}}:null});
assert.equal(data.roundState(roundWorld).settled,true);
const fgWorld={System:{get:name=>({default:name.includes('GameData')?{currentGameType:'freeGame',getData:()=>({spinId:'fg'})}:null})}};assert.equal(data.roundState(fgWorld).freeGame,true);fgWorld.System.get=name=>({default:name.includes('GameData')?{currentGameType:'mainGame',getData:()=>({spinId:'main'})}:null});assert.equal(data.roundState(fgWorld).freeGame,false);
assert.equal(data.roundState({}).settled,false);
(async()=>{let called=0;const w={dispatch:()=>called++,System:{get:name=>name.includes('SlotFrameworkEvent')?{SlotFrameworkEvent:{STOP_AUTO_SPIN:'stop'}}:name.includes('AutoPlayModel')?{default:{active:false}}:null},__sethEngine:{panel:{autoWanted:true,freeAuto:true},stopAuto:()=>called++}};assert.deepEqual(await data.stopAuto(w),{stopped:true,sent:true});assert.equal(called,2);assert.equal(w.__sethEngine.panel.autoWanted,false);assert.equal(w.__sethEngine.panel.freeAuto,false);console.log('PASS: spin phase gating and verified autoplay stop');})();

// Real bundle shape: exported constructors, with active instances in App.dataCenter.
class FrameworkData {}
class CurrentGameData {}
const liveFramework={getData:()=>({spinStatus:'spining'})};
const liveGame={getData:()=>({spinId:'screenshot-round'})};
const realWorld=world(node('Canvas',{},[view]));
realWorld.System={get:name=>({default:name.includes('SlotFrameworkData')?FrameworkData:name.includes('GameData')?CurrentGameData:null})};
realWorld.App={dataCenter:{get:(type,create)=>{assert.equal(create,false);return type===FrameworkData?liveFramework:type===CurrentGameData?liveGame:null;}}};
assert.equal(data.roundState(realWorld).settled,false);
liveFramework.getData=()=>({spinStatus:'idle'});
assert.deepEqual(data.roundState(realWorld),{spinId:'screenshot-round',settled:true,phase:'idle',freeGame:false});
realWorld.App.dataCenter.get=()=>null;
assert.equal(data.roundState(realWorld).settled,false);
console.log('PASS: real DataCenter instances, no fresh model creation, missing instance blocks alerts');

const screenshotBoard={symbol_09:5,symbol_07:7,symbol_02:5,symbol_04:2,symbol_05:3,symbol_01:4,symbol_06:2,symbol_03:2};
const screenshotRule={symbols:[{id:'symbol_09',count:3},{id:'symbol_04',count:1},{id:'symbol_07',count:1},{id:'symbol_02',count:2}]};
assert.equal(Object.values(screenshotBoard).reduce((a,b)=>a+b,0),30);
assert.equal(require('./signal-rules.cjs').evaluate(screenshotRule,screenshotBoard).hit,true);
console.log('PASS: screenshot green/purple/snake/machete conditions match');

(async()=>{
 let queueActive=true,remaining=25,stops=0;
 const model={get active(){return queueActive},set active(v){queueActive=v},get spinsRemaining(){return remaining},set spinsRemaining(v){remaining=v}};
 const win={System:{get:name=>name.includes('AutoPlayModel')?{default:model}:name.includes('SlotFrameworkEvent')?{SlotFrameworkEvent:{STOP_AUTO_SPIN:'stop'}}:null},dispatch:()=>{assert.equal(queueActive,false);assert.equal(remaining,0);stops++},__sethEngine:{panel:{autoWanted:true,freeAuto:true},stopAuto:()=>Promise.resolve()}};
 const pending=data.stopAuto(win);
 assert.equal(queueActive,false,'queue disabled synchronously');assert.equal(remaining,0,'remaining automatic spins cleared synchronously');
 assert.equal((await pending).stopped,true);assert.ok(stops>0);
 console.log('PASS: actual model setters clear autoplay queue before stop event delivery');
})();

// Native auto can remain spinning while the visible symbols finish landing.
let landingCallback,order=[];const landingView={symbolsMap:new Map(),showSymbolsIn(cb){landingCallback=cb;return 17;}};
const landingNode=node('symbolView');landingNode._components=[landingView];
const landingWorld=world(node('Canvas',{},[landingNode]));
const originalLanding=landingView.showSymbolsIn;
const watcher=data.watchBoard(landingWorld,()=>order.push('detect'));
assert.equal(landingView.showSymbolsIn(()=>order.push('continue-auto')),17);
assert.deepEqual(order,[]);landingCallback();assert.deepEqual(order,['detect','continue-auto']);
watcher.dispose();assert.equal(landingView.showSymbolsIn,originalLanding);
const autoWorld={System:{get:name=>name.includes('AutoPlayModel')?{default:{active:true,spinsRemaining:99}}:null}};
assert.deepEqual(data.autoState(autoWorld),{native:true,assistant:false,remaining:99});
console.log('PASS: native autoplay identified without assistant; landing completion detected before next game continuation');

let freeEnded=0,returnedMain=false;const freePanel={goToMainGame(){returnedMain=true},finishFreeGame(){this.goToMainGame();return 'finished'}};
const freeNode=node('freeResult');freeNode._components=[freePanel];
const freeWatch=data.watchFreeFinish(world(node('Canvas',{},[freeNode])),()=>{assert.equal(returnedMain,true);freeEnded++;});
assert.equal(freeEnded,0);assert.equal(freePanel.finishFreeGame(),'finished');assert.equal(freeEnded,1);freeWatch.dispose();
console.log('PASS: free-game rotation event only after return to main game');

// Prevent early wagers at the native decision; preserve already accepted ones.
{
 let enabled=true;const game={isSendOutEarlyFlag:false,earlyData:null,judgeIsOpenEarlyFlag(value){this.isOpenEarlyFlag=true;this.earlyData=value;return 17;}};
 const original=game.judgeIsOpenEarlyFlag;const win={System:{get:name=>name.includes('GameData')?{default:game}:null}};
 const watcher=data.watchEarlyDecision(win,()=>enabled);
 assert.equal(game.judgeIsOpenEarlyFlag('next'),17);assert.equal(game.isOpenEarlyFlag,false);assert.equal(game.earlyData,null);
 game.isSendOutEarlyFlag=true;game.judgeIsOpenEarlyFlag('accepted');assert.equal(game.isOpenEarlyFlag,true);assert.equal(game.earlyData,'accepted');
 enabled=false;game.isSendOutEarlyFlag=false;game.judgeIsOpenEarlyFlag('native');assert.equal(game.isOpenEarlyFlag,true);
 watcher.dispose();assert.equal(game.judgeIsOpenEarlyFlag,original);
 console.log('PASS: native pre-run disabled before wager; accepted wager preserved; disabled detector restores native behavior');
}
