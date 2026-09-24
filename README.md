# ScarabHeart2 Web v2.51（正式功能版）

這是可部署到 Render 的網站原始檔，不是 APK。網站會在同網域代理遊戲頁面，讓遊戲內的浮動面板可以真正呼叫已注入的 ATG／RSG 引擎。

## 已接上的功能

- TZ／OFA 原登入與遊戲選擇流程
- 遊戲頁、XHR／Fetch、Cookie 與 WebSocket 同網域代理
- 遊戲內浮動面板真正呼叫引擎，不用假的按鈕狀態冒充成功
- AUTO START／STOP、FREE 自動、停利停損、訊號與機台功能
- 速度控制會先確認引擎接受倍率；未支援時會顯示失敗，不會假亮
- 一般遊戲提供 1X／2X／4X／8X；支援的三款 ATG 遊戲另外提供 16X／MAX
- 劇透只顯示「購買免遊」後由遊戲伺服器回傳的整輪結果；普通旋轉不顯示
- 正式 API 模式：會員、金幣、通行證與資格不再使用本機假資料
- 沒有任何 LINE 連結；公告 API 即使回傳 LINE 網址也會被網站擋掉

## 上傳 GitHub

1. 解壓縮 ZIP。
2. 把解壓後的所有內容上傳到 GitHub 儲存庫根目錄。`package.json`、`server.js`、`render.yaml`、`public` 必須在同一層。
3. 請勿上傳 HAR、代理後台 Bearer Token、密碼或 Google 驗證器金鑰。
4. Commit changes。

## Render 部署

現有 Web Service 可使用：

- Runtime：Node
- Build Command：`npm install`
- Start Command：`npm start`
- Health Check Path：`/healthz`
- Node：20 以上

儲存設定後執行 **Manual Deploy → Clear build cache & deploy**。部署完成後開啟：

`https://你的網址.onrender.com/healthz`

看到 `{"ok":true,"version":"2.51-real-engine"}` 就代表新版伺服器已上線。Render 免費方案休眠後第一次開啟可能需要約 30～60 秒。

## 實機測試順序

1. 用自己的 TZ／OFA 測試帳號登入。
2. 選遊戲並進入真實遊戲頁。
3. 浮動面板的速度頁應顯示「遊戲引擎已連線」。
4. 點 2X；只有引擎成功接受時才會顯示「引擎已套用 2X」。
5. 點 AUTO START，再用 STOP 停止。
6. 開啟劇透後先跑普通旋轉，普通旋轉不應出現結果。
7. 實際購買免遊；遊戲伺服器回傳後，「本輪免遊最終結果」才會更新。

遊戲商如果日後更換網域、Socket 協定或遊戲內節點名稱，對應引擎可能需要跟著更新；面板會保留失敗狀態，方便分辨是引擎未連線，而不是假裝功能已啟用。
