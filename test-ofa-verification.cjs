const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(){
  const configs=[],removed=[];
  const node=()=>({style:{},setAttribute(){},append(){},remove(){},focus(){}});
  const window={turnstile:{render(host,config){configs.push(config);return configs.length;},remove(id){removed.push(id);}}};
  const context={window,document:{head:node(),body:node(),activeElement:node(),createElement:node,addEventListener(){},removeEventListener(){}},setTimeout,clearTimeout};
  vm.runInNewContext(fs.readFileSync(__dirname+'/public/ofa-verification.js','utf8'),context);
  return {api:window.ScarabOfaVerification,configs,removed};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('each login needs a fresh verified token and removes its widget',async()=>{
  const {api,configs,removed}=setup();
  let first=api.requestToken();await tick();configs[0].callback('first-fresh-token');assert.equal(await first,'first-fresh-token');
  let second=api.requestToken();await tick();assert.equal(configs.length,2);configs[1].callback('second-fresh-token');assert.equal(await second,'second-fresh-token');
  assert(removed.includes(1)&&removed.includes(2));
});
test('unauthorized hostname and expired challenge fail without returning a token',async()=>{
  const {api,configs}=setup();let pending=api.requestToken();const failure=assert.rejects(pending,/OFA 尚未授權/);await tick();configs[0]['error-callback']('110200');await failure;
  pending=api.requestToken();const expiry=assert.rejects(pending,/過期/);await tick();configs[1]['expired-callback']();await expiry;
});
test('429 cooldown blocks another challenge without automatically retrying login',async()=>{
  const {api,configs}=setup();assert.match(api.rateLimited('60'),/60 秒/);await assert.rejects(api.requestToken(),/限制登入次數/);assert.equal(configs.length,0);
});
test('a second pending attempt cannot consume the first challenge token',async()=>{
  const {api,configs}=setup();const first=api.requestToken();await tick();await assert.rejects(api.requestToken(),/目前的/);configs[0].callback('fresh');assert.equal(await first,'fresh');
});
