"""
历史开奖数据分析模块。

提供：
- 从本地 JSON 加载历史开奖数据
- 单号频率 / 出现比率统计
- 热号 / 冷号 / 温号分类
- 对当前一组号码做"历史命中"分析
- JSON 合并 / 去重 / 排序

数据格式（data/{ssq,dlt}_history.json）：
{
  "lottery_type": "ssq" | "dlt",
  "last_update": "YYYY-MM-DD",
  "total_draws": int,
  "draws": [
    {"issue": str, "date": "YYYY-MM-DD",
     "reds"|"front": list[int],
     "blue": int (ssq) | "back": list[int] (dlt)}
  ]
}
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable

# ===== 历史数据存储路径 =====
DATA_DIR = Path(__file__).parent / "data"
SSQ_HISTORY_FILE = DATA_DIR / "ssq_history.json"
DLT_HISTORY_FILE = DATA_DIR / "dlt_history.json"

# ===== 彩种规则 =====
SSQ_RULE = {
    "primary_range": range(1, 34),
    "primary_count": 6,
    "primary_label": "红球",
    "secondary_range": range(1, 17),
    "secondary_count": 1,
    "secondary_label": "蓝球",
}

DLT_RULE = {
    "primary_range": range(1, 36),
    "primary_count": 5,
    "primary_label": "前区",
    "secondary_range": range(1, 13),
    "secondary_count": 2,
    "secondary_label": "后区",
}

RULES = {
    "ssq": SSQ_RULE,
    "dlt": DLT_RULE,
}


def history_file(lottery_type: str) -> Path:
    return SSQ_HISTORY_FILE if lottery_type == "ssq" else DLT_HISTORY_FILE


# ===== 数据类 =====

@dataclass
class Draw:
    issue: str
    date: str
    reds: list[int] = field(default_factory=list)
    blue: int | None = None
    front: list[int] = field(default_factory=list)
    back: list[int] = field(default_factory=list)

    def primary(self) -> list[int]:
        return self.reds if self.reds else self.front

    def secondary(self) -> list[int]:
        if self.blue is not None:
            return [self.blue]
        return self.back

    def primary_set(self) -> set[int]:
        return set(self.primary())

    def secondary_set(self) -> set[int]:
        return set(self.secondary())


@dataclass
class HistorySummary:
    lottery_type: str
    total_draws: int
    last_update: str | None
    earliest_issue: str | None
    latest_issue: str | None
    earliest_date: str | None
    latest_date: str | None
    has_data: bool

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class NumberStat:
    number: int
    frequency: int
    rate: float
    expected_rate: float
    deviation: float
    level: str

    def to_dict(self) -> dict:
        return {
            "number": self.number,
            "frequency": self.frequency,
            "rate": round(self.rate, 4),
            "expected_rate": round(self.expected_rate, 4),
            "deviation": round(self.deviation, 4),
            "level": self.level,
        }


@dataclass
class HitAnalysis:
    bet: dict
    total_draws: int
    primary_stats: list[dict]
    secondary_stats: list[dict]
    primary_avg_hits: float
    secondary_avg_hits: float
    primary_hit_distribution: dict
    secondary_hit_distribution: dict
    full_match_count: int
    full_match_issues: list
    level_breakdown: dict

    def to_dict(self) -> dict:
        return {
            "bet": self.bet,
            "total_draws": self.total_draws,
            "primary_stats": self.primary_stats,
            "secondary_stats": self.secondary_stats,
            "primary_avg_hits": round(self.primary_avg_hits, 4),
            "secondary_avg_hits": round(self.secondary_avg_hits, 4),
            "primary_hit_distribution": {str(k): v for k, v in self.primary_hit_distribution.items()},
            "secondary_hit_distribution": {str(k): v for k, v in self.secondary_hit_distribution.items()},
            "full_match_count": self.full_match_count,
            "full_match_issues": self.full_match_issues,
            "level_breakdown": self.level_breakdown,
        }


# ===== 加载 / 保存 =====

def _normalize_draw(raw: dict, lottery_type: str) -> Draw | None:
    issue = str(raw.get("issue", "")).strip()
    if not issue:
        return None

    draw_date = str(raw.get("date", "")).strip()

    if lottery_type == "ssq":
        reds = raw.get("reds") or raw.get("red") or []
        blue = raw.get("blue")
        if not reds:
            return None
        if isinstance(reds, str):
            reds = [int(x) for x in reds.replace(",", " ").split() if x.strip()]
        if not isinstance(blue, int):
            return None
        return Draw(issue=issue, date=draw_date, reds=[int(x) for x in reds], blue=int(blue))

    front = raw.get("front") or raw.get("fronts") or raw.get("reds") or []
    back = raw.get("back") or raw.get("backs") or []
    if not front or not back:
        return None
    if isinstance(front, str):
        front = [int(x) for x in front.replace(",", " ").split() if x.strip()]
    if isinstance(back, str):
        back = [int(x) for x in back.replace(",", " ").split() if x.strip()]
    return Draw(issue=issue, date=draw_date, front=[int(x) for x in front], back=[int(x) for x in back])


def load_history(lottery_type: str) -> list:
    path = history_file(lottery_type)
    if not path.exists():
        return []

    try:
        with path.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []

    raw_draws = payload.get("draws", []) if isinstance(payload, dict) else []
    draws = []
    for raw in raw_draws:
        draw = _normalize_draw(raw, lottery_type)
        if draw is not None:
            draws.append(draw)

    draws.sort(key=lambda d: d.issue)
    return draws


def save_history(lottery_type: str, draws: Iterable, last_update: str | None = None) -> Path:
    existing = load_history(lottery_type)
    by_issue = {d.issue: d for d in existing}
    for d in draws:
        by_issue[d.issue] = d

    merged = sorted(by_issue.values(), key=lambda d: d.issue)
    rule = RULES[lottery_type]

    if lottery_type == "ssq":
        serialized = [
            {"issue": d.issue, "date": d.date, "reds": sorted(d.reds), "blue": d.blue}
            for d in merged
        ]
    else:
        serialized = [
            {"issue": d.issue, "date": d.date, "front": sorted(d.front), "back": sorted(d.back)}
            for d in merged
        ]

    payload = {
        "lottery_type": lottery_type,
        "last_update": last_update or datetime.now().strftime("%Y-%m-%d"),
        "total_draws": len(merged),
        "primary_label": rule["primary_label"],
        "secondary_label": rule["secondary_label"],
        "primary_max": max(rule["primary_range"]),
        "secondary_max": max(rule["secondary_range"]),
        "draws": serialized,
    }

    path = history_file(lottery_type)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path


def get_summary(lottery_type: str) -> HistorySummary:
    draws = load_history(lottery_type)
    if not draws:
        return HistorySummary(
            lottery_type=lottery_type,
            total_draws=0,
            last_update=None,
            earliest_issue=None,
            latest_issue=None,
            earliest_date=None,
            latest_date=None,
            has_data=False,
        )

    return HistorySummary(
        lottery_type=lottery_type,
        total_draws=len(draws),
        last_update=None,
        earliest_issue=draws[0].issue,
        latest_issue=draws[-1].issue,
        earliest_date=draws[0].date,
        latest_date=draws[-1].date,
        has_data=True,
    )


# ===== 单号频率统计 =====

def _frequency(draws, getter) -> Counter:
    counter = Counter()
    for d in draws:
        counter.update(getter(d))
    return counter


def _classify_levels(stats: list) -> list:
    if not stats:
        return stats
    freqs = sorted({s.frequency for s in stats})
    n = len(freqs)
    low_threshold = freqs[max(0, n // 3) - 1] if n >= 3 else freqs[0]
    high_threshold = freqs[min(n - 1, 2 * n // 3)]
    if low_threshold == high_threshold:
        low_threshold = high_threshold - 1

    for s in stats:
        if s.frequency >= high_threshold and high_threshold > low_threshold:
            s.level = "hot"
        elif s.frequency <= low_threshold:
            s.level = "cold"
        else:
            s.level = "warm"
    return stats


def compute_number_stats(lottery_type: str):
    draws = load_history(lottery_type)
    rule = RULES[lottery_type]
    primary_pool_size = len(rule["primary_range"])
    secondary_pool_size = len(rule["secondary_range"])
    expected_primary = rule["primary_count"] / primary_pool_size
    expected_secondary = rule["secondary_count"] / secondary_pool_size

    primary_counter = _frequency(draws, lambda d: d.primary())
    secondary_counter = _frequency(draws, lambda d: d.secondary())

    total = max(1, len(draws))

    primary_stats = []
    for n in rule["primary_range"]:
        freq = primary_counter.get(n, 0)
        rate = freq / total
        primary_stats.append(NumberStat(
            number=n,
            frequency=freq,
            rate=rate,
            expected_rate=expected_primary,
            deviation=rate - expected_primary,
            level="warm",
        ))

    secondary_stats = []
    for n in rule["secondary_range"]:
        freq = secondary_counter.get(n, 0)
        rate = freq / total
        secondary_stats.append(NumberStat(
            number=n,
            frequency=freq,
            rate=rate,
            expected_rate=expected_secondary,
            deviation=rate - expected_secondary,
            level="warm",
        ))

    _classify_levels(primary_stats)
    _classify_levels(secondary_stats)

    return primary_stats, secondary_stats, len(draws)


def get_top_bottom(lottery_type: str, n: int = 5) -> dict:
    primary_stats, secondary_stats, total = compute_number_stats(lottery_type)
    if total == 0:
        return {
            "primary_hot": [], "primary_cold": [],
            "secondary_hot": [], "secondary_cold": [],
            "total_draws": 0,
        }

    p_hot = sorted(primary_stats, key=lambda s: s.frequency, reverse=True)[:n]
    p_cold = sorted(primary_stats, key=lambda s: s.frequency)[:n]
    s_hot = sorted(secondary_stats, key=lambda s: s.frequency, reverse=True)[:n]
    s_cold = sorted(secondary_stats, key=lambda s: s.frequency)[:n]

    return {
        "primary_hot": [s.to_dict() for s in p_hot],
        "primary_cold": [s.to_dict() for s in p_cold],
        "secondary_hot": [s.to_dict() for s in s_hot],
        "secondary_cold": [s.to_dict() for s in s_cold],
        "total_draws": total,
    }


# ===== 命中分析 =====

def _missing_number(n: int, pool_size: int, total: int) -> dict:
    return {
        "number": n,
        "frequency": 0,
        "rate": 0.0,
        "expected_rate": pool_size / max(1, total) if total else 0.0,
        "deviation": 0.0,
        "level": "warm",
    }


def analyze_bet(lottery_type: str, primary_numbers, secondary_numbers) -> HitAnalysis:
    primary_stats, secondary_stats, total = compute_number_stats(lottery_type)
    draws = load_history(lottery_type)

    p_set = set(primary_numbers)
    s_set = set(secondary_numbers)

    p_by_number = {s.number: s.to_dict() for s in primary_stats}
    s_by_number = {s.number: s.to_dict() for s in secondary_stats}

    primary_hits = []
    secondary_hits = []
    full_match_issues = []

    p_distribution = Counter()
    s_distribution = Counter()

    for d in draws:
        p_hits = len(p_set & d.primary_set())
        s_hits = len(s_set & d.secondary_set())
        primary_hits.append(p_hits)
        secondary_hits.append(s_hits)
        p_distribution[p_hits] += 1
        s_distribution[s_hits] += 1
        if p_hits == len(p_set) and s_hits == len(s_set):
            full_match_issues.append(d.issue)

    primary_avg = (sum(primary_hits) / len(primary_hits)) if primary_hits else 0.0
    secondary_avg = (sum(secondary_hits) / len(secondary_hits)) if secondary_hits else 0.0

    p_selected = [p_by_number.get(n, _missing_number(n, len(primary_numbers), total)) for n in primary_numbers]
    s_selected = [s_by_number.get(n, _missing_number(n, len(secondary_numbers), total)) for n in secondary_numbers]

    level_breakdown = {"hot": 0, "warm": 0, "cold": 0}
    for stat in p_selected + s_selected:
        level_breakdown[stat["level"]] = level_breakdown.get(stat["level"], 0) + 1

    bet_payload = (
        {"reds": sorted(primary_numbers), "blue": secondary_numbers[0]}
        if lottery_type == "ssq"
        else {"fronts": sorted(primary_numbers), "backs": sorted(secondary_numbers)}
    )

    return HitAnalysis(
        bet=bet_payload,
        total_draws=total,
        primary_stats=p_selected,
        secondary_stats=s_selected,
        primary_avg_hits=primary_avg,
        secondary_avg_hits=secondary_avg,
        primary_hit_distribution=dict(sorted(p_distribution.items())),
        secondary_hit_distribution=dict(sorted(s_distribution.items())),
        full_match_count=len(full_match_issues),
        full_match_issues=full_match_issues[:10],
        level_breakdown=level_breakdown,
    )


# ===== 简易 CLI =====

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="彩票历史数据统计")
    sub = parser.add_subparsers(dest="cmd")

    info_p = sub.add_parser("info", help="查看历史数据概况")
    info_p.add_argument("--type", choices=["ssq", "dlt"], default="ssq")

    top_p = sub.add_parser("top", help="查看热号 / 冷号")
    top_p.add_argument("--type", choices=["ssq", "dlt"], default="ssq")
    top_p.add_argument("-n", type=int, default=5)

    analyze_p = sub.add_parser("analyze", help="对一组号码做命中分析")
    analyze_p.add_argument("--type", choices=["ssq", "dlt"], default="ssq")
    analyze_p.add_argument("--primary", required=True)
    analyze_p.add_argument("--secondary", required=True)

    args = parser.parse_args()

    if args.cmd == "info":
        s = get_summary(args.type)
        if not s.has_data:
            print(f"{args.type} 暂无历史数据，请先运行 fetch_history.py 拉取数据。")
        else:
            print(f"彩种: {args.type}")
            print(f"总期数: {s.total_draws}")
            print(f"最早: {s.earliest_issue} ({s.earliest_date})")
            print(f"最新: {s.latest_issue} ({s.latest_date})")
    elif args.cmd == "top":
        result = get_top_bottom(args.type, args.n)
        if result["total_draws"] == 0:
            print(f"{args.type} 暂无历史数据。")
        else:
            print(f"\n=== {args.type.upper()} 热号 / 冷号 Top {args.n}（基于 {result['total_draws']} 期）===")
            for section, label in [
                ("primary_hot", "主区热号"),
                ("primary_cold", "主区冷号"),
                ("secondary_hot", "副区热号"),
                ("secondary_cold", "副区冷号"),
            ]:
                items = result[section]
                if items:
                    print(f"\n{label}: " + " ".join(
                        f"{it['number']:02d}({it['frequency']})" for it in items
                    ))
    elif args.cmd == "analyze":
        primary = [int(x) for x in args.primary.replace(",", " ").split() if x.strip()]
        secondary = [int(x) for x in args.secondary.replace(",", " ").split() if x.strip()]
        r = analyze_bet(args.type, primary, secondary)
        d = r.to_dict()
        print(f"\n=== {args.type.upper()} 命中分析（基于 {d['total_draws']} 期）===")
        print(f"主区号码: {primary} 平均每期命中: {d['primary_avg_hits']}")
        print(f"副区号码: {secondary} 平均每期命中: {d['secondary_avg_hits']}")
        print(f"主区命中分布: {d['primary_hit_distribution']}")
        print(f"副区命中分布: {d['secondary_hit_distribution']}")
        print(f"完全匹配期数: {d['full_match_count']}")
        print(f"号码热度: {d['level_breakdown']}")
    else:
        parser.print_help()
