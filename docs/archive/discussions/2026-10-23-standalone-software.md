# 脫離 Obsidian 的通用軟體

2026-10-23｜討論摘要，非逐字紀錄。已確認的需求與維運邊界見 [D-128](../../decisions.md#d-128-通用軟體使用者自備同步空間)；平台與接法仍在討論。

## 討論經過

使用者詢問目前以 Obsidian 外掛設計的專案，是否能成為通用可使用的軟體。Codex 對照程式與 D-110：卡組解析、複習紀錄與排程已有不依賴 Obsidian 的核心；獨立版仍需接手編輯、渲染與出處跳轉、資料存取、同步及 AI 修改流程。

最初比較獨立 App、網站／PWA、先讓學生複習端獨立三條路線。使用者選擇前兩種皆可，但要求手機與電腦能同步使用，且能脫離 Obsidian。

Codex 接著比較產品提供雲端同步與使用者自備雲端空間，曾因一般家庭較容易使用而推薦前者。使用者明確表示不想替使用者維護服務或負擔成本，選擇自備空間，形成 D-128。

## Codex 的評估（提案）

依這個維運限制，偏向本機優先的獨立電腦與手機 App，並先驗證一組裝置與一種同步接法。核心以 D-110 為重用起點，資料仍可保留可攜性；把安裝、語法與同步設定的負擔降到可接受，才有助於持續複習。

瀏覽器直接操作使用者資料夾的支援有限，因此純網站若要用個人雲端空間，不能直接套用「選資料夾就自動同步」的假設。iOS 原生 App 有存取使用者選定目錄的機制，但能否穩定離線使用、跨裝置同步，仍取決於供應商與實作。

把儲存交給使用者的雲端，可以移除專案營運同步服務的責任；App 的相容、合併紀錄、衝突提示與復原仍需維護。初期支援太多供應商會擴大維護面，因此建議逐一驗證。這些是 Codex 建議，尚未確認為實作方案。

## 技術參考

- [MDN：showDirectoryPicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)：瀏覽器目錄存取尚非普遍支援的能力。
- [Apple：Providing access to directories](https://developer.apple.com/documentation/uikit/providing-access-to-directories)：文件選擇器可提供使用者選定目錄的存取權限，涵蓋支援 File Provider 的位置；不代表所有供應商的離線與同步行為相同。
- [Obsidian：跨裝置同步](https://obsidian.md/help/sync-notes)：列出各平台支援限制，並指出 Windows 的 iCloud Drive 可能造成檔案重複或損壞。此為現有工具的經驗，不能直接當成 Essence 獨立版已驗證的結果。

後續問題集中在 [backlog](../../backlog.md#脫離-obsidian-的通用軟體2026-10-23-使用者)。
