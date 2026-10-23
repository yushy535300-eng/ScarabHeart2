# RSG 原生網頁開始按鈕

正式站使用者回報上一版補送 Cocos click 仍無法進場；正式站紀錄確認上一版腳本已載入，不能歸因於未更新。

本版移除補送 click 的方案。依 LoadingBar 原始 btnStart 的 UITransform 及渲染相機計算精確 DOM 位置，建立透明、可鍵盤操作的網頁開始按鈕，保留原本遊戲畫面。在使用者真正點擊且原始按鈕仍啟用、可互動時，直接呼叫 LoadingBar._onFinishListener（原版開始按鈕完成後的同一個回呼），不再依賴 Cocos 的按下／放開事件配對。

進入主場景後移除按鈕。禁止程式合成點擊、連點重複執行、非載入場景或停用控制；未取得有效投影位置時不建立猜測位置的可點區域。無下注、轉動或其他遊戲操作。

新增 /api/provider-status/:sid 診斷端點，限有效 RSG 工作階段，僅記錄 stage、scene、version、bound，不記錄帳號、token、網址、封包或餘額。

驗證：25 項測試及語法檢查通過。以使用者 HAR 在隔離瀏覽器完整回放，將遊戲嵌入同源 iframe 後，由 Playwright 真實滑鼠點擊網頁開始按鈕，結果 loading_scene → game_scene；starts=1、lastEvent=entered，狀態回報 ready → native-start → entered。此為 HAR 回放，未連正式會員遊玩；不將其當成正式會員成功進場的證明。
