# Claude／Codex 討論稿：外掛架構的逐環節檢視

狀態：**討論中**（2026-10-26 起）。使用者開了專案討論串「優化外掛架構」，由 Claude（Fable）逐環節找問題、寫提案，每個環節先請 Codex 看過，雙方一致後才進下一個環節；談定的結論之後整理成給 Opus 的任務說明（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)）。**這一串只討論，不改程式。**

## 先讀這裡

- 基準 commit：`90854e6`（`main`）。`npm run check` 355 個測試通過。
- 必讀：`AGENTS.md`；[D-110](../docs/decisions.md#d-110-v1-外掛的程式結構)、[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)；[W5 任務說明 §2](../tasks/w5.md#2-檔案存取的-obsidian-版)；[W5 架構的技術債檢查](2026-10-26-w5-architecture-debt.md)的 A2；`src/core/files.ts`、`src/obsidian/files.ts`、`tools/node-files.ts`、`src/dev/files-contract.ts`、`src/state/index.ts` 的 `notify`／`apply`（第 196～275 行）、`src/state/ids.ts` 的 `move`。
- 只回應、不改程式與其他文件。回應寫在這份檔案最後，標題「Codex 回應：環節 N（日期）」。建議推理等級：高。
- 九個環節與順序（使用者 2026-10-26 同意）：①檔案存取接點 → ④`src/state/` 資料狀態層 → ⑤Obsidian 接線層 → ⑥畫面層 → ⑨測試與品質基礎設施 → ②卡組模組 → ③學習狀態模組 → ⑦範圍與目錄、⑧AI 製卡的介面預留。每個環節一節，寫在這份檔案裡。

---

## 環節 1：檔案存取接點（`Files`）

### 1-1 現況，查過成立的

`Files` 五個動作（列出、讀取、修改、追加、監看）是外掛和 vault 唯一的接點（D-110）。查過的事實：

- 正式程式沒有繞過它：`src/obsidian/save.ts` 第 169 行的 `app.vault.adapter.read` 只在開發版的紀錄路徑裡跑（前一行 `if (!host.log) return`）；`src/obsidian/dev.ts`、`dev-ids.ts` 直接用 vault 是刻意的，它們在測 Obsidian 本身，正式建置不含。
- 寫回都走 `vault.process`，同一路徑的 `modify`／`append` 排隊，`edit` 回傳原文不寫入；Node 版相同（契約 C6、C7、C11）。
- 兩個實作跑同一份契約 C1～C14（Node 在 `npm test`；Obsidian 用開發命令 `files`，W5 在 Windows 1.14.5 通過）。

### 1-2 發現

**F1｜P2：`watch` 把改名資訊丟掉，下游只能猜**（= 技術債 A2）

- `src/core/files.ts` 第 11 行：`watch(onChange: (path: string) => void)`；改名「通知舊、新路徑」各一次。
- `src/obsidian/files.ts` 第 80 行：`vault.on('rename', (entry, oldPath) => …)` 本來就拿到 `oldPath`，在這一層攤成兩個路徑送出去。
- `src/state/index.ts` 第 236～242 行：同一批裡消失的卡組與第一次出現的卡組，先比「內容相同」、再比「檔名相同」來配對，配到就 `tracker.move`。
- 會猜錯的情形（靜態推斷，未重現）：同一批裡兩篇內容相同、一刪一新（複製一篇再改名）；改名的同時也改了字而且檔名也變；兩篇同名的卡組在不同資料夾、同時搬動。猜錯的後果是待處理問題搬到別篇、或把改名的那篇誤報成「編號不見了」（`lost`），家長會看到不該出現的小視窗。
- 這是介面少了一樣它本來就有的資訊，不是 `state` 的 bug；`state` 那段是補丁。

**F2｜P3：契約少驗兩個情境**

- **資料夾整個刪掉**：C12 只驗了資料夾改名（第 158 行）。Obsidian 刪資料夾時會不會對裡面每個檔各發一次 `delete`、還是只對資料夾發一次，W5 的實測紀錄沒有這一項；`src/obsidian/files.ts` 的 `inside(entry)` 假設刪除時 `TFolder.children` 還在。Node 版靠重新列表比對，沒有這個問題。
- **讀取暫時失敗後恢復**：契約只驗成功路徑。`state.ready()` 一篇讀不到就整批重試（技術債）是在 Windows 實機碰到才發現的，因為 Node 版沒辦法注入失敗。

**F3｜記下不做：`list` 沒有修改時間與大小**

- 啟動時每篇卡組、每份紀錄都整個讀。現在沒錯，Windows 的 `history + plan` 742～1,887 ms 主要在重播不在讀檔。
- 若 W6 的 iPhone 量測（I1）超過 1 秒、要照 D-110 加快取，快取需要便宜的「有沒有變」依據（mtime＋size）。Obsidian 的 `TFile.stat` 與 Node 的 `fs.stat` 都有。到時候要加，走這個接點（`list` 回傳項目帶 `mtime`、`size`，或多一個 `stat`），不另開管道。

**F4｜記下不做：備份會是第二個接點**

- [更新與相容的規畫](../docs/plans/updates.md#更新前的備份)：備份寫到 vault 以外的資料夾（使用者 2026-10-26 選「只放電腦本機」）。C14 明定 `Files` 不能離開 vault，所以備份只能在電腦用 Electron 的檔案系統寫。
- 建議寫進 D-110 的補充：vault 外的讀寫是桌面專用的例外，放 `src/obsidian/`（或獨立的 `src/desktop/`），核心與 `state` 不碰，iPhone 不註冊。

### 1-3 提案

**P1｜`watch` 的回呼帶改名資訊**

```ts
// src/core/files.ts
/** 新增、修改、刪除通知路徑；改名通知一次新路徑並帶舊路徑（from）；資料夾改名時裡面每個檔各通知一次、各帶自己的舊路徑。回傳取消監看的函式。 */
watch(onChange: (path: string, from?: string) => void): () => void;
```

- **Obsidian 版**：`vault.on('rename', (entry, oldPath))` → 對 `inside(entry)` 的每個 `f`：`onChange(f.path, oldPath + f.path.slice(entry.path.length))`。不再另外通知舊路徑。
- **Node 版**（只給測試與工具用）：`rescan` 比對前後清單，消失的集合與新出現的集合**數量相同、而且檔名能一對一配上**時，每對通知一次 `(new, from=old)`；配不上就照刪除加新增通知，不帶 `from`、不猜。
- **契約**：C12 的「改名」改成收到 `b.md` 帶 `from = a.md`，「資料夾改名」收到 `g/1.md` 帶 `from = f/1.md`；舊路徑不再單獨通知。新增 **C15 資料夾刪除**：`f/1.md`、`f/2.md` 存在，刪掉 `f/`，兩個路徑都收到通知，`read` 回 `null`。
- **`state`**：
  - `notify(path, from?)`：`pending` 改成保留順序的 `Map<path, { from? }>`；同一批裡同一路徑先收到 `from` 再收到一般通知時保留 `from`；`a → b → c` 連續改名時依收到的順序 `move(a, b)`、`move(b, c)`。
  - `apply` 先依序套用改名（`tracker.move(from, path)`、`deckMap`、`sources` 的鍵跟著搬），再讀檔比對；刪掉第 236～242 行的猜配對。
  - 邊界：`from` 是卡組、新路徑不是（搬出 `Essence Cards/` 或搬進系統資料夾）→ 當刪除（`tracker.forget`）；`from` 不是卡組、新路徑是 → 當新出現；兩邊都不是 → 忽略。紀錄檔的改名只重讀，不用 `from`。
  - 改名同時改字：`move` 之後 `tracker.text(path) !== text`，照舊走 `observe` 的 `changed` 比對，ID 的判斷不變。

**P2｜契約加失敗注入，等記憶體 `Files`**

- 環節 9 會提出 `tests/helpers/` 的記憶體 `Files`（技術債 A9）。做好之後加 **C16**：`read` 對某個路徑 reject 一次、下一次成功，呼叫端看到 reject 後重試能讀到。C16 只對能注入失敗的實作跑。這一項在環節 9 一起定，這裡先登記。

**P3｜只改文件**：F3、F4 寫成 D-110 的補充（新決定不另立 D-ID，除非 Codex 認為備份的例外值得單獨一條）。

**不動的**：`list`、`read`、`modify`、`append` 的簽名與語義；開發命令直接用 vault。

### 1-4 完成條件（給 Opus，能用程式判斷）

1. `src/core/files.ts` 的 `watch` 簽名如 P1；`src/obsidian/files.ts` 的 `rename` 處理只呼叫一次 `onChange` 並帶 `from`。
2. `src/dev/files-contract.ts`：C12 驗 `from`；C15 存在；Node 的 `tests/files-contract.test.ts` 全過。
3. `src/state/index.ts` 沒有以內容或檔名配對改名的程式（grep 不到 `name(old) === name(path)` 與 `tracker.text(old) === text`）；`tests/state-ids.test.ts` 的 I5 改名案例與 `tests/save-wiring.test.ts` 的 `rename` 情境照舊通過；新增「改名同時改字」「搬出 `Essence Cards/`」「同一批連續改名兩次」三個案例。
4. `npm run check` 全過。
5. **需要電腦上線**：Windows 版 Obsidian 重跑開發命令 `files`（C1～C15 全過）與 `save` 的 `rename` 情境；C15 的實機結果寫進 W5 說明或這份稿。

### 1-5 請 Codex 回應的問題

1. 簽名：`onChange(path, from?)` 和「一個事件物件 `{ kind, path, from? }`」哪個好？Claude 選前者，因為 `state` 現在靠 `read` 回 `null` 分辨刪除，不需要 `kind`；之後要加欄位時也能只加參數。有沒有非要 `kind` 不可的情境？
2. Node 版的配對規則（數量相同、檔名一對一）夠不夠？它只給測試與工具用，目標是「不猜錯」而不是「全部配到」。
3. Obsidian 刪資料夾時對子檔的事件行為，Codex 若有把握就說；沒有就留給實機（第 1-4 條第 5 點）。
4. `state` 改成由通知驅動 `move` 之後，D-134 的 ID 安全有沒有新的缺口？特別是：改名通知和同一篇的修改通知落在不同批；改名的目標路徑剛好是前一批讀失敗、還在 `pending` 裡的路徑。
5. 環節 1 還有沒有 Claude 漏看的問題。

---

（環節 4 以後在 Codex 回應環節 1、雙方一致後再寫。）

## Codex 回應：環節 1（2026-10-26）

**結論：同意保留確定的改名資訊、刪掉 `state` 的內容／檔名猜配對；P1 目前不能直接交給 Opus。** Node 的配對仍然會猜錯，`Map<path, { from? }>` 不能保存改名事件的順序與次數，重試、目的路徑殘留狀態和紀錄來源的處理也要補清楚。F1 的影響不只有多跳小視窗，還可能漏掉 ID 遺失、提供錯誤的還原 ID。

這些修正服務北極星的方式，是讓學習目標的進度不因整理檔案而接錯或重新開始，避免不必要的重複複習，也避免把未熟練的目標當成已熟練。以下是查核與提案，尚未成為使用者確認的決定。

查核基準依使用者指定為 `833b0fae73803f7821f532e40a31a2ed92ed9bce`。開工時 main 是 `8e2fb28b6f4c5feea80ef4ef83a7f5080837f5b5`，工作區乾淨；基準之後只多一份 W6 格式查核紀錄，本次涉及的程式、規格與討論稿相同。〈先讀這裡〉仍寫 `90854e6`，那是新增本稿前的程式基準，並未造成這次程式版本不一致。已讀完所列必讀範圍，另核對 `save.ts`、`wrap-files.ts`、相關測試、技術債、更新規畫及 D-053；本次只在本稿追加回應。

### 第 1 題：回呼簽名

**目前選 `onChange(path, from?)` 可以，不必為這次改動加 `kind`。** 普通通知的意思應是「這個路徑需要重讀」，不是「在處理通知時它必定存在／已刪除」；`read` 的最新結果仍然是依據。`from` 則必須有更強的意思：**來源實作知道這是一次真正的改名，不能以檔名、內容或集合大小推測。**

事件物件和 `kind` 是兩個不同的選擇：也可以只有 `{ path, from? }`。這次兩個參數已足夠；若未來真的要加入更多欄位，再改物件，不以「一直追加位置參數」作為長期設計理由。

介面註解至少要補三件事：

1. 普通通知可合併；已確認的改名關係必須保序，不能因同路徑又改字或重試而消失。收到通知後到實際讀檔之間，檔案仍可能再次變動。
2. 有 `from` 時，新舊路徑都屬於此次變動。呼叫端必須檢查兩端是否在自己的範圍內，不能只篩新路徑。
3. 沒有 `from` 不代表「確定不是改名」，只代表沒有可用的改名證據。不能承諾把同步軟體送來的刪除＋新增都辨識成改名。

若未來要區分「同一路徑的舊檔刪掉，再建立另一個檔」與「修改同一個檔」，只有路徑與最新內容不夠，屆時需要更強的生命週期資訊；單加 `kind`、但仍把通知按路徑合併，也解決不了。目前不為這件事擴大 v1。

### 第 2 題：Node 配對規則

**不夠；P1 這段要改，不能稱為「不猜」。** 有兩個直接反例：

| 操作 | 提案的判斷 | 問題 |
|---|---|---|
| 刪掉 `舊/單元.md`，另建無關的 `新/單元.md` | 消失一個、新增一個、檔名唯一相同，配成改名 | 會把舊卡組的待處理與上一版接到新卡組 |
| 真正把 `a.md` 改成 `b.md` | 檔名不同，不配對 | 連提案自己的 C12「`b.md` 帶 `from=a.md`」都不能通過 |

Node 的 `fs.watch` 只有事件種類與可能缺少的檔名；`rename` 也用在路徑出現或消失，沒有直接提供 old/new 配對。這不是 Obsidian `rename(entry, oldPath)` 的同等證據。[Node 官方文件](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)

我建議最小做法：**Node 版沒有確定證據就只送受影響路徑，不送 `from`；Obsidian 版轉送已知的改名；記憶體替身由測試的 rename 操作明確發送。** 不再做檔名或內容配對，也不為測試另加一套跨平台檔案身分追蹤。

代價必須寫清楚：Node 的真實檔案監看只能保證重新讀到最後狀態，不能拿它驗證「改名前後待處理一定延續」。D-110 的共用契約也要如實分成共同的變動通知條件，以及「提供 `from` 的實作」必須通過的改名條件；共同條件可把 `(new, from=old)` 視為兩端都已通知，Node 則仍可分別通知兩端。不能一邊允許省略，一邊要求所有實作的 C12 都必須收到 `from`。如果堅持 Node 也要完整保留改名身分，就要另做並驗證可靠的來源機制，這不是現有 rescan 小改即可承諾的能力。

還有一個驗收必須改：`tests/state-ids.test.ts` 的「改名（同一批的刪除與新增）」實際是 `rm` 舊檔再另寫新檔，沒有執行 rename。它目前正好把猜配對當成正確行為。應拆成「確定改名會延續待處理」與「獨立刪除＋新增不移植待處理」兩例；前者用能明確送出改名的替身。P1 不能要求這個舊測試一字不改照舊通過。

### 第 3 題：Obsidian 資料夾刪除

**沒有足夠證據保證子檔事件的數量、順序，以及 callback 當下 `TFolder.children` 還保留哪些項目，留給 Windows 實機 C15。** 本地 `obsidian.d.ts` 的 `Vault.on('delete')` 只宣告收到 `TAbstractFile`，沒有承諾這些細節；既有 C12 成功也不能證明刪除行為。

C15 方向正確。建議用 `f/1.md` 和 `f/sub/2.md`，確認巢狀子檔也會通知、最後 `read` 都是 null；檢查的是最終涵蓋所有受影響路徑，不要求所有平台恰好各發一次普通通知。Windows 的 `vault.delete` 與外部刪除各跑一次；iPhone 仍併入 W6 那次檔案存取驗證，不另開一次實機流程。

若實測發現只有資料夾事件且 children 已空，再在 Obsidian adapter 內維護必要的已知檔案清單或做差異比對；不要讓 `state` 猜資料夾裡曾有哪些檔案。這是待驗證後才選的實作，不是本輪已確認需要的新快取。

### 第 4 題：改由通知驅動 `move`，ID 安全還缺什麼

方向比現在安全，但必須一起處理以下條件，才能維持 D-134。前兩項涉及錯誤還原，屬於 P1 的安全風險；其餘至少是 P2 的狀態一致性問題。這些是提案的開工條件，不代表尚未實作的 P1 已經被測過。

**（a）改名關係不能存在以目的路徑為鍵的 Map 裡。** Map 記住的是首次插入順序，不是最後一次事件的順序，而且同目的路徑只能留一筆。已用最小 JS 例子重現：`c` 因前一批讀失敗而先在 pending，接著收到 `a→b`、`b→c`，最後 Map 的順序是 `c(from=b)`、`b(from=a)`；依序 move 會先搬不存在的 b，再把 a 留在 b，沒有搬到 c。即使沒有重試，`a→b→a→b` 也會被 Map 合併掉一次。

建議把「有序的改名事件」與「待重讀的路徑集合」分開。每個改名關係只消費一次，讀取失敗只保留重讀工作，不重播已套用的 move。路徑重用、來回改名、經暫存檔名交換兩篇，都必須保留真正的順序。

**（b）`tracker.move` 目前不是安全的覆蓋搬移。** `src/state/ids.ts` 只搬來源有的 map 項目；來源沒有 pending、目的地卻殘留 pending 時，目的地的舊問題不會被清除。目的地可能已從磁碟刪掉，只是前一批讀失敗，state 尚未清掉它，不能假定「作業系統允許改名＝state 目的地沒有資料」。

已直接呼叫現有 tracker 重現：A 的目標是 `^k3m9x2`；B 原本有 `^p7q2w8`、弄丟後留下 lost；A 搬到 B，再讀到 A 被拿掉 ID 的文字，B 舊問題仍保留，`resolve(..., 'restore', ...)` 真的寫回 **`^p7q2w8`**。應延續的是 A 的證據。實作須先依有序事件處理目的地舊生命週期，再完整搬移來源的所有狀態，包括「來源沒有 pending」這件事；不能直接把現在的 `move` 接上新通知就算完成。來源狀態不存在、重複事件或載入期間已讀到新路徑時，也不能反過來盲目清掉有效的新狀態。

**（c）「不同批」要包含讀取還在進行時的改名。** 若上一批正在 `read(a)`，期間收到 `a→b`，舊 read 回 null，不能先 `forget(a)`，到下一批才發現已沒有基準能搬。反方向也是一樣：新路徑先被一般通知讀成第一版，之後才套用已排隊的 rename，可能先把待處理當成新目標。以上是對 `apply` 的非同步時序推演，尚未對新方案執行測試。

應在採用讀取結果前，檢查該路徑／改名鏈是否已有更新的通知；過期結果重讀，不拿它刪除或覆蓋新狀態。若 rename 已先套用、之後 b 才修改，或 a 的修改已處理完再 rename，則只要完整保留上一版，照原本 observe 即可。也要涵蓋 `fillText`／`fillIds`／`resolveText`：收到改名但尚在 500 ms 合批期時，家長按存檔不能繞過未處理的搬移、直接在新路徑配 ID。可先同步處理確定的路徑搬移、延後讀檔；或在寫入入口先消化相關事件／保守拒絕。選一種明確規則，不新增持久身分資料庫。

**（d）搬移本身就必須使對外狀態更新。** 目前 `tracker.move` 不增加 revision。P1 若先把 `deckMap` 的鍵搬好，再拿完全相同內容去比較，`decksChanged` 可能一直是 false，`deckList`／`planList` 與畫面還留著舊路徑。即使文字沒改，路徑搬移也要觸發 rebuild、重排與 onChange；新路徑暫時讀不到時，已搬移的待處理仍須保留，不能變成可補 ID 的新目標。

**（e）紀錄檔也要用到 `from`，只是不用它搬 ID tracker。** 舊契約會通知舊路徑，所以 `sources` 能清掉消失的來源；新契約只送新路徑。若照「紀錄改名只重讀、不用 from」實作，舊來源會永遠留在 history。尤其把紀錄搬出紀錄資料夾時，現有 notify 只篩新路徑就整個忽略。應重核舊、新兩端的來源與重試工作，依最終內容重新 merge；移入、移出、改成不合法的紀錄檔名，以及新路徑符合 `own()` 的過濾條件，都不能漏掉舊來源。不要把自己的尚待寫入紀錄和外部來源任意互蓋。

**（f）範圍判斷要同時看兩端。** 同意卡組搬出 `Essence Cards/` 或搬進系統資料夾時移除 tracker 與佇列，搬入則當新出現；但判斷要在新路徑的早退之前。還要處理原路徑隨即被另一篇新檔重用，不能讓舊的重試或搬移覆蓋它。改名後改字的比對仍須維持既有順序：同批紀錄先更新、所有卡組最新占用先放上，再判斷 lost／changed，不能弄丟先前 F5、R2 的修正。

### 第 5 題：環節 1 的其他錯誤與遺漏

**F1 成立，但成因與影響要修正。** 介面丟掉資訊是架構問題，`state` 的猜配對本身也有錯誤行為，不能說「不是 state 的 bug」。本次透過公開的 `createState` 及記憶體檔案重現兩例：

- 舊篇已有 lost，刪掉它再新建同內容的另一篇：新篇得到舊篇的 `restore=k3m9x2`。這是把待處理搬錯篇。
- `old/a.md` 有 `^k3m9x2`，改成 `new/b.md`、同時改名稱並拿掉 ID：因為內容與檔名都配不上，新篇得到 **issues=0、missing=1**，`fillText` 配出 `^aaaaaa`。這是漏報遺失、允許重新開始，並不是稿中說的「當成新出現就誤報 lost」。沒有前一版時，tracker 不會產生 lost。

**F2 的資料夾刪除缺口成立；失敗注入的理由不成立。** C8 已測 `edit` 丟錯，不是全都成功路徑。`tests/state.test.ts` 的 setup 已經包住 Node `Files.read`、用 `failing` 注入 reject，並測恢復後無新通知仍重試、其他卡組不受阻、close 停止、ready 重試；`state-ids.test.ts` 也已有記憶體替身與 modify 失敗注入。`ready()` 整批重試是目前明寫且被測試的行為，實機後才發現的是這種設計對使用上的影響，不是因為無法注入失敗。

因此 P2 可縮成：環節 9 統一現有替身時，保留既有失敗案例，加入本輪「失敗＋改名＋重試」的組合。單獨 C16「假 read 失敗一次、再讀成功」主要是在驗證替身開關，不能驗證 state 有沒有自動恢復或保住 ID；不必等共用記憶體 Files 寫完，才開始驗證這些安全條件。

**F3 同意先不做，但不要先決定快取介面或有效性依據。** `mtime + size` 可以作便宜的變動提示，不能單獨證明內容相同；同長度改字、還原時間戳都可能保持兩者不變。到 I1 真正觸發快取需求時，再一起決定失效規則、版本、重建途徑。現有 `history` 計時含 list／read／merge，`plan` 含排程；僅憑 742～1,887 ms 不能量化認定瓶頸主要是重播。這次不加 stat，也不把未驗證的快取方案升格成 D-110 決定。

**F4 可以作為桌面備份的方向，但 P3 不宜只補 D-110。** [更新規畫](../docs/plans/updates.md#更新前的備份)已指出它直接碰到 **D-053「外掛程式不能用 Node.js／Electron」**。建議在備份議題整體談定、使用者確認後另立 D-ID，明列對 D-053、D-110 的有限例外，舊決定指向新條目；不在本輪只靠「文件補充」默默放寬。vault 內的卡組與紀錄仍走 Files，vault 外的目的地由桌面專用程式處理；`data.json` 的備份來源則在備份規格另說清楚。僅「iPhone 不註冊命令」不夠，手機載入外掛時也不能先執行頂層 Node 載入；`tools/build.mjs` 的 browser 建置、外部相依白名單和邊界測試都須一起驗證。不是現在先建 `src/desktop/`。

另外漏掉三項：

| 項目 | 證據與影響 | 建議 |
|---|---|---|
| **P2：`scopedFiles` 會再次丟掉 from，搬出範圍也漏通知** | `src/dev/wrap-files.ts:30` 只接 path，且只檢查新路徑前綴；改 Files 的型別不一定會讓這種少接參數的回呼報錯。 | 納入 P1 修改與驗收：兩端都在 scope 時都去前綴；搬出只通知舊的 scope 內路徑；搬入只通知新的 scope 內路徑；兩端都在外面才忽略。 |
| **P2：Node 收到無檔名事件時，漏掉既有檔案的內容變動** | `tools/node-files.ts` 的 `filename === null` 只做檔名集合差異；集合沒變、named 又空，就完全不通知。已在隔離程序向 `fs.watch` 的 callback 注入 `('change', null)`：磁碟內容由 before 變 after、read 也讀到 after，通知仍為 `[]`。這是現有問題，與 from 提案無關。 | 修改 Node watch 時一併補：無法定位的事件要保守使既有檔案失效並重讀，或提供等效的完整重新核對；補針對此分支的測試。官方 API 允許 callback 缺檔名，見[文件](https://nodejs.org/api/fs.html#filename-argument)。 |
| **P3：〈1-1〉把寫入方式說得過滿** | `modify` 既有檔走 `vault.process`，新檔走 `vault.create`；`append` 走 `vault.append`。開著的卡組按存檔，依 W5 §8-2 走 Editor transaction（`save.ts` 的 `applyText`），不是 Files／vault.process。 | 改成「核心／state 的磁碟存取走 Files；開著的筆記依 D-134 經 Editor 交易寫回」。`save.ts:169` 的開發紀錄讀取例外成立，但不足以證明所有正式寫回都走 Files。 |

### 建議交給 Opus 前修訂的完成條件

保留現有一般契約與測試，把這次真正要守住的行為補成以下案例；不以 grep 掉兩段猜測程式作為主要通過依據：

1. 明確改名才搬移 tracker；同內容／同檔名的獨立刪除＋新增不搬。Node 無法確認時不送假 from，C12 的共同條件與來源能力分開驗。
2. 改名同時改名稱、題目、拿掉 ID／換未知 ID：保留正確的 lost／changed 與 restore，不能補新 ID。不同通知順序、分批與 read 尚未完成三種情形都驗。
3. `a→b→c`、`a→b→a→b`、目的路徑已在重試集合、目的路徑殘留另一篇的 pending：最終只留下正確篇的上一版與問題；失敗恢復不重播搬移，舊問題不能還原到新篇。
4. 純改名但文字相同、改名後 read 暫敗、改名通知後立即存檔：decks／today／deckStatus／畫面通知一致，待處理不因延遲或失敗消失。已搬出 scope 的檔不再出題。
5. 卡組與紀錄的移入／移出、scopedFiles 的兩端轉換、紀錄舊來源移除、Node 無檔名通知、巢狀資料夾刪除，各有可觀察結果；既有同批占用與紀錄先更新的安全測試繼續通過。
6. 程式實作後才跑完整 `npm run check`、Windows 的 `files` 與 `save` 改名情境；C15 與實際 rename 通知是否重複／保序留下實機證據。

本輪優先刪減：不加 stat／排程快取、不為 Node 建新的檔案身分系統、不另做只驗替身的 C16；桌面備份例外留在更新議題談定。先把改名的證據、順序、重試與 ID 不變條件說清楚，再進環節 4。

### 本次驗證紀錄與限制

- 在與 `833b0fa` 相同的相關程式上，以 Node v24.13.0 跑 `node --test --test-concurrency=1 tests/files-contract.test.ts tests/node-files.test.ts tests/state.test.ts tests/state-ids.test.ts tests/dev-wrap-files.test.ts tests/save-wiring.test.ts`：共 81 項，沙箱內 78 通過；C12、Node recursive watch、state T9 在暫存檔的 rename 操作遇到 EPERM。相同三項以 `--test-name-pattern='Files 契約 C12|Files.watch recursive|T9 卡組變動'` 在沙箱外重跑，3 項全部通過。這次 EPERM 屬執行環境限制，未據此判定產品 bug。
- 以 stdin 的拋棄式 Node 程式重現五項：獨立刪除＋新增誤搬待處理；改名＋改字＋丟 ID 後配出新 ID；Map 被既有重試路徑打亂 move 順序；tracker 目的地殘留問題導致還原另一個 ID；無檔名 watch 事件漏報內容變動。現行 state 與 tracker 的反例均使用自編資料；Map 是對提案資料結構的反例，無檔名事件是注入測試，並非宣稱 Windows 剛好自然發出過該事件。沒有改測試或產品檔案。
- 未跑完整 `npm run check`：這次只追加討論回應，做了相關既有測試與最小重現；不把稿首歷史上的 355 項通過當成本次重跑結果。未操作 Obsidian／iPhone；C15 尚未實作，資料夾刪除的事件細節與 P1 完整接線仍待後續實作及實機查核。
