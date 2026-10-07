# Essence Cards｜畫板藍圖索引

更新日期：2026-10-07（Asia/Taipei）。只保存目前有效的藍圖與狀態；歷史討論另存。四張圖直接顯示於看板與自由畫板，點圖可查看完整設計；手機閱讀版直接呈現大圖。

## B-001 知識學習架構藍圖｜方向已確認，細節待討論

摘要：以輸入、整理、學習、回饋呈現學習循環，與 B-004 的三模組產品／工程視角互相參照。

圖檔：docs/diagrams/essence-cards-architecture.svg

概念筆記作為共用知識基礎；材料與學習紀錄保留關聯。功能環節可分支與返回，不要求每次走完固定步驟。欄位、算法及第一版範圍仍待討論。手機疑問可交電腦核對、補強與結案，詳見 B-004 的 F-019。

- [完整學習藍圖](learning-blueprint.md)
- [圖檔說明](diagrams/README.md)

## B-002 技術架構與 Git 設計｜平台已選，技術細節待驗證

摘要：同一 Obsidian 外掛內分輸入、輸出、檢核，共用必要資料基礎；沿用既有 iCloud，AI／Git 細節仍待驗證。

圖檔：docs/diagrams/essence-cards-technical-architecture.svg

Git 設計必須保留：

- iCloud 負責日常裝置同步；Git 保存歷史；獨立 GitHub 私人儲存庫保存已推送版本。
- 只在電腦執行 Git，手機停用；實際 .git 歷史放在 iCloud vault 之外。
- commit-and-sync 預設含 pull，備份需明確設定不覆寫工作檔的策略；.gitignore 不能控制 iCloud。
- AI 批次修改前後保存檢查點；救回時先比對個別檔案，保留較新的學習事件。
- 未到電腦、未 commit、未 push 的資料各有保護邊界；Git 不會改善 iCloud 同步可靠性。
- 附件、金鑰排除、失敗提醒與回復演練都需另行設計及驗證；私人資料不進公開專案 repo。

最小原型的雙端 UI、讀寫與基本同步已依使用者回報通過；正式離線學習事件、穩定 ID／版本、可重建索引與 AI 任務交接仍待驗證。

- [完整技術文件、Git 重點與官方來源](technical-roadmap.md)

## B-003 開發路線圖｜建議順序，各階段待執行

摘要：P0 真實裝置驗證 → P1 最小資料骨架 → P2 先交付獨立閃卡、再增量接模組 → P3 AI 可替換設計 → P4 教材試用。

圖檔：docs/diagrams/essence-cards-development-roadmap.svg

依 C-018，可丟棄 UI／讀寫原型已通過使用者的 Windows／iPhone 最小實機驗收；正式學習事件、附件完整性、併發寫入及個別回復仍待完整 P0 驗證，再展開完整功能開發。開發階段與驗收尺度仍待確認，沒有工期承諾；Git 設計列入驗證，不只保存圖上的名稱。

其他雲端同步、NAS、獨立 App／網頁與複雜互動教材保留為後續候選，不列為第一版交付承諾。

- [各階段產出、門檻及轉向條件](technical-roadmap.md)
- [目前任務](tasks.md)

## B-004 三模組功能架構｜模組方向已確認，功能分工與細節待議

摘要：以功能目錄 v0.3 的 19 個 F-ID 對照輸入、輸出、檢核與共用基礎；明示只產生筆記、只用閃卡兩個獨立入口。

圖檔：docs/diagrams/essence-cards-functions.svg

三大模組與輸入／輸出獨立使用依 C-020 已確認；功能分工、介面與第一版範圍仍為提案。輸入可只把 YouTube 整理成筆記，輸出可直接用既有／手動閃卡複習；模組交接可選，加入檢核不影響原有模式。共用核心不是第四大模組，基本複習不依賴完整檢核。方向已確認不表示功能已實作，YouTube 處理方式亦未選定。

- [三模組邊界與逐步交付](module-architecture.md)
- [Mermaid 圖與 19 項功能對照](diagrams/functions.md)
- [功能討論目錄](function-discussions.md)
- [圖表維護與同步規則](diagrams/README.md#圖表維護與同步)

來源或產物變更會由檢查要求核對；不以雜湊通過宣稱設計已定案。圖表統一使用 B-ID、功能使用 F-ID，方便互相參照。
