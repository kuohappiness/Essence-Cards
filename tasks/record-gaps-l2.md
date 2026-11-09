# 補上錯過就補不回來的紀錄（Codex L2 審查請求）

狀態：待審（第四輪，待審的是下面寫的 commit）。

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 Codex 對話**；只審查、不改產品程式，可以在隔離環境重現。

[任務說明](record-gaps.md)追加複習紀錄、新增外掛會寫的檔案（考試切面）、改 `state` 的讀取層，屬於[高風險範圍](../docs/agents/quality.md#高風險範圍要做-l2)，合併前做 L2。

## 審查對象

- 分支 `claude/record-gaps-l2-fbaa8d`（worktree 在 `.claude/worktrees/musing-kowalevski-696591`），工作區乾淨。
- **第四輪待審 commit**：`eefb098`（程式）；之後只多文件的 commit。第三輪審的是 `23b32f0`，第二輪審的是 `72d9136`，第一輪審的是 `8c72d3cf2a3d7b282509d531c65afa3db5121e12`。
- **第四輪只查第三輪修正的差異與受影響的路徑**（`git diff 23b32f0..eefb098`），不必整包重審：
  - `ecb8279`（R13）、`5c0e152`（R14）、`a87fd31`（R15）、`2928ea0`（R16）、`eefb098`（R17）。
  - 逐項的共同原因、修法與涵蓋的輸入，在[報告最後的〈Claude 回應（第三輪）〉](<../Claude Codex Discussion/2026-11-09-record-gaps-l2.md>)。
  - **這是第四輪**：這一輪之後還有擋合併的發現，就停下來交給使用者決定（[`docs/agents/quality.md`](../docs/agents/quality.md)）。所以請每項都標：不修的話真實路徑的機率與影響，以及是否值得擋合併。
  - 最該看的是 R15（`read` 放開卡住的月檔）：它改的是所有讀取共用的一段，影響比原發現的範圍大。其次是 R14（自己的月檔讀過與否改變監看）與 R13（`near` 與重算 history）。
  - 同一條鏈再有發現照 [D-197](../docs/decisions.md#d-197-同一條發現鏈到第-3-代先重整換模型時重驗依舊行為寫的規則) 標代數（R15 是 R2 → R9 → R15，R16 是 R6 → R10 → R16，R14 是 R1 → R12 → R14）。
- **共同祖先**：`origin/main` 的 `047a99e2aa43ff329d61890086c57f49649e5ade`（設定頁已併進來）。整包差異用 `git diff 047a99e...eefb098`。
- 第三輪審過的第二輪修正：`469cce8`（R9）、`f22ebae`（R10）、`c947e68`（R11）、`27eb257`（R12）、`23b32f0`（R4）。
- 第二輪審過的第一輪修正：`6661c6d`（R1）、`e9c30fa`（R2）、`36b3b05`（R3）、`4367c48`（R5）、`afdd8ba`（R6）、`3f5d6d3`（R7）、`bd00d81`（R8）、`f80bff7`（編輯器的 NUL）、`72d9136`（§6 第 32 條的測試）。
- 第一輪審過的 commit：`da4f7dd`（§4）、`480f0ad`（§3）、`9edf24d`（`parseDeck` 分辨沒寫與讀壞）、`72637d2`（§1 與按鈕走同一個出口）、`3c8a7d5`、`866cc83`、`3fb6349`（§2）、`7f960bf`（文件）、`8c72d3c`（併入設定頁並接上偵測出口）。

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

- `npm run check` 要在沙箱外跑（[quality.md](../docs/agents/quality.md)）；`eefb098` 的 pre-commit 跑過完整的 `npm run check`，通過。
- 單檔：`node --test --test-timeout=60000 tests/status-log.test.ts`。
- 第三輪的探針在這個 worktree 的 `.local/record-gaps-r3-23b32f0/review-probes.test.mjs`；Claude 對 `eefb098` 重跑過，結果在報告的〈Claude 回應（第三輪）〉。第二輪的探針在主資料夾的 `.local/record-gaps-r2-72d9136/`，v0.3.0 讀取器的副本在 `.local/record-gaps-l2-v030`。
- Windows 實機（§7）在 `8c72d3c` 的建置跑過，結果在[任務說明〈結果〉](record-gaps.md#結果)。用獨立的 Obsidian 與暫存 vault，沒有經過 iCloud。提醒區「讀不到」的畫面沒有截圖看。**第一輪修正之後還沒重跑**，L2 通過後、合併前在最後的 commit 跑一次。
- 沒跑：iPhone、雙機同步。

## 實作者自己選的做法（請先看）

1. **§1 和 `changeStatus` 併成一個 commit**（`72637d2`）：§8 列成兩個，但只做偵測時同一次按鈕會記兩行。
2. **切面在範圍檔變動時也查**（`examChanged` 尾端）：規格寫「排今天的份之後、補齊之後」，但內容相同的兩份範圍換了選定不會重排，驗收第 23 條會寫不出第二份。
3. **換日時比一次放在 `fresh()`**：只在真的要重排今天的份時比，符合設定頁「換日後第一次排今天的份」。`value` 是比之前取的，排程不讀變更行，所以沒有重取。
4. **切面的判定結果記在記憶體**：已有效或已寫成的 `開始日 + 鍵` 這次執行不再查；失敗的記到當天，換日再試。`modify` 時 `exists` 為真（列檔之後才出現的）不算完成，重新列檔判斷（第一輪 R6 改的）；一次觸發同一路徑只重查一次，列檔一直列不到它時等下一次觸發（第二輪 R10 改成每次外部觸發重新算）。
5. **這台的切面含 NUL 算讀不到**（用 `completeText`），不算無效：不另寫 ` 2`。
6. **`close()` 不等切面**：寫到一半的 `modify` 讓它自己完成，關閉不被它卡住；關閉之後不報錯。
7. **切面裡的卡組照路徑排序**；規格沒寫順序。
8. **`tools/compare/adapter.ts` 把載入時的基準與切面列為預期的寫入**：比較時 `Files` 拒絕它們不算這個版本想寫入。
9. **`tests/helpers/observed.ts` 的 `withBaseline`**：測試裡先以上個月的時鐘載入一次，基準行留在上個月的檔，這個月的字面 `t` 不動。只看作答的既有測試因此少改預期。

第一輪修正時選的（第二輪請先看）：

10. **R1 在「已知」檔尾沒有換行時補換行**：讀的是 `state` 的 `sources`。第二輪 R12 補上第一次就讀不到的月檔（沒有已知內容、在 `unread`，當成沒有換行）。
11. **R2 回呼不符時自己再查一次**（`again`），不等下一批：內容相同的讀取不會觸發查核。要等的都在 `settle` 與 `drain` 裡，不會空轉；回呼裡核對的待讀包含範圍檔（`exam.waiting`）。
12. **R5 的上限用 `stuckAfter`**（預設 30 秒）：列檔與讀檔逾時不報錯、下次再查；寫檔逾時報 `write`，當天不再試。`close` 清掉計時。
13. **編輯器的 NUL 回 `blocked`（`unread`）**：沿用「還有讀不到的」提示，不新增結果種類，也不 persist。

第二輪修正時選的（第三輪請先看）：

14. **R9 的 `readsDone` 每次範圍檔的讀取佇列空了就查**，內容相同也查；查核本身有 `done`、`failed`、`running` 擋，不會寫第二份。
15. **R9 的「只等卡組與範圍檔」只用在切面**（`drain` 多一個 `relevant` 參數）；別的寫入照舊等全部。`giveUp` 時仍看全部 `unread`，否則第二次 `readOrStuck` 會卡住寫入列。
16. **R10 用列檔分辨「既有檔讀不到」和「寫失敗」**：第三輪 R16 改成：回呼還沒走到要建檔的逾時不走這條，也不算失敗；列檔失敗是分不出來，下次再查。
17. **R11 底層永遠不回時，這個鍵這次執行不再寫**：重開才再試。第三輪 R17 改成底層結束時補查碰上的查核。
18. **R4 只補作答**，變更行沒有被 `undo` 指到的問題；補寫在檔裡的位置不保證，排程照 `t` 重播。畫面的撤銷若還指著舊的 `t` 不處理，寫在 §4。

第三輪修正時選的（第四輪請先看）：

19. **R13 的時間是原本之後第一個沒人用過的毫秒**，不寫回原本的 `t`（那個 `t` 被舊取消指著）。比較卡的第一行補寫時帶 `with` 指回原本的 `t`，只有 `secondsBySubject` 讀 `with`。
20. **R13 補寫之後重算整份 history**，只在有補寫時，增量併進去的順序才會和重讀不同。
21. **R14 只靠通知**：自己的月檔啟動時不在、之後才出現，Obsidian 認得這個檔時就會有通知（`append` 也要它認得），所以沒有另外讀檔尾。通知前後的 append 都涵蓋；認得之前的 `create` 走不到既有內容。
22. **R15 只放開月檔**：卡組卡住照舊等整批（D-134，不知道 ID 用過沒）；第一次載入不放開（`ready()` 的語意不變）。卡住的月檔不報錯，只留在 `unread()` 並照常重試；底層的舊讀取取消不了，晚回來的結果不用。
23. **R16 回呼還沒走到要建檔的逾時不報 `write`**：和列檔、讀檔逾時同一類，所以原本「當天不重試」的測試改了。`modify` 一直不回時，這個鍵這次執行不再試、也沒有錯誤紀錄，只少一份切面。

## 回報與權限

只審查，不改產品程式；可以在隔離環境重現。每項發現寫觸發條件、預期／實際、影響、位置與證據，並區分「已重現」「靜態推斷」「待驗證」；另標**真實路徑會不會發生**。報告寫在**這個 worktree** 的 `Claude Codex Discussion/2026-11-09-record-gaps-l2.md`，接在最後加一節〈第四輪〉，標題下第一行的狀態改成這一輪的結論。發現鏈照 [D-197](../docs/decisions.md#d-197-同一條發現鏈到第-3-代先重整換模型時重驗依舊行為寫的規則) 標代數。
