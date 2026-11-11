#!/usr/bin/env bash
# 生产发布唯一入口（骨架）：预检 → 备份 → 迁移 → 换容器 → 健康检查。
# 服务器布局与流程补全见 docs/backend/operations/deployment-runbook.md。
set -euo pipefail
cd "$(dirname "$0")/.."
echo "TODO: 发布流程按 runbook 补全" >&2
exit 1
