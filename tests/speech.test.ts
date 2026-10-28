import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech } from '../src/ui/speech.ts';

// D-145：只剩一個自評時，等語音念完答案與例句再換下一張（whenIdle）。用假的 speechSynthesis 測：念完、被停掉、舊的段落晚回報。

class Utterance {
  lang = '';
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly text: string;
  constructor(text: string) { this.text = text; }
}
function fakeEngine(): { spoken: Utterance[]; cancel(): void; speak(u: Utterance): void; getVoices(): { lang: string }[] } {
  return { spoken: [], cancel() {}, speak(u) { this.spoken.push(u); }, getVoices: () => [{ lang: 'en-US' }] };
}

void test('whenIdle：沒在念時馬上回報；念兩段要兩段都念完才回報；stop 也算念完；上一次 say 的段落晚回報不算', () => {
  const engine = fakeEngine();
  const scope = globalThis as unknown as { window?: unknown; SpeechSynthesisUtterance?: unknown };
  scope.window = { speechSynthesis: engine };
  scope.SpeechSynthesisUtterance = Utterance;
  try {
    const speech = createSpeech(() => {});
    let idle = 0;
    speech.whenIdle(() => { idle++; });
    assert.equal(idle, 1, '沒在念：馬上');

    speech.say(['went', 'I went to the park yesterday.']);
    speech.whenIdle(() => { idle++; });
    assert.equal(idle, 1, '還在念');
    engine.spoken[0].onend?.();
    assert.equal(idle, 1, '念完第一段還不算');
    engine.spoken[1].onend?.();
    assert.equal(idle, 2, '兩段都念完');

    speech.say(['borrow']);
    const old = engine.spoken[2];
    speech.whenIdle(() => { idle++; });
    speech.say(['lend']);
    old.onerror?.();
    assert.equal(idle, 2, '被新的 say 取消的段落晚回報：不算念完');
    speech.stop();
    assert.equal(idle, 3, 'stop：算念完');
  } finally {
    delete scope.window;
    delete scope.SpeechSynthesisUtterance;
  }
});
