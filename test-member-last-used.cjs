const {test}=require('node:test');
const assert=require('node:assert/strict');
const {enrichLastUsed}=require('./server/member-last-used');

test('missing historical tables leave unknown times and durations unknown',async()=>{
  const members=[{username:'member',platform:'TZ',last_used_at:null}];
  await enrichLastUsed({query:async()=>({rows:[]})},members);
  assert.equal(members[0].last_used_at,null);
  assert.equal(members[0].last_usage,undefined);
});

test('existing reports backfill time without overwriting newer login or inventing a duration',async()=>{
  let step=0;
  const members=[{username:'Member',platform:'TZ',last_used_at:null},{username:'member',platform:'OFA',last_used_at:'2026-11-04T11:00:00Z'}];
  const db={query:async()=>({rows:++step===1?[{name:'public.autobac_dg_settings_records',relation:'autobac_dg_settings_records'}]:[
    {platform:'TZ',username_key:'member',used_at:'2026-11-04T09:00:00Z'},
    {platform:'OFA',username_key:'member',used_at:'2026-11-04T08:00:00Z'}]})};
  await enrichLastUsed(db,members);
  assert.equal(members[0].last_used_at,'2026-11-04T09:00:00Z');
  assert.equal(members[1].last_used_at,'2026-11-04T11:00:00Z');
  assert.equal(members[0].last_usage,undefined);
});

test('per-program durations remain attached to the verified platform and member',async()=>{
  let step=0;const record={platform:'TZ',username_key:'member',app_id:'scarab-heart',started_at:'2026-11-04T08:00:00Z',last_seen_at:'2026-11-04T09:01:05Z',duration_seconds:'3665',active:false};
  const db={query:async()=>({rows:++step===1?[{name:'public.scarab_member_usage_sessions',relation:'scarab_member_usage_sessions'}]:step===2?[]:[record]})};
  const members=[{username:'member',platform:'TZ'},{username:'member',platform:'OFA'}];
  await enrichLastUsed(db,members);
  assert.equal(members[0].last_usage.duration_seconds,'3665');
  assert.equal(members[0].program_usage['scarab-heart'],record);
  assert.equal(members[1].last_usage,null);
});
