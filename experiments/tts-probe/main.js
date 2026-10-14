// Essence TTS Probe：只測系統語音（speechSynthesis）在 Obsidian 裡能不能念、好不好聽。可丟棄。
const { Plugin, ItemView, Platform } = require('obsidian');
const VIEW = 'essence-tts-probe';
const SPEAKER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const CSS = `
:host { display:block; height:100%; color:var(--text-normal); background:var(--background-primary); font:16px/1.65 var(--font-interface, system-ui, sans-serif); }
* { box-sizing:border-box; }
.page { height:100%; overflow:auto; padding:28px 20px 60px; }
.wrap { max-width:560px; margin:auto; }
h1 { font-size:20px; font-weight:600; margin:0 0 4px; letter-spacing:.02em; }
.meta { color:var(--text-faint); font-size:13px; margin:0 0 20px; }
.bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:0 0 28px; font-size:14px; color:var(--text-muted); }
select { font:inherit; font-size:14px; padding:6px 10px; border-radius:8px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); max-width:100%; }
.seg { display:inline-flex; border:1px solid var(--background-modifier-border); border-radius:8px; overflow:hidden; }
.seg button { border:0; background:none; padding:6px 12px; font:inherit; font-size:14px; color:var(--text-muted); min-height:36px; cursor:pointer; }
.seg button[aria-pressed=true] { background:color-mix(in srgb, #7c6bc4 14%, transparent); color:var(--text-normal); }
.card { padding:26px 4px 30px; border-top:1px solid var(--background-modifier-border); }
.path { font-size:12px; color:var(--text-faint); letter-spacing:.06em; margin-bottom:18px; }
.front { font-size:30px; font-weight:500; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.front.sentence { font-size:21px; }
.say { display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; margin:-6px 0; border:0; border-radius:50%; background:none; color:var(--text-faint); cursor:pointer; transition:color .2s, background .2s; }
.say:hover, .say:focus-visible { color:#7c6bc4; background:color-mix(in srgb, #7c6bc4 10%, transparent); outline:none; }
.say.on { color:#7c6bc4; }
.reveal { margin-top:22px; width:100%; min-height:44px; border:1px dashed var(--background-modifier-border); border-radius:10px; background:none; color:var(--text-muted); font:inherit; cursor:pointer; }
.back { margin-top:20px; }
.back[hidden] { display:none; }
.ans { font-size:19px; display:flex; align-items:center; gap:2px; flex-wrap:wrap; }
.ans b { font-weight:600; box-shadow:inset 0 -2px 0 color-mix(in srgb, #7c6bc4 55%, transparent); }
.ex { margin-top:12px; color:var(--text-muted); }
.ex .en { color:var(--text-normal); display:flex; align-items:center; gap:2px; flex-wrap:wrap; }
.typing { display:flex; gap:8px; margin-top:18px; }
input { flex:1; min-width:0; font:inherit; font-size:18px; padding:8px 12px; border-radius:10px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); }
.ok { padding:0 16px; border-radius:10px; border:1px solid var(--background-modifier-border); background:none; color:var(--text-normal); font:inherit; font-size:15px; min-height:44px; cursor:pointer; }
.result { margin-bottom:10px; font-size:15px; color:var(--text-muted); }
.free .typing { margin-top:8px; }
.diag { margin-top:28px; font-size:12px; color:var(--text-faint); white-space:pre-wrap; }
`;

class ProbeView extends ItemView {
  getViewType() { return VIEW; }
  getDisplayText() { return '朗讀測試'; }
  getIcon() { return 'volume-2'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.style.padding = '0';
    const host = this.contentEl.createDiv();
    host.style.height = '100%';
    const root = this.root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><main class="page"><div class="wrap">
      <h1>朗讀測試</h1>
      <p class="meta" id="platform"></p>
      <div class="bar"><span>語音</span><select id="voice"></select>
        <span class="seg" role="group" aria-label="速度"><button data-rate="0.8" aria-pressed="false">慢</button><button data-rate="1" aria-pressed="true">正常</button></span></div>

      <section class="card">
        <div class="path">英文 › 國二上 › L1　英翻中</div>
        <div class="front">borrow<button class="say" data-say="borrow" aria-label="念單字">${SPEAKER}</button></div>
        <button class="reveal" data-for="b1">顯示答案</button>
        <div class="back" id="b1" hidden>
          <div class="ans">v.&nbsp;<b>借入、向別人借</b></div>
          <div class="ex"><div class="en">Can I borrow your pen?<button class="say" data-say="Can I borrow your pen?" aria-label="念例句">${SPEAKER}</button></div>我可以借你的筆嗎？</div>
        </div>
      </section>

      <section class="card">
        <div class="path">英文 › 國二上 › L1　中翻英</div>
        <div class="front sentence">Can I ＿＿ your pen?（借）</div>
        <div class="typing"><input id="typed" placeholder="輸入英文單字" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><button class="ok" id="check">確認</button></div>
        <div class="back" id="b2" hidden>
          <div class="result" id="result"></div>
          <div class="ans"><b>borrow</b><button class="say" data-say="borrow" aria-label="念單字">${SPEAKER}</button></div>
          <div class="ex"><div class="en">Can I borrow your pen?<button class="say" data-say="Can I borrow your pen?" aria-label="念例句">${SPEAKER}</button></div>我可以借你的筆嗎？</div>
        </div>
      </section>

      <section class="card free">
        <div class="path">自己輸入一個字或一句話試念</div>
        <div class="typing"><input id="free" placeholder="例如 comfortable、vegetable" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"><button class="ok" id="freeSay">念</button></div>
      </section>
      <p class="diag" id="diag"></p>
    </div></main>`;

    this.rate = 1;
    const $ = s => root.querySelector(s);
    $('#platform').textContent = `${Platform.isIosApp ? 'iPhone／iPad' : Platform.isAndroidApp ? 'Android' : '電腦'}・系統語音・可丟棄的測試`;
    root.querySelectorAll('.reveal').forEach(b => { b.onclick = () => { root.getElementById(b.dataset.for).hidden = false; b.remove(); }; });
    root.querySelectorAll('.seg button').forEach(b => {
      b.onclick = () => {
        this.rate = Number(b.dataset.rate);
        root.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      };
    });
    root.addEventListener('click', e => { const b = e.target.closest('.say'); if (b) this.say(b.dataset.say, b); });
    $('#check').onclick = () => {
      const typed = $('#typed').value.trim();
      $('#result').textContent = typed.toLowerCase() === 'borrow' ? '✓ 拼對了' : `你打的：${typed || '（空白）'}`;
      $('#b2').hidden = false;
    };
    $('#freeSay').onclick = () => this.say($('#free').value.trim(), null);
    this.loadVoices();
  }

  loadVoices() {
    const diag = this.root.querySelector('#diag');
    if (!('speechSynthesis' in window)) { diag.textContent = '這個環境沒有 speechSynthesis，系統語音不能用。'; return; }
    const fill = () => {
      const all = speechSynthesis.getVoices();
      const en = all.filter(v => /^en/i.test(v.lang));
      en.sort((a, b) => (b.lang === 'en-US') - (a.lang === 'en-US'));
      const sel = this.root.querySelector('#voice');
      const keep = sel.value;
      sel.replaceChildren();
      for (const v of en) {
        const o = document.createElement('option');
        o.value = v.voiceURI;
        o.textContent = `${v.name}（${v.lang}）`;
        sel.appendChild(o);
      }
      if (!en.length) { const o = document.createElement('option'); o.textContent = '沒有英文語音'; sel.appendChild(o); }
      if (keep && en.some(v => v.voiceURI === keep)) sel.value = keep;
      this.voices = en;
      diag.textContent = `語音共 ${all.length} 個，英文 ${en.length} 個。` + (en.length ? '' : '\n這台裝置沒有英文語音：會由系統自己挑，可能用中文口音念。');
    };
    fill();
    speechSynthesis.addEventListener('voiceschanged', fill);
    this.register(() => speechSynthesis.removeEventListener('voiceschanged', fill));
  }

  say(text, btn) {
    if (!text || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = this.rate;
    const uri = this.root.querySelector('#voice').value;
    const v = (this.voices || []).find(x => x.voiceURI === uri);
    if (v) { u.voice = v; u.lang = v.lang; }
    if (btn) btn.classList.add('on');
    u.onend = () => { if (btn) btn.classList.remove('on'); };
    u.onerror = e => {
      if (btn) btn.classList.remove('on');
      this.root.querySelector('#diag').textContent += `\n朗讀失敗：${e.error}`;
    };
    speechSynthesis.speak(u);
  }

  async onClose() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
}

module.exports = class EssenceTtsProbe extends Plugin {
  async onload() {
    this.registerView(VIEW, leaf => new ProbeView(leaf));
    this.addRibbonIcon('volume-2', '朗讀測試', () => this.open());
    this.addCommand({ id: 'open', name: '開啟朗讀測試', callback: () => this.open() });
  }
  async open() {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  onunload() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
};
