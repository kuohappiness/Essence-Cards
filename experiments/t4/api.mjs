import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { exists, readJson, writeJson, redact } from './core.mjs';

function numericUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, v]) => /^[a-z_]+$/i.test(key) && (typeof v === 'number' || (v && typeof v === 'object' && !Array.isArray(v))))
    .map(([key, v]) => [key, typeof v === 'number' ? v : numericUsage(v)]));
}
export function retryMilliseconds(header, now, attempt) {
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Number(header) * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : 15000 * 2 ** attempt;
}
export class ApiClient {
  constructor(config, keys, out, options = {}) {
    this.config = config; this.keys = keys; this.out = out;
    this.fetch = options.fetch || fetch; this.wait = options.wait || sleep;
    this.now = options.now || Date.now; this.print = options.print || console.log;
    this.last = new Map(); this.busy = false;
    this.secrets = Object.values(keys).filter(Boolean);
  }
  async record(entry) {
    const file = path.join(this.out, '紀錄.json');
    const records = await exists(file) ? await readJson(file) : [];
    if (!Array.isArray(records)) throw new Error('紀錄.json 應是陣列，請先修復再重跑');
    records.push(entry);
    await writeJson(file, records);
  }
  async request(step, model, system, content, variant, options = {}) {
    if (this.busy) throw new Error('一次只允許一個 API 請求');
    this.busy = true;
    try { return await this.send(step, model, system, content, variant, options); }
    finally { this.busy = false; }
  }
  async send(step, model, system, content, variant, options = {}) {
    const provider = this.config.providers[model.provider];
    if (!provider) throw new Error(`未定義供應商 ${model.provider}`);
    if (!this.keys[model.provider]) {
      this.print(`${model.provider} 缺少 ${provider.keyName}，跳過 ${model.model}`);
      await this.record({ time: new Date(this.now()).toISOString(), step, provider: model.provider, model: model.model, variant, status: null, seconds: 0, usage: {}, outcome: 'missing-key' });
      return null;
    }
    // 先驗證紀錄檔，避免送出後才發現無法累計既有紀錄。
    const logFile = path.join(this.out, '紀錄.json');
    if (await exists(logFile)) {
      const previous = await readJson(logFile);
      if (!Array.isArray(previous)) throw new Error('紀錄.json 應是陣列');
      for (const entry of previous.filter(r => r.provider === model.provider && r.status !== null)) {
        const end = Date.parse(entry.time) + entry.seconds * 1000;
        if (Number.isFinite(end)) this.last.set(model.provider, Math.max(this.last.get(model.provider) ?? -Infinity, end));
      }
    }
    for (let attempt = 0; attempt <= 3; attempt++) {
      const last = this.last.get(model.provider);
      const gap = last === undefined ? 0 : provider.minSecondsBetweenCalls * 1000 - (this.now() - last);
      if (gap > 0) await this.wait(gap);
      const start = this.now();
      this.print(`${step}${variant ? '/' + variant : ''}：${model.model}（第 ${attempt + 1} 次請求）`);
      let response, payload;
      try {
        response = await this.fetch(provider.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST', headers: { Authorization: `Bearer ${this.keys[model.provider]}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model.model, messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
          signal: AbortSignal.timeout(600000)
        });
        const raw = await response.text();
        try { payload = JSON.parse(raw) ?? {}; } catch { payload = { error: { message: raw } }; }
      } catch (error) {
        this.last.set(model.provider, this.now());
        await this.record({ time: new Date(start).toISOString(), step, provider: model.provider, model: model.model, variant, status: null, seconds: (this.now() - start) / 1000, usage: {}, outcome: 'network-error' });
        this.print(`HTTP 未收到回應：${redact(error.message, this.secrets).slice(0, 300)}`);
        return null;
      }
      this.last.set(model.provider, this.now());
      const choice = payload.choices?.[0];
      const text = typeof choice?.message?.content === 'string' ? choice.message.content : null;
      const valid = response.ok && text?.trim() && choice.finish_reason !== 'length' && choice.finish_reason !== 'content_filter';
      await this.record({ time: new Date(start).toISOString(), step, provider: model.provider, model: model.model, variant, status: response.status, seconds: (this.now() - start) / 1000, usage: numericUsage(payload.usage), outcome: valid ? 'ok' : response.ok ? 'invalid-response' : 'http-error' });
      if (valid) {
        const cleanText = redact(text, this.secrets);
        if (!options.metadata) return cleanText;
        return { text: cleanText,
          model: typeof payload.model === 'string' ? redact(payload.model, this.secrets) : null,
          system_fingerprint: typeof payload.system_fingerprint === 'string' ? redact(payload.system_fingerprint, this.secrets) : null,
          finish_reason: typeof choice.finish_reason === 'string' ? redact(choice.finish_reason, this.secrets) : null,
          usage: numericUsage(payload.usage), seconds: (this.now() - start) / 1000 };
      }
      if (response.status === 429) {
        const detail = payload.error?.message ?? payload.message ?? payload.error ?? payload;
        this.print('HTTP 429：' + redact(typeof detail === 'string' ? detail : JSON.stringify(detail), this.secrets).slice(0, 300));
        if (attempt === 3) { this.print(`${model.provider} 的額度暫時用完了；跳過 ${model.model}`); return null; }
        const delay = retryMilliseconds(response.headers.get('Retry-After'), this.now(), attempt);
        this.print(`HTTP 429：${delay / 1000} 秒後重試`);
        await this.wait(delay);
      } else {
        const message = response.ok ? '回覆為空、被截斷或遭內容過濾，未保存為完成結果' : payload.error?.message ?? payload.message ?? payload.error ?? payload;
        this.print(`HTTP ${response.status}：${redact(typeof message === 'string' ? message : JSON.stringify(message), this.secrets).slice(0, 300)}`);
        return null;
      }
    }
  }
}
