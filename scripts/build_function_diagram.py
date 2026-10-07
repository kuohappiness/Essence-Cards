#!/usr/bin/env python3
"""從功能目錄產生 Mermaid 與對照文件；SVG 由 Mermaid CLI 渲染。"""
import argparse
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
GROUPS = (
    ('input', 'M-001 輸入', ('F-001', 'F-002', 'F-003')),
    ('output', 'M-002 輸出', ('F-004', 'F-005', 'F-006', 'F-007', 'F-008', 'F-009')),
    ('check', 'M-003 檢核', ('F-011', 'F-012', 'F-013', 'F-014', 'F-019')),
    ('shared', '共用基礎（非第四大模組）', ('F-010', 'F-015', 'F-016', 'F-017', 'F-018')),
)


def collect(root=ROOT):
    text = (root / 'docs/function-discussions.md').read_text(encoding='utf-8')
    section = re.search(r'^## 功能目錄[^\n]*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
    if not section:
        raise ValueError('找不到功能目錄表格')
    rows = {}
    for line in section[1].splitlines():
        if not line.startswith('| F-'):
            continue
        cells = [x.strip() for x in line.strip('|').split('|')]
        if len(cells) != 7 or not re.fullmatch(r'F-\d{3}', cells[0]) or cells[0] in rows:
            raise ValueError('功能表格欄位或 ID 無效：' + line)
        if any(c in cells[2] for c in ('"', '`', '<', '>')):
            raise ValueError('功能名稱含不支援的圖表字元：' + cells[0])
        rows[cells[0]] = cells
    grouped = [ident for _, _, ids in GROUPS for ident in ids]
    if len(grouped) != len(set(grouped)) or set(grouped) != set(rows):
        raise ValueError('功能分區與目錄不一致；新增、移除或拆分功能時須核對分區')
    version = re.search(r'^版本：(.+)$', text, re.M)[1]
    date = re.search(r'^更新日期：(.+)$', text, re.M)[1]
    return rows, version, date


def render(root=ROOT):
    rows, version, date = collect(root)
    lines = ['flowchart TD', '  %% 自動產生；名稱來自功能目錄，責任候選映射與箭頭由設計者核對。']
    for key, title, ids in GROUPS:
        label = '\n'.join([f'**{title}**'] + [f'{i} {rows[i][2]}' for i in ids])
        if key == 'output':
            label += '\n基本自評／複習可獨立使用'
        elif key == 'check':
            label += '\n檢核對象與入口待細化'
        lines.append(f'  {key}["`{label}`"]')
    lines += [
        '  sources["外部來源（如 YouTube）"]',
        '  notes["可讀筆記：可獨立結束"]',
        '  cards["既有／手動卡片"]',
        '  review["直接複習：可獨立結束"]',
        '  sources --> input',
        '  input --> notes',
        '  cards --> output',
        '  output --> review',
        '  input -->|可選：交接筆記或素材| output',
        '  output -->|可選：紀錄／材料核對| check',
        '  check -->|核對後建議修訂| input',
        '  check -->|核對後建議修訂| output',
        '  shared -.->|支援| input',
        '  shared -.->|支援| output',
        '  shared -.->|支援| check',
        '  classDef knowledge fill:#eaf2e8,stroke:#446957,color:#243c36',
        '  classDef learning fill:#edf3fa,stroke:#597b9a,color:#243c36',
        '  classDef revision fill:#fff3dc,stroke:#ad8140,color:#243c36',
        '  classDef support fill:#f1f0eb,stroke:#898e84,color:#243c36',
        '  class input,notes knowledge',
        '  class output,review learning',
        '  class check revision',
        '  class shared,sources,cards support',
    ]
    mmd = '\n'.join(lines) + '\n'
    doc = f'''# Essence Cards｜功能架構總覽

圖表 ID：B-004｜依功能目錄 v{version} 產生｜更新日期：{date}

狀態：三大模組的產品／工程方向與輸入、輸出可獨立使用已確認（C-020）；19 項功能的責任候選映射、程式邊界、交接細節、算法與第一版範圍仍為提案。圖中功能不是完成清單。

這張圖回答「專案的三大模組有哪些責任、如何選擇性連接」。M-001 輸入、M-002 輸出（教材、心智圖、閃卡製作與使用）、M-003 檢核是產品／工程視角；[三大模組架構](../module-architecture.md)保存方向與使用情境。既有「輸入、整理、學習、回饋」仍是學習循環視角，兩者並存，不要求使用者依序走完。

每個 F-ID 在主要節點標籤出現一次，完整功能名稱由[功能目錄](../function-discussions.md)自動帶入。這是討論用的責任候選映射，有跨界能力，不代表唯一歸屬或已定案的程式邊界。實線表示操作入口、產出或可選交接；虛線表示共用基礎支援，不表示 API 呼叫或強制流程。顏色只區分用途，不表示完成或採用狀態。

```mermaid
{mmd}```

輸入可單獨把 YouTube 等來源整理為可讀筆記，完成後即可結束；圖示為需求情境，不表示完整 YouTube API 或轉錄已實作。輸出可從既有／手動卡片直接製作或複習，不須先匯入新來源或啟用完整檢核。輸入到輸出、輸出到檢核都是可選交接；檢核依核對結果提出修訂建議，再回到輸入或輸出。

F-009 的操作與基本自評在輸出使用，較深評量可與檢核協作；F-013 的基本複習規則可供輸出使用，不把 M-003 當作啟用閃卡的先決條件。學習事件、情境存取、ID／關聯、資料保存與可選 AI 轉接屬共用基礎，不新增第四大模組。各獨立操作保留人工核對；AI 可選，AI 結果仍須核對。正式紀錄、保存失敗處理及排程細節待討論，修訂保留可核對的版本與原事件。

## 功能與圖中分區對照

| F-ID | 功能討論單位 | 圖中責任候選映射（可跨界） | 第一版候選／確認邊界 |
|---|---|---|---|
'''
    for _, title, ids in GROUPS:
        for ident in ids:
            doc += f'| {ident} | {rows[ident][2]} | {title} | {rows[ident][6]} |\n'
    doc += '''
## 與其他藍圖互相參照

| 藍圖 | 回答的問題 | 本圖的對應 |
|---|---|---|
| [B-001 知識學習架構](essence-cards-architecture.svg) | 學習循環與共用知識基礎如何運作？ | 學習循環視角與三大模組互相對照；不強制依序操作 |
| [B-002 技術架構](essence-cards-technical-architecture.svg) | 裝置、資料、AI、同步與 Git 如何分工？ | 三大模組共用資料、事件、存取、AI 與保護基礎；電腦處理及手機複習／疑問 |
| [B-003 開發路線圖](essence-cards-development-roadmap.svg) | 先驗證什麼，再開發什麼？ | P0／P1 驗最小資料基礎，P2 先交付獨立閃卡再增量接模組，P3 深化 AI；不從 F 編號推導順序 |

[共用藍圖索引](../blueprints.md)保存每張圖的目前狀態；[圖表維護方式](README.md#圖表維護與同步)說明如何隨決策更新。T-011 的可丟棄 UI 原型已依使用者回報通過 Windows／iPhone 最小實機驗證；正式功能與完整 P0 仍未通過，原型結果不能取代離線事件、併發、附件及 Git 回復驗證。

## 原始碼與生成

- [Mermaid 原始碼](essence-cards-functions.mmd)
- [靜態 SVG](essence-cards-functions.svg)，供桌面／手機看板離線閱讀。
- [產生程式](../../scripts/build_function_diagram.py)：名稱與 F-ID 取自目錄，分區及箭頭仍須設計者核對。

勿單獨修改生成的本文件、Mermaid 或 SVG。更新功能目錄；若關係變動，修改產生程式；重新渲染、核對所有受影響圖表，再記錄來源快照及建置看板。
'''
    return {'docs/diagrams/essence-cards-functions.mmd': mmd,
            'docs/diagrams/functions.md': doc}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    stale = []
    for name, content in render().items():
        path = ROOT / name
        if args.check:
            if not path.exists() or path.read_text(encoding='utf-8') != content:
                stale.append(name)
        else:
            path.write_text(content, encoding='utf-8')
            print('已產生', name)
    if stale:
        print('功能圖來源已變更，請重新產生：' + '、'.join(stale), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
