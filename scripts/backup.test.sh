#!/usr/bin/env bash
# Tests for scripts/backup.sh — checksum generation, failure alerts, and
# restore-verification wiring, using mocked binaries so no real database,
# docker, or network is required.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT

failures=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; failures=$((failures + 1)); }

# --- Prepare a fake environment -------------------------------------------
FAKE_BIN="${WORKDIR}/bin"
mkdir -p "${FAKE_BIN}"

# fake pg_dump: emit a deterministic payload so checksum/restore logic has
# something real to work with
cat > "${FAKE_BIN}/pg_dump" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' '-- mocked pg_dump output' 'CREATE TABLE users (id int);'
FAKE

# fake gzip: transparent passthrough (keeps the payload checkable)
cat > "${FAKE_BIN}/gzip" <<'FAKE'
#!/usr/bin/env bash
exec cat
FAKE

# fake gunzip: passthrough
cat > "${FAKE_BIN}/gunzip" <<'FAKE'
#!/usr/bin/env bash
exec cat
FAKE

# fake docker: records invocations; restore verification flow is exercised by
# making the container "ready" and psql "restore" succeed
cat > "${FAKE_BIN}/docker" <<'FAKE'
#!/usr/bin/env bash
case "$1" in
  run)
    printf '%s\n' "restore-check-container-1"
    exit 0
    ;;
  port)
    printf '5432\n'
    exit 0
    ;;
  exec)
    for arg in "$@"; do
      if [[ "$arg" == *"pg_isready"* ]]; then exit 0; fi
    done
    for arg in "$@"; do
      if [[ "$arg" == *"psql"* ]]; then exit 0; fi
    done
    exit 1
    ;;
  rm)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
FAKE

# fake jq: mimic `jq -n --arg ...` by echoing the summary argument as JSON
cat > "${FAKE_BIN}/jq" <<'FAKE'
#!/usr/bin/env bash
summary=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--arg" && "$2" == "summary" ]]; then
    summary="$3"
    break
  fi
  shift
done
printf '{"event":"anchorpoint-backup","severity":"error","summary":"%s"}\n' "${summary}"
FAKE

# fake curl: capture webhook payloads
cat > "${FAKE_BIN}/curl" <<'FAKE'
#!/usr/bin/env bash
if [[ "${FAKE_CURL_OUT:-}" != "" ]]; then
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "-d" ]]; then shift; printf '%s' "$1" > "${FAKE_CURL_OUT}"; break; fi
    shift
  done
fi
exit 0
FAKE

# fake sha256sum: deterministic checksum
cat > "${FAKE_BIN}/sha256sum" <<'FAKE'
#!/usr/bin/env bash
printf 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  %s\n' "$(basename "$1")"
FAKE

chmod +x "${FAKE_BIN}"/*

run_backup() {
  env \
    PATH="${FAKE_BIN}:${PATH}" \
    DATABASE_URL="postgresql://u:p@localhost/db" \
    BACKUP_DIR="${WORKDIR}/backups" \
    BACKUP_RETENTION="14" \
    BACKUP_VERIFY_RESTORE="${BACKUP_VERIFY_RESTORE:-0}" \
    "${BACKUP_SCRIPT}" "$@"
}

echo "== test: creates backup file and .sha256 checksum sidecar =="
if run_backup > "${WORKDIR}/run1.log" 2>&1; then
  backup_files=("${WORKDIR}/backups"/*.sql.gz)
  checksum_files=("${WORKDIR}/backups"/*.sql.gz.sha256)
  if [[ -f "${backup_files[0]}" && -f "${checksum_files[0]}" ]]; then
    pass "backup + checksum files created"
    if grep -q "deadbeef" "${checksum_files[0]}"; then
      pass "checksum contains expected digest"
    else
      fail "checksum content unexpected"
    fi
  else
    fail "backup or checksum file missing"
  fi
else
  cat "${WORKDIR}/run1.log"
  fail "backup script exited non-zero"
fi

echo "== test: restore verification runs when docker is available =="
BACKUP_VERIFY_RESTORE=1 run_backup > "${WORKDIR}/verify.log" 2>&1
if grep -q "Restore check passed" "${WORKDIR}/verify.log"; then
  pass "restore verification executed and passed"
else
  cat "${WORKDIR}/verify.log"
  fail "restore verification did not run/pass"
fi

echo "== test: restore verification is skipped without docker =="
if env \
  PATH="${FAKE_BIN}:${PATH}" \
  DATABASE_URL="postgresql://u:p@localhost/db" \
  BACKUP_DIR="${WORKDIR}/backups2" \
  BACKUP_RETENTION="14" \
  BACKUP_VERIFY_RESTORE=0 \
  "${BACKUP_SCRIPT}" > "${WORKDIR}/skip.log" 2>&1; then
  if grep -q "Restore verification skipped" "${WORKDIR}/skip.log"; then
    pass "restore verification skipped when disabled"
  else
    fail "expected skip message missing"
  fi
else
  cat "${WORKDIR}/skip.log"
  fail "backup with restore-verify disabled exited non-zero"
fi

echo "== test: failure alert posted to webhook when pg_dump fails =="
cat > "${FAKE_BIN}/pg_dump" <<'FAKE'
#!/usr/bin/env bash
echo "simulated pg_dump failure" >&2
exit 1
FAKE
if env \
  PATH="${FAKE_BIN}:${PATH}" \
  DATABASE_URL="postgresql://u:p@localhost/db" \
  BACKUP_DIR="${WORKDIR}/backups3" \
  BACKUP_RETENTION="14" \
  BACKUP_VERIFY_RESTORE=0 \
  ALERT_WEBHOOK_URL="https://hooks.example/webhook" \
  FAKE_CURL_OUT="${WORKDIR}/alert.json" \
  "${BACKUP_SCRIPT}" > "${WORKDIR}/alert.log" 2>&1; then
  fail "backup should have failed when pg_dump fails"
else
  pass "backup script exits non-zero on pg_dump failure"
fi
if [[ -f "${WORKDIR}/alert.json" ]] && grep -q "AnchorPoint backup failed" "${WORKDIR}/alert.json"; then
  pass "alert webhook received failure payload"
else
  fail "alert payload missing or unexpected: $(cat "${WORKDIR}/alert.json" 2>/dev/null || echo '<empty>')"
fi

echo
if [[ "${failures}" -eq 0 ]]; then
  echo "All backup tests passed."
  exit 0
else
  echo "${failures} backup test(s) failed."
  exit 1
fi