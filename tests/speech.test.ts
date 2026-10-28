import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeech } from '../src/ui/speech.ts';

// D-145：只剩一個自評時，等語音念完答案與例句再換下一張（whenIdle）。用假的 speechSynthesis 測：念完、被停掉、舊的段落晚回報、取消。

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

void test('whenIdle：沒在念時馬上回報；念兩段要兩段都念完才回報；上一次 say 的段落晚回報不算；stop 取消等待、不算念完（Codex 審查 F1）', () => {
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
    assert.equal(idle, 2, 'stop：取消等待，不呼叫（關掉畫面、切到背景不能因此換卡）');
    engine.spoken[3].onend?.();
    assert.equal(idle, 2, '被停掉的段落晚回報也不呼叫');
    speech.whenIdle(() => { idle++; });
    assert.equal(idle, 3, 'stop 之後沒在念：新的等待馬上回報');

    speech.say(['gone']);
    const cancel = speech.whenIdle(() => { idle++; });
    cancel();
    engine.spoken[4].onend?.();
    assert.equal(idle, 3, '取消的等待念完也不呼叫');
  } finally {
    delete scope.window;
    delete scope.SpeechSynthesisUtterance;
  }
});
