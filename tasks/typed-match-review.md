# 打字卡的比對與照打的跳過（D-158）：L2 獨立審查（給 Codex）

狀態：Codex L2 通過：F1 已修（分支 `claude/typed-match` 的 `675a62d`），再審通過、沒有新增發現（2026-10-31，[回報](<../Claude Codex Discussion/2026-10-30-typed-match-review.md>)最後的〈Codex 再審〉）；等使用者決定合併

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（改動不大，但比對規則同時決定判對、能選的評分與畫面上標出的字母，五個地方要一致）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)，[backlog 技術債](../docs/backlog.md#技術債)「打字卡的比對與照打的出路」那一列由 Claude（Opus 5.5）實作。改到核心 `src/core/study/` 的公開介面與 `src/review/`、`src/ui/`，是跨模組的改動，屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md#高風險範圍要做-l2)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- **工作目錄**：`D:\程式開發\Essence-Cards-typed-match`（git worktree），分支 `claude/typed-match`，已 push。**不是**主資料夾 `D:\程式開發\Essence Cards`（那裡是 `main`，沒有這些 commit）。沒有未提交的修改。
- 從 `main` 的 `8f71442fe7ce78d7eb38c9211330daf9aca18f02` 開出（共同祖先同一個）。commit（由舊到新）：
  - `5f54e5c7174877fa2df745e2b617436966e6c4a0`：比對規則收到核心一處，五個地方改用它。
  - `c39d420c3537b85294d9ae4290ce8d3cce7b52c3`：第 3 步照打送出一次還是不對之後出現「跳過」。
  - `ba13f03644f36348d8bd2f1786ab9d48c91cbb8a`：syntax §2-3 拿掉「待實作」，不用審程式。
- 整個分支：`git diff 8f71442...claude/typed-match`。

## 規格與優先順序

- 主要規格：[D-158](../docs/decisions.md#d-158-打字卡看起來一樣的字元與多按的空白不算錯照打可以跳過) 與 `main` 上 backlog 技術債那一列的完成條件（逐條對照）。syntax.md §2-3「中翻英要打字」那一段。
- 被 D-158 修改的：[D-121](../docs/decisions.md#d-121-打字卡答錯時的三步流程)（三步流程的「打對才結束」）、[D-122](../docs/decisions.md#d-122-片語放進句子裡打字)、[D-089](../docs/decisions.md#d-089-語法的邊界規則與寫錯時的處理) 第 13 條。紀錄的 `typed`、`retry` 照 syntax.md §5 的欄位表。
- 經過：[外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)〈Codex 回應：環節 3〉第 1 題（共用規則、照打前綴只去開頭空白）、〈環節 3 的結論〉第 1 條（使用者改成連續的空白也算對、第 3 步要能跳過）。討論稿裡「不合併連續的空白」的版本已被使用者改掉，以 D-158 為準。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## 行為與風險

- **公開介面**：`src/core/study/index.ts` 多匯出 `typedUnits`、`typedKey` 與型別 `TypedUnit`；`checkTyped` 改用 `typedKey`。`src/review/` 的 `spelling`、`copying`、`closest`、`otherAnswers` 改用核心的規則；`Session.skip()` 在第 3 步多一種行為，`TypedView.canSkip` 的意思擴大（見下面第 3 點）。`src/ui/Review.tsx` 的 `TypedActions` 在第 3 步把按鈕寫成「跳過」。
- **不可破壞的性質**：
  - 只在比對時換，不改卡組的答案、題目指紋與紀錄的欄位；跳過不另寫進紀錄。
  - 判對、對中哪一個答案、原形要不要跳過第 2 步、「也可以：」、最接近的答案、標錯字母都用同一條規則；`ʼ`、`＇`、雙引號、零寬字元、全形字母、撇號與空白的有無照舊算錯。
  - 照打的前綴只去開頭的空白，尾端剛打的空白不能消失；標錯的位置照學生打的字。
  - 第 1 步的 `typed`、第 2 步的 `retry` 和能選的評分一致；評分照舊只看第 1 步。
  - 跳過只在第 3 步照打**送出**一次、還是不對之後出現；空白送出不算一次；走完之後不再收輸入。
- **明確延後**：iOS 鍵盤（智慧標點）沒有實機驗，已列進 backlog「下一次 iPhone 實機測試」；Windows 版 Obsidian 的畫面沒有實機看，畫面只用 `tests/helpers/review-ui.ts` 的替身驗。

## 請特別看

1. **`typedUnits` 的切法**（`src/core/study/session.ts`）：`/[\p{Zs}\t]+|./gsu`，一段連續的空白是一個單位、key 是 `' '`；其他每個 code point 一個單位，key 是把 `‘`、`’` 換成 `'` 再小寫。小寫改成逐個單位做（原本是整串 `toLowerCase()` 再拆字），兩邊用同一個做法；請找會讓判對或標記改變的字元（例如小寫後變成兩個 code point 的字母）。`typedKey` 先 `trim()`（照舊，`trim()` 本來就會去掉頭尾的 `\p{Zs}` 與 U+FEFF）。
2. **對齊與標記**（`src/review/spelling.ts`）：`Letter.char` 現在可能是好幾個字元（學生多按的一串空白算一個），畫面的 `Letters` 一個單位一個 `<span>`；`rate()` 用 `firstCompare.typed` 的字拼回 `firstInput`（回看與開發命令用），現在會拼出原本的空白與 `’`。`copying` 的 `ok` 改成 `typedKey` 相等，原本是 `trimStart`、小寫、`trimEnd` 後相等，請確認沒有變寬或變窄。
3. **第 3 步的跳過**（`src/review/session.ts` 的 `submit`、`skip`）：照打送出、不對時 `canSkip = true`；`skip()` 在第 3 步只在 `canSkip` 時呼叫 `finish`，線上寫 `typed.copy`（「正確拼字」那一行照打的對象），不再念。請看和回看、60 秒切走重來、只剩一個自評時的自動換卡（`rateOnly`、`Review.tsx` 的等念完）有沒有交錯的問題。
4. **原形要不要跳過第 2 步**：`hintOf` 改成 `typedKey` 相等；名稱是 `o'clock`、答案是 `o’clock` 這種現在直接到第 3 步（`retry: not-needed`），請確認 syntax §5 的 `retry` 說明（「原形等於任何一個答案」）仍然成立。

## Claude 自己選了做法的地方（請逐點回覆）

1. **核心匯出單位與整段兩個函式**：`typedUnits` 給要逐字標記的 `spelling`／`copying`／`closest`，`typedKey` 給整段比對（`checkTyped`、`hintOf`、對中哪一個答案、`otherAnswers`）。沒有把 `checkTyped` 改成回傳對中的答案：標記要逐字的 key，同時要留學生原本的字，整段的函式做不到。
2. **一串空白算一個單位、畫面寫原本那一串**：這樣多按的空白不會被標出，「你拼的」也拼得回學生打的字。畫面上的字照舊是小寫。
3. **沿用 `canSkip` 與 `skip()`**：不另加欄位與方法；第 3 步的按鈕文字由畫面依 `step` 換成「跳過」，`className` 照舊是 `ec-skip`。
4. **跳過時線上寫照打的對象（`typed.copy`）**，不是第一個答案：和照打成功時寫照打的那一個一致（W6 §3-4）。
5. **判對用 `checkTyped`、找對中的答案用 `matchOf`**：兩個都用 `typedKey`，沒有合成一個，因為 `checkTyped` 不是打字題時要丟錯（既有契約）。

## 驗證方式

- 每個 commit 的 pre-commit 都跑完整的 `npm run check`（型別、ESLint 含邊界、knip、secretlint、skill 副本、文件、全部測試），都通過。最後一次完整測試的數字見本檔最後〈Claude 跑過的〉。Codex 在沙箱裡跑會有環境造成的固定失敗，照 [quality.md](../docs/agents/quality.md)〈檢查指令〉在沙箱外跑，或逐項列出。
- 新增或改的測試：
  - `tests/today.test.ts`：T12 的兩個「中間兩個空白」改成判對；新的「T12 D-158」（彎引號兩個方向、不換行空白、全形空白、Tab、混在一起的空白、第二個答案，十個負例）。
  - `tests/review.test.ts`：「R7 D-158 比對」（最接近的答案、標錯字母、「你拼的」照學生打的字、照打前綴保留尾端空白、「也可以」去重、負例）。
  - `tests/review-session.test.ts`：三則 D-158 的流程（第 1 步就結束、原形只差彎引號直接到第 3 步、第 2 步的 `retry: right`）與一則跳過（剛進第 3 步不能跳過、空白送出不算、錯一次後跳過、紀錄的欄位不多、第 1 步「沒印象」的照打跳過後只剩沒印象）。
  - `tests/review-ui.test.ts`：「D-158 照打送出一次還是不對之後」（按鈕從「確認」變成「跳過、確認」，按了之後沒有輸入列、評分是沒印象與差一點）。
  - `tests/boundaries.test.ts`：study 的公開匯出加上 `typedKey`、`typedUnits`。
- 先失敗再通過：把 worktree 的 `src/` 暫時換回 `8f71442`，比對規則的 6 則新測試全部失敗；第二個 commit 前，跳過的 2 則失敗。
- 沒做的：Windows 版 Obsidian 實機畫面、iPhone 鍵盤（見上面〈明確延後〉）。

## 回報與權限

- 報告寫在 `Claude Codex Discussion/2026-10-30-typed-match-review.md`，不 commit。
- 每項發現寫哪一軸（規格／規範與設計）、觸發條件、預期與實際、影響、位置、證據（已重現／靜態推斷／待驗證）、建議處理（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。可以回報「規格本身有漏洞」。最後一行寫沒測的項目與原因。

## Claude 跑過的

- 2026-10-30，`ba13f03`（分支最新）：`node --test --test-concurrency=1 --test-reporter=tap "tests/**/*.test.ts"`，767 項通過、0 失敗、0 跳過（`main` 的 `8f71442` 是 760 項，多的是上面新增的 7 則）。三個 commit 的 pre-commit 都跑完整的 `npm run check`，都通過。

