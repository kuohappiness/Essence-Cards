# 雲端佔位檔：分段實測與存檔受阻的提示（給 Claude，本機執行）

狀態：進行中：等開工

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)：做法已在 D-154 與這份說明定好，這裡是照做與量測）。

這是 [D-154](../docs/decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測) 第 2 點的「存檔受阻時當下說清楚」與第 3 點的實測。為什麼現在：使用者把雲端佔位檔列為 v1 第一優先（2026-10-29）；家長按存檔沒反應、新目標默默沒加入複習，現在就會發生。背景與 Codex 的查核見[討論稿](<../Claude Codex Discussion/2026-10-29-icloud-placeholders.md>)，**只讀〈Codex 回應〉的第 1、5 節與〈Claude 回應〉**，其他是過程。

## 排程與分支

- 分支 `claude/icloud-placeholders`，從 `main` 開；在本機用 `git worktree add ../Essence-Cards-icloud -b claude/icloud-placeholders main` 開在旁邊，**不要在原資料夾切換分支**。
- 兩部分可以分開 commit：第一部分（實測）只加開發命令，第二部分（提示）改正式程式。第二部分不等第一部分的結果。
- 合併由使用者決定。第二部分只改提示文字、不動寫回筆記的函式，做 L1；若為了判斷受阻在 `State` 加了查詢，照 [quality.md](../docs/agents/quality.md) 算跨模組的改動，合併前加做 L2。

## 基準與開工條件

- 基準是這份說明所在的 commit：`git log -1 --format=%h -- tasks/icloud-placeholders.md`。開工前 `git diff <那個 commit> -- docs/decisions.md tasks/state-load.md src/obsidian/save.ts src/state/index.ts` 看有沒有改過；有改以新版為準，並在回報註明。
- 這份說明沒寫到、做了又很難收回的，停下來問使用者。

## 必讀範圍

| 讀什麼 | 為什麼 |
|---|---|
| D-154、[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護) | 要做的事與存檔按鈕的規則 |
| [tasks/state-load.md](state-load.md) §2、§3 | 讀不到時怎麼跳過、為什麼暫停補 ID |
| 討論稿〈Codex 回應〉第 1、5 節、〈Claude 回應〉 | R1～R4 的事實修正、每項實測要注意的地方 |
| `src/obsidian/save.ts`、`src/obsidian/files.ts`、`src/obsidian/dev.ts`、`src/dev/wrap-files.ts`、`src/state/index.ts` 的 `unread`／`writable`／`deckStatus`、`src/core/study/log.ts` | 要改或要用的程式 |
| `tests/save-wiring.test.ts` | 第二部分的測試怎麼寫 |
| `.agents/skills/code-quality/SKILL.md` 的「測試」一節、[試作場說明](../experiments/README.md)的〈AI 怎麼測〉 | 測試寫法；Windows 版 Obsidian 的操作方式 |

其他文件不用讀。

## 限制

1. **可以修改**：`src/obsidian/save.ts`、`src/obsidian/dev.ts` 與新的開發命令檔（例如 `src/obsidian/dev-cloud.ts`）、`src/main.ts`（只在要把「讀完了沒」交給存檔按鈕時）、`tests/`、`docs/backlog.md`、`docs/roadmap.md`、這份說明。`src/state/` 只允許加一個唯讀的查詢（見 [§2](#2-第二部分存檔受阻時當下說清楚)），不改讀取、重試、補 ID 的行為。其他檔案只讀不改。
2. **不改檔案格式**，`docs/syntax.md` 不動；不加套件。
3. **實測只動測試 vault**（位置在 Claude 的記憶 `test-vault-location`），而且只動 vault 根目錄新建的 `Essence 佔位檔/` 裡、自己編的檔；不碰 `Essence Cards/`、別的 vault 與使用者開著的 Obsidian 視窗。做完把屬性還原（不再是佔位檔、釘選狀態回到開工時），結果檔留在 `Essence 佔位檔/結果/`，不進 repo。
4. **要先問使用者**：結束 iCloud 程式（這台電腦的 iCloud 同步會停幾分鐘）；關掉使用者開著的 Obsidian。沒得到同意就跳過那一項，回報寫明。
5. 開發命令只在開發版建置（`DEV`）裡；正式建置不含（`tests/build.test.ts` 照舊通過）。**不要用 computer-use 截 Obsidian**；用開發命令與 PowerShell 看結果。

## 1. 第一部分：Windows 分段實測

每一項先寫要回答的問題；回答不了的不做。做法的細節（命令怎麼分、URI 帶什麼參數）自己決定。每一項的共同要求：

- **每次讀之前重新做出佔位狀態並確認**：`attrib +U -P` 只是要求，要用 `(Get-Item …).Attributes` 確認有 `RecallOnDataAccess`（或 `Offline`）才算數；確認不到時，請使用者在檔案總管對那個檔按右鍵「釋放空間」，仍不行就停下回報。第一個讀取可能已經把檔下載下來，**不能同一個佔位狀態連讀幾種 API 再比較**。
- 測試檔是自己編的已知內容（中英文混合、有一行 emoji），記下原始的位元組數與 SHA-256；每次讀到的結果都比全部位元組，不能只看有沒有拋錯。
- 每次讀取記：結果（回傳內容、`null`、拋錯、等到觀察期限仍沒回來）、花了多久、錯誤的 `code`／`errno`／`syscall`／`message`。觀察期限 120 秒；到期仍沒回來就記「未完成」，不當成已取消。

| 順序 | 編號 | 要回答的問題 | 做法 |
|---|---|---|---|
| 1 | E0 | 開工時的狀況 | 只讀不改：Windows、Obsidian、iCloud 的版本；測試 vault 的實際路徑與同步根目錄；vault 資料夾與 `.obsidian` 的屬性（釘選或沒釘、內容在不在本機）；儲存空間感知有沒有設雲端內容；vault 的大小（用列檔與檔案大小算，不讀內容，免得把佔位檔下載下來） |
| 2 | W1 | **追加寫入**：佔位檔被追加一行後，舊內容還在、新行剛好一次嗎？ | 在 `Essence 佔位檔/寫入/` 用 `scopedFiles` 建一個 `createLogWriter`，先寫兩行、`flush`；做成佔位檔後寫第三行、`flush`；比對前兩行的位元組沒變、第三行剛好一次。同一個月再追加一次，結果一樣 |
| 3 | E2 | iCloud 正常時讀佔位檔：成功嗎、多久、內容對嗎？ | 分別用 `Files.read`（`vault.read`）、`vault.adapter.readBinary`、Node 的 `fs.promises.stat`，各在一個新的佔位狀態上做；`.md` 與 `.jsonl` 各一份。`stat` 之後再看一次屬性，記下它有沒有觸發下載，以及 `size`、`blocks` 的值（只記錄，不當成判斷方法） |
| 4 | E3 | iCloud 下載不了時：錯誤是什麼？會不會讀成空白、少一截，或一直不回來？ | **先問使用者**，同意後結束 iCloud 程式；先確認真的下載不了（例如 PowerShell 讀另一個佔位檔失敗），再照 E2 做一次。再做 W1 的變化：寫第三行失敗 → 作答留在記憶體 → 重開 iCloud → `flush` → 第三行剛好一次 |
| 5 | E5 | 整個外掛卡住與恢復的樣子 | 和 E3 同一段時間，對**一份只在 `scopedFiles` 底下的測試 state**（不是外掛正在用的那一個）：第一次載入就讀不到、載入後才讀不到、恢復後內容相同與不同，各一次；記 `ready()` 有沒有完成、`unread()`、`onChange` 的次數、從 iCloud 重開到讀到花了多久 |
| 6 | E4 | Obsidian 自己會不會把 `.md` 佔位檔下載下來？`.jsonl` 呢？ | 先在測試 vault 停用 Essence Cards，做一篇測試卡組與一份 `.jsonl` 的佔位檔，等 Obsidian 重建索引（重開 vault 前先問使用者），看屬性；再啟用外掛對照 |
| 7 | E7 | 開發時常碰到的是哪個程式讀失敗？ | 同一種佔位狀態，Obsidian（開發命令）與 PowerShell（`Get-Content -Raw`）各讀一次，每次前重新做出佔位狀態；需要時再加 Claude Code 的讀檔 |

E1、E6、E8（要 iPhone 寫入或操作）已列進 [backlog 的下一次 iPhone 實機測試](../docs/backlog.md#v1-需要做的任務)，這裡不做。

## 2. 第二部分：存檔受阻時當下說清楚

D-154 第 2 點第一項。「受阻」是指：這台電腦會補 ID（`fillIds` 開著），但外掛**還沒讀完**（`ready()` 還沒完成）或 **`unread()` 不是空的**。

1. **按存檔時**：受阻、而且編輯器裡的文字有沒有 ID 的學習目標（用 `parseDeck` 數），提示 `TIPS.blocked`：「筆記已自動儲存；暫時無法把新目標加入複習，讀取完成後請再按一次存檔」。受阻但沒有缺 ID 的目標時不提示。不受阻時照舊。
2. **按鈕說明**：受阻期間存檔按鈕的說明一律用同一句（外觀照舊）；不能再出現「學習目標都已加入複習」。讀取恢復後，下一次更新按鈕時回到原本的說明。`unread()` 變空時可能沒有 `onChange`（討論稿 Codex 回應的 P4），所以說明可能晚到切換分頁時才更新；按下去那一刻的判斷一律以當下為準。
3. **待處理問題的小視窗**：受阻期間按「還原原本的進度」或「當成新的學習目標」，提示同一句，不說「這篇筆記剛剛改過」（現在 `resolveText` 在受阻時回 `null`，`choose` 會誤報 `TIPS.stale`）。
4. **離開筆記的備援**：照舊不補、不提示（按鈕仍醒目，下次打開會看到）。
5. **怎麼判斷受阻**：優先用現有的公開介面（`state.unread()`，加上存檔按鈕自己記下 `ready()` 有沒有完成）；若一定要在 `State` 加查詢，只加一個唯讀的方法、註解寫清楚它等於 `fillText` 會不會補，並照〈排程與分支〉做 L2。

測試（`tests/save-wiring.test.ts`，只透過公開介面）：

- **B1** `unread()` 不是空、文字有缺 ID 的目標：按存檔不改字，提示是 `TIPS.blocked`，按鈕說明是同一句；恢復後再按，補上 ID、提示「N 個學習目標已加入複習」。
- **B2** 還沒 `ready()`：同 B1；`ready()` 完成後再按照常補。
- **B3** 受阻但所有目標都有 ID：不提示。
- **B4** 受阻時在小視窗按「還原」與「當成新的」：提示 `TIPS.blocked`，不是 `TIPS.stale`；問題保留；恢復後照常。
- **B5** 不受阻時的既有測試全部照舊通過，不改預期。
- 在 Windows 版 Obsidian 用 E3 的同一段時間（或用 state-load §8 的獨占鎖做出讀不到）實際按一次存檔，看提示與按鈕說明；結果寫進〈結果〉。

## 自我測試

1. `npm run check` 全過（pre-commit hook 也會跑）。
2. 照 code-quality 的 L1 逐條對照「限制」與 §1、§2。
3. 第一部分每一項都有結果，或寫明沒做的原因（例如使用者沒同意結束 iCloud）。

## 完成後

- 在這份說明最後加〈結果〉：每一項一段，寫數字與結論，結果檔的檔名；能回答 D-154 第 4 點的兩件事時明講：
  - 有沒有讀取一直不回來（E2、E3、E5）。有的話，在 [backlog 技術債](../docs/backlog.md#技術債)加一列「讀取的等待上限」（改 `src/state/`，高風險、L2），寫觸發點與完成條件，並在回報提醒使用者。
  - 有沒有讀成空白或少一截（E2、E3）。有的話同樣加一列「讀到不完整內容的防線」，寫實際回傳的樣子。
  - W1 若舊內容不見或新行重複，**立即停下回報使用者**：這會讓作答遺失或重複，比其他項都急。
- E7 的結果若說明開發時讀不到的是開發工具不是 Obsidian，寫一句給開發流程的建議（例如測試 vault 設成永遠保留），放在回報裡，由使用者決定要不要寫進 `docs/agents/quality.md`。
- `docs/roadmap.md` 的「現在在哪裡」更新那一列，「已完成」加一句（分支、commit、測試數）。
- 回報：commit 清單、`npm run check` 的測試數、每一項實測的結論、有沒有停下來的點。合併由使用者決定。
