# 試作外掛（T2 複習畫面原型＋T3 自動量測）：任務說明（給 Codex）

遵守 repo 根目錄的 `AGENTS.md`。

做一個 Obsidian 試作外掛，回答[試作場](../README.md)的 T2，並替 T3 做好自動量測，讓使用者的 iPhone 只要測一次（[D-065](../../docs/decisions.md#d-065-試作場)）。這不是 v1 的正式程式：不解析卡組筆記、不排程。量測結果由 Claude 讀，用來決定 React 或 Preact、全螢幕做不做得到、滑動手勢會不會和 Obsidian 衝突。

## 必讀範圍與基準

寫這份說明時的基準 commit 是 `79f416e`。開工前用 `git diff 79f416e -- <下列檔案>` 看有沒有改過；有改，以新版為準，並在回報裡註明。

| 讀什麼 | 為什麼 |
|---|---|
| [試作場說明](../README.md)的 T2、T3 兩節 | 要回答的問題 |
| [D-051](../../docs/decisions.md#d-051-複習畫面用-react)、[D-052](../../docs/decisions.md#d-052-樣式用純-css)、[D-084](../../docs/decisions.md#d-084-回看上一張與滑動手勢)、[D-096](../../docs/decisions.md#d-096-顯示答案與複習畫面的細節) | 技術選擇、樣式規則、回看與滑動、複習畫面的細節 |
| [樣式稿](../mockups/entry-and-reveal.html)的複習畫面：CSS 第 1～160 行附近的 `--*` 變數與 `.ec-*`，JS 的 `cardHTML`、`reviewHTML`、`diff`、`blankHTML`、`spellHTML`、`reveal`、`rate`、`back`、`fwd`、`say`、點擊與 touch 處理（約第 966～1012 行） | 畫面要照這份做；只照 `S.rv === 'A'`（文字按鈕）那條分支，B、C1、C2 是沒採用的方案 |
| [出題語法 §5 複習紀錄](../../docs/syntax.md#5-複習紀錄) | 紀錄檔的格式 |
| `experiments/tts-probe/main.js` | 朗讀（`speechSynthesis`）在 Obsidian 裡的寫法 |
| 2026-10-07 的舊原型：`git show a5b7c5f^:experiments/obsidian-ui-probe/main.js` | `ItemView`、`getResourcePath` 的用法，可參考，不必沿用 |

其他文件不用讀。

## 限制

- 只新增或修改 `experiments/plugin/` 底下的檔案；`TASK.md` 不要改（有疑問寫在回報裡）。
- TypeScript，Node 24，esbuild 建置；`npm install` 在 Windows 上要能直接跑，不能需要 C++ 編譯工具。相依套件只用 `obsidian`（型別）、`react`、`react-dom`、`preact`、`motion`、`esbuild`、`typescript`，測試用 Node 內建的 `node:test`。要加別的先在回報說明理由。
- 加 `experiments/plugin/.gitignore`，排除 `node_modules/` 與 `dist/`。
- 樣式照 D-052：純 CSS、class 一律 `ec-` 前綴、**不用 Shadow DOM**（否則 Obsidian 渲染的公式套不到樣式）。深淺色跟著 Obsidian（`body.theme-dark`），不跟系統。
- 外掛裡只能 `require('obsidian')`，不用 Node.js、Electron、`fs`；iPhone 上也要能跑（`manifest.json` 的 `isDesktopOnly: false`）。
- 範例卡、圖、音檔都要自己編或由程式產生；repo 是公開的，不放課本內容、學生資料。
- 測試 vault 的路徑不寫進任何檔案；安裝指令用參數傳入。
- 在新分支 `t2-prototype` 上 commit。在本機工作時用 `git worktree add ../Essence-Cards-t2 -b t2-prototype` 開在旁邊的資料夾，**不要在原資料夾切換分支**：同一個資料夾裡還有其他 AI 正在 main 上改文件。

## 要做什麼

### 1. 建置：同一份程式，兩個外掛

- `npm run build` 產出兩個資料夾，各有 `main.js`、`manifest.json`、`styles.css`：
  - `dist/essence-t2-react/`：外掛 ID `essence-t2-react`，名稱「Essence T2 (React)」。
  - `dist/essence-t2-preact/`：外掛 ID `essence-t2-preact`，名稱「Essence T2 (Preact)」；用 esbuild 的 alias 把 `react`、`react-dom`、`react/jsx-runtime` 換成 `preact/compat`、`preact/jsx-runtime`。程式碼不能為了 Preact 分支。
- 兩個都壓縮（minify），格式 CommonJS，`obsidian` 設為 external。
- `main.js` 最前面用 esbuild 的 banner 記下開始執行的時間（例如 `var __ecT0 = performance.now();`），供量測用。
- `npm run install-vault -- <vault 路徑>`：把兩個資料夾複製到 `<vault>/.obsidian/plugins/`，覆蓋舊版；路徑不存在或沒有 `.obsidian` 就報錯停下。
- 兩個外掛可以同時啟用，互不干擾：命令、檢視類型、設定都用各自的外掛 ID 區分，命令名稱前面帶「(React)」或「(Preact)」。

### 2. 測試資料

命令「建立測試資料」：在 vault 建立 `Essence-T2/`，已存在的檔案不覆寫。內容：

- `Essence-T2/附件/`：
  - 一張小圖（約 800×500 的 PNG，簡單的示意圖，例如兩個燒杯和箭頭）與一張大圖（約 3000×2000 的 PNG，細格線加文字，測解碼與縮放）。用 canvas 在執行時畫出來，存成檔案。
  - 一個約 3 秒的 WAV（程式產生的三個音），測音檔播放。
- `Essence-T2/轉錄稿.md`：一小段自己編的內容，給出處圖示打開用。

範例卡寫在程式裡（`src/samples.ts`），每張是正面、背面的 Markdown 字串，加上題型、學習目標 ID、題目指紋。內容自己編，中英文都有，至少包括：

| 題型 | 用來測 |
|---|---|
| 問答，答案有粗體 | 基本流程、新卡的「新」標籤 |
| 填空：一行兩個 `==空格==` | 空格要變成樣式稿的 2px 底線，翻面後答案在線上淡入（D-096） |
| 中翻英打字（例句挖空、括號附中文） | 輸入框、逐字比對、iPhone 鍵盤 |
| 長答案：背面約三個螢幕高 | 上下捲動不能被當成左右滑 |
| 題目有小圖、背面有大圖 | 圖片顯示與載入時間 |
| 行內公式 `$\rho = \frac{m}{V}$` 與區塊公式 `$$…$$` | 公式渲染 |
| 背面有 `![[t2-音.wav]]` | 音檔播放 |
| 英文單字卡，有朗讀圖示 | 系統語音朗讀（照 tts-probe 的寫法，不指定語音，D-082） |

一輪約 12 張（有的題型出兩張）。

### 3. 複習畫面

- 照樣式稿的複習畫面做成 React 元件，動畫用 Motion：上方「‹」、「還剩 N 張」、✕ 與細進度條；題目；「顯示答案」；四個自評按鈕；出處的書本圖示（點一下顯示「出處 ↗」，再點打開 `Essence-T2/轉錄稿.md` 並關閉複習）；朗讀的喇叭圖示；完成畫面「今天的份完成了！」加「再複習一些」（重新開始一輪）。英文卡的自評按鈕用 No idea／Almost／Got it／Too easy。
- 卡片內容用 Obsidian 的 `MarkdownRenderer.render` 渲染（sourcePath 用 `Essence-T2/轉錄稿.md`，生命週期掛在一個 `Component` 上，換卡時 unload）。填空：把渲染出來的 `==…==`（`mark`）換成空格。
- 行為照樣式稿與 D-096、D-084：點題目所在的畫面也能翻面（打字題除外）；翻面只做透明度淡入；翻面後 0.3 秒內的點擊不算；打字題打了字以後按鈕變「確認」，Enter 也可以確認；拼字比對不分大小寫、忽略前後空白，標出錯的字母；回看時顯示當時的評分，可以直接改按另一個；電腦上左右鍵回看、空白鍵或 Enter 翻面、1～4 自評。
- **滑動**（D-084）：只在卡片區。手指往右滑是上一張，往左滑回到目前這張。方向先鎖定：水平移動先超過約 10px 且大於垂直移動的 1.6 倍，才算左右滑，否則交給瀏覽器捲動（卡片區設 `touch-action: pan-y`）。左右滑時卡片跟著手指移動，放開時超過約 60px 或速度夠快就換卡，否則彈回。沒有上一張時往右滑要有阻力、會彈回。評分不用滑動。
- **兩種顯示方式**（設定頁切換，預設全螢幕）：
  - 全螢幕：一層 `position: fixed`、蓋滿整個視窗的元素，直接掛在 `document.body` 底下，z-index 高於 Obsidian 的介面；四周留 `env(safe-area-inset-*)`。開啟時把焦點移進來，✕ 或完成後移除。
  - 分頁：一般的 `ItemView`，保留 Obsidian 的外框。
- 設定「攔截觸控事件」（預設開）：開的時候，全螢幕層在 touchstart／touchmove 上 `stopPropagation`，不讓 Obsidian 收到。
- 自評只記在記憶體，不寫檔（寫檔是第 5 節的事）。

### 4. 量測（T2）

每次量測結束，把結果寫成 `Essence-T2/結果/<YYYY-MM-DD HHmmss> <平台> <react|preact> <種類>.json`。每個結果檔都含：外掛 ID、版本、平台（`Platform.isIosApp` 等）、Obsidian 版本（`apiVersion`）、`navigator.userAgent`、視窗大小、`devicePixelRatio`、顯示方式、是否攔截觸控、量測時間。

**a. 載入**（每次 Obsidian 啟動自動記一次，寫成「載入」結果檔，延後到 `onLayoutReady` 之後再寫）：`__ecT0`（從頁面開始到外掛開始執行的毫秒數）、`onload` 結束時距 `__ecT0` 幾毫秒、`main.js` 的位元組數。

**b. 開啟**：每次打開複習畫面都量，分段記：從命令被呼叫到 React 第一次 commit、第一張卡的 Markdown 渲染完、兩個 `requestAnimationFrame` 之後（當作已經畫出來），以及圖片的 `decode()` 完成。標記「這次 Obsidian 啟動後第一次開」；一般開啟的結果累積在記憶體，關閉複習時寫一個「開啟」結果檔。

**c. 動畫**：每次翻面與換卡動畫期間，用 `requestAnimationFrame` 記每一格的間隔。每段動畫記：格數、間隔的中位數、最長的一格、掉格數（間隔超過中位數的 1.5 倍）。同一個結果檔也記每張卡的 Markdown 渲染時間、圖片是否載入成功與尺寸、公式是否渲染（有沒有 `mjx-container`）、音檔能不能載入（`loadedmetadata` 與長度）。

**d. 手勢紀錄**：卡片區的每一次觸控記一筆：起點座標、離左右邊緣多遠、最後的 dx／dy、時間長度、判斷結果（上一張、回到目前、彈回、捲動、點擊）；以及放開後 0.5 秒時 Obsidian 的左右側欄有沒有從收合變成打開（`app.workspace.leftSplit`／`rightSplit` 的 `collapsed`）。關閉複習時寫成「手勢」結果檔，另附這次捲動卡片區的次數。

**e. 全螢幕檢查**：全螢幕層打開後，記錄層的 `getBoundingClientRect()`、`window.innerHeight`、`visualViewport` 的大小、四個 safe-area 的實際值（用一個探測元素讀 computed style），以及在左上、右上、左下、右下、正中央五點用 `elementFromPoint` 取到的元素是不是在我們的層裡。打字題的輸入框得到焦點 0.5 秒後再記一次 `visualViewport`（鍵盤彈出後）。寫進「開啟」結果檔。

**f. 自動跑一輪**：命令「自動量測」：不用手指，依序做完：打開再關閉複習畫面 10 次；打開後自動把一輪的每張卡翻面、自評（間隔約 0.8 秒），中間做 5 次「上一張」和「回到目前」（用程式觸發和滑動相同的換卡動畫）；全部結束後寫成「自動」結果檔，並跳出 Notice 告訴使用者完成了、檔名是什麼。

### 5. T3 的自動量測

**a. 連續複習**：命令「連續複習 15 分鐘」（時間在設定頁可改，給 AI 在電腦上用較短的時間測）。打開複習畫面，約每 10 秒自動翻面、1 秒後隨機自評；每次自評立刻在背景用 `vault.adapter.append` 追加一行到 `Essence-T2/紀錄/<YYYY-MM> <裝置名稱>-<隨機碼>.jsonl`（格式照出題語法 §5：`t` 含時區到毫秒，`lt`、`r`、`v`；裝置名稱用 `iPhone`、`Windows` 等，隨機碼第一次產生後存在外掛設定）。每 10 次自評中有 1 次先做「上一張、改評分」，照 §5 寫 `undo` 再寫新評分。記錄每次 append 的耗時與動畫的格數統計；結束後讀回檔案，核對行數與內容和寫出去的一致。用 `navigator.wakeLock` 防止螢幕變暗，成功與否寫進結果；失敗時在畫面上提示使用者手動把自動鎖定關掉。寫成「連續」結果檔。

**b. 三年份紀錄**：

- `npm run gen-records -- <輸出資料夾>`（Node 程式，放在 `tools/`）：產生 36 個月 × 2 台裝置（`iPhone-xxxx`、`Windows-xxxx`）＝ 72 個 `.jsonl`。每天約 150 筆作答（iPhone 約佔八成），時間分佈在晚上，總共約 16 萬行；約 1% 是 `undo` 加改評分，每月幾筆 `set` 變更（`cap`、`status`、`filter`）；學習目標 ID 約 3000 個。用固定的亂數種子，每次產生的內容一樣。印出檔數、行數、總大小。
- 命令「讀全部紀錄」：讀 `Essence-T2/紀錄-三年/` 裡全部的 `.jsonl`（`adapter.list` 加 `adapter.read`），逐行 `JSON.parse`；記錄總時間、讀檔與解析各佔多少、最慢的一個檔、行數、讀不到或解析失敗的檔案與錯誤訊息。接著只讀最新月份的兩個檔，記錄時間。整組做 3 次（第一次是沒有快取的情況）。寫成「紀錄」結果檔。

### 6. 給 AI 在電腦上看畫面

`npm run preview` 產出 `dist/preview/index.html`：用一個假的 `obsidian` 模組（esbuild alias，`MarkdownRenderer` 用簡單的 Markdown 轉換：粗體、`==`、圖片、公式顯示原文即可），在一般瀏覽器裡開複習畫面，寬 375px，網址參數 `?theme=dark` 切深色。只給 AI 檢查版面，不必量測。

## 自我測試

- `npm test`：用 `node:test` 測純邏輯：拼字比對、手勢的方向鎖定與判斷、動畫掉格統計、紀錄行的格式（含 `undo`）、`gen-records` 用小參數產生的行數與格式。
- `npx tsc --noEmit` 沒有錯誤。
- `npm run build` 產出兩個外掛；檢查兩個 `main.js` 除了 `obsidian` 以外沒有其他 `require`，Preact 版裡沒有 React 的程式碼（例如搜尋 `react-dom` 的字樣），並印出兩者的大小。
- `npm run preview` 後，在瀏覽器以 375×812 開一次淺色、一次深色，確認沒有主控台錯誤、沒有橫向捲動，能翻面、自評、做到完成畫面。

在 Obsidian 裡的測試由 Claude 做，不用你開 Obsidian。

## 完成後回報

- 分支、最後一個 commit。
- 自我測試的輸出摘要，以及兩個 `main.js` 的大小。
- 逐條對照「限制」的自我檢查：符合／不符合與原因。
- 沒做到或和規格不同的地方、你覺得 Claude 在 Obsidian 裡要特別注意測的地方。

不用貼完整的執行紀錄，也不用寫 README；使用說明由 Claude 寫。
