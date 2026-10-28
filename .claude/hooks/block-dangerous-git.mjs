// Claude Code PreToolUse hook：擋下會誤 commit 別人修改或毀掉工作的 git 指令（D-053、AGENTS.md「底線」）。
// 讀 stdin 的 JSON，命中時以 exit code 2 結束，stderr 的訊息會回給 Claude。
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let command = '';
  try { command = JSON.parse(input).tool_input?.command ?? ''; } catch { process.exit(0); }

  const rules = [
    [/\bgit\s+add\s+(-A\b|--all\b|\.(\s|$)|-u\b|--update\b)/, '只 stage 自己改過的檔案，逐一寫出路徑，不用 git add -A / . / -u'],
    [/\bgit\s+commit\b[^\n]*\s-[a-zA-Z]*a/, '不用 git commit -a，先只 stage 自己改過的檔案'],
    [/\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/, '不使用 force push'],
    [/\bgit\s+reset\s+[^\n]*--hard\b/, 'git reset --hard 會丟掉其他 session 未提交的修改'],
    [/\bgit\s+clean\s+[^\n]*-[a-zA-Z]*f/, 'git clean -f 會刪掉其他 session 的新檔案'],
    [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, '不要一次還原整個資料夾，其他 session 可能有未提交的修改'],
    [/\bgit\s+stash\b(?!\s+list)/, '不要 stash，會把其他 session 未提交的修改一起收走'],
  ];
  for (const [pattern, reason] of rules) {
    if (pattern.test(command)) {
      console.error(`已擋下：${reason}。同一個資料夾可能有其他 AI session 正在工作（AGENTS.md「底線」）。真的需要的話，請使用者自己在終端機執行。`);
      process.exit(2);
    }
  }
  process.exit(0);
});
