import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contractCases, runContractCase } from '../src/dev/files-contract.ts';
import type { Files } from '../src/core/files.ts';
import { createNodeFiles } from '../tools/node-files.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// W5 說明 §2：Node 版跑和 Obsidian 開發命令 files 同一份 C1～C16；每個例子一個新的暫存 vault。
for (const item of contractCases) {
  void test(`Files 契約 ${item.code}：${item.title}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'essence-contract-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const result = await runContractCase(item, createNodeFiles(root), {
      rename: (from, to) => rename(join(root, from), join(root, to)),
      remove: path => rm(join(root, path), { recursive: true }),
    }, 'Essence W5/暫存', { notice: 3000, quiet: 300 });
    assert.deepEqual(result, { code: item.code, ok: true });
  });
}

// 契約不是空轉：每個故意弄壞的 Files 都至少讓預期的那一條失敗。
void test('Files 契約抓得到壞掉的實作', async t => {
  const root = await mkdtemp(join(tmpdir(), 'essence-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ops = {
    rename: (from: string, to: string) => rename(join(root, from), join(root, to)),
    remove: (path: string) => rm(join(root, path), { recursive: true }),
  };
  const good = createNodeFiles(root);
  const broken: Record<string, Files> = {
    C1: { ...good, list: async folder => (await good.list('')).filter(path => path.startsWith(folder)) },
    // 內容沒變也照寫。
    C6: { ...good, modify: async (path, edit) => { await writeFile(join(root, path), edit(await good.read(path) ?? '')); } },
    C9: { ...good, append: (path, line) => good.modify(path, text => text + line) },
    // 讀和寫分開，同時呼叫時互相蓋掉。
    C11: { ...good, append: (path, line) => good.read(path).then(text => good.modify(path, () => (text ?? '') + line + '\n')) },
    C12: { ...good, watch: () => () => {} },
    C14: { ...good, read: path => good.read(path.replace(/^(\.\.\/)+|^\//, '')) },
    // 刪資料夾時只通知第一層的檔（Obsidian 若只對資料夾發一次事件、子資料夾已經不在，就會像這樣）。
    C15: { ...good, watch: onChange => good.watch(path => { if (!path.includes('/sub/')) onChange(path); }) },
    // 讀成文字再編碼回去，換行被轉換。
    C16: { ...good, readBytes: async path => { const text = await good.read(path); return text === null ? null : new TextEncoder().encode(text.replaceAll('\r\n', '\n')); } },
  };
  let run = 0;
  for (const [code, files] of Object.entries(broken)) {
    const item = contractCases.find(c => c.code === code);
    assert.ok(item);
    const result = await runContractCase(item, files, ops, 'v' + String(run++), { notice: 500, quiet: 300 });
    assert.equal(result.ok, false, code + ' 應該失敗');
  }
});

// 技術債 A9：測試用的記憶體 Files 也要過同一份契約，state 與接線的測試才能用它取代真檔案。
for (const item of contractCases) {
  void test(`記憶體 Files 契約 ${item.code}：${item.title}`, async () => {
    const memory = createMemoryFiles();
    const result = await runContractCase(item, memory.files, memory.ops, 'Essence W5/暫存', { notice: 200, quiet: 50 });
    assert.deepEqual(result, { code: item.code, ok: true });
  });
}

// 外掛內的備份 §1-2：讀不到（不是不存在）時 readBytes 丟出原本的錯誤，呼叫的一方才寫得出原因（D-154）。
void test('Node 的 readBytes：讀不到時丟出原本的錯誤（這裡用資料夾當檔案讀，EISDIR），不當成不存在', async t => {
  const root = await mkdtemp(join(tmpdir(), 'essence-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = createNodeFiles(root);
  await files.modify('Essence Cards/資料夾/a.md', () => 'a');
  await assert.rejects(files.readBytes('Essence Cards/資料夾'), (error: NodeJS.ErrnoException) => error.code === 'EISDIR');
});
