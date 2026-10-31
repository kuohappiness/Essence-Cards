# 重複的學習目標 ID：先停、家長選（D-157，給 Claude，本機執行）

狀態：等 Codex 格式查核（[查核請求](duplicate-ids-format-review.md)）；§1、§3 與 §7 的文件改動等查核一致才實作；程式還沒開工

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（[D-144](../docs/decisions.md#d-144-決策交給-opus-xhighfable-只在解不了的時候)：設計已在 D-157 與這份說明做完）。改 `src/state/`、學習目標 ID 與寫回卡組筆記，屬於高風險範圍：開工前先請 Codex 查核格式（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點），合併前請 Codex 做 L2（[quality.md](../docs/agents/quality.md#高風險範圍要做-l2)）。

依據：[D-157](../docs/decisions.md#d-157-重複的學習目標-id先停家長選)（修改 [D-079](../docs/decisions.md#d-079-卡組筆記的結構與學習目標的資料) 的「複製造成重複時，原本那個保留，新的換一個」；補充 [D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)）。完成條件的骨架是 [backlog 技術債](../docs/backlog.md#技術債)「重複的學習目標 ID 照位置或路徑決定誰保留」那一列；來源是[外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)〈環節 2 的結論〉第 3 條（Codex〈第 2 題〉的邊界表）與〈環節 3 的結論〉第 4 條（Codex〈第 4 題〉）。

## 和「不做」比較（D-153）

- **不做會怎樣**：照現在的規則，重複的 ID 由位置（同一篇排在前面的，`src/core/deck/assign.ts:96`、`src/core/study/plan.ts:80`）或路徑（路徑排在前面的卡組）決定誰保留。`0a393c5` 實測：把目標整段複製來改、貼在原本那個的上面，或貼到路徑排在前面的卡組，副本接手原本的記憶狀態，作答記在錯的目標上；紀錄只追加，之後很難分開。同一篇貼在上面時，存檔還把原本那個換成新 ID、進度歸零。貼到路徑排在後面的卡組，副本默默不出題。AI 製卡做好之前，卡組都是家長手寫，「整段複製來改」是最自然的寫法。
- **做的代價**：照 D-157 的代價——把目標整段複製來改時，原本那個也先停，要等家長選一次；家長處理之前這幾個目標都不出題；重複被看見之前已經記錯的紀錄不會修好。程式上 `state` 多一份衝突的結果、待處理多一種、作答多一道擋、複習畫面的卡會失效、小視窗多一種列法、離開筆記多一則通知；要 L2。
- **更小的做法**：
  - 只在排程擋（`planToday` 改成都不出）、存檔不改：存檔照樣把同一篇的第二個換號（`assign.ts:96`），貼在上面時原本那個被換掉，最嚴重的那一種擋不住。不夠。
  - 只停、不做家長選的入口：家長不知道 ID 存在（D-079：家長與 AI 都不寫 ID；畫面只說「加入複習」「進度連結」，`src/obsidian/save.ts:8`），只能把副本刪掉重寫；副本本身是家長要的。不夠。
  - 貼上的當下就拿掉副本的 ID：延後（D-157，見〈這次不做〉）。

## 排程與分支

| 步驟 | 內容 | 分支 | 誰 |
|---|---|---|---|
| 0 | 格式查核：syntax §2-3 已照 D-157 改寫（標待實作）；這份說明的 §1、§3 與 §7 | `main`（只改文件） | Codex 查核，Claude 改說明 |
| 1 | §1～§7 的程式與測試 | `claude/duplicate-ids`，從查核一致後的 `main` 開 | Claude 實作 → Codex L2 → 合併（使用者決定） |
| 2 | §9 的 Windows 實機 | 同上 | Claude |
| 3 | 正式版：合併後要不要升版、什麼時候裝，問使用者 | `main` | 照[外掛內備份任務說明](plugin-backup.md) §3 的流程 |

第 1 步用 `git worktree add ../Essence-Cards-duplicate-ids -b claude/duplicate-ids main` 開在旁邊的資料夾，不在主資料夾切分支。第 3 步之前，backlog「發布前比較的轉接器沒有讀取閘門」那一列的觸發點會到（「D-157 合併後的第一次發布前比較」），先做那一列。正式使用的 vault 裡已經有的重複 ID（現在跨篇的照路徑出、不會被發現），裝了新版之後會一起停：裝之前從發布前比較看有沒有，有的話先告訴使用者是哪幾個。

## 基準與開工條件

- 基準是這份說明所在的 commit：`git log -1 --format=%h -- tasks/duplicate-ids.md`。寫錯的目標看得到（技術債 D1）已合併（`b9309ca`），這次以它為準：`deckStatus` 已有 `malformed`，`Prepared` 的 `added` 改成 `fresh`、新增的數在核對時照採用的內容算（`src/state/ids.ts` 的 `confirmed`），存檔的通知把新增的數與寫錯的目標合成一則。
- 開工前 `git diff <基準> -- docs/decisions.md docs/syntax.md docs/backlog.md src/state/ src/core/deck/ src/core/study/ src/obsidian/save.ts src/review/session.ts` 看有沒有改過；有改以新版為準，並在回報註明。
- **等格式查核的**：§1（哪些算衝突）、§3（不自動換號、家長選了之後寫回什麼）與 §7（文件）。§2、§4～§6 不改格式，但都用 §1 的判斷，所以照順序在 §1 之後做；查核期間可以先寫 §8 裡不依賴定義細節的測試。
- 小視窗與通知的文字（§3-3）照 D1 的做法：§9 截圖給使用者看過再定。
- 這份說明沒寫到、做了又很難收回的，停下來問使用者。**只動測試 vault**（位置在本機 Claude 的記憶 `test-vault-location`）。

## 必讀範圍

| 讀什麼 | 為什麼 |
|---|---|
| D-157、D-134、D-079、[D-034](../docs/decisions.md#d-034-學習目標-id)、[D-135](../docs/decisions.md#d-135-清單解析和-obsidian-對照後的處理)、[D-069](../docs/decisions.md#d-069-新卡的開始與同一個字的兩個方向) | 規則本身；ID 的格式與保護；名稱寫成兩行；英文兩個方向 |
| [syntax §2-3](../docs/syntax.md#2-3-學習目標)、[§2-10](../docs/syntax.md#2-10-寫錯時)、[§5](../docs/syntax.md#5-複習紀錄) 開頭 | 哪些 ID 是學習目標 ID；寫錯的目標；紀錄只記 `lt` |
| [backlog 技術債](../docs/backlog.md#技術債)：D-157 那一列、「貼上時就拿掉副本的 ID」、「發布前比較的轉接器沒有讀取閘門」 | 完成條件、延後的部分、合併後會到的觸發點 |
| 討論稿〈環節 2 的結論〉第 3 條、Codex 回應環節 2 第二輪的〈第 2 題〉；〈環節 3 的結論〉第 4 條、Codex〈第 4 題〉 | 邊界表、取消作答的門檻、已顯示的卡、`planToday` 的防呆 |
| `src/state/index.ts`（`rebuild`、`planList`、`answerable`、`permits`、`deckStatus`、`resolve`、`removedInEditor`）、`src/state/ids.ts`（`fill`、`reserve`、`taken`、`resolve` 的 `record`、`status`）、`src/state/writes.ts` | 衝突要接的地方 |
| `src/core/deck/assign.ts`、`parse.ts`（`duplicate-id`）、`types.ts`（`AssignOptions`）、`markdown.ts`（`nameIds`、`blockIds`） | 自動換號與 ID 的辨識 |
| `src/core/study/plan.ts:80–103`、`types.ts` 的 `Today` | 要拿掉的「照路徑第一篇」 |
| `src/obsidian/save.ts`（`IssuesModal`、`MESSAGES`、`BUTTONS`、`leave`）、`src/review/session.ts`（`onChange`、`rate`、`change`）、`src/obsidian/dev.ts` 的 `today` | 小視窗、離開筆記、複習畫面、開發命令 |
| `tests/today.test.ts` 的 T8、`tests/state-ids.test.ts`、`tests/state-writes.test.ts`、`tests/save-wiring.test.ts`、`tests/review-session.test.ts` 的 2-2、`tests/deck.test.ts` 的 `replace` 與 `deckCases` | 要改與要沿用的測試 |
| `.agents/skills/code-quality/SKILL.md`〈測試〉 | 測試寫法 |

## 1. 哪些算衝突（格式查核）

- **範圍**：`state` 讀得懂的卡組（`decks()`，不含需要新版的 `blocked().decks`），用 `state` 最近讀到的內容。讀不到的那一篇保留上一次讀到的內容（讀不到不算刪除）；從來沒讀到的不知道內容，不算。
- **對象**：`parseDeck` 認出的學習目標（`deck.targets`），`id` 不是 null。草稿、暫停的卡組，暫停（`狀態：暫停`）、寫錯（`ok: false`）的目標都算。名稱那一行中間的 ID（`misplaced-id`）照 D-134 就是那個目標的 ID，也算。
- **不算**：引言框、一般筆記（底下沒有題目）、題目那一行的區塊 ID；`ambiguous-id` 的目標（`id` 是 null，候選不當成確定的 ID，照原本待處理）；還沒有 ID 的隱含目標。
- **衝突**：同一個 ID 有兩個以上的目標，同一篇或不同篇都算。結果是衝突的 ID，以及每個 ID 的目標（路徑、行號、名稱），照路徑、行號排。
- **時機**：在拿掉待處理的目標（`tracker.lines`）與需要新版的 ID（`gatedIds`）之前算，待處理的目標照樣占著它的 ID（Codex 的邊界表：否則一個被拿掉的目標會讓另一個冒充唯一的）。每次 `rebuild` 照目前的內容重算，不看讀到的先後、不另外記住：重開之後照目前的內容重算，兩台裝置讀到同樣的內容就停同一個 ID。
- **和需要新版的卡組同一個 ID**：照原本（`gatedIds`）停，不算衝突、不列給家長選（Cards 不讀也不寫那一篇，syntax §2-1）。
- **只維護一份**：判斷寫成核心的一個純函式（放 `src/core/deck/` 或 `src/core/study/`，施工時定），`state` 與 `planToday` 的防呆（§6）都用它，不另寫第二份。`state` 公開一個查詢衝突的方法（例如 `conflicts()`，回每個衝突的 ID 與它的目標），複習畫面（§5）與開發命令（§6）用它。

## 2. 停：不出題、不收新的作答

- **不出題**：衝突的 ID 的所有目標從 `planList` 拿掉，和待處理的目標一樣：今天的份與「再複習一些」都沒有；不占英文的配對（另一個方向照「這個方向不在」算，和待處理的目標相同）；作答不算進估秒（`subjectOf` 沒有它）。`deckStatus(path).missing` 不算它們（它們不補）。
- **不收新的作答**：`answer` 的作答與學習目標的狀態變更（`set` 加 `lt`）牽涉衝突的 ID 時不寫、回 null；`canAnswer(lt)` 回 false。
- **取消照原本的門檻**：`answer({ undo })` 不因衝突擋，只看它指的作答原本的門檻（需要新版、紀錄讀不懂、紀錄不完整）。Codex 的理由：不能只因重複就禁止撤銷先前的誤記。複習畫面的改評分是取消加新的作答，會因 `canAnswer` 是 false 整個不做。
- **iPhone 照算照擋**：手機的 `state` 一樣算衝突、一樣擋；處理留在電腦（D-134：iPhone 不寫卡組）。

## 3. 不自動換號、家長選（格式查核）

### 3-1 一般存檔與離開筆記

- 存檔（`tracker.fill`）與離開筆記的備援（`fillIds`）都跳過衝突的目標那一行，和待處理的一樣：不換 ID、不把行中的 ID 移回行尾、不改縮排。其他沒有 ID 的目標照補，配新 ID 時衝突的 ID 照樣算用過。
- **核心的契約**：`assignIds` 不再換「同一篇裡和前面重複的」ID（拿掉 `assign.ts:96` 的換號）；已經有 ID 的目標一律不換，不靠呼叫端記得傳 `skip`。`AssignOptions.replace` 沒有產品程式用，一起刪掉，`tests/deck.test.ts` 用到它的三個測試照新契約改寫或刪掉。
- **`parseDeck` 的 `duplicate-id`**：照舊是提示（`hint`，不影響 `ok`）、只標同一篇後面那一個，代碼不變（發布前比較的快照記代碼，`tools/compare/adapter.ts:68`）；文字改成不承諾換新，例如「這個學習目標 ID 和同一篇前面的重複；用了同一個 ID 的目標先都不出題，等家長選哪一個是新加的」。停不停只看 §1，不看這個提示。

### 3-2 家長選「這一個是新加的」

- **待處理多一種**：`IdIssueKind` 加 `'duplicate'`。每個衝突的目標在它那一篇有一個問題，`restore` 是 null（沒有可以還原的）；另外帶 `others`：同一個 ID 的其他目標（路徑、行號、名稱）。
- **物件身分**照 `IdIssue` 現有的規則（`src/state/ids.ts:5`）：那個目標的名稱、題目指紋與 ID 沒變時，重讀保留同一個物件，行號與 `others` 原地更新；變了換新物件，舊的不能再寫回。
- **`resolve(issue, 'new', editor)`**：
  - 送出時核對（D-134：寫回前重新確認）：編輯器的那一篇是 `issue.path`（別篇的不能從這裡改，`src/state/index.ts:409`）；用編輯器現在的文字重新比對，那一行還是同一個目標（名稱、題目指紋、ID 相同），而且這個 ID 照 `state` 所知加上這份文字仍然有兩個以上的目標。不成立回 `stale`，問題照目前的內容重算。
  - 只把那一行的 ID 換成新配的（D-034 的格式；避開 `taken`：見過的、紀錄裡的、刻意拿掉的、待處理問題的 `restore`）。同一篇其他衝突的目標、待處理的目標不動；同一篇其他沒有 ID 的目標照一般規則補（和現在的「當成新的」相同）；別篇不動。
  - 採用時（核對讀取確認寫成了）：被換掉的舊 ID **不**記成刻意拿掉（它還在別的目標上；現在的「當成新的」會記，`src/state/ids.ts:311`）；新 ID 記成見過。
  - `resolve(issue, 'restore', …)` 對 `duplicate` 回 `stale`，什麼都不寫。
- **紀錄**：複習紀錄的格式不變（syntax §5，不加欄位、不寫新種類的行）。被選中的那一個用新 ID 從頭複習；舊 ID 的紀錄留給剩下的那一個沿用。
- **刻意拿掉的其他來源**：家長在編輯器裡刪掉副本整個目標時，`removedInEditor` 報來的 ID 若照 `state` 所知仍在別篇的目標上，也不記成刻意拿掉（Claude 補的，backlog 那一列只寫了選「新加的」那一條路；同一篇裡還有這個 ID 時 `lock.ts` 本來就不報，`src/obsidian/lock.ts:273`）。
- **同一個目標同時是待處理（`lost`、`changed`）與衝突**：兩個問題都列；家長處理其中一個之後，另一個照目前的內容重算。

### 3-3 家長看得到（文字照 §9 截圖再定）

- **存檔按鈕**：有 `duplicate` 問題時照現有待處理的樣子（⚠、`TIPS.issues`）。
- **按存檔時跳出小視窗**：沿用現有的開法（存檔之後 `deckStatus(path).issues` 不是空的就開，`src/obsidian/save.ts:249`）。每個 `duplicate` 問題一列：說明（提案「〈名稱〉和別的學習目標用了同一個編號（可能是整段複製來改的），先都不出題」），列出 `others`（同一篇寫「第 N 行〈名稱〉」；別篇寫「〈卡組〉第 N 行〈名稱〉」，可以點，打開那一篇、捲到那一行），按鈕「這一個是新加的，從頭複習」。兩個名稱一樣時（貼上之後還沒改字就按存檔），家長只能靠行號分：文字要讓家長選「要改寫成新內容的那一個」。
- **離開筆記時**（備援）：`fillIds` 結束後（回 true 或 false），那一篇有 `duplicate` 問題就用通知說一次（提案「〈卡組〉有 N 個學習目標和別的目標用了同一個編號，先都不出題；打開這篇按存檔，選哪一個是新加的」）；`fillIds` reject 時照現在交給 `onError`、不通知。離開時不開小視窗。外掛已經卸載就不通知（技術債 W2 的 `alive`）。
- **手機**：沒有存檔按鈕，不提示；那幾個目標只是不出。

## 4. 恢復

- 只剩一個時（家長刪掉副本、選了新加的，或同步晚到的刪除到了），剩下的那個沿用這個 ID 繼續，其他門檻（待處理、需要新版、紀錄讀不懂、暫停、濾網、到期）照查；它用這個 ID 原本的紀錄。不保證剩下的就是歷史上原本那一個（D-157 代價第 3 點）。
- 讀不到不算刪除（§1）；重開之後照目前的內容重算。

## 5. 已顯示的卡與回看（複習畫面）

- 複習畫面（`src/review/session.ts`）收到 `onChange` 時，目前這張的 `lt` 在衝突裡，就丟掉這張、重新取卡，什麼都不寫；打字卡打到一半也一樣，不另外提示（和複習中途變成需要新版時相同，`tests/review-session.test.ts` 的 2-2）。理由：作答只帶 `lt` 與指紋（`src/core/study/types.ts:39`），衝突解除後分不出這張是哪一個目標的，不能讓它在解除後寫進去。
- 回看：衝突出現時已經在回看清單裡、`lt` 是那個 ID 的卡，之後都不能改評分，衝突解除後也一樣；解除之後才作答的照常。
- 作答時的擋法照原本：`answer` 回 null 就換下一張（`src/review/session.ts:414`）。
- 不推廣到其他內容修改：目前這張的題目被改字仍然不換（W6 §2-1，`src/review/session.ts:229`）。

## 6. `planToday` 與 `Today.problems`

- `planToday` 拿掉「照路徑第一篇」（`src/core/study/plan.ts:80–103` 的歸屬與 `problems`）。前提寫成「`state` 交進來的 ID 不重複」；直接收到重複的 ID 時（測試、發布前比較的轉接器），用 §1 的同一個判斷，輸入裡這個 ID 的目標都不出、不占配對、作答不算進估秒（防呆，不丟錯）。只看輸入裡的，不冒充檢查過 `state` 已經拿掉的。
- `Today.problems` 拿掉：D-157 之後外掛裡沒有來源，只剩防呆會用到；留著會讓人以為還有「這一篇的不出」的規則。開發命令 `today`（`src/obsidian/dev.ts:200`）改列 `state` 的衝突（每個 ID 的路徑與行號，最多 `limit` 個）。
- 發布前比較的轉接器這次不改（見〈這次不做〉）。

## 7. 文件（格式查核）

- `docs/syntax.md` §2-3 拿掉「待實作；現在的程式仍照位置與路徑決定」；查核認為要寫進哪些算重複、哪些不算（§1）時照查核補。
- `docs/architecture.md:239` 還寫「複製貼上造成重複的 ID 時，原本那個保留，新的換一個（D-079）」：改成一句話加連到 syntax §2-3（[D-141](../docs/decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份)：同一類資訊只維護一份）。
- 說明書（D-048）的句子記下來，跟說明書一起寫：「把學習目標整段複製來改時，存檔會請你選哪一個是新加的；選之前兩個都先不出題」。

## 8. 測試（驗收條件）

照 code-quality〈測試〉：只透過公開介面（`createState`、記憶體的 `Files`、測試用的編輯器、複習畫面的 `Session`、`planToday`、`assignIds`、`parseDeck`）；預期值是自編的字面值；一個 commit 一個決定或一項審查發現。共用的例子：

```markdown
- borrow 英翻中 ^b4rw7k
    - borrow :: 借入
```

加一筆 2026-10-01 對 `b4rw7k` 的 `good`；副本是整段複製、名稱與題目改成 `lend 英翻中`／`lend :: 借出`、ID 照留。

**停與不換號**（backlog 那一列的測試全部在這裡）：

1. 篇內貼在下面、貼在上面；跨篇副本的路徑在前、在後；第一次載入就重複：`today()` 的 `share` 與 `more` 都沒有 `b4rw7k`；`canAnswer('b4rw7k')` 是 false；`answer` 一筆作答回 null、紀錄檔沒有多一行；兩邊的 `deckStatus(path).issues` 都有 `duplicate`，`missing` 不算它們；`conflicts()` 列出這個 ID 與兩個目標。
2. 存檔與離開筆記的備援不偷偷解掉衝突：`save` 與 `fillIds` 之後，衝突的兩行逐字不變（篇內貼在上面時，原本那個仍是 `^b4rw7k`）；同一篇另一個沒有 ID 的目標照樣補上。
3. 三份同一個 ID，家長選第二份：只有那一行換成新 ID，第一、三份仍是 `^b4rw7k`、仍然衝突、仍然不出；別篇的檔逐字不變。
4. 送出時核對：小視窗拿到問題之後，那一行改了名稱、被搬到別行、或副本已經刪掉，`resolve` 回 `stale`、檔案不變，問題照目前的內容重算。
5. 恢復：刪掉副本（或另一台的刪除經同步到了），`b4rw7k` 又出現在今天的份，用的是 10-01 那筆的記憶；`canAnswer` 回 true。
6. 讀不到不當刪除：副本那一篇讀不到（`Files.read` 失敗）時衝突照舊；之後讀到、內容沒有副本才解除。
7. 兩台讀取順序不同：裝置甲一開始就讀到兩篇，裝置乙先只讀到副本那一篇、原本那篇晚到；兩台都讀到之後 `conflicts()` 相同，兩台都不出、都不收 `b4rw7k` 的作答。
8. 舊卡寫不進去（`Session`）：顯示 `b4rw7k` 的卡時加入副本，畫面換掉這張、紀錄沒有新的 `b4rw7k`；刪掉副本之後，這次 `Session` 回看裡衝突前做過的 `b4rw7k` 不能改評分；之後重新抽到、作答的照常寫。
9. 處理副本後，原本的目標在外部弄丟 ID 仍會待處理：(a) 選副本是新加的；(b) 在編輯器刪掉別篇的副本（`removedInEditor`）。之後在 Obsidian 以外拿掉原本那個的 `^b4rw7k`，`deckStatus` 有 `lost`、`restore` 是 `b4rw7k`。
10. 取消照原本的門檻：衝突期間 `answer({ undo: <10-01 那筆的 t> })` 照寫；`Session` 的改評分不做。
11. iPhone（`fillIds: false`）：衝突照算、作答照擋，卡組不寫。

**邊界**：

12. 草稿卡組裡的副本、暫停的目標、寫錯的目標（中翻英答案有中文）各自和啟用的 `b4rw7k` 衝突；名稱行中間的 `^b4rw7k` 也算。
13. 一般筆記 `- 筆記 ^b4rw7k`（底下沒有題目）、引言框裡的 `> - borrow 英翻中 ^b4rw7k`、題目行的 `^b4rw7k` 不造成衝突。
14. `ambiguous-id` 的候選有 `b4rw7k`、另一個目標是 `^b4rw7k`：不算衝突，`ambiguous` 照原本待處理；選「還原」成 `b4rw7k` 回 `stale`（原本的檢查，`src/state/ids.ts` 的 `resolve`）。
15. 需要新版的卡組有 `b4rw7k`：不列衝突，讀得懂那一篇的 `b4rw7k` 照原本停。
16. 跨層：另一份先被待處理拿掉。載入 `- borrow ^aaaaaa`，在 Obsidian 以外把 ID 改成 `^bbbbbb`（`changed` 待處理），再在別篇加 `- lend ^bbbbbb`：`lend` 不出、兩個都在衝突裡。
17. 同一個目標同時是 `changed` 與衝突：兩個問題都列；選「當成新的」之後兩個都消失。
18. 重開之後照目前的內容重算：衝突還在時新開的 `state` 照停；解除後寫回的檔，新開的 `state` 沒有衝突。

**核心與畫面**：

19. `planToday` 直接收到重複的 ID：那個 ID 都不出、不丟錯，其他目標照常；英翻中是重複的時，中翻英照「英翻中不在」排。`today.test.ts` 的 T8 照新規則改（`g4` 兩篇都不出，補「草稿裡的副本讓啟用的也不出」）；`Today` 沒有 `problems`（型別檢查擋）。
20. `assignIds`：`- A ^same` 與 `- B ^same` 都不換，其他沒有 ID 的照補；這個例子登錄進 `deckCases`（往返與冪等：第二次執行不改任何字）。`parseDeck` 的 `duplicate-id` 照舊是 `hint`、兩個目標的 `ok` 都是 true、文字不提換新。
21. 小視窗（`tests/save-wiring.test.ts`）：存檔後開小視窗，`duplicate` 列出 `others`、別篇的有跳轉、按鈕呼叫 `resolve(issue, 'new', …)`；離開筆記時有衝突就通知一次、不開小視窗；沒有衝突不通知；卸載後不通知。
22. 現在依賴「篇內第二個換新」或「照路徑第一篇」的測試（找 `duplicate-id`、`replace`、T8、`problems`）照新規則改，改了哪些寫進回報。

## 9. Windows 實機（AI 用開發版在測試 vault 做）

- 照 `0a393c5` 的三種實測再做一次：同一篇貼在上面、貼在下面、貼到別篇。確認今天的份不出、按存檔不換號、小視窗選了之後只換那一個、刪掉副本後恢復。
- 截圖（開發版的 `ui` 命令，淺色與深色）：存檔按鈕的 ⚠ 與說明、小視窗（篇內兩個、跨篇有跳轉）、離開筆記時的通知；**交使用者看文字**。點別篇的跳轉，確認打開並捲到那一行。
- 結果寫進回報。iPhone 不另外排：手機只走 `state` 與複習畫面，這兩層的 Node 測試涵蓋；手機上的差異不在這條路上。

## 10. 完成條件

- 格式查核一致；Codex L2 通過（或發現都已處理）；`npm run check` 全過。
- backlog 技術債 D-157 那一列照這份說明的結果刪掉；「貼上時就拿掉副本的 ID」那一列照原觸發點留著。
- §7 的文件改好；roadmap 照實際狀態更新；這份說明的狀態行改成已完成並寫 commit。

## 必跑的指令

- `npm run check`（pre-commit 會跑；Codex 照 [quality.md〈檢查指令〉](../docs/agents/quality.md#檢查指令)在沙箱外跑）。
- `npm run build`。
- 改到排程時：`node --test tests/today.test.ts tests/study-performance.test.ts`（`planToday` 的時間門檻）。

## 這次不做

- 貼上的當下就拿掉副本的 ID（backlog「貼上時就拿掉副本的 ID」，觸發點：真實使用時家長反覆因為同一篇裡的複製被擋）。
- 發布前比較的轉接器（backlog 那一列；觸發點在 D-157 合併後的第一次發布前比較）。
- 修好衝突被看見之前記錯的紀錄（D-157 代價第 3 點）。
- 在手機上處理衝突（D-134）；在小視窗裡直接改別篇（`resolve` 只改開著的那一篇）。
- 別台裝置還沒看見的重複（例如手機只讀到副本、原本那篇還沒同步到）：每台照自己目前所知判斷，不承諾擋住。
- 目錄畫面的提示（目錄照 D-111 在後面）；已顯示的卡遇到其他內容修改時重新取卡。
