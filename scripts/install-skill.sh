#!/usr/bin/env bash
# install-skill.sh - 把项目内的 wechat-miniprogram skill 安装到 ~/.codex/skills/
# 用法：bash scripts/install-skill.sh
set -e
SKILL_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/skills/wechat-miniprogram"
SKILL_DST="$HOME/.codex/skills/wechat-miniprogram"
if [[ ! -d "$SKILL_SRC" ]]; then
    echo "❌ 源 skill 不存在: $SKILL_SRC"
    exit 1
fi
mkdir -p "$HOME/.codex/skills"
rm -rf "$SKILL_DST"
cp -R "$SKILL_SRC" "$SKILL_DST"
echo "✓ skill 已安装到 $SKILL_DST"
echo "  下次启动 Codex 即可在 skill 列表看到 wechat-miniprogram"
