# 外掛內的還原畫面（Codex L2 審查請求）

狀態：待審（第一輪，2026-11-10）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 Codex 對話**；只審查、不改產品程式，可以在隔離環境重現。

[任務說明](plugin-restore.md)會改寫使用者資料（卡組、圖片、`data.json`、新增還原檔），又動 `state` 的寫入閘門與 `Files` 的契約，屬於[高風險範圍](../docs/agents/quality.md#高風險範圍要做-l2)，合併前做 L2。

## 審查對象

- 分支 `claude/competent-driscoll-58f746`（worktree 在 `.claude/worktrees/musing-kowalevski-696591`），工作區乾淨。
- **共同祖先**：`origin/main` 的 `a33c7d5fc136abbe173470c11f1c1f2dfaae7c2f`。整包差異用 `git diff a33c7d5...0452a3b576df1260120d702b1f1762b00257611e`。
- **規格基準**：`1859de7319018958d66b60ebc86fafb8f14f06db`（使用者同意的版本）。之後對規格只動〈狀態〉與〈結果〉（§8 第 1 點的實測也記在〈結果〉）。
- **待審 commit**（第一輪，整包）：
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
