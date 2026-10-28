import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBytes, readBuild } from '../src/core/backup/index.ts';
import { buildPlugin } from './build.mjs';
import { sameFileKey } from './vault-io.ts';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const PLUGIN = 'plugins/essence-cards';
const OUTPUTS = ['main.js', 'manifest.json', 'styles.css'] as const;

export interface InstallOptions {
  vault: string;
  /** 開發版：只裝到登錄過的測試 vault。 */
  dev?: boolean;
  /** 從 .local/releases/<版號>/ 重裝那一份正式產物（退回）。 */
  release?: string;
  /** 設定資料夾，預設 .obsidian。 */
  config?: string;
  /** repo 根目錄；測試用暫存的 repo。 */
  root?: string;
  /** 本機紀錄（測試 vault 的登錄、正式產物）；預設是主資料夾的 .local/。 */
  local?: string;
  /** 測試用：換掉建置（模擬 DEV 沒關的產出）。 */
  build?: typeof buildPlugin;
}
export interface Installed { kind: 'dev' | 'test' | 'release'; version: string; build: string; vault: string }
/** .local/releases/<版號>/release.json：每一份正式產物的版號、建置版本、commit 與雜湊。 */
interface Release { version: string; build: string; commit: string; created: string; sha256: Record<string, string> }

/**
 * 在 root 跑 git。拿掉繼承來的 GIT_* 環境變數：在 git hook 裡跑時 GIT_DIR 指著呼叫的那個 repo，
 * 不拿掉就會查錯 repo（2026-10-29：測試的 git init 因此把共用 .git/config 的 core.bare 改成 true）。
 */
function git(root: string, args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * 本機紀錄的資料夾：主資料夾（git 的共用目錄所在的那一個）的 .local/，各個 worktree 共用同一份登錄與正式產物。
 * 不在 git 裡時用 root/.local/。
 */
function localFolder(root = defaultRoot): string {
  try { return join(dirname(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])), '.local'); }
  catch { return join(root, '.local'); }
}

async function realOrNull(path: string): Promise<string | null> {
  try { return await realpath(path); } catch { return null; }
}

/** 登錄過的測試 vault（.local/test-vaults.json 存實際路徑）；比對時兩邊都先 realpath，不存在的登錄略過。 */
async function isTestVault(vault: string, local: string): Promise<boolean> {
  let saved: unknown;
  try { saved = JSON.parse(await readFile(join(local, 'test-vaults.json'), 'utf8')); } catch { return false; }
  const list = (saved as { vaults?: unknown }).vaults;
  if (!Array.isArray(list)) return false;
  const same = sameFileKey();
  const target = await realOrNull(vault);
  if (target === null) return false;
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const real = await realOrNull(entry);
    if (real !== null && same(real) === same(target)) return true;
  }
  return false;
}

/** 把這個 vault 登錄成測試 vault（存實際路徑）；回傳登錄後的清單。 */
export async function registerTestVault(vault: string, local = localFolder()): Promise<string[]> {
  const real = await realpath(vault);
  if (!(await stat(real)).isDirectory()) throw Error('vault 必須是已存在的資料夾');
  let vaults: string[] = [];
  try { vaults = (JSON.parse(await readFile(join(local, 'test-vaults.json'), 'utf8')) as { vaults: string[] }).vaults; } catch { /* 第一次登錄 */ }
  if (!vaults.includes(real)) vaults.push(real);
  await mkdir(local, { recursive: true });
  await writeFile(join(local, 'test-vaults.json'), JSON.stringify({ vaults }, null, 2) + '\n');
  return vaults;
}

/**
 * 正式版的條件（D-149 第 4 點）：工作樹乾淨（含未追蹤的檔，.gitignore 的除外）、HEAD 正好是 tag v<manifest 的版號>、
 * package.json 的版號相同。不符就丟錯，列出全部原因。
 */
async function releaseProblems(root = defaultRoot): Promise<{ version: string; commit: string; problems: string[] }> {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as { version: string };
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
  const problems: string[] = [];
  let commit = '';
  try {
    commit = git(root, ['rev-parse', 'HEAD']);
    const dirty = git(root, ['status', '--porcelain']);
    if (dirty) problems.push('工作樹有未提交或未追蹤的檔：\n' + dirty);
    let tagged = '';
    try { tagged = git(root, ['rev-parse', '--verify', '--quiet', `refs/tags/v${manifest.version}^{commit}`]); } catch { /* 沒有這個 tag */ }
    if (tagged !== commit) problems.push(`HEAD 不是 tag v${manifest.version}` + (tagged ? `（那個 tag 在 ${tagged.slice(0, 7)}）` : '（沒有這個 tag）'));
  } catch { problems.push('不在 git 裡，確定不了建置的輸入'); }
  if (pkg.version !== manifest.version) problems.push(`package.json 的版號 ${pkg.version} 和 manifest.json 的 ${manifest.version} 不同`);
  return { version: manifest.version, commit, problems };
}

async function hashes(folder: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of OUTPUTS) result[name] = hashBytes(new Uint8Array(await readFile(join(folder, name))));
  return result;
}

/** 複製三個檔到 vault 的外掛資料夾，讀回來比雜湊；把 essence-cards 加進外掛清單（沒有才加）。 */
async function deploy(from: string, vault: string, config: string, expected?: Record<string, string>): Promise<void> {
  const destination = join(vault, config, PLUGIN);
  await mkdir(destination, { recursive: true });
  for (const name of OUTPUTS) await copyFile(join(from, name), join(destination, name));
  if (expected) {
    const back = await hashes(destination);
    for (const name of OUTPUTS) if (back[name] !== expected[name]) throw Error(`裝進 vault 的 ${name} 讀回來的雜湊不同`);
  }
  const list = join(vault, config, 'community-plugins.json');
  let enabled: string[] = [];
  try { enabled = JSON.parse(await readFile(list, 'utf8')) as string[]; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!enabled.includes('essence-cards')) await writeFile(list, JSON.stringify([...enabled, 'essence-cards'], null, 2));
}

/** 從 .local/releases/<版號>/ 讀一份正式產物，檢查檔案的雜湊和 release.json 相同。 */
async function loadRelease(local: string, version: string): Promise<{ folder: string; release: Release }> {
  const folder = join(local, 'releases', version);
  let release: Release;
  try { release = JSON.parse(await readFile(join(folder, 'release.json'), 'utf8')) as Release; } catch { throw Error(`沒有 ${version} 的正式產物（${folder}）`); }
  const actual = await hashes(folder);
  for (const name of OUTPUTS) if (actual[name] !== release.sha256[name]) throw Error(`${folder} 的 ${name} 和 release.json 記的雜湊不同`);
  return { folder, release };
}

/**
 * 安裝外掛到 vault（D-149 第 4 點，擋法寫在安裝命令本身）：
 * - dev：目標必須是登錄過的測試 vault。
 * - 不帶 dev、目標是登錄過的測試 vault：照舊建置後複製。
 * - 其他一律當正式使用的 vault：要符合 releaseProblems 的條件；先建置到暫存資料夾、確認 DEV 是 false，
 *   產物與雜湊存到 .local/releases/<版號>/（同一個版號已經有不同的產物就拒絕），再複製到 vault、讀回比雜湊。
 * - release：從 .local/releases/ 重裝那一份。
 */
export async function installVault(options: InstallOptions): Promise<Installed> {
  const root = options.root ?? defaultRoot;
  const local = options.local ?? localFolder(root);
  const config = options.config ?? '.obsidian';
  const build = options.build ?? buildPlugin;
  const vault = await realpath(options.vault);
  if (!(await stat(vault)).isDirectory()) throw Error('vault 必須是已存在的資料夾');
  const test = await isTestVault(vault, local);
  if (options.release !== undefined) {
    const { folder, release } = await loadRelease(local, options.release);
    await deploy(folder, vault, config, release.sha256);
    return { kind: 'release', version: release.version, build: release.build, vault };
  }
  if (options.dev && !test) throw Error(`開發版只能裝到登錄過的測試 vault；${vault} 沒有登錄（npm run install-vault -- <vault> --register-test）`);
  if (test) {
    const built = await build({ root, dev: !!options.dev });
    await deploy(root, vault, config);
    return { kind: options.dev ? 'dev' : 'test', version: built.version.split('+')[0], build: built.version, vault };
  }

  const { version, commit, problems } = await releaseProblems(root);
  if (problems.length) throw Error(`${vault} 不是登錄過的測試 vault，只能裝正式版，但條件不符：\n- ` + problems.join('\n- '));
  const temporary = await mkdtemp(join(tmpdir(), 'essence-release-'));
  try {
    const built = await build({ root, dev: false, outdir: temporary });
    await copyFile(join(root, 'manifest.json'), join(temporary, 'manifest.json'));
    const stamped = readBuild(await readFile(join(temporary, 'main.js'), 'utf8'));
    if (built.dev || stamped.dev !== false) throw Error('建置的 DEV 不是 false，不能裝到正式使用的 vault');
    const [stampedVersion, stampedCommit = ''] = (stamped.build ?? '').split('+');
    if (stamped.build === null || stampedVersion !== version || !stampedCommit || stampedCommit.endsWith('.dirty') || !commit.startsWith(stampedCommit)) {
      throw Error(`建置版本 ${stamped.build ?? '（讀不到）'} 和 tag v${version} 的 commit 不符`);
    }
    const sha256 = await hashes(temporary);
    const folder = join(local, 'releases', version);
    // 已經有這個版號的紀錄就要讀得懂、雜湊對得上，不蓋過去。
    const existing = await stat(join(folder, 'release.json')).then(() => true, () => false) ? (await loadRelease(local, version)).release : null;
    if (existing) {
      if (OUTPUTS.some(name => existing.sha256[name] !== sha256[name])) throw Error(`${folder} 已經有 ${version} 的另一份產物；同一個版號不能有兩份`);
    } else {
      await mkdir(folder, { recursive: true });
      for (const name of OUTPUTS) await copyFile(join(temporary, name), join(folder, name));
      const release: Release = { version, build: stamped.build, commit, created: new Date().toISOString(), sha256 };
      await writeFile(join(folder, 'release.json'), JSON.stringify(release, null, 2) + '\n');
      await loadRelease(local, version);
    }
    await deploy(folder, vault, config, sha256);
    return { kind: 'release', version, build: stamped.build, vault };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** CLI：tools/install-vault.mjs 轉來這裡。 */
export async function main(args: readonly string[]): Promise<void> {
  const usage = '用法：npm run install-vault -- <vault> [--dev] [--config <設定資料夾>]\n'
    + '　　　npm run install-vault -- <vault> --release <版號>（從 .local/releases/ 重裝那一份）\n'
    + '　　　npm run install-vault -- <vault> --register-test（登錄成測試 vault）';
  const rest = [...args];
  const take = (flag: string): string | undefined => {
    const at = rest.indexOf(flag);
    if (at < 0) return undefined;
    const value = rest[at + 1];
    if (value === undefined || value.startsWith('--')) throw Error(usage);
    rest.splice(at, 2);
    return value;
  };
  const flag = (name: string): boolean => {
    const at = rest.indexOf(name);
    if (at >= 0) rest.splice(at, 1);
    return at >= 0;
  };
  const config = take('--config');
  const release = take('--release');
  const dev = flag('--dev');
  const register = flag('--register-test');
  if (rest.length !== 1 || rest[0].startsWith('--') || [dev, register, release !== undefined].filter(Boolean).length > 1) throw Error(usage);
  if (register) {
    console.log('測試 vault：\n' + (await registerTestVault(resolve(rest[0]))).join('\n'));
    return;
  }
  const result = await installVault({ vault: rest[0], dev, release, config });
  const kind = { dev: '開發版（測試 vault）', test: '正式建置（測試 vault）', release: '正式版' }[result.kind];
  console.log(`已安裝 Essence Cards ${result.build}：${kind}`);
}
