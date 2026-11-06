import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, editQuiz, isExamPath, isQuizFile, newQuizText, parseExamFile, parseQuiz, QUIZ_FOLDER, quizFileName, quizLine, quizRows, scopeDay } from '../src/core/catalog/index.ts';
import type { QuizResolved, QuizRow } from '../src/core/catalog/index.ts';
import { parseDeck } from '../src/core/deck/index.ts';

// 小考檔的格式與讀法（tasks/quiz-mark.md §1，例子來自格式查核回報第 4、5、6 點）：只有純函式，接上 state 的在 quiz-state.test.ts。

const FOLDER = QUIZ_FOLDER + '/';
const quiz = (date: string, line = '- 國二上 英文 L3', id = 'q4m8t2', extra = ''): string => `---\n識別碼: ${id}\n小考日期: ${date}\n${extra}---\n${line}\n`;
const deckHead = (term: string, subject: string, unit: string, extra = ''): string => `---\n年級學期: ${term}\n科目: ${subject}\n單元: "${unit}"\n${extra}---\n`;
const targets = (...ids: string[]): string => ids.map(id => `- 目標 ${id} ^${id}\n    - ${id} 的題目 :: 答\n`).join('');
const WORDS = 'Essence Cards/學業/國二上英文 L3 單字.md', GRAMMAR = 'Essence Cards/學業/國二上英文 L3 文法.md';
const DECKS: Record<string, string> = {
  [WORDS]: deckHead('國二上', '英文', 'L3 Vocabulary') + targets('w1', 'w2', 'w3'),
  [GRAMMAR]: deckHead('國二上', '英文', 'L3 Vocabulary') + targets('g1'),
};
const decks = Object.entries(DECKS).map(([path, text]) => ({ path, deck: parseDeck(text) }));
const index = buildIndex(decks);
const DAY = scopeDay('2026-11-05');
/** 完整路徑或檔名：只在指向一篇時接受（真的解析在 Obsidian，§1 的連結例子在開發命令跑）。 */
function resolve(link: string): QuizResolved {
  const hits = Object.keys(DECKS).filter(path => path === link + '.md' || path.endsWith('/' + link + '.md'));
  return hits.length === 1 ? { kind: 'file', path: hits[0] } : hits.length ? { kind: 'several' } : { kind: 'none' };
}
const known = (path: string): { subject: string | null } | null => { const deck = decks.find(each => each.path === path); return deck ? { subject: deck.deck.props.subject } : null; };
const rows = (files: Record<string, string>, day = DAY): QuizRow[] => quizRows(Object.entries(files).map(([name, text]) => ({ path: FOLDER + name, file: parseQuiz(text) })), { day, index, known, resolve });
const only = (files: Record<string, string>, day = DAY): QuizRow => { const list = rows(files, day); assert.equal(list.length, 1, JSON.stringify(list)); return list[0]; };

// ── 位置 ──

void test('§1 小考檔的位置：考試範圍/小考/ 底下的 Markdown；段考不讀，小考不讀段考的', () => {
  assert.equal(isQuizFile(FOLDER + '2026-11-05 小考.md'), true);
  assert.equal(isQuizFile(FOLDER + '舊的/2026-11-05 小考.md'), true);
  assert.equal(isQuizFile(FOLDER + '圖.png'), false);
  assert.equal(isQuizFile('Essence Cards/考試範圍/2026-10-28 國二上.md'), false);
  assert.equal(isQuizFile('Essence Cards/考試範圍/小考備份/x.md'), false);
  assert.equal(isExamPath(FOLDER + '2026-11-05 小考.md'), false);
  assert.equal(parseExamFile(quiz('2026-11-05')), null);
});

// ── 日期 ──

void test('§1 日期照 §4 的寫法：全形、三種分隔符、單位數月日、數字型都正規化', () => {
  for (const written of ['2026-11-05', '2026/11/5', '2026.11.05', '20261105', '２０２６－１１－０５', '"2026-11-5"']) {
    assert.deepEqual(parseQuiz(quiz(written)).date, { kind: 'ok', date: '2026-11-05' }, written);
  }
  assert.deepEqual(parseQuiz(quiz('2028-02-29')).date, { kind: 'ok', date: '2028-02-29' }, '閏日');
});

void test('§1 日期有問題走待修正，不失效也不猜：缺、空、錯字、不存在的日子、民國年、未關的 YAML', () => {
  const noDate = '---\n識別碼: q4m8t2\n---\n- 國二上 英文 L3\n';
  const cases: Record<string, string> = {
    缺日期: noDate,
    空值: quiz(''),
    錯字: quiz('11/5'),
    非閏年: quiz('2026-02-29'),
    民國: quiz('115-11-05'),
    布林: quiz('true'),
    沒收的屬性區: '---\n識別碼: q4m8t2\n小考日期: 2026-11-05\n- 國二上 英文 L3\n',
    YAML壞掉: '---\n識別碼: q4m8t2\n小考日期: [2026\n---\n- 國二上 英文 L3\n',
    沒有屬性區: '- 國二上 英文 L3\n',
    空檔: '',
  };
  for (const [name, text] of Object.entries(cases)) {
    const row = only({ 'a.md': text }, DAY + 100);
    assert.equal(row.problem, 'date', name);
    assert.equal(row.date, null, name);
    assert.deepEqual(row.paths, [FOLDER + 'a.md'], name);
    assert.equal(row.count, 0, name);
  }
  assert.equal(parseQuiz(cases.沒收的屬性區).broken, true);
  assert.equal(parseQuiz(cases.沒收的屬性區).id, 'q4m8t2', '壞掉時看得出來的識別碼照算');
});

void test('§1 生效：小考日前與當天都在，隔天就不在（清晨 4 點換日由 dayOf 算，邊界在 quiz-state）', () => {
  const files = { 'a.md': quiz('2026-11-05') };
  assert.equal(only(files, DAY - 1).date, '2026-11-05');
  assert.equal(only(files, DAY).problem, null);
  assert.deepEqual(rows(files, DAY + 1), []);
});

void test('§1 改日期不改檔名：以屬性為準', () => {
  const row = only({ '2026-11-01 小考.md': quiz('2026-11-07') });
  assert.equal(row.date, '2026-11-07');
  assert.deepEqual(rows({ '2026-11-09 小考.md': quiz('2026-11-01') }), [], '檔名是之後的日子，屬性過了就失效');
});

// ── 內文 ──

void test('§1 內文恰好一個非空白的行：結尾換行與空白行略過', () => {
  for (const text of [quiz('2026-11-05'), quiz('2026-11-05', '\n\n- 國二上 英文 L3\n\n'), quiz('2026-11-05', '國二上 英文 L3'), '---\r\n識別碼: q4m8t2\r\n小考日期: 2026-11-05\r\n---\r\n- 國二上 英文 L3\r\n']) {
    const row = only({ 'a.md': text });
    assert.equal(row.problem, null, JSON.stringify(text));
    assert.deepEqual(row.refs, [{ unit: index.units[0].key }]);
    assert.equal(row.count, 4);
    assert.equal(row.subject, '英文');
    assert.equal(row.name, 'L3 Vocabulary');
  }
});

void test('§1 寫法有問題：只有空白、多一個標題、第二項、單元和連結混寫、單元範圍、分類', () => {
  const link = `[[${WORDS.replace(/\.md$/, '')}]]`;
  const cases: Record<string, string> = {
    只有空白: '  \n\n',
    只有標題: '# 小考',
    多一個標題: '# 小考\n- 國二上 英文 L3',
    第二項: '- 國二上 英文 L3\n- 國二上 英文 L4',
    混寫兩行: `- 國二上 英文 L3\n- ${link}`,
    混寫一行: `- 國二上 英文 L3 ${link}`,
    兩個連結: `- ${link} ${link}`,
    嵌入: `- !${link}`,
    單元範圍: '- 國二上 英文 L1～L3',
    好幾項: '- 國二上 英文 L1、L2',
    分類: '- 分類：醫學',
    一句話: '老師說下週考',
  };
  for (const [name, line] of Object.entries(cases)) {
    const row = only({ 'a.md': quiz('2026-11-05', line) });
    assert.equal(row.problem, 'body', name);
    assert.equal(row.count, 0, name);
  }
});

void test('§1 格式合法但對不到卡組和寫法有問題分開', () => {
  const row = only({ 'a.md': quiz('2026-11-05', '- 國二上 英文 L9') });
  assert.equal(row.problem, 'unmatched');
  assert.equal(row.count, 0);
  assert.deepEqual(row.refs, []);
  assert.equal(row.subject, '英文');
  assert.equal(row.name, '國二上 L9');
  assert.equal(only({ 'a.md': quiz('2026-11-05', '- 國二上 英文 L') }).problem, 'unmatched', '編號對不到就是對不到');
});

void test('§1 單元用正規化後的三欄比：全形、大小寫、學期別名', () => {
  for (const line of ['- 八上 英文 L3', '- 國二上 英文 l3', '- 國二上　英文　Ｌ３', '- 國二上 英文 L 3', '- 國二上 英文 L3 Vocabulary']) {
    const row = only({ 'a.md': quiz('2026-11-05', line) });
    assert.equal(row.problem, null, line);
    assert.deepEqual(row.refs, [{ unit: index.units[0].key }], line);
  }
});

// ── 單篇 ──

void test('§1 單篇：完整路徑、檔名、別名都指向那一篇；只練那一篇的數字', () => {
  const name = WORDS.slice(WORDS.lastIndexOf('/') + 1).replace(/\.md$/, '');
  for (const line of [`- [[${WORDS.replace(/\.md$/, '')}]]`, `[[${name}]]`, `- [[${name}|單字]]`, `- [[${name}#第一段]]`, `- [ ] [[${name}]]`, `- [[${name}]]，`]) {
    const row = only({ 'a.md': quiz('2026-11-05', line) });
    assert.equal(row.problem, null, line);
    assert.deepEqual(row.refs, [{ deck: WORDS }], line);
    assert.equal(row.count, 3, line);
    assert.equal(row.name, name, line);
    assert.equal(row.subject, '英文', line);
  }
});

void test('§1 找不到那一篇不退回整個單元；重名走待修正；連到卡組以外的筆記也是找不到', () => {
  const missing = only({ 'a.md': quiz('2026-11-05', '- [[舊的名字]]') });
  assert.equal(missing.problem, 'missing');
  assert.equal(missing.count, 0);
  assert.deepEqual(missing.refs, []);
  assert.equal(missing.name, '舊的名字');
  const several = quizRows([{ path: FOLDER + 'a.md', file: parseQuiz(quiz('2026-11-05', '- [[同名]]')) }], { day: DAY, index, known, resolve: () => ({ kind: 'several' }) });
  assert.equal(several[0].problem, 'several');
  const outside = quizRows([{ path: FOLDER + 'a.md', file: parseQuiz(quiz('2026-11-05', '- [[筆記]]')) }], { day: DAY, index, known, resolve: () => ({ kind: 'file', path: '別的資料夾/筆記.md' }) });
  assert.equal(outside[0].problem, 'missing');
});

void test('§1 連結傳進解析的是這份檔的路徑（相對路徑要用）', () => {
  const seen: [string, string][] = [];
  quizRows([{ path: FOLDER + 'a.md', file: parseQuiz(quiz('2026-11-05', '- [[../英文/單字]]')) }], { day: DAY, index, known, resolve: (link, from) => { seen.push([link, from]); return { kind: 'none' }; } });
  assert.deepEqual(seen, [['../英文/單字', FOLDER + 'a.md']]);
});

// ── 副本（同一個識別碼）──

void test('§1 取消看整組：任何一份有 取消 這個鍵，值是空的或寫錯也算', () => {
  for (const value of ['2026-11-04', '', '昨天']) {
    assert.deepEqual(rows({ 'a.md': quiz('2026-11-05'), 'b.md': quiz('2026-11-05', undefined, undefined, `取消: ${value}\n`) }), [], value);
  }
});

void test('§1 取消蓋過晚到的舊副本：輸入順序換過結果不變', () => {
  const old = { path: FOLDER + 'a 2.md', file: parseQuiz(quiz('2026-11-05')) };
  const cancelled = { path: FOLDER + 'a.md', file: parseQuiz(quiz('2026-11-05', undefined, undefined, '取消: 2026-11-04\n')) };
  const context = { day: DAY, index, known, resolve };
  assert.deepEqual(quizRows([old, cancelled], context), []);
  assert.deepEqual(quizRows([cancelled, old], context), []);
});

void test('§1 取消和壞日期並存：整組取消；屬性區壞到讀不出來的不從字串猜取消', () => {
  assert.deepEqual(rows({ 'a.md': quiz('11/5', undefined, undefined, '取消: 2026-11-04\n') }), [], '同一份：有 取消 就是取消了');
  assert.deepEqual(rows({ 'a.md': quiz('11/5'), 'b.md': quiz('2026-11-05', undefined, undefined, '取消: 2026-11-04\n') }), [], '兩份：壞日期的那一份跟著取消');
  const broken = '---\n識別碼: q4m8t2\n小考日期: [2026\n取消: 2026-11-04\n---\n- 國二上 英文 L3\n';
  assert.equal(only({ 'a.md': broken }).problem, 'date');
  assert.deepEqual(rows({ 'a.md': broken, 'b.md': quiz('2026-11-05', undefined, undefined, '取消: 2026-11-04\n') }), [], '別份讀得到取消：壞掉的看得出識別碼，一起取消');
});

void test('§1 同一個識別碼、內容一樣的兩份：一列，兩份都記下', () => {
  const row = only({ 'a.md': quiz('2026-11-05'), 'a 2.md': quiz('2026/11/5', '- 八上 英文 l3') });
  assert.equal(row.problem, null);
  assert.deepEqual(row.paths, [FOLDER + 'a 2.md', FOLDER + 'a.md']);
});

void test('§1 同一個識別碼、日期或目標不一樣：待修正，不自己挑；11/5 與 11/7 在 11/6 清晨 4 點也一樣', () => {
  const files = { 'a.md': quiz('2026-11-05'), 'b.md': quiz('2026-11-07') };
  const row = only(files);
  assert.equal(row.problem, 'copies');
  assert.equal(row.date, null);
  assert.deepEqual(row.paths, [FOLDER + 'a.md', FOLDER + 'b.md']);
  assert.equal(only(files, DAY + 1).problem, 'copies', '11/5 那份過了，也不換成 11/7');
  assert.deepEqual(rows(files, DAY + 3), [], '兩份都過了就不用修');
  const target = only({ 'a.md': quiz('2026-11-05'), 'b.md': quiz('2026-11-05', '- 國二上 英文 L4') });
  assert.equal(target.problem, 'copies');
  assert.deepEqual(target.refs, [{ unit: index.units[0].key }], '目錄的按鈕找得到這一組');
});

void test('§1 同一個識別碼、連結不同字但指向同一篇：一樣', () => {
  const name = WORDS.slice(WORDS.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const row = only({ 'a.md': quiz('2026-11-05', `- [[${name}]]`), 'b.md': quiz('2026-11-05', `- [[${WORDS.replace(/\.md$/, '')}]]`) });
  assert.equal(row.problem, null);
});

void test('§1 手寫沒有識別碼：各算一份小考', () => {
  const noId = (date: string): string => `---\n小考日期: ${date}\n---\n- 國二上 英文 L3\n`;
  const row = only({ 'a.md': noId('2026-11-07'), 'b.md': noId('2026-11-05') });
  assert.equal(row.date, '2026-11-05', '不算副本，是同一個目標的兩份小考');
  assert.equal(row.id, null);
  assert.deepEqual(row.paths, [FOLDER + 'b.md']);
  assert.equal(only({ 'a.md': noId('2026-11-05'), 'b.md': noId('2026-11-05') + '' }).id, null);
  assert.equal(rows({ 'a.md': '---\n小考日期: 2026-11-05\n取消:\n---\n- 國二上 英文 L3\n', 'b.md': noId('2026-11-05') }).length, 1, '沒有識別碼：取消只算那一份');
});

// ── 不同識別碼 ──

void test('§1 不同識別碼、同一個目標：用日期早的，一樣早的照路徑，輸入順序換過結果不變', () => {
  const early = { path: FOLDER + 'z.md', file: parseQuiz(quiz('2026-11-05', undefined, 'aaaaa1')) };
  const late = { path: FOLDER + 'a.md', file: parseQuiz(quiz('2026-11-07', undefined, 'aaaaa2')) };
  const same = { path: FOLDER + 'y.md', file: parseQuiz(quiz('2026-11-05', undefined, 'aaaaa3')) };
  const context = { day: DAY, index, known, resolve };
  for (const list of [[early, late, same], [same, late, early], [late, same, early]]) {
    const result = quizRows(list, context);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].paths, [same.path]);
  }
  // 早的過了，晚的接手；取消的不算。
  assert.deepEqual(quizRows([early, late], { ...context, day: DAY + 1 }).map(row => row.date), ['2026-11-07']);
  const cancelled = { path: FOLDER + 'z.md', file: parseQuiz(quiz('2026-11-05', undefined, 'aaaaa1', '取消: 2026-11-04\n')) };
  assert.deepEqual(quizRows([cancelled, late], context).map(row => row.date), ['2026-11-07']);
});

void test('§1 單元用正規化後的三欄比、單篇用解析後的卡組比', () => {
  const unit = rows({ 'a.md': quiz('2026-11-05', '- 八上 英文 l3', 'aaaaa1'), 'b.md': quiz('2026-11-06', '- 國二上 英文 L3', 'aaaaa2') });
  assert.deepEqual(unit.map(row => row.date), ['2026-11-05']);
  const name = WORDS.slice(WORDS.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const deck = rows({ 'a.md': quiz('2026-11-06', `- [[${name}]]`, 'aaaaa1'), 'b.md': quiz('2026-11-05', `- [[${WORDS.replace(/\.md$/, '')}]]`, 'aaaaa2') });
  assert.deepEqual(deck.map(row => row.date), ['2026-11-05']);
  const both = rows({ 'a.md': quiz('2026-11-05', undefined, 'aaaaa1'), 'b.md': quiz('2026-11-05', `- [[${name}]]`, 'aaaaa2') });
  assert.equal(both.length, 2, '單元和單篇是不同的目標');
});

void test('§1 同一個目標一份日期壞掉、一份正常：正常的照樣可以練，壞的照樣看得到', () => {
  const list = rows({ 'a.md': quiz('11/5', undefined, 'aaaaa1'), 'b.md': quiz('2026-11-07', undefined, 'aaaaa2') });
  assert.deepEqual(list.map(row => row.problem), [null, 'date']);
  assert.equal(list[0].count, 4);
  assert.deepEqual(list[1].refs, [{ unit: index.units[0].key }], '目錄的按鈕也找得到壞的那一份');
});

void test('§4 好幾個小考照日期、科目、名稱排；待修正沒有日期的排在最後', () => {
  const nature = buildIndex([...decks, { path: 'Essence Cards/自然.md', deck: parseDeck(deckHead('國二上', '自然', '2-1') + targets('n1')) }]);
  const entries = [
    { path: FOLDER + 'd.md', file: parseQuiz(quiz('2026-11-06', '- 國二上 英文 L3', 'aaaaa1')) },
    { path: FOLDER + 'c.md', file: parseQuiz(quiz('2026-11-05', '- 國二上 自然 2-1', 'aaaaa2')) },
    { path: FOLDER + 'b.md', file: parseQuiz(quiz('2026-11-05', `- [[${WORDS.replace(/\.md$/, '')}]]`, 'aaaaa3')) },
    { path: FOLDER + 'a.md', file: parseQuiz(quiz('壞', '- 國二上 英文 L3', 'aaaaa4')) },
  ];
  const list = quizRows(entries, { day: DAY, index: nature, known: path => path === WORDS ? { subject: '英文' } : null, resolve });
  assert.deepEqual(list.map(row => [row.date, row.subject]), [['2026-11-05', '自然'], ['2026-11-05', '英文'], ['2026-11-06', '英文'], [null, '英文']]);
});

// ── 寫 ──

void test('§1 外掛寫的新檔：單元一行、單篇是 vault 路徑的連結（去掉 .md），讀回來一樣', () => {
  const unit = newQuizText({ id: 'q4m8t2', date: '2026-11-05', line: quizLine({ unit: { term: '國二上', subject: '英文', code: 'L3' } }) ?? '' });
  assert.equal(unit, '---\n識別碼: q4m8t2\n小考日期: 2026-11-05\n---\n- 國二上 英文 L3\n');
  const deck = newQuizText({ id: 'q4m8t2', date: '2026-11-05', line: quizLine({ deck: 'Essence Cards/學業/國二上/英文/國二上英文 L3 單字.md' }) ?? '' });
  assert.equal(deck, '---\n識別碼: q4m8t2\n小考日期: 2026-11-05\n---\n- [[Essence Cards/學業/國二上/英文/國二上英文 L3 單字]]\n');
  assert.deepEqual(parseQuiz(deck).target, { kind: 'link', link: 'Essence Cards/學業/國二上/英文/國二上英文 L3 單字' });
  assert.equal(quizFileName('2026-11-05'), '2026-11-05 小考');
});

void test('§1 寫不出來的目標回 null：連結不能用的字、讀回來不是同一個單元', () => {
  for (const name of ['a]]b', 'a|b', 'a#b', 'a[b']) assert.equal(quizLine({ deck: `Essence Cards/${name}.md` }), null, name);
  assert.equal(quizLine({ unit: { term: '國二上', subject: '英文', code: 'L1、L2' } }), null);
});

void test('§1 改日期只動那一行：註解、引號、CRLF、別的屬性、內文照留', () => {
  const crlf = '---\r\n# 老師說的\r\n識別碼: q4m8t2 # 別改\r\n小考日期: "2026-11-05" # 第三節\r\n備註: 帶字典\r\n---\r\n\r\n- 國二上  英文 L3\r\n';
  const done = editQuiz(crlf, { date: '2026-11-07' });
  assert.deepEqual(done, { kind: 'ok', text: crlf.replace('"2026-11-05"', '"2026-11-07"') });
  const plain = '---\n識別碼: q4m8t2\n小考日期: 2026/11/5\n---\n- 國二上 英文 L3';
  assert.deepEqual(editQuiz(plain, { date: '2026-11-07' }), { kind: 'ok', text: plain.replace('2026/11/5', '2026-11-07') }, '結尾沒有換行也照留');
  assert.deepEqual(editQuiz(plain, { date: '2026-11-05' }), { kind: 'ok', text: plain.replace('2026/11/5', '2026-11-05') });
});

void test('§1 取消只多一行；CRLF 跟著原本的', () => {
  const crlf = '---\r\n識別碼: q4m8t2\r\n小考日期: 2026-11-05\r\n---\r\n- 國二上 英文 L3\r\n';
  assert.deepEqual(editQuiz(crlf, { cancelled: '2026-11-04' }), { kind: 'ok', text: '---\r\n識別碼: q4m8t2\r\n小考日期: 2026-11-05\r\n取消: 2026-11-04\r\n---\r\n- 國二上 英文 L3\r\n' });
  const bad = quiz('11/5');
  assert.deepEqual(editQuiz(bad, { cancelled: '2026-11-04' }), { kind: 'ok', text: quiz('11/5', undefined, undefined, '取消: 2026-11-04\n') }, '日期壞掉也能取消，日期不動');
});

void test('§1 手寫沒有識別碼：第一次寫入補上，放第一行，算進比對', () => {
  const text = '---\n小考日期: 2026-11-05\n---\n- 國二上 英文 L3\n';
  assert.deepEqual(editQuiz(text, { date: '2026-11-07', id: 'q4m8t2' }), { kind: 'ok', text: '---\n識別碼: q4m8t2\n小考日期: 2026-11-07\n---\n- 國二上 英文 L3\n' });
  assert.deepEqual(editQuiz(quiz('2026-11-05'), { date: '2026-11-07', id: 'zzzzzz' }), { kind: 'ok', text: quiz('2026-11-07') }, '已經有的不換');
});

void test('§1 擋下來不寫：檔不見、屬性區壞掉、已經取消、一行一行改不回去的寫法', () => {
  assert.deepEqual(editQuiz('', { date: '2026-11-07' }), { kind: 'blocked', reason: 'changed' });
  assert.deepEqual(editQuiz('---\n小考日期: [2026\n---\n- 國二上 英文 L3\n', { date: '2026-11-07' }), { kind: 'blocked', reason: 'broken' });
  assert.deepEqual(editQuiz('---\n小考日期: 2026-11-05\n- 國二上 英文 L3\n', { date: '2026-11-07' }), { kind: 'blocked', reason: 'broken' });
  assert.deepEqual(editQuiz('- 國二上 英文 L3\n', { date: '2026-11-07' }), { kind: 'blocked', reason: 'broken' });
  assert.deepEqual(editQuiz(quiz('2026-11-05', undefined, undefined, '取消: 2026-11-04\n'), { date: '2026-11-07' }), { kind: 'blocked', reason: 'changed' });
  assert.deepEqual(editQuiz('---\n{識別碼: q4m8t2, 小考日期: 2026-11-05}\n---\n- 國二上 英文 L3\n', { cancelled: '2026-11-04' }), { kind: 'blocked', reason: 'broken' });
});

void test('§1 寫完讀回來是同一份小考：往返與冪等', () => {
  const texts = [quiz('2026-11-05'), '---\r\n識別碼: "q4m8t2"\r\n小考日期: 2026.11.5\r\n---\r\n\r\n- 八上 英文 l3\r\n', quiz('2026-11-05', `- [[${WORDS.replace(/\.md$/, '')}]]`)];
  for (const text of texts) {
    const once = editQuiz(text, { date: '2026-11-07' });
    assert.equal(once.kind, 'ok');
    if (once.kind !== 'ok') continue;
    assert.deepEqual(editQuiz(once.text, { date: '2026-11-07' }), once, '第二次不改任何字');
    const after = parseQuiz(once.text), before = parseQuiz(text);
    assert.deepEqual(after.date, { kind: 'ok', date: '2026-11-07' });
    assert.equal(after.id, before.id);
    assert.deepEqual(after.target, before.target);
  }
});
