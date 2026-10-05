import importlib.util
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


if __name__ == "__main__":
    unittest.main()
