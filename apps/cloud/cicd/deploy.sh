#!/usr/bin/env bash
# ============================================================
# 部署脚本 —— CI/CD 的唯一部署入口（staging 与 production 共用一份）
#
# 用法：
#   sudo bash cicd/deploy.sh --env staging --tag develop-<sha> [--image-repo <registry/ns/repo>]
#   sudo bash cicd/deploy.sh --env prod     --tag main-<sha>    [--image-repo <registry/ns/repo>]
#
# 流程：参数校验 → 预检 → .env.<env> 备份轮转 + 钉 IMAGE_TAG/TREND_IMAGE_REPO →
#       数据库备份（前置）→ 拉镜像 → 数据库迁移（先行）→ 换容器 → 健康检查 →
#       落 .deploy-state → 失败自动回滚 → 镜像/备份清理
#
# 设计约束（继承前身系统实战结论，详见 docs/ops/01部署Runbook.md）：
#   - 部署逻辑只有这一份，可评审、可回溯；CI 不内联长命令
#   - staging 与 prod 只差 env 文件与 tag 前缀（develop-/main-），其余完全一致
#   - 迁移先行：迁移失败则旧版本继续服务，零影响
#   - 迁移与应用同一个镜像（镜像内含 migrations/）：线上执行的迁移必然与本次发布的代码同 commit
#   - 失败自动回滚到上一个 tag，回滚保留现场（日志不删）
#   - 镜像按仓库保留最新 N 个（当前 + N-1 个回滚目标）；只清悬空层，
#     绝不用 docker image prune -a（会删掉回滚目标）
#   - 镜像清理由退出兜底保证：无论成功、失败还是中途退出都跑一次
#
# 依赖：docker + docker compose v2；目标机需 root（docker 组权限不足）
# ============================================================
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

ENV_NAME=""
IMAGE_TAG=""
IMAGE_REPO=""
KEEP_IMAGES="${DEPLOY_KEEP_IMAGES:-3}"
DISK_MIN_FREE_GB="${DEPLOY_DISK_MIN_FREE_GB:-5}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-300}"
STATE_FILE="$APP_ROOT/.deploy-state"
COMMIT_FILE="$APP_ROOT/.deploy-commit"
LOG_DIR="$APP_ROOT/.deploy"
COMPOSE_FILE="docker-compose-prod.yml"
# 镜像清理的豁免版本列表（当前运行版本 + 回滚目标）：退出兜底的清理要用，
# 部署中途中断时按它们豁免删除
PROTECT_TAGS=""
# 清理涉及的镜像仓库路径列表（本次发布的目标仓库 + 回滚目标仓库）。
# 必须在改 env 文件之前算出来：回滚后 env 指回旧仓库，退出兜底若照
# env 推导，只会清旧仓库，刚拉下来的新仓库镜像永远留在盘上
CLEANUP_REPOS=""
CLEANUP_DONE=0
# 退出兜底是否可用：豁免版本名单算出来之前不装 trap（否则清理会误删回滚目标）
TRAP_READY=0
# 应用镜像服务（app 与 migrate 共用一个镜像，pull 一次即可）
APP_SERVICES="app migrate"
# 基础镜像服务：版本固定、服务器上长期存在，拉取失败可容忍（本地已有副本）
BASE_SERVICES="db caddy"

log()  { printf '[deploy %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
warn() { printf '[deploy %s] WARN: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
fail() { printf '[deploy %s] ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
用法: bash cicd/deploy.sh --env <staging|prod> --tag <branch>-<sha> [--image-repo <registry/ns/repo>]

  --env   staging（测试环境，tag 前缀 develop-）或 prod（生产环境，tag 前缀 main-）
  --tag   期望 <branch>-<sha>（短 sha 或完整 sha）
  --image-repo  镜像仓库路径（registry/namespace/repo）。CI 必传：与本次推送的
                仓库严格一致，避免 compose 里的默认路径与 CI 推送目标漂移。
                省略时沿用 env 文件里已钉的 TREND_IMAGE_REPO。
EOF
}

# ---------------------------------------------------------------- 参数解析

parse_args() {
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --env) ENV_NAME="${2:-}"; shift 2 ;;
            --tag) IMAGE_TAG="${2:-}"; shift 2 ;;
            --image-repo) IMAGE_REPO="${2:-}"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            *) fail "未知参数：$1（-h 看用法）" ;;
        esac
    done
    [ -n "$ENV_NAME" ] || { usage >&2; fail "缺少 --env"; }
    [ -n "$IMAGE_TAG" ] || { usage >&2; fail "缺少 --tag"; }
}

validate() {
    # 环境名决定 env 文件与合法 tag 前缀（staging=develop-，prod=main-）
    case "$ENV_NAME" in
        staging) ENV_FILE=".env.staging"; TAG_PREFIX="develop" ;;
        prod)    ENV_FILE=".env.prod";    TAG_PREFIX="main" ;;
        *) fail "--env 只支持 staging 或 prod，收到：$ENV_NAME" ;;
    esac
    # ENV_FILE 必须导出：compose 用它插值出服务的 env_file（容器读哪份环境配置）。
    # 不导出会退化成默认的 .env.prod —— staging 容器静默加载生产域名与生产库口令。
    export ENV_FILE
    # tag 同时是镜像引用的一部分，只放行「本环境前缀 + sha」白名单正则，
    # 杜绝注入、误传 latest、以及把 develop 的 tag 发到生产（反之亦然）
    local tag_re="^${TAG_PREFIX}-[0-9a-f]{7,40}$"
    echo "$IMAGE_TAG" | grep -Eq "$tag_re" \
        || fail "非法镜像 tag：${IMAGE_TAG}（环境 ${ENV_NAME} 要求匹配 ${tag_re}）"
    # 镜像仓库路径同样进 env 文件（compose 的 image 引用），按 registry/ns/repo 三段校验
    if [ -n "$IMAGE_REPO" ]; then
        local repo_re='^[a-zA-Z0-9._-]+(:[0-9]+)?/[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$'
        echo "$IMAGE_REPO" | grep -Eq "$repo_re" \
            || fail "非法镜像仓库路径：${IMAGE_REPO}（要求 registry/namespace/repo）"
    fi
}

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

# ---------------------------------------------------------------- 小工具

stat_owner() {
    stat -c '%u:%g' "$1" 2>/dev/null || stat -f '%u:%g' "$1" 2>/dev/null || echo ""
}

env_get() {
    # 读 env 文件的某个键（不做 shell 求值，避免值里的 ${VAR} 被提前展开）
    local key="$1" default="${2:-}" val
    val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
    if [ -n "$val" ]; then printf '%s' "$val"; else printf '%s' "$default"; fi
}

rotate_env_backup() {
    # .env.<env> → .bak → .bak.1 → .bak.2（最多 3 份）
    rm -f "$ENV_FILE.bak.2"
    [ -f "$ENV_FILE.bak.1" ] && mv "$ENV_FILE.bak.1" "$ENV_FILE.bak.2" || true
    [ -f "$ENV_FILE.bak" ] && mv "$ENV_FILE.bak" "$ENV_FILE.bak.1" || true
    cp "$ENV_FILE" "$ENV_FILE.bak"
}

set_env_var() {
    local key="$1" val="$2" tmp
    tmp="$(mktemp "${TMPDIR:-/tmp}/deploy-env.XXXXXX")"
    if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
        awk -v k="$key" -v v="$val" '
            $0 ~ "^"k"=" { print k"="v; next }
            { print }
        ' "$ENV_FILE" > "$tmp"
    else
        cat "$ENV_FILE" > "$tmp"
        printf '%s=%s\n' "$key" "$val" >> "$tmp"
    fi
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
}

restore_owner() {
    # 目标机以 root 执行本脚本，env 文件属主须还原给运维账号
    local owner="$1"
    [ -n "$owner" ] || return 0
    chown "$owner" "$ENV_FILE" "$ENV_FILE.bak" "$ENV_FILE.bak.1" "$ENV_FILE.bak.2" 2>/dev/null || true
}

# 判断某个词是否在以空白分隔的列表里
in_list() {
    local needle="$1" list="$2" item
    for item in $list; do
        [ "$item" = "$needle" ] && return 0
    done
    return 1
}

# 往清理范围里追加一个仓库路径（去重；空值忽略）
append_repo() {
    local r="$1" existing
    [ -n "$r" ] || return 0
    for existing in $CLEANUP_REPOS; do
        [ "$existing" = "$r" ] && return 0
    done
    CLEANUP_REPOS="$CLEANUP_REPOS $r"
}

restore_prev_tag() {
    # 失败发生在换容器之前：把 IMAGE_TAG（与镜像仓库路径）退回上一个版本，
    # 保持配置与实际运行版本一致
    local prev="$1" owner="$2" prev_repo="${3:-}"
    set_env_var IMAGE_TAG "$prev"
    if [ -n "$prev_repo" ]; then
        set_env_var TREND_IMAGE_REPO "$prev_repo"
    fi
    restore_owner "$owner"
    warn "IMAGE_TAG 已退回 ${prev:-（空）}"
}

# ---------------------------------------------------------------- 预检

preflight() {
    command -v docker >/dev/null 2>&1 || fail "docker 不存在"
    docker compose version >/dev/null 2>&1 || fail "docker compose v2 不可用（需 compose plugin）"
    docker info >/dev/null 2>&1 || fail "无权访问 docker daemon（目标机请用 sudo 执行本脚本）"

    [ -f "$COMPOSE_FILE" ] || fail "缺少 compose 文件：$COMPOSE_FILE"
    [ -f "$ENV_FILE" ] || fail "缺少 ${ENV_FILE}（部署前须先准备，见 docs/ops/01部署Runbook.md）"

    # 迁移服务必须存在：没有它就没有独立的迁移步骤
    # grep 不带 -q：-q 命中即退出会让上游吃 SIGPIPE，pipefail 下误判为失败
    compose --profile migrate config --services 2>/dev/null | grep -x migrate >/dev/null \
        || fail "compose 未定义 migrate 服务（迁移独立执行要求该服务存在）"

    # 磁盘余量：workspace（数据库 + 管线 + 证书）所在卷才是真正会涨的地方
    local free_gb disk_path="$APP_ROOT"
    free_gb="$(df -Pk "$disk_path" | awk 'NR==2 {printf "%d", $4/1048576}')"
    if [ "${free_gb:-0}" -lt "$DISK_MIN_FREE_GB" ]; then
        fail "磁盘剩余 ${free_gb}G < 阈值 ${DISK_MIN_FREE_GB}G（${disk_path}），先清理磁盘"
    fi
    log "预检通过：磁盘剩余 ${free_gb}G（${disk_path}）"

    local db_id db_health
    db_id="$(compose ps -q db 2>/dev/null || true)"
    if [ -z "$db_id" ]; then
        # 首次发布时服务器上还没有 db 容器。db 用版本固定的 pgvector 镜像，
        # 不参与应用发布，这里拉起它；已有实例则完全不动。
        log "db 未运行，先拉起（版本固定的 pgvector 镜像，不参与应用发布）"
        compose up -d --wait db || fail "db 启动失败"
        db_id="$(compose ps -q db 2>/dev/null || true)"
    fi
    [ -n "$db_id" ] || fail "db 容器未运行"
    db_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_id")"
    [ "$db_health" = "healthy" ] || [ "$db_health" = "running" ] \
        || fail "db 未就绪：$db_health"
}

# ---------------------------------------------------------------- 备份

run_backup() {
    # 发布前备份：迁移 forward-only 且不做自动回滚，schema 变更不可逆，
    # 没有这份备份就没有退路。备份失败即中止发布（旧版本继续服务）。
    if [ "${DEPLOY_SKIP_BACKUP:-0}" = "1" ]; then
        warn "DEPLOY_SKIP_BACKUP=1，跳过发布前备份"
        return 0
    fi
    [ -x scripts/ops/backup.sh ] || { warn "缺少 scripts/ops/backup.sh，无法执行发布前备份"; return 1; }
    log "执行发布前数据库备份"
    if ! ENV_FILE="$ENV_FILE" COMPOSE_FILE="$COMPOSE_FILE" bash scripts/ops/backup.sh; then
        warn "发布前备份失败"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------- 迁移

run_migrations() {
    # 迁移与应用同一个镜像：镜像内的迁移文件与本次发布的代码同 commit。
    # --no-deps：db 已在跑（预检已确认健康），不让 compose 再动它
    # --pull never：镜像已在 pull 阶段拉好，现场绝不联网拉取
    # -T：非交互（CI / SSH）下不分配 TTY
    log "执行数据库迁移（与应用同镜像，先行，失败即中止，旧版本继续服务）"
    compose run --rm --no-deps --pull never -T migrate
}

# ---------------------------------------------------------------- 镜像拉取

# 镜像仓库路径（registry/namespace/repo）。
# 权威来源是 env 文件里已钉的 TREND_IMAGE_REPO：compose 的 image 引用就是
# `${TREND_IMAGE_REPO:-默认}` 拼出来的，钉住的值与 compose 实际拉的是同一个仓库。
# compose 推导只作兜底（未钉时的默认值），且推导结果可能与 CI 推送目标不一致
# ——namespace 变更时会出现「推 A 仓、拉 B 仓」。
# 注意：config --images 的输出顺序是散列序，不能取第一行——第一行可能是
#       caddy:2-alpine 这类三方镜像。只认「registry/namespace/repo」三段式
#       自有镜像才符合；仓库名（第三段）必须保留。
image_repo_path() {
    local pinned candidates
    pinned="$(env_get TREND_IMAGE_REPO '')"
    if [ -n "$pinned" ]; then
        printf '%s' "$pinned"
        return 0
    fi
    # 未钉住时才从 compose 推导：只认「registry/namespace/repo」三段式自有镜像。
    # 候选多于一个说明 compose 里混了别家的三段式镜像，宁可不猜——
    # 猜错会把清理打到别人的仓库上
    candidates="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --images 2>/dev/null \
        | grep -E '^[^/]+/[^/]+/[^/]+:' | sed -E 's|:[^/:]+$||' | sort -u || true)"
    case "$(printf '%s\n' "$candidates" | grep -c . || true)" in
        1) printf '%s' "$candidates" ;;
        0) warn "compose 里没有三段式自有镜像，无法推导镜像仓库路径" ;;
        *) warn "compose 里有多个三段式镜像，无法判定自有镜像仓库：$candidates" ;;
    esac
}

pull_images() {
    # sha 短 tag 不可变：拉取失败但本地已有同 tag 镜像时继续走（回滚场景下仓库不可达）
    local svc repo_path failed=""
    repo_path="$(image_repo_path)"
    [ -n "$repo_path" ] || { warn "无法推导镜像仓库路径"; return 1; }
    for svc in $APP_SERVICES; do
        if compose pull "$svc"; then
            continue
        fi
        if docker image inspect "$repo_path:$IMAGE_TAG" >/dev/null 2>&1; then
            warn "$svc 拉取失败，本地已有 $repo_path:${IMAGE_TAG}，继续"
        else
            failed="$failed $svc"
        fi
    done
    [ -z "$failed" ] || { warn "镜像拉取失败且本地无对应镜像：$failed"; return 1; }

    # 基础镜像：版本固定、服务器上长期存在，拉不动就靠本地副本
    for svc in $BASE_SERVICES; do
        compose pull "$svc" >/dev/null 2>&1 || warn "$svc 基础镜像拉取失败，沿用服务器本地副本"
    done
    return 0
}

# ---------------------------------------------------------------- 健康检查

wait_healthy() {
    local timeout="$1" deadline bad name running health
    deadline=$(( $(date +%s) + timeout ))
    while :; do
        bad=""
        for cid in $(compose ps -q --all 2>/dev/null); do
            name="$(docker inspect -f '{{.Name}}' "$cid" 2>/dev/null | sed 's|^/||')"
            running="$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo unknown)"
            health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo unknown)"
            if [ "$running" != "true" ]; then
                bad="$bad ${name}(running=$running)"
            elif [ "$health" != "none" ] && [ "$health" != "healthy" ]; then
                bad="$bad ${name}(health=$health)"
            fi
        done
        [ -z "$bad" ] && return 0
        if [ "$(date +%s)" -ge "$deadline" ]; then
            warn "超时 ${timeout}s 仍未健康：$bad"
            return 1
        fi
        sleep 5
    done
}

probe_health() {
    # 容器内探活：不依赖公网 DNS，证书刚签发或 DNS 未生效时也能判活
    local cid
    cid="$(compose ps -q app 2>/dev/null || true)"
    [ -n "$cid" ] || return 1
    docker exec "$cid" node -e \
        "fetch('http://127.0.0.1:'+(process.env.PORT??3940)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
        >/dev/null 2>&1
}

# ---------------------------------------------------------------- 状态与回滚

read_state_field() {
    [ -f "$STATE_FILE" ] || return 0
    grep -E "^$1=" "$STATE_FILE" | tail -n 1 | cut -d= -f2- || true
}

resolve_commit() {
    # 本次发布的 commit：CI 直传时落盘的 .deploy-commit 最准（服务器没有 git 仓库）；
    # 最后退化为 tag 的 sha 片段
    local tag="$1" sha
    sha="${tag#*-}"
    if [ -f "$COMMIT_FILE" ]; then
        cat "$COMMIT_FILE"
        return 0
    fi
    git rev-parse --verify "$sha" 2>/dev/null || echo "$sha"
}

write_state() {
    local status="$1" current="$2" previous="$3" commit="$4" repo="$5" prev_repo="$6"
    cat > "$STATE_FILE" <<EOF
env=$ENV_NAME
current_tag=$current
previous_tag=$previous
commit=$commit
image_repo=$repo
previous_image_repo=$prev_repo
deployed_at=$(date '+%Y-%m-%dT%H:%M:%S%z')
status=$status
EOF
}

rollback_to() {
    local prev="$1" prev_commit="$2" prev_repo="${3:-}"
    if [ -z "$prev" ]; then
        warn "没有可回滚的版本（env 备份中无 IMAGE_TAG），保持现场等待人工处理"
        return 1
    fi
    [ -n "$prev_commit" ] || prev_commit="${prev#*-}"
    warn "开始回滚到 $prev"
    set_env_var IMAGE_TAG "$prev"
    # 回滚目标可能属于另一个镜像仓库（namespace 变更过），一并退回
    if [ -n "$prev_repo" ]; then
        set_env_var TREND_IMAGE_REPO "$prev_repo"
    fi
    restore_owner "$ENV_OWNER"
    if pull_images >/dev/null 2>&1 && compose up -d --wait --remove-orphans --no-build --pull never >/dev/null 2>&1; then
        if wait_healthy 180 && probe_health; then
            warn "回滚成功：当前运行 $prev"
            write_state ROLLED_BACK "$prev" "" "$prev_commit" "$(env_get TREND_IMAGE_REPO '')" ""
            return 0
        fi
    fi
    warn "回滚失败，需人工介入"
    write_state FAILED_ROLLED_BACK_FAILED "$prev" "" "$prev_commit" "$(env_get TREND_IMAGE_REPO '')" ""
    return 1
}

# ---------------------------------------------------------------- 镜像与备份清理

cleanup_images() {
    # cleanup_images <豁免版本列表>
    # 列表里的 tag 永不删除（当前运行版本 + 回滚目标）；其余按仓库保留最新 N 个。
    # 仓库取 $CLEANUP_REPOS（本次目标仓库 + 回滚目标仓库），不取 env 文件里的当前值——
    # 回滚后那里指的是旧仓库，照它清理会漏掉本次刚拉下来的镜像。
    # 只认本环境前缀的 sha tag（staging=develop-，prod=main-）：
    # 放行另一前缀会让无关 tag 挤占「保留最新 N 个」的额度，挤掉回滚目标
    local protect="$1" repo_path repo tags i t size images removed=0 freed=0
    if [ -z "$CLEANUP_REPOS" ]; then
        warn "未确定镜像仓库路径，跳过镜像清理"
        return 0
    fi
    for repo_path in $CLEANUP_REPOS; do
        repo="${repo_path##*/}"
        # 一次 docker images 同时服务「该仓库是否存在」与「tag 提取」
        images="$(docker images --format '{{.Repository}}\t{{.Tag}}\t{{.CreatedAt}}' "$repo_path" 2>/dev/null || true)"
        if [ -z "$images" ]; then
            # 空结果不是「无需清理」的证据——多半是仓库路径不对，旧镜像会一直堆着
            warn "镜像清理过滤未命中（本地无该仓库镜像）：$repo_path"
            continue
        fi
        tags="$(printf '%s\n' "$images" \
            | awk -F'\t' -v p="${TAG_PREFIX}-" '$2 ~ "^"p"[0-9a-f]{7,40}$"' \
            | sort -k3 -r | cut -f2)"
        if [ -z "$tags" ]; then
            log "  ${repo}：本地无 ${TAG_PREFIX}- 版本镜像，跳过"
            continue
        fi
        i=0
        for t in $tags; do
            i=$((i + 1))
            if [ "$i" -gt "$KEEP_IMAGES" ] && ! in_list "$t" "$protect"; then
                size="$(docker image inspect --format '{{.Size}}' "$repo_path:$t" 2>/dev/null || echo 0)"
                if docker image rm "$repo_path:$t" >/dev/null 2>&1; then
                    removed=$((removed + 1))
                    freed=$((freed + size))
                else
                    warn "镜像删除失败（可能被容器引用）：$repo_path:$t"
                fi
            fi
        done
    done
    # 只清悬空层：docker image prune -a 会连回滚目标一起删掉
    docker image prune -f >/dev/null 2>&1 || true
    log "镜像清理完成：删除 $removed 个镜像，镜像体积合计约 $((freed / 1024 / 1024)) MB（每个仓库保留最新 $KEEP_IMAGES 个）"
}

prune_backups() {
    #（head -n -N 在 BSD head 上不支持，改用计数 + sed 取前 N 行；
    #  不用 head：head 提前退出会让上游吃 SIGPIPE，pipefail 下误判为失败）
    local files count
    files="$(ls -1 "$ENV_FILE.bak"* 2>/dev/null | sort || true)"
    count="$(printf '%s' "$files" | grep -c . || true)"
    if [ "${count:-0}" -gt 3 ]; then
        printf '%s\n' "$files" | sed -n "1,$((count - 3))p" | while read -r f; do
            rm -f "$f"
        done
    fi
    if [ -d "$LOG_DIR" ]; then
        ls -1t "$LOG_DIR"/*.log 2>/dev/null | tail -n +11 | while read -r f; do
            rm -f "$f"
        done
    fi
}

# ---------------------------------------------------------------- 退出兜底

# 镜像清理由退出兜底保证：无论成功、失败还是中途退出都跑一次。
# 原先清理只挂在成功路径末尾——预检失败（磁盘不足）就不跑，
# 「磁盘余量不足 → 预检失败 → 不清理 → 磁盘永远不足」是个闭环。
on_exit() {
    local rc=$?
    trap - EXIT
    if [ "$CLEANUP_DONE" -eq 1 ] || [ "$TRAP_READY" -eq 0 ]; then
        exit $rc
    fi
    cleanup_images "$PROTECT_TAGS" || true
    exit $rc
}

# ---------------------------------------------------------------- 主流程

main() {
    parse_args "$@"
    validate

    local owner previous commit prev_commit previous_repo current_repo
    # 上一个版本 = 当前配置里的 IMAGE_TAG（改之前）；空则退到备份与状态文件
    previous="$(env_get IMAGE_TAG '')"
    [ -n "$previous" ] || previous="$(grep -E '^IMAGE_TAG=' "$ENV_FILE.bak" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
    # 状态文件兜底取 current_tag（正在跑的版本）：previous_tag 是回滚目标，
    # 当作「上一个版本」会把回滚链指向两代之前
    [ -n "$previous" ] || previous="$(read_state_field current_tag)"
    # 上一个版本的镜像仓库路径：namespace 变更过时回滚必须退到旧仓库
    previous_repo="$(read_state_field image_repo)"
    [ -n "$previous_repo" ] || previous_repo="$(env_get TREND_IMAGE_REPO '')"

    # 本次发布的目标仓库路径（CI 传入优先，否则取 env 文件里已钉的值）：
    # 改 env 文件之前算出来，清理时不必再从配置反推
    current_repo="$IMAGE_REPO"
    [ -n "$current_repo" ] || current_repo="$(env_get TREND_IMAGE_REPO '')"
    # 清理范围 = 本次目标仓库 + 回滚目标仓库（namespace 变更过时两者不同，
    # 只清一个会漏——刚拉下来的新仓库镜像永远留着）
    append_repo "$current_repo"
    append_repo "$previous_repo"
    append_repo "$(image_repo_path)"

    # 豁免名单先算出来：退出兜底要靠它保护「当前运行版本」与「回滚目标」。
    # 必须在 preflight 之前——预检失败正是最需要清理的路径。
    PROTECT_TAGS="$previous $IMAGE_TAG"
    TRAP_READY=1
    trap on_exit EXIT

    preflight

    owner="$(stat_owner "$ENV_FILE")"
    ENV_OWNER="$owner"
    # 上一个版本的 commit = 旧状态文件里的 commit（本次发布覆盖前先取出来）
    prev_commit="$(read_state_field commit)"
    commit="$(resolve_commit "$IMAGE_TAG")"

    rotate_env_backup
    set_env_var IMAGE_TAG "$IMAGE_TAG"
    if [ -n "$current_repo" ]; then
        set_env_var TREND_IMAGE_REPO "$current_repo"
    fi
    restore_owner "$owner"
    log "环境 ${ENV_NAME}：IMAGE_TAG 钉为 ${IMAGE_TAG}（上一个版本：${previous:-无}）"
    if [ -n "$current_repo" ]; then
        log "镜像仓库钉为 ${current_repo}"
    fi

    # 拉镜像 / 备份 / 迁移阶段失败时还没换容器，必须把 IMAGE_TAG 退回上一个版本——
    # 否则配置会指向一个从未跑起来的 tag，下一次部署的回滚目标就错了
    if ! pull_images; then
        restore_prev_tag "$previous" "$owner" "$previous_repo"
        fail "镜像拉取失败：$IMAGE_TAG"
    fi

    if ! run_backup; then
        restore_prev_tag "$previous" "$owner" "$previous_repo"
        fail "发布前备份失败：已中止发布，旧版本继续服务（未换容器）"
    fi

    if ! run_migrations; then
        restore_prev_tag "$previous" "$owner" "$previous_repo"
        fail "数据库迁移失败：已中止发布，旧版本继续服务（未换容器）"
    fi

    if ! compose up -d --wait --remove-orphans --no-build --pull never; then
        warn "容器更新失败"
        write_state FAILED "$IMAGE_TAG" "$previous" "$commit" "$current_repo" "$previous_repo"
        rollback_to "$previous" "$prev_commit" "$previous_repo" || true
        fail "部署失败，已尝试回滚"
    fi

    if ! wait_healthy "$HEALTH_TIMEOUT" || ! probe_health; then
        warn "健康检查未通过"
        write_state FAILED "$IMAGE_TAG" "$previous" "$commit" "$current_repo" "$previous_repo"
        rollback_to "$previous" "$prev_commit" "$previous_repo" || true
        fail "部署失败（健康检查未通过），已尝试回滚"
    fi

    write_state OK "$IMAGE_TAG" "$previous" "$commit" "$current_repo" "$previous_repo"
    log "部署成功：${ENV_NAME} ${IMAGE_TAG}（commit ${commit}）"

    # 当前运行版本已是新版本，豁免名单保持「新版本 + 回滚目标」
    cleanup_images "$PROTECT_TAGS" || true
    CLEANUP_DONE=1
    prune_backups
    log "完成"
}

main "$@"
