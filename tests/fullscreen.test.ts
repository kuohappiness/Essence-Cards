import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Fullscreen } from '../src/ui/fullscreen.ts';
import { installDom, layout, loadUi } from './helpers/dom.ts';

// 全螢幕的外殼（任務說明 §1、§11）：真的 React 19 加 happy-dom，用真的 Tab 事件驗繞圈。

const window = installDom();
const { openFullscreen } = await loadUi<{ openFullscreen: () => Fullscreen }>('src/ui/fullscreen.ts');

function tab(target: Element, shift = false): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }) as unknown as KeyboardEvent;
  target.dispatchEvent(event);
  return event;
}

async function screen(): Promise<{ shell: Fullscreen; buttons: HTMLElement[]; done: () => Promise<void> }> {
  const shell = openFullscreen();
  const root = createRoot(shell.element);
  await act(async () => {
    root.render(createElement('div', null,
      createElement('button', { id: 'a' }, 'a'),
      createElement('button', { id: 'off', disabled: true }, 'off'),
      createElement('div', { inert: true }, createElement('button', { id: 'behind' }, 'behind')),
      createElement('button', { id: 'b' }, 'b')));
    await Promise.resolve();
  });
  const buttons = Array.from(shell.element.querySelectorAll<HTMLElement>('button'));
  buttons.forEach(layout);
  return { shell, buttons, done: async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); shell.close(); } };
}
const byId = (id: string): HTMLElement => {
  const found = document.getElementById(id);
  assert.ok(found, id);
  return found;
};

void test('真的 React 19 畫得進外殼，Tab 只在看得到、沒停用、不在 inert 裡的按鈕之間繞', async () => {
  const { shell, done } = await screen();
  assert.equal(shell.element.className, 'ec-fullscreen');
  assert.equal(shell.element.parentElement, document.body);
  byId('b').focus();
  assert.equal(tab(byId('b')).defaultPrevented, true);
  assert.equal(document.activeElement, byId('a'), '最後一個往後繞到第一個');
  assert.equal(tab(byId('a'), true).defaultPrevented, true);
  assert.equal(document.activeElement, byId('b'), '第一個往前繞到最後一個');
  // 中間的不攔，交給瀏覽器走到下一個。
  byId('a').focus();
  assert.equal(tab(byId('a')).defaultPrevented, false);
  await done();
});

void test('焦點在畫面本身時，Shift+Tab 繞到最後一個；沒有可以停的元素時擋下來、焦點不離開', async () => {
  const { shell, done } = await screen();
  shell.element.focus();
  tab(shell.element, true);
  assert.equal(document.activeElement, byId('b'));
  shell.element.querySelectorAll('button').forEach(button => { button.remove(); });
  shell.element.focus();
  assert.equal(tab(shell.element).defaultPrevented, true);
  assert.equal(document.activeElement, shell.element);
  await done();
});

void test('觸控不往外傳；關掉時拿掉畫面、焦點還原', async () => {
  const outside = document.createElement('button');
  document.body.append(outside);
  outside.focus();
  let reached = 0;
  document.body.addEventListener('touchstart', () => { reached++; });
  const { shell, done } = await screen();
  shell.element.focus();
  shell.element.dispatchEvent(new window.Event('touchstart', { bubbles: true }) as unknown as Event);
  assert.equal(reached, 0, '觸控停在外殼');
  await done();
  assert.equal(shell.element.isConnected, false);
  assert.equal(document.activeElement, outside);
});
