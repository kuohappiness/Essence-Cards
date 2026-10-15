# T4 API 模型實測

待回答：轉錄稿是否足以製作有出處的複習卡，附上原頁時結果有何差異？學習效果仍待驗證。任務規格見 [TASK.md](TASK.md)。

需要 Node 24；在本目錄執行 `npm install`（Windows PowerShell 可用 `npm.cmd install`）。僅使用 `pdfjs-dist` 與提供 Windows 預編譯套件的 `@napi-rs/canvas`，不需建置或 C++ 工具。

先執行 `node t4.mjs selftest`，再執行：

```powershell
node t4.mjs find --pdf <PDF路徑> --text <小節名稱>
node t4.mjs all --pdf <PDF路徑> --pages <起-迄> --out <repo外結果資料夾>
```

頁序從 1 起算；先用 `find` 找出小節，再挑 2～4 頁。其他指令及參數見 `node t4.mjs --help`。金鑰讀 `%USERPROFILE%\.essence-api-keys.env` 的 `名稱=值`，同名環境變數優先；程式不輸出或保存金鑰。

結果包含 `頁面/文字層.json`、頁面 PNG、各模型的轉錄稿／裁圖／檢查、`卡片/`、`紀錄.json` 及 `報告.md`。模型名稱中的 `/`、`:` 轉為 `-`，避免 Windows 檔名與 Obsidian 圖片衝突。

因額度失敗時，等額度恢復後重跑 `transcribe`、`verify` 或 `cards --out <結果資料夾>`，最後跑 `report --out <結果資料夾>`。既有成功檔案及相同輸入會沿用，不再付費請求；輸入或提示變更請使用新資料夾。缺少前置轉錄稿的步驟會提示並跳過；未全部完成時程序結束碼為 2。`cards --transcript` 可指定絕對路徑，或相對 `--out` 的路徑；引用圖片須放在該轉錄稿旁的 `圖/`。

`report` 與 `selftest` 完全離線。報告是機械統計：格式檢查依通用輸出範本列行號，出處比例以目標為單位（同目標的題目共用出處），簡體字只比對常見字形清單。費用依設定標價估算，不能當成實際帳單。

照正式出題語法試製卡（第四輪起，Claude 寫的）：

```powershell
node to-formal.mjs <轉錄稿.md> <repo外資料夾> "國二上自然 2-2" "國二上自然 2-2 水溶液"
node t4.mjs cards --out <結果資料夾> --transcript <正式格式的轉錄稿> --model gpt-5.6-terra --variant 只用轉錄稿 [--runs 3] [--prompt <其他提示檔>]
node check-syntax.mjs <卡片.md>… --transcript <轉錄稿.md> --unit 2-2 [--tree]
```

- `to-formal.mjs`：把這裡轉錄出來的暫定格式（`模型-p13-3.png`、`^fig-p13-3`）機械轉成 [syntax.md §1](../../docs/syntax.md#1-轉錄稿) 的圖檔名與錨點，內容不變。`report` 的格式檢查是第二輪的舊規則，新格式改用 `check-syntax.mjs`。
- `check-syntax.mjs`：照 syntax.md 解析 AI 交回的草稿，分「錯誤」（程式會跳過那個學習目標或連結壞掉）、「不符」（違反語法或製卡規則）、「提醒」（啟發式，要人看）列出行號；`--tree` 印出程式看到的正面與背面。`--selftest` 用自己編的範例檢查它本身。
