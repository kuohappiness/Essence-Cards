// 第二輪的請求記錄、完整性與 $5 預算；不影響第一輪的重試策略。
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, exists, readJson, writeJson, loadKeys, redact } from './core.mjs';
import { hash } from './screen-analysis.mjs';
import { ApiClient } from './api.mjs';
import { Budget, PRICES, estimateRequest, splitSections } from './arch-request.mjs';
import { longRequest } from './arch-transport.mjs';
import { PLAN_BASE, planBody, planCredential, requestPlan, failureCategory } from './arch-plan.mjs';

export async function createSecondSession(out, dependencies = {}) {
  const budget = new Budget(out, 5), secrets = [...Object.values(dependencies.keys ?? {}).filter(Boolean)];
  const clean = value => JSON.parse(redact(JSON.stringify(value), secrets));
  let api, estimate;
  async function apiClient() {
    if (api) return api;
    const providers = dependencies.providers ?? await readJson(path.join(ROOT, 'models.json'));
    const keys = dependencies.keys ?? await loadKeys({ openai: providers.providers.openai });
    secrets.push(...Object.values(keys).filter(Boolean));
    api = new ApiClient({ ...providers, pricesUsdPerMillion: PRICES }, keys, out, {
      fetch: longRequest, timeoutMs: 20 * 60000, print: () => {}, ...dependencies.api,
      beforeRequest: () => budget.reserve(estimate.upperUsd, '第二輪/S0'), afterRecord: entry => budget.settle(entry),
    });
    return api;
  }
  return { budget, async produce(job, { retryLength = false } = {}) {
    const { dir, step, model, system, content, saved, files, expected, plain } = job;
    if (model.provider === 'chatgpt-plan') planBody(model, system, content);
    const endpoint = model.provider === 'chatgpt-plan' ? PLAN_BASE + '/responses' :
      (dependencies.providers?.providers.openai.baseUrl ?? 'https://api.openai.com/v1') + '/chat/completions';
    const fingerprint = hash(JSON.stringify({ model, endpoint, system, files, user: saved, expected, plain }));
    const base = path.join(dir, '請求', step, fingerprint), complete = path.join(base, '完成.json');
    if (await exists(complete)) {
      const record = await readJson(complete), text = await fs.readFile(path.join(base, record.attempt, '原始回覆.md'), 'utf8');
      if (hash(text) !== record.sha256) throw new Error('既有回覆已被修改，拒絕沿用');
      return { complete: true, parts: splitSections(text, expected, plain), fingerprint, reused: true, metadata: record.metadata };
    }
    let attempt = '第1次';
    if (await exists(base)) {
      const incomplete = path.join(base, '第1次', '未完成.json');
      if (!retryLength || !(await exists(incomplete)) || (await readJson(incomplete)).category !== 'length' || await exists(path.join(base, '第2次')))
        throw new Error('已有未完成請求；僅允許接法預試的一次長度重試，請先查紀錄');
      attempt = '第2次';
    } else if (retryLength) throw new Error('找不到可重試的長度截斷請求');
    const requestDir = path.join(base, attempt);
    estimate = model.provider === 'openai' ? estimateRequest(model, system, saved) : null;
    if (estimate && await budget.total() + estimate.upperUsd > 5) throw new Error('第二輪 API 剩餘預算不足（上限 $5）');
    await fs.mkdir(requestDir, { recursive: true });
    await writeJson(path.join(requestDir, '送出.json'), clean({ fingerprint, time: new Date().toISOString(), model, endpoint, parameters: model.parameters,
      files, system, user: saved, estimate }));
    let result;
    try {
      if (model.provider === 'chatgpt-plan') {
        const credential = await (dependencies.credential ?? planCredential)(out);
        secrets.push(...[credential.access_token, credential.refresh_token, credential.id_token].filter(Boolean));
        result = await requestPlan({ model, system, content, credential, fetcher: dependencies.planFetch ?? fetch });
      } else if (model.provider === 'openai') {
        const client = await apiClient();
        const reply = await client.request(step, model, system, content, undefined, { metadata: true, strictEnd: true });
        const data = reply ?? client.lastResult ?? {};
        result = { ...data, text: reply?.text ?? client.lastText ?? '', quota: null, quotaNote: '未提供',
          category: reply ? 'complete' : data.finish_reason === 'length' ? 'length' : data.status === null ? 'network' :
            data.status >= 400 ? failureCategory(data.status, data.errorCode) : data.finish_reason === null ? 'unknown-stop' : !client.lastText?.trim() ? 'empty' : 'abnormal-stop',
          stopStatus: data.finish_reason ? '已提供' : '未確認' };
      } else throw new Error('第二輪不支援此 provider');
    } catch (error) {
      result = { text: '', category: error.category ?? 'local-error', finish_reason: null, stopStatus: '未確認',
        errorCode: error.safeCode ?? null, seconds: 0, usage: null, quota: null, quotaNote: '未提供' };
    }
    const { text, ...metadata } = clean(result);
    await fs.writeFile(path.join(requestDir, '原始回覆.md'), text, { flag: 'wx' });
    let parts, category = metadata.category;
    if (category === 'complete') {
      try { parts = splitSections(text, expected, plain); }
      catch { category = text.trim() ? 'missing-sections' : 'empty'; }
    }
    metadata.category = category;
    metadata.textChars = text.length;
    metadata.usageNote = metadata.usage ? '已提供' : '未提供';
    metadata.modelNote = metadata.responseModel ? '已提供' : '未提供';
    metadata.actualPlan = null; metadata.actualPlanNote = '未提供；G2 另記本人確認的方案';
    metadata.quotaBefore = null; metadata.quotaAfter = metadata.quota;
    metadata.quotaBeforeNote = '未提供；不推定五小時／每週／app 剩餘量';
    metadata.reasoningNote = metadata.reasoningEffort ? '回覆有提供推理設定' : '未提供；high 是否生效未確認';
    await writeJson(path.join(requestDir, '回覆.json'), metadata);
    if (category !== 'complete') {
      await writeJson(path.join(requestDir, '未完成.json'), { category, finish_reason: metadata.finish_reason, stopStatus: metadata.stopStatus });
      return { complete: false, category, fingerprint, metadata };
    }
    await writeJson(complete, { fingerprint, sha256: hash(text), attempt, metadata });
    return { complete: true, parts, fingerprint, metadata, reused: false };
  } };
}
