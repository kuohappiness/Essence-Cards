# 存檔的 view.save() 蓋掉剛到的外部修改：修法（請 Fable 審查，再請 Codex 查核）

狀態：💬 待審查：Fable 5.1（high）先審，Claude 核對後轉給 Codex

2026-10-29｜Claude（Opus 5.5）｜依據：[tasks/state-writes.md](../tasks/state-writes.md) §9 的 V6；[外掛架構討論稿](2026-10-26-plugin-architecture.md)環節 4〈Codex 回應：環節 4 第二輪〉第 1 點（存檔改成 `view.save()` 加核對讀取）

## 先讀這裡

- **要決定什麼**：`state-writes` 的存檔把 Editor 交易之後立刻 `view.save()`，Windows 實測會蓋掉剛寫進磁碟、Obsidian 還沒合併進編輯器的外部修改（V6）。舊流程不會。合併進 `main` 之前要修；這份稿列出修法，請審查者選或補。
- **基準**：分支 `claude/hungry-yonath-106fcb` 的 `637428d`（state-writes 實作完成、V6 對照實驗的開發命令）。這份稿也只在這個分支，隨分支合併進 `main`。
- **必讀**：
  - [tasks/state-writes.md](../tasks/state-writes.md) 的 §1、§3、§4、§7、§9（S14 的 (b) 與 V6）。
  - 外掛架構討論稿環節 4：〈Codex 回應：環節 4 第二輪〉第 1、3 點，〈Claude 回應 Codex：環節 4 第二輪〉。
  - 程式：`src/state/index.ts` 的 `admit`、`edit`、`verify`、`read` 裡的核對；`src/obsidian/save.ts` 的 `editorOf`；`src/obsidian/dev-ids.ts` 的 `saveFlow`（V6）與 `saveFlowV6`。
  - `node_modules/obsidian/obsidian.d.ts`：`TextFileView.requestSave`（「debounced by 2 seconds」）、`save`、`Vault.process`（「Atomically read, modify, and save」）。

## 1. 現象與證據

外部（測試用 `vault.adapter.write`，實際情況是另一台電腦經同步、或其他工具改檔）把帶 ID 的目標 B 加進開著的卡組；同一個 tick 做三種事之一，3 秒後看磁碟（Windows Obsidian 1.14.5，測試 vault 的結果檔 `save-flow-v6 Windows-c50c 2026-10-29 022743.json`，各 5 次）：

| 做法 | 磁碟留下 B | 自己的改動留下 | 待處理問題 |
|---|---|---|---|
| 這個分支：Editor 交易後立刻 `view.save()` | 0/5 | 5/5 | 0 |
| 舊流程模擬：只做 Editor 交易，等 Obsidian 約 2 秒後自動存 | 5/5 | 5/5 | 0 |
| 什麼都不做 | 5/5 | — | 0 |

另外 `save-flow` 的 V6（結果檔 `save-flow Windows-c50c 2026-10-29 012855.json`）：外部寫入後 50 ms、200 ms 才按存檔，B 都保留；只有同一個 tick 會蓋掉。那次的事件順序是 15816 ms 外部寫入的 `modify` → 15828 ms 我們的 `modify`。

**原因（推論，未看 Obsidian 原始碼）**：`view.save()` 取的是呼叫當下編輯器的內容；外部寫入還在進行、或已寫完但 Obsidian 還沒把它合併進編輯器時，存檔把舊內容寫回去。舊流程只改編輯器，Obsidian 2 秒後才自動存，這段時間收到外部修改會先合併（編輯器有未存內容時也合併，上表第二列），所以兩邊都留下。

**影響**：B 整段內容不見（不只是 ID），沒有任何提示，也沒有待處理問題。iPhone 不寫卡組（D-134），所以外部修改只來自另一台電腦的同步或其他工具；要剛好和按存檔撞在幾十毫秒內，機率低，但一撞上就是靜默的資料遺失。

**不能退回舊流程的理由**：舊流程的 N1（自動存檔後 500 ms 內按存檔會產生假的「遺失」）已重現（環節 4），`view.save()` 加核對讀取就是為了它。修法要同時保住 N1 與 V6。

## 2. 修法選項

### A｜不呼叫 `view.save()`，等 Obsidian 自己的自動存檔

`persist` 改成「Editor 交易之後等這篇的下一次 `modify` 事件（Obsidian 約 2 秒後的自動存檔），且磁碟出現預期的變更」，期間這篇維持「正在 I/O」，讀取照 §2 延後，所以 N1 仍擋得住。

- 好處：外部修改的合併完全交給 Obsidian，和舊流程一樣安全。
- 代價：存檔的結果至少晚 2 秒才回來（§7 說超過 500 ms 要提出，也沒有「存檔中」的狀態）；家長一直打字時 `requestSave` 一直往後延，會撞到 `writeTimeout` 變成 `failed`；這段時間後面的寫入都排著。等「下一次 `modify`」的判斷也要處理別人的寫入剛好在這時到的情況。

### D｜取文字前先等一段安靜時間

`admit` 讀完待讀之後，要求這篇（或所有卡組）最近 Q ms 內沒有新的通知，沒有就等到滿 Q ms 再查一次待讀，然後才取編輯器的文字。Q 先估 300 ms。

- 好處：改動小；同一個 tick 的外部寫入在 Q 之內會送出通知、被 Obsidian 合併進編輯器，存檔取到的就是有 B 的文字。
- 代價：每次存檔多等 Q；沒有關掉窗口，只是縮小：我們的 `view.save()` 正在寫的那十幾毫秒裡才開始的外部寫入，仍會被蓋掉（和 Obsidian 自己的自動存檔撞上外部寫入是同一類）；Q 要多大才夠，取決於 Obsidian 合併的時間，只能實測。

### H｜改用比對後才寫：`Vault.process` 確認磁碟還是讀過的那一份

state 記下每篇最近一次讀到的磁碟內容（`read` 已經有，只是沒有另外存）。`EditorHandle.persist(base)` 改成用 `vault.process(file, disk => disk === base ? 編輯器的全文 : 不改)`：磁碟還是 state 最近讀到的那一份，才把編輯器的內容寫進去；不是（有還沒讀到、Obsidian 也還沒合併的外部修改），就不寫，回 `stale`（「這篇筆記剛剛改過，請再按一次存檔」）。Editor 交易已經做了、ID 已預留；Obsidian 收到外部修改的通知後照常合併進編輯器，家長再按一次就補好。

- 好處：窗口縮到 `process` 內部讀和寫之間（同一個呼叫，不隔 await）；不必等 2 秒，也不必猜 Q；N1 照舊由 I/O 期間不讀加核對讀取擋住。
- 代價與未知：
  1. 要實測 `vault.process` 讀的是磁碟的現況，而不是 Obsidian 的快取（它說 atomically，但外部寫入不經過 vault，我們不確定它怎麼讀）。
  2. 用 `process` 寫開著的檔，Obsidian 怎麼對待這個分頁（編輯器內容和寫進去的相同時應該沒事，但編輯器仍是「有未存內容」，2 秒後的自動存檔會再寫一次相同內容）要實測。
  3. `base` 的來源：自動存檔剛寫完、通知還沒到時，`base` 是舊的，這次會回 `stale`、要再按一次（假陽性；比蓋掉好）。
  4. `EditorHandle` 的 `persist` 簽名要改，§1 的介面跟著改；`editor.save()` 的「寫不進去就 reject」語義保留。
  5. 已經 `apply` 了才發現不能寫：編輯器帶著預留的 ID，和 V7 寫入失敗的情況相同（state 不改回編輯器）。

### 其他想過、不推薦的

- **不改編輯器，改用 `vault.process` 改磁碟、讓 Obsidian 把變更合併進編輯器**：家長剛打、還沒自動存的目標不在磁碟上，這次補不到；游標、Undo 的行為也和 W5 §8-2 第 4 點選 Editor 交易的理由相反。
- **存完才偵測**：存檔期間看到別的 `modify` 就知道撞了，但 B 已經被蓋掉，要還原得自己保存一份外部內容，複雜而且仍不完整。

## 3. Claude 的建議

**H**，必要時加一個很短的 D（例如 100 ms）擋住「外部寫入正在進行、通知還沒到」的情況，看 H 的實測結果再決定要不要。理由：A 的 2 秒延遲和一直打字時的逾時，對家長的體驗代價最大；D 只縮小窗口、Q 要猜；H 把窗口縮到最小、撞上時的結果是「請再按一次」而不是遺失，而且和現有的 `stale` 提示一致。

驗收（實作時再寫進任務說明）：Node 的 S14 (b) 改成斷言 B 保留、結果 `stale`；`save-flow-v6` 的 new 那一列要 5/5 保留 B，另外加外部寫入後 0、10、20、30 ms 才按的情境；`save-flow` 的 V1～V7 與 `save`、`lock`、`a3check` 重跑結果不變；N1（V2）仍 0 問題。

## 4. 請審查者回應

1. 原因的推論（`view.save()` 取呼叫當下的內容、Obsidian 的合併來不及）有沒有更好的解釋或反例？需要補什麼實驗才算確定？
2. A、D、H 的比較有沒有漏掉的代價或更好的第四個做法？特別是 H 的第 1、2 點，有沒有已知的 Obsidian 行為可以先判斷？
3. H 的 `base` 用 state 最近讀到的磁碟內容，有沒有會蓋掉外部修改、或一直回 `stale` 的時序？
4. 這個修法改的是 §1 的 `EditorHandle` 與 §3 第 5 步；和環節 4 已談定的規則（排成一列、先讀完待讀、核對讀取）有沒有衝突？
5. 要不要等環節 5（Obsidian 接線層）一起談，還是在 `state-writes` 合併前修？Claude 認為合併前修，因為現在的分支比 `main` 多了一個靜默遺失的情境。
