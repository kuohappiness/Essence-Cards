# 入口與目錄第二批（考試範圍）L2 審查

狀態：第一輪待修，有擋合併的發現

審查分支 `claude/exam-scope-c0f437`，共同祖先 `86c69c5dc5bd8f959a2fb07a5aa76d7b55988046`，待審 `0ffb07896ef148694f1cb337eb20659cadb4db59`。工作樹 HEAD 為 `e6d30402df03a87b75490f1032e2b1c90863dffb`，開始時乾淨。已核對兩者的 `src/`、`tests/`、`tools/` 完全一致，在 HEAD 跑沙箱外完整檢查。依審查請求查閱 42 檔差異、任務 §1～§9、格式查核與 Claude 核對、syntax §4、§5 和 D-176。以下案例使用自編資料。

## 擋合併

### R1 [P1] 開發命令拒絕測試後仍刪除原有的範圍檔

**規範與設計｜靜態推斷｜真實路徑：會，限裝了開發版的測試 vault。** 測試 vault 已有一份範圍檔時執行 `exam do=run`，第 201 行回「不動它」，但 `return` 後必走 `finally`，第 344 行呼叫 `removeFiles`。第 63 行刪掉整個考試範圍資料夾下所有索引到的檔，並清除測試卡組資料夾裡所有檔。 `do=clean` 走同一個刪除函式。預期是拒絕後保留所有既有資料，正常測試結束時只清該次新增的資料。這條路會把共用測試 vault 的既有檔案刪掉，實機結果的「沒有留下」也可能因此假通過。修正後應驗拒跑、建到一半失敗、其他分支或同步途中新增的檔與分段 clean，各自只能清有建立證據的檔。分支 `claude/exam-scope-c0f437` 的 `src/obsidian/dev-exam.ts`（0ffb078，dev-exam.ts:49–75、195–202、340–345）

### R2 [P1] 清空行內 YAML 的日期會連識別碼和無關屬性一起刪除

**規格｜已重現｜真實路徑：會，家長或工具可手寫合法 YAML 的 flow map。** 給 `editScope` 一份 `{識別碼: aaaaaa, 考試開始: 2026-10-28, 其他: 保留}` 的屬性區及一行自然 2，套 `{ start: null }`。預期只移除開始日，或無法保真時拒絕寫入。實際回 `ok`，屬性區只剩兩個 `---`，識別碼和「其他」皆消失。 `removeKey` 以整行為範圍，末尾只重驗 YAML 能否解析，空對照表合法。這會切斷 D-115 的識別鏈，原有衝突副本也不再併為同一考試。補整行刪除的安全前提，對 flow map、同行多鍵、註解與未改屬性驗寫前寫後；保不住時走 `blocked`。分支 `claude/exam-scope-c0f437` 的 `src/core/catalog/scope.ts`（0ffb078，scope.ts:234–265、330–356） · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope.md`（e6d3040，任務 §2-4）

### R3 [P1] 舊操作可以存進或提前結束另一場考試

**規格｜同路徑換檔已重現，排隊交錯為靜態推斷｜真實路徑：會，同步換檔及短時間連按可走到。** 先載入 A.md，ID `aaaaaa`，範圍自然 2-1。在 state 尚未讀到同步通知時，把 A.md 換成 ID `cccccc`、範圍自然 4。舊表單的「加 2-2」走 `State.setExam` 回 `done`，磁碟與 `set: exam` 紀錄都把 2-2 加給 `cccccc`。預期是 `blocked: changed`，磁碟和紀錄不變。UI 只比路徑，實際回呼只驗空、壞或已結束，沒有核對身分。 `endExam` 走同一入口，會替換入的考試寫提前結束。另外 UI 的路徑檢查在呼叫前，state 排隊後才重選，若前一筆寫完讓另一份接手，晚到的舊操作可以直接落到另一個路徑。需要在排隊執行時核對表單預期選擇，進入寫入回呼後再以最新內容驗身分；仍要保留同一份範圍上別人改過的無關行。分支 `claude/exam-scope-c0f437` 的 `src/ui/ExamScope.tsx`（0ffb078，ExamScope.tsx:76–100） · [state/index.ts:425–435、654–664](../src/state/index.ts) · 分支 `claude/exam-scope-c0f437` 的 `src/state/exam.ts`（0ffb078，state/exam.ts:153–166） · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope.md`（e6d3040，任務 §2-4、§6）

### R4 [P2] 一份範圍檔卡住，另一份已讀到仍不能排進今天

**規格｜已重現｜真實路徑：會，iCloud 佔位檔的讀取可能不返回。** 用 `createMemoryFiles.holdRead(B)` 壓住第二份，A 和自然 2-1 卡組可讀。 `ready()` 約 2.0 秒返回、`unread()` 有 B、寫範圍被擋，這些符合規格。A 卻沒有進 `exam()`，自然卡的 `inExam` 是 false；釋放 B 後才選到 A、`inExam` 變 true。預期暫用 A，顯示另有一份不可讀。 `createExamFiles` 分開了卡組與範圍讀取，但同批範圍仍在 `Promise.allSettled` 後一次交付。若 B 長時間不回來，A 的考前優先和保持率都漏掉，後續範圍通知也排在 B 後面。補一份可讀、一份一直 pending、卡組和紀錄照常的測試；讓已完成的讀取可交付，並保留晚到結果的世代保護。[state/reads.ts:108–121、132–179](../src/state/reads.ts) · 分支 `claude/exam-scope-c0f437` 的 `src/state/exam.ts`（0ffb078，state/exam.ts:65–109） · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope.md`（e6d3040，任務 §4 第 274 行）

### R5 [P2] 等寫入逾時後，舊回呼仍可落盤且沒有考試紀錄

**規格｜已重現｜真實路徑：會，底層延遲完成時可發生。** 延遲 `Files.modify` 進入回呼，`endExam()` 在 30 ms 測試門檻回 `failed`、畫面依此報寫不進去。釋放原本 I/O 後，原回呼照常寫入 `提前結束`，狀態重讀後取消考試，`flush()` 後仍是零筆 `set: exam`。預期失敗的操作不能稍後不留紀錄地結束考試，或應明確呈現仍待核對並在確定寫成後入帳。 `Promise.race` 只結束等待，未取消底層，`finally` 已釋放路徑保護。這也會讓重試和舊回呼同時排隊。修正要分「回呼尚未進入」與「底層可能已接手寫入」，驗逾時後成功、逾時後拒絕、重試、關閉，以及只記已確認的那次變更。分支 `claude/exam-scope-c0f437` 的 `src/state/exam.ts`（0ffb078，state/exam.ts:112–129、153–184） · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope.md`（e6d3040，任務 §2-5、§6）

### R6 [P2] 取消整章中一節會把仍勾選的特殊單元寫成看不懂

**規格｜已重現｜真實路徑：會，卡組單元欄允許這種編號，審查請求也列 `2-9,3`。** 自然 2 底下有 `2-1`、`2-9,3`、`2-10`，範圍檔勾整章 2。原本 `unitInScope` 對 `2-9,3` 是 true。取消 2-1 時該特殊單元仍勾著，但 `editScope` 展開後寫出 `- 國二上 自然 2-9,3`，重讀是 `unreadable`，目標掉出考前排程。這和直接勾特殊單元時 `scopeWritable=false` 的保護不一致。預期維持其勾選與歸屬，或在格式無法表示時先阻擋並指出會失去的單元，不能顯示存成功才掉卡。補巢狀 2-1-3、特殊科目字形及整章取消前後的集合比較。分支 `claude/exam-scope-c0f437` 的 `src/core/catalog/scope.ts`（0ffb078，scope.ts:73、294–308、370–374） · 分支 `claude/exam-scope-c0f437` 的 `src/ui/ExamScope.tsx`（0ffb078，ExamScope.tsx:139–148） · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope.md`（e6d3040，任務 §2-4）

### R7 [P2] 損壞屬性區可讓同一考試的舊副本復活或中斷載入

**規格｜兩種均已重現｜真實路徑：會，手改、移除 YAML anchor 或同步半途均可形成。** A 與 B 同 ID `aaaaaa`，A 有 `提前結束`。把 A 的另一欄改成不完整的 `其他: [`，`parseScope(A)` 仍回 `ended: true`，但丟失原本完整的識別碼，`chooseScope` 選到 B。預期同 ID 的已結束證據仍能阻止 B；若證據不足，至少應報未知，不能讓 B 無警示復活。另一個例子是 `考試開始: *missing`，YAML `toJS` 拋未解析 alias；循環日期 `考試開始: &a [*a]` 也會在 `JSON.stringify` 拋錯。預期落在壞屬性或日期有問題的公開分支；現況首次載入進入 `start` 的 catch，既不 `settled` 也沒走後續讀取收尾，設定可能長期卡在讀不到。修正時把單檔解析故障限制在該檔，明訂壞檔有結束證據但無法確認 ID 的處理，並驗同批另一份仍可交付。分支 `claude/exam-scope-c0f437` 的 `src/core/catalog/scope.ts`（0ffb078，scope.ts:40–44、118–141、168–186） · 分支 `claude/exam-scope-c0f437` 的 `src/state/exam.ts`（0ffb078，state/exam.ts:73–101） · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope.md`（e6d3040，任務 §2-2、§2-3）

### R8 [P2] 儲存合併後的日期未驗證，提前結束也會重寫原日期

**規格｜已重現｜真實路徑：會，正常表單與合法手寫日期即可觸發。** ① 表單開啟時開始 10/21、結束 10/28。表單把開始改為 10/27，回呼讀到別台已把結束改為 10/25。實際 `setExam` 回 `done`，存下開始晚於結束的期間，`exam().period` 變 `bad`，考前保持率下降且日期不會自然失效。預期在回呼驗合併後的期間並攔下新造成的矛盾；家長原本已有的壞值要依 §2-4 的保留規則區分。② 按提前結束時，原文 `考試開始: 20261028` 和 `考試結束: 2026/10/29` 都被改寫為標準日期，違反 §2-2 的原日期不動。③ `考試開始: '20261028' # 留著`、`考試結束: "2026/10/29"` 經正常確定後兩個引號都被去掉，違反 §2-4 的引號保留。三個驗收應分別檢查最新內容的合併有效性、提前結束只增標記、確定時只改值並保留原標量表示的引號。分支 `claude/exam-scope-c0f437` 的 `src/ui/ExamScope.tsx`（0ffb078，ExamScope.tsx:71–96） · 分支 `claude/exam-scope-c0f437` 的 `src/core/catalog/scope.ts`（0ffb078，scope.ts:247–278、330–356） · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope.md`（e6d3040，任務 §2-2、§2-4、§6）

### R9 [P2] 前景一直開著跨過 04:00，倒數與表單維持前一日

**規格｜已重現｜真實路徑：會，入口或表單保持可見、沒有新檔案通知時。** 使用真正 `openEntry`、React/happy-dom 和可控時鐘，10/29 03:59:59 看 10/28 的考試，入口寫「今天考試」、保持率 0.9。跨 04:00 後 `State.today()` 已回 0.8，入口仍寫「今天考試」，手動 `handle.refresh()` 後才消失。同樣讓表單保留 10/27 的輸入，10/28 04:00 後不出現日期已過的灰字，手動刷新才出現。現有測試每次改時鐘就直接呼叫 `handle.refresh()`，只驗重畫後的字。預期開著跨界也刷新，並且表單確定時用最新複習日決定成功通知。入口只訂資料／可見性事件，前景換日無來源。補不用手動 refresh 的換日測試，並驗背景回來及關閉時解除排程。[entry-host.tsx:45–73](../src/ui/entry-host.tsx) · 分支 `claude/exam-scope-c0f437` 的 `src/ui/ExamScope.tsx`（0ffb078，ExamScope.tsx:71–96、130） · 分支 `claude/exam-scope-c0f437` 的 `tests/exam-ui.test.ts`（0ffb078，exam-ui.test.ts:425–438） · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope.md`（e6d3040，任務 §4、§6、§7）



## 其他發現

### R10 [P3] 重排用的鍵與實際單元、考試身分不一致

**規格｜已重現｜真實路徑：會，手改編號大小寫或同內容換成不同 ID。** `L1` 改 `l1`，兩者 `codeKey` 相同，`today()` 卻換了物件，代表重排；接著只把 ID 從 `aaaaaa` 改 `bbbbbb`，`today()` 沒換物件。§4 說單元身分等價時只在必要時通知，選定身分變才重排。現況前者多算，後者少做約定的重排，目前沒有重現出卡順序因此錯誤。修正 R3 核對考試身分時可一併釐清排程鍵和畫面鍵，補等價字形、不同身分同內容、改名同身分的對照。[state/index.ts:400–421](../src/state/index.ts) · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope.md`（e6d3040，任務 §4）

### R11 [P3] 安裝工具先看日期錯誤，已結束考試的舊副本仍會觸發提醒

**規格｜已重現｜真實路徑：會，同 ID 的舊同步副本還留著手改的壞日期時。** A 為 `aaaaaa`，已提前結束；B 同 ID，未同步到結束欄，開始日是 `10/28`。外掛排除整組；`examReminder` 卻在選定之前掃到 B，回 `unreadable` 和 `needsOk: true`，安裝流程會要求額外確認。這和審查請求所列「同一個識別碼的舊副本不算」不一致。建議有可靠身分且已結束的副本先排除，再保守提醒無法判斷的活躍檔或讀不到的檔。另測只有分類／空範圍但有日期的檔是否應產生安裝提醒，明訂提醒要跟候選的 `usable` 一致或刻意更保守。[exam-reminder.ts:24–41](../tools/exam-reminder.ts) · 分支 `claude/exam-scope-c0f437` 的 `tasks/exam-scope-review.md`（e6d3040，審查請求，實作者選擇第 8 點）

## 對照與驗證

- **沙箱外 `npm run check` 通過，exit 0。** Windows、Node v24.13.0，從上述 worktree HEAD 執行。涵蓋 TypeScript、ESLint 與模組邊界、knip、secretlint、skill 副本、文件檢查與完整 Node 測試。用 dot reporter 減少輸出。
- **純函式探針**以 Node stdin 呼叫 `parseScope`、`editScope`、`chooseScope`、`scopeWritable`、`unitInScope` 與 `examReminder`。除上列反例，正常 `L1` 與 `L01` 保持不同、全形與連字號空白照標準鍵、`2-2 水溶液` 照讀、`2-2、2-3` 整行拒絕。科目含獨立數字的手寫歧義，實作照格式查核後定下的第一個像編號的字切分，且正常直接勾選會擋無法往返的科目。範圍的擴展寫入繞過這道保護，見 R6。
- **State 與寫入**用 `createState` 加 `tests/helpers/memory-files.ts`。同 ID 的正常副本和不同 ID 接手均有既有測試。另把 `failModify` 設為 true，`endExam()` 回 failed、選定檔未結束、無考試紀錄。讓範圍寫成、紀錄 append 拒絕時，範圍仍立即失效，`flush()` 拋錯且有 `onError('write')`。這與 R5 的逾時後才寫成不同。
- **相容性與回放**用 `tools/compare/adapter.ts` 的 `snapshot` 讀一份含範圍檔、作答與 `set: exam` 的凍結資料。去掉 exam 紀錄行後，兩份 snapshot 完全相同，`today` 的卡仍是 `exam-due`、保持率 0.9，證實排程讀範圍檔。 `mergeHistory` 以 0.1.0、0.2.0、0.3.0 各測 1 變更、1 作答、`incomplete=false`，`replay` 各產出 1 份記憶。三個正式 tag 與 HEAD 的 `entries.ts`、`history.ts` blob 相同。沒有以舊版實機重裝。
- **畫面**用真正的 `openEntry`、React、happy-dom 及可控時鐘重現 R9。另在同一個 `act` 裡同步送 input 和 focusout，日期能正規化，未重現 Windows 那一次的 blur 異常。Windows 結果沿用任務 §10 已提供的實測，R1 用靜態控制流確認。
- 未另跑 Windows Obsidian、iPhone 或兩台 iCloud 實機。共用測試 vault 依審查請求保留給實作者。同步交錯、佔位檔卡住與晚到寫入的已重現案例來自隔離的 Files 替身。

