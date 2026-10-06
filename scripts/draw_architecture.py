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

W, H = 2400, 1780
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
    # Header and restrained wordmark.
    d.rect(92, 49, 27, 37, P['green_soft'], P['green'], radius=5)
    d.rect(101, 54, 27, 37, P['paper'], P['green'], radius=5)
    d.text(148, 89, 'Essence Cards', 48, weight=700, en=True)
    d.text(90, 161, '知識學習架構藍圖', 48, weight=600)
    d.text(611, 158, '從來源資料到理解、記憶與應用', 25, P['muted'])
    d.rect(1950, 66, 360, 53, '#E7EEE7', radius=26)
    d.text(2130, 100, '概念架構 v1.2', 23, anchor='middle')
    d.text(2310, 161, '2026.10.06', 20, P['muted'], en=True, anchor='end')

    # Learning loop overview; feedback can revisit organizing or learning.
    d.rect(90,198,2220,163,'#E8EEE6',radius=20)
    centers=[245,770,1400,2025]
    for i,(x,title) in enumerate(zip(centers,['輸入','整理','學習','回饋'])):
        color=P['blue'] if title=='回饋' else P['green']
        d.rect(x-130,216,260,60,P['paper'],radius=20)
        d.text(x,257,title,34,color,weight=600,anchor='middle')
        if i:
            d.line([(centers[i-1]+130,246),(x-130,246)],P['green'],3,arrow=True)
    d.line([(2025,276),(2025,319),(770,319),(770,276)],P['blue'],2.5,arrow=True)
    d.line([(1400,319),(1400,276)],P['blue'],2.5,arrow=True)
    d.rect(965,297,375,43,'#E8EEE6',radius=8)
    d.text(1152.5,325,'依需要回到整理或學習',23,P['blue'],anchor='middle')
    d.y_offset = 180

    # Forward flow, with space reserved for feedback routes.
    for left, right in ((400,480),(1060,1140),(1660,1740)):
        d.line([(left,587),(right,587)], width=4, arrow=True)
    d.text(1100, 558, '依需求', 20, P['muted'], anchor='middle')
    d.text(1700, 558, '作答', 20, P['muted'], anchor='middle')

    # Source inputs.
    d.card(90,280,310,600)
    d.label(122,336,'來源輸入',size=30)
    d.text(122,377,'貼上・截取・匯入',23,P['muted'])
    source_rows=[('T','文字'),('I','圖片'),('P','PDF'),('A','影音檔'),('W','網頁'),('Y','YouTube'),('C','Podcast')]
    for i,(symbol,title) in enumerate(source_rows):
        y=430+i*57
        d.rect(121,y-28,35,35,P['green_soft'],radius=9)
        d.text(138.5,y-4,symbol,17,P['green'],weight=700,en=True,anchor='middle')
        d.text(175,y,title,27,en=title in {'PDF','YouTube','Podcast'},max_width=192)
    d.text(122,852,'保留原文與來源定位',20,P['muted'])

    # Process choices and shared conceptual base.
    d.card(480,280,580,600)
    d.label(516,336,'整理與知識基礎',size=30)
    d.rect(516,370,508,121,P['green_soft'],radius=15)
    d.text(540,412,'資料整理',28,weight=600)
    d.text(540,451,'辨識內容・選取重點・萃取概念',24,max_width=462)
    d.line([(770,491),(770,533)],width=3,arrow=True)
    d.text(516,582,'概念筆記',40,weight=600)
    for i,value in enumerate(['有架構的筆記','相似概念關聯','比較表與概念差異']):
        d.circle(524,627+i*45,4,P['green'])
        d.text(544,635+i*45,value,27)
    d.rect(516,758,508,54,'#F1F5EF',radius=12)
    d.text(770,792,'來源可核對・內容可修訂',24,P['green'],anchor='middle')
    d.text(516,851,'依需要選擇整理與產出哪些材料',23,P['muted'])

    # Materials and practice are related, not mandatory outputs.
    d.card(1140,280,520,600)
    d.label(1176,336,'學習材料',size=30)
    d.rect(1176,370,448,136,'#EDF3EB',radius=15)
    d.text(1201,414,'互動式教材',30,weight=600)
    d.text(1201,454,'操作與探索，理解複雜概念',24,max_width=399)
    d.text(1201,486,'可在初學或補強時使用',21,P['muted'])
    d.rect(1176,523,448,108,'#EDF2F8',radius=15)
    d.text(1201,565,'記憶卡',30,weight=600)
    d.text(1201,606,'主動回想需要熟記的內容',24,max_width=399)
    d.rect(1176,648,448,168,'#FAF2E6',radius=15)
    d.text(1201,692,'試題／考題閃卡',29,weight=600)
    d.text(1201,737,'根據真題、筆記與歷次錯題',23,max_width=398)
    d.text(1201,778,'情境與變式，檢驗理解及應用',23,max_width=398)
    d.text(1176,852,'材料與題目連回相關概念',23,P['muted'])

    # Evidence, rather than a single mastery percentage.
    d.card(1740,280,570,600)
    d.text(1776,334,'作答・評量・紀錄',30,weight=600)
    d.rect(1776,370,498,126,P['blue_soft'],radius=15)
    d.text(1800,415,'評分與回饋',30,weight=600)
    d.text(1800,456,'指出本次回答的正確與待修正處',24,max_width=450)
    d.line([(2025,496),(2025,536)],P['slate'],width=3,arrow=True)
    d.text(1776,581,'學習紀錄',40,weight=600)
    rows=['作答內容・正確與錯誤','提示使用・反覆錯因','練習時間・歷次表現']
    for i,value in enumerate(rows):
        d.circle(1784,627+i*45,4,P['blue'])
        d.text(1804,635+i*45,value,27)
    d.rect(1776,758,498,54,'#F0F5F7',radius=12)
    d.text(2025,792,'每筆紀錄連回題目與概念',24,P['blue'],anchor='middle')
    d.text(1776,851,'保存證據，支持下一輪學習判斷',23,P['muted'])

    # Fork from evidence into two feedback functions.
    d.line([(2025,880),(2025,973),(1030,973),(1030,1050)],P['slate'],3.5,arrow=True)
    d.line([(2025,973),(2025,1050)],P['slate'],3.5,arrow=True)
    d.circle(2025,973,5,P['slate'])
    d.text(1635,1008,'依學習紀錄分析',23,P['muted'],anchor='middle')

    # Diagnosis and proposed edits.
    d.card(480,1050,1100,330,fill='#FFFDF8')
    d.label(516,1108,'錯因診斷與補強',size=32,color=P['amber'])
    categories=[('單純忘記','調整複習'),('觀念混淆','補充筆記／教材'),('不會應用','變式練習'),('題目有誤','修正題目／解析')]
    for i,(title,action) in enumerate(categories):
        x=516+i*260
        d.rect(x,1143,244,113,P['amber_soft'],radius=14)
        d.text(x+122,1185,title,27,weight=600,anchor='middle')
        d.text(x+122,1227,action,23,P['amber'],anchor='middle',max_width=227)
    d.line([(516,1290),(1544,1290)],P['line'],width=1.5)
    d.text(1030,1338,'提出修訂建議 → 核對後更新 → 保留版本',27,P['amber'],anchor='middle')
    # Explicit returns to the two editable outputs.
    d.line([(700,1050),(700,913),(770,913),(770,880)],P['amber'],3.5,arrow=True)
    d.text(497,947,'回寫筆記與比較表',22,P['amber'])
    d.line([(1430,1050),(1430,913),(1400,913),(1400,880)],P['amber'],3.5,arrow=True)
    d.text(1190,947,'更新教材與重新出題',22,P['amber'])

    # Review and scheduling.
    d.card(1660,1050,650,330,fill='#FAFCFE')
    d.label(1696,1108,'復盤與學習安排',size=32,color=P['blue'])
    d.rect(1696,1143,578,75,P['blue_soft'],radius=14)
    d.text(1720,1188,'間隔複習',27,weight=600)
    d.text(2250,1188,'下次何時再練？',25,P['blue'],anchor='end')
    d.rect(1696,1232,578,75,P['blue_soft'],radius=14)
    d.text(1720,1277,'主題復盤',27,weight=600)
    d.text(2250,1277,'下週優先學什麼？',25,P['blue'],anchor='end')
    d.text(1696,1349,'依可用時間調整份量與計畫',25,P['muted'])
    # Planning loop routes outside the cards to avoid crossing the learning flow.
    d.line([(2310,1226),(2350,1226),(2350,220),(1400,220),(1400,280)],P['blue'],3.5,arrow=True)
    d.rect(1640,193,403,50,P['bg'],radius=10)
    d.text(1841.5,227,'安排下一輪學習與複習',26,P['blue'],anchor='middle')

    # Shared-link foundation and arrow legend.
    d.rect(90,1447,2220,80,'#E8EEE6',radius=18)
    d.text(122,1496,'共用關聯',25,weight=600)
    d.text(275,1496,'來源・概念・教材・題目・作答紀錄',25,P['green'])
    legend=[(1340,P['green'],'資料／學習流'),(1710,P['amber'],'補強與修訂'),(2040,P['blue'],'複習安排')]
    for x,color,title in legend:
        d.line([(x,1487),(x+48,1487)],color,3,arrow=True)
        d.text(x+63,1496,title,23,P['muted'])
    d.text(90,1570,'依手繪藍圖重繪｜已確認架構方向，欄位、算法、介面與自動化細節待討論。',21,P['muted'])
    d.text(2310,1570,'ESSENCE CARDS / CONCEPT ARCHITECTURE',16,P['muted'],en=True,anchor='end')
    d.save()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'docs/diagrams')
    draw(parser.parse_args().output)
