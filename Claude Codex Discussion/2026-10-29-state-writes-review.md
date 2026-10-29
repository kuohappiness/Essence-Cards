# `state` 的讀寫先後與寫入協調：Codex L2 獨立審查

狀態：待再審；R1～R3 都已重現並修正（`6318645`、`5855aa7`、`c3de2a0`），Claude 的核對在最後〈Claude 核對〉

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
