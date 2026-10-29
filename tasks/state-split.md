# `state/index.ts` 原樣拆檔（給 Claude，本機執行）

狀態：已結案：已合併進 `main`（`0e3e8a4`）；Codex L2 通過（[審查請求](state-split-review.md)），Windows 對照通過

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（拆法已在外掛架構討論稿的環節 4 和 Codex 談定，這份是執行）。改的是 `src/state/`，屬於高風險範圍，合併前由 Codex 做 L2（[quality.md](../docs/agents/quality.md)）。

這是 [backlog 技術債](../docs/backlog.md#技術債)「`state/index.ts` 原樣拆檔（W5 架構檢查 A4 的後半）」那一列的任務說明。依據：

- [外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)環節 4：〈Codex 回應：環節 4〉第 5 題的表，與〈Claude 回應 Codex：環節 4〉結論第 8 條「照 Codex 第 5 題的表，改名配對留在組合那一層；原樣拆檔與行為修正分兩步，各自驗收」。
- [W5 架構檢查](<../Claude Codex Discussion/2026-10-26-w5-architecture-debt.md>)的 A4。

**為什麼現在，和不做比較**（[D-153](../docs/decisions.md#d-153-每個新決定與新任務先和不做比較)）：`src/state/index.ts` 現在 663 行，一個 `createState` 的閉包同時管列出與讀檔重試、讀寫的先後、紀錄合併、改名配對、寫入的那一列與核對、排今天與作答。接下來的工作都要改它：更新防線第二部分（需要新版）、M2 多檔寫入、M3 設定與範圍的接線、M4 狀態變更紀錄、D-150 的備份門檻。不拆的話，每一件都要在同一個函式族裡找位置，讀寫交錯的安全（state-writes 的 L2 跑了三輪才過）很容易在無關的修改裡被動到。不做的代價是每次改 `state` 的審查範圍都是整個檔；拆的代價是一次 L2 和合併時的衝突。拆檔不加功能、不改學習流程，北極星上的好處是之後的工作少出錯、審查少花 token。

## 排程與分支

- 分支 `claude/state-split-c5c7bf`（app 開的 worktree `.claude/worktrees/state-split-c5c7bf`），從 `main` 的 `6345057` 開。
- 順序：這份說明 → 實作 → Codex L2（審查請求 `tasks/state-split-review.md`）→ 修正、再審 → 合併進 `main`（使用者決定）。
- **和更新防線第二部分的關係**：分支 `claude/update-safeguards-2`（`f73525b`，等 Codex L2）已經改了 `src/state/index.ts`（+119／−29：`writable(path, text)` 的需要新版、`blocked()`、`canAnswer`、`version()`、`record`、`checkApp`、`rebuild` 的 gated）。兩邊同時改同一個檔會衝突，先後見〈[和更新防線第二部分的先後](#和更新防線第二部分的先後)〉。
- 別的 session 也會改 `docs/backlog.md`、`docs/roadmap.md`：只 stage 自己改的那幾行。

## 必讀範圍

| 讀什麼 | 為什麼 |
|---|---|
| 討論稿環節 4 的 M5、〈Codex 回應：環節 4〉第 5 題、結論第 8 條 | 拆法與驗收的來源 |
| [state-writes 說明](state-writes.md) §2～§5 | 讀寫先後、寫入的那一列、核對與關閉；這些性質拆完要原樣保留 |
| `src/state/index.ts`、`src/state/ids.ts` 全部 | 要搬的程式 |
| `eslint.config.js` 的 `stateEntry` 與 `moduleBoundaries`、`tests/quality.test.ts` 的 W5 邊界測試、`tests/boundaries.test.ts` | 邊界規則 |
| `.agents/skills/code-quality/SKILL.md` 的「測試」一節 | 純重構用既有的行為測試 |

## 1. 四份檔的邊界

| 檔案 | 管什麼 | 不管什麼 |
|---|---|---|
| `state/reads.ts`（讀取層） | 監看、列出（列不出來整個重試）、待讀（`pending`）、讀取中、讀不到（`unread`）、讀檔重試的計時、一次只讀一批（`queue`）、每篇卡組的失效序號（`marks`、`bump`）與正在 I/O 的卡組（`busy`）、`waiting()`；讀一批時分出「讀到的卡組文字或 `null`」「讀到的紀錄文字或 `null`」「讀不到」「跨過 I/O、放回待讀」 | 不 import `ids.ts`、不碰 tracker；不解析卡組、不合併紀錄、不排今天 |
| `state/ids.ts` | 不變（目標身分證據、占用、issue、準備與採用） | — |
| `state/writes.ts`（寫入） | 寫入的那一列（`enqueue`）、門檻（`writable`）、先讀完待讀（`admit`）、I/O 的開始與結束（`begin`、`end`、`persist` 的逾時）、核對（`checks`、`verify`，以及讀到時的判斷）、`fillFile`、`edit`；`EditorHandle`、`WriteResult` 型別 | 不 import Obsidian；不直接改 `deckMap`、不重排：準備（`tracker.fill`、`tracker.resolve`）與寫回後的採用由組合那一層傳進來 |
| `state/index.ts`（組合） | 對外介面（`State`、`StateOptions`、`createState`、型別與 `device.ts` 的匯出）、卡組與紀錄的資料（`deckMap`、`sources`、`history`）、建 tracker、改名配對（`gone` 那段）、`observe`、`rebuild`、`replan`、`adopt`、`track`、第一次載入的 `load`、今天的份與作答、`close()` 的先後 | — |

**改名配對留在組合那一層**：`read` 裡用 `gone` 配對的那段直接用 `tracker.text()`／`tracker.move()`，照 Codex 第 5 題原樣留在 `index.ts`，不搬進讀取層、不另存一套版本讓它看似獨立。

### 內部介面

三份檔共用一個生命週期物件 `{ loaded: boolean; closed: boolean }`，由 `index.ts` 建立、傳給讀取層與寫入，兩個值只有 `index.ts` 改。

- **讀取層** `createReads(...)`：輸入 `files`、生命週期、`delay`、`watched(path)`（要不要理這個通知：卡組，或別台裝置的紀錄）、`onError(error)`（一律當成 `read`）、一批讀完時的 `batch(texts, logs)` 與讀不到時的 `unreadable(path)`。`batch` 回傳一個「收尾」函式：讀取層先呼叫 `batch`，再處理讀不到的重試與 `onError`，最後呼叫收尾（照現在 `read()` 裡的先後：紀錄、核對、改名、`observe`、`deckMap` → 讀不到的回報與重試 → `confirm`、`rebuild`、`replan`）。回傳 `start(load)`、`queue`、`read`、`readNow`、`waiting`、`unread`（集合）、`bump`、`hold(path)`（I/O 開始）、`unhold(path)`、`reread(path)`、`stop()`（關閉時清計時、叫醒、停監看）、`idle()`（等讀取那一列）。
- **寫入** `createWrites(...)`：輸入讀取層、生命週期、`files`、`fillIds`、`writeTimeout`、`wrote(path, text)`（tracker.wrote）。回傳 `enqueue`、`edit`、`fillFile`、`verified(path, text)`（一批讀到這篇時的核對）、`unreadable(path)`、`stop()`（關閉時把等核對的回 `saved` 或原本的結果）、`idle()`（等正在 I/O 的那一份）。

名稱與參數的形狀是實作者的選擇，上面是起點；實際的寫法記在 L2 請求的〈Claude 自己選了做法的地方〉。

## 2. 不改任何行為

- **公開匯出不變**：`src/state/index.ts` 對外的值仍是 `createState`、`deviceCode`、`isDeviceCode`，型別仍是 `EditorHandle`、`WriteResult`、`StateOptions`、`ErrorSource`、`LoadTimings`、`State`、`IdIssue`、`IdIssueKind`、`DevicePlatform`；`State` 的方法與註解不改。外層的呼叫端（`src/`、`tests/`、`tools/`）一行都不改。
- **副作用的先後不變**：`read()` 一批之內的先後（上一節「收尾」那一句）、`end()` 裡「結束 I/O → 放行 `close()` → 放回待讀並立刻讀」、`close()` 裡「標記關閉 → 清計時 → 叫醒 → 停監看 → 等核對的收掉 → 等 I/O → 等讀取 → 等紀錄寫完」都照現在的順序。
- **不加 `await`、不加 async 的轉手層**：state-writes 的測試會一個一個 microtask 掃（S13 交接版掃第 0～20 個）。拆出去的 async 函式（`read`、`start`、`admit`、`edit`、`fillFile`）各自整段搬，回傳的是同一個 Promise；組合那一層要轉手時用普通函式直接回傳，不用 `async` 包一層。
- 搬的時候看到的問題（包括可以順手修的）不在這次改，記進 L2 請求或 backlog，行為修正另外一個分支做（結論第 8 條）。
- 註解跟著程式搬；只改「這段在哪個檔」這類因為搬家而不對的字。

## 3. 測試與邊界規則

- **既有測試的預期不改**：`tests/` 既有的檔案只能加，不能改或刪既有的斷言。驗收：`git diff <基準> -- tests/` 只有新增的行。
- **ESLint 仍擋外層 import `state` 內部**：`stateEntry` 的規則（`(^|/)state/(?!index\.ts$)`）不用改就涵蓋新檔。在 `tests/quality.test.ts` 的 W5 邊界測試加兩列：`src/review/index.ts` import `../state/reads.ts`、`../state/writes.ts` 被擋。
- **公開匯出**：在 `tests/boundaries.test.ts` 加一則，`src/state/index.ts` 的值匯出照字串排序等於 `['createState', 'deviceCode', 'isDeviceCode']`（和 `deck`、`study` 的同類測試一樣）；型別由 `tsc` 經呼叫端檢查。
- 不以檔名、行數或空檔案測拆分結果（Codex 第 5 題）。

## 4. 驗收

- `npm run check` 在沙箱外全過；基準是 `main` 的 `6345057`：673 項全過。拆完是 673 加上這次新增的那幾項。
- `git diff 6345057 -- tests/` 只有新增的行；`git diff 6345057 -- src/ ':!src/state/'` 是空的。
- `src/state/reads.ts` 不 import `./ids.ts`（`grep` 判斷）；`src/state/writes.ts` 不 import `obsidian`（ESLint 已擋）。
- **Windows 實測（建議，非必要）**：打包內容會變。合併前若測試 vault 有空（先照 [test-vault 的規矩](../docs/agents/quality.md#檢查指令)看 `main.js` 的時間與最近的結果檔、問正在用的 session），裝這個分支的開發版，重跑 `save-flow`、`save`、`lock`、`a3check`，和 state-writes 最後一次的結果比對（`save-flow … 152335`、`save … 152443`、`lock … 152506`、`a3check … 152724`）。沒空就在 L2 請求寫明沒跑、原因。

## 5. commit 的切法

每個 commit 都過 `npm run check`（pre-commit）。

1. 這份說明。
2. 抽出讀取層 `reads.ts`（連同 ESLint 與公開匯出的測試）。
3. 抽出寫入 `writes.ts`。
4. 合併前的整理（如果有）、L2 請求、backlog 與 roadmap。

## 和更新防線第二部分的先後

開工時問了「更新防線2」的 session；它的回覆在拆完之後才到（2026-10-29）：同意它先合併，合併進 `main` 後會通知這邊並附上 merge commit。§2-2 對 `index.ts` 的改動都在 `f73525b`，但它的 L2 若改到門檻或版本行，合併前 `writable`、`admit`、`answer`、`checkApp`、`rebuild` 附近還可能再變；它新 import 的 `../core/version/index.ts`、`../core/backup/index.ts`（`lastVersions`）跟著那幾段走。這邊已經先在 `main` 上拆好（拆檔是機械的，晚一點合併時再放進去比等它便宜）。兩邊誰後合併，誰解衝突：

- **建議更新防線第二部分先合併**（它的 L2 審的是舊的檔案配置，不用因為拆檔重審）。之後這裡 `git merge origin/main`，把它加的程式照下面的對應放進拆好的檔，`npm run check` 全過，再請 Codex 只審那次合併：
  - `writes.ts`：`writable` 多一個 `text` 參數與「需要新版」的原因（`blocked.reason` 加 `'needs-update'`），`admit` 的對應、`fillFile` 與 `edit` 裡傳最新文字的那兩處；「這篇需要新版」由 `index.ts` 傳進來（`WritesOptions` 多一個回呼，例如 `blockedText(path, text)`）。
  - `index.ts`：`StateOptions.build`、`version`、`needsUpdate`、`record`、`checkApp`、`appState`、`rebuild` 的 gated、`answerable`、`blockedText`、`blocked()`、`canAnswer`、`version()`、`flush`、`deckStatus` 的 needsUpdate、`answer`、`load` 裡的 `checkApp()`、`batch` 收尾裡的 `checkApp()`、`mergeHistory` 的 `version` 參數、`EMPTY_HISTORY` 的新欄位。
  - `reads.ts`：不受影響。
- 如果這裡先合併：更新防線第二部分合併 `main` 時照上面的對應放，那次合併同樣要請 Codex 審。

## 完成後

- 改本檔的狀態行；backlog 那一列改成完成；roadmap 的「現在在哪裡」與已完成照 D-141。
- 給使用者一段可以貼給 Codex 的提示，寫明工作目錄是這個 worktree 的完整路徑，報告也寫在 worktree 裡。
