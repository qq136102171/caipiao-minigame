.PHONY: help install run test web clean venv serve dlt history-fetch history-info history-top history-analyze history-seed app

PYTHON ?= python3
VENV   ?= .venv
VENV_PY := $(VENV)/bin/python

help:
	@echo "可用目标："
	@echo "  make install           - 创建虚拟环境并安装依赖（首次运行必需）"
	@echo "  make run / web / serve - 启动 Web 服务（http://127.0.0.1:1688）"
	@echo "  make test              - 运行 dlt_strategy.py 的单元测试"
	@echo "  make dlt               - 命令行生成 1 期大乐透号码"
	@echo "  make app               - 把项目打包成 macOS 原生 .app（双击启动）"
	@echo "  make history-fetch     - 从公开数据源拉取历史开奖（默认 200 期）"
	@echo "  make history-seed      - 写入内置示例历史数据（仅用于功能验证）"
	@echo "  make history-info      - 查看历史数据概况"
	@echo "  make history-top       - 查看热号 / 冷号 Top 5"
	@echo "  make history-analyze   - 对一组号码做命中分析（自定义主副区）"
	@echo "  make clean             - 删除虚拟环境与缓存"
	@echo ""
	@echo "微信小程序 CLI 集成（macOS / Linux 移植版）:"
	@echo "  make mp-ci             - 跑小程序静态检查（项目结构/JS/WXML/数据/JSON）"
	@echo "  make mp-ci-open        - 检查通过后自动打开开发者工具"
	@echo "  make mp-detect         - 探测官方 CLI 路径"
	@echo "  make mp-open           - 在开发者工具里打开 caipiao-miniprogram"
	@echo "  make mp-login          - 登录开发者工具"
	@echo "  make mp-islogin        - 检查登录状态"
	@echo "  make mp-preview        - 生成预览二维码"
	@echo "  make mp-upload         - 上传代码（需要 AppID + 私钥配置）"
	@echo "  make mp-close          - 关闭当前项目"
	@echo "  make mp-quit           - 退出开发者工具"
	@echo "  make mp-cache          - 清理开发者工具缓存"

install: $(VENV)/bin/python
$(VENV)/bin/python:
	@echo "==> 创建虚拟环境 $(VENV)"
	$(PYTHON) -m venv $(VENV)
	@echo "==> 安装依赖"
	$(VENV_PY) -m pip install --upgrade pip
	$(VENV_PY) -m pip install -r requirements.txt

run web serve: $(VENV)/bin/python
	@echo "==> 启动 Web 服务: http://127.0.0.1:1688"
	$(VENV_PY) web_app.py

test: $(VENV)/bin/python
	$(VENV_PY) dlt_strategy.py --test

dlt: $(VENV)/bin/python
	$(VENV_PY) dlt_strategy.py --count 1

HIST_TYPE ?= ssq
HIST_LIMIT ?= 200

history-fetch: $(VENV)/bin/python
	$(VENV_PY) fetch_history.py fetch --type $(HIST_TYPE) --limit $(HIST_LIMIT)

history-seed: $(VENV)/bin/python
	$(VENV_PY) fetch_history.py seed --type $(HIST_TYPE)

history-info: $(VENV)/bin/python
	$(VENV_PY) history.py info --type $(HIST_TYPE)

history-top: $(VENV)/bin/python
	$(VENV_PY) history.py top --type $(HIST_TYPE) -n 5

HIST_PRIMARY ?= 3,7,15,22,28,33
HIST_SECONDARY ?= 12
history-analyze: $(VENV)/bin/python
	$(VENV_PY) history.py analyze --type $(HIST_TYPE) --primary "$(HIST_PRIMARY)" --secondary "$(HIST_SECONDARY)"

sync-game-history: $(VENV)/bin/python
	$(VENV_PY) scripts/sync_history_to_game.py

sync-game-history-check: $(VENV)/bin/python
	$(VENV_PY) scripts/sync_history_to_game.py --check

clean:
	rm -rf $(VENV) dist
	find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name '.pytest_cache' -exec rm -rf {} + 2>/dev/null || true
	find . -name '.DS_Store' -delete 2>/dev/null || true
	@echo "==> 已清理虚拟环境、dist 与缓存"
# ============ 微信开发者工具 CLI 集成 ============
MP_SCRIPT := scripts/mp.sh
MP_PROJ   := caipiao-miniprogram

.PHONY: mp-ci mp-ci-open mp-detect mp-open mp-login mp-islogin mp-preview mp-upload mp-close mp-quit mp-cache

mp-ci:
	bash scripts/mp-ci.sh

mp-ci-open:
	bash scripts/mp-ci.sh --open

mp-detect:
	bash $(MP_SCRIPT) detect

mp-open:
	bash $(MP_SCRIPT) open $(MP_PROJ)

mp-login:
	bash $(MP_SCRIPT) login

mp-islogin:
	bash $(MP_SCRIPT) islogin

mp-preview:
	bash $(MP_SCRIPT) preview $(MP_PROJ)

# 上传代码：可通过 env 传 --ver / --desc
#   make mp-upload MP_VER=1.0.1 MP_DESC="修复bug"
mp-upload:
	bash $(MP_SCRIPT) upload $(MP_PROJ) --ver "$(or $(MP_VER),1.0.0)" --desc "$(or $(MP_DESC),CLI upload)"

mp-close:
	bash $(MP_SCRIPT) close $(MP_PROJ)

mp-quit:
	bash $(MP_SCRIPT) quit

mp-cache:
	bash $(MP_SCRIPT) cache
