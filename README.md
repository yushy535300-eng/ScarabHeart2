# ScarabHeart2 Web v2.57 — ATG Direct Base Fix

本版針對最新 HAR 的剩餘 429 / 502 / 503 根因修正：

- ATG 遊戲 HTML 的 `<base>` 直接指向真實 `play.godeebxp.com` 遊戲目錄。
- Cocos 的 `assets/resources`、`assets/main`、`src`、`cocos-js`、圖片、音效、JSON、WASM 等相對資源會從一開始就直接走 ATG，不先經 Render。
- `slotFramework/manifest.json` 仍使用同源橋接，但會把 ATG 回傳的無協定 URL 正規化成完整 `https://play.godeebxp.com/slotFramework/<hash>`。
- slotFramework 的 `config/index/import/native` 直接向 ATG 載入。
- Runtime 腳本改用 `location.origin` 明確載入，避免新的遠端 `<base>` 讓懸浮腳本誤跑到 ATG 網域。
- 保留懸浮、加速、換房重新綁定、即時資料、WebSocket bridge、35 秒手動選房 fallback。
- Render 端原有 302/307 僅保留為漏網 fallback，正常流程不應再靠它承載大量 Cocos 資源。


## v2.59 ALL-GAMES / SMOOTH fix (2026-09-25)

- HAR-verified ATG identities for 9 games (gameId / mechanism / checksum).
- Prevents stale board requests from one game overwriting another after fast switching.
- Per-game recommendation cache; transient empty responses no longer erase a valid list.
- If a selected ranking tab is empty, the UI temporarily shows composite recommendations instead of a blank panel.
- ATG direct lobbyPlay validates the requested game code and retries once on short transient socket failures.
- Game iframe becomes usable immediately after page load. `engine-wait` / overlay failures never re-block the real game.
- Auto room targeting falls back to manual room selection after 12 seconds instead of holding the game for 35 seconds.
- Existing overlay, speed, auto functions, FREE, stop-profit/stop-loss and machine control runtimes are retained.


## v2.60 EXACT ROOM + SMOOTH ATG fix

HAR findings addressed:
- Selected recommendation 3557 was correctly passed as roomId `seth2_353157` / machine `3557`.
- The failure was downstream: exact-room targeting could be abandoned when the live room table was late.
- Room fallback state no longer persists between game entries.
- Recommendation room ids are normalized to the numeric ATG room id before engine targeting.
- Exact recommendation requests remain exact; after timeout the game stays usable while room matching continues.
- A root service worker redirects versioned `/slotFramework/<hash>/...` resources directly to ATG.
  This prevents the repeated Render/Cloudflare 429, 502 and 503 bursts observed in the uploaded HAR.


## v2.61 Render-stable architecture

- Removes/unregisters the root service worker from v2.60.
- Render never downloads versioned `slotFramework/<hash>/...` files.
- Heavy ATG framework/image/json/audio requests receive an immediate 307 to `play.godeebxp.com`.
- Only `slotFramework/manifest.json` remains bridged through Render.
- Preserves v2.60 exact-room logic and existing floating-assistant features.
- Adds process-level logging guards so transient async errors do not terminate the Node process.


## v2.62 machine-number auto room fix

Observed symptom:
- Auto room picker scanned page 1 through 9 but the overlay showed a target like `#65`.
- ATG's visible selector contains machine numbers (e.g. 2501, 2781, 3557), not internal room ids.

Fix:
- Recommended-room visual search always targets `machineNum`.
- Internal `roomId` remains available as `FULL_ROOM_ID` only for validation/diagnostics.
- Runtime payload is normalized before the engine starts so stale `TARGET_KIND=roomId` cannot leak into the scanner.
- Existing Render-stable direct-asset changes and floating assistant features remain unchanged.


## v2.63 re-entry auto-room reset

Fixes:
- Returning from ATG to the program room page and entering again now starts a fresh room-selection session.
- Each `enterGame()` generates a unique `ROOM_SESSION_ID`.
- Previous manual fallback / room-done / last-room / last-machine state is cleared before every launch.
- The iframe is reset to `about:blank` before loading the next ATG session so the prior auto-room runtime cannot survive re-entry.
- Machine-number targeting from v2.62 and Render-stable asset handling from v2.61 are preserved.


## v2.64 room-session scope fix

- Fixes `roomSessionId is not defined` shown on the room-selection page.
- `ROOM_SESSION_ID` is now stored in a shared app-level variable and refreshed for every `enterGame()` call.
- Re-entry auto-room reset from v2.63 remains enabled.
- Machine-number visual targeting from v2.62 and Render-stable asset handling from v2.61 remain unchanged.


## v2.65 correct roomId auto-select contract

Root cause found in the actual ATG engine runtime:
- The engine only activates its exact-room path when `TARGET_KIND` is `roomId`
  (or when TARGET is non-numeric).
- It then resolves `roomId -> machineNum` from the live ATG table map.
- `MACHINENUM` is already the built-in fallback if that map is late.

v2.62-v2.64 incorrectly overwrote `TARGET` with machineNum and set
`TARGET_KIND=machineNum`, which bypassed the engine's native exact-room path.

Fix:
- Recommendation entry: `TARGET = roomId`, `TARGET_KIND = roomId`,
  `MACHINENUM = recommended machine number`.
- Typed machine entry uses the existing machine fallback path.
- Bootstrap no longer overwrites TARGET/TARGET_KIND.
- Re-entry session reset and Render-stable asset routing remain preserved.
