'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'signal-clock-test-'));
process.env.SIGNAL_CLOCK_PATH=path.join(folder,'clock.json');delete process.env.DATABASE_URL;
const clock=require('./signal-clock.cjs');
(async()=>{try{
 const start=1800000000000,end=start+245000;
 const old=await clock.get('golden-seth','022',start);
 const fresh=await clock.rotate('golden-seth','22',old.id,end);
 assert.notEqual(fresh.id,old.id);assert.deepEqual(await clock.get('golden-seth','022',end),fresh);
 assert.equal((await clock.get('golden-seth','22',end+599999)).id,fresh.id);
 assert.notEqual((await clock.get('golden-seth','22',end+600000)).id,fresh.id);
 assert.deepEqual(await clock.rotate('golden-seth','22',old.id,end+1000),await clock.get('golden-seth','22',end+1000),'stale duplicate must not reset countdown');
 delete require.cache[require.resolve('./signal-clock.cjs')];assert.equal((await require('./signal-clock.cjs').get('golden-seth','22',end+1000)).id,fresh.id);
 console.log('PASS: shared room free-end reset, exact new 10-minute epoch, duplicate guard, restart persistence');
}finally{fs.rmSync(folder,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
