# Essence Cards

> **最高目的（北極星）**：透過程式讓知識從「獲取」到「深化」形成完美閉環，提高知識增長的效率，並幫助學生在學業表現上進步。
>
> 所有功能與設計決策都以此檢驗：無法說明如何縮短學生的複習時間、加深記憶或提升學業表現的提案，不進入目前範圍。

Essence Cards 是一個 Obsidian 外掛：把筆記變成閃卡，讓學生用間隔重複，在手機上隨時、低摩擦地快速複習。AI 是選用的加速器，沒有 AI 也能完整使用。

**目前階段：規劃中。架構釐清七步已完成，接著做 v1 開發前的準備；產品程式碼尚未開始。** → [開發現況與路線圖](docs/roadmap.md)

## 文件

| 想知道 | 看這裡 |
|---|---|
| 為什麼做、為誰做、做到哪裡 | [產品定義](docs/product.md) |
| 技術上怎麼組成 | [架構](docs/architecture.md) |
| 已經決定了什麼、為什麼 | [決策紀錄](docs/decisions.md) |
| 現在進行到哪裡、下一步 | [開發現況與路線圖](docs/roadmap.md) |
| 還沒決定的問題、點子 | [待決問題與點子](docs/backlog.md) |
| AI 怎麼製卡、怎麼試用 | [製卡規則](docs/card-rules/README.md) |
| 參考過哪些軟體 | [參考軟體研究](docs/research/software.md)、[舊外掛分析](docs/research/old-flashcard-plugin.md) |
| 過去的討論與舊規劃 | [封存區](docs/archive/README.md) |
| AI 協作者的工作規則 | [AGENTS.md](AGENTS.md) |

## 目錄

```
README.md        專案入口
AGENTS.md        協作規則（CLAUDE.md 引用它）
docs/
├─ product.md        產品定義
├─ architecture.md   架構
├─ decisions.md      決策紀錄
├─ roadmap.md        開發現況與路線圖
├─ backlog.md        待決問題與點子
├─ card-rules/       交給 AI 的製卡規則
├─ research/         參考軟體研究、舊外掛分析
└─ archive/          歷史討論與 v0 規劃
```

程式碼開始開發後，再依技術選型建立 `src/` 等目錄。

## 相關專案

**Essence Capture**（預計名稱，尚未建立）：把 PDF、影片等來源整理成可讀筆記的獨立 Obsidian 外掛，之後另開 repo。

## 授權

程式碼與文件的授權條款尚未選定。
