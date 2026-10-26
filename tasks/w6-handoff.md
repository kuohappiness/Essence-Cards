# W6 交接單（Fable 5.1 → Opus 5.5，2026-10-26）

遵守 repo 根目錄的 `AGENTS.md`。接手的 session 建議推理等級：**high**。這份交接單只寫「做到哪裡、怎麼接」；規格在 [tasks/w6.md](w6.md)，決定在 `docs/decisions.md`。做完 W6 之後把這份檔的內容併進審查請求與 roadmap，刪掉這份檔。

## 1. 在哪裡工作

- worktree：`D:\程式開發\Essence-Cards-w6`，分支 `claude/w6`，從 `main` 的 `ab2c99c` 開出來。**不要在主資料夾 `D:\程式開發\Essence Cards` 切換分支**；主資料夾留在 `main`。
- `npm install` 已在 worktree 做過。每個 commit 都經過 pre-commit hook 的 `npm run check`（型別、ESLint、knip、secretlint、skill 副本、測試）；不用 `--no-verify`。
- 注意 `npm run knip` 和 `npm run lint` 接 `| tail` 會蓋掉結束碼；要看結果用 `npm run check`，或分開跑不接管線。
- 測試 vault 的位置在 Claude 的記憶 `test-vault-location`，不寫進 repo；只動 `Essence W6/` 與 `Essence Cards/W6 範例/`（W5 的資料夾照 W5 的規定）。使用者的 Obsidian 可能開著別的 vault，不要關掉它。

## 2. 已經做完（commit 由舊到新）

| commit | 內容 | 規格 |
|---|---|---|
| `25130c9` | ` \| ` 拆開：`Prompt.typed` 改成 `readonly string[] \| null`；空的一段、含中文仍是 `typed-answer-invalid`；字數不一樣是新 hint `typed-answer-words`；`answer` 與指紋照舊；`checkTyped` 對中任一個就算對；syntax §2-3 與英文規則的例子進 `deckCases`，指紋和拆開前相同（`8ae9acd7`、`9938603d`）。backlog 那一列已刪 | §0-1、R1、R3 |
| `9af2cae` | `baseForm(target)`（`src/core/deck/base-form.ts`，由 index 匯出）：去掉「 中翻英」與最後一組全形括號；backlog 那一列改成只剩「找已學過的字」、觸發點「寫 AI 製卡模組時」 | §0-2、R2 |
| `2168eef` | A7：`stateEntry` 規則（state 以外只能 import `state/index.ts`）；`deviceCode`、`isDeviceCode` 從 index 重新匯出。W6 的邊界：`src/review/` 和 state 一樣純；`src/ui/`、`src/review/` 不能 import `core/files.ts`，也不能從核心 index 拿 `readDecks`、`parseDeck`、`readHistory`、`mergeHistory`、`appendLine`、`createLogWriter`、`planToday`、`nextCard`、`progress`、`replay`、`review`。`tests/quality.test.ts` 有擋下與放行的例子 | 限制第 3 點、R13 的規則部分 |
| `0b335b6` | A10：`main.ts` 只剩一處 `if (DEV)`；外掛發事件 `notice`、`event`、`removed`（`plugin.on(kind, listener)`），dev 模組自己訂閱成 `DevLog`；`wireIds()` 回傳 `{ tokens, saver }` 存在 `plugin.ids`；`plugin.lockAlso` 是開發版另外要鎖的路徑前綴；`dev-ids.ts` 的 `IdsHost` 改成 `{ app, state, devLog }`。測試 `A10 src/main.ts 只有一處 DEV` | 技術債 A10 |
| `2ea31fb` | A9：`tests/helpers/memory-files.ts`（記憶體 Files，過 C1～C14，通知同步送出）、`tests/helpers/obsidian.ts`（共用 obsidian 替身）。`state.test.ts`、`state-ids.test.ts` 改用記憶體 Files 加 `t.mock.timers`（`settle()` 推進 delay），各約 0.3 秒、沒有 `wait()`；`main-wiring`、`save-wiring`、`dev-wrap-files`、`study-io` 也改用；Node 版 Files 只在 `node-files`、`files-contract` 測。ESLint 的 `allowDefaultProject` 加 `tests/helpers/*.ts`、上限 60。backlog 刪掉 A7、A9、A10 | 技術債 A9 |
| `1efb25b` | `retry` 欄位：`NewEntry` 加 `retry?`，`encodeEntry` 順序 `t, lt, r, v, typed, retry, src`；`parseLine` 不讀；syntax.md §5 加一列。測試 R4（`study.test.ts`、`append-line.test.ts`） | §1 |
| `48cddfc` | `src/review/`（純程式）與 `src/ui/`（畫面）、`main.ts` 接線，見第 3 節。測試 `tests/review.test.ts`（R6～R9、R11、R12、完成畫面文字）、`tests/review-session.test.ts`（R5、R10，接真的 `createState`）。`tests/build.test.ts` 的開發版記號從 `metadataCache` 改成 `"dev-"` | §2、§3 |

`npm run check` 在最新 commit：415 個測試全過。`npm run build`：`main.js` 483,310 bytes（W5 第二部分是 165,986；多出來的是 React、react-dom、Motion）、只 require `obsidian`、`@codemirror/state`、`@codemirror/view`；開發版 524,400 bytes。`styles.css` 第一段是 `src/ui/tokens.css`。

## 3. 程式長什麼樣（接手前先讀這幾個檔）

- `src/review/session.ts`：`createSession({ state, pick, now })` → `Session`：`view()`（有快取，給 `useSyncExternalStore`）、`subscribe`、`ready()`、`reveal`、`input(text)`、`submit`、`skip`、`rate(r)`（回傳有沒有算數）、`back`／`forward`／`toCurrent`、`continueWith(pick)`、`close`、`history()`、`pick()`。`View` 是 `loading`／`card`／`done` 加 `top`。打字卡的狀態在 `TypedView`（`step`、`first`、`second`、`notice`、`hint`、`answer`、`attempt`、`live`、`firstAttempt`、`input`、`finished`、`canSkip`）。`CardView.autoRead` 是「最近一次動作讓這些文字該自動朗讀」，下一個動作清掉；畫面用 reference 判斷同一批只念一次。
- `src/review/` 其他檔：`spelling.ts`（`spelling`、`closest`）、`gesture.ts`（`lockAxis`、`gesture`，結果是 `scroll`／`tap`／`bounce`／`back`／`forward`）、`english.ts`（`englishParts`、`fillBlank`、`blankCount`、`BLANK`）、`crumb.ts`、`sources.ts`（`sourceLinks` → `block`／`heading`／`note`／`unit`／`text`）、`done.ts`（`todayStats`、`doneView`）、`start.ts`（`startRows`）。
- `src/ui/Review.tsx`：整個畫面；`Card`、`Actions`、`Done` 子元件；手勢、鍵盤、自動朗讀、量測事件（`ReviewEvent`：`opened`、`next`、`gesture`、`render-failed`、`closed`）。`src/ui/Markdown.tsx`：Obsidian 渲染，`mode` 是 `plain`／`cloze`／`typed`。`src/ui/host.tsx`：`openReview()` 掛在 `document.body`、攔截觸控、回傳 `{ session, close }`。`src/ui/start.ts`：`registerStart()` 命令 `start-review`「開始複習」加左側圖示 `graduation-cap`，`SuggestModal` 一列一科。`src/ui/speech.ts`：`createSpeech`、`loadAutoRead`／`saveAutoRead`（鍵 `essence-cards-auto-read`）。`src/ui/sources.ts`：`resolveSource`、`firstMaterial`（Obsidian 層）。
- `src/main.ts`：`registerStart` 在 `onload`；`startReview(pick)` 開畫面並把 `ReviewEvent` 用 `emit('review', …)` 發出去；`onunload` 關掉畫面；`PluginEvents` 多了 `review`。

## 4. 還沒做（照這個順序）

1. **在 Windows 版 Obsidian 先跑起來看**（還沒有任何一次在 Obsidian 裡執行過畫面）：`npm run install-vault -- <測試 vault> --dev`，用 URI `obsidian://essence-cards-dev?run=reload` 重新載入，再執行命令「Essence Cards：開始複習」。第一次很可能有要修的地方（CSS 與 Obsidian 樣式衝突、`MarkdownRenderer` 的 sourcePath、輸入框焦點、`SuggestModal` 的樣子）。先把 `Essence Cards/W6 範例/` 的兩篇卡組寫進測試 vault（§4 的清單：英文用 syntax §2-2、§2-3 的例子加 `light（輕的） 中翻英`、一個答案等於原形的、有記憶錨點的；自然用 §2-2 的例子加多行答案、公式、長答案、頁碼出處且材料找得到）；在電腦按過「存檔」補 ID。
2. **開發命令（§4）**，寫在 `src/obsidian/dev.ts`（結果寫 `Essence W6/結果/`，`root` 目前是 `'Essence W5'`，W6 的要另外用 `'Essence W6'`）：
   - 自動量測：訂閱 `plugin.on('review', …)`；每次打開記 `opened`（第幾次）、`next` 的中位數與最大、`gesture` 的結果與 `sidebarOpened`、`render-failed`；收到 `closed` 時寫一個檔。
   - `review-script`：對 W6 範例的英文卡組用 `plugin.startReview({ subject: '英文' })` 回傳的 `session`（或直接 `createSession`）照劇本做：英翻中「記住了」；打字卡第 1 步拼錯 → 第 2 步拼錯 → 第 3 步照打 → 「差一點」；另一張打字卡「沒印象」→ 第 2 步拼對 → 「沒印象」；回看第一張改成「太簡單」。結果檔寫每一行紀錄與每一步的畫面階段；最後用 `state.answer({ undo })` 把這次的作答全部取消，確認 `today` 回到原樣。注意 `rate` 的 0.3 秒規則：劇本裡要等 300 ms 或讓 `createSession` 的 `now` 可控。
   - `voices`：`speechSynthesis.getVoices()` 裡英文語音的數量與名稱。
   - 把這三個命令的名稱加進 `tests/build.test.ts` 的開發版記號（R14）。
3. **R13**：故意讓 `src/review/` import `react`、`src/ui/` import `planToday`、`src/ui/` import `core/files.ts`，確認 `npm run check` 都失敗，測完還原、不留 commit（規則本身已有測試 `tests/quality.test.ts`）。
4. **R14**：`tests/build.test.ts` 加 `styles.css` 第一段是 `src/ui/tokens.css` 的檢查（W1 的 CSS 合併測試已涵蓋排序，可以補一條對真的 build 的斷言）；開發命令名稱不進正式版。
5. **W6 §6 Windows 版 Obsidian 的實測**（AI 自己做，用 computer-use 截圖）：W1 自動複習、W2 淺色與深色各一組圖（每張寫一句看到什麼）、W3 鍵盤、W4 速度（第一次 ≤ 1,000 ms、之後 ≤ 400 ms）、W5 朗讀（使用者的 Windows 很可能沒有英文語音：提示只一次）、W6 寫入（卡組筆記沒變、紀錄只多自己的行）。
6. **文件**：`docs/roadmap.md`「現在在哪裡」與「已完成」（commit 寫進去）、`docs/backlog.md` 技術債（§0 兩列已處理；W5 的 iPhone 量測那一列等 iPhone 測完才刪）、審查請求 `tasks/w6-review.md`（格式照 `tasks/w5-review.md`，「請特別看」照 w6.md〈完成後〉，加上第 5 節的「自己選了做法的地方」）。
7. **不自行合併**：寫好審查請求後請使用者交給 Codex 做 L2。iPhone 測試（§7）在 L2 之後、合併前；§7 的前提是 `main` 已合併進 `claude/w6`（第二部分已在 main，W6 從 `ab2c99c` 開出，已含）。

## 5. 自己選了做法的地方（審查請求要逐點列出）

1. **0.3 秒的規則也套在打字卡**：答案出現（第 1 步拼對、第 2 步拼對、進第 3 步）後 0.3 秒內的自評不算，和一般卡翻面相同；避免按「確認」後誤按自評。
2. **第 3 步的「最接近的答案」**用編輯距離（`closest`），一樣近取前面的；第 3 步照打時的即時比對（`live`）是對「寫在線上的答案」（拼對時是對中的那一個，否則第一個），結束的條件是 `checkTyped`（對中任一個）。
3. **原形等於某一個答案就跳過第 2 步**，比對不分大小寫（D-121 寫的是答案和原形相同；多個答案時任一個相同就跳過）。
4. **回看時改評分不換目前這張、不重新 `next`**；改成差一點／沒印象的再出交給下一次 `next`。
5. **`autoRead` 的語意**：留在 view 上直到下一個動作，畫面用物件身分判斷只念一次（因為 `state.onChange` 會讓 view 重算）。
6. **出處**：純函式把每一項分成 `block`／`heading`／`note`／`unit`／`text`；Obsidian 層依序找第一份有那個區塊或標題的材料；**頁碼與圖表都找不到時打開第一份材料；標題在材料裡都沒有時照文字顯示**（例如 `先備：國一數學 比例式`），不打開第一份材料。沒寫出處時打開第一份材料。跨單元（`unit`）照文字顯示，結構已能接範圍與目錄模組。
7. **典型答案的背面**：打字卡的 `.ec-a` 照原文渲染答案格（含 ` | `），不改寫；答案另外寫在線上。
8. **英文語音**：`getVoices()` 回傳空清單（還沒載入）時當作有語音照念，不提示；只有清單非空且沒有 `en*` 才提示一次。iPhone 的語音清單常是空的。
9. **`SuggestModal` 的列**：`約 M 分鐘` 用 `remainingSeconds` 進位到分鐘、至少 1；做完的列選了照樣開畫面（進完成畫面）。
10. **評分動畫**：自評後先寫紀錄換卡（`session.rate`），再做滑入；沒有滑出（舊畫面已不在）。回看與換卡的滑動照試作外掛（0.11／0.16 秒）。
11. **技術債 A1 與「卡組讀不到就整個重試」那一列沒碰**（使用者只指定 A7、A9、A10 與 §0）；A1 的觸發點寫著「W6 加 retry 欄位」，另一列的觸發點是「W6 的 iPhone 測試前」，要請使用者決定何時做。
12. 為了 ESLint 的型別檢查把 `allowDefaultProject` 的上限從 30 提高到 60（檔案數已超過 30）。
13. `tests/build.test.ts` 的開發版記號：正式版現在會用 `metadataCache`（出處），記號改成命令 id 前綴 `"dev-"`。

## 6. 已知的縫隙與風險

- 畫面完全沒在 Obsidian 跑過；React 19 的 `createRoot` 在 Obsidian 的 Electron 與 iOS WebView 應該沒問題（試作外掛用過 React）。
- `Markdown.tsx` 的 `useLayoutEffect` 依賴 `props` 整個物件，每次 render 都會重跑 `applyState`（成本小，但可以改成只依賴 `revealed`、`words`）。
- `Review.tsx` 的 `Actions` 在回看時的按鈕：打字卡顯示 `allowed`（能改成的）；一般卡顯示四個；當時按的那一顆 `aria-pressed`。按「沒印象」的打字卡回看時只顯示那一顆、不能按。
- 填空題翻面後空格的答案是 `<mark>` 的文字（純文字，粗體樣式由 CSS 給），和樣式稿一致；公式或圖在 `==…==` 裡沒有處理。
- `host.tsx` 攔截 `touchstart`／`touchmove`／`touchend` 的傳遞；Obsidian 的側欄手勢要在 iPhone 實機確認（試作外掛同樣做法通過）。
- 開發版的 `beforeLayoutReady` 計數仍在 `main.ts` 的 `if (DEV)` 裡（規格允許的那一處）。
- 新裝置的自動朗讀預設關（`loadLocalStorage` 不是 `true` 就是關）。
