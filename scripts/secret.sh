#!/usr/bin/env bash
# secret.sh - 安全地管理微信小程序 AppSecret
#
# 用法：
#   bash scripts/secret.sh set         # 交互式输入并存到 macOS Keychain
#   bash scripts/secret.sh get         # 临时输出（用于本地测试，请勿 echo 到日志）
#   bash scripts/secret.sh del         # 删除
#   bash scripts/secret.sh env          # 导出到 .env.local（不进 git）
#
# 为什么用 Keychain？
#   - 不写入任何文本文件 → 不会泄漏到 git / 截图 / 终端历史
#   - 系统级加密存储
#   - macOS 自带，无需第三方依赖

set -e

KEYCHAIN_SERVICE="caipiao-miniprogram-appsecret"
ACCOUNT="wxe486cf36db681591"

cmd_set() {
    echo "请输入 AppSecret（粘贴后回车，输入不可见）："
    read -rs SECRET
    echo
    if [[ -z "$SECRET" ]]; then
        echo "❌ 未输入"
        exit 1
    fi
    # 存到 keychain
    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$ACCOUNT" 2>/dev/null || true
    security add-generic-password -s "$KEYCHAIN_SERVICE" -a "$ACCOUNT" -w "$SECRET"
    echo "✓ AppSecret 已存到 macOS Keychain"
    echo "  service: $KEYCHAIN_SERVICE"
    echo "  account: $ACCOUNT"
}

cmd_get() {
    local secret
    secret=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$ACCOUNT" -w 2>/dev/null) || {
        echo "❌ Keychain 里没找到，请先运行: bash scripts/secret.sh set"
        exit 1
    }
    echo "$secret"
}

cmd_del() {
    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$ACCOUNT" 2>/dev/null && \
        echo "✓ 已从 Keychain 删除" || echo "  没找到，无需删除"
}

cmd_env() {
    local secret
    secret=$(cmd_get)
    # 写到 .env.local（已在 .gitignore，不进 git）
    cat > .env.local << EOF
# 自动生成，请勿提交到 git
WECHAT_APPID=$ACCOUNT
WECHAT_APP_SECRET=$secret
EOF
    echo "✓ 已写入 .env.local"
    echo "  注意：.env.local 已在 .gitignore 里"
}

cmd="${1:-help}"
case "$cmd" in
    set)  cmd_set ;;
    get)  cmd_get ;;
    del)  cmd_del ;;
    env)  cmd_env ;;
    help|--help|-h)
        echo "用法：bash scripts/secret.sh {set|get|del|env}"
        ;;
    *) echo "❌ 未知命令: $cmd"; exit 1 ;;
esac
