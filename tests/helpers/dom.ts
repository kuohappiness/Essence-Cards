import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

/**
 * 用真的 React 加 happy-dom 測畫面（任務說明 §11、里程碑報告 R6 (b)）：每個測試檔是自己的 Node 程序，所以 DOM 的全域變數只活在那個檔。
 * 它沒有版面：getClientRects 永遠是空的，要 Tab 繞圈的測試用 layout() 補上；版面、實際焦點與 iPhone 靠開發命令。
 */

const root = fileURLToPath(new URL('../..', import.meta.url));
const nodeRequire = createRequire(import.meta.url);

/** 建一份 DOM，掛成全域變數；React 看到 IS_REACT_ACT_ENVIRONMENT 才不會抱怨 act。 */
export function installDom(): Window {
  const window = new Window({ url: 'http://localhost/', width: 1024, height: 768 });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLIFrameElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const name of names) {
    const value = (window as unknown as Record<string, unknown>)[name];
    // navigator 在 Node 是 getter，直接指定不會換掉。
    Object.defineProperty(globalThis, name, { value: typeof value === 'function' && !/^[A-Z]/.test(name) ? value.bind(window) : name === 'window' ? window : value, configurable: true, writable: true });
  }
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  return window;
}

/** 讓這個元素有版面（getClientRects 回一個方塊）：FOCUSABLE 的篩選才算它。 */
export function layout(element: Element): void {
  element.getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
}

/**
 * 把畫面的程式（.ts、.tsx）包成 CommonJS 再執行，回傳它的匯出：React 用 node_modules 那一份（和測試共用同一個實例），
 * obsidian 用傳進來的替身。Node 的型別移除不支援 JSX，所以要經 esbuild。
 */
export async function loadUi<T>(entry: string, obsidian: unknown = {}): Promise<T> {
  const result = await build({
    absWorkingDir: root, entryPoints: [entry], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', jsx: 'automatic', write: false, logLevel: 'silent',
    external: ['obsidian', 'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'motion'],
    loader: { '.css': 'empty' },
  });
  const module = { exports: {} as T };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('require', 'module', 'exports', result.outputFiles[0].text) as (require: (name: string) => unknown, module: { exports: T }, exports: T) => void;
  run(name => name === 'obsidian' ? obsidian : nodeRequire(name), module, module.exports);
  return module.exports;
}
