import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ROOT, exists, readJson, writeJson } from './core.mjs';

async function openPdf(file) {
  const bytes = await fs.readFile(file);
  const packageRoot = path.join(ROOT, 'node_modules/pdfjs-dist');
  return { bytes, pdf: await getDocument({ data: new Uint8Array(bytes),
    cMapUrl: path.join(packageRoot, 'cmaps') + '/', cMapPacked: true,
    standardFontDataUrl: path.join(packageRoot, 'standard_fonts') + '/',
    wasmUrl: path.join(packageRoot, 'wasm') + '/', verbosity: 0 }).promise };
}
async function pageText(page) {
  const content = await page.getTextContent();
  return content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : '')).join('');
}
export async function find(pdfFile, needle) {
  if (!needle?.trim()) throw new Error('find 需要 --text');
  const { pdf } = await openPdf(pdfFile);
  let count = 0;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const text = await pageText(await pdf.getPage(n));
      // PDF 文字層常把詞拆開；搜尋時忽略排版空白。
      const normalized = text.replace(/\s+/g, ''), query = needle.replace(/\s+/g, '');
      let start = 0, index;
      while ((index = normalized.indexOf(query, start)) !== -1) {
        console.log(`PDF 第 ${n} 頁：…${normalized.slice(Math.max(0, index - 40), index + query.length + 40)}…`);
        count++; start = index + query.length;
      }
    }
    if (!count) console.log('文字層找不到指定文字');
  } finally { await pdf.loadingTask.destroy(); }
}
export async function render(pdfFile, numbers, out) {
  const { pdf, bytes } = await openPdf(pdfFile);
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const manifestFile = path.join(out, '頁面/文字層.json');
  try {
    if (numbers.some(n => n > pdf.numPages)) throw new Error(`PDF 只有 ${pdf.numPages} 頁`);
    if (await exists(manifestFile)) {
      const previous = await readJson(manifestFile);
      if (previous.sourceHash !== sourceHash || JSON.stringify(previous.pages.map(p => p.page)) !== JSON.stringify(numbers)) throw new Error('此 --out 已有不同教材或頁序，請改用新的結果資料夾');
      if ((await Promise.all(previous.pages.map(p => exists(path.join(out, '頁面', p.image))))).every(Boolean)) {
        console.log('render：沿用相同教材與頁序的頁面'); return;
      }
    }
    await fs.mkdir(path.join(out, '頁面'), { recursive: true });
    const pages = [];
    for (const n of numbers) {
      const page = await pdf.getPage(n), unit = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 1600 / Math.max(unit.width, unit.height) });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const image = `p${n}.png`;
      await fs.writeFile(path.join(out, '頁面', image), await canvas.encode('png'));
      pages.push({ page: n, image, width: canvas.width, height: canvas.height, text: await pageText(page) });
      page.cleanup();
      console.log(`render：PDF 第 ${n} 頁 → ${canvas.width}×${canvas.height}`);
    }
    await writeJson(manifestFile, { sourceHash, pages });
  } finally { await pdf.loadingTask.destroy(); }
}
