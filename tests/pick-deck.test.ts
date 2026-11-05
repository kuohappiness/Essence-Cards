import test from 'node:test';
import assert from 'node:assert/strict';
import { assignIds, parseDeck } from '../src/core/deck/index.ts';
import type { ProblemCode } from '../src/core/deck/index.ts';

// 點選填空的卡組寫法（tasks/question-type-seam.md §3）。預期值照任務說明的表，不用同樣的算法再算一次。

const S = '盜匪躲在山＿＿裡。';
/** 一個明確目標，題目都是比較句，答案是 answer。 */
const deck = (name: string, answer: string, ...more: string[]): string => `- ${name}\n    - ${S} :: ${answer}\n${more.map(line => `    - ${line}\n`).join('')}`;
const groupOf = (text: string) => parseDeck(text).targets[0]?.group;
const codes = (text: string): ProblemCode[] => parseDeck(text).problems.map(problem => problem.code).filter(code => code.startsWith('pick-'));

void test('比較卡：正式的寫法', () => {
  assert.deepEqual(groupOf(deck('寨（寨、塞、寒、賽） 相似字', '寨')), { word: '寨', members: ['寨', '塞', '寒', '賽'], key: '["塞","寒","寨","賽"]', title: '相似字', wordKey: '寨', memberKeys: ['寨', '塞', '寒', '賽'] });
});

void test('比較卡：字和詞都可以；有頓號或逗號時，空白是項目的一部分', () => {
  const cases: [string, string, string[]][] = [
    ['borrow（borrow、lend） 比較', 'borrow', ['borrow', 'lend']],
    ['質量（質量、重量） 比較', '質量', ['質量', '重量']],
    ['make up（make up、give up） 比較', 'make up', ['make up', 'give up']],
    ['一般型（一般型、A 型、B 型） 比較', '一般型', ['一般型', 'A 型', 'B 型']],
    ['A 型（一般型、A 型、B 型） 比較', 'A 型', ['一般型', 'A 型', 'B 型']],
    ['pH 值（pH 值、酸度） 比較', 'pH 值', ['pH 值', '酸度']],
    ['主謂賓（主謂賓、主語 謂語 補語） 比較', '主謂賓', ['主謂賓', '主語 謂語 補語']],
  ];
  for (const [name, word, members] of cases) {
    const group = groupOf(deck(name, word));
    assert.equal(group?.word, word, name);
    assert.deepEqual(group?.members, members, name);
    assert.equal(group?.title, '比較', name);
  }
});

void test('比較卡：括號寬度、逗號、空白、多打的空白與分隔都容忍', () => {
  const cases: [string, string[], string][] = [
    ['寨(寨、塞、寒、賽)  相似字', ['寨', '塞', '寒', '賽'], '相似字'],
    ['寨(寨、塞） 比較', ['寨', '塞'], '比較'],
    ['寨（寨,塞，寒、賽） 相似字', ['寨', '塞', '寒', '賽'], '相似字'],
    ['寨（寨 塞 寒 賽） 相似字', ['寨', '塞', '寒', '賽'], '相似字'],
    ['寨（寨、、塞）', ['寨', '塞'], ''],
    ['寨（寨、塞、塞） 相似字', ['寨', '塞'], '相似字'],
    ['寨（寨,塞，寒 賽） 相似字', ['寨', '塞', '寒 賽'], '相似字'],
  ];
  for (const [name, members, title] of cases) {
    const group = groupOf(deck(name, '寨'));
    assert.deepEqual(group?.members, members, name);
    assert.equal(group?.title, title, name);
  }
  assert.deepEqual(groupOf(deck('borrow（borrow lend） 比較', 'borrow'))?.members, ['borrow', 'lend']);
});

void test('少打一個頓號：字鍵叫「寒 賽」，寒自己的目標不是比較卡，有提示', () => {
  const text = deck('寒（寨,塞，寒 賽） 相似字', '寒');
  assert.equal(groupOf(text), undefined);
  assert.deepEqual(codes(text), ['pick-not-recognized']);
});

void test('比較卡：粗體、中間的 ID、不切 UTF-16', () => {
  assert.equal(groupOf(deck('**寨**（寨、塞）', '寨'))?.word, '寨');
  const misplaced = parseDeck(deck('寨 ^abc222（寨、塞） 比較', '寨'));
  assert.deepEqual(misplaced.targets[0].group?.members, ['寨', '塞']);
  assert.deepEqual(misplaced.problems.map(problem => problem.code), ['misplaced-id']);
  assert.deepEqual(groupOf(deck('𠮷（𠮷、吉）', '𠮷'))?.members, ['𠮷', '吉']);
});

void test('比較卡：其他括號是義項，留在目標名稱；結尾的括號只是標題', () => {
  for (const name of ['light（輕的）（light、lit） 比較', 'light（不 重）（light、lit） 比較', 'light（不、重）（light、lit） 比較']) {
    const target = parseDeck(deck(name, 'light')).targets[0];
    assert.equal(target.group?.word, 'light', name);
    assert.deepEqual(target.group?.members, ['light', 'lit'], name);
    assert.equal(target.name, name);
  }
  assert.deepEqual(groupOf(deck('take off（take off、起飛）（take off、land） 比較', 'take off'))?.members, ['take off', 'land']);
  const titled = groupOf(deck('寨（寨、塞） 比較（進階）', '寨'));
  assert.deepEqual(titled?.members, ['寨', '塞']);
  assert.equal(titled?.title, '比較（進階）');
});

void test('比較卡：不看結尾的詞', () => {
  for (const name of ['寨（寨、塞）', '寨（寨、塞） 字形', '寨（寨、塞） 排序', '寨（寨、塞） 接句']) assert.deepEqual(groupOf(deck(name, '寨'))?.members, ['寨', '塞'], name);
  assert.deepEqual(groupOf(deck('？（？、！） 比較', '？'))?.members, ['？', '！']);
  assert.equal(groupOf(`- 台北（台北、高雄） 首都\n    - ＿＿是台灣的首都。 :: 台北\n`)?.word, '台北');
  assert.equal(groupOf(deck('寨（寨、塞、寒、賽、安、交、宇、宙） 相似字', '寨'))?.members.length, 8);
});

void test('不是比較卡，結尾是相似字、比較的才有提示', () => {
  const hinted = ['寨（寨塞寒賽） 相似字', 'make up（make up give up） 比較', '塞車 相似字', '寨（塞、寒） 相似字', '寨（寨） 相似字', 'light（輕的） 比較', 'Borrow（Borrow、ｂｏｒｒｏｗ） 比較', '寨（寨、塞）（缺右括號 比較', '寨（寨、塞））比較'];
  for (const name of hinted) {
    const text = deck(name, '寨');
    assert.equal(groupOf(text), undefined, name);
    assert.deepEqual(codes(text), ['pick-not-recognized'], name);
    assert.equal(parseDeck(text).targets[0].ok, true, name);
  }
  // 結尾整段不是相似字、比較，或前面沒有空白或右括號：沒有提示。
  for (const name of ['寨（山寨） 字形', '節（省、不浪費） 字義', '寨（塞、寒） 相似字（寨、塞）', '能依照密度進行比較', '質量比較', '這兩個字的比較']) {
    const text = deck(name, '寨');
    assert.equal(groupOf(text), undefined, name);
    assert.deepEqual(codes(text), [], name);
  }
});

void test('沒有這些字的括號照舊：字鍵不畫 Markdown，折完全半形才檢查', () => {
  for (const name of ['寨（寨、`塞`） 比較', '寨（寨、$塞） 比較', '寨（寨、[塞]） 比較', '寨（寨、<塞>） 比較', '寨（寨、［塞］） 比較', '寨（寨、＄塞） 比較']) {
    assert.equal(groupOf(deck(name, '寨')), undefined, name);
  }
});

void test('組的身分：順序不同是同一組；a（a、bc）和 ab（ab、c）不同組', () => {
  assert.equal(groupOf(deck('寨（寨、塞） 比較', '寨'))?.key, groupOf(deck('寨（塞、寨） 比較', '寨'))?.key);
  assert.equal(groupOf(deck('Borrow（BORROW、ｌｅｎｄ） 比較', 'borrow'))?.key, '["borrow","lend"]');
  assert.notEqual(groupOf(deck('a（a、bc） 比較', 'a'))?.key, groupOf(deck('ab（ab、c） 比較', 'ab'))?.key);
});

void test('答案比對用正規化：句首的大寫、前後空白、粗體；帶標點的算組外', () => {
  assert.equal(groupOf(deck('borrow（borrow、lend） 比較', 'Borrow'))?.word, 'borrow');
  assert.equal(groupOf(deck('寨（寨、塞） 比較', '**寨**'))?.word, '寨');
  assert.equal(groupOf(deck('寨（寨、塞） 比較', '寨。')), undefined);
  assert.deepEqual(codes(deck('寨（寨、塞） 比較', '寨。')), ['pick-not-recognized']);
  // ① 和 1 不同：不做整串 NFKC。
  assert.equal(groupOf(deck('①（①、②） 比較', '1')), undefined);
});

void test('判斷的順序：最上層寫題目、名稱有 == 或空格，照原題型', () => {
  const top = parseDeck('- 寨（寨、塞） 山＿＿ :: 寨\n');
  assert.equal(top.targets[0].implicit, true);
  assert.equal(top.targets[0].group, undefined);
  assert.deepEqual(codes('- 寨（寨、塞） 山＿＿ :: 寨\n'), []);
  // 補 ID 前後結果相同。
  const filled = assignIds('- 寨（寨、塞） 山＿＿ :: 寨\n', { taken: new Set(), random: () => 0.5 }).text;
  assert.equal(parseDeck(filled).targets[0].implicit, false);
  assert.equal(parseDeck(filled).targets[0].group, undefined);
  assert.deepEqual(codes(filled), []);

  const cloze = '- ==寨==（寨、塞） 相似字\n    - 山＿＿ :: 寨\n';
  assert.equal(parseDeck(cloze).targets[0].implicit, true);
  assert.equal(parseDeck(cloze).targets[0].group, undefined);
  assert.deepEqual(codes(cloze), []);
  // 沒有空格的隱式問答補 ID 後，題目仍然沒有空格，落在表的最後一列。
  const plain = '- 寨（寨、塞） 字形 :: 寨\n';
  assert.equal(parseDeck(plain).targets[0].group, undefined);
  const plainFilled = assignIds(plain, { taken: new Set(), random: () => 0.5 }).text;
  assert.equal(parseDeck(plainFilled).targets[0].group, undefined);
  assert.deepEqual(codes(plainFilled), []);
});

void test('判斷的順序：中翻英、英翻中優先，前面的空白半形全形都算', () => {
  const half = parseDeck('- borrow（borrow、lend） 中翻英\n    - 借入＿＿ :: borrow\n').targets[0];
  assert.equal(half.direction, 'zh-en');
  assert.equal(half.group, undefined);
  assert.equal(half.pairKey, 'borrow（borrow、lend）');
  const full = parseDeck('- borrow（borrow、lend）　中翻英\n    - 借入＿＿ :: borrow\n').targets[0];
  assert.equal(full.direction, 'zh-en');
  assert.equal(full.pairKey, 'borrow（borrow、lend）');
  const english = parseDeck('- borrow　英翻中\n    - borrow :: 借\n').targets[0];
  assert.equal(english.direction, 'en-zh');
  assert.equal(english.pairKey, 'borrow');
});

void test('pairKey 不留尾端空白，兩個空白也配得上', () => {
  const targets = parseDeck('- borrow  中翻英\n    - 借 :: borrow\n- borrow 英翻中\n    - borrow :: 借\n').targets;
  assert.equal(targets[0].pairKey, 'borrow');
  assert.equal(targets[1].pairKey, 'borrow');
});

void test('全形空白的中翻英，答案不能比對時和半形相同', () => {
  const half = parseDeck('- 能看出中文語序 中翻英\n    - 題目 :: 這不是英文\n');
  const full = parseDeck('- 能看出中文語序　中翻英\n    - 題目 :: 這不是英文\n');
  assert.deepEqual(full.problems.map(problem => [problem.line, problem.code, problem.level]), [[1, 'typed-answer-invalid', 'error']]);
  assert.deepEqual(full.problems.map(problem => problem.code), half.problems.map(problem => problem.code));
  assert.equal(full.targets[0].ok, false);
});

void test('判斷的順序：每一題都是填空不是比較卡', () => {
  const poem = '- 鳥鳴澗（甲、乙） 接句\n    - 人閒==桂花==落\n';
  assert.equal(groupOf(poem), undefined);
  assert.deepEqual(codes(poem), []);
  assert.equal(parseDeck(poem).targets[0].prompts[0].kind, 'cloze');
  const hinted = '- 寨（寨、塞） 比較\n    - 山==寨==\n';
  assert.equal(groupOf(hinted), undefined);
  assert.deepEqual(codes(hinted), ['pick-not-recognized']);
  // 問答和填空混在一起：進表。
  const mixed = '- 寨（寨、塞） 比較\n    - 山==寨==\n    - 山＿＿ :: 寨\n';
  assert.equal(groupOf(mixed), undefined);
  assert.deepEqual(parseDeck(mixed).problems.map(problem => [problem.line, problem.code]), [[1, 'pick-mixed']]);
});

void test('表：有一般語法錯誤時照原來的錯誤，不往下判', () => {
  const text = '- 寨（寨、塞） 比較\n    - 山＿＿ ::\n    - 水＿＿ :: 塞\n';
  const { targets, problems } = parseDeck(text);
  assert.deepEqual(problems.map(problem => [problem.line, problem.code]), [[1, 'missing-answer']]);
  assert.equal(targets[0].ok, false);
  assert.equal(targets[0].group, undefined);
});

void test('表：答案是組裡別的字是 pick-answer-invalid，定位到每一個，跳過這個目標', () => {
  const text = '- 寨（寨、塞） 比較\n    - 下班時間大＿＿車。 :: 塞\n    - 山＿＿ :: 寨\n    - 水管＿＿住了。 :: 塞\n';
  const { targets, problems } = parseDeck(text);
  assert.deepEqual(problems.map(problem => [problem.line, problem.level, problem.code]), [[1, 'error', 'pick-answer-invalid'], [3, 'error', 'pick-answer-invalid']]);
  assert.equal(targets[0].ok, false);
  assert.equal(targets[0].group, undefined);
});

void test('表：混了別的照原題型，hint pick-mixed，按題指出', () => {
  const text = '- 寨（寨、塞）\n    - 山＿＿ :: 寨\n    - 沒有空格 :: 寨\n    - 兩格＿＿和＿＿ :: 寨\n    - 山==寨==\n    - 多行＿＿ ::\n        - 第一行\n        - 第二行\n    - 組外＿＿ :: 村\n';
  const { targets, problems } = parseDeck(text);
  assert.equal(targets[0].group, undefined);
  assert.equal(targets[0].ok, true);
  assert.deepEqual(problems.map(problem => [problem.line, problem.level, problem.code]), [[2, 'hint', 'pick-mixed'], [3, 'hint', 'pick-mixed'], [4, 'hint', 'pick-mixed'], [5, 'hint', 'pick-mixed'], [8, 'hint', 'pick-mixed']]);
});

void test('表：沒有一題是答案為名稱字詞的比較句', () => {
  // 沒有結尾或結尾是別的詞：沒有提示，看不出家長想做比較卡。
  const capital = '- 台北（台北、高雄） 首都\n    - 台灣的首都？ :: 台北\n';
  assert.equal(groupOf(capital), undefined);
  assert.deepEqual(parseDeck(capital).problems, []);
  // 結尾是比較：指出組外的答案。
  const outside = parseDeck('- 寨（寨、塞） 比較\n    - 這是＿＿。 :: 村\n');
  assert.deepEqual(outside.problems.map(problem => [problem.line, problem.level, problem.code]), [[1, 'hint', 'pick-not-recognized']]);
  assert.match(outside.problems[0].message, /組/);
  // 沒有空格：提示在目標那一行，寫出是沒有空格。
  const blankless = parseDeck('- 寨（寨、塞） 比較\n    - 這是什麼？ :: 寨\n');
  assert.deepEqual(blankless.problems.map(problem => [problem.line, problem.code]), [[0, 'pick-not-recognized']]);
  assert.match(blankless.problems[0].message, /空格/);
});

void test('提示寫出原因：括號、名稱不在組裡', () => {
  const message = (name: string): string => parseDeck(deck(name, '寨')).problems[0].message;
  assert.match(message('寨（寨塞寒賽） 相似字'), /頓號/);
  assert.match(message('塞車 相似字'), /頓號/);
  assert.match(message('寨（塞、寒） 相似字'), /名稱/);
});

void test('空格怎麼數：連續的算一格，受保護的內容不看', () => {
  const pick = (question: string): boolean => groupOf(`- 寨（寨、塞）\n    - ${question} :: 寨\n`) !== undefined;
  for (const question of ['山＿', '山＿＿', '[山＿＿](http://a.b/c)', '[[筆記|山＿]]', '山&#65343;', '山&#xFF3F;', '山&#xff3f;&#65343;', '山 `＿` 的＿', '$＿$ 的＿＿', '![底線＿](圖＿片.png) 山＿', '![[筆記＿]] 山＿', '%%＿%% 山＿', '<span title="＿">山</span>＿', '**山＿＿**', '[山](http://a/＿)＿']) {
    assert.equal(pick(question), true, question);
  }
  for (const question of ['山', '山__', '＿ ＿', '＿**＿**', '`＿`', '$＿$', '![底線＿](圖＿片.png)', '![[筆記＿]]', '%%＿%%', '[山](http://a/＿)', '<span title="＿">山</span>', '＿[＿](x)']) {
    assert.equal(pick(question), false, question);
  }
});

void test('一個子項目的答案是單行；兩個子項目是多行', () => {
  assert.equal(groupOf('- 寨（寨、塞）\n    - 山＿＿ ::\n        - 寨\n')?.word, '寨');
  assert.equal(groupOf('- 寨（寨、塞）\n    - 山＿＿ ::\n        - 寨\n        - 塞\n'), undefined);
});

void test('group 是選填的：一般目標的 deepEqual 不用改，指紋不變', () => {
  const plain = parseDeck('- 光合作用 ^abc222\n    - 什麼是光合作用 :: 植物製造養分\n').targets[0];
  assert.equal(Object.hasOwn(plain, 'group'), false);
  const compare = parseDeck('- 寨（寨、塞） 比較\n    - 山＿＿ :: 寨\n').targets[0];
  const asPlain = parseDeck('- 另一個名稱\n    - 山＿＿ :: 寨\n').targets[0];
  assert.equal(compare.prompts[0].fingerprint, asPlain.prompts[0].fingerprint);
  assert.equal(compare.prompts[0].kind === 'qa' ? compare.prompts[0].typed : 'x', null);
});

void test('補 ID 前後結果相同', () => {
  const names = ['寨（寨、塞） 比較', '寨（寨、塞）', '寨（塞、寒） 相似字', '台北（台北、高雄） 首都', 'borrow（borrow、lend）　中翻英'];
  for (const name of names) {
    const text = deck(name, name.startsWith('寨') ? '寨' : name.startsWith('台') ? '台北' : 'borrow');
    const filled = assignIds(text, { taken: new Set(), random: () => 0.5 }).text;
    const [before, after] = [parseDeck(text), parseDeck(filled)];
    assert.deepEqual(after.targets[0].group, before.targets[0].group, name);
    assert.deepEqual(after.problems.map(problem => problem.code), before.problems.map(problem => problem.code), name);
  }
});
