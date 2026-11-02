# 發布前比較接上讀取閘門：Codex L2 審查（2026-11-02）

狀態：再審通過，已合併進 `main`（程式到 `3c6cd96`，第六次審查沒有新發現；F1 修在 `a04998e`，報告的措辭修在 `f33f376`，F2 修在 `2c225bb`，F4 修在 `3b40b2e`，F3 修在 `dd10eae`、`1d73cb2`，F5 修在 `f8e1a4c`，F6 修在 `f1523e1`，F7 修在 `1077e1a`；見文末〈Codex 第六次審查〉）

## 對象與結論

- 工作目錄：`D:\程式開發\Essence Cards\.claude\worktrees\loving-bohr-b7fa09`，分支 `claude/fervent-hodgkin-9c2bca`。
- 基準：`fc91fe73a442d86dbb09ffb469cda5a31ef8651f`；待審：`fb823ebd59afb5fbbf8e92ff7bb56aae0468f3e0`。
- 實測 HEAD：`c8b293e1bb6473a4cae90d6b20da60cafb47ed5e`。已確認 `git diff fb823eb HEAD -- src tools tests .github` 為空；開始時工作樹乾淨。
- 依 `code-quality` 的 L2 流程獨立查核。本文程式位置均指分支 `claude/fervent-hodgkin-9c2bca` 的對應檔案（`fb823eb`），不是主資料夾 `main`。

**現有 `v0.2.0` 與 `fb823eb` 的同步 state 介面下，本輪未找到閘門或今天的份錯算；但「介面型別改了就無法比較」仍有可重現的漏口。** 完整機械檢查通過不能代替這項跨版本契約。建議先修 F1，再聚焦再審該段與回歸測試。

## F1｜P2｜規格：`canAnswer` 的回傳型別不相容，仍當作可比較

**證據：已重現（隔離的介面變更範例；不是聲稱已部署版本已改成 async）。**

**位置**：`tools/compare/adapter.ts:94`；介面檢查在 `:140` 只確認方法是函式。

**契約**：審查請求〈不可破壞的性質〉要求不能把比不了的判斷報成零差異；`tasks/update-safeguards.md` §1-3 明定「接不上（函式不存在、型別不同）」輸出無法比較。這個轉接器會動態載入任意指定 commit，不能用目前 repo 的 TypeScript 宣告保證另一版的回傳型別。

**觸發條件**：被比較版本仍有 `canAnswer`，但改為回傳 `Promise<boolean>`。建立目前 `src/` 的暫存複本，只做以下兩處介面變更；其他行為保持原樣：

```diff
- canAnswer(lt: string): boolean;
+ canAnswer(lt: string): Promise<boolean>;
- canAnswer: answerable,
+ canAnswer: async (lt: string) => answerable(lt),
```

輸入時間為 `2026-10-29T20:00:00+08:00`、offset `480`；`Essence Cards/A.md` 有一個新目標 `aaa111`，紀錄有一行：

```json
{"t":"2026-10-29T19:00:00+08:00","lt":"aaa111","need":"99.0.0"}
```

**預期**：轉接器不支援這個回傳契約，應拒絕並回報無法比較；若選擇明確支援 async，則必須取得實際布林值，保留 `'stopped'`。

**實際**：`:94` 對 Promise 做 `!`，結果一律為 false。`snapshot()` 成功回傳；透過轉接器 CLI 的獨立 Node 程序也回傳：

```json
{"ok":true,"held":["aaa111"],"due":{"aaa111":null}}
```

同一份輸入在未改的 `fb823eb` 是 `due.aaa111 === 'stopped'`；變更版的 `today` 仍為空、`held` 仍列出 `aaa111`，到期卻被寫成「新卡」。再移除該紀錄行、保留新目標，未改版與不相容版的 `diffSnapshots` 回傳 `[]`。因此方法存在不代表可以比較，這個不相容版本確實能被報成零差異。

**影響**：之後 state 介面改成 async、或回傳另一種狀態值，工具可能繼續顯示比較成功，且漏掉停用判斷。這是相容性拒絕的漏口；本輪沒有證據顯示真正 `v0.1.0`／`v0.2.0` 已受到這種型別變更影響。

**建議：合併前修。** 先取得 `canAnswer` 的回傳值，確認符合轉接器支援的契約；不支援的型別直接拒絕，不能靠 truthiness。補公開 `snapshot` 或轉接器 CLI 的回歸例子，至少包含 `false`、`true` 與不支援的 Promise／undefined；後兩者不能產生成功快照。若決定支援 Promise，測到它解析為 false 時仍是 `'stopped'`。不需要為此更動已部署的舊版。

## 完成條件與指定風險核對

| 條件／風險 | 本輪判斷與證據 |
|---|---|
| 兩邊各用自己的讀取版本 | 符合所驗版本。動態載入該版 `releaseOf` 與 `createState`，傳該版 manifest；既有 5.0.0 複本測試驗同一標記兩邊讀取結果不同。實測真正 `v0.1.0` 的 `aaa111` 被 `need:99.0.0` 停掉，conflicts 是 null。 |
| 卡組、停掉的目標、不完整與 D-157 衝突進比較資料 | 符合所驗案例。既有固定輸入驗各項；新增隔離組合把同一 ID 同時放在可讀篇、暫停篇、需要新版的篇，並用 need 紀錄停它：gates 同時保留三種原因，due 是 stopped、today 空。另加只出現在紀錄裡的 `orphan1`，held 仍列出它。 |
| 到期和該版 state 相同 | 接上了該版 `canAnswer`，因此現有同步介面的讀取閘門與衝突會停到期。`due` 定義是全部有效紀錄的「下次到期」，`today.slots.memory` 則只用今天以前的紀錄，不能拿兩者數字直接比；保留這個差別符合 §1-3「下次到期」的原始契約。暫停／草稿不是讀取閘門，未要求它們的記憶到期消失。介面不相容的例外見 F1。 |
| 今天的份和該版 state 相同 | 直接取 `state.today()`。新增 123 個目標、當天 good／miss、share／more、清晨 4 點前後與 offset +480／-420 共 6 組，逐筆核對真實 state 的 ID／順序與單張取題結果，全過；輸入序列化前後相同。這些是接線一致性檢查，排程數值的獨立預期另由既有固定輸入與 FSRS 規格測試負責。 |
| 舊版沒有 D-157，不能套新版規則 | 符合。既有真正 v0.2.0 的測試驗舊版保留第一篇、新版都停；額外在 held 已使兩版 due／today 相同的情況，真實發布比較仍單獨報出新增的 ID 衝突，沒有被其他閘門掩蓋。 |
| 未知讀取能力、接不上不能當成零差異 | 缺模組／方法、壞版號與超時的既有測試通過；回傳型別不相容漏掉，見 F1。 |
| 唯讀；不注入假的版本行，不吃掉寫入 | 凍結 Files 確實拒絕寫入；不是把寫入假裝成功。載入仍會把版本行加到記憶裡的 `history.changes`，目前的 due／plan／next 不讀它，未發現影響。第一個版本行失敗後、後方尚未送到 Files 的寫入無法偵測，是請求已明列的限制；不能把本輪結果說成證明任何未來版本都完全不排寫入。 |
| 程序與計時器收尾 | 完整測試中的真實舊新版比較及超時案例均結束；額外 CLI 與 checkUpdate 接線也正常退出。超時測試確認工作樹清單回到一筆。未另做計時器 heap 分析，不把正常退出擴寫成任意未來版都沒有洩漏。 |
| 跨版本固定輸入與預期值 | 真實 v0.2.0 tag、硬編的到期時間／順序／衝突清單提供獨立預期；有讀取能力差異、全份不完整與不相容模組。現有回歸未覆蓋「方法仍存在但回傳契約變了」，所以 F1 漏過。 |

### 「沒有差異」的範圍需要說清楚

審查請求的總原則寫「不能把看不懂……報成零差異」，但自選做法第 5、6 點與測試，又明定「兩邊都讀不懂同一篇」及 `conflicts: null` 對 `[]` 可以零差異。這兩處若按字面讀有張力，不能把後者解釋成已驗證所有卡組內容與所有舊版能力。

目前報告兩側都列出卡組閘門，null 也明寫「這一版沒有這個判斷」，所以**這兩個明列行為不另外報成實作錯誤**；零項代表兩側可觀察結果沒有差異。建議 Claude 核對總原則的適用範圍；若保留可比資料零差異，對兩邊都讀不懂的卡組直接補上「內容未比較」會比單寫「沒有差異」清楚。這項措辭不能用來豁免 F1：F1 根本沒有辨認出回傳契約已不支援，也沒有列出相應限制。

## 驗證紀錄

- Windows、Node `v24.13.0`。在上述 worktree、沙箱外執行 `npm run check`：exit 0，**1058／1058 通過**，fail／cancelled／skipped 均為 0。型別、ESLint、knip、secretlint、skill 副本與文件檢查一併通過；其中 compare 測試 11 項全過。
- `git diff --check` 通過。`fb823eb` 到實測 HEAD 的程式／測試／CI 無差異。
- 額外探針均用自編資料與暫存複本／clone，未讀正式 vault。探針初次在沙箱內因建立 node_modules junction 得到 EPERM，尚未執行到行為斷言；改在沙箱外重跑後取得上列結果，未把該次環境失敗算成通過。
- `checkUpdate → compareVersions → 兩個真實轉接器程序`：用暫存且登錄於暫存 local 的測試 vault，舊版真正 `v0.2.0`（`74637e5e8d8638fc5208a497682a9a336dcd45b2`）、新版 `fb823eb`；回傳 differences 1，報告列兩側閘門與 D-157 衝突。`check` seam 不重跑整包檢查；`compare` seam 僅轉交真實 compareVersions 並以 node_modules junction 取代 npm ci，沒有回傳假比較結果；未呼叫 install。
- 真正 `v0.1.0`（`a4922fa8842db68a0acd88de2bf8ba3679a43fde`）另開暫存 clone，以 need 固定輸入直接跑 snapshot：held 與 stopped 正確、conflicts null；這不是完整的 v0.1.0 發布流程驗收。
- F1 的 CLI 輸入／輸出與探針結果暫存在 `C:\Users\kuo\AppData\Local\Temp\essence-l2-gates-0QzRiY`（`async-input.json`、`async-output.json`、`results.json`）；重現所需變更與輸入已完整寫在 F1，無須依賴暫存資料長期存在。
- 本輪只新增這份審查報告，未改產品程式、測試、任務或 roadmap，未 commit／push。

未測項目與原因：未執行 GitHub Actions（分支未 push，無法據本機結果宣稱 fetch-depth 改動已在 CI 驗過）；未以各版 lockfile 重新 npm ci（隔離接線探針重用現有 node_modules，完整檢查也使用現有安裝）；未操作正式 vault、Obsidian、iPhone 或安裝流程（本輪只審查）；未測明確延後的 exam 與真實完整複習的取題順序（報告已列限制）；未重跑實作者的 12 處改壞測試（本輪自行補不相容回傳值與跨閘門組合）。

## Claude 回應 Codex L2（2026-11-02）

**F1：接受，已修（`a04998e`）。** 用同樣的改法重現了：`canAnswer` 回傳 Promise 時，被紀錄行停掉的目標變成新卡。

這不只是 `canAnswer` 一處。修之前在暫存複本改了 10 種回傳值，9 種都放過去、產生成功的快照：

| 改法 | 修之前的結果 |
|---|---|
| `canAnswer` 回傳 Promise | 停掉的目標變成新卡 |
| `canAnswer` 回傳 `undefined` | 全部目標變成停掉，今天的份照舊 |
| `unread` 回傳 Promise | `.length` 是 undefined，當成沒有讀不到的 |
| `blocked()` 的 `all` 改名 | 閘門少了「整份紀錄不完整」，報告寫「否」 |
| `dueAt` 回傳 NaN | 寫進 JSON 變成 null，作答過的目標變成新卡 |
| `dayOf` 回傳 Promise | 30 天的到期數全是 0 |
| `nextCard` 回傳 Promise 或 `stale` | 每一題都是 null |
| 今天的份的 `retention` 是 undefined | 變成 null |

只有 `releaseOf` 回傳 Promise 被擋下，而且是 state 自己丟錯，不是轉接器查到的。

所以修法是：被比較的版本回傳的值，拿來判斷或算數之前都先查型別，不對就是「無法比較」。判斷標準是「型別錯了不會自己丟錯」的才查；會自己丟錯的（展開、`.map`）不多加一層。卡組的欄位不查：一邊改了名，比的時候就是差異，寫在註解與再審請求裡。

回歸測試照 F1 的建議用公開的 `snapshot`：`false`（`stopped`）、`true`（照紀錄算）、今天已經答對（`done`，不能誤擋）都有具體的預期值，上面的改法加上 `slots` 少一筆都要拒絕。改壞測試：拿掉 11 處新檢查全部抓到；第一次跑時「不接受 `done`」沒抓到，因此補了今天已經答對的例子。真正的 `v0.1.0`、`v0.2.0` 都還接得上，沒有被誤擋。

**「沒有差異」的範圍：接受（`f33f376`）。** 報告的閘門在有被擋的卡組時寫「（內容沒有比到）」；差異的判定不變，兩邊都讀不懂仍然不算差異。總原則這樣解：比不了的不能只寫「沒有差異」就結束，要在同一份報告寫明沒比到什麼。`conflicts: null` 對 `[]` 本來就寫「這一版沒有這個判斷」，不用改。

**重跑（`f33f376`）：** 用同一份凍結的備份（雜湊和正式使用的 vault 現在的兩個紀錄檔相同）比 `v0.2.0 → f33f376`，差異 0 項，兩邊閘門和第一次相同；這份備份沒有卡組，新檢查在這裡只走到空的情況，非空的情況由固定輸入測試涵蓋。沒有跑的和第一次相同：CI（沒有 push）、`update-vault --check` 實際走新轉接器（要升版才會跑，使用者 2026-11-02 選先不升）。

## Codex 再審

狀態：待修（原 F1 的 canAnswer 案例已修；集合回傳型別仍有 1 項 P2，F2）

### 範圍與結論（2026-11-02）

本輪依任務文末〈再審〉聚焦查核 `c8b293e1bb6473a4cae90d6b20da60cafb47ed5e → f33f37694fc22d8c99d36bb8261e08bc7ef2b314`，不重審第一輪未變的功能。工作目錄、分支同前；開始時乾淨，實測 HEAD 是 `a553d5cf14da7006d6051eb832f435f4e56d07e6`，已確認 `git diff f33f376 HEAD -- src tools tests .github` 為空。以下程式位置均指分支 `claude/fervent-hodgkin-9c2bca` 的對應檔案（`f33f376`）。

原 F1 的 Promise／undefined 判斷已補正；新數值檢查沒有誤擋本輪測到的合法舊新版輸入。「內容沒有比到」的報告措辭也已補上。不過，完成條件「回傳型別不同的版本不會產生成功的快照」尚未達成：未檢查的集合欄位仍會接受字串，見 F2。建議修正後再聚焦審集合邊界與相鄰案例。

### F2｜P2｜規格：集合欄位靠展開／迭代不能排除字串，不相容版本仍成功

**證據：已重現。** 以下是隔離複本模擬的介面變更，不是聲稱真正已部署的 tag 有這個回傳型別。

**位置**：`tools/compare/adapter.ts:132` 的 `[...blocked.decks]`、`[...blocked.targets]`；同類漏口在 `:102` 將 `state.history().reviews` 直接交給 `replay`。

**契約與原因**：再審完成條件及原 §1-3 都要求不相容的回傳型別不能產生成功快照。再審自選做法第 2 點認為集合型別不對時會由展開或 `.map` 自行丟錯；但這幾處實際用的是展開或 `for...of`，字串也是 iterable，因此不會丟錯。TypeScript 的 `as` 不會驗另一版的執行結果。

**重現 A：卡組與停用 ID 清單變成字串。** 在暫存 `src/state/index.ts`，只把 blocked accessor 的兩欄改成字串：

```diff
- decks: gated, targets: history.held, all: history.incomplete
+ decks: gated.join(''), targets: history.held.join(''), all: history.incomplete
```

使用兩篇自編卡組：A 有目標 `aaa111`，C 帶 `需要版本: 99.0.0` 且也有 `aaa111`；紀錄有 `lt: "aaa111", need: "99.0.0"` 的行。預期轉接器拒絕此集合型別；實際 `snapshot` 成功，CLI 也回 `ok: true`：

- 正常 gates：`decks: ["Essence Cards/C.md"]`、`held: ["aaa111"]`。
- 變更版 gates：`decks: ["E","s","s","e","n","c","e"," ","C","a","r","d","s","/","C",".","m","d"]`、`held: ["a","a","a","1","1","1"]`。

同一個變更版改用沒有讀取閘門的輸入時，兩個字串都是空字串，被展開成 `[]`；與正常版的 `diffSnapshots` 是 `[]`。也就是不相容介面不只會產生錯的閘門內容，還能被報成零差異。

**重現 B：歷史清單變成空字串。** 在另一個暫存複本，只改公開 accessor：

```diff
- history: () => history,
+ history: () => ({ ...history, reviews: '' }),
```

輸入一個 `aaa111` 與 `2026-10-20T20:00:00+08:00` 的 good 紀錄，現在固定為 `2026-10-29T20:00:00+08:00`、offset 480。預期拒絕非陣列的 reviews；實際空字串經 `replay` 的迭代後成為空 Map，仍成功回傳快照：正常版到期是 `2026-10-27T20:00:00Z`，變更版卻為 `null`，把作答過的目標當成新卡。

**影響**：不相容的集合回傳介面會被當成有效資料，閘門的路徑／ID 可能拆成字元，或歷史被當成沒有紀錄；空集合尤其能掩蓋不相容而得到零差異。這和原 F1 是同一類相容性拒絕漏口，修正範圍仍在本輪的回傳值檢查。

**建議：合併前修。** 明確查核這些由轉接器消費的集合契約，至少讓 `blocked().decks`／`targets` 與 `history().reviews` 的字串型別被拒絕；對 `today().share`／`more` 等使用迭代、而非 `.map` 的欄位一併核對，不能以「會自行丟錯」當保證。若契約限定陣列，可直接檢查 `Array.isArray`；另確認當作路徑／ID 使用的元素符合字串契約。補公開 snapshot 的空字串與非空字串回歸例子，並保留真正舊版的正例；不需替未使用的欄位建立完整 schema，也不需修改凍結的部署版本。

### 原修正與相鄰案例核對

| 項目 | 結果 |
|---|---|
| 原 F1 的 canAnswer Promise | 使用第一輪相同介面改法重跑，現在拒絕並包含 `canAnswer() 型別不同`；原案例可關閉。既有新增測試也涵蓋 undefined、正常 true／false。 |
| dueAt／dayOf／retention／blocked.all／unread／next.kind | 新增的有限數、布林、陣列與 kind 檢查有作用；完整 compare 測試 12 項通過。集合漏口另列 F2，不以這些通過宣稱所有型別都已擋住。 |
| 合法舊新版不誤擋 | 真正 `v0.1.0`、`v0.2.0` 與目前程式各跑同一份非空自編輸入，全部接得上；三者的逐目標到期符合獨立字面預期。 |
| 錯題／當天作答／新卡 | 固定時間如 F2：10/20 good 到期 10/27 20:00Z；當天第一次 good 到期 11/05 20:00Z 且取題為 done／prompt null；mistake 到期等於該筆時間；miss 加 60 秒、near 加 600 秒；被 held 的是 stopped，新卡是 null。三版均相同。 |
| 保持率 | 上列三版每一個 today 項目都是 0.8，未因新檢查誤擋。exam 仍為 null，未擴大成已驗考前排序。 |
| 報告措辭 | 非空卡組閘門補「（內容沒有比到）」；空閘門仍寫「沒有」，null conflicts 仍寫舊版沒有判斷，未改差異演算法。與 Claude 對零差異範圍的回覆一致。 |
| 預期值與測試防回歸 | 新測試用固定到期字面值、stopped 與 null，沒有重跑同一算法來產生預期。另在暫存 clone 自選 11 種刪改（布林檢查、dueAt、dayOf、slot 存在、next kind、retention、all、release、unread、誤拒 done、只擋 undefined），新增 F1 測試均 exit 1、無超時；正常基線 exit 0。這證明所列斷言有作用，不能涵蓋尚未加入的 F2 字串案例。 |

### 本輪驗證紀錄

- Windows、Node `v24.13.0`；在指定 worktree、沙箱外執行 `npm run check`：exit 0，**1059／1059 通過**，fail／cancelled／skipped 均為 0，約 139 秒；包含型別、ESLint、knip、secretlint、skill 一致性、文件與 compare 測試 12 項。
- 以上隔離探針只用自編內容、暫存複本／clone。舊版相依套件以 node_modules junction 重用現有安裝；未動正式 vault 或使用中工作樹的程式。
- F2 的完整非空輸入、CLI 輸出、正常／變更快照與三版正例結果暫存在 `C:\Users\kuo\AppData\Local\Temp\essence-l2-gates-r2-LYFmDi`（`input.json`、`output.json`、`results.json`、`string-reviews-results.json`）；上文已保留不依賴暫存路徑的改法與輸入條件。11 種刪改的狀態在 `C:\Users\kuo\AppData\Local\Temp\essence-l2-gates-mutations-sljtWj\mutation-results.json`。
- 本輪僅在同一份報告後追加本節，未改產品程式、測試、任務或 roadmap，未 commit／push。

未測項目與原因：未重審第一輪未改的功能；未跑 CI、各版重新 npm ci、正式 vault／Obsidian／iPhone、安裝或升版（本輪只做聚焦再審）；未重跑 update-vault 接線（本輪未改 compareVersions 接線，第一輪的隔離接線結果仍在前文）；未涵蓋未實作的 exam 行為或任意未來版的所有資料形狀。

## Claude 回應 Codex 再審（2026-11-02）

**F2：接受，已修（`2c225bb`）。** 請求裡「型別不對時展開會自己丟錯」是我沒有驗證的推論，字串就不會丟錯。

修法：被展開或走訪的都查是陣列（`unread`、`blocked().decks`／`targets`、`history().reviews`、`today().share`／`more`），當路徑與 ID 用的元素查是字串。同一類、F2 沒有列到的也一起補了：

- `replay()` 與 `today().slots` 要是 `Map`：之前沒有目標、沒有今天的份時不會呼叫 `.get`，不會丟錯。
- `input().settings.retention` 一開始就查：之前沒有作答時用不到，不會丟錯。

回歸測試：每種改法都跑「有內容」和「完全沒有內容」兩個輸入，完全沒有內容正是會報成零差異的情況；清單元素是數字時也拒絕。真正舊版的正例照舊：跨版本測試的 `v0.2.0` 有閘門、作答與今天的份。

改壞測試：拿掉 19 處型別檢查（F1 與 F2 的）全部抓到。真正的 `v0.1.0`、`v0.2.0` 都還接得上。

**重跑（`2c225bb`）：** 同一份凍結的備份（兩個紀錄檔的雜湊和正式使用的 vault 現在相同）比 `v0.2.0 → 2c225bb`，差異 0 項，兩邊閘門和前兩次相同。

**這次多做的：** 兩輪的發現都是「這個值沒查」，所以把轉接器從被比較的版本拿到的值全部列在[審查請求](../tasks/compare-gates-review.md)〈第三次審查〉的表裡，讓再審對著清單看，不只看我修的地方。「不查」的兩列（卡組的欄位、`state.conflicts` 不存在）是我的判斷，不是已驗證的安全，請 Codex 明確回覆。

## Codex 第三次審查

狀態：待修（原 F2 的兩個重現已修；另有 2 項 P2，F3、F4）

### 範圍與結論（2026-11-02）

依任務〈第三次審查〉核對完整取值表，審查差異為 `f33f37694fc22d8c99d36bb8261e08bc7ef2b314 → 2c225bb289bb85d0331f56f82695f87a192d7de9`。工作目錄及分支同前，開始時乾淨；實測 HEAD `c4652c13d29a6ca82a19ba6e06dc50fca876a990`，已確認 `git diff 2c225bb HEAD -- src tools tests .github` 為空。下文位置均指分支 `claude/fervent-hodgkin-9c2bca` 的對應檔案（`2c225bb`）。

F2 的字串 gates 與字串 reviews，在有內容、完全空白的輸入下都已拒絕；真正舊新版的 12 組合法輸入也沒有被誤擋。不過，取值表中「用 .map 就不必查」與「欄位換型別一定會變成差異」不能當作安全保證，見 F3；close 的拒絕也不限於版本行錯誤，見 F4。建議修後再審這兩個邊界。

### F3｜P2｜規格：未驗證的快照投影仍可能失去型別，JSON 往返會掩蓋差異或破壞結構

**證據：已重現，兩個隔離的介面變更例子。** 不是聲稱部署中的 tag 已出現這些回傳值。

**位置**：`tools/compare/adapter.ts:107` 的 decks 投影、`:109` 的 props 欄位直接採用；`tools/compare/snapshot.ts:61` 的 `same` 以 JSON 比較。這對應本輪取值表的 `.map` 清單列與未查欄位列。

**契約**：不相容的回傳型別不能產生成功快照，完全空白的輸入也不能掩蓋已取得的型別錯誤。實作者判斷「一邊換了型別，比 JSON 就是差異」不成立：NaN／Infinity 會變成 null；而有 `.map` 的物件也不一定是陣列。

**例 A：term 從 null 變成 NaN，確實報成零差異。** 暫存 `src/state/index.ts` 只改公開 decks accessor：

```diff
- decks: () => deckList,
+ decks: () => deckList.map(entry => ({ ...entry, deck: { ...entry.deck, props: { ...entry.deck.props, term: NaN } } })),
```

自編 A.md 有 `aaa111` 與一題，沒有學期屬性；紀錄有 `2026-10-20T20:00:00+08:00` 的 good，現在為 `2026-10-29T20:00:00+08:00`、offset 480。正常 snapshot 的 `props.term` 是 null，變更版是 NaN；預期拒絕不符合 string／null 的欄位，實際 snapshot 成功，`diffSnapshots` 回 `[]`。再透過轉接器 CLI 驗證，仍是 `ok: true`，輸出中的 term 已變成 null，與正常版仍是零差異。只在 diff 端補判斷來不及，因為程序之間的 JSON 已丟掉原型別。

**例 B：空的 typed array 有 .map，會產生結構不符的成功快照。** 另一個暫存複本只改：

```diff
- decks: () => deckList,
+ decks: () => new Uint8Array(),
```

以 `files: {}` 執行，`.map` 不會呼叫 callback，也不會丟錯。snapshot 成功，`decks` 是 Uint8Array；記憶體內與正常空快照的 `diffSnapshots` 是 `[]`。JSON 往返後 decks 成為 `{}`，再交給 diff 則因 `.map` 不存在而丟錯。結果不是可讀的「無法比較」報告，而是 adapter 先宣告成功、比較端才讀不下去。表內列舉的字串／Promise／Set 確實沒有 .map，但不能由此推論所有不相容集合都會自行丟錯。

**影響與建議：合併前修。** 在 adapter 宣告成功、序列化之前，保證輸出的比較資料符合它承諾的結構與基本值型別；可集中在快照輸出邊界檢查，避免每次只補一個使用點。至少讓 `.map` 清單確認是陣列，並拒絕投影欄位中不符合契約、會被 JSON 改寫的值；不是只新增 term 一個 NaN 特例。補公開 snapshot／CLI 的兩個回歸例子，包含空輸入與 JSON 往返；正常 null 與正常陣列仍須通過。這只要求驗證送給比較端的契約，不要求重驗該版內部全部物件或排程算法。

### F4｜P2｜規格與設計：close 的所有拒絕都被吞掉，非版本行錯誤也回報成功

**證據：已重現，包含直接呼叫 state 與轉接器 CLI。**

**位置**：`tools/compare/adapter.ts:178`～`:180` 的 finally。表中「不是 Promise 時 .catch 丟錯」只涵蓋同步回傳型別，沒有涵蓋 Promise 因其他錯誤而拒絕。

**觸發條件**：暫存 state 的 close 在 `reads.stop()` 後丟出 `TypeError('unsupported close contract')`。輸入只有自己的 `Essence Cards/紀錄/2026-10 compare.jsonl`，含一行 `{"t":"2026-10-29T19:00:00+08:00","set":"app","val":"0.2.0"}`，現在同例 A。版本行已是本版，所以不需排入任何新版本行。

**預期／實際**：同一個變更版直接建立 state，已確認 `version().own === 'same'`、append 嘗試 **0 次**，而 close 確實以該 TypeError 拒絕。這不是唯讀 Files 拒絕版本行的預期錯誤。轉接器卻把它吞掉，CLI 仍輸出 `ok: true`，與正常快照比較為零差異；`failures` 也不會自動收到直接從 close 丟出的錯誤。

**影響**：另一版 state 在收尾遇到未支援的流程／程式錯誤，會被誤當成版本行被拒絕，仍宣告可比較。原來允許忽略的是已知的唯讀版本行失敗，不是任意 close 錯誤。

**建議：合併前修。** 保留並識別唯讀 Files 實際拒絕的錯誤，只容許已確認的版本行拒絕；不相關的 close rejection 必須傳出，讓 CLI／compareVersions 回報無法比較。補兩個成對例子：預期 app append 拒絕仍可取得快照；沒有 app append、close 自己拒絕則不能成功。不需改動已部署的舊版。

### 取值表逐項回覆

| 表內項目 | 本輪結論 |
|---|---|
| manifest.version、releaseOf | 有字串檢查；現行 reader 仍負責正式版號的判斷。未發現本輪修正造成誤擋。 |
| createState、STATE_METHODS | createState 出口與所需方法確認為函式；回傳物件缺方法時會拒絕。 |
| ready | await 並不用完成值合理；不能把這列解釋成已驗證未被呼叫方法的所有可能回傳值。 |
| close | 同步非 Promise 會丟錯，但拒絕原因全吞有 F4。 |
| unread、blocked.decks／targets | 原 F2 的空／非空字串現在都拒絕；陣列元素的數字案例也在新增測試。 |
| blocked.all、canAnswer | 布林檢查保留，原 F1 的 Promise 漏口已修。 |
| history.reviews | 新增陣列檢查已阻止原 F2 的空字串。元素交給同版 replay，未自行複製排程規則。 |
| replay、today.slots | Map 檢查在沒有內容時也會執行；同程序動態 import 的真正舊版使用原生 Map，沒有跨 realm 誤擋。 |
| input.settings.retention | 現在一開始就驗有限數，不再依賴有作答才觸發。 |
| dueAt、dayOf、slot.retention | 有限數檢查保留；未因這次變更引入新的計算。 |
| today.share／more | 有陣列檢查，空陣列合法；每個實際 item 會查 slot。 |
| nextCard.kind | card／done 合法、stale 或 Promise 拒絕；當天答對的 done 正例仍通過。 |
| 使用 .map 的清單 | **不能只靠 .map 保證型別**，見 F3 例 B。一般字串／Promise／Set 會丟錯這件事正確，但不足以證明此列完成。 |
| 卡組／目標等投影欄位不查 | **不同意現有理由**，見 F3 例 A。並非所有異型值經 JSON 比較都會變成差異。 |
| state.conflicts 不存在 | **可保留為明列的能力限制**，符合舊版不執行新版規則的約定。null 不等於確認無衝突；目前報告會寫「這一版沒有這個判斷」，另一邊找到衝突仍照報。缺方法時不能宣稱已驗證該版不存在重複 ID；未因此另外要求修改舊 tag。 |

### 驗證紀錄

- 指定 worktree、Windows、Node `v24.13.0`，沙箱外 `npm run check`：exit 0，**1059／1059 通過**，fail／cancelled／skipped 均為 0，約 172 秒；compare 測試仍為 12 項。這些測試目前沒有 F3、F4 的反例。
- 真正 `v0.1.0`、`v0.2.0` 與目前程式，各跑「非空卡組＋紀錄」「完全空白」「只有卡組」「只有紀錄」共 **12 組正例**，全通過。非空舊紀錄的到期固定斷言為 `2026-10-27T20:00:00Z`；新卡為 null；無卡組時 decks／today 空、30 天全為 0。
- 原 F2 的兩個改法另跑有內容與空輸入共 4 次，全部拒絕。缺 conflicts 方法的隔離例子確認輸出 null，報告限制文字仍存在。
- F3 例 A 有直接 snapshot 及 CLI 證據；例 B 有 snapshot、記憶體 diff 與 JSON 往返後 diff 的證據。F4 已以直接 state 驗證零 append 且 close 拒絕，再經 CLI 證實仍回成功。
- 探針皆使用自編輸入與隔離複本／clone，node_modules junction 重用現有安裝；未讀正式 vault。資料暫存在 `C:\Users\kuo\AppData\Local\Temp\essence-l2-gates-r3-RmmKqD`：`input.json`、`nan-output.json`、`close-input.json`、`close-output.json`、`results.json`、`typed-decks-results.json`；重現所需改法及輸入條件已寫在上文，不依賴暫存檔長期保存。
- 本輪僅在原報告後追加本節，未改產品程式、測試、任務或 roadmap，未 commit／push。

未測項目與原因：未重審前兩輪未改的功能；未重跑實作者的 19 處改壞測試（本輪以原 F2 與新取值表反例查核）；未跑 CI、各版重新 npm ci、update-vault 接線、正式 vault／Obsidian／iPhone、安裝或升版（本輪只做第三次審查）；未驗證明確延後的 exam 或任意未來版的全部行為。

## Claude 回應 Codex 第三次審查（2026-11-02）

**F4：接受，已修（`3b40b2e`）。** 唯讀的 Files 現在用同一個物件拒絕寫入，紀錄的寫入端在 `v0.1.0`、`v0.2.0` 與現在都原樣傳回這個物件。`close()` 和 `onError` 只容許這個物件，其他的都是無法比較。`onError` 原本看 `source` 是不是 `write`，同樣會把寫入時別的錯放過去，一起改成不看 `source`。測試照建議成對：版本行被拒絕、完全沒有寫入都讀得到；`close` 自己丟錯在兩種輸入都拒絕，命令列也一樣。

**F3：接受，已修（`dd10eae`，測試補在 `1d73cb2`）。** 請求裡「用 `.map` 的不用查」和「欄位換型別一定比得出差異」都不成立。

三輪的發現都是「這個值沒查」，所以這次不再逐項補，也不另寫一份驗證：`read()` 每讀一個值就查，比較資料裡只有查過的值。沒查的只剩交回同一版處理、這裡不讀內容的，列在[審查請求](../tasks/compare-gates-review.md)〈第四次審查〉。

**`state.conflicts` 不存在：** 照 Codex 的回覆保留成能力限制。只把 `state.conflicts ?` 改成 `=== undefined`，`null` 或其他假值不再算「這一版沒有這個判斷」。

**驗證：**

- 改壞測試：一共 58 處。第一次 56 處抓到，`unit.code` 和 `dayOf` 回傳小數沒抓到，補了例子後全部抓到。腳本先跑基準，把程序當掉和斷言失敗分開算，當掉 0 處。
- 正常的輸入：有學期、單元、分類、英翻中方向、暫停、寫錯與沒有 ID 的目標的卡組，在真正的 `v0.2.0` 與現在都通過，內容有具體的預期值，經過 JSON 不變。
- 非這次自編的卡組：測試 vault 的 5 篇、62 個目標，`v0.1.0`、`v0.2.0` 與現在都接得上，差異 0 項。這是手動跑的，內容不進 repo。
- 重跑（`1d73cb2`）：同一份凍結的備份（兩個紀錄檔的雜湊和正式使用的 vault 現在相同）比 `v0.2.0 → 1d73cb2`，差異 0 項，兩邊閘門和前幾次相同。
- 沒有跑：CI（沒有 push）；`update-vault --check` 實際走新轉接器（要升版才會跑）。

## Codex 第四次審查

狀態：待修（原 F3、F4 的重現已修；另有 1 項 P2，F5）

### 範圍與結論（2026-11-02）

依任務〈第四次審查〉核對 `2c225bb289bb85d0331f56f82695f87a192d7de9 → 1d73cb28f24edef3760b847cf928bf039cb6c445`，工作目錄及分支同前。開始時工作樹乾淨；實測 HEAD `e9320a904f3a8412b8bb908e55c1ced7d7f87f70`，已確認 `git diff 1d73cb2 HEAD -- src tools tests .github` 為空。下文位置均指分支 `claude/fervent-hodgkin-9c2bca` 的對應檔案（`1d73cb2`）。

F3 的 NaN term 與空 typed array、F4 的無版本行寫入卻 close 拒絕，現在都會拒絕；唯讀 Files 的預期拒絕在三個版本也都保持同一個物件。投影欄位的基本型別已逐項檢查，但「比較資料裡只有查過的值，經過 JSON 不變」尚有稀疏陣列的漏口，見 F5。建議修後再聚焦審這個共用陣列邊界。

### F5｜P2｜規格：陣列空洞跳過逐元素檢查，仍回成功且經 JSON 變成 null

**證據：已重現，含直接 snapshot、CLI 與完全空白的輸入。** 以下用隔離複本模擬回傳值，不是聲稱部署中的版本已產生稀疏陣列。

**位置**：`tools/compare/adapter.ts:53` 的 array 只檢查 Array.isArray；`:59` 的 strings 用 .some、`:130` 的題目指紋及 conflicts 的投影用 .map。兩種方法都跳過空洞，不會執行對應的元素檢查。

**契約**：本輪要求所有輸出值都查過、經 JSON 不變。`new Array(1)` 是長度 1、索引 0 不存在的稀疏陣列；它能通過 Array.isArray，卻不是符合 string[] 或物件清單契約的輸出。JSON 會把該空洞寫成 null。

**重現 A：分類清單。** 暫存 `src/state/index.ts` 只改公開 decks accessor：

```diff
- decks: () => deckList,
+ decks: () => deckList.map(entry => ({ ...entry, deck: { ...entry.deck, props: { ...entry.deck.props, categories: new Array(1) } } })),
```

輸入 A.md 一個 `aaa111` 與一題，現在固定 `2026-10-29T20:00:00+08:00`、offset 480。預期拒絕沒有字串元素的分類清單；實際 snapshot 成功，categories 長度是 1，但 `0 in categories` 是 false。CLI 仍回 `ok: true`，輸出的 categories 是 `[null]`。`JSON.parse(JSON.stringify(snap))` 與原快照不相等。

**重現 B：.map 的投影同樣繞過。** 在另一個複本的 decks accessor，把每個目標的 prompts 換成 `new Array(1)`；snapshot 仍成功，投影的 fingerprints 保留一個空洞，經 JSON 成為 `[null]`，沒有執行 `text(prompt.fingerprint, ...)`。

**重現 C：完全沒有內容也會成功。** 只把 `conflicts: () => life.loaded ? tracker.duplicates() : []` 改成 `conflicts: () => new Array(1)`，以 `files: {}` 執行。snapshot 成功，gates.conflicts 含一個空洞，JSON 輸出 `[null]`，不符合比較端預期的 Conflict[]。

**影響**：adapter 宣告成功的快照仍可能含未檢查、無法忠實跨程序傳遞的元素。字串清單可能變成含 null 的清單；conflicts 等物件清單的 null 還會讓比較或報告取欄位時失敗。這是輸出契約的剩餘漏口，不是對目前真實卡組資料錯誤率的推定。

**建議：合併前修。** 在共用陣列入口處明確處理空洞，讓後續每個索引都確實經過元素檢查；可直接拒絕稀疏陣列，或將空洞展開成 undefined 後由既有檢查拒絕。不要只為 categories 加一個特例，因為 .map 清單同樣受影響。補分類、題目清單與空輸入 conflicts 的公開介面回歸；正常空陣列仍須通過，成功快照的 JSON 往返仍須相同（保留請求已明定的 -0／0 數值等價）。

### 修正、委派界線與合法案例核對

| 項目 | 本輪結論 |
|---|---|
| F3 原兩個案例 | term 為 NaN、decks 為空 Uint8Array 均被拒絕，錯誤含對應型別名稱；原重現可關閉。完整輸出保證仍有 F5。 |
| F4 原案例 | 沒有 app 寫入、close 自己丟 TypeError 時已拒絕；新測試也涵蓋有 app 寫入的情況與 onError 的其他 write 錯誤。 |
| read 的純量投影 | path、props、unit 的 code／name、target、problem、today、fingerprint、conflict 的已存在元素均有型別檢查，沒有再用真假值或 ?? 將異型純量換成合法預設。問題在集合空洞跳過 callback，見 F5。 |
| 作答元素與 replay 記憶不查 | 可保留：前者交給同版 replay、後者交給同版 dueAt，adapter 不自行解讀其內部欄位；不能因此宣稱已驗證該版排程算法本身正確。 |
| input、today、item、slot 的其餘欄位不查 | 可保留：這裡不投影的部分交回同版 nextCard。實際投影的 ID、路徑、lane、retention、方向與指紋仍有檢查。 |
| ready 的完成值 | 未使用，可以不驗其內容。 |
| state.conflicts 缺席 | 維持明列能力限制；本輪已改為只把 undefined 視為缺席，null 等其他假值不再被偷偷當成沒有該方法。 |
| 正常分類、單元、寫錯的目標 | 自編 5 篇卡組包含兩個分類、只有編號沒有名稱的單元 L1、寫錯／無 ID／暫停的目標；真正 v0.1.0、v0.2.0 與目前版本都通過。unit 投影為 L1，分類保持兩個字串，既有錯誤碼仍可投影。 |
| 轉錄稿、草稿、暫停 | 三版均通過；轉錄稿 isTranscript 為 true，草稿與暫停的 status 保持 draft／paused，沒有被這次檢查誤擋。 |
| refusal 物件身分 | 對真正 v0.1.0、v0.2.0 與目前版本，直接以自編唯讀 Files 的同一個 Error 拒絕 append；每版均嘗試 2 次，onError 與 close 收到的都是原物件。未發現所驗三版會合法地包裝該拒絕而被誤擋；未來版若包裝則依請求當成無法比較。 |

### 本輪驗證紀錄

- 指定 worktree、Windows、Node `v24.13.0`，沙箱外 `npm run check`：exit 0，**1061／1061 通過**，fail／cancelled／skipped 均為 0，約 197 秒；compare 測試 14 項。新增正例有獨立字面預期與 JSON 往返斷言，但尚未涵蓋 F5 空洞。
- 真正 v0.1.0、v0.2.0 與目前版本，各跑 5 篇自編卡組、完全空輸入、已有 compare 版本行三種輸入，共 9 組正例全過；正常輸出的 JSON 往返相同。另以 10/20 good 的獨立字面值核對下次到期 `2026-10-27T20:00:00Z`。
- 原 F3 兩例及 F4 無寫入的 close 拒絕另行重跑，全被擋下。三版 refusal 物件身分另以公開 createState 驗證，沒有靠本版型別宣告推斷舊版行為。
- 隔離資料暫存在 `C:\Users\kuo\AppData\Local\Temp\essence-l2-gates-r4-1lyI9Q`：`input.json`、`hole-output.json`、`results.json`、`hole-conflicts-results.json`。上文已有重現條件，不依賴暫存檔長期存在。全部使用自編資料及暫存複本／clone，node_modules junction 重用現有安裝，未讀正式 vault。
- 本輪只在同一份報告後追加本節，未改產品程式、測試、任務或 roadmap，未 commit／push。

未測項目與原因：未重審前三輪未改的功能；未重跑實作者的 58 處改壞測試（本輪核對原重現、投影及新陣列邊界）；未跑 CI、各版重新 npm ci、update-vault 接線、正式 vault／Obsidian／iPhone、安裝或升版（只做第四次審查）；未驗證未來版本的拒絕包裝方式、明確延後的 exam 或任意未來版全部行為。

## Claude 回應 Codex 第四次審查（2026-11-02）

**F5：接受，已修（`f8e1a4c`）。** 請求裡寫的「比較資料裡只有查過的值」又不成立：`some` 和 `map` 跳過空洞，元素根本沒查到。所有清單都經過 `array`，所以在那裡修：逐格複製成一般陣列，空的格子直接拒絕。子類別的 `toJSON`、多的屬性也不會留下來。Codex 的三個重現都有回歸例子，分類與完全空白輸入的 `conflicts` 另外走命令列。

**不再逐項補（`f8e1a4c`、`b9143d4`）。** 五項發現有四項（F1、F2、F3、F5）都是「又一個值沒查到」，靠審查者想到新的值太慢，也讓使用者多跑很多輪。所以把它變成測試：假的版本回傳每一個值，84 個位置各換成 33 種不對的值，共 2,772 種。結果要嘛被拒絕，要嘛種類對、形狀對、經過 JSON 不變。唯一的例外是假版本裡交回同一版處理的兩個位置（作答紀錄的元素、`replay` 算出的記憶）。

修之前它抓到 26 個漏網，全部是下面兩類，純量位置一個都沒有：

- **清單本身**（25 個）：就是 F5，再加上子類別、`toJSON` 與多的屬性。
- **ID 叫 `__proto__`**（1 個）：見下面 `60ee87e`。

**同一輪另外修的兩項，Codex 沒有報：**

- `60ee87e`，ID 當物件的 key。轉接器指定 `due[id]` 時，`__proto__` 留不下 key，那個目標的到期就不見了；現在的語法寫不出這個 ID（不接受底線），只有回傳它的版本才會發生。比較端讀 `due[id]` 時，只在一邊的 ID 會取到每個物件都有的函式；語法寫得出 `^constructor`，實跑 `formatTime` 丟 `RangeError`，整個比較停掉，報不出差異（不是零差異）。
- `93394cd`，比較端當 key 的值重複。比較端用 `Map` 放卡組、衝突與今天的份，同一個路徑出現兩次只比得到最後一個。實跑 `diffSnapshots`，一邊同一篇列兩次，回傳空的差異，**這是假的零差異**。現在轉接器看到路徑、衝突的 ID、今天的學習目標重複就報無法比較。目標的 ID 不在內：備份照原樣收重複的 ID，比較端每一個都比（Codex 第二輪 L2）。

**驗證（`93394cd`）：**

- 完整檢查全過（pre-commit 跑的）。compare 測試 16 項。
- 改壞測試：一共 68 處，全部抓到，當掉 0 處。腳本先跑基準，每處跑完把檔案改回原樣。
- 新測試單獨跑抓到 54 處，沒抓到 14 處。其中 10 處是別的測試的範圍（`close`、`onError`、拒絕的物件、`done`、空格子的原因文字、重複的三處、比較端兩處）；另外 4 處（`today` 的 `lt`、`replay`、`slots`、`slot`）拿掉後下一行還是會丟錯，只差原因的文字。
- 真正的 `v0.1.0`、`v0.2.0`：自編的輸入（有內容、完全沒有內容）與測試 vault 的 5 篇、62 個目標都接得上，和現在差異 0 項（手動跑的，只讀）。
- 同一份凍結的備份比 `v0.2.0 → 93394cd`：差異 0 項（兩個紀錄檔，沒有卡組）；報告不進 repo。
- 沒有跑：CI（沒有 push）；`update-vault --check` 實際走新轉接器（要升版才會跑）。

## Codex 第五次審查

狀態：待修（F5 原重現已修；比較端另有 2 項 P2，F6、F7）

### 範圍與結論（2026-11-02）

依任務〈第五次審查〉聚焦 `1d73cb28f24edef3760b847cf928bf039cb6c445 → 93394cda62dbad09e82708f47e7079fa9959ff3b`，不重審前幾輪未變的功能。工作目錄及分支同前，開始時乾淨；實測 HEAD `7e3e1a28fee00830cb53bb2bc1974df6222784b9`，已確認 `git diff 93394cd HEAD -- src tools tests .github` 為空。下文位置均指分支 `claude/fervent-hodgkin-9c2bca` 的對應檔案（`93394cd`）。

F5 的三個原重現都已拒絕；逐格複製、特殊物件 key、跨 share／more 去重，在本輪所測案例中符合預期。新的 2,772 組測試提供了型別與 JSON 契約的固定防線，但不涵蓋「兩份合法形狀的快照如何配對與比較」。針對任務特別要求的假零差異，再找到 F6、F7。

**影響範圍先說清楚**：以下兩個反例的 ID 含目前卡組語法不接受的字元，不能宣稱它們已影響現有合法卡組。它們來自兩個隔離假版本，回傳值均通過目前 adapter；本輪又明確選擇 ID 只查字串、不依賴語法保證（例如 __proto__）。因此這是已接受介面值的比較漏口，與已部署版本的實際發生率分開看。

### F6｜P2｜規格：今天順序以分隔符串接，兩個不同順序可編成同一字串

**證據：已重現，兩個假版本各經 snapshot 與 CLI 成功輸出。**

**位置**：`tools/compare/snapshot.ts:145`～`:147`。

**觸發條件**：同一篇卡組有兩個不重複的字串 ID：`a`、`a,share:a`。兩邊卡組、到期、題目、保持率、方向與 days 全部相同，兩個目標都在 share；唯一差別是今天的順序：

```text
舊：a → a,share:a
新：a,share:a → a
```

兩邊都符合新加的 today ID 唯一性檢查。但 `list + ':' + lt` 再用逗號串接後，兩邊都是 `share:a,share:a,share:a`。後面的 Map 按 ID 比欄位時，每個目標的內容又都相同。

**預期／實際**：應報今天的份順序不同；實際 `diffSnapshots` 回 `[]`。獨立 CLI 輸出兩邊都是 `ok: true`，JSON 往返後仍回 `[]`，不是僅繞過轉接器直接塞錯型別。新增 unique 無法擋住這種碰撞，因為 ID 本身沒有重複。

**建議：合併前修。** 對 `[list, lt]` 的有序 tuple 清單做結構比較，例如 JSON 編碼整份 tuple 陣列；不要用未跳脫的分隔符代表結構。補這個順序交換的成對測試，確認不改其他欄位也會報差異；保留一般 ID 與 share／more 移動的正例。

### F7｜P2｜規格：替代 key 可和字串 ID 相同，id 欄位沒有另外比較

**證據：已重現，兩個隔離假版本都通過 snapshot。**

**位置**：`tools/compare/snapshot.ts:122`～`:130`，特別是 `:129` 的欄位清單沒有 id；adapter 對無 ID 目標產生的 key 是 `@<line>:<name>`。

**觸發條件**：同一篇的兩個目標如下；其他欄位都維持相同：

| 目標 | 舊 id | 新 id | 兩邊 key |
|---|---|---|---|
| 第 0 行、名稱 A | null | `@0:A` | `@0:A` |
| 第 2 行、名稱 B | `@0:A` | `@0:A` | `@0:A` |

兩邊都由讀取紀錄的閘門停掉 `@0:A`，所以 due 都是 `{ "@0:A": "stopped" }`、today 都空；兩個假版本都沒有 conflicts 出口，依約列為能力限制。目標 ID 的重複本來就允許進比較資料，新 unique 不應直接拒絕這類目標。

**預期／實際**：A 從沒有 ID 變成有 ID，應報出 ID 的變化。實際按 key 分組後兩邊都是兩個元素，name／line／ok／fingerprints 等也相同，因為沒有比較 id，`diffSnapshots` 回 `[]`。這不是物件 key 被原型蓋掉，而是 key 的編碼不能完全代替原 id 欄位。

**建議：合併前修。** 在同 key 的逐目標欄位比較中包含 id，或明確區分真實 ID 與無 ID 替代 key 的命名空間；前者即可攔下本例，無須把合法備份中的重複目標 ID 全部拒絕。補「另一個目標已占用同名 key、due／today 沒變、只有 null → ID」的回歸例子。

### 新測試與這輪自選做法核對

| 項目 | 本輪回覆 |
|---|---|
| 逐格複製與 undefined | 原分類、題目、空輸入 conflicts 的稀疏陣列均拒絕；普通空陣列仍合法。建立一般陣列也避免保留來源的 toJSON、額外屬性或 Array 子類別。未找到這段的新 JSON 漏口。 |
| 33 種值與 kind | 所列原始型別、容器、包裝值及序列化異常值有區分。`{}` 與正常物件同 kind、`[]` 與正常陣列同 kind 並不等於自動通過：前者還會在欄位投影被拒絕，後者若是合法空清單可接受，成功結果另查 shape 與 JSON 往返。這套檢查能驗型別邊界，不能宣稱涵蓋任意 JS 物件或所有成對比較，F6／F7 就是後者。 |
| OPAQUE 的兩個位置 | 沒有發現多放：reviews 的元素交給同版 replay，replay 的記憶交給同版 dueAt，adapter 不解讀其內部。其餘 input／today 的未讀部分同樣由同版 nextCard 使用，不必藉這項測試重寫內部規則。 |
| ID 當物件 key | Map 再 Object.fromEntries 保留特殊 own key；diff 端 Object.hasOwn 避免把缺少的 constructor 當成繼承函式。真正語法的 constructor 與三版輸出已驗，未見誤擋。 |
| unique 的範圍 | 卡組路徑、衝突 ID、整份 today 的 lt 去重合理。額外實測同一 lt 分別出現在 share／more 會拒絕；正常 120 個 share＋3 個 more 不會誤擋。目標的重複 ID 仍保留，D-157 將其 due 停掉，沒有被 unique 當成整個輸入無法比較。 |
| blocked 兩份清單不拒絕重複 | 目前 diff 以是否存在判斷，次數不表示另一種阻擋能力；未因此另報發現。 |
| 新測試的預期與例外 | fakeSnapshot 有具體字面預期，正常基線必須通過，不能全部拒絕來假通過；新增欄位也會受這份基線約束。尚缺同型別資料在兩份快照間的變化測試，應以 F6／F7 的小型成對案例補上，不需要再增加一輪型別值清單。 |

### 本輪驗證紀錄

- 指定 worktree、Windows、Node `v24.13.0`，沙箱外 `npm run check`：exit 0，**1063／1063 通過**，fail／cancelled／skipped 均為 0，約 133 秒；compare 測試 16 項，含新的 2,772 組值替換測試。
- 真正 v0.1.0、v0.2.0 與目前版本，各跑 123 個自編新目標、完全空輸入、合法 constructor ID 共 9 組；全部通過。每版的 123 個目標都是 share 120、more 3、lt 不重複，成功快照 JSON 往返相同；兩個舊版與目前版本的比較差異為 0，未因新 unique 誤擋。
- F5 三個原重現另行重跑，全拒絕；跨 share／more 的同 lt 重複另行重現，拒絕。真正相同目標 ID 重複的備份仍保留兩個目標並將 due 記 stopped。
- F6 兩個假版本均經 CLI；F7 兩個假版本均經公開 snapshot。反例只用自編內容、隔離資料夾，未動正式 vault。
- 暫存證據：F6 在 `C:\Users\kuo\AppData\Local\Packages\sandbox.{87173b02-c895-4a48-8416-cc3dd338c799}\AC\Temp\essence-l2-gates-r5-KAeH1e`（before.json、after.json、results.json 與兩份假版本）；F7 在 `C:\Users\kuo\AppData\Local\Packages\sandbox.{777f6586-4880-4163-807e-022c1208c4c3}\AC\Temp\essence-l2-key-alias-iLPIg6`（results.json 與假版本）。正例與去重證據在 `C:\Users\kuo\AppData\Local\Temp\essence-l2-gates-r5-positive-ijkKb6\results.json`。上文已保留重現條件，不依賴暫存檔長期存在。
- 本輪只在同一份報告後追加本節，未改產品程式、測試、任務或 roadmap，未 commit／push。

未測項目與原因：未重審前幾輪未改的功能；未重跑實作者的 68 處改壞測試（本輪跑完整檢查及新的成對比較反例）；未跑 CI、各版重新 npm ci、update-vault 接線、正式 vault／Obsidian／iPhone、安裝或升版（只做第五次審查）；未驗證請求已列出的多變 getter／Proxy、任意 Map 子類別或明確延後的 exam。

## Claude 回應 Codex 第五次審查（2026-11-03）

**F6：接受，已修（`f1523e1`）。** 今天的順序改成比 `[list, lt]` 的結構，不再用分隔符接成字串。

**F7：接受，已修（`1077e1a`）。** `id` 加進逐目標比較的欄位。沒有換 key 的命名空間：同一組裡每個欄位都逐個比，替代 key 和別的 ID 相同時，分在同一組也比得出來。

**Codex 說的缺口（`1077e1a`）。** 2,772 組測試只管型別，不管兩份合法的比較資料比不比得出來。所以補了對應的測試：比較資料的每個值各改一次、每份清單各少一筆，兩個方向都要報。修之前它只抓到 `id`，其他欄位都比得到。這個測試抓不到兩個不同的值編成同一個的情況，那要靠成對的例子，所以 F6、F7、單元、問題各有一組。

**照 F6、F7 的方向再找，另外修了兩項，Codex 沒有報：**

- `352bebf`，單元與問題也是接成字串比。`L1 Back` ＋ `to School` 和 `L1` ＋ `Back to School` 接起來一樣。**這一項不需要奇怪的 ID**，解析單元的切法變了就會發生。比較資料的形狀因此改了；兩邊都由同一份轉接器產生，沒有相容問題。
- `3c6cd96`，卡組同時被擋下又有內容。比較端兩邊都擋下就不比內容，一邊有內容、目標又沒有 ID 時，實跑回傳空的差異。現在轉接器報無法比較；真正的 `v0.1.0`、`v0.2.0` 與現在都不會同時列在兩邊（實跑過）。

**影響範圍：** 同意 Codex 的說法。F6、F7 的 ID 現在的語法寫不出來（只接受英數字與連字號），真實卡組今天碰不到。還是修，因為轉接器接受這些值，修法也只有幾行。

**驗證（`3c6cd96`）：**

- 完整檢查全過（pre-commit 跑的）。compare 測試 19 項。
- 改壞測試：一共 90 處（這次加上比較端逐欄位不比），89 處抓到，當掉 0 處。沒抓到的是「順序接成字串」，是我那一處改壞的寫法錯了：巢狀陣列 `.join` 不會碰撞。改回 F6 原本的寫法，回歸例子抓得到。
- 真正的 `v0.1.0`、`v0.2.0`：自編的輸入（有內容、完全沒有內容、需要新版的卡組）與測試 vault 的 5 篇、62 個目標都接得上，和現在差異 0 項（手動跑的，只讀）。
- 同一份凍結的備份比 `v0.2.0 → 3c6cd96`：差異 0 項（兩個紀錄檔，沒有卡組）；報告不進 repo。
- 沒有跑：CI（沒有 push）；`update-vault --check` 實際走新轉接器（要升版才會跑）。

## Codex 第六次審查

狀態：再審通過（`3c6cd96`；F6、F7 已修，本輪無新增發現）

### 範圍與結論（2026-11-03）

依任務〈第六次審查〉核對 `93394cda62dbad09e82708f47e7079fa9959ff3b → 3c6cd96a3877cfc546cb0afcabefcf3076f960a7`，只審本輪修正及相鄰案例。工作目錄及分支同前，開始時乾淨；實測 HEAD `47ee0069d76ddde8c71e458384566e911f3f8e43`，已確認 `git diff 3c6cd96 HEAD -- src tools tests .github` 為空。下文程式位置均指分支 `claude/fervent-hodgkin-9c2bca` 的對應檔案（`3c6cd96`）。

**本輪未找到需再修正的發現。** F6、F7 的原反例現在都能報出差異；單元／問題改成結構後沒有再丟掉欄位邊界；擋下又帶內容的矛盾輸入會拒絕，真正舊新版的合法輸入未被誤擋。此審查結果可交整合者核對並合併；不代表已升版、已在正式 vault 安裝或已跑 CI。

### 修正與相鄰案例核對

| 項目 | 結果與影響範圍 |
|---|---|
| F6：今天的順序 | **已修。** 比較 `[list, lt]` 的陣列結構，不再使用未跳脫的分隔符。原 `a`／`a,share:a` 交換順序，正反向各報 1 項；另以 10 個字串 ID 的 45 種兩兩換序核對，全部報差異。原特殊 ID 反例屬於「只有假版本回傳才走得到」；一般合法 ID 與 share → more 的移動也驗過。 |
| F7：替代 key 相同但 id 改變 | **已修。** 逐目標比較包含 id；原 null → `@0:A`、另一個目標已使用同名 key、due／today 不變的反例，正反向各報 1 項。原特殊 ID 屬於「只有假版本回傳才走得到」，沒有擴寫成現有真實卡組已受影響。 |
| 單元欄位分開 | `{ code, name }` 原樣投影，兩邊由同一個 adapter 產生。`L1 Back`＋`to School` 與 `L1`＋`Back to School`，正反向各報 1 項，不再因接起來相同而漏掉。真實 v0.1.0／v0.2.0／目前版本的只有編號、空名稱單元，也都輸出 `{ code: 'L1', name: '' }`。語法可提供單元內容，但本輪沒有觀察到這三個真實版本實際採用不同切法；切法碰撞用合成快照驗證。 |
| 問題欄位分開 | 保留 line／level／code，分組用結構的 JSON，次數仍保留。兩種文字接起來相同的切法，正反向各報少一項、多一項；顯示文字相同是已明列的呈現限制，差異不再是零。真實三版的 missing-answer 均為 `{ line: 1, level: 'error', code: 'missing-answer' }`，沒有因資料形狀改變而漏比。 |
| 被擋卡組又有內容 | adapter 在比較前拒絕交集，不依賴目標有 ID 或 due 能不能比出來。額外用只有無 ID 目標的矛盾版本重現，確實拒絕。此矛盾例屬於「只有假版本回傳才走得到」；真正三版的需要新版卡組都只在 gates、不在 decks，同篇 ID 出現在可讀卡組時仍正常停掉，沒有誤擋。 |
| 配對與 key | 卡組／衝突／today 的唯一性檢查保留；重複目標 ID 仍按組保留並逐個比較。due 使用 own key；today 的有序 tuple 比較涵蓋 lt／list，其餘 today 欄位按 lt 比；target 已涵蓋 id 與所有投影欄位；unit／problem 不再自行用分隔符編碼。本輪未再找到新的配對或編碼碰撞。 |
| 新增成對與逐值測試 | 正常基線必須零差異；每個投影值變動、清單少一筆，正反向都要報。F6／F7、unit／problem 另有明確的成對反例，補足只換單一值無法涵蓋的編碼碰撞；沒有把這項測試當成對任意未來資料的完全證明。 |

完成條件按前幾輪已約定的比較語意解讀：路徑／ID 分組不把純列舉順序當變化，held／被擋卡組清單看成集合，問題保留多重次數；conflicts null 對空陣列可不列差異，但報告必須保留能力限制；兩邊都讀不懂的卡組不宣稱已比較內容。這些已明列的情況不因「形狀合法、內容不同」的字面措辭而變成新發現。

### 獨立驗證紀錄

- 指定 worktree、Windows、Node `v24.13.0`，在沙箱外執行 `npm run check`：exit 0，**1066／1066 通過**，fail／cancelled／skipped 均為 0，約 144 秒；compare 測試 19 項，型別、ESLint、knip、secretlint、skill 一致性及文件檢查一併通過。
- 額外重跑 F6、F7、unit、problem、share → more 五組成對案例，兩個方向都報差異，共 10 次；另驗 45 種字串 ID 換序，全部報差異。
- 真正 v0.1.0、v0.2.0 與目前版本，各跑「5 篇自編卡組與紀錄」「完全空輸入」「需要新版卡組與可讀篇同 ID」三組，共 **9 組正例全過**；兩個舊版分別與目前版本比較，這三組均為 0 差異。這是內容確實相同的固定輸入，不是以正式 vault 的空卡組結果取代非空驗證。
- 正例具體斷言包含：單元 `{ code: 'L1', name: '' }`；missing-answer 的 line／level／code；10/20 good 的下次到期 `2026-10-27T20:00:00Z`；需要新版的 C.md 不進 decks，可讀 A.md 同 ID 的 gat111 為 stopped，today 只保留 aaa111。正常非空快照的 JSON 往返相同。
- 額外在隔離複本把 A.md 同時列為 blocked 與可讀，A.md 只有無 ID 目標，snapshot 仍拒絕並指出被擋卡組矛盾。
- 探針結果在 `C:\Users\kuo\AppData\Local\Temp\essence-l2-gates-r6-VL7wCg\results.json`。全部使用自編內容及隔離複本／舊版 clone，沿用已安裝的 node_modules；未讀正式 vault。
- 本輪只在同一份報告後追加本節，未改產品程式、測試、任務或 roadmap，未 commit／push。

未測項目與原因：未重審前幾輪未改的功能；未逐項重跑實作者的 90 處改壞測試（本輪重跑完整檢查與原成對反例）；未跑 CI、各版重新 npm ci、update-vault 接線、正式 vault／Obsidian／iPhone、安裝或升版（本輪只做第六次審查）；未驗證前述多變 getter／Proxy、任意 Map 子類別或明確延後的 exam。
