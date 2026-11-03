# 入口與目錄第一批：L2 審查請求（給新開的 Codex session）

狀態：第五輪待審：第四輪發現的修正（[D-167](../docs/decisions.md#d-167-出處的讀法不用猜的直接讀懂要猜的讓家長選)，下面第一節）；前兩輪的[報告與回應](<../Claude Codex Discussion/2026-11-02-entry-and-catalog-review.md>)。只審查，不改產品程式。

## 再審（第五輪）：第四輪發現的修正

只審第四輪報告的修正與相鄰案例，不必整包重審。基準 `14c4816`（第四輪審完的版本），待審分支 `claude/entry-and-catalog` 的最新 commit。逐項的處理與 commit 在[討論稿的〈Claude 回應 Codex 第四輪〉](<../Claude Codex Discussion/2026-11-02-entry-and-catalog-review.md#claude-回應-codex-第四輪2026-11-03>)。

**請特別查**：

- **歸屬**：這輪的修正有沒有帶進新的默默多算或默默漏算。`namesOther`、網址的 `hidden`、去重時合併診斷、零寬字元提早拿掉。
- **`rawCutter`** 切出來的原文對不對；超過 `RAW_CUT_LIMIT` 時退回的文字。
- **§9-1 的三個軸**：夠不夠第二批用。

**實作者的取捨（不同意請說）**：`https://x.test,國二上 1-8` 可能真的是兩項，現在不算 1-8、有提示；Markdown 路徑的括號只認到兩層。

**使用者已決定、不用再提**：`10-15` 維持沿用、`2之1` 算同一個單元、全形括號裡的字不動。除非有比已寫明的代價更嚴重的後果，再具體說。

**嚴重度**：只把真實家長可能寫出、而且會默默算錯或擋住使用的字串列成 P1；要刻意構造才會發生的，請標明「刻意構造」，放在最後，由使用者決定要不要修。

**驗證方式**：`npm run check`；`node experiments/source-reading/product-check.mjs "$(pwd)"`（不是盲測，只當回歸）。Windows 版 Obsidian 的結果寫在[任務說明〈結果〉](entry-and-catalog.md#結果)。沒跑 iPhone。

回報照下面〈回報〉的格式，貼回對話或接在討論稿最後都可以；所有檔案都在這個 worktree，不要寫到主資料夾。

## 再審（第四輪）：第三輪發現的修正

只審第三輪報告的修正與相鄰案例，不必整包重審。基準 `2016e4c`（第三輪待審的版本），待審分支 `claude/entry-and-catalog` 的最新 commit。逐項的處理與 commit 在[討論稿的〈Claude 回應 Codex 第三輪〉](<../Claude Codex Discussion/2026-11-02-entry-and-catalog-review.md#claude-回應-codex-第三輪2026-11-03>)。

**請特別查**：

- **這輪新加的規則**：否定字緊接在沒有位置的單元後面、讀完才去重（`fields.sources` 現在留著重複）、`splitOutsideLinks` 在 `parse.ts` 的用法（備註、錯題補強也走這裡）、`rawIndex` 切原文。有沒有帶進新的誤歸屬。
- **使用者已決定、不用再提**：`10-15` 維持沿用、`2之1` 算同一個單元、全形括號裡的字不動。除非你找到比已寫明的代價更嚴重的後果，再具體說。
- **性質測試**：`tests/sources.test.ts` 雜訊只加在保護區外、比 `problem`、`needsUnit`、`remark`，一種雜訊時從 `parseDeck` 跑到目錄與提示，兩種疊加時只跑讀法。有沒有漏掉的組合。
- **第二批的分法**：任務 §9-1 的三種結果夠不夠用。

**驗證方式**：`npm run check`；`node experiments/source-reading/product-check.mjs "$(pwd)"`（不是盲測，只當回歸）。Windows 版 Obsidian 1.15.0 上 `entry` 44 項 true、0 項 false，`entry-unread` 通過，見[任務說明〈結果〉](entry-and-catalog.md#結果)。沒跑 iPhone；Obsidian 1.15 的完整相容性檢查（D-138）不在這一輪。

回報照下面〈回報〉的格式，貼回對話或接在討論稿最後都可以；所有檔案都在這個 worktree，不要寫到主資料夾。

## 再審（第三輪）：出處的新讀法

只審 D-167 的程式與相鄰案例，不必整包重審。基準 `b493743`（已合進 `origin/main`），待審分支 `claude/entry-and-catalog` 的最新 commit。第二輪的 R2-F1 併在這一輪。編號說明：前兩輪的 D-165 和 main 撞號，改編 D-166。

| 要看的 | 內容 | Commit |
|---|---|---|
| 讀法 | `src/core/deck/sources.ts` 整個重寫：`sourceLinks(sources, own)`；`SourceItem` 多 `problem`、`needsUnit`、`remark`；`codeKey`、`termKey`、`headingKey` | `4a0bce2` |
| 單元的身分 | `src/core/catalog/index.ts` 的鍵不分全半形與大小寫，年級學期比鍵；對不到的參照同一個目標只留一筆 | `4a0bce2` |
| 提示 | `src/ui/sources.ts` 的 `unreadableSources` 多看目錄與那個單元的材料；標題去雜訊之後比；`state.unitMaterials` 多回 `name` | `4a0bce2` |
| 接線 | `Review.tsx`、`host.tsx` 的 `owner`；`save.ts` | `4a0bce2` |
| 別的欄位 | `parse.ts` 半形 `\|` 後面接欄位名稱也是分隔 | `4961699` |
| 開發命令的測試資料 | `src/obsidian/dev-entry.ts`：看不懂的那行換成新規則的例子；長文字拿掉逗號（逗號現在是分隔） | `4a0bce2`、`1c643d7` |
| 合併 main | `tests/compare-versions.test.ts` 的匯出行照這個分支改；`tools/compare/adapter.ts` 不讀出處，§9-4 要核對的部分沒有東西要改 | `b493743` |

**規格**：[D-167](../docs/decisions.md#d-167-出處的讀法不用猜的直接讀懂要猜的讓家長選)、[任務說明 §9-3、§9-5、§9-6](entry-and-catalog.md#9-3-出處一欄怎麼讀syntax-2-5d-167)、[syntax §2-5](../docs/syntax.md#2-5-出處)。過程與你前三輪的意見在[討論稿](<../Claude Codex Discussion/2026-11-02-source-reading.md>)。

**請特別查**：

- **歸屬**：哪些字串會默默算成別的單元，或默默少算又沒有提示。這是最優先的。讀法要對照你第三輪的攻擊，也請找新的。
- **目錄與材料不能改歸屬**：`deck` 這一層拿不到它們，設計上就做不到；請確認沒有繞過去的路（`catalog`、`own`）。`own` 只用本篇的屬性。
- **規格和程式有沒有不一致**：D-167、§9-3 的表、syntax §2-5、製卡規則；舊文件還留著舊讀法的地方。
- **性質測試夠不夠**：`tests/sources.test.ts` 的共用例子與雜訊；有沒有雜訊組合沒涵蓋。
- **第二批的條件**：對不到的參照留著、`find` 比鍵；這批的介面會不會讓第二批要重改。

**實作者自己選的做法（不同意請說）**：

1. **沒有另外的解析結果型別**：你第三輪建議記片段的狀態與未消耗的字。這批只加 `problem`、`needsUnit`、`remark`：讀法是純函式、結果不存檔，第四批要多的欄位時再加，沒有資料要遷移。`unit.rest` 是 `heading` 時由 Obsidian 層比名稱與材料。
2. **`溶解, 擴散 p.44` 不連標題**：`deck` 拿不到材料，所以只有整項沒讀到東西時才併回一個舊標題。`p.44` 照連，`溶解`、`擴散` 當說明。
3. **`國二上 p.15` 寫了自己的學期、沒寫單元**：連這一篇的 p.15，提示；別的學期不連。
4. **一段好幾個位置時，每個位置一個按鈕**：按鈕文字照位置切開；接著前一個的（`p.44, 45`）寫完整成 `p.45`。
5. **`p，44`**：逗號不是分隔，顯示成 `p.44`。其他雜訊顯示原文。
6. **位置前面的字**：兩個中文字以內或一個英文字當教材名稱不提示（`課本第44頁`、`Workbook p.12`）；這是門檻，不是原理。`課本` 這個限定沒有記下來，多份材料都有 p.44 時連第一份（你第三輪提過）。
7. **整段只有字**：同一欄有讀懂別的就是說明（`remark`），找不到標題不提示；像編號的字與否定字不算說明。
8. **本篇自己的編號單獨寫**（`2-2`）、網址、`第5題`：只顯示，不算看不懂。

**驗證方式**：`npm run check`（包含上面的測試）。正式程式跑兩份考卷（都不是盲測了，只當回歸）：`node experiments/source-reading/product-check.mjs "$(pwd)"`。Windows 版 Obsidian 1.14.5 上 `entry` 44 項 true、0 項 false，`entry-unread` 通過，見[任務說明〈結果〉](entry-and-catalog.md#結果)。

**已知的問題與沒做的**：

- `國二上13`、`小五上12`：寫法合法，默默算單元 13、12。靠第二批用到時檢查。
- 否定字是一張表；`國二上 1-3 那次考不好` 算單元，靠提示。
- 模組化填入是第四批，第二批考試範圍用到歸屬之前完成；第一批的提示只能教。
- 漏冒號的 `出處 p.44`、`來源：p.44` 沒動（backlog）。
- 舊版外掛不加 `需要版本`（D-164 第 9 點）；第二批要重看。
- 沒跑 iPhone；Windows 實機的結果寫在任務說明〈結果〉。

回報照下面〈回報〉的格式，寫進 `Claude Codex Discussion/2026-11-02-entry-and-catalog-review.md` 最後或貼回對話都可以；所有檔案都在這個 worktree，不要寫到主資料夾。

## 再審（第二輪）

只審第一輪之後的差異與相鄰案例，不必整包重審。基準 `ba051816175251adea51e7e8d194d9b43cee29b3`，待審分支 `claude/entry-and-catalog` 的最新 commit，程式到 `e032aa6`。

| 要看的 | 內容 | Commit |
|---|---|---|
| F3、F5、F6 | 分行的欄位名稱、子項目的順序、屬性提示的行號（改看 YAML 解析出來的鍵） | `b7e6625` |
| F2 | `CatalogIndex.unitTargets` 是目錄與選卡共用的目標集合 | `2509491` |
| F1 | 停用時關掉提醒；`startReview`、預覽、`openEntry` 停用後都不開 | `2c521b7` |
| F4 與 D-166 | 使用者定的新規則：只有開頭寫了年級學期才算別的單元；編號帶 `,`、`，`、`/`、`／` 不算單元；看不懂的通知多一句教法 | `f48018d`（規格）、`ac79592`（程式） |

請特別查 D-166：

- [D-166](../docs/decisions.md#d-166-家長亂填出處是常態程式不猜看不懂就當場教) 和 D-164、D-080、syntax §2-5、§2-10、任務說明 §9-3、§9-5、§9-6、§10、製卡規則有沒有矛盾，或還留著舊讀法的地方。
- 拿掉第 4 種之後，切開的條件與第 6 種有沒有新的洞：材料裡有同名標題（`1-2 溶液`）、`1-3 p.20, p.44`、`國二上 1-3 p.20, p.44`、編號帶符號但本來就有這個編號的卡組。
- 家長亂填的新組合：哪些字串還會默默算成別的單元，或默默對不到又沒有提示。`國二上 1-9`（格式對、沒有那個單元）不算看不懂，是 D-164 明訂到第二批再看。
- 新規則讓舊資料變意思的情況：舊卡組的 `1-3 p.20` 現在不算單元（D-166 接受的代價），但不能影響排程、ID 與題目指紋。

第一輪第 8 項的箭頭：Claude 判讀為展開前後顏色不變，照樣式稿不改，理由在報告的回應裡。

Windows 實機：`e032aa6` 上 `entry` 44 項 true、0 項 false。F1 只在 Obsidian 替身驗過。`tools/compare/adapter.ts` 仍等另一個分支。回報格式同下面的〈回報〉。

## 審查對象

- Repo：`Essence Cards`；worktree 用 `.claude/worktrees/busy-meitner-e52ff7`，或自己從分支 `claude/entry-and-catalog` 開新的 worktree。
- 規格基準與共同祖先：`fc91fe73a442d86dbb09ffb469cda5a31ef8651f`（`main`）。待審：分支 `claude/entry-and-catalog` 的最新 commit，程式到 `4f9d07c9f70de99c72ae9c3f95380ab2ae9e39ac`，之後只有文件。沒有未提交的修改。
- 這個分支還沒合併 `main` 上之後的 `eae7c36`（只改 `practice`，和這裡無關）。

## 規格與優先順序

- 任務說明：[`tasks/entry-and-catalog.md`](entry-and-catalog.md) §1～§12，§13 列的不做。
- 決定：[D-163](../docs/decisions.md#d-163-入口與目錄的四批開法全部卡的一輪與提醒一區)、[D-164](../docs/decisions.md#d-164-出處的寫法與讀法)、[D-097](../docs/decisions.md#d-097-目錄畫面)（含 2026-11-02 的補充）、[D-095](../docs/decisions.md#d-095-入口畫面)、[D-142](../docs/decisions.md#d-142-範圍與目錄模組的六項選擇) 第 2～4 點與環節 7 的八條架構原則、[D-146](../docs/decisions.md#d-146-卡組筆記的全部卡按鈕與第一次的提醒)、[D-161](../docs/decisions.md#d-161-預覽卡片不記錄不動排程設定頁打開才有)、[D-154](../docs/decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測)。
- 格式：[`docs/syntax.md`](../docs/syntax.md) §2-1、§2-4、§2-5、§2-10。
- 基準之後的規格變動：全部卡的順序多一段（今天答過、還沒到期的排到新卡後面），使用者 2026-11-02 選的，已改 D-097 與任務說明 §4。
- 規格衝突時列成問題，不挑容易通過的那份。

## 請特別查（格式查核之後才定的，Codex 還沒看過）

[格式查核的回應](<../Claude Codex Discussion/2026-11-02-entry-and-catalog-format-review.md>)列的三項：

1. **分行**（§9-4）：有沒有漏掉會讀卡組的地方。`parseDeck` 之外：`assignIds` 的 `fixIndent`、`src/state/ids.ts` 的比對、`src/obsidian/lock.ts`、`src/dev/compare.ts`、`tools/compare/adapter.ts`、`src/core/deck/markdown.ts` 的清單樹。四格、七格、縮排過深、Tab、CRLF、implicit 目標都有例子，請找新的組合。
2. **手寫容錯**（§9-3）：`src/core/deck/sources.ts`。切開的條件、頁碼範圍、`第 44 頁`、黏著的年級學期。尤其是新增、刪除同名單元的卡組前後，出處的意思不能變。
3. **看不懂的判斷**（§9-5）：`src/ui/sources.ts` 的 `unreadableSources` 與 `src/obsidian/save.ts`。會不會誤報（材料還沒建快取、連不到的材料）、會不會漏報。

## 行為與風險

高風險的範圍：跨模組、資料格式、選卡。

- **公開介面**：`State` 多了 `scope`、`catalog`、`deckTargets`、`unitMaterials`、`onUnread`，`next` 收 `StudyPick`；`study` 的 `Pick` 多了 `{ targets }` 與 `{ targets, since }`，多了 `scopeCount`、`todayLeft`、`memoryColors`；新模組 `src/core/catalog`；`deck` 多了 `sourceLinks`、`sourceLabel`、`splitUnit`、`termRank`。
- **不可破壞的性質**：
  - 同一份輸入下，目標集合、已完成數、剩餘數在選卡、`top()`、完成畫面三處一致（§5）。
  - 預覽什麼都不寫：紀錄逐位元組不變，`state.progress()` 不變。
  - 題目指紋不變；補 ID 與改縮排不改到分行的意思。
  - `deck`、`study` 不 import `catalog`；`catalog` 從 `study` 只拿型別。
  - `unread` 的通知不經 `onChange`，存檔按鈕等既有監聽者不多跑一次。
  - 手機的需要新版、讀不到、寫不進去的通知維持現況；電腦的「寫不進去」也維持。
  - 外掛停用時入口與複習都關掉，什麼都不寫。
- **明確延後**：§13；第四批的編輯畫面標示與猜測；`國二上 1-9`（格式對、沒有那個單元）不算看不懂。

## 實作者自己選的做法（請先看這些）

規格沒寫、由 Claude 決定的：

1. **`國二上 1-3, p.44`**：照 §9-3 字面，第 3 種後面沒接位置就不切，整段讀成單元 `1-3,`、後面是位置。結果是對不到單元、照文字顯示，也不算看不懂。`L1, L2`、`2-1, p.44` 沒有年級學期，是第 6 種，會提示。要不要讓帶分隔符號的編號算第 6 種，請判斷。
2. **跨單元只在同一科**：第 3、4 種都用目標所在卡組的科目，因為單元的身分含科目，出處又沒有寫科目的地方。
3. **一輪的記憶看 `since` 之前的紀錄**：順序在這一輪中不變；再出的時間看到現在為止全部的作答。retention 用設定值，沒有考試的提高（第一批 `exam` 是 null）。
4. **`memoryColors`**：橙是剛答錯或 `dueAt ≤ now`；藍是 `dueAt - last.at` 超過 21 天（`intervalDays` 的結果有換日的影響，所以用實際的日期差）。
5. **卡住的讀取只回報，不解開佇列**：一直不回來的讀取算進 `unread()`，但 `reads.ts` 的那一列照舊卡著，後面的讀取等它（既有行為，[技術債](../docs/backlog.md#技術債)「讀取的等待上限」）。計時另外接在讀取上，不串在 `files.read` 後面，因為多一層 Promise 會改變既有的先後（`tests/state-gate.test.ts` 抓到過）。
6. **單元的狀態**：有啟用的篇是 active；沒有時草稿優先於暫停（D-097 的「草稿 > 暫停」）。草稿與暫停的單元，別的單元寫過來的目標也不算。
7. **其他組**：沒有目標也沒有屬性問題的筆記不列；一篇一列。預設收著，沒有任何學期時才展開。
8. **展開時不顯示右邊的數字**：照樣式稿，按鈕的 N 已經寫了。
9. **看不懂的判斷**：材料的快取是 null 時不知道、不提示；連不到檔案的材料算找不到，要提示。行號寫目標那一行（出處可能分行，欄位沒有存行號）。
10. **預覽的打字卡**：`first` 用 `skip`／`right`／`wrong`，靠現有的畫面邏輯畫出答案，再回傳全部四顆自評。`Session` 的 `TopView`、`CardView`、`TypedView` 多了四個選用欄位（`canForward`、`pinned`、`nextLabel`、`skipLabel`），複習不用。
11. **既有的卡組 `Pick`**：完成畫面寫「這一篇今天的份完成了！」（任務說明的表沒有這一列）。
12. **設定頁**：「複習」放在「備份」前面，手機也有。
13. **字型**：`@fontsource/cormorant-garamond` 的 latin-500-italic，用 `subset-font` 在暫存資料夾裁成 `Essence Cards` 用到的字；兩個套件都沒有加進 repo 的相依。`styles.css` 從約 35 KB 增加 2.8 KB。

## 已知的問題與沒做的

- **§9-4 的 `tools/compare/adapter.ts`**：另一個 session（分支 `claude/fervent-hodgkin-9c2bca`）在改這個檔，這裡不能動，也還沒和新讀法核對。等它合併後從 `main` 合併進來，再核對一次。`DeckProps.issues` 不在快照裡；新的 `field-children` 提示與全形空白的單元鍵會讓有這些寫法的卡組多出差異，這是真的變化，但要看一次。`src/dev/compare.ts` 的 `fieldNames` 不用改，有測試。
- **iPhone**：全部沒測，併入[下一次實機測試](../docs/backlog.md#v1-需要做的任務)。
- 同一個 commit（`c3b4cbe`）放了索引、選卡與 `unread` 兩個缺口，原因是互相依賴的型別；再審時請照檔案分開看。

## 驗證方式

- 指令：`npm run check`（完整的要在沙箱外跑，見 [quality.md](../docs/agents/quality.md#檢查指令)；沙箱裡有 10～11 項環境造成的固定失敗，請逐項列出）；`npm run build`。
- 環境：Node 24、`happy-dom` 21、React 19.3（畫面測試 `tests/entry-ui.test.ts` 用真的 React 加 happy-dom，它沒有版面）。
- Claude 跑過：每個 commit 的 `npm run check`；Windows 版 Obsidian 1.14.5 上開發版 `0.2.0+a1b73b5.dirty`（內容同 `4f9d07c`，只差之後改的測試）的開發命令 `entry`（44 項 true、0 項 false，截圖 26 張，淺色與深色、電腦與手機寬度）與 `entry-unread`（獨占鎖擋住一篇：狀態列與提醒一區出現，放開後都消失）。結果的摘要在[任務說明〈結果〉](entry-and-catalog.md#結果)。
- 沒跑：iPhone；真的輸入法組字；發布前比較（見上）。

## 回報

- 只審查，不改產品程式；可以在隔離環境重現。
- 每項發現寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證）、建議處理（合併前修／記進技術債並附觸發點）。
- 依嚴重程度排序。沒有發現也寫出看過哪些、跑了什麼、結束時工作樹乾淨與否。例子只是起點，請找新的組合。
