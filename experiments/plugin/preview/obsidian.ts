export class Component {
  private cleanups: (() => void)[] = [];
  load() {}
  register(fn: () => void) { this.cleanups.push(fn); }
  registerInterval(id: number) { this.register(() => clearTimeout(id)); return id; }
  unload() { this.cleanups.splice(0).forEach(fn => fn()); }
}
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const MarkdownRenderer = {
  async render(_app: unknown, text: string, el: HTMLElement) {
    el.innerHTML = text.split('\n\n').map(p => p === '---' ? '<hr>' : '<p>' + escape(p).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/==(.+?)==/g, '<mark>$1</mark>').replace(/!\[\[(.+?)\]\]/g, (_, name: string) => name.endsWith('.wav') ? '<audio controls preload="metadata" src="' + assets[name] + '"></audio>' : '<img alt="' + name + '" src="' + assets[name] + '">').replaceAll('\n', '<br>') + '</p>').join('');
  }
};
export const assets: Record<string, string> = {};
export const apiVersion = 'preview';
export const Platform = { isIosApp: false, isAndroidApp: false, isMobileApp: false };
