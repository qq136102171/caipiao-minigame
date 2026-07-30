from secrets import SystemRandom

# 使用操作系统级熵源的密码学安全随机数生成器
_rng = SystemRandom()

# ===== 双色球生成规则配置 =====
SMALL_RANGE = list(range(1, 17))   # 小号 1-16
LARGE_RANGE = list(range(17, 34))  # 大号 17-33
BLUE_RANGE = list(range(1, 17))    # 蓝球 1-16

# 红球大小结构
STRUCTURE_2_4 = (2, 4)  # 2 小 4 大
STRUCTURE_3_3 = (3, 3)  # 3 小 3 大
STRUCTURE_4_2 = (4, 2)  # 4 小 2 大

# 原始策略：4 注同源 + 2 注独立
ORIGINAL_STRUCTURES = [STRUCTURE_2_4, STRUCTURE_3_3, STRUCTURE_4_2]

# 重叠约束
MAX_OVERLAP = 2  # 任意两组红球最多重叠 2 个


def _generate_red_group(small_count: int, large_count: int) -> set[int]:
    """从指定范围随机抽取红球，返回集合。"""
    smalls = set(_rng.sample(SMALL_RANGE, small_count))
    larges = set(_rng.sample(LARGE_RANGE, large_count))
    return smalls | larges


def _overlap_count(group1: set[int], group2: set[int]) -> int:
    """计算两组红球的重叠数量。"""
    return len(group1 & group2)


def generate_groups_original() -> tuple[set[int], set[int], set[int]]:
    """
    原始策略：生成 A/B/C 三组红球。
    A 与 B、A 与 C 最多重叠 2 个；B 与 C 建议最多重叠 3 个。
    """
    while True:
        red_a = _generate_red_group(*STRUCTURE_2_4)
        red_b = _generate_red_group(*STRUCTURE_3_3)
        red_c = _generate_red_group(*STRUCTURE_4_2)

        if _overlap_count(red_a, red_b) > MAX_OVERLAP:
            continue
        if _overlap_count(red_a, red_c) > MAX_OVERLAP:
            continue
        if _overlap_count(red_b, red_c) > 3:
            continue

        return red_a, red_b, red_c


def generate_blue_balls() -> list[int]:
    """生成 6 个互不重复的蓝球，保持随机抽取顺序。"""
    return _rng.sample(BLUE_RANGE, 6)


def make_bets_original(red_a: set[int], red_b: set[int], red_c: set[int],
                       blue_balls: list[int]) -> list[tuple[set[int], int]]:
    """原始策略：根据 A/B/C 三组红球生成 6 注号码。"""
    if len(blue_balls) != 6 or len(set(blue_balls)) != 6:
        raise ValueError("必须提供 6 个互不重复的蓝球")

    bets = []
    for i in range(4):
        bets.append((red_a, blue_balls[i]))
    bets.append((red_b, blue_balls[4]))
    bets.append((red_c, blue_balls[5]))
    return bets


def get_strategy_label(strategy: str) -> str:
    """获取策略中文名称。"""
    labels = {
        "original": "原始策略（4 同源 + 2 独立）",
    }
    return labels.get(strategy, strategy)


def print_generated_bets() -> None:
    """生成并打印一期双色球投注方案（原始策略：4 同源 + 2 独立）。"""
    blue_balls = generate_blue_balls()
    red_a, red_b, red_c = generate_groups_original()
    bets = make_bets_original(red_a, red_b, red_c, blue_balls)
    group_labels = ["A 组"] * 4 + ["B 组", "C 组"]
    extra_info = [
        ("A 组（2 小 4 大）", sorted(red_a)),
        ("B 组（3 小 3 大）", sorted(red_b)),
        ("C 组（4 小 2 大）", sorted(red_c)),
    ]
    overlap_info = [
        f"  A ∩ B = {_overlap_count(red_a, red_b)} 个 (约束 ≤{MAX_OVERLAP})",
        f"  A ∩ C = {_overlap_count(red_a, red_c)} 个 (约束 ≤{MAX_OVERLAP})",
        f"  B ∩ C = {_overlap_count(red_b, red_c)} 个 (建议 ≤3)",
    ]

    print("=" * 60)
    print("双色球投注方案生成 — 原始策略（4 同源 + 2 独立）")
    print("=" * 60)
    print(f"每期注数: 6 注 | 单注金额: 2 元 | 总成本: 12 元")
    print(f"蓝球（6 个互不重复）: {' '.join(f'{n:02d}' for n in blue_balls)}")
    print("-" * 60)

    for i, (reds, blue) in enumerate(bets, start=1):
        print(f"第 {i} 注  {format_bet(reds, blue)}  [{group_labels[i - 1]}]")

    print("-" * 60)
    print("红球结构检查:")
    for label, nums in extra_info:
        print(f"  {label}: {nums}")
    print("红球重叠约束检查:")
    for line in overlap_info:
        print(line)
    print("=" * 60)


def format_bet(red_balls: set[int], blue_ball: int) -> str:
    """格式化输出一注双色球号码。"""
    red = " ".join(f"{n:02d}" for n in sorted(red_balls))
    blue = f"{blue_ball:02d}"
    return f"红球: [{red}] | 蓝球: {blue}"


def generate_dlt_balanced(num_bets: int = 4) -> list[tuple[set[int], list[int], list[str], list[str]]]:
    """
    使用"均衡覆盖型"策略生成一期大乐透投注。

    每注包含：前区 5 个号码、后区 2 个号码、前区区间说明、后区类型说明。
    """
    from dlt_strategy import generate_issue

    issue = generate_issue(
        issue_no=2025001,
        draw_date=None,
        absolute_index=0,
        seed_mode="random",
    )
    return [
        (set(bet.front), bet.back, bet.front_zones, bet.back_types)
        for bet in issue.bets[:num_bets]
    ]


def get_lottery_label(lottery_type: str) -> str:
    """获取彩种中文名称。"""
    labels = {
        "ssq": "双色球",
        "dlt": "大乐透",
    }
    return labels.get(lottery_type, lottery_type)
