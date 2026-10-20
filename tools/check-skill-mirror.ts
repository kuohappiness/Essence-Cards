// 檢查 Claude（.claude/skills）與 Codex（.agents/skills）共用的 skill 兩份內容相同，且 Markdown 的相對連結都找得到（D-119）。
// 用法：node tools/check-skill-mirror.ts [--root <repo>]；有問題時列出並以 exit code 1 結束。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SHARED = ['code-quality', 'essence-decision', 'essence-discuss'];
export const COPIES = ['.claude/skills', '.agents/skills'];

function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(name => statSync(join(dir, name)).isFile())
    .map(name => name.split(sep).join('/'))
    .sort();
}

const normalize = (text: string) => text.replace(/\r\n/g, '\n');

function brokenLinks(file: string, text: string): string[] {
  const problems: string[] = [];
  // [文字](路徑) 或 [文字](<有空格的路徑>)
  for (const [, bracketed, plain] of text.matchAll(/\]\((?:<([^>]+)>|([^)\s]+))\)/g)) {
    const target = bracketed ?? plain;
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
    const path = decodeURI(target.split('#')[0]);
    if (!existsSync(resolve(dirname(file), path))) problems.push(target);
  }
  return problems;
}

export function checkMirror(root: string): string[] {
  const problems: string[] = [];
  const show = (path: string) => relative(root, path).split(sep).join('/');
  for (const skill of SHARED) {
    const [a, b] = COPIES.map(copy => join(root, copy, skill));
    const missing = [a, b].filter(dir => !existsSync(dir));
    if (missing.length) {
      for (const dir of missing) problems.push(`缺少資料夾：${show(dir)}`);
      continue;
    }
    const filesA = listFiles(a);
    const filesB = listFiles(b);
    for (const name of filesA.filter(name => !filesB.includes(name))) problems.push(`只有 ${COPIES[0]} 有：${skill}/${name}`);
    for (const name of filesB.filter(name => !filesA.includes(name))) problems.push(`只有 ${COPIES[1]} 有：${skill}/${name}`);
    for (const name of filesA.filter(name => filesB.includes(name))) {
      if (normalize(readFileSync(join(a, name), 'utf8')) !== normalize(readFileSync(join(b, name), 'utf8'))) {
        problems.push(`內容不同：${skill}/${name}`);
      }
    }
    for (const dir of [a, b]) {
      for (const name of listFiles(dir).filter(name => name.endsWith('.md'))) {
        const file = join(dir, name);
        for (const target of brokenLinks(file, readFileSync(file, 'utf8'))) problems.push(`連結找不到：${show(file)} → ${target}`);
      }
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const at = process.argv.indexOf('--root');
  const root = at > 0 ? resolve(process.argv[at + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const problems = checkMirror(root);
  if (problems.length) {
    console.error(`共用 skill 的兩份副本有 ${problems.length} 個問題：\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`共用 skill 一致：${SHARED.join('、')}`);
}
