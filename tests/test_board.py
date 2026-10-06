import importlib.util
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_board", ROOT / "scripts/build_board.py")
board = importlib.util.module_from_spec(spec)
spec.loader.exec_module(board)


class StaticParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.cards, self.links, self.text, self.tags = [], [], [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append(tag)
        if tag == "article":
            self.cards.append(attrs)
        if tag == "a":
            self.links.append(attrs.get("href"))

    def handle_data(self, data):
        self.text.append(data)


class BoardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ("docs", "web"):
            shutil.copytree(ROOT / directory, self.root / directory)

    def append(self, path, text):
        with (self.root / path).open("a", encoding="utf-8") as file:
            file.write(text)

    def test_only_current_content_is_embedded(self):
        self.append("docs/consensus.md", "\n## C-999 已排除的方案｜已排除\nSECRET_REJECTED\n")
        self.append("docs/ideas.md", "\n## I-999 已處理點子｜已採用\nSECRET_CLOSED_IDEA\n")
        self.append("docs/tasks.md", "\n## 完成紀錄\nSECRET_COMPLETED\n")
        self.append("docs/discussions/README.md", "\nSECRET_DISCUSSION\n")
        html = board.render(self.root)
        for marker in ("SECRET_REJECTED", "SECRET_CLOSED_IDEA", "SECRET_COMPLETED", "SECRET_DISCUSSION", '"id":"T-003"'):
            self.assertNotIn(marker, html)
        self.assertIn('"id":"I-001"', html)
        self.assertIn('"id":"C-006"', html)

    def test_untrusted_text_cannot_close_json_script(self):
        marker = '</script><script>alert("unsafe")</script>'
        self.append("docs/ideas.md", "\n## I-998 邊界測試｜待釐清\n" + marker)
        html = board.render(self.root)
        self.assertNotIn(marker, html)
        payload = re.search(r'<script id="board-data" type="application/json">(.*?)</script>', html, re.S)[1]
        data = json.loads(payload)
        self.assertEqual(data["ideas"][-1]["body"], marker)

    def test_duplicate_ids_fail(self):
        self.append("docs/ideas.md", "\n## I-001 重複編號｜待釐清\n內容\n")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            board.collect(self.root)

    def test_closed_task_cannot_leak_into_current_board(self):
        path = self.root / "docs/tasks.md"
        text = path.read_text(encoding="utf-8").replace("| 待討論 |", "| 已完成 |", 1)
        path.write_text(text, encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Move closed task"):
            board.collect(self.root)

    def test_generation_is_deterministic(self):
        self.assertEqual(board.render(self.root), board.render(self.root))

    def test_full_current_content_exists_without_scripts(self):
        rendered = board.render(self.root)
        without_scripts = re.sub(r"<script\b[^>]*>.*?</script>", "", rendered, flags=re.S)
        self.assertNotIn("<noscript", without_scripts)
        self.assertNotIn("<details", without_scripts)
        parser = StaticParser()
        parser.feed(without_scripts)
        data = board.collect(self.root)
        cards = [card for key in ("ideas", "tasks", "consensus", "references") for card in data[key]]
        self.assertEqual([card["data-id"] for card in parser.cards], [card["id"] for card in cards])
        self.assertTrue(all("hidden" not in card for card in parser.cards))
        readable = "".join(parser.text)
        self.assertIn(f'共識 v{data["version"]} · {data["updated"]}', readable)
        for card in cards:
            self.assertIn(card["title"], readable)
            # All body paragraphs, including late next-step/reason paragraphs,
            # must be present outside script tags and without truncation.
            body = StaticParser()
            body.feed(board.markdown(card["body"], card["source"]))
            self.assertIn("".join(body.text), readable)
            self.assertIn(card["source"], parser.links)
        self.assertIn('id="toolbar" aria-label="看板檢視" hidden', without_scripts)
        self.assertIn('id="stage" hidden', without_scripts)
        self.assertIn('id="static-content">', without_scripts)

    def test_static_markdown_is_escaped_and_links_resolve_from_document(self):
        self.append("docs/ideas.md", '\n## I-998 <img src=x onerror=alert(1)>｜待釐清\n'
                    '<script>alert(1)</script> & **重點** `程式`\n\n'
                    '- [共識](consensus.md#c-001)\n- [上層](../README.md)\n'
                    '- [危險](javascript:alert)\n- [資料](data:text/html,test)\n'
                    '- [安全但需跳脫](https://example.com/?a=1&b="bad")\n\n'
                    '> 引用 <img src=x>\n')
        rendered = board.render(self.root)
        static = rendered.split('<div class="stage" id="static-content">', 1)[1].split('<div class="stage" id="stage"', 1)[0]
        self.assertNotIn('<script>', static)
        self.assertNotIn('<img', static)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt; &amp;', static)
        self.assertIn('<strong>重點</strong>', static)
        self.assertIn('<code>程式</code>', static)
        self.assertIn('<blockquote>', static)
        parser = StaticParser()
        parser.feed(static)
        self.assertIn(board.REPO + '/blob/main/docs/consensus.md#c-001', parser.links)
        self.assertIn(board.REPO + '/blob/main/README.md', parser.links)
        self.assertIn('https://example.com/?a=1&b="bad"', parser.links)
        self.assertTrue(all(url.startswith(('https://', 'http://')) for url in parser.links))
        self.assertIn('危險', ''.join(parser.text))
        self.assertIn('資料', ''.join(parser.text))

    def test_reference_relative_links_and_literal_placeholders(self):
        self.append("docs/references/software.md", '\n## R-998 測試｜待研究\n'
                    '[點子](../ideas.md#i-001) __BOARD_DATA__ __STATIC_CONTENT__ __BOARD_META__\n')
        rendered = board.render(self.root)
        self.assertIn(f'href="{board.REPO}/blob/main/docs/ideas.md#i-001"', rendered)
        self.assertIn('__BOARD_DATA__ __STATIC_CONTENT__ __BOARD_META__', rendered)


if __name__ == "__main__":
    unittest.main()
