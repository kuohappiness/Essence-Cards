import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { quizLinkResolver } from '../src/obsidian/quiz-links.ts';

// 小考檔的連結怎麼認（tasks/quiz-mark.md §1）：只在確定指向一篇時接受；重名、認不出來走待修正。真的 Obsidian 解析在實機跑（§6）。

const FROM = 'Essence Cards/考試範圍/小考/2026-11-05 小考.md';
const WORDS = 'Essence Cards/學業/國二上英文 L3 單字.md';
const COPY = 'Essence Cards/舊的/國二上英文 L3 單字.md';

/** first 是假的 getFirstLinkpathDest：Obsidian 重名時也只回一個。 */
function resolver(paths: string[], first: Record<string, string>) {
  const seen: [string, string][] = [];
  const app = {
    metadataCache: { getFirstLinkpathDest(link: string, from: string) { seen.push([link, from]); const path = first[link]; return path ? { path } : null; } },
    vault: { getFiles: () => paths.map(path => ({ path })) },
  } as unknown as App;
  return { resolve: quizLinkResolver(app), seen };
}

void test('§1 完整路徑、檔名、部分路徑只符合一篇時接受；傳入小考檔自己的路徑', () => {
  const { resolve, seen } = resolver([WORDS, 'Essence Cards/學業/自然 2-1.md'], {
    'Essence Cards/學業/國二上英文 L3 單字': WORDS,
    '國二上英文 L3 單字': WORDS,
    '學業/國二上英文 L3 單字': WORDS,
    '國二上英文 L3 單字.md': WORDS,
  });
  for (const link of ['Essence Cards/學業/國二上英文 L3 單字', '國二上英文 L3 單字', '學業/國二上英文 L3 單字', '國二上英文 L3 單字.md']) {
    assert.deepEqual(resolve(link, FROM), { kind: 'file', path: WORDS }, link);
  }
  assert.deepEqual(seen[0], ['Essence Cards/學業/國二上英文 L3 單字', FROM]);
});

void test('§1 找不到是 none', () => {
  assert.deepEqual(resolver([WORDS], {}).resolve('改過名字的那一篇', FROM), { kind: 'none' });
});

void test('§1 檔名重複：Obsidian 只回一個，這裡不靠它挑，算認不出來；完整路徑還是只有一個答案', () => {
  const { resolve } = resolver([WORDS, COPY], {
    '國二上英文 L3 單字': WORDS,
    'Essence Cards/學業/國二上英文 L3 單字': WORDS,
    'Essence Cards/舊的/國二上英文 L3 單字': COPY,
  });
  assert.deepEqual(resolve('國二上英文 L3 單字', FROM), { kind: 'several' });
  assert.deepEqual(resolve('Essence Cards/學業/國二上英文 L3 單字', FROM), { kind: 'file', path: WORDS });
  assert.deepEqual(resolve('Essence Cards/舊的/國二上英文 L3 單字', FROM), { kind: 'file', path: COPY });
});

void test('§1 大小寫不同還是同一篇：Windows、iPhone 的檔名不分大小寫，Obsidian 也當成同一篇', () => {
  const lower = 'Essence Cards/english l3.md', upper = 'Essence Cards/舊的/English L3.md';
  assert.deepEqual(resolver([lower], { 'ESSENCE CARDS/ENGLISH L3': lower }).resolve('ESSENCE CARDS/ENGLISH L3', FROM), { kind: 'file', path: lower });
  assert.deepEqual(resolver([lower, upper], { 'english L3': lower }).resolve('english L3', FROM), { kind: 'several' }, '只差大小寫的兩個檔也算重名');
});

void test('§1 尾巴剛好一樣但資料夾名不同的不算重名：比的是整段路徑', () => {
  const { resolve } = resolver([WORDS, 'Essence Cards/補習國二上英文 L3 單字.md'], { '國二上英文 L3 單字': WORDS });
  assert.deepEqual(resolve('國二上英文 L3 單字', FROM), { kind: 'file', path: WORDS });
});
