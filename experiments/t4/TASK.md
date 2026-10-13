# T4 測試程式：任務說明（給 Codex）

要回答的問題見[試作場說明](../README.md)的 T4。這份文件只說明程式要做什麼；提示詞（`prompts/`）與模型清單（`models.json`）由 Claude 維護，程式只讀取，不修改。

先讀 repo 根目錄的 `AGENTS.md`。

## 限制

- 只新增或修改 `experiments/t4/` 底下的檔案；`prompts/`、`models.json` 不要改。
- Node 24、ES modules（`.mjs`），不用 TypeScript，不需要建置。相依套件越少越好，要能在 Windows 上直接 `npm install`，不能需要 C++ 編譯工具。
- 金鑰：讀 `%USERPROFILE%\.essence-api-keys.env`（每行 `名稱=值`）；同名的環境變數優先。金鑰不能出現在程式碼、畫面輸出、紀錄檔或任何結果檔裡。
- 結果只寫到 `--out` 指定的資料夾，那個資料夾在 repo 外面。不要把課本內容、頁面圖片或結果寫進 repo。
- 在新分支 `t4-model-test` 上 commit。如果在本機的 repo 資料夾工作，請用 `git worktree add ../Essence-Cards-t4 t4-model-test` 開在旁邊的資料夾，**不要在原資料夾切換分支**：同一個資料夾裡還有其他 AI 正在 main 上改文件。
- 不要執行會呼叫 API 的指令；只跑下面的 `selftest`。真正的測試由 Claude 執行。

## 指令

```
node t4.mjs find --pdf <檔案> --text <文字>
node t4.mjs render --pdf <檔案> --pages <起-迄> --out <資料夾>
node t4.mjs transcribe --out <資料夾>
node t4.mjs verify --out <資料夾>
node t4.mjs cards --out <資料夾> [--transcript <轉錄稿檔名>]
node t4.mjs all --pdf <檔案> --pages <起-迄> --out <資料夾>
node t4.mjs selftest
```

`--pages` 是 PDF 的頁序（從 1 開始），例如 `23-26`。

## 每一步做什麼

**find**：列出文字層裡含有指定文字的 PDF 頁序，每頁附上前後約 40 個字，方便找到某一節從哪一頁開始。

**render**：把指定頁轉成 PNG，長邊約 1600 像素，存到 `<out>/頁面/`；同時取出每頁的文字層（沒有就留空），存成 `<out>/頁面/文字層.json`。

**transcribe**：對 `models.json` 的 `transcribe` 裡每個模型：

1. 送出一次請求：system 是 `prompts/transcribe.md`；user 依序放每一頁的圖片（base64 data URL）與「PDF 第 N 頁」的標示，最後附上文字層。
2. 從回覆裡找出所有 `<figure page="N" box="ymin,xmin,ymax,xmax">說明</figure>`。座標是 0～1000 的相對位置；依座標從那一頁的 PNG 裁切，存成 `<out>/<模型>/圖/<模型>-p<N>-<序號>.png`（檔名含模型，Obsidian 才不會把不同模型的同名圖搞混），並把標記換成：
   ```
   ![[<模型>-p<N>-<序號>.png]]
   *說明*
   ```
   座標無效或超出範圍時，保留原標記，並在畫面上提示。
3. 存成 `<out>/<模型>/轉錄稿.md`。

**verify**：對每一份轉錄稿，用 `models.json` 的 `verify` 模型送出：system 是 `prompts/verify.md`；user 放頁面圖片與轉錄稿全文。結果存成 `<out>/<模型>/檢查.md`。

**cards**：用 `--transcript` 指定的轉錄稿（預設是 `transcribe` 清單第一個模型的），對 `models.json` 的 `cards` 裡每個模型做兩種：

- `只用轉錄稿`：轉錄稿全文，加上轉錄稿用到的圖（`圖/` 裡的 PNG）。
- `轉錄稿加原頁`：上面的內容，再加上原本的頁面圖片。

system 是 repo 裡的 `docs/card-rules/common.md`、`docs/card-rules/science.md` 與 `prompts/cards.md` 依序接在一起。結果存成 `<out>/卡片/<模型>-<只用轉錄稿|轉錄稿加原頁>.md`。

**all**：依序執行 render、transcribe、verify、cards。

**selftest**：不連網，檢查金鑰檔的解析（用暫存的假檔案）、`<figure>` 標記的解析與座標換算、用程式產生的小圖測試裁切。

## 共通

- 介面：OpenAI 相容的 Chat Completions（`POST {baseUrl}/chat/completions`），網址與金鑰名稱見 `models.json` 的 `providers`。圖片用 `{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}`。
- 一次只送一個請求；同一家兩次請求至少間隔 `minSecondsBetweenCalls` 秒。
- 遇到 429：依 `Retry-After` 等待後重試，最多 3 次；還是失敗就顯示「<供應商> 的額度暫時用完了」並跳過這一項，繼續下一項。其他錯誤顯示 HTTP 狀態與錯誤訊息的前 300 個字。
- 每次請求在 `<out>/紀錄.json` 追加一筆：時間、步驟、供應商、模型、HTTP 狀態、秒數、回覆裡的 token 用量（`usage`）。不記錄提示或回覆的內容，也不記錄圖片。
- 在 `experiments/t4/README.md` 寫怎麼安裝與執行（幾行就好）；`node_modules/` 加進 `experiments/t4/.gitignore`。

## 完成後

回報分支名稱、最後一個 commit，以及 `selftest` 的輸出。
