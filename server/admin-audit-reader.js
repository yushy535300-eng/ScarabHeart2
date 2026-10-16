var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var admin_audit_reader_exports = {};
__export(admin_audit_reader_exports, {
  adminAuditDetailsPage: () => adminAuditDetailsPage,
  adminAuditTime: () => adminAuditTime,
  escapeAdminAuditText: () => escapeAdminAuditText,
  readAdminAuditRecords: () => readAdminAuditRecords,
  registerAdminAuditReader: () => registerAdminAuditReader,
  sendAdminAuditPage: () => sendAdminAuditPage
});
module.exports = __toCommonJS(admin_audit_reader_exports);
const PAGE_SIZE = 30;
const USAGE_OFFLINE_MS = 9e4;
function escapeAdminAuditText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
function adminAuditTime(value) {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "\u6642\u9593\u7121\u6CD5\u8FA8\u8B58";
}
function epochAuditTime(value) {
  if (value === null || value === void 0 || value === "") return "\u672A\u56DE\u50B3";
  const milliseconds = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds <= 864e13 ? adminAuditTime(new Date(milliseconds).toISOString()) : "\u672A\u56DE\u50B3";
}
function formatElapsed(value) {
  if (value === null || value === void 0 || value === "") return "\u672A\u56DE\u50B3";
  const milliseconds = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return "\u672A\u56DE\u50B3";
  const totalSeconds = Math.floor(milliseconds / 1e3);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}
function safePage(value) {
  const page = Number(value || 1);
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}
async function hasRelation(db, name) {
  const result = await db.query("SELECT to_regclass($1) AS relation", [`public.${name}`]);
  return !!result.rows?.[0]?.relation;
}
function relationFor(kind) {
  return kind === "settings" ? "autobac_dg_settings_records" : "autobac_risk_acknowledgements";
}
function rowsForKind(kind, table) {
  return kind === "settings" ? `SELECT id, event_id, event_type, statement_version, snapshot, snapshot_sha256, recorded_at
        FROM ${table} WHERE platform=$1 AND username_key=$2
        ORDER BY recorded_at DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET $3` : `SELECT id, event_id, game_platform, event_type, statement_version, statement_text,
        statement_sha256, recorded_at FROM ${table} WHERE platform=$1 AND username_key=$2
        ORDER BY recorded_at DESC, id DESC LIMIT ${PAGE_SIZE} OFFSET $3`;
}
function usageSource(settingsAvailable) {
  const usageColumns = `u.id AS record_id, 'usage'::text AS record_source, u.run_id, u.settings_event_id,
    u.statement_version, u.status, u.sequence, u.client_started_at_ms, u.client_updated_at_ms,
    u.client_ended_at_ms, u.elapsed_ms, u.report, u.first_received_at, u.server_updated_at,
    u.stopped_received_at, u.server_updated_at AS recorded_at`;
  if (!settingsAvailable) {
    return `SELECT ${usageColumns}, NULL::jsonb AS settings_snapshot, NULL::timestamptz AS settings_recorded_at
      FROM autobac_dg_usage_records u WHERE u.platform=$1 AND u.username_key=$2`;
  }
  return `SELECT ${usageColumns}, s.snapshot AS settings_snapshot, s.recorded_at AS settings_recorded_at
    FROM autobac_dg_usage_records u
    LEFT JOIN autobac_dg_settings_records s
      ON s.platform=u.platform AND s.username_key=u.username_key AND s.event_id=u.settings_event_id
    WHERE u.platform=$1 AND u.username_key=$2
    UNION ALL
    SELECT s.id AS record_id, 'settings_only'::text AS record_source, NULL::uuid AS run_id,
      s.event_id AS settings_event_id, s.statement_version, NULL::text AS status,
      NULL::int AS sequence, NULL::bigint AS client_started_at_ms, NULL::bigint AS client_updated_at_ms,
      NULL::bigint AS client_ended_at_ms, NULL::bigint AS elapsed_ms, NULL::jsonb AS report,
      NULL::timestamptz AS first_received_at, NULL::timestamptz AS server_updated_at,
      NULL::timestamptz AS stopped_received_at, s.recorded_at, s.snapshot AS settings_snapshot,
      s.recorded_at AS settings_recorded_at
    FROM autobac_dg_settings_records s
    WHERE s.platform=$1 AND s.username_key=$2
      AND NOT EXISTS (SELECT 1 FROM autobac_dg_usage_records u
        WHERE u.platform=s.platform AND u.username_key=s.username_key AND u.settings_event_id=s.event_id)`;
}
async function readAdminAuditRecords(db, whitelistId, requestedPage, kind) {
  if (!await hasRelation(db, "tz_whitelist")) throw new Error("whitelist_table_unavailable");
  const account = (await db.query(
    "SELECT id, platform, username FROM tz_whitelist WHERE id=$1 LIMIT 1",
    [whitelistId]
  )).rows?.[0];
  if (!account) return null;
  const identity = [String(account.platform).toUpperCase(), String(account.username).toLowerCase()];
  if (kind === "usage") {
    const [usageAvailable, settingsAvailable] = await Promise.all([
      hasRelation(db, "autobac_dg_usage_records"),
      hasRelation(db, "autobac_dg_settings_records")
    ]);
    if (!usageAvailable) {
      if (settingsAvailable) {
        const legacy = await readAdminAuditRecords(db, whitelistId, requestedPage, "settings");
        if (!legacy) return null;
        return {
          ...legacy,
          settingsAvailable: true,
          rows: legacy.rows.map((row) => ({
            ...row,
            record_source: "settings_only",
            settings_snapshot: row.snapshot,
            settings_event_id: row.event_id
          }))
        };
      }
      return { account, total: 0, page: 1, pages: 1, rows: [], unavailable: true, settingsAvailable };
    }
    const source = usageSource(settingsAvailable);
    const total2 = Number((await db.query(`SELECT COUNT(*)::int AS total FROM (${source}) AS audit_records`, identity)).rows?.[0]?.total ?? 0);
    const safeTotal2 = Number.isSafeInteger(total2) && total2 >= 0 ? total2 : 0;
    const pages2 = Math.max(1, Math.ceil(safeTotal2 / PAGE_SIZE));
    const page2 = Math.min(Math.max(1, requestedPage), pages2);
    const rows2 = (await db.query(
      `SELECT * FROM (${source}) AS audit_records
       ORDER BY COALESCE(server_updated_at, recorded_at) DESC, record_id DESC LIMIT ${PAGE_SIZE} OFFSET $3`,
      [...identity, (page2 - 1) * PAGE_SIZE]
    )).rows || [];
    return { account, total: safeTotal2, page: page2, pages: pages2, rows: rows2, unavailable: false, settingsAvailable };
  }
  const table = relationFor(kind);
  if (!await hasRelation(db, table)) {
    return { account, total: 0, page: 1, pages: 1, rows: [], unavailable: true };
  }
  const total = Number((await db.query(
    `SELECT COUNT(*)::int AS total FROM ${table} WHERE platform=$1 AND username_key=$2`,
    identity
  )).rows?.[0]?.total ?? 0);
  const safeTotal = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  const pages = Math.max(1, Math.ceil(safeTotal / PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const rows = (await db.query(rowsForKind(kind, table), [...identity, (page - 1) * PAGE_SIZE])).rows || [];
  return { account, total: safeTotal, page, pages, rows, unavailable: false };
}
function parsedObject(value) {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : null;
}
function stringValue(value, empty = "\u672A\u56DE\u50B3") {
  return value === void 0 || value === null || value === "" ? empty : String(value);
}
function moneyValue(value) {
  return value === null ? "\u672A\u8A2D\u5B9A" : stringValue(value);
}
function settingFields(snapshot) {
  const value = parsedObject(snapshot);
  if (!value) return null;
  const selectedTables = Array.isArray(value.selectedTables) ? value.selectedTables.map((table) => {
    const record = parsedObject(table) || {};
    return `${stringValue(record.tableName)}\uFF08ID ${stringValue(record.tableId)}\uFF09`;
  }).join("\u3001") || "\u5C1A\u672A\u9078\u64C7\u684C\u53F0" : "\u672A\u56DE\u50B3";
  const runMode = value.runMode === "continuous" ? "\u6301\u7E8C\u57F7\u884C" : value.runMode === "once" ? "\u55AE\u6B21\u57F7\u884C" : stringValue(value.runMode);
  const startMode = value.startMode === "fresh" ? "\u5168\u65B0\u958B\u59CB" : value.startMode === "resume" ? "\u7E7C\u7E8C\u57F7\u884C" : stringValue(value.startMode);
  const staking = value.staking === "flat" ? "\u5E73\u6CE8" : value.staking === "martingale" ? "\u99AC\u4E01\u683C\u723E" : value.staking === "doubling" ? "\u52A0\u500D" : stringValue(value.staking);
  const selectionMode = value.selectionMode === "auto" ? "\u81EA\u52D5" : value.selectionMode === "manual" ? "\u624B\u52D5" : stringValue(value.selectionMode);
  const tableCount = value.tableCount === "all" ? "\u5168\u90E8\u684C\u53F0" : value.tableCount === void 0 || value.tableCount === null ? "\u672A\u56DE\u50B3" : `${value.tableCount} \u684C`;
  const duration = value.durationMinutes === 0 ? "\u4E0D\u9650\u6642" : stringValue(value.durationMinutes);
  return [
    ["\u8A2D\u5B9A\u7248\u672C", stringValue(value.version)],
    ["\u904A\u6232\u5E73\u53F0", stringValue(value.gamePlatform)],
    ["\u57F7\u884C\u6A21\u5F0F", runMode],
    ["\u555F\u52D5\u65B9\u5F0F", startMode],
    ["\u7B56\u7565\u63D0\u4F9B\u8005", { combined: "AI\u7D9C\u5408", gpt: "GPT", chatgpt: "GPT", claude: "Claude", grok: "Grok", meta: "Meta", deepseek: "DeepSeek", gemini: "Gemini", parity: "\u7D42\u503C\u5947\u5076", counting: "\u56DB\u5F0F\u7B97\u724C", road: "\u724C\u8DEF\u63A8\u85A6" }[String(value.provider)] || stringValue(value.provider)],
    ["\u684C\u53F0\u6578\u91CF", tableCount],
    ["\u9078\u684C\u65B9\u5F0F", selectionMode],
    ["\u5DF2\u9078\u684C\u53F0", selectedTables],
    ["\u57FA\u672C\u91D1\u984D", stringValue(value.baseAmount)],
    ["\u914D\u6CE8\u65B9\u5F0F", staking],
    ["\u55AE\u6CE8\u4E0A\u9650", stringValue(value.maxStake)],
    ["\u6B62\u640D", moneyValue(value.stopLoss)],
    ["\u6B62\u76C8", moneyValue(value.takeProfit)],
    ["\u81EA\u52D5\u505C\u6B62\u6642\u9593\uFF08\u5206\u9418\uFF09", duration],
    ["\u6700\u5C11\u5269\u9918\u79D2\u6578", stringValue(value.minSeconds)],
    ["\u5E63\u5225", stringValue(value.currency)]
  ];
}
function rawSnapshot(snapshot) {
  try {
    return JSON.stringify(snapshot);
  } catch {
    return String(snapshot ?? "");
  }
}
function settingsDetails(snapshot) {
  const fields = settingFields(snapshot);
  return fields ? `<dl>${fields.map(([key, value]) => `<dt>${escapeAdminAuditText(key)}</dt><dd>${escapeAdminAuditText(value)}</dd>`).join("")}</dl>` : `<p class="bad">\u8A2D\u5B9A\u5FEB\u7167\u683C\u5F0F\u7121\u6CD5\u8FA8\u8B58\u6216\u672A\u56DE\u50B3</p><pre>${escapeAdminAuditText(rawSnapshot(snapshot))}</pre>`;
}
function settingsSummary(snapshot) {
  const fields = settingFields(snapshot);
  if (!fields) return { brief: "\u8A2D\u5B9A\u6458\u8981\u672A\u56DE\u50B3", limits: "\u8A2D\u5B9A\u6B04\u4F4D\u672A\u56DE\u50B3" };
  const duration = fields[13][1] === "\u4E0D\u9650\u6642" ? "\u4E0D\u9650\u6642" : fields[13][1] === "\u672A\u56DE\u50B3" ? "\u8A2D\u5B9A\u5206\u9418\u672A\u56DE\u50B3" : `\u8A2D\u5B9A ${fields[13][1]} \u5206\u9418`;
  return {
    brief: `\u7B56\u7565 ${fields[4][1]} \xB7 \u914D\u6CE8 ${fields[9][1]} \xB7 \u6BCF\u6CE8\u984D ${fields[8][1]} \xB7 ${fields[5][1]}`,
    limits: `\u6B62\u640D ${fields[11][1]} / \u6B62\u76C8 ${fields[12][1]} / ${duration}`
  };
}
function renderSettingsCard(row) {
  const summary = settingsSummary(row.snapshot);
  return `<article class="record"><div class="meta"><time>${escapeAdminAuditText(adminAuditTime(row.recorded_at))}</time><span class="badge">\u958B\u59CB\u8A2D\u5B9A\u5DF2\u8A18\u9304</span></div><div class="summary">${escapeAdminAuditText(summary.brief)}</div><div class="limits">${escapeAdminAuditText(summary.limits)}</div><details><summary>\u8A73\u7D30\u8A2D\u5B9A</summary>${settingsDetails(row.snapshot)}<small>\u8072\u660E\u7248\u672C\uFF1A${escapeAdminAuditText(stringValue(row.statement_version))}</small></details></article>`;
}
function safeReportedValue(report, field) {
  const result = report && parsedObject(report.result);
  const value = result?.[field];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "\u672A\u56DE\u50B3";
}
function usageStatus(row) {
  if (row.status === "stopped") {
    const code = row.stop_code ?? parsedObject(row.report).stopCode;
    const labels = {
      manual: "\u624B\u52D5\u505C\u6B62",
      time_limit: "\u8A2D\u5B9A\u6642\u9593\u5230",
      stop_loss: "\u6B62\u640D\u4FDD\u8B77",
      take_profit: "\u9054\u6B62\u76C8",
      stake_cap: "\u55AE\u6CE8\u4E0A\u9650",
      other: "\u505C\u6B62\u4FDD\u8B77"
    };
    return typeof code === "string" && typeof labels[code] === "string" ? `\u5DF2\u505C\u6B62 \xB7 ${labels[code]}` : "\u5DF2\u505C\u6B62";
  }
  if (row.status === "interrupted") return "\u56DE\u5831\u4E2D\u65B7 \xB7 \u4FDD\u7559\u6700\u5F8C\u89C0\u6E2C\u6642\u9593";
  if (row.status !== "active") return "\u72C0\u614B\u672A\u56DE\u50B3";
  const updated = new Date(String(row.server_updated_at ?? "")).getTime();
  return Number.isFinite(updated) && Date.now() - updated > USAGE_OFFLINE_MS ? `\u5931\u806F\uFF0F\u6700\u5F8C\u56DE\u50B3\u65BC ${adminAuditTime(row.server_updated_at)}` : "\u9032\u884C\u4E2D\uFF08\u5BA2\u6236\u7AEF\u56DE\u5831\uFF09";
}
function renderUsageCard(row) {
  const summary = settingsSummary(row.settings_snapshot);
  if (row.record_source === "settings_only") {
    return `<article class="record"><div class="meta"><time>${escapeAdminAuditText(adminAuditTime(row.recorded_at))}</time><span class="badge warn">\u6B64\u820A\u8A2D\u5B9A\u5C1A\u7121\u4F7F\u7528\u56DE\u50B3</span></div><div class="summary">${escapeAdminAuditText(summary.brief)}</div><div class="limits">${escapeAdminAuditText(summary.limits)}</div><details><summary>\u5B8C\u6574\u8A2D\u5B9A</summary>${settingsDetails(row.settings_snapshot)}<small>\u8A2D\u5B9A\u4E8B\u4EF6 ID\uFF1A${escapeAdminAuditText(stringValue(row.settings_event_id))}</small></details></article>`;
  }
  const report = parsedObject(row.report);
  const pending = safeReportedValue(report, "pendingCount");
  const uncertain = safeReportedValue(report, "uncertainCount");
  const settledPnl = safeReportedValue(report, "settledPnl");
  const joinedSettings = row.settings_snapshot === null || row.settings_snapshot === void 0 ? '<small class="bad">\u5C0D\u61C9\u8A2D\u5B9A\u5FEB\u7167\u672A\u56DE\u50B3\uFF1B\u4E0D\u88DC\u9020\u8A2D\u5B9A\u6B04\u4F4D\u3002</small>' : `<details><summary>\u5B8C\u6574\u8A2D\u5B9A</summary>${settingsDetails(row.settings_snapshot)}<small>\u8A2D\u5B9A\u4E8B\u4EF6 ID\uFF1A${escapeAdminAuditText(stringValue(row.settings_event_id))}</small></details>`;
  return `<article class="record"><div class="meta"><time>\u5BE6\u969B\u958B\u59CB\uFF1A${escapeAdminAuditText(epochAuditTime(row.client_started_at_ms))}</time><span class="badge">${escapeAdminAuditText(usageStatus(row))}</span></div><div class="summary">\u5BE6\u969B\u4F7F\u7528\u6642\u9593\uFF1A${escapeAdminAuditText(formatElapsed(row.elapsed_ms))}</div><div class="limits">\u672C\u6B21\u5DF2\u7D50\u7B97\u8F38\u8D0F\uFF1A${escapeAdminAuditText(settledPnl)}\uFF08\u5BA2\u6236\u7AEF\u56DE\u5831\uFF0C\u975E DG \u5B98\u65B9\u5831\u8868\uFF09<br>\u5F85\u7D50\u7B97\uFF1A${escapeAdminAuditText(pending)} \uFF0F \u6B78\u5C6C\u4E0D\u660E\uFF1A${escapeAdminAuditText(uncertain)}\uFF08\u5BA2\u6236\u7AEF\u56DE\u5831\uFF0C\u672A\u4F75\u5165\u5DF2\u7D50\u7B97\u640D\u76CA\uFF09</div><div class="limits">${escapeAdminAuditText(summary.brief)}<br>${escapeAdminAuditText(summary.limits)}</div>${joinedSettings}<details><summary>\u56DE\u50B3\u8CC7\u8A0A</summary><dl><dt>Run ID</dt><dd>${escapeAdminAuditText(stringValue(row.run_id))}</dd><dt>\u6700\u65B0\u5E8F\u865F</dt><dd>${escapeAdminAuditText(stringValue(row.sequence))}</dd><dt>\u6700\u5F8C\u5BA2\u6236\u7AEF\u66F4\u65B0</dt><dd>${escapeAdminAuditText(epochAuditTime(row.client_updated_at_ms))}</dd><dt>\u5F8C\u53F0\u6700\u5F8C\u63A5\u6536</dt><dd>${escapeAdminAuditText(adminAuditTime(row.server_updated_at))}</dd></dl></details></article>`;
}
function renderAcknowledgementCard(row) {
  return `<article class="record"><div class="meta"><time>${escapeAdminAuditText(adminAuditTime(row.recorded_at))}</time><span class="badge">${escapeAdminAuditText(stringValue(row.game_platform))} \xB7 \u5DF2\u52FE\u9078</span></div><details><summary>\u67E5\u770B\u7576\u6642\u8072\u660E</summary><pre>${escapeAdminAuditText(stringValue(row.statement_text))}</pre><small>\u8072\u660E\u7248\u672C\uFF1A${escapeAdminAuditText(stringValue(row.statement_version))}</small><small>SHA-256\uFF1A${escapeAdminAuditText(stringValue(row.statement_sha256))}</small></details></article>`;
}
function adminAuditDetailsPage(data, kind) {
  const root = `/api/admin/whitelist/${encodeURIComponent(String(data.account.id))}`;
  const current = `${root}/${kind === "usage" ? "records" : kind}`;
  const title = kind === "usage" ? "\u4F7F\u7528\u7D00\u9304" : kind === "settings" ? "\u4F7F\u7528\u8A2D\u5B9A" : "\u514D\u8CAC\u78BA\u8A8D";
  const content = data.unavailable ? `<div class="empty">${kind === "usage" ? "\u6B64\u7AD9\u5C1A\u672A\u555F\u7528\u4F7F\u7528\u56DE\u50B3\u5BE9\u6838\uFF1B\u4E0D\u4EE5\u7A7A\u767D\u30010 \u5206\u9418\u6216 0 \u640D\u76CA\u88DC\u9020\u3002" : "\u6B64\u7AD9\u5C1A\u672A\u555F\u7528\u6B64\u985E\u5BE9\u6838\u7D00\u9304\uFF1B\u4E0D\u4EE5\u7A7A\u767D\u6216 0 \u88DC\u9020\u3002"}</div>` : data.rows.map((row) => kind === "usage" ? renderUsageCard(row) : kind === "settings" ? renderSettingsCard(row) : renderAcknowledgementCard(row)).join("") || '<div class="empty">\u5C1A\u7121\u7D00\u9304\uFF1B\u90E8\u7F72\u524D\u7684\u64CD\u4F5C\u4E0D\u6703\u88DC\u9020\u3002</div>';
  const hint = "\u8CC7\u6599\u4F86\u6E90\uFF1AAutoBac DG \u5BA2\u6236\u7AEF\u56DE\u5831\uFF0C\u975E\u5B98\u65B9\u5831\u8868\uFF1B\u5F85\u7D50\u7B97\uFF0F\u6B78\u5C6C\u4E0D\u660E\u4E0D\u7B97\u5165\u8F38\u8D0F\u3002\u7F3A\u8CC7\u6599\u6A19\u793A\u672A\u56DE\u50B3\uFF0C\u4E0D\u88DC\u9020\u3002";
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title}</title><style>
*{box-sizing:border-box}body{margin:0;background:#080e13;color:#ecf0ed;font:14px system-ui,-apple-system,"Noto Sans TC",sans-serif}main{max-width:760px;margin:auto;padding:24px 16px}a{color:#a7d4c0;text-decoration:none}h1{font-size:22px;margin:18px 0 6px}.account{color:#a3afa9;overflow-wrap:anywhere}.tabs{display:flex;gap:8px;margin:20px 0 12px;flex-wrap:wrap}.tabs a{padding:11px 16px;border:1px solid #354640;border-radius:9px}.tabs a[aria-current=page]{background:#234137;color:#fff}.hint{color:#91a098;line-height:1.7;font-size:12px;margin-bottom:18px}.record{padding:16px;border:1px solid #2d4039;background:#111c20;border-radius:12px;margin-bottom:10px;min-width:0}.meta{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;color:#9aaba1;font-size:12px}.badge{color:#b8e3c7}.warn{color:#f0b45f}.summary{font-weight:700;font-size:15px;margin:10px 0;line-height:1.6;overflow-wrap:anywhere}.limits{font-size:12px;color:#bdc8c0;line-height:1.7;overflow-wrap:anywhere}details{margin-top:12px}summary{cursor:pointer;color:#a7d4c0;padding:7px 0}dl{display:grid;grid-template-columns:minmax(80px,120px) minmax(0,1fr);gap:8px;margin:10px 0;line-height:1.6}dt{color:#9aaba1}dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px system-ui;line-height:1.7}small{display:block;color:#99aaa1;overflow-wrap:anywhere;line-height:1.7}.bad{color:#ff9ca4}.empty{padding:28px 12px;color:#91a098;text-align:center}.pages{display:flex;justify-content:center;align-items:center;gap:18px;margin:22px 0}.pages a{padding:10px}.back{display:inline-block;padding:8px 0}.version{display:inline-block;margin-left:8px;padding:3px 7px;border:1px solid #496153;border-radius:99px;color:#b8e3c7;font-size:10px;font-weight:700;vertical-align:middle}@media(max-width:400px){main{padding:16px 12px}.record{padding:13px}}
</style></head><body><main><a class="back" href="/admin">\u2190 \u8FD4\u56DE\u767D\u540D\u55AE</a><h1>${title}<span class="version">v3.2.14</span></h1><div class="account">${escapeAdminAuditText(data.account.platform)} \xB7 ${escapeAdminAuditText(data.account.username)}</div><nav class="tabs" aria-label="\u7D00\u9304\u7A2E\u985E"><a href="${root}/records"${kind !== "acknowledgements" ? ' aria-current="page"' : ""}>\u4F7F\u7528\uFF0F\u8A2D\u5B9A</a><a href="${root}/acknowledgements"${kind === "acknowledgements" ? ' aria-current="page"' : ""}>\u514D\u8CAC\u78BA\u8A8D</a></nav><p class="hint">\u5171 ${data.unavailable ? "\u5F85\u540C\u6B65" : escapeAdminAuditText(data.total)} \u7B46 \xB7 \u53F0\u5317\u6642\u9593\u3002\u8A73\u7D30\u5167\u5BB9\u6309\u4E00\u4E0B\u5C55\u958B\u3002<br>${hint}</p>${content}<nav class="pages" aria-label="\u7D00\u9304\u5206\u9801">${data.page > 1 ? `<a href="${current}?page=${data.page - 1}">\u4E0A\u4E00\u9801</a>` : ""}<span>${escapeAdminAuditText(data.page)} / ${escapeAdminAuditText(data.pages)}</span>${data.page < data.pages ? `<a href="${current}?page=${data.page + 1}">\u4E0B\u4E00\u9801</a>` : ""}</nav></main></body></html>`;
}
async function sendAdminAuditPage(req, res, kind, deps) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const id = Number(req.params.id);
  const page = safePage(req.query.page);
  if (!Number.isSafeInteger(id) || id < 1 || page === null) return res.status(400).send("\u7121\u6548\u7D00\u9304\u9801");
  try {
    const db = deps.getPool();
    if (!db) return res.status(503).send("\u7D00\u9304\u8CC7\u6599\u5EAB\u5C1A\u672A\u8A2D\u5B9A\uFF08\u5F85\u540C\u6B65\uFF09");
    const data = await readAdminAuditRecords(db, id, page, kind);
    if (!data) return res.status(404).send("\u627E\u4E0D\u5230\u6B64\u767D\u540D\u55AE\u5E33\u865F");
    return res.type("html").send(adminAuditDetailsPage(data, kind));
  } catch {
    return res.status(503).send("\u7D00\u9304\u66AB\u6642\u7121\u6CD5\u8B80\u53D6\uFF08\u5F85\u540C\u6B65\uFF09\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66");
  }
}
function registerAdminAuditReader(app, requireAdmin, deps) {
  app.get(
    ["/api/admin/whitelist/:id/records", "/api/admin/whitelist/:id/usage"],
    requireAdmin,
    (req, res) => void sendAdminAuditPage(req, res, "usage", deps)
  );
  app.get(
    "/api/admin/whitelist/:id/settings",
    requireAdmin,
    (req, res) => void sendAdminAuditPage(req, res, "settings", deps)
  );
  app.get(
    "/api/admin/whitelist/:id/acknowledgements",
    requireAdmin,
    (req, res) => void sendAdminAuditPage(req, res, "acknowledgements", deps)
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  adminAuditDetailsPage,
  adminAuditTime,
  escapeAdminAuditText,
  readAdminAuditRecords,
  registerAdminAuditReader,
  sendAdminAuditPage
});
