# W6 交接單（Opus 5.5 → Fable 5.1，2026-10-27 凌晨）

遵守 repo 根目錄的 `AGENTS.md`。這份交接單請 Fable 決定兩件狀態層工作的排程（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)：任務說明沒寫到、做了又很難收回的，Opus 停下來交給 Fable）。這兩件不擋 W6 的 L2，但擋 W6 的 iPhone 測試。建議推理等級：**high**。

W6 全部做完、合併之後刪掉這份檔。

## 1. 做到哪裡

- worktree `D:\程式開發\Essence-Cards-w6`，分支 `claude/w6`，最新的程式 commit 是 `7242db0`；`main` 已合併進來（到 `7f6e7df`）。`npm run check` 445 個測試通過；正式版 `main.js` 483,921 bytes。
- W6 §0～§6 做完：Windows 版 Obsidian 的 W1～W6 都有結果，實測找到的問題都修了。Codex 的格式查核照 `main` 上定案的寫法（`7f6e7df`、[核對說明](w6-format-review-fixes.md)）實作好了：F1 整格不能當打字答案就停出、F2 換行先查、F3 `retry: not-needed`、F5／F6 的測試。「版本」命令顯示建置版本（例如 `0.0.1+7242db0`），iPhone 測試靠它確認跑的是哪一次建置。
- **[審查請求](w6-review.md)已經寫好，可以交給 Codex 做 L2**（使用者轉交，新開的 Codex session，推理等級：高）。
- 未合併；W6 的 iPhone 測試（§7）還沒做。

## 2. 請 Fable 決定

### 2-1 技術債 A1 的觸發點到了

backlog 的 A1（紀錄的壞行救回規則在 `state` 有第二份）觸發點是「下一次改紀錄格式（W6 加 `retry` 欄位）」。W6 的限制第 1 點不准改 `src/state/`，所以沒做。`retry`（含 `not-needed`）不影響 `ltsOf`（它只找 `lt`），沒有新的錯。

- **Claude（Opus）的建議**：不在 W6 做，併進 2-2 的狀態層工作（兩件都改 `src/state/` 與 study 的紀錄讀取，一次 L2）。請確認，並改 A1 的觸發點。

### 2-2 「卡組讀不到就整個重試」要在 W6 的 iPhone 測試前做

backlog 這一列的觸發點是「W6 的 iPhone 測試前」：iCloud 還沒下載好的一篇卡組會讓整個外掛讀不到，iPhone 測試很可能碰到。它要改 `src/state/` 很多地方（ID 安全的限制、A4／A5 拆檔），超出 W6 的範圍，需要自己的任務說明與 L2。

- **Claude 的建議順序**：Fable 寫這件的任務說明（含 A1）→ Opus 在另一個分支（例如 `claude/state-load`，從 `main` 開）做，和 W6 的 L2 同時進行 → Codex L2 → 合併進 `main` → `main` 合併進 `claude/w6` → W6 的 iPhone 測試 → 合併 W6。
  - 不這樣做的代價：照 W6 說明，iPhone 測試在 W6 合併前；如果先不做這件就測 iPhone，碰到一篇還沒下載好的卡組時整個外掛讀不到，測試要重來。
- **要協調的**：Fable 正在進行的[外掛架構檢查](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)環節 1 的 P1（`watch` 帶 `from`）和環節 4 也改 `state` 的 `apply`；三件改同一段，建議排成一個分支或依序做，不要同時改。另外，那份稿說「環節 9 會提出記憶體 `Files`（A9）」：**A9 已經在 W6 做好**（`tests/helpers/memory-files.ts`、`tests/helpers/obsidian.ts`，`2ea31fb`），W6 合併後 P2 的 C16（失敗注入）可以直接加在它上面。

### 2-3 小事（看一眼即可，不決定也照現在的做）

- 出處圖示：W6 說明 §3-8 寫「背面右下角」，樣式稿放在答案下方左邊；照說明放右下。
- 換卡動畫約 0.27 秒內的按鍵不算（試作外掛的做法），快速連按 ← 會少走幾張。
- 用箭頭連起來的英文（`go → went → gone`）會出現好幾個喇叭。
- 回看的卡仍標「新」。

## 3. 之後 Opus 接著做（照這個順序）

1. 使用者把[審查請求](w6-review.md)交給 Codex；核對 L2、修正、再審。
2. 2-2 的狀態層工作合併進 `main` 之後，把 `main` 合併進 `claude/w6`，在 Windows 重跑 `review-script`、`ui`、`decks`；寫 iPhone 測試的步驟（W6 §7，照試作外掛 README 的〈iPhone 測試清單〉寫成完整的句子），J4 的基準在電腦用開發命令 `decks` 記下。
3. iPhone 測完照 §7 驗收（I1 超過 1 秒就停下來回報使用者）；合併 W6；提醒使用者 iPhone 換到 W6 版之前不要複習含 ` | ` 的卡；第一個里程碑，提醒做 code-quality 的里程碑回顧與安全檢查（D-117、D-119），A3 的觸發點也在這時。

## 4. 在 Windows 測 Obsidian 的注意事項

- **不要用 computer-use 截 Obsidian**：截到的是舊畫面，而且之後 Obsidian 被當成「被遮住」，停止繪製、計時器變慢。改用開發命令：`obsidian://essence-cards-dev?run=ui`（畫面與鍵盤，截圖寫到測試 vault 的 `Essence W6/結果/畫面 …/`），`run=reload` 換新的 main.js，`run=errors` 看 console 錯誤。安裝：`npm run install-vault -- <測試 vault> --dev`（位置在 Claude 的記憶 `test-vault-location`）。
- 每跑一次 `ui` 或 `review-script`，測試 vault 的紀錄檔會多十幾到三十行，全部互相取消，`today` 不變。
- W6 範例卡組（`Essence Cards/W6 範例/`）已經補好 ID；材料與自己畫的圖在 `Essence W6/材料/`。
