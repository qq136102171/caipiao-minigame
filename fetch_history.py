"""
拉取 / 导入彩票历史开奖数据。

支持三种模式：
1. fetch  - 从公开数据源（新华彩票 API）拉取最新期号
2. import - 从本地 JSON / CSV 文件导入
3. seed   - 内置示例数据（用于测试）

数据会自动与 data/{ssq,dlt}_history.json 现有内容合并去重。

示例：
    # 从新华彩票拉取双色球最近 200 期
    .venv/bin/python fetch_history.py fetch --type ssq --limit 200

    # 从 JSON 文件导入
    .venv/bin/python fetch_history.py import-json --type ssq --file my_data.json

    # 从 CSV 导入（header: issue,date,reds,blue 或 issue,date,front,back）
    .venv/bin/python fetch_history.py import-csv --type dlt --file my_data.csv

    # 导入内置示例数据（每彩种几十期，仅用于功能验证）
    .venv/bin/python fetch_history.py seed --type ssq
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Iterable

from history import DATA_DIR, Draw, history_file, save_history

# ===== 数据源 =====
# 新华彩票（H5 接口，返回 JSON）。该接口无频率限制。
# 实际请求路径参考其前端 /wap/js 逻辑。
HUAXIA_API = "https://www.xinhua08.com/api/lottery/kj"

# 备用源（体彩/福彩官方域名可能存在反爬）
BACKUP_APIS = {
    "ssq": [
        # 体彩 / 福彩公开页的 JSON endpoint
        "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=200",
    ],
    "dlt": [
        "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=dlt&issueCount=200",
    ],
}


# ===== fetch：从公开数据源拉取 =====

def _http_get_json(url: str, timeout: int = 15) -> dict | list | None:
    """发起 GET 请求并尝试解析 JSON。"""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"  ⚠ 网络请求失败 ({url}): {e}", file=sys.stderr)
        return None

    try:
        return json.loads(body)
    except json.JSONDecodeError:
        # 尝试容错：很多接口包了一层
        start = body.find("{")
        end = body.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(body[start:end + 1])
            except json.JSONDecodeError:
                pass
        print(f"  ⚠ 返回非 JSON 数据: {body[:120]}...", file=sys.stderr)
        return None


def _fetch_from_huaxia(lottery_type: str, limit: int) -> list:
    """
    从新华彩票接口拉取开奖数据。
    注：接口结构可能随时变化，这里尽量宽松解析。
    """
    # 新华彩票接口路径示例（实际接口可能不同）
    candidates = [
        f"{HUAXIA_API}/{lottery_type}",
        f"{HUAXIA_API}?lottery={lottery_type}",
    ]

    for url in candidates:
        print(f"  → 尝试 {url}")
        data = _http_get_json(url)
        if data is None:
            continue

        # 尝试兼容多种返回结构
        items = None
        if isinstance(data, dict):
            for key in ("data", "result", "list", "records"):
                if key in data and isinstance(data[key], list):
                    items = data[key]
                    break
        elif isinstance(data, list):
            items = data

        if not items:
            continue

        draws = _parse_remote_items(items, lottery_type)
        if draws:
            return draws[:limit]

    return []


def _fetch_from_cwl(lottery_type: str, limit: int) -> list:
    """从福彩 / 体彩官方备用接口拉取。"""
    urls = BACKUP_APIS.get(lottery_type, [])
    for url in urls:
        print(f"  → 尝试 {url}")
        data = _http_get_json(url)
        if not data:
            continue
        items = None
        if isinstance(data, dict):
            for key in ("result", "data"):
                v = data.get(key)
                if isinstance(v, list):
                    items = v
                    break
        if not items:
            continue
        draws = _parse_cwl_items(items, lottery_type)
        if draws:
            return draws[:limit]
    return []


def _parse_remote_items(items: list, lottery_type: str) -> list:
    """通用宽松解析：识别常见字段名。"""
    draws = []
    for it in items:
        if not isinstance(it, dict):
            continue
        issue = str(it.get("issue") or it.get("code") or it.get("expect") or "").strip()
        date_str = str(it.get("date") or it.get("openTime") or it.get("drawDate") or "").strip()
        if not issue:
            continue

        if lottery_type == "ssq":
            reds = it.get("red") or it.get("reds") or it.get("red_ball") or it.get("front")
            blue = it.get("blue") or it.get("blue_ball") or it.get("back")
            if isinstance(reds, str):
                reds = [int(x) for x in reds.replace(",", " ").split() if x.strip()]
            elif isinstance(reds, list):
                reds = [int(x) for x in reds]
            if not reds or blue is None:
                continue
            draws.append(Draw(issue=issue, date=date_str.split(" ")[0],
                              reds=reds, blue=int(blue)))
        else:
            front = it.get("front") or it.get("fronts") or it.get("red") or it.get("reds")
            back = it.get("back") or it.get("backs") or it.get("blue")
            if isinstance(front, str):
                front = [int(x) for x in front.replace(",", " ").split() if x.strip()]
            elif isinstance(front, list):
                front = [int(x) for x in front]
            if isinstance(back, str):
                back = [int(x) for x in back.replace(",", " ").split() if x.strip()]
            elif isinstance(back, list):
                back = [int(x) for x in back]
            if not front or not back:
                continue
            draws.append(Draw(issue=issue, date=date_str.split(" ")[0],
                              front=front, back=back))
    return draws


def _parse_cwl_items(items: list, lottery_type: str) -> list:
    """福彩 / 体彩官方接口专用解析。"""
    draws = []
    for it in items:
        if not isinstance(it, dict):
            continue
        issue = str(it.get("code") or it.get("issue") or "").strip()
        date_str = str(it.get("date") or "").strip()
        if not issue:
            continue
        if lottery_type == "ssq":
            reds_raw = it.get("red")
            blue_raw = it.get("blue")
            if not reds_raw or blue_raw is None:
                continue
            if isinstance(reds_raw, str):
                reds = [int(x) for x in reds_raw.replace(",", " ").split() if x.strip()]
            else:
                reds = [int(x) for x in reds_raw]
            draws.append(Draw(issue=issue, date=date_str.split(" ")[0],
                              reds=reds, blue=int(blue_raw)))
        else:
            front_raw = it.get("front")
            back_raw = it.get("back")
            if isinstance(front_raw, str):
                front = [int(x) for x in front_raw.replace(",", " ").split() if x.strip()]
            else:
                front = [int(x) for x in (front_raw or [])]
            if isinstance(back_raw, str):
                back = [int(x) for x in back_raw.replace(",", " ").split() if x.strip()]
            else:
                back = [int(x) for x in (back_raw or [])]
            if not front or not back:
                continue
            draws.append(Draw(issue=issue, date=date_str.split(" ")[0],
                              front=front, back=back))
    return draws


def cmd_fetch(args) -> int:
    """从公开数据源拉取。"""
    print(f"开始拉取 {args.type} 数据（最多 {args.limit} 期）...")
    draws: list = []
    # 优先级：huaxia → cwl
    draws = _fetch_from_huaxia(args.type, args.limit)
    if not draws:
        draws = _fetch_from_cwl(args.type, args.limit)

    if not draws:
        print("❌ 所有数据源均未能拉到数据。可改用 'import-json' / 'import-csv' / 'seed' 命令。")
        return 1

    path = save_history(args.type, draws, last_update=datetime.now().strftime("%Y-%m-%d"))
    print(f"✅ 拉取成功，新增 {len(draws)} 期，保存到 {path}")
    return 0


# ===== import-json / import-csv =====

def cmd_import_json(args) -> int:
    """从 JSON 文件导入。"""
    p = Path(args.file)
    if not p.exists():
        print(f"❌ 文件不存在: {p}")
        return 1

    try:
        payload = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析失败: {e}")
        return 1

    raw_draws = payload.get("draws") if isinstance(payload, dict) else payload
    if not isinstance(raw_draws, list):
        print("❌ JSON 顶层必须是 list 或包含 'draws' 字段的 dict")
        return 1

    from history import _normalize_draw
    draws = []
    for raw in raw_draws:
        draw = _normalize_draw(raw, args.type)
        if draw is not None:
            draws.append(draw)

    if not draws:
        print("❌ 没有有效数据")
        return 1

    path = save_history(args.type, draws, last_update=datetime.now().strftime("%Y-%m-%d"))
    print(f"✅ 导入成功 {len(draws)} 期，保存到 {path}")
    return 0


def cmd_import_csv(args) -> int:
    """从 CSV 文件导入。

    ssq 列：issue,date,red1..red6,blue （reds 顺序不要求）
    dlt 列：issue,date,front1..front5,back1,back2
    也支持 'reds' 列以空格分隔的写法。
    """
    p = Path(args.file)
    if not p.exists():
        print(f"❌ 文件不存在: {p}")
        return 1

    draws = []
    with p.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            issue = (row.get("issue") or "").strip()
            if not issue:
                continue
            date_str = (row.get("date") or "").strip()

            if args.type == "ssq":
                reds_field = (row.get("reds") or "").strip()
                if reds_field:
                    reds = [int(x) for x in reds_field.replace(",", " ").split() if x.strip()]
                else:
                    reds = [int(row[f"red{i}"]) for i in range(1, 7) if row.get(f"red{i}")]
                blue = int(row["blue"])
                draws.append(Draw(issue=issue, date=date_str, reds=reds, blue=blue))
            else:
                front_field = (row.get("front") or "").strip()
                if front_field:
                    front = [int(x) for x in front_field.replace(",", " ").split() if x.strip()]
                else:
                    front = [int(row[f"front{i}"]) for i in range(1, 6) if row.get(f"front{i}")]
                back_field = (row.get("back") or "").strip()
                if back_field:
                    back = [int(x) for x in back_field.replace(",", " ").split() if x.strip()]
                else:
                    back = [int(row[f"back{i}"]) for i in range(1, 3) if row.get(f"back{i}")]
                draws.append(Draw(issue=issue, date=date_str, front=front, back=back))

    if not draws:
        print("❌ 没有有效数据")
        return 1

    path = save_history(args.type, draws, last_update=datetime.now().strftime("%Y-%m-%d"))
    print(f"✅ 导入成功 {len(draws)} 期，保存到 {path}")
    return 0


# ===== seed：内置示例数据（仅用于功能验证） =====

SSQ_SEED = [
    ("2024001", "2024-01-02", [3, 5, 12, 18, 24, 30], 9),
    ("2024002", "2024-01-07", [2, 7, 15, 19, 25, 31], 11),
    ("2024003", "2024-01-11", [1, 4, 9, 17, 23, 28], 6),
    ("2024004", "2024-01-14", [6, 11, 14, 22, 27, 33], 14),
    ("2024005", "2024-01-18", [8, 13, 16, 21, 29, 32], 3),
    ("2024006", "2024-01-21", [5, 10, 17, 20, 26, 30], 8),
    ("2024007", "2024-01-25", [2, 9, 14, 18, 25, 31], 13),
    ("2024008", "2024-01-28", [4, 11, 16, 22, 28, 33], 5),
    ("2024009", "2024-02-01", [7, 12, 15, 21, 27, 32], 10),
    ("2024010", "2024-02-04", [3, 8, 13, 19, 24, 30], 7),
    ("2024011", "2024-02-08", [1, 6, 14, 20, 26, 31], 12),
    ("2024012", "2024-02-11", [9, 15, 17, 23, 29, 33], 4),
    ("2024013", "2024-02-22", [5, 11, 14, 22, 27, 32], 2),
    ("2024014", "2024-02-25", [2, 8, 16, 19, 25, 30], 15),
    ("2024015", "2024-02-29", [4, 10, 13, 21, 28, 31], 6),
    ("2024016", "2024-03-03", [7, 12, 17, 22, 26, 33], 11),
    ("2024017", "2024-03-07", [3, 9, 14, 18, 24, 29], 8),
    ("2024018", "2024-03-10", [1, 6, 15, 20, 27, 32], 13),
    ("2024019", "2024-03-14", [5, 11, 16, 22, 28, 30], 9),
    ("2024020", "2024-03-17", [4, 8, 13, 19, 25, 31], 14),
    ("2024021", "2024-03-21", [2, 10, 17, 21, 26, 33], 7),
    ("2024022", "2024-03-24", [6, 12, 14, 23, 29, 32], 5),
    ("2024023", "2024-03-28", [3, 9, 15, 18, 24, 30], 10),
    ("2024024", "2024-03-31", [7, 11, 16, 20, 27, 31], 12),
    ("2024025", "2024-04-04", [1, 8, 13, 22, 25, 33], 6),
    ("2024026", "2024-04-07", [4, 10, 14, 19, 28, 32], 11),
    ("2024027", "2024-04-11", [5, 9, 17, 21, 26, 30], 8),
    ("2024028", "2024-04-14", [2, 12, 15, 23, 29, 31], 13),
    ("2024029", "2024-04-18", [6, 11, 16, 20, 27, 33], 4),
    ("2024030", "2024-04-21", [3, 8, 14, 18, 24, 32], 9),
]

DLT_SEED = [
    ("2024001", "2024-01-01", [3, 8, 15, 22, 29], [4, 11]),
    ("2024002", "2024-01-03", [5, 12, 19, 25, 33], [2, 9]),
    ("2024003", "2024-01-06", [1, 9, 16, 23, 31], [5, 12]),
    ("2024004", "2024-01-08", [7, 14, 21, 28, 34], [3, 10]),
    ("2024005", "2024-01-10", [4, 11, 18, 26, 32], [6, 11]),
    ("2024006", "2024-01-13", [2, 10, 17, 24, 30], [1, 8]),
    ("2024007", "2024-01-15", [6, 13, 20, 27, 35], [4, 9]),
    ("2024008", "2024-01-17", [3, 9, 16, 22, 29], [7, 12]),
    ("2024009", "2024-01-20", [5, 11, 19, 25, 33], [2, 10]),
    ("2024010", "2024-01-22", [1, 8, 15, 23, 31], [5, 11]),
    ("2024011", "2024-01-24", [4, 12, 18, 26, 32], [3, 8]),
    ("2024012", "2024-01-27", [7, 14, 21, 28, 34], [6, 9]),
    ("2024013", "2024-01-29", [2, 10, 17, 24, 30], [1, 12]),
    ("2024014", "2024-01-31", [6, 13, 20, 27, 35], [4, 11]),
    ("2024015", "2024-02-03", [3, 9, 16, 22, 29], [7, 10]),
    ("2024016", "2024-02-05", [5, 11, 19, 25, 33], [2, 8]),
    ("2024017", "2024-02-07", [1, 8, 15, 23, 31], [5, 9]),
    ("2024018", "2024-02-10", [4, 12, 18, 26, 32], [3, 12]),
    ("2024019", "2024-02-14", [7, 14, 21, 28, 34], [6, 10]),
    ("2024020", "2024-02-17", [2, 10, 17, 24, 30], [1, 11]),
]


def cmd_seed(args) -> int:
    """导入内置示例数据。"""
    seed = SSQ_SEED if args.type == "ssq" else DLT_SEED
    draws = []
    for issue, date_str, primary, secondary in seed:
        if args.type == "ssq":
            draws.append(Draw(issue=issue, date=date_str, reds=primary, blue=int(secondary)))
        else:
            draws.append(Draw(issue=issue, date=date_str, front=primary, back=secondary))
    path = save_history(args.type, draws, last_update=datetime.now().strftime("%Y-%m-%d"))
    print(f"✅ 已写入 {len(draws)} 期种子数据到 {path}")
    return 0


# ===== CLI =====

def main() -> int:
    parser = argparse.ArgumentParser(description="彩票历史数据拉取 / 导入工具")
    sub = parser.add_subparsers(dest="cmd", required=True)

    fetch_p = sub.add_parser("fetch", help="从公开数据源拉取")
    fetch_p.add_argument("--type", choices=["ssq", "dlt"], required=True)
    fetch_p.add_argument("--limit", "-n", type=int, default=200)
    fetch_p.set_defaults(func=cmd_fetch)

    ij_p = sub.add_parser("import-json", help="从 JSON 文件导入")
    ij_p.add_argument("--type", choices=["ssq", "dlt"], required=True)
    ij_p.add_argument("--file", "-f", required=True)
    ij_p.set_defaults(func=cmd_import_json)

    ic_p = sub.add_parser("import-csv", help="从 CSV 文件导入")
    ic_p.add_argument("--type", choices=["ssq", "dlt"], required=True)
    ic_p.add_argument("--file", "-f", required=True)
    ic_p.set_defaults(func=cmd_import_csv)

    seed_p = sub.add_parser("seed", help="导入内置示例数据（仅用于功能验证）")
    seed_p.add_argument("--type", choices=["ssq", "dlt"], required=True)
    seed_p.set_defaults(func=cmd_seed)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
