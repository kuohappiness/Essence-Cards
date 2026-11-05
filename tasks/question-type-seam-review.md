# 題型接點與點選填空的 L2（給 Codex）

狀態：待審

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。只審查、不改產品程式；要重現時用隔離的暫存資料，不碰測試 vault 與正式使用的 vault。

這個分支跨模組，改了解析、寫回筆記、紀錄、排程與複習流程，照 [quality.md](../docs/agents/quality.md) 合併前要 L2。先讀 code-quality 的 `review.md`。

## 審查對象

- 工作目錄 `D:\程式開發\Essence Cards\.claude\worktrees\state-split-c5c7bf`，分支 `claude/compare-pick-34bcaf`（已 push）。沒有未提交的修改。
- 待審 commit：使用者貼給你的那句話裡的 SHA。這份請求和結果記錄就在那個 commit，不影響程式。
- 基準：`ecbdbad`（`main`，已合併進這個分支，也是共同祖先）。看差異用 `git diff ecbdbad <待審 commit>`，產品程式與工具約 2 千行增加、6 百行刪除，其餘是測試與文件。
- 合併提交 `59c4b96` 的衝突解法要看（見〈行為與風險〉的交界）。
- 第一步（§2，翻面、打字搬到接點）Codex 查過行為有沒有變（[請求](question-type-seam-step1-review.md)，複查通過），這次不重查；接點的形狀（§1）這次要看。

## 規格與優先順序

1. [任務說明](question-type-seam.md) §1、§3～§12。§3、§4、§5-4、§8、§10、§11 是格式查核四輪之後改寫的版本。
2. 它引用的決定：[D-178](../docs/decisions.md#d-178-相似字用點字比較卡一格一個學習目標)、[D-181](../docs/decisions.md#d-181-題型是可以接上的模組開題型專區)、[D-182](../docs/decisions.md#d-182-比較點選各科都能用家長出題時勾選)、[D-191](../docs/decisions.md#d-191-比較卡舊裝置整篇擋住每個字鍵一格就多放一句)、[D-192](../docs/decisions.md#d-192-比較點選改名點選填空英文預設也勾)。查 D-ID 用 `node experiments/tools/decisions-index.mjs D-xxx`。
3. [規畫](../docs/plans/similar-chars.md)的〈畫面與防點錯〉，示意頁 `experiments/mockups/similar-chars-card.html`。
4. [格式查核報告](<../Claude Codex Discussion/2026-11-05-question-type-seam-format-review.md>)：四輪裡已定的 R 編號不重開。使用者決定查到第四輪，**第四輪之後改的部分由這次查**：看 `ce1733d` 之後任務說明的差異。

規格之間有衝突，列成問題，不挑容易通過的那份。可以回報「規格本身有漏洞」。

## 行為與風險

**公開介面與主要呼叫端**：`parseDeck`、`markNeed`（`src/core/deck/`）；`withNeed`、`confirmed`（`src/state/`）；`planToday`、`nextCard`、`cardOf`、`questionType`（`src/core/study/`）；`createSession`、`createPreview`、`createFlow`（`src/review/`）；`SCREENS`、`pickScreen`、`Review`、`Markdown` 的 `mode: 'pick'`（`src/ui/`）；`experiments/t4/check-syntax.mjs`；`tools/compare/`。

**不可破壞的性質**：

- 翻面與打字的行為、紀錄的每一個字都不變。§2 那四個測試檔：`tests/review-session.test.ts`、`review-ui.test.ts`、`preview.test.ts` 沒改；`tests/review.test.ts` 只多一個 `englishBeside` 的測試和它的 import。
- 舊版（v0.3.0）讀到有標記的卡組整篇擋住、提示更新；讀得懂比較卡的紀錄行（D-191）。
- 寫回筆記往返與冪等；加不上標記時不補 ID、文字不動；第二次離開筆記不改任何字。
- 紀錄：一個目標一行，欄位順序 `pick`、`retry`、`also`、`with`；回看改評分時 N 行要嘛全寫、要嘛不寫。
- 同一張比較卡在排程與秒數裡算一次卡片事件（§5）；FSRS 重播每個目標照自己那一行。

**這次合併 `main` 才碰在一起的交界，還沒有人查過組合，請先看**：

1. `src/core/study/practice.ts` 的全部卡一輪：`main` 把 `ready`、`fresh` 改成陣列，比較卡那一段的 `early` 改看長度；`chooseSpaced`、`answeredAfter` 算隔開時比較卡一張寫好幾行。
2. `firstTry`（`src/review/done.ts`）：比較卡的每一行都交給它，一個字一個分母（`tests/pick-flow.test.ts`）。回看改評分、再選、別台裝置同步進來的情況。
3. `encodeNew`（`src/core/study/entries.ts`）的新紀錄契約：比較卡的 `pick`、`retry`、`also`、`with` 沒有另外驗，靠編碼後讀回。
4. `setDeckStatus`（`src/state/index.ts`）：暫停、恢復比較卡組時 `need: null`，不補標記；`confirmed` 同時看 `status` 與 `need`。
5. 目錄的單篇全部卡、小考的日期：組裡的字分在不同篇、部分暫停時。

**明確延後**：§12 列的；iPhone 的項目（下面）。`PICK_NEEDS` 暫定 `0.4.0`，合併時才確認比最新的 tag 新（§3）。`docs/syntax.md`、`docs/question-types.md` 在第 4 步才更新，這次不用查它們有沒有跟上。

例子只是起點，請找新的組合。

## 驗證方式

環境：Windows 11，Node 24，Obsidian 1.15.0。

```bash
npm run check
```

```bash
node --test --test-timeout=120000 tests/pick-render.test.ts tests/pick-flow.test.ts tests/pick-plan.test.ts tests/pick-queue.test.ts tests/pick-log.test.ts tests/pick-look.test.ts tests/pick-preview.test.ts tests/pick-ui.test.ts tests/pick-deck.test.ts tests/pick-old-version.test.ts tests/mark-need.test.ts tests/state-need.test.ts tests/need-lines.test.ts tests/check-syntax-pick.test.ts tests/compare-versions.test.ts
```

```bash
node experiments/t4/check-syntax.mjs --selftest
```

**實作者跑過的**（結果在[任務說明 §10 的 Windows 實機結果](question-type-seam.md#windows-實機的結果2026-11-05)）：`npm run check`（pre-commit，每個 commit）；`npm run build`；§10 列的 Windows 項目，建置 `0.4.0+59c4b96`；`md-cases` 在隔離環境與測試 vault 各一次。實機之後只補測試與文件，產品程式沒改。

截圖與腳本不進 repo：`C:\Users\kuo\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_fa1934dd-c734-4953-974e-eef1a0a4b88a\question-type-seam-real-run-59c4b96\`，用法寫在 `README.txt`。

**沒跑的**：

- iPhone 全部，已記進 [backlog 的下一次 iPhone 實機測試](../docs/backlog.md#v1-需要做的任務)，使用者之後一次測。
- 輸入法組字**中途**按 Enter 不送出：遠端偵錯送不出真的輸入法按鍵，這段程式（`isComposing`）沒改；組字完成後 Enter 送出有跑。

## 實作者自己選的做法

規格沒寫、由實作者決定的地方，逐條寫在[任務說明的〈實作者自己選的做法〉](question-type-seam.md#實作者自己選的做法l2-請先看)（第 1～31 點，含理由），請先看這些。第 19（`0.4.0` 暫定）、25（詞的字鍵一排最多 4 個，和 D-182 第 6 點的「6 個以內一排」不同）、27（比較句的英文換行）、28（實機環境）、30（合併時的決定）、31（§11 留到第 4 步的一條）是實機與合併才加的，還沒有人看過。

## 回報與權限

- 報告寫到 `Claude Codex Discussion/2026-11-05-question-type-seam-l2.md`，標題下第一行寫狀態。不要 commit，也不要改其他檔案。
- 每項發現寫觸發條件、預期／實際、影響、位置與證據，區分「已重現」「靜態推斷」「待驗證」；另標**真實路徑會不會發生**：使用者的資料、執行環境的實際行為或已發布的版本，會不會產生這個輸入。
- 影響要算真實值：比真實、現在、修法後三欄，修法要實跑。
- 同一個問題只報一次，標明是規格還是規範與設計。自動檢查已經擋下的不重複報。
