# 題型接點與點選填空 L2 審查

狀態：第一輪待修（R1、R2 為程式問題，R3 為接點契約落差）；Claude 已修並回應（`572bb1b`、`8b6d6be`、`4d6c518`），等第二輪。

## 審查對象與結論

- 工作目錄：`D:\程式開發\Essence Cards\.claude\worktrees\state-split-c5c7bf`。
- 分支：`claude/compare-pick-34bcaf`；審查 commit：`31f20d4a5d01d5c39af83a91a59af63316f4ee0b`；基準：`ecbdbad`。開始時工作樹乾淨。
- 依 `tasks/question-type-seam-review.md`、`tasks/question-type-seam.md` §1、§3～§12、D-178／181／182／191／192、相似字規畫及 code-quality 審查規則查核。讀過格式第四輪的 Claude 回應，以及 `ce1733d` 之後的規格差異；不重開已定的 R 編號。
- 下列程式位置均指分支 `claude/compare-pick-34bcaf` 的對應檔案（`31f20d4`）。只新增本報告，沒有修改產品、測試或其他文件，沒有 commit。

完整檢查通過，但額外組合重現兩項缺口：自動補版本標記可能使原屬性失效；實際 State 過濾 ID 衝突目標後，卡片少了應保留的對照。另有 §1 的四表編譯保證與實作不一致，需整合者核對，不能把目前接點描述成四張表均已實作。

## R1［P1／規格］開頭分隔線多一個空白，補標記會使科目、暫停等原屬性失效

**證據：已重現，包含 `createState → fillIds → 寫入／核對 → today`。建議合併前修。**

**觸發條件與真實路徑。** 家長手寫或貼入筆記，第一行是 ` ---`（前面一個半形空白），其餘為一般屬性區與合法比較卡。這不是標準寫入器產生的形狀，但使用者能直接輸入；目前正式解析入口 `src/core/deck/parse.ts:40` 對第一行先 `trim()`，確實把它當屬性區，沒有要求資料經過額外繞道。只要新版電腦離開筆記或按存檔，便會走補標記。沒有聲稱使用者現有 vault 已含這種資料，也沒有假設 Obsidian 原生屬性編輯器支持它。

最小原文如下；第一行的空白是案例的一部分：

```markdown
 ---
科目: 國語
狀態: 暫停
自訂: keep-me
---
- 寨（寨、塞） 相似字 ^zhai00
    - 山＿＿ :: 寨
- 塞（寨、塞） 相似字 ^sai000
    - 大＿＿車 :: 塞
```

**預期／實際。** §3（任務第 183 行）要求其他屬性包含未知鍵逐一相同，不能安全改寫就回 `null`、整份不寫。實際 `markNeed` 在原文前新增另一份屬性區：

```markdown
---
需要版本: 0.4.0
---
 ---
科目: 國語
狀態: 暫停
自訂: keep-me
---
```

原字仍在檔案裡，但已經落到正文，失去屬性作用。State 回報補寫成功，從 `subject: 國語 / status: paused` 變成 `subject: null / status: active`，今天的份由 0 個目標變成 2 個。年級學期、單元、分類等也會受同一種屬性區誤判影響。

**根因與位置。** 分支的 `src/core/deck/need.ts:14`～`:15` 只接受從行首開始的 `---`，和 `parse.ts:40` 不同。誤判「沒有屬性區」後，`before` 保持空物件，後面的 `others(read) === others(before)`（`need.ts:64`）只比新建區，沒有察覺原屬性消失。目標名稱、ID、指紋未變，因此題目形狀核對也會通過。

**修法實跑。** 在隔離 bundle 的同一入口補拒絕條件：嚴格分隔線偵測失敗，但第一行 `trim()` 仍為 `---` 時，不得視為無屬性區建立新的一份，直接拒絕此次標記寫入。沿用 `withNeed` 的整份不寫與 `mark: refused` 提示。這是驗證過的保守修法；也可以統一讀寫端的分隔線辨識，但須同樣驗原文與所有屬性。

| 量測項目 | 真實／應維持 | 現在 `31f20d4` | 隔離修法後 |
|---|---|---|---|
| 科目／狀態 | 國語／暫停 | null／啟用 | 國語／暫停 |
| 今天的份目標數 | 0 | 2 | 0 |
| 原文是否逐字保留 | 無法安全標記時應保留 | 否 | 是 |
| `fillIds` | 應不寫 | true | false |

同一候選修法跑了既有 `NEED_FORMS` 20 例、成功例的冪等，以及開頭空白、Tab、全形空白、分隔線尾端全形空白、BOM＋空白＋CRLF 五例，均符合預期。請把這一類「讀寫端對屬性區有不同判斷」登錄進共用往返案例，並以真的 State 驗證暫停與科目沒有改變。

## R2［P2／規格］ID 衝突的字不出題時，對照說明也被過濾掉

**證據：State 出卡資料已重現；畫面缺說明由 `PickCard.tsx` 的條件渲染靜態確認，未另開 Obsidian。建議合併前修。**

**觸發條件與真實路徑。** 同篇有「寨／塞」比較卡，各自有記憶錨點；另一篇貼入帶相同 `sai000` ID 的目標。這是 D-157 已有的正常衝突處理路徑，不需要偽造內部物件。新開複習或衝突出現後重取卡，都可拿到剩下的寨目標。

重現的共同資料：

```markdown
---
科目: 國語
---
- 寨（寨、塞） 相似字 ^zhai00
    - 山＿＿ :: 寨
    - 記憶錨點：**木**圍起來：山寨
- 塞（寨、塞） 相似字 ^sai000
    - 大＿＿車 :: 塞
    - 記憶錨點：**土**堵住：塞車
```

另一篇為 `- 能說明 ^sai000`，下面一題 `問 :: 答`。

**預期／實際。** §5-1 的表（任務第 232 行）明列 ID 重複者不併入句子，**字鍵與對照照樣有**。實際 State 正確阻擋 `sai000` 作答，卡片也只有寨一格；但塞的 row 變成 `{ member: '塞', lt: null, anchor: null }`。原筆記的 `**土**堵住：塞車` 仍在 `state.decks()`，只是沒有傳到組卡端。結果畫面仍列塞這個字，卻沒有用來分辨兩字的說明與常用詞。

**根因與位置。** `src/state/index.ts:326` 附近的 `rebuild` 把衝突目標從 `planList` 移除，`index.ts:461` 又只把 `planList` 放進 `TodayInput.decks`。分支的 `src/core/study/session.ts:87` 把這份排程候選當成完整的 `deckTargets`；`src/core/study/practice.ts:185` 也傳過濾後的 `item.entry.deck.targets`。`compose.ts:85` 自然找不到塞，雖然該函式契約在第 94 行明寫是整篇全部目標。`src/ui/PickCard.tsx:59` 只有非 null 的 anchor 才顯示說明。

**修法實跑。** 隔離候選在 State 輸入另帶可讀、尚未裁掉目標的 `deckList`，讓一般複習與全部卡的對照取自這份完整內容；句子與排程仍只用原本的候選集合。這只是驗證資料責任分開後能解決問題，沒有替正式程式決定新欄位名稱或完成型別／邊界設計。

| 量測項目 | 真實／規格預期 | 現在 `31f20d4` | 隔離修法後 |
|---|---|---|---|
| 可出題的目標 | 只有寨 | 只有寨 | 只有寨 |
| `canAnswer('sai000')` | false | false | false |
| 字鍵數 | 2 | 2 | 2 |
| 有錨點的對照列數 | 2 | 1 | 2 |
| 塞的說明 | `**土**堵住：塞車` | null | 原文保留 |

`{ subject: '國語' }` 與 `{ deck: 路徑, since }` 兩條路都實跑，修法恢復對照，沒有重新允許衝突目標出題。請加接真的 State 的回歸；只有直接把完整 deck 交給 `planToday` 的測試，覆蓋不到這個裁切交界。

## R3［P3／規格與實作描述］§1 的四張表編譯保證目前只覆蓋兩個接點

**證據：靜態查核＋TypeScript 虛擬檔案探針已重現。這項本身沒有重現現行三題型的作答錯誤；請整合者核對契約。**

任務 §1 第 29 行承諾「一種題型＝四張表各填一列」，新增 `QuestionType` 時每張表都會被 TypeScript 指出缺列。分支的 `src/core/study/compose.ts:6` 也保留這句保證。實際上：

- `review/flow.ts` 有 `FLOWS`、`PREVIEWS`；`ui/screens.tsx` 有 `SCREENS`，都有 `Record<QuestionType, …>`。
- `core/deck/question-types.ts` 是 `typedAnswer`、`readPick` 兩個函式，`parse.ts` 直接依序呼叫；沒有對 `QuestionType` 窮舉的表。
- `core/study/compose.ts` 是 `cardOf`、`pickCardOf` 等函式；今天的份與全部卡仍分別判 `target.group` 選擇組卡入口，也沒有窮舉表。

用 TypeScript compiler host 只在記憶體把 union 加上 `'seam-probe'`，得到 3 個缺列錯誤：`flow.ts:73`、`:74`、`screens.tsx:216`；deck／compose 沒有錯誤。也就是 **4 個接點中 2 個有列完整性保證**，不是四個。沒有改工作樹，也沒有新增可使用的題型。

真實影響在下一個獨立題型開工時才出現：編譯器不能替解析、組卡抓漏；目前不把它算成學生作答或資料損壞。建議先把任務與程式註解對現況的宣稱核實；若仍維持四表契約，就需補正式架構與驗收，若採目前兩表＋專屬解析／組卡函式，則明訂這個差異。這裡沒有實作新的四表架構，不能把探針當成其修法已通過。

## 其他核對與驗證紀錄

- 獨立執行 `npm run check`：沙箱外通過，**1,669／1,669**；型別、ESLint／邊界、knip、secretlint、skill 副本、文件與全測試均通過，耗時約 272 秒。
- 審查請求列出的 15 個測試檔，帶 `--test-timeout=120000` 沙箱外重跑：**207／207** 通過，約 70 秒。初次沙箱內執行遇到 Git clone 寫 `.git/config` 權限失敗及 symlink EPERM；沒有把那次結果算成通過，重跑後沒有遺留失敗。
- `node experiments/t4/check-syntax.mjs --selftest`：退出 0；範例 0 個不符、錯誤案例 **25／25**、比較卡 **12／12**。
- `59c4b96` 合併交界逐段核對：`ready/fresh` 長度與 `early`、`answeredAfter` 依不同目標計間隔（符合 D-189，不改成按畫面張數）、`firstTry` 接每個實際寫入目標、改評分重建 `with` 與取消預檢、`encodeNew` 與正式 writer 呼叫、`setDeckStatus` 的 `need: null`／狀態核對、目錄單篇及小考範圍。本輪未在這些組合另確認缺陷；R2 是完整對照資料與 State 候選集合的交界。
- 翻面／打字第一步行為不整包重審；依請求比對基準，`review-session.test.ts`、`review-ui.test.ts`、`preview.test.ts` 無差異，`review.test.ts` 只新增 `englishBeside` 的 import 與一個測試。既有測試隨完整檢查通過。
- 20 個標記原文案例、成功例冪等、五種額外分隔線案例，以及 R1／R2 的目前版／修法對照，皆用自編內容與記憶體 Files；候選修法只存在暫存 bundle，未將任何修法寫回產品。候選沒有跑完整 check，不能替代 Claude 修正後在最終 commit 的回歸與 L2。
- 可重跑探針：在本 worktree 執行 `node C:\Users\kuo\AppData\Local\Temp\question-type-seam-l2-probe.mjs`。它讀該目錄目前原始碼，使用 esbuild 在作業系統暫存區套候選差異並執行斷言，不改 repo；暫存被清除後，本報告的原文、入口與對照值仍可重建案例。完整檢查與指定測試輸出分別在同目錄的 `question-type-seam-l2-check.txt`、`question-type-seam-l2-targeted.txt`。
- `PICK_NEEDS` 的最終正式版號、syntax／題型專區與新 syntax 範例照第 4 步處理，本輪沒有把尚未完成的發布步驟當成缺陷。

未測：本輪未操作 Windows／iPhone Obsidian、未實測 iCloud 同步、未讀寫測試或正式 vault、未安裝／發布、未另跑 `npm run build`；iPhone 與輸入法組字中途 Enter 仍依請求列為延後，Windows 既有實機紀錄只作來源資料，沒有冒充本輪獨立重測。

## Claude 的核對與回應（第一輪）

三項都先重現再修，一項一個 commit。最後驗證的程式是 `4d6c518`，之後的 commit 只改文件。

### R1：成立，已修（`572bb1b`）；修法和報告驗證的不同

**輸入類別**：第一行去掉空白後是 `---`，但不從行首開始（半形空白、Tab、全形空白、BOM 加空白），或分隔線後面有全形空白。`parse.ts` 一直用 `trim()` 認屬性區，`need.ts` 只認行首。

| 量測項目 | 真實／應維持 | 現在 `31f20d4` | 修法後 `572bb1b` |
|---|---|---|---|
| 科目／狀態 | 國語／暫停 | null／啟用 | 國語／暫停 |
| 今天的份目標數 | 0 | 2 | 0 |
| 文字 | 屬性都還有作用 | 前面新建一個屬性區，原屬性落到正文 | 第一行照原樣，標記加在原屬性區裡 |

**修法**：`parse.ts` 新增 `frontmatterLines`，`readProperties`、`need.ts`、`status.ts` 都看它，讀和寫不會再判斷不同。`catalog/scope.ts` 的規則本來就相同，沒動。核對也補上報告指出的洞：`shape` 換成 `meaning`，比全部屬性和每個目標的 ID、名稱、指紋，所以就算以後又有分歧，原屬性消失也會回 `null`、不寫。

**和報告不同的地方**：報告驗證的是拒絕寫入（`fillIds` false，提示 `refused`），也提到可以統一辨識。我選統一，這種卡組會寫上標記（`fillIds` true）：

- 解析器本來就把它當屬性區，科目、狀態都生效，§3 要求的「其他屬性逐一相同」也成立，不是「不能安全改寫」。
- 拒絕的話，這篇要等家長看到提示、改好第一行才能複習。多打一個空白是常態，家長看提示的機會又低，代價落在學生。
- v0.3.0 的解析規則相同，一樣讀得到標記、一樣擋住（`tests/pick-old-version.test.ts`），舊裝置不會誤出題。

拒絕的好處是完全不碰少見的形狀。這裡實際碰的只有屬性區裡加一行，第一行照原樣；核對不成立仍回 `null`。請第二輪看有沒有「寫進去會壞、拒絕才對」的輸入。

**證據**：`tests/helpers/need-forms.ts` 20 種加 6 種打字雜訊（開頭空白、Tab、全形空白、分隔線後全形空白、BOM 加空白加 CRLF、空白加舊值），進 `deckCases`，所有範例比 `meaning`；`tests/state-need.test.ts` 接真的 State，暫停與科目不變；`tests/pick-old-version.test.ts` 用 v0.3.0 的 `parseDeck`。實機（`0.4.0+4d6c518`）：空白、Tab、全形三種開頭，離開筆記前後都是國語／暫停、今天的份 0；`需要版本` 變成 0.4.0；ID 2 個；第一行照原樣；第二次離開文字相同。

### R2：成立，已修（`8b6d6be`）；和報告驗證的方向相同

**輸入類別**：ID 衝突被 `rebuild` 從候選裁掉的目標（D-157）：別篇同 ID、需要新版的卡組同 ID、同一篇同 ID。

| 量測項目 | 真實／規格預期 | 現在 `31f20d4` | 修法後 `8b6d6be` |
|---|---|---|---|
| 可出題的目標 | 只有寨 | 只有寨 | 只有寨 |
| 字鍵數 | 2 | 2 | 2 |
| 有錨點的對照列數 | 2 | 1 | 2 |
| 塞的說明 | `**土**堵住：塞車` | null | `**土**堵住：塞車` |

**修法**：`DeckEntry` 多一個選用的 `whole`，只有 `deck.targets` 裁過才有，由 `rebuild` 放進去；`session.ts`、`practice.ts` 的字鍵與對照看 `whole ?? deck.targets`。排程和句子還是只看裁過的候選，衝突的字不會出題。預覽（`createPreview`）直接解析編輯器的文字，沒有經過裁切，不受影響。

**證據**：`tests/pick-flow.test.ts` 接真的 State，`{ subject }`、`{ deck }`、`{ deck, since }` 三條路。實機（`0.4.0+4d6c518`）：`{ deck }` 和 `{ deck, since }` 都是一格、字鍵寨塞、結果 `right:寨`、對照兩行都在、紀錄只有 `寨:good`；截圖 40、41 深色淺色都看過。

### R3：成立，選報告列的第二條路，再多一個機械檢查（`4d6c518`）

真實影響確實在下一個題型才出現，所以比的是新增題型時哪一種抓得到漏接。

- **把解析、組卡也包成表（報告的第一條路，不採用）**：翻面和打字的組卡是同一個函式，解析有順序（中翻英、英翻中優先），又分「每一題」和「每個目標」兩個時機。包起來呼叫端還是要自己接，表只多一層殼，少接也不會報錯。
- **採用**：`FLOWS`、`PREVIEWS`、`SCREENS` 維持表，解析與組卡維持專屬函式；`tests/question-types.test.ts` 加一張 `Record<QuestionType, string>` 的範例，每個題型一段筆記文字，經過真的 State 和 session，到 `questionType`。少一列編譯不過；有列但解析或組卡沒接上，測試不過。

探針（`QuestionType` 多一個值，跑完還原）：`tsc` 從報告的 3 處變 4 處（`flow.ts:73`、`:74`、`screens.tsx:216`、`tests/question-types.test.ts:9`）。§1 的「一句話」和程式註解都改了（「四張表」改成「四個接點」），理由在任務說明〈實作者自己選的做法〉第 32 點。

### 跑過與沒跑的

- `npm run check`：三個修正 commit 的 pre-commit 各跑一次，都通過。
- 請求列的測試加 `tests/question-types.test.ts`（`4d6c518`）：跑了 8 次，7 次 221／221。**第 1 次有失敗，沒有查出是哪一個**：我的指令用 `tail` 截掉了測試名，只留下 `actual: false, expected: true, operator: '=='`，也就是一個帶訊息的 `assert.ok`。之後連跑 7 次沒再出現；Windows 事件紀錄這段時間沒有 node 當掉；事後量到可用實體記憶體約 3 GB、提交量 21.2／25.7 GB。這一次不算通過，也不能說成產品問題或環境問題。第二輪跑這組測試時請留完整輸出，再出現請寫下測試名。
- `node experiments/t4/check-syntax.mjs --selftest`：範例 0 個不符、錯誤範例 25／25、比較卡 12／12。
- 實機：上面各項，建置 `0.4.0+4d6c518`。R1、R2 以外的 §10 項目沒有重跑；`status.ts` 改用同一個入口，暫停、恢復的實機也沒有重跑，只靠自動測試。
- 沒跑：iPhone 全部、輸入法組字中途按 Enter，理由同第一輪。
