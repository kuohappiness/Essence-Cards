"""Exercise the generated file in an installed Chrome/Chromium (no npm required)."""
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_board

CHECK = r"""
<script>
window.addEventListener('error', event => { window.smokeError = event.message; });
setTimeout(() => {
 const passed=[];
 const check=(value,name)=>{if(!value)throw Error(name);passed.push(name)};
 const click=selector=>{const node=document.querySelector(selector);check(!!node,'control '+selector);node.click()};
 try {
  check(!window.smokeError,'no runtime errors');
  check(document.querySelector('#static-content').hidden,'static content hidden after enhancement');
  check(!document.querySelector('#toolbar').hidden&&!document.querySelector('#stage').hidden,'interactive controls ready');
  check(document.querySelectorAll('#board .lane').length===3,'three distinct lanes');
  check(document.querySelector('#board [data-id="I-001"]')?.textContent.includes('參考軟體'),'idea is visible');
  check(document.documentElement.scrollWidth<=innerWidth,'responsive board has no horizontal overflow');
  click('#board [data-id="I-001"]');
  check(document.querySelector('dialog').open,'card dialog opens');
  check(document.querySelector('#detail-body').textContent.includes('使用者原意'),'original idea is readable');
  click('#close-dialog');check(!document.querySelector('dialog').open,'dialog closes');
  click('[data-view="references"]');
  check(document.querySelectorAll('#board.reference-grid article').length===2,'two reference records');
  check(!!document.querySelector('a[href="https://www.memory-toast.com/zh-TW"]'),'Memory Toast source is preserved');
  check(document.documentElement.scrollWidth<=innerWidth,'responsive reference view');
  click('[data-view="blueprints"]');
  const gallery=document.querySelector('#blueprint-gallery');
  check(!gallery.hidden&&document.querySelector('#stage').hidden,'blueprint view opens');
  check(gallery.querySelectorAll('figure').length===3,'three current blueprints');
  check([...gallery.querySelectorAll('img')].every(img=>img.complete&&img.naturalWidth>0),'embedded SVG images load');
  check(gallery.textContent.includes('未 commit')&&gallery.textContent.includes('.gitignore'),'Git design remains readable');
  check(document.documentElement.scrollWidth<=innerWidth,'responsive blueprint view');
  click('[data-view="outline"]');
  check(document.querySelectorAll('#board .detail').length>6,'outline exposes full content');
  check(!document.querySelector('[data-id="T-003"]'),'deferred task excluded');
  click('[data-view="canvas"]');click('#fit');
  const oldTransform=document.querySelector('#board').style.transform;
  click('#zoom-in');
  check(document.querySelector('#board').style.transform!==oldTransform,'zoom changes viewport');
  check(!document.querySelector('#zoom').hidden,'canvas controls available');
  click('[data-view="board"]');
  check(document.querySelector('#board').style.transform==='','regular board restores layout');
  check(!window.smokeError,'no runtime errors after interactions');
  const out=document.createElement('pre');out.id='smoke-results';out.textContent=JSON.stringify({ok:true,checks:passed.length,width:innerWidth});document.body.append(out);
 }catch(error){const out=document.createElement('pre');out.id='smoke-results';out.textContent=JSON.stringify({ok:false,error:error.message,passed});document.body.append(out);}
},200);
</script>
"""


FALLBACK_CHECK = r"""
<script>
setTimeout(() => {
 const check=(value,name)=>{if(!value)throw Error(name)};
 try {
  const root=document.querySelector('#static-content');
  check(!root.hidden&&root.getBoundingClientRect().height>0,'static content visible');
  check(document.querySelector('#toolbar').hidden,'JS controls hidden');
  check(document.querySelector('#stage').hidden,'partial enhancement hidden');
  check(root.querySelectorAll('.lane').length===3,'three current-content lanes');
  const ids=__EXPECTED_IDS__;
  check(root.querySelectorAll('article').length===ids.length,'all records present');
  for(const id of ids){
   const card=root.querySelector('[data-id="'+id+'"]');
   check(!!card&&card.querySelector('.detail').textContent.trim().length>0,'full body '+id);
   check(card.getBoundingClientRect().height>0,'readable '+id);
   check(getComputedStyle(card.querySelector('.detail')).overflow!=='hidden','untruncated '+id);
  }
  check(document.querySelector('#meta').textContent.includes('共識 v'),'metadata present');
  check(root.querySelector('a[href="https://www.memory-toast.com/zh-TW"]'),'reference source preserved');
  check(!root.querySelector('details, [hidden], [data-id="T-003"]'),'no collapsed or deferred records');
  check(document.documentElement.scrollWidth<=innerWidth,'responsive static content');
  const out=document.createElement('pre');out.id='smoke-results';out.textContent=JSON.stringify({ok:true,width:innerWidth,records:ids.length});document.body.append(out);
 }catch(error){const out=document.createElement('pre');out.id='smoke-results';out.textContent=JSON.stringify({ok:false,error:error.message});document.body.append(out);}
},200);
</script>
"""


class DOMParser(HTMLParser):
    """Inspect browser DOM output without depending on attribute serialization."""
    VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
                 "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, document):
        super().__init__(convert_charrefs=True)
        self.nodes = []
        self.stack = []
        self.feed(document)

    def handle_starttag(self, tag, attrs):
        node = dict(tag=tag, attrs=dict(attrs), text=[], parents=list(self.stack))
        self.nodes.append(node)
        if tag not in self.VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break

    def handle_data(self, text):
        for node in self.stack:
            node["text"].append(text)

    def by_id(self, ident):
        return next((node for node in self.nodes if node["attrs"].get("id") == ident), None)

    def within(self, root):
        return [node for node in self.nodes if any(parent is root for parent in node["parents"])]


def no_script_page(source):
    # The policy appears before every application script. The canary would
    # execute immediately if Chrome ignored it, independently of board success.
    policy = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">'
    canary = ('<script id="execution-canary">'
              'document.documentElement.setAttribute("data-script-canary", "executed");'
              '</script>')
    return source.replace("<head>", "<head>\n" + policy + "\n" + canary, 1)


def inspect_no_script_dom(document, expected_document):
    dom, expected = DOMParser(document), DOMParser(expected_document)
    root = dom.by_id("static-content")
    toolbar, stage = dom.by_id("toolbar"), dom.by_id("stage")
    html_node = next((node for node in dom.nodes if node["tag"] == "html"), None)
    children = dom.within(root) if root else []
    cards = {node["attrs"].get("data-id"): node for node in children if node["tag"] == "article"}
    expected_root = expected.by_id("static-content")
    expected_cards = {node["attrs"].get("data-id"): node for node in expected.within(expected_root)
                      if node["tag"] == "article"}

    def body_text(parser, card):
        detail = next((node for node in parser.within(card)
                       if "detail" in node["attrs"].get("class", "").split()), None)
        return "".join(detail["text"]) if detail else None

    missing = sorted(set(expected_cards) - set(cards))
    altered = [ident for ident in expected_cards if ident in cards
               and body_text(dom, cards[ident]) != body_text(expected, expected_cards[ident])]
    altered_cards = [ident for ident in expected_cards if ident in cards
                     and "".join(cards[ident]["text"]) != "".join(expected_cards[ident]["text"])]
    meta, expected_meta = dom.by_id("meta"), expected.by_id("meta")
    hidden = [node["attrs"].get("data-id") or node["attrs"].get("id") or node["tag"]
              for node in children if "hidden" in node["attrs"] or node["tag"] == "details"]
    policies = [node["attrs"].get("content") for node in dom.nodes if node["tag"] == "meta"
                and node["attrs"].get("http-equiv", "").lower() == "content-security-policy"]
    state = dict(static_present=root is not None,
                 static_hidden=root is None or "hidden" in root["attrs"],
                 toolbar_hidden=toolbar is not None and "hidden" in toolbar["attrs"],
                 stage_hidden=stage is not None and "hidden" in stage["attrs"],
                 canary_executed=html_node is not None and "data-script-canary" in html_node["attrs"],
                 canary_present=dom.by_id("execution-canary") is not None,
                 csp_present="script-src 'none'" in policies,
                 metadata_intact=meta is not None and meta["text"] == expected_meta["text"],
                 records=len(cards), expected_records=len(expected_cards), missing=missing,
                 altered_bodies=altered, altered_cards=altered_cards, hidden_or_collapsed=hidden)
    state["ok"] = (state["static_present"] and not state["static_hidden"]
                   and state["toolbar_hidden"] and state["stage_hidden"]
                   and not state["canary_executed"] and state["canary_present"]
                   and state["csp_present"] and len(cards) == len(expected_cards)
                   and state["metadata_intact"] and not missing and not altered
                   and not altered_cards and not hidden)
    return state


def main():
    browser = next((shutil.which(name) for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser") if shutil.which(name)), None)
    if not browser:
        raise SystemExit("Chrome/Chromium is required; GitHub ubuntu-latest provides Chrome.")
    source = build_board.render()
    data = build_board.collect()
    ids = [card["id"] for key in ("ideas", "tasks", "consensus", "references") for card in data[key]]
    fallback_check = FALLBACK_CHECK.replace('__EXPECTED_IDS__', json.dumps(ids))
    variants = {
        'interactive': (source, CHECK),
        # Suppress all application scripts, leaving only the observation harness.
        'scripts-suppressed': (re.sub(r'<script\b[^>]*>.*?</script>', '', source, flags=re.S), fallback_check),
        'invalid-data': (re.sub(r'(<script id="board-data"[^>]*>).*?(</script>)', r'\1{invalid JSON\2', source, flags=re.S), fallback_check),
        'initial-render-fails': (source.replace('board.replaceChildren();', "board.replaceChildren();throw Error('Injected initialization failure');", 1), fallback_check),
    }
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "board-smoke.html"
        for width, height in ((1366, 960), (390, 844)):
            for mode, (page, harness) in variants.items():
                path.write_text(page.replace("</body>", harness + "</body>"), encoding="utf-8")
                command = [browser, "--headless", "--no-sandbox", "--disable-dev-shm-usage",
                           "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                           f"--user-data-dir={temporary}/profile-{width}-{mode}",
                           f"--window-size={width},{height}", "--virtual-time-budget=3000",
                           "--dump-dom", path.as_uri()]
                result = subprocess.run(command, capture_output=True, text=True, timeout=45)
                match = re.search(r'<pre id="smoke-results">(.*?)</pre>', result.stdout, re.S)
                if result.returncode or not match:
                    raise SystemExit(f"Browser failed for {width}/{mode}: {result.stderr[-2000:]}")
                report = json.loads(html.unescape(match[1]))
                report['mode'] = mode
                print(json.dumps(report, ensure_ascii=False))
                if not report["ok"]:
                    raise SystemExit(1)
            # Browser-enforced script blocking, with no executable observer.
            # Parse the dumped DOM and confirm the execution canary was blocked.
            path.write_text(no_script_page(source), encoding="utf-8")
            command = [browser, "--headless", "--no-sandbox", "--disable-dev-shm-usage",
                       "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                       f"--user-data-dir={temporary}/profile-{width}-disabled",
                       f"--window-size={width},{height}", "--virtual-time-budget=3000",
                       "--dump-dom", path.as_uri()]
            result = subprocess.run(command, capture_output=True, text=True, timeout=45)
            report = inspect_no_script_dom(result.stdout, source)
            report.update(mode='scripts-blocked-csp', width=width, returncode=result.returncode)
            if result.returncode or not report["ok"]:
                raise SystemExit(f"Script-blocked browser failed: {json.dumps(report)}; "
                                 f"DOM bytes={len(result.stdout)}; stderr tail={result.stderr[-500:]}")
            print(json.dumps(report))


if __name__ == "__main__":
    main()

