# W6 iPhone 測試後的畫面修改：審查請求（給 Codex）

狀態：等使用者轉給 Codex（2026-10-28）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（畫面的 DOM 後處理與 React portal、自動換下一張會寫紀錄、語音的結束回報，三件互相牽動）。

這一批是 [D-145](../docs/decisions.md#d-145-複習畫面再精簡拿掉分隔線答案不重複一行一個喇叭) 的實作，只改複習畫面與朗讀，照 [docs/agents/quality.md](../docs/agents/quality.md) 不屬於高風險範圍；但使用者在 iPhone 上來回測了四次、每次都改一些，**使用者要求合併前請你審查程式乾不乾淨、有沒有問題**。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-w6-polish`，分支 `claude/w6-polish`，HEAD `2ad863b`，沒有未提交的修改。
- **看這一輪的程式用 `git diff 69d8fc4 2ad863b -- src tests tools`**（16 個檔，+718／−113）。`69d8fc4` 是分支和 `main` 的合併基準：分支在 `030b3b3` 合併過 `main`（帶進 A3 的 `save.ts`、`dev-events.ts` 等，A3 另有審查，不用看）；分支自己的程式從 `d14a5d7` 起都在這個 diff 裡。commit 訊息寫了每一步做了什麼（`git log --oneline 69d8fc4..2ad863b`）。
- 這一批是照使用者在 iPhone 上的回饋一輪一輪改的，前面的做法有被後面推翻（例如喇叭先浮在右邊、後來改成接在最後一個字；先用不斷行字元、後來改成包住最後一個字）。**請特別找改了一半留下的東西**：沒人用的 class、過時的註解、只剩一半作用的分支。

## 規格與優先順序

- 主要規格：`main` 上 [D-145](../docs/decisions.md#d-145-複習畫面再精簡拿掉分隔線答案不重複一行一個喇叭) 第 1～7 點（第 6、7 點是 iPhone 實測後的調整），與 [tasks/w6-polish.md](w6-polish.md)（任務、L1 對照、四次 iPhone 測試的回饋）。
- 沒改的行為以 [W6 任務說明](w6.md) §2～§3 為準：[D-121](../docs/decisions.md#d-121-打字卡答錯時的三步流程) 的三步流程（D-145 改了兩處：拼錯用打叉、按「沒印象」後走完自動換下一張）、[D-116](../docs/decisions.md#d-116-打字卡的沒印象與自動朗讀) 的自動朗讀、[D-084](../docs/decisions.md#d-084-回看上一張與滑動手勢) 的回看與改評分、D-074 的中斷。
- 規格互相衝突或有漏洞時列成問題。

## 請特別看

1. **Obsidian 渲染出來的 DOM 與 React portal**（`src/ui/Markdown.tsx`、`src/ui/Review.tsx`）：`Markdown` 非同步渲染後依序做 cloze → `insertLines`（含 `breakBeforeEnglish`）→ `glueText`（英文題目）→ `applyState` → `attachTail` → `onSlot`。輸入框用 `createPortal` 放進 `.ec-slot`（狀態在 `Review` 根元件、以 `cardKey` 對應），喇叭用 `Markdown` 自己的 `tailEl` 放進 `.ec-tail`。請看：渲染重跑或換卡時 portal 會不會指到已經拿掉的元素；`applyState` 每次 render 都跑，會不會動到 slot、tail 裡的東西；改文字節點（`breakBeforeEnglish`、`glueText`、`attachTail` 的 `splitText`）會不會弄壞填空、連結、公式或圖。
2. **只剩一個自評時自動換下一張**（`Review.tsx` 的 `autoRated` 那個 effect、`commit`；`src/review/session.ts` 的 `rateOnly`；`src/ui/speech.ts` 的 `whenIdle`）：`rateOnly` 把 `revealedAt` 設成 null 繞過 0.3 秒。請找會重複記、記錯張、或永遠不記的組合：念到一半回看、關掉自動朗讀、按 ✕、切走超過 60 秒（`resume` 從頭開始）、等念完時自己先按了底下的「沒印象」、完成畫面、沒有英文語音的電腦。
3. **`whenIdle` 的語音計數**（`speech.ts`）：每次 `say`／`stop` 換一代、`pending` 算還沒念完的段數。iOS 的 `speechSynthesis` 在 `cancel()` 時對每段送 `end` 或 `error` 的方式不一定；請看 callback 會不會叫兩次或永遠不叫。
4. **照打的對象**（`session.ts` 的 `copy`、`submit` 第 3 步）：比對改成對「正確拼字」那一行（最接近的答案），走完時線上寫學生照打的那一個。請確認紀錄的格式完全沒變（只有 `typed`、`retry`），回看、改評分照舊。
5. **題目固定在上方**（`Review.tsx` 的 `ResizeObserver` effect、`Review.css` 的 `.ec-q.is-sticky`）：加上 `is-sticky` 會改題目的 padding，再觸發 resize，會不會來回切換；cleanup。
6. **CSS**（`Review.css`、`Markdown.css`、`tokens.css`）：為了蓋過 Obsidian 手機版的按鈕樣式加長的選擇器、`:has()`（iOS 的支援）、`@media (pointer: coarse)` 的 50vh、`--ec-stage-top` 與 sticky 的 `top`、`text-wrap`；以及改來改去留下、已經沒有元素用的規則。
7. **開發命令**（`src/obsidian/dev-review.ts`、`dev.ts`，只在開發版）：`blankHistory` 這個 `Files` 包裝是否符合 `src/core/files.ts` 的契約（`list` 排序、`watch`、紀錄以外的路徑原樣轉交）；`practice` 在外掛停用時關掉；`ui-phone` 插入的 `<style>` 在出錯時也拿掉。
8. **測試**（`tests/review-ui.test.ts`、`tests/review.test.ts`、`tests/speech.test.ts`、`tests/helpers/review-ui.ts`）：替身多了 `react-dom` 的 `createPortal`（原地畫）、`Markdown` 替身在 render 時叫 `onSlot`、把 `tail` 當 children 畫。這些替身會不會讓真的時序問題測不出來；新的測試有沒有真的擋住回歸。

## Claude 自己選了做法的地方（請逐點回覆）

1. 輸入框放進空格用 `createPortal`，slot 狀態放在 `Review` 根元件、用 `cardKey` 對應（測試替身只支援根元件的 hook）；題目沒有 `＿＿` 時退回題目下面的輸入框。
2. 喇叭接在最後一個字：`attachTail` 一律把最後一段文字的最後一個字（中文兩個字）包進 `.ec-tail`（`white-space: nowrap`），喇叭 portal 進去；最後的字在連結裡時接在連結後面。原本試過在喇叭前放 WORD JOINER，按鈕前一定可以換行，沒有用。
3. 冠詞連著下一個字（`glueArticles`）只套在英文題目，不套在答案與背面補充。
4. 自動換下一張用 `whenIdle` 等**任何**正在念的聲音（包括學生自己按的喇叭），不只等自動朗讀；語音沒回報念完時底下那一顆「沒印象」照樣能按。
5. 題目超過捲動區三分之一高就不固定；固定時 `top` 減掉捲動區的上留白，讓捲上去的字不從題目上面露出來。
6. 照打時的即時比對：打了字就顯示（使用者要求，打對也顯示），接在「照著打一次」後面同一行；「確認」排在答案與補充後面。
7. 打字中不畫底部那一排（`.ec-actions`），「沒印象」「確認」在卡片裡；手機打字時捲動區底下多留 50vh。
8. `ui`／`ui-phone` 改讀記憶體裡的空白紀錄（每次從新卡開始），所以不再實際寫進、再取消真正的紀錄檔；`undoAll` 照舊跑在記憶體的紀錄上。
9. 打字卡點卡片任何地方都把焦點給輸入框（空格比原本那一行小）。
10. 沒有自動朗讀開關的卡，上方列放一個空的 `<span>`，✕ 和英文卡在同一個位置。

## 行為與風險

- 不改的：卡組解析、`state`、排程、紀錄的格式與寫法（自動換下一張和手按「沒印象」寫同一行）。
- 只在 iPhone 看得到、Claude 測不了的：鍵盤、`whenIdle` 在 iOS 語音上的實際事件、Obsidian 手機版的按鈕樣式。使用者四次 iPhone 測試的回饋都已改，第四次看了按鈕與打叉、照打的比對，另外要求出處按鈕改細框（`2ad863b`，iPhone 還沒看）。
- 請自己找新的組合，例如：打字卡的題目有粗體或連結、英翻中的題目只有一個字、題目以中文結尾的打字卡、答案格有三個以上的答案、補充只有圖片、回看一張自動換過的卡、連續兩張都按「沒印象」。

## 驗證方式

- Node 24 以上（Claude 用 v24.13.0）。在 worktree 裡：`npm ci`、`npm run check`（Claude 跑過：556 個測試通過）。
- Claude 在 Windows 版 Obsidian 1.14.5 跑過開發命令 `ui` 與 `ui-phone`（56 步沒有出錯、紀錄沒多、今天的份不變），截圖與結果檔在測試 vault 的 `Essence W6/結果/`（vault 不在 repo，不用看）。

## 回報

寫在主資料夾的 `Claude Codex Discussion/2026-10-28-w6-polish-review.md`（不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／乾淨程度／設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 「請特別看」的 8 點逐點寫結論；「Claude 自己選了做法的地方」的 10 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。
