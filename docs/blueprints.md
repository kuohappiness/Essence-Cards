# Essence Cards｜畫板藍圖索引

更新日期：2026-10-07（Asia/Taipei）。只保存目前有效的藍圖與狀態；歷史討論另存。四張圖直接顯示於看板與自由畫板，點圖可查看完整設計；手機閱讀版直接呈現大圖。

## B-001 知識學習架構藍圖｜方向已確認，細節待討論

摘要：以輸入、整理、學習、回饋串接概念筆記、學習材料、作答紀錄與回饋修訂。

圖檔：docs/diagrams/essence-cards-architecture.svg

概念筆記作為共用知識基礎；材料與學習紀錄保留關聯。功能環節可分支與返回，不要求每次走完固定步驟。欄位、算法及第一版範圍仍待討論。手機疑問可交電腦核對、補強與結案，詳見 B-004 的 F-019。

- [完整學習藍圖](learning-blueprint.md)
- [圖檔說明](diagrams/README.md)

## B-002 技術架構與 Git 設計｜平台已選，技術細節待驗證

摘要：Obsidian 外掛與既有 iCloud 為第一版基線；電腦整理、手機複習，AI 轉接與 Git 備份保留設計提案狀態。

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

摘要：P0 真實裝置驗證 → P1 資料骨架 → P2 最小學習循環 → P3 AI 可替換設計 → P4 真實教材試用。

圖檔：docs/diagrams/essence-cards-development-roadmap.svg

依 C-018，可丟棄 UI／讀寫原型已通過使用者的 Windows／iPhone 最小實機驗收；正式學習事件、附件完整性、併發寫入及個別回復仍待完整 P0 驗證，再展開完整功能開發。開發階段與驗收尺度仍待確認，沒有工期承諾；Git 設計列入驗證，不只保存圖上的名稱。

其他雲端同步、NAS、獨立 App／網頁與複雜互動教材保留為後續候選，不列為第一版交付承諾。

- [各階段產出、門檻及轉向條件](technical-roadmap.md)
- [目前任務](tasks.md)

## B-004 功能架構總覽｜規劃草案，細節與第一版範圍待確認

摘要：以功能目錄 v0.2 的 19 個 F-ID 呈現輸入、概念、材料、作答、疑問／修訂與安排；跨功能共用能力另列，對照 B-001 至 B-003。

圖檔：docs/diagrams/essence-cards-functions.svg

功能名稱從目錄產生；分區及箭頭表示目前設計草案，不表示所有功能已採用或實作。既有真題／卡片可直接核對採用，回饋經核對後修訂；一般忘記可只安排複習。共用情境、關聯／版本、資料保護與可選 AI 支援整個循環。

- [Mermaid 圖與 19 項功能對照](diagrams/functions.md)
- [功能討論目錄](function-discussions.md)
- [圖表維護與同步規則](diagrams/README.md#圖表維護與同步)

來源或產物變更會由檢查要求核對；不以雜湊通過宣稱設計已定案。圖表統一使用 B-ID、功能使用 F-ID，方便互相參照。
