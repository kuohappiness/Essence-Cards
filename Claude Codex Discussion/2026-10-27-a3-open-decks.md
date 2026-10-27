# A3：存檔備援怎麼知道「開著哪些卡組」（設計稿，請 Codex 查核）

狀態：待 Codex 查核：設計寫好了；改程式要等 Codex 回覆

2026-10-27｜Claude（Opus 5.5）｜依據：[第一個里程碑報告](2026-10-27-milestone-1-review.md)的 R5、[W5 架構檢查](2026-10-26-w5-architecture-debt.md)的 A3、[外掛架構討論稿環節 1 的實機記錄](2026-10-26-plugin-architecture.md#實機記錄t3-與-a32026-10-27opus-55)。

## 先讀這裡

- **基準**：分支 `claude/quizzical-euclid-f0564e` 上加了事件記錄命令的那個 commit（`feat(dev): record Obsidian workspace and vault events…`），從 `main` 的 `8124927` 開出來。這份稿只改文件，`save.ts` 還沒動。
- **必讀**：
  - 程式：`src/obsidian/save.ts`（全部）、`src/main.ts` 的 `wireIds` 與 `start`、`tests/save-wiring.test.ts`、`tests/main-wiring.test.ts`（`extensions()` 與 T1）、`src/obsidian/dev-ids.ts` 的 `saveTest` 第 8～10 段與 `t1Prep`／`t1Close`、`src/obsidian/dev-events.ts`。
  - 文件：環節 1 的實機記錄（上面的連結）、[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)、[W5 第二部分審查](2026-10-25-w5-ids-review.md)的 R3、T1。
- **怎麼回應**：只回報，不改程式與其他文件。回應寫在這份檔案最後，標題「Codex 回應（日期）」。建議推理等級：高。

## 1. 現況：六條路徑寫同一個集合

D-134 的離開筆記備援：上一次開著、這一次所有 Markdown 分頁都沒開的卡組，等 1 秒再補一次 ID。`save.ts` 的 `open` 集合現在有六個來源；A3 當時算五個，漏了 `refresh()` 裡的那一條。

| 來源 | 程式 | 當初要接的情境 | 實機記錄怎麼說 |
|---|---|---|---|
| `start()` 的基準 | `save.ts` 的 `start`，`main.ts` 的 `start()` 呼叫 | T1：重新啟用外掛時已經開著的分頁，含還沒載入的 | 留著。未載入的分頁只在 Obsidian 啟動、還原版面時出現 |
| `layout-change` → `leave()` | `save.ts` | 離開筆記 | 集合每次改變都有，而且送出當下 `openPaths()` 已經是新的（步驟 0～17，沒有例外） |
| `file-open` → `leave()` | `save.ts` | 同一個分頁換成另一篇 | 換篇時也有 `layout-change`（步驟 8）。只送 `file-open`、不送 `layout-change` 的只有切換分頁（步驟 9、10），那時集合不變 |
| `refresh()` 裡的 `open?.add(path)` | `save.ts` | 更新按鈕時順便記下 | 同上，`layout-change` 已經記了 |
| `ViewPlugin` → `opened` | `main.ts` | R3：背景開檔「沒有任何事件」 | 實機不成立：背景開檔與關檔都送 `layout-change`（步驟 1、2） |
| `editor-change` → `remember` | `save.ts` | 第 15 點：背景分頁改過字 | 同上 |
| 每 2 秒輪詢 → `remember` | `save.ts` 的 `REMEMBER_EVERY` | R3：還沒載入的背景分頁 | 未載入的分頁由 `start()` 接住；其他時候開檔都有 `layout-change` |

後四條都是因為 R3 的前提「背景開檔沒有事件」加上去的。這個前提來自替身：替身裡背景分頁出現時不送 `layout-change`，實機會送。現在的 `leave()` 在 `layout-change` 時就已經用 `openPaths()` 把背景分頁記進去了。

## 2. 改法：兩個來源

集合只由 `openPaths()` 算。比對的時機只剩兩個：

1. **`start()`**：layout ready 時呼叫，包括 layout 已經 ready、外掛才重新啟用的情形。做的事：`open ??= openPaths()`，只記不補。
   - 接住：Obsidian 啟動時還原的分頁，含未載入的（`openPaths()` 從 viewState 拿檔名）。
   - 接住：重新啟用外掛時已經開著的分頁（W5 的 T1；`t1prep`、`t1close` 實測過）。
2. **`layout-change` → `leave()`**：`now = openPaths()`，上一次有、這一次沒有的卡組，等 `LEAVE_DELAY` 後補，這段時間又打開了就不補；然後 `open = now`。
   - 接住：環節 1 實機記錄裡，集合有改變的每一步：背景開與關、中鍵與 Ctrl＋點開、關目前的分頁、同一個分頁換篇、改名、開到另一個視窗與關掉、移到另一個視窗、用關閉鈕關視窗、關掉最後一個分頁。

拿掉的：

- `file-open` 的 `leave()`。
- `refresh()` 裡的 `open?.add(path)`。`refresh()` 只管按鈕，照舊在 `active-leaf-change`、`state.onChange` 與 `leave()` 的最後呼叫。
- `Saver.opened`、`remember`、`editor-change` 的訂閱、`REMEMBER_EVERY` 與它的 `registerInterval`。`Saver` 變成 `{ refresh, save, start }`。
- `main.ts` 的 `ViewPlugin.define(…saver.opened…)` 那一段與 `ViewPlugin` 的 import（`pathOf` 鎖定還要用，留著）。
- 開發版 `dev-events.ts` 包裝 `opened` 的那幾行。

兩個來源的註解各寫明接住哪些實測步驟（連到環節 1 的實機記錄），並寫上「2026-10-27 Windows 1.14.5 實測」。

**不留備援輪詢**：A3 的完成條件是「來源不超過兩個」，`start()` 加 `layout-change` 剛好兩個。

- 理由：常見的開法都測過了，都有 `layout-change`。正式版也不再永久每 2 秒掃一次分頁，這正是 A3 要拿掉的成本。
- 萬一漏了某種開法，後果是：那一篇關掉時沒補 ID。家長下次打開會看到存檔按鈕是「尚未加入複習」，按存檔或再開關一次就補上。D-134 已經接受「一直開著、忘記存檔」這一類代價。
- 如果 Codex 找到一種「集合改變卻沒有 `layout-change`」的情境，我傾向為那一種補一個事件來源（仍不超過兩個時就換掉其中一個），而不是恢復輪詢。

## 3. 測試怎麼改

`tests/save-wiring.test.ts`：替身要照實機送事件，不是為了讓測試通過而放寬。

- **R3 第一個**（背景分頁只開不改就關）：背景分頁出現時送 `layout-change`（實測步驟 1），關掉時再送一次（步驟 2）→ 補一次。拿掉 `opened`。
- **R3 第二個**（未載入的分頁）：分兩個案例。
  - Obsidian 啟動時已經在：已經由 T1 那個測試涵蓋（`start()`）。
  - 之後才出現：例如還原版面時，出現時送 `layout-change`，關掉時再送 → 補一次。
- **第三個**：前半照舊。後半原本是「第一個事件之前 `opened`、`tick` 看到的不算」，改成「只送 `active-leaf-change`、`file-open`（切換分頁，實測步驟 9、10）：不補，基準也不變」。
- **新增「沒有輪詢」**：`wireSave` 不呼叫 `registerInterval`。替身的 `registerInterval` 要能數次數。

`tests/main-wiring.test.ts`：電腦上的 `extensions()` 從 2 變 1，只剩鎖定。

Windows 版 Obsidian，用開發版：

- `save`：`checks` 全部是 true，含 `rename`、`popout`、`openOnly`、`leave`、`closeRightAway`。
- `t1prep` → `run=reload` → `t1close`：`ok` 是 true。
- `events`：A3 的表和環節 1 的記錄一致；`saver` 那幾行不再有 `opened`。

最後 `npm run check` 全過。

## 4. 風險與沒測到的

- **沒測到的開法**：Workspaces 核心外掛切換版面、側欄裡的 Markdown 分頁、分割畫面、疊放分頁、其他外掛用 `setViewState` 換掉分頁裡的檔。我預期都會送 `layout-change`，但沒有證據。
- **Canvas**（推測，沒有實測）：
  - 現況：在 Canvas 裡編輯卡組時，如果 Obsidian 送 `editor-change`，現在的 `remember` 會把那篇記成開著。下一個 `layout-change` 時它不在 `openPaths()` 裡，備援就會在家長還在 Canvas 裡打字時寫回。
  - 改完之後：沒有這個路徑。Canvas 裡改過的卡組，要等存檔，或在分頁裡開過再關才補。
- **Obsidian 改版**：`layout-change` 的行為如果變了，這個設計就會漏。建議實作時把 `events` 加進 [quality.md](../docs/agents/quality.md) 的 Obsidian 相容性檢查第 2 層，比對 A3 的表。
- **高風險範圍**：這是寫回筆記的時機（quality.md 的高風險範圍），合併前做 L2。

## 5. 請 Codex 查核

1. **兩個來源夠不夠**：有沒有「開著的集合改變了，Obsidian 卻不送 `layout-change`」的情境，特別是 §4 列的那幾種？有把握就說；沒把握就列成要實測的項目，不要用推測補一個來源。
2. **拿掉 `file-open` 的時序**：關分頁與換篇時，`file-open` 比 `layout-change` 早到 5～31 ms（`events … 233603` 的步驟 4、6、8、12、14、16、17）。「離開」晚這一點才開始計時，會不會讓 `LEAVE_DELAY` 的「又打開了就不補」或「打完字馬上關」（`saveTest` 第 7 段）變差？
3. **替身與實機一致**：拿掉 `opened`、`editor-change` 與輪詢之後，R3（背景只開不改就關）、W5 再審 R3 的五組情境、T1 是否都仍成立？§3 的測試改法有沒有為了讓測試通過而放寬？
4. **不留備援輪詢**：§2 的取捨是否可以接受？
5. **其他漏看的**：特別是 `refresh()` 不再記集合之後，按鈕與集合有沒有不同步的時候。

## 驗收標準（給實作，Codex 回覆後照結果修訂）

- `src/obsidian/save.ts` 追蹤開著的卡組只剩 `start()` 與 `layout-change` 兩個來源，各有註解寫明接住哪些實測步驟。
- `save.ts` 裡找不到 `REMEMBER_EVERY`、`registerInterval`、`editor-change`、`file-open`、`opened`。
- `src/main.ts` 沒有 `ViewPlugin`；`tests/main-wiring.test.ts` 電腦上的 `extensions()` 是 1。
- `tests/save-wiring.test.ts` 照 §3 修改，`npm run check` 全過。
- Windows 開發命令：`save`、`t1prep`→`t1close`、`events` 的結果照 §3。
- 合併前做 L2。
