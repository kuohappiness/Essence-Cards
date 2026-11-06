import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDeck } from '../src/core/deck/index.ts';

// 草稿工具的比較卡檢查（tasks/question-type-seam.md §10）：每個情況一份稿，固定代碼、行號與退出碼。只有不符、提醒的稿退出碼是 0，AI 交稿前才真的擋得住錯誤。
const TOOL = fileURLToPath(new URL('../experiments/t4/check-syntax.mjs', import.meta.url));
type Found = [level: string, line: number, code: string];
function run(t: TestContext, draft: string): { exit: number | null; all: Found[]; pick: Found[]; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'check-syntax-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  const file = join(dir, '稿.md');
  writeFileSync(file, draft);
  const result = spawnSync(process.execPath, [TOOL, file, '--subject', '國語'], { encoding: 'utf8' });
  assert.ok(result.status === 0 || result.status === 1, `工具沒跑完（${String(result.status)}）：${result.stderr}`);
  const all: Found[] = [];
  let level = '';
  for (const line of result.stdout.split(/\r?\n/)) {
    const heading = /^## (錯誤|不符|提醒)$/.exec(line);
    if (heading) level = heading[1];
    const found = /^- 第 (\d+) 行〔([^〕]+)〕/.exec(line);
    if (found) all.push([level, Number(found[1]), found[2]]);
  }
  return { exit: result.status, all, pick: all.filter(each => each[2].startsWith('pick-')), output: result.stdout };
}
const ANCHOR = '    - 記憶錨點：下面是**木**，木頭圍成的：山寨、寨子';
const SOURCE = '    - 出處：p.90';
const card = (name: string, ...lines: string[]): string => [`- ${name}`, SOURCE, ...lines, ANCHOR].join('\n');

void test('完全照預設寫的稿：什麼都沒有，退出碼 0', t => {
  const draft = [
    card('寨（寨、塞） 相似字', '    - 盜匪躲在山＿＿裡。 :: 寨', '    - 這座古老的＿＿子建在山頂上。 :: 寨', '    - 住在高山的＿＿子裡。 :: 寨'),
    card('塞（寨、塞） 相似字', '    - 下班時間大＿＿車。 :: 塞', '    - 水管＿＿住了。 :: 塞', '    - 這條路又＿＿住了。 :: 塞'),
  ].join('\n');
  const { exit, all } = run(t, '## 相似字\n\n' + draft);
  assert.deepEqual(all, []);
  assert.equal(exit, 0);
});

void test('比較句的答案是組裡別的字：錯誤，定位到那一句，退出碼 1', t => {
  const { exit, pick } = run(t, card('寨（寨、塞） 相似字', '    - 盜匪躲在山＿＿裡。 :: 寨', '    - 下班時間大＿＿車。 :: 塞', '    - 第三句＿＿。 :: 塞'));
  assert.deepEqual(pick, [['錯誤', 4, 'pick-answer-invalid'], ['錯誤', 5, 'pick-answer-invalid']]);
  assert.equal(exit, 1);
});

const NOT_RECOGNIZED: [name: string, draft: string, line: number, reason: string][] = [
  ['括號', card('寨（寨塞寒賽） 相似字', '    - 盜匪躲在山＿＿裡。 :: 寨'), 1, '括號'],
  ['名稱不在組裡', card('寨（塞、寒） 相似字', '    - 盜匪躲在山＿＿裡。 :: 寨'), 1, '不在括號裡'],
  ['沒有空格', card('寨（寨、塞） 比較', '    - 木頭圍成的防守地？ :: 寨'), 1, '空格'],
  ['答案不在組裡', card('寨（寨、塞） 比較', '    - 這是＿＿。 :: 村'), 3, '答案不在組裡'],
  ['都是填空', card('寨（寨、塞） 相似字', '    - 盜匪躲在山==寨==裡。'), 1, '填空'],
];
for (const [name, draft, line, reason] of NOT_RECOGNIZED) {
  void test(`結尾是相似字、比較，認不出來：錯誤，寫出原因：${name}`, t => {
    const { exit, pick, output } = run(t, draft);
    assert.deepEqual(pick, [['錯誤', line, 'pick-not-recognized']]);
    assert.equal(exit, 1);
    assert.ok(output.split('\n').some(each => each.includes('pick-not-recognized') && each.includes(reason)), output);
  });
}

void test('混了別的：結尾是相似字、比較是錯誤；沒有結尾或結尾是別的詞只提醒', t => {
  const body = ['    - 盜匪躲在山＿＿裡。 :: 寨', '    - 防守地的字？ :: 寨'];
  for (const name of ['寨（寨、塞） 相似字', '寨（寨、塞） 比較']) {
    const { exit, pick } = run(t, card(name, ...body));
    assert.deepEqual(pick, [['錯誤', 4, 'pick-mixed']], name);
    assert.equal(exit, 1, name);
  }
  for (const name of ['寨（寨、塞）', '寨（寨、塞） 字形', '寨（寨、塞） 比較（進階）']) {
    const { exit, pick } = run(t, card(name, ...body));
    assert.deepEqual(pick, [['提醒', 4, 'pick-mixed']], name);
    assert.equal(exit, 0, name);
  }
});

void test('有組但沒有比較句，沒有結尾或結尾是別的詞：沒有比較卡的診斷', t => {
  for (const draft of [card('台北（台北、高雄） 首都', '    - 台灣的首都？ :: 台北'), card('寨（寨、塞）', '    - 這是＿＿。 :: 村'), card('寨（寨、塞） 字形', '    - 這是＿＿。 :: 村')]) {
    const { exit, pick } = run(t, draft);
    assert.deepEqual(pick, [], draft);
    assert.equal(exit, 0, draft);
  }
});

void test('最上層題目或名稱有 ==、＿：結尾是相似字、比較才是錯誤，定位在目標那一行；解析沒有比較卡的代碼', t => {
  for (const line of ['- ==寨==（寨、塞） 相似字', '- 山＿＿（寨、塞） 比較\n    - 這是＿＿。 :: 寨', '- 寨（寨、塞） 山＿＿ 相似字 :: 寨']) {
    const draft = `## 相似字\n\n${line}`;
    const { exit, pick, output } = run(t, draft);
    assert.deepEqual(pick, [['錯誤', 3, 'pick-name-cloze']], line);
    assert.ok(output.split('\n').some(each => each.includes('pick-name-cloze') && each.includes('名稱不能有 == 或 ＿')), output);
    assert.equal(exit, 1, line);
    assert.deepEqual(parseDeck(draft).problems.filter(problem => problem.code.startsWith('pick-')), [], line);
  }
  for (const line of ['- ==寨==（寨、塞）', '- ==寨==（寨、塞） 字形', '- 寨（寨、塞） 山＿＿ :: 寨', '- 這是＿＿比較 :: 寨']) {
    const { exit, pick } = run(t, line);
    assert.deepEqual(pick, [], line);
    assert.equal(exit, 0, line);
  }
});

void test('屬性區不影響行號（草稿不該有屬性區，另外有 yaml 的不符）', t => {
  const { exit, all } = run(t, '---\n科目: 國語\n---\n' + card('寨（寨、塞） 相似字', '    - 盜匪躲在山＿＿裡。 :: 寨', '    - 下班時間大＿＿車。 :: 塞'));
  assert.deepEqual(all.filter(each => each[2] === 'pick-answer-invalid' || each[2] === 'yaml'), [['錯誤', 7, 'pick-answer-invalid'], ['不符', 1, 'yaml']]);
  assert.equal(exit, 1);
});

/** 組裡的其他字也有目標，只看第一張。 */
const others = (...members: string[]): string => members.map(member => '\n' + card(`${member}（${['寨', '塞', '寒'].join('、')}） 相似字`, `    - 第一＿＿。 :: ${member}`, `    - 第二＿＿。 :: ${member}`)).join('');

void test('不符（退出碼 0）：每個字少於兩句，只有兩個選項的組少於三句', t => {
  const one = run(t, card('寨（寨、塞、寒） 相似字', '    - 盜匪躲在山＿＿裡。 :: 寨') + others('塞', '寒'));
  assert.deepEqual(one.pick, [['不符', 1, 'pick-few-sentences']]);
  assert.equal(one.exit, 0);
  assert.deepEqual(run(t, card('寨（寨、塞、寒） 相似字', '    - 盜匪躲在山＿＿裡。 :: 寨', '    - 古老的＿＿子。 :: 寨') + others('塞', '寒')).pick, []);
  const pair = (...lines: string[]): string => card('borrow（borrow、lend） 比較', ...lines) + '\n' + card('lend（borrow、lend） 比較', '    - Can you ＿＿ me a pen? :: lend', '    - Banks ＿＿ money. :: lend', '    - Please ＿＿ me that. :: lend');
  const two = run(t, pair('    - Can I ＿＿ your pen? :: borrow', '    - I ＿＿ books. :: borrow'));
  assert.deepEqual(two.pick, [['不符', 1, 'pick-few-sentences']]);
  assert.equal(two.exit, 0);
  assert.deepEqual(run(t, pair('    - Can I ＿＿ your pen? :: borrow', '    - I ＿＿ books. :: borrow', '    - May I ＿＿ this? :: borrow')).pick, []);
});

void test('不符（退出碼 0）：整個答案出現在題目裡；英文看詞界，片語要整段，中文要整個詞，單一漢字出現就算', t => {
  const pair = (word: string, other: string, ...lines: string[]): string => card(`${word}（${word}、${other}） 比較`, ...lines) + '\n' + card(`${other}（${word}、${other}） 比較`, `    - 一＿＿。 :: ${other}`, `    - 二＿＿。 :: ${other}`, `    - 三＿＿。 :: ${other}`);
  const shown: [string, string, string[], number][] = [
    ['lend', 'borrow', ['    - I lend him ＿＿. :: lend', '    - Banks ＿＿ money. :: lend', '    - Please ＿＿ me that. :: lend'], 3],
    ['lend', 'borrow', ['    - LEND means ＿＿. :: lend', '    - Banks ＿＿ money. :: lend', '    - Please ＿＿ me that. :: lend'], 3],
    ['make up', 'give up', ['    - They make up and ＿＿. :: make up', '    - Please ＿＿ with her. :: make up', '    - I will ＿＿. :: make up'], 3],
    ['質量', '重量', ['    - 質量是＿＿。 :: 質量', '    - 物體的＿＿不變。 :: 質量', '    - 天平量＿＿。 :: 質量'], 3],
    ['喵', '貓', ['    - 小貓＿＿喵叫。 :: 喵', '    - 牠＿＿了一聲。 :: 喵', '    - ＿＿了又一聲。 :: 喵'], 3],
  ];
  for (const [word, other, lines, line] of shown) {
    const { exit, pick } = run(t, pair(word, other, ...lines));
    assert.deepEqual(pick, [['不符', line, 'pick-answer-in-question']], lines[0]);
    assert.equal(exit, 0, lines[0]);
  }
  const fine: [string, string, string[]][] = [
    ['lend', 'borrow', ['    - The blend of ＿＿. :: lend', '    - Banks ＿＿ money. :: lend', '    - Please ＿＿ me that. :: lend']],
    ['make up', 'give up', ['    - They make ＿＿ and up. :: make up', '    - Please ＿＿ with her. :: make up', '    - I will ＿＿. :: make up']],
    ['質量', '重量', ['    - 這個質地和＿＿。 :: 質量', '    - 物體的＿＿不變。 :: 質量', '    - 天平量＿＿。 :: 質量']],
    ['寒', '賽', ['    - ＿＿冷的冬天。 :: 寒', '    - 假期是＿＿假。 :: 寒', '    - 天氣很＿＿。 :: 寒']],
  ];
  for (const [word, other, lines] of fine) assert.deepEqual(run(t, pair(word, other, ...lines)).pick, [], lines[0]);
});

const THREE = ['    - 第一句＿＿。 :: 寨', '    - 第二句＿＿。 :: 寨', '    - 第三句＿＿。 :: 寨'];
const pairOf = (first: string): string => first + '\n' + card('塞（寨、塞） 相似字', '    - 第一句＿＿。 :: 塞', '    - 第二句＿＿。 :: 塞', '    - 第三句＿＿。 :: 塞');
const bare = (...lines: string[]): string => ['- 寨（寨、塞） 相似字', SOURCE, ...THREE, ...lines].join('\n');

void test('不符（退出碼 0）：沒有記憶錨點、錨點沒有粗體', t => {
  const none = run(t, pairOf(bare()));
  assert.deepEqual(none.pick, [['不符', 1, 'pick-no-anchor']]);
  assert.equal(none.exit, 0);
  const plain = run(t, pairOf(bare('    - 記憶錨點：下面是木：山寨')));
  assert.deepEqual(plain.pick, [['不符', 1, 'pick-anchor-no-bold']]);
  assert.equal(plain.exit, 0);
});

void test('不符（退出碼 0）：同組的字沒有自己的目標，一個字一筆', t => {
  const { exit, pick } = run(t, card('寨（寨、塞、寒） 相似字', ...THREE));
  assert.deepEqual(pick, [['不符', 1, 'pick-member-no-target'], ['不符', 1, 'pick-member-no-target']]);
  assert.equal(exit, 0);
});

void test('提醒（退出碼 0）：認得的比較卡結尾不是相似字、比較，沒有結尾也算', t => {
  for (const ending of ['', ' 字形', ' 接句']) {
    const draft = card(`寨（寨、塞）${ending}`, ...THREE) + '\n' + card(`塞（寨、塞）${ending}`, '    - 第一句＿＿。 :: 塞', '    - 第二句＿＿。 :: 塞', '    - 第三句＿＿。 :: 塞');
    const { exit, pick } = run(t, draft);
    assert.deepEqual(pick, [['提醒', 1, 'pick-title'], ['提醒', 7, 'pick-title']], ending);
    assert.equal(exit, 0, ending);
  }
});

void test('提醒：有頓號的組裡，項目中間有漢字夾空白；英文和 A 型不算', t => {
  const typo = run(t, card('寨（寨,塞，寒 賽） 相似字', '    - 一＿＿。 :: 寨', '    - 二＿＿。 :: 寨'));
  assert.deepEqual(typo.pick.filter(each => each[2] === 'pick-member-space'), [['提醒', 1, 'pick-member-space']]);
  assert.equal(typo.exit, 0);
  const same = run(t, card('寒（寨,塞，寒 賽） 相似字', '    - 一＿＿。 :: 寒', '    - 二＿＿。 :: 寒'));
  assert.deepEqual(same.pick, [['錯誤', 1, 'pick-not-recognized'], ['提醒', 1, 'pick-member-space']], '同組的另一個字名稱不在組裡，是錯誤，也提醒原因');
  assert.equal(same.exit, 1);
  for (const name of ['一般型（一般型、A 型） 比較', 'make up（make up、give up） 比較']) {
    assert.deepEqual(run(t, card(name, '    - 一＿＿。 :: ' + name.split('（')[0], '    - 二＿＿。 :: ' + name.split('（')[0], '    - 三＿＿。 :: ' + name.split('（')[0])).pick.filter(each => each[2] === 'pick-member-space'), [], name);
  }
});

void test('提醒：記憶錨點冒號前超過 15 字；粗體記號不算字，冒號後面不算', t => {
  const anchor = (text: string): string => pairOf(bare(`    - 記憶錨點：${text}`));
  const fifteen = '下面是**木**一二三四五六七八九十一';
  assert.deepEqual(run(t, anchor(`${fifteen}：山寨`)).pick, []);
  const long = run(t, anchor(`${fifteen}二：山寨`));
  assert.deepEqual(long.pick, [['提醒', 1, 'pick-anchor-long']]);
  assert.equal(long.exit, 0);
  assert.deepEqual(run(t, anchor(`下面是**木**：${'詞'.repeat(30)}`)).pick, []);
});

void test('--selftest 過得了', () => {
  const result = spawnSync(process.execPath, [TOOL, '--selftest'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
