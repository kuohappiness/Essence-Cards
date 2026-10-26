# 程式品質：本專案的設定

給 `code-quality` skill 讀（[D-119](../decisions.md#d-119-程式品質的-skill-整併成通用的-code-quality)）。這裡只寫對應與連結，規則本身在連到的地方。

## 角色

| 角色 | 由誰擔任 |
|---|---|
| 規劃者 | Claude 的 Fable：任務說明、大的設計、L1 設計回顧（[D-140](../decisions.md#d-140-fable-規劃opus-執行codex-查核)） |
| 實作者 | Claude 的 Opus（[D-131](../decisions.md#d-131-claude-實作codex-在關鍵點查核)、D-140）；例外轉出時是 Codex |
| 獨立審查者（L2） | 新開的 Codex session，不能是寫程式的那一個。Codex 不能用時，由 Claude 開子代理（L3），做不到的部分明列 |
| 整合者 | Claude 的 Opus：L1 對照、核對 L2 的發現、合併 |

成本：檢查不減；能交給自動檢查的就不靠人看。Claude 實作時的 L1 是自己對照規格，不算獨立審查，所以驗收條件要先寫成能用程式判斷的句子。困難的除錯照〈[卡關時的升級](#卡關時的升級)〉。

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

## 開工前的格式查核

[D-140](../decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點。任務說明會改出題語法的解析、複習紀錄的欄位，或其他寫進使用者檔案的格式時：

1. 規劃者寫好任務說明後，另寫查核請求 `tasks/<任務>-format-review.md`：只列格式那幾節、要對照的決定與 syntax.md 的章節、基準 commit；任務說明的開工條件寫明哪幾節要等查核。
2. 新開的 Codex session（推理等級：高）查：和已有的決定、syntax.md 有沒有矛盾；舊的資料與還沒更新的舊版外掛讀不讀得到；邊界情況有沒有寫清楚、能不能寫成測試。只回報，寫在 `Claude Codex Discussion/`。
3. Claude 核對回報、改任務說明，再實作那幾節；任務的其他部分不用等。合併前的 L2 照舊。

## 卡關時的升級

[D-140](../decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 3 點。同一個 bug 照 code-quality 的除錯做法，列出的假設都被推翻，或做不出能重現的指令時，依序：

1. **Opus 切到 xhigh**，從除錯做法的第 1 步再做一次。
2. **新開的 Codex session 從頭查**（Sol，推理等級：xhigh）：只給重現指令（做不出來時給症狀與出現的條件）、錯誤訊息、相關檔案與基準 commit，**不給 Claude 的假設與推論**。Codex 只回報。
3. **交給 Fable，或 Codex 的 Astra**（先開 Low 或 Medium）：附交接說明，寫目標、試過的做法、各自為什麼不對、目前的證據。

換模型與轉貼要使用者做，所以每升一級都先跟使用者說一聲。找到根因後，回到除錯做法的第 5 步，由 Opus 修。

## 本專案的做法

- 寫回筆記的函式，往返與冪等測試登錄進共用的範例清單：`tests/deck.test.ts` 的 `deckCases`。
- 只在 Node 驗過的檔案存取，接上 Obsidian 前要在 Windows 版 Obsidian 對照一次（D-110）。
- 測試只用 syntax.md 的例子或自編的內容；課本、學生資料不進 repo。
- 要用 iPhone 實機的測試集中成一次（[D-065](../decisions.md#d-065-試作場)）。

## 技術債清單

[backlog 的「技術債」一節](../backlog.md#技術債)。

## Obsidian 相容性檢查

[D-138](../decisions.md#d-138-obsidian-出新的次版本時做一次相容性檢查)：Obsidian 出新的次版本（例如 1.14 → 1.15）時做一次，由 AI 做。

- **目前驗證過的版本**：Windows 1.14.5（2026-10-26，W5 第二部分的開發命令）；iPhone 還沒有用正式程式驗過（W5 說明寫的是 1.14.5），W6 的 iPhone 測試之後補上。
- **怎麼發現新版**：開發命令的結果檔會記 Obsidian 的版本（`obsidian` 欄位），AI 在 Windows 版 Obsidian 跑開發命令時看到比上面新的次版本就做；每個里程碑結束時也查一次 Obsidian 的改版說明。
- **三層**：
  1. 比對新舊版 `obsidian` 套件的 `obsidian.d.ts` 與 `peerDependencies`（CodeMirror 的版本）：本專案用到的 API 有沒有改、標成不建議使用；CodeMirror 版本變了就把 `package.json` 的開發相依改成一樣，跑 `npm run check`。
  2. 在 Windows 版 Obsidian 用開發版重跑 `files`、`compare`、`lock`、`save`、`today`、`answer`（`npm run install-vault -- <測試 vault> --dev`；`lock`、`save` 在 W5 第二部分合併後才有），結果和上一次比。
  3. 讀改版說明裡和這幾點有關的條目：編輯器與 CodeMirror、Markdown 解析與閱讀模式（清單、區塊 ID）、檔案與 vault 的事件、iOS 與同步；每一點寫一句結論。
- **結果**：寫進 roadmap 的已完成，通過就更新上面的版本；有不相容先寫失敗測試再修（高風險範圍做 L2）。iPhone 的部分記進下一次 iPhone 實機測試的清單。

## 里程碑

見 [roadmap](../roadmap.md)。第一個是 W1～W6 打通「手寫卡組 → iPhone 複習 → 自評 → 排程」（[D-111](../decisions.md#d-111-v1-的開發順序capture-延後)）。

## 共用的 skill

`.claude/skills/` 與 `.agents/skills/` 裡的 code-quality、essence-decision、essence-discuss，兩份內容必須相同，由 `tools/check-skill-mirror.ts` 檢查；改其中一份時，另一份一起改。
