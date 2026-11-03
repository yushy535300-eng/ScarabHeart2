'use strict';
const crypto=require('node:crypto');
const {classifyLegacyOnce}=require('./agent-classification');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const totp=require('./agent-totp');
const PERMS={create:'新增白名單',toggle:'開通／停用／恢復',extend:'修改到期日',permanent:'永久授權',assign:'調整會員代理',records:'查看使用紀錄',online:'查看聖甲在線',agents:'新增／管理旗下代理',deleteAgents:'刪除旗下代理',deleteMembers:'刪除會員'};
const ALL=Object.keys(PERMS);
const {PROGRAMS,IDS,grants,validateGrants,validateLinks,sharedLinks,ensureProgramSchema,programAllowed,entryLinks}=require('./program-access.cjs');
const programCan=(a,id)=>a.role==='root'||grants(a.program_access)[id]===true;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const can=(a,p)=>a.role==='root'||a.permissions?.[p]===true;
const inScope=(a,w)=>a.role==='root'||(a.role==='office'?String(w.office_id)===String(a.id):String(w.agent_id)===String(a.id));
const cookie=req=>String(req.headers['x-admin-token']||'')||decodeURIComponent((String(req.headers.cookie||'').match(/(?:^|;\s*)scarab_admin_token=([^;]+)/)||[])[1]||'');
async function hashPassword(p){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+(await scrypt(p,salt,64)).toString('hex');}
async function verify(p,encoded){if(!encoded)return false;const [salt,hash]=encoded.split(':');const value=await scrypt(p,salt,64);return hash?.length===128&&crypto.timingSafeEqual(value,Buffer.from(hash,'hex'));}
function registerAgentAdmin(app,{getPool,adminSessions,adminForm,ensureWhitelist}){
 const sessions=new Map(),attempts=new Map(),pendingTotp=new Map();let ready,manageQueue=Promise.resolve();
 const normalizeUsername=v=>String(v||'').trim().toLowerCase();
 const usernameValid=v=>/^[a-z][a-z0-9_-]{2,39}$/.test(v);

 const managed=fn=>async(...args)=>{let release;const previous=manageQueue;manageQueue=new Promise(r=>release=r);await previous;try{return await fn(...args);}finally{release();}};
 async function db(){const pool=getPool();if(!pool)throw Error('授權資料庫尚未設定');if(!ready)ready=(async()=>{await ensureWhitelist();await pool.query(`CREATE TABLE IF NOT EXISTS scarab_agents(id BIGSERIAL PRIMARY KEY,name VARCHAR(80) NOT NULL,role VARCHAR(16) NOT NULL CHECK(role IN ('office','agent')),parent_id BIGINT REFERENCES scarab_agents(id),password_hash TEXT,permissions JSONB NOT NULL DEFAULT '{}',enabled BOOLEAN NOT NULL DEFAULT TRUE,version INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(parent_id,name));ALTER TABLE scarab_agents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;ALTER TABLE scarab_agents ADD COLUMN IF NOT EXISTS superadmin BOOLEAN NOT NULL DEFAULT FALSE;CREATE UNIQUE INDEX IF NOT EXISTS scarab_office_name ON scarab_agents(name) WHERE role='office';ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS office_id BIGINT REFERENCES scarab_agents(id);ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS agent_id BIGINT REFERENCES scarab_agents(id);CREATE TABLE IF NOT EXISTS scarab_admin_audit(id BIGSERIAL PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT,before_data JSONB,after_data JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);const base=Object.fromEntries(ALL.map(p=>[p,p!=='permanent'&&p!=='deleteAgents'&&p!=='deleteMembers']));for(const name of ['三組部','電銷'])await pool.query(`INSERT INTO scarab_agents(name,role,permissions) VALUES($1,'office',$2) ON CONFLICT DO NOTHING`,[name,base]);const office=(await pool.query("SELECT id FROM scarab_agents WHERE role='office' AND name='三組部'")).rows[0];for(const name of ['小隻','小安','咪咪','鈞','帥哥偉','鴻','阿成'])await pool.query(`INSERT INTO scarab_agents(name,role,parent_id,permissions) VALUES($1,'agent',$2,$3) ON CONFLICT DO NOTHING`,[name,office.id,base]);await classifyLegacyOnce(pool);await ensureProgramSchema(pool);await pool.query('ALTER TABLE scarab_agents ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT NULL;ALTER TABLE scarab_agents ADD COLUMN IF NOT EXISTS totp_last_counter BIGINT NOT NULL DEFAULT -1');})();try{await ready;}catch(e){ready=null;throw e;}return pool;}
 async function identity(req){const token=cookie(req),s=sessions.get(token);if(!s||s.until<Date.now()){sessions.delete(token);adminSessions.delete(token);return null;}if(s.role==='root')return s;const pool=await db();const a=(await pool.query('SELECT * FROM scarab_agents WHERE id=$1',[s.id])).rows[0];if(!a?.enabled||a.version!==s.version)return null;if(a.superadmin)return {...a,role:'root',agentId:a.id};if(a.role==='agent'){const p=(await pool.query('SELECT * FROM scarab_agents WHERE id=$1',[a.parent_id])).rows[0];if(!p?.enabled)return null;a.permissions=Object.fromEntries(ALL.map(k=>[k,a.permissions[k]===true&&p.permissions[k]===true]));}return a;}
 async function audit(pool,a,action,target,before,after){await pool.query('INSERT INTO scarab_admin_audit(actor,action,target,before_data,after_data) VALUES($1,$2,$3,$4,$5)',[a.name,action,String(target),before||null,after||null]);}
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(e=>res.status(400).json({error:e.code==='23505'?'名稱或會員已存在':e.message||'操作失敗'}));
 app.use(['/admin','/api/admin'],wrap(async(req,res,next)=>{res.set('Cache-Control','no-store');if(req.method!=='GET'&&req.headers.origin&&req.headers.origin!==`${req.headers['x-forwarded-proto']||req.protocol}://${req.get('host')}`)return res.status(403).send('來源驗證失敗');next();}));
 app.post('/api/admin/login',adminForm,wrap(async(req,res)=>{
 const t=Date.now(),username=normalizeUsername(req.body.login_username),p=String(req.body.access_key||req.body.password||'');
 const key=crypto.createHash('sha256').update(String(req.ip||'')+'|'+username).digest('hex');
 if(attempts.size>5000)for(const [k,v]of attempts)if(t-v.at>900000)attempts.delete(k);
 let limit=attempts.get(key);if(!limit||t-limit.at>900000)limit={n:0,at:t};
 if(limit.n>=15)return res.status(429).type('html').send(page(null,'嘗試次數過多，請稍後再試'));
 let a=null;const root=String(process.env.ADMIN_PASSWORD||'').trim(),rootUser=normalizeUsername(process.env.ADMIN_USERNAME);
 // Keep the original password-only root login until ADMIN_USERNAME has been configured in Render.
 if(root&&p.trim()===root&&(rootUser?username===rootUser:username===''))a={role:'root',name:'總管理'};
 else if(username&&usernameValid(username)){const pool=await db();const found=(await pool.query('SELECT * FROM scarab_agents WHERE enabled=TRUE AND deleted_at IS NULL AND LOWER(login_username)=$1 LIMIT 1',[username])).rows[0];
 if(found?.password_hash&&await verify(p,found.password_hash)){a=found;if(a.role==='agent'&&!a.superadmin){const parent=(await pool.query('SELECT enabled FROM scarab_agents WHERE id=$1',[a.parent_id])).rows[0];if(!parent?.enabled)a=null;}}}
 if(!a){limit.n++;limit.at=t;attempts.set(key,limit);return res.status(401).type('html').send(page(null,'帳號或密碼錯誤'));}
 if(a.id){
  // The Render root identity (id missing) is deliberately exempt from TOTP.
  totp.encryptionKey();
  for(const [id,step]of pendingTotp)if(step.expires<t)pendingTotp.delete(id);
  if(pendingTotp.size>4000)pendingTotp.clear();
  const token=crypto.randomUUID(),enroll=!a.totp_secret_enc,secret=enroll?totp.newSecret():null;
  const step={id:a.id,version:a.version,expires:t+300000,tries:0,loginKey:key,setup:enroll,secret,username:a.login_username};
  if(enroll)step.qr=await totp.qrData(secret,a.login_username);
  pendingTotp.set(token,step);
  return res.type('html').send(page(null,'',null,{setup:enroll,token,secret,qr:step.qr}));
 }
 attempts.delete(key);const token=crypto.randomUUID();sessions.set(token,{id:a.id,role:a.role,name:a.name,version:a.version,until:t+28800000});adminSessions.add(token);res.cookie('scarab_admin_token',token,{httpOnly:true,sameSite:'lax',secure:req.secure||req.headers['x-forwarded-proto']==='https',maxAge:28800000});res.redirect(303,'/admin');
 }));
 app.post('/api/admin/totp-verify',adminForm,wrap(async(req,res)=>{
  const token=String(req.body.pending_token||''),step=pendingTotp.get(token),now=Date.now();
  if(!step||step.expires<now||step.tries>=6){pendingTotp.delete(token);return res.status(403).type('html').send(page(null,'驗證已逾時或嘗試次數過多，請重新登入'));}
  const key=step.loginKey,limit=attempts.get(key);
  if(limit?.n>=15){pendingTotp.delete(token);return res.status(429).type('html').send(page(null,'嘗試次數過多，請稍後再試'));}
  const pool=await db(),a=(await pool.query('SELECT * FROM scarab_agents WHERE id=$1',[step.id])).rows[0];
  if(!a?.enabled||a.deleted_at||a.version!==step.version||!a.password_hash){pendingTotp.delete(token);return res.status(403).type('html').send(page(null,'帳號狀態已變更，請重新登入'));}
  if(a.role==='agent'&&!a.superadmin){const parent=(await pool.query('SELECT enabled,deleted_at FROM scarab_agents WHERE id=$1',[a.parent_id])).rows[0];if(!parent?.enabled||parent.deleted_at){pendingTotp.delete(token);return res.status(403).type('html').send(page(null,'代理權限已停用'));}
  }
  let counter=null,secret;
  try{secret=step.setup?step.secret:totp.decryptSecret(a.totp_secret_enc);counter=totp.matchCounter(secret,req.body.totp_code,step.setup?-1:a.totp_last_counter);}catch{return res.status(503).type('html').send(page(null,'驗證服務暫時無法使用，請聯絡管理員'));}
  const bad=async()=>{
   step.tries++;let attempted=attempts.get(key);if(!attempted||now-attempted.at>900000)attempted={n:0,at:now};attempted.n++;attempts.set(key,attempted);
   if(step.tries>=6||attempted.n>=15){pendingTotp.delete(token);return res.status(403).type('html').send(page(null,'驗證次數過多，請重新登入'));}
   return res.status(403).type('html').send(page(null,'驗證碼不正確或已使用，請輸入新的 6 位數驗證碼',null,{setup:step.setup,token,secret:step.secret,qr:step.qr}));
  };
  if(counter==null)return bad();
  let authenticated;
  if(step.setup){
   if(a.totp_secret_enc){pendingTotp.delete(token);return res.status(403).type('html').send(page(null,'此帳號已完成綁定，請重新登入'));}
   const encrypted=totp.encryptSecret(secret);
   authenticated=(await pool.query('UPDATE scarab_agents SET totp_secret_enc=$1,totp_last_counter=$2,version=version+1 WHERE id=$3 AND version=$4 AND enabled=TRUE AND deleted_at IS NULL AND totp_secret_enc IS NULL RETURNING id,role,name,version',[encrypted,counter,a.id,a.version])).rows[0];
   if(authenticated)await audit(pool,a,'綁定 Google Authenticator',a.id,null,{enabled:true});
  }else{
   authenticated=(await pool.query('UPDATE scarab_agents SET totp_last_counter=$1 WHERE id=$2 AND version=$3 AND enabled=TRUE AND deleted_at IS NULL AND totp_last_counter<$1 RETURNING id,role,name,version',[counter,a.id,a.version])).rows[0];
  }
  if(!authenticated){pendingTotp.delete(token);return res.status(403).type('html').send(page(null,'驗證狀態已改變，請重新登入'));}
  pendingTotp.delete(token);attempts.delete(key);const sessionToken=crypto.randomUUID();
  sessions.set(sessionToken,{id:authenticated.id,role:authenticated.role,name:authenticated.name,version:authenticated.version,until:now+28800000});adminSessions.add(sessionToken);
  res.cookie('scarab_admin_token',sessionToken,{httpOnly:true,sameSite:'lax',secure:req.secure||req.headers['x-forwarded-proto']==='https',maxAge:28800000});
  res.redirect(303,'/admin');
 }));
 app.post('/api/admin/logout-form',(req,res)=>{const t=cookie(req);sessions.delete(t);adminSessions.delete(t);res.clearCookie('scarab_admin_token',{path:'/'});res.redirect(303,'/admin');});
 app.get(['/admin','/admin/'],wrap(async(req,res)=>{const a=await identity(req);res.type('html').send(page(a));}));
 app.use('/api/admin',wrap(async(req,res,next)=>{const a=await identity(req);if(!a)return res.status(401).json({error:'登入已失效，請重新登入'});req.agentIdentity=a;const m=req.path.match(/^\/whitelist\/(\d+)\/(records|usage|settings|acknowledgements)$/);if(m){if(!can(a,'records'))return res.status(403).send('未開放使用紀錄');const pool=await db();const w=(await pool.query('SELECT * FROM tz_whitelist WHERE id=$1',[m[1]])).rows[0];if(!w||!inScope(a,w))return res.status(404).send('找不到會員');return next();}if(req.path.startsWith('/agent/'))return next();if(a.role!=='root')return res.status(403).json({error:'未開放此功能'});next();}));
 app.use('/admin/online',wrap(async(req,res)=>{const a=await identity(req);if(!a)return res.redirect(303,'/admin');const appId=String(req.query.app||'scarab-heart');if(!['scarab-heart','autobac','baccarat-helper'].includes(appId)||!programCan(a,appId))return res.status(403).send('未開放此程式');res.redirect(303,'/admin?view=online&app='+encodeURIComponent(appId));}));
 app.get('/api/admin/agent/data',wrap(async(req,res)=>{const a=req.agentIdentity,pool=await db();const agents=(await pool.query('SELECT id,name,login_username,role,parent_id,permissions,enabled,superadmin,program_access,program_links,ref_slug,password_hash IS NOT NULL AS has_password FROM scarab_agents WHERE deleted_at IS NULL ORDER BY id')).rows.filter(x=>a.role==='root'||String(x.id)===String(a.id)||a.role==='office'&&String(x.parent_id)===String(a.id));const ws=(await pool.query('SELECT w.*,o.name AS office_name,a.name AS agent_name FROM tz_whitelist w LEFT JOIN scarab_agents o ON o.id=w.office_id LEFT JOIN scarab_agents a ON a.id=w.agent_id ORDER BY w.updated_at DESC')).rows.filter(x=>inScope(a,x));for(const x of agents){x.programs_allowed=IDS.filter(id=>x.superadmin||grants(x.program_access)[id]);x.entry_links=entryLinks(x);if(a.role!=='root')delete x.program_access;}res.json({identity:{id:a.id,role:a.role,name:a.name,program_access:a.role==='root'?Object.fromEntries(IDS.map(id=>[id,true])):grants(a.program_access),permissions:Object.fromEntries(ALL.map(k=>[k,can(a,k)]))},agents,whitelist:ws});}));
 app.get('/api/admin/agent/online',wrap(async(req,res)=>{
const a=req.agentIdentity;
const appId=String(req.query.app||'scarab-heart');if(!['scarab-heart','autobac','baccarat-helper'].includes(appId)||!programCan(a,appId))return res.status(403).json({error:'未開放此程式'});
const pool=await db();await require('./user-presence').ensureUserPresence(pool);
let scope=a.role==='root'?'TRUE':a.role==='office'?'w.office_id=$2':'w.agent_id=$2',params=a.role==='root'?[appId]:[appId,a.id];
if(a.role==='root'&&req.query.own==='1'){const mine=(await pool.query("SELECT id FROM scarab_agents WHERE superadmin=TRUE AND role='agent' ORDER BY id LIMIT 1")).rows[0];scope='w.agent_id=$2';params=[appId,mine?.id||0];}
if(req.query.agent){const agent=(await pool.query("SELECT id,parent_id FROM scarab_agents WHERE id=$1 AND role='agent' AND deleted_at IS NULL",[req.query.agent])).rows[0];if(!agent||!inScope(a,{office_id:agent.parent_id,agent_id:agent.id}))return res.status(403).json({error:'無權查看此代理'});scope='w.agent_id=$2';params=[appId,agent.id];}
const rows=(await pool.query(`SELECT p.platform,p.username_key,p.opened_at,p.last_seen_at,w.username,w.agent_id,w.office_id,w.program_access,ag.name AS agent_name,o.name AS office_name FROM autobac_user_presence p JOIN tz_whitelist w ON UPPER(w.platform)=UPPER(p.platform) AND LOWER(w.username)=LOWER(p.username_key) LEFT JOIN scarab_agents ag ON ag.id=w.agent_id LEFT JOIN scarab_agents o ON o.id=w.office_id WHERE p.app_id=$1 AND p.last_seen_at>NOW()-INTERVAL '25 seconds' AND w.enabled=TRUE AND (w.expires_at IS NULL OR w.expires_at>NOW()) AND ${scope}`,params)).rows;
const unique=new Map();for(const row of rows){if(!await programAllowed(pool,row,appId))continue;const key=String(row.platform).toUpperCase()+':'+String(row.username_key).toLowerCase();const prior=unique.get(key);if(!prior)unique.set(key,{platform:row.platform,username:row.username,agent_id:row.agent_id,office_id:row.office_id,agent_name:row.agent_name,office_name:row.office_name,openedAt:row.opened_at||null});else if(!row.opened_at||!prior.openedAt)prior.openedAt=null;else if(new Date(row.opened_at)<new Date(prior.openedAt))prior.openedAt=row.opened_at;}
res.json({online:unique.size,appId,users:[...unique.values()]});
}));
 app.get('/api/admin/agent/programs',wrap(async(req,res)=>{
const a=req.agentIdentity,pool=await db();await require('./user-presence').ensureUserPresence(pool);
let scope=a.role==='root'?'TRUE':a.role==='office'?'w.office_id=$1':'w.agent_id=$1',params=a.role==='root'?[]:[a.id];
if(a.role==='root'&&req.query.own==='1'){const mine=(await pool.query("SELECT id FROM scarab_agents WHERE superadmin=TRUE AND role='agent' ORDER BY id LIMIT 1")).rows[0];scope='w.agent_id=$1';params=[mine?.id||0];}
const rows=(await pool.query(`SELECT DISTINCT p.app_id,p.platform,p.username_key,w.agent_id,w.program_access FROM autobac_user_presence p JOIN tz_whitelist w ON UPPER(w.platform)=UPPER(p.platform) AND LOWER(w.username)=LOWER(p.username_key) WHERE w.enabled=TRUE AND (w.expires_at IS NULL OR w.expires_at>NOW()) AND p.last_seen_at>NOW()-INTERVAL '25 seconds' AND ${scope}`,params)).rows;
const applications=[];for(const id of IDS){if(!programCan(a,id))continue;const keys=new Set();for(const row of rows)if(row.app_id===id&&await programAllowed(pool,row,id))keys.add(String(row.platform).toUpperCase()+':'+String(row.username_key).toLowerCase());applications.push({appId:id,onlineAccounts:keys.size});}res.json({applications});
}));
 app.post('/api/admin/agent/totp-reset',require('express').json(),wrap(managed(async(req,res)=>{
  const admin=req.agentIdentity;
  if(admin.role!=='root')return res.status(403).json({error:'只有最高管理員可以重置驗證器'});
  const id=Number(req.body?.id);
  if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:'代理資料錯誤'});
  const pool=await db(),agent=(await pool.query('SELECT id,name,totp_secret_enc FROM scarab_agents WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];
  if(!agent)return res.status(404).json({error:'找不到代理'});
  const updated=(await pool.query('UPDATE scarab_agents SET totp_secret_enc=NULL,totp_last_counter=-1,version=version+1 WHERE id=$1 AND deleted_at IS NULL RETURNING id',[id])).rows[0];
  if(!updated)return res.status(404).json({error:'代理已變更'});
  for(const [token,s]of sessions)if(String(s.id)===String(id)){sessions.delete(token);adminSessions.delete(token);}
  for(const [token,p]of pendingTotp)if(String(p.id)===String(id))pendingTotp.delete(token);
  await audit(pool,admin,'重置 Google Authenticator',id,{enabled:!!agent.totp_secret_enc},{enabled:false});
  res.json({ok:true});
 })));
 app.post('/api/admin/agent/username',require('express').json(),wrap(managed(async(req,res)=>{
 const a=req.agentIdentity;
 if(!a.id)return res.status(403).json({error:'最高管理員帳號請在 Render 的 ADMIN_USERNAME 設定'});
 const b=req.body||{},username=normalizeUsername(b.new_username);
 if(!usernameValid(username))return res.status(400).json({error:'登入帳號需 3～40 字，以英文開頭，僅能使用英文字母、數字、底線及減號'});
 if(username===normalizeUsername(process.env.ADMIN_USERNAME))return res.status(409).json({error:'此登入帳號已保留給最高管理員'});
 const pool=await db();
 const stored=(await pool.query('SELECT * FROM scarab_agents WHERE id=$1',[a.id])).rows[0];
 if(!stored?.enabled||stored.deleted_at||!stored.password_hash)return res.status(403).json({error:'登入帳號目前不可修改'});
 if(!await verify(String(b.current_password||''),stored.password_hash))return res.status(403).json({error:'目前密碼不正確'});
 if(await verify(username,stored.password_hash))return res.status(400).json({error:'登入帳號不得與密碼相同'});
 if(username===normalizeUsername(stored.login_username))return res.json({ok:true,unchanged:true,login_username:username});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const other=(await client.query('SELECT id FROM scarab_agents WHERE LOWER(login_username)=$1 AND id<>$2 LIMIT 1',[username,a.id])).rows[0];
  if(other){await client.query('ROLLBACK');return res.status(409).json({error:'此登入帳號已被使用，請換一個'});}
  const saved=(await client.query('UPDATE scarab_agents SET login_username=$1,version=version+1 WHERE id=$2 AND version=$3 AND enabled=TRUE AND deleted_at IS NULL RETURNING id',[username,a.id,stored.version])).rows[0];
  if(!saved)throw Error('帳號資料已變更，請重新登入後再試');
  await audit(client,a,'修改自己的登入帳號',a.id,{login_username:stored.login_username},{login_username:username});
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});if(e.code==='23505')return res.status(409).json({error:'此登入帳號已被使用，請換一個'});throw e;}finally{client.release();}
 for(const [token,session]of sessions)if(String(session.id)===String(a.id)){sessions.delete(token);adminSessions.delete(token);}
 res.clearCookie('scarab_admin_token',{path:'/'});
 return res.json({ok:true,login_username:username,relogin:true});
 })));
 app.post('/api/admin/agent/password',require('express').json(),wrap(managed(async(req,res)=>{
const a=req.agentIdentity;if(!a.id)return res.status(400).json({error:'此總管理密碼請到 Render 設定中修改'});
const b=req.body,p=String(b.new_password||'');if(!p)throw Error('請輸入新密碼');if(p!==String(b.confirm_password||''))throw Error('兩次輸入的新密碼不一致');
const pool=await db(),stored=(await pool.query('SELECT * FROM scarab_agents WHERE id=$1',[a.id])).rows[0];
if(!stored||!stored.enabled||stored.deleted_at||!await verify(String(b.current_password||''),stored.password_hash))return res.status(400).json({error:'目前密碼不正確'});
if(p.trim()===String(process.env.ADMIN_PASSWORD||'').trim()||normalizeUsername(p)===normalizeUsername(stored.login_username))throw Error('新密碼不可與帳號相同，也不可與總管理密碼相同');
const others=(await pool.query('SELECT id,password_hash FROM scarab_agents WHERE password_hash IS NOT NULL AND id<>$1',[a.id])).rows;for(const x of others)if(await verify(p,x.password_hash))throw Error('此密碼已使用，請更換');
const hash=await hashPassword(p),client=await pool.connect();let saved;try{await client.query('BEGIN');saved=(await client.query('UPDATE scarab_agents SET password_hash=$1,version=version+1 WHERE id=$2 AND version=$3 AND enabled=TRUE AND deleted_at IS NULL RETURNING id,role,name,version',[hash,a.id,stored.version])).rows[0];if(!saved)throw Error('帳號設定已變更，請重新登入後再試');await audit(client,a,'自行修改密碼',a.id,null,{name:a.name,passwordReset:true});await client.query('COMMIT');}catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
for(const [token,session]of sessions)if(String(session.id)===String(a.id)){sessions.delete(token);adminSessions.delete(token);}
const token=crypto.randomUUID();sessions.set(token,{...saved,until:Date.now()+28800000});adminSessions.add(token);res.cookie('scarab_admin_token',token,{httpOnly:true,sameSite:'lax',secure:req.secure||req.headers['x-forwarded-proto']==='https',maxAge:28800000});res.json({ok:true});
})));
 app.post('/api/admin/agent/delete',require('express').json(),wrap(managed(async(req,res)=>{
const a=req.agentIdentity,b=req.body;if(a.role!=='root'&&!(a.role==='office'&&can(a,'deleteAgents')))return res.status(403).json({error:'未開放刪除代理權限'});
const pool=await db(),client=await pool.connect();try{await client.query('BEGIN');const source=(await client.query("SELECT * FROM scarab_agents WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[b.id])).rows[0];if(!source||source.role!=='agent'||source.superadmin)throw Error('此管理身分不可刪除');if(a.role!=='root'&&String(source.parent_id)!==String(a.id))throw Error('無權刪除此代理');
const members=(await client.query('SELECT id FROM tz_whitelist WHERE agent_id=$1 FOR UPDATE',[source.id])).rows;
let target=null;if(b.target_id){target=(await client.query("SELECT * FROM scarab_agents WHERE id=$1 AND role='agent' AND enabled=TRUE AND deleted_at IS NULL FOR UPDATE",[b.target_id])).rows[0];if(!target||String(target.id)===String(source.id)||a.role!=='root'&&String(target.parent_id)!==String(a.id))throw Error('請選擇可接收會員的代理');}
if(members.length&&!target)throw Error('此代理仍有會員，請先選擇接收代理');
if(target)await client.query('UPDATE tz_whitelist SET agent_id=$1,office_id=$2,updated_at=NOW() WHERE agent_id=$3',[target.id,target.parent_id,source.id]);
await client.query('UPDATE scarab_agents SET enabled=FALSE,password_hash=NULL,deleted_at=NOW(),version=version+1 WHERE id=$1',[source.id]);
await audit(client,a,'刪除代理並移轉會員',source.id,{name:source.name,memberCount:members.length},{name:source.name,targetAgent:target?.name||null,targetAgentId:target?.id||null,movedCount:members.length,movedMembers:members.map(w=>w.id)});
await client.query('COMMIT');res.json({ok:true,moved:members.length});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
})));
 app.post('/api/admin/agent/manage',require('express').json(),wrap(managed(async(req,res)=>{const a=req.agentIdentity,b=req.body,pool=await db();if(a.role!=='root'&&!(a.role==='office'&&can(a,'agents')))return res.status(403).json({error:'無管理代理權限'});const role=b.role==='office'?'office':'agent';if(role==='office'&&a.role!=='root')throw Error('只有總管理能建立辦公室');const old=b.id?(await pool.query('SELECT * FROM scarab_agents WHERE id=$1',[b.id])).rows[0]:null;if(b.id&&(!old||old.deleted_at))throw Error('找不到代理');if(old?.superadmin&&a.role!=='root')throw Error('只有最高管理員可修改此代理');if(old&&(old.role!==role||a.role!=='root'&&String(old.parent_id)!==String(a.id)))throw Error('無權管理此代理');const name=String(b.name||'').trim();if(!name||name.length>80)throw Error('請填寫代理名稱');const parent=role==='office'?null:(old?.parent_id||(a.role==='office'?a.id:b.parent_id));if(role==='agent'){const office=(await pool.query("SELECT * FROM scarab_agents WHERE id=$1 AND role='office'",[parent])).rows[0];if(!office)throw Error('請選擇辦公室');}const permissions=Object.fromEntries(ALL.map(k=>[k,b.permissions?.[k]===true]));if(a.role!=='root')for(const k of ALL)if(permissions[k]&&!can(a,k))throw Error('不能授予未開放的權限');if(b.program_access!=null&&a.role!=='root')throw Error('只有最高管理員可設定程式開關');
const programAccess=a.role==='root'&&b.program_access!=null?validateGrants(b.program_access):old?.program_access??{'scarab-heart':a.role==='root','baccarat-helper':false,autobac:false};
const links=b.program_links!==undefined?validateLinks(b.program_links):validateLinks({shared:sharedLinks(old)});
const username=normalizeUsername(b.login_username||old?.login_username||'');
if(!usernameValid(username))throw Error('登入帳號須為 3～40 字的英文、數字、底線或減號，並以英文開頭');
if(username===normalizeUsername(process.env.ADMIN_USERNAME))throw Error('此登入帳號已保留給總管理員');
if((await pool.query('SELECT id FROM scarab_agents WHERE LOWER(login_username)=$1 AND id<>$2 AND deleted_at IS NULL',[username,old?.id||0])).rows.length)throw Error('代理登入帳號已存在');
const slug=old?.ref_slug||crypto.randomUUID();
let hashed=old?.password_hash||null;if(b.password){const p=String(b.password);if(normalizeUsername(p)===username)throw Error('登入密碼不得與代理帳號相同');if(p.trim()===String(process.env.ADMIN_PASSWORD||'').trim())throw Error('此密碼已使用');const all=(await pool.query('SELECT id,password_hash FROM scarab_agents WHERE password_hash IS NOT NULL')).rows;for(const x of all)if(String(x.id)!==String(old?.id)&&await verify(p,x.password_hash))throw Error('此密碼已使用，請更換');hashed=await hashPassword(p);}if(hashed&&await verify(username,hashed))throw Error('登入密碼不得與代理帳號相同');if(!old&&!hashed)throw Error('新增代理時請設定密碼');const enabled=b.enabled!==false;const client=await pool.connect();try{await client.query('BEGIN');const saved=old?(await client.query('UPDATE scarab_agents SET name=$1,password_hash=$2,permissions=$3,enabled=$4,version=version+1 WHERE id=$5 RETURNING id',[name,hashed,permissions,enabled,old.id])).rows[0]:(await client.query('INSERT INTO scarab_agents(name,role,parent_id,password_hash,permissions,enabled) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[name,role,parent,hashed,permissions,enabled])).rows[0];await client.query('UPDATE scarab_agents SET program_access=$1,program_links=$2,ref_slug=$3,login_username=$5 WHERE id=$4',[programAccess,links,slug,saved.id,username]);
await audit(client,a,old?'修改代理':'新增代理',saved.id,old?{name:old.name,permissions:old.permissions,enabled:old.enabled}:null,{name,role,parent,permissions,enabled,program_access:programAccess,program_links:links,login_username:username,passwordReset:!!b.password});await client.query('COMMIT');res.json({ok:true});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}})));
 app.post('/api/admin/agent/member',require('express').json(),wrap(async(req,res)=>{const a=req.agentIdentity,b=req.body,pool=await db(),client=await pool.connect();try{await client.query('BEGIN');const old=b.id?(await client.query('SELECT * FROM tz_whitelist WHERE id=$1 FOR UPDATE',[b.id])).rows[0]:null;if(b.id&&(!old||!inScope(a,old)))throw Error('找不到會員');const op=b.op||'save';if(op==='assign'){if(!can(a,'assign'))throw Error('未開放調整歸屬');const ids=Array.isArray(b.ids)?b.ids:[b.id];if(!ids.length||ids.length>500)throw Error('一次請選擇 1～500 位會員');const agent=(await client.query("SELECT * FROM scarab_agents WHERE id=$1 AND role='agent' AND enabled=TRUE AND deleted_at IS NULL FOR UPDATE",[b.agent_id])).rows[0];if(!agent||a.role==='agent'||a.role==='office'&&String(agent.parent_id)!==String(a.id))throw Error('請選擇有權管理的代理');for(const id of ids){const w=(await client.query('SELECT * FROM tz_whitelist WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!w||!inScope(a,w))throw Error('包含無權操作的會員');await client.query('UPDATE tz_whitelist SET office_id=$1,agent_id=$2,updated_at=NOW() WHERE id=$3',[agent.parent_id,agent.id,id]);await audit(client,a,'調整會員歸屬',id,w,{office_id:agent.parent_id,agent_id:agent.id});}}else if(op==='programs'){
if(!old||!can(a,'toggle'))throw Error('未開放修改程式權限');const next=validateGrants(b.program_access),prior=grants(old.program_access,true);
const owner=old.agent_id?(await client.query('SELECT * FROM scarab_agents WHERE id=$1 FOR UPDATE',[old.agent_id])).rows[0]:null;
for(const id of IDS)if(next[id]!==prior[id]&&a.role!=='root'&&(!programCan(a,id)||!owner||!grants(owner.program_access)[id]))throw Error('無權調整此程式');
await client.query('UPDATE tz_whitelist SET program_access=$1,updated_at=NOW() WHERE id=$2',[next,old.id]);await audit(client,a,'修改會員程式開關',old.id,{program_access:prior},{program_access:next});
}else if(op==='delete'){if(!old||!can(a,'deleteMembers'))throw Error('未開放刪除會員權限');if(String(b.confirm_username||'')!==String(old.username))throw Error('會員確認資料已變更，請重新開啟詳情');await audit(client,a,'刪除會員',old.id,old,{username:old.username,platform:old.platform,deleted:true});await client.query('DELETE FROM tz_whitelist WHERE id=$1',[old.id]);}else if(op==='toggle'){if(!old||!can(a,'toggle'))throw Error('未開放啟用／停用');await client.query('UPDATE tz_whitelist SET enabled=$1,updated_at=NOW() WHERE id=$2',[!old.enabled,old.id]);await audit(client,a,'切換會員授權',old.id,old,{enabled:!old.enabled});}else if(op==='extend'||op==='permanent'){if(!old||!can(a,op==='permanent'?'permanent':'extend'))throw Error('未開放此授權操作');const extendDays=Number(b.days||30);if(!Number.isInteger(extendDays)||extendDays<1||extendDays>3650)throw Error('授權天數不正確');await client.query(op==='permanent'?'UPDATE tz_whitelist SET expires_at=NULL,updated_at=NOW() WHERE id=$1':"UPDATE tz_whitelist SET expires_at=GREATEST(COALESCE(expires_at,NOW()),NOW())+($2::text||' days')::interval,updated_at=NOW() WHERE id=$1",op==='permanent'?[old.id]:[old.id,extendDays]);await audit(client,a,op==='permanent'?'設定永久':`延長${extendDays}天`,old.id,old,{op});}else if(op==='details'){
if(!old||!can(a,'assign'))throw Error('未開放修改會員資料');
let agent_id=old.agent_id,office_id=old.office_id;
if(b.agent_id&&String(b.agent_id)!==String(old.agent_id)){
 const ag=(await client.query("SELECT * FROM scarab_agents WHERE id=$1 AND role='agent' AND enabled=TRUE AND deleted_at IS NULL FOR UPDATE",[b.agent_id])).rows[0];
 if(!ag||a.role==='agent'||a.role==='office'&&String(ag.parent_id)!==String(a.id))throw Error('無權移轉到此代理');
 agent_id=ag.id;office_id=ag.parent_id;
}
const note=String(b.note??old.note??'').slice(0,255);
await client.query('UPDATE tz_whitelist SET office_id=$1,agent_id=$2,note=$3,updated_at=NOW() WHERE id=$4',[office_id,agent_id,note,old.id]);
await audit(client,a,'修改會員資料',old.id,{office_id:old.office_id,agent_id:old.agent_id,note:old.note},{office_id,agent_id,note});
}else if(op==='note'){if(!old||!can(a,'assign'))throw Error('未開放修改備註');const note=String(b.note||'').slice(0,255);await client.query('UPDATE tz_whitelist SET note=$1,updated_at=NOW() WHERE id=$2',[note,old.id]);await audit(client,a,'修改備註',old.id,{note:old.note},{note});}else if(op==='save'){if(!can(a,'create'))throw Error('未開放新增白名單');const username=String(b.username||'').trim(),platform=String(b.platform||'').toUpperCase(),days=Number(b.days),permanent=b.days==='permanent';if(!username||username.length>128||!['TZ','OFA'].includes(platform))throw Error('請確認平台及會員帳號');if(permanent&&!can(a,'permanent'))throw Error('未開放永久授權');if(!permanent&&(!Number.isInteger(days)||days<1||days>3650))throw Error('授權天數不正確');const agent=(await client.query("SELECT * FROM scarab_agents WHERE id=$1 AND role='agent' AND enabled=TRUE AND deleted_at IS NULL FOR UPDATE",[a.role==='agent'?a.id:b.agent_id])).rows[0];if(!agent||a.role==='office'&&String(agent.parent_id)!==String(a.id))throw Error('請選擇所屬代理');const programs=b.program_access===undefined?{'scarab-heart':true,'baccarat-helper':false,autobac:false}:validateGrants(b.program_access);
for(const id of IDS)if(programs[id]&&a.role!=='root'&&(!programCan(a,id)||!grants(agent.program_access)[id]))throw Error('未開放此程式');
const exists=(await client.query('SELECT id FROM tz_whitelist WHERE UPPER(platform)=$1 AND LOWER(username)=LOWER($2)',[platform,username])).rows[0];if(exists)throw Error('此平台帳號已建立，請搜尋原會員或聯繫總管理');const w=(await client.query("INSERT INTO tz_whitelist(username,platform,enabled,expires_at,note,office_id,agent_id,program_access) VALUES($1,$2,TRUE,CASE WHEN $3::integer IS NULL THEN NULL ELSE NOW()+($3::text||' days')::interval END,$4,$5,$6,$7) RETURNING id",[username,platform,permanent?null:days,String(b.note||'').slice(0,255),agent.parent_id,agent.id,programs])).rows[0];await audit(client,a,'新增會員',w.id,null,{username,platform,agent_id:agent.id,days:b.days});}else throw Error('不支援此操作');await client.query('COMMIT');res.json({ok:true});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}));
 app.get('/api/admin/agent/audit',wrap(async(req,res)=>{if(req.agentIdentity.role!=='root')return res.status(403).json({error:'只有總管理可查看'});const pool=await db();res.json({rows:(await pool.query('SELECT * FROM scarab_admin_audit ORDER BY id DESC LIMIT 200')).rows});}));
 return {identity};
}
const {page}=require('./agent-admin-page');
module.exports={registerAgentAdmin,can,inScope,hashPassword,verify,PERMS,page};
