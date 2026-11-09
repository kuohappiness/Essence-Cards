# AI 製卡最小版：L2 獨立審查（給 Codex）

狀態：待再審（2026-11-09，第七輪窄審，使用者決定）。第一輪審查 `9723536`、第二輪審查 `d776969`、第三輪審查 `1f291ae`、第四輪審查 `b4ff11f`、第五輪審查 `f6526d4`、第六輪審查 `d9bdf46`，[報告](<../Claude Codex Discussion/2026-11-07-ai-cards-mvp-l2.md>)

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。這次會新建卡組與 `紀錄/AI 輸出/` 的檔、改 `state` 的 ID 占用與狀態寫入，屬於高風險範圍（[quality.md](../docs/agents/quality.md#高風險範圍要做-l2)），合併前做 L2。**只審查，不改產品程式**；可以在隔離的暫存資料夾重現。

## 審查對象

- worktree：`D:\程式開發\Essence Cards\.claude\worktrees\ai-cards-mvp`，分支 `claude/ai-cards-mvp`。
- 規格基準：開工時是 `main` 的 `9c803baf6ecb9a76d0f7cc5d1b0bcc3af449c581`；`cffb1c8` 合併了 `main` 的 `eee68d48adc1859a046a007fb5321509d14f92f9`（D-195 的測試分兩類與文件檢查，沒有動 `src/`、`docs/syntax.md` 與製卡規則）。看 `git diff eee68d4...claude/ai-cards-mvp`。
- 待審 commit：從 `135832d` 到分支最新（commit 清單與各自的內容見[任務說明〈結果〉](ai-cards-mvp.md#結果)）。`1ff5092`、`e48c8b7` 是使用者用 ChatGPT、Gemini 做真的 AI 對話之後的修正（§2 的下一步、§3 的 `提示 v2`、§4 的整理、擋法與結果畫面），原因見〈結果〉的〈真人測試之後要改的〉〈重測之後再改的〉，請一併審。
- 交給你時沒有未提交的修改。

## 規格與優先順序

- 主要規格：[tasks/ai-cards-mvp.md](ai-cards-mvp.md) §1～§8。它引用的正式規範：[syntax §2-1](../docs/syntax.md#2-1-屬性)、[§2-9](../docs/syntax.md#2-9-ai-製卡交回的草稿)、[§2-10](../docs/syntax.md#2-10-寫錯時)、[§6](../docs/syntax.md#6-ai-輸出快照)（這個分支改了 §6 與 §9）；決定 D-039、D-042、D-081、D-115、D-126、D-134、D-150、D-151、D-157、D-191（`node experiments/tools/decisions-index.mjs D-xxx` 查）。
- 格式查核四輪的發現（F1～F9、R2-1～R2-5、R3-1、R4-1）已寫進任務說明：[回報與 Claude 回應](<../Claude Codex Discussion/2026-11-07-ai-cards-mvp-format-review.md>)。**R4-1（§5 第 4 步「開始建了」）改完之後沒有再審**，這次一起驗。
- 規格衝突時列成問題，不挑容易通過的那份。已知的兩處見任務說明〈結果〉的〈規格之間的出入〉。

## 行為與風險

主要的檔：

| 層 | 檔 |
|---|---|
| 純函式（`src/core/ai/`） | `rules.ts`（§1 的表與送出範圍）、`check.ts`＋`language.ts`（從 `check-syntax.mjs` 搬來）、`prompt.ts`（§3）、`reply.ts`（§4 整理、分段、拆篇、檢查；`<<<完>>>` 後面的圍欄與引用標記、清單結構跑掉時擋、每一項的原文）、`draft.ts`（§4 檢查結果、§5 全文與檔名）、`job.ts`（§3 待貼回的工作）、`publish.ts`（§5 第 3～7 步、中斷與重試、跳過、重建、放棄） |
| 卡組 | `src/core/deck/question-types.ts`（只加 `pickWord`、`pick-mixed` 的字句寫出答案該是哪個字） |
| state | `src/state/index.ts`（`activateDraft`、`aiExisting`、`aiTarget`、`aiIds`、`aiWhere`、`aiCreate`、共用的 `changeStatus`）、`src/state/ids.ts`（`reserved`、`allocate`、`where`）、`src/state/writes.ts`（泛型的 `enqueue`、只建立的 `create`） |
| Obsidian | `src/obsidian/ai-cards.ts`（流程與 I/O）、`ai-cards-modal.ts`（畫面）、`deck-actions.ts`（啟用按鈕與命令）、`src/main.ts`（只在電腦註冊；`reserved` 交給 state） |
| 建置 | `tools/build.mjs`（`embedRules`、`CARD_RULES`）、`tools/install.ts`、`src/ui/prefs.ts`（`aiPrefs`） |

不可破壞的性質（請先看這些）：

1. **沒存好恢復資料前不碰 vault**；之後每一步只照恢復資料寫，不重新整理、不重新配號（§5 第 2 步）。
2. **快照寫成＝發布**；已發布的工作重開只清理，不再核對卡組（§5〈中斷與重試〉）。
3. **不蓋掉任何檔**：卡組、快照、原文都只建立；同名異文擋下、讀不到不當成不存在。
4. **ID 不撞**：卡組（含引言框的行尾 ID）、紀錄的 `lt`、這台電腦其他沒完成工作的預留、「不再配出」清單、同一次的其他篇；預留在任何配號前載入（R2-3）。
5. **記成開始建了或寫出過、但現在找不到的篇不自動補回**（R3-1、R4-1）。
6. **草稿 → 啟用只走這一條**：目錄的暫停／恢復照舊，不能把草稿改成暫停、不能把暫停改回草稿；手機不寫；需要新版的擋下。
7. **既有的寫入不受影響**：`writes.ts` 改成泛型 `enqueue` 與 `create`，補 ID、作答、暫停的行為與門檻要和基準相同。
8. 行號一律指貼上的原文（整理前）；每一項寫出的原文就是那一行。
9. **整理只拿掉包裝**：`<<<完>>>` 後面只剩圍欄的結尾符號、引用標記與空行時才拿掉，其他文字照樣擋；清單結構跑掉的三種（最上層直接寫了題目、學習目標底下沒有題目、多出的段落）擋下，照規則寫的輸出不會誤擋。

已知邊界：任務說明 §8 列的都寫成了測試（`tests/ai-*.test.ts`，測試名稱開頭寫對應的節）。例子只是起點，請找新的組合，例如：回覆裡同時有外框圍欄與 `<<<完>>>` 在圍欄外；開頭的圍欄和 `<<<完>>>` 後面的結尾符號長度或種類不同；`<<<完>>>` 在內層的程式碼區塊裡、後面接結尾符號；引用標記出現在卡組內文；篇名行剛好等於表單但在第一個標記之前；中斷發生在 `state` 的佇列裡（寫成了但讀回前）；兩個沒完成的工作的篇目的地相同；家長在恢復前把草稿改成啟用又改名。

明確延後（不算缺漏）：§0 表右欄的全部；手機上製卡；「給家長的備註」改名（§9）。

## 驗證方式

- 指令：`npm run check`（型別、lint、knip、secretlint、文件、全部測試）。完整的 check 要在沙箱外跑，沙箱裡的固定失敗照 [quality.md](../docs/agents/quality.md) 第 23 行逐項列出。只跑這次的測試：`node --test --test-timeout=60000 tests/ai-*.test.ts tests/deck.test.ts tests/build.test.ts tests/install.test.ts tests/main-wiring.test.ts tests/boundaries.test.ts`。
- 環境：Windows 11、Node（repo 的 `package.json`）、Obsidian 1.15.0。
- Claude 跑過：`npm run check`（pre-commit，每個 commit；合併 `main` 之後也跑過）；Windows 實機開發命令 `ai-cards`（自然 R3 一篇＋英文兩篇，從填表到啟用）；真實試用輸出 10 份貼回（只在本機，教材有版權，沒有進 repo）；使用者做的真的 AI 對話（ChatGPT 一次、Gemini 兩次，英文國二上 L5）與修正後用那幾份回覆重跑。結果見任務說明〈結果〉。
- **沒跑**：§8 第 3 點的 Claude 網頁（使用者的額度不夠）；第 4 點 iPhone（併入下一次 iPhone 實機）。這兩項需要實機，不在這次 L2 的範圍，但若程式有地方會讓它們失敗，請回報。任務說明〈結果〉的「延後的測試：」還沒填，第 4 點要不要延後由使用者在合併前決定。

## 實作者自己選的做法

見任務說明〈結果〉的〈實作者自己選的做法〉十項，請先看這些，特別是：

- 第 2 項：`CARD_RULES` 用 `JSON.stringify` 兩次交給 esbuild 的 `define`。
- 第 3 項：R3 `五步.md` 的 `{{任務資料}}` 那一行拿掉，任務段接在所有規則之後（試用時是填在那一行的位置）。
- 第 6 項：預留用 `createState` 的 `reserved` 函式，在 state 建好前讀。
- 第 7 項：只建立的寫入 `state.aiCreate` 的門檻與讀回比對。
- 第 8 項：`check-syntax` 的「提醒」不顯示、英文不提示「沒有出處」（`c76583f`）。

## 回報

- 寫在 `Claude Codex Discussion/2026-11-07-ai-cards-mvp-l2.md`，標題下第一行寫狀態。
- 每項發現寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證）、**真實路徑會不會發生**（家長的實際操作、Obsidian 的實際行為會不會產生這個輸入），以及建議處理（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。依嚴重程度排序。
- 可以回報規格本身的漏洞。最後一行寫沒測的項目與原因。

## 第二輪再審

這一輪只讀：本節、〈審查對象〉、[L2 報告](<../Claude Codex Discussion/2026-11-07-ai-cards-mvp-l2.md>)的〈Claude 回應〉。前面的段落與第一輪的發現原文，需要時照發現 ID 查。遵守 repo 根目錄的 `AGENTS.md`，建議推理等級：**高**；只審查，不改產品程式，可以在隔離的暫存資料夾重現。

- **審查對象**：worktree `D:\程式開發\Essence Cards\.claude\worktrees\ai-cards-mvp`，分支 `claude/ai-cards-mvp` 的最新 commit；看 `git diff 9723536...claude/ai-cards-mvp`。最後一個改程式的 commit 是 `ad9bc69`，之後只有文件。沒有未提交的修改。
- **還沒結的發現**：L2-1～L2-12、〈規格與規則待核對〉三點。每項都修了，請確認修法是否涵蓋同一類輸入、有沒有帶進新問題；不必整包重審第一輪沒有發現問題的部分。
- **可能碰到的已結項目**：R3-1、R4-1（`tests/ai-publish.test.ts`〈開始建了〉〈搬走與刪掉〉）、不可破壞的性質第 1～9 點（本檔〈行為與風險〉）。`writes.ts` 的 `admit` 抽出了 `drain`，補 ID、作答、暫停的門檻要和基準相同（性質第 7 點）。
- **實作者自己選的做法**（規格沒寫，請先看）：
  1. L2-1：同一工作的互斥放在 `createAiCards` 這一層（視窗關掉重開還在）；第二個操作回「還在存」，不接到進行中的那一次。卡住的 I/O 會讓這個工作一直回「還在存」，直到逾時或重開 Obsidian。
  2. L2-2：`aiWhere` 改成非同步，排在寫入佇列裡先讀完已知變動；建卡組另有 `aiCreateDeck`，在同一步核對 ID；發現已被占用時（`elsewhere`），這一篇已記成開始建了，回頭重新判斷，不會再走到建檔。
  3. L2-4：多一個 `stage: 'rebuild'`，不另加欄位；`pending` 以外的都不再配出。
  4. L2-5：建完一輪後整輪再核對一次，共用同一個函式。
  5. L2-8：`published` 存全文、時間、雜湊與當時的 `對象`；`對象` 沒變就照存下的全文寫，變了才用沿用的時間重做。舊格式（`published` 沒有全文）的進行中工作只存在開發版，會被當成讀不懂。
  6. L2-7：`markers` 改用 `blocksOf`；頂格接在最後一題下一行的 `<<<完>>>` 仍算最外層（CommonMark 是 lazy continuation，但 AI 常這樣寫，真實輸出與既有測試都有），縮排在清單裡的不算；`<<<完>>>` 後面只認一個結尾符號。
  7. L2-3：候選框之外，「加進已有的學習目標」也用解析器檢查；`ambiguous-id` 交給既有的 `nameLineIds`，不重複回報。
  8. L2-10：同文提示展開全部行，不設上限。
  9. L2-11：確認句多三種可能的句子（已暫停、ID 重複、還沒有 ID）。
- **想請特別找的新組合**：放棄與存檔之外的互斥（例如 `copy` 同時進行）；`drain` 讀不完（`stale`）時的回報；`elsewhere` 重新判斷的各種結果；跨午夜加上搬走（`對象` 變了、`時間` 沿用）；`names()` 比檔案事件慢的情況；內層圍欄沒有關的回覆。
- **驗證方式**：同本檔〈驗證方式〉；只跑這次的測試用 `node --test --test-timeout=60000 tests/ai-*.test.ts`。Claude 跑過：每個 commit 的 `npm run check`（pre-commit）；真實回覆的回歸（13 份輸出與 Gemini 重測，只在本機，不進 repo）。**沒跑**：修完之後的 Windows 實機（第二輪通過後在最後要合併的 commit 重跑）；Claude 網頁（額度）；iPhone（使用者同意延後，技術債「補測：iPhone 草稿不出題、啟用後才出題」）。
- **回報**：寫在 L2 報告最後新增一節〈第二輪〉，標題下的狀態行改成結果；格式同本檔〈回報〉，最後一行寫沒測的項目與原因。

## 第三輪再審

這一輪只讀：本節、〈審查對象〉、[L2 報告](<../Claude Codex Discussion/2026-11-07-ai-cards-mvp-l2.md>)的〈第二輪的 Claude 回應〉。前幾輪的發現原文需要時照 ID 查。遵守 repo 根目錄的 `AGENTS.md`，建議推理等級：**高**；只審查，不改產品程式，可以在隔離的暫存資料夾重現。依 [review.md](../.claude/skills/code-quality/review.md)，第四輪之後還有擋合併的發現就交使用者決定，所以請把真實路徑寫清楚：家長的實際操作或 Obsidian 的實際行為會不會產生這個輸入、間隔有多長。

- **審查對象**：worktree `D:\程式開發\Essence Cards\.claude\worktrees\ai-cards-mvp`，分支 `claude/ai-cards-mvp` 的最新 commit。看 `git diff d776969...claude/ai-cards-mvp`，排除合併帶進來的改動時用 `git log d776969..claude/ai-cards-mvp --first-parent`；`98d3093` 併入 `main` 的 `f911bf8`，只看它解衝突的部分（`src/main.ts`、`src/state/index.ts`、`src/core/errors/log.ts`、`tests/boundaries.test.ts`、`tests/build.test.ts`、`tests/deck.test.ts`、`docs/syntax.md` §9、backlog 與 roadmap）。沒有未提交的修改。
- **還沒結的發現**：R2-1～R2-9。每項都修了，請確認修法涵蓋同一類輸入、有沒有帶進新問題。
- **可能碰到的已結項目**：L2-2、L2-5、L2-8、L2-9（它們的測試都還在 `tests/ai-*.test.ts`）；R3-1、R4-1；本檔〈行為與風險〉的不可破壞性質第 1～9 點。`writes.ts` 的 `create` 改成迴圈，`drain` 多了 `giveUp`，`admit` 的行為要和基準相同（性質第 7 點）。
- **實作者自己選的做法**（規格沒寫，請先看）：
  1. R2-1：`create` 的 `guard` 在排隊後與寫入回呼裡各核對一次；回呼裡還有沒讀完的變動就中止這次、讀完再來，最多 `DRAIN_ROUNDS` 輪，用完回 `unread`。回呼裡判斷是同步的，之後到 `modify` 寫進去之間由 `Files.modify` 的同路徑排隊負責。
  2. R2-1：複習紀錄的 `lt` 算占用；只有紀錄占用時，重建最後停在 `taken`，只能跳過或放棄。
  3. R2-2：`pending` 不跟隨到別篇，新的 `taken` 情形；寫入前就擋下時確定沒有寫，階段改回原本的值。
  4. R2-3：拿掉第二輪核對，改成快照寫入回呼裡核對每一篇還在原位置，沒過就照現況重新核對、重做快照，最多三次，都趕不上回 `unread`。
  5. R2-4：`atWrite` 只在寫入回呼、而且這個路徑沒有檔時問整個 vault 的檔名；同路徑已有檔照舊是 `exists`，卡組改成往後加，快照照舊比內容。
  6. R2-5：只有 AI 製卡的路徑用 `readOrStuck`，既有的補 ID、作答照舊等讀取回來。
  7. R2-7：`choose` 先照現況走一次，還是停在同一篇、選擇仍適用才套用。
  8. R2-8：`state.aiStopped(path)` 把待處理的行、重複、需要新版、紀錄讀不懂或不完整都算進去。
  9. R2-9：圍欄往回找內文起點不超過這一欄的清單項目，那一項結束圍欄就結束。
- **想請特別找的新組合**：`refused` 之後重新判斷的各種結果（尤其 `rebuild` 階段）；三次重試用完的回報；系統資料夾防呆（`guard.wrap(files)`）搬回 `紀錄/AI 輸出/` 的檔時，AI 製卡的讀與建；編輯畫面標示對草稿的影響。
- **驗證方式**：同本檔〈驗證方式〉；只跑這次的測試用 `node --test --test-timeout=60000 tests/ai-*.test.ts`。Claude 跑過：每個 commit 的 `npm run check`（pre-commit）；真實回覆的回歸。**沒跑**：修完之後的 Windows 實機（第三輪通過後在最後要合併的 commit 重跑，含系統剪貼簿）；Claude 網頁（額度）；iPhone（延後，技術債）。
- **回報**：寫在 L2 報告最後新增一節〈第三輪〉，狀態行寫結果；格式同本檔〈回報〉，最後一行寫沒測的項目與原因。

## 第四輪再審

這一輪只讀：本節、〈審查對象〉、[L2 報告](<../Claude Codex Discussion/2026-11-07-ai-cards-mvp-l2.md>)的〈第三輪的 Claude 回應〉。前幾輪的發現原文需要時照 ID 查。遵守 repo 根目錄的 `AGENTS.md`，建議推理等級：**高**；只審查，不改產品程式，可以在隔離的暫存資料夾重現。依 [review.md](../.claude/skills/code-quality/review.md)，這一輪之後還有擋合併的發現就交使用者決定，不再自動送下一輪，所以每一項請把真實路徑寫清楚：家長的實際操作或 Obsidian 的實際行為會不會產生這個輸入、間隔有多長，以及不修的代價。

- **審查對象**：worktree `D:\程式開發\Essence Cards\.claude\worktrees\ai-cards-mvp`，分支 `claude/ai-cards-mvp` 的最新 commit。看 `git diff 1f291ae...claude/ai-cards-mvp`。最後一個改產品行為的 commit 是 `05528cc`，之後只有文件與一行註解。沒有未提交的修改。
- **還沒結的發現**：R3-1～R3-7。每項都修了，請確認修法涵蓋同一類輸入、有沒有帶進新問題；不必整包重審前幾輪沒有發現問題的部分。
- **可能碰到的已結項目**：R2-1、R2-3、R2-4、R2-5（`tests/ai-cards-flow.test.ts`）、R2-2（`tests/ai-publish.test.ts`）、系統資料夾防呆的既有行為（`tests/folder-guard.test.ts`）；本檔〈行為與風險〉的不可破壞性質第 1～9 點，特別是第 7 點：`Files.modify` 與 `blocksOf` 是共用路徑。
- **實作者自己選的做法**（規格沒寫，請先看）：
  1. R3-2：`Files.modify` 的 `edit` 可能被呼叫兩次，只發生在 Obsidian 版要先建上層資料夾時；第一次丟錯就不動資料夾（家長連資料夾刪掉時，離開筆記的補 ID 不讓它冒出來），第二次在建好之後。我看過現有呼叫端都沒有累積的副作用，契約 C5、C19 跟著改。第二次被擋時留下空資料夾，不清。Node 版只用在測試與工具，沒改。
  2. R3-1：`create` 的 `blocked` 一定是還沒寫，`publish` 據此把階段與路徑改回原值；`unreadable` 是已經寫了，階段留著。
  3. R3-3：`pending` 而全文一字不差仍算寫成：那就是要寫的那一份。
  4. R3-5：讀回被拒絕從 `failed` 改成 `unreadable`，不記進錯誤紀錄，和其他讀不到一致。上限沿用 `stuckAfter`（預設 30 秒），大於防呆單次搬回的 12 秒。`createAiCards` 不再直接拿 `files`，都走 `state.aiRead`，因此也會等防呆（`guard.wrap`）。
  5. R3-4：`displaced` 包含判斷出來的搬錯（`moved`、`both`）與沒搬回的；只有原位讀到 null 才停，讀得到的內容照常用。放回原位就解除；按「不用了」只解除判斷出來的搬錯，沒搬回的記在記憶體，重開 Obsidian 後才解除。作答紀錄照舊寫，不受這個門檻影響。
  6. R3-6：沒寫成時路徑改回原值，候選名不跨重試累積；同路徑 `exists` 三次也回 `name`。
  7. R3-7：清單內相對縮排 4 格以上也當圍欄（對齊 `listTree`，CommonMark 會當縮排程式碼）；縮排回到清單外的結尾符號不算關閉，會照最外層重新判斷，同 `listTree`。
- **想請特別找的新組合**：第二次 `edit` 被擋之後的重試；`displaced` 與 `unread` 同時成立時的回報；階段與路徑改回原值之後當掉重開；`readTimed` 逾時後底層讀取才回來；清單內圍欄與 `<<<完>>>`、篇名的交互。
- **驗證方式**：同本檔〈驗證方式〉；只跑這次的測試用 `node --test --test-timeout=60000 tests/ai-*.test.ts tests/obsidian-files.test.ts tests/folder-guard.test.ts tests/files-contract.test.ts`。Claude 跑過：每個 commit 的 `npm run check`（pre-commit）；真實回覆的回歸（`1f291ae` 與 `05528cc` 輸出相同）。**沒跑**：修完之後的 Windows 實機（第四輪通過後在最後要合併的 commit 重跑，含系統剪貼簿與 Files 契約的開發命令）；Claude 網頁（額度）；iPhone（延後，技術債）。
- **回報**：寫在 L2 報告最後新增一節〈第四輪〉，狀態行寫結果；格式同本檔〈回報〉，最後一行寫沒測的項目與原因。

## 第五輪窄審

使用者 2026-11-09 看過第四輪的四項後，選四項都修、再窄審一輪。這一輪只讀：本節、[L2 報告](<../Claude Codex Discussion/2026-11-07-ai-cards-mvp-l2.md>)的〈第四輪的 Claude 回應〉。**範圍只有 `git diff b4ff11f...claude/ai-cards-mvp` 與它直接影響的路徑**，不重審前幾輪已結的部分，也不找這段差異以外的新問題。遵守 repo 根目錄的 `AGENTS.md`，建議推理等級：**高**；只審查，不改產品程式，可以在隔離的暫存資料夾重現。

- **審查對象**：worktree `D:\程式開發\Essence Cards\.claude\worktrees\ai-cards-mvp`，分支 `claude/ai-cards-mvp` 的最新 commit。最後一個改程式的 commit 是 `26417ed`，之後只有文件。沒有未提交的修改。本節的 R4-1～R4-4 指 L2 第四輪，和格式查核的 R4-1 不同。
- **還沒結的發現**：R4-1～R4-4。每項都修了，請確認修法涵蓋同一類輸入、有沒有帶進新問題。
- **可能碰到的已結項目**：R3-1、R3-4、R3-6、R3-7 的回歸（`tests/folder-guard.test.ts`、`tests/ai-publish.test.ts`、`tests/ai-cards-flow.test.ts`、`tests/ai-cards.test.ts`）。
- **實作者自己選的做法**（規格沒寫，請先看）：
  1. R4-1：`missing` 也算不在原位。代價：家長自己刪掉 `紀錄/AI 輸出` 時，製卡會停到放回原位或按「不用了」為止；這比重新發布或誤判已放棄好。
  2. R4-2、R4-4：恢復資料多 `base`、`snapshotBase` 兩個必填欄位。舊格式的進行中工作會被當成讀不懂；這種工作只存在開發版，正式 vault 的 `0.3.0` 沒有 AI 製卡。
  3. 有了 `base`，第三輪 R3-6 的「路徑改回原值」拿掉：卡組沒寫成時只有階段改回去，路徑留在候選名；快照的位置也留著。
  4. R4-3：只有 `blocksOf` 判定屬於清單項目的圍欄帶欄位，頂格的照舊結束清單。
- **想請特別找的新組合**：快照位置留在候選名之後，對象變動或家長跳過一篇；卡組路徑留在候選名之後，重建或搬走的判斷；`missing` 與 `moved` 交替時的解除；清單內圍欄後接比圍欄淺的題目。
- **驗證方式**：同本檔〈驗證方式〉；只跑這次的測試用 `node --test --test-timeout=60000 tests/ai-*.test.ts tests/obsidian-files.test.ts tests/folder-guard.test.ts tests/files-contract.test.ts`。Claude 跑過：每個 commit 的 `npm run check`（pre-commit）；真實回覆的回歸（`1f291ae` 與 `26417ed` 輸出相同）。**沒跑**：修完之後的 Windows 實機（這一輪通過後在最後要合併的 commit 重跑）；Claude 網頁（額度）；iPhone（延後，技術債）。
- **回報**：寫在 L2 報告最後新增一節〈第五輪〉，狀態行寫結果；格式同本檔〈回報〉，最後一行寫沒測的項目與原因。還有擋合併的發現時，照第四輪的寫法列出真實路徑與不修的代價，交使用者決定。

## 第六輪窄審

使用者 2026-11-09 看過第五輪的兩項後，選兩項都修、再窄審一輪。這一輪只讀：本節、[L2 報告](<../Claude Codex Discussion/2026-11-07-ai-cards-mvp-l2.md>)的〈第五輪的 Claude 回應〉。**範圍只有 `git diff f6526d4...claude/ai-cards-mvp` 與它直接影響的路徑**，不重審前幾輪已結的部分，也不找這段差異以外的新問題。遵守 repo 根目錄的 `AGENTS.md`，建議推理等級：**高**；只審查，不改產品程式，可以在隔離的暫存資料夾重現。

- **審查對象**：worktree `D:\程式開發\Essence Cards\.claude\worktrees\ai-cards-mvp`，分支 `claude/ai-cards-mvp` 的最新 commit。最後一個改程式的 commit 是 `db0cec5`，之後只有文件。沒有未提交的修改。
- **還沒結的發現**：R5-1（`db0cec5`）、R5-2（`c3d5cdd`）。兩項都修了，請確認修法涵蓋同一類輸入、有沒有帶進新問題。
- **可能碰到的已結項目**：R3-6、R4-1、R4-2、R4-4 的回歸（`tests/ai-publish.test.ts`、`tests/folder-guard.test.ts`）。
- **實作者自己選的做法**（規格沒寫的部分，§5 已補兩句）：
  1. `published.attempted` 跟著位置走：開始寫之前記成 `true` 並存好；`refused`、`blocked` 改回原值；`failed`、`unreadable`、寫的時候當掉都留 `true`。換位置才歸零，對象變動不歸零。
  2. 第一次寫這個位置就回 `exists`、內容又不同：換下一個後綴，不再回 `conflict`（`f6526d4` 是 `conflict`）。曾經開始寫過的位置照舊停下。
  3. R5-1 只找同檔名、SHA-256 相同的 Markdown，用既有的 `aiRead`，不掃整個 vault 的內容。家長連快照檔都改名、或資料夾搬出 vault 後原位又長出新檔時，找不到同一份，會再發布一份；後者 vault 裡仍只有一份。
  4. 「放棄」用同一個檢查：別處有同一份就照發布處理，讀不到就停下。
  5. 恢復資料的 `published` 多一個必填的 `attempted`。舊格式的進行中工作會被當成讀不懂；這種工作只存在開發版，正式 vault 的 `0.3.0` 沒有 AI 製卡。
- **想請特別找的新組合**：`attempted` 為 `true` 時對象變動或檔名被占用；同一輪裡 `refused` 之後接 `exists`；`displaced` 與別處有同一份同時成立；放棄和繼續遇到別處同名但內容不同或讀不到的檔。
- **驗證方式**：同本檔〈驗證方式〉；只跑這次的測試用 `node --test --test-timeout=60000 tests/ai-*.test.ts tests/obsidian-files.test.ts tests/folder-guard.test.ts tests/files-contract.test.ts`。Claude 跑過：每個 commit 的 `npm run check`（pre-commit）。**沒跑**：真實回覆的回歸（這兩個 commit 沒動 `check.ts`、`draft.ts` 與貼回的解析）；修完之後的 Windows 實機（這一輪通過後在最後要合併的 commit 重跑）；Claude 網頁（額度）；iPhone（延後，技術債）。
- **回報**：寫在 L2 報告最後新增一節〈第六輪〉，狀態行寫結果；格式同本檔〈回報〉，最後一行寫沒測的項目與原因。還有擋合併的發現時，照第四輪的寫法列出真實路徑與不修的代價，交使用者決定。

## 第七輪窄審

使用者 2026-11-09 看過第六輪的三項後，選三項都修、做最後一輪窄審，並採用下面的擋合併標準。這一輪只讀：本節、[L2 報告](<../Claude Codex Discussion/2026-11-07-ai-cards-mvp-l2.md>)的〈第六輪的 Claude 回應〉。**範圍只有 `git diff d9bdf46...claude/ai-cards-mvp` 與它直接影響的路徑**，不重審前幾輪已結的部分，也不找這段差異以外的新問題。遵守 repo 根目錄的 `AGENTS.md`，建議推理等級：**高**；只審查，不改產品程式，可以在隔離的暫存資料夾重現。

- **這一輪的擋合併標準**（中斷恢復加同步的組合沒有上限，這一輪只攔會造成實際傷害的）。符合任一項才標「擋合併」：
  1. ID 重複或重用；
  2. 覆蓋或弄丟家長的檔；
  3. 孩子看到沒審過的卡；
  4. 正常流程（沒有中斷、沒有同步競爭）卡住或結果錯誤；
  5. 只有一個故障（一次中斷或一次讀不到）就走不出來：按「繼續」和「放棄」都沒有用。

  其他發現，例如要多個少見狀況同時發生、後果只是多一份快照或要按一次放棄的，標「不擋合併」，一樣寫真實路徑與後果，由 Claude 記進技術債。
- **審查對象**：worktree `D:\程式開發\Essence Cards\.claude\worktrees\ai-cards-mvp`，分支 `claude/ai-cards-mvp` 的最新 commit。最後一個改程式的 commit 是 `a42f551`，之後只有文件。沒有未提交的修改。
- **還沒結的發現**：R6-1（`97154a1`）、R6-2（`6305110`）、R6-3（`a42f551`）。三項都修了，請確認修法涵蓋同一類輸入、有沒有帶進新問題。
- **可能碰到的已結項目**：R5-1、R5-2、R4-1、R4-2 的回歸（`tests/ai-publish.test.ts`、`tests/folder-guard.test.ts`）。
- **實作者自己選的做法**（規格沒寫的部分，§5 已補）：
  1. `exists` 在這個位置第一次寫時就記成確定沒寫，先存再讀；曾經開始寫過的位置照舊保留可能寫成。
  2. 「快照是不是已經在 vault 裡」的核對在一開始和第 5 步各做一次。第 5 步之後才出現的同檔名由寫入回呼的檔名核對擋下，回到迴圈再查。
  3. 別處有同一份時優先算已發布，原位有不同內容也一樣，原位的檔不動。
  4. 刻意不處理：卡組改名，而且原快照剛好在建檔前一刻回到原位。全文已換，會停在衝突、不覆蓋；按「放棄」後結果正確（`ai-publish`〈可能寫成的快照在恢復途中才出現〉最後一段）。
  5. 放棄找到同一份時只清理、回報成功；這台電腦存不進去就停下，工作留著。
- **驗證方式**：同本檔〈驗證方式〉；只跑這次的測試用 `node --test --test-timeout=60000 tests/ai-*.test.ts tests/obsidian-files.test.ts tests/folder-guard.test.ts tests/files-contract.test.ts`。Claude 跑過：每個 commit 的 `npm run check`（pre-commit）。**沒跑**：真實回覆的回歸（這三個 commit 沒動 `check.ts`、`draft.ts` 與貼回的解析）；修完之後的 Windows 實機（這一輪通過後在最後要合併的 commit 重跑）；Claude 網頁（額度）；iPhone（延後，技術債）。
- **回報**：寫在 L2 報告最後新增一節〈第七輪〉，狀態行寫結果；格式同本檔〈回報〉，每一項標明「擋合併」或「不擋合併」並寫符合標準的哪一項，最後一行寫沒測的項目與原因。
