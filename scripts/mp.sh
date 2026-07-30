#!/usr/bin/env bash
# mp.sh - 微信开发者工具 CLI 统一封装
#
# 自动探测官方 CLI 路径（支持 macOS 官方包 + 移植版），并对常用命令
# 做了一层包装，让项目里的 mp-* Makefile target 不必关心 CLI 在哪。
#
# 用法：
#   bash scripts/mp.sh detect            # 显示检测到的 CLI 路径
#   bash scripts/mp.sh open  [PROJECT]   # 在开发者工具里打开项目
#   bash scripts/mp.sh login             # 登录开发者工具
#   bash scripts/mp.sh islogin           # 检查登录状态
#   bash scripts/mp.sh preview [PROJECT] # 生成预览二维码（需要已登录）
#   bash scripts/mp.sh upload  [PROJECT] [--ver VER] [--desc DESC]
#                                       # 上传代码（需要 AppID + 私钥）
#   bash scripts/mp.sh close  [PROJECT]  # 关闭项目
#   bash scripts/mp.sh quit              # 退出开发者工具
#   bash scripts/mp.sh cache             # 清理缓存
#
# 也可直接传任意参数透传：
#   bash scripts/mp.sh cli <args>...

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# CLI 探测候选路径（按优先级）
CLI_CANDIDATES=(
    "/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
    "/Applications/微信开发者工具.app/Contents/MacOS/cli"
    "/Applications/WeChat DevTools.app/Contents/MacOS/cli"
    "$HOME/.cache/wechat-devtool/cli"
    "/usr/local/bin/wechat-cli"
    "/opt/homebrew/bin/wechat-cli"
)

# Linux 移植版的 CLI（通常由 cytle/msojocs 提供，路径不固定）
if [[ -d "$HOME/wechat_web_devtools" ]]; then
    CLI_CANDIDATES+=("$HOME/wechat_web_devtools/bin/cli")
fi

# Windows (Git Bash / WSL)
CLI_CANDIDATES+=(
    "/c/Program Files (x86)/Tencent/微信web开发者工具/cli.bat"
    "/c/Program Files/Tencent/微信web开发者工具/cli.bat"
)

find_cli() {
    for c in "${CLI_CANDIDATES[@]}"; do
        if [[ -x "$c" ]]; then
            echo "$c"
            return 0
        fi
    done
    return 1
}

CLI="$(find_cli 2>/dev/null || true)"

# 帮助
print_help() {
    cat <<EOF
mp.sh - 微信开发者工具 CLI 封装

用法：
  bash scripts/mp.sh <command> [args...]

命令：
  detect           探测并显示 CLI 路径
  open  [path]     在开发者工具里打开项目（默认当前项目）
  login            登录开发者工具
  islogin          检查是否已登录
  preview [path]   生成预览二维码
  upload  [path]   上传代码到微信后台
  close  [path]    关闭指定项目
  quit             退出开发者工具
  cache            清理开发者工具缓存
  cli <args...>    透传任意参数给官方 CLI

环境变量：
  WECHAT_CLI       手动指定 CLI 路径（覆盖自动探测）

例子：
  bash scripts/mp.sh detect
  bash scripts/mp.sh open caipiao-miniprogram
  bash scripts/mp.sh upload caipiao-miniprogram --ver 1.0.0 --desc "首版"
EOF
}

ensure_cli() {
    if [[ -z "${WECHAT_CLI:-}" ]]; then
        if [[ -z "$CLI" ]]; then
            echo "❌ 没找到微信开发者工具 CLI。请确认："
            echo "   - macOS 官方客户端已安装（/Applications/wechatwebdevtools.app）"
            echo "   - 或 Linux 移植版在 $HOME/wechat_web_devtools"
            echo "   - 或设置 WECHAT_CLI=/path/to/cli"
            exit 1
        fi
        WECHAT_CLI="$CLI"
    fi
    if [[ ! -x "$WECHAT_CLI" ]]; then
        echo "❌ CLI 不可执行：$WECHAT_CLI"
        exit 1
    fi
}

# ===== 子命令 =====

cmd_detect() {
    echo "== 微信开发者工具 CLI 探测 =="
    if [[ -n "${WECHAT_CLI:-}" ]]; then
        echo "  ✓ WECHAT_CLI 已设置: $WECHAT_CLI"
        echo "  -h 输出："
        "$WECHAT_CLI" --help 2>&1 | head -10
        return 0
    fi
    for c in "${CLI_CANDIDATES[@]}"; do
        if [[ -x "$c" ]]; then
            echo "  ✓ 找到: $c"
            echo ""
            echo "  版本信息："
            "$c" --version 2>&1 | head -3 || true
            return 0
        fi
    done
    echo "  ✗ 未找到。请安装："
    echo "    - macOS: https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html"
    echo "    - Linux: https://github.com/cytle/wechat_web_devtools"
}

cmd_open() {
    ensure_cli
    local path="${1:-$PROJECT_DIR/caipiao-miniprogram}"
    [[ "$path" != /* ]] && path="$PROJECT_DIR/$path"
    echo "== 打开小程序项目 =="
    echo "  路径: $path"
    if [[ ! -d "$path" ]]; then
        echo "❌ 目录不存在: $path"
        exit 1
    fi
    "$WECHAT_CLI" open --project "$path"
}

cmd_login() {
    ensure_cli
    echo "== 登录 =="
    "$WECHAT_CLI" login
}

cmd_islogin() {
    ensure_cli
    "$WECHAT_CLI" islogin
}

cmd_preview() {
    ensure_cli
    local path="${1:-$PROJECT_DIR/caipiao-miniprogram}"
    [[ "$path" != /* ]] && path="$PROJECT_DIR/$path"
    echo "== 生成预览 =="
    echo "  路径: $path"
    "$WECHAT_CLI" preview --project "$path"
}

cmd_upload() {
    ensure_cli
    local path="${1:-$PROJECT_DIR/caipiao-miniprogram}"
    [[ "$path" != /* ]] && path="$PROJECT_DIR/$path"
    shift || true
    echo "== 上传代码 =="
    echo "  路径: $path"
    echo "  参数: $@"
    "$WECHAT_CLI" upload --project "$path" "$@"
}

cmd_close() {
    ensure_cli
    local path="${1:-$PROJECT_DIR/caipiao-miniprogram}"
    [[ "$path" != /* ]] && path="$PROJECT_DIR/$path"
    "$WECHAT_CLI" close --project "$path"
}

cmd_quit() {
    ensure_cli
    "$WECHAT_CLI" quit
}

cmd_cache() {
    ensure_cli
    "$WECHAT_CLI" cache --clean
}

cmd_cli() {
    ensure_cli
    "$WECHAT_CLI" "$@"
}

# ===== 入口 =====

cmd="${1:-help}"
shift || true

case "$cmd" in
    detect)      cmd_detect ;;
    open)        cmd_open "$@" ;;
    login)       cmd_login ;;
    islogin)     cmd_islogin ;;
    preview)     cmd_preview "$@" ;;
    upload)      cmd_upload "$@" ;;
    close)       cmd_close "$@" ;;
    quit)        cmd_quit ;;
    cache)       cmd_cache ;;
    cli)         cmd_cli "$@" ;;
    help|--help|-h) print_help ;;
    *) echo "❌ 未知命令: $cmd"; print_help; exit 1 ;;
esac
