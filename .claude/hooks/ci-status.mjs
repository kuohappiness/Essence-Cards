// Claude Code SessionStart hook：main 最近一次跑完的 GitHub Actions 沒通過就提醒（第一個里程碑回顧的 R1：CI 在 main 紅了三天沒人發現）。
// 只讀不寫；gh 不能用、沒登入或離線時安靜結束，不擋 session。
import { execFileSync } from 'node:child_process';

let runs;
try {
  const out = execFileSync('gh', ['run', 'list', '--branch', 'main', '--status', 'completed', '--limit', '1', '--json', 'conclusion,headSha,displayTitle,url,createdAt'], {
    cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(), encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  runs = JSON.parse(out);
} catch { process.exit(0); }

const [last] = Array.isArray(runs) ? runs : [];
if (!last || !['failure', 'timed_out', 'startup_failure'].includes(last.conclusion)) process.exit(0);
const context = `GitHub Actions 在 main 最近一次跑完沒通過（${last.conclusion}）：${String(last.headSha).slice(0, 7)}「${last.displayTitle}」，${last.createdAt}，${last.url}。`
  + '開始其他工作前先用 gh run view <id> --log-failed 看原因：能修就修，不能修就告訴使用者（docs/agents/quality.md〈檢查指令〉）。';
console.log(JSON.stringify({
  systemMessage: `CI 在 main 沒通過：${last.url}`,
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
}));
