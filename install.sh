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

echo "完成。执行 source $ZSHRC 或重开终端使别名生效。"
