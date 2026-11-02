# 重複的學習目標 ID：先停、家長選（D-157）：L2 獨立審查（給 Codex）

狀態：Codex L2 的 F1 修在 `0dba117`、`d145505`，再審的 R1 修在 `ae712a5`、`5650dcd`，第三次審查的 R2 修在 `f1815fc`，等第四次審查；[報告與 Claude 的回應](<../Claude Codex Discussion/2026-11-02-duplicate-ids-review.md>)

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（跨 `src/core/`、`src/state/`、`src/review/`、`src/obsidian/`，改 ID 與寫回卡組筆記）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)，[任務說明](duplicate-ids.md) §1～§7 由 Claude（Opus 5.5）實作。屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md#高風險範圍要做-l2)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。報告寫在 `Claude Codex Discussion/2026-11-02-duplicate-ids-review.md`。

## 審查對象

- **工作目錄**：`D:\程式開發\Essence Cards\.claude\worktrees\state-split-c5c7bf`（git worktree），分支 `claude/reverent-wing-577df1`，沒有 push（本機的分支，各 worktree 共用）。任務說明寫的 `claude/duplicate-ids` 只是建議名稱，分支照 app 開的。**不是**主資料夾 `D:\程式開發\Essence Cards`（那裡是 `main`，沒有這些程式的 commit）。沒有未提交的修改。
- 從 `main` 的 `3c67941`（完整 SHA 見 `git rev-parse 3c67941`，已包含 D1 的 `b9309ca`）開出。程式的 commit（由舊到新）：
  - `7a81e18dfe9aaeb847b15098ff0b7f54e55b1a9c`：§1、§2（衝突的判斷、不出題、不收作答、存檔與離開筆記跳過）。
  - `15b2ace3fe325d5b9d4278f1a7674413451e6590`：§3-1（`assignIds` 已有 ID 的一律不換，刪 `replace`；`duplicate-id` 的文字）。
  - `c9747475c8c7701d6575211c4e35a8bfdd3fa176`：§3-2（`duplicate` 問題、寫回、刻意拿掉的保護）。
  - `5eec0395f4dbef37f4c543b3352a42277865d8ec`：§6（`planToday` 的防呆、拿掉 `Today.problems`、開發命令 `today`；判斷函式從 `core/deck` 搬到 `core/study`）。
  - `9edd121f000516e797a52385f104f6af254ec738`：§5（已顯示的卡與回看）。
  - `fbd1ee47b49fc1f0a5f2e9d461280939b645f1d4`：§3-3（小視窗、跳轉、離開筆記的通知）。
  - `801c8f1aa0ee9d2a5179b0b731b1e6d074590fef`：§9 的開發命令 `duplicates`。
  - `76d9c744e96f09a72a3bcf8d24d7b582e267aa7f`：§7（syntax 拿掉「待實作」）與 mutation 抓到的兩個測試缺口。
  - `b78d45d`（完整 SHA 見 `git rev-parse b78d45d`）：使用者看截圖選的小視窗文字（說明只寫一次、別種問題排在前面）。
  - 之後把 `origin/main` 的 `4e13f08`（只有文件與決策索引的工具）合進來（`f4ec5aa`），沒有衝突；最後一個 commit 只加這份請求、roadmap、backlog 與任務說明的狀態，不用審。
- 整個分支：`git diff origin/main...claude/reverent-wing-577df1`。

## 規格與優先順序

- 主要規格：[任務說明](duplicate-ids.md) §1～§9，邊界在 §8 的 23 項。格式查核的 F1～F4、I1～I3 已寫進去（[報告與回應](<../Claude Codex Discussion/2026-11-01-duplicate-ids-format-review.md>)）。
- 決定：[D-157](../docs/decisions.md#d-157-重複的學習目標-id先停家長選)、[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)、[D-079](../docs/decisions.md#d-079-卡組筆記的結構與學習目標的資料)、[D-034](../docs/decisions.md#d-034-學習目標-id)、[D-135](../docs/decisions.md#d-135-清單解析和-obsidian-對照後的處理)；格式見 [syntax §2-3](../docs/syntax.md#2-3-學習目標)、[§2-10](../docs/syntax.md#2-10-寫錯時)。
- 來源：[外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)〈環節 2 的結論〉第 3 條與〈環節 3 的結論〉第 4 條。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## 行為與風險

- **公開介面**：
  - `State.conflicts()`：每個衝突的 ID 與它的目標（路徑、行號、名稱），照路徑、行號排；還沒 ready 是空的。
  - `State.canAnswer(lt)`、`answer`：衝突的 ID 不收作答與狀態變更；`answer({ undo })` 不因衝突擋，只看原本的門檻。
  - `IdIssueKind` 多 `'duplicate'`；`IdIssue` 多選填的 `others`；`State.resolve(issue, 'new', editor)` 只換那一行，`'restore'` 回 `stale`。
  - `removedInEditor(path, ids)` 現在用得到 `path`：照 state 所知還在別篇目標上的 ID 不記成刻意拿掉。
  - 核心：`findDuplicateIds`（`src/core/study/duplicates.ts`）是判斷的唯一一份；`assignIds` 不再換任何已有的 ID，`AssignOptions.replace` 刪掉；`Today.problems` 刪掉；`duplicate-id` 的文字改了（代碼、level 不變）。
  - `src/obsidian/save.ts`：小視窗的 `duplicate` 一列（別種問題排在前面、說明只寫一次）、別篇的跳轉、`TIPS.duplicates`（離開筆記的通知）；`MESSAGES` 多一個行號參數。文字是使用者看截圖定的（任務說明 §3-3 開頭），文字本身不用再審。
- **不可破壞的性質**：
  - 程式不照位置或路徑決定誰保留：衝突的目標全部不出、不補、不移動、不改縮排；衝突的兩行存檔與離開筆記都逐字不變。
  - 判斷只看目前的內容，不看讀到的先後；讀不到不算刪除；重開照目前的內容重算。
  - 選「新加的」只改那一行；寫回之後再存一次不改任何字；紀錄的格式不變；舊 ID 的紀錄不動。
  - 還在別的學習目標上的 ID 不算刻意拿掉，之後那個目標弄丟 ID 仍偵測得到（`changed`、`ambiguous`、`duplicate` 的選項與 `removedInEditor` 都一樣）。
  - 已顯示的卡與回看：衝突出現之後不能把舊的作答寫進去，衝突解除後也一樣。
- **明確延後**：任務說明〈這次不做〉：貼上當下拿掉副本的 ID、發布前比較的轉接器、修好被看見之前記錯的紀錄、連結裡的 `^id`（D5）、在手機上處理、別台還沒看見的重複、目錄的提示。

## 請特別看

1. **衝突放在 tracker、每次 `observe` 的結尾算**（`src/state/ids.ts` 的 `refreshDuplicates`、`lines`）：存檔時要用編輯器最新的文字判斷（可能比 state 讀到的新），所以不能等 `rebuild`。`forget`、`move` 只標 `stale`，靠 batch 一定接著呼叫 `observe`。請找 tracker 與 `deckMap` 對不上、或衝突沒有重算的路徑（改名、刪除、讀不到、`wrote` 之後家長又打字）。
2. **問題物件的身分**（`Conflicted.key` 是整個 `Target` 的 JSON，見下面第 1 點的做法）：請試同名同題互換位置、行號不變但內容變、只有 `others` 變、改名。兩份完全相同的文字互換位置時文字本身沒變，舊物件照樣能用，我認為無害；請確認。
3. **同一個目標同時是 `changed` 與 `duplicate`**：處理其中一個之後，另一個的去留（`observeOne` 的 `match` 與 `wrote` 的 `detect: false`）。
4. **`onChange` 的時機與複習畫面**（`src/review/session.ts`）：衝突出現與解除是不是一定通知監聽者；請找在兩次通知之間作答、或衝突出現又解除、監聽者沒看到的路徑（`entry.changeable = []` 靠監聽者設）。
5. **`planToday` 的防呆**：`subjectOf`、配對、`held` 的註解與行為；輸入裡的重複與 state 已經拿掉的不混淆。
6. **寫回的字面輸出**：§3-2 的表，含 CRLF；`tests/state-duplicates.test.ts` 第 23 項。
7. **跳轉**（`IssuesModal.jump`）：`openLinkText` 帶 `eState.line`，開在新分頁、先關小視窗。

## Claude 自己選了做法的地方（請逐點回覆）

1. **`duplicate` 的物件身分比規格嚴**：規格寫「行號、名稱、題目指紋或 ID 任一個變了就換物件」，§8 第 4 項又要同名同題互換位置回 `stale`。只比這四樣時，行數相同、只有備註不同的互換抓不到，所以 key 用整個 `Target` 的 JSON（連備註、補充、所在的標題都算）。代價：小視窗開著時改了那個目標的備註也要重選一次。
2. **判斷函式放 `src/core/study/duplicates.ts`**：任務說明允許兩邊；模組邊界規定 study 從 deck 只能拿型別，`planToday` 要用，所以不能放 `core/deck`。
3. **`State.answerable` 拆成 `readableLog`（原本的門檻）與 `answerable`（加上不重複）**：取消只看前者。
4. **刪掉 `tracker.issues`**：沒有人用，留著又要多一種語意。
5. **`MESSAGES` 多一個行號參數**：兩個名稱一樣時只能靠行號分；其他三種不用它。Obsidian 預設不顯示行號，所以列的順序照行號（上面的那一個排前面），這也是分辨的線索。
6. **別篇的跳轉用 `<a>`（沒有 href），不是按鈕**：小視窗等待時所有按鈕停用，跳轉不該一起停；鍵盤走不到它，主要動作的按鈕走得到。
7. **跳轉開在新分頁、先關小視窗**：開在同一個分頁會變成離開這篇筆記、觸發備援；小視窗不關看不到底下。之後要再按一次存檔才會重開。
8. **`openLinkText` 收路徑**：檔名含 `#`、`^`、`|` 時會被當成連結語法開錯（這種檔名 Obsidian 本身也不建議）；沒有另外處理。
9. **開發命令搬動**：`dev-ids.ts` 匯出 `sleep`、`until`、`writeFile`、`openTab`（原本叫 `open`）、`shooter`（從 `saveTips` 抽出來，行為不變）給新的 `dev-duplicates.ts`。

## 改到的既有測試（§8 第 22 項）

- `tests/deck.test.ts`：「assignIds 重複 ID、replace…」改寫成第 20 項兩則；刪掉「replace 中的 ID 包括第一次出現也全換」；N1 拿掉 `replace`；I2「行中的 ID 和別的目標重複時換新」改成不換、只移回行尾；往返驗證的不變量從「所有 ID 不重複」改成「新配的不重複、原本有的都不變」。
- `tests/today.test.ts`：T8 照新規則；L2-F1、L2-F2 改成第 19 項（重複的不參與配對、作答不算進估秒）。
- `tests/boundaries.test.ts`、`tests/build.test.ts`：登記新的匯出與開發命令的模組。
- `src/obsidian/dev-ids.ts` 的 `MESSAGES.lost` 呼叫補行號。
- 還要改的舊註解與文字：`src/core/study/plan.ts` 的 `held` 註解、`docs/syntax.md` 的「待實作」。

## 驗證方式

- 每個程式的 commit 的 pre-commit 都跑完整的 `npm run check`（型別、ESLint 含邊界、knip、secretlint、skill 副本、文件、全部測試），都通過。Codex 在沙箱裡跑會有環境造成的固定失敗，照 [quality.md](../docs/agents/quality.md)〈檢查指令〉在沙箱外跑，或逐項列出。
- `npm run build` 通過；改到排程，另跑 `node --test tests/today.test.ts tests/study-performance.test.ts`（`planToday` 中位數約 88 ms，門檻 1000 ms）。
- 新增的測試：`tests/state-duplicates.test.ts`（§8 第 1～7、9～18、23 項）、`tests/review-session.test.ts`（第 8、10 項）、`tests/today.test.ts`（第 19 項）、`tests/deck.test.ts`（第 20 項，例子登錄進 `deckCases`）、`tests/save-wiring.test.ts`（第 21 項）。
- Mutation：暫時改 14 個地方確認對應的測試會失敗（F1 的 `inUse`、`removedInEditor` 不看別篇、物件身分只比行號、`others` 不更新、衝突算進需要新版的卡組、存檔不跳過、作答不擋、取消也擋、回看不凍結、目前這張不丟、回看中補播、`planToday` 不擋、配對不排除、卸載後還通知）。第一次有兩項沒抓到（回看中補播、配對不排除），補了測試（`76d9c74`），之後 14 項都抓到。
- **Windows 實機**（Obsidian 1.14.5，測試 vault 的 `Essence W5/結果/`，結果檔都記 `plugin`）：
  - `duplicates`（`0.2.0+b78d45d`，新的開發命令，`src/obsidian/dev-duplicates.ts`）：`checks` 55 項都是 true、`failed` 是空的。用真的編輯器貼上（ClipboardEvent），點真的存檔按鈕與小視窗的按鈕。同一篇貼在上面、貼在下面；貼到別篇（路徑在前、在後）；刪掉副本；離開筆記。每一種都確認今天的份不出、不收作答、按存檔不換號、選了之後只換那一行、原本那篇逐字不變、之後恢復。別篇的跳轉：打開新分頁、捲到第 81 行（`coordsAtPos` 在可見範圍內，那一行有 Obsidian 的反白）。截圖淺色、深色各五張（存檔按鈕的說明、小視窗同一篇兩個、跨篇有跳轉、跳轉之後、離開筆記的通知），在 `Essence W5/結果/重複 2026-11-02 012517/`。
  - `lock`（`0.2.0+76d9c74`，只有小視窗文字和 `b78d45d` 不同）：50／50。
  - `save`（同上）：`checks` 19 項都是 true，包括 `clicked`。
  - `today`（同上）：結果多 `conflicts`，測試 vault 現有的卡組沒有重複（空的）。
  - 這段期間另一個 session 也用測試 vault，輪流用，用結果檔的 `plugin` 核對過。
- 沒跑：iPhone（任務說明 §9：手機只走 `state` 與複習畫面，Node 測試涵蓋）。
