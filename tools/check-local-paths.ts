// 本機路徑檢查（第二次里程碑檢查 R5）：repo 是公開的，Windows 帳號名、iCloud 雲碟的路徑、vault 名稱不能進 repo。
// 用法：
//   node tools/check-local-paths.ts                   Git 追蹤的檔，內容讀工作樹（npm run check 與 CI 用）
//   node tools/check-local-paths.ts --staged          暫存區的內容（pre-commit 每次都跑，只改文件的 commit 也掃）
//   node tools/check-local-paths.ts --message <檔案>   commit 訊息（commit-msg）
// 兩種規則：
//   通用規則不含任何真實的值，CI 也擋得到：使用者資料夾（C:\Users\<帳號>、/home/<帳號>、/Users/<帳號>）與
//   iCloud 雲碟（<磁碟>:\…\iCloudDrive）的完整路徑。佔位字（<帳號>）、環境變數與少數範例名（someone）放行。
//   本機規則在執行時從這台電腦取，不寫進 repo：家目錄、帳號名、Obsidian 登錄的 vault 路徑與名稱（測試 vault 的名稱除外）。
// 找到時每個一行「檔案:行:欄  原因」並以 exit code 1 結束；不印找到的值（CI 的紀錄也是公開的）。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Rule { pattern: RegExp; why: string; allow?: (name: string) => boolean }
interface Found { line: number; column: number; why: string }
interface LocalFacts { home: string; user: string; vaults: string[]; testVaults: string[] }

/** 當範例用的帳號名：文件與測試裡的例子用這些或佔位字。 */
const EXAMPLE_NAMES = new Set(['someone', 'public', 'default', 'runner', 'runneradmin', 'root']);
const isExample = (name: string) => EXAMPLE_NAMES.has(name.toLowerCase());
/** 路徑裡的一段帳號名：開頭不是佔位字（<…>）或變數（%…%、$…、{…}）。 */
const NAME = String.raw`([^\s\\/\x60'"<>%$\{\}|*?:()\[\],;]+)`;

export function genericRules(): Rule[] {
  return [
    {
      pattern: new RegExp(String.raw`(?<![A-Za-z0-9])[A-Za-z]:[\\/]+Users[\\/]+` + NAME, 'gi'),
      why: 'Windows 使用者資料夾的完整路徑（含帳號名）：改成 C:\\Users\\<帳號>\\… 或 %USERPROFILE%',
      allow: isExample,
    },
    {
      pattern: new RegExp(String.raw`(?<![\w.~:/-])/(?:mnt/[a-z]/|[a-z]/)?(?:Users|home)/` + NAME, 'gi'),
      why: '使用者資料夾的完整路徑（含帳號名）：改成 ~ 或 <帳號>',
      allow: isExample,
    },
    {
      pattern: /(?<![A-Za-z0-9])[A-Za-z]:[\\/]+(?:[^\r\n\t\\/`'"<>|%*?:]+[\\/]+)*?iCloud ?Drive(?![A-Za-z])/gi,
      why: 'iCloud 雲碟的完整路徑：改成 <iCloud 根目錄>',
    },
  ];
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 路徑的分隔符號兩種斜線都認，也認 JSON 裡的雙反斜線；後面不能接著同一段名字的字。 */
const pathPattern = (path: string) =>
  new RegExp(path.split(/[\\/]+/).filter(Boolean).map(escape).join(String.raw`[\\/]+`) + String.raw`(?![^\s\\/\x60'"<>|*?:()\[\],;])`, 'gi');

export function localRules(facts: LocalFacts): Rule[] {
  const rules: Rule[] = [];
  if (facts.user && !isExample(facts.user)) {
    if (facts.home) rules.push({ pattern: pathPattern(facts.home), why: '這台電腦的家目錄' });
    rules.push({ pattern: new RegExp(String.raw`(?<=[\\/])` + escape(facts.user) + String.raw`(?=[\\/])`, 'gi'), why: '路徑裡有這台電腦的帳號名' });
  }
  const tests = new Set(facts.testVaults.map(path => basename(path.replaceAll('\\', '/')).toLowerCase()));
  for (const vault of facts.vaults) {
    if (!vault) continue;
    rules.push({ pattern: pathPattern(vault), why: 'Obsidian 登錄的 vault 路徑' });
    const name = basename(vault.replaceAll('\\', '/'));
    // 一個單字的名字太容易撞到一般文字，只擋完整路徑；測試 vault 的名稱在文件裡會提到。
    if (!/\s/.test(name.trim()) || tests.has(name.toLowerCase())) continue;
    rules.push({
      pattern: new RegExp(String.raw`(?<![\p{L}\p{N}_])` + escape(name.trim()).replace(/\s+/g, String.raw`\s+`) + String.raw`(?![\p{L}\p{N}_])`, 'giu'),
      why: 'Obsidian 登錄的 vault 名稱（不是登錄過的測試 vault）',
    });
  }
  return rules;
}

/** 找到的位置；同一段文字被好幾條規則找到時只報第一條。 */
export function findLocalPaths(text: string, rules: Rule[]): Found[] {
  const hits: { start: number; end: number; why: string }[] = [];
  for (const rule of rules) {
    for (const match of text.matchAll(rule.pattern)) {
      if (rule.allow && match[1] !== undefined && rule.allow(match[1])) continue;
      hits.push({ start: match.index, end: match.index + match[0].length, why: rule.why });
    }
  }
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const found: Found[] = [];
  let covered = -1;
  for (const hit of hits.sort((a, b) => a.start - b.start)) {
    if (hit.start < covered) continue;
    covered = hit.end;
    let line = starts.length;
    while (starts[line - 1] > hit.start) line--;
    found.push({ line, column: hit.start - starts[line - 1] + 1, why: hit.why });
  }
  return found;
}

function git(args: string[], input?: string): Buffer {
  return execFileSync('git', args, { input, maxBuffer: 1 << 30 });
}

/** 這台電腦的資訊；讀不到的就略過（CI 上沒有 Obsidian）。 */
function readLocalFacts(): LocalFacts {
  let user = '';
  try { user = userInfo().username; } catch { /* 沒有帳號資訊時只用通用規則 */ }
  const home = homedir();
  const config = process.platform === 'win32' ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'obsidian')
    : process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'obsidian')
    : join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'obsidian');
  const vaults: string[] = [];
  try {
    const saved = JSON.parse(readFileSync(join(config, 'obsidian.json'), 'utf8')) as { vaults?: Record<string, { path?: unknown }> };
    for (const entry of Object.values(saved.vaults ?? {})) if (typeof entry.path === 'string') vaults.push(entry.path);
  } catch { /* 沒裝 Obsidian 或格式變了：只用其他規則 */ }
  let testVaults: string[] = [];
  try {
    // 測試 vault 的登錄在主資料夾的 .local/（tools/install.ts 的 localFolder），各 worktree 共用。
    const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).toString('utf8').trim();
    const saved = JSON.parse(readFileSync(join(dirname(common), '.local', 'test-vaults.json'), 'utf8')) as { vaults?: unknown };
    if (Array.isArray(saved.vaults)) testVaults = saved.vaults.filter((path): path is string => typeof path === 'string');
  } catch { /* 沒登錄過測試 vault */ }
  return { home, user, vaults, testVaults };
}

/** 暫存區裡這些檔的內容，一次用 git cat-file --batch 讀。 */
function stagedContents(paths: string[]): Map<string, Buffer> {
  const out = git(['cat-file', '--batch'], paths.map(path => ':' + path + '\n').join(''));
  const contents = new Map<string, Buffer>();
  let at = 0;
  for (const path of paths) {
    const end = out.indexOf(10, at);
    const header = out.subarray(at, end).toString('utf8');
    at = end + 1;
    const size = /^\S+ blob (\d+)$/.exec(header)?.[1];
    if (size === undefined) continue; // 子模組或讀不到
    contents.set(path, out.subarray(at, at + Number(size)));
    at += Number(size) + 1;
  }
  return contents;
}

function main(args: string[]): number {
  const rules = [...genericRules(), ...localRules(readLocalFacts())];
  const report: string[] = [];
  const scan = (label: string, data: Buffer) => {
    if (data.includes(0)) return; // 二進位檔
    for (const found of findLocalPaths(data.toString('utf8'), rules)) report.push(`${label}:${found.line}:${found.column}  ${found.why}`);
  };
  const message = args.indexOf('--message');
  if (message !== -1) {
    const lines = readFileSync(args[message + 1], 'utf8').split('\n');
    const cut = lines.findIndex(line => /^# -+ >8 -+\r?$/.test(line));
    // 註解行不會進 commit；照 git 的預設，# 開頭的是註解。
    const kept = (cut === -1 ? lines : lines.slice(0, cut)).map(line => (line.startsWith('#') ? '' : line));
    scan('commit 訊息', Buffer.from(kept.join('\n')));
  } else if (args.includes('--staged')) {
    const paths = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']).toString('utf8').split('\0').filter(Boolean);
    if (paths.length) for (const [path, data] of stagedContents(paths)) scan(path, data);
  } else {
    for (const path of git(['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean)) {
      if (existsSync(path)) scan(path, readFileSync(path));
    }
  }
  if (!report.length) return 0;
  console.error('找到本機路徑（repo 是公開的，進了 git 歷史就拿不掉）：');
  for (const line of report) console.error('  ' + line);
  console.error('帳號名改成 <帳號>（例如 C:\\Users\\<帳號>\\…），iCloud 雲碟改成 <iCloud 根目錄>，vault 名稱改成「正式 vault」。');
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
