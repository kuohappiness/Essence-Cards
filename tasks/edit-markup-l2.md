# 編輯畫面標示與出處小表單（Codex L2 審查請求）

狀態：已完成：五輪查核，第五輪通過（`c3684d8`）。第一輪審 `268b625`、第二輪審 `154d732`、第三輪審 `3124f09`、第四輪審 `6b4514c`，[報告與回應](<../Claude Codex Discussion/2026-11-07-edit-markup-l2.md>)。

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
  - 帶與不帶 `{ layout: true }` 的 `parseDeck` 結果只差 `layout`（§1-2 的 `Problem.columns` 兩種都有，L2 第二輪 R8 改了這一句）；`sourceLinks` 的按鈕不變（`tests/sources.test.ts` 的預期值沒改）。
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

## 第二輪（L2 第一輪的修正）

- **審查對象**：分支 `claude/edit-markup` 從 `268b625a65df5406a457e403ffbb949cdf34b629`（第一輪審過的）到這份請求所在的 commit（`git log -1 --format=%H -- tasks/edit-markup-l2.md`）。程式的修正是 `63dc729`、`7f3c370`、`27055d7`、`1be9ef7`、`14b1123`（R2、R6 走到交易的測試）；另有一個只改文件的 commit（任務說明 §3-1、§4-3 第 3 點的文字、〈結果〉、這份請求、第一輪報告與回應）。沒有未提交的修改。
- **只查這段差異與受影響的路徑**，不必整包重審（[review.md](../.claude/skills/code-quality/review.md)「修正後收尾」）。第一輪已審過、這次沒動的部分不用重看。
- **每項的修法與回歸測試**：見第一輪報告最後的〈Claude 的回應〉。請核對：
  1. 修法是不是放在那一類輸入的共用入口，同一類的其他輸入有沒有漏掉（例如 R1：被拿掉的那一行底下附著的不只引言、圍欄，還可能是一般的接續段落或表格；R2：同一行有兩段、標示的行改過但字沒變、目標的 ID 不同但名稱相同；R7：分行子項目中間加的是好幾段、子項目用逗號或空白分段）。
  2. R4 沒有照第一個例子改的理由（空一行後縮排到目標內容位置的段落算那個目標）站不站得住；如果你認為 Obsidian 畫出來的樣子不同，請寫成「待驗證」，實機由 Claude 補。
  3. R8、R9 改的是任務說明的文字：新的文字和實作、syntax、§6-1 的例子是否一致。
  4. 修正有沒有帶進新的問題：`relocateSource` 找到別的目標的同一段原文、`targetAt` 用 `layout.end` 後圖示與命令的範圍、`guessSource` 多了 `scope` 之後其他分支（寫了單元、短的學期、只有編號）的預選。
- **驗證方式**：和第一輪相同（`npm run check`、`npm run build`；自己跑測試加 `--test-timeout`）。實作者在 `14b1123` 跑過 `npm run check`（2031 個測試）、`npm run build` 通過。Windows 版 Obsidian 在 `1be9ef7` 重跑開發命令 `markup`（寫回四步與 `Ctrl+Z`，結果在任務說明〈結果〉）；平移後的標示這種情形沒有在實機做，由 `tests/source-entry.test.ts` 走到 CodeMirror 的交易。判斷需要實機的寫成「待驗證」。
- **回報**：接在分支上那一份 `Claude Codex Discussion/2026-11-07-edit-markup-l2.md`（worktree `.claude/worktrees/edit-markup` 裡的，已提交、含第一輪與回應）最後，標題「## 第二輪」，格式同第一輪；標題下的狀態行一起更新。主工作目錄那一份未追蹤的是第一輪的原稿，不要改。

## 第三輪（L2 第二輪的修正）

- **審查對象**：分支 `claude/edit-markup` 從 `154d732cf481b6ca9874730a73a5f6450f758ca8`（第二輪審過的）到這份請求所在的 commit。程式的修正是 `7694422`（R12、R13）、`c63ebef`（R11）、`d49b406`（R10）；另有一個只改文件的 commit（第二輪報告與回應、R8 的文字、〈結果〉、這份請求）。沒有未提交的修改。
- **只查這段差異與受影響的路徑**。每項的修法與回歸測試見報告最後的〈Claude 的回應（第二輪）〉。請核對：
  1. R10：`relocateSource` 現在回傳的 `follows`、`whole`、`scope` 和寫回的替換範圍是不是同一份解析；後面的位置被刪掉、多了一個、`follows` 從 `place` 變成別的時，表單與寫回是否一致。
  2. R11：`MapMode.TrackAfter` 會不會讓正常的編輯（在出處那一行行首打字、刪掉行首的清單符號再打回來、從上一行行尾刪到這一行）弄丟圖示到不合理的程度；點擊時的 `sourceFieldTarget` 是否涵蓋 `｜` 接的出處與分行的子項目那幾行的圖示（圖示只畫在欄位第一行）。
  3. R12：`removeGroups` 合併整行的範圍時，中間夾著附著內容（引言、圍欄）或不連續的行，是否仍各自正確。
  4. R13：`continued` 現在也包含子項目的接續行；用到 `continued` 的地方（`blocked`、§4-4 併進去、`fieldFixes` 的判斷）是否都符合 §4-3 第 4 點與 §8。
- **驗證方式**：和前兩輪相同。實作者在 `d49b406` 跑過 `npm run check`（2040 個測試）、`npm run build` 通過；Windows 版 Obsidian 在 `d49b406` 重跑開發命令 `markup`（寫回四步與 `Ctrl+Z`）。標示或圖示平移後點擊的情形沒有在實機做，由 `tests/source-entry.test.ts`（真的 `EditorView`）與 `tests/markup.test.ts` 測。
- **回報**：接在分支上那一份 `Claude Codex Discussion/2026-11-07-edit-markup-l2.md` 最後，標題「## 第三輪」；標題下的狀態行一起更新。

## 第四輪（L2 第三輪的修正）

- **審查對象**：分支 `claude/edit-markup` 從 `3124f09d779b31ebacf9213b7a82f152a3903f94`（第三輪審過的）到這份請求所在的 commit。程式的修正是 `1b24be4`（R15）、`ecf8a6a`（R14）；另有一個只改文件的 commit。沒有未提交的修改。
- **只查這段差異與受影響的路徑**。修法與回歸測試見報告最後的〈Claude 的回應（第三輪）〉。請核對：
  1. R14：`relocateSource` 換掉 `problem` 之後，其他讀法的變化（例如位置前面多了一句話、範圍寫反）是否也照現在的讀法猜；`problem` 從有變沒有時表單是否合理。
  2. R15：`removeLines` 往前拿空行時，會不會拿到不該拿的（空行前面是別的目標、標題、屬性區），以及檔尾有換行時完全不受影響。
- **驗證方式**：和前幾輪相同。實作者在 `ecf8a6a` 跑過 `npm run check`（2046 個測試）、`npm run build` 通過。
- **回報**：接在分支上那一份 `Claude Codex Discussion/2026-11-07-edit-markup-l2.md` 最後，標題「## 第四輪」；標題下的狀態行一起更新。這是第四輪：還有擋合併的發現時，照 review.md 交給使用者決定，請在報告裡分別寫出各項的真實路徑判斷。

## 第五輪（L2 第四輪的修正，使用者 2026-11-08 決定加開）

- **審查對象**：分支 `claude/edit-markup` 從 `6b4514c98f7a75d9f2554eafcfe4abd3ba40f352`（第四輪審過的）到這份請求所在的 commit。程式的修正是 `8511599`（R16）、`765349e`（R17）、`9a7997f`（R18）；另有一個只改文件的 commit（第四輪報告與回應、§4-1 多一列、〈結果〉、這份請求）。沒有未提交的修改。
- **只查這段差異與受影響的路徑**，不重審已經核對過的部分。修法與回歸測試見報告最後的〈Claude 的回應（第四輪）〉。請核對：
  1. R16：`scope` 是 null、有位置時不預選；`scope` 是 null、沒有位置（`teach`）時照 §4-1「猜不出來的」那一列仍是「這一篇」，是否合理；家長選「這一篇」時寫 `本單元`；`guessSource` 的 `scope` 預設改成 `'this'` 之後，有沒有呼叫端原本靠 null。
  2. R17：`relocateSource` 現在在現在的全文重算的 hits 裡找，R2、R6、R10、R14 的原例是否仍成立；材料快取還沒好（null）時標示消失，點舊標示會說「筆記剛改過」，是否可以接受；`main.ts` 的 `unreadableIn` 和標示是不是同一個判斷。
  3. R18：`mergeRenamed` 先刪再併：那一項在欄位前面或後面、檔尾有沒有換行、CRLF、併進去要分行；`verifyRename` 仍然拿原本的全文核對；`changes` 是一個範圍，`Ctrl+Z` 一次復原。
- **驗證方式**：和前幾輪相同。實作者在 `9a7997f` 跑過全部檢查（2053 個測試）與 `npm run build`。Windows 版 Obsidian 在 `4408380` 重跑開發命令 `markup` 三次，寫回各步與 `Ctrl+Z` 通過（數字見任務說明〈結果〉）；標示平移後點擊與 R16～R18 的特定寫法沒有在實機做，由 `tests/source-entry.test.ts`（真的 `EditorView`）與 `tests/field-fix.test.ts` 測。
- **回報**：接在分支上那一份 `Claude Codex Discussion/2026-11-07-edit-markup-l2.md` 最後，標題「## 第五輪」；標題下的狀態行一起更新。這一輪之後是否合併由使用者決定，請分別寫出各項的真實路徑判斷。

## 結果

延後的測試：無

五輪查核的發現與回應都在[報告](<../Claude Codex Discussion/2026-11-07-edit-markup-l2.md>)。
