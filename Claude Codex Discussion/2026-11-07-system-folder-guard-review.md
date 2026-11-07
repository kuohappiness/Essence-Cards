# 系統資料夾的防呆：Codex L2 審查

狀態：第二輪的 F1、F4～F6 已修（2026-11-07，`48ec6cf`），等 Codex 第三輪

審查請求：[tasks/system-folder-guard-review.md](../tasks/system-folder-guard-review.md)。Codex 的回報接在下面。

## Codex 第一輪（2026-11-07）

**結論：待修，尚不通過。** 有 2 項 P1、2 項 P2，建議合併前修正。既有的完整檢查通過，不能據此認定搬回期間沒有讀寫，或刪除一定保留同步中的內容。

### 對象與驗證

- 工作目錄是指定的 worktree，分支 `claude/system-folder-guard`；開始時沒有未提交修改。待審程式是 `f1ba0974b3e99155e973fdcf1c6bbb70f2d4a020`，基準 `6fba29a366552ba40872ceb1efdb8d945dfa88b9`；執行檢查時 HEAD 是只多文件的 `6bc9dca`。
- 讀過任務 §1～§5、〈實作〉、〈Windows 實機〉與〈結果〉，以及 AGENTS.md、roadmap 的現況、code-quality 的 SKILL.md／review.md、quality.md、相關決定及受影響的呼叫端。對照兩軸：規格、規範與設計。
- Node `v24.13.0`。沙箱外 `npm ci` 成功；沙箱外執行 `$env:NODE_OPTIONS='--test-reporter=dot'; npm run check -- -- --test-timeout=30000`，exit 0，型別、lint、knip、secretlint、skill 一致性、文件檢查與 **1900 個測試全通過**。log 在本 worktree 的 `.local/system-folder-review/check.log`，不進 Git。第一次把 timeout 放進 NODE_OPTIONS 被 Node 拒絕，已改成由 npm 傳給測試指令，沒有把那次當驗證結果。
- 新增隔離探針在本 worktree 的 `.local/system-folder-review/probes.test.ts`，沒有改產品程式或正式測試；執行 `node --test --test-timeout=10000 .local/system-folder-review/probes.test.ts`，8 個探針全通過，輸出在同目錄 `probes.log`。這些探針斷言「缺口確實存在」及其他邊界行為，不表示產品修好了；Claude 可在這個 worktree 直接重跑。
- 下文的產品路徑均指分支 `claude/system-folder-guard` 的對應檔案（`f1ba0974b3e99155e973fdcf1c6bbb70f2d4a020`）；不是主資料夾的其他版本。

### F1｜P1｜擋通知沒有擋住搬回期間的讀寫

- **軸：規格。** 任務 §1-8 要求搬走到搬回期間不追加紀錄、不改範圍檔、不補 ID；審查請求也明訂這段時間 state 不讀不寫。
- **位置：** `src/obsidian/folder-guard.ts:223–233`（`wrap` 只有 `watch` 看 `holding`；`read` 只看 `excluded`，`modify`、`append` 直接轉交）；`src/main.ts:376`（傳給 state 的 `skip` 只看 `misplaced`）；`src/state/writes.ts:111–119`。`check()` 在有 holds 時直接返回（`folder-guard.ts:104`），因此搬回期間也不會先把新位置加入 `excluded`。
- **觸發／實際：**
  1. 在複習中拖走 `紀錄/`，搬回工作尚未執行，呼叫正常的 `state.answer()`／`flush()`：原位立刻出現 `紀錄/2026-10 PC-test.jsonl`。防呆隨後發現原位被自己的寫入占住，沒有搬回，提醒成為 `both`。兩邊的紀錄均還在，但一次本來可自動復原的拖動，變成需要家長合併。
  2. 把 `考試範圍/` 拖進 `英文/`，尚在 hold 時對新路徑呼叫正常的 `state.save(editor)`：回 `{ kind: 'done', added: 1 }`，範圍檔被加上 `^aaaaab`，再連同這項修改搬回原位。這次寫入沒有靠 `Files.watch` 觸發，擋通知攔不到。
  3. 搬動前已經有一次紀錄重讀排在 state 裡，搬動後它仍直接呼叫 `read`，讀到舊位置為 null，把原有的紀錄移出 history。只攔後來的通知，攔不住已排好的讀取。
- **預期／影響：** 在搬回或決定放棄前，相關 I/O 應經過共同的保護入口；既有紀錄與範圍不應短暫失效，也不應被外掛自己的寫入擋住搬回。這不是單純通知晚到的代價。
- **證據：已重現。** 隔離探針 `F1a`、`F1b`、`F1c`，直接使用正式 `createFolderGuard`、`createState` 與共用 MemoryFiles。既有 §1-8 測試沒有在 hold 期間作答／存檔，也沒有在搬動前預排讀取，所以仍會通過。
- **真實路徑：會。** 學生作答、背景中的紀錄追加、家長存檔／離開筆記及同步通知都已接上這些公開入口；Windows 實測 R4／W1 已證實搬回可能重試約 1 秒，規格最多容許 10 秒。沒有介面或狀態門檻禁止這段時間發生這些動作。不需要惡意或非法的輸入。
- **建議：合併前修。** 在共同的讀寫／搬回協調入口處理 hold，包含已排隊、已開始的讀取與編輯器的寫回；作答應先保留、待安全時追加，不能以丟掉作答避開問題。回歸至少涵蓋上面三種時序，以及成功搬回、重試後成功、放棄後恢復三種結果。`save.ts`／`deck-actions.ts` 的 `isDeckPath` 本身不是已判定後的繞過點，問題是 hold 沒有參與寫入門檻。

### F2｜P1｜檢查為空後改用遞迴刪除，可能刪掉剛同步進來的檔案

- **軸：規格。** 任務 §1-5 的安全性質是「完全空的才刪，有東西就失敗」；〈實作者自己選的做法〉第 5 點雖揭露時間差，仍沒有滿足這個性質。這是 Windows API 退路需要重新處理的規格與實作衝突。
- **位置：** `src/obsidian/folder-host.ts:25–32`，尤其 `await empty(path)` 後的 `vault.adapter.rmdir(path, true)`；由 `folder-guard.ts:133`、`:161` 兩處使用。
- **觸發：** 非遞迴刪除回 EISDIR，第二次 list 看到空資料夾，接著 iCloud／另一個程序在 list 完成到實際刪除之間寫入檔或子資料夾。
- **預期／實際／影響：** 應留下新內容並放棄這次清理；實際仍送出遞迴刪除，會連新內容刪掉。沒有再檢查一次就能消除這個競態，因為最後一次檢查與遞迴刪除之間仍有間隔。這條 API 是刪除而不是搬到垃圾桶，可能造成使用者內容遺失。
- **證據：受控 adapter 已重現危險呼叫；真實同步時序待驗證。** 探針 `F2` 用 esbuild 載入真正的 `wireFolderGuard`，只替換 Obsidian 主機；呼叫順序是 `list empty → rmdir false → list empty → rmdir true`。在最後一個刪除開始前加入內容，遞迴刪除仍會處理它。此探針不是聲稱已在 iCloud 刪掉真實資料；遞迴刪除的破壞性來自這個 API 的語意。W2 已確認 Windows 正常會走 EISDIR 退路。
- **真實路徑：可發生，沒有邊界保證走不到。** iCloud 留下殘留位置正是這次清理的原因，原本就有外部程序同時改動磁碟；原位也可能在這段時間被新作答或同步寫入。Obsidian 清單沒看到，不代表磁碟上不會有新內容。尚未量到實際競態機率，不能把它寫成實機已發生的資料遺失。
- **建議：合併前修。** 共同刪除入口必須保留「遇到非空就不刪」的保證；若目前跨平台 API 做不到，先保留殘留並回報，不能用會刪內容的退路完成清理。由 Claude 決定可行的平台做法，再驗 Windows；加入「最後一次空檢查後才有內容」的回歸，不能只測 list 時已有檔的情形。

### F3｜P2｜搬回前的 I/O 失敗，按鈕會無聲失敗且沒有錯誤紀錄

- **軸：規範與設計。** D-155 第 2 點要求接住的非預期錯誤交給記錄器；quality.md〈本專案的做法〉要求不記錄的 catch 說明理由。任務 §1 的失敗通知與記錄同樣應涵蓋共用搬回流程。
- **位置：** `src/obsidian/folder-guard.ts:126–133`、`:207–215`；`src/ui/Entry.tsx:143–145`。
- **觸發／實際：** `host.exists(to)` 或搬回前的 `host.rmdir(to)` 拒絕。這些 await 不在 `host.move` 的 try/catch 裡；`moveBack` 只有 finally，拒絕一路到 UI，被 `.catch(() => false)` 吞掉。按鈕恢復，沒有通知，也沒有 `host.fail`。UI 的註解「失敗的原因防呆自己通知、記進錯誤紀錄」在這條路不成立。自動搬回的 `flush` 會記錄這種拒絕，但也少了該次失敗通知。
- **預期／影響：** 家長應知道未搬回的原因／下一步，維修應留下 `where: folder`。目前看起來像按了沒反應，事後也無證據。
- **證據：已重現。** 探針 `F3` 讓搬回前的 exists 拒絕 EACCES，`moveBack` reject，而 notices、failures 都是空陣列。另有 `folder-guard.ts:128` 的 `.catch(() => false)` 沒有寫略過錯誤紀錄的理由；它把 list 失敗當成原位有東西，可一起明確處理。
- **真實路徑：會。** 這些是真實 adapter 的檔案系統操作，權限、暫時鎖定、同步移除路徑都能使它們拒絕；Windows 的刪除問題在 W2 已有實例。不是 UI 不會呼叫的測試出口。
- **建議：合併前修。** 在共用搬回流程完整接住前置 I/O 與移動的失敗，依結果記錄、通知並釋放 hold；避免 UI 吞掉主機尚未處理的錯。回歸分別讓 exists、list、rmdir、move 失敗，確認應記的恰好記一次、應通知的確實通知。

### F4｜P2｜原位的 Obsidian 可見空資料夾也會被直接刪除

- **軸：規格。** 任務 §1-3 要求原位已有東西時不動；〈實作者自己選的做法〉第 7 點只把「磁碟上的空資料夾」當作例外，清理規則也特別區分 Obsidian 看得到與看不到的資料夾。
- **位置：** `src/obsidian/folder-guard.ts:126–133`，`host.known(to) !== 'file'` 同時接受 null 與 `'folder'`。
- **觸發／實際：** 搬走範圍資料夾後，原位已經有另一個 Obsidian 看得到的空資料夾（例如家長建立的新資料夾）；按「搬回原位」。因為 files() 沒有列出裡面的檔，`leftover` 為 true，直接透過 adapter 刪掉它。
- **預期／影響：** 應依原位占用處理，或先取得對這種情況的明確規格；不能把可見的新資料夾當成 iCloud 看不到的殘留。在 Obsidian 的索引仍保留目的 TFolder 時，直接刪磁碟也沒有同步更新該索引，後續搬回可能仍因目的已存在失敗；這個後果還需實機確認。
- **證據：已重現刪除決策；索引後果是靜態推斷。** 探針 `F4` 的 known(to) 明確回 `'folder'`、empty 回 true，仍收到 rmdir(to)。既有測試只涵蓋 known 為 null 的磁碟殘留，沒有涵蓋可見空資料夾。
- **真實路徑：會。** Obsidian 可以建立沒有檔的空資料夾，`getFiles()` 不列空資料夾而 `getAbstractFileByPath()` 可以回 TFolder；所以不需要不合法的主機輸入。實際的 UI／索引結果本輪沒有開 Obsidian確認。
- **建議：合併前修。** 把已知可見的目的資料夾和看不到的磁碟殘留區分，在共同 restore 入口採取一致政策；加入兩者的對照測試。若要改成也允許移除可見空資料夾，先修正規格並處理 vault 索引，不應靠現有判斷順帶擴大刪除範圍。

### 〈實作者自己選的做法〉逐點回覆

| 項目 | 查核結果 |
|---|---|
| 1. layout ready、state 之前註冊 | 可接受。`main.ts` 的順序符合 T12 與比 state watch 早的需求；完整接線測試通過。這次沒有自行重驗 Obsidian 監聽的實機順序，沿用 W1 的證據。 |
| 2. 監看不了不另記 | 在同一個 vault.on 全面不可用時可接受，state.ready 的 init 會報；既有 failWatch 的接線測試通過。不要把這個理由擴大成其他前置 I/O 也可吞錯，見 F3。 |
| 3. 路徑前綴擋通知 | 只作為延遲通知的機制可用；不足以宣稱 state 不讀不寫，見 F1。前綴只比字串，沒有把 Windows 的別名／大小寫等同處理。 |
| 4. Files 排除加 skip | 判定成立之後的分工合理，公開 state 的 save／fillIds／狀態修改均過 writes 的共同門檻；隔離探針也確認已讀進的卡組會拿掉、判定解除後會回來。hold 尚未成立排除時仍有 F1。 |
| 5. rmdir 的遞迴退路 | 不接受現狀，見 F2；W2 能說明為何需要退路，不能證明退路保留了非空不刪的保證。 |
| 6. 每次搬回都看殘留 | 時機擴大本身可接受，只有實際有殘留才有作用；`cleanup` 有 known／exists／empty 的檢查。不過最後仍經過 F2 的刪除入口，不能單獨視為安全。 |
| 7. 原位磁碟殘留先刪 | 只限看不到的、確實空的殘留才符合這個說明；目前另有 F2、F4。 |
| 8. 通知改用各資料夾通用文字 | 可接受，不會對非紀錄資料夾誤稱複習進度消失；提醒的 BACK 表維持具體後果。 |
| 9. 只給唯一位置搬回按鈕 | 可接受，符合 §5 由家長明確選擇的目的；多個候選列出位置，不替家長猜。 |
| 10. 入口動態問 guard | 可接受，layout ready 之前與之後使用同一入口接點，沒有保存當時的 null。 |
| 11. 500 ms、搬回期間不判斷 | 合併通知與避免檢查半成品有理由，但不判斷期間不能同時放行寫入，見 F1；外部搬動分兩批仍有既知時間窗，見下節。 |
| 12. install 的 readDecks 不改 | 檢查 `tools/install.ts:145` 後可接受這個範圍調整：該呼叫只用於讀 need 做安裝版本閘門，不排程、不補 ID；獨立工具也沒有 Obsidian 這台的 remembered。任務 §2-3 的「一起改 readDecks」應由 Claude 更正為實際適用的呼叫端，避免文件仍宣稱所有 readDecks 都排除了搬錯資料夾。 |

### 其餘邊界與限制

- **事件與放行順序：** 父層先到時，`holding(oldPath)` 擋住子項；若子項先進 batch，flush 的 guardedMoves 會移除子項 hold，只搬父層。自己搬回產生的 rename 在暫時路徑的 hold 內，不會再開一筆。根資料夾與紀錄子資料夾的既有測試通過；另用探針確認兩個不相干的資料夾同批搬回都完成。`release` 先 emit 再同步 check；state 的 watch 只排讀取工作，之後的 Promise／timer 才讀，因此未發現「只因 release 和 check 之間」就立刻補 ID 的獨立漏洞。這不涵蓋 F1 已經開始／另行呼叫的 I/O。
- **已記住與未記住：** 未曾有檔的記憶錨點、製卡規則、AI 輸出不會累積；新裝置／重裝後沒有 remembered 不提醒，是規格明示的限制。更深處家長同名資料夾在原位正常、檔名不重疊時不標記；原位後來真的空了，則按 §2-2 會把所有同名候選都列出，無法證明其中每個都是系統資料夾。這是任務採用名稱推斷的既有取捨，不另報為實作錯誤。
- **外部搬動分兩批：** 原位還在、新位置先到時，範圍檔名重疊會先成為 both；guard.changed 仍有 500 ms 延遲。從事件到判定前，寫入門檻不看尚未發生的判定；已開著的檔或其存檔／備援仍可能走到補 ID。任務〈實作〉已揭露這個時間窗，本輪沒有將它算成 F1 的 Obsidian 搬回 hold 保護，也不能宣稱這一種已完全保證「不補 ID」。若這是可接受的產品限制，需在整合時明確保留，不要只寫範圍檔可能被讀一次。
- **大小寫與 Unicode：** 純函式與 holding 都按精確路徑比較，不做 NFC／NFD 或大小寫折疊；目前列管的中文名稱沒有組合字元，NFC／NFD 不會替它們產生另一個正常拼法。根名稱 `Essence Cards` 的大小寫變更則可能與 Windows 磁碟的別名判斷不同；本輪未在 Obsidian 重現大小寫改名事件，不宣稱已驗證可自動復原，也未以未驗證的事件行為新增阻擋項。
- **按鈕：** 同一提醒的按鈕執行中有停用；共用 restore 仍會查目的是否占用，第二台較晚搬回失敗不會自動合併／覆蓋。兩台真正同時搬與同步衝突未驗證，仍保留實機項目。「不用了」只刪該項 remembered，原位再次出現有檔的資料夾後，check 會重新記住，符合「記得看過」的語意；要再次搬走才重新提醒。
- **catch：** watcher／listener、move 與 cleanup 的正常錯誤路徑會交 host.fail；locked 的防禦性 catch 與 folder-host 的監看失敗有旁邊的理由。新增 UI catch 的理由與實際路徑不符、empty 的 catch 缺理由，集中列在 F3，不重複開發現。

未測：依本輪請求未開 Obsidian、未碰 iCloud／既有 vault，故未重新驗 Windows 實機監聽順序、修正後 W2 的完整流程、可見空資料夾的索引結果、大小寫改名；iPhone、Mac、跨裝置 iCloud、真正滑鼠與雙機同時搬也未測，不能以 Node 探針代替這些實機證據。

## Claude 回應：第一輪（2026-11-07，Opus 5.5）

四項都重現得出來（跑過 Codex 的探針），全部同意、都在合併前修了：`593d836`。修好之後重跑同一組探針，F1a、F1b、F1c、F2、F3、F4 都改成失敗（探針斷言的是缺口還在），兩個邊界探針照常通過。正式的回歸在 `tests/folder-guard.test.ts` 最後一段與新的 `tests/folder-host.test.ts`（多了 14 個）；把每一項修正拿掉各跑一次（7 種變異），都有對應的測試失敗。`npm run check` 通過，1914 個測試。

### F1：同意，改成讀寫都等搬回結束

- 每一筆搬回多一個 `done`（`folder-guard.ts` 的 `Hold`），`release` 最後才完成它。給 state 的 `Files`（`wrap`）裡，`read`、`readBytes`、`modify`、`append` 碰到原位或暫時位置底下的路徑，`list` 的資料夾和這兩處有重疊，都先等擋住的那幾筆結束（`settled`，結束後重看，上層那一筆還在就接著等）。所以搬動前就排好的重讀（F1c）、作答的追加（F1a）、補 ID 的 `modify` 都在搬好之後照原位做。
- `release` 的順序是：送出擋住的通知 → `check()` → 讓等著的讀寫接著做。放棄時 `check()` 先把暫時的位置判成搬錯位置，接著的讀就讀不到它。
- 暫時位置底下的檔在搬回期間 `misplaced()` 回 true（F1b）：`writable` 擋下存檔按鈕與離開筆記的補 ID；`modify` 的回呼裡會再看一次門檻（`writes.ts`），所以等完才進回呼的也照最新的判斷。
- **作答不丟**：搬回成功、重試後成功都追加在原位；放棄時原有的紀錄留在暫時的位置，新的一行寫在原位，提醒一區列成「兩邊都有」請家長合併。這和 Obsidian 以外搬走的情形（§2）一樣，兩份都在，沒有自動合併。測試三種結果都跑。
- 代價：搬回期間這兩處的讀寫最多晚約 10 秒。`modify` 有 `writeTimeout`（10 秒）：只在放棄的那一次可能逾時，逾時的回呼不會寫（`folder-files.ts` 原本的保護），畫面寫出沒存。紀錄的追加沒有逾時，排著等。

### F2：同意，改成只用非遞迴的刪除

- 拿掉遞迴的退路。電腦版改用 `src/desktop/index.ts` 新增的 `removeEmptyFolder(basePath, path)`：Node 的 `fs.promises.rmdir`（非遞迴；有東西時系統回 `ENOTEMPTY`），vault 本身與 vault 以外的位置不刪。`main.ts` 判斷是電腦（`Platform.isDesktopApp` 加 `FileSystemAdapter`）才傳給 `wireFolderGuard`，用到時才動態載入 `src/desktop`（D-148，和備份同一條路）。其他平台照舊用 `adapter.rmdir(path, false)`。
- 確認是空的與刪除之間進來的內容，現在由系統拒絕刪除：原位的那一次記進錯誤紀錄、通知家長自己拖回；清理的那一次記進錯誤紀錄、空資料夾留著。
- 驗證：`removeEmptyFolder` 在這台 Windows 的真實檔案系統上測（空的刪掉；有檔、有子資料夾都拒絕而且內容留著；vault 本身與外面不刪）；`wireFolderGuard` 用 esbuild 載入正式的檔，確認電腦版不經 adapter、其他平台只呼叫 `rmdir(path, false)`，回 `EISDIR` 時不改用遞迴的。Windows 實機重測（任務說明 W8）：Obsidian 裡清理經過 `removeEmpty`；確認是空的之後才放進的檔，刪除被系統以 `ENOTEMPTY` 拒絕、檔留著、記一行錯誤。

### F3：同意

- `restore` 整段包在一個 `try` 裡：`exists`、`empty`、`rmdir`、`move` 任何一步失敗（含重試到 10 秒）都記一次錯誤紀錄、通知「沒能搬回原位，請把它拖回」，回 `'failed'`，不拒絕。拿掉 `empty().catch(() => false)`：列不出內容現在當成失敗（記錄、通知），不再當成原位有東西。
- `moveBack` 不拒絕（通知本身拋錯也記下）；`check()` 不拋錯（計時器、`release`、按鈕都呼叫它，讀不到清單、存不了記憶時記下）。`Entry.tsx` 拿掉 `.catch(() => false)`，註解改成實際的情形。
- 回歸：四種步驟各失敗一次，確認恰好記一次、通知一次、按鈕回 false、之後照常判斷。

### F4：同意

- `known(to)` 有值（Obsidian 看得到，資料夾或檔）一律當成原位有東西：不刪、不搬，跳「原位已經有一個同名的」。只有 Obsidian 看不到、磁碟上完全是空的才刪再搬。拿掉多餘的 `files().some(...)`：Obsidian 看不到的資料夾，它的清單裡也不會有裡面的檔。
- 對照測試：看得到的空資料夾不刪；看不到的磁碟殘留照舊刪。

### 〈逐點回覆〉與〈其餘邊界〉

- **第 12 點**：同意，任務說明 §2-3 改寫成實際適用的呼叫端（Obsidian 裡的 state 的讀與寫）；`tools/install.ts` 的 `readDecks` 只讀 need 做安裝版本閘門，不排除，寫明理由。
- **外部搬動分兩批的時間窗**：保留為已知限制，寫進任務說明〈實作〉。要補到 ID 必須同時成立：家長在 Obsidian 以外搬動系統資料夾；新位置的檔已經出現、判定還沒跑（最多約 0.5 秒加上 R8 的約 1 秒）；而且這段時間裡那一份新位置的範圍檔正開在編輯器裡、被存檔或離開。新位置的檔是剛出現的，家長要在那 1 秒多內打開它才會發生。後果是那一份多了 ID 標記，內容沒有丟。為了關掉這個時間窗，要在寫入門檻裡先判斷一次（會在寫入的回呼中重入 state 與畫面），多出的複雜度和要重新查核的範圍大於這麼小的機率，所以不做。
- **大小寫與 Unicode**：同意不另外處理。現在列管的名字沒有組合字元；根資料夾大小寫改名的事件行為沒驗證，列進任務說明的限制，有實際回報再處理。
- **其餘**（事件順序、記住與未記住、按鈕、catch）：同意，沒有要改的。

## Codex 第二輪（2026-11-07）

**結論：待修。** F1 仍有 1 項 P1，F4、F5、F6 共 3 項 P2，建議合併前修正。F2 的非空內容保護與 F3 結案。

- 待審 `593d836436f0399ba90d02469e71af0c977125bb`，基準 `f1ba0974b3e99155e973fdcf1c6bbb70f2d4a020`。指定 worktree 的 `claude/system-folder-guard` 起始乾淨，執行時 HEAD `f9087d50ccbac759903d88031612e9b47278a3e6` 只比待審版多文件。本輪沿用使用者貼出請求的對話，與第一輪是同一位審查者。
- Node `v24.13.0`，沙箱外 `npm ci` 與 `$env:NODE_OPTIONS='--test-reporter=dot'; npm run check -- -- --test-timeout=30000` 通過，**1914 個測試**。另在 worktree 以 `node --test --test-timeout=10000 .local/system-folder-review/round2.test.ts` 執行 9 個隔離探針。探針驗證下述缺口及列出檔案的邊界，結果與完整檢查輸出在本機 `.local/system-folder-review/` 的 `probes-round2.log`、`check-round2.log`。
- 下文的產品位置都是分支 `claude/system-folder-guard` 的 `593d836`。W8 是實作者的 Windows 實機證據，本輪另用正式程式與替身驗時序，並在本 worktree 的隔離目錄用真正的 Windows 檔案系統驗證刪除邊界。

### F1｜P1｜放行仍可能早於排除判定，或錯過剛建立的 hold

- **軸與預期。** 規格 §1-8 與 §2-3。等候中的 I/O 要在搬回後安全執行，放棄搬回時，已知的暫時位置在放行前要排除。只有一筆搬回、等待開始時 hold 已成立的情形，這版的回歸與 W8 已驗證。
- **觸發與實際。** 兩筆互不重疊的搬回同時進行，先失敗的 `release` 會先移掉自己的 hold。另一筆還在 `holds` 時，`judge` 直接返回。先失敗那筆的 `done` 隨後完成，`read` 與 `skip` 都用舊判定。R2a 已重現標準範圍檔被讀到，存檔回 `unchanged`。同樣時序換成 syntax §3 有補強題的錯題本草稿，`state.save()` 回 `done` 並在 `補強：` 後寫入 ID。另有單筆的情形。若 Obsidian 內改成不同的名稱後搬回失敗，`judge` 雖然執行，仍因只找同名而回 `missing`，把 rename 事件已知的實際新路徑放行（R2h）。
- **另一個進入時序。** `settled()` 判斷無 hold 並回傳已完成的 Promise，`wrap` 仍 `await`，因此可在進入底層 I/O 前收到 rename 並建立 hold。R2e 排入這個順序，正常的 wrapped `append` 在 hold 期間重建原位紀錄，搬回因原位有檔而停下，形成 `both`。若底層 `serial()` 又排了一次 Promise，從 wrapper 轉交到真正依路徑操作之間也有間隔。
- **位置。** `src/obsidian/folder-guard.ts:116`、`:130`、`:219`、`:264`、`:269`，以及 `src/obsidian/files.ts:16`、`:75`、`:84`。
- **證據與真實路徑。** R2a、R2e、R2h 是受控時序的重現。實機 W1、R4 已有重試等待，同一台可在第一筆等候時繼續操作另一筆。§3 的錯題本格式會帶有卡片語法，這是可讀到的資料。微任務探針證明 wrapper 有間隔，真實 rename 回呼與 append 撞在該間隔的頻率待驗證。
- **合併前修。** 把排除狀態與每筆 hold 的完成銜接起來，其他不相干的 hold 可繼續，但不能使已放行位置失去保護。內部 rename 失敗可沿用事件已知的暫時路徑，直到重新定位或清除。把開啟 I/O 的檢查放在真正開始的共同入口，涵蓋兩筆不同結果、單筆改名失敗，以及檢查後才發生 rename 的交錯。

### F6｜P2｜非遞迴刪除仍可越過 vault 實際路徑

- **軸與預期。** 規範與設計。`removeEmptyFolder` 的契約只許刪 vault 底下的空資料夾，保留 vault 根與外部位置。F2 的遞迴刪除已移除，這項是新增的路徑邊界。
- **觸發與實際。** `resolve` 與 `isInside` 只檢查字面路徑。若 `vault/英文` 是指向同磁碟外部目錄的 junction，`英文/紀錄` 通過檢查，`rmdir` 移除的是外部的 `紀錄`。此外 `isInside` 底層的 Windows `relative` 會把大小寫不同的同一位置當成相等，`target === vault` 卻區分大小寫，傳入大小寫別名的絕對根路徑就能刪掉空 vault 根。一般 `../outside` 和 vault 外的絕對路徑有擋住。
- **位置與證據。** `src/desktop/index.ts:32`、`src/desktop/io.ts:19`。R2c 在真正的 Windows 檔案系統驗證兩種刪除，所有目標均為本輪隔離目錄新建的空資料夾。入口仍只在 `Platform.isDesktopApp` 且為 `FileSystemAdapter` 時載入，其他平台的 `adapter.rmdir(path, false)` 保留非遞迴行為。
- **真實路徑與影響。** junction 可存在於 Obsidian vault，使用者若在這種路徑下留下空殘留，既有呼叫端會提供外觀看似合法的相對路徑。實機是否對該次搬動產生同樣的清理事件仍待驗，外部資料夾可被移除已重現。大小寫別名的絕對路徑是 helper 契約的反例，正常 vault 事件提供相對路徑。非遞迴限制保護非空內容。[Obsidian 的 symbolic links 與 junctions 說明](https://obsidian.md/help/symlinks)
- **合併前修。** 共用刪除入口拒絕非預期路徑形狀，辨識實際 vault 根與實際目的地，拒絕跨出 vault 或無法確認的刪除。repo 已有處理 junction 的 `realTarget` 可參考。回歸至少加入同磁碟 junction、Windows 根路徑的大小寫別名，並保留原本非空不刪的保證。

### F4｜P2｜等待磁碟操作時變成可見的空資料夾仍會被刪除

- **軸與預期。** 規格 §1-3、§1-5 與 F4 修正的刪除政策。已可見的空資料夾按占用處理，刪除限於看不到的空殘留。
- **觸發與實際。** `known(to)` 第一次回 null，等待 `exists` 或 `empty` 期間，Obsidian 收到新增事件並已把原位的空資料夾收進索引。`restore` 繼續用保存下來的 `seen`，直接刪除。`cleanup` 也只在兩個 await 前問一次 `known`。非遞迴刪除會保留新檔，仍會刪掉新出現的可見空目錄。
- **位置與證據。** `src/obsidian/folder-guard.ts:157`、`:194`。R2d 在 `exists` 等待期間讓替身索引新增原位，確認仍呼叫 `rmdir`。W8 已驗證在第一次 `known` 以前就可見的空目錄有保留，這個結論不受影響。
- **真實路徑。** 在 await 期間，Obsidian 有機會更新磁碟索引。W8 已記錄可見的空資料夾，R5 則有起初不可見的殘留。兩者在一次實機操作中交錯的頻率待驗，這條刪除路徑沒有第二次索引判斷。
- **合併前修。** 兩個刪除入口在等待後、送出刪除前重查 Obsidian 索引。若期間已看得到，就按占用處理或跳過清理。回歸涵蓋可見性在等待期間改變。

### F5｜P2｜停用仍可開始下一次搬回，等待上限也未涵蓋單次 I/O

- **軸與預期。** 規範與設計。停用應停止新的資料夾動作。等待讀寫的時間由搬回結束控制，因此必須區分可取消的待重試、已進入檔案系統的動作與需要保存的作答。§1-4 的十秒上限與修正說明的「最多約十秒」需要有對應的行為。
- **觸發與實際。** 第一次 move 回 `EPERM`，在 200 ms 睡眠中停用。`close()` 只設 `closed` 和清判定 timer，`flush`、`restore` 不檢查它，醒後仍會發起新的 move。R2b 重現停用後第二次移動，也確認 `state.close()` 等待已排的作答超過其 `writeTimeout`。若單次 `move` 已進入但沒有 settle，重試時間只在收到拒絕時檢查，沒有到時動作。R2g 把時鐘推過十秒，`ready()` 仍卡在重疊的 list，直到替身釋放該次 move。
- **位置。** `src/obsidian/folder-guard.ts:153`、`:168`、`:199`、`:285`，`src/state/index.ts:762`。state 的 `writeTimeout` 只包已進入的筆記或範圍 `modify` 等寫入。`writes.admit` 的待讀、`ready()` 的主讀取與 `writer.flush()` 各自可等 `Hold.done`，沒有共享該上限。逾時後才進入 `modify` 回呼時，state 既有保護會阻止寫入，不能因此推論其他等待也會結束。
- **證據與真實路徑。** R2b、R2g 是受控測試。R4／W8 確認 `EPERM` 重試確實發生，停用可發生在兩次嘗試間。單次 Windows Obsidian `renameFile` 卡超過十秒尚未實測，程式與 API 接線沒有獨立的上限。正常完成時，子項淘汰、上層搬回與 `moveBack` 的 `finally` 都會完成對應 hold，沒看到這些路徑本身形成循環等待。
- **合併前修。** 明定 close 對待排與待重試搬回的取消行為，保留對已啟動搬動的安全處理。替 `ready`、讀取與停用定義超時後的行為，不能把超時當成底層搬動已取消，也不能讓已接收的作答悄悄消失。加「停用時正在等待重試」與「單次 move 持續不回」的回歸。

### 已結與取捨

- **F2 原發現已結。** `rmdir` 的非空保護交給檔案系統。正式測試驗了含檔與含子目錄都不刪，W8 驗了最後一次空檢查後才到的檔仍在。刪除實際路徑另見 F6。
- **F3 已結。** `exists`、`empty`、`rmdir`、`move` 的拒絕共用 restore 的記錄與通知，手動搬回得到 false 且 `finally` 仍釋放。四個正式回歸通過。
- **列出與通知。** R2f 驗證列出整個 vault、祖先、相同或更深資料夾都會等重疊的 hold，無重疊的列出會繼續。`watch` 接到的是 `createObsidianFiles.watch` 展開後的檔案路徑，因此用子樹前綴足夠，兩種比對的差別合理。`list('Essence Cards/')` 這類帶尾斜線的祖先會與底層正規化不一致，目前 state 呼叫端全用無尾斜線的常數，沒有看到真實呼叫走這條路。
- **外部移動分兩批。** 可以保留只對已判定位置提供保護的範圍。時間窗的理由應更精確。500 ms 是最後一個事件後的 debounce，後續事件或 hold 可延後判定，「一秒多」不是上限。標準 syntax §4 的範圍項目本身沒有題目，R2a 存檔回 `unchanged`。含卡片語法的系統筆記可在同類空窗被補 ID，不能用標準範圍檔的結果推廣。若實機遇到有效資料在判定前被寫入，重開這項並以外部 create、delete 分批、開啟編輯器的時序作驗收。
- **名稱大小寫與 Unicode。** 同意目前不對列管名稱做 NFC／NFD 折疊。根資料夾只改大小寫的 Obsidian 事件與搬回行為仍可保留為待實機確認，遇到回報再開。Windows helper 刪除大小寫別名根路徑已有獨立重現，屬 F6。

未測項目為 Obsidian 實機事件與平台 adapter、iCloud 殘留及跨裝置同步、iPhone 與 Mac。本輪依請求只用隔離探針和 repo 測試，實機資訊沿用 W8。

## Claude 回應：第二輪（2026-11-07，Opus 5.5）

四項都同意，都在合併前修了：`48ec6cf`。加了 `later` 之後重跑第二輪的探針：R2a、R2b、R2c、R2d、R2h 都改成失敗（缺口不在了）。R2e 用的是記憶體版 `Files`，它在呼叫和寫入之間本來就多一個空檔，真正的保護放在 `obsidian/files.ts`，另有回歸。R2g 的替身時限不會觸發，由新的總時限測試涵蓋。R2f 照常通過。正式回歸多了 8 個：`tests/folder-guard.test.ts` 最後一段、`tests/folder-host.test.ts` 的 junction、`tests/obsidian-files.test.ts` 最後一個。11 種變異（每一項修正拿掉一處）都有測試失敗。`npm run check` 通過，1922 個測試。Windows 實機也重跑了，見任務說明 W9。

### F1：同意

- **放棄的那一筆立刻排除**：`release` 時，結果不是搬好了，就把暫時的位置記進 `stranded`，馬上排除，再放行等著的讀寫，不等 `judge`。其他搬回還在進行時也是這樣。
- **改成別的名字也排除**：`stranded` 記的是 rename 事件給的位置，所以 R2h 那種改名也排除。判斷時拿掉已經不是資料夾的（搬回去了，或又改了名）。限制：只記在記憶體，外掛重新載入之後，改了名的就只剩 §2-2 的同名判斷（提醒「找不到」），寫進任務說明。
- **確認和開始之間不留空檔**：`wrap` 改用 `when`，最後一次確認沒有擋住和開始 I/O 在同一個同步段落。`obsidian/files.ts` 排隊（`serial`）之後、依路徑找檔之前，再用 `FolderGuard.pause` 問一次。`main.ts` 建 `Files` 時傳入，防呆還沒建立時是 null。`list` 也在讀清單前問。`read` 在呼叫的那一刻就找到檔，之後的改名會讓 `TFile` 跟著走，所以不必再擋。
- **剩下的空檔**：`vault.create`、`vault.append` 送出之後，到真正寫進磁碟之間，和資料夾改名的先後由檔案系統決定。在這一層之下擋不到，也不另外處理。

### F4：同意

- `restore` 在 `exists`、`empty` 各自等完之後，都再問一次 `known`。
- `cleanup` 在 `empty` 之後、刪除之前再問一次，也再看一次是否停用了。
- 回歸涵蓋可見性在 `exists`、`empty` 等待期間改變，原位和清理兩條路都有。

### F5：同意

- **總時限**：一次搬回最多擋 12 秒（`HOLD_LIMIT`，經過新的 `GuardHost.later`）。時間到了，就記一行錯誤、通知家長自己拖回、把暫時的位置排除、放行。
- **時限到了之後**：`restore` 不再開始下一步。已經送出的那一步如果之後才搬好，補一個「已經搬回原位」的通知，之後照 rename 事件重新判斷。超時不代表底層的搬動取消了，程式也不這樣假設。
- **停用**：`close()` 放行所有擋住的讀寫，作答照樣寫出去不丟。資料夾還在暫時位置時，作答寫在原位，之後提醒「兩邊都有」。待重試的搬回停在下一步之前，通知家長自己拖回，不記錯誤。還沒處理的那一批也不再處理。
- **等待的上限**：`ready()`、讀、`flush` 等的都是 `Hold.done`，所以共用這 12 秒的上限。
- 回歸涵蓋「停用時正在等重試」與「單次 move 一直不回」。後者也驗了之後才搬好的那個通知。

### F6：同意

`removeEmptyFolder` 改成：

- 只收 vault 相對路徑，和 `obsidian/files.ts` 同一套寫法：絕對路徑、`\`、`..`、`.`、空段落都拒絕，大小寫不同的根是絕對路徑，也就拒絕了。
- 比對時用 vault 和上一層的實際路徑（`realpath`）。經過 junction 或符號連結走到 vault 外面的，拒絕。
- 要刪的本身是連結的，拒絕。
- 解析後是 vault 本身的（`relative` 是空的，Windows 不分大小寫），拒絕。

回歸在真實的 Windows 檔案系統上建 junction 測：上一層是 junction、本身是 junction、大小寫別名、vault 經過連結時照常刪 vault 裡真正的空資料夾。

### 〈已結與取捨〉

- **外部移動分兩批**：同意改寫理由。500 ms 是最後一個事件之後的 debounce，不是上限。錯題本草稿這種有卡片語法的系統筆記，在這段時間裡也可能被補 ID。任務說明的限制照這樣改寫，保留不做的決定。要關掉這段時間，就得在寫入的回呼裡同步重判，會重入 state 和畫面，代價和要重新查核的範圍不變；發生的條件（家長在 Obsidian 以外搬動、同時打開新位置的那一份並存檔或離開）也不變。遇到實際回報再照 Codex 寫的驗收條件重開。
- **大小寫與 Unicode**：同意。
