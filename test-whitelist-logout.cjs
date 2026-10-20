'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');

function harness(reply) {
  const elements = new Map();
  const events = new Map();
  const state = {view:'gameView',closed:0,probeStopped:0,presenceStopped:0,timers:[],requests:[]};
  const element = () => ({style:{},value:'secret',textContent:'',focus(){},remove(){elements.delete(this.id);},querySelector(){return this.button ||= element();}});
  for (const id of ['err','p']) elements.set(id,element());
  const context = {
    session:{account:'TEST',accessSessionId:'TEST_SESSION'},accessWatchTimer:null,accessWatchCheck:null,
    gameOpenSerial:1,boardLoadSerial:1,boards:{},pendingPick:{},
    $:id=>elements.get(id),
    document:{createElement:element,body:{appendChild(node){elements.set(node.id,node);}},addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k)},
    addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k),
    setInterval:(fn,ms)=>{state.timers.push({fn,ms});return state.timers.length;},clearInterval:id=>{state.timers[id-1].cleared=true;},
    ScarabWebLauncher:{close(){state.closed++;}},stopRecommendationProbe(){state.probeStopped++;},stopPresence(){state.presenceStopped++;},
    showOnly:view=>state.view=view,
    localAccess:async(url)=>{state.requests.push(url);return url.startsWith('/api/access/check')?await reply():{response:{status:200},data:{success:true}};}
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(app.slice(app.indexOf('  function accessReasonText('),app.indexOf('  async function localAccess(')),context);
  vm.runInContext(app.slice(app.indexOf('  function stopAccessWatch('),app.indexOf('  function stopPresence(')),context);
  vm.runInContext(app.slice(app.indexOf('  function logout('),app.indexOf('  async function chooseGame(')),context);
  return {context,elements,events,state};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('disabled whitelist closes the game, clears login, returns to login and displays recharge notice',async()=>{
  const h=harness(async()=>({response:{status:403},data:{valid:false,reason:'disabled'}}));
  h.context.startAccessWatch();await tick();
  assert.equal(h.context.session,null);
  assert.equal(h.state.view,'loginView');assert.equal(h.state.closed,1);assert.equal(h.state.probeStopped,1);assert.equal(h.state.presenceStopped,1);
  assert.equal(h.elements.get('p').value,'');
  assert.match(h.elements.get('err').textContent,/儲值後通知客服開通/);
  assert.equal(h.elements.get('err').style.color,'#ff7e89');
  assert.match(h.elements.get('accessRevokedDialog').innerHTML,/儲值後通知客服開通/);
  assert.equal(h.state.timers[0].ms,2000);assert.equal(h.state.timers[0].cleared,true);
  assert.equal(h.events.size,0);
  h.elements.get('accessRevokedDialog').querySelector('button').onclick();
  assert.equal(h.elements.has('accessRevokedDialog'),false);
});

test('temporary outages and malformed replies never masquerade as disabled permissions',async()=>{
  for(const reply of [()=>Promise.reject(new Error('offline')),async()=>({response:{status:503},data:{valid:false,temporary:true}}),async()=>({response:{status:200},data:{}})]){
    const h=harness(reply);h.context.startAccessWatch();await tick();assert.notEqual(h.context.session,null);assert.equal(h.state.closed,0);h.context.stopAccessWatch();
  }
});

test('returning to a mobile tab rechecks permissions and an old response cannot log out a new login',async()=>{
  let resolveOld;let count=0;
  const h=harness(async()=>{count++;if(count===1)return {response:{status:200},data:{valid:true}};return new Promise(resolve=>{resolveOld=resolve;});});
  h.context.startAccessWatch();await tick();
  assert.equal(typeof h.events.get('visibilitychange'),'function');
  const checking=h.events.get('visibilitychange')();
  const newer={accessSessionId:'NEW_SESSION'};h.context.session=newer;
  resolveOld({response:{status:403},data:{valid:false,reason:'disabled'}});await checking;
  assert.equal(h.context.session,newer);assert.equal(h.state.closed,0);h.context.stopAccessWatch();
});

test('server rechecks shared whitelist state, removes disabled sessions and keeps sessions on database outage',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
  let handler;const sessions=new Map([['TEST',{username:'TEST',platform:'TZ'}]]);
  const ctx={app:{get:(_route,fn)=>handler=fn},accessSessions:sessions,authorizeWhitelist:async()=>({allowed:false,reason:'disabled'})};
  vm.runInNewContext(source.slice(source.indexOf("app.get('/api/access/check',"),source.indexOf("app.post('/api/access/logout'")),ctx);
  function res(){return {code:200,set(){return this;},status(n){this.code=n;return this;},json(data){this.data=data;return this;}};}
  const response=res();await handler({query:{sessionId:'TEST'}},response);assert.equal(response.code,403);assert.equal(sessions.has('TEST'),false);
  sessions.set('TEST',{username:'TEST',platform:'TZ'});ctx.authorizeWhitelist=async()=>({allowed:false,reason:'database_unavailable'});
  const temporary=res();await handler({query:{sessionId:'TEST'}},temporary);assert.equal(temporary.code,503);assert.equal(temporary.data.temporary,true);assert.equal(sessions.has('TEST'),true);
});
