'use strict';
const AGENTS=['小隻','小安','咪咪','鈞','帥哥偉','鴻','阿成'];
function classifyLegacyNote(value){
 const note=String(value??'').normalize('NFKC').trim();
 const compact=note.replace(/[\s\-—–－_：:，,。．.、/\\()（）「」【】\[\]]/g,'');
 const matches=AGENTS.filter(name=>note.includes(name));
 if(!matches.includes('咪咪')&&/(^|[\s：:、，,／/\-])(咪)(?=$|[\s：:、，,／/\-])/.test(note))matches.push('咪咪');
 if(matches.length===1)return matches[0];
 if(compact==='成')return '阿成';
 if(compact==='本咪')return '咪咪';
 if(matches.length>1)return null;
 if(!compact||compact==='未設定'||/^未儲值(?:明天|每天)(?:查看|檢查)$/.test(compact))return '小隻';
 return null;
}
async function classifyLegacyOnce(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS scarab_admin_migrations(name TEXT PRIMARY KEY,summary JSONB,completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const claimed=await client.query(`INSERT INTO scarab_admin_migrations(name) VALUES('legacy-note-ownership-v1') ON CONFLICT DO NOTHING RETURNING name`);
  if(!claimed.rows.length){await client.query('COMMIT');return null;}
  const agents=(await client.query(`SELECT a.id,a.name,a.parent_id FROM scarab_agents a JOIN scarab_agents o ON o.id=a.parent_id WHERE a.role='agent' AND o.role='office' AND o.name='三組部'`)).rows;
  const byName=new Map(agents.map(a=>[a.name,a]));
  if(AGENTS.some(name=>!byName.has(name)))throw Error('三組部代理資料未完成，暫停舊名單分類');
  await client.query('UPDATE scarab_agents SET superadmin=TRUE,version=version+1 WHERE id=$1',[byName.get('小隻').id]);
  const rows=(await client.query('SELECT * FROM tz_whitelist WHERE agent_id IS NULL ORDER BY id')).rows;
  const summary={classified:0,unresolved:0,byAgent:{}};
  for(const w of rows){
   const name=classifyLegacyNote(w.note),agent=byName.get(name);
   if(!agent){summary.unresolved++;continue;}
   await client.query('UPDATE tz_whitelist SET office_id=$1,agent_id=$2 WHERE id=$3 AND agent_id IS NULL',[agent.parent_id,agent.id,w.id]);
   await client.query(`INSERT INTO scarab_admin_audit(actor,action,target,before_data,after_data) VALUES($1,$2,$3,$4,$5)`,['系統一次性分類','依舊備註設定代理',String(w.id),{office_id:w.office_id,agent_id:w.agent_id},{office_id:agent.parent_id,agent_id:agent.id,agent_name:name}]);
   summary.classified++;summary.byAgent[name]=(summary.byAgent[name]||0)+1;
  }
  await client.query(`UPDATE scarab_admin_migrations SET summary=$1 WHERE name='legacy-note-ownership-v1'`,[summary]);
  await client.query('COMMIT');console.info('[agent-classification-v1]',JSON.stringify(summary));return summary;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
module.exports={classifyLegacyNote,classifyLegacyOnce};
