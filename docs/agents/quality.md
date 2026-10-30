# 程式品質：本專案的設定

給 `code-quality` skill 讀（[D-119](../decisions.md#d-119-程式品質的-skill-整併成通用的-code-quality)）。這裡只寫對應與連結，規則本身在連到的地方。

## 角色

| 角色 | 由誰擔任 |
|---|---|
| 規劃者 | Claude 的 Opus，推理等級 xhigh：任務說明、大的設計、L1 設計回顧（[D-144](../decisions.md#d-144-決策交給-opus-xhighfable-只在解不了的時候)）。重大決策點先寫討論稿和 Codex 討論；解不了才切 Fable 5.1 high。任務說明與決定先和「不做」比較（[D-153](../decisions.md#d-153-每個新決定與新任務先和不做比較)），討論稿請 Codex 專門站在「不做」那一方反駁 |
| 實作者 | Claude 的 Opus，推理等級 high（[D-131](../decisions.md#d-131-claude-實作codex-在關鍵點查核)、D-140）；例外轉出時是 Codex |
| 獨立審查者（L2） | 新開的 Codex session，不能是寫程式的那一個。Codex 不能用時，由 Claude 開子代理（L3），做不到的部分明列 |
| 整合者 | Claude 的 Opus：L1 對照、核對 L2 的發現、合併 |

成本：檢查不減；能交給自動檢查的就不靠人看。Claude 實作時的 L1 是自己對照規格，不算獨立審查，所以驗收條件要先寫成能用程式判斷的句子。困難的除錯照〈[卡關時的升級](#卡關時的升級)〉。

## 檢查指令

- `npm run check`：型別、ESLint（含模組邊界）、knip、secretlint、skill 副本一致性、文件檢查、測試（[D-117](../decisions.md#d-117-技術債預防機械檢查全自動ai-審查只在關鍵點)）。
- 文件檢查：`node tools/check-docs.ts`，每次 commit 都跑，只改文件的 commit 也跑（[D-141](../decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)、[D-143](../decisions.md#d-143-歸檔原則每類文件都有終點不設字數上限)）。
- 自動執行的地方：`.githooks/pre-commit`、`.github/workflows/check.yml`。pre-commit 在程式相關的檔案有變動時跑完整的 `npm run check`，測試用 dot reporter（`NODE_OPTIONS` 加 `--test-reporter=dot`）：通過的測試只印一個點，失敗的照常印出，exit code 照常傳回；AI 讀 commit 的輸出要花 token，原本約 4.2 萬字（[外掛架構檢查](<../../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)環節 9 的 Q2）。代價是通過的測試印的訊息看不到，需要時自己跑 `npm run check`；手動跑與 CI 不變。只改文件時，測試讀的文件（例如 `syntax.md` 的範例、`decisions.md`）有變動，就只跑寫到那個路徑的測試檔，通過時只印一行（2026-10-29：`b63c1bb` 只改 `syntax.md` 的範例就讓 CI 紅了）。新的測試要讀文件時，在測試裡寫出它的路徑（例如 `new URL('../docs/syntax.md', import.meta.url)`），pre-commit 才找得到。
- CI 的結果：每個 Claude session 開始時，`.claude/hooks/ci-status.mjs` 會查 `main` 最近一次跑完的 GitHub Actions，沒通過就提醒；看到提醒先用 `gh run view <id> --log-failed` 找原因，能修就修，不能修就告訴使用者。本機是 Windows、CI 是 Linux，只在一邊壞的問題 pre-commit 擋不到（2026-10 曾紅了三天沒人發現，[第一個里程碑的檢查](<../../Claude Codex Discussion/2026-10-27-milestone-1-review.md>) R1）。
- knip 報 `RangeError: Array buffer allocation failed` 是電腦可用的記憶體不夠（它的解析器一次預留 6 GB），不是程式的問題：`npm run knip`（`tools/knip.mjs`）已經自動加上 `KNIP_DISABLE_RAW_TRANSFER=1`，檢查項目不變；直接跑 `npx knip` 時要自己加（2026-10-27 W6 合併時遇到）。
- Codex 審查時：完整的 `npm run check` 要在沙箱外跑。沙箱裡會有 10～11 項環境造成的固定失敗（symlink、改名的 EPERM、git config；W5 第二部分三輪都是這樣）；沒辦法解除沙箱時，回報裡逐項列出失敗的測試，並說明哪些是環境造成的。審查請求的「驗證方式」連到這一點。
- 建置：`npm run build`，`main.js` 只能 require Obsidian 提供的 `obsidian`、`@codemirror/state`、`@codemirror/view`（[D-134](../decisions.md#d-134-學習目標-id-的補上時機與保護) 的編輯器鎖定），不能把另一份 CodeMirror 打包進去（`tools/build.mjs` 會擋）。
- 安裝：`npm run install-vault -- <vault> [--dev]`（[D-149](../decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 4 點，擋法在 `tools/install.ts`）。開發版只裝登錄過的測試 vault：登錄存在主資料夾的 `.local/test-vaults.json`（各 worktree 共用、不進 repo），第一次先 `npm run install-vault -- <測試 vault> --register-test`。裝到測試 vault（含 `--dev`）是在專案根目錄建置、再從根目錄複製（`tools/install.ts:176–177`），中間有別的程序寫了 `main.js` 就會裝到那一份；裝完用開發命令結果檔的 `BUILD` 核對是不是這次的建置（[外掛架構檢查](<../../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)環節 9 的 N2：照實記下，不改）。其他 vault 一律當正式使用的：要工作樹乾淨、HEAD 是 `v<版號>` 的 tag、`package.json` 版號相同、DEV 關閉，產物與雜湊存到 `.local/releases/<版號>/`；退回用 `--release <版號>`，現有資料的 `需要版本`、`need` 比那一版新就拒絕。

## 規格來源

- 任務說明：v1 程式在 `tasks/*.md`，試作場在各資料夾的 `TASK.md`。
- 決定：[decisions.md](../decisions.md) 的 D-ID；commit 訊息裡的 `(D-xxx)` 指的就是這裡。
- 資料格式：[syntax.md](../syntax.md)。程式結構與模組邊界：[D-110](../decisions.md#d-110-v1-外掛的程式結構) 與 `eslint.config.js`。

## 高風險範圍（要做 L2）

跨模組的改動、資料格式、排程（FSRS 與紀錄重播）、寫回使用者筆記的函式。

請 Codex 查核時（不只 L2），寫明查什麼、讀哪些檔案、基準 commit 與驗收標準；L2 照 code-quality 的 `review.md`「審查請求範本」寫。

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
- 測試只用 syntax.md 的例子或自編的內容。
- Obsidian 畫面的截圖用開發版的 `ui` 命令（Electron 的 `capturePage()`），不要用 computer-use：它會截到舊畫面，還會讓 Obsidian 被當成隱藏而停止繪製，計時器和 `requestAnimationFrame` 也跟著變慢（W6 的 Windows 實測）。
- 測試不改全域的 `node:fs` 等 Node 內建模組：Node 自己的實作也會呼叫它們，換掉之後結果會隨 Node 的版本改變。要模擬失敗，就把替身直接交給要測的函式（例如 `createNodeFiles` 的 `seams`）。
- 產品程式（`src/`，開發命令除外）裡的 `catch` 與 `.catch()`，不是交給錯誤紀錄（[D-155](../decisions.md#d-155-正式版的錯誤紀錄)）就要在旁邊寫一句為什麼不用，例如「讀不到是預期的，state 會重試」「已經經過 onError 記下」；ESLint 的 `no-console` 擋得到直接印 console，擋不到空的 `catch` 與吞掉的拒絕，L2 審查照這條看。
- 維修時怎麼讀錯誤紀錄（[D-155](../decisions.md#d-155-正式版的錯誤紀錄)、[D-160](../decisions.md#d-160-學生在複習畫面回報問題點一個選項記進錯誤紀錄)）：使用者回報問題，或問有沒有學生的回報時，先讀 vault 的 `Essence Cards/紀錄/錯誤/` 那段時間的行（格式見 [syntax.md §9](../syntax.md#9-錯誤紀錄)；學生的回報是 `where: "report"`，用 `lt` 在卡組裡找到那一行）。用 `build` 找是哪一版；要把 `stack` 對回原始碼時用 `npm run locate -- <版號> <行:欄>`（只有正式安裝存過對照表的版本能用）。紀錄可能因同步、上限或寫入失敗而缺漏，沒有那一行不代表沒發生；寫進 repo 的只寫摘要（D-003）。

## 技術債清單

[backlog 的「技術債」一節](../backlog.md#技術債)。

## Obsidian 相容性檢查

[D-138](../decisions.md#d-138-obsidian-出新的次版本時做一次相容性檢查)：Obsidian 出新的次版本（例如 1.14 → 1.15）時做一次，由 AI 做。

- **目前驗證過的版本**：Windows 1.14.5（2026-10-26，W5 第二部分的開發命令）；iPhone 1.14.5（2026-10-27，[W6 的 iPhone 測試](../../tasks/w6-iphone.md)）。
- **怎麼發現新版**：開發命令的結果檔會記 Obsidian 的版本（`obsidian` 欄位），AI 在 Windows 版 Obsidian 跑開發命令時看到比上面新的次版本就做；每個里程碑結束時也查一次 Obsidian 的改版說明。
- **三層**：
  1. 比對新舊版 `obsidian` 套件的 `obsidian.d.ts` 與 `peerDependencies`（CodeMirror 的版本）：本專案用到的 API 有沒有改、標成不建議使用；CodeMirror 版本變了就把 `package.json` 的開發相依改成一樣，跑 `npm run check`。
  2. 在 Windows 版 Obsidian 用開發版重跑 `files`、`compare`、`lock`、`save`、`today`、`answer`、`events`、`a3check`（`npm run install-vault -- <測試 vault> --dev`；`lock`、`save` 在 W5 第二部分合併後才有），結果和上一次比。`events` 比對[外掛架構討論稿環節 1 的 A3 表](<../../Claude Codex Discussion/2026-10-26-plugin-architecture.md#實機記錄t3-與-a32026-10-27opus-55>)。`a3check` 的每個情境都要 `ok`；`skipped` 列的是未測的子項，不算通過，要和上一次相同；`cleanupLeft` 要是空的（iCloud 偶爾會把剛刪的測試卡組放回來）。開發命令的結果拿來當驗收（這一層與任務的完成條件）時都一樣：必要的操作沒做到不算通過，未驗的子項另外列；「完成」的通知或結果檔存在不算通過。`lock`、`save` 現在有會假通過的情境，先照 [backlog 技術債](../backlog.md#技術債)那一列修（外掛架構討論稿環節 9 結論第 5 條）。
  3. 讀改版說明裡和這幾點有關的條目：編輯器與 CodeMirror、Markdown 解析與閱讀模式（清單、區塊 ID）、檔案與 vault 的事件、iOS 與同步；每一點寫一句結論。
- **結果**：寫進 roadmap 的已完成，通過就更新上面的版本；有不相容先寫失敗測試再修（高風險範圍做 L2）。iPhone 的部分記進下一次 iPhone 實機測試的清單。

## 里程碑

見 [roadmap](../roadmap.md)。第一個是 W1～W6 打通「手寫卡組 → iPhone 複習 → 自評 → 排程」（[D-111](../decisions.md#d-111-v1-的開發順序capture-延後)）。

## 共用的 skill

`.claude/skills/` 與 `.agents/skills/` 裡的 code-quality、essence-decision、essence-discuss，兩份內容必須相同，由 `tools/check-skill-mirror.ts` 檢查；改其中一份時，另一份一起改。
