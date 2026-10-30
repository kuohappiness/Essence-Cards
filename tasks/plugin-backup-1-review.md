# 外掛內的備份第一部分：審查請求（給 Codex）

狀態：B1～B6、C1、C2、D1 都已修好（`d3d20b7`），等第三次再審（見文末〈第三次再審〉）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（第一次用到 Node／Electron 的電腦專用資料夾、`state` 的寫入閘門、跨模組，屬於 [quality.md](../docs/agents/quality.md) 的高風險範圍）。請**新開一個 session**。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-plugin-backup-1`，分支 `claude/plugin-backup-1`，已推上遠端；沒有未提交的修改。
- **待審的範圍是 `git diff 5d17605c61b7e2ba146282c45632c407d7eb226f 99087ae844bf7ddc306e24703c510d8f7acaf4e9`**：分支在目前的 `main`（`5d17605`）之上的全部改動。分支從 `499f945` 開，`99087ae` 把 `main` 合進來（`main` 這段只有文件，沒有程式）。
- Commit（舊到新）：`43890e7` `Files.readBytes`（§1-2）、`245f085` `state` 的備份閘門與存檔按鈕的對應表（§1-4、§1-6）、`5e942e0` 備份程序搬進核心、`src/desktop/`、時機與清理、設定頁、D-148 的檢查（§1-1、§1-3～§1-8）、`9022713` zip 的 EOCD（§1-8 第 2 列）、`fc1a1cb` 開發命令 `backup`、找不到磁碟的訊息、路徑換行、`7f0df58` 設定頁改成「備份」一區（D-156）、`99087ae` 合併 `main`。

## 規格與優先順序

| 規格 | 位置 |
|---|---|
| 任務說明 | [plugin-backup.md](plugin-backup.md) §1（1-1～1-10）與〈結果：第一部分〉 |
| 格式 | [syntax §8](../docs/syntax.md#8-備份檔)：`by`、`build`、`vault` 的比較、讀備份的一方（含「自動清理只認完整的備份」）、外掛的備份不含以點開頭的檔 |
| 決定 | [D-150](../docs/decisions.md#d-150-備份與還原) 第 1～6、10 點，[D-148](../docs/decisions.md#d-148-電腦專用的主機接點)，[D-154](../docs/decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測)，[D-156](../docs/decisions.md#d-156-設定頁依功能分區不寫給家長)，[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 7 點 |
| 格式查核的結論 | [討論稿](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md>)〈Codex 格式查核：外掛內備份〉BF1～BF3、BR1～BR3 與〈Claude 回應〉 |
| 一起完成的技術債 | [backlog 技術債](../docs/backlog.md#技術債)：「備份與還原只考慮一個程序在跑」（只做備份那一半）、「zip 的註解裡剛好有 EOCD 簽章」、「存檔按鈕的受阻原因各自判斷」、「D-148 的檢查會漏掉別的 `require` 寫法」 |

規格之間有衝突時列成問題，不挑容易通過的那份。

## 行為與風險

- **公開介面**：`Files.readBytes`（`src/core/files.ts` 與三個實作、契約 C16）；`src/core/backup/` 的 `takeBackup`、`checkWritten`、`filesReader`、`createBackupRunner`、`staleBackups`；`src/desktop/index.ts` 的 `createDesktop`，`src/desktop/io.ts`、`backup.ts`（`tools/vault-io.ts` 重新匯出）；`State` 的 `backupReady`、`writeBlock` 與 `StateOptions.backup`；`tools/build.mjs` 的 `desktopOnly`、`desktopViolations`；`eslint.config.js` 的邊界規則。
- **不可破壞的性質**：沒有成功的備份之前，Cards 不改寫卡組（存檔、離開時補 ID、待處理的兩個選項），作答照常寫；備份失敗不刪任何既有的備份；正式檔名不覆寫；清理只刪 syntax §8 認得的、同一個 vault 的；手機不載入 `src/desktop/`、不建立計時器；`tools/backup.ts` 的行為與既有測試不變。
- **已知邊界**（例子只是起點，請找新的組合）：記的那份不見、雜湊不同、BUILD 不同、localStorage 被清掉；恰好 30 天；並行的要求、前一份失敗；清理的時區、跨月、同一毫秒、時鐘倒退；暫存檔殘留；連到 vault 的連結、MSIX；Obsidian 不索引的檔；卸載時正在備份。
- **明確延後**：還原畫面（第二部分）；排除 Capture 教材；入口畫面的「給家長」一區（backlog 的待決問題）；設定頁的其他區。

## 驗證方式

- `npm run check`（型別、ESLint、knip、secretlint、skill 副本、文件、測試）。照 [quality.md〈檢查指令〉](../docs/agents/quality.md#檢查指令) 在沙箱外跑；沒辦法時逐項列出失敗的測試，說明哪些是環境造成的。
- 主要的測試檔：`tests/backup-take.test.ts`、`backup-desktop.test.ts`、`backup-runner.test.ts`、`backup-core.test.ts`（EOCD）、`state-gate.test.ts`、`save-wiring.test.ts`、`main-wiring.test.ts`（替身上真的跑 `src/desktop` 的備份）、`build.test.ts`（D-148 與手機替身載入正式 `main.js`）、`quality.test.ts`（ESLint 規則）、`files-contract.test.ts`。
- 實作者跑過：每個 commit 的完整 `npm run check`（最後 800 項全過）；Windows 實機見任務說明〈結果：第一部分〉。沒跑：Mac、Linux、真的 exFAT 外接硬碟、外掛與更新命令真的同時備份。需要 Obsidian 實機的部分不用重做。

## 實作者自己選的做法（請先看這些）

1. **排程放在 `src/core/backup/runner.ts`**：時機、排隊、閘門的狀態、清理都在核心，讀寫由外面傳進來（`BackupHost`、`BackupStore`、`BackupReader`），Node 測得到。Obsidian 這一層（`src/obsidian/backup.ts`）只接 localStorage、通知與 6 小時的計時器。
2. **任何一次失敗都關閘門**（包括手動、每月），直到下一次成功；失敗不存進 localStorage，重新載入時只要記的那份對得到就打開。同一次載入裡手動失敗後，30 天內的 `check` 不會自己打開。
3. **記的那份到它當時的資料夾去對**（`LastBackup.folder` 是實際路徑），不是現在設定的位置：換位置不讓既有的備份失效，下一次備份才寫到新位置。`verified` 讀不到或讀錯一律當成對不到，會重做 `new-version`。
4. **`LastBackup.time` 是 `started`**；新版與每月同時符合記 `new-version`；並行的要求共用同一個 Promise（`check` 也是）。
5. **不覆寫的提交**（`src/desktop/io.ts` 的 `commitNew`）：先建硬連結，成功後刪暫存名；硬連結失敗而且不是 `EEXIST` 時，改成 `open(…, 'wx')` 獨占建立正式檔名、寫同一份位元組、讀回比對。暫存名或正式檔名已經有了就換隨機碼，最多 20 次。
6. **刪舊備份前再確認**：資料夾的 `realpath` 沒變、`lstat` 的身分在讀前讀後相同、大小與雜湊相同；確認到刪之間沒有鎖（照實寫在註解）。
7. **EOCD**：從檔尾往前找第一個「註解長度剛好到檔尾、單一磁碟、兩個筆數一致、中央目錄剛好接在前面」的；有註解時先去掉註解再交給 fflate，嚴格名稱檢查用同一份。結果是「根本不是 zip」的錯誤訊息從 fflate 的改成「找不到 zip 的中央目錄」（兩個舊測試的預期跟著改）。
8. **`writeBlock` 的順序**：phone、loading、closed、backup、unread；備份排在讀不到之前。存檔按鈕仍訂閱 `ready()` 來更新按鈕，備份的閘門變了由 `main.ts` 更新按鈕。`needs-update` 照舊由 `deckStatus` 回答，B7 的不一致照舊。
9. **D-148 的 ESLint**：`src/` 一律不准 `require`（呼叫、別名、成員、字串與樣板字串索引、當成值），放行清單是 `src/obsidian/dev*.ts`（正式建置不含它們）；Node 與 Electron 只在 `src/desktop/`、只准明列的五個；`src/desktop/` 只能由 `src/main.ts` 動態 import，其他檔只能 `import type`；`@codemirror` 只在 `src/obsidian/` 與 `main.ts`。
10. **D-148 的建置**：esbuild 外掛只對 `src/desktop/` 引入的明列模組設成外部，其他引入讓建置失敗；建完再用 metafile 查一次。Electron 放在 `src/desktop/shell.ts` 靜態 import、由 `index.ts` 動態載入：直接寫 `import('electron')` 時 esbuild 會留成 ESM 的動態 import，Obsidian 裡載不到。
11. **data.json 經 adapter**：每次列檔先用 adapter 確認 `<configDir>/plugins/essence-cards/manifest.json` 存在，確定不了就整份失敗；`vault` 的名稱與路徑由 `src/desktop` 從 `getBasePath()` 的 `realpath` 取。
12. **通知**：同一個「步驟＋訊息」這次載入只通知一次；文字照 D-156 不寫角色。找不到磁碟時寫「備份位置 … 所在的磁碟找不到（ENOENT）」。
13. **測試的替身**：`tests/helpers/obsidian.ts` 給了 `vaultPath` 的電腦替身可以 `require` `node:` 模組，接線測試因此在暫存資料夾真的跑一次外掛的備份；手機替身仍然碰到 Node 就丟錯。
14. **開發命令 `backup`**（`src/obsidian/dev-backup.ts`，只在開發版）：碰 Obsidian 的設定視窗內部（`app.setting`、`pluginTabs`、分頁的私有方法）只為了截圖與模擬，不是產品介面。

## 回報

寫在新的討論稿 `Claude Codex Discussion/2026-10-30-plugin-backup-1-review.md`，標題「Codex L2：外掛內備份第一部分（日期）」；commit 只含這個檔案（訊息 `docs: Codex's L2 review of plugin backup part 1`）。照 [code-quality 的 review.md](../.claude/skills/code-quality/review.md)：

- 每項發現寫觸發條件、預期／實際、影響、位置與證據，標 P1～P3，並區分「已重現」「靜態推斷」「待驗證」；同一個問題只報一次，標明是規格軸還是規範與設計軸。可以回報「規格本身有漏洞」。
- 上面「實作者自己選的做法」逐條說同不同意。
- 跑過的指令與結果、沒有查的項目與原因、驗證的 SHA。

## 再審（B1～B6 的修正，2026-10-30）

請**新開一個 Codex session**（推理等級：高）。不改產品程式；只把再審結果追加在[回報](<../Claude Codex Discussion/2026-10-30-plugin-backup-1-review.md>)最後（標題「Codex 再審（日期）」），並 commit 那一個檔（訊息 `docs: Codex's re-review of plugin backup part 1`）。

- **範圍**：`git diff 99087ae844bf7ddc306e24703c510d8f7acaf4e9 6bf966a1583be22ad789ec12e0eb3d3a0b640264`，六個修正 `a0bdc75`（B1）、`d801063`（B3）、`e592e8a`（B2）、`0c51f03`（B4）、`435a315`（B5）、`6bf966a`（B6），處理方式見回報的〈Claude 回應 Codex L2〉。worktree 與分支同上，沒有未提交的修改。
- **要看的**：每個修正是否真的擋住原本的反例（上次的重現腳本把預期改成正確行為後重跑）、相鄰的組合（例如 B1 與 B3 同時發生：記的那份失效時手動備份已經在做；B2 取消發生在寫正式檔之後、清理之前；B5 的規則有沒有誤擋 `src/` 裡正常的寫法；B6 選了預設位置的連結）、回歸測試是否只透過公開介面。
- **驗證**：沙箱外的 `npm run check`（照 [quality.md〈檢查指令〉](../docs/agents/quality.md#檢查指令)），記下驗證的 SHA。

## 第二次再審（C1、C2 的修正，2026-10-30）

請**新開一個 Codex session**（推理等級：高）。不改產品程式；只把結果追加在[回報](<../Claude Codex Discussion/2026-10-30-plugin-backup-1-review.md>)最後（標題「Codex 第二次再審（日期）」），並 commit 那一個檔（訊息 `docs: Codex's second re-review of plugin backup part 1`）。

- **範圍**：`git diff 6bf966a1583be22ad789ec12e0eb3d3a0b640264 825cadc8eb1b8fd4e1141a5ac57e5e43f56157cf`，兩個修正 `9bb75f9`（C1）、`825cadc`（C2），處理方式見回報的〈Claude 回應 Codex 再審〉。worktree 與分支同上，沒有未提交的修改。
- **要看的**：C1 的兩種時機用上次的相鄰腳本、把預期改成正確行為重跑；「開始過幾份備份」的比對和 B1、B3 的修正放在一起時的相鄰組合（例如核對期間開始的那一份失敗、核對期間有兩份先後開始又做完、核對期間外掛停用）；C2 的負例（計算的成員、解構的屬性名、`Reflect` 的引數）照樣擋，普通字串資料通過。
- **驗證**：沙箱外的 `npm run check`，記下驗證的 SHA。

## 第三次再審（D1 的修正，2026-10-30）

請**新開一個 Codex session**（推理等級：高）。不改產品程式；只把結果追加在[回報](<../Claude Codex Discussion/2026-10-30-plugin-backup-1-review.md>)最後（標題「Codex 第三次再審（日期）」），並 commit 那一個檔（訊息 `docs: Codex's third re-review of plugin backup part 1`）。

- **範圍**：`git diff 825cadc8eb1b8fd4e1141a5ac57e5e43f56157cf d3d20b7eb997f680f152be117da2594e2e804e8d`，一個修正 `d3d20b7`（D1），處理方式見回報的〈Claude 回應 Codex 第二次再審〉。worktree 與分支同上，沒有未提交的修改。
- **要看的**：D1 的兩個取消反例用上次的相鄰腳本、把預期改成正確行為重跑；取消的相鄰時機（取消發生在 `check` 剛開始還沒核對、在手動要求排隊時、在讀 vault 與寫正式檔之間）是否都安靜結束、不動磁碟、沒有沒人接的拒絕；先前通過的 B1～B6、C1、C2 不受影響。
- **驗證**：沙箱外的 `npm run check`，記下驗證的 SHA。
