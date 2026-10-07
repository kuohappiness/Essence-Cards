# Essence Cards

知識萃取、閃卡複習與記憶鞏固工具，目前處於需求探索與設計階段。

本專案源於既有的 Obsidian 間隔重複閃卡外掛。新軟體的目標是在有限時間內，更有效率、更深入地學習知識，並對考試表現有所幫助。實際成效仍需驗證。

## 專案狀態

- 正式英文名稱：**Essence Cards**。
- 中文名稱：暫緩，之後再決定。
- 主要模組：**輸入、輸出、檢核**；輸入可只轉筆記，輸出可只複習閃卡，共用小核心並逐步整合（C-020）。
- 已確認的設計方向：知識萃取、利用閃卡複習、加強記憶。
- 已確認的產品形式：以概念筆記為核心的學習工作區，依閱讀、整理理解、記憶練習及回顧情境提供不同 UI，共用知識來源，確認的修訂可回寫筆記（C-011）。
- 資料保存與同步候選：主要考慮雲端服務與各裝置本機；NAS 保留為選配自架方式，具體機制與第一版支援範圍待定（C-012）。
- 討論架構：以「輸入 → 整理 → 學習 → 回饋」的整體學習循環規劃，串接來源、概念筆記、教材、練習與回饋；具體功能仍待釐清。
- 第一版平台：Obsidian 外掛；電腦整理管理、iPhone 複習，沿用既有 iCloud 為同步驗證基線（C-014）。
- 目前階段：可丟棄原型已依使用者回報通過 Windows／iPhone 最小實機驗證，恢復逐項功能討論；Git 備份、併發、AI 轉接、資料細節與完整功能範圍仍待驗證／確認。

## 文件

- [三模組架構與逐步交付](docs/module-architecture.md)：輸入／輸出獨立使用、候選功能邊界與可選交接；先釐清可用的最小閃卡。

- [最小 UI 與跨裝置驗證](docs/obsidian-ui-probe.md)：可丟棄原型與證據狀態；[安裝及驗收](experiments/obsidian-ui-probe/README.md)。
- [最新專案共識](docs/consensus.md)：目前有效的結論，以及清楚標示的待決事項。
- [學習循環與功能藍圖](docs/learning-blueprint.md)：已確認的討論架構、功能草案、整合設計、困難與分階段候選範圍。
- [功能討論目錄](docs/function-discussions.md)：v0.3 對照三模組、藍圖與研究，逐項釐清功能、關聯、人工流程及驗收；目前從[來源資料匯入與管理](docs/functions/source-input.md)開始，新增[學習疑問與待處理佇列](docs/functions/issue-queue.md)。
- [架構圖總入口](docs/diagrams/README.md)：學習、技術、開發路線圖與[功能 Mermaid 總覽](docs/diagrams/functions.md)，透過 B-ID／F-ID 互相參照。
- [技術架構與開發路線圖](docs/technical-roadmap.md)：裝置、資料、AI、同步、Git 備份／回復設計與分階段驗證門檻。
- [畫板藍圖索引](docs/blueprints.md)：四張當前藍圖的說明與狀態，生成至桌面畫板與手機閱讀版。
- [目前任務](docs/tasks.md)：任務狀態、下一步及暫緩事項。
- [點子收集箱](docs/ideas.md)：先記下原意，再逐項釐清；收錄不等於採用。
- [參考軟體](docs/references/software.md)：類似產品的來源、功能研究與待查核事項。
- [參考研究的設計優化提案](docs/references/design-opportunities.md)：統整架構細化、特色功能及第一版候選；部分討論方向依 C-017 採用，其餘提案與第一版細節待確認。
- [討論紀錄](docs/discussions/README.md)：按日期與主題保存想法、取捨及決策的演變。
- [協作規則](AGENTS.md)：模型與任務分工，以及後續協作者維護共識與文件的方式。

本 repo 是專案文件與程式碼的共同維護位置。重要討論留下摘要；有實質結論或任務變動時，更新共識與任務並提交版本。新增文件使用相對連結加入索引。

## 設計討論平台

`index.html` 是我們共同討論「如何做出 Essence Cards」的規劃平台。它收集點子、研究參考軟體並整理任務與共識；學習工具本身的功能、架構與操作介面另行討論。畫板上的卡片表示討論事項，不是學習用的閃卡。

[下載／開啟 index.html](index.html)，即可在支援 JavaScript 的瀏覽器使用互動討論平台。文件也直接包含點子、任務、共識與參考軟體的完整內容及版本日期，不需要安裝套件。

看板與自由畫板直接呈現 diagrams 的四張目前藍圖，點圖可查看大圖與設計重點。

提供看板、可拖曳縮放的自由畫板、文字綱要、參考軟體及架構藍圖五種互動檢視。完整互動以 Safari 等瀏覽器開啟已發布的網站為準。GitHub Pages 的首次設定見下方「公開網址」。

[手機閱讀版 mobile.html](mobile.html) 使用相同 Markdown 來源生成，完全不含腳本、隱藏區塊與互動控制。先呈現四張架構藍圖，再呈現目前任務、共識、點子及參考軟體，並提供文字連結跳到各區。使用者回報 index.html 在 ChatGPT 手機預覽仍只見外框，因此提供新的檔名以協助排查附件版本與預覽相容性；實機結果由 T-007 追蹤。

看板顯示**待釐清點子、目前任務及最新已確認共識**，分區區別狀態。參考軟體專區是討論平台中的設計研究資料。討論紀錄、歷史提案、已排除項目與完成任務另存文件，不嵌入 HTML。

### 更新方式

文字內容來源是 Markdown；功能圖從目錄產生 Mermaid，再渲染為內嵌字型 SVG；既有圖保留 Python 繪圖來源。所有圖都登錄來源及核對快照，詳見[圖表維護與同步](docs/diagrams/README.md#圖表維護與同步)。不用分別修改 HTML 與綱要：

1. 更新 `docs/ideas.md`、`docs/tasks.md`、`docs/consensus.md` 、`docs/references/software.md` 或技術文件；核對所有受影響藍圖，更新圖表來源並重新產生。
2. 執行 `python3 scripts/build_function_diagram.py --check` 及 `python3 scripts/check_diagrams.py --check`；來源變動先依維護規則核對，通過後執行 `python3 scripts/build_board.py` 同時產生 `index.html` 與 `mobile.html`。
3. 執行 `python3 -m unittest discover -s tests -v` 與 `python3 scripts/build_board.py --check`。
4. 將文件與生成的 HTML 一起提交。

有 Chrome／Chromium 的環境可另執行 `python3 tests/browser_smoke.py`，檢查桌面與手機尺寸的卡片、綱要、來源連結與縮放互動；GitHub 工作流程也會執行此檢查。

圖表來源變動而未核對快照時，工作流程會停止並指出受影響圖，避免直接發布舊圖。直接在 GitHub 修改其他文字來源時，[同步工作流程](.github/workflows/board.yml)會生成兩份 HTML；若 HTML 改變，會用一般提交更新 `main`。遇到分支保護或併發推送衝突時會停止，保留其他人的修改。看板本身不提供內容編輯；可在對話中提出點子，或編輯來源文件。

產生程式使用 Python 3 標準函式庫；樣式與互動放在 [HTML 範本](web/board-template.html)。新增卡片使用 `## I-002 標題｜待釐清` 等同樣格式，ID 不重用。只有未結案點子與已確認共識會進入看板。

### 公開網址

GitHub Pages 工作流程已備妥，首次啟用與線上發布仍待確認。設定方式：

1. 到 [Settings → Pages](https://github.com/kuohappiness/Essence-Cards/settings/pages)，在 Build and deployment 的 Source 選擇 **GitHub Actions**。
2. 到 [Sync and publish board](https://github.com/kuohappiness/Essence-Cards/actions/workflows/board.yml) 選 **Run workflow**。
3. 以成功部署所回傳的網址為準，再確認可公開讀取；尚未部署前不把預期網址當成已上線。

後續變更會自動生成並發布。若 Pages 尚未設定，工作流程仍會產生看板產物，並在執行摘要中說明未發布的原因。

## 後續目錄

- `docs/`：共識、需求、研究、決策與設計文件。
- `src/`：後續軟體程式碼，依技術選型建立。
- `scripts/`：畫板產生程式。
- `web/`：HTML 畫板範本。
- `tests/`：內容篩選與安全嵌入等驗證。

## 授權

程式碼與文件授權尚未選定。
