# AI 製卡最小版：L2 獨立審查（給 Codex）

狀態：待審（2026-11-07；11-08 加上真人測試之後的兩次修正 `1ff5092`、`e48c8b7`，並合併了 `main` 的 `eee68d4`）

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
