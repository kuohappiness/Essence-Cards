# 入口與目錄第一批開工前的格式查核（給 Codex）

狀態：查核完成；[報告與 Claude 的回應](<../Claude Codex Discussion/2026-11-02-entry-and-catalog-format-review.md>)

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。

依 [D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點與 [quality.md〈開工前的格式查核〉](../docs/agents/quality.md#開工前的格式查核)：[任務說明](entry-and-catalog.md)的 §9 會改出題語法的解析（單元編號、年級學期、出處的每一項），要先查。其他章節不用查。

## 基準

這份請求所在的 commit（`git log -1 --format=%h -- tasks/entry-and-catalog-format-review.md`），在 `main`；任務說明在同一個 commit。`claude/reverent-wing-577df1`（D-157）還沒合併，它不改這幾節的文法。

## 查什麼

1. [任務說明 §9-2](entry-and-catalog.md#9-單元索引與文法d-164) 的文法表：和 [syntax.md §2-1、§2-5](../docs/syntax.md#2-5-出處)、[D-033](../docs/decisions.md#d-033-教材目錄)、[D-080](../docs/decisions.md#d-080-轉錄稿的錨點與出處的寫法)、[D-142](../docs/decisions.md#d-142-範圍與目錄模組的六項選擇) 第 2、3 點、[環節 7 的原則 1、2、5、6](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md#環節-7-的結論claude-與-codex-一致待使用者決定-u1u6>) 有沒有矛盾。你在環節 7 第 1 題提的表是起點；這份只拿了第一批用得到的部分（區間與 `§4` 留給第二批）。
2. §9-2 列的四個待查核問題，特別是第 1 題：`CO2 的性質` 這種寫法，提案「`deck` 只標可能是單元、`catalog` 對到才算」有沒有漏洞；第二批的考試範圍接上時會不會出事。
3. 舊的資料：現有卡組與 `src/review/sources.ts` 的 `sourceLinks` 行為，哪些項目在新文法下讀法改變；舊版外掛遇到新寫的出處會怎樣（`docs/syntax.md` 的相容規則）。
4. 邊界情況有沒有寫清楚、能不能寫成測試：§9-3 的例子只是起點，請找新的組合，例如全形數字、全形空白、大小寫、`L1-2`、`2-`、單元名稱裡有空白、出處只有年級學期沒有單元。
5. §3 的單元鍵與多篇合併：同編號不同名稱、同一篇的目標出處寫到自己的單元、一個目標寫到兩個單元。

## 回報

只回報，不改產品程式與文件。寫在 `Claude Codex Discussion/2026-11-02-entry-and-catalog-format-review.md`，標題下第一行寫狀態。每項寫觸發條件、預期與實際、影響、位置與證據，區分「已重現」「靜態推斷」「待驗證」。可以回報規格本身的漏洞。沒有要改的也寫明查了什麼。
