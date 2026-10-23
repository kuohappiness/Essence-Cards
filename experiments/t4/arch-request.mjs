// 實驗的付費邊界：先保留預算，再送出；每個指紋的原始回覆只寫一次。
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, exists, readJson, writeJson, loadKeys, redact } from './core.mjs';
import { ApiClient } from './api.mjs';
import { hash } from './screen-analysis.mjs';
import { longRequest } from './arch-transport.mjs';

export const PRICES = {
  'gpt-6-sol': { input: 2, output: 10 },
  'gpt-6.1-sol': { input: 2, output: 10 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'anthropic/claude-opus-5.5': { input: 4, output: 20 },
};
export const MAX_USD = 20;
export function estimateRequest(model, system, saved) {
  const price = PRICES[model.model];
  if (!price) throw new Error('未知的模型定價，停止送出');
  const parameters = model.parameters ?? {};
  const output = parameters.max_completion_tokens ?? parameters.max_tokens;
  if (!Number.isSafeInteger(output) || output <= 0) throw new Error('付費請求必須明確指定輸出 token 上限');
  // 文字以 UTF-8 bytes 上界估 token；圖以每張 16k token 預留，非帳單。
  const text = saved.filter(p => p.type === 'text').map(p => p.text).join('\n');
  const input = Buffer.byteLength(system + text, 'utf8') + saved.filter(p => p.type === 'image').length * 16384 + 2048;
  // 長 context 的 OpenAI 溢價也納入上界。
  const multiplier = model.provider === 'openai' && input > 272000 ? { input: 2, output: 1.5 } : { input: 1, output: 1 };
  // 公開端點表也有 2 倍定價的路由；尚未釘選供應商時，以最高列價預留。
  const routeMultiplier = model.provider === 'openrouter' ? 2 : 1;
  return { inputTokens: input, maxOutputTokens: output,
    upperUsd: (input * price.input * multiplier.input + output * price.output * multiplier.output) * routeMultiplier / 1e6 };
}

export class Budget {
  constructor(out, limit = MAX_USD) { this.file = path.join(out, '紀錄/預算.json'); this.limit = limit; this.active = null; }
  async state() {
    const state = await exists(this.file) ? await readJson(this.file) : { limitUsd: this.limit, entries: [] };
    if (!Array.isArray(state.entries)) throw new Error('預算紀錄格式錯誤');
    for (const entry of state.entries) {
      if (!Number.isFinite(entry.reservedUsd) || entry.reservedUsd < 0 || (entry.chargedUsd !== null && (!Number.isFinite(entry.chargedUsd) || entry.chargedUsd < 0)))
        throw new Error('預算紀錄的花費無效，停止執行');
    }
    return state;
  }
  async total() {
    const state = await this.state();
    return state.entries.reduce((sum, entry) => sum + (entry.chargedUsd ?? entry.reservedUsd), 0);
  }
  async reserve(upper, description) {
    if (!Number.isFinite(upper) || upper < 0) throw new Error('花費估算無效');
    const state = await this.state(), spent = await this.total();
    if (spent >= this.limit || spent + upper > this.limit) throw new Error(`預算不足：已計 $${spent.toFixed(4)}，本次上界 $${upper.toFixed(4)}，上限 $${this.limit}`);
    const id = randomUUID();
    state.entries.push({ id, description, time: new Date().toISOString(), reservedUsd: upper, chargedUsd: null });
    await writeJson(this.file, state);
    this.active = id;
  }
  async settle(entry) {
    if (!this.active) return;
    const state = await this.state(), reservation = state.entries.find(e => e.id === this.active);
    if (!reservation) throw new Error('找不到請求的預算保留');
    // 未收到帳單資訊的請求保守計入預留值，避免逾時後重跑造成漏算。
    const routeCostUnknown = entry.provider === 'openrouter' && !Number.isFinite(entry.usage?.cost);
    const rejectedBeforeInference = [400, 401, 402, 403, 429].includes(entry.status);
    reservation.chargedUsd = !routeCostUnknown && Number.isFinite(entry.costUsd) ? entry.costUsd : rejectedBeforeInference ? 0 : reservation.reservedUsd;
    reservation.costKnown = (!routeCostUnknown && Number.isFinite(entry.costUsd)) || rejectedBeforeInference;
    reservation.outcome = entry.outcome;
    await writeJson(this.file, state);
    this.active = null;
    if (await this.total() >= this.limit) throw new Error('實驗花費已達上限，停止後續請求');
  }
}

export function splitSections(text, expected, plain = false) {
  if (!text.trim()) throw new Error('空回應');
  if (plain) return { 卡組: text.trim() };
  const parts = {}, markers = [...text.matchAll(/^<<<(全貌|架構|卡組|修改紀錄)>>>\s*$/gm)];
  if (text.slice(0, markers[0]?.index ?? text.length).trim()) throw new Error('標記前有額外內容或缺少標記');
  markers.forEach((m, i) => {
    if (parts[m[1]] !== undefined) throw new Error('段落標記重複');
    parts[m[1]] = text.slice(m.index + m[0].length, markers[i + 1]?.index ?? text.length).trim();
  });
  if (expected.some(k => !parts[k]) || Object.keys(parts).some(k => !expected.includes(k))) throw new Error('缺少或多出段落標記');
  return parts;
}

export async function createSession(out, dependencies = {}) {
  const providerConfig = dependencies.providers ?? await readJson(path.join(ROOT, 'models.json'));
  const keys = dependencies.keys ?? await loadKeys(providerConfig.providers);
  const secrets = Object.values(keys).filter(Boolean), budget = new Budget(out, dependencies.limit ?? MAX_USD);
  let currentEstimate;
  const client = new ApiClient({ ...providerConfig, pricesUsdPerMillion: PRICES }, keys, out, {
    fetch: longRequest, timeoutMs: 20 * 60 * 1000,
    ...dependencies.api,
    beforeRequest: async ({ step, model, attempt }) => {
      await budget.reserve(currentEstimate.upperUsd, `${step}/${model.model}/${attempt + 1}`);
    },
    afterRecord: entry => budget.settle(entry),
  });
  return { budget, secrets, client,
    async produce({ dir, step, model, system, content, saved, validate = text => ({ 文字: text }) }) {
      const fingerprint = hash(JSON.stringify({ model, url: providerConfig.providers[model.provider]?.baseUrl, system, user: saved }));
      const requestDir = path.join(dir, '請求', step, fingerprint);
      const complete = path.join(requestDir, '完成.json');
      if (await exists(complete)) {
        const record = await readJson(complete), raw = await fs.readFile(path.join(requestDir, '原始回覆.md'), 'utf8');
        if (record.sha256 !== hash(raw)) throw new Error('既有回覆已被修改，拒絕沿用');
        return { parts: validate(raw), fingerprint, requestDir, reused: true };
      }
      // 不會自動重送曾失敗或狀態不明的請求，以免重複付費。
      if (await exists(requestDir)) throw new Error(`這一步有未完成請求；先查 ${path.relative(out, requestDir)}，不要直接重送`);
      currentEstimate = estimateRequest(model, system, saved);
      if (!keys[model.provider]) throw new Error(`${model.provider} 缺少 API 金鑰`);
      // 預算失敗時不先留下請求目錄。
      if (await budget.total() + currentEstimate.upperUsd > budget.limit) throw new Error('剩餘預算不足，停止送出');
      await fs.mkdir(requestDir, { recursive: true });
      const clean = value => JSON.parse(redact(JSON.stringify(value), secrets));
      await writeJson(path.join(requestDir, '送出.json'), clean({ time: new Date().toISOString(), fingerprint, step, model, system, user: saved, estimate: currentEstimate }));
      const reply = await client.request(step, model, system, content, undefined, { metadata: true });
      if (!reply) {
        await writeJson(path.join(requestDir, '未完成.json'), { reason: client.lastResult?.outcome ?? '請求未完成', reply: client.lastResult ?? null });
        throw new Error(`${step} 未完成，停止；請查看請求紀錄`);
      }
      const { text, ...metadata } = reply;
      await fs.writeFile(path.join(requestDir, '原始回覆.md'), text, { flag: 'wx' });
      await writeJson(path.join(requestDir, '回覆.json'), clean(metadata));
      let parts;
      try { parts = validate(text); }
      catch (error) {
        await writeJson(path.join(requestDir, '未完成.json'), { reason: error.message });
        throw new Error(`${step} 未完成：${error.message}；費用已記錄`);
      }
      await writeJson(complete, { sha256: hash(text), fingerprint });
      return { parts, fingerprint, requestDir, reused: false };
    },
  };
}
