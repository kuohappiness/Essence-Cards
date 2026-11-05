# 紀錄接在一起的行（S6）：格式查核與 L2 回報
狀態：第一輪：格式查核與 L2 都通過，Claude 核對完（見最後一節）；使用者 2026-11-05 同意，已合併進 `main`

## 範圍與結論

- 工作樹：`D:\程式開發\Essence Cards\.claude\worktrees\musing-kowalevski-696591`，分支 `claude/musing-kowalevski-696591`；開始審查時工作樹乾淨。
- 程式：`9cc95fe3772e87517f7a696b2f5e3dfa4ee8a31d`；文件與本次驗證的 HEAD：`88b5c36601d3497cf237a0fbe07985361a4ca6e1`；基準：`12a7c173f6656c8fef9fcbece4ee9e7ba3b78c11`。
- 已對照 backlog S6 完成條件、架構討論環節 3 第二輪與結論第 6 條、syntax §0-1／§5-2／§5-3、D-134／D-149／D-150，並讀取 `readHistory`、state 的 `record`／`batch`、版本列表、安裝工具與還原補行路徑。

**格式查核：通過。** 沒有與既有決定衝突，也沒有需要推翻實作的格式問題；本次只修讀取，不產生新的磁碟格式，不必加 `need` 或要求舊裝置停用。

**L2：通過。** 沒有擋合併的規格或設計發現。完整自動檢查能否獨立重跑完成，另列於〈驗證〉，不以實作者先前的結果充當本輪結果。

本次把格式與 L2 放在同一次新 session 可以完成兩組查核；已分別對照格式與程式，沒有因合併查核而省掉項目。後續若修改解析邊界，仍須依 code-quality 的修正後收尾規則再審。

## 第一部分：格式查核

### 相容性：舊版的差異不限於少算筆數

直接取 `v0.3.0`（commit `8b528f28b2305c3812634966bcc753fa96a7a8bd`）的 `src/core/study/history.ts`，於暫存資料夾載入並呼叫公開的 `mergeHistory`。其執行期相依檔與基準版本相同；已用 `git diff v0.3.0 12a7c17 -- src/core/study/history.ts src/core/backup/versions.ts tools/install.ts tools/update-vault.ts` 確認這幾個檔案沒有差異。

以下 A、B 是不同目標的完整作答物件；N 是頂層有 `need: "9.0.0"`、沒有頂層 `lt`／`undo`、payload 裡放 A 的完整物件。讀取版本傳 `0.3.0`。

| 自編輸入 | 本分支 | v0.3.0 |
|---|---|---|
| A＋B | A、B | B |
| A＋雜訊 | A | 沒有作答 |
| N＋B | B，`incomplete: true` | B，`incomplete: false` |
| 沒關上的外層＋A＋B | 只救 B | 只救 B |

**第三列已重現：舊版會漏掉前段的 `need`，不只是少幾筆。** 舊版也可能漏掉前段的取消，讓原本應取消的作答繼續生效。這些都是舊版忽略完整前綴的既有結果，本分支沒有加重它們；syntax 的「舊版只救最後的尾段」是正確描述，但不能推成舊版仍保證辨認整行的影響範圍。

升版工具方面，`v0.3.0` 的 `tools/install.ts:137` 起，退版檢查呼叫該版本的 `readHistory`，只依 `held`／`incomplete` 擋退版。因此對 N＋B，**靜態推斷**舊工具也不會辨認出 N 的版本門檻；這次沒有實際安裝或退版。`tools/update-vault.ts` 與版本命令使用的 `lastVersions` 則直接 JSON.parse 整行，黏住的版本行整行跳過，不會沿用 history 的尾段救援。

真實路徑：一般 writer 仍一筆一次送交 Files，Files 追加 LF，未建立正常路徑產生黏行的證據；外部改檔或中斷不能保證走不到。帶 `need` 的紀錄目前沒有產品寫入端（syntax §5 欄位表），上面的 N 為自編輸入。這項讀取修正不必為已存在的壞行追加版本標記；那會要求改寫原檔，也不可能修補已發布舊版的解析器。未來開始寫帶 `need` 的新紀錄時，仍須照 D-149 第 3 點檢查舊讀取端與最低退版範圍。

### 實作者自行選定的邊界 1～4

四項均接受，不需把 syntax 那一句繼續展開成實作演算法：

1. 括號閉合但非合法 JSON，不屬於「完整的物件」；從該處當餘段，只救最後尾段，符合規格。
2. 物件間跳過 space／Tab／CR，符合 JSON 空白；LF 已是行界。其他字元仍是餘段，不任意跨過雜訊。
3. 完整物件後面有雜訊，仍救前綴；開頭是雜訊則沒有完整前綴。這是「從行首」與「辨認不出的餘段」的直接結果。
4. 完整 JSON 缺必要欄位，消耗該塊、繼續下一塊，但不挖其巢狀內容；這和逐行讀相同。

相關固定例子已在 `tests/glued-lines.test.ts`，可以機械驗證；括號錯配交由 JSON.parse 拒絕，沒有把括號深度為零誤認成合法紀錄。§5-3 保留原文補行，讀法引用 §5-2，與 D-150 第 8 點一致。

## 第二部分：L2 核對

- `src/core/study/history.ts:27` 的掃描跳過字串跳脫，同時計算物件與陣列深度；`readablePieces` 只接受整塊合法 JSON，失敗後停止前綴掃描，不進入巢狀物件找另一筆。
- `history.ts:167` 的 `salvage` 每塊先 `unreadable`，再 `parseLine`；完整但無法確定影響範圍的新版物件會設 `incomplete`。跳脫的 `need` 鍵、無效的 `need` 值也受同一道閘門保護。
- `history.ts:147` 的 `take` 保留原本去重、碰撞、取消與設定變更規則；取消行多帶的 lt 改從那一塊原文讀。排序仍先路徑／行號／同路徑來源原文，再依時間穩定排序；同一實體行內照物件次序加入。
- 整行 JSON 合法時的有效紀錄路徑沒有變，合法但缺必要欄位仍不救巢狀紀錄。壞行的 `seen` 仍寬鬆收集，新增完整片段的 JSON 解析補到跳脫 lt 鍵。
- **不變量的界線**：壞行的 `seen` 可以比分行多，例如設定 val 裡的 `"lt":"inside"` 也會被寬鬆掃到；這是既有的「多避開幾個 ID」保護。獨立探針因此對有效紀錄／取消／held／incomplete 比全值，對 seen 驗不漏分行的任何 ID，不誤要求兩邊完全相等。既有測試的特定範例仍可比完整結果。
- `src/core/backup/versions.ts:48` 不救黏住的版本行可以維持本次範圍：本次完成條件限定 mergeHistory；版本列表原本就跳過無法解析的整行。獨立探針確認 A＋app 時 history 讀到一筆 app 變更，lastVersions 沒有回報。state 的 `checkApp` 可能因此多記一次，但一次啟動最多一筆，不影響排程，也不構成本分支的新退步。
- 作答之後、重新合併之前 `problems` 尚未增加可接受：appendLine 沒有整個實體檔案內容，無從判斷剛才是否黏行。有效紀錄立即一致，重新合併後 problems 與重開結果一致；已有 state 原例測試涵蓋。
- 未關閉外層的最後尾段被當成獨立範例救回、壞開頭之後只救最後一段，均是明列維持的舊行為，不在本次擴大修正。

## 驗證

- Windows、Node `v24.13.0`；程式與文件 SHA 如〈範圍與結論〉。
- `node --test --test-timeout=60000 tests/glued-lines.test.ts`：exit 0，43 個測試全部通過（其中一個含固定種子的 200 組組合）。
- 全套測試另在沙箱外執行 `node --test --test-concurrency=1 --test-reporter=dot "tests/**/*.test.ts"`：測試程序 exit 1，列出三個失敗：`tests/build.test.ts`、`tests/main-wiring.test.ts`（檔案層級的 `test failed`，dot 輸出沒有保留底層原因），以及 `tests/quality.test.ts` 的「Q2 改到程式時 hook 跑 npm run check…」（`Could not determine Node.js install directory`）。前兩者是否也是記憶體不足，沒有充分診斷，**不直接斷言**。
- 針對上述失敗重跑：build 與 main-wiring 的 49 項全部通過，exit 0；另用 `--test-name-pattern='Q2 改到程式時 hook' tests/quality.test.ts` 重跑 Q2，1 項通過，exit 0。首次全套的失敗未能持續重現，沒有證據指向本次 history 改動；沒有把首次全套結果改寫成全綠。
- 額外 25 組公開介面探針：exit 0。包含連續 0～7 個反斜線與引號／括號的字串、跳脫 need 鍵搭配 null／false／壞版號／新版／可讀版號、同一時間多目標與取消再重複、完整但缺必要欄位的物件、物件間 CR／Tab、多份同路徑來源反向輸入、含 need 取消的壞行移到還原檔後有效結果不變，以及 history／版本列表的讀法差異。另直接執行 v0.3.0 reader 得到上表。
- `git diff --check`：exit 0。
- `npm run knip`、`npm run secretlint`、`npm run skills`：在沙箱外分別執行，exit 0。
- `node tools/check-docs.ts`：exit 0，275 個 Markdown 檔、5691 個連結通過；包含這份新增報告。
- 完整 `npm run check`：**未通過驗證**。依專案要求在沙箱外執行，但型別檢查發生 `NewSpace::EnsureCurrentCapacity Allocation failed`／`Zone Allocation failed - process out of memory`；縮小 GC 區域後仍失敗（exit 134，另一次程序中止碼 `-1073740791`）。停用 JIT 的完整重跑也 exit 134。當時主機可用實體記憶體約 753 MiB／14021 MiB；沒有產品型別錯誤的診斷，不能據此宣稱型別檢查通過。另跑 `npm run lint` 也發生同樣的原生記憶體錯誤，exit 134；ESLint 尚未完成。Claude 合併前仍需在資源足夠時跑過完整檢查。

沒完成：型別檢查與 ESLint（沙箱外也因記憶體不足中止，完整 check 尚未通過）；沒測：Obsidian、iPhone 實機與 Linux CI（純讀取邏輯，未安裝分支至共用 vault，分支尚未 push），以及實際升版／退版（僅靜態查工具、隔離執行 reader）。

## Claude 核對（2026-11-05）

逐項核對這份回報，沒有要反駁的，兩個結論都採用：

- **舊版的差異**：`N＋B` 在 `v0.3.0` 是 `incomplete: false`，和[外掛架構討論稿](2026-10-26-plugin-architecture.md)〈Claude 回應 Codex：環節 3 第二輪〉那張表的 (a) 當時量到的相同；基準的讀法只看最後的尾段，前面的作答、取消與 `need` 都不讀（`git show 12a7c17:src/core/study/history.ts`）。照回報的提醒，把 syntax §5-2 那一句補成「舊版只救最後的尾段，看不到前面的作答、取消與 `need`」。只改文字，讀法沒變。
- **`lastVersions` 維持不改**：回報確認影響只有版本列表與一次啟動最多多一行版本行，不影響排程，也不是這個分支帶來的退步。好處很小，不另記技術債（D-177）。
- **作答後到下一次合併之前的 `problems`**：維持，理由照回報。
- **機械檢查**：回報的型別檢查與 ESLint 因這台電腦當時記憶體不足沒有跑完，全套測試第一次有 3 項失敗、重跑通過，所以不算全過。Claude 在要合併的 commit 重跑一次完整的 `npm run check`，結果記在下面。
- **結果**：`2375989` 的 `npm run check` exit 0，測試 1416 個全過（Windows、Node 24.13.0）。之後 `claude/quiz-practice` 合併進 `main`，再併一次：只有 `parseLine` 那行註解和 backlog 有衝突，讀法沒變；合併 commit `15f79f0` 的 pre-commit 跑完整的 `npm run check`，exit 0。Linux 的 CI 要 push 後才有結果。
