import { Notice, Plugin } from 'obsidian';

/** tools/build.mjs 的 define：開發版是 true，正式建置是 false，開發命令整段不進 main.js。 */
declare const DEV: boolean;

export default class EssenceCardsPlugin extends Plugin {
  onload(): void {
    this.addCommand({
      id: 'version',
      name: '版本',
      callback: () => { new Notice('Essence Cards：' + this.manifest.version); },
    });
    if (DEV) void import('./obsidian/dev.ts').then(dev => { dev.registerDev(this); });
  }
}
