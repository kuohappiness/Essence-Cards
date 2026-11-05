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

void test('§1 完整路徑剛好也是別的資料夾的尾巴（備份了一整包）：還是只有一個答案', () => {
  const copy = '備份/' + WORDS;
  const { resolve } = resolver([WORDS, copy], { 'Essence Cards/學業/國二上英文 L3 單字': WORDS });
  assert.deepEqual(resolve('Essence Cards/學業/國二上英文 L3 單字', FROM), { kind: 'file', path: WORDS });
});

void test('§1 大小寫不同還是同一篇：Windows、iPhone 的檔名不分大小寫，Obsidian 也當成同一篇', () => {
  const lower = 'Essence Cards/english l3.md', upper = 'Essence Cards/舊的/English L3.md';
  assert.deepEqual(resolver([lower], { 'ESSENCE CARDS/ENGLISH L3': lower }).resolve('ESSENCE CARDS/ENGLISH L3', FROM), { kind: 'file', path: lower });
  assert.deepEqual(resolver([lower, upper], { 'english L3': lower }).resolve('english L3', FROM), { kind: 'several' }, '只差大小寫的兩個檔也算重名');
});

/**
 * Obsidian 1.15.0 的 getLinkpathDest（從 app.js 唯讀抽出，L2 R1）：先找檔名一樣的檔，確切的位置對上就是它；
 * 對不上時退回路徑尾巴相同的檔（和小考檔同一個資料夾開頭的排前面）。`/` 開頭的不退回。
 */
function obsidianFirst(paths: string[]) {
  const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
  const folder = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return (link: string, from: string): string | null => {
    let wanted = (link + '.md').toLowerCase();
    const named = paths.filter(path => base(path.toLowerCase()) === base(wanted));
    if (!named.length) return null;
    if (base(wanted) === wanted && named.length === 1) return named[0];
    let near = folder(from).toLowerCase();
    if (wanted.startsWith('./') || wanted.startsWith('../')) {
      if (wanted.startsWith('./')) wanted = wanted.slice(2);
      while (wanted.startsWith('../')) { wanted = wanted.slice(3); near = folder(near); }
      wanted = (near ? near + '/' : '') + wanted;
    }
    if (wanted.startsWith('/')) wanted = wanted.slice(1);
    const exact = named.find(path => path.toLowerCase() === wanted);
    if (exact) return exact;
    if (link.startsWith('/')) return null;
    const tails = named.filter(path => path.toLowerCase().endsWith(wanted)).sort();
    return [...tails.filter(path => path.toLowerCase().startsWith(near)), ...tails.filter(path => !path.toLowerCase().startsWith(near))][0] ?? null;
  };
}
function realResolver(paths: string[]) {
  const first = obsidianFirst(paths);
  const app = {
    metadataCache: { getFirstLinkpathDest(link: string, from: string) { const path = first(link, from); return path ? { path } : null; } },
    vault: { getFiles: () => paths.map(path => ({ path })) },
  } as unknown as App;
  return quizLinkResolver(app);
}

void test('L2 R1 完整路徑那一篇不在了：Obsidian 退回尾巴相同的另一份（整包備份），這裡算找不到，不練到備份', () => {
  const nested = 'Essence Cards/備份/' + WORDS;
  const resolve = realResolver([nested]);
  assert.deepEqual(resolve('Essence Cards/學業/國二上英文 L3 單字', FROM), { kind: 'none' });
  assert.deepEqual(resolve('essence cards/學業/國二上英文 l3 單字', FROM), { kind: 'none' }, '大小寫不同也是完整路徑');
  assert.deepEqual(resolve('/Essence Cards/學業/國二上英文 L3 單字', FROM), { kind: 'none' });
  assert.deepEqual(resolve('國二上英文 L3 單字', FROM), { kind: 'file', path: nested }, '只寫檔名、只有一份時照舊接受');
});

void test('L2 R1 相對路徑也要對到確切的位置：那一篇不在了不退回尾巴相同的檔', () => {
  const relative = '../../學業/國二上英文 L3 單字';
  assert.deepEqual(realResolver([WORDS])(relative, FROM), { kind: 'file', path: WORDS });
  assert.deepEqual(realResolver([WORDS])('./國二上英文 L3 單字', 'Essence Cards/學業/x.md'), { kind: 'file', path: WORDS });
  const nested = 'Essence Cards/備份/' + WORDS;
  assert.deepEqual(realResolver([nested])(relative, FROM), { kind: 'none' });
});

void test('L2 R1 照 Obsidian 的讀法：自動更新後的短連結、一段路徑、完整路徑與整包備份並存，都照舊', () => {
  const backup = 'Essence Cards/備份/' + WORDS;
  const resolve = realResolver([WORDS, backup, 'Essence Cards/學業/自然 2-1.md']);
  assert.deepEqual(resolve('Essence Cards/學業/國二上英文 L3 單字', FROM), { kind: 'file', path: WORDS });
  assert.deepEqual(resolve('Essence Cards/備份/Essence Cards/學業/國二上英文 L3 單字', FROM), { kind: 'file', path: backup });
  assert.deepEqual(resolve('國二上英文 L3 單字', FROM), { kind: 'several' });
  assert.deepEqual(resolve('備份/Essence Cards/學業/國二上英文 L3 單字', FROM), { kind: 'file', path: backup }, 'Obsidian 最短的寫法');
  assert.deepEqual(realResolver([WORDS])('學業/國二上英文 L3 單字', FROM), { kind: 'file', path: WORDS });
});

void test('§1 尾巴剛好一樣但資料夾名不同的不算重名：比的是整段路徑', () => {
  const { resolve } = resolver([WORDS, 'Essence Cards/補習國二上英文 L3 單字.md'], { '國二上英文 L3 單字': WORDS });
  assert.deepEqual(resolve('國二上英文 L3 單字', FROM), { kind: 'file', path: WORDS });
});
