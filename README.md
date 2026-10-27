# Essence Cards

> **最高目的（北極星）**：透過程式讓知識從「獲取」到「深化」形成完美閉環，提高知識增長的效率，並幫助學生在學業表現上進步。
>
> 所有功能與設計決策都以此檢驗：無法說明如何縮短學生的複習時間、加深記憶或提升學業表現的提案，不進入目前範圍。

Essence Cards 是一個 Obsidian 外掛：把筆記變成閃卡，讓學生用間隔重複，在手機上隨時、低摩擦地快速複習。AI 是選用的加速器，沒有 AI 也能完整使用。

**目前階段**：看[開發現況與路線圖](docs/roadmap.md)的「現在在哪裡」（進度只寫在那裡）。

## 文件

| 想知道 | 看這裡 |
|---|---|
| 為什麼做、為誰做、做到哪裡 | [產品定義](docs/product.md) |
| 技術上怎麼組成 | [架構](docs/architecture.md) |
| 卡片、轉錄稿、錯題本怎麼寫 | [出題語法與資料格式](docs/syntax.md) |
| 已經決定了什麼、為什麼 | [決策紀錄](docs/decisions.md) |
| 現在進行到哪裡、下一步 | [開發現況與路線圖](docs/roadmap.md) |
| v1 要做什麼、第二階段想做什麼 | [統一任務與候選清單](docs/backlog.md) |
| 某個功能的細項規畫、未來文件放哪裡 | [主題計畫與存放規則](docs/plans/README.md) |
| AI 怎麼製卡、怎麼試用 | [製卡規則](docs/card-rules/README.md) |
| 現在推薦用哪個 AI 服務 | [AI 模型推薦](docs/ai-models.md) |
| 參考過哪些軟體 | [參考軟體研究](docs/research/software.md)、[舊外掛分析](docs/research/old-flashcard-plugin.md) |
| 過去的討論與舊規劃 | [封存區](docs/archive/README.md) |
| AI 協作者的工作規則 | [AGENTS.md](AGENTS.md) |

正式外掛的程式放在 repo 最上層的 `src/`、`tests/`、`tools/`（[D-110](docs/decisions.md#d-110-v1-外掛的程式結構)）。

## 相關專案

**[Essence Capture](https://github.com/kuohappiness/Essence-Capture)**：可靠的知識入口：想保存任何資料進知識庫就用它，也能獨立產出閱讀筆記。v1 先做 PDF 與圖片的忠實轉錄，成為教材庫；另開 repo（[D-076](docs/decisions.md#d-076-capture-是知識入口教材轉錄成教材庫)）。

**Essence Mindmap**（暫定名，未來，尚未建立）：把知識架構視覺化；Essence Cards 保留和它對接的彈性（[D-056](docs/decisions.md#d-056-保留和心智圖外掛對接的彈性)）。

## 授權

程式碼與文件的授權條款尚未選定。
