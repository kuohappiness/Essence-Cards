import { Notice, Plugin } from 'obsidian';

export default class EssenceCardsPlugin extends Plugin {
  onload(): void {
    this.addCommand({
      id: 'version',
      name: '版本',
      callback: () => { new Notice('Essence Cards：' + this.manifest.version); },
    });
  }
}
