# 重複的學習目標 ID 開工前的格式查核（給 Codex）

狀態：等 Codex 查核（使用者開新的 Codex session）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**，不要用查過外掛架構討論稿環節 2、3 的那一個。

依 [D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點與 [quality.md〈開工前的格式查核〉](../docs/agents/quality.md#開工前的格式查核)：[重複的學習目標 ID](duplicate-ids.md)（D-157）會改「哪些 ID 算重複」的判斷、存檔時的自動換號，以及家長選了之後寫回卡組筆記的內容。syntax.md §2-3 已照 D-157 改寫並標待實作（`5d17605`），程式等這次查核一致才開工。**只回報，不修改**任何檔案；要改的由 Claude 改。

## 基準

- 這份請求所在的 commit（`git log -1 --format=%h -- tasks/duplicate-ids-format-review.md`），在 `main`；任務說明在同一個 commit。
- 程式以同一個 commit 的 `main` 為準，已包含寫錯的目標看得到（技術債 D1，`b9309ca`）。正式使用的 vault 與 iPhone 裝的是 `0.2.0`，仍照位置與路徑決定誰保留。

## 讀什麼

| 讀什麼 | 為什麼 |
|---|---|
| [任務說明](duplicate-ids.md) §1、§3、§7，加上〈排程與分支〉第 3 步那一段 | 這次要查的格式：哪些算衝突、不自動換號、寫回什麼、文件 |
| `docs/syntax.md` [§2-3](../docs/syntax.md#2-3-學習目標)（全節，ID 那一段是這次改的）、[§2-1](../docs/syntax.md#2-1-屬性) 的「需要版本」、[§2-10](../docs/syntax.md#2-10-寫錯時)、[§5](../docs/syntax.md#5-複習紀錄) 開頭 | 要對照的格式 |
| [D-157](../docs/decisions.md#d-157-重複的學習目標-id先停家長選)、[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)、[D-079](../docs/decisions.md#d-079-卡組筆記的結構與學習目標的資料) 的 ID 那一段、[D-034](../docs/decisions.md#d-034-學習目標-id)、[D-135](../docs/decisions.md#d-135-清單解析和-obsidian-對照後的處理)、[D-089](../docs/decisions.md#d-089-語法的邊界規則與寫錯時的處理) 第 9、10 條 | 要對照的決定 |
| [外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)〈環節 2 的結論〉第 3 條與你上一輪〈第 2 題〉的邊界表 | 定 D-157 時的結論 |
| `src/core/deck/parse.ts`（ID 的辨識與 `duplicate-id`）、`markdown.ts`（`nameIds`、`blockIds`、`TRAILING_ID`）、`assign.ts`、`ids.ts`（`setTargetId`）；`src/state/ids.ts`（`fill`、`reserve`、`taken`、`resolve`）、`src/state/index.ts`（`rebuild`、`gatedIds`）；`src/core/study/plan.ts:80–103`；`tools/compare/adapter.ts:62–68`；`src/core/backup/plan.ts` 的全庫 ID 檢查 | 現在辨認、補、換、檢查 ID 的程式 |

其他文件不用讀；任務說明的 §2、§4～§6、§8 不是這次的範圍（合併前的 L2 會看）。

## 要查的事

1. **§1 和 syntax.md、已有的決定有沒有矛盾**：「讀得懂的卡組裡、`parseDeck` 認出、`id` 不是 null 的學習目標」這個範圍，和 syntax §2-3 的每一種 ID 寫法對不對得上：行尾的 ID、名稱行中間的 ID（`misplaced-id`）、名稱寫成兩行（D-135：Obsidian 只認整段最後的區塊 ID）、`ambiguous-id`、還沒有 ID 的隱含目標；引言框、一般筆記、題目行的區塊 ID 不算；轉錄稿。和需要新版的卡組同一個 ID 時照原本停、不列成衝突，是否符合 §2-1。讀不到時保留上一次讀到的內容，是否符合 state 的讀取規則。
2. **§3-1 改了核心的契約**：`assignIds` 不再換同一篇裡重複的 ID、刪掉 `AssignOptions.replace`。除了 `state`，還有沒有讀的一方或工具依賴「篇內第二個會換新」（例如 `src/obsidian/dev.ts:326`、還原的全庫 ID 檢查、發布前比較）。`duplicate-id` 代碼與等級不變、只改文字，發布前比較的快照（記代碼）是否就不會多出差異。
3. **§3-2 寫回的內容**：家長選「這一個是新加的」時，只把那一行的 ID 換成新配的，其他字不動。請查 `setTargetId` 與現在「當成新的」那條路，遇到名稱行中間的 ID、名稱寫成兩行、行尾有空白時寫出來的是不是 syntax §2-3 的格式；新 ID 避開的範圍（`taken`）夠不夠符合 D-034「整個 vault 不重複，刪除後不再使用」；舊 ID 還在別的目標上，不記成刻意拿掉，和 D-134 的「刪除後不再使用」有沒有衝突。
4. **舊的資料與還沒更新的舊版**：
   1. 複習紀錄的格式不變（任務說明 §3-2「紀錄」）：請確認 syntax §5 沒有要跟著改的地方，被選中的那一個用新 ID 從頭複習、舊 ID 的紀錄給剩下的那一個，和 §5 的規則一致。
   2. 已經有的 vault：現在跨篇的重複照路徑出、不會被發現，裝新版後會一起停（〈排程與分支〉第 3 步）。這個說法對不對；還有沒有別種舊資料（例如 `0.1.0` 存檔時換過號的）會在新版出現意外。
   3. iPhone 還在跑 `0.2.0` 的那段時間：舊版照路徑出、照收作答，副本仍可能被記錯；新版寫回的卡組舊版讀得懂。Claude 的看法是不另加保護（卡組的格式沒變，加「需要版本」反而讓舊版整篇不出題）。請說同不同意，不同意附理由。
5. **邊界有沒有寫清楚、能不能寫成測試**：§1 的每一條與任務說明 §8 的第 12～16、20 項，能不能直接寫成測試的輸入與預期；說法有兩種讀法的列出來。
6. **§7 的文件**：syntax §2-3 現在只寫「先都不出題、家長選、換新 ID」。哪些算重複、哪些不算（D-157 決定的第 1 點）要不要寫進 syntax.md；`docs/architecture.md:239` 還是舊規則，改成連到 syntax §2-3 夠不夠。
7. 其他你認為開工前就該改的格式問題。

## 回報

新開一份 `Claude Codex Discussion/<查核那天的日期>-duplicate-ids-format-review.md`（例如 `2026-11-01-duplicate-ids-format-review.md`），commit 只含這個檔案（訊息 `docs: Codex's format check for duplicate learning-target IDs`）：

- 逐項列出「通過」或「有問題」。有問題的附檔案、行號、原因與建議的寫法，標 P1～P3，並分成「開工前要改」和「實作時再定」。
- 你跑過的探針或測試（只用自編資料，不碰任何真的 vault），以及沒有查的項目與原因。
