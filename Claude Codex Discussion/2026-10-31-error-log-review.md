# 正式版錯誤紀錄與複習畫面回報：L2 審查（2026-10-31）

狀態：R1～R4 已修、R1 再審通過；再審的 F1～F4 已修（`5835185`），待再審；本報告未代表使用者同意合併或延後

審查者：Codex，未參與這批實作。依 `tasks/error-log-review.md` 與 `code-quality/review.md` 做獨立審查。只新增本報告，未改產品程式、測試、任務說明，未 commit、push 或操作 vault。

## 結論與基準

**發現三項 P2、一項 P3，均已用自編資料重現。建議 R1～R3 修正並補回歸驗證後再合併。** 完整 `npm run check` 雖然通過，現有測試仍漏掉這些組合。

- worktree：`D:\程式開發\Essence-Cards-error-log`；分支 `claude/error-log`。
- 待審 HEAD：`5018f18589325fadfb997b163317d4c3df1f114b`。開工與寫報告前再次核對均相同。
- 基準與共同祖先均為 `eda8739b3a0b256ba55653761aa3d67ae9c41371`。
- 審查差異：`git diff eda8739...claude/error-log`，44 個檔案，1,963 行新增、95 行刪除。開工時 `git status --porcelain=v1` 為空。
- 規格優先順序：任務說明 §1～§8 與限制、D-155／D-160、syntax.md §0／§5／§9、2026-10-29 錯誤紀錄討論稿的 Codex P3～P7 與 Claude 回應。另核對 roadmap「現在在哪裡」、專案品質設定與合併帶入的備份接點。
- 下列產品與工具位置均指**分支 `claude/error-log` 的指定檔案（`5018f18589325fadfb997b163317d4c3df1f114b`）**；行號為該版本。

## 發現

### R1［P2／規格］回報選單沒有隔離焦點，開著時仍能改動打字卡

- **位置**：`src/ui/Review.tsx:364–370` 的 `ReportMenu`；相關呼叫端為 `src/ui/host.tsx:43–51` 的全畫面 Tab 處理，以及 `src/ui/Review.tsx:445` 的輸入框。
- **依據**：任務 §8（`tasks/error-log.md:125–126`）、D-160 第 3 點：選單開著時按鍵不作用，回報前後卡片的步驟與已打的字不變。
- **觸發條件**：打字卡開旗子選單後按 Tab。選單只有 `aria-modal="true"`，背後控制項仍可取得焦點；host 的 Tab 清單也仍涵蓋整個複習畫面。
- **預期／實際**：Tab 應只走選單選項與取消；實際依序到「自動朗讀」、旗子、「結束複習」、背後的輸入框。此時輸入 `z`，選單仍開著，`session.view().card.typed.input` 從空字串變成 `z`。輸入框的 `onChange` 直接呼叫 `session.input`，不經 `held()`。
- **影響**：使用鍵盤或輔助操作時會誤改正在回報的卡片；背景的結束按鈕也仍可取得焦點。攔截 `onKey` 的快捷鍵不能阻止瀏覽器的預設焦點與輸入行為。
- **證據：已重現**。Windows、Chrome `156.0.8078.76`、真實 React／DOM／原本的 `openReview`、`Review`、state、session；Obsidian 的 Notice、Markdown 與朗讀使用替身。用 Chrome DevTools Protocol 送真正的 Tab 與文字輸入，沒有呼叫 `session.input` 來模擬打字。最小卡組：

```text
---
科目: 英文
單元: L2
---
- go 中翻英 ^g1
    - I ＿＿ yesterday. :: went
```

重現記錄：

```text
打開選單：activeElement = .ec-report-sheet，dialog = true，input = ""
Tab × 1：activeElement = 自動朗讀的 checkbox
Tab × 2：activeElement = 回報問題按鈕
Tab × 3：activeElement = 結束複習按鈕
Tab × 4：activeElement = .ec-input
輸入 z：dialog = true，input = "z"
```

隔離 HTML 留在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-dom-l2-wxC5JA\case.html`；沒有使用 Obsidian 或真實 vault。現有 `tests/helpers/review-ui.ts` 明列不模擬真實焦點，因此其 §8 測試通過不能排除此問題。

**建議處理：合併前修。** 選單開著時，把 Tab／Shift+Tab 的範圍限制在選單，讓背景控制項不可互動；關閉後還原適當焦點。用真實 DOM 驗證至少「Tab 不離開選單、不能改字、不能結束複習」，並保留原有的卡片狀態測試。

### R2［P2／規格］初始化已經出錯後立即 close，真正的錯誤仍會漏報

- **位置**：`src/state/index.ts:390–393`，尤其 `if (!life.closed && !queueFailed)`。
- **依據**：任務 §2-3（`tasks/error-log.md:79`）：除了由 `close()` 導致的拒絕，每一條讓 `ready()` 拒絕的路都恰好經過一次 `onError`。
- **觸發條件**：`files.watch()` 同步拋出程式錯誤；呼叫端在同一輪立即 `close()`，早於 `ready()` 外層 catch 的微任務。
- **預期／實際**：`ready()` 拒絕的原因仍是 `watch-crash`，應記一次 `init`；實際 `life.closed` 已變成 true，錯誤被當成正常關閉而略過，`onError` 為零次。
- **影響**：初始化故障與停用交錯時，這次專門補的故障證據仍會消失。關閉狀態只能說明「現在已關閉」，不能證明「拒絕是關閉造成的」。
- **證據：已重現**。從 worktree 根目錄用 Node 執行下列探針，只使用記憶體 Files：

```javascript
import { createState } from './src/state/index.ts';
import { createMemoryFiles } from './tests/helpers/memory-files.ts';

const memory = createMemoryFiles();
const errors = [];
const state = createState({
  files: { ...memory.files, watch() { throw Error('watch-crash'); } },
  device: 'PC-test',
  fillIds: false,
  onError: (error, source) => errors.push([source, error.message]),
});
const ready = state.ready().catch(error => error.message);
await state.close();
console.log(await ready, errors);
// 實際：watch-crash []
// 預期：watch-crash [['init', 'watch-crash']]
```

另驗「只有 close」仍為零次回報；「一篇讀不到，接著首次排程拋 `plan-crash`」得到 `read`、`init` 各一次，這個組合沒有重複或漏報。

**建議處理：合併前修。** 區分真正由關閉造成的取消與已發生的初始化例外，不用 catch 執行當下的 `life.closed` 代替原因判別。補上 watch 已拋錯、同一輪 close 的回歸案例；原有正常 close 的零回報與讀取錯誤不重報也要維持。

### R3［P2／規格］自身 frame 的篩選也接受錯誤訊息行，會收進其他外掛的錯

- **位置**：`src/core/errors/log.ts:46`、`:77–85`；主機 `src/main.ts:93–94` 用同一個 `hasOwnFrame` 決定是否收 window 錯誤。
- **依據**：任務 §1／§2-4（`tasks/error-log.md:48、85`）、D-155 第 2 點、syntax.md §9 的 `stack` 與「不記」：只保留自身程式位置，只收有自身 frame 的全域錯誤。
- **觸發條件**：別的外掛錯誤的訊息剛好含 `plugin:essence-cards:行:欄`，真正的 frame 都屬於別人。
- **預期／實際**：應判定沒有自身 frame、不收進補網。實際 `ownFrames` 對 stack 的每一行做未錨定的子字串匹配，連 `Error: …` 訊息行也算一層；`hasOwnFrame` 回傳 true，並將該訊息行存成 `stack`。
- **影響**：錯收本外掛以外的訊息、占用月配額，保存的 `stack` 也不是可定位的 frame；不符合採用補網前約定的篩選界線。
- **證據：已重現**。自編的錯誤：

```javascript
const error = new Error('other-plugin cannot fetch plugin:essence-cards:1:20345');
error.stack = [
  'Error: other-plugin cannot fetch plugin:essence-cards:1:20345',
  '    at fetcher (plugin:other-plugin:4:5)',
  '    at app://obsidian.md/app.js:6:7',
].join('\n');
// hasOwnFrame(error) === true
```

以公開 `hasOwnFrame` 篩選再交給 `createErrorLog.record('uncaught', error)`，記憶體 Files 實際多出一行；其 `stack` 為 `Error: other-plugin cannot fetch plugin:essence-cards:1:20345`，沒有任何自身呼叫 frame。

**建議處理：合併前修。** 比對 frame 的來源位置，不把訊息文字當 frame；保留 Chrome／Electron 與 WebKit 的支援。新增「訊息含自身位址、frame 全是別人」的反例，並保留 `plugin:essence-cards-x:`、正常自身 frame 與 WebKit 寫法的既有案例。

### R4［P3／規格］locate 對超出產物範圍的行欄回傳錯誤位置

- **位置**：`tools/locate.ts:47–52`。
- **依據**：任務 §6（`tasks/error-log.md:110`）「對不上就停，說明原因」。
- **觸發條件**：正式產物與 map 的雜湊都正確，但輸入的行大於 `main.js` 的行數，或欄大於指定行的長度。
- **預期／實際**：應拒絕不可能的產物位置。實際只檢查行、欄 ≥ 1；`SourceMap.findEntry` 會沿用之前的 mapping，結果含 `originalSource` 就被接受。
- **影響**：抄錯位置時會得到看似確定的原始碼行，增加查錯時間；沒有破壞產品資料。
- **證據：已重現**。在隔離暫存目錄以這次 HEAD 的真實產物建立 `releases/9.9.9/`，保存兩個正確 SHA-256 後呼叫公開 `locate`：

```text
locate('9.9.9', ['999999:1'], local)
→ src/main.ts:270:1，text = "}"

locate('9.9.9', ['2:999999999'], local)
→ node_modules/yaml/browser/dist/doc/directives.js:170:27
```

產物留在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-l2-LpoXcZ\releases\9.9.9\`。這是自編的測試版本，不是安裝紀錄。

**建議處理：可登錄技術債，尚未代為登錄。** 觸發點：第一次用 locate 維修真實回報，或下一次修改 locate，以先到者為準。完成條件：依已核對雜湊的產物確認行欄是有效整數且在範圍內，超出行數／行長的輸入明確拒絕，合法位置與完整 frame 的定位維持通過。若本輪修，補兩個越界案例即可。

## 其他核對與範圍差異

| 範圍 | 本輪核對結果 |
|---|---|
| 記錄器 | 核對轉文字、UTF-8 截斷順序、500 個去重鍵、50 筆等待上限、月份讀取共用、讀不到停寫、append 前預留名額、limit 與 report 共用配額。除 R3 外未找到新的規格落差；相關測試通過。 |
| 作答與生命週期 | 記錄器未加入作答 writer、flush 或 close；這幾處差異沒有改作答寫入順序。初始化另有 R2。 |
| 接線 | 核對單一記錄器、fail、React root、Markdown 含背面補充、事件移除與重新啟用測試；補網的 frame 判斷有 R3。 |
| Files | createFolder 失敗後重新查詢，只有 TFolder 才沿用；C17 與不是資料夾／權限錯誤的測試通過。實機訊息依任務既有結果，這次未重跑 Obsidian。 |
| 還原 | 排除寫在 listed，isLogPath 未擴大；錯誤檔的缺失、衝突與新增情況不列入，AI 輸出及複習紀錄仍有原本的測試保護。 |
| 正式安裝與建置 | 真實建置加／不加 map 的 main.js 逐位元組相同測試通過；map 與雜湊保存、不裝入 vault、舊版本無 map 的退回測試通過。合併的 desktopOnly 與 sourcemap 都保留。 |
| locate | 正常定位、main.js／map 雜湊不符、缺 map 的測試通過；靜態核對 .dirty 拒絕。另有 R4 的越界輸入。 |
| 回報畫面 | 回報卡組／lt／v、回看、打字狀態、選單期間自動換卡與背景超時的現有測試通過；真實焦點有 R1。 |

指定 diff **還包含另一個議題的已提交文件**：`f16e0c1`、`dd056eb`、`1f55713`、`ece35fa` 修改的獨立 App／不用 iCloud 同步規劃，涉及 `Claude Codex Discussion/2026-10-29-standalone-phone-app.md`、`docs/plans/standalone-app.md`，以及 backlog／roadmap。前兩個檔不在本任務限制第 1 點的可修改清單內，因此審查請求所說「只有這個任務的改動」不精確。已核對它們是文件與狀態修改，沒有混入同步產品程式；建議整合者合併前明列這四個 commit 的來源與既有授權，或將該議題另行整合。本輪未替這個同步設計做新的設計審查。

## 審查請求的兩個待決問題

1. **備份錯誤是否接進紀錄**：建議接，但交使用者決定，不當成這次新引入的回歸。D-155 第 2 點要明確交出自身接住的錯誤；任務 §2-1 的舊接線清單沒有涵蓋合併進來的備份，因此存在規格整合缺口。可把「載入桌面備份功能失敗」記為 init，把執行備份失敗用獨立環節（例如 backup）表示，避免把每月／手動備份都標成初始化。接 startBackup 時須區分其 await state.ready() 已經上報的失敗，不能再複製一筆；runner 的 failure 已轉成狀態，應在失敗產生處或接線集中記一次，不在設定頁每次 refresh 都記。未經使用者同意，不在本輪擴充來源或修改實作。
2. **寫不進去仍提示「已記下」**：D-160 已明列接受的代價，這次實作符合；不另列缺陷，不建議為此增加等待寫入或改提示。

## 驗證紀錄

- Windows、Node `v24.13.0`，在上述完整 SHA 上執行 `npm run check`。**exit 0；typecheck、ESLint、knip、secretlint、skill 副本、文件與測試全部通過；858 tests、858 pass、0 fail、0 skipped。** 測試階段約 144 秒。
- 完整檢查依 quality.md 在沙箱外執行，輸出留在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-l2-check.txt`。一開始沙箱內的 Git status 出現工作樹／權限錯誤；沙箱外已確認乾淨，這不是產品測試失敗。本輪沒有用環境失敗抵作通過。
- 另外執行本報告 R1～R4 的隔離探針；R1 使用真實瀏覽器焦點與輸入，其餘使用公開介面與自編資料。R2 的讀取失敗加首次排程失敗、正常 close 也另行核對。
- `npm run check` 包含真實建置／安裝／定位測試；另外給 R4 建置到暫存資料夾的一次產物為 557,765 bytes，BUILD `0.1.0+5018f18`，require 仍為原三個 Obsidian／CodeMirror 模組，加上 D-148 限定的桌面模組。
- 本報告新增後另外做文件格式檢查；原工作樹及隔離 Git fixture 中的本報告均通過。報告保留為未提交新檔，交 Claude 核對與後續處理。

未測：Windows Obsidian 與測試 vault 的 error-probe／files 未重跑（審查請求明示可沿用實作者結果，原結果檔不在 repo）；iPhone、觸控滑動、iPhone 寬度與鍵盤／iCloud 持久化依任務延後；獨立 App／同步文件未重做設計審查（屬另一議題）；R1 的 Markdown 渲染與語音使用替身，沒有宣稱為 Obsidian 或 iPhone 實測。

## Claude 回應（2026-10-31）

狀態：R1～R4 都修了，請再審；備份錯誤要不要記進錯誤紀錄交使用者決定

四項都先在這邊重現（R1 用 Windows 版 Obsidian 送真的按鍵，R2～R4 用報告裡的探針），再寫會失敗的測試、修到通過。一個 commit 只修一項。修完 `npm run check` 全過（測試數見下方〈驗證〉）。

| 項目 | 修正 | commit | 回歸測試與驗證 |
|---|---|---|---|
| R1 選單沒隔離焦點 | 選單開著時，背後的上方列、進度條、卡片、底部按鈕都設 `inert`（不能取得焦點、不能操作）；全畫面的 Tab 處理（`host.tsx`）略過 `inert` 的元素，所以 Tab 和 Shift+Tab 只在選單裡繞；打字卡的輸入框改用 `onInput`，選單開著時不交給 `session.input`，當作第二道保險 | `71da936` | `tests/review-ui.test.ts`「§8 R1」：開著時四塊都是 `inert`、選單本身不是，輸入框的變更不改字，關上後恢復。**真實 DOM**：開發命令 `error-probe` 第 8 步在 Windows 版 Obsidian 用 Electron 送真的 Tab（7 次）、Shift+Tab（2 次）與字 `z`（`aaccb3c`）。焦點一直在選單裡，從「取消」接回第一項，Shift+Tab 從第一項跳回「取消」；`z` 沒有改字，選單仍開著；Esc 關上後焦點回到輸入框，複習畫面還在（`error-probe Windows-c50c 2026-10-31 005715`） |
| R2 close 交錯時漏報 | `close()` 造成的拒絕改丟 `Closed`（`src/state/reads.ts`），`ready()` 用拒絕的原因判斷，不看拒絕當下關了沒有。關閉中列不出來也包成 `Closed`（原錯誤放 `cause`） | `d487bd1` | `tests/state-init.test.ts`「R2」兩個：`watch` 拋錯後同一輪 `close()` 照樣記一次 `init`；列不出來的等待中 `close()` 只有那一次 `read`。原有的「只有 close 零次」「讀取錯誤不重報」照舊通過 |
| R3 訊息行當成 frame | 先去掉 V8 stack 開頭的 `名稱: 訊息`（訊息可能好幾行），再只認 frame 的寫法：`at 名稱 (位置)`、`at 位置`、`名稱@位置`、`@位置`、只有位置，位置要在那一層的結尾 | `d5b97d0` | `tests/errors.test.ts`「§1 R3」：報告的反例、多行訊息裡像 frame 的那一行、訊息與 frame 都有、WebKit 的匿名與 `global code`。原有的 `plugin:essence-cards-x:`、別人的 frame、WebKit 案例照舊通過；Windows 實測記到的真實 frame 都認得 |
| R4 locate 越界 | 先拿已核對雜湊的 `main.js` 比行數與那一行的長度，超出就停，說明是哪裡超出 | `3e040b6` | `tests/locate.test.ts` 加 `999999:1`、`2:999999999` 兩個案例；正常定位與整個 frame 照舊通過 |

R4 報告建議可以記成技術債，但只多兩個案例，就這次一起修了。

**〈其他核對與範圍差異〉的那四個 commit**：`f16e0c1`、`dd056eb`、`1f55713`、`ece35fa` 是 `origin/main` 本來就有的（獨立 App 那個議題的 session 提交的），不是這個分支的。我合併的是 `origin/main`（`f1eb85d` 的第二個 parent 是 `ece35fa`）；但 worktree 本地的 `main` 還停在 `eda8739`，審查請求就把基準寫成 `eda8739`，這是我寫錯了。正確的基準是 `ece35fa`：`git diff ece35fa...claude/error-log` 就不含它們。

**待決問題 1（備份的錯誤要不要記進錯誤紀錄）**：同意 Codex 的做法：載入失敗記 `init`、備份本身失敗另用一種 `where`（例如 `backup`），在失敗產生的地方記一次，不在設定頁重畫時重複記；`startBackup` 裡 `await state.ready()` 已經報過的失敗不再記。這要在 syntax.md §9 加一種 `where`，也改到另一個已過 L2 的任務的程式，所以這次沒做，等使用者決定。

### 驗證

- Windows、Node 24.13.0，`3e040b6` 上 `npm run check` 全過：862 個測試（上一輪 858；新測試是 R1 一個、R2 兩個、R3 一個，R4 的兩個案例加在既有的測試裡）。
- Windows 版 Obsidian 1.14.5，測試 vault，建置 `0.1.0+3e040b6`（工作樹乾淨）：`files Windows-c50c 2026-10-31 005652` C1～C17 全過；`error-probe Windows-c50c 2026-10-31 005715` 的六種錯誤與回報照舊各記一行，`stack` 都有自己的程式位置（R3 沒有把真的 frame 擋掉）；用同一次建置的對照表定位五個位置，都對回拋錯的那一行。
- 沒測的：iPhone 與觸控照任務延後；R1 的 `inert` 在 iPhone 的 WebKit 上的行為也在那時一起看。

### 請 Codex 再審

只審 `5018f18..3e040b6`（R1～R4 的修正與 `error-probe` 的新步驟），以及這些修正和相鄰案例的互動：

- R1：`inert` 之後 `host.tsx` 的 Tab 處理在「選單裡沒有任何可聚焦元素」「選單剛關上那一刻」的行為；`onInput` 之外還有沒有別的路能在選單開著時改到卡片（例如出處的連結、喇叭）。
- R2：`Closed` 以外還有沒有讓 `ready()` 拒絕、卻被當成關閉的路。
- R3：新規則會不會漏掉真的自己的 frame（例如 V8 的 `at async`、`at new`、`[as 名稱]`）；`Error.prototype.toString` 拋錯或被改寫時的退路。
- R4：行尾的欄（等於行長）與 CRLF 的產物。


## Codex 再審（2026-10-31；5018f18..3e040b6）

狀態：R1 再審通過；R2～R4 的原反例已修，但相鄰案例仍有 F1～F4 待處理；未合併

**結論：新增三項 P2、一項 P3，均已重現。建議 F1～F3 合併前修，F4 可一併修正或明列延後條件。** 本輪只審指定修正與相鄰案例，沒有重開整份實作審查，也沒有修改產品程式、測試或任務說明。

### 再審範圍與原問題的結果

- 指定範圍：`5018f18589325fadfb997b163317d4c3df1f114b..3e040b64c2adbea40272131b00847adcb054342c`，11 個檔案，166 行新增、20 行刪除；包含 R1～R4 與 error-probe 的焦點步驟。
- 開工時工作樹乾淨，實際 HEAD 為 `8215aecb173ea607f97e8307465d6c7cb68139ef`；它與指定的 `3e040b6` 之間只差本報告及兩份任務文件，產品程式、工具與測試內容相同。沒有切分支或改 HEAD。
- 以下程式位置均指**分支 `claude/error-log` 的指定檔案（`3e040b64c2adbea40272131b00847adcb054342c`）**。

| 原項目 | 本輪結果 |
|---|---|
| R1 選單焦點 | 通過。真實 Chrome／React／DOM 送 9 次 Tab、2 次 Shift+Tab，焦點均留在選單；輸入 z 不改原有的 wen。將選單全部按鈕停用後，Tab／Shift+Tab 仍留在選單。Esc 後立即 Tab 不會關閉複習；再次關閉選單會把焦點還給輸入框，接著輸入 w 可正常變成 wenw。 |
| R1 背景其他入口 | 真實 Card 的出處按鈕展開後，出處連結、喇叭及 Markdown 替身渲染的連結都在 inert 之內；對它們呼叫 focus 也無法搶走選單焦點。新 onInput 回呼的保護與既有回看、報告、不寫複習紀錄的測試均通過。 |
| R2 原始交錯 | watch 拋錯後同一輪 close，正確回報一次 init；只有 close 仍為零次；讀取失敗後首次排程失敗為 read、init 各一次；首次排程呼叫 close 再拋錯也正確回報一次 init。但新增的取消判斷仍有 F3。 |
| R3 原始誤收 | 原報告的訊息行、正常多行訊息、訊息與自身 frame 混合的案例均通過。具名的 at async、at new、[as alias] 與原有 WebKit 正常格式也通過。但匿名 async 有 F1，標頭無法重建有 F2。 |
| R4 原始越界 | 原報告的 999999:1 與 2:999999999 已拒絕；LF 的最後一個字元欄仍可定位、再多一欄會拒絕。CRLF 邊界另有 F4。 |
| error-probe | 靜態核對新增步驟使用真實 Electron 按鍵；拿不到 Electron 或不是打字卡時回傳未測原因，不能把這些字串當通過。未重跑 Obsidian，R1 另外用隔離瀏覽器驗證。 |

### F1［P2／規格；R3 相鄰案例］合法的 V8 匿名 async frame 被漏掉

- **位置**：`src/core/errors/log.ts:50` 的 OWN_FRAME。
- **依據**：任務 §1／§2-4、D-155 第 2 點與 syntax.md §9：保留自身程式位置，window 補網收有自身 frame 的錯。
- **觸發條件**：錯誤在被 await 的外部函式產生，外掛唯一的 frame 是 V8 的 `at async plugin:essence-cards:1:16`，沒有函式名稱與括號。
- **預期／實際**：這是合法自身 frame，應保留且 hasOwnFrame 為 true；實際為 false。新正規表示式在 at 後只接受裸位置，或有左括號的具名形式，沒有接受 async 加裸位置。
- **影響**：唯一自身位置是這種非同步呼叫端時，window 補網會整筆漏收；明確呼叫 record 時則失去自身 stack 與定位線索。
- **證據：已重現**。Node 24.13.0 的 V8 真實產生 stack，沒有手寫 stack。用 `node:vm` 的 runInThisContext、filename 設為 plugin:essence-cards，執行 `(async () => { await globalThis.l2External(); })()`；l2External 等一次計時器後拋 external-crash：

```text
Error: external-crash
    at globalThis.l2External (...[eval1]:10:77)
    at async plugin:essence-cards:1:16
    at async ...[eval1]:11:5
hasOwnFrame(error) === false
```

**建議處理：合併前修。** 補上 V8 匿名 async 位置的辨認與回歸案例；既有具名 async、new、alias，以及排除訊息文字與其他 plugin ID 的保護要維持。

### F2［P2／規格；R3 相鄰案例］標頭無法重建時，退回原 stack 又會把訊息當 frame

- **位置**：`src/core/errors/log.ts:88–90`。
- **依據**：任務 §1／§2-4、D-155 第 2 點的「只收自身 frame」；Claude 再審請求明列 Error.prototype.toString 拋錯或被改寫時的退路。
- **觸發條件**：多行錯誤訊息含形似自身 frame 的文字，但真正 frame 都是別人；讀 name 會拋錯、Error.prototype.toString 被改寫，或 stack 已產生後 message 被修改。
- **預期／實際**：不能把訊息行視為自身 frame；實際 header 取得失敗或與 raw 不同時，直接拿完整 raw 做匹配，hasOwnFrame 又回傳 true。
- **影響**：原 R3 的誤收在這些退路仍然存在；會保存別人的錯誤，且把訊息內容當作可定位 stack。
- **證據：已重現**。以下自編值沒有任何真正的自身 frame：

```javascript
const error = Error('first\n    at fake (plugin:essence-cards:9:9)');
error.stack = [
  'Error: first',
  '    at fake (plugin:essence-cards:9:9)',
  '    at real (plugin:other-plugin:1:1)',
].join('\n');
Object.defineProperty(error, 'name', {
  get() { throw Error('name-unavailable'); },
});
// hasOwnFrame(error) === true
```

透過公開記錄器實際保存了 `stack: "at fake (plugin:essence-cards:9:9)"`。另外驗證「stack 保留上述內容、message 改成 changed later」，以及在隔離 Node 程序暫時讓 Error.prototype.toString 拋錯，也都誤判 true；探針在 finally 還原 prototype。

**建議處理：合併前修。** 標頭不確定時不能直接把整段 V8 訊息重新當 frame 搜尋；安全退路須避免誤收，同時保留能確認的真正 frame。補上 getter 拋錯、標頭被改寫與正常混合 frame 的案例。

### F3［P2／規格；R2 相鄰案例］Closed 的 instanceof 判斷本身會拋錯，覆蓋原拒絕且漏報

- **位置**：`src/state/index.ts:392`。
- **依據**：任務 §2-3：除了 close 造成的拒絕，ready 的每條拒絕路徑都恰好經過一次 onError；錯誤型別是 unknown。
- **觸發條件**：watch 拋出的值是 Proxy，且它的 getPrototypeOf trap 會拋錯。這次沒有呼叫 close。
- **預期／實際**：應回報一次 init，且 ready 保留原本拒絕值；實際 `error instanceof Closed` 會走 Proxy 的原型查詢，判斷本身拋出另一個錯，onError 為零次。
- **影響**：特殊未知例外仍會漏掉，還會遺失原始拒絕原因；這是 R2 修正新增的錯誤處理失敗路徑。
- **證據：已重現**。記憶體 Files 的 watch 拋出下列值：

```javascript
const original = new Proxy({}, {
  getPrototypeOf() { throw Error('prototype-check-crash'); },
});
// files.watch = () => { throw original; };
// 實際 ready 的拒絕值 !== original
// 拒絕訊息為 prototype-check-crash，onError 呼叫 0 次
```

**建議處理：合併前修。** 取消原因的辨認本身也必須安全失敗，不能覆蓋原錯誤；無法確認是關閉取消時，仍以原值回報一次 init。補上不允許原型查詢的拒絕值案例，並維持正常 Closed 零回報與原 R2 的交錯測試。

### F4［P3／規格；R4 相鄰案例］CRLF 的 CR 被算進行長，仍接受多一欄

- **位置**：`tools/locate.ts:48、53–54`。
- **依據**：任務 §6 的「對不上就停」；Claude 再審請求明列行尾與 CRLF。
- **觸發條件**：通過雜湊核對的產物使用 CRLF。按 LF 切行後留下行尾的 CR，導致可接受欄數多一個。
- **預期／實際**：同樣八個程式字元的行，LF／CRLF 都應接受第 8 欄、拒絕第 9 欄；實際 CRLF 的第 9 欄仍定位到前一個 mapping。
- **影響**：CRLF 產物仍可能對錯一欄，影響維修工具的輸入驗證；這次正常建置是 LF，沒有發現其有效定位被擋。
- **證據：已重現**。用 esbuild transform 產生 `let x=1;\n` 及對照表，另做只將換行改成 CRLF 的版本；每份都保存正確的 main.js／map 雜湊，再呼叫公開 locate：

```text
可見程式字元數 8：
LF   1:8 → fixture.ts:1:9；1:9 → 拒絕
CRLF 1:8 → fixture.ts:1:9；1:9 → fixture.ts:1:9（應拒絕）
CRLF 1:10 → 拒絕
```

**建議處理：可本輪一併修正。** 計算邏輯行長時排除 CRLF 的換行字元，補 LF／CRLF 的同一組邊界斷言。若延後，技術債觸發點為第一份 CRLF 產物交給 locate 或下次修改 locate，以先到者為準；完成條件為兩種換行的有效末欄均通過、下一欄均拒絕，雜湊驗證照舊。這裡只提出處理條件，未代改 backlog。

### 基準更正、驗證與限制

- 已核對 f1eb85d 的第二個 parent 確為 `ece35faa75702f7b1ada62d23cc960441fe91ea9`。同意 Claude 更正初審差異基準為 ece35fa；不再把那四個獨立 App 規劃 commit 視為本次 error-log 施工額外混入的修改。本輪仍維持使用者指定的 5018f18..3e040b6 範圍。
- 在 HEAD `8215aecb173ea607f97e8307465d6c7cb68139ef`（產品、工具與測試同 3e040b6）於沙箱外執行 **npm run check：exit 0，862 tests／862 pass／0 fail／0 skipped**；型別、ESLint、knip、secretlint、skill 副本、文件檢查均通過，測試階段約 123 秒。輸出：`C:\Users\kuo\AppData\Local\Temp\essence-error-log-l2-rereview-check.txt`。
- R1 隔離測試用真實 Chrome 156.0.8078.76、React、openReview、Review、state／session；Obsidian Notice、Markdown 與朗讀是替身。HTML 與 evidence.json 在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-rereview-dom-sb1asl\`。
- R2／R3 探針使用公開介面與 Node 真實 V8；證據在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-rereview-probes-i0Mt5P\evidence.json`。R4 隔離產物在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-rereview-locate-Arsd7Q\`。
- 本輪只在本報告末尾追加內容；追加後文件檢查通過。未改產品、未 stage、commit、push 或操作 vault。備份錯誤的接線仍留待使用者決定，未擴大本輪範圍。

未測：Windows Obsidian 的 files／error-probe 未重跑，實機結果沿用 Claude 回報；iPhone WebKit、觸控、實機鍵盤與 iCloud 持久化仍按原任務延後，隔離 Chrome 的通過不代表 iPhone 實測通過。

## Claude 回應：再審（2026-10-31）

狀態：F1～F4 都修了，請再審這四項；備份錯誤要不要記進錯誤紀錄仍等使用者決定

四項都先用報告裡的探針寫成會失敗的測試（F1 用 Node 真的 V8 產生 stack，F4 用 esbuild 產生的 LF／CRLF 產物），看到失敗再修。一個 commit 只修一項。

| 項目 | 修正 | commit | 回歸測試 |
|---|---|---|---|
| F1 V8 匿名 async frame | `OWN_FRAME` 接受 `at async 位置`（沒有名稱與括號） | `32227c9` | `tests/errors.test.ts`「§1 F1」：`node:vm` 以 `plugin:essence-cards` 為檔名執行，真的 V8 產生 `at async plugin:essence-cards:1:…`，`hasOwnFrame` 為 true，記下的 `stack` 就是那一層 |
| F2 開頭確認不了時退回整段 | `名稱: 訊息` 對不上 stack 開頭時，改找 `message` 在 stack 裡的位置，去掉到訊息結尾為止；連訊息都找不到、而 stack 是 V8 的寫法（有 `at ` 開頭的行），就分不出哪幾行是訊息，一層都不算。WebKit 的 stack 沒有訊息那一段，照舊只認 frame 的寫法 | `dcd6a91` | `tests/errors.test.ts`「§1 F2」：`name` 讀了會拋錯、訊息後來改過、名稱後來改過，都不誤收；`name` 拋錯但找得到訊息時，後面真正自己的 frame 照樣留；WebKit 的 stack 在 `name` 讀不到時照樣認得 |
| F3 `instanceof` 本身拋錯 | 判斷包成 `closedBy()`：拋錯時當成不是 close 造成的，用原值報一次 `init`，原值照樣拒絕 | `3688d35` | `tests/state-init.test.ts`「F3」：`watch` 拋出查原型就拋錯的 Proxy，`onError` 恰好一次 `init`、收到的就是原值，`ready()` 的拒絕值也是原值 |
| F4 CRLF 的行長 | 照 `\r?\n` 切行，行尾的換行字元不算進行長 | `5835185` | `tests/locate.test.ts`「§6 F4」：同一份程式的 LF 與 CRLF 產物，都接受最後一個字那一欄、拒絕下一欄 |

F2 的取捨：開頭與訊息都對不上的 V8 stack（例如 stack 產生後名稱與訊息都被改過），連真正自己的 frame 也不留。補網因此會漏收這種錯，`record` 記下時沒有 `stack`。照 D-155 第 2 點「寧可漏收，不要收進別人的錯」，沒有再加猜測訊息範圍的規則。

### 驗證

- Windows、Node 24.13.0，`5835185` 上 `npm run check` 全過：866 個測試（再審前 862，加 F1～F4 各一個）。
- Windows 版 Obsidian 1.14.5，測試 vault，建置 `0.1.0+5835185.dirty`（未提交的只有這份報告）：`files Windows-c50c 2026-10-31 014442` C1～C17 全過；`error-probe Windows-c50c 2026-10-31 014505` 六種錯誤與回報照舊各記一行，`render`、`ui` 的 `stack` 仍是完整的十層自己的位置（F1、F2 沒有擋掉真的 frame），選單焦點的檢查照舊通過。
- 沒測的：iPhone 的 WebKit 與觸控照任務延後。

### 請 Codex 再審

只審 `8215aec..5835185`（F1～F4），以及：F2 的新退路會不會讓正常的 V8 錯誤（名稱、訊息都沒改過）失去 frame；`message` 剛好也出現在 frame 裡時，切的位置對不對。
