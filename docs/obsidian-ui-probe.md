# 自訂 UI 與跨裝置最小驗證

日期：2026-10-07（Asia/Taipei）｜原型 0.0.1｜最小實機驗證通過

## 技術判斷

可以把 Obsidian Vault 視為檔案資料層，外掛視為自訂前端。`ItemView.contentEl` 可以承載 HTML／CSS／JavaScript、SVG 或 UI 框架，學習內容不必受 Markdown 筆記版型限制。心智圖、閃卡與多媒體在介面層可行，但個別功能與手機格式仍需實測。

「不被綁住」必須分開看：畫面內的版型與互動可自訂；Obsidian 的工作區、手機導航、生命週期、iOS WebView、裝置效能與媒體解碼仍是限制。不能把外掛當成可完全取代 Obsidian 外殼或獨立背景常駐的 App。手機不提供 Node.js／Electron API。

Vault 並非 SQL、資料庫伺服器或跨裝置交易引擎；它保存 Markdown 與附件。跨裝置是本機副本加同步服務，不能從讀寫 API 推導出雲端併發安全。

未來若要移到獨立 App，可在正式設計時分開教材資料、學習邏輯、UI 與 Vault 存取介面；本原型不建立那些層，不綁定正式架構。

## 本次實作

使用者已要求先做極簡測試，並明確允許推翻架構。原型只保留兩個安裝檔，不引入框架、建置鏈、AI 或後端服務。

- 自訂頁面與 Shadow DOM 樣式隔離。
- 一張翻面閃卡與固定兩分支心智圖，共用同一筆記。
- 一張自動建立的本機 SVG 圖片；可選 Vault 既有音訊／影片，用原生控制播放。
- 固定測試筆記的建立、讀取、儲存、讀回與本機過期版本檢查。
- Windows／iPhone 使用同一份外掛；沿用既有 iCloud。

程式與安裝／五分鐘驗收見 [experiments/obsidian-ui-probe](../experiments/obsidian-ui-probe/README.md)。這是 P0 前段的 UI 與基本讀寫檢查；通過後仍保留離線事件、併發、附件完整性與 Git 回復等原 P0 門檻。

## 驗證紀錄

| 層級 | 結果 | 證據邊界 |
|---|---|---|
| 官方 API／平台限制查核 | 已完成 | 確認自訂 View 與跨平台可用 API；不代表此原型已在實機執行 |
| JavaScript 語法與安裝包 | 已通過 | node --check；ZIP 兩個必要安裝檔與說明 |
| Node VM 模擬 DOM／Vault | 已通過 | 桌面與 iOS 平台旗標，各 11 組檢查：入口、缺檔錯誤、建立／重複建立、同筆記翻卡與心智圖、附件 URI、儲存讀回、拒絕過期覆寫、安全文字、播放控制、關閉重開及卸載 |
| Chromium／WebKit 畫面 | 未執行 | 環境缺少瀏覽器可執行檔；不聲稱版面或引擎相容性已通過 |
| Windows Obsidian | 通過（使用者回報） | 2026-10-07 09:10 使用者回報兩端測試全部正常 |
| iPhone Obsidian | 通過（使用者回報） | 同一外掛的最小 UI 與讀寫驗收整體通過 |
| iCloud 往返、離線重開 | 通過（使用者整體回報） | 依已提供的五分鐘驗收範圍記錄；並非完整同步壓力測試 |

### 實機回報

2026-10-07 09:10（Asia/Taipei），使用者回報：「手機 電腦端的測試全部正常」。依本原型的五分鐘驗收範圍，T-011 結案；不要求重複執行相同測試。

這次確認相同外掛能在使用者的 Windows／iPhone 執行，自訂 UI、共用測試筆記及基本本機／跨裝置流程可落實。未另提供兩端 Obsidian 版本、手機型號或音訊／影片格式，因此不推廣為所有裝置、媒體編碼或教材規模的相容性承諾。大量資料、併發事件與 Git 回復仍由 T-008／T-009 另行驗證。

## 官方來源

- [Use React in your plugin](https://docs.obsidian.md/Plugins/Getting%20started/Use%20React%20in%20your%20plugin)：將 UI 掛載至 `ItemView.contentEl`；框架並非必要。
- [Mobile development](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development)：桌面模擬與實際手機不同；手機缺少 Node.js／Electron API。
- [Vault](https://docs.obsidian.md/Plugins/Vault)：讀寫、`process()` 及本機檔案資料層。
- [Obsidian API](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)：`ItemView`、`Vault.getResourcePath()`、`Workspace.getLeaf()` 介面。
