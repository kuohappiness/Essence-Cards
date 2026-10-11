# AI API 供應商調查

查核：2026-10-11｜價格與額度常變，寫說明書前要重新查核（[D-048](../decisions.md#d-048-使用說明書) 補充）。討論經過見[討論紀錄](../archive/discussions/2026-10-11-api-selection.md)。

這份文件回答「哪些 API 符合兩個外掛的需求」。挑選原則見 [D-055](../decisions.md#d-055-ai-模型的選擇原則)、介面見 [D-059](../decisions.md#d-059-ai-的接法一種介面模型不包進外掛)。

## 1. 兩個外掛的需求

| | Essence Cards（v1） | Essence Capture（之後，另一個 repo） |
|---|---|---|
| 工作 | 製卡（筆記或 PDF 頁面）、錯題分析（照片） | PDF、影片（含 YouTube）、音檔、網頁 → 筆記 |
| 一次的量 | 約 2 萬 token 送出、3 千收回，大部分是製卡規則（[架構 §6](../architecture.md#6-ai-的位置-細節之後專門討論)） | 大很多，例如一部影片可能數十萬 token |
| 次數 | 一學期約 60 次 | 待估 |
| 要看圖 | 要：課本圖表、錯題的手寫字 | 要：PDF 頁面、掃描檔 |
| 要聽音檔、看影片 | 不用 | 要 |
| 介面 | OpenAI 相容（D-059） | 未定 |

## 2. 淘汰條件（2026-10-11 使用者同意）

1. 能用 OpenAI 相容的介面呼叫（D-059）。
2. 能看圖，而且圖片能從 OpenAI 相容的介面送出。
3. 一次塞得下約 2 萬 token 送出、3 千收回。每天能用幾次不拿來淘汰，只記在表上。
4. 家長申請得到：台灣能註冊；免費方案不用綁信用卡。
5. 價格：免費優先；付費的換算成一學期的花費。

不列為條件：免費方案會拿資料去訓練（D-055 已接受）；條款裡未成年的限制（使用者決定先不考慮，見討論紀錄）。

## 3. 結果

| 供應商 | 免費方案 | Cards | Capture | 結論 |
|---|---|---|---|---|
| Google AI Studio（Gemini） | 有，不用綁卡，台灣可用 | ✅ | ✅ 圖片、PDF、音檔、影片、YouTube 網址都能直接處理 | 首選候選 |
| OpenRouter | 有，免費模型每天 50 次 | ✅ | ✅ 透過 Gemini 等模型，影片也能送 | 備案候選 |
| Mistral | 有，要驗證手機號碼 | ✅ | ❌ 沒有影片 | 能用，但家長要為 Capture 多開一個帳號 |
| Anthropic（Claude） | 沒有 | ✅ 付費 | ❌ 沒有音檔、影片 | 要用就透過 OpenRouter |
| Groq | 有 | ❌ 免費方案沒有能看圖的模型，每分鐘只能送 8 千 token | ❌ | 淘汰（條件 2、3） |
| GitHub Models | — | — | — | 淘汰：2026-07-30 已停止服務 |

OpenAI 和中國大陸的平台沒有逐一查官方頁面；它們的模型大多能透過 OpenRouter 使用。

## 4. 各家重點

### Google AI Studio（Gemini）

- 台灣在可用地區內；用 Google 帳號申請，免費方案不用綁卡。
- OpenAI 相容網址：`https://generativelanguage.googleapis.com/v1beta/openai/`。這個介面能送圖片和音檔；影片和 PDF 要用 Gemini 自己的介面（Capture 可能需要）。相容介面仍是 beta。
- 免費方案的額度：Google 已經不公布數字，只在 AI Studio 裡顯示。第三方 2026-09-02 實測：Flash 系列每分鐘 5 次、每天 20 次；Flash-Lite 系列每分鐘 15 次、每天 500 次。Gemini 2.5 系列已經不開放給新使用者。
- 額度以「專案」計算，不是以金鑰計算；同一個專案的兩個外掛共用額度。每個模型分開算。每天的額度在太平洋時間午夜重置，也就是台灣時間下午 3 點（冬令時間 4 點）。
- 免費方案的內容會用來改進產品，可能有人工審閱，條款要求不要送個人資料：錯題照片要避開姓名。付費方案不拿來改進產品。
- 付費價格（每百萬 token，美元；括號是 2027-01-01 起的價格）：

| 模型 | 免費方案 | 輸入 | 輸出 | Cards 一學期約 |
|---|---|---|---|---|
| Gemini 3.8 Flash | 有 | 0.75（1.50） | 3.75（7.50） | 1.4 美元（2.9） |
| Gemini 3.5 Flash-Lite | 有 | 0.30 | 2.50 | 0.8 美元 |
| Gemini 3.1 Flash-Lite | 有 | 0.25 | 1.50 | 0.5 美元 |
| Gemini 3.1 Pro Preview | 沒有 | 2.00 | 12.00 | 4.2 美元 |

- 待查：付費的開通步驟對家長難不難、能不能設花費上限。

### OpenRouter

- 一把金鑰可以用幾百個模型，包括 Gemini、Claude、GPT、Qwen；本身就是 OpenAI 相容的介面。圖片、PDF、音檔、影片都能送；YouTube 網址會轉給 Google 的 Gemini 處理。
- 免費模型（名稱以 `:free` 結尾）：每分鐘 20 次、每天 50 次；累計買過 10 美元以上，提高到每天 1000 次。2026-10-11 能看圖的免費模型有 Gemma 4 31B 與 26B（圖片、影片）、Inkling 與 Inkling Small（圖片、音檔）、Nemotron 3 Nano Omni（圖片、音檔、影片）等，名單常變。
- 付費是預付：先儲值才扣，不會被多扣。儲值收 5.5% 手續費（最低 0.8 美元）；模型照原廠價格，不加價；儲值金可能在一年後到期。
- 預設不保存提示與回覆；免費模型的提供者可能會拿資料去訓練，可能要在設定裡允許才用得到（待實測）。
- 一學期花費（照 OpenRouter 標價）：

| 模型 | 輸入 | 輸出 | Cards 一學期約 |
|---|---|---|---|
| Claude Haiku 5.5 | 0.10 | 0.50 | 0.2 美元 |
| GPT-6 Luna | 0.10 | 0.50 | 0.2 美元 |
| Qwen3.8 Flash | 0.15 | 0.47 | 0.2 美元 |
| Gemini 3.8 Flash | 0.75 | 3.75 | 1.4 美元 |
| Claude Sonnet 5.5 | 2.00 | 10.00 | 3.8 美元 |

Claude 的價格已對照 Anthropic 的官方價目（Haiku 5.5 的價格限 10 萬 token 以下的提示）。

### Mistral

- 免費的 Experiment 方案：要驗證手機號碼，不用綁卡；資料可能拿去訓練。額度不公布，第三方說約每秒 1 次。
- 有能看圖的模型（Mistral Small、Medium、Large 4），Cards 用得了；沒有影片，Capture 不夠用。

### 淘汰的

- Groq：官方額度表裡沒有能看圖的模型；每分鐘只能送 8 千 token，一次製卡就超過。
- GitHub Models：2026-07-30 停止服務。

## 5. 一學期花費的算法

一學期約 100 萬 token 送出、18 萬 token 收回（60 次 × 3 千），所以：

> 一學期花費（美元）≈ 輸入單價 ＋ 輸出單價 × 0.18（單價是每百萬 token 的美元）

會「思考」的模型，思考用的 token 算在輸出，實際花費會比表上多一些。Gemini 3 以後的模型不能關掉思考。

## 6. 還要實測的

這些在試作場實測（[D-059](../decisions.md#d-059-ai-的接法一種介面模型不包進外掛) 補充）：

- 卡片品質、有沒有照輸出格式寫、繁體與台灣用語、錯題的手寫字與錯因。
- Gemini 3.8 Flash 和 Flash-Lite 差多少：差不多的話，Flash-Lite 每天 500 次比較不會用完。
- OpenRouter 的免費模型夠不夠當備案。

## 來源

- Google：[價格](https://ai.google.dev/gemini-api/docs/pricing)、[額度](https://ai.google.dev/gemini-api/docs/rate-limits)、[OpenAI 相容](https://ai.google.dev/gemini-api/docs/openai)、[可用地區](https://ai.google.dev/gemini-api/docs/available-regions)、[附加條款](https://ai.google.dev/gemini-api/terms)
- 免費額度的第三方實測：[aiplug.work（2026-09-02）](https://aiplug.work/en/blog/gemini-free-tier-limits)
- OpenRouter：[額度](https://openrouter.ai/docs/api-reference/limits)、[常見問題](https://openrouter.ai/docs/faq)、[影片輸入](https://openrouter.ai/docs/guides/overview/multimodal/videos)、模型清單（`https://openrouter.ai/api/v1/models`，2026-10-11 取得）
- Mistral：[Experiment 方案說明](https://help.mistral.ai/en/articles/450104-how-can-i-try-the-api-for-free-with-the-experiment-plan)
- Groq：[額度](https://console.groq.com/docs/rate-limits)
- GitHub Models：[停止服務公告](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)
