import test from 'node:test';
import assert from 'node:assert/strict';
import { codeKey, headingKey, parseDeck, sourceLinks, splitUnit, termKey, termRank } from '../src/core/deck/index.ts';
import type { SourceItem, SourceLink, SourceOwner } from '../src/core/deck/index.ts';

// 出處的讀法（tasks/entry-and-catalog.md §9-3、§9-6，D-167）：預期值都來自那份說明的表，不用同一個正則再算一次。

const NATURE: SourceOwner = { term: '國二上', subject: '自然', unit: { code: '2-2' } };
const ENGLISH: SourceOwner = { term: '國一上', subject: '英文', unit: { code: 'L3' } };
const MATH: SourceOwner = { term: '小三下', subject: '數學', unit: { code: '5' } };
const NO_OWNER: SourceOwner = { term: null, subject: null, unit: null };

const read = (text: string, own: SourceOwner = NATURE): SourceItem[] => sourceLinks([text], own);
const links = (text: string, own: SourceOwner = NATURE): SourceLink[] => read(text, own).map(item => item.link);
const page = (n: number | string): SourceLink => ({ kind: 'block', id: 'p' + n });
const fig = (id: string): SourceLink => ({ kind: 'block', id: 'fig' + id });
const tab = (id: string): SourceLink => ({ kind: 'block', id: 'tab' + id });
const ex = (id: string): SourceLink => ({ kind: 'block', id: 'ex' + id });
const note = (link: string): SourceLink => ({ kind: 'note', link });
const heading = (text: string): SourceLink => ({ kind: 'heading', heading: text });
const unit = (term: string, code: string, rest: SourceLink | null = null): SourceLink => ({ kind: 'unit', term, unit: code, rest });
const u13 = (rest: SourceLink | null = null): SourceLink => unit('國二上', '1-3', rest);

/** 每個例子：原文、讀成什麼、要不要提示（字面上就知道的）、情境。登錄在這裡的例子自動受下面的性質保護。 */
const EXAMPLES: [string, SourceLink[], boolean?, SourceOwner?][] = [
  // 頁碼
  ['p.44', [page(44)]], ['p44', [page(44)]], ['P.44', [page(44)]], ['p 44', [page(44)]], ['p. 44', [page(44)]], ['pp.44-46', [page(44)]], ['page 44', [page(44)]], ['pg.44', [page(44)]],
  ['p.44-46', [page(44)]], ['p.44~46', [page(44)]], ['p.44～46', [page(44)]], ['p.44-p.46', [page(44)]], ['第 44 頁', [page(44)]], ['第44頁', [page(44)]], ['44頁', [page(44)]], ['44 頁', [page(44)]], ['p44頁', [page(44)]],
  ['第四十四頁', [page(44)]], ['第44-46頁', [page(44)]], ['第 44 至 46 頁', [page(44)]], ['（p.44）', [page(44)]], ['課本第44頁', [page(44)]], ['講義p.12', [page(12)]], ['Workbook p.12', [page(12)]], ['p.44 知識快遞', [page(44)]],
  // 圖表例題
  ['圖 2-14', [fig('2-14')]], ['圖2-14', [fig('2-14')]], ['圖 2-13 A', [fig('2-13a')]], ['圖2-13(a)', [fig('2-13a')]], ['圖2-14圖說', [fig('2-14')]], ['表 2-1', [tab('2-1')]], ['例題 2-3', [ex('2-3')]], ['範例2-3', [ex('2-3')]], ['Fig. 2-14', [fig('2-14')]], ['2-14圖', [fig('2-14')]], ['第2-14圖', [fig('2-14')]], ['圖2.14', [fig('2-14')]],
  // 好幾個
  ['p.44, p.45', [page(44), page(45)]], ['p.44/p.45', [page(44), page(45)]], ['p.44;p.45', [page(44), page(45)]], ['p.44 p.45', [page(44), page(45)]], ['p.44, 45', [page(44), page(45)]], ['p.44 45', [page(44), page(45)]], ['p.44、46、48', [page(44), page(46), page(48)]], ['44、46頁', [page(44), page(46)]], ['第44頁和第46頁', [page(44), page(46)]],
  ['圖2-14、2-15', [fig('2-14'), fig('2-15')]], ['圖2-13a、b', [fig('2-13a'), fig('2-13b')]], ['圖2-14表2-1', [fig('2-14'), tab('2-1')]], ['p.20 圖 2-14', [page(20), fig('2-14')]],
  // 單元
  ['國二上 1-3', [u13()]], ['國二上 1-3 p.20', [u13(page(20))]], ['國二上1-3 p.20', [u13(page(20))]], ['國二 上 1-3', [u13()]], ['國 二 上 1-3', [u13()]], ['國二上1-3p.20', [u13(page(20))]], ['國二上 1-3 第20頁', [u13(page(20))]], ['國二上 1-3 20頁', [u13(page(20))]],
  ['八上 1-3', [u13()]], ['8上1-3', [u13()]], ['八年級上學期 1-3', [u13()]], ['國二上學期 1-3 第20頁', [u13(page(20))]], ['國二（上）1-3', [u13()]], ['國中二年級上 1-3', [u13()]], ['自然 國二上 1-3', [u13()]], ['國二上 自然 1-3', [u13()]], ['（國二上 1-3）', [u13()]],
  ['國二上 第1章第3節 p.20', [u13(page(20))]], ['國二上 第一章第三節', [u13()]], ['國二上 單元 1-3', [u13()]], ['國二上 1-2-3 p.20', [unit('國二上', '1-2-3', page(20))]], ['國二上 20-1', [unit('國二上', '20-1')]], ['高三下 L10 圖 2-13 A', [unit('高三下', 'L10', fig('2-13a'))]],
  ['小五上 3 p.15', [unit('小五上', '3', page(15))]], ['小五上 A1', [unit('小五上', 'A1')]], ['國二上 L 1 p.20', [unit('國二上', 'L1', page(20))]], ['國一上 l1', [unit('國一上', 'l1')], false, ENGLISH],
  ['國二上 2-1 水溶液 p.15', [unit('國二上', '2-1', page(15))]], ['國二上 2-1 水溶液', [unit('國二上', '2-1', heading('水溶液'))]], ['國二上 1-3 [[別的筆記]]', [u13(note('別的筆記'))]],
  ['p.44 國二上 1-3 p.20', [page(44), u13(page(20))]], ['p.44、國二上 1-3 p.20', [page(44), u13(page(20))]],
  // 位置跟著前面的單元（D-167 第 6 點）
  ['國二上 1-3 p.44, p.45', [u13(page(44)), u13(page(45))]], ['國二上 1-3 p.44、p.45', [u13(page(44)), u13(page(45))]], ['國二上 1-3 p.44；p.45', [u13(page(44)), u13(page(45))]], ['國二上 1-3 p.44, 45', [u13(page(44)), u13(page(45))]], ['國二上 1-3, p.44', [u13(), u13(page(44))]],
  ['國二上 1-3 p.20，本單元 p.44', [u13(page(20)), page(44)]], ['國二上 1-3 p.20，本篇 p.44', [u13(page(20)), page(44)]],
  // 乾淨的列表
  ['國二上 1-3、1-8', [u13(), unit('國二上', '1-8')]], ['國二上 1-3, 1-8 p.5', [u13(), unit('國二上', '1-8', page(5))]], ['國一上 L1、L2', [unit('國一上', 'L1'), unit('國一上', 'L2')], false, ENGLISH], ['國一上 L1, L2 p.20', [unit('國一上', 'L1'), unit('國一上', 'L2', page(20))], false, ENGLISH],
  // 本篇自己的編號
  ['L3 p.30', [page(30)], false, ENGLISH], ['2-2 p.30', [page(30)]], ['5', [{ kind: 'text' }], false, MATH], ['本單元 p.44', [page(44)]],
  // 連結
  ['[[筆記#標題]]', [note('筆記#標題')]], ['[[筆記]]', [note('筆記')]], ['[[a,b]]', [note('a,b')]], ['[[國二上 L1]]', [note('國二上 L1')]], ['[[Ａ卷#２-１]]', [note('Ａ卷#２-１')]], ['[[ノート]]', [note('ノート')]], ['[[a]], [[b/c]]', [note('a'), note('b/c')]], ['[補充筆記](補充筆記.md)', [note('補充筆記')]], ['[[#睡眠的階段]]', [heading('睡眠的階段')]], ['#睡眠的階段', [heading('睡眠的階段')]], ['「睡眠的階段」', [heading('睡眠的階段')]],
  // 先備、網址、題號
  ['先備：國一數學 比例式', [{ kind: 'text' }]], ['先備:比例', [{ kind: 'text' }]], ['先備：A, B', [{ kind: 'text' }]], ['https://example.com/p.44', [{ kind: 'text' }]], ['第5題', [{ kind: 'text' }]],
  // 舊標題：連結由 Obsidian 層找
  ['睡眠的階段', [heading('睡眠的階段')]], ['溶解, 擴散', [heading('溶解, 擴散')]], ['CO2 的性質', [heading('CO2 的性質')]], ['2 擴散現象', [heading('2 擴散現象')]], ['1-2 溶液', [heading('1-2 溶液')]], ['課本第三章', [heading('課本第三章')]], ['老師上課說的', [heading('老師上課說的')]], ['先備知識', [heading('先備知識')]],
  // 不算單元（D-166 第 2 點）
  ['2-1', [heading('2-1')]], ['L1', [heading('L1')]], ['U1', [heading('U1')]], ['1-2-3', [heading('1-2-3')]], ['44', [heading('44')]], ['1-3, 1-8', [heading('1-3, 1-8')]], ['國二上的回顧', [heading('國二上的回顧')]], ['高六上 L1', [heading('高六上 L1')]], ['國四上 1-3', [heading('國四上 1-3')]], ['六上 2-1', [heading('六上 2-1')]], ['二上 1-3', [heading('二上 1-3')]], ['第三冊 1-3', [heading('第三冊 1-3')]], ['B2 1-3', [heading('B2 1-3')]], ['看國二上 1-3', [heading('看國二上 1-3')]], ['數學 國二上 1-3', [heading('數學 國二上 1-3')]], ['國二上 數學 1-3', [heading('國二上 數學 1-3')], true],
  ['小五上', [heading('小五上')], true], ['小五上 p.15', [heading('小五上 p.15')], true], ['小五上 P20', [heading('小五上 P20')], true], ['小五上 圖 2-14', [heading('小五上 圖 2-14')], true], ['小五上 [[x]]', [heading('小五上 [[x]]')], true], ['小五上 第 44 頁', [heading('小五上 第 44 頁')], true], ['小五上 20頁', [heading('小五上 20頁')], true],
  ['國二上 1 3 p.20', [heading('國二上 1 3 p.20')], true], ['國二上 1-', [heading('國二上 1-')], true], ['國二上 第3節 p.20', [page(20)], true], ['國二上 第三課 p.5', [page(5)], true], ['國二上 水溶液 p.30', [page(30)], true], ['國一上 L1~L3', [heading('國一上 L1~L3')], true, ENGLISH],
  // 自己的學期沒寫單元：還是這本書
  ['國二上 p.15', [page(15)], true], ['國二上 圖2-14', [fig('2-14')], true], ['國二上 第44頁', [page(44)], true],
  // 位置照連，但要提示
  ['1-3 p.20', [page(20)], true], ['L2 p.12', [page(12)], true, ENGLISH], ['老師說過 p.44', [page(44)], true], ['上一節 p.40', [page(40)], true], ['pH7 p.20', [page(20)], true],
  // 字裡有像編號的
  ['國二上 1-3 和 1-8', [u13(heading('和 1-8'))], true], ['p.12 of L1', [page(12)], true, ENGLISH], ['p.30, 也算 L1', [page(30), heading('也算 L1')], false, ENGLISH],
  ['國二上1-3,8', [u13(), heading('8')]], ['國一上 L1, A1 p.20', [unit('國一上', 'L1'), unit('國一上', 'L1', page(20))], true, ENGLISH], ['國二上 1-3, 2-5 題', [u13(), heading('2-5 題')]], ['國二上 1-3, 10-15 上課筆記', [u13(), heading('10-15 上課筆記')]], ['國二上 1-3, 2026-10', [u13(), heading('2026-10')]], ['國二上 1-3 p.44, 溶解說明, 45', [u13(page(44)), heading('溶解說明'), heading('45')]],
  // 否定字：不算單元、不算位置
  ['不要算國二上 1-3', [heading('不要算國二上 1-3')]], ['國二上 1-3 不要算這個目標', [heading('國二上 1-3 不要算這個目標')]], ['國二上 1-3 不考這個', [heading('國二上 1-3 不考這個')]], ['不是國二上 1-3，是國三上 2-1', [heading('不是國二上 1-3'), heading('是國三上 2-1')]], ['老師說不用看 p.44', [heading('老師說不用看 p.44')]], ['圖 2-14 不用看', [heading('圖 2-14 不用看')]],
  // 範圍寫反、不確定：不連
  ['p.46-44', [heading('p.46-44')], true], ['p.44-5', [heading('p.44-5')], true], ['p.44-44', [heading('p.44-44')], true], ['第46-44頁', [heading('第46-44頁')], true], ['p53 基因', [heading('p53 基因')], true], ['第十百頁', [heading('第十百頁')]], ['pp.44', [page(44)]],
];

void test('D-167 每個例子：讀成預期的位置與單元，字面上就有問題的才標出來', () => {
  const wrong = EXAMPLES.flatMap(([text, expected, problem = false, own = NATURE]) => {
    const items = read(text, own);
    const same = JSON.stringify(items.map(item => item.link)) === JSON.stringify(expected) && items.some(item => item.problem !== undefined) === problem;
    return same ? [] : [{ text, expected, problem, got: items }];
  });
  assert.deepEqual(wrong, []);
});

// ── 性質：同一個意思套上打字雜訊，歸屬與位置都不變（D-167 第 3 點）──

const wide = (text: string): string => text.replace(/[0-9A-Za-z.,\-]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
const NOISE: Record<string, (text: string) => string> = {
  尾端空白: t => t + ' ', 開頭空白: t => ' ' + t, 連續空白: t => t.replace(/ /g, '  '), 全形空白: t => t.replace(/ /g, '　'), Tab: t => t.replace(/ /g, '\t'),
  尾端逗號: t => t + ',', 尾端全形逗號: t => t + '，', 尾端句號: t => t + '。', 尾端頓號: t => t + '、', 全形字: wide,
  短破折號: t => t.replace(/-/g, '–'), 長破折號: t => t.replace(/-/g, '—'), 減號: t => t.replace(/-/g, '−'), 全形連字號: t => t.replace(/-/g, '－'), 全形波浪號: t => t.replace(/~/g, '～'),
  逗號前空白: t => t.replace(/,/g, ' ,'), 逗號換全形: t => t.replace(/,/g, '，'), 逗號後沒空白: t => t.replace(/, /g, ','), 零寬字元: t => t + '​',
  兩種: t => wide(t).replace(/ /g, '　') + '，', 三種: t => (t + ' ,').replace(/-/g, '–').replace(/ (?=\S)/g, '  '),
};
/** 意思：單元比鍵；舊標題由 Obsidian 層去雜訊之後才比材料，所以也比鍵。 */
const meaning = (items: readonly SourceItem[]): string => JSON.stringify(items.map(item => item.link), (key, value: unknown) => {
  if (key === 'unit') return codeKey(value as string);
  if (key === 'heading') return headingKey(value as string);
  return value;
});
const hasLink = (text: string): boolean => /\[|\(|https?:|「|#/.test(text);

void test('D-167 性質：登錄的例子套上任何打字雜訊，意思都不變', () => {
  for (const [text, , , own = NATURE] of EXAMPLES) {
    if (hasLink(text)) continue;
    const base = meaning(read(text, own));
    for (const [name, apply] of Object.entries(NOISE)) {
      const changed = apply(text);
      assert.equal(meaning(read(changed, own)), base, `${name}：${JSON.stringify(changed)}`);
    }
  }
});

void test('D-167 不是雜訊的字不合併：連結裡不動，CO₂、①、L01 都保留', () => {
  assert.deepEqual(links('[[Ａ卷#２-１]]'), [note('Ａ卷#２-１')], '連結裡的全形字是檔名');
  assert.deepEqual(links('CO₂ 的性質'), [heading('CO₂ 的性質')]);
  assert.deepEqual(links('國二上 ① p.20'), [page(20)], '① 不是單元 1；自己的學期還是這本書');
  assert.deepEqual(links('國二上 2⁻¹ p.20'), [page(20)], '2⁻¹ 不是單元 2-1');
  assert.deepEqual(links('小五上 ① p.20'), [heading('小五上 ① p.20')], '別的學期不知道在哪裡');
  assert.notEqual(codeKey('L01'), codeKey('L1'));
  assert.notEqual(codeKey('2-01'), codeKey('2-1'));
  assert.equal(codeKey('Ｌ１'), codeKey('L1'));
  assert.equal(codeKey('l1'), codeKey('L1'));
  assert.equal(codeKey('２－１'), codeKey('2-1'));
  assert.equal(termKey('八上'), '國二上');
  assert.equal(termKey('國二上學期'), '國二上');
  assert.equal(termKey('暑假'), '暑假', '認不得的照原字');
});

void test('D-167 注音打出來的連字號：ㄦ、ㄧ、一、ー、之，數字之間才算', () => {
  for (const text of ['國二上 1ㄦ3', '國二上 1ㄧ3', '國二上 1一3', '國二上 1ー3', '國二上 1之3', '國二上 1─3']) assert.deepEqual(links(text), [u13()], text);
  assert.deepEqual(links('圖2一14'), [fig('2-14')]);
  assert.deepEqual(links('一下 p.5'), [page(5)].map(() => page(5)), '不是數字之間的「一」不動');
  assert.deepEqual(links('p。44'), [page(44)]);
  assert.deepEqual(links('p，44'), [page(44)]);
  assert.deepEqual(links('p：44'), [page(44)]);
  assert.deepEqual(links('p . 44'), [page(44)]);
});

void test('D-167 顯示原文：一個位置就是整段；一段好幾個位置時一個位置一個按鈕，接著前一個的寫完整', () => {
  const texts = (text: string, own: SourceOwner = NATURE): string[] => read(text, own).map(item => item.text);
  assert.deepEqual(texts('ｐ．４４'), ['ｐ．４４']);
  assert.deepEqual(texts('p.44, p.45'), ['p.44', 'p.45']);
  assert.deepEqual(texts('p.44 知識快遞'), ['p.44 知識快遞']);
  assert.deepEqual(texts('國二上 1-3 p.20'), ['國二上 1-3 p.20']);
  assert.deepEqual(texts('p.44 p.45'), ['p.44', 'p.45']);
  assert.deepEqual(texts('國二上 1-3 p.20 圖 2-14 重點'), ['國二上 1-3 p.20', '圖 2-14 重點']);
  assert.deepEqual(texts('p.44, 45'), ['p.44', 'p.45'], '只有數字的按鈕看不懂');
  assert.deepEqual(texts('圖2-14、2-15'), ['圖2-14', '圖 2-15']);
  assert.deepEqual(texts('圖2-13a、b'), ['圖2-13a', '圖 2-13b']);
  assert.deepEqual(texts('[[a]], [[b/c]]'), ['[[a]]', '[[b/c]]']);
  assert.deepEqual(texts('溶解, 擴散'), ['溶解, 擴散']);
});

void test('D-167 同一欄不分頓號、逗號、分行：parse 拆好的每一項照順序讀，範圍接著走', () => {
  const inline = parseDeck('- 目標 ^abc123\n    - 問 :: 答\n    - 出處：小五上 2-1 p.15、p.44\n').targets[0].fields.sources;
  const nested = parseDeck('- 目標 ^abc123\n    - 問 :: 答\n    - 出處：\n        - 小五上 2-1 p.15\n        - p.44\n').targets[0].fields.sources;
  const expected = [unit('小五上', '2-1', page(15)), unit('小五上', '2-1', page(44))];
  assert.deepEqual(sourceLinks(inline, NATURE).map(item => item.link), expected);
  assert.deepEqual(sourceLinks(nested, NATURE).map(item => item.link), expected);
  assert.deepEqual(sourceLinks(['p.44', '國二上 1-3 p.20'], NATURE).map(item => item.link), [page(44), u13(page(20))]);
});

void test('D-167 別的學期沒寫單元：範圍停掉，後面的位置不知道屬於哪裡', () => {
  assert.deepEqual(links('國二上 1-3 p.44，國一下 p.15'), [u13(page(44)), heading('國一下 p.15')]);
  assert.deepEqual(links('國二上 1-3 p.44，國一下 p.15，p.16'), [u13(page(44)), heading('國一下 p.15'), heading('p.16')]);
  assert.deepEqual(links('國一上 L1, 國一下, L2 p.20', ENGLISH), [unit('國一上', 'L1'), heading('國一下'), heading('L2 p.20')]);
  assert.deepEqual(links('國二上 1-3 p.44，國一下 p.15，本篇 p.16'), [u13(page(44)), heading('國一下 p.15'), page(16)]);
});

void test('D-167 整段只有字：同一欄有讀懂別的就是說明（remark），沒有就是舊標題；否定字一定提示', () => {
  const remark = (text: string): boolean[] => read(text).map(item => item.remark === true);
  assert.deepEqual(remark('p.44, 老師說的'), [false, true]);
  assert.deepEqual(remark('老師說的'), [false]);
  assert.deepEqual(remark('p.44、睡眠的階段'), [false, true]);
  assert.deepEqual(remark('p.44, 不是重點'), [false, false], '否定字不當說明');
  assert.deepEqual(read('p.44, 45').map(item => item.remark), [undefined, undefined]);
});

void test('D-167 對不到目錄才算有問題的（needsUnit）：其他編號、沿用學期的', () => {
  const needs = (text: string, own: SourceOwner = ENGLISH): boolean[] => read(text, own).map(item => item.needsUnit === true);
  assert.deepEqual(needs('國一上 Starter'), [true]);
  assert.deepEqual(needs('國一上 L1-2'), [true]);
  assert.deepEqual(needs('國一上 L1'), [false], '標準的編號沒有卡組不提示（D-033 邊用邊長）');
  assert.deepEqual(needs('國一上 L1、L2'), [false, true]);
  assert.deepEqual(needs('國二上 1-3, 10-15', NATURE), [false, true]);
});

void test('不看別篇：沒有 own 的卡組（學業以外）一樣讀；本篇的科目與編號只在有寫時用', () => {
  assert.deepEqual(sourceLinks(['國二上 1-3 p.20'], NO_OWNER).map(item => item.link), [u13(page(20))]);
  assert.deepEqual(sourceLinks(['p.44'], NO_OWNER).map(item => item.link), [page(44)]);
  assert.deepEqual(sourceLinks(['自然 國二上 1-3'], NO_OWNER).map(item => item.link), [heading('自然 國二上 1-3')]);
});

void test('編號與名稱的切法：半形空白、全形空白、Tab 都算', () => {
  assert.deepEqual(splitUnit('2-1 水溶液'), { code: '2-1', name: '水溶液' });
  assert.deepEqual(splitUnit('2-1　水溶液'), { code: '2-1', name: '水溶液' });
  assert.deepEqual(splitUnit('2-1\t水溶液'), { code: '2-1', name: '水溶液' });
  assert.deepEqual(splitUnit('L1 Back to School'), { code: 'L1', name: 'Back to School' });
  assert.deepEqual(splitUnit('Starter'), { code: 'Starter', name: '' });
});

void test('年級學期的順序：小 → 國 → 高、年級、上 → 下；認不得的是 null', () => {
  const order = ['小一上', '小一下', '小六下', '國一上', '國三下', '高一上', '高三下'].map(termRank);
  assert.ok(order.every(rank => rank !== null));
  assert.deepEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)), order);
  for (const text of ['高六上', '國四上', '一小上', '國二', '暑假', '']) assert.equal(termRank(text), null, text);
});
