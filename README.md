# Essence Cards

知識萃取、閃卡複習與記憶鞏固工具，目前處於需求探索與設計階段。

本專案源於既有的 Obsidian 間隔重複閃卡外掛。新軟體的目標是在有限時間內，更有效率、更深入地學習知識，並對考試表現有所幫助。實際成效仍需驗證。

## 專案狀態

- 正式英文名稱：**Essence Cards**。
- 中文名稱：暫緩，之後再決定。
- 已確認的設計方向：知識萃取、利用閃卡複習、加強記憶。
- 目前階段：需求探索與設計；軟體平台、技術選型與第一版範圍尚未確定。

## 文件

- [最新專案共識](docs/consensus.md)：目前有效的結論，以及清楚標示的待決事項。
- [目前任務](docs/tasks.md)：任務狀態、下一步及暫緩事項。
- [點子收集箱](docs/ideas.md)：先記下原意，再逐項釐清；收錄不等於採用。
- [參考軟體](docs/references/software.md)：類似產品的來源、功能研究與待查核事項。
- [討論紀錄](docs/discussions/README.md)：按日期與主題保存想法、取捨及決策的演變。
- [協作規則](AGENTS.md)：後續協作者維護共識與文件的方式。

本 repo 是專案文件與程式碼的共同維護位置。重要討論留下摘要；有實質結論或任務變動時，更新共識與任務並提交版本。新增文件使用相對連結加入索引。

## 設計討論平台

`index.html` 是我們共同討論「如何做出 Essence Cards」的規劃平台。它收集點子、研究參考軟體並整理任務與共識；學習工具本身的功能、架構與操作介面另行討論。畫板上的卡片表示討論事項，不是學習用的閃卡。

[下載／開啟 index.html](index.html)，即可在瀏覽器使用單檔看板，不需要安裝套件。提供看板、可拖曳縮放的自由畫板、文字綱要及參考軟體四種檢視。點選卡片可閱讀完整原意與下一步。

看板顯示**待釐清點子、目前任務及最新已確認共識**，分區區別狀態。參考軟體專區是討論平台中的設計研究資料。討論紀錄、歷史提案、已排除項目與完成任務另存文件，不嵌入 HTML。

### 更新方式

內容的唯一來源是 Markdown；不用分別修改 HTML 與綱要：

1. 更新 `docs/ideas.md`、`docs/tasks.md`、`docs/consensus.md` 或 `docs/references/software.md`。
2. 執行 `python3 scripts/build_board.py` 產生 `index.html`。
3. 執行 `python3 -m unittest discover -s tests -v` 與 `python3 scripts/build_board.py --check`。
4. 將文件與生成的 HTML 一起提交。

有 Chrome／Chromium 的環境可另執行 `python3 tests/browser_smoke.py`，檢查桌面與手機尺寸的卡片、綱要、來源連結與縮放互動；GitHub 工作流程也會執行此檢查。

直接在 GitHub 修改來源時，[同步工作流程](.github/workflows/board.yml)會生成 HTML；若 HTML 改變，會用一般提交更新 `main`。遇到分支保護或併發推送衝突時會停止，保留其他人的修改。看板本身不提供內容編輯；可在對話中提出點子，或編輯來源文件。

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
