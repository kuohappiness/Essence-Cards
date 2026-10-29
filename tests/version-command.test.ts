import test from 'node:test';
import assert from 'node:assert/strict';
import { versionText } from '../src/obsidian/version.ts';

// 「版本」命令的內容（任務說明 2-1、2-2）：這台的 BUILD、這台的版本行、每台裝置「最後回報」的版本與時間，
// 以及需要新版才讀得懂的內容。不加新畫面，用 Obsidian 的通知顯示。
const BUILD = '0.1.0+1a2b3c4';
const none = { decks: [], targets: [], all: false };
const report = (device: string, build: string | null, t: string, note: '衝突副本' | '還原檔' | '不確定' | null = null) =>
  ({ device, build, t, note, source: 'Essence Cards/紀錄/' + t.slice(0, 7) + ' ' + device + '.jsonl' });
const host = (own: 'waiting' | 'same' | 'queued' | 'written' | null, devices: ReturnType<typeof report>[], blocked: { decks: string[]; targets: string[]; all: boolean } = none) =>
  ({ version: () => ({ build: BUILD, own, devices }), blocked: () => blocked });

void test('版本命令：這台的 BUILD 與版本行、每台裝置最後回報的版本與時間（衝突副本、還原檔、不確定另外寫）', () => {
  const text = versionText(BUILD, 'Windows-2c9e', host('written', [
    report('Windows-2c9e', BUILD, '2026-11-02T20:15:03.250+08:00'),
    report('iPhone-7f3a', '0.0.9+5d357fa', '2026-10-30T07:02:11.020+08:00'),
    report('iPhone-7f3a', BUILD, '2026-11-01T21:00:00.000+08:00', '衝突副本'),
    report('iPhone-7f3a', '0.0.1+0000000', '2026-10-20T19:00:00.000+08:00', '還原檔'),
    report('iPad-0000', null, '2026-10-28T10:00:00.000+08:00', '不確定'),
  ]));
  assert.equal(text, [
    'Essence Cards：' + BUILD,
    '這台（Windows-2c9e）：已記下這一版',
    '各裝置最後回報的版本（不是即時狀態：還沒同步或還沒重開的裝置看不出來）：',
    '・Windows-2c9e：' + BUILD + '（2026-11-02 20:15）',
    '・iPhone-7f3a：0.0.9+5d357fa（2026-10-30 07:02）',
    '・iPhone-7f3a（衝突副本）：' + BUILD + '（2026-11-01 21:00）',
    '・iPhone-7f3a（還原檔，不算目前版本）：0.0.1+0000000（2026-10-20 19:00）',
    '・iPad-0000：不確定，同一個時間記了不同的版本（2026-10-28 10:00）',
  ].join('\n'));
});

void test('版本命令：這台的版本行各種狀態', () => {
  const own = (state: 'waiting' | 'same' | 'queued' | 'written' | null) => versionText(BUILD, 'Windows-2c9e', host(state, [])).split('\n')[1];
  assert.equal(own('waiting'), '這台（Windows-2c9e）：本機歷史待讀取，讀到之後才記下這一版');
  assert.equal(own('queued'), '這台（Windows-2c9e）：這一版還在等待寫入紀錄');
  assert.equal(own('same'), '這台（Windows-2c9e）：已記下這一版');
  assert.equal(own('written'), '這台（Windows-2c9e）：已記下這一版');
  assert.equal(versionText(BUILD, 'Windows-2c9e', host('same', [])).split('\n').at(-1), '・還沒有任何裝置回報');
});

void test('版本命令：外掛還沒載入完', () => {
  assert.equal(versionText(BUILD, 'Windows-2c9e', null), 'Essence Cards：' + BUILD + '\n外掛還在載入，稍後再看各裝置的版本');
});

void test('版本命令：需要新版才讀得懂的內容列在最後', () => {
  const last = (blocked: { decks: string[]; targets: string[]; all: boolean }) => versionText(BUILD, 'Windows-2c9e', host('same', [], blocked)).split('\n').slice(4);
  assert.deepEqual(last(none), []);
  assert.deepEqual(last({ decks: ['Essence Cards/A.md', 'Essence Cards/B.md'], targets: ['abc123'], all: false }), [
    '有內容需要新版才讀得懂，請更新外掛：2 篇卡組不出題、1 個學習目標暫停',
    '・Essence Cards/A.md', '・Essence Cards/B.md',
  ]);
  assert.deepEqual(last({ decks: [], targets: ['abc123'], all: true }), ['有內容需要新版才讀得懂，請更新外掛：複習紀錄有看不懂的行，全部學習目標暫停']);
  const many = Array.from({ length: 7 }, (_, i) => `Essence Cards/${String(i)}.md`);
  assert.deepEqual(last({ decks: many, targets: [], all: false }).slice(-2), ['・Essence Cards/4.md', '・還有 2 篇']);
});
