'use strict';
const fs=require('node:fs'),path=require('node:path');
const {recipe}=require('./signal-rules.cjs');
const filename=process.env.SIGNAL_CLOCK_PATH||path.join(__dirname,'signal-clock-state.json');
let state={};try{state=JSON.parse(fs.readFileSync(filename,'utf8'));}catch{}
let pool,ready;
function db(){if(!process.env.DATABASE_URL)return null;if(!pool){const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)?false:{rejectUnauthorized:false}});ready=pool.query('CREATE TABLE IF NOT EXISTS scarab_signal_clock (room_key TEXT PRIMARY KEY, started_at BIGINT NOT NULL)');}return pool;}
async function get(game,room,now=Date.now()){
 if(!recipe(game,room,now))return null;
 const key=game+':'+Number(room),p=db();let anchor=state[key]??null;
 if(p){await ready;const r=await p.query('SELECT started_at FROM scarab_signal_clock WHERE room_key=$1',[key]);anchor=r.rows.length?Number(r.rows[0].started_at):null;}
 return recipe(game,room,now,anchor);
}
async function rotate(game,room,expectedId,now=Date.now()){
 if(!recipe(game,room,now))return null;
 const key=game+':'+Number(room),p=db();
 if(p){await ready;const c=await p.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);const r=await c.query('SELECT started_at FROM scarab_signal_clock WHERE room_key=$1',[key]);const old=recipe(game,room,now,r.rows.length?Number(r.rows[0].started_at):null);if(old.id!==expectedId){await c.query('COMMIT');return old;}await c.query('INSERT INTO scarab_signal_clock(room_key,started_at) VALUES($1,$2) ON CONFLICT(room_key) DO UPDATE SET started_at=EXCLUDED.started_at',[key,now]);await c.query('COMMIT');return recipe(game,room,now,now);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const old=recipe(game,room,now,state[key]??null);if(old.id!==expectedId)return old;
 state[key]=now;fs.writeFileSync(filename+'.tmp',JSON.stringify(state));fs.renameSync(filename+'.tmp',filename);
 return recipe(game,room,now,now);
}
module.exports={get,rotate};
