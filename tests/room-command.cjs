const assert=require('node:assert/strict');
const {findRecommendedRoom,roomKey}=require('../public/room-command');
const rows={
 composite:[{roomId:'',machineNum:'021'},{roomId:'310222',machineNum:'022'}],
 bonus:[{roomId:'902110',machineNum:'110'}]
};
assert.equal(findRecommendedRoom(rows,'','022').machineNum,'022');
assert.equal(findRecommendedRoom(rows,'310222','999').roomId,'310222');
assert.equal(findRecommendedRoom(rows,'','110').board,'bonus');
assert.equal(findRecommendedRoom(rows,'','999').machineNum,'999');
assert.equal(findRecommendedRoom(rows,'',''),null);
assert.equal(roomKey('021'),'21');
assert.equal(roomKey('022'),'22');
console.log('PASS: empty roomId, machine-number matching, roomId match, other recommendation boards, stale-list fallback, and padded labels.');
