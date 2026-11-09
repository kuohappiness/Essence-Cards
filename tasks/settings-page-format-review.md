# 設定頁的格式查核（給 Codex）

狀態：待查核（2026-11-09）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。

[任務說明](settings-page.md)會讓外掛第一次寫 `data.json`，並讓 `state` 的排程吃到使用者改的值，開工前要查核格式（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點）。程式還沒寫。

## 基準與工作位置

- 這份請求在分支 `claude/lucid-haslett-8b2b19`，還沒進 `main`。請在這個資料夾裡查（分支已經 checkout 在這裡）：`D:\程式開發\Essence Cards\.claude\worktrees\musing-kowalevski-696591`。基準是 `git log -1 --format=%h -- tasks/settings-page-format-review.md`。
- 實作會在 AI 製卡最小版合併後 merge 最新的 `main`。`src/state/index.ts`、`src/main.ts` 請同時看分支 `claude/ai-cards-mvp`（`git show claude/ai-cards-mvp:<路徑>`）。
- 同期還有[補紀錄缺口](record-gaps.md)，負責寫 `set: cap`、`retention`、`filter`、`semester`，程式也還沒寫。

## 讀什麼

- [任務說明](settings-page.md)的〈使用者的決定〉、§1、§2、§3、§4、§7；其他節只在判斷格式需要時看。
- [record-gaps.md](record-gaps.md) 的 §1（只看 `cap`、`retention`、`filter`、`semester` 那幾列與「一個出口」）。
- [syntax §5](../docs/syntax.md#5-複習紀錄)、[§8 備份檔](../docs/syntax.md#8-備份檔)。
- 決定：D-104、D-105、D-149 第 3、7 點、D-150 第 4 點、D-156。查法：`node experiments/tools/decisions-index.mjs D-xxx`。
- 程式：`src/state/index.ts`（`createState`、`load`、`replan`、`input`）、`src/main.ts` 的 `start`、`src/core/study/plan.ts` 的 `planToday`、`src/core/catalog/index.ts` 的 `latestTerm`、`src/core/backup/plan.ts`、`tools/update-vault.ts`。
- Obsidian 的實際行為：任務說明 §2 引的 `readJson`、`writeJson`、`_onConfigFileChange`，在 `%APPDATA%\obsidian\obsidian-1.15.0.asar` 的 `app.js`（只讀不執行）。

## 要查的事

1. **`data.json` 的欄位**（§1）：平的四個設定欄位加 `semesterSetOn` 夠不夠、有沒有多的；不加格式版本可不可以；舊版外掛（`0.3.0` 不讀這個檔）與日後新增選項時讀不讀得到；選項以外的值當成沒設定、原值保留，有沒有反例。
2. **對 Obsidian 的判斷**（§2）：`loadData` 的 `null` 與 `undefined` 的差別、`saveData` 吞掉錯誤、iPhone 可能不呼叫 `onExternalSettingsChange`，讀到的程式碼是不是真的如此；有沒有漏掉會蓋掉設定的路徑。
3. **寫前重讀與核對**（§2）：排隊、讀回核對、讀不到時不寫，夠不夠滿足 D-149 第 7 點；iCloud 同步的時間差、衝突副本、兩台幾乎同時改時，會不會丟掉不該丟的值。
4. **備份、還原、更新**：`data.json` 從「不存在」變成「存在」之後，`absent`／`files`、還原計畫、更新命令的 `--check` 判斷會不會出問題。
5. **`state` 的介面**（§3）：`settingsFirst` 併進第一次載入的等待，有沒有讓 `ready()` 卡住或第一次排程用錯值的路徑；`known` 的語意夠不夠讓補紀錄缺口不把預設值寫成基準；`applySettings` 只在值變了才重排，和換日、考試範圍的重排有沒有互相蓋掉；重排對開著的複習畫面（`next` 的 `stale`）有沒有影響；今天已答的目標改上限後還算不算完成。
6. **`semester` 的語意**（§4）：「走過每個 2/1 與 8/1」的規則和 D-104 有沒有矛盾；§7 那張表有沒有算錯或漏掉的情況；不寫檔、每次用時算，和 `set: semester`（D-105）的回測需求合不合得起來；`semesterSetOn` 用清晨 4 點換日有沒有問題。
7. **邊界與測試**：§7 的清單漏了哪些應該寫成測試的情況。

只回報有證據的；不擴張成新的功能（濾網、AI 製卡一區都在之後的任務）。

## 回報

寫在 `Claude Codex Discussion/2026-11-09-settings-page-format-review.md`，在上面那個資料夾 commit 到分支 `claude/lucid-haslett-8b2b19`（只提交這份回報，不 push）。每項寫結論、證據、建議（照寫／改寫法／加例子）；最後一行寫沒查的項目與原因。
