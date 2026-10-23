# Essence Cards｜開發現況與路線圖

更新：2026-10-23

## 現在在哪裡

| 項目 | 現況 |
|---|---|
| 階段 | **v1**：v1 開發前要做的事全部完成，2026-10-20 開始寫程式 |
| 產品程式碼 | 程式結構已定（[D-110](decisions.md#d-110-v1-外掛的程式結構)）；W1 骨架＋W2 卡組模組、W3 複習紀錄與 FSRS 重播（含自動檢查，[D-117](decisions.md#d-117-技術債預防機械檢查全自動ai-審查只在關鍵點)）已合併進 main（183 個測試）；下一步把 W4 今天的佇列（[任務說明](../tasks/w4.md)）交給 Codex |
| 已驗證 | Windows 與 iPhone：最小原型（2026-10-07）；複習畫面原型與實機驗證全部過門檻（2026-10-19，[D-109](decisions.md#d-109-複習畫面原型的實測結論)） |
| 下一個里程碑 | 打通「手寫卡組 → iPhone 複習 → 自評 → 排程」（W1～W6，[D-111](decisions.md#d-111-v1-的開發順序capture-延後)）；Capture 延到這之後 |

v1 任務與第二階段候選的[統一入口](backlog.md)已整理；細項存放規則見 [docs/plans/](plans/README.md)。

開工時只讀這一節，其他文件看任務需要再讀（[D-099](decisions.md#d-099-文件精簡)）。要找某個決定，先看[決策紀錄的索引](decisions.md#索引)；最近做完的事見[已完成](#已完成)。

### 下一次對話從這裡開始

1. **v1 第一批**（[D-111](decisions.md#d-111-v1-的開發順序capture-延後)）：W1 骨架、W2 卡組模組（[任務說明](../tasks/w1-w2.md)、[審查與修正](<../Claude Codex Discussion/2026-10-20-technical-debt-review.md>)）與 W3 複習紀錄與 FSRS 重播（[任務說明](../tasks/w3.md)，排程用 FSRS-6，[D-112](decisions.md#d-112-排程用-fsrs-6)）已合併。下一步把 W4 今天的佇列的[任務說明](../tasks/w4.md)（[D-120](decisions.md#d-120-今天的佇列的細節)）交給 Codex；W3 的 iPhone 效能（D-110 要不要加快取）在 W5 接上外掛後用 `npm run bench` 的資料量測。程式結構照 [D-110](decisions.md#d-110-v1-外掛的程式結構)；試作場已停用。之後各模組寫規格時，照 [D-115](decisions.md#d-115-回頭查要用的證據先收好) 把要多存的證據寫進出題語法，打字卡與自動朗讀照 [D-116](decisions.md#d-116-打字卡的沒印象與自動朗讀)。開始任務前，先核對 [backlog 的技術債](backlog.md#技術債)（W1～W2 審查留下的 4 件事已搬過去，[D-119](decisions.md#d-119-程式品質的-skill-整併成通用的-code-quality)）。
2. 製卡規則：學習目標的數量由內容決定（[D-101](decisions.md#d-101-學習目標的數量由內容決定)）2026-10-19 試過，沒有變瑣碎，規則不改（[試用紀錄](card-rules/trials.md)）。之後有真實的影片筆記時再試一次，順便看一般知識的數量（這次約加倍，同一份筆記 20～31 個）。下一輪試用時一併試「共同成功判準」（[backlog](backlog.md#其他待決)）。也一併看 AI 品質初篩留下的兩點：2-2 每份仍約 5 題洩漏（多是二選一與互補配對），以及把相鄰能力的一題放錯池（D-118）。
3. **AI 品質初篩** ✅ 2026-10-20 結案：兩次盲評後照兩個問題改了規則（通用 v0.13、自然 v0.5，[D-118](decisions.md#d-118-ai-品質初篩後的製卡規則修改)），T4 小規模驗證：例題的觀念都有出題、按例子拆開變少，洩漏沒變、偶爾把相鄰能力的一題放錯池（[試用紀錄](card-rules/trials.md)）。這兩點併進第 2 項的下一輪試用再看，不擋 v1。

另外的專題與研究：

- **獨立 App（未來開發計畫）**：✅ 已納入（[D-129](decisions.md#d-129-獨立-app-列入未來開發計畫)），以 Obsidian 版為主要開發與更新入口，共用核心與筆記資料，成本沿用 D-128。下一步見[準備計畫](#未來準備開發獨立-app)；開工時間、平台與同步供應商待定，尚未實作。
- **英文製卡規則**：v0.10 依製卡流程重排並保留反例，一字多義以中文意思區分目標（[D-125](decisions.md#d-125-英文規則依製卡流程重排與一字多義的學習目標)）；發音檢查列[第二階段](plans/ai-and-ecosystem.md#發音檢查與語音模型)（D-124、D-130）。下一步：一字多義等有多義字的真實教材時試用一次；名稱括號的程式修改寫進 W6 的任務說明（[技術債](backlog.md#技術債)）。
- **學習目標優化（Astra）**（[完整對話與整理索引](<../Claude Codex Discussion/2026-10-22-[Astra] learning-objective-optimization.md>)）：2026-10-22 依使用者要求完整收錄 13 則對話。💡 提案是以具體任務與應通過／不應通過的回答，在目標定案前檢驗判準；最後已釐清這是建立與驗收流程的改良，沒有根本改變軟體核心概念。[Claude 回應](<../Claude Codex Discussion/2026-10-22-[Astra] learning-objective-optimization.md#claude-回應2026-10-22>)：同意方向，已經是第二輪設計的 R1；逐個目標檢查可能補不到 2-1「分離屬於物理變化」這類跨知識塊的缺口。[使用者回覆](<../Claude Codex Discussion/2026-10-22-[Astra] learning-objective-optimization.md#使用者回應與-claude-的看法2026-10-22>)：結掉「跳出既有架構重想」（核心仍是 D-114）；品質看整體，不因單一張卡的失誤否定方案；重視五項做法整體；採用 R3（先畫全貌、模擬考題、再倒推目標，依理解障礙排進展），AI 可以劃定全貌的邊界，目標可變多、範圍可適度超出教材，底層不夠時可以加強第 ① 層（符合條件才補，不硬性增加）。Codex 回應六個問題後雙方一致（[結論](<../Claude Codex Discussion/2026-10-22-[Astra] learning-objective-optimization.md#結論claude-與-codex-一致2026-10-22>)）：R3 五步保留，修掉「全貌每塊都要有目標」「整合一律列其他練習」，補上回查原教材與「另立目標、同池變式或詳解」的放置分界；評分先引證據再整體判斷、不單點否決，教材外內容另外查證，價值與成本並列。已整合進第二輪設計（見下一項）。
- **學習目標架構**（[討論稿](<../Claude Codex Discussion/2026-10-21-learning-objective-architecture.md>)）：2026-10-21 使用者要求把「製卡規則的寫法」（[前一份](<../Claude Codex Discussion/2026-10-20-card-rule-writing.md>)，暫停）歸零重想，同意新方向：用真實考題當尺、先用最強的模型找天花板、比較單次與流水線（架構 → 出題 → 另一家審查），詳細規則改給審查者用。結論使用者 2026-10-21 確認（強模型用 xhigh）；單元是 2-2，保留單元 2-1、2-3，尺是第一次段考。考題已凍結、生成完成 2-1 與 2-2；第一輪只評這兩節（使用者決定，2-3 不補）。第一輪盲評完成（[評分說明](../experiments/t4/arch/評分說明.md)），2026-10-22 揭曉，報告見[討論稿〈第一輪結果〉](<../Claude Codex Discussion/2026-10-21-learning-objective-architecture.md#第一輪結果claude-報告2026-10-22>)。兩家的卡組名次不一致，所以卡組這一輪沒有贏家；兩家一致的是：缺口主要出在架構的判準太寬，S4 有核心題倒退，審查步驟幾乎沒改到架構。另外發現 2-2 的轉錄把「給學生」欄標成教師註記。Codex 已回應、Claude 已核對（第 6、8、10 題照 Codex 的解讀更正報告），雙方一致的[第二輪設計](<../Claude Codex Discussion/2026-10-21-learning-objective-architecture.md#第二輪設計claude-與-codex-一致待使用者確認>)：先修轉錄的欄位標記、校準評分，再固定 GPT-6.1 Sol xhigh 比三種提示（短規則、加判斷邊界、詳細規則），加 S1 錨點與 S0 基準，在沒用過的單元驗證；不跑 S4 與審查。使用者 2026-10-22 暫緩確認，先在 Astra 稿談完，之後整合成[第二輪設計（整合版）](<../Claude Codex Discussion/2026-10-21-learning-objective-architecture.md#第二輪設計整合版>)：R0～R3 加 S1、S0 共 6 次請求，R3 放寬範圍，開跑前先核對輸出長度。接法依 [D-126](decisions.md#d-126-訂閱優先的-ai-製卡與側欄修改) 更新為 R0～R3 先驗 G2／G3 再統一用方案額度，退回 API 就全部退回；S0 維持 API。使用者 2026-10-23 決定 S1 暫緩，整合版與驗證單元改在 Codex 那邊和使用者討論（[交接](<../Claude Codex Discussion/2026-10-21-learning-objective-architecture.md#交接給-codex和使用者討論第二輪設計與驗證單元2026-10-23>)），有結論後交 Claude 審查；接法驗證不擋 W4～W6，尚未補跑。
  - 最新：第二輪設定定案為 [D-127](decisions.md#d-127-學習目標架構第二輪sol-high第-1-章先跑-1-3)：R0～R3 用 Sol high、第 1 章先在 1-3 跑五組，R2／S0 被密度例子墊高的判讀照此，轉錄由 Codex 看原頁做。Codex 已完成 1-3 轉錄與 2-1、2-2 複本欄位修正（[任務說明](../tasks/objective-architecture-r2-transcription.md)），產物與驗收紀錄在 repo 外的實驗資料夾「第二輪/材料/」，第一輪未動。2026-10-23 Claude 對照原頁核對後凍結（同資料夾的 `凍結.md`，含雜湊與歸屬判斷）。2026-10-23 Claude 寫好第二輪的生成提示，commit 凍結內容（[arch/第二輪/](../experiments/t4/arch/第二輪/README.md)）：格式範例換成國一酵素、R1 判斷邊界、R3 五步，另補 R2 詳細規則和實驗格式的銜接。使用者決定先補標、接法驗證之後再做：2026-10-23 兩家各自標完 1-3 的 7 題（[標註說明](../experiments/t4/arch/第二輪/考題標註.md)），答案全部一致，七題都算核心題（24、25 同組，共 6 組情境），Claude 比對後凍結（實驗資料夾的 `第二輪/考題/凍結.md`）。第二輪的[評分說明](../experiments/t4/arch/第二輪/評分說明.md)已照 [Codex 的檢查](<../Claude Codex Discussion/2026-10-21-learning-objective-architecture.md#claude-回應-codex-的評分說明檢查2026-10-23>)改好，兩家改用共用的評分要點（實驗資料夾的 `第二輪/考題/要點.md`）。接法驗證、R3 長度預試與盲評包的[任務說明](../tasks/objective-architecture-r2-connection.md)已寫好（第二輪[設定](../experiments/t4/arch/第二輪/設定.json)由 Claude 定），分三段交給 Codex：查核官方文件與寫程式 → 在 2-1、2-2 驗 G2／G3 並預試 R3 → 接法凍結後正式生成與做盲評包；每段停下來回報。2026-10-23 前兩段完成（分支 `codex/arch-r2`，未合併）：Claude 核對官方文件與程式後，Codex 在 2-1、2-2 各跑一次 R3，兩份都正常結束、沒有截斷，回覆確認 `reasoning.effort: high`、圖片全數送達；額度剩餘量提供者不回傳，記為未確認。Claude 已凍結接法（方案額度、Sol high，R3 維持一次請求不拆）。第 3 段依 [D-131](decisions.md#d-131-claude-實作codex-在關鍵點查核) 改由 Claude 執行：1-3 的五份都完整結束（S0 花 $0.08），盲評包 5 份卡組、4 份架構，Claude 另寫腳本自檢通過。下一步：Codex 照[查核說明](../tasks/objective-architecture-r2-review.md)查核，之後兩家各開新對話盲評；分支尚未合併。
- **Claudian 評估與用訂閱製卡**：✅ 2026-10-22 使用者確認最終整合版，已結案為 [D-126](decisions.md#d-126-訂閱優先的-ai-製卡與側欄修改)。訂閱優先，API／手動備援保留；固定生成按按鈕、個別修改用筆記與側欄，證據範圍與拆分／合併的進度規則已定。G1～G4、Claude 背景接法、Claudian skill 與差異接受流程仍[待驗證](backlog.md#訂閱製卡接法驗證d-126)，在 AI 製卡模組開工時處理，不擋 W4～W6；尚未實作。使用者 2026-10-23 另要求將「透過 Claudian 跑完整學習鏈，並與固定呼叫方式比較品質」列入同節待辦，細節與時程待規劃，尚未納入第二輪。
- **AI 規劃**（[紀錄](archive/discussions/2026-10-11-ai-planning.md)），待決題目見 [backlog](backlog.md#ai-規劃2026-10-11-起的專題討論)。
- **API 挑選**（[紀錄](archive/discussions/2026-10-11-api-selection.md)）：T4 已選定轉錄用 GPT-6 Sol、製卡用 GPT-5.6 Terra（D-085）。使用者之後再測：錯題照片（照 [D-113](decisions.md#d-113-錯題整頁拍題號選填) 整頁拍，等使用者提供 2～3 張字跡潦草的真實考卷）、Mistral 的其他模型；語音模型與模型自動更新見[第二階段規畫](plans/ai-and-ecosystem.md#發音檢查與語音模型)。
- **English Kitten Academy 研究**（[報告](research/english-kitten-academy.md)、[討論稿](<../Claude Codex Discussion/2026-10-20-english-kitten-academy.md>)）：2026-10-21 結案。拼句練習、文法選擇題、造句題的可接受答案列[第二階段](plans/practice.md)。使用者要 v1 做「片語放進句子裡打字」：答錯時的三步流程已定（[D-121](decisions.md#d-121-打字卡答錯時的三步流程)，W6 照做）；寫法、依字數畫線、好幾個正確答案用 ` | ` 分開已定（[D-122](decisions.md#d-122-片語放進句子裡打字)，英文規則 v0.8）；解析器拆開 ` | ` 寫進 W6 的任務說明（[技術債](backlog.md#技術債)）。

## 路線圖

只分 **v1 需要做的任務** 與 **第二階段想做的事**（[D-130](decisions.md#d-130-任務分成-v1-與第二階段)）。目前規格照 D-039、D-111 開發；第二階段不再細分「增強版」「v2 之後」等階段，也未排定功能先後。

```mermaid
flowchart LR
  A["v1 要做<br/>最小複習閉環、AI 製卡、PDF／圖片轉錄"]:::now --> B["v1 驗收與真實使用驗證<br/>一位學生 × 一次考試"]
  B -.->|依結果與使用者選擇排優先順序| C["第二階段想做<br/>統一清單，細項以連結引用"]
  classDef now fill:#ffd54f,stroke:#f57f17,color:#000
```

| 工作 | 範圍與入口 | 完成或開工條件 |
|---|---|---|
| v1 需要做的任務 | [產品定義 §5](product.md#5-範圍-第-7-步)、[任務入口](backlog.md#v1-需要做的任務)。W4～W6 後接 AI 製卡與 Capture，照 D-111；目前進度見上方「現在在哪裡」 | 能在 iPhone 完成段考範圍的每日複習；交付完整 HTML 使用說明書（D-048），說明學習目標 ID 與題目指紋；依[成功標準](product.md#2-成功標準-第-1-步)和 D-075 做一位學生、一次考試的真實驗證。v1 完工前 Claude 仍先問使用者：[產品路線](plans/learning-growth.md)要不要納入部分內容 |
| 第二階段想做的事 | [唯一清單](backlog.md#第二階段想做的事)，細項放 [docs/plans/](plans/README.md)，包括動機、題庫、內容深化、體驗、生態及獨立 App | 依驗證結果及使用者選擇排定要做的項目，再完成各自規格與驗收；列入不代表全部已採用或同版交付 |

## 未來準備開發：獨立 App

已列入第二階段清單（D-129），尚未實作；[開工準備與未決選擇](plans/standalone-app.md)集中在同一主題文件，架構邊界見[架構文件](architecture.md#未來獨立-app規劃中)。

## v1 開發前要做的事

| 事項 | 內容 |
|---|---|
| 出題語法定稿 | ✅ 2026-10-16（[D-092](decisions.md#d-092-出題語法定稿正式規範)）：正式規範見[出題語法與資料格式](syntax.md)，製卡規則的輸出格式已同步；整合時補上的三個提案同一天確認 |
| 成功標準的量測方式 | ✅ 2026-10-12（[D-075](decisions.md#d-075-成功標準的量測方式)）：v1 只做積欠提醒與考前抽測，其他在第 2 階段由 AI 讀紀錄計算 |
| 複習與檢核細節 | ✅ 2026-10-13：自評段數、佇列組成、中斷與恢復等十三題都已定案（[backlog](backlog.md#複習與檢核細節v1-範圍確定後展開)） |
| 實機驗證（舊 T-008） | ✅ 2026-10-19（[試作場](../experiments/README.md) T3）：離線連續複習 15 分鐘、離線重開、恢復連線後同步都通過，三年份紀錄 iPhone 讀 0.24 秒；兩端離線改同一篇筆記會遺失一邊、裝置代碼要存本機，記入 [backlog](backlog.md#其他待決)。單一檔案救回在電腦用 Git 做，寫 v1 時處理 |
| 複習畫面樣式與入口畫面 | ✅ 2026-10-17（[試作場](../experiments/README.md) T1、T5）：複習畫面用安靜樣式、自評按鈕不顯示間隔（[D-070](decisions.md#d-070-複習畫面採用安靜樣式)）；入口一科一列（[D-095](decisions.md#d-095-入口畫面)）；顯示答案用文字按鈕、空格是底線、詳解和答案分開（[D-096](decisions.md#d-096-顯示答案與複習畫面的細節)）；目錄依學期分組、單元數字是卡片總數並用顏色表示狀態、點開有當日卡與全部卡（[D-097](decisions.md#d-097-目錄畫面)）；考試範圍只用在大考、改成考試期間（[D-098](decisions.md#d-098-考試範圍只用在大考日期改成考試期間)）。樣式稿：[入口與顯示答案](../experiments/mockups/entry-and-reveal.html)。英文自評按鈕 2026-10-17 確認（D-096）。設定頁 ✅ 2026-10-19：複習、學期、給家長三區，每日時間上限預設 30 分鐘（[D-104](decisions.md#d-104-設定頁)，依試作場 T8 的模擬），樣式照 Obsidian 內建；總覽 ✅ 2026-10-19 改成入口在電腦版、有建議時才出現的「給家長」一區（[D-103](decisions.md#d-103-總覽改成入口的給家長一區)）。「給家長」一區已補進樣式稿第 16 版；考前抽測 ✅ 2026-10-19 放在入口科目列的第一列，考前 3 天出現（[D-107](decisions.md#d-107-考前抽測放在入口科目列的第一列)）。考試範圍檔的寫法已跟著 D-098 改好（[出題語法 §4](syntax.md#4-考試範圍)） |
| 複習畫面原型 | 在[試作場](../experiments/README.md)做（T2，[D-065](decisions.md#d-065-試作場)），照 T5 選定的複習畫面（D-096）；✅ 2026-10-19 [試作外掛](../experiments/plugin/README.md)在 Windows 與 iPhone 測完：維持 React，全螢幕蓋住 Obsidian 並攔截觸控，往左滑一次一張（[D-109](decisions.md#d-109-複習畫面原型的實測結論)） |
| 開始寫程式時：建立 Capture repo | ✅ 2026-10-20 照 [D-076](decisions.md#d-076-capture-是知識入口教材轉錄成教材庫) 的補充（2026-10-14）建好骨架：[Essence-Capture](https://github.com/kuohappiness/Essence-Capture) 與本 repo 並排、AGENTS.md 指向本 repo、通用的 Claude 記憶已複製、進度只寫在本 repo。Capture 的程式延到 Cards 的複習閉環完成後（[D-111](decisions.md#d-111-v1-的開發順序capture-延後)）；Capture 完成前 AGENTS.md 要改成獨立的一份（[backlog](backlog.md#其他待決)） |
| API 模型實測 | ✅ 2026-10-14（[試作場](../experiments/README.md) T4）：轉錄用 GPT-6 Sol、製卡用 GPT-5.6 Terra（[D-085](decisions.md#d-085-首選-openai-gpt-56-terra)）。使用者之後再測：錯題照片、Mistral 的其他模型（見上面「API 挑選」） |

## 已完成

只留最近 10 條；加新的一條時，把最舊的搬到[已完成（封存）](archive/roadmap-completed.md)的最上面（[D-099](decisions.md#d-099-文件精簡)）。

| 日期 | 工作 |
|---|---|
| 2026-10-23 | 學習目標架構第二輪正式生成與盲評包（Claude 執行，D-131）：1-3 的 R0～R3（方案額度、Sol high）與 S0（API，$0.08）都完整結束，目標名稱在架構與卡組間全部對得上；盲評包 5 份卡組、4 份架構，獨立腳本確認沒有來源字樣、圖片位元相同、卡數等於 parseDeck 統計。修好從 Git Bash 執行時找錯 `whoami` 的問題（`codex/arch-r2` 的 `fd8b62c`）。寫好給 Codex 的[查核說明](../tasks/objective-architecture-r2-review.md)；未查核、未盲評、未合併 |
| 2026-10-23 | 協作分工改為 Claude 實作、Codex 在關鍵點查核（[D-131](decisions.md#d-131-claude-實作codex-在關鍵點查核)）：更新 `AGENTS.md`〈AI 協作分工〉、`docs/agents/quality.md` 的角色與 codex-brief 的使用時機；D-016、D-106、D-119 加註 |
| 2026-10-23 | 學習目標架構第二輪凍結接法：Codex 完成任務說明的第 1、2 段（官方方案接法、R3 在 2-1／2-2 預試），Claude 逐頁核對官方文件、重跑自測、抽查回覆紀錄。兩份都完整結束（輸出約 1.7～2.1 萬 tokens，含推理），`high` 有回傳可核對、圖片 22／22 與 10／10 送達，R3 不拆；額度剩餘量未確認。未跑正式生成、未合併分支 |
| 2026-10-23 | 修正 pre-commit 換行誤報：[.gitattributes](../.gitattributes) 固定 hook 為 LF，保留原腳本與 preprepare。隔離重現由誤報轉為乾淨，checkout／npm install 後仍維持 LF，Git Bash 語法與缺依賴阻擋通過；完整 `npm run check` 重跑通過（首輪只有既有效能測試 2883 ms 超過 2000 ms，單獨重跑 1648 ms 通過，未改程式或門檻）。code-quality 已在 bug 情境讀取，第一個里程碑的觸發驗證保留在 backlog |
| 2026-10-23 | 寫好學習目標架構第二輪的[接法驗證與盲評包任務說明](../tasks/objective-architecture-r2-connection.md)與[第二輪設定](../experiments/t4/arch/第二輪/設定.json)：只用官方的方案額度接法，不通就停下來回報；R3 在 2-1、2-2 預試，截斷最多重試一次；盲評包用隨機代碼、改圖檔名，照 parseDeck 分出正面與背面。尚未交給 Codex |
| 2026-10-23 | 照 Codex 的檢查修改第二輪評分說明：兩家改用共用的評分要點（① 14、② 5、輸入 2，層次分歧照標註說明決定並記在凍結檔的〈修訂〉）、刪掉單張失誤不改名次、教材外內容看內容不只看標籤並記查證紀錄、加判例與「最拿不準的判斷」、24/25 題用 6 組情境總結。盲評包的規格留到之後的任務說明；尚未實際校準 |
| 2026-10-23 | 依 [D-130](decisions.md#d-130-任務分成-v1-與第二階段) 整理 v1 任務與第二階段清單，細項移到 [docs/plans/](plans/README.md)；記錄「學習目標熟練度作為升級標準」的使用者提議，尚未定案；[Claude 交接](<../Claude Codex Discussion/2026-10-23-future-plans-consolidation.md>) |
| 2026-10-23 | 寫好學習目標架構第二輪的[評分說明](../experiments/t4/arch/第二輪/評分說明.md)：1-3 的 5 份卡組、4 份架構；加入共同口徑（正背面、合證、詳解不算支持、一個缺口影響多題）、教材外內容逐項查證、整體判斷分「能否直接採用」與「值不值得繼續比較」、價值與負擔並列、缺口多一欄跨知識塊。待 Codex 檢查，尚未凍結 |
| 2026-10-23 | 凍結第二輪 1-3 的考題標註：Codex 獨立標完，兩家七題的自解答案全部一致；第 16 題（冰熔化質量不變教材沒有）定為核心、該項不算缺口；記下第 15 題轉錄的錯字會改變答案（照照片）、第 32 題的漂浮數據不一致但不影響答案。凍結檔與雜湊在 repo 外；未跑生成 |
| 2026-10-23 | 將獨立 App 納入未來開發計畫（[D-129](decisions.md#d-129-獨立-app-列入未來開發計畫)）：Obsidian 版為主要開發入口，共用核心與筆記資料；列出開工準備與相容／同步驗證，時程及技術選型待定，尚未實作 |
