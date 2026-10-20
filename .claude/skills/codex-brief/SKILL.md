---
name: codex-brief
description: 把規格清楚的程式或機械式工作寫成給 Codex 的任務說明（TASK.md），並在 Codex 完成後檢查。Use when work should be handed to Codex, the user says 交給 Codex, or a prototype, test script, scaffold or batch edit is fully specified.
---

# 交給 Codex

依 `AGENTS.md`「AI 協作分工」：架構判斷、介面設計與文件維護留給 Claude；規格清楚、照做就好的工作才交給 Codex。還有沒決定的設計問題時，先談定（`/essence-discuss`），不要寫進任務說明讓 Codex 猜。

範本：v1 程式是 `tasks/w3.md`，試作場是 `experiments/t4/TASK.md`。

## 寫任務說明

先用 Skill tool 載入 "code-quality"，照它的「寫規格」寫驗收條件與邊界例子，並看技術債清單裡觸發點是這個任務的項目（專案設定見 `docs/agents/quality.md`）。

v1 程式的任務放在 `tasks/`（例如 `tasks/w3.md`），試作場的放在該資料夾的 `TASK.md`。依序寫：

1. **標題與一句話**：要回答哪個待決問題或完成哪件事，連到試作場說明或 D-ID。開頭寫「遵守 repo 根目錄的 `AGENTS.md`」（Codex 會自動載入，不用再讀一次）。
2. **必讀範圍與基準**：Codex 要讀的檔案、章節與 D-ID，讓它不用自己探索整個專案；寫程式的任務一定列 `.agents/skills/code-quality/SKILL.md` 的「測試」一節。寫這份說明時的基準 commit，相關規範之後有改時，Codex 先比對差異。
3. **限制**：
   - 只能新增或修改哪些檔案；哪些檔案只讀不改（例如 Claude 維護的提示詞、規則）。
   - 執行環境與相依套件（例如 Node 24、ES modules、不用建置、Windows 上要能直接 `npm install`）。
   - 金鑰、課本、學生資料不能進 repo、畫面輸出或紀錄檔。
   - 分支名稱；在本機工作時用 `git worktree add ../Essence-Cards-<任務> <分支>` 開在旁邊，**不要在原資料夾切換分支**，因為其他 AI 可能正在 main 上改文件。
4. **要做什麼**：指令或畫面的規格、每一步的輸入與輸出、錯誤怎麼處理。不寫實作細節，除非它是規格的一部分。
5. **自我測試**：Codex 能自己跑的檢查（`npm run check`、解析測試、截圖尺寸 375×812 等），先通過再做完整執行。
6. **完成後回報**：分支、最後一個 commit、測試輸出，以及逐條對照「限制」的自我檢查（符合／不符合與原因）；哪些沒跑與原因。不貼整份執行紀錄。

個人路徑（PDF 位置、輸出資料夾）不寫進 TASK.md，放在交給 Codex 的訊息裡。

## 交給使用者

回覆裡附：

- **建議推理等級**：照規格寫程式通常用中等；有演算法或除錯成分的用高。說明理由一句。
- **一段可以直接貼給 Codex 的訊息**：指向 TASK.md 的路徑，加上個人路徑等不進 repo 的資訊。

然後照 `AGENTS.md` 的 Git 規則 commit TASK.md（只 stage 自己的檔案）。

## Codex 完成後檢查

1. 用 Skill tool 載入 "code-quality"，照它的「實作交回」做：每次都做 L1；`docs/agents/quality.md` 列為高風險的改動，合併前加做 L2。L2 用 review.md 的範本寫審查請求，回覆裡附一段可以直接貼給新 Codex session 的訊息與建議推理等級。
2. 結果記一行（試作場說明的測試清單，或 roadmap 的已完成）；能定案的，用 Skill tool 載入 "essence-decision" 寫成 D-ID。
3. 要修的地方：小問題自己修；需要重做的，寫成一段可以貼回給 Codex 的訊息。
