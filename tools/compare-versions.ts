import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hashBytes, openBackup } from '../src/core/backup/index.ts';
import { formatTime, parseTime } from '../src/core/study/index.ts';
import type { AdapterInput } from './compare/adapter.ts';
import { diffSnapshots } from './compare/snapshot.ts';
import type { AdapterResult } from './compare/snapshot.ts';

const run = promisify(execFile);
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const ADAPTER = fileURLToPath(new URL('compare/adapter.ts', import.meta.url));
// 拿掉繼承來的 GIT_*：在 git hook 裡跑時 GIT_DIR 指著呼叫的 repo（tools/install.ts 的 git）。
const env = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (root: string, args: string[]): string => execFileSync('git', args, { cwd: root, env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export const LIMITS = '考試範圍（`exam`）目前是 null：沒有比到考前提高的保持率與考前的排序。設定用外掛的預設（每日 30 分鐘、保持率 0.8、沒有濾網）。到期日固定現有紀錄，不模擬之後的作答。';

export interface CompareOptions {
  /** 凍結的輸入：1-1 的備份檔。 */
  backup: string;
  /** 兩邊的 commit（或 tag、分支）。 */
  old: string;
  new: string;
  /** repo 根目錄；測試用暫存的 repo。 */
  root?: string;
  /** 報告寫到哪個資料夾；預設是備份檔旁邊（不進 repo）。 */
  out?: string;
  /** 測試用：在 worktree 裡裝相依套件，預設照那個版本的 lockfile `npm ci`。 */
  install?: (dir: string) => Promise<void>;
  now?: () => number;
}
export interface Side { commit: string; build: string; result: AdapterResult }
export interface CompareResult { report: string; zip: string; old: Side; new: Side; comparable: boolean; differences: string[] }

const npmCi = async (dir: string): Promise<void> => {
  // --ignore-scripts：prepare 會改 git 設定，這裡只要相依套件。
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir, env: env(), shell: process.platform === 'win32' });
};

/** 一個版本：開 worktree、裝相依、在自己的 Node 程序跑轉接器；結束後拿掉 worktree。接不上就是 ok: false。 */
async function side(root: string, ref: string, input: string, work: string, install: (dir: string) => Promise<void>): Promise<Side> {
  const commit = git(root, ['rev-parse', '--verify', ref + '^{commit}']);
  const version = (JSON.parse(git(root, ['show', commit + ':manifest.json'])) as { version: string }).version;
  const build = version + '+' + git(root, ['rev-parse', '--short', commit]);
  const dir = join(work, commit.slice(0, 12));
  const output = join(work, commit.slice(0, 12) + '.json');
  git(root, ['worktree', 'add', '--detach', dir, commit]);
  try {
    await install(dir);
    try { await run(process.execPath, [ADAPTER, dir, input, output], { cwd: dir, env: env(), maxBuffer: 64 * 1024 * 1024 }); }
    catch (error) { return { commit, build, result: { ok: false, reason: '轉接器沒有跑完：' + (error as Error).message } }; }
    return { commit, build, result: JSON.parse(await readFile(output, 'utf8')) as AdapterResult };
  } finally {
    // 不用 git worktree remove：Windows 上它會順著 junction 刪掉連結指到的內容（2026-10-29 測試的 node_modules junction
    // 因此把 repo 的 node_modules 刪光）。Node 的 rm 只拿掉連結本身；資料夾刪掉之後 prune 掉 git 的紀錄。
    await rm(dir, { recursive: true, force: true });
    try { git(root, ['worktree', 'prune']); } catch { /* 不影響結果 */ }
  }
}

/**
 * 發布前比較（D-149 第 5 點、任務說明 1-3）：用備份當凍結的輸入（記下 zip 的雜湊），兩個版本各自讀一次，
 * 比每篇卡組的學習目標、題目指紋、問題、會影響排程的屬性，以及每個目標的下次到期、今天的份與未來 30 天每天的到期數。
 * 報告寫到備份檔旁邊（不進 repo，D-003）。
 */
export async function compareVersions(options: CompareOptions): Promise<CompareResult> {
  const root = options.root ?? defaultRoot;
  const bytes = new Uint8Array(await readFile(options.backup));
  const opened = openBackup(bytes);
  if (!opened.ok) throw Error('這份備份不能用：' + opened.error);
  const zip = hashBytes(bytes);
  const started = parseTime(opened.value.manifest.started)!;
  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  for (const [path, content] of opened.value.files) {
    if (path.startsWith('Essence Cards/') && (path.endsWith('.md') || path.endsWith('.jsonl'))) files[path] = decoder.decode(content);
  }
  const work = await mkdtemp(join(tmpdir(), 'essence-compare-'));
  let old: Side, next: Side;
  try {
    const input = join(work, 'input.json');
    await writeFile(input, JSON.stringify({ now: started.at, offset: started.offset, files } satisfies AdapterInput));
    old = await side(root, options.old, input, work, options.install ?? npmCi);
    next = await side(root, options.new, input, work, options.install ?? npmCi);
  } finally {
    await rm(work, { recursive: true, force: true });
    try { git(root, ['worktree', 'prune']); } catch { /* 不影響結果 */ }
  }
  const time = (ms: number): string => formatTime(ms, started.offset).slice(0, 16).replace('T', ' ');
  const comparable = old.result.ok && next.result.ok;
  const differences = old.result.ok && next.result.ok ? diffSnapshots(old.result.snapshot, next.result.snapshot, time) : [];
  const now = (options.now ?? Date.now)();
  const stamp = formatTime(now, started.offset);
  const lines = [
    `# 發布前比較 ${old.build} → ${next.build}`, '',
    `- 輸入：${options.backup}`, `- 輸入的 SHA-256：${zip}`, `- 「現在」：備份開始的時間 ${opened.value.manifest.started}`,
    `- 舊版：${old.build}（${old.commit}）`, `- 新版：${next.build}（${next.commit}）`, `- 比較時間：${stamp}`, `- 限制：${LIMITS}`, '',
  ];
  if (!comparable) {
    lines.push('## 無法比較', '');
    for (const [name, one] of [['舊版', old], ['新版', next]] as const) if (!one.result.ok) lines.push(`- ${name}：${one.result.reason}`);
  } else if (differences.length === 0) lines.push('## 差異', '', '沒有差異。');
  else lines.push(`## 差異（${differences.length} 項）`, '', '每一項都要對得到這一版的更新說明（tag 的說明）。', '', ...differences.map(line => '- ' + line));
  const folder = options.out ?? dirname(options.backup);
  const report = join(folder, `發布前比較 ${stamp.slice(0, 10)} ${stamp.slice(11, 19).replaceAll(':', '')} ${old.build} 到 ${next.build}.md`);
  await writeFile(report, lines.join('\n') + '\n', { flag: 'wx' });
  return { report, zip, old, new: next, comparable, differences };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw Error('用法：npm run compare-versions -- <備份檔> <舊 commit> <新 commit>');
  const result = await compareVersions({ backup: args[0], old: args[1], new: args[2] });
  console.log(`報告：${result.report}`);
  console.log(result.comparable ? `差異 ${result.differences.length} 項` : '無法比較（理由在報告裡）');
}
