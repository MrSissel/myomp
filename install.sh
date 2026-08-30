#!/usr/bin/env zsh
# install.sh — 新机一键引导 omp 配置（幂等，可重复执行）
# ponytail: 不再向 ~/.zshrc 注入别名 —— ~/.zshrc 是指向 dotfiles 仓库的软链，
# 写入会污染 git 仓库；别名已由本地 shell 配置（~/.zshrc.local / local.fish）
# source tiers/aliases，此处无需重复。
set -euo pipefail

OMP_DIR="${OMP_DIR:-$HOME/.omp}"

# 1. 密钥：从模板生成 .env（已存在则不覆盖）
if [[ -f "$OMP_DIR/agent/.env" ]]; then
  echo "[跳过] .env 已存在"
else
  cp "$OMP_DIR/agent/.env.example" "$OMP_DIR/agent/.env"
  echo "[完成] 已生成 agent/.env —— 请编辑填入真实 API key"
fi

# 2. 插件安装需要 omp CLI；非交互环境下由 mise 提供，先激活
if ! command -v omp >/dev/null 2>&1 && command -v mise >/dev/null 2>&1; then
  eval "$(mise activate zsh)"
fi

# 3. marketplace 插件：从 cnzgray/omp-extensions 安装（幂等，已装则跳过）
#    marketplaces.json / installed_plugins.json / omp-plugins.lock.json 已入库备份；
#    但 installPath 是绝对路径，每台新机仍需重新 install 拉缓存
if command -v omp >/dev/null 2>&1; then
  echo "[插件] 同步 omp-extensions marketplace..."
  omp plugin marketplace add cnzgray/omp-extensions || echo "[警告] marketplace add 失败"
  omp plugin install --force \
    ponytail@omp-extensions \
    claude-auto-memory@omp-extensions \
    claude-rules-bridge@omp-extensions \
    deepseek-v4-anchor@omp-extensions || echo "[警告] 插件安装失败，请手动 omp plugin install"
else
  echo "[警告] omp CLI 不可用，跳过插件安装。装好 mise 后重跑本脚本。"
fi

echo "完成。别名由本地 shell 配置加载（~/.zshrc.local / local.fish），重开终端生效。"
