import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { ROOT, exists, readJson, writeJson, slug, loadKeys, redact, parsePages, validateOut, processFigures, textPart, imagePart } from './core.mjs';
import { ApiClient } from './api.mjs';
import { find, render } from './pdf.mjs';
import { report } from './report.mjs';

const HELP = `T4：Node 24，結果必須在 repo 外\nnode t4.mjs find --pdf <檔案> --text <文字>\nnode t4.mjs render --pdf <檔案> --pages <起-迄> --out <資料夾>\nnode t4.mjs <transcribe|verify|cards|report> --out <資料夾>\nnode t4.mjs cards --out <資料夾> --transcript <轉錄稿路徑>\nnode t4.mjs all --pdf <檔案> --pages <起-迄> --out <資料夾>\nnode t4.mjs selftest`;
let secrets = [];
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    pdf: { type: 'string' }, pages: { type: 'string' }, out: { type: 'string' },
    text: { type: 'string' }, transcript: { type: 'string' }, help: { type: 'boolean' }
  } });
  if (values.help || !positionals.length) { console.log(HELP); return; }
  const [command] = positionals;
  if (positionals.length !== 1) throw new Error('一次指定一個指令');
  if (command === 'selftest') { const { selftest } = await import('./selftest.mjs'); await selftest(); return; }
  if (command === 'find') { if (!values.pdf) throw new Error('find 需要 --pdf'); await find(values.pdf, values.text); return; }
  if (!['render', 'transcribe', 'verify', 'cards', 'all', 'report'].includes(command)) throw new Error('未知指令\n' + HELP);
  const out = await validateOut(values.out);
  const config = await readJson(path.join(ROOT, 'models.json'));
  if (config.verify.length !== 1) throw new Error('verify 必須指定一個檢查模型');
  const ids = new Map();
  for (const model of [...config.transcribe, ...config.verify, ...config.cards]) {
    const key = `${model.provider}/${model.model}`, id = slug(model.model);
    if (!id || (ids.has(id) && ids.get(id) !== key)) throw new Error('模型名稱無效或轉換後檔名重複');
    ids.set(id, key);
    const provider = config.providers[model.provider];
    if (!provider || new URL(provider.baseUrl).protocol !== 'https:' || !Number.isFinite(provider.minSecondsBetweenCalls) || provider.minSecondsBetweenCalls < 0) throw new Error('供應商設定無效');
  }
  await fs.mkdir(out, { recursive: true });
  if (command === 'report') { await report(config, out); return; }
  if (command === 'render' || command === 'all') {
    if (!values.pdf) throw new Error('render/all 需要 --pdf');
    await render(values.pdf, parsePages(values.pages), out);
    if (command === 'render') return;
  }
  const { pages } = await readJson(path.join(out, '頁面/文字層.json'));
  const keys = await loadKeys(config.providers); secrets = Object.values(keys).filter(Boolean);
  const client = new ApiClient(config, keys, out);
  async function pageParts() {
    const parts = [];
    for (const page of pages) { parts.push(await imagePart(path.join(out, '頁面', page.image)), textPart(`PDF 第 ${page.page} 頁`)); }
    return parts;
  }
  async function produce(step, model, system, content, file, variant, transform) {
    const fingerprint = createHash('sha256').update(JSON.stringify({ model, system, content })).digest('hex');
    const metaFile = file + '.meta.json';
    if (await exists(file)) {
      if (!(await exists(metaFile)) || (await readJson(metaFile)).fingerprint !== fingerprint) throw new Error(`既有 ${path.relative(out, file)} 的輸入／提示不同或缺少來源紀錄；請改用新的 --out`);
      console.log(`${step}：沿用 ${path.relative(out, file)}`); return true;
    }
    const result = await client.request(step, model, system, content, variant);
    if (result === null) return false;
    const processed = transform ? await transform(result) : { text: result };
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, processed.text + '\n');
    await writeJson(metaFile, { fingerprint, ...(processed.stats ? { figures: processed.stats } : {}) });
    return true;
  }
  async function transcribe() {
    let ok = true;
    const system = await fs.readFile(path.join(ROOT, 'prompts/transcribe.md'), 'utf8');
    const content = [...await pageParts(), textPart('以下是文字層（以頁面圖片為準）：\n' + pages.map(p => `PDF 第 ${p.page} 頁\n${p.text}`).join('\n\n'))];
    for (const model of config.transcribe) {
      if (!await produce('transcribe', model, system, content, path.join(out, slug(model.model), '轉錄稿.md'), undefined,
        text => processFigures(text, model.model, pages, out))) ok = false;
    }
    return ok;
  }
  async function verify() {
    let ok = true;
    const system = await fs.readFile(path.join(ROOT, 'prompts/verify.md'), 'utf8');
    for (const source of config.transcribe) {
      const id = slug(source.model), file = path.join(out, id, '轉錄稿.md');
      if (!(await exists(file))) { console.log(`verify：缺少 ${id} 的轉錄稿，跳過`); ok = false; continue; }
      const content = [...await pageParts(), textPart('轉錄稿全文：\n' + await fs.readFile(file, 'utf8'))];
      if (!await produce('verify', config.verify[0], system, content, path.join(out, id, '檢查.md'), id)) ok = false;
    }
    return ok;
  }
  async function cards() {
    const source = values.transcript ? path.resolve(out, values.transcript) : path.join(out, slug(config.transcribe[0].model), '轉錄稿.md');
    if (!(await exists(source))) { console.log('cards：缺少指定轉錄稿，跳過；轉錄成功後再重跑 cards'); return false; }
    const transcript = await fs.readFile(source, 'utf8');
    const system = (await Promise.all(['../../docs/card-rules/common.md', '../../docs/card-rules/science.md', 'prompts/cards.md']
      .map(file => fs.readFile(path.resolve(ROOT, file), 'utf8')))).join('\n\n');
    const content = [textPart('轉錄稿全文：\n' + transcript)];
    const references = [...new Set([...transcript.matchAll(/!\[\[([^\]\n]+)\]\]/g)].map(m => m[1].split('|')[0]))];
    for (const reference of references) {
      if (!/^[a-zA-Z0-9._-]+\.png$/.test(reference)) throw new Error('轉錄稿的圖片名稱無效，只接受圖資料夾內的 PNG 檔名');
      const file = path.join(path.dirname(source), '圖', reference);
      if (!(await exists(file))) throw new Error(`缺少轉錄稿引用的圖片 ${reference}`);
      content.push(textPart(`轉錄稿的圖：${reference}`), await imagePart(file));
    }
    const original = await pageParts();
    let ok = true;
    for (const model of config.cards) for (const variant of ['只用轉錄稿', '轉錄稿加原頁']) {
      const parts = variant === '只用轉錄稿' ? content : [...content, ...original];
      if (!await produce('cards', model, system, parts, path.join(out, '卡片', `${slug(model.model)}-${variant}.md`), variant)) ok = false;
    }
    return ok;
  }
  let ok = true;
  if (command === 'transcribe' || command === 'all') if (!await transcribe()) ok = false;
  if (command === 'verify' || command === 'all') if (!await verify()) ok = false;
  if (command === 'cards' || command === 'all') if (!await cards()) ok = false;
  if (command === 'all') await report(config, out);
  if (!ok) { console.log('部分項目未完成；可重跑該步驟（已有結果會沿用），再執行 report。'); process.exitCode = 2; }
}
main().catch(error => { console.error(redact(error.message, secrets)); process.exitCode = 1; });
