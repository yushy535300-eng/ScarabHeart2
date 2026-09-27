const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../runtime/atg-engine-runtime.js'), 'utf8');
const decoder = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf('function engine(CONFIG)')), decoder, {timeout: 10000});
const aliases = new Set(['b']);
let changed = true;
while (changed) {
  changed = false;
  for (const m of source.matchAll(/\b(\w+)\s*=\s*(\w+)\s*[,;]/g)) {
    if (aliases.has(m[2]) && !aliases.has(m[1])) { aliases.add(m[1]); changed = true; }
  }
}
let body = source.slice(source.indexOf('function engine(CONFIG)')).replace(/\b(\w+)\((0x[0-9a-f]+)\)/g,
  (all, name, arg) => aliases.has(name) ? JSON.stringify(decoder.b(Number(arg))) : all);
for (let i=0;i<8;i++) body=body.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\+\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
  (all,left,right)=>{try{return JSON.stringify(vm.runInNewContext(left+'+'+right));}catch{return all;}});
const between = (start, end) => body.slice(body.indexOf(start), body.indexOf(end, body.indexOf(start) + start.length));
const dictionary = body.slice(body.indexOf('const c5=b,c='), body.indexOf('},d=') + 1) + ';';
const readers = between('a6["scanMachines"]=', ',a6["balance"]=') + ';';
const normalization = between('// v3.24: canonical', 'function a8(){');
const functions = [between('function aG(){', 'function aH(){'), between('function aK(', 'function aL('),
  between('async function aP(', 'async function aS(')].join('\n');
let count = 0;
async function scenario({label='021', target='21', busy=false, stale=false, disabled=false, secondary=false, stuck=false, offPage=false, missingSeatLabel=false, nestedSeatLabel=false} = {}) {
  let selected = '103', seat = null, pageVisible = !offPage, scrolls = 0;
  const touches = [];
  const button = {interactable: !disabled, enabled: true};
  const confirm = {name: 'selectBtn', activeInHierarchy: true, getComponent: () => button};
  const second = {name: 'dialogConfirm', activeInHierarchy: false, getComponent: () => ({enabled:true, interactable:true})};
  const row = {name:'SlotTableItem2', activeInHierarchy:true, getComponent:()=>({}), children:[
    {name:'icon', getComponent:()=>({spriteFrame:{name:busy?'occupied_lock':'machine_available'}})}]};
  const roomText = {name:'roomNumberText', activeInHierarchy:true};
  const roomButton = {name:'slotTable2Btn', activeInHierarchy:true, getComponent:()=>null, children:[{name:'container',children:[roomText]}]};
  const selectedLabel = {name:'slotTableNumber'};
  const seatLabel = {name:'num', parent:{name:'slotTable2Btn'}};
  const a6 = {
    walk: pred => [...(pageVisible ? [row] : []), selectedLabel, seatLabel, confirm, second, ...(nestedSeatLabel ? [roomButton] : [])].filter(pred),
    childText: node => node === row ? label : null,
    label: node => node === selectedLabel ? selected : node === seatLabel ? (missingSeatLabel ? null : seat) : node === roomText ? seat : null,
    findOne: name => name === 'selectBtn' ? confirm : null,
    btnText: node => node === confirm || node === second ? '確定' : '',
    emitTouch: node => {
      touches.push(node.name);
      if (node === row && !stale) selected = label;
      if (node === confirm && !stuck) {
        confirm.activeInHierarchy = false;
        if (secondary) second.activeInHierarchy = true;
        else { selected = null; seat = label; pageVisible = false; }
      }
      if (node === second) { second.activeInHierarchy = false; selected = null; seat = label; pageVisible = false; }
    }
  };
  const ctx = vm.createContext({b:decoder.b, a6, cc:{Button:'Button', Sprite:'Sprite'},
    a4:()=>target, e:()=>{}, f:async()=>{}, aO:async num=>{scrolls++;pageVisible=true;return a6.scanMachines().find(r=>r.num===num)?.node || null;}});
  vm.runInContext(dictionary + readers + normalization + functions, ctx);
  const selectedOK = await ctx.aQ(ctx.aG());
  const confirmed = selectedOK === true ? await ctx.aR(ctx.aG()) : false;
  count++;
  return {selectedOK, confirmed, touches, scrolls, key:ctx.aG(), seated:a6.seatedNum(),ctx};
}
(async()=>{
  for (const [label,target] of [['021','21'],['022','22'],['004','004'],['1018','1018'],['030','30'],['070','070'],['020','20'],['028','028']]) {
    const r=await scenario({label,target});
    assert.equal(r.selectedOK,true);assert.equal(r.confirmed,true);
    assert.deepEqual(r.touches,['SlotTableItem2','selectBtn']);
    assert.equal(r.seated,String(Number(target)));assert.equal(r.scrolls,0);
  }
  const off=await scenario({offPage:true});assert.equal(off.confirmed,true);assert.equal(off.scrolls,1);
  const wrong=await scenario({label:'210'});assert.equal(wrong.selectedOK,false);assert.deepEqual(wrong.touches,[]);
  const locked=await scenario({busy:true});assert.equal(locked.selectedOK,'occupied');assert.deepEqual(locked.touches,[]);
  const stale=await scenario({stale:true});assert.equal(stale.selectedOK,false);assert.equal(await stale.ctx.aR('21'),false);assert.ok(!stale.touches.includes('selectBtn'));
  const disabled=await scenario({disabled:true});assert.equal(disabled.confirmed,false);assert.ok(!disabled.touches.includes('selectBtn'));
  const dialog=await scenario({secondary:true});assert.equal(dialog.confirmed,true);assert.deepEqual(dialog.touches,['SlotTableItem2','selectBtn','dialogConfirm']);
  const stuck=await scenario({stuck:true});assert.equal(stuck.confirmed,false);assert.deepEqual(stuck.touches,['SlotTableItem2','selectBtn']);
  const missing=await scenario({missingSeatLabel:true});assert.equal(missing.confirmed,true);assert.equal(missing.seated,'21');
  const nested=await scenario({missingSeatLabel:true,nestedSeatLabel:true});assert.equal(nested.seated,'21');
  const unconfirmed=await scenario({missingSeatLabel:true,stuck:true});assert.equal(unconfirmed.seated,null);
  assert.equal(stuck.ctx.scarabMachineKey('310131'),'310131');
  assert.equal(stuck.ctx.scarabMachineKey(null),null);
  console.log(`PASS: ${count} runtime selection/confirmation scenarios; real engine functions with simulated Cocos nodes.`);
})().catch(err=>{console.error(err);process.exitCode=1;});
