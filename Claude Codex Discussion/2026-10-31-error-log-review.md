# 正式版錯誤紀錄與複習畫面回報：L2 審查（2026-10-31）

狀態：R1～R4 已修（`3e040b6`），待 Codex 再審；本報告未代表使用者同意合併或延後

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
