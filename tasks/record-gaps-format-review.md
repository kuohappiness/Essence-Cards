# 補上錯過就補不回來的紀錄的格式（格式查核，給 Codex）

狀態：待查核（2026-11-09）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。

[任務說明](record-gaps.md)會開始寫狀態與設定的變更行、新增 `紀錄/考試切面/` 的檔，開工前要查核格式（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點）。程式還沒寫。

**這份有一處偏離環節 4 的結論，請特別查**：任務說明 §1 把「和合併後紀錄的最後一筆比」改成「和這台自己的紀錄的最後一行比」，理由寫在那一節。

## 基準

- 這份請求所在的 commit（`git log -1 --format=%h -- tasks/record-gaps-format-review.md`），在 `main`。
- 實作會從 AI 製卡最小版合併後的 `main` 開始。`src/state/` 請同時看分支 `claude/ai-cards-mvp`（`changeStatus` 的啟用在那裡）。

## 讀什麼

- [任務說明](record-gaps.md)的 §1、§2、§6；§3、§4 只在判斷格式需要時看。
- [syntax §4](../docs/syntax.md#4-考試範圍)、[§5](../docs/syntax.md#5-複習紀錄)、[§5-1](../docs/syntax.md#5-1-版本行)、[§5-2](../docs/syntax.md#5-2-讀不懂的行)、[§5-3](../docs/syntax.md#5-3-還原檔)。
- 決定：D-105、D-115、D-149 第 3 點、D-150 第 8 點、D-176 第 3 點。查法：`node experiments/tools/decisions-index.mjs D-xxx`。
- [外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)：只讀 M4（搜尋「M4｜P2」）與「第 4 題：M4 可用紀錄補啟動基準」那一節。
- 程式：`src/state/index.ts`（`record`、`checkApp`、`batch`、`changeStatus`）、`src/core/study/history.ts`、`src/core/study/entries.ts`、`src/core/deck/parse.ts` 的屬性區、`src/core/catalog/scope.ts`、`src/core/catalog/scope-view.ts` 的 `targetsInScope`、`src/core/deck/folders.ts`、`src/core/backup/plan.ts`、`tools/update-vault.ts`。

## 要查的事

1. **只比自己的紀錄**（§1）：有沒有反例會漏記、誤記或一直重寫。涵蓋時鐘偏差、紀錄與卡組到達的先後、衝突副本、還原檔、換了裝置碼、月份交界。回測「用最早的那一筆」的說法要不要改；每台的時間線夠不夠回答 D-105 要分辨的事。
2. **基準不加欄位**（§1）：第一行當基準，分不分得出「當時才改」與「第一次看到」；改名後的新路徑也是第一行，會不會讀錯。目標沒暫停不寫基準，缺行當啟用可不可靠。
3. **不寫的情況**（§1 的表）：`狀態` 的值認不得、屬性區寫壞、需要新版、沒有 ID、重複 ID、待處理。有沒有該寫卻沒寫、或把預設值寫成真的狀態；`parseDeck` 目前分不分得出「沒有這個屬性」和「值認不得」，要改什麼才分得出。
4. **舊版與排程**：`0.3.0` 與現在的 `main` 讀到大量 `set: status`、第一次出現的 `cap`、`retention`、`filter`，會不會影響排程、`undo`、ID 占用（`seen`）或 §5-2 的處理。
5. **切面的檔**（§2）：位置、檔名、副檔名、欄位夠不夠回答「考試時有沒有這張卡」，有沒有多的。`isLogPath`、`isDeckPath`、備份、還原清單、更新命令、系統資料夾的防呆會不會把它誤認。JSON 字串能不能逐字還原卡組原文（CRLF、emoji、不成對的代理字元）。
6. **切面的時機**（§2）：開始日、清晨 4 點、延期、提前結束、日期有問題、兩台、讀不到、選定的範圍換了。「資料夾裡已有同一份就不寫」會不會因為只同步了一半而永遠少一份。
7. **哪幾篇**（§2）：`unitInScope` 加 `targetsInScope` 夠不夠；`index.members` 含不含草稿、暫停、需要新版的卡組；跨單元的出處有沒有漏。
8. **邊界與測試**：§6 的清單漏了哪些應該寫成測試的情況。

只回報有證據的；不擴張成新的功能（設定頁、目錄的批次暫停都在之後的任務）。

## 回報

寫在 `Claude Codex Discussion/2026-11-09-record-gaps-format-review.md`，commit 並 push 到 `main`（只提交這份回報）。每項寫結論、證據、建議（照寫／改寫法／加例子）；最後一行寫沒查的項目與原因。
