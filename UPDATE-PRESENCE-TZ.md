# 聖甲之心：TZ 登入介面與共用在線統計更新

## 登入介面

- 登入頁與登入後狀態固定顯示 **TZ ONLINE**；頁面沒有 OFA 標籤、選單或選項。
- 這是**顯示層**調整，不是平台強制轉換。登入時會先以帳號查詢既有、有效且未到期的 `tz_whitelist` 資料，取得實際平台後才連線至原本對應的登入端點。
- 真正通過登入的實際平台會保留在記憶體 session 中，並用於原本的白名單分區、ATG 請求與後續流程；不會因為顯示 TZ 而改寫為 TZ。
- 同一帳號若同時具有兩個有效平台白名單而無法安全判定，登入會停止並要求管理員確認；不會猜測平台或把憑證送往另一個平台。
- 登入前的簡短說明明示：在線統計不記錄捲動、IP、密碼或遊戲網址。

## 共用在線統計

每個網站僅建立自己的同源 WebSocket：`/api/presence/ws`。不同網站之間**不傳遞 Cookie、session 或憑證**。

1. Scarab 完成原本登入及白名單驗證後，瀏覽器以第一個 WebSocket frame 傳送 `{ "type": "auth", "sessionId": "..." }`。
2. 此 ID 只留在該 socket 的記憶體閉包中；不會出現在 URL、資料表、日誌或 API 回應中。
3. Scarab 的唯讀 adapter 先驗證自己的原始 `accessSessions` 目前 session，然後再次唯讀檢查 `tz_whitelist` 的平台、帳號、`enabled=TRUE` 和未到期狀態。
4. 連線使用同源 Origin 檢查、嚴格 frame 形狀、認證逾時與 ping/pong 租約。登出、session 失效、頁面離開及 socket 關閉都會清除連線資料列；斷線租約最多 25 秒失效。

Scarab 不含自動下注來源，因此即使客戶端送出 `running:true`，後端也會寫入 `false`。

## PostgreSQL 共用資料表

所有採用此更新的網站共用下列暫態資料表：

```sql
CREATE TABLE autobac_user_presence (
  connection_id UUID PRIMARY KEY,
  platform VARCHAR(16) NOT NULL,
  username_key VARCHAR(128) NOT NULL,
  running BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  app_id VARCHAR(32) NOT NULL DEFAULT 'autobac'
);
```

管理端的 `/api/admin/presence` 只統計仍在 25 秒租約內、且 `tz_whitelist` 仍有效的 `(platform, username_key)` 唯一帳號。因此可與 AutoBac、Helper 共享即時白名單統計，而不共享應用程式登入狀態。

## 檔案與驗證

- `server/user-presence.js` 和 `public/user-presence-client.js` 是由已定稿的可攜原始碼編譯而來的 Scarab 自有 JavaScript；不會在部署期依賴父專案。
- `access-auth.js` 是 Scarab 專用、唯讀的帳號路由及 session 驗證 adapter；未修改 `whitelist.js` 或管理白名單流程。
- `test-tz-presence.cjs` 使用匿名假資料與 localhost socket，不連線平台或真實資料庫，涵蓋 UI、OFA 實際路由、session/白名單重驗、presence lifecycle 及跨來源拒絕。

執行：`npm ci && npm run check && npm test`

## 本次修正：公開 Origin 與既有 session 存續期

- Scarab 的 presence registrar 現傳入 `publicOrigin: process.env.PRESENCE_PUBLIC_ORIGIN || 'https://scarabheart2.onrender.com'`。核心以完整 **scheme + host** 比對瀏覽器 `Origin`；不採信或偽造 `X-Forwarded-*`／`Forwarded` 標頭。
- 本機測試不注入 `publicOrigin`，維持直接 `http://127.0.0.1` 的同源驗證；另測試同一 host、不同 scheme 必定回應 `403`，且不觸及資料庫。
- `access-auth.js` 不再自行以 6 小時判定 presence session 過期。它只讀取原本的 `accessSessions` map，接著重驗既有的 enabled／未到期白名單；原有 `/api/access/check`、其權限規則及每 30 分鐘執行的 6 小時 map 清理均未修改。故 map 尚存時 UI 與 presence 判定一致，原清理刪除後 presence 立即拒絕。
- 驗證僅使用 localhost 假資料與 socket；沒有讀取 `.env`、沒有資料庫寫入、沒有外部平台登入或部署。

