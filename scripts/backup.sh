#!/usr/bin/env bash
# Database backup script.
# Intended to run as a cron job, e.g.:
#   0 2 * * * /path/to/AnchorPoint/scripts/backup.sh >> /var/log/anchorpoint-backup.log 2>&1
#
# Required environment variables (set in .env or the cron environment):
#   DATABASE_URL      — PostgreSQL connection string
#   BACKUP_DIR        — Directory to write backup files (default: /var/backups/anchorpoint)
#   BACKUP_RETENTION  — Number of days to keep old backups (default: 14)
#
# Optional environment variables:
#   BACKUP_VERIFY_RESTORE — "1" to run an automated restore check against a
#                           temporary PostgreSQL container (default: "1" when
#                           docker is available, otherwise "0")
#   ALERT_WEBHOOK_URL     — Slack / PagerDuty incoming-webhook URL. When set,
#                           a JSON alert is POSTed on backup failure.
#   BACKUP_RESTORE_IMAGE  — PostgreSQL image used for the restore check
#                           (default: postgres:16-alpine)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/anchorpoint}"
BACKUP_RETENTION="${BACKUP_RETENTION:-14}"
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/anchorpoint-${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
BACKUP_RESTORE_IMAGE="${BACKUP_RESTORE_IMAGE:-postgres:16-alpine}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }
logerr() { echo "[$(date -u +%FT%TZ)] ERROR: $*" >&2; }

# Send a failure alert to the configured webhook (Slack/PagerDuty). Never lets
# the alert itself fail the backup run — a broken webhook must not mask the
# original error.
send_alert() {
  local summary="$1"
  local detail="$2"
  if [[ -z "${ALERT_WEBHOOK_URL}" ]]; then
    return 0
  fi
  local payload
  payload="$(jq -n \
    --arg summary "${summary}" \
    --arg detail "${detail}" \
    '{event: "anchorpoint-backup", severity: "error", summary: $summary, detail: $detail, timestamp: (now | todate)}' 2>/dev/null)" || return 0

  curl -fsS -m 15 \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "${ALERT_WEBHOOK_URL}" >/dev/null 2>&1 || logerr "Alert delivery to webhook failed (non-fatal)"
}

# Run an automated restore check: spin up a throwaway PostgreSQL container,
# restore the freshly created backup into it, and confirm the restore succeeds.
# On success the container is removed; on failure the container name is left in
# the log for inspection.
verify_restore() {
  if [[ "${BACKUP_VERIFY_RESTORE:-$(command -v docker >/dev/null 2>&1 && echo 1 || echo 0)}" != "1" ]]; then
    log "Restore verification skipped (BACKUP_VERIFY_RESTORE != 1 or docker unavailable)"
    return 0
  fi

  if ! command -v docker >/dev/null 2>&1; then
    logerr "Restore verification requested but docker is not installed — skipping"
    return 0
  fi

  local container="anchorpoint-restore-check-${TIMESTAMP}"
  local db_name="anchorpoint_verify"
  local db_user="anchorpoint"
  local db_pass="anchorpoint_verify"

  log "Restore check: starting temporary container ${container} (${BACKUP_RESTORE_IMAGE})"

  if ! docker run -d --name "${container}" \
    -e "POSTGRES_DB=${db_name}" \
    -e "POSTGRES_USER=${db_user}" \
    -e "POSTGRES_PASSWORD=${db_pass}" \
    -p 127.0.0.1::5432 \
    "${BACKUP_RESTORE_IMAGE}" >/dev/null 2>&1; then
    logerr "Restore check failed: could not start temporary PostgreSQL container"
    return 1
  fi

  local port
  port="$(docker port "${container}" 5432/tcp 2>/dev/null | sed 's/.*://' | head -1)"
  if [[ -z "${port}" ]]; then
    logerr "Restore check failed: could not determine container port"
    docker rm -f "${container}" >/dev/null 2>&1 || true
    return 1
  fi

  local restore_url="postgresql://${db_user}:${db_pass}@127.0.0.1:${port}/${db_name}"

  # Wait for the container to accept connections (up to 30s)
  local ready=0
  for _ in $(seq 1 30); do
    if docker exec "${container}" pg_isready -U "${db_user}" -d "${db_name}" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done

  if [[ "${ready}" != "1" ]]; then
    logerr "Restore check failed: temporary container never became ready"
    docker rm -f "${container}" >/dev/null 2>&1 || true
    return 1
  fi

  # Restore the backup. Failure here means the backup file is not restorable.
  if ! gunzip -c "${BACKUP_FILE}" | docker exec -i "${container}" \
    psql -U "${db_user}" -d "${db_name}" -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
    logerr "Restore check failed: backup could not be restored into the temporary container"
    docker rm -f "${container}" >/dev/null 2>&1 || true
    return 1
  fi

  docker rm -f "${container}" >/dev/null 2>&1 || true
  log "Restore check passed: backup restored cleanly into a temporary PostgreSQL container"
  return 0
}

# Guard: cleanup a partially written backup file on early exit
cleanup() {
  if [[ -f "${BACKUP_FILE}" ]] && ! [[ -s "${BACKUP_FILE}" ]]; then
    rm -f "${BACKUP_FILE}" "${CHECKSUM_FILE}"
  fi
}
trap cleanup EXIT

if [[ -z "${DATABASE_URL:-}" ]]; then
  logerr "DATABASE_URL is not set"
  send_alert "AnchorPoint backup failed" "DATABASE_URL is not set"
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

log "Starting backup → ${BACKUP_FILE}"

if ! pg_dump "${DATABASE_URL}" \
  --format=plain \
  --no-owner \
  --no-acl \
  | gzip > "${BACKUP_FILE}"; then
  logerr "pg_dump failed"
  send_alert "AnchorPoint backup failed" "pg_dump failed for ${BACKUP_FILE}"
  exit 1
fi

log "Backup complete ($(du -sh "${BACKUP_FILE}" | cut -f1))"

# 1. SHA-256 checksum generation for integrity verification
if command -v sha256sum >/dev/null 2>&1; then
  (cd "${BACKUP_DIR}" && sha256sum "$(basename "${BACKUP_FILE}")" > "$(basename "${CHECKSUM_FILE}")")
  log "Checksum written → ${CHECKSUM_FILE}"
else
  logerr "sha256sum not found — checksum skipped"
fi

# 2. Automated restore verification against a temporary container
if ! verify_restore; then
  send_alert "AnchorPoint backup failed" "Restore verification failed for ${BACKUP_FILE}"
  exit 1
fi

# 3. Remove backups older than BACKUP_RETENTION days
find "${BACKUP_DIR}" -name "anchorpoint-*.sql.gz" -mtime "+${BACKUP_RETENTION}" -print -delete \
  | sed "s/^/[$(date -u +%FT%TZ)] Removed old backup: /"

log "Done"