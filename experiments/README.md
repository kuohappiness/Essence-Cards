# 試作場

回答「討論難以回答、試一次就知道」的問題，例如畫面的樣式和手感（[D-065](../docs/decisions.md#d-065-試作場)）。這裡不是產品程式；開始寫 v1 正式程式後就停用。

只在這裡做測試時，讀這一頁就好；需要決定的細節時，再查連結的文件。

## 規則

- 每個測試先寫一句「要回答哪個待決問題」；回答不了的不做。
- 誰來測依 [AGENTS.md](../AGENTS.md)：AI 能測的由 AI 測，iPhone 的測試集中成一次。
- repo 是公開的：這裡只放自己編的內容。真實教材與學生資料只放測試 vault。
- 結果在測試清單記一行；能定案的才寫進 [decisions](../docs/decisions.md)。

## 放在哪裡

| 內容 | 位置 |
|---|---|
| 樣式稿：單一 HTML，不用建置 | `mockups/` |
| 試作外掛 | `plugin/`（還沒建立；從 2026-10-07 的原型改起：`git show a5b7c5f^:experiments/obsidian-ui-probe/main.js`） |
| 自己編的範例卡 | `samples/`（還沒建立） |
| 測試 vault | iCloud 的 Obsidian 資料夾（`iCloud~md~obsidian`）裡的 `Essence Cards Test`，電腦和手機共用；不進 repo |

## AI 怎麼測

| 對象 | 做法 |
|---|---|
| 樣式稿 | 在 app 內建的瀏覽器開，用 iPhone 尺寸（375×812）看淺色與深色；檢查版面、按鈕與主控台錯誤 |
| 排程、語法解析這類純邏輯 | 寫 Node 小程式檢查 |
| Windows 版 Obsidian | 在這台電腦開測試 vault 測 |
| iPhone | 外掛自動量測，把結果寫成測試 vault 裡的檔案，經 iCloud 傳回電腦後讀取 |

## 測試清單

### T1 複習畫面樣式｜進行中

- 問題：哪種樣式讓學生複習時一直覺得舒服？（[D-058](../docs/decisions.md#d-058-複習畫面的樣式)）
- 做法：先看舊外掛複習畫面可以改進的地方，再做幾種樣式，放在同一個 HTML 裡切換。
- 誰測：AI 先檢查；使用者從過關的樣式裡選。
- 結果：

### T2 複習畫面原型｜待做

- 問題：React 與 Preact 的啟動時間、翻卡與滑動手勢的動畫、能否藏起 Obsidian 的上下欄、卡片裡的圖片、公式與音檔（[D-051](../docs/decisions.md#d-051-複習畫面用-react)）。
- 誰測：AI 測 Windows；iPhone 由使用者最後確認，和 T3 一起做。
- 結果：

### T3 實機驗證｜待做

- 問題：在測試 vault 測離線作答、兩端同時修改、附件與單一檔案救回；確認 `紀錄/` 裡的 `.jsonl` 檔能正常同步，iPhone 不會因為 iCloud 移除本機檔案而讀不到（[D-035](../docs/decisions.md#d-035-複習紀錄格式)）。
- 做法：可沿用 2026-10-07 原型的「五分鐘驗收」清單（`git show a5b7c5f^:experiments/obsidian-ui-probe/README.md`）。
- 誰測：iPhone 與兩端同步需要使用者；和 T2 的 iPhone 部分集中成一次。
- 結果：
