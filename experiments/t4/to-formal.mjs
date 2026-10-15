// 把 T4 轉錄稿的暫定格式機械轉成正式格式（docs/syntax.md §1）：圖檔名與圖的錨點、例題的錨點。
// 用法：node to-formal.mjs <轉錄稿.md> <輸出資料夾> <圖檔名前綴，例如「國二上自然 2-2」> <轉錄稿名稱>
// 只改格式，不改內容；圖從轉錄稿旁的 圖/ 複製到輸出資料夾的 圖/。輸出資料夾要在 repo 外（教材有版權）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateOut } from './core.mjs';

const [source, outArg, prefix, name] = process.argv.slice(2);
if (!name) { console.log('用法：node to-formal.mjs <轉錄稿.md> <輸出資料夾> <圖檔名前綴> <轉錄稿名稱>'); process.exit(1); }
const outDir = await validateOut(outArg);
const lines = (await fs.readFile(source, 'utf8')).replace(/^﻿/, '').split(/\r?\n/);
await fs.mkdir(path.join(outDir, '圖'), { recursive: true });
const result = [];
let page = null, figureOnPage = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const pageMark = line.match(/^p\.(\d+) \^p\1$/);
  if (pageMark) { page = pageMark[1]; figureOnPage = 0; result.push(line); continue; }
  const image = line.match(/^!\[\[([^\]|]+\.png)\]\]$/);
  const caption = lines[i + 1]?.match(/^\*(.+)\*\s+\^fig-p\d+-\d+$/);
  if (image && caption) {
    figureOnPage++;
    // 有圖號的用圖號（圖 2-13 A／B 這種子圖加上字母），沒有的用頁碼加這一頁的第幾張。
    const number = caption[1].match(/^圖\s?(\d+-\d+)(?:\s?([A-Z])(?=\s))?/);
    const label = number ? `圖${number[1]}${number[2] ?? ''}` : `p${page}-fig${figureOnPage}`;
    const id = number ? `fig${number[1]}${(number[2] ?? '').toLowerCase()}` : `p${page}-fig${figureOnPage}`;
    const file = `${prefix} ${label}.png`;
    await fs.copyFile(path.join(path.dirname(source), '圖', image[1]), path.join(outDir, '圖', file));
    result.push(`![[${file}]]`, `*${caption[1]}* ^${id}`);
    i++; continue;
  }
  // 例題：標題寫成粗體段落、ID 在同一行最後，內容移出引言框。
  const example = line.match(/^> \[!例題\]\s*例題\s?(\d+-\d+)(.*)$/);
  if (example) {
    result.push(`**例題 ${example[1]}${example[2]}** ^ex${example[1]}`);
    while (lines[i + 1]?.startsWith('>')) result.push(lines[++i].replace(/^>\s?/, ''));
    continue;
  }
  result.push(line);
}
await fs.writeFile(path.join(outDir, name + '.md'), result.join('\n'));
console.log(`已寫出 ${path.join(outDir, name + '.md')}`);
