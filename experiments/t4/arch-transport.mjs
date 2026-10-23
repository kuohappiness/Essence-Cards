// 長推理可能五分鐘都沒有回傳標頭；只由明確的 AbortSignal 決定總逾時。
// 只實作 ApiClient 使用的文字 HTTP 介面，不跟隨重新導向或重送。
import http from 'node:http';
import https from 'node:https';

export function longRequest(url, options = {}) {
  const target = new URL(url), transport = target.protocol === 'https:' ? https : target.protocol === 'http:' ? http : null;
  if (!transport) throw new Error('只支援 HTTP／HTTPS');
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('Content-Length', String(Buffer.byteLength(options.body)));
  return new Promise((resolve, reject) => {
    const request = transport.request(target, { method: options.method, headers: Object.fromEntries(headers), signal: options.signal }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8'), received = new Headers();
        for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) received.set(key, Array.isArray(value) ? value.join(', ') : value);
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, headers: received, text: async () => text });
      });
    });
    request.on('error', reject);
    request.end(options.body);
  });
}
