import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeck as parse, assignIds as assign } from '../src/core/deck/index.ts';
import type { AssignOptions, Prompt } from '../src/core/deck/index.ts';

// 每次使用公開介面的範例都登錄到同一份清單；新增測試也自動受到往返保護。
const deckCases = new Set<string>();
function parseDeck(text: string) { deckCases.add(text); return parse(text); }
function assignIds(text: string, options: AssignOptions) { deckCases.add(text); return assign(text, options); }

const syntax = readFileSync(new URL('../docs/syntax.md', import.meta.url), 'utf8');
const examples = [...syntax.slice(syntax.indexOf('### 2-2'), syntax.indexOf('### 2-3')).matchAll(/```markdown\r?\n([\s\S]*?)\r?\n```/g)].map(m => m[1]);
const emptyFields = { sources: [], type: null, importance: 'medium', paused: false, remarks: [], mistakes: [] };
const qa = (prompt: Prompt) => { assert.equal(prompt.kind, 'qa'); if (prompt.kind !== 'qa') throw Error(); return prompt; };
const cloze = (prompt: Prompt) => { assert.equal(prompt.kind, 'cloze'); if (prompt.kind !== 'cloze') throw Error(); return prompt; };
const deck = (body: string) => parseDeck('- 目標\n' + body);
const first = (body: string) => deck(body).targets[0];
const codes = (body: string) => deck(body).problems.map(p => p.code);

test('§2-2 自然完整例子：逐一核對屬性、目標、資料、題目與補充', () => {
  const parsed = parseDeck(examples[0]);
  assert.deepEqual(parsed.props, { term: '國二上', subject: '自然', unit: { code: '2-2', name: '水溶液' }, materials: ['[[國二上自然 2-2 水溶液]]'], status: 'active', categories: [], isTranscript: false });
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
    assert.equal(examples[0].split('\n')[target.line].trim(), '- ' + name + ' ^' + id);
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

test('§2-2 英文完整例子：兩方向、typed、例句與記憶錨點', () => {
  const parsed = parseDeck(examples[1]);
  assert.deepEqual(parsed.props, { term: '國二上', subject: '英文', unit: { code: 'L1', name: 'Back to School' }, materials: ['[[國二上英文 L1 Back to School]]'], status: 'active', categories: [], isTranscript: false });
  assert.deepEqual(parsed.problems, []);
  const rows = [
    ['b4rw7k', 'borrow 英翻中', 'en-zh', 'borrow', 'borrow', 'v. 借入、向別人借', ['例句：Can I borrow your pen? 我可以借你的筆嗎？'], [], null],
    ['c9tn3e', 'borrow 中翻英', 'zh-en', 'borrow', 'Can I ＿＿ your pen?（借）', 'borrow', [], ['記憶錨點：易混淆 lend（借出：把東西借給別人）'], 'borrow'],
    ['u6vf2m', 'uniform 英翻中', 'en-zh', 'uniform', 'uniform', 'n. 制服', ['例句：We wear uniforms to school. 我們穿制服上學。'], [], null],
  ];
  assert.equal(parsed.targets.length, 3);
  parsed.targets.forEach((t, i) => {
    const [id, name, direction, pairKey, question, answer, extras, shared, typed] = rows[i];
    assert.deepEqual({ ...t, line: undefined, prompts: undefined }, { id, name, direction, pairKey, section: null, fields: emptyFields, shared, implicit: false, ok: true, line: undefined, prompts: undefined });
    assert.equal(t.prompts.length, 1);
    const p = qa(t.prompts[0]);
    assert.deepEqual([p.question, p.answer, p.extras, p.typed], [question, answer, extras, typed]);
    assert.equal(examples[1].split('\n')[t.line].trim(), '- ' + name + ' ^' + id);
  });
});

test('§2-9 草稿的三個引言框都忽略', () => {
  const part = syntax.slice(syntax.indexOf('### 2-9'), syntax.indexOf('### 2-10'));
  const draft = /````markdown\r?\n([\s\S]*?)\r?\n````/.exec(part)![1];
  const parsed = parseDeck(draft);
  assert.deepEqual(parsed.targets.map(t => t.name), ['能用粒子運動說明擴散現象']);
  assert.equal(parsed.targets[0].section, '2 擴散現象');
});

for (const separator of ['::', ' :: ', ':: ', ' ::']) test('D-089 #1 冒號空白 ' + JSON.stringify(separator), () => {
  const p = qa(first('  - Q' + separator + 'A').prompts[0]);
  assert.equal(p.question, 'Q'); assert.equal(p.answer, 'A');
});
for (const literal of ['`:: ==x==`', '``a ` :: ==x==``', '$x::y==z==$','$$x::y==z==$$']) test('D-089 #2 程式碼／公式 ' + literal, () => {
  assert.equal(parseDeck('- ' + literal).targets.length, 0);
  assert.equal(qa(first('  - ' + literal + ' Q :: A').prompts[0]).question, literal + ' Q');
});
test('D-089 #2 code span 必須由相同長度的反引號關閉', () => {
  assert.equal(parseDeck('- `literal `` Q :: A').targets.length, 1);
  assert.equal(parseDeck('- ``literal ``` Q :: A ``').targets.length, 0);
});
test('D-089 #3 有 :: 的螢光筆仍是問答', () => assert.equal(first('  - ==Q== :: ==A==').prompts[0].kind, 'qa'));
test('D-089 #4 多行答案排除資料，保留子項目 Markdown', () => {
  const t = first('  - Q ::\n    - **A**\n    - 出處：p.1\n    - B\n      - nested\n    - 備註：老師強調');
  assert.equal(qa(t.prompts[0]).answer, '**A**\nB\n  - nested');
  assert.deepEqual(qa(t.prompts[0]).extras, []);
  assert.deepEqual(t.fields.sources, ['p.1']); assert.deepEqual(t.fields.remarks, ['老師強調']);
});
for (const colon of [':', '：']) test('D-089 #5 欄位冒號 ' + colon, () => assert.equal(first('  - 重要性' + colon + '高\n  - Q :: A').fields.importance, 'high'));
for (const indent of ['\t', '  ', '    ']) test('D-089 #6 縮排 ' + JSON.stringify(indent), () => {
  const t = first(indent + '- Q :: A\n' + indent + indent + '- extra');
  assert.equal(t.prompts.length, 1); assert.deepEqual(qa(t.prompts[0]).extras, ['extra']);
});
test('D-089 #6 Tab 到下一個四欄位置，並支援所有清單符號', () => {
  for (const marker of ['-', '*', '+', '1.', '1)', '12.']) {
    const p = parseDeck(marker + ' 目標\n \t- Q :: A').targets[0];
    assert.equal(p.implicit, false); assert.equal(p.prompts.length, 1);
  }
});
test('D-089 #7 Markdown 原樣保留', () => {
  const p = qa(first('  - **Q** ![[圖.png]] $x$ [[連結]] :: **A** $y$ [[答案]]').prompts[0]);
  assert.equal(p.question, '**Q** ![[圖.png]] $x$ [[連結]]'); assert.equal(p.answer, '**A** $y$ [[答案]]');
});
test('D-089 #8 fenced code、引言與其中標題都忽略', () => {
  for (const fence of ['```', '~~~~']) {
    const parsed = parseDeck('## 正確\n> # 假標題\n> - Q :: A\n' + fence + '\n# 假標題\n- Q :: A\n' + fence + '\n- 目標\n  - Q :: A');
    assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].section, '正確');
  }
});
test('D-089 #8 fenced code 的短圍欄不能提早結束', () => {
  assert.equal(parseDeck('````\n```\n- Q :: A\n````\n- B :: C').targets.length, 1);
});
test('D-089 #8 清單符號之後的程式碼圍欄也不產生卡片', () => {
  for (const fence of ['```', '~~~']) {
    const text = '- ' + fence + '\n  - 假題 :: A\n  ' + fence + '\n- 目標\n  - Q :: A\n  - ' + fence + '\n    - 假題 :: B\n    ' + fence + '\n  - R :: C';
    const parsed = parseDeck(text);
    assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].prompts.length, 2);
  }
});
test('section 保留標題文字裡的 #，只移除分隔的結尾 #', () => {
  assert.equal(parseDeck('## C#\n- Q :: A').targets[0].section, 'C#');
  assert.equal(parseDeck('## 標題 ##\n- Q :: A').targets[0].section, '標題');
});
test('D-089 #9 題目 ID 移除，目標才有 ID', () => {
  const t = parseDeck('- 目標 ^Parent-123\n  - Q :: A ^child').targets[0];
  assert.equal(t.id, 'Parent-123'); assert.equal(qa(t.prompts[0]).answer, 'A');
  assert.equal(first('  - Q :: A ^child').id, null);
});
test('D-089 #10 錯誤只影響所屬目標，問題依行號排序', () => {
  const parsed = parseDeck('- 壞\n  - :: A\n  - Q ::\n- 好\n  - Q :: A');
  assert.deepEqual(parsed.targets.map(t => t.ok), [false, true]);
  assert.deepEqual(parsed.problems.map(p => [p.line, p.targetLine, p.level]), [[1, 0, 'error'], [2, 0, 'error']]);
});
test('D-089 #11 欄位不認得使用預設值但照常排程', () => {
  const t = first('  - 重要性：很高｜狀態：不明\n  - Q :: A');
  assert.equal(t.ok, true); assert.equal(t.fields.importance, 'medium'); assert.equal(t.fields.paused, false);
  assert.deepEqual(codes('  - 重要性：很高｜狀態：不明\n  - Q :: A'), ['unknown-field-value', 'unknown-field-value']);
});
test('D-089 #12 沒題目的一般筆記不產生目標或問題', () => {
  assert.deepEqual(parseDeck('- 一般筆記\n  - 重要性：錯字').targets, []);
  assert.deepEqual(parseDeck('- 一般筆記\n  - 重要性：錯字').problems, []);
});
test('D-089 #13 typed 保留大小寫，僅清格式與頭尾空白', () => {
  const t = parseDeck('- Phrase 中翻英\n  - Q :: **Take** _a_ ==Break==').targets[0];
  assert.equal(qa(t.prompts[0]).typed, 'Take a Break'); assert.equal(t.ok, true);
});

for (const [name, input, code] of [
  ['空題目', '- 目標\n  - :: A', 'empty-question'],
  ['沒答案', '- 目標\n  - Q ::\n    - 出處：p.1', 'missing-answer'],
  ['中翻英多行', '- 字 中翻英\n  - Q ::\n    - take\n    - care', 'typed-answer-invalid'],
  ['中翻英中文', '- 字 中翻英\n  - Q :: borrow 借入', 'typed-answer-invalid'],
  ['中翻英空的格式', '- 字 中翻英\n  - Q :: ****', 'typed-answer-invalid'],
]) test('§2-10 錯誤：' + name, () => {
  const parsed = parseDeck(input); assert.equal(parsed.targets[0].ok, false); assert.ok(parsed.problems.some(p => p.code === code));
});
test('§2-10 縮排錯一層是不同結構，並非錯誤', () => {
  const parsed = deck('  - Q :: A\n  - 原本想放在題下的補充');
  assert.deepEqual(parsed.problems, []); assert.deepEqual(parsed.targets[0].shared, ['原本想放在題下的補充']);
});
test('typed 以答案文字判斷行數，只有一個答案子項目仍是單行', () => {
  const parsed = parseDeck('- 字 中翻英\n  - Q ::\n    - word');
  assert.deepEqual(parsed.problems, []); assert.equal(qa(parsed.targets[0].prompts[0]).typed, 'word');
});
test('中翻英填空只提示、不要求 typed', () => {
  const parsed = parseDeck('- 字 中翻英\n  - ==word==');
  assert.equal(parsed.targets[0].ok, true); assert.deepEqual(parsed.problems.map(p => p.code), ['cloze-not-typed']);
});
test('只有結尾完整方向字樣才配對', () => {
  assert.equal(parseDeck('- 字 中翻英 補充\n  - Q :: A').targets[0].direction, null);
});
test('欄位合併去重、單值只取首次、未知欄位忽略', () => {
  const parsed = deck('  - 出處：1-3 p.20、p.44｜備註：A、B｜錯題補強：[[考試]]\n  - 類型：定義｜重要性：低｜狀態：暫停｜陌生：X\n  - Q :: A\n    - 出處:p.44、p.45｜備註:B、C｜錯題補強:[[考試]]、[[考試2]]\n    - 類型：因果｜重要性：高｜狀態：啟用');
  assert.deepEqual(parsed.targets[0].fields, { sources: ['1-3 p.20', 'p.44', 'p.45'], type: '定義', importance: 'low', paused: true, remarks: ['A', 'B', 'C'], mistakes: ['[[考試]]', '[[考試2]]'] });
  assert.deepEqual(parsed.problems.map(p => p.code), ['unknown-field', 'duplicate-field', 'duplicate-field', 'duplicate-field']);
});
test('例句、記憶錨點不是未知資料；補充保留巢狀 Markdown', () => {
  const t = first('  - 記憶錨點：聯想\n    + 細節\n  - Q :: A\n    - 例句：hello\n      1. 子項');
  assert.deepEqual(t.shared, ['記憶錨點：聯想\n  + 細節']);
  assert.deepEqual(qa(t.prompts[0]).extras, ['例句：hello\n  1. 子項']);
});
test('接續行以換行相接，空行不結束清單，外部段落會結束', () => {
  const parsed = parseDeck('- 目標\n\n  - Q :: A\n    next\n\n筆記\n  - B :: C');
  assert.equal(qa(parsed.targets[0].prompts[0]).answer, 'A\nnext');
  assert.equal(parsed.targets.length, 2); assert.equal(parsed.targets[1].implicit, true);
});
test('接續行不會讓目標／題目行的 ID 失效', () => {
  const t = parseDeck('- 目標 ^parent\n  接續\n  - Q :: A ^child\n    next').targets[0];
  assert.equal(t.id, 'parent'); assert.equal(t.name, '目標'); assert.equal(qa(t.prompts[0]).answer, 'A\nnext');
});

for (const status of ['草稿', '啟用', '暫停']) test('YAML 狀態 ' + status, () => {
  assert.equal(parseDeck('---\n狀態: ' + status + '\n---').props.status, ({ 草稿: 'draft', 啟用: 'active', 暫停: 'paused' })[status]);
});
test('YAML 單字串或清單屬性、未知屬性、單元無空格', () => {
  const parsed = parseDeck('---\n年級學期: 國一上\n科目: 自然\n單元: 2-2\n材料: "[[教材]]"\n分類: [醫學, 睡眠]\n未知: 忽略\n---');
  assert.deepEqual(parsed.props.unit, { code: '2-2', name: '' }); assert.deepEqual(parsed.props.materials, ['[[教材]]']); assert.deepEqual(parsed.props.categories, ['醫學', '睡眠']);
  assert.deepEqual(parseDeck('---\n分類: 醫學\n---').props.categories, ['醫學']);
});
test('來源類型只要存在就是轉錄稿，全部清單不當卡組', () => {
  const parsed = parseDeck('---\n來源類型: null\n---\n- Q :: A');
  assert.equal(parsed.props.isTranscript, true); assert.deepEqual(parsed.targets, []);
});
for (const broken of ['科目: [', '科目: 自然\n科目: 英文', '- 不是對照表']) test('YAML 壞掉全部回預設 ' + broken, () => {
  const parsed = parseDeck('---\n' + broken + '\n---\n- Q :: A');
  assert.deepEqual(parsed.props, parseDeck('').props); assert.equal(parsed.problems[0].line, 0); assert.equal(parsed.problems[0].code, 'unknown-property-value');
});
test('未閉合 YAML 不洩出清單', () => assert.equal(parseDeck('---\n科目: 自然\n- Q :: A').targets.length, 0));
test('YAML 未知狀態提示位於狀態行', () => {
  const parsed = parseDeck('---\n科目: 自然\n狀態: 已採用\n---');
  assert.equal(parsed.props.status, 'active'); assert.equal(parsed.problems[0].line, 2); assert.equal(parsed.problems[0].targetLine, null);
});

test('三個指紋驗算值', () => {
  const nature = parseDeck(examples[0]); const english = parseDeck(examples[1]);
  assert.equal(nature.targets[0].prompts[0].fingerprint, 'c7559ebd');
  assert.equal(nature.targets[3].prompts[0].fingerprint, '66c1f2ef');
  assert.equal(english.targets[0].prompts[0].fingerprint, 'f7b07c1e');
});
test('指紋：空白、區塊 ID、補充、資料變更不影響', () => {
  const reference = first('  - Q words :: A answer').prompts[0].fingerprint;
  for (const body of ['    - Q   words  ::  A  answer ^child', '  - Q words :: A answer\n    - extra\n  - shared', '  - 出處：p.99\n  - Q words :: A answer\n    - 重要性：高', '  - Q words :: A\n    answer']) {
    assert.equal(first(body).prompts[0].fingerprint, reference);
  }
  assert.notEqual(first('  - Q words :: different').prompts[0].fingerprint, reference);
});
test('多行答案換符號與縮排不影響指紋', () => {
  assert.equal(first('  - Q ::\n    - A\n    - B').prompts[0].fingerprint, first('    * Q ::\n        1. A\n        2. B').prompts[0].fingerprint);
});

test('assignIds 普通目標補齊、沿用合法 ID，第二次完全不動', () => {
  const text = '- A\n  - Q :: A\n- B ^My-Block-123\n  - Q :: A\n- 一般筆記';
  const assigned = assignIds(text, { taken: new Set(), random: () => 0 });
  assert.deepEqual(assigned.assigned, [{ line: 0, id: 'aaaaaa' }]);
  assert.equal(assigned.text, '- A ^aaaaaa\n  - Q :: A\n- B ^My-Block-123\n  - Q :: A\n- 一般筆記');
  assert.deepEqual(assignIds(assigned.text, { taken: new Set() }), { text: assigned.text, assigned: [] });
});
for (const indentation of ['    ', '\t']) for (const kind of ['qa', 'cloze']) test('assignIds implicit ' + kind + ' ' + JSON.stringify(indentation), () => {
  const question = kind === 'qa' ? 'Q :: A' : '水溫越==高==';
  const text = '- ' + question + '\n' + indentation + '- 補充\n- 原有 ^existing\n' + indentation + '- B :: C';
  const result = assignIds(text, { taken: new Set(), random: () => 0 });
  const name = kind === 'qa' ? 'Q' : '水溫越高';
  assert.equal(result.text, '- ' + name + ' ^aaaaaa\n' + indentation + '- ' + question + '\n' + indentation + indentation + '- 補充\n- 原有 ^existing\n' + indentation + '- B :: C');
  assert.deepEqual(result.assigned, [{ line: 0, id: 'aaaaaa' }]);
  assert.deepEqual(parseDeck(result.text).targets.map(t => t.id), ['aaaaaa', 'existing']);
  assert.equal(assignIds(result.text, { taken: new Set() }).text, result.text);
});
test('assignIds 保留 implicit 題目的舊區塊 ID，但新目標另配 ID', () => {
  const result = assignIds('- Q :: A ^question', { taken: new Set(), random: () => 0 });
  assert.equal(result.text, '- Q ^aaaaaa\n    - Q :: A ^question');
  assert.equal(parseDeck(result.text).targets[0].id, 'aaaaaa');
});
test('assignIds implicit 的多行題目名稱接成一行，原本題目完全保留', () => {
  const result = assignIds('- Question\n  continuation :: answer', { taken: new Set(), random: () => 0 });
  assert.equal(result.text, '- Question continuation ^aaaaaa\n    - Question\n      continuation :: answer');
  const parsed = parseDeck(result.text);
  assert.equal(parsed.targets[0].id, 'aaaaaa');
  assert.equal(qa(parsed.targets[0].prompts[0]).question, 'Question\ncontinuation');
});
test('assignIds 重複 ID、replace、taken、已有 ID 與固定 random 衝突', () => {
  const text = '- A ^same\n  - Q :: A\n- B ^same\n  - Q :: A\n- C ^replace\n  - Q :: A\n- D\n  - Q :: A\n- E ^aaaaac\n  - Q :: A';
  const parsed = parseDeck(text); assert.deepEqual(parsed.problems.map(p => p.code), ['duplicate-id']);
  const result = assignIds(text, { taken: new Set(['aaaaaa', 'aaaaab']), replace: new Set(['replace']), random: () => 0 });
  assert.deepEqual(result.assigned, [{ line: 2, id: 'aaaaad' }, { line: 4, id: 'aaaaae' }, { line: 6, id: 'aaaaaf' }]);
  const ids = parseDeck(result.text).targets.map(t => t.id);
  assert.equal(ids[0], 'same'); assert.ok(ids.every(Boolean)); assert.equal(new Set(ids).size, ids.length);
});
test('assignIds 避開一般筆記與題目行已有的區塊 ID', () => {
  const text = '- 筆記 ^aaaaaa\n- 目標\n  - Q :: A ^aaaaab';
  assert.deepEqual(assignIds(text, { taken: new Set(), random: () => 0 }).assigned, [{ line: 1, id: 'aaaaac' }]);
});
test('replace 中的 ID 包括第一次出現也全換', () => {
  const text = '- A ^same\n  - Q :: A\n- B ^same\n  - Q :: A';
  const result = assignIds(text, { taken: new Set(), replace: new Set(['same']), random: () => 0 });
  assert.deepEqual(parseDeck(result.text).targets.map(t => t.id), ['aaaaaa', 'aaaaab']);
});
test('assignIds 多次插入後回報新行號', () => {
  const result = assignIds('- Q :: A\n- B :: C\n- C\n  - D :: E', { taken: new Set(), random: () => 0 });
  assert.deepEqual(result.assigned.map(v => v.line), [0, 2, 4]);
  assert.deepEqual(parseDeck(result.text).targets.map(t => t.line), [0, 2, 4]);
});
for (const eol of ['\n', '\r\n', '\r']) for (const trailing of ['', eol]) test('assignIds 換行與檔尾 ' + JSON.stringify([eol, trailing]), () => {
  const input = ['---', '分類: 測試', '---', '- Q :: A', '- B  ', '  - Q :: A'].join(eol) + trailing;
  const result = assignIds(input, { taken: new Set(), random: () => 0 });
  assert.equal(result.text, ['---', '分類: 測試', '---', '- Q ^aaaaaa', '    - Q :: A', '- B   ^aaaaab', '  - Q :: A'].join(eol) + trailing);
  assert.equal(assignIds(result.text, { taken: new Set() }).text, result.text);
});
test('assignIds 保留 BOM、引言與程式碼，不改已完成文字', () => {
  const text = '\uFEFF---\r\n狀態: 草稿\r\n---\r\n> - Q :: A\r\n```\r\n- X :: Y\r\n```\r\n- 目標 ^id\r\n  - Q :: A';
  assert.deepEqual(assignIds(text, { taken: new Set() }), { text, assigned: [] });
});
test('assignIds 不處理轉錄稿與候選卡', () => {
  for (const text of ['> [!note]- 候選卡片\n> - Q :: A', '---\n來源類型: 課本\n---\n- Q :: A']) assert.equal(assignIds(text, { taken: new Set() }).text, text);
});
test('新 ID 僅使用六碼指定字母表', () => {
  const result = assignIds('- Q :: A', { taken: new Set(), random: () => 0.999999 });
  assert.match(result.assigned[0].id, /^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
});

test('效能：2,000 個目標，每個 3 題，200 ms 內', t => {
  const input = Array.from({ length: 2000 }, (_, i) => `- 目標 ${i} ^t${i}\n    - 類型：定義｜出處：p.${i}\n    - Q${i} :: A${i}\n    - Q${i}b :: A${i}b\n    - 值==${i}==`).join('\n');
  const start = performance.now(); const parsed = parseDeck(input); const elapsed = performance.now() - start;
  t.diagnostic('parseDeck 2000 targets / 6000 prompts: ' + elapsed.toFixed(2) + ' ms');
  assert.equal(parsed.targets.length, 2000); assert.equal(parsed.targets.reduce((sum, target) => sum + target.prompts.length, 0), 6000);
  assert.ok(elapsed < 200, '實際 ' + elapsed.toFixed(2) + ' ms');
});

test('F1 問答題的螢光筆不留在 implicit 名稱，補 ID 後仍是原題', () => {
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
]) test('N2 implicit 名稱只去掉程式碼與公式外的填空記號：' + body, () => {
  const text = '- ' + body;
  assert.equal(parseDeck(text).targets[0].name, name);
  const target = parseDeck(assignIds(text, { taken: new Set(), random: () => 0 }).text).targets[0];
  assert.equal(target.name, name); assert.equal(target.id, 'aaaaaa'); assert.equal(target.implicit, false);
  const prompt = target.prompts[0];
  if (prompt.kind === 'qa') assert.deepEqual([prompt.question, prompt.answer], body.split(' :: '));
  else assert.equal(prompt.text, body);
});

for (const [text, name] of [['- :: 答案', ''], ['- ==  == :: x', ''], ['- ====糖====', '==糖==']]) test('N1 空名稱或仍是題目的 implicit 原文不動、不取亂數：' + text, () => {
  const result = assignIds(text, { taken: new Set(), random: () => { throw Error('不應配 ID'); } });
  assert.deepEqual(result, { text, assigned: [] });
  const parsed = parseDeck(text);
  assert.equal(parsed.targets[0].name, name); assert.equal(parsed.targets[0].id, null);
  if (text === '- :: 答案') assert.ok(parsed.problems.some(p => p.code === 'empty-question'));
});

test('N1 跳過 implicit 不影響其他目標的 replace、taken 與重複 ID', () => {
  const text = '- :: 答案 ^same\n- A ^same\n  - Q :: A\n- B ^same\n  - R :: B';
  const result = assignIds(text, { taken: new Set(['aaaaaa']), replace: new Set(['same']), random: () => 0 });
  assert.ok(result.text.startsWith('- :: 答案 ^same\n'));
  assert.deepEqual(result.assigned, [{ line: 1, id: 'aaaaab' }, { line: 3, id: 'aaaaac' }]);
  const parsed = parseDeck(result.text);
  assert.deepEqual(parsed.targets.map(t => t.id), [null, 'aaaaab', 'aaaaac']);
  assert.ok(parsed.problems.some(p => p.code === 'empty-question'));
});

for (const fence of ['```', '~~~~']) for (const opening of ['item', 'content']) test('F2-1 圍欄隨清單容器結束：' + opening + ' ' + fence, () => {
  const block = opening === 'item' ? '  - ' + fence + '\n    ignored' : '    ' + fence + '\n    ignored';
  const text = '## 分組\n- 目標 ^first\n  - Q :: A\n' + block + '\n- 新目標 ^next\n  - R :: B';
  const parsed = parseDeck(text);
  assert.deepEqual(parsed.targets.map(t => [t.id, t.name, t.section]), [['first', '目標', '分組'], ['next', '新目標', '分組']]);
  assert.deepEqual(parsed.targets.map(t => t.prompts.map(p => [qa(p).question, qa(p).answer])), [[['Q', 'A']], [['R', 'B']]]);
});

for (const opening of ['  ```', '  - ```']) test('N3 補 implicit 的 ID 不縮排後方已有 ID 的目標：' + opening, () => {
  const tail = '- 目標 ^abc234\n  - R :: B';
  const text = '- Q :: A\n' + opening + '\n    ignored\n' + tail;
  assert.deepEqual(parseDeck(text).targets.map(t => t.id), [null, 'abc234']);
  const result = assignIds(text, { taken: new Set(), random: () => 0 });
  assert.ok(result.text.endsWith('\n' + tail));
  const parsed = parseDeck(result.text);
  assert.deepEqual(parsed.targets.map(t => t.id), ['aaaaaa', 'abc234']);
  assert.deepEqual(parsed.targets.map(t => qa(t.prompts[0]).question), ['Q', 'R']);
});

test('F2-2 題目裡的巢狀標題是接續文字，不拆目標、不改 section', () => {
  const parsed = parseDeck('## 分組\n- 目標\n  - Q :: A\n    ### 答案裡的小標題\n  - R :: B');
  assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].section, '分組');
  assert.deepEqual(parsed.targets[0].prompts.map(p => [qa(p).question, qa(p).answer]), [['Q', 'A\n### 答案裡的小標題'], ['R', 'B']]);
});

test('F2-2 implicit 題目底下的標題補 ID 前後仍屬於原題', () => {
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
]) test('目標內容層的' + label + '不拆目標、不改 section：' + unit.length + ' 格縮排', () => {
  const parsed = parseDeck('## 分組\n- 目標\n' + unit + '- Q :: A\n' + unit + line + '\n' + unit + '- R :: B');
  assert.deepEqual(parsed.targets.map(t => [t.name, t.section]), [['目標', '分組']]);
  assert.deepEqual(parsed.targets[0].prompts.map(p => [qa(p).question, qa(p).answer]), [['Q', 'A'], ['R', 'B']]);
});

for (const text of ['    - 假題 :: 不該排程', '\t- 假題 :: 不該排程', '段落\n    - 假題 :: 不該排程']) test('F2-3 文件層級縮排四欄的清單符號不是目標：' + JSON.stringify(text), () => {
  assert.deepEqual(parseDeck(text).targets, []);
  assert.deepEqual(assignIds(text, { taken: new Set() }), { text, assigned: [] });
});

for (const line of ['    ```', '\t~~~', '段落\n    ```']) test('F2-3 文件層級縮排的圍欄不吃掉後面的目標：' + JSON.stringify(line), () => {
  const parsed = parseDeck(line + '\n- 目標\n  - Q :: A');
  assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].name, '目標');
  assert.deepEqual([qa(parsed.targets[0].prompts[0]).question, qa(parsed.targets[0].prompts[0]).answer], ['Q', 'A']);
});

for (const line of ['    # 假標題', '\t## 假標題']) test('文件層級縮排四欄的 # 不更新 section：' + JSON.stringify(line), () => {
  const parsed = parseDeck('## 分組\n' + line + '\n- 目標\n  - Q :: A');
  assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].section, '分組');
});

test('等 metadataCache 對照：清單內縮排過深仍照目前當子項目', () => {
  const parsed = parseDeck('- 目標\n        - Q :: A');
  assert.equal(parsed.targets.length, 1); assert.equal(parsed.targets[0].implicit, false);
  assert.deepEqual([qa(parsed.targets[0].prompts[0]).question, qa(parsed.targets[0].prompts[0]).answer], ['Q', 'A']);
});

test('文件層級未閉合的圍欄仍持續到檔尾', () => {
  for (const fence of ['```', '~~~']) assert.deepEqual(parseDeck(fence + '\n- 假題 :: A').targets, []);
});

// after 保證在所有範例登錄後驗證，不依賴往後新增測試的位置。
after(() => {
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
      } else assert.ok(after.targets[i].id, context + '：缺少 ID');
      const promptContent = (prompts: Prompt[]) => prompts.map(({ line, fingerprint, ...content }) => content);
      assert.deepEqual(promptContent(after.targets[i].prompts), promptContent(before.targets[i].prompts), context + '：題目內容改變');
    }
  }
  console.log('往返驗證：' + deckCases.size + ' 份卡組範例全部通過');
});
