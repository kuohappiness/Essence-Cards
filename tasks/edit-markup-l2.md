# 編輯畫面標示與出處小表單（Codex L2 審查請求）

狀態：待審（第一輪）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 Codex 對話**；只審查、不改產品程式，可以在隔離環境重現。

[任務說明](edit-markup.md)的程式要改寫家長的筆記（§4-3 寫回、§4-4 修改），也動到解析的結果（§3 原文位置），屬於[高風險範圍](../docs/agents/quality.md#高風險範圍要做-l2)，合併前做 L2。

## 審查對象

- 分支 `claude/edit-markup`（worktree 在 `.claude/worktrees/edit-markup`），和 `main` 的共同祖先 `8ae15afc90411261e2f92921407115b4bb5b5249`。
- 待審：共同祖先到這份請求所在的 commit（`git log -1 --format=%H -- tasks/edit-markup-l2.md`）的全部改動，含 §7 的 7 個程式 commit：`42a84f8`、`b670b9f`、`b8907f3`、`49b1c77`、`9a228fa`、`a8c819a`、`1115ca1`、`28cde5a`、`1315150`（各自的〈結果〉在任務說明最後）。這是這個任務第一次 L2，整包審。
- 沒有未提交的修改。

## 規格與優先順序

- 任務說明 [edit-markup.md](edit-markup.md) §1～§6（格式查核三輪已採用，[回報](<../Claude Codex Discussion/2026-11-06-edit-markup-format-review.md>)）。
- 它引用的：[syntax §2-4、§2-5、§2-10、§9](../docs/syntax.md)、[D-047](../docs/decisions.md#d-047-編輯畫面標示卡組結構)、[D-089](../docs/decisions.md#d-089-語法的邊界規則與寫錯時的處理) 第 5、10、11 條、[D-164](../docs/decisions.md#d-164-出處的寫法與讀法) 第 4～7 點、[D-169](../docs/decisions.md#d-169-家長亂填出處是常態程式不猜看不懂就當場教)、[D-170](../docs/decisions.md#d-170-出處的讀法不用猜的直接讀懂要猜的讓家長選)、[D-179](../docs/decisions.md#d-179-介面的每一項都要有必要性非必要不出現)。
- 規格衝突時列成問題，不挑容易通過的那份。

## 行為與風險

- **公開介面**（`src/core/deck/index.ts`）：`parseDeck(text, { layout: true })` 的 `layout`（`TargetLayout`：`fields`、`entries`、`parts`、`fieldColons`）；`readSourceParts`；`canEditSource`、`editSource`、`verifySourceEdit`（§4-3）；`fieldFixes`、`fixField`、`fixQuestion`、`NEEDS_NEWER`（§1-4、§4-4）。`Problem.columns`（§1-2）。
- **呼叫端**：`src/obsidian/markup.ts`（標示、圖示、點擊）、`src/obsidian/source-entry.ts`（表單與面板寫回）、`src/obsidian/source-form.ts`、`src/ui/sources.ts`（`unreadableSources`，存檔按鈕與標示共用）、`src/main.ts` 的接線、`src/core/catalog/source-guess.ts`（§4-1、§4-2）。
- **不可破壞的性質**：
  - 沒給 `{ layout: true }` 時 `parseDeck` 的結果和改之前完全一樣；`sourceLinks` 的按鈕不變（`tests/sources.test.ts` 的預期值沒改）。
  - 寫回與修改只在家長按「套用」「修改」時發生，一個交易、`Ctrl+Z` 一次復原；核對不成立就不寫；CRLF、BOM、檔尾換行照舊。
  - 補 ID 與改縮排（`assign.ts`、`ids.ts`）不受 layout 影響，也不能改壞寫回的結果（`deckCases`）。
  - 舊版外掛（0.3.0）讀寫回之後的筆記，意思相同。
- **已知邊界例子**：`tests/helpers/source-edit-cases.ts`（48 個）、`tests/helpers/field-fix-cases.ts`（§1-4），以及 §3-4、§6-1 列的。這些只是起點，請找新的組合，特別是：寫回與補 ID 交錯、分行之後再換掉一段、`｜` 與半形 `|` 混著寫、連結或「標題」裡有頓號與冒號、題目底下的欄位、`本單元`、同一篇有兩個以上可以改的地方。
- **明確延後**（§8）：`B2`、`第三冊` 的猜測、接續行裡的出處的寫回、縮排錯一層的另外提示、閱讀模式與 iPhone。

## 驗證方式

- 指令：`npm run check`（型別、ESLint、knip、secretlint、文件、測試）、`npm run build`。自己跑測試加 `--test-timeout`；`NODE_OPTIONS` 只能放 `--test-reporter=dot`。
- 實作者在 `1315150` 跑過：`npm run check`（2017 個測試）、`npm run build` 通過；Windows 版 Obsidian 1.15.0 實機（任務說明〈結果〉的兩段 Windows），含寫回與 §1-4 的 `Ctrl+Z` 一次復原。
- 沒跑的：iPhone（這批只在電腦，不用測）；滑過的說明在 §1-4 的標示上沒有再請使用者用滑鼠看（和其他標示同一種 `aria-label`）。
- 需要實機的部分不用重做；判斷需要時寫成「待驗證」交回。

## 實作者自己選的做法（請先看這些）

1. **§1-4 行尾有區塊 ID 不標改名**（和任務說明不同）：改名之後 ID 會變成出處的值。
2. **§1-4「讀得懂」的判斷**：核心只看讀法（每一項沒有 `problem`、不是純文字、至少一項不是舊標題）；要看目錄與材料的原因由 `main.ts` 把這一項的字交給 `unreadableSources` 判斷。`missed` 單獨出現不算問題（和存檔按鈕一致）。
3. **§4-4 併進已有的出處**：這一項讀出的第一段是這一篇時，整串加在第一個跟著別的單元的段前面，否則加在最後；分行的一個頓號項一個子項目。併進去核對不成立時改試就地改名，再不成立才不寫。
4. **§4-4 改名的核對**：`shared`（或上一層題目的 `extras`）照原本的項目少一個；出處是原本的段中間插進一串、讀起來等於單獨讀這一項（`remark` 除外），插在哪裡不限。
5. **§4-4 半形冒號**：一次改整篇；行內程式碼裡的不算；核對是 `parseDeck` 整個結果相同。
6. **標示是停止打字 250 ms 後算的**：表單與面板打開時，點到的那一段或那一行和現在的全文對不上就寫「筆記剛改過，請再點一次」，不寫。
7. **§4-3**：換掉的接續段跨了分行的子項目時，後面那幾行整行拿掉；子項目的清單符號和那一項相同，數字清單用 `-`；表單停止打字 150 ms 才核對，核對不成立每次打開表單只記一次錯誤紀錄。
8. **§1-3**：存檔按鈕的「看不懂的出處」改成數段（`老師說過 p.44 和 1-3 p.45` 從 2 變 1、`老師說過 p.44、老師說過 p.44` 從 1 變 2）。
9. **速度**：Obsidian 裡 300 個目標的重新解析，第 1～5 個 commit 時中位數 12.5 ms，`1315150` 時 25.5～28.7 ms；拆開量是解析本身 26 ms、§1-4 0.3 ms。若你量得到差別的原因，請一起回報。

## 回報與權限

- 只審查，不改產品程式。每項發現寫：觸發條件（最小的筆記內容）、預期與實際、影響、位置（檔案:行）與證據，並區分「已重現」「靜態推斷」「待驗證」；另標**真實路徑會不會發生**：家長手寫、AI 製卡的輸出、舊版外掛寫過的筆記，會不會產生這個輸入。
- 可以回報「規格本身有漏洞」。
- 回報寫在 `Claude Codex Discussion/2026-11-07-edit-markup-l2.md`，標題下第一行寫狀態。
