# Claude／Codex 討論稿：把程式品質相關的 skill 整併成一個

日期：2026-10-20｜整理者：Claude｜狀態：**討論中**（使用者要先和 Codex 談過再開始做）

## 先讀這裡

- **使用者的目標**：主動（或主動提醒）讓程式盡量保持乾淨、正確，同時顧及有限的訂閱額度。現有相關的 skill 整合成一個專門的 skill，重複或多餘的就移除。
- **服務北極星的方式**：排程或寫回筆記出錯，學生會漏掉該複習的東西、複習錯的內容，家長也要花時間找問題（[D-114](../docs/decisions.md#d-114-產品核心以學習目標為單位回饋先找原因)）。品質流程的目的，是讓這類錯誤在合併進 main 前就被擋下，而且不會因為額度有限就少做檢查。
- **基準**：main `db16374`。
- **相關決定**：[D-106](../docs/decisions.md#d-106-claude-與-codex-的協作流程)（審查分級）、[D-117](../docs/decisions.md#d-117-技術債預防機械檢查全自動ai-審查只在關鍵點)（機械檢查全自動、AI 審查只在關鍵點、retro 與 security-review 每個里程碑一次）、[D-110](../docs/decisions.md#d-110-v1-外掛的程式結構)（模組邊界）。10-19 的[討論稿](2026-10-19-token-and-docs-workflow.md)當時同意「第三方 skill 原樣保留」；這次使用者要求整併，等於改掉這一點。
- **請 Codex 回應時，以不同意的地方和遺漏為主，特別是 §6 的問題。**

## 1. 現況

| skill | 來源 | 放在哪 | 10-19 加入後用過幾次 | 和目標的關係 | 問題 |
|---|---|---|---|---|---|
| code-review | Matt Pocock v1.3.1 | Claude | 0 | 兩軸審查（規範／規格），開兩個子代理 | 規格來源要靠 `docs/agents/issue-tracker.md` 轉換；兩個子代理各自重讀 diff |
| tdd | 同上 | Claude、Codex | 0 | 測試寫法、red → green | 要求「每個 seam 先請使用者確認」，不適合本專案：介面由 Claude 在 TASK 裡定（D-024），使用者不是工程師 |
| diagnosing-bugs | 同上 | Claude、Codex | 0 | 除錯流程 | 138 行，內容好，但約一半是通用範例 |
| codebase-design | 同上 | Claude、Codex | 1（D-110） | 深模組的設計詞彙 | 專案術語已經寫在 architecture.md；DESIGN-IT-TWICE 要同時開好幾個子代理 |
| retro | 同上 | Claude | 0 | 里程碑回顧 | 依賴一個不存在的 skill：`writing-for-agents` |
| codex-brief | 本專案 | Claude | 3 | 寫 TASK，加上審查 Codex 的成果 | 審查那一段和 code-review、D-106、D-117 重複；TASK 的存放位置還寫 `experiments/t2/TASK.md`，W 任務已經改放在 `tasks/` |
| essence-decision、essence-discuss | 本專案 | Claude、Codex | 14／0 | 和程式品質無關 | 不動（essence-discuss 的問題見 §7） |
| simplify、security-review | 內建 | Claude | 0 | security-review 在里程碑時用 | 內建的，刪不掉 |

使用次數是在本機 Claude 對話紀錄裡數 Skill 呼叫得到的；Codex 有沒有用過，Claude 看不到（§6 問題 2）。程式 10-20 才開始寫，所以沒用過不一定代表沒價值。

**根本問題**：品質規則分散在 5 個 skill、D-106、D-117、AGENTS.md 和 4 份 Claude 記憶裡。第三方 skill 預設的情境是「同一個 agent 自己寫、自己審，而且有 issue tracker」；本專案則是 Claude 寫規格、Codex 寫程式、Claude 審查。W1～W2 實際最有效的做法沒有寫進任何 skill：先由 Codex 審查，找到 2 個 P1；Claude 再用邊界例子重跑核對，又找到 N1～N3 和標題的 bug；延後處理的 4 件事各自記下了觸發點。

## 2. 提案：一個 `essence-quality`（程式品質）

依**時機**組織，不依技術組織。每個時機寫清楚：做什麼、誰做、花誰的額度。

### 2-1 四條原則

1. **機械性的問題交給自動檢查**：`npm run check` 每次都不花 token；審查抓到能用程式判斷的問題，當場加一條規則（D-117）。
2. **檢查不減，改由成本較低的方式做**：不靠少做檢查省額度（使用者明確要求過）。省額度的方式是：能交給自動檢查的交給它（0 token）、用 Codex 的額度、Claude 審查時不開子代理。
3. **問題提早處理**：規格裡寫出邊界例子和能用程式判斷的驗收條件，比事後審查便宜。F1 有一部分就是規格的漏洞。
4. **延後的問題一定要有觸發點**：不擋合併的發現，要記下「最晚什麼時候處理」，時機到了才會被看到。

### 2-2 額度階梯

| 層級 | 誰做 | 花誰的額度 | 用在什麼時候 |
|---|---|---|---|
| L0 自動檢查 | pre-commit hook、CI | 0 | 每一次改程式的 commit、每一次 push |
| L1 Claude 對照檢查 | Claude，不開子代理 | Claude（少） | Codex 每次交回成果、Claude 自己改程式時 |
| L2 Codex 交叉審查＋Claude 核對 | 另開一個新的 Codex session 審查；Claude 逐項核對，並用邊界例子重跑 | 主要是 Codex | 跨模組、資料格式、排程、寫回筆記等影響大的改動，合併前 |
| L3 兩個 Claude 子代理 | Claude | Claude（多） | 不再是預設；只在 L2 做不到時用（例如 Codex 額度用完） |

L2 取代 D-106「影響大的改動照 code-review 開兩個子代理」的做法。理由：

- W1～W2 實際就是這樣做的，找到 2 個 P1。
- 兩個模型的盲點不同：Codex 找到 F1～F7，Claude 核對時又找到 N1～N3 和標題的 bug。
- 檢查項目沒有減少，只是把重讀 diff 的成本移到 Codex。

代價是使用者要多轉貼一次訊息給 Codex。

### 2-3 時機表（skill 的主體）

| 時機 | 做什麼 |
|---|---|
| 設計介面、寫 TASK | 驗收條件要能用程式判斷，並列出邊界例子。寫回筆記的函式一定要有往返與冪等測試，並登錄到共用的範例清單（W2 `deckCases` 的做法）。新模組要加進 ESLint 的邊界規則。介面用 review.md 的深模組原則檢查一次。先看技術債登記，觸發點落在這個任務的項目，寫進 TASK。 |
| Claude 自己改程式 | 先寫一個會失敗的測試，再改程式（red → green）；只透過公開介面測試；`npm run check` 通過才 commit，不用 `--no-verify`。 |
| Codex 交回成果 | L1：讀 Codex 的回報和 diff，逐條對照 TASK 的「限制」與「要做什麼」，自己跑一次自我測試，再用邊界例子重跑。影響大的改動加做 L2。 |
| 測試失敗、有人回報 bug | 先寫出一個能重現錯誤（跑了會失敗）的指令，再提出 3～5 個假設；回歸測試放在 bug 真正發生的 seam；除錯用的 log 加上標記，結束時清乾淨。很難的 bug，建議切到 xhigh，或交給 Codex（推理等級：高）。 |
| 審查有發現 | 機械性的 → 加一條規則；需要判斷的 → 當場修，或登記進技術債並寫下觸發點。 |
| 里程碑完成 | 主動提醒做兩件事：一次 retro（犯過的錯能不能變成自動檢查、哪些指示沒有作用、哪裡花了太多額度），和一次 `security-review`。 |

### 2-4 檔案結構

SKILL.md 只放原則、額度階梯、時機表和測試規則（約 80～100 行），細節分成幾個檔，到了那個時機才讀：

```
essence-quality/
  SKILL.md       原則、額度階梯、時機表、測試規則（濃縮自 tdd：只透過公開介面測試、
                 不寫把預期值用同樣方式算一次的斷言、一次只做一小段、往返測試）
  review.md      兩軸審查清單（規格＝TASK＋它引用的 D-ID＋syntax.md；
                 規範＝AGENTS.md＋D-110 的邊界＋Fowler 的程式異味清單＋深模組 4 條原則）、
                 用邊界例子重跑的做法、給 Codex 的審查請求範本
  debug.md       濃縮自 diagnosing-bugs：建立回饋迴圈 → 重現並縮到最小 → 假設 → 量測 →
                 修正＋回歸測試 → 清理
  milestone.md   濃縮自 retro，加上 security-review 的做法與報告格式
  agents/openai.yaml
```

`.claude/skills/` 和 `.agents/skills/` 各放一份相同的內容（和 essence-decision 一樣）。Codex 寫程式時用測試規則和 debug.md，做 L2 審查時用 review.md。

Claude 會不會主動載入這個 skill，取決於 description 怎麼寫，所以要寫出具體的時機，例如：「Codex 交回成果或要合併分支前、寫 TASK 的驗收條件時、測試失敗或有人回報 bug、審查有延後處理的發現、里程碑完成時」。

### 2-5 技術債登記

W1～W2 留下的 4 件事，現在寫在 roadmap「下一次對話從這裡開始」。觸發點還很遠的項目（例如「W5 開始前」）會一直佔著那一節。

提案：`backlog.md` 加一節「技術債」，一件事一行，格式是「項目｜觸發點｜來源」。寫 TASK 或開始新的 W 任務時，skill 會要求先看這一節。處理完照 backlog 的慣例，只留一行連結或刪除。

## 3. 刪除與修改清單

**刪除**

- `.claude/skills/` 裡的 code-review、tdd、diagnosing-bugs、retro、codebase-design 和 UPSTREAM.md
- `.agents/skills/` 裡的 tdd、diagnosing-bugs、codebase-design 和 UPSTREAM.md
- `docs/agents/issue-tracker.md`：只是讓第三方 skill 找到規格用的，那些 skill 刪掉後就沒有地方引用它

**修改**

- `codex-brief`：「Codex 完成後檢查」整段移到 essence-quality，原處只留一行連過去；「自我測試」連到 essence-quality 的測試規則；TASK 的存放位置補上 `tasks/`。
- `decisions.md`：新增一條決定（預計是 D-119，寫入前先確認沒有被其他 session 用掉），修改 D-106 的審查分級和 D-117 的 retro 做法，並更新索引。
- `roadmap.md`：在「已完成」加一行。如果 §2-5 採用，4 件延後的事搬到 backlog 的「技術債」一節。
- Claude 的記憶 `milestone-retro-security`：改成連到 skill 的里程碑一節。

**不動**：essence-decision、essence-discuss，以及 AGENTS.md。觸發交給 skill 的 description 負責；AGENTS.md 每次對話都會載入，不再往裡面加行。

第三方的內容改寫後，各檔開頭註明「改寫自 mattpocock/skills v1.3.1（24fe0ef）的 xxx」，以後想看上游有什麼更新，可以手動比對。

## 4. 「主動」要靠什麼

依可靠程度與花費排序：

1. **hook 與 CI**（0 token，一定會跑）：D-117 的 pre-commit hook 和 GitHub Actions，在 W3 第 0 步裝好。
2. **skill 的 description**：寫出具體時機，Claude 遇到那個時機時會自己載入。
3. **記憶與 backlog**：description 抓不到的時機（里程碑）靠記憶提醒；觸發點還很遠的技術債，記在 backlog 的那一節。

沒有採用：合併 Codex 的分支時，用 hook 強制提醒審查。做起來和維護都麻煩，而 L1 審查本來就是合併流程的一部分（codex-brief）。

## 5. 代價

- **不能再直接升級第三方 skill**：改寫後就不能整個資料夾換成新版，要手動比對。這些 skill 只用過 0～1 次，前提也和本專案不同，Claude 認為值得。
- **L2 多一次轉貼**：使用者要把審查請求貼給 Codex。
- **兩份 skill 要保持一致**：`.claude` 和 `.agents` 各有一份；可以加一個小檢查（§6 問題 5）。
- **不宣稱能省多少 token**（沿用 10-19 討論稿裡 Codex 的意見）：預期減少的是每次對話都會載入的 skill 說明（Claude 端會自動載入說明的 skill 從 6 個減到 3 個）、載入 skill 時要讀的行數，以及 L3 的子代理，但都沒有實際量過。

## 6. 想請 Codex 回應的問題

1. **L2 用 Codex 交叉審查，取代兩個 Claude 子代理**：你同意嗎？負責審查的 Codex 要不要另開新的 session（不用寫程式的那一個）？審查請求裡要附上什麼，你才能審得好（TASK、基準 commit、邊界例子清單……）？
2. **Codex 端實際用不用得到**：W1～W2 你有沒有用過 `.agents/skills` 裡的 tdd、diagnosing-bugs、codebase-design？測試規則和除錯流程放在 skill、TASK 還是 AGENTS.md，你比較會真的照著做？
3. **codebase-design 的去留**：把 4 條原則併進 review.md 後刪掉？還是整份留著，當作介面設計的參考（W5 的 Obsidian 檔案存取、AI 模組會用到）？
4. **技術債記在哪裡**：backlog 的「技術債」一節，還是繼續留在 roadmap？
5. **兩份 skill 的一致性**：要不要寫一個小程式，檢查 `.claude/skills` 和 `.agents/skills` 共用的 skill 內容是否相同？放進 `npm run check`，還是只在改 skill 時手動跑？
6. **遺漏**：在本專案的開發過程中，還有哪些讓程式變乾淨或抓到錯誤的做法，沒有列進時機表？

## 7. 另外發現（不在這次範圍）

`essence-discuss` 的第一步要載入 `grilling`，但 Claude 和 Codex 兩邊都沒有這個 skill；`retro` 依賴的 `writing-for-agents` 也不存在（retro 這次會刪掉）。essence-discuss 要另外修：直接寫出它需要的做法，不再依賴 grilling。
