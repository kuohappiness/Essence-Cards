#!/usr/bin/env python3
"""檢查藍圖登錄、索引與 SHA-256 快照；雜湊相同不代表語意正確。

執行者須先人工核對圖與文字來源，才可用 --record 明列核對過的 ID。
此命令只記錄檔案快照，不執行或宣稱完成語意審查，也不自動重新確認。
"""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import xml.etree.ElementTree as ET

REGISTRY = "docs/diagrams/registry.json"
STATE = "docs/diagrams/review-state.json"
INDEX = "docs/blueprints.md"
DEFAULT_ROOT = Path(__file__).resolve().parents[1]


def _json(root, name):
    try:
        return json.loads(_safe_file(root, name).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"無法讀取 {name}：{exc}") from exc


def _safe_file(root, name):
    if not isinstance(name, str) or not name or "\\" in name:
        raise ValueError(f"不安全的 repo 相對路徑：{name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or ":" in name or str(path) != name:
        raise ValueError(f"不安全的 repo 相對路徑：{name!r}")
    resolved = (root / name).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError(f"路徑超出 repo：{name}")
    if not resolved.is_file():
        raise ValueError(f"檔案不存在：{name}")
    return resolved


def validate_structure(root=DEFAULT_ROOT):
    """回傳 (有效登錄列表, 錯誤列表)，不讀取或更新快照。"""
    root = Path(root)
    errors = []
    try:
        data = _json(root, REGISTRY)
        if not isinstance(data, dict) or not isinstance(data.get("diagrams"), list):
            raise ValueError("registry 須包含 diagrams 列表")
    except ValueError as exc:
        return [], [str(exc)]
    entries = data["diagrams"]
    seen_ids, seen_images = set(), set()
    for entry in entries:
        if not isinstance(entry, dict):
            errors.append("registry 每筆藍圖須為物件")
            continue
        identifier = entry.get("id")
        if not isinstance(identifier, str) or not re.fullmatch(r"B-\d{3}", identifier):
            errors.append(f"無效的藍圖 ID：{identifier!r}")
        elif identifier in seen_ids:
            errors.append(f"重複的藍圖 ID：{identifier}")
        else:
            seen_ids.add(identifier)
        image = entry.get("image")
        if isinstance(image, str):
            if image in seen_images:
                errors.append(f"重複登錄圖檔：{image}")
            seen_images.add(image)
        try:
            file = _safe_file(root, image)
            if not image.startswith("docs/diagrams/") or file.suffix.lower() != ".svg":
                raise ValueError(f"{identifier} 圖檔須為 docs/diagrams 中的 SVG")
            if ET.parse(file).getroot().tag not in ("svg", "{http://www.w3.org/2000/svg}svg"):
                raise ValueError(f"{identifier} 圖檔不是 SVG：{image}")
        except (ValueError, ET.ParseError, OSError) as exc:
            errors.append(str(exc))
        for kind in ("sources", "artifacts"):
            paths = entry.get(kind)
            if not isinstance(paths, list) or not paths:
                errors.append(f"{identifier} 的 {kind} 須為非空路徑列表")
                continue
            seen_paths = set()
            for name in paths:
                try:
                    _safe_file(root, name)
                    if name in seen_paths:
                        errors.append(f"{identifier} 的 {kind} 重複路徑：{name}")
                    seen_paths.add(name)
                except ValueError as exc:
                    errors.append(f"{identifier} {kind}：{exc}")
        if isinstance(entry.get("artifacts"), list) and image not in entry["artifacts"]:
            errors.append(f"{identifier} 圖檔未列入 artifacts：{image}")
    for file in sorted((root / "docs/diagrams").rglob("*")):
        if file.suffix.lower() == ".svg" and file.is_file():
            name = file.relative_to(root).as_posix()
            if name not in seen_images:
                errors.append(f"漏註冊 SVG：{name}")
    try:
        content = _safe_file(root, INDEX).read_text(encoding="utf-8")
        index_pairs = {}
        blocks = re.split(r"(?m)^## ", content)[1:]
        for block in blocks:
            heading = block.splitlines()[0]
            match = re.match(r"(B-\S+)(?:\s|$)", heading)
            if not match:
                continue
            identifier = match.group(1)
            if not re.fullmatch(r"B-\d{3}", identifier):
                errors.append(f"索引無效的藍圖 ID：{identifier}")
            images = re.findall(r"(?m)^圖檔：\s*(\S+)\s*$", block)
            if identifier in index_pairs:
                errors.append(f"索引重複 ID：{identifier}")
            if len(images) != 1:
                errors.append(f"索引 {identifier} 須有且只有一個圖檔")
            index_pairs[identifier] = images[0] if len(images) == 1 else None
        for identifier in sorted(seen_ids | set(index_pairs)):
            registered = [e.get("image") for e in entries if isinstance(e, dict) and e.get("id") == identifier]
            if identifier not in index_pairs or len(registered) != 1 or registered[0] != index_pairs[identifier]:
                errors.append(f"索引與 registry 不符：{identifier}")
    except (ValueError, OSError) as exc:
        errors.append(str(exc))
    return entries, errors


def _snapshot(root, entry):
    return {kind: {name: hashlib.sha256(_safe_file(root, name).read_bytes()).hexdigest()
                   for name in entry[kind]} for kind in ("sources", "artifacts")}


def _state(root, entries, allow_missing=False):
    if allow_missing and not (root / STATE).exists():
        return {"diagrams": {}}, []
    try:
        state = _json(root, STATE)
        if not isinstance(state, dict) or not isinstance(state.get("diagrams"), dict):
            raise ValueError("review-state 須包含 diagrams 物件")
        removed = set(state["diagrams"]) - {e["id"] for e in entries}
        return state, [f"已移除藍圖仍有舊快照：{identifier}" for identifier in sorted(removed)]
    except ValueError as exc:
        return None, [str(exc)]


def check(root=DEFAULT_ROOT):
    """回傳所有結構與快照錯誤；不修改檔案。"""
    root = Path(root)
    entries, errors = validate_structure(root)
    if errors:
        return errors
    state, errors = _state(root, entries)
    if state is None:
        return errors
    for entry in entries:
        identifier = entry["id"]
        saved = state["diagrams"].get(identifier)
        current = _snapshot(root, entry)
        if not isinstance(saved, dict):
            errors.append(f"{identifier} 缺少有效快照；須人工核對來源與產物後明列 --record {identifier}")
            continue
        for kind, label in (("sources", "來源"), ("artifacts", "產物")):
            old = saved.get(kind)
            if old != current[kind]:
                names = sorted(set(current[kind]) | (set(old) if isinstance(old, dict) else set()))
                changed = [name for name in names if not isinstance(old, dict) or old.get(name) != current[kind].get(name)]
                errors.append(f"{identifier} {label}已變更或快照無效：{', '.join(changed)}；須人工核對，工具不自動重新確認")
    return errors


def record(root, identifiers):
    """執行者先人工核對，再明列圖 ID 更新快照；不代表工具完成語意審查。"""
    root = Path(root)
    entries, errors = validate_structure(root)
    if errors:
        return errors
    selected = list(identifiers)
    known = {entry["id"] for entry in entries}
    if not selected:
        return ["--record 必須明列至少一個藍圖 ID；不提供預設全部更新"]
    if len(set(selected)) != len(selected):
        return ["--record 不可重複列出 ID"]
    unknown = set(selected) - known
    if unknown:
        return [f"未登錄的藍圖 ID：{', '.join(sorted(unknown))}"]
    state, errors = _state(root, entries, allow_missing=True)
    if errors:
        return errors
    for entry in entries:
        if entry["id"] in selected:
            state["diagrams"][entry["id"]] = _snapshot(root, entry)
    destination = root / STATE
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(destination)
    return []


def main(argv=None, root=DEFAULT_ROOT):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check", action="store_true", help="檢查結構與快照（預設）")
    modes.add_argument("--record", nargs="+", metavar="B-ID", help="人工核對後，只記錄明列圖的快照")
    args = parser.parse_args(argv)
    try:
        errors = record(root, args.record) if args.record else []
        if not errors:
            if args.record:
                print(f"已記錄指定檔案快照：{', '.join(args.record)}；此結果不代表工具完成語意審查。")
            errors = check(root)
    except (OSError, ValueError) as exc:
        errors = [f"無法完成藍圖檢查：{exc}"]
    if errors:
        for error in errors:
            print(f"錯誤：{error}", file=sys.stderr)
        return 1
    print("藍圖登錄、索引與檔案快照一致；語意需由人工核對。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
