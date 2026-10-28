# 更新防線第一部分：審查請求（給 Codex）

狀態：待審：第一輪修正的再查（`c4a93c6`）與第二輪 L2（1-3～1-5，`d3e2fad`），見文末兩節；[回報與回應](<../Claude Codex Discussion/2026-10-29-update-safeguards-1-review.md>)

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（寫進使用者 vault 的還原、紀錄的還原檔與合併順序、備份格式的讀取檢查，屬於 [quality.md](../docs/agents/quality.md) 的高風險範圍）。

這一輪是**中途查核點**：使用者要求在關鍵步驟停下來請你審查。1-3 發布前比較與 1-5 更新命令都建立在這一輪的備份格式與 `openBackup` 之上，所以先審這裡；1-4 安裝的擋法不碰這些程式，Claude 在你審查期間繼續做。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-safeguards-1`，分支 `claude/update-safeguards-1`。
- **待審的範圍是 `git diff 048adf036a293f1fbd59980fd6f59a73b161dee1 4dbb3953b8ec6ad52dd701180836d4d40ee6e16e`**（20 個檔，+1600／−43）。`048adf0` 是分支和 `main` 的共同祖先，也是任務說明的基準。兩個 commit：`0b30874` 讓 `main.js` 第一行記下 BUILD 與 DEV（`tools/build.mjs`，`install-vault.mjs` 只改成呼叫 `buildPlugin`，行為不變），`4dbb395` 是備份與還原。
- Claude 在審查期間會在同一個 worktree 繼續改（1-4），**請另開一個 worktree 跑測試**：`git worktree add --detach <暫存資料夾> 4dbb395`，裡面 `npm ci`；用完 `git worktree remove`。

## 規格與優先順序

- 任務說明：[tasks/update-safeguards.md](update-safeguards.md) 的 §1 開頭、1-1、1-2，以及 1-6 裡「備份」「還原」兩項。
- 格式：[syntax.md](../docs/syntax.md) §0（檔名表）、§5（`紀錄/` 直接底下的 `.jsonl` 都讀）、§5-3 還原檔、§8 備份檔（含「讀備份的一方」四條）。
- 決定：[D-150](../docs/decisions.md#d-150-備份與還原) 第 4、5、7、8、9 點；[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)（已用 ID 的保護）。
- 前幾輪的條件：[討論稿](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md>)的〈Codex 確認〉C3、C4、C5，〈Codex 格式查核〉F3、F4、R3 與「Claude 額外補的七組細節」第 6、7 組。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那一份。

## 公開介面

- `src/core/backup/index.ts`（純邏輯，不 import Node 或 `obsidian`；之後外掛內的備份會直接用）：`readManifest`、`openBackup`（syntax §8 讀取檢查）、`writeZip`、`hashBytes`、`backupName`、`readBuild`、`logSource`、`restoreLogName`、`missingLogLines`、`planRestore`。
- `tools/backup.ts`：`backupVault(options)` 與 `npm run backup -- <vault> [--to <資料夾>] [--config <設定資料夾>]`。
- `tools/restore.ts`：`makePlan`、`applyPlan` 與 `npm run restore -- <vault> <備份檔> --plan | --apply <計畫檔> [--files …]`。
- `tools/vault-io.ts`：列檔、讀不到的原因、預設備份位置、`realpath` 判斷、目的地的檔名規則（`sameFileKey`）。
- `src/core/study/index.ts` 多匯出 `parseTime`（清單的時間檢查用；`tests/boundaries.test.ts` 的清單一起改）。

## 請特別看

1. **還原檔與缺的行**（`src/core/backup/logs.ts`、`names.ts`、`tools/restore.ts` 的 `applyPlan` 後半）：照 syntax §5-3，還原後 `reviews` 的內容與順序、`changes`、`cancelled`、`seen`、重播與到期都和那些行還在來源檔時相同（R3 的口徑）。請用新的組合驗：多份還原檔、還原檔本身也不見、衝突副本的還原檔、同一天再還原一次（`-2`）、備份裡有、現在連來源檔都沒有的來源、壞行剛好是最後一行。
2. **全庫 ID 檢查**（`plan.ts` 的 `checkIds`）：照選擇還原後的所有卡組，參與重複的還原檔擋住，擋住之後再算到沒有新的。請找會漏擋或誤擋的組合（例如擋住一篇讓另一篇變成重複、同一篇裡重複、現在本來就有的重複、卡組在系統資料夾裡）。
3. **備份的穩定性**（`tools/backup.ts`）：讀原始位元組、讀完重新列檔與比雜湊、紀錄只多了後面的行用舊內容、`ENOENT` 當成檔案在變而重來（3 次）、其他讀不到的錯誤直接失敗；暫存檔寫完讀回、`parseDeck` 比對、改名前再確認正式檔名不存在。
4. **讀備份**（`zip.ts` 的 `openBackup`、`manifest.ts`）：fflate 的 `unzipSync` 結果是物件，同名的會互相蓋掉，所以用 `filter` 記下中央目錄的每一項來抓重複；請找還能混過去的 zip（例如名稱的編碼、目錄項目、`__proto__` 這類名稱、清單和 zip 的大小寫不同）。
5. **寫回 vault**（`applyPlan` 前半）：先做還原前的備份（放在備份檔的資料夾）；重新讀現況、照這次的選擇重算；每個檔和計畫裡的雜湊不同就跳過；寫法是同一個資料夾裡的暫存檔再改名，讀回比雜湊。請看失敗時會不會留下暫存檔或半個檔、重跑能不能續做、計畫檔被別的 vault 或別份備份拿來用時擋不擋得住。
6. **設定資料夾與目的地**（`vault-io.ts` 的 `pluginConfig`、`sameFileKey`；`plan.ts` 的 `targetOf`）：F3、F4 的條件，包括 Windows 用 `toLowerCase` 近似 NTFS 的不分大小寫、Mac 加上 NFC。
7. **測試**（`tests/backup.test.ts`、`tests/backup-core.test.ts`、`tests/restore.test.ts`、`tests/helpers/vault.ts`）：任務 1-6 列的備份與還原項目是否都有、是否真的擋得住回歸；`seams` 的替身會不會讓真的問題測不出來。

## Claude 自己選了做法的地方（請逐點回覆）

1. zip 用 fflate `0.8.3`（釘死版本，`dependencies`）：純 JS、沒有相依、MIT；`zipSync` 壓縮等級 6；`manifest.json` 放第一個、縮排兩格；zip 的時間欄位用備份開始的時間。
2. 讀 `main.js` 的 BUILD：新的建置第一行有 `/*! Essence Cards build=… dev=… */`；之前的建置從「版本」命令的字串 `"Essence Cards\uFF1A<BUILD>"` 找，`dev` 是 null；格式不對的 BUILD 在檔名寫「未知」。
3. `Essence Cards/` 裡有符號連結或 junction 時備份整份失敗：不跟著走，也不略過（略過就少備份了）。
4. 讀的時候 `ENOENT`（列出來之後不見了）算檔案在變，整份重來，算進 3 次；權限、被占用等其他錯誤直接失敗並寫原因；Windows 上其他錯誤說明成可能是 iCloud 的雲端佔位檔。
5. `notes` 記兩種：解析有 `error` 等級問題的卡組、不是 UTF-8 的卡組（照原樣備份，不算失敗）。
6. 缺的行照來源比，同一行在備份裡出現兩次只補一次；寫進還原檔的是去掉前後空白的行（JSON 本身不重新編碼）；文字用不嚴格的 UTF-8 解碼。
7. 「最後一行是現在某一行的開頭就不算缺」只用在備份裡每個檔的最後一個非空行，只和同一個來源現在的行比。
8. 計畫寫成 JSON（給 `--apply`）加 Markdown（給人看，含逐行差異，前後各留 2 行；不是文字的只列大小與雜湊），放在備份檔旁邊；`--apply` 沒給 `--files` 就是全部可以還原的；`--files` 給了計畫裡不能還原的路徑，什麼都不寫就停。
9. ID 檢查只看 `isDeckPath` 的檔；本來就重複、這次沒還原的不算；理由寫「現在在「X」」「還原的「X」也有」「在同一篇裡重複」。
10. 還原前的備份放在要還原的那份備份的資料夾；它失敗就什麼都不寫，所以現在的設定資料夾確定不了時整個 `--apply` 做不了（`--plan` 照樣出、data.json 擋住）。
11. 寫回用「同資料夾的暫存檔 → 改名蓋過去」，暫存檔名 `<目標>.<隨機>.restore-tmp`（不是 `.md` 結尾，不會被讀成卡組）；前提是 Obsidian 關著。
12. 目的地的檔名規則：Windows `toLowerCase`、Mac NFC 加 `toLowerCase`、Linux 原樣；在 Windows 上，只差大小寫的現在的檔照現在的名稱寫回，不另開一個。
13. 還原檔的裝置碼：平台名稱加隨機 4 碼，一次 `--apply` 用同一個；日期是還原當天的當地日期。
14. 備份與計畫檔名撞到已有的檔就換隨機碼；正式檔名在改名前再確認一次不存在（確認與改名之間的空檔沒有鎖）。
15. 清單的 `tool` 是這個工具所在 repo 的 `buildVersion()`；`started` 是這一輪開始讀的時間（重來就重算）。

## 行為與風險

- 外掛的行為不變：`src/main.ts`、`state`、排程沒有改；`study` 只多匯出 `parseTime`。
- 明確延後：外掛內的備份與還原畫面、排除 Capture 教材（過渡工具不排除任何檔案）、清理舊備份、還原時的相依檢查（自訂規則還不存在）、`需要版本`／`need` 的讀取（第二部分）。
- 實機：Claude 對測試 vault 跑過一次 `npm run backup` 與 `--plan`（只讀 vault，備份在 `%LOCALAPPDATA%`；7 個檔、沒有 `data.json`、舊建置的 BUILD 讀得到、計畫沒有差異）。沒有對任何真的 vault 跑 `--apply`。iCloud 雲端佔位檔讀不到的錯誤碼沒有實測。

## 驗證方式

- Node 24 以上（Claude 用 v24.13.0）。在你自己開的 worktree 裡：`npm ci`、`npm run check`（Claude 在 `4dbb395` 的 pre-commit 跑過，全過）。完整檢查要在沙箱外跑（[quality.md](../docs/agents/quality.md)〈檢查指令〉）；不能解除沙箱時逐項列出失敗的測試並說明哪些是環境造成的。
- 只看這一輪的測試：`node --test --test-concurrency=1 tests/backup.test.ts tests/backup-core.test.ts tests/restore.test.ts`（30 項）。

## 回報

寫在主資料夾的 `Claude Codex Discussion/2026-10-29-update-safeguards-1-review.md`（不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 「請特別看」的 7 點逐點寫結論；「Claude 自己選了做法的地方」的 15 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。

## 第一輪修正的再查

你的第一輪回報（F1～F6 與第 7 點）Claude 全部接受、已修，處理與 commit 寫在[回報](<../Claude Codex Discussion/2026-10-29-update-safeguards-1-review.md>)最後的〈Claude 回應〉。請照你在〈交回 Claude〉寫的，針對改過的解析邊界與還原的寫入順序再查。

- **範圍**：`git diff 7b2a0459425354cb90a75cdb6815e6c2f46f24ad c4a93c6ad80d5d4b174fb93c9c996aa2524e9378`（7 個 commit：`ccd7ad6` F4、`bdb7264` F6、`813c9be` F5、`b210348` F3、`7515798` F1、`3084f62` F2、`c4a93c6` 第 7 點）。分支上中間的 `de7627b`（1-4）與 `7b2a045`（pre-commit 拿掉 git 環境變數）不在這一次，放在第一部分最後的 L2。
- **請特別看**：
  1. `plan.ts` 的 `orderWrites` 與 `planRestore` 的迴圈：三篇以上的鏈與環、擋住一篇之後 ID 檢查與順序再算會不會漏、`after` 只看「加回的 ID 現在在別篇」夠不夠（例如一篇同時釋放又加回、data.json 或圖片和卡組混在一起）。
  2. `restore.ts` 的 `applyPlan`：計畫之後改過的檔先排除再重算、照 `order` 寫、前面的沒寫成就跳過、寫前與改名前重讀；結果的「跳過／擋住／失敗」理由是否正確，重跑能不能續做。
  3. `zip.ts` 的 `strictNames`：自己讀中央目錄的寫法（找 EOCD、ZIP64 拒絕、註解欄、名稱和 fflate 讀到的一一比對）有沒有能混過去或誤擋正常備份的 zip。
  4. `vault-io.ts` 的 `assertNoLinks` 與還原寫入、還原檔寫入的檢查位置；設定資料夾是連結時，讀 data.json 照常、寫 data.json 擋住，這個不對稱是否可以。
  5. F5 的暫存檔所有權：備份與還原兩邊。
- **驗證**：照上面〈驗證方式〉另開 worktree（`git worktree add --detach <暫存資料夾> c4a93c6`）；Claude 在 `c4a93c6` 跑過 `npm run check`，602 項全過。
- **回報**：接在同一份回報的最後，標題「Codex 再查（日期）」；照上面〈回報〉的格式，每項標明是新發現還是第一輪項目沒修好。

## 第二輪：1-3、1-4、1-5（合併前的 L2）

第一部分其餘的程式都在這一輪。可以和上一節的再查一起做，回報寫成兩節。

### 審查對象

- **範圍**：兩段，合起來就是分支 `claude/update-safeguards-1` 上 1-1、1-2 與第一輪修正以外的全部：
  - `git diff 4dbb3953b8ec6ad52dd701180836d4d40ee6e16e 7b2a0459425354cb90a75cdb6815e6c2f46f24ad`：`de7627b` 1-4 安裝的擋法、`7b2a045` pre-commit 在跑檢查前拿掉 git 的環境變數。
  - `git diff c4a93c6ad80d5d4b174fb93c9c996aa2524e9378 d3e2fadbe37062c53755129e3dab0b0c46c2e584`：`aae99ed` 每台裝置最後回報的版本、`7edc242` 1-3 發布前比較、`790a3f6` 1-5 更新命令與考前提醒、`bbc829d` npm 改用單一命令字串、`d3e2fad` 備份落在封裝 App 私有資料夾時的提醒。
- 另開 worktree：`git worktree add --detach <暫存資料夾> d3e2fad`，裡面 `npm ci`。**拿掉時不要用 `git worktree remove --force`**：Windows 上它會順著 junction 刪掉連結指到的內容（見下面「行為與風險」）；用一般的刪除再 `git worktree prune`。

### 規格與優先順序

- 任務說明：[tasks/update-safeguards.md](update-safeguards.md) 的 1-3、1-4、1-5，以及 1-6 的「比較」「安裝」「考前提醒」三項；2-1 裡「裝置列表」那一句（`lastVersions` 現在就做，給更新命令印裝置版本，第二部分的「版本」命令沿用）。
- 決定：[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 2、4、5、6 點，[D-150](../docs/decisions.md#d-150-備份與還原) 第 9 點，[D-098](../docs/decisions.md#d-098-考試範圍只用在大考日期改成考試期間)；格式：[syntax.md](../docs/syntax.md) §4 考試範圍、§5-1 版本行、§8。

### 公開介面

- `tools/install.ts`（`tools/install-vault.mjs` 轉來）：`installVault`、`registerTestVault`、`releaseProblems`、`isTestVault`、`localFolder`；命令列 `--dev`、`--release <版號>`、`--register-test`、`--config`。
- `tools/compare-versions.ts` 與 `tools/compare/`（`adapter.ts` 在各版本自己的 Node 程序裡跑，`snapshot.ts` 是比較資料與差異）：`npm run compare-versions -- <備份檔> <舊> <新>`。
- `tools/update-vault.ts`：`checkUpdate`、`installUpdate`、`baseline`、`changedSince`；`tools/exam-reminder.ts`：`examReminder`。
- `src/core/backup/versions.ts`：`lastVersions`。
- `tools/build.mjs`：`buildPlugin`、`buildVersion`（`0b30874` 第一輪看過；這一輪 `7b2a045` 改了它呼叫 git 的環境變數）。

### 請特別看

1. **安裝的擋法擋不擋得住**：開發版或沒發布的建置能不能繞進沒登錄的 vault（登錄檔的路徑、junction、大小寫、vault 本身是連結、登錄的路徑之後不見）；正式版的四個條件（`git status --porcelain` 含未追蹤檔、HEAD 正好是 tag、`package.json` 版號、建置的第一行 `dev=false` 且 BUILD 的 commit 是 HEAD 的開頭）有沒有漏的；`.local/releases/` 已有同版號時的處理、`--release` 的雜湊檢查。
2. **發布前比較的保真度**：轉接器算的和外掛實際排的會不會不同（設定用預設、`exam` 是 null、到期用整份紀錄重播、今天的份每一張單獨放進去拿第一題、30 天的算法）；接不上時一定是「無法比較」、不會變成零差異；兩個 worktree 的清理；輸入只放 `Essence Cards/` 底下的 `.md` 與 `.jsonl`。
3. **更新命令**：`--check` 的順序與失敗時停在哪裡；基線的決定（`.local/releases/` 的雜湊 → BUILD 的 commit → 基線缺失）；`--install` 的重新確認（`changedSince`：紀錄只多了後面的行、新的紀錄檔可以，其他都算改了）；登錄過的測試 vault 不查正式版的條件（演練用）是否合理。
4. **考前提醒**（syntax §4、D-098）：生效的判斷、清晨 4 點換日、好幾份生效時選哪一份、讀不到時一定要 `--exam-ok`。
5. **`lastVersions`**：照 syntax §5-1 與任務 2-1：兩台時間與值相同各列一台、同來源同時間不同值是不確定、衝突副本與還原檔的標法。
6. **pre-commit 的修改**（`7b2a045`）：`unset $(git rev-parse --local-env-vars)` 對只改文件的 commit、部分 commit（`git commit <路徑>`）、CI 有沒有副作用。
7. **測試**（`tests/install.test.ts`、`tests/compare-versions.test.ts`、`tests/update-vault.test.ts`、`tests/build.test.ts` 改過的兩項、`tests/backup-core.test.ts` 的 `lastVersions`）：在暫存 repo 裡跑 git 的測試是否都隔離了環境變數；替身（假建置、假比較、假安裝）會不會讓真的問題測不出來。

### Claude 自己選了做法的地方（請逐點回覆）

1. 本機紀錄 `.local/` 放在主資料夾（git 共用目錄的上一層），各 worktree 共用同一份登錄與正式產物；不在 git 裡時用 repo 根目錄的 `.local/`。
2. 測試 vault 用 `npm run install-vault -- <vault> --register-test` 登錄，存登錄當時的實際路徑；比對時登錄的與目標的都再 `realpath`，Windows 不分大小寫；不存在的登錄略過。
3. 不帶 `--dev` 裝到登錄過的測試 vault 照舊（建置到 repo 根目錄再複製，不查正式版的條件、不存 `.local/releases/`）。
4. 正式版的 BUILD 檢查：建置第一行的 `dev=false`、`buildPlugin` 回傳的 `dev`，以及 BUILD 的 commit 是 HEAD 完整 SHA 的開頭、不帶 `.dirty`。
5. 同一個版號的 `.local/releases/` 已經有、雜湊相同就照用，不同就拒絕；`release.json` 讀不懂或檔案被改過也拒絕，不蓋過去。
6. `--release` 退回還沒檢查現有資料的 `需要版本`／`need`（任務說明寫明第二部分做完後才加）。
7. 測試與工具呼叫 git 都拿掉繼承來的 `GIT_*`；pre-commit 讀完暫存區就 `unset $(git rev-parse --local-env-vars)`。
8. 轉接器只有一個，用「那個版本有沒有這些函式」選；接不上、丟錯、子程序失敗都是「無法比較」。為了載入另一個版本的程式，`adapter.ts` 有兩行用 `eslint-disable-next-line essence/module-boundaries`（計算出來的模組名）。
9. 比較的設定用外掛現在的預設（30 分鐘、0.8、沒有濾網），因為設定頁還沒做；每個目標的下次到期用整份紀錄重播（`replay` + `dueAt`），到期已過的算在今天；今天的份含 `share` 與 `more`，每一張單獨放進 `share` 讓 `nextCard` 出它，記下第一題的指紋。
10. 比較用的 worktree 用 Node 的 `fs.rm` 刪掉再 `git worktree prune`，不用 `git worktree remove --force`；`npm ci` 加 `--ignore-scripts`（`prepare` 會改 git 設定）。
11. 更新命令的基線：先比 vault 裡的 `main.js` 和 `.local/releases/` 的雜湊，再讀 BUILD；基線缺失時照樣寫一份報告說明原因，不比較。
12. `--check` 的紀錄存在 `.local/update-check.json`，`--install` 成功後刪掉；`--install` 要求同一個 vault、同一個 HEAD、同一份備份檔。
13. 考前提醒：沒有屬性區就是沒填日期；屬性區沒有結束、日期寫法不對、讀不到都是「讀不到」；只寫結束日的用結束日判斷是否生效；好幾份生效時用有日期的裡面開始日最早的，都沒日期才是「日期未定」。需要 `--exam-ok` 的是前 7 天內、考試期間、讀不到。
14. 更新命令多了 `--to`（備份位置）：測試要用；也是封裝 App 時的出路。
15. `lastVersions` 放在 `src/core/backup/`（study 不能反過來 import backup 的檔名規則）；衝突副本同時間不同值時，`build` 是 null、標記仍是「衝突副本」。
16. 偵測到備份的實際路徑在 `AppData\Local\Packages\<App>\LocalCache\` 時印提醒（見下一節）；預設位置沒改，等使用者決定。

### 行為與風險

- 外掛的行為不變：`src/main.ts`、`state`、排程沒改。`study` 多匯出 `parseTime`（第一輪）。
- **兩次環境事故**（都已修，請確認防線夠）：`de7627b` 第一次 commit 時，pre-commit 裡的安裝測試在暫存資料夾跑 `git init`，吃到 hook 的 `GIT_DIR`，把共用 `.git/config` 的 `core.bare` 改成 `true`，所有 checkout 壞了幾分鐘（已改回）；`7edc242` 開發時，比較的測試在暫存 worktree 放了指回 repo 的 `node_modules` junction，用 `git worktree remove --force` 收尾，把這個 worktree 的 `node_modules` 刪光（重跑 `npm ci` 恢復）。
- **封裝 App 的檔案虛擬化**：在 Claude 桌面 App 裡跑的 Node，寫進 `%LOCALAPPDATA%` 的東西實際存在 `AppData\Local\Packages\Claude_…\LocalCache\Local\`（原生 `realpath` 看得到），App 外看不到、解除安裝會刪掉。只加了提醒；預設位置等使用者決定。
- 實機：Claude 用測試 vault 的備份跑過真的 `compare-versions 048adf0 HEAD`（開兩個 worktree、`npm ci`，28 秒，零差異，沒有殘留的 worktree）；用暫存的登錄資料夾對測試 vault 跑過 `checkUpdate`（測試 vault 裝的是別的 session 的 `.dirty` 開發版，所以是基線缺失，報告與原因正確；120 秒，大部分是 `npm run check`）。沒有對任何 vault 跑 `--install`、沒有正式安裝。

### 驗證方式

- Claude 在 `d3e2fad` 跑 `npm run check`：613 項全過。沙箱與環境的注意照上面〈驗證方式〉。
- 只看這一輪的測試：`node --test --test-concurrency=1 tests/install.test.ts tests/compare-versions.test.ts tests/update-vault.test.ts tests/build.test.ts tests/backup-core.test.ts`。

### 回報

接在同一份[回報](<../Claude Codex Discussion/2026-10-29-update-safeguards-1-review.md>)的最後，標題「Codex 第二輪（日期）」；照上面〈回報〉的格式，「請特別看」7 點與「Claude 自己選了做法的地方」16 點逐點回覆。
