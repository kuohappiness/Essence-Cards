import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, utimes, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createNodeFiles } from '../tools/node-files.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'essence-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, files: createNodeFiles(root) };
}

test('Files.list 遞迴只列檔案，vault 相對 / 路徑，依字串排序，缺資料夾回 []', async t => {
  const { root, files } = await fixture(t);
  await mkdir(join(root, 'folder', 'deep'), { recursive: true });
  for (const path of ['folder/z.md', 'folder/A.md', 'folder/deep/中文.md', 'outside.md']) await writeFile(join(root, path), '');
  assert.deepEqual(await files.list('folder'), ['folder/A.md', 'folder/deep/中文.md', 'folder/z.md']);
  assert.deepEqual(await files.list('missing'), []);
  assert.deepEqual(await files.list(''), ['folder/A.md', 'folder/deep/中文.md', 'folder/z.md', 'outside.md']);
});
test('Files.read 不存在回 null，既有檔案完整保留 UTF-8 與換行', async t => {
  const { root, files } = await fixture(t);
  assert.equal(await files.read('missing/file'), null);
  await writeFile(join(root, 'a.md'), '中文\r\n文字\n');
  assert.equal(await files.read('a.md'), '中文\r\n文字\n');
});
test('Files.modify 建立上層、以空文字呼叫 edit，一次讀改寫，沒變不寫', async t => {
  const { root, files } = await fixture(t);
  let calls = 0;
  await files.modify('deep/a.md', old => { calls++; assert.equal(old, ''); return 'A'; });
  await files.modify('deep/a.md', old => { calls++; assert.equal(old, 'A'); return old + 'B'; });
  assert.equal(calls, 2); assert.equal(await files.read('deep/a.md'), 'AB');
  const file = join(root, 'deep/a.md');
  await utimes(file, new Date(0), new Date(0));
  const previous = await stat(file);
  await files.modify('deep/a.md', old => old);
  assert.equal((await stat(file)).mtimeMs, previous.mtimeMs);
  await files.modify('empty/a.md', old => old);
  assert.equal(await files.read('empty/a.md'), '');
});
test('Files.modify 同檔並行的讀改寫串接，append 也不互蓋', async t => {
  const { files } = await fixture(t);
  await Promise.all(Array.from({ length: 40 }, () => files.modify('counter', old => String(Number(old) + 1))));
  assert.equal(await files.read('counter'), '40');
  await Promise.all([files.modify('a', () => 'start\n'), files.append('a', 'second'), files.modify('a', old => old + 'end')]);
  assert.equal(await files.read('a'), 'start\nsecond\nend');
});

test('F4 不分大小寫的檔案系統：同檔大小寫別名的 40 次 modify 不遺失', async t => {
  const { files } = await fixture(t);
  await files.modify('counter.txt', () => '0');
  if (await files.read('COUNTER.txt') === null) {
    t.skip('暫存資料夾區分大小寫，counter.txt 與 COUNTER.txt 不是同一個檔案');
    return;
  }
  await Promise.all(Array.from({ length: 40 }, (_, i) => files.modify(i % 2 ? 'counter.txt' : 'COUNTER.txt', old => String(Number(old) + 1))));
  assert.equal(await files.read('counter.txt'), '40');
  assert.equal(await files.read('COUNTER.txt'), '40');
});
test('Files.modify edit 丟錯不會寫檔，也不堵住後續修改', async t => {
  const { files } = await fixture(t);
  await files.modify('a', () => 'before');
  await assert.rejects(files.modify('a', () => { throw Error('停止'); }), /停止/);
  assert.equal(await files.read('a'), 'before');
  await files.modify('a', old => old + ' after');
  assert.equal(await files.read('a'), 'before after');
});
test('Files.append 追加 line 加換行，建立上層、不擅自補原檔的換行', async t => {
  const { files } = await fixture(t);
  await files.append('deep/a', '第一行'); await files.append('deep/a', '第二行');
  assert.equal(await files.read('deep/a'), '第一行\n第二行\n');
  await files.modify('a', () => 'no newline'); await files.append('a', 'appended');
  assert.equal(await files.read('a'), 'no newlineappended\n');
});
test('Files 只吞不存在的錯誤，其他讀寫失敗仍回報', async t => {
  const { root, files } = await fixture(t);
  await mkdir(join(root, 'dir'));
  await assert.rejects(files.read('dir'));
  await assert.rejects(files.modify('dir', () => 'x'));
});
test('Files 拒絕絕對路徑與向上越過 vault 的路徑', async t => {
  const { root, files } = await fixture(t);
  assert.throws(() => files.read('../outside'), /vault/);
  assert.throws(() => files.append(join(root, 'a'), 'x'), /vault/);
  await assert.rejects(files.list('../outside'), /vault/);
});

test('Files.watch recursive 通知新增、修改、刪除、改名的舊新路徑，取消後停止', async t => {
  const { root, files } = await fixture(t);
  const events: string[] = [];
  const stop = files.watch(path => events.push(path));
  t.after(async () => stop());
  async function waitFor(paths: string[]) {
    const deadline = performance.now() + 3000;
    while (!paths.every(path => events.includes(path))) {
      assert.ok(performance.now() < deadline, '未收到通知：' + paths + '，收到：' + events);
      await setTimeout(10);
    }
  }
  await files.append('deep/a.md', 'new'); await waitFor(['deep/a.md']);
  events.length = 0;
  await files.modify('deep/a.md', old => old + 'changed'); await waitFor(['deep/a.md']);
  events.length = 0;
  await rename(join(root, 'deep/a.md'), join(root, 'deep/b.md')); await waitFor(['deep/a.md', 'deep/b.md']);
  events.length = 0;
  await rename(join(root, 'deep'), join(root, 'renamed')); await waitFor(['deep/b.md', 'renamed/b.md']);
  events.length = 0;
  await rm(join(root, 'renamed/b.md')); await waitFor(['renamed/b.md']);
  assert.ok(events.every(path => !path.includes('\\') && !path.startsWith('/')));
  stop(); const count = events.length;
  await files.append('later/a.md', 'later'); await setTimeout(80);
  assert.equal(events.length, count);
});
test('Files.watch 能監看既有深層檔案', async t => {
  const { files } = await fixture(t);
  await files.append('deep/old.md', 'before');
  const events: string[] = [];
  const stop = files.watch(path => events.push(path)); t.after(async () => stop());
  await files.append('deep/old.md', 'after');
  const deadline = performance.now() + 3000;
  while (!events.includes('deep/old.md') && performance.now() < deadline) await setTimeout(10);
  assert.ok(events.includes('deep/old.md'));
});
