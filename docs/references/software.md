# Essence Cards｜參考軟體

更新日期：2026-10-07（Asia/Taipei）  
研究版本：0.3｜12 項軟體的官方資料初查與設計統整入口

產品初查日期：2026-10-06；2026-10-07 新增[架構與特色功能統整](design-opportunities.md)，包含六項架構細化、九項功能提案、第一版優先順序及驗收方向。優先順序為助理建議，尚未確認採用。

由 [I-001](../ideas.md#i-001-參考軟體功能蒐集專區待研究) 建立，作為設計討論平台的研究資料。收錄不代表採用功能；可借鑑之處及研究優先順序都是助理提案，並非新增產品共識。

## 查核範圍與判讀方式

- 保留使用者指定的 RemNote、Memory Toast，新增 Anki、Quizlet、Brainscape、Mochi、SuperMemo、Readwise Reader、NotebookLM、Recall、Knowt、StudySmarter。
- 包含常見學習平台及設計上有代表性的工具，不宣稱同屬熱門排名。Mochi、SuperMemo、Readwise、Recall 也因流程與資料設計價值收錄。
- 本輪只讀官方網站、說明、商品頁及開發者 App Store 資料，未登入、註冊、付款或實際操作。「功能觀察」是文件查核，不是試用心得，也不據此宣稱學習成效。
- 「官網初查完成」表示已補定位、功能、成本、可攜性、借鑑方向與驗證問題。沒有證據的欄位記為「未確認」，不推論成「不支援」。年繳折算不等於月繳價格，區域、稅額及商店價可能不同。
- 區分內容匯出、附件、來源關聯、排程與逐次學習事件；Markdown／CSV 不等於完整備份。離線閱讀也不等於離線 AI 或所有複習模式。
- 以 C-014 的 Obsidian 外掛、Windows 整理、iPhone 複習、既有 iCloud 為比較基線；其他產品的同步不能證明本案 iCloud 已通過驗證。

## 比較總覽

| ID | 軟體 | 主要參考位置 | 成本與資料限制 | 初查後建議 |
|---|---|---|---|---|
| R-001 | RemNote | 筆記→製卡→待修訂 | 基本免費；原生匯出不含圖片／PDF 本身 | 優先深查 |
| R-002 | Memory Toast | 手機拍照→離線複習 | 基本免費，AI 點數／可選月訂閱；事件匯出未確認 | 優先手機實測 |
| R-003 | Anki | 共用筆記→排程 | 電腦免費，iOS 買斷；原生包可帶媒體與歷史 | 優先深查 |
| R-004 | Quizlet | 卡組→多模式練習 | 基本免費＋訂閱；僅原創卡組文字匯出 | 第二輪 |
| R-005 | Brainscape | 信心自評→排程 | Basic 免費；備份匯出屬 Pro | 第二輪 |
| R-006 | Mochi | Markdown 筆記↔卡片 | 本機免費，同步付費；原生與文字匯出保留度不同 | 優先深查 |
| R-007 | SuperMemo | 閱讀→摘錄→成卡 | Windows 買斷、語言平台另訂閱；不能混用平台能力 | 概念設計參考 |
| R-008 | Readwise Reader | 來源→標註→筆記／回顧 | 試用後訂閱；Obsidian 追加匯出不是雙向回寫 | 優先深查 |
| R-009 | NotebookLM | 來源→教材→解析 | 免費額度＋付費升級；CSV 不等於完整事件備份 | 優先深查 |
| R-010 | Recall | 收藏→關聯→測驗→來源 | 免費收藏，測驗／SRS 付費；事件匯出未確認 | 優先深查 |
| R-011 | Knowt | 筆記→多模式練習 | 免費學習，AI 有額度；已確認 PDF 匯出 | 第二輪 |
| R-012 | StudySmarter | 教材畫線→卡片→弱項 | Premium CSV 不含格式／圖片／公式 | 第二輪 |

## R-001 RemNote｜官網初查完成

摘要：使用者指定；筆記直接製卡、文件脈絡與 Edit Later 適合研究共用內容及複習中待修訂。

來源：使用者指定。定位：筆記、文件閱讀與間隔複習整合平台。查核：2026-10-06；未實測。

功能觀察（官方文件）：
- 筆記條列用 ==／>> 製作問答卡，另有反向、雙向、填空、多步驟、遮圖與選擇卡。可複習文件到期卡或全部卡片。
- 閱讀與 AI 工具可從 PDF 等生成卡片／摘要／測驗，權限及額度依方案。
- 複習可直接修卡或標記 Edit Later，留待整理時處理；手機官方說明支援離線、iOS／Android 與跨裝置同步。

限制與成本：Free 有無限筆記／卡片與同步裝置，PDF 註記等有上限。官網年繳 Pro 折算 US$8／月（US$96／年），Pro with AI US$18／月（US$216／年）；月繳及 Lifetime 金額未確認。

資料匯出：原生、OPML、Anki、HTML、Markdown、文字；Anki 匯出只收有卡片的條列，Complete 原生格式也不含圖片／PDF 本身，媒體另由伺服器保存，不能當成完整離線備份。

可借鑑之處（助理提案）：同份筆記製卡、保留層級脈絡、手機先標記再由電腦修訂。不宜直接搬用：複雜筆記模型與進階工具可能增加初次操作負擔，需驗證附件備份。

待實測：同概念多題連動、精確跳回原文、離線事件合併、繁體中文 AI 判分、附件及排程匯出。相關點子：I-003、I-004、I-006、I-009、I-013。

官方來源：
- [筆記製卡與練習模式](https://help.remnote.com/en/articles/8663109-flashcard-basics)
- [Edit Later](https://help.remnote.com/en/articles/6026892-edit-later-power-up)
- [手機與離線](https://help.remnote.com/en/articles/7000505-mobile-app)
- [方案與價目](https://www.remnote.com/pricing)
- [匯出格式與媒體限制](https://help.remnote.com/en/articles/7898019-exporting-and-printing-notes)

## R-002 Memory Toast｜官網初查完成

摘要：使用者指定；拍照製卡、離線複習與進度可參考，官網／商店排程及收費描述須核對版本。

來源：使用者指定。定位：手機 AI 製卡與間隔複習。查核：2026-10-06；未實測。原 zh-TW 頁仍未能直接讀取，但已讀現行英文官網與開發者商店說明，取代原本整體「待查核」。

功能觀察（官方資料）：
- 拍攝教材、筆記或講義後由 AI 製卡；支援文字、圖片、音訊、影片、反向卡及進度。
- 官網列本機保存、離線手動製卡／複習、訪客與登入同步；不將本機操作延伸成離線 AI。
- 官網仍用 SM-2 解說；App Store 新版及更新紀錄已列 FSRS、可切換 SM-2，須核對實際安裝版。

限制與成本：基本免費，AI 用 Tokens；美國商店 500 Tokens US$0.99、2,000 US$2.99、5,000 US$5.99。商店更新紀錄另列可選 Premium 月訂閱（標價 US$1.99），每月 1,000 Tokens 及去插頁廣告；官網 FAQ 尚只寫點數，不能推論沒有訂閱。臺灣價未確認。現行官網 Android 標 Coming soon，不沿用舊摘要認定已推出。

資料匯出：查到卡組分享與同步，未找到現行文件足以確認 Markdown／CSV／Anki、附件備份及逐次事件匯出。分享不等於無損備份。

可借鑑之處（助理提案）：降低手機輸入及每日複習負擔、清楚呈現待複習與卡片狀態。不宜直接搬用：熟練標籤不能代表概念應用能力，資料自主與跨端完整性尚待驗證。

待實測：繁體中文辨識／題目、FSRS 設定、來源定位、訪客轉帳號、Windows 製卡流程、完整匯出與離線衝突。相關點子：I-002、I-004、I-007、I-009、I-013。

官方來源：
- [使用者原提供網址](https://www.memory-toast.com/zh-TW)
- [現行官網：拍照、離線、同步及收費](https://www.memory-toast.com/en)
- [App Store：功能、更新紀錄及美國價](https://apps.apple.com/us/app/memory-toast/id6470912655)

## R-003 Anki｜官網初查完成

摘要：新增核心複習參考；筆記／卡片分離、每日負擔控制及含學習歷史的備份值得優先研究。

來源：助理依使用者要求新增。定位：開源主動回想與間隔複習工具。查核：2026-10-06；未實測。

功能觀察（官方文件）：
- 用筆記欄位與模板產生卡片，同份筆記可產生多張卡；支援媒體、科學公式、自訂模板與桌面外掛。
- 答後自評回想程度再排程，提供 FSRS、每日新卡／複習上限及統計；這些不等於自動錯因診斷。
- 桌面／AnkiMobile 可離線，媒體保存在本機，免費 AnkiWeb 同步；iOS 不支援桌面外掛，部分筆記類型管理由電腦處理。

限制與成本：Windows／macOS／Linux 與 AnkiDroid 免費；官方 AnkiMobile 買斷，本次臺灣 NT$790、美國 US$24.99。其他名稱含 Anki 的產品不能當成同一生態系。

資料匯出：Tab 分隔文字供內容交換；apkg 可選帶複習歷史、牌組設定、媒體，colpkg 保存整個 collection 與排程。匯入整個 collection 會取代目前卡片，與合併牌組不同。

可借鑑之處（助理提案）：概念內容／題目模板分工、保留事件支援排程、控制新增卡量、分開內容交換與完整備份。不宜直接搬用：純卡片核心不足以涵蓋概念筆記、比較表與回寫；不預先決定本案必須採 FSRS 或整合 Anki。

待實測：共用概念、歷史欄位、附件往返、修改題目後排程、雙端離線合併。相關點子：I-004、I-007、I-009、I-011、I-013、I-014。

官方來源：
- [平台、同步與媒體](https://apps.ankiweb.net/)
- [筆記與卡片概念](https://docs.ankiweb.net/getting-started.html)
- [FSRS 與每日上限](https://docs.ankiweb.net/deck-options.html)
- [統計](https://docs.ankiweb.net/stats.html)
- [匯出、歷史與媒體](https://docs.ankiweb.net/exporting.html)
- [臺灣 AnkiMobile：價格、離線與限制](https://apps.apple.com/tw/app/ankimobile-flashcards/id373493387)

## R-004 Quizlet｜官網初查完成

摘要：新增常見卡片平台參考；內容匯入、多模式練習與離線延續可借鑑，文字匯出限制較多。

來源：助理依使用者要求新增。定位：卡片、測驗及 AI 學習資料平台。查核：2026-10-06；未實測。

功能觀察（官方文件）：
- Web 貼入詞義表逐列製卡，長篇筆記可產生 AI Study Guide；個人化路徑、進度與智慧評分依方案及額度。
- iOS／Android 離線說明列 Flashcards、Match、建立卡組，最近八組自動保存，復連後同步進度；不能推論所有模式均離線。

限制與成本：基本工具免費，Plus／Plus Unlimited 月或年自動續訂；本輪升級價目頁無法讀取，金額未確認，免費離線權限須實測。

資料匯出：僅 Web 可匯出自己原創卡組的詞義文字，圖片及複製他人的卡組不可匯出；未確認排程與逐次事件匯出。

可借鑑之處（助理提案）：匯入預覽、同內容多種練習、延續離線進度。不宜直接搬用：卡組與原教材可能分離，受限匯出不適合作本案資料底座。

待實測：繁體中文智慧評分、免費權限、AI 題目來源、跨端衝突、事件匯出。相關點子：I-004、I-005、I-009、I-013。

官方來源：
- [匯入及 Study Guide](https://help.quizlet.com/hc/en-us/articles/360029977151-Creating-sets-by-importing-content)
- [訂閱權限與計費](https://help.quizlet.com/hc/en-us/articles/360041181691-Subscribing-to-Quizlet)
- [手機離線](https://help.quizlet.com/hc/en-us/articles/360030565412-Studying-offline-with-Quizlet-mobile-apps)
- [原創卡組匯出](https://help.quizlet.com/hc/en-us/articles/360034345672-Exporting-your-sets)

## R-005 Brainscape｜官網初查完成

摘要：新增信心自評參考；答後 1–5 級回饋可減少操作，但不能取代正誤與錯因。

來源：助理依使用者要求新增。定位：信心自評驅動的間隔複習。查核：2026-10-06；未實測。

功能觀察（官方文件）：
- Basic 免費建立、匯入、分享、學習自有卡片與追蹤進度，有限 AI 製卡；答後自評 1–5 信心以調整再現頻率。
- Pro 增加圖片／音訊、私人內容與反向卡等。Web、iOS／Android 同步核心功能，官方也說明離線後可手動 Sync Account。

限制與成本：Year 方案折算 US$7.99／月，不當成月繳價；其他期別、年繳實際總額及完整離線下載／編輯範圍未確認。

資料匯出：卡組備份屬 Pro，可用 Excel 開啟及重匯入；附件與逐次學習事件保留範圍未確認。

可借鑑之處（助理提案）：簡單答後自評、優先呈現低信心內容。不宜直接搬用：信心與真正會答可能不同；付費備份不符資料自主偏好。

待實測：自評／正確率分開保存、雙端離線衝突、匯出保真、實際計費。相關點子：I-006、I-007、I-009、I-013。

官方來源：
- [價格與方案](https://www.brainscape.com/pricing)
- [信心與排程](https://brainscape.zendesk.com/hc/en-us/articles/13103043051149-How-Does-Brainscape-s-Spaced-Repetition-Algorithm-Work)
- [Web／手機同步](https://brainscape.zendesk.com/hc/en-us/articles/115002369711-How-do-Brainscape-s-website-mobile-app-interact-with-each-other)
- [Pro 備份匯出](https://brainscape.zendesk.com/hc/en-us/articles/115002383872-How-can-I-export-a-backup-of-my-flashcards)

## R-006 Mochi｜官網初查完成

摘要：新增 Markdown 筆記／卡片參考；原生完整備份與文字交換的分工尤其值得借鑑。

來源：助理依使用者要求新增，因設計代表性收錄，不宣稱熱門排名。定位：互連筆記、卡片及間隔複習工作區。查核：2026-10-06；未實測。

功能觀察（官方文件）：
- 筆記／卡片互連，模板、標籤、篩選；新卡先學習再入複習，以 Forgot／Remembered 回饋再複習。
- Windows／macOS／Linux／iOS／Android 可離線；免費免帳號、無限卡片／牌組及匯入匯出；跨裝置同步、發布及 API 屬 Pro。

限制與成本：Pro 年繳折算 US$5／月、10GB 同步；月繳價未確認。免費價目欄也列有限 AI／語音額度，不寫成 AI 全部付費。官方同步不是 iCloud，不認定內部資料可直接放入 Obsidian vault。

資料匯出：原生 mochi 是 JSON＋附件的 ZIP，含卡片、模板、標籤、中繼資料、複習歷史與牌組結構；Markdown／CSV 不保留完整歷史、模板等，屬於有損交換。

可借鑑之處（助理提案）：筆記卡片互連、新資料先確認再排程、完整事件備份。不宜直接搬用：Markdown 編輯不表示底層就是共用 vault；付費同步不符免月訂閱優先。

待實測：一概念多題引用、改名連結、繁體中文／公式、Markdown 往返、離線事件合併。相關點子：I-003、I-004、I-007、I-009、I-011、I-013。

官方來源：
- [筆記與卡片文件](https://mochi.cards/docs/)
- [學習與複習](https://mochi.cards/docs/getting-started/reviewing-cards/)
- [方案、平台與同步](https://mochi.cards/pricing/)
- [原生／Markdown／CSV 保留範圍](https://mochi.cards/docs/import-and-export/exporting/)

## R-007 SuperMemo｜官網初查完成

摘要：新增漸進閱讀參考；Windows SM20 與語言平台不同，費用及手機能力不能混用。

來源：助理依使用者要求新增，重點是流程設計價值。定位：Windows 版閱讀／摘錄／排程，另有同品牌語言平台。查核：2026-10-06；未實測。

功能觀察（官方資料）：
- SM20 商品頁列 PDF／EPUB／網頁／YouTube 匯入與來源保存。官方舊手冊說明文章→摘錄→填空／問答、來源傳給衍生項目；作設計參考，不直接保證新版各項細節。
- 語言平台 iOS／Android 可下載課程離線學習，離線前後 Update 同步；離線不能新增 MemoCards／編輯課程，不能當成 Windows collection 已與 iPhone 互通。

限制與成本：SM20 US$68、Windows 10／11、買斷終身授權與 SM20 系列更新。語言平台 Premium 另列 35.99 PLN／月或 359 PLN／年，自動續訂。

資料匯出：官方舊手冊列 XML、Q&A、learning process／repetition history；SM20 附件、來源與事件保真未實測，不以舊手冊保證新版無損。

可借鑑之處（助理提案）：先閱讀、再摘錄、只挑值得記的部分製卡，持續保留來源。不宜直接搬用：整套閱讀系統複雜，算法最佳化 API、AI／影片的成本與網路依賴待核對。

待實測：來源繼承、SM20 本地離線／匯出、iPhone 互通邊界。相關點子：I-002、I-003、I-004、I-007、I-009。

官方來源：
- [SM20 商品、平台與買斷價](https://supermemo.store/products/supermemo-20-for-windows)
- [漸進閱讀與來源：官方舊手冊](https://www.super-memory.org/archive/help/read.htm)
- [匯出：官方舊手冊](https://www.super-memory.org/archive/help/file.htm)
- [語言平台 Premium](https://www.supermemo.com/en/premium-subscription)
- [語言平台離線](https://www.supermemo.com/en/faq/can-i-use-supermemo-offline)

## R-008 Readwise Reader｜官網初查完成

摘要：新增閱讀輸入參考；來源標註、原文跳轉與 Obsidian 匯出可借鑑，追加式匯出不是雙向回寫。

來源：助理依使用者要求新增。定位：Reader 集中閱讀，Readwise 做標註回顧與 Mastery 卡片。查核：2026-10-06；未實測。

功能觀察（官方文件）：
- Reader 收集文章、電子報、EPUB、PDF、影片等，畫線／註記流入 Readwise，Ghostreader 協助摘要等。
- Daily Review 重現標註，Mastery 支援回想卡、主題回顧及來源跳轉；重讀標註與作答卡要分開判讀。
- 手機可下載供離線閱讀，須確認設定及素材保存；不代表所有 AI／網路功能離線。

限制與成本：30 天試用後訂閱。含 Reader 的 Full 年繳 US$119.88（US$9.99／月）、月繳 US$12.99；Lite 年繳折算 US$5.59／月不含 Reader，不符本案免月訂閱優先，但可研究流程。

資料匯出：標註／筆記 Markdown、文件清單 CSV、原檔與文章全文 ZIP。Obsidian 外掛追加新標註，可另匯出 Library 全文；既有標註修改不雙向同步，改名／搬檔後新增標註可能另建檔案。事件匯出未確認。

可借鑑之處（助理提案）：保留來源定位、收藏與精讀分流、主題回顧。不宜直接搬用：追加式匯出無法代替穩定 ID 及可核對回寫。

待實測：中文 PDF 頁碼、附件離線、來源跳轉、Obsidian 改名、複習資料匯出。相關點子：I-002、I-003、I-007、I-009、I-011。

官方來源：
- [Reader 素材與標註](https://docs.readwise.io/reader/docs)
- [離線下載設定](https://docs.readwise.io/reader/docs/faqs)
- [Daily Review／Mastery／來源](https://docs.readwise.io/readwise/docs/faqs/reviewing-highlights)
- [價目與 Reader 方案](https://readwise.io/pricing)
- [文字、原檔及全文匯出](https://docs.readwise.io/reader/docs/faqs/exporting)
- [Obsidian 追加及檔名限制](https://docs.readwise.io/readwise/docs/exporting-highlights/obsidian)

## R-009 NotebookLM｜官網初查完成

摘要：新增來源導向 AI 學習參考；生成材料、引用解析與錯卡重練可借鑑，長期排程及完整回寫未確認。

來源：助理依使用者要求新增。定位：以指定來源生成研究／學習材料。查核：2026-10-06；未實測。官方部落格沿用 NotebookLM，部分說明頁已重導並用 Gemini Notebook 標題；保留常見名便於識別，不推測遷移範圍。

功能觀察（官方資料）：
- 來源加入 Studio 後可生成筆記、心智圖、報告、音訊、閃卡及測驗，設定難度與提示；手機已有閃卡／測驗公告。
- Explain 可解釋答案，公告指出可引用來源；現行文件列 Got it／Missed it、保留進度與只練錯卡。不等於跨日間隔複習已確認。
- notebook 來源脈絡獨立，不認定已實現跨主題共用概念筆記。

限制與成本：Standard 免費有額度，Google AI／合資格 Workspace 等提高上限；臺灣付費價與各項額度本輪未逐一核對，不採舊價格。離線製題／複習未確認。

資料匯出：閃卡 CSV，報告可匯出 Docs／Sheets；Play Books 來源可能因出版者限制不能下載產出。未確認 CSV 包含來源定位、逐次作答歷史或完整 notebook。

可借鑑之處（助理提案）：先選來源再生成、解析可核對原文、保留進度及錯卡重練。不宜直接搬用：AI 生成不保證正確，短期錯卡重練不能替代長期排程及錯因事件。

待實測：繁體中文生物題、引用精度、CSV 欄位／圖片、來源更新後舊題提示、手機離線。相關點子：I-002、I-004、I-005、I-006、I-009、I-012。

官方來源：
- [閃卡、測驗及引用解析公告](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-student-features/)
- [手機閃卡／測驗](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-app-quizzes-flashcards/)
- [現行進度及 CSV 說明](https://support.google.com/gemininotebook/answer/16958963?hl=en)
- [來源範圍及報告匯出](https://support.google.com/notebooklm/answer/16206563)
- [免費／付費方案](https://support.google.com/notebooklm/answer/16213268)

## R-010 Recall｜官網初查完成

摘要：新增收藏→關聯→多題型複習參考；答後開啟來源卡及人工修題值得深入比較。

來源：助理依使用者要求新增。定位：閱讀收藏／AI 知識庫，兼具測驗及 SRS；原 getrecall.ai 現導至 recall.it。查核：2026-10-06；未實測。

功能觀察（官方文件）：
- 保存文章、YouTube、Podcast、PDF、筆記，摘要、標籤、知識關聯與手動連結。
- AI／人工建題，選擇、是非、填空、簡答、配對、排序、翻面卡；答後解釋、開啟原來源卡及即時修題。
- 依作答調排程，顯示到期／當週／下週；Web、擴充、iOS／Android 自動跨端同步。

限制與成本：Free 每月 10 AI 摘要、無限收藏與筆記；Plus 官網 $10／月按年計，含測驗／SRS；Max $38／月按年計。保留官網幣別符號，不猜月繳價；unlimited 有 fair use 約束。

資料匯出：僅 Web 匯出單頁 Markdown／全庫 ZIP；未確認問題、排程、逐次事件包含其中，也未確認離線保證。

可借鑑之處（助理提案）：來源卡連多題型、答後解析與人工修題。不宜直接搬用：自動關聯需核對，來源卡也不等於精確原文段落；訂閱及離線未確認，不當作本案資料底層。

待實測：繁體中文／簡答判分、來源定位、全庫匯出、離線、改題後歷史。相關點子：I-003、I-004、I-005、I-006、I-009、I-011。

官方來源：
- [定位及文件](https://docs.recall.it/)
- [方案與 fair use](https://www.recall.it/pricing)
- [題型、解析、來源與排程](https://docs.recall.it/deep-dives/quiz-and-spaced-repetition)
- [Markdown 匯出](https://docs.recall.it/getting-started/7-exporting-content)
- [平台與同步](https://docs.recall.it/getting-started/1-start-here)

## R-011 Knowt｜官網初查完成

摘要：新增免費多模式練習參考；AI 額度、價目矛盾與匯出深度須分開核對。

來源：助理依使用者要求新增。定位：筆記／卡片、AI 教材加工及多模式練習。查核：2026-10-06；未實測。

功能觀察（官方文件）：
- Basic 無限卡組／筆記，Learn、Practice Test、Spaced Repetition、Match、Flashcards；Learn 含選擇、書寫、是非、翻面，亦可由 Quizlet 匯入。
- 免費 AI 摘要官方列每月一次；Ultra 提供 PDF／圖片／影片／PPT／錄音等 AI 工具。
- Web、iOS／Android 同步檔案及進度；離線範圍未確認。

限制與成本：Ultra 月繳列 $24.99，年方案預收 $149.99，卻同頁寫 $12.99／月，折算不一致；保留矛盾，以結帳確認。另一官方 FAQ 仍列上傳額度，不把 unlimited 當無條件無上限。

資料匯出：確認 Web 卡片 PDF、手機 Share 存檔；CSV／Markdown、來源關聯與逐次事件未確認，PDF 不適合當可編輯交換資料。

可借鑑之處（助理提案）：同內容切換模式與延續進度。不宜直接搬用：一般 AI tutor 不等於錯因診斷；內容／事件可攜性需先驗證。

待實測：繁體中文書寫判分、錯因回饋、AI 題目來源、飛航模式、同步衝突、匯出。相關點子：I-004、I-005、I-006、I-009、I-013。

官方來源：
- [方案與價目矛盾](https://knowt.com/plans)
- [免費模式及額度](https://help.knowt.com/en/articles/16905163-what-s-included-in-the-free-plan-for-students)
- [Learn 題型及匯入](https://knowt.com/learn-mode)
- [手機同步](https://knowt.com/mobile)
- [卡片匯出](https://help.knowt.com/en/articles/10714472-how-can-i-export-my-flashcards)
- [付費帳號額度](https://help.knowt.com/en/articles/10298019-why-am-i-being-asked-to-pay-when-i-m-subscribed)

## R-012 StudySmarter｜官網初查完成

摘要：新增原文畫線→卡片→弱項參考；離線與 CSV 均有範圍／方案限制。

來源：助理依使用者要求新增。定位：教材、筆記、卡片、測驗與學習計畫。查核：2026-10-06；未實測。

功能觀察（官方文件）：
- PDF viewer 畫線移入卡片／筆記，自評理解與篩選弱項；SRS 用 Poor／Okay／Good／Perfect 自評。
- Test 依內容製題並給回答回饋，官方仍標 beta，可能有錯誤／延遲。
- Web、iOS／Android；官方離線只列手機自建卡組 Flashcard mode，先下載，不能推成離線 SRS／Test。同步衝突機制未確認。

限制與成本：免費＋Premium，有七天試用、去廣告、多組離線、CSV 及 AI Assistant；現行金額未確認。免費離線一組、Premium 多組，不沿用舊「全部免費」宣稱。

資料匯出：Premium 自建卡片純文字 CSV，不含格式、公式及圖片；來源定位、排程及事件匯出未確認。

可借鑑之處（助理提案）：原文畫線製卡、弱項篩選及答後補強。不宜直接搬用：匯出付費、圖片／公式損失，自評不能替代錯因。

待實測：繁體中文判分、精確來源、離線事件回傳、臺灣價及附件保留。相關點子：I-002、I-004、I-005、I-006、I-009、I-013。

官方來源：
- [PDF viewer 與理解自評](https://studysmarter.zendesk.com/hc/en-gb/articles/360010136259-Studying-with-the-StudySmarter-PDF-Viewer)
- [SRS 自評](https://studysmarter.zendesk.com/hc/en-gb/articles/5617520656924-Spaced-Repetition)
- [Test 與 beta 限制](https://studysmarter.zendesk.com/hc/en-gb/articles/8186624731292-Test)
- [離線範圍](https://studysmarter.zendesk.com/hc/en-gb/articles/7698982988572-Practice-flashcards-offline)
- [CSV 匯出限制](https://studysmarter.zendesk.com/hc/en-gb/articles/18447712394012-Flashcard-Export-Function)
- [Premium 與試用](https://studysmarter.zendesk.com/hc/en-gb/articles/360011129199-Become-a-StudySmarter-Premium-Member)

## 研究結論與優先順序｜助理提案

優先以同一份繁體中文生物教材測 RemNote、Anki、Mochi、Readwise Reader、NotebookLM、Recall；Memory Toast 另測手機拍照及隨手複習。Quizlet、Brainscape、Knowt、StudySmarter 用於第二輪評量／介面比較，SuperMemo 研究來源摘錄與漸進製卡。這是本案參考價值排序，不是產品排名，也不表示購買或改用任何產品。

- 內容共用：研究 RemNote 筆記製卡、Anki 欄位／模板與 Mochi 互連，避免每張卡各複製一份筆記。
- 來源核對：Readwise 片段定位、NotebookLM 引用解析、Recall 來源卡，須測能否回到精確原文。
- 手機回饋：Edit Later 可作「手機標記、電腦修訂」參考；答錯不等於筆記內容錯誤。
- 資料自主：內容交換與完整備份分工，附件、題目版本、逐次事件都列入回復設計。
- 排程與理解：重排、熟練度、AI 解釋、錯因診斷是不同能力；本輪未取得足以確認任一產品完整實現 C-008／C-011「分錯因→補強→可核對修訂→寫回共用概念」的證據。

## 下一輪實測紀錄格式

使用同份合法可用教材、少量同概念題目，記錄選段、製卡、答錯、找來源、提出修訂、離線作答、匯出回復的耗時、切換次數及資料遺失，避免只比功能數量。

每項保留產品／版本／平台／方案、功能、來源及日期、實際情境、觀察證據、可借鑑之處、不適合之處、剩餘問題及相關 I-ID。未實測維持待實測，是否採用另行討論。
