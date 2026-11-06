import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { parseDeck } from '../src/core/deck/index.ts';
import { createPreview, createSession, RATE_DELAY } from '../src/review/index.ts';
import type { Session } from '../src/review/index.ts';
import { createState } from '../src/state/index.ts';
import type { ReviewProps } from '../src/ui/Review.tsx';
import { installDom, loadUi } from './helpers/dom.ts';
import { createMemoryFiles } from './helpers/memory-files.ts';

// 換題型時焦點不能掉（題型接點第一步的 Codex 查核 F1）：用方向鍵在翻面卡與打字卡之間換，已聚焦的評分按鈕要留在原處，
// 接著按 Enter 才按得到它。tests/helpers/review-ui.ts 的替身沒有節點身分與焦點，所以這裡用真的 React 加 happy-dom。
// 元素一律用 === 比（assert.equal 失敗時會印整個 DOM 物件，把記憶體撐爆）。

const window = installDom();
// 減少動態效果：換卡不經 Motion，直接換。Text 給渲染後的處理用（src/ui/rendered.ts）。
Object.assign(globalThis, { matchMedia: () => ({ matches: true }), Text: window.Text });

class Component { load(): void {} unload(): void {} }
const obsidian = { Component, MarkdownRenderer: { render: (_app: unknown, text: string, container: HTMLElement) => { container.textContent = text; return Promise.resolve(); } } };
const { Review } = await loadUi<{ Review: (props: ReviewProps) => React.JSX.Element }>('src/ui/Review.tsx', obsidian);

const PATH = 'Essence Cards/國二上/英文/L1（卡片）.md';
const text = ['---', '年級學期: 國二上', '科目: 英文', '單元: L1', '---', '- test 英翻中 ^flip', '    - test :: 測試', '- go 中翻英 ^typed', '    - I ＿＿ home. :: went', ''].join('\n');
const settle = (): Promise<void> => act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); });

async function render(t: TestContext, session: Session): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(Review, {
      app: {} as ReviewProps['app'], session, close: () => {}, openLink: () => {}, materials: () => [], owner: () => ({ term: null, subject: null, unit: null }), units: () => [],
      speech: { say: () => {}, stop: () => {} }, autoRead: { get: () => false, set: () => {} }, pickedAt: 0,
    }));
    await Promise.resolve();
  });
  await settle();
  t.after(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); host.remove(); });
  return host;
}
const rate = (host: HTMLElement, key: string): HTMLElement => {
  const button = host.querySelector<HTMLElement>(`.ec-rate[data-k="${key}"]`);
  assert.ok(button, '沒有 ' + key);
  return button;
};
/** 按一個鍵：從目前的焦點送出，事件冒泡到 .ec-app。 */
async function press(key: string): Promise<KeyboardEvent> {
  const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }) as unknown as KeyboardEvent;
  await act(async () => { (document.activeElement ?? document.body).dispatchEvent(event); await Promise.resolve(); });
  await settle();
  return event;
}

void test('預覽：用方向鍵在展開的翻面卡與打字卡之間換，聚焦的評分按鈕留在原處，Enter 沒有被畫面攔下', async t => {
  const session = createPreview({ path: PATH, deck: parseDeck(text), reveal: true });
  assert.ok(session);
  const host = await render(t, session);
  const button = rate(host, 'good');
  button.focus();
  await press('ArrowRight');
  assert.ok(rate(host, 'good') === button, '換到打字卡：同一顆按鈕');
  assert.ok(document.activeElement === button, '換到打字卡：焦點還在');
  await press('ArrowLeft');
  assert.ok(rate(host, 'good') === button, '回到翻面卡：同一顆按鈕');
  assert.ok(document.activeElement === button, '回到翻面卡：焦點還在');
  assert.equal((await press('Enter')).defaultPrevented, false, 'Enter 交給瀏覽器按下按鈕，不是走翻面');
});

void test('回看：用方向鍵在做過的翻面卡與打字卡之間換，聚焦的評分按鈕留在原處', async t => {
  const memory = createMemoryFiles({ [PATH]: text });
  const clock = { now: Date.parse('2026-10-24T19:00:00.000+08:00') };
  const state = createState({ files: memory.files, device: 'PC-test', delay: 1, fillIds: false, now: () => clock.now, offset: () => 480 });
  t.after(() => state.close());
  await state.ready();
  const session = createSession({ state, pick: { deck: PATH }, now: () => clock.now });
  t.after(() => { session.close(); });
  await session.ready();
  session.reveal();
  clock.now += RATE_DELAY;
  assert.equal(session.rate('good'), true);
  session.input('went');
  session.submit();
  clock.now += RATE_DELAY;
  assert.equal(session.rate('good'), true);
  session.back();
  const host = await render(t, session);
  const button = rate(host, 'good');
  button.focus();
  await press('ArrowLeft');
  assert.ok(rate(host, 'good') === button, '換到翻面卡：同一顆按鈕');
  assert.ok(document.activeElement === button, '換到翻面卡：焦點還在');
  await press('ArrowRight');
  assert.ok(rate(host, 'good') === button, '回到打字卡：同一顆按鈕');
  assert.ok(document.activeElement === button, '回到打字卡：焦點還在');
});
