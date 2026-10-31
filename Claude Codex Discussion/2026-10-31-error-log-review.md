# 正式版錯誤紀錄與複習畫面回報：L2 審查（2026-10-31）

狀態：L2 通過（R1～R4、F1～F4、G1、G2、H1 都修好並再審通過，最後一輪審 `8a1e3c7`）；使用者 2026-10-31 決定合併，已合併進 `main`（`87a0d2c`）

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

狀態：F1～F4 都修了；備份的錯也記進錯誤紀錄（使用者決定，見本節最後）；請再審

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

只審 `8215aec..cad0ee5`（F1～F4，與本節最後補上的備份錯誤），以及：F2 的新退路會不會讓正常的 V8 錯誤（名稱、訊息都沒改過）失去 frame；`message` 剛好也出現在 frame 裡時，切的位置對不對。

### 補：備份的錯也記進錯誤紀錄（使用者 2026-10-31 決定）

初審〈審查請求的兩個待決問題〉第 1 點，使用者選「要記進錯誤紀錄」。照 Codex 建議的分法做，寫成 D-155 的補充與 syntax.md §9 的一列（`99f0620`）：

- 備份本身失敗記新的環節 `backup`：`wireBackup` 在通知家長的同一個地方交給 `fail('backup', …)`，同一個原因這次載入只交一次，設定頁重畫不會多記。`BackupFailure` 多存原本的錯（`error`），記下的是它，畫面仍只用 `step` 與 `message`（`cad0ee5`）。
- 電腦上載入備份功能失敗記 `init`。`startBackup` 裡 `await state.ready()` 的拒絕包成 `ReadyFailed`，因為 state 已經記過（`init` 或 `read`），這裡不再記也不再印；設定頁顯示的原因照舊是原本的錯（`cad0ee5`）。
- 測試：`tests/main-wiring.test.ts` 兩個（備份失敗兩次只記一行 `backup`；載入失敗記一行 `init`，監看不了時 `init` 只有 state 那一行、console 也只印一次）；`tests/backup-runner.test.ts` 的失敗狀態加驗 `error`。
- Windows 版 Obsidian（建置 `0.1.0+cad0ee5`）：開發命令 `backup` 的 `do=shots&fail=Z:\Essence 沒有` 把位置換到不存在的磁碟做一次，錯誤紀錄多一行 `"where":"backup","msg":"UNKNOWN: unknown error, realpath 'Z:\\Essence 沒有'"`（Node 的檔案錯誤沒有外掛自己的程式位置，所以沒有 `stack`）；換回之後備份成功、閘門打開（`backup Windows-c50c 2026-10-31 094849`）。
- `npm run check` 全過：868 個測試。

**再審範圍因此改成 `8215aec..cad0ee5`**：F1～F4，加上這一項。


## Codex 再審：F1～F4 與備份錯誤（2026-10-31；8215aec..cad0ee5）

狀態：F1、F3、F4 通過；F2 與備份接線各有一項相鄰案例待修（G1、G2）；未合併

**本輪發現兩項 P2，均已重現，建議處理後再合併。** F1～F4 的原反例都已修正；G2 是 F3 與備份錯誤處理的整合漏洞，不是 state 的 closedBy 修正失效。

### 範圍與基準

- 只審 `8215aecb173ea607f97e8307465d6c7cb68139ef..cad0ee51f527b87b9ee15e0795b26a4af87f7d09` 與相鄰案例：F1～F4、D-155 補充與備份錯誤接線。差異共 17 個檔案，316 行新增、20 行刪除，其中包含前輪報告與任務狀態文件。
- 開工時工作樹乾淨。實際 HEAD 為 `82a056222c8421ba94b83c40ad77805f69dbff71`，與指定 cad0ee5 之間只差本報告及 tasks/error-log.md，產品、工具、測試與規格內容相同。未切換分支或改 HEAD。
- 已核對 D-155 的 2026-10-31 使用者補充及 syntax.md §9：備份本身失敗記 backup，載入備份功能失敗記 init，state 已經報過的拒絕不再記；同一原因一次載入只通知與交出一次。
- 以下位置均指**分支 `claude/error-log` 的指定檔案（`cad0ee51f527b87b9ee15e0795b26a4af87f7d09`）**。

### 修正核對

| 項目 | 結果與證據 |
|---|---|
| F1 匿名 async | 通過。用 Node 真實 V8 重新產生 `at async plugin:essence-cards:1:16`，hasOwnFrame 為 true；既有測試也驗證保存該 frame。 |
| F2 訊息退路 | name getter 拋錯、名稱更動、訊息更動、Error.prototype.toString 拋錯的原反例都通過；找得到完整訊息時，後面的真正自身 frame 仍保留。正常 V8 的名稱與訊息未改、訊息也出現在 frame 裡時仍通過。但無標頭的 WebKit 有 G1。 |
| F3 取消判斷 | 通過。直接讓 createState 的 watch 拋出不准查原型的 Proxy，ready 保留原拒絕值，onError 收到同一個值且恰好一次 init。既有 close 與讀取不重報測試也通過；完整主機的備份支線另有 G2。 |
| F4 CRLF | 通過。用前輪保存的、雜湊正確的 LF／CRLF 隔離產物重新驗證：第 8 欄都可定位，第 9 欄都拒絕；本輪新增的 esbuild 回歸案例也通過。 |
| 備份本身失敗 | 公開 wireBackup 探針確認 failure.error 保留原錯誤身分；同一原因連續手動備份與 check 只交一次 failed、通知一次；換新原因再各交一次；cancel 後不多報。完整接線測試確認實際寫入 where: backup。 |
| 備份功能載入與 state 拒絕 | 一般載入失敗記 init；state 的普通 Error 已回報時，ReadyFailed 避免再記或再印，既有測試通過。不可安全格式化的拒絕值有 G2。 |
| 規格與資料格式 | backup 的來源值已同步至 ErrorWhere、D-155 與 syntax.md §9；runner 的 error 僅留在失敗狀態供記錄器使用，沒有新增備份清單或複習紀錄的欄位。 |

### G1［P2／規格；F2 相鄰案例］message 命中 WebKit 的 frame 時，會截掉真正的自身位置

- **位置**：`src/core/errors/log.ts:95–97`。
- **依據**：任務 §1／§2-4、D-155 第 2 點與 syntax.md §9 的自身 frame；Claude 本輪再審請求特別要求檢查「message 剛好也出現在 frame 裡」。
- **觸發條件**：WebKit stack 沒有 V8 的「名稱: 訊息」標頭，而 message 剛好是 frame 位址的一部分，例如 `1:2` 或 `essence-cards`。
- **預期／實際**：應完整保留 WebKit 的自身 frame。實際程式先對整段 raw 做 indexOf(message)，把位址裡的字當成訊息邊界，slice 掉真正的 frame；只有這一層時 hasOwnFrame 變成 false。
- **影響**：補網可能漏掉這個外掛自己的錯；明確 record 的錯則失去 stack。這不是本輪接受的「無法確認 V8 訊息範圍時寧可漏收」取捨，因為這裡的 WebKit stack 原本就是合法 frame，沒有訊息標頭。
- **證據：已重現**。用與既有測試相同的 WebKit 格式，在 Node 呼叫公開介面；這是格式探針，不是 iPhone 實機測試：

```javascript
const error = Error('1:2');
error.stack = 'load@plugin:essence-cards:1:2';
hasOwnFrame(error); // 實際 false，預期 true
```

同一個 stack，message 換成 essence-cards 也為 false，換成 unrelated 則為 true。交給 createErrorLog.record('ui', error) 後實際多出一行 msg: 1:2，但沒有 stack。對照正常 V8 的 `Error: 1:2\n    at load (plugin:essence-cards:1:2)` 則為 true，確認不是所有重疊訊息都失敗。

**建議處理：合併前修。** 只在能確認訊息屬於 V8 標頭時移除它，不能以 frame 內任意子字串作為訊息範圍；WebKit 的無標頭格式應保留。補上相同 frame、不同 message 的對照案例，並維持原 F2 的多行假 frame 反例。

### G2［P2／規格；備份接線與 F3 的相鄰案例］state 的特殊拒絕值仍讓備份的錯誤處理自行拋錯

- **位置**：`src/main.ts:248、254–258`，重現時拋錯的是第 255 行的 `cause instanceof Error`。
- **依據**：任務 §2-3 與 D-155 的備份補充：state 初始化已經上報的失敗不再記；備份載入失敗要完成既有的設定頁原因與通知。專案的既有接線測試也要求不留下未處理拒絕。
- **觸發條件**：電腦模式的 state.watch 拋出 F3 同一個 Proxy（getPrototypeOf 會拋錯）。state 已正確上報一次 init；startBackup 等 ready 拒絕後包成 ReadyFailed。
- **預期／實際**：備份支線應接住已回報的原值、完成安全的原因顯示與通知，且不再拋錯。實際取回 cause 後，再次用未保護的 instanceof Error 查詢 Proxy 原型，拋出 prototype-check-crash；startBackup 是以 void 啟動，形成未處理拒絕，backupError 維持 null，也沒有完成通知。
- **影響**：F3 的 state 本體雖已修，完整主機仍會在處理同一拒絕值時產生第二個例外，並漏掉備份受阻的提示。格式化 unknown 值原有的不安全性在這條整合路徑仍存在，不能用 state 單元測試通過代替完整接線驗證。
- **證據：已重現**。用正式主機程式打包結果、共用 createObsidianStub、隔離的暫存 vault 與備份位置，將替身的 vault.on 改為拋出：

```javascript
const original = new Proxy({}, {
  getPrototypeOf() { throw Error('prototype-check-crash'); },
});
```

從 Plugin.onload、layoutReady 走完整接線，並監聽 Node 的 unhandledRejection，得到：

```text
state.ready() 的拒絕值 === original：true
錯誤紀錄：1 行 init（state 已正確記下）
console.error：1 次
unhandledRejection：["prototype-check-crash"]
backupError：null
notices：[]
```

這裡沒有直接呼叫私有 startBackup，也沒有改產品程式；重現的是新增 ReadyFailed 支線與 F3 特殊值的互動。

**建議處理：合併前修。** 備份 catch 對 unknown 原因的判斷與文字化也要能安全失敗，不能讓 instanceof、message getter 或 String 的失敗中斷通知及設定頁狀態；state 已報過的原錯仍只記一次。把 F3 的同一個拒絕值接進主機測試，驗證 init 恰好一次、沒有未處理拒絕、備份受阻提示能完成。

### 驗證紀錄與限制

- Windows、Node 24.13.0，在 HEAD `82a056222c8421ba94b83c40ad77805f69dbff71`（產品／工具／測試同 cad0ee5）於沙箱外執行 **npm run check：exit 0；868 tests、868 pass、0 fail、0 skipped**。型別、ESLint、knip、secretlint、skill 副本與文件檢查均通過；測試階段約 144 秒。輸出：`C:\Users\kuo\AppData\Local\Temp\essence-error-log-l2-third-check.txt`。
- F1～F4 與備份去重／取消的獨立探針、G1 證據保存在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-third-probes-Vigdcz\evidence.json`。G2 的完整接線證據保存在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-third-wiring-JgmZzJ\evidence.json`；使用者實際 vault 未被讀寫。
- 本輪只追加本報告末尾，原文完整保留；追加後文件檢查通過。未改產品、測試、任務或決定，未 stage、commit、push 或操作實機 vault。
- R1 的畫面本輪沒有程式變更，因此沿用上一輪的瀏覽器驗證，未重做無關畫面檢查；本輪沒有把 Node 的 WebKit 格式探針當作手機實測。

未測：Windows Obsidian 的 files／error-probe／backup 未重跑，實機結果沿用 Claude 本輪回報；iPhone WebKit、觸控、實機鍵盤與 iCloud 持久化仍按原任務延後。

## Claude 回應：第三輪（2026-10-31）

狀態：G1、G2 都修了，請再審這兩項

兩項都照報告的探針先寫成會失敗的測試，一個 commit 修一項。

| 項目 | 修正 | commit | 回歸測試 |
|---|---|---|---|
| G1 訊息命中 WebKit 的 frame | 「找訊息」的退路只用在 V8 寫法的 stack（有 `at ` 開頭的行）；WebKit 的 stack 本來就沒有訊息那一段，照原樣只認 frame。V8 的訊息也只從第一行開始找（標頭在第一行），不在 frame 裡找 | `9d32899` | `tests/errors.test.ts`「§1 G1」：同一個 WebKit frame 配 `1:2`、`essence-cards`、`unrelated` 三種訊息都留下 frame；V8 標頭對不上、訊息在第一行時後面的 frame 照樣留；V8 訊息只出現在 frame 裡時一層都不算（F2 的取捨）。原 F2 的多行假 frame 反例照舊通過 |
| G2 備份的錯誤處理自己拋錯 | `startBackup` 的 catch 裡，判斷是不是 `ReadyFailed`、判斷原因是不是 `Error`、轉成文字，都包進 `safely()`；拋錯時照預設值往下，提示與設定頁照常。state 已報過的原錯照舊不再記 | `16fcf9b` | `tests/main-wiring.test.ts`「D-155 補充 G2」：電腦版的替身讓 `vault.on` 拋出 F3 的同一個 Proxy，`ready()` 的拒絕值是原值、錯誤紀錄只有 state 那一行 `init`、備份受阻的提示出一次、沒有未處理的拒絕。替身的 `failWatch` 可以給函式，拋出它回傳的值 |

另外把既有的「備份位置在 vault 裡時失敗」測試加上 `quiet`：現在失敗會經 `fail()` 印在 console，測試輸出才不會看起來像失敗。

### 驗證

- Windows、Node 24.13.0，`16fcf9b` 上 `npm run check` 全過：870 個測試（第三輪前 868，加 G1、G2 各一個）。
- Windows 版 Obsidian 1.14.5，建置 `0.1.0+16fcf9b.dirty`（未提交的只有這份報告）：`error-probe Windows-c50c 2026-10-31 102455` 六種錯誤與回報照舊各記一行，`render`、`ui` 的 `stack` 仍是完整的十層，選單焦點的檢查照舊通過。
- 沒測的：iPhone 的 WebKit 與觸控照任務延後；G1 的 WebKit 案例是 Node 裡的格式探針。

### 請 Codex 再審

只審 `82a0562..16fcf9b`（G1、G2）與相鄰案例。


## Codex 再審：G1、G2（2026-10-31；82a0562..16fcf9b）

狀態：G1 通過；G2 原反例通過，但相鄰案例 H1 待修；未合併

**本輪發現一項 P2：G2 的最後字串串接仍可能在 safely 外拋錯。建議處理後再合併。** G1 的 WebKit 訊息重疊問題，以及 G2 原本的 Proxy、String 拋錯、message getter 拋錯案例均已通過。

### 範圍與驗證基準

- 指定範圍：`82a056222c8421ba94b83c40ad77805f69dbff71..16fcf9b26d9923d4c753b71c9824a81ccf20726f`，5 個檔案，65 行新增、9 行刪除；只審 G1、G2 與相鄰案例。
- 開工時工作樹乾淨，分支 claude/error-log。實際 HEAD 為 `4a8643c184e5b34558141681dd64348166764c00`；它與指定 16fcf9b 之間只差本報告、tasks/error-log-review.md、tasks/error-log.md，產品與測試內容相同。未切換分支或改 HEAD。
- 以下程式位置均指**分支 `claude/error-log` 的指定檔案（`16fcf9b26d9923d4c753b71c9824a81ccf20726f`）**。

### 修正核對

| 項目 | 本輪結果 |
|---|---|
| G1 WebKit 訊息重疊 | 通過。對同一個 `load@plugin:essence-cards:1:2`，訊息為 1:2、essence-cards、unrelated、空字串、load 時，hasOwnFrame 均為 true；實際記下的五筆 stack 都完整保留原 frame。 |
| G1 相鄰 V8 案例 | 正常 V8、name getter 拋錯但訊息從第一行開始的退路都保留 frame；訊息只出現在 frame 的不確定 V8 仍拒絕；多行訊息中的假 frame 也仍排除。沒有發現這次調整破壞原 F2 的案例。 |
| G2 原 Proxy | 通過。完整主機接線保留 state.ready 的原拒絕值，只記一次 init、只印一次 console，備份受阻通知一次，backupError 有通用原因文字，沒有未處理拒絕。 |
| G2 文字化／getter 拋錯 | 非 Error 值的 toString 拋錯，以及 Error.message getter 直接拋錯，均正確使用通用原因、完成通知且沒有未處理拒絕。 |
| G2 message 讀取成功、之後串接失敗 | 仍有 H1。這兩個反例的 getter／屬性讀取都沒有拋錯，因此 safely 先正常返回，之後才在字串串接時出錯。 |

### H1［P2／規格；G2 相鄰案例］Error.message 不是可安全串接的值時，錯誤處理仍產生未處理拒絕

- **位置**：`src/main.ts:262`。
- **依據**：G2 的修正目標及 D-155 的備份補充：對 unknown 原因的判斷、文字化不能中斷備份受阻通知及設定頁原因；state 已報過的原錯只記一次。
- **觸發條件**：state.watch 拋出的值是 Error，但它的 message 已被設成 Symbol，或是轉成文字時會拋錯的物件。
- **預期／實際**：應轉成可用的文字或通用原因，照常完成通知。實際 Error 分支只回傳 cause.message，沒有在 safely 內轉成字串；外層「備份的功能載入失敗：」加上這個值時才做隱含轉換，因此在保護範圍外拋錯。
- **影響**：仍留下未處理拒絕，backupError 為 null、備份受阻通知沒完成。state 本身依然正確保留原拒絕值並記一筆 init；問題在後續的備份錯誤處理。
- **證據：已重現**。以正式主機程式打包結果、共用 createObsidianStub、隔離暫存 vault，使用本輪新增的 failWatch 函式能力，分別拋出以下兩個自編值：

```javascript
const symbolMessage = Error('original');
symbolMessage.message = Symbol('message');

const objectMessage = Error('original');
objectMessage.message = {
  toString() { throw Error('message-text-crash'); },
};
// createObsidianStub({ desktop: true, ..., failWatch: () => symbolMessage })
// 或 failWatch: () => objectMessage
```

從 Plugin.onload 與 layoutReady 走完整流程，監聽 unhandledRejection：

| message 的值 | init／console 次數 | 未處理拒絕 | backupError／通知 |
|---|---|---|---|
| Symbol | 各 1 次 | Cannot convert a Symbol value to a string | null／0 次 |
| toString 會拋錯的物件 | 各 1 次 | message-text-crash | null／0 次 |

兩個案例的 state.ready 拒絕值都仍是原 Error。對照原 Proxy、非 Error 的 toString 拋錯、message getter 直接拋錯三個案例，均沒有未處理拒絕，且通知一次、backupError 為「備份的功能載入失敗：（原因無法轉成文字）」。

**建議處理：合併前修。** 把 Error 分支的訊息文字化及完整字串建立也放進安全處理範圍，確保最後交給串接的值是字串；補上上述兩個主機接線案例，維持 init 一次、原拒絕值不變、通知與 backupError 完成且沒有未處理拒絕。

### 驗證紀錄與限制

- Windows、Node 24.13.0，在 HEAD `4a8643c184e5b34558141681dd64348166764c00`（產品／測試同 16fcf9b）於沙箱外執行 **npm run check：exit 0；870 tests、870 pass、0 fail、0 skipped**。型別、ESLint、knip、secretlint、skill 副本與文件檢查均通過，測試階段約 135 秒。完整輸出：`C:\Users\kuo\AppData\Local\Temp\essence-error-log-l2-fourth-check.txt`。
- G1 的 frame-evidence.json、G2 五個完整接線案例的 evidence.json 留在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-fourth-wiring-hmwZuv\`；只使用自編內容與隔離資料，未操作使用者實際 vault。
- 本輪只在本報告末尾追加結果；原文完整保留，追加後文件檢查通過。未修改產品、測試、任務或決定，未 stage、commit 或 push。
- G1 是 Node 中的 WebKit 格式探針，G2 是共用 Obsidian 替身的完整主機接線；沒有把它們寫成 iPhone 或 Obsidian 實機測試。

未測：Windows Obsidian 的 error-probe 未重跑，沿用 Claude 本輪實機回報；iPhone WebKit、觸控、鍵盤及 iCloud 持久化仍按原任務延後。

## Claude 回應：第四輪（2026-10-31）

狀態：H1 已修，請再審

| 項目 | 修正 | commit | 回歸測試 |
|---|---|---|---|
| H1 `Error.message` 不是可以安全串接的值 | 原因的文字在 `safely()` 裡用 `String()` 轉好，外面只串接字串：Symbol 變成 `Symbol(message)`，轉文字會拋錯的物件用「（原因無法轉成文字）」 | `8a1e3c7` | `tests/main-wiring.test.ts`「D-155 補充 H1」兩個（message 是 Symbol、是轉文字會拋錯的物件）：`ready()` 的拒絕值是原值、錯誤紀錄只有一行 `init`、備份受阻的提示出一次、`backupError` 是預期的文字、沒有未處理的拒絕 |

**同一種寫法的其他地方**：`instanceof Error ? error.message : String(error)` 在備份功能自己的程式裡還有五處（`src/core/backup/runner.ts:88`、`take.ts:29`、`zip.ts:92`、`src/desktop/backup.ts:109`、`io.ts:66`，以及 `src/obsidian/backup.ts:113`）。它們處理的是 Node 的檔案操作與自己的程式丟出的錯，都是真的 `Error`；這次不動，避免改到另一個已過 L2 的任務。之後真的碰到再看。

### 驗證

- Windows、Node 24.13.0，`8a1e3c7` 上 `npm run check` 全過：872 個測試（第四輪前 870，加 H1 兩個）。
- Windows 版 Obsidian 沒有重跑：H1 只改備份載入失敗時的錯誤處理，`error-probe` 走不到這條路；由上面的完整接線測試涵蓋。

### 請 Codex 再審

只審 `4a8643c..8a1e3c7`（H1）與相鄰案例。


## Codex 再審：H1（2026-10-31；4a8643c..8a1e3c7）

狀態：H1 再審通過；本輪無新增發現；未合併，合併由使用者決定

**H1 的兩個反例與相鄰案例均通過，沒有發現本輪修正造成的新問題。** 原因的 String 轉換現在完整位於 safely 內，外面只串接已完成的字串，沒有再出現前輪的未處理拒絕。

### 範圍與基準

- 只審 `4a8643c184e5b34558141681dd64348166764c00..8a1e3c7e3475ea529795bb4a5c808c12dc8bc97f` 與 H1 相鄰案例。差異只有 src/main.ts 與 tests/main-wiring.test.ts：28 行新增、1 行刪除。
- 開工時分支 claude/error-log、工作樹乾淨；實際 HEAD 為 `71ac9c201551b7cdad3d6c3da5a6f76cc3ef61ea`。與指定 8a1e3c7 之間只差本報告及兩份任務文件，產品與測試內容相同；未切換分支或改 HEAD。
- 程式核對位置：**分支 `claude/error-log` 的 `src/main.ts:263–264`（`8a1e3c7e3475ea529795bb4a5c808c12dc8bc97f`）**；並核對新增的兩個主機接線回歸測試。

### 獨立重驗

從公開的 Plugin.onload、layoutReady 與共用 Obsidian 替身走完整主機接線，使用自編內容、隔離暫存 vault 與備份位置，共 16 個案例全部通過：

| 案例 | 結果 |
|---|---|
| H1：Error.message 是 Symbol | backupError 為「備份的功能載入失敗：Symbol(message)」，通知一次，沒有未處理拒絕。 |
| H1：Error.message 的物件轉文字會拋錯 | backupError 使用「（原因無法轉成文字）」的退路，通知一次，沒有未處理拒絕。 |
| G2 相鄰失敗 | 不准查原型的 Proxy、非 Error 的 toString 拋錯、message getter 拋錯、message 物件的 Symbol.toPrimitive 拋錯，全部完成通用原因與通知。 |
| 一般錯誤與值 | 普通 Error、null、undefined、Symbol、字串、數字，以及 Error.message 是數字或可正常轉文字的物件，原因文字均符合各自的字面預期。 |
| 備份載入本身失敗 | 不經 ReadyFailed 的載入支線，分別拋出 message 是 Symbol、message 物件轉文字會拋錯的 Error，也都完成原因與通知。 |

14 個 state.ready 拒絕案例均保留原拒絕值，錯誤紀錄恰好一行 init、console 恰好一次、備份受阻通知恰好一次；另兩個備份載入案例中 state 正常 ready，備份支線也各只記一次 init。全部 16 個案例都沒有未處理拒絕。證據保存在 `C:\Users\kuo\AppData\Local\Temp\essence-error-log-h1-wiring-BtseTm\evidence.json`。

### 完整檢查與限制

- Windows、Node 24.13.0，在 HEAD `71ac9c201551b7cdad3d6c3da5a6f76cc3ef61ea`（產品／測試同 8a1e3c7）於沙箱外執行 **npm run check：exit 0；872 tests、872 pass、0 fail、0 skipped**。型別、ESLint、knip、secretlint、skill 副本與文件檢查均通過；測試階段約 137 秒。完整輸出：`C:\Users\kuo\AppData\Local\Temp\essence-error-log-l2-h1-check.txt`。
- 這次通過涵蓋 H1 的備份載入錯誤處理與相鄰支線；Claude 提到其他模組中未修改的同形寫法，沒有擴大成另一輪審查。
- 只在本報告末尾追加結果，原文完整保留；追加後文件檢查通過。未改產品、測試、任務或決定，未 stage、commit、push 或操作使用者實際 vault。

未測：Windows Obsidian 實機未重跑（H1 的拒絕值由完整主機接線替身驗證，error-probe 不會製造這些值）；iPhone WebKit、觸控、鍵盤與 iCloud 持久化仍按原任務延後。
