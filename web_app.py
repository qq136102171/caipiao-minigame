from pathlib import Path

from flask import Flask, jsonify, render_template, request

from generator import (
    MAX_OVERLAP,
    generate_blue_balls,
    generate_dlt_balanced,
    generate_groups_original,
    get_lottery_label,
    get_strategy_label,
    make_bets_original,
)
from history import (
    analyze_bet,
    compute_number_stats,
    get_summary,
    get_top_bottom,
)

app = Flask(__name__)


def _overlap_count(group1: set, group2: set) -> int:
    return len(group1 & group2)


def _analyze_each_bet(lottery_type: str, bets: list) -> list:
    """对每注号码分别做历史命中分析。"""
    results = []
    for bet in bets:
        if lottery_type == "ssq":
            primary = bet["reds"]
            secondary = [bet["blue"]]
        else:
            primary = bet["fronts"]
            secondary = bet["backs"]
        analysis = analyze_bet(lottery_type, primary, secondary).to_dict()
        results.append(analysis)
    return results


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/generate", methods=["POST"])
def api_generate():
    data = request.get_json(silent=True) or {}
    lottery_type = data.get("lottery_type", "ssq")
    include_history = bool(data.get("include_history", True))

    if lottery_type == "dlt":
        bets = generate_dlt_balanced(num_bets=4)
        formatted_bets = [
            {
                "index": i + 1,
                "fronts": sorted(fronts),
                "backs": sorted(backs),
                "front_zones": front_zones,
                "back_types": back_types,
                "label": f"注 {i + 1}",
            }
            for i, (fronts, backs, front_zones, back_types) in enumerate(bets)
        ]
        response = {
            "lottery_type": lottery_type,
            "lottery_label": get_lottery_label(lottery_type),
            "strategy": "dlt_balanced",
            "strategy_label": "均衡覆盖型（4注追加）",
            "bets": formatted_bets,
            "structures": [],
            "overlap_checks": [],
            "total_bets": len(formatted_bets),
            "total_cost": len(formatted_bets) * 3,
        }
        if include_history:
            response["history"] = {
                "summary": get_summary(lottery_type).to_dict(),
                "per_bet": _analyze_each_bet(lottery_type, formatted_bets),
            }
        return jsonify(response)

    # 双色球：仅原始策略（4 同源 + 2 独立）
    blue_balls = generate_blue_balls()
    red_a, red_b, red_c = generate_groups_original()
    bets = make_bets_original(red_a, red_b, red_c, blue_balls)
    group_labels = ["A 组"] * 4 + ["B 组", "C 组"]
    structures = [
        ("A 组（2 小 4 大）", sorted(red_a)),
        ("B 组（3 小 3 大）", sorted(red_b)),
        ("C 组（4 小 2 大）", sorted(red_c)),
    ]
    overlap_checks = [
        {
            "name": "A ∩ B",
            "count": _overlap_count(red_a, red_b),
            "limit": MAX_OVERLAP,
        },
        {
            "name": "A ∩ C",
            "count": _overlap_count(red_a, red_c),
            "limit": MAX_OVERLAP,
        },
        {
            "name": "B ∩ C",
            "count": _overlap_count(red_b, red_c),
            "limit": 3,
        },
    ]

    formatted_bets = [
        {
            "index": i + 1,
            "reds": sorted(reds),
            "blue": blue,
            "label": group_labels[i],
        }
        for i, (reds, blue) in enumerate(bets)
    ]

    all_reds = set()
    for bet in formatted_bets:
        all_reds.update(bet["reds"])

    response = {
        "lottery_type": lottery_type,
        "lottery_label": get_lottery_label(lottery_type),
        "strategy": "original",
        "strategy_label": get_strategy_label("original"),
        "blue_balls": blue_balls,
        "bets": formatted_bets,
        "structures": structures,
        "overlap_checks": overlap_checks,
        "total_bets": len(formatted_bets),
        "total_cost": len(formatted_bets) * 2,
        "all_reds": sorted(all_reds),
    }
    if include_history:
        response["history"] = {
            "summary": get_summary(lottery_type).to_dict(),
            "per_bet": _analyze_each_bet(lottery_type, formatted_bets),
        }
    return jsonify(response)


# ===== 历史数据 API =====

@app.route("/api/history/info", methods=["GET"])
def api_history_info():
    """返回 SSQ / DLT 的历史数据概况。"""
    lottery_type = request.args.get("type", "ssq")
    if lottery_type not in ("ssq", "dlt"):
        return jsonify({"error": "type 必须为 ssq 或 dlt"}), 400
    summary = get_summary(lottery_type).to_dict()
    summary["has_data"] = summary["has_data"]
    return jsonify(summary)


@app.route("/api/history/stats", methods=["GET"])
def api_history_stats():
    """返回热号 / 冷号 Top N。"""
    lottery_type = request.args.get("type", "ssq")
    n = int(request.args.get("n", 5))
    if lottery_type not in ("ssq", "dlt"):
        return jsonify({"error": "type 必须为 ssq 或 dlt"}), 400
    result = get_top_bottom(lottery_type, n)
    return jsonify(result)


@app.route("/api/history/all-stats", methods=["GET"])
def api_history_all_stats():
    """返回所有号码的频率统计（前端画频谱图用）。"""
    lottery_type = request.args.get("type", "ssq")
    if lottery_type not in ("ssq", "dlt"):
        return jsonify({"error": "type 必须为 ssq 或 dlt"}), 400
    primary_stats, secondary_stats, total = compute_number_stats(lottery_type)
    return jsonify({
        "lottery_type": lottery_type,
        "total_draws": total,
        "primary": [s.to_dict() for s in primary_stats],
        "secondary": [s.to_dict() for s in secondary_stats],
    })


@app.route("/api/history/analyze", methods=["POST"])
def api_history_analyze():
    """对一组号码做命中分析（支持自定义号码，便于前端单独验证）。"""
    data = request.get_json(silent=True) or {}
    lottery_type = data.get("lottery_type", "ssq")
    if lottery_type not in ("ssq", "dlt"):
        return jsonify({"error": "type 必须为 ssq 或 dlt"}), 400

    if lottery_type == "ssq":
        primary = data.get("reds") or []
        secondary = [data["blue"]] if "blue" in data else []
    else:
        primary = data.get("fronts") or []
        secondary = data.get("backs") or []

    if not primary or not secondary:
        return jsonify({"error": "primary 与 secondary 均不能为空"}), 400

    analysis = analyze_bet(lottery_type, primary, secondary).to_dict()
    analysis["summary"] = get_summary(lottery_type).to_dict()
    return jsonify(analysis)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=1688, debug=True)
