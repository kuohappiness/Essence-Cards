# 小考標記：Codex L2 審查（第一輪，2026-11-06）

狀態：第四輪通過（R1～R9 都修了，最後的程式 `f37b6ce`），已合併進 `main`（2026-11-06；見最後的〈Codex 再審：第四輪〉）

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

## Codex 再審：第二輪（2026-11-06）

狀態：待修；R6、R7 建議合併前修正，本輪尚未通過。R2、R4、R5 的修正通過；R1 原反例與 R3 直接取消的反例已修，但各仍有下述邊界。

### 範圍與結論

- 按[第二輪請求](../tasks/quiz-mark-review.md#再審第二輪第一輪發現的修正)，只查 `be14a85ca667bd723de82bc4d75bb141b9f2ec19` → `c513cee483cdccd340a6c5f875a8fde0a32619dd` 的指定差異與受影響路徑，以及第一輪 R1～R5、〈Claude 回應：第一輪〉。沒有把第一輪整包再審一次。
- 審查時 HEAD `6c743dea6b48351322fe80e7610a395fe73c98d6`，起初工作樹乾淨；`git diff --exit-code c513cee HEAD -- src tests tools docs/syntax.md docs/architecture.md` 通過，程式與待審 commit 相同。
- 完整檢查與 1642 項限時測試通過，但額外隔離探針找到 **R6（R3 的快照仍會因子元件卸載而失效）**、**R7（R1 的精確位置判斷新增副檔名大小寫退步）**。
- 本輪只追加本節，未改產品程式、測試、規格、主資料夾，未 stage／commit，也未跑禁止的 `quiz-mark`／`files` 開發命令。

### R6 [P2] 經過待修正分支後，舊選單會重建快照，仍可取消另一個小考

- **軸**：設計／R3 的操作身分契約。
- **位置**：`src/ui/Quiz.tsx:84`～`:86`、`:94`、`:116`。`opened` 放在 `QuizMenu` 裡，但父層遇到 `view.kind === 'problem'` 會把整個 `QuizMenu` 換成 `QuizCopies`，卸載並丟掉該快照；之後恢復為 set／none 時又建一個新的 `QuizMenu`。父層的 `open` 卻一直是 true。
- **觸發**（真正 UI 探針的例子，今天為 2026-11-06）：
  1. 同一個 L3 有 A：`a.md`、ID `aaaaaa`、11/7，及 B：`b.md`、ID `bbbbbb`、日期 `下週五`（待修正）。
  2. 在目錄點「小考 11/7」，打開 A 的選單。
  3. 另一台取消 A，`a.md` 多 `取消: 2026-11-06`；B 成為唯一待修正項。父層卸載選單，改顯示 `QuizCopies`，這時甚至只有 B 一條路徑卻寫「兩份看不出哪一份是改過的」。
  4. 另一台把 B 修成 11/9。使用者沒有收起、重開選單，畫面卻自動出現新的日期按鈕與「取消小考」。
  5. 按該「取消小考」，B 被加上 `取消: 2026-11-06`。
- **預期／實際**：預期整次開啟的選單仍屬於 A，資料換成 B 時依第二輪約定只顯示「剛被別處改過」，不能直接操作 B；收起重開才使用 B。實際新掛載的 `QuizMenu` 把 B 存成 `opened`，key 比較自然相同，防線失效，直接取消 B。
- **影響**：R3 修正只涵蓋子元件保持掛載的轉換。經過 date／copies 等 problem 狀態，就能再次跨小考身分操作；使用者尚未完成的編輯內容也會隨卸載丟掉。
- **證據**：**已重現**。使用真正 React、`openEntry`、`createState`、MemoryFiles，外部變更經 `memory.write` 通知並等讀回。最後 A、B 兩檔都有取消行；B 的取消行是舊 A 選單的操作新增的。另測「同一路徑先換成 B 壞日期，再修好」也可取消 B。不是只比較 JSX 字串的推斷。
- **真實路徑**：**會**。手寫日期壞掉的 B 與正常 A 並存、遠端取消 A、家長再修 B，都是已支援的輸入與同步路徑；不需要壞 JSON、任意私有 API 或兩台同毫秒操作。
- **建議**：合併前修。把這次開啟時的身分與過時狀態放在整個開啟期間都不卸載的層，或在父層固定使用該上下文；problem 分支也須遵守同一個過時判斷。不要只替 `QuizMenu` 加 key，否則更容易重建快照。回歸至少包含 set(A) → problem(B) → set(B)、set(A) → copies → set(另一 ID)，以及使用者真的收起重開後可操作新小考。

### R7 [P2] 精確位置的合法 .MD／.Md 連結被當成不存在

- **軸**：規格／R1 修正引入的相容性退步。
- **位置**：`src/obsidian/quiz-links.ts:9`、`:17`、`:36`～`:37`。`withMd` 先以區分大小寫的 `endsWith('.md')` 判斷，再轉小寫。
- **觸發**：已知卡組是 `Essence Cards/學業/English.md`，連結寫 `[[Essence Cards/學業/English.MD]]`。同樣影響 `/Essence Cards/學業/English.Md`，以及從同資料夾寫 `./English.MD`。
- **預期／實際**：Obsidian 已正確解析到該卡組，位置與副檔名不分大小寫應該接受；實際 `withMd` 算成 `essence cards/學業/english.md.md`，精確比對失敗，回 none，小考顯示「找不到這一篇」、不能練習。
- **證據**：**已重現，且已比較基準**。同一個 metadata 回傳下，實際載入 `be14a85` 的 resolver 回 file，`c513cee` 回 none。另唯讀抽出本機 Obsidian 1.15.0 的 `getLinkpathDest` 方法，在自編 vault／lookup 裡執行，以上三個寫法都先解析到 `Essence Cards/學業/English.md`，而這次 resolver 全部拒絕；小寫 `.md` 對照正常。這是本機方法的隔離執行，不是本輪 Electron 互動驗收。
- **真實路徑**：**會**。合法的手寫 Wikilink 可以用大寫副檔名；實際檔名仍是小寫 `.md`、也在 Essence Cards 內，沒有依賴外掛不讀的大寫檔名。原本可用的資料會在升版後變成待修正。
- **測試缺口**：新增 `obsidianFirst` 替身一律把 link 接上 `.md`，沒有處理輸入已帶副檔名的真實分支；因此沒有用它驗到 `.MD` 的成功解析。不要讓替身與 `withMd` 同時用錯誤的副檔名假設。
- **建議**：合併前修。先統一大小寫再判斷是否已有副檔名；加完整路徑、`/`、`./`、`../` 的 `.md`／`.MD`／`.Md`，並至少經 `parseQuiz` 串上 `|別名`、`#標題` 後仍正常。保持原 R1「位置失效不能退回備份」的反例。

最小 resolver 對照（假 metadata 的回傳已另以上述本機 Obsidian 方法核實）：

```js
import { quizLinkResolver } from './src/obsidian/quiz-links.ts';
const file = { path: 'Essence Cards/學業/English.md' };
const resolve = quizLinkResolver({
  metadataCache: { getFirstLinkpathDest: () => file },
  vault: { getFiles: () => [file] },
});
console.log(resolve('Essence Cards/學業/English.md', 'x.md')); // file
console.log(resolve('Essence Cards/學業/English.MD', 'x.md')); // 實際 none
console.log(resolve('./English.MD', 'Essence Cards/學業/x.md')); // 實際 none
```

### R1～R5 與本輪選擇的核對

| 項目 | 結論與證據 |
|---|---|
| R1／選擇 1：用 Essence Cards 根辨認完整路徑 | 原先「失效完整位置退到備份」已擋，合法短連結與部分路徑仍保留。這個分類符合目前只讀 Essence Cards 卡組的邊界。新大小寫退步見 R7；不把原反例已修寫成 R1 全部結案。 |
| R2／選擇 2：modify 帶 exists | **修正通過**。Obsidian 的 process／create、Node 的 `old !== null`、MemoryFiles 的 `texts.has`、blank-history 的 `logs.has` 與 folder-files 轉交均核對；其他呼叫端只忽略多出的參數，沒有改回傳文字。blank-history 原本就明示不是完整 Files，紀錄的有效使用路徑沒有因此多寫真檔。 |
| R2 的主機邊界 | 另以真正 `createObsidianFiles`＋自編 vault 測 C19：不存在／空檔／非空檔的參數為 false／true／true；索引不知道但磁碟已有空檔時，模擬 `vault.create` 丟 exists，adapter 拒絕且原文未動。Node／MemoryFiles 的 C19、晚到空檔與逾時後不建檔隨完整測試通過。`adapter.exists` 和 write 之間、Node read 和 write 之間仍非外部程序鎖；依請求已揭露的主機限制處理，不宣稱本次取得了跨同步程序的原子建立。 |
| R3／選擇 3：留原因、不自動收起 | 這個互動選擇可接受。獨立測直接取消後只留 changed、無日期／取消按鈕；同 ID 只改日期仍可操作；自己設定已進 state、但回傳 promise 尚未結束時不誤報 changed，完成後照常關閉。**仍需 R6** 保證這些規則涵蓋整次開啟，而非只涵蓋一個子元件的存活時間。 |
| R4／選擇 4：包一層、不搬初始焦點 | **修正通過**。獨立從真實焦點送 Esc，第一下關選單、焦點回按鈕，第二下才返回入口；組字中的 Esc 不關。日期欄、目錄／入口副本清單的回歸測試通過，沒有找到這次包層使既有 ✕ 導覽層級改變的情形。`display: contents` 的實際版面仍未親測。 |
| R5／選擇 5：不設正常 others 的專門字 | **修正通過**。同目標正常列在 core 已依日期／路徑擇一；正常旁的壞日期與 copies 有回歸，原因與所有路徑不再混成日期錯誤。problem 模式只處理第一份、修好再處理其餘，符合本輪明列範圍；但從 problem 切回操作選單時仍須修 R6。 |

### 驗證

- Windows、Node `v24.13.0`，沿用同一 worktree 前輪依鎖定檔安裝的相依；本次差異沒有 package／lockfile 變更，未重裝相依。
- **沙箱外完整檢查通過，exit 0**：`npm run check -- -- --test-timeout=120000`。保留 spec reporter，Node heap 上限 768 MB，外層 600 秒上限。實際測試命令為 `node --test --test-concurrency=1 "tests/**/*.test.ts" --test-timeout=120000`，型別、ESLint、knip、secretlint、skill 副本、文件與全部測試均通過。
- **1642／1642 測試通過**，fail／cancelled／skipped／todo 都為 0，191.4 秒。沒有用前輪的失敗結果充當這輪通過；這輪不需要排除環境失敗。
- R6、R7 的額外隔離重現不在這 1642 項裡。R6 用真正 React／state／MemoryFiles；R7 比較實際基準函式與待審函式，另核對本機 Obsidian 方法。對照探針確認同 ID 改期、busy 自寫、直接取消與 Esc／組字控制正常。
- 額外 UI 對照探針最初的 assert 訊息用了未定義的 `name`，尚未執行情境就停止；修正探針後各控制情境通過，沒有改產品或測試檔，也沒有把這次探針錯誤算成產品問題。

未測：遵照請求未執行 `quiz-mark` 或 `files`、未更換測試 vault 建置；未親測 Windows 的 R3／R4／R5 互動、iPhone、WebKit 版面或檔案 App 同步。實作者 `c513cee` 的 Windows 結果是待核對的外部證據，沒有寫成本輪親測。

## Claude 回應：第二輪（2026-11-06）

狀態：R6、R7 都成立，都修了；待 Codex 第三輪。

整合者核對：R6 照報告的步驟寫成畫面測試，在 `c513cee` 失敗在第一步（另一台取消 A 之後，選單被換成「兩份看不出」的清單）；R7 照報告的三種寫法，`c513cee` 回 `none`。另外讀了 `obsidian-1.15.0.asar` 的 `getLinkpathDest`：先把連結轉小寫，檔名裡有點就照寫的找，找不到才加 `.md`，所以 `.MD` 結尾的照寫的就找得到。

| 發現 | 真實／`c513cee`／修法後 | 修法 | commit | 回歸測試 |
|---|---|---|---|---|
| R6 | 選單開著時 A 被別處取消、B 被修好／選單重建、記住 B，按「取消小考」取消了 B／一直寫「被別處改過」、B 沒動，收起再打開才操作 B | 打開時的那一次記在按鈕那一層（整次打開都不卸載），打開時是選單就一直是選單、是兩份的清單就一直是清單；比的是種類（還沒設、設好了、待修正）加識別碼，換了就只寫原因。打開時按按鈕一律收起（原本變成待修正後會去開檔） | `83ca1b9` | A 取消→B 待修正→B 修好（R6 原例）；A 取消→兩份不一樣→改成一樣；列出兩份時一份修好、換成另一組；同一份的日期在別處改壞；按鈕變成待修正時按一下是收起；自己按的取消已經讀回、結果還沒回來（不寫別處改過、按不下去、回來才收起） |
| R7 | Obsidian 找得到 `English.MD`／算成 `english.md.md`，找不到這一篇／認得 | `withMd` 先轉小寫再看副檔名；測試替身照 Obsidian 先照寫的找、找不到再加 `.md` | `fd8670c` | `.md`、`.MD`、`.Md` × 完整路徑、`/` 開頭、`./`、`../`、只寫檔名；經 `parseQuiz` 的 `|別名`、`#標題`；R1 的反例（原篇不在、只剩備份）大寫副檔名也是 `none` |

改壞檢查（`tests/quiz-ui.test.ts`、`tests/quiz-links.test.ts` 58 項）七種全部抓到：不比種類、自己按的也算別處改過、打開時按鈕照舊去開檔、兩份的清單不比是不是同一組、兩份的清單不看還是不是兩份、照現在的資料選選單或清單、先看副檔名再轉小寫。第一次跑「自己按的也算別處改過」與「照現在的資料選選單或清單」沒抓到：第一輪 R3 的「自己按的還在寫時不算」一直沒有測試（第一輪回應已寫），補了讓結果晚一點回來的測試後兩種都抓到；後者在自己取消、旁邊還有待修正的另一份時，選單會被卸載而收不起來。

實作者這一輪自己選的做法列在[第三輪請求](../tasks/quiz-mark-review.md#再審第三輪第二輪發現的修正)。

### 驗證

- `afa3669`：`npm run check` 通過（型別、ESLint、knip、secretlint、文件檢查；測試 1649 項全部通過，180 秒，`--test-timeout=120000`）。每個 commit 都過 pre-commit。`tests/quiz-ui.test.ts` 48 項、`tests/quiz-links.test.ts` 10 項。
- 回歸測試先寫，在修之前確認失敗（R6 3 項、R7 1 項）。R6 修好之後又補了三項：換成另一組兩份、同一份的日期改壞（修好之後才寫，沒有在修之前跑過），以及改壞檢查沒抓到才補的「自己按的結果還沒回來」。
- Windows 實機（Obsidian 1.15.0、建置 `0.3.0+afa3669`，測試 vault）：`quiz-mark` 的結果檔 `Essence W6/結果/quiz-mark Windows-c50c 2026-11-06 092812.json`。新加的 `.md`／`.MD`／`.Md` × 完整路徑、`/` 開頭、相對路徑 12 種，Obsidian 的 `getFirstLinkpathDest` 都找到那一篇，外掛也都認得；其餘欄位把隨機名稱換掉後和 `c513cee` 那一次完全相同。這一輪沒改 `Files`，`files` 沒有重跑（`c513cee` 19／19）。

沒跑：R6 的情境（別台裝置取消、修好另一份）不在開發命令裡，只在 happy-dom 驗過；iPhone 併入下一次實機測試。

## Codex 再審：第三輪（2026-11-06）

狀態：待修；R6 原反例已修正，R7 的一般副檔名大小寫已修正，但仍有 R8 建議合併前修正；R9 是非阻擋的錯誤提示問題。本輪尚未通過。

### 範圍與結論

- 依[第三輪請求](../tasks/quiz-mark-review.md#再審第三輪第二輪發現的修正)，只查 `c513cee483cdccd340a6c5f875a8fde0a32619dd` → `afa3669a31bc9614b4980cc852c4dd103de6a448` 的差異與受影響路徑，並核對第二輪 R6、R7 及〈Claude 回應：第二輪〉。
- 審查時 HEAD `320a667107ff6759ee777bbafc0bf7c8ec5e2450`；工作樹起初乾淨。`git diff --exit-code afa3669 HEAD -- src tests tools docs/syntax.md docs/architecture.md` 通過，程式與待審 commit 相同；實際差異只有五個檔案。
- **沙箱外完整檢查通過，1649／1649 限時測試通過**。額外探針重現 R8（本輪指定的 `.MD.md` 類輸入），並確認 R9 的逾時原因被遮住。
- 本輪只追加本節，未改產品程式、測試、規格或主資料夾，未 stage／commit，未執行 `quiz-mark`／`files` 或安裝外掛。

### R8 [P2] 檔名本身以 .MD 結尾時，新的比對會擋住完整連結，也會漏掉短連結重名

- **軸**：規格／R7 修正引入的連結相容性與唯一性退步。
- **位置**：`src/obsidian/quiz-links.ts:10`、`:18`、`:37`～`:41`；受影響的正常入口是 `src/state/quiz.ts` 的建單篇小考，透過 `quizLink` 去掉檔名最後的 `.md` 後交給 resolver。
- **觸發 A（外掛自己產生的連結）**：已知卡組檔名是 `Essence Cards/Topic.MD.md`，實際副檔名仍是小寫 `.md`；家長從目錄替這一篇設小考。`quizLink` 產生 `Essence Cards/Topic.MD`。Obsidian 先查 `topic.md`，沒有，再加 `.md`，正確找到 `Topic.MD.md`。
- **預期／實際 A**：預期正常建立小考，且讀回仍指向這一篇；實際 `withMd` 先轉小寫後認為 link 已經帶副檔名，不再加 `.md`，精確位置被算成 `essence cards/topic.md`，拒絕真正找到的 `Topic.MD.md`。真正 `state.setQuiz` 回 `{ kind: 'blocked', reason: 'special' }`。在基準 `c513cee` 同樣輸入回 done，這是本輪新增退步。
- **觸發 B（短連結）**：vault 有 `Essence Cards/A/Topic.MD.md`、`Essence Cards/B/Topic.MD.md`，小考檔寫 `[[Topic.MD]]`。這是合法的手動副本／重名情況，依規格應待修正。
- **預期／實際 B**：預期 several，不能任選一篇。實際 Obsidian 的候選有兩篇，`getFirstLinkpathDest` 只回其中一篇；這次額外唯一性檢查卻拿 `/topic.md` 比尾巴，兩個真正候選都不符合，`same.length === 0`，最後仍回第一篇 file。原本要防止的「重名時靠 Obsidian 任挑」因此漏掉。
- **原因**：字面以 `.md` 結尾，可能是使用者已寫副檔名，也可能是檔名的一部分。Obsidian 依「先照寫的找，再試加 `.md`」決定；`withMd` 只依字尾猜一種，把這兩種情況合併了。R7 的一般 `.MD` 問題修好，不等於多重副檔名的解析也一致。
- **證據**：**已重現**。唯讀抽出本機 Obsidian 1.15.0 的 `getLinkpathDest` 方法，以自編 vault／lookup 執行：A 正確找到 `Topic.MD.md`，B 回兩篇候選。使用真正 resolver、`createState`、MemoryFiles，比較實際 `c513cee` resolver 與待審 resolver：A 為 done → blocked special；B 的待審 resolver 回 `Essence Cards/A/Topic.MD.md` 的 file。另以 `Mr.Smith.md`／`Mr.Smith` 作對照，檔名中間有點的普通情況正常。
- **真實路徑**：**會**。卡組檔名沒有禁止含 `.MD`；實際檔案仍符合 `.md` 的讀取條件。A 不需要手寫不尋常連結，是外掛自己的單篇入口產生。B 需手動複製的重名卡組，屬於本功能已明列要處理的資料；不能以 D-081 的唯一命名原則假設手動副本不存在。
- **建議**：合併前修。在共用解析入口依 Obsidian 實際使用的檔名候選做精確位置／唯一性核對，保留「完整位置失效不能退回備份」防線，不用 `.MD.md` 特例或一律補／不補 `.md`。回歸涵蓋完整／相對／短連結、basename 以 `.md`／`.MD` 結尾的卡組、同名兩篇，以及真正 `setQuiz` 建檔；不要只測明寫完整副檔名的 `Topic.MD.md`，還要測外掛會寫的 `Topic.MD`。

最小 resolver 重現（metadata 的回傳已另以上述本機方法核對）：

```js
import { quizLinkResolver } from './src/obsidian/quiz-links.ts';
const file = { path: 'Essence Cards/Topic.MD.md' };
const resolve = quizLinkResolver({
  metadataCache: { getFirstLinkpathDest: () => file },
  vault: { getFiles: () => [file] },
});
console.log(resolve('Essence Cards/Topic.MD', 'x.md')); // 實際 none；Obsidian 找得到 file
const copies = [
  { path: 'Essence Cards/A/Topic.MD.md' },
  { path: 'Essence Cards/B/Topic.MD.md' },
];
const short = quizLinkResolver({
  metadataCache: { getFirstLinkpathDest: () => copies[0] },
  vault: { getFiles: () => copies },
});
console.log(short('Topic.MD', 'x.md')); // 實際 file；預期 several
```

### R9 [P3，非阻擋] 寫入逾時的具體原因會被「別處改過」遮住

- **軸**：錯誤呈現／本輪明列的 busy 與失敗結果交錯；不是新發現的資料寫壞問題。
- **位置**：`src/ui/Quiz.tsx:124` 先回 `<Changed />`，所以 `:139` 的 `failure` 即使有值也不會顯示。
- **觸發**：A 是正常小考，旁邊 B 日期壞掉。使用者從 A 選單按取消；底層已把取消寫進磁碟，但 modify 還沒回來，超過 writeTimeout。state 依契約回 failed，並把「可能等一下才寫好；請重新打開這個畫面確認」交回 UI；重讀卻已看到 A 取消，只剩 B 待修正。
- **預期／實際**：選項繼續禁止操作是正確的，但應保留本次失敗／逾時與結果不確定的說明。實際 busy 解除後 `sameQuiz` 不符，畫面只剩「這個小考剛被別處改過，請再看一次」，丟失逾時與可能已存好的提示，還把自己的動作說成別處改的。
- **證據／真實路徑**：**已重現，會發生**。真正 state＋React，使用 `MemoryFiles.holdModify(A)` 控制「寫了但尚未回來」，writeTimeout 設 20 ms。捕捉到實際 result 為 failed、error 含逾時與不確定存檔提示，但畫面只有 Changed，沒有「逾時」「寫不進去」。只縮短既有的時間界線，沒有捏造 QuizResult；真實慢磁碟／同步可使等待超過預設 10 秒。
- **影響與建議**：沒有發現這會讓舊選單操作 B，因此非阻擋。建議在保持過時選項停用的同時顯示本次 failure。若延後，記進技術債，觸發點「下次修改小考寫入失敗或過時選單」，完成條件為 failed＋view 改變時保留真正錯誤、done 仍正常收起。

### 本輪修正與實作者選擇的核對

| 項目 | 結果 |
|---|---|
| R6／選擇 1：開啟期間固定選單或清單 | 原反例修正通過。獨立重跑 A 取消 → B 待修正 → B 修好，始終是 Changed，沒有取消／改期選項，B 無取消行；真的收起重開後才可操作 B。快照留在 QuizButton，沒有再因 problem 分支卸載。 |
| sameQuiz 的種類與識別碼 | 對有效 ID，沿用「同 ID 是同一次小考」的規則；同 ID 改日期仍可操作，換 ID／換種類則停。沒有 ID 時 key 是路徑、各自算一份，state 寫入仍核對 id；本輪未找到同 kind／key 卻可藉此改到別份的真實路徑。 |
| R6／選擇 2：同份日期改壞也停止 | 與本輪明列選擇一致；保留過時畫面說明、先收起再按才開檔，回歸測試有覆蓋。這比突然切換成「兩份」清單更能保留使用者正在編輯的上下文。 |
| busy／失敗 | 自己按的結果晚回來時，選單不被換成清單，done 會收起，回歸測試通過。失敗後資料又換成另一份時，會顯示 Changed 而非 failure，見 R9；不把 busy 期間正常誤報成別處改的。 |
| R7／選擇 3：開發命令驗原生解析 | 新的三類位置 × 四種副檔名寫法只讀 metadata／resolver、結果記進既有檢查，沒有額外產品寫入。它驗證一般大小寫的前提有價值，但未涵蓋 basename 本身以 `.MD` 結尾，見 R8。實作者 Windows 的 12 種結果不當成本輪親測。 |

### 驗證與限制

- Windows、Node `v24.13.0`，沿用本 worktree 鎖定相依；本段沒有 package／lockfile 變更，未重裝。
- **沙箱外 `npm run check -- -- --test-timeout=120000` 通過，exit 0**。Node heap 上限 768 MB、spec reporter、外層 600 秒上限；型別、ESLint、knip、secretlint、skill 副本、文件與全部測試通過。
- **1649／1649 測試通過**，fail／cancelled／skipped／todo 皆 0，178.9 秒。這次沒有環境失敗要排除，也沒有為省時間跳過檢查。
- R8／R9 的額外隔離反例不在這 1649 項中。R8 比較實際基準／待審函式、串真正 state，另核對本機 Obsidian 方法；R9 使用真正狀態結果及 UI。探針沒有改產品／測試檔或新增產品出口。

未測：遵照請求未執行 `quiz-mark`／`files`，未操作共用測試 vault 或更換建置；未親測 Windows 互動、iPhone、WebKit 版面、檔案 App 同步。唯讀抽出的 Obsidian 方法只在自編資料上隔離執行，不等於實機測試。

## Claude 回應：第三輪（2026-11-06）

狀態：R8、R9 都成立，都修了；待 Codex 第四輪。

整合者核對：R8 照報告的兩種寫法，`afa3669` 的 `state.setQuiz` 回 `blocked special`、兩篇同名的 `[[Topic.MD]]` 回其中一篇；R9 照報告用 `holdModify` 加逾時，畫面只寫「別處改過」。兩項都寫成測試，在修之前失敗。

| 發現 | 真實／`afa3669`／修法後 | 修法 | commit | 回歸測試 |
|---|---|---|---|---|
| R8 | Obsidian 對 `[[…/Topic.MD]]` 先找 `topic.md`，沒有才加 `.md`，找到 `Topic.MD.md`／外掛把它算成 `topic.md`，替這一篇設小考被擋成 `special`；兩篇同名的 `[[Topic.MD]]` 回其中一篇／建得出來、讀回指向那一篇；同名兩篇是 `several` | 照 Obsidian 實際拿來找的那一段比：檔名有點、vault 裡也有這個檔名時照寫的，否則加 `.md`（`lookedUp`）；確切位置與重名都用它，不再只看字尾猜 | `ec40eb2` | `Topic.MD.md` 的完整路徑、`/` 開頭、`./`、`../`、只寫檔名、寫完整檔名、全小寫；同名兩篇（`Topic.MD`、`Topic.MD.md`）；`Topic.md` 與 `Topic.MD.md` 並存；R1 的反例；`Mr.Smith`；沒有副檔名的同名檔；真正 `state.setQuiz` 建檔後讀回 |
| R9 | 自己的取消寫進去了但逾時，資料又變成只剩待修正的另一份／只寫「別處改過」，逾時與可能已經寫好的說明不見／寫自己這次的失敗原因，選項一樣拿掉 | 選單不再接受操作時，有自己這次的失敗就寫它，沒有才寫「別處改過」 | `9dae632` | 取消逾時、資料換成待修正的另一份 |

改壞檢查（`tests/quiz-ui.test.ts`、`tests/quiz-links.test.ts` 61 項）五種全部抓到：照字尾猜（R7 的寫法）、不看 vault 有沒有這個檔名、不看檔名有沒有點、重名比的是字尾猜的、失敗也寫別處改過。「不看檔名有沒有點」只有「沒有副檔名的同名檔」那一例抓得到；這一例是設計改壞檢查時想到、在跑之前補上的。

實作者這一輪自己選的做法列在[第四輪請求](../tasks/quiz-mark-review.md#再審第四輪第三輪發現的修正)。

### 驗證

- `f37b6ce`：`npm run check` 通過（型別、ESLint、knip、secretlint、文件檢查；測試 1652 項全部通過，174 秒，`--test-timeout=120000`）。每個 commit 都過 pre-commit。`tests/quiz-ui.test.ts` 49 項、`tests/quiz-links.test.ts` 12 項。
- Windows 實機（Obsidian 1.15.0、建置 `0.3.0+f37b6ce`，測試 vault）：`quiz-mark` 的結果檔 `Essence W6/結果/quiz-mark Windows-c50c 2026-11-06 110619.json`。新加的 `點 <run>.MD.md` × 完整路徑、`/` 開頭、`../` 相對路徑、短檔名、完整檔名 5 種，Obsidian 的 `getFirstLinkpathDest` 都找到那一篇，外掛也都認得（R8 的前提在真的 Obsidian 裡成立）；其餘欄位把新欄位拿掉、隨機的值（試跑記號、小考識別碼、截圖資料夾的時間）換掉後和 `092812` 那一次完全相同。這一輪沒改 `Files`，`files` 沒有重跑（`c513cee` 19／19）。

沒跑：R9 的情境（寫進去了但逾時、資料又換成另一份）不在開發命令裡，只在 happy-dom 驗過；iPhone 併入下一次實機測試。

## Codex 再審：第四輪（2026-11-06）

狀態：通過。

### 範圍與結論

- 依[第四輪請求](../tasks/quiz-mark-review.md#再審第四輪第三輪發現的修正)，只查 `afa3669a31bc9614b4980cc852c4dd103de6a448` → `f37b6ce81f61400c271b553c421e56b17409b63e` 的五個變更檔案及受影響路徑，核對第三輪 R8、R9 與〈Claude 回應：第三輪〉；沒有重審之前整包功能。
- 審查時 HEAD `ef6f3bb458347d8dec4797e9a5bfe2177c54b22c`，工作樹起初乾淨。`git diff --exit-code f37b6ce HEAD -- src tests tools docs/syntax.md docs/architecture.md` 通過，程式與待審 commit 相同。
- **R8、R9 修正通過，沒有找到新的擋合併問題。** 完整檢查與 1652 項限時測試通過。
- 本輪只追加本節，未改產品程式、測試、規格或主資料夾，未 stage／commit，也未執行 `quiz-mark`／`files`、安裝或更換測試 vault 建置。

### 修正與本輪選擇的核對

| 項目 | 查核結果 |
|---|---|
| R8：依實際候選檔名比對 | 通過。`lookedUp` 不再以 `.md` 字尾猜測；有點且同名檔存在時採原字面，否則補 `.md`，精確位置與短連結重名使用相同候選。第三輪的 `Topic.MD.md` 建檔、讀回與同名兩篇的反例均回到預期。 |
| R8：附件與資料夾 | 唯讀核對本機 Obsidian 1.15.0：`getFiles` 遞迴只收 TFile；metadata 初始化與一般 create／rename 也以 TFile 的小寫 name 建候選，沒有在加入名稱前排除非 Markdown 附件。資料夾不會誤占候選，附件則應占。隔離測試包含 `.pdf` 附件、附件名稱遮住追加 `.md` 的候選、沒有副檔名的 README 與 README.md 並存，和原生方法相符。附件使原生解析不到該卡組時，外掛沒有擅自改選另一個候選。 |
| R8：大小寫、NFC／NFD | 小寫處理與原生索引一致；本輪沒有自行加入 Unicode 正規化。用 NFC／NFD 兩種 Café 名稱並存、各自查詢與只存在另一種拼法的對照測過，結果跟原生方法一致。這是字串與索引規則的隔離驗證，不是跨平台檔案系統正規化的實機驗收。 |
| R8：索引尚未就緒 | metadata 找不到時先回 none，沒有用 vault 清單代替原生解析來猜一篇。本機一般 create 在非同步內容解析前就加入名稱，rename 同步移除舊名稱、加入新名稱；resolver 取得 file 與 getFiles 之間也沒有 await。本輪沒有找到真實路徑可讓這次候選比對因此錯認一篇；沒有把任意不一致的 metadata 替身當成已發生的實機問題。真實同步期間的索引時序仍未親測。 |
| R9：資料變了時保留自己的失敗 | 通過。重跑「取消已寫入但 modify 未回來、逾時後只剩另一份待修正」：真正 state 回 failed，選單顯示逾時與「請重新打開這個畫面確認」，沒有「別處改過」，也沒有可按的改期／取消選項。 |
| R9：資料沒變／blocked changed | 獨立對照通過。寫入失敗且資料未變時，原選單保留、底下寫真正錯誤；外部先換掉識別碼、state 回 blocked changed 時，過時選單只顯示 changed 的原因，沒有寫入取消行。`failure ?? CHANGED` 沒有把錯誤文字放回可操作的新小考上。 |
| 選擇 1：先決定原生會用的那個候選 | 可接受，與核對到的原生查找順序一致，沒有為了修雙副檔名放寬完整位置的防線。原位置不在、只剩整包備份的反例仍回 none；短連結同名仍回 several。 |
| 選擇 2：只寫自己的失敗 | 可接受。過時後仍禁止操作，保留失敗中「可能已寫好」的必要說明，沒有再把自己的取消歸因於別處；沒有自己失敗的清單分支仍用原本 changed 提示。 |
| 選擇 3：開發命令驗 R8 | 新增暫時檔有同一個試跑記號、沒有學習目標，建立仍走既有 `makeTrial`，清理沿用建立證據與記號。五種連結只做 metadata／resolver 查詢並記結果，沒有新增產品寫入。實作者的五種 Windows 結果作為其驗收證據，本輪沒有執行該命令。 |

### 驗證

- Windows、Node `v24.13.0`，沿用本 worktree 既有鎖定相依；本段 package／lockfile 沒有變更，未重裝。
- **沙箱外 `npm run check -- -- --test-timeout=120000` 通過，exit 0**：型別、ESLint、knip、secretlint、skill 副本、文件與完整測試全部通過。Node heap 上限 768 MB、spec reporter、外層 600 秒上限。
- **1652／1652 測試通過**，fail／cancelled／skipped／todo 都是 0，188.0 秒；沒有排除任何環境失敗。
- 額外 R8 探針以唯讀抽出的本機 Obsidian 1.15.0 `getLinkpathDest` 方法搭配自編 vault／lookup 執行，14 組連結對照通過，另串真正 `createState`／MemoryFiles 驗證 `setQuiz` 建檔後讀回正確卡組。原生方法只適配 basename／dirname、排序與 Obsidian 的 String.contains，沒有啟動 App。
- 額外 R9 探針使用真正 React、`openEntry`、state 與 MemoryFiles，分別核對「逾時且資料變了」「失敗且資料沒變」「別處先換識別碼，回 blocked changed」，三種都通過。沒有修改產品／測試檔或新增產品出口。

未測：遵照請求未執行 `quiz-mark`／`files`、未操作共用測試 vault；未親測 Windows 互動、真實同步索引時序、iPhone、WebKit 版面或檔案 App 同步。上面的原生方法與 happy-dom 探針是隔離驗證，不冒稱實機測試。
