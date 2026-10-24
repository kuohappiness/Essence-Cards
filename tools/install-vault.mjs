import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// build.mjs 自己讀 process.argv 的 --dev。
const args = process.argv.slice(2);
const vault = args.find(arg => arg !== '--dev');
if (!vault || args.length !== (args.includes('--dev') ? 2 : 1)) throw Error('用法：npm run install-vault -- <vault> [--dev]');
if (!(await stat(vault)).isDirectory()) throw Error('vault 必須是已存在的資料夾');
await import('./build.mjs');
const destination = resolve(vault, '.obsidian/plugins/essence-cards');
await mkdir(destination, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) {
  await copyFile(fileURLToPath(new URL('../' + name, import.meta.url)), resolve(destination, name));
}
// 只動這個 vault 的外掛清單：沒有 essence-cards 才加上。
const list = resolve(vault, '.obsidian/community-plugins.json');
let enabled = [];
try { enabled = JSON.parse(await readFile(list, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!enabled.includes('essence-cards')) await writeFile(list, JSON.stringify([...enabled, 'essence-cards'], null, 2));
console.log('已安裝 Essence Cards' + (args.includes('--dev') ? '（開發版）' : ''));
