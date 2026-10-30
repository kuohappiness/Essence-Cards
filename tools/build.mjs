import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
// 由 Obsidian 提供、不打包的套件（照官方範例外掛）：CodeMirror 只能用 Obsidian 那一份（W5 §8-2 第 2 點）。
const external = ['obsidian', '@codemirror/state', '@codemirror/view'];

/**
 * 「版本」命令顯示的建置版本：manifest 的版本加 git commit（有未提交的修改時加 .dirty）。寫進 main.js、不在執行時讀
 * manifest：iCloud 可能先同步到新的 manifest、main.js 還是舊的（更新與相容的規畫第 1 點）；iPhone 測試靠它確認跑的是哪一次建置。
 * 過渡的備份工具也用它當清單的 tool（syntax §8）。
 */
export async function buildVersion(root = defaultRoot) {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  // 拿掉繼承來的 git 環境變數（名稱不分大小寫）：在 git hook 裡跑時 GIT_DIR 指著呼叫的 repo，會讀到別的 repo 的 commit
  // （同 tools/git.ts；這個檔在測試裡會單獨複製到暫存專案，所以不 import）。
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const git = args => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let commit = '';
  try { commit = git(['rev-parse', '--short', 'HEAD']) + (git(['status', '--porcelain', '--untracked-files=no']) ? '.dirty' : ''); } catch { /* 不在 git 裡（測試的暫存專案） */ }
  return manifest.version + (commit ? '+' + commit : '');
}

/**
 * 建置 main.js 與 styles.css 到 outdir（預設是 repo 根目錄）。dev 加上給 AI 測試與量測的開發命令；正式建置時 DEV 是 false，
 * 整段被拿掉。main.js 第一行寫 `/*! Essence Cards build=<BUILD> dev=<true|false> *\/`：安裝命令與備份工具從產出讀它
 * （D-149 第 4 點：不只看 BUILD 有沒有 .dirty）。
 * sourcemap：對照表（main.js.map）另外寫到這個路徑（D-155 第 5 點）；用 esbuild 的 external，main.js 逐位元組不變、
 * 不加 sourceMappingURL。sources 改成相對 repo 根目錄，內容（sourcesContent）一起存，定位時不用那一版的原始碼。
 */
export async function buildPlugin({ root = defaultRoot, dev = false, outdir = root, sourcemap } = {}) {
  const version = await buildVersion(root);
  await mkdir(outdir, { recursive: true });
  const outfile = resolve(outdir, 'main.js');
  const result = await build({
    absWorkingDir: root, entryPoints: ['src/main.ts'], outfile,
    bundle: true, minify: true, format: 'cjs', platform: 'browser', target: 'es2022',
    jsx: 'automatic', external, metafile: true, sourcemap: sourcemap ? 'external' : false,
    banner: { js: `/*! Essence Cards build=${version} dev=${dev} */` },
    define: { 'process.env.NODE_ENV': '"production"', DEV: String(dev), BUILD: JSON.stringify(version) },
  });
  // 測試用：寫出 esbuild 的 metafile，檢查真正的建置含了哪些檔案（不另抄一份建置選項）。
  if (process.env.ESSENCE_METAFILE) await writeFile(process.env.ESSENCE_METAFILE, JSON.stringify(result.metafile));
  if (sourcemap) {
    const map = JSON.parse(await readFile(outfile + '.map', 'utf8'));
    // esbuild 的 sources 相對輸出資料夾；輸出和 repo 在不同磁碟（例如暫存資料夾在 C:）時是 file: 網址。
    const absolute = source => source.startsWith('file:') ? fileURLToPath(source) : resolve(outdir, source);
    map.sources = map.sources.map(source => relative(root, absolute(source)).replaceAll('\\', '/'));
    await rm(outfile + '.map');
    await mkdir(dirname(resolve(sourcemap)), { recursive: true });
    await writeFile(resolve(sourcemap), JSON.stringify(map));
  }
  const code = await readFile(outfile, 'utf8');
  const requires = [...code.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(m => m[1]);
  const imports = Object.values(result.metafile.outputs).flatMap(out => out.imports);
  if (requires.some(name => !external.includes(name)) || imports.some(i => i.external && !external.includes(i.path))) {
    throw Error('建置含有 ' + external.join('、') + ' 以外的外部相依：' + requires.join(', '));
  }
  // 另一份 CodeMirror 被打包進來時，類別身分和 Obsidian 的不同，編輯器的擴充會失效。
  const bundled = Object.keys(result.metafile.inputs).filter(path => path.replaceAll('\\', '/').includes('node_modules/@codemirror/'));
  if (bundled.length) throw Error('CodeMirror 被打包進 main.js：' + bundled.join(', '));
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
  await writeFile(resolve(outdir, 'styles.css'), (await Promise.all(css.map(path => readFile(path, 'utf8')))).join('\n'));
  console.log(`main.js ${Buffer.byteLength(code)} bytes; require: ${[...new Set(requires)].sort().join(', ')}; version ${version}`);
  return { version, dev };
}

if (import.meta.main) {
  const at = process.argv.indexOf('--sourcemap');
  const sourcemap = at < 0 ? undefined : process.argv[at + 1];
  if (at >= 0 && (!sourcemap || sourcemap.startsWith('--'))) throw Error('用法：node tools/build.mjs [--dev] [--sourcemap <對照表的路徑>]');
  await buildPlugin({ dev: process.argv.includes('--dev'), sourcemap });
}
