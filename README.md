# ScarabHeart2 Web v2.53（ATG 程式內遊戲版）

這是可部署到 Render 的網站原始檔，不是 APK。

## 這版已改好

- 電腦登入頁恢復為左側大型聖甲蟲、右側登入介面。
- TZ 與 OFA 登入由使用者瀏覽器直接呼叫娛樂城 API；不再把 TZ 登入繞到 Render。
- 遊戲在聖甲之心網站內全畫面載入，不會另開官方 ATG 分頁。
- 遊戲頁、資源、Fetch/XHR 與 WebSocket 由同一個受限代理工作。
- WebSocket 上游會使用 ATG 所需的 https://play.godeebxp.com Origin。
- 懸浮工具會在遊戲頁載入，並監聽目前登入遊戲的服務連線。
- 速度控制真正呼叫 Cocos TimeManager.instance.setTimeScale()。
- 一般遊戲提供 1X／2X／4X／8X；戰神賽特 1、戰神賽特 2、虎小妹另提供 16X／MAX。
- MAX 使用持續 32X，避免把 999 直接寫入 Cocos 導致頁面凍結。
- 劇透功能沿用 ATG 引擎，只在購買免遊後讀取伺服器回傳的整輪結果。
- 專案只有 ATG 遊戲與 ATG 引擎。
- 公告中的 LINE 網址會被擋下，不會顯示。

## 上傳 GitHub

1. 解壓縮 ZIP。
2. 將解壓後的所有內容上傳到 GitHub 儲存庫根目錄。
3. 確認 package.json、server.js、render.yaml、public、runtime 在同一層。
4. 不要上傳 HAR、代理後台 Bearer Token、密碼或驗證器金鑰。

## Render 設定

- Runtime：Node
- Build Command：npm install
- Start Command：npm start
- Health Check Path：/healthz
- Node：20 以上

部署完成後開啟 /healthz，應看到：

    {"ok":true,"version":"2.53-atg-inapp"}

## 測試順序

1. 用自己的 TZ 帳號登入。
2. 選一款 ATG 遊戲與機台。
3. 確認遊戲留在網站內載入。
4. 確認懸浮工具顯示「遊戲引擎已連線」。
5. 點 2X，觀察實際動畫速度與工具狀態。
6. 開啟劇透，實際購買免遊後確認整輪結果。

靜態檢查與本機流程測試不需要帳號；TZ 真實登入、下注與購買免遊仍必須由你部署後使用自己的測試帳號驗證。


## v2.53.1 ATG in-app stability fix
- Runtime bootstrap waits for the game DOM/body before starting engine, live adapter, and floating assistant.
- Auto room targeting falls back to manual room selection after 35 seconds instead of blocking indefinitely.
- Floating assistant is automatically re-mounted if the game rebuilds the DOM and removes it.
- Large media/font resources bypass Render and load from ATG directly; runtime/API/WebSocket traffic remains proxied where required.
- Existing floating assistant runtime and controls are preserved.
