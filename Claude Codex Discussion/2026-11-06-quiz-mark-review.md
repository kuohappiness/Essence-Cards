# 小考標記：Codex L2 審查（第一輪，2026-11-06）

狀態：第一輪 R1～R5 都修了，待 Codex 第二輪（見最後的〈Claude 回應：第一輪〉）

## 審查範圍

- 分支 `claude/quiz-mark-354478`，worktree `.claude/worktrees/musing-kowalevski-696591`。
- 基準 `1c4cb4387cc95cbc77dd9249bc5fcd196d1e1475`，待審 `be14a85ca667bd723de82bc4d75bb141b9f2ec19`。審查時 HEAD `a80438c012de3363d6d63fad5e8fa5bd11623f85`，`git diff --exit-code be14a85 HEAD -- src tests tools docs/syntax.md docs/architecture.md` 通過；後續只有文件，起初工作樹乾淨。
- 按[審查請求](../tasks/quiz-mark-review.md)、[任務 §1～§6](../tasks/quiz-mark.md)、[格式查核第 3～6 點](2026-11-05-quiz-mark-format-review.md)、syntax §4／§4-1、相關 D-ID 與 `code-quality` 查核。檢視指定差異及受影響的呼叫端，包含共用 `folder-files`、段考的重構、state 的讀取閘門、連結解析、畫面與開發命令。
- 沒有參與實作；只審查與隔離重現。沒有修改產品程式、測試、規格或主資料夾，沒有執行 `quiz-mark`、安裝外掛或操作共用測試 vault。本檔不用 commit。

## 發現（按影響排序）

### R1 [P2] 完整路徑的原篇不存在時，會接受另一個路徑尾巴相同的卡組

- **軸**：規格／連結解析的契約。
- **依據**：任務 §1 與 syntax §4-1：原篇搬走或刪掉時顯示「找不到這一篇」；完整路徑、相對路徑、檔名只在確定指向那一篇時接受。現有 `quiz-state` 的「只搬資料夾、連結沒跟著改」測試也要求完整路徑失效。
- **位置**：`src/obsidian/quiz-links.ts:11`～`:17`，特別是非完整匹配後，`same.length` 只有一個甚至零個也直接信任 metadata 選出的 `file`。
- **觸發**：小考連結是 `[[Essence Cards/學業/English]]`；原本 `Essence Cards/學業/English.md` 已不存在，vault 裡只有 `Essence Cards/備份/Essence Cards/學業/English.md`。後者是已知卡組，並非系統資料夾。
- **預期／實際**：預期原完整路徑找不到，列待修正、不能開始該篇練習。實際 resolver 回傳備份路徑，真正 state 的小考列為 `problem: null`、`refs: [{ deck: 備份路徑 }]`、`count: 1`，可直接練備份的目標。
- **原因與影響**：Obsidian 的 `getFirstLinkpathDest` 並不保證有斜線的輸入就是精確 vault 路徑；找不到精確位置時仍會找路徑尾巴。現在的額外檢查只擋多個尾巴匹配，無法區分「短連結唯一」與「完整位置已失效」，可能讓學生練到另一篇或舊備份。
- **證據**：**隔離重現**。先用假的 metadata 回傳上述備份，執行真正 resolver＋state，得到上述結果；另唯讀抽出本機 `C:/Users/kuo/AppData/Roaming/obsidian/obsidian-1.15.0.asar` 的 `app.js` 中 `getLinkpathDest` 方法，以自編的 vault／`uniqueFileLookup` 執行，確認它確實回傳該備份。抽出方法只適配 basename、dirname、排序與 Obsidian 的 `String.contains`，沒有啟動或操控 Obsidian；不是本輪實機重測。
- **真實路徑**：**會**。搬檔或刪掉原篇、保留另一層同名卡組，都可由手動檔案整理／同步產生；此例原篇已不存在，當下也沒有兩個同名檔。metadata 的退回行為有本機 1.15.0 程式證據，非任意捏造其回傳。
- **建議**：合併前修。先分清楚已宣告的完整 vault 路徑、相對路徑和短連結；完整／相對位置須精確存在，短連結才做唯一性判斷。保留「自動更新成短連結」與「精確位置存在時不受整包備份干擾」的成功案例，新增「原篇不存在、只剩尾巴相同卡組」及相對路徑的反例。

### R2 [P2] 建檔的預讀與 modify 之間出現空檔，仍會覆寫它

- **軸**：規格／寫回安全。
- **依據**：任務 §1「已有的檔（含空檔）一個字都不動」，格式查核第 6 點的撞名驗收；請求亦明列要查先讀再寫的時間差。
- **位置**：`src/state/quiz.ts:88`～`:90`。
- **觸發**：建 `2026-11-07 小考.md`，預讀得到 null；在後續 modify 回呼開始前，外部在同一路徑建立零位元組檔。
- **預期／實際**：預期保留空檔並改用 ` 2`，或安全回報撞名。實際 `latest === ''` 被當成不存在，原空檔被寫成小考，回 `{ kind: 'done' }`，沒有建立 ` 2`。
- **證據**：**已重現**，用真正 `createState`、`MemoryFiles.holdRead` 控制預讀時序；最小腳本見下方。既有測試只放建檔前已存在的空檔，沒有覆蓋這段空檔晚到的情況。
- **真實路徑**：**會**。另一個編輯器／裝置或同步程序可以在這段 I/O 空檔建立空筆記。`Files.modify` 明定不存在與空檔都交給回呼空字串，事前讀取不會讓判斷變成原子操作。本例沒有宣稱丟掉非空內容，問題是把別人的既有空筆記變成自己的小考。
- **建議**：合併前修。需要在真正建立的位置保證「存在就不寫」，而非再加一次無鎖預讀；可在檔案層設計具存在判斷的建立契約，並驗證 Node／Obsidian 兩端。回歸涵蓋預讀後才出現的空檔、非空檔與碰撞後下一個後綴。

```js
import { createState } from './src/state/index.ts';
import { createMemoryFiles } from './tests/helpers/memory-files.ts';
const folder = 'Essence Cards/考試範圍/小考/';
const path = folder + '2026-11-07 小考.md';
const memory = createMemoryFiles({
  'Essence Cards/English.md': '---\n年級學期: 國二上\n科目: 英文\n單元: "L3"\n---\n- A ^aaa\n    - Q :: A\n',
});
const state = createState({ files: memory.files, device: 'PC-test', delay: 1,
  now: () => Date.parse('2026-11-06T12:00:00+08:00'), offset: () => 480 });
await state.ready();
const held = memory.holdRead(path);
const writing = state.setQuiz({ unit: { term: '國二上', subject: '英文', code: 'L3' } }, '2026-11-07', null);
await held.started;
memory.write(path, ''); // 預讀得到 null 之後，外部建立空檔
held.release(null);
console.log(await writing); // done
console.log(memory.texts.get(path)); // 空檔被寫成小考
console.log(memory.texts.has(folder + '2026-11-07 小考 2.md')); // false
await state.close();
```

### R3 [P2] 舊選單收到遠端取消後，未送出的改日期會變成新建小考

- **軸**：設計／公開操作的身分與順序。
- **位置**：`src/ui/Quiz.tsx:60`、`:70`、`:76`、`:93`；`view.row` 每次 render 隨資料重算，但 `typed` 留著選單開啟時的編輯內容。
- **觸發**：原小考 A（ID `q4m8t2`、11/7）開著改日期選單，選「其他日期」、輸入 11/9 尚未送出。另一台裝置取消 A，同步完成；選單沒有關掉或標為過時，輸入仍是 11/9。此時按原本的「確定」。
- **預期／實際**：預期這次操作仍指向 A，得到 changed／失效提示，或選單關閉要求重開後明確設新小考。實際 A 消失使 `view.row` 變 null，`current.setQuiz(input, date, null)` 走建立新檔；得到新的 ID、11/9 的新小考，沒有說明原小考已被取消。
- **影響**：還在修改舊小考的動作，會悄悄跨過取消邊界，變成重新設定另一個小考。相同的動態換身分也會發生在同目標另一 ID 接手時；state 原本的 opened-ID 防線因 UI 改傳新 row／null 而失效。
- **證據**：**已重現**。真正 React＋happy-dom、`openEntry`、真正 state／MemoryFiles。遠端取消後 `state.quizzes()` 是空的、原輸入值仍為 `2026-11-09`；點確定後出現新 ID、date `2026-11-09`，舊檔保留取消行。另測快捷「後天」也會新建，不只文字欄。
- **真實路徑**：**會**。開著選單等別台裝置同步，或在另一個筆記分頁改小考檔即可，不需要異常紀錄或不合法的 state 呼叫。
- **建議**：合併前修。選單開啟時固定這次操作的 opened 身分；資料取消、到期、換 ID 時關閉或顯示過時，不把既有編輯自動改為 create／改另一份。測試加入遠端取消、另一 ID 接手與單篇被暫停時的選單存續，檢查真正傳給 state 的 opened。

### R4 [P2] 選單剛打開時按 Esc，事件不經過選單，直接離開目錄

- **軸**：規格／鍵盤行為。
- **位置**：`src/ui/Quiz.tsx:63`～`:70`、`:95`～`:101`；外層 `src/ui/Entry.tsx:55`～`:59`。
- **觸發**：鍵盤焦點在「小考」按鈕，開啟選單後直接按 Esc。開選單沒有把焦點移進去，觸發按鈕與 `.ec-qz-menu` 是兄弟節點。
- **預期／實際**：預期先收起小考選單、仍留在目錄（既有 `quiz-ui` 測試的明示驗收與選單內 handler 的註解）。實際事件從按鈕冒泡到 Entry，執行 `store.go('entry')`，整個目錄卸載，展開狀態也丟掉。
- **證據**：**已重現**。用真正 React／Entry，先 focus 觸發按鈕再 click；確認 `document.activeElement` 仍為該按鈕，再從 activeElement dispatch Esc。結果 `.ec-tr-ub` 數量為 0、畫面出現入口的「目錄」按鈕。既有測試把 Esc 直接 dispatch 到 `.ec-qz-menu`，避開了真實初始焦點，因此通過。
- **真實路徑**：**會**。Tab 到按鈕、Enter 開啟後直接按 Esc 就是正常鍵盤路徑；不依賴 happy-dom 自動替 click 移焦點。
- **建議**：合併前修。讓整個小考控制區處理關閉優先序，或管理開啟／關閉時的焦點；copies 選單也要同樣處理。回歸從觸發按鈕的真實焦點送 Esc，不只向選單容器派事件；第一次關選單、第二次才返回入口。

### R5 [P3，非阻擋] others 的副本衝突被寫成日期錯誤，也不列出兩份檔

- **軸**：規格／錯誤提示。
- **位置**：`src/ui/Quiz.tsx:112`。
- **觸發**：同一單元有正常的小考 A，另有同 ID 的 B1／B2 日期不一樣。`quizButton` 正常回 `kind: set`，`others` 帶 `problem: copies` 的那一組。
- **預期／實際**：預期顯示「這個小考有兩份不一樣的檔」、點了列出兩份（任務 §1）。實際所有 others 都硬寫「另有一份小考日期有問題」，只開 `row.paths[0]`，沒有顯示另一份或修副本的說明。
- **證據／真實路徑**：**已重現，會發生**。真正 state 與 React，A 為 11/7，B1／B2 分別為 11/7、11/9；選單顯示錯誤原因，點擊只 openNote 第一份，`.ec-qz-copies` 不存在。入口那一列仍有正確的副本衝突入口，因此不列為阻擋合併。
- **建議**：others 按各自的 `problem` 使用共用的提示／修復元件，不假設只會收到 date。建議隨本批修；若延後，記進技術債，觸發點「下次修改小考待修正選單」，完成條件涵蓋 date、body、copies 且 copies 可列出全部路徑。

## 實作者自己選的做法：逐點回覆

| 請求項目 | 查核結果 |
|---|---|
| 1. 共用 folder-files | 分層有用途：讀取、等待、hold／unhold、逾時與回呼內修改規則只有一份。對照原 exam 實作，未找到這次抽取改變段考選定／排程的問題。`headEditor` 亦為原邏輯搬出，非另一套日期 reader。 |
| 2. 建檔先讀再寫 | **R2**：能保護讀到當下已有的空檔，保護不了預讀後才出現的空檔；不能把事前讀取當成存在即不覆寫的保證。 |
| 3. 改日期寫所有副本 | 合理。已知的副本在 gate 等待後收集，逐份寫；中途副本不見、取消或壞掉會停止並回報，沒有多檔原子提交的承諾。晚到的舊副本造成日期衝突時由 copies 待修正，沒有自行挑新版。 |
| 4. 目錄找不到的列在入口取消 | 有必要：刪掉卡組後目錄確實沒該列。missing／several／unmatched 的取消入口與打開檔案修復並存，沒有替學生猜目標。 |
| 5. 0 張也能取消 | 合理，涵蓋整篇／單元暫停時失去目錄按鈕的情況；全部卡仍 disabled。 |
| 6. 無編號單元用單篇 | `buildIndex` 的 loose 篇以各自路徑建 node、只有一篇，這個前提成立。單元列用那篇的 deck ref，可避免寫不出的單元格式。 |
| 7. 其他日期擋過去日期 | 沒有找到不合理的退步；只是 UI 禁止新增立即失效的日期，既有過期檔仍照日期消失，沒有回寫它們。 |
| 8. 一篇已有小考仍顯示按鈕 | 合理，維持手寫／之前建立的單篇小考可改可取消；草稿與暫停仍不列此按鈕。 |
| 9. 舊測試調整 | 段考的 path、others、missing、period、lane 斷言保留。新功能必須讀小考，所以原本「整個 state 不讀」改為「段考不因小考重讀」合理；`unread` 加小考只改提醒，卡組寫入的 private unread 與段考的 folder 閘門仍分開。比較工具兩個補丁只更新定位字串，沒有放寬型別斷言。 |
| 10. since 用 Date.now | 和 D-163／既有入口一致。單元、單篇按鈕都傳正確的 ref＋since，N=0 禁止按；小考設定與取消不進 plan、FSRS 或紀錄 writer。 |
| 11. 入口取消失敗走 notify | 可接受，沒有靜默忽略 blocked／failed；目錄則保留選單並顯示原因。開著的選單在同步更新下的操作身分另見 **R3**。 |
| 12. 完整路徑優先再比尾巴 | 短連結唯一性檢查有用途，自動更新後的短連結需保留；但完整位置失效的退回條件有 **R1**。另外 `metadata` 未回傳時現在安全回 none；是否在 metadata 較晚就緒後自動重畫，沒有在本輪實機驗證。 |

## 格式查核測試表的對照與補充探針

| 格式查核第 6 點 | 現有驗收與本輪結果 |
|---|---|
| 日期與狀態 | `quiz-file` 的日期正規化／閏日／缺空壞值／未關 YAML；`quiz-state` 的 UTC+8 隔天 03:59:59.999／04:00、取消日 03:59／04:00；到期不寫檔。完整限時測試通過。 |
| 內文 | `quiz-file` 恰好一個非空白行、標題／第二項／單元＋連結／範圍／分類拒絕，格式合法但 unmatched 分開。完整限時測試通過。 |
| 副本與選擇 | `quiz-file` 輸入順序互換、同目標日期／路徑排序、正規化三欄／解析後卡組、壞日期保留；`quiz-state` 晚到舊副本仍取消、同 ID 11/5／11/7 在 11/6 清晨 4 點走 copies；缺 ID 分開與首次補 ID 均有測。 |
| 寫回與撞名 | 原名／2／3、預先存在的空檔、CRLF／引號／註解、缺 ID、壞 YAML／不同 ID 拒寫有測；**晚到空檔缺口為 R2**。 |
| 第 3～5 點額外要求 | 段考排除小考路徑／頂層鍵的防線保留；連結改名／修復的 state 測試有做，Windows 實機結果是實作者提供，沒有當成本輪親測。真實 metadata 的尾巴退回與測試替身的精確讀法不一致，見 **R1**。 |

額外隔離探針使用公開 state、UI、resolver 及既有 MemoryFiles／happy-dom 替身，未新增產品出口或持久測試檔：R1～R5 均如上重現。React 探針由 `installDom`、`loadUi('src/ui/entry-host.tsx')` 建真正畫面；小考選單資料變更用 `memory.write` 加通知並等重讀，鍵盤事件從 `document.activeElement` 發出。

## 驗證紀錄

- 環境：Windows、Node `v24.13.0`，在指定 worktree 以 **沙箱外 `npm ci`** 安裝 `package-lock.json` 的相依；exit 0，未改 package／lockfile。
- 首次沙箱外 `npm run check`：typecheck 通過，ESLint 因 `FATAL ERROR: Zone Allocation failed - process out of memory` 中止，exit 134。這不是通過。
- 第二次限制 Node heap 為 768 MB，typecheck、ESLint、knip、secretlint、skill、docs 通過；測試的 dot reporter 只報 `tests/entry-ui.test.ts`、`tests/exam-catalog.test.ts` 兩個檔失敗，整體 exit 1。該輸出沒有足夠原因，**不自行斷定這兩個失敗一定是環境**。
- 兩個失敗檔另以 spec reporter、`--test-timeout=120000` 在沙箱外重跑，**46／46 通過**，約 4.0 秒。
- 全部測試另以 `node --test --test-concurrency=1 --test-timeout=120000 --test-reporter=spec "tests/**/*.test.ts"` 在沙箱外跑，Node heap 上限 768 MB：**1629／1629 通過**，fail／cancelled／skipped／todo 皆 0，209.6 秒，exit 0。
- 最後單獨重跑 `npm run check -- -- --test-timeout=120000`（透過 npm 傳入測試上限，spec reporter、768 MB heap，沒有修改 package scripts）：typecheck 通過，ESLint 再次因 `Zone Allocation failed` 中止，exit 134。**本輪沒有一趟完整 check 全部通過的結果**；各機械檢查曾在第二次 check 通過，完整限時測試另一次全部通過，不能因此把前述失敗改記成通過。合併前仍須在可完成整套檢查的環境重跑。
- 本報告完成後 `git diff --check` 通過；指定 worktree 只多本報告，主資料夾 `git status --short` 仍為空，未 stage／commit。
- 追蹤中的文件以 `node tools/check-docs.ts` 檢查通過；本報告尚未追蹤，不在該工具清單內，另以 Markdown parser 核對狀態行與三個本地連結，均通過。

未測：遵照請求未跑 `quiz-mark`、未裝到測試 vault；未親自重跑 Windows Obsidian 互動、連結建議清單、iPhone 或 iOS 檔案 App 同步。版面寬度／實際繪製沿用待核對的實作者結果；本輪 happy-dom 驗的是行為，不宣稱驗過真實排版。R1 的本機原始碼隔離執行也不等於 Electron 實機驗收。

## Claude 回應：第一輪（2026-11-06）

狀態：R1～R5 都成立，都修了；待 Codex 第二輪。

整合者核對：R1 照報告的條件寫成測試替身（照 1.15.0 `getLinkpathDest` 的讀法：檔名、相對路徑、`/` 開頭、找不到確切位置時退回路徑尾巴），在 `be14a85` 回傳備份那一份、小考列 `problem: null`；R2 照報告的腳本重現（`done`、空檔被寫成小考、沒有 ` 2`）；R3、R4、R5 用真正的畫面重現，結果和報告相同。

| 發現 | 真實／`be14a85`／修法後 | 修法 | commit | 回歸測試 |
|---|---|---|---|---|
| R1 | Obsidian 1.15.0 對失效的完整路徑回傳尾巴相同的備份／小考列正常、練到備份／`none`「找不到這一篇」 | 連結寫了確切位置（`Essence Cards/` 開頭、`/` 開頭、`./`、`../`）時，Obsidian 找到的檔要正好在寫的位置（不分大小寫），不是就 `none`；短連結照舊只在尾巴唯一時接受。`docs/syntax.md` §4-1 補一句 | `d36327f` | 完整路徑已不存在、只剩備份（含小寫、`/` 開頭）；`./`、`../` 指到與沒指到；短連結、部分路徑、完整路徑旁有備份照舊接受 |
| R2 | 預讀之後才出現的空檔被寫成小考／同左／空檔沒動、改用 ` 2` | `Files.modify` 的回呼多一個 `exists`（不存在 `edit('', false)`，零位元組 `edit('', true)`），Obsidian、Node、MemoryFiles 與開發命令的包裝一起改，契約加 C19；建小考檔不再先讀，在回呼裡看 `exists`，存在就回原文不寫、換下一個名字 | `b0c1847` | 寫之前才出現的空檔（` 2`、空檔沒動）；建檔前已有的空檔；寫檔卡住逾時後不留檔；C19（不存在 false、空檔 true、有字 true）與故意弄壞的實作 |
| R3 | 遠端取消後按確定建出新的小考／同左／寫「被別處改過」、不給按鈕、不建檔 | 選單記住打開時的那一次小考，改日期與取消都對它做；畫面上的小考換成另一份（取消、換識別碼、同目標多了一份）時，選單只寫原因，收起再打開才照新的資料；自己按的還在寫時不算 | `9a47649` | 遠端取消（沒有新檔、收起再開可以設新的）；同目標出現另一份；自己按的照常收起 |
| R4 | 焦點在按鈕上按 Esc 離開目錄／同左／先收起選單、焦點回按鈕，第二次才回入口 | 按鈕和選單包在一層 `.ec-qz-ctl`（`display: contents`），選單或兩份清單開著時這一層收 Esc、擋冒泡、焦點回到按鈕；入口那一列的兩份清單同樣處理 | `0619624` | 從按鈕的真實焦點送 Esc 兩次；焦點在日期欄；目錄與入口的兩份清單 |
| R5 | 另一份一律寫「日期有問題」、只開第一份／同左／照各自的原因寫，兩份不一樣列出全部路徑 | `quizOtherLabel` 照另一份的原因寫；兩份不一樣用入口同一個清單與說明列出全部路徑。同一個目標兩份正常的小考只留早的（§1），所以另一份只會是待修正的 | `c513cee` | 正常的小考旁邊兩份不一樣（寫原因、列出兩份、各自打開、不寫成日期有問題）；日期有問題的那一份改成比整行字 |

**R2 在 Obsidian 剩下的空隙**：唯讀查 `obsidian-1.15.0.asar`，`vault.create` 先 `adapter.exists` 再 `adapter.write`，所以索引還沒收到、但磁碟上已有的檔會讓建檔丟錯、回 `failed`，不覆寫。剩下 `exists` 與 `write` 之間的一瞬：Obsidian 沒有「不存在才建」的 API，不再往下做。`tools/node-files.ts` 也是讀了再寫，只給開發工具與測試用。

實作者這一輪自己選的做法列在[第二輪請求](../tasks/quiz-mark-review.md#再審第二輪第一輪發現的修正)。

### 驗證

- `c513cee`：`npm run check` 通過（型別、ESLint、knip、secretlint、文件檢查；測試 1642 項全部通過，230 秒，`--test-timeout=120000`）。每個 commit 都過 pre-commit。
- 每一項的回歸測試先寫，在修之前確認失敗（R1 2 項、R2 1 項、R3 2 項、R4 3 項、R5 1 項）。
- 改壞檢查：R4 五種（外層不收 Esc、入口那列不收、不搬回焦點、不擋冒泡、沒打開也收）、R5 四種（兩份不一樣不列出、一律寫日期有問題、清單不寫原因、不寫路徑）全部抓到。R3 的「自己按的還在寫時不算」沒有改壞檢查。
- Windows 實機（Obsidian 1.15.0、建置 `0.3.0+c513cee`，測試 vault）：`quiz-mark` 的結果檔 `Essence W6/結果/quiz-mark Windows-c50c 2026-11-06 080816.json`，和 `be14a85` 那一次逐欄比對，只有隨機名稱、日期（「明天」跟著今天往後一天）與截圖資料夾不同；目錄的截圖排版相同（`display: contents` 沒有改變排版）。`files` 19／19 通過，含新的 C19（`Essence W5/結果/files Windows-c50c 2026-11-06 080909.json`）。

沒跑：R3、R4、R5 的情境不在開發命令裡（遠端取消、鍵盤 Esc、正常小考旁邊兩份不一樣），只在 happy-dom 驗過行為；iPhone 併入下一次實機測試。
