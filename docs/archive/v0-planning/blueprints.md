> **⚠️ 已取代，僅供追溯。** 本文件屬於 2026-10-10 重整前的 v0 規劃，不再是有效依據；目前內容見 `README.md` 與 `docs/` 下的 product、architecture、decisions、roadmap、backlog。重整前的原貌（文件內連結可正常運作）：<https://github.com/kuohappiness/Essence-Cards/tree/0df2ba4>

# Essence Cards｜畫板藍圖索引

更新日期：2026-10-07（Asia/Taipei）。只保存目前有效的藍圖與狀態；歷史討論另存。四張圖直接顯示於看板與自由畫板，點圖可查看完整設計；手機閱讀版直接呈現大圖。

## B-001 知識學習架構藍圖｜方向已確認，細節待討論

摘要：完整保留輸入、整理、學習、回饋；輸入註記 Essence Capture 後續另 repo，Cards 聚焦輸出、檢核與選用 AI。

圖檔：docs/diagrams/essence-cards-architecture.svg

概念筆記作為共用知識基礎；材料與學習紀錄保留關聯。功能環節可分支與返回，不要求每次走完固定步驟。欄位、算法及第一版範圍仍待討論。手機疑問可交電腦核對、補強與結案，詳見 B-004 的 F-019。

- [完整學習藍圖](learning-blueprint.md)
- [圖檔說明](diagrams/README.md)

## B-002 技術架構與 Git 設計｜平台已選，技術細節待驗證

摘要：兩個獨立 Obsidian 外掛以可讀筆記交接；Cards 的 AI 學習輔助可選，一般筆記無 YAML 也能使用，模型／資料／Git 細節待驗證。

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

## B-003 兩階段開發路線圖｜先後已確認，細部待議

摘要：本 repo P0–P4 驗資料、交付基礎輸出／檢核，再補強 AI 並試用；後續 P5 在另 repo 開發 Essence Capture。

圖檔：docs/diagrams/essence-cards-development-roadmap.svg

依 C-018，可丟棄 UI／讀寫原型已通過使用者的 Windows／iPhone 最小實機驗收；正式學習事件、附件完整性、併發寫入及個別回復仍待完整 P0 驗證，再展開完整功能開發。兩階段先後已依 C-022 確認，P0–P5 的細部範圍與驗收尺度仍待確認，沒有工期承諾；Git 設計列入驗證；第一階段即以手動文件樣本驗交接接收端，第二階段再驗真實來源成果。

其他雲端同步、NAS、獨立學習 App／網頁與複雜互動教材保留為後續候選，不列為第一版交付承諾。

- [各階段產出、門檻及轉向條件](technical-roadmap.md)
- [目前任務](tasks.md)

## B-004 功能與兩階段交付｜拆分與順序已確認，細節待議

摘要：以功能目錄 v0.5 的 19 個 F-ID 對照兩個獨立外掛；Cards 本 repo 輸出／檢核／選用 AI，Capture 後續另 repo 來源轉筆記。

圖檔：docs/diagrams/essence-cards-functions.svg

C-022／C-023 確認 repo 分工、非 AI 基礎與選用 AI；Capture repo 尚未建立；功能分工、交接格式與第一階段精確範圍仍待議。Essence Cards 從既有筆記／手動卡片開始，不依賴來源工具；第二階段整理成果依文件／來源／附件／版本約定接入。跨工具修訂交接建議，由接收端核對採用；基礎不是第四大模組，基本複習不依賴完整檢核。尚未實作正式模組，YouTube 方法仍未選定。

- [三模組與兩階段交付](module-architecture.md)
- [文件交接與整合約定](integration-contract.md)
- [Mermaid 圖與 19 項功能對照](diagrams/functions.md)
- [功能討論目錄](function-discussions.md)
- [圖表維護與同步規則](diagrams/README.md#圖表維護與同步)

來源或產物變更會由檢查要求核對；不以雜湊通過宣稱設計已定案。圖表統一使用 B-ID、功能使用 F-ID，方便互相參照。
