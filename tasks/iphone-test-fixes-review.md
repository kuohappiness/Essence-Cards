# iPhone 測試後的修改：L2 審查請求（給新開的 Codex session）

狀態：待審（第一輪）

## 審查對象

- worktree：`.claude/worktrees/loving-bohr-b7fa09`，分支 `claude/nifty-babbage-6659de`；沒有未提交的修改，沒有 push。
- 基準（和 `main` 的共同祖先）：`4f686ed5dd0015e6a56edb681df4bfe541739117`。
- 待審：`e51eb0db97045117fe3c0299aecbb9965c2376a5`，範圍 `git diff 4f686ed..e51eb0d -- src tests`（20 個檔）。本請求的文件 commit 在它之後，不用審。
- 要看的 commit：`8f0bc04`（D-172，訊息寫 D-171 是改號前的編號）、`e51eb0d`（D-173）、`1632a26` 與 `01b087f`（開發命令，只掃一眼）。

## 規格

- [D-172](../docs/decisions.md#d-172-iphone-實機測試後的複習畫面調整不自動換卡直接照打也打叉例句分行)：不自動換卡、拼錯進照打也打叉、例句分行。修改 D-145 第 7 點。
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
