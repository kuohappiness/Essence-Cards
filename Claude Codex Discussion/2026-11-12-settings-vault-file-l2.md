# 設定換到 vault 裡的一般檔｜Codex L2 審查

狀態：第一輪的 R1～R5 已修，等第二輪（2026-11-13）。Codex 原本寫：建議先處理 R1～R5，再就修正及受影響的路徑做 L2。

- 審查對象為 `claude/settings-vault-file` 的 `79b59226446ece67b2f51fa325a1e162cf23226c`。依審查請求以 `9b2c1338e28d2f43fa2491eb01b77ed41aafa545` 為差異起點，審查前工作樹乾淨。本機當下的 `git merge-base main HEAD` 是 `081a67a799e1545e7e34532096540fb1234ff40e`。兩個起點之間只有文件與協作規則的變更，本次沿用請求指定範圍。
- 對照任務 §1～§6、D-201、D-104／149／150、syntax §8／§10、原設定與還原規格。檢視設定讀寫、Obsidian 事件與觀察行、備份與還原、CLI、更新及版本比較。舊版以 `v0.4.0` 指到的 commit `2fd72d4d71a02492bf836dda36fd65ac14b334ca` 為準。見 [審查請求](../tasks/settings-vault-file-l2.md)、[任務規格](../tasks/settings-vault-file.md)、[D-201](../docs/decisions.md#d-201-設定改存-vault-裡的一般檔電腦不再寫-datajson)。

## R1（P2）執行中失去設定檔，排程仍把本機備用值標成已知

**規格｜store 已重現，觀察行影響為靜態推斷。** 先正常載入上限 45，再刪除設定檔並重讀。預期保留 45 排程、`known:false`、暫停四種設定的觀察。實際保留 45 且出現缺檔提示，`known` 仍為 `true`。`load()` 回 `undefined`，store 的 `refresh()` 只呼叫 `announce()`，保留舊的 `known`。設定值不變也不會通知 state。之後正常的觀察路徑仍會帶入設定值，例如跨換日時 `fresh() → observe() → observations()`，若跨學期，可能補記 `semester`。測試已有「這次見過、之後不見」，只斷言值與提示。見 [任務 §3](../tasks/settings-vault-file.md#3-設定檔不見時)、[設定檔讀取](../src/core/settings/file.ts#L143)、[store 採用及重讀](../src/core/settings/store.ts#L113)、[外掛監看及接線](../src/main.ts#L557)、[觀察行閘門](../src/state/index.ts#L479)、[換日觀察](../src/state/index.ts#L682)、[現有測試](../tests/settings-file.test.ts#L331)。

**真實路徑。** 使用者把檔案刪除或改名就能觸發，Obsidian 的刪除及改名事件會通知該路徑。iCloud 真把新路徑改名仍待實機驗證。另以內容 `{` 重讀，實際同樣保留 `known:true`，而且缺檔提示為 false。任務 §1、§3 區分內容無效與路徑不存在，D-201 第 5 點及末段則把整份讀不懂也納入保護。合併前應確認兩種狀態的提示與觀察行規則，並保留「重新建立」只在缺檔時能寫的限制。補同次執行內「有效 → 不可用 → 有效」的接線測試。見 [監看事件](../src/obsidian/files.ts#L133)、[設定頁提示](../src/obsidian/settings.ts#L140)、[D-201 第 5 點及代價](../docs/decisions.md#d-201-設定改存-vault-裡的一般檔電腦不再寫-datajson)。

## R2（P2）重新建立可能覆蓋剛同步回來的設定檔

**規格｜重新建立已重現，外掛還原為靜態推斷。** 本機確認值為 45，按「重新建立」，store 輪到時讀到缺檔。令上限 75 的設定檔在之後的 `loadData()` 等待中出現。預期保留 75、回 `changed`。實際回 `saved`，把 75 覆蓋成 45。呼叫鏈為 `recreate → store.restore(base) → save → await loadData → Files.modify`。最後的 `edit` 忽略實際內容與 `exists`，而 Obsidian adapter 看見檔案已在時會走 `vault.process` 覆寫。外掛還原也有同一缺口。它在檢查目標雜湊後還會讀舊檔並經 `save()` 再讀一次，中途到達的目標內容可被舊底稿覆蓋，包含應保留的未知欄位。讀回核對只會確認最後寫入的結果。見 [任務 §3、§4](../tasks/settings-vault-file.md#3-設定檔不見時)、[重新建立及寫入](../src/core/settings/file.ts#L163)、[store 還原](../src/core/settings/store.ts#L187)、[Obsidian 寫入](../src/obsidian/files.ts#L90)、[外掛還原核對](../src/obsidian/restore.ts#L242)。

**真實路徑。** 同步可以在按下按鈕後把設定檔送回，也可以在還原等 I/O 時送入另一台新版的有效設定，不需要修改格式或混用舊版。實際 iCloud 的交錯待驗。這是「重新建立」與「還原」明訂的寫前保證。建議在檔案實際寫入處重驗不存在或原內容，並補確認後才到檔的回歸案例。

## R3（P2）CLI 還原採用過期的舊檔基準，卻回報已還原

**規格｜在 Windows 隔離目錄以 `makePlan → applyPlan` 已重現。延續格式查核第 4 節，涉及 `d85d129`。** 來源要還原上限 60，目的地設定檔上限 45、`legacy` 為 30，目的地 `data.json` 上限也是 30。在 `--apply` 重算計畫後、寫暫存檔時，將目的地舊檔改為 15。照 §4，應看到當前有效值已從 45 改為 15 並跳過。實際回「已還原」，寫出上限 60、`legacy.capMinutes:30`，新版重讀疊成 15。重算計畫及 `settingsBytes()` 共用先前的 `loaded.current`，暫存檔改名前只核對目標檔雜湊，寫完也只核對位元組。見 [任務 §4](../tasks/settings-vault-file.md#4-還原與備份格式查核)、[格式查核第 4 節](2026-11-12-settings-vault-file-format-review.md#4-還原值比對與目的地)、[CLI 重算計畫](../tools/restore.ts#L170)、[改名前與寫後核對](../tools/restore.ts#L213)、[CLI 取舊檔基準](../tools/restore.ts#L286)。

**真實路徑。** `v0.4.0` 設定頁會把 15 這類合法值寫進 `data.json`，CLI 要求關閉本機 Obsidian 也無法阻止別台舊版或 iCloud 寫入。重現用 CLI 的寫入替身固定時序，備份、計畫、磁碟寫入與重讀都走實際程式。建議在寫入前重讀舊檔，用同一份內容核對有效值和產生 `legacy`，並驗證 `--apply` 期間才到的變更。

## R4（P2）逾時的舊讀取會把本機最後確認值改回去

**規格｜公開設定檔與 store 介面已重現。** 讓第一筆讀到上限 45 後卡在 `loadData()`。等 store 的五秒讀取逾時，再重讀新的設定檔並採用上限 75。此時 store 與本機確認值都是 75。再放行第一筆，預期兩處都保留 75，實際 store 仍為 75，本機確認值卻被改成 45。舊讀取的結果雖然沒有經 store 採用，`load()` 在回傳前已執行 `remember()`。如果接著檔案不見，重開時 `seed` 或執行中按「重新建立」會取到 45。這也讓「本機備用值」與畫面當時的值不一致。見 [設定檔的確認副作用](../src/core/settings/file.ts#L131)、[載入時記值](../src/core/settings/file.ts#L155)、[store 逾時與晚到處理](../src/core/settings/store.ts#L87)、[啟動用本機確認值](../src/core/settings/store.ts#L140)、[任務 §3](../tasks/settings-vault-file.md#3-設定檔不見時)。

**真實路徑。** 一般檔與舊檔的讀取都經 I/O，既有 store 已明確處理逾時後才回來的呼叫。具體順序用延遲 Promise 重現，真機上發生的頻率待驗。建議讓本機確認值只跟隨 store 真正採用的新檔讀取，補晚到、重讀及缺檔的連續案例。

## R5（P2）帶 BOM 的舊檔在還原與外掛載入被算成不同的值

**規格｜解析差異已重現，Windows Obsidian 行為沿用既有宿主查核。** 設定檔上限 45、`legacy` 上限 30，舊檔為 UTF-8 BOM 加上 `{"capMinutes":15}`。用 Obsidian 的 `loadData` 解析方式重現，外掛採用 45，因舊檔解析失敗。還原的 `settingsNow` 透過預設 `TextDecoder` 的 `parseData` 先去除 BOM，採用 15。同一套計算也用在備份來源，因而可能把備份當時未生效的 15 寫成有效設定，或省略本來應出現的設定差異。發布前比較器已保留 BOM 並交給各版解析，這條路徑仍得到外掛的結果。見 [還原設定值](../src/core/backup/plan.ts#L83)、[位元組解析](../src/core/settings/saved.ts#L89)、[外掛 loadData 接線](../src/main.ts#L158)、[比較器保留 BOM](../tools/compare-versions.ts#L76)、[先前的 Obsidian 宿主查核 F5](2026-11-09-settings-page-l2.md)。

**真實路徑。** `v0.4.0` 的正常設定頁沒有寫 BOM 的路徑。外部編輯器另存的舊檔可帶 BOM，而備份規格會原樣保留其位元組。建議讓兩邊的舊檔解析沿用相同邊界，補「備份原值 → 還原 → 外掛重讀」的例子，並涵蓋備份只有舊檔的情形。見 [syntax §8](../docs/syntax.md#8-備份檔)、[原設定規格的 BOM 驗收](../tasks/settings-page.md)。

## 驗證與範圍

- 待審 `79b59226446ece67b2f51fa325a1e162cf23226c`，範圍 `9b2c133..79b5922`。`git diff --check 9b2c133..79b5922` 通過。
- Windows 沙箱外執行 `npm.cmd run check`，exit 0。型別、ESLint、knip、secretlint、本機路徑、skill 副本、文件檢查全部通過，測試 2,603 通過、0 失敗、0 跳過。
- 使用 Windows Node v24.13.0 的 stdin 在記憶體跑缺檔、損毀檔、重新建立交錯、晚到讀取和 BOM；用隔離的暫存 vault 跑 CLI 還原交錯。探針中的斷言確認上述實際結果。
- 靜態核對新版設定頁與重新建立經 `store → createSettingsFile.save → Files.modify` 寫新檔，外掛還原經同一 store，CLI 還原從計畫取目的地。這幾條路徑都沒有寫 `data.json` 的呼叫。核對備份與更新快照掃描 `Essence Cards/`，以及 `v0.4.0` 的 `isDeckPath`、`isLogPath` 與 `loadData/saveData`，新檔不進舊版卡組或紀錄。舊還原的兩列行為沿用格式查核以發布版計畫器驗出的結果。見 [備份掃描](../src/core/backup/take.ts#L61)、[更新快照](../tools/update-vault.ts#L105)、[舊還原查核](2026-11-12-settings-vault-file-format-review.md#2-040-讀取與跨版本還原)。
- 未實機重跑 V1～V4，也未操作 Windows Obsidian、iPhone 或 iCloud 的缺檔、混用、還原交錯或實際退版。實作者的 V1 使用 `0.4.0+f645c66`、V2～V4 使用 `0.4.0+e9d2d50`，見 [任務實機結果](../tasks/settings-vault-file.md#結果)。本輪驗證使用隔離資料，正式及測試 vault 未使用。

## Claude 回應（第一輪）

五項都同意，照建議在合併前修，一項一個 commit；每個都先寫測試、確認在修正前會失敗，pre-commit 跑完整的 `npm run check`。

| 項目 | 判斷 | 修法 | commit |
|---|---|---|---|
| R1 | 同意。規格本身也有漏洞：D-201 第 5 點寫「讀不到」，〈代價〉又說整份讀不懂照第 5 點，和任務 §1「讀不懂當成讀不到」衝突；「重新建立」只在不見時寫，讀不懂也照第 5 點的話按鈕做不到 | 分開兩種狀態。**不見**：設定檔的 load 回新的 `MISSING`，store 手上的值不變、`known` 變 false（之後不寫設定的觀察行），再讀到檔才變回 true；設定頁那一列照舊。**讀不懂**：照 §1 讀不到的規則，手上的值與 `known` 不變、不出現那一列，和 `0.4.0` 讀不懂 `data.json` 一樣。D-201 第 5 點與〈代價〉、任務 §3、§6-7、syntax §10 改用詞 | `1c26f2c` |
| R2 | 同意。前一份 L2 的 R18 要求「比對雜湊是寫前最後一次 I/O」，換成設定檔之後 `save()` 多讀一次 `data.json`，把這個保證弄丟了 | 在真的寫入那一刻再比：`store.restore` 的 base 除了當底的內容，再交回比對時的原文（`null` 是不存在）；`save` 經 `Files.modify` 的 edit 拿到寫入當下的內容，不同就丟 `SettingsChanged`、不寫，store 回 `changed`。重新建立傳 `null`；外掛還原傳比對時讀到的位元組（保留 BOM 解成文字，和 `vault.process` 交來的一樣）。設定頁的存檔不傳，照舊 | `d708aeb` |
| R3 | 同意 | 「設定」那一列在寫暫存檔之前，設定檔與 `data.json` 各重讀一次：設定檔的雜湊照舊比，現在的值（`settingsNow`）和計畫裡的比，要寫的內容與 `legacy` 都用這一次讀到的；改名之前除了設定檔的雜湊，也比 `data.json` 的雜湊和那一次相同，不同就跳過 | `f759b97` |
| R4 | 同意 | store 新增 `adopted` 選項，真的採用 load 交回的內容時才叫；設定檔記下 load 從設定檔讀出的物件，store 採用了才寫本機確認值。逾時之後才回來的讀、寫前當底的讀都不記 | `f9f63ea` |
| R5 | 同意 | `data.json` 用新的 `parseLoadData` 解析：保留開頭的 BOM，和電腦上 Obsidian 的 `loadData` 一樣讀不懂。還原計畫兩邊的值（備份與現在）、命令列寫入的 `legacy` 都用它；設定檔照舊用 `parseData`（外掛自己讀位元組，BOM 拿掉，兩邊一致） | `527ed40` |

### 真實路徑

- R1：使用者刪掉或改名設定檔就會發生；iCloud 真的改名一般資料夾的檔在 V1～V4 沒出現。
- R2：要在按下「重新建立」或還原的那一兩秒內剛好同步進來，機率低，但發生時會蓋掉另一台的設定，修法成本小。
- R3：要在 `--apply` 寫入的那幾秒內，舊版那台剛好改設定；命令列要求關掉這台的 Obsidian，擋不了另一台。
- R4：要第一次讀超過 5 秒（iPhone 佔位檔、iCloud 很慢），之後又在那筆讀回來之前重讀到新的；之後設定檔不見才看得到差別。
- R5：`0.4.0` 的設定頁不寫 BOM，要外部編輯器另存才有。

### 修了之後仍留著的

- `vault.process` 在讀和寫之間仍有一次等待（電腦版 `adapter.process` 先讀檔、呼叫 fn、再寫），外掛縮不到更小，所有寫入都一樣。`Files.modify` 找不到檔時走 `vault.create`，它寫之前用 `adapter.exists` 看磁碟（安裝版 `app.js`），Obsidian 的檔案索引還沒收到 iCloud 剛下載的檔時會丟「File already exists.」、不寫：重新建立回 `failed` 而不是 `changed`，不會蓋掉；空檔只剩 `exists` 到寫入之間。
- 設定頁的存檔（`change`）沒有加寫入當下的比對：它是讀、改一項、寫，空檔一樣是 `loadData` 那一次；和 `0.4.0` 寫 `data.json` 時相同，照 syntax §10「同步完成之前各改一項只留一份」。

### 驗證

- 修正的 commit 依序是 `f9f63ea`（R4）、`1c26f2c`（R1）、`d708aeb`（R2）、`f759b97`（R3）、`527ed40`（R5），每個的 pre-commit 都跑完整的 `npm run check` 並通過。
- 每個新測試都先在修正前跑過，確認會失敗：R4 晚到的 45 被記成本機確認值；R1 不見之後 `known` 仍是 true；R2 重新建立與還原回 `saved` 並蓋掉剛到的檔；R3 回「已還原」；R5 計畫兩邊都算成 15，「設定」那一列不見。
- R1 另外補了 state 的測試：`known` 用到一半變 false，換日後學期變了不寫觀察行，變回 true 才補一行（state 本來就照 `known` 擋，這次固定下來）。讀不懂的檔用到一半出現時，值與 `known` 不變、重新建立回 `changed` 不寫，也寫成測試。
- R2 依賴 Obsidian 的 `vault.process` 在 fn 丟錯時不寫：看的是安裝版 `app.js`（`vault.process` 呼叫 `adapter.process`，電腦版先以 utf8 讀檔、呼叫 fn、內容不同才寫），Obsidian 自己也在 fn 裡丟錯中止；`Files.modify` 找不到檔時 edit 丟錯就不建資料夾，是原本的契約。沒有在實機刻意製造交錯。
- 沒跑的：實機（Windows Obsidian、iPhone、iCloud）都沒重跑；iPhone 的 `vault.process` 交來的文字有沒有留 BOM 沒驗，沒留的話有 BOM 的設定檔在 iPhone 還原會回「比對之後改過」、不寫（方向安全；設定檔只有手改才有 BOM，iPhone 也不做還原）。
