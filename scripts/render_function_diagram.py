#!/usr/bin/env python3
"""用 Mermaid CLI 12.0.0 渲染功能圖並內嵌字型，供單檔看板離線閱讀。

需要 mmdc、可執行的 Chromium、PyMuPDF、fontTools 及 Linux fontconfig。
臨時字型設定只傳給渲染程序，不修改系統設定。
"""
import argparse
import base64
from io import BytesIO
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET

import fitz
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
NS = 'http://www.w3.org/2000/svg'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mmdc', default='mmdc')
    parser.add_argument('--browser', type=Path, help='指定現有 Chromium 執行檔')
    args = parser.parse_args()
    subprocess.run(['python3', str(ROOT / 'scripts/build_function_diagram.py')], check=True)
    version = subprocess.check_output([args.mmdc, '--version'], text=True).strip()
    if version != '12.0.0':
        raise ValueError('請使用已核對的 Mermaid CLI 12.0.0；版本變動須重新核對渲染。')
    with tempfile.TemporaryDirectory(prefix='essence-diagram-') as directory:
        temp = Path(directory)
        font_bytes = fitz.Font('cjk').buffer
        (temp / 'cjk.ttf').write_bytes(font_bytes)
        fonts = temp / 'fonts.conf'
        fonts.write_text(f'<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">'
                         f'<fontconfig><include>/etc/fonts/fonts.conf</include><dir>{temp}</dir>'
                         f'<cachedir>{temp}/cache</cachedir></fontconfig>')
        env = dict(os.environ, FONTCONFIG_FILE=str(fonts))
        config = json.loads((ROOT / 'scripts/puppeteer-config.json').read_text())
        if args.browser:
            config['executablePath'] = str(args.browser.resolve())
        browser_config = temp / 'browser.json'
        browser_config.write_text(json.dumps(config))
        svg = temp / 'functions.svg'
        subprocess.run([args.mmdc, '-i', str(ROOT / 'docs/diagrams/essence-cards-functions.mmd'),
                        '-o', str(svg), '-c', str(ROOT / 'scripts/mermaid-config.json'),
                        '-p', str(browser_config), '-b', '#f5f6f1',
                        '--svgId', 'essence-functions'], env=env, check=True)
        value = svg.read_text(encoding='utf-8')
        tree = ET.fromstring(value)
        if tree.findall('.//{' + NS + '}foreignObject'):
            raise ValueError('靜態 SVG 不應依賴 HTML 標籤')
        title = 'B-004 兩個外掛與筆記交接'
        note = 'Cards：輸出／檢核／選用 AI；Capture：後續另 repo 輸入'
        chars = title + note + ''.join(''.join(node.itertext()) for node in tree.iter() if node.tag == '{'+NS+'}text')
        font = TTFont(BytesIO(font_bytes))
        sub = subset.Subsetter(options=subset.Options())
        sub.populate(text=chars)
        sub.subset(font)
        font.flavor = 'woff'
        output = BytesIO()
        font.save(output)
        encoded = base64.b64encode(output.getvalue()).decode('ascii')
        style = ('<style>@font-face{font-family:"Droid Sans Fallback";'
                 'src:url(data:font/woff;base64,' + encoded + ') format("woff");}</style>')
        # Preserve Mermaid's namespace and stable IDs without reserializing XML.
        at = value.index('>') + 1
        value = value[:at] + style + value[at:]
        x, y, width, height = [float(n) for n in tree.attrib['viewBox'].split()]
        value = value.replace('width="100%"', f'width="{width}" height="{height+95}"', 1)
        value = re.sub(r'viewBox="[^"]+"', f'viewBox="{x} {y-95} {width} {height+95}"', value, count=1)
        header = (f'<text x="{x+12}" y="{y-60}" font-family="Droid Sans Fallback" font-size="27" '
                  f'font-weight="bold" fill="#243c36">{title}</text>'
                  f'<text x="{x+12}" y="{y-25}" font-family="Droid Sans Fallback" font-size="18" '
                  f'fill="#64736c">{note}</text>')
        value = value.replace('</svg>', header + '</svg>')
        (ROOT / 'docs/diagrams/essence-cards-functions.svg').write_text(value + '\n', encoding='utf-8')
        print('已渲染功能 SVG，內嵌字型供離線閱讀。')


if __name__ == '__main__':
    main()
