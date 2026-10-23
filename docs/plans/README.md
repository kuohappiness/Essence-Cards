# Essence Cards｜細項規畫的存放方式

工作只分「v1 需要做的任務」與「第二階段想做的事」，統一入口在 [backlog](../backlog.md)；進行中的下一步仍只看[路線圖](../roadmap.md#現在在哪裡)。依據：[D-130](../decisions.md#d-130-任務分成-v1-與第二階段)。

| 內容 | 放在哪裡 | 如何使用 |
|---|---|---|
| 任務與點子的入口 | `docs/backlog.md` | 先判斷屬於 v1 或第二階段，列簡短項目、狀態及細項連結 |
| 尚在規畫的功能細節 | `docs/plans/<主題>.md` | 一個主題一份、不按日期重開；記原意、來源、目前狀態與待決問題。很短的新點子先留 backlog，展開後再搬來並改成引用 |
| 已確認的決定與理由 | `docs/decisions.md` | 沿用 D-ID；計畫文件引用決定，不另抄完整規格。實作前仍需使用者確認待決部分 |
| 已可交付實作的任務與驗收 | `tasks/<任務>.md` | 從 roadmap 或 backlog 引用；主題計畫轉成任務後保留指向任務與決定的連結 |
| 當前進度與最近完成 | `docs/roadmap.md` | 不在計畫檔重複寫進度；做完後更新這裡，最近只留 10 條 |
| Claude／Codex 討論與交接 | `Claude Codex Discussion/YYYY-MM-DD-主題.md` | 同一議題接續同一份；未決問題要回到 backlog／plans，不能只留在對話紀錄 |
| 重要討論摘要 | `docs/archive/discussions/YYYY-MM-DD-主題.md` | 保留歷史取捨並更新該目錄索引；不當作目前規格 |

「第二階段」是下一階段候選清單，不承諾單一版本全部完成。舊文件的「增強版」「v2」「v2 之後」「未來」都由這個入口追蹤；歷史原文可保留，不另設交付級別。已確認方向、使用者提議、助理提案與條件式候選仍要分清楚。

## 目前的主題文件

- [學習動機設計](motivation.md)
- [題庫、拼句與錯題回饋](practice.md)
- [知識庫、依能力複習與精熟循環](learning-growth.md)
- [複習體驗與卡片管理](experience.md)
- [AI、Capture 與外掛生態](ai-and-ecosystem.md)
- [獨立 App](standalone-app.md)
