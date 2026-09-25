# ScarabHeart2 Web v2.58 — ATG Non-blocking Loader Fix

本版針對最新 HAR 的剩餘 429 / 502 / 503 根因修正：

- ATG 遊戲 HTML 的 `<base>` 直接指向真實 `play.godeebxp.com` 遊戲目錄。
- Cocos 的 `assets/resources`、`assets/main`、`src`、`cocos-js`、圖片、音效、JSON、WASM 等相對資源會從一開始就直接走 ATG，不先經 Render。
- `slotFramework/manifest.json` 仍使用同源橋接，但會把 ATG 回傳的無協定 URL 正規化成完整 `https://play.godeebxp.com/slotFramework/<hash>`。
- slotFramework 的 `config/index/import/native` 直接向 ATG 載入。
- Runtime 腳本改用 `location.origin` 明確載入，避免新的遠端 `<base>` 讓懸浮腳本誤跑到 ATG 網域。
- 保留懸浮、加速、換房重新綁定、即時資料、WebSocket bridge、35 秒手動選房 fallback。
- Render 端原有 302/307 僅保留為漏網 fallback，正常流程不應再靠它承載大量 Cocos 資源。


## v2.58 修正

- ATG iframe 本體一載入就釋放全螢幕 Loading，不再讓懸浮/引擎偵測訊息重新蓋住遊戲。
- `engine-wait` 只在 iframe 尚未載入時顯示；遊戲載入後懸浮工具改為背景接續。
- 懸浮 runtime 載入失敗時不再鎖死 ATG，遊戲仍可操作。
- 自動定位機台等待由 35 秒縮短為 12 秒，逾時立即切換手動選房。
- 保留既有懸浮、加速、即時資料、WebSocket bridge 與換房重新綁定。
