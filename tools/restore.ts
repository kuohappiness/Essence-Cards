import { randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ESSENCE_ROOT, PLUGIN_DATA, hashBytes, openBackup, planRestore, restoreLogName } from '../src/core/backup/index.ts';
import type { OpenedBackup, PlannedFile, RestorePlan } from '../src/core/backup/index.ts';
import { formatTime, LOG_FOLDER } from '../src/core/study/index.ts';
import { backupVault } from './backup.ts';
import { assertNoLinks, listTree, platformName, pluginConfig, readError, sameFileKey } from './vault-io.ts';

export const CLOSE_OBSIDIAN = '這台電腦的 Obsidian 要先關掉：過渡的還原工具不處理開著的編輯器與補 ID 的計時器（外掛內的還原才處理）。';
const PLAN_KIND = 'essence-cards-restore-plan';

export interface RestoreOptions {
  vault: string;
  /** 備份檔（zip）。 */
  backup: string;
  /** 這個 vault 現在的設定資料夾，預設 .obsidian；裡面要有外掛，確定不了時 data.json 擋住。 */
  config?: string;
  now?: () => number;
  offset?: (ms: number) => number;
  random?: () => string;
  /** 測試用：寫檔的替身（模擬空間不足）。 */
  seams?: { write?: (path: string, bytes: Uint8Array, flag: 'w' | 'wx') => Promise<void> };
}

/** 寫到備份資料夾旁（不進 repo）的計畫檔：--apply 用它確認還是同一個 vault、同一份備份，以及每個檔在計畫時的樣子。 */
export interface PlanFile extends RestorePlan {
  kind: typeof PLAN_KIND;
  version: 1;
  vault: string;
  backup: { path: string; sha256: string };
  created: string;
}

interface Loaded { vault: string; backup: OpenedBackup; sha256: string; config: string | null; configError: string | null; current: Map<string, Uint8Array> }

async function load(options: RestoreOptions): Promise<Loaded> {
  const vault = await realpath(options.vault);
  const bytes = new Uint8Array(await readFile(options.backup));
  const opened = openBackup(bytes);
  // 先照 syntax §8「讀備份的一方」驗整份備份；不過就不出計畫。
  if (!opened.ok) throw Error('這份備份不能用：' + opened.error);
  let config: string | null = null;
  let configError: string | null = null;
  try { config = await pluginConfig(vault, options.config); } catch (error) { configError = (error as Error).message; }
  const current = new Map<string, Uint8Array>();
  const paths = await listTree(vault, ESSENCE_ROOT);
  if (config !== null) paths.push(config + '/' + PLUGIN_DATA);
  for (const path of paths) {
    try { current.set(path, new Uint8Array(await readFile(join(vault, path)))); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && path.endsWith(PLUGIN_DATA)) continue;
      throw readError(path, error);
    }
  }
  return { vault, backup: opened.value, sha256: hashBytes(bytes), config, configError, current };
}

const plan = (loaded: Loaded, selection?: ReadonlySet<string>): RestorePlan => planRestore({
  manifest: loaded.backup.manifest, backup: loaded.backup.files, current: loaded.current,
  config: loaded.config, sameFile: sameFileKey(), selection,
});

const stamp = (ms: number, offset: number): string => {
  const time = formatTime(ms, offset);
  return time.slice(0, 10) + ' ' + time.slice(11, 19).replaceAll(':', '');
};

/** `--plan`：寫還原計畫（JSON 給 --apply，Markdown 給人看）到備份檔旁邊，不改 vault。 */
export async function makePlan(options: RestoreOptions): Promise<{ plan: PlanFile; path: string; report: string }> {
  const now = Math.trunc((options.now ?? Date.now)());
  const offset = (options.offset ?? (ms => -new Date(ms).getTimezoneOffset()))(now);
  const random = options.random ?? (() => randomBytes(2).toString('hex'));
  const loaded = await load(options);
  const result: PlanFile = { kind: PLAN_KIND, version: 1, vault: loaded.vault, backup: { path: options.backup, sha256: loaded.sha256 },
    created: formatTime(now, offset), ...plan(loaded) };
  // 撞到已有的計畫檔就換隨機碼，不覆寫。
  for (let i = 0; i < 20; i++) {
    const base = join(dirname(options.backup), `還原計畫 ${stamp(now, offset)} ${random()}`);
    try { await writeFile(base + '.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    await writeFile(base + '.md', report(result, loaded), { flag: 'wx' });
    return { plan: result, path: base + '.json', report: base + '.md' };
  }
  throw Error('找不到沒用過的計畫檔名');
}

const KIND: Record<PlannedFile['kind'], string> = { changed: '改過', missing: '不見了', same: '相同', added: '備份後才有', unmapped: '位置確定不了' };
const ACTION: Record<PlannedFile['action'], string> = { restore: '可以還原', skip: '沒選', blocked: '擋住', keep: '不動' };

function report(result: PlanFile, loaded: Loaded): string {
  const out = [`# 還原計畫 ${result.created}`, '', `- vault：${result.vault}`, `- 備份：${result.backup.path}`, `- 備份的 SHA-256：${result.backup.sha256}`,
    `- 設定資料夾：備份裡是 \`${result.config.source}\`，這個 vault 現在是 ${result.config.target === null ? '確定不了（' + loaded.configError + '）' : '`' + result.config.target + '`'}`,
    `- ${CLOSE_OBSIDIAN}`, '', '## 檔案', ''];
  if (result.files.length === 0) out.push('和現在相同，沒有要還原的檔。');
  else {
    out.push('| 檔案 | 狀況 | 處理 | 說明 |', '|---|---|---|---|');
    for (const file of result.files) out.push(`| ${file.path}${file.target !== null && file.target !== file.path ? ' → ' + file.target : ''} | ${KIND[file.kind]} | ${ACTION[file.action]} | ${file.reasons.join('；')} |`);
  }
  for (const file of result.files.filter(file => file.kind === 'changed')) {
    const before = loaded.current.get(file.current!.path)!, after = loaded.backup.files.get(file.path)!;
    out.push('', `### ${file.path}`, '');
    const diff = textDiff(before, after);
    if (diff === null) out.push(`不是文字：現在 ${file.current!.size} bytes \`${file.current!.sha256}\`，備份 ${file.backup!.size} bytes \`${file.backup!.sha256}\``);
    else out.push('`-` 是現在的，`+` 是備份的：', '', '```diff', ...diff, '```');
  }
  out.push('', '## 複習紀錄（只補不刪，不用勾選）', '');
  if (result.logs.length === 0) out.push('沒有要補的行。');
  for (const log of result.logs) out.push(`- ${log.source}：補 ${log.lines.length} 行到還原檔`);
  return out.join('\n') + '\n';
}

/** 逐行的差異（兩邊都是 UTF-8 文字時），前後各留 2 行；不是文字回傳 null。 */
function textDiff(before: Uint8Array, after: Uint8Array): string[] | null {
  const decode = (bytes: Uint8Array): string | null => {
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); return text.includes('\0') ? null : text; } catch { return null; }
  };
  const a = decode(before)?.split('\n'), b = decode(after)?.split('\n');
  if (!a || !b) return null;
  if (a.length * b.length > 4_000_000) return [`（行數太多，只列行數：現在 ${a.length} 行，備份 ${b.length} 行）`];
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const lines: { mark: ' ' | '-' | '+'; text: string }[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push({ mark: ' ', text: a[i] }); i++; j++; }
    else if (j >= b.length || i < a.length && table[i + 1][j] >= table[i][j + 1]) lines.push({ mark: '-', text: a[i++] });
    else lines.push({ mark: '+', text: b[j++] });
  }
  const near = (index: number): boolean => lines.slice(Math.max(0, index - 2), index + 3).some(line => line.mark !== ' ');
  const out: string[] = [];
  lines.forEach((line, index) => {
    if (near(index)) out.push(line.mark + line.text);
    else if (out.at(-1) !== '…') out.push('…');
  });
  return out;
}

export type Outcome = '已還原' | '跳過' | '擋住' | '失敗';
export interface ApplyResult {
  backup: string;
  files: { path: string; target: string | null; outcome: Outcome; reason: string }[];
  logs: { source: string; path: string | null; lines: number; outcome: Outcome; reason: string }[];
}

/**
 * `--apply`：先做一份現況的備份（失敗就什麼都不寫）；重新讀現況、照這次的選擇重算計畫（全庫 ID 檢查也重做）；
 * 每個檔寫之前確認現在的還是計畫裡的那一份，不是就跳過；寫還原檔（一次寫完、不覆寫）；最後列出每個檔的結果。
 * 中途失敗後重跑 --plan 就是續做：寫成的檔已經相同、補過的行已經在還原檔裡。
 */
export async function applyPlan(options: RestoreOptions & { plan: string; files?: readonly string[] }): Promise<ApplyResult> {
  const now = Math.trunc((options.now ?? Date.now)());
  const offset = (options.offset ?? (ms => -new Date(ms).getTimezoneOffset()))(now);
  const random = options.random ?? (() => randomBytes(2).toString('hex'));
  const write = options.seams?.write ?? ((path: string, bytes: Uint8Array, flag: 'w' | 'wx') => writeFile(path, bytes, { flag }));
  // 過渡工具讀不到 Obsidian 存的裝置碼：平台名稱加隨機 4 碼，這次還原寫的還原檔都用它（syntax §5-3）。
  const device = platformName() + '-' + random();
  const saved =JSON.parse(await readFile(options.plan, 'utf8')) as PlanFile;
  if (saved.kind !== PLAN_KIND || saved.version !== 1) throw Error('不是還原計畫：' + options.plan);
  const vault = await realpath(options.vault);
  const same = sameFileKey();
  if (same(saved.vault) !== same(vault)) throw Error(`計畫是給 ${saved.vault} 的，不是 ${vault}`);
  if (hashBytes(new Uint8Array(await readFile(options.backup))) !== saved.backup.sha256) throw Error('備份檔和計畫裡的不是同一份');
  const planned = new Map(saved.files.map(file => [file.path, file]));
  const chosen = options.files ? new Set(options.files) : new Set(saved.files.filter(file => file.action === 'restore').map(file => file.path));
  for (const path of chosen) {
    const file = planned.get(path);
    if (!file || file.action !== 'restore') throw Error(`${path} 不是計畫裡可以還原的檔`);
  }

  const before = await backupVault({ vault, to: dirname(options.backup), config: options.config, by: 'restore', now: options.now, offset: options.offset });
  const loaded = await load({ ...options, vault });
  const fresh = plan(loaded, chosen);
  const result: ApplyResult = { backup: before.path, files: [], logs: [] };
  for (const file of fresh.files) {
    if (!chosen.has(file.path)) continue;
    const old = planned.get(file.path)!;
    const outcome = (kind: Outcome, reason: string): void => { result.files.push({ path: file.path, target: file.target, outcome: kind, reason }); };
    if (file.action === 'blocked') { outcome('擋住', file.reasons.join('；')); continue; }
    if (file.action !== 'restore' || file.target === null) { outcome('跳過', '現在和備份相同'); continue; }
    if ((old.current?.sha256 ?? null) !== (file.current?.sha256 ?? null)) { outcome('跳過', '計畫之後改過；重跑 --plan 看新的差異'); continue; }
    const rel = file.current?.path ?? file.target;
    const folder = rel.slice(0, rel.lastIndexOf('/'));
    const target = join(vault, rel);
    const bytes = loaded.backup.files.get(file.path)!;
    let temporary: string | null = null;
    try {
      // 路徑上有連結就不寫：建資料夾前後、改名前各查一次，中途被換成連結也擋得到（Codex 中途查核 F3）。
      await assertNoLinks(vault, folder);
      await mkdir(dirname(target), { recursive: true });
      await assertNoLinks(vault, folder);
      // 暫存檔用獨占建立；撞到已有的檔（別的程序或先前留下的）就換名字，不動它（Codex 中途查核 F5）。
      for (let i = 0; i < 20 && temporary === null; i++) {
        const candidate = target + '.' + random() + '.restore-tmp';
        try { await write(candidate, bytes, 'wx'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
          // 建立之後才失敗（例如空間不足）的半個檔是這次的，刪掉。
          await unlink(candidate).catch(() => {});
          throw error;
        }
        temporary = candidate;
      }
      if (temporary === null) throw Error('找不到沒用過的暫存檔名');
      await assertNoLinks(vault, folder);
      await rename(temporary, target);
      temporary = null;
      if (hashBytes(new Uint8Array(await readFile(target))) !== file.backup!.sha256) throw Error('寫進去之後讀回來的雜湊不同');
      outcome('已還原', '');
    } catch (error) {
      if (temporary !== null) await unlink(temporary).catch(() => {});
      outcome('失敗', (error as Error).message);
    }
  }

  const date = formatTime(now, offset).slice(0, 10);
  const names = new Set([...loaded.current.keys()].map(path => same(path)));
  for (const log of fresh.logs) {
    const name = restoreLogName(log.source, date, device, candidate => names.has(same(LOG_FOLDER + '/' + candidate)));
    const path = LOG_FOLDER + '/' + name;
    names.add(same(path));
    const bytes = new TextEncoder().encode(log.lines.join('\n') + '\n');
    // 試過獨占建立才可能有這次的檔：EEXIST 是別人的，連結檢查失敗時還沒寫，都不刪。
    let attempted = false;
    try {
      await assertNoLinks(vault, LOG_FOLDER);
      await mkdir(join(vault, LOG_FOLDER), { recursive: true });
      await assertNoLinks(vault, LOG_FOLDER);
      try { await write(join(vault, path), bytes, 'wx'); } finally { attempted = true; }
      if (hashBytes(new Uint8Array(await readFile(join(vault, path)))) !== hashBytes(bytes)) throw Error('寫進去之後讀回來的內容不同');
      result.logs.push({ source: log.source, path, lines: log.lines.length, outcome: '已還原', reason: '' });
    } catch (error) {
      // 寫了一半的還原檔不留著：重跑時這些行仍算缺，會寫成新的還原檔。
      if (attempted && (error as NodeJS.ErrnoException).code !== 'EEXIST') await unlink(join(vault, path)).catch(() => {});
      result.logs.push({ source: log.source, path, lines: log.lines.length, outcome: '失敗', reason: (error as Error).message });
    }
  }
  return result;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

if (import.meta.main) {
  const usage = '用法：npm run restore -- <vault> <備份檔> --plan [--config <設定資料夾>]\n'
    + '　　　npm run restore -- <vault> <備份檔> --apply <計畫檔> [--files <備份裡的路徑> …] [--config <設定資料夾>]\n' + CLOSE_OBSIDIAN;
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    plan: { type: 'boolean' }, apply: { type: 'string' }, files: { type: 'string', multiple: true }, config: { type: 'string' },
  } });
  if (positionals.length !== 2 || !!values.plan === (values.apply !== undefined) || !(await exists(positionals[1]))) throw Error(usage);
  console.log(CLOSE_OBSIDIAN);
  const options = { vault: positionals[0], backup: positionals[1], config: values.config };
  if (values.plan) {
    const { plan: result, path, report: md } = await makePlan(options);
    const count = (action: PlannedFile['action']): number => result.files.filter(file => file.action === action).length;
    console.log(`還原計畫：${path}\n說明與差異：${md}`);
    console.log(`可以還原 ${count('restore')} 個、擋住 ${count('blocked')} 個、備份後才有的 ${count('keep')} 個；複習紀錄要補 ${result.logs.reduce((sum, log) => sum + log.lines.length, 0)} 行`);
  } else {
    const result = await applyPlan({ ...options, plan: values.apply!, files: values.files });
    console.log('還原前的備份：' + result.backup);
    for (const file of result.files) console.log(`${file.outcome}：${file.path}${file.reason ? '（' + file.reason + '）' : ''}`);
    for (const log of result.logs) console.log(`${log.outcome}：${log.path ?? log.source}（${log.lines} 行${log.reason ? '，' + log.reason : ''}）`);
    if ([...result.files, ...result.logs].some(item => item.outcome === '失敗')) process.exitCode = 1;
  }
}
