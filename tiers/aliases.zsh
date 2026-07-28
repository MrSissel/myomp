# omp tier aliases — 由 ~/.omp git 仓库统一管理
# 新机安装（一行，幂等）:
#   grep -q 'tiers/aliases.zsh' ~/.zshrc || echo 'source ~/.omp/tiers/aliases.zsh' >> ~/.zshrc

alias omp-kimi='omp --config ~/.omp/tiers/config-kimi.yml'
alias omp-glm='omp --config ~/.omp/tiers/config-glm.yml'
alias omp-ask='omp --model @smol'
