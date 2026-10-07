#!/usr/bin/env python3
"""從功能目錄產生 Mermaid 與對照文件；SVG 由 Mermaid CLI 渲染。"""
import argparse
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
GROUPS = (
    ('source', '輸入與選段', ('F-001', 'F-002')),
    ('concept', '共用概念筆記', ('F-003', 'F-004', 'F-005')),
    ('material', '材料候選與核對採用', ('F-006', 'F-007', 'F-008')),
    ('study', '學習操作與事件', ('F-009', 'F-010')),
    ('feedback', '疑問、補強與修訂', ('F-011', 'F-019', 'F-012')),
    ('plan', '後續學習安排', ('F-013', 'F-014')),
    ('workspace', '情境入口', ('F-015',)),
    ('trace', '資料與保護', ('F-016', 'F-018')),
    ('ai', '可選 AI 協助', ('F-017',)),
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
    lines = ['flowchart TD', '  %% 自動產生；名稱來自功能目錄，分區與箭頭由設計者核對。']
    for key, title, ids in GROUPS[:6]:
        label = '\n'.join([f'**{title}**'] + [f'{i} {rows[i][2]}' for i in ids])
        lines.append(f'  {key}["`{label}`"]')
    lines += [
        '  source --> concept',
        '  source -->|真題或卡片可直接核對| material',
        '  concept --> material',
        '  material -->|採用後練習| study',
        '  study -->|需追蹤的疑問或補強| feedback',
        '  study -->|作答紀錄| plan',
        '  feedback -->|核對後回寫| concept',
        '  feedback -->|核對後更新| material',
        '  plan -->|再練習| study',
        '  subgraph shared["跨功能共用能力"]',
        '    direction TB',
    ]
    for key, title, ids in GROUPS[6:]:
        label = '\n'.join([f'**{title}**'] + [f'{i} {rows[i][2]}' for i in ids])
        lines.append(f'    {key}["`{label}`"]')
    lines += ['  end', '  shared -.->|支援整個學習循環| concept',
              '  classDef knowledge fill:#eaf2e8,stroke:#446957,color:#243c36',
              '  classDef learning fill:#edf3fa,stroke:#597b9a,color:#243c36',
              '  classDef revision fill:#fff3dc,stroke:#ad8140,color:#243c36',
              '  classDef support fill:#f1f0eb,stroke:#898e84,color:#243c36',
              '  class source,concept knowledge', '  class material,study,plan learning',
              '  class feedback revision', '  class workspace,trace,ai support']
    mmd = '\n'.join(lines) + '\n'
    doc = f'''# Essence Cards｜功能架構總覽

圖表 ID：B-004｜依功能目錄 v{version} 產生｜更新日期：{date}

狀態：目前規劃草案。學習循環、共用概念及 C-017 的細化方向已確認；功能邊界、箭頭細節、算法與第一版範圍仍待逐項確認。圖中功能不是完成清單。

這張圖回答「整個專案有哪些功能、如何連接」。以功能分區呈現 19 項討論單位，保留 F-ID，方便回到[功能目錄](../function-discussions.md)；完整名稱由目錄自動帶入。實線表示主要資料／學習與回饋關係，虛線表示共用支援，不表示 API 呼叫或固定操作順序。顏色只區分用途，不表示完成或採用狀態。

```mermaid
{mmd}```

每個方塊包含多項功能，不要求全部依序執行。既有真題／卡片可直接核對採用，再補概念關聯；一般忘記可進複習安排，需追蹤的補強或內容疑義才進 F-019。回寫須核對，舊作答事件保留。F-015、F-016、F-018 橫跨整個循環；F-017 接入可獨立使用的人工流程，AI 結果仍須核對。

## 功能與圖中分區對照

| F-ID | 功能討論單位 | 圖中分區 | 第一版候選／確認邊界 |
|---|---|---|---|
'''
    for _, title, ids in GROUPS:
        for ident in ids:
            doc += f'| {ident} | {rows[ident][2]} | {title} | {rows[ident][6]} |\n'
    doc += '''
## 與其他藍圖互相參照

| 藍圖 | 回答的問題 | 本圖的對應 |
|---|---|---|
| [B-001 知識學習架構](essence-cards-architecture.svg) | 學習循環與共用知識基礎如何運作？ | 輸入、整理、材料、作答與回饋分區 |
| [B-002 技術架構](essence-cards-technical-architecture.svg) | 裝置、資料、AI、同步與 Git 如何分工？ | F-015 至 F-018；電腦處理及手機學習／疑問 |
| [B-003 開發路線圖](essence-cards-development-roadmap.svg) | 先驗證什麼，再開發什麼？ | P0／P1 驗資料基礎，P2 接通人工循環，P3 接 AI；不從 F 編號推導開發順序 |

[共用藍圖索引](../blueprints.md)保存每張圖的目前狀態；[圖表維護方式](README.md#圖表維護與同步)說明如何隨決策更新。T-011 的可丟棄 UI 原型仍待實機，不能視為正式功能已完成，也不能取代 P0。

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
