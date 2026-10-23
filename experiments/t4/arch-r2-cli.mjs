import fs from 'node:fs/promises';
import path from 'node:path';
import { validateOut } from './core.mjs';
import { prepareSecond, runSecond } from './arch-r2.mjs';
import { blindSecond } from './arch-r2-blind.mjs';
import { loginPlan } from './arch-plan.mjs';
import { estimateRequest } from './arch-request.mjs';

export async function secondMain(command, values, positionals) {
  if (positionals.length !== 1 || !['run', 'blind', 'plan-login'].includes(command)) throw new Error('第二輪只接受 run、blind 或 plan-login');
  if (values.pdf || values.photos || (command !== 'run' && (values.configs || values.plan || values['dry-run']))) throw new Error('這些選項只適用第二輪 run');
  const out = await validateOut(values.out), run = Number(values.run ?? 1);
  const list = value => value === undefined ? undefined : value.split(',').map(v => v.trim());
  const options = { out, run, materials: list(values.materials), configs: list(values.configs), plan: values.plan };
  if (values['dry-run']) {
    const { jobs, config } = await prepareSecond(options);
    const summary = jobs.map(j => ({ material: j.name, setting: j.id, images: j.source.images.length, steps: j.prompts.map((p, i) => ({
      files: p.files, model: config.models[j.steps[i].model],
      estimate: config.models[j.steps[i].model].provider === 'openai' ? estimateRequest(config.models[j.steps[i].model], p.system, j.user.saved) : null,
    })) }));
    console.log(JSON.stringify({ dryRun: true, requestsSent: 0, jobs: summary }, null, 2)); return;
  }
  await fs.mkdir(out, { recursive: true });
  const lock = path.join(out, '.arch.lock'), handle = await fs.open(lock, 'wx').catch(() => { throw new Error('另一個 arch 指令執行中，或中斷留下鎖；請先查核'); });
  try {
    if (command === 'plan-login') {
      try { return await loginPlan(out); }
      catch (error) { throw new Error('登入未完成：' + (error.safeCode ?? '請檢查本機檔案、網路與授權')); }
    }
    if (command === 'blind') { const result = await blindSecond(options); console.log(`第二輪盲評包：${result.entries.length} 份`); return; }
    const rows = await runSecond(options);
    console.log(JSON.stringify(rows.map(r => ({ material: r.material, setting: r.setting, complete: r.complete, category: r.category ?? 'complete', metadata: r.metadata, product: r.product, names: r.names })), null, 2));
    if (rows.some(r => !r.complete)) process.exitCode = 2;
  } finally { await handle.close(); await fs.unlink(lock); }
}
