# iPhone 測試後的修改｜L2 第一輪審查

狀態：F1～F3 已修、兩個規格問題使用者已決定，待再審（第二輪）

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
