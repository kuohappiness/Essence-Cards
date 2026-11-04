import test from 'node:test';
import assert from 'node:assert/strict';
import type { App } from 'obsidian';
import { createSpeech, loadAutoRead, saveAutoRead } from '../src/ui/speech.ts';

// 用假的 speechSynthesis 測：念哪幾段、先停掉正在念的、沒有英文語音時（D-082、D-116）。

class Utterance {
  lang = '';
  readonly text: string;
  constructor(text: string) { this.text = text; }
}
function fakeEngine(voices: { lang: string }[]): { spoken: Utterance[]; cancels: number; cancel(): void; speak(u: Utterance): void; getVoices(): { lang: string }[] } {
  return { spoken: [], cancels: 0, cancel() { this.cancels++; }, speak(u) { this.spoken.push(u); }, getVoices: () => voices };
}
function withEngine(engine: ReturnType<typeof fakeEngine>, run: () => void): void {
  const scope = globalThis as unknown as { window?: unknown; SpeechSynthesisUtterance?: unknown };
  scope.window = { speechSynthesis: engine };
  scope.SpeechSynthesisUtterance = Utterance;
  try { run(); } finally {
    delete scope.window;
    delete scope.SpeechSynthesisUtterance;
  }
}

void test('say 先停掉正在念的，再用 en-US 依序念非空白的段落；stop 停掉', () => {
  const engine = fakeEngine([{ lang: 'en-US' }]);
  withEngine(engine, () => {
    const speech = createSpeech(() => { assert.fail('有英文語音，不提示'); });
    speech.say(['went', ' ', 'I went to the park yesterday.']);
    assert.deepEqual(engine.spoken.map(u => [u.text, u.lang]), [['went', 'en-US'], ['I went to the park yesterday.', 'en-US']]);
    assert.equal(engine.cancels, 1);
    speech.stop();
    assert.equal(engine.cancels, 2);
  });
});

void test('沒有英文語音：提示一次，不念；語音清單還沒載入（空的）時當作有', () => {
  const engine = fakeEngine([{ lang: 'zh-TW' }]);
  withEngine(engine, () => {
    let missing = 0;
    const speech = createSpeech(() => { missing++; });
    speech.say(['went']);
    speech.say(['gone']);
    assert.equal(missing, 1);
    assert.deepEqual(engine.spoken, []);
  });
  const loading = fakeEngine([]);
  withEngine(loading, () => {
    createSpeech(() => { assert.fail('清單是空的，不提示'); }).say(['went']);
    assert.equal(loading.spoken.length, 1);
  });
});

void test('沒有 speechSynthesis：say 與 stop 都不拋錯', () => {
  const speech = createSpeech(() => {});
  speech.say(['went']);
  speech.stop();
});

void test('D-186 自動朗讀：沒動過開關的預設開，關過的留在關，再打開也記得', () => {
  const stored = new Map<string, unknown>();
  const app = {
    loadLocalStorage: (key: string) => stored.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => { stored.set(key, value); },
  } as unknown as App;
  assert.equal(loadAutoRead(app), true, '沒動過：開');
  saveAutoRead(app, false);
  assert.equal(loadAutoRead(app), false, '關過：留在關');
  saveAutoRead(app, true);
  assert.equal(loadAutoRead(app), true, '再打開：開');
});
