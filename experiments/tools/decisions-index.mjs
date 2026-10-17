// 執行：node experiments/tools/decisions-index.mjs（可從任何工作目錄執行）
// 依決策標題與標題下第一行（狀態行）重建 decisions.md 開頭的索引。
// 「一句話」由人填寫，重跑時照 D-ID 保留；新決定的一句話空著，程式會列出來。
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../../docs/decisions.md', import.meta.url);
const source = readFileSync(file, 'utf8');
const newline = source.includes('\r\n') ? '\r\n' : '\n';
// 程式碼區塊裡的「## D-」不算標題：先把區塊內容換成空白，位置不變。
const masked = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, block => block.replace(/[^\r\n]/g, ' '));
const headings = [...masked.matchAll(/^## (D-\d+) (.+?)\r?$/gm)];
if (!headings.length) throw new Error('找不到決策標題，未修改檔案。');

// 與 Markdown 標題錨點一致：保留中英文與數字，去標點、轉小寫、空格改連字號。
const anchorOf = (id, name) => `${id} ${name}`.toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
const anchors = new Map();
for (const [, id, name] of headings) {
  if (anchors.has(id)) throw new Error(`D-ID 重複：${id}，未修改檔案。`);
  anchors.set(id, anchorOf(id, name));
}
const num = id => Number(id.slice(2));
const link = id => `[${id}](#${anchors.get(id)})`;
const splitRow = row => row.split(/(?<!\\)\|/).map(cell => cell.trim());

// 保留現有索引的「一句話」。
const preface = source.slice(0, headings[0].index);
const existingIndex = preface.search(/^## 索引\r?$/m);
const divider = preface.search(/^---\r?$/m);
const summaries = new Map();
if (existingIndex >= 0) {
  const rows = preface.slice(existingIndex, divider > existingIndex ? divider : undefined)
    .split(/\r?\n/).filter(line => line.startsWith('|'));
  const column = rows.length ? splitRow(rows[0]).indexOf('一句話') : -1;
  if (column >= 0) {
    for (const row of rows.slice(2)) {
      const cells = splitRow(row);
      const id = cells[1]?.match(/D-\d+/)?.[0];
      if (id && cells[column]) summaries.set(id, cells[column]);
    }
  }
}

const missed = [];
const decisions = headings.map((heading, index) => {
  const [, id, name] = heading;
  // 標題與狀態行之間可以有空行；只讀第一個非空行，不往正文找。
  const section = source.slice(heading.index + heading[0].length, headings[index + 1]?.index);
  const metadata = section.split(/\r?\n/).find(line => line.trim())?.trim() ?? '';
  const date = metadata.match(/\b\d{4}-\d{2}-\d{2}(?:～(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d{2}))?(?=｜|\s|$)/)?.[0];

  let status;
  if (metadata.startsWith('已取代')) {
    const to = metadata.match(/D-\d+/)?.[0];
    if (to && anchors.has(to)) status = `已取代 → ${link(to)}`;
  } else {
    const symbol = metadata.match(/^(✅|🔁|💬|💡)(?:\s|$)/u)?.[1];
    // 狀態行裡提到、編號比自己大的決定，就是後來修改或補充它的決定。
    const later = [...new Set(metadata.match(/D-\d+/g) ?? [])]
      .filter(other => num(other) > num(id) && anchors.has(other))
      .sort((a, b) => num(a) - num(b));
    if (symbol) status = later.length ? `${symbol} 後續見 ${later.map(link).join('、')}` : symbol;
  }
  if (!date || !status) missed.push(`${id}：${metadata || '（空白）'}`);
  return { id, name, date, status, summary: summaries.get(id) ?? '' };
});

if (missed.length) {
  throw new Error(`標題下第一行格式無法擷取，未修改檔案：\n${missed.join('\n')}`);
}

decisions.sort((a, b) => num(a.id) - num(b.id));
const cell = value => value.replace(/(?<!\\)\|/g, '\\|');
const index = [
  '## 索引',
  '',
  '照編號排列；正文照寫入的順序。「後續見」是後來修改或補充這一條的決定，要一起看。新增或修改決定後執行 `node experiments/tools/decisions-index.mjs`，再補上新決定的一句話。',
  '',
  '| 決定 | 一句話 | 日期 | 狀態 |',
  '|---|---|---|---|',
  ...decisions.map(({ id, name, date, status, summary }) =>
    `| [${id} ${cell(name)}](#${anchors.get(id)}) | ${cell(summary)} | ${date} | ${status} |`),
  '',
  '',
].join(newline);

// 只新增或替換開頭的索引，保留原說明、分隔線與所有決策正文。
const start = existingIndex >= 0 ? existingIndex : divider >= 0 ? divider : preface.length;
const end = existingIndex >= 0 ? (divider > start ? divider : preface.length) : start;
const updated = source.slice(0, start) + index + source.slice(end);
if (updated !== source) writeFileSync(file, updated, 'utf8');

const empty = decisions.filter(d => !d.summary).map(d => d.id);
console.log(`索引共 ${decisions.length} 條；還沒寫一句話的：${empty.length ? empty.join('、') : '無'}。`);
