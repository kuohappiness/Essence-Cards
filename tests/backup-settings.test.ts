import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'obsidian';
import { createDesktop } from '../src/desktop/index.ts';
import { wireBackup } from '../src/obsidian/backup.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';
import { tempFolder } from './helpers/vault.ts';

// 設定頁選位置（tasks/plugin-backup.md §1-1、§1-5；Codex L2 B6）：檢查過的位置記成實際路徑，位置那一列顯示的就是實際存放的地方；
// 不能用的位置當場說明原因、不換位置。電腦專用的動作用 src/desktop 真的跑在暫存資料夾。

/** wireBackup 用到的外掛與 app：只有 localStorage、設定資料夾與註冊。 */
function fakePlugin(): { plugin: Plugin; storage: Map<string, unknown> } {
  const storage = new Map<string, unknown>();
  const app = {
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => { if (value === null) storage.delete(key); else storage.set(key, value); },
    vault: { configDir: '.obsidian', adapter: { exists: () => Promise.resolve(false), readBinary: () => Promise.resolve(new ArrayBuffer(0)) } },
  };
  return { plugin: { app, register() {}, registerInterval: (id: number) => id } as unknown as Plugin, storage };
}

void test('設定頁選位置：經過連結（junction）選的位置記成實際路徑；vault 裡的位置被拒、原因寫得出來，位置不變', async t => {
  const vault = await tempFolder(t, 'essence-vault-');
  const outside = await tempFolder(t);
  const target = join(outside, '真的位置');
  await mkdir(target);
  const link = join(outside, '捷徑');
  await symlink(target, link, 'junction');
  const { plugin } = fakePlugin();
  const wiring = wireBackup({ plugin, desktop: await createDesktop(vault), files: createMemoryFiles().files, build: '0.2.0+1a2b3c4', changed() {}, notify() {}, failed() {} });
  assert.equal(wiring.custom(), null);
  assert.equal(await wiring.useFolder(link), null);
  assert.equal(wiring.custom(), await realpath(target));
  assert.match(await wiring.useFolder(join(vault, '備份')) ?? '', /在 vault 裡（以實際路徑判斷），不能放在 vault 裡/);
  assert.equal(wiring.custom(), await realpath(target));
});
