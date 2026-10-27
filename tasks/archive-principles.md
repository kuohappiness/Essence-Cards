# 歸檔原則補齊（D-143）（給 Claude，本機執行）

狀態：已完成（`b28950f`～`a8fbdc6`）

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（判斷已在 D-143 做完，這裡照著改一支檢查程式和幾段規則文字）。請新開一個 session。

## 目的與依據

- 決定：[D-143](../docs/decisions.md#d-143-歸檔原則每類文件都有終點不設字數上限)，修改 D-141。拿掉字數上限，改成每類文件都有終點，讓文件不會只進不出。
- 基準：加入這份說明的 commit（`git log -1 --format=%h -- tasks/archive-principles.md`）。開工先 `git pull`，以開工時的 `main` 為準。

## 限制

- 不改 `src/`。`docs/decisions.md` 不用改（D-143 與舊決定的狀態行已寫好）。
- 在 `main` 上做，小步 commit；每次 commit 前 `git pull --rebase`、看 `git status`，只 stage 自己改的檔案。
- 歷史紀錄（討論摘要、討論稿、封存）的內文不改寫；只加檔頭的指向行、改索引列。
- 改 `.claude/skills/` 的共用 skill 時，`.agents/skills/` 的副本一起改（`npm run skills` 會檢查）。

## 1. 文件檢查程式 `tools/check-docs.ts`

- **拿掉兩個字數上限**：刪掉 `NOW_LIMIT` 與 `DONE_CELL`，以及 `checkRoadmap` 裡「現在在哪裡」的長度檢查和已完成「工作」欄的長度檢查。保留：找不到「現在在哪裡」一節要報、已完成超過 `DONE_ROWS`（10）列要報、表格沒有「工作」欄要報（如果拿掉長度後「工作」欄不再用到，這項也一起拿掉）。`count`、`number` 沒用到了就刪。
- **狀態行擴大到 `docs/plans/`**：`STATUS_DIRS` 加 `docs/plans`；三個資料夾裡名為 `README.md` 的檔案不查。
- 檔頭註解改成現在查的項目，依據寫 D-141、D-143。
- 測試 `tests/check-docs.test.ts`：刪掉「2,500 通過、2,501 要報」那個測試，以及「150 通過、151 要報」的部分（10 列通過、11 列要報留著）；狀態行的測試加 `docs/plans/x.md` 缺狀態要報、`docs/plans/README.md` 不查、`docs/plans/sub/y.md` 不查。
- 這一步的 commit 只改程式與測試，`npm run check` 要通過。§2 還沒做之前，`docs/plans/` 會報缺狀態：先做 §2 再 commit，或兩步放同一個 commit。

## 2. `docs/plans/` 的狀態行

每份主題文件（README 以外）把狀態行放在標題下第一個非空行，也就是移到「[第二階段清單]…｜[文件存放規則]…」那行的上面。已有「狀態：」的照原文搬上去；沒有的照內容補一句：

| 檔案 | 狀態行（基準時，開工時照實際內容） |
|---|---|
| `ai-and-ecosystem.md`、`experience.md`、`motivation.md`、`practice.md` | 原有的「狀態：…」搬到最上面 |
| `learning-growth.md` | 狀態：第二階段想做；產品路線是使用者 2026-10-22 的提議，細節未定 |
| `standalone-app.md` | 狀態：第二階段，開工條件與驗證見下 |
| `updates.md` | 原本的「💬 討論中：…」那段改成以「狀態：💬 討論中（v1）」開頭的一行，其餘說明留在下一段 |

值用這幾種：規畫中、討論中、部分定案（D-xxx）、已完成 → D-xxx 或任務。

## 3. 規則文字

**`AGENTS.md`**〈文件分工〉表下的條目：

- 「新點子先記進 `backlog.md`…」那條的「；談定後引用 D-ID，不重複維護詳細內容。」改成：「。待決的題目定案就從 backlog 移除，任務與技術債做完就移除；定案但還沒做的，任務表留一行並連 D-ID，不抄內容。repo 裡連到被移除項目的連結改連 D-ID 或結果（`[D-143](docs/decisions.md#d-143-歸檔原則每類文件都有終點不設字數上限)`）。」（反引號裡是要貼進去的連結，貼的時候拿掉反引號。）
- 「重要討論在 `docs/archive/discussions/` 新增…」那條改成：「沒有討論稿的重要討論，結束（定案或擱置）時在 `docs/archive/discussions/` 新增 `YYYY-MM-DD-主題.md`，記錄決定、理由與當時沒解的問題，並更新該目錄的 README 索引；未決問題的主文另在 plans 或 backlog，摘要只連過去。有討論稿的不另寫摘要（D-106）。內容採摘要，不冒充逐字紀錄。」
- 在「roadmap 的「現在在哪裡」是狀態板…」那條之後加：「做完的任務、討論稿與 plans 不刪不搬，只改標題下的狀態行；`docs/plans/` 也在標題下第一行寫狀態（D-143）。」
- 「`node tools/check-docs.ts` 在每次 commit 時檢查連結、狀態板長度、已完成與檔頭狀態行。」改成「…檢查連結、已完成的列數與檔頭狀態行。」
- 最後一條（「文件以繁體中文撰寫…」）之前加：「`AGENTS.md` 只放每個 session 都需要的規則與指向；只有某類工作才需要的細節，寫在那類工作的文件或 skill（D-143）。」

**`essence-decision`**（兩份）第 5 步的「`backlog.md` 裡對應的項目只留一行，連到 D-ID。」改成：「`backlog.md` 裡對應的待決題目移除；定案但還沒做的任務留一行並連 D-ID；repo 裡連到被移除項目的連結改連 D-ID（D-143）。」

**`essence-discuss`**（兩份）〈結束〉第三點改成：「沒有討論稿的重要討論：結束時在 `docs/archive/discussions/` 新增 `YYYY-MM-DD-主題.md`（摘要，不冒充逐字紀錄），更新該目錄 README 的索引；有討論稿的不另寫（D-106、D-143）。」

**`docs/plans/README.md`** 表格：

- 「尚在規畫的功能細節」那列的「如何使用」最後加：「標題下第一行寫狀態；定案的部分換成一句加 D-ID；整個主題做完標已完成，不刪不搬（D-143）」。
- 「已可交付實作的任務與驗收」那列最後加：「做完只改狀態行，不刪不搬」。
- 「重要討論摘要」那列改成：「只收沒有討論稿的討論，結束時才寫；保留歷史取捨並更新該目錄索引；未決問題留在主文；不當作目前規格」。

**`docs/archive/discussions/README.md`**〈紀錄方式〉第一點之前加：「只收沒有 `Claude Codex Discussion/` 討論稿的討論，結束（定案或擱置）時才寫；有討論稿的不另寫（D-106、D-143）。未決問題的主文在 plans 或 backlog，這裡只連過去。」

**`docs/backlog.md`**〈已定案對照〉開頭那段最後加：「D-143 起不再新增：定案的題目直接從 backlog 移除，連到它的連結改連 D-ID。」

**`docs/agents/quality.md`** 的文件檢查那一行依據加 D-143；有提到字數上限的地方拿掉。

## 4. backlog 照新規則清一次

- 「待決問題」各小節裡已經定案（有 ✅ 與 D-ID、沒有後續工作）的題目移除；同一條裡還有後續工作的，只留後續工作那一句。
- 「v1 需要做的任務」與「技術債」裡已經做完（有合併 commit 或 roadmap 已完成有記）的列移除。
- 移除前用 `grep` 找 repo 裡連到那一項錨點的連結，改連 D-ID 或結果；改完 `node tools/check-docs.ts` 要通過。
- 「第二階段想做的事」「舊入口對照」「歷史索引」「已定案對照」不動。
- 判斷不出來是否做完的不動，列在回報裡。

## 5. 討論摘要與討論稿重疊的兩份

- `docs/archive/discussions/2026-10-25-elementary-social-map.md`：確認摘要裡〈未解問題〉的每一題，在國小社會的主文（roadmap 狀態板那一列的入口，基準時是 `docs/card-rules/elementary-social.md`）或 backlog 找得到；找不到的加進主文（一句、附來源）。摘要內文不改，在日期那行下面加一行：「狀態：未決問題的主文在`[國小社會預設](../../card-rules/elementary-social.md)`；這裡是當時的紀錄（D-143）。」（反引號裡是要貼進去的連結，以 `docs/archive/discussions/` 為基準，貼的時候拿掉反引號；連到實際的主文。）README 索引那一列拿掉「討論進行中：」。
- `docs/archive/discussions/2026-10-23-future-plans-consolidation.md`：同樣確認它的未解問題在主文找得到（基準時，狀態板「未來規畫統整的審閱」那列連到討論稿）。摘要裡有未決問題的話，照上面加一行指向主文；沒有就不動。

## 6. 任務檔的終點

- `tasks/w6-l2-questions.md` 的「這份檔在五題都定案、改進 W6 說明後刪掉。」改成「五題都定案、改進 W6 說明後，狀態改成已結案，檔案保留（D-143）。」（W6 的 session 可能也在改這份；只改這一句，pull 後再改。）
- `grep -rn '刪掉\|刪除' tasks/ "Claude Codex Discussion/"`，看還有沒有其他「這份檔做完就刪」的說法，同樣改掉。

## 7. 收尾

- `npm run check` 通過；`node tools/check-docs.ts` 沒有問題。
- roadmap 狀態板拿掉「歸檔原則補齊」那一列；已完成最上面加一列（一句、約 80 字，連 D-143）。
- 這份說明的狀態行改成「已完成（commit 範圍）」。
- 回報：commit 清單、§4 移除了哪些項目、判斷不出來而沒動的項目、§5 補進主文的題目、沒做或做不到的事與原因。
