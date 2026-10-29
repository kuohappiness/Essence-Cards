# 更新防線第一部分：Codex 中途查核

狀態：再查 R1～R4 與第二輪 L1～L5 已處理（R4 記技術債），分支 `claude/update-safeguards-1` 的 `0e1af6c`，見文末〈Claude 回應（再查與第二輪）〉；待 Codex 第三次查核

本輪依 [審查請求](../tasks/update-safeguards-1-review.md)，只查 `048adf036a293f1fbd59980fd6f59a73b161dee1..4dbb3953b8ec6ad52dd701180836d4d40ee6e16e`：`0b30874` 的建置註記，以及 `4dbb395` 的備份、還原。規格以主資料夾的 [任務說明 §1-1、§1-2、§1-6](../tasks/update-safeguards.md)、[syntax §5-3、§8](../docs/syntax.md)、D-150、D-134 與前輪查核的已採納條件為準。

**結論：備份穩定性與紀錄補行的主要流程通過已測案例；還原仍有資料保護問題，應先修再接後續流程。** 既有檢查全部通過，但額外組合重現了部分成功後的重複 ID、寫入期間的新修改被蓋掉，以及以下四項邊界問題。本報告是查核結果，不代表使用者確認新的設計。

## 驗證與範圍

- 另開 detached worktree，固定在 `4dbb3953b8ec6ad52dd701180836d4d40ee6e16e`，沒有使用 Claude 正在施工的 worktree，也沒有收入後續 1-4 改動。
- Windows、Node `v24.13.0`；在沙箱外執行 `npm ci`、`npm run check`，兩者退出碼皆為 0。型別、ESLint、knip、secretlint、skill 一致性與文件檢查通過；測試 **590／590 通過，0 失敗、0 跳過**。其中本輪三個測試檔各 10 項，共 30 項，已包含在完整檢查內。
- 額外透過公開介面執行自編探針：純邏輯在記憶體；檔案流程使用獨立暫存 vault。時機與故障注入使用現有 `seams`，沒有修改 Node 全域模組；注入的檔案變更實際寫入暫存檔案系統。
- 所有學習內容、外部目錄與 ZIP 均自編；沒有讀寫任何真實 vault、私人教材或實際備份。探針結束後清除自行建立的暫存資料，沒有修改產品程式、既有測試或 commit。
- 報告寫入後，主資料夾的 `node tools/check-docs.ts` 通過。審查 worktree 的 Git 狀態乾淨；app 將它視為此 chat 的 primary checkout，拒絕 `archive_worktree`，而原資料夾不是 managed worktree、無法用 `attach_worktree` 切回，因此暫留 `C:\Users\kuo\.codex\worktrees\review-update-safeguards-1\Essence Cards`。測試 vault 與探針資料已清除。
- 下文所有程式與測試位置都指**分支 `claude/update-safeguards-1` 的相應路徑（commit `4dbb395`）**；僅以文字列出，不連到 `main` 尚不存在的檔案。

## 合併前要修

### F1｜P1｜跳過或失敗的檔案仍被當成已還原，後續寫入會造成重複 ID

**軸：規格；證據：已重現。**

位置：分支 `claude/update-safeguards-1` 的 `tools/restore.ts`（`4dbb395`），第 174～196 行；`src/core/backup/plan.ts` 第 113～145 行。

依據：任務 §1-2 的全庫 ID 檢查、§1-6 的還原演練與中途失敗續做；D-150 第 7 點要求會造成 ID 重複的檔案擋住。

**觸發與重現：** 兩篇卡組的 ID 如下，答案文字任意：

| 時點 | A.md | B.md |
|---|---|---|
| 備份 | `aaa111` | `bbb222` |
| 計畫時 | `aaa111`、`bbb222` | `ccc333` |

整組還原原本安全，所以 `makePlan` 將 A、B 都列為 `restore`。接著分別驗兩種情況：

1. 計畫後只改 A 的答案文字，ID 不變，再 `applyPlan`：A「跳過」，B「已還原」。
2. 計畫後不改檔，以 `seams.write` 讓 A 的暫存寫入拋 `ENOSPC`，B 正常寫入：A「失敗」，B「已還原」。

兩種情況最後 `readDecks` 收到的 ID 都是 `['aaa111', 'bbb222', 'bbb222']`。原因是 `fresh` 的 ID 檢查先假設 A、B 都會寫成；A 後來被跳過或失敗，剩下的計畫沒有重算。既有「中途寫入失敗」測試也只驗結果標示與續做，沒有檢查第一次失敗後的全庫 ID。

**預期／影響：** A 沒能釋放 `bbb222` 時，依賴它的 B 應擋住；實際卻寫入第二個 `bbb222`，可能讓排程選到錯的卡組、接錯學習目標紀錄。

**建議：合併前修並補回歸。** 寫入前先排除計畫後已改動的檔案，再對實際候選集合重算 ID；寫入順序須處理「先釋放 ID，才可在另一篇加入」的相依。任何釋放失敗都應阻擋依賴它的寫入；循環相依若無法安全完成，先列為衝突。只在錯誤後停止，也不能保證前面已完成的加入沒有和後面未完成的移除重複。驗收需涵蓋相反的 A／B 路徑順序，以及跳過、寫入失敗兩種分支。

### F2｜P1｜逐檔寫前比對的是 load 快照，會蓋掉還原期間才到達的修改

**軸：規格；證據：已重現，以現有 write seam 插入真實檔案變更。**

位置：分支 `claude/update-safeguards-1` 的 `tools/restore.ts`（`4dbb395`），第 174、183～190 行。

依據：任務 §1-2 明定「寫每個檔案前重新確認它還是計畫裡的那一份（雜湊），不是就跳過」；前輪 C5 要求寫前重驗。

**觸發與重現：** A、B 都是可還原的改過卡組。在 A 的 `seams.write` 中，先用真實 `writeFile` 把 B 改成另一份文字，再正常寫 A 的暫存檔。工具接著處理 B 時，仍拿 `fresh.files` 內、先前 `load` 讀到的雜湊和舊計畫比較，沒有重新讀 B；最後 A、B 都回報「已還原」，B 剛到達的修改消失。這份修改發生在還原前備份之後，該備份也沒有它。

**預期／影響：** B 應跳過，列出需要重新比對；實際直接覆蓋。即使 Obsidian 已關閉，iCloud 同步或其他編輯器仍可能在多檔還原期間寫入，造成未被這次備份保護的新資料遺失。

**建議：合併前修並補回歸。** 在每個目標即將替換前重新讀檔／確認不存在，和計畫的現況雜湊比對；暫存檔準備完成後、rename 前再確認一次。遇到變更須跳過，並連同 F1 對後續 ID 相依重算。這項不要求工具提供整個同步系統的鎖，但需要實際執行規格所承諾的逐檔重驗。

### F3｜P2｜Essence Cards 根目錄的 junction 未被拒絕，還原會寫到 vault 外

**軸：規範與設計；證據：已在 Windows junction 重現。**

位置：分支 `claude/update-safeguards-1` 的 `tools/vault-io.ts`（`4dbb395`），第 65～82 行；`tools/restore.ts` 第 184～190 行。

依據：審查請求實作者選擇第 3 點，以及 `listTree` 的介面說明，都承諾遇到符號連結／junction 停住、不跟隨；還原以指定 vault 為寫入範圍。

**觸發與重現：** 先替普通暫存 vault 備份 A.md；把其 `Essence Cards/` 移開，再把同名位置設成指往另一個自編暫存資料夾的 junction，外面放一份改過的 A.md。

- `backupVault` 接受根目錄 junction，將外面檔案列為 `Essence Cards/A.md`。
- `makePlan → applyPlan` 也接受，回報 A「已還原」；junction 目的地的 A 實際被改寫。

**預期／影響：** 應在備份／計畫／還原入口拒絕這個不支援的樹；目前只檢查 `readdir` 回傳的子項，沒有檢查起點 `folder` 本身，因此會備份及改寫 vault 外的內容。一般子目錄 junction 的拒絕探針有通過。

**建議：合併前修並補回歸。** 用 `lstat` 檢查走訪起點與路徑各段的連結身分，還原寫入時也確認實際目的地留在預期範圍；根目錄連結與中途置換都要有測試。維持目前「不支援就明確失敗」的選擇即可。

### F4｜P2｜全庫 ID 檢查沒有收集 ambiguous target 的候選 ID

**軸：規格；證據：已重現。**

位置：分支 `claude/update-safeguards-1` 的 `src/core/backup/plan.ts`（`4dbb395`），第 115～118 行。既有占用判法可對照同 commit 的 `src/state/ids.ts` 第 55～58 行。

依據：任務 §1-2 全庫 ID 檢查、D-134 的 ID 保護；既有 state 會把 `idCandidates` 也當成已占用。

**觸發與重現：** 現有 B.md 如下；備份裡的 A.md 有一個 `abc234`，現在 A 不存在：

```markdown
- 能說明 ^abc234 及其他 ^bcd345
    - Q :: A
```

`parseDeck(B)` 正確輸出 `id: null, idCandidates: ['abc234', 'bcd345']`，但 `planRestore` 只收 `target.id`，因此 A 被列為 `missing restore`。把 ambiguous 目標放在備份選取檔中，也有同一個漏查入口。

**預期／影響：** `abc234` 仍是 B 的待處理身分候選，應擋住會再次占用它的 A；目前會把同一個既有身分再放進另一篇，令家長後續修復進度連結時產生額外衝突。

**建議：合併前修並補回歸。** 全庫占用同時收 `id`、`idCandidates`；同一個 target 內先去重，避免把同一個身分候選重複計成兩個目標。測現在檔與備份檔各自含 ambiguous target，以及排除的系統資料夾。系統資料夾依 `isDeckPath` 排除本身正確。

### F5｜P2｜暫存檔撞名時，catch 會刪掉並非這次建立的檔案

**軸：規範與設計；證據：已重現。**

位置：分支 `claude/update-safeguards-1` 的 `tools/restore.ts`（`4dbb395`），第 185、189、193～195 行。

依據：暫存寫入不應破壞既有檔案；D-150 第 7 點的逐檔選擇及「備份後才有的列出但不動」，以及本輪第 5 點要求核對失敗清理。

**觸發與重現：** 目標為 A.md，旁邊已有內容為 `preexisting temporary` 的 `A.md.abcd.restore-tmp`。計畫把它列為 `added keep`。用公開的 `random: () => 'abcd'` 執行還原，`write(..., 'wx')` 拋 `EEXIST`，catch 隨即 `unlink(temporary)`；A 回報失敗，但原本的暫存檔已被刪除。

**預期／影響：** 應保留既有檔、換名或回報撞名；實際刪掉另一個程序或先前操作留下的檔案。正式隨機碼只有 4 個十六進位字元，既有檔或同時操作撞名時就會走到相同路徑。還原前備份可能保留了它，但不應讓清理刪除未選取的現有檔案。

**建議：合併前修並補回歸。** 明確記錄這次是否已成功獨占建立暫存檔，只清理自己建立的檔；`EEXIST` 保留原檔並換一個名字。半寫後拋 `ENOSPC` 的自有暫存檔仍須刪除。備份暫存檔也應核對同一個所有權原則；本項直接重現的是還原工具。

### F6｜P2｜ZIP 檔名先被寬鬆解碼，損壞 UTF-8 名稱仍可通過 openBackup

**軸：規格；證據：已以自行組成的 ZIP 重現。**

位置：分支 `claude/update-safeguards-1` 的 `src/core/backup/zip.ts`（`4dbb395`），第 27～45 行；使用的依賴為 lockfile 中的 fflate `0.8.3`。

依據：syntax §8 的 UTF-8 檔名、zip 與清單逐路徑一一對應；本輪第 4 點明確要求檢查名稱編碼。

**觸發與重現：** 用 `Zip`／`ZipPassThrough` 組出兩項、未壓縮的 ZIP：`manifest.json` 和 `Essence Cards/x.md`，內容為 `x`。清單的路徑先寫成 `Essence Cards/�.md`，大小／雜湊正確。將 local header 與中央目錄中檔名的 `x` 位元組改成 `0xff`，並設定 UTF-8 flag；其餘不變。

`openBackup` 回傳 `ok: true`。fflate 先用非 fatal 的 `TextDecoder` 把壞名稱轉成 `�`，`filter` 收到的已是替代後的字串；清單與替代字串相符，就被當成健康備份。另一探針把檔名位元組改成單一 `0xe9`、不設 UTF-8 flag，清單寫 `é`，也通過：走的是 Latin1 解碼，並非格式承諾的 UTF-8。

**預期／影響：** 應拒絕不符合 UTF-8 契約的檔名；實際接受壞備份並可能把替代後的名稱寫進 vault，也無法確保其他讀取端解讀同一個名稱。

**建議：合併前修並補回歸。** 在 fflate 解碼前驗原始檔名位元組，做嚴格 UTF-8 檢查及路徑對應；ASCII 名稱沒有 UTF-8 flag 可以正常接受，不能一律要求所有項目都設該 flag。若要支援其他編碼，需先明定解碼契約，再驗一一對應。重複項的中央目錄 `filter` 檢查仍保留，它正確解決了同名物件覆蓋問題。

## 「請特別看」七點的結論

| 項目 | 本輪結論與證據 |
|---|---|
| 1. 還原檔與缺的行 | **通過已測範圍。** 既有 C4 兩反例通過；額外把兩份還原檔與原來源全刪、來源只存在備份、壞行在最後一個非空行、衝突副本的還原檔、同日第二次 apply 的 `-2` 組合驗過。有效 `reviews` 內容／順序、`changes`、`cancelled`、`seen` 等價；兩台同時作答的例子仍到期於 `2026-10-28T10:01:00+08:00`，第二次計畫不補行。壞行問題改指還原檔由既有測試斷言。衝突副本的還原檔只移除最後完整尾綴，符合 §5-3；同裝置同刻的既有例外沒有改掉。 |
| 2. 全庫 ID | **有問題 F1、F4。** 靜態選擇集合的迭代阻擋、同篇重複與 A 擋住後連帶擋 B，既有測試通過；現況原有而未還原的重複不額外阻擋，系統資料夾依 `isDeckPath` 排除正確。實際跳過／失敗沒有回饋到集合，以及候選 ID 漏查，需修。 |
| 3. 備份穩定性 | **主要流程通過，根目錄連結有 F3。** 原始 bytes、同長度且 mtime 不變的修改、增刪檔、JSONL 只追加用舊前綴、讀回 hash、解析指紋、壞卡組 notes、寫壞／空間不足無正式檔，既有測試通過。額外驗 ENOENT 一次後成功為第 2 輪、連續三次則失敗且無輸出；一般子目錄 junction 拒絕。 |
| 4. 讀備份 | **有問題 F6。** 重複 ZIP 項、重複清單 path、兩個 manifest、必要欄位／版本／size／hash／範圍／內容不符的拒絕，既有測試通過；額外根層 `__proto__`、目錄項目與多出的 `Manifest.json` 均拒絕。損壞或其他編碼的名稱仍能通過。 |
| 5. 寫回 vault | **有問題 F1、F2、F3、F5。** 先備份、不同 vault／不同 ZIP 的計畫拒絕、普通檔半寫失敗保留原目標且清理自有 tmp、JSONL 半寫清理，以及成功後重跑補剩餘，已測通過。逐檔即時重驗、失敗後 ID 安全、根 junction 與撞名清理需要修。 |
| 6. 設定資料夾與目的地 | **通過已測範圍。** 非預設 config、來源／目的 config 對應、無 manifest 拒絕備份／阻擋 data、映射後兩來源撞名、Windows A/a 同時阻擋及沿用現有大小寫，既有測試通過。Mac NFC 與大小寫規則只做程式核對，未在 Mac 檔案系統實測。根目錄實際路徑的 F3 另外處理。 |
| 7. 測試與 seams | **30 項有實際價值，但尚不足以擋住上述六項。** seams 的注入位置合理，沒有全域 fs 替換；問題在組合斷言缺漏：失敗測試沒驗失敗後的 ID、變動測試只驗 apply 開始前、不驗多檔寫入期間。§1-6 所列主要 happy path 與基礎失敗路徑已有；需把本輪重現轉成回歸，並將 backup 模組加入實際 browser bundle 的純核心檢查。現有 ESLint 模組邊界會涵蓋新核心目錄，但既有 bundle 測試只明列 deck／study。 |

## Claude 自選做法的十五點回覆

以下是審查者對做法的意見，不新增使用者已確認的決定。

| # | 回覆 |
|---|---|
| 1 | **同意套件與寫出選擇。** 釘死 fflate `0.8.3`、level 6、manifest 在前、兩格縮排、開始時間作 ZIP mtime，符合過渡與未來共用核心的目的。讀取端須補 F6；未來接外掛時把 backup 的 bundle 也加入既有純核心建置檢查。 |
| 2 | **同意。** 新註記優先、舊 Notice 的 BUILD 後備與 `dev: null` 清楚區分可知資訊，未知 BUILD 用「未知」不拿錯版號。兩個 commit 的建置抽函式差異與既有 dev／正式建置測試已核對。 |
| 3 | **同意不跟連結、不靜默略過的政策；實作須補 F3。** 起點本身的 junction 也應拒絕。 |
| 4 | **同意。** ENOENT 視為變動且計入三輪；其他錯誤直接失敗。額外 ENOENT 探針通過。Windows 的未知錯誤文案保留「可能」是 iCloud 佔位檔，符合尚未實測的限制。 |
| 5 | **同意。** 有 error 的卡組與非 UTF-8 卡組原 bytes 備份並記 notes，讓備份不依賴卡組先修好；壞卡組不應被修寫後才備份。 |
| 6 | **同意目前的文字紀錄契約。** 同來源 trim 後逐行比、重複原文補一次、JSON 不重編碼，和既有讀取器一致；非嚴格解碼維持現有壞行讀取行為。這項不保證損壞 UTF-8 的原始 bytes 被還原，但原 bytes 仍在 ZIP 裡；不要將文字補行描述成位元組完整復原。 |
| 7 | **同意。** 只讓每份備份來源的最後非空行使用前綴例外、只比同來源現存行，符合規格；一般中間行不套用。 |
| 8 | **同意。** JSON 作執行契約、Markdown 作差異、2 行上下文、二進位列 size／hash；未給 files 就選計畫允許項、明確選到不可還原項先拒絕，符合維護 AI 操作方式。文字差異超過計算上限會退成行數摘要，整合者應保留這個可見限制。 |
| 9 | **有條件同意。** `isDeckPath` 與原有重複的範圍、理由文字合理；加入 F4 的候選 ID，並以 F1 的實際寫成集合維持全庫不變量。 |
| 10 | **同意。** 還原前備份放來源 ZIP 旁邊，備份失敗就零寫入；config 未確認時 plan 可列問題而 apply 停住，符合保守前提。 |
| 11 | **同意同資料夾暫存後 rename 的方向。** 關閉 Obsidian 的前提有寫在 CLI 說明與輸出；仍須補 F2 的寫前重讀與 F5 的暫存所有權。同步不會因 Obsidian 關閉而必然停止。 |
| 12 | **同意此階段的平台近似。** Windows lowerCase、Mac NFC 加 lowerCase、Linux 原樣，與請求明列的選擇一致；沿用 Windows 現有檔名避免另建大小寫變體。Mac／Linux 真實檔案系統與特殊檔名別名未驗，接上各平台前應測，不將本輪當成跨平台實測。 |
| 13 | **同意。** 一次 apply 共用平台加隨機 4 碼、當地日期，後續撞同來源同日檔名加 `-2`；額外兩次 apply 的實檔探針通過。 |
| 14 | **有條件同意。** 換隨機正式名稱與 rename 前確認不存在，符合目前單一維護程序的範圍；暫存撞名不得刪別人的檔，見 F5。若之後允許多個備份／還原程序同時跑，觸發重新設計獨占建立／不覆寫提交，完成條件是競爭測試中兩份輸出都保留、失敗清理不動對方檔案；本輪沒有把無鎖間隙當成已解決。 |
| 15 | **同意。** tool 是執行工具版本，build 是 vault 已裝版本；每一輪重試重設 started，兩者沒有混用。 |

## 交回 Claude

先修 F1～F6，將以上自編組合補為公開介面的回歸；尤其失敗路徑也要斷言全庫 ID 不重複、較晚寫入的目標保留同步新字、既有 tmp 完整保留、連結目的地沒有被改動、壞名稱的 ZIP 不出計畫。接著在修正 commit 跑完整檢查，附 SHA，針對改過的解析邊界與還原寫入順序再查。此次完整檢查全過，只代表既有 590 項案例通過。

未查：1-3～1-5 與第二部分不在本輪兩個 commit 的授權範圍；未驗真實 Obsidian／iPhone／iCloud 佔位檔、Mac／Linux 檔案系統、全部 ZIP64／其他壓縮與編碼變體、多程序 rename 競爭及實際部署產物，因本輪使用 Windows 隔離自編資料，沒有操作真實 vault 或執行正式安裝。

## Claude 回應（2026-10-29）

Claude（Opus 5.5）｜F1～F6 全部接受，都是實作的問題，規格不用改；每項一個 commit，回歸測試照你重現的組合寫。F4、F6、F5、F3 先寫測試、確認在舊程式上失敗才修；F1、F2 是先改程式，事後用 `git archive` 把修正前的程式（`b210348`）展開到暫存資料夾跑新測試，5 項失敗，修正後通過。第 7 點建議的 bundle 檢查也補上。在 `c4a93c6` 跑 `npm run check` 全過（602 項）。以下 commit 都在分支 `claude/update-safeguards-1`。

| 項目 | 處理 | commit |
|---|---|---|
| F4 | 全庫 ID 檢查的占用改成每個目標的 `id` 加 `idCandidates`，同一個目標先去重（同 `state` 的 `targetIds`）；測現在的與備份的各含 ambiguous 目標 | `ccd7ad6` |
| F6 | `openBackup` 自己讀中央目錄的原始檔名：非 ASCII 要有 UTF-8 旗標且是合法 UTF-8，ASCII 不用旗標；嚴格解出的名稱要和 fflate 讀到的完全相同；ZIP64 不支援、明確拒絕。你的兩個探針（`0xff` 加旗標、`0xe9` 不加旗標）寫成測試 | `bdb7264` |
| F5 | 還原的暫存檔撞到已有的檔就換名字、不刪；只刪這次建立的（建立之後才失敗的半個檔照刪）；備份的 `.tmp` 也只在這次建立時才刪；還原檔的清理只在試過獨占建立之後、且不是 `EEXIST` 時才刪 | `813c9be` |
| F3 | `assertNoLinks` 用 `lstat` 檢查路徑的每一段；`listTree` 檢查起點本身，還原寫入在建資料夾前後與改名前各查一次。測試包含根目錄是 junction（備份與計畫都拒絕），以及在寫暫存檔那一刻把子資料夾換成 junction（改名前擋住、刪掉這次的暫存檔、外面的檔不動） | `b210348` |
| F1 | `planRestore` 為每個要還原的卡組算 `after`（它要加回的 ID 現在在哪幾篇要還原的卡組裡，那幾篇先寫）與 `order`；互相等待的（交換了目標）兩篇都擋住，擋住之後重做 ID 檢查。`--apply` 先排除計畫之後改過的檔，用剩下的重算計畫，照順序寫，前面的沒寫成就跳過等它的。測試照你的兩種分支（計畫後改過、寫入失敗）與 A／B 兩種方向；我原本的「中途寫入失敗」測試其實就是 F1 的例子（B 失敗、A 照寫，`bbb222` 重複），預期已改正並加上全庫 ID 斷言 | `7515798` |
| F2 | 每個檔寫暫存檔前、改名前都重新讀現在的檔比雜湊，不同就跳過（暫存檔刪掉），等它的檔也跟著跳過。測試：寫 B 的暫存檔時 B 被改（改名前擋住）、寫 B 時 A 被改（輪到 A 時擋住） | `3084f62` |
| 第 7 點 | `src/core/backup` 連同 fflate 建成 browser bundle，沒有外部 import | `c4a93c6` |

**自選做法的回覆**：

- 第 6 點：同意。紀錄補行是文字層面的還原（去掉前後空白、不嚴格解碼），不描述成位元組完整復原；原始位元組仍在 zip 裡。
- 第 9、11 點：條件已由 F4、F1、F2、F5 處理。
- 第 12 點：同意只算平台近似。記進 [backlog 技術債](../docs/backlog.md#技術債)：外掛內的還原第一次在 Mac 上用之前，要實測大小寫與 NFC／NFD。
- 第 14 點：同意你寫的觸發點與完成條件，記進 [backlog 技術債](../docs/backlog.md#技術債)：外掛內的備份上線時（每月自動備份可能和更新命令同時跑），正式檔名改成獨占的提交。

**順帶告知**：這一輪之外，分支上另有 `de7627b`（1-4 安裝的擋法）與 `7b2a045`。後者起因是 `de7627b` 第一次 commit 時，pre-commit 裡的安裝測試在暫存資料夾跑 `git init`，吃到 hook 帶來的 `GIT_DIR`，把共用 `.git/config` 的 `core.bare` 改成 `true`，所有 checkout 壞了幾分鐘（已改回，沒有多出 commit 或 tag）。`7b2a045` 讓 hook 在跑檢查前 `unset $(git rev-parse --local-env-vars)`，工具與測試呼叫 git 也拿掉繼承來的 `GIT_*`。這兩個 commit 連同 1-3、1-5 放在第一部分最後的 L2。

## Codex 再查（2026-10-29）

狀態：再查完成，有第一輪未修完整的項目；R1、R2、R3 建議合併前修，R4 可記技術債

範圍固定為 `7b2a0459425354cb90a75cdb6815e6c2f46f24ad..c4a93c6ad80d5d4b174fb93c9c996aa2524e9378`，在獨立 detached 暫存 worktree 驗證 `c4a93c6`。以下程式位置均是**分支 `claude/update-safeguards-1` 的相應路徑（`c4a93c6`）**。本節只回報，沒有改產品程式或既有測試；所有 vault、連結目的地及學習內容均自編。

### R1｜P1｜第一輪 F3／F5 未修完整：父目錄換成 junction 後，清理會誤刪外面的既有檔

**軸：規範與設計；證據：已在沙箱外重現。** 位置：分支 `claude/update-safeguards-1` 的 `tools/restore.ts`（`c4a93c6`），第 218～240 行，尤其 catch 的 `unlink(temporary)`。

**觸發與重現：** 對 `Essence Cards/sub/A.md` 做備份、改字、出計畫。現有 `seams.write` 依序執行：先正常獨占寫好這次的暫存檔；在另一個自編目錄建立**相同暫存檔 basename**、內容為 `outside existing evidence` 的既有檔；將 `sub` 移到 vault 裡的 `moved`，原位置換成指往外面目錄的 junction，然後正常返回。

**預期／實際：** 改名前的 `assertNoLinks` 正確擋下目錄置換，但 catch 仍按舊的字串路徑 unlink。該路徑此時指向外面的檔，結果回報「失敗」、外面檔案卻變成不存在；真正由本次建立的 tmp 仍留在 `moved` 裡。這不是只有留下暫存檔，而是刪掉沒有授權處理的其他內容，違反本輪承諾的「vault 外的檔不動」與「只清理自己建立的檔」。

**建議：合併前修並加回歸。** 清理前須重新確認父目錄與該暫存檔的身分，不能把「曾在這個字串路徑建立過」視為目前仍擁有它。父目錄改變時寧可保留並回報原暫存檔，避免沿新連結刪除。回歸需同時斷言外面既有檔完整保留、原 tmp 的實際位置及錯誤結果；也核對普通檔與還原 JSONL 的清理是否有同一問題。

### R2｜P1｜第一輪 F1 未修完整：written 只記曾成功，釋放的 ID 再同步回來時仍可重複

**軸：規格；證據：已重現。** 位置：分支 `claude/update-safeguards-1` 的 `tools/restore.ts`（`c4a93c6`），第 197～210、227～237 行；`plan.ts` 的相依只根據 `load` 現況建立。

依據仍是 D-150 第 7 點與任務 §1-2 的全庫 ID 保護；第一輪已把同步期間的變動納入風險。

| 時點 | A.md | B.md |
|---|---|---|
| 備份 | `abc234`、`bcd345` | `cde456` |
| 計畫／開始 apply | `abc234` | `cde456`、`bcd345` |

計畫正確排 `B → A`。B 已成功還原、釋放 `bcd345`；寫 A 的暫存檔時，以 seam 做真實檔案寫入，模擬同步把 B 改回 `cde456 + bcd345`，A 本身不變。A 的兩次雜湊重讀都通過，`written` 也仍包含 B，所以 A 照寫。

**實際結果：** A、B 都回報「已還原」，讀回 ID 為 `['abc234','bcd345','cde456','bcd345']`。B 的同步新內容單獨存在時沒有重複；是工具隨後把同一 ID 加回 A 才形成重複。現行新測試只改待寫檔的文字，沒有覆蓋已完成前置檔的 ID 再占用。

**建議：合併前修並加回歸。** 在加入 ID 的提交前重新確認實際全庫占用，尤其前置檔是否仍維持已驗證的釋放狀態；已寫成的路徑集合不能代替占用檢查。被同步重新占用時擋住待加入的檔，保留同步新內容、要求重新計畫。測原本前置檔、未選取的其他檔與新出現卡組三種重新占用來源。

### R3｜P2｜第一輪 F6 未修完整：只驗中央目錄，local header 的損壞 UTF-8 名稱仍通過

**軸：規格；證據：已重現。** 位置：分支 `claude/update-safeguards-1` 的 `src/core/backup/zip.ts`（`c4a93c6`），第 28～66 行。

**觸發：** 用 `writeZip` 建一份清單與檔案都正常的 ZIP，檔案名為 `Essence Cards/x.md`。只把該項 **local file header** 的 `x` 位元組改成 `0xff`，設定 local header 的 UTF-8 flag；中央目錄與 manifest 保持 `x.md`，內容 bytes／hash 不變。

**預期／實際：** 按 syntax §8 的 UTF-8 檔名及壞備份整份不用契約，應拒絕；實際 `openBackup` 仍 `ok: true`。fflate 用中央目錄命名，`strictNames` 也只驗那一份，因此沒有驗到 local header。第一輪的兩個中央目錄壞名稱探針已修，但不能據此聲稱整份 ZIP 的名稱編碼都已驗過。

**影響／建議：合併前修並補相鄰案例。** 驗每一項對應 local header 的簽章、名稱範圍及嚴格 UTF-8 解碼，核對它與中央目錄的名稱契約；壞名稱不出計畫。現有內容 hash 與重複中央目錄檢查繼續保留。

### R4｜P3｜新發現：合法 ZIP 註解內含 EOCD 簽章時，正常備份被誤擋

**軸：規格／讀取邊界；證據：已重現。** 位置：分支 `claude/update-safeguards-1` 的 `src/core/backup/zip.ts`（`c4a93c6`），第 30～35、62 行。

在正常 ZIP 的真正 EOCD 設定 30-byte comment 長度，接上 30 bytes 註解，其中 offset 2 放 `50 4b 05 06`，其餘為零。真正 EOCD 的註解長度與檔尾相符，檔案與清單均不變；`openBackup` 卻報 `manifest.json 不是恰好一個`。fflate 與 `strictNames` 都從尾端挑第一個相符簽章，沒有先驗候選的 comment length、disk/count、central directory 範圍。

**建議：可記技術債。** 目前 `writeZip` 不產生註解，未影響本工具自己產生的正常備份；觸發點是外掛內備份交付或開始接受另一個 ZIP 寫入者之前。完成條件：先依檔尾與長度辨認有效 EOCD，再讓嚴格名稱讀取與解壓使用同一份結構；含這組註解及普通註解的合法 ZIP 均可讀，偽造 EOCD／越界結構被拒絕。

### 第一輪修正與五個特別查核點的結論

| 項目 | 結論 |
|---|---|
| F1／寫入排序 | 原本的計畫後改字、寫入失敗與兩種 A/B 方向已修。額外四篇鏈得到 `D → C → B → A`，三篇交換環全部擋住；混入 data.json、圖片不破壞相依。但還原中途再占用 ID 仍有 R2。 |
| F2／逐檔重讀 | 待寫目標在輪到它之前、或 tmp 寫完到 rename 之間改過，會保留新內容、跳過依賴它的後續檔。就本身雜湊檢查的原案例通過；全庫占用仍須另處理 R2。 |
| F3／連結檢查 | 根目錄 junction 與一般寫前置換的拒絕已有實際回歸。寫完 tmp 後的父目錄置換會在清理造成 R1。設定資料夾允許唯讀備份、拒絕還原寫入，是可接受的過渡限制；計畫若能預先列出 data.json 不能寫，會比 apply 才失敗清楚。 |
| F4／候選 ID | `id + idCandidates` 並在單個目標內去重的修正正確，現在／備份兩側的案例都有測試。 |
| F5／暫存所有權 | EEXIST 保留既有 tmp 並換名已修，備份側競爭建立也有回歸；路徑被置換後的清理所有權仍有 R1。 |
| F6／strictNames | 原本 `0xff + UTF-8 flag`、`0xe9 無 flag` 的中央目錄案例已拒絕；ASCII 無 flag 正常，ZIP64 明確拒絕。仍有 R3，註解邊界另列 R4。 |
| 第 7 點／browser bundle | backup 加入 browser bundle 的檢查方向正確，沒有新增產品出口或放寬核心邊界。 |

### 本次再查驗證

- `npm ci` 成功；指定三檔 **37／37 通過**。完整檢查的其餘結果於兩節查核收尾時一併記在本文末。
- 新探針透過公開介面、自編暫存檔與既有 seams 執行；沒有替換 Node 全域 fs。R1、R2 的副作用只發生在自編暫存目錄，已清除。

未查：真實 Obsidian／iCloud／iPhone、Mac／Linux 檔案系統與多程序原子提交，因本輪固定 Windows 自編隔離資料；本節未將完整檢查的環境中止當成通過。

## Codex 第二輪（2026-10-29）

狀態：L2 查核完成，有問題待修；L1～L5 建議合併前修，第一部分尚未通過合併前查核

範圍是 `4dbb3953b8ec6ad52dd701180836d4d40ee6e16e..7b2a0459425354cb90a75cdb6815e6c2f46f24ad`，以及 `c4a93c6ad80d5d4b174fb93c9c996aa2524e9378..d3e2fadbe37062c53755129e3dab0b0c46c2e584`。在另一份獨立 detached worktree 固定驗 `d3e2fad`，未讀入 Claude 後續未提交的施工。以下程式位置均是**分支 `claude/update-safeguards-1` 的相應路徑（`d3e2fad`）**。依據為審查請求文末第二輪所列任務、D-149、D-150、D-098 與 syntax；只回報，不改產品程式、不對專案 commit。

### L1｜P1｜新發現：設定目的地的 junction 可讓開發版寫進未登錄的 vault

**軸：規格；證據：已重現，建置用既有 build seam，部署與檔案系統操作是真實的。** 位置：分支 `claude/update-safeguards-1` 的 `tools/install.ts`（`d3e2fad`），第 112～121、147～160 行。

依據：D-149 第 4 點、任務 §1-4：「開發版只裝到本機登錄過的測試 vault，擋法寫在安裝命令本身」。

**觸發與重現：** 準備兩個自編空 vault，只登錄其中 test；把 test 的 `.obsidian` 設成指往另一個 **未登錄 vault 的 `.obsidian`** 的 junction。呼叫 `installVault({ vault: test, dev: true, local: 自編登錄位置, root: 自編建置資料夾, build: 正常產出 dev=true 的替身 })`。

**預期／實際：** 應在任何安裝寫入前拒絕外部目的地；實際回傳 `kind: 'dev'`，未登錄 vault 的 `plugins/essence-cards/main.js` 被寫入 `dev=true`、帶 `.dirty` 的建置，外掛啟用清單也沿同一個設定路徑寫入。入口雖對 vault 做 realpath，`deploy` 卻直接 `join(vault, config, ...)`，沒有驗設定路徑與其子項的實際落點；`config` 也沒有相對路徑檢查。

**影響／建議：合併前修並補回歸。** 開發版安裝防線可被繞過，可能改寫真正使用的 vault。安裝前先驗 config 路徑與所有實際寫入位置，拒絕 `..`／外部落點及不支援的連結；保護須包含設定資料夾、plugin 子資料夾、輸出檔及 community-plugins.json。測試應斷言未登錄目的地與啟用清單完全不變，並驗正常 vault 本身是合法別名時仍依登錄規則處理。

### L2｜P2｜新發現：重複 target key 被 Map 蓋掉，發布前比較可把指紋改變報成零差異

**軸：規格；證據：已用同一份凍結 ZIP、兩個真實暫存 commit 跑 compareVersions 重現。** 位置：分支 `claude/update-safeguards-1` 的 `tools/compare/snapshot.ts`（`d3e2fad`），第 58～66 行。

依據：D-149 第 5 點與任務 §1-3 要比較每個學習目標的 ID、指紋及問題，不能靜默少掉一個。

**重現輸入：** 一篇暫停卡組，內有兩個同 ID `abc234` 的明確目標，分別為 `First / Q1 :: A1`、`Second / Q2 :: A2`。在自編暫存 repo 造兩個 commit：舊版是現行 parser，新版只讓 `Q1` 的 fingerprint 改成 `ffffffff`，其他程式不變。用同一份備份比較這兩版，兩邊各在自己的 Node 程序跑真正轉接器。

**實際：** 舊／新 snapshot 第一個目標的指紋分別為 `84fee6d9`、`ffffffff`，第二個同為 `b9987b45`；結果卻是 `comparable: true, differences: []`。原因是 `new Map(targets.map(target => [target.key, target]))` 把第一個同 ID 目標蓋掉。卡組暫停使今天的份為空，重複 ID 的既有診斷兩邊也相同，因此沒有其他欄位替它抓到差異。

**影響／建議：合併前修並補回歸。** 備份容許原本有問題的卡組，不能用「應先沒有重複 ID」當比較前提。保留每個 key 的所有 occurrence、比較數量與內容，或明確將歧義列為衝突／無法比較；不能回報健康的零差異。加上同篇重複、增減重複 occurrence、暫停與未進今日份的案例。

### L3｜P2｜新發現：Windows 小寫 git_dir 漏過隔離，仍會讀到另一個 repo

**軸：規範與設計；證據：錯讀已重現，誤改風險為靜態推斷。** 位置：分支 `claude/update-safeguards-1` 的 `tools/install.ts`（`d3e2fad`）第 38 行、`tools/build.mjs` 第 19 行；compare、update 與新增測試也有相同的 `startsWith('GIT_')` 過濾。

依據：本輪 `7b2a045` 明確處理繼承 Git 環境變數會污染暫存 repo 的事故，要求工具與測試隔離 Git 操作。

**觸發與重現：** 在兩個自編暫存 repo A、B 各造一個不同 commit。子程序設 `GIT_DIR=B/.git` 時，`releaseProblems(A)`、`buildVersion(A)` 正確讀 A；改設小寫 `git_dir=B/.git` 時，兩個函式都讀成 B 的 commit／BUILD。沒有讓測試 Git 操作指向真正專案。

**預期／影響：** Windows 環境名稱不分大小寫，隔離也應涵蓋這種拼法；現在字串過濾只認大寫。正式版條件可能核對錯 repo，BUILD 也會錯；若相同環境進到暫存 repo 的寫入測試，原事故的誤改路徑仍存在。

**建議：合併前修並加機械回歸。** 工具與測試一致以不分大小寫的規則移除 Git 環境變數；核對 hook 啟動子程序的處理。驗大寫、小寫、混合大小寫時，暫存 Git 只讀寫指定 repo，並斷言旁邊 repo 的 config、index、HEAD 都不變。

### L4｜P2｜新發現：還原檔的衝突副本被列成一般裝置版本

**軸：規格；證據：已重現。** 位置：分支 `claude/update-safeguards-1` 的 `src/core/backup/versions.ts`（`d3e2fad`），第 33～39 行；`tools/update-vault.ts` 的輸出只排除 `note === '還原檔'`。

依據：syntax §5-1、任務 §2-1 要求還原檔不算目前版本，並保留原來源；第二輪特別要求驗衝突副本與還原檔的標法。

**觸發：** `Essence Cards/紀錄/2026-10 iPhone-7f3a 還原 2026-10-29 Windows-2c9e 2.jsonl` 裡有正常 `set: app` 行。它是還原檔的衝突副本；但 `logSource` 只移除最後完整還原尾綴，結尾多出的 ` 2` 讓 `restored` 變 false。

**實際／影響：** `lastVersions` 回傳 `note: null`，device 是整個 `2026-10 iPhone-7f3a 還原 2026-10-29 Windows-2c9e 2`；更新命令因而把它印在裝置最後回報清單中，可能把舊的還原證據誤當目前版本回報。

**建議：合併前修並補回歸。** 版本列表的來源分類要辨認還原檔的衝突副本，保留其原來源及衝突身分，繼續排除於目前裝置版本。不要為了列表分類改壞 §5-3 的補行分組規則；兩個用途各依其契約處理。

### L5｜P2｜新發現：比較測試只替換 LF，新 Windows worktree 的 CRLF 讓必跑檢查失敗

**軸：規範與驗證；證據：指定測試實際失敗，來源檔的 CRLF 已讀回確認。** 位置：分支 `claude/update-safeguards-1` 的 `tests/compare-versions.test.ts`（`d3e2fad`），第 82～83 行。

**觸發／實際：** 依任務另開 worktree、npm ci，執行指定五檔。`src/core/study/index.ts` 的換行是 CRLF；測試要移除的字串卻以 `\n` 緊接分號，因此 replace 沒改任何字。接著暫存 repo 的 `git commit -am break` 回傳 `nothing to commit, working tree clean`，整項失敗。38 項中 37 通過、1 失敗。

**預期／影響：** 測試應確實造出缺少 planToday 的版本，且不依賴 checkout 換行；目前正常 Windows 新 worktree 可能連完整檢查都過不了，也沒有驗到宣稱的「接不上」分支。這是測試 fixture 的問題，與另列的記憶體不足／沙箱權限無關。

**建議：合併前修。** 在自編 fixture 正規化換行，或用同時涵蓋 CRLF／LF 的精確替換；commit 前先斷言輸入確實變了。兩種換行都應跑得到「無法比較」及 worktree 清理斷言，不跳過測試。

### 「請特別看」七點結論

| 項目 | 查核結果 |
|---|---|
| 1. 安裝擋法 | 一般未登錄 vault 的 dev 拒絕、入口 realpath、正式版四條件、同版產物一致性與重裝 hash，已有實際通過的測試；目的地仍有 L1，Git 環境仍有 L3。不能把入口 vault 已 realpath 等同所有部署寫入點都受保護。 |
| 2. 比較保真度 | 已真正跑 `048adf0 → d3e2fad`：自編備份、兩個 worktree、各自真正 npm ci、獨立 Node，得到可比較且零差異，清理完成。預設設定、exam=null、整份重播與固定 30 天的限制有揭露，唯讀 Files 沒有走 writer。但逐目標比較有 L2；既有接不上測試在 CRLF 下有 L5。 |
| 3. 更新命令 | 靜態核對順序為發布條件、check、提醒、備份、比較、記錄；baseline 缺失／無法比較沒有被印成零差異。changedSince 與 HEAD、vault、ZIP hash 的檢查已有演練，卡組／data 變動拒絕、追加行與新 JSONL 接受。安裝沿用 L1 的目的地缺口；本輪未對任何真實 vault 安裝。 |
| 4. 考前提醒 | 指定案例通過：前 7 天、期間、4 點換日、無日期、壞屬性／讀不到需 exam-ok。多份生效挑開始最早、只填結束日的降級方式已核對；它們是文末第 13 點的實作者選擇，不擅自升格成使用者新決定。 |
| 5. lastVersions | 兩台相同時間相同值仍分開、同來源最新時間異值不確定、普通衝突副本與標準還原檔分類通過；還原檔的衝突副本有 L4。 |
| 6. pre-commit | 先以 hook 的 index 讀文件及 staged 清單，再 unset 的順序合理；一般 hook 大寫 GIT_DIR 的原事故已有防線，Windows 大小寫仍有 L3。部分 commit 的實際 hook 與 CI 未操作，沒有將靜態核對寫成實跑通過。 |
| 7. 測試／替身 | 安裝測試的真假建置、build 測試的本機登錄位置有隔離；update 的替身不等於真正正式安裝驗收。已補真正跨版本 npm ci／子程序路徑的獨立探針，以及同 ZIP 兩 commit 的漏報重現。CRLF 的 L5 與小寫 Git 環境的 L3 需加入回歸。 |

### Claude 自選做法十六點回覆

| # | 回覆 |
|---|---|
| 1 | **同意。** 以 git common dir 找主資料夾的 .local，適合各 worktree 共用同一套本機登錄與產物；測試可明確傳 local。須配合 L3，確保查的是自己的 common dir。 |
| 2 | **同意入口登錄規則。** 登錄時與比對時都用實際路徑、忽略不存在的登錄，能避免移動 junction 直接繼承測試資格；部署目的地還要補 L1。 |
| 3 | **同意。** 已登錄測試 vault 的正式建置可繼續用作演練，不存正式 releases；測試資格不能沿外部 config 洩漏，見 L1。 |
| 4 | **同意。** 同時驗回傳 dev、產出第一行及 commit 前綴，比只看 dirty 完整。常規錯誤產物的拒絕測試通過；Git 來源受 L3 影響時仍須修。 |
| 5 | **同意。** 同版產物相同可沿用、不同拒絕，避免版本名下有兩份內容；loadRelease 的檔案 hash 驗證已有測試。 |
| 6 | **同意依任務分段。** need／需要版本的回退檢查明確留到第二部分；在第二部分合併與正式部署前須補驗，現在不能宣稱已防不相容回退。 |
| 7 | **方向同意，實作須補 L3。** Windows 的名稱比較也要不分大小寫；讀 staged 後 unset 的順序保留。 |
| 8 | **同意。** 以必要介面能否接上選 adapter，未知介面／例外不當零差異；兩個計算 import 的局部 ESLint 例外限於 tools，沒有放寬 src 邊界。fixture 的失敗見 L5，輸出逐目標比較還須修 L2。 |
| 9 | **有條件同意。** 預設設定與 exam=null 已明示限制；整份重播、固定 30 天、不模擬未來作答的口徑一致。單張強制放進 share 取得第一題，僅代表該目標有機會被選到時的題目，不是整段互動的逐張播放順序；目前報告應維持這個限定。 |
| 10 | **同意。** Node rm 移除連結本身再 prune，與 npm ci ignore-scripts 的理由合理。真正跨版本 npm ci 的探針完成後沒有留下比較用 worktree；本輪清理同樣不使用 git worktree remove --force。 |
| 11 | **同意方向。** 正式產物 hash 優先、否則 BUILD commit、缺失就明說；不把基線缺失當零差異。舊版與 repo 實際對應仍由本機資料的正確性承擔。 |
| 12 | **同意。** 同 vault、HEAD、ZIP hash 綁定，加上資料重驗與成功後消耗紀錄，符合兩段流程；這不取代部署目的地 L1 的檢查。 |
| 13 | **同意目前列明的降級行為。** 日期未定與讀不到分開、前 7 天／期間／讀不到才需 exam-ok，符合維護 AI 操作的前提；只寫結束日不推定開始日。未將這些細節寫成新 D-ID。 |
| 14 | **同意。** --to 是測試與使用者指定本機位置的必要出口，仍受 backup 的 vault 外檢查。 |
| 15 | **同意位置與衝突優先顯示。** backup 可用命名規則，study 不反向依賴；同刻異值 build=null 合理。補 L4，避免復原證據流入目前版本列表。 |
| 16 | **同意只加提醒、不自行改預設。** App 私有位置的實際環境與預設存放位置仍等使用者決定；本輪未在 Claude App 內驗解除安裝或虛擬化，也未替使用者選位置。 |

### 第二輪驗證與交回

- `npm ci` 成功；指定五個檔 **38 項中 37 通過、1 失敗**，失敗就是 L5。完整套件及機械檢查的最終結果於本文末補記。
- 真正跨版本比較：`048adf0` 與 `d3e2fad` 各以自己的 lockfile 裝依賴、各用獨立 Node 讀同一份自編 ZIP，`comparable=true`、零差異；另以自編暫存 repo 的兩個 commit 重現 L2。暫存 repo 的 commit 只為造測試版本，沒有對專案 commit。
- 請先核對、修正 R1～R3 與 L1～L5，加上本輪重現的回歸；R4 若延後，照其觸發點與完成條件記進技術債。修正後提供確切 SHA，再查改過的路徑、清理與比較邊界。既有案例通過不涵蓋本輪已重現的反例。

未查：真正正式安裝／退回、私人 vault、Obsidian／iPhone／iCloud 佔位檔、Mac／Linux、Claude App 虛擬化解除安裝、實際部分 commit hook 與 CI，因本輪只用 Windows 自編隔離資料、沒有正式部署授權；完整 npm check 的環境中止另於收尾列明。

### 本次兩節的最終驗證與清理

Windows、Node `v24.13.0`；需要檔案系統、Git 與建置的檢查均在沙箱外跑。兩份新 worktree 都依各自 lockfile 執行 npm ci。最後核對兩份工作樹乾淨、HEAD 分別為完整的 `c4a93c6ad80d5d4b174fb93c9c996aa2524e9378`、`d3e2fadbe37062c53755129e3dab0b0c46c2e584`；沒有產品或既有測試的修改。

| 檢查 | c4a93c6 | d3e2fad |
|---|---|---|
| npm ci | 通過 | 通過 |
| 型別 tsc --noEmit | 通過 | 通過 |
| ESLint | 中止：Node Zone Allocation failed，退出碼 134 | 未完成：同一記憶體限制下未再重跑這個高記憶體步驟 |
| knip | 通過 | 通過 |
| secretlint（相同 tracked-files 清單、規則與遮罩設定） | 通過 | 通過 |
| skill 副本一致性、文件檢查 | 通過 | 通過 |
| 指定相關測試 | 37／37 通過 | 37／38 通過，L5 失敗 |
| 全部測試，逐檔序列執行 | **602／602 通過** | **612／613 通過**；唯一失敗仍是 L5，0 跳過 |
| npm run check 整體 | **未完整通過** | **未完整通過** |

**環境限制不是產品測試失敗：** 最初 PowerShell／npm.ps1 出現 NullReference，之後系統回報分頁檔不足（1455／0x800705AF）；改用系統 PowerShell、cmd 與縮小 Node 年輕代記憶體配置後，c4a93c6 的完整 check 已跑過型別，但停在 ESLint 的記憶體配置失敗。直接跑相同 ESLint 仍失敗。於是將其他步驟按 package script 的相同檢查內容分開執行，沒有少掃檔案或放寬規則。上述表格沒有把完整 check 或尚未完成的 ESLint 記為通過。

**L5 的對照：** 在另一份自編 archive 副本中，只將 `src/core/study/index.ts` 的 fixture 換行由 CRLF 正規化成 LF，再跑原本 `tests/compare-versions.test.ts`，**4／4 通過**，包括「接不上 → 無法比較」與清理斷言。原專案及兩份審查 worktree 不改；這個對照不計入 d3e2fad 原本 613 項的通過數。

**清理：** 兩個本次新建暫存 worktree 均先驗絕對路徑、確切 SHA、乾淨狀態與所屬 repo，再用 Node rm 移除、git worktree prune；沒有用 git worktree remove --force。自編 vault、暫存 repo 與探針副本已清除。先前 app 視為 primary checkout 的既有審查 worktree保留，沒有改動。主資料夾只修改本報告，未 commit。

未查／未完成：上兩節各自列出的實機、其他平台、正式部署、部分 commit hook 與 CI；兩個版本的完整 npm check／ESLint 因上述實際記憶體與啟動限制未完成，應在資源恢復及修正 L5 後補跑，不能用本次測試計數代替整套檢查通過。

## Claude 回應（再查與第二輪，2026-10-29）

Claude（Opus 5.5）｜R1～R3、L1～L5 全部接受，都是實作的問題；R4 照你的建議記技術債。每項一個 commit，回歸測試照你重現的情境寫，都先確認在舊程式上失敗才修（R1 與 R2 在同一段寫入迴圈，改完後拆成兩個 commit：先暫時拿掉 R2 的部分 commit R1，再放回來）。在 `0e1af6c` 跑 pre-commit 的完整檢查：621 項全過，ESLint 這次跑完（記憶體已恢復）。以下 commit 都在分支 `claude/update-safeguards-1`。

| 項目 | 處理 | commit |
|---|---|---|
| L5 | 拿掉 `planToday` 那一行改用同時認得 LF／CRLF 的寫法；測試先斷言 LF 與 CRLF 兩種範例和真的檔都真的改了。另在 `git archive` 展開、把該檔轉成 CRLF 的副本跑過，4 項通過 | `741cc5a` |
| L4 | 版本列表先去掉衝突副本的 ` 2` 再看還原檔尾巴：還原檔的衝突副本標「還原檔」、歸原來的裝置；§5-3 的補行分組照舊用 `logSource` | `169228a` |
| L2 | `diffSnapshots` 照 key 分組保留每一個：逐一照順序比、次數不同也算差異；問題清單也照次數比。測試照你的重現（兩個 `abc234`，第一個指紋改了）與次數增減 | `ce03678` |
| R3 | `strictNames` 逐項核對本地標頭：簽章、名稱位元組和中央目錄相同、非 ASCII 有 UTF-8 旗標。測試只改本地標頭 | `76a8a23` |
| L3 | 新增 `tools/git.ts` 的 `gitEnv()`／`git()`（名稱不分大小寫），install、compare-versions、update-vault 與測試都用它；`build.mjs` 因為測試會單獨複製它，留自己的一份但同樣不分大小寫。原本就有同樣寫法的 `tests/check-docs.test.ts`、`tests/quality.test.ts` 一起改。測試設 `git_dir` 與 `Git_Dir` 指到另一個 repo，`releaseProblems`、`buildVersion` 仍讀自己的 | `6564a67` |
| L1 | `deploy` 寫入前，三個外掛檔與 `community-plugins.json` 的每一段路徑都不能是連結；`--config` 要是相對 vault 的一般路徑。測試照你的重現（測試 vault 的 `.obsidian` 連到未登錄 vault） | `2c3b490` |
| R1 | 暫存檔寫好後先確認路徑上沒有連結，才記下它的身分（dev 與 inode）；刪之前要路徑上仍沒有連結、而且是同一個檔，不確定就留著並在結果寫出暫存檔的位置。建立時就失敗的半個檔只查連結。還原檔（JSONL）與備份的 `.tmp` 也照這個原則。測試照你的重現 | `1305cfa` |
| R2 | 卡組改名前重新讀現在全部的卡組，這一篇（含 ambiguous 目標的候選）的任何 ID 在別篇出現就跳過，讀不到的卡組也擋住；等它的檔照寫入順序跟著跳過。測試三種占用來源：已還原的前置檔、沒選的其他卡組、新出現的卡組 | `47ee24e` |
| R4（P3） | 記進 [backlog 技術債](../docs/backlog.md#技術債)，觸發點與完成條件照你寫的 | — |

**你的附帶建議**：自選做法第 9 點，報告的「限制」補上「今天的份裡每張的題目是那一張單獨出時的第一題，不是整段複習的出題順序」（`99af80a`）；F3 的附註，設定資料夾的路徑上有連結時，`--plan` 就把 data.json 標成擋住並寫出原因，不等到 `--apply`（`0e1af6c`）。

**使用者的決定**：第 16 點從「只印提醒」改成拒絕：在封裝 App 裡跑、備份位置的實際路徑落在 App 的私有資料夾時，`backupVault` 丟錯並要求 `--to`，`restore --apply` 的還原前備份也有 `--to`（`d39cde2`，使用者 2026-10-29 選 A；過渡工具的備份位置由使用者指定，記在本機 Claude 的記憶）。syntax §8「位置」與任務說明 1-1 已寫明。
