# 聖甲之心助手 3.18.4

## 這版修正
- ATG 房號支援服務回傳的前綴格式，例如 `seth2_022`；保留 `022` 前導零，不會把它改成 `22`。
- 合成的 `__machine__` 占位值不再當成真實房號，避免點選後才失敗。
- 月兔仍留在 QT 啟動器內，透過程式內遊戲代理 iframe 載入；QT 啟動子網域納入允許清單。

## 使用及部署
- Android APK 仍需連線 `https://scarabheart2.onrender.com/` 進行會員驗證與遊戲代理。
- 若 Render 服務尚未更新，需先部署本專案的 `server.js`，月兔仍可能顯示舊的「Game host is not allowed」錯誤。
- APK 已簽署；沒有 Android 真機測試。測試結果只涵蓋模擬登入、入口流程、房號前綴處理與程式語法，不能代表真實帳號、2176 房號或所有遊戲已實機驗收。

## 驗證
- `test-dom.cjs`：模擬 APK 選單登入及 QT/RSG 走程式內代理 iframe。
- `test-room-id.cjs`：檢查前綴房號、前導零及占位房號判斷。
- `test-hosts.cjs`：檢查 QT 網域允許清單。
- `npm run check`：檢查伺服器、前端與遊戲控制程式語法。
