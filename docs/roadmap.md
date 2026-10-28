# Essence Cards｜開發現況與路線圖

更新：2026-10-29

## 現在在哪裡

v1 開發中（2026-10-20 開始寫程式）。開工只讀這一節；還沒開工的 v1 工作看 [backlog 的 v1 任務](backlog.md#v1-需要做的任務)，要找決定看[決策索引](decisions.md#索引)（[D-141](decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)）。

| 工作 | 狀態 | 下一步 | 等誰 | 入口 |
|---|---|---|---|---|
| 第一個里程碑的品質檢查 | R1～R5、R7、R8 與 T2 已在 `main` 做完（R5 含 A3，見已完成）；R10 記下即可 | R6、R9 等觸發點：R6 寫入口畫面時決定要不要加 happy-dom，R9 在下一次 iPhone 測試照做 | 觸發點 | [報告](<../Claude Codex Discussion/2026-10-27-milestone-1-review.md>) |
| 國小社會預設 | v0.1 第一次試用完 | 決定地名配特色要不要出卡與四點修改，改成 v0.2，再用 Sol 對照 2-1 | 使用者 | [預設](card-rules/elementary-social.md) |
| 更新與相容 | 已定案（[D-149](decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝)～[D-151](decisions.md#d-151-內建製卡規則改版內建跟著外掛改了就是自訂版)）；更新防線第一部分做完（分支 `claude/update-safeguards-1`，1-1～1-5）；Codex 中途查核的 F1～F6 已修 | Codex 再查修正並做第一部分的 L2；使用者決定備份的預設位置（在 Claude App 裡跑時會進 App 的私有資料夾）；合併後開第二部分；做完更新防線才裝下一版到正式使用的 vault | 使用者（開 Codex、決定備份位置） | [任務說明](../tasks/update-safeguards.md)、[審查請求](../tasks/update-safeguards-1-review.md)、[中途查核與回應](<../Claude Codex Discussion/2026-10-29-update-safeguards-1-review.md>)、[格式查核與回應](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md#claude-回應-codex-格式查核2026-10-29>)、[規畫](plans/updates.md) |
| 外掛架構逐環節檢視 | 環節 1、4、7、8 已談定（[D-142](decisions.md#d-142-範圍與目錄模組的六項選擇)、[D-148](decisions.md#d-148-電腦專用的主機接點)；環節 4 的施工記進 [backlog 技術債](backlog.md#技術債)） | `state` 讀寫協調的[任務說明](../tasks/state-writes.md)已寫好，等使用者排開工時間；Claude 接著寫環節 5 | 使用者、Claude | [討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>) |
| 學習目標架構第三輪 | 暫選 R3 | 兩三個新單元與段考到齊再跑 | 新教材 | [D-132](decisions.md#d-132-學習目標架構暫選-r3第三輪在新教材比三組) |
| 製卡規則下一輪試用 | 等真實影片筆記 | 看目標數量、共同成功判準、洩漏與放錯池 | 新教材 | [試用紀錄](card-rules/trials.md) |
| 英文一字多義 | 規則已改（D-125） | 有多義字的真實教材時試用 | 新教材 | [D-125](decisions.md#d-125-英文規則依製卡流程重排與一字多義的學習目標) |

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
| 2026-10-29 | 更新防線第 0 步：最低版本標記、版本行、還原檔與備份檔的格式寫進 [syntax.md](syntax.md)（§0-1、§5-1～5-3、§8），Codex 格式查核的 F1～F4 已照改（[查核與回應](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md#claude-回應-codex-格式查核2026-10-29>)）；讀不到自己的紀錄時不擋作答（[D-149](decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 補充） |
| 2026-10-29 | 未來規畫統整的審閱結案（[審閱](<../Claude Codex Discussion/2026-10-23-future-plans-consolidation.md#claude-審閱2026-10-28opus-55-高>)、[任務說明](../tasks/future-plans-review.md)）：122 項補回遺漏 1、原意與來源 4 處；使用者決定 Capture 開工前研究放 v1、真實驗證不算 v1、C-017 列第二階段、C-011 → D-152、C-009 結案 |
| 2026-10-29 | 教材不限課本、補充筆記另外放（[D-152](decisions.md#d-152-教材是針對考試範圍的文件補充筆記另外放)）：針對考試範圍的學校講義、補習班教材算課內，延伸改從「教材以外」算，不一致時學校的優先；舊共識 C-011 結案（[統整審閱](<../Claude Codex Discussion/2026-10-23-future-plans-consolidation.md#請使用者決定>)） |
| 2026-10-28 | 更新與相容定案（[D-149](decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝)、[D-150](decisions.md#d-150-備份與還原)、[D-151](decisions.md#d-151-內建製卡規則改版內建跟著外掛改了就是自訂版)，[討論稿](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md>)）：每台裝置記版本、讀不懂就停、正式 vault 只裝正式版；外掛自己備份（每月一次、隨時手動），紀錄只補不刪；內建規則跟著外掛、改了就是自訂版 |
| 2026-10-28 | W6 iPhone 回饋的畫面修改合併進 `main`（`7d09247`，[D-145](decisions.md#d-145-複習畫面再精簡拿掉分隔線答案不重複一行一個喇叭)，[審查與回應](<../Claude Codex Discussion/2026-10-28-w6-polish-review.md>)）：Codex 兩輪的 F1～F8、R1～R4 都已修；iPhone 待驗語音念完、切 App 回來換卡、細框按鈕與 `md-cases` |
| 2026-10-28 | AGENTS.md 重寫（[D-147](decisions.md#d-147-agentsmd-的寫法底線在上新增規則先過五關)，[任務說明](../tasks/agents-md-rewrite.md)）：底線放最上、加新增規則的五關，約 4,800 字減到 3,100 字；skill 刪掉重複的句子，`essence-discuss` 改成 AI 能自己載入，也不再依賴不存在的 grilling；Capture 的底線也搬到最上 |
| 2026-10-28 | A3 合併進 `main`（實作 `dfb368e`，[設計稿](<../Claude Codex Discussion/2026-10-27-a3-open-decks.md>)）：存檔備援只從 `start()`、`layout-change`、編輯器建立三處追蹤開著的卡組，拿掉每 2 秒掃分頁；Windows 實測 `a3check` 11 項與冷啟動都通過，Codex 三輪 L2 通過 |
| 2026-10-28 | W6 iPhone 測試後的建議定案：複習畫面拿掉分隔線、打字卡不重複顯示答案、一行一個喇叭、試做在空格裡打字（[D-145](decisions.md#d-145-複習畫面再精簡拿掉分隔線答案不重複一行一個喇叭)）；卡組筆記的「全部卡」按鈕與第一次的提醒（[D-146](decisions.md#d-146-卡組筆記的全部卡按鈕與第一次的提醒)） |
| 2026-10-28 | 里程碑報告的 R1～R4、R7、R8（[處理紀錄](<../Claude Codex Discussion/2026-10-27-milestone-1-review.md#處理紀錄2026-10-28>)）：測試不再改全域的 `fs`，CI 沒通過時開 session 就提醒；加 `seen` 與同批順序的性質測試，順便做 T2；skill 與 quality.md 補四條做法 |
| 2026-10-27 | 里程碑報告的 R5（`73b4000`，[實機記錄](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md#實機記錄t3-與-a32026-10-27opus-55>)）：開發命令 `events` 記錄 Obsidian 事件；外部改名是 `create`＋`delete`，A2 不重開；資料夾刪除的契約 C15 通過；加 `unread` 命令 |