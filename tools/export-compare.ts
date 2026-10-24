// 把 tests/deck.test.ts 登錄的全部卡組範例，加上 W5 說明 §0-3 的 M1～M3，
// 寫成 <vault>/Essence W5/對照/cases.json；Obsidian 的開發命令 compare 讀它、寫成筆記再對照。
// 用法：npm run export-compare -- <vault>
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const vault = process.argv[2];
if (!vault || process.argv.length !== 3) throw Error('用法：npm run export-compare -- <vault>');
if (!(await stat(vault)).isDirectory()) throw Error('vault 必須是已存在的資料夾');

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'essence-cases-'));
try {
  const out = join(temp, 'cases.json');
  await promisify(execFile)(process.execPath, ['--test', 'tests/deck.test.ts'], { cwd: root, env: { ...process.env, ESSENCE_DECK_CASES: out } });
  const texts = JSON.parse(await readFile(out, 'utf8')) as string[];
  // 檔名 D001… 照登錄順序；內容就是那個例子，cases.json 是對照表。
  const cases = texts.map((text, i) => ({ name: 'D' + String(i + 1).padStart(3, '0'), text }));
  cases.push(
    { name: 'M1', text: '- 目標\n        - Q :: A' },
    { name: 'M2a', text: '- 目標\n    - Q :: A\n隨手一行\n    - R :: B' },
    { name: 'M2b', text: '- 目標\n  - Q :: A\n隨手一行\n  - R :: B' },
    { name: 'M3', text: '- 目標\n    - Q :: A\n\n隨手一行\n\n    - R :: B' },
  );
  const folder = resolve(vault, 'Essence W5/對照');
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'cases.json'), JSON.stringify(cases, null, 1));
  console.log(`已匯出 ${cases.length} 個例子（測試 ${texts.length} 個、M 系列 4 個）`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
