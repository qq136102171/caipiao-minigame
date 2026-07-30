#!/usr/bin/env bash
# macOS 专用：通过 Finder 双击即启动。
# Finder 默认会以 user-shell (zsh / bash) 启动 .command 文件。

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# 默认走 bash 跑 start.sh；让用户在窗口里能看到输出而不是闪过一闪。
exec /usr/bin/env bash "$DIR/start.sh"
