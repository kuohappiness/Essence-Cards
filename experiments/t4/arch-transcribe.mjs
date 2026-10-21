import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, exists, readJson, writeJson, parsePages, processFigures, imagePart, textPart, slug } from './core.mjs';
import { render } from './pdf.mjs';
import { hash, references } from './screen-analysis.mjs';
import { createSession } from './arch-request.mjs';
import { settings } from './arch.mjs';

async function pageParts(work, pages) {
  const content = [], saved = [];
  for (const page of pages) {
    const file = path.join(work, '頁面', page.image), label = textPart(`PDF 第 ${page.page} 頁`);
    content.push(await imagePart(file), label);
    saved.push({ type: 'image', file: `頁面/${page.image}`, sha256: hash(await fs.readFile(file)) }, label);
  }
  return { content, saved };
}
async function stable(file, text) {
  if (await exists(file)) {
    if (await fs.readFile(file, 'utf8') !== text) throw new Error('既有轉錄產物不同，拒絕覆蓋；請另用 --out');
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, { flag: 'wx' });
}
export async function transcribe({ out, pdf }) {
  if (!pdf) throw new Error('transcribe 需要 --pdf');
  const config = await settings(), session = await createSession(out);
  const prompt = await fs.readFile(path.join(ROOT, 'prompts/transcribe.md'), 'utf8');
  const verifyPrompt = await fs.readFile(path.join(ROOT, 'prompts/verify.md'), 'utf8');
  for (const [name, spec] of Object.entries(config.materials)) {
    const work = path.join(out, '紀錄/轉錄', name), final = path.join(out, '材料', name);
    await render(pdf, parsePages(spec.pdfPages), work);
    const { pages, sourceHash } = await readJson(path.join(work, '頁面/文字層.json'));
    const images = await pageParts(work, pages);
    const text = textPart('以下是文字層（以頁面圖片為準）：\n' + pages.map(p => `PDF 第 ${p.page} 頁\n${p.text}`).join('\n\n'));
    const response = await session.produce({ dir: work, step: '轉錄', model: config.transcribe, system: prompt,
      content: [...images.content, text], saved: [...images.saved, text] });
    const processed = await processFigures(response.parts.文字, config.transcribe.model, pages, work);
    const sourceDir = path.join(work, slug(config.transcribe.model));
    const raw = path.join(sourceDir, '轉錄稿.md');
    await stable(raw, processed.text + '\n');
    const verifyText = textPart('轉錄稿全文：\n' + processed.text);
    const verification = await session.produce({ dir: work, step: '核對', model: config.models.terra, system: verifyPrompt,
      content: [...images.content, verifyText], saved: [...images.saved, verifyText] });
    await stable(path.join(final, '檢查.md'), verification.parts.文字 + '\n');
    if (processed.stats.failed) throw new Error(`${name} 有 ${processed.stats.failed} 張圖裁切失敗，先核對原始轉錄`);
    // to-formal 的舊入口只辨認 fig-pN-N。建立暫存輸入適配目前轉錄錨點，保留原稿。
    const adapter = path.join(work, '正式格式輸入');
    await fs.mkdir(path.join(adapter, '圖'), { recursive: true });
    const lines = processed.text.split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i++) {
      const image = lines[i].match(/^!\[\[([^\]]+\.png)\]\]$/), caption = lines[i + 1].match(/^\*(.+)\*\s+\^[\w-]+\s*$/);
      if (image && caption) {
        const number = image[1].match(/-p(\d+)-(\d+)\.png$/);
        if (number) lines[i + 1] = `*${caption[1]}* ^fig-p${number[1]}-${number[2]}`;
      }
    }
    for (const image of references(processed.text)) await fs.copyFile(path.join(sourceDir, '圖', image), path.join(adapter, '圖', image));
    await fs.writeFile(path.join(adapter, '轉錄稿.md'), lines.join('\n'));
    // 先在 staging 轉換，與既有 final 比對後才寫出，避免重跑改掉 Claude 正在核對的稿。
    const staging = path.join(work, '正式格式');
    execFileSync(process.execPath, [path.join(ROOT, 'to-formal.mjs'), path.join(adapter, '轉錄稿.md'), staging, spec.unit, '教材'], { windowsHide: true, stdio: 'pipe' });
    let formal = await fs.readFile(path.join(staging, '教材.md'), 'utf8');
    // 引言框內的圖不是 to-formal 舊入口的處理範圍；同樣給正式、安全且無模型名稱的檔名。
    let extra = 0;
    for (const image of references(formal)) if (!(await exists(path.join(staging, '圖', image)))) {
      const target = `${spec.unit} 補圖${++extra}.png`;
      await fs.copyFile(path.join(sourceDir, '圖', image), path.join(staging, '圖', target));
      formal = formal.replaceAll(`![[${image}]]`, `![[${target}]]`);
    }
    await stable(path.join(final, '教材.md'), formal);
    await fs.mkdir(path.join(final, '圖'), { recursive: true });
    for (const image of references(formal)) {
      const bytes = await fs.readFile(path.join(staging, '圖', image)), file = path.join(final, '圖', image);
      if (await exists(file)) { if (hash(await fs.readFile(file)) !== hash(bytes)) throw new Error('既有圖片不同，拒絕覆蓋'); }
      else await fs.writeFile(file, bytes, { flag: 'wx' });
    }
    await writeJson(path.join(final, '轉錄紀錄.json'), { sourceHash, pdfPages: pages.map(p => p.page), figures: processed.stats,
      transcriptHash: hash(formal), transcription: response.fingerprint, verification: verification.fingerprint });
    console.log(`${name}：${pages.length} 頁，${references(formal).length} 圖，已核對並轉正式格式`);
  }
  console.log(`預算已計 $${(await session.budget.total()).toFixed(6)}（缺帳單資訊的請求採保守預留）`);
}

export async function exams({ out, photos }) {
  if (!photos) throw new Error('exams 需要 --photos');
  const names = (await fs.readdir(photos, { withFileTypes: true })).filter(e => e.isFile() && /\.(jpe?g|png)$/i.test(e.name)).map(e => e.name).sort();
  if (!names.length) throw new Error('照片資料夾沒有 JPG／PNG');
  const dir = path.join(out, '考題'), copied = path.join(dir, '照片');
  await fs.mkdir(copied, { recursive: true });
  const content = [], saved = [];
  for (const [index, name] of names.entries()) {
    const source = path.join(photos, name), target = path.join(copied, name), bytes = await fs.readFile(source);
    if (await exists(target)) { if (hash(await fs.readFile(target)) !== hash(bytes)) throw new Error('考卷照片與既有複本不同'); }
    else await fs.copyFile(source, target);
    const label = textPart(`考卷第 ${index + 1} 頁`), image = await imagePart(target);
    if (/\.jpe?g$/i.test(name)) image.image_url.url = image.image_url.url.replace('data:image/png;', 'data:image/jpeg;');
    content.push(label, image); saved.push(label, { type: 'image', file: `考題/照片/${name}`, sha256: hash(bytes) });
  }
  const config = await settings(), session = await createSession(out);
  const response = await session.produce({ dir, step: '考題轉錄', model: config.transcribe,
    system: await fs.readFile(path.join(ROOT, 'arch/考題轉錄.md'), 'utf8'), content, saved,
    validate: text => { if (!/^## 第 \d+ 題/m.test(text)) throw new Error('考題轉錄缺少題號'); return { 文字: text }; } });
  await stable(path.join(dir, '考題轉錄.md'), response.parts.文字 + '\n');
  console.log(`考卷 ${names.length} 張已轉錄；預算累計 $${(await session.budget.total()).toFixed(6)}`);
}
