# 重寫 AGENTS.md（D-147）（給 Claude，本機執行）

狀態：待執行

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（判斷已在 D-147 做完，這裡照著換文字、刪 skill 裡的重複）。請新開一個 session，同時加入 Essence Cards 與 Essence Capture 兩個資料夾。

## 目的與依據

- 決定：[D-147](../docs/decisions.md#d-147-agentsmd-的寫法底線在上新增規則先過五關)，修改 D-143。讓每個 session 都讀的 AGENTS.md 只留必要的規則，並加上新增規則的五關，防止再膨脹。
- 基準：加入這份說明的 commit（`git log -1 --format=%h -- tasks/agents-md-rewrite.md`）。開工先 `git pull`，以開工時的 `main` 為準；如果 AGENTS.md 在基準之後被別人改過，先把那些修改併進下面的新版，再照五關判斷要不要留。

## 限制

- 不改 `src/`、`docs/decisions.md`（D-147 與 D-143 的指向已寫好）。
- `CLAUDE.md` 不動，兩個 repo 都維持一行 `@AGENTS.md`。
- 改 `.claude/skills/` 的共用 skill 時，`.agents/skills/` 的副本一起改（`npm run skills` 會檢查）。
- 在 `main` 上做，小步 commit；每次 commit 前 `git pull --rebase`、看 `git status`，只 stage 自己改的檔案。
- 下面沒列到的規則不要自己新增；覺得少了什麼，寫進完成回報，請使用者決定（第五關）。

## 1. Essence Cards 的 `AGENTS.md`

整份換成下面的內容。「文件分工」的對照表照原樣保留（基準之後若有新增的列也保留），只換表格以外的文字。

```markdown
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
- 新提案先說明它怎麼服務北極星；說明不了的只記進 backlog，不升格為決定。
- 以學習目標為單位貫穿整個流程（[D-114](docs/decisions.md#d-114-產品核心以學習目標為單位回饋先找原因)）：不做一張卡測好幾個目標，不改用卡片排程。

## 開始工作前

- 先讀 `docs/roadmap.md` 的「現在在哪裡」（[D-099](docs/decisions.md#d-099-文件精簡)）；其他文件看任務需要，用下面的對照表找。
- 查決定：已知 D-ID 用 `node experiments/tools/decisions-index.mjs D-xxx`；不知道時讀索引裡相關的主題。
- 只在試作場（`experiments/`）做測試時，只讀 `experiments/README.md` 和該任務連到的說明（[D-065](docs/decisions.md#d-065-試作場)）。
- `docs/archive/v0-planning/` 已被取代，不當依據；`docs/archive/discussions/` 是過程紀錄，不當規格。
- 以 repo 中的最新文件為準，不以舊聊天紀錄為準。

## 文件分工

（對照表照原樣）

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
```

## 2. 搬走或刪掉的內容，確認另一處已有

舊 AGENTS.md 拿掉的內容，照下表確認另一處真的有；沒有的補進去（只補下表寫的位置）。

| 舊內容 | 應該在 |
|---|---|
| 提新決定前先查舊決定；寫 D-ID、標已取代、更新索引的步驟 | `essence-decision` 第 1～4 步 |
| backlog 定案或做完就移除、連結改連 D-ID | `essence-decision` 第 5 步 |
| 已完成加一列、超過 10 列搬封存 | `essence-decision` 第 6 步；列數由 `tools/check-docs.ts` 擋 |
| 沒有討論稿的討論結束時寫摘要 | `essence-discuss`「結束」 |
| 一次一題、真實教材例子、提案不是決定、優先刪減 | `essence-discuss` 第 1、4、5、6 點 |
| 未決問題的主文放哪裡（tasks → 討論稿 → plans → backlog 的順序） | **補進** `essence-discuss`「結束」的「沒談完」那點 |
| 請 Codex 查核要寫明查什麼、讀哪些檔、基準 commit、驗收標準 | `docs/agents/quality.md`；沒有就**補進**它講 L2 的那一節 |
| 請使用者決定時分別說明 Claude 和 Codex 的考量；結案標「已結案」並連 D-ID | `docs/agents/quality.md` 或 [D-106](../docs/decisions.md#d-106-claude-與-codex-的協作流程)；兩處都沒有就**補進** `quality.md` |
| 轉交 Codex 或 ChatGPT 是例外 | `codex-brief` |

直接刪、不搬的：「參考既有實作時先用第一原理想最佳解」（抽象）、「由不同 AI 接手時同樣遵守本文件」（本檔本來就給所有 AI）、「commit 訊息要清楚」（空話）、pre-commit 會自動跑的說明（不是規則）。

## 3. skill 裡和 AGENTS.md 重複的，從 skill 刪掉

照第四關，全域規則只留在 AGENTS.md：

- `essence-discuss` 第 3 點「對上北極星」：刪掉「每個提案說明它怎麼服務北極星，說明不了的記進 backlog」，AGENTS.md 已有；這點整條拿掉，後面重新編號。
- `essence-discuss` 第 4 點：只留「你的建議標 💡」，刪掉「只有使用者明確同意才算談定，沒有反對不等於同意」（AGENTS.md 底線已有）。
- `essence-decision` 開頭的「只寫使用者明確同意的內容；沒有反對不等於同意」：保留「只寫使用者明確同意的內容，不確定時先問一句」，刪掉「沒有反對不等於同意」。
- `essence-decision` 第 5 步最後加一句：「要改 `AGENTS.md` 時，先照它最後一節的五關檢查。」
- 再把 `.claude/skills/`、`.agents/skills/` 每個 skill 讀一遍：和新 AGENTS.md 重複的句子刪掉；看起來全域適用、AGENTS.md 卻沒有的，**不要自己搬**，列在完成回報裡請使用者決定。

## 4. Essence Capture 的 `AGENTS.md`

- 在標題下面、「規劃與決定看 Essence Cards」上面加一節 `## 底線`，把「不提交 API 金鑰、PDF、課本頁面或轉錄出來的教材（有版權）；測試結果放 repo 外。」搬過去。
- 刪掉「💡 開發期間這份檔案只寫指向……」那條（是待辦，已在 Essence Cards 的 backlog「Capture 的協作規則要獨立」）。
- 其他不動。在 Capture repo 另外 commit、push。

## 5. 收尾

- `npm run check` 通過（skill 有改）。
- roadmap：拿掉狀態板「精簡 AGENTS.md」那一列；在「已完成」最上面加一列，超過 10 列照規則搬封存。
- 這份說明的狀態行改成「已完成（commit 範圍）」。
- 回報：新 AGENTS.md 的字元數（基準約 9,800）、§2 補了哪些、§3 列出的待決候選。
