// 執行：node experiments/tools/decisions-index.mjs（可從任何工作目錄執行）
// 依決策標題與標題下第一行（狀態行）重建 decisions.md 開頭的索引，按下面的主題對照表分組（D-141）。
// 「一句話」由人填寫，重跑時照 D-ID 保留；新決定的一句話空著，程式會列出來。
// 查詢：node experiments/tools/decisions-index.mjs D-062 [D-xxx …] 印出原文與明示的後續條目，不寫檔。
// --file <path> 給測試用，改讀另一份決策紀錄。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 每個 D-ID 一個主要主題。分不出來時，看這條決定主要改的是哪一份現行規範。新決定先加在這裡再執行。
const TOPICS = {
  '產品與範圍': [
    'D-001', 'D-002', 'D-003', 'D-004', 'D-005', 'D-006', 'D-007', 'D-009', 'D-013', 'D-017', 'D-018', 'D-019',
    'D-023', 'D-029', 'D-031', 'D-032', 'D-037', 'D-038', 'D-039', 'D-048', 'D-054', 'D-056', 'D-075', 'D-076',
    'D-090', 'D-114', 'D-124', 'D-128', 'D-129', 'D-137',
  ],
  '學習目標與製卡規則': [
    'D-010', 'D-020', 'D-021', 'D-022', 'D-027', 'D-028', 'D-061', 'D-067', 'D-077', 'D-083', 'D-086', 'D-087',
    'D-091', 'D-094', 'D-100', 'D-101', 'D-113', 'D-118', 'D-122', 'D-123', 'D-125', 'D-127', 'D-132', 'D-136',
    'D-139', 'D-151', 'D-152',
  ],
  '資料格式與語法': [
    'D-008', 'D-025', 'D-026', 'D-030', 'D-033', 'D-034', 'D-035', 'D-036', 'D-040', 'D-041', 'D-042', 'D-045',
    'D-046', 'D-049', 'D-050', 'D-063', 'D-064', 'D-079', 'D-080', 'D-081', 'D-082', 'D-088', 'D-089', 'D-092',
    'D-093', 'D-098', 'D-105', 'D-108', 'D-115', 'D-134', 'D-135', 'D-142', 'D-157',
  ],
  '複習與排程': [
    'D-011', 'D-012', 'D-043', 'D-062', 'D-066', 'D-068', 'D-069', 'D-071', 'D-074', 'D-078', 'D-102', 'D-107',
    'D-112', 'D-116', 'D-120', 'D-121', 'D-158', 'D-159',
  ],
  '畫面': [
    'D-024', 'D-044', 'D-047', 'D-057', 'D-058', 'D-060', 'D-070', 'D-073', 'D-084', 'D-095', 'D-096', 'D-097',
    'D-103', 'D-104', 'D-109', 'D-133', 'D-145', 'D-146', 'D-156', 'D-160', 'D-161',
  ],
  'AI 接法與模型': ['D-055', 'D-059', 'D-072', 'D-085', 'D-126'],
  '程式結構與品質': ['D-015', 'D-051', 'D-052', 'D-053', 'D-110', 'D-111', 'D-117', 'D-119', 'D-138', 'D-148', 'D-149', 'D-150', 'D-154', 'D-155'],
  '協作與文件': ['D-014', 'D-016', 'D-065', 'D-099', 'D-106', 'D-130', 'D-131', 'D-140', 'D-141', 'D-143', 'D-144', 'D-147', 'D-153'],
};

const args = process.argv.slice(2);
const at = args.indexOf('--file');
const file = at >= 0 ? resolve(args[at + 1]) : new URL('../../docs/decisions.md', import.meta.url);
const wanted = args.filter((arg, i) => !(at >= 0 && (i === at || i === at + 1)));
const fail = message => {
  console.error(message);
  process.exit(1);
};

const source = readFileSync(file, 'utf8');
const newline = source.includes('\r\n') ? '\r\n' : '\n';
// 程式碼區塊裡的「## D-」不算標題：先把區塊內容換成空白，位置不變。
const masked = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, block => block.replace(/[^\r\n]/g, ' '));
const headings = [...masked.matchAll(/^## (D-\d+) (.+?)\r?$/gm)];
if (!headings.length) fail('找不到決策標題，未修改檔案。');

// 與 Markdown 標題錨點一致：保留中英文與數字，去標點、轉小寫、空格改連字號。
const anchorOf = (id, name) => `${id} ${name}`.toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
const anchors = new Map();
for (const [, id, name] of headings) {
  if (anchors.has(id)) fail(`D-ID 重複：${id}，未修改檔案。`);
  anchors.set(id, anchorOf(id, name));
}
const num = id => Number(id.slice(2));
const link = id => `[${id}](#${anchors.get(id)})`;
const splitRow = row => row.split(/(?<!\\)\|/).map(cell => cell.trim());

const decisions = headings.map((heading, index) => {
  const [, id, name] = heading;
  const body = source.slice(heading.index, headings[index + 1]?.index);
  // 標題與狀態行之間可以有空行；只讀第一個非空行，不往正文找。
  const metadata = body.slice(heading[0].length).split(/\r?\n/).find(line => line.trim())?.trim() ?? '';
  const date = metadata.match(/\b\d{4}-\d{2}-\d{2}(?:～(?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2}|\d{2}))?(?=｜|\s|$)/)?.[0];
  let status;
  let next = [];
  if (metadata.startsWith('已取代')) {
    const to = metadata.match(/D-\d+/)?.[0];
    if (to && anchors.has(to)) {
      status = `已取代 → ${link(to)}`;
      next = [to];
    }
  } else {
    const symbol = metadata.match(/^(✅|🔁|💬|💡)(?:\s|$)/u)?.[1];
    // 狀態行裡提到、編號比自己大的決定，就是後來修改或補充它的決定。
    next = [...new Set(metadata.match(/D-\d+/g) ?? [])]
      .filter(other => num(other) > num(id) && anchors.has(other))
      .sort((a, b) => num(a) - num(b));
    if (symbol) status = next.length ? `${symbol} 後續見 ${next.map(link).join('、')}` : symbol;
  }
  return { id, name, body, metadata, date, status, next };
});
const byId = new Map(decisions.map(d => [d.id, d]));

// 查詢：在任何寫檔之前分流，只讀不寫。
if (wanted.length) {
  const ids = wanted.map(arg => /^D-\d+$/i.test(arg) ? `D-${arg.slice(2).padStart(3, '0')}` : arg);
  const unknown = ids.filter(id => !byId.has(id));
  if (unknown.length) fail(`沒有這些決定：${unknown.join('、')}`);
  const order = [...new Set(ids)];
  for (let i = 0; i < order.length; i++) {
    for (const id of byId.get(order[i]).next) if (!order.includes(id)) order.push(id);
  }
  console.log('以下是原文與明示的後續條目，不等於完整的現行規則；實作以 product、architecture、syntax 與任務說明為準。\n');
  console.log(order.map(id => byId.get(id).body.replace(/\r\n/g, '\n').trim()).join('\n\n'));
  process.exit(0);
}

const missed = decisions.filter(d => !d.date || !d.status).map(d => `${d.id}：${d.metadata || '（空白）'}`);
if (missed.length) fail(`標題下第一行格式無法擷取，未修改檔案：\n${missed.join('\n')}`);

// 主題對照表：重複、漏分與不存在的 D-ID 都不寫檔。
const topicOf = new Map();
const problems = [];
for (const [topic, ids] of Object.entries(TOPICS)) {
  for (const id of ids) {
    if (topicOf.has(id)) problems.push(`${id} 重複：${topicOf.get(id)}、${topic}`);
    else topicOf.set(id, topic);
    if (!byId.has(id)) problems.push(`${id} 不存在（在「${topic}」）`);
  }
}
for (const { id } of decisions) if (!topicOf.has(id)) problems.push(`${id} 沒有分到主題`);
if (problems.length) fail(`主題對照表有問題，未修改檔案：\n${problems.join('\n')}`);

// 保留現有索引的「一句話」：索引底下可能有好幾張表，只讀第一欄有 D-ID 的列。
const preface = source.slice(0, headings[0].index);
const existingIndex = preface.search(/^## 索引\r?$/m);
const divider = preface.search(/^---\r?$/m);
const summaries = new Map();
if (existingIndex >= 0) {
  const rows = preface.slice(existingIndex, divider > existingIndex ? divider : undefined)
    .split(/\r?\n/).filter(line => line.startsWith('|'));
  const header = rows.find(row => splitRow(row).includes('一句話'));
  const column = header ? splitRow(header).indexOf('一句話') : -1;
  for (const row of column >= 0 ? rows : []) {
    const cells = splitRow(row);
    const id = cells[1]?.match(/^\[(D-\d+) /)?.[1];
    if (!id) continue;
    if (summaries.has(id)) fail(`索引裡 ${id} 出現不只一次，未修改檔案。`);
    if (cells[column]) summaries.set(id, cells[column]);
  }
}

const cell = value => value.replace(/(?<!\\)\|/g, '\\|');
const index = [
  '## 索引',
  '',
  '依主題分組，組內照編號排；正文照寫入的順序。「後續見」是後來修改或補充這一條的決定，要一起看。已知 D-ID 用 `node experiments/tools/decisions-index.mjs D-xxx` 印出原文與後續條目。新增決定時，先在 `experiments/tools/decisions-index.mjs` 的主題對照表加上 D-ID，再執行它，然後補上新決定的一句話。',
  '',
  ...Object.keys(TOPICS).flatMap(topic => [
    `### ${topic}`,
    '',
    '| 決定 | 一句話 | 日期 | 狀態 |',
    '|---|---|---|---|',
    ...decisions.filter(d => topicOf.get(d.id) === topic).sort((a, b) => num(a.id) - num(b.id))
      .map(({ id, name, date, status }) => `| [${id} ${cell(name)}](#${anchors.get(id)}) | ${cell(summaries.get(id) ?? '')} | ${date} | ${status} |`),
    '',
  ]),
  '',
].join(newline);

// 只新增或替換開頭的索引，保留原說明、分隔線與所有決策正文。
const start = existingIndex >= 0 ? existingIndex : divider >= 0 ? divider : preface.length;
const end = existingIndex >= 0 ? (divider > start ? divider : preface.length) : start;
const updated = source.slice(0, start) + index + source.slice(end);
if (updated !== source) writeFileSync(file, updated, 'utf8');

const empty = decisions.filter(d => !summaries.get(d.id)).map(d => d.id);
console.log(`索引共 ${decisions.length} 條、${Object.keys(TOPICS).length} 個主題；還沒寫一句話的：${empty.length ? empty.join('、') : '無'}。`);
