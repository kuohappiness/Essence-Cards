import type { App } from 'obsidian';
import { SOURCE } from './samples';
export async function ensureFolder(app: App, path: string) {
  let current = '';
  for (const part of path.split('/')) {
    current += (current ? '/' : '') + part;
    if (!await app.vault.adapter.exists(current)) {
      try { await app.vault.createFolder(current); }
      catch (error) { if (!await app.vault.adapter.exists(current)) throw error; }
    }
  }
}
export function wav(): ArrayBuffer {
  const rate = 22050, count = rate * 3, buffer = new ArrayBuffer(44 + count * 2), d = new DataView(buffer);
  const str = (at: number, s: string) => [...s].forEach((c, i) => d.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF'); d.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVEfmt '); d.setUint32(16, 16, true);
  d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, 'data'); d.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) { const t = i / rate, local = t % 1, envelope = Math.min(local * 20, (1 - local) * 20, 1); d.setInt16(44 + i * 2, Math.sin(t * Math.PI * 2 * [440, 554.37, 659.25][Math.floor(t)]) * envelope * 6000, true); }
  return buffer;
}
export async function png(large: boolean) {
  const canvas = document.createElement('canvas'); canvas.width = large ? 3000 : 800; canvas.height = large ? 2000 : 500;
  const ctx = canvas.getContext('2d'); if (!ctx) throw Error('Canvas 不可用');
  ctx.fillStyle = '#fafaf9'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (large) {
    ctx.strokeStyle = '#b8c6d8'; ctx.lineWidth = 1;
    for (let x = 0; x < 3000; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 2000); ctx.stroke(); }
    for (let y = 0; y < 2000; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(3000, y); ctx.stroke(); }
    ctx.fillStyle = '#1d1f23'; ctx.font = '48px sans-serif';
    for (let y = 100; y < 2000; y += 180) ctx.fillText('Essence T2 · 自編縮放測試 · ' + y, 80, y);
  } else {
    for (const x of [100, 500]) {
      ctx.fillStyle = x === 100 ? '#8db7ff' : '#b69cf5'; ctx.fillRect(x, 210, 160, 180);
      ctx.strokeStyle = '#1d1f23'; ctx.lineWidth = 6; ctx.strokeRect(x, 100, 160, 290);
    }
    ctx.beginPath(); ctx.moveTo(310, 230); ctx.lineTo(440, 230); ctx.lineTo(410, 200); ctx.moveTo(440, 230); ctx.lineTo(410, 260); ctx.stroke();
    ctx.fillStyle = '#1d1f23'; ctx.font = '28px sans-serif'; ctx.fillText('色水', 145, 450); ctx.fillText('觀察變化', 520, 450);
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('PNG 編碼失敗')), 'image/png'));
  return blob.arrayBuffer();
}
export async function createData(app: App) {
  await ensureFolder(app, 'Essence-T2/附件');
  if (!await app.vault.adapter.exists(SOURCE)) await app.vault.create(SOURCE, '# 自編實驗：觀察水\n\n把少量色水加入透明水杯，比較不同溫度下顏色散開的速度。質量除以體積就是密度。\n\n所有內容與附件均為試作自編。');
  for (const [name, make] of [['t2-小圖.png', () => png(false)], ['t2-大圖.png', () => png(true)], ['t2-音.wav', async () => wav()]] as const) {
    const path = 'Essence-T2/附件/' + name;
    if (!await app.vault.adapter.exists(path)) await app.vault.createBinary(path, await make());
  }
}
