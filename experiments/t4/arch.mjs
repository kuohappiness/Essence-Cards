// 學習目標架構實驗入口；教材與所有結果只寫入 repo 外的 --out。
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROOT, exists, readJson, validateOut, writeJson, textPart, redact } from './core.mjs';
import { buildPrompt as screenPrompt, buildUser } from './screen.mjs';
import { hash, references } from './screen-analysis.mjs';
import { check } from './check-syntax.mjs';
import { parseDeck } from '../../src/core/deck/parse.ts';
import { createSession, splitSections } from './arch-request.mjs';

export async function settings(root = ROOT) { return readJson(path.join(root, 'arch/設定.json')); }
export async function buildStep(root, material, step) {
  return screenPrompt(root, { groups: { step: step.system.map(file => 'arch/' + file) } }, material, 'step');
}
export function stepUser(base, input, previous) {
  const added = input.map(key => textPart(`前一步的${key}：\n${previous[key] ?? ''}`));
  if (input.some(key => !previous[key]?.trim())) throw new Error('缺少流水線前一步的段落');
  return { content: [...base.content, ...added], saved: [...base.saved, ...added] };
}

export async function material(out, name) {
  const dir = path.join(out, '材料', name), text = await fs.readFile(path.join(dir, '教材.md'), 'utf8');
  const images = [];
  for (const image of references(text)) {
    if (image !== path.basename(image) || /[\\/:*?"<>|]/.test(image) || !image.endsWith('.png')) throw new Error('教材圖片名稱不安全');
    images.push({ name: image, sha256: hash(await fs.readFile(path.join(dir, '圖', image))) });
  }
  return { dir, text, images };
}
async function projection(file, text) {
  if (await exists(file)) {
    const old = await fs.readFile(file, 'utf8');
    if (old === text) return;
    const backup = path.join(path.dirname(file), '歷史', hash(old), path.basename(file));
    await fs.mkdir(path.dirname(backup), { recursive: true });
    if (!(await exists(backup))) await fs.writeFile(backup, old, { flag: 'wx' });
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
export function mechanical(text, transcript, unit, architecture = null) {
  const syntax = check(text, { transcript, unit }), deck = parseDeck(text);
  const product = { targets: deck.targets.length, questions: deck.targets.reduce((n, target) => n + target.prompts.length, 0) };
  const planned = architecture ? [...architecture.matchAll(/^\s*-\s+T\d+\s*｜\s*①\s*｜\s*(.+?)\s*$/gm)].map(m => m[1]) : [];
  const actual = deck.targets.map(t => t.name);
  return { syntax: syntax.stats, issues: syntax.issues, product, productProblems: deck.problems,
    countsAgree: product.targets === syntax.stats.targets && product.questions === syntax.stats.questions,
    names: architecture ? { missingInCards: planned.filter(n => !actual.includes(n)), missingInArchitecture: actual.filter(n => !planned.includes(n)) } : null };
}
export async function runArch({ out, run = 1 }, dependencies = {}) {
  if (!(await exists(path.join(out, '考題/凍結.md')))) throw new Error('尚未凍結：缺少 考題/凍結.md；不送任何生成請求');
  if (!Number.isSafeInteger(run) || run < 1) throw new Error('--run 必須是正整數');
  const root = dependencies.root ?? ROOT, config = dependencies.config ?? await settings(root);
  const session = dependencies.session ?? await createSession(out, dependencies);
  const rows = [];
  for (const [name, spec] of Object.entries(config.materials)) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('設定的材料名稱不安全');
    const source = await material(out, name), base = await buildUser(out, name, source);
    for (const [id, steps] of Object.entries(config.configs)) {
      if (!/^[A-Za-z0-9_-]+$/.test(name) || !/^S\d+$/.test(id)) throw new Error('設定的輸出名稱不安全');
      const dir = path.join(out, '生成', name, id, ...(run === 1 ? [] : [`第${run}次`]));
      let previous = {};
      for (const [index, step] of steps.entries()) {
        const prompt = await buildStep(root, spec, step), user = stepUser(base, step.input, previous);
        const response = await session.produce({ dir, step: `步驟${index + 1}`, model: config.models[step.model], system: prompt.system,
          ...user, validate: text => splitSections(text, step.output, id === 'S0') });
        if (id === 'S3' && index < 2) {
          await projection(path.join(dir, index === 0 ? '原架構.md' : '原稿.md'), response.parts[step.output[0]] + '\n');
        } else {
          for (const [section, value] of Object.entries(response.parts)) {
            const file = id === 'S3' && section !== '修改紀錄' ? { 架構: '修訂架構', 卡組: '修訂稿' }[section] : section;
            await projection(path.join(dir, `${file}.md`), value + '\n');
          }
        }
        previous = { ...previous, ...response.parts };
      }
      const versions = id === 'S3' ? [['原稿', '原架構'], ['修訂稿', '修訂架構']] : [['卡組', id === 'S0' ? null : '架構']];
      for (const [cards, arch] of versions) {
        const text = await fs.readFile(path.join(dir, cards + '.md'), 'utf8');
        const result = mechanical(text, source.text, name, arch ? await fs.readFile(path.join(dir, arch + '.md'), 'utf8') : null);
        await writeJson(path.join(dir, cards + '.統計.json'), result);
        await projection(path.join(dir, cards + '.檢查.md'), `# 機械檢查\n\n- check：${result.syntax.targets} 目標／${result.syntax.questions} 題\n- parseDeck：${result.product.targets} 目標／${result.product.questions} 題\n- 統計一致：${result.countsAgree}\n\n` + result.issues.map(i => `- 第 ${i.line} 行〔${i.level}/${i.code}〕${i.msg}`).join('\n') + '\n');
        rows.push({ material: name, setting: id, version: cards, run, ...result });
      }
    }
  }
  await writeJson(path.join(out, '生成', `機械統計-${run}.json`), rows);
  return rows;
}

// 只移除暴露組別的欄位，不重排或改寫題幹、答案與圖的位置。
export function blindCards(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/), result = [];
  let candidate = false;
  for (const line of lines) {
    if (/^\s{0,3}>\s*\[![^\]]+\][-+]?\s*候選卡片\s*$/.test(line)) { candidate = true; continue; }
    if (candidate && /^\s{0,3}>/.test(line)) continue;
    if (candidate && !line.trim()) continue;
    candidate = false;
    if (/^\s*[-*+]\s+(出處|類型|重要性)\s*[：:]/.test(line)) {
      const match = line.match(/^(\s*[-*+]\s+)(.*)$/);
      const kept = match[2].split('｜').filter(s => !/^\s*(類型|重要性)\s*[：:]/.test(s));
      if (kept.length) result.push(match[1] + kept.join('｜'));
    } else result.push(line);
  }
  return result.join('\n').trim() + '\n';
}
export async function makeBlind({ out, run = 1, materials }, dependencies = {}) {
  const config = dependencies.config ?? await settings(), random = dependencies.random ?? Math.random;
  const allMaterials = Object.keys(config.materials), requested = materials ?? allMaterials;
  if (!Array.isArray(requested) || !requested.length || new Set(requested).size !== requested.length || requested.some(name => !allMaterials.includes(name)))
    throw new Error('materials 必須指定非空、不重複且存在於設定的節名稱');
  // 依設定順序處理，命令列節名順序不影響既有盲評包的指紋。
  const selected = allMaterials.filter(name => requested.includes(name));
  const mappingFile = path.join(out, '紀錄', `盲評對照${run === 1 ? '' : '-' + run}.json`);
  const base = path.join(out, run === 1 ? '盲評' : `盲評-第${run}次`);
  const descriptors = [];
  for (const name of selected) {
    for (const [id, steps] of Object.entries(config.configs)) {
      const dir = path.join(out, '生成', name, id, ...(run === 1 ? [] : [`第${run}次`]));
      for (const file of id === 'S3' ? ['原稿', '修訂稿', '原架構', '修訂架構'] : id === 'S0' ? ['卡組'] : ['卡組', '架構']) {
        const text = await fs.readFile(path.join(dir, file + '.md'), 'utf8');
        descriptors.push({ name, id, file, kind: file.includes('架構') ? '架構' : '卡組', text, sha256: hash(text), dir });
      }
    }
  }
  const fingerprint = hash(JSON.stringify(descriptors.map(({ dir: _dir, text: _text, ...d }) => d)));
  if (await exists(mappingFile)) {
    const previous = await readJson(mappingFile);
    if (previous.fingerprint !== fingerprint) throw new Error('盲評來源有變，請另開 run，不覆蓋已評資料');
    return previous;
  }
  const entries = [], plans = [];
  for (const kind of ['卡組', '架構']) for (const name of selected) {
    const group = descriptors.filter(d => d.kind === kind && d.name === name);
    // Fisher-Yates；S3 的兩份用交換修正相鄰，沒有機率無限迴圈。
    for (let i = group.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [group[i], group[j]] = [group[j], group[i]]; }
    const pair = group.map((d, i) => d.id === 'S3' ? i : -1).filter(i => i >= 0);
    if (pair.length === 2 && pair[1] === pair[0] + 1) {
      const j = group.findIndex((d, i) => d.id !== 'S3' && Math.abs(i - pair[0]) > 1);
      [group[pair[1]], group[j]] = [group[j], group[pair[1]]];
    }
    for (const descriptor of group) {
      const index = entries.filter(e => e.kind === kind).length + 1;
      const code = `${kind === '卡組' ? 'K' : 'A'}${String(index).padStart(3, '0')}`;
      const text = kind === '卡組' ? blindCards(descriptor.text) : descriptor.text;
      if (/\bS[0-4]\b|gpt[- ]|claude[- ]|openrouter|\.mjs|短規則\.md|單次\.md|流水線-/i.test(text)) throw new Error('盲評內容殘留模型或設定線索');
      const file = path.join(base, kind, code + '.md');
      plans.push({ file, text, material: name });
      entries.push({ kind, material: name, code, setting: descriptor.id, version: descriptor.file });
    }
  }
  const images = new Map();
  for (const plan of plans) for (const image of references(plan.text)) {
    if (image !== path.basename(image) || /[\\/:*?"<>|]/.test(image)) throw new Error('盲評圖片名稱不安全');
    const bytes = await fs.readFile(path.join(out, '材料', plan.material, '圖', image));
    if (images.has(image) && hash(images.get(image)) !== hash(bytes)) throw new Error('不同教材有同名異圖');
    images.set(image, bytes);
  }
  const epoch = new Date('2000-01-01T00:00:00Z');
  async function blindFile(file, contents) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    if (await exists(file)) {
      if (hash(await fs.readFile(file)) !== hash(contents)) throw new Error('未完成的盲評包內容不同，拒絕覆蓋');
    } else await fs.writeFile(file, contents, { flag: 'wx' });
    await fs.utimes(file, epoch, epoch);
  }
  for (const plan of plans) await blindFile(plan.file, plan.text);
  for (const kind of ['卡組', '架構']) {
    const dir = path.join(base, kind), lines = ['# 評分順序', ''];
    for (const name of selected) lines.push(`## ${name}`, '', ...entries.filter(e => e.kind === kind && e.material === name).map(e => `- ${e.code}.md`), '');
    const readme = path.join(dir, 'README.md');
    await blindFile(readme, lines.join('\n'));
    if (images.size) await fs.mkdir(path.join(dir, '圖'), { recursive: true });
    for (const [image, bytes] of images) {
      const file = path.join(dir, '圖', image); await blindFile(file, bytes);
    }
  }
  const result = { fingerprint, entries };
  await writeJson(mappingFile, result);
  return result;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, pdf: { type: 'string' }, photos: { type: 'string' }, run: { type: 'string' }, materials: { type: 'string' }, configs: { type: 'string' }, round: { type: 'string' }, plan: { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  const [command] = positionals;
  if (values.help || !command) { console.log('node arch.mjs <transcribe|exams|run|blind> --out <repo外資料夾> [--pdf <PDF>] [--photos <照片資料夾>] [--run <N>]\nnode arch.mjs blind --out <repo外資料夾> [--materials 2-1,2-2] [--run <N>]\nnode arch.mjs run --round 2 --out <repo外資料夾> [--plan 接法驗證] [--materials 1-3] [--configs R0,R1,R2,R3,S0] [--dry-run]\nnode arch.mjs blind --round 2 --out <repo外資料夾>\nnode arch.mjs plan-login --out <repo外資料夾>\nnode arch.mjs selftest'); return; }
  if (command === 'selftest') { await (await import('./arch-selftest.mjs')).selftest(); await (await import('./arch-r2-selftest.mjs')).selftest(); return; }
  if (values.round === '2' || command === 'plan-login') {
    await (await import('./arch-r2-cli.mjs')).secondMain(command, values, positionals); return;
  }
  if (values.round !== undefined && values.round !== '1') throw new Error('--round 只能是 1 或 2');
  if (values.configs || values.plan || values['dry-run']) throw new Error('configs、plan、dry-run 只適用第二輪');
  if (positionals.length !== 1 || !['transcribe', 'exams', 'run', 'blind'].includes(command)) throw new Error('未知指令');
  if (values.materials !== undefined && command !== 'blind') throw new Error('--materials 只適用於 blind');
  const out = await validateOut(values.out), run = Number(values.run ?? 1);
  if (!Number.isSafeInteger(run) || run < 1) throw new Error('--run 必須是正整數');
  await fs.mkdir(out, { recursive: true });
  const lock = path.join(out, '.arch.lock');
  const handle = await fs.open(lock, 'wx').catch(() => { throw new Error('另一個 arch 指令正在執行，或上次中斷留下 .arch.lock；請先查核'); });
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, command, time: new Date().toISOString() }));
    if (command === 'run') await runArch({ out, run });
    if (command === 'blind') await makeBlind({ out, run, materials: values.materials?.split(',').map(name => name.trim()) });
    if (command === 'transcribe' || command === 'exams') {
      const module = await import('./arch-transcribe.mjs');
      await module[command]({ out, pdf: values.pdf, photos: values.photos });
    }
  } finally { await handle.close(); await fs.unlink(lock); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // 下層的模型輸出與 API 錯誤已遮罩；入口只列短錯誤，不列請求本文。
  console.error(redact(error.message)); process.exitCode = 1;
});
