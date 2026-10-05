"""Exercise the generated file in an installed Chrome/Chromium (no npm required)."""
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CHECK = r"""
<script>
window.addEventListener('error', event => { window.smokeError = event.message; });
setTimeout(() => {
 const passed=[];
 const check=(value,name)=>{if(!value)throw Error(name);passed.push(name)};
 const click=selector=>{const node=document.querySelector(selector);check(!!node,'control '+selector);node.click()};
 try {
  check(!window.smokeError,'no runtime errors');
  check(document.querySelectorAll('.lane').length===3,'three distinct lanes');
  check(document.querySelector('[data-id="I-001"]')?.textContent.includes('參考軟體'),'idea is visible');
  check(document.documentElement.scrollWidth<=innerWidth,'responsive board has no horizontal overflow');
  click('[data-id="I-001"]');
  check(document.querySelector('dialog').open,'card dialog opens');
  check(document.querySelector('#detail-body').textContent.includes('使用者原意'),'original idea is readable');
  click('#close-dialog');check(!document.querySelector('dialog').open,'dialog closes');
  click('[data-view="references"]');
  check(document.querySelectorAll('.reference-grid article').length===2,'two reference records');
  check(!!document.querySelector('a[href="https://www.memory-toast.com/zh-TW"]'),'Memory Toast source is preserved');
  check(document.documentElement.scrollWidth<=innerWidth,'responsive reference view');
  click('[data-view="outline"]');
  check(document.querySelectorAll('.detail').length>6,'outline exposes full content');
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


def main():
    browser = next((shutil.which(name) for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser") if shutil.which(name)), None)
    if not browser:
        raise SystemExit("Chrome/Chromium is required; GitHub ubuntu-latest provides Chrome.")
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "board-smoke.html"
        source = (ROOT / "index.html").read_text(encoding="utf-8")
        path.write_text(source.replace("</body>", CHECK + "</body>"), encoding="utf-8")
        for width, height in ((1366, 960), (390, 844)):
            result = subprocess.run([browser, "--headless", "--no-sandbox", "--disable-dev-shm-usage",
                                     "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                                     f"--user-data-dir={temporary}/profile-{width}",
                                     f"--window-size={width},{height}", "--virtual-time-budget=3000",
                                     "--dump-dom", path.as_uri()], capture_output=True, text=True, timeout=45)
            match = re.search(r'<pre id="smoke-results">(.*?)</pre>', result.stdout, re.S)
            if result.returncode or not match:
                raise SystemExit(f"Browser failed for {width}: {result.stderr[-2000:]}")
            report = json.loads(html.unescape(match[1]))
            print(json.dumps(report, ensure_ascii=False))
            if not report["ok"]:
                raise SystemExit(1)


if __name__ == "__main__":
    main()
