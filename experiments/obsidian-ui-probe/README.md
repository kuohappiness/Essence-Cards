# Essence UI Probe 0.0.1

可丟棄的技術可行性原型。只確認 Windows／iPhone 能否執行相同外掛、自由呈現 UI、讀寫 Markdown 與載入本機附件。不是正式產品的 MVP、資料 schema 或 UI 設計承諾；整個 `experiments/obsidian-ui-probe/` 可以刪掉重做。

## 安裝（沿用目前 iCloud vault）

1. 解壓縮測試包，將 `essence-ui-probe` 資料夾放入 Windows 上該 vault 的 `.obsidian/plugins/`。結果必須是 `.obsidian/plugins/essence-ui-probe/main.js` 與 `manifest.json`，不能多包一層。若使用自訂設定資料夾，將 `.obsidian` 換成實際名稱。
2. 重新啟動 Obsidian。到「設定 → 社群外掛」允許社群外掛，啟用 **Essence UI Probe**。無須 npm、編譯或 API 金鑰。
3. 執行命令 **Essence UI Probe: 開啟相容性測試**；也可按左側試管圖示。
4. 按「建立測試資料」，只在 `Essence-UI-Probe/` 建立 `test.md` 與 `sample.svg`，已存在者不覆寫。既有筆記不在寫入範圍。
5. 等待 iCloud 檔案下載完成，在 iPhone 的同一 vault 重新啟動 Obsidian，於社群外掛設定確認啟用相同外掛，再從命令面板開啟測試。手機不需要安裝 Node.js。

若 iPhone 找不到外掛，先確認兩端使用相同設定資料夾，且 `main.js`／`manifest.json` 已同步；不要據此直接判定手機不能執行。這次不新增同步服務。

## 五分鐘驗收

| 測試 | 操作 | 通過標準 |
|---|---|---|
| 桌面 UI | 建立資料，翻卡、看心智圖與葉片圖片 | 無空白／錯誤，答案翻面可操作 |
| iPhone UI | 手機開啟、按重新讀取、翻卡並捲到最下面 | 文字／心智圖／本機圖片可見，按鈕可點，無被裁掉的操作 |
| 桌面 → 手機 | 電腦將答案改為「葉綠體【電腦】」，儲存並讀回；等同步後手機重新讀取 | 手機閃卡、心智圖與編輯欄呈現同一新版 |
| 手機 → 桌面 | 手機改為「葉綠體【手機】」並儲存；等同步後電腦重新讀取 | 電腦讀到手機版，沒有遺失修改 |
| 離線與重開 | 手機飛航模式下改成「葉綠體【離線】」，儲存；完整關閉後重開並重新讀取，再恢復連線 | 離線內容仍在，恢復同步後電腦讀到相同內容 |

按鈕會回報本機儲存及讀回核對結果。先一次只在一端修改，另一端只讀；此測試不宣稱併發寫入安全。

音訊／影片：下拉選單可選 Vault 內的附件，使用原生播放控制與 `Vault.getResourcePath()`。本包自帶圖片；若音訊／影片是近期必要能力，另用你已下載至兩端的 MP3 與 MP4 附件測播放、暫停及拖曳。檔名相同不代表 iCloud 已下載檔案，副檔名也不保證編碼相容。

## 架構與限制

- 兩個安裝檔，無第三方依賴、無遠端載入；只有 `require('obsidian')`，不使用 Node.js／Electron／`fs`。
- `ItemView` 開啟自訂 DOM；Shadow DOM 隔離大部分宿主主題樣式，HTML／CSS／SVG／互動由原型控制。Obsidian 的分頁、導航與行動 WebView 仍是宿主邊界。
- Vault 是本機檔案資料層，並非 SQL 或共享雲端伺服器。兩端各讀本機副本，由既有 iCloud 傳遞變更。
- `Vault.process()` 核對儲存前的本機內容，過期版本會拒絕儲存；這不涵蓋之後到達的雲端衝突。
- 閃卡與固定兩分支心智圖讀同一測試筆記。這不是完整心智圖編輯器，也不驗證大量教材效能、複習排程、AI、Git 或完整 P0。
- 若已輸入但尚未儲存，不要按重新讀取；它會載入檔案內容取代編輯欄。

## 驗證狀態

可執行 `node check.cjs` 重跑無依賴的模擬 DOM／Vault 邏輯檢查；它不測真實版面、解碼或同步。自動檢查結果見 [驗證紀錄](../../docs/obsidian-ui-probe.md)。一般瀏覽器和模擬 Vault 測試不是 Obsidian 實機驗證；**Windows Obsidian、iPhone Obsidian 與 iCloud 真實往返仍待使用者操作**。

回報只需：`Windows：通過／失敗；iPhone：通過／失敗；雙向：通過／失敗；離線重開：通過／失敗`。若失敗，附畫面狀態文字與兩端 Obsidian 版本即可。

停用外掛後可刪除 `.obsidian/plugins/essence-ui-probe/` 與 `Essence-UI-Probe/` 測試資料夾。刪除前確認沒有放入要保留的內容。
