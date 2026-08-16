#!/usr/bin/env zsh
# install.sh — 新机一键引导 omp 配置（幂等，可重复执行）
set -euo pipefail

OMP_DIR="${OMP_DIR:-$HOME/.omp}"
ZSHRC="${ZDOTDIR:-$HOME}/.zshrc"

# 1. 别名：向 .zshrc 注入 source 行（已存在则跳过）
SOURCE_LINE="source $OMP_DIR/tiers/aliases.zsh"
if grep -qF "$SOURCE_LINE" "$ZSHRC" 2>/dev/null; then
  echo "[跳过] 别名已存在于 $ZSHRC"
else
  printf '\n# omp tier aliases\n%s\n' "$SOURCE_LINE" >> "$ZSHRC"
  echo "[完成] 别名已写入 $ZSHRC"
fi

# 2. 密钥：从模板生成 .env（已存在则不覆盖）
if [[ -f "$OMP_DIR/agent/.env" ]]; then
  echo "[跳过] .env 已存在"
else
  cp "$OMP_DIR/agent/.env.example" "$OMP_DIR/agent/.env"
  echo "[完成] 已生成 agent/.env —— 请编辑填入真实 API key"
fi

# 3. marketplace 插件：从 cnzgray/omp-extensions 安装（幂等，已装则跳过）
#    marketplaces.json / installed_plugins.json / omp-plugins.lock.json 已入库备份；
#    但 installPath 是绝对路径，每台新机仍需重新 install 拉缓存
echo "[插件] 同步 omp-extensions marketplace..."
omp plugin marketplace add cnzgray/omp-extensions || echo "[警告] marketplace add 失败"
omp plugin install --force \
  ponytail@omp-extensions \
  claude-auto-memory@omp-extensions \
  claude-rules-bridge@omp-extensions \
  deepseek-v4-anchor@omp-extensions || echo "[警告] 插件安装失败，请手动 omp plugin install"

echo "完成。执行 source $ZSHRC 或重开终端使别名生效。"
