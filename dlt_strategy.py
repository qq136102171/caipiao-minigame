#!/usr/bin/env python3
"""
大乐透"均衡覆盖型"选号策略脚本。

前区按 7 个区间固定模板覆盖，后区按奇偶大小类型组合并随期数轮换。
支持命令行生成多期、保存结果、查看历史以及基于日期的可复现随机种子。
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable

# ===== 大乐透规则配置 =====
FRONT_RANGE = list(range(1, 36))   # 前区 01-35
BACK_RANGE = list(range(1, 13))    # 后区 01-12
BETS_PER_ISSUE = 4                 # 每期 4 注
COST_PER_BET = 3                   # 追加投注 3 元/注

# 前区 7 个区间
ZONES: dict[str, list[int]] = {
    "A": list(range(1, 6)),
    "B": list(range(6, 11)),
    "C": list(range(11, 16)),
    "D": list(range(16, 21)),
    "E": list(range(21, 26)),
    "F": list(range(26, 31)),
    "G": list(range(31, 36)),
}

# 4 注前区的区间覆盖模板
FRONT_TEMPLATES: list[list[str]] = [
    ["A", "C", "E", "F", "G"],
    ["B", "D", "E", "F", "G"],
    ["A", "B", "D", "F", "G"],
    ["A", "C", "D", "E", "G"],
]

# 后区类型分类
BACK_TYPES: dict[str, list[int]] = {
    "小奇": [1, 3, 5],
    "小偶": [2, 4, 6],
    "大奇": [7, 9, 11],
    "大偶": [8, 10, 12],
}

# 4 注后区的类型组合（4 期一循环）
BACK_COMBOS: list[list[str]] = [
    ["小奇", "大偶"],
    ["小奇", "大偶"],
    ["小偶", "大奇"],
    ["小偶", "大奇"],
]

# 历史记录保存路径
DATA_DIR = Path(__file__).parent / "data"
HISTORY_FILE = DATA_DIR / "dlt_history.json"

# 大乐透开奖日：周一、三、六
DRAW_WEEKDAYS = {0, 2, 5}  # Monday=0, Wednesday=2, Saturday=5

# 参考起始期（2025-01-01 为 2025001 期）
REF_ISSUE_DATE = date(2025, 1, 1)
REF_ISSUE_NUMBER = 2025001


@dataclass
class DltBet:
    """单注大乐透号码。"""
    bet_no: int
    front: list[int]
    back: list[int]
    front_zones: list[str]
    back_types: list[str]


@dataclass
class DltIssue:
    """单期大乐透投注方案。"""
    issue_no: int
    draw_date: str
    bets: list[DltBet]
    total_cost: int


def pad(num: int) -> str:
    """将数字格式化为两位字符串。"""
    return f"{num:02d}"


def format_numbers(numbers: Iterable[int]) -> str:
    """将号码列表格式化为 '01 02 03' 形式。"""
    return " ".join(pad(n) for n in sorted(numbers))


def find_latest_draw_date(target_date: date) -> date:
    """
    找到 target_date 当天或之前最近的大乐透开奖日。
    大乐透每周一、三、六开奖。
    """
    current = target_date
    while current.weekday() not in DRAW_WEEKDAYS:
        current -= timedelta(days=1)
    return current


def count_draws_between(start: date, end: date) -> int:
    """计算 [start, end] 之间（含）的大乐透开奖日数量。"""
    if end < start:
        return 0
    count = 0
    current = start
    while current <= end:
        if current.weekday() in DRAW_WEEKDAYS:
            count += 1
        current += timedelta(days=1)
    return count


def next_draw_date(current: date) -> date:
    """返回 current 之后的下一个开奖日。"""
    nxt = current + timedelta(days=1)
    while nxt.weekday() not in DRAW_WEEKDAYS:
        nxt += timedelta(days=1)
    return nxt


def previous_draw_date(current: date) -> date:
    """返回 current 之前的上一个开奖日。"""
    prev = current - timedelta(days=1)
    while prev.weekday() not in DRAW_WEEKDAYS:
        prev -= timedelta(days=1)
    return prev


def get_issue_info(target_date: date | None = None) -> tuple[int, date, int]:
    """
    根据日期确定最近一期的期号、开奖日和绝对序号。

    期号格式：{年份}{该年第几期:03d}，例如 2026082。
    绝对序号用于后区组合轮换，从 2025-01-01（第 1 期）起连续计数。
    """
    if target_date is None:
        target_date = date.today()

    draw_date = find_latest_draw_date(target_date)
    year = draw_date.year
    seq = count_draws_between(date(year, 1, 1), draw_date)
    issue_no = year * 1000 + seq

    if draw_date >= REF_ISSUE_DATE:
        absolute_index = count_draws_between(REF_ISSUE_DATE, draw_date)
    else:
        absolute_index = -count_draws_between(draw_date, REF_ISSUE_DATE)

    return issue_no, draw_date, absolute_index


def issue_to_date(issue_no: int) -> tuple[date, int, int]:
    """
    将期号反推为开奖日期、该年序号和绝对序号。

    期号格式：{年份}{该年第几期:03d}。
    """
    year = issue_no // 1000
    seq = issue_no % 1000

    current = date(year, 1, 1)
    found = 0
    while current.year == year:
        if current.weekday() in DRAW_WEEKDAYS:
            found += 1
            if found == seq:
                break
        current += timedelta(days=1)

    absolute_index = count_draws_between(REF_ISSUE_DATE, current)
    if current < REF_ISSUE_DATE:
        absolute_index = -count_draws_between(current, REF_ISSUE_DATE)

    return current, seq, absolute_index


def get_issue_numbers(start_issue_no: int, count: int) -> list[tuple[int, date, int]]:
    """从起始期号开始，生成后续 count 期的期号、开奖日和绝对序号。"""
    result = []
    current_issue = start_issue_no
    current_date, _, current_abs = issue_to_date(current_issue)

    for _ in range(count):
        result.append((current_issue, current_date, current_abs))
        current_date = next_draw_date(current_date)
        current_issue += 1
        current_abs += 1

    return result


def make_seed(issue_no: int, seed_mode: str) -> int | None:
    """
    根据 seed_mode 生成随机种子。

    - "date": 基于期号生成固定种子，相同期号结果可复现。
    - "random": 不固定种子，返回 None。
    """
    if seed_mode == "date":
        return issue_no * 1009 + 2025
    return None


def rotate_back_combos(absolute_index: int) -> list[list[str]]:
    """根据绝对序号对后区类型组合进行 4 期一循环的轮换。"""
    offset = absolute_index % 4
    return BACK_COMBOS[-offset:] + BACK_COMBOS[:-offset]


def generate_front_bet(zones: list[str], rng: random.Random) -> tuple[list[int], list[str]]:
    """根据区间模板随机生成一注前区号码。"""
    numbers = []
    for zone in zones:
        numbers.append(rng.choice(ZONES[zone]))
    return sorted(numbers), zones


def generate_back_bet(combo: list[str], rng: random.Random) -> tuple[list[int], list[str]]:
    """根据后区类型组合随机生成一注后区号码。"""
    numbers = [rng.choice(BACK_TYPES[t]) for t in combo]
    return sorted(numbers), combo


def generate_issue(
    issue_no: int,
    draw_date: date | None = None,
    absolute_index: int | None = None,
    seed_mode: str = "random",
) -> DltIssue:
    """生成单期大乐透投注方案。"""
    if draw_date is None or absolute_index is None:
        draw_date, _, absolute_index = issue_to_date(issue_no)

    seed = make_seed(issue_no, seed_mode)
    rng = random.Random(seed)

    back_combos = rotate_back_combos(absolute_index)
    bets: list[DltBet] = []

    for i in range(BETS_PER_ISSUE):
        front, front_zones = generate_front_bet(FRONT_TEMPLATES[i], rng)
        back, back_types = generate_back_bet(back_combos[i], rng)
        bets.append(DltBet(
            bet_no=i + 1,
            front=front,
            back=back,
            front_zones=front_zones,
            back_types=back_types,
        ))

    return DltIssue(
        issue_no=issue_no,
        draw_date=draw_date.isoformat(),
        bets=bets,
        total_cost=BETS_PER_ISSUE * COST_PER_BET,
    )


def render_issue(issue: DltIssue) -> str:
    """将单期方案渲染为可读的字符串。"""
    lines = []
    lines.append("=" * 56)
    lines.append(f"大乐透均衡覆盖型投注方案")
    lines.append(f"期号：第 {issue.issue_no} 期    开奖日：{issue.draw_date}")
    lines.append(f"投注：{BETS_PER_ISSUE} 注追加    金额：{issue.total_cost} 元")
    lines.append("=" * 56)

    for bet in issue.bets:
        lines.append(
            f"第 {bet.bet_no} 注  "
            f"前区：{format_numbers(bet.front)}  "
            f"后区：{format_numbers(bet.back)}"
        )
        zones_str = " ".join(bet.front_zones)
        types_str = "+".join(bet.back_types)
        lines.append(f"          前区区间：{zones_str}    后区类型：{types_str}")
        lines.append("-" * 56)

    return "\n".join(lines)


def save_history(records: list[dict]) -> None:
    """将生成记录追加保存到历史文件。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    existing: list[dict] = []
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except (json.JSONDecodeError, OSError):
            existing = []

    existing.extend(records)
    existing.sort(key=lambda r: r.get("issue_no", 0))

    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)


def load_history() -> list[dict]:
    """加载历史生成记录。"""
    if not HISTORY_FILE.exists():
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return []


def validate_bet(bet: DltBet) -> list[str]:
    """验证单注号码是否符合大乐透规则及策略模板。"""
    errors = []
    if len(bet.front) != 5:
        errors.append(f"第 {bet.bet_no} 注前区号码数量错误")
    if len(set(bet.front)) != len(bet.front):
        errors.append(f"第 {bet.bet_no} 注前区有重复号码")
    if not all(1 <= n <= 35 for n in bet.front):
        errors.append(f"第 {bet.bet_no} 注前区号码越界")

    if len(bet.back) != 2:
        errors.append(f"第 {bet.bet_no} 注后区号码数量错误")
    if len(set(bet.back)) != len(bet.back):
        errors.append(f"第 {bet.bet_no} 注后区有重复号码")
    if not all(1 <= n <= 12 for n in bet.back):
        errors.append(f"第 {bet.bet_no} 注后区号码越界")

    expected_zones = FRONT_TEMPLATES[bet.bet_no - 1]
    if bet.front_zones != expected_zones:
        errors.append(f"第 {bet.bet_no} 注前区区间模板错误")

    return errors


def run_tests() -> None:
    """运行简单的单元测试和验证逻辑。"""
    print("运行验证测试...")

    issue_no, draw_date, abs_idx = get_issue_info(date(2025, 1, 1))
    assert issue_no == 2025001, f"期号错误：{issue_no}"
    assert draw_date == date(2025, 1, 1), f"日期错误：{draw_date}"
    assert abs_idx == 1, f"绝对序号错误：{abs_idx}"

    issue_no2, draw_date2, abs_idx2 = get_issue_info(date(2025, 1, 4))
    assert issue_no2 == 2025002, f"期号错误：{issue_no2}"
    assert draw_date2 == date(2025, 1, 4), f"日期错误：{draw_date2}"
    assert abs_idx2 == 2, f"绝对序号错误：{abs_idx2}"

    # 跨年期号验证
    issue_no3, draw_date3, _ = get_issue_info(date(2026, 7, 22))
    assert issue_no3 // 1000 == 2026, f"跨年期号年份错误：{issue_no3}"
    assert draw_date3 == date(2026, 7, 22), f"跨年期号日期错误：{draw_date3}"

    issue = generate_issue(2025001, seed_mode="date")
    assert issue.total_cost == 12
    assert len(issue.bets) == 4

    for bet in issue.bets:
        errors = validate_bet(bet)
        assert not errors, "\n".join(errors)

    # 验证可复现性
    issue_a = generate_issue(2025001, seed_mode="date")
    issue_b = generate_issue(2025001, seed_mode="date")
    for a, b in zip(issue_a.bets, issue_b.bets):
        assert a.front == b.front
        assert a.back == b.back

    # 验证后区轮换
    combos_0 = rotate_back_combos(0)
    combos_1 = rotate_back_combos(1)
    assert combos_0 != combos_1 or len(set(tuple(c) for c in BACK_COMBOS)) == 1

    print("所有测试通过。")


def main() -> int:
    parser = argparse.ArgumentParser(description="大乐透均衡覆盖型选号工具")
    parser.add_argument(
        "--count", "-n", type=int, default=1,
        help="生成期数（默认 1）"
    )
    parser.add_argument(
        "--save", "-s", action="store_true",
        help="将结果保存到历史文件"
    )
    parser.add_argument(
        "--history", action="store_true",
        help="显示历史生成记录"
    )
    parser.add_argument(
        "--seed", choices=["date", "random"], default="random",
        help="随机种子模式：date 基于期号可复现，random 完全随机（默认 random）"
    )
    parser.add_argument(
        "--test", action="store_true",
        help="运行单元测试"
    )
    parser.add_argument(
        "--date", type=str, default=None,
        help="指定起始日期（格式 YYYY-MM-DD），默认今天"
    )

    args = parser.parse_args()

    if args.test:
        run_tests()
        return 0

    if args.history:
        records = load_history()
        if not records:
            print("暂无历史记录。")
            return 0
        for record in records:
            bets = [DltBet(**b) for b in record.get("bets", [])]
            issue = DltIssue(
                issue_no=record["issue_no"],
                draw_date=record["draw_date"],
                bets=bets,
                total_cost=record["total_cost"],
            )
            print(render_issue(issue))
            print()
        return 0

    if args.count < 1:
        print("生成期数必须大于等于 1")
        return 1

    start_date = date.today()
    if args.date:
        try:
            start_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            print("日期格式错误，应为 YYYY-MM-DD")
            return 1

    start_issue, start_draw_date, _ = get_issue_info(start_date)
    issues_info = get_issue_numbers(start_issue, args.count)

    records: list[dict] = []
    for issue_no, draw_date, absolute_index in issues_info:
        issue = generate_issue(issue_no, draw_date, absolute_index, seed_mode=args.seed)
        print(render_issue(issue))
        print()
        records.append(asdict(issue))

    if args.save:
        save_history(records)
        print(f"已保存 {len(records)} 期记录到 {HISTORY_FILE}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
