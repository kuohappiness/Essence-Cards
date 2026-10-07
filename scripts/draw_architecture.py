"""Render the Essence Cards concept architecture as SVG, PNG and PDF.

The SVG embeds a subset CJK font so its text remains editable and portable.
Requires PyMuPDF, reportlab and fontTools; it does not use generated imagery.
"""
from pathlib import Path
from io import BytesIO
import base64
import html
import math
import argparse
import fitz
from fontTools.ttLib import TTFont as FontToolsFont
from fontTools import subset
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

W, H = 2200, 1700
P = dict(bg='#F5F6F1', paper='#FFFFFF', ink='#243D37', muted='#687A72',
         green='#286C59', green_soft='#E7F0E8', line='#D8E2DB', amber='#AA6B2E',
         amber_soft='#FAF0DE', blue='#497B97', blue_soft='#EAF2F8', slate='#899B91')
ROOT = Path(__file__).resolve().parents[1]


class Diagram:
    def __init__(self, out):
        self.out = out
        out.mkdir(parents=True, exist_ok=True)
        font = fitz.Font('cjk')
        self.font_bytes = font.buffer
        font_path = out / '.diagram-cjk.ttf'
        font_path.write_bytes(font.buffer)
        pdfmetrics.registerFont(TTFont('CJK', str(font_path)))
        pdfmetrics.registerFont(TTFont('EN', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
        pdfmetrics.registerFont(TTFont('ENB', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
        self.pdf = canvas.Canvas(str(out / 'Essence-Cards_架構藍圖.pdf'), pagesize=(W/2, H/2))
        self.pdf.setTitle('Essence Cards｜知識學習架構藍圖')
        self.pdf.setAuthor('Essence Cards')
        self.pdf.scale(.5, .5)
        self.parts = []
        self.used = set()
        self.y_offset = 0

    def rect(self, x, y, w, h, fill, stroke=None, radius=16, sw=1.4):
        y += self.y_offset
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke or "none"}" stroke-width="{sw}"/>')
        c = self.pdf
        c.setFillColor(HexColor(fill))
        if stroke:
            c.setStrokeColor(HexColor(stroke))
            c.setLineWidth(sw)
        c.roundRect(x, H-y-h, w, h, radius, fill=1, stroke=bool(stroke))

    def circle(self, x, y, r, fill, stroke=None, sw=1.5):
        y += self.y_offset
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke or "none"}" stroke-width="{sw}"/>')
        c = self.pdf
        c.setFillColor(HexColor(fill))
        if stroke:
            c.setStrokeColor(HexColor(stroke)); c.setLineWidth(sw)
        c.circle(x, H-y, r, fill=1, stroke=bool(stroke))

    def text(self, x, y, value, size=26, color=None, weight=400, en=False, anchor='start', max_width=None):
        y += self.y_offset
        color = color or P['ink']
        font = 'ENB' if en and weight >= 600 else 'EN' if en else 'CJK'
        width = pdfmetrics.stringWidth(value, font, size)
        if max_width is not None and width > max_width:
            raise ValueError(f'Text exceeds available width: {value} ({width:.0f}>{max_width})')
        dx = width/2 if anchor == 'middle' else width if anchor == 'end' else 0
        self.used.update(value)
        family = 'DiagramLatin' if en else 'DiagramCJK'
        self.parts.append(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{html.escape(value)}</text>')
        c = self.pdf
        c.saveState()
        c.setFillColor(HexColor(color)); c.setStrokeColor(HexColor(color))
        t = c.beginText(x-dx, H-y)
        t.setFont(font, size)
        t.setTextRenderMode(0)
        if not en and weight >= 600:
            c.setLineWidth(.35)
            t.setTextRenderMode(2)
        t.textOut(value)
        c.drawText(t)
        c.restoreState()

    def line(self, pts, color=None, width=3, arrow=False, dash=False):
        pts = [(x, y+self.y_offset) for x, y in pts]
        color = color or P['green']
        points = ' '.join(f'{x},{y}' for x, y in pts)
        dashed = ' stroke-dasharray="9 7"' if dash else ''
        self.parts.append(f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"{dashed}/>')
        c = self.pdf
        c.setLineWidth(width); c.setStrokeColor(HexColor(color)); c.setLineCap(1); c.setLineJoin(1)
        c.setDash([9, 7] if dash else [])
        p = c.beginPath(); p.moveTo(pts[0][0], H-pts[0][1])
        for x, y in pts[1:]: p.lineTo(x, H-y)
        c.drawPath(p); c.setDash([])
        if arrow:
            x, y = pts[-1]; px, py = pts[-2]
            angle = math.atan2(y-py, x-px)
            length, half = 15, 6.5
            bx, by = x-length*math.cos(angle), y-length*math.sin(angle)
            triangle = [(x, y), (bx+half*math.sin(angle), by-half*math.cos(angle)),
                        (bx-half*math.sin(angle), by+half*math.cos(angle))]
            self.parts.append('<polygon points="'+' '.join(f'{a:.2f},{b:.2f}' for a,b in triangle)+f'" fill="{color}"/>')
            p = c.beginPath(); p.moveTo(triangle[0][0], H-triangle[0][1])
            for a, b in triangle[1:]: p.lineTo(a, H-b)
            p.close(); c.setFillColor(HexColor(color)); c.drawPath(p, fill=1, stroke=0)

    def label(self, x, y, title, color=None, size=29):
        color = color or P['green']
        self.rect(x, y-29, 5, 33, color, radius=2)
        self.text(x+18, y, title, size, weight=600)

    def card(self, x, y, w, h, fill=None, stripe=None):
        self.rect(x, y+5, w, h, '#EAF0E9', radius=24)
        self.rect(x, y, w, h, fill or P['paper'], P['line'], radius=24)
        if stripe:
            self.rect(x+25, y+26, 4, h-52, stripe, radius=2)

    def save(self):
        self.pdf.showPage(); self.pdf.save()
        font = FontToolsFont(BytesIO(self.font_bytes))
        sub = subset.Subsetter(options=subset.Options())
        sub.populate(text=''.join(sorted(self.used)))
        sub.subset(font); font.flavor = 'woff'
        buffer = BytesIO(); font.save(buffer)
        encoded = base64.b64encode(buffer.getvalue()).decode()
        latin = FontToolsFont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
        sub = subset.Subsetter(options=subset.Options()); sub.populate(text=''.join(sorted(self.used)))
        sub.subset(latin); latin.flavor='woff'; buf=BytesIO(); latin.save(buf)
        encoded_latin = base64.b64encode(buf.getvalue()).decode()
        style = ('<style>@font-face{font-family:DiagramCJK;src:url(data:font/woff;base64,'+encoded+') format("woff");}'
                 '@font-face{font-family:DiagramLatin;src:url(data:font/woff;base64,'+encoded_latin+') format("woff");}</style>')
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc">'
        svg += '<title id="title">Essence Cards 知識學習架構藍圖</title>'
        svg += '<desc id="desc">以輸入、整理、學習、回饋為主軸：來源資料經整理成概念筆記，連接互動教材、記憶卡與考題；作答與學習紀錄支持錯因診斷、補強修訂、主題復盤與間隔複習。回饋依需要帶回整理或學習，形成持續循環。</desc>'
        svg += style + ''.join(self.parts) + '</svg>'
        (self.out / 'Essence-Cards_架構藍圖.svg').write_text(svg, encoding='utf-8')
        doc = fitz.open(self.out / 'Essence-Cards_架構藍圖.pdf')
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
        pix.save(self.out / 'Essence-Cards_架構藍圖.png')
        doc.close()
        (self.out / '.diagram-cjk.ttf').unlink()
        print(f'Created SVG, PDF and {int(W*1.5)} × {int(H*1.5)} PNG.')


def draw(out):
    d = Diagram(out)
    d.rect(0, 0, W, H, P['bg'], radius=0)
    d.rect(82, 48, 27, 37, P['green_soft'], P['green'], radius=5)
    d.rect(91, 53, 27, 37, P['paper'], P['green'], radius=5)
    d.text(138, 88, 'Essence Cards', 48, weight=700, en=True)
    d.text(80, 160, '知識學習架構藍圖', 48, weight=600)
    d.text(80, 212, '輸入、整理、學習、回饋，形成持續改善的學習循環。', 26, P['muted'])
    d.rect(1760, 58, 350, 53, '#E7EEE7', radius=26)
    d.text(1935, 92, '概念架構 v2.1', 23, anchor='middle')
    d.text(2110, 157, '2026.10.07', 20, P['muted'], en=True, anchor='end')

    # Three top-level areas share a baseline. All connectors are straight.
    d.card(80,270,330,700)
    d.card(550,270,570,700)
    d.card(1260,270,850,700)
    d.line([(410,625),(550,625)],width=4,arrow=True)
    d.line([(1120,625),(1260,625)],width=4,arrow=True)
    d.text(480,596,'整理來源',21,P['muted'],anchor='middle')
    d.text(1190,596,'依需要製作',21,P['muted'],anchor='middle')

    # Input: retain source types and traceability.
    d.label(114,334,'輸入',size=40)
    d.text(114,390,'來源資料',29,weight=600)
    d.text(114,430,'貼上・截取・匯入',23,P['muted'])
    source_rows=[('T','文字'),('I','圖片'),('P','PDF'),('A','影音檔'),('W','網頁'),('Y','YouTube'),('C','Podcast')]
    for i,(symbol,title) in enumerate(source_rows):
        y=482+i*51
        d.rect(113,y-28,35,35,P['green_soft'],radius=9)
        d.text(130.5,y-4,symbol,17,P['green'],weight=700,en=True,anchor='middle')
        d.text(168,y,title,27,en=title in {'PDF','YouTube','Podcast'},max_width=205)
    d.rect(113,834,264,91,'#F1F5EF',radius=14)
    d.text(131,870,'保留原文與來源定位',22,P['green'],max_width=228)
    d.text(131,904,'網址、頁碼或時間點',20,P['muted'],max_width=228)

    # Organize: one knowledge base connects sources and learning activities.
    d.label(586,334,'整理',size=40)
    d.rect(586,375,498,116,P['green_soft'],radius=15)
    d.text(610,416,'理解與選取內容',29,weight=600)
    d.text(610,459,'辨識重點・萃取概念・整理關係',23,max_width=450)
    d.line([(835,491),(835,542)],width=3,arrow=True)
    d.text(586,597,'概念筆記',40,weight=600)
    for i,value in enumerate(['有架構的筆記','相似概念關聯','比較表與概念差異']):
        d.circle(594,644+i*48,4,P['green'])
        d.text(614,653+i*48,value,28)
    d.rect(586,814,498,57,'#F1F5EF',radius=12)
    d.text(835,850,'來源可核對・內容可修訂',25,P['green'],anchor='middle')
    d.text(586,917,'依需要選擇整理內容與產出材料',24,P['muted'],max_width=498)

    # Learn: material creation, practice, evaluation and records are grouped.
    d.label(1296,334,'學習',size=40)
    d.rect(1296,365,778,280,'#F2F5F0',radius=16)
    d.text(1320,408,'依需要選擇學習材料',26,weight=600)
    materials=[
        (1320,230,'互動教材',['操作與探索','理解複雜概念','初學或補強時使用'],'#EDF3EB'),
        (1566,230,'記憶卡',['主動回想','熟記關鍵內容','記憶與背誦練習'],'#EDF2F8'),
        (1812,238,'試題／考題閃卡',['依真題、筆記與錯題','情境與變式問題','檢驗理解及應用'],'#FAF2E6')
    ]
    for x,w,title,rows,fill in materials:
        d.rect(x,431,w,185,fill,radius=13)
        d.text(x+17,471,title,25,weight=600,max_width=w-34)
        for i,value in enumerate(rows):
            d.text(x+17,512+i*35,value,22,max_width=w-34)
    d.line([(1458,645),(1458,696)],width=3,arrow=True)
    d.text(1482,678,'練習',21,P['muted'])
    d.rect(1296,696,324,170,P['blue_soft'],radius=16)
    d.text(1319,743,'作答與評量',30,weight=600)
    d.text(1319,791,'回答、查看解析',23,max_width=278)
    d.text(1319,828,'核對評分與修正處',23,max_width=278)
    d.line([(1620,781),(1690,781)],width=3,arrow=True)
    d.rect(1690,696,384,170,'#F0F5F7',radius=16)
    d.text(1713,743,'學習紀錄',30,weight=600)
    for i,value in enumerate(['作答與正誤・提示使用','練習時間・歷次表現','反覆錯因・相關概念']):
        d.text(1713,782+i*31,value,22,max_width=338)
    d.text(1296,917,'材料、題目與紀錄都連回相關概念',24,P['muted'],max_width=778)

    # Feedback is a shared area immediately below its return destinations.
    d.card(550,1135,1560,380,fill='#FCFDFA')
    d.label(586,1194,'回饋',size=40,color=P['blue'])
    d.text(755,1190,'依學習紀錄補強、修訂，並安排下一輪學習。',25,P['muted'])
    d.rect(586,1223,930,252,'#FFF8ED',radius=16)
    d.text(610,1266,'錯因診斷與補強',30,weight=600)
    categories=[('單純忘記','調整複習'),('觀念混淆','補充筆記／教材'),('不會應用','變式練習'),('題目有誤','修正題目／解析')]
    for i,(title,action) in enumerate(categories):
        x=610+i*222
        d.rect(x,1291,206,96,P['amber_soft'],radius=13)
        d.text(x+103,1328,title,25,weight=600,anchor='middle')
        d.text(x+103,1364,action,21,P['amber'],anchor='middle',max_width=190)
    d.text(610,1435,'手機標記疑問 → 電腦核對／補強 → 修訂並結案',25,P['amber'],max_width=882)
    d.rect(1540,1223,534,252,'#F0F6FA',radius=16)
    d.text(1564,1266,'復盤與學習安排',30,weight=600)
    d.text(1564,1320,'間隔複習',25,weight=600)
    d.text(2050,1320,'下次何時再練？',23,P['blue'],anchor='end')
    d.text(1564,1370,'主題復盤',25,weight=600)
    d.text(2050,1370,'下週優先學什麼？',23,P['blue'],anchor='end')
    d.text(1564,1435,'依可用時間調整份量與計畫',24,P['muted'],max_width=486)

    # Separate straight channels carry evidence and the three kinds of return.
    d.line([(835,1135),(835,970)],P['amber'],3.5,arrow=True)
    d.text(859,1054,'回寫筆記／比較表',22,P['amber'])
    d.line([(1360,1135),(1360,970)],P['amber'],3.5,arrow=True)
    d.text(1384,1054,'更新教材／重新出題',22,P['amber'])
    d.line([(1882,970),(1882,1135)],P['slate'],3.5,arrow=True)
    d.text(1858,1090,'依學習紀錄診斷',22,P['muted'],anchor='end')
    d.line([(2070,1135),(2070,970)],P['blue'],3.5,arrow=True)
    d.text(2046,1021,'安排後續學習與複習',22,P['blue'],anchor='end')

    # Shared relations are architecture, without an additional decorative loop.
    d.rect(80,1560,2030,65,'#E8EEE6',radius=17)
    d.text(104,1602,'共用關聯',24,weight=600)
    d.text(255,1602,'來源・概念・教材・題目・作答紀錄',24,P['green'])
    legend=[(1260,P['green'],'學習流'),(1510,P['amber'],'修訂'),(1740,P['blue'],'學習安排')]
    for x,color,title in legend:
        d.line([(x,1595),(x+44,1595)],color,3,arrow=True)
        d.text(x+59,1603,title,23,P['muted'])
    d.text(80,1667,'架構方向已確認；欄位、算法、介面與自動化細節待討論。',21,P['muted'])
    d.text(2110,1667,'ESSENCE CARDS / LEARNING LOOP',16,P['muted'],en=True,anchor='end')
    d.save()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'docs/diagrams')
    draw(parser.parse_args().output)
