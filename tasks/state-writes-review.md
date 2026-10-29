# `state` 的讀寫先後與寫入協調：L2 獨立審查（給 Codex）

狀態：L2 通過（第二次再審，審查 `6833097`，[報告](<../Claude Codex Discussion/2026-10-29-state-writes-review.md>)最後〈第二次再審〉）；待使用者決定合併

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（`src/state/` 的寫入先後、ID 的安全與寫回筆記的流程互相牽動）。

依 [D-131](../docs/decisions.md#d-131-claude-實作codex-在關鍵點查核)、[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核)，[任務說明](state-writes.md)由 Claude（Opus 5.5）實作。這一批改了寫入排程、配 ID 後什麼時候採用、存檔寫回筆記的方式與關閉的語義，屬於高風險範圍（[docs/agents/quality.md](../docs/agents/quality.md)），合併前請你做獨立審查。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- worktree：`D:\程式開發\Essence Cards\.claude\worktrees\quizzical-euclid-f0564e`，分支 `claude/hungry-yonath-106fcb`（任務說明寫的是 `claude/state-writes`，實際用 app 開的 worktree）。沒有未提交的修改；沒有 push。
- 從 `main` 的 `b63c1bbd8e4467470f21150004cc2e05c50ecfbf` 開出。commit（由舊到新）：
  - `c4cbb141f72a4a85405038fc1acb04120c12511f`：修 `main` 當時的 CI 紅燈（`tests/study.test.ts` 跟上 syntax §5 的 `set: app`）。同樣的修改已 cherry-pick 到 `main`（`707650e`），不用審。
  - **實作**（任務說明〈commit 的切法〉②～⑨）：
    - `88eb466f13a5cce007174ff3974485537fac1602` ② 取消舊日作答（§6、S25）
    - `e425391413fbbeb06db73de2b4d93dd45b574cc8` ③ 讀取那一側（§2）
    - `8ca214a89929178909b848a2d6d63da538b2c47f` ④ 寫入排成一列、先讀完待讀、門檻（§3，先接 `fillIds`）
    - `45bcbae0f145720296acb27edb2e832a64adc4af` ⑤ 準備只預留、核對與採用（§4）
    - `bce58f3f4053603c588d060abf28d1d240bc5028` ⑥ `save`、`resolve` 取代 `fillText`、`resolveText`（§1、§7）
    - `1a170a8b07ce4b0013c0c30e95b27ba09f99490a` ⑦ 關閉與寫入卡住（§5、§3 最後一段）
    - `324cbd1828467345ac4df977fcf1cef75c49b038` ⑧ A11 的註解與 A12 的測試
    - `9260bfcdf836a94fc0d0f234dda734e7b55c8bfb` ⑨ 開發命令 `save-flow`（§9）
    - `1f6c51400288abfa61d72fcb91e22165e8cd0489` `fillIds` 的結果對應（下面「做法」第 4、5 點）
    - `cd035331b44621c22c90a587e972c380deda4a82` `await admit()` 之後同步重查（「做法」第 7 點）
  - 中間 `637428d`～`7faf34f` 是 V6 的實驗與文件：實驗命令已用 `199d360` revert，[V6 討論稿](<../Claude Codex Discussion/2026-10-29-save-external-write.md>)稿末有你的〈Codex 查核：是否乾淨〉與 Claude 的核對。
  - `34492d082daaec4621dc76dc9eb278ee295723c4`：把 `origin/main`（`d39cf65`）合併進來，沒有衝突；`main` 這段只改了文件、skill 與 pre-commit hook，沒有改 `src/`、`tests/`。
  - 這份請求的 commit（含 backlog、roadmap、`tasks/update-safeguards.md` §2-2 的改名、任務說明的狀態行與 V5 列）。
- **看實作用 `git diff c4cbb14 cd03533 -- src tests`**（V6 的實驗命令加了又 revert，淨差異是零）；只看停下來之後的兩個修正用 `git diff 9260bfc cd03533 -- src tests`；看整個分支相對 `main` 用 `git diff origin/main...claude/hungry-yonath-106fcb`。

## 規格與優先順序

- 主要規格：這個分支上的 [tasks/state-writes.md](state-writes.md) §1～§10 與它的「必讀範圍」「限制」。基準是 `main` 的 `5a6b419`（說明所在的 commit）；開工時核對過，到 `b63c1bb` 為止只有 `docs/backlog.md` 改了兩行，和這份規格無關。
- 分支上對任務說明的改動（`main` 那一份沒改）：S16 與 §1 `fillIds` 的註解改成 2026-10-29 確認的對應（`1f6c514`）；S14、V6 寫成 V6 的已知限制（`7faf34f`）；V5 補上 Windows 的結果、狀態行（這份請求的 commit）。
- 依據：[外掛架構討論稿](<../Claude Codex Discussion/2026-10-26-plugin-architecture.md>)環節 4，從〈Codex 回應：環節 4〉到〈Claude 回應 Codex：環節 4 第二輪〉（前後有出入時以最後那一節為準），特別是〈Codex 回應：環節 4 第二輪〉第 2 點的表；[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)；[state-load 說明 §3](state-load.md#3-id-的安全還有東西沒讀到時不把不知道當成沒用過)；[W5 架構檢查](<../Claude Codex Discussion/2026-10-26-w5-architecture-debt.md>)的 A11、A12。
- V6（存檔撞上外部寫入）已在 V6 討論稿由 Claude、Fable 與你兩輪談定、使用者同意：不修，記成已知限制，候選 P 在 backlog。除非你找到新的證據，這次不重談；但請確認任務說明、測試註解與 backlog 的寫法和實作一致。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那份。

## 請特別看

照任務說明〈完成後〉，加上後來的兩點：

1. **所有改卡組的入口都經過同一列與同一個門檻**：`src/state/index.ts` 的 `enqueue`、`admit`、`writable`；入口是 `save`、`resolve`（經 `edit`）與 `fillIds`（經 `fillFile`）。請找有沒有漏掉的路徑（`tracker.fill`、`tracker.resolve`、`tracker.wrote` 以外會寫 ID、採用輸出或把 ID 當成沒用過的地方；`removedInEditor`、`restoredInEditor` 照舊不排隊）。
2. **從第 2 步的最後一次檢查到 `apply` 之間沒有 `await`**：`edit` 在 `await admit()` 之後同步重查 `waiting()` 與 `writable()`（`cd03533`），通過後到 `begin`、`editor.text()`、`plan`、`editor.apply` 之間沒有 `await`；`fillFile` 的對應檢查在 `files.modify` 的回呼裡。
3. **核對讀取的三種結果，以及延後的記錄只在預期成立時才套用**：`read` 尾端處理 `checks` 的那段，和 `src/state/ids.ts` 的 `fill`、`resolve` 回傳的 `Prepared`（`expect`、`record`）。
4. **讀到 `null`、讀不到、改名時，舊的工作不會寫到別篇**：`EditorHandle.path` 在建立時固定；核對讀到 `null` 回 `stale`、不跟著 A2 的改名配對；S19。
5. **關閉之後、寫入逾時之後，沒有殘留的採用、通知與讀取**：`close()`、`persist()`（`writeTimeout`）、`fillFile` 回呼裡的 `live`；S24、S28。
6. **`ids.ts` 拆開後，「先觀察原文再配號」與還原時的同篇檢查還在**：`fill`、`resolve`（`presentOf(bare, …)`）；`resolve` 的「拿掉問題、記 `removed`、記見過」延到 `record`。
7. **既有測試的預期沒有被改**：`tests/state-ids.test.ts`、`tests/review-session.test.ts` 只換呼叫方式（`tests/helpers/editor.ts`），斷言值不變；請用 `git diff c4cbb14 cd03533 -- tests/state-ids.test.ts tests/review-session.test.ts` 確認。
8. **`cd03533` 的重查不會重設輪數、持續通知時有限退出**：你在 V6 討論稿〈Codex 查核：是否乾淨〉第 5 題已看過這一點；這次請連同它和 `fillFile` 的 `rounds` 一起看。
9. **§9 V5 換篇的驗收落差**：規格要「提示剛剛改過」，Windows 上兩次（01:28、10:49）都是存檔搶在換篇之前做完、原本那篇照常配 ID、提示「已加入複習」，另一篇沒有被改。「剛剛改過」那條路只有 Node 的 S27（換篇後 `text()` 回 `null`）驗到。請判斷這樣算不算符合，或要求補什麼。

## Claude 自己選了做法的地方（請逐點回覆）

1. **`admit` 先處理不用讀的情況**：已關閉直接回；手機、還沒 ready、不是卡組也直接回門檻的結果，不先讀待讀。只有 `unread` 那一種先讀完已知的待讀再查門檻。規格 §3 的順序是先讀（第 2 步）再查門檻（第 3 步）。理由：前三種情況讀完也不會變成可寫（手機、不是卡組不會變；還沒 ready 時 `start()` 自己在讀），先讀只多一輪；`unread` 可能因為讀完而變空。結果和規格的順序相同，只少了沒用的讀取。
2. **不取消 500 ms 的計時**（規格 §3 第 2 步寫「取消」）：`readNow` 讀的時候會清掉 `pending`，計時到了發現 `pending` 是空的就什麼都不做（`apply` 開頭）。取消再重排要多記一個狀態，沒有好處。
3. **`rounds` 跨過重來累計**：`fillFile` 的回呼因為新的待讀而沒改、回到第 2 步時算一輪，沿用同一份 `rounds`；`edit` 在 `cd03533` 的重查不通過、回到 `admit` 時也沿用，不歸零。
4. **`fillIds` 的對應**（規格的 S16 和既有測試衝突）：S16 原本寫 modify 失敗時 `fillIds` 回 `false`，既有測試「離開筆記的補 ID 寫不進去時…」斷言它 reject，`save.ts` 的 `leave()` 也靠 reject 交給 `host.onError`。照環節 4 的 session 2026-10-29 的確認：modify 失敗與逾時照舊 reject；`done` 與 `saved` 回 `true`（和原本「有改字回傳 true」相同）；`unchanged`、`blocked`、`stale` 回 `false`。任務說明的 S16 與 §1 註解已照改。
5. **沒改字的工作不回 `saved`**（`1f6c514`）：規格 §4 第 3 點「讀不到 → `saved`」、§5「已經在 I/O 的回 `saved`」沒有分有沒有改字。沒改字的工作在核對讀不到或關閉時，回它原本的結果（存檔是 `unchanged`、小視窗是 `stale`），否則 `fillIds` 照第 4 點會誤回 `true`。測試：「fillIds 的結果對應（2026-10-29 確認）」。
6. **小視窗的問題已經跟著改名搬到別的路徑**（`issue.path` 不是 `editor.path`）：不準備，照「沒有改字也要 persist」同樣 persist、等核對讀取，回 `stale`。
7. **`cd03533`**：V6 討論時你找到 `await admit()` 回來之後到開始 I/O 之間隔了一次 `await`，其間送來的通知或 `close()` 會被漏掉（V6 討論稿〈Codex 回應〉）。修法是同步重查 `waiting()` 與 `writable()`，不通過就回到 `admit`。測試：「S13 交接版」兩則（別篇送來含 `aaaaaa` 的通知、`close()`，各掃第 0～20 個 microtask 才發生），舊程式在第 1 個 microtask 失敗；「S22 存檔版」新舊都通過，是持續通知時有限退出的回歸保護。
8. **測試替身**：`tests/helpers/editor.ts` 的記憶體編輯器 `persist` 在內容和磁碟相同時不寫、不送通知，照 Obsidian 的 `view.save()` 沒有變更時不寫（推論，沒有在 Windows 單獨驗）；寫到「現在開著的路徑」模擬 `view.file`。既有測試用同一個檔的 `fillText`／`resolveText` 小函式，原本一行的呼叫還是一行；`resolveText` 在結果不是 `done` 時回 `null`（原本的 `null` 是「問題已不成立」，對應新的 `stale`）。
9. **commit 的切法**和說明不同的地方：記憶體 `Files` 的兩個開關併進第一次用到它的 ③（knip 會擋沒人用的 export）；`saveTest` 放在 ⑥（介面變成非同步，必須一起改）；`1f6c514`、`cd03533` 是停下來討論之後各自一個決定的修正。
10. **§7「超過 500 ms 就提出」**：V1 量到按下到結果回來 24～33 ms，沒有加「存檔中」。

## 行為與風險

- 公開介面的改動：`State.save(editor)`、`State.resolve(issue, choice, editor)` 取代 `fillText`、`resolveText`；新增 `EditorHandle`、`WriteResult`、`StateOptions.writeTimeout`；`fillIds` 的簽名不變（對應見上面第 4 點）。`src/obsidian/save.ts` 改成用 `MarkdownView` 做 `EditorHandle`，新增 `TIPS.failed`；`src/main.ts`、`src/core/` 沒有改（規格限制第 1 點）。
- 不可破壞的性質：
  - 同一時間只有一份寫入在做；讀取不跨過寫入的 I/O（跨過的結果整份不用、放回 pending）。
  - 寫入前已知的待讀先讀完（最多 5 輪，之後 `stale`）；`unread()` 不是空時不寫。
  - 配出的 ID 立刻進 `seen`、失敗也不重用；輸出只在核對讀取確認寫成後才採用，延後的記錄只在預期成立時套用。
  - 寫入失敗、逾時、關閉之後，不採用、不通知監聽者；`close()` 最多等 `writeTimeout`。
  - 取消早於今天的份開始的作答，今天的份重排；同一天的取消不重排。
  - 既有測試的預期不改。
- 測試：S10～S24、S26、S28 與 `fillIds` 的版本（M1、S13、S18、S20 等）在 `tests/state-writes.test.ts`，S25 在 `tests/review-session.test.ts`，S27 在 `tests/save-wiring.test.ts`。
- 已知限制（不在這次修）：V6，見上面〈規格與優先順序〉；`state/index.ts` 原樣拆檔等這件合併後做（backlog 技術債）。
- 請自己找新的組合，例如：
  - 核對讀取還沒回來時，同一篇又排了一份存檔（第二份輪到時取最新的文字，`checks` 只有一個位置）。
  - 小視窗的「還原」排隊時，同一篇的另一份存檔先把問題解掉；或核對讀取讀不到（`saved`）之後，家長又選了一次。
  - `fillIds` 的回呼裡發現新的待讀、回到第 2 步，同時 `close()`；逾時之後 modify 的回呼才執行。
  - 讀取停在半路時 `close()`；核對讀取讀到 `null` 的同一批裡有改名配對。
  - `writeTimeout` 逾時之後，晚到的 `persist` 寫進磁碟，下一次讀取看到的 ID（`seen` 已有）。

## 驗證方式

- Node 24 以上（Claude 用 v24.13.0）。在 worktree 裡：`npm ci`、`npm run check`。照 [quality.md](../docs/agents/quality.md) 的審查注意事項，完整的 `npm run check` 要在沙箱外跑。
- Claude 跑過：每個 commit 的 `npm run check`（pre-commit hook）。基準 `b63c1bb` 修好 CI 後 560 個測試；⑨ 之後 591、`1f6c514` 之後 592、`cd03533` 之後 595，合併 `main` 與這份請求之後照舊 595，全部通過。
- **§9 的 Windows 實測**（Windows Obsidian 1.14.5，測試 vault 的 `Essence W5/結果/`；測試 vault 的路徑不在 repo，請向使用者要）：
  - 第一次在 `324cbd1` 加上當時還沒 commit 的 `save-flow`（建置版本 `0.0.1+324cbd1.dirty`，之後 commit 成 `9260bfc`）：`save-flow Windows-c50c 2026-10-29 012855.json`、`save` 17/17、`lock` 50/0、`a3check` C1～C11 全 ok。
  - 最後在 `cd03533`（測試 vault 裡 `main.js` 的 `BUILD` 是 `0.0.1+cd03533`；結果檔的 `plugin` 只記 `0.0.1`，已記進 backlog）：`save-flow … 104901.json`、`save … 104818.json`（17/17）、`lock … 132302.json`（50/0）、`a3check … 132537.json`（C1～C11 全 ok），都和第一次相同。
  - V1 `persist` 完成時磁碟＝編輯器、提示一次、24 ms；V2 自動存檔後 15 ms 按、3 秒內沒有問題；V3 一組 ID、一次提示；V4 兩個編輯器與磁碟相同；V5 見「請特別看」第 9 點；V6 同一個 tick 蓋掉、50 ms 與 200 ms 保留（已知限制）；V7 唯讀時提示 `TIPS.failed`，恢復可寫後再存一次就補上。
  - 中途 iCloud 把一篇測試卡組轉成雲端佔位檔，讓一次 `save-flow` 與 `save` 的結果無效（`104157`、`104312`），等 iCloud 自己清掉後重跑；經過在 V6 討論稿〈退回與回歸〉。
- 沒跑：iPhone（任務說明 §9：iPhone 不寫卡組，「正在 I/O」永遠是空的）。

## 回報

寫在這個 worktree 的 `Claude Codex Discussion/2026-10-29-state-writes-review.md`（不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 「請特別看」的 9 點逐點寫結論；「Claude 自己選了做法的地方」的 10 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。

## 再審（2026-10-29）

你的[報告](<../Claude Codex Discussion/2026-10-29-state-writes-review.md>)的 R1～R3 都已修，Claude 的核對寫在報告最後〈Claude 核對〉。請只再審下面的範圍。

- **待審 commit**（各修一項）：
  - R1：`6318645`（看差異用 `git diff d33c013 6318645`）
  - R2：`5855aa7`
  - R3：`c3de2a0`（含 `tests/helpers/obsidian.ts` 補的 Modal 與元素替身）
  - 這一節的文件 commit 不用審，但任務說明 §4 第 3 點、§5 與 V5 列的改動請對一下是否和程式一致。
- **R2 的選擇**：`fillIds` 的回呼在準備時關閉也不寫，比任務 §5 原本的分類嚴（報告〈Claude 核對〉有說明），請判斷可不可以。
- **相鄰案例**請自己找，例如：準備時關閉之後同一篇排著的下一份；`resolve` 的準備時關閉（`track` 觀察到新的原文）；逾時之後的回呼在 `close()` 之前就輪到；小視窗等待中 `resolve` 丟錯、或結果回來時小視窗已經關掉。
- **驗證**：在最後的 commit 跑 `npm run check`（Claude 跑過：602 個測試全部通過）；你報告裡的 R1 探針在新程式回 `{ timeouts: 2, exists: false }`，R2 探針會停在 `await held.started`（存檔不再呼叫 `persist`，是預期的）。
- Windows（Obsidian 1.14.5，測試 vault 的開發版 `0.0.1+e10d2ae`，程式和 `c3de2a0` 相同）重跑，結果都和上一次相同：`save … 140718.json` 17/17（含小視窗開著時重畫、選還原）、`save-flow … 140805.json`（V1 30 ms，其餘 checks 相同，V6 照舊 `[false, true, true]`）、`lock … 141006.json` 50/0、`a3check … 141227.json` C1～C11 都 ok，C8、C10 各一個子項 skipped（和上一次相同）。R1、R2 的情境（逾時、準備時關閉）Windows 做不出來，只有 Node 的測試。

回報接在同一份報告後面，加一節〈再審（日期）〉。

## 第二次再審（2026-10-29）

你在報告〈再審〉找到的 R2 續已修，Claude 的核對與 Windows 結果寫在報告最後〈Claude 核對再審〉。請只再審下面的範圍。

- **待審 commit**：
  - R2 續：`ae7102c`（`active` 改成 `begin` 到 `end` 的 I/O 期間）。看差異用 `git diff 22cede5 ae7102c`。
  - V5 的 Windows 情境：`7c1947a`、`a8c8a8b`（只動開發命令 `save-flow`）。
  - 文件 commit 不用審；任務說明 §5 與 V5 列的改動請對一下是否和程式、結果檔一致。
- **相鄰案例**請自己找，例如：`close()` 在 `end()` 之後、核對讀取回來之前；同一份工作 `close()` 被呼叫兩次；`fillIds` 的 modify 回呼裡（準備之前）同步 `close()`；逾時之後 `active` 是否確實解除、下一份工作開始時 `close()` 等的是新的那一份。
- **驗證**：在最後的 commit 跑 `npm run check`（Claude 跑過：604 個測試全部通過）；你報告〈再審〉的 CodeMirror 探針在新程式回 `closeResolvedBeforePersist: false`、工作回 `saved`。Windows 結果檔在測試 vault 的 `Essence W5/結果/`：`save-flow … 152335.json`（`V5queued` true；`151931` 那次是檢查時間放錯，見報告）、`save … 152443.json`、`lock … 152506.json`、`a3check … 152724.json`。

回報接在同一份報告後面，加一節〈第二次再審（日期）〉。
