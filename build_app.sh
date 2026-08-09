#!/usr/bin/env bash
# build_app.sh - 把当前项目打包成 macOS 原生 .app
# 用法：
#   bash build_app.sh                       # 生成 dist/CaiPiao.app
#   bash build_app.sh /Applications/CaiPiao # 直接安装到指定目录
#
# 双击生成的 .app 即可启动服务：
#   - 自动在 Terminal 中运行 start.sh
#   - 服务起来后自动打开浏览器到 http://127.0.0.1:1688

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="CaiPiao"
DISPLAY_NAME="发财致富记录器"
BUNDLE_ID="com.local.caipiao.launcher"
VERSION="1.0.0"

# 输出位置：默认 dist/，可作为第一个参数传入
TARGET_DIR="${1:-$SCRIPT_DIR/dist}"
APP_PATH="$TARGET_DIR/${APP_NAME}.app"
CONTENTS="$APP_PATH/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RES_DIR="$CONTENTS/Resources"
PROJ_DIR="$RES_DIR/project"
BUILD_DIR="$APP_PATH/.build"

echo "==> 清理旧产物 ..."
rm -rf "$APP_PATH"
mkdir -p "$MACOS_DIR" "$PROJ_DIR" "$BUILD_DIR"

# -------- Info.plist --------
echo "==> 写入 Info.plist ..."
cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>zh_CN</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key>
    <string>${DISPLAY_NAME}</string>
    <key>CFBundleExecutable</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>CFBundleSupportedPlatforms</key>
    <array>
        <string>MacOSX</string>
    </array>
    <key>CFBundleLocalizations</key>
    <array>
        <string>zh_CN</string>
        <string>en</string>
    </array>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.utilities</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>LSUIElement</key>
    <false/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>NSAppleScriptEnabled</key>
    <true/>
    <key>NSSupportsAutomaticTermination</key>
    <true/>
    <key>NSSupportsSuddenTermination</key>
    <false/>
    <key>CFBundleDocumentTypes</key>
    <array/>
</dict>
</plist>
EOF

# -------- PkgInfo --------
printf 'APPL????' > "$CONTENTS/PkgInfo"

# -------- 复制 launcher --------
echo "==> 复制启动器 ..."
cp "$SCRIPT_DIR/launcher.sh" "$MACOS_DIR/${APP_NAME}"
chmod +x "$MACOS_DIR/${APP_NAME}"

# -------- 复制项目文件 --------
echo "==> 复制项目文件 ..."
ITEMS=(
    web_app.py
    generator.py
    dlt_strategy.py
    history.py
    fetch_history.py
    requirements.txt
    start.sh
    start.command
    start.bat
    Makefile
    README.md
    templates
    static
    data
)

for item in "${ITEMS[@]}"; do
    if [ -e "$item" ]; then
        cp -R "$item" "$PROJ_DIR/"
        echo "    + $item"
    else
        echo "    ! 跳过（不存在）：$item"
    fi
done

# 清掉缓存

# 移除可能存在的虚拟环境，确保 .app 体积最小（首次运行时 start.sh 会重建）
find "$PROJ_DIR" -type d -name ".venv" -exec rm -rf {} + 2>/dev/null || true
find "$PROJ_DIR" -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
find "$PROJ_DIR" -name '.DS_Store' -delete 2>/dev/null || true

# 同步执行权限
chmod +x "$PROJ_DIR/start.sh" "$PROJ_DIR/start.command" "$PROJ_DIR/start.bat" 2>/dev/null || true

# -------- 可选：生成图标 --------
echo "==> 生成图标 ..."
ICON_OK=0
if command -v python3 >/dev/null 2>&1; then
    cat > "$BUILD_DIR/icon.py" <<'PYEOF'
"""生成 1024x1024 RGBA PNG（红球图标）。"""
import struct, sys, zlib, math
def png_chunk(typ, data):
    return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)

W = H = 1024
cx, cy = W/2, H/2
R = W/2 - 24
raw = bytearray()
for y in range(H):
    raw.append(0)
    for x in range(W):
        dx, dy = x-cx, y-cy
        d = math.sqrt(dx*dx + dy*dy)
        if d <= R:
            t = d/R
            r = int(255*(1-0.32*t)); g = int(20*(1-t)); b = int(40*(1-0.4*t))
            if (x-cx+R*0.3)**2 + (y-cy+R*0.3)**2 < (R*0.35)**2:
                r = min(255, r+50); g = min(255, g+40); b = min(255, b+40)
            raw += bytes([r,g,b,255])
        else:
            raw += bytes([0,0,0,0])
out = sys.argv[1]
data = (b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + png_chunk(b"IEND", b""))
with open(out, "wb") as f:
    f.write(data)
PYEOF

    SRC_PNG="$BUILD_DIR/icon_1024.png"
    ICONSET="$BUILD_DIR/AppIcon.iconset"
    mkdir -p "$ICONSET"

    if python3 "$BUILD_DIR/icon.py" "$SRC_PNG" 2>/dev/null; then
        # 用 sips 在 .app 内生成所有尺寸
        for px in 16 32 64 128 256 512 1024; do
            sips -z $px $px "$SRC_PNG" --out "$ICONSET/icon_${px}x${px}.png" >/dev/null 2>&1
        done
        sips -z 32 32     "$SRC_PNG" --out "$ICONSET/icon_16x16@2x.png"   >/dev/null 2>&1
        sips -z 64 64     "$SRC_PNG" --out "$ICONSET/icon_32x32@2x.png"   >/dev/null 2>&1
        sips -z 256 256   "$SRC_PNG" --out "$ICONSET/icon_128x128@2x.png" >/dev/null 2>&1
        sips -z 512 512   "$SRC_PNG" --out "$ICONSET/icon_256x256@2x.png" >/dev/null 2>&1
        sips -z 1024 1024 "$SRC_PNG" --out "$ICONSET/icon_512x512@2x.png" >/dev/null 2>&1

        # iconutil 输出到 .app 内（避开 /var/folders/）
        if iconutil -c icns "$ICONSET" -o "$RES_DIR/AppIcon.icns" 2>/dev/null; then
            ICON_OK=1
            echo "    ✓ 已生成 AppIcon.icns"
        else
            echo "    ! iconutil 失败（使用默认图标）"
        fi
    else
        echo "    ! 图标 PNG 生成失败（使用默认图标）"
    fi
else
    echo "    ! python3 不可用（使用默认图标）"
fi

# 清理临时目录
rm -rf "$BUILD_DIR"

# -------- 注册到 Launch Services --------
touch "$APP_PATH"

# -------- 输出信息 --------
APP_SIZE=$(du -sh "$APP_PATH" | cut -f1)
echo ""
echo "✅ 构建完成！"
echo "   路径：$APP_PATH"
echo "   大小：$APP_SIZE"
if [ "$ICON_OK" -eq 1 ]; then
    echo "   图标：自定义红球图标"
else
    echo "   图标：系统默认"
fi
echo ""
echo "👉 双击 $APP_PATH 即可启动服务"
echo ""
echo "可选后续操作："
echo "  - 把 .app 拖到 /Applications 或桌面"
echo "  - 把整个 .app 目录打包 zip 分享给别人（无需 Python 环境）"
echo "  - 如需自定义图标，替换 Contents/Resources/AppIcon.icns 后重新 touch 即可"
