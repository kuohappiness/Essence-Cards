# W6 畫面修改：Codex 獨立審查
狀態：Claude 已修 F1～F8（分支 `claude/w6-polish` 的 `888075a`），等使用者決定請 Codex 再查或直接合併；尚未合併（2026-10-28）

## 結論與範圍

**建議先修 F1～F5 再合併。** F1 會在離開畫面時寫入尚在等朗讀的作答；F2 讓重出的卡或回看後的卡漏掉自動評分。F3～F5 是 DOM 後處理在 SVG、格式節點及連結邊界上的退步。另有三項較小的開發工具與乾淨程度問題。這些修正服務北極星的方式，是保住複習紀錄與排程的可信度，並讓學生能順暢看懂、照打及聽到同一張卡的回饋。

- 依照 [審查請求](../tasks/w6-polish-review.md)、[實作任務](../tasks/w6-polish.md)、main 的 D-145 第 1～7 點與 [W6 §2～§3](../tasks/w6.md) 查核；紀錄欄位另對照 [syntax.md §5](../docs/syntax.md#5-複習紀錄)。
- 受審：分支 `claude/w6-polish`，worktree `D:\程式開發\Essence-Cards-w6-polish`，HEAD `2ad863bfb023a2ca4b64aa28c1ba3b2cefdedd03`。開始與結束時皆沒有未提交修改。
- 差異：`git diff 69d8fc45de3825c3846b6ebb63344a152d5afc76 2ad863bfb023a2ca4b64aa28c1ba3b2cefdedd03 -- src tests tools`，16 檔，+718／−113。A3 帶入的程式不重審。
- **下列 `src/`、`tests/` 的路徑及行號，全部指分支 `claude/w6-polish` 的對應檔案（`2ad863b`），不是 main 上的檔案；因此不放相對連結。**
- 只審查與寫本報告，沒有改產品程式、測試或設定，沒有 commit。

## 發現（依嚴重程度）

### F1｜P1｜停止朗讀會在關閉或切到背景時提交作答

- **軸**：規格。違反 W6 §2-1、D-074 的中斷不寫紀錄，以及 D-145 第 7 點的等念完再換卡。
- **觸發**：自動朗讀開著，打字卡第 1 步按「沒印象」，三步完成，仍在等語音；此時按 ✕、點會關閉複習的出處連結，或切到背景。
- **預期／實際**：離開應取消尚未提交的自動評分。實際上 `Speech.stop()` 同步呼叫 `whenIdle` 的 callback；`host.close()` 在 `root.unmount()`、`session.close()` 之前先 stop，此時 `alive` 還是 true、session 還能評分，因而 `rateOnly()` 寫入 `miss`。切到背景也先 stop 再 pause，發生同樣的寫入。
- **影響**：中斷被算成已完成作答並改變排程；切走超過 60 秒回來時，原本要重做的那張已經被記下。這不是 JSON 格式改變，而是寫入時機錯誤。
- **位置**：`src/ui/Review.tsx:138–143`；`src/ui/speech.ts:52–53`；呼叫端 `src/ui/host.tsx:62–65、100–110`。host 雖未列在本輪 diff，既有關閉順序因新的 callback 產生了退步。
- **證據：已重現**。真實 `openReview`＋React＋Session＋State＋Speech，僅替換系統語音事件並使用記憶體檔案。等待期間作答數是 0，呼叫 `handle.close()` 後變 1；產生 `r: miss, typed: skip, retry: not-needed` 的紀錄。送出 hidden 事件也由 0 變 1，不必等待 60 秒。
- **建議：合併前修，加回歸測試**。先讓這次自動評分失效，再停止語音；背景暫停也必須阻擋提交。callback 應確認當前仍是原來那次出題、仍在前景且未關閉。不要把所有 stop 都改成不能喚醒：關掉自動朗讀開關時，仍需讓留在前景的卡繼續完成。補「✕／出處／hidden 等待中不寫入」的整合測試。

### F2｜P2｜`autoRated` 記住的是已註冊，不是已提交，也分不開同題的下一次出題

- **軸**：規格／設計。違反 D-145 第 7 點的只剩一個自評就自動換卡。
- **觸發 A**：一張卡按「沒印象」自動評分後，同一題再次出現；中間沒有另一張完成自動評分的卡，再按「沒印象」並完成照打。
- **觸發 B**：有上一張可回看；目前這張完成照打、等語音時回看，再回到目前。
- **預期／實際**：每一次符合條件的作答都應能自動提交。A 中 `present(next.card, 0)` 的 `shown` 又是 0，`lt:fingerprint:-1:0` 與第一次相同，`autoRated` 阻止再次註冊。B 中回看會 stop，callback 被消耗，但因正在動畫或正在回看而沒有成功提交；回來仍被同一個 `autoRated` 擋住。
- **影響**：三步做完仍停在卡片上，只能手按底部「沒印象」。單張卡提前再出就是可遇到的例子，不限剛好等到一分鐘。
- **位置**：`src/ui/Review.tsx:100–103、138–143`；出題時序見 `src/review/session.ts` 的 `load()`、`present()`。
- **證據：已重現**。單一 light 卡第一次完成後 history 為 1，第二次完成並停止語音後仍為 1，畫面是 `finished: true, first: skip`。另一例先做完 borrow、在 light 等待時回看再返回，history 仍只有 borrow，light 不再自動提交。
- **建議：合併前修，加回歸測試**。以「這一次出題」的身分區分重出，並分清等待註冊、取消與提交成功；回看中取消的等待不能永久占住已完成標記。補連續兩次同題 skip、等待中回看再返回兩個案例。只在 callback 裡加 `cardKey` 比對仍解不了 A。

### F3｜P2｜`attachTail` 會把 HTML span 插進 SVG 文字，破壞原有內容

- **軸**：規格／設計。W6 §3-3、D-109 要保留 Obsidian 渲染出的圖片與公式。
- **觸發**：渲染後最後的非空文字在內嵌 SVG 的 `<text>` 等非 HTML 節點內。`attachTail` 只排除空格與填空，沒有排除 SVG、MathML 或嵌入內容。
- **預期／實際**：保留 renderer 管理的內容，喇叭放在外側安全位置。實際把最後文字拆出，改成 `<text><span class="ec-tail">Hello…</span></text>`；這是 HTML span，不是 SVG tspan，文字與喇叭不再正常呈現。**沒有喇叭也會包這一層**，所以自然卡也可能受影響。
- **影響**：為了排喇叭而改壞教材的圖中文字；公式或其他 renderer 管理的子樹也缺少保護，但沒有把所有公式都判成已壞。
- **位置**：`src/ui/Markdown.tsx:50–65、159`。`glueText` 的走訪也應遵守同一個內容邊界。
- **證據：已重現 DOM 問題**。讓 renderer 回傳最小 SVG：`<svg width="140" height="50"><text x="5" y="30">Hello</text></svg>`，實際 Markdown 元件產生上述錯誤巢狀，tail 的可見矩形為 0×0；移除 `tail` prop 後仍會改壞。此例驗的是後處理對渲染結果的行為，沒有宣稱已在 Obsidian 實測每一種 SVG／MathJax 輸出。
- **建議：合併前修，加 DOM 回歸測試**。只處理可安全改動的 HTML 文字；遇到 SVG、公式、嵌入等子樹，保留原樣並在外側建立喇叭容器。補無喇叭 SVG、公式結尾、只有圖片的補充，確認內容不變且喇叭沒有進入隱藏／非 HTML 節點。

### F4｜P2｜中文後面的英文經過粗體或連結切開，就漏掉強制分行

- **軸**：規格。D-145 第 5 點要求中文整句後的英文另起一行。
- **觸發**：例如 `我昨天去了公園。**I** ＿＿ to the park yesterday.`，或 `請關燈。**Please** ＿＿ the lights.`。
- **預期／實際**：英文從 I／Please 之前另起一行，保留格式。實際 `breakBeforeEnglish` 只看找到空格的那一個 Text 節點；此例那段只有粗體後面的空白，看不到前面的中文，因而沒有 `.ec-break`。
- **影響**：同一內容加上合法 Markdown 格式，就失去這輪要求的分行；純字串 `englishBreak` 測試無法擋住。
- **位置**：`src/ui/Markdown.tsx:88–92、102–109`。
- **證據：已重現**。真實 Markdown 元件搭配 markdown-it 渲染以上兩類文字，`.ec-break` 數量都是 0；完整的三答案打字卡也重現，輸入 portal 本身仍正常。
- **建議：合併前修，加 DOM 回歸測試**。以空格前的邏輯文字範圍找分行位置，再映射到原 DOM 節點，保留粗體與連結；測試中文／英文跨 `strong`、`a` 的組合。冠詞跨格式節點的 `a **book**` 也應列入同次邊界檢查，不能只驗純函式。

### F5｜P2｜句尾是連結時，喇叭仍會單獨掉到下一行

- **軸**：規格。D-145 第 6 點要求喇叭和最後一個字一起換行。
- **觸發**：最後一個字在連結內，且本行容得下文字、容不下後面的喇叭。
- **預期／實際**：保留連結可點，喇叭與尾字一起換行。實際的連結分支是 `link.after(tail)`，`.ec-tail` 只包喇叭；`white-space: nowrap` 並沒有涵蓋前面的連結。
- **影響**：D-145 想消除的孤立喇叭，在連結結尾仍存在。避免把按鈕放進 `<a>` 的方向是對的，但目前只完成了一半。
- **位置**：`src/ui/Markdown.tsx:58–61`；`src/ui/Review.css:48`。
- **證據：已重現**。真實瀏覽器套用分支 CSS，以 `Read [borrow](https://example.com)` 和正式大小的喇叭測試；容器寬 150px 時，borrow 位於 y=60 的文字行，喇叭單獨位於下一行 y≈98.7。寬度是用來構造行尾剩餘空間，不表示只在 150px 裝置發生。
- **建議：合併前修，加 DOM／版面回歸測試**。在外側把尾端連結及喇叭組成不斷行群組，按鈕仍放在 `<a>` 外；若長連結要有退路，明確保留可讀、可點且不溢出的行為。

### F6｜P3｜`ui-phone` 在進入 try 之前失敗，會留下全域窄版樣式

- **軸**：設計。
- **觸發**：插入 style 後，`examplesState`、`freshSnapshot` 或 `logLines` 的初始化出錯；例如紀錄清單的 vault 讀取失敗。
- **預期／實際**：成功或失敗都移除暫時 style、恢復 rendering，關掉已建立的 state。實際 try 從更後面才開始；早期 reject 直接交給 dev.ts 的外層 catch，走不到 `narrow.remove()`，也走不到其餘清理。
- **影響**：開發版之後開的複習畫面仍被限制成 390px；state 的監看與背景繪製設定也有洩漏路徑。沒有影響正式版建置。
- **位置**：`src/obsidian/dev-review.ts:455–463、621–628`。
- **證據：已重現**。直接跑原 `uiShots(..., true)`，僅替換 vault 並在 `logLines` 列檔時注入錯誤；Promise reject 後，符合 `width: 390px !important` 的 style 還有 1 個。
- **建議：合併前順手修**。資源取得一開始就進入 try/finally；逐項清理已成功取得的 style、rendering、handle、state，不能讓其中一項清理失敗跳過其餘。補一次初始化失敗的清理測試即可。

### F7｜P3｜`blankHistory` 足夠應付目前呼叫端，但不是完整的 Files 實作

- **軸**：設計／契約。
- **觸發**：對虛擬紀錄呼叫 `modify`、從祖先資料夾 `list` 找紀錄，或依賴 `watch` 觀察虛擬 append。
- **預期／實際**：若聲稱符合 `Files`，各方法應看到同一套虛擬檔案。實際 `modify(logPath, edit)` 直接轉交真正的 Files；虛擬 append 不送 watch 通知；`list('Essence Cards')` 過濾真紀錄後，沒有補回虛擬紀錄。`list(LOG_FOLDER)` 也只列虛擬紀錄，不保留該資料夾下其他非紀錄檔。
- **影響**：現在的 state 只從確切紀錄資料夾列檔、作答只走 append，所以**未發現目前 practice／ui 會因此寫入真紀錄**。但包裝若被當成完整 Files 使用，可能讀寫不一致，甚至由 modify 寫到真紀錄。
- **位置**：`src/obsidian/dev-review.ts:131–142`；契約 `src/core/files.ts`，對照 `src/dev/files-contract.ts` 的 C1、C5、C12。
- **證據：靜態推斷**。list 的 `.sort()` 正確，非紀錄檔的 read／modify／append 與外部 watch 事件有原樣轉交；上述虛擬紀錄路徑則沒有對應實作。沒有把這項寫成當前資料毀損。
- **建議：記進技術債**。觸發點：下一次擴充此包裝、重用到別的命令，或 state 改用祖先 list／紀錄 modify／監看自己追加的紀錄時。完成條件：要麼明確縮小此私有包裝的契約與用途；要麼補齊虛擬紀錄的 list／modify／watch 一致性，跑對應契約案例並驗證真正的紀錄沒有被寫入。由 Claude 登錄，本輪只回報。

### F8｜P3｜這輪改法留下了過時的註解

- **軸**：乾淨程度。
- **觸發／預期／實際**：維護者依註解理解目前流程時，會讀到已被 D-145 取代的說明：`TypedView.notice` 還寫「要說不對」；`TypedView.answer` 還寫非拼對一律第一個，漏掉照打完採用學生選的答案；dev-review 檔頭還說會作答的命令都寫真紀錄；UI helper 檔頭仍說 Markdown 替身不畫東西，現在已經畫 tail 並回報 slot。
- **影響**：不是執行錯誤，但容易讓下一輪維護又沿用舊流程，與本次要求特別找「改了一半留下的東西」直接相關。
- **位置**：`src/review/session.ts:31、35`；`src/obsidian/dev-review.ts:12、621`；`tests/helpers/review-ui.ts:7`。
- **證據：靜態確認**。沒有找到值得另外列成問題的舊浮動喇叭 CSS；`.ec-skip` 現在只作為行為／測試標記，由共用按鈕樣式負責外觀，不是漏刪的專屬樣式。
- **建議：合併前順手同步註解**。dev-review 區分仍寫真紀錄的命令與記憶體練習；不需要為文字整理另加測試或 lint 規則。

## 「請特別看」8 點逐項結論

| 項目 | 結論 |
|---|---|
| 1. DOM 與 portal | 逐字輸入時同一個 input DOM 持續存在，三步切換正常；`applyState` 只改 `.ec-line-word`／填空，沒有碰到其兄弟 input、mirror 或 tail。非同步 renderer 的 `active` 可擋掉已卸載那次的後處理，正常換卡沒有發現 portal 寫到錯張。不能據此保證所有 Obsidian 嵌入生命週期；已確認的內容邊界與排版問題是 F3～F5。 |
| 2. 自動換下一張 | `rateOnly()` 的使用條件有擋未完成、回看與兩個以上評分，且沿用同一筆紀錄寫法；但整體還有 F1、F2。手動先按底部「沒印象」再 stop 的補測只新增 1 筆，下一張仍是未作答，沒有重複記或記錯張。關掉開關可讓前景等待完成；完成畫面無 current，不會由 rateOnly 多記。 |
| 3. whenIdle 計數 | generation 在 cancel 前更新，舊段落晚來的 end／error 不算；stop 自行清 pending，不必等 iOS 對每一段回報。現有語音測試通過；補測沒有英文語音時提示 1 次、idle callback 1 次。瀏覽器規格要求同一 utterance 的 error 與 end 互斥，因此沒有把刻意對同一段重送兩種終止事件當成已證實的 iOS bug；若系統漏送事件，手動按鈕是目前已明定的退路。主要錯誤是把各種 stop 都當成可提交，見 F1。[Web Speech 規格](https://wicg.github.io/speech-api/) |
| 4. 照打對象與紀錄 | 最接近答案是第二個時，copy／live 比對用第二個；照打其他合法答案仍能完成，線上改成實際匹配的答案。三答案例子的「也可以」依序列出其餘兩個。寫入只增加原有 `typed`、`retry`，沒有儲存 copy／live／輸入內容；回看仍顯示第 1 步快照，改評分沿用取消＋新評分。既有整合測試與補測均支持。 |
| 5. 題目固定與 ResizeObserver | cleanup 有 disconnect。實際瀏覽器測三分之一邊界，門檻約 176.3px、內容 166px，只有一次 class 變動，沒有持續來回切換或 ResizeObserver loop error。預設 observe 的是 content-box，單改 padding 不等於 content-box resize，不能只從 offsetHeight 多 22px 推定會無限迴圈。門檻量測的盒模型仍可在下次碰這段時統一；目前不列阻擋發現。[Resize Observer 規格](https://www.w3.org/TR/resize-observer/) |
| 6. CSS | 新按鈕選擇器的 specificity 足以壓過本身較短的通用規則；`:has()` 自 iOS／Safari 15.4 支援。50vh 只在 coarse pointer 且打字中增加捲動空間，結束後移除；stage 上留白與 sticky top 使用同一個 token，英文有覆寫 text-wrap。沒看到舊浮動／分隔線規則殘留。連結尾端 nowrap 的漏洞見 F5；iPhone Obsidian 實際主題、鍵盤及觸控狀態仍需實機，不能由 Chromium 代替。[WebKit 15.4 說明](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/) |
| 7. 開發命令 | `practice` 以 host.register 在外掛停用時關 handle，再經 onClose 關 state，正常生命週期有接好。ui／ui-phone 走虛擬紀錄，undoAll 也留在記憶體；完整 Files 契約的限制是 F7。ui-phone 的錯誤清理不是所有路徑都成立，已重現 F6。 |
| 8. 測試與替身 | 新測試確實保護三步的顯示條件、答案挑選、基本自動評分與一般語音完成。但原地 portal、render 中同步 onSlot 無法驗證真實父子 effect、容器移除、焦點與版面；`holdSpeech` 的 stop 只記字串，**不會像真 Speech 一樣喚醒 waiter**，直接漏掉 F1 與 F2 的一部分。建議保留快速替身測試，再補少量真 React／DOM 與真 createSpeech 整合案例，不必整批重寫，也不必把這次所有 UI 測試都搬進瀏覽器。 |

## 「Claude 自己選的做法」10 點回覆

| # | 回覆 |
|---|---|
| 1. 根元件持有 slot，portal 進空格，無空格退回下方 | **同意現行方向**。slot 與 session 畫面在同一處同步是合理的小規模做法，實測逐字輸入沒有換 input。不要把「測試替身只准根元件有 hook」當成長期架構限制；驗證工具要能跟著合理的元件結構調整。 |
| 2. 尾字包進 ec-tail，連結例外 | **一般 HTML 尾字同意；例外分支要修**。F3 必須保護 renderer 子樹，F5 必須把連結與按鈕在外側一起綁住；目前無法算完整達成「一律跟尾字一起換行」。 |
| 3. 冠詞連字只套英文題目 | **同意**。符合 D-145 的英文題目換行範圍，沒有必要擴張到所有答案與補充。跨粗體／連結節點的冠詞需要 DOM 層的邊界驗證，見 F4。 |
| 4. 等任何聲音，漏回報仍能手動評分 | **同意產品行為，先修 F1、F2 的等待生命週期**。學生自己按喇叭時也不應立刻被換走；系統無回報時保留手按可避免卡死。停止的原因仍須分清，關閉／暫停不能因此提交。 |
| 5. 三分之一門檻與負的 sticky top | **同意方向**。長題目保留答案的可讀空間，上方留白共用 token 也合理；實際邊界測試沒有支持「必然振盪」的猜測。 |
| 6. 照打即時比對同一行、打對也顯示；確認放最後 | **同意**。這是 D-145 第 7 點已確認的行為；字母標記與按鈕順序有對應測試，不應再依較舊的任務第 2 點退回「只顯示打錯」。 |
| 7. 打字中移除底部 actions，手機多留 50vh | **同意**。針對已知 iPhone 不縮畫面的鍵盤行為，讓按鈕跟內容捲動；條件只限打字中，範圍適當。50vh 的實際可用範圍仍沿用 iPhone 實測驗收。 |
| 8. ui／ui-phone 空白記憶體紀錄，undoAll 留在記憶體 | **同意**。範例可重跑，也避免把測試作答及取消混入真實紀錄。F6 要保證清理；F7 要誠實界定這個 Files 包裝目前支援的範圍。 |
| 9. 點打字卡空白處聚焦輸入框 | **同意**。按鈕、input、連結、audio 已排除，觸控開始於這些元素也不判水平滑動；符合空格變小後需要較大觸發區的原因。 |
| 10. 無開關時用空 span 補上方列 | **同意**。四欄 grid 保持 ✕ 在最後一欄，aria-hidden 不增加朗讀內容；不需要為這一格另建抽象元件。 |

## 驗證與交接

- 在受審 worktree、Node `v24.13.0`、沙箱外自行執行 `npm run check`：型別、ESLint、knip、secretlint、skill 一致性、文件檢查皆通過，**556 tests passed，0 failed，0 skipped**。沿用 worktree 已安裝的相依，沒有執行會重建 node_modules 與 prepare 的 `npm ci`；不把它記成已跑。
- 隔離目錄保存 `git archive 2ad863b` 的快照；用真 React／ReactDOM、原 Review／Markdown／host／Session／State／Speech 跑無頭 Chrome。Obsidian 的 Markdown renderer 用 markdown-it 及最小渲染結果替身，語音用可控制事件的引擎，檔案用既有 MemoryFiles。這比原 UI 替身多驗到了真 portal、DOM、ResizeObserver 及 host 關閉順序；仍不是 Obsidian／iOS 實機結果。
- 額外確認的正常組合：三個答案中照打第二個、列其餘答案、逐字 input 不換 DOM、第 1 步快照回看、手動評分先於 idle 不重複記、沒有英文語音立即回報 idle。瀏覽器補測沒有未攔截例外。
- 本機重現程式與結構化結果保存在 `C:\Users\kuo\.codex\visualizations\2026\10\28\01a18191-3a70-7bb3-a9d0-a7460458d289\w6-review\` 的 `harness.tsx`、`build.mjs`、`run-live.mjs`、`result.json`；報告中的觸發步驟與關鍵結果已足以重建案例，不必把整份執行紀錄貼進 repo。
- 修正後至少重跑 F1～F5 的案例及完整檢查；F1／F2 的檢查要涵蓋真正 `createSpeech.stop()` 會喚醒 callback 的語意。只改 UI 測試裡的字串計數，不足以證明修好。

未查／未測：A3 帶入的 save／events 實作（已有另一輪審查、任務排除）；未重新執行 Windows Obsidian 的 ui 劇本或讀取測試 vault（不在本次隔離重現範圍）；iPhone 實際鍵盤、觸控按鈕樣式、iOS 語音事件及第四輪出處細框（目前無 iPhone 控制環境）；Obsidian 真實 MathJax／各類嵌入的完整渲染（替身不代表宿主輸出），以及作業系統直接殺掉 App（未作破壞性實機操作）。

## Claude 回應（2026-10-28）

八項都同意，修正在分支 `claude/w6-polish` 的 `888075a`（基準 `2ad863b`）。`npm run check` 通過，559 個測試（多 3 個）。行為沒有超出 D-145，不改決定。

| # | 處理 | 驗證 |
|---|---|---|
| F1 | `Speech.stop()` 取消所有等待、不呼叫它們；`whenIdle` 回傳取消函式。 | `tests/speech.test.ts`：stop 不呼叫、被停掉的段落晚回報不算、取消的不呼叫。`review-ui`：卸載時取消；用真的 `createSpeech` 念答案時照外殼順序 stop＋pause，不記，回來才記。 |
| F2 | 自動換卡不再用 cardKey 記「做過了」：條件成立就等，effect 的 cleanup 取消；hidden 時不等。`Session.resume()` 有卡但沒重設時也通知一次，讓不到 60 秒回來的那張再等。完成畫面不通知（舊測試要同一個 view）。自動朗讀不會因此重播：`autoRead` 存在 current，重算的 view 拿到同一個陣列。 | `review-ui`：同一題重出兩次都自動記；回看時取消、回到目前再等；切走 10 秒回來再等並記下。 |
| F3 | 後處理搬到 `src/ui/rendered.ts`（`postProcess`，Markdown.tsx 與開發命令共用）。svg、math、mjx-container、`.math`、嵌入、img／audio／video／iframe、code／pre 與空格本身整個不動，喇叭接在它們後面。 | 新開發命令 `md-cases`，用 Obsidian 真的渲染器：SVG 結尾、公式結尾（MathJax）、只有圖片，受保護內容的 outerHTML 前後一樣，喇叭不在裡面。 |
| F4 | 換行在同一個區塊裡往回找，跨過粗體、連結；冠詞在節點最後、下一個字在粗體或連結裡也連。 | `md-cases`：`我昨天去了公園。**I** ＿＿…` 與 `離開時請關燈。[Please](…) ＿＿…` 各換一次行；`Can I ＿＿ your pen?（借）` 不換；`a **book**` 連起來。 |
| F5 | 最後一個字在連結裡：整個連結和喇叭包進 `.ec-tail`，喇叭在 `<a>` 外。連結文字超過 24 字時喇叭接在後面、不綁，免得一長串不能換行而超出。 | `md-cases` 150px 寬：`Read [borrow](…)` 的喇叭和 borrow 同一行；長連結不超出，喇叭和連結最後一行同一行。 |
| F6 | style、繪製、state 用巢狀 try/finally 各自收；關畫面出錯記成一步，不跳過取消寫入。 | 沒加自動測試：dev-review 要 Obsidian 的執行環境，Node 跑不了。Obsidian 跑 ui-phone 一次，成功路徑照常。 |
| F7 | 直接縮小契約，不列技術債：紀錄的 list（含上層資料夾）、read、modify、append 都只看記憶體。註解寫明不送 watch 通知（state 本來就略過自己紀錄的通知），拿去別的用途前要先補齊。 | ui-phone 結果：`logAdded` 空、`todaySame` 是 true。 |
| F8 | 四處註解都改了：notice、answer、dev-review 的檔頭與收尾、UI 替身的檔頭。 | — |

實測：在 Windows 版 Obsidian 跑 `md-cases`（11 個情況全部 ok）與 `ui-phone`。ui-phone 的劇本與上一輪相同，截圖版面一致，也沒寫入真正的紀錄。

**如果要再查**：差異是 `git diff 2ad863b 888075a -- src tests`。重點：
1. F1／F2 的等待生命週期，包括 `resume()` 多通知一次有沒有別的副作用。
2. `rendered.ts` 的邊界：受保護清單漏了什麼、跨節點換行會不會斷錯地方。

未測：iPhone 實機上 iOS 語音的結束事件與切換 App。
