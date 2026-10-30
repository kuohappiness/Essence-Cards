# 正式版的錯誤紀錄（給 Claude，本機執行）

狀態：程式與 Windows 實測做完，在分支 `claude/error-log`；Codex L2 一輪的 R1～R4 已修（[報告與回應](<../Claude Codex Discussion/2026-10-31-error-log-review.md>)），待再審，合併由使用者決定

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（[D-144](../docs/decisions.md#d-144-決策交給-opus-xhighfable-只在解不了的時候)：設計已在 D-155 與討論稿做完，這份是照做）。

依據：[D-155](../docs/decisions.md#d-155-正式版的錯誤紀錄)、[D-160](../docs/decisions.md#d-160-學生在複習畫面回報問題點一個選項記進錯誤紀錄)（§8 的回報）、格式 [syntax.md §9](../docs/syntax.md#9-錯誤紀錄)；細節、反例與已重現的問題在[討論稿](<../Claude Codex Discussion/2026-10-29-error-log.md>)的〈Codex 回應〉與〈Claude 回應〉。為什麼現在：學生開始每天使用之前，正式版遇到錯誤要留得下證據（使用者 2026-10-30 確認）。

## 排程與分支

- 分支 `claude/error-log`，從 `main` 開；在本機用 `git worktree add ../Essence-Cards-error-log -b claude/error-log main` 開在旁邊，**不要在原資料夾切換分支**。
- 照下面 §1～§6、§8 的順序，一節一個或幾個 commit（code-quality：一個 commit 只實作一個決定）；§7 的 Windows 實測放最後。§4、§5 和其他節無關，可以先做；§8 要用 §1、§2 的記錄器與接線。
- 改到 `Files`、`state` 的初始化、還原分類與正式安裝，屬於高風險範圍（[quality.md](../docs/agents/quality.md#高風險範圍要做-l2)）：全部做完後寫審查請求 `tasks/error-log-review.md`，請新開的 Codex session 做 L2（§8 的複習畫面一起審）；合併由使用者決定。

## 基準與開工條件

- 基準是這份說明所在的 commit：`git log -1 --format=%h -- tasks/error-log.md`。開工前 `git diff <那個 commit> -- docs/decisions.md docs/syntax.md src/main.ts src/state/ src/obsidian/files.ts src/core/backup/ src/ui/host.tsx src/ui/Review.tsx tools/install.ts tools/build.mjs` 看有沒有改過；有改以新版為準，並在回報註明。
- syntax.md §9 已經定稿（格式查核就是討論稿那一輪；`report` 的欄位是 D-160 加的），這次不改它；實作發現它寫不通時停下來，回報哪一句、為什麼。
- 這份說明沒寫到、做了又很難收回的，停下來問使用者。

## 必讀範圍

| 讀什麼 | 為什麼 |
|---|---|
| D-155、D-160、syntax.md §0、§5、§9 | 要做的事與格式 |
| 討論稿〈Codex 回應〉P3～P7、第 5 節第 1、7 題，〈Claude 回應〉的表 | 已重現的漏接、上限的漏洞、建資料夾的競爭、還原的分類 |
| `src/main.ts`（`report`、`NOTICES`、`console.error`、`start()` 的 `ready()`）、`src/state/reads.ts`（`start`、`files.watch`）、`src/state/index.ts`（`onError`、`ErrorSource`）、`src/ui/Markdown.tsx`、`src/ui/host.tsx`、`src/obsidian/save.ts`（`leave` 的 `onError`）、`src/obsidian/files.ts`（`create`）、`src/obsidian/dev.ts`（`collectErrors`）、`src/core/backup/plan.ts`、`src/core/study/log.ts`、`tools/install.ts`、`tools/build.mjs`、`eslint.config.js` | 要改或要照著寫的程式 |
| `tests/main-wiring.test.ts`、`tests/save-wiring.test.ts`、`tests/build.test.ts`、`src/dev/files-contract.ts` | 接線、建置與 `Files` 契約的測試怎麼寫 |
| `src/ui/Review.tsx`（上方那一排、`onKey`、滑動、自動換卡）、`src/ui/Review.css`、`tests/review-ui.test.ts`、`tests/helpers/review-ui.ts` | §8 的畫面與它的測試 |
| `.agents/skills/code-quality/SKILL.md` 的「測試」一節、[試作場說明](../experiments/README.md)的〈AI 怎麼測〉 | 測試寫法；Windows 版 Obsidian 的操作方式 |

其他文件不用讀。

## 限制

1. **可以修改**：`src/core/errors/`（新的）、`src/core/backup/plan.ts`、`src/main.ts`、`src/state/`（只在 §2-3 的初始化補報）、`src/ui/host.tsx`、`src/ui/Markdown.tsx`、`src/ui/Review.tsx`、`src/ui/Review.css`（只在 §8）、`src/obsidian/files.ts`、`src/obsidian/save.ts`、`src/obsidian/dev*.ts` 與新的開發命令檔、`src/dev/files-contract.ts`、`tools/build.mjs`、`tools/install.ts`、新的 `tools/locate.ts`、`package.json` 的 scripts、`eslint.config.js`、`tests/`、`docs/agents/quality.md`、`docs/backlog.md`、`docs/roadmap.md`、這份說明。
2. **不改檔案格式**：syntax.md 不動；複習紀錄、備份檔的格式不變。不加套件。
3. **不碰**：作答的寫入順序（`createLogWriter`）、`flush()`、`close()` 的語意；`tools/backup.ts` 的讀完重檢與 `tools/update-vault.ts` 的 `changedSince`（D-155 代價的最後一點，照現在的做法）。
4. **實測只動測試 vault**（位置在 Claude 的記憶 `test-vault-location`），不碰正式使用的 vault。**不要用 computer-use 截 Obsidian**；用開發命令看結果。
5. 測試只用自編的內容；錯誤訊息、路徑都用假的。

## 1. 記錄器（`src/core/errors/`）

新的核心模組，只靠 `Files`，不碰 Obsidian、Node、畫面；對外只從 `index.ts` 拿。ESLint 的核心規則已經涵蓋 `src/core/**`，照 [D-110](../docs/decisions.md#d-110-v1-外掛的程式結構) 與 `eslint.config.js` 的核心模組規則；它從 `study` 只拿時間的寫法（`formatTime`）。

- `ERROR_FOLDER = 'Essence Cards/紀錄/錯誤'`、`errorLogPath(ms, offset, device)`、`isErrorLogPath(path)`：檔名照 §9。
- `createErrorLog({ files, device, build, obsidian, now?, offset? })` 回傳 `{ record(where, error, context?: { path?: string }): void }`（§8 再加 `report`）。`record` 不回傳 Promise、**永遠不拋錯**。
- 錯誤轉文字（`Error`、字串、`null`、`undefined`、循環物件、`toString` 會拋錯的物件）、取自己的程式位置（只留含 `plugin:essence-cards:` 的那幾層，`plugin:essence-cards-x:` 這種別的外掛不算）、截斷，全部包在不會拋錯的函式裡。
- 一行照 §9：欄位順序照表；序列化後超過 2,000 bytes（UTF-8）時依序截短 `stack`、`path`、`msg`，截到放得下。
- 去重：鍵是 `where`、`path`、第一個自己的程式位置（沒有時 `msg`）；第 1 次寫，第 10、100、1,000……次各寫一行帶 `n`。去重表最多 500 個鍵，超過之後的新鍵照第 1 次寫（月上限仍擋著）。
- 月上限：每個月的檔第一次要寫之前讀一次、數行數，同一個月的讀只做一次、共用結果；讀不到（`read` 拒絕）就這次載入不寫那個月。在 `append` 之前就預留名額。第 300 行固定是 `limit`，之後這個月不寫。換月時換檔重算。
- 寫入：每一行馬上 `files.append`；拒絕就丟掉那一行，不重試、不上報、不 `console.error`。等待中的寫入最多 50 筆，超過丟掉新的。

**驗收**（Node 測試，用 `createNodeFiles` 的暫存資料夾或記憶體的 `Files` 替身）：

- 欄位與順序：一筆 `render` 錯誤的那一行，逐字等於自編的預期字串（固定 `now`、`offset`、`build`、`obsidian`）。
- 截斷：`msg` 1 萬字加長 `path` 加長 `stack` 時，那一行 ≤ 2,000 bytes，而且還是合法 JSON；中文字不會被切成半個。
- 非 `Error` 值與會拋錯的物件：`record` 不拋錯，每種都寫出一行。
- 自己的程式位置：`plugin:essence-cards-x:1:2` 這種 frame 不留；只有別人的 frame 時沒有 `stack`。
- 去重：同一個錯誤 1,000 次，檔案裡剛好 4 行，`n` 分別沒有、10、100、1000；兩個不同 `path` 的同一句訊息算兩個錯誤。
- 月上限：當月已經 298 行時再記 5 個不同錯誤，結果剛好 300 行、最後一行是 `limit`；接著重新建一個記錄器（模擬重新載入）再記，不再多寫。同時 `record` 10 次（不等待）也不超過。
- 讀不到當月的檔：替身的 `read` 拒絕時，這次載入一行都不寫，`record` 不拋錯。
- 換月：跨過月底後寫到新的檔、重新算。
- 寫不進去：`append` 永遠拒絕或永遠不回來時，`record` 照樣立即回來；不產生沒接住的拒絕；等待中的寫入不超過 50 筆。

## 2. 接線

### 2-1 主機

`src/main.ts` 在 `onload` 裡裝置碼確定之後建立唯一的記錄器（`obsidian` 用 Obsidian 的 `apiVersion`），其他地方都經過它。`report()` 與第 2 節表上每一處 `console.error`（`main.ts` 的停用時關閉、外掛事件的監聽者、`save.ts` 的 `leave`）照舊 `console.error`，再交給記錄器，`where` 照 §9。

### 2-2 畫面

- `Markdown.tsx` 顯示不出來時，透過 props 或 host 傳下來的回呼交出錯誤與 `sourcePath`（`where: 'render'`）；元件不拿 `Files`、不 import `main.ts`。
- `src/ui/host.tsx` 的 `createRoot` 加 `onUncaughtError`（`where: 'ui'`）；React 有 `onRecoverableError` 就一起接。不加 fallback 畫面。

### 2-3 初始化的漏接

`src/state/reads.ts` 的 `start()` 在 `try` 之前呼叫 `files.watch()`，拋錯時 `ready()` 拒絕但沒經過 `onError`，`main.ts` 再用 `() => {}` 吞掉（Codex 已重現）。改成：除了 `close()` 之外，**每一條讓 `ready()` 拒絕的路都恰好經過一次 `onError`**（`ErrorSource` 加 `'init'`，或沿用 `'read'`，選一個寫進審查請求）；已經報過的讀取錯誤不再報一次。Codex 另指出首次排程也在讀取佇列外（靜態推斷），一起看。

驗收：`files.watch` 拋錯 → `onError` 一次；`close()` 讓 `ready()` 拒絕 → `onError` 零次；列不出來的重試照舊每次一次。

### 2-4 補網與檢查

- window 的 `error` 與 `unhandledrejection` 用 `registerDomEvent` 接（停用時自動移除），只收 stack 有自己程式位置的（§1 的同一個判斷），`where: 'uncaught'`。開發版的 `collectErrors` 照舊。
- ESLint 對 `src/` 開 `no-console`，只放行 `src/main.ts`、`src/ui/Markdown.tsx` 這幾個會先 `console.error` 再交給記錄器的地方，以及 `src/obsidian/dev*.ts`、`src/dev/`。放行清單寫在 `eslint.config.js` 一處、附理由。

**驗收**（`tests/main-wiring.test.ts` 的替身）：記錄器替身收到每一種 `where`；停用再啟用之後，一次 window 錯誤只記一次（監聽不累加）；只有別的外掛 frame 的 window 錯誤不記；`npm run lint` 對新加一行 `console.log` 的檔報錯。

## 3. 每個 `catch` 都要交代

`no-console` 擋不到空的 `catch` 與吞掉的拒絕。`docs/agents/quality.md` 的「本專案的做法」加一條：產品程式裡的 `catch` 與 `.catch()`，不是交給記錄器就要在旁邊寫一句為什麼不用（例如「讀不到是預期的，state 會重試」）；L2 審查照這條看。這次順手把 `src/` 現有的空 `catch` 補上理由或改成交給記錄器，列在審查請求。

## 4. `Files` 同時建同一個資料夾

`src/obsidian/files.ts` 的 `create()` 先查再建：兩個不同的檔同時第一次寫進同一個不存在的資料夾，會一起 `createFolder`，一個失敗（Codex 用替身重現）。改成：`createFolder` 失敗時再查一次，那個路徑已經是資料夾就照常往下，不是就照原樣拋出。

驗收：`src/dev/files-contract.ts` 加一個情況：不存在的資料夾裡同時 `append` 兩個不同的檔，兩個都成功、各一行；Node 版與 Obsidian 版都跑（Windows 版 Obsidian 用開發命令 `files`）。回報寫 Obsidian 真的撞到時拋出的訊息。

## 5. 還原不列錯誤紀錄

`src/core/backup/plan.ts` 的 `planRestore`：`isErrorLogPath` 的檔不進 `files`、不進 `logs`，也不算「備份後才有」。寫在分類處，不改 `isLogPath`。

驗收：用公開的 `planRestore` 測三種情況（備份有、現在不見；同名不同內容；現在才有）都不出現在計畫裡；`紀錄/AI 輸出/` 的檔照舊「只補不見的、同名不同內容擋住」；複習紀錄的逐行補回不變。

## 6. 正式安裝存對照表

- `tools/build.mjs` 加一個選項（例如 `--sourcemap <路徑>`），用 esbuild 的 `sourcemap: 'external'` 另外寫出 map，`main.js` 不加 `sourceMappingURL`。`tests/build.test.ts` 加一條：同一份輸入加不加這個選項，`main.js` 逐位元組相同。
- `tools/install.ts` 的正式安裝：同一次建置輸出 `main.js.map`，存進 `.local/releases/<版號>/`，雜湊記進 `release.json`；不複製到 vault（`OUTPUTS` 不變）。舊的版本沒有 map 照常能退回。
- 新工具 `npm run locate -- <版號> <行:欄>`（`tools/locate.ts`）：先確認那一版保存的 `main.js` 雜湊和 `release.json` 相同，再用 Node 內建的 `node:module` 的 `SourceMap` 把位置對回原始檔與行；對不上就停，說明原因。stack 的行、欄是 1 起算，`findEntry` 是 0 起算。
- **Windows 版 Obsidian 驗一次**：開發命令（例如 `error-probe`）從一行已知的原始碼拋錯，讀錯誤紀錄裡的 `stack`，用同一次建置的 map 對回去，要對到那一行；Obsidian 載入外掛時有沒有多出行或欄的偏移，寫進回報與 `tools/locate.ts` 的註解。

## 7. 實測（開發版，Windows 版 Obsidian）

開發命令 `error-probe` 依序製造：同步拋錯（計時器裡）、非同步拒絕、複習畫面的 React 錯誤（掛一個會拋錯的元件，或讓 `Markdown` 的渲染失敗）、同一個錯誤連續 12 次。讀 `Essence Cards/紀錄/錯誤/` 當月的檔：每種一行、`where` 對、`stack` 有自己的程式位置、連續 12 次只有 2 行（第 1 次與 `n: 10`）。§8 的回報：在測試 vault 開一次複習，點旗子選一項，當月的檔多一行 `report`，`lt`、`v` 是畫面上那張卡。結果寫成結果檔，照試作場的做法。

**iPhone**：不在這次。完成時在 [backlog](../docs/backlog.md#v1-需要做的任務)「下一次 iPhone 實機測試」那一列加一項：在 iPhone 跑 `error-probe`，重開 Obsidian 後檔案還在，經 iCloud 回到電腦讀得到，`stack` 的格式和 Windows 一樣；旗子在英文卡（有自動朗讀開關）的上方那一排擠不擠、選單一隻手點不點得到，打字卡鍵盤開著時回報、回來後字還在。

## 8. 複習畫面的回報（D-160）

在 §1、§2 之後做，用同一個記錄器。

- 記錄器加 `report({ kind, path, lt, v }): void`，和 `record` 一樣不回傳 Promise、永遠不拋錯；一行照 syntax.md §9 的 `report`（沒有 `msg`、`stack`）。去重的鍵是 `lt`、`v`、`kind`；月上限、寫不進去就丟照 §1。
- `Review.tsx` 上方那一排加旗子圖示（`aria-label="回報問題"`），在「結束複習」左邊，「結束複習」仍貼在最右邊；畫面上有卡時才出現，動畫期間停用。回呼從 `openReview` 的選項傳進來（例如 `onReport(kind, card)`），沒有傳就不顯示圖示；元件不拿 `Files`、不 import `main.ts`。
- 點了開一張選單：D-160 第 1 點的五項加「取消」，文字照那裡；按鈕夠大，iPhone 上一隻手點得到。選單開著時，`onKey` 的按鍵、滑動、點卡片與自動換卡（念完自動換卡、離開一陣子回來的處理）都不作用；Esc 與「取消」關掉。
- 選一項：交出那張卡（正在回看時是回看的那張）的卡組、`lt`、`v` 與代號，關掉選單；`main.ts` 用 Notice 提示「已記下，可以跟家長說一聲」。卡片的狀態不變（翻開了沒有、打字卡的步驟與已打的字），不寫複習紀錄、不改排程。
- 樣式用 `Review.css` 與 `tokens.css` 現有的變數（[D-052](../docs/decisions.md#d-052-樣式用純-css)、[D-058](../docs/decisions.md#d-058-複習畫面的樣式)），不加套件。

**驗收**：

- 記錄器（Node）：一筆 `report` 的那一行逐字等於自編的預期字串；同一張卡同一項 12 次只有 2 行；同一張卡不同項、不同卡同一項各算一個。
- 畫面（`tests/review-ui.test.ts` 的替身）：選單開著時按自評的鍵、滑動、點卡片都不換卡、不寫紀錄；選一項後回呼收到正確的卡組、`lt`、`v`、代號，卡片還是同一張、同一面；回看上一張時回報的是那一張；打字卡打到一半回報，回來時字還在；沒傳回呼、讀取中與完成畫面都沒有圖示。
- 接線（`tests/main-wiring.test.ts`）：回呼接到記錄器的 `report`，並出一次 Notice。

## 自我測試

- `npm run check` 全過；`npm run build` 的 `main.js` 只 require 原本那三個。
- 上面每一節的驗收都有對應的測試或結果檔；先看到測試失敗再修到通過（code-quality「測試」）。

## 完成後

1. 這份說明的狀態行改成實際狀態；文末加〈結果〉：每節的 commit、測試數、Windows 實測的結果檔與 Obsidian 真的撞到時的訊息、對照表定位有沒有偏移。
2. 寫 `tasks/error-log-review.md`（照 code-quality 的 `review.md` 範本），回覆使用者一段可以貼給新 Codex session 的訊息，建議推理等級：高。
3. `docs/agents/quality.md` 的「本專案的做法」再加一條維修時怎麼讀：使用者回報問題，或問有沒有學生的回報（`where: "report"`，用 `lt` 找到卡組那一行）時，先讀 `紀錄/錯誤/` 那段時間的行，用 `build` 找版本，要對原始碼時用 `npm run locate`；紀錄可能因同步、上限或寫入失敗而缺漏，沒有那一行不代表沒發生。
4. roadmap 的「已完成」加一列，backlog 的「正式版的錯誤紀錄」那一列改成實際狀態；合併後移除。

## 這次不做

§8 以外的畫面與提示；給家長的回報列表（D-160 第 5 點，第二階段）；「複製問題報告」命令與查單一目標排程的工具（[規畫](../docs/plans/maintenance.md)的 G2、G3）；讀取很慢或一直不回來的紀錄（[D-154](../docs/decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測) 第 4 點）；備份重檢與更新命令對錯誤紀錄的特別處理；說明書的那一句（寫說明書時照 D-155 第 7 點）。

## 結果

### 實作（2026-10-30～31，Opus 5.5）

基準 `b456a20`；開工時「基準與開工條件」列的檔都沒改過。分支 `claude/error-log` 從 `main` 的 `1e6b00a` 開，在 `../Essence-Cards-error-log`。做完後把 `origin/main`（`eda8739`，含外掛內備份第一部分）合進來：`f1eb85d`，衝突的處理見[審查請求](error-log-review.md)〈實作者自己選的做法〉。syntax.md 沒改；複習紀錄與備份檔的格式沒變；沒加套件。

| 節 | commit | 新的測試 |
|---|---|---|
| §1 記錄器 | `ac3a98f` | `tests/errors.test.ts` 14 個（欄位與順序逐字比 syntax.md §9 的範例、截斷、非 Error 值、自己的程式位置、去重、500 個鍵、月上限、讀不到、換月、寫不進去、時區不合法、`after`） |
| §2-3 初始化的漏報 | `ac51f6e` | `tests/state-init.test.ts` 5 個 |
| §2 接線 | `b64a0ed` | `tests/main-wiring.test.ts` 5 個、`tests/review-host.test.ts` 1 個、`tests/review-ui.test.ts` 1 個；`tests/helpers/obsidian.ts` 加 `unload()`、指定路徑的 `failWrite`、`failWatch` |
| §2-4 `no-console` | `5730026` | `tests/quality.test.ts` 1 個 |
| §3 每個 `catch` 都要交代 | `2ec81e8` | 文件與註解（`docs/agents/quality.md`、7 處空的 `catch`／`.catch()` 補理由） |
| §4 同時建資料夾 | `f8a5596`、`97768e2` | 契約 C17（Node、記憶體版）、`tests/obsidian-files.test.ts` 2 個 |
| §5 還原不列 | `1b4624c` | `tests/backup-core.test.ts` 1 個 |
| §6 對照表 | `2621dd3`、`1d00ce9`、`2bd98c1`、`6f4afa5` | `tests/build.test.ts` 1 個、`tests/install.test.ts` 改 1 個、`tests/locate.test.ts` 2 個 |
| §8 回報 | `e173f63`、`549803f`、`773d4fe` | `tests/errors.test.ts` 2 個、`tests/review-ui.test.ts` 4 個（另改「上方列四格」成五格）、`tests/review-host.test.ts` 1 個、`tests/main-wiring.test.ts` 1 個 |
| §7 開發命令 | `657c0ab`、`05c4b36`、`6f4afa5` | `error-probe`（`src/obsidian/dev-errors.ts`） |

每個新行為先看到測試失敗再改（§1 的模組不存在、§2-3 的兩個漏報、§4 的 `Folder already exists.`、§5 的三種分類、§6 的對照表沒存、§8 的四個畫面測試）。合併 `origin/main` 之後 `npm run check` 全過（測試數見審查請求）；`npm run build` 的 `main.js` 只 require `obsidian`、`@codemirror/state`、`@codemirror/view`（電腦專用的資料夾照 D-148 另外載入，是合併進來的備份）。

**§2-3 選了 `init`**：`ErrorSource` 加 `'init'`（syntax.md §9 本來就有這個 `where`）。`state.ready()` 的拒絕：讀取那一列已經報過 `read` 的不再報；`close()` 之後不報；其他（`files.watch()` 拋錯、首次排程 `planToday` 或版本行拋錯）報一次 `init`。

**§3 改到的空 `catch`**：`src/main.ts`（版本命令的 `flush`）、`src/obsidian/files.ts`（排隊）、`src/obsidian/save.ts`（`ready()`）、`src/state/writes.ts`（寫入的那一列）、`src/core/study/log.ts`（背景寫入）、`src/ui/start.ts` 兩處。回傳結果或問題清單的 `catch`（備份清單、zip、卡組屬性、紀錄解析）不是空的，沒有動。

### Windows 實測（2026-10-30～31，測試 vault，Obsidian 1.14.5）

結果檔在測試 vault 的 `Essence W5/結果/`，全名是「`<命令> Windows-c50c <日期> <時間>.json`」。最後一次是合併後的建置 `0.1.0+f1eb85d.dirty`（只有文件還沒提交）：`files 2026-10-31 000327`、`error-probe 2026-10-31 000349`。合併前在 `05c4b36`、`773d4fe` 各跑過一次，結果相同。

- **`files`**：C1～C17 全部通過。**Obsidian 真的撞到時的訊息**：對已經存在的資料夾 `vault.createFolder` 拋 `Folder already exists.`（`folderExists`）；兩個 `createFolder` 同時送出、都還沒完成時兩個都成功（`folderRace`）。所以會撞到的是 Codex 替身重現的那個順序：`Files` 先查不到資料夾，輪到它建時另一個寫入已經建好；§4 的修正正是接住這一種。
- **`error-probe`**（六種，每種一行、`where` 對、`stack` 都帶 `plugin:essence-cards:行:欄`）：計時器裡同步拋錯與非同步拒絕都是 `uncaught`；同一個錯誤 12 次剛好 2 行（第 1 次與 `n: 10`）；卡片顯示不出來是 `render`，帶卡組的路徑；複習畫面的 React 錯誤（effect 裡拋錯）是 `ui`，畫面被 React 卸載（沒有 fallback 畫面，照 D-155）；回報：在測試 vault 開複習，點旗子、選「其他」，當月的檔多一行 `report`，`kind`、`path`、`lt`、`v` 和畫面上那張卡相同，卡片沒換、選單關上。`others` 是空的（沒有多記別的錯）。
- **對照表定位**：同一次建置另外輸出 `main.js.map`（`node tools/build.mjs --dev --sourcemap`，產出的 `main.js` 和裝進 vault 的 SHA-256 相同），用 `tools/locate.ts` 的 `locate()` 查錯誤紀錄裡的五個位置，**都對到拋錯的那一行**（欄指在 `Error(`），例如 `233:50 → src/obsidian/dev-errors.ts:33:36`。**Obsidian 載入外掛時沒有多出行或欄的偏移**，寫在 `tools/locate.ts` 的註解（`OFFSET` 是 0）。
- **畫面**（`error-probe 旗子.png`、`選單.png`、`英文卡.png`）：旗子在 ✕ 左邊；選單從下方升起，五項加「取消」，每列 52px；英文卡那一排（上一張、計數、自動朗讀、旗子、✕）在寬視窗不擠。第一輪截圖看到深色主題下遮罩反而把畫面調亮、選單畫了白色的焦點框，`773d4fe` 修掉。iPhone 寬度沒截（在 iPhone 實機測試看）。

**沒做的**：iPhone 的部分照說明不在這次，已加進 [backlog](../docs/backlog.md#v1-需要做的任務)「下一次 iPhone 實機測試」那一列。滑動手勢在選單開著時不作用，只在程式裡擋（`reportingRef`），Node 的畫面替身沒有觸控，Windows 也沒送觸控事件，iPhone 實機時一起看。說明書的三句（D-155 第 7 點、D-160 第 6 點）跟說明書一起寫。
