import { exec } from 'node:child_process';
import { mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { ESSENCE_ROOT, PLUGIN_DATA, hashBytes, lastVersions, openBackup, readBuild } from '../src/core/backup/index.ts';
import type { BackupManifest } from '../src/core/backup/index.ts';
import { formatTime, isLogPath } from '../src/core/study/index.ts';
import { backupVault } from './backup.ts';
import { compareVersions, LIMITS } from './compare-versions.ts';
import { examReminder, SCOPE_FOLDER } from './exam-reminder.ts';
import { git, gitEnv } from './git.ts';
import type { Reminder } from './exam-reminder.ts';
import { installVault, isTestVault, localFolder, releaseProblems } from './install.ts';
import { listTree, pluginConfig } from './vault-io.ts';

const shell = promisify(exec);
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
export const RESTART = 'iPhone 等 iCloud 同步完後，把 Obsidian 完全關掉再開，才會換成新版（電腦也一樣）。';

export interface UpdateOptions {
  vault: string;
  config?: string;
  /** 備份放哪裡；預設是 backup.ts 的預設位置。 */
  to?: string;
  root?: string;
  local?: string;
  now?: () => number;
  offset?: (ms: number) => number;
  /** --install：考前 7 天內、考試期間或讀不到考試範圍時要有，維護的 AI 先問過使用者才加。 */
  examOk?: boolean;
  /** 測試用：換掉 npm run check、發布前比較、安裝。 */
  seams?: { check?: (root: string) => Promise<void>; compare?: typeof compareVersions; install?: typeof installVault };
}

/** --check 記下的這一次：--install 用它確認還是同一個 vault、同一個 HEAD，而且資料沒變。 */
interface CheckRecord {
  vault: string;
  head: string;
  test: boolean;
  backup: string;
  backupSha: string;
  report: string;
  baseline: { commit: string; build: string } | { missing: string };
  created: string;
}
export interface CheckResult extends Omit<CheckRecord, 'created'> {
  exam: Reminder;
  differences: number | null;
  devices: ReturnType<typeof lastVersions>;
  notes: string;
}

const npmCheck = async (root: string): Promise<void> => {
  try {
    await shell('npm run check', { cwd: root, env: gitEnv(), maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const out = String((error as { stdout?: string }).stdout ?? '') + String((error as { stderr?: string }).stderr ?? '');
    throw Error('npm run check 沒有通過：\n' + out.split('\n').slice(-40).join('\n'));
  }
};

/** 生效中的考試範圍的提醒；列不出或讀不到就是 unreadable，不當成沒有考試。 */
async function reminder(vault: string, now: number, offset: number): Promise<Reminder> {
  let paths: string[];
  try { paths = (await listTree(vault, SCOPE_FOLDER)).filter(path => path.endsWith('.md')); } catch (error) {
    return { kind: 'unreadable', needsOk: true, message: '列不出考試範圍的資料夾（' + (error as Error).message + '），不當成沒有考試；這一版可以考後再裝，由家長決定' };
  }
  const scopes = await Promise.all(paths.map(async path => ({ path, text: await readFile(join(vault, path), 'utf8').catch(() => null) })));
  return examReminder(scopes, now, offset);
}

/**
 * 舊版的基線（任務說明 1-3 的第一次規則）：vault 裡現在的 main.js 和某一份 .local/releases/ 的雜湊相同就用那一份的 commit；
 * 否則讀它的 BUILD，有 commit、不帶 .dirty、repo 裡找得到就用那個 commit；都不行就是基線缺失（由使用者決定要不要照樣裝）。
 */
export async function baseline(mainJs: Uint8Array | null, local: string, root: string): Promise<CheckRecord['baseline']> {
  if (mainJs === null) return { missing: '這個 vault 還沒裝過外掛' };
  const sha = hashBytes(mainJs);
  let versions: string[] = [];
  try { versions = await readdir(join(local, 'releases')); } catch { /* 還沒有正式產物 */ }
  for (const version of versions) {
    try {
      const release = JSON.parse(await readFile(join(local, 'releases', version, 'release.json'), 'utf8')) as { build: string; commit: string; sha256: Record<string, string> };
      if (release.sha256['main.js'] === sha) return { commit: release.commit, build: release.build };
    } catch { /* 讀不懂的紀錄不算 */ }
  }
  const { build } = readBuild(new TextDecoder().decode(mainJs));
  if (build === null) return { missing: '讀不出 vault 裡 main.js 的建置版本' };
  const commit = build.split('+')[1] ?? '';
  if (!commit) return { missing: `main.js 的建置版本 ${build} 沒有 commit` };
  if (commit.endsWith('.dirty')) return { missing: `main.js 的建置版本 ${build} 是有未提交修改的建置，對不到任何 commit` };
  try { return { commit: git(root, ['rev-parse', '--verify', commit + '^{commit}']), build }; } catch {
    return { missing: `repo 裡找不到 main.js 的 commit ${commit}` };
  }
}

/**
 * --check 之後卡組與 data.json 有沒有變（任務說明 1-5）：和那份備份的清單比雜湊；紀錄只多了後面的行可以，新的紀錄檔也可以。
 * 回傳變了的路徑。
 */
export function changedSince(manifest: BackupManifest, backup: ReadonlyMap<string, Uint8Array>, current: ReadonlyMap<string, Uint8Array>): string[] {
  const changed: string[] = [];
  const listed = new Set(manifest.files.map(file => file.path));
  for (const file of manifest.files) {
    const now = current.get(file.path);
    if (!now) { changed.push(file.path); continue; }
    if (hashBytes(now) === file.sha256) continue;
    const old = backup.get(file.path)!;
    if (isLogPath(file.path) && old.length <= now.length && old.every((byte, i) => now[i] === byte)) continue;
    changed.push(file.path);
  }
  for (const path of current.keys()) if (!listed.has(path) && !isLogPath(path)) changed.push(path);
  return changed.sort();
}

async function snapshot(vault: string, config: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const path of [...await listTree(vault, ESSENCE_ROOT), config + '/' + PLUGIN_DATA]) {
    try { files.set(path, new Uint8Array(await readFile(join(vault, path)))); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return files;
}

const recordPath = (local: string): string => join(local, 'update-check.json');

/**
 * `--check`（D-149 第 6 點、D-150 第 9 點；任務說明 1-5）：正式版的條件 → npm run check → 考前提醒 → 備份 → 發布前比較 →
 * 印出摘要，記下這次的備份與報告。登錄過的測試 vault 不查正式版的條件（演練用）。
 */
export async function checkUpdate(options: UpdateOptions): Promise<CheckResult> {
  const root = options.root ?? defaultRoot;
  const local = options.local ?? localFolder(root);
  const now = Math.trunc((options.now ?? Date.now)());
  const offset = (options.offset ?? (ms => -new Date(ms).getTimezoneOffset()))(now);
  const vault = await realpath(options.vault);
  const config = await pluginConfig(vault, options.config);
  const test = await isTestVault(vault, local);
  if (!test) {
    const { problems } = await releaseProblems(root);
    if (problems.length) throw Error('正式使用的 vault 只裝正式版，條件不符：\n- ' + problems.join('\n- '));
  }
  await (options.seams?.check ?? npmCheck)(root);
  const exam = await reminder(vault, now, offset);
  const made = await backupVault({ vault, to: options.to, config, by: 'update-vault', now: options.now, offset: options.offset });
  const zip = new Uint8Array(await readFile(made.path));
  const opened = openBackup(zip);
  if (!opened.ok) throw Error('剛做的備份讀不回來：' + opened.error);
  const head = git(root, ['rev-parse', 'HEAD']);
  const installed = await readFile(join(vault, config, 'plugins/essence-cards/main.js')).then(bytes => new Uint8Array(bytes), () => null);
  const base = await baseline(installed, local, root);
  let report: string;
  let differences: number | null = null;
  if ('commit' in base) {
    const compared = await (options.seams?.compare ?? compareVersions)({ backup: made.path, old: base.commit, new: head, root, now: options.now });
    report = compared.report;
    differences = compared.comparable ? compared.differences.length : null;
  } else {
    // 基線缺失：照樣寫一份報告，說明比不了的原因，由使用者決定要不要照樣裝。
    const stamp = formatTime(now, offset);
    report = join(dirname(made.path), `發布前比較 ${stamp.slice(0, 10)} ${stamp.slice(11, 19).replaceAll(':', '')} 基線缺失.md`);
    await writeFile(report, [`# 發布前比較：基線缺失`, '', `- 輸入：${made.path}`, `- 輸入的 SHA-256：${hashBytes(zip)}`,
      `- 新版：${head}`, `- 比較時間：${stamp}`, `- 基線缺失：${base.missing}`, `- 限制：${LIMITS}`, '', '舊版確定不了，沒有比較；由使用者決定要不要照樣裝。', ''].join('\n'), { flag: 'wx' });
  }
  const decoder = new TextDecoder();
  const devices = lastVersions([...opened.value.files].map(([path, bytes]) => ({ path, text: decoder.decode(bytes) })));
  let notes = '';
  try { notes = git(root, ['tag', '-l', '--format=%(contents)', 'v' + (JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as { version: string }).version]); } catch { /* 沒有 tag */ }
  const record: CheckRecord = { vault, head, test, backup: made.path, backupSha: hashBytes(zip), report, baseline: base, created: formatTime(now, offset) };
  await mkdir(local, { recursive: true });
  await writeFile(recordPath(local), JSON.stringify(record, null, 2) + '\n');
  return { ...record, exam, differences, devices, notes };
}

/**
 * `--install`：重新確認 --check 之後 HEAD 沒變、卡組與 data.json 沒變（紀錄只多了後面的行可以），變了就要求重跑 --check；
 * 考前提醒在範圍內時要有 --exam-ok；然後照 tools/install.ts 安裝。
 */
export async function installUpdate(options: UpdateOptions): Promise<{ build: string; kind: string }> {
  const root = options.root ?? defaultRoot;
  const local = options.local ?? localFolder(root);
  const now = Math.trunc((options.now ?? Date.now)());
  const offset = (options.offset ?? (ms => -new Date(ms).getTimezoneOffset()))(now);
  const vault = await realpath(options.vault);
  const config = await pluginConfig(vault, options.config);
  let record: CheckRecord;
  try { record = JSON.parse(await readFile(recordPath(local), 'utf8')) as CheckRecord; } catch { throw Error('還沒跑 --check'); }
  if (record.vault !== vault) throw Error(`上一次 --check 是 ${record.vault}，不是這個 vault；先跑 --check`);
  if (git(root, ['rev-parse', 'HEAD']) !== record.head) throw Error('HEAD 在 --check 之後換了；重跑 --check');
  const zip = new Uint8Array(await readFile(record.backup));
  if (hashBytes(zip) !== record.backupSha) throw Error('--check 的備份檔變了；重跑 --check');
  const opened = openBackup(zip);
  if (!opened.ok) throw Error('--check 的備份讀不回來：' + opened.error);
  const changed = changedSince(opened.value.manifest, opened.value.files, await snapshot(vault, config));
  if (changed.length) throw Error('卡組或 data.json 在 --check 之後改了，重跑 --check：\n- ' + changed.join('\n- '));
  const exam = await reminder(vault, now, offset);
  if (exam.needsOk && !options.examOk) throw Error(exam.message + '。要照樣裝，先問過使用者再加 --exam-ok');
  const result = await (options.seams?.install ?? installVault)({ vault, config, root, local });
  await rm(recordPath(local), { force: true });
  return { build: result.build, kind: result.kind };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    check: { type: 'boolean' }, install: { type: 'boolean' }, 'exam-ok': { type: 'boolean' }, config: { type: 'string' }, to: { type: 'string' },
  } });
  if (positionals.length !== 1 || !!values.check === !!values.install || (values['exam-ok'] && !values.install)) {
    throw Error('用法：npm run update-vault -- <vault> --check [--to <備份資料夾>] [--config <設定資料夾>]\n　　　npm run update-vault -- <vault> --install [--exam-ok] [--config <設定資料夾>]');
  }
  const options = { vault: positionals[0], config: values.config, to: values.to, examOk: values['exam-ok'] };
  if (values.check) {
    const result = await checkUpdate(options);
    console.log(`考前提醒：${result.exam.message}`);
    console.log(`備份：${result.backup}`);
    console.log('baseline' in result && 'missing' in result.baseline ? `發布前比較：基線缺失（${result.baseline.missing}）` : `發布前比較：${result.differences === null ? '無法比較' : `差異 ${result.differences} 項`}`);
    console.log(`報告：${result.report}`);
    console.log('各裝置最後回報的版本（不是即時狀態：還沒同步、還沒重開的裝置看不出來）：');
    for (const row of result.devices.filter(device => device.note !== '還原檔')) console.log(`- ${row.device}${row.note ? '（' + row.note + '）' : ''}：${row.build ?? '不確定'}，${row.t}`);
    if (result.devices.length === 0) console.log('- 還沒有裝置回報過');
    console.log(result.notes ? '這一版的更新說明（tag）：\n' + result.notes : '沒有找到這一版的 tag 說明');
    if (result.test) console.log('（登錄過的測試 vault：沒有查正式版的條件）');
  } else {
    const result = await installUpdate(options);
    console.log(`已安裝 ${result.build}（${result.kind}）`);
    console.log(RESTART);
  }
}
