import type { App } from 'obsidian';

// 念這段英文（D-082、D-116）：可以替換的小元件。用瀏覽器的 speechSynthesis、語言 en-US、不指定語音（交給系統挑，
// iPhone 才用得到使用者下載的語音）。筆記與複習紀錄裡都沒有它的痕跡。

export interface Speech {
  /** 依序念這幾段英文；先停掉正在念的。 */
  say(texts: readonly string[]): void;
  stop(): void;
}

export const NO_ENGLISH_VOICE = 'Essence Cards：這台電腦沒有英文語音，可以在系統設定加入英文語音';

/** 系統有沒有英文語音：清單還沒載入（空的）時先當作有，不擋 iPhone 第一次念。 */
function hasEnglishVoice(voices: readonly { lang: string }[]): boolean {
  return voices.length === 0 || voices.some(voice => voice.lang.toLowerCase().startsWith('en'));
}

/** onMissing：找不到英文語音時提示一次（Notice），不用中文語音硬念。 */
export function createSpeech(onMissing: () => void): Speech {
  let warned = false;
  const synth = (): SpeechSynthesis | null => typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  return {
    say(texts) {
      const engine = synth();
      if (!engine) return;
      engine.cancel();
      if (!hasEnglishVoice(engine.getVoices())) {
        if (!warned) { warned = true; onMissing(); }
        return;
      }
      for (const text of texts) {
        if (!text.trim()) continue;
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        engine.speak(utterance);
      }
    },
    stop() { synth()?.cancel(); },
  };
}

/** 自動朗讀開關（D-116）：每台裝置各自記住，存在 Obsidian 的本機儲存（不隨 vault 同步）；新裝置預設關。 */
const AUTO_READ_KEY = 'essence-cards-auto-read';
export function loadAutoRead(app: App): boolean { return app.loadLocalStorage(AUTO_READ_KEY) === true; }
export function saveAutoRead(app: App, on: boolean): void { app.saveLocalStorage(AUTO_READ_KEY, on); }
