# W5 第二部分：L2 獨立審查（給 Codex）

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
