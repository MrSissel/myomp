# ~/.omp — omp 个人配置仓库

跨机器同步的 omp（Oh My Pi）用户配置。白名单式 gitignore：只追踪配置文件，密钥与本机运行状态不入库。

## 仓库结构

```
agent/
  config.yml        # 全局设置：模型角色、retry/fallback 链、主题等
  models.yml        # provider 与模型清单（cch_anthropic: kimi-k3 / glm-5.2 / MiniMax-M3 / deepseek-v4-flash）
  keybindings.yml   # 快捷键
  APPEND_SYSTEM.md  # 追加系统提示词
  .env.example      # 密钥模板（真实 .env 不提交）
  extensions/       # 自定义扩展（本地还有 orca-agent-status / orca-prefill / orca-titlebar-spinner，Orca 托管生成，不入库）
tiers/
  config-kimi.yml   # overlay：default 角色切到 Kimi K3
  config-glm.yml    # overlay：default 角色切到 GLM 5.2
  config-kimi-256.yml # overlay：default 角色切到 Kimi K3 256K（小上下文档）
  config-deepseek-flash.yml # overlay：default 角色切到 DeepSeek V4 Flash（轻量档）
  config-deepseek-pro.yml   # overlay：default 角色切到 DeepSeek V4 Pro（主力档）
  aliases.zsh       # shell 别名（source 式，由 install.sh 注入）
marketplaces.json   # marketplace 源注册（catalogPath 为本机路径，还原时由 install.sh 重建）
plugins/installed_plugins.json   # 已装插件清单 + 版本（还原参考）
plugins/omp-plugins.lock.json    # 插件启用状态
install.sh          # 新机一键引导脚本（幂等）
```

## 新机部署

```zsh
git clone <本仓库> ~/.omp
~/.omp/install.sh          # 注入别名 + 生成 .env 模板 + 安装 marketplace 插件
# 编辑 ~/.omp/agent/.env，填入真实 CCH_API_KEY
source ~/.zshrc            # 或重开终端
```

`install.sh` 幂等，可重复执行：不会重复追加别名，不会覆盖已有 `.env`，插件安装对已装版本是 no-op。

## 插件（marketplace 安装，插件本体不入库）

ponytail / claude-auto-memory / claude-rules-bridge / deepseek-v4-anchor 来自 leader 仓库 cnzgray/omp-extensions，由 `install.sh` 第 3 步自动安装。插件本体存于 `~/.omp/plugins/{cache,node_modules}`，git 不入库且换机不备份——克隆到新机后跑一次 `install.sh` 即自动装好。`marketplaces.json` / `installed_plugins.json` / `omp-plugins.lock.json` 入库仅作还原参考（installPath 是绝对路径，新机必须重新 install）。

升级：leader 更新仓库后（注意 leader 常改代码不升版本号，`upgrade` 按版本比较会跳过），任一台机器执行

```zsh
omp plugin install --force ponytail@omp-extensions claude-auto-memory@omp-extensions claude-rules-bridge@omp-extensions deepseek-v4-anchor@omp-extensions
```

然后重启 omp 会话生效。

## 别名

| 别名 | 效果 |
|---|---|
| `omp-kimi` | 主模型 Kimi K3（tier overlay，其余配置继承全局） |
| `omp-glm` | 主模型 GLM 5.2 |
| `omp-klite` | 主模型 Kimi K3 256K（小上下文档，对应 config-kimi-256.yml） |
| `omp-dsf` | 主模型 DeepSeek V4 Flash（轻量档，对应 config-deepseek-flash.yml） |
| `omp-dsp` | 主模型 DeepSeek V4 Pro（主力档，对应 config-deepseek-pro.yml） |
| `omp-ask` | 轻量问答走 smol 角色（MiniMax-M3） |

overlay 机制：`--config` 指定的文件与全局 `config.yml` 深合并，只覆盖声明的字段，不整文件替换。

## 不同步的内容（gitignore 排除）

- `agent/.env` — API key，新机由 install.sh 从模板生成后手动填值
- `agent/*.db*`、`sessions/`、`blobs/`、`terminal-sessions/` — 本机运行状态与会话历史，换机不带过去
- `plugins/cache/`、`plugins/node_modules/` — marketplace 插件本体，换机由 install.sh 重新拉取
- `agent/extensions/orca-*.ts` — Orca 托管生成的扩展，每次 Orca 更新会重写，不入库

## 维护约定

- 改配置 → 提交推送，另一台机器 `git -C ~/.omp pull` 即同步
- 提交信息遵循约定式提交（Conventional Commits），描述用中文
- 新增 tier：在 `tiers/` 加 `config-<名字>.yml`（只写 `modelRoles.default` 差异），并在 `aliases.zsh` 加对应别名
- fallback 链在 `config.yml` 的 `retry.fallbackChains` 下按角色维护（当前 smol → deepseek-v4-flash）
