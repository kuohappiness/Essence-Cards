# 開發的 token 用量

狀態：持續記錄；每次量完把結論加在〈量測紀錄〉最上面

這份放每次量 Claude 與 Codex 用量的方法、結論與數據。省 token 的做法是 [D-171](../decisions.md#d-171-省-token-靠縮短上下文不靠少審或換模型)，討論經過在[討論稿](<../../Claude Codex Discussion/2026-11-03-token-saving.md>)。

## 怎麼量

- **來源**：使用者電腦上的用量紀錄。Claude 是 `%USERPROFILE%\.claude\projects\**\*.jsonl` 的 `message.usage`（用 `message.id` 去重，含 subagent）；Codex 是 `C:\Users\kuo\.codex\sessions` 與 `archived_sessions` 的 `token_count` 事件（`last_token_usage`），`codex-auto-review` 另計。只讀 token 數、模型、推理等級、時間與工具名稱，不讀對話內容；只有數字的統計結果放 [`token-usage/`](token-usage/)。
- **怎麼跑**：雲端討論串讀不到電腦，要開 Remote Control 由電腦上的 session 統計。統計腳本放在使用者電腦的 `%TEMP%\essence-claude-usage\`，可能被系統清掉。
- **範圍**：整台電腦所有專案的合計（這段時間主要是 Essence）；雲端討論串沒有紀錄。
- **加權成本**：照 Anthropic API 定價折成 Opus 的一般輸入：快取讀 ×0.05、1 小時快取寫 ×2、輸出 ×5；Fable、Sonnet 也照 Opus 算。方案額度怎麼扣沒有公布，所以只是近似，原始 token 一起列。
- **工作量**：Essence Cards `main` 上有改到 `src/` 或 `tests/` 的 commit（不含合併）。
- **品質**：每件 L2 的審查輪數（從審查稿的狀態行與標題數，可能差一輪）；修正型 commit（標題不是 docs 開頭、以 fix 開頭或含 revert）佔非文件 commit 的比例，很粗。
- **不要用週額度比**：Codex 的週額度（`rate_limits.secondary`）10-19～11-09 重置了 8 次，不是連續的曲線。

## 量測紀錄

### 2026-11-09：D-171 前後對照

之前 = 10-27～11-03 的 8 天（開始大量寫程式之後），之後 = 11-04～11-08 的 5 天。圖表：[Essence 的 token 用量](https://claude.ai/artifact/Fyn3g6inHWgJconz6paP8F)（使用者的私人頁面）；數據：[每天](token-usage/2026-11-09-daily.json)、[L2 輪數](token-usage/2026-11-09-l2.json)。

| 指標 | 之前 | 之後 | 變化 |
|---|---:|---:|---:|
| Claude：上下文 40 萬以上的呼叫 | 30.4% | 6.2% | −24.2 點 |
| Claude：每次呼叫平均的上下文 | 33.4 萬 | 25.6 萬 | −23% |
| Claude：每天自動壓縮 | 2.6 次 | 8.6 次 | +228% |
| Claude：每個程式 commit 的原始 token | 1,033 萬 | 825 萬 | −20% |
| Claude：每個程式 commit 的加權成本 | 102 萬 | 103 萬 | +1% |
| Codex：用 xhigh 的呼叫 | 75.7% | 1.2% | −74.6 點 |
| Codex：每天的推理 token | 8.7 萬 | 3.8 萬 | −56% |
| Codex：每次呼叫平均的上下文 | 18.2 萬 | 17.8 萬 | −2% |
| Codex：每個程式 commit 的輸入 token | 136 萬 | 133 萬 | −2% |
| Codex：每天的自動審核 | 61 次 | 24 次 | −61% |
| 每天的程式 commit | 33.9 | 30.4 | −10% |
| 每件 L2 的審查輪數 | 3.5（16 件） | 3.4（7 件） | −2% |
| 修正型 commit 的比例 | 53.6% | 50.0% | −3.6 點 |

- **有效**：Claude 的長上下文呼叫壓下來了（D-171 第 4 點）；Codex 的推理等級照請求寫，幾乎不再用 xhigh（第 1 點）。
- **還沒看到**：每個程式 commit 的 Claude 加權成本持平，重讀省下的被變多的快取寫入與輸出抵掉；Codex 每次呼叫的上下文沒變短，11-04 那件 L2 四輪其實都在同一個對話，每輪新開還沒做到。
- **品質**：L2 輪數與修正型 commit 的比例都沒變差；只有 5 天，證明不了沒影響。
- **自動審核變少**：原因還沒查（D-171 第 5 點沒有改審核設定）。
- **限制**：之後只有 5 天，工作也從開發新功能轉向收尾；合併後才發現的 bug、實機測試失敗數還沒整理。

### 2026-11-04：iPhone 測試後修改的 L2

結果記在 D-171 第 6 點：Codex 四輪都在同一個對話，等 `npm run check` 的輪詢約佔輸入 43%；Claude 壓縮 1 次，沒有因摘要漏接而重做；縮減工具輸出估計最多省 0.5%。完整數字沒有保存。

### 2026-11-03：第一次盤點

見[討論稿](<../../Claude Codex Discussion/2026-11-03-token-saving.md>) §1：Codex 週額度五天用完；一件高風險任務同一個 Codex 對話沿用 20 小時、上下文到 41 萬；電腦上的 Claude 98% 是快取讀，前 10 個長 session 佔 46%。
