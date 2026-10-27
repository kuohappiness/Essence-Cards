import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { ReviewProps } from '../../src/ui/Review.tsx';

/**
 * 複習畫面元件的替身（Codex L2 審查 F1、F3、F7 的做法）：esbuild 把 src/ui/Review.tsx 包成 CommonJS，react、react/jsx-runtime、
 * motion 換成這裡的替身，./Markdown.tsx 換成不畫東西的元件（Obsidian 的渲染不在 Node）。只跑一個根元件：useState、useRef、
 * useEffect、useLayoutEffect、useSyncExternalStore 照 React 的規則（effect 照宣告順序、deps 沒變不跑、先跑全部的 cleanup 再跑
 * 新的），子元件（Card、Actions、Done…）沒有 hook，直接展開成樹。
 * 不是瀏覽器：沒有 DOM、版面、焦點移動與真的動畫；那些在 Windows 版 Obsidian 用開發命令 ui 驗。
 */

const root = fileURLToPath(new URL('../..', import.meta.url));

/** 展開後的元素：type 是標籤名稱（Markdown 是 'markdown'）。 */
interface Host { type: string; props: Record<string, unknown>; children: Node[] }
type Node = Host | string;
interface Element { type: unknown; props: Record<string, unknown>; key: unknown }

interface Ref { current: unknown }
interface Effect { layout: boolean; deps: readonly unknown[] | undefined; create: () => unknown; cleanup: (() => void) | undefined; pending: boolean }
type Slot = { kind: 'state'; value: unknown } | { kind: 'ref'; ref: Ref } | { kind: 'effect'; effect: Effect } | { kind: 'store'; unsubscribe: () => void };

let code: Promise<string> | null = null;
/** 包一次就好（每個測試檔一次，約 0.1 秒）。 */
function bundle(): Promise<string> {
  code ??= build({
    absWorkingDir: root, entryPoints: ['src/ui/Review.tsx'], bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
    external: ['react', 'react/jsx-runtime', 'react-dom', 'motion', 'obsidian'],
    plugins: [{
      name: 'markdown-stub',
      setup(builder) {
        builder.onResolve({ filter: /\/Markdown\.tsx$/ }, () => ({ path: 'markdown', namespace: 'stub' }));
        // 打字卡的空格（onSlot）當作已經渲染好：交回同一個假的元素，輸入框就畫進空格（createPortal 的替身原地畫成 'portal'）。
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: "import { jsx } from 'react/jsx-runtime'; const slot = { slot: true }; export function Markdown(props) { props.onSlot?.(slot); return jsx('markdown', props); }", loader: 'js',
        }));
      },
    }],
  }).then(result => result.outputFiles[0].text);
  return code;
}

const sameDeps = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

export interface ReviewUi {
  /** 最近一次 render 的根元素（.ec-app）。 */
  root(): Host;
  /** className 含這個 class 的元素，照樹的順序。 */
  find(className: string): Host[];
  /** 元素底下的文字。 */
  text: (node: Node) => string;
  /** 在 .ec-app 上按鍵；target 是 input 時當成在輸入框裡按。 */
  key(key: string, target?: 'app' | 'input'): void;
  /** 點那個元素（onClick）。 */
  click(element: Host): void;
  /** 等 Promise、requestAnimationFrame 跑完，再把該重畫的畫完。 */
  settle(): Promise<void>;
  /** Motion 的替身：hold 時動畫停在半路，release() 才結束。 */
  motion: { hold: boolean; release(): void; calls: number };
  unmount(): void;
}

/** 畫出 Review（props 照 host.tsx 傳的那些）。 */
export async function renderReview(props: ReviewProps): Promise<ReviewUi> {
  const slots: Slot[] = [];
  let cursor = 0;
  let rendering: 'root' | 'child' | null = null;
  let dirty = false;
  let mounted = true;
  let tree: Host | null = null;
  const elements = new WeakMap<Ref, unknown>();
  const doc = { activeElement: null as unknown };
  const element = (): unknown => {
    const el = { style: {}, scrollTop: 0, focus() { doc.activeElement = el; }, contains: () => true, addEventListener() {}, removeEventListener() {} };
    return el;
  };

  function slot<T extends Slot>(create: () => T): T {
    if (rendering !== 'root') throw Error('替身只支援根元件的 hook：子元件不能用 hook');
    if (cursor === slots.length) slots.push(create());
    return slots[cursor++] as T;
  }
  function useEffectStub(layout: boolean, create: () => unknown, deps?: readonly unknown[]): void {
    const { effect } = slot(() => ({ kind: 'effect', effect: { layout, deps: undefined, create, cleanup: undefined, pending: true } }) as const);
    if (effect.pending || !sameDeps(effect.deps, deps)) { effect.pending = true; effect.create = create; }
    effect.deps = deps;
  }
  const react = {
    useState(initial: unknown) {
      const state = slot(() => ({ kind: 'state', value: typeof initial === 'function' ? (initial as () => unknown)() : initial }) as const);
      const set = (next: unknown): void => {
        const value = typeof next === 'function' ? (next as (old: unknown) => unknown)(state.value) : next;
        if (mounted && !Object.is(value, state.value)) { state.value = value; dirty = true; }
      };
      return [state.value, set];
    },
    useRef: (initial: unknown) => slot(() => ({ kind: 'ref', ref: { current: initial } }) as const).ref,
    useEffect: (create: () => unknown, deps?: readonly unknown[]) => { useEffectStub(false, create, deps); },
    useLayoutEffect: (create: () => unknown, deps?: readonly unknown[]) => { useEffectStub(true, create, deps); },
    useSyncExternalStore(subscribe: (listener: () => void) => () => void, snapshot: () => unknown) {
      slot(() => ({ kind: 'store', unsubscribe: subscribe(() => { dirty = true; }) }) as const);
      return snapshot();
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>, key?: unknown): Element => ({ type, props, key });
  const runtime = { jsx, jsxs: jsx, Fragment: 'fragment' };
  const motion = {
    hold: false, calls: 0, waiting: [] as (() => void)[],
    animate(): Promise<void> {
      motion.calls++;
      if (!motion.hold) return Promise.resolve();
      return new Promise(resolve => { motion.waiting.push(resolve); });
    },
    release() { for (const resolve of motion.waiting.splice(0)) resolve(); },
  };

  const module = { exports: {} as { Review: (props: ReviewProps) => Element } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('require', 'module', 'exports', 'document', 'window', 'getComputedStyle', 'DOMMatrix', 'requestAnimationFrame', 'matchMedia', await bundle()) as (...args: unknown[]) => void;
  run((name: string) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return runtime;
    if (name === 'motion') return motion;
    if (name === 'react-dom') return { createPortal: (children: unknown) => jsx('portal', { children }) };
    throw Error('畫面替身沒有這個模組：' + name);
  }, module, module.exports, doc, { setTimeout, clearTimeout }, () => ({ transform: 'none' }), class { m41 = 0; },
  (callback: (time: number) => void) => setImmediate(() => { callback(performance.now()); }), undefined);
  const { Review } = module.exports;

  function expand(node: unknown): Node[] {
    if (node === null || node === undefined || typeof node === 'boolean') return [];
    if (typeof node === 'string' || typeof node === 'number') return [String(node)];
    if (Array.isArray(node)) return node.flatMap(expand);
    const { type, props } = node as Element;
    if (typeof type === 'function') return expand((type as (p: unknown) => unknown)(props));
    const ref = props.ref as Ref | undefined;
    if (ref && typeof ref === 'object') {
      if (!elements.has(ref)) elements.set(ref, element());
      ref.current = elements.get(ref);
    }
    const children = expand(props.children);
    return type === 'fragment' ? children : [{ type: type as string, props, children }];
  }
  function commit(layout: boolean): void {
    const effects = slots.flatMap(s => s.kind === 'effect' && s.effect.layout === layout && s.effect.pending ? [s.effect] : []);
    for (const effect of effects) { effect.cleanup?.(); effect.cleanup = undefined; }
    for (const effect of effects) {
      effect.pending = false;
      const cleanup = effect.create();
      effect.cleanup = typeof cleanup === 'function' ? cleanup as () => void : undefined;
    }
  }
  function render(): void {
    rendering = 'root'; cursor = 0; dirty = false;
    const output = Review(props);
    rendering = 'child';
    tree = expand(output)[0] as Host;
    rendering = null;
    commit(true);
    commit(false);
  }
  function flush(): void {
    for (let i = 0; dirty && mounted; i++) {
      if (i > 50) throw Error('一直重畫：effect 裡的 setState 沒有停下來');
      render();
    }
  }
  render();
  flush();

  const walk = (node: Node): Host[] => typeof node === 'string' ? [] : [node, ...node.children.flatMap(walk)];
  const text = (node: Node): string => typeof node === 'string' ? node : node.children.map(text).join('');
  const current = (): Host => { if (!tree) throw Error('還沒畫'); return tree; };
  return {
    root: current,
    find: className => walk(current()).filter(node => typeof node.props.className === 'string' && node.props.className.split(' ').includes(className)),
    text,
    key(key, target = 'app') {
      const event = {
        key, shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {},
        target: { matches: (selector: string) => target === 'input' && selector === 'input', closest: () => null },
      };
      (current().props.onKeyDown as (e: unknown) => void)(event);
      flush();
    },
    click(host) {
      // target 是點到的空白處（不是按鈕裡面的字）：卡片空白處的點擊才會翻面。
      (host.props.onClick as (e: unknown) => void)({ target: { closest: () => null } });
      flush();
    },
    async settle() {
      for (let i = 0; i < 10; i++) { await new Promise(resolve => setImmediate(resolve)); flush(); }
    },
    motion: {
      get hold() { return motion.hold; }, set hold(on) { motion.hold = on; },
      release() { motion.release(); },
      get calls() { return motion.calls; },
    },
    unmount() {
      mounted = false;
      for (const s of slots) {
        if (s.kind === 'effect') s.effect.cleanup?.();
        if (s.kind === 'store') s.unsubscribe();
      }
    },
  };
}
