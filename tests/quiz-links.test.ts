import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { parseQuiz } from '../src/core/catalog/index.ts';
import { quizLinkResolver } from '../src/obsidian/quiz-links.ts';
import { createState } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

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
 * 檔名先照寫的轉小寫找（檔名裡有點才試），找不到再加 `.md`：所以 `.MD`、`.Md` 結尾的照寫的就找得到（L2 R7）。
 */
function obsidianFirst(paths: string[]) {
  const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
  const folder = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return (link: string, from: string): string | null => {
    let wanted = link.toLowerCase();
    const sameName = (): string[] => paths.filter(path => base(path.toLowerCase()) === base(wanted));
    let named = base(wanted).includes('.') ? sameName() : [];
    if (!named.length) {
      wanted = (link + '.md').toLowerCase();
      named = sameName();
    }
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

void test('L2 R7 副檔名的大小寫不影響：.md、.MD、.Md 的完整路徑、/ 開頭、相對路徑、檔名都認得；別名與標題經過讀檔照舊', () => {
  const resolve = realResolver([WORDS]);
  const name = '國二上英文 L3 單字';
  for (const ext of ['.md', '.MD', '.Md']) {
    for (const [written, from] of [
      ['Essence Cards/學業/' + name + ext, FROM],
      ['/Essence Cards/學業/' + name + ext, FROM],
      ['./' + name + ext, 'Essence Cards/學業/x.md'],
      ['../../學業/' + name + ext, FROM],
      [name + ext, FROM],
    ]) assert.deepEqual(resolve(written, from), { kind: 'file', path: WORDS }, written);
  }
  for (const line of [`- [[Essence Cards/學業/${name}.MD|單字]]`, `- [[Essence Cards/學業/${name}.Md#第一段]]`]) {
    const { target } = parseQuiz(`---\n識別碼: aaaaaa\n小考日期: 2026-11-07\n---\n${line}\n`);
    assert.ok(target.kind === 'link', line);
    assert.deepEqual(resolve(target.link, FROM), { kind: 'file', path: WORDS }, line);
  }
  // R1 的反例照舊：原篇不在、只剩尾巴相同的備份時，大寫的副檔名也不退回備份。
  const nested = 'Essence Cards/備份/' + WORDS;
  assert.deepEqual(realResolver([nested])('Essence Cards/學業/' + name + '.MD', FROM), { kind: 'none' });
  assert.deepEqual(realResolver([nested])('../../學業/' + name + '.Md', FROM), { kind: 'none' });
});

void test('L2 R8 檔名本身以 .MD 結尾（Topic.MD.md）：照 Obsidian 先照寫的找、找不到再加 .md；完整路徑、相對路徑、檔名都認得，重名是 several', () => {
  const deck = 'Essence Cards/學業/Topic.MD.md';
  const resolve = realResolver([deck]);
  for (const [written, from] of [
    ['Essence Cards/學業/Topic.MD', FROM],
    ['/Essence Cards/學業/Topic.MD', FROM],
    ['./Topic.MD', 'Essence Cards/學業/x.md'],
    ['../../學業/Topic.MD', FROM],
    ['Topic.MD', FROM],
    ['Essence Cards/學業/Topic.MD.md', FROM],
    ['essence cards/學業/topic.md', FROM],
    ['Topic.MD.md', FROM],
  ]) assert.deepEqual(resolve(written, from), { kind: 'file', path: deck }, written);
  const copies = realResolver(['Essence Cards/A/Topic.MD.md', 'Essence Cards/B/Topic.MD.md']);
  assert.deepEqual(copies('Topic.MD', FROM), { kind: 'several' }, '同名兩篇不靠 Obsidian 挑');
  assert.deepEqual(copies('Topic.MD.md', FROM), { kind: 'several' });
  // Topic.md 和 Topic.MD.md 都在：Obsidian 照寫的先找到 Topic.md，寫完整檔名才是另一篇。
  const both = realResolver(['Essence Cards/學業/Topic.md', deck]);
  assert.deepEqual(both('Essence Cards/學業/Topic.MD', FROM), { kind: 'file', path: 'Essence Cards/學業/Topic.md' });
  assert.deepEqual(both('Essence Cards/學業/Topic.MD.md', FROM), { kind: 'file', path: deck });
  // R1 的反例照舊：原篇不在、只剩尾巴相同的備份。
  assert.deepEqual(realResolver(['Essence Cards/備份/' + deck])('Essence Cards/學業/Topic.MD', FROM), { kind: 'none' });
  // 檔名中間有點的一般情況。
  const smith = 'Essence Cards/學業/Mr.Smith.md';
  assert.deepEqual(realResolver([smith])('Essence Cards/學業/Mr.Smith', FROM), { kind: 'file', path: smith });
  assert.deepEqual(realResolver([smith])('Mr.Smith', FROM), { kind: 'file', path: smith });
  // 檔名沒有點時一定加 .md：旁邊有沒有副檔名的同名檔也一樣。
  const readme = 'Essence Cards/學業/README.md';
  assert.deepEqual(realResolver(['Essence Cards/學業/README', readme])('Essence Cards/學業/README', FROM), { kind: 'file', path: readme });
});

void test('L2 R8 替 Topic.MD.md 這一篇設小考：外掛寫的 [[…/Topic.MD]] 建得出來，讀回指向那一篇', async t => {
  const deck = 'Essence Cards/學業/Topic.MD.md';
  const memory = createMemoryFiles({ [deck]: '---\n年級學期: 國二上\n科目: 英文\n單元: "L3"\n---\n- A ^aaa\n    - Q :: A\n' });
  const state = createState({
    files: memory.files, device: 'PC-test', delay: 1, fillIds: false,
    now: () => Date.parse('2026-11-05T12:00:00+08:00'), offset: () => 480,
    resolveLink: (link, from) => realResolver([...memory.texts.keys()])(link, from),
  });
  t.after(() => state.close());
  await state.ready();
  assert.deepEqual(await state.setQuiz({ deck }, '2026-11-07', null), { kind: 'done' });
  const written = [...memory.texts].find(([path]) => path.startsWith('Essence Cards/考試範圍/小考/'));
  assert.ok(written);
  assert.match(written[1], /^- \[\[Essence Cards\/學業\/Topic\.MD\]\]$/m);
  const rows = state.quizzes();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].problem, null);
  assert.deepEqual(rows[0].refs, [{ deck }]);
});

void test('§1 尾巴剛好一樣但資料夾名不同的不算重名：比的是整段路徑', () => {
  const { resolve } = resolver([WORDS, 'Essence Cards/補習國二上英文 L3 單字.md'], { '國二上英文 L3 單字': WORDS });
  assert.deepEqual(resolve('國二上英文 L3 單字', FROM), { kind: 'file', path: WORDS });
});
