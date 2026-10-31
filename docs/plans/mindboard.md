# Essence Mindboard｜待做與待決

狀態：未來的第三個外掛，還沒開工，也還沒建 repo；這裡收 Mindboard 的點子與待決問題（2026-10-31 從 backlog 與各份規畫整理過來）。舊文件裡的「Essence Mindmap」「心智圖外掛」都是它的暫定名

[backlog 入口](../backlog.md#essence-capture-與-essence-mindboard)｜[文件存放規則](README.md)

定位：把知識架構視覺化（[D-076](../decisions.md#d-076-capture-是知識入口教材轉錄成教材庫)、[架構 §3](../architecture.md#3-模組邊界-第-5-步)）；Cards 保留對接的彈性（[D-056](../decisions.md#d-056-保留和心智圖外掛對接的彈性)）。

## 已記錄的方向

| 點子 | 原意與目前資訊 | 狀態或來源 |
|---|---|---|
| 教材庫串起三個外掛（Essence Mindmap） | 轉錄出來的教材庫（每張圖、每個表都有錨點）也當作未來心智圖外掛（暫定名 Essence Mindmap）的資料來源，把 Capture、Cards、Mindmap 整合在一起；例如卡片背面可以連到某個重要錨點。2026-10-13 使用者提出，列為未來的進階發想（[API 挑選討論](../archive/discussions/2026-10-11-api-selection.md)）。另見上方下方的「心智圖外掛的對接細節」、[架構 §3](../architecture.md#3-模組邊界-第-5-步) 的對接做法、[D-056](../decisions.md#d-056-保留和心智圖外掛對接的彈性)、[D-060](../decisions.md#d-060-記憶狀態的配色一致) | 未來 |
| 心智圖外掛的對接細節 | 使用者 2026-10-11 決定列入未來的專門討論。已確定：保留對接彈性（D-056）、配色和自評按鈕一致（D-060）、用區塊 ID 連結學習目標並寫進說明書（D-048 補充）。待討論：Cards 開放給其他外掛的介面、心智圖上的提取練習怎麼寫入複習紀錄（助理提案見[架構 §3](../architecture.md#3-模組邊界-第-5-步)） | 💬 未來專門討論 |

💬 開工時一併處理：查詢記憶狀態與範圍複習的外掛介面、心智圖提取練習如何交由 Cards 寫入紀錄、學習目標搬移後是否提供修復連結。既有邊界及助理提案見[架構 §3](../architecture.md#3-模組邊界-第-5-步)；不得將提案視為已確認 API。

## 和 Cards 有關、留在 Cards 的項目

這些是 Cards 自己的功能，只是可能交給 Mindboard 呈現，主文留在原處：

- 心智圖當考題（挖掉節點再回想，[D-056](../decisions.md#d-056-保留和心智圖外掛對接的彈性) 補充）：見[複習體驗的多種呈現方式](experience.md#其他待評估的操作與呈現)。
- 說明書用心智圖展開：見[複習體驗](experience.md#其他待評估的操作與呈現)（D-048 補充）。
- 學習地圖的視覺化與誰存資料：見[學習動機設計](motivation.md#使用者提議把學習地圖做成有質感的視覺化)。
- 三個外掛共用設定：見 [AI 與外掛生態](ai-and-ecosystem.md#三個外掛共用設定)。
- 教材庫由 Capture 寫入、Mindboard 讀：見 [Essence Capture](capture.md)。
