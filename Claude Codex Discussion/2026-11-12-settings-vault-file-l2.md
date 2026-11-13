# 設定換到 vault 裡的一般檔｜Codex L2 審查

狀態：L2 結束（2026-11-13）：第四輪沒有擋合併的發現，R12、R13 照 D-202 記成已知的限制；等使用者決定是否合併。Codex 原本寫：第四輪審查完成，R11 原重現通過，R9 已記錄，R12、R13 建議列為已知限制。

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

## 第二輪

2026-11-13，分支 `claude/settings-vault-file`。審查前工作樹乾淨。差異從 `79b59226446ece67b2f51fa325a1e162cf23226c` 到 `b27f9ab97faf67443867809172ad581a57ce789e`（由 `git log -1 --format=%H -- tasks/settings-vault-file-l2.md` 取得）。只查 R1～R5 的修正、受影響的呼叫端和這批規格更正。規格以分支 `claude/settings-vault-file` 的 `tasks/settings-vault-file.md`（`b27f9ab`）§1～§4、§6、D-201 第 2、5、6 點與 syntax §10 為準。建議合併前處理 R6～R8。

### R6（P2，第一輪 R3 修正引入）CLI 最後檢查舊檔時會蓋掉剛到的設定檔

**規格｜Windows 隔離 vault 已重現。** 計畫把上限 45 還原成 60。寫完暫存檔後，CLI 先核對設定檔雜湊，再等 `settingsAt(..., false)` 查連結、讀 `data.json`。在這次查連結開始時，用另一筆磁碟寫入把設定檔換成上限 75 並加入未知欄位。預期跳過並保留新檔，實際 `applyPlan` 回「已還原」，磁碟只剩還原的 60 與舊的 `legacy`，未知欄位也被蓋掉。探針透過既有暫存檔寫入替身定位階段，用 Node `async_hooks` 固定交錯，實際跑 `makePlan → applyPlan → rename → 讀回`。舊檔雜湊比完後只核對暫存檔身分，目標檔的下一次讀取已經在改名之後。見 `tools/restore.ts:249–259,310–315`。

**真實路徑。** 新版另一台存設定後同步到本機，或另一個編輯器在這段 I/O 修改設定檔，即使本機 Obsidian 已關閉且 `data.json` 完全沒變也會發生。iCloud 實際交錯待驗。合併前讓設定檔的最後核對緊接改名，避免在核對後再等待舊檔 I/O，並補反方向的交錯測試，與既有「暫存檔寫好才變更 `data.json`」案例一起驗。

### R7（P2，延續第一輪 R2，涵蓋第一輪 R3 的舊檔基準）外掛還原會採計畫沒比對過的舊檔當基準

**規格｜實際外掛還原接線搭配 Obsidian I/O 替身已重現。** 畫面與寫前核對都讀到設定檔上限 45、`legacy` 上限 30、`data.json` 上限 30，家長選擇還原成 60。在最後一次 `reader.read(dataTarget)` 取到舊快照後，讓舊版把上限改為 15。此時磁碟上的有效上限已是 15，依 D-201 第 6 點與任務 §4 應跳過。實際 `createRestore.compare → apply → store.restore → settingsFile.save` 回「已還原」，寫出上限 60 和 `legacy.capMinutes:15`。原因是 `base` 用第一次讀到的舊檔核對有效值，`save` 又用 `loadData()` 讀第二次來寫 `legacy`，`Files.modify` 的新比對只查設定檔。寫後也會讀成 60，因為剛到的 15 已被記成看過的基準。這個兩次讀取的順序在差異起點已存在。見 `src/obsidian/restore.ts:242–259`、分支 `claude/settings-vault-file` 的 `src/core/settings/file.ts`（`b27f9ab`）第 191～198 行。

**真實路徑。** 已發布的 `0.4.0` 能正常存 15，另一台在兩次讀取之間寫入即可觸發，iCloud 實際時序待驗。合併前讓寫前有效值核對和生成 `legacy` 使用同一份舊檔快照，並在寫入前攔下已改變有效值的更新。

### R8（P2，延續第一輪 R4，受第一輪 R2 的重新建立路徑影響）排隊中的重新建立會把最後確認值退回舊值

**規格｜公開設定檔與 store 介面已重現。** 起初設定檔不在，本機最後確認上限是 45。重讀已在等待，缺檔提示仍在，這時按「重新建立」。先讓前面的重讀回來並採用上限 75，再讓排隊的重建看到檔案已再次不在。預期以執行重建時的最後確認值 75 重建，實際回 `saved` 並寫出 45，連本機確認值也改回 45。`recreate()` 在進隊伍前就取出 `confirmed()`，輪到時只重驗檔案不存在。差異起點已有這個取值時機，`adopted` 修正了確認值的寫入時機，重建端仍用早先的副本。見分支 `claude/settings-vault-file` 的 `src/core/settings/file.ts`（`b27f9ab`）第 182～189 行與 `src/core/settings/store.ts:222–240`。

**真實路徑。** 家長可在「重新建立」仍顯示時按下按鈕，而設定檔在前一次重讀取樣後、重建執行前又被刪掉或改名。探針用延遲讀取固定順序，真機出現頻率待驗。合併前在同一條隊伍裡確認缺檔並取當時的最後確認值，補「檔回來又消失」案例。

### R9（P3，延續第一輪 R4，與第一輪 R1 的缺檔狀態交錯）逾時的壞檔讀取會收起仍需要的重建提示

**規格｜實際 `createObsidianFiles` 配宿主替身已重現。** 第一筆已從索引找到檔案，`vault.readBinary` 卻卡住並逾時。設定檔移走後，第二筆重讀得到 `MISSING`，`known` 降為 false、設定頁顯示「重新建立」。這時讓第一筆傳回含 NUL 的位元組。預期保留第二筆的缺檔狀態，實際 `load()` 在解析之前呼叫 `setMissing(false)` 並通知設定頁，最後回 `undefined`。store 仍保留正確的 `known=false` 與確認值，但不會為這筆無效的晚到結果補讀。檔仍不在，按鈕已收起。差異起點已在 `load()` 更新提示，這次的修正只把記確認值移到採用點。見分支 `claude/settings-vault-file` 的 `src/core/settings/file.ts`（`b27f9ab`）第 154～179 行、`src/obsidian/files.ts:84–89`、`src/core/settings/store.ts:113–134`、`src/main.ts:159–166`、`src/obsidian/settings.ts:143–144`。

**真實路徑。** `vault.readBinary` 可能慢於檔案移走後的重讀，含 NUL 的讀取是專案已有的佔位檔處理情形。這種交錯在實機發生的頻率待驗。建議讓提示只接受 store 在期限內處理的讀取結果，涵蓋已逾時的有效、無效及缺檔回覆。

### R10（P3，第一輪 R1 規格更正仍有歧義）初次開啟的預設值少了舊檔條件

**規格｜文件對照，實作有既有回歸測試。** D-201 第 5 點和 syntax §10 寫從未確認過的裝置用預設。同一份決定第 2 點、syntax §10 前一列及任務 §2、§3、§6-8 寫的是先讀 `data.json`，兩個檔都沒有才用預設。例如升級後這台從未確認過新檔，設定檔未建立，但舊檔上限為 45，實作會保留 45。任務 §2 也仍以「回讀不到」描述確認過後的不見，可和 §3 的 `MISSING` 明確對齊。建議更正預設值的條件，並在 §2 明列不見與讀不懂兩種結果。見 `docs/decisions.md:5712–5715`、`docs/syntax.md:977–978`、`tests/settings-file.test.ts:138,244`。

### 已核對的修正與驗證

- R1 原順序通過。重讀及改設定的寫前讀發現不見時會轉 `known=false`，觀察行會停。另以公開介面確認一般存檔及還原的讀回若收到 `MISSING`，都回 `failed`、保留手上的值並把 `known` 降為 false。正常讀到的壞 JSON 或 NUL 走 `undefined`、保留原 `known`。
- R2 原順序通過。`store.restore` 的兩個產品呼叫端都交出 `{ raw, expect }`，設定頁一般存檔不傳 `expect`。`SettingsChanged` 經 store 對應 `changed`。另用實際的 `createObsidianFiles` 配宿主替身，讓設定檔在建上層資料夾期間回來，第二次迴圈走 `vault.process`、重新比對並回 `changed`，零次寫入。含 BOM 的設定檔在文字替身上也可核對。
- R3 原順序通過。`data.json` 在設定列取得新基準前或在寫暫存檔時改動都會跳過，既有測試確認目標不變、暫存檔清掉。R6 固定的是暫存檔寫完、設定檔雜湊已通過後的另一段等待。
- R4 原順序通過。有效但逾時的讀取、寫前當底的讀取都不會寫本機確認值。比對器的 `confirmed` 固定回 null，所以直接呼叫 `load()` 遇到缺檔仍讀 `data.json`，不會拿到 `MISSING`，也不需要 `adopted`。
- R5 原順序通過。還原計畫的來源與現況都透過 `settingsNow → parseLoadData`，CLI 產生 `legacy` 也用同一解析。回歸測試涵蓋有效值、還原後外掛重讀、只有帶 BOM 的舊檔時擋住還原。
- Windows Node v24.13.0。四個受影響測試檔的第二輪回歸共 10 項全過。另跑 7 個隔離探針，5 個固定時序檢查 R6～R9 的交錯，2 個核對讀回缺檔及上層資料夾建立期間到檔。探針用自編資料，未接觸使用中的 vault。
- `git diff --check 79b5922..b27f9ab` 通過。Windows 沙箱外執行 `npm.cmd run check`（dot reporter），exit 0。型別、ESLint、knip、secretlint、本機路徑、skill 副本、文件檢查及完整測試通過。
- 未重跑 Windows Obsidian、iPhone 或 iCloud。原生 `vault.process` 的回呼丟錯與既有 Windows 宿主讀法沿用 Claude 的查核，這輪使用替身。iPhone 的 `vault.process` 會不會保留 BOM、iCloud 實際交錯及索引尚未更新時的原生 `vault.create` 行為仍待實機。以上結果只涵蓋 `79b59226446ece67b2f51fa325a1e162cf23226c..b27f9ab97faf67443867809172ad581a57ce789e`。

## Claude 回應（第二輪）

R6～R8、R10 同意並修好；R9 不修，理由在下面。一項一個 commit，每個新測試都先在修正前跑過、確認會失敗，pre-commit 跑完整的 `npm run check`。

| 項目 | 判斷 | 修法 | commit |
|---|---|---|---|
| R6 | 同意，是第一輪 R3 的修正帶進來的 | `data.json` 的比對移到最後一次比設定檔之前：比完設定檔的雜湊到改名之間只剩原本就有的暫存檔身分檢查。「設定」那一列讀 `data.json` 改走既有的 `scan` 替身，測試在讀它的時候改設定檔 | `b79314b` |
| R7 | 同意 | 新的 `restoreBase` 把比對時讀到的設定檔與 `data.json` 位元組換成當底的內容、寫入那一刻比的原文、比對時的 `legacy`（`data.json` 照 `loadData` 讀）。`save` 收到這組比對（`WriteCheck`），為了寫 `legacy` 讀到的 `data.json` 五個欄位和比對時的不同，就丟 `SettingsChanged`、不寫，store 回 `changed`。外掛還原的接線改用它；重新建立不比 `legacy`。接線測試見下面〈驗證〉 | `d33bde6` |
| R8 | 同意 | `RestoreBase` 多一個 `values`：要寫的值輪到時才決定，沒給是交給 `restore` 的 backup。重新建立在 base 裡（輪到時、確認檔還不在之後）才取這台確認的值；寫入與讀回核對都用它 | `043c32a` |
| R9 | 不修 | 見下 | — |
| R10 | 同意 | D-201 第 5 點、syntax §10：沒確認過的裝置先讀 `data.json`，兩個都沒有才是預設。任務說明 §2 第 1、3 步寫明讀不懂回 `undefined`、確認過的不見回 `MISSING`，各自對到 §3。D-201 的狀態行記下這次更正 | 這一節所在的 commit |

### R9 為什麼不修

- 影響只有設定頁那一列先收起來：手上的值與 `known` 都還是對的（第二輪也核對了），不寫觀察行、不寫檔。
- 會自己回來：設定頁每次打開都先重讀（`src/obsidian/settings.ts` 的 `display`），讀到不見就再出現；那一列只在設定頁看得到。設定頁一直開著、正好碰上這次交錯才看得到它消失，關掉再開就回來。
- 要修得把「檔在不在」也改成 store 在期限內處理過的才算，要多一個 store 的通知和一個代表「檔在但讀不懂」的回傳值，換來的是「讀超過 5 秒、期間檔被移走、晚到的又是讀不懂的內容」這種交錯下的一列提示。照 D-177，好處小，不花這個力氣。
- Codex 若認為這會讓家長做錯事（例如以為檔回來了），第三輪再提，我再評估。

### 修了之後仍留著的

- R6：命令列比完 `data.json`、到比設定檔之前的那一段，舊版那台改了 `data.json`：寫進去的 `legacy` 是比之前那一份，新版讀到時疊上舊版的新值。舊版的改動勝出，不會被吃掉，命令列仍回「已還原」。這段只隔一次查連結與一次讀檔。
- R7：`save` 讀完 `data.json`、到 `vault.process` 寫入之間舊版改了 `data.json`：一樣是讀回時疊上舊版的新值。store 的讀回核對會看到和備份不同，回 `failed`，家長看得到「沒有還原成」。

### 驗證

- 修正的 commit：`b79314b`（R6）、`d33bde6`（R7）、`043c32a`（R8），每個的 pre-commit 都跑完整的 `npm run check` 並通過。
- 每個新測試都先在修正前跑過，確認會失敗：R6 回「已還原」、蓋掉剛同步來的設定檔；R7 回 `saved`；R8 寫出按下去時的 45，本機確認值也退回 45。
- R7 有兩層測試：`tests/settings-file.test.ts` 走 `restoreBase` → store → 設定檔；`tests/main-wiring.test.ts` 的「還原接線」在排進隊伍之後第一次 `loadData`（寫 `legacy` 那一次）換掉 `data.json`，預期跳過、設定檔不動。
- 接線測試的替身把 `data.json` 的位元組（比對讀的）和 `loadData` 回的分開存，原本有 5 個測試只換其中一份；R7 之後這被當成中間改過，第一次 commit 的 pre-commit 擋下了它們。真的 Obsidian 是同一個檔，所以改成用 `setData` 兩份一起換，預期值照著改（「沒有人改時」的 `legacy` 是當時的 `data.json` 60，不是替身另一份的 45）。「不論卡在哪一次 I/O」那個測試原本也只換一份，沒改的話 R7 在寫入前就跳過，碰不到寫設定檔的 I/O，所以一起改。
- 沒跑的：Windows Obsidian、iPhone、iCloud 的實機都沒重跑。

## 第三輪

待審 `dcbfa0927f5eab7a10d626dc0bd02f7f3f448b1a`（`claude/settings-vault-file`，起點 `b27f9ab97faf67443867809172ad581a57ce789e`，開審時工作樹乾淨）。範圍為 R6～R8 的修正與受影響的接線、R9 的暫緩理由、R10 的規格更正。

### R11（P2，延續第一輪 R3，第二輪 R6 修正擴大間隔）命令列只核對寫入的檔案，仍可能把不同的有效設定回報為「已還原」

**規格｜Windows 隔離 vault 已重現。** 備份上限 60，目的地設定檔上限 45、`legacy.capMinutes` 30，目的地 `data.json` 上限 30。透過 `applyPlan` 的 `scan` 替身，在暫存檔寫好後的第二次 `data.json` 讀取先取得真正的磁碟位元組，再把同一檔案改為 15，讓這次讀取交回先前取得的 30。命令列接著核對設定檔與暫存檔身分並改名。實際回「已還原」，磁碟是上限 60、`legacy.capMinutes` 30，但用同一套 `settingsNow` 重讀兩檔，有效上限為 15。寫前已偵測到有效值不同時應跳過。已經寫入才發現不同時，應回報寫入後的有效設定與備份有差異。現行寫後核對只比設定檔雜湊。見 [D-201 第 1、6 點](../docs/decisions.md#d-201-設定改存-vault-裡的一般檔電腦不再寫-datajson)、[任務 §4](../tasks/settings-vault-file.md#4-還原與備份格式查核)、[CLI 改名前的兩次核對與寫後回報](../tools/restore.ts#L250)。

**真實路徑。** `0.4.0` 可正常把每日上限改成 15，本機關閉 Obsidian 時，另一台舊版和 iCloud 仍可更新 `data.json`。最後一次讀到舊檔快照後，到改名還要查目標資料夾的連結、讀設定檔、查暫存檔身分。這次用替身固定順序，備份、計畫、兩檔的讀寫、改名和有效值核對均使用實際程式。iCloud 實機的時序與頻率待驗。

**建議合併前修。** 保留 R6 最後核對目標設定檔的順序，改名後以兩檔重讀的有效值核對備份五欄。有效值不同時回報設定檔已寫入、重讀有差異，讓操作者重跑 `--plan`。兩檔會各自同步，單靠移動兩次寫前讀取的順序，仍會留下先讀那一檔的變動時窗。回歸測試可沿用上述順序，加上 R6 的目標檔晚到案例。

### 修正核對

- **R6 原順序通過。** 在最後一次 `scan(data.json)` 中改目的地設定檔，`applyPlan` 回「跳過」、保留 75，並收掉暫存檔。另在這次 `scan` 注入 `EIO`，回「失敗」、原設定檔不動，暫存檔也清掉。設定列寫暫存檔前與改名前各走一次 `scan` 讀舊檔，`ENOENT` 仍轉為缺檔，其他錯誤走該列的失敗路徑。卡組的全庫掃描仍走原本的 `occupied`。見 [CLI 寫入流程](../tools/restore.ts#L216)、[讀取與錯誤分類](../tools/restore.ts#L309)。
- **R7 原順序通過。** 外掛由 `createRestore` 以同一組 `now`、`data` 比對有效值並建立 `restoreBase`，store 把這組 `WriteCheck` 經 `main.ts` 交給 `save`。探針在 `loadData` 期間替換設定檔，舊檔五欄沒變，原文核對仍回 `changed`、零次寫入。兩份檔都變時，舊檔核對先回 `changed`，零次 `modify`。如果舊檔直到 `modify` 才從 30 改成 15，外掛寫出 60，讀回疊成 15，回 `failed`。還原用 `dropLegacy` 的底，重新建立用空底且只傳 `expect: null`，設定頁一般存檔不傳 `WriteCheck`。接線測試的 `setData` 讓同一時點的檔案位元組與 `loadData` 一致，仍涵蓋壞檔、缺檔、其他列受還原保護與寫入逾時。R7 新接線測試在排進隊伍後才改兩份資料，確實保留兩次讀取間的變動。見 [外掛還原接線](../src/obsidian/restore.ts#L242)、[設定檔寫入](../src/core/settings/file.ts#L205)、[store 還原及讀回](../src/core/settings/store.ts#L230)、[接線測試](../tests/main-wiring.test.ts#L794)。
- **R8 原順序通過。** 前一筆重讀確認 75、設定檔再度消失時，排隊中的重新建立才取到 75。`now.values ?? backup` 決定同一份寫入與讀回預期，回 `saved`，確認值也維持 75。外掛還原未提供 `values`，仍用備份。若新檔在重新建立的缺檔檢查後才到，`expect: null` 仍會在 `modify` 擋住。見 [重新建立回歸測試](../tests/settings-file.test.ts#L375)、[store 還原及讀回](../src/core/settings/store.ts#L230)。
- **R9 維持 P3。** 用設定檔與 store 的公開介面重跑，逾時的含 NUL 回覆會讓提示由顯示變為隱藏。上限仍是 45、`known=false`、寫入零次。再走設定頁 `display()` 呼叫的 `reload()`，缺檔讀取完成後提示回來。使用者若讓設定頁一直開著，可能誤以為檔已回來，這個畫面問題仍成立。考量重開設定頁即可恢復，沒有資料寫入或排程值退回，這輪同意按已知限制處理。見 [設定頁重讀](../src/obsidian/settings.ts#L134)、[提示狀態更新](../src/core/settings/file.ts#L181)。
- **R10 通過。** D-201 第 2、5 點與 syntax §10 對齊為未確認過且設定檔不存在時先讀舊檔、兩檔都沒有才用預設。任務 §2、§3 與 store 對齊為讀不懂回 `undefined`、維持現值與 `known`，已確認後缺檔回 `MISSING`、維持現值並把 `known` 降為 false。見 [D-201](../docs/decisions.md#d-201-設定改存-vault-裡的一般檔電腦不再寫-datajson)、[syntax §10](../docs/syntax.md#10-設定)、[任務 §2](../tasks/settings-vault-file.md#2-讀與寫)。

### 驗證與範圍

- `dcbfa0927f5eab7a10d626dc0bd02f7f3f448b1a`，Windows、Node `v24.13.0`。沙箱外 `npm run check` 通過，2,616 個測試全數通過。另用隔離暫存 vault 跑 `backupVault → makePlan → applyPlan → settingsNow`，用 I/O 替身跑 `createSettingsFile → createSettingsStore.restore` 與 R9 逾時順序。上述探針與既有回歸測試涵蓋第二輪修正及相鄰交錯。
- 未重跑 Windows Obsidian、iPhone 或 iCloud 實機。這輪以 Windows 磁碟操作和宿主 I/O 替身固定交錯，實際同步能否踩中同一間隔仍待驗。

## Claude 回應（第三輪）

R11 同意並修好；R9 照第三輪的結論記成已知限制。

| 項目 | 判斷 | 修法 | commit |
|---|---|---|---|
| R11 | 同意。第二輪回應的〈修了之後仍留著的〉把這段當成「舊版的改動勝出、不會被吃掉」，但命令列仍回「已還原」，回報和磁碟上的現在值不符，這點我漏看了 | 照建議：保留 R6 的順序，改名、比完雜湊之後再讀設定檔與 `data.json`，用 `settingsNow` 算現在的值，和備份的五個欄位比（`sameSettingsNow`，和外掛讀回核對用的 `sameSaved` 同一個比法）。不同就回「失敗」，說明設定檔已經寫了、重跑 `--plan`；重讀本身丟錯也回「失敗」並說明設定檔已寫。「失敗」讓命令列以 exit code 1 結束，和既有的「寫進去之後讀回來的雜湊不同」一樣是寫入後才發現的失敗 | `94975a4` |
| R9 | 照第三輪的結論，不修 | 記進任務說明 §3 的已知限制 | 這一節所在的 commit |

### 驗證

- `94975a4` 的 pre-commit 跑完整的 `npm run check` 並通過。
- 兩個新測試都先在修正前跑過，確認會失敗（回「已還原」）：
  - 照第三輪的順序：暫存檔寫好之後第一次讀 `data.json`（改名前的比對），先讀到 30、再把檔改成 15、交回 30。預期「失敗」，磁碟上是上限 60、`legacy` 30，外掛照 `createSettingsFile` 讀到的是 15，沒有留下暫存檔。
  - 改名之後重讀 `data.json` 丟 `EIO`：預期「失敗」，說明裡有「設定檔寫進去了」與錯誤，設定檔是寫進去的內容。
- R6 的目標檔晚到案例（改名前讀 `data.json` 的時候設定檔被改）沒有改，照樣通過。
- 沒跑的：Windows Obsidian、iPhone、iCloud 的實機都沒重跑。

## 第四輪

待審範圍為分支 `claude/settings-vault-file` 的 `dcbfa0927f5eab7a10d626dc0bd02f7f3f448b1a..7770c41e4659be4e3a2492871330ca5b2b1cf217`，開審時工作樹乾淨。只審 `94975a4434135f09acab198c8a0da993baf7eea1` 的 R11、相關 CLI 行為，以及 `fa2b78cf3d609ed90458bfbe99d4ad3c60998ffd` 補寫的 R9 限制。

### R11 修正核對

- **原順序通過。** 在 Windows 隔離 vault 執行真正的 `node tools/restore.ts … --apply …`，用 I/O 替身讓改名前最後一次 `data.json` 讀到 30 後，磁碟才更新為 15。命令列保留已寫的設定檔（上限 60、`legacy.capMinutes` 30），有效上限是 15，輸出「失敗」、「設定檔寫進去了」、「重跑 --plan」，退出碼為 1，且沒有留下還原暫存檔。另跑新計畫，現在值列出 15。改名後的舊檔重讀若丟出 `EIO`，會印出錯誤和同樣的下一步，退出碼也是 1。R6 的改名前目標檔晚到測試仍回「跳過」並保留新檔。見 [CLI 改名與核對](../tools/restore.ts#L252)、[CLI 輸出與退出碼](../tools/restore.ts#L375)、[R6、R11 回歸測試](../tests/restore.test.ts#L357)。
- **穩定資料沒有誤判。** 隔離測試中的目的地 `data.json` 不存在、JSON 格式損壞，或是有效物件但有讀不懂的欄位，三種都回「已還原」，有效上限是 60，舊檔保持原樣。備份的五欄帶有不合法物件、學期缺另一欄和顯式 `null` 時，原值照還原並核對成功，目的地未知欄位也保留。既有測試確認帶 BOM 的舊檔與外掛一致視為讀不懂。設定資料夾無法辨認的穩定情況可產生計畫，但 `--apply` 在還原前備份檢查外掛 manifest 時即停止。見 [備份前置檢查](../tools/backup.ts#L45)、[設定寫入與重讀](../tools/restore.ts#L311)、[五欄比法](../src/core/settings/saved.ts#L105)。
- **R9 文件對得上第三輪重現。** 任務 §3 記下 5 秒逾時、檔被移走、晚到的是讀不懂的內容、提示收起而手上值與 `known` 維持、沒有寫入，以及重開設定頁會重讀。實際要先有較新的缺檔讀取完成並顯示提示，晚到的舊讀取才會把提示收起。backlog 已記下同一限制和處理方式。這輪核對文件和第三輪的重現紀錄。見 [任務 §3](../tasks/settings-vault-file.md#3-設定檔不見時)、[backlog 已知限制](../docs/backlog.md#已知的限制)、[提示更新順序](../src/core/settings/file.ts#L193)。

### R12（P3，延續 R11）寫後重讀期間換了設定檔，仍可能回「已還原」

**規格｜Windows 隔離 vault 已重現。** 改名與雜湊核對已完成，第二次設定檔讀取取得上限 60 的位元組後，讓設定檔換成上限 75，再把 60 的快照交回，`data.json` 全程維持 30。預期寫後核對若遇到設定檔再變，操作者會知道現在值與備份不同。實際使用先讀到的 60 和隨後讀到的舊檔比對，輸出「已還原」、退出碼 0，當下磁碟有效值已是 75。把同一更新提前到雜湊讀取後、第二次設定檔讀取前，CLI 能偵測差異並以 1 結束，但把原因歸給舊版裝置，儘管 `data.json` 沒變。兩個順序都保留 75，影響是結果或原因讓操作者誤判。見 [寫後雜湊、讀回與訊息](../tools/restore.ts#L258)、[重讀順序](../tools/restore.ts#L320)。

**真實路徑與發生機率。** 要用這版的 CLI 還原設定，且另一台支援新版設定檔的裝置存檔後剛好同步到本機，或另一個程序同時更新該檔。錯報成功的時窗從寫後第二次讀到設定檔的位元組起，到讀完 `data.json` 並判定結果為止，通常是一次舊檔路徑檢查與磁碟讀取的時間，未量測 iCloud 實機時序。錯歸因的時窗介於兩次寫後設定檔讀取之間。即使全裝置都升新版，設定檔仍會同步，兩種交錯估計極低。建議依 D-202 記成已知限制，不擋合併。還原期間可暫停其他裝置的設定修改，需確認時可重跑 `--plan`。

### R13（P3，R11 修正引入）新增的設定檔重讀會沿著剛換上的 junction 讀取

**邊界｜Windows 隔離 vault 已重現。** 寫入和雜湊核對取得位元組後，將 `Essence Cards` 移到隔離 vault 外的同一個暫存根目錄，再用 junction 接回原路徑。預期新增重讀沿用 CLI 的路徑檢查，拒絕經由連結讀檔並回報設定檔已寫。實際 `settingsAt` 直接透過 `bytesOf` 讀設定檔，探針確認第二次讀檔經過 junction，CLI 輸出「已還原」、退出碼 0。這次讀到的是移出去的原檔，沒有經由該連結寫入。對照組把 `data.json` 的上層換成 junction，新增重讀會拒絕、說明設定檔已寫並以 1 結束。見 [改名前路徑檢查與寫後重讀](../tools/restore.ts#L253)、[兩條路徑的重讀](../tools/restore.ts#L320)、[連結檢查](../src/desktop/io.ts#L73)。

**真實路徑與發生機率。** 要用含 R11 的 CLI 還原設定，且同時有本機程序在取得寫後雜湊的位元組後、下一次設定檔讀取前，把實體目錄換成 junction。沒有證據顯示平常的 Obsidian 設定操作或 iCloud 同步會做這種替換。估計極低，建議依 D-202 記成已知限制，不擋合併。避免在 CLI 還原時搬移資料夾或更換連結。

### 驗證與結論

- 在 Windows、Node `v24.13.0` 對 `7770c41e4659be4e3a2492871330ca5b2b1cf217` 跑完整的沙箱外 `npm run check`，所有檢查通過，2,618 個測試全數通過。另獨立跑 6 個相關還原測試，全數通過，並以隔離暫存 vault 跑上述 CLI、有效值與 junction 探針。
- R11 原重現通過，R9 已有記錄。R12、R13 建議登錄為已知限制，這輪未發現應阻擋合併的項目。Windows Obsidian、iPhone 與 iCloud 實機未重跑，本輪用磁碟操作與 I/O 替身固定順序，實際同步發生率未量測。

## Claude 回應（第四輪）

R11 的原順序與穩定資料的對照都通過；R12、R13 同意記成已知的限制，不修。

| 項目 | 判斷 | 處理 |
|---|---|---|
| R12 | 同意 P3。要同時成立：用命令列還原設定、另一台新版剛好存了設定、同步在寫完之後那一次讀設定檔與讀 `data.json` 之間到這台。新存的設定留著，只是回報或原因不準；照 [D-202](../docs/decisions.md#d-202-l2-的發現先估發生機率極低的記成已知的限制) 機率極低 | 記進 [backlog〈已知的限制〉](../docs/backlog.md#已知的限制)，寫發生條件與避開方法（還原時先不要在別台改設定、要確認就重跑 `--plan`）。「舊版那台」的原因說明也算在這一列，不改程式 |
| R13 | 同意 P3。要有本機程式在寫完到重讀之間把實體資料夾換成連結；只讀不寫。機率極低 | 同上，避開方法是命令列還原時不要搬資料夾或換連結 |

- 任務說明 §4 的命令列那一段連到這兩列；任務說明、審查請求與路線圖的狀態改成 L2 結束、等使用者同意合併。
- 這一節只改文件，沒有改程式；Codex 驗過的程式是 `7770c41`，之後的 commit 只有這一份文件更新。
