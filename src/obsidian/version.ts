import type { State } from '../state/index.ts';

// 「版本」命令的內容（任務說明 2-1、2-2，D-149 第 2、3 點）：不加新畫面，用 Obsidian 的通知顯示。

const OWN = {
  waiting: '本機歷史待讀取，讀到之後才記下這一版',
  queued: '這一版還在等待寫入紀錄',
  same: '已記下這一版',
  written: '已記下這一版',
} as const;
const NOTE = { 衝突副本: '（衝突副本）', 還原檔: '（還原檔，不算目前版本）', 不確定: '' } as const;
/** 需要新版的卡組最多列幾篇。 */
const LISTED = 5;

/** `2026-11-02T20:15:03.250+08:00` → `2026-11-02 20:15`（那台裝置當地的時間）。 */
const minute = (t: string): string => t.slice(0, 10) + ' ' + t.slice(11, 16);

/**
 * 這台的 BUILD、這台的版本行、每台裝置「最後回報」的版本與時間（不是即時狀態），以及需要新版才讀得懂的內容。
 * state 是 null（layout 還沒 ready）時只有 BUILD。
 */
export function versionText(build: string, device: string, state: Pick<State, 'version' | 'blocked'> | null): string {
  const lines = ['Essence Cards：' + build];
  if (!state) return [...lines, '外掛還在載入，稍後再看各裝置的版本'].join('\n');
  const { own, devices } = state.version();
  if (own !== null) lines.push(`這台（${device}）：${OWN[own]}`);
  lines.push('各裝置最後回報的版本（不是即時狀態：還沒同步或還沒重開的裝置看不出來）：');
  for (const row of devices) {
    const value = row.build ?? '不確定，同一個時間記了不同的版本';
    lines.push(`・${row.device}${row.note ? NOTE[row.note] : ''}：${value}（${minute(row.t)}）`);
  }
  if (!devices.length) lines.push('・還沒有任何裝置回報');
  const blocked = state.blocked();
  const parts = [
    ...blocked.decks.length ? [`${String(blocked.decks.length)} 篇卡組不出題`] : [],
    ...blocked.all ? ['複習紀錄有看不懂的行，全部學習目標暫停'] : blocked.targets.length ? [`${String(blocked.targets.length)} 個學習目標暫停`] : [],
  ];
  if (parts.length) {
    lines.push('有內容需要新版才讀得懂，請更新外掛：' + parts.join('、'));
    for (const path of blocked.decks.slice(0, LISTED)) lines.push('・' + path);
    if (blocked.decks.length > LISTED) lines.push(`・還有 ${String(blocked.decks.length - LISTED)} 篇`);
  }
  return lines.join('\n');
}
