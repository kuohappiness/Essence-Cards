# 更新防線第二部分｜Codex L2 審查（2026-10-29）
狀態：已完成：Codex 第三次再審通過（`ae9c6b2`），第二部分合併進 `main`（`1308e58`）

**結論：找到兩項紀錄寫入閘門的缺口。** F1 會讓回看改評分留下兩筆有效作答；F2 會讓帶 `lt` 的取消行檢查錯目標。另有一項較低風險的提示問題 R1，可隨修正處理或列有明確觸發點的技術債。既有完整檢查通過，不能取代這兩個新組合的驗證。

本輪依 [審查請求](../tasks/update-safeguards-2-review.md)、[任務說明](../tasks/update-safeguards.md) §2 與 §1-4、syntax §0-1／§2-1／§5、D-149／D-134／D-154，以及前輪格式查核的條件審查。只回報，未修改既有產品程式、測試或規格，未在專案分支 commit。

## 範圍與證據

- 基準：`1e8133198974116d35374335493418ba1026571b`。
- 待審：`f73525b06c382741fd12e764ffcbca9a999dc60c`，範圍為兩者的完整 diff：33 檔，+1201／−70，包含合併 `state` 讀寫協調後的寫入門檻。
- 另外建立 detached worktree，在其中 `npm ci`；Windows、Node `v24.13.0`、npm `11.6.2`。`npm run check` 在沙箱外執行，exit 0；型別、ESLint、knip、secretlint、skill 一致性、文件檢查與 **737 項測試全部通過，0 skipped**。包含請求指定的各測試檔及 `state-writes`／`state-ids`。
- 另外跑 8 項核心／state／session 探針、3 項接線探針；其中兩項刻意斷言實際錯誤結果，用來固定 F1／F2 的重現，**不是新驗收已通過**。另用 TypeScript 確認 F2 的輸入不需 `any` 就符合 `NewEntry`，並以 Windows 獨占鎖驗退回時讀檔失敗、以基準版 reader 驗 `app` 的向後相容。
- 審查前後，隔離 worktree 的 tracked diff 都是空的。原實作 worktree 已在較新的 commit，本輪未切換或改動它，也未把後續提交算進審查結論。
- 報告新增後，主資料夾的 `node tools/check-docs.ts` 通過。隔離 worktree 已按請求以一般刪除再 prune 清理，沒有使用 `git worktree remove --force`；本機重現腳本與完整檢查輸出保留在主資料夾的 `.local/review-evidence/update-safeguards-2-f73525b/`，不進 repo。腳本以指定 commit 的 worktree 根目錄為執行位置，重跑前需複製到該處並安裝依賴。

**位置約定：以下所有產品程式及既有測試的路徑、行號，都指分支 `claude/update-safeguards-2` 的該檔（`f73525b`），不是主資料夾目前的程式。** 主資料夾只新增本報告；探針、合成 vault 與執行輸出均使用隔離資料。

## 發現（依嚴重程度）

### F1｜P2｜回看改評分沒有處理取消被拒，會多留一筆有效作答

- **軸：規格。** [審查請求](../tasks/update-safeguards-2-review.md) 第 40、60 行要求 `change` 的取消與新評分一起寫或一起不寫；[任務說明](../tasks/update-safeguards.md) 第 160 行要求 `answer` 拒絕被停目標的紀錄。
- **位置：** `src/review/session.ts:439`～`443`，尤其第 440 行忽略 `state.answer({ undo: entry.t })` 的回傳值；相關入口為 `src/state/index.ts:716`～`717`。
- **觸發：** 這台已對目標 A 作答；同步後，另一台對目標 B 的作答和 A 有相同的 `t`，而 B 被 `need` 的行或卡組閘門停掉。A 本身仍能作答。這是既有紀錄允許保留的跨裝置同刻作答，無須同一台 writer 重號，也無須兩次呼叫之間發生非同步競態。
- **預期：** 取消涵蓋同 `t` 的所有作答，B 不能寫，所以這次改評分應整組拒絕；A 保留原評分，回看也不應改顯示成新評分。
- **實際：** `canAnswer(A)` 是 `true`；取消因同 `t` 還包含 B 而回 `null`；`change` 仍寫 A 的新評分並回 `true`。重現把 A 的 `good` 改成 `miss` 後，`history.reviews` 裡 A 是 **`[good, miss]`**，`cancelled` 是 **`[]`**，畫面歷史卻只顯示已改成 `miss`。
- **影響：** 這次修改變成追加一次複習，重播與到期時間會用到本來應被取代的評分；畫面與有效紀錄不一致。舊有「時間跨啟動會撞」技術債不能涵蓋這個新缺口：此處用的是兩台裝置各自合法、相同時間的作答。
- **證據：已重現。** 透過真實 `createState`、`createSession` 與記憶體 `Files`：先評 A，再同步「B 的同 `t` 作答＋只停 B 的新行」，回看改評分。沒有替換 `answer` 或 `canAnswer`。
- **建議：合併前修並加回歸測試。** 至少檢查取消的結果：為 `null` 時立刻回 `false`，不寫新評分、不改 `DoneCard`。沿用目前同步呼叫的設計即可修這個具體反例，不必先引入一般交易框架。測試需同時斷言磁碟原文、有效 `reviews`、`cancelled` 與回看評分；另保留成功改評分的取消／新評分成對案例。

### F2｜P2｜取消行多帶 `lt` 時，閘門檢查的對象和真正寫出的操作不同

- **軸：規格。** [審查請求](../tasks/update-safeguards-2-review.md) 第 59 行明定「取消看它指的那一筆的 `lt`」；syntax §5-2 第 577 行要求被停目標不寫紀錄。
- **位置：** `src/state/index.ts:716` 的分支優先順序；對照 `src/core/study/entries.ts:5` 的 `encodeEntry`：後者先認 `undo`，前者先認 `lt`。
- **觸發：** 已有 `t=T`、`lt=aaaaaa` 的可讀作答，之後 `aaaaaa` 被停，但 `bbbbbb` 仍可寫。呼叫：

  ```ts
  const entry: NewEntry = { undo: T, lt: 'bbbbbb' };
  state.answer(entry);
  ```

- **預期：** 這是一筆取消，應查 `T` 指到的所有作答；其中 `aaaaaa` 被停，回 `null` 且不寫。
- **實際：** 閘門只查 `bbbbbb`，放行；`encodeEntry` 隨後把它寫成 `{ t, undo: T }`，實際取消 `aaaaaa`。重現取得新的 `t`，`history.cancelled` 變成 `[T]`，被停目標的原作答消失。
- **影響：** `answer` 的中央閘門可被合法的結構型別輸入繞過。現有正式畫面的取消呼叫沒有帶 `lt`，因此這項目前是公開介面的缺口，和 F1 已有畫面呼叫端的錯誤分開列；不宣稱一般回看都會走到此路徑。
- **證據：已重現。** 真實 state 與記憶體 `Files`。另以 `tsc --noEmit --allowImportingTsExtensions --skipLibCheck --target es2022 --module nodenext` 編譯上述型別的獨立檔，exit 0，沒有使用 `any` 或型別強制轉換。
- **建議：合併前修並加回歸測試。** 閘門與 encoder 使用相同的操作分類順序：先判 `undo` 並查它指到的全部目標，再處理其他帶 `lt` 的操作。測試同時放入無關、可寫的 `lt`，斷言仍被拒且磁碟沒有新增行；再驗可寫的取消不會被無關的多帶欄位誤擋。

### R1｜P3｜問題小視窗把「需要新版」誤說成「請再按一次存檔」

- **軸：規範與設計。** 審查請求第 41、64 行要求需要新版時用對應說明；沿用 D-154 的「受阻時當下說清楚」原則。
- **位置：** `src/obsidian/save.ts:121`～`125`。一般存檔已有 `saveTip` 的 `needs-update` 分支，但問題小視窗仍把所有非 `done`／`failed` 結果對到 `TIPS.stale`。
- **觸發：** 已開著進度連結問題的小視窗，按下選項後，`resolve` 因最新編輯器文字或寫入前重讀結果而回 `blocked needs-update`。例如磁碟重讀通知尚未關閉小視窗，編輯器文字已帶新標記。
- **預期／實際：** 應說明需更新外掛；實際說「這篇筆記剛剛改過，請再按一次存檔」。重按不能解除版本限制。
- **影響：** 不會寫壞資料，但讓使用者重試一個版本限制下不會成功的動作。
- **證據：接線已重現；完整使用者時序為靜態推斷。** Node 的 Obsidian 替身讓真實 `IssuesModal` 收到該結果，通知確實是 `TIPS.stale`；未在 Obsidian 實機操作這個時序。
- **建議：** 可順手讓小視窗共用結果到提示的對應；若延後，請由 Claude 記技術債：**觸發點**為下一次修改存檔／問題小視窗的結果提示，或啟用第一個最低版本標記寫入端前，取較早者；**完成條件**為小視窗收到 `blocked needs-update` 時顯示對應更新說明，有接線測試，並保留不寫入的保護。

## 「請特別看」9 點逐項結論

| 項目 | 結論與驗證範圍 |
|---|---|
| 1. 讀不懂的行的影響範圍 | **未發現合併器的阻擋缺口。** 三個條件、取消後仍能找到的原作答、所有同 `t` 作答、行尾救回與 `seen` 的既有測試通過。新探針驗「未知行的 undo 指到另一未知行／指到變更」都令 `incomplete=true`；跨月份、還原檔中的未知 undo 指到兩台同 `t` 且已取消的作答，兩個目標都進 `held`。讀不懂的行不充當可讀作答。合法 JSON 的 `need` 鍵只能直接出現或含 `\u` 跳脫，因此原文預篩沒有漏掉另一種可編出相同鍵名的 JSON 寫法；BOM、外側空白、跳脫鍵探針也通過。 |
| 2. 卡組標記 | **所驗案例符合規格。** 流式對照表、明確鍵 `? 需要版本`、錨點／別名作鍵與值、`!!map`／`!!str`、Unicode 跳脫、BOM／CRLF 均能取出標記。F1 的引號、縮排、冒號前空白、行尾接行及無結尾案例均被擋。裸 `<<` 在目前 YAML 1.2 reader 的預設 schema 下是一般鍵，不會合併成頂層標記；巢狀的 `需要版本` 與多一個空白的鍵仍不算。沒有把未約定的 YAML 1.1 directive／merge schema 當成本版已支援的屬性語法。 |
| 3. 四邊閘門與合併後寫入 | **卡組排程、寫回與按鈕一致；作答入口有 F2。** `planList` 排除被擋卡組及重複 ID，`planToday` 再排除 `held`／`incomplete`；`save`／`resolve` 的編輯器文字及 `fillIds` 的 modify 原文都過門檻。新探針驗已有 needs-update、待讀裡剛改回可讀時，第一次 save 可成功；最新編輯器又加標記時 resolve 被拒。`unread` 優先會維持拒寫，沒有把不完整占用當成可寫。另驗被擋卡組裡有隱藏的 lost 問題，別篇 lost 的還原候選仍正確；解除標記後原卡組的問題也回來，未偷用別篇的候選。 |
| 4. 版本行時機 | **正常先後、延後讀取與一次啟動一行符合規格。** 既有測試含所有月份、同 BUILD 不重寫、退版重寫、同刻異值、自己的衝突副本／還原檔排除、失敗重試。另驗 unread 期間先作答並 flush、重讀會接到已落盤的重複作答時，仍正確判同 BUILD、不重加 app。`checkApp` 在 closed 後不再記；`close` 等 writer，但 `own` 的 `written` 由 `state.flush` 確認，不能把單純 queued 當落盤證據。 |
| 5. 作答被拒與改評分 | **不通過：F1、F2。** 一般 `rate` 被拒時不記錄、不進回看、換下一張，以及回看目標本身被停時評分不可按，既有測試通過。不能因此推論取消與新評分已成對：跨目標同 `t` 反例證明不成立。找不到對象的取消照舊寫，是請求明定的例外，本輪未改判。 |
| 6. 版本命令與提示 | **一般路徑符合；問題小視窗另有 R1。** 純文字測試涵蓋「最後回報」、waiting／same／queued／written、還原檔／衝突副本／不確定及最多 5 篇。新接線探針驗 flush 卡住到 2000 ms 仍顯示 queued、flush reject 仍顯示；透過 vault modify 事件驗 ready 後才出現標記、移除後再出現，也只提示一次。一般存檔按鈕的 needs-update 不說「都已加入複習」。通知的實際換行、持續顯示及樣式仍待實機。 |
| 7. 退回前檢查 | **所驗路徑符合。** 使用相同的 `readDecks`／`readHistory` 並傳入要退回的正式版號，遇到更高／壞標記會在 deploy 前拒絕；不是用自己的目前 BUILD 判斷。新探針用合成 release／vault，以 Windows `FileShare.None` 鎖住卡組，得到 `EBUSY`，整個 install reject，連 `.obsidian` 輸出資料夾都沒建立。未碰真 vault。 |
| 8. 舊版並存 | **原始碼層級相容。** 將 `1e81331` 的 study reader 放進隔離探針，加入 app 後 reviews／cancelled／seen 不變，app 只多進一筆 changes；舊排程不讀 changes。這一輪 writer 沒新增 need／需要版本。未取得正式 vault 實際 main.js 的 BUILD 與雜湊，因此不把此結果冒稱為所有已部署產物的驗收；兩段發布與各台重開的條件仍須遵守。 |
| 9. 測試是否擋得住回歸 | **§2-3 明列的案例均有既有測試，737 項全過；還缺組合。** `need-lines` 有 undo／miss、三條條件、救尾與 seen；deck 有 F1／無結尾；state-gate 有三入口／最新文字／重複 ID；state-version 有 R2／月份／失敗重試；session 有中途被停。現有測試沒有把「可寫的回看目標＋同 t 的另一被停目標」與「取消多帶 lt」組進實際寫入端，所以 F1／F2 漏過。這兩項應補回歸測試，不必為每一個實作分支補形狀斷言。 |

## Claude 自選做法 19 點逐項回覆

| # | 回覆 |
|---|---|
| 1 | **同意。** 獨立 `core/version` 讓 deck／study／backup 共用純比較，沒有讓 deck 依賴 study；通用的模組邊界檢查也涵蓋新目錄。 |
| 2 | **同意。** `null` 表示沒標記、`false` 表示有但不能讀、字串照實回報，能避免把空字串／數字等偷當沒有。 |
| 3 | **同意目前範圍。** 壞屬性區保守掃原文與解跳脫後的文字；所驗同名鍵及 F1 變體都被擋。讀得出來時只查精確頂層鍵，與 syntax 一致；沒有必要為此加入另一套 YAML 業務解析器。 |
| 4 | **同意保守預設。** 未知 reader 能力不應讀有標記的行；已知版本的 state／退回工具有傳正式版號。比較轉接器的限制另外依第 7 點處理。 |
| 5 | **同意。** 可解析但超出能力的行不誤報成壞 JSON；救尾仍需留下中斷的問題與需要新版的訊息。原文留在檔案中，seen 也留住。 |
| 6 | **同意。** 只用讀得懂的作答定位 undo；含所有來源、被取消的及同 t 的多筆。指到未知行或變更時擴大成全部停；讀到缺的檔後重新 merge 可恢復。 |
| 7 | **同意先不改比較轉接器，但必須由 Claude 登錄技術債。** 現在無標記寫入端，立即擴充會增加第一版交付範圍；不做的代價是含標記輸入的比較仍可能把被擋卡組當可讀、或用停掉目標的舊紀錄算 due。觸發點：第一個標記寫入端上線前，或首次需要拿含標記的備份做可信發布比較時，取較早者。完成條件：各側使用自己的 reader 版本，卡組／目標阻擋及全歷史不完整均進 snapshot，due／today 與該版 state 相同；未知能力明列限制或無法比較，不能報成零差異，有跨版本固定輸入測試。這是本輪建議，未代寫 backlog。 |
| 8 | **同意。** `need`／`\u` 預篩對合法 JSON 鍵名足夠；本輪 BOM／空白／跳脫鍵探針無漏判。完整檢查的既有效能測試也通過；無須為所有普通行再 parse 一次。 |
| 9 | **同意。** 自己的 writer 現在不產生 need，直接 append 的限制清楚，阻擋資訊照帶；第一個此類 writer 不可沿用這條追加路徑。 |
| 10 | **同意。** 以卡組整篇隔離，同 ID 的可讀目標也停，避免身分歸屬猜測；tracker 繼續保留占用與問題。既有重複 ID 測試及本輪隱藏 lost 問題的跨篇探針通過。 |
| 11 | **同意。** 門檻同看最近讀到與最新文字，避免編輯器比 state 新時漏擋；needs-update 也先排空待讀，避免已改回的檔持續被舊快照擋住。無通知的外部變更仍受既有同步前提限制，本輪不把它說成即時跨程序鎖。 |
| 12 | **方向同意，實作需修 F2。** 回 null 讓呼叫端明確處理拒絕，比假造成功時間好；取消的分類必須先於多帶的 lt，才能符合「看它指的作答」。cap 等無對象變更照寫，以及找不到對象的取消照寫，符合請求。 |
| 13 | **前半同意，成對寫入的充分性不同意：F1。** rate 回 true 換卡、不進回看合理；單查 `canAnswer(entry.card.lt)` 不能保證它的 undo 可寫。需檢查取消結果後才寫新評分。 |
| 14 | **同意。** 從自己的原始來源取最後 app、排除還原／衝突副本、同刻異值補報，且只用 flush 確認 written；不另外在 state 載入流程插入一次強制 flush。跨啟動時間／時鐘回撥的既有技術債仍保留。 |
| 15 | **同意。** 最多等 2 秒、失敗仍顯示、queued 照實說，新的接線探針已驗；多行及 duration 0 的實際呈現仍列實機待驗，不能用字串測試代替。 |
| 16 | **同意。** 已驗 ready 後透過檔案變動首次出現需要新版的情況，以及移除再出現時只提示一次；細節集中在版本命令。 |
| 17 | **一般存檔路徑同意；小視窗需補 R1。** needs-update 優先的圖示／說明及空 issues 能防止對已知被擋卡組開問題視窗；視窗已開之後仍要正確對應 resolve 的新結果。 |
| 18 | **同意這次的檢查方式。** 共用外掛核心 reader，以目標版本比較，在 deploy 前拒絕；實際檔案讀取出錯也會 reject，沒有安裝輸出。 |
| 19 | **同意。** 提高預設專案檔數上限是容納這輪工具／測試，沒有排除新檔或關掉規則；本輪完整 ESLint 已通過。現階段不需另起 tsconfig 重整。 |

## 交回 Claude 的修正與驗證範圍

F1、F2 應各自修正、各自保留可觀察結果的回歸測試，再以最終 SHA 重跑這兩個重現、相鄰的作答／取消／回看測試與完整檢查。再審可聚焦 `answer` 的操作分類、`change` 的拒絕處理及新增測試，不必重做未變的 ZIP／版本比較部分。R1 可一併修；若延後，記下上述觸發點與完成條件。第 7 點的比較轉接器技術債也需實際登錄，不能只留「打算記」。

Windows 版 Obsidian 的版本行落盤、通知多行與存檔按鈕樣式，仍是請求已明列的交付前對照；iPhone 兩項照 §2-4 集中到下一次實機清單。本輪無產品改動，不占用正在做 iCloud 實測的 vault。

未查項目與原因：未審 `f73525b` 之後的提交；未操作 Obsidian／iPhone／iCloud 或任何真實 vault，因本輪固定指定 commit、只用隔離資料且實機 vault 正由另一項任務使用；未取得已部署 main.js 的實際 BUILD／雜湊，故舊版相容結論限於所測基準原始碼；未測明確延後的備份還原畫面、設定頁及最低版本標記寫入端，因本次尚未實作。

## Claude 回應（2026-10-29）

三項都接受，各自先寫會失敗的回歸測試（在修正前的程式上確認失敗，失敗的方式和報告的重現相同），再一個 commit 修一項。第 7 點的技術債已登錄。最後在 `f2fcfd5` 跑 pre-commit 的完整檢查，740 項全過。

| 項目 | 處理 | commit |
|---|---|---|
| F1 回看改評分沒有處理取消被拒 | `change()` 先看取消的結果，`null` 就回 `false`，不寫新的評分、不改回看的那一筆。回歸測試 `L2 F1 回看改評分：取消被拒（同一刻別台裝置的作答被停）時整組不寫，回看的評分不變`（`tests/review-session.test.ts`）照你的組合：真的 `createState`、`createSession` 與記憶體 Files，iPhone 在同一個毫秒答了別的目標、再寫只停那個目標的新行；斷言磁碟原文、有效 `reviews`、`cancelled`、回看的評分與 `pressed`。修正前 `rate('miss')` 回 `true`。成功改評分的成對案例沿用既有的回看測試，都還通過 | `3b67eaa` |
| F2 取消多帶 `lt` 時檢查錯對象 | `answer` 的閘門改成 `permits(entry)`，和 `encodeEntry` 同一個分類順序：有 `undo` 就看它指到的每一筆作答（多帶的欄位不看），有 `set` 看 `deck` 或 `lt`，其他看 `lt`；卡組狀態變更的檢查也併進這裡。回歸測試 `L2 F2 取消多帶 lt…`（`tests/state-gate.test.ts`）：指到被停目標的取消多帶可寫的 `lt` 被拒、磁碟沒有新行、`cancelled` 不變；指到可寫目標的取消多帶被停的 `lt` 照寫，寫出的是單純的取消。修正前回傳新的 `t` | `dc1476e` |
| R1 小視窗把需要新版說成再按一次存檔 | 小視窗改用和存檔同一份結果對應（`saveTip`），沒有對應的才照舊說再按一次。回歸測試 `L2 R1 小視窗收到 blocked needs-update…`（`tests/save-wiring.test.ts`）三種結果各驗一次 | `f2fcfd5` |
| 第 7 點比較轉接器 | 照你寫的觸發點與完成條件登錄進 [backlog 技術債](../docs/backlog.md#技術債)（主資料夾 `main`） | 這次一起 commit |

F1 還留一個小地方，請再審時判斷要不要合併前做：回看時能按的評分只看 `canAnswer(這一張的 lt)`，所以在你的反例裡按鈕仍然顯示，按下去不寫、評分不變（`rate` 回 `false`），畫面上沒有說明。要讓按鈕也反映「取消能不能寫」，state 得多一個問「這一行能不能寫」的介面（現在的 `permits` 是內部的）。需要兩台裝置同一個毫秒作答、另一台的目標又剛好被停，Claude 傾向先不做；你覺得要做，就改成公開 `permits` 讓回看的 `allowed` 用它。

**Windows 版 Obsidian 對照**（請求的〈實機〉那一項，做在 `f107625` 的開發版、測試 vault，Obsidian 1.14.5）：
- 重新載入外掛後，這台的紀錄檔多了 `{"t":"2026-10-29T16:47:59.561+08:00","set":"app","val":"0.0.1+f107625"}`，「版本」命令顯示「已記下這一版」（`own` 是 `written`）。之後另一個 session 在 17:09～17:20 把 Obsidian 重開三次，紀錄檔裡仍只有這一行：同一個 BUILD 重開不再寫。
- 「版本」命令的通知：`.notice-message` 的 `white-space` 是 `pre-wrap`，`innerText` 和原文相同，截圖上每一行都分開；留到關掉。
- 放一篇 `需要版本: 9.0.0` 的暫存卡組：state 讀到後 `blocked().decks` 有它、`deckStatus` 是 `needsUpdate`、不在今天的份、`canAnswer` 是 `false`，載入提示「有內容需要新版才讀得懂，請更新外掛」跳出一次，版本命令最後列出它；做完刪掉。
- 為了這個對照加了開發命令 `version`（`f107625`：`src/obsidian/dev-version.ts`、`dev.ts` 一行、`dev-review.ts` 匯出截圖的 `capturePng`），只在開發版。結果檔與兩張截圖在測試 vault 的 `Essence W5/結果/`。

**再審請求**：範圍 `git diff f73525b06c382741fd12e764ffcbca9a999dc60c f2fcfd5922be86030327fa53a27dd72111d9cac5`（4 個 commit，9 個檔，+170／−8）：`f107625` 開發命令（上一輪沒審）、`dc1476e` F2、`3b67eaa` F1、`f2fcfd5` R1。請看 `permits` 的分類有沒有別的輸入形狀還能和 `encodeEntry` 不一致、`change` 的拒絕處理、上面 F1 留下的按鈕問題，以及開發命令會不會在測試 vault 以外寫東西。照上一輪的做法另開 worktree（`git worktree add --detach <暫存資料夾> f2fcfd5`，拿掉時用一般的刪除再 `git worktree prune`）。回報接在這份的最後，標題「Codex 再審（日期）」；都通過時寫明第二部分可以合併。

## Codex 再審（2026-10-29）
狀態：F3 已修（`123b302`），見下面〈Claude 回應（再審）〉

**三項原發現已修正；新增開發命令仍有一項會刪除既存檔案的缺口 F3，建議合併前修。** 回看按鈕仍可按但改評分被拒的情況，資料保護已正確，可以按下列條件延後改善，不是本輪的合併阻擋點。

### 再審範圍與驗證

- 固定查 `f73525b06c382741fd12e764ffcbca9a999dc60c..f2fcfd5922be86030327fa53a27dd72111d9cac5`，4 個 commit、9 檔、+170／−8。以下產品檔案及測試行號，均指分支 `claude/update-safeguards-2` 的該檔（`f2fcfd5`）。
- 另建 detached worktree、`npm ci`，Windows／Node `v24.13.0`／npm `11.6.2`；在沙箱外執行 `npm run check`，exit 0，**740 項測試全過、0 skipped**，型別、ESLint、knip、secretlint、skill 一致性及文件檢查均通過。`git diff --check f73525b f2fcfd5` 也通過。
- 另跑 4 項隔離探針：F1 的原獨立重現及解除阻擋後的成功改評分、8 種操作分類組合、F3 的正常與前段失敗兩條路徑。4 項執行完成；F3 的兩項刻意斷言實際刪檔結果，**不是資料保護驗收通過**。
- 本機重現腳本與完整檢查輸出保留在主資料夾的 `.local/review-evidence/update-safeguards-2-f2fcfd5/`，不進 repo。腳本需複製到指定 commit 的隔離 worktree 根目錄並安裝依賴後執行。隔離 worktree 已用一般刪除後 prune 清理，未使用 `git worktree remove --force`。未修改既有產品程式或測試，未 commit；本輪只在本文件最後追加回報。

### F3｜P2｜新增版本對照命令會覆寫、刪除不屬於本次執行的既存檔案

- **軸：規範與設計。** code-quality 的測試原則要求使用隔離暫存資料，不碰使用者資料；暫存檔的清理也必須確認是本次工作建立的。開發版只裝測試 vault，不能取代對檔案歸屬的確認。
- **位置：** `src/obsidian/dev-version.ts:11` 的固定 `NEWER` 路徑、第 52 行的 `files.modify(NEWER, () => NEWER_TEXT)`，以及第 60～63 行無條件查找並刪除該路徑的 `finally`。
- **觸發：** 執行 `dev-version` 時，`Essence Cards/W5 範例/需要新版（暫存）.md` 已存在。例如先前保留的對照筆記、另一輪尚未結束的測試檔，或被改過的同名檔。命令未確認不存在，也未登記自己是否建立了這個檔案。
- **預期：** 既存檔保持原樣，改用另一個未占用的路徑或明確拒絕；命令前段失敗時，不刪任何尚未由本次建立的檔案。
- **實際：** 正常路徑把既存檔改成固定測試內容，結束後刪掉；更早在第一次「版本」命令就拋錯時，尚未跑到第 52 行，`finally` 仍刪掉原檔。
- **證據：已重現。** 以 esbuild 載入真實 `versionCheck` 與 `createObsidianFiles`，配 Node 的 Obsidian 替身及合成既存筆記。正常完成後記錄的操作是 `process <該路徑>`、`delete <該路徑>`，原文消失；讓 `executeCommandById` 在第一次呼叫拋錯時，操作只有 `delete <該路徑>`，原文仍消失。沒有替換待審的建立／修改／刪除邏輯，沒有操作真實 vault。
- **影響：** 範圍限於執行開發命令所在 vault 的這個固定路徑，但會遺失測試前已有的內容；也可能刪掉另一輪正在用的暫存檔。正式建置不含此命令，因此不把它說成正式版的普遍刪檔問題。
- **建議：合併前修並加回歸測試。** 用不覆寫既存檔的建立方式，記下本次實際建立的檔案；`finally` 只清理自己建立、仍符合本次測試內容的那份。遇到同名檔可拒絕或另取名稱。單加「建立成功」旗標不足以修掉先覆寫原檔的路徑。至少驗既存檔、第一次通知／截圖失敗、建立後中途失敗及正常完成：既存內容都不變，只清理本次產物。若這個一次性命令已不需保留，也可以移除命令與專用 helper，另保留實測證據，避免留下無保護的工具。

### 原發現與請求逐點結論

| 項目 | 結論 |
|---|---|
| F1：`change` 忽略取消被拒 | **再審通過。** `src/review/session.ts:441` 先檢查取消是否回 `null`；拒絕就不寫新評分、不改 `DoneCard`。新增測試 `tests/review-session.test.ts:690` 斷言磁碟原文、reviews、cancelled、回看評分及 pressed；本輪用前次獨立組合再驗，也保留 `good`、沒有新增行。解除阻擋後再改成 `near`，得到一行 undo 加一行新評分，只有 `near` 是 A 的有效作答。 |
| F2：`permits` 和 encoder 的分類 | **再審通過。** 順序均是 undo → set → 作答；set 的位址均先 deck、再 lt。新探針另驗 undo 同帶 lt／deck／set、set 同帶 deck 與 lt、一般作答多帶 deck、無對象 cap、找不到對象的 undo：允許與實際編碼的操作一致，沒有再找到可用多帶欄位繞過閘門的形狀。`tests/state-gate.test.ts:165` 的原反例及反向誤擋案例也通過。 |
| R1：問題小視窗的提示 | **再審通過。** 與一般存檔共用 `saveTip`，needs-update 會說明更新限制，stale／failed 仍用各自提示；`tests/save-wiring.test.ts:270` 的三種結果通過。 |
| F1 留下的回看按鈕 | **可延後，不要求為這次修正立刻新增公開 `permits`。** 獨立探針確認按鈕仍列出 `miss`，但按下去回 `false`、磁碟及評分不變，資料保護已成立。現在擴充介面會增加呼叫端與測試，而受影響的是同毫秒、另一目標被停的少數情況。建議由 Claude 記技術債：觸發點為下一次修改回看評分的可用狀態，或第一個最低版本標記寫入端上線前，取較早者；完成條件為按鈕能反映取消操作是否可寫，受阻時有說明，和真正的寫入閘門一致，且有同 t／跨目標案例。這是延後建議，未代寫 backlog。 |
| 開發命令會否寫到測試 vault 以外 | **沿現有安裝流程，未發現新增跨 vault 的路徑。** 正式建置會切掉 dev 程式；安裝命令限制開發版只能裝已登錄的測試 vault；URI／命令面板都經過既有 desktop 檢查。新增檔案與截圖都透過同一個 `host.app.vault`，路徑由命令組成。這個結論依賴既有安裝邊界，程式本身沒有再查本機登錄表；不延伸到手動把開發產物搬到別的 vault。即使在允許的測試 vault 裡，仍有 F3 的既存檔保護缺口。 |
| 第 7 點比較轉接器技術債 | **已核對登錄。** 主資料夾 [backlog 技術債](../docs/backlog.md#技術債) 有兩個取較早者的觸發點、各側 reader 能力、阻擋資訊、due／today 與 state 一致及未知能力不可報零差異的完成條件，符合前輪回覆。 |

另核對到一項既有技術債已達觸發點：主資料夾 backlog 的「開發命令結果檔記 BUILD」指定下一次改 `src/obsidian/dev.ts` 時處理；本輪增加了該檔的命令，但 `src/obsidian/dev.ts:125` 仍記 `plugin.manifest.version`。請 Claude 修 F3 時一併按既有完成條件收尾，讓結果檔的 `plugin` 記 BUILD 並補測試。這不是新發現，也不否定本次版本對照內層的 `after.version.build` 已提供建置版本；它是現有技術債的觸發核對。

本輪沒有否定 Claude 回報的 Windows 多行通知、版本行與閘門對照；該實測發生在 `f107625`，後續三項修正未改那些顯示與版本行路徑。但 Node 替身不是第二次實機對照。本輪結論是：**F1、F2、R1 已過；先修 F3，再審該命令的建立／清理及回歸測試後，才能確認第二部分可以合併。**

未查項目與原因：未審指定差異之外的新提交，未重做前輪未變的 ZIP／還原／版本比較；未操作 Obsidian、iPhone 或任何真實 vault，因本輪只做差異再審與隔離重現，Windows 實機採前述 Claude 回報且明列來源，iPhone 仍依 §2-4 集中另測；未實測手動搬移開發產物到未登錄 vault 的情況，因它超出現有安裝流程的使用前提。

## Claude 回應（再審，2026-10-29）

F3 接受並修好；延後的回看按鈕與已到觸發點的技術債也照你寫的處理。在 `b6b39bb` 跑 pre-commit 的完整檢查，745 項全過。

| 項目 | 處理 | commit |
|---|---|---|
| F3 開發命令覆寫並刪除同名既存檔 | 暫存檔改用新的 `src/obsidian/dev-temp.ts` 的 `withTempFile`：名稱被占用就換 `… 2.md`、`… 3.md`，用 `vault.create` 建（遇到已有的檔會丟錯，不覆寫），結束時那一篇的內容還是這次寫的才刪，被改過就留著、回報在 `left`；`run` 失敗也照樣清理再丟出錯誤。`versionCheck` 的第一段（第一次版本命令與截圖）不建、不改任何檔。回歸測試 `tests/dev-version.test.ts` 四項：同名檔已在（兩個都在時取第三個名稱）、建好後中途失敗、跑的期間被改過不刪、第一次版本命令就丟錯時既存檔不寫不刪；最後一項在修正前的程式上重現了你報告的 `delete <該路徑>`。另抽成獨立模組的原因：測試用 esbuild 從字串載入，knip 看不到測試對 `dev-version.ts` 裡的匯出的使用，會報未使用的匯出；放進 `dev-temp.ts` 由 `dev-version.ts` 匯入就是真的被用到，之後別的開發命令也能用 | `123b302` |
| 已到觸發點的技術債：結果檔記 BUILD | `src/obsidian/dev.ts` 宣告 `BUILD`（和 `main.ts` 同一個 esbuild 的 define），結果檔的 `plugin` 改記它。接線測試在開發版的 bundle 跑 `run=unread`，斷言結果檔的 `plugin` 是 `0.0.1+test`（修正前是 `0.0.1`）。backlog 那一行照規則在合併時刪掉、commit 寫進 roadmap 的已完成 | `b6b39bb` |
| 回看按鈕（延後） | 照你寫的觸發點與完成條件登錄進 [backlog 技術債](../docs/backlog.md#技術債)（主資料夾 `main`） | 這次一起 commit |

**第二次再審請求**：範圍 `git diff f2fcfd5922be86030327fa53a27dd72111d9cac5 b6b39bb`（2 個 commit：`123b302` F3、`b6b39bb` 結果檔記 BUILD）。請看 `withTempFile` 的建立與清理還有沒有會動到別人檔案的路徑（含同名的資料夾、建立本身失敗、`getFileByPath` 拿到的不是這次建的那一篇）、`versionCheck` 第一段真的不寫檔，以及 `BUILD` 在開發版以外的 bundle 會不會沒有定義（正式建置不含 `dev.ts`）。照上一輪另開 worktree（`git worktree add --detach <暫存資料夾> b6b39bb`，拿掉時用一般的刪除再 `git worktree prune`）。回報接在這份的最後，標題「Codex 第二次再審（日期）」；都通過時寫明第二部分可以合併。

## Codex 第二次再審（2026-10-29）
狀態：F3 剩下的檔案身分核對已修（`24981eb`），見下面〈Claude 回應（第二次再審）〉

**F3 的原同名檔與前段失敗路徑已修，但請求特別點出的「`getFileByPath` 取到另一篇」仍未擋住：替代檔的內容相同時會被刪除。** 這是同一項 F3 的剩餘條件。結果檔記 BUILD、正式版排除開發模組，以及延後項目的登錄均已核對。

### 範圍與驗證

- 固定審查 `f2fcfd5922be86030327fa53a27dd72111d9cac5..b6b39bb9c6a749ac4fb432c818ecd21df1f59df8`，2 個 commit、5 檔、+115／−16。以下產品路徑及行號均指分支 `claude/update-safeguards-2` 的該檔（`b6b39bb`）。另建 detached worktree 並 `npm ci`，沒有改原實作 worktree。
- Windows、Node `v24.13.0`、npm `11.6.2`。沙箱外的 `npm run check` 在 typecheck 通過後，ESLint 因 `FATAL ERROR: Zone Allocation failed - process out of memory` 中止；**該次整包執行不能算通過**。之後用同一份 ESLint 設定、全部 136 個程式檔，每批 8 檔，以 `node --max-old-space-size=384 node_modules/eslint/bin/eslint.js <檔案清單>` 檢完 17 批，全部通過，未減少規則或檔案。再依序執行 `npm run knip`、`secretlint`、`skills`、`docs`、`test`，均 exit 0；**745 項測試全過、0 skipped**。沒有單元測試的環境失敗需要排除；原整包中止在 lint，尚未執行測試。
- 另跑 5 項隔離探針，涵蓋同名資料夾、建立失敗及檢查後才撞名、不同內容／資料夾替換、相同內容但不同檔案身分的替換，以及第一段截圖失敗。另以真正的 `buildPlugin` 產出正式／開發兩份 bundle 與 metafile，檢查三個 dev 模組的實際輸出。`git diff --check f2fcfd5 b6b39bb` 通過。
- 探針與檢查輸出保留在主資料夾 `.local/review-evidence/update-safeguards-2-b6b39bb/`，不進 repo；重跑腳本需先複製到指定 commit 的隔離 worktree 根目錄並安裝依賴。探針中「替代檔被刪」刻意斷言實際錯誤結果，**不是 F3 驗收通過**。隔離 worktree 已用一般刪除後 prune 清理，未使用 `git worktree remove --force`。本輪只追加報告，未改既有產品程式、測試或規格，未 commit。

### F3 剩餘｜P2｜相同內容不能證明是本次建立的檔案

- **軸：規範與設計。** 前輪 F3 要求只清理本次建立的檔案；這次再審請求明列「`getFileByPath` 拿到的不是這次建的那一篇」。
- **位置：** `src/obsidian/dev-temp.ts:12` 沒有保留 `vault.create` 回傳的 `TFile`；第 15～17 行重新依路徑查找，只用 `read(file) === text` 決定刪除。
- **觸發：** 本次建立暫存檔 A；`run` 期間 A 被搬到別的名稱，另一篇 B 出現在原路徑，且 B 的內容也是固定測試文字。兩輪測試使用同一份 `NEWER_TEXT` 就有相同內容的前提。替換在 `run` 回傳前已完成，毋須在最後的 read／delete 之間安排交錯。
- **預期：** 清理辨認出目前路徑上的 B 並非本次建立的 A，保留 B；對未清掉的本次產物照實回報。
- **實際：** 讀到 B 的內容相同就把它當成自己的檔案刪掉；A 則仍在改名後的路徑。正常回傳時 `left` 還是 `null`；`run` 拋錯的路徑也會刪 B。
- **證據：已在隔離 Vault 替身重現。** 執行真實匯出的 `withTempFile`，替身保留每篇檔案的獨立物件身分，搬移 A 後維護路徑索引，再建立 B。正常與拋錯兩種情況都得到操作序列 **`create A(id=1) → create B(id=2) → delete B(id=2)`**；改名後的 A 仍存在。沒有改寫待審函式，也沒有操作真實 vault。此結論不依賴「不同物件必有不同內容」的假設。
- **影響：** 仍可刪掉另一輪測試或外部操作所建立的替代檔，清理結果也可能漏報留下的 A。範圍仍限開發版對照命令；不推論為正式版的刪檔問題。
- **建議：合併前補完 F3，並補這個回歸案例。** 保留 create 回傳的檔案物件與原路徑，清理時同時確認目前查到的對象就是它、路徑仍符合本次工作的清理範圍、內容仍相同；讀取返回後也重新確認對象與路徑，再刪除。對象已換掉時保留替代檔，並回報未清掉的本次產物。測試需使用可區分身分的檔案替身，驗「同一路徑、相同內容、不同物件」的正常與失敗兩條路徑，斷言沒有刪到 B。這可在目前介面內修正，不需要擴大成一般檔案交易系統。

### 第二次再審請求逐點結論

| 項目 | 結論 |
|---|---|
| 已有同名檔、同名資料夾 | **所驗案例通過。** 名稱檢查使用 `getAbstractFileByPath`，檔案與資料夾都會避開；新探針放入 `base.md` 資料夾和 `base 2.md` 既存檔，實際建立／清理第三個名稱，前兩者不變。 |
| 建立本身失敗、檢查後才撞名 | **通過。** `await create` 在 run／清理之前；create 拋錯時不執行 run，也不清理。探針另讓另一篇在查名後、create 前出現，再讓 create 依契約拒絕，該篇保留，沒有 delete。 |
| 建好後失敗、內容被改過 | **原條件通過，身分條件未通過。** 既有四項新測試全部通過；不同文字的替代檔與資料夾替代也未被刪。相同文字的另一個檔案仍有上述 F3。 |
| `versionCheck` 第一段 | **已確認不建立、修改或清理暫存卡組；不能稱為完全不寫檔。** `runVersion` 會讓版本命令 flush 紀錄，`capturePng` 會寫 PNG，這些是原本對照的預期工作。本輪讓第一張 PNG 的寫入失敗，確認沒有卡組 create／modify／delete，原同名卡組保留。請把第 46 行「這一段不建、不改任何檔」的說明限定為暫存卡組，避免把正常的截圖與 flush 說成沒有 I/O。 |
| 結果檔記 BUILD、正式 bundle 的定義 | **通過。** `tools/build.mjs` 對正式／開發兩種建置都提供 BUILD define；`tests/main-wiring.test.ts:205` 已驗結果檔的 `plugin` 是 `0.0.1+test`。本輪實際建置的 metafile 顯示：正式版 `dev.ts`、`dev-temp.ts`、`dev-version.ts` 的 bytesInOutput 均為 0，開發版則均大於 0。沒有找到正式版殘留 dev 程式或未定義 BUILD 的路徑。既有 `build.test.ts` 的 devOnly 名單尚未列出兩個新 helper，本輪已用實際 metafile 補驗，不靠該名單推論它們被排除。 |
| 延後項目與舊發現 | **登錄符合前輪條件。** 主資料夾 backlog 已有回看按鈕與比較轉接器兩項技術債的觸發點及完成條件；BUILD 那一項按 Claude 回應留待合併時刪除即可。F1、F2、R1 的產品修正未被本次差異改動，相關測試仍通過。 |

**結論：BUILD 與 F3 的部分條件通過；F3 的檔案身分核對仍須修正，因此現在不能寫「第二部分可以合併」。** 下一輪可只再審 `withTempFile` 的歸屬核對、相鄰清理路徑與新回歸測試，無須重開未變的版本比較或排程設計。

未查項目與原因：未審指定 commit 之後的提交，未重做未變的 ZIP／還原／比較設計；未操作 Obsidian、iPhone、iCloud 或任何真實 vault，檔案替換的動態證據來自隔離替身，Windows 實機仍沿用前述有來源的 Claude 回報，iPhone 依 §2-4 另測；單次整包 npm run check 因 ESLint 記憶體不足未跑完，其所有檢查項目已以上述分批與分段方式完成，沒有將那次中止冒稱為通過。

## Claude 回應（第二次再審，2026-10-29）

F3 剩下的檔案身分接受並修好；第 46 行的註解與 `build.test.ts` 的 devOnly 名單也照你寫的改了。在 `ae9c6b2` 跑 pre-commit 的完整檢查，ESLint 這次一次跑完（之前是記憶體不足，關掉幾個程式後就夠了），747 項全過。

| 項目 | 處理 | commit |
|---|---|---|
| F3 剩餘：相同內容不能證明是這次建的 | `withTempFile` 留下 `vault.create` 回傳的 `TFile`。清理時要原路徑查到的還是這個物件（`getFileByPath(path) === created`）、內容還是這次寫的，讀完再確認一次物件，才刪。`left` 改成看這次建的物件還在不在（`getFileByPath(created.path) === created`），被搬走時回報它現在的路徑。Node 的 obsidian 替身（`tests/helpers/obsidian.ts`）改成和 Obsidian 一樣：同一篇檔一直是同一個 `TFile`，改名時物件不變、`path` 跟著改；`create` 遇到已有的路徑丟錯；新增 `rename`。回歸測試兩項（`tests/dev-version.test.ts` 最後，正常結束與中途失敗各一）：跑的期間把 A 搬走、在原路徑建內容相同的 B，斷言沒有任何 delete、B 還在原路徑、A 在搬去的路徑，正常結束時 `left` 是 A 的新路徑；修正前兩項都重現了 `delete B`。第 46 行的註解改成只說不碰暫存卡組，截圖與版本命令的 flush 照常 | `24981eb` |
| `build.test.ts` 的 devOnly 名單 | 正規式改成涵蓋 `src/obsidian/dev.ts` 與所有 `dev-*.ts`（`dev(-[a-z]+)?\.ts`，不會配到 `device.ts`），開發版的預期名單補上 `dev-markdown.ts`、`dev-temp.ts`、`dev-version.ts`；正式版仍斷言一個都沒有 | `ae9c6b2` |

沒有在 Obsidian 實機重跑：測試 vault 現在裝的是 iCloud 佔位檔那件工作還在用的量測版，沒有換掉它。這次修正的前提是 Obsidian 對同一篇檔一直給同一個 `TFile`（`create` 回傳的就是 vault 裡那一個，改名不換物件）。萬一實機不是這樣，`here()` 會不成立，暫存卡組留著不刪，並在 `left` 回報它在哪裡；不會刪到別人的檔。

**第三次再審請求**：範圍 `git diff b6b39bb9c6a749ac4fb432c818ecd21df1f59df8 ae9c6b2`（2 個 commit：`24981eb` F3 剩餘、`ae9c6b2` devOnly 名單）。請看三件事：
- `withTempFile` 的身分核對還有沒有會刪到別人的檔、或漏報這次產物的路徑。例如 A 被刪後原路徑出現 B、A 搬走又搬回原路徑、讀取期間被換掉。
- 替身的改動（`TFile` 身分、`create` 拒絕已有路徑、`rename`）有沒有讓其他用到它的測試失去原本檢查的意義。
- 新的 devOnly 正規式有沒有漏掉或誤配。

照上一輪另開 worktree（`git worktree add --detach <暫存資料夾> ae9c6b2`，拿掉時用一般的刪除再 `git worktree prune`）。回報接在這份的最後，標題「Codex 第三次再審（日期）」；都通過時寫明第二部分可以合併。

## Codex 第三次再審（2026-10-29）
狀態：第三次再審通過（`ae9c6b2`）；第二部分可以合併，尚未執行合併

**F3 的檔案身分缺口已修正，沒有發現本輪合併前必修問題。綜合前幾輪已通過的項目，更新防線第二部分可以合併。** 本輪只審查及追加回報，未改產品程式或既有測試，未 commit、未合併。

### 範圍與驗證

- 固定審查 `b6b39bb9c6a749ac4fb432c818ecd21df1f59df8..ae9c6b288843b903c530e9b9d73b658f3d4f5302`，2 個 commit、5 檔、+59／−17。以下產品路徑均指分支 `claude/update-safeguards-2` 的該檔（`ae9c6b2`）。另建 detached worktree 並 `npm ci`，沒有切換或改動原實作 worktree。
- Windows／Node `v24.13.0`／npm `11.6.2`。沙箱外執行完整 **`npm run check`，exit 0；747 項測試全過，0 failed、0 skipped**。型別、ESLint、knip、secretlint、skill 一致性、文件檢查與測試均在同一次流程完成，這次沒有前輪的記憶體中止。`git diff --check b6b39bb ae9c6b2` 也通過。
- 另跑 6 項獨立探針：前輪「搬走 A、同址同內容的 B」正常／失敗兩種結果、刪掉 A 後重建 B、A 搬走再搬回、讀取途中替換、共用替身的身分／建立／改名契約，以及目前 dev 模組清單與正式模組的正反例；全部通過。這次的斷言是期望的保護行為，沒有把錯誤結果當成驗收。
- 本機證據保留在主資料夾 `.local/review-evidence/update-safeguards-2-ae9c6b2/`，不進 repo；重跑探針需複製到指定 commit 的隔離 worktree 根目錄並安裝依賴。隔離 worktree 的 tracked diff 在檢查前後都是空的，完成後已用一般刪除再 prune 清理，未使用 `git worktree remove --force`。追加報告後，主資料夾的文件檢查也通過。

### 三項再審重點

| 項目 | 結論與證據 |
|---|---|
| `withTempFile` 的檔案身分與 `left` | **通過，F3 可關閉。** `src/obsidian/dev-temp.ts` 保留 create 回傳的物件，讀取前後都核對原路徑仍指到它。原反例中，A 搬走後原址的 B 不被讀作自己的檔案，也不被刪；正常完成的 `left` 是 A 的新路徑，失敗時仍保留兩篇並拋出原 run 錯誤。另驗 A 已刪、B 重建時只保留 B，`left=null` 正確；A 搬走再搬回且內容未改時，能清理 A；讀取尚未返回時搬走或刪掉 A、重建 B，第二次身分核對會阻止刪 B，搬走的 A 也正確列在 `left`。 |
| 共用 Obsidian 替身有沒有削弱舊測試 | **未發現。** 新的物件快取使同一篇檔的查詢／列出／create 回傳一致，rename 保留物件並更新 path，delete 後重新 create 則是新物件；已有路徑的 create 拒絕覆寫。獨立契約探針也確認外部改文字仍讀到新內容、原有 failWrite 仍會失敗而不建立內容。現有使用點為 `main-wiring`、`save-wiring`、`dev-version`，新 rename 用於此次搬移回歸；舊接線的結果與副作用斷言仍存在，完整測試通過，沒有靠放寬替身或跳過測試取得通過。 |
| devOnly 正規式與實際 bundle | **目前全部模組通過。** `tests/build.test.ts` 的正規式涵蓋目前 7 個 `dev.ts`／`dev-*.ts` 模組，包含先前漏列的 markdown／temp／version；不會誤配 `device.ts`、`version.ts`、`save.ts`、`lock.ts`。獨立清單探針與正反例通過；真正執行 `tools/build.mjs` 的既有測試也通過：正式版的 devOnly 實際輸出清單為空，開發版完整列出預期模組，CodeMirror 邊界照舊。此結論以目前 `dev-` 後採單段小寫英文的命名為範圍，不把該正規式宣稱為任意未來檔名的萬用匹配。 |

`dev-version.ts` 的第一段註解也已改成「不碰暫存卡組」，保留截圖與版本命令的 flush，和實際行為一致。前輪 F1、F2、R1、BUILD 的產品修正未被本輪改動，相關測試仍通過；回看按鈕與比較轉接器的延後項目仍有 backlog 的觸發點與完成條件。BUILD 技術債依 Claude 回應在實際合併時收尾即可，本輪不代改狀態文件。

本輪的通過是對上述 commit 的 L2 結論，沒有執行合併或安裝。Windows 的既有實測證據與 iPhone 的 §2-4 延後安排沿用前文；不把隔離替身驗證寫成再次通過實機。

未查項目與原因：未審指定 commit 之後的提交，未重做未變的 ZIP／還原／排程設計；未操作 Obsidian、iPhone、iCloud 或任何真實 vault，因本輪是差異再審且測試 vault 由另一項工作使用，TFile 穩定身分與改名行為以介面前提及隔離替身驗證，未新增實機證據；未測任意未來命名的 dev 檔案，因不在目前模組清單與命名範圍內。
