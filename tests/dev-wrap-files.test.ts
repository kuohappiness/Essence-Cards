import test from 'node:test';
import assert from 'node:assert/strict';
import { countFiles, scopedFiles } from '../src/dev/wrap-files.ts';
import { createState } from '../src/state/index.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// Files 的兩種包裝（W5 §4-4）：底下用記憶體 Files（技術債 A9），通知同步送出，不等檔案系統。

void test('countFiles 每個方法都計一次，結果照原本的 Files', async () => {
  const { files, calls } = countFiles(createMemoryFiles().files);
  assert.equal(calls(), 0);
  await files.append('a/b.jsonl', 'x');
  await files.modify('a/c.md', () => 'y');
  assert.deepEqual(await files.list('a'), ['a/b.jsonl', 'a/c.md']);
  assert.equal(await files.read('a/b.jsonl'), 'x\n');
  files.watch(() => {})();
  assert.equal(calls(), 5);
});

void test('scopedFiles 只看得到那個資料夾，路徑去掉前綴', async () => {
  const outer = createMemoryFiles().files;
  await outer.modify('Essence Cards/外面.md', () => 'out');
  await outer.modify('量測/Essence Cards/甲.md', () => 'in');
  await outer.modify('量測2/Essence Cards/乙.md', () => 'no');
  const files = scopedFiles(outer, '量測');
  assert.deepEqual(await files.list(''), ['Essence Cards/甲.md']);
  assert.deepEqual(await files.list('Essence Cards'), ['Essence Cards/甲.md']);
  assert.equal(await files.read('Essence Cards/甲.md'), 'in');
  assert.equal(await files.read('Essence Cards/外面.md'), null);
  await files.append('Essence Cards/紀錄/2026-10 PC-test.jsonl', 'l');
  assert.equal(await outer.read('量測/Essence Cards/紀錄/2026-10 PC-test.jsonl'), 'l\n');
  await files.modify('Essence Cards/甲.md', text => text + '!');
  assert.equal(await outer.read('量測/Essence Cards/甲.md'), 'in!');

  const seen: string[] = [];
  const stop = files.watch(path => { seen.push(path); });
  await outer.modify('Essence Cards/外面.md', () => 'out2');
  await outer.modify('量測2/Essence Cards/乙.md', () => 'no2');
  await outer.modify('量測/Essence Cards/甲.md', () => 'in2');
  stop();
  await outer.modify('量測/Essence Cards/甲.md', () => 'in3');
  assert.deepEqual(seen, ['Essence Cards/甲.md']);
});

void test('open 的做法：對 scopedFiles 建的 state 只讀那個資料夾裡的卡組與紀錄', async t => {
  const outer = createMemoryFiles({
    'Essence Cards/真的（卡片）.md': '---\n科目: 自然\n---\n\n- 真的 ^zzzzz1\n    - 問 :: 答\n',
    '量測/Essence Cards/量測（卡片）.md': '---\n科目: 自然\n---\n\n- 量測 ^goal01\n    - 問 :: 答\n',
  }).files;
  const state = createState({ files: scopedFiles(outer, '量測'), device: 'PC-test', fillIds: false, now: () => Date.UTC(2026, 9, 24, 11), offset: () => 480 });
  t.after(() => state.close());
  const timings = await state.ready();
  assert.ok(timings.total >= 0);
  assert.deepEqual(state.decks().map(d => d.path), ['Essence Cards/量測（卡片）.md']);
  assert.deepEqual(state.today().share.map(item => item.lt), ['goal01']);
});
