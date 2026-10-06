#!/usr/bin/env python3
"""Generate the standalone board from a deliberately limited Markdown subset."""
import argparse
from html import escape
import json
from pathlib import Path
import re
import sys
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REPO = "https://github.com/kuohappiness/Essence-Cards"
OPEN_IDEAS = {"待釐清", "待研究", "提案中", "待驗證"}
GROUPS = (("ideas", "待釐清點子", "先留下原意，之後逐項討論"),
          ("tasks", "目前任務", "掌握進度與下一步"),
          ("consensus", "最新共識", "已確認、目前有效的方向"))


def safe_url(raw, source):
    """Resolve document-relative links without permitting active URL schemes."""
    try:
        url = urljoin(source, raw)
        parsed = urlsplit(url)
        return url if parsed.scheme in {"https", "http"} and parsed.netloc else None
    except ValueError:
        return None


def inline(text, source):
    pattern = r"\[([^\]]+)\]\(([^\s)]+)\)|<(https?://[^>]+)>|\*\*([^*]+)\*\*|`([^`]+)`"
    result, end = [], 0
    for match in re.finditer(pattern, text):
        result.append(escape(text[end:match.start()]))
        label, raw, auto, bold, code = match.groups()
        if label is not None or auto is not None:
            href = safe_url(raw or auto, source)
            label = escape(label or auto)
            result.append(f'<a href="{escape(href)}" target="_blank" rel="noopener noreferrer">{label}</a>'
                          if href else label)
        elif bold is not None:
            result.append(f"<strong>{escape(bold)}</strong>")
        else:
            result.append(f"<code>{escape(code)}</code>")
        end = match.end()
    result.append(escape(text[end:]))
    return "".join(result)


def markdown(text, source):
    result = []
    for block in re.split(r"\n\s*\n", text):
        lines = block.split("\n")
        if all(line.startswith("- ") for line in lines):
            result.append("<ul>" + "".join(f"<li>{inline(line[2:], source)}</li>" for line in lines) + "</ul>")
        elif all(line.startswith("> ") for line in lines):
            result.append("<blockquote>" + inline("\n".join(line[2:] for line in lines), source) + "</blockquote>")
        else:
            result.append("<p>" + "<br>".join(inline(line, source) for line in lines) + "</p>")
    return "".join(result)


def static_card(card):
    return (f'<article class="card" data-id="{escape(card["id"])}">'
            f'<div class="card-top"><span class="ident">{escape(card["id"])}</span>'
            f'<span class="badge">{escape(card["status"])}</span></div>'
            f'<h3>{escape(card["title"])}</h3><div class="detail">'
            f'{markdown(card["body"], card["source"])}</div>'
            f'<a class="source" href="{escape(card["source"])}" target="_blank" '
            'rel="noopener noreferrer">查看來源文件 ↗</a></article>')


def static_content(data):
    lanes = []
    for key, title, note in GROUPS:
        content = "".join(static_card(card) for card in data[key]) or '<p class="empty">目前沒有項目</p>'
        lanes.append(f'<section class="lane {key}"><div class="lanehead">'
                     f'<span class="dot" aria-hidden="true"></span><h2>{title}</h2>'
                     f'<span class="count">{len(data[key])}</span></div>'
                     f'<p class="lane-description">{note}</p><div class="cards">{content}</div></section>')
    references = "".join(static_card(card) for card in data["references"]) or '<p class="empty">目前沒有項目</p>'
    return ('<div class="board">' + "".join(lanes) + '</div>'
            '<section class="static-references" aria-labelledby="static-reference-title">'
            '<div class="lanehead"><h2 id="static-reference-title">參考軟體</h2>'
            f'<span class="count">{len(data["references"])}</span></div>'
            '<p class="reference-intro">設計討論的研究資料；參考收錄不代表決定採用。</p>'
            f'<div class="reference-grid">{references}</div></section>')


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
    for placeholder in ("__BOARD_DATA__", "__STATIC_CONTENT__", "__BOARD_META__"):
        if template.count(placeholder) != 1:
            raise ValueError(f"Expected exactly one {placeholder} placeholder")
    data = collect(root)
    # Do not embed excluded document sections, even as hidden HTML or raw JSON.
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace("&", "\\u0026")
    # Replace placeholders in one pass so literal placeholder text in a document
    # cannot be mistaken for a template instruction.
    replacements = {"__BOARD_DATA__": payload, "__STATIC_CONTENT__": static_content(data),
                    "__BOARD_META__": escape(f'共識 v{data["version"]} · {data["updated"]}')}
    return re.sub("|".join(replacements), lambda match: replacements[match[0]], template)


def render_mobile(root=ROOT):
    """Render the discussion platform as an intrinsically visible linear page."""
    template = (root / "web/mobile-template.html").read_text(encoding="utf-8")
    for placeholder in ("__MOBILE_CONTENT__", "__MOBILE_META__"):
        if template.count(placeholder) != 1:
            raise ValueError(f"Expected exactly one {placeholder} placeholder")
    data = collect(root)
    groups = (GROUPS[1], GROUPS[2], GROUPS[0],
              ("references", "參考軟體", "設計討論的研究資料；參考收錄不代表決定採用"))
    content = []
    for key, title, note in groups:
        records = "\n".join(static_card(card) for card in data[key]) or '<p>目前沒有項目</p>'
        content.append(f'<div class="group" id="{key}">\n'
                       f'<h2>{title} · {len(data[key])}</h2><p class="note">{note}</p>\n'
                       f'{records}\n<p class="back"><a href="#top">回到頁首 ↑</a></p>\n</div>')
    replacements = {"__MOBILE_CONTENT__": "\n".join(content),
                    "__MOBILE_META__": escape(f'手機閱讀版 · 共識 v{data["version"]} · {data["updated"]}')}
    return re.sub("|".join(replacements), lambda match: replacements[match[0]], template)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if output is stale")
    parser.add_argument("--output", type=Path, default=ROOT / "index.html")
    parser.add_argument("--mobile-output", type=Path, default=ROOT / "mobile.html")
    args = parser.parse_args()
    outputs = ((args.output, render()), (args.mobile_output, render_mobile()))
    if args.check:
        stale = [path.name for path, html in outputs
                 if not path.exists() or path.read_text(encoding="utf-8") != html]
        if stale:
            print(f"Output is stale: {', '.join(stale)}. Run python3 scripts/build_board.py", file=sys.stderr)
            return 1
        print("Board and mobile reader match Markdown sources.")
    else:
        for path, html in outputs:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(html, encoding="utf-8")
            print(f"Generated {path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
