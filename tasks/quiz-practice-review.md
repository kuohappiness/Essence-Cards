# 小考前的密集複習（練習任務）：L2 審查請求（給新開的 Codex session）

狀態：第二輪做完：R1～R4 的修正通過；R5 使用者選另開任務，不擋合併（見討論稿〈Claude 回應：第二輪〉）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。只審查，不改產品程式；可以在隔離環境重現。回報接在這個 worktree 的 `Claude Codex Discussion/2026-11-05-quiz-practice-review.md` 最後；所有檔案都在這個 worktree，不要寫到主資料夾。

## 再審（第二輪）：第一輪發現的修正

**這一輪只讀**：本節、討論稿的 R1～R4 與〈[Claude 回應：第一輪](<../Claude Codex Discussion/2026-11-05-quiz-practice-review.md#claude-回應第一輪2026-11-05>)〉。後面第一輪的內容需要時才查。

**範圍**：基準 `7bf6313caea3f45cd73d532e2417563d501ba889`（第一輪待審），待審 `78a84c4d0228c5b1af44f62a215637e92924d5c8`。

```bash
git diff 7bf6313caea3f45cd73d532e2417563d501ba889 78a84c4d0228c5b1af44f62a215637e92924d5c8 -- src tests tools
```

中間併過一次 `main`（`289d31f`）：只有文件（題型改名 D-192 與別的討論稿），`src`、`tests`、`tools` 沒有變。

| 發現 | commit | 修法 |
|---|---|---|
| R1 | `27900cd` | `firstTry` 的「第一筆」照 session 的作答順序（`done`），改評分換掉那個位置的 t |
| R3 | `8ffec7e`、`4388696` | 這一輪的作答要和 `done` 逐筆對上（t、lt），筆數也要相同；不是就不顯示 |
| R2 | `2e18cbc` | `Prepared.status`：`confirmed` 核對時讀回要的狀態，不符是 null，照原本的路回 `stale` |
| R4 | `67c85d1`、`78a84c4`（a）、`02f23be`（b） | `encodeNew` 在排進寫入前驗值與讀回；`write` 回傳 `{ t, line, path }`，`state.answerLine` 給開發命令用 |

**請特別找**：

- `firstTry` 誤判「這次寫的」：改評分、重答、同一個 `since` 重建 session、別台裝置的作答與取消交錯時，有沒有該顯示卻不顯示，或該隱藏卻顯示；第一輪的「時鐘往回」探針要重跑（第一筆早於 `since` 現在是不顯示）。
- `status` 的核對：有沒有把真的寫成了判成 `stale`（換行、BOM、註解、引號、`parseDeck` 和 `setDeckStatus` 的讀法差異）；`fill`、`resolve` 這些沒有 `status` 的寫入是否完全不變。
- `encodeNew`：有沒有正常路徑會被新的檢查丟錯，尤其在 `exam.ts` 的 `logged`（這時範圍檔已經寫了）、`checkApp`（載入途中）、`session.ts` 的作答；丟錯之後佇列、時間與 `history` 是否都沒動。
- `record` 拿掉重新編碼之後，`sources`、`history` 和檔案是否仍是同一行；跨月時路徑是否照 `t` 的當地月份。

**實作者這一輪自己選的做法（請先看）**：

1. **不比評分**：R1 的修法只比 t 與 lt。報告建議核對「完整作答身分／內容與數量」；這裡有筆數檢查，比評分不會改變結果（改壞檢查證實），所以拿掉。請找反例。
2. **`saved` 仍記一行**：寫進磁碟、核對讀不到或關閉時，照 §5「寫進去之後」記 `set: status`，和 `fillIds` 把 `saved` 當成改了字相同。要同時「讀不到」又「被同步蓋回」，紀錄才會多一行，目錄照讀到的內容，這一行現在只有回測會用。第一次核對之後才讀到內容時不重記（`tests/deck-status.test.ts`）。
3. **開著的筆記回 `stale` 之後**：編輯器裡還是新的狀態，Obsidian 自動存檔會把它寫回磁碟，這時筆記是新狀態、紀錄沒有這一行。和家長直接改筆記相同（backlog 技術債，觸發點是管理模式）；靜態推斷，沒有在 Obsidian 重現。
4. **R4 (a) 的契約範圍**：`exam` 的 `id` 可以是空的（`exam.ts` 的 `logOf` 用 `file.id ?? ''`）；`app`、`semester` 只看是字串；評分、指紋與狀態的對象靠 `parseLine` 的讀回檢查。
5. **`State.answerLine`**：state 多一個公開方法，只有開發命令用；`answer` 仍回傳 t，`session.ts` 與既有測試不動。
6. **沒帶進來的技術債**：「紀錄的完整最後一行只缺換行」的觸發寫「下一次改紀錄的讀取或寫入時（『紀錄的時間跨啟動會撞』那一列）」。這次動到寫入，但只做那一列指定的 (a)(b)；那一項的修法在讀的一邊、要改 syntax §5-2，所以沒帶進來。請判斷這個讀法對不對。

**驗證方式**：`npm run check`，要在沙箱外跑；測試加時間上限（見後面第一輪的〈驗證方式〉）。實作者跑過的見〈Claude 回應：第一輪〉的〈驗證〉。沒跑：Windows 實機（還停在 `7bf6313`，合併前在最後的 commit 重跑）、iPhone。開發命令 `quiz-practice` 仍請不要在 L2 裡跑。

**真實路徑**：每項發現照舊標真實路徑會不會發生；沒有擋合併的發現就直接寫「通過」。

## 審查對象（第一輪）

- **位置**：worktree `.claude/worktrees/quiz-practice`（主資料夾底下），分支 `claude/quiz-practice`，沒有未提交的程式修改。
- **待審**：`7bf6313caea3f45cd73d532e2417563d501ba889`。它之後只有文件的 commit（這份請求、任務說明的〈結果〉、backlog、roadmap）。
- **基準**：`73b4a8fbe9f9b61962d742d85a9c929eb7d8ca98`（開工時的 `main`）。中間併過一次 `main`（`d202efd`），只有文件，沒有程式。

```bash
git diff 73b4a8fbe9f9b61962d742d85a9c929eb7d8ca98 7bf6313caea3f45cd73d532e2417563d501ba889 -- src tests tools docs/syntax.md tasks/exam-scope.md
```

一節一個 commit，可以分開看：§1 `df1bd5f`、`389b4b3`；§2 `034efee`；§3 `5c5ec30`；§4 `514f3ad`；§5 `aefdac4`、`58acbe2`；通知層級 `8dc2478`；開發命令 `7c7f1d1`、`7bf6313`。

## 規格與優先順序

- 任務說明：[quiz-practice.md](quiz-practice.md) §1～§6（§1 含 2026-11-05 加的「屬性有 `小考日期` 的檔，段考也不讀」）。
- 決定：[D-189](../docs/decisions.md#d-189-小考前的密集複習成對的卡隔開單篇練習與小考標記) 第 1、2、3、5 點；[D-163](../docs/decisions.md#d-163-入口與目錄的四批開法全部卡的一輪與提醒一區) 第 4 點；[D-183](../docs/decisions.md#d-183-國語一課分成幾篇古典詩做接句) 第 2、6 點；[D-142](../docs/decisions.md#d-142-範圍與目錄模組的六項選擇) 第 2、4 點；[D-176](../docs/decisions.md#d-176-考試範圍第二批的選擇手改的範圍檔不默默失效提前結束立刻失效) 第 1 點；[D-069](../docs/decisions.md#d-069-新卡的開始與同一個字的兩個方向)。
- 格式：[syntax §2-1](../docs/syntax.md#2-1-屬性)、[§4](../docs/syntax.md#4-考試範圍)、[§5](../docs/syntax.md#5-複習紀錄)。這份任務不改檔案格式，沒有格式查核。
- 相關的查核：[小考檔格式查核](<../Claude Codex Discussion/2026-11-05-quiz-mark-format-review.md>)第 3 點。
- 規格衝突時列成問題，不挑容易通過的那份。

## 行為與風險

高風險的三塊（[quality.md](../docs/agents/quality.md#高風險範圍要做-l2)）：選卡順序、讀考試範圍的檔、寫回使用者的筆記與紀錄。

- **選卡**：`src/core/study/practice.ts` 的 `practiceNext`、`chooseSpaced`、`partners`、`answeredAfter`。不能破壞：每張都出得來、全部答對就結束、不提早出還沒到時間的（除非沒有別張）、`early` 的意思不變；每日的份（`plan.ts`）不變。
- **段考讀法**：`src/core/catalog/scope.ts` 的 `isExamPath`、`parseExamFile`；呼叫端 `src/state/exam.ts`、`tools/exam-reminder.ts`、`tools/update-vault.ts`、`src/obsidian/dev-exam-files.ts`。不能破壞：既有的段考檔照讀、生效的選法不變；小考檔不進今天的份、不要求 `--exam-ok`。
- **寫回筆記**：`src/core/deck/status.ts` 的 `setDeckStatus`；`src/state/index.ts` 的 `setDeckStatus`、`src/state/writes.ts` 的 `fillFile`；`src/obsidian/deck-status.ts`。不能破壞：只改 `狀態` 的值、學習目標與 ID 不動、不覆蓋編輯器裡的字、手機不寫、和補 ID 同一列不互相蓋掉、備份閘門與讀取閘門照舊。
- **明確延後**：接句的配對（這次只認英文，但 `partners` 留了接點）、小考標記與小考檔（[quiz-mark.md](quiz-mark.md)）、家長直接改筆記時寫 `set: status`（backlog 技術債）。

請特別找（例子只是起點，請找新的組合）：

1. 成對的卡與答錯重出、回看改評分、別台裝置的作答、中途暫停一篇（目標集合變了）交錯時，會不會有一張永遠不出，或 `early` 判斷錯。
2. `setDeckStatus` 遇到手寫的屬性區：各種引號、註解、換行、YAML 寫法，會不會改到別的字，或寫出 Obsidian 與 `parseDeck` 讀法不同的結果（要對照 Obsidian 的讀法時用 `npm run export-compare`）。
3. 暫停與補 ID 同時發生：離開筆記的補 ID、存檔、暫停排在同一列時，先後與核對讀取對不對；`tracker.observe` 用 `detect: true` 會不會多出假的待處理問題。
4. `parseExamFile` 回傳 null 的檔在 `known` 裡被刪：讀到一半改內容、`first` 的計數、`settled`、`revision` 與通知次數有沒有變化。
5. 全部卡的完成畫面：`firstTry` 用 `at >= since` 與這次複習寫的 t 判斷，時間相同或時鐘往回時會不會算錯。

## 驗證方式

- 指令：`npm run check`；要在沙箱外跑（[quality.md 的檢查指令](../docs/agents/quality.md#檢查指令)），沙箱裡的固定失敗逐項列出。測試加時間上限：`node --test --test-concurrency=1 --test-timeout=120000 "tests/**/*.test.ts"`。Node 24、相依照 `package-lock.json`（worktree 自己 `npm ci`）。
- 實作者跑過：`7bf6313` 全部 1441 項通過（183 秒）；`npm run check` 通過；§2、§3、§5 的判斷條件逐項改壞再跑（結果在任務說明〈結果〉）；Windows 實機（Obsidian 1.15.0，結果檔與截圖在測試 vault 的 `Essence W6/結果/`，路徑在〈結果〉）。
- 沒跑：iPhone 實機（集中到下一次，已寫進 backlog）；`:has` 的 CSS 只在 Electron 看過。
- 開發命令 `quiz-practice` 會在測試 vault 建暫時的檔，請不要在 L2 裡跑：測試 vault 各分支共用。

## 實作者自己選的做法（請先看這些）

規格沒寫、由 Claude 決定的地方：

1. **§2 新卡裡，對方這一輪還沒答過的先出**（`chooseSpaced`）。規格只寫「不夠隔就不出」，沒寫夠隔的新卡裡誰先。照筆記順序一夠隔就出，40 個字會是 11+11 一組輪流，最後 7 個字沒有別張可以隔開，間隔只有 6，達不到規格「40 個字至少隔 10 個」的驗收。所以一輪先把每一對的第一張出完，再出第二張：40 個字是 e1～e40、z1～z40，間隔 39。代價：這一輪裡到期的中翻英，可能排到新的英翻中後面；中途關掉時可能只練到一個方向。研究上間隔拉長不是壞事（Pyc & Rawson 2009：較難但成功的提取記得較久）。**使用者 2026-11-05 同意這個順序，已寫進 D-189 第 1 點；不用再判斷要不要這樣排，只看程式有沒有照做。**
2. **§3 判斷「同步進來的」用這次複習寫的 t**：`session.ts` 的 `done` 裡每張的 t（回看改評分時已換成新的）。同一個 `since` 重建 session 時也會不顯示。
3. **§4 單篇那一列的篇名可以點**，打開那篇筆記（和草稿、暫停那幾列相同）；列排在問題提示與目標清單前面；同名附的是直接上層的資料夾名（兩層以上才不同時分不出來，D-081 的檔名本來就該唯一）。
4. **§5 開著的筆記**：有沒存的修改用「編輯器的字和磁碟比」判斷（換行先統一），不同就不寫，因為 Obsidian 沒有公開的 dirty 旗標。相同時走編輯器（`writes.edit`），和存檔同一條；沒開著走檔案（`writes.fillFile`，多一個 `plan` 參數）。
5. **§5 多一種結果 `unwritable`**：屬性區讀不懂、只改一行讀不回來、或會改到學習目標時（有 BOM、沒有屬性區的檔，第一個目標原本解析不到，加了屬性區會多出來）不寫。草稿回 `unchanged`。
6. **§5 只剩一篇啟用時**，電腦上那一篇也列出來（只有暫停，沒有單篇的全部卡）；手機畫面不變。暫停放在每一列最右邊。提示的字是新寫的（`deck-status.ts`）。
7. **§1 寫入也擋**：`state/exam.ts` 的 `update` 在回呼裡，最新內容有 `小考日期` 就回 `changed`，不寫（規格只寫讀）。開發命令的 `scopeFiles` 變成要讀內容（async），讀不到的當成範圍檔，寧可拒跑。
8. **§1 `小考日期` 只認完全相同的鍵**，和 `提前結束` 同一種看法，沒有去打字雜訊；全形冒號整個屬性區讀不出來，照規格算日期有問題。
9. **規格外：`8dc2478` 通知蓋在全螢幕上面**。實機截圖發現 Obsidian 的通知被全螢幕蓋住（層級 1000000），暫停被擋下時看不到提示；考試範圍畫面的通知原本也一樣。改動影響入口與複習畫面開著時的**所有**通知。
10. **`setDeckStatus` 讀回來要是這個狀態**：現有的寫法走不到，改壞檢查抓不到，當成保險留著。

## 回報與權限

每項發現寫觸發條件、預期／實際、影響、位置與證據，並區分「已重現」「靜態推斷」「待驗證」；另標**真實路徑會不會發生**。只審查，不改產品程式。報告標題下第一行寫狀態。
