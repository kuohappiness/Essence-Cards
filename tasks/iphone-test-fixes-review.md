# iPhone 測試後的修改：L2 審查請求（給新開的 Codex session）

狀態：L2 結案，已合併進 `main`（`25deec7`）；四輪，第四輪留下的一項使用者 2026-11-04 決定不修；[報告與回應](<../Claude Codex Discussion/2026-11-03-iphone-test-fixes-review.md>)；文中的 D-172 現在是 D-174（2026-11-04 改號，和 main 的 D-172 撞號）

## 再審（第四輪）：第三輪發現的修正

**這一輪只讀**：本節、〈審查對象〉、討論稿的〈[Claude 回應：第三輪](<../Claude Codex Discussion/2026-11-03-iphone-test-fixes-review.md#claude-回應第三輪2026-11-04>)〉。前幾輪的內容需要時，照發現的標題只查相關段落。

**範圍**：基準 `db555897252b3753682a95e26b0312e78e908a02`，待審 `55825d1eec55156484fcde86b7bd89b3c2041ba2`，`git diff db55589..55825d1`（1 個修正 commit）；本節的文件 commit 在它之後，不用審。

**還沒結的發現**：第三輪的 F1（分行拆開跨切分點的格式），看修正有沒有做到，以及同類的其他輸入。第三輪的 F2 已結，錯誤紀錄這一輪沒動，不用查。

**可能碰到的已結項目**：例句切分前幾輪的驗收（整段粗體、兩邊各自加粗、連結、HTML、網址）都在 `tests/review.test.ts` 的 D-172 測試。這次只改 `src/review/extras.ts` 的 `STRUCTURE`、`SIMPLE`、`LEFTOVER`、`closed`，只查受影響的路徑。

**請特別找**：

- 白名單放行、但切開後畫面和整段不同的輸入：兩段都沒有剩下記號，實際渲染卻跨段配對。MarkdownIt 和 Obsidian 在 `$`、`%%`、`www.`、底線上不一樣（〈Claude 回應：第三輪〉的〈驗證〉），請註明用哪一個重現的。
- 原本該分行的例句有沒有被誤擋（例句來自 `docs/card-rules/english.md`，常見的是純文字與粗體標目標字）。

**使用者已決定、不用再提**：英文句裡有完整連結的例句也不分行（2026-11-03）；〈實作者自己選的做法〉第 2 點列的代價（2026-11-04）；都在 D-172 第 3 點。第 4 點，以及 `Mr.王先生來了` 這類切分，請只在你認為真實資料會常碰到時才提。

**真實路徑與輪數**：照 [D-171](../docs/decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 3 點，每項發現標真實路徑會不會發生；沒有擋合併的發現就直接寫「通過」。這是第四輪，之後還有擋合併的發現就交給使用者。

**驗證方式**：`npm run check`，要在沙箱外跑（[quality.md](../docs/agents/quality.md#檢查指令)）。實作者跑過的與沒跑的見〈Claude 回應：第三輪〉的〈驗證〉。報告接在討論稿最後；所有檔案都在這個 worktree，不要寫到主資料夾。

## 再審（第三輪）：第二輪發現的修正

**這一輪只讀**：本節、〈審查對象〉、討論稿的〈[Claude 回應：第二輪](<../Claude Codex Discussion/2026-11-03-iphone-test-fixes-review.md#claude-回應第二輪2026-11-03>)〉。前兩輪的內容需要時，照發現的標題只查相關段落。

**範圍**：基準 `a306fea146b8f880f94ea6fcf5adff4aa295236c`，待審 `9028ad86c7d4edfb6aea28e928b51c25dfd388d0`，`git diff a306fea..9028ad8`（2 個修正 commit）；本節的文件 commit 在它之後，不用審。

**還沒結的發現**：第二輪的 F1（例句切分拆壞連結）、F2（接住的錯誤去重差異），看修正有沒有做到，以及同類的其他輸入。

**可能碰到的已結項目**：第一輪 F1 的整段粗體與各自加粗（驗收在〈Claude 回應：第一輪〉與 `tests/review.test.ts` 的 D-172 測試）；第一輪 F2 的主機開關（`tests/errors.test.ts`「D-173 F2」與 `tests/main-wiring.test.ts`「D-173 補網」）。這次只改 `splitTranslation`、`closed` 與 `record` 的去重鍵，只查受影響的路徑。

**請特別找**：

- `splitTranslation`：切開後畫面還是會看到語法的輸入；原本該分行的純文字例句有沒有被 `STRUCTURE` 或括號的判斷誤擋（例句來自 `docs/card-rules/english.md`）。
- 去重鍵：`nameStacks` 關著時和 `4f686ed` 有沒有任何不同；開著時只有名稱的 stack 仍然靠訊息與第一層分開。

**使用者已決定、不用再提**：英文句裡有完整連結的例句也不分行（2026-11-03，D-172 第 3 點）。〈Claude 回應：第二輪〉列的 `Mr.王先生來了` 這類切分，畫面沒有語法會壞，請只在你認為真實資料會常碰到時才提。

**真實路徑與輪數**：照 [D-171](../docs/decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 3 點，每項發現標真實路徑會不會發生；沒有擋合併的發現就直接寫「通過」。這是第三輪，第四輪之後還有擋合併的發現就交給使用者。

**驗證方式**：`npm run check`，要在沙箱外跑（[quality.md](../docs/agents/quality.md#檢查指令)）。實作者跑過的與沒跑的見〈Claude 回應：第二輪〉的〈驗證〉。報告接在討論稿最後；所有檔案都在這個 worktree，不要寫到主資料夾。

## 再審（第二輪）：第一輪發現的修正

**這一輪只讀**：本節、〈審查對象〉、討論稿的〈[Claude 回應：第一輪](<../Claude Codex Discussion/2026-11-03-iphone-test-fixes-review.md#claude-回應第一輪2026-11-03>)〉。第一輪的內容需要時，照 F1、F2、F3 的標題只查相關段落。

**範圍**：基準 `eea49fe804c3a35c13d56736536a6dfa6d0ead60`，待審 `9e3dc41b78c620e0e7ffac6207432fb2d0074792`，`git diff eea49fe..9e3dc41`（5 個修正 commit）；本節的文件 commit 在它之後，不用審。

**還沒結的發現**：F1、F2、F3，看修正有沒有做到，以及同類的其他輸入。

**可能碰到的已結項目**：第一輪〈其餘核對與驗證〉確認過的性質（一筆作答只在按評分時寫、自動朗讀的停止、背面補充分行只影響顯示）。這次的修改碰到 `Session.skip`、`record`、`maybeOwn`、`splitTranslation` 與 `Review.tsx` 的翻譯行，只查受影響的路徑。

**請特別找**：

- 電腦與 Android：`nameStacks` 沒開時，收與不收、`stack` 和去重的鍵是否和 D-173 之前完全一樣（`git diff 4f686ed..9e3dc41 -- src/core/errors/log.ts`）。
- iPhone：`nameStacks` 開著時，有自己的位置、全是別人的位置、混合、非字串 stack 的結果。
- `splitTranslation`：`closed` 判錯的組合，尤其是切開後畫面會看到記號的；原本該分行的例句有沒有變成不分行（卡組的例句來自 `docs/card-rules/english.md`）。
- 打叉：回看、切走超過 60 秒重來時的 `notice`。

**使用者已決定、不用再提**：第 1 步拼錯、第 2 步按「沒印象」留著打叉；翻譯裡有英文時只有英文那一行有喇叭（2026-11-03，D-172 第 2、3 點）。

**真實路徑**：照 [D-171](../docs/decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 3 點，每項發現標真實路徑會不會發生；沒有擋合併的發現就直接寫「通過」。

**驗證方式**：`npm run check`，要在沙箱外跑（[quality.md](../docs/agents/quality.md#檢查指令)）。實作者跑過的與沒跑的見〈Claude 回應〉的〈驗證〉。報告接在討論稿最後；所有檔案都在這個 worktree，不要寫到主資料夾。

## 審查對象

- worktree：`.claude/worktrees/loving-bohr-b7fa09`，分支 `claude/nifty-babbage-6659de`；沒有未提交的修改，沒有 push。
- 基準（和 `main` 的共同祖先）：`4f686ed5dd0015e6a56edb681df4bfe541739117`。
- 待審：`e51eb0db97045117fe3c0299aecbb9965c2376a5`，範圍 `git diff 4f686ed..e51eb0d -- src tests`（20 個檔）。本請求的文件 commit 在它之後，不用審。
- 要看的 commit：`8f0bc04`（D-172，訊息寫 D-171 是改號前的編號）、`e51eb0d`（D-173）、`1632a26` 與 `01b087f`（開發命令，只掃一眼）。

## 規格

- [D-174](../docs/decisions.md#d-174-iphone-實機測試後的複習畫面調整不自動換卡直接照打也打叉例句分行)：不自動換卡、拼錯進照打也打叉、例句分行。修改 D-145 第 7 點。
- [D-173](../docs/decisions.md#d-173-iphone-的-stack-沒有位置沒接住的錯誤一律收)：iPhone 的 stack 沒有位置時也收。修改 D-155 第 2、3 點；格式見 [syntax.md §9](../docs/syntax.md#9-錯誤紀錄) 的 `stack`。
- 實測證據：[iPhone 測試](iphone-test-2026-11.md)〈結果〉〈測試中找到的〉。

規格之間有衝突時列成問題，不挑一份。

## 行為與風險

**不可破壞的性質**：

- 複習紀錄的內容與寫入時機：拿掉自動換卡後，一筆作答只在學生按評分時寫，`typed`、`retry`、`r` 照舊；翻面後 0.3 秒的限制現在也套到只剩一個自評的情況（原本 `rateOnly` 不受限）。
- 自動朗讀：`Speech` 拿掉 `whenIdle` 與念完的追蹤後，換卡、回看、關畫面、切到背景的停止照舊。
- 記錄器永遠不拋錯；Windows（V8）收與不收的結果完全不變，含 `tests/errors.test.ts` 既有的 R3、F1、F2、G1。
- 背面補充分行只影響顯示：卡組、題目指紋、`extraLabel` 不變。

**請找新的組合**，已知的邊界例子：

- `maybeOwn`、`nameFrames`：`kq@`、`@`、`global code@`、`forEach@[native code]`；V8 沒有 frame、訊息以 `@` 結尾；V8 多行訊息裡像 `kq@` 的一行；非字串的 stack。
- 去重鍵：`own[0] ?? [msg, frames[0]]`。
- `splitTranslation`：見 `tests/review.test.ts` 的 D-172 測試。
- `TypedView.notice`：回看、切走超過 60 秒重來、跳過照打時的值。

## 實作者自己選的做法（請先看）

1. 第 2 步再拼錯進照打也打叉（D-172 第 2 點）：使用者只提到「不經提示直接照打」，Claude 照一致性補的，已告訴使用者。
2. 拿掉 `rateOnly` 與 `Speech.whenIdle`，不留著備用；`tests/speech.test.ts` 改寫成只測 `say`、`stop`。
3. 例句分行只認句尾標點緊接中文（沒有標點不分行，中文在前不分行）；翻譯也用 Markdown 渲染，翻譯裡有英文時那一行有自己的喇叭。
4. `hasOwnFrame` 改名 `maybeOwn`，因為它不再保證是自己的。
5. 只要有一層沒有位置就整段留下，有位置的層也留；只有全部有位置、又沒有自己的才不收。
6. 接住的錯誤（`record` 的呼叫端）也一樣留整段名稱。

## 驗證方式

- 檢查：`npm run check`，要在沙箱外跑（[quality.md](../docs/agents/quality.md#檢查指令)）。實作者在 `e51eb0d` 跑過，1202 項全過。
- Windows 版 Obsidian：`0.2.0+e51eb0d` 跑開發命令 `error-probe`：`uncaught` 四列、`ui` 一列都帶自己的位置，`others` 空的。`render`、`report` 那天 Windows 沒有可出的自然卡（`card: null`），沒驗到；`0.2.0+01b087f` 同樣如此，不是這次造成的。`0.2.0+01b087f` 跑 `ui-phone` 看過打叉、停在這張、例句分行。
- iPhone：D-172 使用者在 `0.2.0+01b087f` 看過（「第 2 步再拼錯也打叉」除外）。**D-173 還沒在 iPhone 跑**，併入下一次實機測試；`tests/errors.test.ts` 的名稱來自實測的結果檔。

## 回報與權限

只審查，不改產品程式；可以在隔離環境重現。報告寫在 `Claude Codex Discussion/2026-11-03-iphone-test-fixes-review.md`，每項發現寫觸發條件、預期與實際、影響、位置、證據，區分「已重現」與「讀程式推論」，並標真實路徑會不會發生（[D-171](../docs/decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 3 點）。沒有發現也要寫，並寫明看了什麼。
