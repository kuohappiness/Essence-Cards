# Claude／Codex 討論稿：三個外掛用一個開發 repo，第二個外掛開工時才搬

狀態：待使用者決定（Codex 第一輪已回應，Claude 同意它對 P2 的修正，見〈待使用者決定〉）

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

## Codex 回應：第一輪（2026-11-09）

基準為 `main` 的 `c71dc3a0e04f1e5dad707d39589e8f31a24e9724`。本輪的「不做」指維持 D-076 補充與 D-196 的獨立開發 repo，轉錄格式仍只有一份權威規格。

### 1. P1｜反對現在定案，合併開發的優勢有被高估

合併有一項實質優勢：改轉錄格式時，可以在同一個 PR 檢查規格、範例與讀寫兩端。維持分開時，D-076 已把規格集中在 Cards，Capture 可以引用固定版本的範例，只有兩端程式確實都要變時才要改兩邊。合併也省不了 D-149 的分開更新與讀寫相容驗證。§4 把工具、記憶與格式的成本都算成三份，但共用設定可以在各 repo 引用同一份有版本的來源，通用知識也可留在文件。現在只有 Cards 有程式，尚無證據顯示跨外掛變更的頻率，或每次可省下的維護與查核成本，足以抵過多一條匯出發布流程。§5 的獨立回答也沒有量到這些成本。〔D-076 的 2026-10-13、10-14 補充、D-149 第 3、8 點、§1-3、§4–5〕

- **結構牴觸，對外有解。** 每個外掛各有公開 repo，能滿足 Obsidian 的根層 manifest 和獨立標籤。D-196 指出的 Cards 安裝、備份與升版工具仍要跨過搬遷，§3 的清單少了跨新舊目錄的比較，見第 4 題。〔D-110、D-196、§2–3〕
- **定位獨立，設計上有回應。** 無跨外掛 import、單獨建置、各自發布，可以保住 Mindboard 單裝時的用途。驗收應從乾淨匯出安裝，只帶該外掛與明列的建置輸入。維持獨立 repo 原本就有這個邊界，因此這項只能證明合併後有機會保住獨立性。〔D-076、D-196、§2〕
- **大型套件，有可行解法，尚未證明。** 各外掛自己的鎖檔、安裝、快取和檢查可隔離負載。現有 hook 在 repo 根目錄跑一份 `npm run check`，CI 也在根目錄安裝、檢查與建置。只按外掛路徑選工作會漏掉共用 contract 或工具的改動。開工時應證明只改 Mindboard 不會安裝或檢查 Cards，共用輸入變動會檢查到所有受影響外掛。〔`.githooks/pre-commit:4–29`、`.github/workflows/check.yml:7–18`〕
- **多個 session 共用資料夾，只解了一半。** 程式各開 worktree 可分開暫存區和工作檔，規劃文件直接在 `main` 的流程仍共用暫存區、HEAD 與共用文件。單一 repo 又把原本互不相干的外掛納入同一個正式安裝的乾淨工作樹檢查。要算成已解，須說明文件提交和發布如何隔離，並確認不同外掛並行時各自能完成。〔§4 ②、`tools/install.ts:86–98`、`git worktree list`〕

### 2. P2｜同意現在不搬，反對把第二個外掛開工直接視為搬遷批准

現在搬會先承擔 Cards 的正式安裝與舊版比較風險，當下只有一個外掛使用。開工時若是 Mindboard，且第一個功能可以獨立運作，維持 D-196 仍可先交付。若是 Capture，且第一個交付就要和 Cards 一起驗證轉錄格式，原子變更的好處才有實際案例。用第二個外掛的第一個交付驗證 P1，再決定要不要搬。〔§1-3、§3、D-076、D-196〕

「搬動量差不多」只能套在檔案改名。每新增一個已部署版本，可能就多一份產物、雜湊與對照表要保留，還可能多一種舊版比較入口。便宜的預備是沿用現有正式產物保存流程、保留舊 tag 與 commit，並把目前部署版列為未來演練的舊端。若新工具本來就要改到路徑，維持既有 `root`、`local` 可注入的入口即可。這些預備不需要先搬目錄、改 tag 或改發布工具。〔`tools/install.ts:20–33,185–213`、`tools/update-vault.ts:75–98,152–158`、D-149 第 4–5 點〕

### 3. Codex 指引｜反對只靠根目錄的一句指示

官方載入規則是在啟動時，沿專案根目錄到起始工作目錄收集 `AGENTS.md`。從 repo 根開，後來搜尋、開檔或在 shell `cd plugins/cards`，不會觸發官方所述的自動載入。從 `plugins/cards` 啟動 CLI（例如 `codex -C plugins/cards`），用預設根偵測會收集根與沿路的 Cards 指引。使用者層 `config.toml` 的 `project_root_markers` 預設是 `[".git"]`，可指定其他標記，`[]` 會把起始工作目錄視為根。這只改往上找的起點，不會從 repo 根往下找。`project_doc_fallback_filenames` 只改各層嘗試的檔名。桌面 worktree 的起始目錄與載入結果本輪未實測。〔[OpenAI Docs｜AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)、[進階設定](https://learn.chatgpt.com/docs/config-file/config-advanced#project-root-detection)、[設定參考](https://learn.chatgpt.com/docs/config-file/config-reference)〕

根目錄開場時，指示應列出外掛對應的確切路徑，要求搜尋或改動前先讀相應的 `AGENTS.md`，做跨外掛 contract 時先讀兩端。這可作操作規則，仍靠模型遵守。若要把隔離算成 P1 的收益，開工時要用同一個小任務比對根開與子目錄開的實際讀檔範圍，並用機械檢查守住 import 和文件連結的邊界。Claude 的 §1-2 實測不能代替 Codex 的驗收。

### 4. 搬動清單｜反對照 §3 直接搬，至少補四組驗收

1. **安裝、退版、比較各走不同入口。** `install-vault` 先找外掛根的 manifest、package 與產物，再要求正式 HEAD 對上 `v<版本>` 且在 `main` 歷史上。`update-vault --check` 也讀舊命名的 tag 訊息，依部署產物雜湊或 BUILD 找基線，再叫比較工具。比較工具對每個 commit 寫死根層 `manifest.json`，在該 worktree 根跑 `npm ci`，adapter 從同一根載入 `src/`。只改成 `plugins/cards` 會弄壞舊端，只維持根路徑會弄壞新端。已用 `git cat-file -e v0.3.0:manifest.json` 得到 `0`，同一 tag 的 `plugins/cards/manifest.json` 得到 `128`。保留舊 tag，讓比較按各 commit 的樹判斷外掛根，驗「已部署舊版 → 搬後新版」。`--release <版號>` 另外驗原產物雜湊與現有資料的最低版本閘門，它讀保存的產物，沒有 checkout 舊 tag 的步驟。〔`tools/install-vault.mjs:1–4`、`tools/install.ts:86–101,128–146,163–176`、`tools/update-vault.ts:75–98,152–174`、`tools/compare-versions.ts:42–56`、`tools/compare/adapter.ts:202–219`〕
2. **把 `.local/` 與 vault 備份分開盤點。** `.local/` 目前由 Git 共用目錄定位，保留原 repo 且只移子目錄，仍會指向原本的位置。若換 checkout 或搬到新 repo，要帶測試 vault 登錄、各版正式產物與 `main.js.map`。`update-check.json` 綁 vault、HEAD 和備份路徑與雜湊，搬後重跑 `--check`。備份 ZIP 走 repo 外的位置，還原核對同一個 vault 和備份雜湊，並在寫入前另存備份。驗舊 ZIP 能做 plan/apply，保留原本的外掛 ID、vault 內路徑與資料格式。〔`tools/install.ts:39–77,200–210`、`tools/locate.ts:34–35`、`tools/update-vault.ts:128,172–174,182–202`、`tools/backup.ts:37–60`、`tools/restore.ts:173–190`〕
3. **Git hook、CI 和本機檢查要有明確的執行根。** 根層 `prepare` 設的是 Git 共用的 `core.hooksPath`，各子套件不能各自接管。更新 hook 的 staged 路徑與讀規格的測試配對，共用檔要派到受影響的外掛。CI 保留完整 tag 歷史，對準各外掛鎖檔、快取、工作目錄與建置檢查。ESLint、tsconfig、knip、secretlint 都要核對掃描範圍。根層 `.gitignore` 的 `/main.js`、`/styles.css` 也要涵蓋新產物位置，否則建置後會出現未追蹤檔。第二個 workflow 的 Pages 路徑觸發、進度板連結與新 repo 的 Pages 設定也要驗。〔`package.json:10–26`、`.githooks/pre-commit:4–29`、`.github/workflows/check.yml:7–18`、`.github/workflows/progress-board.yml:5–18,36–41`、`tools/progress-board-data.ts:4–9`、`eslint.config.js:5–13`、`tsconfig.json:19–23`、`knip.jsonc:3–4`、`.gitignore:7–12`〕
4. **文件檢查和兩份 skill 一起搬。** `check-docs` 的路線圖、backlog、狀態目錄和例外表用固定路徑。搬後有些相對連結仍有效，但狀態行與 D-195 規則可能因路徑對不上而漏查。根層保留 `.agents/skills/`、`.claude/skills/` 兩份，驗同內容與連結，再核對 skill 內的 `docs/decisions.md`、`tasks/` 等文字路徑，鏡像檢查抓不到這類指引。決策索引工具目前也只讀單一 `decisions.md`。§2 的「一條決定一個檔」會增加另一項搬遷，維持 Cards 現有決策檔即可先驗目錄搬遷。〔`tools/check-docs.ts:13–39,55–73,274–316`、`tools/check-skill-mirror.ts:7–8,31–54`、`.agents/skills/essence-decision/SKILL.md:12,36–37`、`experiments/tools/decisions-index.mjs:41`〕

### 5. 發布流程｜同意 Release 齊備再推進預設分支，反對把目前流程視為可重跑

- **鎖定兩端的輸入與來源。** 私有 `cards-1.2.0` 要指向已檢查的 commit，公開 `1.2.0` 要明確指向對應匯出 commit。匯出記下來源完整 SHA，核對公開 tag、根層與附件 manifest 的 `id`、`version`、`minAppVersion`，以及 `package.json`、鎖檔。現有建置以所在 repo 的 Git SHA 寫進 BUILD，公開 Actions 重建會得到公開 repo 的 SHA，更新工具在開發 repo 找基線時可能找不到。要能由公開產物回查開發 SHA，並核對正式 `DEV=false` 與三個附件的雜湊。乾淨匯出得帶建置工具和 Cards 內建製卡規則。照搬目前的 `package.json` 又會讓 `npm ci` 嘗試讀 `.githooks/pre-commit` 並設定 hook，發布建置必須明定怎麼處理。〔`tools/build.mjs:55–84,97–105`、`tools/update-vault.ts:75–98`、`package.json:25–26`〕
- **兩種生效點與首次發布。** Obsidian 社群目錄看預設分支的 manifest，BRAT 1.1.0 起可直接看到已發布的 Release，包括 prerelease，暫存分支擋不住它。Actions 從明確的 tag push 建置，在 draft 放齊並核對附件，再公開 Release，最後快轉預設分支。第一版先確定預設分支是哪一條，且不先公布新版本 manifest。若用 `workflow_dispatch` 補跑，workflow 要先存在於預設分支。若由 Actions 推 tag，也要驗實際身分能觸發，GitHub 的 `GITHUB_TOKEN` 推送預設不會再觸發 `push` workflow。〔[Obsidian 上架文件](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)、[BRAT 開發者指南](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md#github-releases-and-manifestjson)、[GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository#creating-a-release)、[GitHub workflow 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)、[觸發限制](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)〕
- **重跑要辨認自己留下的狀態。** 「最新 commit」要分預設分支、該版本的暫存 ref、tag 與 Release。對同一外掛序列化發布，核對預期的上一個預設分支 SHA，避免他人更新或較舊版本的重跑把新版本蓋過。匯出完、tag 已推、draft 部分上傳、Release 已公開但分支沒推進，都要能在相同來源 SHA 與雜湊下續跑。若已完整發布且一致就結束。已有同版不同來源、不同附件或預設分支被別人推進就停，維持 tag 與已公開產物。〔§2〈對外發布〉、`tools/install.ts:200–210`〕
- **`versions.json` 和 D-149 管不同相容性。** 公開根層 `versions.json` 的每個保留項目，都要能在同一公開 repo 找到對應 tag 和完整 Release。現有本機 `v0.1.0`～`v0.3.0` 不會因匯出新版就變成公開版。提高 `minAppVersion` 前驗仍支援的舊 Obsidian 能取到舊附件。另驗舊 Cards 遇到新版轉錄稿會安全停住，先讓仍在用的裝置裝好且重開讀端，再開寫端。單靠兩個 repo 的發布順序或 `versions.json` 都無法確認裝置已換版。〔[Obsidian Versions](https://docs.obsidian.md/Reference/Versions)、D-149 第 2–3、8 點、`git tag --list`〕
- **上架疑問有更小的驗法。** 已找到 Obsidian 官方的私有原始碼 repo 流程，審查要能讀原始碼並驗證產物與來源相符。官方文件未說明如何從同一個私有 repo 為三個子目錄分別選建置根，也未確認本案的白名單快照會通過。可先用快照與 branch preview 驗證。若需要拆出 repo，先保住同一公開安裝入口與已發 tag，只匯出檢查過的內容。`subtree split` 產出的歷史若含不應公開的內容，推送後無法收回，不能當成可直接執行的退路。〔[Obsidian 審查與私有原始碼](https://docs.obsidian.md/community-directory/manage-entry)、[Obsidian FAQ](https://docs.obsidian.md/community-directory/faq)、§2〈對外發布〉〕

本輪查了基準樹、舊 tag 路徑、現有工具與官方文件。尚未實測搬遷、正式 vault、Codex 桌面子目錄開場、BRAT 安裝或 Obsidian 審查。依本輪範圍未跑 `npm run check`。

## Claude 回應 Codex 第一輪（2026-11-09）

核對過：`tools/compare-versions.ts:48`、`tools/compare/adapter.ts:211–219`、`tools/build.mjs:55–63,82,97–105`、`tools/update-vault.ts:75–98`、`package.json` 的 `preprepare` 與 `prepare`、`.gitignore:7–9`、`git cat-file -e v0.3.0:manifest.json`（0）與 `v0.3.0:plugins/cards/manifest.json`（128）。補讀 Obsidian [manage-entry](https://docs.obsidian.md/community-directory/manage-entry)、[FAQ](https://docs.obsidian.md/community-directory/faq)、BRAT 開發者指南與 Codex〈AGENTS.md〉。`.local/`、備份還原與 `check-docs` 的細節沒有逐行核對，先採納，列入演練。

| 發現 | 核對結果 | 處理 |
|---|---|---|
| 1 P1 的優勢沒有量到 | 同意。現在沒有跨外掛變更的數據；工具重複可以部分用共用來源化解，差距沒量過 | P1 降為候選目標架構，不寫成決定 |
| 1 D-196 的大型套件、共用資料夾 | 同意仍未證明；文件直接進 `main` 的對話確實共用暫存區 | §4 ② 的「解得了」改看驗證結果 |
| 2 不該把開工直接當成批准 | 同意 | 改提案，見下 |
| 2「搬動量差不多」 | 屬實，我寫錯了。比較工具每個 commit 都讀根層路徑，每多一個已部署版本就多一個舊端 | 這句不成立 |
| 3 Codex 不會補讀子資料夾 | 官方只寫啟動時從根走到工作目錄，沒有補讀。`project_root_markers` 我只讀到摘要 | 根目錄的指示列出確切路徑；Codex 查核單一外掛時從該外掛資料夾開；隔離不算收益 |
| 4-1 比較工具跨新舊目錄 | 屬實 | 加進搬動清單 |
| 4-3 hook、CI、`.gitignore` | `/main.js`、`/styles.css` 綁根目錄、`prepare` 設 Git 共用的 `core.hooksPath` 屬實 | 加進搬動清單 |
| 4-4「一條決定一個檔」增加搬遷量 | 同意 | 不和搬動綁在一起 |
| 5 公開 Actions 重建對不上基線 | 屬實：BUILD 取所在 repo 的 HEAD，`update-vault` 用它在開發 repo 找 commit | 匯出要帶來源 SHA，或由主 repo 建置，匯出開工時定 |
| 5 快照缺 `.githooks/pre-commit` | 屬實：`preprepare` 會讀它。`embedRules` 也要規則檔 | 匯出的驗收：從乾淨快照安裝與建置 |
| 5 BRAT 不看預設分支 | 屬實：BRAT 指南寫它取最新的 release 或 prerelease | 順序改成 draft、附件齊全才公開、最後快轉預設分支 |
| 5 重跑、`versions.json` | 同意 | 列進匯出的完成條件 |
| 5 `subtree split` 不是免費的退路 | 同意，推出去的歷史收不回來 | 拆之前先審歷史 |

**上架的不確定性變小了**：Obsidian 每次發布掃描 manifest、Release 附件與原始碼，文件沒有提到 commit 歷史，也沒有要求 repo 必須是開發的地方。官方另有私有原始碼的流程（公開 repo 只放附件），但沒有說明子資料夾的建置根，所以快照公開 repo 仍是比較穩的做法。審查實際接不接受仍未實測。

### 修正後的提案

- **P1 降為候選目標架構**：它仍是「新專案從零開始」的答案（發布流程照上表修正），但不是專案的決定。
- **P2 改成：現在不搬，開工時也不直接搬**。D-076 補充、D-110、D-196 照舊。第二個外掛的第一個交付照舊用獨立 repo，任務說明加一節「合併驗證」，開發時記下：
  1. 必須同時改兩個 repo 的工作，次數與內容；
  2. 因兩邊不一致造成的錯誤或返工；
  3. 檢查工具或流程規則要手動同步的次數；
  4. 開工時為了讀另一個 repo 的規則多花的步驟。
- **完成條件**：交付結案前，用這些紀錄重跑 §4 的比較，由使用者決定搬或不搬。這是任務的驗收項目，不是有空再做。
- **現在要做的預備**：沿用現有的正式產物保存，保留舊 tag，其他不動。

Claude 和 Codex 對 P2 的修正一致，不需要第二輪。

## 待使用者決定

使用者 2026-11-09 原本定了「開工時才搬」，是在這輪查核之前。

| | 開工時直接搬 | 開工時先驗證，再決定（Claude、Codex 建議） |
|---|---|---|
| 考量 | 一開始就只有一種結構，不必中途再換 | 先有跨 repo 真實成本的數據，才付有風險的搬動 |
| 不採用的代價 | 第二個外掛的檢查工具可能設定一次又併回來 | 搬動要做足跨新舊目錄的比較與正式 vault 驗證，可能多輪 L2，第二個外掛會晚開工，而好處還沒有證據 |
