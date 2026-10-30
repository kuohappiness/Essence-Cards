import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// 外掛架構檢查環節 9 結論第 1 條（Q1）。這兩個路徑寫在這裡，只改 hook 或設定的 commit，pre-commit 也會跑這個測試。
const hook = fileURLToPath(new URL('../.claude/hooks/block-dangerous-git.mjs', import.meta.url));
const settings = new URL('../.claude/settings.json', import.meta.url);

function exitCode(stdin: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', resolve);
    child.stdin.end(stdin);
  });
}
// hook 不看 tool_name，所以每個寫法只跑一次；一次開 4 個程序，這台電腦的記憶體不多。
async function wrong(commands: string[], expected: number): Promise<string[]> {
  const codes: (number | null)[] = [];
  for (let i = 0; i < commands.length; i += 4) {
    codes.push(...await Promise.all(commands.slice(i, i + 4).map(command => exitCode(JSON.stringify({ tool_name: 'PowerShell', tool_input: { command } })))));
  }
  return commands.filter((_, i) => codes[i] !== expected);
}

void test('Q1 擋下的寫法：原本七類、跳過 hook 的旗標，以及 git.exe、大小寫不同、前面接 -C／-c', async () => {
  const blocked = [
    'git add -A', 'git add --all', 'git add .', 'git add -u',
    'git commit -am "x"', 'git push --force', 'git push -f origin main', 'git push --force-with-lease',
    'git reset --hard HEAD~1', 'git clean -fd', 'git checkout .', 'git restore -- .',
    'git stash', 'git stash pop',
    'git commit --no-verify -m x', 'git push --no-verify', 'git commit -n -m x', 'git commit -nm x',
    'git -c core.hooksPath=/dev/null commit -m x', 'git -c "core.hooksPath=nul" commit -m x',
    'git.exe stash', 'Git stash', 'GIT ADD -A', 'git STASH', 'GIT.EXE reset --hard',
    'git -C ../other add -A', 'git -C "D:\\a b" stash', 'git -c color.ui=false stash', 'git -c core.quotepath=false -C x reset --hard',
    'git --no-optional-locks stash', 'git --git-dir .git --work-tree . stash', 'git --git-dir=.git stash',
    '"C:\\Program Files\\Git\\cmd\\git.exe" stash', '& git.exe add -A',
    'cd x\ngit stash', 'Write-Output "git stash"',
  ];
  assert.deepEqual(await wrong(blocked, 2), []);
});

void test('Q1 不擋的寫法：stash list、逐一 stage、--force-if-includes 與其他日常指令', async () => {
  const allowed = [
    'git stash list', 'git -C other stash list', 'git add src/a.ts', 'git add -- src/a.ts tests/a.test.ts',
    'git status --short', 'git commit -m "fix"', 'git commit --amend --no-edit', 'git commit --allow-empty -m x',
    'git push', 'git push -u origin main', 'git push --force-if-includes', 'git push -n',
    'git -c core.quotepath=false diff --cached', 'git log --oneline -5', 'git checkout -- src/a.ts',
    'git restore --staged src/a.ts', 'git clean -n', 'git reset --soft HEAD~1', 'npm test', 'legit stash',
  ];
  assert.deepEqual(await wrong(allowed, 0), []);
  assert.equal(await exitCode('not json'), 0);
  assert.equal(await exitCode('{}'), 0);
});

void test('Q1 .claude/settings.json 的 matcher 同時接 Bash 與 PowerShell', async () => {
  type Entry = { matcher?: string; hooks: { command: string }[] };
  const config = JSON.parse(await readFile(settings, 'utf8')) as { hooks: { PreToolUse: Entry[] } };
  const entry = config.hooks.PreToolUse.find(e => e.hooks.some(h => h.command.includes('block-dangerous-git.mjs')));
  assert.ok(entry?.matcher);
  const matcher = new RegExp('^(?:' + entry.matcher + ')$');
  for (const tool of ['Bash', 'PowerShell']) assert.ok(matcher.test(tool), tool);
  for (const tool of ['Read', 'Edit', 'Write']) assert.ok(!matcher.test(tool), tool);
});
