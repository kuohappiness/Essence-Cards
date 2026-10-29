import { execFileSync } from 'node:child_process';

/**
 * 繼承來的環境變數拿掉 git 的：在 git hook 裡跑時 GIT_DIR 等指著呼叫的那個 repo，不拿掉就會讀寫到別的 repo
 * （2026-10-29：測試的 git init 因此把共用 .git/config 的 core.bare 改成 true）。名稱不分大小寫：Windows 的環境變數
 * 不分大小寫，小寫的 git_dir 照樣生效（Codex 第二輪 L3）。
 */
export function gitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
}

/** 在 root 跑 git，只看 root 自己的 repo。 */
export function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, env: gitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
