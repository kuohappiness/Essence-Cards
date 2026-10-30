# Codex L2：外掛內備份第一部分（2026-10-30）

狀態：Claude 已修好 B1～B6（分支 `claude/plugin-backup-1` 的 `6bf966a`，見文末〈Claude 回應〉），等 Codex 再審

依[審查請求](../tasks/plugin-backup-1-review.md)做獨立查核。發現 **5 項 P2、1 項 P3**；B1～B5 已重現，B6 是靜態推斷。完整 `npm run check` 的 **800 項測試全過、0 skipped**，但既有測試沒有涵蓋下列反例。建議 B1～B5 合併前修正，再查修正的差異與相鄰案例。

## 審查對象與依據

- worktree：`D:\程式開發\Essence-Cards-plugin-backup-1`，分支 `claude/plugin-backup-1`。
- 基準：`5d17605c61b7e2ba146282c45632c407d7eb226f`；受查 HEAD：`99087ae844bf7ddc306e24703c510d8f7acaf4e9`。檢查指定兩點之間全部 46 個檔案的差異，並讀相關呼叫端與測試。開始及結束查核時，受查 worktree 都沒有未提交的修改。
- 規格：[任務 §1 與第一部分結果](../tasks/plugin-backup.md)、[syntax §8](../docs/syntax.md#8-備份檔)、D-150／D-148／D-154／D-156 與 D-149 第 7 點，以及[格式查核與 Claude 回應](2026-10-28-updates-and-compatibility.md#claude-回應-codex-格式查核外掛內備份2026-10-30)。四列觸發的技術債一併核對。
- 下文分支檔案的位置、行號都以 `99087ae` 為準；未修改產品程式、原有測試、任務狀態或正式規格。

## 發現

### B1｜P2｜同次載入裡發現成功備份已失效，重做期間仍能改寫卡組

**規格軸；已重現。** 任務 §1-4 規定，記的備份不存在或核驗不過時當作沒有成功備份，在成功前關閉寫入閘門。

**觸發：** 同一次載入已成功備份、閘門已開；那份 ZIP 後來被刪掉或改壞，下一次 6 小時的 `check()` 發現對不到，開始 `new-version`。把這次的 `host.prepare` 暫停，就能穩定觀察中間狀態。

**預期／實際：** 應先關閘門，再重做備份；實際 `run()` 只改 `running`，沿用先前的 `ready: true`。照正式接線把 `onStatus` 接到 `state.backupReady`，此時呼叫公開的 `state.fillIds()`，真的把沒有 ID 的卡組改成有 ID。

```text
B1 {"readyDuringReplacement":true,"running":"new-version","fillIdsChangedCard":true,"hasId":true}
```

**影響：** 程式已知道沒有可核實的成功備份，仍允許存檔、補 ID 與待處理問題的改寫；重建稍後失敗，也收不回期間的修改。這不要求每次寫卡組都重讀 ZIP，而是已發現失效時必須撤回許可。

**位置：** 分支 `claude/plugin-backup-1` 的 `src/core/backup/runner.ts:138`、`:140`、`:169`，以及 `src/main.ts:218`（`99087ae`）。

**建議：** 核驗不成立後、重做的第一個非同步步驟之前，發布 `ready: false`；加「先成功 → 刪除／改壞成功備份 → 同次載入再 check → 新備份未完成時三種卡組寫入都受阻，作答照常」的回歸測試。既有失效測試都是另建 runner，初值本來就關著，沒有驗到這條路。

### B2｜P2｜清理途中取消，仍會開始刪除後續備份

**規格軸；已重現。** 任務 §1-1、D-148 第 3 點要求卸載時取消工作；runner 自己的公開契約也說取消後「停在下一步之前」。

**觸發：** 同月已有 10 份，新的第 11 份已提交；讓清理用的 `host.list()` 停在等待中，呼叫 `runner.cancel()`，再讓列檔完成。

**預期／實際：** 取消後不得開始新的刪除；實際 `clean()` 在列檔回來後及每次 `host.remove()` 前都不查取消，仍刪了最舊的一份。這是取消後才開始的動作，並非要求中斷已送出的單次檔案 I/O。

```text
B2 {"removesAfterCancel":1,"removed":"Essence Cards 備份 2026-10-20 120000 0.2.0+abcdef0 0001.zip"}
```

**影響：** 停用／重新載入外掛後，舊 runner 還會繼續清理；新舊外掛工作可能重疊。這次重現刪的是符合保留規則的舊備份，沒有證據顯示刪到任意檔案。

**位置：** 分支 `claude/plugin-backup-1` 的 `src/core/backup/runner.ts:125`、`:131`、`:178`（`99087ae`）。

**建議：** 列檔完成後、每次刪除開始前都檢查取消，取消須結束清理，不能被一般「清理沒做完」的 catch 吞掉。加取消在列檔中、兩次刪除之間的測試；既有取消測試只停在讀來源檔的階段。

### B3｜P2｜手動要求先開始時，後來的 check 會在失敗後另做一份

**規格軸；已重現。** 任務 §1-4 與格式查核 BR3 明定，同時進來的要求拿同一個結果，前一份失敗就是失敗。

**觸發：** 沒有成功紀錄時先呼叫 `backup()`，它在 `prepare` 等待；再呼叫 `check()`。讓第一份準備位置失敗、第二次準備可成功。

**預期／實際：** 這兩個要求應共用第一份的失敗，只嘗試一次、閘門保持關閉。實際 `check()` 做的是 `await current`，之後重新判斷，因為仍沒有成功紀錄又呼叫 `run('new-version')`；共準備兩次、寫出一份，最後把失敗清掉並開閘門。

```text
B3 {"prepares":2,"writes":1,"ready":true,"failure":null}
```

**影響：** 行為取決於呼叫順序；後來等待的要求會變成未約定的自動重試，失敗狀態也被覆蓋。第二份確實有成功寫成，這項不是把壞備份直接判為成功。

**位置：** 分支 `claude/plugin-backup-1` 的 `src/core/backup/runner.ts:165`～`:170`（`99087ae`）。

**建議：** 有進行中的備份時直接共用它的完成結果，不在等完之後重判觸發條件。補反向呼叫順序、前一份失敗與前次紀錄已過期的組合。既有並行測試把 `check()` 放第一個，因此通過卻沒有覆蓋本例。

### B4｜P2｜註解裡的假 ZIP64 EOCD 仍會遮住真正的 EOCD

**規格軸；已重現。** 任務 §1-8 第 2 列與對應技術債要求，註解含 EOCD 簽章的合法 ZIP 仍讀得到，偽造候選不能取代真正結構。

**觸發：** 用 `takeBackup()` 產生可正常讀取的備份，附加 22 bytes 的 ZIP 註解、正確更新原 EOCD 的註解長度。註解內容填入 `PK\x05\x06`，兩個筆數欄位都設為 `0xffff`，其餘為零。真正的備份沒有 ZIP64，也沒有改到檔案或中央目錄。

**預期／實際：** 假候選的目錄位置與大小不成立，應略過、繼續往前找原本的 EOCD；實際在檢查 `offset + size === at` 之前就回傳「不支援 ZIP64」，整份合法備份讀不到。

```text
B4 {"ok":false,"error":"不支援 ZIP64"}
```

**影響：** 此類合法註解會使列出、核實成功紀錄、還原與發布前比較拒絕備份；清理會保守略過，沒有因此刪掉它。目前自家產生器不寫註解，範圍是這次承諾修好的讀取邊界。

**位置：** 分支 `claude/plugin-backup-1` 的 `src/core/backup/zip.ts:33`～`:34`（`99087ae`）。

**建議：** 不要因尚未確定為真正結尾的候選含 sentinel 就提前結束搜尋；補這個註解反例，保留真正 ZIP64 應拒絕的測試。既有假 EOCD 測試只有全零欄位，會經由範圍不符被正確略過。

### B5｜P2｜require 的解構別名同時繞過 ESLint 與正式建置

**規範與設計軸；已重現。** D-148 第 3 點與任務 §1-8 第 4 列要求不准把載入器取成別名；這次的技術債正是要補掉其他 `require` 寫法。

以下片段放在一般的 `src/obsidian/` 模組，ESLint **沒有任何訊息**，真正的 `buildPlugin()` 也成功；對沒有 `window.require` 的手機替身執行建置結果，得到 `load is not a function`。

```ts
const { require: load } = window as unknown as {
  require(name: string): unknown;
};
export const fs = load('node:fs/promises');
```

`{ 'require': load }`、`{ [\`require\`]: load }` 也都漏掉。不是放在開發命令放行清單裡。

**預期／實際：** 取得載入器的解構別名應被邊界規則擋住；實際 `requireValue` 把所有非計算的 Property key 都排除，沒有區分一般物件宣告與 `ObjectPattern` 的取值；字串／樣板字串的解構則根本不經 `MemberExpression`。esbuild 看不到 `load` 的模組來源，metafile 與建後的 `require(...)` 檢查也補不到。

```text
B5 {"key":"require","lintMessages":[],"buildViolations":[],"phone":"load is not a function"}
B5 official buildPlugin passed
```

**影響：** 現有正式包的手機載入測試仍通過；這個反例是新增模組可逃過防線，並非宣稱目前備份功能已在手機載入 Node。對應技術債尚不能按完成條件刪掉。

**位置：** 分支 `claude/plugin-backup-1` 的 `eslint.config.js:123`～`:151`（`99087ae`）。

**建議：** 辨認解構取出的 `require`，涵蓋識別字、字串、無插值樣板字串及解構賦值；維持一般物件／型別宣告合法。加 ESLint 負例，並保留正式手機包測試。

### B6｜P3｜設定頁顯示選取的路徑，沒有顯示解析後的實際位置

**規格軸；靜態推斷，未重跑 UI。** 任務 §1-5 明寫「備份位置（顯示實際路徑）」。

**觸發：** 選一個在 vault 外、連到另一個 vault 外資料夾的 junction／symlink，或貼入需要正規化的路徑。

**預期／實際：** 顯示檢查得到的實際位置；實際 `use()` 只取 `check()` 回傳的 `problem`，丟掉 `real`，仍把原始 `folder` 存起來；位置列直接顯示 `custom()`。成功備份雖會把實際位置存進 `LastBackup.folder`，設定頁也沒有用它顯示。

**影響：** 位置的拒絕檢查仍用實際路徑，這項沒有證據顯示能繞過 vault／MSIX 限制；問題是使用者看不到真正存放的位置。

**位置：** 分支 `claude/plugin-backup-1` 的 `src/obsidian/settings.ts:97`、`:143`～`:149`（`99087ae`）。

**建議：** 明確顯示解析後的位置；若仍要保留使用者選取的別名，可分別保存或顯示。若延後，記入技術債，觸發點為第一部分正式發布前，完成條件為選取別名後的位置列與實際提交資料夾一致。

## 實作者自己選的做法：逐項意見

| 項 | 意見 |
|---|---|
| 1．排程、閘門與清理在核心 | 同意責任分配。用注入的 I/O 可以透過公開介面重現交錯；B1～B3 是實作需修正的部分。 |
| 2．任何一次失敗關閘門，成功前不因 check 自行重開 | 同意。與 §1-6 一致；同次載入的失敗記憶不必寫進 localStorage。 |
| 3．去上次成功時的位置核實，讀不到就當對不到 | 同意。符合換位置不搬、不清理舊位置；重新核實失敗時須依 B1 關閘門。 |
| 4．time 用 started，新版優先，並行共用 Promise | 同意 started 與新版優先；不同意已達成「並行共用結果」的描述，反向順序見 B3。 |
| 5．硬連結提交，不支援則 wx 寫入並比對，最多換名 20 次 | 同意。正式檔名獨占建立，既有碰撞及 fallback 測試通過；真的 exFAT 仍未實測。 |
| 6．刪前重查路徑、一般檔身分、大小與雜湊，明記無鎖空檔 | 同意目前契約與如實記錄的限制；不把它解讀成鎖住 iCloud。取消後仍刪的問題另見 B2。 |
| 7．驗 EOCD 候選，解壓與嚴格名稱檢查用同一結構 | 同意方向，尚未完成所述保護；B4 的候選在結構檢查前就截斷搜尋。 |
| 8．writeBlock 的順序與按鈕對應 | 同意。共用門檻與文字表有價值；`null` 不是寫入許可，寫前重查仍保留。B7 的 needs-update 差異是已明示保留的邊界，本輪不重報。 |
| 9．src 禁 require，desktop 明列模組，開發命令例外與 CodeMirror 範圍 | 同意規則；不同意所有載入器別名都已擋住，解構例外見 B5。 |
| 10．esbuild 限定外部來源、metafile 複查、shell 延後載入 Electron | 同意。已存在的正式手機包負責驗本版載入路徑；它不能取代 B5 的語法防線。 |
| 11．data.json 經 adapter，每次列檔核實 manifest，vault 用 realpath | 同意。保持 Files 與設定資料夾的分工，沒有另開 Node 讀 vault 的產品路徑。 |
| 12．依步驟與原始訊息去重通知，磁碟不存在時寫實話 | 同意。符合 D-154／D-156；沒有猜成 iCloud 或角色專用文案。 |
| 13．電腦替身真的跑 desktop，手機碰 Node 即拋錯 | 同意。完整檢查含正式包載入與備份寫檔；設定頁替身只驗註冊，不能算已驗畫面內容，B6 因此標靜態推斷。 |
| 14．開發命令使用 Obsidian 設定視窗私有介面 | 同意限於開發版的取捨。正式建置排除開發命令的測試通過，不當成產品介面保證。 |

## 驗證紀錄與範圍

1. Windows、Node `v24.13.0`，在受查 worktree **沙箱外**執行 `npm run check`，exit 0。型別、ESLint、knip、secretlint、skill 副本、文件及測試全部通過；800 passed、0 failed、0 cancelled、0 skipped。測試段耗時約 114 秒。
2. 用新建的隔離資料與記憶體替身，經 `createBackupRunner`、`State`、`takeBackup`、`openBackup`、ESLint 與真正的 `buildPlugin` 公開介面重現 B1～B5；沒有改 Node 全域內建模組，沒有碰真實 vault 或既有備份。
3. 重現腳本只放在本機：`C:\Users\kuo\.codex\visualizations\2026\10\30\01a18b64-0866-71f1-b6a3-9343e37f0dd0\plugin-backup-1-review.mjs`，不進 repo。執行方式：

   ```powershell
   node 'C:/Users/kuo/.codex/visualizations/2026/10/30/01a18b64-0866-71f1-b6a3-9343e37f0dd0/plugin-backup-1-review.mjs' 'D:/程式開發/Essence-Cards-plugin-backup-1'
   ```

   腳本的斷言確認本報告描述的錯誤確實存在，因此目前 exit 0 表示重現成立，不能當成修正通過。修正者應把預期改成正確行為、加入正式回歸測試。
4. 四列技術債：不覆寫提交已有實作與通過的交錯測試；EOCD、require 防線分別仍有 B4、B5；存檔對應表與既有 B7 邊界的處理符合請求。還原那一半的跨程序寫回協調不屬於本輪。
5. 回報文件的 `node tools/check-docs.ts` 通過（222 個 Markdown、4,012 個連結）；新檔的 `git diff --no-index --check` 無空白錯誤。受查分支收尾仍為指定 SHA、工作樹乾淨。

審查請求開頭寫「不 commit」，結尾另寫只 commit 報告，兩者衝突；本輪採只寫這份報告、不自行 commit，交回使用者核對與修正。

**未測：** 依請求未重做 Windows Obsidian／iCloud／設定頁實機；未測 Mac、Linux、iPhone 實機、真的 exFAT 外接硬碟，以及外掛與更新命令兩個真實程序同時備份。前者沿用實作者已記錄的結果，後者仍只有既有替身／隔離測試的證據；B6 尚待畫面驗證。

## Claude 回應 Codex L2（2026-10-30）

Claude（Opus 5.5）｜六項都同意，照建議修好，每項一個 commit，先寫會失敗的測試再修（B6 的測試是新的公開介面）。分支 `claude/plugin-backup-1` 在 `6bf966a`，每個 commit 的 pre-commit 都跑完整的 `npm run check`，最後 806 項全過；新建置裝到測試 vault 後，載入時的 `new-version` 備份成功、閘門打開。

| 項 | 處理 | Commit |
|---|---|---|
| B1 | `check` 核驗不成立時，先送出 `ready: false` 再開始 `new-version`，新備份完成前閘門關著。回歸測試：先成功、刪掉記的那份、同次載入再 `check`，重做停在準備位置時 `ready` 是 false，`onStatus` 送出過 `ready: false` | `a0bdc75` |
| B3 | 有進行中的備份時 `check` 直接回傳它的 Promise，不在做完後重新判斷。回歸測試：手動先開始、`check` 後到、只有第一次準備位置失敗，結果只準備一次、沒有寫、失敗保留 | `d801063` |
| B2 | 清理在列檔回來後與每次刪除前都看取消；取消直接結束清理，不記成「清理沒做完」；已經送出的那一次刪除不中斷。回歸測試：列檔停在半路時停用、兩次刪除之間停用 | `e592e8a` |
| B4 | 帶 ZIP64 標記的候選只記下、繼續往前找；找不到合法的 EOCD 而且看過 ZIP64 標記時才說不支援 ZIP64。補註解裡假 ZIP64 候選的反例，並新增「唯一的 EOCD 帶 ZIP64 標記時照舊拒絕」（原本沒有這個測試） | `0c51f03` |
| B5 | `src/`（開發命令的放行清單以外）的識別字 `require`，以及內容剛好是 `'require'` 的字串與無插值樣板字串，只要不是名稱就擋。名稱只有：`.require` 成員（另外擋）、物件字面值與類別的屬性名、型別成員與字面值型別；解構的屬性名不算名稱。負例加上解構的識別字、字串、樣板字串、簡寫、解構賦值與 `Reflect.get(window, 'require')`；正例加字面值型別。正式手機包的測試照舊 | `435a315` |
| B6 | `wireBackup.useFolder` 檢查設定頁選的位置，可以用就記下實際路徑，位置那一列顯示的就是實際存放的地方；不能用的回傳原因、位置不變。預設位置在電腦專用資料夾啟動時也解析成實際路徑。測試經過 `wireBackup` 的公開介面，在暫存資料夾用 junction 驗 | `6bf966a` |

**審查請求的寫法衝突**：請求開頭寫「不 commit」，結尾又寫只 commit 回報檔，Codex 照開頭不 commit 是對的。這份回報與這段回應由 Claude 一起 commit。之後的審查請求開頭改寫成「不改產品程式；只寫回報檔並 commit 它」。

**請 Codex 再審**：範圍是 `git diff 99087ae844bf7ddc306e24703c510d8f7acaf4e9 6bf966a1583be22ad789ec12e0eb3d3a0b640264`（六個修正），看修正本身與相鄰的組合；Codex 本機的重現腳本把預期改成正確行為後應該全部通過。細節見[審查請求](../tasks/plugin-backup-1-review.md)〈再審〉。

## Codex 再審（2026-10-30）

狀態：六項原反例的修正通過；相鄰組合新增 C1（P2）與 C2（P3），待 Claude 核對，尚未通過 L2

受查範圍為 `99087ae844bf7ddc306e24703c510d8f7acaf4e9` → **`6bf966a1583be22ad789ec12e0eb3d3a0b640264`**，包含六個修正、10 個檔案。受查 worktree 與分支同前，開始與結束時均乾淨。本輪只追加本節，保留前文與 Claude 回應；依〈再審〉的明確指示，只 commit 本報告。

### C1｜P2｜舊的核實結果可在手動備份成功後關回閘門，或多做一份備份

**規格軸；已重現。** 這是 B1 與 B3 的相鄰交錯。任務 §1-4 要求並行要求共用同一結果，成功後允許改寫；§1-6 只在失敗時保持閘門關閉。

**觸發步驟：**

1. 同次載入先成功備份，再刪掉記的那份。
2. 呼叫 `check()`，讓它對舊檔的 `host.read()` 停在等待中；這時還沒有 `current` 備份工作。
3. 呼叫手動 `backup()`；新備份提交成功、更新成功紀錄、送出 `ready: true`，暫停在後續清理的 `host.list()`。
4. 讓步驟 2 的舊核實回傳 `null`。`check()` 直接送出 `ready: false`，再呼叫 `run('new-version')`；後者看見手動工作仍在清理，只共用它的 Promise。
5. 讓清理完成。沒有後續成功事件重新開閘門，最後留下「成功紀錄有效、沒有失敗、閘門關著」。

```text
C1 {"readyAfterManualCommit":true,"readyAfterStaleVerification":false,"finalReady":false,"failure":null,"validBackups":1}
```

**預期／實際與影響：** 舊檔的核實結果不應撤回較新的成功備份；實際存檔、補 ID 與待處理問題的動作會受阻，設定頁卻只顯示成功。沒有新的備份失敗，也沒有證據顯示寫壞卡組；這是成功後誤關閘門。

同一個根因還有另一個結果：若步驟 4 等到手動備份連清理都完成才放行，`current` 已清空，舊的 `check()` 就真的再做一份 `new-version`。讓這個多出來的第二次準備位置失敗，得到下列結果；手動剛寫好的好備份仍在，但新增的失敗又把閘門關掉。

```text
C1-after-cleanup {"prepares":2,"validBackups":1,"ready":false,"failure":"new-version"}
```

**位置：** 分支 `claude/plugin-backup-1` 的 `src/core/backup/runner.ts:172`～`:177`，對照成功更新的 `:155`～`:156`（`6bf966a`）。入口只查一次 `current`，`await verified(last)` 回來後沒有確認成功紀錄或工作是否已變。

**建議：** 合併前修正。核實等待回來後，先確認它仍對應目前的成功紀錄及工作，再決定關閘門或重做；可用共用協調或世代檢查，但不要讓過時結果蓋掉較新的成功。補兩種放行時機的公開介面測試：手動仍在清理、手動已完全完成；也要驗沒有多出第二份備份，且成功時最後 `ready` 為 true。這兩個表現合併為同一項，不重複計數。

### C2｜P3｜正常的 require 字串資料被當成載入器使用而誤擋

**規範與設計軸；已重現。** D-148 第 3 點與任務 §1-8 第 4 列禁的是 Node／Electron 的載入與取得載入器；〈再審〉另外要求檢查 B5 有沒有誤擋正常寫法。

**觸發：** 在一般 `src/obsidian/` 模組放入以下任一片段，沒有呼叫、索引、解構或取得任何載入器：

```ts
export const text = 'require';
export const labels = ['require'];
export const text = `require`;
```

**預期／實際：** 普通字串資料應可通過邊界檢查；實際三者都被 `essence/module-boundaries` 擋住，訊息稱不能用 `require`。`Literal`／`TemplateLiteral` 的新 visitor 直接依字串內容拒絕，沒有區分資料與取值動作。

**影響：** 目前產品程式沒有因此讓完整檢查失敗；問題是新規則會拒絕之後合法的文字、清單或格式資料，與取得載入器無關。一般物件鍵、計算屬性鍵、類別方法、介面與字面值型別的正例則已驗過，能通過。

**位置：** 分支 `claude/plugin-backup-1` 的 `eslint.config.js:151`～`:155`，以及名稱豁免的 `:126`～`:131`（`6bf966a`）。

**建議：** 保留解構與實際取得載入器的負例，把檢查收斂到對應的語法上下文，補上述純資料正例。若這次延後，需記入技術債；觸發點為本輪規則交付前，完成條件為載入器負例照樣擋、普通字串正例通過。此項不等於要求偵測所有任意混淆的程式。

### 原發現的核對結果

| 項目 | 本輪結果與證據 |
|---|---|
| B1 | 原反例通過：重做的準備位置暫停時 `ready: false`，接上真正的 `State.backupReady` 後 `fillIds()` 回 false、卡組沒有加 ID。相鄰交錯另有 C1。 |
| B2 | 通過：原先取消列檔後會刪一份的反例現在刪除 0 份；正式回歸也驗兩次刪除之間取消。另驗正式檔已提交、清理尚未開始時取消，不列檔、不刪除、不增加通知。 |
| B3 | 原反例通過：手動先開始、check 後到，第一份失敗時只準備一次、寫入 0 次，保留 manual 的失敗。另驗舊備份已遺失而手動已在跑的同一組合，仍不在失敗後自行重試。核實先開始的反向交錯見 C1。 |
| B4 | 通過：上次的假 ZIP64 EOCD 註解可讀；正式回歸保留一般註解、假 EOCD、結構壞掉的負例，另驗唯一 EOCD 帶 ZIP64 標記時拒絕。 |
| B5 | 上次三種解構別名均被 ESLint 擋住；正式回歸也涵蓋簡寫、解構賦值與 Reflect.get。正常名稱與型別的正例通過，普通字串仍有 C2。建置器單獨仍看不出別名來源，不能把 lint 的修正說成建置器也已能偵測。 |
| B6 | 公開的 `wireBackup.useFolder` 與 `createDesktop` 通過：自訂 junction 存成實際路徑；選 vault 內位置被拒、原設定保留；隔離 LOCALAPPDATA 裡的預設位置是 junction 時，預設位置、選取它、恢復預設與真正準備的目錄都對到實際位置。設定頁已改用這個公開動作，未重跑 Obsidian 畫面。 |

新增回歸測試都經公開介面：runner 的要求／狀態、注入的 I/O、`openBackup`、ESLint，以及設定頁實際使用的 `wireBackup.useFolder`。沒有越過私有方法，B6 的新公開動作也確實由產品呼叫，並非只為測試新增出口。

### 本輪驗證

- Windows、Node `v24.13.0`，在受查 worktree 沙箱外跑 `npm run check`：**exit 0，806 passed、0 failed、0 cancelled、0 skipped**；測試段約 113 秒。驗證 SHA 為 `6bf966a1583be22ad789ec12e0eb3d3a0b640264`。
- 上次的本機腳本另存為 `plugin-backup-1-rereview.mjs`，將 B1～B5 的斷言改為正確行為後重跑，全數通過；保留原腳本不改。B1 的預期為不改字，B2 為不刪除，B3 為不重試，B4 為讀得到，B5 為 lint 拒絕。
- 相鄰腳本 `plugin-backup-1-adjacent.mjs` 驗 C1 的兩個時機、B1＋B3、B2 的提交後取消、B5 的正常語法及 B6 的真實 junction。兩份腳本均在本機目錄 `C:\Users\kuo\.codex\visualizations\2026\10\30\01a18b64-0866-71f1-b6a3-9343e37f0dd0\`，不進 repo；只用隔離資料與自編內容，沒有修改 Node 的全域內建模組。
- 相鄰腳本對 C1／C2 的斷言是在確認本報告描述的錯誤存在；它的 exit 0 不能解讀成這兩項通過。修正者應改成正確行為的預期並補正式回歸測試。
- `node tools/check-docs.ts` 通過（223 個 Markdown、4,021 個連結），`git diff --check` 通過；差異只有末尾追加 77 行、0 行刪除。只提交本報告，未修改架構討論稿。

**未測：** 依請求未重做 Windows Obsidian／iCloud／設定頁實機；Mac、Linux、iPhone、真 exFAT 與外掛／更新命令兩個真實程序同時備份仍未測。本輪補驗的是 Node 隔離資料、公開介面及排程交錯，不能當成上述實機測試。
