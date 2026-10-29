# `state` 的讀寫先後與寫入協調：Codex L2 獨立審查

狀態：已結案：L2 第二次再審通過（審查 `6833097`，結論在最後〈第二次再審〉），已合併進 `main`（`70ba562`）

## 結論與審查基準

這批把寫入集中、先讀待讀、準備與採用分開的方向成立。沙箱外的 `npm run check` 通過，595 項測試全過；另用公開介面重現兩個生命週期漏洞，以及一個小視窗等待狀態的漏洞。先由 Claude 核對、修正並補回歸測試，再對修正的 commit 再審。

- 審查 worktree：`D:\程式開發\Essence Cards\.claude\worktrees\quizzical-euclid-f0564e`，分支 `claude/hungry-yonath-106fcb`，HEAD `d33c01351d214a1d601eae0a57c4282f1ac5d5ee`；審查前後沒有未提交修改。
- 實作差異：`git diff c4cbb14 cd03533 -- src tests`；也核對到 `d33c013`。`cd03533` 到 HEAD 的 `src/`、`tests/` 淨差異為零；共同祖先為 `d39cf6593b97a69128927c3a5569d260e2d4971c`。`c4cbb14` 的 CI 修正照請求排除。
- 規格：分支 `claude/hungry-yonath-106fcb` 的 `tasks/state-writes.md`、`tasks/state-writes-review.md`（`d33c013`），及其指定的環節 4、D-134、state-load §3、W5 §8-5／§8-6、A11／A12。本文後續的程式位置與分支新增檔案均指該分支的 `d33c013`，不是 `main` 上同名檔案。
- 報告寫在本次 Codex 工作目錄 `D:\程式開發\Essence Cards`。只新增本報告；沒有修改產品程式、既有測試、測試 vault，沒有 commit、安裝或重載外掛。

## 發現（依嚴重程度）

### R1 — P2｜逾時後才執行的 `modify` 回呼會重建已刪除的空筆記

**軸：規格。證據：已重現（Node、記憶體 Files）；Obsidian adapter 的影響為靜態核對。建議：合併前修，補自動回歸測試。**

- 觸發：第一次 `fillIds(P)` 已寫檔但 `modify` 延遲完成，等到逾時；第二次同路徑的 `fillIds(P)` 排在 Files 的佇列後，也逾時。之後刪掉 P、`close()`，最後放行第一次 `modify`。
- 預期：失效的第二份工作不能建立檔案；P 維持不存在。依據是任務 §1 的「不存在時不建立」、§3 逾時後不再執行這份工作的變更。
- 實際：兩次都已 reject，`close()` 也已完成，但 P 被重建，內容為空字串。探針輸出：`{"timeouts":2,"exists":true,"disk":""}`。
- 原因：`src/state/index.ts:522–525` 的 `if (!live) return text` 位於空字串的中止檢查之前。檔案不存在時，回呼收到 `''`；回傳 `''` 不代表取消。`Files.modify` 的契約是不存在就建立，記憶體版、Node 版與 `src/obsidian/files.ts` 的 `create(path, edit(''))` 都如此。
- 影響：已失敗、甚至外掛已關閉的工作，仍可把刪掉或改名後的舊路徑建立成空卡組。這不是 V6 已知的外部寫入覆蓋限制，也不需要修改 A2。
- 處理：失效回呼要真正中止 `modify`，包含不存在的路徑；不能以「回傳原文」代替取消。測試至少涵蓋兩次同路徑逾時、刪除／改名、關閉後才放行，以及原檔仍存在時不改字。

### R2 — P2｜準備期間同步呼叫 `close()`，會漏等接著開始的保存

**軸：規格。證據：已重現（公開 `onChange`、`save`、`close`）；沒有宣稱目前畫面必然會同步關閉 state。建議：合併前修，補重入測試。**

- 觸發：編輯器比 tracker 新，例如原文多一個空行；`save()` 的 `prepare → track → adopt → replan` 同步通知 `onChange`，監聽者在回呼內呼叫 `state.close()`。此時再把編輯器的 `persist` 暫停。
- 預期：若尚未套用就停下，不再改編輯器或保存；若視為已進入 I/O，`close()` 必須等這份保存完成或逾時。任務 §5 的兩種分類都不能回報關閉完成卻留下未決保存。
- 實際：`close()` 已 resolve，保存仍停在半路；編輯器已交易一次、`persist` 已呼叫一次。放行後才真的寫檔，工作回 `saved`。觀察值為 `closeResolvedBeforePersist: true, applies: 1, persists: 1`。
- 位置：`src/state/index.ts:494–497` 在準備途中通知外部回呼；`:559–567` 接著繼續 apply／persist；`:475–483` 到呼叫保存時才設定 `active`，而 `:641` 的 `await active` 已經讀到先前的 `null`。
- 影響：`close()` 的完成訊號與實際寫入生命週期不一致，主機可能已卸載或建立新 state，舊 state 卻仍開始／等待保存。單純確認「最後檢查到 apply 沒有 await」擋不住同步回呼的重入。
- 處理：讓關閉能看見整份已開始工作的生命週期，或在會通知外部回呼的準備之後重新檢查並中止；也核對 `fillIds` 的準備通知。不要只多測 microtask，應測 `onChange` 同步關閉，及監聽者丟錯、`onError` 再關閉的相鄰路徑。

### R3 — P3｜小視窗等待中的停用狀態會被重畫清掉

**軸：規格。證據：已重現（真正的 `wireSave`，Node 的 Modal／元素替身）；未做 Windows 畫面重現。建議：本輪一併修並補接線測試。**

- 觸發：按小視窗的還原／當成新的，`state.resolve()` 還沒回來；這段時間其他卡組或外部紀錄更新，發出 `onChange`。
- 預期：依任務 §7，結果回來前兩個按鈕持續停用。
- 實際：`choose()` 只停用現有 DOM；`onChange → render()` 清空內容並建立新按鈕，新按鈕恢復可按。探針在未結束 resolve 的情況下得到 `disabledBefore: true, disabledAfter: false, buttons: 2`。
- 位置：`src/obsidian/save.ts:89` 訂閱重畫，`:98–105` 重建按鈕，`:111–113` 只停用當下元素。
- 影響：家長可在第一個選擇尚未完成時又排入另一個選擇。state 的串行與 issue 驗證仍能阻擋過期的第二份寫回，因此這裡沒有重現進度誤接；但會產生多餘工作與誤導的「剛剛改過」提示。
- 處理：把等待狀態保留在小視窗本身，重畫時繼續停用，處理 click 的入口也檢查；測試在等待中送一次與多次 `onChange`，直到成功／失敗才解除。若延後，請記技術債：最晚在學生正式日用前處理，完成條件就是這組接線測試通過。

## R1、R2 的最小重現

在待審 worktree，以 Node 24 的 `node --input-type=module` 從標準輸入執行以下程式；只用記憶體資料。`holdModify` 是分支 `claude/hungry-yonath-106fcb` 的 `tests/helpers/memory-files.ts`（`d33c013`）既有的測試開關。

```js
import { createState } from './src/state/index.ts';
import { createMemoryFiles } from './tests/helpers/memory-files.ts';
import { createMemoryEditor } from './tests/helpers/editor.ts';

const P = 'Essence Cards/P.md';
const C = '- 能說明 C\n    - QC :: AC\n';
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
};

// R1：第二次 modify 的回呼，在兩份工作都逾時、刪檔及關閉後才執行。
{
  const m = createMemoryFiles({ [P]: C });
  const s = createState({ files: m.files, device: 'PC-review',
    fillIds: true, random: () => 0, writeTimeout: 20 });
  await s.ready();
  const held = m.holdModify(P);
  let timeouts = 0;
  for (let i = 0; i < 2; i++) {
    try { await s.fillIds(P); } catch { timeouts++; }
  }
  m.remove(P);
  await s.close();
  held.release();
  await flush();
  console.log({ timeouts, exists: m.texts.has(P), disk: m.texts.get(P) });
  // 實際：{ timeouts: 2, exists: true, disk: '' }
}

// R2：準備時的通知同步 close；close 必須中止或等保存，不能先完成。
{
  const m = createMemoryFiles({ [P]: C });
  const s = createState({ files: m.files, device: 'PC-review',
    fillIds: true, random: () => 0 });
  await s.ready();
  let closing, closed = false;
  s.onChange(() => { closing = s.close().then(() => { closed = true; }); });
  const e = createMemoryEditor(m, P, C + '\n');
  const held = e.hold();
  const saving = s.save(e);
  await held.started;
  await flush();
  console.log({ closeResolvedBeforePersist: closed,
    applies: e.applies, persists: e.persists });
  // 實際：{ closeResolvedBeforePersist: true, applies: 1, persists: 1 }
  held.release();
  await saving;
  await closing;
}
```

R3 的重現方式：沿用 `tests/save-wiring.test.ts` 的 esbuild 載入方式載入 `wireSave`；Modal 替身的 `open()` 呼叫 `onOpen()`，元素替身支援 `empty`、`createDiv`、`createEl`、事件與 `querySelectorAll('button')`。讓 `save()` 回 `unchanged` 且 `deckStatus()` 回同一個 lost issue，以開啟小視窗；讓 `resolve()` 回未完成的 Promise，按還原後檢查按鈕皆停用，再呼叫註冊的 `onChange`。新建的兩個按鈕皆未停用。這個探針沒有修改 repo 的替身或另加產品出口。

## 「請特別看」逐點結論

| # | 結論與證據 |
|---|---|
| 1 所有改卡組入口共用排隊與門檻 | 靜態核對成立：`save`／`resolve` 經 `enqueue → edit`，`fillIds` 經 `enqueue → fillFile`；`writable` 集中手機、loading、closed、unread 與路徑條件。tracker 的輸出採用只在核對分支，`removedInEditor`／`restoredInEditor` 保持原約定。R1、R2 是進入後的失效／關閉漏洞，不是漏排某個入口。 |
| 2 最後檢查到 apply 沒有 await | `edit` 在 `await admit()` 後確實同步重查，接著到 `begin`、取文字、plan、apply 沒有 await；`fillFile` 在 modify 回呼重查。`cd03533` 修掉的 microtask 窗口有測試。但 plan 會同步通知外部，仍有 R2；「沒有 await」不能單獨當成不可重入的證明。 |
| 3 三種核對結果與延後記錄 | `read` 的相同輸出／預期仍在才 `record → wrote → done`；不成立回 stale，null 回 stale，reject 回 saved 並保留核對。既有 S18 與本輪「當成新的 saved → 再選還原被 unread 擋住 → 恢復後解除問題」探針成立。另測第一份核對讀取卡住時，同篇第二份存檔確實等待，之後回 unchanged。 |
| 4 null、讀不到、改名不誤寫別篇 | 正常核對路徑成立；EditorHandle 固定 path，`issue.path` 已搬走時不準備，null 不跟 A2 配對。另測 saved 後改名、恢復讀取，舊 P 不重建，Q 保留已存的 ID。例外是 R1：逾時的 modify 在核對之外重建空的舊路徑。 |
| 5 關閉、逾時後無殘留採用／通知／讀取 | 一般 S24／S28 與本輪「普通讀取卡住再 close」成立，放行後不通知；晚到 persist 不走原工作採用。不能整項判通過：R1 有實體建檔，R2 有未被 close 等候的保存。 |
| 6 ids.ts 的原文觀察與同篇檢查 | 保留：`fill` 先 observe 原文再 reserve；`resolve` 同樣先觀察，還原仍檢查 `elsewhere` 與 `presentOf(bare, parseDeck(bare))`。新配 ID 立即加入 seen，resolve 的解除問題／removed／還原 seen 延到 record。既有同篇佔用與 I5／I6／F1 測試通過。 |
| 7 既有測試的預期 | 已看指定 diff：`state-ids.test.ts` 的既有斷言值沒有改，只加 await、換 helper；`review-session.test.ts` 的舊斷言未改，另加 S25 與可指定開始時間的 helper。沒有把舊失敗預期放寬以求通過。 |
| 8 重查不重設輪數、有限退出 | `rounds` 在兩個入口都跨迴圈保留。S22 與交接版測試通過；本輪另在每次 modify 回呼前送別篇的新通知，3 次回呼後因共用輪數用盡退出、沒有寫 P。此處上限包含重讀與重來，不應要求一定呼叫 5 次 modify。 |
| 9 V5 換篇的驗收落差 | Windows 那次只證明「存檔先完成、另一篇未被改」，不證明等待中換篇的 stale 路徑。先完成是合法時序，不應事後硬發 stale。本輪以真正 `wireSave + createState` 補 Node 整合：先卡住待讀，再按存檔、把 view 換到 Q，放行後只提示 `TIPS.stale`、`view.save()` 呼叫 0 次、P／Q 都未被寫。可接受目前的安全性證據，但 Windows 的等待中換篇仍列未驗；下次 Windows 回歸應刻意讓存檔排隊後換篇，再把 V5 寫成完整驗證。 |

## Claude 自選做法逐點回覆

| # | 回覆 |
|---|---|
| 1 admit 先處理不必讀的情況 | 同意。手機、未 ready、已關閉與非卡組不會因先讀一次而變成可寫；unread 仍先處理已知待讀。沒有放寬 ID 完整性門檻。 |
| 2 不取消 500 ms 計時 | 同意。pending 在開始讀取時移除；舊計時到期只會讀空集合或處理後來的新通知。busy 篇會留在 pending，由 end 立即喚起，沒有忙碌時自我重排的計時空轉。 |
| 3 rounds 跨重來累計 | 同意，且本輪另外驗到 modify 回呼重來也會有限退出；不應重設累計。 |
| 4 fillIds 的結果對應 | 同意。done／saved 有改字才 true，其餘 false；failed／逾時維持 reject，符合既有 leave 的錯誤接線與限制 3。R1 要修的是晚到回呼的實體副作用，並非改這個對應。 |
| 5 沒改字不回 saved | 同意，避免把 no-op 誤當成補過 ID。建議整合時也把任務 §4 的 reject 分支與 §5 的關閉結果補上這個例外；目前例外只集中寫在審查請求與程式，主規格那兩句仍是未區分的 saved。 |
| 6 issue 已搬到其他 path 就不準備 | 同意。固定的 editor.path 不能取得已跟改名搬走之問題的授權；persist 與核對後回 stale，沒有把舊選擇接到另一篇。 |
| 7 cd03533 的同步重查 | 同意這個修正，指定的交接測試確實保護 await 間隙。還需 R2 的同步重入保護，兩者不是互相取代。 |
| 8 編輯器替身與相容 helper | 同意作為 Node 的受控替身與既有斷言的搬接；沒有為測試新增產品出口。但「view.save 無變更時不寫」仍是未單獨驗過的主機假設，不能因替身這樣做就視為實機證據。既有 Windows V1 與 V7 能支持成功保存與失敗恢復，沒有額外證明 no-op 的寫入次數。 |
| 9 commit 切法的偏差 | 同意。替身併第一次使用、非同步接線測試隨介面一起改，以及兩個討論後修正各一個 commit，都有具體依賴理由；V6 實驗命令已 revert，最終差異不含那兩個命令。 |
| 10 不加存檔中 | 同意。兩次 V1 為 33／24 ms，沒有碰到 §7 的 500 ms 提出門檻。R3 只需保住既有小視窗的等待停用，不要求新增畫面狀態。 |

## 驗證紀錄與實機證據的界線

- 環境：Windows、Node `v24.13.0`、npm `11.6.2`；沿用 worktree 已裝好的相依，沒有重跑 `npm ci`。
- 對 `d33c013` 在**沙箱外**執行 `npm run check`，exit 0；typecheck、ESLint、knip、secretlint、skill 副本、文件與 595 項測試通過，0 失敗、0 skipped。測試階段約 69.4 秒；包含既有建置相關測試，沒有再為本報告重複整套檢查。
- 另外以 stdin 執行公開介面探針：R1、R2 已重現；6 組相鄰案例成立（核對未回來時的同篇排隊、當新 saved 後再選還原、同 issue 連排還原與當新、saved 後改名、讀取途中 close、modify 回呼持續通知的有限退出）；另做 V5 的 `wireSave + state` 整合及 R3 的小視窗替身探針。探針只用記憶體資料，沒有把它們加入產品測試或更改既有測試。
- Windows 結果是**讀取 Claude 已留下的檔案**，本輪沒有重跑 Obsidian 命令。`save-flow Windows-c50c 2026-10-29 104901.json` 的 V1 磁碟＝編輯器、一次提示、24 ms；V2 在自動存檔後 15 ms 按下、3 秒未見 issue；V3 一組 ID／一次提示；V4 兩編輯器與磁碟相同；V5 如前述；V7 唯讀時失敗提示、恢復後磁碟與編輯器相同。`cleanupLeft` 為空。
- 同目錄的 `save … 104818.json` 17 項 checks 皆 true；`lock … 132302.json` 50 passed／0 failed；`a3check … 132537.json` C1～C11 皆 ok、failed 空、cleanupLeft 空。**a3check 仍有兩個 skipped 子項**：C8 版面切換時才出現的 deferred 分頁、C10 畫布裡打字；與 `013359` 那次相同，不把它們寫成已測通過。
- 測試 vault 目前安裝的 `main.js` 可抽出 `0.0.1+cd03533`，其產品程式與 `d33c013` 相同；但歷史 JSON 的 plugin 仍只記 `0.0.1`。因此歷史結果與 commit 的綁定仍部分依賴實作者紀錄，不能由現在的 bundle 反證每份歷史結果當時的建置。這個限制已在分支 backlog 的 BUILD 項目記錄，沒有當成本輪新缺陷重複提出。
- V6 最新結果仍是 `wait 0/50/200 → B 保留 false/true/true`；任務 S14、V6、測試註解與 backlog 一致，都說尚未另加保護、實際風險增量未量測。沒有新證據推翻既有取捨，本輪不重開 V6，也不把它算成通過的防覆寫測試。
- `src/main.ts`、`src/core/` 沒有改；未改資料格式、未加套件；原樣拆檔、多檔預留、設定／範圍重排仍是原來延後的工作。原樣拆檔的觸發點是合併後，不能把它當成本次 L2 前置條件。

沒測的項目與原因：未在 Windows Obsidian 重新執行命令或直接重現 R1～R3、未驗 Windows「刻意等待後換篇」、未驗 no-op view.save 的實際寫入次數；本輪只讀既有實機結果並以 Node 隔離探針查核。未測 iPhone／跨裝置 iCloud 實機，因任務 §9 明列本批不需 iPhone，現有結果也不足以證明新的同步碰撞時序；未測明確延後的多檔與跨重啟工作。

## Claude 核對（2026-10-29）

狀態：三項都同意、都已重現，各一個 commit 修正並補回歸測試；`npm run check` 602 項通過（595 加這次的 7 項）。待再審。

| 發現 | 核對 | 修正 | 回歸測試 |
|---|---|---|---|
| R1 | 用報告的程式重現：`{ timeouts: 2, exists: true, disk: '' }`。原因同報告；另外核對了三個 `Files` 實作：記憶體版、`tools/node-files.ts`（`old ?? ''` 和 `''` 不同就寫）、`src/obsidian/files.ts`（`create(path, edit(''))`）在檔案不存在時都會建立空檔，回呼丟錯時都在寫之前中止 | `6318645`：逾時之後才輪到的回呼丟 `Stopped`（R2 時從 `Ended` 改名），中止 modify | `tests/state-writes.test.ts` 的「L2 R1」三則（刪掉、改名、留著）。刪掉、改名在舊程式失敗；留著兩邊都過，鎖住「原檔還在時不改字」 |
| R2 | 用報告的程式重現：`{ closeResolvedBeforePersist: true, applies: 1, persists: 1 }`。準備時 `track → adopt → replan` 同步呼叫監聽者；監聽者丟錯時 `report` 也同步呼叫 `onError` | `5855aa7`：`edit` 在 `plan` 之後、`apply` 之前查 `closed`，關了就回 `blocked closed`，不改編輯器、不 persist；`fillFile` 的回呼在準備之後同樣查，關了就丟 `Stopped` 中止 modify，`fillIds` 回 `false` | 「L2 R2」三則：存檔時監聽者 `close()`、監聽者丟錯由 `onError` `close()`、`fillIds` 的回呼裡監聽者 `close()`。三則在舊程式都失敗（`saved`／`true`）。報告的 R2 探針在新程式會停在 `await held.started`：存檔不再呼叫 `persist`，這是預期的 |
| R3 | 照報告的方式重現（替身原本沒有 Modal 的元素，這次補上） | `c3de2a0`：小視窗記一個 `waiting`，`render()` 新建的按鈕照它停用，`choose()` 在等待中直接返回，`resolve` 回來（成功、失敗或丟錯）才清掉 | `tests/save-wiring.test.ts` 的「L2 R3」：按還原後送兩次 `onChange`，按鈕仍停用、再按不另外排一份；`done` 之後解除。舊程式在「重畫之後按鈕又能按」失敗。替身的 `click()` 照瀏覽器不送停用按鈕的 click，所以 `choose()` 裡的等待檢查沒有單獨的測試 |

**請再審時特別看 R2 的一個選擇**：任務 §5 把「已經在 I/O 的（等 `modify`）」歸為 `close()` 等它寫完。`fillIds` 的回呼在 modify 裡面，嚴格說屬於這一類，照原規格可以寫完、回 `saved`（那條路 `close()` 有等，不是 R2 那種漏等）。這次讓它和存檔一致：準備時關閉就不寫。比原規格嚴，沒有寫出去的 ID 只留在記憶體的 `seen`，下次載入重新配，不會撞號。任務 §5 已補這一句。

**其他回覆**：

- 自選做法第 5 點的建議：任務說明 §4 第 3 點（讀不到）與 §5（關閉）已補「沒有改字的回它原本的結果」。
- 「請特別看」第 9 點：同意。任務說明 V5 列寫上你的判斷；「存檔排隊時換篇」的 Windows 驗證記進 backlog 技術債，觸發點是下一次在 Windows 跑 `save-flow`。
- 自選做法第 8 點：同意，`view.save()` 沒有變更時不寫仍是推論，審查請求已標明。
- a3check：審查請求寫「C1～C11 全 ok」不夠精確，C8、C10 各有一個子項 skipped（兩次相同）；以這份報告的寫法為準。
- 報告原本寫在主資料夾，已搬進分支的同一路徑，隨分支合併。
- Windows 在修正後重跑 `save`、`save-flow`、`lock`、`a3check`，結果都和上一次相同（細節在審查請求的〈再審〉）。`save` 會在 Obsidian 裡開小視窗、重畫、選還原，R3 的改動沒有影響這條路。

## 再審（2026-10-29）

狀態：待修；R1、R3 的修正成立，R2 原案例已修，但相鄰的 Editor 回呼重入仍有一項 P2，尚未通過 L2

本輪只審分支 `claude/hungry-yonath-106fcb` 的 R1～R3 修正及指定的相鄰案例。基準 `d33c01351d214a1d601eae0a57c4282f1ac5d5ee`，待審 HEAD `22cede548c2abc203ef0cb6426eaa1dbc891c66d`；產品修正是 `6318645`、`5855aa7`、`c3de2a0`，`c3de2a0` 到 HEAD 的 `src/`、`tests/` 沒有差異。審查開始時 worktree 乾淨；本輪只在這個 worktree 追加本節，沒有修改程式、測試或 vault，沒有 commit。

### R2 續 — P2｜`apply()` 或 `persist()` 內同步關閉，仍會漏等保存

**軸：規格。證據：已重現（公開 State／EditorHandle；apply 版使用真正的 CodeMirror EditorState 交易回呼），未在 Windows Obsidian 重現。建議：合併前修，補兩個相鄰回歸案例。**

`5855aa7` 在 plan 之後重查 `closed`，確實修掉「準備時 onChange／onError 關閉」；但還沒涵蓋後面的主機呼叫。具體觸發有兩種，屬於同一個生命週期缺口：

1. `EditorHandle.apply()` 執行 Editor 交易時，交易的同步回呼呼叫 `state.close()`。探針用 `EditorState.transactionFilter` 實際執行這個回呼，沒有在 state 內加出口。
2. `EditorHandle.persist()` 在回傳尚未完成的 Promise 之前同步呼叫 `state.close()`。

兩者都能得到：`closeResolvedBeforePersist: true, applies: 1, persists: 1`，當時磁碟仍沒有 ID；放行保存後才寫進 `^aaaaaa`，工作回 `saved`。

**預期**：任務 §5 允許尚未寫的工作中止，或已進入 I/O 的工作等到保存完成／逾時；不能在尚有這份保存未決時回報 close 完成。這不是要求把已套用的 Editor 交易撤回。

**位置與原因**（以下位置均指分支 `claude/hungry-yonath-106fcb` 的 `22cede5`）：`src/state/index.ts:574` 的新檢查在 `editor.apply()` 之前；`:575–577` 之間仍可能同步重入。尤其 `persist(editor.persist())` 會先執行 `editor.persist()`，之後才進入 `persist` 並在 `:487` 設定 `active`。`close()` 的 `:651` 已讀到先前的 `null`，不會因稍後設定 active 而重新等待。

**影響與處理**：主機收到關閉完成後，舊工作仍可能開始或繼續寫磁碟。應在進入可能重入的 Editor 呼叫之前，使關閉能追蹤這份工作的 I/O 生命週期；或明確中止尚未開始的保存，且回報必須符合「Editor 已改過」的事實。只在 apply 後再加一個 closed 檢查，仍擋不住第二種 persist 內重入。測試應保持保存未完成，明確斷言 close 不得先完成；中止方案則斷言沒有開始保存，且不把已改 Editor 的工作誤報為「沒有改字」。

第一種觸發的最小重現如下，在本 worktree 用 `node --input-type=module` 從 stdin 執行；資料只在記憶體：

```js
import { createState } from './src/state/index.ts';
import { createMemoryFiles } from './tests/helpers/memory-files.ts';
import { createMemoryEditor } from './tests/helpers/editor.ts';
import { EditorState } from '@codemirror/state';

const P = 'Essence Cards/P.md';
const C = '- 能說明 C\n    - QC :: AC\n';
const m = createMemoryFiles({ [P]: C });
const s = createState({ files: m.files, device: 'PC-review',
  fillIds: true, random: () => 0 });
await s.ready();
let closing, closed = false;
let cm = EditorState.create({ doc: C, extensions: [
  EditorState.transactionFilter.of(tr => {
    closing = s.close().then(() => { closed = true; });
    return tr;
  }),
] });
const e = createMemoryEditor(m, P, C);
const held = e.hold();
e.apply = (before, after) => {
  if (cm.doc.toString() !== before) return false;
  cm = cm.update({ changes: { from: 0, to: cm.doc.length, insert: after } }).state;
  e.value = cm.doc.toString();
  e.applies++;
  return true;
};
const saving = s.save(e);
await held.started;
for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
console.log({ closeResolvedBeforePersist: closed,
  applies: e.applies, persists: e.persists });
// 實際：{ closeResolvedBeforePersist: true, applies: 1, persists: 1 }
held.release();
console.log(await saving); // { kind: 'saved' }
await closing;
```

第二種觸發可用相同 fixture，把 `e.persist` 換成「同步呼叫 close、接著回傳由外部放行才 `m.write(P, e.value)` 的 Promise」；不加 CodeMirror 回呼也會得到同樣結果。這兩個探針只證明公開協調介面的漏洞，沒有宣稱目前內建 lock 回呼會自行呼叫 close，或已測出 Windows 上的發生頻率。

### 三項修正與 R2 選擇的判斷

| 項目 | 再審結論 |
|---|---|
| R1／`6318645` | 修正成立。失效回呼丟錯會在寫檔前中止，避免不存在時建立空檔。完整檢查涵蓋刪除／改名／原檔保留三個回歸案例；本輪另在 close **之前**放行逾時回呼，三種情況也都不誤寫，而且 state 仍開著、下一份正常存檔可完成。晚到的 Stopped 不會把已回報的逾時改成 blocked closed，也沒有未處理的拒絕。 |
| R2／`5855aa7` 原案例 | 修正成立。原本 onChange／onError 在 plan 期間同步關閉的存檔已停止，沒有 apply／persist；原報告等待 `held.started` 的探針應改成斷言根本不呼叫 persist，不應照舊等它。另驗同篇後續排隊的 save／fillIds 都被擋下，以及 resolve 的 restore／new 在觀察新原文時關閉，均不寫。但 R2 整體仍有上面 Editor 回呼的剩餘路徑。 |
| fillIds 準備時關閉就不寫 | 同意這個較嚴的選擇。modify 回呼仍在可中止、尚未提交文字的階段，丟 Stopped 不會改檔；對外 fillIds 回 false，和已補充的任務 §5 一致。準備時已預留的 ID 保持不重用，無須為了符合舊分類而刻意完成一份已關閉的寫入。 |
| R3／`c3de2a0` | 修正成立。waiting 在視窗物件上保留，重畫後仍停用，choose 也有等待檢查。除了新增的成功回歸，本輪驗 done／failed／stale／Promise reject，以及先手動關閉、後 done／reject 共六組；多次 onChange 不會多排選擇，失敗／拒絕會清理訂閱，已關閉視窗不會重新 open 或重新訂閱。done 到達已關閉視窗時仍會重畫離線內容，但沒有可見的視窗重開，這點不列缺陷。 |
| 測試替身與原測試 | Modal／元素替身只增加接線測試所需的行為；disabled 按鈕的 click 不送事件，符合這個測試的用途。新增 7 項回歸，既有測試的斷言未放寬。choose 的等待檢查可由程式確認存在，不把目前的 disabled-click 測試說成已單獨驗過這道檢查。 |

### 文件、檢查與 Windows 結果

- 任務 §4 第 3 點的無改字 reject 結果、§5 的無改字／準備時關閉例外，與目前程式一致；V5 仍明列 Windows 等待中換篇未驗，沒有改成已通過。backlog 的 V5 觸發點是下一次 Windows `save-flow`，這輪 `140805` 已到該觸發點，該待補情境仍未完成；後續需補情境或依完成條件記明做不出排隊的具體原因，不能把這次相同結果視為結案。
- 在 HEAD `22cede5`、Node `v24.13.0` 下，**沙箱外** `npm run check` exit 0；型別、lint、knip、secretlint、skill、文件與 **602 項測試全過**，0 failed／0 skipped；測試階段約 72.6 秒。沿用既有相依，未重跑 npm ci。
- 本輪另跑 13 組通過的公開介面相鄰探針：R1 晚到回呼在關閉前執行的刪除／改名／保留三組；R2 同篇排隊 save、排隊 fillIds、resolve restore／new 四組；R3 的六種結果／視窗先關閉組合。另兩組探針重現同一項 R2 續，不把 602 全綠當作關閉契約已完整成立的證明。
- 只讀既有 Windows 結果，沒有重跑 Obsidian 命令或修改 vault：`save Windows-c50c 2026-10-29 140718.json` 的 17 項 checks 皆 true；`save-flow … 140805.json` 的 V1 磁碟／編輯器一致、一次提示、30 ms，其餘 checks 與前次相同，V6 仍 `[false, true, true]`、cleanupLeft 空；`lock … 141006.json` 50／0；`a3check … 141227.json` C1～C11 皆 ok、failed 與 cleanupLeft 空，C8／C10 各一個 skipped 子項與前次相同。
- 目前 vault 的 bundle 可抽出 `0.0.1+e10d2ae`，其 `src/` 與本輪待審版本相同；歷史 JSON 仍只記 `0.0.1`，建置與結果的綁定沿用前輪已明列的證據限制。沒有重開 V6、跨重啟預留或原樣拆檔。

沒查的項目與原因：未重審 R1～R3 及相鄰路徑以外的既有程式；未在 Windows Obsidian 操作重現 R2 續、未補實機等待中換篇與 no-op view.save 寫入次數，因本輪採隔離 Node 探針並讀取既有實機紀錄；未測 iPhone／跨裝置 iCloud，這批任務明列不需 iPhone，既有結果也不足以證明新的同步時序。

## Claude 核對再審（2026-10-29）

狀態：R2 續同意、已重現、已修；V5 的 backlog 觸發點同意，補了 Windows 情境（待實機跑）。

**R2 續**：用你的 CodeMirror 探針重現 `{ closeResolvedBeforePersist: true, applies: 1, persists: 1 }`。原因同你寫的：`active` 到 `persist()` 包住 Promise 時才設，`editor.persist()` 先執行、裡面同步 `close()` 時讀到的是 `null`。

- 修正（`ae7102c`）：`active` 改成這份工作的 I/O 期間，`begin()` 建立、`end()` 解除；`persist()` 不再管它。`begin` 到 `end` 之間只有寫進磁碟那一步會等，那一步照舊有 `writeTimeout`，所以 `close()` 最多等那麼久。`apply`、`persist` 裡關閉時保存照常寫完、回 `saved`（編輯器已經改過，不報成沒改字）。`5855aa7` 的「準備之後查 `closed`」保留：那時還沒碰編輯器，停下來比寫完單純。
- 測試：「L2 R2 續」兩則（`apply` 裡、`persist` 回傳之前同步 `close()`），在保存放行前斷言 `close()` 沒完成、磁碟沒變，放行後回 `saved`、磁碟和編輯器都有 ID。舊程式兩則都在「close() 在保存結束之前就完成了」失敗。你的探針在新程式回 `closeResolvedBeforePersist: false`。測試在斷言失敗時也會放行保存（第一次寫時沒放行，舊程式上收尾的 `close()` 會卡住，不是失敗）。
- 任務說明 §5 補了這一句；604 項通過。

**V5 的觸發點**：同意，`140805` 那次 Windows 回歸就碰到了，不能把相同結果當成結案。`save-flow` 加了一個情境（`7c1947a`）：先讓另一個分頁的 `view.save()` 停住，這篇的存檔排在它後面，換篇之後才放行；預期提示「剛剛改過」、兩篇都沒被寫（check `V5queued`）。同一個 tick 搶不到換篇前面，所以要靠前一份存檔佔住寫入的那一列。測試 vault 現在被 iCloud 佔位檔的 session 用著（15:00 裝了它的建置），等它用完再跑，結果補在下面；通過就刪掉 backlog 那一列。

**Windows 結果**（Obsidian 1.14.5，開發版 `0.0.1+a8c8a8b`，程式和 `ae7102c` 相同，只多了開發命令）：

- 第一次跑（`0.0.1+c5efaeb`，`save-flow … 151931.json`）`V5queued` 是 false：提示對了（「剛剛改過」），換到的那篇沒被寫，但排隊的那篇磁碟有 ID。看事件是前一份存檔寫完後 1005 ms 才 modify，也就是換篇（離開那篇）觸發的離開筆記備援（`LEAVE_DELAY` 1000 ms，W5 §8-6）補的，不是存檔寫的。是我的檢查放錯時間（等 1.5 秒才看），`a8c8a8b` 改成存檔一回來就看，備援補的 ID 另外記。
- 重跑 `save-flow … 152335.json`：checks 全部和上一次相同，加上 `V5queued` true（提示「已加入複習」「剛剛改過」各一次，存檔回來時排隊的那篇沒變、換到的那篇沒變，排隊的那篇之後由備援補了 2 個 ID）；V1 24 ms；V6 照舊 `[false, true, true]`。這次 `cleanupLeft` 留下 `存檔流程` 資料夾：上一次跑完 `cleanupLeft` 是空的，資料夾裡卻還留著那次的一個測試檔（原因沒查，推論和 iCloud 有關）。跑完檢查資料夾已經是空的，手動刪掉。
- `save … 152443.json` 17/17、和上一次相同；`lock … 152506.json` 50/0；`a3check … 152724.json` C1～C11 都 ok，C8、C10 各一個子項 skipped（和之前相同），`cleanupLeft` 空。
- backlog 的「存檔途中換篇只在 Node 驗過」那一列已達完成條件，刪掉；任務說明 V5 列補上結果。

## 第二次再審（2026-10-29）

狀態：第二次再審通過；R2 續已修，V5 的 Windows 等待中換篇證據已補，未發現本輪範圍內需再修的問題

審查分支 `claude/hungry-yonath-106fcb`，基準 `22cede548c2abc203ef0cb6426eaa1dbc891c66d`，待審 HEAD `6833097de27870e41566b013d498d9cc6812b870`。依請求只審 `ae7102c` 的 I/O 生命週期修正、`7c1947a`／`a8c8a8b` 的 V5 開發命令與相鄰案例，並核對任務 §5、V5 列。以下程式位置均指該分支的 `6833097`；`ae7102c` 到 HEAD 的 state 與 state-writes 測試沒有差異。審查開始時 worktree 乾淨；本輪只追加本節，不改程式、測試、vault，不 commit。前文保留各輪當時的待修狀態，本節是本次再審結論；不涵蓋之後的新變更。

### R2 續的修正

**規格與設計核對成立。** `src/state/index.ts:475–478` 在呼叫 Editor 之前建立 active，`:493–500` 在 finally 收尾時完成並清掉 active；`persist()` 只負責保存與逾時，不再覆蓋工作身分。因此 `close()` 在 `:655` 等的是整個 begin～end 的 I/O 期間，也涵蓋 `apply()`、`persist()` 同步回呼。

重跑前輪的真正 CodeMirror `EditorState.transactionFilter` 探針，以及 persist 回傳 Promise 前同步關閉的版本，兩者保存未放行時都得到 `closeResolvedBeforePersist: false`；放行後保存回 `saved`、磁碟與編輯器都有 `^aaaaaa`。這次沒有把已改過編輯器的工作誤報為沒改字，也沒有提前回報關閉完成。

準備後的 closed 檢查仍保留，未碰編輯器的工作照前輪約定中止；實際保存仍由 writeTimeout 限時，成功、失敗、逾時與提早退出都會經過 end。新增兩項回歸測試的預期直接保護這個完成順序，且失敗時會放行測試中的保存，不會把收尾卡住誤認成產品失敗。沒有放寬原本的斷言。

### 相鄰案例

另以 stdin 執行 **11 組公開介面探針，全部通過**；資料只在記憶體，沒有新增測試檔或產品出口。

| 案例 | 結果 |
|---|---|
| CodeMirror apply／persist 內同步 close（2 組） | 保存未完成時 close 不完成；放行後 saved，內容正確。 |
| apply 回 false、apply 丟錯、persist reject（3 組） | 分別回 stale／failed／failed；active 都確實解除，close 可完成，磁碟不被寫入。 |
| 同一份卡住的保存呼叫兩次 close | 兩份 close 都等待；推進 writeTimeout 後保存 failed，兩份 close 都完成；保存晚到不再走原工作的採用。 |
| end 已完成、核對讀取尚未回來時呼叫兩次 close | 工作回 saved；close 依既有規則等讀取收尾，放行後兩份都完成，不採用輸出、不通知。 |
| fillIds 的 modify 回呼在準備之前同步 close | 門檻擋住寫入，fillIds 回 false；close 等該份收尾，不改磁碟。 |
| 舊 persist 逾時、下一份開始後舊保存才完成 | 舊完成不清掉新 active；此時 close 仍等新的一份，放行後新工作回 saved，ID 不重用。 |
| 沒改字的 persist 途中 close | 仍等保存完成，結果是 unchanged，不誤回 saved。 |
| text 回 null 的提早退出之後再排下一份 | 第一份回 stale 並解除 active；close 會等下一份保存，沒有殘留或誤用前一份的完成訊號。 |

### V5 開發命令與 Windows 證據

已直接讀取測試 vault 的 `Essence W5/結果/`，未重新操作 Obsidian 或改寫 vault。新情境用前一份存檔暫停 view.save，使待測存檔確實排隊；換篇後才放行，符合要驗的時序。`a8c8a8b` 把 queuedUntouched 的觀察移到存檔剛回來、離開備援之前，並另外保留備援後的結果，修正合理。

- `save-flow Windows-c50c 2026-10-29 151931.json` 的 V5queued 為 false，不能算通過；但事件中前一份寫完到待測篇 modify 相差 **1005 ms**，支持「觀察已包含離開筆記備援」的解釋。
- `save-flow … 152335.json` 的 **V5queued 為 true**：queuedUntouched、targetUntouched 都為 true；提示為一次「2 個學習目標已加入複習」（前一份存檔）與一次「剛剛改過」（排隊後換篇）。其後 queuedFilledOnLeave 為 2，兩次 modify 相差 **1007 ms**，與約一秒後的離開備援一致。不能把後面的補 ID 說成排隊存檔誤寫。
- 因此任務 V5 列與結果、程式一致；原本「等待中換篇只有 Node 證據」的驗證缺口已補，移除對應 backlog 列有依據。V1 為 24 ms、persist 時磁碟與編輯器一致；V2～V4、V5 其他 checks 與前次相同；V6 仍是已知限制 `[false, true, true]`，不當成防覆寫通過。
- 這次 save-flow 的 **cleanupLeft 非空**，列出 `Essence Cards/W5 範例/存檔流程`，不把清理檢查寫成通過。Claude 已記錄手動清理；本輪唯讀確認該資料夾目前不存在。歷史殘留的根因沒有獨立證據，不能寫成已確定是 iCloud；這不推翻已記下的 V5 行為觀察。
- `save … 152443.json` 17 項 checks 全 true；`lock … 152506.json` 50 passed／0 failed；`a3check … 152724.json` C1～C11 皆 ok、failed 與 cleanupLeft 空。C8／C10 各一個 skipped 子項與之前相同，仍不算那些子項已測通過。

### 完整檢查與範圍

在 HEAD `6833097`、Node `v24.13.0` 下，**沙箱外 `npm run check` exit 0，604 項測試全過**，0 failed／0 skipped；型別、ESLint、knip、secretlint、skill 副本與文件檢查都通過，測試階段約 69.0 秒。沿用已安裝的相依，未重跑 npm ci。

測試 vault 目前 bundle 可抽出 `0.0.1+a8c8a8b`，其待審程式與 `6833097` 相同；歷史 JSON 的 plugin 仍只記 `0.0.1`，歷史建置與結果綁定的限制照前輪保留。R1、R3 的通過結論沒有被這次差異推翻；R2 續的兩個重現已修、相鄰案例通過，本輪沒有新增需修的規格或設計發現。合併仍由使用者決定。

沒查的項目與原因：未重審指定差異及相鄰路徑以外的既有程式；未在 Windows Obsidian 直接操作 R2 的同步關閉／逾時情境，這些由隔離 Node 探針與回歸測試驗證；未查明歷史清理殘留的根因、未量 no-op view.save 的實機寫入次數，既有結果不足以回答；未測 iPhone／跨裝置 iCloud 或明確延後的功能，本批任務不要求這些驗證。
