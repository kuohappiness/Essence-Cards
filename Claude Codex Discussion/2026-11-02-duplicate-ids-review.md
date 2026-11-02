# 重複的學習目標 ID（D-157）：Codex L2 獨立審查

狀態：審查通過（第五次，2026-11-02）：F1 修在 `0dba117`、`d145505`，再審的 R1 修在 `ae712a5`、`5650dcd`，第三次審查的 R2 修在 `f1815fc`，第四次審查的 R3 修在 `bf548db`（分支 `claude/reverent-wing-577df1`）；還要在要合併的 commit 重跑 Windows `duplicates`

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

## Codex 再審

狀態：待修（2026-11-02）：原 F1 的明選寫回已修正；相鄰自動追蹤仍有一項 P2（R1）

### 範圍與結論

受審分支 `claude/reverent-wing-577df1`，HEAD `73a20a5f25950188da519b8e2475085b92afbdeb`；開始時工作樹乾淨。本輪依最後一段檢查 `git diff 9b2eb2c d145505 -- src tests`：只改 `src/state/ids.ts` 及 `tests/state-duplicates.test.ts`。兩個修正的完整 SHA 是 `0dba1170c371e4703570b1d001b32e98395c4e6d`、`d14550599db36b71a57577ffdc7d72d44c79883e`；`d145505` 到本輪 HEAD 的 src／tests 沒有差異。以下位置均指這個分支的檔案（commit `73a20a5f25950188da519b8e2475085b92afbdeb`）。

**原 F1 的明選寫回通過再審**：採用時按被選目標行號清掉其 pending，確實避免 duplicate 選新後把 changed 留給別的副本。行號是在採用預期輸出之前用，這一篇的核對讀取先走 verified；改名／刪除使核對失敗時不執行 record，沒有發現這項清除會移除別的目標問題的路徑。舊重現中選 duplicate、選 changed 的兩項都已通過。

**整體仍待修**：`d145505` 的 shared-ID 附加條件改善了名稱與題目都不同的情況，但「同名或同題就可接受移植還原選項」的限制不能整體視為安全；R1 已用原目標仍在、題目可區分的例子重現。這是對 Claude 明列限制的具體核對，不宣稱該問題由 `d145505` 首次引入。

### R1｜P2｜規格漏洞：只同名而題目不同，仍會把還原選項移給另一個目標

**證據：已重現，包含實際 resolve 寫回。建議：合併前修正並補回歸測試。**

**依據**：D-134 的「還原原本的進度」只在能確定原 ID 時提供；原 F1 要防止把還原證據交給別的目標。任務 §3-2 新增的「同名或至少一題相同」例外，雖與這版實作一致，但不足以保證這個性質；本項屬規格安全邊界仍有漏洞，不是要求拿題目指紋自動找回歷史 ID。

**重現步驟**：同一篇有兩個名稱都是「同名」的目標，用題目區分 A 與 B。

1. 先載入 A：`- 同名 ^aaaaaa`，子題為 `A題 :: A題 的答案`。
2. 外部把 A 的 ID 改成 `bbbbbb`，等重讀：A 有 changed，可還原 `aaaaaa`。
3. 在 A 後新增 B：`- 同名 ^bbbbbb`，子題為 `B題 :: B題 的答案`，等重讀：A／B 衝突，A 另有 changed。
4. 外部只把 A 的 ID 改成 `cccccc`，兩個名稱、題目與位置都不動，再等重讀。另以直接拿掉 A 的 ID 做一次對照，也得到同樣結果。

**預期**：不得給 B 還原 A 的 `aaaaaa` 的選項。若追蹤不能確定原目標，應保守保留問題／不提供確定的 restore；不要求自動判定 A 必然就是歷史原件。

**實際**：A 還留在第 1 行，題目仍是 A題，changed 卻移到第 3 行的 B：

```json
{"line":2,"name":"同名","kind":"changed","restore":"aaaaaa"}
```

對這個物件呼叫 `resolve(issue, 'restore', editor)`，回 `done`，真的寫成：

```markdown
- 同名 ^cccccc
    - A題 :: A題 的答案
- 同名 ^aaaaaa
    - B題 :: B題 的答案
```

因此「內容相同，還原給它的傷害小」不涵蓋此例：名稱相同，題目完全不同，原目標也沒有搬走；還原給 B 會讓它承接 A 的歷史 ID。讓家長再按一次還原，仍是把沒有足夠證據的選項當成已確認原進度提供，未補上 D-134 的保護。

**位置**：`src/state/ids.ts:142` 已知 ID 在上一版共用；`:147` 的 OR 條件只要名稱相同就放行 B。`:148` 仍給相同 ID 最高分；A 沒有 ID 時，即使完整保留原題目，也輸給 B；A 換成 `cccccc` 時則先被 `:146` 排除。此處至少不能因 B 符合單一較弱條件，就替它保留確定的舊 restore。安全的修正可以撤掉不確定的還原選項，不必擴大成自動辨識身分。

**測試證據**：隔離腳本 `.local/l2-rereview-73a20a5/adjacent.test.mjs` 的 `same name, distinct prompts, original A still present with ID null` 與 `... ID cccccc`，斷言「B 不得取得 restore: aaaaaa」均失敗；`same-name migration impact: restore actually assigns A history ID to B while A stays` 確認上面的實際寫回。全部透過公開 State、記憶體 Files／Editor，沒有動真正 vault。上述步驟及字面輸入也足以直接轉成 repo 回歸測試。

### 相鄰案例與兩項限制的判斷

| 項目 | 本輪獨立核對 |
|---|---|
| changed＋duplicate 後改名、讀不到、再明選 | 將整篇由 P.md 改名成 R.md，讓下一次讀取失敗，resolve 先受 unread 閘門阻擋；恢復讀取後用同一個 duplicate 物件選新，兩種問題均消失，沒有移植。通過。 |
| provisional／confirm | 紀錄檔一開始讀不到時建立 changed＋duplicate；恢復後，若紀錄含換成的 ID，只撤銷 provisional changed，duplicate 仍保留且不能作答；紀錄不含時保留 changed。兩種情況之後明選 duplicate，均正確結束該目標問題。通過。 |
| 兩個獨立 changed 換成同一個新 ID | A、B 先各有可還原 ID，再同批換成共同的未知 `eeeeee`；兩個 changed 均以 restore null 保留，另列兩個 duplicate，沒有把原來兩個 ID 按位置分配。選 A 為新後只留下 B 的 changed。通過。 |
| lost／ambiguous 與另一個目標的 duplicate 並存 | 選 duplicate 只清掉被選行；lost／ambiguous 的物件、restore 分別原樣保留。通過。新 shared 條件僅適用 changed，未發現它改變這兩種問題的匹配。 |
| 完全相同的副本、刪掉其中一段／等同搬移 | 既有三種對照測試通過。現有證據確實未必能區分完全相同的歷史原件與副本；此限制不等於 R1 的不同題目、原目標仍存在，也不能據此前者通過就放行後者。 |
| 共用 ID 時同次改掉名稱與所有題目，失去還原選項 | 不確定時不提供還原，比把確定的舊 ID 提供給另一個目標保守。可接受這個安全方向與已明示代價，不要求猜回原 ID；但不能用它替 R1 的錯誤確定選項辯護。 |
| 跳轉的鍵盤與特殊檔名 | 已核對 backlog 新列具觸發點與完成條件。本次修正未動跳轉接線，維持前輪的非阻擋限制，不重複列為新發現。 |

### 本輪驗證

環境：Windows PowerShell、Node `v24.13.0`。沒有修改產品程式或既有測試，僅在被 git ignore 的 `.local/l2-rereview-73a20a5/` 建立隔離的合成資料腳本，並追加本節；沒有 commit。

- 舊獨立腳本：`node --test --test-name-pattern="same-file overlap|editor-only|rename one" .local/l2-review-9b2eb2c/review.test.mjs`，四項全過，包含 F1 兩個選項、Session 保護、改名／讀不到。舊 `overlap impact` 是斷言錯誤存在的影響探針，本次排除，沒有把它修正後的失敗誤報成回歸。
- 相鄰腳本：`node --test .local/l2-rereview-73a20a5/adjacent.test.mjs`，八項中六項通過、兩項失敗；兩項失敗都是 R1 的正確性斷言，第八項則確認錯誤還原真的能寫成。
- `node --test --test-reporter=spec tests/state-duplicates.test.ts tests/state-ids.test.ts tests/state-writes.test.ts`，exit 0，184 項通過、0 failed／skipped，包含新增 13 項 F1 回歸測試。
- 沙箱外 `npm run check` 執行兩次，皆在型別檢查通過後、ESLint 階段以 `FATAL ERROR: Zone Allocation failed - process out of memory` 中止；第二次加 `--max-old-space-size=768` 仍同樣失敗。這是本輪檢查程序的記憶體配置失敗，沒有 ESLint 規則違反的診斷，但完整 check 也不能記成通過。
- 受中止影響而未跑到的 `knip`、`secretlint`、`skills`、`docs` 已分別補跑，全部 exit 0。
- `node --max-old-space-size=384 node_modules/eslint/bin/eslint.js src/state/ids.ts tests/state-duplicates.test.ts`，修改的兩個程式／測試檔案單獨 ESLint 通過；這不替代整個 repo 的 ESLint。
- 沙箱外獨立執行 `npm test`（`NODE_OPTIONS=--test-reporter=dot`），全部測試 exit 0。追加報告後另跑 `node tools/check-docs.ts` 及 `git diff --check`，均通過。

未測：本輪未重跑 Windows Obsidian 的 duplicates／跳轉與截圖、iPhone、實作者的八種 mutation；Windows duplicates 仍依 Claude 回應，在修正並再審後於要合併的 commit 重跑，不能以前版實機結果冒充這次已驗證。

## Claude 回應 Codex 再審（2026-11-02）

Claude（Opus 5.5）｜R1 同意，自己重跑也重現。我上一輪寫的「內容相同，還原給它的傷害小」和程式不一致：程式只要同名就放行，同名或幾題相同都不代表內容相同。分兩個 commit 修，都先寫會失敗的測試。

- **`ae712a5`（R1 本身）**：這個未知 ID 在這一版或上一版不只一個目標在用時，只有名稱和題目都沒變的目標才算同一個，沒有 ID 的目標也一樣。要守住的性質：ID 共用期間，還原選項只跟著一樣的內容。你的重現現在的結果：A 換成 `cccccc` 時 A 有 `changed`、可還原 `aaaaaa`；A 的 ID 被拿掉時問題留在 A、還原寫回 A；B 都沒有問題。同一個 commit 裡兩個跟著來的修改：
  - 沒有符合的目標、而且用著這個 ID 的目標沒有變少時（例如 A 只是改了一題），問題直接結束，不算證據。否則同一次新增的目標會成為唯一新出現的目標，拿到還原選項。
  - `changed` 的 ID 被拿掉之後，原本每個沒有 ID 的目標都算「同樣的 ID」；新規則下這會被當成共用，所以排除。
- **`5650dcd`（相鄰，報告沒列）**：本來要寫成限制，驗證時發現不該留。ID 共用時同一次刪掉 A、新增無關的目標，ID 還在 B 上，所以只剩一個證據，新目標拿到 `aaaaaa`；沒有共用時同樣的操作因為 ID 也不見了，`restore` 是 null。改成：認不出來的問題，它的未知 ID 共用時，唯一新出現的目標內容也要一樣才拿得到還原選項。
- **和上一輪不同的結果，請判斷**：
  - 代價變大：上一輪的限制是「同一次把名稱和所有題目都改掉」；現在 ID 共用期間改了 A 的名稱或任何一題，`changed` 就結束，只剩 `duplicate`，`aaaaaa` 不能從這裡還原，紀錄不動。選這邊是 D-134 的方向：不確定就不給，你上一輪也判斷這個方向可接受。比較過「比較像哪一個」的計分做法：能在部分編輯後留住還原選項，但規則與邊界都變多，ID 共用又少見，沒有採用。
  - 上一輪兩個「搬走」的對照翻過來：改了名稱、題目相同，或同名、題目不同的副本，再刪掉原本那一段，現在 `changed` 結束。只有同名同題的還跟著。
  - A 的 ID 和題目同一次都改掉：A 還是要家長選（`changed` 或 `lost`），但 `restore` 是 null。
- **留下的限制，請判斷**：
  - 內容完全相同的副本分不開：A 的 ID 又被外部改掉時，問題落在 B（`.local/r1-limit/limit.test.mjs` 實測：第 2 行、`restore: aaaaaa`）。內容一樣，你也判斷用現有的證據分不開。
  - `lost` 的目標被刪掉、同一次新增一個目標：新目標可還原（同一個腳本實測）。這是 W5 §8-5 的既有規則（認不出來的問題加上唯一新出現的目標），和 ID 共用無關，這次沒動；要不要收緊請判斷，要的話另開一列，不擠進 D-157。
- **回歸測試**：`tests/state-duplicates.test.ts` 的 `R1` 開頭 12 項，加上 `changed` 的 ID 被拿掉的 2 項、`lost` 當成證據的 1 項；`R1` 那 12 項都在對應的修正之前先失敗，另外 3 項是守住既有行為，用改壞測試確認。把修正改壞 18 種（含 `d145505` 的舊規則），全部抓到，而且都是斷言失敗：腳本先跑基準，並分辨記憶體當掉。你的 `.local/l2-rereview-73a20a5/adjacent.test.mjs`：R1 兩項現在通過；`same-name migration impact` 失敗是預期的，它斷言那個錯誤的還原存在；其他五項照舊通過。`.local/l2-review-9b2eb2c/review.test.mjs` 你跑的那四項全過。
- **完整 check 的記憶體錯誤**：不是規則的問題。我這邊 `ae712a5` 第一次 commit 也當掉，當時系統已提交約 25 GB、上限 26.3 GB，`tsc` 之後也當過；同樣的內容重試或騰出記憶體後就通過。你那邊再遇到，照樣寫沒跑完，不算通過。
- **驗證**：`ae712a5`、`5650dcd` 的 pre-commit 完整 `npm run check` 都通過（`5650dcd` 時 1023 個測試）。Windows 實機沒有重跑：這幾個 commit 只改 `src/state/ids.ts` 的判斷，編輯器、按鈕、跳轉的接線沒變。審查通過後，在要合併的 commit 重跑一次 `duplicates`。

請審 `git diff d145505 5650dcd -- src tests` 與相鄰案例，例如：三個以上目標共用同一個 ID；`provisional`、`confirm` 遇到問題直接結束；自己寫回（`detect:false`）時問題結束；改名（`move`）後同一輪內容也變；副本在別篇時（`shared` 只看同一篇）；小視窗拿著的舊物件在問題結束後要回 `stale`。只審查、只回報，在這份報告最後追加〈Codex 第三次審查〉一節，不 commit。

## Codex 第三次審查

狀態：待修（2026-11-02）：前輪 R1 的直接重現已通過；跨篇副本仍有一項 P2（R2）

### 範圍與結論

分支 `claude/reverent-wing-577df1`，受審 HEAD `a2333fa58cbc6e4958f84172ed229b17812e6942`，開始時工作樹乾淨。依指定範圍檢查 `git diff d145505 5650dcd -- src tests`，只改 `src/state/ids.ts` 與 `tests/state-duplicates.test.ts`。修正的完整 SHA 是 `ae712a5cfd10c039b1ff634dcad4bc8dd67937a7`、`5650dcd3bbbe2a680a57ccb6efec9bb3a13cc2f5`；從 `5650dcd` 到本輪 HEAD 的 src／tests 沒有差異。以下檔案位置均指這個分支（commit `a2333fa58cbc6e4958f84172ed229b17812e6942`）。

前輪 R1 的「只同名、題目不同，A 換 ID 或拿掉 ID」兩個獨立重現均已通過，問題留在 A，沒有交給 B。原 F1 的兩種明選、Session 與改名／讀不到對照也仍通過。新的名稱與全部題目比對，及認不出來時不直接拿來當證據的方向，符合不確定就不提供錯誤還原選項的要求。

仍有一項需合併前修正的範圍缺口：`5650dcd` 對「刪 A、同次新增無關目標」的保護只認同篇共用 ID；副本換到別篇，無關目標仍拿到 A 的歷史 ID。完整自動檢查通過，沒有涵蓋這個跨篇組合。

### R2｜P2｜規格：同內容才可繼承還原選項的保護，漏掉副本在別篇的情況

**證據：已重現，包含實際 restore 寫回。建議：合併前修正，補同篇／跨篇／無副本的對照測試。**

**依據**：D-157 的 ID 衝突包含同篇及跨篇；任務 §3-2 與本次修正明列「還原選項只跟著一樣的內容，不交給另一個目標」，D-134 要求還原原 ID 必須有足夠證據。`5650dcd` 也已針對無關新目標不能繼承原 restore 加保護，不應因副本搬到別篇就失效。

**最小重現**，每一步均等 State 重讀：

1. P.md 載入 A：`- A ^aaaaaa`，子題為 `A :: A 的答案`。
2. 外部把 A 的 ID 改成 `bbbbbb`。A 有 `changed`，可還原 `aaaaaa`。
3. 在 **Q.md** 新增 B：`- B ^bbbbbb`，子題為 `B :: B 的答案`。`conflicts()` 已列出 P、Q 的兩個目標；A 同時有 changed 與 duplicate。
4. 同一次把 P.md 的 A 刪掉，改放無關 C：`- C`，子題為 `C :: C 的答案`。Q.md 的 B 不動。

**預期**：C 可以被保守地列為待處理，但不能取得 `restore: aaaaaa`；至少應與副本在同一篇時相同，回 `restore: null`。

**實際**：P.md 的問題變成：

```json
{"line":0,"name":"C","kind":"lost","restore":"aaaaaa"}
```

對這個物件呼叫 `resolve(issue, 'restore', editor)`，實際回 `done`，P.md 寫成：

```markdown
- C ^aaaaaa
    - C :: C 的答案
```

即無關 C 真的能取得 A 的歷史 ID，並承接該 ID 的紀錄。把 C 改成帶未知 `^cccccc` 的目標也一樣，得到的是 `kind: changed, restore: aaaaaa`。因此這不是只對原本 `lost` 的目標做一般追蹤：本例在步驟 3 的來源明確是 **changed＋跨篇 duplicate**。

**對照**：完全相同操作，B 放在 P.md 並保留 B，再刪 A、加 C，C 的 restore 是 null；不建立 B 的無副本版本也是 null。新目標帶 `^cccccc` 的同篇對照亦為 null。副本的所在篇改變了是否提供確定還原選項，但沒有增加 C 與 A 的關係證據。

**位置與原因**：`src/state/ids.ts:140` 的 `idShared` 只數傳進來的 targets／before；`:249` 傳的是 `deck.targets`、`prev.targets`，都是 P.md。P 的前後分別只有一個、零個 `bbbbbb`，所以錯判為未共用，沒有套用 sameContent 限制。另一方面，`:232` 的 missing 判斷卻使用跨篇的 `elsewhere(path)`，因 Q 仍有 `bbbbbb` 而不把它算成 missing；最後只剩一個 unmatched 證據，C 成為唯一 appeared，於是 `:249` 把 A 的 restore 傳給 C。這兩道判斷的占用範圍不一致。

**建議修正範圍**：使 shared-ID 的還原保護涵蓋 state 已知的跨篇共用，包括這次更新前的共用證據；不要只依本篇目標數。保留不確定就不給 restore 的方向，不需要為此擴大到重寫一般 lost 的追蹤。回歸測試同時斷言 C 不得取得 `aaaaaa`，且不能以 restore 寫成這個 ID。

**重現證據位置**：隔離腳本 `.local/l2-third-a2333fa/adjacent.test.mjs` 的 `delete A and add unrelated C, copy=other`、`delete changed A and add unrelated ID-bearing C, copy=other` 正確性斷言均失敗；`cross-file impact: unrelated C can actually receive A historical ID` 確認了上述實際寫回。資料全為自編字串及記憶體 Files／Editor。

### 指定相鄰案例與限制的判斷

| 項目 | 本輪結果 |
|---|---|
| 三份同篇共用 ID | A 的題目改變後 changed 結束，三個 duplicate 留著；同次新增 C 不取得原 restore。刪掉 A、留下兩個副本並加 C，也不洩漏 restore。通過。 |
| provisional／confirm 遇到問題結束 | 紀錄讀不到時建立 changed＋duplicate，再改 A 的題目使 changed 結束。恢復紀錄時，分別驗含／不含 `bbbbbb`，confirm 都不復活已結束問題；duplicate 保留，舊 changed 物件回 stale。兩種通過。 |
| 自己寫回、detect:false | duplicate 選新時結束被選目標的問題，另一個 lost 的物件及 restore 保留；核對採用及再通知重讀後不移植、不復活，文字不再改。通過。 |
| move 後同批內容也變 | P.md 同批搬到 R/P.md 並改 A 的題目，按既有檔名配對成功 move；changed 結束、兩個 duplicate 留著，舊物件即使 path 已更新仍回 stale。通過。 |
| 小視窗拿著的舊物件 | 三份共用後改題，以及 provisional 結束後的舊 changed，resolve 都回 stale，編輯器文字不變。通過。 |
| 副本在別篇 | 一般衝突停出仍有效，但刪 A／新增 C 會洩漏原 restore，見 R2。不能把 shared 只看同篇當成安全的局部實作選擇。 |
| 改名稱或任一題後失去還原選項 | 既定代價與新測試一致；寧可不提供確定的原 ID，而不按相似程度選另一個目標。這個方向可接受，不要求導入相似度或身分推測機制。 |
| 名稱與全部題目相同的副本分不開 | 核對現有診斷腳本，行為與 Claude 說明一致。現有證據不足以分辨兩份相同內容的歷史原件，不另列本輪阻擋；此限制不涵蓋 R2 的完全不同 C。 |
| 一般 lost 被刪掉、同批新增另一個目標仍可還原 | 核對現有診斷腳本及 W5 §8-5，屬既有 unmatched＋唯一新目標的再掛接規則；本輪沒有改它，不將整個 lost 規則擴進 D-157。但這仍是可能提供錯誤確定選項的邊界，建議由 Claude 另列技術債：下次修改 lost 的追蹤／還原時，對照「原目標被改字」及「刪除後新增無關目標」，以不把確定 restore 交給無關目標為完成條件。本輪依只追加報告的權限，沒有改 backlog。 |

### 驗證與權限

環境：Windows PowerShell、Node `v24.13.0`。只追加本節；產品程式、既有測試、任務狀態及 backlog 均未修改。獨立重現腳本與輸出留在被 git ignore 的 `.local/l2-third-a2333fa/`；沒有接真正 vault、沒有 commit。

- 沙箱外 `npm run check`（`NODE_OPTIONS` 加 `--test-reporter=dot`）：**exit 0**。型別、整個 repo 的 ESLint、knip、secretlint、skill 副本、文件及全部測試均通過；本輪沒有重現前輪的記憶體中止。
- `node --test --test-reporter=spec tests/state-duplicates.test.ts tests/state-ids.test.ts tests/state-writes.test.ts`：**197 項通過，0 failed／skipped，exit 0**。
- 前輪獨立腳本以 `--test-name-pattern` 重跑 R1 與相鄰正確性案例：七項全過；最初獨立腳本的明選 F1、Session、改名／讀不到：四項全過。兩支舊腳本中斷言「錯誤存在」的影響探針排除，沒有把修正後它們不再成立誤報為產品回歸。
- 本輪 `node --test .local/l2-third-a2333fa/adjacent.test.mjs`：十二項中十項通過、兩項失敗；兩項失敗均為 R2 的同一個跨篇保護缺口，實際 restore 的影響探針則成功確認錯誤寫回。
- 補核對 `.local/r1-limit/limit.test.mjs` 時，整檔第一次執行在 Node 測試程序間訊息解析出現 `Unable to deserialize cloned data due to invalid or unsupported version`，沒有取得兩項限制的結果，未算通過；之後只選 `lost|內容完全` 重跑，兩項完成、輸出與說明一致。這支是診斷腳本，不能將其通過等同安全性斷言通過。

未測：本輪未重跑 Windows Obsidian 的 duplicates／跳轉與截圖、iPhone、實作者的十八種 mutation；依 Claude 回應，修正與審查完成後仍須在要合併的 commit 重跑 Windows duplicates，本輪 Node 證據不替代該步驟。

## Claude 回應 Codex 第三次審查（2026-11-02）

Claude（Opus 5.5）｜R2 同意，自己重跑也重現。原因如你所說：`missing` 看跨篇，`idShared` 只看同一篇。修在 `f1815fc`，先寫會失敗的測試。順著同一個原因往下找，範圍比報告列的大，一起修了：

- **共用不分同篇別篇**：`idShared` 改看這一批之前、之後各篇讀得懂的目標，認人（`match`）和交還原選項用同一個範圍。報告只列了交給新目標；`match` 有同樣的洞，修正前實測：副本在別篇時，改了 A 的題目 `changed` 還留著；同一次把 A 的 ID 拿掉、題目改掉還能還原；同一次改 ID 和題目也能還原；別篇的 B 貼過來取代 A（同一個 ID）時 `changed` 跟著 ID 交給 B。現在都和同篇一樣。
- **之前、之後在這一批開始時算好**：同一批的兩篇不因通知的先後得到不同結果，兩種順序都有測試。
- **認不出來、有未知 ID 的 `changed`，交給新出現的目標時一律要內容相同，不再看有沒有共用**：沒有共用時 ID 也不見了，不見的 ID 加上認不出來的問題已經是兩個證據，本來就不給；只剩一個證據，表示那個 ID 還在別的地方或是刻意拿掉的，這些都說不出新目標和原本的目標有關。這也修掉兩個報告沒列、同一條路徑的洞，修正前實測新目標都拿到 `aaaaaa`：
  - 未知 ID 留在別篇不是目標的一行。
  - 編輯器裡刪掉 `changed` 的目標、寫了無關的目標（`removedInEditor` 把 ID 記成刻意拿掉，所以不算不見）。這條完全不需要共用，比 R2 更容易遇到。
- **需要新版的卡組不算共用**：和重複 ID 看的範圍一樣（任務 §8 第 15 項）。算的話 `changed` 結束、又不列 `duplicate`，家長什麼問題都看不到。未知 ID 留在需要新版的卡組時，上一點照樣擋住無關的新目標（修正前新目標一樣拿到 `aaaaaa`）。
- **和上一輪不同的結果，請判斷**：
  - 跨篇共用時也付 R1 的代價：改了 A 的名稱或任何一題，`changed` 結束，`aaaaaa` 不能從這裡還原，紀錄不動；兩篇的 `duplicate` 留著要家長選。
  - 沒有共用時的一個收緊：編輯器裡把 `changed` 的 ID 拿掉，又同一次改得認不出來，新內容不再拿到還原選項。把 ID 換掉、內容沒變的還可以還原（有對照測試）。
- **留下的限制，請判斷**：
  - 共用已經結束才讀到貼過來的內容：別篇先讀到 B 被剪下，或同一批把別篇整個檔案刪掉（`forget` 在 `observe` 之前），之後讀到 P 裡 A 的位置換成 B（同一個 ID）。這時這個 ID 只有一個目標在用，照 ID 認人，問題落在 B、`restore: aaaaaa`（`.local/r2-limit/limit.test.mjs` 實測）；同一批把別篇清空、檔案還在時則是問題結束。分開讀到的那種要記住「曾經共用」才分得開，會和「共用結束就恢復只靠 ID 認人」衝突（`R2 對照：別篇的副本不在了`）。前提是 A 已有 `changed`、又跨篇剪下貼在 A 上，我判斷不值得加歷史。同一批刪檔的那種加三行就能和清空一致，但分開讀到的還是一樣，所以也沒加；你認為該收就告訴我。
  - 上一輪兩項限制照舊，內容完全相同的副本分不開，你已判斷不阻擋。
  - `lost` 被刪掉＋新增目標：照你的建議列進 [backlog 技術債](../docs/backlog.md#技術債)，含觸發點與完成條件，這次不動。
- **回歸測試**：`tests/state-duplicates.test.ts` 的 `R2` 開頭 21 項，全部在修正前的 `5650dcd` 跑過：13 項失敗，8 項通過。通過的是對照與守住既有行為（A 的 ID 又被改、A 的 ID 被拿掉、選 A 或 B 當成新的、三個對照）。斷言同時包含 C 拿不到 `aaaaaa`、`resolve` 選還原回 `stale`、編輯器文字不變。
- **改壞測試**：把修正改壞 25 種（含 `5650dcd` 只看這一篇的範圍，和只修報告列的那一條）。第一輪 24 種抓到，都是斷言失敗（腳本先跑基準、分辨記憶體當掉）；「認人時之後只看這一篇」沒抓到，補了同一批在別篇新增 B 的 2 項之後抓到。補測試後只重跑了這一種，沒有重跑全部 25 種（只加測試，不會讓前 24 種變成抓不到）。
- **你的腳本**：`.local/l2-third-a2333fa/adjacent.test.mjs` 12 項 11 項通過；`cross-file impact` 失敗是預期的，它斷言那個錯誤的寫回存在。
- **驗證**：`f1815fc` 的 pre-commit 完整 `npm run check` 通過（1044 個測試）。Windows 實機沒有重跑：這個 commit 只改 `src/state/ids.ts` 的判斷，編輯器、按鈕、跳轉的接線沒變。審查通過後，在要合併的 commit 重跑一次 `duplicates`。

請審 `git diff 5650dcd f1815fc -- src tests` 與相鄰案例，例如：三篇以上共用；同一篇和別篇同時有副本；`move` 與 `forget` 和同一批的內容改動；讀不到的卡組（`partial`、`provisional`）之後才讀到副本；需要新版的卡組改成讀得懂時，共用的範圍跟著變；`fill`、`resolve` 當場比對時的 `before`、`after`。只審查、只回報，在這份報告最後追加〈Codex 第四次審查〉一節，不 commit。

## Codex 第四次審查

狀態：待修（2026-11-02）：R2 的直接重現已通過；同批刪檔仍有一項 P2（R3）

### 範圍與結論

分支 `claude/reverent-wing-577df1`，受審 HEAD `eabf8f6b7d3b25215003d9098fa2bf48bf65196a`，開始時工作樹乾淨。依指定範圍檢查 `git diff 5650dcd f1815fc -- src tests`，只改 `src/state/ids.ts` 及 `tests/state-duplicates.test.ts`。修正完整 SHA 為 `f1815fc100d9798fd710bb7a31cc33907e350800`；該 commit 到本輪 HEAD 的 src／tests 沒有差異。以下檔案位置均指這個分支（commit `eabf8f6b7d3b25215003d9098fa2bf48bf65196a`）。

**R2 的直接修正通過**：前輪 C 沒有 ID／有新 ID 的跨篇重現均已不提供原 restore，與同篇及無副本的結果一致；非目標區塊 ID、編輯器刻意拿掉未知 ID 時，新內容也不再因唯一 unmatched 就取得確定還原選項。認人與傳遞 restore 的範圍已擴到可讀的其他卡組，這個方向正確。

**仍需修正 R3**：Claude 主動列出的「同一批整檔刪除」限制不能與分批讀到的限制合併接受。前者仍有這批開始前的已知衝突證據，只是先被 forget 清掉；不需要新增「曾經共用」的長期歷史即可保護。

### R3｜P2｜規格：同一批先 forget 副本，會讓 before 漏掉已知衝突，還原選項轉給另一個目標

**證據：已重現，兩種通知順序皆失敗，包含實際 restore 寫回。建議：合併前修正。**

**依據**：任務 §3-2 明訂「這一批之前或之後」共用時，只有名稱與題目都沒變才延續 changed；D-134 要求還原選項有原 ID 的充分證據。這項是對 Claude 明列限制中「同一批刪檔」的審查判斷，不宣稱是本輪才首次存在的錯誤。

**重現**：

1. 載入 P.md 的 `- A ^aaaaaa`，子題 `A題 :: A答案`。
2. 外部把 A 的 ID 改成 `bbbbbb`，等重讀，A 有 changed，可還原 `aaaaaa`。
3. Q.md 新增 `- B ^bbbbbb`，子題 `B題 :: B答案`，等重讀。state 已知 A、B 衝突，A 同時有 changed。
4. **同一批**把 P.md 改成 B 的上述文字，並把 Q.md 整個刪掉；兩個變動一起通知 state。分別以 P→Q、Q→P 的順序執行。

**預期**：這一批之前 `bbbbbb` 有兩個已知目標，P 現在的 B 與原 A 的名稱、題目都不同，不應讓 B 取得 A 的 `restore: aaaaaa`。至少要與同批把 Q.md 清空的既有測試一致。

**實際**：兩種順序都留下：

```json
{"name":"B","kind":"changed","restore":"aaaaaa"}
```

對該問題呼叫 `resolve(issue, 'restore', editor)`，實際回 `done`，P.md 真的寫成：

```markdown
- B ^aaaaaa
    - B題 :: B答案
```

因此是另一個不同內容的目標能承接 A 的歷史 ID，不只是問題多留一列。相同批次若保留 Q.md、把它的內容改成空字串，兩種通知順序都正確地結束 changed，不提供還原選項。

**位置與原因**：`src/state/index.ts:333` 在這一批迴圈先呼叫 `tracker.forget(Q)`，`:338` 才呼叫 observe。`src/state/ids.ts:298` 已從 versions 刪掉 Q；`:175` 才取的 before 因此只有 P 的 A，`:176` 的 after 只有 P 的 B。shared 誤判為 false，`:153`～`:155` 又依相同未知 ID 延續 pending，替 B 保留 `aaaaaa`。

**建議修正範圍**：讓 shared 的 before 真正保留這一批刪除前的可讀目標集合；after 及既有 missing 判斷仍照刪除後的占用。補「同批清空／同批刪檔」及兩種通知順序的公開介面對照，斷言 B 拿不到 `aaaaaa`、也不能以 restore 寫成該 ID。這只需要保存批次內原有證據，不要求保留跨批次共用歷史，也不要求重新判斷哪個是歷史原件。

**證據位置**：`.local/l2-fourth-eabf8f6/adjacent.test.mjs` 中兩項 `same-batch copy disappears by delete` 的正確性斷言失敗；兩項 empty 對照通過；`same-batch delete impact: B actually restores A historical ID` 確認錯誤寫回。資料全是合成文字及記憶體 Files／Editor。

### 其餘相鄰案例與限制的判斷

| 項目 | 本輪獨立核對 |
|---|---|
| 三篇以上共用、同篇和別篇同時有副本 | 三篇共用後刪掉其中一份、另改 A 的內容，仍有其他副本留住 before 證據，changed 結束；同篇加跨篇合計三份時亦正確，duplicate 保留。通過。 |
| move 與同批內容變動 | Q.md 同批搬到 M/Q.md 並改 B，P 的 A 也改內容；move 後前後集合仍含兩份，兩邊衝突保留、A 不取得錯誤 restore。通過。forget 的差異另列 R3。 |
| partial／provisional，副本晚到 | Q 初次讀不到，P 的 changed 是 provisional；同批恢復 Q、修改 P，after 已包括晚到副本，changed 結束、兩篇 duplicate 保留、unread 清空。通過。 |
| 需要新版改成讀得懂 | Q 原本需要新版，不計入 shared；同批改成可讀並改 P 的內容後，shared 與 duplicate 範圍一起擴大，changed 結束。再把 Q 改為需要新版，衝突解除，原版本閘門仍阻止作答。通過。 |
| fill／save／resolve 的最新文字 | 只改編輯器或 modify 拿到的原文、state 尚未重讀時，三個入口都用全庫前後集合處理最新內容；P 的 changed 結束、duplicate 保留；舊物件回 stale，不寫錯 ID。三種通過。 |
| 無共用時，刻意拿掉未知 ID 又改成無關內容的收緊 | 同內容才傳原 restore 的新限制符合 D-134，不需要再以是否共用作前提；無關新內容不應因未知 ID 被刻意拿掉就取得原進度。新增產品測試及整合測試通過，沒有發現與一般 lost 的既有規則混用。 |
| 分批先讀到副本消失，後讀到 P 換成 B | 核對 `.local/r2-limit/limit.test.mjs`，此時確實已在上一批解除共用，再按單一未知 ID 延續 pending。接受本輪不新增跨批次「曾經共用」狀態的範圍選擇；保留這個已明示風險，不宣稱能辨識這種跨篇取代。它不能作為 R3 不保留同批已知證據的理由。 |
| 完全相同的副本、一般 lost 的既有再掛接 | 維持前輪判斷；lost 的技術債已實際列入 backlog，具觸發點與完成條件，本輪沒有改它。 |

### 驗證與權限

環境：Windows PowerShell、Node `v24.13.0`。只追加本節，未改產品程式、既有測試、任務狀態或 backlog；沒有 commit、沒有接真正 vault。獨立腳本與輸出留在 git ignore 的 `.local/l2-fourth-eabf8f6/`。

- 本輪獨立腳本 `node --test .local/l2-fourth-eabf8f6/adjacent.test.mjs`：十三項中十一項通過、兩項失敗；兩項失敗為 R3 的同一缺口、兩種通知順序，影響探針另已確認 restore 真的能寫成。
- 前輪 `.local/l2-third-a2333fa/adjacent.test.mjs` 排除 `cross-file impact` 後重跑十一項正確性與相鄰案例，全部通過；排除者是斷言舊錯誤存在的影響探針，不是修正後必須繼續通過的正確性測試。
- `node --test --test-reporter=spec tests/state-duplicates.test.ts tests/state-ids.test.ts tests/state-writes.test.ts tests/state-version.test.ts`：228 項通過，0 failed／skipped，exit 0。
- 沙箱外 `npm run check`（`NODE_OPTIONS` 加 `--test-reporter=dot`）：exit 0；型別、整個 repo 的 ESLint、knip、secretlint、skill 副本、文件及全部測試通過。追加報告後另跑 `node tools/check-docs.ts` 與 `git diff --check`，均通過。
- `.local/r2-limit/limit.test.mjs` 三項診斷輸出均與 Claude 說明一致；該腳本沒有正確性斷言，不能用它的 exit 0 將同批刪檔記成安全性通過。本輪對 R3 的判定另以自己的失敗斷言及寫回驗證為準。

未測：本輪未重跑 Windows Obsidian 的 duplicates／跳轉與截圖、iPhone，以及實作者的二十五種 mutation；修正與審查完成後，在要合併的 commit 重跑 Windows duplicates 的步驟仍保留。

## Claude 回應 Codex 第四次審查（2026-11-02）

Claude（Opus 5.5）｜R3 同意，自己重跑也重現。我上一輪把「同一批刪檔」和「分批讀到」併成同一個限制是錯的：前者在這一批開始時證據還在，只是先被 `forget` 清掉。修在 `bf548db`，只修這一點，先寫會失敗的測試。

- **修正**：`forget` 把那一篇的 `Deck` 留著，接著的那次 `observe` 算「這一批之前」時一起算，算完就清掉。`after` 和 `missing` 照舊看刪除後的。只留這一批，不記跨批的歷史；分批讀到的限制你已接受，沒有動。
- **不會留到下一批**：`forget` 只有 `src/state/index.ts:333` 一個呼叫點，同一個函式的 `:338` 一定接著 `observe`，`changed` 是空的也一樣。改名時 `move` 已經把舊路徑搬走，之後對舊路徑的 `forget` 拿不到 `Deck`，不會重複算。
- **回歸測試**：`tests/state-duplicates.test.ts` 的 `R3` 開頭 6 項。修正前失敗 4 項（B 搬來取代 A、改了 A 的題目，各兩種通知順序）；通過 2 項是對照（A 只拿掉 ID、內容沒變，還可以還原寫回 A；需要新版的卡組同一批刪掉，本來就不算共用）。斷言包含問題清單是空的、衝突是空的、舊物件 `resolve` 回 `stale`、編輯器文字不變。
- **改壞測試**：29 種全部重跑，全部抓到，都是斷言失敗（腳本先跑基準、分辨記憶體當掉），補上上一輪只重跑一種的缺口。新增的有：刪掉的不記（`f1815fc` 的範圍）、刪掉的之前不算、刪掉的一直記著（跨批的歷史）、刪掉的不看需要新版。
- **你的腳本**：`.local/l2-fourth-eabf8f6/adjacent.test.mjs` 13 項 12 項通過；`same-batch delete impact` 失敗是預期的，它斷言那個錯誤的寫回存在。
- **驗證**：`bf548db` 的 pre-commit 完整 `npm run check` 通過（1050 個測試）。Windows 實機沒有重跑：這個 commit 只改 `src/state/ids.ts` 的判斷，接線沒變。審查通過後，在要合併的 commit 重跑一次 `duplicates`。

**另一個方向，請表示意見**：我上一輪告訴使用者，第四次還有同類問題就建議換更簡單的規則：這個未知 ID 一共用就直接結束 `changed`，只留 `duplicate` 讓家長選，不再判斷內容像不像。

- **換的好處**：`idShared`、`sameContent`、`left`、`before`、`after`、`forgotten` 大多可以拿掉，這一區的判斷少一大半，R1、R2 的認人部分、R3 都不會發生。「認不出來、有未知 ID 的 `changed` 交給新目標要內容相同」那一條還是要留，因為編輯器刻意拿掉 ID 的情況不需要共用。
- **換的代價**：共用可能只是暫時（家長貼上又復原），`changed` 一結束就回不來，舊進度不能再從小視窗還原；讀到 Q 時要去結束 P 的問題，是新的路徑（物件身分、`revision`、`provisional`）；任務 §8 第 17 項要改，要使用者同意；F1、R1、R2、R3 裡有幾十項測試要翻，要再審一輪。
- **我的判斷是不換**：這一輪的 R3 是我自己列出的限制，其他相鄰案例你都核對通過，看起來已經收斂；換規則的省事要付新路徑和再審的成本，而這個情況本身很少見（ID 被外部改掉、問題還沒處理，又有人複製了這個目標）。

請審 `git diff eabf8f6 bf548db -- src tests`，範圍很小，重點是 `forgotten` 的生命週期。也請回答：`changed`＋共用這一區，你認為還有沒有同類的缺口；上面兩個方向你選哪一個、為什麼。只審查、只回報，在這份報告最後追加〈Codex 第五次審查〉一節，不 commit。

## Codex 第五次審查

狀態：本輪審查通過（2026-11-02）：R3 已修，未發現新的阻擋項目；要合併的 commit 仍須重跑 Windows duplicates

### 範圍與結論

受審分支 `claude/reverent-wing-577df1`，HEAD `17de0cd2375db60f1031e7d97422bf019f4b51c2`，開始時工作樹乾淨。本輪依指定範圍檢查 `git diff eabf8f6 bf548db -- src tests`：產品修正只新增刪除前 Deck 的暫存、併入 before 後清空；另加六項 R3 回歸測試。修正完整 SHA 為 `bf548db2209d20e282e55c6476f9fe41055fffda`；該 commit 到受審 HEAD 的 src／tests 沒有差異。以下檔案位置均指這個分支（commit `17de0cd2375db60f1031e7d97422bf019f4b51c2`）。

**R3 通過**：同一批刪掉副本、把另一篇的 A 換成不同內容 B，兩種通知順序均不再把 A 的 restore 交給 B，與清空副本檔的結果一致。前輪十二項正確性及相鄰案例全數通過；斷言錯誤存在的影響探針已排除，沒有要求它在修正後繼續成立。

**有沒有其他同類缺口**：在本輪的刪除生命週期、既有明確限制及前幾輪重現範圍內，沒有再找到可重現的同類缺口。這是對受審版本與已驗案例的結論，不能外推為所有未來寫入端或所有編輯歷程都已驗證。

### forgotten 的生命週期

| 核對項目 | 證據與結果 |
|---|---|
| 只保存這批刪除前的目標 | `src/state/ids.ts:299` 的 forget 只在版本存在時把 Deck 放入 forgotten，再移除 versions／present；`:177` 將它加入 before，`:178` 立即清空。`:179` 的 after 仍從刪除後的 versions 加新 entries 算，未把刪掉的卡組放回現況。 |
| 只有刪除通知、changed 為空時也消耗 | `src/state/index.ts:333` 的 forget 之後，`:338` 無條件呼叫 observe，兩者之間沒有 await。獨立測試刪一份及兩份副本、這批完全不修改 P；下一批才改 P 的內容，仍依單一未知 ID 延續 changed，沒有被舊 forgotten 誤判為共用。兩種通過。 |
| 多份刪除都算 before，但不留在現況 | 同一批刪 Q、R 兩份副本並改 P，原 changed 結束；conflicts 空、decks 只剩 P，舊物件 resolve 回 stale、不改編輯器。通過。 |
| move 不重複計數 | move 先把版本搬到新路徑，之後舊路徑 forget 拿不到 Deck。獨立測試把唯一的 changed 目標同批改名及改內容，仍可還原，證明沒有多算自己造成假共用；另測搬副本並換它的 ID、同批改來源內容，before 仍正確算到那份舊副本。兩種通過。 |
| 需要新版的刪除檔不算共用 | forgotten 與現存 Deck 一起經過 readableTargets。先建立 changed，再加入需要新版的副本、同批刪它與改 P，changed 正確保留；下一批再改 P 也沒有殘留影響。通過。 |
| 部分讀取失敗不延長保存 | 同批刪 Q、改 P、令無關 U 讀不到，P 的問題已正確結束；U 恢復重讀後不復活問題，unread 清空。通過。讀不到的副本本身仍依既有規則保留上一版，不當成刪除。 |

靜態核對目前唯一的 tracker.forget 呼叫點確實在上述 batch，並且緊接 observe；寫回核對在 `src/state/index.ts:314`、改名配對在 `:324`，均早於 forget 迴圈，沒有在 forgotten 寫入後插入另一個寫回 observe、提早消耗這批資料的路徑。將來若新增 forget 的呼叫端，須一併守住「同批接 observe」這個呼叫順序契約；本輪沒有要求新增抽象或公開出口。

### 兩個方向的選擇

**我選保留現行規則，現在不改成「未知 ID 一共用就直接結束 changed」。** 這是審查建議，沒有替使用者修改規格或建立新決定。

保留現行規則可維持已確認的能力：同一目標的名稱與題目沒變時，短暫共用、移除副本或明選另一份為新目標後，仍可從小視窗還原原 ID。最新的 R3 是批次邊界少保留一份既知證據，這次的短暫 Deck 保存已補上；獨立測試沒有顯示它會變成跨批歷史，也沒有發現後續同類失敗需要靠換規格才能處理。

改用「一共用就結束」確實能刪去一部分認人與批次前後判斷，但會不可逆地拿掉上述還原機會；即使家長只貼上又復原，也得承擔這個代價。實作還要在讀到 Q 時結束 P 的 pending，重新驗證物件身分、revision、provisional 與取消／明選等路徑，並翻轉原本的驗收。一般 unknown-ID unmatched 傳遞 restore 的保護仍須保留，不能把換規格估成整段保護都能刪掉。

和維持目前已驗證版本相比，現在更換要付規格重新確認、跨篇 pending 新變動路徑與整套再審的成本，卻沒有本輪新增阻擋項目作為必須更換的理由。因此建議完成原訂實機收尾。若以後新增多檔寫入端或再次重構這一區，再依實際成本與新例子評估簡化，不僅因審查輪數決定改產品行為。

已明示的邊界維持前輪判斷：跨批先看到共用解除、之後才看到不同內容取代，以及名稱與全部題目完全相同的副本，未新增歷史身分辨識；一般 lost 再掛接的限制已另列 backlog。這些限制不宣稱已修，也沒有在本輪擴大。

### 實際驗證與權限

環境：Windows PowerShell、Node `v24.13.0`。只追加本節；未改產品程式、既有測試、任務狀態或 backlog，沒有 commit、沒有接真正 vault。隔離腳本與結果留在 git ignore 的 `.local/l2-fifth-17de0cd/`。

- `node --test .local/l2-fifth-17de0cd/lifecycle.test.mjs`：八項全過，涵蓋上述 forgotten 生命週期及分批行為對照。初次需要新版對照的前置資料誤把 `bbbbbb` 放在首次載入的 Q，導致 A 根本不產生 changed；修正為先建立 changed 再加入 Q 後通過，沒有把該次前置條件錯誤列為產品發現。
- 前輪 `.local/l2-fourth-eabf8f6/adjacent.test.mjs` 以 `--test-name-pattern="same-batch copy|three files|same-file plus|unread copy|gate becomes|copy moved|editor/modify"` 執行：十二項全過，包含 R3 兩種通知順序、清空對照、跨篇／同篇混合、晚到副本、版本閘門及最新編輯器文字。僅排除斷言舊錯誤存在的 `same-batch delete impact`。
- `node --test --test-reporter=spec tests/state-duplicates.test.ts tests/state-ids.test.ts tests/state-writes.test.ts tests/state-version.test.ts`：234 項通過，0 failed／skipped，exit 0。
- 沙箱外 `npm run check`（`NODE_OPTIONS` 加 `--test-reporter=dot`）：exit 0；型別、整個 repo 的 ESLint、knip、secretlint、skill 副本、文件及全部測試通過。追加報告後另跑 `node tools/check-docs.ts`、`git diff --check`，均通過。

未測：本輪未重跑 Windows Obsidian 的 duplicates／跳轉與截圖、iPhone，以及實作者的二十九種 mutation；Windows duplicates 仍須在要合併的 commit 重跑，本輪審查通過不代替該項實機收尾，也不代表已合併或發布。

## Claude 回應 Codex 第五次審查（2026-11-02）

Claude（Opus 5.5）｜核對：`.local/l2-fifth-17de0cd/lifecycle.test.mjs` 自己重跑 8 項全過。Claude 和 Codex 都建議保留現行規則，不改成「ID 一共用就結束 `changed`」；這是兩邊的建議，不是使用者的決定，也不新增 D-ID。

你提的呼叫順序契約（新增 `forget` 的呼叫端要同批接 `observe`）已經寫在 `src/state/ids.ts` 的註解裡（「`forget`、`move` 之後一定接著 `observe`」），不另外做。

接下來把 `main` 合進這條分支，在合好的 commit 跑完整檢查和 Windows `duplicates`；合併進 `main` 與要不要升版由使用者決定。
