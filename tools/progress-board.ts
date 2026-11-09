// 開發進度畫板：把 docs/progress-map.md 轉成兩個給人看的網頁，由 GitHub Actions 發布到 GitHub Pages。
// md 是唯一來源，AI 只維護 md；網頁不進 repo（_site/ 在 .gitignore），數字、進度條與連線都由程式算。
// 輸出：progress-map-list.html（清單）、progress-map-board.html（畫布）、index.html（轉到清單）。
// 用法：node tools/progress-board.ts [--out <資料夾>]（預設 _site）
// 格式寫錯（不認得的符號、表格不在模組底下、空的段或模組）時印出「行號  原因」並以 exit code 1 結束。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BOARD_PAGE, LIST_PAGE, MAP, MapError, count, itemsOf, parseMap, percent, type Stage } from './progress-board-data.ts';
import { BACKLOG, countDeferred } from './check-docs.ts';
import { renderCanvas } from './progress-board-canvas.ts';
import { renderList } from './progress-board-list.ts';

/** 根網址：舊連結與加到主畫面的捷徑都轉到清單頁。 */
export const REDIRECT = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${LIST_PAGE}">
<title>Essence 開發進度</title>
<script>location.replace('${LIST_PAGE}'+location.hash);</script>
</head>
<body><p><a href="${LIST_PAGE}">Essence 開發進度（清單）</a>｜<a href="${BOARD_PAGE}">畫布</a></p></body>
</html>
`;

function main(): void {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const out = resolve(root, at >= 0 ? args[at + 1] : '_site');
  let stages: Stage[];
  try {
    stages = parseMap(readFileSync(resolve(root, MAP), 'utf8'));
  } catch (error) {
    if (!(error instanceof MapError)) throw error;
    console.error(`${MAP}${error.line ? `:${error.line}` : ''}  ${error.message}`);
    process.exit(1);
  }
  const updated = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date());
  const meta = { updated, commit: process.env.GITHUB_SHA, deferred: countDeferred(readFileSync(resolve(root, BACKLOG), 'utf8')) };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, LIST_PAGE), renderList(stages, meta));
  writeFileSync(join(out, BOARD_PAGE), renderCanvas(stages, meta));
  writeFileSync(join(out, 'index.html'), REDIRECT);
  console.log(`進度畫板：${out}（${stages.length} 段、v1 ${percent(count(stages.flatMap(itemsOf))) ?? 0}%、待補測與補做 ${meta.deferred} 列）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
