#!/usr/bin/env bash
# 发布前数据库备份（pg_dump + gzip，按天数保留）。
# 用法：ENV_FILE=.env.prod COMPOSE_FILE=docker-compose-prod.yml bash scripts/ops/backup.sh
# deploy.sh 在换容器之前调用本脚本；失败即中止发布。
set -euo pipefail

cd "$(dirname "$0")/../.."

ENV_FILE=${ENV_FILE:-.env.prod}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose-prod.yml}
BACKUP_DIR=${BACKUP_DIR:-workspace/backups}
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}

# 必须导出：compose 用 ENV_FILE 插值出服务的 env_file；
# 不导出会退化成默认的 .env.prod —— 备份的是生产库而不是本环境库。
export ENV_FILE COMPOSE_FILE

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"
umask 077

stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/trend-suite-$stamp.sql.gz"
tmp="$out.tmp"
trap 'rm -f "$tmp"' EXIT

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists \
  | gzip > "$tmp"

mv "$tmp" "$out"
trap - EXIT

find "$BACKUP_DIR" -type f -name 'trend-suite-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "备份完成：$out"
