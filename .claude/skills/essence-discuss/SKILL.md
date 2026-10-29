---
name: essence-discuss
description: 和使用者一次討論一個 Essence 專案的設計問題，直到談定或明確擱置。Use when the user wants to discuss, decide or rethink a design question, product scope or workflow, or when a thread is about a 💬 open question.
---

# Essence 討論

1. **一輪只問一題**：先把要決定的事列成決策樹，挑不依賴其他未決題目的最上游那一題問，等使用者回答再問下一題。不要一輪列出多題。
2. **先查再問**：提問前讀 `docs/decisions.md` 索引裡相關的主題，只讀相關的幾條；新提案和舊決定衝突時，明講是哪一條、為什麼值得重談。repo 裡查得到的事實自己查，不問使用者。
3. **提案不是決定**：每題附上你的建議答案，標 💡。
4. **先比不做**（D-153）：每個提案寫出 ① 不做會怎樣：具體壞在哪、多常發生、影響誰（學生、家長或開發）；② 做的代價：新增的程式、文件、測試，以後要維護的，使用者要多學的；③ 更小的做法：只改現有的、延到第二階段，或先在試作場試一次。不做或更小的做法夠好，就建議不做。
5. **優先刪減**：每題談完，檢查有沒有東西可以移出 v1。
6. **用真實教材例子**驗證抽象設計；試一次就知道的問題，建議改到試作場（`experiments/`）做，不在對話裡猜。

## 結束

- 談定的題目：用 Skill tool 載入 "essence-decision" 寫成 D-ID。
- 沒談完：還沒解的問題與目前傾向寫在主文，同一個問題只有一份主文，依序選：已交付實作且沒另開討論的 → `tasks/`；Claude 與 Codex 正在往返的 → 該討論稿；其他已展開的規畫 → `docs/plans/`；短點子 → `docs/backlog.md`（D-141）。roadmap 的狀態板只更新那一列的狀態與下一步。
- 沒有討論稿的重要討論：結束時在 `docs/archive/discussions/` 新增 `YYYY-MM-DD-主題.md`（摘要，不冒充逐字紀錄），更新該目錄 README 的索引；有討論稿的不另寫（D-106、D-143）。
