# T4 API 模型實測

待回答：轉錄稿是否足以製作有出處的複習卡，附上原頁時結果有何差異？學習效果仍待驗證。任務規格見 [TASK.md](TASK.md)。

需要 Node 24；在本目錄執行 `npm install`（Windows PowerShell 可用 `npm.cmd install`）。僅使用 `pdfjs-dist` 與提供 Windows 預編譯套件的 `@napi-rs/canvas`，不需建置或 C++ 工具。

先執行 `node t4.mjs selftest`，再執行：

```powershell
node t4.mjs find --pdf <PDF路徑> --text <小節名稱>
node t4.mjs all --pdf <PDF路徑> --pages <起-迄> --out <repo外結果資料夾>
```

頁序從 1 起算；先用 `find` 找出小節，再挑 2～4 頁。其他指令及參數見 `node t4.mjs --help`。金鑰讀 `%USERPROFILE%\.essence-api-keys.env` 的 `名稱=值`，同名環境變數優先；程式不輸出或保存金鑰。

結果包含 `頁面/文字層.json`、頁面 PNG、各模型的轉錄稿／裁圖／檢查、`卡片/`、`紀錄.json` 及 `報告.md`。模型名稱中的 `/`、`:` 轉為 `-`，避免 Windows 檔名與 Obsidian 圖片衝突。

因額度失敗時，等額度恢復後重跑 `transcribe`、`verify` 或 `cards --out <結果資料夾>`，最後跑 `report --out <結果資料夾>`。既有成功檔案及相同輸入會沿用，不再付費請求；輸入或提示變更請使用新資料夾。缺少前置轉錄稿的步驟會提示並跳過；未全部完成時程序結束碼為 2。`cards --transcript` 可指定絕對路徑，或相對 `--out` 的路徑；引用圖片須放在該轉錄稿旁的 `圖/`。

`report` 與 `selftest` 完全離線。報告是機械統計：格式檢查依通用輸出範本列行號，出處比例以目標為單位（同目標的題目共用出處），簡體字只比對常見字形清單。費用依設定標價估算，不能當成實際帳單。

照正式出題語法試製卡（第四輪起，Claude 寫的）：

```powershell
node to-formal.mjs <轉錄稿.md> <repo外資料夾> "國二上自然 2-2" "國二上自然 2-2 水溶液"
node t4.mjs cards --out <結果資料夾> --transcript <正式格式的轉錄稿> --model gpt-5.6-terra --variant 只用轉錄稿 [--runs 3] [--prompt <其他提示檔>]
node check-syntax.mjs <卡片.md>… --transcript <轉錄稿.md> --unit 2-2 [--tree]
```

- `to-formal.mjs`：把這裡轉錄出來的暫定格式（`模型-p13-3.png`、`^fig-p13-3`）機械轉成 [syntax.md §1](../../docs/syntax.md#1-轉錄稿) 的圖檔名與錨點，內容不變。`report` 的格式檢查是第二輪的舊規則，新格式改用 `check-syntax.mjs`。
- `check-syntax.mjs`：照 syntax.md 解析 AI 交回的草稿，分「錯誤」（程式會跳過那個學習目標或連結壞掉）、「不符」（違反語法或製卡規則）、「提醒」（啟發式，要人看）列出行號；`--tree` 印出程式看到的正面與背面。`--selftest` 用自己編的範例檢查它本身。
- 一般知識（2026-10-18 起）：`cards` 加 `--rules ../../docs/card-rules/general.md` 換掉 science.md，用 `--source <來源筆記.md>` 代替 `--transcript`，可以重複給好幾份，每份會標出筆記名稱，不需要 PDF 頁面；檢查時加 `--subject 一般知識`。筆記沒有頁面，記得加 `--variant 只用轉錄稿`，不然兩種 variant 會用一樣的輸入各跑一次。

## AI 品質初篩

固定條件與評分方式見 [任務說明](../../tasks/ai-quality-screen.md)。比較同一個模型在兩組提示下的草稿，結果只放 repo 外；這不是學業成效驗證。先執行三個離線自測：

```powershell
node screen.mjs selftest
node t4.mjs selftest
node check-syntax.mjs --selftest
node screen.mjs run --out <結果資料夾> --material 自然2-2=<轉錄稿路徑>
node screen.mjs blind --out <結果資料夾>
```

`run` 預設第 1 次，依設定送出兩段材料各兩組；材料及附圖第一次複製到結果資料夾，後續都讀複本。已完成的輸出沿用，缺少金鑰或請求失敗時結束碼為 2，重跑相同指令可補上；教材、圖片或提示不同時改用新的 `--out`。送出前 `screen/` 與 `docs/card-rules/` 必須沒有未提交的修改。輸出保留提示與雜湊、API 回覆版本及機械統計，不存 HTTP 標頭或圖片 base64。

`能力清單/` 必須在生成前準備，只讀不改。`blind` 隨機分配代號，保留已填的評分表；評分者只讀結果資料夾的 `能力清單/`、`材料/` 與 `盲評/`，不可先看 `生成/`、`紀錄.json` 或報告。評分完成後才執行 `node screen.mjs report --out <結果資料夾>`。沒有額外指示就只做第 1 次，不執行報告；需要後續輪次時用 `--run <N>`。

## 學習目標架構實驗

規格見 [任務說明](../../tasks/objective-architecture.md)。Node 24 可直接載入 W2 的 `parseDeck`；不增加套件。先安裝本目錄與 repo 根目錄既有依賴。

```powershell
node arch.mjs selftest
node arch.mjs transcribe --out <repo外結果資料夾> --pdf <課本PDF>
node arch.mjs exams --out <repo外結果資料夾> --photos <考卷照片資料夾>
node arch.mjs run --out <repo外結果資料夾> [--run 2]
node arch.mjs blind --out <repo外結果資料夾> [--materials 2-1,2-2] [--run 2]
```

前三步完成後先獨立標註，使用者轉達「已凍結」後才執行 `run`；沒有 `考題/凍結.md` 時程式也會拒絕。生成與修訂不讀考題。第 1 次的產物在 `生成/<節>/<設定>/`，後續次數在底下的 `第N次/`。S3 的原架構、原稿、修訂架構、修訂稿與修改紀錄均保留。

每個請求以模型、參數、提示及文字／圖片指紋保存到 `請求/`；相同條件沿用，不重付費。改參數會產生新指紋，歷史原始回覆不覆蓋。曾中斷、截斷或缺段落的請求標為未完成，需先查核紀錄，不自動重送。`紀錄/預算.json` 在每次請求及重試前保留保守費用上界，回覆後按 token 與官方標價估算，OpenRouter 有回 `usage.cost` 時優先使用；未知花費仍保留上界。總上限 20 美元，資料分享抵免與實際帳單由帳戶決定。定價查核日 2026-10-21，來源見 [OpenAI 模型](https://developers.openai.com/api/docs/models)、[OpenRouter Opus](https://openrouter.ai/anthropic/claude-opus-5.5)。

所有 worktree 都禁止用作 `--out`。操作期間以 `.arch.lock` 防止同時寫入；若中斷留鎖，先確認沒有仍在執行的指令，再移除該鎖。`blind` 做卡組與架構各自編碼的盲評包，不附修改紀錄；對照只在 `紀錄/`。未指定 `--materials` 時仍包全部節；例如 `--materials 2-1,2-2` 只讀這兩節，產生 12 份卡組、10 份架構，其他盲評規則相同。節名不得空白、重複或不在設定裡；已有盲評包時，拒絕換範圍覆蓋。此選項只適用於 `blind`，不改生成範圍，也不送 API 請求。本實驗使用 Node 原生 HTTP／HTTPS 等待長推理，總逾時 20 分鐘，不受內建 fetch 的 300 秒標頭逾時影響；不自動跟隨轉址或重送，既有 T4／screen 的傳輸維持原設定。

### 第二輪（實驗程式；真實接法尚未驗證）

照 [第二輪任務說明](../../tasks/objective-architecture-r2-connection.md) 分三段執行，每段停下回報。設定與提示讀取 `arch/第二輪/設定.json`；不改第一輪輸出。先用下列 dry-run 核對材料、圖片、提示雜湊及 S0 的費用上界，不讀憑證、不發請求：

```powershell
node arch.mjs run --round 2 --out <第二輪資料夾> --plan 接法驗證 --dry-run
node arch.mjs run --round 2 --out <第二輪資料夾> --dry-run
# 本人同意開始第 2 段後，先登入，再跑兩份預試
node arch.mjs plan-login --out <第二輪資料夾>
node arch.mjs run --round 2 --out <第二輪資料夾> --plan 接法驗證
# 接法凍結後才正式生成；可用 --materials、--configs 指定子集
node arch.mjs run --round 2 --out <第二輪資料夾>
node arch.mjs blind --round 2 --out <第二輪資料夾>
```

方案接法只用官方 [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)：終端提供登入網址，由本人在瀏覽器操作。PKCE、state、nonce 與 ID token 簽章／身分都要驗證；憑證只放 `%USERPROFILE%\.essence-chatgpt-plan`（Windows 限本人的 ACL；Unix 0700／0600），不讀 Codex CLI／app 的登入檔。更新 token 使用獨立鎖；若中斷留鎖，先查核程序再處理。這不是 Obsidian 的 G4 驗收。

以 OAuth 存取公開 `/v1/responses`，送 `reasoning.effort: high`、`store: false`、`stream: true`。官方[預覽限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)不接受 `max_output_tokens`，因此設定的方案輸出上限為 `null`；模型公開的 128,000 上限不代表方案路線已驗證。回覆沒有提供的模型版本、用量、推理設定與額度記為 `null`／未提供，不推定 high 或長輸出已通過 G3。

預試存在 `接法驗證/`，正式結果在 `生成/`；各自保存原始提示檔雜湊、材料與圖片指紋、參數、停止原因及完整／未完成狀態。只在一份預試明確因長度截斷時重試一次；兩份都截斷或重試仍截斷就停。網路、登入、額度、缺段及未確認的停止原因不自動重送。第二輪的 S0 API 預算在這個 out 獨立計，上限 $5。

盲評使用產品的 `parseDeck` 分正面／背面，保留家長備註與候選，異常附原文與行號。卡組、架構各自產生隨機代碼、每份重新命名圖片；對照及完成清單只存 `紀錄/`。`selftest` 同時跑第一輪與第二輪的假請求回歸，不會登入或生成。

## 誰測

AI 寫小程式送出，檢查格式、繁體與台灣用語、和課本不符的地方、錯題的手寫字與錯因，先打一輪 ✅✏️❌。使用者要做三件 AI 做不了的事：申請金鑰（第一輪是 Google AI Studio 與 OpenRouter；開帳號、處理金鑰只能本人來）；把教材放進測試 vault（教材在使用者手上，有版權不能進 repo）；最後從前兩名裡挑一份，看的時候不標模型名稱（哪一份比較好審要由家長判斷）。

評比轉錄時要打開每一張裁切的圖看，不能只看數量（第三輪的教訓）。

## 模型選型結果紀錄

適用時期：2026-10-13～14 的第一～三輪。結論寫在 [D-085](../../docs/decisions.md#d-085-首選-openai-gpt-56-terra) 與 [AI 模型推薦](../../docs/ai-models.md)；第四輪起改測製卡規則，紀錄在[製卡規則試用紀錄](../../docs/card-rules/trials.md)。

第一輪的做法（當時的計畫，模型清單已過時，不是目前的待做）：同一份提示（製卡規則加教材）送給 Gemini 3.8 Flash、Gemini 3.5 Flash-Lite 與 OpenRouter 的一個免費模型。教材是一節自然課本（2～4 頁）與 2～3 題錯題照片；教材與結果都只放測試 vault。Gemini 的免費和付費是同一個模型，測免費的就知道付費的品質。轉錄：同一節課本由兩個 Gemini 各轉錄一次，對照原頁計算錯字與漏掉的圖表；再分別用「原頁加轉錄稿」和「只有轉錄稿」製卡，比較差多少。

- 第一輪（2026-10-13，國二上自然 2-2 水溶液 p.43～46）：
  - 轉錄：Gemini 3.8 Flash 完整、數字正確、9 張圖全部裁好、教師註記分開；3.5 Flash-Lite 漏掉標題、側欄與頁底內容，圖全部裁切失敗。→ 轉錄用 3.8 Flash。
  - 自動檢查：3.8 Flash 檢查 Flash-Lite 的轉錄稿，找出 10 個真的漏掉的地方，D-076 的比對做法可行。
  - 製卡：3.8 Flash 5 個目標、沒有錯字，會用教材編注判斷重點；Flash-Lite 4 個目標、漏掉水溶液與非水溶液、有錯字。→ 製卡也用 3.8 Flash。「只用轉錄稿」與「加原頁」的比較還沒做完（3.8 Flash 只成功一組）。
  - 穩定性：Gemini 3.8 與 3.6 Flash 的免費方案常回 503（需求量太大），3.8 Flash 一次要 3～4 分鐘；OpenRouter 的免費模型都用不了（Gemma 4 滿載、Inkling 只開放給特定工具、Nemotron 回覆空白）。
- 第二輪（2026-10-14，同一節；OpenAI 用使用者的資料分享額度）：
  - 轉錄：GPT-5.6 Terra 27 秒、圖 8/8、自動檢查只挑出 1 處（圖 2-16 箭頭方向）；GPT-6 Sol 38 秒、圖 7/8、5 處（多是漏掉索引標記）；GPT-5.6 Luna 圖 0/7、內容重複；3.8 Flash 品質和 Terra 相當，但要 214 秒。
  - 製卡：Terra「只用轉錄稿」9 個目標，涵蓋溶質溶劑、水溶液與非水溶液、擴散、溶解度、飽和與未飽和、濃度、重量百分率濃度，圖直接附在答案下方，一次約 20 秒；「加原頁」反而只有 6 個目標。→ 只用轉錄稿製卡可行（D-076）。Sol 11 個目標；Luna 9 個。
  - Gemini 3.8 Flash 製卡又遇到 503；Mistral Large 不在免費方案內（403），之後改測 Medium 或 Small。
  - 報告的「格式問題」多半是卡片裡新附的圖（`![[...]]`）被當成格式錯誤，報告的檢查要更新。
- 第三輪（2026-10-14，圖的位置）：使用者發現 Terra 截的圖很多截錯。改用具名的 left／top／right／bottom 座標重測：GPT-6 Sol 9 張全部截對；Terra 仍然大多往下偏、把兩張圖截在一起。→ Terra 的文字轉得好，但找圖不行；轉錄改用 GPT-6 Sol，製卡維持 Terra（同一個 OpenAI 帳號）。第二輪 Terra 的卡片附的是 Gemini 轉錄稿裡的圖，所以當時沒發現。
  - 待做：錯題照片；Mistral 的免費模型。

## T7 Jev 判斷模型

要回答的問題與目前結論見[試作場說明](../README.md#t7-jev-判斷模型待做)。

### 重測方式

[`judge.mjs`](judge.mjs) 用 [`check-syntax.mjs`](check-syntax.mjs) 解析卡片，每一題問 6 個是／否檢查（洩漏答案、一題兩問、是非題、需要選項、依賴上下文、答案不明確），給 `--purpose` 時每個學習目標再打 0～4 分。`--expect` 給標準答案時，算 Jev 和正規表示式提醒各自的精確率與召回率。`--lang en` 把檢查題換成英文，用來看繁體中文的檢查題會不會比較差。

```powershell
node judge.mjs <卡片.md>… --out <repo外資料夾> --grade 國二 [--purpose "段考自然"] [--expect <標準答案.json>] [--lang zh|en] [--dry-run]
```

- 標準答案：用已經評好分的卡片（測試 vault 的 `檢查結果.md`），由 Claude 整理成 JSON：`[{ "題目": "題目開頭幾個字", "標記": ["leak", "two"] }]`。重測時沿用測試 vault 的 `T7 Jev 判斷/` 裡的同一套標準答案。
- 通過門檻（💡 助理提案）：洩漏答案與一題兩問的召回率 ≥ 80%，而且精確率不比正規表示式差，就接進 T4 流程；其他檢查只當提醒。
- 金鑰：放進 `%USERPROFILE%\.essence-api-keys.env`：OpenRouter 的 `OPENROUTER_API_KEY`（2026-10-18 使用者從 OpenRouter 申請，模型 `typesafe/jev-1.13`，網址 `https://openrouter.ai/api/v1/systemone`），或 TypeSafe 的 `TYPESAFE_API_KEY`（兩把都有時優先用 TypeSafe）。金鑰由使用者準備，其他由 AI 做。真實卡片與結果只放測試 vault。
- 判斷是否通過前先看[結果紀錄](#結果紀錄)的偏差與工具缺口：正規表示式是用這幾輪調出來的，比較對它有利；補題和候選卡片沒有送檢；一般知識的評分逐題漏標很多。

### 結果紀錄

- 第一輪（2026-10-18，OpenRouter，實際模型 `typesafe/jev-1.14-20261014`）：第四、六、七、八、九輪 28 份卡片、205 題，標準答案只標評分明確寫到的問題（洩漏 13、一題兩問 8、是非題 5），中文、英文檢查題各跑一次。410 次請求 0 失敗，合計約 0.014 美元。
  - 門檻 0.5：洩漏答案 Jev 中文 P 36%／R 92%、英文 P 29%／R 92%，正規表示式 P 100%／R 92%；一題兩問 Jev 中文 P 21%／R 100%、英文 P 26%／R 100%，正規表示式 P 86%／R 75%；是非題 Jev 中文 P 100%／R 100%、英文 P 45%，正規表示式 P 71%／R 100%。需要選項、依賴上下文沒有標準答案；「答案不明確」標了一半以上的題目，沒有用。
  - 召回率過門檻，精確率遠低於正規表示式 → **沒過**，不接進 T4 流程，也不放進外掛。調門檻沒用：真的洩漏 0.52～0.84、誤報 0.50～0.78，兩邊重疊。
  - 誤報有固定模式：「黑糖、水和黑糖水分別是什麼？」每次都被當成一題兩問（14/14）；題目點出情境就被當成洩漏；圖上寫著答案的洩漏抓不到（Jev 只看文字）。英文檢查題會把「哪一杯濃度較大」當成二選一。
  - 偏差：正規表示式就是用這幾輪調出來的，評分時也看過程式提醒，所以這個比較對正規表示式有利。
  - 工具缺口：「加進已有的學習目標」的補題和候選卡片，`check-syntax.mjs` 不解析成題目，沒有送檢。
  - 標準答案、結果在測試 vault 的 `T7 Jev 判斷/第一輪結果.md`。
- 第二輪（2026-10-18）：檢查題的 criteria 補上第一輪的固定誤報（並列項目、「什麼條件下的什麼量」算一件事；只點出情境不算洩漏），只跑中文。
  - 第一輪 205 題重跑（參考）：一題兩問 P 21%→31%、R 100%（「A、B、C 分別是什麼」的誤報 14→0）；洩漏答案 P 36%→31%，誤報反而變多。
  - 一般知識 22 份、405 題（正規表示式沒針對調過；第二～四輪只有摘要評分，沒放進來）：一題兩問 Jev P 12%／R 100%，正規表示式 P 71%／R 71%；洩漏答案只有 1 題可以測，Jev 沒抓到。評分是看學習目標這一層，逐題漏標很多，另外逐題複核：一題兩問 Jev P 27%／R 100%、正規表示式 P 100%／R 44%；**二選一與是非題 Jev P 100%／R 80%、正規表示式 P 67%／R 13%**（「光圈開大還是開小」這種寫法正規表示式抓不到）。
  - 還是**沒過**。Jev 唯一穩定贏的是二選一，但加一條「A 還是 B？」的正規表示式大概也能補上大半。兩輪合計約 0.04 美元、0 失敗。
  - 結論：Jev 先不接進 T4 流程，也不放進外掛；有新版 Jev 或新的使用情境再用同一套標準答案重測。結果在測試 vault 的 `T7 Jev 判斷/第二輪結果.md`。
