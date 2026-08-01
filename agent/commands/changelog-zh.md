---
description: 查看 omp 更新日志并翻译成中文（可选版本号）
---

# Changelog-zh Command

查看 omp 更新日志，翻译成中文后讲给我听。

## Arguments

- `$1`: 可选。要查的版本号（如 `17.2.1`）。默认取本地 omp 当前版本。

## Steps

1. 确定版本：若提供了 `$1`，用 `$1` 作为目标版本；否则取本地 omp 当前版本（`omp --help` 第一行的 `vX.Y.Z`，去 `v` 前缀）。
2. 读取官方 CHANGELOG（权威源，标准 markdown）：`read https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/CHANGELOG.md`，从中找到 `## [版本] - 日期` 到下一个 `## [` 为止，不要漏条目。
3. 比对更新：GitHub 上最新发布版本是否高于本地？若是，结尾用一行提示「本地 X.Y.Z，最新 X.Y.Z，可升级」。
4. 翻译成中文，按 Added / Changed / Fixed / Removed / Breaking Changes 分类呈现；版本号、日期、技术术语、符号、issue/PR 链接保留原文。开头用一行写明「omp vX.Y.Z（日期）更新内容」。
