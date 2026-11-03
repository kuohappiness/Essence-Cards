# iPhone 測試後的修改｜L2 第一輪審查

狀態：L2 結案，待合併；第四輪留下的一項在 Obsidian 不會發生，使用者 2026-11-04 決定不修

## 審查對象

分支 `claude/nifty-babbage-6659de`，worktree `.claude/worktrees/loving-bohr-b7fa09`。基準 `4f686ed5dd0015e6a56edb681df4bfe541739117`，待審 `e51eb0db97045117fe3c0299aecbb9965c2376a5`。工作樹檢查從乾淨的 `eea49fe804c3a35c13d56736536a6dfa6d0ead60` 執行，待審 commit 到此 HEAD 只差 roadmap 與審查請求。查核 `src`、`tests` 的 20 個變更檔案，開發命令做快速檢視。對照[審查請求](../tasks/iphone-test-fixes-review.md)、D-172、D-173、D-145 第 6、7 點、D-155 第 2～5 點、[錯誤紀錄格式](../docs/syntax.md#9-錯誤紀錄)及[iPhone 實測紀錄](../tasks/iphone-test-2026-11.md#結果)。

## 發現

### F1 [P2] 背面例句分行會破壞跨行的 Markdown 格式

- **規格、已重現。** 把 `例句：**She bought a book. 她買了一本書。**` 放在卡片背面補充。D-172 第 3 點要求把英文與翻譯分行，既有粗體應照常顯示。實際傳進兩個 Markdown 渲染器的是 `**She bought a book.` 和 `她買了一本書。**`，兩段都失去粗體並顯示星號。同一個切分邊界也漏掉中文自己加粗的 `She bought a book. **她買了一本書。**`，後者維持一行。
- **真實路徑可達。** 卡組允許背面補充用 Markdown，複習會直接把既有補充送進這個切分。學生可能看見失去格式的例句或仍然擠在一起的英中兩句。證據為從公開的 `splitTranslation` 得到上述切段，再用 repo 已安裝的 MarkdownIt 比對渲染結果。整段是單一 `<strong>`，切段後變成帶有星號的純文字。Obsidian 實機畫面待驗。
- **位置與處理。** [extras.ts](../src/review/extras.ts) 第 17～20 行，[Review.tsx](../src/ui/Review.tsx) 第 486～491 行。合併前修正切分與渲染的邊界，回歸涵蓋跨英中兩句的格式、只包住英文的格式，以及中文開頭有格式標記。

### F2 [P2] V8 的無 frame 錯誤可被當成 iPhone 的名稱 stack 收進補網

- **規格、已重現。** 在 V8 暫設 `Error.stackTraceLimit = 0`，建立 `Error('first\\nkq@')`，先取 `error.stack`，再把 `error.message` 改成 `changed later`，最後還原 stack 上限。D-173 第 1 點要求 Windows 完全維持既有結果，這個錯誤的 stack 只有標頭與舊訊息，預期補網拒收。實際 `maybeOwn(error)` 回傳 `true`，用記憶體 Files 走和補網相同的判斷及寫入，得到 `where: "uncaught"`，`msg: "changed later"`，`stack: "Error: first\\nkq@"`。原有判斷找不到自身位置，會拒收。
- **真實路徑有條件可達。** 探針的 stack 是 Windows 上的 V8 實際產生，無需偽造 stack。若同一執行環境有程式限制 stack 深度，並重用或改寫帶有類似文字的錯誤後讓它逃到 `window`，正式監聽器會走到這條分支。這次未觀察到 Obsidian 或使用者的外掛觸發該組合。現有 R3、F1、F2、G1 和新增測試涵蓋有 `at ` 的情形或標頭仍吻合的無 frame 情形，未涵蓋這個交集。
- **位置與處理。** [log.ts](../src/core/errors/log.ts) 第 110～126、226～232 行，[main.ts](../src/main.ts) 第 109～110 行。合併前讓名稱 fallback 只在適用的主機啟用，並補一個由真 V8 產生無 frame stack、標頭失配的回歸案例，涵蓋補網與接住後的寫入。

### F3 [P3] 錯誤紀錄格式的去重與收錄條件仍互相衝突

- **規格、文件對照。** D-173 第 1、3 點允許來源不明的 iPhone 錯誤，並把第一層名稱納入名稱 stack 的去重鍵。[syntax.md §9](../docs/syntax.md#9-錯誤紀錄) 第 734 行的 `stack` 欄已容許 `uncaught` 來自別的外掛，第 739 行的去重仍寫無自身位置時只看 `msg`，第 743 行仍寫不記 Obsidian 與其他外掛的錯。若 stack 混合名稱及別人的位置且無自身位置，實作者選擇保留所有層，`stack` 欄的文字只交代保留名稱與自身位置。
- **真實路徑可達。** 先前 iPhone 實測已看到沒有位置的 stack。隔離探針用 `foo@plugin:other:1:2\\nkq@` 寫入時兩層都保留，符合審查請求所述做法。混合 stack 是否會在 iPhone 實際出現尚未驗證。既有 D-173 測試也確認相同訊息、不同第一層會各寫一行，維護者依目前的格式文件判讀，會預期兩筆被合併。
- **處理。** 合併前對齊 §9 與 D-173 的收錄條件和去重。明寫混合 stack 的保留範圍，並補上名稱 stack 無法用行欄定位的說明。

## 待釐清的規格

- **第 1 步拼錯、第 2 步按「沒印象」。** D-172 第 2 點一處寫「一直標到這張走完」，另一處說按「沒印象」進來的「沒拼過」所以不打叉。本組合兩句各涵蓋一部分。公開 session 加記憶體 Files 已重現第 2 步 `notice: true`，按「沒印象」進第 3 步即變 `false`，照打完仍要評分且紀錄為 `typed: wrong, retry: skip, r: miss`。這是有原形提示的卡片上可直接做的操作。請明定打叉是跟著最後一次操作，還是保留本張前面已發生的拼錯。[session.ts](../src/review/session.ts) 第 371～405 行。
- **中文翻譯內含英文時的喇叭。** D-172 第 3 點寫「喇叭留在英文那一行」，實作者列明翻譯含英文時也會多一顆喇叭。純中文翻譯的既有 UI 測試涵蓋單一例句喇叭。依目前接法，`She bought a book. 她買了 Tom 的書。` 在可朗讀的英文卡上也會讓翻譯列出現喇叭。這是讀程式推論，實機待驗。需明定此情形沿用 D-145 的逐行朗讀，或依 D-172 只在例句英文列保留喇叭。[Review.tsx](../src/ui/Review.tsx) 第 425、490～491 行。

## 其餘核對與驗證

- 照打完成、照打後按跳過和語音播放均沒有自動評分入口。正常作答仍從 `Session.rate` 進入 `state.answer`，翻面 300 毫秒內拒絕評分，保留 `typed`、`retry`、`r`。回看仍使用原來的改評分入口。切回當前卡保留進行中的狀態，背景逾 60 秒則透過原有的重新開卡路徑初始化 `notice`，已評分的回看卡不顯示輸入階段的打叉。
- `Speech.say` 仍先取消前一批再排入英文語音。換卡、回看、關閉及切到背景的 `stop` 呼叫仍在。例句切分只接在 UI 的 `extraLabel` 之後，卡組、指紋和 `extraLabel` 未改。
- D-173 實測形狀的名稱、匿名 `@`、`global code@` 和夾在中間的 native frame，由測試覆蓋。純他方位置拒收，自身位置優先，名稱依訊息與第一層去重。探針額外確認非字串 stack 和會拋錯的 stack getter 皆拒收，記錄器的防錯與原有截長、月上限仍在。開發命令的 Electron 接點仍限桌面，手機探針回報的是 stack 是否存在，位置精度應查看輸出的實際紀錄。
- 在沙箱外執行 `npm run check`（Node v24.13.0、dot reporter），結束碼 0。型別、ESLint、knip、secretlint、skill 副本、Git 追蹤文件及完整測試皆通過。另以 TAP 重跑本次相關的 7 個測試檔，122 項全過。`git diff --check 4f686ed..e51eb0d -- src tests` 通過，報告的 10 個相對連結均確認檔案存在。
- 未重跑 Windows Obsidian 或 iPhone 實機。本文的重現使用 Node/V8、記憶體 Files 與 MarkdownIt。D-173 尚待 iPhone 安裝本次建置驗證。審查請求引用的 Windows 實測未走到 `render`／`report`，iPhone 也尚未驗證第 2 步再拼錯的打叉。

## Claude 回應：第一輪（2026-11-03）

狀態：全部處理完，請再審。

整合者核對：F1、F2 用同樣的輸入在 `eea49fe` 重現了；F3 對照 syntax.md §9 屬實。F2 同一類還有 Codex 沒列的：V8 上別人把 `stack` 改寫成 `kq@`，或沒有 `Error` 的物件帶 `stack`，也會被收（探針重現）。

| 項目 | 哪一類輸入、在哪裡修 | commit | 回歸測試 |
|---|---|---|---|
| F2 V8 的錯誤被當成 iPhone 的名稱 stack | 類別是「不是 iPhone 的主機上，看起來只有名稱的 stack」。從 stack 的樣子分不乾淨，改由主機決定：`createErrorLog` 的選項與 `maybeOwn` 的參數 `nameStacks`，`main.ts` 給 `Platform.isIosApp`；補網與接住的錯誤都經過它 | `09ae837` | `tests/errors.test.ts`「D-173 F2」：真的 V8 產生的無 frame stack（訊息後來改過）、改寫過的 stack、標頭對不上與對得上，補網與 `record` 都不收不留；`tests/main-wiring.test.ts`「D-173 補網」：iPhone 收、留整段，其他手機與電腦不收 |
| F1 例句分行拆開行內格式 | 類別是「切分點落在行內格式裡面」，在 `splitTranslation` 一次修：切開後兩段的格式都要各自收尾，否則照舊一行；中文開頭可以有自己的格式 | `5b1188c` | `tests/review.test.ts` 的 D-172 測試：粗體、斜體、`_`、`==`、`~~`、行內程式碼、連結、wikilink 跨過切分點都一行；中文自己加粗、兩邊各自加粗、`$5` 照樣分行 |
| F3 §9 與 D-173 衝突 | syntax.md §9 的 `stack`、去重、不記、對回原始碼四處；D-173 本身不用改 | `a4cd2fb` | 文件；去重的行為已有測試 |
| 規格問題：第 1 步拼錯、第 2 步按「沒印象」的打叉 | 使用者選留著：這張拼錯過就一路標到走完。一路按「沒印象」的照舊不標 | `ac20d23` | `tests/review-session.test.ts`：第 3 步 `notice` 是 true，紀錄照舊 `typed: wrong, retry: skip`；第 1 步按「沒印象」、第 2 步拼錯也標 |
| 規格問題：翻譯裡有英文時的喇叭 | 使用者選只有英文那一行有，照 D-172 原文；拿掉翻譯那一行的 `tail` | `9e3dc41` | `tests/review-ui.test.ts`「D-172 翻譯裡有英文」 |

D-172 第 2、3 點跟著補上這幾個邊界（`5b1188c`、`ac20d23`）。

### 實作者自己選的做法（請先看）

1. **F2 用主機開關，不繼續收緊 stack 的樣子**：再收緊一次還是可能漏（標頭加了 `: `、沒有名稱的錯誤……）；開關讓「其他主機完全不變」由接法保證。`Platform.isIosApp` 在實機是 true 的依據：`Essence W5/結果/error-probe iPhone-937a 2026-11-03 144400.json` 的 `platform: "ios"`（`src/obsidian/dev.ts:157`）。
2. **`nameFrames` 拿掉 `V8_FRAME` 與標頭這兩個判斷**：只在 iPhone 跑之後它們不再保護 Windows；留著反而會漏掉 iPhone 上被函式庫在開頭補了標頭的 stack，和 D-173 的「全收」相反。
3. **切不開就一行，不把格式補回兩邊**（不產生 `**英文**` 加 `**中文**`）：一行不會壞，程式不猜。整段粗體的例句因此不分行，已寫進 D-172 第 3 點。
4. **`closed` 只看 `**`、`__`、`~~`、`==`、`*`、`_`、反引號與方括號**：`$` 不算，否則 `It costs $5.` 不分行；單獨的 `*`、`_` 寧可一行。`<u>` 這類 HTML 也不算：跨過切分點時，推論是瀏覽器自己補上結尾、畫面看不到標籤，沒有在 Obsidian 看過。

### 驗證

- Windows、Node 24.13.0，`9e3dc41` 的 pre-commit 跑完整 `npm run check` 通過：1207 項（第一輪 1202，加 5 項）。
- Windows 版 Obsidian 1.15.0、`0.2.0+9e3dc41` 跑 `error-probe`（`Essence W5/結果/error-probe Windows-c50c 2026-11-03 232449.json`）：`uncaught` 四列、`ui` 一列都帶自己的位置，`others` 空的，和 `e51eb0d` 相同。`render`、`report` 仍然沒有可出的自然卡（`card: null`），沒驗到。
- 沒跑：
  - iPhone：D-173 的名稱路徑、第 2 步再拼錯與這次留著的打叉，都記進 [backlog 的下一次實機測試](../docs/backlog.md#v1-需要做的任務)。
  - `ui-phone`：現有的流程走不到這次改的兩條路（翻譯裡有英文、第 2 步按「沒印象」），由上面的測試涵蓋。
  - 切開後的粗體片段在 Obsidian 的實際畫面沒看過。
- 過程中有一次 pre-commit 沒通過，輸出沒有留下來；同樣的內容重跑通過（`ac20d23`、`9e3dc41`），原因不明，可能是記憶體或偶發的測試。

### 請 Codex 再審

只審 `eea49fe..9e3dc41` 與相鄰案例，細節在[審查請求的〈再審（第二輪）〉](../tasks/iphone-test-fixes-review.md#再審第二輪第一輪發現的修正)。

## Codex 再審：第二輪（2026-11-03）

狀態：待修

審查 `eea49fe804c3a35c13d56736536a6dfa6d0ead60..9e3dc41b78c620e0e7ffac6207432fb2d0074792` 的五個修正 commit。從乾淨的 `a306fea146b8f880f94ea6fcf5adff4aa295236c` 工作樹查核，待審 commit 到 HEAD 的差異均為文件。另依任務比較 `4f686ed` 的記錄器行為。

### F1 [P2] 例句切分仍會拆壞含中文路徑的 Markdown 連結

- **規格、已重現。** 在背面補充寫 `See [source](https://example.com/a.中文).`。預期保留原文的可點擊連結。實際 `splitTranslation` 切成 `See [source](https://example.com/a.` 與 `中文).`。前半的方括號已平衡，`closed` 判為完整，但切分點在連結的目的地內。用 MarkdownIt 渲染，原文有 `<a>`，切開後兩段都只剩純文字，學生會看到連結語法且無法點擊。
- **真實路徑可達。** 背面補充會直接走這個切分再分別送入 Markdown 渲染器。含中文的 URL 或筆記路徑可由家長放進 Markdown 連結，無需偽造解析器狀態。英文製卡規則中的純文字英中例句不受此案例影響。另以允許 HTML 的 MarkdownIt 確認 `She <u>left. 她走了。</u>` 也被切開，兩段送出的是不配對的標籤，Obsidian 上的實際呈現未驗。
- **位置與處理。** [extras.ts](../src/review/extras.ts) 第 17～25 行，[Review.tsx](../src/ui/Review.tsx) 第 486～491 行。合併前保護實際的 Markdown 切分邊界，回歸覆蓋連結目的地與其他跨切分點的格式。原來的整段粗體已能完整保留，兩段各自加粗也能分行。另有獨立格式仍漏切的例子，英文句末後接以反引號包住的中文，整段會維持一行。

### F2 [P3] 非 iOS 主機的補網已修正，接住的錯誤仍有去重差異

- **規格、已重現。** 關閉 `nameStacks`，用相同環節與路徑先記帶自身 frame `at plugin:essence-cards:1:2` 的錯誤，再記無 stack、文字恰為 `at plugin:essence-cards:1:2` 的錯誤。依本輪要求，非 iOS 主機去重應維持 D-173 前行為。載入 `git show 4f686ed:src/core/errors/log.ts` 的記錄器跑記憶體 Files，實際只寫第一筆，待審版則寫兩筆。舊版兩筆鍵都是同一個字串，待審版第二筆鍵變成 `[msg, null]`，同時改變了這組錯誤的次數抽樣。
- **真實路徑有條件可達。** 接住的失敗值可為字串，或為沒有自身 frame 的錯誤物件。只有同環節、同路徑、訊息剛好與另一筆自己的第一個 frame 相同時才會觸發。探針在 Windows 的 Node 上重現，未觀察到實際 vault 或 Android 產生這組錯誤。
- **位置與處理。** [log.ts](../src/core/errors/log.ts) 第 229～233 行。合併前讓沒有保留名稱 stack 的鍵沿用原本的字串 fallback，僅有名稱 stack 時使用複合鍵。若要刻意更改這組輸入的去重語意，需要和「非 iOS 完全不變」的驗收條件對齊。第一輪的無 frame V8 誤收已修正，補網與 `record` 共用同一個主機開關。

### 其餘核對

- F3 原有的文件衝突已修正。§9 現在交代 iOS 來源不明的補網、混合 stack 保留方式、第一層去重與名稱定位。上面的 F2 是另一個無名稱 stack 時的相容邊界。
- 開關開啟時，自己的位置優先、純他方位置拒收、混合名稱與他方位置收錄、非字串 stack 拒收。開關關閉時拒收只有名稱的 stack，正常保留自身位置。以隔離探針核對分類，並以錯誤紀錄及主機接線測試核對寫入。
- 第 2 步跳過後的打叉由先前的拼錯結果決定。回看使用已完成快照，回到目前這張沿用進行中的狀態，切走超過 60 秒走重新開卡路徑並初始化 `notice: false`。記憶體 session 探針重現第 3 步、回看、回到目前、切走 60 秒以上的 notice 依序為 true、false、true、false，四次快照的歷史筆數都是 1。此修改沒有新增評分或寫入入口。翻譯列移除喇叭，英文列與其他語音停止路徑照舊。
- 沙箱外 `npm run check` 結束碼為 0，型別、ESLint、knip、secretlint、skill 副本、文件與完整測試皆通過。另跑 `errors`、`main-wiring`、`review`、`review-session`、`review-ui` 五個測試檔，共 142 項全過。`git diff --check eea49fe..9e3dc41` 通過。
- 未重跑 Windows、Android 或 iPhone 的 Obsidian 實機。Markdown 重現用 MarkdownIt，iOS 補網與這次打叉的實機結果仍待驗。

## Claude 回應：第二輪（2026-11-03）

狀態：兩項都修了，請再審。

整合者核對：兩項都用同樣的輸入在 `a306fea` 重現了。F1 同一類還有 Codex 沒列的：純網址（`See https://example.com/a.中文`）、`<https://…>`、沒收尾的括號（`She (left. 她) 走了。`）也會被切開（探針重現）。F2 用 `git show 4f686ed:src/core/errors/log.ts` 的舊版對照：舊版 1 行、`a306fea` 2 行。

| 第二輪的項目 | 哪一類輸入、在哪裡修 | commit | 回歸測試 |
|---|---|---|---|
| F1 例句切分拆壞連結 | 類別是「切分點落在連結、HTML、網址這類結構裡」，數記號看不出來（括號平衡也可能切在目的地裡）。在 `splitTranslation` 一次修：整段有 `[`、`]`、`<`、`>` 或 `://` 就一行；`closed` 改成看兩段的括號各自收尾；反引號在切分點的前後都算格式 | `296c546` | `tests/review.test.ts` 的 D-172 測試：連結目的地、純網址、`<網址>`、`<u>`、`<b>`、完整連結、沒收尾的括號、整段反引號都一行；中文包在反引號裡、兩邊各自包在反引號裡、括號收尾了照樣分行 |
| F2 接住的錯誤去重差異 | 類別是「沒有留下 stack 的錯誤」。去重鍵改成 `own[0] ?? (frames.length ? [msg, frames[0]] : msg)`，複合鍵只給只有名稱的 stack | `9028ad8` | `tests/errors.test.ts`「D-173 F2 沒有留下 stack 的錯誤」：訊息剛好等於另一筆第一個位置時算同一個，`nameStacks` 開與關都是 |

D-172 第 3 點跟著補上這個邊界（`296c546`）。

### 實作者自己選的做法（請先看）

1. **有結構的例句一律一行，不解析 Markdown**：用白名單的想法，只分純文字加成對強調的；Obsidian 的渲染在 `src/ui/`，`src/review/` 拿不到解析器，自己寫一份又多一條會和實際渲染不一致的路。代價：`She [left](https://example.com). 她走了。`、`1 < 2. 一小於二。` 也不分行，顯示不會壞；使用者知道這個代價後同意。
2. **全形括號不算**：`She （left. 她）走了` 會切開，沒有 Markdown 語法會壞，只是切得不好看；製卡規則不會寫出這種例句。
3. **沒有結構、也沒有格式會壞的切分不動**：`Mr.王先生來了`、`www.example.中文`、`file.中文.md` 仍會切開，句尾標點後面可以沒有空格是 D-172 第 3 點明定的，畫面看得到完整的字。想擋這些要猜縮寫與副檔名，程式不猜。

非 iPhone 主機完全不變，現在可以從程式讀出來：`git diff 4f686ed..9028ad8 -- src/core/errors/log.ts` 裡 `ownFrames` 沒有變動；`nameStacks` 關著時 `frames` 就是 `own`，鍵等於舊版的 `frames[0] ?? msg`，`maybeOwn` 等於舊版的 `hasOwnFrame`。

### 驗證

- Windows、Node 24.13.0，`9028ad8` 的 pre-commit 跑完整 `npm run check` 通過：1208 項（上一輪 1207，加 1 項；F1 的例子加在既有的測試裡）。
- Windows 版 Obsidian 1.15.0、`0.2.0+9028ad8.dirty` 跑 `error-probe`（`Essence W5/結果/error-probe Windows-c50c 2026-11-03 235904.json`）：`uncaught` 四列、`ui` 一列都帶自己的位置，`others` 空的，和上一輪相同。`.dirty` 只因為當時 Codex 第二輪的報告還沒提交，產品程式就是 `9028ad8`。`render`、`report` 仍然沒有可出的自然卡（`card: null`），沒驗到。
- 沒跑：iPhone（同上一輪，記在 backlog 的下一次實機測試）；`ui-phone`；分行後的例句在 Obsidian 的實際畫面這一輪沒有再看（`0.2.0+01b087f` 的 `ui-phone` 看過一般例句分行）。

### 請 Codex 再審

只審 `a306fea..9028ad8` 與相鄰案例，細節在[審查請求的〈再審（第三輪）〉](../tasks/iphone-test-fixes-review.md#再審第三輪第二輪發現的修正)。

## Codex 再審：第三輪（2026-11-04）

狀態：待修

查核 `a306fea146b8f880f94ea6fcf5adff4aa295236c..9028ad86c7d4edfb6aea28e928b51c25dfd388d0` 的兩個修正 commit。從乾淨的 `db555897252b3753682a95e26b0312e78e908a02` 工作樹執行，待審 commit 至 HEAD 只有文件差異。

### F1 [P2] 分行仍會拆開跨切分點的行內程式碼與強調

- **規格、已重現。** 以 ```She typed ``foo. 中文``.``` 的內容作為背面補充，其中行內程式碼使用雙反引號。依 D-172 第 3 點，切開會破壞行內格式時應保留整段。實際英文列留下開啟的兩個反引號，中文列留下結尾的兩個反引號，因為 [extras.ts](../src/review/extras.ts) 第 22～28 行按單個反引號計數，兩段都誤判為偶數且已收尾。用 MarkdownIt 比對，整段渲染有 `<code>foo. 中文</code>`，兩列各自渲染時只剩帶反引號的純文字。
- **同類重現。** `She wrote \* and *left. 她走了。* and \*.` 原本有跨英中內容的 `<em>`。切開後每段的一個跳脫星號和一個強調星號被一起計數，結果失去斜體，並額外顯示未配對的星號。
- **真實路徑可達。** 手寫或貼入背面補充的內容可直接進入兩段分開渲染的複習畫面。雙反引號和跳脫星號都能從卡組文字輸入。製卡規則列出的三個純文字例句不受影響，未讀取私人卡組或驗證 Obsidian 實機畫面。
- **處理。** 合併前處理能讓記號偶數判斷失真的格式，同一個分行入口補上跨界和各自閉合的回歸。第二輪含中文路徑的連結已能保留整段，HTML 和有協定的網址也有同類保護。隔離探針確認英文製卡規則三個純文字例句、兩段各自加粗，以及中文自己用雙反引號包住時仍能分行。

### F2 已修正

`nameStacks` 關閉時，`frames` 等於 `own`，鍵等於 `4f686ed` 的 `frames[0] ?? msg`，保留的 stack 與補網收錄條件也一致。第二輪的碰撞案例在開、關兩種模式都只寫一筆。開啟時，只有名稱的 stack 仍使用訊息與第一層的複合鍵，既有測試涵蓋相同第一層不同訊息、相同訊息不同第一層，以及相同兩者的重複輸入。另以 Git 取出舊版記錄器，在兩版分別跑相同的記憶體 Files 探針。關閉時六個輸入的補網結果一致，輸出的四筆訊息與 stack 也相同。開啟時，同訊息的 `kq@`、`Rd@` 分開寫入。見 [log.ts](../src/core/errors/log.ts) 第 226～233 行。

### 驗證

- 沙箱外 `npm run check` 結束碼為 0，所有檢查與完整測試通過。另重跑 `errors`、`review`、`main-wiring`，78 項全過。`git diff --check a306fea..9028ad8` 通過。
- 未重跑 Obsidian 實機。例句使用公開切分函式和 MarkdownIt 隔離重現，iPhone 的 D-173 補網仍待實機驗證。

## Claude 回應：第三輪（2026-11-04）

狀態：F1 修了，請再審。F2 Codex 已確認修好，這一輪沒有動。

整合者核對：Codex 的兩個輸入都在 `db55589` 重現了。同一類還有 Codex 沒列的，也會被切開：``She `*` *left. 她走了。* `*` now``、`x_y _left. 她走了。_ z_w`、`She *a* b* *c. 中* *d *e* now`、`She $left. 她$走了。`、`She %%left. 她%%走了。`。

| 第三輪的項目 | 哪一類輸入、在哪裡修 | commit | 回歸測試 |
|---|---|---|---|
| F1 分行拆開跨切分點的格式 | 類別是「數記號會被騙過的行內語法」。這是同一個入口第三次被找到，再補數法還會漏，所以不數了：在 `splitTranslation` 改成白名單。`SIMPLE` 拿掉完整的簡單格式（`**`、`*`、`==`、`~~`、單個反引號），`LEFTOVER` 看還有沒有記號，有就一行；`STRUCTURE` 多擋跳脫、`www.`、成對的 `$` 與 `%%` | `55825d1` | `tests/review.test.ts` 的 D-172 測試：上面的輸入與 Codex 的兩個都一行；粗體標目標字、好幾種簡單格式、程式碼裡的星號、單獨的等號照樣分行 |

D-172 第 3 點跟著改成同一句規則（`55825d1`）。

### 實作者自己選的做法（請先看）

1. **判斷不了就一行，不解析 Markdown**：理由同第二輪，一行不會壞，這個入口不值得自己寫一份解析器。
2. **白名單的代價**（都是一行，畫面完整）：`She left. ``她走了。`` ` 這種雙反引號（第三輪報告列為仍能分行，現在不分）、底線格式與 `snake_case`、`**a=b**`、`***巢狀***`、有兩個 `$` 的句子、`2 * 3`、單獨的 `~`。製卡規則寫出的例句是純文字，頂多用粗體標目標字，都照樣分行。
3. **底線不進白名單**：Obsidian 的渲染器和 CommonMark 不一樣，字中間的底線也算（`x_y _left. 她走了。_ z_w` 渲染成 `x<em>y _left. 她走了。</em> z_w`），簡單的比對判斷不準。`docs/card-rules/` 沒有用底線當格式的寫法。
4. **知道沒判斷左右相鄰的規則**：記號黏著標點的 `She *a.*b. 中*d*e`、`She a*.b*c. 中*d*e` 會切開。下面的探針裡，這兩個在 Obsidian 整段和切開的 HTML 相同，所以沒有為它們加規則。
5. **第二輪的第 3 點跟著變**：`www.example.中文` 現在一行（探針裡 Obsidian 會把 `www.` 開頭的字變成連結）；`Mr.王先生來了`、`file.中文.md` 不變。

### 驗證

- 修之前新的 D-172 測試失敗（`程式碼裡的星號不是格式`），修之後通過。
- Windows、Node 24.13.0，`55825d1` 的 pre-commit 通過；拿掉下面的臨時探針之後另跑 `npm run check`，結束碼 0，1208 項全過（案例加在既有的測試裡，項數不變）。
- **Obsidian 真的渲染器**：Windows 版 Obsidian 1.15.0，`0.2.0+55825d1.dirty` 加一個不提交的臨時開發命令，39 個例句比對整段與切開後的 HTML（`Essence W6/結果/split-probe Windows-c50c 2026-11-04 005133.json`，在測試 vault，不在 repo）：切開的 21 個全部相同，一行的 18 個照整段渲染。這也看出 MarkdownIt 比不出來的差別：Obsidian 把 `$left. 她$` 當數學式、`%%left. 她%%` 當註解（不顯示）、`www.example.com/?中文` 變連結，底線如第 3 點。**用 MarkdownIt 重現時要留意這四項。**
- 同一份 commit 拿掉臨時命令之後：`ui-phone`（`Essence W6/結果/畫面 手機寬度 2026-11-04 005211`），看了 `30 英文 英翻中 背面 淺色.png`，`Can I borrow your pen?` 和喇叭一行、`我可以借你的筆嗎？` 下一行；結果檔 `todaySame` 是 true、`logAdded` 空的。`error-probe`（`Essence W5/結果/error-probe Windows-c50c 2026-11-04 005402.json`）：`uncaught` 四列、`ui` 一列，`others` 空的，和上一輪相同；`render`、`report` 仍然沒有可出的自然卡，沒驗到。`.dirty` 只因為當時 Codex 第三輪的報告還沒提交。
- 沒跑：iPhone（D-173 補網、打叉與分行的實機畫面，記在 backlog 的下一次實機測試）。

### 請 Codex 再審

只審 `db55589..55825d1` 與相鄰案例，細節在[審查請求的〈再審（第四輪）〉](../tasks/iphone-test-fixes-review.md#再審第四輪第三輪發現的修正)。

## Codex 再審：第四輪（2026-11-04）

狀態：待使用者決定

審查 `db555897252b3753682a95e26b0312e78e908a02..55825d1eec55156484fcde86b7bd89b3c2041ba2` 的一個修正 commit。從乾淨的 `f3748afbd2fe732e7295fad71b3bda96d83b1c96` 工作樹執行。待審 commit 至 HEAD 只有文件差異。依第四輪範圍只再審 F1。

### F1 [P2] 白名單仍可能放行跨英中兩段配對的粗體

- **規格、已用 MarkdownIt 重現。** 背面補充輸入 `She **left.**Then she called. 她**走了**，接著打了電話。`。預期依 D-172 第 3 點，格式跨兩段時保留整段。整段經 MarkdownIt 渲染得到 `She <strong>left.<strong>Then she called. 她</strong>走了</strong>，接著打了電話。`。白名單卻放行切分，分開渲染後英文列成了字面上的 `She **left.**Then she called.`，中文列則把「走了」加粗。畫面會多出星號，也改變粗體範圍。
- **觸發位置。** [extras.ts](../src/review/extras.ts) 第 23～32 行的 `SIMPLE` 看到每段各有一對雙星號，就從檢查用字串移除。`left.` 後面的雙星號因為夾在句點和字母之間，在 MarkdownIt 裡可以當開頭，無法結束前面的粗體，於是會與中文列的雙星號跨段配對。這組輸入和第三輪回應第 4 點的探針不同，切開前後的 HTML 實際不同。
- **真實路徑可達，Obsidian 渲染待驗。** 粗體標目標字是支援的例句寫法，手寫或貼上的兩句英文只要在粗體句尾漏掉空格，翻譯也含粗體，就可能走到這個分支。探針使用公開的切分函式和 repo 的 MarkdownIt，沒有使用底線、數學式、註解或網址。這組資料在 Obsidian 實機上的呈現與實際卡組出現頻率尚未驗證。
- **第四輪交由使用者決定。** 建議先在 Obsidian 用這組資料比對整段與分段；若有相同差異，將無法確定配對的標記留在一行。這輪依 D-171 到此交回。

### 核對與驗證

- 第三輪的雙反引號與跳脫星號案例已有回歸保護。原有整段粗體、各自加粗、連結、HTML 和網址案例通過。另以探針跑英文製卡規則的三個純文字例句，全都照樣分行。常見的粗體標目標字 `She **bought** a book. 她買了一本書。` 由回歸測試驗證仍能分行。
- 沙箱外 `npm run check` 結束碼為 0，所有檢查與完整測試通過。另重跑 `tests/review.test.ts`，20 項全過。`git diff --check db55589..55825d1` 通過。
- 本輪未重跑 Obsidian 實機。整合者在 Windows 上跑過的 39 組探針與手機寬度畫面，見上一節。

## Claude 回應：第四輪（2026-11-04）

狀態：F1 不修，使用者 2026-11-04 決定；L2 結案，產品程式停在 `55825d1`。

整合者核對：Codex 的輸入在 markdown-it 重現了，整段得到 `She <strong>left.<strong>Then she called. 她</strong>走了</strong>，…`，切開後英文列露出星號。但照 Codex 的建議在 Obsidian 比對，沒有這個差異。

### 真實路徑走不到的證據

- **邊界**：複習畫面只用 Obsidian 的渲染器（`src/ui/Markdown.tsx:67` 的 `MarkdownRenderer.render`）；`src/` 沒有 markdown-it，它只是開發依賴。
- **實測**：Windows 版 Obsidian 1.15.0，`0.2.0+f3748af.dirty` 加一個不提交的臨時開發命令（`Essence W6/結果/split-probe Windows-c50c 2026-11-04 013150.json`，在測試 vault，不在 repo）。Codex 的輸入整段是 `She <strong>left.</strong>Then she called. 她<strong>走了</strong>，接著打了電話。`，切開後兩段的 HTML 相同。
- **同一類**：另外點名的 9 個組合（`*`、`==`、`~~`、反引號，以及記號貼著標點的變形），和枚舉的 2016 個（5 種記號與 `**`、`*` 互配，英文的記號前後貼字母、標點或空白，中文也有一對記號），全部分行，切開和整段的差異是 0 個。

### 沒驗到、以及之後會走到的情況

- iPhone 沒有跑這個探針。預期和電腦用同一套渲染器，這是推測。
- 日後 Obsidian 改成 markdown-it 的配對方式才會走到。後果只有畫面多出星號，不影響作答或紀錄；而且例句要同時符合「粗體收尾黏著下一個英文字」和「翻譯也有粗體」。

### 使用者的決定

使用者看過兩個選項後選擇不修：加規則可以防上面的情況，但會多一條實際用不到的規則，而且碰到解析邊界，照 [D-171](../docs/decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 3 點要再審一輪。記在 D-172 第 3 點。

### 驗證

- Codex 在 `f3748af` 跑 `npm run check` 結束碼 0；`55825d1` 到 `f3748af` 只有文件差異。這一節的文件 commit 由 pre-commit 再跑一次。
- 臨時探針已移除，測試 vault 裝回不含探針的 `0.2.0+f3748af.dirty`（`.dirty` 只因為當時第四輪的報告還沒提交）。
