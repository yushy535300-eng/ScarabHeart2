'use strict';

const PLATFORM_VALUES = new Set(['TZ', 'OFA']);

function cleanUsername(value) {
  const username = String(value || '').trim();
  return username && username.length <= 128 ? username : '';
}

function cleanPlatform(value) {
  const platform = String(value || '').trim().toUpperCase();
  return PLATFORM_VALUES.has(platform) ? platform : '';
}

/**
 * Resolves the account's actual routing platform from the active original
 * whitelist. This only reads tz_whitelist; it never alters whitelist records.
 */
async function resolveWhitelistPlatform(db, usernameRaw) {
  const username = cleanUsername(usernameRaw);
  if (!username) return { allowed: false, reason: 'invalid_request' };
  if (!db || typeof db.query !== 'function') return { allowed: false, reason: 'database_unavailable' };

  const result = await db.query(
    `SELECT UPPER(platform) AS platform
       FROM tz_whitelist
      WHERE LOWER(username)=LOWER($1)
        AND enabled=TRUE
        AND (expires_at IS NULL OR expires_at>NOW())`,
    [username]
  );
  const platforms = [...new Set((result.rows || [])
    .map(row => cleanPlatform(row && row.platform))
    .filter(Boolean))];
  if (platforms.length === 1) return { allowed: true, reason: 'ok', platform: platforms[0] };
  if (platforms.length > 1) return { allowed: false, reason: 'platform_ambiguous' };
  return { allowed: false, reason: 'not_whitelisted' };
}

/**
 * Presence authentication adapter. It validates the existing in-memory Scarab
 * session first, then re-checks the original enabled, unexpired whitelist row.
 * It intentionally performs no writes and returns no credential material.
 */
async function readCurrentAccessIdentity(db, accessSessions, sessionIdRaw) {
  const sessionId = String(sessionIdRaw || '');
  if (!sessionId || sessionId.length > 128 || !accessSessions || typeof accessSessions.get !== 'function') return null;
  // Match /api/access/check exactly: a session remains valid while it is in the
  // original map. The existing 30-minute cleanup is the sole owner of its 6h
  // eviction policy; this read-only adapter must not shorten that lifetime.
  const current = accessSessions.get(sessionId);
  if (!current) return null;
  const username = cleanUsername(current.username);
  const platform = cleanPlatform(current.platform);
  if (!username || !platform || !db || typeof db.query !== 'function') return null;

  const result = await db.query(
    `SELECT 1
       FROM tz_whitelist
      WHERE LOWER(username)=LOWER($1)
        AND UPPER(platform)=UPPER($2)
        AND enabled=TRUE
        AND (expires_at IS NULL OR expires_at>NOW())
      LIMIT 1`,
    [username, platform]
  );
  if (!result || !(result.rowCount > 0 || (Array.isArray(result.rows) && result.rows.length > 0))) return null;
  return { username, platform };
}

module.exports = {
  resolveWhitelistPlatform,
  readCurrentAccessIdentity
};
