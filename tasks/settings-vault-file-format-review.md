# 設定換到 vault 裡的一般檔（格式查核，給 Codex）

狀態：等 Codex（2026-11-12）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。

D-199 的修法，使用者 2026-11-12 同意先做 A：外掛的設定從 `data.json` 換到 `Essence Cards/` 底下的一個 `.json`（[討論稿](<../Claude Codex Discussion/2026-11-12-settings-icloud-conflict.md>)〈Claude 回應 Codex 第二輪〉）。這會改寫進使用者檔案的格式、還原的「設定」那一列與舊版的相容，照 [quality.md](../docs/agents/quality.md#開工前的格式查核) 在實作前查格式。**只回報，不修改**任何檔案；要改的由 Claude 改。程式的 L2 另外請求，不在這次。

## 基準

- 這份請求所在的 commit（`git log -1 --format=%h -- tasks/settings-vault-file-format-review.md`），在 `main`。
- 程式還沒寫；現在的行為在 `main` 的 `src/core/settings/store.ts`、`saved.ts`、`src/main.ts:132`（`loadData`／`saveData`）、`src/core/backup/plan.ts`、`restore.ts`、`src/obsidian/restore.ts`、`restore-modal.ts`。

## 讀什麼

- [任務說明](settings-vault-file.md) 的 §1、§4、§5（必讀）；§2、§3 是讀寫的規則，查 §1 的 `legacy` 時需要。
- [syntax §10](../docs/syntax.md#10-設定)、[§8](../docs/syntax.md#8-備份檔)（路徑範圍、`data.json` 那一條）；決定 [D-104](../docs/decisions.md#d-104-設定頁)、[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 3、7 點、[D-150](../docs/decisions.md#d-150-備份與還原)。
- 討論稿只讀〈Claude 回應 Codex 第二輪〉；前幾輪需要時照標題查。

## 要查的事

1. **和已有的決定、syntax 有沒有矛盾**：位置 `Essence Cards/設定.json` 和系統資料夾（D-088、`src/core/deck/folders.ts`）、卡組與單元的掃描、AI 輸出與考試切面、錯誤紀錄的路徑規則有沒有衝突；檔名用中文與 `.json` 有沒有問題。
2. **舊的資料與舊版外掛**：`0.4.0` 讀到 vault 裡多了這個檔會不會出錯或誤判（卡組、紀錄、備份、還原、系統資料夾防呆）；舊版的還原遇到新版做的備份（裡面同時有設定檔與 `data.json`）會怎樣；命令列的工具（`tools/backup.ts`、`tools/restore.ts`、`tools/update-vault.ts`、`tools/compare-versions.ts`）。
3. **`legacy` 的規則**（§1、§2「疊 `legacy`」）：有沒有會讓設定默默錯掉的組合，例如 `data.json` 有讀不懂的值、兩台新版都在寫、舊版那台改了之後又被 iCloud 改名、新檔建立時讀不到 `data.json`、還原寫入時的 `legacy`。
4. **還原**（§4）：來源的優先順序、兩個都有時不列 `data.json`、現在沒有設定檔時和 `data.json` 比、只差 `legacy` 算相同；舊備份（只有 `data.json`）、新備份、現在讀不懂這幾種組合是否都寫清楚、能寫成測試。
5. **退版與混用**（§5）：寫法是否足夠，最低可退版本怎麼守（D-149 第 4 點的安裝檢查只看 `需要版本`、`need`，這次不加 `need`）。
6. 邊界有沒有寫清楚、能不能寫成測試；只回報有證據的。

## 回報

寫在 `D:\程式開發\Essence Cards\.claude\worktrees\musing-kowalevski-696591\Claude Codex Discussion\2026-11-12-settings-vault-file-format-review.md`（新檔，不用 commit，Claude 整合時會 commit；不要寫到 `D:\程式開發\Essence Cards` 底下）。每項寫結論、證據、建議（照寫／改寫法／加例子）；最後一行寫沒查的項目與原因。
