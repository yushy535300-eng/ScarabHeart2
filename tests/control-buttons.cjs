const assert=require('node:assert/strict');
const {dispatchGameCommand}=require('../public/room-command');
const boards={composite:[{roomId:'310021',machineNum:'021'}]};
function run(command){
 const actions=[];
 const accepted=dispatchGameCommand(command,boards,{
  navigate:destination=>actions.push(['navigate',destination]),
  pick:room=>actions.push(['pick',room.machineNum,room.roomId]),
  invalid:()=>actions.push(['invalid'])
 });
 return {accepted,actions};
}
assert.deepEqual(run('https://__sethcmd__/rooms'),{accepted:true,actions:[['navigate','rooms']]});
assert.deepEqual(run('https://__sethcmd__/home'),{accepted:true,actions:[['navigate','home']]});
assert.deepEqual(run('https://__sethcmd__/pick?ri=&mn=021'),{accepted:true,actions:[['navigate','rooms'],['pick','021','310021']]});
assert.deepEqual(run('https://__sethcmd__/pick?ri=&mn=099').actions,[['navigate','rooms'],['pick','099','']]);
assert.deepEqual(run('https://unrelated.example/home'),{accepted:false,actions:[]});
console.log('PASS: reselect-machine returns to room page; game-center returns home; recommendation returns and starts its selected room.');
