# ScarabHeart2 Web v2.56 — ATG DIRECT ASSETS

本版針對 v2.55 實測 HAR 中的 ATG 黑畫面修正。

## HAR 確認到的主因
v2.55 將 `/slotFramework/<hash>/import/*` 與 `/native/*` 等數百筆 Cocos 資產經 Render 代理，實測產生大量 502 / 503，接著觸發 429，造成遊戲永遠缺資源而卡在黑畫面。

## v2.56 修正
- 只有 `/slotFramework/manifest.json` 維持同源 Render bridge（原站該項沒有 CORS header）。
- `/slotFramework/<hash>/config.json`、`index.js`、`import/*`、`native/*` 改由瀏覽器直接向 ATG `play.godeebxp.com` 載入。
- 同時處理 fetch、XMLHttpRequest、Image.src、Script.src、Link.href、Audio/Video/Source、setAttribute、Worker、SharedWorker 等常見 Cocos 載入方式。
- 若仍有未被 hook 的 `/slotFramework/*` GET/HEAD，Render 只做 307 導向，不再下載/轉送資產。
- 保留 ATG WebSocket bridge、懸浮、即時資料、換房重綁、加速與 35 秒手動選房 fallback。
- 加速仍等待 ATG/Cocos ready 後才掛載，不改 WebSocket/heartbeat 時鐘。

## 部署後驗證
登入 → ATG → 選房 → 進機台。Network 應看到大量 `slotFramework/<hash>/import`、`native` 直接由 `play.godeebxp.com` 回 200，而不是集中打 `scarabheart2.onrender.com`。
