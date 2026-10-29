'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {classifyLegacyNote,classifyLegacyOnce}=require('./server/agent-classification');const {newDb}=require('pg-mem');
test('one-time legacy classification uses only clear names and exact fallback notes',()=>{
for(const value of [null,'',' ','-','—','－','未設定','- 未設定','未儲值明天查看','未儲值 明天查看'])assert.equal(classifyLegacyNote(value),'小隻',String(value));
for(const name of ['小隻','小安','咪咪','鈞','帥哥偉','鴻','阿成'])assert.equal(classifyLegacyNote(name+' 會員'),'咪咪'===name?'咪咪':name);
assert.equal(classifyLegacyNote('咪'),'咪咪');assert.equal(classifyLegacyNote('本咪'),'咪咪');assert.equal(classifyLegacyNote('成'),'阿成');assert.equal(classifyLegacyNote('未儲值明天檢查'),'小隻');assert.equal(classifyLegacyNote('小安 未儲值明天查看'),'小安');assert.equal(classifyLegacyNote('小安／咪咪'),null);assert.equal(classifyLegacyNote('未儲值'),null);assert.equal(classifyLegacyNote('其他說明'),null);
});
test('migration preserves grants and notes, assigns OFA too, and never runs on future notes',async()=>{
const db=newDb({noAstCoverageCheck:true}),{Pool}=db.adapters.createPg(),pool=new Pool();await pool.query(`CREATE TABLE scarab_agents(id BIGSERIAL PRIMARY KEY,name TEXT,role TEXT,parent_id BIGINT,superadmin BOOLEAN DEFAULT FALSE,version INT DEFAULT 1);CREATE TABLE tz_whitelist(id BIGSERIAL PRIMARY KEY,username TEXT,platform TEXT,note TEXT,office_id BIGINT,agent_id BIGINT,enabled BOOLEAN,expires_at TIMESTAMPTZ,updated_at TIMESTAMPTZ);CREATE TABLE scarab_admin_audit(actor TEXT,action TEXT,target TEXT,before_data JSONB,after_data JSONB)`);
const office=(await pool.query("INSERT INTO scarab_agents(name,role) VALUES('三組部','office') RETURNING id")).rows[0];for(const name of ['小隻','小安','咪咪','鈞','帥哥偉','鴻','阿成'])await pool.query("INSERT INTO scarab_agents(name,role,parent_id) VALUES($1,'agent',$2)",[name,office.id]);
for(const [name,note,platform]of [['a','-','TZ'],['b','未儲值明天查看','OFA'],['c','咪','TZ'],['d','小安','TZ'],['e','未知備註','OFA']])await pool.query("INSERT INTO tz_whitelist(username,note,platform,enabled,expires_at,updated_at) VALUES($1,$2,$3,FALSE,'2027-01-01','2026-10-01')",[name,note,platform]);
const before=(await pool.query('SELECT * FROM tz_whitelist ORDER BY id')).rows;const summary=await classifyLegacyOnce(pool);assert.equal(summary.classified,4);assert.equal(summary.unresolved,1);const after=(await pool.query('SELECT * FROM tz_whitelist ORDER BY id')).rows;
for(let i=0;i<before.length;i++){for(const key of ['username','platform','note','enabled','expires_at','updated_at'])assert.deepEqual(after[i][key],before[i][key]);}
assert.equal((await pool.query("SELECT superadmin FROM scarab_agents WHERE name='小隻'")).rows[0].superadmin,true);
await pool.query("UPDATE tz_whitelist SET note='小隻' WHERE username='d'");await pool.query("INSERT INTO tz_whitelist(username,note) VALUES('new','-')");assert.equal(await classifyLegacyOnce(pool),null);assert.equal((await pool.query("SELECT agent_id FROM tz_whitelist WHERE username='new'")).rows[0].agent_id,null);assert.equal(after[3].agent_id,(await pool.query("SELECT agent_id FROM tz_whitelist WHERE username='d'")).rows[0].agent_id);
});
