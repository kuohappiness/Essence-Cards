# 更新防線第二部分：審查請求（給 Codex）

狀態：已完成：Codex 第三次再審通過（`ae9c6b2`），第二部分合併進 `main`（`1308e58`）；見[回報](<../Claude Codex Discussion/2026-10-29-update-safeguards-2-review.md>)最後的〈Codex 第三次再審〉

遵守 repo 根目錄的 `AGENTS.md`。建議推理等級：**高**（紀錄的讀取與排程、寫回使用者筆記的入口、跨模組的改動，屬於 [quality.md](../docs/agents/quality.md) 的高風險範圍）。**只審查、只回報**，不改產品程式、不 commit；可以在隔離的暫存資料夾重現。要改的由 Claude 改。

## 審查對象

- worktree：`D:\程式開發\Essence-Cards-safeguards-2`，分支 `claude/update-safeguards-2`。
- **待審的範圍是 `git diff 1e8133198974116d35374335493418ba1026571b f73525b06c382741fd12e764ffcbca9a999dc60c`**（33 個檔，+1201／−70）：這個分支在目前的 `main`（`1e81331`）之上的全部改動。分支從 `600930a`（已含第一部分的合併 `8aa3078`，也是任務說明的基準）開；開工後 `main` 合併了 `state` 讀寫協調（[tasks/state-writes.md](state-writes.md)，`70ba562`），Claude 在 `f73525b` 把 `main` 合進來、解掉衝突。沒有未提交的修改。
- Commit（舊到新）：`5232ac4` 版本比較、`5291dc6` 卡組的 `需要版本`、`4edfc8b` 紀錄行的 `need`、`6b826d2` state 的卡組閘門、`ddff5d4` 作答被拒與複習畫面、`4c87cb7` `lastVersions` 跳過讀不懂的版本行、`2905254` ESLint 預設專案的上限、`94c40ea` 版本行、`d2aa27c` 外掛接線（BUILD、版本命令、提示）、`4a0f48d` 存檔按鈕、`14307c1` 退回前的檢查、`0c4db72` 測試、`e938d11` 卡組的狀態變更、`8a1d36b` 整理、`f73525b` 合併 `main`。
- **合併時改了做法**（`f73525b`，請一起看）：`main` 的寫入改成一個門檻 `writable(path)`，註解寫明「更新防線的需要新版」要加在那裡。所以卡組閘門從各個入口搬進門檻：`writable(path, text)` 回 `{ kind: 'blocked', reason: 'needs-update' }`，看 state 最近讀到的與傳進來的最新文字（`save`、`resolve` 是編輯器的文字，`fillIds` 是 `modify` 回呼的原文）；`admit` 遇到 `needs-update` 和 `unread` 一樣先讀完待讀再判斷（待讀裡可能就是改回讀得懂的那一篇）。存檔按鈕把 `blocked needs-update` 對到自己的說明。
- 請另開 worktree 跑測試：`git worktree add --detach <暫存資料夾> f73525b`，裡面 `npm ci`。拿掉時**不要用 `git worktree remove --force`**（Windows 上會順著 junction 刪掉連結指到的內容）；用一般的刪除再 `git worktree prune`。

## 規格與優先順序

- 任務說明：[tasks/update-safeguards.md](update-safeguards.md) 的 §2（2-1～2-4）；1-4 的「退回前先檢查現有資料的 `需要版本`／`need`」（第一部分留到第二部分做完）。
- 格式：[syntax.md](../docs/syntax.md) §0-1 最低版本標記、§2-1（`需要版本` 與「屬性區讀不出來時」）、§5（`set: app`、`need` 欄位）、§5-1 版本行、§5-2 讀不懂的行、§5-3 還原檔（版本列表的「還原檔」）。
- 決定：[D-149](../docs/decisions.md#d-149-更新與相容版本紀錄讀取閘門與正式安裝) 第 2、3、4 點與文末 2026-10-29 的補充（讀不到自己的紀錄時不擋作答）；[D-134](../docs/decisions.md#d-134-學習目標-id-的補上時機與保護)（已用 ID）；[D-154](../docs/decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測)（存檔受阻時不說「都已加入複習」，存檔按鈕沿用這個原則）。
- 前幾輪的條件：[討論稿](<../Claude Codex Discussion/2026-10-28-updates-and-compatibility.md>)的兩次 Codex 回應（第 2 題的 `undo`、`miss` 反例）、〈Codex 確認〉、〈Codex 格式查核〉的 F1、F2、R2 與「Claude 額外補的七組細節」。
- 規格互相衝突或有漏洞時列成問題，不挑容易通過的那一份。

## 公開介面與主要呼叫端

- `src/core/version/`（新模組）：`canRead(need, version)`、`releaseOf(build)`。deck 不能 import study，兩邊都要用，所以另開一個模組；backup 也用。
- `src/core/deck/`：`DeckProps.need: string | false | null`（`parseDeck` 只照實回報，判斷在知道版本的一方）。
- `src/core/study/`：`mergeHistory(sources, version = null)`、`readHistory(files, version = null)`；`History.held`、`History.incomplete`；`planToday` 不排 `held` 的目標，`incomplete` 時全部不排；`appendLine` 遇到帶 `need` 的行丟錯；`NewEntry` 多 `{ set: 'app'; val }`。
- `src/core/backup/versions.ts`：`lastVersions(sources, version = null)` 跳過 `need` 讀不懂的版本行。
- `src/state/index.ts`：`StateOptions.build`；`decks()` 不含需要新版的卡組；`blocked()`、`canAnswer(lt)`、`version()`；`answer()` 回傳 `string | null`；寫入門檻 `writable(path, text)` 多 `blocked needs-update`（`save`、`resolve` 回傳它，`fillIds` 回 `false`）；`deckStatus()` 多 `needsUpdate?: true`；`flush()` 成功後版本行標成 `written`。
- `src/review/session.ts`：`rate` 被拒時換下一張；回看裡被停的那張不能改評分。
- `src/main.ts`、`src/obsidian/version.ts`（`versionText`）、`src/obsidian/save.ts`：BUILD 傳進 state；「版本」命令；載入時的提示；存檔按鈕。
- `tools/install.ts`：`--release` 退回前的檢查（`newerData`）。

## 請特別看

1. **讀不懂的行的影響範圍**（`history.ts` 的 `needed`、`hold`、迴圈與最後找 `undo` 的那一段）：§5-2 的三個條件；「找得到它指的作答」的範圍（所有檔案、被取消的、同一刻好幾台的都算，讀不懂的行本身不算作答）；行尾救回的那一段也先看 `need`；`seen` 寬鬆地收；`needed` 用原文預篩（含 `need` 或 `\u` 才解析）會不會漏掉帶標記的行（BOM、跳脫的鍵名、空白）。請用新的組合驗：讀不懂的行的 `undo` 指到另一行讀不懂的行、指到變更、同一個 `t` 在別台裝置是另一個目標、標記在衝突副本或還原檔裡、讀不懂的行和它指的作答在不同月份。
2. **卡組的標記**（`parse.ts` 的 `unescapeYaml`、`mentionsNeed`、`readProperties`）：F1 的五種寫法與沒有結束的屬性區；請找 YAML 讀得出最上層的 `需要版本` 鍵、但原文檢查漏掉，或屬性區讀得出來卻漏判的寫法（例如流式對照表 `{需要版本: 1}`、複雜鍵 `? 需要版本`、錨點與別名、`<<` 合併鍵、標籤、BOM、CRLF）。
3. **閘門的一致性**（`state/index.ts` 的 `rebuild`、`answerable`、`blockedText`、`writable`、`admit`、`edit`、`fillFile`、`answer`）：排程（`planList` 與 `planToday`）、作答（`canAnswer`）、寫回（門檻與三個入口）、按鈕（`deckStatus`）四邊是否一致；`writable` 的原因順序（`unread` 在 `needs-update` 前面）與 `admit` 先讀完待讀是否會讓該擋的沒擋、或一直擋；讀得懂的卡組和需要新版的卡組同一個 ID 時兩邊都停；複習中途卡組或目標變成被停；被停的卡組裡的 ID 仍算用過（tracker 照常看它，可能在它身上找到待處理的問題但不顯示）會不會讓別篇的偵測出錯。
4. **版本行的時機**（`state/index.ts` 的 `record`、`checkApp`、`load`、`read` 的結尾、`flush`）：Codex 格式查核 R2 的兩種情況；一次啟動最多一行；寫入失敗由 writer 重試、不算另一次；自己的檔有好幾個月份；`own()` 只認檔名正好是 `logPath` 的格式；讀到自己的檔時這段期間的作答已經在記憶裡（`read` 把它接在讀到的內容後面）會不會讓比較出錯；`close()` 之後。
5. **作答被拒**（`answer`、`review/session.ts` 的 `rate`、`change`、回看的 `allowed`）：被拒的那張不寫紀錄、不進回看、換下一張；`change` 的取消與新評分一起寫或一起不寫；找不到那一筆的取消照舊寫。
6. **「版本」命令與提示**（`main.ts` 的 `showVersion`、`warnUpdate`；`version.ts`；`save.ts`）：寫「最後回報」、各種狀態的文字；版本命令先等 `flush`（最多 2 秒）；提示一次載入只一次；存檔按鈕不說「都已加入複習」。
7. **退回前的檢查**（`tools/install.ts` 的 `newerData`）：用外掛的讀法、在那一版的版本下讀；讀不到的檔整個失敗；什麼都不裝。
8. **已發布的版本與這一版並存**：每台裝置第一次跑這一版就在自己的紀錄寫 `set: app`；還在跑舊版的裝置讀到這些行會不會讀錯（舊版把它當成一般的變更收進 `changes`，排程不讀）；`need`、`需要版本` 現在沒有寫入端。
9. **測試**（`tests/version.test.ts`、`need-lines.test.ts`、`state-gate.test.ts`、`state-version.test.ts`、`version-command.test.ts`，以及 `deck`、`review-session`、`main-wiring`、`save-wiring`、`install`、`backup-core` 加的項目）：任務 2-3 的每一項是否都有、是否真的擋得住回歸。`state-gate` 的閘門測試，Claude 在 `f73525b` 把 `needsUpdate` 暫時改成永遠不擋時 12 項有 9 項失敗（其餘 3 項測讀不懂的紀錄行與 `seen`，本來就不靠卡組閘門）。

## Claude 自己選了做法的地方（請逐點回覆）

1. 版本比較放新模組 `src/core/version/`：deck 不能 import study（模組邊界），兩邊與 backup 都要用。
2. `parseDeck` 不知道這台的版本，只回報 `need`：沒寫是 `null`，值是字串就是那個字串（`""`、`v0.6.0` 也照實），值不是字串（含 `需要版本:` 空值、`null`、數字、清單）是 `false`。讀不讀得懂由 state 與工具判斷。
3. 屬性區讀不出來時：原文或照 YAML 雙引號規則解開跳脫之後含「需要版本」就是 `false`。解開跳脫做了 `\x`、`\u`、`\U`、行尾 `\` 接下一行（去掉下一行開頭的空白）與單字元跳脫，認不得的照原文；單引號與一般的換行折疊不處理（四個字照樣出現或本來就拼不出來）。屬性區讀得出來時只看最上層的 `需要版本` 鍵（巢狀的、鍵名多一個空白的都不算標記）。
4. `mergeHistory` 與 `readHistory` 的 `version` 預設 `null`（版本不明）：任何 `need` 都讀不懂。比較的轉接器、備份與還原工具都沒傳，所以都是保守的那一邊。
5. 讀不懂的行不進 `reviews`、`cancelled`、`changes`，也不算問題（它不是寫壞的行）；行尾救回的那一段讀不懂時記一個問題「寫入中斷；行尾救回的那一筆需要新版才讀得懂」。
6. 「找得到 `undo` 指的作答」只看讀得懂的作答（所有檔案、被取消的與同一刻好幾筆都算）；讀不懂的行本身不算。所以指到的檔還讀不到（例如雲端佔位檔）時整份暫時不完整、全部停，讀到之後恢復。
7. 被停的目標的作答仍留在 `history.reviews`；閘門在 `planToday`（`held`、`incomplete`）與 state 的入口。發布前比較的轉接器（`tools/compare/adapter.ts`）沒有改：它的「到期」照整份 `reviews` 算，也不呈現被停的卡組與目標。現在沒有寫入端，第一次正式版的比較不受影響；Claude 打算記成技術債（觸發點：第一個寫 `需要版本`／`need` 的寫入端上線前），請判斷要不要現在做。
8. `needed()` 的原文預篩：一行含 `need` 或 `\u` 才 `JSON.parse` 第二次，避免每一行都解析兩次（三年份的效能測試仍在 500 ms 內）。
9. `appendLine` 遇到帶 `need` 的行丟錯：它只接自己剛寫的行，`held`、`incomplete` 照舊帶過去；之後有寫入端時要整份重新合併。
10. state 的卡組閘門：`decks()` 不含需要新版的卡組，`blocked().decks` 列出；它的 ID（含候選）仍算用過，tracker 照常比對它的版本；讀得懂的卡組裡和它同一個 ID 的目標不排程、不能作答。
11. 寫入門檻同時看「state 最近讀到的」與「這次要寫的最新文字」（`save`、`resolve` 是編輯器的文字，`fillIds` 是 `modify` 回呼的原文）：任何一邊需要新版就回 `blocked needs-update`、不寫。`admit` 遇到它先讀完待讀再判斷，所以檔案改回讀得懂之後的第一次存檔就能寫。
12. `answer` 被拒時回傳 `null`（型別改成 `string | null`）、什麼都不寫；另加 `canAnswer(lt)`。作答與學習目標的狀態看 `lt`，取消看它指的那一筆的 `lt`（找不到那一筆照舊寫）；卡組的狀態變更，那一篇需要新版時也不寫；`cap` 這類沒有對象的變更照寫。
13. 複習畫面：被拒的那張 `rate` 回傳 `true`（畫面要換下一張），不進回看；回看裡那張後來被停時能按的評分是空的，`change` 先問 `canAnswer`，取消與新的評分一起寫或一起不寫。
14. 版本行用 `lastVersions` 找自己的檔（不分月份）裡時間最晚的 `app` 行（`need` 讀不懂的跳過）；同一個時間有不同的值（不確定）也寫一行。`version().own` 有 `waiting`、`same`、`queued`、`written`；`written` 只在 `state.flush()` 成功之後，state 自己不另外 flush。
15. 「版本」命令先等 `flush`（最多 2 秒，失敗也照樣顯示），內容用多行字串的通知、留到使用者關掉（`duration` 0）；第一行保留舊的 `Essence Cards：<BUILD>`；需要新版的卡組最多列 5 篇。多行字串在 Obsidian 的通知裡換不換行還沒在實機看過（見下面「實機」）。
16. 載入時的提示：`ready` 之後，或之後第一次出現需要新版的內容時，一次載入只提示一次；不列細節（細節在「版本」命令）。
17. 存檔按鈕：需要新版的卡組用自己的圖示與說明（`alert-circle`、`--text-warning`）；按下去照常交給 `state.save`，回 `blocked needs-update` 時提示同一句；`deckStatus` 對它不回待處理的問題，所以不開小視窗。
18. `install-vault --release`：用 `createNodeFiles` 在那一版的版本下讀 vault 的卡組與紀錄，有讀不懂的就列出並拒絕、什麼都不裝；讀不到的檔讓整個檢查失敗。
19. `eslint.config.js` 的預設專案上限 60 → 100：`tools/`、`tests/` 不在 `tsconfig` 的 `include` 裡，第二部分的新測試讓它超過 60，lint 會整個失敗。

## 行為與風險

- **使用者資料的第一個改變**：這一版裝上之後，每台裝置（iPhone 也是）第一次載入就在自己當月的紀錄檔寫一行 `set: app`。外掛的其他寫入（卡組、作答的格式）沒變。
- **明確延後**（任務說明〈這次不做〉）：外掛內的備份與還原畫面、設定頁、`需要版本`／`need` 的寫入端、規則分層、入口畫面的「給家長」一區（先用通知）。
- **和別的分支的關係**：`state` 讀寫協調已在 `main`，`f73525b` 合進來了（衝突的處理見〈審查對象〉）。`claude/icloud-placeholders` 之後會改 `src/obsidian/save.ts` 的提示（D-154），合併時由 Claude 處理衝突，這一輪不用看。
- **實機**：Claude 只在 Node 驗過（記憶體 Files 與 obsidian 替身）。Windows 版 Obsidian 的對照（版本行真的寫進測試 vault、「版本」命令的多行通知、需要新版的卡組在存檔按鈕上的樣子）還沒做：測試 vault 正被雲端佔位檔的 session 使用，等它用完才換建置。iPhone 的兩項併進下一次實機測試（任務說明 2-4）。

## 驗證方式

- Node 24 以上（Claude 用 v24.13.0）。在你自己開的 worktree 裡：`npm ci`、`npm run check`（Claude 在 `f73525b` 的 pre-commit 跑過，737 項全過）。完整檢查要在沙箱外跑（[quality.md](../docs/agents/quality.md)〈檢查指令〉）；不能解除沙箱時逐項列出失敗的測試並說明哪些是環境造成的。
- 只看這一輪的測試：`node --test --test-concurrency=1 tests/version.test.ts tests/need-lines.test.ts tests/state-gate.test.ts tests/state-version.test.ts tests/version-command.test.ts tests/deck.test.ts tests/review-session.test.ts tests/main-wiring.test.ts tests/save-wiring.test.ts tests/backup-core.test.ts tests/install.test.ts`；合併碰到的 `state` 寫入流程另看 `tests/state-writes.test.ts`、`tests/state-ids.test.ts`。

## 回報

寫在主資料夾的 `Claude Codex Discussion/2026-10-29-update-safeguards-2-review.md`（不用 commit，Claude 整合時會 commit）：

- 依嚴重程度排序。每項寫：哪一軸（規格／規範與設計）、觸發條件、預期／實際、影響、位置、證據（已重現／靜態推斷／待驗證），以及建議（合併前修／記進技術債並寫觸發點與完成條件／加檢查規則）。
- 「請特別看」的 9 點逐點寫結論；「Claude 自己選了做法的地方」的 19 點逐點回覆：同意，或建議的做法與理由。
- 最後一行寫沒查的項目與原因。不貼整份執行紀錄。
