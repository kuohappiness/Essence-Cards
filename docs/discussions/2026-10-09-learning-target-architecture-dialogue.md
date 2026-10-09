# Essence Cards 細部架構討論｜對話紀錄

日期：2026-10-09（Asia/Taipei）  
形式：逐輪對話紀錄  
範圍：本輪從「接下來進入細部討論」開始的討論內容。依使用者要求，保留對話形式，並排除最後一輪助理回答。

---

## 使用者

接下來進入細部討論，你覺得該從哪裡開始

---

## 助理

我建議**不要先從 AI、介面或間隔重複演算法開始**，而是先把 Essence Cards 最核心的「學習物件＋一次完整學習循環」定死。

原因很簡單：現在產品定位已經清楚變成 **輸出 → 檢核 → AI 輔助**。只要這個核心閉環穩定，之後換 SM-2、FSRS、不同 AI 模型，甚至換 UI，都只是外掛能力；反過來如果核心資料結構沒先定，後面每一層都會一直重構。

我會照這個順序進入細部設計：

1. **先定義「Essence Card 到底是什麼」**
   - 一張 Card 是一個 Markdown 檔？還是筆記裡的一個 block？
   - 一張 Card 最少有哪些資料？
   - Question / Answer 是否只是其中一種輸出形式？
   - Cloze、選擇題、自由回憶、概念解釋，要不要共用同一個 Card schema？
   - 學習紀錄放在哪裡？
   - 原始知識與學習狀態要不要分離？

2. **定義最小學習閉環**

   我認為第一版最核心流程應該先簡化成：

   **Obsidian 知識 → 選出學習項目 → 顯示提示 → 使用者輸出 → 檢核 → 記錄結果 → 決定下次出現時間**

   先假設**完全沒有 AI**，這條流程也必須能完整運作。

3. **定義「輸出」的型態**

   不要一開始就把輸出等同於閃卡。這點我認為對 Essence Cards 很重要。

   未來其實可能有：
   **Recall、Cloze、Explain、Compare、Apply、Quiz**。

   如果底層一開始寫死成 front/back flashcard，之後很可能會卡住。

4. **再設計「檢核」**

   這時才討論：
   - Again / Hard / Good / Easy？
   - 對錯？
   - 信心程度？
   - 是否真的理解？
   - 是否需要重新輸出？
   - 排程演算法怎麼吃這些結果？

   而且我會把「**檢核結果**」與「**排程結果**」拆開。  
   因為「我答得怎麼樣」是一件事，「系統決定多久後再問」是另一件事。

5. **最後才接 AI 層**

   AI 不應該變成核心流程，而是插在既有流程上的能力：

   **產生題目／改寫題目／判讀答案／給提示／解釋錯誤／產生延伸問題**

   這樣才能真正做到我們前面談過的「AI 像插頭一樣隨插即用」。

所以如果現在要正式開始第一個細部設計，我會選：

> **Essence Card 的資料模型與生命週期**

而且我會先問的不是「卡片有哪些欄位」，而是更根本的一題：

### 「Essence Cards 裡最小的學習單位到底是什麼？」

我目前傾向它**不是傳統的 Flashcard**，而是：

> **Learning Item（學習項目）**  
> 一個需要被使用者主動輸出、接受檢核，而且能累積學習狀態的知識單位。

Flashcard 只是 Learning Item 的其中一種呈現方式。

這個選擇會直接影響整個專案未來的天花板。  
如果你同意，我建議我們下一步就直接把 **Learning Item / Essence Card 的資料結構** 一個欄位一個欄位拆開設計，並順便判斷哪些資料應該存在 Markdown、哪些應該存在外掛自己的資料庫裡。

---

## 使用者

先規劃。如果你是最強大腦。你會怎麼做，給我看看你的規劃我再決定

---

## 助理

如果由我來主導，我會把接下來的細部設計當成一次「產品定型」，而不是直接開始列功能。

因為現在最危險的事情不是想不到功能，而是**太早把某種學習方式寫進底層架構**。例如一開始把 Essence Cards 定義成「更好的閃卡軟體」，半年後想加入概念解釋、比較題、開放式回答、AI 對話檢核，就會發現整個資料模型都是 front / back / due_date，那會非常痛苦。

所以我會用下面這個順序。

## 我會把細部設計分成 9 個階段

| 階段 | 我們真正要回答的問題 | 最終產物 | 為什麼排在這裡 |
|---|---|---|---|
| **0. Product Constitution** | Essence Cards 到底「是什麼、不是什麼」？ | 5–10 條產品設計原則 | 防止後面功能越加越歪 |
| **1. Learning Model** | 人到底怎麼透過這個軟體學習？ | Essence Learning Loop | 先設計學習，而不是設計軟體 |
| **2. Learning Object** | 系統中最小的「可學習單位」是什麼？ | Learning Item 模型 | 這會決定整個資料架構 |
| **3. Output System** | 使用者有哪些真正的「輸出」方式？ | Output Type 架構 | 避免把產品綁死在 Flashcard |
| **4. Evaluation System** | 怎麼判斷「會不會」？ | Evaluation Model | 把學習判斷與排程拆開 |
| **5. Scheduling System** | 什麼內容什麼時候再次出現？ | Scheduler Interface | FSRS、SM-2 等只是實作之一 |
| **6. AI Capability Layer** | AI 可以在哪些地方增強，但不能綁架系統？ | AI Capability / Provider Contract | 才能做到模型隨插即用 |
| **7. UX Learning Session** | 使用者實際打開手機後怎麼學？ | Session Flow + Screen States | 把理論轉成真正體驗 |
| **8. Data & Technical Architecture** | Markdown、Obsidian、外掛資料怎麼存？ | Schema + API boundaries | 到這裡才真正定技術細節 |

最後再做：

> **MVP Cut：第一版到底做什麼、不做什麼。**

這個順序我認為很重要。

# 0. 我第一個會做的，其實不是 Card schema

而是先寫一份很短的 **Essence Cards Product Constitution**。

例如我目前會先提出這幾條候選原則：

1. **Active Output First**  
   學習的核心不是閱讀，而是要求使用者產生輸出。

2. **Evaluation ≠ Scheduling**  
   「答得好不好」和「多久後再出現」是兩套不同系統。

3. **AI Optional, Not Required**  
   沒有任何 AI API，核心學習流程仍然完整可用。

4. **Knowledge Belongs to the User**  
   原始知識盡量保持 Markdown 可讀、可攜。

5. **Learning State Is Separate from Knowledge**  
   「這個知識是什麼」與「我學得怎麼樣」不要混在一起。

6. **One Knowledge Item, Many Learning Experiences**  
   同一個知識可以產生不同輸出方式，而不是複製成很多張互不相關的卡。

7. **Progressive Complexity**  
   初學者可以直接開始，高階使用者才需要看到複雜設定。

我甚至會把這份文件視為比功能清單還重要。

因為以後任何功能都可以問：

> 這個設計有沒有違反 Constitution？

# 1. 接著才設計真正的 Learning Loop

目前我們的大藍圖是：

**輸入 → 整理 → 學習 → 回饋**

這是整體知識系統的大循環。

但 Essence Cards 自己內部，我會再定義一個更小的核心：

**Select → Prompt → Output → Evaluate → Feedback → Schedule**

也就是：

> 選一個值得學的東西  
> → 系統提出刺激  
> → 使用者必須輸出  
> → 系統判斷表現  
> → 給回饋  
> → 更新學習狀態  
> → 決定下一次互動

這才是 Essence Cards 的「引擎」。

而 **Essence Capture** 負責的是：

> Knowledge → structured knowledge

兩個 repo 可以獨立開發，但在更大的知識學習藍圖裡仍然接在一起。

# 2. 然後才解決最重要的抽象：Learning Item

這可能是我們整個專案最值得花時間的一題。

我目前不建議底層直接叫：

> Card

我會把底層物件暫時叫：

> **Learning Item**

例如原始知識：

> 粒線體內膜是電子傳遞鏈與 ATP synthase 的所在地。

它可以產生：

**Recall**
> 粒線體電子傳遞鏈位在哪裡？

**Cloze**
> 電子傳遞鏈位於粒線體的 ______。

**Explain**
> 為什麼粒線體內膜適合進行氧化磷酸化？

**Compare**
> 粒線體內膜與外膜的功能有何差異？

**Apply**
> 如果粒線體內膜失去質子通透性控制，ATP 合成可能發生什麼改變？

這五個其實可能來自**同一個知識單位**。

這就是我不希望 Essence Cards 太早被「Flashcard」綁住的原因。

# 3. Output System 我會設計得比一般 SRS 更廣

這部分可能最後會成為 Essence Cards 最大的產品差異。

傳統軟體通常是：

> Prompt → Reveal Answer → Rating

我希望 Essence Cards 可以逐漸變成：

> Knowledge → 選擇適當的 cognitive output

例如未來可能存在：

| Output | 使用者做什麼 |
|---|---|
| Recall | 想出答案 |
| Cloze | 補缺 |
| Recognition | 選答案 |
| Explain | 自己解釋 |
| Compare | 比較兩概念 |
| Sequence | 排順序 |
| Diagram | 標示圖形 |
| Apply | 解決情境問題 |
| Teach-back | 用自己的話教一次 |

第一版當然不會全部做。

但是**架構必須允許它們存在**。

# 4. Evaluation 是我會特別重新設計的地方

這也是我覺得目前很多學習軟體做得不夠好的地方。

傳統 Anki：

> Again / Hard / Good / Easy

其實把很多不同概念混在一起了。

使用者按 Good，到底代表：

- 答對？
- 很有信心？
- 很快？
- 理解？
- 只是看答案覺得「喔我知道」？

這些不是同一件事情。

所以我會研究是不是至少在內部概念上拆成：

**Performance**

**Confidence**

**Assistance**

**Latency**

例如：

> 答對  
> + 花 18 秒  
> + 使用一次提示  
> + 信心低

這是一個遠比「Good」更有資訊量的 learning event。

使用者介面卻不一定要複雜。

這就是我會追求的：

> **內部模型豐富，外部操作簡單。**

# 5. Scheduler 反而不會太早決定

我不會先討論：

> SM-2 還是 FSRS？

因為那只是 implementation。

底層應該是：

~~~
Learning Event
        ↓
Scheduler
        ↓
Next Review
~~~

Scheduler 可以換。

今天：

> FSRS

未來：

> FSRS 6

甚至：

> AI-adjusted scheduler

核心都不用重寫。

# 6. AI 我會做成 Capability，而不是 AI Feature

這一點延續我們之前的方向。

不要設計：

~~~
OpenAIService
GeminiService
ClaudeService
~~~

而是：

~~~
Capability
├─ generate_question
├─ evaluate_answer
├─ explain_error
├─ generate_hint
├─ transform_output
└─ generate_variation
~~~

然後：

~~~
Capability
        ↓
AI Router
        ↓
Provider Adapter
        ↓
OpenAI / Gemini / Claude / Local / Other
~~~

甚至同一個功能可以：

~~~
evaluate_answer
→ local model

generate_question
→ cheap model

deep explanation
→ stronger model
~~~

這才是真正的「AI 插頭」。

# 7. 到這一步才設計實際 Learning Session

例如手機打開：

~~~
Today
  ↓
12 items due
  ↓
Start
  ↓
Prompt
  ↓
Think / Type / Speak
  ↓
Evaluate
  ↓
Feedback
  ↓
Next
~~~

然後才開始問：

- 要不要顯示進度？
- 是否有手勢？
- 是否可以全鍵盤？
- iPhone 單手操作？
- 是否允許跳過？
- AI feedback 多長？
- 回答錯誤時是否立即重做？
- 是否允許只想、不輸入文字？

這時候 UI 設計才會有意義。

# 8. 然後才進入真正的 Schema

這時我們才決定：

~~~
Knowledge
Learning Item
Output
Learning Event
Learning State
Schedule
AI Interaction
~~~

哪些：

> Markdown

哪些：

> YAML

哪些：

> Obsidian metadata

哪些：

> plugin local database

哪些：

> cache

這個時候我們才有足夠資訊做出正確決定。

# 最後做一件非常重要的事情：MVP 切割

我會強迫我們做一張：

### V1 / Later / Never

因為我現在其實比較擔心的是 **Essence Cards 太有潛力，反而容易功能爆炸**。

例如我目前猜測 V1 很可能只需要做到：

~~~
Obsidian note
     ↓
Learning Item
     ↓
Recall / Cloze
     ↓
User output
     ↓
Self evaluation
     ↓
Scheduling
     ↓
Review queue
~~~

AI 第一版甚至只需要：

~~~
Generate
Evaluate
Explain
~~~

三個 capability。

其他全部先留 architecture extension point。

# 所以如果讓我主持接下來的討論

我不會一次把九個階段全部做完。

我會照這個順序逐層鎖定：

> **產品原則**
>
> ↓
>
> **學習模型**
>
> ↓
>
> **Learning Item**
>
> ↓
>
> **Output**
>
> ↓
>
> **Evaluation**
>
> ↓
>
> **Scheduling**
>
> ↓
>
> **AI**
>
> ↓
>
> **UX**
>
> ↓
>
> **技術架構**
>
> ↓
>
> **MVP**

而每一層都會做一件事：

**先發散 → 比較方案 → 找風險 → 做決策 → 寫進 GitHub。**

我認為這樣比我們直接開始討論「Card 有哪些 properties」更穩。

而且我會特別把前三個階段 **Product Constitution → Learning Model → Learning Item** 視為整個專案最重要的三次設計決策。

**如果這三個做對，後面大部分是工程問題；如果這三個做錯，再漂亮的 UI 和再強的 AI 都救不了產品。**

---

## 使用者

請以最強大腦的身分與我討論，並告訴我你現在是以什麼模型在跟我對話
1.設計這個產品，主要原因是希望幫助學生節省複習功課的時間，短時間能夠記住並且理解更多，你的learning loop很好，但我比較專注在後半段，用閃卡的方式快速重複加上間隔重複的刺激來加深記憶
2.Learning Item的部分，我同意你的說法，一個知識不一定只是一個flash card，但你所列的所有問題：recall,  cloze, explain, compare, apply,  本質上都是一個問題，雖然有點不同，但都可以用閃卡的UI樣式呈現不是嗎？例如
正面：電子傳遞鏈位於粒線體的 _____。
背面：粒線體內膜
比較無法用閃卡呈現的應該是心智圖，其他圖像等
我同意知識不能被侷限在閃卡，所以這個專案應該也可以保留像是心智圖或其他知識輸出的彈性，你覺得呢
3.我同意Output System可以更寬
4.我同意，但你必須提出比較具體的建議，在這之前我先否決作答時間，因為實際使用情況可能做到一半跑去吃飯，吃到一半再拿起繼續做，並不是那麼理想化的一直在正式的作答。我覺得這個軟體設計的核心思想在於，能夠在摩擦力很低的狀況下，隨時輕鬆地拿起來就直接進入複習卡片階段。所以整個流程一定要越流暢越好
5.我同意可以把scheduler模組化，讓用戶自定要哪一種
6.AI插頭的規畫應該後續專門詳細討論
最後：**Product Constitution**  的部分，你有更了解我設計此產品的思路了嗎?  有沒有要修改的
有其他重要的資訊或日後要討論的問題也幫我整理起來

---

## 助理

現在跟你對話的模型是 **GPT-5.6 Sol**。

你這次補充後，我對 Essence Cards 的核心定位更清楚了：它不是要做一套「完整學習理論平台」，而是要把**複習這件事壓縮到極低摩擦、極高密度、可長期維持**，讓學生用零碎時間快速反覆刺激記憶，同時保留理解層次的擴充能力。這會讓我修改前面幾個設計判斷。

有，而且這次你的補充讓產品的重心明顯收斂了。

我會修正我前面的說法：**Essence Cards 不需要企圖成為一套包辦所有學習行為的系統。它的主戰場就是「高效率複習」**。理解不是另一套獨立流程，而是透過不同類型的提問，融入快速重複與間隔重複之中。

換句話說，我現在會把 Essence Cards 的產品核心濃縮成：

> **用最低的操作摩擦，在最短時間內完成最多次「有效提取」，並透過適當的重複時機，使知識進入長期記憶；再利用不同問題形式，避免學生只是死背而沒有理解。**

這和我前面比較廣義的 Learning System 定位，是有差異的。

## 1. Learning Loop：我會把它縮成「Review Loop」

原本：

**Select → Prompt → Output → Evaluate → Feedback → Schedule**

概念沒錯，但對 Essence Cards 來說，我甚至會再把使用者感受到的流程縮短：

**題目 → 想答案 → 翻面／作答 → 判斷 → 下一題**

底層才是：

**Prompt → Retrieval → Evaluation → Learning Event → Scheduler → Next Review**

這兩層一定要分開。

學生不應該感覺自己正在操作一套「學習管理系統」。

最理想的感覺應該是：

> 手機拿起來 → 馬上開始第一題 → 一題接一題。

甚至我認為以後值得訂一個 UX 指標：

> **從打開 Essence Cards 到看到第一個可作答題目的時間，應該接近零。**

這會影響非常多後續設計。

# 2. Flashcard：你的判斷我基本同意，而且我會再往前一步

你說：

> Recall、Cloze、Explain、Compare、Apply，本質都是問題，所以其實都可以用 Flashcard UI。

**對。**

而且這件事情比我前面說的還重要。

我之前把：

> Flashcard  
> Explain  
> Compare  
> Apply

分得有點太「功能導向」。

實際從 UI interaction 來看，它們都是：

**Prompt → Retrieval → Reveal / Evaluate**

例如：

### Recall

正面：

> 粒線體電子傳遞鏈位於哪裡？

背面：

> 粒線體內膜

### Cloze

正面：

> 電子傳遞鏈位於粒線體的 ______。

背面：

> 內膜

### Explain

正面：

> 為什麼粒線體內膜適合進行氧化磷酸化？

背面：

> 參考答案／關鍵概念

### Compare

正面：

> 比較粒線體內膜與外膜的主要功能差異。

背面：

> 比較表格

### Apply

正面：

> 若粒線體內膜失去維持 H⁺ 濃度梯度的能力，ATP 合成會受到什麼影響？

背面：

> 結果＋原因

全部都可以是同一個 UI。

所以我會修改之前的架構：

> **Flashcard 不應該只是其中一種 Output Type。**

比較精確的說法應該是：

> **Card 是 Essence Cards 的主要 interaction shell。**

也就是一個「提示 → 思考／作答 → 顯示答案」的容器。

而：

**Recall / Cloze / Explain / Compare / Apply**

比較像是：

> **Prompt Type / Learning Strategy**

這個區分非常重要。

# 3. 但「Card UI」不能等於「Card Data Model」

這裡我還是要踩煞車。

我們可以讓 80～90% 的學習活動都用 Card UI。

但不能因此把資料結構寫成：

~~~
front
back
~~~

因為未來可能出現：

~~~
prompt
reference_answer
image
diagram
choices
cloze_regions
concept_links
hint
source
...
~~~

UI 看起來仍然是一張卡。

但底層其實已經不是傳統 Flashcard。

所以我會採：

> **Card-first UI，Learning-Item-first architecture。**

我覺得這句可以成為我們後面的重要設計原則。

# 4. 心智圖、圖像之類怎麼辦？

這裡我反而會比你再保守一點。

**現在不要為它們建立另一套系統。**

因為即使是圖像，有很多仍然能塞進 Card interaction。

例如生物：

正面：

> 一張沒有標示名稱的心臟圖  
> 「指出主動脈的位置」

背面：

> 顯示標示

甚至：

> 神經元圖  
> → 點選軸突

或：

> 空白概念圖  
> → 要學生補上一個節點

還是：

**Prompt → Output → Evaluation**

真正不同的是：

> **輸出的 renderer 不同。**

所以未來架構比較漂亮的方式是：

~~~
Learning Item

        ↓

Renderer

 ├─ Card Renderer
 ├─ Image Renderer
 ├─ Diagram Renderer
 ├─ Mind-map Renderer
 └─ Future Renderer
~~~

### V1

只做：

**Card Renderer**

就好。

但架構不要封死。

這樣既不 over-engineering，又保留未來彈性。

# 5. Evaluation：我現在會否決「作答時間」

這點我完全接受你的反駁，而且我認為你抓到了一個比「時間」更重要的產品哲學。

學生可能：

做三題  
→ 媽媽叫吃飯  
→ 手機放桌上  
→ 20 分鐘後回來  
→ 再做兩題  
→ LINE 跳出來  
→ 回訊息  
→ 再繼續。

這不是 exception。

**這才是真實世界。**

所以我會正式把：

> response latency

從核心 Evaluation Model 移除。

甚至我會進一步提出一個設計原則：

> **Essence Cards 不應假設存在完整、連續的「學習 session」。**

# 6. 我會引入一個非常重要的概念：Atomic Review

一張卡就是一個完整學習事件。

完成：

~~~
題目
↓
提取
↓
檢核
↓
紀錄
~~~

就結束。

下一張完全是新的 event。

因此：

> 做 1 張可以。  
> 做 37 張可以。  
> 中間離開 40 分鐘也可以。

不應因為：

> session 被中斷

而產生任何問題。

這對手機體驗非常重要。

我甚至認為這可能是 Essence Cards 跟某些比較「正式學習模式」軟體的重要差異：

> **沒有「我要開始讀書」這個心理門檻。**

而是：

> **有 30 秒就可以複習。**

這是非常強的產品定位。

# 7. Evaluation 我現在會怎麼設計？

我會先砍掉很多東西。

前面我提出：

- correctness
- confidence
- assistance
- latency

現在我會改成：

### 核心只保留一個：

> **Retrieval Outcome**

也就是：

> 這次到底記得怎麼樣？

V1 我最推薦的是三階：

| 狀態 | 意義 |
|---|---|
| **忘記** | 沒想起來／答錯 |
| **模糊** | 有印象，但不完整、不確定 |
| **記得** | 可以正確提取 |

可能 UI 最後不是這三個字，我們之後再討論。

但底層的語義大概如此。

## 為什麼我目前不喜歡要求使用者另外填 Confidence？

因為：

> 「答對＋信心多少？」

多一次選擇就是多一次 friction。

每天做 100 張：

每張多做一次判斷，就多 100 次操作。

這與你的產品定位衝突。

而：

> **模糊**

其實已經吸收了大部分 confidence 的資訊。

# 8. Assistance 可以紀錄，但不要讓使用者填

例如未來有：

> 看提示 Hint

系統自己知道。

所以 Learning Event 可以記：

~~~
outcome = shaky
hint_used = true
~~~

而不是跳出：

> 「你有沒有使用提示？」

所以 Evaluation 的哲學我會改成：

> **能自動紀錄的就自動紀錄；不能自動紀錄但價值不夠高的，就不要問。**

這句我覺得也值得寫進 Product Constitution。

# 9. 那 Anki 的 Again / Hard / Good / Easy 怎麼辦？

這裡正好和你說的 Scheduler 模組化結合。

我認為：

> **不要讓 Scheduler 的資料需求反過來綁架 UI。**

Essence Cards 核心可以只產生：

~~~
FAIL
PARTIAL
SUCCESS
~~~

Scheduler Adapter 自己負責：

~~~
Essence outcome
       ↓
Scheduler Adapter
       ↓
FSRS / SM-2 / other
~~~

例如某個 scheduler 需要四級評分：

可以：

> 由 adapter mapping

或者使用者選擇該 scheduler 後：

> UI 開啟 Advanced rating mode。

這個問題後面要深入研究，但架構上我會這樣切。

# 10. 我現在會修改 Product Constitution

前一版我列的原則有些太偏「通用學習軟體」。

現在我會改成下面這個版本。

| 原則 | 我的新版定義 |
|---|---|
| **1. Learning per Minute** | 第一優先不是功能數量、使用時間，而是每分鐘有效學習量 |
| **2. Retrieval First** | 核心學習機制是主動提取＋重複，而不是重新閱讀 |
| **3. Friction Approaches Zero** | 打開就能學；每張卡需要的操作越少越好 |
| **4. Atomic Review** | 一張卡是一個完整學習事件，不依賴完整 session |
| **5. Card-first, Not Card-locked** | Card 是主要 UI，但底層 Learning Item 不被 Front/Back 限制 |
| **6. Understanding Through Better Prompts** | 理解不是另一個複雜模式，而是透過 Explain、Compare、Apply 等題型融入複習 |
| **7. Evaluation Must Be Cheap** | 檢核取得的資訊價值必須高於造成的操作成本 |
| **8. Evaluation ≠ Scheduling** | 學習結果是原始事實；Scheduler 只是解讀它的其中一種方式 |
| **9. Scheduler Is Replaceable** | FSRS、SM-2 或未來方法都是模組 |
| **10. AI Is Optional Augmentation** | 沒有 AI，核心複習流程仍然完整；AI 後續作為可插拔能力 |
| **11. User-owned Knowledge** | 知識本體盡可能維持 Obsidian / Markdown 可讀、可攜 |
| **12. Complexity Behind Simplicity** | 內部可以很聰明，但學生看到的操作必須非常簡單 |

我現在認為 **1、3、4** 特別重要。

因為它們開始真正描述：

> **為什麼要做 Essence Cards。**

# 我甚至想替這個產品建立一個北極星指標

不是：

> DAU

不是：

> 每日學習分鐘

也不是：

> 卡片數量。

而是接近：

> **Effective Retrievals per Minute**

中文可以暫時叫：

> **每分鐘有效提取次數**

因為你的目的其實是：

**更少的時間 → 更多有效記憶刺激。**

當然正式怎麼量還需要研究，現在不急著把 metric 寫死。

但它對設計判斷很好用。

例如未來有人提議：

> 每做一張卡讓學生選「信心 1～5」。

我們就問：

> 它增加的學習資訊，值不值得降低 Retrievals per Minute？

這就有答案了。

# 目前我認為已經可以「暫時定案」的東西

我會先記成 Decision，而不是永遠不能改：

| 項目 | 目前方向 |
|---|---|
| Essence Cards 核心 | 快速複習＋主動提取＋間隔重複 |
| Learning Item | 不等同傳統 Flashcard |
| 主要 UI | Card |
| Recall / Cloze / Explain / Compare / Apply | Prompt Type，而不是完全不同學習系統 |
| 非 Card 輸出 | 架構保留 Renderer 擴充 |
| Session | 非必要概念 |
| Review | Atomic |
| Response time | 不作為核心評估訊號 |
| Evaluation | 優先極低摩擦 |
| Scheduler | 可替換模組 |
| AI | 後面獨立深入設計 |

# 接下來有幾個重要問題，我建議先記著，不要現在全部展開

1. **Learning Item 到底包含哪些資料？**  
   這應該是下一個主要議題。

2. **Knowledge Item 與 Learning Item 是不是同一個東西？**  
   我目前傾向不是。  
   一個知識可能產生多個 Learning Items。

3. **同一知識產生五種題目，排程要分開還是共享記憶狀態？**  
   這是一個非常大的問題。  
   例如你 Recall 已經很熟，但 Apply 還不會，代表什麼？

4. **Evaluation 三階是否真的最佳？**  
   「忘記／模糊／記得」只是我目前最推薦方案，需要之後跟實際 scheduler 與 UX 一起驗證。

5. **Reveal answer 算不算一次失敗？**  
   這件事情會直接影響操作摩擦與紀錄方式。

6. **是否允許學生完全不輸入答案，只在腦中回答再翻面？**  
   我目前答案是：**一定要允許。**  
   因為這對速度非常重要。

7. **何時才要求真正輸入文字？**  
   可能是 AI Evaluation、拼字、語言學習或特定題型，而不應成為預設。

8. **「理解」如何避免變成學生看到答案後的理解錯覺？**  
   Explain / Compare / Apply 很可能是我們解這題的核心。

9. **每日複習 Queue 怎麼組成？**  
   Due、new、failed、priority 如何混合，會大幅影響實際使用感。

10. **中斷與恢復**  
    App 關掉、切到其他程式、隔幾小時回來，應該如何無感恢復。

而如果現在讓我選**下一個只討論一件事**，我會改變我前一次的選擇。

不是先做完整 Card Schema。

我會先討論：

> ## **Knowledge Item → Learning Item → Prompt/Card 之間到底是什麼關係？**

因為我們現在已經發現一個關鍵：

**「一個知識」和「一張卡」明顯不是 1:1。**

這個關係一旦定對，Recall、Cloze、Explain、AI 自動出題、不同 Renderer，甚至後面的記憶狀態共享問題，都會順很多。

我認為這會是我們下一個真正的架構核心。

---

## 使用者

我們就先討論1～3。4～10你可以先記錄下來之後再展開
針對你的問題，不如我們舉一個實際例子來討論你覺得如何，透過實際例子來找到我們真正想要的，接下來請你把能力提升到5.6極致最高等級，一起好好思考一下

---

## 助理

可以，我也認為用真實案例反推架構，比先抽象定義更可靠。現在是 **GPT-5.6 Sol**；我無法在對話裡自行切換你介面上的模型檔位，但我會用目前可用的高推理強度來處理這段設計。

我先把第 4～10 題列為「後續待展開」，這一輪只處理 **Knowledge Item、Learning Item，以及多題型如何共享學習狀態／排程**。

我贊成，而且我會刻意選一個**能把架構逼出問題的案例**，而不是太簡單的「台灣首都是台北」這種例子。

先用你熟悉的生物，而且沿用我們前面提過的粒線體：

> **知識主題：氧化磷酸化**  
> ① 電子傳遞鏈位於粒線體內膜。  
> ② 電子傳遞鏈將 H⁺ 從基質側移向膜間腔。  
> ③ H⁺ 順濃度梯度經 ATP synthase 回流，驅動 ATP 合成。  
> ④ O₂ 是電子傳遞鏈最後的電子接受者。

我先不急著替架構命名，而是從「學生到底要學會什麼」反推。

## 第一個重要發現：我開始懷疑只有 Knowledge Item → Learning Item 兩層還不夠

假設我們把上面四句當成一個 Knowledge Item。

學生可能遇到下面這些卡：

**A**
> 電子傳遞鏈位於粒線體的 ______。  
> → 內膜

**B**
> 粒線體的電子傳遞鏈位於哪個構造？  
> → 內膜

**C**
> 電子傳遞鏈如何建立 H⁺ 濃度梯度？  
> → 將 H⁺ 由基質側移向膜間腔

**D**
> H⁺ 濃度梯度如何促進 ATP 形成？  
> → H⁺ 經 ATP synthase 回流……

**E**
> 為什麼粒線體內膜受損可能降低 ATP 產量？

**F**
> 如果粒線體內膜突然對 H⁺ 完全通透，ATP 合成會如何改變？為什麼？

這時候出現一個非常關鍵的問題：

A 和 B 雖然是**兩張不同卡片**，但學生其實是在證明**同一件能力**：

> 「我知道電子傳遞鏈位於內膜。」

所以它們不應該是兩個獨立需要複習的 Learning Item。

否則就會發生很糟的情況：

> A 今天答對  
> B 明天又問一模一樣的知識  
> 系統還以為這是兩個不同學習項目。

這會浪費學生時間，直接違反 Essence Cards 的核心目標。

# 所以我現在傾向三層，而不是兩層

我暫時用三個名字表示：

~~~
Knowledge
   ↓
Learning Target
   ↓
Prompt / Card
~~~

先不用在意名稱，我們看意思。

## 第一層：Knowledge

它回答：

> **「這個知識內容是什麼？」**

例如：

> 電子傳遞鏈位於粒線體內膜。

或者比較大的知識群：

> 氧化磷酸化的機制。

這一層是**知識本身**。

它不應該包含：

- 下次什麼時候複習
- 答錯幾次
- 今天有沒有複習

因為那些不是知識的屬性。

# 第二層才是最重要的：Learning Target

它回答：

> **「我要讓學生學會什麼？」**

例如：

### LT-1
> 能回憶「電子傳遞鏈的位置」。

### LT-2
> 能說明「電子傳遞鏈如何建立 H⁺ 梯度」。

### LT-3
> 能解釋「H⁺ 梯度如何驅動 ATP 合成」。

### LT-4
> 能應用上述機制預測「膜對 H⁺ 通透性提高時的結果」。

注意這四個 Learning Target 很不一樣。

## 第三層：Prompt / Card

它只是：

> **「這次要怎麼問？」**

例如 LT-1 可以有：

### Prompt A — Cloze

> 電子傳遞鏈位於粒線體的 ______。

### Prompt B — Recall

> 粒線體電子傳遞鏈位於哪裡？

### Prompt C — 圖像

給粒線體圖片：

> 指出電子傳遞鏈主要存在的位置。

三張看起來完全不同。

但是它們其實都在測：

> **LT-1**

這就是我現在覺得非常關鍵的架構。

# 這會直接解決我們的問題 2 和 3

你原本問：

> Knowledge Item 和 Learning Item 是不是同一個？

我現在的答案會是：

**不應該是。**

而且我甚至想把 Learning Item 再精確定義成：

> **一個需要被學習、追蹤熟練程度並安排複習的能力目標。**

這比「一張卡」精確很多。

# 更重要的是：排程應該掛在哪裡？

我現在強烈傾向：

> **排程掛在 Learning Target，而不是 Card。**

回到 A、B：

A：

> 電子傳遞鏈位於粒線體的 ______。

B：

> 電子傳遞鏈在哪？

如果學生今天做 A，而且答對。

那麼 LT-1 已經完成這次 retrieval。

系統明天就**不應該因為 B 是另一張 Card 又拿出來問一次**。

B 可以只是：

> 下次 LT-1 到期時，隨機換個問法。

這會有一個很棒的結果：

### 同一個知識可以變化題目，但不增加複習負擔。

我認為這非常符合 Essence Cards。

# 但是 Explain 和 Apply 就不能完全共用排程

這正是第三題最有趣的地方。

例如：

### LT-3

> Explain：  
> 為什麼 H⁺ 回流可以產生 ATP？

學生答得很好。

但是：

### LT-4

> Apply：  
> 如果粒線體內膜對 H⁺ 突然變得高度通透，ATP 產量會怎樣？

學生完全不會。

這很合理。

因為：

> **記得機制 ≠ 會應用機制。**

所以如果把它們全部共用一個熟練度：

~~~
氧化磷酸化 = 熟練
~~~

會產生非常嚴重的錯誤。

學生可能只是「背得出來」，系統卻以為他「真的會」。

# 因此我的初步答案是「部分共享」，不是全共享也不是完全獨立

我會這樣設計：

~~~
Knowledge
│
├── Learning Target 1
│     電子傳遞鏈位置
│
│     ├─ Prompt A：填空
│     ├─ Prompt B：問答
│     └─ Prompt C：圖片
│
├── Learning Target 2
│     H⁺ 如何建立梯度
│
├── Learning Target 3
│     H⁺ 梯度如何產生 ATP
│
└── Learning Target 4
      應用機制預測異常結果
~~~

### 同一個 Learning Target 底下的 Prompt：

**共用學習狀態與排程。**

### 不同 Learning Target：

**各自有自己的學習狀態與排程。**

### Knowledge：

可以彙整下面所有 Target 的掌握狀況，但本身不直接決定下一次出題。

這是我目前最看好的架構。

# 這也讓我們重新回答第 1 題：Learning Item 到底需要什麼資料？

如果我們暫時把 Learning Item ≈ Learning Target，我現在不會讓它塞很多東西。

我會先只保留「真正屬於它」的資料概念：

| 類型 | 例子 |
|---|---|
| **identity** | 唯一 ID |
| **knowledge reference** | 它來自哪個知識 |
| **learning objective** | 要學生會什麼 |
| **learning depth/type** | recall / explain / apply… |
| **prompts** | 可以用哪些方式問 |
| **learning state** | 目前熟練狀態 |
| **scheduler state** | 下次複習相關資料 |

但我暫時**不想現在就決定 YAML 欄位名稱**。

那太早。

# 我還看到一個很值得我們深挖的地方

假設：

> LT-3：解釋 H⁺ 梯度如何產生 ATP

學生已經很熟。

那麼 LT-4：

> 應用到膜受損情境

是不是還需要從零開始建立記憶？

可能不需要。

也就是不同 Learning Target 雖然不能完全共用熟練度，但它們之間可能存在：

> **prerequisite / dependency**

例如：

~~~
知道位置
   ↓
理解機制
   ↓
解釋機制
   ↓
應用機制
~~~

LT-4 建立時可以知道：

> LT-3 已經很熟，所以 LT-4 初期不需要像全新的陌生知識一樣高頻重複。

這可能會成為 Essence Cards 後來比傳統 Flashcard 系統更聰明的一個地方。

但我現在**不建議立刻做**。

先記錄這個可能性即可。

# 我會先提出一個暫定架構

目前我的最佳版本是：

> **Knowledge = 要知道的內容**
>
> **Learning Target = 要證明自己學會的能力**
>
> **Prompt/Card = 用什麼方式刺激這次提取**

而真正的 SRS 單位是：

> **Learning Target**

不是 Knowledge。

也不是 Card。

我認為這可能是目前為止很重要的一次架構收斂。

## 但現在我不想直接把它定案

下一步我反而建議我們拿這個模型去撞一個**更棘手的真實案例**。

例如高中生物的「動作電位」：

> Na⁺ 通道開啟  
> → 去極化  
> → Na⁺ 通道失活  
> → K⁺ 通道開啟  
> → 再極化  
> → 過極化  
> → 回到靜止膜電位

因為這個案例同時包含：

**單一事實、先後順序、因果關係、圖形判讀、解釋、錯誤迷思、應用。**

如果我們剛才的三層架構連這種內容都能漂亮處理，我才會比較有信心把它正式寫進 Essence Cards 的核心資料模型。

我建議下一輪就真的拿「動作電位」逐張拆卡，我們會很快看出 **Knowledge、Learning Target、Card 的邊界到底在哪裡**。

---

## 使用者

1.你可以去拆看看「動作電位」

2.我同意你的三層架構
我理解的是把每一個知識來源都拆解成要學習的學習點
變成原子知識點是嗎？
但要如何達成這樣的目標 實際上要怎麼做
我覺得這個概念很好，但需要判斷的太多
勢必得接上AI才辦得到對嗎

3.還有個實際上會遇到的問題是
有時候我並沒有要這麼複雜
例如我只是想某一課的英文單字利用閃卡的方式幫助記憶
快速地記起來而已
這些使用情境有辦法兼容並存嗎

問題越來越複雜，請你盡力思考，你的5.6 sol需要拉高到max或更高等級的智能嗎

---

## 助理

這一輪確實值得用高推理強度。我目前是 **GPT-5.6 Sol**；我不能自行把你介面上的模型檔位切成「Max」，但我會以目前可用的高推理強度處理。這題真正的難點不是功能多，而是要讓「簡單閃卡」和「AI 拆解複雜知識」共用同一套底層，不互相拖累。

我先講一個我認為很重要的修正：**Learning Target 不應等同「越切越小的原子知識」**。真正適合 Essence Cards 的單位，應該是「**最小可獨立檢核的學習目標**」——小到能判斷學生到底會不會，但不能小到把完整理解切碎成一堆低價值卡片。

我認為這一輪已經碰到 Essence Cards 很核心的架構問題了，而且你提出的「複雜教材」與「我只想背單字」其實正好是一組很好的壓力測試。

我的結論先講：

> **兩種情境不只可以並存，而且應該共用同一套底層。**
>
> 差別不應該是「兩套系統」，而應該是：
>
> **簡單資料走最短路徑；複雜資料才逐步增加結構。**

這會是我接下來設計的核心。

# 一、先拆「動作電位」，看看三層架構撐不撐得住

先假設原始教材大概講：

> 刺激達到閾值後，電壓閘控 Na⁺ 通道開啟，Na⁺ 流入造成去極化。之後 Na⁺ 通道失活，K⁺ 通道開啟，K⁺ 外流造成再極化。因 K⁺ 通道關閉較慢，會短暫產生過極化。最後膜電位恢復至靜止狀態，而 Na⁺/K⁺ 幫浦持續維持膜兩側離子濃度梯度。

如果直接叫 AI：

> 「幫我做閃卡。」

它很可能吐出十幾二十張。

這其實不是我們真正要的。

因為 Essence Cards 的目的不是：

> **把教材變成最多張卡。**

而是：

> **用最少的複習成本，涵蓋真正需要學會的內容。**

所以我會這樣拆。

| Knowledge Item | Learning Target | 可能的 Card / Prompt |
|---|---|---|
| 達閾值後 Na⁺ 通道開啟 | 能知道動作電位啟動時首先發生什麼 | 「達到閾值後，首先大量開啟哪種通道？」 |
| Na⁺ 流入造成去極化 | 能把離子流向與去極化連起來 | 「去極化主要是何種離子往哪裡移動？」 |
| Na⁺ 通道失活＋K⁺ 通道開啟 | 能理解峰值附近通道狀態轉換 | 「動作電位達高峰後，Na⁺、K⁺ 通道分別發生什麼？」 |
| K⁺ 外流造成再極化 | 能解釋再極化原因 | 「再極化主要由什麼離子移動造成？」 |
| K⁺ 通道關閉慢造成過極化 | 能解釋過極化原因 | 「為什麼膜電位會短暫低於靜止膜電位？」 |
| 幫浦主要維持濃度梯度 | 能避免『每次動作電位後都靠幫浦把離子搬回原位』的迷思 | 「動作電位後膜電位回復，主要是不是靠 Na⁺/K⁺ 幫浦立刻把離子全部搬回？」 |

到這裡都是比較局部的 Learning Target。

但還不夠。

因為學生可能六題都會，卻不知道整個過程。

所以還需要：

### Sequence Target

> 能依序說出：
>
> Na⁺ 通道開啟  
> → Na⁺ influx  
> → Na⁺ 通道失活／K⁺ 通道開啟  
> → K⁺ efflux  
> → 過極化  
> → 回復

它的卡可能是：

> 「請排列以下事件的正確順序。」

還可以有：

### Graph Target

給一張動作電位圖：

> 「圖中這個階段主要是哪個離子通道開啟？」

這個 Learning Target 其實同時用到了前面好幾個 Knowledge Items。

甚至有：

### Application Target

> 「若電壓閘控 K⁺ 通道被阻斷，再極化可能發生什麼變化？」

這也同時用到數個知識。

# 這讓我得到一個重要結論

我們原本的三層：

> Knowledge → Learning Target → Prompt

是對的。

但它**不是一棵單純的樹**。

更準確地說：

~~~
Knowledge Items
 K1   K2   K3   K4   K5
 │    │    │    │    │
 └────┴─┬──┴────┴────┘
        ↓
 Learning Targets
        ↓
 Prompt / Card variants
~~~

一個 Learning Target：

- 可以只對應一個 Knowledge Item。
- 也可以綜合多個 Knowledge Items。

這非常重要。

所以你問：

> 是不是把知識來源拆成原子知識點？

我的回答是：

## **方向對，但我不想使用「越原子越好」這個思維。**

我會定義兩件不同的東西：

**Knowledge Item**

> 最小的「有意義知識單位」。

**Learning Target**

> 最小的「可獨立判斷學生會不會的學習目標」。

這兩者不一定 1:1。

例如：

> Na⁺ 流入造成去極化。

很接近 1:1。

但：

> 「能看懂完整動作電位曲線」

就會跨越很多 Knowledge Items。

# 二、真正困難的問題：誰來拆？

你說得完全沒錯。

如果要求使用者每次都自己判斷：

> 這是不是 Knowledge Item？  
> 要不要拆？  
> 這是不是 Learning Target？  
> 要不要增加 Apply？  
> 是否跟另一張重複？

這套軟體根本不可能低摩擦。

所以這些東西**絕大部分不能讓一般使用者操作。**

它們是：

> **底層架構概念，而不是使用者介面。**

這點非常重要。

# 那是不是勢必要 AI？

我的答案分兩種。

## 如果需求是：

> 「我丟一篇 3000 字教材進去，請系統自動找出真正值得複習的學習點、避免重複、判斷哪些需要 Explain / Apply，再產生高品質卡片。」

那我會說：

> **是，實務上非常適合、甚至幾乎需要 AI。**

不用 AI 當然也可以寫大量 rule-based parser。

但是品質上很難處理：

- 語義
- 重要性
- 重複知識
- 因果關係
- 前後依賴
- 哪些內容值得成為卡片
- 哪些只是補充敘述

AI 非常適合這件事情。

## 但 Essence Cards 核心不能因此依賴 AI

這兩件事情要分清楚。

例如：

~~~
使用者自己做卡
↓
完全不需要 AI

Obsidian 語法產生卡
↓
完全不需要 AI

匯入單字表
↓
完全不需要 AI

選取一句文字做 Cloze
↓
完全不需要 AI

把整章教材自動轉成高品質學習結構
↓
AI 很有價值
~~~

所以我的架構仍然會堅持：

> **AI 是建立 Learning Structure 的 accelerator，不是 Learning Engine 的 dependency。**

沒有 AI：

Essence Cards 還是一套完整的 SRS 軟體。

有 AI：

Essence Cards 才會開始變成一個真正聰明的「知識→複習」轉換系統。

# 三、實際 AI 流程我不會讓它「直接產卡」

這可能是我們今天最重要的一個設計決策。

很多軟體現在是：

~~~
教材
↓
AI
↓
20 張 Flashcards
~~~

我認為這個架構不夠好。

Essence Cards 應該是：

~~~
教材
↓
AI 分析
↓
Knowledge Items
↓
Learning Targets
↓
去重 / 合併 / 重要性判斷
↓
Prompt variants
↓
Cards
~~~

AI 不是「Flashcard Generator」。

而是：

> **Learning Structure Generator**

這會讓我們有很大的差異。

# 但還有一個非常危險的地方

AI 太會出題了。

給它一頁教材，它可以給你：

> 35 張卡。

技術上很厲害。

產品上卻可能完全錯。

因為：

> **每多產生一個 Learning Target，就不是只多一張卡而已。**

它會變成：

> 今天複習一次  
> 明天再一次  
> 三天後一次  
> 七天後一次……

所以每個 Target 都會產生未來成本。

我很想替這個概念取一個名字：

# **Review Debt — 複習債務**

每新增一張需要 SRS 的學習目標：

> 都是在替未來的學生增加複習負擔。

所以 Essence AI 的目標不能是：

> Generate as many useful cards as possible.

而應該是：

> **用最低 Review Debt，取得最大的知識覆蓋與學習效果。**

我認為這甚至值得加入 Product Constitution。

這非常符合你最初做這個軟體的原因：

> **節省時間。**

# 所以 AI 拆解應遵守幾個規則

我目前會定這五條：

1. **如果兩件事情可能一個會、一個不會，就有拆開的理由。**
2. **如果只是同一知識換句話問，不建立新的 Learning Target，只建立新的 Prompt。**
3. **如果「順序、因果、比較、整體機制」本身是一個需要學會的能力，可以建立跨 Knowledge Items 的 Target。**
4. **不是每個知識都必須產生 Recall + Explain + Compare + Apply。只產生真正有學習價值的。**
5. **AI 應該優先最佳化「Learning coverage / Review cost」，而不是卡片數量。**

這五條我認為會比「每段文字切成幾張卡」重要得多。

# 四、現在來解你提出的英文單字問題

這其實是最重要的反例。

假設今天學生只是：

> 第六課有 30 個英文單字，我明天要考，我想趕快背。

我們絕對不能讓他看到：

> Knowledge Item  
> Learning Target  
> Learning Strategy  
> Prompt type  
> Cognitive level……

那會是災難。

他應該只看到：

~~~
Lesson 6
30 words

開始複習
~~~

例如：

~~~
apple
↓
蘋果
~~~

完。

# 但底層其實還是同一套架構

例如：

### Knowledge Item

~~~
apple = 蘋果
~~~

### Learning Target

~~~
看到 apple 能回想中文意思
~~~

### Prompt

正面：

> apple

背面：

> 蘋果

所以最簡單的情況就是：

> **1 Knowledge → 1 Target → 1 Prompt**

而且這整件事情系統自動完成。

使用者根本不知道三層架構存在。

這就是我想要的。

# 如果學生後來想加強？

例如開啟：

> 中翻英

那就新增另一個 Learning Target：

~~~
看到「蘋果」
↓
能回想 apple
~~~

注意：

這**不是同一 Target 的另一種 Prompt**。

因為：

> 英→中會  
> 不代表中→英會。

它們應該有獨立學習狀態。

這正好證明三層架構是有價值的。

# 再比如拼字

如果需求是：

> 看到「必要的」，要拼出 necessary。

那又是一個 Target：

~~~
recognize meaning
≠
recall English word
≠
spell English word
~~~

但是！

### 使用者不應該看到這種複雜度。

介面可能只是：

> ☑ 英→中  
> ☐ 中→英  
> ☐ 拼字

系統幫他建立底層 Target。

# 五、所以我現在會提出一個非常核心的產品架構

不是「Simple Mode」和「Advanced Mode」兩套系統。

而是：

# **Progressive Structure**

也就是：

> 資料簡單，架構就退化成最簡單形式。
>
> 資料複雜，架構才逐漸展開。

英文單字：

~~~
Knowledge
 ↓
Target
 ↓
Card
~~~

幾乎 1:1:1。

生物事實：

~~~
Knowledge
 ↓
Target
 ↓
多個 Prompt variants
~~~

複雜概念：

~~~
Knowledge  Knowledge  Knowledge
     \        │       /
      Learning Target
             ↓
        Prompt variants
~~~

整章教材：

~~~
Source
↓
大量 Knowledge Items
↓
AI 建立 Learning Targets
↓
優先級 / 去重 / 關係
↓
Cards
~~~

全部是同一個系統。

我現在對這套架構的信心比上一輪高很多。

# 六、而且我會讓「來源 Source」變成核心三層之外的東西

這裡也值得講清楚。

例如：

> 生物課本第三章

它不是 Knowledge Item。

它比較像：

> **Source / Provenance**

也就是：

~~~
Source
生物第三章

↓ extracted from

Knowledge Items
~~~

英文單字的 Source 可以是：

> Lesson 6 Vocabulary

一篇 Obsidian note 也是 Source。

PDF 一頁也是 Source。

未來 AI 產生 Learning Target 時，最好保留：

> 這個 Target 是從哪一段 Source 產生的。

這對 AI 查核會非常重要。

# 七、我現在會把整體模型暫時畫成這樣

~~~
                 Source
          （note / lesson / PDF）
                    │
                    ▼
             Knowledge Item
          「需要知道的內容」
                    │
            ┌───────┴────────┐
            ▼                ▼
     Learning Target    Learning Target
    「需要學會什麼」    「另一項能力」
            │
        ┌───┴────┐
        ▼        ▼
      Prompt    Prompt
      Card A    Card B
~~~

但允許：

~~~
Knowledge A ─┐
Knowledge B ─┼─→ Learning Target
Knowledge C ─┘
~~~

所以概念上三層。

資料結構上則是：

> **小型 graph，而不是死板 tree。**

這一點我現在認為應該保留。

# 八、這也決定 AI 最適合放在哪裡

現在可以很清楚地看到：

~~~
          AI 最有價值的位置
                  ↓
Source → Knowledge → Learning Target → Prompt
          ↑              ↑               ↑
        抽取           結構化           生成
~~~

而：

~~~
Prompt
↓
Review
↓
Evaluation
↓
Scheduler
~~~

完全可以沒有 AI。

這其實正好符合我們之前所定：

> AI 可插拔。

而且現在「為什麼可插拔」開始有很清楚的架構理由了。

# 九、我現在反而會新增一條 Product Constitution

前面的：

> Learning per Minute

現在我想增加：

> **Minimize Review Debt**

中文意思：

> **不要讓使用者為了「看起來學得很完整」，背負大量沒有必要的未來複習成本。**

AI 每多建立一個 Target，都應該問：

> 這個真的值得讓學生未來複習十次嗎？

我認為這條非常有 Essence Cards 的產品特色。

因為市面上 AI flashcard 很容易變成：

> **一卡變一卡，一頁變 50 卡。**

我們反而可以走：

> **智能濃縮。**

這很可能是產品真正有競爭力的方向。

## 至於你最後問模型強度

這種架構問題用 **GPT-5.6 Sol 的 High reasoning** 就很合適，不是單純把推理拉到越高就一定越好。

現在最需要的是：

> 不斷拿真實案例撞架構 → 找反例 → 收斂。

而不是純粹增加思考時間。

如果之後進入：

- 正式 schema
- Learning Target graph
- 資料遷移
- Scheduler interface contract
- AI decomposition algorithm
- 大量 edge cases

那時候再用你介面上**最高可用的推理檔位**做一次整體 architecture review，我認為很值得。

但現在不用停下來換模型，我們目前這個層級已經足夠把核心架構推得很深。

而我認為這一輪最重要的新成果其實有兩個：

> **Learning Target ≠ 原子化到最小，而是最小「可獨立檢核」單位。**

以及：

> **每個 Learning Target 都會產生 Review Debt，因此 AI 的工作不是產最多卡，而是以最低複習成本覆蓋最重要的學習目標。**

這兩個概念，我認為都值得正式進入 Essence Cards 的核心設計。

---

## 使用者

以上所說的我都同意，以下是我想到的補充
1.動作電位中你的例子，當要學生說出Sequence Target，就很適合用圖文來呈現
2.那我們同步一下說法
Knowledge Item = 最小的「有意義知識單位」。
Learning Target = 最小的「可獨立判斷學生會不會的學習目標」。
3.沒有AI的話essence cards只是一個單純的SRS 複習軟體，接上AIEssence Cards 才會開始變成一個真正聰明的「知識→複習」轉換系統。整個學習系統要能充分發揮效果，其實就是外接上的AI是否能夠完全按照我們的意思去合理標示Knowledge Items 與Learning Targets，也就是這整個軟體最終能夠多優秀，還是模型的選擇是否夠強是嗎
4.我同意Review Debt的概念
5.我同意Progressive Structure，但是名稱上simple & advance mode比較淺白不是嗎？
還有幾個新的想法
1.台灣的教育是螺旋式的教育，例如台灣歷史在國小學的可能比較初淺，到國中再學一次會逐漸加深
我可以取得所有年級的教材PDF檔，在輸入端靠著AI全部在obsidian轉成一個完整的資料庫，因此AI就會得到一個有各年級不同的版本的台灣史資料庫。另外AI也可以自己補充。而且每個使用者輸入的資料庫可能會有一些不同。有關於輸入的部分額外要討論的是，現在AI的能力是否還需要使用者手動輸入所有的PDF給資料庫，還是AI已經具備該知識點全局的完整知識能力。
2.接下來的關鍵就是learn target，可以在這個完整的知識庫中，AI可以依照學生的年紀（國小還是國中），程度（對課程內容熟不熟練），來給出複習的資料（可以是閃卡或者是心智圖），最後再依照檢核的程度來微調複習資料，循序漸進慢慢加深。
3.最後想到obsidian這種雙鏈markdown筆記的架構，甚至可以完全外接給AI去維護原始知識庫中所有的知識單位。所以這個知識庫甚至會是一個可以能夠好好閱讀有系統架構的雙鏈筆記知識系統。
4.以上說了很多，輸入品質也很重要，2模型應該無痛對接，essence capture必須做出能夠讓essence cards能夠高效使用的資料
5.obsidian的最小顆粒是一本筆記，是要把她設計成一個knowledge item就是一篇筆記嗎？
以上是我的想法，請用最強大腦來思考並給我最高品質的建議

---

## 助理

你這次其實把專案從「智慧閃卡」再往前推了一層：**Essence Capture 負責建立可被 AI 理解與維護的知識層；Essence Cards 負責依學習者狀態，把其中一部分轉成最適合當下的 Learning Targets 與複習形式。**

我會特別檢查三件事：**AI 到底是不是產品能力上限、螺旋式教材如何表示，以及 Obsidian 的「一篇筆記」到底應不應等於一個 Knowledge Item。**這三件如果切錯，之後很容易整個資料模型重來。

我先給你一個核心判斷：**如果把「模型夠不夠強」當成 Essence Cards 的唯一上限，這個架構會太脆弱。**強模型很重要，但真正決定品質上限的是「模型能力 × 知識庫品質 × Learning Target 規則 × 檢索 × 評估機制 × 可回復的人工修正」。模型只是其中最大的一個乘數，不應該是唯一支柱。

我認為你現在提出的方向，已經讓 Essence Cards 的終極形態逐漸浮出來了，而且其中有一個地方我會稍微修正你的推論：

> **Essence Cards 的上限確實高度取決於 AI，但不能讓「某一個 AI 模型的聰明程度」成為產品的上限。**

我們真正要打造的是一套讓**愈強的模型進來就愈強，但模型偶爾犯錯、換模型、甚至暫時沒有 AI，都不會摧毀系統**的架構。

先同步你剛才確立的術語，我完全同意：

> **Knowledge Item = 最小的「有意義知識單位」。**  
> **Learning Target = 最小的「可獨立判斷學生會不會的學習目標」。**

而我會再加一句：

> **Prompt = 為了檢核某個 Learning Target，而呈現給學生的一次具體刺激。**

Prompt 可以是純文字卡、圖文卡、排序、圖片標示、心智圖等等。

# 一、動作電位的 Sequence Target，你的判斷是對的

這其實再次證明：

**Learning Target 跟呈現形式一定要分開。**

例如：

### Learning Target

> 能理解並依正確順序重建動作電位的主要事件。

它不需要限定一定是：

> 問題 → 文字答案。

最適合的 Prompt 可能是：

> 動作電位曲線圖  
> ＋ Na⁺/K⁺ 通道圖示  
> ＋ 幾個事件卡片  
> → 排出正確位置。

甚至日後可以有：

> 看圖排列 → 看圖填空 → 空白圖自己重建

三種 Prompt。

但底下追蹤的仍然是同一個 Learning Target。

所以我們現在可以把之前的：

> Card-first, not Card-locked

再精確一些：

> **Prompt-based, Renderer-flexible。**

Card 是目前主要 Renderer，但不是資料模型本身。

# 二、AI 是不是決定 Essence Cards 最後能有多優秀？

### 一半是，而且是很重要的一半。

假設我們有：

~~~
教材
↓
AI
↓
Knowledge Items
↓
Learning Targets
↓
Prompts
~~~

那 AI 如果連第一步都拆錯：

> 錯誤 Knowledge Item  
> → 錯誤 Learning Target  
> → 再漂亮的 SRS 都沒用。

所以對「AI Knowledge-to-Review」這條路來說，**AI 的推理品質確實非常關鍵。**

但我不會把品質寫成：

> Product quality = Model intelligence

我會寫成：

> **Learning quality ≈**
> **Source quality × Knowledge structure × Model ability × Target rules × Retrieval quality × Evaluation**

任何一項接近 0，都會拖垮整體。

## 為什麼不能只靠更強的模型？

因為即使很強的模型，也可能對下面這件事情有不同判斷：

一段教材到底應該拆成：

> 5 個 Learning Targets？

還是：

> 8 個？

「完整理解」是否值得一個 Target？

「事件排序」是否需要獨立 Target？

「應用」應該什麼程度才出？

這些很多其實不是知識問題，而是：

> **Essence Cards 的教學設計哲學。**

所以我們必須把它明文化成一套：

# Learning Target Contract

也就是 AI 必須遵守的規則。

像我們已經發現的：

- 一個學生可能會 A 但不會 B，才有拆 Target 的理由。
- 同一能力只是換問法，不增加 Target。
- 跨 Knowledge Items 的整合能力可以成為 Target。
- 不為了完整而產生沒有必要的 Review Debt。
- 題目難度必須符合學生目前程度。

這些規則會比：

> 「請幫我生成閃卡。」

強很多。

# 三、我甚至認為未來要建立 Essence Cards 自己的 AI 評測集

這件事情很重要。

不要問：

> GPT、Gemini、Claude 哪個最強？

而要問：

> **誰最會做 Essence Cards 的工作？**

例如我們自己建立 100 個真實案例：

- 英文單字
- 動作電位
- 台灣史
- 數學公式
- 地理
- 國小自然
- 高中生物
- 跨章概念

人工先建立理想的：

> Knowledge Items  
> Learning Targets  
> Review Debt

然後不同模型跑一次。

比較：

> Knowledge coverage  
> Target granularity  
> unnecessary targets  
> duplicate targets  
> hallucination  
> difficulty appropriateness

這樣未來模型一直換，我們只要跑 benchmark。

這才真正符合你之前要求的：

> **AI 隨插即用。**

不是「API 能插進去」就叫隨插即用。

而是：

> **換模型後，我們知道它做 Essence Cards 工作到底有多好。**

這我認為非常重要。

# 四、你的「螺旋式學習」想法，讓我認為 Knowledge 層還需要一個 Concept

你舉台灣史非常好。

假設：

### 國小

> 鄭成功來臺，驅逐荷蘭人並建立統治。

### 國中

可能增加：

> 明鄭政權的建立背景、行政制度、屯田與清朝攻臺。

### 高中

甚至：

> 東亞海權、鄭氏政權的性質、國際貿易網絡、史觀差異。

這些不能變成：

~~~
國小鄭成功
國中鄭成功
高中鄭成功
~~~

三個完全無關的資料庫。

它們其實共享一個：

# Concept

例如：

> **明鄭時期**

下面才掛很多 Knowledge Items。

所以我目前會讓知識系統變成：

~~~
                 Concept
                明鄭時期
                   │
       ┌───────────┼────────────┐
       ▼           ▼            ▼
      KI           KI           KI
   基本事件      統治制度     國際背景
       │
       │ curriculum alignment
       ▼
 國小 / 國中 / 高中適用程度
~~~

Concept **不是** Knowledge Item。

它只是知識網路中的穩定節點。

# 五、這正好能實現你說的「學生愈學愈深」

假設學生目前：

> 國小六年級  
> 台灣史不熟。

Essence Cards 看到：

~~~
Concept：明鄭時期

已有 Knowledge：
K1
K2
K3
K4
K5
K6
...
~~~

系統不需要全部拿出來。

它先選：

> LT1  
> 鄭成功與荷蘭人的基本關係

> LT2  
> 明鄭政權建立的基本時間順序

學生慢慢熟練。

之後可以增加：

> 統治制度

再之後：

> 為什麼要屯田？

再進一步：

> 明鄭政權放在十七世紀東亞海權競爭中如何理解？

所以：

# Learning Target 不是固定死的卡片資料庫。

這個想法我認為非常重要。

Knowledge Database 可以很完整。

但 **Learning Targets 是知識庫與「目前這個學生」之間的橋樑。**

因此真正的架構開始變成：

~~~
Knowledge Graph
        +
Learner Model
        ↓
Target Selection
        ↓
Learning Targets
        ↓
Prompts
        ↓
Review
        ↓
Evaluation
        ↓
更新 Learner Model
~~~

這其實已經比一般的 AI Flashcard 系統高了一層。

# 六、這裡會出現另一個未來非常重要的元件：Learner Model

先記住，不用現在展開。

它至少會知道：

> 學生目前在哪個教育階段

> 正在學什麼範圍

> 哪些 Learning Targets 已熟練

> 哪些不熟

> 哪些相關 prerequisite 已經掌握

然後 AI 才能判斷：

> **下一步應該教／複習多深。**

因此未來不是：

> Knowledge → Cards

而是：

~~~
            Knowledge Graph
                   │
                   ▼
Learner Model → Target Selector
                   │
                   ▼
            Learning Targets
~~~

這個 Target Selector 很可能是 Essence Cards 未來非常核心的「智慧」。

# 七、AI 現在已經夠聰明，教材 PDF 還需要輸入嗎？

這裡我會非常明確：

## **要。**

至少對你這個產品，我強烈建議：

> **教材／課綱／教師認可來源仍然是 canonical source。**

不要讓模型自己的內建知識取代它。

而對你的情境更重要的是：

> **「知道台灣史」**
>
> 跟
>
> **「知道這個版本、這個年級、這個出版社、這學期要求學生學到什麼程度」**

完全是兩件事情。

# 八、但不代表 AI 自己的知識沒有用

反而非常有用。

我會把 Knowledge Source 分成不同信任層級。

例如：

| Source | 意義 |
|---|---|
| **Canonical** | 教材、課綱、老師指定資料 |
| **User-authored** | 使用者自己整理的筆記 |
| **Verified External** | AI 搜尋到並查證的可信來源 |
| **AI Enrichment** | 模型本身補充的知識 |

這樣 AI 發現：

> 課本沒有提到一段有助理解的背景資料。

可以新增：

> Candidate Knowledge Item

但標記：

> source = ai_enrichment

而不是偷偷混進：

> 「課本就是這樣寫。」

這一點我認為對教育產品非常重要。

# 九、所以 Essence Capture 的真正使命開始非常清楚

以前我們可能把 Capture 想成：

> PDF → Markdown。

現在我會提高它的定位：

# Essence Capture = Knowledge Compiler

它把：

~~~
PDF
網頁
老師筆記
自己筆記
AI補充
其他教材
~~~

編譯成：

~~~
Concept
↓
Knowledge Items
↓
Relations
↓
Source / Provenance
↓
Curriculum / Level metadata
↓
Readable Obsidian notes
~~~

然後交給 Essence Cards。

所以 Capture 做得好不好，會直接決定 Cards 能聰明到什麼程度。

這也符合你現在的想法。

# 十、兩個模組如何做到真正「無痛對接」

我猜你的「2模型」應該是指 **Essence Capture 與 Essence Cards 兩個模組**。

我會非常堅持：

> **不要讓 Cards 直接依賴 Capture 的程式內部。**

兩邊只透過一份共同 Contract 溝通。

例如暫時概念上：

~~~
Knowledge Contract v1
~~~

每個 Knowledge Item 至少能提供：

~~~
stable_id
content
concept_refs
source
provenance
relations
curriculum_scope
version
media_refs
verification_state
~~~

Capture 的工作：

> 產生、維護這個 contract。

Cards：

> 只需要懂這個 contract。

這樣未來：

> Capture 用 Gemini

而：

> Cards 用 GPT

完全沒有問題。

甚至：

> Capture v2 整個重新寫

Cards 都不用改。

這才是真正的模組化。

# 十一、Obsidian 一篇筆記 = 一個 Knowledge Item 嗎？

我的答案非常明確：

## **不要。**

我甚至認為：

> 一篇 Obsidian Note = 一個 Knowledge Item

會是目前最容易把整個架構做壞的一個決定。

原因是我們拿「動作電位」來看。

一篇很好閱讀的 Obsidian 筆記可能是：

# 動作電位

## 靜止膜電位

……

## 達閾值

……

## 去極化

> 電壓閘控 Na⁺ 通道打開  
> Na⁺ 流入  
> 膜電位上升

## 再極化

> Na⁺ 通道失活  
> K⁺ 通道開啟  
> K⁺ 外流

## 過極化

……

## Na⁺/K⁺ 幫浦

……

對人類而言：

> **這是一篇非常合理的筆記。**

但裡面可能有：

> 10～20 個 Knowledge Items。

# 所以我會採一個非常重要的分層

## Note = 人類閱讀單位

## Knowledge Item = AI / 系統理解單位

例如：

~~~
📄 動作電位.md
│
├── KI-001 達到閾值後 Na⁺ 通道開啟
│
├── KI-002 Na⁺ 流入導致去極化
│
├── KI-003 Na⁺ 通道失活
│
├── KI-004 K⁺ 通道開啟
│
├── KI-005 K⁺ 外流造成再極化
└── KI-006 K⁺ 通道關閉慢造成過極化
~~~

這樣最好。

# 十二、但是也不要一個 Knowledge Item 一個 Markdown 檔

另一個極端一樣不好。

如果台灣史有：

> 30,000 Knowledge Items

就變成：

> 30,000 個 .md

人類根本不能閱讀。

所以：

> **Note ≠ KI**

而是：

> **一篇 Concept Note 裡包含多個可被精確定位的 Knowledge Items。**

# 十三、這非常適合 Obsidian

Obsidian 本身就可以：

- heading link
- block reference
- backlink
- embed

所以 Knowledge Item 可以是筆記裡的一個可定位 block。

概念上：

~~~
# 動作電位

## 去極化

達到閾值後，電壓閘控 Na⁺ 通道開啟。 ^ki-ap-001

Na⁺ 順電化學梯度流入細胞，使膜電位快速上升。 ^ki-ap-002
~~~

人類看：

> 就是正常筆記。

Essence Capture 看：

~~~
ki-ap-001
ki-ap-002
~~~

Essence Cards 可以精準引用：

> ki-ap-002

這非常漂亮。

# 十四、但我會比單純 Obsidian block ID 再多做一層

因為：

> 使用者改了文字、移動段落、改標題

Knowledge ID 不應該跟著失效。

所以真正的：

> knowledge_id

應該由 Essence 自己產生穩定 ID。

Obsidian block reference 只是其中一個定位方式。

也就是：

~~~
stable knowledge_id
      ↓
Markdown location
      ↓
current content
~~~

而不是：

~~~
檔名 + heading = identity
~~~

這對未來 AI 自動維護知識庫非常重要。

# 十五、AI 可以幫忙維護整個 Obsidian 知識庫嗎？

## 可以，而且我認為這可能會成為 Essence Capture 最有魅力的地方之一。

例如 AI 可以發現：

> 國小教材已經有「霧社事件」基本介紹。

之後匯入國中教材。

AI 判斷：

> 不是建立另一篇重複的「霧社事件」。

而是：

~~~
霧社事件.md

## 基本事件
國小程度

## 背景
國中新增

## 原因
國中新增

## 日本殖民政策
高中進一步

## 不同史觀
進階
~~~

並建立雙鏈：

~~~
[[日本統治時期]]
[[原住民族政策]]
[[理蕃政策]]
[[莫那魯道]]
~~~

這個資料庫就不是：

> 給 AI 使用的機器資料。

而是：

> **人也願意閱讀的高品質知識庫。**

我非常認同你這個方向。

# 十六、但有一條安全線我會堅持

AI 不應該無聲無息地隨意改 canonical knowledge。

我會要求：

~~~
AI proposal
↓
diff
↓
apply
↓
version history
~~~

尤其你本來就想用 Git。

這正好非常適合。

所以：

> AI 可以高度自治地整理。

但是：

> 所有改變都可追蹤、可逆、知道來源。

這能避免某次換模型之後：

> AI 覺得自己更聰明，把整個知識庫「整理壞了」。

# 十七、Simple / Advanced Mode

這裡我要部分同意你。

### UI 命名：

我同意：

> **Simple Mode / Advanced Mode**

比：

> Progressive Structure

淺白很多。

但我不建議把 Progressive Structure 這個概念丟掉。

因為兩者其實回答不同問題。

### Progressive Structure

是：

> **內部架構原則。**

### Simple / Advanced

是：

> **使用者看到的入口。**

例如：

## Simple Mode

我只想背英文：

~~~
apple → 蘋果
book → 書
~~~

按下開始。

系統背後自動產生：

~~~
1 Knowledge
↓
1 Target
↓
1 Prompt
~~~

完全不讓使用者看到。

## Advanced Mode

我丟：

> 一章生物教材。

系統：

~~~
分析 Knowledge
↓
建立 Learning Targets
↓
判斷 prerequisite
↓
控制 Review Debt
↓
生成合適 Prompt
~~~

最重要的是：

> **Simple 的資料未來可以無痛升級成 Advanced。**

不能變成兩套資料庫。

例如：

今天：

> apple → 蘋果

明天使用者開 Advanced：

系統再加：

> 中→英  
> 拼字  
> 例句  
> 常見搭配

原本的複習進度全部保留。

這才是真正漂亮。

# 十八、我現在會把 Essence 整個系統重新描述成這張圖

~~~
                 ESSENCE CAPTURE
────────────────────────────────────────

Sources
PDF / Web / Notes / AI
          │
          ▼
      Concepts
          │
          ▼
   Knowledge Items
          │
     ┌────┴─────┐
     ▼          ▼
 Relations    Provenance
     │
     ▼
Readable Obsidian Knowledge Graph


                 │
                 │ Knowledge Contract
                 ▼


                 ESSENCE CARDS
────────────────────────────────────────

        Knowledge Graph
               +
         Learner Model
               │
               ▼
        Target Selector
               │
               ▼
       Learning Targets
               │
               ▼
          Prompt Engine
               │
        ┌──────┼──────┐
        ▼      ▼      ▼
       Card   Image   Mind Map
        │
        ▼
      Review
        │
        ▼
    Evaluation
        │
        ▼
     Scheduler
        │
        └──────────────→ 更新 Learner Model
~~~

我認為我們現在其實已經從「做一個 Obsidian 閃卡外掛」，走到了更有價值、也更一致的方向：

> **Essence Capture 建立一個 AI 可理解、人也可閱讀的個人知識圖譜。**

> **Essence Cards 根據學生目前狀態，從知識圖譜動態選出現在最值得學的 Learning Targets，以最低 Review Debt 轉成高效率複習。**

閃卡仍然會是第一版最重要的 UI。

但它已經不是產品的定義了。

而我目前最強烈建議我們接下來先不要繼續增加新功能，而是正式把 **Concept → Knowledge Item → Learning Target → Prompt** 這四個東西的邊界釘死，尤其要確認 **Concept 是否真的需要成為正式資料實體、Knowledge Item 在 Markdown 中如何定位，以及 Learning Target 是預先生成還是可以依學生動態生成**。

這三個決策會直接決定 Essence Capture 和 Essence Cards 的共同資料契約，我認為這已經到了值得正式定規格的階段。

---

## 使用者

1.新增加benchmark這個評分系統的點子不錯，請記得記錄下來
2.你的螺旋式學習補充中"Learning Targets 是知識庫與「目前這個學生」之間的橋樑。"這段我很同意
3.說了這麼多的essence的理念，回到重點是，如何能夠讓AI精準的判別learning target並且穩定的輸出複習資料。Learner Model → Target Selector這一段是要資深教師來提供嗎？如果不是資深教師要如何無中生有？
4.Essence Capture = Knowledge Compiler這部分，我道覺得essence capture因為會有獨立使用的時機(而且機會可能比往下走到essence cards更高)，所以只做到把pdf -> 可閱讀的原始markdown（甚至是原始逐字稿也行）放在知識庫中，但可以把和essence cards間共同 Contract的部分做好(例如yaml你覺得可行嗎)。後續轉成knowledge item並維護的工作留給essence cards中的AI，你覺得如何
5.knowledge item在筆記中所使用的block id很重要，但有時候我可能會閱讀原始obsidian筆記，這時隱藏這些干擾亂碼
其他的都同意
6.你結論中的三決策，要怎麼決定

---

> 註：依使用者要求，本檔到此為止；不收錄上述最後一則使用者訊息之後的助理回答。
