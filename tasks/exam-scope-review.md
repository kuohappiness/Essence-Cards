# 入口與目錄第二批（考試範圍）：L2 審查請求（給新開的 Codex session）

狀態：第三輪待審（[報告與回應](<../Claude Codex Discussion/2026-11-04-exam-scope-review.md>)）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。

## 再審（第三輪）：第二輪發現的修正

**這一輪只讀**：本節、〈審查對象〉、討論稿的〈[Claude 回應：第二輪](<../Claude Codex Discussion/2026-11-04-exam-scope-review.md#claude-回應第二輪2026-11-04>)〉與〈[Claude 回應：第一輪](<../Claude Codex Discussion/2026-11-04-exam-scope-review.md#claude-回應第一輪2026-11-04>)〉的〈實作者自己選的做法〉（第二輪跑的時候還沒有這份）。之前的內容需要時，照 R1～R16 的標題只查相關的。

**範圍**：基準 `424e9a9a8d2ec27fa846b8a724172573636fa3b2`（第二輪待審），待審 `0d8d4081b53a7b7d18e5900e8b17ac00e3c00edf`，`git diff 424e9a9..0d8d408 -- src tests tools`（5 個修正 commit，每項發現一個：`e35c310` R15、`b22dd2f` R13、`c74d26d` R14、`9420637` R12、`0d8d408` R16）。`8934893` 和本節的文件 commit 不用審。

**還沒結的發現**：R12～R16，看修正有沒有做到，以及同類的其他輸入。

**可能碰到的已結項目**：第二輪表格寫通過的 R6、R8、R9、R10、R11，以及第一輪的 R2、R3、R4、R5、R7。這次碰到 `headValues`、`looseId`（R7）、`editScope` 重組屬性區（R2、R8）、`reads.waiting`（R4）、`close()`（R5）；沒碰到的路徑不用再看。

**請特別找**：

- `drain`（R13）：計時、`quiet`、`stop()` 的先後，有沒有不收尾或叫醒落空的組合；等待期間排著的下一筆與 `close()` 疊起來最久等多久；自己剛寫完引起的通知會不會把下一筆擋住；`waiting` 加上 `flying` 有沒有影響卡組那條（`alone` 只用在範圍檔）。
- `close()` 等 `examWrites`（R14）：排著的第二筆有沒有被寫；停用外掛最久會被卡多久；和 `writes.idle()` 的先後。
- `headValues`（R15）：別名指到數字、`1.5`、`1e3`、`.inf`、帶正負號、空值、數字配上引號；`parseScope`、`set: exam` 紀錄行、`tools/exam-reminder.ts` 用的是不是同一個值；`looseId` 認得的和正常讀法有沒有不一致。
- `keepEols`（R16）：往後對回原行時，會不會讓沒改到的行換行跑掉；行內 YAML 與多行的值。
- `clearTrial`、`noteScope`（R12）：只掃一眼。開發命令只有測試 vault 用得到。

**使用者已決定、不用再提**：任務說明〈使用者決定的〉1～8、〈小選擇〉1～3、〈固定格式帶出來的小選擇〉4～9。兩份〈Claude 回應〉的〈實作者自己選的做法〉是實作者定的，不是使用者定的，有意見請照提。

**真實路徑與輪數**：照 [D-171](../docs/decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 3 點，每項發現標真實路徑會不會發生；沒有擋合併的發現就直接寫「通過」。這是第三輪，第四輪之後還有擋合併的發現就交給使用者。

**驗證方式**：`npm run check`，要在沙箱外跑（[quality.md](../docs/agents/quality.md#檢查指令)）。實作者跑過的與沒跑的見〈Claude 回應：第二輪〉的〈驗證〉。報告接在討論稿最後；所有檔案都在這個 worktree，不要寫到主資料夾。

## 審查對象

- worktree：`.claude/worktrees/busy-meitner-e52ff7`，分支 `claude/exam-scope-c0f437`；沒有 push。
- 基準（開分支時和 `main` 的共同祖先）：`86c69c5dc5bd8f959a2fb07a5aa76d7b55988046`。
- 待審：`0ffb07896ef148694f1cb337eb20659cadb4db59`，範圍 `git diff 86c69c5..0ffb078 -- src tests tools`（42 個檔）。其中的 `0761844` 是合併 `main` 的純文件 commit，`src`、`tests`、`tools` 都來自這個分支。本請求和狀態文件的 commit 在它之後，不用審。
- 建議的讀法（照依賴順序）：

| commit | 內容 | 任務說明 |
|---|---|---|
| `ef0bf70` | 出處結果多記單元怎麼寫、可能漏什麼 | §1 |
| `1ce9387`、`5b580c0`、`2988d9e` | 讀範圍檔、選一份、寫回 | §2-1～§2-4 |
| `b92f5d0` | 目錄的歸屬：目標屬於哪些單元 | §3 |
| `b4a26b8` | state 讀範圍檔、重排、寫入、紀錄行 | §2-5、§3、§4 |
| `e7ea33b` | 全部卡與顏色用同一個提高後的保持率 | §5 |
| `812cd02` | 範圍的字、倒數、不確定的出處、設定畫面的列 | §6、§7、§8 |
| `718ca35` | Files 契約 C18：edit 丟錯時不建檔 | §2-4 |
| `b60b82b`、`660cbc6`、`95a59f5` | 設定畫面、倒數、目錄標籤與補的缺口 | §6、§7 |
| `30db8aa` | 考前提醒工具改用外掛的讀法 | §2-3 |
| `4250572` | 資料夾在硬碟上、Obsidian 的清單還沒有時照常寫 | §10 實機找到 |
| `52db164`、`a934c51`、`0ffb078` | 開發命令 `exam`，只掃一眼 | §10 |

## 規格

- [任務說明](exam-scope.md) §1～§9，含文末〈使用者決定的〉與兩張小選擇的表。
- [D-176](../docs/decisions.md#d-176-考試範圍第二批的選擇手改的範圍檔不默默失效提前結束立刻失效)；格式見 [syntax.md §4](../docs/syntax.md#4-考試範圍)；開工前的格式查核見[報告與核對](<../Claude Codex Discussion/2026-11-04-exam-scope-format-review.md>)。
- 規格之間有衝突時列成問題，不挑一份。

## 行為與風險

**公開介面**：`src/core/catalog/index.ts`（`parseScope`、`chooseScope`、`editScope`、`scopePeriod`、`scopeLabels`、`scopeAfter`、`scopeCountdown`、`scopeCheck`、`scopeRows`、`lastEnded`）、`State` 的 `exam()`、`setExam`、`endExam`、`examCheck`、`examCatalog`、`unitList`、`src/review/exam-form.ts`、`src/review/entry.ts` 的 `examRow`、`examSubject`、`tools/exam-reminder.ts`。

**不可破壞的性質**：

1. 手改的範圍檔不默默失效：看不懂、對不到的行留著，算出行數顯示出來；存別的不動它們（D-176）。
2. 寫回只碰變動的那幾行：換行符、註解、其他屬性不變；同一個變動套兩次結果相同；屬性區寫壞的不寫（§2-4）。
3. 變動套在回呼裡讀到的最新內容上；畫面開著時別處的修改不會被蓋掉；被刪掉的檔不會變成新檔；開著時選定的換了不會寫到別份（§2-4、§6）。
4. 讀不到不當成沒有考試：之前讀到的繼續用，存不了、提醒一區列出來；範圍檔卡住不擋卡組、紀錄與它們的寫入，`ready()` 最多等 2 秒（§4）。
5. 只有選定的結果（身分、單元、期間、生效）變了才重排；行數或另一份的路徑變了只通知畫面（§4）。
6. 提前結束立刻失效，同一個識別碼的舊副本救不回來；結束日隔天清晨 4 點失效（§2-2、§2-3）。
7. 保持率的提高只套在範圍內的目標、照 §5 的期間；今天的份、全部卡、顏色都同一個答案。
8. `deck`、`study` 不 import `catalog`（`tests/boundaries.test.ts`）；舊的卡組、紀錄與沒有範圍檔的 vault 行為不變。

**請找新的組合**，已知的邊界例子在 `tests/exam-scope.test.ts`、`tests/exam-state.test.ts`、`tests/exam-catalog.test.ts`、`tests/exam-ui.test.ts`，也請試：

- 交錯：`setExam` 的回呼正在跑時範圍檔被 iCloud 換掉、兩份同時存在時結束其中一份、衝突副本（同識別碼不同內容）；存檔失敗後的紀錄行與畫面。
- 換日：畫面開著跨過清晨 4 點；結束日當天與隔天的倒數、保持率與表單的 `past` 字。
- 編號：`2-9,3` 這種寫法特殊的單元、`L1` 與 `L01`、編號後面有名稱、全形字與多餘空白（打字雜訊不該改變意思）；`2`、`2-1`、`2-1-3` 的連動與合併後的字。
- 紀錄：`set: exam` 這一行在舊版外掛、`compare-versions` 與回放裡讀不讀得過。

**明確延後**：任務說明 §11；課外排在後面（使用者決定 2）；考試開始那天的卡組切面（使用者決定 3，已記進 backlog）。

## 實作者自己選的做法（請先看）

1. **`src/state/exam.ts:99`**：`start()` 的 catch 不分來源，讀取的錯可能報兩次（「多報一次比漏掉好」）。
2. **`State.examCatalog()`**：入口每次刷新都要算範圍列，所以不重播紀錄；`catalog()` 才重播。範圍列與設定畫面只用單元、狀態與歸屬，沒有用到顏色。
3. **預先勾選**：只看單元自己的目標（`from === null`）的第一次作答，別的單元算進來的不算學過；沒有作答的單元也勾；寫法特殊的不勾。
4. **「上一份之後」**：`scopeDay(previousEnd) + 1` 當截止日；`lastEnded` 取今天之前結束的範圍裡最晚的結束日，提前結束的看 `提前結束` 那天；沒有單元的不算。
5. **表單動過就固定**：沒動過之前畫面跟著最新的內容；動過之後不跟，交出去的是變動；存的時候 `state.exam().path !== form.path` 就擋下來寫 `changed`。代價：畫面開著時那份被改名（識別碼相同）也存不了，要重新打開，已勾的留在畫面上。
6. **整章**：檔案寫 `2` 時，取消 `2-1` 再勾回，`2` 留著；把底下全部一個一個勾不會變成整章（`formChange` 的註解）。
7. **學期排序**：認得的照順序，其他文字排在認得的後面（`src/core/catalog/order.ts`），新學期的判斷跟著它。
8. **`tools/exam-reminder.ts`**：任務說明沒寫，改用外掛的讀法：日期認多種寫法；提前結束的不算；同一個識別碼的舊副本不算；沒結束又日期有問題的才算讀不懂。
9. **`src/obsidian/files.ts` 的 `createFolder`**：第二次也問硬碟（`adapter.stat`）；是檔案或查不了都交出原本的錯。之前 Windows 實機遇到「Folder already exists.」存不進去，那時硬碟上有資料夾、`getAbstractFileByPath` 回 null。
10. **`LIST_LIMIT = 20`**：§8 的兩個清單最多列 20 列，其他寫「另有 N 個」。
11. **選定的那份讀不到時**：`exam.missing > 0 && !file` 才算不知道；讀過的那一份之後讀不到，繼續用上一次的內容。

## 使用者已決定、不用再提

任務說明〈使用者決定的〉1～8、〈小選擇〉1～3、〈固定格式帶出來的小選擇〉4～9。

## 驗證方式

- `npm run check`，要在沙箱外跑（[quality.md](../docs/agents/quality.md#檢查指令)）。實作者每個 commit 都由 pre-commit 跑過。
- Windows 版 Obsidian：結果見[任務說明 §10](exam-scope.md#10-windows-實機claude-用開發版跑) 的〈結果〉。審查者不用重跑；要跑請先問使用者，測試 vault 各分支共用。
- **沒驗到**：§10 的 iPhone 項目，併入下一次實機測試（[backlog](../docs/backlog.md)）。`tests/exam-ui.test.ts` 用的是 happy-dom，版面只有 Windows 截圖看過。
- **沒重現**：Windows 跑完 7 次 `do=run`，有 1 次（`0.3.0+0761844`）「打 YYYYMMDD 離開欄位變標準格式」是 false，存進檔案的日期是對的。`DateField` 的 `onBlur` 讀的是上一次繪製的 `value`、`normal`；Chromium 不對沒有焦點的視窗發 focus 事件，所以推測是那次 Obsidian 沒有焦點，但 `AppActivate` 和 `BrowserWindow.blur` 都拿不走焦點，沒有驗證。開發命令之後會記 `視窗有焦點` 和 `blur 沒有發事件的次數`。如果你看出別的原因，請照一般發現回報。

## 回報與權限

只審查，不改產品程式；可以在隔離環境重現。報告寫在 `Claude Codex Discussion/2026-11-04-exam-scope-review.md`（新檔，標題下第一行寫狀態），所有檔案都在這個 worktree，不要寫到主資料夾。每項發現寫觸發條件、預期與實際、影響、位置、證據，區分「已重現」「靜態推斷」「待驗證」，並標**真實路徑會不會發生**（[D-171](../docs/decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 3 點）。沒有擋合併的發現就直接寫「通過」，並寫明看了什麼。可以回報「規格本身有漏洞」。
