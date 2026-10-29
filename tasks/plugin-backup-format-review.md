# 外掛內備份開工前的格式查核（給 Codex）

狀態：等 Codex（2026-10-30 請求）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**，不要用查過更新與相容討論稿或更新防線的那一個。

依 [D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點與 [quality.md〈開工前的格式查核〉](../docs/agents/quality.md#開工前的格式查核)：[外掛內的備份](plugin-backup.md)會由外掛自己寫備份檔，`by` 要加三個值。Claude 已照任務說明 §0 改了 `docs/syntax.md` §8，第一部分的程式等這次查核一致才開工。**只回報，不修改**任何檔案；要改的由 Claude 改。

## 基準

- 這份請求所在的 commit（`git log -1 --format=%h -- tasks/plugin-backup-format-review.md`），在 `main`。syntax.md 的改動和這份請求在同一個 commit：`git show <那個 commit> -- docs/syntax.md`。
- 程式以同一個 commit 的 `main` 為準。正式使用的 vault 裝的是 `0.1.0`，外掛本身不讀備份；讀備份的只有 repo 裡的工具。

## 讀什麼

| 讀什麼 | 為什麼 |
|---|---|
| `docs/syntax.md` §8（全節，這次改的是表格的 `vault`、`build`、`by` 三列） | 這次要查的格式 |
| [任務說明](plugin-backup.md) §0、§1-1、§1-4、§1-7 | 格式要支撐的外掛行為：三種時機、localStorage 記的上次備份、清理舊備份 |
| [D-150](../docs/decisions.md#d-150-備份與還原) 第 2、5、6、9 點，[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 7 點 | 要對照的決定 |
| [討論稿](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md>)〈Codex 格式查核（2026-10-29）〉細項 7 與 F3、F4，〈Claude 回應 Codex 格式查核〉 | 上一輪定 §8 時的結論 |
| `src/core/backup/manifest.ts`、`zip.ts` 的 `openBackup`、`names.ts`；`tools/backup.ts`、`tools/restore.ts`、`tools/compare-versions.ts`、`tools/update-vault.ts` 的備份那段；`tools/vault-io.ts` 的 `sameFileKey`、`defaultBackupFolder` | 現在寫與讀備份的程式 |

其他文件不用讀。

## 要查的事

1. **和 §8 其他欄位、讀備份的一方的規則有沒有矛盾**：`by` 的三個新值（`new-version`、`monthly`、`manual`）與 `restore` 兩邊共用；`new-version` 的定義（這台電腦還沒有這個建置版本成功備份的紀錄，含紀錄被清掉、記的那份找不到）和任務說明 §1-4 的觸發條件是否一致；`tool` 照舊寫「外掛自己做的和 `build` 相同」有沒有問題。
2. **已有的讀的一方讀到新的 `by` 會不會出事**：`readManifest`、`openBackup`、`tools/restore.ts`（還原與還原前先備份）、`tools/compare-versions.ts`（拿備份當凍結輸入）、`tools/update-vault.ts`。有沒有任何地方以 `by` 的值做判斷；新加的「讀的一方只拿來顯示，不認得的值照常讀」和現在的程式是否一致。Claude 看過：`readManifest` 只檢查 `by` 是字串，其他地方只在寫的時候給值；請獨立確認，不要只看這段。
3. **Claude 在任務說明之外補的兩點**（逐項說同不同意，不同意附反例或理由）：
   1. `build`：外掛寫正在執行的外掛的 `BUILD`，不另外讀 `main.js`。理由：外掛知道自己是哪一版；`new-version` 的意思是「這個建置版本還沒備份過」，localStorage 記的也是執行中的版本，兩者要對得上；讀 `main.js` 還要經 adapter 讀設定資料夾。反方：過渡工具讀 `main.js`，兩邊寫法不同。請查有沒有讀的一方依賴「`build` 等於當時 vault 裡的 `main.js`」。
   2. `vault.path` 比較時照這台電腦的檔名規則（Windows 不分大小寫）：清理時要把更新命令放在同一個預設資料夾的備份一起算（任務說明 §1-7）。外掛打算和 `tools/backup.ts` 一樣用 Node 的 `realpath` 再把 `\` 換成 `/`（Obsidian 電腦版的 Electron 裡有同一個 Node）；Obsidian 給的 vault 位置是 `adapter.getBasePath()`。請查兩邊寫出來的 `path` 會不會不同（磁碟代號大小寫、結尾的分隔符、連結、`\\?\` 前綴）；不同時清理只會少刪、不會多刪，算不算可以接受。
4. **清理用到的格式**（任務說明 §1-7）：「檔名照 §8」怎麼判斷才寫得成測試（日期、時分秒、`BUILD` 或 `未知`、隨機 4 碼）；`.zip.tmp` 殘留（Obsidian 在寫到一半被關掉）要不要另外處理；同一個 vault、`config` 不同的備份算不算同一個 vault；`name` 相同但 `path` 不同（搬過 vault）時不刪是否就夠。
5. **邊界有沒有寫清楚、能不能寫成測試**：這次改的三列，每一條能不能直接寫成測試的輸入與預期；說法有兩種讀法的列出來。
6. 其他你認為第一部分開工前就該改的格式問題。

## 回報

照任務說明 §0，寫在[討論稿](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md>)最後，標題「Codex 格式查核：外掛內備份（日期）」，只追加、不改前文；commit 只含這個檔案（訊息 `docs: Codex's format check for plugin backup`）：

- 逐項列出「通過」或「有問題」。有問題的附檔案、行號、原因與建議的寫法，標 P1～P3，並分成「開工前要改」和「實作時再定」。
- 你跑過的探針或測試（只用自編資料，不碰任何真的 vault），以及沒有查的項目與原因。
