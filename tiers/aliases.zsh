# omp tier aliases — 由 ~/.omp git 仓库统一管理
# 新机安装（一行，幂等）:
#   grep -q 'tiers/aliases.zsh' ~/.zshrc || echo 'source ~/.omp/tiers/aliases.zsh' >> ~/.zshrc

alias omp-kimi='omp --config ~/.omp/tiers/config-kimi.yml'
alias omp-glm='omp --config ~/.omp/tiers/config-glm.yml'
alias omp-glmf='omp --config ~/.omp/tiers/config-glm-flash.yml'
alias omp-klite='omp --config ~/.omp/tiers/config-kimi-256.yml'
alias omp-dsf='omp --config ~/.omp/tiers/config-deepseek-flash.yml'
alias omp-dsp='omp --config ~/.omp/tiers/config-deepseek-pro.yml'
alias omp-dsff='omp --config ~/.omp/tiers/config-deepseek-flash-free.yml'
alias omp-ask='omp --model cch_responses/deepseek-v4-flash'
