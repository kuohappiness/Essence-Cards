# 題型接點第一步的行為查核（給 Codex）

狀態：第一輪查出 F1（[報告](<../Claude Codex Discussion/2026-11-05-question-type-seam-step1-review.md>)），已修，等複查（本檔最後一節）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。

[任務說明](question-type-seam.md) §2：把翻面、打字搬到接點，只搬不改。**只查行為有沒有變**，不評設計（接點的形狀 §1、之後的比較點選 §3 以後不用看；L2 會看）。

## 基準

- 舊版：`283f4c6`。
- 新版：分支 `claude/question-type-seam-927507` 上訊息為 `refactor: move flip and typed cards onto the question-type seam` 的 commit，hash 寫進報告；工作目錄 `.claude/worktrees/state-split-c5c7bf`。
- 不用看 `tasks/`、`docs/` 的改動。

## 不可破壞

孩子看到的行為與紀錄的每一個字都不變（§2）。

**已知的差別**（都是實作者自己列的，請驗證有沒有列漏）：

1. `Card` 多一個 `blanks`（自己那一格），差分先檢查它就是自己那一格，再拿掉才比。
2. `session.history()` 的 `DoneCard` 結構換了（`t` 變 `written`，打字的欄位收進 `look`）；產品程式沒有人讀，測試只讀 `card.lt`、`rating`。
3. 回看的 `TypedView` 不再每次算一個新物件（內容相同）。
4. `src/core/study/index.ts` 多匯出 `cardOf`、`questionType`，`tests/boundaries.test.ts` 的清單跟著加兩個名字。這是四個鎖定的測試檔以外唯一改的測試。
5. `src/review/index.ts` 多匯出 `questionOf`，給畫面共用原本的題目取值（第一輪查核補的）。

## 已經跑過的（新版 commit 上重跑過，輸出在腳本資料夾）

腳本不進 repo，在 `C:\Users\kuo\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_e21e2729-1472-4be8-a408-683f6816e1c6\seam-diff\`，用法寫在 `README.txt`：

| 腳本 | 比什麼 | 規模 | 結果 |
|---|---|---|---|
| `diff.mjs` | 新舊 `createSession`（接真的 `createState`）與 `createPreview` 餵同一串亂數動作：每一步比 `view()`、回傳值、通知次數、做過的卡、所有檔案的內容 | 複習、預覽各 2000 串，每串 80 步 | 0 個差異 |
| `ui-diff.ts` | `tests/helpers/review-ui.ts` 的替身畫新舊 `Review`：同一串點擊、按鍵、打字，每一步比整棵樹（class、文字、屬性；函式不比）、朗讀、事件、動畫次數、檔案 | 500 串，每串 60 步 | 0 個差異 |
| `parse-diff.mjs` | 新舊 `parseDeck` 整份比 JSON，中翻英答案格的每一條規則加亂數組合 | 19782 份 | 0 個差異 |
| `mutate.mjs` | 把新版改壞一處，上面三支要抓得到 | 20 處 | 全部抓到（有幾處是補強腳本之後才抓到的，見 `README.txt`） |

**這些差分蓋不到的**（請優先看）：

- 真的 React：替身沒有 DOM、焦點與版面，也不比對 snapshot。翻面與打字的元件搬了一層（`Review` → `screen.Body` → `QaCard`），`middle`、`head`、`last` 是 Fragment：輸入框會不會因此重新掛載、掉焦點、掉 IME 組字；`createPortal` 的位置；`key` 的位置。
- `Markdown` 的 props 和 effect 的依賴（`src/ui/Markdown.tsx`）：`words`、`lines` 這些每次 render 的新陣列，和舊版相同嗎。
- 開發命令（`src/obsidian/dev-review.ts`、`dev-errors.ts`）與預覽的入口（`deck-actions.ts`）。
- 差分的亂數沒走到的組合：腳本印出走到的狀態與動作，請找少的那幾種。

## 查什麼

1. 自己讀 `git diff 283f4c6 <新版> -- src tests`：有沒有不是「只移位置」的地方。重點檔：`src/review/session.ts`、`typed.ts`、`flip.ts`、`preview.ts`、`src/ui/screens.tsx`、`src/ui/Review.tsx`、`src/core/deck/question-types.ts`。
2. 驗收條件（§2）：`git diff 283f4c6 -- tests/review-session.test.ts tests/review-ui.test.ts tests/review.test.ts tests/preview.test.ts` 是空的、四個檔全過；`npm run check` 通過；`src/review/session.ts` grep 不到 `checkTyped`、`spelling`、`hintOf`；`src/ui/Review.tsx` grep 不到 `typed.step`。
3. 差分本身：重跑一次，換一個起始種子；看腳本有沒有把差異比掉（例如 `canonView`、`serialize` 拿掉太多）；試著找一串動作讓新舊不一樣。
4. 上面「蓋不到的」。

## 回報

只回報，不改產品程式與文件。寫在 `Claude Codex Discussion/2026-11-05-question-type-seam-step1-review.md`，標題下第一行寫狀態。每項寫觸發條件、預期與實際、影響、位置與證據，區分「已重現」與「看規格推斷」，另標真實路徑會不會發生。沒有發現也寫明查了什麼、跑了什麼、哪些沒跑與原因。

## 複查 F1（第二輪）

新版改成同一分支的 `743601a`（`fix: keep the rating buttons and focus when the card type changes`）。舊版不變。分支之後合併了 `main`（`cf432af`，含考試範圍的程式），第一步的差分與軌跡請以 `743601a` 的 `src`、`tests` 為準。

**修法**：底部那一排由元件（`screen.Bottom`）改成普通函式（`screen.bottom()`），`Review` 直接呼叫、放進同一個 `.ec-actions`，所以換題型時 React 看到的是同一棵樹。新測試 `tests/review-focus.test.ts` 在修正前兩個都失敗。

**第一輪的盲點已補**：同一個資料夾多了真 React 的軌跡（`dom-trace.mjs`、`dom-compare.mjs`，用法見 `README.txt`）。React 19 加 happy-dom 畫新舊 `Review`，餵同一串亂數動作（打字、按鍵含 Enter 的預設點擊、點擊、改焦點、時間、切走、別台裝置寫入），每一步寫下整棵 DOM、**每個節點的身分編號**（重新掛載就拿到新號）、`activeElement`、朗讀、事件、紀錄檔。它抓得到 `8bd9feb` 的 F1（40 串有 19 串不同）。

**修正後跑過的**（`743601a`，輸出是資料夾裡的 `f1-*.out`）：`npm run check` 1210 個測試全過；`diff.mjs` 2000 串 × 80 步、`ui-diff.ts` 500 串 × 60 步、`parse-diff.mjs` 19782 份、軌跡 120 串 × 50 步（種子 7，6120 步）都 0 差異；`mutate.mjs` 20 處全部抓到。這些都還是沒有版面、真的輸入法、Obsidian 的 Markdown 渲染。

**查什麼**：

1. F1 的重現路徑在新版是否消失；這個修法有沒有帶來別的差異（`inert`、回報選單開著時、打字中沒有這一排、完成畫面）。
2. 重跑軌跡，換一個種子；看 `dom-trace.mjs` 有沒有把差異比掉（例如 `ATTRS` 漏了什麼、動作走不到什麼）。
3. 第一輪的四個差分也重跑一次：只有 `screens.tsx`、`Review.tsx` 兩個產品檔改過。

結果接在同一份報告後面，加「第二輪」一節，狀態行改成最新的結論。
