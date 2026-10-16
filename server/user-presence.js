"use strict";
const {adminOnlinePage}=require("./admin-online-page");
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server/user-presence.ts
var user_presence_exports = {};
__export(user_presence_exports, {
  ensureUserPresence: () => ensureUserPresence,
  registerUserPresence: () => registerUserPresence
});
module.exports = __toCommonJS(user_presence_exports);
var import_node_crypto = require("node:crypto");
var import_ws = __toESM(require("ws"));
var initialized = /* @__PURE__ */ new WeakMap();
var PRESENCE_PATH = "/api/presence/ws";
var LEASE_TTL_SECONDS = 25;
var DEFAULT_HEARTBEAT_MS = 1e4;
var DEFAULT_PONG_TIMEOUT_MS = 2e4;
var DEFAULT_AUTH_TIMEOUT_MS = 5e3;
function ensureUserPresence(db) {
  const previous = initialized.get(db);
  if (previous) return previous;
  const job = (async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS autobac_user_presence (
      connection_id UUID PRIMARY KEY,
      platform VARCHAR(16) NOT NULL,
      username_key VARCHAR(128) NOT NULL,
      running BOOLEAN NOT NULL DEFAULT FALSE,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query(`ALTER TABLE autobac_user_presence ADD COLUMN IF NOT EXISTS app_id VARCHAR(32) NOT NULL DEFAULT 'autobac'`);
    await db.query(`CREATE INDEX IF NOT EXISTS autobac_user_presence_lease
      ON autobac_user_presence (last_seen_at)`);
    await db.query(`CREATE INDEX IF NOT EXISTS autobac_user_presence_account_lease
      ON autobac_user_presence (platform, username_key, last_seen_at)`);
  })();
  initialized.set(db, job);
  void job.catch(() => {
    if (initialized.get(db) === job) initialized.delete(db);
  });
  return job;
}
function cleanIdentity(identity) {
  const platform = String(identity?.platform || "").trim().toUpperCase();
  const usernameKey = String(identity?.username || "").trim().toLowerCase();
  if (!platform || !usernameKey || platform.length > 16 || usernameKey.length > 128) return null;
  return { platform, usernameKey };
}
function strictObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, i) => key === keys.slice().sort()[i]);
}
function decodeFrame(data) {
  try {
    if (typeof data === "string") return data;
    if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
    return null;
  } catch {
    return null;
  }
}
function parseFrame(data) {
  const text = decodeFrame(data);
  if (text == null || text.length > 4096) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function isSameOrigin(req, publicOrigin) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== "string" || !origin || typeof host !== "string" || !host) return false;
  if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+$/i.test(origin)) return false;
  try {
    const parsed = new URL(origin);
    const transportProtocol = req.socket.encrypted ? "https:" : "http:";
    const expected = publicOrigin ? new URL(publicOrigin) : new URL(`${transportProtocol}//${host}`);
    return parsed.origin === expected.origin && ["http:", "https:"].includes(parsed.protocol) && parsed.origin !== "null" && !parsed.username && !parsed.password && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
function rejectUpgrade(socket, status = 403) {
  const reason = status === 403 ? "Forbidden" : "Bad Request";
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r
Connection: close\r
\r
`);
  } catch {
  }
  try {
    socket.destroy();
  } catch {
  }
}
function asCount(value) {
  if (value === null || value === void 0 || value === "") throw new Error("invalid_count");
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("invalid_count");
  return count;
}
const PRESENCE_SUMMARY_SQL = `WITH eligible_presence AS (
  SELECT p.app_id, p.platform, p.username_key,
    MIN(w.username)::text AS username,
    BOOL_OR(p.running AND p.app_id='autobac') AS running
  FROM autobac_user_presence p
  JOIN tz_whitelist w
    ON UPPER(w.platform)=UPPER(p.platform)
    AND LOWER(w.username)=p.username_key
    AND w.enabled=TRUE
    AND (w.expires_at IS NULL OR w.expires_at>NOW())
  WHERE p.last_seen_at > NOW() - INTERVAL '${LEASE_TTL_SECONDS} seconds'
  GROUP BY p.app_id, p.platform, p.username_key
), account_summary AS (
  SELECT COUNT(DISTINCT (platform, username_key))::int AS online_accounts,
    COUNT(DISTINCT (platform, username_key)) FILTER (WHERE running)::int AS running_accounts
  FROM eligible_presence
), application_summary AS (
  SELECT app_id, COUNT(*)::int AS online_accounts,
    COUNT(*) FILTER (WHERE running)::int AS running_accounts
  FROM eligible_presence
  GROUP BY app_id
)
SELECT 'summary'::text AS row_kind, NULL::text AS app_id,
  online_accounts, running_accounts, TRUE AS online_users_available,
  NULL::text AS platform, NULL::text AS username
FROM account_summary
UNION ALL
SELECT 'application'::text AS row_kind, app_id,
  online_accounts, running_accounts, TRUE AS online_users_available,
  NULL::text AS platform, NULL::text AS username
FROM application_summary
UNION ALL
SELECT 'online_user'::text AS row_kind, app_id,
  NULL::int AS online_accounts, NULL::int AS running_accounts,
  TRUE AS online_users_available, platform, username
FROM eligible_presence
ORDER BY row_kind, app_id NULLS FIRST, platform, username`;
function asOnlineUser(value) {
  const appId = String(value?.app_id || "");
  const platform = String(value?.platform || "");
  const username = String(value?.username || "");
  if (!["autobac", "baccarat-helper", "scarab-heart"].includes(appId) || !platform || !username) {
    throw new Error("invalid_online_user");
  }
  return { appId, platform, username };
}
function registerUserPresence(app, server, requireAdmin, deps = {}) {
  const getDatabase = () => deps.db !== void 0 ? deps.db : deps.getPool?.() ?? null;
  const readIdentity = deps.readRiskTrackerIdentity || (async () => null);
  const appId = deps.appId || "autobac";
  const makeConnectionId = deps.createConnectionId || import_node_crypto.randomUUID;
  const heartbeatIntervalMs = Math.max(1, deps.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS);
  const pongTimeoutMs = Math.max(1, deps.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS);
  const authTimeoutMs = Math.max(1, deps.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS);
  const now = deps.now || Date.now;
  const sockets = /* @__PURE__ */ new Set();
  const wss = new import_ws.WebSocketServer({ noServer: true, clientTracking: false, maxPayload: 4096 });
  app.get('/admin/online', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    return requireAdmin(req, res, next);
  }, (req, res) => {
    const appId = req.query.app;
    if (typeof appId !== 'string' || !['autobac','baccarat-helper','scarab-heart'].includes(appId)) return res.status(400).send('請從對應程式的查看按鈕進入');
    return res.type('html').send(adminOnlinePage(appId));
  });

  app.get(
    "/api/admin/presence",
    (req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      return requireAdmin(req, res, next);
    },
    async (_req, res) => {
      let db = null;
      try {
        db = getDatabase();
        if (!db) throw new Error("database_unavailable");
        await ensureUserPresence(db);
        await db.query(
          `DELETE FROM autobac_user_presence
           WHERE last_seen_at <= NOW() - INTERVAL '${LEASE_TTL_SECONDS} seconds'`
        );
        const result = await db.query(PRESENCE_SUMMARY_SQL);
        const rows = result.rows || [];
        const row = rows.find((value) => value.row_kind === "summary") || rows.find((value) => value.app_id == null) || {};
        const onlineAccounts = asCount(row.online_accounts);
        const runningAccounts = asCount(row.running_accounts);
        if (runningAccounts > onlineAccounts) throw new Error("invalid_count");
        const onlineUsersAvailable = row.online_users_available === true || row.online_users_available === "true";
        const onlineUsers = onlineUsersAvailable ? rows.filter((value) => value.row_kind === "online_user").map(asOnlineUser) : null;
        const applications = [
          { appId: "autobac", name: "AutoBac" },
          { appId: "baccarat-helper", name: "\u767E\u5BB6\u8F14\u52A9" },
          { appId: "scarab-heart", name: "\u8056\u7532\u4E4B\u5FC3" }
        ].map((application) => {
          const site = rows.find((value) => value.row_kind === "application" && value.app_id === application.appId) || rows.find((value) => value.row_kind == null && value.app_id === application.appId);
          const online = site ? asCount(site.online_accounts) : 0;
          const running = site ? asCount(site.running_accounts) : 0;
          if (running > online || online > onlineAccounts) throw new Error("invalid_count");
          return { ...application, onlineAccounts: online, runningAccounts: running };
        });
        return res.json({
          ok: true,
          scope: "shared-whitelist",
          appId,
          schemaVersion: 2,
          accountsSchemaVersion: 1,
          onlineAccounts,
          runningAccounts,
          applications,
          onlineUsers,
          updatedAt: new Date(now()).toISOString(),
          disconnectDetectionSeconds: 20
        });
      } catch {
        return res.status(503).json({ ok: false, error: "presence_unavailable" });
      }
    }
  );
  wss.on("connection", (socket) => {
    let closed = false;
    let authenticated = false;
    let authStarted = false;
    let connectionId = "";
    let sessionId = "";
    let identity = null;
    let dbForConnection = null;
    let lastPongAt = now();
    let serial = Promise.resolve();
    let authTimer;
    let heartbeatTimer;
    const queue = (work) => {
      const next = serial.then(async () => {
        if (closed) return;
        try {
          await work();
        } catch {
          closeConnection(1011, "presence unavailable");
        }
      });
      serial = next.catch(() => void 0);
    };
    const queueDelete = () => {
      serial = serial.then(async () => {
        const db = dbForConnection;
        if (!db || !connectionId) return;
        try {
          await db.query("DELETE FROM autobac_user_presence WHERE connection_id=$1", [connectionId]);
        } catch {
        }
      }).catch(() => void 0);
    };
    const closeConnection = (code, reason) => {
      if (closed) return;
      closed = true;
      if (authTimer) clearTimeout(authTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      queueDelete();
      if (socket.readyState === import_ws.default.OPEN || socket.readyState === import_ws.default.CONNECTING) {
        try {
          socket.close(code, reason);
        } catch {
          try {
            socket.terminate();
          } catch {
          }
        }
      }
    };
    const dispose = () => closeConnection();
    sockets.add(dispose);
    authTimer = setTimeout(() => closeConnection(1008, "authentication required"), authTimeoutMs);
    authTimer.unref?.();
    heartbeatTimer = setInterval(() => {
      if (closed) return;
      if (now() - lastPongAt >= pongTimeoutMs) {
        closeConnection(1011, "pong timeout");
        return;
      }
      if (socket.readyState === import_ws.default.OPEN) {
        try {
          socket.ping();
        } catch {
          closeConnection();
        }
      }
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();
    socket.on("pong", () => {
      lastPongAt = now();
      if (!authenticated || !identity || !sessionId || !connectionId || !dbForConnection) return;
      queue(async () => {
        const verified = await readIdentity(dbForConnection, sessionId);
        const checked = verified && cleanIdentity(verified);
        if (!checked || checked.platform !== identity.platform || checked.usernameKey !== identity.usernameKey) {
          closeConnection(1008, "session invalid");
          return;
        }
        if (closed) return;
        await dbForConnection.query(
          `UPDATE autobac_user_presence SET last_seen_at=NOW()
           WHERE connection_id=$1 AND platform=$2 AND username_key=$3`,
          [connectionId, identity.platform, identity.usernameKey]
        );
      });
    });
    socket.on("message", (data) => {
      const frame = parseFrame(data);
      if (!authenticated) {
        if (authStarted || !frame || !strictObject(frame, ["type", "sessionId"]) || frame.type !== "auth" || typeof frame.sessionId !== "string" || !frame.sessionId || frame.sessionId.length > 128) {
          closeConnection(1008, "invalid authentication frame");
          return;
        }
        authStarted = true;
        connectionId = makeConnectionId();
        sessionId = frame.sessionId;
        queue(async () => {
          const db = getDatabase();
          if (!db) throw new Error("database_unavailable");
          dbForConnection = db;
          await ensureUserPresence(db);
          const verified = await readIdentity(db, sessionId);
          const checked = verified && cleanIdentity(verified);
          if (!checked) {
            closeConnection(1008, "session invalid");
            return;
          }
          if (closed) return;
          identity = checked;
          await db.query(
            `INSERT INTO autobac_user_presence
              (connection_id, platform, username_key, running, last_seen_at, app_id)
             VALUES ($1, $2, $3, FALSE, NOW(), $4)
             ON CONFLICT (connection_id) DO NOTHING`,
            [connectionId, checked.platform, checked.usernameKey, appId]
          );
          if (closed) return;
          authenticated = true;
          if (authTimer) clearTimeout(authTimer);
          if (socket.readyState === import_ws.default.OPEN) {
            try {
              socket.send(JSON.stringify({ type: "authenticated" }));
            } catch {
              closeConnection();
            }
          }
        });
        return;
      }
      if (!frame || !strictObject(frame, ["type", "running"]) || frame.type !== "state" || typeof frame.running !== "boolean" || !identity || !connectionId || !dbForConnection) {
        closeConnection(1008, "invalid state frame");
        return;
      }
      const running = appId === "autobac" && frame.running;
      queue(async () => {
        if (!identity || !dbForConnection || !connectionId) return;
        await dbForConnection.query(
          `UPDATE autobac_user_presence SET running=$1
           WHERE connection_id=$2 AND platform=$3 AND username_key=$4`,
          [running, connectionId, identity.platform, identity.usernameKey]
        );
      });
    });
    socket.once("close", () => {
      sockets.delete(dispose);
      closeConnection();
    });
    socket.once("error", () => closeConnection());
  });
  const onUpgrade = (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url || "", "http://localhost");
    } catch {
      return;
    }
    if (url.pathname !== PRESENCE_PATH) return;
    if (url.search || !isSameOrigin(req, deps.publicOrigin)) {
      rejectUpgrade(socket, url.search ? 400 : 403);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  };
  server.on("upgrade", onUpgrade);
  return {
    close() {
      server.off("upgrade", onUpgrade);
      for (const closeSocket of [...sockets]) closeSocket();
      try {
        wss.close();
      } catch {
      }
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ensureUserPresence,
  registerUserPresence
});
