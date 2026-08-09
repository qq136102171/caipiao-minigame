#!/usr/bin/env python3
"""
sync_history_to_game.py
=======================
把 data/{ssq,dlt}_history.json 转成小游戏可用的 caipiao-game/data/{ssq,dlt}_history.js

输出格式（与现有 caipiao-game/data/*.js 完全一致）：
    // ssq 历史开奖数据（共 N 期，issueA → issueB，来源：cwl.gov.cn（福彩））
    // 紧凑格式：issue|date|primary|secondary
    module.exports = [
      "issue|date|n1,n2,...|blue",
      ...
    ];

用法：
    .venv/bin/python scripts/sync_history_to_game.py
    .venv/bin/python scripts/sync_history_to_game.py --check    # 仅检测有无变化，不写文件
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
GAME_DIR = ROOT / "caipiao-game" / "data"

SOURCES = {
    "ssq": {
        "json": DATA_DIR / "ssq_history.json",
        "js": GAME_DIR / "ssq_history.js",
        "primary_key": "reds",
        "secondary_key": "blue",
        "primary_label": "红球",
        "source": "cwl.gov.cn（福彩）",
        "primary_pad": 2,
        "secondary_pad": 2,
    },
    "dlt": {
        "json": DATA_DIR / "dlt_history.json",
        "js": GAME_DIR / "dlt_history.js",
        "primary_key": "front",
        "secondary_key": "back",
        "primary_label": "前区",
        "source": "webapi.sporttery.cn（体彩）",
        "primary_pad": 2,
        "secondary_pad": 2,
    },
}


def _padded(n: int, width: int) -> str:
    return str(n).zfill(width)


def _convert_one(kind: str, cfg: dict) -> tuple[str, int, str | None, str | None]:
    """读取 json, 生成 js 内容。返回 (js_text, issue_count, first_issue, last_issue)。"""
    if not cfg["json"].exists():
        print(f"  ⚠ {cfg['json']} 不存在", file=sys.stderr)
        return "", 0, None, None

    with cfg["json"].open("r", encoding="utf-8") as f:
        payload = json.load(f)
    draws = payload.get("draws", [])
    if not draws:
        print(f"  ⚠ {cfg['json']} 没有 draws", file=sys.stderr)
        return "", 0, None, None

    primary_pad = cfg["primary_pad"]
    secondary_pad = cfg["secondary_pad"]

    lines: list[str] = []
    for d in draws:
        issue = str(d.get("issue", "")).strip()
        date = str(d.get("date", "")).strip()
        primary = d.get(cfg["primary_key"]) or []
        secondary = d.get(cfg["secondary_key"])

        primary_str = ",".join(_padded(int(x), primary_pad) for x in primary)
        if isinstance(secondary, list):
            secondary_str = ",".join(_padded(int(x), secondary_pad) for x in secondary)
        else:
            secondary_str = _padded(int(secondary), secondary_pad)

        lines.append(f'  "{issue}|{date}|{primary_str}|{secondary_str}",')

    first_issue = lines and lines[0].split('"')[1].split("|")[0] or None
    last_issue = lines and lines[-1].split('"')[1].split("|")[0] or None

    header = (
        f"// {kind} 历史开奖数据（共 {len(lines)} 期，"
        f"{first_issue} → {last_issue}，来源：{cfg['source']}）\n"
        f"// 紧凑格式：issue|date|primary|secondary\n"
        f"module.exports = [\n"
    )
    footer = "];\n"
    return header + "\n".join(lines) + "\n" + footer, len(lines), first_issue, last_issue


def main() -> int:
    p = argparse.ArgumentParser(description="把 data/*.json 转成 caipiao-game/data/*.js")
    p.add_argument("--check", action="store_true", help="只检测有无变化，不写文件")
    args = p.parse_args()

    if not GAME_DIR.exists():
        print(f"❌ 目标目录不存在: {GAME_DIR}", file=sys.stderr)
        return 1

    changed_any = False
    for kind, cfg in SOURCES.items():
        print(f"[{kind}] {cfg['json'].name} → {cfg['js'].name}")
        new_text, n, first, last = _convert_one(kind, cfg)
        if n == 0:
            print(f"  ⚠ 无数据，跳过")
            continue

        old_text = ""
        if cfg["js"].exists():
            old_text = cfg["js"].read_text(encoding="utf-8")

        if old_text == new_text:
            print(f"  ✓ 无变化（{n} 期，{first} → {last}）")
            continue

        if args.check:
            print(f"  ⟳ 有变化（{n} 期，{first} → {last}）— check 模式不写")
            changed_any = True
            continue

        cfg["js"].write_text(new_text, encoding="utf-8")
        print(f"  ✅ 已写入（{n} 期，{first} → {last}）")
        changed_any = True

    return 1 if changed_any else 0


if __name__ == "__main__":
    sys.exit(main())
