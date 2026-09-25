'use strict';
const { Pool } = require('pg');

let pool = null;
let initialized = false;

function getPool(){
  const url = String(process.env.DATABASE_URL || '').trim();
  if(!url) return null;
  if(!/^postgres(ql)?:\/\//i.test(url)) throw new Error('DATABASE_URL 必須使用 Render PostgreSQL 連線網址');
  if(!pool) pool = new Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/i.test(url) ? false : { rejectUnauthorized:false }
  });
  return pool;
}

function whitelistEnabled(){
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

  // v2.91: whitelist identity is account-only.
  // Keep old columns for backwards DB compatibility, but authorization no longer
  // depends on platform / expiry / note / password.
  //
  // Old disabled/expired records represented revoked access. Remove them once
  // during the account-only migration so a revoked old row is not accidentally
  // re-enabled just because row existence now grants access.
  await db.query(`DELETE FROM tz_whitelist
    WHERE enabled = FALSE
       OR (expires_at IS NOT NULL AND expires_at <= NOW())`);

  // If the same login existed once as TZ and once as OFA, keep the newest row.
  await db.query(`DELETE FROM tz_whitelist a
    USING tz_whitelist b
    WHERE LOWER(a.username)=LOWER(b.username)
      AND a.id < b.id`);

  await db.query(`UPDATE tz_whitelist
    SET platform='ACCOUNT',
        enabled=TRUE,
        expires_at=NULL,
        note=NULL,
        updated_at=NOW()
    WHERE platform IS DISTINCT FROM 'ACCOUNT'
       OR enabled IS DISTINCT FROM TRUE
       OR expires_at IS NOT NULL
       OR note IS NOT NULL`);

  await db.query(`DROP INDEX IF EXISTS tz_whitelist_platform_username_ci`);
  await db.query(`DROP INDEX IF EXISTS tz_whitelist_username_lower_idx`);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS tz_whitelist_username_ci
    ON tz_whitelist (LOWER(username))`);

  initialized = true;
  return true;
}

async function authorizeWhitelist(usernameRaw){
  if(!whitelistEnabled()) return { allowed:true, reason:'whitelist_disabled' };
  const db = getPool();
  if(!db) return { allowed:false, reason:'database_unavailable' };
  await ensureWhitelistTables();

  const username = String(usernameRaw || '').trim();
  if(!username) return { allowed:false, reason:'not_whitelisted' };

  const r = await db.query(
    `SELECT id, username FROM tz_whitelist WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [username]
  );
  if(!r.rowCount) return { allowed:false, reason:'not_whitelisted' };
  return { allowed:true, reason:'ok' };
}

async function listWhitelist(){
  const db = getPool();
  if(!db) throw new Error('DATABASE_URL 尚未設定');
  await ensureWhitelistTables();
  return (await db.query(
    `SELECT id, username, created_at, updated_at
       FROM tz_whitelist
      ORDER BY updated_at DESC, id DESC`
  )).rows;
}

async function upsertWhitelist(input){
  const db = getPool();
  if(!db) throw new Error('DATABASE_URL 尚未設定');
  await ensureWhitelistTables();

  const username = String(input && input.username || '').trim();
  if(!username) throw new Error('請輸入登入帳號');

  const existing = await db.query(
    `SELECT id FROM tz_whitelist WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [username]
  );

  if(existing.rowCount){
    await db.query(
      `UPDATE tz_whitelist
          SET username=$1, platform='ACCOUNT', enabled=TRUE,
              expires_at=NULL, note=NULL, updated_at=NOW()
        WHERE id=$2`,
      [username, existing.rows[0].id]
    );
    return;
  }

  try{
    await db.query(
      `INSERT INTO tz_whitelist
        (username, platform, enabled, expires_at, max_devices, note, updated_at)
       VALUES ($1,'ACCOUNT',TRUE,NULL,1,NULL,NOW())`,
      [username]
    );
  }catch(e){
    if(!e || e.code !== '23505') throw e;
    await db.query(
      `UPDATE tz_whitelist
          SET username=$1, platform='ACCOUNT', enabled=TRUE,
              expires_at=NULL, note=NULL, updated_at=NOW()
        WHERE LOWER(username)=LOWER($1)`,
      [username]
    );
  }
}

async function deleteWhitelist(id){
  const db = getPool();
  if(!db) throw new Error('DATABASE_URL 尚未設定');
  await ensureWhitelistTables();
  await db.query(`DELETE FROM tz_whitelist WHERE id=$1`, [Number(id)]);
}

module.exports = {
  authorizeWhitelist,
  listWhitelist,
  upsertWhitelist,
  deleteWhitelist
};
