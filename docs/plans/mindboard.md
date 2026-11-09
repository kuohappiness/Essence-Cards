# Essence Mindboard｜待做與待決

狀態：未來的第三個外掛，還沒開工；開始寫程式時才建獨立的 repo，規劃與決定留在 Essence Cards（[D-196](../decisions.md#d-196-mindboard-開新-repo開始寫程式時才建)）；這裡收 Mindboard 的點子與待決問題（2026-10-31 從 backlog 與各份規畫整理過來）。正式名稱是 Essence Mindboard（2026-10-31 起現行文件都改用這個名稱；舊的討論紀錄仍寫暫定名「Essence Mindmap」，文件裡的「心智圖外掛」也是指它）

[backlog 入口](../backlog.md#essence-capture-與-essence-mindboard)｜[文件存放規則](README.md)

定位：把知識架構視覺化（[D-076](../decisions.md#d-076-capture-是知識入口教材轉錄成教材庫)、[架構 §3](../architecture.md#3-模組邊界-第-5-步)）；Cards 保留對接的彈性（[D-056](../decisions.md#d-056-保留和心智圖外掛對接的彈性)）。

## 已記錄的方向

💬 2026-10-31 使用者提出：這個看板不只服務 Essence Cards，甚至可以當成入口頁面，包含近期的工作計畫、待辦清單、重要記事等（細節之後再想）。


| 點子 | 原意與目前資訊 | 狀態或來源 |
|---|---|---|
| 教材庫串起三個外掛 | 轉錄出來的教材庫（每張圖、每個表都有錨點）也當作Essence Mindboard 的資料來源，把 Capture、Cards、Mindboard 整合在一起；例如卡片背面可以連到某個重要錨點。2026-10-13 使用者提出，列為未來的進階發想（[API 挑選討論](../archive/discussions/2026-10-11-api-selection.md)）。另見下方的「心智圖外掛的對接細節」、[架構 §3](../architecture.md#3-模組邊界-第-5-步) 的對接做法、[D-056](../decisions.md#d-056-保留和心智圖外掛對接的彈性)、[D-060](../decisions.md#d-060-記憶狀態的配色一致) | 未來 |
| 心智圖外掛的對接細節 | 使用者 2026-10-11 決定列入未來的專門討論。已確定：保留對接彈性（D-056）、配色和自評按鈕一致（D-060）、用區塊 ID 連結學習目標並寫進說明書（D-048 補充）。待討論：Cards 開放給其他外掛的介面、心智圖上的提取練習怎麼寫入複習紀錄（助理提案見[架構 §3](../architecture.md#3-模組邊界-第-5-步)） | 💬 未來專門討論 |
| 分享網頁 | 使用者 2026-11-06 提出：開發 Mindboard 時要討論怎麼做才能分享成網頁，別人點連結就能看。起因是開發進度畫板：Obsidian 的 `.canvas` 只是 JSON 檔，GitHub 只顯示原始文字，`obsidian://` 連結也只能開裝置 vault 裡已有的檔，所以進度畫板改成從 md 自動產生網頁、發布到 GitHub Pages（[開發進度地圖](../progress-map.md)）。可參考這個做法 | 💬 開工時討論 |
| AI 友善的白板 | 使用者 2026-11-08 提出：HTML 這類格式 AI 讀起來效率不好，希望這個白板是 AI 友善的，AI 能高效率讀取。（開發進度地圖也是同一個考量：AI 只讀 md，網頁給人看，見上一列） | 💬 開工時討論 |

💬 開工時一併處理：查詢記憶狀態與範圍複習的外掛介面、心智圖提取練習如何交由 Cards 寫入紀錄、學習目標搬移後是否提供修復連結。既有邊界及助理提案見[架構 §3](../architecture.md#3-模組邊界-第-5-步)；不得將提案視為已確認 API。

開工時：Mindboard 是第二個開工的外掛時，第一個交付要驗證要不要和 Cards 合併開發，照 [backlog](../backlog.md#第二個外掛開工時的合併驗證)（使用者 2026-11-09）。

## 參考軟體的待評估清單

使用者 2026-11-08 要求：討論階段一定要評估、分析這些參考資料（照 AGENTS.md「參考既有實作時先想最佳解」）。評估結果寫進 [docs/research/](../research/)，這裡只留清單與連結。

| 參考對象 | 為什麼看（摘自介紹文章，未核對原始專案） | 連結 | 狀態 |
|---|---|---|---|
| Pele（Obsidian 團隊開源的 Mermaid 繪圖器，MIT；使用者原文寫「pele mermaid」） | 把純文字的 Mermaid 畫成 SVG，AI 讀寫都容易；Obsidian 1.15 早期版已改用它；顏色跟著深淺色模式、窄螢幕會自動改排版 | [介紹文章](https://xlrocket.blog/2026/10/25/obsidian-%e5%bc%80%e6%ba%90-pele-mermaid-%e6%b8%b2%e6%9f%93%e5%99%a8%ef%bc%9a%e6%96%b0%e4%b8%80%e4%bb%a3%e6%96%87%e5%ad%97%e7%94%bb%e5%9b%be%e7%bb%84%e4%bb%b6%ef%bc%8c%e5%a6%82%e4%bd%95%e7%94%a8/)、[GitHub](https://github.com/obsidianmd/pele)、[Playground](https://pele.run/playground) | 待評估 |
| tldraw Offline（tldraw 官方的免費桌面白板） | 無限畫布，離線、存成本機檔（`.tldraw`）；AI 走「自備 AI」，Claude Code、Codex 這類 agent 可以看畫布、改圖形、寫腳本。要查：檔案格式 AI 讀起來省不省、授權（SDK 要商業授權）、能不能放進 Obsidian、iPhone 能不能用 | [介紹文章](https://xlrocket.blog/2026/11/08/tldraw-offline%ef%bc%9a%e5%85%8d%e8%b4%b9%e7%a6%bb%e7%ba%bf%e6%97%a0%e9%99%90%e7%94%bb%e5%b8%83%ef%bc%8c%e8%ae%a9-ai-%e7%9b%b4%e6%8e%a5%e5%9c%a8%e4%bd%a0%e7%9a%84%e6%9c%ac%e5%9c%b0%e7%99%bd%e6%9d%bf/)、[官網](https://offline.tldraw.com) | 待評估 |
| Scapple（Literature & Latte，Scrivener 的同一家公司；使用者 2026-11-08 加入） | 自由擺放的發想白板：在任何地方點一下就寫一則筆記，再拉線連起來，不強迫成樹狀的心智圖。以上是 Claude 的已知資訊，還沒核對；付費、授權、檔案格式與 AI 能不能讀，評估時再查 | [官網](https://www.literatureandlatte.com/scapple) | 待評估 |

## 和 Cards 有關、留在 Cards 的項目

這些是 Cards 自己的功能，只是可能交給 Mindboard 呈現，主文留在原處：

- 心智圖當考題（挖掉節點再回想，[D-056](../decisions.md#d-056-保留和心智圖外掛對接的彈性) 補充）：見[複習體驗的多種呈現方式](experience.md#其他待評估的操作與呈現)。
- 說明書用心智圖展開：見[複習體驗](experience.md#其他待評估的操作與呈現)（D-048 補充）。
- 學習地圖的視覺化與誰存資料：見[學習動機設計](motivation.md#使用者提議把學習地圖做成有質感的視覺化)。
- 三個外掛共用設定：見 [AI 與外掛生態](ai-and-ecosystem.md#三個外掛共用設定)。
- 教材庫由 Capture 寫入、Mindboard 讀：見 [Essence Capture](capture.md)。
