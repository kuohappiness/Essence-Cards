// 第二輪盲評：用產品 parseDeck 的正反面，不另判斷卡片語法。
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { parseDeck, readProperties } from '../../src/core/deck/parse.ts';
import { linesOf, listTree } from '../../src/core/deck/markdown.ts';
import { exists, readJson, writeJson } from './core.mjs';
import { hash, references } from './screen-analysis.mjs';
import { secondSettings } from './arch-r2.mjs';

function stripFields(text) {
  return text.split(/\r?\n/).map(line => {
    if (!/^\s*[-*+]\s+(出處|類型|重要性)\s*[：:]/.test(line)) return line;
    const prefix = line.match(/^\s*[-*+]\s+/)[0];
    const fields = line.slice(prefix.length).split('｜').filter(v => !/^\s*(類型|重要性)\s*[：:]/.test(v));
    return fields.length ? prefix + fields.join('｜') : '';
  }).join('\n');
}
const trace = text => text.replace(/(?<!!)\[\[([^\]]+)\]\]/g, (_, v) => v.includes('|') ? v.slice(v.lastIndexOf('|') + 1) : v.split('#').at(-1));
export function renderCards(text, { candidate = false } = {}) {
  const deck = parseDeck(text), lines = linesOf(text), { start } = readProperties(lines), roots = listTree(lines, start);
  const parents = [], candidates = [], quoted = new Set();
  for (let i = start; i < lines.length; i++) {
    if (!/^ {0,3}>\s*\[![^\]]+\]/.test(lines[i].raw)) continue;
    const isCandidate = /候選卡片/.test(lines[i].raw), body = [], lineNumbers = [];
    quoted.add(i);
    for (i++; i < lines.length && /^ {0,3}>/.test(lines[i].raw); i++) {
      quoted.add(i); lineNumbers.push(i); body.push(lines[i].raw.replace(/^ {0,3}> ?/, ''));
    }
    i--;
    if (isCandidate) candidates.push({ text: body.join('\n'), lineNumbers }); else parents.push(body.join('\n'));
  }
  const covered = new Set(quoted);
  for (const root of roots) if (deck.targets.some(t => t.line === root.line)) for (let i = root.line; i < root.end; i++) covered.add(i);
  const unknown = lines.flatMap((line, i) => i < start || covered.has(i) || !line.raw.trim() || /^ {0,3}#{1,6}(?:\s|$)/.test(line.raw) ? [] : [i + 1]);
  const problemLines = [...new Set([...deck.problems.map(p => p.line + 1), ...unknown])].sort((a, b) => a - b);
  if (problemLines.length) {
    const original = stripFields(lines.slice(start).map(l => l.raw).join('\n'));
    const fence = '`'.repeat(Math.max(3, ...[...original.matchAll(/`+/g)].map(m => m[0].length + 1)));
    return { text: `原文（未推測正反面；無法判斷或有 problems：第 ${problemLines.join('、')} 行）\n\n${fence}markdown\n${original}\n${fence}\n`, problemLines };
  }
  const output = [];
  if (parents.length) output.push('## 給家長的備註（不是卡）', '', ...parents.flatMap(p => [p, '']));
  for (const [i, target] of deck.targets.entries()) {
    output.push(`## 學習目標 ${i + 1}`, '', '追溯資訊（學生複習時看不到）', '', trace(target.name), '');
    if (target.fields.sources.length) output.push('出處：' + target.fields.sources.map(trace).join('、'), '');
    for (const [j, prompt] of target.prompts.entries()) {
      let front, back;
      if (prompt.kind === 'qa') { front = prompt.question; back = prompt.answer; }
      else {
        front = prompt.text; back = prompt.text;
        for (const blank of [...prompt.blanks].reverse()) {
          front = front.slice(0, blank.start) + '＿＿' + front.slice(blank.end);
          back = back.slice(0, blank.start) + back.slice(blank.start + 2, blank.end - 2) + back.slice(blank.end);
        }
      }
      output.push(`### 卡 ${j + 1}`, '', '**正面**', '', front, '', '**背面**', '',
        [back, ...prompt.extras, ...target.shared].filter(Boolean).join('\n\n'), '');
    }
  }
  if (!candidate && candidates.length) {
    output.push('## 候選（不是正式的卡）', '');
    for (const item of candidates) {
      const rendered = renderCards(item.text, { candidate: true });
      output.push(rendered.text, '');
      if (rendered.problemLines.length) output.push('原稿行號：' + rendered.problemLines.map(n => item.lineNumbers[n - 1] + 1).join('、'), '');
    }
  }
  return { text: output.join('\n').trim() + '\n', problemLines: [] };
}
const epoch = new Date('2000-01-01T00:00:00Z');
async function blindFile(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (await exists(file)) { if (hash(await fs.readFile(file)) !== hash(bytes)) throw new Error('盲評包已有不同內容，拒絕覆蓋'); }
  else await fs.writeFile(file, bytes, { flag: 'wx' });
  await fs.utimes(file, epoch, epoch);
}
export async function blindSecond({ out, run = 1, materials }, dependencies = {}) {
  const config = dependencies.config ?? await secondSettings(), requested = materials ?? config.正式生成.materials;
  if (!Number.isSafeInteger(run) || run < 1 || !Array.isArray(requested) || !requested.length || new Set(requested).size !== requested.length || requested.some(n => !config.materials[n])) throw new Error('無效的 run 或 materials');
  const selected = Object.keys(config.materials).filter(n => requested.includes(n));
  const source = [];
  for (const name of selected) for (const id of config.正式生成.configs) {
    if (!/^[\w-]+$/.test(name) || !/^(R[0-3]|S0)$/.test(id)) throw new Error('無效的盲評來源名稱');
    const dir = path.join(out, '生成', name, id, ...(run === 1 ? [] : [`第${run}次`]));
    const summary = await readJson(path.join(out, '生成', `機械統計-${run}.json`));
    const row = summary.find(r => r.material === name && r.setting === id && r.complete);
    if (!row) throw new Error('盲評來源未完成');
    const request = await readJson(path.join(dir, '請求/步驟1', row.fingerprint, '完成.json'));
    const raw = await fs.readFile(path.join(dir, '請求/步驟1', row.fingerprint, request.attempt, '原始回覆.md'), 'utf8');
    if (hash(raw) !== request.sha256) throw new Error('盲評原始回覆已被修改');
    const { splitSections } = await import('./arch-request.mjs');
    const parts = splitSections(raw, config.configs[id][0].output, id === 'S0');
    for (const kind of id === 'S0' ? ['卡組'] : ['卡組', '架構']) {
      const original = parts[kind];
      if ((await fs.readFile(path.join(dir, kind + '.md'), 'utf8')).trim() !== original.trim()) throw new Error('盲評投影與留存原稿不同');
      const text = kind === '架構' && id === 'R3' ? '# 全貌\n\n' + parts.全貌 + '\n\n' + original : original;
      source.push({ name, id, kind, text });
    }
  }
  const fingerprint = hash(JSON.stringify(source)), mappingFile = path.join(out, '紀錄', `盲評對照${run === 1 ? '' : '-' + run}.json`);
  const base = path.join(out, run === 1 ? '盲評' : `盲評-第${run}次`);
  let entries;
  if (await exists(mappingFile)) {
    const old = await readJson(mappingFile);
    if (old.fingerprint !== fingerprint) throw new Error('盲評來源有變，請另開 run');
    entries = old.entries;
  } else {
    entries = [];
    for (const kind of ['卡組', '架構']) {
      const group = source.filter(s => s.kind === kind);
      for (let i = group.length - 1; i > 0; i--) {
        const j = dependencies.randomInt ? dependencies.randomInt(i + 1) : randomInt(i + 1);
        [group[i], group[j]] = [group[j], group[i]];
      }
      // 各自的亂數代碼不從排序／組別推算；兩套無相互對應關係。
      const codes = new Set();
      for (const item of group) {
        let code;
        do { code = (kind === '卡組' ? 'K' : 'A') + String(randomInt(100, 1000000)); } while (codes.has(code));
        codes.add(code); entries.push({ kind, material: item.name, setting: item.id, code });
      }
    }
    // 先落盤亂序計畫；中斷後以相同代號恢復，對照永遠不放進盲評目錄。
    await writeJson(mappingFile, { fingerprint, entries });
  }
  const plans = [];
  const forbidden = /\b(?:R[0-3]|S0)\b|gpt[- ]|claude[- ]|openrouter|chatgpt|\.mjs|(?:格式|短規則|單次|五步|判斷邊界|完整規則|詳細規則-單次|common|science)\.md/i;
  for (const entry of entries) {
    const item = source.find(s => s.kind === entry.kind && s.name === entry.material && s.id === entry.setting);
    let text = item.kind === '卡組' ? renderCards(item.text).text : item.text.trim() + '\n';
    const imagePlans = [];
    for (const [i, image] of references(text).entries()) {
      if (image !== path.basename(image) || /[\\/:*?"<>|]/.test(image)) throw new Error('圖片名稱不安全');
      const bytes = await fs.readFile(path.join(out, '材料', item.name, '圖', image));
      const neutral = `${entry.code}-圖${String(i + 1).padStart(2, '0')}.png`;
      text = text.replaceAll(image, neutral); imagePlans.push({ file: path.join(base, entry.kind, '圖', neutral), bytes });
    }
    // 除圖片外的連結、來源洩漏不猜著修改；停下來讓人查留存原稿。
    if (forbidden.test(text) || /(?<!!)\[\[|(?<!!)\[[^\]]+\]\(|https?:\/\//.test(text)) throw new Error('盲評殘留來源線索或連結；拒絕輸出');
    plans.push(...imagePlans, { file: path.join(base, entry.kind, entry.code + '.md'), bytes: text });
  }
  for (const kind of ['卡組', '架構']) plans.push({ file: path.join(base, kind, 'README.md'), bytes: '# 評分順序\n\n' + entries.filter(e => e.kind === kind).map(e => '- ' + e.code + '.md').join('\n') + '\n' });
  for (const item of plans) await blindFile(item.file, item.bytes);
  await writeJson(path.join(out, '紀錄', `盲評包完成${run === 1 ? '' : '-' + run}.json`), { fingerprint, files: plans.map(p => ({ file: path.relative(base, p.file), sha256: hash(p.bytes) })) });
  return { fingerprint, entries };
}
