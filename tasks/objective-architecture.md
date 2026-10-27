# 學習目標架構實驗（給 Codex）

狀態：已完成（第一輪；結果見[討論稿〈第一輪結果〉](<../Claude Codex Discussion/2026-10-21-learning-objective-architecture.md#第一輪結果claude-報告2026-10-22>)）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（要查核兩家 API 的參數、接一條三步的流水線，最後還要獨立標註考題，需要判斷）。

這個實驗回答：要讓 AI 做出最好的學習目標架構，該用哪種模型與流程。用真實段考題當尺，比較現行做法（Terra＋詳細規則）、兩個強模型（xhigh）配短規則、一條流水線（架構 → 出題 → 另一家審查）、Terra 配短規則。設計是 Claude 與 Codex 談定、使用者 2026-10-21 確認的〈結論〉，見[討論稿](<../Claude Codex Discussion/2026-10-21-learning-objective-architecture.md>)。這是實驗，不改產品，不擋 v1。

分工：Codex 寫程式、轉錄、生成、做盲評包，並**獨立**標一次考題；Claude 寫提示（`experiments/t4/arch/`）、核對轉錄、標另一次考題、凍結標註、寫評分說明與報告。

## 開工條件與基準

- 基準是這份說明所在的 commit：開工前用 `git log -1 --format=%h -- tasks/objective-architecture.md` 找到它，再用 `git diff <那個 commit> -- experiments/t4/arch/ experiments/t4/screen/ docs/card-rules/` 看有沒有改過；有改，以新版為準，並在回報註明。
- 在本機用 `git worktree add ../Essence-Cards-arch -b codex/objective-architecture main` 開在旁邊的資料夾，在分支 `codex/objective-architecture` 上 commit；在新資料夾的 `experiments/t4/` 執行 `npm install`。**不要在原資料夾切換分支**：其他 AI 可能正在 main 上改文件。
- 個人路徑（課本 PDF、考卷照片的資料夾、結果資料夾 `--out`）寫在交給你的訊息，不寫進 repo。`--out` 在測試 vault 裡。

## 必讀範圍

| 讀什麼 | 為什麼 |
|---|---|
| 這份說明 | 規格 |
| [討論稿](<../Claude Codex Discussion/2026-10-21-learning-objective-architecture.md>)的〈結論〉一節 | 設計與界線；其他節不用讀 |
| `experiments/t4/arch/` 全部 | 這次的固定條件與提示，由 Claude 維護 |
| `experiments/t4/README.md` 開頭到〈AI 品質初篩〉結束 | 安裝、金鑰、`--out` 的限制、初篩程式的用法 |
| `experiments/t4/t4.mjs` 的 `transcribe()`、`verify()`；`to-formal.mjs` | 課本轉錄沿用這套流程 |
| `experiments/t4/screen.mjs`、`screen-analysis.mjs` | 組提示、存檔、避免重複付費、盲評包；能重用就重用 |
| `experiments/t4/api.mjs`、`core.mjs` | `ApiClient`、金鑰、`validateOut`、`imagePart` |
| `experiments/t4/check-syntax.mjs` 的開頭註解與 `check()` | 卡組的格式檢查 |
| `docs/backlog.md`〈技術債〉的 F3、F5 兩列 | 觸發點是「下一次跑 T4 前」，這次一起做 |
| `src/core/deck/parse.ts` 的 `parseDeck` | F5 的對照 |
| `.agents/skills/code-quality/SKILL.md` 的〈測試〉 | 測試寫法 |

## 限制

- 只新增或修改：`experiments/t4/arch.mjs`（要拆檔就用 `experiments/t4/arch-*.mjs`）、`experiments/t4/api.mjs`（請求參數與紀錄）、`experiments/t4/core.mjs`（只做 F3）、`experiments/t4/check-syntax.mjs`（只做 F5）、`experiments/t4/README.md`（加一小節用法），以及 `experiments/t4/arch/設定.json` 裡各模型的 `parameters`（查核官方文件後才改，回報寫出依據）。其他檔案只讀不改，包括 `arch/` 的其他檔案、`screen/`、`prompts/`、`models.json`、`docs/` 與這份說明；有疑問寫在回報裡。
- 改了 `api.mjs`、`core.mjs`、`check-syntax.mjs` 之後，`t4.mjs`、`screen.mjs` 的既有行為與自測不能壞。
- Node 24、ES modules，不加新套件。
- 金鑰照 T4：讀 `%USERPROFILE%\.essence-api-keys.env`，同名環境變數優先；不能出現在程式碼、畫面、紀錄檔或任何結果檔。存檔不存 HTTP 標頭與圖片的 base64。
- 課本、考卷照片、轉錄稿、標註、生成結果都只寫進 `--out`，不進 repo；學校名稱、學生姓名也不寫進 repo。
- **花費上限**：每一個付費階段開始前，依官方定價估算這一階段與整個實驗的花費，寫進回報；整個實驗（轉錄＋生成，含重試）的實際花費到 **20 美元**就停下來回報，不繼續送。每一次付費請求前檢查剩餘額度。
- **生成前要凍結**：`--out` 裡沒有 `考題/凍結.md`（Claude 凍結標註後才會建立），`run` 就拒絕執行。

## 要做什麼

### 1. 程式

**F3、F5**（照技術債的完成條件）：

- F3：`validateOut` 用 `git worktree list --porcelain` 比對所有 worktree 的真實路徑，`--out` 落在任何一個 worktree 裡都要拒絕；附測試。
- F5：`check-syntax.mjs` 的分類順序和 W2 一致，拿掉每頁 6 個目標的上限；附測試。這次生成的每一份卡組，用 W2 的 `parseDeck` 對照學習目標數與題數，不一致的列進回報（Node 24 能直接載入 `.ts` 就直接用；不行就說明你怎麼對照）。

**請求參數**（`api.mjs`）：

- 設定裡每個模型的 `parameters` 合併進請求本文送出。OpenAI 的 `gpt-6.1-sol` 走 Chat Completions 的 `reasoning_effort`；OpenRouter 的 `anthropic/claude-opus-5.5` 用統一欄位 `reasoning.effort`。送出前照官方文件核對欄位名稱、可用的值與輸出 token 上限；輸出上限要留足推理與文字的空間，寫進 `parameters` 並在回報說明。核對不了的寫「未確認」，不要默認已生效。
- 參數要算進「已完成的輸出沿用」的判斷：改了推理強度或 token 上限，就是新的請求。
- 每一次請求保存：實際送出的參數、回覆的模型版本、供應商與路由（OpenRouter 有回就存）、token 用量（有推理 token 就分開存）、停止原因、秒數、估算費用。
- 被截斷、空回應、少了段落標記的，記成**未完成**，不算品質差；費用照記。

**`arch.mjs` 的指令**（`--out` 照 T4 的 `validateOut`）：

| 指令 | 做什麼 |
|---|---|
| `transcribe --out <資料夾> --pdf <課本 PDF>` | 照 `設定.json` 的 `materials`，每一節用 `transcribe` 的模型（GPT-6 Sol）沿用 T4 的課本轉錄流程與 `prompts/transcribe.md`，再照 T4 的 `verify` 用 Terra 檢查一次，最後用 `to-formal.mjs` 轉成正式格式。存成 `材料/<節>/教材.md`、`材料/<節>/圖/`、`材料/<節>/檢查.md` |
| `exams --out <資料夾> --photos <照片資料夾>` | 照片照檔名排序，複製到 `考題/照片/`；用 `transcribe` 的模型與 `arch/考題轉錄.md` 一次轉錄全部照片，存成 `考題/考題轉錄.md` |
| `run --out <資料夾> [--run <N>]` | 沒有 `考題/凍結.md` 就拒絕。三節 × 五種設定（`configs`）照步驟送出，預設第 1 次 |
| `blind --out <資料夾>` | 做盲評包 |
| `selftest` | 離線自測 |

**`run` 的細節**：

- 每一步的 system 照 `configs` 列的檔案順序串起來，`{{任務資料}}` 換成那一節的任務資料；路徑相對於 `arch/`。user 是教材全文與附圖（照初篩的 `buildUser`），步驟有 `input` 時，在教材後面接上前面步驟交出的段落，標明「前一步的架構：」「前一步的卡組：」。
- 回覆照段落標記（單獨一行的 `<<<架構>>>`、`<<<卡組>>>`、`<<<修改紀錄>>>`）拆開。S0 沒有標記，整份回覆就是卡組。
- 存在 `生成/<節>/<設定>/`：S0 存 `卡組.md`；S1、S2、S4 存 `架構.md`、`卡組.md`；S3 存四份產物與修改紀錄：`原架構.md`（第 1 步）、`原稿.md`（第 2 步）、`修訂架構.md`、`修訂稿.md`、`修改紀錄.md`（第 3 步）。每一步的送出與回覆另存，格式照初篩。
- 機械統計（不是評分）：每份卡組跑 `check-syntax.mjs` 與 `parseDeck`；架構裡第 ① 層的目標名稱和卡組的學習目標名稱逐字比對，列出兩邊不一致的名稱。

**`blind` 的細節**：

- `盲評/卡組/`：每一節 6 份（S0、S1、S2、S3 原稿、S3 修訂稿、S4），三節共 18 份。拿掉 S0 才有的類型、重要性與候選卡片；保留給家長的備註、粗體、填空的 `==`、圖與圖的位置（題目那一行或底下），讓評分者看得到學生實際看到的樣子。不附修改紀錄。
- `盲評/架構/`：每一節 5 份（S1、S2、S3 原架構、S3 修訂架構、S4），三節共 15 份。
- 卡組與架構用兩套各自打亂的代號；同一節的 S3 原稿與修訂稿在清單上不相鄰。代號對照存在 `紀錄/盲評對照.json`，不放進 `盲評/`。`盲評/` 裡找不到設定代號、模型名稱與提示檔名；檔案修改時間設成同一個。
- 每個資料夾附一份 `README.md`，只列評分順序（照節分組）；評分方式由 Claude 另外寫，不用你寫。

### 2. 轉錄（付費）

先估花費、寫進回報，再執行 `transcribe` 與 `exams`。完成後 commit 程式（只 stage 自己的檔案），在回報列出：三節的頁數與圖數、`檢查.md` 的重點、考卷轉錄裡寫「看不清楚」的地方。

### 3. 標註考題（Codex 自己做，不是程式）

照 `arch/考題標註.md` 逐題標註 `考題/考題轉錄.md`，對照 `考題/照片/`，存成 `考題/標註-Codex.md`。**不要讀** `考題/標註-Claude.md` 或任何生成結果；標完就停，在回報附上「範圍檢查」那一段。

### 4. 生成與盲評包（使用者轉達「已凍結」後才做）

估花費、寫進回報，再執行 `run` 與 `blind`。完成後回報：每一份是否完成（未完成的原因）、實際花費與時間、機械統計的摘要、`parseDeck` 對照的結果。

## 自我測試

`node arch.mjs selftest` 不連網，用暫存資料夾與假的 `fetch`，至少檢查：

1. 組提示：每種設定每一步的 system 照列的檔案順序組成；`{{任務資料}}` 都換掉了；S3 第 2、3 步的 user 帶著前一步的段落。
2. 參數：`parameters` 出現在送出的請求本文；改了推理強度會送新的請求，不沿用舊輸出；相同條件重跑不送請求、不覆蓋。
3. 段落：三種標記都拆得對；少了標記算未完成；S0 整份算卡組；S3 的四份產物與修改紀錄都在。
4. 凍結：沒有 `考題/凍結.md` 時 `run` 停下來，不送任何請求。
5. 花費：估算超過上限或剩餘額度不夠時停下來，不送請求。
6. 盲評包：份數對（18、15）；`盲評/` 裡找不到設定代號、模型名稱、提示檔名；S0 的類型、重要性與候選被拿掉，粗體、`==`、圖的位置保留；S3 原稿與修訂稿不相鄰；對照表不在 `盲評/`。
7. 用一把假金鑰跑完，掃過所有寫出的檔案都找不到它。
8. F3、F5 的測試。

另外 `node screen.mjs selftest`、`node t4.mjs selftest` 與 `node check-syntax.mjs --selftest` 仍要通過；commit 時 pre-commit hook 的 `npm run check` 要通過，不用 `--no-verify`。

## 完成後回報

每次停下來時回報：分支、最後一個 commit、自測輸出；逐條對照「限制」的自我檢查（符合／不符合與原因）；查核過的 API 文件與參數依據；花費估算與實際花費；哪些沒跑與原因。不貼整份執行紀錄。

## 之後（Claude 做）

核對三節轉錄稿；在新的對話獨立標註考題；比對兩份標註、寫出爭議，建立 `考題/凍結.md`；寫評分說明；開新的對話做 Claude 的盲評；彙整報告給使用者。
