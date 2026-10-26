# W6 開工前的格式查核（給 Codex）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**，不要用審過 W5 的那一個。

依 [D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點：W6 會改兩種寫進使用者檔案的格式，Claude 實作這兩節之前，請你先看任務說明裡的這幾段。**只回報，不修改**任何檔案；要改的由 Claude 改。畫面、手勢、朗讀不在這次的範圍，合併前的 L2 才看。

## 基準

- 這份請求所在的 commit（`git log -1 --format=%h -- tasks/w6-format-review.md`），在 `main`。
- 任務說明是 [tasks/w6.md](w6.md)；程式以同一個 commit 的 `main` 為準（W5 第二部分已合併，`4a7d522`）。

## 讀什麼

| 讀什麼 | 為什麼 |
|---|---|
| [tasks/w6.md](w6.md) 的 §0-1、§0-2、§1〈核心的改動〉、§2-3 表格下面的幾點、§2-5 的「改評分」 | 這次要改的格式，以及什麼時候寫 `typed`、`retry` |
| [docs/syntax.md](../docs/syntax.md) §2-3（中翻英與 ` \| `）、§2-8（題目指紋）、§5（複習紀錄） | 格式的正本 |
| [D-122](../docs/decisions.md#d-122-片語放進句子裡打字)、[D-121](../docs/decisions.md#d-121-打字卡答錯時的三步流程)、[D-125](../docs/decisions.md#d-125-英文規則依製卡流程重排與一字多義的學習目標)、[D-115](../docs/decisions.md#d-115-回頭查要用的證據先收好)、[D-084](../docs/decisions.md#d-084-回看上一張與滑動手勢)、[D-035](../docs/decisions.md#d-035-複習紀錄格式) | 相關的決定 |
| [docs/card-rules/english.md](../docs/card-rules/english.md) 裡 ` \| ` 的寫法與例子 | AI 製卡實際會寫出來的答案格 |
| `src/core/deck/parse.ts`、`src/core/deck/types.ts`（答案格、`typed`、指紋）；`src/core/study/entries.ts`、`log.ts`、`history.ts`、`session.ts`、`types.ts`（`checkTyped`、`NewEntry`、`encodeEntry`、`parseLine`、`appendLine`、`mergeHistory`） | 現在的實作 |
| [docs/plans/updates.md](../docs/plans/updates.md) 的資料相容 | 兩台裝置的外掛版本不同時 |

其他文件不用讀。

## 要查的事

1. **` | ` 的拆法**（§0-1）
   - 和 D-122、syntax.md §2-3、english.md 的寫法一致嗎？有沒有合法的答案格會被拆錯，例如 `|` 在 `**…**` 或 `==…==` 裡、粗體跨過分隔（`**a | b**`）、`\|`、行內程式碼？規則沒寫到的情況列出來，並建議怎麼寫。
   - 「題目指紋照舊用整個答案格」：照 `main` 上指紋的算法，已經寫下的紀錄，`v` 在改版後還配得上嗎？有沒有哪種寫法會讓 `answer` 或指紋跟著變？
   - `typed-answer-invalid`、新的 `typed-answer-words` 的條件有沒有互相矛盾，或漏掉的組合。
2. **`retry` 欄位**（§1、§2-3、§2-5）
   - 什麼時候寫、寫什麼值，和 D-121 的三步、D-115 第 2 組的證據一致嗎？之後分析時，能不能只靠 `typed` 和 `retry` 分出每一種情形（第 1 步拼對、第 1 步拼錯而跳過第 2 步、第 2 步拼對、第 2 步拼錯、按「沒印象」）？
   - `parseLine` 不讀 `retry`、`encodeEntry` 的欄位順序：在 `main` 的程式下，`appendLine` 與 `mergeHistory` 的一致性、去重、`undo` 真的不受影響嗎？
   - 改評分時「先取消，再寫同樣的 `typed`、`retry` 加新的評分」，和 syntax.md §5 的 `undo` 說法一致嗎？
3. **舊資料與舊版外掛**
   - 舊的紀錄（沒有 `retry`）、舊的卡組（答案格沒有 ` | `）在 W6 照舊能用嗎？
   - 一台裝置已經更新、另一台還是 W5 版時，W5 版讀到有 `retry` 的紀錄、有 ` | ` 的卡組，會不會出錯或算錯排程？
4. **syntax.md §5 要加的 `retry` 那一列**（§1 最後一點）：寫法夠不夠清楚，和其他欄位的說法一致嗎？
5. 其他你認為開工前就該改的格式問題。

## 回報

寫在 `Claude Codex Discussion/2026-10-26-w6-format-review.md`，commit 只含這個檔案（訊息 `docs: Codex's W6 format check before implementation`）：

- 逐項列出「通過」或「有問題」。有問題的附檔案、行號、原因與建議的寫法，標 P1～P3，並分成「開工前要改」和「實作時再定」。
- 你沒有查的項目與原因。
