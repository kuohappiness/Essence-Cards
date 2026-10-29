# Essence Cards 協作規則

本文件給所有 AI 協作者（Claude、Codex 等）共同使用；`CLAUDE.md` 只有一行 `@AGENTS.md`。

## 底線

- 不提交 API 金鑰、登入憑證、私人學習資料或未獲授權的教材（例如出版社課本 PDF）。
- 不 force push。
- 不用 `--no-verify` 跳過 pre-commit；沒通過就修到通過（[D-117](docs/decisions.md#d-117-技術債預防機械檢查全自動ai-審查只在關鍵點)）。
- 不用 `git add -A`：commit 前看 `git status`，只 stage 自己改過的檔案，不動別人未提交的修改。
- 使用者沒有明確同意就不標 ✅；沒有反對不等於同意。
- 任務說明沒寫到、做了又很難收回的步驟，停下來問使用者。
- 沒做完的功能不寫成已可使用；學習效果寫成待驗證的目標。

## 北極星

- 最高目的：讓知識從獲取到深化形成閉環，縮短複習時間、加深記憶、提升學業表現。
- 新提案先說明它服務什麼：產品功能對上北極星，開發流程寫出具體省下的時間、token 或錯誤；兩種都和「不做」比較（[D-153](docs/decisions.md#d-153-每個新決定與新任務先和不做比較)），說明不了或不做就夠好的，只記進 backlog，不升格為決定。
- 以學習目標為單位貫穿整個流程（[D-114](docs/decisions.md#d-114-產品核心以學習目標為單位回饋先找原因)）：不做一張卡測好幾個目標，不改用卡片排程。

## 開始工作前

- 先讀 `docs/roadmap.md` 的「現在在哪裡」（[D-099](docs/decisions.md#d-099-文件精簡)）；其他文件看任務需要，用下面的對照表找。
- 查決定：已知 D-ID 用 `node experiments/tools/decisions-index.mjs D-xxx`；不知道時讀索引裡相關的主題。
- 只在試作場（`experiments/`）做測試時，只讀 `experiments/README.md` 和該任務連到的說明（[D-065](docs/decisions.md#d-065-試作場)）。
- `docs/archive/v0-planning/` 已被取代，不當依據；`docs/archive/discussions/` 是過程紀錄，不當規格。
- 以 repo 中的最新文件為準，不以舊聊天紀錄為準。
- 先載入對應的 skill：設計討論用 `essence-discuss`、寫 D-ID 用 `essence-decision`、寫或審程式用 `code-quality`、交給 Codex 用 `codex-brief`。

## 文件分工

| 文件 | 回答什麼 |
|---|---|
| `docs/product.md` | 為什麼做、為誰做、原則、範圍（v1／第二階段／不做） |
| `docs/architecture.md` | 術語、概念模型、模組邊界、平台、資料存放、AI 的位置 |
| `docs/syntax.md` | 出題語法與資料格式：卡組筆記、轉錄稿、錯題本、考試範圍、複習紀錄、AI 輸出快照怎麼寫 |
| `docs/decisions.md` | 已確認的決定與理由（D-ID）；開頭有索引 |
| `docs/roadmap.md` | 開發現況、下一步、路線圖、最近完成的事 |
| `docs/backlog.md` | v1 任務與第二階段候選的統一入口、待決問題與歷史索引 |
| `docs/plans/` | 展開的主題細項規畫；一主題一份，從 backlog 引用，命名與維護見該目錄 README |
| `docs/card-rules/` | 交給 AI 的製卡規則（未來外掛的內建預設） |
| `docs/ai-models.md` | 現在推薦的 AI 服務與模型；新模型推出時更新 |
| `docs/agents/` | 程式品質的專案設定：檢查指令、高風險範圍、卡關時的升級 |
| `docs/research/` | 參考軟體研究 |
| `docs/archive/` | 討論紀錄、v0 規劃（已取代）、路線圖較舊的已完成紀錄 |
| `tasks/` | 交給實作或查核的任務說明與審查請求；標題下第一行寫狀態 |
| `Claude Codex Discussion/` | Claude 與 Codex 的討論稿，一個議題一份 `YYYY-MM-DD-主題.md`；只在處理該議題時讀 |
| `experiments/` | 試作場：樣式稿、試作外掛與測試結果 |
| `src/`、`tests/`、`tools/` | 正式外掛的程式、測試與開發工具（D-110） |

- 同一類資訊只維護一份，其他地方用連結（[D-141](docs/decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)）。
- 製卡規則的輸出格式要和 `docs/syntax.md` 一致。
- 狀態標示：✅ 已確認｜🔁 舊共識，待重新確認｜💬 待討論｜💡 助理提案。
- 新點子先記進 `docs/backlog.md`，保留原意與來源。
- roadmap 的「現在在哪裡」每件進行中的工作一列，不寫經過。
- 做完的任務、討論稿與 plans 不刪不搬，只改標題下的狀態行（[D-143](docs/decisions.md#d-143-歸檔原則每類文件都有終點不設字數上限)）。
- 提到只在分支上的檔案時寫「分支 `x` 的 `path`（commit）」，不用相對連結。
- 文件以繁體中文撰寫；英文名稱、程式識別字與必要引用保留原文。

## AI 協作分工

- Claude 做架構判斷、文件維護與實作，包含規格清楚的機械式工作（[D-131](docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)）。
- 模型、推理等級、什麼時候請 Codex 查核、卡關時怎麼升級，照 `docs/agents/quality.md`（[D-140](docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)、[D-144](docs/decisions.md#d-144-決策交給-opus-xhighfable-只在解不了的時候)）。
- 重大決策點先在 `Claude Codex Discussion/` 寫討論稿和 Codex 輪流回覆，雙方一致才交給使用者。
- Codex 只查核與回報，修改由 Claude 做。

## 實作與 Git

- AI 能測的由 AI 測；請使用者測之前，先說明 AI 為什麼測不了；需要 iPhone 實機的測試集中成一次。
- 規劃文件直接 commit 到 `main` 並 push；較大的程式改動開分支。

## 改這份檔案

- 新增規則前要過五關（[D-147](docs/decisions.md#d-147-agentsmd-的寫法底線在上新增規則先過五關)）：① 是整個專案的重大決定（附 D-ID），或同一個錯已犯兩三次（附實例）；② 每個 session 都用得到；③ 一句話、一個具體動作；④ 一條規則只放一處：每個 session 都要的放這裡，只有某類工作用的放 skill 或 `docs/agents/`，skill 裡全域適用的搬上來並從 skill 刪掉；⑤ 使用者明確同意。
- 每加一條，同時檢查有沒有過時或用不到、可以刪的。
