# Essence Capture｜待做與待決

狀態：Capture 還沒開工，照 [D-111](../decisions.md#d-111-v1-的開發順序capture-延後) 在 Cards 的複習閉環完成後才開始；這裡收 Capture 的 v1 工作、第二階段候選與待決問題（2026-10-31 從 backlog 與各份規畫整理過來）

[backlog 入口](../backlog.md#essence-capture-與-essence-mindboard)｜[文件存放規則](README.md)

Capture 的定位與 repo 為什麼獨立見 [D-076](../decisions.md#d-076-capture-是知識入口教材轉錄成教材庫)、[D-031](../decisions.md#d-031-capture-定位與交接約定修訂)；轉錄稿的格式是和 Cards 唯一的接點，只寫在 [syntax.md §1](../syntax.md#1-轉錄稿)。

## v1 要做的

| 任務 | 目前安排與細項 |
|---|---|
| PDF 與圖片忠實轉錄成教材庫 | v1 範圍（[D-076](../decisions.md#d-076-capture-是知識入口教材轉錄成教材庫)）；雛形是試作場的 `experiments/t4/`（D-076 補充 2026-10-13） |
| Capture 開工前先找現成專案（使用者 2026-10-14 提出；2026-10-28 決定放 v1，[D-130](../decisions.md#d-130-任務分成-v1-與第二階段) 補充） | Capture 照 D-111 開工時先做：到 GitHub 搜尋現成、可以參考的專案（例如 PDF、影片、網頁轉 Markdown 的工具或 Obsidian 外掛），評估它們的做法與缺點，再優化成最好的版本；不從零開始，也不直接照搬 |

## 待決問題

- 💬 轉錄稿的圖號會重複（國小社會試用，Claude 2026-10-26）：康軒國小社會的圖號每兩頁重新編（p.42 有圖 2，p.44 也有圖 2），[syntax.md §1](../syntax.md#1-轉錄稿) 的 `^fig2` 在同一篇轉錄稿會重複，出處的「圖 2」也指不到一張。可能的做法：這類課本的圖 ID 加頁碼（`^p44-fig2`），出處寫 `p.44 圖 2`。轉錄稿格式是兩個外掛的接點，要改時兩個 repo 一起改；寫 Capture 的轉錄或 AI 製卡模組時定。
- Capture 的協作規則要獨立（使用者 2026-10-20 提出）：Capture 完成、準備發布前，把只指向本 repo 的 AGENTS.md（D-076 補充）改成一份完整、獨立的 AGENTS.md 與說明，因為它是可以獨立使用的外掛。

## 第二階段想做的事

### 影片、網頁來源與整理成好讀的筆記

影片、網頁等來源，以及整理成好讀的筆記，列第二階段（D-076：「影片、網頁、整理成好讀的筆記，之後再做」）；PDF 與圖片轉錄仍是 v1 範圍，依 [D-076](../decisions.md#d-076-capture-是知識入口教材轉錄成教材庫)、[D-111](../decisions.md#d-111-v1-的開發順序capture-延後) 在 Cards 複習閉環完成後開工。

「開始做 Essence Capture 前先找現成專案」2026-10-28 改列 v1（[D-130](../decisions.md#d-130-任務分成-v1-與第二階段) 補充），見上方〈v1 要做的〉。

### NotebookLM 當上游

| 點子 | 原意與目前資訊 | 狀態或來源 |
|---|---|---|
| NotebookLM 擔任 Capture 的位置 | YouTube 影片、沒有課本的領域（D-038 的攝影、醫學影片），可以先在 NotebookLM 整理成報告，存進 vault 當來源筆記，再由 Essence Cards 製卡。學業科目仍以課本為依據製卡（D-021），避免多一層 AI 摘要的錯誤。2026-10-13 更新：PDF 與圖片改由 v1 的 Capture 忠實轉錄（[D-076](../decisions.md#d-076-capture-是知識入口教材轉錄成教材庫)），原本「可能讓 Capture 延後或縮小」不再成立；NotebookLM 只剩 YouTube、沒有課本的領域這類來源可以當上游 | 💡 |

## 和 Cards 有關、留在 Cards 的項目

- 外掛內的備份還沒排除 Capture 的轉錄教材：Cards 的技術債，見 [backlog 技術債](../backlog.md#技術債)（[D-150](../decisions.md#d-150-備份與還原) 第 4 點）。
- 三個外掛共用設定（API 金鑰設一次）：見 [AI 與外掛生態](ai-and-ecosystem.md#三個外掛共用設定)。
- 和 Mindboard 共用教材庫：見 [Essence Mindboard](mindboard.md)。
