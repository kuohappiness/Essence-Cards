---
name: codex-brief
description: 把規格清楚的程式或機械式工作寫成給 Codex 的任務說明（TASK.md），並在 Codex 完成後檢查。Use when work should be handed to Codex, the user says 交給 Codex, or a prototype, test script, scaffold or batch edit is fully specified.
---

# 交給 Codex

依 `AGENTS.md`「AI 協作分工」：架構判斷、介面設計與文件維護留給 Claude；規格清楚、照做就好的工作才交給 Codex。還有沒決定的設計問題時，先談定（`/essence-discuss`），不要寫進任務說明讓 Codex 猜。

範本是 `experiments/t4/TASK.md`。

## 寫任務說明

存在工作所在的資料夾，例如 `experiments/t2/TASK.md`。依序寫：

1. **標題與一句話**：要回答哪個待決問題或完成哪件事，連到試作場說明或 D-ID。開頭寫「先讀 repo 根目錄的 `AGENTS.md`」。
2. **限制**：
   - 只能新增或修改哪些檔案；哪些檔案只讀不改（例如 Claude 維護的提示詞、規則）。
   - 執行環境與相依套件（例如 Node 24、ES modules、不用建置、Windows 上要能直接 `npm install`）。
   - 金鑰、課本、學生資料不能進 repo、畫面輸出或紀錄檔。
   - 分支名稱；在本機工作時用 `git worktree add ../Essence-Cards-<任務> <分支>` 開在旁邊，**不要在原資料夾切換分支**，因為其他 AI 可能正在 main 上改文件。
3. **要做什麼**：指令或畫面的規格、每一步的輸入與輸出、錯誤怎麼處理。不寫實作細節，除非它是規格的一部分。
4. **自我測試**：Codex 能自己跑的檢查（selftest、解析測試、截圖尺寸 375×812 等），先通過再做完整執行。
5. **完成後回報**：分支、最後一個 commit、測試輸出，以及逐條對照「限制」的自我檢查（符合／不符合與原因）。

個人路徑（PDF 位置、輸出資料夾）不寫進 TASK.md，放在交給 Codex 的訊息裡。

## 交給使用者

回覆裡附：

- **建議推理等級**：照規格寫程式通常用中等；有演算法或除錯成分的用高。說明理由一句。
- **一段可以直接貼給 Codex 的訊息**：指向 TASK.md 的路徑，加上個人路徑等不進 repo 的資訊。

然後照 `AGENTS.md` 的 Git 規則 commit TASK.md（只 stage 自己的檔案）。

## Codex 完成後檢查

1. 讀 Codex 的回報與分支的 diff。
2. 如果有 `code-review` skill，用 Skill tool 載入 "code-review"，以 TASK.md 當規格審查；沒有的話，逐條對照 TASK.md 的「限制」與「要做什麼」。
3. 自己跑一次自我測試，不只看 Codex 貼的輸出。
4. 結果記在試作場說明的測試清單（一行）；能定案的，用 Skill tool 載入 "essence-decision" 寫成 D-ID。
5. 要修的地方：小問題自己修；需要重做的，寫成一段可以貼回給 Codex 的訊息。
