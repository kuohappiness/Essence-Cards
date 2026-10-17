// 執行：node experiments/tools/decisions-index.mjs（可從任何工作目錄執行）
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../../docs/decisions.md', import.meta.url);
const source = readFileSync(file, 'utf8');
const newline = source.includes('\r\n') ? '\r\n' : '\n';
const headings = [...source.matchAll(/^## (D-\d+) (.+?)\r?$/gm)];
if (!headings.length) throw new Error('找不到決策標題，未修改檔案。');

const ids = new Set();
const missed = [];
const decisions = headings.map((heading, index) => {
  const [, id, name] = heading;
  if (ids.has(id)) throw new Error(`D-ID 重複：${id}，未修改檔案。`);
  ids.add(id);

  // 標題與狀態行之間可以有空行；只讀第一個非空行，不往正文找。
  const section = source.slice(
    heading.index + heading[0].length,
    headings[index + 1]?.index,
  );
  const metadata = section.split(/\r?\n/).find(line => line.trim())?.trim() ?? '';
  const date = metadata.match(/\b\d{4}-\d{2}-\d{2}(?:～(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d{2}))?(?=｜|\s|$)/)?.[0];
  const symbol = metadata.match(/^(✅|🔁|💬|💡)(?:\s|$)/u)?.[1];
  // 保留含已取代／已修改的原文片段與連結，包括沒有狀態符號的舊決定。
  const changes = metadata.split('｜').filter(part => /已取代\s*→|已修改/.test(part));
  const status = [symbol, ...changes].filter(Boolean).join('｜');
  if (!date || !status) missed.push(`${id}：${metadata || '（空白）'}`);

  // 與 Markdown 標題錨點一致：保留中英文與數字，去標點、轉小寫、空格改連字號。
  const anchor = `${id} ${name}`.toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
  return { id, name, date, status, anchor };
});

if (missed.length) {
  throw new Error(`標題下第一行格式無法擷取，未修改檔案：\n${missed.join('\n')}`);
}

decisions.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
const cell = value => value.replace(/\|/g, '\\|');
const index = [
  '## 索引',
  '',
  '| D-ID | 名稱 | 日期 | 狀態 |',
  '|---|---|---|---|',
  ...decisions.map(({ id, name, date, status, anchor }) =>
    `| [${id}](#${anchor}) | ${cell(name)} | ${date} | ${cell(status)} |`),
  '',
  '',
].join(newline);

// 只新增或替換開頭的索引，保留原說明、分隔線與所有決策正文。
const preface = source.slice(0, headings[0].index);
const existingIndex = preface.search(/^## 索引\r?$/m);
const divider = preface.search(/^---\r?$/m);
const start = existingIndex >= 0 ? existingIndex : divider >= 0 ? divider : preface.length;
const end = existingIndex >= 0 ? divider > start ? divider : preface.length : start;
const updated = source.slice(0, start) + index + source.slice(end);
if (updated !== source) writeFileSync(file, updated, 'utf8');
console.log(`索引共 ${decisions.length} 條；標題下第一行未擷取的 D-ID：無。`);
