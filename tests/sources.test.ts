import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLinks, splitUnit, termRank } from '../src/core/deck/index.ts';
import type { SourceLink } from '../src/core/deck/index.ts';

// 出處的字面讀法（tasks/entry-and-catalog.md §9-3、§9-6）：預期值都來自那份說明的表，不用同一個正則再算一次。

const one = (text: string): SourceLink => {
  const items = sourceLinks([text]);
  assert.equal(items.length, 1, text + ' 應該只有一項，實際 ' + JSON.stringify(items));
  assert.equal(items[0].text, text, '保留原文');
  return items[0].link;
};
const page = (id: string): SourceLink => ({ kind: 'block', id });
const unit = (term: string | null, code: string, rest: SourceLink | null = null): SourceLink => ({ kind: 'unit', term, unit: code, rest });
const heading = (text: string): SourceLink => ({ kind: 'heading', heading: text });

void test('第 1 種：連結是那份筆記，別名只顯示', () => {
  assert.deepEqual(one('[[筆記#標題]]'), { kind: 'note', link: '筆記#標題' });
  assert.deepEqual(one('[[筆記]]'), { kind: 'note', link: '筆記' });
  assert.deepEqual(one('[[筆記|別名]]'), { kind: 'note', link: '筆記', alias: '別名' });
  assert.deepEqual(one('[[筆記#標題|別名]]'), { kind: 'note', link: '筆記#標題', alias: '別名' });
  assert.deepEqual(one('[[a,b]]'), { kind: 'note', link: 'a,b' }, '連結裡的逗號不切');
  // 反例：連結後面還有字不算整個是連結。
  assert.deepEqual(one('[[a]] 的重點'), heading('[[a]] 的重點'));
});

void test('第 2 種：頁碼的各種寫法都連到同一個錨點，顯示原文', () => {
  for (const text of ['p.44', 'p44', 'P.44', 'p 44', 'P44', 'p.44-46', 'p.44～46', 'p.44~46', '第 44 頁', '第44頁', '44頁', '44 頁', 'p.44 知識快遞', '第 44 頁 知識快遞']) assert.deepEqual(one(text), page('p44'), text);
  assert.deepEqual(one('圖 2-14'), page('fig2-14'));
  assert.deepEqual(one('圖 2-13 A'), page('fig2-13a'));
  assert.deepEqual(one('表 2-1'), page('tab2-1'));
  assert.deepEqual(one('例題 2-3'), page('ex2-3'));
  // 反例：表裡的第 6 種。
  for (const text of ['p.46-44', 'p.44-44', 'p.44-5', 'p.44, 45', 'pp.44', '１-３ p.20', '44', '第 頁', 'p.']) assert.deepEqual(one(text), heading(text), text);
});

void test('第 3 種：開頭是年級學期，第一段就是單元編號，後面是位置', () => {
  assert.deepEqual(one('國二上 3 p.15'), unit('國二上', '3', page('p15')));
  assert.deepEqual(one('國一上 Starter'), unit('國一上', 'Starter'));
  assert.deepEqual(one('小五上 2-1'), unit('小五上', '2-1'));
  assert.deepEqual(one('小五上 A1'), unit('小五上', 'A1'));
  assert.deepEqual(one('國二上 ２-１'), unit('國二上', '２-１'), '全形不轉半形');
  assert.deepEqual(one('國二上1-3 p.20'), unit('國二上', '1-3', page('p20')));
  assert.deepEqual(one('國二 上 1-3'), unit('國二上', '1-3'));
  assert.deepEqual(one('國二上　1-3　p.20'), unit('國二上', '1-3', page('p20')), '全形空白也算');
  assert.deepEqual(one('國二上\t1-3'), unit('國二上', '1-3'), 'Tab 也算');
  assert.deepEqual(one('高三下 L10 圖 2-13 A'), unit('高三下', 'L10', page('fig2-13a')));
  assert.deepEqual(one('國二上 1-3 水溶液'), unit('國二上', '1-3', heading('水溶液')));
  // 反例：不算單元，當第 6 種。
  for (const text of ['小五上', '小五上 p.15', '小五上 P20', '小五上 圖 2-14', '小五上 [[x]]', '小五上 第 44 頁', '高六上 L1', '國四上 1-3', '國二上的回顧', '國二中 1-3']) assert.deepEqual(one(text), heading(text), text);
});

void test('第 4 種：沒寫年級學期時只有 2-1、1-2-3、L1、U1 算單元，後面是位置', () => {
  assert.deepEqual(one('1-2-3 p.20'), unit(null, '1-2-3', page('p20')));
  assert.deepEqual(one('2-1'), unit(null, '2-1'));
  assert.deepEqual(one('20-1'), unit(null, '20-1'), '不屬於單元 2');
  assert.deepEqual(one('L1'), unit(null, 'L1'));
  assert.deepEqual(one('U1 p.20'), unit(null, 'U1', page('p20')));
  assert.deepEqual(one('2-2 圖 2-14'), unit(null, '2-2', page('fig2-14')));
  assert.deepEqual(one('2-2　p.3'), unit(null, '2-2', page('p3')), '全形空白也算');
  // 反例：段落標題；新增、刪除同名單元的卡組前後，讀法都不變（讀法不看別篇，這裡沒有卡組可看）。
  for (const text of ['CO2 的性質', '2 擴散現象', 'A1 p.20', 'l1 p.20', 'Starter p.20', '3 p.15', 'L1-2', '2-', 'l1']) assert.deepEqual(one(text), heading(text), text);
  // 頁碼優先於編號。
  assert.deepEqual(one('p20'), page('p20'));
  assert.deepEqual(one('P20'), page('p20'));
});

void test('第 5 種：先備是文字，不做連結；第 6 種是舊的段落標題', () => {
  assert.deepEqual(one('先備：國一數學 比例式'), { kind: 'text' });
  assert.deepEqual(one('先備:比例'), { kind: 'text' });
  assert.deepEqual(one('先備：A, B'), { kind: 'text' }, '不切');
  assert.deepEqual(one('先備知識'), heading('先備知識'));
  assert.deepEqual(one('睡眠的階段'), heading('睡眠的階段'));
});

void test('切開：每一段都讀得懂才切，每一段各自獨立', () => {
  const texts = (text: string): string[] => sourceLinks([text]).map(item => item.text);
  for (const text of ['p.44, p.45', 'p.44，p.45', 'p.44/p.45', 'p.44／p.45']) {
    assert.deepEqual(sourceLinks([text]).map(item => item.link), [page('p44'), page('p45')], text);
  }
  assert.deepEqual(texts('p.44, p.45'), ['p.44', 'p.45'], '顯示切開後的原文');
  assert.deepEqual(sourceLinks(['1-3 p.20, p.44']).map(item => item.link), [unit(null, '1-3', page('p20')), page('p44')]);
  assert.deepEqual(sourceLinks(['小五上 2-1 p.15, 國一上 L3 圖 2-1']).map(item => item.link), [unit('小五上', '2-1', page('p15')), unit('國一上', 'L3', page('fig2-1'))]);
  assert.deepEqual(sourceLinks(['[[a]], [[b/c]]']).map(item => item.link), [{ kind: 'note', link: 'a' }, { kind: 'note', link: 'b/c' }], '連結裡的斜線不切');
  // 反例：有一段讀不懂、單元後面沒有位置，都不切。
  for (const text of ['溶解, 擴散', '[[a,b]]', '先備：A, B', 'p.44, 45', 'p.44, 溶解', '1/2 的意思', 'L1, L2', '2-1, p.44', '小五上 2-1, p.44']) assert.deepEqual(texts(text), [text], text);
});

void test('頓號切開的每一項各自獨立：第一項屬於小五上 2-1，第二項回到目標所在單元', () => {
  assert.deepEqual(sourceLinks(['小五上 2-1 p.15', 'p.44']).map(item => item.link), [unit('小五上', '2-1', page('p15')), page('p44')]);
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
