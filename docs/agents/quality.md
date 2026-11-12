# 程式品質：本專案的設定

給 `code-quality` skill 讀（[D-119](../decisions.md#d-119-程式品質的-skill-整併成通用的-code-quality)）。這裡只寫對應與連結，規則本身在連到的地方。

## 角色

| 角色 | 由誰擔任 |
|---|---|
| 規劃者 | Claude 的 Opus 5.5，推理等級 xhigh：任務說明、大的設計、L1 設計回顧（[D-144](../decisions.md#d-144-決策交給-opus-xhighfable-只在解不了的時候)）。重大決策點先寫討論稿和 Codex 討論；解不了才切 Fable 5.1 high。任務說明與決定先和「不做」比較（[D-153](../decisions.md#d-153-每個新決定與新任務先和不做比較)），討論稿請 Codex 專門站在「不做」那一方反駁，理由只能是優勢不明顯或代價解決不了（[D-177](../decisions.md#d-177-先問會不會明顯更好優勢明顯代價解決得了就該做)） |
| 實作者 | Claude 的 Opus 5.5，推理等級 high（[D-131](../decisions.md#d-131-claude-實作codex-在關鍵點查核)、D-140）；例外轉出時是 Codex，任務說明照 `tasks/w3.md` 寫，交回照 code-quality 的「實作交回」檢查（[D-168](../decisions.md#d-168-拿掉-codex-brief請-codex-查核走-code-quality)） |
| 獨立審查者（L2） | 新開的 Codex session（Sol），不能是寫程式的那一個。Codex 不能用時，由 Claude 開子代理（L3），做不到的部分明列 |
| 整合者 | Claude 的 Opus 5.5：L1 對照、核對 L2 的發現、合併 |

成本：檢查不減；能交給自動檢查的就不靠人看。Claude 實作時的 L1 是自己對照規格，不算獨立審查，所以驗收條件要先寫成能用程式判斷的句子。困難的除錯照〈[卡關時的升級](#卡關時的升級)〉。

換模型時（[D-197](../decisions.md#d-197-同一條發現鏈到第-3-代先重整換模型時重驗依舊行為寫的規則) 第 3 點）：上表寫的是目前的版本。常用角色的模型換版、改用別的模型或推理配置時，先改上表，再挑出依舊模型或工具行為寫的規則（上表的分工與它的理由、標「試行」的規則、Obsidian 截圖的工具限制等），有小探針或代表任務能核對的才重驗，結果記在各自的試行紀錄或依據；使用者只決定有證據的修改。臨時升級求援、單次試用不算。Claude 讀到本檔時，自己的模型和上表不同，先提醒使用者。

## 檢查指令

- `npm run check`：型別、ESLint（含模組邊界）、knip、secretlint、本機路徑、skill 副本一致性、文件檢查、測試（[D-117](../decisions.md#d-117-技術債預防機械檢查全自動ai-審查只在關鍵點)）。
- 文件檢查：`node tools/check-docs.ts`，每次 commit 都跑，只改文件的 commit 也跑（[D-141](../decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)、[D-143](../decisions.md#d-143-歸檔原則每類文件都有終點不設字數上限)）。
- 自動執行的地方：`.githooks/pre-commit`、`.github/workflows/check.yml`。pre-commit 每次都跑文件檢查、暫存檔的金鑰掃描（`node tools/secretlint.mjs --staged`；repo 公開，只改文件的 commit 也直接推上 main，[第二次里程碑檢查](<../../Claude Codex Discussion/2026-11-10-milestone-2-review.md>) R4）與本機路徑掃描（`node tools/check-local-paths.ts --staged`，R5：帳號名、iCloud 雲碟、vault 名稱；通用規則不含真實的值，本機規則在執行時從這台電腦取；commit 訊息由 `.githooks/commit-msg` 掃），在程式相關的檔案有變動時再跑完整的 `npm run check`，測試用 dot reporter（`NODE_OPTIONS` 加 `--test-reporter=dot`）：通過的測試只印一個點，失敗的照常印出，exit code 照常傳回；AI 讀 commit 的輸出要花 token，原本約 4.2 萬字（[外掛架構檢查](<../../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)環節 9 的 Q2）。代價是通過的測試印的訊息看不到，需要時自己跑 `npm run check`；手動跑與 CI 不變。只改文件時，測試讀的文件（例如 `syntax.md` 的範例、`decisions.md`）有變動，就只跑寫到那個路徑的測試檔，通過時只印一行（2026-10-29：`b63c1bb` 只改 `syntax.md` 的範例就讓 CI 紅了）。新的測試要讀文件時，在測試裡寫出它的路徑（例如 `new URL('../docs/syntax.md', import.meta.url)`），pre-commit 才找得到。
- 合併進 `main`：改到程式的分支，先 push 分支、等 GitHub Actions 的 Check 是綠燈再合併；Linux 上才壞的問題只有 CI 擋得到。`.githooks/pre-merge-commit` 會查要合併的 commit，沒有紀錄、紅燈、還沒跑完都擋（`gh` 不能用時警告放行）；快轉與有衝突的合併不經過它，要自己記得（[第二次里程碑檢查](<../../Claude Codex Discussion/2026-11-10-milestone-2-review.md>) R2：還原分支沒 push 過就合併，25 個測試在 Linux 失敗）。
- CI 的結果：每個 Claude session 開始時，`.claude/hooks/ci-status.mjs` 會查 `main` 最近一次跑完的 GitHub Actions，沒通過就提醒；看到提醒先用 `gh run view <id> --log-failed` 找原因，能修就修，不能修就告訴使用者。本機是 Windows、CI 是 Linux，只在一邊壞的問題 pre-commit 擋不到（2026-10 曾紅了三天沒人發現，[第一個里程碑的檢查](<../../Claude Codex Discussion/2026-10-27-milestone-1-review.md>) R1）。
- knip 報 `RangeError: Array buffer allocation failed` 是電腦可用的記憶體不夠（它的解析器一次預留 6 GB），不是程式的問題：`npm run knip`（`tools/knip.mjs`）已經自動加上 `KNIP_DISABLE_RAW_TRANSFER=1`，檢查項目不變；直接跑 `npx knip` 時要自己加（2026-10-27 W6 合併時遇到）。
- Codex 審查時：完整的 `npm run check` 要在沙箱外跑。沙箱裡會有 10～11 項環境造成的固定失敗（symlink、改名的 EPERM、git config；W5 第二部分三輪都是這樣）；沒辦法解除沙箱時，回報裡逐項列出失敗的測試，並說明哪些是環境造成的。跑的時候一次等到結束或出錯（設足夠且有上限的等待），不要短間隔反覆查進度：2026-11-04 那次 L2，這種輪詢約佔 Codex 輸入的 43%（[D-171](../decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 7 點，試行）。審查請求的「驗證方式」連到這一點。
- 建置：`npm run build`，`main.js` 只能 require Obsidian 提供的 `obsidian`、`@codemirror/state`、`@codemirror/view`（[D-134](../decisions.md#d-134-學習目標-id-的補上時機與保護) 的編輯器鎖定），不能把另一份 CodeMirror 打包進去（`tools/build.mjs` 會擋）。
- 安裝：`npm run install-vault -- <vault> [--dev]`（[D-149](../decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 4 點，擋法在 `tools/install.ts`）。開發版只裝登錄過的測試 vault：登錄存在主資料夾的 `.local/test-vaults.json`（各 worktree 共用、不進 repo），第一次先 `npm run install-vault -- <測試 vault> --register-test`。裝到測試 vault（含 `--dev`）是在專案根目錄建置、再從根目錄複製（`tools/install.ts` 的 `install` 裡測試 vault 那一段：`build({ root, … })` 之後 `deploy(root, …)`），中間有別的程序寫了 `main.js` 就會裝到那一份；裝完用開發命令結果檔的 `BUILD` 核對是不是這次的建置（[外掛架構檢查](<../../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)環節 9 的 N2：照實記下，不改）。其他 vault 一律當正式使用的：要工作樹乾淨、HEAD 是 `v<版號>` 的 tag、`package.json` 版號相同、DEV 關閉，產物與雜湊存到 `.local/releases/<版號>/`；退回用 `--release <版號>`，現有資料的 `需要版本`、`need` 比那一版新就拒絕。

## 規格來源

- 任務說明：v1 程式在 `tasks/*.md`，試作場在各資料夾的 `TASK.md`。
- 決定：[decisions.md](../decisions.md) 的 D-ID；commit 訊息裡的 `(D-xxx)` 指的就是這裡。
- 資料格式：[syntax.md](../syntax.md)。程式結構與模組邊界：[D-110](../decisions.md#d-110-v1-外掛的程式結構) 與 `eslint.config.js`。

## 高風險範圍（要做 L2）

跨模組的改動、資料格式、排程（FSRS 與紀錄重播）、寫回使用者筆記的函式。

請 Codex 查核時（不只 L2），寫明查什麼、讀哪些檔案、基準 commit 與驗收標準；L2 照 code-quality 的 `review.md`「審查請求範本」寫。

每一輪（第一輪、再審、討論稿的下一輪）都請使用者新開一個 Codex 對話：交給使用者貼的文字第一行寫「新開一個 Codex 對話，推理等級：<等級>」。沿用同一個對話時，上下文越來越長，每次呼叫都要重讀，推理等級也會帶進下一輪；2026-11-03 量到「入口與目錄第一批」沿用一個對話做 L2 七輪加討論三輪，那段時間 Codex 週額度上升 21 個百分點（表內各段合計 15，含同時段的其他對話；[D-171](../decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 1 點）。

再審與討論稿的下一輪，那一節的開頭寫「這一輪只讀：本節、〈審查對象〉、上一輪的〈Claude 回應〉」（討論稿寫〈先讀這裡〉與這一輪的那一節），另外列出還沒結的發現 ID，以及這一輪可能碰到的已結發現與它們的驗收證據在哪一節；前幾輪預設不讀，需要時審查者照標題或發現 ID 只查相關的段落。新開的對話不記得前幾輪，沒寫就容易整份從頭讀（[D-171](../decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 2 點）。

同一條發現鏈（[D-200](../decisions.md#d-200-l2-的發現鏈待驗問題連兩輪沒驗先讀宿主程式整類修過仍失守就換前提)，改寫 D-197 第 1 點）：照 code-quality 的 `review.md`〈修正後收尾〉，整類修過仍同類失守就換前提；修法依賴的宿主行為連兩輪沒驗，先讀宿主程式或做探針。本專案的宿主是 Obsidian：讀法照〈[Obsidian 相容性檢查](#obsidian-相容性檢查)〉第一層的 `obsidian-<版本>.asar`（只讀不執行），探針用 Windows 版 Obsidian 的開發命令；驗不了照〈[卡關時的升級](#卡關時的升級)〉。代數的標法照 `review.md`〈審查請求範本〉；第四輪交給使用者、工作留在原對話照舊（D-171 第 3、7 點）。

## 測試分兩類

[D-195](../decisions.md#d-195-測試分兩類改不回來的做足其餘延後但不漏)。問「做錯了，之後改版改得回來嗎？」，一項一項分，同一件任務可以兩類並存：

- **先看正常流程**：會擋住或弄錯正常使用的（例如一般大小的卡組卡住複習、日常作答被擋），照原本的驗收做完，不延後。之後才看少見的情況。
- **第 1 類**：上面的高風險範圍與下面的格式查核涵蓋的（寫進使用者檔案的格式、ID 與複習紀錄、排程與紀錄重播、更新與備份還原、舊版外掛讀得到的東西），以及會默默弄壞紀錄、讓孩子看到沒審過的卡；合併前做足。說不準的歸這一類。
  - 例：AI 製卡中斷後「不會重複或重用 ID、已寫的草稿保留、仍要按啟用」是第 1 類；重開後自動接著存的方便與額外的恢復情況是第 2 類。
  - 例：只在 iPhone 看得到的排版截斷是第 2 類；同步後少了作答、舊版讀到不該出的卡是第 1 類。少見的大卡組第一次顯示稍慢、操作與存檔都正常是第 2 類；逾時會造成重複寫入或丟紀錄是第 1 類。
- **第 2 類**：其餘少數例外狀況的測試、為很少見的情況多做的功能；延後，寫成[技術債表](../backlog.md#技術債)開頭「補測：」或「補做：」的一列。延後功能時，開放的入口要能走完一條安全的路徑，否則合併前先關住入口或做完那條路徑。
- **L2 的發現不在這裡分**：L2 找到的真實缺陷照 [D-171](../decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 處理（發生機率極低的照 [D-202](../decisions.md#d-202-l2-的發現先估發生機率極低的記成已知的限制) 記成已知的限制），第四輪還擋合併時交使用者決定，不由實作者自己改列第 2 類。
- **任務說明**：規劃者在「和不做比較」或範圍裡寫哪些是第 2 類，每一項寫中斷或出錯時怎麼恢復；`## 結果`（標題以「結果」開頭的二級標題，底下可以有三級小節）的段落或清單項目開頭有恰好一行「延後的測試：」，寫「無」或用「」括住技術債表的列名（例如「補測：存到一半中斷」），開工時先寫「延後的測試：（實作後填）」。
- **狀態行**：任務結束時寫「狀態：已結案」「已完成」或「已合併」，後面接括號、冒號、逗號或「｜」再寫備註；部分完成寫在備註，不寫「已完成第一部分」以外的結束詞（例如「驗收通過」，文件檢查認不出來）。文件檢查看到結束的狀態就檢查〈結果〉；commit 時列名要對得到技術債表的列。
- **沒有任務說明的改動**：小修、試作場、L2 時才決定延後的項目，整合者在交回或合併前看有沒有延後的測試，有就在同一批改動加進技術債表。
- **補完與留到第二階段**：補完照技術債的做法刪掉那一列、roadmap 的已完成寫一句；使用者同意留到第二階段時，先在 [backlog 的第二階段清單](../backlog.md#第二階段想做的事)寫下來源、完成條件與使用者同意的日期，再從技術債表刪掉。

## 開工前的格式查核

[D-140](../decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點。任務說明會改出題語法的解析、複習紀錄的欄位，或其他寫進使用者檔案的格式時：

1. 規劃者寫好任務說明後，另寫查核請求 `tasks/<任務>-format-review.md`：只列格式那幾節、要對照的決定與 syntax.md 的章節、基準 commit；任務說明的開工條件寫明哪幾節要等查核。
2. 新開的 Codex session（推理等級：高）查：和已有的決定、syntax.md 有沒有矛盾；舊的資料與還沒更新的舊版外掛讀不讀得到；邊界情況有沒有寫清楚、能不能寫成測試。只回報，寫在 `Claude Codex Discussion/`。
3. Claude 核對回報、改任務說明，再實作那幾節；任務的其他部分不用等。合併前的 L2 照舊。

## 卡關時的升級

[D-140](../decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 3 點、[D-144](../decisions.md#d-144-決策交給-opus-xhighfable-只在解不了的時候)。卡關的 bug 與重大決策走同一條路線。bug 是照 code-quality 的除錯做法，列出的假設都被推翻，或做不出能重現的指令；重大決策是 D-140 第 2 點那幾類（資料格式、模組邊界、要新增決定、製卡規則或學習地圖的設計）。依序：

1. **Opus xhigh**：bug 從除錯做法的第 1 步再做一次；決策寫出問題、選項與各自的代價。規劃型的對話一開始就開 xhigh，中途不切。
2. **新開的 Codex session**：bug 從頭查（Sol，推理等級：xhigh），只給重現指令（做不出來時給症狀與出現的條件）、錯誤訊息、相關檔案與基準 commit，**不給 Claude 的假設與推論**，Codex 只回報；決策把第 1 步寫成 `Claude Codex Discussion/` 的討論稿（D-106），Codex 回應，雙方一致後交使用者確認。
3. **Fable 5.1 high，或 Codex 的 Astra**（先開 Low 或 Medium）：前兩步都解不了，或兩家不一致又說不出誰對，才用；附交接說明，寫目標、試過的做法、各自為什麼不對、目前的證據。

換模型與轉貼要使用者做，所以每升一級都先跟使用者說一聲。找到根因後，回到除錯做法的第 5 步，由 Opus 修；決策定了就寫成 D-ID 或任務說明。

## 本專案的做法

- 寫回筆記的函式，往返與冪等測試登錄進共用的範例清單：`tests/deck.test.ts` 的 `deckCases`。
- 只在 Node 驗過的檔案存取，接上 Obsidian 前要在 Windows 版 Obsidian 對照一次（D-110）。
- 規格的平台事實表（code-quality〈寫規格〉，[第二次里程碑檢查](<../../Claude Codex Discussion/2026-11-10-milestone-2-review.md>) R7）在本專案常見的列：iPhone（例如 `stack` 沒有位置，[D-173](../decisions.md#d-173-iphone-的-stack-沒有位置沒接住的錯誤一律收)）、CI 的 Linux、Obsidian 的渲染器（和 markdown-it 不同）、Obsidian 的檔案操作與計時器（例如底層的操作不會因為外掛的上限停下）。探針用 Windows 版 Obsidian 的開發命令；iPhone 的項目集中成一次實機測試。
- 測試只用 syntax.md 的例子或自編的內容。
- Obsidian 畫面的截圖用開發版的 `ui` 命令（Electron 的 `capturePage()`），不要用 computer-use：它會截到舊畫面，還會讓 Obsidian 被當成隱藏而停止繪製，計時器和 `requestAnimationFrame` 也跟著變慢（W6 的 Windows 實測）。
- 測試不改全域的 `node:fs` 等 Node 內建模組：Node 自己的實作也會呼叫它們，換掉之後結果會隨 Node 的版本改變。要模擬失敗，就把替身直接交給要測的函式（例如 `createNodeFiles` 的 `seams`）。
- 產品程式（`src/`，開發命令除外）裡的 `catch` 與 `.catch()`，不是交給錯誤紀錄（[D-155](../decisions.md#d-155-正式版的錯誤紀錄)）就要在旁邊寫一句為什麼不用，例如「讀不到是預期的，state 會重試」「已經經過 onError 記下」；ESLint 的 `no-console` 擋得到直接印 console，擋不到空的 `catch` 與吞掉的拒絕，L2 審查照這條看。
- 維修時怎麼讀錯誤紀錄（[D-155](../decisions.md#d-155-正式版的錯誤紀錄)、[D-160](../decisions.md#d-160-學生在複習畫面回報問題點一個選項記進錯誤紀錄)）：使用者回報問題，或問有沒有學生的回報時，先讀 vault 的 `Essence Cards/紀錄/錯誤/` 那段時間的行（格式見 [syntax.md §9](../syntax.md#9-錯誤紀錄)；學生的回報是 `where: "report"`，用 `lt` 在卡組裡找到那一行）。用 `build` 找是哪一版；要把 `stack` 對回原始碼時用 `npm run locate -- <版號> <行:欄>`（只有正式安裝存過對照表的版本能用）；iPhone 的 `stack` 只有名稱、沒有行與欄，`where: "uncaught"` 的可能是別的外掛的錯（[D-173](../decisions.md#d-173-iphone-的-stack-沒有位置沒接住的錯誤一律收)）。紀錄可能因同步、上限或寫入失敗而缺漏，沒有那一行不代表沒發生；寫進 repo 的只寫摘要（D-003）。

- 同一件工作留在原對話，靠自動壓縮，不例行請使用者開新對話；壓縮後反覆找不到驗收依據，或工作已換成可獨立交付的一段，才換（[D-171](../decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型) 第 7 點）。
- 待驗的條件或排除某個修法的原因，從 commit、測試、報告找不回來時，在任務的進度段或審查回覆留一句：驗過哪個測試或 commit、還剩哪個條件，必要時附失敗原因。找得回來就不用寫。
- 量 Claude 與 Codex 的 token 用量：方法與每次的結果記在 [token-usage.md](token-usage.md)（D-171 第 6 點）。

## 技術債清單

[backlog 的「技術債」一節](../backlog.md#技術債)。

L2 的發現發生機率極低、這次不修的，記在 [backlog 的「已知的限制」一節](../backlog.md#已知的限制)（[D-202](../decisions.md#d-202-l2-的發現先估發生機率極低的記成已知的限制)）。

## Obsidian 相容性檢查

[D-138](../decisions.md#d-138-obsidian-出新的次版本時做一次相容性檢查)：Obsidian 出新的次版本（例如 1.14 → 1.15）時做一次，由 AI 做。

- **目前驗證過的版本**：Windows 1.15.0（2026-11-03，[相容性檢查](../../tasks/obsidian-1.15-compat.md)；npm 還沒有 1.15 的型別檔，比對列在[技術債](../backlog.md#技術債)）；iPhone 1.15.0（2026-11-03，[iPhone 測試](../../tasks/iphone-test-2026-11.md)）。
- **怎麼發現新版**：開發命令的結果檔會記 Obsidian 的版本（`obsidian` 欄位），AI 在 Windows 版 Obsidian 跑開發命令時看到比上面新的次版本就做；每個里程碑結束時也查一次 Obsidian 的改版說明。
- **三層**：
  1. 比對新舊版 `obsidian` 套件的 `obsidian.d.ts` 與 `peerDependencies`（CodeMirror 的版本）：本專案用到的 API 有沒有改、標成不建議使用；CodeMirror 版本變了就把 `package.json` 的開發相依改成一樣，跑 `npm run check`。npm 常比 app 晚：還沒有新版時，先讀 `%APPDATA%\obsidian\obsidian-<版本>.asar` 裡的 `app.js`（只讀不執行），查用到的匯出還在、用 CodeMirror 新舊版的差異推定版本，型別檔的比對記進技術債；安裝資料夾的 `resources\obsidian.asar` 是安裝當時的舊版，不能當上一版比。
  2. 在 Windows 版 Obsidian 用開發版重跑 `files`、`compare`、`lock`、`save`、`today`、`answer`、`events`、`a3check`（`npm run install-vault -- <測試 vault> --dev`），結果和上一次比。`events` 比對[外掛架構討論稿環節 1 的 A3 表](<../../Claude Codex Discussion/2026-10-26-plugin-architecture.md#實機記錄t3-與-a32026-10-27opus-55>)。`a3check` 的每個情境都要 `ok`；`skipped` 列的是未測的子項，不算通過，要和上一次相同；`cleanupLeft` 要是空的（iCloud 偶爾會把剛刪的測試卡組放回來）。開發命令的結果拿來當驗收（這一層與任務的完成條件）時都一樣：必要的操作沒做到不算通過，未驗的子項另外列；「完成」的通知或結果檔存在不算通過。`lock`、`save` 會假通過的情境已修（`b9309ca`，外掛架構討論稿環節 9 結論第 5 條）：`save` 的 `checks.clicked` 也要是 true。
  3. 讀改版說明裡和這幾點有關的條目：編輯器與 CodeMirror、Markdown 解析與閱讀模式（清單、區塊 ID）、檔案與 vault 的事件、iOS 與同步；每一點寫一句結論。
- **結果**：寫進 roadmap 的已完成，通過就更新上面的版本；有不相容先寫失敗測試再修（高風險範圍做 L2）。iPhone 的部分記進下一次 iPhone 實機測試的清單。

## 里程碑

見 [roadmap](../roadmap.md)。

1. W1～W6 打通「手寫卡組 → iPhone 複習 → 自評 → 排程」（[D-111](../decisions.md#d-111-v1-的開發順序capture-延後)），2026-10-27 達成；[檢查](<../../Claude Codex Discussion/2026-10-27-milestone-1-review.md>)。
2. 上線前：第一次升正式版前（`0.4.0`，考試範圍、小考、點選填空、AI 製卡最小版、設定頁、補紀錄缺口、外掛內還原），2026-11-10 檢查、2026-11-12 裝到正式 vault；[檢查](<../../Claude Codex Discussion/2026-11-10-milestone-2-review.md>)。
3. 還沒定。💡 v1 功能做完、開始真實使用驗證之前（roadmap 路線圖 v1 的完成條件）。

## 共用的 skill

`.claude/skills/` 與 `.agents/skills/` 裡的 code-quality、essence-decision、essence-discuss，兩份內容必須相同，由 `tools/check-skill-mirror.ts` 檢查；改其中一份時，另一份一起改。
