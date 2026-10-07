"""Render editable, font-embedded technical proposal and development roadmap.

Reuse the established Diagram drawing primitives without changing the learning
blueprint renderer. PDF and PNG previews are kept outside the repository by
 default; the repository receives only the two SVG source diagrams.
Requires PyMuPDF, reportlab and fontTools, as does draw_architecture.py.
"""
from pathlib import Path
from io import BytesIO
import argparse
import base64
import html
import fitz
from fontTools.ttLib import TTFont as FontToolsFont
from fontTools import subset
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import draw_architecture as primitives

P = primitives.P
ROOT = Path(__file__).resolve().parents[1]


class Blueprint(primitives.Diagram):
    def __init__(self, svg_out, previews, name, title, description, width, height):
        # The inherited primitives use the module canvas dimensions.
        primitives.W, primitives.H = width, height
        self.width, self.height = width, height
        self.out, self.previews, self.name = svg_out, previews, name
        self.title, self.description = title, description
        svg_out.mkdir(parents=True, exist_ok=True)
        previews.mkdir(parents=True, exist_ok=True)
        self.font_bytes = fitz.Font('cjk').buffer
        pdfmetrics.registerFont(TTFont('CJK', BytesIO(self.font_bytes)))
        pdfmetrics.registerFont(TTFont('EN', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
        pdfmetrics.registerFont(TTFont('ENB', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))
        self.pdf = canvas.Canvas(str(previews / f'{name}.pdf'), pagesize=(width/2, height/2))
        self.pdf.setTitle(title)
        self.pdf.setAuthor('Essence Cards')
        self.pdf.setSubject(description)
        self.pdf.scale(.5, .5)
        self.parts, self.used, self.y_offset = [], set(), 0

    def text(self, x, y, value, size=26, color=None, weight=400, en=False,
             anchor='start', max_width=None):
        font = 'ENB' if en and weight >= 600 else 'EN' if en else 'CJK'
        text_width = pdfmetrics.stringWidth(value, font, size)
        left = x - (text_width/2 if anchor == 'middle' else text_width if anchor == 'end' else 0)
        if left < 0 or left + text_width > self.width or y > self.height or y-size < 0:
            raise ValueError(f'Text outside canvas: {value}')
        super().text(x, y, value, size, color, weight, en, anchor, max_width)

    def rows(self, x, y, rows, width, size=25, gap=40, color=None):
        for i, value in enumerate(rows):
            self.text(x, y+i*gap, value, size, color, max_width=width)

    def save(self):
        self.pdf.showPage()
        self.pdf.save()
        faces = []
        for family, source in [('DiagramCJK', BytesIO(self.font_bytes)),
                               ('DiagramLatin', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]:
            font = FontToolsFont(source)
            sub = subset.Subsetter(options=subset.Options())
            sub.populate(text=''.join(sorted(self.used)))
            sub.subset(font)
            font.flavor = 'woff'
            buffer = BytesIO()
            font.save(buffer)
            encoded = base64.b64encode(buffer.getvalue()).decode()
            faces.append(f'@font-face{{font-family:{family};src:url(data:font/woff;base64,{encoded}) format("woff");}}')
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{self.height}" '
               f'viewBox="0 0 {self.width} {self.height}" role="img" aria-labelledby="title desc">'
               f'<title id="title">{html.escape(self.title)}</title>'
               f'<desc id="desc">{html.escape(self.description)}</desc>'
               '<style>'+''.join(faces)+'</style>'+''.join(self.parts)+'</svg>')
        (self.out / f'{self.name}.svg').write_text(svg, encoding='utf-8')
        with fitz.open(self.previews / f'{self.name}.pdf') as doc:
            doc[0].get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False).save(self.previews / f'{self.name}.png')
            doc[0].get_pixmap(matrix=fitz.Matrix(.8, .8), alpha=False).save(self.previews / f'{self.name}-thumbnail.png')
        print(f'{self.name}: SVG {self.width} × {self.height}; PNG {int(self.width*1.5)} × {int(self.height*1.5)}; PDF {self.width/2:g} × {self.height/2:g} pt')


def heading(d, title, subtitle):
    d.rect(0, 0, d.width, d.height, P['bg'], radius=0)
    d.text(80, 95, 'Essence Cards', 46, weight=700, en=True)
    d.text(80, 168, title, 47, weight=600)
    d.text(80, 220, subtitle, 26, P['muted'], max_width=d.width-160)


def technical(svg_out, previews):
    d = Blueprint(svg_out, previews, 'essence-cards-technical-architecture',
                  'Essence Cards｜技術架構提案',
                  '第一版已選 Obsidian 外掛，沿用既有 iCloud 作為唯一日常同步。AI、資料設計與獨立 Git 備份方案為待驗證提案，尚未實作。',
                  2200, 1880)
    heading(d, '技術架構提案', '已選：Obsidian 外掛・既有 iCloud 日常同步｜以下技術與 Git 細節為提案，待驗證、未實作。')
    d.card(80, 280, 610, 390, stripe=P['green'])
    d.label(120, 343, '電腦｜Obsidian 外掛', size=33)
    d.rows(120, 401, ['輸入來源・筆記管理', '概念整理・教材製作', 'AI 任務啟動・確認修訂'], 530, size=28, gap=47)
    d.rect(116, 563, 538, 65, P['green_soft'], radius=12)
    d.text(385, 605, '重任務優先在電腦執行', 26, P['green'], anchor='middle')
    d.card(790, 280, 620, 390, fill='#F9FCFE', stripe=P['blue'])
    d.label(830, 343, 'AI 任務層｜待驗證提案', size=31, color=P['blue'])
    d.rows(830, 401, ['統一任務脈絡・模型轉接', '輸出檢查・版本核對', '提出修訂草稿 → 人工核對回寫'], 540, size=27, gap=47)
    d.rows(830, 583, ['重任務在電腦；手動流程可獨立運作', '不承諾所有模型都能無痛替換'], 540, size=23, gap=35, color=P['blue'])
    d.line([(690, 431), (790, 431)], P['blue'], 3, arrow=True)
    d.line([(790, 505), (690, 505)], P['blue'], 3, arrow=True)
    d.text(740, 406, '任務', 20, P['blue'], anchor='middle')
    d.text(740, 545, '草稿', 20, P['blue'], anchor='middle')
    d.card(1510, 280, 610, 390, stripe=P['green'])
    d.label(1550, 343, '手機｜Obsidian 外掛', size=33)
    d.rows(1550, 401, ['快開複習・離線作答', '概念回看・問題標記', '專注輕量操作與學習'], 530, size=28, gap=47)
    d.rect(1546, 563, 538, 65, P['green_soft'], radius=12)
    d.text(1815, 605, '不依賴桌面 Node／Electron', 25, P['green'], anchor='middle', max_width=510)
    d.line([(385, 670), (385, 738)], width=3, arrow=True)
    d.line([(1815, 670), (1815, 738)], width=3, arrow=True)
    for x, title in [(80, '電腦本機 vault'), (1510, '手機本機 vault')]:
        d.card(x, 738, 610, 220)
        d.text(x+34, 797, title, 32, weight=600)
        d.rows(x+34, 846, ['概念筆記・來源・題目／教材', '學習事件・附件・可重建索引'], 542, size=25, gap=42)
    d.rect(850, 760, 500, 175, P['blue_soft'], P['line'], radius=20)
    d.text(1100, 812, 'iCloud', 38, P['blue'], weight=700, en=True, anchor='middle')
    d.text(1100, 856, '唯一日常雙向同步', 28, P['blue'], anchor='middle')
    d.text(1100, 902, '沿用既有 Windows ＋ iPhone', 23, P['muted'], anchor='middle')
    for start, end in [(690, 850), (1350, 1510)]:
        d.line([(start, 809), (end, 809)], P['blue'], 3, arrow=True)
        d.line([(end, 882), (start, 882)], P['blue'], 3, arrow=True)
    d.card(80, 1000, 2040, 204, fill='#F8FBF6')
    d.label(116, 1057, '兩端共用資料規則｜待驗證', size=29)
    d.rows(116, 1104, ['共用穩定概念 ID、來源定位與題材版本；學習事件獨立追加、去重，索引可重建。',
                      '兩端各持有本機 vault；雲端負責檔案同步，共用的是邏輯知識來源。',
                      'Windows iCloud 衝突風險仍須實測；Git 幫助救回，並不改善同步可靠性。'], 1960, size=26, gap=37)
    d.card(80, 1250, 2040, 520, fill='#FFFCF5', stripe=P['amber'])
    d.label(116, 1310, 'Git 獨立備份層｜提案，不作第二套日常同步', size=32, color=P['amber'])
    boxes = [(116, 420, '電腦已收到的 vault'), (620, 330, 'commit'), (1034, 280, 'push'), (1398, 686, 'GitHub 私人儲存庫')]
    for x, w, title in boxes:
        d.rect(x, 1342, w, 82, P['amber_soft'], radius=12)
        d.text(x+w/2, 1392, title, 28, P['amber'], weight=600, anchor='middle', max_width=w-34)
    for a,b in [(536,620),(950,1034),(1314,1398)]:
        d.line([(a,1383),(b,1383)], P['amber'], 3, arrow=True)
    d.text(116, 1468, '只由電腦備份；手機停用 Git；私人學習備份與此公開專案 repo 分開。', 27, P['amber'], max_width=1968)
    d.rows(116, 1520, ['• .git 歷史放在 iCloud 之外；AI 批次修改前後建立版本 checkpoint。',
                      '• commit-and-sync 預設含 pull：需明確設定其他不改工作檔的同步策略。',
                      '• 回復先比對，再選擇個別檔案；保留較新的學習紀錄。',
                      '• 保護邊界：尚未到電腦、尚未 commit、尚未 push 的資料，分別不在對應備份內。'],
           1968, size=26, gap=48)
    d.text(80, 1830, 'UI 原型最小實機已通過；正式資料、AI、Git 與併發同步仍待設計及驗證。', 25, P['muted'])
    d.text(2120, 1830, '2026.10.07', 22, P['muted'], en=True, anchor='end')
    d.save()


def roadmap(svg_out, previews):
    d = Blueprint(svg_out, previews, 'essence-cards-development-roadmap',
                  'Essence Cards｜開發路線圖提案',
                  '建議順序 P0 至 P4，各階段待執行，沒有工期承諾。先以真實 Windows 與 iPhone 驗證同步及回復，再建立資料骨架、最小學習循環、AI 轉接與真實教材試用。',
                  1680, 2010)
    heading(d, '開發路線圖提案', '可丟棄 UI 原型最小實機已通過；正式 P0–P4 仍待驗收。')
    stages = [
        ('P0', '跨裝置與回復驗證', P['amber'], P['amber_soft'],
         ['UI／讀寫原型已通過；續測正式事件、附件完整性與離線保存。',
          '電腦修改概念 ＋ 手機離線作答：同步後兩邊資料都保留。',
          '演練 Git 比對與個別檔案回復，保留較新的學習紀錄。'],
         '通過驗證才進入 P1；若失敗，先調整資料與同步設計。'),
        ('P1', '資料骨架', P['green'], P['green_soft'],
         ['建立穩定 ID、schema、來源定位與題目／教材版本。',
          '學習事件獨立追加與去重；查詢索引可從資料重建。',
          '共用概念可跨主題引用；避免兩端競爭覆寫同一檔。'],
         '驗收：資料關聯能核對，手機事件與概念修訂可共存。'),
        ('P2', '最小完整學習循環', P['green'], P['green_soft'],
         ['文字或既有 Markdown → 概念 → 記憶卡或基礎題 → 作答。',
          '留下學習紀錄，提供回饋與可核對的修訂回寫。',
          '電腦整理、手機複習；先完成一條可重複操作的學習循環。'],
         '驗收：從來源到回饋可完整走通，操作中仍可回查來源。'),
        ('P3', 'AI 可替換設計', P['blue'], P['blue_soft'],
         ['定義共通任務，接通至少一種 API 轉接；重任務優先電腦。',
          '支援重試、任務保存、修訂預覽與版本核對。',
          'AI 批次前後建立 Git checkpoint；手動流程不依賴 AI。'],
         '驗收：換轉接不改核心資料；模型差異與手機限制明確可見。'),
        ('P4', '真實教材試用', P['blue'], P['blue_soft'],
         ['檢查手機操作阻力、大 vault 表現、題意與解析正確性。',
          '以延後回想觀察學習效果，不把使用頻率當作成效。',
          '重跑離線、同步衝突與救回測試，回饋至前面各階段。'],
         '驗收：依教材與實機結果決定補強，學習成效仍需證據。'),
    ]
    for i, (code, title, color, fill, rows, criterion) in enumerate(stages):
        y=280+i*278
        d.circle(108, y+59, 44, color)
        d.text(108, y+69, code, 29, '#FFFFFF', en=True, weight=700, anchor='middle')
        if i<4:
            d.line([(108, y+103), (108, y+278+15)], P['slate'], 3, arrow=True)
        d.card(200, y, 1400, 248)
        d.rect(228, y+25, 5, 196, color, radius=2)
        d.text(252, y+57, title, 33, weight=600)
        d.rect(1444, y+24, 124, 45, fill, radius=12)
        d.text(1506, y+55, '待驗收' if i == 0 else '待執行', 23, color, anchor='middle')
        d.rows(252, y+102, rows, 1308, size=26, gap=38)
        d.rect(248, y+192, 1320, 40, fill, radius=9)
        d.text(265, y+221, criterion, 24, color, max_width=1286)
    d.card(80, 1710, 1520, 204, fill='#FFFCF5')
    d.label(116, 1767, '延伸範圍｜暫緩', size=31, color=P['amber'])
    d.rows(116, 1816, ['Dropbox／其他雲／NAS、獨立 app 或 web、複雜互動教材、多模型批次。',
                      '重啟前先看 P0–P4 結果；不與 iCloud 對同一 vault 同時啟用雙向同步。'],
           1448, size=26, gap=42)
    d.text(80, 1970, '這是開發提案；各階段的範圍與驗收條件將隨實機、教材及使用回饋調整。', 24, P['muted'])
    d.text(1600, 1970, '2026.10.07', 21, P['muted'], en=True, anchor='end')
    d.save()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'docs/diagrams', help='SVG destination')
    parser.add_argument('--previews', type=Path, default=ROOT.parent/'technical-previews', help='PNG/PDF destination outside repository')
    args = parser.parse_args()
    technical(args.output, args.previews)
    roadmap(args.output, args.previews)
