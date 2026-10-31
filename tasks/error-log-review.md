# 正式版的錯誤紀錄與複習畫面的回報：L2 審查請求（給新開的 Codex session）

狀態：L2 通過（[報告與回應](<../Claude Codex Discussion/2026-10-31-error-log-review.md>)，五輪，最後一輪審 `8a1e3c7`）；等使用者決定合併

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。這是 [code-quality](../.agents/skills/code-quality/review.md) 的 L2：只審查與回報，不改產品程式；可以在隔離的暫存資料夾重現。回報寫在 `Claude Codex Discussion/2026-10-31-error-log-review.md`（新檔，標題下第一行寫狀態）。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-error-log`（和主資料夾分開；主資料夾可能有別的 session 在工作，不要在那裡切分支或改檔）。
- 分支 `claude/error-log`，待審的是分支最新的 commit（開工時 `git log -1` 記下完整 SHA 寫進回報）。分支從 `main` 的 `1e6b00a` 開，之後把 `origin/main` 的 `eda8739`（外掛內備份第一部分）合進來（`f1eb85d`）。
- **要審的差異**：`git diff eda8739...claude/error-log`（只有這個任務的改動與合併時的衝突處理）。合併前的 17 個 commit 照節分開，一個 commit 一節，對照表在[任務說明](error-log.md)〈結果〉。
- 開工時應該沒有未提交的修改；有的話先停下來問。

## 規格與優先順序

1. [任務說明](error-log.md) §1～§8 與〈限制〉（可以改的檔、不碰的語意）。
2. [D-155](../docs/decisions.md#d-155-正式版的錯誤紀錄)、[D-160](../docs/decisions.md#d-160-學生在複習畫面回報問題點一個選項記進錯誤紀錄)。
3. 格式 [syntax.md §9](../docs/syntax.md#9-錯誤紀錄)（這次沒改）。
4. 細節與反例：[討論稿](<../Claude Codex Discussion/2026-10-29-error-log.md>)的〈Codex 回應〉P3～P7 與〈Claude 回應〉的表。

基準 `b456a20` 之後，任務說明「基準與開工條件」列的檔在開工前沒改過；合併 `eda8739` 帶進了外掛內備份（D-150、D-148、D-156），改到 `src/main.ts`、`src/obsidian/files.ts`（`readBytes`）、`src/state/`（寫入的閘門）、`tools/build.mjs`（`desktopOnly`）、`tsconfig.json`（tests、tools 也做型別檢查）。規格之間有衝突時列成問題，不挑容易通過的那份。

## 行為與風險

高風險範圍（[quality.md](../docs/agents/quality.md#高風險範圍要做-l2)）：`Files` 的 Obsidian 版、`state` 的初始化、還原的分類、正式安裝。請特別看：

- **記錄器**（`src/core/errors/log.ts`）：`record`、`report` 永遠不拋錯、不回傳 Promise；去重鍵、500 個鍵、月上限（含 `limit`、讀一次共用、`append` 之前預留）、讀不到當月就不寫、換月、等待中最多 50 筆、截斷（UTF-8 bytes、依序 `stack`→`path`→`msg`、不切開字）。錯誤紀錄不加入作答的寫入、`flush()`、`close()`。
- **接線**（`src/main.ts`）：唯一的記錄器、`fail()`；`registerDomEvent` 的補網只收 `plugin:essence-cards:` 的 frame（`plugin:essence-cards-x:` 不算）、停用時移除；`ready()` 的空拒絕處理。
- **初始化**（`src/state/index.ts` 的 `ready()`、`loadQueue`）：除了 `close()` 之外，讓 `ready()` 拒絕的每一條路恰好經過一次 `onError`。請找新的組合，例如 `close()` 與程式錯誤交錯、讀取那一列失敗之後首次排程又失敗。
- **`Files`**（`src/obsidian/files.ts` 的 `createFolder`）：失敗後再查一次、是資料夾才往下；不是就照原樣拋出。
- **還原**（`src/core/backup/plan.ts` 的 `listed`）：`紀錄/錯誤/` 不進 `files`、`logs`、「備份後才有」；`isLogPath` 沒改；外掛內備份的還原畫面之後用 `planRestore` 就不會列。
- **正式安裝**（`tools/install.ts`、`tools/build.mjs`、`tools/locate.ts`）：`main.js` 逐位元組不變；`.local/releases/<版號>/` 多存 `main.js.map` 與雜湊；舊版本沒有 map 照常退回；`locate` 先比兩個雜湊、`.dirty` 不定位。
- **複習畫面**（`src/ui/Review.tsx`、`Review.css`、`host.tsx`）：旗子的位置與停用；選單開著時按鍵、滑動、點卡片、自動換卡與「離開超過 60 秒回來從頭開始」都不作用；卡片狀態（翻面、打字卡的步驟與字）不變；回看時回報那一張；不寫複習紀錄。

明確延後的：iPhone 的部分（已在 backlog「下一次 iPhone 實機測試」）；說明書；給家長的回報列表；`tools/backup.ts` 的讀完重檢與 `tools/update-vault.ts` 的 `changedSince`（D-155 代價的最後一點）。

## 驗證方式

- 指令：`npm run check`（型別、ESLint、knip、secretlint、skill 副本、文件、測試）。沙箱裡會有環境造成的固定失敗，照 [quality.md](../docs/agents/quality.md#檢查指令) 的說明在沙箱外跑，或逐項列出哪些是環境造成的。
- 相關測試檔：`tests/errors.test.ts`、`tests/state-init.test.ts`、`tests/main-wiring.test.ts`（§2、§8 的接線，用 `tests/helpers/obsidian.ts` 的替身）、`tests/review-host.test.ts`、`tests/review-ui.test.ts`（§8）、`tests/obsidian-files.test.ts`、`tests/files-contract.test.ts`（C17）、`tests/backup-core.test.ts`（§5）、`tests/build.test.ts`、`tests/install.test.ts`、`tests/locate.test.ts`（§6）、`tests/quality.test.ts`（`no-console`）。
- 實作者跑過的：合併後 `npm run check` 全過（858 個測試，Windows、Node 24.13.0）；Windows 版 Obsidian 1.14.5 在測試 vault 跑開發命令 `files`、`error-probe`（結果檔與數字在任務說明〈結果〉）。結果檔在測試 vault，不在 repo；Codex 不用重跑實機。
- 沒跑的：iPhone；滑動手勢（Node 的畫面替身沒有觸控，Windows 沒送觸控事件）；iPhone 寬度的截圖。

## 實作者自己選的做法

規格沒寫、由實作者決定的地方，請先看這些：

1. **§2-3 用 `init`**：`ErrorSource` 加 `'init'`，在 `ready()` 外面補報；用 `queueFailed` 判斷讀取那一列已經報過。
2. **記錄器的 `after`**：第一次讀寫之前等 Obsidian 的 layout ready。理由：之前 vault 的索引不完整，`Files.read` 會把當月已有的檔讀成不存在、算成 0 行，月上限就擋不住；`append` 也會撞「已經存在」。代價：layout ready 之前的錯誤排著（最多 50 筆），停用時還沒 ready 的就丟了。
3. **`isErrorLogPath` 涵蓋整個 `紀錄/錯誤/`**（含 iCloud 的衝突副本與其他檔），不只照檔名格式；還原的例外照它判斷。
4. **`msg`**：`Error` 只取 `message`（照 syntax.md §9 的第一個範例，不加 `TypeError:`）；`message` 是空字串時用 `String(error)`；物件先試 JSON，空物件或失敗用 `String`，再不行用 `Object.prototype.toString`，最後是「（無法轉成文字）」。
5. **截斷**：截過的欄位結尾加「…」；`stack`、`path` 連一個字都放不下時整欄拿掉，`msg` 留「…」；三欄都截了還放不下就不寫那一行。
6. **計數**：被「等待中最多 50 筆」丟掉的那一次也算進去重的次數。月上限的計數：數不是空白的行；有一行含 `"where":"limit"` 就當成滿了。觸發上限的那一筆不寫，改寫 `limit`（時間用那一筆的）。
7. **畫面的錯**：`Markdown` 的 `onFail` 改成 `(error, sourcePath)`；背面補充的 `Markdown` 原本沒有 `onFail`，這次也接上（量測的 `render-failed` 會多出 `back`）。`createRoot` 只在有傳 `onError` 時才帶選項，沒傳就照 React 的預設。
8. **§3 的範圍**：只補「空的」`catch`／`.catch()`（7 處，列在〈結果〉）；回傳結果或問題清單的不動，它們也不在〈限制〉第 1 點可以改的檔裡。
9. **§4**：實機上兩個 `createFolder` 同時送出時兩個都成功；對已經存在的資料夾才拋 `Folder already exists.`。修正接的是後者（先查不到、輪到時已經有了）。
10. **§6**：對照表的 `sources` 改成相對 repo（esbuild 在輸出跨磁碟時寫成 `file:` 網址），一起存 `sourcesContent`。同一個版號已經有正式產物、但沒有對照表時（例如這台電腦已裝的 `0.1.0`）不補存；要定位 `0.1.0` 的錯，得從 tag 的乾淨 worktree 重建並比對雜湊（沒做成工具）。
11. **§8 的畫面**：沒有旗子時那一格是空的（上方列從四格變五格，改了一個既有測試）；選單開著時主機不 `pause`（新的 `onMenu` 回呼），所以回來不會從頭開始；點選單外面的暗處也是取消；選單打開時焦點移到選單，關上後打字卡的輸入框拿回焦點；選項置中；遮罩用黑色調暗（兩個主題都一樣）。
12. **測試替身**：`tests/helpers/obsidian.ts` 的 `Plugin` 加 `unload()`（跑 `onunload`、移除登記的事件），`failWrite` 可以只擋某些路徑，`failWatch` 讓 `vault.on` 拋錯。
13. **開發命令 `error-probe`**：暫時換掉 `MarkdownRenderer.render` 與 `speechSynthesis.cancel` 來製造 `render` 與 `ui` 的錯，結束時還原。
14. **合併 `eda8739` 時**：兩邊都加了契約 C16，對方的 `readBytes` 留 C16、這邊的改成 C17；`save.ts` 照對方的 `ready().then(refresh, …)` 加上這邊的註解；`build.mjs` 同時有 `desktopOnly` 與 `sourcemap`。

## 待決問題（請一起看，結論交使用者）

- 合併進來的 `startBackup`（`src/main.ts`）在電腦上載入備份功能失敗時只 `console.error`，沒有交給錯誤紀錄；備份本身失敗（`runner` 的 `failure`）也沒有記。理由是只在電腦、使用者在設定頁看得到原因，而且是另一個已過 L2 的任務的程式，這次沒改。要不要記（`where` 用 `init` 還是新增一種）？
- 寫不進去時提示照樣說「已記下」（D-160 的代價，照做）。

## 回報與權限

只審查，不改產品程式與這份請求；可以在隔離的暫存資料夾重現。每項發現寫：哪一軸（規格／規範與設計）、觸發條件、預期與實際、影響、位置、證據（已重現／靜態推斷／待驗證）、建議處理（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。可以回報「規格本身有漏洞」。最後一行寫沒測的項目與原因。
