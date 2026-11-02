# 國小社會預設 v0.4：用 Sol 跑康軒五上 2-1 對照

狀態：待開工（2026-11-03 寫）

遵守 repo 根目錄的 `AGENTS.md`。執行者：使用者電腦上的 Claude，建議 Opus、推理等級 high（規格已定，要做的是轉錄、接提示、跑生成與機械檢查）。評分不在這份任務裡，由專案討論串「制定國小社會學習目標地圖」的 Claude 做。

## 為什麼做

[D-137](../docs/decisions.md#d-137-國小社會放進-v1) 第 4 點：國小社會預設要用真實教材試用通過才開放。第一次試用（2026-10-26，[試用紀錄](../docs/card-rules/trials.md)）是 Claude 自己照規則製卡、自己檢查；這次用正式的模型 Sol 照同一份提示跑 2-1，看預設 v0.4 在正式模型上的表現，並檢查 [D-166](../docs/decisions.md#d-166-國小社會預設試用後的修改換一個地方還成立嗎反方向照第-9-條) 第 3 點留給對照的項目。不做的話，預設只有「寫規則的人自己照做」的證據，開放後才會知道 Sol 會不會犯同樣的錯。

## 必讀範圍與基準

- 基準 commit：`main` 上加入這份說明的 commit。
- 預設：[docs/card-rules/elementary-social.md](../docs/card-rules/elementary-social.md) v0.4。
- R3 的四份提示：`experiments/t4/arch/第二輪/格式.md`、`experiments/t4/arch/短規則.md`、`experiments/t4/arch/第二輪/判斷邊界.md`、`experiments/t4/arch/第二輪/五步.md`；接法照 `experiments/t4/arch/第二輪/設定.json` 的 R3 與 `sol-plan`。
- 轉錄規則：`experiments/t4/prompts/transcribe.md`；正式格式見 [syntax.md §1](../docs/syntax.md#1-轉錄稿)，可以用 `experiments/t4/to-formal.mjs`。
- 程式怎麼跑：[experiments/t4/README.md](../experiments/t4/README.md) 的學習目標架構兩節。

## 教材

使用者給的康軒五上教師用書（路徑見交接訊息）：2-1 的 PDF（課本頁 p.40～51），以及全冊習作指導 PDF 裡的習作 p.12～15（PDF 第 10～13 頁）。教師用書的紅字參考答案、❖ 說明、問題提問與參考解答是給老師的註記，轉錄時照 transcribe.md 標成教師註記。

## 要做什麼

1. **轉錄**：照 transcribe.md，由你自己看原頁轉錄，不呼叫付費 API（同 [第二輪的轉錄](objective-architecture-r2-transcription.md)）。課本與習作各一份，或合成一份並標出習作的部分。康軒的圖號每兩頁重新編號，錨點要帶頁碼才不會重複（[backlog](../docs/backlog.md) 的轉錄稿圖號項目）；照現有工具做得到的寫法，並在結果寫下用了什麼寫法。抽查 3 頁對照原頁。
2. **接提示**：系統提示照 R3 的順序，最後接上預設：`格式.md`、`../短規則.md`、`判斷邊界.md`、`五步.md`、`docs/card-rules/elementary-social.md`。任務資料：
   - 學生：國小五年級（小五上）
   - 科目：社會
   - 單元：2-1 地形如何影響我們的生活
   - 學習目的：準備段考
   - 允許 AI 補充：是
   - 學生已有的學習目標：無
   - 家長調整：無
   - 教材：課本轉錄稿（教師用書，含給老師的註記）與習作轉錄稿
3. **生成**：GPT-6.1 Sol high，方案額度接法（和第二輪的 `sol-plan` 相同）；交回全貌、架構、卡組三段；跑 2 次。第二輪的程式綁定自然的實驗（R0～R3 同一路線的檢查、考題凍結），用最小的改動讓它能跑這一組，例如另一份設定檔加一個不需要考題凍結的選項。送出前先 `--dry-run` 估 token。
4. **機械檢查**：每份卡組跑 `check-syntax.mjs --transcript <轉錄稿> --unit 2-1`。已知兩個誤報（課本用字「晒」被當成簡體字、R3 格式沒有類型卻算理解型比例），照實列出，不用修。
5. **交回**：轉錄稿、兩份輸出（全貌、架構、卡組）與機械檢查，放在教材資料夾的 `Sol對照/`（repo 外）。

## 限制

- 教材、轉錄稿、卡組不進 repo（AGENTS.md 底線）。repo 只改程式、設定與這份說明的狀態行和〈結果〉。
- 不改 R3 的提示、預設與第二輪的既有輸出；看到預設的問題記在〈結果〉，不改。
- Sol 的共享額度超過時整筆計價（[ai-models.md](../docs/ai-models.md)）；估出來會超過，先停下來問使用者。
- 程式改動照 `code-quality` 的實作做法；commit 時 pre-commit 會跑檢查，沒通過就修到通過。

## 完成條件

- `Sol對照/` 裡有轉錄稿、2 份三段輸出與各自的機械檢查。
- 程式改動有自測，`node arch.mjs selftest` 通過，已 commit 並 push。
- 這份說明的狀態行改成「已完成」，〈結果〉寫：程式改了什麼（commit）、轉錄稿的圖號寫法、兩次的 token 用量、目標數與題數、機械檢查的錯誤數，以及跑的過程中看到的預設問題。

## 結果

（完成後填）
