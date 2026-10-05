#!/usr/bin/env python3
"""Generate the standalone board from a deliberately limited Markdown subset."""
import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO = "https://github.com/kuohappiness/Essence-Cards"
OPEN_IDEAS = {"待釐清", "待研究", "提案中", "待驗證"}


def sections(text):
    matches = list(re.finditer(r"^## (.+)$", text, re.M))
    return [(m[1].strip(), text[m.end():matches[i+1].start() if i+1 < len(matches) else len(text)].strip())
            for i, m in enumerate(matches)]


def plain(text):
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return re.sub(r"[*`<>]", "", text).strip()


def cards(text, prefix, path, statuses=None):
    result = []
    for heading, body in sections(text):
        if not heading.startswith(prefix + "-"):
            continue
        match = re.fullmatch(rf"({prefix}-\d+) (.+)｜(.+)", heading)
        if not match:
            raise ValueError(f"Invalid card heading in {path}: {heading}")
        ident, title, status = match.groups()
        if statuses is not None and status not in statuses:
            continue
        summary = re.search(r"^摘要：(.+)$", body, re.M)
        fallback = next((line.lstrip("- ") for line in body.splitlines() if line.strip()), "")
        result.append(dict(id=ident, title=title, status=status,
                           summary=plain(summary[1] if summary else fallback), body=body,
                           source=f"{REPO}/blob/main/{path}"))
    return result


def task_cards(text):
    bodies = [body for heading, body in sections(text) if heading == "目前任務"]
    if len(bodies) != 1:
        raise ValueError("docs/tasks.md must have one 目前任務 section")
    result = []
    for line in bodies[0].splitlines():
        if not line.startswith("| T-"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 5 or not re.fullmatch(r"T-\d+", cells[0]):
            raise ValueError(f"Invalid current task row: {line}")
        ident, title, status, next_step, basis = cells
        if status in {"已完成", "暫緩", "已排除", "已取代"}:
            raise ValueError(f"Move closed task {ident} out of 目前任務")
        result.append(dict(id=ident, title=title, status=status, summary=plain(next_step),
                           body=f"下一步：{next_step}\n\n依據：{basis}",
                           source=f"{REPO}/blob/main/docs/tasks.md"))
    return result


def collect(root=ROOT):
    def read(path):
        return (root / path).read_text(encoding="utf-8")
    consensus = read("docs/consensus.md")
    version = re.search(r"^版本：(.+)$", consensus, re.M)
    date = re.search(r"^更新日期：(.+)$", consensus, re.M)
    if not version or not date:
        raise ValueError("Consensus version/date missing")
    data = dict(version=version[1].strip(), updated=date[1].strip(), repo=REPO,
                ideas=cards(read("docs/ideas.md"), "I", "docs/ideas.md", OPEN_IDEAS),
                tasks=task_cards(read("docs/tasks.md")),
                consensus=cards(consensus, "C", "docs/consensus.md", {"已確認"}),
                references=cards(read("docs/references/software.md"), "R", "docs/references/software.md"))
    ids = [card["id"] for group in ("ideas", "tasks", "consensus", "references") for card in data[group]]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate card ID")
    if not data["consensus"]:
        raise ValueError("No confirmed consensus found")
    return data


def render(root=ROOT):
    template = (root / "web/board-template.html").read_text(encoding="utf-8")
    if template.count("__BOARD_DATA__") != 1:
        raise ValueError("Expected exactly one board data placeholder")
    # Do not embed excluded document sections, even as hidden HTML or raw JSON.
    payload = json.dumps(collect(root), ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace("&", "\\u0026")
    return template.replace("__BOARD_DATA__", payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if output is stale")
    parser.add_argument("--output", type=Path, default=ROOT / "index.html")
    args = parser.parse_args()
    html = render()
    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != html:
            print("Board is stale. Run python3 scripts/build_board.py", file=sys.stderr)
            return 1
        print("Board matches Markdown sources.")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(html, encoding="utf-8")
        print(f"Generated {args.output.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
