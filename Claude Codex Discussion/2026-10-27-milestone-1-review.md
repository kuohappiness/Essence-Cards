# 第一個里程碑的品質檢查（W1～W6）

狀態：處理中：R1～R4、R7、R8 已在 `main` 做完（〈[處理紀錄](#處理紀錄2026-10-28)〉）；R5 在分支 `claude/quizzical-euclid-f0564e`（`934392d`）做完，還沒合併；R6、R9 等觸發點；R10 記下即可

2026-10-27｜檢查者：Claude（Opus 5.5）｜性質：code-quality 的[里程碑回顧與安全檢查](../.claude/skills/code-quality/milestone.md)（[D-117](../docs/decisions.md#d-117-技術債預防機械檢查全自動ai-審查只在關鍵點)、[D-119](../docs/decisions.md#d-119-程式品質的-skill-整併成通用的-code-quality)），L1。審查紀錄分三段交給子代理整理，安全檢查照 `security-review` 的流程交給子代理；兩者的關鍵說法 Claude 都抽查過。只提建議，改哪些由使用者決定。

## 範圍與做法

- 範圍：`dd0a7cb`（W1 開工前）到 `f136cf6`（W6 合併）。程式 96 個檔、+14,167 行；文件看到 `9630788`。
- 讀了：各任務說明、審查請求與報告（W1～W2、W3、W4、W5 兩部分、[W5 架構檢查](2026-10-26-w5-architecture-debt.md)、state-load、W6 的格式查核與 L2）、[技術債清單](../docs/backlog.md#技術債)、git log、GitHub Actions 的執行紀錄。
- 跑了：在 `main` 的 `9630788` 跑 `npm run check`，全部通過（519 個測試，71 秒；加了 `KNIP_DISABLE_RAW_TRANSFER=1`）；`npm audit` 含開發相依、不含開發相依都是 0。
- 沒做：沒有在 Obsidian 實機重跑，這次用不到。W1～W2、W3 的 Codex 原始報告不在 repo，只看得到 Claude 的回應。

## 總覽

| 任務 | 審查 | 發現 |
|---|---|---|
| W1～W2 | L2 1 輪；Claude 核對修正時另外找到 4 項 | F1～F7；N1～N3、`56e0dc6` |
| W3 | L2 1 輪 | 6 項 |
| W4 | L2 2 輪 | F1～F5 |
| W5 第一部分 | L2 2 輪 | F1～F5 |
| W5 第二部分 | 設計討論 2 輪、L2 4 輪 | F1～F6、R1～R3、T1；Windows 實測 3 件 |
| state-load | L2 2 輪 | F1、F2 |
| W6 | 格式查核 2 次、L2 4 輪、iPhone 2 次 | 格式 9 項；L2 F1～F7、R1、R2；Windows 實測 6 件；iPhone 0 項失敗 |

Codex 一共找到約 50 項。看得出三件事：

1. **L2 有用**：有編號的發現幾乎都是 L2 或格式查核找到的，實作者自己的 L1 找到的很少。W4 的 L1 加了 22 個突變測試，L2 的 5 項還是全漏。不建議減少 L2。
2. **最大宗是規格的漏洞**：邊界沒寫，或引用別的模組行為時寫錯。其次是畫面與接線層的生命週期問題。
3. **約三成是修正或整理本身帶進來的**：W5 第二部分的 R1、R2、T1，state-load 的 F1，W6 的 R1、R2。

## 建議（依嚴重程度）

### R1｜P1：CI 在 main 紅了三天，沒有人知道

- **事實**：GitHub Actions 在 `main` 從 2026-10-24 16:40（`434a98f`）到 2026-10-27 11:08（`8452239`），連續 91 次 push 都失敗。`d8fe310` 起變綠，中間沒有改程式。每次失敗的都是同一個測試：`tests/node-files.test.ts:140`「列資料夾暫時回 EPERM」。
- **原因**：
  - 這個測試把全域的 `fs.readdirSync` 換成會丟 EPERM 的版本。
  - runner 的 Node 24.21.0 在 Linux 用 JS 實作遞迴 `fs.watch`，它也呼叫 `fs.readdirSync`。CI 的堆疊顯示 `node:internal/fs/recursive_watch` 呼叫到測試換上的函式，於是丟出沒人攔截的錯誤。
  - runner 換成 24.22.1 之後就通過了，推測是 Node 改了內部實作。但 runner 的 Node 版本不固定：10-27 15:14 推的 `8124927`（這份報告）又分到 24.21.0，同一個測試又失敗。所以它不是「自己好了」，是看分到哪一台 runner。
  - 本機是 Windows、Node 24.13，一直通過，pre-commit 擋不到。
- **影響**：這三天裡 CI 等於沒有作用，那段時間如果有真的只在 Linux 才壞的問題，也會被蓋住。D-117 的 L0 有接上，失敗卻沒有傳到任何人。
- **建議**：
  - a. 讓失敗看得到：在 `.claude/settings.json` 加一個 SessionStart hook，`gh run list --branch main --limit 1` 是 failure 就印一行警告。這是不花 token 的機械檢查。也可以在 GitHub 打開 Actions 失敗的通知。
  - b. 測試只換自己的依賴：`createNodeFiles` 收一個可選的 `readdir`，測試不再改全域的 `fs`。`tools/node-files.ts` 只給測試與工具用，不是產品出口。
  - c. 可選：CI 改用 `node-version-file` 讀 `.node-version`，讓本機和 CI 用同一個次版本。代價是本機要跟著升級。
- **同一家族的前例**：W3 的 `@emnapi` lock、CRLF 的 hook、Windows 的 EPERM、大小寫的測試在 Linux 跳過。平台差異每次都是合併後才看到。

### R2｜P2：修正帶進回歸

- **事實**：
  - 「紀錄裡出現過的 `lt`」這個集合不完整，前後被找到四次：[ID 保護討論](2026-10-24-id-protection.md)的取消作答、W5 F3 的 JSON 空白、R1 的跳脫鍵名、state-load F1 的取消行多帶 `lt`。每次只補 Codex 給的反例，下一輪又找到相鄰的變體。
  - 「同一批通知的順序」出過兩次：先是 F5，再來是 R2，而 R2 是 F5 的修正帶進來的。
  - W6 的 R1、R2 都來自 `d9e50e3`。這個 commit 同時做了 F4、S2 與自選第 10、22 點，改了 11 個檔。
- **建議**：
  - a. 寫兩個性質測試。第一，`parseLine` 接受的每一行（含救回的尾段），它的 `lt` 都在 `History.seen`。A1 修好之後 `seen` 只有一處，正好寫成不變量。第二，`state` 收到同一批通知的所有排列，最後的狀態都相同。
  - b. 在 code-quality 的「測試」加一句：一個 commit 只實作一個決定或一項發現。

### R3｜P2：審查請求範本加「實作者自己選了做法的地方」

- **事實**：
  - W4、W5、state-load、W6 的審查請求都寫了這一節，多數發現都對得到其中一點。W6 的 26 點裡有 7 點直接連到發現；W5 第二部分的 F1～F5 都對得到。
  - 但 [review.md](../.claude/skills/code-quality/review.md) 的範本裡沒有這一節，現在是靠習慣在寫。
- **建議**：範本加一條「自己選了做法的地方：規格沒寫、由實作者決定的點逐條列出，請審查者先看」。兩份 skill 副本一起改。

### R4｜P2：規格引用既有行為或「已驗過」時，附上證據

- **事實**：
  - W4 規格說同一篇裡重複的 ID「W2 已標成錯」，實際上只有提示，而且 `ok` 仍是 true。
  - W6 規格寫「用 visualViewport 調整，試作外掛驗過」，實際上沒有這段程式。結果多做了 `keyboardFit` 和鍵盤量測，R2 的一半出在這裡，還多了一輪再審；最後 iPhone 的 J7 證明用不到。試作外掛的 README 本來就寫著鍵盤沒擋到東西。
- **建議**：code-quality 的「寫規格」加一句：引用別的模組的行為或已有的驗證時，附上檔案:行或測試名；找不到證據就寫成待驗證。

### R5｜P2：技術債清單，以及 A1～A3 的 Codex 核對

- **A1～A3 現況**：
  - A1 已在 state-load 修好，Codex 的 L2 審過。
  - A2 在[外掛架構檢查](2026-10-26-plugin-architecture.md)環節 1 和 Codex 談過三輪，決定暫不改。
  - 這兩項不用再請 Codex 核對。
- **觸發點已到、還沒處理的三項**：
  - A3：觸發點就是這次回顧。完成條件的第一步，是在 Windows 版 Obsidian 記錄背景開檔、關檔、改名、popout 各會發哪些 workspace 事件。
  - T3：觸發點是「下一次在 Windows 跑開發命令時」。10-27 的 W6 iPhone 準備和 state-load §8 都在 Windows 跑過開發命令，T3 都沒有一起做。這個觸發點寫得太寬，每次都被略過。
  - state-load 的收尾：觸發點是 W6 合併進 `main` 之後。`unread()` 還沒有開發命令；`src/main.ts:181` 的註解還寫著「讀不到時 ready() 自己重試」。
- **建議**：
  - 開一個任務一次做完。加一個記錄 workspace 與 vault 事件的開發命令，在 Windows 跑 A3 與 T3 的情境，順便做 state-load 的收尾。
  - A3 的改法根據這份記錄寫成設計，再交給 Codex 查核。這才是 A3 需要的「Codex 核對」。roadmap 上的「A1～A3 請 Codex 核對」改成這個做法。
- **清單本身**：
  - F3 已在 `738bd29`（10-21）修好：`validateOut` 會比對所有 worktree，`experiments/t4/arch-selftest.mjs:37` 有測試。這一列可以刪掉。
  - F5 的分類順序與上限也修好了，只剩「下一次 T4 用 `parseDeck` 對照題數」。

### R6｜P3：畫面層的焦點與 Tab 沒有自動測試

- **事實**：
  - L2 的 F6（按 Tab 能離開全螢幕）和 Windows 實測發現的「焦點掉到 body」，都只用開發命令 `ui` 手動驗；`tests/helpers/review-ui.ts` 不是瀏覽器。
  - Codex 三次再審都在自己的暫存資料夾用真的 Chrome 驗，那些腳本沒有進 repo。
  - 再審 RR1 指出替身的三點限制：`useSyncExternalStore` 不比對 snapshot、ref 不會清成 null、`contains` 固定回 true。這三點沒有記在替身的檔頭。
- **建議**：
  - a. 在替身檔頭補上這三點限制。這是小改。
  - b. 決定要不要加 happy-dom（或 jsdom）當開發相依，把焦點與 Tab 的情境寫成測試。好處是之後的入口畫面、目錄都用得到；代價是多一個相依，而且模擬的 DOM 不等於 Obsidian。也可以等寫入口畫面時再決定。

### R7｜P3：沒有作用或已過期的指示

- [quality.md](../docs/agents/quality.md)「檢查指令」的第一點後半「W3 第 0 步裝好之前，用……」已經過期，可以刪掉。
- Obsidian 畫面的截圖方法只記在 Claude 的記憶裡，Codex 看不到：用開發版的 `ui` 命令加 `capturePage()`，因為 computer-use 會截到舊畫面。W6 說明裡也還寫著「用 computer-use 截圖」。建議寫進 quality.md 的「本專案的做法」。
- knip 需要的 `KNIP_DISABLE_RAW_TRANSFER=1` 只寫在文件裡，結果每次 commit 先失敗、再手動加上重跑。建議直接在 `npm run knip` 裡設定，例如用一支小的 `tools/knip.mjs` 設好環境變數再跑；檢查項目不變。

### R8｜P3：Codex 審查的環境成本

- **事實**：
  - W5 第二部分的三輪審查，Codex 跑 `npm run check` 每次都有 10～11 項失敗，都是沙箱造成的（symlink、改名的 EPERM、git config）。
  - T1 的確認輪沒有重跑完整檢查。
  - W5 第一部分和 state-load 的再審，是解除沙箱後才全綠。
- **建議**：在 quality.md 的「檢查指令」寫明：完整檢查要在沙箱外跑，或列出已知的沙箱失敗讓 Codex 對照。審查請求的「驗證方式」連到這裡。

### R9｜P3：iPhone 測試的步驟

- **事實**：
  - W6 第一次 iPhone 測試，英文「沒印象」那一步沒有指定用哪一張卡。`light`、`borrow` 的原形就是答案，會跳過第 2 步。
  - 使用者的感想留到最後才收，做完才發現少了觀察，結果要重測。
  - 重測前，Claude 手動在電腦的紀錄檔加了 9 行取消。
  - 重測後，iPhone 上仍沒涵蓋 `typed: skip` 接 `retry: right` 的情形。
- **建議**：
  - 之後的實機步驟要指定卡片，每一步做完當場回報。
  - 要清掉某次作答時，改用開發命令（「取消這台裝置某個時間之後的作答」），不要手改紀錄檔。
  - 下一次 iPhone 測試時，順便補上 `typed: skip` 接 `retry: right`。

### R10｜低：其他（記下即可）

- 寬鬆的效能測試（`tests/study-performance.test.ts:19`，單次量、門檻 2000 ms）在 W3 時，跑完整檢查曾量到 2883 ms 而失敗，之後沒有處理。這次本機通過；再失敗一次就改成取中位數或放寬門檻。
- W6 的格式查核其實是在 §0-1、§1 寫完之後才回來的，因為 worktree 是從 D-140 生效前的 `ab2c99c` 開的。D-140 現在已經寫進任務說明的開工條件，不另外加規則。S1 的查核確實在實作前做，之後 L2 沒再找到 S1 的問題，可見這道閘門有用。
- W6 升級給 Fable／Astra 的五題，答案都和 Opus 原本的建議相同，等了大約 10 小時。這和 [D-144](../docs/decisions.md#d-144-決策交給-opus-xhighfable-只在解不了的時候) 的順序一致（先 Opus xhigh，再和 Codex 討論），不用改。

## 安全檢查

照 `security-review` 的流程做：子代理讀了範圍內 66 個非測試檔，Claude 抽查。**沒有達到信心門檻的高、中風險發現。**

- **卡片內容進到畫面**：沒有 `innerHTML` 之類的寫法。卡片文字走 Obsidian 的 `MarkdownRenderer`，其他都是 React 的文字節點或 `textContent`。
- **出處連結**：`openLinkText` 只會開 vault 內的筆記，卡片沒辦法讓它開外部網址或程式。
- **檔案路徑**：
  - Obsidian 版的 `location()`（`src/obsidian/files.ts:9`）擋掉絕對路徑、`\`、磁碟代號與 `..`；Node 版用 resolve 加 relative 限制在 vault 內。
  - 紀錄檔名裡的裝置碼有格式檢查，紀錄一律用 `JSON.stringify` 寫。
  - 寫到一半失敗：卡組用 `vault.process` 一次讀改寫；紀錄如果留下壞行，由救回規則處理。
- **程式執行**：沒有 `eval`、`new Function`。`child_process` 只出現在 tools，參數固定、不經過 shell。
- **金鑰與私人資料**：secretlint 包含在 `npm run check` 裡。repo 裡沒有課本、學生資料或紀錄檔，只有兩張舊外掛的截圖。
- **相依套件**：`npm audit` 是 0，含開發相依。
- **要記得的一點（沒到門檻）**：開發版註冊了 `obsidian://essence-cards-dev`，網頁可以觸發它。它只碰固定的測試資料夾，也沒有網路出口；但開發版只能裝在測試 vault，給學生的一定要是正式建置。這點建議併進[更新與相容](../docs/plans/updates.md)的發布流程。
- **工具的缺口**：這是 AI 的靜態閱讀，沒有動態測試或 fuzz，而且只看這個範圍新增的程式。

## Obsidian 改版說明

- 公開版仍是 1.14.5（10-22 發布，只有 Electron 的安全更新）；`obsidian` 套件 1.14.4 也是最新。不用做相容性檢查。
- 1.15.0 目前在搶先體驗版（10-22）：
  - 和本專案有關的是 smart list 的改動：搬動、縮排巢狀項目時會帶著子項目。卡組是清單，這和 D-134 的 ID 鎖定、`fixIndent` 有關。
  - `cm-formatting-*-end` 類別、Mermaid 換成 Pele，本專案都沒用到。
  - 等它公開時照 [D-138](../docs/decisions.md#d-138-obsidian-出新的次版本時做一次相容性檢查) 做三層檢查，第 2 層要多跑「清單搬動」的鎖定情境。

## 處理紀錄（2026-10-28）

使用者選了：R1～R4、R7、R8 在這裡做；R5 另開任務；R6、R9 等觸發點到了再說。

- **R1**（`fb95339`）：
  - `createNodeFiles` 多收一個只給測試用的 `seams`（`readdirSync`、`watch`），EPERM 的測試把替身直接交給它，不再改全域的 `fs`。
  - ESLint 在 `tests/` 擋 `syncBuiltinESMExports`，以及對 `fs`、`path`、`os` 等成員的指定；`tests/quality.test.ts` 有正反例。拿修改前的測試檔去跑，兩處都會被擋下。
  - 加了一個 SessionStart hook（`.claude/hooks/ci-status.mjs`）：`main` 最近一次跑完沒通過就提醒；gh 不能用時安靜結束。
  - `.node-version` 沒有做（c 是可選的）：測試不再依賴 Node 的內部實作之後，固定版本的好處不大。
- **T2**（`105fd3e`）：改 `tools/node-files.ts` 正好碰到它的觸發點，就一起做了。沒有檔名的事件，下一次比對成功時把已知的檔全部通知重讀；比對暫時失敗時這個需求留著。測試在拿掉修正時會失敗。
- **R2**（測試 `44b4526`）：
  - `tests/study.test.ts` 加了 `seen` 的性質測試：200 組隨機紀錄，種下的 `lt` 都要在 `seen`，涵蓋作答、變更、取消行、評分不對的行；空白、跳脫的鍵名、欄位順序；寫入中斷。
  - `tests/state-ids.test.ts` 加了三個情境，同一批通知照所有排列跑，結果要相同。
  - 確認測試有效：把 `history.ts` 的三條規則（取消行多帶的 `lt`、救回的尾段、寬鬆比對的空白）各拿掉一次，`seen` 的性質測試都會失敗；把紀錄拿出同一批，順序測試也會失敗。
  - code-quality 的「測試」加上「一個 commit 只實作一個決定或一項審查發現」。
- **R3**：`review.md` 的審查請求範本加「實作者自己選的做法」。
- **R4**：code-quality 的「寫規格」加「引用別的模組的行為或已有的驗證時附上證據；找不到就寫成待驗證」。
- **R7**（knip `3c9551f`）：
  - `npm run knip` 改走 `tools/knip.mjs`，自動加上 `KNIP_DISABLE_RAW_TRANSFER=1`。
  - quality.md 刪掉過期的「W3 第 0 步」，加上 Obsidian 截圖的做法，以及「測試不改全域的 Node 內建模組」。
- **R8**：quality.md 的「檢查指令」寫明 Codex 審查時完整檢查要在沙箱外跑；跑不了時要逐項列出失敗、說明哪些是環境造成的。
- **技術債清單**：F3 已經修好，刪掉；F5 只留「下一次 T4 用 `parseDeck` 對照題數」；T2 做完，刪掉。

## 驗證紀錄

- `npm run check`：`9630788`，519 個通過、0 個失敗（本機 Windows，Node 24.13.0）。
- GitHub Actions：用 `gh run list` 看了 `main` 最近 200 次，其中 95 次失敗；連續失敗的 91 次都是同一個測試。對照了 runner 的版本：Node 24.21.0 失敗，24.22.1 通過。
- 子代理的整理分三份：W1～W4、W5 與 state-load、W6。Claude 抽查了 F3 的修正、A1 的修正、`review.md` 的範本、quality.md 的過期句子、替身的檔頭、`save.ts` 的五個來源，以及安全檢查的路徑檢查與危險 API。
