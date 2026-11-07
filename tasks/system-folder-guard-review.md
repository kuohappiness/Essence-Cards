# 系統資料夾的防呆：L2 審查請求（給新開的 Codex session）

狀態：待審（第五輪，2026-11-07）；第一輪 F1～F4、第二輪 F1、F4～F6、第三輪 F1（續）、第四輪 F1a～F1d 已修

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。只審查，不改產品程式；可以在隔離環境重現。回報接在這個 worktree 的 `Claude Codex Discussion/2026-11-07-system-folder-guard-review.md` 最後（不用 commit，Claude 整合時會 commit）；所有檔案都在這個 worktree，不要寫到主資料夾。

## 第五輪（2026-11-07）

第四輪之後還有擋合併的發現，照 code-quality 的收尾規則交給使用者決定；使用者選了改結構，並同意修完再送一輪只查這段差異。

請**新開一個 Codex 對話**（推理等級：高；不要沿用第四輪的對話，[quality.md](../docs/agents/quality.md) 的〈Codex 審查時〉），回報接在討論稿最後（〈Codex 第五輪〉）。先讀討論稿的〈Codex 第四輪〉與〈Claude 回應：第四輪〉。

- **待審**：`32d7c1efab1b22f5ea93c735651997b2c525e7d0`（改成認資料夾本身的修正與回歸測試）。它之後只有文件的 commit。
- **基準**：`d1c5667ba4f40cfba61d49910fa6ee62d5d27cd8`（第四輪的待審）。

```bash
git diff d1c5667ba4f40cfba61d49910fa6ee62d5d27cd8 32d7c1efab1b22f5ea93c735651997b2c525e7d0 -- src tests
```

- **改了什麼**：
  - `src/obsidian/folder-guard.ts`：`GuardHost` 的 `folder`、`where`、`move(folder, to)`；`Hold.ref`、`Stray`；`restore` 每一步問位置，新增 `'back'`；`spots`、`hidden` 每次重算。
  - `src/obsidian/folder-host.ts`：`folder`、`where` 用 `TFolder` 物件。
  - `tests/folder-guard.test.ts`：替身有資料夾物件與 Obsidian 的事件順序，新增「第四輪」6 個。
  - `tests/folder-host.test.ts`：替身同一個位置給同一個物件。
- **請特別找**：
  - 「同一個物件＝同一個資料夾」在 Obsidian 的哪些操作下不成立：上一層改名、在 Obsidian 以外改名、iCloud 留下的空資料夾、Obsidian 清單和磁碟不一致（討論稿〈Claude 回應：第四輪〉的觀察）。實機只驗了 W10 那幾種。
  - `restore` 的 `'back'`、`'gone'` 和既有結果的交錯：逾時之後才回來、停用、`moveBack` 按鈕，以及 `release` 記與不記。
  - 搬回期間家長又改名時，防呆把資料夾從新位置搬回原位（照資料夾本身），而不是停下來：和「只對原位名單自動搬回」的政策是否一致。
  - 落在系統資料夾原位時不排除（F1c）：考試範圍原位的範圍檔、小考、錯誤紀錄等子資料夾的情形。
  - `hidden` 每次重算、`excluded` 只拿來找變了的：state 會不會漏掉該重讀的通知。
- **驗證**：
  - 實作者跑過 `npm run check`（pre-commit，1933 個測試）、接上新介面的 R4a～R4i 副本（9 個通過）、11 種變異。
  - Windows 實機見任務說明 W10。
  - 請不要在 L2 裡開 Obsidian 或碰 iCloud 資料夾。

## 第四輪（2026-11-07）

請**新開一個 Codex 對話**（推理等級：高；不要沿用第三輪的對話，[quality.md](../docs/agents/quality.md) 的〈Codex 審查時〉），回報接在討論稿最後（〈Codex 第四輪〉）。先讀討論稿的〈Codex 第三輪〉與〈Claude 回應：第三輪〉。

- **待審**：`d1c5667ba4f40cfba61d49910fa6ee62d5d27cd8`（第三輪 F1（續）的修正與回歸測試）。它之後只有文件的 commit。
- **基準**：`48ec6cfae0b6375a52e189f43a65d4cbd80ae676`（第三輪的待審）。

```bash
git diff 48ec6cfae0b6375a52e189f43a65d4cbd80ae676 d1c5667ba4f40cfba61d49910fa6ee62d5d27cd8 -- src tests
```

- **改了什麼**：只有 `src/obsidian/folder-guard.ts`（`stranded` 記 `{ from, at }`、`follow`、`Hold.at`、`unite`）與 `tests/folder-guard.test.ts`（第二輪 F1 的改名那一個改寫，新增「第三輪 F1」5 個）。
- **請特別找**：
  - `follow` 換位置的規則：子樹前綴、拖回原位才清掉、換到別的系統資料夾原位時 `stranded` 不清（只有 `judged` 清）。有沒有該排除卻沒排除、排除了家長自己的卡組。
  - 事件順序：Obsidian 對資料夾本身與底下每一項各送一次 rename；`follow` 用 `host.files()` 重算時，替身是搬動之前的清單、實際 Obsidian 是之後的，送出的重讀通知夠不夠。
  - `Hold.at`：搬回期間又改名、防呆自己的搬回 rename、逾時之後才搬好或才失敗，和 `release` 記的位置。
  - `judged` 跟著換：下一次判斷之前的結果，以及和 §2-2 同名判斷結果不同時誰為準。
  - 〈Claude 回應：第三輪〉留著的判斷時過濾（Obsidian 以外搬走後又在舊位置建資料夾）理由是否成立。
- **驗證**：實作者跑過 `npm run check`（pre-commit，1927 個測試）、第三輪的探針（R3a、R3b 改成失敗，R3c～R3f 通過）、11 種變異。這一輪沒有重跑 Windows 實機（見回應）。請不要在 L2 裡開 Obsidian 或碰 iCloud 資料夾。

## 第三輪（2026-11-07）

請**新開一個 Codex 對話**（推理等級：高；不要沿用第二輪的對話，[quality.md](../docs/agents/quality.md) 的〈Codex 審查時〉），回報接在討論稿最後（〈Codex 第三輪〉）。先讀討論稿的〈Codex 第二輪〉與〈Claude 回應：第二輪〉。

- **待審**：`48ec6cfae0b6375a52e189f43a65d4cbd80ae676`（第二輪 F1、F4～F6 的修正與回歸測試）。它之後只有文件的 commit。
- **基準**：`593d836436f0399ba90d02469e71af0c977125bb`（第二輪的待審）。

```bash
git diff 593d836436f0399ba90d02469e71af0c977125bb 48ec6cfae0b6375a52e189f43a65d4cbd80ae676 -- src tests
```

- **改了什麼**：`src/obsidian/folder-guard.ts`（`stranded`、`when`、`pause`、`attempt` 的總時限、`close()` 放行、刪之前再問 `known`）、`src/obsidian/files.ts`（`pause` 選項，排隊之後、找檔之前問）、`src/obsidian/folder-host.ts`（`later`）、`src/main.ts`（建 `Files` 時傳 `pause`）、`src/desktop/index.ts`（`removeEmptyFolder` 照實際路徑判斷）；測試 `tests/folder-guard.test.ts` 最後一段、`tests/folder-host.test.ts`、`tests/obsidian-files.test.ts` 最後一個。
- **請特別找**：
  - `stranded` 什麼時候拿掉：判斷時「已經不是資料夾」才拿掉，同一個位置又建了資料夾會一直排除（測試裡寫明了這個行為）；外掛重新載入就不記得。有沒有該排除卻沒排除、或排除了不該排除的卡組。
  - `pause` 接到 `obsidian/files.ts` 之後，外掛其他用到同一個 `Files` 的地方（備份、錯誤紀錄、開發命令）在搬回期間等待，會不會卡住或互等；錯誤紀錄寫進 `紀錄/錯誤` 時剛好 `紀錄` 在搬回。
  - 總時限到了之後放行、底層的搬動之後才結束的各種結果（搬好、失敗、停用），以及 `release` 被呼叫兩次（`close()` 先放行、搬回結束再一次）。
  - `removeEmptyFolder` 的 `realpath`／`lstat` 之間的時間差，以及 `isInside` 加 `relative` 的判斷在 Windows 大小寫、UNC、磁碟機根目錄的行為。
  - 〈Claude 回應：第二輪〉維持不做的外部移動時間窗，理由是否成立。
- **驗證**：實作者跑過 `npm run check`（pre-commit，1922 個測試）、第二輪的探針（加了 `later` 的副本：R2a～R2d、R2h 改成失敗，R2e、R2g 的原因見回應）、11 種變異。Windows 實機見任務說明〈Windows 實機〉W9。請不要在 L2 裡開 Obsidian 或碰 iCloud 資料夾。

## 第二輪（2026-11-07）

請**新開一個 session**，回報一樣接在討論稿最後（〈Codex 第二輪〉）。先讀討論稿的〈Codex 第一輪〉與〈Claude 回應：第一輪〉。

- **待審**：`593d836436f0399ba90d02469e71af0c977125bb`（F1～F4 的修正與回歸測試）。它之後只有文件的 commit。
- **基準**：`f1ba0974b3e99155e973fdcf1c6bbb70f2d4a020`（第一輪的待審）。

```bash
git diff f1ba0974b3e99155e973fdcf1c6bbb70f2d4a020 593d836436f0399ba90d02469e71af0c977125bb -- src tests
```

- **改了什麼**：`src/obsidian/folder-guard.ts`（搬回期間的讀寫等 `Hold.done`；暫時位置算 `misplaced`；`restore`、`moveBack`、`check` 不拒絕、不拋錯；看得到的原位資料夾不刪）、`src/obsidian/folder-host.ts`（拿掉遞迴的退路，`removeEmpty` 選項）、`src/desktop/index.ts`（`removeEmptyFolder`）、`src/main.ts`（電腦版傳 `removeEmpty`）、`src/ui/Entry.tsx`（拿掉 `.catch`）；測試 `tests/folder-guard.test.ts` 最後一段、新的 `tests/folder-host.test.ts`。
- **請特別找**：
  - F1 的等待會不會卡住：`release` 一定會跑嗎（`flush` 的子項、`moveBack`、`close()` 之後）；`settled` 的迴圈有沒有永遠等的情形；state 的寫入佇列、`writeTimeout`、`ready()`、`close()` 和這段等待疊在一起時的行為。
  - 等完之後的讀寫是否都照最新的判斷：放棄時 `check()` 已經先跑；`modify` 的回呼重看門檻。有沒有在等之前就決定好、等完不再看的地方。
  - `list` 的重疊判斷（`onFolder`），以及 `watch` 仍用路徑前綴（`holding`），兩者不一致會不會出問題。
  - F2：`removeEmptyFolder` 的路徑檢查（`resolve` 加 `isInside`；Windows 大小寫、`..`、絕對路徑），以及電腦版判斷（`Platform.isDesktopApp`、`FileSystemAdapter`）沒成立時退回 adapter 的非遞迴版。
  - 〈Claude 回應〉不採用的兩項（外部搬動分兩批的時間窗、大小寫與 Unicode）理由是否成立。
- **驗證**：實作者跑過 `npm run check`（pre-commit，1914 個測試）、第一輪的探針（`.local/system-folder-review/probes.test.ts`，修好的六個改成失敗、兩個邊界通過），以及 7 種變異（每一項修正拿掉都有測試失敗）。Windows 實機重測見任務說明〈Windows 實機〉W8（`removeEmpty`、F2 的時間差、F4、F1 都在 Obsidian 裡走過）。請不要在 L2 裡開 Obsidian 或碰 iCloud 資料夾。

## 審查對象（第一輪）

- **位置**：worktree `.claude/worktrees/system-folder-guard`（主資料夾底下），分支 `claude/system-folder-guard`，沒有未提交的程式修改。
- **待審**：`f1ba0974b3e99155e973fdcf1c6bbb70f2d4a020`。它之後只有文件的 commit（這份請求、討論稿）。
- **基準**：`6fba29a366552ba40872ceb1efdb8d945dfa88b9`（開工時的 `main`，也是分支的共同祖先）。

```bash
git diff 6fba29a366552ba40872ceb1efdb8d945dfa88b9 f1ba0974b3e99155e973fdcf1c6bbb70f2d4a020 -- src tests tools docs/syntax.md
```

| commit | 內容 |
|---|---|
| `edda2b8` | §1、§2 的程式與測試：名單與判斷 `src/core/deck/folders.ts`；搬回、重試、清空資料夾、擋通知、不當卡組 `src/obsidian/folder-guard.ts`；接上 Obsidian `src/obsidian/folder-host.ts`；`src/main.ts` 的接線；提醒一區 `src/review/entry.ts`、`src/ui/Entry.tsx`；`StateOptions.skip`（`src/state/index.ts`、`writes.ts`）；錯誤紀錄的 `where: "folder"`（`src/core/errors/log.ts`、`docs/syntax.md` §9） |
| `f1ba097` | Windows 實機發現：電腦版 `adapter.rmdir(path, false)` 對空資料夾也回 `EISDIR`，改成確認是空的才用遞迴的那一種（`folder-host.ts`）；實機結果寫進任務說明 |

## 規格與優先順序

- 任務說明：[system-folder-guard.md](system-folder-guard.md) §1～§5；實作和它不同的地方在〈實作〉，Windows 實機在〈Windows 實機〉，開工前的實測（R1～R9）在〈結果〉。
- 決定：[D-088](../docs/decisions.md#d-088-錯題本考試範圍與系統資料夾)（系統資料夾）；[D-048](../docs/decisions.md#d-048-使用說明書) 2026-11-04 補充（哪些資料夾不能搬、不能改名，更深處同名的可以放家長自己的卡組）；[D-103](../docs/decisions.md#d-103-總覽改成入口的給家長一區)、[D-163](../docs/decisions.md#d-163-入口與目錄的四批開法全部卡的一輪與提醒一區) 第 5 點（提醒一區只在電腦）；[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)（補 ID 的保護）；[D-155](../docs/decisions.md#d-155-正式版的錯誤紀錄)（錯誤紀錄）；[D-040](../docs/decisions.md#d-040-卡組的位置)（卡組資料夾可以自由搬）；[D-179](../docs/decisions.md#d-179-介面的每一項都要有必要性非必要不出現)。
- §5 的兩題使用者已決定：提醒附「搬回原位」按鈕；Obsidian 裡一律搬回，不給「我是故意的」。
- 規格衝突時列成問題，不挑容易通過的那份。

## 行為與風險

高風險的兩塊（[quality.md](../docs/agents/quality.md#高風險範圍要做-l2)）：**替家長搬動 vault 裡的資料夾**（含刪掉空資料夾），以及**改了哪些檔算卡組**（state 的讀與寫都經過）。

- **§1 搬回**：vault 的 `rename` 事件，舊路徑剛好是名單裡的資料夾就搬回；同一批只處理最上層（`guardedMoves`）；原位的上一層不在就不搬；原位有東西不合併、不覆蓋（只有磁碟上的空資料夾時先刪再搬）；`EPERM`、`EBUSY` 每 200 ms 重試、最多 10 秒，其他錯誤不重試、交給錯誤紀錄；搬回後 3、6、10 秒看暫時的位置，完全是空的才刪。
- **§1-8 搬回期間**：給 state 的 `Files` 包一層（`wrap`），舊、新位置的通知先擋住，搬好了或放棄了照順序送；這段時間 state 不讀不寫。
- **§2 判斷搬錯位置**：`folderIssues(files, remembered)`。這台先看過原位有檔（`presentFolders` 累積，存在 `saveLocalStorage`），現在原位沒有檔才算；在 `Essence Cards/` 底下找同名資料夾（根資料夾不見時找整個 vault）；上層已經列了的下層不列；「兩邊都有」要檔名重疊或是外掛寫的紀錄檔名。
- **§2-3 不當卡組**：`wrap` 不列、讀不到搬錯位置的資料夾裡的檔，判定改變時通知那幾個檔讓 state 重讀；寫入另由 `StateOptions.skip` 擋（`writes.ts` 的 `writable`）。
- **§2-4 提醒**：三種文字；按鈕只給找到一個位置的「搬回原位」、找不到的「不用了」。
- **不做的**（§3）：家長自己的檔被拖進系統資料夾、單一檔案被拖出系統資料夾都不處理；不改任何寫進檔案的格式（錯誤紀錄只多一個 `where` 的值）。

## 實作者自己選的做法（請先看）

1. **監聽在 layout ready、建立 state 之前註冊，不在 onload**：任務說明 §1-8 要求比 state 的監看先註冊。放在 onload 會破壞「layout ready 之前不碰 vault」（T12，`tests/main-wiring.test.ts` 會失敗）；放在 `start()` 裡、`createState` 之前，仍然比 state 的 `files.watch` 早。依賴的是 Obsidian 照註冊順序呼叫事件監聽者。
2. **監看不了時防呆不作用、不另外記錯誤**：`vault.on` 拋錯時 state 用同一個 API 也會失敗、記一行 `init`；同一個原因不記兩次（`folder-host.ts` 的 `catch`）。
3. **擋通知靠路徑前綴**：`holds` 記原位與暫時的位置，這兩個資料夾底下的任何通知都先擋住。代價：這段時間別的程式寫進這兩處的通知也晚到最多 10 秒。
4. **排除用包 `Files` 加 `skip` 兩條**：讀與列靠 `wrap`（state 以為檔不在），寫入靠 `skip`（`writable` 只看路徑，不看 state 有沒有這篇）。沒有把判斷搬進 state，因為「這台記住的名字」在 Obsidian 那一層。
5. **`rmdir` 的退路**（`f1ba097`）：非遞迴失敗時，`adapter.list` 確認空的才用 `rmdir(path, true)`。確認與刪之間有時間差。
6. **空資料夾每次搬回都看**：任務說明寫「重試過才搬回時」；這裡每次都看，只刪完全空的、Obsidian 看不到的（`!host.known(path)`）。
7. **原位只剩磁碟上的空資料夾時先刪再搬**：當成 §1-3「沒有東西」的一種。
8. **通知的文字**：任務說明的那句「複習進度會看不到」只對 `紀錄` 成立，改成「不能搬動或改名，已經搬回原位」；提醒一區照資料夾寫搬回後會怎樣（`BACK` 那張表）。
9. **「搬回原位」只給找到一個位置的**：好幾個時不知道哪一個對，只列出位置。
10. **入口的 `folders` 每次問現在的防呆**：入口可能在 layout ready 之前打開，那時防呆還沒建立。
11. **判斷的時機**：vault 有新增、刪除、改名就等 500 ms 重新判斷；有搬回在進行時不判斷，搬好了再判斷一次。
12. **`tools/install.ts` 的 `readDecks` 不改**：在 Obsidian 外面跑，沒有這台記住的名字；任務說明 §2-3 提到 `readDecks`。

## 請特別找

- **事件順序**：Obsidian 的 `rename` 對資料夾與底下每一項各送一次（〈結果〉R2）。`renamed` 用 `holding(oldPath)` 跳過底下的；根資料夾整個搬走時，`Essence Cards/紀錄` 的改名會不會被當成另一筆搬回。搬回自己造成的 `rename`（舊路徑是暫時的位置）會不會再觸發。同一批裡有兩個不相干的系統資料夾。
- **搬回期間的寫入**：學生正在複習時家長拖走 `紀錄/`，state 的紀錄寫入（`append`）在原位建了新檔；搬回會遇到「原位有東西」。請看這時的通知、提醒（應該是「兩邊都有」）與資料會不會丟。
- **擋住又放行**：放棄（10 秒）之後放行的通知，state 讀到的是暫時位置的檔；`check()` 接著判定成搬錯位置，再通知一次。請找 state 在這兩次之間會不會寫檔、補 ID。
- **§2-2 的誤報與漏報**：家長自己的同名卡組資料夾（`學業/錯題本/`）、新 vault、重裝後第一次開、`記憶錨點`／`製卡規則` 從來沒有檔、`紀錄/AI 輸出`；Obsidian 以外搬動時新增比刪除早約 1 秒（R8），中間會判成「兩邊都有」。大小寫不同、Unicode 正規化（NFC／NFD）的資料夾名。
- **§2-3 的邊界**：判定前已經讀進來的卡組要被拿掉；判定解除時要回來。範圍檔開在編輯器裡時存檔按鈕與離開筆記的補 ID（`save.ts`、`deck-actions.ts` 仍用 `isDeckPath`）。
- **刪資料夾**：`cleanup` 與原位的空資料夾，有沒有任何路徑會刪到有東西的資料夾或 Obsidian 看得到的資料夾；`rmdir` 退路的時間差。
- **按鈕**：「搬回原位」在原位已經有東西、兩個 Obsidian 同時按、按了之後立刻又搬；「不用了」之後同一個資料夾又出現。
- **`catch` 都有理由**：`src/` 裡新增的 `catch` 不是交給錯誤紀錄的，旁邊要寫為什麼（[quality.md](../docs/agents/quality.md) 的〈本專案的做法〉）。

## 驗證方式

- Node 24 以上（Claude 用 v24.13.0）。在 worktree 裡：`npm ci`、`npm run check`，要在沙箱外跑（[quality.md](../docs/agents/quality.md) 的〈Codex 審查時〉）。自己跑測試一律加 `--test-timeout`。
- 實作者跑過的：`f1ba097` 的 `npm run check`（pre-commit，1900 個測試）。`tests/folder-guard.test.ts` 的 §1-8、§2-3 兩個測試，拿掉擋通知、拿掉排除後會失敗（實跑確認過）。
- **Windows 實機**：見任務說明〈Windows 實機〉W1～W7（兩個獨立的 Obsidian 加 CDP，暫存 vault 在 iCloud Drive，測完刪掉）。修正後的「重試後刪空資料夾」完整流程沒在實機走過（W2）。請不要在 L2 裡開 Obsidian 或碰 iCloud 資料夾。
- **沒跑**：iPhone（〈結果〉最後的四項，已列進 backlog「下一次 iPhone 實機測試」）、Mac、iCloud 同步到另一台裝置、真的滑鼠拖動。

## 回報

依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證）、**真實路徑會不會發生**（使用者的資料、Obsidian 的實際行為或已發布的版本，會不會產生這個輸入），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。〈實作者自己選的做法〉請逐點回覆。可以回報「規格本身有漏洞」。沒有擋合併的發現就直接寫「通過」。
