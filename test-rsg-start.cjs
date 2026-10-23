const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(projection=true){
 let called=0,control=null,scan,close;const timers=[];
 const scene={name:'loading_scene',_components:[],children:[]};
 const camera={visibility:1,systemWindowId:0,worldToScreen:(out,p)=>Object.assign(out,p)};
 const ui={_getRenderScene:()=>({cameras:projection?[camera]:[]}),getBoundingBoxToWorld:()=>({x:25,y:25,width:50,height:50})};
 const node={activeInHierarchy:true,layer:1,worldPosition:{z:0},getComponent:()=>ui};
 const button={node,enabledInHierarchy:true,interactable:true};
 const bar={btnStart:button,_onFinishListener(){called++;scene.name='game_scene'},setEnableStartButton(){}};scene._components=[bar];
 const canvas={width:100,height:100,getBoundingClientRect:()=>({left:0,bottom:100,width:100,height:100})};
 const context={console,Number,Math,JSON,setInterval:f=>{scan=f;return 1},clearInterval(){},setTimeout:f=>timers.push(f),
  cc:{director:{getScene:()=>scene}},addEventListener:(e,f)=>{if(e==='pagehide')close=f},removeEventListener(){},
  document:{getElementById:()=>canvas,createElement:()=>({style:{},setAttribute(){},addEventListener:(e,f)=>{if(e==='click')context.click=f},remove(){control=null}}),body:{appendChild:e=>control=e}}};
 context.window=context;vm.runInNewContext(fs.readFileSync(__dirname+'/public/provider/rsg-start-repair.js','utf8'),context);scan();
 return {scene,node,button,ui,bar,context,scan,close:()=>close(),flush:()=>timers.splice(0).forEach(f=>f()),count:()=>called,control:()=>control,
 click:(trusted=true)=>context.click({isTrusted:trusted,preventDefault(){},stopPropagation(){}})};
}
test('DOM start button maps original screen bounds and invokes only the original start callback',()=>{
 const h=harness();assert.equal(h.control().style.left,'25px');assert.equal(h.control().style.top,'25px');assert.equal(h.control().style.width,'50px');
 h.click();h.click();h.flush();assert.equal(h.count(),1);assert.equal(h.scene.name,'game_scene');assert.equal(h.control(),null);assert.equal(h.context.__scarabRsgStartRepair.lastEvent,'entered');
});
test('synthetic, disabled, hidden, closed and non-loading controls never start',()=>{
 for(const variant of ['synthetic','disabled','hidden','closed','scene']){
  const h=harness();if(variant==='disabled')h.button.interactable=false;if(variant==='hidden')h.node.activeInHierarchy=false;if(variant==='closed')h.close();if(variant==='scene')h.scene.name='game_scene';
  h.click(variant!=='synthetic');h.flush();assert.equal(h.count(),0,variant);
 }
});
test('unavailable projection does not place a guessed clickable area',()=>{
 const h=harness(false);assert.equal(h.control(),null);assert.equal(h.context.__scarabRsgStartRepair.lastEvent,'layout-unavailable');
});
