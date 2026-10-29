# `state` 的讀寫先後與寫入協調（給 Claude，本機執行）

狀態：實作完（分支 `claude/hungry-yonath-106fcb`，到 `cd03533` 為止），等 Codex 的 L2（[審查請求](state-writes-review.md)）；合併由使用者決定

遵守 repo 根目錄的 `AGENTS.md`。建議模型與推理等級：**Opus、高**（[D-144](../docs/decisions.md#d-144-決策交給-opus-xhighfable-只在解不了的時候)：設計已在外掛架構討論稿的環節 4 和 Codex 談定，這份是執行）。改的是 `src/state/` 的讀寫先後、學習目標 ID 的安全與寫回筆記的流程，屬於高風險範圍，合併前由 Codex 做 L2（[quality.md](../docs/agents/quality.md)）。

這是 [backlog 技術債](../docs/backlog.md#技術債)「`state` 的讀寫先後與寫入協調」那一列的任務說明。依據是[外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)的環節 4，從〈Codex 回應：環節 4〉讀到〈Claude 回應 Codex：環節 4 第二輪〉；前後有出入時以最後那一節為準。

**為什麼現在**：

- 家長停手一下再按存檔，就可能剛好落在自動存檔後的 500 ms 裡（討論稿的 N1，已重現）：存檔按鈕會變成「有進度連結需要處理」，那個目標暫時不出題。進度不會丟，但這種假警報可能讓家長去按「當成新的」。
- 接下來的 AI 製卡、範圍與目錄、更新防線的第二部分，都要在同一個寫入入口加東西。先把入口做對，它們就不必寫在舊的 `fillText`／`fillIds` 上再改一次。

## 排程與分支

- 分支 `claude/state-writes`，從 `main` 開。用 `git worktree add ../Essence-Cards-state-writes -b claude/state-writes main` 開在旁邊的資料夾，不在原資料夾切換分支。改程式之前先跑一次 `npm run check`，當作基準。
- 順序：這份說明 → Opus 實作 → Codex L2（審查請求 `tasks/state-writes-review.md`）→ 修正、再審 → 合併進 `main`（使用者決定）→ backlog 的「`state/index.ts` 原樣拆檔」。
- **和其他工作的關係**：
  - [更新防線](update-safeguards.md)的第一部分（Node 工具，外掛的行為不變）不碰同樣的程式，可以同時做。第二部分的 §2-2 要在寫入入口拒絕「需要新版」的卡組，會改到同樣的地方，最好等這件合併後再開（它的說明已寫明開工前先看 `src/state/` 改了沒有）。所以這次把門檻收成一個函式（[§3](#3-寫入排成一列)），之後加「需要新版」與 [D-150](../docs/decisions.md#d-150-備份與還原) 第 3 點的「備份沒成功」，都只是多一個原因。
  - 外掛架構檢查的環節 5（Obsidian 接線層）會看 `save.ts`。開工前看討論稿有沒有環節 5 的結論：有的話，關於 `save.ts` 已談定的一起做；沒有就不等。
  - 別的 session 也會改 `docs/backlog.md`、`docs/roadmap.md`：只 stage 自己改的那幾行，不動別人未提交的修改。

## 基準與開工條件

- 基準是這份說明所在的 commit：`git log -1 --format=%h -- tasks/state-writes.md`。開工前跑 `git diff <那個 commit> -- src/state/ src/obsidian/save.ts docs/decisions.md docs/backlog.md "Claude Codex Discussion/2026-10-26-plugin-architecture.md"`；有改以新版為準，並在回報註明。
- 這份說明沒寫到、做了又很難收回的，停下來回報（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)）。

## 必讀範圍

| 讀什麼 | 為什麼 |
|---|---|
| 討論稿環節 4：[〈Codex 回應：環節 4〉](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md#codex-回應環節-42026-10-28>)的第 1、2、3、6 題；[〈Codex 回應：環節 4 第二輪〉](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md#codex-回應環節-4-第二輪2026-10-28>)全部；[〈Claude 回應 Codex：環節 4 第二輪〉](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md#claude-回應-codex環節-4-第二輪2026-10-28opus-55>)全部 | 規則與反例的來源；第二輪第 2 點的表是驗收的一部分 |
| [D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)、[W5 說明 §8-5](w5.md#8-5-弄丟改掉與待處理)、[§8-6](w5.md#8-6-接線存檔按鈕離開筆記鎖住-id) | ID 的安全，以及存檔按鈕、小視窗、離開筆記的備援現在怎麼運作 |
| [state-load 說明 §3](state-load.md#3-id-的安全還有東西沒讀到時不把不知道當成沒用過) | `unread()` 不是空的時候暫停配號，照舊是門檻的一部分 |
| [W5 架構檢查](<../Claude Codex Discussion/2026-10-26-w5-architecture-debt.md>)的 A11、A12 | 這次一起處理 |
| `src/state/index.ts`、`src/state/ids.ts` 全部；`src/obsidian/save.ts`；`src/obsidian/dev-ids.ts` 的 `saveTest`；`src/review/session.ts` 的 `change()`；`src/core/study/plan.ts` 只用今天以前的紀錄那段 | 要改的程式與相關的呼叫端 |
| `tests/state-ids.test.ts`、`tests/state.test.ts`、`tests/review-session.test.ts`、`tests/save-wiring.test.ts`、`tests/helpers/memory-files.ts`、`tests/helpers/obsidian.ts` | 測試怎麼寫 |
| `.agents/skills/code-quality/SKILL.md` 的「測試」一節、[docs/agents/quality.md](../docs/agents/quality.md) | 測試寫法、L2 |

其他文件不用讀。

## 限制

1. **可以修改**：`src/state/index.ts`、`src/state/ids.ts`、`src/obsidian/save.ts`、`src/obsidian/dev-ids.ts`、`src/obsidian/dev.ts`（登錄新的開發命令）、`tests/`、`docs/backlog.md`、`docs/roadmap.md`，以及這份說明的狀態行。`src/main.ts` 只在接線真的需要時改，並在回報寫明。`src/core/` 不改。
2. **不改任何檔案格式**，`docs/syntax.md` 不動，所以不需要開工前的格式查核。
3. **既有測試的預期不改**。`fillText`、`resolveText` 換成新的介面（[§1](#1-介面)），`tests/state-ids.test.ts` 等測試的呼叫方式要跟著改：可以在 `tests/helpers/` 加一個小函式，讓原本一行的呼叫還是一行。斷言的值不改。真的要改某個預期時先停下來，寫明那個測試原本保護什麼，以及為什麼新的規則下結果不一樣。
4. **明確不做**的見 [§10](#10-明確不做)。
5. 測試 vault 的位置在 Claude 的記憶 `test-vault-location`；同一個 iCloud 資料夾裡的其他 vault 一律不動。裝開發版之前，先確認沒有別的 session 正在用這個測試 vault。Obsidian 的畫面用開發命令看，不用 computer-use（quality.md）。

## 1. 介面

```ts
// src/state/index.ts

/** 開著的筆記的編輯器。由 Obsidian 層實作，state 不 import Obsidian。 */
export interface EditorHandle {
  /** 這次寫入的對象。建立時就固定：之後換篇、改名，都照這個路徑處理，不跟著畫面走。 */
  readonly path: string;
  /** 編輯器現在的全文；這個編輯器已經不是 path 那一篇（換篇、改名、關掉）時回傳 null。 */
  text(): string | null;
  /** 一次同步的 Editor 交易，把 before 改成 after（只改有變的部分）；內容已經不是 before 時不改，回傳 false。 */
  apply(before: string, after: string): boolean;
  /** 等編輯器把目前的內容寫進磁碟（TextFileView.save）；寫不進去就 reject。 */
  persist(): Promise<void>;
}

/** Cards 改卡組的結果。 */
export type WriteResult =
  /** 核對讀取確認寫成了。added：這次新配上 ID 的目標數（還原、當成新的不算）。 */
  | { kind: 'done'; added: number }
  /** 沒有要改的（含不是卡組）。 */
  | { kind: 'unchanged' }
  /** 門檻沒過，沒有改字。 */
  | { kind: 'blocked'; reason: 'phone' | 'loading' | 'unread' | 'closed' }
  /** 途中換了篇、內容被改掉、問題已經不成立，或一直有新的變動：沒有採用，要再存一次。 */
  | { kind: 'stale' }
  /** 寫不進磁碟：輸出沒有採用，已配出的 ID 保留、不重用。 */
  | { kind: 'failed'; error: unknown }
  /** 已寫進磁碟，但核對時讀不到：state 自己重試，讀到後照 §4 採用。 */
  | { kind: 'saved' };

export interface StateOptions {
  // …其餘不變
  /** 等一次寫進磁碟（編輯器的 persist、modify）最多多久（毫秒），預設 10_000；超過就當成失敗、放行後面的寫入（§3）。 */
  writeTimeout?: number;
}

export interface State {
  // …其餘不變
  /** 存檔（開著的筆記）：排進寫入的那一列（§3），補 ID、歸位、改縮排，寫進磁碟並核對後才採用（§4）。 */
  save(editor: EditorHandle): Promise<WriteResult>;
  /** 家長在小視窗選了之後：同上；證據不再成立時是 stale，問題保留。 */
  resolve(issue: IdIssue, choice: 'restore' | 'new', editor: EditorHandle): Promise<WriteResult>;
  /**
   * 離開筆記時（沒開著的檔）：排進同一列，在 modify 的回呼裡補。不存在時不建立。
   * done 回傳 true；saved（已寫進檔、核對還沒讀到）也回傳 true，和原本「有改字回傳 true」相同；unchanged、blocked、stale 回傳 false；
   * modify 失敗與 writeTimeout 逾時都 reject（leave() 照舊交給 host.onError）。（2026-10-29 Claude 確認）
   */
  fillIds(path: string): Promise<boolean>;
}
```

- `fillText`、`resolveText` 拿掉；`fillIds` 的簽名不變。名稱與欄位可以調，語義不能改；調了要在回報寫明。
- **A11**：在 `State` 介面的開頭集中寫一段規則：還沒 ready 時，`input`、`today`、`next`、`progress`、`answer` 丟錯，`deckStatus` 回空，`save`、`resolve` 回 `blocked loading`，`fillIds` 回 `false`；`close()` 之後，`save`、`resolve` 回 `blocked closed`，`fillIds` 回 `false`，不再通知監聽者，其他方法照現在。各方法自己的註解不再重複這些。

## 2. 讀取那一側

照〈Codex 回應：環節 4 第二輪〉第 2 點的判斷式與四個邊界：

1. **失效序號**：一個全域遞增的計數；每篇卡組各記一個序號，紀錄不刪。這篇的 Cards I/O 開始與結束（`finally`）都讓它前進；一批讀到的結果裡這篇被刪掉（讀到 `null`），或被改名配對（`tracker.move` 的兩邊），也前進。
2. **正在 I/O 的那一篇不開始讀**：留在 pending；I/O 結束時會立刻讀（§3 第 6 步）。
3. **跨過 I/O 的結果整份不用**：讀之前記下每篇的序號，落地時序號變了，或這篇正在 I/O，那一篇的結果不論是文字、`null` 還是 reject 都不用：不改 tracker、不改 `deckMap`、不進 `unread`，放回 pending 重讀。同一批的其他篇照常處理。
4. **讀取開始後才到的通知留在 pending**，等下一批（現在的 `apply` 先清 pending 再讀，已經是這樣，保持）。

在 §3 的排法之下，正常的流程碰不到第 3 點：寫入一律先等讀取讀完才開始 I/O。仍要做，因為之後的多檔工作與環節 5 的改動可能讓它碰得到。測試不為它另開出口，用 §8 的情境從公開介面驗結果。

## 3. 寫入排成一列

Cards 所有改卡組的動作（`save`、`resolve`、`fillIds`，之後的多檔批次也算一份）排成一列，一次只做一份。排隊時就記下這份工作的對象（路徑、編輯器、問題物件），輪到時才取最新的文字。卡住的寫入只擋後面的寫入，不擋讀檔與複習，也最多擋 `writeTimeout`（見本節最後）。排進這一列的只有寫入那一步：之後 AI 製卡的生成、目錄的計算這些前面的步驟，在排隊之前做完，不佔著這一列。

輪到時依序：

1. **已關閉**：回 `blocked closed`。
2. **先讀完已知的待讀**：只要有一批讀取正在進行，或 pending 裡有不在 `unread` 的路徑（**包括這一篇**），就取消 500 ms 的計時、立刻排一批讀，等它讀完再查一次。最多 5 輪；第 5 輪之後還有新的待讀，回 `stale`，不寫。
3. **門檻**：一個函式 `writable(path)` 回傳「可以」或不行的原因：手機（`fillIds` 選項是 false）→ `phone`；還沒 ready → `loading`；已關閉 → `closed`；`unread()` 不是空的 → `unread`。不是卡組回 `unchanged`。之後要加的原因（D-150 的備份沒成功、更新防線的需要新版、多檔工作的預留還沒載入）都加在這個函式裡，不分散到各個入口。
4. **開始這篇的 I/O**：標成正在 I/O，序號前進（§2 第 1 點）。
5. **取最新的文字、準備、寫**：
   - **編輯器**（`save`、`resolve`）：`editor.text()` 是 `null` 就回 `stale`。照現在的 `fill`／`resolve`，先把這份文字當成新版本比對（觀察到的原文照常採用：更新 `deckMap`、重排），再準備（§4 第 1 點），`editor.apply(before, after)`；回 `false` 就回 `stale`。接著 `await editor.persist()`；**即使這次沒有改字也要 persist**：觀察過的編輯器文字可能比磁碟新，要讓磁碟追上，核對讀取才有依據（Codex 第二輪：no-op 也要核對基準）。從第 2 步的最後一次檢查到 `apply`，中間不能有 `await`。
   - **檔案**（`fillIds`）：`files.modify(path, 回呼)`。回呼拿到的是最新的檔案原文：空字串照舊中止、不建立檔案；在回呼裡重查門檻與第 2 步的條件（**這一篇自己除外**，它最新的內容就是回呼拿到的原文）；有新的待讀就回傳原文不改，modify 結束後回到第 2 步（算一輪）。其餘和編輯器相同：先比對原文，再準備。
6. **結束 I/O**（`finally`，不論結果）：拿掉「正在 I/O」、序號前進，把這篇放進 pending、立刻排一批讀取（不等 500 ms）。然後：
   - **寫成**（`persist` 或 `modify` 成功）：登記這份寫入的核對（§4 第 2 點），往第 7 步。
   - **第 5 步停下**（`text()` 是 `null`、`apply` 回 `false`）：回 `stale`。
   - **`fillIds` 的回呼因為有新的待讀而沒改**：回到第 2 步（算一輪）。
   - **`persist`／`modify` 失敗**：不登記核對，回 `failed`。已配出的 ID 留在 `seen`、不重用；不把 Editor 改回去。這時磁碟可能比第 5 步觀察過的編輯器文字舊，接著的那次讀取可能出現和 N1 一樣的假問題，等下一次存檔成功或 Obsidian 的自動存檔追上後消失。這是保存失敗時的代價，寫在程式註解。
7. **等核對讀取**：結果照 §4 第 3 點。

同一篇連續兩份工作照樣排隊，第二份輪到時重新取最新的文字；連按存檔在 state 這一層就是第二份回 `unchanged`。

**寫入卡住**（`view.save()` 或 `modify` 一直沒回來）：第 5 步最多等 `writeTimeout`（`StateOptions` 新增，預設 10 秒）。超過就當成 `failed`（錯誤寫明逾時），照第 6 步結束 I/O，放行後面的寫入。它之後才完成，也不採用這份工作的輸出、不套用延後的記錄；寫進磁碟的內容會送通知，照一般的讀取處理（配出的 ID 已在 `seen`，不會被當成換了 ID）。代價：還原或當成新的在逾時之後才寫成時，可能多出一個待處理問題，要家長再選一次。

## 4. 準備、核對與採用

1. **準備只預留 ID**（`ids.ts` 的 `fill`、`resolve` 照這個拆）：配出的 ID 立刻記進 `seen`；不採用輸出，不解除待處理，不記 `removed`。拆的時候保留兩件事：「先觀察原文再配號」的順序（`ids.ts` 現在的 `fill`），以及還原時對同一篇其他位置的檢查（`resolve` 裡的 `presentOf(bare, …)`）。`resolve` 的「拿掉那個待處理問題、把被換掉的 ID 記成刻意拿掉、把還原的 ID 記成見過」改成延到採用時才做；在那之前，問題還在，還原的 ID 照舊經由問題的 `restore` 留在 `taken()` 裡。
2. **操作憑據放在排隊的那一份工作上**：路徑、預期的輸出、預期的變更。補 ID 時，預期的變更是每個新配的 ID 和它所在目標的名稱；還原、當成新的時，是那一個目標的名稱和它最後的 ID；還有延後的記錄。
3. **核對讀取**：這篇在第 6 步之後第一次讀到、沒有被 §2 作廢的結果：
   - **讀到的文字和預期的輸出一字不差**：先套用延後的記錄，再當成自己的寫回比對（現在 `commit` 的做法：`detect` 是 false）→ `done`。
   - **不完全一樣，但預期的變更都在**（每個 ID 都在某個目標的行尾，而且那個目標的名稱和預期相同；家長在這段時間又打了別的字）：先套用延後的記錄，把預期的輸出當成自己的寫回比對，再把讀到的文字照一般的重讀比對（家長之後的改動照常偵測）→ `done`。
   - **預期的變更不成立**（交易被過濾、目標被改掉或刪掉）：不套用延後的記錄，照一般的重讀比對 → `stale`。
   - **讀到 `null`**（這篇不見了，或被改名）：照一般的處理 → `stale`；不跟著 A2 的改名配對寫到別篇。
   - **讀不到（reject）**：這篇進 `unread`，工作回 `saved`（這次沒有改字的工作回它原本的結果：存檔 `unchanged`、小視窗 `stale`，不回 `saved`；2026-10-29 Claude 確認，Codex L2 同意）；核對留著，之後第一次讀到時照這一點的同一套規則處理（不重新配號、不重做交易）。這段時間 `unread()` 不是空的，門檻會擋住其他寫入。
   - `added` 是確認寫成的新配 ID 數；只有 `save`、`fillIds` 的補 ID 算。
4. **A12**：小視窗拿到的 `IdIssue` 現在用物件身分認出是哪一個問題。預設**保留**：這次的排隊與等待讀取都不複製問題物件；內容沒變的重讀會原地更新行號、保留同一個物件，內容改過就換一個新物件，舊的不能再寫回（D-134）。在 `IdIssue` 的註解寫明「畫面不能複製這個物件」，並加 §8 的 S26。要改成 token，先在回報寫明理由，連同 W5 F1 的測試一起搬。

## 5. 關閉

`close()`：

- 不再接新的寫入，新的與排隊中的都回 `blocked closed`。
- 正在進行、還沒到第 4 步的：回 `blocked closed`，不改字。
- 已經在 I/O 的（等 `persist` 或 `modify`）：`close()` 等它的結果明確才結束，最多等 `writeTimeout`，停用外掛不會一直卡住；之後不登記核對、不採用、不通知監聽者，工作回 `saved`（寫成了；沒有改字的回它原本的結果，同 §4 第 3 點）或 `failed`（失敗或逾時）。已寫進磁碟的內容，下次載入照實讀回。準備時監聽者同步 `close()`（準備會通知監聽者）算還沒寫：回 `blocked closed`，不改字（Codex L2 的 R2）。
- 其餘照舊：等讀取的那一列與紀錄的 writer。

## 6. 取消舊日作答

`answer({ undo })` 取消的那一筆，時間早於今天的份的開始（`dayStart(current.day, current.offset)`）時，今天的份失效（`current = null`），下一次 `today()`、`next()`、`progress()` 重排。取消今天的作答照舊不重排（[Codex 第 3 題的表](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md#第-3-題m3-要區分資料更新與今天的份失效>)）。現在的畫面就碰得到：複習到 03:59，過了 04:00 回看改評分（`session.ts` 的 `change()` 先取消、再寫新的一筆）。設定、考試範圍的重排不在這次（[§10](#10-明確不做)）。

## 7. 接線與提示（`save.ts`）

- **`EditorHandle`**：從 `MarkdownView` 做。`path` 是按下時的 `view.file.path`；`text()` 在 `view.file?.path` 不再是這個路徑時回傳 `null`，否則回傳 `editor.getValue()`；`apply` 先比對 `editor.getValue()` 是不是 `before`，是才用現在的 `applyText`；`persist` 是 `view.save()`。
- **存檔按鈕與命令**：同一篇的存檔還沒結束時再按，不另外排一份（回傳同一個 Promise）。結果：
  - `done`：`added` 大於 0 時照舊提示 `TIPS.added`。
  - `stale`：提示 `TIPS.stale`（「這篇筆記剛剛改過，請再按一次存檔」）。
  - `failed`：新的提示 `TIPS.failed`：「這篇筆記暫時存不進去，學習目標還沒加入複習；請稍後再按一次存檔」。
  - `unchanged`、`blocked`、`saved`：不提示（和現在一樣，讀不到時 `main.ts` 已有一次「讀不到…會自動重試」）。
  - 之後都 `refresh()`；有待處理的問題就開小視窗（和現在一樣）。
- **等待中不加新的畫面狀態**：正常情況是先讀一次、存一次、再讀一次，都是毫秒級；按鈕在結果回來後才更新。§9 的 V1 量測一般情況的時間；超過 500 ms 就在回報提出，這次不自己加「存檔中」。
- **小視窗**：按下「還原」或「當成新的」到結果回來之前，兩個按鈕停用。`done` 重畫（沒有問題就關掉，和現在一樣）；`failed` 提示 `TIPS.failed` 並關掉；其他結果照現在拿到 `null` 時的做法（提示 `TIPS.stale`、關掉）。
- **離開筆記的備援**：`leave()` 不變（`fillIds` 的簽名不變）。
- **開發命令 `save`**（`saveTest`）：改成等存檔的結果再檢查；檢查的項目與預期不變。

## 8. 測試清單

接著 state-load 的 S1～S9 編號。Node，只透過公開介面；用記憶體 `Files` 與假計時器；`random` 固定為 0 時第一個配出的 ID 是 `aaaaaa`、下一個是 `aaaaab`。每個案例在每個觀察點都斷言「沒有預期以外的待處理問題」，最後斷言 `state.today()` 和 `planToday(state.input())` 相同。

測試替身（`tests/helpers/`，不是產品出口）：

- 記憶體 `Files` 加兩個開關：讓某個路徑的 `read` 停在半路（放行時回傳開始讀時的內容），讓 `modify` 寫完但延遲回傳。
- 一個記憶體的 `EditorHandle`：有自己的文字；`persist` 把文字寫進記憶體 `Files` 並送通知，寫到「這個編輯器現在開著的路徑」（模擬 Obsidian 的 `view.file`，改名後就是新路徑）；可以延遲、可以失敗；可以模擬換篇（`text()` 回傳 `null`）。

| # | 情境 | 必須看到的結果 |
|---|---|---|
| S10 | **M1**：P 沒有 ID；通知 P、推進 501 ms，讀取停在半路；按存檔，再放行（讀到的分別是舊文字、`null`、reject） | 舊文字：存檔等讀取落地才開始，`done`、`added: 1`，過程中沒有 `lost`。`null`：落地後存檔照常補上。reject：存檔回 `blocked unread`、不改字；重試讀到後再存一次就補上 |
| S11 | **M1 的還原版**（Codex 第 1 題）：P 有一個 `lost`、`restore: 'k3m9x2'`；讀取停在半路（無 ID 的舊文字）時選「還原」 | `done`；放行之後與核對之後都沒有再出現 `lost` |
| S12 | **N1**：P 是沒有 ID 的 C；只送通知（磁碟沒變），立刻存檔（編輯器文字也是 C） | `done`、`added: 1`；在存檔前後、推進 501 ms 後都沒有問題；磁碟是補好的文字（`^aaaaaa`） |
| S13 | **H4-1 別篇**（Codex 第 6 題）：ready 時只有 A（一個沒有 ID 的目標）；外部建立 B（含 `^aaaaaa`）並通知，還沒讀；立刻存 A | A 配到 `aaaaab`；之後沒有重複 ID、沒有問題 |
| S14 | **本篇的兩組輸入**（Codex 第二輪第 3 點）：(a) 磁碟是 C 且待讀，編輯器文字是 B `^aaaaaa` 加上沒有 ID 的 C；(b) 磁碟已改成 B `^aaaaaa` 加 C 並通知，編輯器文字仍只有 C | 兩組的 C 都配到 `aaaaab`。(b) 結束時磁碟沒有 B：替身的編輯器不會收到外部的修改，存檔把它蓋掉。實機上這是存檔撞上外部寫入（V6）；在已測的碰撞安排下，Obsidian 自動存檔與 Cards 存檔都可能覆蓋外部內容，本次不另加保護（[討論稿](<../Claude Codex Discussion/2026-10-29-save-external-write.md>)〈實驗 X 的結果與結論〉，2026-10-29）。這個測試只斷言 C 的 ID 和沒有假的問題 |
| S15 | **連續兩份寫入與舊成功回報**（Codex 第 2 題）：`fillIds(P)` 的 modify 寫完但延遲回傳；這時存檔 P（編輯器的文字是 `fillIds` 寫成後的內容再加上目標 B） | 第二份等第一份結束才開始；最後磁碟與 `decks()` 都有 A、B 和各自的 ID；過程中 `decks()` 不會退回只有 A |
| S16 | **寫入失敗**：`persist` reject；另一例 `modify` 失敗（`failModify`） | `failed`（`fillIds` 照舊 reject，2026-10-29 Claude 確認：§1 簽名不變、限制 3 既有測試的預期不改）；`deckStatus(P).missing` 不變；下一次存檔配到 `aaaaab`，不重用 `aaaaaa`；state 沒有改編輯器的文字 |
| S17 | **no-op**：沒有要改的；另一例編輯器文字比磁碟新但沒有要補的 | `unchanged`；兩例都有 persist 與核對讀取，之後磁碟和 state 一致、沒有問題 |
| S18 | **已保存、核對讀不到**：`persist` 成功後讓 P 讀不到 | `saved`；`unread()` 含 P，另一篇的存檔回 `blocked unread`；恢復、推進重試：照核對採用，沒有問題、`onChange` 一次。還原版：延後的記錄在讀到時才套用，不出現被換掉的 ID 造成的 `lost` |
| S19 | **等待中換篇、改名、刪除後重建**：(a) 輪到時編輯器已換篇；(b) `persist` 延遲時把 P 改名成 Q；(c) 再建一個內容不同的新 P | (a) `stale`，沒有交易、沒有 persist。(b) 結果不是 `done`；Q 照一般讀取處理，沒有問題。(c) 新的 P 沒有被 Cards 寫入；舊的工作不會把 ID 寫到新的 P |
| S20 | **讀取不能跨過 I/O**：`persist` 延遲時通知 P、推進 501 ms | 延遲期間沒有讀 P（看記憶體 `Files` 的 `reads`）；放行後讀 P 一次，結果正確 |
| S21 | **門檻在輪到時重查**：第一份延遲時，另一篇讀不到 | 第二份輪到時回 `blocked unread`，不改字 |
| S22 | **一直有新的待讀**：包一層 `Files`，每讀一次 P 就再通知一次 P | 存檔在第 5 輪後回 `stale`，不會一直等下去 |
| S23 | **連按**：同一個編輯器連續兩次 `save`，第一次還沒結束 | 第一份 `done`、第二份 `unchanged`；只配一組 ID |
| S24 | **關閉**：(a) 排隊中；(b) `persist` 延遲中；(c) 還沒 ready 與關閉後呼叫 | (a) `blocked closed`、沒改字。(b) `close()` 在 persist 結束前不完成；之後沒有 `onChange`、沒有採用；用同一個記憶體 `Files` 建新的 state，讀到寫進去的 ID。(c) 照 §1 的 A11 規則 |
| S25 | **跨 04:00 回看改評分**（Codex 第二輪的重現）：用真正的 `createSession` 接 `createState`；03:59:00.301 答「沒印象」，04:01 取今天的份，再回看改成「記得」 | `today()` 和 `planToday(input())` 相同，那個目標的記憶是 `null`。對照：同一天的取消不重排（`today()` 回傳同一個物件） |
| S26 | **A12**：小視窗拿到問題物件後，P 被重讀一次但內容沒變；另一例名稱改了 | 內容沒變：用同一個物件還原，`done`。名稱改了：`stale`，問題保留 |
| S27 | **接線**（`tests/save-wiring.test.ts`，Obsidian 替身的 view 加 `save()`）：`EditorHandle` 的 `text()` 在換篇後回傳 `null`、`apply` 在內容不同時回傳 `false`、`persist` 呼叫 `view.save()`；按鈕連按只排一份 | 如左 |
| S28 | **寫入卡住**：`persist` 一直不回來，後面排著另一篇的存檔；另一例在卡住時 `close()` | 推進 `writeTimeout` 後第一份回 `failed`，另一篇的存檔接著做完、`done`；之後 `persist` 才完成，第一份的輸出不採用、不呼叫監聽者，磁碟的新內容照一般讀取處理、沒有假的 `lost`。`close()` 在逾時後完成 |

**既有測試**全部照舊通過（限制第 3 點）。

**commit 的切法**（一個 commit 一個決定）：① 測試替身；② 取消舊日作答（S25）；③ 讀取那一側（§2）；④ 寫入排成一列、先讀完待讀、門檻（§3，先接 `fillIds`）；⑤ 準備只預留、核對與採用（§4，`ids.ts` 拆開）；⑥ 編輯器的寫入：`save`、`resolve` 取代 `fillText`、`resolveText`，`save.ts` 與小視窗；⑦ 關閉與寫入卡住（§5、§3 最後一段）；⑧ A11 的註解與 A12 的測試；⑨ 開發命令與 Windows 實測。分不開的可以合併，在回報寫明原因。每個 commit 都要 `npm run check` 通過。

## 9. Windows 版 Obsidian（AI 自己做）

用測試 vault 的開發版（`npm run install-vault -- <測試 vault> --dev`；更新防線第一部分若已合併，照它改過的用法）。新增開發命令 `save-flow`（「Essence 開發：存檔流程」），每個情境用一篇新的、沒有 ID 的卡組。每一步記下四樣：磁碟的文字（`Files.read`）、編輯器的文字、`deckStatus`，以及這段時間的 vault 事件（沿用 `events` 的記錄）；在存檔的 Promise 完成前、後各記一次。

| # | 情境 | 預期 |
|---|---|---|
| V1 | 一般的存檔 | `persist` 完成時磁碟已經是編輯器的內容；提示一次；記下按下到結果回來的時間（§7） |
| V2 | **N1**：打一個字，等到這篇的 `modify` 事件（自動存檔）後 100 ms 內按存檔；之後 3 秒每 50 ms 看一次 `deckStatus` | 從頭到尾沒有 `lost` |
| V3 | 同一個 tick 連按兩次 | 只配一組 ID、只提示一次 |
| V4 | 兩個分頁開同一篇，在其中一個按存檔 | 兩個編輯器與磁碟最後都相同 |
| V5 | 按下後同一個 tick 讓這個分頁換篇；另一次按下後立刻改名 | 換篇：提示「剛剛改過」，另一篇沒有被改。改名：沒有別的檔案被改，沒有問題。2026-10-29 Windows：改名照預期；換篇那次存檔搶在換篇之前做完，原本那篇照常配 ID、提示「已加入複習」，另一篇沒有被改，「剛剛改過」那條路只有 Node 的 S27 驗到。L2 判斷：先做完是合法的時序，安全性證據可以接受；Windows 上「存檔排隊時換篇」仍未驗，記進 backlog（[L2 報告](<../Claude Codex Discussion/2026-10-29-state-writes-review.md>)「請特別看」第 9 點） |
| V6 | 外部用 `vault.adapter.write` 把 B（含 ID）加進開著的這一篇，同一個 tick、50 ms 後、200 ms 後各按一次存檔 | 記下磁碟最後有沒有 B、編輯器有沒有收到 B。**B 被蓋掉時停下來回報**，這次不設計修法。2026-10-29 同一個 tick 那次蓋掉，已停下來回報；接著的實驗 X 顯示，在已測的碰撞安排下 Obsidian 自動存檔與 Cards 存檔都會覆蓋外部內容。本次未另加保護，因為還沒找到收益足夠、成本合理的做法，實際的風險增量沒有量測（[討論稿](<../Claude Codex Discussion/2026-10-29-save-external-write.md>)〈實驗 X 的結果與結論〉） |
| V7 | 保存失敗：試著讓檔案暫時唯讀 | 提示 `TIPS.failed`；檔案恢復可寫之後再存一次就補上。做不出 `view.save()` 失敗時寫明「Windows 做不出這個情境」，保留 Node 的測試，不硬湊 |

**如果 `persist` 完成時磁碟還不是編輯器的內容**（`view.save()` 沒有等寫完），停下來回報：§3 第 6 步的核對會因此回 `stale`，要另外想辦法。

另外重跑 `save`、`lock`、`a3check`，結果和上一次相同（`a3check` 的每個情境都要 `ok`）。

這件不需要 iPhone：iPhone 不寫卡組，「正在 I/O」永遠是空的；取消舊日作答用 S25 的 `createSession` 驗。

## 10. 明確不做

照討論稿環節 4 的施工順序，以下各自有 backlog 技術債的一列：

- `state/index.ts` 原樣拆檔（結論第 8 條，這件合併後另外做）。
- 多檔寫入、跨重啟的 ID 預留（第 5 條，第一個多檔寫入時）。
- 設定與考試範圍改了要重排今天的份、一次 `input()` 固定時間與資料（第 6 條其餘部分，隨範圍與目錄模組）。
- 狀態變更的紀錄 `set: status`（第 7 條，隨目錄的管理模式）。
- 不碰 A2 的改名配對（照環節 1 的結論），不加快取，不加套件，不做通用的鎖或交易框架。
- 不加「存檔中」的畫面狀態（§7）。

這件是環節 4 已談定的結論與 D-134 的落實，寫在這份說明與 backlog 就好，不另立 D-ID。

## 自我測試

1. `npm run check` 全過（pre-commit hook 也會跑）。
2. 照 code-quality 的 L1，逐條對照「限制」、§1～§9，以及〈Codex 回應：環節 4 第二輪〉第 2 點的表。
3. §9 的 Windows 實測做過一次，結果寫進回報。

## 完成後

- `docs/backlog.md` 技術債：刪掉「`state` 的讀寫先後與寫入協調」那一列；「`state/index.ts` 原樣拆檔」的觸發點已到，那一列不用改。
- [更新防線](update-safeguards.md) §2-2 提到的 `fillText`、`resolveText` 改成新的名字（只改名字，不改內容）。
- `docs/roadmap.md` 的「現在在哪裡」與「已完成」各加一句（分支、commit、測試數）。
- 寫審查請求 `tasks/state-writes-review.md`，格式照 [`tasks/state-load-review.md`](state-load-review.md)。請 Codex 特別看：
  - 所有改卡組的入口是不是都經過同一列與同一個門檻，有沒有漏掉的路徑；
  - 從第 2 步的最後一次檢查到 `apply` 之間有沒有 `await`；
  - 核對讀取的三種結果，以及延後的記錄是不是只在預期成立時才套用；
  - 讀到 `null`、讀不到、改名時，舊的工作會不會寫到別篇；
  - 關閉之後、寫入逾時之後，有沒有殘留的採用、通知與讀取；
  - `ids.ts` 拆開後，「先觀察原文再配號」與還原時的同篇檢查還在不在；
  - 既有測試的預期有沒有被改。
- 回報：commit 清單、`npm run check` 的測試數、§9 的結果、有沒有停下來的點。合併由使用者決定。
