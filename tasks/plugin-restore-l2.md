# 外掛內的還原畫面（Codex L2 審查請求）

狀態：第四輪完成（2026-11-10），使用者決定修 R26 的比對、R25 與 R26 的查連結改規格、R24 與 R27～R29 記技術債，不再送第五輪；等使用者同意合併

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 Codex 對話**；只審查、不改產品程式，可以在隔離環境重現。

[任務說明](plugin-restore.md)會改寫使用者資料（卡組、圖片、`data.json`、新增還原檔），又動 `state` 的寫入閘門與 `Files` 的契約，屬於[高風險範圍](../docs/agents/quality.md#高風險範圍要做-l2)，合併前做 L2。

## 第四輪（2026-11-10）

**這是最後一輪**：這一輪之後還有擋合併的發現，就停下來交給使用者決定（D-171 第 3 點）。請把「擋合併」和「可以記進技術債、合併之後再做」分清楚。

**這一輪只讀**：本節、〈審查對象〉、[報告](../Claude%20Codex%20Discussion/2026-11-10-plugin-restore-l2.md)最後的〈Claude 回應（第三輪）〉與〈第三輪之後改了做法〉，和它們提到的程式。前三輪其他已經過的部分不用重審。

**第三輪回應之後改了做法，規格也改了**（2026-11-10 使用者同意；[任務說明](plugin-restore.md) §3-1 第 6 點的例外）：原本「閘門不論成敗都放開」，改成寫入階段（第一次存檔或換分頁起，到開回分頁）有一步超過 30 秒，就把目前的結果交回畫面，閘門留著關，這次載入不再比對或還原，畫面請家長重新開啟 Obsidian。第三輪回應裡 R19、R21 的修法和〈重整〉的「三種結局」已經不適用，以〈第三輪之後改了做法〉為準。

**待審差異**：`git diff 378bcbbc167c4c53a898af5072d9790ee341355b..fc56c3eed59b2f784f3ee48bf25389dd9f6a8887`（中間的 `2931286`、`3e433bf` 只有文件）。主要在 `src/obsidian/restore.ts`、`src/core/backup/restore.ts`、`src/core/backup/runner.ts`、`src/core/backup/logs.ts`、`src/state/writes.ts`、`src/state/index.ts`、`src/obsidian/restore-modal.ts`、`docs/syntax.md` §5-3 與對應的測試。`src/desktop/backup.ts`、`src/desktop/index.ts` 的 `halt` 已經撤回，淨差異是沒有變。

修正 commit：

- R18：`83f3ac3fd2c6a2a1310b24d71da89c885e9c0975`
- R22：`cb616c03f2ef991fa2ef236862e3327e3946f51b`
- R23：`e588f2fff1b82aaff020428162e62d902a865147`
- R20：`a7e780a169098085276a8f8150a686d69a0b7a58`
- R21：`713e87d618c794ec9119565cfd0188453e482644`，已由 `b7ff36e42810c57cbe0b1665f3048b4b9e6ecbf1` 撤回（接受晚到，見下）
- R19：`fdb2a0afc797114c6645b094e205a5b2a5308f7d`，等它回來的帳已由 `fc56c3eed59b2f784f3ee48bf25389dd9f6a8887` 取代
- 逐次卡住的測試加強：`b61bdda61823fc7bcf7b4b11aa0adaa01c522517`，斷言在 `fc56c3eed59b2f784f3ee48bf25389dd9f6a8887` 改成鎖住

**請看這五題**：

1. 鎖住之後，背景的舊工作、排隊的寫入、設定隊伍，有沒有任何路徑還會開始新的寫入、比對或還原。
2. 從第一次存檔或換分頁開始，每個碰 vault 或編輯器的等待是不是都在碼表內，特別是 `reopen`、設定的 `base`、補紀錄的讀回。
3. 可以放棄的清單（比對、查連結、現況備份）晚到的副作用，是不是真的不碰 vault、不碰編輯器。
4. 鎖住時範圍檔、小考檔的隊伍（`open()`）和 `running` 確實放開，`close()` 走得到 `writer.flush()`，畫面不說「什麼都沒有寫」。
5. 正常路徑沒有退步：R1、R3、R4、R5、R13、R18 的回歸照過。

**分級**：只有已經鎖住之後才走得到的情境，標成不擋合併。R14、R22 那條只確認回歸，不再找新的交錯（機率評估見〈第三輪之後改了做法〉）。延續的話照 D-197 標代數。

**這一輪實作者自己選的做法（請先看）**：

1. **看碼表，不看錯誤文字**：超過 30 秒就鎖，不分成功、失敗。Obsidian 中止時底下的寫入還在路上，`saveData` 還會吞掉錯誤，所以 Promise 結束不算數。寫得慢但成功的也要重開。
2. **立刻失敗（例如 EPERM）不鎖**，照舊重新比對。
3. **鎖住之後設定頁不擋**：設定頁寫的是 `data.json`，隊伍不受閘門管；還原已經不會再碰它。
4. **第一次卡住的那一步才是畫面寫的原因**，後面開回分頁也卡住不覆蓋。
5. **關分頁卡住、之後才變空白時不開回原來那篇**：什麼都還沒寫，也沒有文字會不見，重開 Obsidian 就好。
6. **備份資料夾裡的晚到接受**（R21）：刪的是保留規則本來就要刪的舊備份，或多一份不會記成最後一次的 zip。
7. **設定只有一次「查連結 → 讀」**：查和讀之間換成連結、內容又相同的那一小段沒有擋。
8. **切出來的一段照重播讀不讀得到判斷**，只改有 NUL 的行，沒有 NUL 的行維持第一輪的規則。
9. **月檔含 NUL 整個比對打不開，這次不修**：不會壞資料，記進技術債（[backlog](../docs/backlog.md#技術債)，觸發點「給其他家長用之前」）。

**驗證**：每個 commit 都過完整的 `npm run check`（`fc56c3e` 那次 2,542 個測試全過）。Windows 實機在 `fc56c3e` 重跑過，結果與沒走到的項目在〈第三輪之後改了做法〉。報告接在同一份檔案後面，標題下的狀態行跟著改。

## 第三輪（2026-11-10）

**這一輪只讀**：本節、〈審查對象〉、[報告](../Claude%20Codex%20Discussion/2026-11-10-plugin-restore-l2.md)最後的〈Claude 回應（第二輪）〉，和回應提到的程式。前兩輪其他已經過的部分不用重審。

**待審差異**：`git diff 01743fd45564d40a607937dea5fb1f7f890ea90e..378bcbbc167c4c53a898af5072d9790ee341355b`（中間的 `5b7f1fc` 只有文件）。主要在 `src/core/backup/restore.ts`、`src/core/backup/runner.ts`、`src/core/backup/logs.ts`、`src/core/settings/store.ts`、`src/obsidian/restore.ts`、`src/state/index.ts`、`src/state/reads.ts`、`src/state/writes.ts`、`docs/syntax.md` §5-3 與對應的測試。

修正 commit：

- R14：`234248175e4423579dee9794bde91d7e3fae6a7a`
- R15：`f7c98c4ba7afd2ded740f5c39b0c88691c192f04`
- R16：`09abfd04c5f7c67dd3b3f636314d2b093cf44f56`
- R17：`fbe75ddd6b2b4f68467b9cf3f8aa464206090beb`
- R13：`e1bdd2f7affe3505019f447fe1281bd9c83ebbf0`
- R11、R12：`378bcbbc167c4c53a898af5072d9790ee341355b`（逾時路徑的重整，同一個測試驗兩項）

**請看**：第二輪回應〈重整〉寫的行為與前提有沒有錯；逐一卡住每次 I/O 的測試（`tests/main-wiring.test.ts`）有沒有漏掉哪類等待，例如不經過這些介面的等待、同時卡住兩個的組合。這是 R2、R6 這條鏈的第 3 代檢查，再有延續的話照 D-197 標代數。

**這一輪實作者自己選的做法（請先看）**：

1. **NUL 當斷行，切出來的一段在現在某一行裡就不算缺**（`logs.ts`，`docs/syntax.md` §5-3）：取代第一輪的「去掉 NUL」。
2. **`SettingsStore.restore` 不自己限時**：只由 `landed` 判定，算結果未定。一般的 `change` 維持 10 秒。
3. **起跑前的上限用 `stuckAfter`（30 秒）**：放棄時丟錯，畫面顯示，排著的工作輪到也不做。
4. **放棄的現況備份算 `Cancelled`，不算備份失敗**：不把備份狀態改成失敗、不關住一般寫入。
5. **已送出的 `host.write` 收不回來**：晚回的 zip 留在資料夾，不記成最後一次、不清理，之後由保留期清掉。
6. **`noLinks` 或關分頁卡住時整次停下來**，什麼都還沒寫；查連結的逾時不再逐篇列為擋住。
7. **寫設定前發現連結算「比對之後改過」**，重新比對時畫面會寫出是連結。
8. **`busy` 改成計數**，一個路徑全部的工作結束才放開。

**驗證**：每個 commit 都過完整的 `npm run check`（`378bcbb` 那次 2531 個測試全過）。Windows 實機在 `378bcbb` 重跑過，結果與沒走到的項目在回應的〈實機〉。報告接在同一份檔案後面，標題下的狀態行跟著改。

## 第二輪（2026-11-10）

**這一輪只讀**：本節、〈審查對象〉、[報告](../Claude%20Codex%20Discussion/2026-11-10-plugin-restore-l2.md)最後的〈Claude 回應（第一輪）〉，和回應提到的程式。第一輪的其他段落、已經過的部分不用重審。

**待審差異**：`git diff 08c8e40ad300e446f98f992fc782796b229fada2..01743fd45564d40a607937dea5fb1f7f890ea90e`。主要在 `src/core/backup/restore.ts`、`src/core/backup/plan.ts`、`src/core/backup/logs.ts`、`src/core/backup/runner.ts`、`src/core/settings/store.ts`、`src/core/settings/saved.ts`、`src/obsidian/restore.ts`、`src/state/index.ts`、`src/state/writes.ts`、`src/main.ts`、`tools/build.mjs` 與對應的測試。

修正 commit，一項一個（R2、R6 共用同一條逾時路徑）：

- R5：`9338439539bfedee797e8b6209b9a75d6801266f`（反方向的測試：`01743fd45564d40a607937dea5fb1f7f890ea90e`）
- R3：`added2563194fbd9db20d71205dbe0a3e2841d07`
- R4：`590846f0830fd365f6c8af2a1c7dc843be6e8c70`
- R1：`b0c5aa04d1ad8e686d0e2cef2b6384ef6c7b456c`
- R2、R6：`a50402ccb9f5a5b29a4d1d04571a6c5c5864ece5`
- R7：`4958df2fc1bcbc4a13c1db37fe26ea9dbbc10d19`
- R8：`fa39848f604fb49aa2da7999b44286c3a0754732`
- R9：`3909419e7ee8be2fb4627f7bf59b956f30b8d6d3`
- R10：`fb4845d0606c7fd0ac675244ec877a8461ab9b28`

**請看**：每個修法有沒有真的蓋住回應寫的共同原因，以及修法帶進的新問題（發現鏈照 D-197 標代數）。特別是逾時路徑：`halted`、`landed`、`createUnsettled`、`restoreDeck` 的所有權、`writes.atMost`、`restoreLimit` 之間的交錯。

**這一輪實作者自己選的做法（請先看）**：

1. **備份行的 NUL 去掉再補，只有 NUL 的行不算**（`logs.ts`，記進 `docs/syntax.md` §5-3）：第一輪報告指出的規格衝突，理由在回應的 R3。
2. **現況的卡組或月檔一直含 NUL，比對就一直停著**：訊息請使用者等下載完；一般的筆記一直這樣的話，把檔刪掉就能從備份補回。月檔不建議刪，所以訊息沒有這一句。
3. **任何一個檔逾時，後面的檔、紀錄、設定都不做**（`halted`）：後面的檔可能依賴它；代價是沒有依賴的檔也要重新比對才會做。
4. **已送出和未送出分開**：回呼還沒通過的算確定沒寫，不進 `unsettled`；已送出的才算結果未定。
5. **逾時後閘門照樣放開**，下一輪比對或還原被 `createUnsettled` 擋到回來為止：不讓卡住的寫入關住整個外掛（R6）；代價是那段時間一般寫入可以進行，只有還原被擋。
6. **設定逾時一律算結果未定**：設定隊伍裡排著的寫入拒絕不了。
7. **`beforeRestore` 的整體上限 5 分鐘**（`restoreLimit`）：現況備份在大 vault 上要跑一段時間，不能用讀檔的 30 秒；逾時丟錯、不寫任何檔。
8. **`busy` 只跳過，不替使用者存檔**：還原期間才打開的分頁，結果列請家長關掉再重新比對。
9. **還原期間的通知只補一次**，在閘門放開之後。
10. **「選定學期的日期」一列只在算出來的學期相同時出現**：學期不同時，看學期那一列就夠了。
11. **Mac、Linux 的 `restoreFlow` 是 `null`**，開發命令也走不到。

**驗證**：每個 commit 都過完整的 `npm run check`（`01743fd` 那次 2522 個測試全過）。Windows 實機在 `fb4845d` 重跑過，結果與沒走到的項目在回應的〈實機〉。報告接在同一份檔案後面，標題下的狀態行跟著改。

## 審查對象

- 分支 `claude/competent-driscoll-58f746`（worktree 在 `.claude/worktrees/musing-kowalevski-696591`），工作區乾淨。
- **共同祖先**：`origin/main` 的 `a33c7d5fc136abbe173470c11f1c1f2dfaae7c2f`。整包差異用 `git diff a33c7d5...0452a3b576df1260120d702b1f1762b00257611e`。
- **規格基準**：`1859de7319018958d66b60ebc86fafb8f14f06db`（使用者同意的版本）。之後對規格只動〈狀態〉與〈結果〉（§8 第 1 點的實測也記在〈結果〉）。
- **待審 commit**（第一輪，整包；第二輪的範圍見上一節）：
  - `14522ada4d8c7f02b0e3e8fcc06cf4971e1a9544`：`Files.replace`（§3-3 第 4 點）
  - `259a0c0b64c87c53fcec7a0178771676597c1ba9`：`SettingsStore.restore`（§4）
  - `7ff3cd2fc63f96d92c7f09ff65a23904bb50ad6e`：`applyRestore` 與 `state.restore`（§2、§3、§5、§6）
  - `d2b3d784aef5173c62f4e9c0ce417d91617c2a75`：畫面與接線（§1、§3-2 開著的分頁）
  - `69dfe3533b2d455228bd886611a6d58aaeda5623`：結果列的「設定」、開發命令
  - `0452a3b576df1260120d702b1f1762b00257611e`：從外掛物件走到底的接線測試（只有測試）
  - 這之後只多文件的 commit。

## 規格與優先順序

- 規格：[`tasks/plugin-restore.md`](plugin-restore.md) §1～§8 與〈小選擇〉，驗收是 §7 與〈完成條件〉。
- 依據：[D-150](../docs/decisions.md#d-150-備份與還原) 第 7、8、10 點、[D-148](../docs/decisions.md#d-148-電腦專用的主機接點)、[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 3、7 點、[D-154](../docs/decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測)、[D-157](../docs/decisions.md#d-157-重複的學習目標-id先停家長選)、[D-162](../docs/decisions.md#d-162-更新命令的安裝前備份保留和外掛的備份放同一個資料夾)、[D-195](../docs/decisions.md#d-195-測試分兩類改不回來的做足其餘延後但不漏)。
- 格式：[`docs/syntax.md`](../docs/syntax.md) §5-3、§5-4、§6、§8、§9、§10。規格衝突時列成問題，不挑容易通過的那份。

## 行為與風險

**入口**：`createRestore`（`src/obsidian/restore.ts`，`list`、`compare`、`apply`、`active`）；`planRestore`（`src/core/backup/plan.ts`）；`applyRestore`、`readCurrent`、`tickable`（`src/core/backup/restore.ts`）；`state.restore`（`src/state/index.ts`、`src/state/writes.ts`）；`Files.replace`（`src/obsidian/files.ts`、`tools/node-files.ts`、契約在 `src/dev/files-contract.ts`）；`SettingsStore.restore`（`src/core/settings/store.ts`）；`runner.beforeRestore`；畫面 `src/obsidian/restore-modal.ts`；`src/main.ts` 的 `restoreFlow`、`refuseWhileRestoring`。

**不可破壞的性質**：

- 還原前一定有一份現況備份；那份備份失敗時一個檔都不寫。被蓋掉的內容一定在那份備份裡。
- 比對之後才改過的檔不蓋掉（sha 和畫面當時不同就跳過）。
- 全庫的學習目標 ID 不重複；還原不被當成「弄丟 ID」，不多跳待處理的問題。
- 紀錄只補不刪：只建新的還原檔，不碰任何裝置自己的月檔；中途失敗或外掛停用之後重新比對就是續做，不重複補行；還原後的排程、紀錄重播和那些行本來就在時相同。
- 寫回逐位元相同（圖片、BOM、CRLF、不合法的 UTF-8）。
- `data.json` 寫前重讀，保留不認得的欄位，只有 `saveData` 一條寫入路徑。
- 需要新版的卡組不寫；含 NUL 的不寫。
- 閘門不論成敗都放開。
- 手機不載入還原的程式；Mac、Linux 入口關住。

**已知邊界**：§7 列的都有測試（`tests/plugin-restore.test.ts`、`tests/settings-store.test.ts`、`tests/files-contract.test.ts`、`tests/main-wiring.test.ts`、`tests/build.test.ts`、`tests/backup-desktop.test.ts`）。例子只是起點，請找新的組合，特別是：

- `state.restore` 的時段與 `writes`、範圍檔、小考檔隊伍的交錯：有沒有寫入在閘門關上之後還落到磁碟，或永遠等不到閘門放開。
- 開著的分頁：`view.save()`、換空白、開回之間的「離開」事件（補 ID、草稿）；分頁在這段時間被使用者關掉或切換。
- 計畫 → 現況備份 → 重讀 → 最後確認 → 寫入之間的每個等待點，特別是 `after` 的相依與 ID 釋放順序。
- 還原檔的編號、已存在時換下一個；中途失敗後再比對，補行的判斷（`src/core/backup/logs.ts`）會不會重複或漏掉。
- 還原後的重讀：`tracker.wrote` 的時機；重讀期間的 `onChange` 與舊畫面。
- `data.json` 的欄位比對與 `set:` 紀錄行：一次變更只寫一行，不被還原寫出別的值。

**明確延後**（第 2 類，規格〈第 2 類〉與 [技術債表](../docs/backlog.md#技術債)）：Mac 與 Linux 的檔名規則實測（入口先關住）；還原之後 iPhone 看到還原的卡組與還原檔；幾百個差異檔時的版面。整庫回到某時點、還原 iPhone 還沒同步的資料不做。

## 驗證方式

- `npm run check` 要在沙箱外跑（[quality.md](../docs/agents/quality.md)）；每個 commit 的 pre-commit 都跑過完整的 `npm run check`，通過（`0452a3b` 那次 2,493 個測試全過）。
- 單檔：`node --test --test-timeout=60000 tests/plugin-restore.test.ts`。
- Windows 實機（§8）的結果在[任務說明〈結果〉](plugin-restore.md#結果)：走過 iCloud 資料夾裡的測試 vault，Obsidian 1.15.0；裝的建置除了版本字串，和 `0452a3b` 的開發建置逐字相同。
- 沒跑：iPhone、Mac、Linux、雙機同步；「先備份現況失敗」的畫面與「未存的文字先存下來」只有單元測試與 API 探測，實機沒有完整走一次。

## 實作者自己選的做法（請先看）

1. **讀備份與現況的逾時是 30 秒**（`READ_WAIT`）：規格只說讀不到要講清楚。iCloud 佔位檔下載不回來時不讓畫面一直轉；逾時算讀不到，整個比對不出計畫。
2. **含 NUL 的卡組擋住；紀錄裡含 NUL 的行不算缺、不補**（`plan.ts`、`logs.ts`）：規格沒寫。NUL 是沒下載完的內容（D-154 第 4 點），卡組還原了也讀不回來，紀錄寫進還原檔會讓整個檔變成讀不到。
3. **閘門關著時排隊的寫入輪到時回受阻**，正在跑的那一份做完才開始還原（`writes.enqueue` 的 `blockedNow`，§3-2）；範圍檔、小考檔的隊伍排在還原後面。
4. **開著的分頁用 `getLeavesOfType('markdown')` 找**，只處理已載入的（`view` 是 `MarkdownView`）：實測 `iterateAllLeaves` 漏背景分頁；延後載入的分頁還沒讀檔，也沒有未存內容。
5. **ID 衝突只在勾了之後顯示**：`planRestore` 的基準是「什麼都沒勾」，衝突取決於勾了哪些；每次勾選重算。沒勾的不會先出現在擋住區。
6. **被擋住的勾選仍交給 `apply`**（`start()` 傳 `new Set(this.chosen)`）：這樣結果列得出「擋住」與原因，不會默默少一篇；寫不寫由閘門內重新算的計畫決定。
7. **閘門內重掃路徑上的連結**：比對時掃過一次（畫面用），寫之前再掃一次，檔案可能在這段時間被換成連結。
8. **還原用 raw `files`（內含 `pause`）配 `displaced` 擋住**：系統資料夾不在原位的目標在計畫時擋住，不在 `Files` 再加一層判斷。
9. **外掛物件的設定 `store` 改成公開欄位**（`src/main.ts`）：只給開發命令 `restore` 用（`RestoreDevHost`，正式建置時 DEV 段落整段拿掉）。
10. **開著的分頁存檔失敗時，整次還原停下來、什麼都不寫**（`stopped` 寫「存檔 <檔名>」）：規格只寫先存；存不進去時換成空白分頁會丟掉未存內容。
11. **開發命令 `restore`**（`src/obsidian/dev-restore.ts`）：`do=status|cap|check|run`，給 §8 實機用；參數名避開 Obsidian 保留的 `path`、`name`、`vault`、`file`。

## 回報與權限

只審查，不改產品程式；可以在隔離環境重現。每項發現寫觸發條件、預期／實際、影響、位置與證據，並區分「已重現」「靜態推斷」「待驗證」；另標**真實路徑會不會發生**。報告寫在**這個 worktree** 的 `Claude Codex Discussion/2026-11-10-plugin-restore-l2.md`，標題下第一行寫狀態。發現鏈照 [D-197](../docs/decisions.md#d-197-同一條發現鏈到第-3-代先重整換模型時重驗依舊行為寫的規則) 標代數。
