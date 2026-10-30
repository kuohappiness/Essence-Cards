import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../src/core/deck/index.ts';
import { encodeEntry, mergeHistory, planToday } from '../src/core/study/index.ts';
import type { Progress } from '../src/core/study/index.ts';
import { allowedFor, blankCount, closest, copying, crumb, doneView, englishBreak, englishParts, extraLabel, fillBlank, gesture, glueArticles, keyboardFit, lineSpeech, lockAxis, otherAnswers, sourceLinks, spelling, tailStart, todayStats } from '../src/review/index.ts';

// W6 §5 的純函式：R6 畫線、R7 比對、R8 英文的部分、R9 手勢、R11 路徑、R12 出處，以及完成畫面的文字（§2-6）。

const PHRASE = '他已經下定決心要出國讀書。He has already ＿＿ to study abroad.';
const TWO = ['made up his mind', 'made his mind up'];

void test('R6 畫線：第一個答案的字數；題目沒有 ＿＿ 時 0 條；＿＿＿ 也認得', () => {
  assert.equal(blankCount(PHRASE, TWO), 4);
  assert.equal(blankCount('Can I ＿＿ your pen?（借）', ['borrow']), 1);
  assert.equal(blankCount(PHRASE, ['decided', 'made up his mind']), 1);
  assert.equal(blankCount('借入', ['borrow']), 0);
  assert.equal(blankCount('This box is ＿＿＿.', ['light']), 1);
  assert.equal(blankCount(PHRASE, null), 0);
});

void test('R7 比對：最接近的答案（一樣近取前面的）；試作外掛 spelling 的例子照舊', () => {
  assert.equal(closest('made his mind upp', TWO), 'made his mind up');
  assert.equal(closest('made up his mnd', TWO), 'made up his mind');
  assert.equal(closest('', ['a', 'b']), 'a');
  assert.equal(spelling('  BoRRow ', 'borrow').ok, true);
  const missing = spelling('borow', 'borrow');
  assert.equal(missing.ok, false);
  assert.equal(missing.expected.filter(c => c.bad).length, 1);
  assert.equal(missing.expected.map(c => c.char).join(''), 'borrow');
  assert.equal(spelling('borroww', 'borrow').typed.filter(c => c.bad).length, 1);
  assert.equal(spelling('', 'measure').expected.filter(c => c.bad).length, 7);
  assert.equal(spelling('barrOw', 'borrow').typed.filter(c => c.bad).length, 1);
  // 第 3 步的例子：mand 的 a 標出，正確拼字的 i 標出。
  const mand = spelling('made up his mand', 'made up his mind');
  assert.deepEqual(mand.typed.filter(c => c.bad).map(c => c.char), ['a']);
  assert.deepEqual(mand.expected.filter(c => c.bad).map(c => c.char), ['i']);
});

void test('R7 第 3 步照打的即時比對：照位置比，還沒打的不算錯，漏打時從那裡起標出', () => {
  assert.deepEqual(copying('', 'borrow').typed, []);
  assert.equal(copying('', 'borrow').expected.some(c => c.bad), false);
  assert.equal(copying('  BoR', 'borrow').typed.some(c => c.bad), false);
  assert.equal(copying('BORROW ', 'borrow').ok, true);
  assert.deepEqual(copying('bor', 'borrow').typed.map(c => c.char).join(''), 'bor');
  const mnd = copying('made up his mnd', 'made up his mind');
  assert.equal(mnd.ok, false);
  assert.deepEqual(mnd.typed.filter(c => c.bad).map(c => c.char), ['n', 'd']);
  assert.deepEqual(mnd.expected.filter(c => c.bad).map(c => c.char), ['i', 'n']);
  assert.deepEqual(copying('borroww', 'borrow').typed.filter(c => c.bad).map(c => c.char), ['w']);
});

// D-158：最接近的答案、標錯字母、照打與「也可以」都用核心的同一條比對規則；標出的字照學生打的字。
void test('R7 D-158 比對：彎的單引號、空白字元與連續的空白不算錯，也不標出', () => {
  assert.equal(closest("o'clock", ["o'clocks", 'o’clock']), 'o’clock', '’ 和 \' 一樣，最接近的是 o’clock');
  assert.equal(spelling('O’Clock', "o'clock").ok, true);
  assert.equal(spelling('look  After ', 'look after').ok, true);
  const clok = spelling("o'clok", 'o’clock');
  assert.deepEqual([clok.typed.filter(c => c.bad), clok.expected.filter(c => c.bad).map(c => c.char)], [[], ['c']], '撇號不標，只標漏打的 c');
  const aftr = spelling('look  aftr', 'look after');
  assert.deepEqual([aftr.typed.filter(c => c.bad), aftr.expected.filter(c => c.bad).map(c => c.char)], [[], ['e']], '多按的空白不標');
  assert.equal(aftr.typed.map(c => c.char).join(''), 'look  aftr', '「你拼的」照學生打的字');
  // 照打還沒打完：只去開頭的空白，尾端的詞間空白留著，照位置比。
  const prefix = copying('made up ', 'made up his mind');
  assert.deepEqual([prefix.ok, prefix.typed.map(c => c.char).join(''), prefix.typed.some(c => c.bad), prefix.expected.some(c => c.bad)], [false, 'made up ', false, false]);
  assert.equal(copying('made  u', 'made up').typed.some(c => c.bad), false, '多按的空白之後照樣對齊');
  assert.equal(copying('o’c', "o'clock").typed.some(c => c.bad), false);
  assert.equal(copying('made  up  ', 'made up').ok, true);
  assert.deepEqual(otherAnswers(["o'clock", 'o’clock'], "o'clock"), [], '「也可以」不列看起來一樣的答案');
  assert.deepEqual(otherAnswers(['look after', 'take care of'], 'look after'), ['take care of']);
  // 負例照舊算錯。
  assert.equal(spelling('dont', "don't").ok, false);
  assert.equal(spelling('apart', 'a part').ok, false);
  assert.equal(spelling('oʼclock', "o'clock").ok, false);
  assert.equal(copying('dont', "don't").typed.some(c => c.bad), true);
});

void test('R8 英文的部分：例句只念英文；＿＿ 填入答案；單字；全是中文沒有；只有詞性縮寫不念', () => {
  assert.deepEqual(englishParts('例句：Can I borrow your pen? 我可以借你的筆嗎？'), ['Can I borrow your pen?']);
  assert.equal(fillBlank(PHRASE, 'made up his mind'), 'He has already made up his mind to study abroad.');
  assert.deepEqual(englishParts('borrow'), ['borrow']);
  assert.deepEqual(englishParts('**borrow**'), ['borrow']);
  assert.deepEqual(englishParts('我可以借你的筆嗎？'), []);
  // 判斷規則：一段裡至少要有一個兩個字母以上、不是詞性縮寫（v.、n.、adj.…）的字。
  assert.deepEqual(englishParts('v. 借入、向別人借'), []);
  assert.deepEqual(englishParts('n. 制服'), []);
  assert.deepEqual(englishParts('adj. 輕的 light'), ['light']);
  assert.deepEqual(englishParts('例句：We wear uniforms to school. 我們穿制服上學。'), ['We wear uniforms to school.']);
  assert.equal(fillBlank('借入', 'borrow'), null);
  assert.deepEqual(englishParts(PHRASE), ['He has already ＿＿ to study abroad.']);
});

void test('D-145 一行一個喇叭：依序念這一行的英文，重複的只念一次；「也可以」列結果那一行沒寫的答案', () => {
  assert.deepEqual(lineSpeech('記憶錨點：go 的過去式不規則：go → went → gone'), ['go', 'went', 'gone']);
  assert.deepEqual(lineSpeech('v. 借入、向別人借'), []);
  assert.deepEqual(lineSpeech('例句：Can I borrow your pen? 我可以借你的筆嗎？'), ['Can I borrow your pen?']);
  assert.deepEqual(lineSpeech('記憶錨點：易混淆 lend（借出：把東西借給別人）'), ['lend']);
  assert.deepEqual(lineSpeech('Go 和 go 不分大小寫：GO'), ['Go']);
  assert.deepEqual(otherAnswers(TWO, 'made up his mind'), ['made his mind up']);
  assert.deepEqual(otherAnswers(TWO, ' MADE HIS MIND UP '), ['made up his mind'], '大小寫與前後空白不算');
  assert.deepEqual(otherAnswers(['turn off', 'switch off', 'shut off'], 'switch off'), ['turn off', 'shut off'], '照答案格的順序');
  assert.deepEqual(otherAnswers(['borrow'], 'borrow'), []);
  assert.deepEqual(otherAnswers(TWO, 'made up his mnd'), TWO, '結果那一行不是任何一個答案（不會發生）時全列');
});

void test('D-145 背面補充的名稱自己一行：一到六個字、不含空白，緊接全形冒號；其他照原文', () => {
  assert.deepEqual(extraLabel('記憶錨點：go 的過去式不規則：go → went → gone'), { label: '記憶錨點', body: 'go 的過去式不規則：go → went → gone' });
  assert.deepEqual(extraLabel('例句：Can I borrow your pen? 我可以借你的筆嗎？'), { label: '例句', body: 'Can I borrow your pen? 我可以借你的筆嗎？' });
  assert.deepEqual(extraLabel('詳解：made up his mind 和 made his mind up 都對'), { label: '詳解', body: 'made up his mind 和 made his mind up 都對' });
  assert.deepEqual(extraLabel('記憶錨點：易混淆 lend（借出：把東西借給別人）'), { label: '記憶錨點', body: '易混淆 lend（借出：把東西借給別人）' });
  assert.deepEqual(extraLabel('go 的過去式不規則：go → went'), { label: null, body: 'go 的過去式不規則：go → went' }, '名稱裡有空白：不是名稱');
  assert.deepEqual(extraLabel('![[W6 擴散示意圖.svg]]'), { label: null, body: '![[W6 擴散示意圖.svg]]' });
  assert.deepEqual(extraLabel('**記憶錨點**：粗體'), { label: null, body: '**記憶錨點**：粗體' }, '有 Markdown 記號：照原文');
  assert.deepEqual(extraLabel('記憶錨點：'), { label: null, body: '記憶錨點：' }, '冒號後面沒有內容：照原文');
});

void test('D-145 冠詞和後面的字連在一起換行：a、an、the 後面的空白換成不斷行空白', () => {
  assert.equal(glueArticles('Please switch off the lights when you leave.'), 'Please switch off the lights when you leave.');
  assert.equal(glueArticles('I have a pen and an apple.'), 'I have a pen and an apple.');
  assert.equal(glueArticles('The box is very light.'), 'The box is very light.', '大寫也算');
  assert.equal(glueArticles('data base, area code'), 'data base, area code', '字中間的 a 不算');
  assert.equal(glueArticles('I went to the '), 'I went to the ', '後面沒有字（接著是空格）不改');
});

void test('D-145 喇叭和最後一個字一起換行：最後一個英文字連同標點，或最後兩個中文字與全形標點', () => {
  const tail = (text: string): string => text.slice(tailStart(text));
  assert.equal(tail('go 的過去式不規則：go → went → gone'), 'gone');
  assert.equal(tail('Can I borrow your pen? 我可以借你的筆嗎？'), '嗎？');
  assert.equal(tail('I went to the park yesterday.'), 'yesterday.');
  assert.equal(tail('易混淆 lend（借出：把東西借給別人）'), '人）');
  assert.equal(tail('borrow '), 'borrow ', '結尾的空白算在那一段裡');
  assert.equal(tail('.'), '.');
  assert.equal(tail(''), '');
  assert.equal(tail('the 𠮷'), '𠮷', '補充平面的中文字照 UTF-16 長度算');
});

void test('D-145 中文句子後面的英文換到下一行：斷在最後一個中文字或全形標點後面；英文在前的不斷', () => {
  assert.equal(englishBreak('我昨天去了公園。I '), '我昨天去了公園。'.length);
  assert.equal(englishBreak('他已經下定決心要出國讀書。He has already '), '他已經下定決心要出國讀書。'.length);
  assert.equal(englishBreak('離開時請關燈。'), '離開時請關燈。'.length, '空格緊接在中文後面：斷在空格前');
  assert.equal(englishBreak('（借）Can I '), 3, '全形括號也算');
  assert.equal(englishBreak('Can I '), null);
  assert.equal(englishBreak('This box is very '), null);
  assert.equal(englishBreak('𠮷。I '), 3, '補充平面的中文字照 UTF-16 長度算');
});

void test('R9 手勢：先鎖方向，垂直捲動後不改判；短的水平移動彈回；沒有上一張往右彈回；不在回看往左彈回', () => {
  assert.equal(lockAxis('pending', 9, 2), 'pending');
  assert.equal(lockAxis('pending', 11, 3), 'horizontal');
  assert.equal(lockAxis('pending', 11, 8), 'vertical');
  assert.equal(lockAxis('vertical', 100, 20), 'vertical');
  assert.equal(gesture('horizontal', 70, 4, 500, true, false), 'back');
  assert.equal(gesture('horizontal', -70, 4, 500, true, true), 'forward');
  assert.equal(gesture('horizontal', -70, 4, 500, true, false), 'bounce');
  assert.equal(gesture('horizontal', 70, 4, 500, false, false), 'bounce');
  assert.equal(gesture('horizontal', 30, 2, 40, true, false), 'back');
  assert.equal(gesture('horizontal', 30, 2, 500, true, false), 'bounce');
  assert.equal(gesture('vertical', 80, 200, 500, true, true), 'scroll');
  assert.equal(gesture('pending', 2, 3, 500, true, true), 'tap');
  assert.equal(gesture('pending', 20, 3, 500, true, true), 'bounce');
});

void test('R11 路徑：科目 › 年級學期 › 單元；缺的省略；學業以外用第一個分類，都沒有用檔名', () => {
  const props = (text: string) => parseDeck(text).props;
  assert.equal(crumb(props('---\n年級學期: 國二上\n科目: 自然\n單元: 2-2 水溶液\n---\n'), 'Essence Cards/x.md'), '自然 › 國二上 › 2-2 水溶液');
  assert.equal(crumb(props('---\n科目: 自然\n單元: 2-2 水溶液\n---\n'), 'Essence Cards/x.md'), '自然 › 2-2 水溶液');
  assert.equal(crumb(props('---\n科目: 英文\n---\n'), 'Essence Cards/x.md'), '英文');
  assert.equal(crumb(props('---\n分類: [攝影, 興趣]\n---\n'), 'Essence Cards/攝影/光圈.md'), '攝影');
  assert.equal(crumb(props(''), 'Essence Cards/攝影/光圈（卡片）.md'), '光圈（卡片）');
});

void test('R12 出處：頁碼、圖表例題（含子圖）、段落標題、連結；跨單元與年級學期；位置後面的說明照樣顯示', () => {
  assert.deepEqual(sourceLinks(['p.44', '圖 2-14', '表 2-1', '例題 2-3', '圖 2-13 A']).map(item => item.link), [
    { kind: 'block', id: 'p44' }, { kind: 'block', id: 'fig2-14' }, { kind: 'block', id: 'tab2-1' }, { kind: 'block', id: 'ex2-3' }, { kind: 'block', id: 'fig2-13a' },
  ]);
  assert.deepEqual(sourceLinks(['睡眠的階段']), [{ text: '睡眠的階段', link: { kind: 'heading', heading: '睡眠的階段' } }]);
  assert.deepEqual(sourceLinks(['[[水溶液實驗影片筆記#溶解的速度]]'])[0].link, { kind: 'note', link: '水溶液實驗影片筆記#溶解的速度' });
  assert.deepEqual(sourceLinks(['1-3 p.20', 'L3', '國一下 L5', '2-2 圖 2-14']).map(item => item.link), [
    { kind: 'unit', term: null, unit: '1-3', rest: { kind: 'block', id: 'p20' } },
    { kind: 'unit', term: null, unit: 'L3', rest: null },
    { kind: 'unit', term: '國一下', unit: 'L5', rest: null },
    { kind: 'unit', term: null, unit: '2-2', rest: { kind: 'block', id: 'fig2-14' } },
  ]);
  assert.deepEqual(sourceLinks(['p.45 知識快遞'])[0], { text: 'p.45 知識快遞', link: { kind: 'block', id: 'p45' } });
  // 認不得的（例如先備知識）先當成標題候選；材料裡沒有這個標題時，Obsidian 層照文字顯示、不做連結。
  assert.deepEqual(sourceLinks(['先備：國一數學 比例式'])[0].link, { kind: 'heading', heading: '先備：國一數學 比例式' });
});

void test('§2-4 能按的自評：一般卡四個；拼對記住了／太簡單；拼錯差一點／沒印象；按「沒印象」只剩沒印象', () => {
  assert.deepEqual(allowedFor(null), ['miss', 'near', 'good', 'easy']);
  assert.deepEqual(allowedFor('right'), ['good', 'easy']);
  assert.deepEqual(allowedFor('wrong'), ['miss', 'near']);
  assert.deepEqual(allowedFor('skip'), ['miss']);
});

void test('§2-6 完成畫面：N 是今天的作答筆數（錯題補強不算）、M 是相鄰間隔加總（超過 2 分鐘不算）；三種情況的文字', () => {
  const t = (time: string) => '2026-10-24T' + time + '+08:00';
  const lines = [
    encodeEntry(t('19:00:00.000'), { lt: 'a', r: 'good', v: '12345678' }),
    encodeEntry(t('19:00:20.000'), { lt: 'b', r: 'miss', v: '12345678' }),
    encodeEntry(t('19:05:20.000'), { lt: 'c', r: 'good', v: '12345678' }),
    encodeEntry(t('19:05:30.000'), { lt: 'd', r: 'miss', src: 'mistake' }),
    encodeEntry('2026-10-23T19:00:00.000+08:00', { lt: 'e', r: 'good', v: '12345678' }),
  ];
  const history = mergeHistory([{ path: 'Essence Cards/紀錄/2026-10 PC-test.jsonl', text: lines.join('\n') }]);
  const today = planToday({ decks: [], history, settings: { capMinutes: 30, retention: 0.8, filter: [] }, exam: null, now: Date.parse(t('19:06:00.000')), offset: 480 });
  const stats = todayStats(history, today);
  assert.deepEqual(stats, { count: 3, minutes: 0 });
  const progress = (rows: [string | null, number, number][]): Progress => ({
    done: rows.reduce((n, r) => n + r[1], 0), total: rows.reduce((n, r) => n + r[2], 0),
    subjects: rows.map(([subject, done, total]) => ({ subject, done, total, remainingSeconds: 0, inExam: false })),
  });
  assert.deepEqual(doneView({ subject: '自然' }, progress([['自然', 3, 3], ['英文', 2, 2]]), stats), {
    title: '今天的份完成了！', detail: '今天複習了 3 張・不到 1 分鐘',
    buttons: [{ kind: 'more', label: '再複習一些', pick: { more: true } }, { kind: 'close', label: '結束複習' }],
  });
  assert.deepEqual(doneView({ subject: '自然' }, progress([['英文', 0, 10], ['自然', 3, 3]]), { count: 12, minutes: 7 }), {
    title: '自然的份完成了！', detail: '還有英文 10 張',
    buttons: [{ kind: 'next', label: '接著做英文', pick: { subject: '英文' } }, { kind: 'close', label: '結束複習' }],
  });
  assert.deepEqual(doneView({ subject: null }, progress([['自然', 1, 3], [null, 2, 2]]), stats).title, '其他的份完成了！');
  assert.deepEqual(doneView({ more: true }, progress([['自然', 3, 3]]), { count: 12, minutes: 7 }), {
    title: '又多複習了一些', detail: '今天複習了 12 張・約 7 分鐘', buttons: [{ kind: 'close', label: '結束複習' }],
  });
});

// Codex L2 的 S2（2026-10-27 定，W6 §3-2）：看得到的區域比版面矮、而且不是縮放造成的時，全螢幕改成看得到的那一塊；
// 系統已經縮小版面（兩個高度一樣）時不再縮。只看高度不能保證對，iPhone 的 J7 才是驗收。
void test('§3-2 鍵盤：系統沒縮小版面時改成看得到的那一塊（含上緣位置）；系統已縮小、縮放或沒有鍵盤時不調整', () => {
  assert.deepEqual(keyboardFit(844, { height: 508, offsetTop: 0, scale: 1 }), { top: 0, height: 508 });
  assert.deepEqual(keyboardFit(844, { height: 508, offsetTop: 120.4, scale: 1 }), { top: 120.4, height: 508 }, '看得到的區域被捲下去了');
  assert.equal(keyboardFit(508, { height: 508, offsetTop: 0, scale: 1 }), null, '系統已經縮小版面：不再縮一次');
  assert.equal(keyboardFit(844, { height: 843.5, offsetTop: 0, scale: 1 }), null, '小於 1 px 的差不算');
  assert.equal(keyboardFit(844, { height: 422, offsetTop: 0, scale: 2 }), null, '放大造成的不是鍵盤');
  assert.equal(keyboardFit(844, null), null, '沒有 visualViewport');
});
