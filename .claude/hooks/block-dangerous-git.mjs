// Claude Code PreToolUse hook：擋下會誤 commit 別人修改、毀掉工作或跳過 pre-commit 的 git 指令（D-053、D-117、AGENTS.md「底線」）。
// 讀 stdin 的 JSON，命中時以 exit code 2 結束，stderr 的訊息會回給 Claude。Bash 與 PowerShell 工具都接（.claude/settings.json 的 matcher）。
// 只比對指令的文字，不解析 node 腳本、變數與 alias；不分大小寫，因為 PowerShell 的 Git、GIT.EXE 一樣會執行 git。
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let command = '';
  try { command = JSON.parse(input).tool_input?.command ?? ''; } catch { process.exit(0); }

  // git 或 git.exe（可以帶路徑與引號），子命令前可以先接全域選項：-C <路徑>、-c <設定>、--git-dir <路徑>、--no-optional-locks 等。
  // 選項的值不能以 - 開頭，否則同一串字有好幾種拆法，比對的時間會隨選項個數倍增。
  const value = String.raw`(?:"[^"]*"|'[^']*'|[^\s"'\-;&|][^\s;&|]*)`;
  const option = String.raw`(?:-c\s+${value}|--(?:git-dir|work-tree|namespace|super-prefix|config-env|attr-source)\s+${value}|--[a-z][\w-]*(?:=\S*)?|-[phv])`;
  const git = String.raw`\bgit(?:\.exe)?["']?`;
  const subcommand = String.raw`${git}(?:\s+${option})*\s+`;
  const shared = '。同一個資料夾可能有其他 AI session 正在工作';
  const hooks = '：pre-commit 沒通過就修到通過（D-117）';
  const rules = [
    [String.raw`${subcommand}add\s+(-A\b|--all\b|\.(\s|$)|-u\b|--update\b)`, '只 stage 自己改過的檔案，逐一寫出路徑，不用 git add -A / . / -u' + shared],
    [String.raw`${subcommand}commit\b[^\n]*\s-[a-z]*a`, '不用 git commit -a，先只 stage 自己改過的檔案' + shared],
    [String.raw`${subcommand}push\b[^\n]*(--force(?![\w-])|--force-with-lease\b|\s-f\b)`, '不使用 force push'],
    [String.raw`${subcommand}reset\s+[^\n]*--hard\b`, 'git reset --hard 會丟掉其他 session 未提交的修改' + shared],
    [String.raw`${subcommand}clean\s+[^\n]*-[a-z]*f`, 'git clean -f 會刪掉其他 session 的新檔案' + shared],
    [String.raw`${subcommand}(checkout|restore)\s+(--\s+)?\.(\s|$)`, '不要一次還原整個資料夾，其他 session 可能有未提交的修改' + shared],
    [String.raw`${subcommand}stash\b(?!\s+list)`, '不要 stash，會把其他 session 未提交的修改一起收走' + shared],
    [String.raw`${git}\s[^\n]*--no-verify\b`, '不用 --no-verify 跳過 hook' + hooks],
    [String.raw`${subcommand}commit\b[^\n]*\s-[a-z]*n`, '不用 git commit -n 跳過 pre-commit' + hooks],
    [String.raw`${git}\s[^\n]*-c\s+["']?core\.hooksPath\s*=`, '不用 -c core.hooksPath 換掉 hook' + hooks],
  ];
  for (const [pattern, reason] of rules) {
    if (new RegExp(pattern, 'i').test(command)) {
      console.error(`已擋下：${reason}（AGENTS.md「底線」）。真的需要的話，請使用者自己在終端機執行。`);
      process.exit(2);
    }
  }
  process.exit(0);
});
