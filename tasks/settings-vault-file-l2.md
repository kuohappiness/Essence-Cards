# 設定換到 vault 裡的一般檔（Codex L2 審查請求）

狀態：待審（2026-11-12）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 Codex 對話**；只審查，不改產品程式與文件；可以在隔離的暫存資料重現，不碰測試 vault 與正式使用的 vault。

[任務說明](settings-vault-file.md)把外掛的設定從 `<設定資料夾>/plugins/essence-cards/data.json` 搬到 `Essence Cards/設定.json`（[D-201](../docs/decisions.md#d-201-設定改存-vault-裡的一般檔電腦不再寫-datajson)），改了寫進使用者檔案的格式與位置、還原的「設定」那一列和舊版的相容，屬於[高風險範圍](../docs/agents/quality.md#高風險範圍要做-l2)，合併前做 L2。

## 審查對象

- 分支 `claude/settings-vault-file`，worktree 在 `.claude/worktrees/musing-kowalevski-696591`。沒有 push，請在這個 worktree 讀。
- 和 `main` 的共同祖先：`9b2c1338e28d2f43fa2491eb01b77ed41aafa545`（當時最新的 `main`）。
- 待審：共同祖先到這份請求所在的 commit（`git log -1 --format=%H -- tasks/settings-vault-file-l2.md`）的全部改動，hash 寫進報告。
  - 程式：`0b26915`、`4d7af77`、`cb4fda0`、`29aa8af`、`f421079`、`f645c66`，格式查核之後的修正 `f26aeb2`、`d85d129`、`1f5b135`。
  - 文件：`9cbdf72`、`e9d2d50` 與這份請求所在的 commit（D-201、syntax、architecture 等）。
- 格式查核已做，發現與處理見[查核報告](<../Claude Codex Discussion/2026-11-12-settings-vault-file-format-review.md>)最後的〈Claude 整合〉；那三個修正 commit 在這次一起審。

## 規格與優先順序

- 任務說明 [settings-vault-file.md](settings-vault-file.md) §1～§6（格式查核後改過）與 [D-201](../docs/decisions.md#d-201-設定改存-vault-裡的一般檔電腦不再寫-datajson)。
- 它引用的：[syntax §8、§10](../docs/syntax.md#10-設定)、[D-104](../docs/decisions.md#d-104-設定頁)、[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 3、7 點、[D-150](../docs/decisions.md#d-150-備份與還原)；原本的設定與還原規則在 [settings-page.md](settings-page.md)、[plugin-restore.md](plugin-restore.md) §4。
- 規格衝突時列成問題，不挑容易通過的那份。

## 行為與風險

- **公開介面**：`src/core/settings/index.ts` 新匯出的 `SETTINGS_FILE`、`createSettingsFile`、`decodeSettings`、`encodeSettings`、`overlayLegacy`、`dropLegacy`、`isSettingsPath`、`restoreSaved`；`SettingsStoreOptions.seed`；`src/core/backup/index.ts` 的 `settingsNow`、`sameSettingsNow`。
- **呼叫端**：`src/main.ts`（store 的 `load`／`save`／`seed`、`Files.watch`、本機確認值）、`src/obsidian/settings.ts`（設定檔讀不到那一列與「重新建立」）、`src/core/backup/plan.ts`、`restore.ts`、`src/obsidian/restore.ts`、`restore-modal.ts`、`tools/restore.ts`、`tools/compare/adapter.ts`、`tools/compare-versions.ts`、`tools/update-vault.ts`。
- **不可破壞的性質**：
  - 任何路徑都不寫 `data.json`：設定頁、重新建立、外掛與命令列的還原。
  - store 的隊伍、讀回核對、`known` 的規則不變：讀不到不寫，手上的值不變；不認得的欄位與讀不懂的值存檔時留著。
  - 疊 `legacy`（§2）：新版改的不被 `data.json` 的舊值蓋掉；舊版改的讀得懂才採用，整項拿掉是回預設；存進去的 `legacy` 和當底的是同一次讀到的 `data.json`。
  - 設定檔不見時（§3）：確認過的裝置用本機的值、`known` 是 false、不寫觀察行、不自動重建；「重新建立」走 store 的隊伍，再讀一次還是不存在才寫。
  - 還原（§4）：來源、目的地、比對與寫入規則；寫前另外比現在的值；`legacy` 是寫入當下的 `data.json`。
  - 舊版（`v0.4.0`）不把設定檔當卡組或紀錄（§6-12）。
- **邊界例子**：任務說明 §6 第 1～17 點都有測試；§5 列了會丟掉舊版改動的三種情況，是接受的取捨。例子只是起點，請找新的組合。
- **明確不做**：任務說明〈這次不做〉；`0.4.0` 還原新版備份會出兩列（§4 最後一點，不寫測試的理由在 §6 最後）。

## 驗證方式

- 每個程式 commit 的 pre-commit 都跑完整的 `npm run check` 並通過；最後一個是 `1f5b135`。文件 commit 跑讀到那幾份文件的測試。Codex 在沙箱裡跑 `npm run check` 會有環境造成的固定失敗，完整的要在沙箱外跑（[quality.md](../docs/agents/quality.md)）。
- `f26aeb2`、`d85d129` 的新測試在拿掉修正後都會失敗（各試過一次）。
- 平台事實表（任務說明 §7）都有結果：Windows 的 `.json` 事件、原地寫、localStorage、iPhone 的 `.json` 事件。
- 實機（任務說明 §8 與〈結果〉）：V1（`0.4.0+f645c66`）、V2～V4（`0.4.0+e9d2d50`）在測試 vault 跑過。
- **沒跑的**：舊版 iPhone 與新版電腦真的混用（疊 `legacy` 只有單元測試）；`install-vault --release` 實際退回 `0.4.x`；iPhone 的設定檔不見與「重新建立」。

## 實作者自己選的做法（請先看）

1. **§3「store 一開始就用這筆」做成 store 的 `seed` 選項**：`first()` 在第一次讀之前就用確認過的值並通知，`known` 是 false；讀到才換掉。
2. **讀得懂的判準**：疊的時候用 `readSaved` 讀 `data.json` 的那一項，讀不出值（不是設定頁的選項、學期缺一半、不存在的日期）就不採用。
3. **`legacy` 寫在 JSON 的最後**，其他欄位照 store 交來的順序。
4. **還原寫前的核對**：外掛在設定檔的雜湊相同之後，另外讀 `data.json`，用 `settingsNow` 算出現在的值和比對時的比；命令列在 `--apply` 時重算計畫，「設定」那一列比 `settings.current`。
5. **比較工具**：新版那一側模擬沒確認過設定檔的一台（`confirmed` 回 null），`modify` 一律拒絕；沒帶設定檔的備份照舊走 `data.json`。
6. **還原結果的標題**：目的地等於 `SETTINGS_FILE` 才顯示「設定」。

## 回報

- 寫在 `Claude Codex Discussion/2026-11-12-settings-vault-file-l2.md`，標題下第一行寫狀態。
- 每項發現寫觸發條件、預期與實際、影響、位置與證據，區分「已重現」「靜態推斷」「待驗證」，另標**真實路徑會不會發生**（使用者的資料、Obsidian 與 iCloud 的實際行為、已發布的 `0.4.0` 會不會產生這個輸入）。可以回報「規格本身有漏洞」。
- 頭尾寫待審 commit、審查範圍、測試結果，以及沒驗的項目與原因；跨模組的因果或「走不到」的判定，補上關鍵的呼叫鏈或邊界保證。
