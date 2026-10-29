# 雲端佔位檔：分段實測與存檔受阻的提示（給 Claude，本機執行）

狀態：完成：兩部分都在分支 `claude/icloud-placeholders`，合併由使用者決定（結果在文末）

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

## 結果

### 第一部分：Windows 分段實測（2026-10-29，Opus 5.5）

基準 `1d8afec`，開工時「基準與開工條件」列的四個檔都沒改過。開發命令在分支 `claude/icloud-placeholders`：`dc19afa`（`cloud-read`、`cloud-write`、`cloud-state`、`cloud-late`）、`6f748d1`（URI 參數改叫 `target`，見〈其他觀察〉）、`78e7687`、`4dbb3bf`（測試 state 與寫入可以同時開幾份）。結果檔在測試 vault 的 `Essence 佔位檔/結果/`，下面只寫命令與時間，全名是「`<命令> Windows-c50c 2026-10-29 <時間>.json`」。佔位狀態一律用 `attrib -P +U` 做出，讀之前確認有 `RecallOnDataAccess`（`0x501620`）；每次讀之前重新做出。測試檔是自編的已知內容（中英混合、有 emoji 行），比全部位元組（長度與 SHA-256）。

**D-154 第 4 點的兩件事**：

- **讀取會不會一直不回來**：Windows 上不會「一直」，但會卡 60 秒。iCloud 剛重新開啟、還沒準備好時，一個讀取卡了整整 60 秒，最後以 `File system operation timed out.`（沒有 `code`）失敗（E5）。原因在 Obsidian 1.14.5 的 `FileSystemAdapter`：讀、寫、追加、`process`、`stat` 全部排成一列、一次一個，60 秒內沒有新的操作開始，就中止目前那個。所以卡住的那 60 秒，Obsidian 所有的檔案操作都在等（包括編輯器存檔與外掛寫紀錄；那段時間開發命令連結果檔都寫不出來），外掛自己加讀取上限在電腦上沒有用。iCloud 完全沒在跑時不會卡：5～6 ms 就失敗（E3）。iPhone 的 adapter 不同，未測。已在 [backlog 技術債](../docs/backlog.md#技術債)加「讀取的等待上限」。
- **會不會讀成空白或少一截**：E2、E3 都沒有（讀到的全部位元組正確，或直接失敗）。但 W1 的重現看到一種錯讀：檔案在本機有沒上傳的內容時被釋放空間，重新下載後第一次 `Files.read` **成功回傳 267 bytes：前 178 bytes 正確，後面 89 bytes 全是 0**（`cloud-read 161935`），5 秒內檔案自己變成雲端的 178 bytes。已在技術債加「讀到不完整內容的防線」。

**E0 開工時的狀況**（只讀不改）：Windows 11 Home 26300、iCloud 15.10.39、Obsidian 1.14.5（安裝程式 1.8.9）。iCloud 雲碟的同步根目錄是 `D:\【Golly】\iCloudDrive`，測試 vault 在它底下。vault 資料夾、`.obsidian`、`Essence Cards/`、`紀錄/` 都是「永遠保留」（`0x80410`），4,539 個檔、約 274 MB 全在本機（有 45 個 T4 的檔同時帶保留與不保留旗標；兩個 `workspace` 舊檔沒有保留）。儲存空間感知開著，雲端內容 30 天沒用就改成只在雲端（iCloud 雲碟也套用）。找不到 Windows「自動下載檔案」的封鎖設定。

**W1 追加寫入**：

- iCloud 正常時：佔位檔被追加一行，舊的兩行位元組不變、新行剛好一次（`flush` 681 ms，`cloud-write 143046`）；同一個月再追加一次一樣（992 ms，`143112`）。之後釋放空間再下載，雲端也是完整的 4 行。
- **iCloud 沒在跑時追加的一行不會上傳**（第一次發現時照「完成後」停下回報，使用者選先重現）。在 iCloud 停著時用 `vault.append` 追加，Windows 不把檔案標成有變更（同步狀態一直是「已同步」），iCloud 重開 10 分鐘也沒上傳；之後這台電腦**再追加一次**（iCloud 開著），整個檔連漏掉的那行一起上傳（重現 B，`161029`）。沒有再追加、檔案又被釋放空間時，那一行就沒了，重新下載的第一次讀取是上面那種尾巴補零的內容（重現 A 兩次，`160457`、`161652`）。同一段時間用整篇改寫的 `.md`（C）會標成「等待上傳」，iCloud 重開後約 150 秒正常上傳。
- 使用者 2026-10-29 選「不改程式」：機率低（要 iCloud 沒在跑時電腦寫紀錄，而且那個月之後電腦沒再寫），後果多半是 iPhone 晚看到或看不到電腦寫的行；D-154 的「保持下載」擋住本機遺失。說明書安裝章那一步多寫一句「電腦的 iCloud 要開著」，backlog 技術債記一列，下一次 iPhone 實機測試的 E8 加一項。整篇改寫雖然會上傳，但 Obsidian 的整篇寫入是先清空再寫，寫到一半當掉會讓整個月的紀錄受損，所以不當成解法。
- iCloud 停著時寫入本機已下載的檔不會失敗（`flush` 2 ms）；要寫的檔是佔位檔、iCloud 又停著時寫入失敗、作答留在記憶體再 `flush` 的變化沒做成：準備好的佔位檔在停 iCloud 前又被下載回來（見〈其他觀察〉），之後這一項被上面的遺失取代。

**E2 iCloud 正常時讀佔位檔**：

| 檔案 | `Files.read`（`vault.read`） | `vault.adapter.readBinary` | Node `fs.promises.stat` |
|---|---|---|---|
| `.md` 2,026 bytes | 755 ms，全部位元組正確，讀完下載回本機（`150055`） | 694 ms，正確（`150102`） | 1 ms，不觸發下載；`size` 2026、`blocks` 0（`150104`） |
| `.jsonl` 267,877 bytes | 829 ms，正確（`150106`） | 832 ms，正確（`150111`） | 0 ms，不觸發下載；`size` 正確、`blocks` 0（`150113`） |

第一次跑 E2 時開發命令沒有執行（URI 參數叫 `path`，見〈其他觀察〉），不是讀取卡住；改名後重跑的才是上表。

**E3 iCloud 下載不了時**（15:06 結束所有 iCloud 程序；PowerShell 讀另一個佔位檔失敗：「雲端檔案提供者意外結束。」）：`.md` 與 `.jsonl` 的 `Files.read`、`readBinary` 都在 5～6 ms 內失敗，`code: UNKNOWN`、`errno: -4094`、`syscall: read`、`message: UNKNOWN: unknown error, read`（`150655`～`150708`）；`stat` 照常成功、大小正確。沒有卡住、沒有讀成空白。失敗的讀取會清掉檔案的「不保留」旗標，檔案仍是佔位檔。

**E5 整個 state 卡住與恢復**（和 E3 同一段時間，測試 state 讀 `Essence 佔位檔/state/` 的一篇卡組與一份別台裝置的紀錄）：

- 第一次載入就讀不到（slot a，`150802`）：`ready()` 13 ms 完成，兩個檔都在 `unread()`，0 篇卡組。
- 載入後才讀不到（slot b，先在讀得到時載入，再送變動通知，`150801`）：兩個檔都進 `unread()`，原本讀到的內容保留（1 篇卡組、1 筆作答）。
- 恢復（15:08:22 重新開啟 iCloud，馬上改寫那份紀錄）：內容不同的紀錄 0.36 秒就經 Obsidian 的檔案通知讀到，兩份 state 都變成 2 筆作答。內容相同的卡組靠重試：slot a 在 +108 秒（`151015`）、slot b 在 +152 秒（`151057`，它的重試間隔已到 60 秒）。iCloud 從重新開啟到檔案讀得到約 108 秒。slot b 的一次重試在 +32～+92 秒卡住，就是上面那 60 秒。
- slot b 恢復時**沒有觸發 `onChange`**（內容和讀不到之前相同），討論稿 P4 說的情況在實機上出現了。

**E4 Obsidian 自己會不會把佔位檔下載下來**（停用 Essence Cards、關掉再打開 Obsidian；做成佔位檔後先在 Obsidian 關著時觀察 60 秒，都沒變）：

- Obsidian 沒見過的新 `.md`：啟動後 3 秒內被 Obsidian 讀了、下載回來（建索引）。
- Obsidian 已建過索引、內容沒變的 `.md`：90 秒內沒被下載。
- `.jsonl`（新的、舊的都一樣）：不讀，維持佔位檔。
- 再啟用外掛重開：結果相同（外掛只讀 `Essence Cards/`，測試檔不在那裡；外掛的讀取會下載佔位檔，見 E2）。外掛的 state 讀完 4 篇卡組，`unread()` 是空的。

**E7 哪個程式讀失敗**（iCloud 正常；同一個 `.md`，每次讀之前重新做成佔位檔）：PowerShell `Get-Content -Raw` 1,994 ms、Node `readFileSync` 1,635 ms、Claude Code 的讀檔工具、Obsidian `vault.read`（經遠端偵錯）824 ms，**全部讀得到、內容正確**。iCloud 沒在跑時，PowerShell 與 Obsidian 都失敗（E3）。讀不讀得到看 iCloud 有沒有在跑、有沒有準備好，和是哪個程式無關。

**其他觀察**：

- 開發命令的 URI 參數不能叫 `path`：Obsidian 拿它當絕對路徑找 vault，找不到就跳出「Vault not found」，命令不會執行（使用者看到的視窗）。已改成 `target`。
- 最近寫過的檔被釋放空間後，有幾次在 5 秒到幾分鐘內被某個程式讀了、下載回來（連 Obsidian 不讀的 `.txt` 也是）；Obsidian 關著時的 60 秒對照沒有發生。是哪個程式沒查出來。
- iCloud 的同步狀態可以不動檔案就讀到：Shell 屬性 `System.StorageProviderState`（1 只在雲端、2 已同步、3 已同步且永遠保留、4 等待上傳、6 傳輸中、10 等待中）。
- 測試 vault 由幾個 session 共用：16:47 另一個 session（更新防線第二部分）換了建置，E7 的 Obsidian 那一筆改用遠端偵錯直接呼叫 `vault.read`，沒有再換建置。
- 還原：`Essence 佔位檔/` 全部設回永遠保留並在本機（79 個檔），外掛清單還原，Obsidian 用一般方式重開；結果檔留在 `Essence 佔位檔/結果/`。

### 第二部分：存檔受阻時當下說清楚（2026-10-29，Opus 5.5）

照使用者的選擇，等 `state` 的讀寫協調合併進 `main`（`70ba562`）才做，分支先合併了 `main`（`d657687`）。開工條件的檔案因此改過、以新版為準：存檔改成 `state.save()`／`state.resolve()`，受阻時回 `{ kind: 'blocked', reason: 'loading' | 'unread' }`，所以**沒有在 `State` 加查詢、沒有改 `main.ts`**，只改 `src/obsidian/save.ts`，做 L1。

- **改了什麼**（`03b69f1`）：`TIPS.blocked`「筆記已自動儲存；暫時無法把新目標加入複習，讀取完成後請再按一次存檔」。按存檔回 `blocked`（`loading`、`unread`）而且按下時編輯器裡有沒 ID 的目標（`parseDeck`）時提示它；目標都有 ID 時不提示。按鈕說明在「`ready()` 還沒完成，或 `unread()` 不是空」的期間一律用這一句，外觀照舊；存檔按鈕自己等 `ready()`，完成時更新一次按鈕。小視窗按「還原」「當成新的」遇到受阻時提示這一句、問題保留，不再說「這篇筆記剛剛改過」。`phone`、`closed` 照舊。
- **測試**：`tests/save-wiring.test.ts` 的 B1～B4 用真的 `createState`（記憶體 Files）做出「讀不到」（`failing`）與「還沒讀完」（`holdRead`），先在舊程式上失敗（按鈕說「有 1 個……尚未加入」「都已加入複習」、小視窗說「剛剛改過」）再改到通過。替身的按鈕改成記下說明；既有替身的 state 補上 `ready`、`unread`，預期都沒改（B5）。`npm run check` 677 個測試通過（合併後的 673 個加 B1～B4）。
- **Windows 版 Obsidian 對照**（開發命令 `save-blocked`，`786d11c`；用 state-load §8 的獨占鎖）：在 `Essence Cards/W5 範例/存檔測試/` 建兩篇自編卡組，A 有一個沒 ID 的目標，鎖住 B 後重新載入外掛：`unread()` 是 B。打開 A 按存檔：按之前、按之後的按鈕說明與提示都是受阻那一句，編輯器與磁碟的文字都沒改（`save-blocked 174233`）。解開鎖 17 秒內外掛自己讀到 B；按鈕說明回到「有 1 個學習目標尚未加入複習」，再按存檔補上 ID、提示「1 個學習目標已加入複習」（`174301`）。兩篇試用卡組做完刪掉。第一次鎖檔沒鎖成（路徑裡的中文經 `powershell -File` 的參數亂碼，開檔失敗卻照樣標成已鎖），那次 A 照常補了 ID；改成從 UTF-8 檔讀路徑、開檔成功才標記後重做。
- **合併前要知道**：分支 `claude/update-safeguards-2`（`f2fcfd5`）也改了 `save.ts` 的同幾行（`saveTip`、小視窗的提示、按鈕的樣子，加「需要新版」）。後合併的一方會有衝突；兩邊可以並存：`blocked` 的 `needs-update` 照它的提示，`loading`／`unread` 照這裡的；小視窗受阻時也用這一句。
