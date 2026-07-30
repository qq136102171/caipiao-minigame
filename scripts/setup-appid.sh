#!/usr/bin/env bash
# setup-appid.sh - 把 AppID 写入 project.config.json / project.private.config.json
#
# 用法：
#   bash scripts/setup-appid.sh wx1234567890abcdef        # 填入 AppID
#   bash scripts/setup-appid.sh                          # 交互式输入
#   bash scripts/setup-appid.sh --clear                   # 还原为 touristappid

set -e

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.."

MP_DIR="caipiao-miniprogram"
PCFG="$MP_DIR/project.config.json"
PRCFG="$MP_DIR/project.private.config.json"

if [[ "$1" == "--clear" ]]; then
    sed -i '' 's/"appid": "[^"]*"/"appid": "touristappid"/' "$PCFG"
    sed -i '' 's/"appid": "[^"]*"/"appid": "touristappid"/' "$PRCFG"
    echo "✓ 已还原为 touristappid（游客模式）"
    exit 0
fi

APPID="${1:-}"
if [[ -z "$APPID" ]]; then
    echo "请输入你的小程序 AppID（在微信公众平台 → 开发管理 → 开发设置）："
    read -r APPID
fi

# 简单校验：以 wx 开头 + 18 位
if [[ ! "$APPID" =~ ^wx[0-9a-f]{16}$ ]]; then
    echo "⚠ AppID 格式看起来不对（应类似 wx1234567890abcdef）。仍然写入。"
fi

# 替换
for f in "$PCFG" "$PRCFG"; do
    if [[ -f "$f" ]]; then
        # 用 python 替换（避免不同 sed 的兼容性）
        python3 -c "
import json, sys
p = '$f'
d = json.load(open(p))
d['appid'] = '$APPID'
with open(p, 'w') as fp:
    json.dump(d, fp, ensure_ascii=False, indent=2)
"
        echo "✓ 已更新 $f"
    fi
done

echo
echo "下一步："
echo "  1. 打开微信开发者工具 → 导入项目 caipiao-miniprogram/"
echo "  2. 点工具栏 '上传' 按钮（首次需登录）"
echo "  3. 登录 mp.weixin.qq.com → 版本管理 → 提交审核"
