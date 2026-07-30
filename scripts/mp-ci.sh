#!/usr/bin/env bash
# mp-ci.sh - 本地 CI 流程（无需 GitHub Actions）
#
# 流程：
#   1. 检查项目结构
#   2. 检查 JS 语法
#   3. 检查 WXML 配对
#   4. 检查历史数据格式
#   5. （可选）打开开发者工具预览
#
# 用法：
#   bash scripts/mp-ci.sh                  # 跑全部静态检查
#   bash scripts/mp-ci.sh --open           # 检查通过后自动打开开发者工具

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MP_DIR="$PROJECT_DIR/caipiao-miniprogram"

DO_OPEN=0
for arg in "$@"; do
    case "$arg" in
        --open) DO_OPEN=1 ;;
        *) echo "❌ 未知参数: $arg"; exit 1 ;;
    esac
done

echo "=========================================="
echo "  小程序 CI 检查"
echo "  项目: $MP_DIR"
echo "=========================================="
echo

# ===== 1. 项目结构 =====
echo "[1/4] 检查项目结构"
required=(
    app.json app.js app.wxss sitemap.json project.config.json
    pages/index/index.wxml pages/index/index.wxss pages/index/index.js pages/index/index.json
    pages/agreement/index.wxml pages/agreement/index.wxss pages/agreement/index.js pages/agreement/index.json
    pages/privacy/index.wxml pages/privacy/index.wxss pages/privacy/index.js pages/privacy/index.json
    utils/random.js utils/generator.js utils/dlt.js utils/history.js
    data/ssq_history.js data/dlt_history.js
)
missing=()
for f in "${required[@]}"; do
    if [[ ! -f "$MP_DIR/$f" ]]; then
        missing+=("$f")
    fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
    echo "  ❌ 缺失 ${#missing[@]} 个文件："
    printf '     %s\n' "${missing[@]}"
    exit 1
fi
echo "  ✓ 25 个核心文件齐全"

# ===== 2. JS 语法 =====
echo
echo "[2/4] JS 大括号配对"
python3 << 'PYEOF'
import re, os, sys
issues = []
mp = "caipiao-miniprogram"
for root, _, files in os.walk(mp):
    for f in files:
        if not f.endswith(".js"): continue
        path = os.path.join(root, f)
        c = open(path).read()
        c = re.sub(r'//[^\n]*', '', c)
        c = re.sub(r'/\*[\s\S]*?\*/', '', c)
        c = re.sub(r"'(?:\\.|[^'\\])*'", '', c)
        c = re.sub(r'"(?:\\.|[^"\\])*"', '', c)
        c = re.sub(r'`(?:\\.|[^`\\])*`', '', c)
        for o, x in [("{", "}"), ("(", ")"), ("[", "]")]:
            if c.count(o) != c.count(x):
                issues.append(f"{path}: {o}{x} 不配对 ({c.count(o)}/{c.count(x)})")
if issues:
    for i in issues: print(f"  ✗ {i}")
    sys.exit(1)
print("  ✓ 所有 JS 文件大括号/括号配对")
PYEOF

# ===== 3. WXML 配对 =====
echo
echo "[3/4] WXML <block> 配对"
python3 << 'PYEOF'
import re, os, sys
issues = []
for root, _, files in os.walk("caipiao-miniprogram"):
    for f in files:
        if not f.endswith(".wxml"): continue
        path = os.path.join(root, f)
        c = open(path).read()
        c = re.sub(r'<!--[\s\S]*?-->', '', c)
        o = len(re.findall(r'<block[^>]*>', c))
        x = c.count("</block>")
        if o != x:
            issues.append(f"{path}: <block> 配对 {o}/{x}")
        # 检查 wx:if / wx:for 闭合
        open_tags = len(re.findall(r'<\w+\s[^>]*wx:if=', c))
        # 简化：不严格校验 wx:if，依赖开发工具
if issues:
    for i in issues: print(f"  ✗ {i}")
    sys.exit(1)
print("  ✓ 所有 WXML <block> 闭合")
PYEOF

# ===== 4. 历史数据 =====
echo
echo "[4/4] 历史数据格式"
python3 << 'PYEOF'
import re, os, sys
for f in ["caipiao-miniprogram/data/ssq_history.js",
          "caipiao-miniprogram/data/dlt_history.js"]:
    lines = re.findall(r'"([^"]+)"', open(f).read())
    data = [l for l in lines if "|" in l]
    issues = 0
    for line in data:
        parts = line.split("|")
        if len(parts) != 4: issues += 1; continue
        _, _, p, s = parts
        try:
            nums_p = [int(x) for x in p.split(",")]
            nums_s = [int(x) for x in s.split(",")]
            if f.endswith("ssq_history.js"):
                if len(nums_p) != 6 or not all(1 <= n <= 33 for n in nums_p): issues += 1
                if len(nums_s) != 1 or not all(1 <= n <= 16 for n in nums_s): issues += 1
            else:
                if len(nums_p) != 5 or not all(1 <= n <= 35 for n in nums_p): issues += 1
                if len(nums_s) != 2 or not all(1 <= n <= 12 for n in nums_s): issues += 1
        except ValueError:
            issues += 1
    if issues:
        print(f"  ✗ {f}: {issues} 期格式错")
        sys.exit(1)
    print(f"  ✓ {f}: {len(data)} 期合法")
PYEOF

# ===== 5. JSON 格式 =====
echo
echo "[5/5] JSON 格式校验"
python3 << 'PYEOF'
import json, sys
for f in ["caipiao-miniprogram/app.json",
          "caipiao-miniprogram/pages/index/index.json",
          "caipiao-miniprogram/project.config.json",
          "caipiao-miniprogram/sitemap.json"]:
    try:
        json.load(open(f))
        print(f"  ✓ {f}")
    except Exception as e:
        print(f"  ✗ {f}: {e}")
        sys.exit(1)
PYEOF

echo
echo "=========================================="
echo "  ✓ 全部检查通过"
echo "=========================================="

# ===== 可选：打开开发者工具 =====
if [[ "$DO_OPEN" -eq 1 ]]; then
    echo
    echo "==> 在开发者工具里打开 caipiao-miniprogram ..."
    bash "$SCRIPT_DIR/mp.sh" open "$MP_DIR"
fi
