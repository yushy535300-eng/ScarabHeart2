# v3.2.22 ATG 共用載入修正

## 這次正式站 HAR 確認的問題

- 上一版腳本修正已經部署生效，TZ 登入、ATG 大廳交握與賽特2遊戲文件都有成功回傳。
- 真正停在 ATG 標誌的位置：src/import-map.json 被導到 play.godeebxp.com，原站沒有 Access-Control-Allow-Origin，瀏覽器將回應標示 net::ERR_FAILED，因此 Cocos 引擎無法繼續載入。
- 原站 HAR 亦顯示 settings.json、各 bundle config.json 與框架資源沒有跨域授權。只修 import-map.json 仍會卡在後續資源。
- 正式站大廳握手另有 401「找不到 Token 資料」。背景推薦、按鈕預熱和實際進入流程會建立多個入口；原程式也會以同一個失效 Token 重試。

## 修正內容

- 所有 ATG 遊戲共用的遊戲腳本、JSON、圖片、音效、框架資源改走網站同源代理，不再將這些請求重新導向原站。
- 包含原站根目錄的 slotFramework、images 和 avatars 路徑。
- 靜態資源使用最多 32 MiB 的記憶體快取、下載合併及最多 8 個同時下載，減少重複傳輸。錯誤回應與帶參數資源不共用快取。
- 移除按鈕預熱與預取入口，避免先消耗遊戲連線。
- 背景推薦與實際入口取用依序執行；進入時取消背景連線，已送出的 TZ HTTP 請求完成後再取得新入口。
- 大廳收到 401 立即停止，不再繼續送 lobbyPlay。重試須重新向 TZ 取得入口，不重用失效 Token。
- 保留上一版的大廳版本同步及遊戲版本更新。

## 部署

1. 將壓縮檔內 ScarabHeart2-main 的內容覆蓋到原 GitHub 專案根目錄；不要再多包一層資料夾。
2. 保留原 Render 環境變數與資料庫設定。沿用 npm install、npm start。
3. Render 部署完成後重新整理網站、重新登入。畫面版本應顯示 v3.2.22-atg-loading-fix。

## 驗證範圍

已執行語法檢查、資源代理、Token 失效重試與取消測試，以及原有登入、權限和返回流程測試。此修正處理全部 ATG 遊戲共用的載入層；未以使用者的帳密或 HAR 令牌登入正式平台，不能把本機驗證當成所有遊戲已在線上逐一完成進房測試。

## 本次驗證結果

- 語法檢查通過。
- 14 項入口、資源、Token、登入與權限測試通過。
- 2 項主機規則及返回流程測試通過。
- Chromium 以賽特2 HAR 離線重播，在模擬正式網域的框架分支下，確認 SystemJS、Cocos、App 及 slotFramework 都已載入，並進到遊戲 WebSocket 連線步驟。此測試在身分驗證前停止，不會使用實際 Token 登入或操作遊戲；HAR 未收錄的 ASTC 紋理不列為已驗證素材。
