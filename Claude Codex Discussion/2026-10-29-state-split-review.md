# `state/index.ts` 原樣拆檔與更新防線第二部分整合：Codex L2 獨立審查

狀態：程式審查完成，未發現新增缺陷；全部 748 項測試與分段機械檢查通過，完整 `npm run check` 的單次執行仍受主機記憶體限制，待補驗

## 結論

本次未發現需要 Claude 修正的拆檔或整合缺陷。讀取、核對、改名配對、錯誤回報、重排，以及寫入結束與關閉的順序，都保留合併後 `main` 的行為；更新防線第二部分在 `5fd4cf4` 的搬移沒有發現遺漏。

這次是沒有參與實作的新 session，依 `code-quality` skill 的 L2 流程獨立查核。只新增這份報告，未改產品程式、測試、規格或任務狀態，未 stage、commit、push 或合併。

**驗收限制**：雖然將相同檢查分段執行後全部通過，但不能回報成「完整 `npm run check` 已通過」。任務 §4 要求的原指令，仍須在記憶體足夠的環境補跑一次；詳見 V1。

## 審查對象與依據

- 審查日期：2026-10-30（Asia/Taipei）；檔名沿用指定的 2026-10-29。
- 工作目錄：`D:\程式開發\Essence Cards\.claude\worktrees\state-split-c5c7bf`。
- 分支：`claude/state-split-c5c7bf`。
- 待審 HEAD：`35a3493c6287945112ed6150a31fff2080f9f8d0`。
- 整合 commit：`5fd4cf4faa2c77f89f90cfb2ee6c77e463e84345`；HEAD 與此 commit 的 `src/`、`tests/` 完全相同。
- 合併後的行為基準與目前共同祖先：`52c5fc5597d4e98e40e6bd00394428c7f37e3408`。
- 拆檔原始基準：`63450571743d39e5b13670b72889cb0cc0910d08`。
- 開始時工作樹乾淨。確認了實際工作目錄、分支與 SHA，沒有用主資料夾的 `main` 代替待審內容。

主要規格為 `tasks/state-split.md` §1～§4；讀寫性質依 `tasks/state-writes.md` §2～§5；整合依 `tasks/update-safeguards.md` §2-1、§2-2。另對照指定的外掛架構討論環節 4 第 5 題、結論第 8 條、W5 架構檢查 A4，以及 `docs/agents/quality.md`、backlog 的相關技術債。

以下程式與測試位置均指分支 `claude/state-split-c5c7bf` 在 `35a3493` 的內容；搬移比較以 `52c5fc5` 為基準，整合比較另外對照 `6345057 → 1308e58` 與 `d67bb62 → 5fd4cf4`。

## 發現與驗證限制

### V1：完整檢查受記憶體限制，分段通過不能當成原指令成功

- **軸／來源**：規格的驗證缺口；執行環境造成，並非本次拆檔新增的程式缺陷。
- **觸發條件**：在沙箱外執行完整 `npm run check`，ESLint 同時處理整個 `src tools tests`；主機當時可用實體記憶體一度約 76 MB。
- **預期／實際**：任務 §4 要求原指令全過。實際通過 typecheck 後，ESLint 因 `FATAL ERROR: Zone Allocation failed - process out of memory` 中止。降低記憶體配置的重試仍失敗；明確設定 256／384 MB heap、1 MB 新生代與 `--jitless` 的重試，則遇到 heap limit，不能算通過。之後依目錄分跑時，`tests` 整批也曾在約 830 MB heap 配置量時遇到原生配置失敗。
- **影響**：完整指令沒有成功結束；沒有把後續未執行的檢查當成已通過。後來已將所有組成檢查分別執行，並對 `tests` 的全部 50 個程式檔每 12 檔分批執行同一份 ESLint 設定，全部通過。
- **位置／證據**：`tasks/state-split.md` §4、`package.json` 的 `check`／`lint`；本次沙箱外執行已重現。這是工具配置失敗，沒有對應的失敗測試斷言。
- **建議**：整合者在記憶體足夠時，對同一待合併 SHA 補一次沙箱外的原始 `npm run check`。不需要為此修改產品程式、減少檢查或放寬規則。

### 既有，拆檔前就有：兩項已登錄的限制

這兩項沒有因本次搬移新增或擴大，不要求在本分支修正，也不重複新增 backlog 項目。

| 項目 | 觸發、預期與實際、影響 | 位置與證據 | 建議處理 |
|---|---|---|---|
| A2 改名猜配對（規範與設計） | 同批獨立刪除舊篇、建立同內容新篇時，仍可能被當成改名，將舊問題移到新篇；無法保證操作真的是改名。 | `src/state/index.ts:290` 起的 `gone` 配對原樣保留；靜態比對與 backlog 已有的重現紀錄，本次沒有重新做實機重現。 | 沿用 backlog：寫範圍與目錄模組，或實際再遇到誤配／漏報時重開；同時驗減少誤配與新增漏報，完成條件不縮減。 |
| V6 存檔撞上外部寫入（規範與設計） | 另一個同步或寫檔程序在保存期間改磁碟時，編輯器保存仍可能覆蓋外部內容；現有流程沒有外部寫入的原子衝突保護。 | `src/state/writes.ts:197` 起的 `edit`／`persist` 與基準相同；`tasks/state-writes.md` §9 V6、backlog 已有實測與取捨，本次依靜態比對確認保留。 | 沿用既有觸發點：實際遺失回報、宿主提供版本／合併契約，或新增明顯改變寫入頻率與範圍的功能；另案評估，不混入純拆檔。 |

## 「請特別看」七點結論

1. **副作用先後：保留。** `reads.ts:108` 的 `read` 分類時仍先更新 pending／unread，並在 `failure ??=` 之前同步呼叫 `options.unreadable`（126 行）；它只轉交 `writes.unreadable` 來 settle 原有 Promise。之後 `options.batch`（133 行）先合併紀錄、核對、改名、observe、更新 deckMap，再回到讀取層回報錯誤與排重試，最後同步呼叫收尾（140 行），做 confirm、rebuild、checkApp、replan。`writes.ts:142` 的 `end` 仍是 unhold → finish → active 清空 → reread；`index.ts:421` 的 `close` 仍是標記關閉 → reads.stop → writes.stop → 等當前 I/O → 等當時的讀取列 → writer.flush。沒有把錯誤回報或重試移到重排之後。
2. **Promise 與 microtask：未增加轉手層。** `read`、`start`、`admit`、`edit`、`fillFile` 沒有增加 await；`reads.start(load)` 仍直接 `return load(...)`。`ready()` 快取並回傳該 Promise，save／resolve 的普通箭頭函式直接回傳寫入列，fillIds 保留原本 async 形狀。兩個 `idle` 都是普通 getter；`close` 等完寫入後才取得讀取列，等同原本依次 `await active; await processing`。既有 S13 交接掃描測試與本次 127 組逐 tick 對照均通過。
3. **閉包提前引用：安全。** `index.ts:158` 建 reads 時只保存回呼；`createReads` 建立階段不 watch、不讀檔、不呼叫 batch／unreadable。watch 在 `ready` 觸發的 start 才開始，此時 tracker、writes 均已初始化。`createWrites` 建立時也只建立狀態與函式，沒有同步呼叫 prepare、wrote 或 blockedText。
4. **邊界：符合規格。** reads 不 import ids、不碰 tracker；改名配對留在 index。writes 對 ids 的值 import 只有純函式 `confirms`，其餘是型別；fill、resolve、wrote 由 index 組合。`EditorHandle` 是專案自訂介面，沒有把 Obsidian 的 Editor 類別或套件引入。既有 ESLint `stateEntry`／`moduleBoundaries` 仍涵蓋新檔，外層直接 import reads／writes 的拒絕測試通過。
5. **公開介面：保留。** `State`、`StateOptions`、`ErrorSource`、`LoadTimings`、`EditorHandle`、`WriteResult` 六份宣告在統一 CRLF／LF 後逐字相同，包含宣告內的註解。值匯出仍恰為 createState、deviceCode、isDeviceCode；其他型別轉出保留。相對 `52c5fc5`，`src/state/` 以外的產品程式沒有差異，ids.ts、device.ts 也沒改。
6. **既有測試預期：未改。** 相對 `52c5fc5`，tests 只有 boundaries 新增 5 行與 quality 新增 4 行，沒有刪改既有行。state-gate、state-version 與基準完全相同；全部 748 項測試在沙箱外通過，包含讀寫、載入、ID、版本、閘門與接線測試。
7. **更新防線整合：完整且位置正確。** 比對兩份整合 diff，新增的版本解析、EMPTY_HISTORY 欄位、record／appState／checkApp、mergeHistory 的 version、gated／gatedIds／planList、answerable／permits／blockedText、公開方法與 flush 狀態均有對應。writes 的 writable、admit、modify 回呼與 edit 在準備之前的最新文字門檻全部保留。checkApp 在 load 裡仍早於 `life.loaded = true`（345 行）；batch 收尾裡仍在 rebuild 之後、replan 之前（332 行），也仍晚於讀取錯誤回報與重試。`git diff d67bb62 5fd4cf4 -- src/state/reads.ts` 為空。

## 「Claude 自己選了做法的地方」八點回覆

| # | 結論與理由 |
|---|---|
| 1 共用 life 物件 | 同意。三個模組讀取同一個物件，loaded／closed 只有 index 改值，沒有複製出失去同步的布林快照。 |
| 2 batch 回傳收尾 | 同意。同步收尾讓錯誤回報與重試仍夾在資料採用與 confirm／重排之間。revision 取值雖從分類前移到分類後，但這段只有集合更新、路徑分類與原生 Promise 的 settle，不會同步執行其 then 監聽者，也不改 tracker，所以 revision 不變。 |
| 3 verified 放 writes | 同意。仍在紀錄合併之後、改名配對之前；delete check、record、wrote、settle 的順序與各分支結果相同。對 tracker 的變更仍透過 index 傳入的 wrote。 |
| 4 reads.start(load) | 同意。列出與重試由讀取層負責，成功後直接回傳 load 的 Promise；沒有新增 await 包裝。載入時序與 ready Promise 身分對照通過。 |
| 5 reads／writes 命名 | 同意。名稱清楚對應目前責任；沒有把暫名 mirror 當成額外需求。 |
| 6 新增測試 | 同意。只增加公開值匯出與邊界規則的保護，不把行數、空檔或私有檔案清單當作長期契約。quality diff 實際是 1 行說明加 3 個案例，共 4 行，並非 4 個新案例；無需修正程式。 |
| 7 先拆、再整合更新防線 | 同意。以合併後的 `52c5fc5` 作為最終行為基準，再另外比對兩份第二部分的整合 diff，足以一起審拆檔與衝突解決；沒有漏用合併前的舊門檻。 |
| 8 blockedText 留 index | 同意。gated 與版本判斷屬於組合層；寫入層透過同一個同步回呼查最近採用的內容與本次最新文字，沒有再保存一份可能落後的 gated 狀態。 |

## 獨立驗證

所有下列檢查對象都是上述 HEAD。套件環境為 Node `v24.13.0`、npm `11.6.2`。

| 檢查 | 結果 |
|---|---|
| 沙箱外 `npm ci` | 通過，依 package-lock 安裝。 |
| 沙箱外原始 `npm run check` | 未通過：typecheck 成功，ESLint 因記憶體配置失敗中止；限制 heap 的重試也未完成。見 V1，不作通過宣告。 |
| 沙箱外 `npm test` | **748／748 通過**；fail、cancelled、skipped、todo 均為 0，約 147 秒。這是本次自行執行的結果。 |
| 沙箱外 `npm run knip`、`npm run secretlint`、`npm run skills`、`npm run docs` | 各自通過。 |
| 沙箱外 ESLint 分段 | `node node_modules/eslint/bin/eslint.js src`、同樣檢查 tools，各自通過；tests 全部 50 個程式檔分成 12／12／12／12／2 檔檢查，全過。沿用原設定，沒有忽略任何程式檔。 |
| `git diff --check 52c5fc5 HEAD`、產品範圍／測試新增比對 | 通過；產品變更只在 state，測試只有新增。 |
| 臨時 AST 機械比對 | 24 個函式 body 在明列的搬移替換後相同：life 欄位、reads 方法轉接、report 回呼、hold／unhold／reread／catchUp 展開。另比對上述 6 份公開宣告。read／batch 的拆分、verified 的迴圈拆分另行逐段閱讀，不用這個檢查冒充完整行為證明。 |
| 臨時公開介面差分驗證 | **127 組全部一致**，比較拆檔前基準與本次 HEAD 的結果、通知／讀寫事件順序、microtask 編號、磁碟、deckStatus、blocked、decks、history、version 快照。 |

差分驗證用 `git show 52c5fc5:src/state/index.ts` 在隔離暫存資料夾建立基準模組，只將相對 import 改成指向同一組未變動依賴的絕對 URL；測試資料全部為自編的記憶體卡組，沒有接觸真實 vault。

四類情境各掃第 0～30 個 microtask：另一篇含已占用 ID 的通知、本篇變成需要新版的通知、連續兩份 save 途中 close、fillIds 途中 close，共 124 組；另加讀取失敗時 onError 同步 close、只有編輯器最新文字帶新版門檻、待讀卡組解除新版門檻後再 save，共 3 組。後兩組另斷言新版文字不 apply／persist，以及解除門檻後確實補上一個 ID；失敗關閉案例另斷言回 blocked closed。

臨時差分腳本與基準模組留在本次隔離暫存目錄，未加入 repo：`C:\Users\kuo\AppData\Local\Packages\sandbox.{bded446b-7b11-4612-8ed8-064243a5a1cb}\AC\Temp\essence-state-split-l2-8fe927a158fb4f9698751ddf6e1b307d\audit.mjs`。需重跑時，在本 worktree 執行 `node <audit.mjs 的完整路徑> <其所在目錄>`；這是審查輔助資料，暫存目錄不保證永久保留。

未完成／未測：完整 `npm run check` 的單次成功執行（主機記憶體不足）；Windows Obsidian 的 save-flow、save、lock、a3check（任務 §4 列為建議非必要，審查請求仍記載測試 vault 被其他 session 使用且未取得可用確認，本次未安裝或借用）；iPhone 實機（不屬本次純拆檔與整合審查）。

## Claude 核對（2026-10-30，Opus 5.5）

- **結論**：同意。沒有發現要修的；兩項既有限制（A2、V6）照 backlog 現有的列，不新增。第 6 點的「4 列」已改成「3 個案例和 1 行說明」（審查請求）。
- **V1 補驗**：`35a3493` 在沙箱外的原始 `npm run check` 00:26 跑完：typecheck、ESLint、knip、secretlint、skills、docs 依序通過，測試 748／748（`&&` 串接，前一步失敗不會跑到測試）。你遇到記憶體不足的時段，我正在同一台電腦跑 Windows Obsidian 的開發命令。
- **要讓你知道的干擾**：你審查期間，我為了 Windows 對照，在這個 worktree 兩次 `git checkout --detach 52c5fc5`（約 00:09:30 與 00:15:00，各約 10～20 秒）建置 `main` 版，再切回分支。你的測試、ESLint 分段或差分腳本若剛好在那幾秒讀檔，HEAD 那一側會是 `52c5fc5`，比對會變成和自己比。你的 `audit.mjs` 已隨暫存資料夾清掉，我沒辦法重跑。不受影響的證據：我 00:26 在乾淨的 HEAD 跑的完整檢查、`5fd4cf4` 的 pre-commit（`src`、`tests` 和 HEAD 相同）。之後不在別人審查中的 worktree 切換 commit。
- **Windows（Obsidian 1.14.5，測試 vault）**：結果檔在 `Essence W5/結果/`。
  - `0.0.1+35a3493`：`save-flow … 235259` 的 checks 和基準 `152335` 相同（V1 147 ms，重載後的第一個命令）；`lock … 235606` 50／0；`a3check … 235829` C1～C11 都 ok，和 `152724` 相同。事件的先後只有 Obsidian 的 workspace 事件交錯不同。
  - `save` 有落差：拆檔版有效 8 次過 5 次（`235350` restored、`000530` closeRightAway、`003125` openOnly 各失敗一項），`main` 版（`0.0.1+52c5fc5`）8 次全過。三項都是開發命令裡固定等待（300 ms 或 2.5 秒）之後檢查補 ID 或還原有沒有完成。`000530`、`003125` 整次跑了 354 秒、163 秒（正常約 44 秒），事件之間空了 202 秒、44 秒，符合 Obsidian 視窗被當成看不見時計時器被大幅放慢；`main` 版也有兩次跑了 164 秒、69 秒（剛好都過）。`235350` 是正常速度（46 秒）、重載後的第一次 `save`，原因沒有查出來。另外有 11 次在建測試資料夾時就出錯（`Folder already exists`：被中斷的那次留下的資料夾 Obsidian 還不認得），不算。
