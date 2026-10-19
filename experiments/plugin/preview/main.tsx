import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Review, type ReviewControl } from '../src/Review';
import { SessionMetrics } from '../src/metrics';
import { png, wav } from '../src/data';
import { assets } from './obsidian';
import type { App } from 'obsidian';
async function main() {
  assets['t2-小圖.png'] = URL.createObjectURL(new Blob([await png(false)], { type: 'image/png' }));
  assets['t2-大圖.png'] = URL.createObjectURL(new Blob([await png(true)], { type: 'image/png' }));
  assets['t2-音.wav'] = URL.createObjectURL(new Blob([wav()], { type: 'audio/wav' }));
  const app = { workspace: { leftSplit: { collapsed: true }, rightSplit: { collapsed: true }, openLinkText: async () => { alert('預覽：開啟自編轉錄稿'); } } } as unknown as App;
  const control: { current: ReviewControl | null } = { current: null };
  const metrics = new SessionMetrics(true, { mode: 'tab', intercept: false, minutes: 15, deviceCode: 'preview' });
  const root = createRoot(document.getElementById('preview')!);
  root.render(createElement(Review, { app, metrics, control, close: () => root.unmount() }));
}
void main();
