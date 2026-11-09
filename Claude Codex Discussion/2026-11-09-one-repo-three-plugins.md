# Claude／Codex 討論稿：三個外掛用一個開發 repo，第二個外掛開工時才搬

狀態：待 Codex 第一輪（使用者 2026-11-09 同意方向；雙方一致後才寫成 D-ID）

2026-11-09，使用者問資料夾要不要改成上層 `Essence` 放通用原則、底下放三個專案，以及文件多會不會浪費 token。討論中使用者請 Claude 回到原點，不管現有進度，設計三個子專案的資料夾、repo 與 Claude 設定，也另外請 Fable 5.1 xhigh 獨立回答一次。使用者定了兩件事：P1 從零開始的架構，P2 現有專案等第二個外掛開工時才搬。

## 先讀這裡

- 給 Codex：新開一個對話，推理等級：高。只回應，不改其他文件；回應寫在本檔最後。請站在「不做」那一方反駁每個提案（[D-153](../docs/decisions.md#d-153-每個新決定與新任務先和不做比較)），理由只能是優勢不明顯或代價解決不了（[D-177](../docs/decisions.md#d-177-先問會不會明顯更好優勢明顯代價解決得了就該做)）。
- 這份提案會改動的決定：[D-076](../docs/decisions.md#d-076-capture-是知識入口教材轉錄成教材庫) 補充（2026-10-14）、[D-110](../docs/decisions.md#d-110-v1-外掛的程式結構) 的「程式放在 repo 最上層」、[D-196](../docs/decisions.md#d-196-mindboard-開新-repo開始寫程式時才建)（今天才定）。
- 相關的決定：[D-111](../docs/decisions.md#d-111-v1-的開發順序capture-延後)、[D-117](../docs/decisions.md#d-117-技術債預防機械檢查全自動ai-審查只在關鍵點)、[D-141](../docs/decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)、[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝)。
- 不在本稿處理：使用者 2026-11-09 說三個外掛都設計成可以給其他使用者（家長、學生）用，成熟前不廣泛使用。這和 [D-152](../docs/decisions.md#d-152-教材是針對考試範圍的文件補充筆記另外放) 第 5 點「這個軟體不公開使用」不一致，D-196 的理由也引用了那句。教材分享的版權問題之後另談。

## 1. 查到的事實

### 1-1 官方文件（2026-11-09 讀）

| 事實 | 來源 |
|---|---|
| 上架要求 `README.md`、`LICENSE`、`manifest.json` 在 repo 根目錄；目錄讀預設分支 HEAD 的 manifest；Release 標籤等於 manifest 的版本（x.y.z），附 `main.js`、`manifest.json`、`styles.css` | Obsidian〈Submit your plugin〉 |
| 審查需要能在 GitHub 上看到原始碼 | 同上 |
| repo 的 manifest 只用來判斷最新版本，檔案從 Release 下載 | `obsidianmd/obsidian-releases` README |
| BRAT 給測試者用，從 Release 取檔；沒有寫支援 repo 的子資料夾 | BRAT 開發者指南 |
| Claude Code 開場載入目前資料夾與上面每一層的 CLAUDE.md，子資料夾的碰到檔案才載入 | Claude Code〈memory〉 |
| Claude 的記憶每個 repo 一份，worktree 共用；可用 `autoMemoryDirectory` 改位置 | 同上，部分內容只讀到摘要 |
| Codex 從 Git 根目錄往下找 AGENTS.md，到目前資料夾為止；另有全域檔 | Codex〈AGENTS.md〉 |

**讀不到**：Obsidian 的 Developer policies、Submission requirements 與審查清單（網址回 404 或 Not Found，兩種來源都試過）。所以**審查接不接受從主 repo 匯出、一版一個 commit 的公開 repo，沒有確認**。

### 1-2 實測（2026-11-09，暫存 repo，測完已刪）

| 項目 | 從 `plugins/cards` 開，不用 worktree | 從 `plugins/cards` 開，用 worktree |
|---|---|---|
| 工作目錄 | `plugins/cards` | worktree 根目錄（整個 repo 的副本） |
| worktree 建在哪 | 不適用 | `plugins/cards/.claude/worktrees/` |
| 開場載入的 CLAUDE.md | 根目錄、cards；沒有 capture | 只有根目錄 |
| 根目錄 `.claude/settings.json` | 沒生效 | 生效 |
| 外掛層 `.claude/settings.json` | 生效 | 沒生效 |
| skill | 兩層都有 | 只有根目錄的 |
| 記憶路徑 | 對應 repo 根目錄 | 同一個 |

限制：對話由 app 的 `start_session` 代開，模型 Sonnet 5.5，沒有和手動開的比對；設定只用環境變數驗證，hook 與權限沒有直接測。從根目錄開的行為取自這台電腦既有的 6 個 worktree 對話（工作目錄都是 worktree 根目錄，只有主資料夾有記憶）。

### 1-3 現有專案

- Cards：約 750 個追蹤檔；約 27 個工具與設定檔寫了根目錄路徑（用關鍵字算，`eslint.config.js`、`tools/build.mjs`、`tools/install.ts`、`tools/update-vault.ts`、`tools/backup.ts`、`tools/restore.ts`、`tools/check-docs.ts` 等）；2 個 CI workflow；3 個 tag；2 條未合併的分支。
- Capture：repo 只有 4 個追蹤檔，沒有程式。Mindboard：空資料夾，沒有 repo。
- 197 條決定的索引裡，提到 Capture 或 Mindboard 的有 10 條。

## 2. P1：從零開始的架構

```text
essence/                    開發用的唯一 repo，可以私有
├─ AGENTS.md、CLAUDE.md     跨外掛的底線與文件地圖
├─ .claude/                 權限、hook、skills 全放這裡
├─ docs/                    願景、跨外掛的決定、協作與品質設定
├─ contracts/transcript/    格式規格、格式版本、雙方共用的範例檔
├─ tools/                   檢查、單獨建置測試、匯出發布
└─ plugins/
   └─ capture/、cards/、mindboard/（各自包含）
      ├─ AGENTS.md、CLAUDE.md、manifest.json、versions.json
      ├─ README.md、LICENSE、package.json
      ├─ src/、tests/
      └─ docs/              這個外掛的路線圖與決定，一條決定一個檔
```

- **對話一律從根目錄開**（1-2 的結果）。根目錄 AGENTS.md 寫明：做哪個外掛就先讀它的 AGENTS.md，搜尋只限那個資料夾。外掛層不放 `.claude/`。
- **外掛之間不互相 import**，機械檢查擋住；關聯只走 `contracts/`。共用程式等第二個外掛真的要用才建。
- **文件連結也有方向**：外掛可以連到根目錄的 `docs/`、`contracts/`，不能連進別的外掛。
- **每個外掛都能單獨建置**：平常就把外掛匯出到暫存資料夾建置一次。
- **pre-commit 只檢查改到的外掛**。
- **記憶只放使用者偏好與本機環境**；Codex 或別台機器也需要的寫進 repo。
- **格式帶版本**：使用者分開升級外掛，舊版 Cards 可能遇到新版 Capture 寫的檔案；先發讀的一方，再發寫的一方，讀不懂就停（D-149 的兩段發布）。

### 對外發布

對外一定是每個外掛一個公開 repo：根目錄放不下兩份 manifest，三個外掛的 `1.0.0` 標籤也會互撞。第一個外部測試家庭要裝時才建那個外掛的公開 repo；成熟後才送上架。

發布一版（以 Cards 1.2.0 為例）：

1. 主 repo 改版本號，檢查通過，打標籤 `cards-1.2.0`。
2. 腳本依白名單把檔案複製到公開 repo 的暫存分支，一版一個 commit，並打標籤 `1.2.0`。測試不帶，測試資料可能有教材片段。
3. 公開 repo 的 Actions 建置並建立 Release，附三個檔。
4. Release 備妥才更新預設分支，使用者看不到半成品。

防呆：公開 repo 的最新 commit 不是上次匯出的就停（有人直接改了）；腳本可重跑。

不採用每個 commit 都同步（`git subtree split`）：開發中的程式、commit 訊息與舊 commit 裡的內容都會公開。它留作退路：審查若不接受快照 repo，把資料夾連歷史拆出去，該外掛改在獨立 repo 開發。

## 3. P2：現有專案等第二個外掛開工時才搬

第二個外掛（Capture 或 Mindboard）要開始寫程式時，搬動是它的第一個任務。現在不動：現在實際開發的只有 Cards，搬了得不到任何好處；搬動量到時候也差不多。

搬的時候：

1. 等進行中的分支合併、沒有其他對話在改程式、避開正式版升版。
2. 在丟棄式的複本上演練，`npm run check` 與建置都通過才動真的。
3. 大部分檔案移進 `plugins/cards/`，文件一起移，彼此的相對連結大多不用改。
4. 改約 27 個工具與設定檔的路徑。安裝、更新、備份、還原會碰正式 vault，要實機驗證並做 L2。
5. 共用原則抽到根目錄；Capture 的 `Essence-Capture` repo 改當對外 repo。
6. 開工時再定：GitHub repo 的名稱與公開程度、本機資料夾名稱（改名要連帶搬 Claude 的記憶與對話紀錄）。

## 4. 和不做比較

**① 不做（維持 D-076 補充與 D-196）會怎樣**

- 每個外掛的開發檢查各設定一次、之後各維護一份。開發流程規則常改（D-197 今天才改 quality.md 與 review.md），三份會各自走樣。
- 規則靠文字指向 Cards。Codex 在 Capture 的 repo 裡不會自動讀到；Capture 的對話要手動加入 Cards 資料夾。
- 轉錄格式的規格、範例檔跨 repo，改的時候兩邊各 commit，連結檢查查不到另一邊。
- 通用的 Claude 記憶要複製一份（Capture 現在有 15 個檔案是複製來的）。
- 影響開發，不影響學生與家長。發生在第二個外掛開工之後的每一次流程改動。

**② 做的代價**

| 代價 | 解得了嗎 |
|---|---|
| 搬動：3-1～3-6 | 解得了：演練、實機驗證、L2。沒有試跑過 |
| token 隔離變弱：從根目錄開對話，只能靠根目錄的指示與連結規則 | 部分：結構上擋不住；開工後從讀檔紀錄量，太多才重談 |
| D-196 理由：Cards 常有多個 session 共用資料夾，再加一個外掛，stage 錯檔與分支互撞的機會增加 | 部分：改程式都開 worktree；只改文件的對話仍共用主資料夾 |
| D-196 理由：Mindboard 可能用大型套件，pre-commit、CI、相依檢查綁在一起 | 解得了：各外掛自己的 `package.json`、只檢查改到的；沒有實做過，這台電腦跑 tsc、ESLint 已有記憶體不足的紀錄 |
| 匯出流程要寫 | 解得了：等第一個外部測試家庭才做；沒有跑過 |
| 審查可能不接受快照 repo | 解得了：§2 的退路，最壞是該外掛回到獨立 repo |
| 文件要分「跨外掛」與「單一外掛」，D-141 的一類資訊一份要重新對應 | 解得了：197 條裡多數只和 Cards 有關 |

**③ 更小的做法**

- Capture、Mindboard 進 repo，Cards 留在最上層：不用動 Cards，但工具要同時支援兩種位置，Cards 與共用文件混在一起，之後多半還是要搬。
- 只抽一份共用原則放在 Cards，另兩個 repo 用連結：不動資料夾，但 ① 的工具重複與跨 repo 格式都還在。
- 開工時再決定：D-196 已列出代價（要重談一次，新對話可能先把程式寫在 Cards 裡）。本提案是現在定方向、開工才動手，開工時不用重談。

## 5. Fable 的獨立回答（摘要）

Fable 5.1 xhigh 在另一個對話回答，Claude 給的題目沒有寫結論，但事實是 Claude 整理的。結論相同（一個 repo 開發，白名單匯出到各自的公開 repo，最不建議共用上層資料夾）。採納：外掛各自的文件、文件連結的方向、平常就單獨建置、公開 repo 的 Actions 建置（省掉跨 repo 權杖）、記憶的範圍、格式帶版本。沒採納：決定寫成單一檔案加索引（Cards 佔多數，單檔一樣會很大）。Fable 列的「從根目錄開會削弱隔離」在 1-2 成真，已列入 §4 ②。

## 請 Codex 回應：第一輪（2026-11-09）

這一輪只讀：〈先讀這裡〉、§1～§5；需要時用 `node experiments/tools/decisions-index.mjs D-xxx` 查 D-076、D-110、D-196、D-149，並查 `tools/`、`.githooks/`、`.github/workflows/`、`eslint.config.js`、`tsconfig.json`、`knip.jsonc`。基準 commit：`main` 上加入本檔的 commit（`git log -1 --format=%h -- "Claude Codex Discussion/2026-11-09-one-repo-three-plugins.md"`）。只改文件，不用跑 `npm run check`。

請逐題回答同意或反對，反對附證據（檔案:行、文件或可重現的指令），查不到的直接說：

1. **站在「不做」那一方**：P1 的優勢是否被高估？D-196 的四個理由（結構牴觸、定位獨立、大型套件、多個 session 共用資料夾）有沒有被真正回應？
2. **P2 的時機**：「開工時才搬」和「現在搬」、「不搬」比，有沒有現在不搬就會變貴、或現在應該先做的低成本預備？
3. **Codex 自己的行為**：從根目錄開對話時，子資料夾的 AGENTS.md 會不會在碰到檔案時補讀？有沒有設定能改變找根目錄的方式？§2「根目錄寫一句指過去」夠不夠？
4. **搬動清單漏了什麼**：看實際的工具與設定，尤其是 `install-vault`、`update-vault`、備份還原、`.local/`、舊 tag 的退回、CI、`check-docs` 與 skill 的兩份副本。
5. **發布流程**：§2 的順序與防呆有沒有漏洞？例如標籤、預設分支、重跑、`versions.json`。
