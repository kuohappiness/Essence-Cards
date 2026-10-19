import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
const result = await build({ entryPoints: ['src/metrics.ts'], bundle: true, write: false, platform: 'node', format: 'esm', alias: { obsidian: resolve('preview/obsidian.ts') }, tsconfigRaw: {} });
const { readRecords } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
test('三輪讀取：每輪重讀全部、只讀最新月份；解析與讀檔錯誤不遺漏', async () => {
  const prefix = 'Essence-T2/紀錄-三年/';
  const files = ['2024-01 iPhone-aaaa.jsonl', '2024-02 iPhone-aaaa.jsonl', '2024-02 Windows-bbbb.jsonl'].map(p => prefix + p);
  const reads = [];
  const app = { vault: { adapter: {
    list: async () => ({ files, folders: [] }),
    read: async path => {
      reads.push(path);
      if (path.includes('Windows')) throw Error('尚未下載');
      return path.includes('2024-01') ? '{"t":"a"}\n{bad}\n' : '{"t":"b"}\n';
    }
  } } };
  const passes = await readRecords(app);
  assert.equal(passes.length, 3);
  assert.equal(reads.length, 15);
  for (const pass of passes) {
    assert.equal(pass.all.files, 3); assert.equal(pass.all.lines, 2);
    assert.equal(pass.all.errors.length, 2); assert.equal(pass.current.files, 2);
    assert.equal(pass.current.lines, 1); assert.equal(pass.current.errors.length, 1);
    assert.equal(pass.latestMonth, '2024-02');
    assert.ok(pass.all.readMs >= 0); assert.ok(pass.all.parseMs >= 0);
  }
  await assert.rejects(readRecords({ vault: { adapter: { list: async () => ({ files: [] }) } } }), /沒有 .jsonl/);
});
