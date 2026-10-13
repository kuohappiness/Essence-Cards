import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(ROOT, '../..');
export const slug = model => model.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+$/, '');
export const exists = async file => { try { await fs.access(file); return true; } catch { return false; } };
export const readJson = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temp, file);
}
export function parseEnv(text) {
  const result = {};
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (/^["']/.test(value)) {
      const quote = value[0], end = value.lastIndexOf(quote);
      if (end < 1 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw new Error('金鑰檔的引號格式無效');
      value = value.slice(1, end);
    } else value = value.replace(/\s+#.*$/, '').trim();
    result[match[1]] = value;
  }
  return result;
}
export async function loadKeys(providers, env = process.env, file = path.join(env.USERPROFILE || os.homedir(), '.essence-api-keys.env')) {
  let values = {};
  try { values = parseEnv(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return Object.fromEntries(Object.entries(providers).map(([id, p]) => [id, env[p.keyName] ?? values[p.keyName] ?? '']));
}
export function redact(text, secrets = []) {
  let value = String(text);
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) value = value.split(form).join('[已隱藏]');
  }
  return value.replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [已隱藏]')
    .replace(/data:image\/[^;]+;base64,[a-z0-9+/=]+/gi, '[圖片已省略]');
}
export function parsePages(value) {
  if (!/^\d+(?:-\d+)?$/.test(value || '')) throw new Error('--pages 必須是 PDF 頁序，例如 23-26');
  const [start, end = start] = value.split('-').map(Number);
  if (start < 1 || end < start || end - start > 1000) throw new Error('--pages 範圍無效');
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
export function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
async function resolvedPath(target) {
  const tail = [];
  let current = path.resolve(target);
  while (!(await exists(current))) { tail.unshift(path.basename(current)); current = path.dirname(current); }
  return path.join(await fs.realpath(current), ...tail);
}
export async function validateOut(value) {
  if (!value) throw new Error('請指定 repo 外的 --out 資料夾');
  const out = await resolvedPath(value);
  const roots = [REPO];
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPO, encoding: 'utf8', windowsHide: true }).trim();
    roots.push(path.dirname(common));
  } catch { /* 沒有 Git 時仍保護目前的 repo。 */ }
  for (const root of roots) if (isInside(await resolvedPath(root), out)) throw new Error('--out 不可位於 repo 或其 worktree 內');
  return out;
}
export function parseFigures(text) {
  return [...text.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/g)].map(match => {
    const attrs = Object.fromEntries([...match[1].matchAll(/([a-z]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], m[2]]));
    return { raw: match[0], index: match.index, page: /^\d+$/.test(attrs.page || '') ? Number(attrs.page) : NaN,
      box: (attrs.box || '').split(',').map(n => n.trim() === '' ? NaN : Number(n)), description: match[2].trim() };
  });
}
export function pixelBox(box, width, height) {
  if (box.length !== 4 || !box.every(n => Number.isFinite(n) && n >= 0 && n <= 1000)) throw new Error('圖的座標必須是 0～1000 的四個數值');
  const [ymin, xmin, ymax, xmax] = box;
  if (ymin >= ymax || xmin >= xmax) throw new Error('圖的座標順序無效');
  const x = Math.floor(xmin * width / 1000), y = Math.floor(ymin * height / 1000);
  return { x, y, width: Math.ceil(xmax * width / 1000) - x, height: Math.ceil(ymax * height / 1000) - y };
}
export async function cropImage(source, target, box) {
  const img = await loadImage(source), crop = pixelBox(box, img.width, img.height);
  const canvas = createCanvas(crop.width, crop.height);
  canvas.getContext('2d').drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, await canvas.encode('png'));
  return crop;
}
export async function processFigures(text, model, pages, out, warn = console.warn) {
  const figures = parseFigures(text), counts = new Map(), stats = { total: figures.length, success: 0, failed: 0 };
  let result = '', cursor = 0;
  for (const figure of figures) {
    result += text.slice(cursor, figure.index);
    cursor = figure.index + figure.raw.length;
    const ordinal = (counts.get(figure.page) || 0) + 1;
    counts.set(figure.page, ordinal);
    const name = `${slug(model)}-p${figure.page}-${ordinal}.png`;
    try {
      if (!Number.isSafeInteger(figure.page)) throw new Error('圖的 page 屬性須為純數字 PDF 頁序');
      const page = pages.find(p => p.page === figure.page);
      if (!page) throw new Error('圖的 PDF 頁序不在本次頁面內');
      await cropImage(path.join(out, '頁面', page.image), path.join(out, slug(model), '圖', name), figure.box);
      const lineStart = text.lastIndexOf('\n', figure.index - 1) + 1;
      const quote = text.slice(lineStart, figure.index).match(/^(?:> ?)+$/)?.[0] || '';
      result += `![[${name}]]\n${quote}*${figure.description.replace(/\s+/g, ' ')}* ^fig-p${figure.page}-${ordinal}`;
      stats.success++;
    } catch (error) {
      result += figure.raw;
      stats.failed++;
      warn(`${slug(model)} 圖 ${ordinal} 裁切失敗：${error.message}；保留原標記`);
    }
  }
  return { text: result + text.slice(cursor), stats };
}
export async function imagePart(file) {
  return { type: 'image_url', image_url: { url: `data:image/png;base64,${(await fs.readFile(file)).toString('base64')}` } };
}
export const textPart = text => ({ type: 'text', text });
