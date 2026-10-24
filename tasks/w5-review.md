# W5 第一部分：L2 獨立審查（給 Codex）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（檔案通知、自己寫的紀錄、換日與換時區互相牽動；解析器的改動要用新的寫法找反例）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)，[W5 任務說明](w5.md)第一部分（§0～§7）由 Claude 實作。這一批併入複習紀錄、改了卡組解析，屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

第二部分（§8 補 ID 與 ID 的保護）還沒開始，不在這次範圍。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-w5`，分支 `claude/w5`，沒有未提交的修改。
- 共同祖先（＝基準，也是任務說明寫好的 commit）：`babfb3a9eef7e45657061a31ee2e398991c3c498`（`main`）。
- 待審 commit（由舊到新）：
  - `0dca7f9b35f1c6c19532921b2deb3de4b4576e82`：§0-1 F6，建置測試不再綁死骨架
  - `0f4a9d73c2b3fa505510b46d18506b27d3d5298b`：§0-2 Node 版 `Files.watch` 在 Windows 刪除中的資料夾回 EPERM
  - `ff7c030b98fe729621443386b8a9353c581663c6`：開發版建置、§0-3 metadataCache 對照，以及照 Obsidian 改的兩種解析
  - `531bb5270c2de00106ddd7d926d2a112191ab4ee`：對照結案（剩下的出入都照 D-135）
  - `384885912e6ef4a8a2043310eedc50a63fecec40`：§2 Obsidian 版檔案存取與共用的契約檢查
  - `175e78246ea333c0ece48e36d05f1b35033de98f`：§3 外掛的資料狀態（`src/state/`）、`appendLine`
  - `5a7f5fb4520d7b9651b01f4a4abe7e3ea190bc0a`：§4 外掛接線與開發命令
  - `b7f0e0697acd00831e701cf301ed5d1e186eebdd`：§5-1 `npm run bench -- --vault` 與 state 的作答量測
- 用 `git diff babfb3a claude/w5` 看全部差異（35 個檔案）。各 commit 的訊息寫了那一步的做法。

## 規格與優先順序

- 主要規格：`main` 上的 [tasks/w5.md](w5.md) §0～§7，以及它的「必讀範圍」。基準之後 `main` 有三處相關的改動，以 `main` 的新版為準：
  - [D-135](../docs/decisions.md#d-135-清單解析和-obsidian-對照後的處理)（§0-3 對照的結果，使用者同意）與 [syntax.md §2-2、§2-3](../docs/syntax.md#2-2-兩條規則) 的對應句子。
  - w5.md〈完成後（第一部分）〉加了要你看的解析器改動（下面「請特別看」第 5 點）。
  - w5.md §8 加了縮排改正，是第二部分的事，這次不看。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## 請特別看

1. **`appendLine` 和 `mergeHistory` 一致**（§3-4、T5）：`src/core/study/history.ts`。
2. **檔案變動與自己寫的紀錄不會漏、也不會重複**（§3-1～§3-4）：先監看再讀、讀的期間收到的通知、`delay` 內合併、自己的紀錄不理、衝突副本、刪除。`src/state/index.ts`。
3. **換日與換時區**（§3-5、T10，Codex 審查 W4 的 F3）。
4. **第一部分沒有任何寫入卡組筆記的路徑**。Claude 查過：開發命令以外，只有 `state` 透過 W3 的 `createLogWriter` 追加 `Essence Cards/紀錄/`；開發命令只寫 `Essence W5/`。請獨立確認。
5. **第 0 步照 D-135 改的解析器**（`ff7c030` 的 `src/core/deck/markdown.ts`、`parse.ts`）：頂格延續行的判斷，以及會打斷段落的標題與分隔線；未閉合的屬性區改成照樣出題並提示；`src/dev/compare.ts` 照 D-135 的處理；比規格嚴的一處：寫錯的目標也比 (b)、(c)。

## Claude 自己選了做法的地方（請逐點回覆）

第 0 步與 §2：

1. **`Files.watch` 的 EPERM**：Node 版回呼裡列資料夾失敗時，保留上一次的清單，等下一次通知再比對；測試的 fixture 改成先停止監看再刪資料夾。
2. **Obsidian 版擋掉任何一段是 `..` 的路徑**（也擋 `\`、`C:` 開頭），比 Node 版嚴。同一個路徑的排隊用 NFC＋小寫當鍵：大小寫不同的兩個路徑會多排一次隊，不會互相蓋掉。
3. **C6**（`edit` 回傳原文時不寫入）在 Obsidian 驗的方式：等通知的時間內沒有收到這個路徑；另外確認監看本身有效，免得「沒收到」是因為監看沒開。

§3 外掛的資料狀態：

4. **「內容沒有變」對卡組的意思是解析結果相同**（`JSON.stringify(parseDeck(...))` 相同），不是文字相同。只改家長筆記段落、但行號沒變的修改不會重排；行號變了就會重排。紀錄檔才是比文字。
5. **讀檔失敗**：那幾個路徑放回待處理、交給 `onError`，**不自己重試**，等下一次通知才再讀。
6. **自己的紀錄**是檔名剛好等於 `YYYY-MM <device>.jsonl` 的檔；`… 2.jsonl` 之類的衝突副本算別台裝置。自己的檔被外部改掉或刪掉，`state` 都不理，記憶中的來源和 `history` 照舊。
7. **`ready()` 失敗不重試**：之後每次呼叫回傳同一個 rejected Promise；監看仍開著，`close()` 才停。
8. **`appendLine` 的取消**：拿掉 `t` 相同的**所有**作答（`mergeHistory` 也是取消所有檔案裡 `t` 相同的）。作答與變更用二分搜尋插在同一個 `at` 的最後面。
9. **`answer` 寫進記憶中的來源**用 `logPath(device, at, offset)`，`at` 與 `offset` 從 `t` 解析回來，和 writer 寫檔的路徑相同（跨月的 T7 有測）。writer 寫檔失敗時，記憶中已經有這一行；失敗的行留在 W3 writer 的佇列，**下一次作答或 `flush`（例如切到背景）才重試，沒有計時重試**。提示文字的「會自動再試」靠的就是這個。

§4 外掛接線：

10. **裝置碼在 `onload` 就從 localStorage 讀**（不是檔案）；檔案存取在 `onLayoutReady` 之後才第一次被呼叫。開發版用 `countFiles` 包一層計數，結果檔的 `filesCallsBeforeLayoutReady` 是證據；正式版不包。
11. **`onError` 一律提示「複習紀錄暫時寫不進去，會自動再試」**（規格的文字），包括讀別台裝置的紀錄失敗、`onChange` 的監聽者丟錯；同一次載入只提示一次。
12. **外掛在 layout ready 之前就被停用時不建立 `state`**（`onLayoutReady` 的回呼不會跟著停用取消）。規格沒寫。
13. **開發命令 `answer`** 用 `Essence Cards/W5 範例/` 路徑排第一的卡組的第一個目標；這個目標沒有 ID 或題目時直接報錯，不往後找。`watch` 每 250 ms 看一次 `reviews` 的長度，另外記 `onChange`。
14. **正式版不含開發程式的檢查**：除了原本的字串記號（URI 記號改成帶引號的 `"essence-cards-dev"`，因為裝置碼的鍵 `essence-cards-device` 會誤中），另加一個測試，用 esbuild 的 metafile 確認正式版沒有 `src/dev/` 與 `src/obsidian/dev.ts` 的任何 bytes。這個測試照抄了 `tools/build.mjs` 的建置選項，兩邊可能分歧。

§5 量測：

15. **`--vault` 先刪掉 `<vault>/Essence W5/量測/` 再寫**（只有 bench 寫那裡）。Node 的 `ready()` 與 Obsidian 的 `open` 都用真的現在時間，所以每天量到的今天的份不同。
16. **state 的作答量測**（21 次中位數，門檻 20 ms）：每一次先挑還有卡的科目（都做完就用「再複習一些」），只計 `answer`＋`next`＋`progress` 的同步部分，寫檔在背景不計。
17. **Windows 的 `open` 是 Obsidian 開著量的**（使用者的 Obsidian 可能在用，照規格不關），沒有量到真正的冷啟動；前兩次差很多，所以多量了 3 次。

## 行為與風險

- 公開介面：`src/core/deck/index.ts` 加的 `isDeckPath`、`readDecks`；`src/core/study/index.ts` 加的 `isLogPath`、`appendLine`（`readHistory` 改用 `isLogPath`，行為不變）；`src/state/index.ts` 的 `createState` 與型別；`src/obsidian/files.ts` 的 `createObsidianFiles`。W6 的畫面只會透過 `state` 拿資料。
- 不可破壞的性質：
  - 依序 `appendLine` 自己的行，和把這些行加進來源後重新 `mergeHistory` 相同（只有不同檔案、`at` 相同的兩筆之間的先後可以不同）。
  - 讀的期間與 `delay` 內的通知都不漏；同一個路徑只讀一次，全部處理完只排一次、只呼叫一次 `onChange`。
  - 作答後不讀紀錄檔、不重排、不呼叫 `onChange`。
  - `today`、`next`、`progress` 永遠用目前的日子與時區排出的份；`next` 不回傳 `stale`。
  - 不寫卡組筆記；iPhone 只寫 `Essence Cards/紀錄/` 與開發版的 `Essence W5/`。
  - W3、W4 已有函式的行為不變（解析器的兩處改動除外，照 D-135）。
- 測試：`tests/state.test.ts`（T6～T10，另加讀取期間的通知）、`tests/append-line.test.ts`（T5，含 200 組性質測試）、`tests/files-contract.test.ts`（C1～C14，含故意弄壞的實作）、`tests/dev-compare.test.ts`、`tests/dev-wrap-files.test.ts`、`tests/build.test.ts`、`tests/deck.test.ts`（解析器的新例子）、`tests/node-files.test.ts`。Claude 在 §3 故意弄壞過 7 處（去抖、讀取期間的通知、內容沒變的比較等），§4 弄壞過 3 條模組邊界與「計數包裝進到正式版」，都有測試擋下；這些弄壞的版本沒留在 repo。
- 請自己找新的組合，例如：
  - 自己剛作答的 `t`，又出現在後來同步進來的衝突副本裡，接著取消它；或先收到別台裝置的檔、再在 `delay` 內作答。
  - `onChange` 的監聽者裡呼叫 `answer` 或 `today`；`close()` 之後才到的通知；`ready()` 還沒完成就 `close()`。
  - 清晨 4 點剛好落在 `delay` 等待中；換時區剛好跨月（`answer` 寫到哪個月的檔）。
  - `Essence Cards/紀錄` 整個資料夾改名或刪掉；`Essence Cards/紀錄.md` 這種和系統資料夾同名的筆記；卡組改名成系統資料夾裡的路徑。
  - `set` 的值是物件、欄位順序不同的兩行；同一行 `appendLine` 在 `undo` 前後各一次。
  - 解析器：頂格延續行後面接引言框、程式碼圍欄、標題（`#` 在不同縮排）、`***`／`___`／`- - -` 分隔線、空行；只有開頭 `---` 的筆記裡還有 `...`。

## 驗證方式

- Node 24 以上。在 worktree 裡：`npm install`、`npm run check`、`npm run build`（`main.js` 只能 require `obsidian`）、`npm run bench`。
- Claude 跑過：
  - `npm run check` 全部通過（250 個測試）。
  - `npm run build`：`main.js` 140,698 bytes、只 require `obsidian`（W4 是 663 bytes，那時 `main.ts` 還沒用到核心；現在含核心、`yaml`、`ts-fsrs` 與 `state`）。
  - `npm run bench` 結束碼 0：`mergeHistory`＋`replay` 中位數約 449 ms（門檻 500）、`planToday` 約 155 ms（300）、`nextCard`＋`progress` 0.09 ms（20）、state 的 `answer`＋`next`＋`progress` 1.9～2.2 ms（20）。`--vault` 寫進測試 vault 後，Node 的 `ready()` 是 decks 67、history 902、plan 262 ms。
  - 故意讓 `src/state/` import `obsidian`、`src/dev/` import `node:fs`、`src/core/` import `src/state/`：lint 都失敗，已還原。
- Windows 版 Obsidian 1.14.5（開發版，結果檔在測試 vault 的 `Essence W5/結果/`；測試 vault 的位置不寫進 repo，要看時問使用者）：
  - `files`：C1～C14 14／14（`files Windows-c50c 2026-10-24 220818.json`）。
  - `compare`：166 個例子，剩下 16 個出入都屬於 D-135（`compare Windows-c50c 2026-10-24 190401.json`）。
  - T12：`onLayoutReady` 之前檔案存取呼叫 0 次、`onload` 0.3 ms；裝置碼 `Windows-c50c` 在重新載入後相同，外掛資料夾沒有 `data.json`；`answer` 讀回和寫的相同、取消後今天的份不變；`watch` 期間追加假裝置 `Test-0000` 的一行，約 0.3 秒後 `onChange` 一次、`reviews` 0 → 1，刪掉後 `today` 和之前相同（`today … 224310`、`answer … 224314`、`watch … 224431`、`today … 224449`、`today … 224458`）。
  - `open`（三年份）的 `history + plan`：742、1,887、1,599、1,436、1,689 ms（`open … 231755` 到 `232001`）。iPhone 的門檻（I1，1 秒）在 W6 的 iPhone 測試判斷，不是這次的完成條件；電腦已經多半超過，記在 [backlog](../docs/backlog.md#技術債)。
- 沒跑：iPhone 實機（§5-2，併進 W6）。你不需要操作 Obsidian；要在 Obsidian 重現時，只用測試 vault 的 `Essence W5/`。

## 回報

寫在主資料夾的 `Claude Codex Discussion/2026-10-24-w5-review.md`（不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 「請特別看」的 5 點逐點寫結論；「Claude 自己選了做法的地方」的 17 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。
