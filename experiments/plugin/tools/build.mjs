import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const preview = process.argv[2] === 'preview';
const aliases = { react: 'preact/compat', 'react-dom': 'preact/compat', 'react-dom/client': 'preact/compat/client', 'react/jsx-runtime': 'preact/jsx-runtime', 'react/jsx-dev-runtime': 'preact/jsx-dev-runtime' };
if (preview) {
  await mkdir('dist/preview', { recursive: true });
  for (const framework of ['react', 'preact']) {
    await build({ entryPoints: ['preview/main.tsx'], outfile: 'dist/preview/' + framework + '.js', bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } }, alias: { ...(framework === 'preact' ? aliases : {}), obsidian: resolve('preview/obsidian.ts') }, define: { 'process.env.NODE_ENV': '"production"' } });
  }
  await copyFile('src/Review.css', 'dist/preview/styles.css');
  await copyFile('preview/index.html', 'dist/preview/index.html');
} else {
  for (const framework of ['react', 'preact']) {
    const dir = 'dist/essence-t2-' + framework;
    await mkdir(dir, { recursive: true });
    const result = await build({ entryPoints: ['src/main.ts'], outfile: dir + '/main.js', bundle: true, minify: true, format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic', tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } }, external: ['obsidian'], alias: framework === 'preact' ? aliases : {}, define: { 'process.env.NODE_ENV': '"production"', __EC_FRAMEWORK__: JSON.stringify(framework) }, banner: { js: 'var __ecT0 = performance.now();' }, metafile: true });
    if (framework === 'react' && !Object.keys(result.metafile.inputs).some(p => /node_modules\/react-dom\//.test(p))) throw Error('React build must include react-dom');
    const code = await readFile(dir + '/main.js', 'utf8');
    const requires = [...code.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(m => m[1]);
    if (requires.some(name => name !== 'obsidian')) throw Error('Unexpected require: ' + requires);
    if (framework === 'preact' && Object.keys(result.metafile.inputs).some(p => /node_modules\/(react|react-dom)\//.test(p))) throw Error('React leaked into Preact');
    await writeFile(dir + '/manifest.json', JSON.stringify({ id: 'essence-t2-' + framework, name: 'Essence T2 (' + (framework === 'react' ? 'React' : 'Preact') + ')', version: '0.1.0', minAppVersion: '1.8.0', description: 'T2 複習畫面與 T3 自動量測試作', author: 'Essence Cards', isDesktopOnly: false }, null, 2));
    await copyFile('src/Review.css', dir + '/styles.css');
    await writeFile(dir + '/meta.json', JSON.stringify(result.metafile));
    console.log(framework + ': main.js ' + Buffer.byteLength(code) + ' bytes; require: ' + [...new Set(requires)].join(', ') + '; dependency graph OK');
  }
}
