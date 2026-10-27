// 文件檢查（D-141、D-143）：Git 追蹤的 Markdown 裡本機可判定的連結與錨點、roadmap 有「現在在哪裡」一節、「已完成」的列數、任務、討論稿與 plans 的檔頭狀態行。
// 用法：node tools/check-docs.ts [--staged] [--root <repo>]（--root 給測試用）
//   預設：檔案清單取 Git 追蹤的檔案，內容讀工作樹（npm run check 與 CI 用）。
//   --staged：清單與內容都讀暫存區（pre-commit 用）。
// 有問題時每個一行「檔案:行號  目標  原因」並以 exit code 1 結束。不發網路請求，不修改、不 stage 任何檔案。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MarkdownIt, { type Token } from 'markdown-it';
import GithubSlugger from 'github-slugger';

export const ROADMAP = 'docs/roadmap.md';
export const DONE_ROWS = 10;
export const STATUS_DIRS = ['tasks', 'Claude Codex Discussion', 'docs/plans'];

export interface Exception { file: string; target: string; reason: string }

// 確實改不了的連結，逐項寫原因。target 是解碼後的連結目標，和輸出的「目標」一欄相同。
export const EXCEPTIONS: Exception[] = [
  ...['decisions.md#d-066-作答方式', '#2-3-學習目標', 'decisions.md#d-116-打字卡的沒印象與自動朗讀', 'decisions.md#d-120-今天的佇列的細節', 'decisions.md#d-121-打字卡答錯時的三步流程']
    .map(target => ({ file: 'tasks/w6-format-review-fixes.md', target, reason: '引用框與表格是貼進 syntax.md 的原文，以 docs/ 為基準' })),
  { file: 'tasks/docs-architecture.md', target: 'docs/decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份', reason: '要貼進 AGENTS.md 的原文，以根目錄為基準' },
  { file: 'tasks/docs-architecture.md', target: '../../tasks/objective-architecture-r2-connection.md', reason: '要貼進 experiments/t4/README.md 的原文' },
  { file: 'tasks/docs-architecture.md', target: 'decisions.md#d-141-文件架構入口只放狀態同一類資訊只維護一份', reason: 'roadmap 已完成那一列的範例，以 docs/ 為基準' },
];

export interface Problem { file: string; line: number; target: string; reason: string }

interface Doc { file: string; lines: string[]; tokens: Token[]; anchors: Set<string> }

const markdown = new MarkdownIt({ html: true });

function git(root: string, args: string[], input?: string): Buffer {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: root, input, stdio: 'pipe', maxBuffer: 1 << 28 });
}

const isMarkdown = (path: string) => path.toLowerCase().endsWith('.md');

// 回傳追蹤的檔案清單與其中 Markdown 的內容。
function loadTree(root: string, staged: boolean): { files: string[]; texts: Map<string, string> } {
  const texts = new Map<string, string>();
  if (!staged) {
    const files = [...new Set(git(root, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean))]
      .filter(path => existsSync(join(root, path)));
    for (const path of files.filter(isMarkdown)) texts.set(path, readFileSync(join(root, path), 'utf8'));
    return { files, texts };
  }
  // 每一筆是「<mode> <object> <stage>\t<path>」；內容等同 git show :<path>，一次用 cat-file 讀完。
  const objects = new Map<string, string>();
  for (const entry of git(root, ['ls-files', '-s', '-z']).toString('utf8').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const path = entry.slice(tab + 1);
    if (!objects.has(path)) objects.set(path, entry.slice(0, tab).split(' ')[1]);
  }
  const files = [...objects.keys()];
  const wanted = files.filter(isMarkdown);
  if (wanted.length) {
    const out = git(root, ['cat-file', '--batch'], wanted.map(path => objects.get(path)).join('\n') + '\n');
    let at = 0;
    for (const path of wanted) {
      const end = out.indexOf(0x0a, at);
      const size = Number(out.subarray(at, end).toString('latin1').split(' ')[2]);
      texts.set(path, out.subarray(end + 1, end + 1 + size).toString('utf8'));
      at = end + 1 + size + 1;
    }
  }
  return { files, texts };
}

// 換行統一成 LF；開頭的 YAML front matter 換成同樣行數的空行，行號不變。
function normalize(text: string): string {
  const lf = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const front = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(lf);
  return front ? front[0].replace(/[^\n]/g, '') + lf.slice(front[0].length) : lf;
}

// 標題與表格儲存格的純文字：行內程式碼取內容、連結取連結文字、HTML 不算。
function plainText(children: Token[]): string {
  return children.map(child => {
    if (child.type === 'text' || child.type === 'code_inline') return child.content;
    if (child.type === 'softbreak' || child.type === 'hardbreak') return ' ';
    if (child.type === 'image') return plainText(child.children ?? []);
    return '';
  }).join('');
}

function htmlIds(html: string, anchors: Set<string>) {
  for (const [, id] of html.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) anchors.add(id);
}

function parse(file: string, text: string): Doc {
  const source = normalize(text);
  const tokens = markdown.parse(source, {});
  const anchors = new Set<string>();
  const slugger = new GithubSlugger();
  tokens.forEach((token, i) => {
    if (token.type === 'heading_open') anchors.add(slugger.slug(plainText(tokens[i + 1].children ?? [])));
    else if (token.type === 'html_block') htmlIds(token.content, anchors);
    else if (token.type === 'inline') for (const child of token.children ?? []) if (child.type === 'html_inline') htmlIds(child.content, anchors);
  });
  return { file, lines: source.split('\n'), tokens, anchors };
}

// 連結與圖片的目的地，行號取所在區塊的第一行。
function linksOf(doc: Doc): { line: number; href: string }[] {
  const links: { line: number; href: string }[] = [];
  let line = 1;
  for (const token of doc.tokens) {
    if (token.map) line = token.map[0] + 1;
    if (token.type !== 'inline') continue;
    for (const child of token.children ?? []) {
      const href = child.type === 'link_open' ? child.attrGet('href') : child.type === 'image' ? child.attrGet('src') : null;
      if (href !== null) links.push({ line, href });
    }
  }
  return links;
}

const isExternal = (href: string) => href === '' || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

function decode(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

class Tree {
  readonly paths = new Set<string>();
  readonly folded = new Map<string, string>();

  constructor(files: string[]) {
    for (const file of files) {
      const parts = file.split('/');
      for (let i = 1; i <= parts.length; i++) this.paths.add(parts.slice(0, i).join('/'));
    }
    for (const path of this.paths) this.folded.set(path.toLowerCase(), path);
  }
}

// target 是解碼後的目標；有問題時 reason 寫原因。
function checkLink(from: string, href: string, tree: Tree, docs: Map<string, Doc>): { target: string; reason?: string } {
  const hash = href.indexOf('#');
  const path = decode((hash < 0 ? href : href.slice(0, hash)).split('?')[0]);
  const fragment = hash < 0 ? '' : decode(href.slice(hash + 1));
  if (path === undefined || fragment === undefined) return { target: href, reason: '無法解碼' };
  const target = hash < 0 ? path : `${path}#${fragment}`;
  let file = from;
  if (path) {
    file = posix.normalize(path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(from), path)).replace(/\/+$/, '');
    if (file === '..' || file.startsWith('../')) return { target, reason: '指到 repo 外' };
    if (file !== '.' && !tree.paths.has(file)) {
      const actual = tree.folded.get(file.toLowerCase());
      return { target, reason: actual ? `大小寫不符（實際是 ${actual}）` : '找不到檔案' };
    }
  }
  const doc = docs.get(file);
  if (fragment && doc && !doc.anchors.has(fragment) && !doc.anchors.has(fragment.toLowerCase())) return { target, reason: '找不到錨點' };
  return { target };
}

interface Section { open: number; close: number }

// 二級標題的範圍：open 是標題、close 是下一個二級標題（或檔尾）在 tokens 的索引。
function section(doc: Doc, title: string): Section | undefined {
  const headings = doc.tokens.flatMap((token, i) => token.type === 'heading_open' && token.tag === 'h2' ? [i] : []);
  const at = headings.findIndex(i => plainText(doc.tokens[i + 1].children ?? []).trim() === title);
  if (at < 0) return undefined;
  return { open: headings[at], close: headings[at + 1] ?? doc.tokens.length };
}

function checkRoadmap(doc: Doc): Problem[] {
  const problems: Problem[] = [];
  const add = (line: number, target: string, reason: string) => problems.push({ file: doc.file, line, target, reason });
  if (!section(doc, '現在在哪裡')) add(1, '## 現在在哪裡', '找不到這一節');
  const done = section(doc, '已完成');
  if (!done) return problems;
  const tokens = doc.tokens.slice(done.open, done.close);
  const table = tokens.findIndex(token => token.type === 'table_open');
  if (table < 0) return problems;
  const tableEnd = tokens.findIndex((token, i) => i > table && token.type === 'table_close');
  const head = tokens.findIndex((token, i) => i > table && token.type === 'thead_close');
  const rows = tokens.slice(head, tableEnd).filter(token => token.type === 'tr_open');
  if (rows.length > DONE_ROWS) add(rows[DONE_ROWS].map![0] + 1, '## 已完成', `${rows.length} 列，上限 ${DONE_ROWS}`);
  return problems;
}

function checkStatus(doc: Doc): Problem[] {
  const heading = doc.tokens.find(token => token.type === 'heading_open' && token.tag === 'h1');
  if (!heading) return [{ file: doc.file, line: 1, target: '# 標題', reason: '沒有一級標題' }];
  const after = heading.map![1];
  const offset = doc.lines.slice(after).findIndex(line => line.trim() !== '');
  if (offset >= 0 && doc.lines[after + offset].includes('狀態：')) return [];
  return [{ file: doc.file, line: offset >= 0 ? after + offset + 1 : heading.map![0] + 1, target: '狀態：', reason: '標題下第一個非空行沒有狀態' }];
}

export function checkDocs(root: string, { staged = false, exceptions = EXCEPTIONS }: { staged?: boolean; exceptions?: Exception[] } = {}) {
  const { files, texts } = loadTree(root, staged);
  const tree = new Tree(files);
  const docs = new Map([...texts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([file, text]) => [file, parse(file, text)]));
  const problems: Problem[] = [];
  const used = new Set<Exception>();
  let links = 0;
  for (const doc of docs.values()) {
    for (const { line, href } of linksOf(doc)) {
      if (isExternal(href)) continue;
      links++;
      const { target, reason } = checkLink(doc.file, href, tree, docs);
      if (!reason) continue;
      const exception = exceptions.find(e => e.file === doc.file && e.target === target);
      if (exception) used.add(exception);
      else problems.push({ file: doc.file, line, target, reason });
    }
    if (doc.file === ROADMAP) problems.push(...checkRoadmap(doc));
    if (STATUS_DIRS.includes(posix.dirname(doc.file)) && posix.basename(doc.file) !== 'README.md') problems.push(...checkStatus(doc));
  }
  for (const e of exceptions.filter(e => !used.has(e))) problems.push({ file: e.file, line: 0, target: e.target, reason: '例外表的這一項沒有用到，請刪掉' });
  return { problems, files: docs.size, links };
}

export const formatProblem = (p: Problem) => `${p.file}${p.line ? `:${p.line}` : ''}  ${p.target}  ${p.reason}`;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  const root = at >= 0 ? resolve(args[at + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const staged = args.includes('--staged');
  // --root 給測試用，別的 repo 不套用這裡的例外表。
  const { problems, files, links } = checkDocs(root, { staged, exceptions: at >= 0 ? [] : EXCEPTIONS });
  if (problems.length) {
    console.error(`文件檢查有 ${problems.length} 個問題（${staged ? '暫存區' : '工作樹'}）：`);
    for (const problem of problems) console.error(formatProblem(problem));
    process.exit(1);
  }
  console.log(`文件檢查通過（${staged ? '暫存區' : '工作樹'}）：${files} 個 Markdown 檔、${links} 個連結`);
}
