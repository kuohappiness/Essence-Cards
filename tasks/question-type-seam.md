# 題型接點與選詞填空（D-181、D-178，給 Claude，本機執行）

狀態：§2 第一步已實作，等 Codex 查行為（[請求](question-type-seam-step1-review.md)）；§3 寫法還在變動，定案前不送格式查核（[請求](question-type-seam-format-review.md)）、不動第二步；分支 `claude/question-type-seam-927507`，基準 `283f4c6`

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：寫這份用 **Opus、xhigh**，實作用 **Opus、高**（[quality.md](../docs/agents/quality.md)）。改解析、紀錄、排程、複習流程，跨模組，合併前要 L2。必讀 code-quality 的〈測試〉。

依據：[D-181](../docs/decisions.md#d-181-題型是可以接上的模組開題型專區) 第 5 點（先搬舊的兩種，再接選詞填空）、[D-178](../docs/decisions.md#d-178-相似字用點字比較卡一格一個學習目標) 與[相似字比較卡的規畫](../docs/plans/similar-chars.md)（規格，這份不重抄）、[D-179](../docs/decisions.md#d-179-介面的每一項都要有必要性非必要不出現)、[題型專區](../docs/question-types.md)的〈定案一個題型要回答什麼〉。示意頁原始檔 `experiments/mockups/similar-chars-card.html`。

## 和「不做」比較（D-153）

- **不做會怎樣**：差別直接寫在流程裡。`src/review/session.ts` 與 `src/ui/Review.tsx` 共 47 處左右判斷是不是打字卡（粗估），`src/review/preview.ts` 另外實作一份翻面與打字。比較卡要一張好幾個目標，`Card` 只有一個 `lt`（`src/core/study/types.ts`）、`rate` 與 `change` 一次一行（`src/review/session.ts:410`、`:446`），所有共用的路都要改；不抽接點，每多一種題型再改一輪。
- **做的代價**：打字卡調過很多輪，搬動可能弄壞；孩子感覺不到好處，好處在之後的開發。解法：第一步只搬不改，現有測試一字不改全部通過，另外跑一次新舊版的差分（§2-5），Codex 只查行為；正式使用的 vault 還沒有卡組，現在搬最便宜（D-181）。
- **更小的做法**：只有選詞填空走接點，舊的兩種不動：D-181 比較過，新舊兩套並存，接點也只試過一種，第四種可能要回頭改。不抽接點、每處再加一句：同上。

## 排程與分支

| 步驟 | 內容 | 誰 | 等什麼 |
|---|---|---|---|
| 0 | 這份說明；§3、§4、§5-4 的格式查核 | Claude 寫，新開的 Codex 查 | §3、§4 實作前要看到結果 |
| 1 | §2：翻面、打字搬到接點，獨立 commit | Claude 實作；Codex 只查行為 | 不等格式查核 |
| 2 | §3～§9：接選詞填空 | Claude 實作 | 第 1 步的查核通過；§3、§4 等格式查核 |
| 3 | §10：Windows 實機；L2；iPhone 項目併進 backlog | Claude、Codex | 第 2 步 |
| 4 | 合併；`docs/question-types.md` 第 2、3 段、roadmap、syntax 更新 | Claude | L2 通過 |

開工與合併前都看分支 `claude/exam-scope-c0f437`（考試範圍）合併了沒：它改 `src/core/study/plan.ts`（`retentionOf`）、`practice.ts`（`Item` 多 `entry`）、`types.ts`、`src/state/index.ts`，和 §5 重疊。先合併的一邊不動，後合併的一邊解衝突。

## §1 接點的形狀

**一句話**：一種題型 = 四張表各填一列。共同的流程（拿下一張、進度、回看、切走 60 秒重來、寫紀錄、預覽）只透過接點和題型說話，不再判斷是哪一種。新增題型時 `QuestionType` 多一個值，TypeScript 會指出每張表缺哪一列（`Record<QuestionType, …>`），是機械檢查，不靠人記得。

| 接點 | 位置 | 這一列要回答什麼 | 翻面 | 打字 | 選詞填空 |
|---|---|---|---|---|---|
| 認得出來 | `src/core/deck/question-types.ts` | 名稱與題目怎麼認、哪些算寫錯 | 其他全部 | 名稱「 中翻英」，答案能比對 | 名稱「字（組） 相似字」，答案是這個字 |
| 怎麼組成一張卡 | `src/core/study/compose.ts` | 這張卡有哪幾格、出哪一題 | 一格 | 一格 | 同組到期的併成一張（§5） |
| 怎麼作答 | `src/review/flow.ts` 與各題型一個檔 | 孩子做什麼、程式怎麼判、對到哪個評分、寫哪幾行 | 翻面、四級 | 三步（D-121） | 點字、對答案、再選一次（§6） |
| 畫面 | `src/ui/screens.tsx` 與各題型一個檔 | 題目區、底部那一排、點卡片做什麼 | | | |

不做可以安裝的模組（D-181 曾考慮的做法）：表就是 `const` 物件，不做註冊機制。

### 1-1 一張卡（`Card`，`src/core/study/types.ts`）

```ts
interface Blank { lt: string; target: Target; prompt: Prompt }   // 一格，只對一個目標（D-114）
interface Card {
  lt; deck; target; prompt; isNew; typed; early;                 // 不變；好幾格時是選中的那一格
  blanks: readonly Blank[];                                      // 新增，至少一格；翻面、打字就是自己那一格
  group: CardGroup | null;                                       // 第二步才加：字鍵與整組對照
}
```

`questionType(card)` 是唯一判斷題型的地方（`group` 有值是選詞填空，`typed` 是打字，其他是翻面）；`Card` 不再多存一份題型。`nextCard`、`practiceNext` 與預覽各自重複的 `typed: prompt.kind === 'qa' && …` 併成一個 `cardOf`。

### 1-2 作答流程（`Flow`，`src/review/flow.ts`）

一張卡從題目走到有結果的整段狀態，一個物件。Session 與預覽都只透過它：

```ts
interface Flow {
  view(): FlowView;                       // 畫面要的：revealed、allowed、speakable、typed（第二步加 pick）
  autoRead: readonly string[] | null;     // 這一刻該念的；每個有效動作開頭清掉（D-116）
  revealedAt: number | null;              // 答案出現的時間，0.3 秒內的自評不算（D-096）
  act(action: FlowAction): boolean;       // 一個動作；回傳算不算數（不算就不通知畫面）
  settle(rating: Rating | null): Settled; // 記下來：要寫哪幾行、回看要的東西
}
interface Settled {
  lines: readonly ReviewLine[];           // 一個目標一行；翻面、打字一行
  look: LookBack;                         // 回看時的 typed／pick、能改成哪些評分、改了之後寫哪幾行
}
type FlowAction = { kind: 'reveal' } | { kind: 'input'; text: string } | { kind: 'submit' } | { kind: 'skip' };  // 第二步加 key、row、check
```

`createFlow(card, { now })` 照 `questionType(card)` 查表。預覽的打字走另一個流程（`createPreviewTyped`：不走三步，D-161），翻面走同一個（多一個 `revealed` 的起點）。預覽什麼都不寫，自評也不等 0.3 秒，所以它的流程（`createPreviewFlow`）沒有 `settle`、`revealedAt`。第一步的 `settle` 只收評分；第二步要 `settle(null)` 時才放寬。按下的評分留在 Session，第一步不放進 `Settled`。

**四種邊界都試過**（D-181 要求接點試過這些）：孩子自評（翻面：`allowed` 全部）；一張卡走好幾步（打字：`act` 走三步，`allowed` 由第 1 步決定）；一張卡好幾格好幾個目標（選詞填空：`lines` 好幾行，`settle(null)` 不用選評分）；程式判一部分、孩子自評一部分（找錯題，還沒定案：`act` 判位置、`allowed` 限制評分、`lines` 帶證據，不用改 Session）。

Session 留下：取卡、`top`、回看清單、切走重來、衝突與停用、0.3 秒、寫紀錄。`Session` 的方法與 `CardView` 的欄位都不變，`reveal`、`input`、`submit`、`skip` 轉成 `act`；第二步新增 `act(action)`（字鍵、句子、對答案）與 `commit()`（有錯時的「下一張」），新題型不用再加方法。

### 1-3 畫面（`src/ui/screens.tsx`）

```ts
interface Screen {
  Body(props): JSX.Element;               // 題目區
  bottom(props): ReactNode;               // 底部那一排的內容；null 是沒有這一排
  tap(view, tools): void;                 // 點卡片：翻面／叫出鍵盤／什麼都不做
  stage(view): string;                    // 舞台多加的 class（打字中的 is-typing）
}
const SCREENS: Record<QuestionType, Screen> = { flip, typed, pick };
```

`tests/helpers/review-ui.ts` 的替身只讓根元件有 hook，所以 `Screen` 都沒有 hook，狀態都在 `Flow`；打字的自動取得焦點留在 `Review` 根元件（看 `view.card.typed`，第一步不動）。翻面與打字共用題目、背面、出處的骨架（`QaCard`，由題型給差別的部分）。`bottom` 是普通函式、不是元件，`Review` 直接呼叫、放進同一個 `.ec-actions`：換題型時同一顆評分按鈕留在原處，焦點不掉（Codex 第一步查核 F1）。

## §2 第一步：只搬不改

1. 新增 `flow.ts`、`flip.ts`、`typed.ts`（`src/review/`）；`session.ts` 第 165～181 行、第 307～408 行、`present`、`cardView`、`rate`、`change` 裡打字的部分搬過去，邏輯一字不改。`TypedView`、`allowedFor`、`RATINGS` 等照舊從 `src/review/index.ts` 匯出。
2. `preview.ts` 的逐張狀態（`typed`、`revealed`、`autoRead`、`announce`、`finishTyped`）改走 `Flow`，自己只留換張與上方的文字。
3. `src/core/deck/parse.ts` 第 222～236 行搬到 `question-types.ts`，只移位置。
4. `Review.tsx` 的 `Card`、`Actions`、`TypedActions` 搬到 `screens.tsx` 與 `QaCard`；`.ec-*` 的 class 不變，所以 CSS 不動。
5. **差分**：另寫一支不進 repo 的腳本，用同一個亂數種子對新舊 `createSession`、`createPreview`（舊的從 `283f4c6` 的 worktree 載入）餵同一串動作（翻面、打字、確認、跳過、自評、回看、改評分、切走、換天），每一步比 `JSON.stringify(view())` 與紀錄的每一行；腳本與結果寫進交給 Codex 的請求。

**不可破壞**：孩子看到的行為與紀錄的每一個字都不變。

**驗收**：
- `git diff 283f4c6 -- tests/review-session.test.ts tests/review-ui.test.ts tests/review.test.ts tests/preview.test.ts` 是空的，且四個檔全部通過（基準當時 42、23、20、8 個）。`tests/helpers/` 最多調引用路徑。
- `npm run check` 通過；`src/review/session.ts` 裡不再有 `checkTyped`、`spelling`、`hintOf`（`grep` 不到），`src/ui/Review.tsx` 裡不再有 `typed.step`。
- 差分跑 2000 串、每串 60 步以上，沒有差異（差異要逐項說明，不能略過）。
- 這一步不改 `docs/syntax.md`，也不改 `tests/` 以外的格式。

## §3 卡組：名稱與題目（⏳ 格式查核）

**這一節還沒定稿**（2026-11-05，另一個對話轉述，等使用者回答，定了寫回 `main`）：① 題型要不要改名（提案「比較填空」）；② 程式改認括號（名稱的字在組裡、答案都在組裡），不靠「相似字」這個結尾，結尾直接當卡片標題；③ 多於 5 個不算錯，6 個以內一排、7 個以上兩排；④ 只有兩個選項的組，到期時出兩句，降低猜對的機率。定案前下面的表只是目前的版本，程式識別字與測試都不寫死「選詞填空」「相似字」。

使用者已決定：這個題型各科都能用，程式不分科，字鍵要放得下詞（`affect`、`質量`）；家長出題時勾選要不要用，勾選本身跟著 AI 製卡模組做，不在這次範圍。

寫法照[規畫〈卡組怎麼寫〉](../docs/plans/similar-chars.md#卡組怎麼寫)。`parseDeck` 的結果：

```ts
interface PickGroup { char: string; members: readonly string[]; key: string }
interface Target { …; group?: PickGroup }   // 選填：沒有就是一般目標，舊測試的 deepEqual 不用改
```

| 名稱 | 結果 |
|---|---|
| `寨（寨、塞、寒、賽） 相似字` | 正式的寫法（使用者 2026-11-05 同意，字和詞都放得下）：`char: 寨`、`members: [寨,塞,寒,賽]`、`key` 是排序後的字接起來（順序不同是同一組） |
| `寨(寨、塞、寒、賽) 相似字`、`寨（寨,塞，寒 賽）  相似字`、`寨（寨塞寒賽） 相似字` | 同上：半形括號、逗號、空白、多打的空白都容忍（記憶 `tolerate-typing-noise`）；完全沒有分隔符號時一個字一個（照 code point，避開造字的代理對） |
| `寨（寨、塞、塞） 相似字` | 重複的只留一個 |
| `塞車 相似字`、`寨（山寨） 字義` | 不是比較卡，照一般目標，沒有提示 |
| `寨（塞、寒） 相似字`、`寨（寨） 相似字`、`寨（寨、塞、寒、賽、安、交） 相似字` | error `pick-group-invalid`：字不在組裡、少於 2 個、多於 5 個（D-175、規畫）。跳過這個目標（§2-10），存檔按鈕與目錄照現有的路提示 |

**每一題**都要符合，有一題不符就整個目標算寫錯（error `pick-answer-invalid`）：問答題（不是填空）；題目剛好一個 `＿＿`（`＿` 連續兩個以上，和 `BLANK` 同一種認法）；答案去掉 `**`、`==`、前後空白後就是這個字（`char`）。

**為什麼是算寫錯，不是退回翻面**：和中翻英的答案不能比對相同（§2-10），程式判不了；退回翻面的話畫面默默換了樣，家長不知道。「有退路」（題型專區〈共同規則〉）說的是舊版看到新寫法，舊版本來就照問答卡出。

組的身分：同一篇卡組、`key` 相同。不跨卡組（和 §2-3 英文的兩個方向同一個範圍）；不看是否有重疊，添（添漆）和添（添舔）是兩組（預設〈相似字〉）。組裡的字沒有自己的目標時，字鍵照樣有，對照那一行只有字（`check-syntax` 提醒）。

指紋照 §2-8，不變；`typed` 是 null。記憶錨點照舊是 `shared`。

## §4 紀錄（⏳ 格式查核）

每個字一行，沿用 `lt`、`r`、`v`，同一張卡的行連續寫（時間差幾毫秒）：

```
{"t":"2026-11-05T20:15:03.250+08:00","lt":"寨的 ID","r":"near","v":"a1b2c3d4","pick":"塞","retry":"right"}
{"t":"2026-11-05T20:15:03.251+08:00","lt":"塞的 ID","r":"good","v":"9f0e1d2c","pick":"塞"}
```

| 欄位 | 內容 |
|---|---|
| `pick` | 選填，只寫在比較卡：第一次選的字（對的也寫）。第一次按「沒印象」不寫。順序在 `typed` 的位置之後、`retry` 之前 |
| `retry` | 比較卡沿用：第一次選錯時，再選的結果 `right`／`wrong`／`skip`（再選時按「沒印象」）。第一次就對、第一次按「沒印象」都不寫 |
| `r` | 第一次對 `good`；全對又按太簡單時每一行都是 `easy`；第一次錯、再選對 `near`；再選也錯、按「沒印象」`miss` |
| `v` | 這一句的指紋 |

- 同一張卡同一個字有兩格：一行，取比較差的那格的 `r`、`v`、`pick`、`retry`；一樣差取畫面上前面那一格。
- 不寫 `typed`、`need`、`src`。舊版讀到 `pick` 忽略（`src/core/study/entries.ts:40` 只取認得的欄位），讀到 `retry` 也忽略（現在就這樣），每一行都是合法的作答：不用 `need`（§0-1）。
- `parseLine`、`ReviewEntry`、`sameReview`（`src/core/study/history.ts:19`）都不讀 `pick`：它只是證據（D-115），和 `retry` 相同。
- 一行寫不進去（那個目標被停掉，`state.answer` 回 null）：其他行照寫，每一行本來就獨立；全部寫不進去照現有的做法換下一張。

## §5 今天的佇列

### 5-1 哪些字併成一張（`nextCard`、`practiceNext`）

選卡規則不變（到時間的、新的、提早出）。選中一個有 `group` 的目標時，範圍裡同一組的目標（同一篇、`key` 相同）：

| 那個目標現在 | 選中的不是提早出 | 選中的是提早出（範圍裡只剩等再出的） |
|---|---|---|
| 新的、到時間了 | 併進來 | —（有的話就不會提早出） |
| 答錯、還沒到時間 | 不併 | 併進來 |
| 今天已經答對 | 不併 | 不併 |
| 不在範圍裡（暫停、寫錯、ID 重複、被停掉、別科、不在 `targets`） | 不併，字鍵與對照照樣有 | 同左 |

### 5-2 每格出哪一句

`choosePrompt` 對比較卡改成：最久沒出的（沒出過的先，照筆記順序）。第一次就是基本題；答錯再出時換一句（規畫〈怎麼出題〉、D-028），這是和其他題型（答錯出同一題）唯一的差別。只有一句就還是那一句。

**多放一句**：這張卡的格數等於字鍵數時（第一次整組一起出，或後來剛好全部到期），多放一句，刪去法才不好用；從還有別句的字裡選，都沒有別句就不加。規畫只寫第一次，理由（句子比字多）在全部到期時一樣成立（💡 實作者的選擇，列在 §11）。

### 5-3 打散

字鍵與句子的順序由這張卡的指紋（每格的 `v` 接起來）算出，同一張卡重來（切走 60 秒）不變，換句子就變；字鍵順序一定和括號的順序不同（示意頁的 `shuffled`）。放在 `compose.ts`，純計算，不用 `Math.random`，測試與回放才固定。多放的那一句挑哪個字也用同一個來源。

### 5-4 新卡整組進、秒數（⏳ 格式查核只看第 2 點）

1. **整組進**（`planToday`）：排好順序後，新的目標（`new`、`exam-new`）碰到同組的第一個時，同組其他新的目標緊接在它後面。
2. **秒數**（D-120，`secondsBySubject`）：相鄰兩筆間隔小於 200 毫秒的不算一個間隔，兩筆當成同一張卡（`previous` 照常往後）。理由：一張卡的幾行差幾毫秒；兩張不同的卡一定隔至少 0.3 秒（`RATE_DELAY`，翻面後 0.3 秒內的自評不算）。所以不用加欄位。
3. **一張算一次**：同一組裡第一個放進今天的份的目標才占時間；後面同組的不再占，也不受「第一個放不下的和它後面的全部進 more」影響（它們和第一個同一張）。第一個放不下，同組全部進 `more`。放好之後，那張卡的秒數平均分給它的幾個目標（`QueueItem.seconds` 可以有小數），`remainingSeconds` 隨答對遞減，總和不變；入口已經無條件進位（`src/review/entry.ts:30`）。
4. **完成**：照目標算，不改（規畫〈要改的地方〉）：`scopeCount`、`progress`、`todayLeft` 不動，「還剩 N 張」一次少好幾個。

## §6 作答流程（`src/review/pick.ts`）

照示意頁的 `tapKey`、`fill`、`tapRow`、`tapCheck`、`skip`，搬成純程式（時間由 `now` 給）。

| 動作 | 階段 | 結果 |
|---|---|---|
| `key(字)` | 作答 | 目前這格填這個字，游標跳到下一個空格（往後繞一圈）；0.3 秒內同一個字不算（規畫的防連點）；沒有游標時不填 |
| `key(字)` | 再選 | 剛才選的字不能按；這格記下，對的 `near`，錯的 `miss`，跳到下一個要再選的格；沒有了就到結果 |
| `row(i)` | 作答 | 游標移到第 i 格，再點字直接換掉 |
| `row(i)` | 再選 | 只有要再選的格可以點 |
| `skip` | 作答 | 這格填「？」（對答案前都能改）；游標同 `key` |
| `skip` | 再選 | 這格 `miss`，同 `key` |
| `check` | 作答 | 有空格：游標跳到第一個空格，不對答案。最後一次填字後 0.35 秒內不算。否則判定：對的 `right`；「？」`miss`；其他要再選；沒有要再選的就到結果 |

`allowed`：只有結果階段、而且每格都 `right` 時是 `['good','easy']`；其他都是空的。`settle(null)`（「下一張」）只在結果階段有錯時算數；`settle('good'|'easy')` 只在全對時算數。兩者都要過 `revealedAt` 的 0.3 秒（進結果階段時設）。「第一次對」與評分的對應只有一份，對照 §4 的表。

切走超過 60 秒、回來從頭開始：照現有的規則（`src/review/session.ts:501`），包括已經在結果階段還沒按的（D-074 的「已經翻面但還沒按」）；這時什麼都沒寫。

## §7 畫面（`src/ui/PickCard.tsx`、`PickCard.css`）

照示意頁與規畫〈畫面與防點錯〉，CSS 用 `tokens.css` 的變數。**寫畫面前先看 `main` 最新的規畫與 D-179**（「拿掉的東西」還在另一個對話談）。要點：

- 每張卡都有的那一行（路徑、「新」）照舊在最上面；標題「相似字：寨、塞、寒、賽」接在下面。
- 句子用 `Markdown`（粗體、圖照樣，D-089 第 7 條），`mode: 'typed'`、一條線；`Markdown` 新增 `slotNode`，和 `tail` 一樣用 `createPortal` 放進空格，按鈕就是空格本身。
- 對照：每個字一行。第一行是記憶錨點去掉「記憶錨點：」、去掉最後一個全形冒號之後的部分（`Markdown`，粗體是紫色），第二行是常用詞（冒號後面；沒有冒號就沒有這行）；右邊是這張卡的結果，這次沒出句子的字沒有。
- 字鍵與兩個動作放在 `.ec-actions`（底部），結果階段換成評分或「下一張」。不用 hook：飛過去的動畫用 `event.currentTarget` 與 `querySelector`，尊重 `prefers-reduced-motion`。
- 鍵盤：結果階段的 3、4 照舊評分；Space、Enter 是「對答案」與「下一張」。字鍵用滑鼠點或 Tab，不加數字鍵（D-179，主要在 iPhone）。
- 手勢、旗子、✕、回看的按鈕照舊。旗子交出去的是選中的那一格（`card.lt`）。

## §8 回看與復原

一張卡一筆（D-084「回看這一次做過的每一張」），不是一個字一筆。回看顯示結果階段的畫面，字鍵不出現。

規畫〈待決〉：**回看時能不能改比較卡的結果**。💡 先照 Claude 的建議做，使用者 2026-11-05 問過還沒選，不算確認：孩子自己選的才能改，程式判的不能改，所以全對的可以在記住了、太簡單之間改，有錯的不能改。要換成別的做法只改 `pick.ts` 的 `changeable` 一處。

改評分時（D-074）：每一行先 `undo`，再寫新的行，一起寫或一起不寫：先問過每一行的取消與新的作答都不會被拒（`state` 新增 `permits(entry)`，把現有的內部函式公開），有一行不行就都不寫。

ID 變成重複（D-157）：目前這張牽涉的任何一個目標衝突，整張丟掉重新取卡，什麼都不寫；回看裡牽涉衝突的卡不能改。停用（`canAnswer`）同樣看每一個目標。

## §9 預覽（D-161）

- 一組一張「第一次」的卡（每個字第一句加多放的一句），剩下的句子各一張（一格，字鍵照樣整組）。每一句都看得到一次，孩子實際會看到的兩種樣子也都有。
- 作答與複習同一個流程；評分與「下一張」只換下一張，不寫。
- 「預覽時自動展開答案」：直接到結果階段，空格是答案，沒有對錯記號與結果。

## §10 語法檢查與實機

- `experiments/t4/check-syntax.mjs`（含 `--selftest`）：錯誤：§3 的兩種。不符：每個字少於兩句；答案的字出現在題目裡（預設〈相似字〉）；沒有記憶錨點、錨點沒有粗體；同組的字沒有自己的目標。提醒：冒號前超過約 15 字。
- Windows 版 Obsidian（開發命令，換版前看測試 vault 有沒有別的 session 在用）：第一次整組、點錯、再選、沒印象、全對、回看、切走、預覽；每一項看紀錄的行與畫面的截圖（`ui` 命令），深色淺色都截。
- iPhone 併進 [backlog 的下一次 iPhone 實機測試](../docs/backlog.md#v1-需要做的任務)：字鍵大小、0.3 與 0.35 秒、拿掉提示句後第一次用看不看得懂（規畫〈要改的地方〉）；比較卡在 iPhone 換卡的速度（一張最多九段 `Markdown`）；字鍵用系統黑體（D-180）。

## §11 驗收條件（第二步）

測試只透過公開介面：`parseDeck`、`planToday`、`nextCard`、`createSession`（接真的 `createState`）、`createPreview`、`Review`（`tests/helpers/review-ui.ts`）。例子用規畫與示意頁的字。

**解析**：§3 表的每一列；`deckCases` 有比較卡，往返與冪等自動受保護；syntax 的新範例跑得過解析；舊版（`283f4c6` 的 `parseDeck`）讀同一份當問答卡，每一題的指紋相同。

**紀錄**：§4 表的每一列；比較卡的行用舊版 `parseLine` 讀得懂；`pick` 的順序在 `retry` 前；同一個字兩格取比較差的；重新 `mergeHistory` 與 `appendLine` 結果相同。

**佇列**（寨塞寒賽，每個字兩句）：
- 全新：一張卡，5 格、4 個字鍵，四個目標都進今天的份；時間上限只夠一張時四個都進，一張也放不下時四個都在 `more`。
- 全部 `good` 後過幾天只有塞到期：1 格、4 個字鍵、對照 4 行，只有塞有結果，換一句。
- 塞、賽到期：併成一張 2 格，不多放。全部到期：多放一句。
- 寨 `near`、塞 `miss`：1 分鐘後只出塞，10 分鐘後寨，各換一句；沒別張時提早出，兩個併成一張。
- 暫停的、ID 重複的、被停掉的字：不出句子，字鍵還在。
- `{deck}`、`{subject}`、`{more}`、`{unit}`、全部卡的一輪都照上面併；`{targets}` 只有一個字時就一格。
- 秒數：作答 40 筆，其中比較卡幾行相差 1 毫秒：中位數不被拉低（預期值用手算的間隔）。一張 4 個目標的 `seconds` 加總等於一張的秒數。

**流程**：§6 表的每一列，加上：連點、填滿後 0.34／0.35 秒的「對答案」、點句子換字、對答案後錯的字鍵變淡、再選也錯、作答中按沒印象又改、全對按太簡單、切走超過 60 秒從頭開始且不寫紀錄、切走不到 60 秒不動。

**回看**：§8。全對改太簡單：N 行 `undo` 加 N 行新的；其中一個目標被停掉：一行都不寫。

**舊題型**：§2 那四個測試檔仍然全部通過（第二步可以新增，不改舊的）。

**檢查**：`npm run check`、`npm run build` 通過；Windows 實機 §10 全部通過，看不到的項目列出來。

## §12 這次不做

- 家長出題時勾選要不要用這個題型：跟著 AI 製卡模組做。程式本身不分科（§3）。
- 組的身分放寬（舊目標括號沒改、新字括號多一個字時，現在是兩組）：預設〈相似字〉標 💡，要用 L8 測，測了再決定改預設還是改程式。
- 製卡規則改成只寫用哪個題型（題型專區第 3 段，跟重整製卡規則一起）。
- 中文朗讀（[D-172](../docs/decisions.md#d-172-國小國語放進-v1) 之後另開一串）：比較卡沒有喇叭。

## 實作者自己選的做法（L2 請先看）

規格沒寫、由 Claude 決定的：

1. 寫錯時跳過而不是退回翻面（§3）。
2. 多放一句的條件放寬到「格數等於字鍵數」（§5-2）。
3. 句子順序也打散（規畫只寫字鍵，§5-3）：免得第一句永遠是第一個字。
4. 打散用指紋算，不用亂數（§5-3）。
5. 同一張卡的判斷靠 200 毫秒，不加欄位（§5-4）。
6. 一張卡的秒數平均分給幾個目標（§5-4）。
7. `pick` 對的也寫（§4）：才分得出「沒有 `pick`」是按沒印象；也才查得到手滑的比例。
8. 預覽的組法（§9）。
