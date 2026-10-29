# `state/index.ts` 原樣拆檔：L2 獨立審查（給 Codex）

狀態：已結案：L2 通過、沒有要修的，已合併進 `main`（`0e3e8a4`）；結論見[報告](<../Claude Codex Discussion/2026-10-29-state-split-review.md>)最後〈Claude 核對〉

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（只搬程式，但搬的是讀寫先後與寫入協調，順序或 microtask 的差異就會讓 state-writes 的保護失效）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)、[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)，[任務說明](state-split.md)由 Claude（Opus 5.5）實作。改的是 `src/state/`，屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- **工作目錄**：`D:\程式開發\Essence Cards\.claude\worktrees\state-split-c5c7bf`（app 開的 worktree），分支 `claude/state-split-c5c7bf`。**不是**主資料夾 `D:\程式開發\Essence Cards`：主資料夾是 `main`，沒有這些 commit。沒有 push。
- 從 `main` 的 `6345057` 開出。commit（由舊到新）：
  - `86288d8`：任務說明（不用審程式，但請對照實作）。
  - `aa6862a`：抽出讀取層 `src/state/reads.ts`，加邊界測試。
  - `d67bb62`：抽出寫入 `src/state/writes.ts`。
  - `b74b028`、`5ca9166`、`63b0b32`：文件（這份請求、backlog、roadmap、任務說明），不用審。
  - `5fd4cf4`：合併 `origin/main`（`52c5fc5`，含更新防線第二部分的合併 `1308e58`）。它改了舊的 `src/state/index.ts`（+119／−29 左右），這次照任務說明〈和更新防線第二部分的先後〉的對應，原樣放進拆好的 `index.ts` 與 `writes.ts`；`backlog.md`、`roadmap.md` 的衝突只留兩邊的列。
  - 這份請求更新後的文件 commit。
- **看搬了什麼**（主要的看法）：`git diff --color-moved=dimmed-zebra 52c5fc5 HEAD -- src/state`。`52c5fc5` 是合併後的 `main`，搬動的行會淡化，剩下的才是改過的。
- **只看整合**：更新防線第二部分對舊檔的改動是 `git diff 6345057 1308e58 -- src/state/index.ts`；這邊放進拆好的檔的是 `git diff d67bb62 5fd4cf4 -- src/state`，兩份應該一一對應。
- 整個分支相對 `main`：`git diff 52c5fc5...claude/state-split-c5c7bf`。

## 規格與優先順序

- 主要規格：[tasks/state-split.md](state-split.md) §1～§4。依據：[外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)〈Codex 回應：環節 4〉第 5 題的表、〈Claude 回應 Codex：環節 4〉結論第 8 條；[W5 架構檢查](<../Claude Codex Discussion/2026-10-26-w5-architecture-debt.md>) A4。
- 讀寫先後、寫入的那一列、核對與關閉的性質以 [tasks/state-writes.md](state-writes.md) §2～§5 為準；拆完要和 `52c5fc5`（合併後的 `main`）的行為完全相同。更新防線第二部分的規格是 [tasks/update-safeguards.md](update-safeguards.md) §2-1、§2-2，它的 L2 已在 `main` 上通過（[報告](<../Claude Codex Discussion/2026-10-29-update-safeguards-2-review.md>)），這次只看搬得對不對。
- 這次**只搬、不改行為**。搬的時候看到的既有問題請照樣回報，但標成「既有，拆檔前就有」，建議記進 backlog 或另一個分支修，不要求在這裡改。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## 請特別看

1. **副作用的先後不變**：
   - 讀一批：`reads.ts` 的 `read` 先呼叫 `options.batch`（`index.ts` 的 `batch`：紀錄合併、核對、改名配對、`observe`、`deckMap`），再處理讀不到的 `failures`、`onError`、重試排程，最後呼叫 `batch` 回傳的收尾（`confirm`、`rebuild`、`replan`）。原本這些都在 `read()` 一個函式裡，順序是這樣。
   - 讀不到時等核對的寫入先回覆（`options.unreadable` → `writes.unreadable`），位置和原本相同（迴圈裡、`failure ??=` 之前）。
   - `writes.ts` 的 `end`：`reads.unhold`（`busy.delete`、`bump`）→ `finish`、`active = null` → `reads.reread`（`pending.add`、`readNow`）。
   - `index.ts` 的 `close()`：`life.closed = true` → `reads.stop()`（清計時、叫醒、停監看）→ `writes.stop()`（等核對的收掉）→ `await writes.idle()`（原本的 `await active`）→ `await reads.idle()`（原本的 `await processing`）→ `await writer.flush()`。
2. **沒有多出 `await` 或 async 的轉手層**：`read`、`start`、`admit`、`edit`、`fillFile` 整段搬；`ready()` 回傳的是 `reads.start(load)` 本身，`save`、`resolve`、`fillIds` 的 Promise 鏈和原本相同。state-writes 的測試會一個一個 microtask 掃，請確認沒有因為拆檔多出或少掉 tick（例如 `start` 改成接 `load` 回呼、`idle()` 在 `await` 之後才取值）。
3. **閉包的提前引用**：`index.ts` 建 `reads` 時傳的 `batch`、`unreadable` 用到之後才宣告的 `tracker`、`writes`。請確認 `createReads`、`createWrites` 建立時不會同步呼叫這些回呼（TDZ）。
4. **邊界**：`reads.ts` 不 import `ids.ts`、不碰 tracker；改名配對（`gone`）留在 `index.ts`；`writes.ts` 只 import `ids.ts` 的 `confirms`（純函式）與型別，對 tracker 的 `fill`、`resolve`、`wrote` 都經 `index.ts` 傳進來。ESLint 仍擋外層 import `state` 內部。
5. **公開介面不變**：`src/state/index.ts` 的值與型別匯出、`State` 的方法與註解；`EditorHandle`、`WriteResult` 改成在 `writes.ts` 定義、由 `index.ts` 轉出。`src/state/` 以外沒有改。
6. **既有測試的預期沒有改**：`git diff 52c5fc5 HEAD -- tests/` 只有新增的行；更新防線第二部分的 `tests/state-gate.test.ts`、`tests/state-version.test.ts` 沒改就通過。
7. **整合放對了地方、先後沒變**：
   - `writes.ts`：`writable(path, text?)` 的需要新版；`admit` 對 `needs-update` 也先讀完待讀；`fillFile` 的 modify 回呼與 `edit` 在 `plan` 之前都用最新的文字過門檻。「這篇需要新版」由 `index.ts` 的 `blockedText` 經 `WritesOptions.blockedText` 傳進來。
   - `index.ts`：`build`、`version`、`needsUpdate`、`record`、`appState`、`checkApp`、`rebuild` 的 gated、`answerable`、`permits`、`blockedText`、`blocked()`、`canAnswer`、`version()`、`flush` 設 written、`deckStatus` 的 needsUpdate、`answer`。
   - `checkApp` 的兩個呼叫點：`load` 在 `life.loaded = true` 之前；`batch` 的收尾在 `rebuild` 之後、`replan` 之前（和舊檔在 `read()` 尾端的位置相同，也就是讀不到的回報與重試之後）。
   - `reads.ts` 沒有因為整合而改。

## Claude 自己選了做法的地方（請逐點回覆）

1. **共用的生命週期物件** `life = { loaded, closed }`：由 `index.ts` 建立，讀取層與寫入只讀。原本是 `createState` 閉包裡的兩個 `let`；改成物件是為了三份檔看到同一個值，不另外傳 getter。
2. **`batch` 回傳收尾函式**：為了讓「讀不到的回報與重試」照原本夾在 `deckMap` 更新與 `confirm`／`rebuild`／`replan` 之間。`tracker.revision()` 原本在分類迴圈之前取，現在在 `batch` 開頭取；中間只有分類迴圈與 `unreadable`（只 `settle` Promise，不動 tracker），所以取到的值相同。
3. **核對讀取的判斷放在 `writes.ts` 的 `verified`**：原本在 `read()` 裡的一段迴圈；`batch` 改成對每篇呼叫 `writes.verified(path, text)`，位置不變（紀錄合併之後、改名配對之前）。`tracker.wrote` 經 `wrote` 回呼。
4. **`reads.start(load)`**：列出與重試在讀取層，列出來之後交給 `index.ts` 的 `load`（設 `loaded`、排今天、`catchUp`）；用回呼而不是讓 `index.ts` 先 `await` 列出結果，避免多一層 async。
5. **檔名**：`reads.ts`、`writes.ts`（Codex 第 5 題寫 `mirror.ts` 是暫名）。
6. **新增的測試**：`tests/boundaries.test.ts` 一則（`state/index.ts` 的值匯出照字串排序是 `createState`、`deviceCode`、`isDeviceCode`）；`tests/quality.test.ts` 的邊界列表加 3 個案例和 1 行說明（外層 import `reads.ts`、`writes.ts` 被擋，`state/index.ts` import `./reads.ts` 不擋；Codex L2 指出原本寫成「4 列」）。
7. **和更新防線第二部分的先後**：這邊先在舊的 `main` 上拆，沒等它；它先合併（和那個 session 談定），這邊再合併 `main`、把它的程式放進拆好的檔（`5fd4cf4`）。使用者決定拆檔與整合一次審。
8. **`blockedText` 留在 `index.ts`、用回呼傳給寫入**：它看 `gated`（`rebuild` 算的）與 `needsUpdate`（版本），都是組合那一層的資料；寫入只需要知道「這篇能不能寫」。

## 驗證方式

- Node 24 以上（Claude 用 v24.13.0）。在**上面的工作目錄**裡：`npm ci`、`npm run check`。照 [quality.md](../docs/agents/quality.md) 的審查注意事項，完整的 `npm run check` 要在沙箱外跑。
- Claude 跑過：每個 commit 的 `npm run check`（pre-commit）。拆檔時的基準 `6345057` 是 673 個測試（state-writes 合併後的數字），`aa6862a`、`d67bb62` 都是 674 個（多的是公開匯出那一則）；合併後的 `main`（`52c5fc5`）是 747 個（更新防線2 的 session 回報），`5fd4cf4` 是 748 個，全部通過。
- 機械的比對：`6345057` 與 `52c5fc5` 的 `index.ts` 每一行（去掉縮排）在三份新檔裡都找得到，找不到的只有改名（`closed` → `life.closed`、`loaded` → `life.loaded`、`bump` → `reads.bump`、`await active` → `await writes.idle()` 之類）與拆開的轉接。
- Windows（2026-10-30 跑，你的 L2 之後）：`save-flow`、`lock`、`a3check` 和基準相同；`save` 一開始拆檔版 8 次過 5 次、`main` 版 8 次全過；之後輪流對照兩個版本各 5 次全過，判斷是環境造成的。細節見[報告](<../Claude Codex Discussion/2026-10-29-state-split-review.md>)最後〈Claude 核對〉。要比對的基準是 state-writes 最後一次的 `save-flow … 152335`、`save … 152443`、`lock … 152506`、`a3check … 152724`。

## 回報

寫在**這個 worktree** 的 `Claude Codex Discussion/2026-10-29-state-split-review.md`（完整路徑 `D:\程式開發\Essence Cards\.claude\worktrees\state-split-c5c7bf\Claude Codex Discussion\2026-10-29-state-split-review.md`；不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、是這次拆檔造成的還是既有的、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 「請特別看」的 7 點逐點寫結論；「Claude 自己選了做法的地方」的 8 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。
