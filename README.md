# 发财致富记录器（双色球 + 大乐透）

一个用 Flask 实现的本地选号小工具。提供：

- 双色球「原始策略」：3 组红球（2/4、3/3、4/2 偏置）+ 6 个互不重复蓝球
- 大乐透「均衡覆盖型」：前区 7 区间固定模板 + 后区奇偶类型轮换
- **🆕 历史数据分析**：每个球的历史出现率 / 热冷号分类 / 当前注的命中分布

> 仅供个人参考，请理性购彩。

---

## 1. 环境要求

| 项目 | 版本 |
| --- | --- |
| Python | **3.8+**（macOS 自带 3.9 或更高即可） |
| Flask | ≥ 3.0（详见 `requirements.txt`） |
| 操作系统 | macOS 12+ / Linux / Windows |

macOS 自带 Python 3，可直接使用；如果装了 Homebrew，也可以 `brew install python3`。

## 2. 在 macOS 上启动（最简方式）

### 方式 A：双击启动（Finder）

1. 在 Finder 中进入项目目录
2. **右键 `start.command` → 打开方式 → 终端**（首次需要右键确认权限）
3. 终端里会自动建 venv、装依赖、启动服务，看到：

   ```
   [start.sh] 启动服务: http://127.0.0.1:1688
   ```

4. 浏览器打开 [http://127.0.0.1:1688](http://127.0.0.1:1688)
5. 停服务：在终端窗口按 `Ctrl-C`

### 方式 B：终端命令

```bash
cd /path/to/CaiPiao
bash start.sh
# 或者
make install   # 第一次：装依赖
make run       # 启动 Web 服务
```

### 方式 C：手动

```bash
cd /path/to/CaiPiao
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python web_app.py
```

## 3. 跨平台说明

| 操作 | macOS / Linux（已有） | Windows（已有） |
| --- | --- | --- |
| 启动 Web | `start.sh` / `make run` | `start.bat` |
| 双击启动 | `start.command`（新增） | — |
| 启命令行大乐透 | `python3 dlt_strategy.py` | `python dlt_strategy.py` |

Python 源码已全部用 `pathlib` 处理路径、UTF-8 编码、LF 行尾，跨平台无须修改。

## 4. 命令行用法（仅大乐透）

```bash
# 跑一次单元测试，验证安装成功
make test
# 等价于：
.venv/bin/python dlt_strategy.py --test

# 生成 1 期大乐透号码
make dlt
# 等价于：
.venv/bin/python dlt_strategy.py --count 1

# 指定起始日期生成 5 期
.venv/bin/python dlt_strategy.py --count 5 --date 2026-07-23

# 生成并保存到 data/dlt_history.json
.venv/bin/python dlt_strategy.py --count 1 --save

# 可复现的随机种子（基于期号）
.venv/bin/python dlt_strategy.py --count 1 --seed date
```

## 5. HTTP API

### 5.1 生成号码

`POST /api/generate`

请求体：
```json
{ "lottery_type": "ssq" }   // 或 "dlt"
```

ssq 返回字段：`bets` / `structures` / `overlap_checks` / `total_bets` / `total_cost` / `all_reds` / `blue_balls`。
dlt 返回字段：`bets`（含 fronts/backs/front_zones/back_types）/ `total_bets` / `total_cost`。

每个彩种的返回里**新增 `history` 字段**，包含：
- `summary`：当前彩种的历史数据概况（期数、起止期号）
- `per_bet`：每注的命中分析（`primary_stats` / `secondary_stats` / `primary_avg_hits` / `secondary_avg_hits` / `primary_hit_distribution` / `secondary_hit_distribution` / `full_match_count` / `full_match_issues` / `level_breakdown`）

### 5.2 历史数据接口

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/history/info?type=ssq\|dlt` | 数据概况（总期数、最早/最新期号） |
| `GET` | `/api/history/stats?type=...&n=5` | 热号 / 冷号 Top N |
| `GET` | `/api/history/all-stats?type=...` | 所有号码的频率与热冷分类（画频谱用） |
| `POST` | `/api/history/analyze` | 对自定义号码做命中分析 |

`/api/history/analyze` 请求体示例：
```json
{"lottery_type":"ssq","reds":[3,7,15,22,28,33],"blue":12}
```

## 6. 历史数据分析 🆕

### 6.1 数据来源

历史数据存放在 `data/{ssq,dlt}_history.json` 里，按 `issue` 去重合并，格式：

```json
{
  "lottery_type": "ssq",
  "last_update": "2024-04-21",
  "total_draws": 30,
  "draws": [
    {"issue":"2024001","date":"2024-01-02","reds":[3,5,12,18,24,30],"blue":9}
  ]
}
```

### 6.2 首次拉取数据

```bash
# 方式 1：从公开数据源尝试拉取（会按 issue 自动去重合并）
.venv/bin/python fetch_history.py fetch --type ssq --limit 200
.venv/bin/python fetch_history.py fetch --type dlt --limit 200

# 方式 2：从 JSON 文件导入
.venv/bin/python fetch_history.py import-json --type ssq --file my_data.json

# 方式 3：从 CSV 文件导入
# CSV 表头（ssq）：issue,date,red1,red2,red3,red4,red5,red6,blue
# CSV 表头（dlt）：issue,date,front1,front2,front3,front4,front5,back1,back2
.venv/bin/python fetch_history.py import-csv --type dlt --file my_data.csv

# 方式 4：导入内置示例数据（每彩种几十期，仅用于功能验证）
.venv/bin/python fetch_history.py seed --type ssq
.venv/bin/python fetch_history.py seed --type dlt
```

JSON 文件可以是 list，或带 `draws` 字段的对象，字段名兼容 `reds` / `red` / `front` / `fronts` / `back` / `backs` / `blue`。

### 6.3 命令行查询

```bash
# 查看概况
.venv/bin/python history.py info --type ssq

# 查看热号 / 冷号
.venv/bin/python history.py top --type ssq -n 5

# 对一组号码做命中分析（主区逗号或空格分隔；副区同理）
.venv/bin/python history.py analyze \
    --type ssq --primary "3,7,15,22,28,33" --secondary "12"
```

### 6.4 Web 前端展示

打开 [http://127.0.0.1:1688](http://127.0.0.1:1688) 后，每次生成号码都会自动附带历史分析：

- **球下方小字**：该号码在历史开奖中出现的次数（鼠标悬停查看百分比）
- **球外圈颜色**：热号（橙红）/ 冷号（蓝）/ 温号（中性）
- **每注下方一行**：主区/副区平均命中数 + 热度分布 + 是否曾完全匹配
- **"查看历史分析" 折叠面板**：每注的命中分布 + 全局热/冷号 Top 5

右上角的"样本 N"指示当前彩种已加载多少期历史数据，N=0 时面板会提示去拉取数据。

> 注意：`fetch` 命令实际能否成功取决于当前网络环境与公开接口的可用性。如失败可改用 `import-json` / `import-csv` 导入本地数据集。

## 7. 项目结构

```
CaiPiao/
├── web_app.py           # Flask 入口
├── generator.py         # 双色球 + 大乐透编号生成器
├── dlt_strategy.py      # 大乐透均衡覆盖型 CLI（可独立运行）
├── history.py           # 🆕 历史数据分析（频率 / 热冷号 / 命中分析）
├── fetch_history.py     # 🆕 历史数据拉取 / 导入 CLI
├── templates/
│   └── index.html       # 票据样式前端（含历史分析面板）
├── static/
│   ├── css/style.css
│   └── js/app.js
├── data/                # dlt_history.json / ssq_history.json / dlt_history.json（生成记录）
├── requirements.txt
├── start.sh             # macOS/Linux 启动脚本
├── start.command        # macOS 双击启动入口
├── start.bat            # Windows 启动脚本
└── Makefile             # 常用任务封装
```

## 8. 常见问题

**Q：双击 `start.command` 提示「无法打开，因为它来自身份不明的开发者」**
A：右键该文件 → 打开方式 → 终端（或在「系统设置 → 隐私与安全性」点击「仍要打开」）。

**Q：第一次运行很慢**
A：首次启动时 `start.sh` 会自动 `pip install -r requirements.txt`，之后会有缓存。

**Q：`Permission denied`**
A：在终端执行 `chmod +x start.sh start.command`。

**Q：想换端口**
A：在启动前设置环境变量：`PORT=9000 bash start.sh`。

**Q：想允许局域网设备访问**
A：先在 `web_app.py` 把 `host="127.0.0.1"` 改成 `"0.0.0.0"`，再 `bash start.sh`。

**Q：历史数据多久更新一次？**
A：`fetch` 命令按需手动执行，不会在 Web 启动时自动拉取（避免每次启动都触发网络请求）。建议每次使用前手动跑一次。

## 9. macOS 原生 .app 双击启动

项目支持打包成 macOS 原生 `.app`，双击即可启动后端服务（适合不熟悉命令行的用户，或想发给朋友用）。

### 9.1 构建 .app

```bash
make app                # 输出 dist/CaiPiao.app
# 或指定输出目录
bash build_app.sh /Applications/CaiPiao
```

构建脚本会：
1. 生成标准的 macOS `.app` bundle（Info.plist / PkgInfo / MacOS/CaiPiao / Resources/...）
2. 把项目所有源文件复制进 `.app/Contents/Resources/project/`（不含 `.venv` 与缓存）
3. 用 Python + sips + iconutil 生成自定义红球图标（写入 `AppIcon.icns`）
4. 把整个 .app 注册到 Launch Services

最终产物约 588K，可以放到任何位置或打包 zip 分享。

### 9.2 使用方式

```
dist/CaiPiao.app/
├── Contents/
│   ├── Info.plist          # CFBundleDisplayName = "发财致富记录器"
│   ├── PkgInfo             # APPL????
│   ├── MacOS/
│   │   └── CaiPiao         # 启动器（launcher.sh 的副本）
│   └── Resources/
│       ├── AppIcon.icns    # 自定义红球图标
│       └── project/        # 完整项目（含 web_app.py / templates / data / ...）
```

**双击 `dist/CaiPiao.app`** 后会：
1. 弹出 Terminal 窗口，标题为"发财致富记录器"
2. 第一次运行会自动创建 `.venv` 并安装依赖（约 8 秒）
3. 启动 Flask 后端，监听 `http://127.0.0.1:1688`
4. 自动用默认浏览器打开 `http://127.0.0.1:1688`
5. 在 Terminal 窗口中按 `Ctrl-C` 可停止服务

启动器（`launcher.sh`）会自动处理：
- **端口被占用**：弹窗询问"打开浏览器 / 取消"，避免重复启动
- **项目缺失**：弹窗提示"请重新构建 .app"
- **服务起不来**：再等 4 秒重试，失败则提示查看 Terminal 输出

### 9.3 常见操作

```bash
# 1. 把 .app 装到 /Applications
make app && cp -R dist/CaiPiao.app /Applications/

# 2. 第一次启动时若提示「来自身份不明的开发者」
#    解决：右键 .app → 打开方式 → 打开（同 macOS 任何未签名 app 的处理方式）

# 3. 重新构建（修改了项目代码后）
make app

# 4. 替换图标
cp my_icon.icns dist/CaiPiao.app/Contents/Resources/AppIcon.icns
touch dist/CaiPiao.app

# 5. 把 .app 打包成 zip 分享
cd dist && zip -r CaiPiao.zip CaiPiao.app
```

> 注意：`.app` 是**自包含**的（项目文件 + 启动器全在里面），但首次启动时仍需要联网创建虚拟环境与安装 Flask。之后再次启动只需几秒。

## 10. 微信开发者工具 CLI 集成 🆕

把官方 `cli` 命令封装成了 Makefile 目标，让你可以不用打开开发者工具就能执行 `open / preview / upload / login / islogin / close / quit / cache` 等操作。

### 10.1 Makefile 目标

```bash
make mp-ci           # 跑小程序静态检查（项目结构 / JS / WXML / 数据 / JSON）
make mp-ci-open      # 检查通过后自动打开开发者工具
make mp-detect       # 探测官方 CLI 路径
make mp-open         # 在开发者工具里打开 caipiao-miniprogram
make mp-islogin      # 检查登录状态
make mp-login        # 登录（扫码）
make mp-preview      # 生成预览二维码
make mp-upload       # 上传代码（默认版本 1.0.0）
make mp-upload MP_VER=1.0.1 MP_DESC="修复bug"
make mp-close        # 关闭当前项目
make mp-quit         # 退出开发者工具
make mp-cache        # 清理开发者工具缓存
```

**首次使用前**：在微信开发者工具里打开「设置 → 安全设置 → 开启服务端口」。

### 10.2 脚本层

| 脚本 | 作用 |
| --- | --- |
| `scripts/mp.sh` | CLI 统一封装（探测路径 + 子命令） |
| `scripts/mp-ci.sh` | 本地 CI 静态检查 |
| `scripts/install-skill.sh` | 把 skill 装到 `~/.codex/skills/` |

直接调用：
```bash
bash scripts/mp.sh detect
bash scripts/mp.sh open caipiao-miniprogram
bash scripts/mp.sh preview
bash scripts/mp-ci.sh            # 静态检查
bash scripts/mp-ci.sh --open     # 检查通过后打开
bash scripts/install-skill.sh    # 装全局 skill
```

### 10.3 GitHub Actions CI

项目自带两个工作流：

| 文件 | 触发 | Runner | 作用 |
| --- | --- | --- | --- |
| `.github/workflows/miniprogram-ci.yml` | push / PR | ubuntu-latest | 静态检查（项目结构、JS 语法、WXML 配对、数据格式、JSON） |
| `.github/workflows/miniprogram-preview.yml` | 手动 / push | macos-14 | 调用官方 CLI 上传体验版（需配置 secrets：`WECHAT_APPID` + `WECHAT_PRIVATE_KEY`） |

### 10.4 MCP 集成（让 Codex 直接驱动 DevTools）

Codex 的 `~/.codex/config.toml` 已注册 `wechat_devtools` MCP server：

```toml
[mcp_servers.wechat_devtools]
command = "/Users/kuangjiajun/.local/bin/wechat-devtools-mcp"
args = []
startup_timeout_sec = 60

[mcp_servers.wechat_devtools.env]
WECHAT_DEVTOOLS_CLI = "/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
WECHAT_PROJECT_PATH = "/Users/kuangjiajun/Library/Mobile Documents/com~apple~CloudDocs/【vide coding】/CaiPiao/caipiao-miniprogram"
```

可用工具：`open / preview / upload / login / islogin / close / quit / cache`。

**首次安装**（用户）：
```bash
python3 -m pip install --user uv
uv tool install wechat-devtools-mcp --with "mcp<2.0" --force
```

> 注意：`wechat-devtools-mcp 0.9.10` 依赖 `mcp.server.fastmcp`（旧 API），必须装 `mcp<2.0`。
> 安装后**重启 Codex** 即可生效。

参考：[WaterTian/wechat-devtools-mcp](https://github.com/WaterTian/wechat-devtools-mcp)（已收录 [MCP Registry](https://modelcontextprotocol.io/)）

### 10.5 Codex Skill

项目根 `skills/wechat-miniprogram/SKILL.md` 是一个可复用的 Codex Skill，描述了：
- 项目结构与关键约束（JS 函数不能在 WXML 直接调用等）
- 全部 Makefile 目标
- 常见工作流（首次接入 / 改完代码 / 发布版本 / CI / MCP）
- 已知问题

**全局安装**（让 Codex 在任何项目都能用）：
```bash
bash scripts/install-skill.sh
# 或手动：
cp -R skills/wechat-miniprogram ~/.codex/skills/
```

下次启动 Codex 后，描述涉及「微信小程序 / 微信开发者工具 / 小程序开发 / 预览 / 上传」等时，Codex 会自动加载这个 skill。

参考：[Sun-sunshine06/miniprogram-skills](https://github.com/Sun-sunshine06/miniprogram-skills)

## 11. 完整的能力清单

| 能力 | 入口 |
| --- | --- |
| 选号（SSQ） | `make run` → Web，或 `python3 web_app.py` |
| 选号（DLT CLI） | `make dlt` 或 `python3 dlt_strategy.py` |
| 拉取历史数据 | `make history-fetch` |
| 历史分析 | Web UI / `make history-analyze` / 小程序 |
| 打包 macOS .app | `make app` |
| 双击启动服务 | Finder 里双击 `dist/CaiPiao.app` |
| 微信小程序 | `caipiao-miniprogram/` + 开发者工具 |
| 小程序静态检查 | `make mp-ci` |
| 小程序 CLI 包装 | `make mp-*`（9 个目标） |
| 小程序 CI（GitHub） | `.github/workflows/`（两个工作流） |
| Codex 驱动 DevTools | `wechat_devtools` MCP server |
| Codex 复用知识 | `wechat-miniprogram` skill |

## 12. 微信小程序发布 📦

把 `caipiao-miniprogram/` 上架到微信小程序平台。完整流程详见 [`docs/DEPLOY.md`](docs/DEPLOY.md)。

### 12.1 一图看懂流程

```
注册账号 ─→ 主体认证 ─→ 拿 AppID ─→ 填到项目 ─→ 开发者工具上传 ─→ 审核 ─→ 发布
                            │
                            └─ 我能帮你做的（✓ 已完成）：
                               ├─ 用户协议页 pages/agreement/
                               ├─ 隐私政策页 pages/privacy/
                               ├─ 一键填 AppID 脚本
                               └─ 完整部署指南
```

### 12.2 快速命令

```bash
# 1. 跑一遍静态检查
make mp-ci

# 2. 填 AppID（在微信公众平台拿到 wx 开头的 ID 后）
bash scripts/setup-appid.sh wx1234567890abcdef

# 3. 启动开发者工具，导入 caipiao-miniprogram/，点"上传"
make mp-open          # 或者在 Finder 里打开 caipiao-miniprogram/

# 4. 登录 mp.weixin.qq.com → 版本管理 → 提交审核
```

### 12.3 个人主体的限制

| 类型 | 可发"彩票"类 | 推荐度 |
| --- | --- | --- |
| 个人 | ❌（需改名+改类目） | ⚠️ |
| 个体工商户 | ✅ | ✅ 推荐 |
| 企业 | ✅ | ✅ 最佳 |

### 12.4 必备页面（已自动完成）

| 页面 | 文件路径 | 状态 |
| --- | --- | --- |
| 用户服务协议 | `caipiao-miniprogram/pages/agreement/` | ✅ 已写 |
| 隐私政策 | `caipiao-miniprogram/pages/privacy/` | ✅ 已写 |
| 首页底部协议链接 | `caipiao-miniprogram/pages/index/index.wxml` | ✅ 已加 |

### 12.5 详情

参见 [`docs/DEPLOY.md`](docs/DEPLOY.md)，包含：
- 注册账号详细步骤
- 个人主体类目选择技巧
- 5 张审核截图准备
- 常见被拒原因与规避
- 发布后维护流程
