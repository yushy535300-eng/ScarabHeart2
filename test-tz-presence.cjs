'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const WebSocket = require('ws');
const { resolveWhitelistPlatform, readCurrentAccessIdentity } = require('./access-auth');
const { registerUserPresence } = require('./server/user-presence');

const root = __dirname;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check, message = 'condition not reached') {
  for (let i = 0; i < 80; i += 1) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(message);
}
function once(emitter, event) {
  return new Promise(resolve => emitter.once(event, (...args) => resolve(args)));
}

test('TZ product UI contains no OFA label or option while private routing remains separate', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  assert.doesNotMatch(html, /OFA/i);
  assert.doesNotMatch(html, /platformMenu|data-platform|id="base"/);
  assert.match(html, /id="platformPickerText">TZ ONLINE/);
  assert.match(html, /login-presence-note/);
  assert.match(app, /const actualPlatform = await resolveLoginPlatform\(account\)/);
  assert.match(app, /actualPlatform === 'OFA' \? 'https:\/\/www\.ofa1188\.net'/);
  assert.match(app, /session = \{ base, token, account, password, platform: validatedPlatform/);
  assert.match(app, /connectUserPresence\(accessSessionId,\(\)=>false\)/);
});

test('active whitelist resolution preserves OFA routing and presence follows the original access-session map lifetime', async () => {
  const queries = [];
  const db = {
    async query(sql, values) {
      queries.push([sql, values]);
      if (/SELECT UPPER\(platform\) AS platform/i.test(sql)) return { rows: [{ platform: 'OFA' }] };
      if (/SELECT 1\s+FROM tz_whitelist/i.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      throw new Error('unexpected query');
    }
  };
  const resolved = await resolveWhitelistPlatform(db, 'anonymous-account');
  assert.deepEqual(resolved, { allowed: true, reason: 'ok', platform: 'OFA' });

  // /api/access/check accepts a session solely while accessSessions has it; its
  // existing 30-minute cleanup later removes entries older than six hours.
  const sixHoursAgo = Date.now() - (6 * 60 * 60 * 1000);
  const sessions = new Map([['opaque-scarab-session', { username: 'anonymous-account', platform: 'OFA', createdAt: sixHoursAgo }]]);
  const originalAccessCheckWouldAccept = sessionId => sessions.has(sessionId);
  assert.equal(originalAccessCheckWouldAccept('opaque-scarab-session'), true);
  assert.deepEqual(await readCurrentAccessIdentity(db, sessions, 'opaque-scarab-session'), { username: 'anonymous-account', platform: 'OFA' });
  assert.match(queries.at(-1)[0], /enabled=TRUE/);
  assert.match(queries.at(-1)[0], /expires_at IS NULL OR expires_at>NOW\(\)/);

  // Simulate the original cleanup deleting the map entry. Presence must then
  // reject it immediately rather than retaining a separate session lifetime.
  sessions.delete('opaque-scarab-session');
  assert.equal(originalAccessCheckWouldAccept('opaque-scarab-session'), false);
  assert.equal(await readCurrentAccessIdentity(db, sessions, 'opaque-scarab-session'), null);
});

test('default local origin (without public-origin injection) authenticates a current opaque session, forces Scarab running=false, and cleans up', async t => {
  const calls = [];
  const db = {
    async query(sql, values) {
      calls.push([sql, values]);
      return { rows: [] };
    }
  };
  const app = express();
  const server = http.createServer(app);
  const controller = registerUserPresence(
    app,
    server,
    (_req, res) => res.status(401).end(),
    {
      db,
      appId: 'scarab-heart',
      readRiskTrackerIdentity: async (_db, sessionId) => sessionId === 'opaque-scarab-session'
        ? { platform: 'OFA', username: 'anonymous-account' }
        : null,
      createConnectionId: () => '00000000-0000-4000-8000-000000000042',
      heartbeatIntervalMs: 25,
      pongTimeoutMs: 250,
      authTimeoutMs: 250
    }
  );
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/presence/ws`, { origin });
  t.after(async () => {
    controller.close();
    await new Promise(resolve => server.close(resolve));
  });
  await once(socket, 'open');
  socket.send(JSON.stringify({ type: 'auth', sessionId: 'opaque-scarab-session' }));
  const [message] = await once(socket, 'message');
  assert.deepEqual(JSON.parse(String(message)), { type: 'authenticated' });
  await eventually(() => calls.some(([sql]) => /INSERT INTO autobac_user_presence/.test(sql)));
  const insert = calls.find(([sql]) => /INSERT INTO autobac_user_presence/.test(sql));
  assert.deepEqual(insert[1], ['00000000-0000-4000-8000-000000000042', 'OFA', 'anonymous-account', 'scarab-heart']);
  socket.send(JSON.stringify({ type: 'state', running: true }));
  await eventually(() => calls.some(([sql]) => /SET running=\$1/.test(sql)));
  const state = calls.find(([sql]) => /SET running=\$1/.test(sql));
  assert.equal(state[1][0], false);
  socket.close();
  await once(socket, 'close');
  await eventually(() => calls.some(([sql, values]) => sql === 'DELETE FROM autobac_user_presence WHERE connection_id=$1' && values[0] === '00000000-0000-4000-8000-000000000042'));
});

test('presence rejects cross-origin upgrades without making database calls', async t => {
  let queryCount = 0;
  const app = express();
  const server = http.createServer(app);
  const controller = registerUserPresence(app, server, (_req, res) => res.status(401).end(), {
    db: { async query() { queryCount += 1; return { rows: [] }; } },
    appId: 'scarab-heart',
    readRiskTrackerIdentity: async () => null
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => {
    controller.close();
    await new Promise(resolve => server.close(resolve));
  });
  const rejected = new WebSocket(`ws://127.0.0.1:${port}/api/presence/ws`, { origin: 'http://attacker.invalid' });
  const [request, response] = await once(rejected, 'unexpected-response');
  assert.equal(response.statusCode, 403);
  request.destroy();
  assert.equal(queryCount, 0);
});

test('configured public origin rejects a same-host different-scheme upgrade without database calls', async t => {
  let queryCount = 0;
  const app = express();
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const controller = registerUserPresence(app, server, (_req, res) => res.status(401).end(), {
    db: { async query() { queryCount += 1; return { rows: [] }; } },
    appId: 'scarab-heart',
    publicOrigin: `https://127.0.0.1:${port}`,
    readRiskTrackerIdentity: async () => null
  });
  t.after(async () => {
    controller.close();
    await new Promise(resolve => server.close(resolve));
  });
  const rejected = new WebSocket(`ws://127.0.0.1:${port}/api/presence/ws`, {
    origin: `http://127.0.0.1:${port}`
  });
  const [request, response] = await once(rejected, 'unexpected-response');
  assert.equal(response.statusCode, 403);
  request.destroy();
  assert.equal(queryCount, 0);
});
