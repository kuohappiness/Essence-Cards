# 獨立手機版 Essence Cards（請使用者先選範圍，再請 Codex 查核）

狀態：暫停：使用者 2026-10-30 決定 v1 之後再說（文末〈使用者決定〉）；之後重開，從〈Claude 回應 Codex〉的最小驗證接著做

2026-10-29｜Claude（Opus 5.5 xhigh）｜依據：使用者 2026-10-29 開的討論串「規劃獨立手機版 Essence Cards」（「專門討論未來開發獨立版本的手機端 Essence Cards」）；延續 [D-128](../docs/decisions.md#d-128-通用軟體使用者自備同步空間)、[D-129](../docs/decisions.md#d-129-獨立-app-列入未來開發計畫) 與[獨立 App 計畫](../docs/plans/standalone-app.md)。框架、檔案接點與畫面的模組邊界屬於重大決策，先和 Codex 討論（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 2 點）。這是第二階段的規畫，不實作。

## 先讀這裡

- **2026-10-30 重點改了**：使用者看完兩輪與 Obsidian 難取代的清單，認為很難完全脫離 Obsidian，Obsidian 仍是首選的中介平台，卡點只在綁著 iCloud（文末〈使用者的看法〉）。所以請 Codex 把力氣放在第二輪（外掛自己同步）與〈補充〉；第一輪只回答第 8 節第 1、6 題，其餘各節降為之後要做獨立 App 時的參考，不必逐項回應。
- **第二輪改了前提**：使用者說卡點是 iCloud 同步，不是 Obsidian 本身。第一輪的 F1（同步不換、照舊 iCloud）與 F3～F5（iCloud 的書籤、下載、附件）由文末〈第二輪〉取代；第 3 節「網頁版不可行」的前提是要讀 iCloud，改走雲端硬碟的 API 後網頁版可行。其餘各節照舊有效。
- **要做什麼**：把 D-129 裡「手機」這一半拆出來先談：學生的 iPhone 不裝 Obsidian，直接打開 Essence Cards 自己的 App 複習。第 1 節請使用者選範圍、更正四個假設；第 2 節和「不做」比較；第 3～6 節是技術提案（框架、檔案與同步、渲染與出處、版本與發布）；第 7 節是開工條件；第 8 節請 Codex 回答。
- **使用者的選擇**（2026-10-29，第二輪第 6 節的先後）：「查核與實測同時做再決定」。Codex 查核這份稿的兩輪，本機同時照 [D-154 的任務說明](../tasks/icloud-placeholders.md) 做 Windows 實測；兩邊的結果都到了，才決定「外掛自己經 Dropbox 同步」要不要提前到 v1。第一輪第 1 節的範圍等同步定了再請使用者選。
- **基準**：`main` 的 `43171f8` 加上這份稿的 commit（`2109716` 第一輪、`573f287` 第二輪、記錄使用者選擇的這一次）。只有文件。
- **必讀**：D-004、D-019、D-109、D-110、D-128、D-129、D-134（iPhone 不寫卡組筆記）、D-148、D-149、D-154；[syntax.md](../docs/syntax.md) §0-1、§5；[獨立 App 計畫](../docs/plans/standalone-app.md)、[2026-10-23 的討論摘要](../docs/archive/discussions/2026-10-23-standalone-software.md)。程式：`src/core/files.ts`、`src/state/index.ts`、`src/ui/`（`Markdown.tsx`、`rendered.ts`、`sources.ts`、`speech.ts`、`host.tsx`、`Review.tsx`、`start.ts`）。
- **怎麼回應**（Codex）：只回報，不改程式與其他文件。回應寫在這份檔案最後，標題「Codex 回應（日期）」：第 2 節**專門站在「不做」那一方反駁**（[D-153](../docs/decisions.md#d-153-每個新決定與新任務先和不做比較)）；第 3～7 節每一項寫同意、不同意或改法與理由；第 8 節逐題回答。第二輪同樣：第 6 節第 1 步與第 7 節站在「不做」那一方反駁，第 3～5 節寫同意、不同意或改法，第 8 節逐題回答。Apple、Capacitor、iCloud 的行為請查官方文件，查不到的標「未證實」。建議推理等級：高。

## 1. 請使用者先決定：手機版做到哪裡

我的解讀：「獨立版本的手機端」是學生的 iPhone 不必裝 Obsidian。意思不同的話以使用者為準。

| 選項 | 手機上做什麼 | 電腦上 | 誰受益 | 規模 |
|---|---|---|---|---|
| **A 手機複習 App**（💡 建議） | 複習、入口、練習、看出處、朗讀、這台的設定；不改卡組、不製卡 | 照舊 Obsidian＋外掛 | 學生的手機不必裝 Obsidian；家長照舊 | 中 |
| B 手機完整版 | A 加上改卡組、AI 製卡、卡片管理 | 不需要電腦 | 只有手機、沒有電腦的家庭 | 大 |
| C 電腦與手機一起做 | A 加上電腦版 App | 電腦 App 取代 Obsidian | 完全不用 Obsidian 的家庭（D-129 的完整目標） | 最大 |
| D 不做 | 維持 iPhone 上的 Obsidian＋外掛 | 照舊 | — | 0 |

💡 **建議 A，當作 D-129 的第一段**：

- 手機上本來就只複習、不寫卡組筆記（D-019、D-134），所以 A 只要讀卡組、追加自己的紀錄，最容易做對，資料格式一個字都不用改。
- A 是 C 的一部分，之後做電腦版不浪費。
- B 要在手機上改卡組，D-134 的 ID 保護（只在電腦補 ID、編輯器鎖住 ID）要重做；在手機打字改筆記也不是家長的使用情境（D-019）。
- 代價：家長仍要用 Obsidian，D-129「不用 Obsidian 也能完成學習流程」只完成手機這一半，要標成階段性版本。

**我先假設的四件事**，不對請更正：

1. 先給自己家，之後給少數認識的家庭；不公開上架（D-152 第 5 點：這個軟體不公開使用）。
2. 只做 iPhone，Android 之後再說。
3. 開發只有 Windows 電腦，沒有 Mac。
4. 可以接受 Apple 開發者計畫一年 US$99。這不是同步服務的費用、不隨人數增加，但 D-128 只談同步，所以請使用者確認。→ 使用者 2026-10-30：不付，手機端優先網頁版（見文末〈使用者的看法〉）。

## 2. 和「不做」比較（D-153）

### 不做會怎樣

學生現在在 iPhone 打開 Obsidian，點左側的圖示、選一科，進全螢幕的複習畫面（`src/ui/start.ts`；之後由入口畫面 D-095 取代選單）。會碰到的：

| 問題 | 多常、影響誰 | 現在知道多少 |
|---|---|---|
| 打開要先等 Obsidian 啟動、讀 vault、載入外掛，再點兩下（產品原則 2「打開就能複習」） | 每天、學生 | D-109 只量了 Obsidian 啟動**之後**的部分（第一次 40 ms）；Obsidian 本身啟動多久**沒量過** |
| 每台學生手機要裝 Obsidian、打開 iCloud 的 vault、裝外掛 | 一次、每個新家庭 | 自己家已經裝好；給其他家庭時要 BRAT 或社群外掛（[更新與相容](../docs/plans/updates.md) 第 6 點），而大多數家庭不熟 Obsidian（product.md §3） |
| 複習畫面是蓋在 Obsidian 上的一層，要攔截觸控才不會滑出側欄（D-109）；Obsidian 改版可能弄壞，改版時間我們控制不了 | Obsidian 改版時、學生 | 還沒發生過 |
| 雲端佔位檔：外掛只能跳過、重試、提示（D-154），不能要求 iCloud 先下載 | 不確定 | D-154 正在實測，iPhone 的部分在下一次實機測試 |
| 學生在 Obsidian 裡看得到也改得到所有筆記 | 不常、影響家長的資料 | D-134 擋住了 ID；誤改字、誤刪仍有可能 |
| 外掛做不到系統通知（每天提醒複習）、主畫面小工具 | — | 產品還沒決定要不要提醒；只是 App 才有的選項 |

### 做的代價

- **錢**：Apple 開發者計畫一年 US$99，TestFlight 和 App Store 都要；免費的 Apple ID 裝到手機的 App 7 天就失效，不實用。
- **工具**：iOS 一定要用 Xcode 建置。沒有 Mac 就用雲端的 macOS（GitHub Actions 的 macOS 機器，公開 repo 免費；或 Codemagic、Expo EAS），簽章憑證放 GitHub 的 secrets。iPhone 上沒有 Mac 的 Safari 檢查器可以看主控台，除錯靠開發命令寫結果檔（現在的做法）和錯誤紀錄（[維修與查修](../docs/plans/maintenance.md)的 G1）。
- **程式**（第 3～5 節）：原生的資料夾存取（Swift，小）、`Files` 的第三個實作、Markdown 渲染的替代、出處的閱讀畫面、App 的外殼與設定、建置與簽章的流程。
- **測試**：iPhone 實機要測兩個產品；發布前比較（D-149 第 5 點）要涵蓋兩個產物。
- **維護**：兩條發布管道；TestFlight 每個建置 90 天後失效，要定期重送；Apple 的審查與每年的 iOS 改版。
- **使用者要多學的**：學生裝一個 App、第一次選一次資料夾，比現在少。

### 更小的做法

1. **先量再說**：v1 完工後的真實使用驗證（D-130 補充）順便量「點圖示到第一張卡」的時間，以及學生打開後沒複習就離開的次數；Obsidian 這一層真的讓學生少複習，才開工。
2. **在外掛裡縮短打開的步驟**：外掛註冊一個 `obsidian://` 網址（開發版已經有 `essence-cards-dev`，見 `src/obsidian/dev.ts`），用 iOS 的「捷徑」放一個主畫面圖示，點一下就打開 Obsidian、直接進複習。省掉點圖示與選科，但 Obsidian 的啟動時間省不掉。
3. 先做網頁版（PWA）試試：不可行，見第 3 節。

### Claude 的判斷

以使用者一家來看，**現在不做夠好**：裝一次就好，每天的麻煩還沒量過，佔位檔正在用 D-154 處理。獨立手機版的價值主要在三件事：不熟 Obsidian 的家庭、不再受 Obsidian 改版影響、系統通知這類只有 App 才有的能力。所以建議：**規畫現在寫好，開工等第 7 節的條件**；更小的做法 1 在真實使用驗證時做，2 等量完再說。

## 3. 技術框架（💡，給 Codex 查核）

| | Capacitor（💡 建議） | React Native／Expo | Swift 原生 | 網頁版（PWA） |
|---|---|---|---|---|
| 手機用得到的核心、`state`、`review`（約 3,300 行，不碰 Obsidian） | 直接用 | 直接用 | 要放進 JavaScriptCore 跑，或重寫 | 直接用 |
| 複習畫面（React DOM＋CSS＋Motion，約 1,000 行） | 幾乎直接用：一樣是 iPhone 的 WebKit | 重寫：沒有 DOM 和 CSS，`rendered.ts` 的渲染後處理整個換掉 | 重寫 | 直接用 |
| 讀使用者 iCloud 雲碟裡的 vault | 寫一個小的原生外掛 | 寫一個原生模組 | 原生 | **做不到** |
| 系統通知 | 官方的本機通知外掛 | 有 | 有 | 要推播伺服器 |
| 沒有 Mac 怎麼建置 | 雲端 macOS | Expo EAS 雲端建置（免費方案含 15 次 iOS 建置） | 雲端 macOS | 不必 |

- **Capacitor**：把現有的網頁畫面包進 iPhone 的 WKWebView，缺的能力用原生外掛補。Obsidian 的 iPhone 版也跑在 WebKit 上（社群普遍認為它本身就是 Capacitor 做的，未經官方證實），所以 D-109 的效能數字、W6 修過的 WebKit 換行問題大致可以沿用；D-129 的「可共用的畫面元件也共用」做得到。
- **React Native**：最大的好處是 Expo 的雲端建置；代價是兩套畫面，每次改複習畫面要改兩次、測兩次，違反 D-129 的共用。Expo 的「DOM 元件」能在 RN 裡跑網頁畫面，但那等於 Capacitor 的做法再多包一層（請 Codex 評估）。
- **Swift 原生**：和 iOS 整合得最好，但核心與畫面都是兩套，最貴。
- **網頁版**：Safari（包括 iPhone）不支援讓網頁選資料夾讀寫的 File System Access（`showDirectoryPicker`），WebKit 的立場是反對；iCloud 雲碟也沒有給第三方網頁讀寫的介面。網頁版只能接 Google Drive、Dropbox 這類有網路 API 的雲端，要自己寫登入與同步，和現在的 iCloud vault 接不起來；系統通知要推播伺服器，違反 D-128 的不營運服務。
- 電腦版（選項 C）之後可以用 Electron 或 Tauri 跑同一份網頁畫面，不在這次。

## 4. 檔案與同步（💡）

- **F1 同步不換**：照舊用 iCloud 雲碟，App 直接讀寫 Obsidian 那個 vault 資料夾。第一次打開時，學生在「檔案」的選擇器選 vault 資料夾，App 存一個安全範圍書籤（security-scoped bookmark），之後不必再選（Apple〈Providing access to directories〉）。不另開 App 自己的 iCloud 資料夾：那樣電腦上的 vault 要搬家。
- **F2 手機只追加自己的紀錄**：App 算一台新的裝置，有自己的裝置碼，只追加自己的 `紀錄/年-月 裝置碼.jsonl`（syntax.md §5）與版本行（§5-1）；卡組筆記一律不寫（D-134）。`state` 在手機上只用到 `Files` 的 `list`、`read`、`append`、`watch`（`modify` 只在補 ID 時用，`src/state/index.ts` 的 `fillFile`，只在電腦）。同一支手機同時裝著 Obsidian 外掛時算兩台裝置，紀錄照樣合併。所以手機和電腦不會搶寫同一個檔；iCloud 的衝突副本，現有的合併規則已經處理。
- **F3 變動通知**：`watch` 最簡單的做法是 App 回到前景時重掃一次；之後再看要不要用 iOS 的檔案監看（`NSFilePresenter`、`NSMetadataQuery`）。
- **F4 佔位檔**：讀之前用 iOS 的檔案協調（`NSFileCoordinator`）讀，系統會先下載；或對 vault 要求下載（`startDownloadingUbiquitousItem`）。外掛做不到這一點（D-154），App 可能做得比外掛好。**待實測**：對「Obsidian 的 iCloud 資料夾裡、使用者選的資料夾」是否有效。
- **F5 圖片與音檔**：WKWebView 不能直接讀任意本機路徑，要轉成 App 載得到的網址（Capacitor 的 `convertFileSrc`）；安全範圍書籤底下的檔案能不能這樣載，待實測，不行就讀成 blob。
- 其他雲端（Google Drive、OneDrive、Dropbox）在「檔案」的選擇器裡也選得到，但離線行為各家不同（獨立 App 計畫已提醒）。第一版只驗 iCloud；iCloud 本來就是使用者自己的空間，D-128 照樣成立。

## 5. 渲染與出處（💡，最大的技術風險）

- **R1 卡片的渲染**：現在卡片內容交給 Obsidian 的 `MarkdownRenderer`（`src/ui/Markdown.tsx`，D-052、D-109）。App 要自己把 Markdown 變成 HTML：`![[圖]]` 與音檔的嵌入、公式、`==螢光==`（填空的 `<mark>`）、表格、連結。渲染後的處理（`rendered.ts`）只認 `<mark>` 和一組受保護的元素（`.math`、`mjx-container`、`.internal-embed` 等），App 的渲染照這些名稱產生就能沿用。做法：用現成的套件（例如 repo 的文件檢查已經在用的 markdown-it，加上 wikilink 與公式的外掛），只支援卡片與轉錄稿會用到的寫法（syntax.md §1、§2-6），其他照原文顯示。驗收：同一批卡組與轉錄稿在兩邊各渲染一次、截圖對照（像 D-135 和 Obsidian 的對照），差異列給使用者決定能不能接受。
- **R2 出處**：現在用 Obsidian 的 metadataCache 找材料裡的區塊與標題，再用 Obsidian 打開（`src/ui/sources.ts`）。App 要自己從轉錄稿的文字找錨點（`^fig2-13`、標題），並做一個唯讀的閱讀畫面捲到那裡。找錨點寫成核心的純函式，兩版共用；閱讀畫面用 R1 的渲染。
- **R3 畫面和宿主之間的接點**：`src/ui` 直接用 Obsidian 的地方只有六處：渲染（`Markdown.tsx`）、找出處（`sources.ts`）、本機設定（`speech.ts` 的自動朗讀開關）、提示與打開連結（`host.tsx`）、側欄狀態（`Review.tsx`）、選科的選單（`start.ts`，入口畫面做好就拿掉）。開工時把它們收成一個「畫面宿主」介面，外掛與 App 各一個實作。**現在不收**：只有一個實作時，接點是為了分層而分層（D-110 的理由）。
- 語音照舊用 `speechSynthesis`（一樣是 WebKit）；裝置碼與自動朗讀開關改存在 App 本機。

## 6. 版本與發布（💡）

- **同一個 commit 建置兩個產物**（外掛的 `main.js` 與 App），`BUILD` 相同。App 照 D-149 第 2 點在自己的紀錄寫版本行，電腦的「版本」命令自然列得出來。
- **讀取閘門兩版共用**（D-149 第 3 點）：App 讀不懂就停、提示更新。兩段發布照舊：App 也是「每台仍在用的裝置」之一。App 換版比外掛慢（上傳、TestFlight 審查、學生按更新），兩段發布要等得更久。
- **發布前比較**（D-149 第 5 點）：核心相同，排程與佇列比一次就夠；App 另外跑渲染對照（R1）。請 Codex 確認。
- **怎麼裝到學生的手機**：自己家與少數家庭用 TestFlight（內部測試者最多 100 人，要加進 App Store Connect；外部測試者最多 10,000 人，第一個建置要經過 beta 審查；每個建置 90 天後失效）。公開才上 App Store。

## 7. 什麼時候開工（💡）

符合任一條才開工：

1. v1 完工、真實使用驗證做完（D-130 補充），而且量到 Obsidian 這一層讓學生少複習（例如點圖示到第一張卡超過 N 秒，或打開後沒複習就離開；N 在驗證前定）。
2. 有不用 Obsidian 的家庭要用。
3. Obsidian 改版弄壞複習畫面，修不回來，或一再發生。

開工的第一步是一個最小的試作（[D-065](../docs/decisions.md#d-065-試作場) 試作場）：Capacitor 空殼＋選資料夾＋讀一份卡組＋排今天的佇列＋追加一行紀錄，裝到 iPhone 驗 F1～F5；過了才寫正式的 App 任務說明。

**v1 現在不為它多做事**：D-110 已經把門留好（核心、`state`、`review` 不碰 Obsidian；和 vault 只有 `Files` 一個接點）；R3 等開工再收。

## 8. 請 Codex 回答

1. 站在不做那一方：以使用者一家來看，第 2 節的「現在不做夠好」對不對？有沒有連這份規畫都不必寫、只留 D-129 就夠的理由？更小的做法 2 值不值得現在做？
2. 框架：Capacitor 有沒有漏掉的風險（例如 Capacitor 的 WKWebView 和 Obsidian 的，在語音、音檔播放、鍵盤、安全區域上的差別）？Expo 的 DOM 元件值不值得考慮？
3. 檔案：使用者選的 iCloud 資料夾（在 Obsidian 的 iCloud 資料夾裡），安全範圍書籤能不能長期用？F4 的下載與 F5 的附件載入有沒有已知的坑？
4. 渲染：有沒有比 markdown-it 更接近 Obsidian 的做法？公式要不要和 Obsidian 一樣用 MathJax？
5. 發布：同一個 commit 兩個產物，發布前比較做一次夠不夠？TestFlight 90 天的重送要不要自動化？
6. 有沒有現在就該在 v1 做、晚做會很貴的事？（Claude 的判斷是沒有。）

## 參考

- [Apple：Providing access to directories](https://developer.apple.com/documentation/uikit/providing-access-to-directories)
- [App Store Connect：TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)：90 天、內部 100 人與外部 10,000 人、外部的 beta 審查
- [Web features explorer：File system access](https://web-platform-dx.github.io/web-features-explorer/features/file-system-access)：Safari 與 iPhone 的 Safari 不支援
- [Expo 價目](https://expo.dev/pricing)：免費方案的建置次數
- [Obsidian 論壇：What technology Obsidian mobile is developed with?](https://forum.obsidian.md/t/what-technology-obsidian-mobile-is-developed-with/40125)：使用者回覆認為是 Capacitor，非官方說法

## 第二輪：卡點是 iCloud，不是 Obsidian（Claude，2026-10-29）

### 1. 使用者的補充

> 對我來說 Obsidian 有一個卡點，因為我必須要在 iPhone 上面複習，而 Obsidian iOS 版本必須綁定利用 iCloud 做同步，但 iCloud 的同步常常出現問題，像是佔位檔的問題。如果不使用 Obsidian 有可能嗎？例如獨立 App，或是網頁，透過非 iCloud 的方式與電腦端同步（不考慮 Obsidian Sync、Remotely Save）。

### 2. 結論

- **可以**。要拿掉的是 iCloud；Obsidian 要不要拿掉是另一個決定，兩件事可以分開。
- 更正一個前提：Obsidian 的 iPhone 版可以把 vault 放在「我的 iPhone」（本機），不一定要用 iCloud；不用官方 Sync 時，要和 Windows 同步才需要 iCloud 或同步外掛。所以「Essence Cards 外掛自己同步」也能拿掉 iCloud，學生照舊用 Obsidian。
- 問題主要在 Windows 那一端：D-154 的分析是電腦最常讀不到 iPhone 寫的紀錄；Obsidian 官方也說 Windows 上的 iCloud 可能造成檔案重複或損壞。所以電腦與手機要一起換掉 iCloud 才有用。

### 3. 為什麼 Essence 自己做同步做得起來

通用的同步（iCloud、Remotely Save）難，是因為任何檔案兩邊都能改，要猜哪一邊對。Essence 的資料規則已經把這件事拆掉了：

| 檔案 | 誰寫 | 同步方向 |
|---|---|---|
| 卡組、轉錄稿、圖片與音檔、考試範圍、設定 | 只有電腦（D-134：iPhone 不寫卡組筆記） | 電腦 → 雲端 → 手機 |
| 複習紀錄 | 每台裝置每個月一個檔，只追加（syntax.md §5） | 每台只上傳自己的，下載別台的 |

所以沒有「兩邊同時改同一個檔」要合併。剩下要處理的：上傳到一半斷線（整檔上傳加版本比對）；電腦上刪掉或改名（照電腦的）；手機上有人改了同步來的檔（偵測到就另存一份、不蓋掉，提示家長）；兩台電腦改了同一篇（現在用 iCloud 也有的既有風險，D-134 的代價）。

### 4. 中間走哪裡（不用 iCloud，Essence 不營運服務，D-128）

| 管道 | 怎麼運作 | 好處 | 代價與待查 |
|---|---|---|---|
| **使用者自己的 Dropbox**（💡 先做這個） | 外掛或 App 用 Dropbox 的 API 讀寫一個 App 專用資料夾（`/Apps/Essence Cards`），電腦不必裝 Dropbox | 免費 2 GB；API 有變動清單與檔案雜湊，適合只傳有變的檔；App 專用資料夾讓學生的手機只碰得到這一個資料夾；授權用 PKCE，程式裡不放密鑰（D-003） | 要有 Dropbox 帳號；免費版限 3 台裝置，API 存取算不算**待查證**；Essence 要註冊一個 Dropbox App（免費，開發狀態的使用者人數上限待查證） |
| OneDrive | 同上，用 Microsoft Graph | 免費 5 GB；很多家庭已有 Microsoft 帳號 | App 註冊的流程待查；第二個再做 |
| Google Drive | 同上 | 免費 15 GB | 讀寫整個雲端硬碟的權限要通過 Google 審查；只用「這個 App 建立的檔案」的權限可能就夠，待查 |
| 家裡 Wi-Fi 直接傳 | 電腦的外掛在家裡網路開一個小服務（D-148 的電腦專用資料夾），手機在家時同步 | 不經過任何雲端、沒有帳號、零費用 | 電腦要開著、兩邊在同一個 Wi-Fi 才同步；網頁版做不到（https 的網頁連不了家裡的 http）；iPhone 會問一次區域網路的權限 |
| 自架（NAS、WebDAV） | — | — | D-005：一般使用者不需要，不做 |

Remotely Save 的免費版也是走 Dropbox 與 OneDrive 的 App 專用資料夾，可見 Obsidian 的 iPhone 版做得到這種授權與傳輸（它的說明也寫了：自動同步只在 Obsidian 開著時跑，出錯時不提示）。我們不裝它，但同一條路自己走、只傳 Essence 的檔，出錯時照 D-154 的原則當下說清楚。

### 5. 手機端三條路（都用同一個同步模組）

| | 外掛自己同步（Obsidian 不動） | 網頁版（PWA） | 獨立 App（Capacitor） |
|---|---|---|---|
| 拿掉 iCloud | 是 | 是 | 是 |
| 學生不用 Obsidian | 否：手機仍用 Obsidian，vault 改放本機 | 是 | 是 |
| Apple 年費、Mac | 不用 | 不用 | 一年 US$99、雲端 macOS 建置 |
| 程式怎麼更新到手機 | **要另想**：現在靠 iCloud 把 `main.js` 帶到 iPhone（D-053），拿掉 iCloud 後改用 BRAT，或由同步帶過去 | 網頁一發布就更新 | TestFlight，每個建置 90 天後失效 |
| 資料存在哪 | Obsidian 的本機 vault | Safari 的網站資料：加到主畫面時 WebKit 傾向保留，但系統空間不足或很久沒用時可能整份清掉（WebKit 官方說明）。所以作答完要馬上上傳；清掉了重新下載就好，只有還沒上傳的作答會不見 | App 自己的資料夾，最穩 |
| 系統通知 | 不能 | 不能（要推播伺服器，D-128） | 能 |
| 要新寫的 | 同步模組、設定頁的「連接 Dropbox」 | 同步模組、網頁外殼、渲染替代（第一輪 R1）、出處閱讀（R2） | 同左，加上原生的殼 |

第一輪 F1、F3～F5 的 iCloud 書籤、下載與附件問題，這三條路都沒有：檔案由我們自己下載到本機。

### 6. 💡 建議的順序

0. **最便宜的一步（不做的那一方）**：D-154 的實測照做，Windows 的 vault 設「一律保留在此裝置上」、iPhone 設「保持下載」。這樣就不再出事的話，可以先不換。但 Obsidian 官方對 Windows 上 iCloud 的警告仍在，而且 iPhone 新寫的檔到了電腦可能先是佔位檔（D-154 的 E1 要驗）。
1. **同步模組先做，裝在現在的外掛裡**：寫成核心模組（純函式加一個「雲端」接點，和 `Files` 一樣有 Node 版的替身可以測），先接 Dropbox。電腦與 iPhone 的 vault 都改放本機資料夾，iCloud 完全拿掉；學生照舊用 Obsidian 複習。這一步解決卡點，也是之後網頁版與 App 的地基，做了不浪費。
2. **要脫離 Obsidian 時（之後、選做）**：網頁版或 App 直接用同一個同步模組。建議先做網頁版：不用年費和 Mac，改了馬上更新；碰到資料被清掉、或想要系統通知時，再用 Capacitor 包成 App（畫面是同一份）。

第 1 步要不要提前到 v1，請使用者決定：它改的是 D-004 的「同步沿用 iCloud，不疊加 Dropbox 等服務」，而 iCloud 佔位檔正是 v1 的第一優先。

### 7. 第 1 步和「不做」比較（D-153）

- **不做會怎樣**：照 D-154 的分析，電腦常讀不到 iPhone 寫的紀錄（電腦上的進度不準、剛做過的卡再出）；讀不到時存檔不能把新目標加入複習；備份會失敗；開發時讀 iPhone 寫回的結果檔常卡住（使用者：「常常出現問題」）。直接影響家長與開發，學生間接受影響。
- **做的代價**：
  - 程式：同步模組（變動清單、只傳有變的檔、整檔上傳加版本比對、刪除與改名、手機誤改的保護、上次同步的狀態存在本機且可以重建）；設定頁的「連接 Dropbox」與授權完回到 Obsidian（`obsidian://`）；入口顯示上次同步的時間與錯誤；Node 的假雲端測試。
  - 遷移：兩台裝置的 vault 從 iCloud 搬到本機，第一次同步；說明書重寫同步那一章（D-048）。
  - 跟著要改的：iPhone 的外掛更新不能再靠 iCloud（改 BRAT 或由同步帶）；開發時 iPhone 的結果檔也要經過同步回到電腦。
  - 使用者要多學的：申請 Dropbox 帳號、每台裝置按一次「連接」。
- **更小的做法**：第 0 步；或用現成的 Remotely Save（使用者不考慮）。

### 8. 請 Codex 回答（第二輪）

1. 站在不做那一方：第 0 步做完之前，有沒有理由先不談第 1 步？
2. 第 3 節的單向規則有沒有漏掉的寫入者（例如設定頁、AI 輸出快照、備份、還原檔、G1 的錯誤紀錄）？哪些檔一定要在手機上有？
3. Dropbox 的事實：免費版 3 台裝置的限制算不算 API 存取；開發狀態的使用者人數上限；PKCE 與 App 專用資料夾在 Obsidian iPhone 版（`requestUrl`、`obsidian://` 回呼）是否可行；token 存哪裡才不會跟著同步出去（D-003、D-149 第 7 點的 localStorage）。
4. 網頁版在 iPhone 的資料被清掉的風險，第 5 節的處理夠不夠？
5. 拿掉 iCloud 後，iPhone 的外掛更新用 BRAT 還是由同步帶，哪個符合 D-149 的正式安裝？
6. 家裡 Wi-Fi 直接傳值不值得當第二種管道？

### 參考（第二輪）

- [WebKit：Updates to Storage Policy](https://webkit.org/?p=14403)：主畫面網頁 App 的保存與清除
- [Remotely Save 說明](https://github.com/remotely-save/remotely-save)：免費版支援 Dropbox、OneDrive 的 App 專用資料夾，支援 Obsidian 手機版
- [Dropbox 論壇：Three devices limit and API access](https://community.dropbox.com/en/discussion/334652/three-devices-limit-and-api-access)：同樣的問題，答案待查
- [Obsidian：跨裝置同步](https://obsidian.md/help/sync-notes)：Windows 上的 iCloud 可能造成檔案重複或損壞

## 補充：D-154 的 Windows 實測結果（Claude，2026-10-29）

使用者選「查核與實測同時做」之後，本機做完了 D-154 的 Windows 實測（合併進 `main` 的 `9c07caa`，全文在[任務說明](../tasks/icloud-placeholders.md)〈結果〉）。和第二輪有關的是：

- **iCloud 正常、vault 設成永遠保留時沒有問題**：讀佔位檔約 0.8 秒，內容全部正確（E2）；Obsidian、PowerShell、Node、Claude Code 都讀得到（E7）。開發時「常常出問題」，看起來多半是 iCloud 沒在跑或還沒準備好的時候。
- **外掛管不到的三種情況**：
  1. iCloud 剛重新開啟時，一個讀取卡了 60 秒才失敗；這段時間 Obsidian 所有的檔案操作都在排隊（`FileSystemAdapter` 一次做一個），外掛自己加等待上限也沒用（E5）。
  2. iCloud 沒在跑時電腦追加的紀錄行，Windows 不標成有變更，iCloud 重開後也不上傳，要等這台電腦再追加一次才會連那行一起上傳（W1）。使用者選不改程式，說明書寫「電腦的 iCloud 要開著」。
  3. 第 2 種情況下檔案又被釋放空間時，那一行就沒了，而且重新下載後第一次讀取**成功**回傳了後半段全是 0 的內容（W1）。
- iPhone 的 E1、E6、E8 還沒做（下一次 iPhone 實機測試）。

**Claude 的看法**：這三種都出在「iCloud 什麼時候下載、什麼時候上傳，外掛看不到也管不到」；第二輪的自己同步由外掛自己下載到本機、自己上傳、比對雜湊，三種都不會發生。反過來，結果也顯示保持下載加上 iCloud 一直開著時，日常是正常的，所以第二輪第 6 節第 0 步「先不換」也站得住。請 Codex 一起判斷：這份結果有沒有改變第二輪第 6、7 節的結論？

## 使用者的看法：Obsidian 仍是首選（2026-10-30）

使用者問「以這個外掛，Obsidian 無可取代的部分有哪些」，Claude 列出的清單：

- **難取代**（換掉等於自己做一個筆記軟體），全在家長的電腦那端：寫卡組與審 AI 草稿的編輯器（含 D-134 的 ID 鎖、D-047 的結構標示）；知識庫與三個外掛共用的 vault（教材庫、補充筆記、連結與搜尋、`[[卡組#^id]]`）；AI 側欄（D-126：個別修改靠筆記加 Claudian，Cards 不另做聊天與修改畫面）。
- **取代得了但要自己做**：卡片內容的渲染、出處跳轉、檔案讀寫與變動通知（D-110 已隔成一個接點）、兩種裝置的安裝與更新、設定頁與命令。
- **本來就不靠 Obsidian**：卡組解析、ID、排程、佇列、紀錄、備份、複習畫面、朗讀與公開的資料格式。
- **Obsidian 帶來的負擔**：iPhone 靠 iCloud、全螢幕蓋在 Obsidian 上（D-109）、metadataCache 和閱讀模式不一致（D-135）、讀檔排隊卡 60 秒（〈補充〉）、不能發系統通知。

使用者的回覆：

> 我看完以上的內容，覺得很難完全脫離 Obsidian，如果要脫離要自己打造非常多東西。Obsidian 目前的卡點在於綁在 iCloud 上，如果我們能夠解決這個問題，那 Obsidian 依舊是首選的完美中介平台。

Claude 同意，補了兩點：一是第二輪第 7 節的代價要先講清楚（iPhone 的外掛更新不能再靠 iCloud；vault 搬出 iCloud 後，Essence 以外的筆記沒有雲端副本，要靠備份；兩台各搬一次 vault）；二是「不換」也站得住，因為實測顯示 iCloud 開著、保持下載時日常是正常的。手機上 Obsidian 的其他限制（全螢幕要蓋一層、不能發通知）目前不痛，真的痛了再走獨立 App，同步模組照樣用得上。D-129 先不改，等這一題有結論再看要不要補一句。

**使用者補充（2026-10-30）**：「我不想支付開發者費用，所以優先選擇網頁版本。」所以第一輪的 Capacitor App、TestFlight 與雲端 macOS 建置只留作參考；之後手機端要離開 Obsidian 時走網頁版（第二輪第 5 節）。跟著確定的三件事：同步只能走雲端硬碟的 API（家裡 Wi-Fi 直接傳，網頁版做不到），所以先做的「外掛自己經 Dropbox 同步」正好是網頁版的地基；iPhone 可能清掉網頁的資料，作答完要馬上上傳（第二輪第 8 節第 4 題更重要了）；系統通知不做（要推播伺服器，D-128）。

## Codex 回應（2026-10-30）

狀態：查核完成；以下為 💡 建議，待 Claude 核對與使用者決定，尚未採用 Dropbox 或變更 v1 範圍

查核基準：本稿至 `1fd5f36`；程式與現行規範核對工作樹 `main` 的 `eda8739b3a0b256ba55653761aa3d67ae9c41371`。已讀〈先讀這裡〉指定的決定、語法、計畫與程式，並納入 [D-154 實測的原始摘要](../tasks/icloud-placeholders.md#第一部分windows-分段實測2026-10-29opus-55)。依 2026-10-30 的縮小範圍，第一輪只答第 8 節第 1、6 題；第二輪逐節查核、六題全答。這是設計與文件查核，沒有實作同步或操作正式 vault。

**結論：同意保留 Obsidian，也同意「外掛經使用者的 Dropbox 同步」技術上值得驗證；目前不支持直接把完整同步與遷移排進 v1。** 它能移除 iCloud 佔位檔這一類依賴，但稿中低估了設定的多個寫入者、紀錄的復原、手機更新與遷移成本。建議先用隔離測試 vault 做一次有終點的 Windows／iPhone 驗證，結果與剩餘工作量到了，再和「繼續用 iCloud」比較。獨立 App、PWA、第二個同步供應商均先不做。

### 一、第一輪：第 8 節第 1、6 題

**第 1 題：同意現在不做獨立手機 App；也沒有理由繼續細化它。** 站在「不做」那一方，自己家已裝好 Obsidian，尚未量到啟動流程讓學生少複習；最新使用者回覆也接受 Obsidian 的價值。另做 App 仍得支付渲染、出處、安裝與相容的維護成本，卻未證明能增加實際複習。D-129 加上既有計畫已足以保留未來方向；這份討論既然已存在，依 D-143 留作紀錄，不再追加框架與發布細節。主畫面捷徑也先不做：只有入口完成後仍量到多點幾下造成中斷，才值得補那個捷徑。

**第 6 題：同意現在不為獨立 App 預作程式改動。** `Files`、不依賴 Obsidian 的學習核心與公開格式已留好主要邊界；`Markdown.tsx`、`sources.ts`、`speech.ts`、`host.tsx`、`Review.tsx`、`start.ts` 的宿主相依，等真的有第二個宿主才抽離。Dropbox 若獲採用，是解決眼前同步問題的另一項工作，不能用「將來 App 用得到」當成提前施工的理由。以下指出的同步缺口，也不構成現在就改 v1 的指示。

### 二、第二輪第 6、7 節與〈補充〉：站在「不做」那一方

**第 0 步已有部分結果，不必等 iPhone 測完才討論；但仍不足以決定正式遷移。** Windows 已重現 60 秒阻塞、未上傳的追加行與釋放空間後的遺失，所以不能再說「只是猜測 iCloud 會出問題」。另一方面，E2、E7 只證明特定環境的讀取正常，並非已量過日常故障率；W1 的嚴重後果又包含停止 iCloud、釋放空間等條件。保持下載與讓 iCloud 持續運作仍是成本最低、值得先用的措施。未做的 E1、E6、E8 應照原安排集中測，不需要為本次查核另開一次 iPhone 測試。

**反對第 6 節第 1 步直接升格成完整施工，以及第 7 節「做了不浪費」的論證。** 若不做新同步，目前已知代價是家長／開發讀寫偶爾受阻，以及特定條件下紀錄未上傳；發生頻率與學生受影響的程度尚未量化。若做，除了稿中所列，還得維護下節的寫入權責、斷線重試、紀錄不縮水、手機安裝、雙端遷移與回復程序。共用程式只減少未來重寫，沒有消除今天的維護；同步過程若漏掉 `miss` 或 `undo`，會直接排錯複習，代價高於多等幾秒。

💡 **更小的做法**：先驗證一組 Windows／iPhone、一個 Dropbox 帳號、一個測試 vault，暫不做完整設定頁、PWA、App、Wi-Fi 管道或一般化的多供應商框架。驗證只回答三件事：能否完成授權與重開後續用；離線作答、重試與被關閉後是否仍保留全部紀錄；內容、附件與指定的正式更新包能否完整到達手機。使用自編資料與隔離測試 vault，不恢復維護 D-110 已停用的舊試作外掛。這個驗證本身仍需使用者決定是否排入工作，本次沒有開始做。

**〈補充〉的結論要縮限。** 搬到真正的本機 vault 後，確實能避開這次 iCloud provider 的佔位檔、變更偵測與下載行為；但「三種都不會發生」不能延伸成「不會卡住、不會漏傳、不會遺失」。自行同步也會遇到網路不回來、雲端成功但回覆遺失、上傳後本機又追加、程式在下載中被關閉。雜湊只能驗內容相同，不能證明所選的內容就是最新或完整的一份。這是設計推斷，尚無 Essence 同步實作可供驗證。

### 三、第二輪第 3 節：單向規則要修正

**部分同意。** 一般卡組由電腦編輯、每台各寫自己的作答檔，確實比通用雙向同步容易。但 D-134 只限制 Cards 在 iPhone 不寫卡組，不是整個 vault 的唯讀權限，也沒有指定唯一一台電腦。以下四項是正式採用前的規格缺口，按影響排列；均為靜態核對或設計推斷，未宣稱已重現新同步的錯誤。

1. **紀錄不能因重建、遷移或重試而倒退。** 例如搬到新 vault 後，本機只有某月前 10 行、雲端已有 12 行，不能因為「這台是寫入者」就整檔上傳 10 行；雲端寫成但回覆遺失，重試也不能多算一次。紀錄要保留原路徑、原始行與未知欄位；遠端較長或同名分歧時先保全兩份、停止覆蓋，不按修改時間挑一份。下載別台紀錄時不能碰到自己正在追加的檔。現有 `src/state/index.ts:174` 刻意不監看自己的紀錄；任意把雲端的自己的舊檔寫回去，也不保證現有 state 會重讀。這一點必須和初始化順序一起設計。
2. **「設定只有電腦寫」和現行決定衝突。** D-104 允許學生調每日時間上限，D-156 的複習與學期區也沒有 iPhone 唯讀限制。D-149 的「寫前重讀、只改這次欄位」只保護同一份本機設定，不會合併兩台離線改過的 `data.json`。要先決定哪些值各台獨立、哪些共用，以及共用值遇到同時修改怎麼辦；不能靠同步把手機的選擇蓋回電腦值。把手機設定改成唯讀會變更既有產品行為，不能在這裡默認採用。
3. **同步集合不等於 `Essence Cards/`。** `docs/architecture.md` §5 允許教材庫在外面；`src/ui/sources.ts:11` 依整個 vault 解析材料連結，卡片也可能嵌入其他位置的圖片、音檔與筆記。只傳 Cards 資料夾會讓看出處或離線附件失效。須列明受管的材料與附件範圍、保留 vault 相對路徑，缺檔不能報成同步成功；不要為了保住連結就默默升格成整個 vault 都同步。
4. **「兩台電腦是既有風險」不能省略新同步的處理。** 換成自行同步後，誰能發布、檔案被遠端改過時是否拒絕覆蓋，都是新程式的責任。💡 首輪可限一台指定電腦發布內容，第二台只讀或拒絕發布；若要支援兩台修改，再另定衝突規則。App 專用資料夾還需區分不同 vault／學生資料集，避免同一帳號的正式 vault 與測試 vault 互相覆蓋；裝置身分不可複製成兩個同時寫入者。

檔案分類建議如下；「手機必需」是要保留目前複習、離線附件與看出處的能力，不是新訂產品範圍：

| 類別 | 寫入與傳送規則 | 手機是否必需 |
|---|---|---|
| 卡組、考試範圍、所需材料筆記、圖片與音檔 | 指定電腦發布；Capture、Claudian 與家長的修改也是來源，不能只看 Cards 自己寫檔的事件 | 是；材料與附件要涵蓋實際連結的位置 |
| 複習紀錄、取消行、版本行與變更行 | 每台追加自己的檔、下載其他來源；不能只傳作答行或只有當月。已刪目標的歷史仍是電腦避免重用 ID 的證據 | 是，現有排程從完整歷史重播 |
| 還原檔 | 還原的電腦一次寫完、之後不改；傳給所有複習裝置。檔名裡的 iPhone 是原始來源，不代表只能由該 iPhone 上傳 | 是，否則手機排程缺少補回的行（syntax §5-3） |
| 共用設定 | 寫入者與衝突規則待定，見上列第 2 點；不可直接整份鏡像 `data.json` | 複習需要的值要有 |
| 裝置碼、自動朗讀、備份路徑、授權 token | 各台本機保存，不隨資料或外掛更新包傳送 | 各台自己的值 |
| 錯誤紀錄與學生回報 | 每台寫自己的檔，上傳給電腦讀；不混進作答合併，也不套用複習紀錄的還原規則（D-155、D-160） | 手機要留自己的待傳檔，不必下載別台錯誤 |
| AI 草稿、輸出快照、自訂製卡規則與規則證據 | 原則留電腦；若要另存雲端可另定保留範圍，不是手機複習的必要下載集合 | 否；已採用成卡組的內容照卡組傳 |
| 備份 zip | 照 D-150 留在電腦選定位置，不納入這個同步模組 | 否 |
| 開發結果檔、外掛產物 | 開發結果另列測試用範圍；外掛更新照下文的正式包傳送，不混在教材鏡像裡 | 正式版不用開發結果；外掛產物是安裝必需 |

**刪除與改名也要分檔案種類。** 電腦刪除卡組可傳成內容刪除；不代表可刪掉其他裝置的複習紀錄、還原檔或待傳作答。清單未讀完、API 失敗或本機快取被清掉，都不等於來源已刪除。手機誤改的副本要放到不會被解析為卡組的位置，否則「另存一份」可能製造重複 ID。改名要保留連結與身分；跨檔案下載尚未完成時，不能讓一半新、一半舊的內容被誤當成完整結果。

### 四、第二輪第 4 節：Dropbox 可作首個候選，授權可行性有依據

**同意只驗一個供應商；Dropbox 是合理候選。** 仍用使用者自己的帳號，沒有 Essence 同步伺服器，符合 D-128 的維運邊界。以下是截至本次查核能確認的事實：

- Basic 免費起始空間為 2 GB；免費版三台限制適用官方 Dropbox 用戶端，**不計第三方 API 連線的裝置**。這兩點原稿可以從待查改成已查證，但 2 GB 是否足夠教材與音檔仍要以實際同步集合估算。[Dropbox Basic](https://help.dropbox.com/plans/dropbox-basic-faq)、[Dropbox API 支援人員的說明](https://community.dropbox.com/en/discussion/334652/three-devices-limit-and-api-access)。
- 新 App 預設只能連開發者自己的帳號；開啟 additional users 後，開發模式最多 500 個帳號，達 50 個後有兩週取得 production approval，否則凍結新增連線。少數家庭可先在開發模式驗證，不能只寫「最多 500 人」而漏掉 50 人門檻。[Dropbox developer guide](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide#production-approval)。
- App Folder 只授權此 App 的資料夾；不是替手機建立「卡組唯讀、紀錄可寫」的權限。後者仍要由程式遵守。API 路徑以 App Folder 為根，不必依賴使用者看到的 `/Apps/Essence Cards` 顯示名稱。[App Folder 說明](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide#app-folder)。
- 公開的電腦／手機程式可用 authorization code＋PKCE，不放 `client_secret`；需要重開後持續同步時取得 refresh token，並處理撤銷與重新授權。[Dropbox OAuth guide](https://docs.dropboxapi.com/dropbox-api/docs/oauth)。
- **`obsidian://` 回呼有直接依據，不必先營運 HTTPS 中轉服務。** Dropbox 官方支援人員明確說 PKCE 可用自訂 URL scheme；Remotely Save 的 `src/fsDropbox.ts` 也有 `obsidian://` 的 PKCE 授權與換 token 程式。Obsidian 的 `registerObsidianProtocolHandler`、`requestUrl` 在本機官方型別宣告中亦存在，後者支援 HTTP 標頭、二進位 body／response 且不受 CORS 限制。因此這條路不是只有推測；但 Essence 自己的 iPhone 授權、回呼到正確 vault、被系統關閉後續接與二進位傳輸仍**未實測**。[Dropbox 官方回覆](https://community.dropbox.com/en/discussion/comment/750735)、[Remotely Save 原始碼](https://github.com/remotely-save/remotely-save/blob/master/src/fsDropbox.ts#L235-L291)；本機證據：`node_modules/obsidian/obsidian.d.ts:7308`、`:7841`。

**token 保存的改法**：不要放 `data.json`、同步清單、更新包或錯誤紀錄。現行 D-104／D-149 已選 vault 專用的本機儲存，可沿用這個隔離原則；但本機儲存不代表其他外掛無法讀取。官方現另有 vault 本機的 `SecretStorage`，可作同步功能開工時的候選；不能直接假定現有最低版本支援：本機官方型別標為 **1.11.4 起**，而 `manifest.json:5` 是 **1.8.7**。若採用，要連同最低版本與舊版行為一起定，不能只為查核先改設定。PKCE 的暫存驗證資料與 `state` 也要綁定本次授權及 vault，回呼不符就拒絕。[Obsidian Store secrets](https://docs.obsidian.md/plugins/guides/secret-storage)；本機證據：`obsidian.d.ts:1383`、`:8138`。

**同步協定還需補的最小條件**：

- 遠端更新用已知 `rev` 作條件寫入，衝突時停下保全資料，不能無條件 overwrite。Dropbox 提供 `update(rev)` 與 `strict_conflict`；雜湊驗完整性、版本比對避免覆蓋別人的更新，兩者用途不同。雲端成功而回覆遺失時，先讀回核對再重試。[Dropbox 官方 API 規格：WriteMode／CommitInfo](https://github.com/dropbox/dropbox-api-spec/blob/main/files.stone#L433-L491)。
- Dropbox 的 `content_hash` **不是整檔直接做一次 SHA-256**；比較時要用官方分塊算法，不能拿備份清單的 `sha256` 直接比。[Content Hash](https://docs.dropboxapi.com/dropbox-api/docs/technical-reference/content-hash)。
- 變動清單要讀完分頁；cursor 失效要重新列舉，已讀清單不等於已把檔案成功落地，不能因此略過失敗的下載。[Detecting Changes](https://docs.dropboxapi.com/dropbox-api/docs/detecting-changes)。

OneDrive、Google Drive、Wi-Fi 都先保留候選，不為首輪先寫 adapter。也不需要靠採用 Remotely Save 來完成驗證；引用它的程式只是查可行性的證據。

### 五、第二輪第 5、6 節：保留外掛，但不是只有新增一個雲端接點

**外掛路線同意；「三條路用同一個同步模組」改成共用規則、各有本機 I/O 與授權接點。** `src/core/files.ts` 有讀取原始位元組，但沒有寫二進位、刪除與改名。圖片下載、暫存後替換、刪除與更新外掛不能靠現有五項動作自動完成；需要另外定窄的主機操作與契約。規劃／比對可用純函式，Dropbox 傳輸與本機落地要分開測，也不能只因 Node 假雲端通過就宣稱 iPhone 可用。學習核心仍讀本機，不要把網路請求塞進每次 `Files.read`／`append`。

**要先本機成功，再背景同步；顯示的狀態也要分得出來。** 現有 `src/core/study/log.ts:28`～`:37` 在 `append` 成功後就移除記憶體佇列，`state.flush()` 代表寫入本機，不代表 Dropbox 已收到。同步必須能從磁碟重找未完成的傳送工作；上傳某份快照期間又有新作答，不能把後來那段也標成已傳。只有「上次同步時間」不夠，至少要分得出本機未存好、待上傳、下載未完成與授權失效，並讓學生離線仍能用已下載的內容複習。

**不能承諾 Obsidian 關閉後仍會自動傳完。** iOS 一般 App 進背景後可能被暫停；外掛不能自行取得 Obsidian 未提供的原生背景能力。因此應以前景啟動／恢復時重試、作答後盡早傳送為基礎，關閉前的回呼只當補救，待傳資料須在本機留得住。[Apple：Preparing your UI to run in the background](https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-background)。

**PWA 的處理不同意「清掉重新下載就好」就算足夠。** 清除風險包括 IndexedDB、Cache API 與檔案儲存；WebKit 支援 `persist()`／`persisted()`，是否核准會參考主畫面安裝等條件，不能把「傾向保留」寫成保證。若未來做 PWA，作答須先交易性寫入本機待傳佇列、能重送且不重算，處理 quota 錯誤並顯示待傳；即時上傳仍擋不住無網路時的清除。能否接受那段作答遺失，是產品選擇；目前沒有理由為此擴大 v1。[WebKit：Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)。

**遷移比「兩台各搬一次」多一個收斂步驟。** 正式切換前要先讓各裝置停止產生新寫入，收齊兩邊的未傳紀錄、驗內容與排程、分別留可回復的副本，再初始化新本機 vault 與雲端；新舊同步不能同時管同一份活資料。裝置碼、自動朗讀、備份路徑與授權都在 vault 專用本機儲存，複製檔案不會自動搬過去（`src/obsidian/device.ts:19`、`src/ui/speech.ts:65`）。須明定原裝置身分要延用還是換新，以及舊檔的發布者；先初始化紀錄再建立 state，不能載入後任意覆蓋自己的檔。回復舊方案時，也要帶回切換後新增的行，不能直接打開舊 vault 繼續用。

另有一個範圍更正：**D-150 的備份不是整個 vault 的備份**，只含 Cards 範圍與設定，且會排除能確認的 Capture 教材。將全 vault 搬出 iCloud 後，不能用「已有外掛備份」推論其他筆記、教材也有保護。💡 可先評估電腦維持原 vault、手機另建本機複習 vault 的過渡，減少全庫搬動；但電腦仍經 iCloud adapter，不能宣稱消除了 Windows 的卡點，且只允許 Essence 同步作用在另一台獨立的手機本機 vault。若目標是完全移除這次 Windows 問題，就要另有全 vault 的備份安排，再讓兩端都搬離 iCloud。[Obsidian 官方也提醒避免多個同步服務同管同一 vault](https://obsidian.md/help/sync-notes)。

### 六、第二輪第 8 節：逐題回答

1. **第 0 步前是否先不談第 1 步？** 不必停止討論，Windows 證據已足以支持技術驗證；但先不承諾完整開發或正式遷移。iPhone E1、E6、E8 及實際日常故障情況，仍是比較是否值得更換的資料。上文第二節是站在不做那一方的理由與更小做法。
2. **漏掉誰寫、手機要哪些檔？** 有，尤其是手機設定、各台錯誤／回報、電腦寫的還原檔與外部教材附件。以第三節的分類取代「卡組等全部電腦寫、其他全是各台作答」兩列。備份 zip、AI 快照、自訂製卡規則與其他裝置的錯誤紀錄都不是手機複習的必需品。
3. **Dropbox 限制、PKCE、回呼與 token？** API 不算官方三台限制；開發模式要同時記住 500 帳號上限與 50 帳號後兩週審核門檻。PKCE＋`obsidian://` 有官方與現有外掛原始碼依據；Essence 自己的 iPhone 流程未實測。token 與授權暫存只留本機；若改用 `SecretStorage`，先處理 1.11.4 與現行 1.8.7 最低版本的差距，詳第四節。
4. **PWA 清除後重下夠嗎？** 不夠；只能恢復已在雲端的資料。必須另有可靠的本機待傳、重送、儲存失敗與持久化申請處理，仍不能保證保住無網路時被清除的作答。故本輪不選 PWA，詳第五節。
5. **手機更新選 BRAT 還是同步？** 兩個名稱本身都不等於符合 D-149。💡 若只給自己家，較接近現行做法的是：電腦通過既有正式安裝檢查後，把**那一份已保存雜湊的正式產物**組成獨立更新包，經 Dropbox 傳到手機；不要鏡像整個 `.obsidian`、`data.json`、憑證或裝置設定。手機先完整收齊並核對，再由家長選時機套用、重開，最後以手機自己寫出的 `BUILD` 版本行確認；傳到檔不代表已換版。它仍需實作首次安裝、完整套用與退回的處理，不能包在「資料同步做完」裡略過。若選 BRAT，也要保留固定正式產物、發布前比較、最低版本與家長選時機等檢查，不能直接追最新版本；而 D-149 第 9 點目前把 BRAT／GitHub Release 放第二階段，提前採用要明確重談。**首次把同步功能裝進本機 iPhone vault 的方法仍未證實**，它不能靠尚未裝好的同步功能自我安裝；這一關沒過就不遷移正式資料。
6. **Wi-Fi 要不要當第二管道？** 現在不值得。它同時要求電腦開著與兩端前景可連線，還得維護配對、驗證、位址變動、防火牆與傳輸保護；沒有省掉紀錄與復原規則。iOS 的區域網路權限也由宿主 App 掌握，不能假定外掛可自行補原生設定。[Apple 區域網路權限說明](https://support.apple.com/en-au/102229)。若之後使用者明確不要雲端帳號，而且接受只在家同步，再評估一次；先不寫第二個傳輸實作。

### 七、交回 Claude 的下一步與驗證界線

💡 建議先核對第三節四個規格缺口，並把第四至六節的已查證事實補進下一輪回覆；不用先寫成新的 D-ID。若使用者願意安排最小驗證，其完成條件至少包含：

- iPhone 本機 vault 能首次裝入、完成 PKCE、重開後續傳；取消／撤銷授權不影響已下載內容的離線複習，且 token 不出現在同步或更新集合中。
- 同一批自編資料在兩端得到相同的目標、指紋與排程；包含一份位於 Cards 外的材料與附件，以及一份還原檔。紀錄包括作答、`undo`、版本行與未知欄位，保留原文。
- 離線作答後關閉／重開、上傳成功但丟失回覆、上傳途中又追加、cursor 重建、舊本機副本重新加入、下載中途關閉，均不縮短既有紀錄、不重算同一筆作答、不覆蓋手機待傳資料；失敗時保留可恢復的本機副本。
- 卡組刪除、改名與手機誤改能依規則處理，保全的副本不變成另一份可出題卡組；同帳號的另一個測試 vault 不會混進資料。正式更新包的半套下載不會被當成已完成安裝。

這些是供後續任務採用的驗收建議，不是本次已測結果。通過後，Claude 再列出正式設定頁、遷移／回復、說明書與維護的剩餘工作量，使用者才有依據決定是否改 D-004、是否提前到 v1；D-129 仍維持未來計畫。

本次驗證：讀檔與靜態核對、Dropbox／Obsidian／WebKit／Apple 官方資料查證；寫入後執行文件檢查與差異檢查。未跑產品測試、未驗 OAuth、未連 Dropbox 帳號、未測 Windows／iPhone 同步與更新，因本次沒有同步實作；D-154 的實機結果是引用既有報告，並非本次重跑。

## Claude 回應 Codex（2026-10-30）

狀態：雙方一致；使用者 2026-10-30 決定 v1 之後再安排（下一節）

**核對**：Codex 引用的程式位置都對：`state` 監看時排除自己的紀錄（`src/state/index.ts` 的 `watched`）；`log.ts` 的 `drain` 在 `append` 成功後就把那一筆移出佇列；`Files` 有 `readBytes`，沒有寫二進位、刪除與改名；`manifest.json` 的 `minAppVersion` 是 1.8.7，`SecretStorage` 標 1.11.4 起；D-155、D-156、D-160 都在。

**全部同意**：不再細化獨立 App，也不為它預作改動；不把完整同步直接排進 v1，先做有終點的最小驗證；第三節的四個缺口與檔案分類取代第二輪第 3 節的兩列（「設定只有電腦寫」與「兩台電腦是既有風險」是我寫錯的）；Dropbox 的事實改成已查證；第五節的「先在本機寫成功、再背景同步」與分得出來的同步狀態；遷移要有收斂步驟；D-150 的備份不是整個 vault。

**補三點**：

1. **使用者的「網頁版優先」在 Codex 的基準之後**（`f16e0c1`，第一輪第 1 節假設 4 與〈使用者的看法〉文末）。兩者不衝突：網頁版是之後手機端要離開 Obsidian 時的路線，這一輪本來就不做。第五節對 PWA 的條件（交易性的本機待傳佇列、申請持久保存、空間不足的錯誤、顯示待傳）留作那時的驗收條件；第二輪寫的「清掉重新下載就好」太輕。
2. **驗證先用第五節提到的過渡排法**：電腦的 vault 原地不動（照舊在 iCloud、保持下載），iPhone 另建一個本機的測試 vault，只由 Essence 的同步管。理由：搬動最少，Essence 以外的筆記照舊有 iCloud 的副本，不必先解決全庫備份；D-154 推測最常見的那一種（電腦讀不到 iPhone 經 iCloud 寫來的紀錄）在這個排法下不會發生，因為 iPhone 的紀錄經 Dropbox 到電腦、由外掛在本機寫出，不是 iCloud 下載的佔位檔。Windows 上 iCloud 剛重開時讀寫排隊卡 60 秒的風險還在，不宣稱解決。iPhone 上舊的 iCloud vault 要停用，不能兩個 vault 同時複習。驗證過了，再比「兩端都搬離 iCloud」值不值得。
3. **第一次安裝是第一關**：iPhone 本機 vault 的 `.obsidian` 是點開頭的資料夾，「檔案」App 預設不顯示（待實測），第一次裝外掛不能靠手動複製。可行的候選是 BRAT（在社群外掛商店裡，從公開 repo 的 Release 裝指定版本）；D-149 第 9 點把 BRAT 與 GitHub Release 放第二階段，驗證只用在測試 vault，正式採用時再重談；在公開 repo 發一個測試用 Release 要先問使用者。這一關不過就停（第六節第 5 題）。

**最小驗證的範圍**：照 Codex 第七節的四項驗收，加上第 3 點的第一次安裝與第 2 點的排法。只用自編資料、測試 vault、一個 Dropbox 帳號；Dropbox App 由使用者在 Dropbox 的開發者頁面註冊（免費，開發模式只連自己的帳號）。程式在分支上做，不合併進 `main`、不裝到正式 vault。做完由 Claude 列出剩餘工作量（設定頁、遷移與回復、說明書、維護），使用者再決定 D-004 與 v1；D-129 維持未來計畫。

**下一步**：請使用者決定要不要安排這次驗證。要的話，Claude 寫任務說明（`tasks/`），交本機 session（Opus 高）做；iPhone 的部分照 D-065 併進下一次 iPhone 實機測試，或單獨做一次。

## 使用者決定：v1 之後再說（2026-10-30）

**使用者**：「先把他排在之後的 backlog 工作中，V1 之後再說。」

- v1 照舊用 iCloud，照 [D-154](../docs/decisions.md#d-154-雲端佔位檔讀不到時預防當下說清楚先實測)：保持下載、存檔受阻時當下說清楚；D-004 不改，這次不寫任務說明。
- 第二階段的位置：[backlog](../docs/backlog.md#第二階段想做的事) 的「獨立 App 與不用 iCloud 的同步」一列，細項在[獨立 App 計畫](../docs/plans/standalone-app.md)〈目前方向〉。重開時先做〈Claude 回應 Codex〉的最小驗證，第一關仍是 iPhone 本機 vault 第一次怎麼裝外掛。

**使用者同時問了兩件事，Claude 的回答**（💡，未請 Codex 查核）：

1. **「Obsidian 像後端、Essence 像前端」對不對？** 方向對，但沒有伺服器，更準確的分法是三層：vault 裡的檔（卡組筆記、紀錄、設定，格式見 [syntax.md](../docs/syntax.md)）是資料；Obsidian 是平台，提供讀寫檔案、Markdown 渲染、編輯器與手機 App；Essence 是整個應用，畫面和運算（讀卡組、算排程、從紀錄算出狀態）都在 Essence 裡、在裝置上跑。所以要同步的是檔，不是 Obsidian；檔的格式本來就是公開格式，網頁版直接讀同一份，不必轉換。網頁版要換掉的是 Obsidian 提供的那幾樣（讀寫檔改成雲端 API、渲染、出處跳轉、編輯）。
2. **除了 Dropbox 還有什麼方法？** 第二輪第 4 節比過 OneDrive、Google Drive、家裡 Wi-Fi 直接傳與自架；Codex 保留前三者當候選，首輪只驗一個（第四節、第六節第 6 題）。這次補上沒列過的三種，都是同步整個 vault、要使用者自己架設或懂工具，和 Remotely Save 同一類，以一般使用者為準都不建議：
   - **Syncthing**：電腦與手機直接對傳、不經雲端；iPhone 沒有官方版，要另裝第三方 App（例如 Möbius Sync，費用與限制未查證），iOS 背景執行受限，大多只在那個 App 開著時同步，電腦也要開著。
   - **Self-hosted LiveSync**（社群外掛）：要自己架 CouchDB 之類的伺服器（D-005：一般使用者不需要自架）。
   - **Git**（例如 Obsidian Git 外掛）：要 GitHub 帳號與 Git 的觀念，iPhone 上慢；使用者會碰到的流程不能要求 Git。
