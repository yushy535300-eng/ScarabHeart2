'use strict';

// Read only existing provider events. Missing historical events are never invented.
async function enrichLastUsed(db, members) {
  if (!members.length) return members;
  const sources = [
    ['autobac_user_presence', 'last_seen_at'],
    ['scarab_member_usage_sessions', 'last_seen_at'],
    ['autobac_dg_usage_records', 'server_updated_at'],
    ['autobac_dg_settings_records', 'recorded_at'],
    ['autobac_risk_acknowledgements', 'recorded_at'],
  ];
  const available = (await db.query('SELECT name,to_regclass(name) AS relation FROM unnest($1::text[]) AS name',
    [sources.map(([name]) => 'public.' + name)])).rows;
  const names = new Set(available.filter(row => row.relation).map(row => row.name));
  const parts = sources.filter(([name]) => names.has('public.' + name)).map(([name, time]) =>
    `SELECT UPPER(platform) AS platform, LOWER(username_key) AS username_key, MAX(${time}) AS used_at FROM ${name} GROUP BY UPPER(platform), LOWER(username_key)`);
  if (!parts.length) return members;
  const rows = (await db.query(`SELECT platform,username_key,MAX(used_at) AS used_at FROM (${parts.join(' UNION ALL ')}) AS events GROUP BY platform,username_key`)).rows;
  const times = new Map(rows.map(row => [JSON.stringify([row.platform, row.username_key]), row.used_at]));
  for (const member of members) {
    const value = times.get(JSON.stringify([String(member.platform).toUpperCase(), String(member.username).toLowerCase()]));
    if (value && (!member.last_used_at || new Date(value) > new Date(member.last_used_at))) member.last_used_at = value;
  }
  if (names.has('public.scarab_member_usage_sessions')) {
    const sessions = (await db.query(`SELECT DISTINCT ON(platform,username_key,app_id)
      platform,username_key,app_id,started_at,last_seen_at,ended_at,
      GREATEST(0,EXTRACT(EPOCH FROM (last_seen_at-started_at))) AS duration_seconds,
      (ended_at IS NULL AND last_seen_at > NOW()-INTERVAL '25 seconds') AS active
      FROM scarab_member_usage_sessions ORDER BY platform,username_key,app_id,started_at DESC`)).rows;
    const byMember = new Map();
    for (const session of sessions) {
      const key=JSON.stringify([session.platform,session.username_key]);
      if (!byMember.has(key)) byMember.set(key, {});
      byMember.get(key)[session.app_id]=session;
    }
    for (const member of members) {
      member.program_usage=byMember.get(JSON.stringify([String(member.platform).toUpperCase(),String(member.username).toLowerCase()])) || {};
      member.last_usage=Object.values(member.program_usage).sort((a,b)=>new Date(b.last_seen_at)-new Date(a.last_seen_at))[0] || null;
    }
  }
  return members;
}

module.exports = { enrichLastUsed };
