# W6 格式查核的處理（給 Claude，本機執行）

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)：判斷已經在這份說明做完，這裡只照著改文件）。請新開一個 session。

Codex 對 W6 開工前的格式查核回報在 [`Claude Codex Discussion/2026-10-26-w6-format-review.md`](<../Claude Codex Discussion/2026-10-26-w6-format-review.md>)（基準 `90854e6`，回報 commit `8e2fb28`）：F1～F4 是 P2、F5～F6 是 P3，沒有 P1。Fable 2026-10-26 逐條核對過，六項都成立，採用方式寫在下面。這份說明的工作是**只改文件**：把下面的內容寫進 [tasks/w6.md](w6.md) 與 [docs/syntax.md](../docs/syntax.md)，commit 到 `main`，然後 W6 才能照 w6.md 開工。不改程式。

## 基準與條件

- 先 `git pull`。基準是這份說明所在的 commit（`git log -1 --format=%h -- tasks/w6-format-review-fixes.md`）。
- 改之前讀：Codex 的回報全文、`tasks/w6.md` 的 §0-1、§1、§2-1、§2-3、§2-5、§5 的 R1／R4／R5／R10、〈開工條件與基準〉、〈完成後〉；`docs/syntax.md` §2-3 與 §5 的欄位表。其他不用讀。
- **F3 的決定**：採用 Codex 建議的 `retry: not-needed`（下面照這個寫）。使用者若在這份說明的 commit 之後另有決定，以使用者為準；F3 一節最後有「不採用時怎麼寫」。
- 只 stage 自己改的檔案；commit 訊息 `docs: apply Codex's W6 format review (F1-F6)`。

## 逐項採用

### F1｜打字答案的格式邊界（採用 Codex 的最小寫法）

W5 允許答案格有連結、行內程式碼等 Markdown（syntax §2-6），又要求中翻英的答案是單字或片語（§2-3），兩條沒有交會；逐字拆 `|` 會把 `[[word|borrow]]`、`` `a | b` ``、`\|`、URL 裡的 `|` 拆成「答案」。**決定**：中翻英的打字答案只支援單行單字／片語加現有的四種裝飾（`**`、`*`、`_`、`==`），其他 Markdown 不支援，遇到就 `typed-answer-invalid`，不拆。不在 W6 做通用的 Markdown 轉純文字。

**w6.md §0-1** 的第 2～3 點改成（第 1、4～6 點不動）：

> - **先判斷整格能不能當打字答案**：`answer` 含換行（CR 或 LF），或含 `\|`、反引號 `` ` ``、`$`、`[[`、`](`（跳脫的管線、行內程式碼、公式、Obsidian 連結或嵌入、Markdown 連結）：記 `typed-answer-invalid`（error），不拆開、`typed` 是 null。訊息改成「中翻英的答案只能是單行英文單字或片語，好幾個答案用 | 分開；不能有換行、連結、程式碼或公式」。
> - 通過了才照 ASCII `|` 拆開（`a|b`、`a | b`、`a  |  b` 都認得），每一段先去掉 `**`、`*`、`_`、`==`，再去掉前後空白。裝飾可以跨過分隔（`**a | b**`、`==a | b==`、`**a** | ==b==` 都得到 `a`、`b`）。
> - 任何一段是空的（`a | `、`| a`、`a || b`、`a | ** **`）或含中文（沿用 `\p{Script=Han}`）：也記 `typed-answer-invalid`，整題 `ok = false`，不丟掉壞的那段只拿好的出題。
> - 全部有效後才比較字數（照空白切）：不一樣記一個 hint `typed-answer-words`，訊息「好幾個答案的字數不一樣，畫線照第一個」；照樣出題。invalid 的題不再另外給字數 hint。
> - **相容性差異（要寫進回報）**：W5 讓含連結、程式碼或 `\|` 的中翻英答案通過解析，但那種題學生本來就打不對；W6 改成停出並顯示 error，家長改寫答案就好。

**w6.md §0-1 完成條件**加：「上面每一種 invalid（含 F1 列的五種寫法與分隔前後的換行）各至少一個例子，確認只報 error、不給字數 hint；`a | two words` 只報 hint。」

**syntax.md §2-3「中翻英要打字」那一點**改成：

> - **中翻英要打字**（[D-066](decisions.md#d-066-作答方式)）：從名稱判斷，不另寫欄位。答案只能是**單行**的英文單字或片語，程式逐字比對，大小寫與前後空白不算錯。一題可以有好幾個正確答案，用 ` | ` 分開（前後空格可省略，AI 一律寫 ` | `），對中一個就算對；單字有兩種拼法的由 AI 避開或附提示（D-089 第 13 條）。答案可以有粗體、斜體、螢光筆，程式比對時去掉；**不能有換行、連結、嵌入、行內程式碼、公式或 `\|`**，有的話這一題停出，等家長改寫（§2-6 的 Markdown 只適用一般翻面題）。題目指紋照整個答案格算，改寫答案格會換指紋。

**`docs/card-rules/english.md`** 不用改：它的例子已符合，而且 AI 製卡規則本來就只寫單字片語。

### F2｜檢查順序

已併進上面 F1 的寫法（換行在拆之前查、空值在去裝飾之後查、字數最後查）。另把 **w6.md R1** 改成：

> **R1 ` | `**（`deckCases`）：§0-1 的每一條：`made up his mind | made his mind up` → `typed` 兩個、`answer` 與指紋和改之前相同；`a|b`、`a  |  b`；`borrow` 一個；`**a | b**`、`==a | b==`、`**a** | ==b==` → `a`、`b`；`**made** up his mind | made his mind up` 拿掉粗體、指紋仍是這一列自己的值；`a | `、`| a`、`a || b`、`a | ** **`、分隔前後有換行（`a |\nb`、`a\n| b`）、`a \| b`、`` `a | b` ``、`[[word|borrow]]`、`[borrow](https://example.test/a|b)`、`$a|b$`、含中文 → 都是 `typed-answer-invalid` 且沒有 `typed-answer-words`；`made up his mind | decided`（字數不同）是 `typed-answer-words` 的 hint、照樣出題；中翻英以外的問答題 `typed` 是 null。Codex 回報〈answer 與指紋〉表裡的八個指紋值登錄成固定預期值。

### F3｜缺 `retry` 的意思要唯一（採用 `not-needed`）

W5 已經會寫 `typed: wrong`／`skip` 而沒有 `retry`，所以「缺 `retry`」在混合的歷史裡分不出「舊版沒記」和「新版跳過第 2 步」。**決定**：新版第 1 步是 `wrong`／`skip` 時一定寫 `retry`；真的跳過第 2 步（原形是 null，或等於任何一個答案）寫 `not-needed`。多一個值、不建版本遷移；W5 本來就不讀 `retry`。

**w6.md §1** 的 `NewEntry` 型別改成 `retry?: 'right' | 'wrong' | 'skip' | 'not-needed'`；「`retry` 欄位」第 1 點改成：

> - 只寫在打字卡，而且第 1 步是 `wrong` 或 `skip` 時**一定寫**：進了第 2 步就記第 2 步的結果（`right` 拼對、`wrong` 拼錯、`skip` 按「沒印象」）；因為原形是 null 或等於任何一個答案（不分大小寫）而跳過第 2 步時寫 `not-needed`。第 1 步拼對、非打字紀錄不寫。第 3 步照打不記。舊紀錄缺這一欄表示「第 2 步未記錄」，分析時不能當成沒做第 2 步。

**w6.md §2-3** 表格底下第一點補一句：「第 1 步 `wrong`／`skip` 的紀錄一定有 `retry`，跳過第 2 步寫 `not-needed`。」**R5** 的「`borrow 中翻英`…直接第 3 步」那一列預期改成「`typed: wrong`、`retry: not-needed`」；`light（輕的）` 那一列同樣加 `retry: not-needed`。**§4** `review-script` 劇本加一張「原形等於答案」的打字卡，結果檔要看到 `not-needed`。

**不採用時**：`NewEntry` 不加值；§1 改寫成「已知由 W6 寫出的紀錄，缺 `retry` 表示沒進第 2 步；舊紀錄缺欄位表示未記錄，兩者只靠這兩欄分不出來」；R5、§4 不加 `not-needed`；syntax §5 的 `retry` 列照 F6 的替代寫法。

### F4｜W5／W6 混用的限制

**w6.md〈開工條件與基準〉**加一點：

> - **多答案卡不向下相容 W5**：W5 讀 W6 寫的紀錄（含 `retry`）安全；但 W5 拿含 ` | ` 的卡出題時把整串當一個答案，學生打對也判錯，而且這筆錯的評分會進排程。所以含 ` | ` 的卡組進正式複習前，所有會複習的裝置都要先換成 W6 版並重新載入外掛，實際打第二個答案確認判對；既有含 ` | ` 的卡組也一樣。不以 W5 的判定結果驗收多答案卡。版本偵測與格式版本標記留給[更新與相容](../docs/plans/updates.md)，W6 不做。

**〈完成後〉的回報**加一項：「提醒使用者：iPhone 換到 W6 版之前，不要在 iPhone 複習含 ` | ` 的卡。」**§7 前提**加：「iPhone 的外掛已是含 W6 的開發版（用「版本」命令確認），再開始含 ` | ` 的英文卡。」

### F5｜改評分要用這一次的快照，不從 `History` 重建

`parseLine` 故意不讀 `retry`，從 `state.history()` 拿舊紀錄重寫會丟掉它。

**w6.md §2-1「這一次做過的卡」**改成：「每按一次自評記一筆在記憶體：題目、作答方式、第 1 步打的字、寫進紀錄的 `lt`、`v`、`typed`、`retry`（有 `src` 也留）、目前有效的 `t` 與評分。回看與改評分只用這份快照，不從 `state.history()` 取回、也不用後來改過的目標名稱重算；關掉畫面就清掉（D-084）。」

**§2-5「改評分」**的「再 `state.answer({ 同樣的 lt、v、typed、retry, r: 新的 })`」後面加「（四個值都照快照原樣，`retry` 含 `not-needed`）」。

**R10 回看改評分**那一點改成：「做兩張後回看第一張改成 `easy`：紀錄依序多一行取消、一行新的評分，新行的原始 JSON 裡 `lt`、`v`、`typed`、`retry` 和原本那行完全相同；再改一次，取消的是新的 `t`、`retry` 還在。打字卡第 1 步拼錯、第 2 步拼對的那張改評分兩次，每次新行都有 `retry: right`。改完的檔案依序 `appendLine` 與重新 `mergeHistory` 結果相同，那個目標只剩最後一筆有效作答。第 1 步按「沒印象」的那張，改評分沒有作用。」

### F6｜syntax §5 的兩列一起改，加上合法組合的測試

**syntax.md §5 欄位表**：`typed` 列改寫、底下加 `retry` 列：

| 欄位 | 內容 |
|---|---|
| `typed` | 選填，只寫在打字卡（中翻英，[§2-3](#2-3-學習目標)），記**第 1 步**的結果：`right` 拼對、`wrong` 送出但拼錯、`skip` 按「沒印象」沒有打字（[D-116](decisions.md#d-116-打字卡的沒印象與自動朗讀)、[D-120](decisions.md#d-120-今天的佇列的細節)）。自評與排程只看第 1 步，後面的提示與照打不改它（[D-121](decisions.md#d-121-打字卡答錯時的三步流程)）。舊紀錄缺這一欄表示未記錄。順序在 `v` 後面、`retry` 前面 |
| `retry` | 選填，第 2 步（原形提示）的結果：`right` 拼對、`wrong` 送出但拼錯、`skip` 按「沒印象」；第 1 步是 `wrong`／`skip`、但因為沒有可用的原形或原形等於任何一個答案而跳過第 2 步時，寫 `not-needed`。第 1 步拼對或非打字紀錄不寫；第 3 步照打不記在這裡。缺這一欄的舊紀錄表示第 2 步未記錄，不推定有沒有提示過。順序在 `typed` 後面、`src` 前面 |

（F3 不採用時，`retry` 列刪掉 `not-needed` 那句，改成「已知由 W6 寫出的紀錄，缺值表示沒進第 2 步；沒確認版本的舊紀錄不可這樣推定」。）

**w6.md R4** 改成：「`encodeEntry` 寫出的**原始 JSON 字串**欄位順序是 `t, lt, r, v, typed, retry, src`，值正確，沒有就不寫（直接比字串，不只比 `History`，否則漏寫 `retry` 也會通過）；`parseLine` 讀到有 `retry` 的行，結果和沒有 `retry` 的同一行相同；一個含 `retry` 行的檔，依序 `appendLine` 的結果和重新 `mergeHistory` 相同（W5 T5 的做法）。」

**w6.md R5** 加一列：「`Session` 的公開介面寫不出非法組合：沒有 `typed` 的紀錄沒有 `retry`；`typed: right` 沒有 `retry`；`typed: wrong`／`skip` 一定有 `retry`。輸入框是空的按「確認」：沒有作用（不送出、不記成「沒印象」）。」**§2-3** 第 1 步「學生能做的」補「輸入框空白時「確認」沒有作用」。

## 其他要一起改的地方

- **w6.md〈開工條件與基準〉**「§0-1 與 §1 等 Codex 的格式查核」那一點改成已處理：「Codex 的回報（`8e2fb28`）已由 Claude 核對並照 [w6-format-review-fixes.md](w6-format-review-fixes.md) 改進這份說明（2026-10-26）；§0-1、§1 可以開工。」
- **w6.md〈完成後〉**第一點的 Codex L2 重點加：「F1 的格式邊界與 R1 的 invalid 例子；`not-needed` 的寫入條件；改評分後 `retry` 保留。」
- **Codex 回報的檔頭**加一行：「2026-10-26 Claude 已核對，F1～F6 全部採用，改法見 [tasks/w6-format-review-fixes.md](../tasks/w6-format-review-fixes.md)；F3 採 `not-needed`。」不另寫摘要。
- **docs/roadmap.md**「現在在哪裡」的產品程式碼那一格，W6 的狀態加「開工前的格式查核已處理」；「已完成」最上面加一行（超過 10 條就搬最舊的到 archive）。
- 改完跑 `node experiments/tools/decisions-index.mjs` 不需要（沒有新 D-ID）。這次是把 D-066、D-121、D-122 的邊界寫清楚，不新增決定；若使用者認為 F1 或 F3 要獨立成 D-ID，再開。

## 完成條件

- `git diff --check` 乾淨；只改 `tasks/w6.md`、`docs/syntax.md`、`docs/roadmap.md`、Codex 回報的檔頭。
- 回報：列出每一項改在哪個段落，以及這份說明裡說不清楚、自己選了寫法的地方。
- 之後 W6 照 w6.md 在分支 `claude/w6` 開工（Opus、高），先做 §0-2，再 §0-1 與 §1。
