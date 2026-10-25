# W5 架構的技術債檢查（Claude Fable 5.1）

2026-10-26｜檢查者：Claude（Fable 5.1，xhigh 以下的推理）｜性質：**設計回顧，L1**。Claude 是 W5 的實作者，這不是獨立審查；A1～A3 若要採用，建議請 Codex 在合併前或里程碑回顧時核對一次。

## 範圍與做法

- 第一部分：`main` 的 `b00e6f6`（W5 第一部分 `8806152` 之後只有文件 commit）。
- 第二部分：分支 `claude/w5-ids` 的 `10af729`（worktree `../Essence-Cards-w5-ids`，`git status` 乾淨）。
- 讀了 `src/main.ts`、`src/state/`、`src/obsidian/`、`src/dev/`、`src/core/files.ts`，第二部分對 `src/core/deck/` 的差異，`eslint.config.js`、`tools/build.mjs`、`knip.jsonc`，以及測試的接線方式（`tests/main-wiring.test.ts`、`save-wiring`、`state`、`state-ids`、`boundaries`、`quality`）。對照 [D-110](../docs/decisions.md#d-110-v1-外掛的程式結構)、[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)、[D-135](../docs/decisions.md#d-135-清單解析和-obsidian-對照後的處理)、[W5 說明](../tasks/w5.md) 與 Codex 的四次審查（[第一部分](2026-10-24-w5-review.md)、[第二部分](2026-10-25-w5-ids-review.md)）。
- 只看**架構與設計**（code-quality 的「規範與設計」軸），不重找 Codex 已經報過、已修的 bug。Codex 已登錄的 `ready()` 整批重試（[backlog](../docs/backlog.md#技術債)）不重複。
- 判斷依據是 [review.md](../.claude/skills/code-quality/review.md) 的設計判斷與程式異味；每一項都寫「可能是」，改哪些由使用者決定。

## 先說沒問題的

這些是 D-110 的關鍵承諾，查過都成立：

- **核心不碰 Obsidian 與 Node**：ESLint 的 `module-boundaries` 加 `tests/boundaries.test.ts` 雙重擋；第二部分把 `@codemirror` 加進禁用清單，核心與 `state`、`dev` 都進不去。
- **和 vault 只有一個接點**：`Files` 兩個實作跑同一份 C1～C14 契約（Node 的測試、Obsidian 的開發命令），不是為了分層而分層。
- **寫回筆記都是文字 → 文字**：補 ID、歸位、縮排改正、`setTargetId` 全在 `deck` 模組，`deckCases` 有往返與冪等；`state` 與 `obsidian` 只套用。
- **`state` 層的存在理由成立**：它只用 `Files` 與核心的公開匯出，在 Node 測得到；W6 的畫面只透過它拿資料（W6 說明已寫成規則）。
- **建置**：external 白名單、CodeMirror 不打包、正式版不含開發命令，三件都由真正的 `tools/build.mjs` 驗。
- **iPhone 不寫卡組**：`fillIds: Platform.isDesktopApp` 一個旗標決定 `state` 的所有寫回；會寫卡組的開發命令在手機不註冊也不執行。

## 發現（依嚴重程度）

### A1 — P2｜紀錄的壞行救回規則有第二份實作（`state` 自己解析原始紀錄）

- **可能是**：依戀別人的資料；重複的邏輯形狀。
- **位置**：`src/state/index.ts` 的 `ltsOf` 與 `logIds`（第二部分）；對照 `src/core/study/history.ts` 的 `mergeHistory`。
- **現況**：配新 ID 要避開「原始紀錄每一行出現過的 `lt`，含被取消的」（D-134）。`History` 只有合併後的結果，所以 `state` 自己把每一行 `JSON.parse`，壞行再掃每一段 `{"t":`，再用正則找 `"lt"`。`mergeHistory` 救壞行的規則是「只救最後一段 `{"t":`」，兩邊**規則不同**；Codex 的 F3、R1 兩輪都是這份複本漏掉的案例。
- **影響**：D-110 說「紀錄的讀寫與合併」藏在學習狀態模組裡，現在 `state` 也知道紀錄的磁碟格式。之後改紀錄格式（W6 就要加 `retry` 欄位）或改救回規則，要改兩處；漏一處就是再一個 R1。
- **證據**：靜態推斷（兩段程式對讀）。
- **建議**：`mergeHistory` 多回傳一欄 `seen`（每一行出現過的 `lt`，含取消、含救回的尾段），或 `study` 匯出 `logIds(text)`；`state` 刪掉 `ltsOf` 與 `ltCache`，`logIds()` 改讀 `history.seen`。I3、R1 的測試不改預期，只改走公開介面。
- **處理**：記進技術債。觸發點：W6 加 `retry` 欄位時，或第二部分合併後的小整理。完成條件：`src/state/` 沒有 `JSON.parse` 紀錄的程式；`study` 的救回規則只有一處；I3、R1 的測試照舊通過。

### A2 — P2｜`Files.watch` 丟掉改名資訊，`state` 只好猜哪篇改成哪篇

- **可能是**：介面資訊不足（介面不只是函式簽名）。
- **位置**：`src/core/files.ts` 的 `watch`；`src/obsidian/files.ts` 的 `rename` 處理（通知舊、新兩個路徑）；`src/state/index.ts` 的 `apply` 第二部分加的 `gone` 配對（內容相同優先，再來檔名相同）。
- **觸發條件**：同一批通知裡有兩篇卡組消失、兩篇出現，而且其中兩篇內容相同（例如複製一篇再改名、或刪一篇同時新建一篇同名），或改名的同時改了字且檔名也變。
- **預期／實際**：預期待處理問題與上一版跟著「真的改名的那一篇」；實際用內容與檔名猜，猜錯時那一篇會被當成新出現（`lost`）或待處理搬到別篇。Obsidian 的 `rename` 事件本來就給 `oldPath`，資訊是在 `Files` 這一層丟掉的。
- **證據**：靜態推斷，沒有重現。Codex 的 F5 測的是跨檔搬移目標，不是這個。
- **建議**：`watch` 的通知多帶改名資訊（例如 `onChange(path, { from?: string })` 或另一個 `onRename(from, to)`），Node 版用 `fs.watch` 的 `rename` 配對已經在做的事、Obsidian 版直接轉，契約 C12 改成驗 `from`；`state` 刪掉猜配對的程式，`tracker.move` 由通知驅動。
- **處理**：記進技術債。觸發點：範圍與目錄模組要追蹤單元檔案時，或任何一次改名誤配。完成條件：C12 驗 `from`；`state` 沒有用內容或檔名配對的程式；I5 的改名案例與 `save` 的改名情境照舊。

### A3 — P2｜「現在開著哪些卡組」有五個來源在維護同一個集合

- **可能是**：一個改動要散改很多處；審查疊代留下的補丁。
- **位置**：`src/obsidian/save.ts` 的 `open` 集合：`start()` 的基準（T1）、`leave()` 在 `layout-change`／`file-open`、`main.ts` 的 `ViewPlugin` 叫 `opened`（R3）、`editor-change` 的 `remember`（第 15 點）、每 2 秒 `setInterval` 輪詢所有分頁（R3）。
- **現況**：正式版在電腦上永久每 2 秒掃一次所有 Markdown 分頁；五條路徑各自寫進同一個集合，補 ID 的判斷「上一次開著、這一次沒有」只在 `leave()`。這是三輪審查（R3 → 第 15 點 → R3 補 → T1）逐次貼上去的結果，每一條都有理由，但沒有一條是「單一真相」。
- **影響**：W6 要加全螢幕的複習 leaf、之後有入口畫面與目錄，每一種新的 leaf 行為都要對照五條路徑；少對一條就是下一個 T1。`openPaths()`（`getLeavesOfType` 加 `viewState`）其實已經是真相，缺的只是「什麼時候比對」。
- **證據**：靜態推斷；實機行為（背景開檔不發 `file-open`）是第二部分的實測，是否發 `layout-change` 沒有記錄。
- **建議**：在 Windows 版 Obsidian 記一次背景開檔、關檔、改名、popout 各發哪些 workspace 事件（開發命令 `watch` 的做法），再決定：集合只由 `openPaths()` 算、比對時機收斂成事件加一個「最後備援」的輪詢（或拿掉輪詢），每個來源寫明它接住哪個實測情境。
- **處理**：記進技術債。觸發點：W6 合併後的里程碑回顧，或 W6 加新的 leaf 類型時。完成條件：`save.ts` 的追蹤來源不超過兩個、每個註明接住的情境；R3、T1、`save` 的 `openOnly`、`popout`、`rename` 情境照舊通過。

### A4 — P3｜`state/index.ts` 因為三種不相關的理由被改

- **可能是**：一個檔案因為幾種無關的理由被改。
- **位置**：`src/state/index.ts`（437 行）。`apply()` 現在依序做：紀錄來源更新（R2）、改名配對（A2）、ID 追蹤（`tracker.observe`）、卡組更新、讀失敗重試（F3）、重排與通知。第一部分 263 行，第二部分 +174 行，都加在同一個函式族。
- **影響**：backlog 已登錄的 `ready()` 技術債要改 `load`／`apply` 的失敗語義，到時候在這個函式裡改，很容易動到 ID 的安全（那條技術債也明寫了這個風險）。
- **建議**：處理 `ready()` 技術債時順手拆：`state/decks.ts`（檔案 → 卡組與紀錄來源、通知、重試，第一部分的事）、`state/index.ts`（排今天、作答、對外介面）、`state/ids.ts` 已獨立。拆完 `apply` 只做「讀到什麼 → 交給誰」。
- **處理**：併進 `ready()` 那條技術債的完成條件，不另立。完成條件：`apply` 不直接碰 `tracker` 的配對細節；`tests/state.test.ts`、`state-ids.test.ts` 不改。

### A5 — P3｜`load()` 複製了 `readDecks`；`readDecks`、`readHistory` 已無產品程式使用

- **可能是**：重複的邏輯形狀；大多只是轉手的函式。
- **位置**：`src/state/index.ts` 的 `load()`（第二部分，因為要同時拿文字，整段抄自 `src/core/deck/read.ts`，連 `DECK_ROOT` 常數也另寫一份）；`readDecks`、`readHistory` 現在只有測試與 `tools/bench-study.ts` 用。
- **影響**：卡組根資料夾若有一天可設定（D-104 的設定頁），要改兩處；兩段「列出、讀、濾掉 null」的程式會各自演化。
- **建議**：`deck` 模組改成回傳 `{ path, text, deck }`（`readDecks` 改簽名或多一個 `readDeckTexts`），`state` 用它；`readHistory` 留給回測工具（D-105）但在 `boundaries.test.ts` 註明用途。
- **處理**：和 A4 一起做。完成條件：`src/state/` 沒有 `'Essence Cards'` 字面常數；`readDecks` 的測試仍走公開介面。

### A6 — P3｜CodeMirror 的版本要和 Obsidian 的 peer 一致，只靠人記

- **可能是**：機械的事沒交給自動檢查（code-quality 原則 1）。
- **位置**：`package.json` 的 `@codemirror/state 6.7.6`、`@codemirror/view 6.43.13`（固定版）對 `obsidian ^1.8.7`（浮動）；W5 §8-2 第 1 點要求和 `node_modules/obsidian/package.json` 的 `peerDependencies` 相同，但 `tests/` 沒有任何一條檢查（已 grep `peerDependencies`、版本字串）。
- **觸發條件**：`npm update` 或 D-138 的相容性檢查把 `obsidian` 升到 peer 變了的版本，而兩個 `@codemirror` 沒跟著改。
- **預期／實際**：鎖定的 Node 測試（`lock.test.ts`、`main-wiring.test.ts`）會在另一版 CodeMirror 上通過，實機跑的是 Obsidian 那一版；「替身通過不等於真實環境通過」正是 review.md 的「依賴要能控制」。
- **建議**：`tests/build.test.ts` 加一條：`package.json` 的這兩個版本 `===` `obsidian` 的 `peerDependencies`。約十行，第二部分合併前就能加。
- **處理**：加檢查規則（合併前或合併後第一個 commit）。

### A7 — P3｜`src/state/` 沒有「只能透過 index.ts」的邊界規則

- **可能是**：機械的事沒交給自動檢查。
- **位置**：`eslint.config.js` 的 `coreEntry` 只擋 `src/core/`；`state/ids.ts` 的 `createIdTracker` 目前只有 `state/index.ts` 用，但 `src/obsidian/`、`src/dev/` 直接 import 它不會被擋。
- **建議**：`coreEntry` 的 regex 多擋 `state/(?!index\.ts$)`；W6 規格要求 `ui`／`review` 只透過 `state` 拿資料（用 `importNames`），到時候一起加。
- **處理**：加檢查規則，W6 開工時一起做。

### A8 — P3｜`deckStatus()` 的成本沒寫進介面

- **可能是**：介面不只是函式簽名（成本）。
- **位置**：`src/state/ids.ts` 的 `status()` 每次呼叫跑一次完整的 `assignIds`（含 `fixIndent` 的兩次 `parseDeck`）；`src/obsidian/save.ts` 的 `refresh()` 在 `active-leaf-change`、每次 `state.onChange` 都對每個開著的卡組呼叫它。
- **現況**：卡組幾十個目標時是毫秒級，現在不成問題；介面註解「按鈕用」沒說它不是 O(1)。
- **建議**：`tracker` 以 `text` 為 key 快取 `status` 的結果（`texts` 已經存著每篇的文字），或在 `State.deckStatus` 的註解寫明成本。
- **處理**：記進技術債。觸發點：W6 畫面若對每張卡呼叫 `deckStatus`，或卡組超過數百個目標。完成條件：同一份文字第二次呼叫不重新解析，有測試。

### A9 — P3｜測試替身各自為政，`state` 的測試靠真檔案與等待

- **可能是**：依賴要能控制；替身沒有核對契約。
- **位置**：Obsidian 替身在 `tests/main-wiring.test.ts` 與 `tests/save-wiring.test.ts` 各手寫一份；`Files` 的替身有四種（Node 暫存目錄、`study-io.test.ts` 的 `fake`、`main-wiring` 的記憶體 vault、`save-wiring`）；`state.test.ts`、`state-ids.test.ts` 用真檔案加輪詢（`wait(80)`、`delay: 30`），`package.json` 的 `--test-concurrency=1` 也是為了這類時序。
- **影響**：W6 要再加 UI 與 `Session` 的替身，會是第三份 Obsidian 替身；`state` 的測試慢且偶發（第一部分 §0-2 的 `watch` 偶發失敗就是同一類）。
- **建議**：`tests/helpers/` 放一份記憶體 `Files`（用 `src/dev/files-contract.ts` 的 C1～C14 驗過，`watch` 同步通知、可控），和一份共用的 Obsidian 替身；`state` 的測試改用記憶體 `Files`，去掉時間等待，Node 版 `Files` 只在 `node-files.test.ts`、`files-contract.test.ts` 測。
- **處理**：記進技術債。觸發點：W6 開始寫測試替身時（避免第三份）。完成條件：記憶體 `Files` 通過 C1～C14；`state.test.ts`、`state-ids.test.ts` 沒有 `wait()`；兩個接線測試共用同一份 Obsidian 替身。

### A10 — P3｜`DEV` 分支散在正式程式，開發命令直接讀外掛內部

- **可能是**：轉手；為了測試新增產品出口。
- **位置**：`src/main.ts` 有 9 處 `DEV`；`devLog` 物件五個欄位以 `null as …` 宣告，`dev-ids.ts` 讀 `devLog.tokens`、`devLog.save` 直接拿鎖定與存檔的內部。
- **影響**：正式建置會把 `DEV` 分支拿掉，所以不影響使用者；但 W6 還要加 `review-script` 等命令，每加一個就在 `main.ts` 多幾處。
- **建議**：`wireIds()` 回傳 `{ lock, saver }` 之類的 hooks，`main.ts` 只留一處 `if (DEV) void import('./obsidian/dev.ts').then(dev => dev.registerDev(this, hooks))`，紀錄（notices、events、removed）由 `dev` 模組自己訂閱 `onRemoved`／`log`／`notify`。
- **處理**：記進技術債。觸發點：W6 加開發命令時。完成條件：`main.ts` 的 `DEV` 只剩一處。

### A11 — 低｜`State` 在「還沒 ready」時的行為不一致

- `input`／`today`／`answer` 丟錯、`fillIds` 回 `false`、`resolveText` 回 `null`、`deckStatus` 回空。各有理由（§1 寫了前三個），但 W6 的呼叫端要記三種。建議在 `State` 介面的開頭集中寫一句規則，不改行為。

### A12 — 低｜待處理問題用可變的共享物件當身分

- `IdIssue` 交給小視窗後，`tracker` 原地改它的 `line`，`resolve` 用物件身分判斷「內容沒變」（§8-9 第 4 點，刻意的設計，Codex F1 之後定的）。跨模組共享可變物件容易出意外（畫面若複製一份就對不上）。先記下，不建議現在改；若之後改成 token，連 F1 的測試一起搬。

## 建議的優先順序

1. **第二部分合併前**：A6（十行的檢查，擋住替身與實機跑不同版 CodeMirror）。其餘不擋合併。
2. **W6 開工時帶進去**：A7（邊界規則，和 W6 自己的 `importNames` 規則一起）、A9（寫替身前先定共用的）、A10（加開發命令時）。
3. **處理 `ready()` 技術債時一起**：A4、A5。
4. **里程碑回顧時決定**：A1、A2、A3（三條都是「介面少了一樣資訊，下游用猜的或貼補丁」，是這次檢查最值得請 Codex 再看一眼的）。
5. A8、A11、A12 記下即可。

## 驗證紀錄與沒做的

- 靜態閱讀：上列全部檔案，兩個 commit。
- `npm run check`（分支 `claude/w5-ids` 的 `10af729`，worktree 乾淨）：全部通過，354 個測試、0 失敗，54 秒。
- 沒做：沒有操作 Obsidian 實機（A3 的事件順序是從第二部分的實測紀錄與程式註解推的）；A2 沒有寫重現，列為靜態推斷；A8 沒有量時間。
