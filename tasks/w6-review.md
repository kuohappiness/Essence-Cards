# W6 複習畫面：L2 獨立審查（給 Codex）

狀態：已結案：第三次再審在 `6f96883` 通過；iPhone 驗收通過後，2026-10-27 合併進 `main`（`f136cf6`）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（打字卡的三步流程、回看改評分、手勢與換卡互相牽動；解析器與紀錄欄位改了資料格式）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)、[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)，[W6 任務說明](w6.md)由 Claude 實作（Fable 5.1 做到畫面，Opus 5.5 接手 Windows 實測與修正）。這一批改了卡組解析（` | `）與複習紀錄的欄位（`retry`），屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

開工前的格式查核（[報告](<../Claude Codex Discussion/2026-10-26-w6-format-review.md>)）回來時，§0-1 與 §1 已經做好（D-140 的順序沒有照到）。F1～F6 的處理 2026-10-26 寫進了 W6 說明與 syntax.md（`main` 的 `7f6e7df`，[核對說明](w6-format-review-fixes.md)；F3 採 `not-needed`，使用者確認），實作照它補齊：F2 `8351638`，F1、F3 `7242db0`，F5、F6 的測試在兩個 commit 裡。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-w6`，分支 `claude/w6`，沒有未提交的修改。
- 從 `main` 的 `ab2c99c` 開出；W6 進行中把 `main` 合併進來兩次（`620f340`、`1c0da7f`，只有文件：D-140、格式查核與它的處理、外掛架構討論稿；第二次 syntax.md §5 的衝突照 `main` 的定案）。**看 W6 的改動用 `git diff main...claude/w6`**。
- 待審 commit（由舊到新）：
  - `25130c9`：§0-1 中翻英的答案格拆開 ` | `（D-122）
  - `9af2cae`：§0-2 `baseForm()`（D-121、D-125）
  - `2168eef`：技術債 A7（state 只能經過 `index.ts`）與 W6 的 ui／review 邊界規則（限制第 3 點）
  - `0b335b6`：技術債 A10（`main.ts` 只剩一處 `DEV`，開發命令訂閱外掛的事件）
  - `2ea31fb`：技術債 A9（共用的記憶體 `Files` 與 Obsidian 替身）
  - `1efb25b`：§1 `retry` 欄位
  - `48cddfc`：§2 `src/review/`（純程式）與 §3 `src/ui/`（畫面）、`main.ts` 接線
  - `e182292`：§4 開發命令，與 Windows 實測找到的修正
  - `8351638`：格式查核 F2（答案格任何一處換行都是 `typed-answer-invalid`）與 F1、F5、F6 的測試
  - `50625d2`：照打時還沒打字不畫比對那一行
  - `7242db0`：格式查核定案的 F1（整格不能當打字答案就停出）、F3（`retry: not-needed`），以及「版本」命令顯示建置版本（§7 前提）
- 各 commit 的訊息寫了那一步的做法。`307860a`、`02ce35f` 是交接單與這份請求，不用看。

## 規格與優先順序

- 主要規格：`main` 上的 [tasks/w6.md](w6.md) §0～§6 與它的「必讀範圍」；§7（iPhone）在 L2 之後做，不在這次範圍。基準（說明所在的 commit）是 `79dfe14`；之後 `main` 改過 syntax.md、decisions.md、w5.md、backlog.md（W5 第二部分合併、D-140），以 `main` 的新版為準。
- 格式的邊界以 syntax.md §2-3（中翻英要打字）與 §5（`typed`、`retry` 兩列）為準，W6 說明的 §0-1、§1、R1、R4、R5、R10 已照格式查核改過。F4（多答案卡不向下相容 W5）寫在 W6 說明〈開工條件與基準〉，不寫程式。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## 請特別看

照 W6 說明〈完成後〉：

1. **` | ` 的拆法和指紋不變**（`src/core/deck/parse.ts` 的答案格那一段、`tests/deck.test.ts` 的 R1）：`answer` 與 `fingerprint` 用整個答案格；格式查核給的 8 個 W5 指紋登錄成測試，W6 算出來相同。換行在拆開之前看整格。
2. **`retry` 不影響 `appendLine` 和 `mergeHistory` 的一致**（`src/core/study/entries.ts`、`tests/append-line.test.ts`、`tests/study.test.ts` 的 R4）：`parseLine` 不讀 `retry`。
3. **打字三步的每一格**（`src/review/session.ts`、`tests/review-session.test.ts` 的 R5）：評分只看第 1 步；能按的自評；跳過第 2 步的條件（原形是 null 或等於任何一個答案，不分大小寫）；答案出現前（第 1、2 步）沒有喇叭、不自動念。
4. **回看改評分的取消與新的評分、打字卡的限制**（`change()`、R10）：寫的是這一次記下的 `lt`、`v`、`typed`、`retry`，不是從 `History` 重建（`History` 不讀 `retry`）。
5. **中斷時不寫任何紀錄**：✕、Esc、外掛停用、新的 `Session`。
6. **畫面沒有繞過 `state` 讀寫檔案或排程**：`eslint.config.js` 的 `viewFiles`、`viewNames` 與 `tests/quality.test.ts`；`src/ui/sources.ts` 用 `metadataCache` 找出處（Obsidian 層的唯讀查詢）。
7. **沒有寫卡組筆記的路徑**：畫面只經過 `state.answer` 寫紀錄；另外只寫自動朗讀的開關（`app.saveLocalStorage`）。開發版的 `w6-save` 會按卡組的「存檔」按鈕（只在電腦、只在開發版）。
8. **格式查核的三點**：F1 的格式邊界與 R1 的 invalid 例子（`parse.ts` 先看整格，再拆、去裝飾、查空段與中文，最後比字數）；`not-needed` 的寫入條件（`session.ts` 第 1 步拼錯或按沒印象、`hintOf` 是 null 時）；改評分後 `retry` 保留（R10 比原始 JSON）。

## Claude 自己選了做法的地方（請逐點回覆）

上一個 session（Fable 5.1）：

1. **0.3 秒的規則也套在打字卡**：答案出現（第 1 步拼對、第 2 步拼對、進第 3 步）後 0.3 秒內的自評不算，和一般卡翻面相同。
2. **第 3 步的「最接近的答案」**用編輯距離（`closest`），一樣近取前面的；照打的結束條件是 `checkTyped`（對中任一個）。
3. **原形等於某一個答案就跳過第 2 步**，不分大小寫（多個答案時任一個相同就跳過）。
4. **回看時改評分不換目前這張、不重新 `next`**；改成差一點／沒印象的再出交給下一次 `next`。
5. **`autoRead`** 留在 view 上直到下一個動作，畫面用物件身分判斷只念一次（`state.onChange` 會讓 view 重算）。
6. **出處**：純函式把每一項分成 `block`／`heading`／`note`／`unit`／`text`；Obsidian 層依序找第一份有那個區塊或標題的材料；頁碼與圖表都找不到時打開第一份材料；標題都沒有時照文字顯示；沒寫出處時打開第一份材料；跨單元照文字顯示（結構能接範圍與目錄模組）。
7. **打字卡的背面**照原文渲染答案格（含 ` | `），不改寫；寫在線上的是對中的那一個（或第一個）。
8. **英文語音**：`getVoices()` 回傳空清單時當作有語音照念、不提示；清單非空且沒有 `en*` 才提示一次。
9. **選單的列**：`約 M 分鐘` 用 `remainingSeconds` 進位到分鐘、至少 1；做完的列選了照樣開畫面（進完成畫面）。
10. **評分後**先寫紀錄換卡，再做滑入；沒有滑出。回看與換卡的滑動照試作外掛（0.11／0.16 秒）。
11. **技術債 A1 與「卡組讀不到就整個重試」沒碰**：兩件都要改 `src/state/`（W6 限制第 1 點不改），排程交給 Fable（[交接單](w6-handoff.md)第 2 節）。
12. ESLint 的 `allowDefaultProject` 上限從 30 提高到 60（檔案數超過 30）。
13. 建置測試的開發版記號：正式版現在會用 `metadataCache`（出處），記號改成命令 id 前綴 `"dev-"`，再加 W6 的命令代號與 Electron 呼叫。

這個 session（Opus 5.5，Windows 實測與修正）：

14. **Windows 實測不用 computer-use 截圖**：computer-use 截到的 Obsidian 是舊畫面，而且 Obsidian 被當成「被遮住」（`visibilityState: hidden`、`requestAnimationFrame` 不跑、計時器被放慢）。改由開發命令 `ui` 打開真的複習畫面，用 DOM 事件按鍵與點擊（按鍵送到目前有焦點的元素，和真的鍵盤一樣），用 Electron 的 `capturePage()` 截圖；量測期間 `setBackgroundThrottling(false)`。真的中文輸入法組字只用 `isComposing` 模擬。
15. **焦點留在 `.ec-app`**：每次 render 之後焦點不在畫面裡就移回 `.ec-app`。實測發現打開時焦點在外層、打字卡答完或按鈕消失時焦點掉到 body，Space、1～4、Esc 都沒反應。
16. **第 3 步照打的即時比對改成照位置比**（`copying`）：用編輯距離對齊時漏打的字母標不到「你打的」那一行（打 `mnd` 畫面上沒有任何標記，按確認也沒反應）；現在從打錯的字母起標出，還沒打的不算錯。「你打的／正確拼字」（最後一次打的字）仍用編輯距離。
17. **出處圖示在右下**（W6 §3-8 的文字）；樣式稿放在答案下方左邊。
18. **喇叭排在那段文字的右邊**、和第一行對齊（Markdown 是區塊，原本掉到下一行）。
19. **換卡動畫（約 0.27 秒）期間的按鍵與點擊不算**（試作外掛的做法）；快速連按 ← 會少走幾張。
20. **`review-script`** 用只看得到 W6 範例卡組的 state（其他卡組不列出），寫進這台裝置真正的紀錄檔，最後全部取消；結果檔的 `linesAsExpected` 逐行對照劇本（含 `light（輕的）` 那張的 `retry: not-needed`）。
21. **W6 範例的英文卡組**比 §4 多兩個目標：`go 中翻英`（答案 went、提示 go；「沒印象 → 第 2 步拼對」要有原形提示的卡，`borrow` 的答案等於原形）、`turn off | switch off`（一個答案等於原形）。`borrow 中翻英` 照 D-069 要等英翻中記得才出，第一天不會出現。
22. **「打開」量測**從在選單選了科目（`startReview`）算起，不含命令面板與選單。
23. **§4 以外多的開發命令**：`w6-save`（按 W6 範例的存檔按鈕）、`decks`（卡組內容的雜湊，W6 與 J4 比對用）、`open-times`、`ui`、`errors`（開發版收集 `console.error`）。
24. **完成畫面也算「畫好」**：評分後換成完成畫面時，「按自評到下一張畫好」的量測在完成畫面記下（原本等到下一張卡才算，量到 1,993 ms）。
25. **「版本」命令**（§7 前提「做法由實作決定」）：`tools/build.mjs` 把 `manifest.json` 的版本加 git commit（有未提交的修改時加 `.dirty`）寫進 `main.js`，例如 `0.0.1+7242db0`；不改 `manifest.json`（W6 不准改的檔案），也不在執行時讀 manifest（iCloud 可能先同步到新的 manifest，更新與相容的規畫第 1 點）。
26. **`typed` 是 null 只在「整格不能當打字答案」時**（W6 說明的寫法）；有空段或中文的 invalid 照舊留著拆開的陣列。兩種都讓目標停出、不會出題。

## 行為與風險

- 公開介面的改動：`Prompt` 問答題的 `typed` 變成 `readonly string[] | null`；`ProblemCode` 加 `typed-answer-words`（hint）；卡組模組加 `baseForm`；`checkTyped` 對中任一個；`NewEntry` 加 `retry?`；`state/index.ts` 重新匯出 `deviceCode`、`isDeviceCode`（A7，行為不變）。新的 `src/review/`（`createSession` 等純函式）與 `src/ui/`（`openReview`、`registerStart`）；`main.ts` 加 `startReview` 與 `PluginEvents.review`。
- 不可破壞的性質：
  - 同一份卡組原文的 `answer` 與指紋和 W5 相同；`typed` 只是衍生值。
  - 依序 `appendLine` 自己的行，和重新 `mergeHistory` 相同（有 `retry` 的行也一樣）。
  - 評分只看第 1 步；紀錄的 `typed` 是第 1 步、`retry` 是第 2 步；第 1 步 `wrong`／`skip` 一定有 `retry`，跳過第 2 步是 `not-needed`。
  - 沒按自評就離開，什麼都不寫；回看改評分是一行取消加一行新的。
  - 畫面只透過 `state` 拿資料、只經過 `state.answer` 寫；不寫卡組筆記。
  - 開發程式不進正式建置（`tests/build.test.ts`）。
- 測試：`tests/deck.test.ts`（R1、R2、指紋對照）、`tests/study.test.ts`（R3、R4）、`tests/main-wiring.test.ts`（版本命令）、`tests/append-line.test.ts`（R4）、`tests/review.test.ts`（R6～R9、R11、R12、照打的比對、完成畫面的文字）、`tests/review-session.test.ts`（R5、R10，接真的 `createState`）、`tests/quality.test.ts`（邊界規則）、`tests/build.test.ts`（R14）。R13（故意讓 `src/review/` import `react`、`src/ui/` import `planToday` 與 `core/files.ts`）：`npm run check` 三次都在 lint 失敗，已還原，沒有留在 repo。
- 請自己找新的組合，例如：
  - 打字卡：第 2 步按「沒印象」之後又在第 3 步打第二個答案；答案格是 `A | a`（大小寫不同的兩個答案）；原形等於第二個答案；第 1 步拼對第二個答案後回看。
  - 回看：目前這張在第 2 步、輸入框有字時往回看再回來；改評分時 `state.answer` 寫不進去；回看中別台裝置的紀錄讓目前這科做完（`onChange`）。
  - 完成畫面：做完一科時另一科剛好由別台裝置做完；「再複習一些」時 `more` 裡有同一個字的兩個方向。
  - 解析器：F1 的邊界附近，例如網址裡的 `|` 但不是 Markdown 連結（`https://a.test/a|b`）、`$` 出現在價格（`$5`）、只有一個反引號、`[[` 沒有閉合；全形的 `｜`。

## 驗證方式

- Node 24 以上。在 worktree 裡：`npm install`、`npm run check`、`npm run build`。
- Claude 跑過：
  - `npm run check` 全部通過（445 個測試）。
  - `npm run build`：`main.js` 483,921 bytes（W5 第二部分是 165,986；多的是 React、react-dom、Motion 與畫面），require 只有 `obsidian`、`@codemirror/state`、`@codemirror/view`；開發版 549,502 bytes。`styles.css` 第一段是 `src/ui/tokens.css`（有測試）。
- Windows 版 Obsidian 1.14.5（開發版；結果檔在測試 vault 的 `Essence W6/結果/`，測試 vault 的位置不寫進 repo，要看時問使用者）：
  - **W1 自動複習**（`review-script Windows-c50c 2026-10-26 235539.json`，建置 `0.0.1+7242db0`）：寫進紀錄的 6 行和劇本相同（`linesAsExpected: true`；英翻中 `good`；打字卡 `near`、`typed: wrong`、`retry: wrong`；原形等於答案的 `light` `near`、`typed: wrong`、`retry: not-needed`；`go` `miss`、`typed: skip`、`retry: right`；改評分是取消加 `easy`）；翻面前、0.3 秒內、不能按的評分都沒有作用；第 1 步按「沒印象」的那張改不了；回到目前這張沒換。最後取消 4 筆，新讀的 `today` 與 `progress` 和開始前相同；紀錄只在 `Essence Cards/紀錄/2026-10 Windows-c50c.jsonl` 多 10 行。
  - **W2 畫面**（`畫面 2026-10-26 234050/`，46 張，淺色與深色各一張）：見下方〈W2 截圖〉。
  - **W3 鍵盤**（`ui Windows-c50c 2026-10-26 234156.json`）：打開後直接按 Space 翻面；翻面後馬上按 3 沒有作用、過 0.3 秒按 3 換下一張；Enter 翻面、4 自評；← 一張一張回看到第一張再按 ← 彈回、→、點「回到目前」；組字中的 Enter（`isComposing`）不送出、Enter 送出；打字卡答完後 1～4 照樣有作用；Esc 關掉。
  - **W4 速度**：這次載入第一次打開 27 ms、之後 16、16 ms（`open-times … 234044`；門檻 1,000／400）；按自評到下一張畫好 14 次，中位數 12 ms、最大 22 ms（`ui … 234156`）。量測期間視窗是 `hidden`、背景節流關掉（第 14 點）。
  - **W5 朗讀**（`voices … 121849`）：系統語音 3 個都是 `zh-TW`，英文 0 個；`say` 連叫兩次只提示一次，沒有用中文語音念。
  - **W6 寫入**（`decks … 121834`、`decks … 235546`）：W5、W6 範例四篇卡組的長度與雜湊在所有實測前後相同（W6 範例在 `w6-save` 補 ID 之後才記基準）；紀錄只在這台裝置的那一個檔追加（6 → 140 行，全部互相取消）。`errors`：沒有 console 錯誤。
- 沒跑：iPhone 實機（§7，L2 之後）、真的中文輸入法、觸控手勢。

### 相容性差異

- **§0-1**：W5 讓含連結、行內程式碼、公式或 `\|` 的中翻英答案通過解析（但學生打不對）；W6 改成 `typed-answer-invalid`、目標停出，家長改寫答案就好。
- **多答案卡不向下相容 W5**（F4）：W5 把 ` | ` 的整串當一個答案。W5 沒有複習畫面，現在不會發生；之後在 iPhone 換到 W6 版（「版本」命令看得到建置）之前，不要在 iPhone 複習含 ` | ` 的卡。W5 讀 W6 寫的紀錄（含 `retry`）沒有問題。

### W2 截圖

每一組是同一個畫面的淺色與深色。Claude 每一組至少看過一張（有幾組看的是前一輪同一個畫面的截圖，那一輪之後只改了喇叭的位置、出處圖示的位置與照打的空白比對列），其餘用 `ui` 結果檔裡每一步記下的畫面文字（按鈕、提示、線上的字、焦點）對照。

| 檔名 | 看到什麼 |
|---|---|
| 01、02 選單 | 命令「開始複習」打開的 `SuggestModal`：「自然　0/12　約 3 分鐘」「英文　0/7　約 2 分鐘」，左側功能區有學士帽圖示 |
| 03、04 自然 正面 | 全螢幕蓋住 Obsidian；上方「‹ 還剩 7 張 ✕」與細進度條；灰色「新」加「自然 › 國二上 › 2-2 水溶液」；題目 24px；底部只有「顯示答案」 |
| 05、06 圖 背面 | 答案的粗體有紫色底線；答案和詳解之間一條 24px 的短線；自己畫的擴散示意圖（SVG）正常顯示；右下打開的書的圖示；四個自評鍵只有色點和文字 |
| 07、08 填空 正面 | 一行三個空格，都是和題目同色的底線，不顯示字數 |
| 09、10 填空 背面 | 「高」「小」「攪拌」粗體寫在線上，線變紫色 |
| 11、12 多行答案 出處 | 三行答案、每行的粗體重點有紫色底線；點書的圖示後出現「溶液的種類 ↗」（段落標題，找得到） |
| 13、14 公式 出處 | `$…$` 用 MathJax 顯示成分數；出處「p.46 ↗」可點、「1-3 p.20」（跨單元）照文字顯示 |
| 15～18 長答案 | 七段的長答案；捲到最底時最後一段「延伸：…」和右下的出處圖示都看得到，自評鍵固定在底部 |
| 19、20 回看 | 上方換成「回到目前 ›」；當時按的「記住了」有底色；一般科目的卡沒有喇叭 |
| 21、22 自然 完成 | 「自然的份完成了！」「還有英文 5 張」「接著做英文」，底部「結束複習」 |
| 23～26 英翻中 | 上方多了「自動朗讀」開關（關）；題目 `borrow` 右邊有喇叭；背面「例句：…」旁邊有喇叭 |
| 27、28 打字 第 1 步 | `You have to` 後面四條一樣長的線（`make up your mind` 四個字）；輸入框寫「輸入英文」；底部「沒印象」與「確認」（還沒打字不能按）；沒有喇叭 |
| 29、30 第 2 步 | 紅色「不對」加「提示：make up one's mind」；沒有答案、沒有標拼錯的字母；輸入框清空 |
| 31～34 第 3 步 | 線上寫出答案、線變紫色；「你打的 make up your m~~a~~nd」「正確拼字 make up your m**i**nd」；輸入框寫「照著打一次」；打 `make up your mnd` 時 `nd` 被劃掉；沒有「沒印象」鍵 |
| 35、36 打字 結束 | 照打對了之後只剩「沒印象」「差一點」兩個自評，靠左照四個時的位置 |
| 37、38 原形等於答案 | `light（輕的）` 按「沒印象」直接到第 3 步（沒有提示那一步）；「你打的 —」「正確拼字 light」 |
| 39、40 拼對 | `went` 第 1 步拼對：打勾加答案，只剩「記住了」「太簡單」；記憶錨點在詳解裡 |
| 41、42 第二個答案 | 打 `switch off` 拼對：線上寫 `switch off`（對中的那一個），背面照原文顯示 `turn off \| switch off` |
| 43、44 今天的份 | 「今天的份完成了！」「今天複習了 14 張・約 1 分鐘」「再複習一些」 |
| 45、46 再複習一些 | `more` 也沒有了：「又多複習了一些」，只有「結束複習」 |

## 已知的縫隙

- 喇叭：`go → went → gone` 這種用箭頭連起來的字會拆成好幾段，記憶錨點那一行排了四個喇叭（`englishParts` 照英文字元切；截圖 39、40）。
- 回看的卡仍標「新」（是這次第一次出的卡；回看時沒有另外拿掉）。
- `Markdown.tsx` 的 `useLayoutEffect` 依賴整個 `props`，每次 render 都重跑 `applyState`（成本小）。
- 填空題翻面後空格的答案是 `<mark>` 的純文字；公式或圖在 `==…==` 裡沒有處理。
- `host.tsx` 攔截觸控的傳遞；Obsidian 的側欄手勢要在 iPhone 實機確認（試作外掛同樣做法通過）。
- 新裝置的自動朗讀預設關；Windows 沒有英文語音，自動朗讀的實際聲音只能在 iPhone 確認。

## 回報

寫在主資料夾的 `Claude Codex Discussion/<日期>-w6-review.md`（不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 「請特別看」的 8 點逐點寫結論；「Claude 自己選了做法的地方」的 26 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。

## L2 修正後的再審（2026-10-27）

**結果**：Codex 在 `3af5c41` 再審通過（F4 以外可以合併），回報在報告最後的〈再審（2026-10-27）〉（`main` 的 `9c37030`）；測試替身的限制見那一節第 3 點。

第一次審查的結果在[報告](<../Claude Codex Discussion/2026-10-27-w6-review.md>)（`main` 的 `abaa654`）。Claude（Opus 5.5）已核對：F1～F3、F5、F7 都先照報告的觸發寫成會失敗的測試，確認重現才修（F1 正是報告的四行 `good`、`good`、`undo`、`miss`；F3 正是 `say → stop`）；F6 先在 Windows 版 Obsidian 用真的 Tab 鍵重現焦點跑出畫面，再修。修正在同一個分支：

- 待審 commit：`3af5c41`（`claude/w6`，程式）；這一節在它之後的文件 commit。只看這一段：`git diff 0a99e60 3af5c41`（8 個檔案）。
- 規格沒有改。F4、S1、S2 與自選第 10、22 點照 D-140 交給 Fable 決定（問題清單在 `main` 的 `tasks/w6-l2-questions.md`，`48e7de4`），還沒回覆。

| 項目 | 怎麼修 | 測試 | commit |
|---|---|---|---|
| F1 | `Review.tsx`：換卡動畫期間（`busy`）的檢查移到 `rate()` 最前面（回看改評分的分支之前）；翻面、確認（含輸入框的 Enter）、沒印象也先查；打字卡的「沒印象」「確認」在動畫期間不能按 | `tests/review-ui.test.ts`「F1 回看換卡的動畫還沒結束就按數字鍵…」「F1 動畫期間的翻面、確認、沒印象也不算…」 | `465735d` |
| F2 | `session.ts`：拿掉 `finished` 快取，完成畫面的文字每次照當下的 `progress()` 與今天的紀錄算；沒有目前這張時（完成畫面），`onChange` 與回看改評分都重新問 `next`。有一張未作答的卡時照舊不換 | `tests/review-session.test.ts`「R10 完成畫面跟著變…」「R10 完成畫面回看改成沒印象…」；「R10 回看改評分時目前有一張還沒作答的卡…」修正前就通過，是要保住的規則 | `52afb50` |
| F3 | 換卡的 `speech.stop()` effect 移到念新題目的 effect 前面（effect 照宣告順序跑） | 「F3 自動朗讀…」：第一張與換卡後最後一個呼叫是 `say`（換卡時先 `stop` 再 `say`）；回看、回到目前、關掉開關都停 | `465735d` |
| F5 | `ui/sources.ts`：所有材料都沒有精確的錨點時，沒寫字母的圖依材料順序找第一份有它子圖的，取字母最前的；再沒有才打開第一份材料 | 「F5 出處的圖省略子圖字母…」：省略字母、明寫 A／B、不同材料、精確錨點優先於前一份材料的子圖、完全不存在、`2-1` 不對到 `2-12`／`2-13a`、頁碼 | `dbc8a6e` |
| F6 | `host.tsx`：全螢幕那一層攔 Tab：從最後一個 Tab、從第一個或畫面本身 Shift+Tab 時繞到另一端（試作外掛的做法；Tab 會停的元素含 Obsidian 渲染的連結與音檔，只算看得到的） | 開發命令 `ui` 多三步，用 Electron 的 `sendInputEvent` 送真的 Tab（DOM 的 `KeyboardEvent` 不會移動焦點）。修正前（`ui … 2026-10-27 022118`）：從畫面本身 Shift+Tab → `畫面外：… empty-state-action`；修正後（`022314`、`022718`）：→ 最後一個自評鍵，從它 Tab → ✕；之後從按鈕上按 3 照常換卡，最後 Esc 照常關掉 | `3af5c41` |
| F7 | `Review.tsx`：目前這張的第 2 步拼對（`second` 是 `right`）時畫打勾與答案；回看照 §2-5 顯示第 1 步打的字與比對 | 「F7 第 2 步拼對…」 | `465735d` |
| 測試名稱 | 原本的「回看時目前這張還在第 2 步」改成第 3 步（borrow 跳過第 2 步），另加真正第 2 步、輸入框有字的案例 | 「R10 回看時目前這張在第 3 步…」「R10 回看時目前這張在第 2 步、輸入框有字…」：回來時「不對」、提示、打的字都在；回看中打字、確認、沒印象都沒有作用 | `52afb50` |

畫面元件的測試替身（`tests/helpers/review-ui.ts`）仿你的重現方式：esbuild 把真的 `Review.tsx` 包成 CommonJS，`react`、`react/jsx-runtime`、`motion` 換成替身，`Markdown.tsx` 換成不畫東西的元件；只跑一個根元件的 hook（effect 照宣告順序、deps 沒變不跑、先跑全部的 cleanup 再跑新的、layout 先於 passive），子元件沒有 hook、直接展開成樹；`requestAnimationFrame` 用 `setImmediate`，Motion 替身可以讓動畫停在半路。沒有加套件（W6 限制第 2 點）。五個畫面測試在修正前的程式上都失敗；F1 第二個測試的打字卡那段，另外只補上翻面的檢查再跑一次，仍然失敗（變成第 3 步）。

和你的建議不同的地方：

- **F1**：動畫期間只擋會改步驟或紀錄的動作（自評、改評分、翻面、確認、沒印象）；**輸入框打字與 Esc、✕ 不擋**：受控的輸入框擋了會掉字，Esc 關掉什麼都不寫。評分後的滑入（0.16 秒）沒有設 `busy`：滑入的是還沒翻面的新卡，自評本來就要翻面再等 0.3 秒。
- **F2**：完成畫面重新問 `next` 時也可能拿到**別的卡**（例如家長在電腦的卡組加了目標、同步過來），這時完成畫面直接換成那張；完成畫面上沒有未作答的卡，不違反「目前這張不換」。
- **F5**：第一張子圖取**字母最前的**，不照材料裡出現的先後；只對**圖**做（syntax §2-5、D-094 只說圖有子圖），表與例題照舊只找精確的錨點。
- **F6**：沒有 Node 的測試：焦點移動要真的 DOM，W6 不准加 DOM 的套件；回歸檢查放在開發命令 `ui`（每次 Windows 實測都跑）。沒有做背景的 `inert`。
- 26 點裡跟著改的：第 4 點（完成畫面例外，F2）、第 15 點（加 Tab 環繞，F6）、第 19 點（動畫期間擋的範圍，F1）。第 10、22 點等 Fable。其他照你的回覆。

Claude 跑過：

- `npm run check` 454 個測試全部通過（`3af5c41`；多的 9 個是上表的測試）。
- `npm run build`：`main.js` 484,671 bytes（多 750 bytes），版本 `0.0.1+3af5c41`，require 只有 `obsidian`、`@codemirror/state`、`@codemirror/view`；開發版 550,721 bytes。
- Windows 版 Obsidian 1.14.5，開發版 `0.0.1+3af5c41`（結果檔在測試 vault 的 `Essence W6/結果/`）：
  - `review-script`（`2026-10-27 022557`）：`linesAsExpected: true`；全部取消後 `today`、`progress` 和開始前相同；每一步的畫面階段和 10-26 那次（`235539`）相同（不算時間）。
  - `ui`（`022718`）：56 步沒有出錯；Tab 三步見 F6，其他 53 步的畫面文字和修正前那次（`022118`）相同；打開 33 ms，按自評到下一張畫好中位數 10 ms、最大 26 ms（`022314` 那次有一筆 551 ms，那次視窗是 `visible`，下一次沒有再出現）。
  - `decks`（`022541`）：四篇範例卡組的長度與雜湊和 10-26（`235546`）相同；紀錄只在這台裝置的那一個檔追加（150 → 210 行，全部互相取消）。
  - `errors`（`022725`）：沒有 console 錯誤。
- 沒跑：iPhone（§7，等 `claude/state-load` 合併後）；有英文語音的實際朗讀（F3 的修正要在 iPhone 聽，§7）；真的中文輸入法、觸控。

請查：

1. 這段差異和上表每一項的說明是否一致，修正有沒有改到別的行為：特別是 F2 在完成畫面重新問 `next`（`onChange` 與改評分）對回看、`continueWith` 與開發版量測的影響；F1 擋與不擋的範圍。
2. 用你第一次的四個重現腳本（`review-session-probes`、`review-ui-probes`、`review-misc-probes`、`review-error-probes`）在 `3af5c41` 重跑：F1、F2、F3、F5、F7 的反例與第一次通過的組合是否都過。
3. 測試替身本身：effect 的順序、`useSyncExternalStore`、ref 的模擬，是否足以代表 React 19 的行為，會不會讓測試在不該過的時候過。
4. 相鄰的新組合，例如：
   - F1：評分後滑入中按 ←；連按兩次 →；動畫中按 Esc；打字卡在動畫中打字。
   - F2：回看中別台裝置的紀錄讓完成畫面換成新卡、再回到目前；「再複習一些」的完成畫面上改評分；完成畫面上改成差一點（不是沒印象）。
   - F5：子圖在第二份材料、精確的錨點在第三份；同一份材料同時有 `fig2-13` 與 `fig2-13a`。
   - F6：卡片內容有 Obsidian 的連結或音檔時的 Tab 順序；打字卡輸入框裡的 Tab、Shift+Tab；完成畫面。
   - F7：第 1 步按「沒印象」、第 2 步拼對。
5. 下一節〈五題的回覆與合併 `main`〉的改動。

## 第二次再審：五題的回覆、S1 與合併 `main`（2026-10-27 下午）

**結果**：`main` 的[報告](<../Claude Codex Discussion/2026-10-27-w6-review.md>)〈第二次再審（2026-10-27）〉：指定範圍通過，另有 R1（P2）、R2（P3）兩項要在合併前修，見下一節。

使用者因額度改請 Codex（Astra，high）代 Fable 回答五題（問題清單與回覆在 `main` 的 `tasks/w6-l2-questions.md`），結論寫進 `main` 的 W6 說明（`7009ede`：§2-1、§0-1、§3-2、§3-4、§4、§6、§7 的 J7、J8）。S1 照 D-140 先做格式查核（[回報](<../Claude Codex Discussion/2026-10-27-w6-s1-format-review.md>)），F1～F3 都採用，寫進 W6 說明 §0-1 與 syntax.md §2-3（`main` 的 `3ea96de`）。

- 待審：分支 `claude/w6` 的 `11a3ef1`（含這一節的文件 commit 在它之後）。上一次再審的 `3af5c41` 之後，程式只有 `d9e50e3`、`0416bac`、`c886425` 三個 commit 與兩次合併 `main`：`git show d9e50e3 0416bac c886425`；合併的衝突解法用 `git show --remerge-diff 69dbda4`（`11a3ef1` 沒有衝突，remerge-diff 是空的）。`main` 那邊的程式（state-load）已在 `main` 上審過，不用重審，只看交界。
- 不用重審 F1～F3、F5～F7（`3af5c41` 已通過）。

| 項目 | 怎麼做 | 測試 | commit |
|---|---|---|---|
| F4 | `Session` 加 `pause()`、`resume()` 與 `AWAY_LIMIT`（60 秒）：`hidden` 連續超過 60 秒（剛好 60 秒不算）才讓目前這張未評分的卡從頭開始：一般卡回到正面、打字卡回到第 1 步，輸入與這一次的作答結果清空、`revealedAt` 歸零（0.3 秒重新算）；不寫紀錄；回看的位置與已評分的快照不動；回看中重設的，回到目前不補播自動朗讀；完成畫面不動。`CardView.shown` 每次從頭開始加一，畫面把它算進 `cardKey`（捲回最上面、收起出處、先停再念）。`host.tsx` 接 `visibilitychange`：`hidden` 時停朗讀並 `pause()`，回來時 `resume()`，量測記 `away`（毫秒與有沒有重設）；關掉畫面時拿掉監聽 | `tests/review-session.test.ts`「F4 切走超過 60 秒…」「F4 打字卡切走超過 60 秒…」「F4 回看時切走超過 60 秒…」「F4 英翻中切走超過 60 秒…」；`tests/review-ui.test.ts`「F4 切走超過 60 秒回來…」。都先失敗 | `d9e50e3` |
| S2 | `src/review/keyboard.ts` 的 `keyboardFit`（純函式）：看得到的區域比 `innerHeight` 矮 1 px 以上、而且 `scale` 是 1 時，回傳要改成的上緣（`offsetTop`）與高度；系統已經縮小版面、放大、沒有 `visualViewport` 時是 null。`host.tsx` 在 `visualViewport` 的 `resize`、`scroll` 與打開時套用，null 時清掉（復原）；開發版量測記 `keyboard`：兩個高度、上緣、有沒有調整、`.ec-input` 與 `.ec-actions` 在不在看得到的區域（數字變了才記，最多 40 筆） | `tests/review.test.ts`「§3-2 鍵盤…」（先失敗）。實際有沒有擋住只能 iPhone 驗（J7） | `d9e50e3` |
| 第 10 點 | 規格改成實作的樣子（評分後只滑入，回看才滑出；減少動態效果時兩種都直接換）；程式只改註解 | — | `d9e50e3` |
| 第 22 點 | `openedAt` 改名 `pickedAt`、量測的 `openedMs` 改名 `fromPickMs`、`open-times` 的結果欄位同改；註明不含選單與 `state` 載入 | 型別檢查；開發命令的結果檔 | `d9e50e3` |
| 合併 `main` | `claude/state-load`（卡組或紀錄讀不到就跳過那一篇）與文件檢查。衝突：`tests/helpers/memory-files.ts` 取 `main`（A9 的 cherry-pick 加 state-load 的改動）、`tests/helpers/obsidian.ts` 取 W6（`main` 在 A9 之後沒改過）；`tests/state*.test.ts`、`study-io.test.ts` 取 `main`（W6 這邊和 `main` 的 A9 cherry-pick `cdcb45a` 逐字相同）；`tests/boundaries.test.ts` 的 deck 匯出取聯集（`baseForm`、`listDeckPaths`）；`docs/backlog.md` 保留 W6 拿掉的 A7、A10。另外補了兩份分支上任務檔的狀態行（文件檢查要求） | `npm run check` 495 個通過 | `69dbda4` |
| 開發命令 `away` | 送 `visibilitychange`（換成假的 `visibilityState`），5 秒與 61 秒後回來。原本用 Electron 把視窗最小化再還原，但這台 Windows 上 Obsidian 被別的視窗擋住也算 `hidden`，還原後一直沒變回 `visible`，命令卡在等畫面（那一次在約 120 秒的 `hidden` 之後回到 `visible`：卡回到正面、沒有新紀錄，是真的切換的證據） | 結果檔 `away … 123434` | `0416bac` |
| S1 | `parse.ts` 的整格檢查（同一個正規式，拆開之前）多擋任何位置不分大小寫的 `http://`、`https://`，全形 `｜`，以及 ASCII 的 `[`、`]`、`<`、`>`（原本的 `[[`、`](` 包含在內；格式查核 F1 的角括號與參照式連結）。拒收時訊息、`answer`、指紋照舊，整個學習目標停出（D-089 第 10 條）。沒有 `http(s)://` 的 `www.a.test`、`mailto:` 照一般文字 | `tests/deck.test.ts`「R1 S1 網址、全形｜、括號就是 typed-answer-invalid」16 例（查核邊界表與 F1 的表，指紋和同題的英翻中比）、「沒有 http(s):// 的網址照一般文字」4 例、「一題是網址就整個目標停出」、「只看 :: 右邊的答案格」。前 17 個先失敗，後 5 個本來就通過（防止以後誤傷） | `c886425` |
| 合併 `main`（第二次） | `main` 的 S1 規格、`3af5c41` 的再審報告、D-143 的文件檢查（拿掉字數上限）。沒有衝突；`docs/backlog.md` 自動合併，和 `main` 只差 W6 自己的四處（刪 ` \| ` 那一列、light 那一列只留一半、刪 A7、A10） | `npm run check` 516 個通過 | `11a3ef1` |

Claude 跑過：

- `npm run check` 516 個測試全部通過（`11a3ef1`；`c886425` 是 517 個，合併後 `tests/check-docs.test.ts` 少一個字數上限的測試）。`npm run build`：`main.js` 486,610 bytes，require 只有 `obsidian`、`@codemirror/state`、`@codemirror/view`；開發版 554,050 bytes。
- Windows 版 Obsidian 1.14.5，開發版 `0.0.1+11a3ef1`：
  - `review-script`（`150842`）：`linesAsExpected: true`，和 `123703` 相同（不算時間）。
  - `ui`（`151017`）：56 步和 `123815` 相同；從選了科目到第一張 30 ms；按自評到下一張中位數 11 ms、最大 21 ms（這次沒有慢的那一筆）。
  - `decks`（`151018`）：和 `123817` 相同，只有這台的紀錄檔行數變多（330 → 370，`review-script` 與 `ui` 寫的，全部互相取消）。
  - `errors`（`151021`）：沒有 console 錯誤。
  - `away`（`151156`）：5 秒回來仍是翻面、`restarted: false`；61 秒回來回到正面、`restarted: true`；沒有新紀錄。
- 以下是 S1 之前（`0416bac`）的紀錄：
- `npm run check` 495 個測試全部通過（`0416bac`；合併前 460 個，多的 35 個來自 `main`）。
- `npm run build`：`main.js` 486,602 bytes（`69dbda4`），require 只有 `obsidian`、`@codemirror/state`、`@codemirror/view`；開發版 554,042 bytes。
- Windows 版 Obsidian 1.14.5，開發版 `0.0.1+0416bac`（`open-times` 是 `69dbda4`、`away` 是同內容未 commit 時的建置）：
  - `review-script`（`123703`）：`linesAsExpected: true`，`today`、`progress` 回到原樣，每一步和合併前（`022557`）相同。
  - `ui`（`123815`）：56 步的畫面文字和合併前（`022718`）相同，沒有出錯；這次載入第一次打開（從選了科目）29 ms；按自評到下一張中位數 12 ms、最大 228 ms。
  - `open-times`（`121758`）：從選了科目到第一張 32、32、31 ms。
  - `away`（`123434`）：翻面後切走 5 秒回來仍是翻面、`restarted: false`；切走 61 秒回來回到正面、`restarted: true`；紀錄沒有多。
  - `decks`（`123817`）：四篇範例卡組和 10-26 的基準相同；紀錄只在這台的那一個檔追加（全部互相取消）。
  - `errors`（`123821`）：沒有 console 錯誤。
  - 「按自評到下一張」偶爾有慢的一筆：5 次 `ui` 裡 2 次，551 ms（`022314`，第 7 次評分）、208 與 228 ms（`123815`，第 5、8 次），不是同一張卡，合併前後都有；其他 3 次最大 22～26 ms。W4 沒有最大值的門檻，iPhone 的 J1 超過 400 ms 要回報，那時再看。

這一段請查：

1. F4：`pause`／`resume` 的邊界（剛好 60 秒、重複 `pause`、沒有 `pause` 的 `resume`、載入中、完成畫面、回看中、動畫中）；`shown` 讓畫面換卡的副作用；`host.tsx` 的監聽與關掉時的清理；`main.ts` 原本的 `visibilitychange`（寫完排隊的紀錄）照舊。
2. S2：`keyboardFit` 的條件夠不夠（1 px、`scale` 的容差、`offsetTop`）；`.ec-fullscreen` 是 `position: fixed; inset: 0`，同時設 `top` 與 `height` 時 `bottom` 被忽略，清掉時復原；量測會不會太多或漏掉鍵盤收起。
3. 合併的衝突解法有沒有丟掉任何一邊的改動；state-load 的「讀不到就跳過」和複習畫面的交界，例如完成畫面上一篇卡組恢復讀得到（F2 會重新問 `next`，可能直接換成新卡）。
4. 第 22 點的改名有沒有漏掉的地方（規格、程式、開發命令、驗收文字）。
5. S1：`c886425` 和 `main` 的 W6 §0-1、syntax.md §2-3 一致；查核回報的邊界表與 F1 的表每一列都有測試；英翻中、一般翻面題、資料欄位、題幹與背面補充不受影響。
6. 真的 React／DOM（你上次再審第 3 點）：F4 的畫面測試用的是替身，`away` 命令在 Obsidian 只看「有沒有翻面」。請用你上次的無頭 Chrome（真的 React 19）驗 F4 換 `cardKey` 之後：捲回最上面、出處收起、焦點在 `.ec-app` 或新的輸入框、先 `stop` 再念英翻中的題目；打字卡回到第 1 步時輸入框是空的。

回報接在第一次報告的最後，標題「第二次再審（2026-10-27）」，格式同第一次；沒有問題就寫「可以合併」（W6 的合併還要等 iPhone 測試，§7）。只審查、只回報。

## 第三次再審：R1、R2 的修正（2026-10-27 晚上）

第二次再審的 R1、R2 都照建議修，先寫會失敗的測試。R2 的同一類問題 `Review` 裡還有一處：手勢量測 0.5 秒後才回報（`Review.tsx` 的 `window.setTimeout`），在這 0.5 秒內關閉也會晚到；所以不在每個地方各自檢查，改成 `host.tsx` 統一把關。

- 待審：分支 `claude/w6` 的 `6f96883`（含這一節的文件 commit 在它之後）。只有兩個 commit：`git show 75683b6 6f96883`，改的是 `src/ui/host.tsx` 與新的 `tests/review-host.test.ts`。
- 不用重審第二次再審已通過的部分。

| 項目 | 怎麼做 | 測試 | commit |
|---|---|---|---|
| R1 | 回到前景時先 `const restarted = session.resume()`，再回報 `away`；重設不再靠量測的 callback | `tests/review-host.test.ts`「R1 離開超過 60 秒回來…」有、沒有 `onEvent` 各跑一次：5 秒、剛好 60 秒不重設，60 秒又 1 ms 回到正面（`shown` 1），每次切走都停朗讀，不寫紀錄；沒有 `onEvent` 時畫面拿到的 `onEvent` 也是 `undefined`。沒有 `onEvent` 的那次先失敗 | `75683b6` |
| R2 | `host.tsx` 做一個 `report`：關閉後丟掉所有量測，`closed` 本身在關閉時直接送出、仍是最後一筆。`away`、鍵盤量測（下一幀）與交給 `Review` 的 `onEvent`（換卡在兩幀後、手勢在 0.5 秒後）都經過它；沒有 `onEvent` 時 `report` 是 `undefined`，`Review` 照舊不量。沒有存 rAF ID 取消：同一幀排了好幾筆也由同一個檢查擋住。`75683b6` 先在 rAF 裡檢查 `closed`，`6f96883` 換成統一把關 | 「R2 關閉之後不再回報已經排好的量測…」：鍵盤升起時照常量（`adjusted` 先 false 後 true）、畫面的量測照常；同一幀裡鍵盤收起又升起之後關閉，再送晚到的手勢，最後一筆仍是 `closed`；關閉後的 viewport、visibility 事件也不回報；兩次打開共用一個收集器（像 `watchReview`），第二次只有自己的樣本。鍵盤那段在 `75683b6` 之前失敗（多出 `keyboard 844`、`keyboard 480`），手勢那段在 `6f96883` 之前失敗（多出 `gesture`） | `75683b6`、`6f96883` |

`tests/review-host.test.ts` 用 esbuild 把 `host.tsx` 包成 CommonJS，`Review`、`react-dom/client`、`obsidian` 換成替身，`document`、`visualViewport`、`requestAnimationFrame` 由測試控制，`Date` 用 node:test 的假時鐘，`Session` 與 `state` 是真的（記憶體 Files）。它只驗 host 的接線；你上次指出的替身限制（snapshot、ref、焦點）不在這兩項的路徑上。

Claude 跑過：

- `npm run check` 519 個測試全部通過（`6f96883`）。這台的記憶體這次不夠 knip 的解析器配置大塊緩衝區（`RangeError: Array buffer allocation failed`，和你第二次再審遇到的一樣），完整檢查與 pre-commit 都用 knip 內建的 `KNIP_DISABLE_RAW_TRANSFER=1` 跑，只換解析器的傳輸方式。
- `npm run build`：`main.js` 486,608 bytes，require 只有 `obsidian`、`@codemirror/state`、`@codemirror/view`；開發版 554,048 bytes。
- Windows 版 Obsidian 1.14.5，開發版 `0.0.1+6f96883`（`75683b6` 也跑過一輪，結果相同）：
  - `review-script`（`180755`）：`linesAsExpected: true`，和 `150842` 相同（不算時間）。
  - `ui`（`180907`）：56 步和 `151017` 相同；從選了科目到第一張 39 ms；按自評到下一張中位數 12 ms、最大 16 ms；鍵盤量測一筆（桌面沒有鍵盤，`adjusted: false`）。
  - `decks`（`180909`）：和 `151018` 相同，只有這台的紀錄檔行數變多（全部互相取消）。
  - `errors`（`180912`）：沒有 console 錯誤。
  - `away`（`181022`）：5 秒回來仍是翻面、`restarted: false`；61 秒回來回到正面、`restarted: true`；沒有新紀錄。
- state-load §8「一篇卡組被佔住」（`main` 的 `tasks/state-load.md` §8；它排在 W6 合併 `main` 之後，使用者要求在這次再審前補做）。同一個開發版 `0.0.1+6f96883`，`today` 的結果在 `Essence W5/結果/`，`errors` 在 `Essence W6/結果/`：
  - 基準（`today 181414`）：4 篇卡組，今天的份 19 個目標（自然 12、英文 7）。
  - 18:14:29 另一個 PowerShell 程序用 `[System.IO.File]::Open(…, 'Open', 'Read', 'None')` 獨占 `W5 範例/自然 2-2（卡片）.md`（同一台再讀這個檔確實被擋），18:14:38 `run=reload`。
  - 預期：外掛載入完成，其他卡組照常出現在今天的份。實際（`today 181449`，載入後 11 秒）：照常載入，3 篇卡組，今天的份 14 個（自然 7、英文 7）；少的就是那一篇的 5 個，`problems` 是 0。Obsidian 的 `vault.read` 在獨占鎖下確實失敗（`EBUSY: resource busy or locked`），沒有讀到快取，這個情境在 Windows 做得出來。
  - 預期：`run=errors` 看得到每次重試的錯誤。實際（`errors 181645`）：8 筆 `Essence Cards read Error: EBUSY…`，在 18:14:38、:39、:41、:45、:53、15:09、15:41、16:41，間隔 1、2、4、8、16、32、60 秒，和 state-load §2-1 的退避相同。
  - 預期：出現一次讀不到的提示。這一項沒有直接看到：§8 不用 computer-use 截 Obsidian，開發命令也不記這個 Notice。8 筆 console 錯誤都經過 `main.ts` 的 `report()`，照程式只在第一次出 Notice（`warned`）。
  - 預期：釋放鎖之後最多等 60 秒，那一篇出現在今天的份，不用重載。18:16:57 結束那個程序（釋放鎖），沒有重載：18:17:34（`today 181734`）仍是 3 篇、14 個；18:17:51（`today 181751`）是 4 篇、19 個，和基準相同（不算時間）。時間和排好的下一次重試相符（前一次 16:41 再加 60 秒＝17:41，放開後約 44 秒）；檔案內容沒變，不會有檔案通知。之後沒有新的錯誤（`errors 181801` 仍是 8 筆）。
  - 複習畫面：開始複習的選單照 `progress()` 一科一列，讀不到的期間「自然」是 7 張而不是 12 張，畫面上沒有說少了哪一篇；只有載入時那一次提示。`ui` 命令只用 W6 範例的卡組，看不到這個差別，所以這段是從 `today` 的 `progress` 和 `src/ui/start.ts` 推的，沒有截圖。要不要在畫面上列出讀不到的卡組，照 `main` 的 backlog 技術債表那一列，W6 合併之後再決定。

這一段請查：

1. R1：量測的 callback 是否還控制任何功能（`host.tsx` 裡 `onEvent`、`report` 用到的每一處；`fit` 沒有 `report` 時提早返回，只跳過量測，版面調整在它之前）。
2. R2：關閉後還有沒有任何量測會送出（host 的 rAF、`Review` 的兩幀後與 0.5 秒後的回報、`render-failed`）；`closed` 是不是一定是最後一筆；沒有 `onEvent` 時 `Review` 的行為和以前一樣。
3. 用你上次的真實 Chrome driver 重跑名稱以 ISSUE 開頭的兩組，確認現在是正確行為。

回報接在報告最後，標題「第三次再審（2026-10-27）」，格式同前；沒有問題就寫「可以合併」（W6 的合併還要等 iPhone 測試，§7）。只審查、只回報。
