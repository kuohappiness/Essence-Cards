import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateOut } from './core.mjs';
import { check } from './check-syntax.mjs';
import { ApiClient } from './api.mjs';
import { Budget, splitSections, createSession } from './arch-request.mjs';
import { runArch, makeBlind, buildStep, stepUser, blindCards, mechanical, settings } from './arch.mjs';
import { ROOT, writeJson } from './core.mjs';

export async function selftest() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'essence-arch-'));
  try {
    const repo = path.join(temp, 'repo'), other = path.join(temp, 'other');
    await fs.mkdir(repo);
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
    git('init', '-q');
    git('-c', 'user.name=Selftest', '-c', 'user.email=selftest@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture');
    git('worktree', 'add', '-q', '-b', 'fixture', other);
    await assert.rejects(validateOut(path.join(other, 'private'), { repo }), /worktree|repo/);
    assert.equal(await validateOut(path.join(temp, 'private'), { repo }), path.join(await fs.realpath(temp), 'private'));
    const classified = check('- 能辨認\n    - 出處：==位置==\n    - 問題 :: 答案\n');
    assert.equal(classified.stats.questions, 1, 'W2 先辨認資料欄位，再辨認題目');
    const many = Array.from({ length: 8 }, (_, i) => `- 能說出知識${i}\n    - 出處：p.1\n    - 問題${i} :: 答案`).join('\n');
    assert.ok(!check(many, { transcript: 'p.1 ^p1' }).issues.some(i => i.code === 'too-many-targets'));
    let sent;
    const api = new ApiClient({ providers: { fake: { baseUrl: 'https://example.invalid', minSecondsBetweenCalls: 0 } } }, { fake: 'test-only-key' }, temp,
      { print: () => {}, fetch: async (_url, options) => { sent = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: '完成' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } })); } });
    await api.request('test', { provider: 'fake', model: 'fake', parameters: { reasoning_effort: 'xhigh', max_completion_tokens: 50 } }, '', []);
    assert.equal(sent.reasoning_effort, 'xhigh');
    const marked = '<<<架構>>>\n計畫\n<<<卡組>>>\n題組\n<<<修改紀錄>>>\n不修改';
    assert.deepEqual(splitSections(marked, ['架構', '卡組', '修改紀錄']), { 架構: '計畫', 卡組: '題組', 修改紀錄: '不修改' });
    assert.throws(() => splitSections('<<<架構>>>\n計畫', ['架構', '卡組']), /缺少/);
    assert.throws(() => splitSections('<<<卡組>>>\n一\n<<<卡組>>>\n二', ['卡組']), /重複/);
    assert.deepEqual(splitSections('## 節\n- 能說出', ['卡組'], true), { 卡組: '## 節\n- 能說出' });
    await assert.rejects(runArch({ out: temp }), /尚未凍結/);
    const budget = new Budget(path.join(temp, 'budget'), 1);
    await assert.rejects(budget.reserve(1.1, 'over'), /預算不足/);
    await budget.reserve(0.7, 'first');
    await assert.rejects(budget.reserve(0.4, 'second'), /預算不足/);
    await budget.settle({ costUsd: 0.1, outcome: 'ok' });
    assert.equal(await budget.total(), 0.1);
    const config = await settings();
    for (const [name, spec] of Object.entries(config.materials)) for (const steps of Object.values(config.configs)) for (const step of steps) {
      const prompt = await buildStep(ROOT, spec, step);
      const expected = (await Promise.all(step.system.map(file => fs.readFile(path.resolve(ROOT, 'arch', file), 'utf8'))))
        .map(raw => raw.replace(/\r\n/g, '\n').replaceAll('{{任務資料}}', spec['任務資料'].join('\n')).trimEnd()).join('\n\n');
      assert.equal(prompt.system, expected, name);
      assert.ok(!prompt.system.includes('{{任務資料}}'));
      const user = stepUser({ content: [], saved: [] }, step.input, { 架構: '計畫', 卡組: '題組' });
      for (const key of step.input) assert.ok(user.saved.some(p => p.text.includes(`前一步的${key}：`)));
    }
    const sample = '## 基礎\n\n- 能說出基礎\n    - 出處：p.1｜類型：定義｜重要性：高\n    - 看 ![[測試.png]] 說出 :: **基礎**\n        - ![[測試.png]]\n    - 基礎是==知識==\n';
    const plan = '## 學習目標\n- T01｜①｜能說出基礎\n    - 判準：能說出基礎\n';
    const checked = mechanical(sample, '![[測試.png]]\np.1 ^p1', '2-1', plan);
    assert.equal(checked.countsAgree, true);
    assert.deepEqual(checked.product, { targets: 1, questions: 2 });
    assert.deepEqual(checked.names, { missingInCards: [], missingInArchitecture: [] });
    assert.ok(!blindCards(sample).includes('類型'));
    assert.ok(blindCards(sample).includes('**基礎**'));
    assert.ok(blindCards(sample).includes('==知識=='));

    const out = path.join(temp, 'experiment');
    await fs.mkdir(path.join(out, '考題'), { recursive: true });
    await fs.writeFile(path.join(out, '考題/凍結.md'), '自編測試，已凍結');
    for (const name of Object.keys(config.materials)) {
      await fs.mkdir(path.join(out, '材料', name, '圖'), { recursive: true });
      await fs.writeFile(path.join(out, '材料', name, '教材.md'), 'p.1 ^p1\n![[測試.png]]');
      await fs.writeFile(path.join(out, '材料', name, '圖/測試.png'), 'test-image-bytes');
    }
    const secret = 'arch-test-only-secret', requests = [];
    const queue = Object.keys(config.materials).flatMap(() => Object.entries(config.configs).flatMap(([id, steps]) => steps.map(step => ({ id, step }))));
    let calls = 0;
    const dependencies = {
      providers: { providers: { openai: { baseUrl: 'https://example.invalid', minSecondsBetweenCalls: 0 }, openrouter: { baseUrl: 'https://example.invalid', minSecondsBetweenCalls: 0 } } },
      keys: { openai: secret, openrouter: secret },
      api: { print: () => {}, fetch: async (_url, options) => {
        const body = JSON.parse(options.body), job = queue[calls++ % queue.length]; requests.push(body);
        const segments = { 架構: plan, 卡組: sample + '\n> [!note]- 候選卡片\n> - 不送入盲評\n', 修改紀錄: '不修改 ' + secret };
        const content = job.id === 'S0' ? segments.卡組 : job.step.output.map(key => `<<<${key}>>>\n${segments[key]}`).join('\n');
        return new Response(JSON.stringify({ model: body.model, provider: 'fixture', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 50 } } }));
      } },
    };
    const session = await createSession(out, dependencies);
    const rows = await runArch({ out }, { config, session });
    assert.equal(calls, 21); assert.equal(rows.length, 18);
    assert.ok(requests.some(r => r.reasoning_effort === 'xhigh'));
    assert.ok(requests.some(r => r.reasoning?.effort === 'xhigh'));
    const raw = path.join(out, '生成/2-1/S2/卡組.md'), before = (await fs.stat(raw)).mtimeMs;
    await runArch({ out }, { config, session }); assert.equal(calls, 21); assert.equal((await fs.stat(raw)).mtimeMs, before);
    // 變更參數建立新指紋，不沿用既有回覆；已保存原始回覆仍在。
    const simple = { dir: path.join(out, 'changed'), step: 'one', model: config.models.sol, system: '測試', content: [], saved: [], validate: text => ({ text }) };
    await session.produce(simple); const afterFirst = calls;
    await session.produce({ ...simple, model: { ...simple.model, parameters: { ...simple.model.parameters, reasoning_effort: 'high' } } });
    assert.equal(calls, afterFirst + 1);
    const mapping = await makeBlind({ out }, { config, random: () => 0.5 });
    assert.equal(mapping.entries.filter(e => e.kind === '卡組').length, 18);
    assert.equal(mapping.entries.filter(e => e.kind === '架構').length, 15);
    for (const kind of ['卡組', '架構']) for (const name of Object.keys(config.materials)) {
      const entries = mapping.entries.filter(e => e.kind === kind && e.material === name), pair = entries.map((e, i) => e.setting === 'S3' ? i : -1).filter(i => i >= 0);
      assert.ok(Math.abs(pair[0] - pair[1]) > 1);
    }
    async function scan(dir, visit) {
      for (const item of await fs.readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, item.name);
        if (item.isDirectory()) await scan(file, visit); else await visit(file);
      }
    }
    await scan(out, async file => assert.ok(!(await fs.readFile(file)).includes(Buffer.from(secret)), file));
    await scan(path.join(out, '盲評'), async file => {
      const text = await fs.readFile(file, 'utf8');
      assert.ok(!/\bS[0-4]\b|gpt-|claude-|短規則\.md|不送入盲評|類型：|重要性：/.test(text), file);
      assert.equal((await fs.stat(file)).mtimeMs, new Date('2000-01-01T00:00:00Z').getTime());
    });
    // 不完整段落仍記費，不會被標成完成，也不會自動再付費。
    const invalidOut = path.join(temp, 'invalid');
    const invalid = await createSession(invalidOut, { ...dependencies, api: { print: () => {}, fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '沒有標記' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })) } });
    const bad = { ...simple, dir: invalidOut, validate: text => splitSections(text, ['架構', '卡組']) };
    await assert.rejects(invalid.produce(bad), /未完成/);
    assert.ok(await invalid.budget.total() > 0);
    await assert.rejects(invalid.produce(bad), /未完成請求/);
    let paid = 0;
    const limited = await createSession(path.join(temp, 'limited'), { ...dependencies, limit: 0.01, api: { fetch: async () => { paid++; throw new Error('不應送出'); } } });
    await assert.rejects(limited.produce({ ...simple, dir: path.join(temp, 'limited') }), /預算/);
    assert.equal(paid, 0);
    console.log('arch selftest：8 類驗收通過（21 次假請求；18 卡組／15 架構；離線，未讀取真實金鑰）');
  } finally {
    const resolved = await fs.realpath(temp), parent = await fs.realpath(os.tmpdir());
    if (!resolved.startsWith(parent + path.sep)) throw new Error('暫存路徑不安全');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
