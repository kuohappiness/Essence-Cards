// 用遠端偵錯操作 Windows 版 Obsidian（試作場的 AI 測試用）。
// 先完全關掉 Obsidian，再用 Obsidian.exe --remote-debugging-port=9222 "obsidian://open?vault=<vault 名稱>" 打開。
// 用法：node obsidian-cdp.mjs eval "<js>" | shot <out.png> | swipe x1 y1 x2 y2 [ms] | size w h（模擬手機尺寸與觸控）| nosize
import { writeFile } from 'node:fs/promises';
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(t => t.type === 'page' && t.url.startsWith('app://obsidian.md/index.html'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const waiting = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const [cmd, ...args] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${args[0]} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r, null, 1));
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(args[0], Buffer.from(r.result.data, 'base64')); console.log('saved', args[0]);
} else if (cmd === 'size') {
  await send('Emulation.setDeviceMetricsOverride', { width: +args[0], height: +args[1], deviceScaleFactor: 0, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); console.log('ok');
} else if (cmd === 'nosize') {
  await send('Emulation.clearDeviceMetricsOverride'); await send('Emulation.setTouchEmulationEnabled', { enabled: false }); console.log('ok');
} else if (cmd === 'swipe') {
  const [x1, y1, x2, y2, ms = 250] = args.map(Number), steps = 12;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= steps; i++) { await sleep(ms / steps); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }] }); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); console.log('swiped');
}
ws.close();
