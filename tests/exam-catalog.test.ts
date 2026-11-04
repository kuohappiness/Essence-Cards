import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, parseScope, targetsInScope } from '../src/core/catalog/index.ts';
import type { CatalogDeck } from '../src/core/catalog/index.ts';
import { parseDeck } from '../src/core/deck/index.ts';

// 範圍和卡組對起來（tasks/exam-scope.md §3、§7、§8）：卡組都是自編的。

const deck = (path: string, text: string): CatalogDeck => ({ path, deck: parseDeck(text) });
/** 屬性與目標：targets 寫 `^id` 加上每個目標底下的資料列。 */
function card(path: string, props: Record<string, string>, targets: Record<string, string[]>): CatalogDeck {
  const head = Object.entries(props).map(([key, value]) => key + ': ' + value).join('\n');
  const body = Object.entries(targets).map(([id, lines]) => '- 目標 ' + id + ' ^' + id + '\n' + [...lines, '問 :: 答'].map(line => '    - ' + line).join('\n')).join('\n');
  return deck(path, '---\n' + head + '\n---\n' + body + '\n');
}
const unit = (term: string, code: string, subject = '自然'): Record<string, string> => ({ 年級學期: term, 科目: subject, 單元: JSON.stringify(code) });
const scope = (...lines: string[]): ReturnType<typeof parseScope> => parseScope(lines.map(line => '- ' + line).join('\n') + '\n');
const inScope = (decks: readonly CatalogDeck[], ...lines: string[]): string[] => [...targetsInScope(scope(...lines), buildIndex(decks))].sort();

void test('目標屬於哪些單元：自己的單元、出處的單元（對得到與對不到卡組的都算），帶依據', () => {
  const index = buildIndex([
    card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：小五上 3-1 p.15、國二上 2-9 p.3'], b: ['出處：國二上 1-3, 10-15 p.44'], c: ['出處：小五上 p.15'] }),
    card('Essence Cards/b.md', unit('小五上', '3-1'), { d: [] }),
  ]);
  const of = (id: string) => index.members.find(member => member.id === id);
  assert.deepEqual(of('a')?.units, [
    { term: '國二上', subject: '自然', code: '2-1', basis: 'own' },
    { term: '小五上', subject: '自然', code: '3-1', basis: 'written' },
    { term: '國二上', subject: '自然', code: '2-9', basis: 'written' },
  ]);
  assert.deepEqual(of('a')?.sources, ['小五上 3-1 p.15', '國二上 2-9 p.3']);
  assert.deepEqual(of('b')?.units.map(each => [each.code, each.basis]), [['2-1', 'own'], ['1-3', 'written'], ['10-15', 'carried']]);
  assert.equal(of('a')?.missed, false);
  assert.equal(of('c')?.missed, true, '字面上有單元的線索、沒有算進歸屬');
  assert.equal(of('d')?.line, 5);
  assert.equal(of('d')?.path, 'Essence Cards/b.md');
  assert.equal(of('d')?.own, '小五上 3-1');
});

void test('同一個單元有明寫就算明寫；寫到自己的單元還是自己的', () => {
  const index = buildIndex([card('Essence Cards/a.md', unit('國二上', '2-1'), { a: ['出處：國二上 1-3, 10-15 p.44、國二上 10-15 p.45'], b: ['出處：國二上 2-1 p.3'] })]);
  assert.deepEqual(index.members[0].units.map(each => [each.code, each.basis]), [['2-1', 'own'], ['1-3', 'written'], ['10-15', 'written']]);
  assert.deepEqual(index.members[1].units.map(each => [each.code, each.basis]), [['2-1', 'own']]);
});

void test('在範圍內的目標：自己的單元或出處落在範圍內；後來才建的卡組不影響', () => {
  const low = card('Essence Cards/low.md', unit('小四上', '2-1'), { a: ['出處：國二上 2-9 p.3'], b: [] });
  const high = card('Essence Cards/high.md', unit('國二上', '2-2'), { c: [] });
  assert.deepEqual(inScope([low, high], '國二上 自然 2-2'), ['c']);
  assert.deepEqual(inScope([low, high], '國二上 自然 2-9'), ['a'], '2-9 沒有卡組：目標寫到它就算');
  assert.deepEqual(inScope([low, high], '國二上 自然 2'), ['a', 'c'], '整章');
  const later = card('Essence Cards/later.md', unit('國二上', '2-9'), { d: [] });
  assert.deepEqual(inScope([low, high, later], '國二上 自然 2-9'), ['a', 'd']);
});

void test('別的科目、沒有科目、草稿、暫停的不算', () => {
  const english = card('Essence Cards/e.md', unit('國二上', 'L1', '英文'), { a: [] });
  assert.deepEqual(inScope([english], '國二上 自然 L1'), []);
  const none = deck('Essence Cards/n.md', '---\n年級學期: 國二上\n---\n- 目標 ^b\n    - 出處：國二上 2-1\n    - 問 :: 答\n');
  assert.deepEqual(inScope([none], '國二上 自然 2-1'), [], '自己沒有科目，不把 null 補成範圍裡的科目');
  const draft = card('Essence Cards/d.md', { ...unit('國二上', '2-1'), 狀態: '草稿' }, { c: [] });
  const paused = card('Essence Cards/p.md', { ...unit('國二上', '2-1'), 狀態: '暫停' }, { d: [] });
  const stopped = card('Essence Cards/s.md', unit('國二上', '2-1'), { e: ['狀態：暫停'], f: [] });
  assert.deepEqual(inScope([draft, paused, stopped], '國二上 自然 2-1'), ['f']);
});
