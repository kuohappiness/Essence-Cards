# W4 今天的佇列：L2 獨立審查（給 Codex）

狀態：已合併（`bc01b87`）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（出卡順序、配對、再出時間與進度互相牽動，邊界例子要自己找新的組合）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)，[W4 任務說明](w4.md)改由 Claude 實作。排程與紀錄格式屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-w4`，分支 `claude/w4`，沒有未提交的修改。
- 共同祖先（＝基準）：`5dc1322dd9a547fb2345581980d13db9b2784fa3`（`main`）。
- 待審 commit：`6be30fa537df937e12c91bcd1ec5e62d40e10309`（實作與測試）、`9c52acd36f3361cbcb007634d26b98112d5986e0`（一句註解）。用 `git diff 5dc1322 claude/w4` 看全部差異（11 個檔案）。

## 規格與優先順序

- 主要規格：[tasks/w4.md](w4.md) 全文，以及它的「必讀範圍」列的決定與出題語法章節。規格寫在 `b2fd0e5`；之後相關的變動有兩項：
  - [W3 說明的〈L2 審查後的修正〉](w3.md#l2-審查後的修正2026-10-21)第 6 項：效能數字不當每次 commit 的硬門檻。和 W4 的 T14 有張力，Claude 的做法見下面第 9 點。
  - [出題語法 §2-3](../docs/syntax.md#2-3-學習目標)：中翻英答案可用 ` | ` 寫好幾個。照 [backlog 技術債](../docs/backlog.md#技術債)是 W6 的事，`checkTyped` 這一批仍整串比對。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## Claude 自己選了做法的地方（請特別看）

1. **重複的 ID**：只在「啟用、不是轉錄稿」的卡組之間照路徑取第一篇；草稿或暫停的卡組不會搶走 ID（規格只寫「照 path 的字串順序，第一篇的算」）。同一篇裡的重複：W2 只給提示、`ok` 仍是 true（規格以為 W2 標成錯），所以這裡照行號取第一個，不另記 problem。
2. **配對**只看啟用的卡組；`Slot.pair` 記另一個方向的 ID（即使對方不是候選），給 `{ more: true }` 跳過用。
3. **每張卡的秒數**：錯題補強的紀錄整筆拿掉，不當相鄰的一點；找不到卡組的目標仍是相鄰的一點，只是它那一段不算；中位數最少 1 秒（避免秒數變 0 讓上限失效）。
4. **入口排序的「做完的照原本的順序」**：做完的列用同一套比較（範圍內的先，再照科目名稱，null 最後）。
5. **`inExam`**：用 `planToday` 當時 `exam.contains` 的結果，`progress` 再看 `input.exam` 不是 null。
6. **再出時間相同**時照範圍裡的順序。
7. **`isNew`**：今天以前與今天都沒有任何紀錄（含錯題補強）。
8. **`Today.slots`**：內部資料放在 `Today` 的一個欄位（型別看得到），規格的介面沒列、但允許內部資料。
9. **T14**：`planToday` 跑 5 次、`nextCard`＋`progress` 跑 21 次取中位數，仍用 300 ms／20 ms 當門檻，留在 `npm test`。Claude 的電腦上是約 86 ms 與 0.02 ms。
10. **`history.reviews` 依時間排好**是前提（mergeHistory 的結果，作答後加在最後），三個函式都用二分搜尋找今天的開始。
11. **ESLint**：除了規格的兩條，另把「study 從 deck 只能 `import type`」寫成規則（`import { type X }` 也擋，因為執行時仍會載入）。
12. **濾網**：`重要性：低` 的冒號前後允許空白。
13. 兩個方向同一天都要出時，被比下去的那個整個拿掉；贏的那個因為時間上限進了 `more` 時，輸的仍然不出。

## 行為與風險

- 公開介面：`planToday`、`nextCard`、`progress`、`checkTyped` 與 §1 的型別（`src/core/study/index.ts`）；`ReviewEntry.typed` 與 `encodeEntry`／`parseLine`／`mergeHistory` 的去重。呼叫端還沒有（W5 才接）。
- 不可破壞的性質：同樣的輸入排出同樣的順序；`planToday` 只用今天以前的紀錄，一天之中不因作答改變；`nextCard`、`progress` 不改輸入、不記住上一次；W3 已有函式的行為除了 `typed` 都不變；`src/core/` 的 import 邊界。
- 測試在 `tests/today.test.ts`（T1～T14）、`tests/study.test.ts`（T15）、`tests/quality.test.ts`（最後一個 lint 測試）。Claude 另做過 22 個突變（改壞一處程式），全部有測試擋下；這份清單沒留在 repo。
- 請自己找新的組合，例如：`offset` 不是 480，或作答時的 `offset` 和今天的不同；剛好清晨 4 點的紀錄；`capMinutes` 是 0 或小數；同一篇有好幾組英文配對、同一個 `pairKey` 出現兩次；考試範圍加上家長設的保持率高於 0.9；同一個 ID 在兩篇卡組、其中一篇暫停；回看時取消今天的一筆再重新評分；`more` 裡的卡今天被作答過。

## 驗證方式

- Node 24 以上。在 worktree 裡：`npm install`、`npm run check`、`npm run build`（`main.js` 只能 require `obsidian`）。只跑佇列：`node --test tests/today.test.ts`。
- Claude 跑過：`npm run check` 全部通過（200 個測試）；`npm run build` 是 663 bytes（和 W3 相同，因為 `main.ts` 還沒用到核心）；故意讓 deck import study、study import `deck/types.ts`、study 從 deck import 值，`npm run check` 都失敗，已還原。
- 沒跑：iPhone 實機（W5 接上外掛後量）。

## 回報

寫在主資料夾的 `Claude Codex Discussion/2026-10-24-w4-review.md`（不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 上面 13 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。

## 修正後的再審（2026-10-24）

第一次審查的結果在[報告](<../Claude Codex Discussion/2026-10-24-w4-review.md>)。Claude 已核對：F1、F2、F3 照報告的例子先寫成會失敗的測試，三個都重現後再修；F4 第 1 點也先重現。修正在同一個分支：

- 待審 commit：`dbe2c35b8d2bf3fbe29dfc6baae5b148b1b65c33`。只看這一段：`git diff 9c52acd dbe2c35`（5 個檔案，含 `tools/bench-study.ts`）。
- 規格的改動寫在 [W4 說明〈L2 審查後的修正〉](w4.md#l2-審查後的修正2026-10-24)；F4 的「其他」那一列由使用者決定，寫成 [D-133](../docs/decisions.md#d-133-入口的其他那一列排在學業科目後面)。
- Claude 跑過：`npm run check` 204 個測試全部通過；`npm run build` 663 bytes、只 require `obsidian`；`npm run bench` 的 `planToday` 中位數約 82 ms、`nextCard`＋`progress` 約 0.02 ms。

請查：

1. 這段差異和上面 6 點是否一致，修正有沒有改到別的行為。
2. 用你第一次的 `review-probes.mjs` 在 `dbe2c35` 重跑，F1 的兩個反例與 F2 是否都過了；你第一次通過的 8 組是否仍然通過。
3. 相鄰的新組合，例如：配對的兩個方向一個在啟用卡組、一個是別篇的副本；被排除的副本是配對裡行號比較小的那個；同一個 ID 只出現在草稿與暫停卡組；`offset` 變了但 `progress` 先被呼叫；做完的兩科一開始的秒數相同；「其他」那一列在考試範圍裡。

回報接在第一次報告的最後，標題「再審（2026-10-24）」，格式同第一次；沒有問題就寫「可以合併」。只審查、只回報。
