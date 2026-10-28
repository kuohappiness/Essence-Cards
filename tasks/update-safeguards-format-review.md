# 更新防線開工前的格式查核（給 Codex）

狀態：已完成（Codex 回報在討論稿〈Codex 格式查核（2026-10-29）〉，Claude 的處理在〈Claude 回應 Codex 格式查核〉）

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**。請**新開一個 session**，不要用查過更新與相容討論稿的那一個。

依 [D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 4 點與 [quality.md〈開工前的格式查核〉](../docs/agents/quality.md#開工前的格式查核)：[更新防線](update-safeguards.md)會加四種寫進使用者檔案、或之後要讀回來的格式。Claude 已照任務說明 §0-1 寫進 `docs/syntax.md`，第一部分的程式等這次查核一致才開工。**只回報，不修改**任何檔案；要改的由 Claude 改。這次也是討論稿 C4 修正（還原檔的檔名）的確認。

## 基準

- 這份請求所在的 commit（`git log -1 --format=%h -- tasks/update-safeguards-format-review.md`），在 `main`。syntax.md 的改動和這份請求在同一個 commit：`git show <那個 commit> -- docs/syntax.md docs/architecture.md`。
- 程式以同一個 commit 的 `main` 為準。正式使用的 vault 裝的是比 `main` 舊的建置；`src/core/study/` 的讀法如果在某個舊 commit 不同、而且會讓結論改變，請列出來。

## 讀什麼

| 讀什麼 | 為什麼 |
|---|---|
| `docs/syntax.md` 的 §0-1、§2-1 表格下面兩點、§5（開頭、例子、表格的 `set` 與 `need`、表格下面的「檔名」與「變更」兩點）、§5-1～5-3、§6 最後一點、§8 | 這次要查的格式 |
| [任務說明](update-safeguards.md) §0-1、§1-1、§1-2、§2-1、§2-2 | 格式要支撐的工具與外掛行為 |
| [D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝)、[D-150](../docs/decisions.md#d-150-備份與還原)、[D-035](../docs/decisions.md#d-035-複習紀錄格式)、[D-105](../docs/decisions.md#d-105-回測要用的紀錄先收好)、[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)、[D-115](../docs/decisions.md#d-115-回頭查要用的證據先收好) | 要對照的決定 |
| [討論稿](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md>)〈Codex 確認〉C1、C2、C4、C5，〈Claude 回應 Codex 確認〉 | 上一輪的反例與 Claude 的修正 |
| `src/core/study/entries.ts`、`history.ts`、`log.ts`、`types.ts`；`src/core/deck/parse.ts` 的 `readProperties`；`src/state/index.ts` 的 `own` 與 watch（約 95～180 行）；`src/state/device.ts` | 現在的讀法 |

其他文件不用讀。

## 要查的事

1. **和既有的決定、syntax.md 有沒有矛盾**：特別是 §0「只新增欄位、忽略不認得的」與 §0-1 的例外；D-035 的單一寫入者與 §5-3；D-105「兩台都發現同一個變更時回測用最早的那一筆」與 §5-1 的例外；D-134 的已用 ID 與 §5-2、§5-3。
2. **已發布的版本讀到這些新東西會不會讀錯**
   - `set: app` 的行：`parseLine`、`mergeHistory`、`appendLine`、`planToday` 與 `state` 有沒有任何地方會因為它改變排程、出題或已用 ID。
   - 還原檔：`isLogPath` 讀得到、`own` 不把它當自己的檔；§5-3「合併結果和那些行還在來源檔時相同」在現在的 `mergeHistory` 成不成立（見第 3 點）。
   - `need`、`需要版本`：舊版會忽略，所以靠兩段發布，現在沒有寫入端。這個前提有沒有漏洞（例如任何現有程式會把這兩個名稱寫進檔案）。
3. **還原檔名的排序論證**（§5-3 最後一點）：照完整路徑、UTF-16 字元碼比較時，還原檔是否一定緊貼在來源檔前面，別台裝置的檔不會插進中間；包括 iCloud 衝突副本、同一個來源的多個還原檔（含 `-2`）、衝突副本本身當來源、還原檔本身不見了改算回原來源、不同月份。Codex C4 的兩個反例在這個檔名下的結果。Claude 已用記憶體探針跑過：反例一兩個原檔都在與用新檔名補回，到期都是 10 月 28 日 10:01（+08:00），舊提案的檔名是 10 月 29 日 04:00；反例二救回 1 筆、`seen` 有 `abc123`、`old123`。請獨立驗證，不要只看這段。
4. **邊界有沒有寫清楚、能不能寫成測試**：每一條規則能不能直接寫成測試的輸入與預期；說法有兩種讀法的列出來。
5. **Claude 在任務說明之外補的細節**（逐項說同不同意，不同意附反例或理由）：
   1. §0-1：不帶前導零（`01.2.0` 讀不懂）；YAML 與 JSON 裡都要是字串（`需要版本: 1.0` 被 YAML 讀成數字，算讀不懂）。
   2. §2-1：屬性區讀不出來（YAML 寫壞、沒有結束）時，有一行以 `需要版本` 加冒號開頭就算讀不懂；沒有就照舊用預設值。
   3. §5：`need` 寫在 `t` 後面。
   4. §5-2：`undo` 指的作答找不到時全部停；「給之後的寫入端」：影響不只頂層 `lt` 的新寫法不寫頂層 `lt`，讓舊版全部停。
   5. §5-1：一次啟動最多寫一行；同一個來源、同一個時間卻有不同值時標成不確定。
   6. §5-3：撞名時日期後面加 `-2`、`-3`…；過渡的還原工具讀不到 Obsidian 存的裝置碼，用同一種寫法的平台名稱加隨機 4 碼；還原檔本身不見了時算回原來的來源檔、不疊加「還原」；空行不算缺。
   7. §8：清單的欄位名稱（任務說明說查核時一起定）：`format`、`version`、`vault`、`build`、`tool`、`by`、`started`、`finished`、`scope`、`files`、`absent`、`excluded`、`notes`；`build` 是 vault 裡裝的外掛版本、`tool` 是做備份的程式的版本；暫存名 `<正式檔名>.tmp`；列出備份時只看 `.zip`；讀的一方的三條檢查（格式版本、zip 與清單一一對應、路徑範圍）。
6. 其他你認為第一部分開工前就該改的格式問題。

## 回報

照任務說明 §0-2，寫在[討論稿](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md>)最後，標題「Codex 格式查核（日期）」，只追加、不改前文；commit 只含這個檔案（訊息 `docs: Codex's format check for update safeguards`）：

- 逐項列出「通過」或「有問題」。有問題的附檔案、行號、原因與建議的寫法，標 P1～P3，並分成「開工前要改」和「實作時再定」。
- 你跑過的探針或測試（只用自編資料，不碰任何真的 vault），以及沒有查的項目與原因。
