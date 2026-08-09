#!/bin/bash
# CaiPiao.app 启动器
# 双击本 .app 后执行：
#   1. 找到内嵌的项目目录
#   2. 在 Terminal 中启动 start.sh
#   3. 等待服务起来后自动打开浏览器
#
# 路径解析以本脚本自身的位置为锚点，因此 .app 可以放到任意位置。

set -u

# -------- 1. 定位内嵌项目 --------
SELF_PATH="$0"
# 通过 osascript / Launch Services 启动时 $0 可能是绝对路径，规范化
case "$SELF_PATH" in
    /*) ;;
    *)  SELF_PATH="$(cd "$(dirname "$SELF_PATH")" && pwd)/$(basename "$SELF_PATH")" ;;
esac

SELF_DIR="$(cd "$(dirname "$SELF_PATH")" && pwd)"
# SELF_DIR = .../CaiPiao.app/Contents/MacOS
APP_BUNDLE="$(cd "$SELF_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$APP_BUNDLE/Resources/project" && pwd)"
START_SH="$PROJECT_DIR/start.sh"

if [ ! -f "$START_SH" ]; then
    osascript -e 'display dialog "项目文件不完整，请重新构建 .app（运行 build_app.sh）。" buttons {"OK"} default button 1 with icon stop' &
    exit 1
fi

# -------- 2. 检查端口 --------
PORT="${PORT:-1688}"
PORT_BUSY=0
if command -v lsof >/dev/null 2>&1; then
    if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
        PORT_BUSY=1
    fi
elif command -v nc >/dev/null 2>&1; then
    if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
        PORT_BUSY=1
    fi
fi

if [ "$PORT_BUSY" -eq 1 ]; then
    CHOICE=$(osascript -e "display dialog \"端口 $PORT 已被占用，可能是服务已经在运行。\n\n点击「打开浏览器」直接查看已运行的服务；\n点击「取消」不做任何操作。\" buttons {\"打开浏览器\", \"取消\"} default button \"打开浏览器\"" 2>/dev/null || echo "取消")
    case "$CHOICE" in
        *打开浏览器*)
            open "http://127.0.0.1:$PORT" 2>/dev/null
            ;;
    esac
    exit 0
fi

# -------- 3. 在 Terminal 中启动 --------
TMPDIR_LAUNCH="$(mktemp -d -t caipiao-launch)"
LAUNCH_SH="$TMPDIR_LAUNCH/launch.sh"

# 用 printf %q 安全地把项目路径嵌入子脚本
{
    printf '%s\n' '#!/bin/bash'
    printf 'set +e\n'
    printf 'cd %q || { echo "无法进入项目目录：%s"; exit 1; }\n' "$PROJECT_DIR" "$PROJECT_DIR"
    printf 'clear\n'
    printf 'echo "💰  发财致富记录器"\n'
    printf 'echo "================================="\n'
    printf 'echo "项目目录：%s"\n' "$PROJECT_DIR"
    printf 'echo "服务地址：http://127.0.0.1:%s"\n' "$PORT"
    printf 'echo "停止服务：按 Ctrl-C，然后按任意键关闭窗口"\n'
    printf 'echo "================================="\n'
    printf 'echo\n'
    printf 'bash %q\n' "$START_SH"
    printf 'RC=$?\n'
    printf 'echo\n'
    printf 'echo "================================="\n'
    printf 'echo "服务已退出（退出码 $RC）。按任意键关闭窗口..."\n'
    printf 'read -n 1\n'
} > "$LAUNCH_SH"
chmod +x "$LAUNCH_SH"

# 用 osascript 调起 Terminal 并执行启动脚本
# 注：把 LAUNCH_SH 的路径用单引号包起来传给 bash，避免 AppleScript 转义陷阱
osascript <<APPLESCRIPT
tell application "Terminal"
    activate
    do script "bash '$LAUNCH_SH'"
end tell
APPLESCRIPT

# -------- 4. 等服务启动后打开浏览器 --------
# 简单等待；服务在 venv 已建好的情况下几秒就起来
sleep 4

# 再做一次健康检查：端口是否真的被监听
SERVICE_OK=0
if command -v lsof >/dev/null 2>&1 && lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
    SERVICE_OK=1
elif command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
    SERVICE_OK=1
fi

if [ "$SERVICE_OK" -eq 1 ]; then
    open "http://127.0.0.1:$PORT" 2>/dev/null
else
    # 端口还没起来，再等几秒重试一次
    sleep 4
    if command -v lsof >/dev/null 2>&1 && lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
        open "http://127.0.0.1:$PORT" 2>/dev/null
    else
        osascript -e 'display dialog "服务似乎还没起来，请查看 Terminal 窗口中的输出。" buttons {"OK"} default button 1 with icon caution' &
    fi
fi

exit 0
