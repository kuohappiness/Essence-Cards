# 卡組讀不到就跳過那一篇：L2 獨立審查（給 Codex）

狀態：實作完成待審

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（`src/state/` 的讀取失敗語義、ID 的安全、`History` 多一欄，三件互相牽動）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)、[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)，`main` 上的[任務說明](state-load.md)（Fable 2026-10-27 寫）由 Claude（Opus 5.5）實作。這一批改了外掛資料狀態的失敗語義、配 ID 的條件與複習紀錄模組的回傳值，屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-state-load`，分支 `claude/state-load`，沒有未提交的修改。
- 從 `main` 的 `abaa6540ffaf4bd1043c0dbd9aaaa4bbfba04090` 開出。commit（由舊到新）：
  - `cdcb45aff6016eeff8f1579aed4241b00be3d11a`：cherry-pick W6 的 `2ea31fb`（技術債 A9：記憶體 `Files` 與 Obsidian 替身），照任務說明〈排程與分支〉；W6 的 L2 已經看過，不用重審。
  - `051dcc4f3cd6aa40b962b4fee8bfabfb40199344`：**這次的實作**（任務說明 §1～§7 與 backlog）。訊息寫了做法。
  - `d2abe6b`：把 `main` 合併進來（只有文件）；`docs/backlog.md` 的衝突留 `main` 改寫的 A2 與新的 T2、T3，加這一件的收尾列。
  - 這份請求的 commit。
- **看實作用 `git diff cdcb45a 051dcc4`**；看整個分支相對 `main` 用 `git diff main...claude/state-load`（含 cherry-pick 與這份請求）。

## 規格與優先順序

- 主要規格：`main` 上的 [tasks/state-load.md](state-load.md) §1～§9 與它的「必讀範圍」、「限制」。基準（說明所在的 commit）是 `b2f3f84`；開工時核對過，`docs/backlog.md`、`docs/decisions.md`、`tasks/w5.md` 在那之後沒有改。之後 `main` 改了 backlog（A2、T2、T3）與 decisions（D-141 文件架構），和這份規格無關。
- 依據：[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)、[W5 說明 §3-1～§3-3、§8-5](w5.md#3-外掛的資料狀態)，以及你在 W5 第二部分 L2 寫的〈`ready()` 全部重試的技術債評估〉與〈紀錄讀取失敗與相鄰行為〉（[報告](<../Claude Codex Discussion/2026-10-25-w5-ids-review.md>)）。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## 請特別看

照任務說明〈完成後〉：

1. **第一次載入與之後的變動是不是真的同一條路**：`src/state/index.ts` 的 `read(paths)`；`load()` 只列出路徑、把卡組一批、紀錄一批交給它（排在 `processing` 上），`apply()` 把 `pending` 交給它。成功、失敗、`null`、`unread`、`failures`、重試排程都只在 `read` 裡。
2. **`unread()` 不是空時，所有會配 ID 或還原的路徑都暫停**：`writable()` 擋 `prepare`（`fillText` 與 `fillIds` 的 modify 回呼）、`fillIds`（modify 之前，不讀不寫）、`resolveText`。請找有沒有漏掉的入口（`tracker.fill`、`tracker.resolve` 以外會寫 ID 或把 ID 當成沒用過的地方）。
3. **暫定 `changed` 的撤銷條件只看 `history.seen`、不自動配回**：`src/state/ids.ts` 的 `provisional` 與 `confirm()`；`read` 的尾端在 `unread` 變成空時呼叫。
4. **`seen` 和 `appendLine` 的一致**：`src/core/study/history.ts`；`tests/append-line.test.ts` 的 200 組隨機性質測試多比 `seen`。
5. **`close()` 之後沒有殘留的計時與重試**：`read` 在讀完後看 `closed` 就不排重試；`close()` 清掉計時、叫醒列不出來時的等待。
6. **`list` 失敗的迴圈**：`start()`；只有它整個重試，`close()` 會讓 `ready()` reject。
7. **A5 之後 `readDecks` 的既有測試仍走公開介面**：`tests/state.test.ts` 第一個測試；`listDeckPaths` 加進 `tests/boundaries.test.ts` 的匯出清單。

## Claude 自己選了做法的地方（請逐點回覆）

1. **自己的紀錄第一次讀不到（規格沒寫到）**：通知不理自己的紀錄（W5 §3-3），所以它只會在第一次讀不到之後的重試再讀；讀到之前作答的行只在記憶的來源裡（可能還沒寫進檔，寫入也可能同樣失敗）。重讀成功時把**讀到的內容接上記憶裡的那幾行**，重複的由 `mergeHistory` 去掉；讀到 `null` 時保留記憶裡的行。不這樣做，恢復時 `history` 會少掉那幾筆作答（已用測試確認）。測試：`tests/state.test.ts` 的「S2 自己的紀錄第一次讀不到」（寫進檔、寫不進檔兩種）。
2. **`failures` 只在沒有讀不到的路徑時歸零**：第一次載入的紀錄那一批讀成功時，卡組那一批讀不到的還在，等待不歸零（否則 S1 的加倍不成立）。之後的每一批都包含所有讀不到的路徑（它們留在 `pending`），所以「這一批沒失敗」和「`unread` 是空的」一致。
3. **第一次載入的兩批排在 `processing` 上**（`queue`）：重試的計時在讀紀錄那一批時到了，也等它讀完才跑，不會兩批同時改狀態。批次裡程式的錯（不是讀檔失敗）會讓 `ready()` reject，同時經過 `onError(…, 'read')`；規格「只有 `close()` 會讓它 reject」我理解成讀檔失敗的情況。
4. **第一次載入兩批都有讀不到的**：各算一次失敗，`onError` 兩次、下一次等 2 秒。
5. **第一次載入期間收到的通知**：記一個旗標，完成後照 `delay` 排一次（取代讀不到的重試計時，和載入之後「新的通知搶先」相同）。舊的做法是看 `pending` 是不是空的，現在讀不到的路徑也在 `pending` 裡，所以改用旗標。
6. **`seen` 的寬鬆比對套在所有壞掉的行**，包括救得回的：規格的註解寫「救不回時寬鬆找到的」，但 F3 的既有測試要避開救回那一行**前半段**的 `lt`。另外，取消的行即使多帶一個 `lt` 欄位也不算（規格只列作答與變更；舊的 `ltsOf` 會算），我們的寫入不會產生這種行。
7. **兩個資料夾一起列出，再讀兩批**：`timings.decks` 包含兩次列出的時間。
8. **暫定標記**：`unread` 不是空時新找到的問題都標暫定（包括第一次載入的 `ambiguous`），照規格只有 `changed` 會被撤銷；`confirm()` 在每一批結束、`unread` 是空時跑，沒有暫定的就只是走一遍。
9. **規格只撤銷「ID 出現在紀錄裡」的暫定 `changed`**：如果換成的 ID 其實在一篇當時讀不到的**卡組**裡，讀到之後問題仍在（完整資訊時不會有這個問題，那是重複 ID）；同樣，暫定的 `lost` 在弄丟的 ID 出現在當時讀不到的卡組後也保留。照規格做，請確認這個取捨。
10. `observe` 的 `detect` 參數保留（`ids.ts` 內部自己寫回時傳 `false`）；`tracker` 改成 `const`（只有列出才重試，任何一批都還沒讀之前不會重來）。
11. **既有測試的修改**：S3 改寫「ready() 讀不到時自己重試」那一則（規格限制第 4 點）；`tests/study-io.test.ts` 一個 `readHistory` 的空結果字面值加 `seen: []`（`History` 多一個必填欄位，預期不變）；`tests/state-ids.test.ts` 的 `setup` 多一個「一開始就讀不到的路徑」參數、記下 `modify` 的呼叫；`tests/helpers/memory-files.ts` 多 `control.failList`。
12. **backlog**：刪掉兩列，加一列收尾（`unread()` 的開發命令、`main.ts` 的舊註解、§8 沒做的 Windows 驗證），觸發點是 W6 合併 `main` 之後在 Windows 重跑時。

## 行為與風險

- 公開介面的改動：`State.unread()`；`State.ready()` 的語義（讀不到的跳過，只有列不出來才整個重試）；`History.seen`；`src/core/deck/index.ts` 多匯出 `listDeckPaths`。`src/main.ts`、`src/obsidian/` 沒有改（規格限制第 1 點）。
- 不可破壞的性質：
  - 第一次載入和之後的變動，同一個路徑讀不到又恢復，`decks()`、`history()`、`today()`、`onError` 的來源序列相同（S6）。
  - 讀得到的卡組不被讀不到的擋住；讀不到的保留上一次讀到的內容；讀到 `null` 的從 `unread` 拿掉、不再重試。
  - 等待 1、2、4…秒、最多 60 秒，都讀到後歸零；`close()` 之後不再讀。
  - `unread()` 不是空時，不配新 ID、不還原、不當成新的；`deckStatus` 照常。
  - 依序 `appendLine` 和重新 `mergeHistory` 的 `seen` 相同；`src/state/` 沒有 `JSON.parse` 紀錄的程式、沒有 `'Essence Cards'` 字面常數。
  - 既有的 I3、F3、R1、R2 不改預期照樣通過。
- 測試：S1～S6 與自己的紀錄那一則在 `tests/state.test.ts`，S7、S8 在 `tests/state-ids.test.ts`，S9 在 `tests/study.test.ts` 與 `tests/append-line.test.ts`。每一則都先看過失敗：S1～S6 在舊程式上卡住（`ready()` 不完成）或丟錯；S7、S8 與自己的紀錄那一則是實作後才寫的，暫時拿掉 `writable()` 的 `unread` 檢查、`confirm()` 的呼叫、自己紀錄的接續時各自失敗，再放回。
- 請自己找新的組合，例如：
  - 卡組讀不到的同一批裡另一篇改名（`gone` 配對）；讀不到的那一篇在讀不到期間被改名。
  - 列不出來的重試期間收到通知；第一次載入讀卡組那一批時 `close()`。
  - 暫定的 `changed` 在紀錄恢復前又被改了一次（保留下來的那一筆帶著暫定標記）；紀錄恢復了但另一篇卡組仍讀不到（`confirm()` 還不跑），之後卡組也恢復。
  - `fillIds` 的 modify 進行中，另一批讀檔失敗；`resolveText` 的小視窗在讀不到之前打開、之後按下。
  - 自己的紀錄讀不到期間作答後又取消；讀到的檔最後一行是寫一半的。

## 驗證方式

- Node 24 以上（Claude 用 v24.13.0）。在 worktree 裡：`npm ci`、`npm run check`。
- Claude 跑過：`npm run check` 全部通過（383 個測試；cherry-pick 之後、改程式之前的基準是 369 個）。pre-commit hook 在 `051dcc4` 也跑過一次。
- **§8 的 Windows 驗證沒做**：開工時 W6 的 session 正在用同一個測試 vault 跑畫面測試（它的開發版建置裝在那裡、02:22 還在截圖），換成這個分支的建置會打斷它；規格提到的 `run=errors` 命令也只在 `claude/w6` 上。只做了檔案系統這一層：在暫存資料夾讓另一個 PowerShell 程序以 `FileShare.None` 開著一個檔，Node 的 `readFile`（Obsidian 桌面版 `vault.read` 底下的讀法）失敗、錯誤碼 `EBUSY`，放開後讀得到。外掛在 Obsidian 裡的表現記進 backlog，等 W6 合併 `main` 之後在 Windows 重跑時做。
- **和 W6 合併時**：預期 `tests/boundaries.test.ts` 的 deck 匯出清單那一行衝突（W6 加 `baseForm`、這裡加 `listDeckPaths`），文件也可能衝突。`History` 多了必填欄位，用 `git grep` 查過 `claude/w6`：只有 `history.ts` 與 `state/index.ts` 自己建 `History` 的字面值，畫面沒有。
- 沒跑：Windows 版 Obsidian（上面的原因）、iPhone（W6 的 §7）。

## 回報

寫在主資料夾的 `Claude Codex Discussion/2026-10-27-state-load-review.md`（不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 「請特別看」的 7 點逐點寫結論；「Claude 自己選了做法的地方」的 12 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。
