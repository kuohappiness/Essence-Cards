# 出處的原文位置與寫回（格式查核，給 Codex）

狀態：已完成：三輪查核（[回報](<../Claude Codex Discussion/2026-11-06-edit-markup-format-review.md>)），R1～R10 與第三輪的 R9 續都採用，寫進[任務說明](edit-markup.md) §1、§3、§4、§6

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。

[第四批任務說明](edit-markup.md)要讓解析多記出處的原文位置（§3），並用小表單把出處寫回家長的筆記（§4-3）。開工前查核格式（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點）。

## 基準

- 這份請求所在的 commit（`git log -1 --format=%h -- tasks/edit-markup-format-review.md`），在 `main`。
- 程式還沒開始寫；查的是任務說明的規格。

## 讀什麼

- [任務說明](edit-markup.md)的 §3、§4-2、§4-3；§1-2（問題多記欄位的位置）與 §4-3 第 5 點的錯誤紀錄新環節也算格式。其他節只在判斷需要時看。
- 語法：[syntax §2-4](../docs/syntax.md#2-4-資料欄位)（欄位與分行）、[§2-5](../docs/syntax.md#2-5-出處)（出處）、§2-1（需要版本）、§9（錯誤紀錄）。
- 決定：[D-164](../docs/decisions.md#d-164-出處的寫法與讀法) 第 4～6 點、[D-169](../docs/decisions.md#d-169-家長亂填出處是常態程式不猜看不懂就當場教) 第 5 點、[D-170](../docs/decisions.md#d-170-出處的讀法不用猜的直接讀懂要猜的讓家長選) 第 6、10 點。
- 程式：`src/core/deck/markdown.ts`（`listTree`）、`src/core/deck/parse.ts`（`collectFields`、`addValues`、`fieldChildren`）、`src/core/deck/sources.ts`（`sourceLinks`、`rawCutter`、`mask`）、`src/core/deck/assign.ts`（補 ID 與改縮排，寫回之後它還要正確）、`tests/deck.test.ts` 的 `deckCases`、`tests/sources.test.ts` 的共用清單。

## 要查的事

1. **和已有的決定、syntax.md 有沒有矛盾**：特別是 §4-3 的「換成別的單元時搬到最後」「分行的切法」「`｜` 只搬出處」，以及表單寫的字（§4-2）是不是都是 syntax §2-5 已有、而且讀回意思相同的寫法。
2. **原文位置定不定得出來**（§3）：`Item.starts`、`sourceSpans`、`sourceFields`、`SourceItem.at` 的定義，碰到下面這些時是否明確、能不能寫成測試：Tab 與全形空白、接續行、`｜` 的兩種寫法（全形、半形接欄位名稱）、連結與「標題」裡的頓號、去雜訊改變長度的字（`p。44`、全形數字）、`RAW_CUT_LIMIT`、去重、整欄都沒讀到的那一項、欄位在題目或補充底下（`collectFields` 的遞迴）。
3. **寫回之後**：分行的結果，舊版外掛（0.3.0，已有分行的讀法）讀不讀得到同樣的意思；補 ID、改縮排（`assign.ts`）會不會改到分行的內容；`deckCases` 要加哪些。
4. **核對夠不夠**（§4-3 第 5 點）：列的條件能不能擋住「寫回改變了別的項目或別的欄位的意思」；有沒有漏掉的（例如題目指紋以外的背面補充、`錯題補強` 的順序）。
5. **錯誤紀錄的新環節** `edit`：和 syntax §9 的寫法一致嗎；`msg` 不寫筆記內容夠不夠回頭查。
6. **邊界**：CRLF、BOM、筆記最後沒有換行、同一行兩個 `出處：`、`出處：` 沒有值、子項目用 `*` 或數字清單、縮排用 2 格的筆記。

只回報有證據的；不擴張成新的功能。回報寫在 `Claude Codex Discussion/2026-11-06-edit-markup-format-review.md`。
