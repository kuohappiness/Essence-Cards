// 只用官方 SIWC、獨立本機憑證與公開 Responses；不讀 Codex 的登入檔。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { randomBytes, randomUUID, createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { exists, readJson, isInside, validateOut, redact } from './core.mjs';

export const PLAN_BASE = 'https://api.openai.com/v1';
const AUTH = 'https://auth.openai.com';
const TOKEN = AUTH + '/api/accounts/oauth/token';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const AUTH_DIR = path.join(os.homedir(), '.essence-chatgpt-plan');
const tokenFile = path.join(AUTH_DIR, 'session.json');
const random = () => randomBytes(32).toString('base64url');
const fail = (category, code) => Object.assign(new Error(`方案接法未完成：${category}（${code}）`), { category, safeCode: code });

async function privateDirectory(out) {
  await validateOut(AUTH_DIR);
  const actual = await fs.realpath(out);
  if (isInside(actual, AUTH_DIR) || isInside(AUTH_DIR, actual)) throw fail('login', 'credential-path');
  await fs.mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const sid = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-[\d-]+/)?.[0];
    if (!sid) throw fail('login', 'credential-acl');
    execFileSync('icacls', [AUTH_DIR, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { stdio: 'pipe', windowsHide: true });
  } else await fs.chmod(AUTH_DIR, 0o700);
}
async function privateWrite(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  await fs.rename(temp, file);
}
async function jsonRequest(url, options, fetcher = fetch) {
  let response;
  try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
  catch { throw fail('network', 'oauth-network'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw fail(response.status === 401 || response.status === 400 ? 'login' : 'network', 'oauth-http-' + response.status);
  return data;
}
export function verifyIdentity(jwt, { clientId, nonce, subject, jwks, now = Date.now() }) {
  try {
    const [head, body, signature, extra] = jwt.split('.');
    if (extra !== undefined || !signature) throw Error();
    const header = JSON.parse(Buffer.from(head, 'base64url')), claims = JSON.parse(Buffer.from(body, 'base64url'));
    if (header.alg !== 'RS256' || header.crit !== undefined) throw Error();
    const jwk = jwks.keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
    if (!jwk || !verify('RSA-SHA256', Buffer.from(head + '.' + body), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature, 'base64url'))) throw Error();
    if (claims.iss !== AUTH || !(Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId) ||
      !Number.isFinite(claims.exp) || claims.exp <= now / 1000 || !Number.isFinite(claims.iat) || claims.iat > now / 1000 + 30 ||
      (claims.nbf !== undefined && claims.nbf > now / 1000 + 30) || !claims.sub ||
      (nonce !== undefined && claims.nonce !== nonce) || (subject && claims.sub !== subject) ||
      (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId)) throw Error();
    return { subject: claims.sub, issuer: claims.iss };
  } catch { throw fail('login', 'invalid-id-token'); }
}
function tokenRecord(tokens, previous) {
  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string' || tokens.token_type?.toLowerCase() !== 'bearer' ||
    !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw fail('login', 'invalid-token-response');
  const scopes = typeof tokens.scope === 'string' ? tokens.scope.split(' ') : previous.scopes;
  if (!scopes?.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) throw fail('login', 'plan-permission-missing');
  return { ...previous, ...Object.fromEntries(['access_token', 'refresh_token', 'id_token'].filter(k => typeof tokens[k] === 'string').map(k => [k, tokens[k]])),
    scopes, expires_at: Date.now() + tokens.expires_in * 1000 };
}
async function authLock(out, action) {
  await privateDirectory(out);
  const file = path.join(AUTH_DIR, '.lock');
  const handle = await fs.open(file, 'wx', 0o600).catch(() => { throw fail('login', 'credential-busy'); });
  try { return await action(); } finally { await handle.close(); await fs.unlink(file); }
}
// 這個指令只啟動登入，不發推論。網址只交給本人瀏覽器，不寫入結果檔。
export async function loginPlan(out, { print = console.log, fetcher = fetch } = {}) {
  return authLock(out, async () => {
    const hostFile = path.join(AUTH_DIR, 'host.json');
    const host = await exists(hostFile) ? await readJson(hostFile) : { ext_agent_host_id: 'urn:uuid:' + randomUUID() };
    if (!(await exists(hostFile))) await privateWrite(hostFile, host);
    const previous = await exists(tokenFile) ? await readJson(tokenFile) : null;
    const state = random(), nonce = random(), verifier = random();
    let resolveCallback;
    const callback = new Promise(resolve => { resolveCallback = resolve; });
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/auth/callback' || url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid callback'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end('登入已返回；可關閉此頁。');
      resolveCallback(url.searchParams);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const redirect = `http://127.0.0.1:${server.address().port}/auth/callback`;
    const url = new URL(AUTH + '/api/accounts/authorize');
    const query = { client_id: previous?.client_id ?? 'dynamic_agent_client', ext_agent_host_id: host.ext_agent_host_id,
      response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: PLAN_BASE, state, nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') };
    if (!previous) query.agent_name_hint = 'Essence Cards architecture experiment';
    // 不在網址放 retained ID token，以免它出現在終端畫面。
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let timer;
    try {
      print('請本人在瀏覽器登入並授權 ChatGPT 方案額度；此指令不生成內容。');
      print(url.href);
      const params = await Promise.race([callback, new Promise((_, reject) => { timer = setTimeout(() => reject(fail('login', 'callback-timeout')), 10 * 60000); })]);
      if (params.has('error')) throw fail('login', 'authorization-denied');
      const clientId = params.get('client_id') ?? previous?.client_id;
      if (!clientId || clientId === 'dynamic_agent_client' || (previous && clientId !== previous.client_id) || !params.get('code')) throw fail('login', 'invalid-callback');
      const tokens = await jsonRequest(TOKEN, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId,
        code: params.get('code'), code_verifier: verifier, redirect_uri: redirect, resource: PLAN_BASE }) }, fetcher);
      const jwks = await jsonRequest(AUTH + '/.well-known/jwks.json', {}, fetcher);
      const identity = verifyIdentity(tokens.id_token, { clientId, nonce, subject: previous?.subject, jwks });
      await privateWrite(tokenFile, tokenRecord(tokens, { ...identity, ...host, client_id: clientId }));
      print('登入完成；憑證已存入 vault／repo 外的獨立本機目錄。尚未發送生成請求。');
    } finally { clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
}
export async function planCredential(out) {
  return authLock(out, async () => {
    if (!(await exists(tokenFile))) throw fail('login', 'sign-in-required');
    let record = await readJson(tokenFile);
    if (!record.client_id || !record.scopes?.includes('chatgpt.tokens.use.direct')) throw fail('login', 'sign-in-required');
    if (record.expires_at < Date.now() + 60000) {
      const tokens = await jsonRequest(TOKEN, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token',
        client_id: record.client_id, refresh_token: record.refresh_token, resource: PLAN_BASE }) });
      if (tokens.id_token) {
        const jwks = await jsonRequest(AUTH + '/.well-known/jwks.json', {});
        verifyIdentity(tokens.id_token, { clientId: record.client_id, subject: record.subject, jwks });
      }
      record = tokenRecord(tokens, record); await privateWrite(tokenFile, record);
    }
    return record;
  });
}
export function planBody(model, system, content) {
  const parameters = model.parameters ?? {};
  if (Object.keys(parameters).some(k => !['reasoning', 'store', 'stream'].includes(k)) || parameters.store !== false || parameters.stream !== true)
    throw new Error('方案參數只接受 reasoning、store:false、stream:true；不能設定輸出 token 上限');
  return { ...parameters, model: model.model, instructions: system, input: [{ role: 'user', content: content.map(p => {
    if (p.type === 'text') return { type: 'input_text', text: p.text };
    if (p.type === 'image_url') return { type: 'input_image', image_url: p.image_url.url, detail: p.image_url.detail ?? 'auto' };
    throw new Error('方案接法不接受此輸入類型');
  }) }] };
}
export function failureCategory(status, code) {
  if (status === 401 || /invalid_user|scope_not_authorized|invalid_authorization_context/.test(code ?? '')) return 'login';
  if (status === 429 || /usage_limit_exceeded|insufficient_quota/.test(code ?? '')) return 'quota';
  if (/usage_unavailable/.test(code ?? '')) return 'quota-unavailable';
  return status >= 500 ? 'network' : 'provider';
}
export async function requestPlan({ model, system, content, credential, fetcher = fetch, now = Date.now }) {
  const start = now(), body = planBody(model, system, content);
  const result = { text: '', parameters: model.parameters, responseModel: null, usage: null, finish_reason: null,
    stopStatus: '未確認', reasoningEffort: null, quota: null, quotaNote: '未提供', streamCompleted: false, category: 'unknown-stop', status: null, requestId: null };
  try {
    const response = await fetcher(PLAN_BASE + '/responses', { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + credential.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20 * 60000) });
    result.status = response.status; result.requestId = response.headers.get('x-request-id');
    // 只記可觀察的限制數值，不保存其他 HTTP 標頭或 account context。
    const quota = Object.fromEntries([...response.headers].filter(([key, value]) => /^x-ratelimit-(limit|remaining|reset)-[a-z-]+$/.test(key) && /^[\d.smh% -]+$/.test(value)));
    if (Object.keys(quota).length) { result.quota = quota; result.quotaNote = 'HTTP 標頭；未必等同五小時／每週／app 上限'; }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      result.errorCode = typeof payload.error?.code === 'string' ? payload.error.code : null;
      result.errorShape = Object.keys(payload); result.category = failureCategory(response.status, result.errorCode);
      return result;
    }
    let pending = '', terminal = false;
    const decoder = new TextDecoder();
    const event = block => {
      const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') return;
      const value = JSON.parse(data);
      if (value.type === 'response.output_text.delta' && !terminal) result.text += value.delta ?? '';
      if (['response.completed', 'response.incomplete', 'response.failed', 'error'].includes(value.type)) {
        if (terminal) throw fail('provider', 'duplicate-terminal');
        terminal = true;
        const final = value.response ?? {};
        result.responseModel = final.model ?? null; result.usage = final.usage ?? null;
        result.reasoningEffort = final.reasoning?.effort ?? null;
        result.finish_reason = final.incomplete_details?.reason ?? (value.type === 'response.completed' ? 'completed' : value.type === 'error' ? null : final.status ?? null);
        result.errorCode = final.error?.code ?? value.error?.code ?? value.code ?? null;
        result.streamCompleted = value.type === 'response.completed' && final.status === 'completed';
        result.stopStatus = result.finish_reason === null ? '未確認' : '已提供';
        result.category = result.streamCompleted ? 'complete' : result.finish_reason === 'max_output_tokens' ? 'length' :
          value.type === 'response.failed' || value.type === 'error' ? failureCategory(response.status, result.errorCode) : 'abnormal-stop';
        // 有些客戶端只提供 terminal 的 output，不重複拼接 delta。
        if (!result.text) result.text = (final.output ?? []).flatMap(i => i.content ?? []).filter(p => p.type === 'output_text').map(p => p.text).join('');
      }
    };
    for await (const chunk of response.body) {
      pending = (pending + decoder.decode(chunk, { stream: true })).replaceAll('\r\n', '\n');
      let index;
      while ((index = pending.indexOf('\n\n')) >= 0) { event(pending.slice(0, index)); pending = pending.slice(index + 2); }
    }
    pending += decoder.decode(); if (pending.trim()) event(pending);
    if (!terminal) result.category = 'unknown-stop';
  } catch (error) { result.streamCompleted = false; result.category = error.category ?? 'network'; result.finish_reason = null; result.stopStatus = '未確認'; }
  finally {
    result.seconds = (now() - start) / 1000;
    const secrets = [credential.access_token, credential.refresh_token, credential.id_token].filter(Boolean);
    // 提供者可能把憑證反射到任何字串；在離開邊界前遮罩整個結果。
    const clean = JSON.parse(redact(JSON.stringify(result), secrets));
    Object.keys(result).forEach(k => delete result[k]); Object.assign(result, clean);
  }
  return result;
}
