# 題型接點第一步的行為查核

狀態：第二輪複查通過（F1，`743601a`）

舊版 `283f4c689029522b6d6922aceccdf863bd7afe35` 是共同祖先。新版為分支 `claude/question-type-seam-927507` 的 `8bd9feb6f14b8ed2eb899d7854f5c7f886071f34`，查核時指定工作樹的 HEAD 相符，且沒有未提交的變更。依該分支的 `tasks/question-type-seam.md`（`8bd9feb`）§2，只查畫面行為與紀錄內容。發現一項鍵盤焦點退化，受測的複習紀錄逐檔比對沒有差異。

## F1｜鍵盤切換題型時，已聚焦的評分按鈕消失

**規格｜已重現｜真實產品路徑可觸發。** 兩版都用 React DOM 19.3.1 與 happy-dom 跑各自的 `Review`、`Markdown`、`parseDeck`、`createPreview`。Obsidian Markdown renderer 用純文字替身，開啟減少動態效果，讓換卡直接執行。

1. 在含英翻中翻面卡與中翻英打字卡的筆記啟用「預覽時自動展開答案」，打開預覽。可用下方的兩個目標。
2. 在第二張打字卡，用 Tab 把焦點移到「記住了」，按 ← 回第一張。也可在第一張的「記住了」按 →，往第二張切換。
3. 舊版在兩個方向都保留同一個 `button[data-k=good]` DOM 節點及其焦點，Enter 的預設按鈕操作仍可用。新版在兩個方向都重建該按鈕，`document.activeElement` 變成 `.ec-app`。實測回第一張後，Enter 在舊版未被攔截，在新版被 `Review` 攔截並走已展開卡片的翻面分支，原本的評分按鈕不會被啟動。

```markdown
- test 英翻中 ^flip
    - test :: 測試
- go 中翻英 ^typed
    - I ＿＿ home. :: went
```

**影響。** 習慣用方向鍵切卡、用 Enter 操作已聚焦按鈕的人，換題型後要重新移焦。預覽的設定、編輯器入口及全螢幕畫面都接得到這組操作（`src/obsidian/settings.ts:105`、`src/obsidian/deck-actions.ts:99`、`src/main.ts:182`）。這條重現路徑沒有作答紀錄。

**位置。** 舊版 `src/ui/Review.tsx:346–348,380–385` 的底部共用同一個 `Actions`，評分按鈕以 rating 為 key。新版 `src/ui/Review.tsx:314` 在同一位置依題型渲染不同的 `screen.Bottom` 函式（分支 `claude/question-type-seam-927507` 的 `src/ui/screens.tsx:172,257`，`8bd9feb`），React 因此卸載整個底部，再由 `Review.tsx:106–109` 把焦點拉回根元素。畫面替身的樹比對看得到兩邊按鈕的屬性相同，沒有比對節點身分或焦點。建議在合併前恢復兩種已展開的卡互換時，既有評分按鈕及焦點能留在原處的行為。

## 驗證結果

| 驗證 | 結果 |
|---|---|
| 四個鎖定測試檔 | `git diff --exit-code 283f4c6 8bd9feb -- tests/review-session.test.ts tests/review-ui.test.ts tests/review.test.ts tests/preview.test.ts` 為空。單獨執行共 93 項通過。 |
| 完整檢查 | Windows、Node v24.13.0，在沙箱外執行 `npm run check`，型別、ESLint、knip、secretlint、skill 副本、文件檢查及 1208 項測試全數通過，0 失敗、0 跳過。 |
| 檔案及關鍵字 | `src/review/session.ts` 找不到 `checkTyped`、`spelling`、`hintOf`，`src/ui/Review.tsx` 找不到 `typed.step`。`docs/syntax.md` 與 CSS 無差異。測試的唯一改動是 `boundaries.test.ts` 的匯出清單。 |
| `diff.mjs` | 種子 `8675309`，複習、預覽各 2000 串，每串 80 步，0 差異。含記憶檔案全文、通知次數、回傳值。腳本注入寫入失敗，兩版共記到 770 次未處理的 rejection，計數沒有按版本或錯誤種類拆開。 |
| `ui-diff.ts` | 種子起點 `8675309`，500 串 × 60 步，0 差異。暫存副本用 `fileURLToPath` 解開工作樹路徑中的中文與空格，保留原比較邏輯。 |
| `parse-diff.mjs` | 種子 `8675309`，19,710 份完整 JSON，0 差異。涵蓋空答案、禁止的答案格式、答案字數不同。 |
| `mutate.mjs` | 隔離副本中 20 個故意改壞的版本全抓到。要求有正數差異摘要才算抓到。畫面改壞後舊版的下一個點擊索引可能不再適用，因此畫面的變異探針在第一個差異就收尾，讓差異摘要能印出。 |
| 真 React 探針 | 除 F1 外，分別對空格內的 portal 輸入與題目下方輸入框測打錯進提示、再打錯進照打、回報選單開關、照打成功。兩版打字期間保留同一個輸入框與題目 Markdown 容器，關選單後輸入框重新取得焦點，打完才卸載輸入框。合成的 `isComposing: true` Enter 兩版都不送出。 |

## 差分涵蓋與已知差別

- `canonView` 檢查 `blanks` 長度及其中的 `lt`、`prompt`、`target` 後才拿掉，其他 `view()` 欄位照原 JSON 比對。三個造卡入口 `nextCard`、`practiceNext`、`createPreview` 都經 `cardOf`，以同一組 `lt`、`target`、`prompt` 造自己的那一格。因而新版的停用檢查與重複 ID 檢查仍指向同一目標。
- `doneOf` 比較 `lt`、評分、出處摘要、可改評分、時間和寫入筆數。舊的打字快照欄位改放進 `look`，回看時由完整 `view()` 核對，改評分則由實際 JSONL 全文核對。查過產品呼叫端，`session.history()` 沒有產品讀者。回看重算時 `TypedView` 物件身分改為沿用快照，欄位相同，`Review` 的相關 effect 依賴整個 `view`，沒有依賴這個物件的身分。
- `serialize` 會比畫出的 children 和非函式屬性（包含 Markdown 的 `lines`、`words` 等值），排除 `ref`、`app`，`tail` 比畫出的內容，函式只比較是否存在。以共用 props 比對得到相同的畫面樹，涵蓋不了 React 元件身分和 portal 容器。就題目本身，`cardKey` 組法不變，`QaCard` 的題目 Markdown 與打字中的 portal 在同題各步驟位置穩定。兩版 `lines` 都是數字，`words` 都每次新建陣列。`Markdown.tsx:93,98` 的渲染 effect 依賴 `app/text/sourcePath/mode/lines`，layout effect 每次隨 props 套回顯示狀態。
- 清單之外，新版的 `src/review/index.ts:14` 也新增了 `questionOf` 匯出，供畫面共用原本的題目取值，無既有呼叫端受影響。原清單列的 study 匯出與測試調整核對相符。
- 隨機畫面的少見狀態包括第 1 步直接答對（14 次）、提示後答對（15 次）與可改評分的打字回看（80 次）。複習差分另經過照打可跳過、需要新版的停用、ID 重複及解除。既有測試補上精確邊界，包括 `review-session.test.ts:735` 的超過 60 秒與回看朗讀、`:855` 的重複解除後舊回看仍鎖、`:915` 的跨 04:00 改評分、`:943` 的同一時間戳取消被拒。變異探針也驗證了「未答的打字卡往後到預覽完成，再確認」以及「按沒印象的打字卡回看只剩原評分」能被差分抓到。
- `dev-review.ts:205–213` 的結果摘要讀 `View` 欄位，`dev-errors.ts:59` 讀 `view.card.typed?.input`，兩者沒有讀改形狀的 `DoneCard`。預覽入口仍解析編輯器當下的文字並傳入設定，`deck-actions.test.ts:141,158` 驗了開關、未存的文字與空卡組，F1 另沿該入口查到實際可觸發。

未跑 Obsidian 開發命令、實際 Markdown renderer、原生 IME、iPhone 或實機版面。隔離探針替換了 Obsidian host 與 Motion，能驗 React 的節點身分、事件和 DOM 焦點，實機輸入法與版面仍需由對應 host 驗證。

## 第二輪

**F1 複查通過。** 預覽與複習回看都能用方向鍵在已展開的翻面卡、打字卡之間來回。兩個方向都保留同一顆評分按鈕及焦點。預覽回到翻面卡後，Enter 沒有被 `Review` 攔截，探針接著模擬預設按鈕點擊，成功前進到打字卡。沒有發現新的行為差異。

- 差分用 `git archive <commit> src tsconfig.json` 分別取出 `283f4c689029522b6d6922aceccdf863bd7afe35`、修正前 `8bd9feb`、修正後 `743601a891b8f487cf0a0e72709d0f9d54b208dd`，共用指定工作樹的相依套件。工作樹 HEAD `a32d5c71ad34418bab5ffa76f4aeb07a55703024` 已併入 `main`，只用於整合後的完整檢查。
- `tests/review-focus.test.ts` 的兩個真 React 測試在舊版和 `743601a` 各通過兩項，在 `8bd9feb` 都因評分按鈕節點被換掉而失敗。修正位置在 `src/ui/Review.tsx:283,312` 與分支 `claude/question-type-seam-927507` 的 `src/ui/screens.tsx:175,258`（`743601a`）。兩種題型都把同一種 `Rates` 放在固定的底列位置，因此仍可沿用 rating 相同的按鈕。
- 另用真 React 對照回報選單、打字與完成畫面。選單開啟時，存在的底列有 `inert`、快捷鍵不翻面或評分，關閉後解除 `inert`。打字時底列不存在，關閉選單後焦點回輸入框。評完最後一張時，兩版都保留底列容器、顯示「結束複習」、把焦點移回複習畫面根元素。

| 驗證 | 第二輪結果 |
|---|---|
| 鎖定的四個測試檔 | `git diff --exit-code 283f4c6 743601a -- tests/review-session.test.ts tests/review-ui.test.ts tests/review.test.ts tests/preview.test.ts` 為空，對隔離取出的 `743601a` 單獨執行 93 項全過。 |
| `npm run check` | 指定工作樹 `a32d5c7`，Windows、Node v24.13.0，沙箱外執行。型別、ESLint、knip、secretlint、skill 副本、文件檢查及 1,375 項測試全數通過，0 失敗、0 跳過。 |
| `diff.mjs` | 種子 `391527`，複習、預覽各 2000 串 × 80 步，0 差異，受測檔案全文相同。注入寫入失敗的測試共記到 788 次未處理的 rejection，腳本沒有按版本或錯誤種類拆計。 |
| `ui-diff.ts` | 種子起點 `391527`，500 串 × 60 步，0 差異。暫存副本沿用第一輪的 `fileURLToPath` 路徑修正。 |
| `parse-diff.mjs` | 種子 `391527`，19,842 份完整 JSON，0 差異。 |
| `mutate.mjs` | 20 處全數抓到。沿用第一輪的判定，要求正數差異摘要，畫面變異在第一個差異時收尾。 |
| 真 React DOM 軌跡 | 種子 `391527`，120 串 × 50 步，含初始畫面共 6,120 筆。舊版對 `743601a` 0 串不同，兩版各有 39 次在換題型時保留評分焦點。舊版對 `8bd9feb` 有 59 串出現 DOM 或焦點差異，第一串按 → 就抓到焦點落回 `.ec-app`。 |

軌跡比較保留元素身分編號、元素焦點、文字、選定的屬性、事件、朗讀及這台裝置的作答檔內容。原本的 `ATTRS` 沒有列入 `aria-modal`、`aria-haspopup`、`aria-hidden` 和 SVG 屬性等。我在暫存副本改比所有 DOM attributes，用同種子再跑前 40 串，含初始畫面共 2,040 筆，仍為 0 差異。全量軌跡有 51 筆回報選單、34 筆帶 `inert` 的底列、1,580 筆打字畫面及 823 筆完成畫面。

未驗 Obsidian 與 iPhone 實機、實際版面、原生輸入法和觸控手勢。軌跡使用替身 Markdown renderer 與 Motion，直接移焦並以腳本模擬按鈕的預設啟動，因此可比 React 的 DOM 身分與焦點，沒有驗瀏覽器原生的 Tab 次序或 `inert` 行為。
