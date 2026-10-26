# 文件架構整理（D-141）（給 Claude，本機執行）

狀態：進行中（第一部分執行中）

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)：判斷已在 D-141 與討論稿做完，這裡照著改文件、寫一支小檢查程式）。請新開一個 session。

## 目的與依據

- 決定：[D-141](../docs/decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)。細節以[討論稿](<../Claude Codex Discussion/2026-10-26-docs-architecture.md>)文末〈Claude 回應 Codex〉的「雙方一致的版本」為準，各項的界線看同一份檔案的〈Codex 回應〉對應題號。
- 服務北極星：每次開工必讀的量從約 1.35 萬字降到 2,500 字以內，額度留給製卡品質與 v1 開發。不刪任何決定、討論稿或證據。
- 基準：加入這份說明的 commit（`git log -1 --format=%h -- tasks/docs-architecture.md`）。開工時先 `git pull`；roadmap、backlog 這幾天一直有別的 session 在改，以開工時的 `main` 為準，下面列的行號與內容只是基準時的樣子。

## 必讀

- D-141，以及 D-099、D-106、D-117、D-130 的狀態行。
- 討論稿的 §2（問題 A～I）、〈Codex 回應〉、〈Claude 回應 Codex〉。
- 要改的檔案：`AGENTS.md`、`README.md`、`docs/roadmap.md`、`docs/backlog.md`、`docs/plans/README.md`、`docs/agents/quality.md`、`docs/archive/roadmap-completed.md`、`.claude/skills/essence-discuss/SKILL.md`、`.claude/skills/essence-decision/SKILL.md`、`.claude/skills/codex-brief/SKILL.md`、`.claude/skills/code-quality/review.md`（後三者以外的 skill 在 `.agents/skills/` 有同樣的副本）、`.githooks/pre-commit`、`package.json`。
- 寫法參考：`tools/check-skill-mirror.ts` 與 `tests/skill-mirror.test.ts`。

## 限制

- 不改 `src/` 的產品程式。`docs/decisions.md` 只在第二部分改索引與 `experiments/tools/decisions-index.mjs`，不改任何決定的內容。
- 在 `main` 上做，小步 commit。每次 commit 前 `git pull --rebase`、看 `git status`，只 stage 自己改的檔案；碰到別的 session 的修改時保留對方的內容。roadmap 與 backlog 的改寫各用一個 commit，縮短衝突的時間。
- 搬走的段落原文保留在封存，相對路徑要改成以新位置為基準。歷史紀錄（討論稿、舊討論、封存）的內文不改寫，只修連結目標與檔頭狀態。
- 改 `.claude/skills/` 的共用 skill 時，`.agents/skills/` 的副本一起改（`npm run skills` 會檢查）；`codex-brief` 只有 `.claude` 一份。
- 檢查程式要在 Windows 本機能跑：呼叫 git 用 `execFileSync`，路徑一律用 `/`。不發網路請求，不修改、不 stage 任何檔案。

## 順序

1. 寫文件檢查程式，先不接上 hook（§1）。
2. 用它找出壞連結並修好（§2）。
3. 檔頭狀態行（§3）。
4. 規則文字（§4）。
5. backlog 清理（§5）。
6. 狀態板與已完成（§6）。
7. 其他清理（§7）。
8. 把檢查接上 `npm run check`、pre-commit 與 CI（§8）。
9. 收尾（§9）。第一部分完成後再做第二部分（§10），可以同一個 session 接著做。

## 1. 文件檢查程式 `tools/check-docs.ts`

**用法**

- `node tools/check-docs.ts`：檢查 Git 追蹤的檔案，內容讀工作樹（`npm run check` 與 CI 用；CI 的工作樹就是提交樹）。
- `node tools/check-docs.ts --staged`：檔案清單與內容都讀暫存區（清單 `git ls-files -z`，內容 `git show :<path>`），pre-commit 用。部分 stage 時以暫存區為準；被刪除、改名的檔案照暫存區的樣子判定。

**範圍**：所有追蹤的 `.md`，包含 `.claude/skills/`、`.agents/skills/` 與封存，不沿用 `.ignore`，也不整區排除。

**解析**：用 `markdown-it` 解析（加為 devDependency，連同 `@types/markdown-it`），不用一條正規表示式抓連結。要處理：一般連結、圖片、參照式連結、`<有空格的路徑>`、百分比編碼；程式碼區塊與行內程式碼裡的東西不算連結。有協定的（`https:`、`mailto:`、`obsidian:` 等）與 `//` 開頭的不查。行號取連結所在區塊的第一行。

**檢查項**

1. **連結的目的地**：以同一份 Git 清單判斷是否存在，大小寫必須完全相符（Windows 不分大小寫，不能用 `existsSync` 放過）；連到資料夾時，清單裡有以它開頭的檔案就算存在。
2. **錨點**：只查目的地是 `.md` 的，以及同一檔的 `#…`。標題錨點照 GitHub 的規則，用 `github-slugger`（devDependency）產生，重複標題要有 `-1`、`-2` 後綴；標題文字取純文字（行內程式碼取內容、連結取連結文字）。另外收 HTML 的 `id="…"`（例如 `<a id="…"></a>`）。
3. **「現在在哪裡」的長度**：`docs/roadmap.md` 從 `## 現在在哪裡` 到下一個 `## ` 之前，含表格、連結與三級標題；CRLF 換成 LF，以 Unicode 碼點計（`Array.from(text).length`），上限 2,500。
4. **已完成**：`docs/roadmap.md` 的 `## 已完成` 底下的表格，資料列最多 10 列；每列「工作」欄的可見文字（連結只算連結文字，不算網址）上限 150 碼點。
5. **檔頭狀態行**：`tasks/` 與 `Claude Codex Discussion/` 第一層的 `.md`，第一個一級標題之後的第一個非空行要含 `狀態：`。

**例外**：程式裡一張逐項的表 `{ file, target, reason }`，預設是空的；只放 §2 確實改不了的，每項寫原因。

**輸出**：每個問題一行，`檔案:行號  目標  原因`；有問題時 exit code 1，沒有時印一行摘要（查了幾個檔、幾個連結）。

**測試** `tests/check-docs.test.ts`：在暫存資料夾 `git init` 一個小 repo 跑程式，至少涵蓋這些反例：參照式連結、圖片、程式碼區塊與行內程式碼裡的假連結（不報）、`<有空格的路徑>`、百分比編碼、中文標題的錨點、重複標題的 `-1`、`<a id>`、大小寫不符的路徑（要報）、連到資料夾、只在工作樹沒有 stage 的檔案（`--staged` 要報）、已 stage 的刪除、「現在在哪裡」2,500 與 2,501 碼點、已完成 10 列與 11 列、單列 150 與 151 碼點、缺狀態行。

`knip` 如果報 `markdown-it` 或 `github-slugger` 沒用到，確認 `tools/check-docs.ts` 有被當成入口（npm script 會自動列入），不要用 `ignoreDependencies` 蓋掉。

這一步的 commit 只加程式、測試與 devDependencies，`npm run check` 要通過；檢查本身先不接上。

## 2. 修壞連結

跑 `node tools/check-docs.ts`，逐項修。基準時的已知項目與修法：

- **`docs/archive/roadmap-completed.md`（約 17 處）**：從 roadmap 搬過來的列仍以 `docs/` 為基準，改成以 `docs/archive/` 為基準（`decisions.md#…` → `../decisions.md#…`、`../tasks/…` → `../../tasks/…`、`<../Claude Codex Discussion/…>` → `<../../Claude Codex Discussion/…>`）。
- **`docs/archive/discussions/2026-10-06-*.md`、`2026-10-07-*.md`**：目的地是 D-014 搬走的 v0 文件。用 `git log --follow --name-status -- <舊路徑>` 或在 `docs/archive/v0-planning/`、`docs/research/` 找到現在的位置，改連過去；真的找不到去向的，改成純文字並加「（原檔已不存在）」。
- **`Claude Codex Discussion/2026-10-24-w4-review.md`（6 處，`../../Essence-Cards-w4/…`）**：指向 repo 外的 worktree。改成行內程式碼的路徑，後面加「（W4 分支，合併 `bc01b87`）」。
- **`Claude Codex Discussion/2026-10-19-token-and-docs-workflow.md`（4 處）**：連到改名前的 skill，改連現在的 `.claude/skills/code-quality/`；對應不到的改成純文字。
- **`tasks/state-load.md` 連到 `w6-review.md`**：檔案只在分支上。照 D-141 改成「分支 `claude/w6` 的 `tasks/w6-review.md`」，不用連結；如果開工時它已經在 `main`，維持連結。
- **其他**：檔名、標題改過的，連到現在的位置。`tasks/w6-format-review-fixes.md` 引用框裡是要貼進 `syntax.md` 的原文、以 `docs/` 為基準，這幾處列進例外表，原因寫「引用框是貼進 syntax.md 的原文」。

修完 `node tools/check-docs.ts` 的連結項目要是 0（§3 的狀態行、§6 的長度可能還沒過，那兩項在對應步驟處理）。

## 3. 檔頭狀態行

`tasks/` 與 `Claude Codex Discussion/` 的每個檔案，標題下第一個非空行要含 `狀態：`。原本就有、寫在「日期：…｜整理者：…｜狀態：…」裡的算數，只修內容過時的。值用這幾種：進行中、實作完成待審、審查中、審查通過待實機、已合併（commit）、已完成（commit 或結果入口）、已結案 → D-xxx、暫停（原因）、交接待審。各輪當時的判斷保留，只改檔頭。

基準時已知的值：

| 檔案 | 狀態行 |
|---|---|
| `tasks/w1-w2.md`、`tasks/w1-w2-fixes.md` | 狀態：已合併（`91b3026`） |
| `tasks/w3.md` | 狀態：已合併（2026-10-21，見[已完成（封存）](../docs/archive/roadmap-completed.md)） |
| `tasks/w4.md`、`tasks/w4-review.md` | 狀態：已合併（`bc01b87`） |
| `tasks/w5.md` | 狀態：已合併（第一部分 `b30c41e`、第二部分 `4a7d522`） |
| `tasks/w5-review.md` | 狀態：已結案：再審通過，W5 第一部分已合併（`b30c41e`） |
| `tasks/w5-ids-review.md` | 狀態：已結案：三輪審查通過，W5 第二部分已合併（`4a7d522`） |
| `tasks/w6-format-review.md`、`tasks/w6-format-review-fixes.md` | 狀態：已完成（`7f6e7df`） |
| `tasks/ai-quality-screen.md` | 狀態：已結案 → D-118 |
| `tasks/objective-architecture.md` | 狀態：已完成（第一輪；結果見討論稿〈第一輪結果〉） |
| `tasks/objective-architecture-r2-*.md`（4 份） | 狀態：已完成（第二輪；結論 D-132） |
| `Claude Codex Discussion/2026-10-24-w4-review.md` | 狀態改成：已結案：修正後再審通過，W4 已合併（`bc01b87`） |
| `Claude Codex Discussion/2026-10-24-w5-review.md` | 狀態改成：已結案：修正後再審通過，W5 第一部分已合併（`b30c41e`） |
| `Claude Codex Discussion/2026-10-25-w5-ids-review.md` | 標題下加：狀態：已結案：三輪審查通過，W5 第二部分已合併（`4a7d522`） |
| `Claude Codex Discussion/2026-10-26-w5-architecture-debt.md` | 標題下加：狀態：已處理：A1～A10 已登錄進 backlog 的技術債 |
| `Claude Codex Discussion/2026-10-26-w6-format-review.md` | 標題下加：狀態：已處理（`7f6e7df`） |
| `Claude Codex Discussion/2026-10-23-future-plans-consolidation.md` | 不改（「尚未回覆」是實情） |
| `Claude Codex Discussion/2026-10-26-docs-architecture.md` | 狀態改成：已結案 → D-141（執行見 `tasks/docs-architecture.md`） |

`tasks/w6.md`、`tasks/state-load.md` 與其他進行中的，照開工時 roadmap 的實際狀態寫。表上沒列、開工時新增的檔案，照同樣的規則。

## 4. 規則文字

**`AGENTS.md`**（只加短的定位資訊，改完總長不要超過約 4,300 字）

- 〈開始工作前〉的「`docs/archive/v0-planning/` 已被取代…」那一條，最後一句改成：「有些討論仍在進行：從 roadmap 的狀態板或 backlog 找得到它，未決問題寫在它的主文（D-106、D-141）。」
- 〈文件分工〉表加三列：

  | 文件 | 回答什麼 |
  |---|---|
  | `tasks/` | 交給實作或查核的任務說明與審查請求；標題下第一行寫狀態 |
  | `docs/agents/` | 程式品質的專案設定：檢查指令、高風險範圍、卡關時的升級 |
  | `src/`、`tests/`、`tools/` | 正式外掛的程式、測試與開發工具（D-110） |

- 表下的「一件事只寫在一個地方，其他地方用連結引用。」改成：「**同一類資訊只維護一份**：現行規格依上表；同一個未決問題只有一份主文；試驗與審查證據留在原紀錄；入口（roadmap、backlog、討論索引）只寫狀態、下一步與連結。主文依序選：已交付實作且沒另開討論的 → `tasks/`；Claude 與 Codex 正在往返的 → 該討論稿；其他已展開的規畫 → `docs/plans/`；短點子 → backlog（[D-141](docs/decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)）。」
- 「階段或任務有變動時，更新 `roadmap.md` 的「現在在哪裡」。做完一件事時…」那一條改成：「roadmap 的「現在在哪裡」是狀態板：每件進行中或卡在某人身上的工作一列（狀態、下一步、等誰、入口），不寫經過。做完一件事在「已完成」最上面加一列，一句約 80 字加連結；超過 10 列把最舊的搬到 `docs/archive/roadmap-completed.md` 最上面，相對路徑改成以 `docs/archive/` 為基準。」
- 同一區加一條：「提到只在分支上的檔案時寫「分支 `x` 的 `path`（commit）」，不用相對連結。`node tools/check-docs.ts` 在每次 commit 時檢查連結、狀態板長度、已完成與檔頭狀態行。」

**`README.md`**：刪掉「## 目錄」與它的程式碼區塊；「正式外掛的程式放在…（D-110）」那句移到〈文件〉表的下面。表格本身留著給人看。

**`docs/plans/README.md`**：表格的兩列改成——

- 當前進度與最近完成｜`docs/roadmap.md`｜狀態板一列、已完成一句；不寫經過，細節在主文（D-141）
- Claude／Codex 討論與交接｜`Claude Codex Discussion/YYYY-MM-DD-主題.md`｜同一議題接續同一份；正在往返時它就是未決問題的主文，入口連到它；結案在檔頭標 D-ID

**`docs/agents/quality.md`**：〈檢查指令〉加一條「文件檢查：`node tools/check-docs.ts`，每次 commit 都跑，只改文件的 commit 也跑（D-141）」；「自動執行的地方」那一條不用改。

**`essence-discuss`**（兩份）：〈結束〉第二點改成「沒談完：在主文（討論稿或 `docs/plans/`）寫下還沒解的問題與目前傾向；roadmap 的狀態板只更新那一列的狀態與下一步。」

**`essence-decision`**（兩份）：第 6 步改成「**路線圖**：在 `roadmap.md`「已完成」最上面加一列（一句、約 80 字，加連結）；超過 10 列把最舊的搬到 `docs/archive/roadmap-completed.md` 最上面，相對路徑改成以 `docs/archive/` 為基準。狀態板有變就更新那一列。」

**`codex-brief`**：〈寫任務說明〉第 1 點最後加「標題下第一行寫 `狀態：進行中`，做完改成實際狀態（例如已合併的 commit）。」

**`code-quality/review.md`**（兩份）：〈審查請求範本〉最後加一條「**檔頭**：審查請求與審查報告的標題下第一行寫狀態（待審、待修、再審通過、已合併的 commit）。」

## 5. backlog 清理

- 「待決問題」底下全部已定案的小節（基準時是「出題語法定稿留下的待確認」「複習與檢核細節」），整個小節連同原標題搬到檔尾新的 `## 已定案對照`；標題文字不變，錨點與「第 N 題」的編號就不會變。
- 還有未決題目的小節（「架構釐清中會碰到的」「AI 規劃」），未決的留在原處；「已定案：」那一串搬到 `## 已定案對照` 底下的新小節，標題寫「架構釐清中會碰到的（已定案）」「AI 規劃（已定案）」，不要用和原標題相同的文字（會產生 `-1` 錨點）。
- 「其他待決」的 ✅ 條目：已定的部分搬到 `## 已定案對照`；同一條裡還有後續工作的（例如 Claudian 那條的接法驗證、跨裝置救回底下的未決部分），後續工作留在原處、改寫成待辦的一句。不按 ✅ 整項刪。
- 「轉錄把『給學生』欄標成教師註記」那條（基準時第 131 行）：第二輪已修正複本、核對並凍結，搬到 `## 已定案對照`，加一句「2026-10-23 第二輪已修正複本並凍結，經過見已完成（封存）」。旁邊「只在教師材料裡的內容要不要出卡」是另一題，留著。
- 「舊入口對照」「增強版待討論」等只為了保留舊錨點的小節，保留不動。
- 改完跑 `node tools/check-docs.ts`，所有指到 backlog 的錨點都要還在。

## 6. 狀態板與已完成

**搬到封存**：在 `docs/archive/roadmap-completed.md` 的表格之前加一節 `## 2026-10-27 從「現在在哪裡」移出的段落`，把改寫前整段「現在在哪裡」（含「下一次對話從這裡開始」與「另外的專題與研究」）以及整節「v1 開發前要做的事」原文貼進去，相對路徑改成以 `docs/archive/` 為基準。`## 已完成` 目前的所有列也原文搬到封存表格的最上面（同樣改路徑）；roadmap 的已完成從新的短列重新開始。

**移除前先確認**，下列未決事項要在主文或 backlog 找得到，找不到就加進 backlog 的對應位置（一句、附來源）：

- 製卡規則下一輪試用：用真實影片筆記再試、一般知識的數量約加倍（20～31 個）、共同成功判準、2-2 每份仍約 5 題洩漏（多是二選一與互補配對）、相鄰能力的一題放錯池（D-118）。
- 學習地圖：v1 只改加深、寫進 AI 製卡模組；通用規則 F 節等第三輪結束、重整製卡規則時一起改（D-136）。要在 backlog 的 v1 任務表找得到。
- API 挑選：錯題照片實測（等使用者提供 2～3 張字跡潦草的真實考卷，照 D-113 整頁拍）、Mistral 的其他模型。
- 獨立 App：`docs/plans/standalone-app.md`。Claudian：backlog 的〈訂閱製卡接法驗證〉表。AI 規劃：backlog 的待決。
- W5 與 W6 都合併時要提醒使用者做 code-quality 的里程碑回顧與安全檢查，A1～A3 請 Codex 核對：寫進狀態板下面的里程碑那一行。

**新的「現在在哪裡」**：

```markdown
## 現在在哪裡

v1 開發中（2026-10-20 開始寫程式）。開工只讀這一節；還沒開工的 v1 工作看 [backlog 的 v1 任務](backlog.md#v1-需要做的任務)，要找決定看[決策索引](decisions.md#索引)（[D-141](decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)）。

| 工作 | 狀態 | 下一步 | 等誰 | 入口 |
|---|---|---|---|---|
| …每件進行中或卡在某人身上的工作一列… |

下一個里程碑：W1～W6 打通「手寫卡組 → iPhone 複習 → 自評 → 排程」（D-111）；W5、W6 都合併後，提醒使用者做 code-quality 的里程碑回顧與安全檢查，A1～A3 請 Codex 核對。
```

基準時的列（開工時照 `main` 的實際狀態更新，新增的工作照同樣規則加列）：

| 工作 | 狀態 | 下一步 | 等誰 | 入口 |
|---|---|---|---|---|
| W6 複習畫面 | Codex L2 審查：先不合併（F1～F7、S1～S2） | Opus 修 F1～F3、F5～F7；其餘五題請 Fable 決定 | Fable、本機 session | `tasks/w6.md`、`tasks/w6-l2-questions.md` |
| 卡組讀不到就跳過那一篇 | 已排程 | 在 `claude/state-load` 實作，iPhone 測試前合併 | 本機 session | `tasks/state-load.md` |
| 國小社會預設 | v0.1 第一次試用完 | 決定地名配特色要不要出卡與四點修改，改成 v0.2，再用 Sol 對照 2-1 | 使用者 | `docs/card-rules/elementary-social.md` |
| 更新與相容 | 討論中 | 一次一題，先問每台裝置要不要記版本 | 使用者 | `docs/plans/updates.md` |
| 外掛架構逐環節檢視 | 討論中 | 依討論稿最後一節 | 依實際 | 討論稿 `2026-10-26-plugin-architecture.md` |
| 文件架構整理 | 執行中 | 照任務說明 | 本機 session | `tasks/docs-architecture.md` |
| 未來規畫統整的審閱 | Codex 2026-10-23 交接，未審 | Claude 審閱，或使用者決定結掉 | 使用者 | 討論稿 `2026-10-23-future-plans-consolidation.md` |
| 學習目標架構第三輪 | 暫選 R3 | 兩三個新單元與段考到齊再跑 | 新教材 | D-132 |
| 製卡規則下一輪試用 | 等真實影片筆記 | 看目標數量、共同成功判準、洩漏與放錯池 | 新教材 | `docs/card-rules/trials.md` |
| 英文一字多義 | 規則已改（D-125） | 有多義字的真實教材時試用 | 新教材 | D-125 |

表格裡的入口寫成連結（相對於 `docs/`），上表為了好讀只寫路徑。「下一次對話從這裡開始」這個標題拿掉；`## 路線圖`、`## 未來準備開發：獨立 App` 兩節不動。改完「現在在哪裡」要在 2,500 碼點以內，目標 2,000。

## 7. 其他清理

- **`.ignore`**（新檔，根目錄）只有兩行：`/docs/archive/v0-planning/board/index.html`、`/docs/archive/v0-planning/board/mobile.html`。
- **`experiments/t4/README.md` 第二輪那一節**：標題改成「### 第二輪（已完成：2026-10-23～24 生成與盲評，結論 D-132）」；第一段改成過去式：「已照[第二輪任務說明](../../tasks/objective-architecture-r2-connection.md)分三段完成（接法凍結：方案額度、Sol high）。要重跑時用下面的指令；設定與提示讀 `arch/第二輪/設定.json`，不改第一輪輸出。」指令區塊與後面的限制說明保留。加一句「Obsidian 內登入（G4）不在這次驗證範圍，仍未驗證，見 backlog 的訂閱製卡接法驗證。」
- **`experiments/README.md` 的 T7**：表格那列的狀態改成「暫停」，說明改成「兩輪沒過；有新版 Jev 或新情境才重測」；小節標題改成「### T7 Jev 判斷模型｜暫停」，表格裡指向它的錨點一起改。

## 8. 接上檢查

- `package.json`：加 `"docs": "node tools/check-docs.ts"`，`check` 在 `npm run skills` 之後加 `npm run docs`。CI 跑 `npm run check`，不用另改 workflow。
- `.githooks/pre-commit`：`node_modules` 的檢查移到最前面；接著每次都跑 `node tools/check-docs.ts --staged`；原本「只有程式相關的檔案才跑 `npm run check`」的判斷保留在後面。也就是只改文件的 commit 跑文件檢查、不跑產品測試。
- 改完在本機試三種 commit：只改文件、只改程式、部分 stage（工作樹有壞連結但沒 stage，要能 commit；stage 了就要擋）。

## 9. 收尾

- roadmap 的狀態板拿掉「文件架構整理」那一列（第二部分還沒做的話，改成「第二部分：決策索引分主題」）；已完成最上面加一列，例如：「文件架構整理（[D-141](decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)）：狀態板、主文規則、檔頭狀態行，文件檢查接上每次 commit」。
- 這份說明的狀態行改成實際狀態。
- 回報：commit 清單、`npm run check` 與 `node tools/check-docs.ts` 的輸出摘要、「現在在哪裡」改前改後的碼點數、例外表的每一項與原因、沒做或做不到的事與原因。

## 10. 第二部分：決策索引分主題與唯讀查詢

**分組**

- `experiments/tools/decisions-index.mjs` 加一張明確的對照表，每個 D-ID 指定一個主要主題：

  | 主題 | 放什麼 |
  |---|---|
  | 產品與範圍 | 北極星、使用者、成功標準、v1 與第二階段的範圍、Capture／Mindmap／獨立 App 的定位 |
  | 學習目標與製卡規則 | 學習目標、製卡規則、加深、學習地圖、各科預設、英文學習、錯題補強的內容 |
  | 資料格式與語法 | `syntax.md` 管的格式：卡組筆記、轉錄稿、錯題本、考試範圍、複習紀錄、ID、指紋 |
  | 複習與排程 | 自評、FSRS、每天的佇列、作答方式、考前抽測、中斷與恢復 |
  | 畫面 | 複習畫面、入口、目錄、設定頁、給家長、編輯畫面 |
  | AI 接法與模型 | AI 服務與模型推薦、接法、訂閱、API |
  | 程式結構與品質 | 程式結構、開發順序、機械檢查、相容性 |
  | 協作與文件 | 協作流程、文件架構、試作場、決策紀錄本身 |

  分不出來時，看這條決定主要改的是哪一份現行規範（product → 產品與範圍、`card-rules/` → 學習目標與製卡規則、syntax → 資料格式與語法，以此類推）。分錯之後很容易改，不必停下來問。
- 索引改成 `## 索引` 底下每個主題一個 `### 主題`，各自一張表，組內照編號排；表格的欄位、「一句話」與狀態照舊。不另留一份編號索引。
- 程式在寫檔前檢查：重複、漏分、對照表裡不存在的 D-ID 都報錯並以 exit code 1 結束，不改檔。主題不要寫進正文的狀態行（解析器只讀標題下第一個非空行）。
- 讀既有「一句話」的那段要能讀新的分組格式（多張表）；改完連續跑兩次，第二次不能有任何差異，141 條的一句話都在、每條恰好出現一次。

**查詢**

- `node experiments/tools/decisions-index.mjs D-062 [D-xxx …]`：在任何寫檔的程式之前分流。印出每個指定 D-ID 的正文，再遞迴印出它狀態行裡明示的後續條目（和索引的「後續見」同一個算法），去重、照出現順序。未知的 ID 印到 stderr 並以 exit code 1 結束。
- 輸出開頭一行：「以下是原文與明示的後續條目，不等於完整的現行規則；實作以 product、architecture、syntax 與任務說明為準。」
- 執行前後 `docs/decisions.md` 必須逐位元組相同。
- 測試 `tests/decisions-index.test.ts`：查詢不改檔（比對雜湊）、未知 ID 報錯、後續條目遞迴且去重。

**規則文字**

- `AGENTS.md`〈開始工作前〉「要知道某個決定或它的理由，先看 `docs/decisions.md` 開頭的索引…」改成：「要知道某個決定：已知 D-ID 用 `node experiments/tools/decisions-index.mjs D-xxx` 印出原文與後續條目；不知道時讀索引裡相關的主題。提出新決定前，也先查相關主題有沒有舊決定。」
- `essence-decision`（兩份）第 1 步的「讀索引」改成「讀索引裡相關的主題」；第 4 步加「新決定先在 `decisions-index.mjs` 的主題對照表加上 D-ID，再執行」。
- `essence-discuss`（兩份）第 2 點的「讀 `docs/decisions.md` 開頭的索引」改成「讀索引裡相關的主題」。

**收尾**：狀態板拿掉這一列、已完成加一列；這份說明的狀態行改成已完成（commit）。
