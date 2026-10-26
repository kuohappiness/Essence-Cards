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
