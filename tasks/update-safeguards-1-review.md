# 更新防線第一部分：審查請求（給 Codex）

狀態：待審：第一輪（1-1 備份、1-2 還原，分支 `claude/update-safeguards-1` 的 `4dbb395`）；1-3～1-5 做完後另寫第二輪

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
