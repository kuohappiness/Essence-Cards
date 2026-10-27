# 卡組讀不到就跳過那一篇（給 Claude，本機執行）

狀態：已完成：已合併進 `main`（`707fbb8`）；§8 的 Windows 驗證 2026-10-27 補做，照預期（結果在分支 `claude/w6` 的 `tasks/w6-review.md`〈第三次再審〉，`793db8f`）；收尾的 `unread` 開發命令與 `main.ts` 註解 2026-10-27 補上（`73b4000`）；畫面要不要列出讀不到的卡組見 [backlog](../docs/backlog.md#技術債)

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)：排程與設計判斷已在這份說明做完；改的是 `src/state/` 的失敗語義與 ID 的安全，屬於高風險範圍，合併前由 Codex 做 L2）。

這是 [backlog 技術債](../docs/backlog.md#技術債)「任何一篇卡組讀不到，`state.ready()` 就整個重試」那一列的任務說明，連同 A1（紀錄的壞行救回規則有兩份）與 A5（`load()` 抄自 `readDecks`）一起做；Fable 2026-10-27 照 W6 交接單 §2（分支 `claude/w6` 上的 `tasks/w6-handoff.md`）排的。**為什麼現在**：iCloud 還沒下載好的一篇卡組會讓整個外掛讀不到，W6 的 iPhone 測試很可能碰到；2026-10-26 在 Windows 也實際碰到一個被 Obsidian 佔住的已刪除檔讓外掛載入一直重試到 Obsidian 關掉。

## 排程與分支

- 分支 `claude/state-load`，從 `main` 開，和 W6 的 L2（`claude/w6`，Codex 審查中）**同時進行**。在本機用 `git worktree add ../Essence-Cards-state-load -b claude/state-load main` 開在旁邊的資料夾；**不要在原資料夾切換分支**。
- 開分支後第一件事：`git cherry-pick 2ea31fb`（W6 做好的技術債 A9：`tests/helpers/memory-files.ts`、`tests/helpers/obsidian.ts`，`state.test.ts`、`state-ids.test.ts` 改用記憶體 `Files` 與假計時器）。預期沒有衝突；`docs/backlog.md` 那一段會拿掉 A7、A9、A10 三列，照收。cherry-pick 之後、改任何程式之前先跑一次 `npm run check`，當作基準。
- 順序：這份說明 → Opus 實作 → Codex L2（審查請求 `tasks/state-load-review.md`）→ 修正、再審 → 合併進 `main`（使用者決定）→ W6 的 session 把 `main` 合併進 `claude/w6`、在 Windows 重跑 → W6 的 iPhone 測試（§7）→ 合併 W6。
- **和外掛架構檢查的關係**（[討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>）：環節 ①（`watch` 帶改名資訊 `from`、刪掉 `apply` 的猜配對）與環節 ④（`src/state/` 本身）都還在討論，照原排程在 W6 合併後才執行，會疊在這一件之上。所以這一件**不碰** `apply` 裡的改名配對那一段（`gone`／`name` 的配對），也**不拆** `state/decks.ts`（backlog 那一列原本寫的 A4 拆檔改到環節 ④ 一起決定，免得拆兩次）。改動集中在「讀的失敗語義」「ID 安全」「紀錄的 `seen`」三件。
- 兩邊都會改 `src/state/index.ts`（W6 只在檔尾加了 A7 的三行匯出）、`docs/backlog.md`、`docs/roadmap.md`、`tests/helpers/obsidian.ts`（W6 後來多改一行）。誰後合併誰處理衝突；這一件預計先合併。

## 基準與開工條件

- 基準是這份說明所在的 commit：`git log -1 --format=%h -- tasks/state-load.md`。開工前 `git diff <那個 commit> -- docs/backlog.md docs/decisions.md tasks/w5.md` 看有沒有改過；有改以新版為準，並在回報註明。
- `main` 上 `src/state/index.ts` 的 `State` 介面以實際匯出為準（W5 說明 [§1](w5.md#外掛的資料狀態)、[§8-3](w5.md#8-3-介面)、〈L2 審查後的修正〉）。
- 這份說明沒寫到、做了又很難收回的，停下來回報，交給 Fable（D-140）。

## 必讀範圍

| 讀什麼 | 為什麼 |
|---|---|
| [D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)、[W5 說明 §8-5](w5.md#8-5-弄丟改掉與待處理) | 「沒見過的 ID」「避開紀錄裡出現過的 `lt`」是 ID 安全的依據 |
| [W5 說明 §3-1～§3-3](w5.md#3-外掛的資料狀態) | 現在的讀取與檔案變動規則；這一件改 §3-1 的失敗語義，§3-3 不變 |
| [W5 L2 報告](<../Claude Codex Discussion/2026-10-24-w5-review.md>)的 F3、[W5 第二部分 L2 報告](<../Claude Codex Discussion/2026-10-25-w5-ids-review.md>)的〈`ready()` 全部重試的技術債評估〉與〈紀錄讀取失敗與相鄰行為〉 | 完成條件的來源：讀不到時整個重讀是 F3 定的，這次改掉；「未知占用不可視為未占用」「失敗→恢復→pending 仍保留」兩個情境要帶進測試 |
| [W5 架構的技術債檢查](<../Claude Codex Discussion/2026-10-26-w5-architecture-debt.md>) A1、A4、A5 | A1、A5 這次做；A4 只做「第一次載入和之後的變動走同一條路」，拆檔不做 |
| `src/state/index.ts` 全部、`src/state/ids.ts` 的 `observe`／`fill`／`resolve`、`src/core/study/history.ts`、`src/core/deck/read.ts` | 要改的程式 |
| cherry-pick 之後的 `tests/state.test.ts`、`tests/state-ids.test.ts`、`tests/helpers/memory-files.ts` | 測試怎麼寫：`failing` 集合模擬讀不到，`settle()` 推進假計時器 |
| `.agents/skills/code-quality/SKILL.md` 的「測試」一節、[docs/agents/quality.md](../docs/agents/quality.md) | 測試怎麼寫、L2 |

其他文件不用讀。

## 限制

1. **可以修改**：`src/state/index.ts`、`src/state/ids.ts`、`src/core/study/history.ts`、`src/core/study/types.ts`（`History` 加一欄）、`src/core/deck/read.ts` 與 `index.ts`（多一個匯出）、`tests/`、`tools/bench-study.ts`（只在匯出改了才需要）、`docs/backlog.md`、`docs/roadmap.md`。**`src/main.ts`、`src/obsidian/` 不改**（W6 大改了這兩處，避免衝突；現在的提示方式已經夠用，見 [§6](#6-接線與提示)）。其他檔案只讀不改。
2. **不改紀錄與卡組的檔案格式**，`docs/syntax.md` 不動。`History.seen` 是記憶體裡的結果，不是檔案格式。
3. **不碰** `apply` 的改名配對、不拆 `state/decks.ts`、不加快取、不加套件（見〈排程與分支〉）。
4. **既有測試照舊通過**，唯一例外是 `tests/state.test.ts` 的「ready() 讀不到時自己重試，恢復後完成；重試中 close 會 reject」：它斷言一篇卡組讀不到時 `ready()` 不完成，和新語義相反，照 [§7](#7-測試清單) 的 S3 改寫。其他測試（含 `state-ids.test.ts` 的 I3、F3、R1、R2）**不改預期**；A1 改完它們要從公開介面照樣通過。
5. 大的資料不讀進對話；只動測試 vault（位置在 Claude 的記憶 `test-vault-location`），同一個 iCloud 資料夾裡的其他 vault 一律不動。

## 1. 介面

```ts
// src/core/study/types.ts
export interface History {
  reviews: ReviewEntry[];
  changes: ChangeEntry[];
  problems: { path: string; line: number; message: string }[];
  cancelled: string[];
  /**
   * 原始紀錄每一行出現過的 lt（作答、變更都算，被取消的也算），照字串排序、不重複。
   * 配新 ID 時避開（D-134）。壞掉的行能救回的尾段、救不回時寬鬆找到的 "lt" 字串也算：多避開幾個不會錯配。
   */
  seen: string[];
}

// src/core/deck/index.ts 多匯出
/** Essence Cards/ 底下的卡組路徑（isDeckPath），照字串排序。readDecks 與 state 都用它。 */
export function listDeckPaths(files: Files): Promise<string[]>;

// src/state/index.ts 的 State 多一個方法；其餘不變
export interface State {
  // …
  /**
   * 列出來或通知過、但最近一次讀不到的路徑（卡組與別台裝置的紀錄），照字串排序；自己隔一段時間重試。
   * 不是空的時候，補 ID、還原、當成新的都暫停（§3）。
   */
  unread(): readonly string[];
}
```

`ready()` 的註解改成：第一次列出卡組與紀錄、能讀到的都讀完、排好今天就完成；讀不到的那幾篇跳過、之後自己重試（`unread()`）。只有 `list` 失敗才整個重試；只有 `close()` 會讓它 reject。

## 2. 讀取：第一次載入和之後的變動走同一條路

### 2-1 第一次載入

`ready()` 依序：

1. 先監看（`files.watch`），和現在一樣。
2. `listDeckPaths(files)` 與 `files.list(LOG_FOLDER)`（濾 `isLogPath`）。**任一個 `list` 丟錯**才整個重試：等 `retryDelay()`（1 秒起、每次加倍、最多 60 秒）再從第 2 步重來，每次失敗交給 `onError(error, 'read')`；`close()` 會提早叫醒並 reject（現在的 `start()` 迴圈只留給這一步）。
3. 卡組的路徑一批、紀錄的路徑一批，各走 [§2-2](#2-2-一批路徑怎麼讀) 的同一個讀取函式（先卡組再紀錄，`timings.decks`、`timings.history` 照舊各計一批；第一次載入自己的紀錄也讀，之後自己的紀錄的通知仍不理，W5 §3-3）。
4. `planToday(input())`，`loaded = true`，完成。讀的期間收到的通知照舊讀完後處理一次。

`load()` 不再有自己的「列出、讀、濾 null」那段（A5）；`src/state/` 不再有 `'Essence Cards'` 字面常數。

### 2-2 一批路徑怎麼讀

現在的 `apply` 就是這個函式，改成第一次載入也用它。每個路徑 `files.read`：

- **讀到文字**：卡組照現在（和上一版比對、`tracker.observe`、更新 `deckMap`）；紀錄照現在更新來源。第一次載入時 tracker 沒有上一版，所以不會偵測弄丟（I5「ready() 時就沒有 ID 的目標不是問題」照舊成立；`observe` 的 `detect` 參數若因此沒人傳 `false`，可以拿掉）。
- **讀到 `null`**：那一篇不存在，照現在拿掉；它若在 `unread` 裡也拿掉（讀不到期間被刪掉的檔不會一直重試）。
- **讀失敗（reject）**：放進 `unread`，留在 `pending` 等重試；上一次讀到的內容（如果有）保留。卡組第一次就讀不到的，不在 `decks()`、不在今天的份；紀錄讀不到的，不在 `history`。
- 一批結束：有任何失敗就 `failures++`、`onError(第一個錯誤, 'read')` 一次、沒有別的計時在等就 `schedule(retryDelay())`；沒有失敗就 `failures = 0`。這一批讀到的照常 `rebuild`、`mergeHistory`、`replan`、`onChange` 一次（內容沒變就不重排，照舊）。
- 重試讀成功：從 `unread` 拿掉，之後和一般的檔案變動一樣處理（卡組出現 → 重排、`onChange`）。
- `close()` 之後不再重試（現在的測試「讀檔失敗後 close：不再重試」照舊）。

第一次載入和之後的變動，成功與失敗的處理必須是同一段程式；不要在 `load()` 另寫一份。

### 2-3 代價，寫在程式註解裡

有紀錄還沒讀到時，`today()` 是照不完整的紀錄排的：那幾張卡的間隔可能偏短、剛在別台裝置複習過的卡可能再出一次。紀錄恢復後會重排。這比整個外掛打不開好（使用者 2026-10-24 的取向：先讓讀到的卡組可以複習）。

## 3. ID 的安全：還有東西沒讀到時，不把「不知道」當成「沒用過」

D-134 配新 ID 要避開所有卡組與紀錄裡出現過的 ID；`unread()` 不是空的時候，占用資訊不完整。規則（Codex 在 W5 第二部分 L2 的完成條件建議，這裡定成）：

1. **`unread()` 不是空的時候**：`fillText` 回傳原文、`fillIds` 回傳 `false`（不讀、不寫）、`resolveText` 回傳 `null`（問題保留，`restore` 與 `new` 都暫停）。`deckStatus` 照常回報（家長看得到缺幾個、哪些待處理）。恢復成空之後，同樣的呼叫照常運作。
   - 代價：家長在一篇卡組還沒下載好時存檔或離開筆記，這次不補 ID，要再存一次或再離開一次（和 D-134 已列的「一直開著、忘記存檔」同一類）。寫在 `State.unread()` 的註解。
2. **讀不到期間記下的 `changed` 問題要重新核對**（Codex 第三次審查的情境：紀錄讀不到時，卡組換成那份紀錄裡的新 ID 會先被當成 `changed`）。`unread()` 不是空的時候 `observe` 記下的待處理問題標成「暫定」；當某一批結束、`unread()` 變成空時，重新核對所有暫定的問題：`changed` 的那個 ID 現在已經在 `history.seen` 裡（紀錄恢復後讀到了）就撤銷那個問題（`revision++`，那個目標回到今天的份）；`lost`、`ambiguous` 與 ID 仍沒見過的 `changed` 保留，拿掉暫定標記。紀錄一開始就讀得到時行為和現在完全相同（R2 照舊）。
3. 這些規則都在 `src/state/` 裡做（`ids.ts` 的 `Pending` 加暫定標記、`index.ts` 在 `fill`／`resolve` 前檢查 `unread`），`tracker` 的證據規則（只拿這一版和上一版的 ID 當證據）不變。

## 4. A1：紀錄的壞行救回規則只留一處

- `mergeHistory` 多回傳 `seen`（[§1](#1-介面)）：每一行 `parseLine` 成功的 `lt`（`ReviewEntry.lt`，`ChangeEntry.lt` 不是 null 時）；壞掉的行救回的尾段（現有的 `lastIndexOf('{"t":')`）的 `lt`；救不回的行用寬鬆的比對找 `"lt"\s*:\s*"…"`（把 `state` 現在的 `ltsOf` 那段搬過來，含跳脫的鍵名與字串）。排序、去重。`readHistory` 自然一樣。
- `appendLine` 把新的一行的 `lt` 加進 `seen`（保持排序、不重複）；取消的行沒有 `lt`，`seen` 不變。既有的「`appendLine` 和重新 `mergeHistory` 一致」測試（`tests/append-line.test.ts`）把 `seen` 也比進去。
- `src/state/index.ts` 刪掉 `ltsOf`、`ltCache`；`logIds()` 改讀 `history.seen`（tracker 要 `Set`，照 `history` 物件的身分快取一個）。`answer()` 之後 `seen` 已含新的 `lt`，所以行為不變。完成條件：`src/state/` 沒有 `JSON.parse` 紀錄的程式；I3、F3、R1、R2 照舊通過。
- 注意 W6 分支加了 `retry` 欄位（`parseLine` 不讀它），`seen` 不受影響；合併時不會有衝突。

## 5. A5：`load()` 不再抄 `readDecks`

`src/core/deck/read.ts` 加 `listDeckPaths(files)`（列出 `ROOT`、濾 `isDeckPath`、排序），`readDecks` 改用它；`src/core/deck/index.ts` 匯出，`tests/boundaries.test.ts` 的匯出清單加上它。`readHistory` 留給回測工具（D-105）：在 `boundaries.test.ts` 的 study 匯出清單旁註明「`readHistory`、`readDecks` 給 `tools/bench-study.ts` 與測試用，產品程式走 `state`」。

## 6. 接線與提示

`src/main.ts` 不改：`report()` 已經是「每種錯誤來源只提示一次」，讀不到時出現一次「讀不到…會自動重試」的提示、console 有每次的錯誤。`ready()` 現在會更早完成，`saver.refresh()` 照舊在完成後跑。開發命令要看 `unread()` 的話留給 W6 合併後（這次不加）。

## 7. 測試清單

Node，放在 `tests/state.test.ts`（S1～S6）、`tests/state-ids.test.ts`（S7～S8）、`tests/study.test.ts` 與 `tests/append-line.test.ts`（S9）。用記憶體 `Files` 的 `failing` 集合與假計時器；每個案例最後比對 `state.today()` 和 `planToday(state.input())` 相同。

- **S1 第一次載入一篇卡組讀不到**：`ready()` 完成；`decks()` 只有讀到的；`today()` 不含那一篇的目標；`errors` 是一個 `'read'`；`unread()` 是那個路徑。推進 1 秒：重試再讀一次，仍失敗 → `failures` 加倍（下一次 2 秒），`onError` 再一次。拿掉 `failing`、推進：讀到了，`decks()` 含它、`onChange` 一次、`unread()` 空、`failures` 歸零。
- **S2 第一次載入一份別台裝置的紀錄讀不到**：`history()` 來自讀到的；恢復後 `history()` 和 `readHistory(files)` 相同、重排一次。另一半：載入後才讀不到（既有測試「讀檔失敗：讀得到的照常處理」的情境）保留上一份內容，`unread()` 含它，恢復後照舊。
- **S3 `list` 失敗才整個重試**：`list` 丟錯（記憶體 `Files` 加一個讓 `list` 失敗的開關，或包一層）→ `ready()` 不完成、`today()` 丟錯、`onError` 一次；拿掉失敗、推進 → 完成；`state.ready()` 回同一個 Promise。重試中 `close()` → reject。這是改寫「ready() 讀不到時自己重試…」那個既有測試的內容。
- **S4 讀不到期間被刪掉**：`failing` 的那一篇在恢復前 `remove`（read 回 `null`）→ 從 `unread()` 拿掉、不再重試、沒有錯誤。
- **S5 節流與關閉**：連續失敗的等待是 1、2、4…秒，最多 60 秒；成功後歸零；`close()` 之後推進 60 秒也沒有新的 `read`（既有測試）。
- **S6 第一次載入和之後的變動一致**：同一個讀不到的路徑，一個案例在第一次載入時失敗、一個在載入後通知時失敗，兩邊恢復後的 `decks()`、`history()`、`today()`、`errors` 的來源序列相同。
- **S7 占用不完整時暫停寫入**：一篇卡組 B 讀不到（它含 ID `X`）、`random` 固定讓下一個配出的 ID 是 `X`。另一篇 A 有目標沒 ID：`fillText(A)` 回傳原文、`fillIds(A)` 回傳 `false` 且沒有 `modify`、既有的 `lost` 問題 `resolveText(…, 'new')` 與 `'restore'` 都回 `null` 且問題保留、`deckStatus(A).missing` 照報。B 恢復後：`fillText(A)` 配出的不是 `X`（避開了）、`resolveText` 照常。
- **S8 暫定的 `changed`**：紀錄 L（含 `lt: 'aaaaaa'`）讀不到；卡組的目標 ID 換成 `aaaaaa` → 一個 `changed` 問題、目標不出題。L 恢復 → 問題消失、`onChange`、目標回到今天的份。對照兩例：L 一開始就讀得到時不產生問題（R2 照舊）；L 讀不到時換成 L 裡沒有的 `bbbbbb` → L 恢復後問題仍在。
- **S9 `seen`**：`mergeHistory` 的 `seen` 含作答的 `lt`、變更的 `lt`、被取消的作答的 `lt`、跳脫鍵名的合法 JSON（F3 的例子）、寫入中斷救回的尾段（R1 的例子）、救不回的行裡寬鬆找到的 `lt`；排序、去重。`appendLine` 加一行作答後的 `seen` 和重新 `mergeHistory` 相同；加一行取消後不變。
- 既有測試全部照舊通過（限制第 4 點）。

## 8. Windows 版 Obsidian（AI 自己做）

用測試 vault 的開發版（`npm run install-vault -- <測試 vault> --dev`）驗證一次「一篇卡組被佔住」：

1. 在另一個 PowerShell 程序用 `[System.IO.File]::Open(<一篇卡組的完整路徑>, 'Open', 'Read', 'None')` 開著不關（獨占），`obsidian://essence-cards-dev?run=reload` 重載外掛。
2. 預期：外掛載入完成，其他卡組照常出現在今天的份；出現一次讀不到的提示；`run=errors` 看得到每次重試的錯誤。
3. 關掉那個 PowerShell 程序（釋放鎖），最多等 60 秒：那一篇出現在今天的份，不用再重載。
4. 若 Obsidian 的 `vault.read` 在獨占鎖下不失敗（讀到快取），寫明「Windows 做不出這個情境」並保留 Node 的測試，不硬湊。

**不要用 computer-use 截 Obsidian**（交接單 §4）；用開發命令看結果。

## 9. 明確不做

- 改名配對（環節 ①）、`state/decks.ts` 拆檔（環節 ④）、快取（I1 之後）、`unread()` 的開發命令與畫面提示（W6 合併後）。
- 紀錄讀不到時自動補回或清掉待處理（Codex：不能在未知狀態下自動配回）。
- 新的 D-ID：這一件是 W5 L2 定的 F3 行為的修正與 D-134 的落實，寫在這份說明與 backlog 就好；規則若有人反對再提。

## 自我測試

1. `npm run check` 全過（pre-commit hook 也會跑）。
2. 照 code-quality 的 L1 逐條對照「限制」與 §1～§8。
3. §8 的 Windows 驗證做過一次，結果寫在回報裡。

## 完成後

- `docs/backlog.md` 技術債：刪掉「卡組讀不到就整個重試」與 A1 兩列；A4 的拆檔那句已改到外掛架構檢查環節 ④（這份說明的〈排程與分支〉），不用另記。
- `docs/roadmap.md` 的「現在在哪裡」與「已完成」各加一句（分支、commit、測試數）。
- 寫審查請求 `tasks/state-load-review.md`，格式照分支 `claude/w6` 的 W6 審查請求 `tasks/w6-review.md`（commit `1a5d851`）。請 Codex 特別看：第一次載入與變動是不是真的同一條路；`unread()` 不是空時所有會配 ID 或還原的路徑都暫停（有沒有漏掉 `prepare` 以外的入口）；暫定 `changed` 的撤銷條件只看 `history.seen`、不自動配回；`seen` 和 `appendLine` 的一致；`close()` 後沒有殘留的計時與重試；`list` 失敗的迴圈；A5 之後 `readDecks` 的既有測試仍走公開介面。
- 回報：commit 清單、`npm run check` 的測試數、§8 的結果、有沒有停下來的點。合併由使用者決定；合併後通知 W6 的 session 把 `main` 合併進 `claude/w6`（交接單 §3 第 2 點）。
