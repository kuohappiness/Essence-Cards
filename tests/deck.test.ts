import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDeck as parse, assignIds as assign, setTargetId as setId, baseForm, blockIds } from '../src/core/deck/index.ts';
import type { AssignOptions, Prompt } from '../src/core/deck/index.ts';

// 每次使用公開介面的範例都登錄到同一份清單；新增測試也自動受到往返保護。
const deckCases = new Set<string>();
function parseDeck(text: string) { deckCases.add(text); return parse(text); }
function assignIds(text: string, options: AssignOptions) { deckCases.add(text); return assign(text, options); }
function setTargetId(text: string, line: number, id: string | null) { deckCases.add(text); return setId(text, line, id); }

const syntax = readFileSync(new URL('../docs/syntax.md', import.meta.url), 'utf8');
const examples = [...syntax.slice(syntax.indexOf('### 2-2'), syntax.indexOf('### 2-3')).matchAll(/```markdown\r?\n([\s\S]*?)\r?\n```/g)].map(m => m[1]);
/** 文件裡縮排在清單項目底下的程式碼區塊：去掉共同的縮排。 */
function indentedFences(text: string, lang = ''): string[] {
  return [...text.matchAll(new RegExp('^( *)```' + lang + '\\r?\\n([\\s\\S]*?)\\r?\\n *```', 'gm'))]
    .map(m => m[2].split('\n').map(line => line.startsWith(m[1]) ? line.slice(m[1].length) : line).join('\n'));
}
const emptyFields = { sources: [], type: null, importance: 'medium', paused: false, remarks: [], mistakes: [] };
const qa = (prompt: Prompt) => { assert.equal(prompt.kind, 'qa'); if (prompt.kind !== 'qa') throw Error(); return prompt; };
const cloze = (prompt: Prompt) => { assert.equal(prompt.kind, 'cloze'); if (prompt.kind !== 'cloze') throw Error(); return prompt; };
const deck = (body: string) => parseDeck('- 目標\n' + body);
const first = (body: string) => deck(body).targets[0];
const codes = (body: string) => deck(body).problems.map(p => p.code);

void test('§2-2 自然完整例子：逐一核對屬性、目標、資料、題目與補充', () => {
  const parsed = parseDeck(examples[0]);
  assert.deepEqual(parsed.props, { term: '國二上', subject: '自然', unit: { code: '2-2', name: '水溶液' }, materials: ['[[國二上自然 2-2 水溶液]]'], status: 'active', categories: [], isTranscript: false, need: null });
  assert.deepEqual(parsed.problems, []);
  const expected = [
    ['k3m9x2', '能說出溶質與溶劑的意思', '1 溶液', ['p.43'], '定義', 'medium', ['[[國二上自然 第一次段考]]'], [
      ['糖水裡，哪一個是溶質？哪一個是溶劑？', '糖是**溶質**，水是**溶劑**', []], ['碘酒裡的溶劑是什麼？', '**酒精**', []]]],
    ['h2m8qd', '能說明溶液的質量組成', '1 溶液', ['p.43'], '因果', 'high', ['[[國二上自然 第一次段考]]'], [
      ['溶液的質量怎麼算？', '**溶質**的質量加上**溶劑**的質量', []], ['糖加太多、杯底有沉澱時，溶液的質量怎麼算？', '**只算已溶解的溶質**加上**溶劑**', []]]],
    ['p7q2w8', '能用粒子運動說明擴散現象', '2 擴散現象', ['p.44', '圖 2-14'], '因果', 'high', [], [
      ['黑糖放進水裡，不攪拌也會慢慢變甜，為什麼？', '粒子**不停運動**，糖從**濃度高**的地方散到**濃度低**的地方', ['![[國二上自然 2-2 圖2-14.png]]']]]],
    ['w4s8nd', '能說出影響溶解快慢的因素', '2 擴散現象', ['p.45'], '因果', 'medium', [], []],
    ['r5t9vb', '能說明溶液靜置後不會分層', '2 擴散現象', ['2-2 p.43'], '因果', 'medium', ['[[國二上自然 第一次段考]]'], [
      ['糖水放一整天，杯底會出現糖嗎？為什麼？', '**不會**；溶解的糖粒子和水**均勻混合**，不會自己沉下去', []]]],
  ];
  assert.equal(parsed.targets.length, expected.length);
  parsed.targets.forEach((target, index) => {
    const [id, name, section, sources, type, importance, mistakes, prompts] = expected[index];
    assert.deepEqual({ ...target, prompts: undefined, line: undefined }, { id, name, section, fields: { ...emptyFields, sources, type, importance, mistakes }, implicit: false, direction: null, pairKey: null, shared: [], ok: true, prompts: undefined, line: undefined });
    assert.equal(examples[0].split('\n')[target.line].trim(), '- ' + String(name) + ' ^' + String(id));
    if (index === 3) {
      const p = cloze(target.prompts[0]);
      assert.equal(p.text, '水溫越==高==、顆粒越==小==、有==攪拌==，糖溶解得越快');
      assert.deepEqual(p.blanks.map(b => p.text.slice(b.start, b.end)), ['==高==', '==小==', '==攪拌==']);
      assert.deepEqual(p.extras, []);
    } else {
      assert.deepEqual(target.prompts.map(prompt => { const p = qa(prompt); return [p.question, p.answer, p.extras]; }), prompts);
      target.prompts.forEach(p => assert.equal(qa(p).typed, null));
    }
  });
});

void test('§2-2 英文完整例子：兩方向、typed、例句與記憶錨點', () => {
  const parsed = parseDeck(examples[1]);
  assert.deepEqual(parsed.props, { term: '國二上', subject: '英文', unit: { code: 'L1', name: 'Back to School' }, materials: ['[[國二上英文 L1 Back to School]]'], status: 'active', categories: [], isTranscript: false, need: null });
  assert.deepEqual(parsed.problems, []);
  const rows = [
    ['b4rw7k', 'borrow 英翻中', 'en-zh', 'borrow', 'borrow', 'v. 借入、向別人借', ['例句：Can I borrow your pen? 我可以借你的筆嗎？'], [], null],
    ['c9tn3e', 'borrow 中翻英', 'zh-en', 'borrow', 'Can I ＿＿ your pen?（借）', 'borrow', [], ['記憶錨點：易混淆 lend（借出：把東西借給別人）'], ['borrow']],
    ['u6vf2m', 'uniform 英翻中', 'en-zh', 'uniform', 'uniform', 'n. 制服', ['例句：We wear uniforms to school. 我們穿制服上學。'], [], null],
  ];
  assert.equal(parsed.targets.length, 3);
  parsed.targets.forEach((t, i) => {
    const [id, name, direction, pairKey, question, answer, extras, shared, typed] = rows[i];
    assert.deepEqual({ ...t, line: undefined, prompts: undefined }, { id, name, direction, pairKey, section: null, fields: emptyFields, shared, implicit: false, ok: true, line: undefined, prompts: undefined });
    assert.equal(t.prompts.length, 1);
    const p = qa(t.prompts[0]);
    assert.deepEqual([p.question, p.answer, p.extras, p.typed], [question, answer, extras, typed]);
    assert.equal(examples[1].split('\n')[t.line].trim(), '- ' + String(name) + ' ^' + String(id));
  });
});

void test('§2-9 草稿的三個引言框都忽略', () => {
  const part = syntax.slice(syntax.indexOf('### 2-9'), syntax.indexOf('### 2-10'));
  const draft = /````markdown\r?\n([\s\S]*?)\r?\n````/.exec(part)![1];
  const parsed = parseDeck(draft);
  assert.deepEqual(parsed.targets.map(t => t.name), ['能用粒子運動說明擴散現象']);
  assert.equal(parsed.targets[0].section, '2 擴散現象');
});

for (const separator of ['::', ' :: ', ':: ', ' ::']) void test('D-089 #1 冒號空白 ' + JSON.stringify(separator), () => {
  const p = qa(first('  - Q' + separator + 'A').prompts[0]);
  assert.equal(p.question, 'Q'); assert.equal(p.answer, 'A');
});
for (const literal of ['`:: ==x==`', '``a ` :: ==x==``', '$x::y==z==$','$$x::y==z==$$']) void test('D-089 #2 程式碼／公式 ' + literal, () => {
  assert.equal(parseDeck('- ' + literal).targets.length, 0);
  assert.equal(qa(first('  - ' + literal + ' Q :: A').prompts[0]).question, literal + ' Q');
});
void test('D-089 #2 code span 必須由相同長度的反引號關閉', () => {
  assert.equal(parseDeck('- `literal `` Q :: A').targets.length, 1);
  assert.equal(parseDeck('- ``literal ``` Q :: A ``').targets.length, 0);
});
void test('D-089 #3 有 :: 的螢光筆仍是問答', () => assert.equal(first('  - ==Q== :: ==A==').prompts[0].kind, 'qa'));
void test('D-089 #4 多行答案排除資料，保留子項目 Markdown', () => {
  const t = first('  - Q ::\n    - **A**\n    - 出處：p.1\n    - B\n      - nested\n    - 備註：老師強調');
  assert.equal(qa(t.prompts[0]).answer, '**A**\nB\n  - nested');
  assert.deepEqual(qa(t.prompts[0]).extras, []);
  assert.deepEqual(t.fields.sources, ['p.1']); assert.deepEqual(t.fields.remarks, ['老師強調']);
});
for (const colon of [':', '：']) void test('D-089 #5 欄位冒號 ' + colon, () => assert.equal(first('  - 重要性' + colon + '高\n  - Q :: A').fields.importance, 'high'));
for (const indent of ['\t', '  ', '    ']) void test('D-089 #6 縮排 ' + JSON.stringify(indent), () => {
  const t = first(indent + '- Q :: A\n' + indent + indent + '- extra');
  assert.equal(t.prompts.length, 1); assert.deepEqual(qa(t.prompts[0]).extras, ['extra']);
});
void test('D-089 #6 Tab 到下一個四欄位置，並支援所有清單符號', () => {
  for (const marker of ['-', '*', '+', '1.', '1)', '12.']) {
    const p = parseDeck(marker + ' 目標\n \t- Q :: A').targets[0];
    assert.equal(p.implicit, false); assert.equal(p.prompts.length, 1);
  }
});
void test('D-089 #7 Markdown 原樣保留', () => {
  const p = qa(first('  - **Q** ![[圖.png]] $x$ [[連結]] :: **A** $y$ [[答案]]').prompts[0]);
  assert.equal(p.question, '**Q** ![[圖.png]] $x$ [[連結]]'); assert.equal(p.answer, '**A** $y$ [[答案]]');
});
void test('D-089 #8 fenced code、引言與其中標題都忽略', () => {
  for (const fence of ['```', '~~~~']) {
    const parsed = parseDeck('## 正確\n> # 假標題\n> - Q :: A\n' + fence + '\n# 假標題\n- Q :: A\n' + fence + '\n- 目標\n  - Q :: A');
    assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].section, '正確');
  }
});
void test('D-089 #8 fenced code 的短圍欄不能提早結束', () => {
  assert.equal(parseDeck('````\n```\n- Q :: A\n````\n- B :: C').targets.length, 1);
});
void test('D-089 #8 清單符號之後的程式碼圍欄也不產生卡片', () => {
  for (const fence of ['```', '~~~']) {
    const text = '- ' + fence + '\n  - 假題 :: A\n  ' + fence + '\n- 目標\n  - Q :: A\n  - ' + fence + '\n    - 假題 :: B\n    ' + fence + '\n  - R :: C';
    const parsed = parseDeck(text);
    assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].prompts.length, 2);
  }
});
void test('section 保留標題文字裡的 #，只移除分隔的結尾 #', () => {
  assert.equal(parseDeck('## C#\n- Q :: A').targets[0].section, 'C#');
  assert.equal(parseDeck('## 標題 ##\n- Q :: A').targets[0].section, '標題');
});
void test('D-089 #9 題目 ID 移除，目標才有 ID', () => {
  const t = parseDeck('- 目標 ^Parent-123\n  - Q :: A ^child').targets[0];
  assert.equal(t.id, 'Parent-123'); assert.equal(qa(t.prompts[0]).answer, 'A');
  assert.equal(first('  - Q :: A ^child').id, null);
});
void test('D-089 #10 錯誤只影響所屬目標，問題依行號排序', () => {
  const parsed = parseDeck('- 壞\n  - :: A\n  - Q ::\n- 好\n  - Q :: A');
  assert.deepEqual(parsed.targets.map(t => t.ok), [false, true]);
  assert.deepEqual(parsed.problems.map(p => [p.line, p.targetLine, p.level]), [[1, 0, 'error'], [2, 0, 'error']]);
});
void test('D-089 #11 欄位不認得使用預設值但照常排程', () => {
  const t = first('  - 重要性：很高｜狀態：不明\n  - Q :: A');
  assert.equal(t.ok, true); assert.equal(t.fields.importance, 'medium'); assert.equal(t.fields.paused, false);
  assert.deepEqual(codes('  - 重要性：很高｜狀態：不明\n  - Q :: A'), ['unknown-field-value', 'unknown-field-value']);
});
void test('D-089 #12 沒題目的一般筆記不產生目標或問題', () => {
  assert.deepEqual(parseDeck('- 一般筆記\n  - 重要性：錯字').targets, []);
  assert.deepEqual(parseDeck('- 一般筆記\n  - 重要性：錯字').problems, []);
});
void test('D-089 #13 typed 保留大小寫，僅清格式與頭尾空白', () => {
  const t = parseDeck('- Phrase 中翻英\n  - Q :: **Take** _a_ ==Break==').targets[0];
  assert.deepEqual(qa(t.prompts[0]).typed, ['Take a Break']); assert.equal(t.ok, true);
});

// W6 §0-1（D-122）：中翻英的答案格照 | 拆開成好幾個正確答案；answer 與題目指紋照舊用整個答案格。
void test('R1 syntax §2-3 與英文規則的 ` | ` 例子：typed 兩個答案、answer 與指紋和拆開之前相同', () => {
  const english = readFileSync(new URL('../docs/card-rules/english.md', import.meta.url), 'utf8');
  const sources = [
    ...indentedFences(syntax.slice(syntax.indexOf('### 2-3'), syntax.indexOf('### 2-4')), 'markdown'),
    ...indentedFences(english).filter(text => text.includes(' | ')),
  ];
  assert.equal(sources.length, 2);
  for (const text of sources) {
    const parsed = parseDeck(text);
    assert.deepEqual(parsed.problems, []);
    assert.deepEqual(parsed.targets.map(t => [t.name, t.direction, t.ok]), [["make up one's mind 中翻英", 'zh-en', true]]);
    const [basic, both] = parsed.targets[0].prompts.map(qa);
    assert.deepEqual([basic.answer, basic.typed, basic.fingerprint], ['make up your mind', ['make up your mind'], '8ae9acd7']);
    assert.deepEqual([both.answer, both.typed, both.fingerprint], ['made up his mind | made his mind up', ['made up his mind', 'made his mind up'], '9938603d']);
    assert.deepEqual(both.extras, ['詳解：made up his mind 和 made his mind up 都對，課本用前者']);
  }
});
for (const [name, answer, typed, fingerprint, problems] of [
  ['`a|b` 前後沒空格也認得', 'a|b', ['a', 'b'], '434fa34e', []],
  ['分隔前後多個空格也認得', 'a  |  b', ['a', 'b'], '03801974', []],
  ['粗體跨過分隔', '**a | b**', ['a', 'b'], 'b284db9b', []],
  ['螢光筆跨過分隔', '==a | b==', ['a', 'b'], 'b38b856f', []],
  ['兩段各自的裝飾', '**a** | ==b==', ['a', 'b'], 'f6fd120c', []],
  ['兩個答案字數不同只是 hint', 'a | two words', ['a', 'two words'], '03324c7c', ['typed-answer-words']],
  ['只有一個答案', 'borrow', ['borrow'], 'cffabbc2', []],
  ['每一段各自拿掉粗體', '**made** up his mind | made his mind up', ['made up his mind', 'made his mind up'], '01829f8b', []],
  ['字數不一樣：提示、照樣出題', 'made up his mind | decided', ['made up his mind', 'decided'], 'cb4b5fb9', ['typed-answer-words']],
] as const) void test('R1 ' + name, () => {
  const parsed = parseDeck('- x 中翻英\n  - Q :: ' + answer);
  const prompt = qa(parsed.targets[0].prompts[0]);
  assert.deepEqual([prompt.answer, prompt.typed, prompt.fingerprint], [answer, typed, fingerprint]);
  assert.deepEqual(parsed.problems.map(p => p.code), problems);
  assert.equal(parsed.targets[0].ok, true);
});
void test('R1 typed-answer-words 是 hint，訊息說畫線照第一個', () => {
  const parsed = parseDeck('- x 中翻英\n  - Q :: made up his mind | decided');
  assert.deepEqual(parsed.problems.map(p => [p.level, p.message, p.targetLine]), [['hint', '好幾個答案的字數不一樣，畫線照第一個', 0]]);
});
// Codex 格式查核的固定回歸基準：同一個答案格，W5（還沒拆 |）算出的指紋和 W6 相同，typed 照 | 拆開。
for (const [answer, fingerprint, typed] of [
  ['made up his mind | made his mind up', 'a5ec3d47', ['made up his mind', 'made his mind up']],
  ['**made** up his mind | made his mind up', '81ac4269', ['made up his mind', 'made his mind up']],
  ['**a | b**', '9ec1d1dc', ['a', 'b']],
  ['==a | b==', '35b63e7f', ['a', 'b']],
  ['a|b', 'd0d56a63', ['a', 'b']],
  ['a | b', 'c42e51fa', ['a', 'b']],
  ['a  |  b', 'c42e51fa', ['a', 'b']],
  ['borrow', 'fa0de703', ['borrow']],
] as const) void test('R1 指紋和 W5 相同：' + answer, () => {
  const prompt = qa(parseDeck('- x 中翻英\n  - He has already ____ . :: ' + answer).targets[0].prompts[0]);
  assert.deepEqual([prompt.fingerprint, prompt.typed], [fingerprint, typed]);
});
// W6 §0-1（格式查核 F1）：整格有跳脫的管線、行內程式碼、公式、Obsidian 連結或嵌入、Markdown 連結時不拆開，typed 是 null。
for (const answer of ['a \\| b', '`a | b`', '[[word|borrow]]', '![[pic.png|borrow]]', '[borrow](https://example.test/a|b)', '$a|b$']) void test('R1 整格不能當打字答案就是 typed-answer-invalid、不拆開：' + answer, () => {
  const parsed = parseDeck('- x 中翻英\n  - Q :: ' + answer);
  assert.deepEqual(parsed.problems.map(p => [p.code, p.level, p.message]), [['typed-answer-invalid', 'error', '中翻英的答案只能是單行英文單字或片語，好幾個答案用 | 分開；不能有換行、連結、程式碼或公式']]);
  assert.equal(qa(parsed.targets[0].prompts[0]).typed, null);
  assert.equal(parsed.targets[0].ok, false);
});
// W6 §0-1 的 L2 後補（S1，2026-10-27 格式查核的邊界表）：任何位置有不分大小寫的 http(s)://、全形的｜、ASCII 的 [ ] < >
// 都整格拒收：只有一個 error、沒有字數 hint、不拆開；答案格與指紋照舊（和同樣題目的英翻中相同）。
for (const answer of [
  'https://a.test/a|b', 'HTTPS://A.TEST', 'hTtP://', 'prefix http://a.test tail | b', '**https://a.test/a|b**', '<https://a.test/a|b>',
  'a｜b', 'a ｜ b', 'a|b｜c', '｜', 'a | two｜words',
  '<mailto:a@b.test>', '<a@b.test>', '<ftp://a.test/a|b>', '[word][ref] | b', '[word] | b',
]) void test('R1 S1 網址、全形｜、括號就是 typed-answer-invalid：' + answer, () => {
  const parsed = parseDeck('- x 中翻英\n  - Q :: ' + answer + '\n\n[ref]: /target\n[word]: /target');
  const prompt = qa(parsed.targets[0].prompts[0]);
  assert.deepEqual(parsed.problems.map(p => [p.code, p.level, p.message]), [['typed-answer-invalid', 'error', '中翻英的答案只能是單行英文單字或片語，好幾個答案用 | 分開；不能有換行、連結、程式碼或公式']]);
  assert.deepEqual([prompt.typed, parsed.targets[0].ok, prompt.answer], [null, false, answer]);
  assert.equal(prompt.fingerprint, qa(parseDeck('- x 英翻中\n  - Q :: ' + answer).targets[0].prompts[0]).fingerprint);
});
// 沒有 http(s):// 的網址不辨認（syntax.md §2-3）：照一般文字拆開，www.a.test/a|b 打 b 也算對，是已知的代價。
for (const [answer, typed] of [
  ['www.a.test', ['www.a.test']],
  ['mailto:a@b.test', ['mailto:a@b.test']],
  ['www.a.test/a|b', ['www.a.test/a', 'b']],
  ['mailto:a@b.test|b', ['mailto:a@b.test', 'b']],
] as const) void test('R1 S1 沒有 http(s):// 的網址照一般文字：' + answer, () => {
  const parsed = parseDeck('- x 中翻英\n  - Q :: ' + answer);
  assert.deepEqual([qa(parsed.targets[0].prompts[0]).typed, parsed.targets[0].ok, parsed.problems], [typed, true, []]);
});
void test('R1 S1 一題是網址就整個目標停出（D-089 第 10 條），同篇其他目標照出', () => {
  const parsed = parseDeck('- x 中翻英\n  - 好的 :: borrow\n  - 壞的 :: https://a.test\n- y 中翻英\n  - Q :: lend');
  assert.deepEqual(parsed.targets.map(t => [t.name, t.ok, t.prompts.map(p => qa(p).typed)]), [['x 中翻英', false, [['borrow'], null]], ['y 中翻英', true, [['lend']]]]);
  assert.deepEqual(parsed.problems.map(p => [p.line, p.targetLine, p.code]), [[2, 0, 'typed-answer-invalid']]);
});
void test('R1 S1 只看 :: 右邊的答案格：資料欄位、題幹、背面補充裡的｜與網址不影響', () => {
  const parsed = parseDeck([
    '- x 中翻英', '  - 出處：p.44｜類型：因果', '  - Q :: a | b',
    '- y 中翻英', '  - 出處：https://a.test｜類型：因果', '  - 看 https://a.test ｜ [[note]] 再答 :: c', '    - 詳解：a｜b https://a.test <b>',
  ].join('\n'));
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.targets.map(t => [t.ok, t.fields.sources, t.fields.type, t.prompts.map(p => [qa(p).answer, qa(p).typed])]), [
    [true, ['p.44'], '因果', [['a | b', ['a', 'b']]]],
    [true, ['https://a.test'], '因果', [['c', ['c']]]],
  ]);
});
// 中文且字數不同（'a | 借 入'）也只報 invalid，不另給字數的 hint（Codex 格式查核 F2）。
for (const answer of ['a | ', '| a', 'a | | b', 'a || b', 'a | 借', 'a | 借 入', 'a | ** **']) void test('R1 有一段是空的或含中文就是 typed-answer-invalid：' + JSON.stringify(answer), () => {
  const parsed = parseDeck('- x 中翻英\n  - Q :: ' + answer);
  assert.deepEqual(parsed.problems.map(p => p.code), ['typed-answer-invalid']);
  assert.equal(parsed.targets[0].ok, false);
});
// Codex 格式查核 F2：換行在拆開、trim 之前檢查（題目後面頂格的接續行會把換行帶進答案格）。
for (const lines of [['a |', 'b'], ['a', '| b']]) void test('R1 分隔符號前後換行也是 typed-answer-invalid：' + JSON.stringify(lines.join('\n')), () => {
  const parsed = parseDeck('- x 中翻英\n    - Q :: ' + lines[0] + '\n      ' + lines[1]);
  assert.equal(qa(parsed.targets[0].prompts[0]).answer, lines.join('\n'));
  assert.deepEqual(parsed.problems.map(p => p.code), ['typed-answer-invalid']);
  assert.equal(parsed.targets[0].ok, false);
});
// W6 §0-2（D-121、D-125）：原形提示 = 名稱去掉最後的「 中翻英」，再去掉最後一組全形括號；其他目標 null。
for (const [name, expected] of [
  ['borrow 中翻英', 'borrow'],
  ["make up one's mind 中翻英", "make up one's mind"],
  ['light（輕的） 中翻英', 'light'],
  ['light（輕的）中翻英', 'light（輕的）中翻英'],
  ['take（搭乘） a bus 中翻英', 'take（搭乘） a bus'],
  ['light（輕的） 英翻中', null],
  ['light 英翻中', null],
  ['能說明擴散', null],
] as const) void test('R2 原形 ' + JSON.stringify(name), () => {
  const parsed = parseDeck('- ' + name + '\n  - Q :: light');
  // 沒有「 中翻英」結尾的名稱不是中翻英目標，原形是 null（最後一行的例子只是一般目標）。
  assert.equal(baseForm(parsed.targets[0]), expected === name ? null : expected);
});
void test('R1 中翻英以外的問答題 typed 仍是 null，答案裡的 | 不拆', () => {
  for (const text of ['- x 英翻中\n  - a | b :: 甲 | 乙', '- 目標\n  - Q :: a | b']) {
    const prompt = qa(parseDeck(text).targets[0].prompts[0]);
    assert.equal(prompt.typed, null);
    assert.ok(prompt.answer.includes(' | '));
  }
});

for (const [name, input, code] of [
  ['空題目', '- 目標\n  - :: A', 'empty-question'],
  ['沒答案', '- 目標\n  - Q ::\n    - 出處：p.1', 'missing-answer'],
  ['中翻英多行', '- 字 中翻英\n  - Q ::\n    - take\n    - care', 'typed-answer-invalid'],
  ['中翻英中文', '- 字 中翻英\n  - Q :: borrow 借入', 'typed-answer-invalid'],
  ['中翻英空的格式', '- 字 中翻英\n  - Q :: ****', 'typed-answer-invalid'],
]) void test('§2-10 錯誤：' + name, () => {
  const parsed = parseDeck(input); assert.equal(parsed.targets[0].ok, false); assert.ok(parsed.problems.some(p => p.code === code));
});
void test('§2-10 縮排錯一層是不同結構，並非錯誤', () => {
  const parsed = deck('  - Q :: A\n  - 原本想放在題下的補充');
  assert.deepEqual(parsed.problems, []); assert.deepEqual(parsed.targets[0].shared, ['原本想放在題下的補充']);
});
void test('typed 以答案文字判斷行數，只有一個答案子項目仍是單行', () => {
  const parsed = parseDeck('- 字 中翻英\n  - Q ::\n    - word');
  assert.deepEqual(parsed.problems, []); assert.deepEqual(qa(parsed.targets[0].prompts[0]).typed, ['word']);
});
void test('中翻英填空只提示、不要求 typed', () => {
  const parsed = parseDeck('- 字 中翻英\n  - ==word==');
  assert.equal(parsed.targets[0].ok, true); assert.deepEqual(parsed.problems.map(p => p.code), ['cloze-not-typed']);
});
void test('只有結尾完整方向字樣才配對', () => {
  assert.equal(parseDeck('- 字 中翻英 補充\n  - Q :: A').targets[0].direction, null);
});
void test('欄位合併去重、單值只取首次、未知欄位忽略', () => {
  const parsed = deck('  - 出處：1-3 p.20、p.44｜備註：A、B｜錯題補強：[[考試]]\n  - 類型：定義｜重要性：低｜狀態：暫停｜陌生：X\n  - Q :: A\n    - 出處:p.44、p.45｜備註:B、C｜錯題補強:[[考試]]、[[考試2]]\n    - 類型：因果｜重要性：高｜狀態：啟用');
  assert.deepEqual(parsed.targets[0].fields, { sources: ['1-3 p.20', 'p.44', 'p.45'], type: '定義', importance: 'low', paused: true, remarks: ['A', 'B', 'C'], mistakes: ['[[考試]]', '[[考試2]]'] });
  assert.deepEqual(parsed.problems.map(p => p.code), ['unknown-field', 'duplicate-field', 'duplicate-field', 'duplicate-field']);
});
void test('例句、記憶錨點不是未知資料；補充保留巢狀 Markdown', () => {
  const t = first('  - 記憶錨點：聯想\n    + 細節\n  - Q :: A\n    - 例句：hello\n      1. 子項');
  assert.deepEqual(t.shared, ['記憶錨點：聯想\n  + 細節']);
  assert.deepEqual(qa(t.prompts[0]).extras, ['例句：hello\n  1. 子項']);
});
void test('接續行以換行相接，空行不結束清單，外部段落會結束', () => {
  const parsed = parseDeck('- 目標\n\n  - Q :: A\n    next\n\n筆記\n  - B :: C');
  assert.equal(qa(parsed.targets[0].prompts[0]).answer, 'A\nnext');
  assert.equal(parsed.targets.length, 2); assert.equal(parsed.targets[1].implicit, true);
});
// W5 對照 M2a、M2b、M3：沒有空行的頂格一行，Obsidian 接在上一題的文字後面，後面的題目仍是同一個目標的；
// 有空行時頂格段落才結束清單。
void test('沒有空行、頂格的一行接在上一題後面，後面的題目仍屬於同一個目標', () => {
  for (const indent of ['    ', '  ']) {
    const parsed = parseDeck('- 目標\n' + indent + '- Q :: A\n隨手一行\n' + indent + '- R :: B');
    assert.deepEqual(parsed.targets.map(t => [t.line, t.implicit]), [[0, false]], JSON.stringify(indent));
    assert.deepEqual(parsed.targets[0].prompts.map(p => [p.line, qa(p).question, qa(p).answer]), [[1, 'Q', 'A\n隨手一行'], [3, 'R', 'B']]);
  }
  const blank = parseDeck('- 目標\n    - Q :: A\n\n隨手一行\n\n    - R :: B');
  assert.deepEqual(blank.targets.map(t => t.prompts.map(p => p.line)), [[1]]);
  // 標題、引言框、圍欄會打斷段落，不是延續。
  for (const breaker of ['# 標題', '> 引言', '~~~']) {
    assert.deepEqual(parseDeck('- 目標\n  - Q :: A\n' + breaker + '\n').targets.map(t => qa(t.prompts[0]).answer), ['A'], breaker);
  }
});
// Codex 審查 W5 的 F1：分隔線與圍欄之後沒有段落可以延續，頂格的家長筆記不能接進目標名稱或上一題。
// Windows 版 Obsidian 1.14.5 的閱讀模式（2026-10-25 對照）：那一行留在同一個項目裡當一般段落，清單沒有結束，
// 後面的 R 仍是目標的子題目（不是 CommonMark 會得到的新清單）；這裡照閱讀模式（D-135）。
void test('分隔線、圍欄之後的頂格一行是目標裡的一般段落：ID、題目、指紋與歸屬都不變，後面的題目仍屬於同一個目標', () => {
  const plain = parseDeck('- 目標 ^k3m9x2\n    - Q :: A\n    - R :: B').targets[0];
  const shape = (text: string) => parseDeck(text).targets.map(t => [t.id, t.name, t.implicit, t.prompts.map(p => [qa(p).question, qa(p).answer, p.fingerprint])]);
  const prompts = plain.prompts.map(p => [qa(p).question, qa(p).answer, p.fingerprint]);
  const expected = [['k3m9x2', '目標', false, prompts]];
  for (const rule of ['***', '___', '- - -', '* * *']) {
    assert.deepEqual(shape('- 目標 ^k3m9x2\n    - Q :: A\n  ' + rule + '\n家長筆記 :: 不能出題\n    - R :: B'), expected, rule);
  }
  // 項目自己開的圍欄，與目標內容裡的圍欄。
  assert.deepEqual(shape('- 目標 ^k3m9x2\n    - Q :: A\n    - ```\n      code\n      ```\n家長筆記\n    - R :: B'), expected);
  assert.deepEqual(shape('- 目標 ^k3m9x2\n    - Q :: A\n  ```\n  code\n  ```\n家長筆記\n    - R :: B'), expected);
  // 空一行之後的頂格段落才結束清單（和 M3 相同）。
  assert.deepEqual(shape('- 目標 ^k3m9x2\n    - Q :: A\n  ***\n\n家長筆記\n    - R :: B'), [['k3m9x2', '目標', false, prompts.slice(0, 1)]]);
});
void test('接續行不會讓目標／題目行的 ID 失效', () => {
  const t = parseDeck('- 目標 ^parent\n  接續\n  - Q :: A ^child\n    next').targets[0];
  assert.equal(t.id, 'parent'); assert.equal(t.name, '目標'); assert.equal(qa(t.prompts[0]).answer, 'A\nnext');
});

for (const status of ['草稿', '啟用', '暫停']) void test('YAML 狀態 ' + status, () => {
  assert.equal(parseDeck('---\n狀態: ' + status + '\n---').props.status, ({ 草稿: 'draft', 啟用: 'active', 暫停: 'paused' })[status]);
});
void test('YAML 單字串或清單屬性、未知屬性、單元無空格', () => {
  const parsed = parseDeck('---\n年級學期: 國一上\n科目: 自然\n單元: 2-2\n材料: "[[教材]]"\n分類: [醫學, 睡眠]\n未知: 忽略\n---');
  assert.deepEqual(parsed.props.unit, { code: '2-2', name: '' }); assert.deepEqual(parsed.props.materials, ['[[教材]]']); assert.deepEqual(parsed.props.categories, ['醫學', '睡眠']);
  assert.deepEqual(parseDeck('---\n分類: 醫學\n---').props.categories, ['醫學']);
});
void test('來源類型只要存在就是轉錄稿，全部清單不當卡組', () => {
  const parsed = parseDeck('---\n來源類型: null\n---\n- Q :: A');
  assert.equal(parsed.props.isTranscript, true); assert.deepEqual(parsed.targets, []);
});
for (const broken of ['科目: [', '科目: 自然\n科目: 英文', '- 不是對照表']) void test('YAML 壞掉全部回預設 ' + broken, () => {
  const parsed = parseDeck('---\n' + broken + '\n---\n- Q :: A');
  assert.deepEqual(parsed.props, parseDeck('').props); assert.equal(parsed.problems[0].line, 0); assert.equal(parsed.problems[0].code, 'unknown-property-value');
});
// W5 對照 D068：Obsidian 把沒有結束的屬性區當成一般文字，底下的清單照樣顯示，所以照樣出題。
void test('未閉合 YAML 照 Obsidian 當成一般文字：清單照樣出題，屬性用預設值並提示', () => {
  const parsed = parseDeck('---\n科目: 自然\n- Q :: A');
  assert.deepEqual(parsed.targets.map(t => [t.line, t.implicit]), [[2, true]]);
  assert.deepEqual(parsed.props, parseDeck('').props);
  assert.deepEqual(parsed.problems.map(p => [p.line, p.code]), [[0, 'unknown-property-value']]);
});
// Codex 審查 W5：Obsidian 只認 `---` 當屬性區的結尾（2026-10-25 對照：`...` 是 Q 的延續文字，Q、R 都顯示），
// 所以只有開頭 `---`、中間是 `...` 的筆記也是沒有結束的屬性區（D-135）。
void test('開頭 --- 之後用 ... 結尾不算結束：當成一般文字，前後的清單都出題', () => {
  const parsed = parseDeck('---\n科目: 自然\n- Q :: A\n...\n- R :: B');
  assert.deepEqual(parsed.targets.map(t => [t.line, t.implicit, t.prompts.map(p => [qa(p).question, qa(p).answer])]), [[2, true, [['Q', 'A\n...']]], [4, true, [['R', 'B']]]]);
  assert.deepEqual(parsed.props, parseDeck('').props);
  assert.deepEqual(parsed.problems.map(p => [p.line, p.code]), [[0, 'unknown-property-value']]);
});
void test('YAML 未知狀態提示位於狀態行', () => {
  const parsed = parseDeck('---\n科目: 自然\n狀態: 已採用\n---');
  assert.equal(parsed.props.status, 'active'); assert.equal(parsed.problems[0].line, 2); assert.equal(parsed.problems[0].targetLine, null);
});

// 需要版本（syntax.md §0-1、§2-1，D-149 第 3 點）：parseDeck 只照實回報標記，讀不讀得懂由知道這台版本的一方判斷。
// need：沒寫是 null；值是字串時是那個字串（格式由讀取端檢查）；值不是字串、或屬性區讀不出來而原文含「需要版本」時是 false。
void test('§2-1 需要版本：照實回報字串；沒寫是 null；寫了但不是字串是 false（有標記但壞掉）', () => {
  const need = (yaml: string) => parseDeck('---\n科目: 自然\n' + yaml + '\n---\n- Q :: A').props.need;
  assert.equal(need('需要版本: 0.6.0'), '0.6.0');
  assert.equal(need('需要版本: "0.10.0"'), '0.10.0');
  assert.equal(need('需要版本: v0.6.0'), 'v0.6.0');
  assert.equal(need('"\\u9700\\u8981\\u7248\\u672c": 0.6.0'), '0.6.0');
  assert.equal(need('需要版本: ""'), '');
  for (const yaml of ['需要版本: 0.6', '需要版本: 6', '需要版本:', '需要版本: null', '需要版本: [0.6.0]', '需要版本: { v: 0.6.0 }', '需要版本: true']) assert.equal(need(yaml), false, yaml);
  assert.equal(need('其他: 1'), null);
  assert.equal(need('備註: 需要版本'), null);
  assert.equal(parseDeck('- Q :: A').props.need, null);
  assert.equal(parseDeck('---\n---\n- Q :: A').props.need, null);
  assert.equal(parseDeck('').props.need, null);
});
// Codex 格式查核 F1：屬性區讀不出來時，原文照 YAML 雙引號字串的規則解開跳脫之後含「需要版本」就算讀不懂。
for (const [label, key] of [
  ['引號', '"需要版本": 9.0.0'], ['縮排', '  需要版本:'], ['冒號前空白', '需要版本 :'], ['引號沒有值', '"需要版本":'],
  ['行尾 \\ 接行', '"需要\\\n  版本": 9.0.0'], ['CRLF 的行尾 \\ 接行', '"需\\\r\n要版本": 9.0.0'], ['\\u 跳脫', '"\\u9700\\u8981\\u7248\\u672c": 9.0.0'],
  ['\\U 跳脫', '"\\U00009700要\\u7248本": 9.0.0'], ['寫在註解', '# 需要版本 9.0.0'], ['寫在值', '備註: 需要版本'],
] as const) {
  void test('§2-1 屬性區寫壞時含「需要版本」是讀不懂：' + label, () => {
    for (const broken of ['科目: [', '科目: 自然\n科目: 英文']) {
      const parsed = parseDeck('---\n' + broken + '\n' + key + '\n---\n- Q :: A');
      assert.equal(parsed.props.need, false, broken);
      assert.deepEqual({ ...parsed.props, need: null }, parseDeck('').props, broken);
    }
    // 沒有結束的屬性區（Obsidian 當成一般文字）：一直看到檔尾。
    assert.equal(parseDeck('---\n' + key + '\n- Q :: A').props.need, false);
    assert.equal(parseDeck('---\n科目: 自然\n- Q :: A\n' + key).props.need, false);
  });
}
void test('§2-1 最上層不是對照表、原文含「需要版本」是讀不懂；不含就照舊用預設值', () => {
  assert.equal(parseDeck('---\n- 需要版本\n---\n- Q :: A').props.need, false);
  assert.equal(parseDeck('---\n需要版本\n---\n- Q :: A').props.need, false);
  assert.equal(parseDeck('---\n- 不是對照表\n---\n- Q :: A').props.need, null);
});
void test('§2-1 屬性區寫壞但沒有「需要版本」四個字：照舊用預設值，跳脫拼不出來的也不算', () => {
  for (const text of ['---\n科目: [\n---\n- Q :: A', '---\n科目: 自然\n- Q :: A', '---\n科目: [\n"需要\n  版本": 9.0.0\n---', '---\n科目: [\n"需要\\\\u7248本": 9.0.0\n---', '---\n科目: [\n需要 版本: 1\n---']) {
    const parsed = parseDeck(text);
    assert.equal(parsed.props.need, null, text);
    assert.deepEqual(parsed.props, parseDeck('').props, text);
  }
  // 屬性區之後的內容不是屬性區的原文。
  assert.equal(parseDeck('---\n科目: [\n---\n- 需要版本 :: 0.6.0').props.need, null);
});

void test('三個指紋驗算值', () => {
  const nature = parseDeck(examples[0]); const english = parseDeck(examples[1]);
  assert.equal(nature.targets[0].prompts[0].fingerprint, 'c7559ebd');
  assert.equal(nature.targets[3].prompts[0].fingerprint, '66c1f2ef');
  assert.equal(english.targets[0].prompts[0].fingerprint, 'f7b07c1e');
});
void test('指紋：空白、區塊 ID、補充、資料變更不影響', () => {
  const reference = first('  - Q words :: A answer').prompts[0].fingerprint;
  for (const body of ['    - Q   words  ::  A  answer ^child', '  - Q words :: A answer\n    - extra\n  - shared', '  - 出處：p.99\n  - Q words :: A answer\n    - 重要性：高', '  - Q words :: A\n    answer']) {
    assert.equal(first(body).prompts[0].fingerprint, reference);
  }
  assert.notEqual(first('  - Q words :: different').prompts[0].fingerprint, reference);
});
void test('多行答案換符號與縮排不影響指紋', () => {
  assert.equal(first('  - Q ::\n    - A\n    - B').prompts[0].fingerprint, first('    * Q ::\n        1. A\n        2. B').prompts[0].fingerprint);
});

void test('assignIds 普通目標補齊、沿用合法 ID，第二次完全不動', () => {
  const text = '- A\n  - Q :: A\n- B ^My-Block-123\n  - Q :: A\n- 一般筆記';
  const assigned = assignIds(text, { taken: new Set(), random: () => 0 });
  assert.deepEqual(assigned.assigned, [{ line: 0, id: 'aaaaaa' }]);
  assert.equal(assigned.text, '- A ^aaaaaa\n  - Q :: A\n- B ^My-Block-123\n  - Q :: A\n- 一般筆記');
  assert.deepEqual(assignIds(assigned.text, { taken: new Set() }), { text: assigned.text, assigned: [] });
});
for (const indentation of ['    ', '\t']) for (const kind of ['qa', 'cloze']) void test('assignIds implicit ' + kind + ' ' + JSON.stringify(indentation), () => {
  const question = kind === 'qa' ? 'Q :: A' : '水溫越==高==';
  const text = '- ' + question + '\n' + indentation + '- 補充\n- 原有 ^existing\n' + indentation + '- B :: C';
  const result = assignIds(text, { taken: new Set(), random: () => 0 });
  const name = kind === 'qa' ? 'Q' : '水溫越高';
  assert.equal(result.text, '- ' + name + ' ^aaaaaa\n' + indentation + '- ' + question + '\n' + indentation + indentation + '- 補充\n- 原有 ^existing\n' + indentation + '- B :: C');
  assert.deepEqual(result.assigned, [{ line: 0, id: 'aaaaaa' }]);
  assert.deepEqual(parseDeck(result.text).targets.map(t => t.id), ['aaaaaa', 'existing']);
  assert.equal(assignIds(result.text, { taken: new Set() }).text, result.text);
});
void test('assignIds 保留 implicit 題目的舊區塊 ID，但新目標另配 ID', () => {
  const result = assignIds('- Q :: A ^question', { taken: new Set(), random: () => 0 });
  assert.equal(result.text, '- Q ^aaaaaa\n    - Q :: A ^question');
  assert.equal(parseDeck(result.text).targets[0].id, 'aaaaaa');
});
void test('assignIds implicit 的多行題目名稱接成一行，原本題目完全保留', () => {
  const result = assignIds('- Question\n  continuation :: answer', { taken: new Set(), random: () => 0 });
  assert.equal(result.text, '- Question continuation ^aaaaaa\n    - Question\n      continuation :: answer');
  const parsed = parseDeck(result.text);
  assert.equal(parsed.targets[0].id, 'aaaaaa');
  assert.equal(qa(parsed.targets[0].prompts[0]).question, 'Question\ncontinuation');
});
void test('assignIds 重複 ID、replace、taken、已有 ID 與固定 random 衝突', () => {
  const text = '- A ^same\n  - Q :: A\n- B ^same\n  - Q :: A\n- C ^replace\n  - Q :: A\n- D\n  - Q :: A\n- E ^aaaaac\n  - Q :: A';
  const parsed = parseDeck(text); assert.deepEqual(parsed.problems.map(p => p.code), ['duplicate-id']);
  const result = assignIds(text, { taken: new Set(['aaaaaa', 'aaaaab']), replace: new Set(['replace']), random: () => 0 });
  assert.deepEqual(result.assigned, [{ line: 2, id: 'aaaaad' }, { line: 4, id: 'aaaaae' }, { line: 6, id: 'aaaaaf' }]);
  const ids = parseDeck(result.text).targets.map(t => t.id);
  assert.equal(ids[0], 'same'); assert.ok(ids.every(Boolean)); assert.equal(new Set(ids).size, ids.length);
});
void test('assignIds 避開一般筆記與題目行已有的區塊 ID', () => {
  const text = '- 筆記 ^aaaaaa\n- 目標\n  - Q :: A ^aaaaab';
  assert.deepEqual(assignIds(text, { taken: new Set(), random: () => 0 }).assigned, [{ line: 1, id: 'aaaaac' }]);
});
void test('replace 中的 ID 包括第一次出現也全換', () => {
  const text = '- A ^same\n  - Q :: A\n- B ^same\n  - Q :: A';
  const result = assignIds(text, { taken: new Set(), replace: new Set(['same']), random: () => 0 });
  assert.deepEqual(parseDeck(result.text).targets.map(t => t.id), ['aaaaaa', 'aaaaab']);
});
void test('assignIds 多次插入後回報新行號', () => {
  const result = assignIds('- Q :: A\n- B :: C\n- C\n  - D :: E', { taken: new Set(), random: () => 0 });
  assert.deepEqual(result.assigned.map(v => v.line), [0, 2, 4]);
  assert.deepEqual(parseDeck(result.text).targets.map(t => t.line), [0, 2, 4]);
});
for (const eol of ['\n', '\r\n', '\r']) for (const trailing of ['', eol]) void test('assignIds 換行與檔尾 ' + JSON.stringify([eol, trailing]), () => {
  const input = ['---', '分類: 測試', '---', '- Q :: A', '- B  ', '  - Q :: A'].join(eol) + trailing;
  const result = assignIds(input, { taken: new Set(), random: () => 0 });
  assert.equal(result.text, ['---', '分類: 測試', '---', '- Q ^aaaaaa', '    - Q :: A', '- B   ^aaaaab', '  - Q :: A'].join(eol) + trailing);
  assert.equal(assignIds(result.text, { taken: new Set() }).text, result.text);
});
void test('assignIds 保留 BOM、引言與程式碼，不改已完成文字', () => {
  const text = '\uFEFF---\r\n狀態: 草稿\r\n---\r\n> - Q :: A\r\n```\r\n- X :: Y\r\n```\r\n- 目標 ^id\r\n  - Q :: A';
  assert.deepEqual(assignIds(text, { taken: new Set() }), { text, assigned: [] });
});
void test('assignIds 不處理轉錄稿與候選卡', () => {
  for (const text of ['> [!note]- 候選卡片\n> - Q :: A', '---\n來源類型: 課本\n---\n- Q :: A']) assert.equal(assignIds(text, { taken: new Set() }).text, text);
});
void test('新 ID 僅使用六碼指定字母表', () => {
  const result = assignIds('- Q :: A', { taken: new Set(), random: () => 0.999999 });
  assert.match(result.assigned[0].id, /^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
});

void test('效能：2,000 個目標，每個 3 題，200 ms 內', t => {
  const input = Array.from({ length: 2000 }, (_, i) => `- 目標 ${i} ^t${i}\n    - 類型：定義｜出處：p.${i}\n    - Q${i} :: A${i}\n    - Q${i}b :: A${i}b\n    - 值==${i}==`).join('\n');
  const start = performance.now(); const parsed = parseDeck(input); const elapsed = performance.now() - start;
  t.diagnostic('parseDeck 2000 targets / 6000 prompts: ' + elapsed.toFixed(2) + ' ms');
  assert.equal(parsed.targets.length, 2000); assert.equal(parsed.targets.reduce((sum, target) => sum + target.prompts.length, 0), 6000);
  assert.ok(elapsed < 200, '實際 ' + elapsed.toFixed(2) + ' ms');
});

void test('F1 問答題的螢光筆不留在 implicit 名稱，補 ID 後仍是原題', () => {
  const text = '- ==糖==是什麼？ :: 碳水化合物';
  assert.equal(parseDeck(text).targets[0].name, '糖是什麼？');
  const result = assignIds(text, { taken: new Set(), random: () => 0 });
  assert.equal(result.text, '- 糖是什麼？ ^aaaaaa\n    - ==糖==是什麼？ :: 碳水化合物');
  const target = parseDeck(result.text).targets[0];
  assert.equal(target.id, 'aaaaaa'); assert.equal(target.implicit, false);
  assert.deepEqual([qa(target.prompts[0]).question, qa(target.prompts[0]).answer], ['==糖==是什麼？', '碳水化合物']);
});

for (const [body, name] of [
  ['`a==b` 時 ==c== 成立', '`a==b` 時 c 成立'],
  ['$x==y$ 代表什麼？ :: 相等', '$x==y$ 代表什麼？'],
  ['$$x==y$$ 與 ==z==', '$$x==y$$ 與 z'],
  ['==  == 看看 :: x', '看看'],
]) void test('N2 implicit 名稱只去掉程式碼與公式外的填空記號：' + body, () => {
  const text = '- ' + body;
  assert.equal(parseDeck(text).targets[0].name, name);
  const target = parseDeck(assignIds(text, { taken: new Set(), random: () => 0 }).text).targets[0];
  assert.equal(target.name, name); assert.equal(target.id, 'aaaaaa'); assert.equal(target.implicit, false);
  const prompt = target.prompts[0];
  if (prompt.kind === 'qa') assert.deepEqual([prompt.question, prompt.answer], body.split(' :: '));
  else assert.equal(prompt.text, body);
});

for (const [text, name] of [['- :: 答案', ''], ['- ==  == :: x', ''], ['- ====糖====', '==糖==']]) void test('N1 空名稱或仍是題目的 implicit 原文不動、不取亂數：' + text, () => {
  const result = assignIds(text, { taken: new Set(), random: () => { throw Error('不應配 ID'); } });
  assert.deepEqual(result, { text, assigned: [] });
  const parsed = parseDeck(text);
  assert.equal(parsed.targets[0].name, name); assert.equal(parsed.targets[0].id, null);
  if (text === '- :: 答案') assert.ok(parsed.problems.some(p => p.code === 'empty-question'));
});

void test('N1 跳過 implicit 不影響其他目標的 replace、taken 與重複 ID', () => {
  const text = '- :: 答案 ^same\n- A ^same\n  - Q :: A\n- B ^same\n  - R :: B';
  const result = assignIds(text, { taken: new Set(['aaaaaa']), replace: new Set(['same']), random: () => 0 });
  assert.ok(result.text.startsWith('- :: 答案 ^same\n'));
  assert.deepEqual(result.assigned, [{ line: 1, id: 'aaaaab' }, { line: 3, id: 'aaaaac' }]);
  const parsed = parseDeck(result.text);
  assert.deepEqual(parsed.targets.map(t => t.id), [null, 'aaaaab', 'aaaaac']);
  assert.ok(parsed.problems.some(p => p.code === 'empty-question'));
});

for (const fence of ['```', '~~~~']) for (const opening of ['item', 'content']) void test('F2-1 圍欄隨清單容器結束：' + opening + ' ' + fence, () => {
  const block = opening === 'item' ? '  - ' + fence + '\n    ignored' : '    ' + fence + '\n    ignored';
  const text = '## 分組\n- 目標 ^first\n  - Q :: A\n' + block + '\n- 新目標 ^next\n  - R :: B';
  const parsed = parseDeck(text);
  assert.deepEqual(parsed.targets.map(t => [t.id, t.name, t.section]), [['first', '目標', '分組'], ['next', '新目標', '分組']]);
  assert.deepEqual(parsed.targets.map(t => t.prompts.map(p => [qa(p).question, qa(p).answer])), [[['Q', 'A']], [['R', 'B']]]);
});

for (const opening of ['  ```', '  - ```']) void test('N3 補 implicit 的 ID 不縮排後方已有 ID 的目標：' + opening, () => {
  const tail = '- 目標 ^abc234\n  - R :: B';
  const text = '- Q :: A\n' + opening + '\n    ignored\n' + tail;
  assert.deepEqual(parseDeck(text).targets.map(t => t.id), [null, 'abc234']);
  const result = assignIds(text, { taken: new Set(), random: () => 0 });
  assert.ok(result.text.endsWith('\n' + tail));
  const parsed = parseDeck(result.text);
  assert.deepEqual(parsed.targets.map(t => t.id), ['aaaaaa', 'abc234']);
  assert.deepEqual(parsed.targets.map(t => qa(t.prompts[0]).question), ['Q', 'R']);
});

void test('F2-2 題目裡的巢狀標題是接續文字，不拆目標、不改 section', () => {
  const parsed = parseDeck('## 分組\n- 目標\n  - Q :: A\n    ### 答案裡的小標題\n  - R :: B');
  assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].section, '分組');
  assert.deepEqual(parsed.targets[0].prompts.map(p => [qa(p).question, qa(p).answer]), [['Q', 'A\n### 答案裡的小標題'], ['R', 'B']]);
});

void test('F2-2 implicit 題目底下的標題補 ID 前後仍屬於原題', () => {
  const text = '## 分組\n- Q :: A\n  ### 小標題';
  const before = parseDeck(text).targets[0];
  assert.equal(before.section, '分組'); assert.equal(qa(before.prompts[0]).answer, 'A\n### 小標題');
  const after = parseDeck(assignIds(text, { taken: new Set(), random: () => 0 }).text).targets[0];
  assert.equal(after.id, 'aaaaaa'); assert.equal(after.section, '分組');
  assert.equal(qa(after.prompts[0]).answer, 'A\n### 小標題');
});

for (const [label, unit, line] of [
  ['標題', '  ', '### 小標'], ['標題', '    ', '### 小標'],
  ['引言框', '  ', '> [!note] 註記'], ['引言框', '    ', '> [!note] 註記'],
]) void test('目標內容層的' + label + '不拆目標、不改 section：' + unit.length + ' 格縮排', () => {
  const parsed = parseDeck('## 分組\n- 目標\n' + unit + '- Q :: A\n' + unit + line + '\n' + unit + '- R :: B');
  assert.deepEqual(parsed.targets.map(t => [t.name, t.section]), [['目標', '分組']]);
  assert.deepEqual(parsed.targets[0].prompts.map(p => [qa(p).question, qa(p).answer]), [['Q', 'A'], ['R', 'B']]);
});

for (const text of ['    - 假題 :: 不該排程', '\t- 假題 :: 不該排程', '段落\n    - 假題 :: 不該排程']) void test('F2-3 文件層級縮排四欄的清單符號不是目標：' + JSON.stringify(text), () => {
  assert.deepEqual(parseDeck(text).targets, []);
  assert.deepEqual(assignIds(text, { taken: new Set() }), { text, assigned: [] });
});

for (const line of ['    ```', '\t~~~', '段落\n    ```']) void test('F2-3 文件層級縮排的圍欄不吃掉後面的目標：' + JSON.stringify(line), () => {
  const parsed = parseDeck(line + '\n- 目標\n  - Q :: A');
  assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].name, '目標');
  assert.deepEqual([qa(parsed.targets[0].prompts[0]).question, qa(parsed.targets[0].prompts[0]).answer], ['Q', 'A']);
});

for (const line of ['    # 假標題', '\t## 假標題']) void test('文件層級縮排四欄的 # 不更新 section：' + JSON.stringify(line), () => {
  const parsed = parseDeck('## 分組\n' + line + '\n- 目標\n  - Q :: A');
  assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].section, '分組');
});

// D-135：閱讀模式把它顯示成目標那一行的接續文字，程式仍當子題目出題；第二部分的存檔會把縮排改回一層。
void test('D-135 清單內縮排多一層照樣當子題目出題', () => {
  const parsed = parseDeck('- 目標\n        - Q :: A');
  assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].implicit, false);
  assert.deepEqual([qa(parsed.targets[0].prompts[0]).question, qa(parsed.targets[0].prompts[0]).answer], ['Q', 'A']);
});

void test('文件層級未閉合的圍欄仍持續到檔尾', () => {
  for (const fence of ['```', '~~~']) assert.deepEqual(parseDeck(fence + '\n- 假題 :: A').targets, []);
});

// W5 §8-4、§8-7 I1：名稱那一行中間的程式格式 ID 照樣認得（D-134）；不改共用的 stripId，題目與答案的正文不受影響。
const question = '\n    - Q :: A';
const plainFingerprint = parse('- 目標' + question).targets[0].prompts[0].fingerprint;
for (const [line, id, name, code] of [
  ['- 能說明擴散 ^k3m9x2 的現象', 'k3m9x2', '能說明擴散 的現象', 'misplaced-id'],
  ['- 能說明擴散 ^k3m9x2的現象', 'k3m9x2', '能說明擴散的現象', 'misplaced-id'],
  // 後面接英數字不是候選；放在行中時不認得，放在行尾時照舊是家長自訂的區塊 ID（不截成前六碼）。
  ['- 能說明擴散 ^k3m9x2abc 的現象', null, '能說明擴散 ^k3m9x2abc 的現象', null],
  ['- 能說明擴散 ^k3m9x2abc', 'k3m9x2abc', '能說明擴散', null],
  ['- 能說明擴散 ^k3m9x2 和 ^p7q2w8', null, '能說明擴散 和', 'ambiguous-id'],
  ['- 能說明擴散 ^k3m9x2 補充 ^mine-1', null, '能說明擴散 補充', 'ambiguous-id'],
  ['- 寫法是 `^k3m9x2` 喔', null, '寫法是 `^k3m9x2` 喔', null],
  ['- 寫法是 $^k3m9x2$ 喔', null, '寫法是 $^k3m9x2$ 喔', null],
  ['- 連到 [[筆記 ^k3m9x2]] 與 [說明 ^p7q2w8](筆記.md)', null, '連到 [[筆記 ^k3m9x2]] 與 [說明 ^p7q2w8](筆記.md)', null],
  ['- 能說明擴散 ^mine-1', 'mine-1', '能說明擴散', null],
  ['- 能說明擴散 ^k3m9x2 的現象 ^k3m9x2', 'k3m9x2', '能說明擴散 的現象', 'misplaced-id'],
  ['- ^k3m9x2 能說明擴散', 'k3m9x2', '能說明擴散', 'misplaced-id'],
] as const) void test('I1 認得：' + line, () => {
  const parsed = parseDeck(line + question);
  const target = parsed.targets[0];
  assert.equal(parsed.targets.length, 1);
  assert.deepEqual([target.id, target.name], [id, name]);
  assert.deepEqual(parsed.problems.map(p => [p.code, p.level, p.line, p.targetLine]), code ? [[code, code === 'ambiguous-id' ? 'error' : 'hint', 0, 0]] : []);
  assert.equal(target.ok, code !== 'ambiguous-id');
  assert.deepEqual(target.idCandidates, code === 'ambiguous-id' ? line.match(/(?<=\^)[a-z0-9-]+/g) : undefined);
  assert.deepEqual([qa(target.prompts[0]).question, qa(target.prompts[0]).answer, target.prompts[0].fingerprint], ['Q', 'A', plainFingerprint]);
});

void test('I1 題目行與 implicit 題目裡的程式格式 ID 不是目標 ID，題目文字照 W2', () => {
  const prompt = parseDeck('- 目標' + '\n    - Q ^k3m9x2 補 :: A').targets[0];
  assert.deepEqual([prompt.id, prompt.name, qa(prompt.prompts[0]).question, prompt.idCandidates], [null, '目標', 'Q ^k3m9x2 補', undefined]);
  const implicit = parseDeck('- borrow ^k3m9x2 x :: 借入').targets[0];
  assert.deepEqual([implicit.implicit, implicit.id, implicit.name, qa(implicit.prompts[0]).question], [true, null, 'borrow ^k3m9x2 x', 'borrow ^k3m9x2 x']);
  assert.deepEqual(parseDeck('- borrow ^k3m9x2 x :: 借入').problems, []);
});

void test('I1 沒有題目的一般清單不回報 ID 的提示', () => {
  const parsed = parseDeck('- 一般筆記 ^k3m9x2 的現象\n- 另一行 ^k3m9x2 和 ^p7q2w8');
  assert.deepEqual([parsed.targets, parsed.problems], [[], []]);
});

void test('I2 歸位：行中的 ID 移回行尾，其他字一字不動，第二次不改字', () => {
  const once = assignIds('- 能說明擴散 ^k3m9x2 的現象' + question, { taken: new Set(), random: () => 0 });
  assert.deepEqual(once, { text: '- 能說明擴散 的現象 ^k3m9x2' + question, assigned: [] });
  assert.deepEqual(assignIds(once.text, { taken: new Set() }), { text: once.text, assigned: [] });
  // 已經在行尾的同一個 ID 只拿掉行中那個。
  assert.equal(assignIds('- 能說明擴散 ^k3m9x2 的現象 ^k3m9x2' + question, { taken: new Set() }).text, '- 能說明擴散 的現象 ^k3m9x2' + question);
  assert.equal(assignIds('- ^k3m9x2 能說明擴散' + question, { taken: new Set() }).text, '- 能說明擴散 ^k3m9x2' + question);
});

void test('I2 歸位保留 CRLF、BOM 與檔尾', () => {
  for (const tail of ['', '\r\n', '\r\n\r\n']) {
    const text = '﻿---\r\n科目: 自然\r\n---\r\n- 能說明擴散 ^k3m9x2的現象\r\n    - Q :: A' + tail;
    assert.equal(assignIds(text, { taken: new Set() }).text, '﻿---\r\n科目: 自然\r\n---\r\n- 能說明擴散的現象 ^k3m9x2\r\n    - Q :: A' + tail);
  }
});

void test('I2 implicit 題目裡像 ID 的字不帶進補上的名稱那一行', () => {
  const result = assignIds('- borrow ^k3m9x2 x :: 借入', { taken: new Set(), random: () => 0 });
  assert.equal(result.text, '- borrow x ^aaaaaa\n    - borrow ^k3m9x2 x :: 借入');
  assert.deepEqual(parseDeck(result.text).targets.map(t => [t.id, t.name, t.idCandidates]), [['aaaaaa', 'borrow x', undefined]]);
});

void test('I2 skip 的行一字不動，其他目標照常補與歸位', () => {
  const text = '- 能說明 A\n    - Q1 :: A1\n- 能說明擴散 ^k3m9x2 的現象\n    - Q2 :: A2\n- 能說明 B\n        - Q3 :: A3';
  const result = assignIds(text, { taken: new Set(), random: () => 0, skip: new Set([0, 2, 4]) });
  assert.deepEqual(result, { text, assigned: [] });
  const some = assignIds(text, { taken: new Set(), random: () => 0, skip: new Set([0]) });
  assert.equal(some.text, '- 能說明 A\n    - Q1 :: A1\n- 能說明擴散 的現象 ^k3m9x2\n    - Q2 :: A2\n- 能說明 B ^aaaaaa\n  - Q3 :: A3');
  assert.deepEqual(some.assigned, [{ line: 4, id: 'aaaaaa' }]);
});

void test('I2 ambiguous-id 的行不動、不配 ID；它的候選也不會配給別的目標', () => {
  const text = '- 能說明擴散 ^aaaaaa 和 ^aaaaab\n    - Q :: A\n- 新目標\n    - R :: B';
  const result = assignIds(text, { taken: new Set(), random: () => 0 });
  assert.equal(result.text, '- 能說明擴散 ^aaaaaa 和 ^aaaaab\n    - Q :: A\n- 新目標 ^aaaaac\n    - R :: B');
  assert.deepEqual(result.assigned, [{ line: 2, id: 'aaaaac' }]);
});

void test('I2 行中的 ID 和別的目標重複時換新，行中那個也拿掉', () => {
  const text = '- 目標一 ^k3m9x2\n    - Q :: A\n- 目標二 ^k3m9x2 尾巴\n    - R :: B';
  const result = assignIds(text, { taken: new Set(), random: () => 0 });
  assert.equal(result.text, '- 目標一 ^k3m9x2\n    - Q :: A\n- 目標二 尾巴 ^aaaaaa\n    - R :: B');
});

void test('I2 setTargetId：設成指定 ID、拿掉、不是目標的行回傳 null', () => {
  const ambiguous = '- 能說明擴散 ^k3m9x2 和 ^p7q2w8\r\n    - Q :: A ^child\r\n- 一般筆記\r\n';
  assert.equal(setTargetId(ambiguous, 0, 'k3m9x2'), '- 能說明擴散 和 ^k3m9x2\r\n    - Q :: A ^child\r\n- 一般筆記\r\n');
  assert.equal(setTargetId(ambiguous, 0, null), '- 能說明擴散 和\r\n    - Q :: A ^child\r\n- 一般筆記\r\n');
  assert.equal(setTargetId(ambiguous, 1, 'k3m9x2'), null);
  assert.equal(setTargetId(ambiguous, 2, 'k3m9x2'), null);
  assert.equal(setTargetId(ambiguous, 9, 'k3m9x2'), null);
  assert.equal(setTargetId('- borrow :: 借入', 0, 'k3m9x2'), null);
  assert.equal(setTargetId('- 目標 ^mine-1\n    - Q :: A', 0, 'k3m9x2'), '- 目標 ^k3m9x2\n    - Q :: A');
  assert.equal(setTargetId('- 目標\n    - Q :: A', 0, 'k3m9x2'), '- 目標 ^k3m9x2\n    - Q :: A');
  assert.throws(() => setTargetId('- 目標\n    - Q :: A', 0, 'bad id'));
  for (const text of [setTargetId(ambiguous, 0, 'k3m9x2')!, setTargetId(ambiguous, 0, null)!]) assert.deepEqual(parseDeck(text).problems, []);
});

void test('blockIds：每一行行尾的區塊 ID（題目、一般筆記、圍欄裡也算）', () => {
  assert.deepEqual([...blockIds('- 目標 ^aaaaaa\n    - Q :: A ^child\n- 一般 ^Mine-1\n文字 ^k3m9x2 中間\n```\n- 圍欄 ^fence\n```')].sort(), ['Mine-1', 'aaaaaa', 'child', 'fence']);
});

// D-135：目標底下第一層的項目比目標的內容欄多 4 欄以上時，存檔改回一層，底下的行跟著移。
void test('I2 縮排改正：多一層的題目改回一層，補充跟著移，題目、指紋與 ID 不變，第二次不改字', () => {
  const text = '- 目標 ^k3m9x2\n        - Q :: A\n            - 例句：x';
  const result = assignIds(text, { taken: new Set() });
  assert.deepEqual(result, { text: '- 目標 ^k3m9x2\n  - Q :: A\n      - 例句：x', assigned: [] });
  assert.deepEqual(parse(result.text).targets, parse(text).targets);
  assert.deepEqual(assignIds(result.text, { taken: new Set() }), { text: result.text, assigned: [] });
});

void test('I2 縮排改正：Tab 縮排照樣用 Tab', () => {
  for (const [text, expected] of [
    ['- 目標 ^k3m9x2\n\t\t- Q :: A\n\t\t\t- 例句：x', '- 目標 ^k3m9x2\n\t- Q :: A\n\t\t- 例句：x'],
    ['- 目標 ^k3m9x2\n\t\t\t- Q :: A\n\t\t\t\t- 例句：x', '- 目標 ^k3m9x2\n\t- Q :: A\n\t\t- 例句：x'],
  ]) {
    const result = assignIds(text, { taken: new Set() });
    assert.equal(result.text, expected);
    assert.deepEqual(parse(result.text).targets, parse(text).targets);
  }
});

void test('I2 縮排改正：有正常縮排的兄弟項目時對齊它，不讓後面的題目變成子項目', () => {
  const text = '- 目標 ^k3m9x2\n          - Q :: A\n    - R :: B\n    - 出處：p.1';
  const result = assignIds(text, { taken: new Set() });
  assert.equal(result.text, '- 目標 ^k3m9x2\n    - Q :: A\n    - R :: B\n    - 出處：p.1');
  assert.deepEqual(parse(result.text).targets, parse(text).targets);
});

void test('I2 縮排改正：只改有題目的明確目標底下第一層；更深的補充、skip、沒有題目的清單不動', () => {
  const deeper = '- 目標 ^k3m9x2\n    - Q :: A\n              - 很深的補充';
  assert.equal(assignIds(deeper, { taken: new Set() }).text, deeper);
  const skipped = '- 目標 ^k3m9x2\n        - Q :: A';
  assert.equal(assignIds(skipped, { taken: new Set(), skip: new Set([0]) }).text, skipped);
  const plain = '- 一般筆記\n        - 不是題目';
  assert.equal(assignIds(plain, { taken: new Set() }).text, plain);
  // 第一部分 §0-3 的 M1：補 ID 後縮排也改正。
  assert.equal(assignIds('- 目標\n        - Q :: A', { taken: new Set(), random: () => 0 }).text, '- 目標 ^aaaaaa\n  - Q :: A');
});

// after 保證在所有範例登錄後驗證，不依賴往後新增測試的位置。
after(() => {
  // tools/export-compare.ts 用：全部範例寫成一個 JSON，拿到 Obsidian 和 metadataCache 對照（W5 §0-3）。
  if (process.env.ESSENCE_DECK_CASES) writeFileSync(process.env.ESSENCE_DECK_CASES, JSON.stringify([...deckCases]));
  const fingerprints = (text: string) => parse(text).targets.flatMap(t => t.prompts.map(p => p.fingerprint)).sort();
  for (const text of deckCases) {
    const context = '往返範例：' + text.slice(0, 160);
    const before = parse(text), once = assign(text, { taken: new Set(), random: () => 0 });
    const after = parse(once.text), twice = assign(once.text, { taken: new Set(), random: () => 0 });
    assert.equal(twice.text, once.text, context + '：第二次改字');
    assert.deepEqual(twice.assigned, [], context + '：第二次重新配 ID');
    assert.equal(after.targets.length, before.targets.length, context + '：目標數改變');
    assert.deepEqual(fingerprints(once.text), fingerprints(text), context + '：題目指紋多重集合改變');
    const ids = after.targets.map(t => t.id).filter(id => id !== null);
    assert.equal(new Set(ids).size, ids.length, context + '：ID 重複');
    for (let i = 0; i < after.targets.length; i++) {
      const original = before.targets[i];
      const unsafeName = !original.name || parse('- ' + original.name).targets.length > 0;
      if (original.implicit && unsafeName) {
        assert.equal(after.targets[i].id, null, context + '：跳過的 implicit 被改動');
      } else if (original.idCandidates) {
        // ambiguous-id 不配 ID、不動，等家長選（D-134）。
        assert.deepEqual([after.targets[i].id, after.targets[i].idCandidates], [null, original.idCandidates], context + '：ambiguous-id 被改動');
      } else assert.ok(after.targets[i].id, context + '：缺少 ID');
      // 原本就有的 ID（包括行中被認得的）補 ID 之後不變。
      if (original.id && !before.targets.some((other, j) => j < i && other.id === original.id)) assert.equal(after.targets[i].id, original.id, context + '：既有 ID 改變');
      const promptContent = (prompts: Prompt[]) => prompts.map(({ line, fingerprint, ...content }) => content);
      assert.deepEqual(promptContent(after.targets[i].prompts), promptContent(before.targets[i].prompts), context + '：題目內容改變');
    }
  }
  console.log('往返驗證：' + deckCases.size + ' 份卡組範例全部通過');
});
