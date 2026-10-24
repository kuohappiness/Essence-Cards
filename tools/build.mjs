import { build } from 'esbuild';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// --dev 加上給 AI 測試與量測的開發命令；正式建置時 DEV 是 false，整段被拿掉。
const dev = process.argv.includes('--dev');
const result = await build({
  absWorkingDir: root, entryPoints: ['src/main.ts'], outfile: 'main.js',
  bundle: true, minify: true, format: 'cjs', platform: 'browser', target: 'es2022',
  jsx: 'automatic', external: ['obsidian'], metafile: true,
  define: { 'process.env.NODE_ENV': '"production"', DEV: String(dev) },
});
const code = await readFile(resolve(root, 'main.js'), 'utf8');
const requires = [...code.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(m => m[1]);
const imports = Object.values(result.metafile.outputs).flatMap(out => out.imports);
if (requires.some(name => name !== 'obsidian') || imports.some(i => i.external && i.path !== 'obsidian')) {
  throw Error('建置含有 obsidian 以外的外部相依：' + requires.join(', '));
}
const css = [];
for (const entry of await readdir(resolve(root, 'src'), { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.css')) css.push(resolve(entry.parentPath, entry.name));
}
const key = path => relative(root, path).replaceAll('\\', '/');
css.sort((a, b) => {
  if (key(a) === 'src/ui/tokens.css') return -1;
  if (key(b) === 'src/ui/tokens.css') return 1;
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
});
await writeFile(resolve(root, 'styles.css'), (await Promise.all(css.map(path => readFile(path, 'utf8')))).join('\n'));
console.log(`main.js ${Buffer.byteLength(code)} bytes; require: ${[...new Set(requires)].join(', ')}`);
