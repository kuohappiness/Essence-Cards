// 自編最小資料；不連網、不讀真實 API 金鑰或方案憑證。
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { ROOT, readJson, writeJson } from './core.mjs';
import { secondSettings, secondPrompt, prepareSecond, runSecond } from './arch-r2.mjs';
import { createSecondSession } from './arch-r2-session.mjs';
import { renderCards, blindSecond } from './arch-r2-blind.mjs';
import { splitSections } from './arch-request.mjs';
import { requestPlan, verifyIdentity, planBody } from './arch-plan.mjs';

const image = '自編原始圖.png';
const sample = `> [!note] 給家長的備註\n> 另練實作\n\n- 能觀察\n    - 出處：p.1｜類型：原理｜重要性：高\n    - 共用補充\n    - 問題 :: **答案**\n    - 看 ![[${image}]] 判斷 :: **結果**\n        - ![[${image}]]\n        - 詳解：原因\n    - 水溫越==高==，溶解越==快==\n    - 多行問題 ::\n        - 第一點\n        - 第二點\n\n> [!note]- 候選卡片\n> - 能候選\n>     - 候選題 :: 候選答\n`;
const architecture = '- T01｜①｜能觀察\n    - 判準：能觀察\n    - 出處：p.1';
const replyText = full => (full ? '<<<全貌>>>\n全貌原文\n' : '') + '<<<架構>>>\n' + architecture + '\n<<<卡組>>>\n' + sample;
function stream(text, { type = 'response.completed', reason, code, effort = 'high' } = {}) {
  const response = { model: 'gpt-6.1-sol-fixture', status: type.split('.')[1], reasoning: effort ? { effort } : undefined,
    usage: { input_tokens: 10, output_tokens: 30, output_tokens_details: { reasoning_tokens: 20 } },
    incomplete_details: reason ? { reason } : undefined, error: code ? { code } : undefined };
  return new Response('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: text }) + '\n\n' +
    'data: ' + JSON.stringify({ type, response }) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}
async function scan(dir, action) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name); if (item.isDirectory()) await scan(file, action); else await action(file);
  }
}
export async function selftest() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'arch-r2-test-'));
  try {
    const root = path.join(temp, 'repo/experiments/t4'), out = path.join(temp, 'output'), config = await secondSettings();
    for (const steps of Object.values(config.configs)) for (const step of steps) for (const file of step.system) {
      const destination = path.resolve(root, 'arch/第二輪', file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(path.resolve(ROOT, 'arch/第二輪', file), destination);
    }
    await writeJson(path.join(root, 'arch/第二輪/設定.json'), config);
    await fs.mkdir(path.join(out, '考題'), { recursive: true }); await fs.writeFile(path.join(out, '考題/凍結.md'), '自編凍結');
    await fs.mkdir(path.join(out, '材料'), { recursive: true }); await fs.writeFile(path.join(out, '材料/凍結.md'), '自編凍結');
    for (const name of Object.keys(config.materials)) {
      await fs.mkdir(path.join(out, '材料', name, '圖'), { recursive: true });
      await fs.writeFile(path.join(out, '材料', name, '教材.md'), `p.1 ^p1\n\n自編文字\n![[${image}]]`);
      await fs.writeFile(path.join(out, '材料', name, '圖', image), 'fixture-png-bytes');
    }
    // 1. 每個提示的原始字串按設定順序；覆寫只取代既有鍵。
    for (const [id, steps] of Object.entries(config.configs)) for (const step of steps) {
      const prompt = await secondPrompt(root, config.materials['1-3'], step);
      const expected = [];
      for (const file of step.system) {
        let raw = await fs.readFile(path.resolve(root, 'arch/第二輪', file), 'utf8');
        const lines = config.materials['1-3'].任務資料.map(l => id === 'R3' && l === '允許 AI 補充：否' ? '允許 AI 補充：是' : l);
        expected.push(raw.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').replaceAll('{{任務資料}}', lines.join('\n')).trimEnd());
      }
      assert.equal(prompt.system, expected.join('\n\n'));
      assert.ok(prompt.system.includes('允許 AI 補充：' + (id === 'R3' ? '是' : '否')));
    }
    await assert.rejects(secondPrompt(root, config.materials['1-3'], { ...config.configs.R3[0], 任務資料覆寫: { 不存在: '是' } }), /同名/);
    const split = splitSections(replyText(true), ['全貌', '架構', '卡組']); assert.equal(split.全貌, '全貌原文');
    assert.throws(() => splitSections(replyText(false), ['全貌', '架構', '卡組']), /段落/);
    assert.deepEqual(splitSections('自編卡組', ['卡組'], true), { 卡組: '自編卡組' });
    const plan = await prepareSecond({ out, plan: '接法驗證' }, { root });
    assert.deepEqual(plan.jobs.map(j => [j.name, j.id]), [['2-1', 'R3'], ['2-2', 'R3']]);
    await assert.rejects(prepareSecond({ out, materials: ['1-3', '1-3'] }, { root }), /不重複/);
    // 2. 正反面精確的獨立預期值；圖、詳解、兩個空格、多行、共用補充、候選。
    const rendered = renderCards(sample);
    assert.deepEqual(rendered.problemLines, []);
    assert.ok(rendered.text.includes('**正面**\n\n問題\n\n**背面**\n\n**答案**\n\n共用補充'));
    assert.ok(rendered.text.includes(`**正面**\n\n看 ![[${image}]] 判斷\n\n**背面**\n\n**結果**\n\n![[${image}]]\n\n詳解：原因\n\n共用補充`));
    assert.ok(rendered.text.includes('**正面**\n\n水溫越＿＿，溶解越＿＿\n\n**背面**\n\n水溫越高，溶解越快'));
    assert.ok(rendered.text.includes('**正面**\n\n多行問題\n\n**背面**\n\n第一點\n第二點\n\n共用補充'));
    assert.equal((rendered.text.match(/共用補充/g) ?? []).length, 4);
    assert.ok(rendered.text.includes('候選（不是正式的卡）')); assert.ok(rendered.text.includes('候選答'));
    assert.ok(!/類型：|重要性：/.test(rendered.text));
    const bad = renderCards('- 目標\n    - 出處：p.1\n    - 問 ::');
    assert.deepEqual(bad.problemLines, [3]); assert.ok(bad.text.includes('第 3 行')); assert.ok(bad.text.includes('- 問 ::'));
    assert.deepEqual(renderCards('這行判斷不了\n\n- 問 :: 答').problemLines, [1]);
    // 3. 假方案串流：精確參數與圖片；停止原因分類，不將缺段當成長度。
    const model = config.models['sol-plan'], credential = { access_token: 'fake-plan-secret', refresh_token: 'fake-refresh-secret', id_token: 'fake-id-secret' };
    const content = [{ type: 'text', text: '自編教材' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,ZmFrZQ==', detail: 'high' } }];
    const request = { model, system: '自編系統', content, credential };
    let sent;
    const completed = await requestPlan({ ...request, fetcher: async (_url, options) => { sent = JSON.parse(options.body); return stream(replyText(true)); } });
    assert.equal(sent.reasoning.effort, 'high'); assert.equal(sent.store, false); assert.equal(sent.stream, true);
    assert.equal(sent.input[0].content[1].type, 'input_image'); assert.equal(sent.max_output_tokens, undefined);
    assert.equal(completed.category, 'complete'); assert.equal(completed.usage.output_tokens_details.reasoning_tokens, 20);
    const cases = [
      [async () => stream('部分', { type: 'response.incomplete', reason: 'max_output_tokens' }), 'length'],
      [async () => { throw Error('網路'); }, 'network'],
      [async () => new Response('{}', { status: 401 }), 'login'],
      [async () => stream('', { type: 'response.failed', code: 'subscription_sharing_usage_limit_exceeded' }), 'quota'],
      [async () => stream('', { type: 'response.failed', code: 'subscription_sharing_usage_unavailable' }), 'quota-unavailable'],
      [async () => new Response('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: replyText(true) }) + '\n\n'), 'unknown-stop'],
    ];
    for (const [fetcher, category] of cases) assert.equal((await requestPlan({ ...request, fetcher })).category, category);
    assert.throws(() => planBody({ ...model, parameters: { ...model.parameters, max_output_tokens: 128000 } }, '', []), /上限/);
    // 4. 真正跑 session：沿用、推理／接法／提示改動，未完成及洩漏遮罩。
    let planCalls = 0, apiCalls = 0;
    const dependencies = { root, credential: async () => credential, keys: { openai: 'fake-api-secret' },
      providers: { providers: { openai: { baseUrl: 'https://example.invalid', minSecondsBetweenCalls: 0 } } },
      planFetch: async (_url, options) => { const body = JSON.parse(options.body); planCalls++; return stream(replyText(body.instructions.includes('# 先畫全貌')) + '\n'); },
      api: { print: () => {}, fetch: async () => { apiCalls++; return new Response(JSON.stringify({ model: 'gpt-5.6-terra-fixture',
        choices: [{ message: { content: sample }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 30 } })); } },
    };
    const rows = await runSecond({ out }, dependencies); assert.equal(rows.length, 5); assert.ok(rows.every(r => r.complete));
    assert.equal(planCalls, 4); assert.equal(apiCalls, 1); assert.ok(rows.every(r => r.countsAgree));
    const rawFile = path.join(out, '生成/1-3/R0/卡組.md'), mtime = (await fs.stat(rawFile)).mtimeMs;
    await runSecond({ out }, dependencies); assert.equal(planCalls, 4); assert.equal(apiCalls, 1); assert.equal((await fs.stat(rawFile)).mtimeMs, mtime);
    const session = await createSecondSession(out, dependencies), prompt = await secondPrompt(root, config.materials['1-3'], config.configs.R0[0]);
    const job = { dir: path.join(out, '變動'), step: '步驟1', model, ...prompt, content, saved: [{ type: 'text', text: '自編' }], expected: ['架構', '卡組'], plain: false };
    const first = await session.produce(job); await session.produce(job); const count = planCalls;
    const high = { ...model, parameters: { ...model.parameters, reasoning: { effort: 'medium' } } };
    const changed = await session.produce({ ...job, model: high }); assert.notEqual(changed.fingerprint, first.fingerprint); assert.equal(planCalls, count + 1);
    await session.produce({ ...job, model: { provider: 'openai', model: 'gpt-5.6-terra', parameters: { max_completion_tokens: 100 } }, plain: true }); assert.equal(apiCalls, 2);
    await fs.appendFile(path.resolve(root, 'arch/第二輪/格式.md'), '\n');
    const changedPrompt = await secondPrompt(root, config.materials['1-3'], config.configs.R0[0]);
    await session.produce({ ...job, ...changedPrompt }); assert.equal(planCalls, count + 2);
    await fs.copyFile(path.resolve(ROOT, 'arch/第二輪/格式.md'), path.resolve(root, 'arch/第二輪/格式.md'));
    const beforeBytes = await secondPrompt(root, config.materials['1-3'], config.configs.R0[0]);
    const rawPrompt = await fs.readFile(path.resolve(root, 'arch/第二輪/格式.md'), 'utf8');
    const differentEol = rawPrompt.includes('\r\n') ? rawPrompt.replaceAll('\r\n', '\n') : rawPrompt.replaceAll('\n', '\r\n');
    await fs.writeFile(path.resolve(root, 'arch/第二輪/格式.md'), differentEol);
    const afterBytes = await secondPrompt(root, config.materials['1-3'], config.configs.R0[0]);
    assert.equal(beforeBytes.system, afterBytes.system);
    assert.notEqual(beforeBytes.files[0].sha256, afterBytes.files[0].sha256);
    await fs.copyFile(path.resolve(ROOT, 'arch/第二輪/格式.md'), path.resolve(root, 'arch/第二輪/格式.md'));
    await runSecond({ out, configs: ['R0'] }, dependencies);
    assert.equal((await readJson(path.join(out, '生成/機械統計-1.json'))).length, 5);
    // 5. 盲評 5+4，亂碼與圖檔中性，R3 全貌在最前，重跑不改內容。
    const mapping = await blindSecond({ out }, { config });
    assert.equal(mapping.entries.filter(e => e.kind === '卡組').length, 5); assert.equal(mapping.entries.filter(e => e.kind === '架構').length, 4);
    const full = mapping.entries.find(e => e.kind === '架構' && e.setting === 'R3');
    assert.ok((await fs.readFile(path.join(out, '盲評/架構', full.code + '.md'), 'utf8')).startsWith('# 全貌\n\n全貌原文'));
    await blindSecond({ out }, { config });
    await scan(path.join(out, '盲評'), async file => {
      assert.equal((await fs.stat(file)).mtimeMs, 946684800000);
      if (file.endsWith('.md')) {
        const text = await fs.readFile(file, 'utf8'); assert.ok(!/\bR[0-3]\b|\bS0\b|gpt-|claude-|類型：|重要性：|自編原始圖|格式\.md/.test(text));
      } else assert.equal(await fs.readFile(file, 'utf8'), 'fixture-png-bytes');
    });
    // 6. 預試與正式隔開；只有一份長度失敗才重試一次。
    let trialCalls = 0;
    const trialDeps = { ...dependencies, planFetch: async () => { trialCalls++; return trialCalls === 1 ? stream('部分', { type: 'response.incomplete', reason: 'max_output_tokens' }) : stream(replyText(true)); } };
    const trial = await runSecond({ out, plan: '接法驗證' }, trialDeps); assert.equal(trialCalls, 3); assert.ok(trial.every(r => r.complete));
    await runSecond({ out, plan: '接法驗證' }, trialDeps); assert.equal(trialCalls, 3);
    await runSecond({ out, materials: ['2-1'], configs: ['R3'] }, trialDeps); assert.equal(trialCalls, 4);
    for (const [label, fetcher, expectedCalls] of [
      ['both-length', async () => stream('部分', { type: 'response.incomplete', reason: 'max_output_tokens' }), 2],
      ['network', async () => { throw Error(); }, 1],
      ['login', async () => new Response('{}', { status: 401 }), 1],
      ['quota', async () => new Response('{}', { status: 429 }), 1],
      ['missing', async () => stream(replyText(false)), 1],
      ['empty', async () => stream(''), 1],
    ]) {
      let calls = 0;
      const result = await runSecond({ out, run: 10 + ['both-length','network','login','quota','missing','empty'].indexOf(label), plan: '接法驗證' }, {
        ...dependencies, planFetch: async () => { calls++; return fetcher(); },
      });
      assert.equal(calls, expectedCalls); assert.ok(result.some(r => !r.complete));
    }
    let retryCalls = 0;
    const retry = await runSecond({ out, run: 20, plan: '接法驗證' }, { ...dependencies, planFetch: async () => {
      retryCalls++; return retryCalls === 2 ? stream(replyText(true)) : stream('部分', { type: 'response.incomplete', reason: 'max_output_tokens' });
    } });
    assert.equal(retryCalls, 3); assert.equal(retry[0].category, 'length');
    await assert.rejects(runSecond({ out, run: 20, plan: '接法驗證' }, dependencies), /未完成/);
    // 7. 反射到模型字串、用量或正文的假憑證，全都不能落盤。
    const leaking = await createSecondSession(out, { ...dependencies, planFetch: async () => stream(replyText(false) + '\n' + Object.values(credential).join(' ')) });
    await leaking.produce({ ...job, dir: path.join(out, '遮罩') });
    await scan(out, async file => { const bytes = await fs.readFile(file); for (const secret of [...Object.values(credential), 'fake-api-secret']) assert.ok(!bytes.includes(Buffer.from(secret)), file); });
    for (const [i, finish] of [undefined, 'length', 'tool_calls', 'stop'].entries()) {
      let calls = 0;
      const apiSession = await createSecondSession(out, { ...dependencies, api: { print: () => {}, fetch: async () => {
        calls++; return new Response(JSON.stringify({ choices: [{ message: { content: finish === 'stop' ? '' : sample }, finish_reason: finish }], usage: { prompt_tokens: 2, completion_tokens: 2 } }));
      } } });
      const result = await apiSession.produce({ ...job, dir: path.join(out, 'api-stop-' + i), model: config.models.terra, plain: true, expected: ['卡組'] });
      assert.equal(result.complete, false);
      assert.equal(result.category, ['unknown-stop', 'length', 'abnormal-stop', 'empty'][i]); assert.equal(calls, 1);
    }
    let quotaCalls = 0;
    const quotaSession = await createSecondSession(out, { ...dependencies, api: { print: () => {}, fetch: async () => { quotaCalls++; return new Response('{}', { status: 429 }); } } });
    const quotaResult = await quotaSession.produce({ ...job, dir: path.join(out, 'api-quota'), model: config.models.terra, plain: true, expected: ['卡組'] });
    assert.equal(quotaResult.category, 'quota'); assert.equal(quotaCalls, 1);
    // 8. ID token 的簽章、audience、issuer、nonce、期限與身分都必須核對。
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }), jwk = publicKey.export({ format: 'jwk' }); jwk.kid = 'fixture';
    const claims = { sub: 'fixture', iss: 'https://auth.openai.com', aud: 'oaiapp_fixture', nonce: 'fixture-nonce', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+60 };
    const jwt = value => { const data = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(value)).toString('base64url'); return data + '.' + sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url'); };
    const validation = { clientId: 'oaiapp_fixture', nonce: 'fixture-nonce', jwks: { keys: [jwk] } };
    assert.equal(verifyIdentity(jwt(claims), validation).subject, 'fixture');
    for (const patch of [{ aud: 'wrong' }, { iss: 'wrong' }, { nonce: 'wrong' }, { exp: 1 }, { sub: '' }]) assert.throws(() => verifyIdentity(jwt({ ...claims, ...patch }), validation), /invalid-id-token/);
    assert.throws(() => verifyIdentity(jwt(claims).slice(0, -8) + 'AAAAAAAA', validation), /invalid-id-token/);
    assert.equal((await readJson(path.join(out, '紀錄/預算.json'))).limitUsd, 5);
    console.log('arch 第二輪 selftest：8 類驗收通過（離線假請求；5 卡組／4 架構；未讀真實金鑰或登入檔）');
  } finally {
    const target = await fs.realpath(temp), parent = await fs.realpath(os.tmpdir());
    if (!target.startsWith(parent + path.sep)) throw Error('暫存路徑不安全');
    await fs.rm(target, { recursive: true, force: true });
  }
}
