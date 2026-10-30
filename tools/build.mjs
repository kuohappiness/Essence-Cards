import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
// 由 Obsidian 提供、不打包的套件（照官方範例外掛）：CodeMirror 只能用 Obsidian 那一份（W5 §8-2 第 2 點）。
const external = ['obsidian', '@codemirror/state', '@codemirror/view'];
/** D-148：只有電腦專用的資料夾能用 Node 與 Electron，而且只能用明列的這幾個（不放寬全域的 external）。 */
export const DESKTOP = 'src/desktop/';
export const DESKTOP_ONLY = ['electron', 'node:crypto', 'node:fs/promises', 'node:os', 'node:path'];

/**
 * D-148 第 3 點的建置檢查（esbuild 外掛）：Node 的內建模組與 Electron 只在 src/desktop/ 裡引入、而且在明列的清單裡時才當成外部模組；
 * 其他檔案（含第三方套件的傳遞相依）引入就讓建置失敗，說出是哪個檔。測試打包 src/main.ts 時也用它。
 */
export function desktopOnly(root = defaultRoot) {
  return {
    name: 'essence-desktop-only',
    setup(build) {
      build.onResolve({ filter: /^(node:|electron$)/ }, args => {
        const from = relative(root, args.importer).replaceAll('\\', '/');
        if (from.startsWith(DESKTOP) && DESKTOP_ONLY.includes(args.path)) return { path: args.path, external: true };
        return { errors: [{ text: `${args.path} 只有 ${DESKTOP} 能用，而且要在明列的清單裡（D-148）：${from} 不行` }] };
      });
    },
  };
}

/**
 * metafile 的第二道檢查（D-148 第 3 點）：每個外部模組由哪個檔引入。Obsidian 提供的那幾個哪裡都能用；DESKTOP_ONLY 只能由 src/desktop/
 * 的檔引入；src/desktop/ 只能由 src/main.ts 動態 import（不經共用的重新匯出檔）。回傳違規的「檔 → 模組」。
 */
export function desktopViolations(metafile) {
  const bad = [];
  for (const [file, input] of Object.entries(metafile.inputs)) {
    const from = file.replaceAll('\\', '/');
    for (const item of input.imports) {
      const to = item.path.replaceAll('\\', '/');
      if (item.external && !external.includes(to) && !(DESKTOP_ONLY.includes(to) && from.startsWith(DESKTOP))) bad.push(`${from} → ${to}`);
      if (!item.external && to.startsWith(DESKTOP) && !from.startsWith(DESKTOP) && !(from === 'src/main.ts' && item.kind === 'dynamic-import')) bad.push(`${from} → ${to}`);
    }
  }
  return bad;
}

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
 */
export async function buildPlugin({ root = defaultRoot, dev = false, outdir = root } = {}) {
  const version = await buildVersion(root);
  await mkdir(outdir, { recursive: true });
  const outfile = resolve(outdir, 'main.js');
  const result = await build({
    absWorkingDir: root, entryPoints: ['src/main.ts'], outfile,
    bundle: true, minify: true, format: 'cjs', platform: 'browser', target: 'es2022',
    jsx: 'automatic', external, metafile: true, plugins: [desktopOnly(root)],
    banner: { js: `/*! Essence Cards build=${version} dev=${dev} */` },
    define: { 'process.env.NODE_ENV': '"production"', DEV: String(dev), BUILD: JSON.stringify(version) },
  });
  // 測試用：寫出 esbuild 的 metafile，檢查真正的建置含了哪些檔案（不另抄一份建置選項）。
  if (process.env.ESSENCE_METAFILE) await writeFile(process.env.ESSENCE_METAFILE, JSON.stringify(result.metafile));
  const code = await readFile(outfile, 'utf8');
  const requires = [...code.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(m => m[1]);
  const imports = Object.values(result.metafile.outputs).flatMap(out => out.imports);
  const allowed = [...external, ...DESKTOP_ONLY];
  if (requires.some(name => !allowed.includes(name)) || imports.some(i => i.external && !allowed.includes(i.path))) {
    throw Error('建置含有 ' + allowed.join('、') + ' 以外的外部相依：' + requires.join(', '));
  }
  const violations = desktopViolations(result.metafile);
  if (violations.length) throw Error('Node 或 Electron 只能在 ' + DESKTOP + ' 裡用，而且只由 src/main.ts 動態載入（D-148）：' + violations.join('、'));
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
  const listed = names => [...new Set(names)].sort().join(', ');
  console.log(`main.js ${Buffer.byteLength(code)} bytes; require: ${listed(requires.filter(name => external.includes(name)))}; desktop: ${listed(requires.filter(name => DESKTOP_ONLY.includes(name)))}; version ${version}`);
  return { version, dev };
}

if (import.meta.main) await buildPlugin({ dev: process.argv.includes('--dev') });
