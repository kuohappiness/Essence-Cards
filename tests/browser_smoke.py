"""Exercise the generated file in an installed Chrome/Chromium (no npm required)."""
import html
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
            # Also exercise genuinely disabled browser scripting. There is no JS
            # observation harness here; inspect the dumped DOM for static records.
            path.write_text(source, encoding="utf-8")
            command = [browser, "--headless", "--no-sandbox", "--disable-dev-shm-usage",
                       "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                       f"--user-data-dir={temporary}/profile-{width}-disabled",
                       f"--window-size={width},{height}", "--blink-settings=scriptEnabled=false",
                       "--dump-dom", path.as_uri()]
            result = subprocess.run(command, capture_output=True, text=True, timeout=45)
            static = re.search(r'<div class="stage" id="static-content">(.*?)<div class="stage" id="stage" hidden', result.stdout, re.S)
            if result.returncode or not static or any(f'data-id="{ident}"' not in static[1] for ident in ids):
                raise SystemExit(f"Disabled-script browser failed for {width}: {result.stderr[-2000:]}")
            print(json.dumps(dict(ok=True, mode='scripts-disabled', width=width, records=len(ids))))


if __name__ == "__main__":
    main()
