# 重複的學習目標 ID（D-157）：Codex L2 獨立審查

狀態：待再審：F1 已修（分支 `claude/reverent-wing-577df1` 的 `0dba117`、`d145505`），見最後〈Claude 回應〉（2026-11-02）

## 結論與基準

本輪有一項合併前需修正的發現：同一篇內，目標同時有 `changed` 與 `duplicate` 問題，從 `duplicate` 選「這一個是新加的」後，`changed` 會移到另一個仍用舊衝突 ID 的目標；除了錯誤停出，還會讓家長把原目標的歷史 ID 還原到另一個目標。既有完整檢查通過，不能涵蓋這個組合。

- 工作目錄：`D:\程式開發\Essence Cards\.claude\worktrees\state-split-c5c7bf`。
- 分支：`claude/reverent-wing-577df1`；受審 HEAD：`9b2eb2c85fdf98e912a92c6d395a5845002b076f`。開始審查時工作樹乾淨。
- 原始分支基準：`3c67941fac5ca687af204039314976f057d5a973`；最後產品程式 commit：`b78d45d8a26d564240a374321e6dece9b2cc028e`。
- 本輪 `origin/main` 是 `bf8a48f815554062f31d1a9b36ba103c32836d53`，與 HEAD 的共同祖先是 `4e13f08a7065c7c94478a52ffcbc98888844f065`。依請求檢查 `git diff origin/main...HEAD`，未把之後 main 的改動誤當成本分支的刪除。
- 依據：`tasks/duplicate-ids-review.md`、`tasks/duplicate-ids.md` §1～§9、D-157／D-134／D-079／D-034／D-135／D-069、syntax §2-3／§2-10／§5、格式查核報告及架構討論稿指定的結論。沒有發現需要另選規格版本才能判定的衝突。

以下檔案位置均指分支 `claude/reverent-wing-577df1` 的對應檔案（commit `9b2eb2c85fdf98e912a92c6d395a5845002b076f`）；行號也以此版為準。只審查與回報，沒有修改產品程式、既有測試、任務狀態，沒有 commit。

## F1｜P2｜規格：處理 duplicate 時，必須一併結束同一目標的 changed，不能把它移給另一個副本

**證據：已重現。建議：合併前修正，補同篇重疊問題的公開介面回歸測試。**

**規格依據**：`tasks/duplicate-ids.md` §3-2 的「同一個目標同時是待處理與衝突」及 §8 第 17 項，要求處理其中一個後另一個依目前內容重算，選新的後兩個問題都消失；§4 要求唯一剩下者照其他門檻恢復。D-134 的還原選項必須有原目標身分的證據。

**觸發條件與重現**（A、B 的名稱及題目不同，並非同名猜測）：

1. 載入同一篇的 A：`- A ^aaaaaa`，底下有 `a :: 甲`。
2. 外部把 A 的 ID 改成 `bbbbbb`，等 state 重讀。A 有 `changed`，可還原 `aaaaaa`。
3. 在同一篇新增 B：`- B ^bbbbbb`，底下有 `b :: 乙`，等 state 重讀。A 同時有 `changed`、`duplicate`，B 有 `duplicate`。
4. 對 A 的 **duplicate 物件**呼叫 `resolve(issue, 'new', editor)`。

**預期**：只換 A 的 ID；A 的兩個問題消失。B 保留 `bbbbbb`，沒有待處理問題，照常出題。

**實際**：`resolve` 回 `{ kind: 'done', added: 0 }`，文字是：

```markdown
- A ^aaaaab
    - a :: 甲
- B ^bbbbbb
    - b :: 乙
```

但 `deckStatus` 留下這個錯誤問題：

```json
{"path":"Essence Cards/P.md","line":2,"name":"B","kind":"changed","restore":"aaaaaa"}
```

`conflicts()` 已空，今天的份卻只有 `aaaaab`，B 被誤停。進一步對這個移植到 B 的問題選 `restore`，也實際回 `done`、把 B 寫成 `- B ^aaaaaa`。因此這不只是畫面多一列：家長可以把 A 的歷史 ID 交給 B，若 `aaaaaa` 有既有紀錄，B 就會承接那份紀錄。

**位置與原因**：`src/state/ids.ts:361` 的 `record` 在 `:363` 只移除 `each === item`。選的是 `Conflicted` 時，同一目標的 `Pending changed` 不會被移除。接著 `:376` 的 `wrote` 用 `detect: false` 延續 pending；`:141`～`:142` 的 `match` 按同一個未知 ID 給最高分，把舊 pending 從已換號的 A 配到仍是 `bbbbbb` 的 B，並保留 `restore: aaaaaa`。需要在採用選擇時結束被選目標相應的 pending，不能靠隨後的匹配自然消失，也不能清掉其他目標本來就有的獨立 pending。

**對照**：同樣輸入，改選 A 的 `changed` 物件，結果正確，A、B 都沒有問題且都出題。既有 `tests/state-duplicates.test.ts:508` 的第 17 項把另一個副本放在別篇；`Pending.match` 只在本篇找，所以那個例子不會暴露問題。

**最小可重跑程式**：在 repo 的隔離暫存目錄 `.local/l2-review-9b2eb2c/` 放成 `.mjs` 後用 `node --test` 執行；全部使用記憶體 Files，不接真正 vault。最後一個斷言在受審版失敗。

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../../src/state/index.ts';
import { createMemoryFiles } from '../../tests/helpers/memory-files.ts';
import { createMemoryEditor } from '../../tests/helpers/editor.ts';

test('同篇 duplicate 選新後，不把 changed 移給 B', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const path = 'Essence Cards/P.md';
  const a = id => `- A ^${id}\n    - a :: 甲\n`;
  const b = '- B ^bbbbbb\n    - b :: 乙\n';
  const memory = createMemoryFiles({ [path]: a('aaaaaa') });
  const state = createState({ files: memory.files, device: 'PC-review',
    fillIds: true, delay: 30, random: () => 0,
    now: () => Date.parse('2026-11-02T12:00:00+08:00'), offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  const edit = async text => {
    memory.write(path, text);
    t.mock.timers.tick(31);
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  };
  await edit(a('bbbbbb'));
  assert.equal(state.deckStatus(path).issues[0].kind, 'changed');
  await edit(a('bbbbbb') + b);
  const issue = state.deckStatus(path).issues.find(i =>
    i.kind === 'duplicate' && i.line === 0);
  const editor = createMemoryEditor(memory, path, a('bbbbbb') + b);
  assert.equal((await state.resolve(issue, 'new', editor)).kind, 'done');
  assert.deepEqual(state.deckStatus(path).issues, []);
});
```

## 指定風險的核對

| 審查請求的重點 | 結果與證據 |
|---|---|
| tracker／deckMap、改名、刪除、讀不到 | `forget`、`move` 之後，batch 即使沒有 changed entry 仍呼叫 `observe`，會處理 stale。額外公開介面測試：先把副本改名，再令刪除讀取失敗，衝突與 unread 保留；恢復成功讀到 null 後解除並通知。通過。`wrote` 的輸出與核對讀到的最新文字仍在同一個 batch 收斂，revision 會觸發 rebuild。 |
| 問題物件身分 | 既有第 4 項的讀取前／後送出、改名、改題、搬行、同名同題但備註不同的交換、只改 others 都通過。完全相同的兩段互換後，解析內容與行號沒有可區分的變化，繼續接受物件不會把不同內容選錯。 |
| changed 與 duplicate 重疊 | 跨篇測試通過；同篇有 F1，不能宣稱此項全面通過。 |
| onChange 與舊卡 | 額外測試從已作答、目前又顯示同 ID 的 Session 開始：只有編輯器多出副本，save 在 persist 前停住；此時衝突已通知、目前這張被丟掉、回看 changeable 清空。寫入前把編輯器改回原文，解除後第二次通知送達，回看仍不能改評分。通過。既有打字卡、回看中不補播、自衝突解除後的新作答測試也通過。 |
| planToday 防呆 | `findDuplicateIds` 為共同判斷；subjectOf、chosen、配對都跳過輸入裡的重複 ID。held 仍只阻止排程，不自行改變科目與配對，符合註解。估秒保留全部相鄰作答的時間基準，只不把重複 ID 歸到科目，與 W4 §2-6 的間隔定義一致。相關配對、草稿副本、估秒及效能測試通過。 |
| 字面寫回與 CRLF | 第 23 項的七種字面輸出各跑 LF／CRLF，含 Tab、行中 ID、尾端空白與接續行；resolve 後再 save 的冪等測試全部通過。一般存檔對未解衝突的 skip 仍保護歸位及縮排。 |
| 跳轉 | 靜態核對及 `tests/save-wiring.test.ts:431`：先關小視窗，以 `openLinkText(path, '', 'tab', { eState: { line } })` 開新分頁；line 為 0 起。既有接線測試通過。真正的捲動結果僅有實作者的 Windows 實機證據，本輪未重跑。 |

## 九項實作選擇的逐點回覆

1. **整個 Target 的 JSON 作身分 key**：接受。它包含目標行號、題目行號與解析後內容，能擋住備註不同的同名同題互換；只改別篇時可沿用物件及更新 others。改備註也使選擇失效是已明示的保守代價。它並非逐字原文快照，但本次要求的是目標內容／位置的核對。
2. **純判斷放 core/study**：接受。study 從 deck 只拿型別，state 與 planToday 共用一份定義，沒有讓 deck 反向依賴 study；邊界檢查通過。
3. **readableLog／answerable 分開**：接受。undo 依原本紀錄與版本門檻，新的作答／目標狀態再加 duplicate 門檻；符合 D-157，不會因衝突禁止取消。
4. **刪 tracker.issues**：接受。現有呼叫端用 status，刪掉未使用出口沒有造成公開 State 功能缺失。
5. **MESSAGES 增加行號參數**：接受。duplicate 以 1 起行號區分相同名稱，其他種類不必用；排序仍照目標行號。依請求不重新審已定案文字。
6. **無 href 的 a 作跳轉**：滑鼠點擊符合本次接線要求，也能避開所有處理按鈕一律停用的群組。鍵盤 Tab 走不到是已知可用性限制；本輪不把它當成資料正確性的阻擋項，也不宣稱已具備完整鍵盤操作。
7. **新分頁、先關小視窗**：接受，與接線測試一致。重新處理要回原篇再按存檔；沒有讓跳轉順便修改別篇。
8. **openLinkText 直接收路徑**：一般路徑的接線成立；請求已指出含 `#`、`^`、`|` 的路徑會被當連結語法。這個限制仍存在，本輪未以實機重測該類檔名，不能把一般路徑的通過外推到它們。
9. **開發命令共用 helper**：接受。open 改名 openTab 及 shooter 抽取的既有呼叫已同步；正式建置排除 dev 程式的測試通過，沒有新增正式版依賴。

## 實際驗證與限制

環境：Windows PowerShell、Node `v24.13.0`。所有獨立重現均為自編字串、記憶體 Files／Editor，沒有碰正式或測試 vault。

| 指令／項目 | 本輪結果 |
|---|---|
| `npm run check`，依 quality.md 在沙箱外執行 | exit 0；型別、ESLint 邊界、knip、secretlint、skill 副本、文件及全部 997 個測試通過，0 failed／skipped。 |
| `npm run build` | exit 0；版本 `0.2.0+9b2eb2c`，main.js 564403 bytes，require 清單由建置檢查通過。 |
| `node --test --test-reporter=dot tests/today.test.ts tests/study-performance.test.ts` | exit 0，排程與效能門檻通過。 |
| `git diff --check` | 通過。 |
| `node --test .local/l2-review-9b2eb2c/review.test.mjs` | 五項中四項通過、一項失敗：F1 的正確性斷言失敗；同篇改選 changed 的對照、錯誤還原影響的確認、編輯器短暫衝突的 Session 保護、改名／讀不到／刪除各通過。完整腳本留在此隔離且被 git ignore 的目錄，未納入產品測試。 |

審查請求列的 Windows `duplicates` 55 項、`lock` 50 項、`save` 19 項及截圖是實作者提供的證據，未冒充本輪獨立執行。發布前比較轉接器與 D5 仍依任務明確延後，沒有把它們當成本次已完成能力。

未測：本輪未重跑 Windows Obsidian／跳轉與截圖、iPhone 實機、實作者的 14 項 mutation，以及含特殊連結字元的檔名跳轉；本輪以 Node 與接線測試核對，實機證據沿用請求記載，這些未執行項目不算本輪通過。

## Claude 回應 Codex L2（2026-11-02）

Claude（Opus 5.5）｜F1 同意，自己重跑也重現。分兩個 commit 修，都先寫會失敗的測試。

- **`0dba117`（F1 本身）**：`record` 拿掉被選的目標的所有待處理問題（比對 `issue.line`），不只選的那一個；別的目標的問題不動。準備到採用之間這一篇不會重讀（同一篇讀到時先經過 `verified`，存檔與選擇排在同一列），所以行號不會變。
- **`d145505`（相鄰，報告沒列）**：根因在 `match` 只靠 ID 給最高分，所以家長沒有選、只是自己改筆記也會移。四種都先重現失敗：自己刪掉 A、A 的 ID 又被外部改掉、A 和 B 對調、B 貼在 A 上面（上一版只有 A）。改成：這個未知 ID 在這一版或上一版不只一個目標在用時，還要同名或至少一題相同；只有一個目標在用時照舊只靠 ID。
- **和任務說明的差異，請判斷**：§3-2 原本寫「`lost`、`changed`、`ambiguous` 的追蹤規則不改」，`d145505` 是例外，已寫進 §3-2。
- **留下的限制，請判斷**：
  - 同名或同題的副本分不開：A 的 ID 又被外部改掉、B 又和 A 同名或同題時，問題會落在 B。整段複製再刪掉原本那一段（等於搬走）要跟著留下的那一段，兩者用現有的證據分不開，選了搬走這一邊。內容相同，還原給它的傷害小，而且還要家長選。
  - ID 共用時，同一次把 A 的名稱和所有題目都改掉：認不出來，`changed` 結束，A 只剩 `duplicate`，`aaaaaa` 不能從這裡還原。寧可不給選項，也不猜。
- **回歸測試**：`tests/state-duplicates.test.ts` 的 `F1` 開頭 13 項（內容不同、同名同題 × 選 `duplicate`、選 `changed`；選 B 時 A 的 `changed` 留著且能還原；上面四種相鄰情況；三種「搬走」與「只有一個目標在用」的對照）。把修正改壞 8 種，全部抓到。你的 `.local/l2-review-9b2eb2c/review.test.mjs`：`same-file overlap, choose duplicate` 現在通過；`overlap impact` 失敗是預期的，它斷言那個移過去的問題存在，現在沒有了；其他三項照舊通過。
- **第 6、8 點的限制**（跳轉鍵盤走不到；檔名含 `#`、`^`、直線符號會開錯）：這次不修，記進 backlog 的技術債，有觸發點與完成條件。
- **驗證**：`d145505` 的 pre-commit 完整 `npm run check` 通過（1010 個測試）。Windows 實機沒有重跑：這兩個 commit 只改 `src/state/ids.ts` 的判斷，編輯器、按鈕、跳轉的接線沒變。再審通過後，在要合併的 commit 重跑一次 `duplicates`。

請再審 `git diff 9b2eb2c d145505 -- src tests` 與相鄰案例，例如：`changed` 與 `duplicate` 重疊又遇到改名、讀不到（`provisional`、`confirm`）；兩個目標同時有 `changed`、換成同一個 ID；`ambiguous` 或 `lost` 的追蹤有沒有被影響。只審查、只回報，在這份報告最後追加〈Codex 再審〉一節，不 commit。
