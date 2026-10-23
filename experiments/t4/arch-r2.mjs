// 第二輪組提示與執行計畫；正式／預試使用不同目錄及請求快照。
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, exists, readJson, writeJson } from './core.mjs';
import { buildPrompt, buildUser } from './screen.mjs';
import { hash } from './screen-analysis.mjs';
import { material, mechanical, stepUser } from './arch.mjs';
import { createSecondSession } from './arch-r2-session.mjs';

export const secondSettings = (root = ROOT) => readJson(path.join(root, 'arch/第二輪/設定.json'));
export async function secondPrompt(root, spec, step) {
  const lines = [...spec.任務資料];
  for (const [key, value] of Object.entries(step.任務資料覆寫 ?? {})) {
    const matches = lines.map((line, i) => line.split(/[：:]/, 1)[0] === key ? i : -1).filter(i => i >= 0);
    if (matches.length !== 1) throw new Error('任務資料覆寫找不到唯一同名的行：' + key);
    lines[matches[0]] = `${key}：${value}`;
  }
  const prompt = await buildPrompt(root, { groups: { step: step.system.map(f => 'arch/第二輪/' + f) } }, { ...spec, 任務資料: lines }, 'step');
  for (const file of prompt.files) file.sha256 = hash(await fs.readFile(path.resolve(root, file.path)));
  return prompt;
}
function selection(values, allowed, label) {
  if (!Array.isArray(values) || !values.length || new Set(values).size !== values.length || values.some(v => !allowed.includes(v))) throw new Error(label + ' 必須非空、不重複且存在於設定');
  return allowed.filter(v => values.includes(v));
}
export async function prepareSecond({ out, run = 1, materials, configs, plan = '正式生成' }, dependencies = {}) {
  if (!Number.isSafeInteger(run) || run < 1) throw new Error('--run 必須是正整數');
  if (!(await exists(path.join(out, '考題/凍結.md'))) || !(await exists(path.join(out, '材料/凍結.md')))) throw new Error('缺少教材或考題凍結；不送任何生成請求');
  const root = dependencies.root ?? ROOT, config = dependencies.config ?? await secondSettings(root);
  if (!['正式生成', '接法驗證'].includes(plan)) throw new Error('未知的第二輪 plan');
  if (plan === '接法驗證' && (materials || configs)) throw new Error('接法驗證固定照設定，不接受 materials／configs 覆寫');
  const selectedMaterials = selection(materials ?? config[plan].materials, Object.keys(config.materials), 'materials');
  const selectedConfigs = selection(configs ?? config[plan].configs, Object.keys(config.configs), 'configs');
  const routes = ['R0', 'R1', 'R2', 'R3'].map(id => JSON.stringify(config.configs[id].map(s => config.models[s.model])));
  if (new Set(routes).size !== 1) throw new Error('R0～R3 必須使用同一模型、參數與接法');
  const jobs = [];
  for (const name of selectedMaterials) {
    if (!/^[\w-]+$/.test(name)) throw new Error('材料名稱不安全');
    const source = await material(out, name), user = await buildUser(out, name, source);
    for (const id of selectedConfigs) {
      if (!/^(R[0-3]|S0)$/.test(id)) throw new Error('未知第二輪組別');
      const steps = config.configs[id], prompts = [];
      for (const step of steps) prompts.push(await secondPrompt(root, config.materials[name], step));
      const dir = path.join(out, plan === '接法驗證' ? '接法驗證' : '生成', name, id, ...(run === 1 ? [] : [`第${run}次`]));
      jobs.push({ name, id, source, user, dir, steps, prompts });
    }
  }
  return { jobs, config, plan, run };
}
async function projection(file, text) {
  if (await exists(file)) {
    const old = await fs.readFile(file, 'utf8');
    if (old === text) return;
    const backup = path.join(path.dirname(file), '歷史', hash(old), path.basename(file));
    await fs.mkdir(path.dirname(backup), { recursive: true });
    if (!(await exists(backup))) await fs.writeFile(backup, old, { flag: 'wx' });
  }
  await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text);
}
export async function runSecond(options, dependencies = {}) {
  const prepared = await prepareSecond(options, dependencies), { config, plan, run, jobs } = prepared;
  const session = dependencies.session ?? await createSecondSession(options.out, dependencies), rows = [];
  async function execute(job, retryLength = false) {
    let previous = {}, response;
    for (const [i, step] of job.steps.entries()) {
      const prompt = job.prompts[i];
      response = await session.produce({ dir: job.dir, step: `步驟${i + 1}`, model: config.models[step.model], system: prompt.system,
        files: prompt.files, ...stepUser(job.user, step.input, previous), expected: step.output, plain: job.id === 'S0' }, { retryLength });
      if (!response.complete) return { material: job.name, setting: job.id, run, complete: false, category: response.category, metadata: response.metadata };
      for (const [section, value] of Object.entries(response.parts)) await projection(path.join(job.dir, section + '.md'), value + '\n');
      previous = { ...previous, ...response.parts };
    }
    const stats = mechanical(previous.卡組, job.source.text, job.name, previous.架構 ?? null);
    await writeJson(path.join(job.dir, '卡組.統計.json'), stats);
    await projection(path.join(job.dir, '卡組.檢查.md'), `# 機械檢查\n\n- check-syntax：${stats.syntax.targets} 目標／${stats.syntax.questions} 題\n- parseDeck：${stats.product.targets} 目標／${stats.product.questions} 題\n- 統計一致：${stats.countsAgree}\n\n` + stats.issues.map(i => `- 第 ${i.line} 行：${i.code} ${i.msg}`).join('\n') + '\n');
    return { material: job.name, setting: job.id, run, complete: true, fingerprint: response.fingerprint, reused: response.reused, metadata: response.metadata, ...stats };
  }
  const summaryFile = path.join(options.out, plan === '接法驗證' ? '接法驗證' : '生成', `機械統計-${run}.json`);
  const priorRows = await exists(summaryFile) ? await readJson(summaryFile) : [];
  async function saveSummary() {
    const merged = new Map(priorRows.map(r => [r.material + '/' + r.setting, r]));
    for (const row of rows) merged.set(row.material + '/' + row.setting, row);
    await writeJson(summaryFile, [...merged.values()]);
  }
  for (const job of jobs) {
    const row = await execute(job); rows.push(row); await saveSummary();
    if (!row.complete && (plan !== '接法驗證' || row.category !== 'length')) return rows;
  }
  const truncated = rows.map((r, i) => !r.complete && r.category === 'length' ? i : -1).filter(i => i >= 0);
  // 必須先看完兩份的停止原因；兩份都截斷時不白跑一次。
  if (plan === '接法驗證' && truncated.length === 1) {
    const index = truncated[0]; rows[index] = await execute(jobs[index], true); await saveSummary();
  }
  return rows;
}
