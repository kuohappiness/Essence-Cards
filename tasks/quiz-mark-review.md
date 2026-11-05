# 小考標記：L2 審查請求（給新開的 Codex session）

狀態：待審（第一輪）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**。只審查，不改產品程式；可以在隔離環境重現。回報寫在這個 worktree 的 `Claude Codex Discussion/2026-11-06-quiz-mark-review.md`（新檔，不用 commit，Claude 整合時會 commit）；所有檔案都在這個 worktree，不要寫到主資料夾。

## 審查對象

- **位置**：worktree `.claude/worktrees/musing-kowalevski-696591`（主資料夾底下），分支 `claude/quiz-mark-354478`，沒有未提交的程式修改。
- **待審**：`be14a85ca667bd723de82bc4d75bb141b9f2ec19`。它之後只有文件的 commit（這份請求、任務說明的〈結果〉）。
- **基準**：`1c4cb4387cc95cbc77dd9249bc5fcd196d1e1475`（開工時的 `main`）。待審的那個 commit 就是併 `main` 的那一步，帶進來的只有文件（製卡規則、roadmap、討論稿），`src`、`tests`、`tools` 和 `7bc2a67` 相同。

```bash
git diff 1c4cb4387cc95cbc77dd9249bc5fcd196d1e1475 be14a85ca667bd723de82bc4d75bb141b9f2ec19 -- src tests tools docs/syntax.md docs/architecture.md
```

一步一個 commit，可以分開看：

| commit | 內容 |
|---|---|
| `9575aaf` | 重構：把段考的讀檔、寫檔、鎖、比對抽成 `src/state/folder-files.ts`，段考行為不變 |
| `319fbb9` | §1：小考檔的讀法與寫法（`src/core/catalog/quiz.ts`、`src/state/quiz.ts`、`src/obsidian/quiz-links.ts`） |
| `0e7861f` | §2～§4：開關、目錄按鈕與選單、入口那一列（`src/review/quiz.ts`、`src/ui/Quiz.tsx`、`src/ui/Entry.tsx`） |
| `1caf85b`、`7bc2a67` | 開發命令 `quiz-mark`（`src/obsidian/dev-quiz.ts`，只在開發版） |
| `a1255fc` | `docs/syntax.md` §4-1、`docs/architecture.md`、backlog 的 iPhone 那一列 |
| `f50fd60` | 入口那一列：全部卡是 0 張時也能取消（實機發現，見〈實作者自己選的做法〉第 5 點） |
| `a88dc11` | 選單排在那一列底下，「暫停」留在原位（實機發現） |

## 規格與優先順序

- 任務說明：[quiz-mark.md](quiz-mark.md) §1～§6。
- 格式查核：[回報](<../Claude Codex Discussion/2026-11-05-quiz-mark-format-review.md>)第 3～6 點；第 6 點是應補測試的表，請逐項對到測試。
- 決定：[D-189](../docs/decisions.md#d-189-小考前的密集複習成對的卡隔開單篇練習與小考標記) 第 4、5 點；[D-098](../docs/decisions.md#d-098-考試範圍只用在大考日期改成考試期間)；[D-176](../docs/decisions.md#d-176-考試範圍第二批的選擇手改的範圍檔不默默失效提前結束立刻失效)；[D-115](../docs/decisions.md#d-115-回頭查要用的證據先收好)；[D-163](../docs/decisions.md#d-163-入口與目錄的四批開法全部卡的一輪與提醒一區) 第 4 點；[D-107](../docs/decisions.md#d-107-考前抽測放在入口科目列的第一列)；[D-081](../docs/decisions.md#d-081-卡組屬性與檔名)。
- 格式文件：[syntax §4](../docs/syntax.md#4-考試範圍)、[§4-1](../docs/syntax.md#4-1-小考)（這個分支新增）。
- 規格衝突時列成問題，不挑容易通過的那份。

## 行為與風險

高風險的三塊（[quality.md](../docs/agents/quality.md#高風險範圍要做-l2)）：多一種外掛會寫的檔、入口與目錄的畫面、段考寫檔路徑的重構。

- **讀法**：`parseQuiz`（一份檔）、`quizRows`（整個資料夾變成入口的列）。性質：輸入順序換過結果不變；同一個識別碼的任何一份有 `取消` 整組取消；同識別碼日期或目標不同走待修正，不自己挑；日期壞掉不失效；小考日期隔天清晨 4 點起消失（用非零時區測過 03:59:59.999 與 04:00）。
- **寫法**：`newQuizText`、`editQuiz`、`state.setQuiz`、`state.cancelQuiz`。性質：改日期只改那一行（註解、引號、CRLF 照留）；取消多一行；已有的檔（含零位元組的檔）一個字都不動；撞名用 ` 2`、` 3`；屬性區壞掉或同一路徑換了識別碼時不寫。
- **段考的重構**：`src/state/exam.ts` 的讀檔、寫檔、鎖與比對移到 `folder-files.ts`。段考的行為不能變；原有的 `tests/exam-state.test.ts` 改了哪些見〈實作者自己選的做法〉第 9 點，請確認沒有放寬。
- **連結**：`quizLinkResolver`。完整路徑、相對路徑、檔名都只在確定指向一篇已知卡組時接受；重名是 `several`，找不到是 `none`；不退回整個單元。
- **畫面**：入口那一列不看開關；開關只管目錄的按鈕。N 是 0 不能按。單元開 `{ unit, since }`、單篇開 `{ deck, since }`。
- **不做的**：不改排程、不提高保持率、不寫紀錄行、不提示下一輪。接句的間隔、全詩順序卡的初學順序不在這份任務。

## 實作者自己選的做法（請先看）

1. **共用 `folder-files.ts`**：任務說明寫「用考試範圍同一條路徑」，所以抽出來讓兩邊共用，不複製一份。代價是動到段考的程式。
2. **建檔先讀再寫**：要分得出「不存在」與「零位元組」（Obsidian 的 `modify` 會把不存在的檔當成空字串），這裡在建檔前讀一次，沒有在 `Files` 介面加 `create`。請找讀與寫之間的時間差會蓋掉檔案的組合。
3. **改日期寫所有副本**：同一個識別碼有兩份內容相同的副本時兩份都改，否則下一次讀到會變成「兩份不一樣」。
4. **目錄找不到的列在入口給取消**：任務說明寫「那一篇已經刪掉時，按目錄的小考按鈕取消」，但卡組刪掉後目錄沒有那一列、也就沒有按鈕，所以 `missing`、`several`、`unmatched` 在入口那一列放一個不顯眼的「取消」。
5. **0 張的列也能取消**：那一篇或整個單元都暫停時，目錄沒有小考按鈕，入口那一列的全部卡是 0、不能按，不給取消就要等到日期過了才消失（`f50fd60`）。
6. **沒有編號的單元用單篇連結**：`unit.code === null` 的單元（「其他」那一區）寫不出單元那一行，單元那一排的小考按鈕設的是 `unit.decks[0]` 那一篇的連結（`src/ui/Entry.tsx`）；這種單元一定只有一篇（`src/core/catalog/index.ts:142`）。
7. **其他日期擋已經過的日期**：寫「這個日期已經過了」，設下去只會立刻消失。規格沒寫。
8. **只有一篇、但已有小考的篇也顯示按鈕**：規格寫「兩篇以上啟用時，每一篇那一列也有」；手寫的單篇小考在只有一篇的單元裡要找得到地方改日期或取消。
9. **改了兩個舊測試**：state 現在也讀 `小考/`。`tests/exam-state.test.ts` 那個「小考/ 裡內容壞掉、日期更早、讀不到」的測試：段考的斷言全部保留，`unread` 改成含小考的檔，「連讀都不讀」改成「改小考檔不會重讀段考的檔」；另一個測試的 mock 改成 `folder.endsWith('考試範圍')`。`tests/compare-versions.test.ts` 兩個補丁點跟著 `unread` 的新寫法改。請確認這些改動沒有放寬段考的保護。
10. **目錄的 `since` 用 `Date.now()`**：和入口相同，照 D-163 第 4 點。
11. **入口取消失敗走 `notify`**：入口那一列沒有地方放紅字。目錄的選單失敗留在按鈕底下。
12. **`quizLinkResolver` 先比完整路徑，再比路徑尾巴**：Obsidian 自動更新連結時會把完整路徑改寫成短的（實機：`[[L3 文法改名 xxx]]`），短的只在唯一時接受。備份裡有同名檔的情況見 `tests/quiz-links.test.ts`。

## 請特別找

- **副本與同步**：取消蓋過晚到的舊副本；一份有 `取消` 一份屬性區壞掉；同識別碼兩份日期不同時按改日期；iCloud 的 `2026-11-06 小考 2.md` 是同一個識別碼的副本；取消後再設新檔撞名。
- **寫回**：`editQuiz` 遇到 CRLF、BOM、註解、引號、`小考日期:` 沒有值、同一鍵出現兩次；手寫檔沒有識別碼時補 ID 算不算進比對；讀到之後被別處改過（`changed`）；讀不到（`unread`）；外掛關閉時（`closed`）。
- **段考不受影響**：`小考/` 裡的檔壞掉、讀不到、很多份；`exam.ts` 重構後的鎖、比對、`settle`、`stop`、`idle` 的順序；`unread` 多了小考的檔之後，有哪些地方會因此擋下段考或別的動作（讀取閘門、存檔提醒）。
- **連結**：大小寫、`.md` 結尾、`|別名`、`#標題`、子資料夾同名、備份資料夾裡的同名檔；`resolveLink` 在 metadata 還沒好時回的東西；連結指向不是卡組的筆記。
- **畫面**：`QuizButton` 的選單開著時資料變了（別台裝置取消、那一篇被暫停）；Esc 與 ✕ 的順序；`quizButton` 的 `others`；`Entry.tsx` 裡 `deckQuiz` 的條件；React key 重複（同一個 `key` 的兩列）。

## 驗證方式

- Node 24 以上（Claude 用 v24.13.0）。在 worktree 裡：`npm ci`、`npm run check`，要在沙箱外跑（[quality.md](../docs/agents/quality.md) 的〈Codex 審查時〉）。自己跑測試一律加 `--test-timeout`。
- 實作者跑過的：見 [quiz-mark.md](quiz-mark.md)〈結果〉。
- **Windows 實機**：`be14a85ca667bd723de82bc4d75bb141b9f2ec19` 的開發命令 `quiz-mark` 跑過（Obsidian 1.15.0），結果與截圖在測試 vault，repo 裡沒有，結果摘要在〈結果〉。開發命令會寫測試 vault，請不要在 L2 裡跑。
- **沒跑**：iPhone（手機上設小考、入口那一列的排版、在 iPhone 改名或搬那一篇後連結有沒有跟著改、用「檔案」App 改名再同步），已列進 backlog「下一次 iPhone 實機測試」。

## 回報

依嚴重程度排序。每項寫：哪一軸（規格／乾淨程度／設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證）、**真實路徑會不會發生**（使用者的資料、Obsidian 的實際行為或已發布的版本，會不會產生這個輸入），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。〈實作者自己選的做法〉請逐點回覆。可以回報「規格本身有漏洞」。沒有擋合併的發現就直接寫「通過」。
