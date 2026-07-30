---
name: "wechat-miniprogram"
description: "WeChat Mini Program (微信小程序) development workflow — use when working on a WeChat miniprogram project, when the user mentions 微信小程序 / miniprogram / WeChat DevTools / 小程序开发, when validating WXML/WXSS/JS project structure, when calling the official wechat devtools CLI (`cli open / preview / upload / login / islogin / close / quit / cache`), or when packaging a project as a `.app` for macOS. Covers the `caipiao-miniprogram` project layout (pages/, utils/, data/), the Makefile targets `mp-detect / mp-open / mp-preview / mp-upload / mp-login / mp-islogin / mp-close / mp-quit / mp-cache`, the local CI script `scripts/mp-ci.sh`, the official CLI path `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`, and the `wechat_devtools` MCP server registered in `~/.codex/config.toml`."
---

# 微信小程序开发工作流

本 skill 用于 **caipiao-miniprogram**（位于项目根的 `caipiao-miniprogram/`）以及其他微信小程序项目的常见操作。

## 何时使用

- 用户说"打开小程序"、"跑一下小程序"、"预览"、"上传"、"登录开发者工具"
- 项目结构改动后做静态检查（CI）
- 调用官方 `cli` 做 `open / preview / upload / login / islogin / close / quit / cache`
- 把项目打包成 macOS 原生 `.app` 让别人双击打开
- 通过 MCP（`wechat_devtools`）让 AI 直接驱动 DevTools

## 项目结构（caipiao-miniprogram）

```
caipiao-miniprogram/
├── app.{json,js,wxss} + sitemap.json   # 小程序入口
├── project.config.json + project.private.config.json   # 开发者工具配置
├── pages/index/                        # 主页面（wxml + wxss + js + json）
├── utils/                              # 业务逻辑（纯 JS，无依赖）
│   ├── random.js                       # 密码学安全随机源
│   ├── generator.js                    # SSQ 号码生成（移植自 generator.py）
│   ├── dlt.js                          # DLT 号码生成（移植自 dlt_strategy.py）
│   └── history.js                      # 历史数据分析（移植自 history.py）
├── data/                               # 内置历史开奖数据
│   ├── ssq_history.js                  # 紧凑格式: issue|date|reds|blue
│   └── dlt_history.js                  # 紧凑格式: issue|date|front|back
└── preview.html / preview_dlt.html     # 浏览器里的预览（无需开发者工具）
```

### 关键约束

1. **JS 函数不能在 WXML 直接调用**：`{{pad(x)}}` / `{{pct(x)}}` 都会报错。
   解决：所有展示字段都在 JS 里预计算后存到 `data`。
2. **数据文件必须用 `module.exports = [...]`**：紧凑字符串格式 `issue|date|primary|secondary`。
3. **`rpx` 单位**：1 rpx = 0.5 px（按 750 rpx 设计稿换算）。
4. **个人主体小程序**：不能配置服务器域名 → 项目必须纯前端。

## 常用操作（Makefile 目标）

```bash
# 项目根目录运行：

# 静态检查（项目结构 + JS 语法 + WXML 配对 + 历史数据 + JSON）
make mp-ci                    # 或 bash scripts/mp-ci.sh

# 自动检查通过后打开开发者工具
make mp-ci-open               # 或 bash scripts/mp-ci.sh --open

# 微信开发者工具 CLI
make mp-detect                # 探测官方 CLI 路径
make mp-open                  # 在开发者工具里打开 caipiao-miniprogram
make mp-islogin               # 检查登录状态
make mp-login                 # 登录（扫码）
make mp-preview               # 生成预览二维码
make mp-upload                # 上传代码（用 make mp-upload MP_VER=1.0.1 MP_DESC="说明" 覆盖版本/描述）
make mp-close / mp-quit       # 关闭项目 / 退出开发者工具
make mp-cache                 # 清理开发者工具缓存
```

**重要**：第一次需要先在开发者工具里「设置 → 安全设置 → 开启服务端口」。

## 官方 CLI 路径探测

自动探测候选路径（macOS 官方 / Linux 移植版 / Windows）：

| 平台 | 路径 |
| --- | --- |
| macOS 官方 | `/Applications/wechatwebdevtools.app/Contents/MacOS/cli` |
| macOS 中文包名 | `/Applications/微信开发者工具.app/Contents/MacOS/cli` |
| macOS 英文包名 | `/Applications/WeChat DevTools.app/Contents/MacOS/cli` |
| Linux 移植版 | `~/wechat_web_devtools/bin/cli` |
| Windows | `<安装路径>/cli.bat` |

环境变量 `WECHAT_CLI` 可手动覆盖。

## 常见工作流

### 1. 第一次接入新项目

```bash
make mp-detect                # 确认 CLI 路径
make mp-open                  # 在开发者工具里打开
make mp-login                 # 扫码登录
```

### 2. 改完代码后

```bash
make mp-ci                    # 跑静态检查
make mp-open                  # 打开 / 重新打开项目
make mp-preview               # 生成预览二维码（拿手机扫码看效果）
```

### 3. 发布新版本

```bash
make mp-islogin               # 确认已登录
make mp-upload MP_VER=1.0.1 MP_DESC="修复 bug #42"
```

### 4. CI 集成（GitHub Actions）

- `.github/workflows/miniprogram-ci.yml`：跨平台静态检查（ubuntu）
- `.github/workflows/miniprogram-preview.yml`：macOS runner 上传（需要 secrets: `WECHAT_APPID` + `WECHAT_PRIVATE_KEY`）

### 5. 通过 MCP 让 AI 直接驱动 DevTools

Codex 的 `~/.codex/config.toml` 已配置：

```toml
[mcp_servers.wechat_devtools]
command = "/Users/kuangjiajun/.local/bin/wechat-devtools-mcp"
args = []
startup_timeout_sec = 60

[mcp_servers.wechat_devtools.env]
WECHAT_DEVTOOLS_CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
WECHAT_PROJECT_PATH = "/Users/kuangjiajun/Library/Mobile Documents/com~apple~CloudDocs/【vide coding】/CaiPiao/caipiao-miniprogram"
```

重启 Codex 后会自动加载。可用工具：open / preview / upload / login / islogin / close / quit / cache。

## 安装本 skill（全局可用）

```bash
bash scripts/install-skill.sh
# 或手动：
cp -R skills/wechat-miniprogram ~/.codex/skills/
```

## 已知问题

- **`mcp.server.fastmcp` 已不存在于 mcp 2.0+**：`wechat-devtools-mcp 0.9.10` 需要 `mcp<2.0`。安装时若报 `ModuleNotFoundError: mcp.server.fastmcp`，需用 `uv tool install --with "mcp<2.0"` 重装。
- **Linux 用户没有官方 CLI**：需要用移植版（[cytle/wechat_web_devtools](https://github.com/cytle/wechat_web_devtools)），路径不固定。
- **首次打开项目开发者工具会卡 5-10s**：正常，等就好。

## 外部参考

- 官方文档: <https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html>
- CLI 包装: <https://github.com/NewFuture/wechat-devtool>
- MCP: <https://github.com/WaterTian/wechat-devtools-mcp>
- Skills: <https://github.com/Sun-sunshine06/miniprogram-skills>
