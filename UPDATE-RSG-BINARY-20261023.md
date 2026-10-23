# RSG 公開資源二進位完整性修正

對照正常進場 HAR 與聖甲之心 HAR：165 個共有的 base64 二進位資源中 41 個不同，異常內容含大量 EF BF BD。正常資源雖宣告 text/plain，實際是 WebP 或 Cocos bin。RSG 公開 CDN 回應 Access-Control-Allow-Origin: *。

- 公開資源僅限 gameresource / gameresource3 的 rsgaming666.com / rsgaming888.com，以及 /WebUI3/、/Lobby/ 路徑，瀏覽器直接載入原網址。
- 兩條伺服器代理路由對上述 GET/HEAD 資源轉址回原 CDN，避免二進位內容經文字傳輸路徑損壞。
- CSS 回到原 CDN 位址，使相對圖片路徑依原路徑解析。
- 本站 provider-rsg-nav.js 排除遊戲代理改寫，修正 404。
- 遊戲頁、SessionInfo、WebSocket、授權流程和 ATG 保留。

驗證：語法檢查通過；22 項測試通過，含 CDN 分流、非公開請求限制、腳本路徑與原有 ATG/權限測試。尚未以正式會員重新點開始實測，不將部署成功視為完整遊玩驗證。
