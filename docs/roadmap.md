# Essence Cards｜開發現況與路線圖

更新：2026-10-29

## 現在在哪裡

v1 開發中（2026-10-20 開始寫程式）。開工只讀這一節；還沒開工的 v1 工作看 [backlog 的 v1 任務](backlog.md#v1-需要做的任務)，要找決定看[決策索引](decisions.md#索引)（[D-141](decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)）。

| 工作 | 狀態 | 下一步 | 等誰 | 入口 |
|---|---|---|---|---|
| iCloud 雲端佔位檔（第一優先） | 已定案（[D-154](decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測)）；Windows 實測與存檔受阻的提示都做完，在分支 `claude/icloud-placeholders`（結果在任務說明〈結果〉）| 使用者決定合併；`save.ts` 和更新防線第二部分改了同幾行，後合併的要解衝突（任務說明〈結果〉第二部分）；iPhone 的部分在下一次實機測試 | 使用者 | [任務說明](../tasks/icloud-placeholders.md) |
| 維修與查修的準備 | 盤點完成，缺口 G1～G3；使用者同意 G1（正式版把錯誤記下來），位置與格式的討論稿寫好 | Codex 查核；一致後交使用者確認，寫成 D-ID 與任務說明 | 使用者（開 Codex） | [規畫](plans/maintenance.md)、[討論稿](<../Claude Codex Discussion/2026-10-29-error-log.md>) |
| 第一個里程碑的品質檢查 | R1～R5、R7、R8 與 T2 已在 `main` 做完（R5 含 A3，見已完成）；R10 記下即可 | R6、R9 等觸發點：R6 寫入口畫面時決定要不要加 happy-dom，R9 在下一次 iPhone 測試照做 | 觸發點 | [報告](<../Claude Codex Discussion/2026-10-27-milestone-1-review.md>) |
| 國小社會預設 | v0.1 第一次試用完 | 決定地名配特色要不要出卡與四點修改，改成 v0.2，再用 Sol 對照 2-1 | 使用者 | [預設](card-rules/elementary-social.md) |
| 更新與相容 | 已定案（[D-149](decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝)～[D-151](decisions.md#d-151-內建製卡規則改版內建跟著外掛改了就是自訂版)）；更新防線兩個部分都已合併進 `main`：第一部分（`8aa3078`，1-1～1-5）、第二部分（`1308e58`，版本行與讀取閘門）；iPhone 兩項併進下一次實機測試 | 更新防線第 3 步：升 `0.1.0`、打 tag，問過使用者才裝到正式使用的 vault | Claude（裝之前問使用者） | [任務說明](../tasks/update-safeguards.md)、[第二部分審查請求](../tasks/update-safeguards-2-review.md)、[第二部分回報與回應](<../Claude Codex Discussion/2026-10-29-update-safeguards-2-review.md>)、[第一部分審查請求](../tasks/update-safeguards-1-review.md)、[中途查核與回應](<../Claude Codex Discussion/2026-10-29-update-safeguards-1-review.md>)、[格式查核與回應](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md#claude-回應-codex-格式查核2026-10-29>)、[規畫](plans/updates.md) |
| 外掛架構逐環節檢視 | 環節 1、4、7、8 已談定（[D-142](decisions.md#d-142-範圍與目錄模組的六項選擇)、[D-148](decisions.md#d-148-電腦專用的主機接點)；環節 4 的施工記進 [backlog 技術債](backlog.md#技術債)）；環節 5（Obsidian 接線層）Claude 與 Codex 一致，結論七條 | 使用者確認七條；同意後改雲端佔位檔任務 §2、寫進 backlog | 使用者 | [討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>) |
| 學習目標架構第三輪 | 暫選 R3 | 兩三個新單元與段考到齊再跑 | 新教材 | [D-132](decisions.md#d-132-學習目標架構暫選-r3第三輪在新教材比三組) |
| 製卡規則下一輪試用 | 等真實影片筆記 | 看目標數量、共同成功判準、洩漏與放錯池 | 新教材 | [試用紀錄](card-rules/trials.md) |
| 英文一字多義 | 規則已改（D-125） | 有多義字的真實教材時試用 | 新教材 | [D-125](decisions.md#d-125-英文規則依製卡流程重排與一字多義的學習目標) |
| 獨立手機版與不用 iCloud 的同步（規畫） | 使用者補充卡點是 iCloud；Claude 第二輪建議先在外掛裡自己同步（使用者的 Dropbox），脫離 Obsidian 之後再談 | 使用者決定同步要不要提前到 v1；Codex 查核兩輪 | 使用者 | [討論稿](<../Claude Codex Discussion/2026-10-29-standalone-phone-app.md>)、[計畫](plans/standalone-app.md) |

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
| 2026-10-29 | 雲端佔位檔的 Windows 實測與存檔受阻的提示（[任務說明](../tasks/icloud-placeholders.md)〈結果〉，分支 `claude/icloud-placeholders`，`03b69f1` 等，677 個測試）：追加寫入舊內容不變；iCloud 停著時讀取 5 ms 失敗、剛重開時卡 60 秒；iCloud 沒在跑時追加的紀錄不會上傳（使用者選不改程式、記技術債）；受阻時存檔、按鈕與小視窗都說「讀取完成後請再按一次存檔」 |
| 2026-10-29 | 更新防線第二部分合併進 `main`（`1308e58`，[任務說明](../tasks/update-safeguards.md)、[L2 報告與回應](<../Claude Codex Discussion/2026-10-29-update-safeguards-2-review.md>)）：每台裝置記版本行，讀不懂的卡組與紀錄先停著、不出題也不寫；Codex L2 加三次再審後通過，合併後 747 個測試通過；開發命令結果檔改記 BUILD（`b6b39bb`），回看按鈕與比較轉接器記技術債 |
| 2026-10-29 | `state` 的讀寫先後與寫入協調合併進 `main`（`70ba562`，[任務說明](../tasks/state-writes.md)、[L2 報告](<../Claude Codex Discussion/2026-10-29-state-writes-review.md>)）：寫入排成一列、先讀完待讀、一個門檻，存檔寫進磁碟並核對後才採用；Codex L2 三輪後通過，合併後 673 個測試通過；V6 記成已知限制（[討論稿](<../Claude Codex Discussion/2026-10-29-save-external-write.md>)） |
| 2026-10-29 | 更新防線第一部分合併進 `main`（`8aa3078`，[任務說明](../tasks/update-safeguards.md)、[查核與回應](<../Claude Codex Discussion/2026-10-29-update-safeguards-1-review.md>)）：備份、還原工具、發布前比較、安裝的擋法與更新命令；Codex 四輪查核的發現都已修，R4 與無鎖空檔記技術債 |
| 2026-10-29 | 雲端佔位檔讀不到時的處理定案（[D-154](decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測)，[討論稿](<../Claude Codex Discussion/2026-10-29-icloud-placeholders.md>)）：說明書教保持下載、存檔受阻時當下說清楚、先分段實測；不自動補延後的 ID、不改 iCloud 設定 |
| 2026-10-29 | 新決定與新任務先和「不做」比較（[D-153](decisions.md#d-153-每個新決定與新任務先和不做比較)）：寫在 essence-discuss、essence-decision 與 quality.md 的規劃者一列，AGENTS.md 只補半句 |
| 2026-10-29 | 更新防線第 0 步：最低版本標記、版本行、還原檔與備份檔的格式寫進 [syntax.md](syntax.md)（§0-1、§5-1～5-3、§8），Codex 格式查核的 F1～F4 已照改（[查核與回應](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md#claude-回應-codex-格式查核2026-10-29>)）；讀不到自己的紀錄時不擋作答（[D-149](decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 補充） |
| 2026-10-29 | 未來規畫統整的審閱結案（[審閱](<../Claude Codex Discussion/2026-10-23-future-plans-consolidation.md#claude-審閱2026-10-28opus-55-高>)、[任務說明](../tasks/future-plans-review.md)）：122 項補回遺漏 1、原意與來源 4 處；使用者決定 Capture 開工前研究放 v1、真實驗證不算 v1、C-017 列第二階段、C-011 → D-152、C-009 結案 |
| 2026-10-29 | 教材不限課本、補充筆記另外放（[D-152](decisions.md#d-152-教材是針對考試範圍的文件補充筆記另外放)）：針對考試範圍的學校講義、補習班教材算課內，延伸改從「教材以外」算，不一致時學校的優先；舊共識 C-011 結案（[統整審閱](<../Claude Codex Discussion/2026-10-23-future-plans-consolidation.md#請使用者決定>)） |
| 2026-10-28 | 更新與相容定案（[D-149](decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝)、[D-150](decisions.md#d-150-備份與還原)、[D-151](decisions.md#d-151-內建製卡規則改版內建跟著外掛改了就是自訂版)，[討論稿](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md>)）：每台裝置記版本、讀不懂就停、正式 vault 只裝正式版；外掛自己備份（每月一次、隨時手動），紀錄只補不刪；內建規則跟著外掛、改了就是自訂版 |
