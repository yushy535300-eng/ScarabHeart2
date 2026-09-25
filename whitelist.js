'use strict';
const { Pool } = require('pg');

let pool = null;
let initialized = false;

function getPool(){
  const url = String(process.env.DATABASE_URL || '').trim();
  if(!url) return null;
  if(!/^postgres(ql)?:\/\//i.test(url)) throw new Error('DATABASE_URL 必須使用 Render PostgreSQL 連線網址');
  if(!pool) pool = new Pool({
    connectionString:url,
    ssl:/localhost|127\.0\.0\.1/i.test(url) ? false : { rejectUnauthorized:false }
  });
  return pool;
}

function whitelistEnabled(){
  // Scarab uses the shared whitelist by default.
  return String(process.env.TZ_WHITELIST_ENABLED ?? 'true').toLowerCase() !== 'false';
}

async function ensureWhitelistTables(){
  const db = getPool();
  if(!db) return false;
  if(initialized) return true;

  await db.query(`CREATE TABLE IF NOT EXISTS tz_whitelist (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(128) NOT NULL,
    platform VARCHAR(16) NOT NULL DEFAULT 'TZ',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ NULL,
    max_devices INTEGER NOT NULL DEFAULT 1,
    note VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await db.query(`ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS platform VARCHAR(16) NOT NULL DEFAULT 'TZ'`);
  await db.query(`ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  await db.query(`ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL`);
  await db.query(`ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS max_devices INTEGER NOT NULL DEFAULT 1`);
  await db.query(`ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS note VARCHAR(255) NULL`);
  await db.query(`ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await db.query(`ALTER TABLE tz_whitelist ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  // Restore the original MT database index model, without deleting any rows.
  await db.query(`DROP INDEX IF EXISTS tz_whitelist_username_ci`);
  await db.query(`DROP INDEX IF EXISTS tz_whitelist_username_lower_idx`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS tz_whitelist_platform_username_ci
    ON tz_whitelist (UPPER(platform), LOWER(username))`);

  initialized = true;
  return true;
}

async function authorizeWhitelist(usernameRaw, platformRaw='TZ'){
  if(!whitelistEnabled()) return { allowed:true, reason:'whitelist_disabled' };
  const db = getPool();
  if(!db) return { allowed:false, reason:'database_unavailable' };
  await ensureWhitelistTables();

  const username = String(usernameRaw || '').trim();
  const platform = String(platformRaw || 'TZ').trim().toUpperCase();
  if(!username) return { allowed:false, reason:'not_whitelisted' };

  // Prefer the exact TZ/OFA row. v2.91 compatibility: ACCOUNT means shared account.
  const r = await db.query(
    `SELECT * FROM tz_whitelist
      WHERE LOWER(username)=LOWER($1)
        AND (UPPER(platform)=UPPER($2) OR UPPER(platform)='ACCOUNT')
      ORDER BY CASE WHEN UPPER(platform)=UPPER($2) THEN 0 ELSE 1 END
      LIMIT 1`,
    [username, platform]
  );
  const row = r.rows[0];
  if(!row) return { allowed:false, reason:'not_whitelisted' };
  if(!row.enabled) return { allowed:false, reason:'disabled' };
  if(row.expires_at && new Date(row.expires_at).getTime() <= Date.now())
    return { allowed:false, reason:'expired' };
  return { allowed:true, reason:'ok' };
}

async function listWhitelist(){
  const db = getPool();
  if(!db) throw new Error('DATABASE_URL 尚未設定');
  await ensureWhitelistTables();
  return (await db.query(`SELECT w.* FROM tz_whitelist w ORDER BY w.updated_at DESC`)).rows;
}

async function upsertWhitelist(input){
  const db = getPool();
  if(!db) throw new Error('DATABASE_URL 尚未設定');
  await ensureWhitelistTables();

  const username = String(input && input.username || '').trim();
  if(!username) throw new Error('請輸入平台帳號');

  const platform = String(input && input.platform || 'TZ').trim().toUpperCase();
  if(!['TZ','OFA'].includes(platform)) throw new Error('不支援的平台');

  const permanent = !!(input && input.permanent);
  const days = input && input.days;
  const expiresAt = permanent ? null : new Date(Date.now() + Math.max(1, Number(days) || 30) * 86400000);
  const note = String(input && input.note || '').slice(0,255);

  const existing = await db.query(
    `SELECT id FROM tz_whitelist
      WHERE UPPER(platform)=UPPER($1) AND LOWER(username)=LOWER($2)
      LIMIT 1`,
    [platform, username]
  );

  if(existing.rowCount){
    await db.query(
      `UPDATE tz_whitelist
          SET username=$1, platform=$2, enabled=TRUE, expires_at=$3, note=$4, updated_at=NOW()
        WHERE id=$5`,
      [username, platform, expiresAt, note, existing.rows[0].id]
    );
    return;
  }

  try{
    await db.query(
      `INSERT INTO tz_whitelist
        (username,platform,enabled,expires_at,max_devices,note,updated_at)
       VALUES ($1,$2,TRUE,$3,1,$4,NOW())`,
      [username, platform, expiresAt, note]
    );
  }catch(e){
    if(!e || e.code !== '23505') throw e;
    await db.query(
      `UPDATE tz_whitelist
          SET username=$1,enabled=TRUE,expires_at=$2,note=$3,updated_at=NOW()
        WHERE UPPER(platform)=UPPER($4) AND LOWER(username)=LOWER($1)`,
      [username, expiresAt, note, platform]
    );
  }
}

async function setWhitelistEnabled(id, enabled){
  const db=getPool();
  if(!db) throw new Error('DATABASE_URL 尚未設定');
  await ensureWhitelistTables();
  await db.query(`UPDATE tz_whitelist SET enabled=$1,updated_at=NOW() WHERE id=$2`,[!!enabled,Number(id)]);
}

async function extendWhitelist(id, days){
  const db=getPool();
  if(!db) throw new Error('DATABASE_URL 尚未設定');
  await ensureWhitelistTables();
  await db.query(
    `UPDATE tz_whitelist
        SET expires_at=(CASE WHEN expires_at IS NULL OR expires_at < NOW() THEN NOW() ELSE expires_at END)
                         +($1::text || ' days')::interval,
            enabled=TRUE,
            updated_at=NOW()
      WHERE id=$2`,
    [Math.max(1,Number(days)||30),Number(id)]
  );
}

async function deleteWhitelist(id){
  const db=getPool();
  if(!db) throw new Error('DATABASE_URL 尚未設定');
  await ensureWhitelistTables();
  await db.query(`DELETE FROM tz_whitelist WHERE id=$1`,[Number(id)]);
}

module.exports={
  authorizeWhitelist,
  listWhitelist,
  upsertWhitelist,
  setWhitelistEnabled,
  extendWhitelist,
  deleteWhitelist
};
