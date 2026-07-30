#!/usr/bin/env bash
# macOS / Linux 启动脚本：创建/复用虚拟环境、安装依赖并启动 Web 服务。
# 双击或在终端执行均可：`bash start.sh` 或 `./start.sh`

set -euo pipefail

# 切到脚本所在目录，保证相对路径生效
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 检测操作系统（仅用于提示文案，不影响运行逻辑）
OS_NAME="$(uname -s)"
case "$OS_NAME" in
  Darwin) OS_LABEL="macOS" ;;
  Linux)  OS_LABEL="Linux" ;;
  *)      OS_LABEL="$OS_NAME" ;;
esac
echo "[start.sh] 平台: $OS_LABEL"

# 选择可用的 Python 3（macOS 自带 / 多个版本都能识别）
PYTHON_BIN=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "[start.sh] 未找到 Python 3.8+。请先安装：" >&2
  if [ "$OS_LABEL" = "macOS" ]; then
    echo "  - 推荐：brew install python3   或   https://www.python.org/downloads/macos/" >&2
  else
    echo "  - 推荐：sudo apt-get install python3 python3-venv python3-pip" >&2
  fi
  exit 1
fi

PY_VERSION="$("$PYTHON_BIN" -V 2>&1 || true)"
echo "[start.sh] Python: $PYTHON_BIN ($PY_VERSION)"

# 创建/复用虚拟环境
if [ ! -d ".venv" ]; then
  echo "[start.sh] 创建虚拟环境 .venv ..."
  "$PYTHON_BIN" -m venv .venv
fi

VENV_PY="$SCRIPT_DIR/.venv/bin/python"
VENV_PIP="$SCRIPT_DIR/.venv/bin/pip"

# 检测上一次创建的 venv 是否仍可用
if [ ! -x "$VENV_PY" ]; then
  echo "[start.sh] 虚拟环境损坏，删除并重建 ..."
  rm -rf "$SCRIPT_DIR/.venv"
  "$PYTHON_BIN" -m venv .venv
fi

echo "[start.sh] 安装/校验依赖 ..."
"$VENV_PIP" install --upgrade pip >/dev/null
"$VENV_PIP" install -r requirements.txt

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-1688}"

echo "[start.sh] 启动服务: http://${HOST}:${PORT}"
echo "[start.sh] 停止: Ctrl-C"

# exec 让 Ctrl-C 信号正常传递到子进程
exec "$VENV_PY" web_app.py
