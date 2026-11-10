import type { TestContext } from 'node:test';

/**
 * 這個測試期間 process.platform 是指定的平台，測試結束換回來。只在某些平台開放的功能（例如還原只開放 Windows）靠它指定平台，
 * 測試結果才不看跑在哪台機器（CI 是 Linux、本機是 Windows）。node:path 在 Node 啟動時就定了，不受影響。
 */
export function onPlatform(t: TestContext, platform: NodeJS.Platform): void {
  const real = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...real, value: platform });
  t.after(() => { Object.defineProperty(process, 'platform', real); });
}
