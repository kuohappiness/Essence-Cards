const { Plugin, ItemView, Notice, Platform, TFile, TFolder } = require('obsidian');
const VIEW = 'essence-ui-probe';
const DIR = 'Essence-UI-Probe';
const NOTE = `${DIR}/test.md`;
const IMAGE = `${DIR}/sample.svg`;
const SAMPLE = '# 相容性測試\n\n## 問題\n植物在哪個胞器進行光合作用？\n\n## 答案\n葉綠體。\n';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200" viewBox="0 0 480 200"><rect width="480" height="200" rx="20" fill="#e4f2e7"/><path d="M240 155V90M240 110Q155 105 175 45Q240 45 240 110M240 125Q310 125 315 60Q250 65 240 125" fill="#62a477" stroke="#267045" stroke-width="6"/><text x="240" y="184" text-anchor="middle" font-size="16" fill="#204b33">Vault local image</text></svg>';
const CSS = `
:host { display:block; height:100%; min-height:0; color:#203037; background:#f4f7f5; font:16px/1.6 system-ui,sans-serif; color-scheme:light; }
* { box-sizing:border-box; }
.page { height:100%; overflow:auto; padding:20px; }
.wrap { max-width:780px; margin:auto; }
h1 { font-size:24px; line-height:1.3; margin:0 0 8px; } h2 { font-size:17px; margin:0 0 10px; }
p { margin:8px 0; } small { color:#53636a; } section { background:white; border:1px solid #dce5df; border-radius:16px; padding:16px; margin:14px 0; }
.actions { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }
button,select,textarea { font:inherit; border:1px solid #b8ccc0; border-radius:9px; background:white; color:#203037; max-width:100%; }
button { padding:10px 14px; min-height:44px; cursor:pointer; } button:disabled { opacity:.5; cursor:wait; } button:focus-visible { outline:3px solid #468261; outline-offset:2px; }
.card { width:100%; min-height:150px; background:#eaf3ed; white-space:pre-wrap; overflow-wrap:anywhere; text-align:center; font-size:20px; }
textarea { width:100%; padding:12px; min-height:180px; resize:vertical; } select { width:100%; padding:10px; min-height:44px; }
svg { display:block; width:100%; height:auto; } img,video { display:block; max-width:100%; max-height:280px; margin:12px auto; border-radius:10px; } audio { display:block; width:100%; margin:12px 0; }
#status { white-space:pre-wrap; overflow-wrap:anywhere; } [hidden] { display:none !important; }
@media(max-width:440px) { .page { padding:12px; } section { padding:12px; } h1 { font-size:21px; } }
`;

class ProbeView extends ItemView {
  getViewType() { return VIEW; }
  getDisplayText() { return 'Essence 相容性測試'; }
  getIcon() { return 'flask-conical'; }
  async onOpen() {
    this.contentEl.replaceChildren();
    this.contentEl.style.padding = '0';
    this.contentEl.style.overflow = 'hidden';
    const host = this.contentEl.ownerDocument.createElement('div');
    host.style.height = '100%';
    this.contentEl.appendChild(host);
    this.root = host.attachShadow({ mode: 'open' });
    // 只有固定的測試 UI 使用 HTML；筆記與檔名一律以 textContent/value 放入。
    this.root.innerHTML = `<style>${CSS}</style><main class="page"><div class="wrap">
      <h1>Essence 相容性測試</h1><small id="platform"></small>
      <p>只驗證自訂畫面與本機資料。此原型可完全丟棄。</p>
      <div class="actions"><button id="init">建立測試資料</button><button id="reload">重新讀取</button></div>
      <p id="status" role="status" aria-live="polite">請先建立測試資料，或讀取另一端已建立的資料。</p>
      <section><h2>閃卡：點一下翻面</h2><button id="flip" class="card" aria-label="翻面閃卡" disabled>尚未讀取</button></section>
      <section><h2>心智圖：同一份筆記</h2>
        <svg viewBox="0 0 600 220" role="img" aria-label="問題、答案與筆記的關聯圖">
          <g stroke="#7d9b88" stroke-width="3"><path d="M300 70L155 135M300 70L445 135"/></g>
          <g fill="#eaf3ed" stroke="#bdd0c2"><rect x="200" y="10" width="200" height="60" rx="14"/><rect x="20" y="135" width="270" height="65" rx="14"/><rect x="310" y="135" width="270" height="65" rx="14"/></g>
          <g text-anchor="middle" fill="#203037" font-size="18"><text x="300" y="47">概念筆記</text><text x="155" y="160">問題</text><text id="map-question" x="155" y="187" font-size="15">尚未讀取</text><text x="445" y="160">答案</text><text id="map-answer" x="445" y="187" font-size="15">尚未讀取</text></g>
        </svg><small>固定兩分支示範；長文字會縮短顯示，完整內容見閃卡。</small>
      </section>
      <section><h2>本機多媒體</h2><label for="media">選擇 Vault 附件（圖片／音訊／影片）</label><select id="media"><option value="">請先讀取資料</option></select><div id="media-view"></div><small>sample.svg 是自動建立的圖片；音訊與影片可選現有附件，以實際裝置能解碼的格式為準。</small></section>
      <section><h2>Markdown 讀寫</h2><label for="note">Essence-UI-Probe/test.md</label><textarea id="note" disabled></textarea><div class="actions"><button id="save" disabled>儲存並讀回核對</button></div><small>保留「## 問題」與「## 答案」，修改內容後可檢查另一端。</small></section>
    </div></main>`;
    this.root.querySelector('#platform').textContent = `${Platform.isIosApp ? 'iOS' : Platform.isAndroidApp ? 'Android' : '桌面'} · 外掛 0.0.1 · Obsidian API + 自訂 DOM`;
    this.root.querySelector('#init').onclick = () => this.run(() => this.initialize());
    this.root.querySelector('#reload').onclick = () => this.run(() => this.loadNote());
    this.root.querySelector('#save').onclick = () => this.run(() => this.saveNote());
    this.root.querySelector('#flip').onclick = () => { this.answerSide = !this.answerSide; this.renderCard(); };
    this.root.querySelector('#media').onchange = () => this.showMedia();
  }
  status(message) { if (this.root) this.root.querySelector('#status').textContent = message; }
  async run(action) {
    for (const id of ['init', 'reload', 'save']) this.root.querySelector(`#${id}`).disabled = true;
    try { await action(); }
    catch (error) { this.status(`未通過：${error.message}`); }
    finally {
      if (this.root) for (const id of ['init', 'reload', 'save']) this.root.querySelector(`#${id}`).disabled = id === 'save' && this.loaded === undefined;
    }
  }
  async initialize() {
    const vault = this.app.vault;
    const folder = vault.getAbstractFileByPath(DIR);
    if (folder && !(folder instanceof TFolder)) throw new Error('測試資料夾名稱已被檔案占用。');
    if (!folder) await vault.createFolder(DIR);
    if (!vault.getAbstractFileByPath(NOTE)) await vault.create(NOTE, SAMPLE);
    if (!vault.getAbstractFileByPath(IMAGE)) await vault.createBinary(IMAGE, new TextEncoder().encode(SVG).buffer);
    await this.loadNote();
  }
  file() {
    const file = this.app.vault.getAbstractFileByPath(NOTE);
    if (!(file instanceof TFile)) throw new Error('找不到 test.md，請建立資料或等待同步完成。');
    return file;
  }
  async loadNote() {
    this.loaded = await this.app.vault.read(this.file());
    if (!this.root) return;
    this.root.querySelector('#note').value = this.loaded;
    this.root.querySelector('#note').disabled = false;
    this.root.querySelector('#flip').disabled = false;
    this.updateContent();
    this.listMedia();
    this.status('讀取完成。可翻卡、查看圖片、修改測試筆記；重新開啟外掛後再次讀取。');
  }
  updateContent() {
    const question = /## 問題\s*\n([\s\S]*?)(?=\n## |$)/.exec(this.loaded);
    const answer = /## 答案\s*\n([\s\S]*?)(?=\n## |$)/.exec(this.loaded);
    this.question = question ? question[1].trim() : '缺少「## 問題」';
    this.answer = answer ? answer[1].trim() : '缺少「## 答案」';
    this.answerSide = false;
    this.renderCard();
    const short = value => value.length > 15 ? value.slice(0, 15) + '…' : value;
    this.root.querySelector('#map-question').textContent = short(this.question);
    this.root.querySelector('#map-answer').textContent = short(this.answer);
  }
  renderCard() {
    const button = this.root.querySelector('#flip');
    button.textContent = `${this.answerSide ? '答案' : '問題'}\n${this.answerSide ? this.answer : this.question}`;
    button.setAttribute('aria-pressed', String(this.answerSide));
  }
  async saveNote() {
    const next = this.root.querySelector('#note').value;
    // Vault.process 核對本機新版；不代表可以防止後續雲端併發覆寫。
    await this.app.vault.process(this.file(), current => {
      if (current !== this.loaded) throw new Error('筆記已被其他操作更新，請先重新讀取。');
      return next;
    });
    const readback = await this.app.vault.read(this.file());
    if (readback !== next) throw new Error('讀回與儲存內容不同，請重新讀取檢查。');
    await this.loadNote();
    this.status('儲存及本機讀回核對通過。跨裝置請等待 iCloud 完成後，在另一端按「重新讀取」。');
  }
  listMedia() {
    const select = this.root.querySelector('#media');
    select.replaceChildren();
    const add = (value, title) => { const option = select.ownerDocument.createElement('option'); option.value = value; option.textContent = title; select.appendChild(option); };
    add('', '不顯示附件');
    for (const file of this.app.vault.getFiles().filter(file => /^(svg|png|jpg|jpeg|gif|webp|mp3|wav|m4a|ogg|mp4|webm|mov)$/i.test(file.extension)).sort((a, b) => a.path.localeCompare(b.path))) add(file.path, file.path);
    if (this.app.vault.getAbstractFileByPath(IMAGE) instanceof TFile) select.value = IMAGE;
    this.showMedia();
  }
  showMedia() {
    const container = this.root.querySelector('#media-view');
    container.replaceChildren();
    const path = this.root.querySelector('#media').value;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const tag = /^(mp3|wav|m4a|ogg)$/i.test(file.extension) ? 'audio' : /^(mp4|webm|mov)$/i.test(file.extension) ? 'video' : 'img';
    const el = container.ownerDocument.createElement(tag);
    if (tag === 'img') el.alt = file.path;
    else { el.controls = true; el.preload = 'metadata'; if (tag === 'video') el.setAttribute('playsinline', ''); }
    el.onerror = () => this.status(`附件未能載入：${file.path}。請確認下載完成及裝置支援此格式。`);
    el.src = this.app.vault.getResourcePath(file);
    container.appendChild(el);
  }
  async onClose() { this.root = null; this.contentEl.replaceChildren(); }
}

module.exports = class EssenceUIProbe extends Plugin {
  async onload() {
    this.registerView(VIEW, leaf => new ProbeView(leaf));
    const open = async () => {
      try {
        const leaf = this.app.workspace.getLeavesOfType(VIEW)[0] || this.app.workspace.getLeaf('tab');
        if (leaf.view.getViewType() !== VIEW) await leaf.setViewState({ type: VIEW, active: true });
        await this.app.workspace.revealLeaf(leaf);
      } catch (error) { new Notice(`測試畫面無法開啟：${error.message}`); }
    };
    this.addCommand({ id: 'open', name: '開啟相容性測試', callback: open });
    this.addRibbonIcon('flask-conical', 'Essence 相容性測試', open);
  }
  onunload() { this.app.workspace.getLeavesOfType(VIEW).forEach(leaf => leaf.detach()); }
};
