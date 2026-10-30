# Essence Cards｜開發現況與路線圖

更新：2026-10-30

## 現在在哪裡

v1 開發中（2026-10-20 開始寫程式）。開工只讀這一節；還沒開工的 v1 工作看 [backlog 的 v1 任務](backlog.md#v1-需要做的任務)，要找決定看[決策索引](decisions.md#索引)（[D-141](decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)）。

| 工作 | 狀態 | 下一步 | 等誰 | 入口 |
|---|---|---|---|---|
| iCloud 雲端佔位檔（第一優先） | 已定案（[D-154](decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測)）；Windows 實測與存檔受阻的提示已合併進 `main`（`9c07caa`，結果在任務說明〈結果〉） | iPhone 的 E1、E6、E8 在下一次 iPhone 實機測試；說明書的兩段與「電腦的 iCloud 要開著」跟說明書一起寫；技術債三列等觸發點 | iPhone 實機測試 | [任務說明](../tasks/icloud-placeholders.md) |
| 維修與查修的準備 | 盤點完成，缺口 G1～G3；G1 定案（[D-155](decisions.md#d-155-正式版的錯誤紀錄)），任務說明寫好、還沒開工 | 本機照[任務說明](../tasks/error-log.md)做（學生每天使用前）；Claude 再問 G2、G3 要不要延後 | 使用者（排本機開工）、Claude | [規畫](plans/maintenance.md) |
| 第一個里程碑的品質檢查 | R1～R5、R7、R8 與 T2 已在 `main` 做完（R5 含 A3，見已完成）；R10 記下即可 | R6 (b)、R9 等觸發點：R6 (b) 寫入口畫面時決定要不要加 happy-dom，R9 在下一次 iPhone 測試照做；R6 (a) 併進 backlog「`tests/`、`tools/` 沒有型別檢查」那一列 | 觸發點 | [報告](<../Claude Codex Discussion/2026-10-27-milestone-1-review.md>) |
| 國小社會預設 | v0.1 第一次試用完 | 決定地名配特色要不要出卡與四點修改，改成 v0.2，再用 Sol 對照 2-1 | 使用者 | [預設](card-rules/elementary-social.md) |
| 更新與相容 | 已定案（[D-149](decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝)～[D-151](decisions.md#d-151-內建製卡規則改版內建跟著外掛改了就是自訂版)）；更新防線完成，`0.1.0` 已裝到正式使用的 vault；外掛內備份與還原的任務說明已寫 | 第一部分（備份）的程式與 Windows 實機做完，在分支 `claude/plugin-backup-1`；設定頁依功能分區（D-156）。等 Codex L2，之後合併（使用者決定）與正式安裝。還原畫面放到 v1 結案前（使用者 2026-10-29） | 使用者（開 Codex） | [外掛內備份任務說明](../tasks/plugin-backup.md)、[L2 審查請求](../tasks/plugin-backup-1-review.md)、[規畫](plans/updates.md) |
| 外掛架構逐環節檢視 | 環節 1、2、4、5、6、7、8、9 已談定（[D-142](decisions.md#d-142-範圍與目錄模組的六項選擇)、[D-148](decisions.md#d-148-電腦專用的主機接點)、[D-157](decisions.md#d-157-重複的學習目標-id先停家長選)；環節 2、4、5、6、9 的施工記進 [backlog 技術債](backlog.md#技術債)，環節 5 的存檔受阻提示已隨雲端佔位檔任務合併；環節 9 有四列、環節 2 有兩列觸發點已到） | 環節 3（學習狀態模組）：S1～S5 Claude 與 Codex 已一致；Codex 新報的 S6（只缺換行的完整一行）等 Codex 第二輪，之後交使用者確認 | Codex | [討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>) |
| 學習目標架構第三輪 | 暫選 R3 | 兩三個新單元與段考到齊再跑 | 新教材 | [D-132](decisions.md#d-132-學習目標架構暫選-r3第三輪在新教材比三組) |
| 製卡規則下一輪試用 | 等真實影片筆記 | 看目標數量、共同成功判準、洩漏與放錯池 | 新教材 | [試用紀錄](card-rules/trials.md) |
| 英文一字多義 | 規則已改（D-125） | 有多義字的真實教材時試用 | 新教材 | [D-125](decisions.md#d-125-英文規則依製卡流程重排與一字多義的學習目標) |
| 獨立手機版與不用 iCloud 的同步（規畫） | 使用者補充卡點是 iCloud；Claude 第二輪建議先在外掛裡自己同步（使用者的 Dropbox），脫離 Obsidian 之後再談 | Codex 查核兩輪（D-154 的 Windows 實測已做完，結果補進討論稿）；回應後再決定同步要不要進 v1 | 使用者（開 Codex） | [討論稿](<../Claude Codex Discussion/2026-10-29-standalone-phone-app.md>)、[計畫](plans/standalone-app.md) |

第一個里程碑：W1～W6 打通「手寫卡組 → iPhone 複習 → 自評 → 排程」（D-111），2026-10-27 達成；品質檢查見上表。接下來照 D-111 的順序，從 [backlog 的 v1 任務](backlog.md#v1-需要做的任務)挑下一批。

## 路線圖

只分 **v1 需要做的任務** 與 **第二階段想做的事**（[D-130](decisions.md#d-130-任務分成-v1-與第二階段)）。目前規格照 D-039、D-111 開發；v1 完工後先做真實使用驗證，不算 v1（D-130 補充）；第二階段不再細分「增強版」「v2 之後」等階段，也未排定功能先後。

```mermaid
flowchart LR
  A["v1 要做<br/>最小複習閉環、AI 製卡、PDF／圖片轉錄"]:::now --> B["真實使用驗證（不算 v1）<br/>一位學生 × 一次考試"]
  B -.->|依結果與使用者選擇排優先順序| C["第二階段想做<br/>統一清單，細項以連結引用"]
  classDef now fill:#ffd54f,stroke:#f57f17,color:#000
```

| 工作 | 範圍與入口 | 完成或開工條件 |
|---|---|---|
| v1 需要做的任務 | [產品定義 §5](product.md#5-範圍-第-7-步)、[任務入口](backlog.md#v1-需要做的任務)。W4～W6 後接 AI 製卡與 Capture，照 D-111；目前進度見上方「現在在哪裡」 | 能在 iPhone 完成段考範圍的每日複習；交付完整 HTML 使用說明書（D-048），說明學習目標 ID 與題目指紋。v1 完工前（功能做完、開始真實使用驗證前）Claude 仍先問使用者：[產品路線](plans/learning-growth.md)要不要納入部分內容；[學習地圖的視覺化](plans/motivation.md#使用者提議把學習地圖做成有質感的視覺化)要不要做（使用者 2026-10-26 要求在 v1 正式結案前提醒） |
| 真實使用驗證 | 一位學生、一次考試，依[成功標準](product.md#2-成功標準-第-1-步)與 D-075 記錄結果；不算 v1，也不算功能階段（[D-130](decisions.md#d-130-任務分成-v1-與第二階段) 補充）。舊決定稱「第 2 階段」 | v1 完工後開始；結果決定第二階段先做什麼 |
| 第二階段想做的事 | [唯一清單](backlog.md#第二階段想做的事)，細項放 [docs/plans/](plans/README.md)，包括動機、題庫、內容深化、體驗、生態及獨立 App | 依驗證結果及使用者選擇排定要做的項目，再完成各自規格與驗收；列入不代表全部已採用或同版交付 |

## 未來準備開發：獨立 App

已列入第二階段清單（D-129），尚未實作；[開工準備與未決選擇](plans/standalone-app.md)集中在同一主題文件，架構邊界見[架構文件](architecture.md#未來獨立-app規劃中)。

## 已完成

只留最近 10 列，一列一句約 80 字加連結；加新的一列時，把最舊的搬到[已完成（封存）](archive/roadmap-completed.md)的最上面，相對路徑改成以 `docs/archive/` 為基準（[D-099](decisions.md#d-099-文件精簡)、[D-141](decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)）。

| 日期 | 工作 |
|---|---|
| 2026-10-30 | 外掛架構逐環節檢視的環節 2（卡組模組）談定（[討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)〈環節 2 的結論〉）：重複的學習目標 ID 先停、家長選（[D-157](decisions.md#d-157-重複的學習目標-id先停家長選)）；寫錯的目標要看得到、連結裡的 `^id` 被搬走等記進 [backlog 技術債](backlog.md#技術債)，D-047 列回 v1 任務 |
| 2026-10-30 | 設定頁依功能分區、不寫「給家長」（[D-156](decisions.md#d-156-設定頁依功能分區不寫給家長)，使用者看外掛內備份的設定頁截圖時提出）：分複習、學期、AI 製卡、備份四區；入口的「給家長」另外問 |
| 2026-10-30 | 正式版的錯誤紀錄定案（[D-155](decisions.md#d-155-正式版的錯誤紀錄)，[討論稿](<../Claude Codex Discussion/2026-10-29-error-log.md>)）：每台裝置每月一個小檔在 `紀錄/錯誤/`，只記自己的錯、有去重與上限、寫不進去就丟；正式安裝存對照表；還原不列它。[任務說明](../tasks/error-log.md)交本機 |
| 2026-10-30 | `state/index.ts` 原樣拆檔合併進 `main`（`0e3e8a4`，[任務說明](../tasks/state-split.md)、[L2 報告](<../Claude Codex Discussion/2026-10-29-state-split-review.md>)）：拆成讀取層 `reads.ts`、寫入 `writes.ts`、`ids.ts`、組合 `index.ts`，只搬不改行為，更新防線第二部分一起整合；Codex L2 沒有要修的，Windows 輪流對照各 5 次全過，755 個測試通過 |
| 2026-10-29 | 更新防線完成，第一個正式版 `0.1.0`（tag `v0.1.0`，`a4922fa`，[任務說明](../tasks/update-safeguards.md) §3）裝到正式使用的 vault：第一次安裝沒有卡組與紀錄可備份、沒有舊版可比，用 `install-vault` 照正式版的擋法裝，讀回雜湊相同，電腦與 iPhone 重開後都記下 `0.1.0+a4922fa` 的版本行；升版時改了 7 個寫死版號的測試 |
| 2026-10-29 | 雲端佔位檔的 Windows 實測與存檔受阻的提示（[任務說明](../tasks/icloud-placeholders.md)〈結果〉，合併進 `main` 的 `9c07caa`，754 個測試）：追加寫入舊內容不變；iCloud 停著時讀取 5 ms 失敗、剛重開時卡 60 秒；iCloud 沒在跑時追加的紀錄不會上傳（使用者選不改程式、記技術債）；受阻時存檔、按鈕與小視窗都說「讀取完成後請再按一次存檔」 |
| 2026-10-29 | 更新防線第二部分合併進 `main`（`1308e58`，[任務說明](../tasks/update-safeguards.md)、[L2 報告與回應](<../Claude Codex Discussion/2026-10-29-update-safeguards-2-review.md>)）：每台裝置記版本行，讀不懂的卡組與紀錄先停著、不出題也不寫；Codex L2 加三次再審後通過，合併後 747 個測試通過；開發命令結果檔改記 BUILD（`b6b39bb`），回看按鈕與比較轉接器記技術債 |
| 2026-10-29 | `state` 的讀寫先後與寫入協調合併進 `main`（`70ba562`，[任務說明](../tasks/state-writes.md)、[L2 報告](<../Claude Codex Discussion/2026-10-29-state-writes-review.md>)）：寫入排成一列、先讀完待讀、一個門檻，存檔寫進磁碟並核對後才採用；Codex L2 三輪後通過，合併後 673 個測試通過；V6 記成已知限制（[討論稿](<../Claude Codex Discussion/2026-10-29-save-external-write.md>)） |
| 2026-10-29 | 更新防線第一部分合併進 `main`（`8aa3078`，[任務說明](../tasks/update-safeguards.md)、[查核與回應](<../Claude Codex Discussion/2026-10-29-update-safeguards-1-review.md>)）：備份、還原工具、發布前比較、安裝的擋法與更新命令；Codex 四輪查核的發現都已修，R4 與無鎖空檔記技術債 |
| 2026-10-29 | 雲端佔位檔讀不到時的處理定案（[D-154](decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測)，[討論稿](<../Claude Codex Discussion/2026-10-29-icloud-placeholders.md>)）：說明書教保持下載、存檔受阻時當下說清楚、先分段實測；不自動補延後的 ID、不改 iCloud 設定 |
