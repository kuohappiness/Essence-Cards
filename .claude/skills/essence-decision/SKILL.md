---
name: essence-decision
description: 把使用者明確同意的事寫成 Essence Cards 的 D-ID 決定，並同步索引與受影響的文件。Use when a discussion has been settled, the user says 確定/同意/就這樣, or an existing D-ID needs to be superseded or amended.
---

# 寫入決定

只寫使用者**明確同意**的內容；沒有反對不等於同意。不確定時先問一句。

## 步驟

1. **查重**：讀 `docs/decisions.md` 索引裡相關的主題，找相關的舊決定。D-ID 不重用：新編號是目前最大號加一。
2. **寫條目**：在正文最後加：

   ```markdown
   ## D-xxx 名稱

   ✅ YYYY-MM-DD｜來源（討論紀錄的連結或「使用者提出」）｜補充或取代哪幾條

   **決定**：

   - ……

   **理由**：

   - ……
   ```

   有「曾考慮的做法」或「代價」時一併寫。
3. **處理舊決定**：被取代的，狀態行改成「已取代 → D-xxx」，不刪除；被修改的，在標題下第一行加「……見 D-xxx」。
4. **更新索引**：新決定先在 `decisions-index.mjs` 的主題對照表加上 D-ID，再執行 `node experiments/tools/decisions-index.mjs`，再在索引補上新決定的一句話（程式會列出空著的）。舊決定被修改時，也更新它那一行的一句話。
5. **同步其他文件**：依 `AGENTS.md` 的文件分工，更新受影響的 `product.md`、`architecture.md`、`syntax.md`、`roadmap.md`。一件事只寫在一個地方，其他地方用連結。`backlog.md` 裡對應的待決題目移除；定案但還沒做的任務留一行並連 D-ID；repo 裡連到被移除項目的連結改連 D-ID（D-143）。
6. **路線圖**：在 `roadmap.md`「已完成」最上面加一列（一句、約 80 字，加連結）；超過 10 列把最舊的搬到 `docs/archive/roadmap-completed.md` 最上面，相對路徑改成以 `docs/archive/` 為基準。狀態板有變就更新那一列。
7. **Commit**：先看 `git status`，只 stage 自己改過的檔案（不用 `git add -A`），commit 訊息照 repo 慣例，例如 `docs: <做了什麼> (D-xxx)`。
