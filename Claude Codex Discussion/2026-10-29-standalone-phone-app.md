# 獨立手機版 Essence Cards（請使用者先選範圍，再請 Codex 查核）

狀態：進行中：等 Codex 查核兩輪；同時由本機照 D-154 做 Windows 實測，兩邊結果到了再由使用者決定同步要不要進 v1

2026-10-29｜Claude（Opus 5.5 xhigh）｜依據：使用者 2026-10-29 開的討論串「規劃獨立手機版 Essence Cards」（「專門討論未來開發獨立版本的手機端 Essence Cards」）；延續 [D-128](../docs/decisions.md#d-128-通用軟體使用者自備同步空間)、[D-129](../docs/decisions.md#d-129-獨立-app-列入未來開發計畫) 與[獨立 App 計畫](../docs/plans/standalone-app.md)。框架、檔案接點與畫面的模組邊界屬於重大決策，先和 Codex 討論（[D-140](../docs/decisions.md#d-140-fable-規劃opus-執行codex-查核) 第 2 點）。這是第二階段的規畫，不實作。

## 先讀這裡

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
4. 可以接受 Apple 開發者計畫一年 US$99。這不是同步服務的費用、不隨人數增加，但 D-128 只談同步，所以請使用者確認。

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
