# Obsidian 1.14 → 1.15 相容性檢查

狀態：Windows 通過（2026-11-03，Obsidian 1.15.0，開發版 `0.2.0+a06f1d5`）；`obsidian` 套件的型別檔等 npm 發布 1.15 再比（[技術債](../docs/backlog.md#技術債)）；iPhone 在[下一次 iPhone 實機測試](../docs/backlog.md#v1-需要做的任務)。

照 [D-138](../docs/decisions.md#d-138-obsidian-出新的次版本時做一次相容性檢查) 與 [quality.md](../docs/agents/quality.md#obsidian-相容性檢查) 的三層做。改版說明：[1.15 Desktop](https://obsidian.md/changelog/2026-11-02-desktop-v1.15.0/)、[1.15 Mobile](https://obsidian.md/changelog/2026-11-02-mobile-v1.15.0/)、[Early Access 的 Desktop](https://obsidian.md/changelog/2026-10-22-desktop-v1.15.0/)、[Early Access 的 Mobile](https://obsidian.md/changelog/2026-10-22-mobile-v1.15.0/)。

## 第一層：API 與 CodeMirror

npm 與 GitHub 上的 `obsidian` 套件最新還是 1.14.4，沒有 1.15 的 `obsidian.d.ts` 可比，所以這一層只做到下面的替代檢查，型別檔的比對還沒做。

| 查什麼 | 結果 |
|---|---|
| 安裝的 1.14.4 與 `obsidian-api` 的 `master` | 只差 5 行註解（sidedock 改叫 sidebar），API 沒變；`peerDependencies` 一樣 |
| 1.15.0 主程式（`%APPDATA%\obsidian\obsidian-1.15.0.asar` 的 `app.js`，只讀不執行）的 `obsidian` 模組匯出 | `src/` 用到的 17 個執行期名稱都還在 |
| `@codemirror/view` 的版本 | 6.43.13 的字串常數都找得到；6.43.14 的 `"IMG"`、`"BR"` 判斷與 6.43.15 的捲動判斷都沒有，舊的 `scrollHeight<=clientHeight&&scrollWidth<=clientWidth` 還在：推定還是 6.43.13 |
| `@codemirror/state` 的版本 | 6.7.6 已是 npm 最新，字串常數都找得到 |

CodeMirror 沒變，`package.json` 不用改，`npm run check` 不用為此重跑。CodeMirror 的版本是比對出來的推定，不是套件寫明的。

## 第二層：Windows 開發命令

和 1.14.5 最後一次的結果逐欄比對，時間與隨機 ID 不算差異。

| 命令 | 結果 | 和上一次比 |
|---|---|---|
| `files` | 17／17 | 相同 |
| `compare` | 212 個情況；不一致 60 個、磁碟內容變動 4 個 | 相同（只差隨機 ID） |
| `lock` | 50／50 | 4 列的文字不同（下面第 1 點），判定都通過 |
| `save` | `checks` 全部 true，含 `clicked` | 相同 |
| `today` | 通過 | 只差日期 |
| `answer` | 寫入、讀回、復原都對，`todaySame` 為 true | 只差日期與累積的紀錄量 |
| `events` | T3 相同；`cleanupLeft` 空的 | A3 表的 19 個步驟裡，第 0、5、15 步順序或次數不同（下面第 2 點） |
| `a3check` | C1～C11 都 `ok`；`cleanupLeft` 空的 | `skipped` 相同：C8 未載入的分頁、C10 在畫布裡打字 |

改版說明提到的地方另外跑了三個：

| 命令 | 為什麼跑 | 結果 |
|---|---|---|
| `md-cases` | 閱讀模式的渲染 | 423 列全過，和上一次相同 |
| `save-tips` | 「只在文字被截斷時顯示說明」 | `checks` 全過；看過截圖，存檔按鈕的說明照常出現 |
| `t1prep` → `app-reload` → `t1close-cold` | 「外掛啟動更快」 | 通過，含未載入分頁（`deferred`）；layout ready 前沒有檔案呼叫 |

**1. `lock` 的 4 列（即時預覽、原始碼模式各 2 列）**：1.15 移動或縮排清單項目時，子項目會跟著動。鎖定都正常、ID 沒掉，解析結果如下：

| 操作 | 1.14.5 | 1.15.0 |
|---|---|---|
| 目標那一行上移（`editor:swap-line-up`） | 兩題都變成「溶解」的，「擴散」不見 | 兩個目標連同題目對調，內容正確：**變好了** |
| 目標那一行按 Tab | 「溶解」變成「擴散」底下的補充，它的題目 Q2 歸到「擴散」 | 「溶解」同樣變成補充，Q2 跟著進去，**不再出題** |

Tab 的結果和閱讀模式看到的一致，也符合「縮排錯一層是不同結構，不是錯誤」（[syntax.md](../docs/syntax.md) 與 [D-047](../docs/decisions.md#d-047-編輯畫面標示卡組結構) 靠編輯畫面的樣式看出來），所以不算不相容、不改程式。兩版都不會跳提醒：問題清單只看還是目標的項目（`src/state/ids.ts:135`，這一點是讀程式，沒有實測）。差別是題目從「歸錯目標」變成「不出題」，記在[技術債](../docs/backlog.md#技術債)。

**2. `events` 的三個步驟**：多出或提前的只有 `layout-change` 與 `active-leaf-change`，是 `saver opened` 和這些事件的先後，1.14.5 的兩次結果之間就有同樣的差異（第 5、15 步和 `events … 233603` 相同）；第 0 步現在和第 3 步同一個順序。`saver` 的開與離開、`vault` 事件、開著的卡組都一樣，`a3check` 也通過。不影響[A3 表](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md#實機記錄t3-與-a32026-10-27opus-55>)的結論。

## 第三層：改版說明

| 範圍 | 條目 | 結論 |
|---|---|---|
| 編輯器與 CodeMirror | 智慧清單：縮排、移動帶著子項目 | 有影響，見上面第 1 點；鎖定通過 |
| | 智慧清單：有子項目時在行尾按 Enter，新增第一個子項目 | `lock` 的「名稱最後按 Enter」結果和 1.14.5 相同，ID 留在原行 |
| | 即時預覽的上下移動游標、選取粗體斜體的隱藏符號 | 只影響游標與選取，`lock` 通過 |
| | 語法樹的節點名稱多了 `formatting-*-end` | 沒影響：`src/` 與 `styles.css` 沒用語法樹與節點名稱 |
| | Vim 模式 | 沒影響：外掛不依賴 |
| Markdown 解析與閱讀模式 | 清單與區塊 ID | 改版說明沒有相關條目；`compare`、`md-cases` 和 1.14.5 相同 |
| | 從標題開始的頁面預覽、Canvas 卡片遇到 `---` | 沒影響：外掛不走這兩條路 |
| | Mermaid 改用 Pele，不再內建 Mermaid | 沒影響：外掛與 syntax.md 都沒用 Mermaid；學生卡片裡放圖表沒有驗 |
| | `PIXI` 延後載入 | 沒影響：外掛沒用 |
| | 建議、`prepareFuzzySearch` 忽略變音符號 | 沒影響：外掛的 `SuggestModal` 不用這兩個函式 |
| 檔案與 vault 事件 | 改名 vault 外的檔案不再關分頁 | 沒影響：卡組都在 vault 裡 |
| | 外掛啟動更快 | 冷啟動通過，`onload` 仍很短、layout ready 前沒有檔案呼叫 |
| | 只在文字被截斷時顯示說明 | 沒影響：`app.js` 裡是另一個函式，帶 `aria-label` 的一般說明走原路；只看過程式與 `displayTooltip` 的截圖，真的把滑鼠移上去沒有測 |
| | URI、CLI 的新命令（在標題下追加） | 沒影響：外掛用自己的 URI |
| iOS 與同步 | iOS 語音速記、PDF 匯出、管理 vault 的新畫面、分頁拖放 | 和複習流程無關，iPhone 實機確認 |
| | 同步與 iCloud | 改版說明沒有相關條目；管理 vault 只多了建立 Obsidian Sync vault |
