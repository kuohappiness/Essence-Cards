# 程式品質：本專案的設定

給 `code-quality` skill 讀（[D-119](../decisions.md#d-119-程式品質的-skill-整併成通用的-code-quality)）。這裡只寫對應與連結，規則本身在連到的地方。

## 角色

| 角色 | 由誰擔任 |
|---|---|
| 實作者 | Claude（[D-131](../decisions.md#d-131-claude-實作codex-在關鍵點查核)）；例外轉出時是 Codex |
| 獨立審查者（L2） | 新開的 Codex session，不能是寫程式的那一個。Codex 不能用時，由 Claude 開子代理（L3），做不到的部分明列 |
| 整合者 | Claude：寫規格、L1 對照、核對 L2 的發現、合併 |

成本：檢查不減；能交給自動檢查的就不靠人看。Claude 實作時的 L1 是自己對照規格，不算獨立審查，所以驗收條件要先寫成能用程式判斷的句子。困難的除錯，建議使用者把 Claude 切到 xhigh，或請 Codex 查核（推理等級：高）。

## 檢查指令

- `npm run check`：型別、ESLint（含模組邊界）、knip、secretlint、skill 副本一致性、測試（[D-117](../decisions.md#d-117-技術債預防機械檢查全自動ai-審查只在關鍵點)）。W3 第 0 步裝好之前，用 `npm run typecheck`、`npm test` 和 `node tools/check-skill-mirror.ts`。
- 自動執行的地方：`.githooks/pre-commit`、`.github/workflows/check.yml`。
- 建置：`npm run build`，`main.js` 只能 require Obsidian 提供的 `obsidian`、`@codemirror/state`、`@codemirror/view`（[D-134](../decisions.md#d-134-學習目標-id-的補上時機與保護) 的編輯器鎖定），不能把另一份 CodeMirror 打包進去（`tools/build.mjs` 會擋）。

## 規格來源

- 任務說明：v1 程式在 `tasks/*.md`，試作場在各資料夾的 `TASK.md`。
- 決定：[decisions.md](../decisions.md) 的 D-ID；commit 訊息裡的 `(D-xxx)` 指的就是這裡。
- 資料格式：[syntax.md](../syntax.md)。程式結構與模組邊界：[D-110](../decisions.md#d-110-v1-外掛的程式結構) 與 `eslint.config.js`。

## 高風險範圍（要做 L2）

跨模組的改動、資料格式、排程（FSRS 與紀錄重播）、寫回使用者筆記的函式。

## 本專案的做法

- 寫回筆記的函式，往返與冪等測試登錄進共用的範例清單：`tests/deck.test.ts` 的 `deckCases`。
- 只在 Node 驗過的檔案存取，接上 Obsidian 前要在 Windows 版 Obsidian 對照一次（D-110）。
- 測試只用 syntax.md 的例子或自編的內容；課本、學生資料不進 repo。
- 要用 iPhone 實機的測試集中成一次（[D-065](../decisions.md#d-065-試作場)）。

## 技術債清單

[backlog 的「技術債」一節](../backlog.md#技術債)。

## 里程碑

見 [roadmap](../roadmap.md)。第一個是 W1～W6 打通「手寫卡組 → iPhone 複習 → 自評 → 排程」（[D-111](../decisions.md#d-111-v1-的開發順序capture-延後)）。

## 共用的 skill

`.claude/skills/` 與 `.agents/skills/` 裡的 code-quality、essence-decision、essence-discuss，兩份內容必須相同，由 `tools/check-skill-mirror.ts` 檢查；改其中一份時，另一份一起改。
