# 發布前比較接上讀取閘門：Codex L2 審查（2026-11-02）

狀態：待再審（F1 修在 `a04998e`，報告的措辭修在 `f33f376`；見文末〈Claude 回應〉與[審查請求](../tasks/compare-gates-review.md)〈再審〉）

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
