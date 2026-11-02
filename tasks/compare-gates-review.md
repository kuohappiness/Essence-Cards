# 發布前比較的轉接器接上讀取閘門：L2 獨立審查（給 Codex）

狀態：待第四次審查（第一輪審 `fb823eb`，F1 修在 `a04998e`、`f33f376`；再審審 `f33f376`，F2 修在 `2c225bb`；第三次審 `2c225bb`，F4 修在 `3b40b2e`，F3 修在 `dd10eae`、`1d73cb2`；[報告](<../Claude Codex Discussion/2026-11-02-compare-gates-review.md>)；見文末〈第四次審查〉）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（跨 `tools/compare/`、`src/state/`、`src/core/study/`；這個工具的結論決定正式 vault 要不要裝，報成零差異就是漏掉）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)，由 Claude（Opus 5.5）實作，合併前請你做獨立審查（[quality.md](../docs/agents/quality.md#高風險範圍要做-l2)）。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。報告寫在 `Claude Codex Discussion/2026-11-02-compare-gates-review.md`。

## 審查對象

- **工作目錄**：`D:\程式開發\Essence Cards\.claude\worktrees\loving-bohr-b7fa09`（git worktree），分支 `claude/fervent-hodgkin-9c2bca`，沒有 push（本機的分支，各 worktree 共用）。**不是**主資料夾（那裡是 `main`，沒有這些 commit）。沒有未提交的修改。
- 基準：`main` 的 `fc91fe73a442d86dbb09ffb469cda5a31ef8651f`。
- 待審：`fb823ebd59afb5fbbf8e92ff7bb56aae0468f3e0`（一個 commit）。之後的 commit 只加這份請求與 roadmap 的狀態，不用審。
- 範圍：`git diff fc91fe7 fb823eb`：`tools/compare/adapter.ts`（幾乎重寫）、`tools/compare/snapshot.ts`、`tools/compare-versions.ts`、`tests/compare-versions.test.ts`、`.github/workflows/check.yml`；`src/core/study/plan.ts`、`types.ts` 只改註解。

## 規格與優先順序

- 主要規格：[backlog 技術債](../docs/backlog.md#技術債)〈發布前比較的轉接器沒有讀取閘門〉那一列的完成條件，逐句對照。
- 來源：[更新防線第二部分 L2](<../Claude Codex Discussion/2026-10-29-update-safeguards-2-review.md>) 第 7 點；[外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)〈環節 3 的結論〉第 4 條（S4）與 Codex〈第 4 題〉的實測表。
- 決定：[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 3、5 點；[D-157](../docs/decisions.md#d-157-重複的學習目標-id先停家長選)。格式：[syntax §0-1](../docs/syntax.md#0-1-最低版本標記)、[§2-1](../docs/syntax.md#2-1-屬性)、[§5-2](../docs/syntax.md#5-2-讀不懂的行)。原本的設計：[更新防線任務說明](update-safeguards.md) 1-3。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## 行為與風險

- 公開介面：`npm run compare-versions -- <備份檔> <舊 commit> <新 commit>`、`compareVersions`（`update-vault --check` 呼叫）、`snapshot`、`diffSnapshots`、`gateLines`。
- 不可破壞的性質：
  - 比較不寫任何東西到輸入，也碰不到 vault（輸入是備份解開的文字）。
  - **不能把看不懂、比不了、舊版沒有的判斷報成零差異。** 接不上是「無法比較」，舊版沒有的能力要寫明。
  - 兩邊用各自的讀取版本；到期與今天的份和那一版的 state 相同。
  - 舊版不跑新版的 D-157：`v0.2.0` 照路徑第一篇的出，現在是都不出。這種輸入報出今天的份不同是預期的差異。
- 已知邊界（都有測試）：跨篇重複的 ID、需要新版的卡組與讀得懂的卡組同一個 ID、紀錄行停掉的目標、整份紀錄不完整、同一份標記新版讀得懂舊版讀不懂（讀得懂之後才看得到的重複 ID）、版號不是正式版號、state 沒有閘門、沒有 `releaseOf`、state 一直不回來。例子只是起點，請找新的組合。
- 明確不做：`update-vault --check` 的主控台摘要不印閘門（報告裡有）；考試範圍（`exam`）照舊是 null，報告的限制有寫。

## 驗證方式

- Windows、Node `v24.13.0`。`npm run check` 在 `fb823eb` 全過（pre-commit 跑的）。**完整的 `npm run check` 要在沙箱外跑**（[quality.md](../docs/agents/quality.md#檢查指令)）；沙箱裡會有環境造成的固定失敗，逐項列出。
- 只跑這個工具的測試：`node --test tests/compare-versions.test.ts`（11 項，約 14 秒；要讀得到 tag `v0.2.0`）。
- 改壞測試（`tools/compare/` 與 `compare-versions.ts` 共 12 處）：11 處有斷言失敗；拿掉超時那一處測試會一直等、被外面砍掉，也算抓到。
- 實際跑過一次：用正式使用的 vault 的備份比 `v0.2.0 → fb823eb`，差異 0 項（那份備份沒有卡組，只有兩個紀錄檔，所以這次沒有驗到非空的正式資料）；報告不進 repo（D-003）。
- 沒有跑：CI（沒有 push，`fetch-depth: 0` 的改動沒有實際在 GitHub Actions 跑過）；`update-vault --check` 走到新的轉接器（它的測試用替身換掉 `compareVersions`）；`v0.1.0` 當舊版。

## 實作者自己選的做法（請先看）

1. **每一版都用它自己的 `createState`，轉接器不寫規則。** Codex〈第 4 題〉留了兩個選項：「抽共用的唯讀準備步驟」與「state 明確支援只讀能力」。兩個都要改被比較的版本，部署中的 `v0.2.0` 已經凍結、改不了，舊版那邊還是得在轉接器重寫一份 state 的規則，之後 state 一改就默默分岔。代價：state 是給外掛長期跑的，拿來跑一次就關。
2. **版本行：Files 拒絕寫入，不是吃掉。** `build` 傳那一版 manifest 的版號（不含 commit），讀取能力就對了；state 載入時會排一行版本行，`append` 拒絕，那一行寫不出去；`close()` 重試時也拒絕，轉接器接住。沒有注入假的版本行，也沒有吃掉寫入（backlog 那一列禁止的兩種）。那一行還是進了 state 記憶裡的 `history.changes`，比較資料不讀它；`planToday` 也不讀（`src/core/study/plan.ts`）。請看這有沒有別的影響。
3. **版本行以外的寫入**：看到就是無法比較。**限制**：紀錄照順序寫，第一行被拒絕後，排在後面的不會送到 Files，所以只看得到排最前面的與 `modify`（`tools/compare/adapter.ts` 的註解有寫）。不管怎樣都寫不出去；漏掉的是「這一版載入時不只讀」的偵測，影響是記憶裡多了那一行卻沒報。
4. **到期的語意**：`due` 仍是整份紀錄（含今天）的下次到期，只有 `state.canAnswer` 是 false 的（讀不懂的行、整份不完整、需要新版、D-157）記成 `'stopped'`。`planToday` 內部用「今天以前」的記憶，兩者本來就不同。暫停與草稿的目標仍算到期（不是閘門，而且它們的 FSRS 改變也該被看到）。請判斷這算不算完成條件的「到期和那一版的 state 相同」。
5. **需要新版的卡組內容不進 `decks`**：那一版讀不懂，不假裝讀懂；diff 只報「需要新版才讀得懂 → 讀得懂」，兩邊都讀不懂就沒有差異。`due` 裡也沒有它的目標（別篇同一個 ID 的是 `'stopped'`）。
6. **`conflicts` 是 null 或陣列**：有 `state.conflicts` 才呼叫。null 對空陣列不算差異，但報告〈讀取閘門〉兩邊都列（「這一版沒有這個判斷」／「沒有」），找到的一律報。同一個 ID 兩邊都有衝突、目標相同時，diff 不報（只在報告的閘門看得到）。
7. **超時**：每一邊 5 分鐘（`CompareOptions.timeout`），超過是「無法比較」；因為 state 列不出檔案時會一直重試，記憶體的 Files 不會，但被比較的版本可能會。worktree 的 `rm` 加 `maxRetries`，因為被砍的程序在 Windows 可能還沒放開檔案。
8. **測試讀真正的 `v0.2.0`**：clone 到暫存資料夾（不動 repo 的 worktree 清單）、`node_modules` 連回現在的。沒有 tag 就失敗不跳過，所以 CI 改成 `fetch-depth: 0`。代價：之後相依套件改版，舊版可能和新的 `node_modules` 不合；基線換版時這個測試跟著換 tag。
9. **`unread` 有內容就無法比較**：記憶體的 Files 讀不會失敗，這道沒有測試（要讓它觸發得改被比較的版本）。

## 請特別看

1. 完成條件逐句對照，有沒有只做一半的。
2. 有沒有輸入會讓新的比較資料和那一版 state 真正的 `today()` 不同：這是直接取 `state.today()` 的，但 `nextCard` 拿到的 today 是改過的（只放一張），`due` 與 `days` 是另算的。
3. 有沒有情況報成零差異或看起來可比，其實沒比到：兩邊都讀不懂的卡組、`null` 對空陣列、同一個 ID 同時停在好幾個閘門、`held` 裡的 ID 不在任何卡組（`due` 沒有它，閘門列得到）。
4. 用 state 跑一次就關，有沒有留下計時器或沒接住的拒絕，讓程序不結束或崩潰（`tools/compare-versions.ts` 看 exit code 與輸出檔）。
5. 測試擋不擋得住回歸；預期值是不是獨立來源。

## 回報

每項發現寫觸發條件、預期／實際、影響、位置與證據，並區分「已重現」「靜態推斷」「待驗證」。可以回報「規格本身有漏洞」。標題下第一行寫狀態。

## 再審（F1 之後，2026-11-02）

聚焦再審這段修正與相鄰案例，不必整包重審（[review.md](../.claude/skills/code-quality/review.md)〈修正後收尾〉）。報告接在[同一份報告](<../Claude Codex Discussion/2026-11-02-compare-gates-review.md>)最後，標題「Codex 再審」；先看那裡的〈Claude 回應 Codex L2〉。其他規定照上面。

- **對象**：同一個工作目錄與分支。基準 `c8b293e1bb6473a4cae90d6b20da60cafb47ed5e`；待審 `f33f37694fc22d8c99d36bb8261e08bc7ef2b314`。範圍 `git diff c8b293e f33f376`：`a04998e`（F1）、`f33f376`（報告的措辭）。之後的 commit 只改文件。
- **完成條件**：回傳型別不同的版本不會產生成功的快照；真正的 `v0.1.0`、`v0.2.0` 與現在的版本不會被誤擋。

### 實作者自己選的做法

1. **不只修 `canAnswer`**：拿來判斷或算數、型別錯了不會自己丟錯的都查：`canAnswer`、`unread`、`blocked().all`、`dueAt`、`dayOf`、今天的份的 slot 與 `retention`、`nextCard` 的 `kind`、`releaseOf`。
2. **沒查的（請看有沒有漏）**：
   - 型別不對時展開或 `.map` 會自己丟錯：`blocked().decks`、`targets`，`decks()`，`history().reviews`，`today().share`、`more`，`conflicts()`。
   - `ready()` 的回傳值不用。
   - `input()` 回傳 Promise 時，`settings.retention` 與 `nextCard` 要用到才會丟錯；沒有作答、也沒有今天的份時不丟，但那時也沒有東西用到它。
   - 卡組的欄位（`props`、目標的欄位、`problems`）與 slot 的 `direction`：一邊改了名，比的時候就是差異。兩邊都改名時比不到，但在那之前的發布會先報一次差異。
3. **`nextCard` 只接受 `card` 與 `done`**：`stale` 當成接不上，因為比較時時間是固定的。今天已經答對的是 `done`，有測試。
4. **`releaseOf` 回傳的不是字串**：和版號不是正式版號同一個訊息（「讀取能力不明」），不另外分。
5. **報告的措辭**：只有被擋的卡組那一行加「（內容沒有比到）」；差異的判定不變，主控台摘要照舊不印閘門。

### 請特別看

1. 新檢查會不會誤擋合法的回傳：例如錯題的到期（`last.src === 'mistake'`）、當天的作答、考試範圍以外的保持率。
2. 轉接器裡還有沒有靠真假值或 `?.`、`??` 把型別不同的值放過去的地方。
3. 測試的預期值是不是獨立來源；拿掉檢查時擋不擋得住。

### 驗證方式

- `npm run check` 在 `f33f376` 全過（pre-commit 跑的）。`node --test tests/compare-versions.test.ts` 12 項。
- 改壞測試：拿掉 11 處新檢查全部抓到（`a04998e` 提交前跑的，`f33f376` 只改報告的一行字）。
- 真正的 `v0.1.0`、`v0.2.0` 用自編的輸入跑過 `snapshot`（作答過、今天答對、被紀錄行停掉、新卡）：都接得上，到期與閘門相同。
- 用正式使用的 vault 的備份比 `v0.2.0 → f33f376`：差異 0 項（沒有卡組，新檢查只走到空的情況）。
- 沒有跑：CI（沒有 push）；`update-vault --check` 走到新的轉接器（要升版才會跑，使用者 2026-11-02 選先不升）。

## 第三次審查（F2 之後，2026-11-02）

上一次的第 2 點「展開會自己丟錯」是錯的，F2 指出字串也能展開。這次不再靠推論，把轉接器從被比較的版本拿到的值全部列在下面，請逐項看有沒有錯或漏。報告接在同一份報告最後，標題「Codex 第三次審查」；其他規定照上面。

- **對象**：同一個工作目錄與分支。基準 `f33f37694fc22d8c99d36bb8261e08bc7ef2b314`；待審 `2c225bb289bb85d0331f56f82695f87a192d7de9`。範圍 `git diff f33f376 2c225bb`。之後的 commit 只改文件。
- **完成條件**：同上一次；另加「完全沒有內容的輸入也要拒絕」，因為那正是接不上的版本會報成零差異的情況。

### 轉接器從被比較的版本拿到的值

| 值 | 怎麼擋 |
|---|---|
| `manifest.json` 的 `version`、`releaseOf()` | 都要是字串 |
| `createState()` 與 `STATE_METHODS` 裡的方法 | 要是函式 |
| `ready()` | `await`，回傳值不用 |
| `close()` | 不是 Promise 時 `.catch` 丟錯 |
| `unread()`、`blocked().decks`、`.targets` | 陣列，元素是字串 |
| `blocked().all`、`canAnswer()` | 布林 |
| `history().reviews` | 陣列；元素由 `replay` 讀 |
| `replay()`、`today().slots` | `Map` |
| `input().settings.retention` | 有限的數字，沒有內容時也查 |
| `dueAt()`、`dayOf()`、slot 的 `retention` | 有限的數字 |
| `today().share`、`.more` | 陣列；元素的 `lt` 要找得到 slot |
| `nextCard()` 的 `kind` | 只接受 `card`、`done` |
| `decks()`、目標、題目、問題、`conflicts()` 與它的 `targets` | 用 `.map`，字串、Promise、Set 都沒有 `.map` 會丟錯 |
| 卡組與目標的欄位、問題的欄位、`share`／`more` 元素的 `deck`、`lane`，題目的指紋，slot 的 `direction` | **不查**：一邊改了名或換了型別，比的時候就是差異（`same` 比 JSON）；兩邊都改時比不到，但在那之前的發布會先報一次差異 |
| `state.conflicts` 不存在 | **不算接不上**：寫「這一版沒有這個判斷」，找到的照報（舊版本來就沒有；之後的版本改名也會這樣寫，看得到但不擋） |

### 請特別看

1. 上表有沒有漏掉的值、擋法有沒有不成立的。
2. 「不查」的那兩列要不要改：這是實作者的判斷，不是已驗證的安全。
3. 新檢查有沒有誤擋合法的回傳：`share`／`more` 為空、沒有卡組、沒有紀錄、真正的 `v0.1.0`、`v0.2.0`。

### 驗證方式

- `npm run check` 在 `2c225bb` 全過（pre-commit 跑的）。`node --test tests/compare-versions.test.ts` 12 項。
- 改壞測試：拿掉 19 處型別檢查（F1 與 F2 的）全部抓到。
- 真正的 `v0.1.0`、`v0.2.0` 用自編的非空輸入與完全沒有內容的輸入跑過 `snapshot`：都接得上（手動跑的；留在 repo 的跨版本測試只有 `v0.2.0` 的非空輸入）。
- 用正式使用的 vault 的備份比 `v0.2.0 → 2c225bb`：差異 0 項（兩個紀錄檔，沒有卡組）。
- 沒有跑：CI（沒有 push）；`update-vault --check` 走到新的轉接器（要升版才會跑）。

## 第四次審查（F3、F4 之後，2026-11-02）

上一次的表裡「用 `.map` 的不用查」和「欄位不用查」都不成立。這次不再逐項補，改成 `read()` 每讀一個值就查。報告接在同一份報告最後，標題「Codex 第四次審查」；其他規定照上面。

- **對象**：同一個工作目錄與分支。基準 `2c225bb289bb85d0331f56f82695f87a192d7de9`；待審 `1d73cb28f24edef3760b847cf928bf039cb6c445`。範圍 `git diff 2c225bb 1d73cb2`：`3b40b2e`（F4）、`dd10eae`（F3）、`1d73cb2`（補測試）。之後的 commit 只改文件。
- **完成條件**：比較資料裡只有查過的值，經過 JSON 不變；`close()` 與 `onError` 只容許唯讀 Files 自己的拒絕；真正的 `v0.1.0`、`v0.2.0` 與現在的版本不會被誤擋。

### 實作者自己選的做法

1. **投影就是檢查**：不另寫一份驗證比較資料的程式，因為兩份會分岔。`read()` 組比較資料時，每個值都先過 `text`、`textOrNull`、`yesNo`、`integer`、`finite`、`strings`、`array`、`map`。
2. **沒查的，全部在這裡**：

   | 值 | 為什麼不查 |
   |---|---|
   | `history().reviews` 的元素 | 交給同一版的 `replay`，這裡不讀 |
   | `replay()` 算出的記憶 | 交給同一版的 `dueAt`，這裡不讀 |
   | `input()` 除了 `settings.retention` 的部分 | 交給同一版的 `nextCard`，這裡不讀 |
   | `today()` 物件上除了 `share`、`more`、`slots` 的部分，`share`／`more` 元素與 slot 上這裡沒讀的欄位 | 同上 |
   | `ready()` 的回傳值 | 不用 |
   | `state.conflicts` 不存在 | 寫「這一版沒有這個判斷」，Codex 第三次審查同意保留 |

3. **整數與有限的數**：`target.line`、問題與衝突的 `line`、`dayOf` 要整數（小數會讓 `days[1.5]` 算不進去）；`retention`、`dueAt` 只要有限。`-0` 不分，經過 JSON 是 `0`，數值相等。
4. **拒絕的物件**：`refusal` 用物件相等比。之後的版本如果把它包一層再丟，會變成無法比較：寧可擋下來，改轉接器就好。
5. **測試用全域的函式**：`globalThis.broken` 讓 `decks`、`today`、`conflicts` 回傳前先改一次，一份複本跑三十幾種改法，不用每種都複製一次 `src`。

### 請特別看

1. 「比較資料裡只有查過的值」成立嗎：逐行對 `read()` 的回傳值。
2. 新檢查有沒有誤擋合法的回傳：`分類`、`單元`（沒有名稱時 `name` 是空字串）、寫錯的目標、轉錄稿、草稿與暫停的卡組、`問題` 的代碼、真正的 `v0.1.0`、`v0.2.0`。
3. `refusal` 有沒有合法的路徑不是同一個物件，讓正常的比較變成無法比較。
4. 上面的表有沒有漏，理由有沒有不成立的。

### 驗證方式

- `npm run check` 在 `1d73cb2` 全過（pre-commit 跑的）。`node --test tests/compare-versions.test.ts` 14 項。
- 改壞測試：拿掉 58 處檢查全部抓到；腳本先跑基準，把程序當掉和斷言失敗分開算，當掉 0 處。
- 真正的 `v0.1.0`、`v0.2.0`：自編的輸入（有內容、完全沒有內容）與測試 vault 的 5 篇、62 個目標都接得上，和現在差異 0 項（手動跑的；留在 repo 的跨版本測試只有 `v0.2.0`）。
- 用正式使用的 vault 的備份比 `v0.2.0 → 1d73cb2`：差異 0 項（兩個紀錄檔，沒有卡組）。
- 沒有跑：CI（沒有 push）；`update-vault --check` 走到新的轉接器（要升版才會跑）。
