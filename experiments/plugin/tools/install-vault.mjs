import { access, cp, mkdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const arg = process.argv[2];
if (!arg) throw Error('用法：npm run install-vault -- <vault 路徑>');
const vault = resolve(arg);
if (!(await stat(vault)).isDirectory() || !(await stat(join(vault, '.obsidian'))).isDirectory()) throw Error('路徑必須是已有 .obsidian 的 vault');
for (const name of ['essence-t2-react', 'essence-t2-preact']) for (const file of ['main.js', 'manifest.json', 'styles.css']) await access(join('dist', name, file));
for (const name of ['essence-t2-react', 'essence-t2-preact']) {
  const dest = join(vault, '.obsidian', 'plugins', name);
  await mkdir(dest, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await cp(join('dist', name, file), join(dest, file));
}
console.log('兩個外掛已安裝。');
