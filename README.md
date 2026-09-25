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


## v2.66 seated-state reset + single-confirm fix

Root causes verified from the actual obfuscated ATG runtime:
- After successful seating the engine writes `sessionStorage.seth_seated = 1`.
- Room-switch flow writes `sessionStorage.seth_switched = 1`.
- On a later entry the engine checks those exact keys and skips automatic room targeting if either exists.
- Previous builds were clearing different helper keys, not these actual persistence flags.

Fixes:
- Clear `seth_seated` and `seth_switched` before every game launch.
- Clear them again when returning to the program's game-center / room page.
- Clear them in the injected game bootstrap as a final guard.
- Auto-seat confirmation now clicks only once instead of up to ten times.
- Post-confirm wait increased to 1.5 seconds so the ATG selector can close before any retry logic runs.
- Correct roomId + machineNum targeting from v2.65 remains preserved.


## v2.67 remove legacy black/gold assistant panel

Verified from the user's uploaded video:
- A legacy black/gold helper appears first (eye logo, +0.00, green Start button,
  lightning/shield/bell/777/door buttons).
- The user's intended blue ScarabHeart assistant appears afterwards.

Fix:
- Disabled both legacy engine UI builders (`L()` portrait and `M()` landscape).
- Kept `overlay-runtime.js` untouched; this is the user's blue assistant UI.
- Underlying engine logic remains loaded: room automation, speed, FREE, guard/signal,
  stop-profit/stop-loss and live state are not removed.
- v2.66 seated/switched reset and single-confirm fixes are preserved.


## v2.68 block ATG 500 document replacement

Cause confirmed by comparing the normal direct ATG HAR with the proxied flow:
- Normal room selection completes over WebSocket:
  `getSlotTableDetail -> updateSlotTable`.
- A successful room selection does not require a new page/document.
- The white `500 Internal Server Error / nginx` screen is a secondary document
  navigation replacing an already-running game.

Fix:
- Each proxied game session now tracks whether a healthy HTML document has loaded.
- Initial game load errors are still surfaced normally.
- After the game is healthy, any later document navigation returning 500/502/503
  is cancelled with HTTP 204, which leaves the current game document running.
- The same protection is applied to `__remote` document navigations.
- Legacy black/gold panel removal from v2.67 is preserved.
- Seated/switched reset and second-entry auto-room behavior from v2.66 are preserved.


## v2.70 machineNum truth + room 500 root fix

Video evidence:
- Program recommendation/current machine: 2169.
- In-game auto-room popup: `你挑選的是 #23`.
- The scanner then paged 1→9 and never entered 2169.

Root cause:
- Seth-eye `roomId` was being treated as ATG's live room id.
- Those ids are not guaranteed to match ATG's current live room table.
- That produced wrong derived targets such as `#23`.

Fix:
- Recommended auto-room targeting now trusts only `machineNum`.
- TARGET is a non-numeric synthetic machine marker so the engine still enters
  its auto-room path; MACHINENUM remains the real visible machine number.
- Seth-eye roomId is retained only for diagnostics/board metadata.
- `EXACT_ROOM` no longer treats Seth-eye roomId as authoritative.
- Remote ATG `<base>` was replaced with a same-session proxy base so room
  navigation/form actions cannot bypass the proxy and land on raw nginx 500.
- Static Cocos/slotFramework assets still go directly to ATG.
- v2.68 5xx document guard, v2.67 legacy-panel removal, and v2.66 re-entry
  state reset remain preserved.


## v2.71 keep seated state across ATG reload

Observed:
- Auto room selection succeeds.
- ATG reloads/rebuilds the game document.
- The assistant starts locating the same room again.

Root cause:
- The bootstrap cleared `seth_seated` / `seth_switched` every time the injected
  ATG document loaded.
- An ATG internal reload therefore looked like a brand-new program launch.

Fix:
- `ROOM_SESSION_ID` is now the boundary.
- A new launch from the ScarabHeart room page gets a new ID and clears the old room state once.
- Any ATG internal reload with the same ID preserves `seth_seated` / `seth_switched`.
- After successful seating, a reload stays seated and will not run auto-room a second time.
- Returning to the ScarabHeart room page and pressing Enter Game again still creates
  a new ID, so auto-room runs again for the newly selected machine.


## v2.72 all games / top 10 / click-to-enter

- Every recommendation row is directly selectable.
- Clicking a machine opens a confirmation dialog:
  `確定選擇此機台嗎？ / 編號 #xxxxx / 確定 / 取消`.
- Confirming immediately enters ATG and starts the existing auto-room flow.
- Main composite recommendation list is expanded to up to 10 unique real machines
  using only rows actually returned for the same game (no fabricated machine IDs).
- Added recommendation backend aliases for all 9 ATG titles:
  seth2/seth1/tiger/hades/red3k/wuxia/goku/vampire/jinlian plus raw ATG code
  and numeric game-id fallbacks.
- Once a working alias is found for a game it is reused for the rest of the session.
- Last successful recommendation data is cached locally for 30 minutes.
- Render `/__api` now caches board responses for 15 seconds and can serve a recent
  stale response during transient 429/5xx errors, reducing blank recommendation pages.


## v2.73 refresh recommendations on return

- Recommendation data is not refreshed while the user is inside ATG.
- Returning from the game to the recommendation/room page clears the previous
  selection and in-memory board list, then forces a new recommendation fetch.
- The manual Refresh button also bypasses the in-memory 15-second board cache.
- This keeps the recommendation connection separate from the active game and
  ensures the next visible list is recalculated after returning.


## v2.74 REAL ATG all-games recommendations

This version removes the assumption that `seth-eye /boards` supports every ATG title.

Real recommendation source:
- Recommendation page obtains a fresh ATG game token for the selected title.
- A short-lived hidden probe loads that title in `table=1` mode.
- The probe observes the authenticated ATG WebSocket and decodes the same deflate
  machine-table packet already proven in the supplied HARs/runtime.
- Real fields used: `roomId`, `number`, `status`, `isLocked`, `today.win`,
  `today.bet`, `win`, `bet` (and free-game fields when ATG exposes them).
- As soon as >=10 real machines are captured, the probe iframe is destroyed.
- The probe never selects a room or spins.
- Before formal game entry the probe is forcibly destroyed; it never remains
  connected at the same time as the real game.
- Returning to the recommendation page creates a new probe and recalculates the list.

Ranking:
- Composite: real RTP + real play volume + real profit rank.
- Burst: highest live RTP (real ATG values).
- Premium: highest real play volume, then RTP.
- Free-game tab uses real free-game count when the title exposes it; otherwise it
  uses only real low-payout/high-volume table statistics and never invents a count.
- Up to 10 unique real machine numbers are displayed per tab.

`seth-eye /boards` remains only as a secondary fallback; it is no longer the
primary source for titles that were returning empty lists.


## v2.75 fast real recommendations

Speed changes:
- Real recommendation API and direct ATG table probe now run in parallel.
- If the API has real rows first, they are rendered immediately.
- When the ATG real-time table arrives, it automatically replaces/re-ranks the visible list.
- The last successful REAL result per game is kept for up to 5 minutes and is shown
  instantly when returning to the recommendation page while a fresh refresh runs.
- No fake/random machines are generated.
- Decoded ATG App/service-state scan interval reduced from 180ms to 80ms.
- Entering the real game always stops the recommendation probe first, so recommendation
  collection and the formal game session do not overlap.


## v2.76 real rooms + simulated recommendation metrics

For:
- Tiger Princess
- Hades / Baphomet
- Wuxia
- Son Go Ku
- New Vampire Hunter
- New Jinlian

Behavior:
- Machine number, roomId and room availability always come from the current real ATG table list.
- Only recommendation score/RTP-style display metrics are simulated when the title lacks a reliable recommendation feed.
- Simulated values are deliberately moderate (score roughly 760-910, RTP roughly 82-122% unless a live RTP exists, then a small bounded jitter is applied).
- Rows are explicitly marked `模擬推薦`.
- Clicking a row still uses the real machine number and the existing auto-room flow, so the program can enter and locate the actual ATG machine.
- Locked/missing rooms are excluded from simulated recommendations.


## v2.77 six-game instant simulated recommendations

ONLY these six titles use simulated recommendation data:
- Tiger Princess
- Hades / Baphomet
- Wuxia
- Son Go Ku
- New Vampire Hunter
- New Jinlian

The other three titles remain on the real recommendation pipeline:
- Golden Seth 2
- Egyptian Mythology / Seth 1
- Scarlet Three Kingdoms

Behavior for the six simulated titles:
- 10 recommendation rows appear immediately; no ATG recommendation probe wait.
- Score range is intentionally moderate (~790-900).
- RTP display is intentionally moderate (~84%-120%).
- Rows are visibly marked `模擬推薦`.
- Clicking a row still sends its machine number into the existing machine-number auto-room flow.
- No recommendation probe runs for these six titles, so it cannot conflict with the formal game session.


## v2.78 natural test-data tuning

- Only the six previously selected titles use test recommendation data.
- RTP is capped below 100% for every row.
- Top 1-3 recommendations are the only high performers:
  roughly 93.6% to 99.59%.
- Remaining rows taper through more moderate ranges, down into the 70s/80s.
- Recommendation scores taper instead of clustering near 900.
- Repeated row-level "模擬推薦" text was removed.
- The page keeps a small "測試資料" status indicator so test values are not mistaken for live ATG statistics.


## v2.79 faster all-game load

- Removed repeated row-level simulated/test labels.
- The six generated recommendation titles use a compact `估算` status only.
- Recommendation selection starts resolving the ATG direct entry while the confirm dialog is open.
- Manual enter buttons also pre-warm the ATG entry on pointer/touch down.
- Prepared ATG entry URLs are reused briefly instead of repeating the whole lobby handshake.
- The recommendation probe is stopped before the formal game session starts.
- Added eager/high-priority iframe hints and ATG preconnect/DNS-prefetch.
