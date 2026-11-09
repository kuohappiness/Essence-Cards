/**
 * 狀態與設定的基準與變更行（tasks/record-gaps.md §1）：state 第一次載入就會寫。
 * 只看作答與取消的測試用這裡濾掉；這些行本身的行為在 tests/status-log.test.ts 驗。
 */
import { createState } from '../../src/state/index.ts';
import { createMemoryFiles } from './memory-files.ts';

const OBSERVED = new Set(['status', 'cap', 'retention', 'filter', 'semester']);

export function isObserved(line: string): boolean {
  try { return OBSERVED.has(String((JSON.parse(line) as { set?: unknown }).set)); } catch { return false; }
}
/** 一份紀錄的文字拿掉這些行，其他逐字不變。 */
export function withoutObserved(text: string): string {
  return text.split('\n').filter(line => !isObserved(line)).join('\n');
}

/** 這台上個月就載入過：基準行都在上個月的紀錄裡，測試裡這個月的檔與 t 不受影響。 */
export async function withBaseline(vault: Record<string, string>, device: string): Promise<Record<string, string>> {
  const memory = createMemoryFiles(vault);
  const state = createState({ files: memory.files, device, delay: 0, fillIds: false, now: () => Date.parse('2026-09-30T08:00:00.000+08:00'), offset: () => 480 });
  await state.ready();
  await state.close();
  return Object.fromEntries(memory.texts);
}
