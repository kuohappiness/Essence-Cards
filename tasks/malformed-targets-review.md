# 寫錯的學習目標看得到（D1）、重新啟用後的舊存檔按鈕（W2）、開發命令的假通過（N1）：L2 獨立審查（給 Codex）

狀態：已合併進 `main`（`b9309ca`，2026-10-31）；Codex L2 一項 P2（F1）修在 `b9d1f0b`，再審通過；文字使用者看截圖後選了「原因改短句」（`c63fe5d`）；[報告與 Claude 的回應](<../Claude Codex Discussion/2026-10-31-malformed-targets-review.md>)

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（改動不大，但跨 `src/state/` 與 `src/obsidian/`，`deckStatus` 的形狀與存檔的 `added` 都改了意思）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)，[backlog 技術債](../docs/backlog.md#技術債)的三列由 Claude（Opus 5.5）實作：「寫錯的學習目標不出題，卻沒有地方告訴家長」（D1）、「停用再啟用外掛後，舊的存檔按鈕與小視窗可能留在畫面上」（W2）、「開發命令 `lock`、`save` 當驗收時會假通過」（N1）。D1 跨 `state` 與 `obsidian`，屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md#高風險範圍要做-l2)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- **工作目錄**：`D:\程式開發\Essence Cards\.claude\worktrees\state-split-c5c7bf`（git worktree），分支 `claude/malformed-targets`，沒有 push（本機的分支，各 worktree 共用）。**不是**主資料夾 `D:\程式開發\Essence Cards`（那裡是 `main`，沒有這些程式的 commit）。沒有未提交的修改。
- 從 `main` 的 `26fa3084d2f5b1b3e39c97074c1b6ce9ece07681` 開出；之後把 `origin/main` 的 `74637e5`（0.2.0 正式版，只改版號）合進來（`549bf5bef3b597eabc31c37470a734d30715c229`，沒有衝突），共同祖先是 `74637e5`。程式的 commit（由舊到新）：
  - `f4d32722335b654775091501626e28aa8f7725cc`：N1。
  - `6cb6e88679260392958602e949bcc9cbcdabcb24`：D1（含開發命令 `save-tips`）。
  - `bd165f82714120a8805badfb0cecae49ae8057f9`：D1 的開發命令 `save-tips` 在 Windows 第一次跑時的三個問題（只改開發命令）。
  - `207cadfbd337acde4a24573dd9bdcb2c158414a8`：W2（含開發命令 `w2`）。
  - 最後一個 commit 只加這份審查請求、roadmap 與 backlog 的狀態，不用審。
- 整個分支：`git diff origin/main...claude/malformed-targets`。

## 規格與優先順序

- 主要規格：backlog 技術債那三列的完成條件（逐條對照）。來源是[外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)〈環節 2 的結論〉第 1 條（D1；細節在〈Codex 回應：環節 2〉第 1 題與 Claude 的回應）、〈環節 5 的結論〉第 3 條與〈環節 9 的結論〉第 6 條（W2）、〈環節 9 的結論〉第 5 條（N1）。
- 相關的決定與規範：syntax.md §2-10 與 [D-089](../docs/decisions.md#d-089-語法的邊界規則與寫錯時的處理) 第 10 條（寫錯的目標跳過、要讓家長看得到）；[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)（家長不必知道 ID：文字只說「加入複習」「進度連結」）；[D-154](../docs/decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測) 第 2 點（受阻的說明不變）。編輯畫面的標示是 [D-047](../docs/decisions.md#d-047-編輯畫面標示卡組結構)，另列在 v1 任務，D1 是在那之前的過渡。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## 行為與風險

- **公開介面**：
  - `State.deckStatus(path)` 多一個一定有的欄位 `malformed: Malformed[]`（`src/state/index.ts`，型別在 `src/state/ids.ts`）：`line` 目標那一行、`at` 它第一個 error 那一行（都從 0 算）、`name`、`reason`（解析時的 message）。還沒 ready、需要新版的卡組回空陣列。
  - `WriteResult` 的 `done.added`：原本是新配上 ID 的目標數，改成「新配上 ID、而且寫法沒有問題（`ok`）的目標數」（`src/state/ids.ts` 的 `fill`；`src/state/writes.ts` 的註解）。寫錯的照樣配 ID。
  - `src/obsidian/save.ts`：`TIPS.done` 改成「筆記已自動儲存；沒有發現需要處理的地方」；新增 `TIPS.malformed`、`addedMalformed`、`problem`、`more`；按鈕多一種 `malformed`（`alert-triangle`、class `is-malformed`、警示色，`src/obsidian/ids.css`），順序是需要新版 → 待處理的問題 → 寫法有問題 → 沒有 ID → 沒有要做的；`done` 與 `unchanged` 的通知把新增數和問題合成一則（最多三個，`第 N 行〈名稱〉：原因`，其餘「另有 N 個」）。存檔結束時 `host.log('存檔結束 ' + path)`（N1）。`wireSave` 用 `plugin.register` 登記卸載時的收尾（W2）。
- **不可破壞的性質**：
  - `malformed` 從 state 最近一版已解析的卡組拿（tracker 的 `versions`），不在每次 `refresh` 解析；每個目標一筆；不含 `ambiguous-id`（它已經是待處理的問題）；同一個目標另有別的 error 時照那個原因列。
  - `saved`、`stale`、受阻、需要新版的提示照原本的意思，不另外列寫法的問題。
  - 不承諾會出題：`done` 的說明只說沒有發現要處理的；`malformed` 只涵蓋寫法的問題（還沒到期、別篇需要新版、草稿、暫停、紀錄停掉的目標不算在裡面）。
  - W2：卸載之後不碰畫面：不提示、不加回按鈕、不開小視窗；卸載時拿掉這個外掛加的按鈕、關掉它開的小視窗、取消還沒到期的離開筆記補 ID。
- **明確延後**：跨卡組重複的 ID（D2，討論稿〈環節 2〉）不在 D1 裡；編輯畫面與目錄的標示（D-047）；通知顯示多久照 Obsidian 預設；Obsidian 預設不顯示行號，通知裡的行號要靠名稱找。

## 請特別看

1. **`malformed` 的快照**（`src/state/ids.ts` 的 `malformedOf` 與 `status`）：和 `missing`、`issues` 是不是同一份內容。`versions` 在 `observe`（重讀、`fill`、`resolve`）與 `wrote` 時更新；請找 `deckStatus` 的 `malformed` 和實際不出題的目標（`src/core/study/plan.ts` 排除 `ok:false`）對不上的情形，例如改名、刪除、讀不到、還沒讀到剛建立的檔。
2. **`added` 只算寫法沒問題的**（`fill`）：用寫回的文字解析一次（同一次解析也給 `expect`，沒有多解析）。請試隱含目標（補 ID 時會多一行）、`duplicate-id` 換新（hint，`ok` 仍是 true）、待處理的行被跳過。
3. **按鈕的順序**：寫法有問題排在沒有 ID 前面；兩者都有時說明只寫寫法的問題，按下去仍會補 ID，通知寫「N 個學習目標已加入複習；有 M 個學習目標寫法有問題……」。
4. **W2 的收尾**（`wireSave` 的 `plugin.register`、`IssuesModal` 的 `Life`）：和 `main.ts` 的 `onunload`（`state.close()`）的先後；卸載後才回來的存檔仍會刪掉 `saving` 那一筆、記「存檔結束」；小視窗的錯誤路徑卸載後不再 `close()`。請找卸載後還會碰畫面的路徑。
5. **假計時器**（`tests/save-wiring.test.ts` 的 `setup(t)`）：替身的 `window.setTimeout` 是建立替身時抓的全域函式，所以先開 `t.mock.timers` 再建替身；一個測試只開一次。請確認這些測試真的在推進 1 秒的延遲（例如把 `LEAVE_DELAY` 改成 2000 時應該失敗）。

## Claude 自己選了做法的地方（請逐點回覆）

1. **欄位放在 `deckStatus`、從 tracker 的 `versions` 算**，不另開方法、不用 `deckMap`：和 `missing`、`issues` 同一份快照。
2. **`line` 是目標那一行、`at` 是第一個 error 那一行**：通知用 `at + 1`（家長要改的是題目那一行），去重用 `line`。
3. **原因直接用解析時的 message**，不在 `save.ts` 依 code 另寫短句：沒有比對中文訊息，也不必維護第二份。中翻英那一句很長，通知會變長（截圖已交使用者看）。
4. **`unchanged` 也列問題**：家長再按一次存檔就能重看（通知消失後的入口）；`saved` 照原本不提示。
5. **草稿、暫停的卡組照樣列寫法的問題**：改成啟用時一樣不會出題。
6. **寫錯的照樣配 ID**：改好之後不用再存一次；`added` 不算它們。
7. **N1 用 `host.log` 的「存檔結束」**（放在 `finally`，出錯或卸載後也會記）讓開發命令等這次點擊的存檔，不另開產品出口；上下移動的判斷抽到 `src/dev/move.ts`（照 `src/dev/marks.ts`），`lock` 其他情境不動。
8. **W2 卸載時清掉還沒到期的計時器**，不是讓它到期後再看存活旗標；重排（關、開、再關）照原本各自到期，用測試記下來，沒有改。

## 驗證方式

- 每個程式的 commit 的 pre-commit 都跑完整的 `npm run check`（型別、ESLint 含邊界、knip、secretlint、skill 副本、文件、全部測試），都通過；`207cadf` 的完整測試 897 個通過。合併 `origin/main` 之後（`549bf5b`）另跑一次完整的 `npm run check`，也通過。Codex 在沙箱裡跑會有環境造成的固定失敗，照 [quality.md](../docs/agents/quality.md)〈檢查指令〉在沙箱外跑，或逐項列出。
- 新增或改的測試：
  - `tests/state-ids.test.ts`：「D1」三則（中翻英寫了中文：列出、存檔後 `added` 1、今天的份沒有它、改好後不列；`::` 底下沒有答案與左邊沒有題目、一個目標只列一次；`ambiguous-id` 不重複算、同時沒寫答案的照那個原因列）。
  - `tests/save-wiring.test.ts`：「D1」四則（按鈕與通知、五個時列三個加「另有 2 個」與行號算上屬性區、`ambiguous-id`、`saved`／`stale`／受阻不另外列）；「N1」一則；「W2」重排一則與卸載三則；離開筆記的十則改成假計時器（R3 加到期前與剛好到期）。既有斷言加上 `malformed: []`；B1 的沒有要做的說明換成新文字。
  - `tests/dev-move.test.ts`：上下移動的判斷與四個反例。
- 先失敗再通過：D1 的 state 三則、`save-wiring` 的三則新行為、N1、W2 的卸載三則，都在改程式之前先跑過、確認失敗。
- **Windows 實機**（Obsidian 1.14.5，測試 vault 的 `Essence W5/結果/`，結果檔都記 `plugin`）：
  - W2 先重現（`0.1.0+6cb6e88.dirty`，`w2` 命令＋URI 的 `reload`）：每重新啟用一次，同一個分頁多一個按鈕（到 4 個），舊的說明停在當時、點了沒反應；存檔途中重新載入時，存檔被關閉擋下，沒有晚到的提示或小視窗。修好後（`0.1.0+207cadf`）：重新載入兩次、存檔途中重新載入都只剩一個按鈕，沒有提示與小視窗。
  - `lock`（`0.1.0+6cb6e88.dirty`，D1 與 N1 的程式和 `6cb6e88` 相同）：50／50，兩種模式的上下移動都是命令執行了、行序真的換了。
  - `save`（`0.1.0+207cadf`）：`checks` 19 項都是 true，包括新的 `clicked` 與 `redo`。
  - `save-tips`（`0.1.0+207cadf`）：`checks` 4 項都是 true；淺色、深色各三張截圖（寫法有問題時的按鈕說明、存檔後的通知、改好後的說明）。
- 沒跑：iPhone（存檔按鈕只在電腦）；`a3check` 等其他開發命令（這次沒改它們用到的路徑）。
