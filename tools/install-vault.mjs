import { copyFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const vault = process.argv[2];
if (!vault || process.argv.length !== 3) throw Error('用法：npm run install-vault -- <vault>');
if (!(await stat(vault)).isDirectory()) throw Error('vault 必須是已存在的資料夾');
await import('./build.mjs');
const destination = resolve(vault, '.obsidian/plugins/essence-cards');
await mkdir(destination, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  await copyFile(fileURLToPath(new URL('../' + name, import.meta.url)), resolve(destination, name));
}
console.log('已安裝 Essence Cards');
