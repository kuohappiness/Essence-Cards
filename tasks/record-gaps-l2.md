# 補上錯過就補不回來的紀錄（Codex L2 審查請求）

狀態：待審（第一輪，待審的是下面寫的 commit）。

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 Codex 對話**；只審查、不改產品程式，可以在隔離環境重現。

[任務說明](record-gaps.md)追加複習紀錄、新增外掛會寫的檔案（考試切面）、改 `state` 的讀取層，屬於[高風險範圍](../docs/agents/quality.md#高風險範圍要做-l2)，合併前做 L2。

## 審查對象

- 分支 `claude/record-gaps-l2-fbaa8d`（worktree 在 `.claude/worktrees/musing-kowalevski-696591`），工作區乾淨。
- **待審 commit**：`8c72d3cf2a3d7b282509d531c65afa3db5121e12`（程式）；之後只多文件的 commit。
- **共同祖先**：`origin/main` 的 `047a99e2aa43ff329d61890086c57f49649e5ade`（設定頁已併進來）。看差異用 `git diff 047a99e...8c72d3c`。
- 這次的 commit：`da4f7dd`（§4）、`480f0ad`（§3）、`9edf24d`（`parseDeck` 分辨沒寫與讀壞）、`72637d2`（§1 與按鈕走同一個出口）、`3c8a7d5`、`866cc83`、`3fb6349`（§2）、`7f960bf`（文件）、`8c72d3c`（併入設定頁並接上偵測出口）。

## 規格與優先順序

- 規格：[`tasks/record-gaps.md`](record-gaps.md) §1～§7，驗收是 §6 的 37 條。
- 依據：[D-105](../docs/decisions.md#d-105-回測要用的紀錄先收好)、[D-115](../docs/decisions.md#d-115-回頭查要用的證據先收好) 第 3、4 組、[D-154](../docs/decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測) 第 4 點、[D-176](../docs/decisions.md#d-176-考試範圍第二批的選擇手改的範圍檔不默默失效提前結束立刻失效)。
- 格式查核的[回報](<../Claude Codex Discussion/2026-11-09-record-gaps-format-review.md>)已核對，§1、§2、§4、§6 已照改。
- 設定頁的交接：[`tasks/settings-page.md`](settings-page.md) §3〈給補紀錄缺口的介面〉，這個分支是後合併的一方，由這裡接。
- 文件的新規則：[`docs/syntax.md`](../docs/syntax.md) §5、§5-1、§5-4。規格衝突時列成問題，不挑容易通過的那份。

## 行為與風險

**入口**：`createState`（`src/state/index.ts`）的 `observe`（`src/state/observe.ts`）、`createSnapshots`（`src/state/snapshots.ts`）、`refuseIncomplete`／`completeText`（`src/state/reads.ts`）、`createLogWriter` 的 `taken`（`src/core/study/log.ts`）；`parseDeck` 的 `statusRead`、`statusInvalid`；`deckInScope` 與切面格式（`src/core/catalog/snapshot.ts`）。

**不可破壞的性質**：

- 變更行不影響排程：有沒有這些行，`today()`、到期、`undo`、`held`、`incomplete`、`problems` 都相同，增量與重讀一致。
- 一次變更一行；不因別台的紀錄、時鐘回撥、讀不到而重複寫或寫錯值；讀不懂的值不寫，上次的值不動。
- `undo` 只取消指定的那一筆；新的時間不被舊紀錄推到未來。
- 含 NUL 的文字不採用、不寫回。
- 切面不算紀錄也不算卡組；寫入不蓋掉、不改舊檔、失敗不影響作答；內容逐字。
- 學生和家長的畫面不變。

**已知邊界**：§6 列的都有測試（`tests/status-log.test.ts`、`tests/exam-snapshot.test.ts`、`tests/record-times.test.ts`、`tests/nul-reads.test.ts`、`tests/deck-status-read.test.ts`）。例子只是起點，請找新的組合，特別是：

- `observe` 與讀取批次、寫回採用、`applySettings`、換日交錯：有沒有會把還沒採用的值、預設值或別人的值寫成觀察。
- 切面的等待與核對：`settle`、`drain` 與最後一次 `plan()` 之間，有沒有交錯能寫出和「這一刻」不符的內容，或永遠等不到下一次查核。
- `taken` 只看已讀進來的紀錄，正在排隊的行由 writer 自己的 `last` 擋。

**明確延後**：iPhone 實機寫出基準與切面、同步、兩台各一份（第 2 類，[技術債表](../docs/backlog.md#技術債)「補測：」）；目錄的批次暫停（還沒有這個功能）。

## 驗證方式

- `npm run check` 要在沙箱外跑（[quality.md](../docs/agents/quality.md)）；`8c72d3c` 的 pre-commit 跑過完整的 `npm run check`，通過。
- 單檔：`node --test --test-timeout=60000 tests/status-log.test.ts`。
- Windows 實機（§7）在 `8c72d3c` 的建置跑過，結果在[任務說明〈結果〉](record-gaps.md#結果)。用獨立的 Obsidian 與暫存 vault，沒有經過 iCloud。提醒區「讀不到」的畫面沒有截圖看。
- 沒跑：iPhone、雙機同步。

## 實作者自己選的做法（請先看）

1. **§1 和 `changeStatus` 併成一個 commit**（`72637d2`）：§8 列成兩個，但只做偵測時同一次按鈕會記兩行。
2. **切面在範圍檔變動時也查**（`examChanged` 尾端）：規格寫「排今天的份之後、補齊之後」，但內容相同的兩份範圍換了選定不會重排，驗收第 23 條會寫不出第二份。
3. **換日時比一次放在 `fresh()`**：只在真的要重排今天的份時比，符合設定頁「換日後第一次排今天的份」。`value` 是比之前取的，排程不讀變更行，所以沒有重取。
4. **切面的判定結果記在記憶體**：已有效或已寫成的 `開始日 + 鍵` 這次執行不再查；失敗的記到當天，換日再試。`modify` 時 `exists` 為真（列檔之後才出現的）也當作這次結束，下次打開再判斷它有不有效。
5. **這台的切面含 NUL 算讀不到**（用 `completeText`），不算無效：不另寫 ` 2`。
6. **`close()` 不等切面**：寫到一半的 `modify` 讓它自己完成，關閉不被它卡住；關閉之後不報錯。
7. **切面裡的卡組照路徑排序**；規格沒寫順序。
8. **`tools/compare/adapter.ts` 把載入時的基準與切面列為預期的寫入**：比較時 `Files` 拒絕它們不算這個版本想寫入。
9. **`tests/helpers/observed.ts` 的 `withBaseline`**：測試裡先以上個月的時鐘載入一次，基準行留在上個月的檔，這個月的字面 `t` 不動。只看作答的既有測試因此少改預期。

## 回報與權限

只審查，不改產品程式；可以在隔離環境重現。每項發現寫觸發條件、預期／實際、影響、位置與證據，並區分「已重現」「靜態推斷」「待驗證」；另標**真實路徑會不會發生**。報告寫在 `Claude Codex Discussion/2026-11-09-record-gaps-l2.md`，標題下第一行寫狀態。發現鏈照 [D-197](../docs/decisions.md#d-197-同一條發現鏈到第-3-代先重整換模型時重驗依舊行為寫的規則) 標代數。
