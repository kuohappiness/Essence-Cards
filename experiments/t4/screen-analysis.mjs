import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomInt } from 'node:crypto';
import { exists, writeJson } from './core.mjs';
import { check } from './check-syntax.mjs';

export const normalize = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
export const readText = async file => normalize(await fs.readFile(file, 'utf8'));
export const readJSON = async file => JSON.parse(await readText(file));
export const hash = value => createHash('sha256').update(value).digest('hex');
export const references = text => [...new Set([...text.matchAll(/!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)].map(m => m[1].trim()))];
const plain = text => String(text ?? '').replaceAll('**', '').replace(/\s*\^[a-zA-Z0-9-]+\s*$/, '');
const cell = text => plain(text).replaceAll('|', '\\|').replace(/\r?\n/g, ' ／ ');
const noImages = text => plain(text).replace(/!\[\[[^\]\n]+\]\]/g, '').trim().replace(/\n/g, ' ／ ');
const table = (headers, rows) => ['| ' + headers.join(' | ') + ' |', '|' + headers.map(() => '---').join('|') + '|', ...rows.map(r => '| ' + r.map(cell).join(' | ') + ' |')].join('\n');
const FORMAT = new Set(['yaml', 'para', 'code', 'callout-unknown', 'callout-prefix', 'top-question', 'target-name', 'no-question', 'no-source', 'source-empty', 'source-unknown', 'source-unresolved', 'double-colon', 'colon-space']);
export const CATEGORIES = ['格式錯誤', '用語', '不計', '規則類', '提醒'];

export function category(issue) {
  if (issue.level === '提醒') return '提醒';
  if (issue.level === '錯誤' || FORMAT.has(issue.code)) return '格式錯誤';
  if (['simplified', 'mainland-term'].includes(issue.code)) return '用語';
  if (issue.code === 'too-many-targets') return '不計';
  return '規則類';
}

export async function inspect(stem, text, transcript, options, reply, price) {
  const result = check(normalize(text), { ...options, transcript: normalize(transcript) });
  const classified = Object.fromEntries(CATEGORIES.map(c => [c, result.issues.filter(i => category(i) === c)]));
  const usage = reply.usage ?? {};
  const cost = price && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)
    ? (usage.prompt_tokens * price.input + usage.completion_tokens * price.output) / 1e6 : null;
  const byCode = issues => Object.fromEntries([...new Set(issues.map(i => i.code))].map(code => [code, issues.filter(i => i.code === code).length]));
  const stats = { ...result.stats,
    // check() 的 images 不含共用補充及深層子項目，這裡計本文目標內實際附圖次數。
    images: result.targets.reduce((n, t) => n + [...JSON.stringify([t.questions.map(q => [q.raw, q.supplements]), t.shared]).matchAll(/!\[\[/g)].length, 0),
    categories: Object.fromEntries(CATEGORIES.map(c => [c, classified[c].length])),
    // 格式錯誤也依代碼分：例如 colon-space 程式照樣讀得懂，報告要看得出來。
    formatCodes: byCode(classified['格式錯誤']),
    ruleCodes: byCode(classified['規則類']),
    noteNames: result.notes, candidateNames: result.candidates.map(t => t.name),
    usage, seconds: reply.seconds, costUsd: cost };
  await writeJson(stem + '.統計.json', stats);
  const lines = [`# 語法檢查：${path.basename(stem)}.md`, '',
    `- 學習目標 ${stats.targets}｜題目 ${stats.questions}｜附圖 ${stats.images}｜候選卡片 ${stats.candidates}｜給家長的備註 ${stats.notes} 項｜加進已有 ${stats.existing}`];
  for (const c of CATEGORIES) lines.push('', `## ${c}（${classified[c].length}）`, ...classified[c].map(i => `- 第 ${i.line} 行〔${i.code}〕${i.msg}`));
  await fs.writeFile(stem + '.檢查.md', lines.join('\n') + '\n');
  return stats;
}

export async function outputs(out, config) {
  const found = [];
  for (const material of Object.keys(config.materials)) {
    const dir = path.join(out, '生成', material);
    if (!(await exists(dir))) continue;
    for (const file of (await fs.readdir(dir)).sort()) for (const group of Object.keys(config.groups)) {
      if (!file.startsWith(group + '-')) continue;
      const suffix = file.slice(group.length + 1).match(/^([1-9]\d*)\.md$/);
      if (suffix) found.push({ material, group, run: Number(suffix[1]), file: `生成/${material}/${file}` });
    }
  }
  return found.sort((a, b) => Object.keys(config.materials).indexOf(a.material) - Object.keys(config.materials).indexOf(b.material) || a.run - b.run || Object.keys(config.groups).indexOf(a.group) - Object.keys(config.groups).indexOf(b.group));
}

export async function mechanicalTable(out, config) {
  const rows = [];
  for (const entry of await outputs(out, config)) {
    const stats = await readJSON(path.join(out, entry.file.replace(/\.md$/, '.統計.json')));
    rows.push([entry.material, entry.group, entry.run, stats.targets, stats.questions, stats.images, stats.candidates, stats.notes, stats.existing,
      ...CATEGORIES.map(c => stats.categories[c]), stats.usage.prompt_tokens ?? '—', stats.usage.completion_tokens ?? '—', stats.seconds, stats.costUsd?.toFixed(6) ?? '—']);
  }
  await fs.mkdir(path.join(out, '生成'), { recursive: true });
  await fs.writeFile(path.join(out, '生成/機械統計.md'), '# 機械統計\n\n' + table(['材料', '組別', '次', '目標', '題目', '附圖', '候選', '備註', '加進已有', ...CATEGORIES, '輸入 token', '輸出 token', '秒', '估計美元'], rows) + '\n\n費用依 models.json 標價估算；不能當成實際帳單。\n');
}

// 只讀指定標題下的第一張 Markdown 表；保留來源行號供 report 回報。
export function firstTable(text, heading) {
  const lines = normalize(text).split('\n');
  const start = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (start < 0) return null;
  const endIndex = lines.findIndex((line, i) => i > start && /^#{1,2}\s/.test(line));
  const end = endIndex < 0 ? lines.length : endIndex;
  const begin = lines.findIndex((line, i) => i > start && i < end && /^\s*\|/.test(line));
  if (begin < 0) return null;
  const split = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(s => s.trim().replaceAll('\\|', '|'));
  const headers = split(lines[begin]);
  if (!lines[begin + 1] || !split(lines[begin + 1]).every(s => /^:?-{3,}:?$/.test(s))) return null;
  const rows = [];
  for (let i = begin + 2; i < end && /^\s*\|/.test(lines[i]); i++) rows.push({ line: i + 1, cells: split(lines[i]) });
  return { headers, rows };
}

export async function abilities(out, material) {
  const file = path.join(out, '能力清單', material + '.md');
  if (!(await exists(file))) throw new Error(`${material}：先寫能力清單`);
  const parsed = firstTable(await readText(file), '必須涵蓋的能力');
  const idCol = parsed?.headers.indexOf('代號'), nameCol = parsed?.headers.indexOf('能力');
  if (!parsed?.rows.length || idCol < 0 || nameCol < 0) throw new Error(`${material}：能力清單表格讀不到，先寫能力清單`);
  const result = parsed.rows.map(r => ({ id: r.cells[idCol], name: r.cells[nameCol] }));
  if (result.some(r => !/^\S+$/.test(r.id ?? '') || !r.name) || new Set(result.map(r => r.id)).size !== result.length)
    throw new Error(`${material}：能力清單代號無效或重複`);
  return result;
}

function flatten(nodes) {
  return nodes.flatMap(node => [node.text, ...node.cont.map(c => c.text), ...flatten(node.children)]);
}

export function blindText(code, material, text, transcript, options) {
  const result = check(normalize(text), { ...options, transcript: normalize(transcript) });
  const lines = [`# ${code}`, '', `材料：${material}｜學習目標 ${result.targets.length} 個（給家長的備註與候選卡片不列）`];
  let heading;
  result.targets.forEach((t, index) => {
    if (t.heading !== heading || index === 0) { heading = t.heading; lines.push('', `## ${plain(heading ?? '（沒有小標題）')}`); }
    const end = result.targets[index + 1]?.line ?? normalize(text).split('\n').length + 1;
    // 範圍截止到下一個頂層區塊，避免把後面的候選或已有目標算進來。
    const after = normalize(text).split('\n').findIndex((line, i) => i + 1 > t.line && /^(?:#{1,6}\s|>\s?\[!|[-*+]\s)/.test(line));
    const stop = Math.min(end, after < 0 ? end : after + 1);
    const errors = [...new Set(result.issues.filter(i => i.level === '錯誤' && i.line >= t.line && i.line < stop).map(i => i.code))];
    lines.push('', `### 目標 ${index + 1}：${plain(t.name)}${errors.length ? `（程式會跳過：${errors.join('、')}）` : ''}`, `- 出處：${plain(t.data['出處'] || '（沒寫）')}`);
    t.questions.forEach((q, i) => {
      lines.push(`- 題 ${i + 1}：${noImages(q.front)}`, `    - 答案：${noImages(q.back)}`);
      for (const name of references(q.front)) lines.push(`    - 題目附圖：${name}`);
      for (const name of references(q.back)) lines.push(`    - 答案附圖：${name}`);
      for (const item of flatten(q.supplements)) {
        for (const name of references(item)) lines.push(`    - 背面附圖：${name}`);
        if (noImages(item)) lines.push(`    - 背面補充：${noImages(item)}`);
      }
    });
    for (const item of flatten(t.shared)) {
      if (noImages(item)) lines.push(`- 共用補充：${noImages(item)}`);
      if (references(item).length) lines.push('- 共用補充：', ...references(item).map(name => `    - 背面附圖：${name}`));
    }
  });
  if (!result.targets.length) {
    const raw = plain(normalize(text));
    const fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(m => m[0].length + 1)));
    lines.push('', '程式讀不出學習目標', '', fence, raw, fence);
  }
  return { text: lines.join('\n') + '\n', targets: result.targets };
}

export function scoreTemplate(code, material, skills, targets) {
  return `# 評分：${code}\n\n- 材料：${material}\n- 評分者：\n- 評分日期：\n\n## 能力覆蓋\n\n` +
    table(['能力', '涵蓋', '對到的目標', '說明'], skills.map(s => [`${s.id} ${s.name}`, '待填', '待填', ''])) +
    '\n\n## 逐個目標\n\n' + table(['目標', '正確', '洩漏', '同一能力', '多餘或重複', '處置', '問題與教材依據'], targets.map((t, i) => [`${i + 1} ${t.name}`, ...Array(5).fill('待填'), ''])) +
    '\n\n## 整體\n\n（選填，一兩句）\n';
}

function shuffled(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newCode(used) {
  if (used.size >= ALPHABET.length ** 3) throw new Error('代號已用完');
  let code;
  do { code = Array.from({ length: 3 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (used.has(code));
  used.add(code); return code;
}

export async function blind(out, config, print = console.log) {
  const entries = await outputs(out, config), skills = {}, plans = [];
  for (const material of new Set(entries.map(e => e.material))) skills[material] = await abilities(out, material);
  const mappingFile = path.join(out, '生成/組別對照.json');
  const mapping = await exists(mappingFile) ? await readJSON(mappingFile) : [];
  if (!Array.isArray(mapping) || mapping.some(e => !/^[A-HJ-NP-Z]{3}$/.test(e.code)) || new Set(mapping.map(e => e.code)).size !== mapping.length || new Set(mapping.map(e => e.file)).size !== mapping.length)
    throw new Error('既有組別對照無效');
  const used = new Set(mapping.map(e => e.code));
  for (const entry of entries) {
    let matched = mapping.find(e => e.file === entry.file);
    if (matched && ['material', 'group', 'run'].some(k => matched[k] !== entry[k])) throw new Error('既有組別對照與輸出不一致');
    if (!matched) { matched = { code: newCode(used), ...entry }; mapping.push(matched); }
    const source = await readText(path.join(out, '材料', entry.material, '教材.md'));
    const normalized = blindText(matched.code, entry.material, await readText(path.join(out, entry.file)), source, config.materials[entry.material].checkSyntax);
    const template = scoreTemplate(matched.code, entry.material, skills[entry.material], normalized.targets);
    const scoreFile = path.join(out, '盲評/評分', matched.code + '.md');
    const score = await exists(scoreFile) ? await readText(scoreFile) : template;
    plans.push({ entry: matched, normalized, template, scoreFile, score });
  }
  const forbidden = [...Object.keys(config.groups), config.model.model, 'token', '費用'];
  const safe = text => !forbidden.some(word => text.toLowerCase().includes(word.toLowerCase())) && !/第\s*\d+\s*次/.test(text);
  const readme = ['# 盲評', '', '只讀這裡的清單與評分表，依下列順序逐份對照教材及能力清單評分。', '',
    '- 材料：[材料/](../材料/)', '- 能力清單：[能力清單/](../能力清單/)',
    '- 評分方式見 repo 的 `tasks/ai-quality-screen.md` 的〈評分〉一節。'];
  for (const material of new Set(entries.map(e => e.material))) {
    readme.push('', `## ${material}`, '');
    for (const p of shuffled(plans.filter(p => p.entry.material === material))) {
      const evaluated = validateScore(p.score, skills[material], p.normalized.targets.length).status === 'ok';
      readme.push(`- [${p.entry.code}](${p.entry.code}.md)｜${evaluated ? '已評' : '待評'}｜[評分](評分/${p.entry.code}.md)`);
    }
  }
  for (const p of plans) if (![p.normalized.text, p.template, p.score].every(safe)) throw new Error('盲評內容有可能透露條件，停止寫入');
  if (!safe(readme.join('\n'))) throw new Error('盲評說明有可能透露條件');
  await fs.mkdir(path.join(out, '盲評/評分'), { recursive: true });
  await writeJson(mappingFile, mapping);
  // plans 照組別排序；寫入順序打亂，最後把修改時間設成同一個，評分者依時間列檔案也看不出組別。
  for (const p of shuffled(plans)) {
    await fs.writeFile(path.join(out, '盲評', p.entry.code + '.md'), p.normalized.text);
    if (!(await exists(p.scoreFile))) await fs.writeFile(p.scoreFile, p.template, { flag: 'wx' });
  }
  await fs.writeFile(path.join(out, '盲評/README.md'), readme.join('\n') + '\n');
  const stamp = new Date();
  for (const file of [path.join(out, '盲評/README.md'), ...plans.flatMap(p => [path.join(out, '盲評', p.entry.code + '.md'), p.scoreFile])])
    await fs.utimes(file, stamp, stamp);
  print(`盲評完成：${plans.length} 份；評分表已保留`);
  return plans.length;
}

export function validateScore(text, skills, targetCount) {
  const coverage = firstTable(text, '能力覆蓋'), targets = firstTable(text, '逐個目標');
  const errors = [], disputes = [];
  const need = (value, allowed) => allowed.includes(value);
  const issue = (row, reason) => errors.push({ line: row?.line ?? 1, reason });
  const expectedC = ['能力', '涵蓋', '對到的目標', '說明'];
  const expectedT = ['目標', '正確', '洩漏', '同一能力', '多餘或重複', '處置', '問題與教材依據'];
  const validTable = (parsed, headers) => parsed && JSON.stringify(parsed.headers) === JSON.stringify(headers);
  if (!validTable(coverage, expectedC) || !validTable(targets, expectedT)) return { status: 'invalid', errors: [{ line: 1, reason: '評分表標題或欄位無效' }], disputes };
  const pending = [...coverage.rows, ...targets.rows].some(r => r.cells.some(v => v.includes('待填')));
  const seenC = new Set(), seenT = new Set(), cRows = [], tRows = [];
  for (const r of coverage.rows) {
    if (r.cells.length !== 4) { issue(r, '能力欄數錯誤'); continue; }
    const [label, covered, linked, reason] = r.cells, id = label.match(/^(\S+)(?:\s|$)/)?.[1];
    if (!skills.some(s => s.id === id) || seenC.has(id)) issue(r, '能力代號未知或重複');
    seenC.add(id);
    if (!need(covered, ['完整', '部分', '沒有', '待填'])) issue(r, '涵蓋值無效');
    const numbers = linked === '—' ? [] : linked.split('、').map(Number);
    if (linked !== '待填' && (numbers.some(n => !Number.isInteger(n) || n < 1 || n > targetCount) || new Set(numbers).size !== numbers.length || (!numbers.length && covered !== '沒有') || (numbers.length && covered === '沒有')))
      issue(r, '對到的目標無效或與涵蓋矛盾');
    cRows.push({ id, covered, linked });
    if (reason.startsWith('爭議：')) disputes.push({ target: id, text: reason });
  }
  if (seenC.size !== skills.length) issue(null, '能力列有缺漏');
  for (const r of targets.rows) {
    if (r.cells.length !== 7) { issue(r, '目標欄數錯誤'); continue; }
    const [label, correct, leak, same, extra, action, reason] = r.cells;
    const id = Number(label.match(/^(\d+)(?:\s|$)/)?.[1]);
    if (!Number.isInteger(id) || id < 1 || id > targetCount || seenT.has(id)) issue(r, '目標編號未知或重複');
    seenT.add(id);
    if (!need(correct, ['是', '否', '待填'])) issue(r, '正確值無效');
    if (!need(same, ['是', '否', '待填'])) issue(r, '同一能力值無效');
    if (!need(action, ['保留', '小改', '大改', '刪除', '待填'])) issue(r, '處置值無效');
    if (!need(leak, ['否', '待填']) && !/^題\s*[1-9]\d*(?:、\s*題\s*[1-9]\d*)*$/.test(leak)) issue(r, '洩漏值無效');
    const repeat = extra.match(/^重複 ([1-9]\d*)$/);
    if (!need(extra, ['否', '多餘', '待填']) && (!repeat || Number(repeat[1]) >= id || Number(repeat[1]) > targetCount)) issue(r, '多餘或重複值無效');
    if ([correct === '否', leak !== '否' && leak !== '待填', same === '否', extra !== '否' && extra !== '待填', action !== '保留' && action !== '待填'].some(Boolean) && !reason) issue(r, '問題與教材依據必填');
    tRows.push({ id, correct, leak, same, extra, action });
    if (reason.startsWith('爭議：')) disputes.push({ target: id, text: reason });
  }
  if (seenT.size !== targetCount) issue(null, '目標列有缺漏');
  // 整體欄的爭議也交給使用者；不是機械分數。
  for (const line of text.split('\n')) if (line.trim().startsWith('爭議：')) disputes.push({ target: '整體', text: line.trim() });
  return { status: errors.length ? 'invalid' : pending ? 'pending' : 'ok', errors, disputes, coverage: cRows, targets: tRows };
}

export function metrics(stats, score) {
  const count = predicate => score.targets.filter(predicate).length;
  const keep = count(t => t.action === '保留'), small = count(t => t.action === '小改');
  return [stats.targets, stats.categories['格式錯誤'], ...['完整', '部分', '沒有'].map(v => score.coverage.filter(c => c.covered === v).length),
    count(t => t.correct === '否'), count(t => t.leak !== '否'), score.targets.reduce((n, t) => n + (t.leak.match(/題\s*\d+/g)?.length ?? 0), 0),
    count(t => t.same === '否'), count(t => t.extra === '多餘'), count(t => t.extra.startsWith('重複 ')),
    keep, small, count(t => t.action === '大改'), count(t => t.action === '刪除'), score.targets.length - keep, keep + small];
}

export async function report(out, config, print = console.log) {
  const mapping = await readJSON(path.join(out, '生成/組別對照.json'));
  const lines = ['# AI 品質初篩報告', '', '此初篩不能證明產品優於其他工具，也不能證明學業成效。費用是標價估計。'], problems = [], disputes = [], appendix = [], evaluated = [];
  const headers = ['組別', '次', '目標', '格式錯誤', '完整', '部分', '沒有', '內容有錯', '洩漏目標', '洩漏題數', '一池不同能力', '多餘', '重複', '保留', '小改', '大改', '刪除', '要刪改', '可用'];
  for (const entry of mapping) {
    const stats = await readJSON(path.join(out, entry.file.replace(/\.md$/, '.統計.json')));
    const scoreFile = path.join(out, '盲評/評分', entry.code + '.md');
    const skills = await abilities(out, entry.material);
    const score = await exists(scoreFile) ? validateScore(await readText(scoreFile), skills, stats.targets) : { status: 'pending', disputes: [], errors: [] };
    if (score.status !== 'ok') problems.push(`- ${entry.code}.md：${score.status === 'pending' ? '未評分（待填或缺檔）' : '值不合規定'}${score.errors.map(e => `；第 ${e.line} 行 ${e.reason}`).join('')}`);
    for (const d of score.disputes) disputes.push(`- ${entry.code}｜目標 ${d.target}｜${d.text}`);
    if (score.status === 'ok') evaluated.push({ ...entry, stats, score, values: metrics(stats, score) });
    appendix.push(`### ${entry.material}／${entry.group}／${entry.run}`, '',
      `- 給家長的備註（${stats.notes}）：${stats.noteNames.join(' ／ ') || '—'}`,
      `- 候選卡片（${stats.candidates}）：${stats.candidateNames.join(' ／ ') || '—'}`,
      `- 格式錯誤：${Object.entries(stats.formatCodes ?? {}).map(([code, n]) => `${code} ${n}`).join('、') || '0'}`,
      `- 規則類不符：${Object.entries(stats.ruleCodes).map(([code, n]) => `${code} ${n}`).join('、') || '0'}`,
      `- 用語 ${stats.categories['用語']}｜提醒 ${stats.categories['提醒']}｜輸入 token ${stats.usage.prompt_tokens ?? '—'}｜輸出 token ${stats.usage.completion_tokens ?? '—'}｜秒 ${stats.seconds ?? '—'}｜估計美元 ${stats.costUsd?.toFixed(6) ?? '—'}`, '');
  }
  for (const material of Object.keys(config.materials)) {
    const entries = evaluated.filter(e => e.material === material).sort((a, b) => a.run - b.run || Object.keys(config.groups).indexOf(a.group) - Object.keys(config.groups).indexOf(b.group));
    lines.push('', `## ${material}`, '', table(headers, entries.map(e => [e.group, e.run, ...e.values])));
    const pairedRuns = [...new Set(entries.map(e => e.run))].filter(run => Object.keys(config.groups).every(g => entries.some(e => e.run === run && e.group === g)));
    if (pairedRuns.length) {
      const averages = Object.keys(config.groups).map(group => {
        const selected = entries.filter(e => e.group === group && pairedRuns.includes(e.run));
        return selected[0].values.map((_, i) => selected.reduce((sum, e) => sum + e.values[i], 0) / selected.length);
      });
      lines.push('', `每格只有 ${pairedRuns.length} 次成對評分，只當參考；不做顯著性檢定。`, '',
        table(['平均／差', ...headers.slice(2)], [...Object.keys(config.groups).map((g, i) => [g, ...averages[i]]), ['完整減精簡', ...averages[1].map((v, i) => v - averages[0][i])]]));
    }
    const skills = await abilities(out, material);
    lines.push('', '### 能力覆蓋明細', '', table(['能力', ...entries.map(e => `${e.group}／${e.run}`)], skills.map(s => [`${s.id} ${s.name}`, ...entries.map(e => e.score.coverage.find(c => c.id === s.id)?.covered ?? '—')])));
  }
  lines.push('', '## 交給使用者判斷', '', ...(disputes.length ? disputes : ['無。']), '', '## 評分表的問題', '', ...(problems.length ? problems : ['無。']), '', '## 附錄（程式算的）', '', ...appendix,
    '## 限制', '', '評分的 Claude 和寫規則的是同一方，可能偏好照規則寫的樣子；拿掉格式標記後文字風格仍可能透露條件；第二段材料是 Claude 自寫的；每格只有一兩次。', '');
  await fs.writeFile(path.join(out, '初篩報告.md'), lines.join('\n'));
  print(`初篩報告.md：已評 ${evaluated.length}，未納入 ${problems.length}`);
  return { evaluated, problems, disputes };
}
