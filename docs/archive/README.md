# 封存區

這裡的內容**僅供追溯**，不是目前有效的依據。目前內容請看 [README](../../README.md) 與 `docs/` 下的五份核心文件。

## 內容

| 位置 | 內容 |
|---|---|
| [discussions/](discussions/README.md) | 全部歷史討論紀錄，原樣保留；之後的新討論摘要也放在這裡 |
| [v0-planning/](v0-planning/consensus.md) | 2026-10-06～09 的 v0 規劃：共識 C-001～C-023、任務、點子、學習藍圖、功能目錄、模組與整合約定、技術路線圖、藍圖 SVG |
| [v0-planning/board/](v0-planning/board/) | 已退役的討論看板：`index.html`、`mobile.html`、產生器腳本、範本與 GitHub Actions 工作流程 |

## 舊文件到新文件的對照

| 舊文件 | 現在看 |
|---|---|
| consensus.md | [decisions.md](../decisions.md)（仍有效的決定）、[backlog.md](../backlog.md#待重新確認的舊共識)（待重新確認） |
| tasks.md | [roadmap.md](../roadmap.md) |
| ideas.md | [backlog.md](../backlog.md#點子收集箱) |
| learning-blueprint.md、function-discussions.md、functions/ | [product.md](../product.md)、[architecture.md](../architecture.md) |
| module-architecture.md、integration-contract.md | [architecture.md §3](../architecture.md#3-模組邊界-第-5-步) |
| technical-roadmap.md、obsidian-ui-probe.md | [architecture.md §4～5](../architecture.md#4-平台與裝置-)、[roadmap.md](../roadmap.md) |
| development-principles.md | [product.md §4](../product.md#4-產品原則-第-3-步)、[AGENTS.md](../../AGENTS.md) |
| blueprints.md、diagrams/ | architecture.md 與 roadmap.md 中的 Mermaid 圖 |
| references/ | [research/](../research/software.md)（原樣保留） |

## 注意

- 搬移後，封存文件裡的相對連結可能失效。要看連結完整的原貌，請到重整前的版本：<https://github.com/kuohappiness/Essence-Cards/tree/0df2ba4>
- 可丟棄的 UI 原型與舊測試已在 GitHub 上刪除，仍可在刪除前的版本找到：<https://github.com/kuohappiness/Essence-Cards/tree/6cfba2a/experiments/obsidian-ui-probe>
- 要恢復看板，把 `v0-planning/board/` 的檔案搬回原位置（`board.yml` 放回 `.github/workflows/`），並依新文件結構改寫產生器。
