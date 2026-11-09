# 設定頁（Codex L2 審查請求）

狀態：第二輪待審；第一輪審 `8717c09`，[報告與核對](<../Claude Codex Discussion/2026-11-09-settings-page-l2.md>)。

## 第二輪（只審修正）

- **待審**：`8717c09`（完整 SHA `8717c0952246b18c85ed661a97b7efc774ae7f1c`）到 `69ae53e`（`69ae53e5b91c824e0ba6148f29e2a4ea5ae97eee`）的差異，以及受影響的路徑：`src/core/settings/store.ts` 的讀、採用與隊伍，`src/main.ts` 的停用與 `saveFailed`，`tools/compare-versions.ts` 的 `adapterInput`。不用整包重審。
- **先看**：報告最後的〈Claude 核對〉表，尤其 F3 不處理的新舊實例重疊、F4 採用晚到結果的條件（`writes` 計數，`!known`）、F6 不為電腦加計時器。
- **請特別試**：晚到的結果和隊伍裡的讀、存檔交錯；`close()` 和晚到的結果交錯；第一次讀逾時但 `classify` 把 `seenFile` 設起來之後，後面的 `null` 的判斷；重讀時 `fingerprint` 含學期造成的多餘通知。
- **F7** 是規格衝突，由使用者決定；文件的結果不用審。
- **驗證**：`69ae53e` 的 pre-commit（完整的 `npm run check`）通過；回歸測試在 `8717c09` 的 store 上跑，F1、F2、F3、F4、F6 五項失敗；修正後 Windows 實機 §8 重跑，35 項通過。沒跑的：iPhone、雙機同步。
- 報告接在 `Claude Codex Discussion/2026-11-09-settings-page-l2.md` 的後面，標「第二輪」。

以下是第一輪的請求，第二輪照用其中的回報格式。

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 Codex 對話**；只審查、不改產品程式，可以在隔離環境重現。

[任務說明](settings-page.md)新增外掛會寫的檔案（`data.json`），也改 `state` 與排程的輸入，屬於[高風險範圍](../docs/agents/quality.md#高風險範圍要做-l2)，合併前做 L2。

## 審查對象

- 分支 `claude/lucid-haslett-8b2b19`（worktree 在 `.claude/worktrees/musing-kowalevski-696591`）。
- 和 `main` 的共同祖先 `17781cb8095a546895846ae698961dfd8f4cc490`（已合併當時最新的 `main`，`ac55bcc`）。
- 待審：共同祖先到這份請求所在的 commit（`git log -1 --format=%H -- tasks/settings-page-l2.md`）的全部改動。程式：`94b4802`、`1e1dda2`、`804af70`、`99a8791`、`0708e51`；文件：`9ec4465`。
- 這條分支沒有 push，請在上面的 worktree 讀。沒有未提交的修改。

## 規格與優先順序

- 任務說明 [settings-page.md](settings-page.md) §1～§5、§7（格式查核已採用，[回報與核對](<../Claude Codex Discussion/2026-11-09-settings-page-format-review.md>)）。
- 它引用的：[syntax §10](../docs/syntax.md#10-設定)、[D-104](../docs/decisions.md#d-104-設定頁)、[D-156](../docs/decisions.md#d-156-設定頁依功能分區不寫給家長)、[D-102](../docs/decisions.md#d-102-學生也能調每日時間上限)、[D-078](../docs/decisions.md#d-078-目標保持率與考前提高)、[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 3、5、7 點。
- 規格衝突時列成問題，不挑容易通過的那份。

## 行為與風險

- **公開介面**：`src/core/settings/index.ts`（`readSaved`、`valueOf`、`savedKeys`、`changeSaved`、`semesterOn`、`createSettingsStore`）；`StateOptions.settingsFirst`、`State.applySettings`、`State.currentSettings`；`paintCatalog` 的第五個參數。
- **呼叫端**：`src/main.ts`（`store`、`todayText`、`onExternalSettingsChange`、`visibilitychange`）、`src/obsidian/settings.ts`（四列與學期一區）、`src/review/entry.ts`（`countdownOf`）、`tools/compare/adapter.ts` 與 `tools/compare-versions.ts`（`adapterInput`）。
- **不可破壞的性質**：
  - 讀不到（`undefined`、不是物件、逾時、讀到過檔後回 `null`）時不寫，手上的值不變；存別的欄位時，不認得的欄位與讀不懂的值原樣留著。
  - 存檔與重讀走同一條隊伍；較早的讀不蓋較新的結果，逾時的寫入不被下一筆超車；監聽者丟錯不卡隊伍。
  - 寫完讀回核對：`saveData` 吞掉錯誤時一定回報失敗。
  - `known` 是 `false` 時預設值不被當成使用者的設定；`settingsFirst` 一定完成，`createState` 維持同步。
  - 值沒變不重排（`today()` 同一個物件）；只有學期或考試倒數變時只通知。`applySettings` 不寫紀錄、不寫卡組。
  - layout ready 之前不呼叫 `loadData`（T12）。
  - 學期是算出來的，不寫檔；清晨 4 點換日。
  - 考試倒數只管入口，目錄、排程、考前提高不變。
  - 舊版外掛（0.3.0）忽略 `data.json`，升降版不壞。發布前比較：有 `src/core/settings/` 的版本用它自己的讀法，沒有的照預設。
- **已知邊界例子**：§7 的 34 項（`tests/settings-*.test.ts`、`tests/compare-versions.test.ts` 最後兩項）。這些只是起點，請找新的組合，特別是：隊伍與第一次讀取交錯、`applySettings` 與換日／範圍變動同一時段、重畫時正好有存檔在排隊、`seenFile` 與同步替換、`semesterSetOn` 在時鐘倒退時。
- **明確延後**：濾網（D-104 不放設定頁）；`set:` 紀錄行（[補紀錄缺口](record-gaps.md)，介面見任務說明 §3）；iPhone 實機（[技術債表](../docs/backlog.md#技術債)「補測：設定頁的 iPhone 實機」）。跨裝置同時改會退回其中一項，是接受的限制（§2-7）。

## 驗證方式

- 指令：`npm run check`、`npm run build`。自己跑測試加 `--test-timeout`；`NODE_OPTIONS` 只能放 `--test-reporter=dot`。
- 實作者跑過：`0708e51` 的 pre-commit（完整的 `npm run check`）與 `npm run build` 通過；合併 `main` 之前的完整輸出是 2199 個測試、0 失敗。Windows 版 Obsidian 1.15.0 實機 §8 第 1～7 點，35 項通過（任務說明〈結果〉；獨立的 Obsidian 與暫存 vault，用 CDP 操作）。
- 沒跑的：iPhone（第 2 類，技術債表「補測：」那一列）；iCloud 雙機同步（需要兩台裝置，併入同一次 iPhone 實機）。
- 需要實機的部分不用重做；判斷需要時寫成「待驗證」交回。

## 實作者自己選的做法（請先看這些）

1. **`fingerprint` 比 `[saved, savedKeys(raw), known]`**，不比整份 `raw`：不認得的欄位變了不通知、不重畫。
2. **`store.change` 用 Promise 回報，隊伍等工作真的結束**：寫入逾時時畫面先知道失敗，下一筆仍等它。
3. **`onError` 選項**（規格沒寫）：`onChange` 的監聽者丟錯不能卡住隊伍，交給外層記 `ui`。
4. **`display()` 先畫手上的值、同時 `reload()`，其他內部重畫走 `draw()`**：內部重畫不多讀一次磁碟。
5. **存成功不主動重畫**，靠 store 的 `onChange`；值和磁碟相同時不重畫，選單本來就顯示那個值。失敗才由 `save` 重畫。
6. **`main.ts` 的欄位叫 `store` 不叫 `settings`**：`settings` 和 Obsidian `Plugin` 型別衝突。
7. **`todayText` 用 `Date.now()` 與本機時區**，`state` 自己用注入的 `now`：`main.ts` 沒有注入的時鐘，選學期時記的日期和 state 算學期用同一套換日規則。
8. **`adapterInput` 從 `compareVersions` 抽出來並 export**：測試才看得到凍結的輸入有帶 `data.json`。發布前比較的 `LIMITS` 文字也改了，`update-vault` 共用它。
9. **`tests/helpers/obsidian.ts` 的 `Setting` 替身**只記控制項、不畫；真的畫面靠實機。

## 回報與權限

只審查，不改產品程式。每項發現寫觸發條件、預期／實際、影響、位置與證據，區分「已重現」「靜態推斷」「待驗證」，另標**真實路徑會不會發生**。可以回報「規格本身有漏洞」。報告不逐段重述規格與差異；頭尾寫待審 commit、審查範圍、測試結果與沒驗的項目及原因。報告寫到 `Claude Codex Discussion/2026-11-09-settings-page-l2.md`。
