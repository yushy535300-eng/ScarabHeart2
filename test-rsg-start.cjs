const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
function harness(){
 const node=new EventEmitter();node.activeInHierarchy=true;
 const button={node,enabledInHierarchy:true,interactable:true};let clicked=0;node.on('click',()=>clicked++);
 const bar={btnStart:button,_onFinishListener(){},setEnableStartButton(){}};
 const scene={name:'loading_scene',_components:[bar],children:[]};
 node.getComponent=()=>({hitTest:p=>p.x>=25&&p.x<=75&&p.y>=25&&p.y<=75});
 const canvas={width:100,height:100,getBoundingClientRect:()=>({left:0,bottom:100,width:100,height:100})};
 const events={},timers=[];let scan,close;
 const context={Date,Number,console,cc:{director:{getScene:()=>scene},UITransform:class{},Vec2:class{constructor(x,y){this.x=x;this.y=y}},Button:{EventType:{CLICK:'click'}}},
 document:{getElementById:()=>canvas,addEventListener:(e,f)=>events[e]=f,removeEventListener:e=>delete events[e]},
 setInterval:f=>{scan=f;return 1},clearInterval(){},setTimeout:f=>timers.push(f),addEventListener:(e,f)=>{if(e==='pagehide')close=f}};
 context.window=context;vm.runInNewContext(fs.readFileSync(__dirname+'/public/provider/rsg-start-repair.js','utf8'),context);scan();
 return {node,button,scene,context,close:()=>close(),cancel:()=>events.pointercancel({}),flush:()=>timers.splice(0).forEach(f=>f()),count:()=>clicked,
 down:()=>events.pointerdown({target:canvas,button:0,clientX:50,clientY:50}),release:(x=50)=>events.mouseup({target:canvas,button:0,clientX:x,clientY:50}),pointer:()=>events.pointerup({target:canvas,button:0,clientX:50,clientY:50})};
}
test('lost release completes only the user-pressed loading button once',()=>{
 const h=harness();h.down();h.pointer();h.release();h.flush();assert.equal(h.count(),1);assert.equal(h.context.__scarabRsgStartRepair.recovered,1);
 h.release();h.flush();assert.equal(h.count(),1);
});
test('normal Cocos clicks are not duplicated',()=>{
 const h=harness();h.down();h.release();h.node.emit('click',h.button);h.flush();assert.equal(h.count(),1);assert.equal(h.context.__scarabRsgStartRepair.recovered,0);
});
test('no press, cancelled gestures, outside releases, disabled buttons and game scenes never trigger',()=>{
 for(const variant of ['no-press','cancel','outside','disabled','scene','closed']){
  const h=harness();if(variant!=='no-press')h.down();
  if(variant==='cancel')h.cancel();if(variant==='disabled')h.button.interactable=false;if(variant==='scene')h.scene.name='game_scene';
  h.release(variant==='outside'?95:50);if(variant==='closed')h.close();h.flush();assert.equal(h.count(),0,variant);
 }
});
