"""以臨時 repo 驗證藍圖檢查，不依賴目前正式文件的快照。"""

import contextlib
import io
import json
import re
import shutil
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from scripts import check_diagrams as diagrams
from scripts import build_function_diagram as functions


class DiagramChecksTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "docs/diagrams").mkdir(parents=True)
        (self.root / "docs/source.md").write_text("共用來源\n", encoding="utf-8")
        self.entries = []
        for number in (1, 2):
            image = f"docs/diagrams/{number}.svg"
            (self.root / image).write_text('<svg xmlns="http://www.w3.org/2000/svg"><text>藍圖</text></svg>', encoding="utf-8")
            self.entries.append({"id": f"B-{number:03}", "image": image,
                                 "sources": ["docs/source.md"], "artifacts": [image]})
        self.write_registry()
        self.write_index()
        self.assertEqual(diagrams.record(self.root, ["B-001", "B-002"]), [])

    def write_registry(self):
        (self.root / diagrams.REGISTRY).write_text(json.dumps({"diagrams": self.entries}), encoding="utf-8")

    def write_index(self):
        (self.root / diagrams.INDEX).write_text("\n".join(
            f"## {entry['id']} 測試｜待驗證\n\n圖檔：{entry['image']}\n"
            for entry in self.entries), encoding="utf-8")

    def state(self):
        return json.loads((self.root / diagrams.STATE).read_text(encoding="utf-8"))

    def test_unchanged_and_explicit_check(self):
        self.assertEqual(diagrams.check(self.root), [])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(diagrams.main([], self.root), 0)
            self.assertEqual(diagrams.main(["--check"], self.root), 0)

    def test_shared_source_change_marks_each_diagram(self):
        (self.root / "docs/source.md").write_text("新的架構方向", encoding="utf-8")
        errors = diagrams.check(self.root)
        self.assertTrue(any("B-001 來源已變更" in error for error in errors))
        self.assertTrue(any("B-002 來源已變更" in error for error in errors))
        self.assertTrue(all("人工核對" in error for error in errors))

    def test_artifact_change(self):
        (self.root / "docs/diagrams/1.svg").write_text("<svg><text>修改</text></svg>", encoding="utf-8")
        errors = diagrams.check(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn("B-001 產物已變更", errors[0])

    def test_unregistered_svg_blocks_record_without_writing(self):
        before = (self.root / diagrams.STATE).read_bytes()
        (self.root / "docs/diagrams/unregistered.svg").write_text("<svg/>")
        self.assertTrue(any("漏註冊 SVG" in error for error in diagrams.check(self.root)))
        self.assertTrue(diagrams.record(self.root, ["B-001"]))
        self.assertEqual((self.root / diagrams.STATE).read_bytes(), before)

    def test_escape_and_missing_paths_are_rejected(self):
        for name in ("../outside.md", "/etc/passwd", "docs/../source.md", "docs\\source.md", "docs/missing.md"):
            with self.subTest(name=name):
                self.entries[0]["sources"] = [name]
                self.write_registry()
                self.assertTrue(diagrams.check(self.root))
                self.assertTrue(diagrams.record(self.root, ["B-001"]))

    def test_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as outside:
            target = Path(outside) / "source.md"
            target.write_text("外部內容")
            (self.root / "docs/link.md").symlink_to(target)
            self.entries[0]["sources"] = ["docs/link.md"]
            self.write_registry()
            self.assertTrue(any("路徑超出 repo" in error for error in diagrams.check(self.root)))

    def test_index_image_mismatch_and_missing_id(self):
        path = self.root / diagrams.INDEX
        path.write_text("## B-001 測試\n圖檔：docs/diagrams/2.svg\n", encoding="utf-8")
        errors = diagrams.check(self.root)
        self.assertTrue(any("不符：B-001" in error for error in errors))
        self.assertTrue(any("不符：B-002" in error for error in errors))

    def test_duplicate_registry_id_and_index_id(self):
        self.entries[1]["id"] = "B-001"
        self.write_registry()
        self.write_index()
        errors = diagrams.check(self.root)
        self.assertTrue(any("重複的藍圖 ID" in error for error in errors))
        self.assertTrue(any("索引重複 ID" in error for error in errors))

    def test_record_selected_does_not_hide_other_changes(self):
        before = self.state()["diagrams"]["B-002"]
        (self.root / "docs/source.md").write_text("共用來源已修改", encoding="utf-8")
        self.assertEqual(diagrams.record(self.root, ["B-001"]), [])
        self.assertEqual(self.state()["diagrams"]["B-002"], before)
        errors = diagrams.check(self.root)
        self.assertEqual(len(errors), 1)
        self.assertIn("B-002 來源已變更", errors[0])
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(diagrams.main(["--record", "B-001"], self.root), 1)

    def test_removed_diagram_snapshot_is_an_error(self):
        self.entries.pop()
        (self.root / "docs/diagrams/2.svg").unlink()
        self.write_registry()
        self.write_index()
        self.assertTrue(any("已移除藍圖仍有舊快照：B-002" in error for error in diagrams.check(self.root)))
        self.assertTrue(diagrams.record(self.root, ["B-001"]))

    def test_source_membership_change_requires_review(self):
        (self.root / "docs/extra.md").write_text("額外依據", encoding="utf-8")
        self.entries[0]["sources"].append("docs/extra.md")
        self.write_registry()
        self.assertTrue(any("docs/extra.md" in error for error in diagrams.check(self.root)))

    def test_record_requires_explicit_known_ids(self):
        before = (self.root / diagrams.STATE).read_bytes()
        for selected in ([], ["B-999"], ["B-001", "B-001"]):
            self.assertTrue(diagrams.record(self.root, selected))
            self.assertEqual((self.root / diagrams.STATE).read_bytes(), before)

    def test_malformed_registry_and_state_report_errors(self):
        (self.root / diagrams.REGISTRY).write_text('{"diagrams": [null]}')
        self.assertTrue(diagrams.check(self.root))
        self.write_registry()
        (self.root / diagrams.STATE).write_text('{"diagrams": []}')
        self.assertTrue(diagrams.check(self.root))

    def test_missing_snapshot_does_not_self_record(self):
        (self.root / diagrams.STATE).unlink()
        self.assertTrue(diagrams.check(self.root))
        self.assertFalse((self.root / diagrams.STATE).exists())
        self.assertEqual(diagrams.record(self.root, ["B-001"]), [])
        self.assertTrue(any("B-002 缺少有效快照" in error for error in diagrams.check(self.root)))


class FunctionDiagramTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "docs/diagrams").mkdir(parents=True)
        self.catalog = self.root / "docs/function-discussions.md"
        shutil.copyfile(functions.ROOT / "docs/function-discussions.md", self.catalog)

    def rename_function(self):
        text = self.catalog.read_text(encoding="utf-8")
        lines = text.splitlines()
        for index, line in enumerate(lines):
            if line.startswith("| F-001 |"):
                cells = line.split("|")
                cells[3] = " 測試改名後的來源管理 "
                lines[index] = "|".join(cells)
                break
        else:
            self.fail("測試來源缺少 F-001")
        self.catalog.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def test_names_follow_catalog_in_mermaid_and_mapping(self):
        previous = functions.collect(self.root)[0]["F-001"][2]
        self.rename_function()
        rendered = functions.render(self.root)
        mmd = rendered["docs/diagrams/essence-cards-functions.mmd"]
        document = rendered["docs/diagrams/functions.md"]
        self.assertIn("F-001 測試改名後的來源管理", mmd)
        self.assertNotIn("F-001 " + previous, mmd)
        self.assertRegex(document, r"(?m)^\| F-001 \| 測試改名後的來源管理 \| M-001 輸入 \|")

    def test_all_nineteen_unique_ids_covered_once_in_each_generated_mapping(self):
        expected = {f"F-{number:03}" for number in range(1, 20)}
        rows, _, _ = functions.collect(self.root)
        self.assertEqual(set(rows), expected)
        rendered = functions.render(self.root)
        mmd_ids = re.findall(r"\bF-\d{3}\b", rendered["docs/diagrams/essence-cards-functions.mmd"])
        table_ids = re.findall(r"(?m)^\| (F-\d{3}) \|", rendered["docs/diagrams/functions.md"])
        for identifiers in (mmd_ids, table_ids):
            self.assertEqual(len(identifiers), 19)
            self.assertEqual(set(identifiers), expected)

    def test_three_modules_and_shared_foundation_responsibility_mapping(self):
        mmd = functions.render(self.root)["docs/diagrams/essence-cards-functions.mmd"]
        expected = {
            "input": ("M-001 輸入", {"F-001", "F-002", "F-003"}),
            "output": ("M-002 輸出", {f"F-{number:03}" for number in range(4, 10)}),
            "check": ("M-003 檢核", {"F-011", "F-012", "F-013", "F-014", "F-019"}),
            "shared": ("共用基礎（非第四大模組）", {"F-010", "F-015", "F-016", "F-017", "F-018"}),
        }
        for node, (label, identifiers) in expected.items():
            with self.subTest(node=node):
                match = re.search(rf'(?ms)^ +{node}\["`(.*?)`"\]', mmd)
                self.assertIsNotNone(match)
                self.assertIn(label, match[1])
                self.assertEqual(set(re.findall(r"F-\d{3}", match[1])), identifiers)
        self.assertTrue(mmd.startswith("flowchart TD\n"))
        self.assertEqual(len(re.findall(r'(?m)^ +\w+\[', mmd)), 9)
        for node in ("output", "check"):
            self.assertIn(f"shared -.->|支援| {node}", mmd)
        self.assertIn("shared -.->|格式約定| input", mmd)
        self.assertNotIn("shared -.->|支援| input", mmd)

    def test_input_and_output_have_independent_entries_and_endpoints(self):
        mmd = functions.render(self.root)["docs/diagrams/essence-cards-functions.mmd"]
        for edge in ("sources --> input", "input --> notes", "cards --> output", "output --> review"):
            self.assertIn(edge, mmd)
        self.assertIn('sources["外部來源（如 YouTube）"]', mmd)
        self.assertIn('cards["既有筆記／手動卡片"]', mmd)
        self.assertIn('notes["可讀筆記：可獨立結束"]', mmd)
        self.assertIn('review["直接複習：可獨立結束"]', mmd)
        self.assertNotRegex(mmd, r"(?m)^ +review (?:-->|-\.->)")
        # 筆記可交接，但沒有必須繼續製卡的出口。
        outgoing_notes = re.findall(r"(?m)^ +notes (.+)$", mmd)
        self.assertEqual(outgoing_notes, ["-->|可選：文件交接| output"])

    def test_module_handoffs_are_optional_and_revision_requires_verification(self):
        rendered = functions.render(self.root)
        mmd = rendered["docs/diagrams/essence-cards-functions.mmd"]
        for source, target in (("notes", "output"), ("output", "check")):
            self.assertRegex(mmd, rf"(?m)^ +{source} -->\|可選：[^|]+\| {target}$")
        self.assertIn("check -->|核對後建議修訂| output", mmd)
        self.assertIn("check -->|可選：核對後修訂筆記| notes", mmd)
        self.assertNotRegex(mmd, r"(?m)^ +input -->[^\n]*output$")
        document = rendered["docs/diagrams/functions.md"]
        for statement in ("責任候選映射", "不代表唯一歸屬", "不把 M-003 當作啟用閃卡的先決條件",
                          "AI 可選", "各獨立操作保留人工核對",
                          "完整 YouTube API 或轉錄已實作", "../module-architecture.md",
                          "已依使用者回報通過 Windows／iPhone 最小實機驗證", "完整 P0 仍未通過"):
            self.assertIn(statement, document)

    def test_mandatory_routes_do_not_cross_product_boundary(self):
        mmd = functions.render(self.root)["docs/diagrams/essence-cards-functions.mmd"]
        # 只追蹤非「可選」實線；格式約定不是執行相依。
        edges = re.findall(r"(?m)^ +([a-z]+) -->(?:\|([^|]+)\|)? ([a-z]+)$", mmd)
        mandatory = {}
        for source, label, target in edges:
            if not label.startswith("可選："):
                mandatory.setdefault(source, set()).add(target)

        def reachable(start):
            seen, pending = set(), [start]
            while pending:
                node = pending.pop()
                if node not in seen:
                    seen.add(node)
                    pending.extend(mandatory.get(node, ()))
            return seen

        self.assertEqual(reachable("cards"), {"cards", "output", "review"})
        self.assertEqual(reachable("sources"), {"sources", "input", "notes"})
        self.assertEqual(reachable("check"), {"check", "output", "review"})

    def test_two_product_phases_keep_modules_without_mandatory_runtime_dependency(self):
        rendered = functions.render(self.root)
        mmd = rendered["docs/diagrams/essence-cards-functions.mmd"]
        phases = {}
        for phase in ("phase1", "phase2"):
            match = re.search(rf'(?ms)^  subgraph {phase}\["([^"\n]+)"\]\n(.*?)^  end$', mmd)
            self.assertIsNotNone(match)
            phases[phase] = match[1], match[2]
        self.assertEqual(len(re.findall(r"(?m)^  subgraph ", mmd)), 2)
        self.assertIn("本 repo：Essence Cards 輸出＋檢核＋選用 AI", phases["phase1"][0])
        self.assertIn("後續另 repo：Essence Capture（預計）", phases["phase2"][0])
        for node in ("cards", "output", "review", "check"):
            self.assertRegex(phases["phase1"][1], rf"(?m)^    {node}\[")
        for node in ("sources", "input", "notes"):
            self.assertRegex(phases["phase2"][1], rf"(?m)^    {node}\[")
        self.assertNotRegex(phases["phase1"][1], r"(?m)^    (input|sources)\[")
        self.assertNotRegex(phases["phase2"][1], r"(?m)^    (output|check)\[")
        self.assertNotRegex(phases["phase1"][1] + phases["phase2"][1], r"(?m)^ +shared\[")
        document = rendered["docs/diagrams/functions.md"]
        for statement in (
                "C-022 取代 C-020 的同一外掛內整合三模組安排",
                "本 repo 專注 Essence Cards 的輸出＋檢核＋選用 AI",
                "來源輸入由後續獨立 Obsidian 外掛 Essence Capture 開發",
                "不承諾首期包含全部 19 項", "首期功能與卡型、檢核範圍",
                "來源取得與輸入工具不是第一階段使用的必要條件",
                "Capture repo 尚未建立",
                "檔案交接與人工選取", "API 可選", "不要求兩產品共享可變狀態或同時執行",
                "../integration-contract.md", "schema、欄位、協定或連接器已定案",
                "學習循環視角", "F-013 的基本複習規則可供輸出使用"):
            self.assertIn(statement, document)

    def test_unknown_function_requires_manual_group_review(self):
        text = self.catalog.read_text(encoding="utf-8")
        row = next(line for line in text.splitlines() if line.startswith("| F-001 |"))
        text = text.replace(row, row + "\n" + row.replace("F-001", "F-020", 1), 1)
        self.catalog.write_text(text, encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "新增、移除或拆分功能時須核對分區"):
            functions.render(self.root)

    def test_missing_function_requires_manual_group_review(self):
        text = self.catalog.read_text(encoding="utf-8")
        self.catalog.write_text("\n".join(line for line in text.splitlines()
                                           if not line.startswith("| F-019 |")), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "新增、移除或拆分功能時須核對分區"):
            functions.render(self.root)

    def test_check_detects_stale_generation_without_rewriting(self):
        render = functions.render
        with mock.patch.object(functions, "ROOT", self.root), \
                mock.patch.object(functions, "render", side_effect=lambda: render(self.root)), \
                mock.patch("sys.argv", ["build_function_diagram.py", "--check"]), \
                contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()) as stderr:
            # 缺產物也須失敗，生成後檢查才通過。
            self.assertEqual(functions.main(), 1)
            for name, content in render(self.root).items():
                (self.root / name).write_text(content, encoding="utf-8")
            self.assertEqual(functions.main(), 0)
            self.rename_function()
            before = {name: (self.root / name).read_bytes() for name in render(self.root)}
            self.assertEqual(functions.main(), 1)
            self.assertIn("請重新產生", stderr.getvalue())
            for name, content in before.items():
                self.assertEqual((self.root / name).read_bytes(), content)


if __name__ == "__main__":
    unittest.main()
