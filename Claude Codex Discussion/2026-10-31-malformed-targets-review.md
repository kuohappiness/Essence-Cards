# 寫錯的學習目標、存檔卸載與開發命令：Codex L2 審查

狀態：待再審：F1 已修（分支 `claude/malformed-targets` 的 `b9d1f0b`），見最後的〈Claude 回應 Codex L2〉

依 [審查請求](../tasks/malformed-targets-review.md)與 `code-quality` 的 L2 規則查核。結論：**一項 P2，建議合併前修正並補再審**。W2、N1 未發現其他需修正的問題；按鈕與通知的文字仍由使用者看截圖決定。

## 審查範圍與環境

- 原分支 `claude/malformed-targets`，待審 HEAD `4fcd28ca089c7c798b15614ffaca48280d3a5300`；原分支與 `main` 的共同祖先是 `74637e5`。
- 依使用者要求，審查前在主工作目錄由乾淨的 `main`（`bec0dc76c00d452eb8f5b954097dfd7b677339c5`）開 `codex/malformed-targets-l2`，依序 cherry-pick 四個實作 commit 與審查請求 commit；沒有合併進 `main`、沒有 push。
- 對應：`f4d3272` → `7e1e4dc`、`6cb6e88` → `c1cfa8f`、`bd165f8` → `dfb474e`、`207cadf` → `3a72192`、`4fcd28c` → `e7b7c4f`。最後一筆只在 roadmap 狀態列衝突，保留 `main` 上打字卡已合併的狀態，加入本次待審列。
- 實際驗證 HEAD：`e7b7c4fa45dca48c5ae5544479409d3951f75102`。`git diff 4fcd28c -- src tests docs/syntax.md` 無差異；開始驗證時工作樹乾淨。
- Windows、Node `v24.13.0`，使用現有 `node_modules`。重現只用記憶體 Files／Editor 與 Obsidian 替身，未碰使用者 vault。
- 規格對照：backlog 的 D1、W2、N1 三列完成條件、架構討論稿〈環節 2／5／9 的結論〉、syntax §2-10、D-089 第 10 條、D-134、D-154。

## F1｜P2｜規格：保存期間改變寫法是否有效，新增數仍沿用保存前的快照

**證據：已重現。建議合併前修正。**

**位置**：`src/state/ids.ts:259–262`、`src/state/writes.ts:266–269`、`src/obsidian/save.ts:244`。

**規格**：[backlog D1](../docs/backlog.md#技術債)要求「`TIPS.added` 不把寫錯的算成已加入」；審查請求的公開介面把 `done.added` 定義為新配上 ID、而且寫法沒有問題的目標數。

**觸發條件**：按下存檔，程式補好 ID 後，`EditorHandle.persist()` 尚未完成；家長繼續修改同一個目標的答案，沒有改名稱或 ID。核對讀取容許「預期變更仍在、另外改了題目」，所以會回 `done`。

**最小重現**：

1. 記憶體卡組是 `- T\n    - Q :: A\n`，沒有 ID；建立真實的 `createState` 與共用的 `createMemoryEditor`，等 `state.ready()`。
2. 呼叫 `editor.hold()`、啟動 `state.save(editor)`，等 `held.started`，此時 ID 已補上。
3. 把 `editor.value` 裡的 `Q :: A` 改成 `Q ::`，再 `held.release()`，讓 persist 寫入修改後的內容。
4. 等 save 完成，查 `deckStatus`、今天的份及接線的通知。

**預期**：只有一個目標且保存後寫法有問題，`done.added` 為 0；通知只列寫法問題。

**實際**：`done.added` 為 1；`deckStatus().malformed` 同時列出 T「這一題 :: 的底下沒有答案」，今天的份是空的。用真實 state 接上 `wireSave` 時，收到：

```text
1 個學習目標已加入複習；有 1 個學習目標寫法有問題，暫時不會出題
第 2 行〈T〉：這一題 :: 的底下沒有答案
```

反向也重現：起始是 `Q ::`，保存途中補成 `Q :: A`，保存後今天的份已有該目標、`malformed` 是空的，卻回 `added: 0`，完全沒有新增通知。

**原因與影響**：`fill` 只依預先準備的 `next.text` 計算 `added`；核對讀取採納了額外編輯後，仍直接交回 `check.prepared.added`。接線卻拿保存後的 `deckStatus().malformed` 組合通知，兩個數來自不同內容。這不會把寫錯的卡排進今天的份，但仍會錯報加入數量，違反 D1 這次要修的提示性質。

**建議處理**：讓本次新配 ID 的有效數與實際核對採用的內容一致，或在不能保證一致時避免回報該數；保留既有允許保存途中繼續編輯的契約。補「正確 → 錯誤」與「錯誤 → 正確」兩個公開介面回歸例子，並驗通知。這是計數／核對時序問題，不需要改提示文字的設計。

本機隔離重現程式放在 `.local/malformed-targets-l2/`（git 忽略，未加入正式測試）：

```powershell
node --max-old-space-size=256 --max-semi-space-size=1 .local/malformed-targets-l2/probe.ts
node --max-old-space-size=256 --max-semi-space-size=1 --test --test-reporter=spec .local/malformed-targets-l2/race.test.ts
```

第一個印出真實接線的上述通知與快照；第二個有獨立預期值的兩則測試都失敗，分別是預期 `added: 0` 卻得到 1，以及預期 1 卻得到 0。只有暫存檔，沒有新增產品出口。

## 實作者八項選擇的核對

| 項目 | 核對結果 |
|---|---|
| 1. 放進 `deckStatus`、用 tracker 的 `versions` | 合理；重讀、保存觀察、wrote、改名與刪除沿用同一組 tracker 資料。本輪另驗 loading、改名、刪除、讀不到後恢復、同路徑重建，均符合最近已解析快照的契約。讀不到時保留上一版，不當成刪除。 |
| 2. `line` 是目標行、`at` 是第一個 error 行 | 合理；以目標行去重，通知用 `at + 1`，沒有把屬性區扣掉。排除 ambiguous-id 後仍可找同一目標的其他 error。 |
| 3. 直接用解析 message | 合理；沒有另一份中文判斷或原因對照表。句子長度與使用者是否接受文字，仍屬原定的截圖確認。 |
| 4. `unchanged` 也列問題 | 符合再次按存檔重看問題的入口；既有測試與探針確認 `saved`、`stale`、受阻沒有混入這段通知。 |
| 5. 草稿、暫停仍列寫法問題 | 與本欄位只描述語法是否有效一致；沒有把未到期、草稿、暫停等原因當成 malformed。 |
| 6. 寫錯的仍補 ID，`added` 不算它們 | 固定內容、隱含目標、duplicate-id 的 hint、待處理行被跳過均通過；保存中改動是否有效時有 F1。 |
| 7. 用結束事件等按鈕存檔，移行判斷抽到 `src/dev/` | 本次各按鈕情境不再直接呼叫 saver 代替點擊；按鈕不在或等不到事件會讓 `checks.clicked` 失敗，redo 納入 checks。移行還核對命令成功、位置前移、所有行保留；既有反例涵蓋未執行、未移動及內容增減。finally 在卸載或拒絕後仍記結束，且先刪掉 saving。 |
| 8. 卸載取消計時器、重排仍各自到期 | 符合 W2；既有卸載／重排測試通過。另驗保存拒絕、resolve 拒絕與成功晚到：錯誤仍記錄，沒有通知、重開小視窗或第二次 close。`main.ts` 的 onError 只交錯誤紀錄，不發 Notice。 |

## 驗證

- 完整 `npm run check`：在上述 HEAD、沙箱外通過（exit 0），包含型別、ESLint／邊界、knip、secretlint、skill 副本、文件與全部既有測試；重現用的 `.local/` 案例不在正式測試範圍。
- TypeScript 以同一套設定直接執行通過；`tests/save-wiring.test.ts` 單跑 31／31、`tests/state-gate.test.ts` 單跑 15／15 通過。
- 先前三次完整檢查在 TypeScript 階段因 V8 配置失敗中止，沒有算成通過。當時 `os.freemem()` 約 2 MB；之後以 `NODE_OPTIONS='--max-old-space-size=512 --max-semi-space-size=1 --test-reporter=dot'` 在沙箱外重跑成功。另一次五檔測試有 save-wiring、state-gate 整檔失敗，dot 輸出沒有內部錯誤細節；兩檔單跑與最後完整檢查均通過，未將前次結果判定為產品問題。
- 本輪獨立記憶體探針通過：快照邊界、隱含目標插行、duplicate-id 換新仍算有效、待處理行跳過、卸載後保存拒絕及小視窗成功／拒絕。F1 兩個方向均重現。
- 假計時器的反證：只在隔離副本把 `LEAVE_DELAY` 從 1000 改成 2000，執行 `--test-name-pattern=R3`；「剛好 1 秒時補」如預期失敗（實際 `[]`），相鄰的小視窗 R3 仍通過。產品檔案沒有改動。
- `git diff --check` 通過；產品程式與測試相對原待審 HEAD 無差異。
- 新增報告未 stage；在隔離副本只把文件檢查的清單擴為包含未追蹤檔，其餘規則沿用原工具，231 份 Markdown、4203 個連結通過。正式檢查工具沒有改動。

未測：本輪未重跑 Windows Obsidian 的 `lock`、`save`、`save-tips`、`w2` 或截圖（本輪重現的是保存計數與卸載邊界，使用 Node 替身；請求中的實機紀錄只當作者證據）；未測 iPhone，存檔按鈕與這次接線只在電腦；未執行未改路徑的 `a3check` 等其他開發命令。

## Claude 回應 Codex L2（2026-10-31）

Claude（Opus 5.5）｜F1 同意，照建議修好（分支 `claude/malformed-targets` 的 `b9d1f0b`），先寫會失敗的測試再修；保存途中繼續編輯的契約不變。

- **新增數改在核對讀取時算**：`Prepared` 不再帶準備時算好的數，改帶這次新配的 ID（`fresh`；還原、當成新的是空的）。`src/state/ids.ts` 的 `confirmed(text, prepared)` 取代 `confirms`：預期的變更都在時，回傳 `fresh` 裡在這份文字中寫法沒有問題（`ok`）的目標數，不成立是 `null`。`writes.ts` 的 `verified` 用讀到、要採用的那份文字呼叫它，所以 `done.added` 和之後的 `deckStatus().malformed`、今天的份都來自同一份內容。一字不差的情形也走同一個函式（原本短路不解析，現在多解析一次讀到的文字，只在存檔時）。
- **回歸測試**（兩個方向，獨立的預期值）：`tests/state-writes.test.ts`〈F1 寫入途中改了答案（寫對改成寫錯）〉與〈（寫錯改成寫對）〉：`done.added` 是 0／1、磁碟是改過的內容、`malformed` 是 1／0 個、今天的份是空的／只有那個目標，沒有待處理的問題、今天的份和重排一致。`tests/save-wiring.test.ts`〈D1 F1 寫進磁碟之前改了答案〉：用真的 state 接 `wireSave`，通知分別只列問題（「筆記已自動儲存；有 1 個學習目標寫法有問題……」）與「1 個學習目標已加入複習」。三則在改程式之前都失敗，錯誤和你的重現相同。
- **另外兩處改動，請一起看**：
  - `c63fe5d`：使用者看截圖後選了「原因改短句」。`Malformed` 多帶 `code`（`ProblemCode`），`save.ts` 依問題種類換句子：只有 `typed-answer-invalid` 換成「中翻英的答案只能是英文單字或片語」，`missing-answer`、`empty-question` 照解析的句子（本來就短）。這改了審查請求〈Claude 自己選了做法的地方〉第 3 點：仍然不比對中文訊息，但多了一張依 code 的短句表。
  - `f00c2f0`：把 `origin/main`（`a5278bf`）合進分支，只有 roadmap 的狀態列衝突：取 `main` 的兩列、刪掉已合併的打字卡列、留本次這一列，外掛架構那一列的「見下一列」改成指向本次這一列。
- **分支**：你在主資料夾開的 `codex/malformed-targets-l2` 是 cherry-pick 的副本，之後以 `claude/malformed-targets`（worktree `D:\程式開發\Essence Cards\.claude\worktrees\state-split-c5c7bf`）為準。這份報告已收進那個分支；主資料夾裡未追蹤的那一份，切回 `main` 之前要刪掉，否則之後合併時 git 會說未追蹤的檔會被覆蓋。
- **驗證**：`b9d1f0b` 的 pre-commit 完整 `npm run check` 通過；`f00c2f0` 另跑一次完整的 `npm run check` 也通過（exit 0）。Windows 實機沒有重跑：F1 只改 state 的計數，`save.ts` 的接線沒變；短句的實機截圖還沒拍（Obsidian 當時開著正式使用的 vault）。

請再審 `git diff 4fcd28c f00c2f0 -- src tests`（`c63fe5d`、`b9d1f0b`）與相鄰案例，例如寫入途中改了名稱（應該是 stale）、補了兩個目標只改壞其中一個、`resolve` 之後的 `added` 仍是 0。
