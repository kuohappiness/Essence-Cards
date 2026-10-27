# W5 第二部分：L2 獨立審查（給 Codex）

狀態：已結案：三輪審查通過，W5 第二部分已合併（`4a7d522`）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（編輯器鎖定的交易處理、弄丟偵測的證據規則要自己找反例；需要時可切到 xhigh）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)，[W5 任務說明 §8](w5.md#8-第二部分補-id-與-id-的保護)（補 ID 與 ID 的保護，[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)、[D-135](../docs/decisions.md#d-135-清單解析和-obsidian-對照後的處理) 的縮排改正）由 Claude 實作。這一批改卡組模組、寫回家長的筆記、在編輯器裡攔截修改，屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-w5-ids`，分支 `claude/w5-ids`，沒有未提交的修改。
- 基準：`434a98f`（`main`，第一部分合併之後）。之後 `main` 只多了 W6 的任務說明與文件（`a2136ac`～`79dfe14`），沒有改到 §8 的規格（`docs/syntax.md`、`docs/decisions.md`、`tasks/w5.md`）。
- 待審 commit（由舊到新）：
  - `7a156f762e730b262572061ab9097b59a4fddfa4`：§8-4 解析的「認得」、`assignIds` 的歸位與縮排改正、`skip`、`setTargetId`、`blockIds`
  - `3751696a6075c35781a99ea8f14d8488f41b4082`：§8-5 `state` 的補 ID、弄丟的偵測與待處理（`src/state/ids.ts`）
  - `bc0fc75b5da44f54f3a7ccd256974a3cbcd15dac`：§8-6 編輯器的鎖定（`src/obsidian/lock.ts`）、存檔按鈕與小視窗、離開筆記的備援（`src/obsidian/save.ts`）、建置與邊界、開發命令 `lock`、`save`
  - `2dc0d2746cad3f7ff2db8ef819bb2cf608c3b446`：在 Windows 版 Obsidian 跑開發命令時找到的修正（Undo／Redo 的回報、`restoredInEditor`）
  - 這份審查請求的 commit（只有文件）
- 用 `git diff 434a98f claude/w5-ids` 看全部差異（35 個檔案）。各 commit 的訊息寫了那一步的做法。

## 規格與優先順序

- 主要規格：[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護) 全文（有出入以它為準）、[tasks/w5.md](w5.md) §8-0～§8-8，以及 §8-1 的必讀範圍（討論稿的兩次 Codex 回應、D-034、D-079、D-089 第 9 條、D-126 第 3 點、syntax.md §2-3）。第一部分的限制照舊。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。下面「自己選了做法的地方」第 1、6、13 點是 Claude 認為規格本身有出入、照理由選了一邊的地方。

## 請特別看（§8-8）

1. **沒有任何依內容猜身分的路徑**：名稱與題目指紋只用在兩件事——在改動之間認出同一個待處理的目標，以及判斷沒有 ID 的目標是不是上一版就在（`src/state/ids.ts` 的 `match`、`observe` 裡的 `pool`）。`restore` 只來自「上一版有、這一版不見的 ID」或 ambiguous 的候選。請確認沒有一條路會把舊 ID 配給內容相似的目標。
2. **待處理的目標不會被靜默配新 ID，也不會因為重讀或改字而消失**：`fillText`／`fillIds` 用 `skip`；`planToday` 的輸入拿掉待處理的目標；存檔時先把編輯器的文字當成新版本比對（`tracker.fill` → `observe`），所以「重讀還沒跑完就按存檔」也不會補。待處理只在家長選了、那個目標被刪掉、或這次載入結束時消失。
3. **寫回都用最新的文字**：開著的筆記是 `fillText(editor.getValue())` 之後用 `editor.transaction` 套最小差異（`src/obsidian/diff.ts`）；沒開的是 `files.modify` 的回呼裡呼叫 `fillText`。`state` 沒有先用舊行號算好再套。
4. **鎖定的每一種編輯**（§8-6、I7）：`src/obsidian/lock.ts` 的 `repair`、`park`、`report`。
5. **iPhone 沒有寫卡組的路徑**：`fillIds: Platform.isDesktopApp`；`fillText`、`fillIds`、`resolveText` 在 `fillIds: false` 時一律回傳原文／false／null；鎖定、存檔按鈕、命令、離開筆記的備援只在 `Platform.isDesktopApp` 時註冊（`src/main.ts` 的 `wireIds`）。

## Claude 自己選了做法的地方（請逐點回覆）

§8-4 認得、歸位與縮排改正：

1. **I1 的 `- 能說明擴散 ^k3m9x2abc`**：表格寫「不認得：id 是 null」，但它在行尾，照「家長自己寫在行尾的合法區塊 ID 照舊」（D-134、§8-4）就是自訂 ID `k3m9x2abc`；要變成 null 就得另訂一條區分 `k3m9x2abc` 與 `mine-1` 的規則。Claude 的做法：行尾照舊（`k3m9x2abc`，不截成前六碼），放在行中（`^k3m9x2abc 的現象`）才是「不認得」。這個情況在 Obsidian 以外發生時，§8-5 會把它當成「換成沒見過的 ID」（`changed`，`restore` 是原本的）。兩種都寫成測試。
2. **候選也認行首**（`- ^k3m9x2 能說明擴散`）；行中與行尾是**同一個** ID 時算 `misplaced-id`（不是衝突），歸位時拿掉行中那個。名稱是空的 `- ^aaaaaa` 也照這條認得（名稱空字串），但編輯器不鎖它（游標停在 ID 前面會打進清單符號）。
3. **連結裡的字不算候選**：遮掉 `[[…]]` 與 `[…](…)`，和行內程式碼、公式一樣。
4. **衝突的候選**放在 `Target.idCandidates`，**只有 ambiguous-id 的目標才有這個欄位**（不是空陣列），既有測試的深比較不受影響。另匯出 `blockIds(text)`（每一行行尾的區塊 ID），`state` 用它判斷「ID 還在筆記裡」。
5. **補 implicit 目標的名稱時拿掉像 ID 的字**（`- borrow ^k3m9x2 x :: 借入` 補成 `- borrow x ^aaaaaa`），不然補上的名稱那一行會變成 ambiguous-id。
6. **縮排改正的欄位**：有正常縮排（多不到 4 欄）的兄弟項目時對齊它（不然後面的題目會變成改過那一項的子項目）；沒有時，空格縮排對齊目標的內容欄，Tab 縮排對到下一個 Tab 位置（`\t`）。改完任何目標的解析結果（`JSON.stringify(targets)`）不同就整個不改。ambiguous-id 與 `skip` 的目標不改縮排。

§8-5 弄丟、改掉與待處理：

7. **「還在筆記裡的 ID」**是整篇每一行行尾的區塊 ID 加上目標行中被認得的與候選（不只看目標）：目標暫時沒有題目、ID 還在文字裡時不算不見（Codex 討論稿第 5 題）。
8. **上一版就在、沒有 ID 的目標**：和上一版沒有 ID 的目標一對一配，先比名稱、再比至少一題指紋相同；配不到才算新出現。
9. **在改動之間認出同一個待處理的目標**：同樣的未知 ID（changed）＞同樣的候選（ambiguous）＞同名＞至少一題相同，平手取行號最近；目標有一個已知的 ID 時不配。**認不出來的待處理問題當成證據**：同一次重讀裡又有新出現的目標，就把它們變成待處理（剛好各一個時 `restore` 沿用）。這是為了「家長在兩次存檔之間把名稱和唯一一題都改了」時，那個目標不會掉出待處理、被靜默配新 ID；代價是同時新寫的目標也要家長選。
10. **ambiguous-id 一律待處理，包括重新載入後**（I5 表格最後一列寫「沒有問題，照一般規則」）：一般規則對 ambiguous-id 是不出題、不補，而編輯器又鎖住 ID，家長沒有別的方法解開；所以重新載入讀到 ambiguous-id 時仍列成待處理，只是 `restore` 是 null（只能「當成新的」）。lost／changed 在重新載入後照規格沒有問題。
11. **`taken`** 是這次載入在任何卡組看過的 ID、原始紀錄每一行的 `lt`（含取消的，用 regex 掃原文、照來源快取）、刻意拿掉的 ID 與待處理問題的 `restore`：比規格的三項多，不會變少。
12. **implicit 的目標成為待處理時 `restore` 一律 null**（`setTargetId` 對 implicit 那一行回傳 null，只能當成新的）。
13. **`State.restoredInEditor(path, ids)`**（規格的介面沒有）：Windows 版 Obsidian 實測發現，存檔補 ID 之後按 Undo，鎖定回報「拿掉」；Redo 讓 ID 回來，`state` 卻還記得它是刻意拿掉的，之後在 Obsidian 以外弄丟就漏報。所以鎖定在 Redo、貼回剪下的目標時回報「回來了」，`state` 取消刻意拿掉的標記。另外，原本 Claude 多做的「這次載入才配的 ID 被拿掉不算弄丟」已拿掉：這類 ID 在外部弄丟照常偵測，按 Undo 的情形靠編輯器回報。
14. **存檔時 `state` 立刻採用寫回後的文字**（更新卡組、重排、呼叫 `onChange`），不等檔案通知；之後通知到的同一份文字不再比對。
15. **改名**：同一批通知裡消失的卡組與第一次出現的卡組配對（內容相同優先，再來是檔名相同），上一版與待處理問題搬到新路徑，再照一般的重讀比對。
16. **`fillIds` 不建立檔案**：在 `files.modify` 的回呼裡讀到空字串（不存在或空檔）就丟出內部錯誤中止，Node 版與 Obsidian 版都在呼叫回呼之後才建資料夾與檔案。

§8-6 接線與鎖定：

17. **游標不停在 ID 後面**（`park`）：游標落在行尾（End、點行尾、方向鍵）時移到 ID 前面（名稱最後），所以打字、中文組字、Backspace 自然發生在 ID 前面；有選取範圍時不動。
18. **交易調整的規則**（`repair`，只處理標記為輸入、刪除、移動的交易）：
    - ID 讓它走：跨行的刪除整段蓋過它；同一行被換成另一個帶 ID 的目標行；連同清單符號整行清空。這些情形不補回（「不要事後補回使用者已刪掉的整個目標」），並回報 `removedInEditor`。
    - 其他情況 ID 留在名稱那一行的最後：打進 ID 裡或後面的字移到前面；刪到 ID 或它前面空白的字不刪；**ID 原樣還在某個有名稱的目標行最後時留在那裡**（名稱中間按 Enter，ID 跟著有題目的後半段；貼回剪下的一段時回到原位），否則回到原本名稱所在的那一行（名稱最後按 Enter）。
    - 同一行剩兩個 ID：留下行尾那個（它的目標仍有內容）；貼進名稱中間的程式格式 ID 拿掉。
    - **選取從清單符號之前開始、打進新的字**（不是刪掉）：ID 保留在那一行行尾，結果是「新的字 ^id」，那一行已經不是清單項目。
19. **Undo／Redo 不調整、只回報**；沒有使用者標記的交易（外部改檔後 Obsidian 重新載入、其他外掛、`editor.transaction`）不碰也不回報。CodeMirror 的 history 交易帶 `filter: false`，所以回報放在 `transactionExtender`（filter 改過的交易 CodeMirror 會套兩次 extender，用 WeakSet 去重）。
20. **哪幾行鎖**：屬性區與最上層圍欄以外、最上層的清單項目、名稱之後有行尾區塊 ID 的行（沒有題目的一般清單也鎖，ID 本來就不該被打字改掉）；縮排之後變成子項目的行不再鎖，但 ID 仍在它自己那一行。一般輸入只重掃改到的行，改到 ```、~~~、--- 的行或屬性區裡面才整篇重掃；和 `parseDeck` 的對照與「隨機編輯 300 次後和整篇重掃相同」寫成測試。
21. **離開筆記的備援**：`layout-change`、`file-open` 時算出所有 Markdown 分頁開著的檔；上一次開著、這一次沒有的卡組，**等 1 秒**（讓編輯器先把最後打的字存進檔案）再確認仍沒開著才 `fillIds`；第一次事件只記下開著哪些。
22. **按鈕**：圖示 `check-circle`（淡）、`save`（醒目）、`alert-triangle`（警示），說明放在 `aria-label`（Obsidian 的滑鼠提示）；Notice 的 N 是補之前與補之後 `missing` 的差。小視窗選了之後重畫，問題都處理完就關；`resolveText` 回傳 null 時提示「這篇筆記剛剛改過，請再按一次存檔」並關掉小視窗。
23. **開發命令**：`lock` 在 `Essence W5/暫存/` 的副本上跑（開發版的鎖定另外涵蓋這個資料夾，正式版只有卡組）；鍵盤（Enter、Backspace、Delete、Home、End、Tab）用 `keydown` 事件走 Obsidian 真的按鍵處理，貼上、剪下、複製、拖放用真的剪貼簿與拖放事件，打字與中文組字用 CodeMirror 的輸入交易（**不是真的輸入法**，見「沒驗的」）。`save` 用 `vault.adapter.write` 直接寫檔，模擬在 Obsidian 以外改檔（和從命令列寫檔一樣不經過 vault 的 API）。
24. **建置**：`@codemirror/state`、`@codemirror/view` 照 Obsidian 的 peer 版本固定成開發相依，和 `obsidian` 一樣 external；`tools/build.mjs` 在打包進任何 `node_modules/@codemirror/` 時失敗。ESLint 把 `@codemirror` 加進核心、`src/state/`、`src/dev/` 的禁止清單。`obsidian.d.ts` 引用的是 CommonJS 版的 CodeMirror 型別，`main.ts` 對 `editorInfoField` 做了一次型別轉換（同一個執行期物件）。

## 行為與風險

- 公開介面：`src/core/deck/index.ts` 加 `setTargetId`、`blockIds`，`ProblemCode` 加 `misplaced-id`、`ambiguous-id`，`Target.idCandidates?`，`AssignOptions.skip`；`src/state/index.ts` 的 `StateOptions.fillIds`（必填）、`random`，`State` 加 `deckStatus`、`fillText`、`fillIds`、`resolveText`、`removedInEditor`、`restoredInEditor`，型別 `IdIssue`、`IdIssueKind`；`src/obsidian/lock.ts` 的 `idLock`；`src/obsidian/save.ts` 的 `wireSave`。
- 不可破壞的性質：
  - 補 ID、歸位、縮排改正之後，每個目標的題目內容、指紋與 ID 對應都和之前相同（`deckCases` 的往返驗證另外比「原本就有的 ID 不變」），第二次不改任何字。
  - 待處理的目標不出題、不被補、不被移動；選之前不會消失（除非目標被刪掉或重新載入）。
  - 配新 ID 不會用到別篇的 ID、原始紀錄裡出現過的任何 `lt`（含取消的）、待處理問題的 `restore`。
  - 編輯器裡的一般編輯不會讓 ID 離開它的目標行、不會讓一行有兩個 ID、不會留下孤立的 ID；Undo／Redo 照常。
  - 外部改檔（Obsidian 重新載入編輯器）不被鎖定改寫；這類弄丟交給 §8-5。
  - iPhone 不寫卡組筆記、不裝鎖定。
- 測試：`tests/deck.test.ts`（I1、I2，新例子都進 `deckCases`）、`tests/state-ids.test.ts`（I3～I6，加 Undo／Redo、改名、剛配的 ID 在外部弄丟）、`tests/lock.test.ts`（I7 的 Node 部分，用 Obsidian 同一版的 `@codemirror/state`）、`tests/diff.test.ts`、`tests/build.test.ts` 與 `tests/main-wiring.test.ts`（I9、只在電腦裝上）、`tests/quality.test.ts`（I10）。
- 請自己找新的組合，例如：
  - 弄丟偵測：兩篇卡組在同一批通知裡互相搬目標；外部同時把 A 的 ID 拿掉、把 B 的 ID 改成 A 的；待處理期間另一台電腦（同一篇）同步進來；ID 只出現在被取消的作答裡；同一篇裡兩個同名、沒有 ID 的目標。
  - 認得：候選在 `~~~` 圍欄、`$$` 公式、HTML 標籤、註腳裡；名稱寫成兩行（D-135）且候選在第二行；全形空白當分隔。
  - 縮排改正：目標底下混用 Tab 與空格；第一層有多一層的資料欄位（`出處：`）；多一層的題目底下有圍欄；改正後和下一個目標之間只隔一行。
  - 鎖定：多個游標同時打字；Vim 模式；同一行兩個 ID 的文字被貼進來；選取從題目行跨到下一個目標名稱的中間再貼上；拖放整個目標到另一個目標的名稱中間；在 ID 前面插入表情符號（代理對）。
  - 存檔與備援：存檔後馬上關分頁（`fillIds` 與編輯器存檔的先後）；同一篇開在兩個視窗（不是分頁）；改名正在開著的卡組。

## 驗證方式

- Node 24 以上。在 worktree 裡：`npm install`、`npm run check`、`npm run build`。
- Claude 跑過：
  - `npm run check` 全部通過（329 個測試，第一部分合併時 260 個）。
  - `npm run build`：`main.js` 164,234 bytes（第一部分 141,936），require 只有 `@codemirror/state`、`@codemirror/view`、`obsidian`；metafile 沒有 `node_modules/@codemirror/`（`tests/build.test.ts`）。
  - I10：`tests/quality.test.ts` 用 ESLint 確認 `src/core/`（import、`import type`、動態 import）、`src/state/`、`src/dev/` 載入 `@codemirror/*` 都會被擋，`src/obsidian/lock.ts` 可以；第一部分 T14 的檢查照舊在同一個測試檔。
- Windows 版 Obsidian 1.14（開發版，結果檔在測試 vault 的 `Essence W5/結果/`；測試 vault 的位置不寫進 repo，要看時問使用者）：
  - `lock`：Live Preview 與 Source mode 各 24 項，48／48（`lock Windows-c50c 2026-10-25 021554.json`；每一項寫了操作後的文字）。過程中找到兩件事已修（`2dc0d27`）：CodeMirror 的 history 交易不經過 transactionFilter，以及 Redo 之後的標記。
  - `save`：三種樣子的說明文字、不是卡組的筆記沒有按鈕、按存檔補 2 個與 Notice「2 個學習目標已加入複習」、選取不變、Undo 一次復原、外部拿掉一個 ID 後按鈕變警示、小視窗的文字與兩個按鈕、選「還原」後 ID 回來且小視窗關掉、離開筆記的三個時間點（只有兩個分頁都關掉之後才補）——11／11（`save Windows-c50c 2026-10-25 021625.json`，含前後的文字與時間點紀錄）。
  - `compare`（212 個例子，`compare Windows-c50c 2026-10-25 021155.json`）：M1 補 ID 後是 `- 目標 ^id` ／ `  - Q :: A`，metadataCache 的 parent 是目標那一行、閱讀模式是第 1 層。60 個不一致：第一部分已接受的 40 個（D-135）不變或減少；新的都是預期的——行中的 ID 在存檔前 Obsidian 不認（before:d，D-134 存檔時歸位）、ambiguous-id 不自動處理（after:e）、縮排多一層在存檔前（before，D-135；這些例子補 ID 後都一致）。唯一意外的是 D180（`[說明 ^p7q2w8](筆記.md)` 連結文字裡像 ID 的字）：metadataCache 在補 ID 前後都把 `p7q2w8` 當成那一行的區塊 ID，閱讀模式則照常隱藏行尾的 ID；照 D-135 以閱讀模式為準，解析器不跟。
  - 第一部分的命令照常：`files` 14／14、`today`、`answer`（讀回相同、取消後今天的份不變）（`files … 021631`、`today … 021633`、`answer … 021639`）。
- 沒驗的：
  - **真的中文輸入法**：AI 送不出經過輸入法的按鍵；`lock` 只模擬組字事件與 CodeMirror 組字時的交易。因為游標不停在 ID 後面，組字一定發生在 ID 前面，風險在「組字中途的交易被調整」——`repair` 只在字進到 ID 裡或後面時才動，組字時不會。
  - **iPhone**：照 §8-7 I8，W6 的 iPhone 測試結束後 Claude 在電腦上確認那段期間卡組沒被改過。
  - 兩台電腦離線改同一篇（D-134 的既有代價）。

## 回報

寫在主資料夾的 `Claude Codex Discussion/2026-10-25-w5-ids-review.md`（不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 「請特別看」的 5 點逐點寫結論；「Claude 自己選了做法的地方」的 24 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。

## 修正後的再審（2026-10-26）

第一次審查的結果在[報告](<../Claude Codex Discussion/2026-10-25-w5-ids-review.md>)（另：第一次請求寫的「35 個檔案」是錯的，正確是 31 個，謝謝指出）。Claude 已核對：F1、F2、F3、F5 都先照報告的例子寫成會失敗的測試、確認重現後才修；F4 的測試在修正前失敗、修正後通過（暫時換回舊的 `dev.ts` 確認過）。修正在同一個分支：

- 待審 commit：`8a42bfe8b8f0619f35f184a42c958883d4f4f6cd`（F1～F6 與審查回覆裡的建議）、`24b0e8dfb849eb8c040797f2c6eab66482a907bd`（Obsidian 實測找到的備援漏洞）。只看這一段：`git diff 4d1a612 24b0e8d`（13 個檔案）。
- 規格與做法的對齊寫在 [W5 說明 §8-9](w5.md#8-9-實作與-l2-審查後的修正2026-10-25)（15 點）；`docs/agents/quality.md` 的建置白名單已改。這些都是照 D-134、D-135 的原文對齊驗收條件，沒有新的決定。
- 和你的建議不同或多做的地方：
  - **F1**：「內容改過」定義成待處理目標的名稱、題目指紋（多重集合）或候選改了；只有行號變（上面多一行）仍沿用同一個問題物件。小視窗訂閱 `onChange` 重畫，所以家長看到的永遠是現在的問題；舊物件拿去 `resolveText` 回傳 null、問題保留。
  - **F3**：壞掉的行用寬鬆的 `"lt"\s*:\s*"…"` 再找一次（多避開不會錯配），救回的尾段也涵蓋。
  - **F4**：只擋會寫卡組的 `lock`、`save`；`files`、`open`、`today`、`answer`、`watch` 仍給 W6 的 iPhone 測試用（它們只寫 `Essence W5/` 與紀錄）。
  - **第 14 點**：`fillIds` 在 `modify` 成功後才採用寫回的文字；寫不進去那一次配出的 ID 仍算用過（之後配下一個）。
  - **第 21 點**：Windows 實測「打完字馬上關分頁」時發現，開到背景分頁的卡組 Obsidian 不發 `file-open`，關掉時備援不會補；改成在編輯器裡改過字、或更新按鈕時看到的卡組也記成開著（`24b0e8d`）。
  - **第 22 點**：提示的數量是這次存檔前後的文字裡「有 ID 的目標數」的差。
- Claude 跑過：`npm run check` 346 個測試全部通過（第一次 329）；`npm run build` 只 require 三個允許的套件。
- Windows 版 Obsidian（開發版，`24b0e8d` 的建置；結果檔在測試 vault 的 `Essence W5/結果/`）：
  - `lock`：50／50（`lock Windows-c50c 2026-10-26 002851.json`），多了「貼上程式碼、公式、連結」與「Undo 掉存檔補上的 ID」兩項，Live Preview 與 Source mode 各一次；檢查函式改用解析同一個辨識。
  - `save`：16／16（`save Windows-c50c 2026-10-26 002651.json`），新加的五個情境：小視窗開著時題目在外部被改（舊按鈕消失、新的還原照常）、打完字馬上按存檔（提示「3 個學習目標已加入複習」）、打完字馬上關分頁（3 個都補上、沒有誤報）、改名開著的卡組（舊路徑不補、新路徑開著不補、關掉後補）、開在另一個視窗（兩邊都關掉才補）。結果裡有每一次備援的時間點與檔案的 ID 數。
  - `compare`：`compare Windows-c50c 2026-10-25 233618.json`，D180 補 ID 後的閱讀模式是 `0:連到 筆記 ^k3m9x2 與 說明`／`1:Q :: A`（行尾的 ID 有隱藏）。
  - 測試期間碰到一次 iCloud 的狀況：`save` 舊版本「刪掉再建同名檔」時，Obsidian 一直開著那個已刪除的檔，Windows 留下一個讀不到的項目，外掛載入一直重試，直到 Obsidian 關掉才放開。`save` 已改成每個情境建自己的新檔、結束時整個資料夾刪掉。這件事也暴露第一部分的一個風險：**任何一篇卡組讀不到，`ready()` 就整個重試，所有卡組都不能用**（照第一部分的設計）。Claude 建議記進技術債、在 W6 的 iPhone 測試前處理（讀不到的那篇先跳過、自己重試），不在這一批改；請一併評估。

請查：

1. 這段差異和 §8-9 的 15 點是否一致，有沒有改到別的行為；特別是 `observe` 改成整批（`load` 與 `apply` 都經過它）、`fill` 拆成 `prepare`／`commit` 之後 `fillText` 與 `fillIds` 的差別、問題物件換新的條件。
2. 你第一次的反例（F1 的「題目改成 totally new」、F2 的三種貼上、F3 的空白、F5 的兩種通知順序）在 `24b0e8d` 是否都過。
3. 相鄰的新組合，例如：
   - F1：小視窗開著時只改目標的行號、只改另一個目標；兩個待處理問題、其中一個改過；ambiguous 的候選被換掉其中一個。
   - F5：同一批裡一篇被刪、另一篇多了那個 ID；三篇之間輪換；同一批裡同一篇收到兩次通知。
   - F3：紀錄行的 `lt` 不是字串；一行裡有兩個 `"lt"` 鍵（JSON 取最後一個、寬鬆比對兩個都避開）。
   - 寫不進去：`fillIds` 的 `modify` 失敗之後馬上又收到同一篇的檔案通知。
   - 備援：背景分頁只開不改就關掉（現在不會補，要等下一次存檔或打開再關）。

回報接在第一次報告的最後，標題「再審（2026-10-26）」，格式同第一次；沒有問題就寫「可以合併」。只審查、只回報。

## 第三次審查（2026-10-26）

再審的結果在[報告](<../Claude Codex Discussion/2026-10-25-w5-ids-review.md>)〈再審（2026-10-26）〉。Claude 已核對：R1、R2 都先寫成會失敗的測試、確認重現後才修；R3 先用 `wireSave` 配分頁與事件的替身寫成會失敗的測試，修好後另在 Windows 版 Obsidian 驗。核對時另外發現：上一輪 F3「跳脫鍵名」的測試字串被 TypeScript 當成跳脫字元，實際測的是一般的 `"lt"`；已改成真的 `\u006ct`（你的獨立驗證當時是對的）。

- 待審 commit：`c6a6c8a`（完整 SHA 見 `git log`），只看這一段：`git diff 24b0e8d c6a6c8a`。
- 對齊寫在 [W5 說明 §8-9](w5.md#8-9-實作與-l2-審查後的修正2026-10-25) 的第 16～18 點；R3 照 D-134 原文修（背景分頁只開不改也補），沒有把它寫成例外。
- 做法：
  - **R1**：壞行另外把每一段 `{"t":` 開頭的尾段照 JSON 讀；寬鬆比對保留。你提的「合法 JSON 重複鍵只取最後一個」照你的說明理解，不宣稱兩個都避開。
  - **R2**：`apply` 先把同一批讀到的紀錄放進來源，再比對卡組；讀不到的照舊留著重試，最後統一重排一次。
  - **R3**：兩層記下「這篇開著」：編輯器一建立（`main.ts` 的 `ViewPlugin` 呼叫 `opened`），以及每 2 秒看一次所有分頁（含還沒載入的 `viewState`）。都只是記下開著；補 ID 仍只在「上一次開著、這一次沒有」時，啟動的第一個事件之前不記。新的 `tests/save-wiring.test.ts` 用替身跑 `wireSave`：編輯器建立後關掉補一次、還沒載入的分頁靠定時補記後關掉補一次、啟動與切換焦點不補。
- 你建議的 `ready()` 技術債已記在 `main` 的 backlog〈技術債〉，觸發點是 W6 的 iPhone 測試前；完成條件加進你提的「不能把尚不知道是否占用當成確定沒占用」。
- Claude 跑過：`npm run check` 352 個測試全部通過。
- Windows 版 Obsidian（`c6a6c8a` 的開發版建置）：`lock` 50／50（`lock Windows-c50c 2026-10-26 011317.json`）；`save` 17／17（`save Windows-c50c 2026-10-26 011117.json`），多了「開到背景分頁、什麼都不改就關掉」（`openOnly`：2 個 ID 都補上）。

請查：

1. R1～R3 的修正是否成立、有沒有改到別的行為；特別是 R2 之後讀紀錄失敗與卡組成功混在同一批時的處理，以及 R3 的定時補記會不會在啟動、同步讀入或只切換焦點時誤補。
2. 你上一輪的 R1、R2 重現與 R3 的替身流程在 `c6a6c8a` 是否都過。
3. 相鄰的組合，例如：同一批裡紀錄讀不到、卡組換成那份紀錄裡的 ID；同一行壞紀錄有兩段 `{"t":` 尾段；背景分頁開了又在 2 秒內切到前景再關；Obsidian 重新載入外掛時已經開著的背景分頁。

回報接在報告最後，標題「第三次審查（2026-10-26）」，格式同前；沒有問題就寫「可以合併」。只審查、只回報。

## T1 修正的確認（2026-10-26）

第三次審查的 T1（重新啟用外掛後，第一個事件就是關掉原本開著的卡組時漏補）已修：`885dbc2`，只看 `git diff 46c6f38 885dbc2`（`src/obsidian/save.ts`、`src/main.ts` 與測試、開發命令）。

- 做法照你的建議：`wireSave` 多一個 `start()`，在 layout ready 時（`main.ts` 建立 state 的地方，layout 已經 ready、外掛才重新啟用也一樣）記下目前開著的檔，只記錄、不補。§8-9 第 18 點那句「啟動的第一個事件之前不記」改寫成第 19 點。
- 測試先寫、確認失敗才修：`tests/save-wiring.test.ts`（已載入與只有 viewState 的分頁各一次：啟用時零寫入、第一個事件就是關掉時補一次）；`tests/main-wiring.test.ts`（實際建置的 `main.ts`，layout 已經 ready：`onload → state.ready → 關分頁`，啟用時零寫入、關掉後一次 `process`、檔案有 ID）。同步重讀與切換焦點零寫入的舊斷言保留。
- Windows 版 Obsidian 實機（開發命令 `t1prep` 建一篇沒有 ID 的卡組開在背景分頁、不改字 → URI `reload` 重新啟用外掛 → `t1close` 直接關掉那個分頁）：
  - 對照組（暫時拿掉 `start()` 的建置）：0 個 ID、沒有任何備援事件（`t1close Windows-c50c 2026-10-26 015244.json`）。
  - 修正後：2 個 ID，備援事件「離開 → 補 → true」（`t1close Windows-c50c 2026-10-26 015332.json`）。
- 最終版本另跑：`npm run check` 354 個測試全部通過；`lock` 50／50（`lock Windows-c50c 2026-10-26 015651.json`）、`save` 17／17（`save Windows-c50c 2026-10-26 015501.json`）。
- 你提的「讀紀錄失敗時新 lt 尚未知、恢復後 pending 仍保留」已同意併進 `ready()` 那一項技術債處理，這一批不改。

請確認 T1 是否成立、有沒有讓啟動、同步重讀或切換焦點誤補；沒有問題就寫「可以合併」。回報接在報告最後，標題「T1 確認（2026-10-26）」。只審查、只回報。
