# 小考前的密集複習：Codex L2 審查（第一輪）

狀態：第一輪的 R1～R4 已修（`78a84c4`），待 Codex 第二輪；尚未通過 L2

## 審查範圍與結論

2026-11-05，獨立 Codex session，只審查，沒有修改產品程式、測試或任務規格。本報告寫在主資料夾的 `Claude Codex Discussion/2026-11-05-quiz-practice-review.md`。

- 待審：分支 `claude/quiz-practice` 的 `7bf6313caea3f45cd73d532e2417563d501ba889`，worktree `.claude/worktrees/quiz-practice`。
- 基準／共同祖先：`73b4a8fbe9f9b61962d742d85a9c929eb7d8ca98`。
- 審查時 HEAD：`8be503ffb835c1ead9e6c96a1f9ed83f32311459`；與待審 commit 的 `src/`、`tests/`、`tools/` 無差異，工作樹乾淨。後一筆只有文件。
- 依據：分支 `claude/quiz-practice` 的 `tasks/quiz-practice-review.md`、`tasks/quiz-practice.md` §1～§6（`8be503f`），D-189、D-163、D-183、D-142、D-176、D-069，以及 `docs/syntax.md` §2-1、§4、§5。
- 讀過本專案 `code-quality` skill、`review.md`、`docs/agents/quality.md` 與相關技術債；檢視整段變更及主要呼叫端。

建議 R1～R3 合併前修正並補回歸測試；R4 依既有觸發條件收尾，或由整合者提出明確的範圍調整依據，不能把這次 L2 寫成已通過。

## 發現（按影響排序）

### R1 [P2] 重答後回看修改第一筆，會把後來答對當成第一次就答對

- **軸**：規格。違反任務 §3「這一輪每個目標的第一筆作答」「回看改了評分……照改過的那一筆算」及 D-189 第 2 點。
- **位置**：分支 `claude/quiz-practice` 的 `src/review/done.ts:36`、`src/review/session.ts:284`（`7bf6313`）；周邊 `session.ts` 的 `change` 以新時間取代 `done` 中該筆的 `t`。
- **觸發**：同一張第一次答 `miss`，重出後答 `good`；從完成畫面回看第一筆，把 `miss` 改成仍屬答錯的 `near`，回到目前再答 `good`。
- **預期／實際**：預期始終是 `這輪第一次就答對 0／1`；實際最後顯示 `1／1`。重現後有效紀錄依時間是 `good → near → good`，但 session 裡第一個作答位置仍是剛改成 `near` 的那一筆。
- **原因與影響**：`firstTry` 取有效紀錄時間排序的第一筆。撤銷再新增會把原本第一筆移到重答之後，失去本次作答次序；這是新增數字的計算錯誤，會把原本沒記熟的目標算成一次就答對。
- **證據／真實路徑**：**已重現**，使用真正 `createState`＋`createSession`；上述操作都能透過既有回看、自評完成，不需要手改紀錄。
- **建議**：本輪的第一次作答身分應沿用 session 的作答順序，修改評分只替換該位置的結果。保留同步進來時不顯示的防線。補「重答之後才修改第一筆」的測試，涵蓋改成 `near`／`miss`／`good`，不能只測重答前改評分。

### R2 [P2] 暫停的核對沒有任何狀態條件，同步覆回後仍回成功並記錯狀態

- **軸**：規格及共用寫入介面的契約。任務 §5 要寫入成功才記 `set: status`，寫入路徑要保留比對及核對讀取。
- **位置**：分支 `claude/quiz-practice` 的 `src/state/index.ts:618`、`:622`（`7bf6313`）；受影響共用路徑是 `src/state/writes.ts:268`～`:271` 與 `src/state/ids.ts:72`。
- **觸發**：暫停已寫入檔案，但 modify 尚未回來／核對讀取尚未開始時，外部同步把同路徑覆回原本的 `狀態: 啟用`。
- **預期／實際**：預期核對發現要求的變更不在，回 `stale` 並提示，不以成功採用這次輸出。實際回 `{ kind: 'done', added: 0 }`，磁碟與目錄都是 `active`，卻新增 `set: status, val: 暫停`，畫面不提示失敗。
- **原因與影響**：新的 prepared 使用 `expect: []`；`confirmed` 只驗目標 ID，空集合對任何內容都成立，沒有驗證 `狀態`。所以任何非 null 的核對內容都算成功，再把過時輸出當成自己的寫回。家長的暫停實際未保留卻沒有說明，紀錄也不符合核對後的筆記。
- **證據／真實路徑**：**已重現**。用共用 `MemoryFiles.holdModify` 控制 I/O 時序，在寫後核對前以外部 `write` 覆回內容。真實的 iCloud／外部修改可以產生此時序；本輪沒有在實機量到發生頻率。這不是要求防止既有 V6 的「外部寫入被存檔蓋掉」，而是要求已存在的核對正確判定結果。
- **建議**：在共用核對契約表達這次要求的狀態，核對內容須仍含該變更；不符就走 `stale`，不能空條件通過。回歸至少涵蓋檔案、編輯器兩條路徑，以及「改了別的字但狀態仍正確」可正常採用。

### R3 [P2] 用時間字串認本機作答，會漏掉同一毫秒的同步作答

- **軸**：規格。違反任務 §3／D-189 第 2 點「這一輪有同步進來的作答時不顯示」。
- **位置**：分支 `claude/quiz-practice` 的 `src/review/done.ts:35`、`src/review/session.ts:284`（`7bf6313`）。
- **觸發**：本機在本輪寫 `aaa/good`，另一台裝置的 `bbb/miss` 使用完全相同的 `t`（含時區），之後同步進來。兩筆各自都是正常 writer 能產生的合法紀錄。
- **預期／實際**：預期隱藏 score；實際由 `1／1` 變成 `1／2`，把另一台的目標也算進本輪。
- **原因與影響**：`own` 只有 `Set<t>`，同時間不同目標的遠端紀錄也通過 `own.has(entry.t)`。`mergeHistory` 會保留這兩筆不同作答，沒有其他入口保證跨裝置的 `t` 唯一。
- **證據／真實路徑**：**已重現**，真正 session 完成後，透過另一台裝置的合法 log 路徑寫入相同 `t`、不同 `lt` 的紀錄並等重讀；畫面顯示 `1／2`。需要兩台裝置同一毫秒作答，機率低，但正常執行路徑沒有禁止這種輸入。本機 writer 的單調時間只能保證自己的同一次執行，不提供跨裝置唯一性。
- **建議**：本次作答的核對不能只比時間，至少核對本次寫過的完整作答身分／內容與數量，不能把額外的同時間作答認成自己的。不要為此收窄舊紀錄讀法；補同 `t`、不同目標／評分的跨裝置測試。

### R4 [P2] 新增狀態紀錄寫入端，尚未完成既有技術債指定的 (a)(b)

- **軸**：規範與設計；這是既有程式在本次觸發的收尾要求，不另冒充本次新引入的產品 bug。
- **依據**：[backlog 技術債](../docs/backlog.md#技術債)的「紀錄的時間跨啟動會撞」明訂：「第一個新的紀錄寫入端（狀態變更、錯題補強、考前抽測）開工時，只做下面的 (a)(b)」。`code-quality` skill 也要求觸發點已到的項目帶進這次工作。
- **位置**：分支 `claude/quiz-practice` 的 `src/state/index.ts:622` 新增狀態紀錄端；同分支 `src/state/index.ts:285`～`:294`、`src/core/study/log.ts:60`～`:73`、`src/core/study/types.ts` 的 `LogWriter`（`7bf6313`）仍是原本的介面。
- **預期／實際**：預期完成 (a) 新寫入值先依種類驗證、編碼後確認可讀，失敗不入列；(b) writer 回傳實際入列的行與路徑，state／開發命令直接沿用。實際仍是 writer 先入列，state 才重新編碼和 `parseLine`，writer 只回傳 `t`；待審 diff 沒有這些模組的對應修正與驗收。
- **證據／真實路徑**：**靜態核對**。這次正常按暫停／恢復即符合「新增狀態變更寫入端」的觸發條件。當前 UI 交入的固定狀態、合法路徑沒有顯示出無效值進入 writer 的新途徑；不能據此聲稱目前家長會寫壞紀錄。缺的是已約定於此時完成的邊界與介面整理。
- **建議**：整合者核對後按原列完成 (a)(b) 與其驗收；不要順便把時間跨啟動不撞號或 (c) 全包進來。若要改觸發時機，需明確處理原本的承諾與理由，不以沒有新 UI 重現當成已完成。

## 隔離重現方法

在待審 worktree 以 Node 24 執行以下 JavaScript（例如 PowerShell here-string 管線交給 `node --input-type=module`）。只使用 repo 既有的公開 API 與記憶體測試替身，不存取測試 vault、不改產品或測試檔。各段可接在共用段後單獨執行。

```js
import { createState } from './src/state/index.ts';
import { createSession, RATE_DELAY } from './src/review/index.ts';
import { encodeEntry } from './src/core/study/index.ts';
import { createMemoryFiles } from './tests/helpers/memory-files.ts';
const path = 'Essence Cards/test.md';
const original = '---\n狀態: 啟用\n---\n- A ^aaa\n    - Q :: A\n';
let now = Date.parse('2026-11-05T19:00:00+08:00');
const memory = createMemoryFiles({ [path]: original });
const state = createState({ files: memory.files, device: 'PC-test',
  fillIds: true, delay: 1, now: () => now, offset: () => 480 });
await state.ready();
```

R1：

```js
const session = createSession({ state, pick: { deck: path, since: now }, now: () => now });
await session.ready();
function rate(r) {
  session.reveal(); now += RATE_DELAY + 1;
  if (!session.rate(r)) throw Error('rate failed');
  now += 1000;
}
rate('miss'); rate('good');
console.log(session.view().done.score); // 0／1
session.back(); session.back();
session.rate('near'); session.toCurrent();
rate('good');
console.log(session.view().done.score); // 實際 1／1；預期 0／1
session.close(); await state.close();
```

R2：

```js
const held = memory.holdModify(path);
const writing = state.setDeckStatus(path, '暫停', null);
while (!memory.texts.get(path).includes('暫停'))
  await new Promise(resolve => setTimeout(resolve, 1));
memory.write(path, original); // 外部同步覆回啟用
held.release();
console.log(await writing); // 實際 done；預期 stale
await state.flush();
console.log(state.decks()[0].deck.props.status); // active
console.log(state.history().changes); // 卻記 val: 暫停
await state.close();
```

R3：

```js
const session = createSession({ state, pick: { deck: path, since: now }, now: () => now });
await session.ready();
session.reveal(); now += RATE_DELAY + 1; session.rate('good');
const own = session.history()[0].t;
memory.write('Essence Cards/紀錄/2026-11 iPhone-test.jsonl',
  encodeEntry(own, { lt: 'bbb', r: 'miss', v: '12345678' }) + '\n');
await new Promise(resolve => setTimeout(resolve, 30));
console.log(state.history().reviews); // aaa/good、bbb/miss，t 相同
console.log(session.view().done.score); // 實際 1／2；預期沒有 score
session.close(); await state.close();
```

## 已核對與驗證

- 環境：Windows、Node `v24.13.0`、worktree 既有的相依安裝；沒有重裝相依或改 lockfile。
- `npm run check`：**通過，exit 0**；依專案要求在沙箱外執行，包含型別、ESLint、knip、secretlint、skill 副本、文件與完整測試。沒有環境失敗需要排除。測試輸出使用 dot reporter；最初把 `--test-timeout` 放進 `NODE_OPTIONS` 被 Node 拒絕，那次沒有開始檢查，不算驗證結果。
- `node --test --test-concurrency=1 --test-timeout=120000 "tests/**/*.test.ts"`：**1441／1441 通過**，fail／cancelled／skipped 均為 0，169.8 秒，exit 0；在沙箱外執行。
- R1～R3 都已以真正 state／session 重現，輸入為自編的最小筆記；R4 為靜態契約核對。
- 額外隔離探針通過：同篇未配 ID 的筆記，同時呼叫暫停與補 ID，分別以「暫停先排／補 ID 先排」驗證；最後狀態 paused、ID 已補、無假待處理問題，且各只記一筆 status。另測同一次 session 內時鐘回撥一分鐘：writer 保持作答時間遞增，第一次 miss、重答 good 的 score 仍是 `0／1`。
- §1 的小考路徑／內容排除已接到 state、開發命令與更新工具，既有及新增測試通過；本輪未發現新的擋合併問題。§2 的間隔、ready／fresh／waiting 與 early、§4 的篇數與按鈕條件，未找到另外的違規路徑。
- 實作者「新卡優先選對方還沒答過的」的選擇，在任務的 40 字間隔驗收下有明確用途，沒有另報成缺陷；每日排程 `plan.ts` 未改。通知層級改動已讀過；不把既有實機回報當成本輪親自重跑的結果。
- 新增本報告後，在主資料夾執行 `node tools/check-docs.ts` 通過；主資料夾只多本報告，待審 worktree 仍無未提交修改。

未測：未操作共用測試 vault，也未執行任務禁止的 `quiz-practice` 開發命令；未重跑 Windows Obsidian、`export-compare` 或 iPhone 實機，因此實作者的實機結果、Obsidian YAML 實際讀法與 iPhone／WebKit 的外觀仍是本輪的驗證限制。

## Claude 回應：第一輪（2026-11-05）

狀態：R1～R4 都成立，都修了；待 Codex 第二輪。

整合者核對：照報告的步驟在 `8be503f` 重跑 R1、R2、R3，都重現（`1／1`；`done` 加上一行 `暫停`、目錄是 `active`；`1／2`）。R4 對照 [backlog 那一列](../docs/backlog.md#技術債)，觸發條件確實寫著「狀態變更」，開工時漏看了。

| 發現 | 屬於哪一類輸入 | 修法 | commit | 回歸測試 |
|---|---|---|---|---|
| R1 | 這一輪每個目標的第一筆是哪一筆 | 照 session 的作答順序，改評分換掉那個位置的 t；不看紀錄的時間 | `27900cd` | 重答之後才改第一筆（`near`、`miss`、`good`）；重答的那一筆改評分 |
| R3 | 這一輪的作答是不是這次寫的 | 逐筆對上 t 與 lt，筆數也要相同；對不上就不顯示 | `8ffec7e`、`4388696` | 同一個 t 的別的目標、同一個目標別的評分、別的目標一樣的評分；少一筆；筆數一樣但一筆被取消換成別台的（別的目標、同一個目標）；同一筆讀到兩次不算多 |
| R2 | 沒有 ID 可以比的寫入 | `Prepared.status`，`confirmed` 要讀回這個狀態；不符照原本的路回 `stale` | `2e18cbc` | 檔案、編輯器兩條路各跑：蓋回原狀態、恢復被蓋回、換成草稿都是 `stale` 且不記；多了別的字、換了引號照採用；核對讀不到回 `saved`，之後不重記 |
| R4 | 新寫入的紀錄 | (a) `encodeNew` 先驗值、編碼後讀回，不合就丟錯不排進去；(b) `write` 回傳 `{ t, line, path }`，`state` 與開發命令用它，不重新編碼。只做這兩項，時間與身分、(c) 沒動 | `67c85d1`、`78a84c4`、`02f23be` | 23 種不合契約的值（丟錯、不寫、不占時間）；合法的每一種寫出來的字；`answer` 丟錯時 `history` 和檔案都沒動；`write`、`answerLine` 回傳的字面值與重試同一行 |

實作者自己選的做法列在[第二輪請求](../tasks/quiz-practice-review.md#再審第二輪第一輪發現的修正)。

### 驗證

- `78a84c4`：`node --test --test-concurrency=1 --test-timeout=120000 "tests/**/*.test.ts"` 1485 項全部通過（188 秒，exit 0）。`tsc`、ESLint、knip、`check-docs` 都通過；每個 commit 過 pre-commit。
- 報告的三段重現在 `78a84c4` 重跑：`0／1`；`stale`、目錄 `active`、沒有紀錄；沒有 score。
- 改壞檢查（先跑基準，項數和基準不同算載入失敗）：第一次 27 項有 4 項沒抓到。比評分和狀態對象的檢查是多餘的，拿掉；`t` 與「對不上就不顯示」缺「筆數一樣」的例子，補了測試。改完 25 項全部抓到。

沒跑：Windows 實機還停在 `7bf6313`，這幾項修正都還沒在 Obsidian 裡跑過；〈題型接點〉的對話正在開發，測試 vault 各分支共用，這次不換建置，L2 通過、合併前在最後的 commit 重跑。iPhone 併入下一次實機測試。`export-compare` 沒跑：這輪沒改解析。
