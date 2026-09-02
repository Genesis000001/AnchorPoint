#!/usr/bin/env bash
#
# Synthetic smoke tests for production endpoint monitoring.
# Verifies core health, SEP-1 TOML, SEP-10 challenge, and /info flows.
#
# Usage:
#   TARGET_HOST=https://api.example.com ./scripts/smoke-test.sh
#
# Environment:
#   TARGET_HOST          Required (falls back to BASE_URL). API origin or host.
#   SMOKE_TEST_ACCOUNT   Optional Stellar public key used for GET /auth.
#   SMOKE_TEST_CONNECT_TIMEOUT  Optional curl connect timeout (default 10s).
#   SMOKE_TEST_MAX_TIME         Optional curl max time (default 30s).
#
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed, or required configuration is missing

set -euo pipefail

TARGET_HOST="${TARGET_HOST:-${BASE_URL:-}}"
SMOKE_TEST_ACCOUNT="${SMOKE_TEST_ACCOUNT:-GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K}"
CONNECT_TIMEOUT="${SMOKE_TEST_CONNECT_TIMEOUT:-10}"
MAX_TIME="${SMOKE_TEST_MAX_TIME:-30}"
# Comma/space separated list of hosts whose TLS certificates must be checked.
# Defaults to the AnchorPoint testnet hostnames managed by cert-manager.
CERT_HOSTS="${CERT_HOSTS:-api.anchorpoint-testnet.example.com,worker.anchorpoint-testnet.example.com,dashboard.anchorpoint-testnet.example.com,soroban.anchorpoint-testnet.example.com}"
# Minimum number of days remaining before a certificate is considered at risk.
CERT_MIN_DAYS_REMAINING="${CERT_MIN_DAYS_REMAINING:-14}"
FAILURES=0

if [[ -z "$TARGET_HOST" ]]; then
  printf '[smoke-test][ERROR] TARGET_HOST must be set.\n' >&2
  exit 1
fi

if [[ ! "$SMOKE_TEST_ACCOUNT" =~ ^G[A-Z2-7]{55}$ ]]; then
  printf '[smoke-test][ERROR] SMOKE_TEST_ACCOUNT must be a valid Stellar public key.\n' >&2
  exit 1
fi

# Allow a bare host (api.example.com) or a full origin (https://api.example.com).
if [[ ! "$TARGET_HOST" =~ ^https?:// ]]; then
  TARGET_HOST="https://${TARGET_HOST}"
fi

TARGET_HOST="${TARGET_HOST%/}"

check_endpoint() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local status
  local -a curl_args=(
    --silent
    --show-error
    --output /dev/null
    --write-out '%{http_code}'
    --connect-timeout "$CONNECT_TIMEOUT"
    --max-time "$MAX_TIME"
    --request "$method"
  )

  if [[ -n "$body" ]]; then
    curl_args+=(--header 'Content-Type: application/json' --data "$body")
  fi

  if ! status="$(curl "${curl_args[@]}" "${TARGET_HOST}${path}")"; then
    printf '[smoke-test][FAIL] %s %s (request failed)\n' "$method" "$path" >&2
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  if [[ "$status" != "200" ]]; then
    printf '[smoke-test][FAIL] %s %s (HTTP %s)\n' "$method" "$path" "$status" >&2
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  printf '[smoke-test][PASS] %s %s (HTTP 200)\n' "$method" "$path"
}

check_endpoint GET '/health'
check_endpoint GET '/.well-known/stellar.toml'
check_endpoint GET "/auth?account=${SMOKE_TEST_ACCOUNT}"
check_endpoint GET '/info'
check_endpoint POST '/sep10' "{\"account\":\"${SMOKE_TEST_ACCOUNT}\"}"
check_endpoint GET '/sep24/info'
check_endpoint GET '/sep38/info'

# -----------------------------------------------------------------------------
# Certificate expiration check
# Connects to each host over TLS and verifies the presented certificate has more
# than CERT_MIN_DAYS_REMAINING days left before expiration. This catches
# Let's Encrypt certificates that failed to auto-renew before they expire.
# -----------------------------------------------------------------------------
check_certificate_expiry() {
  local host="$1"
  local cert_text expiry_ts now_ts days_left

  if ! cert_text="$(echo | openssl s_client -servername "$host" -connect "${host}:443" 2>/dev/null)"; then
    printf '[smoke-test][FAIL] %s (unable to connect on :443)\n' "$host" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi

  expiry_ts="$(printf '%s\n' "$cert_text" \
    | openssl x509 -noout -enddate 2>/dev/null \
    | sed 's/notAfter=//')"

  if [[ -z "$expiry_ts" ]]; then
    printf '[smoke-test][FAIL] %s (no certificate presented)\n' "$host" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi

  now_ts="$(date +%s)"
  expiry_ts="$(date -d "$expiry_ts" +%s 2>/dev/null || date -j -f '%b %e %H:%M:%S %Y %Z' "$expiry_ts" +%s 2>/dev/null)"

  if [[ -z "$expiry_ts" ]]; then
    printf '[smoke-test][FAIL] %s (unable to parse certificate expiry)\n' "$host" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi

  days_left=$(( (expiry_ts - now_ts) / 86400 ))

  if [[ "$days_left" -lt "$CERT_MIN_DAYS_REMAINING" ]]; then
    printf '[smoke-test][FAIL] %s certificate expires in %s days (threshold %s)\n' \
      "$host" "$days_left" "$CERT_MIN_DAYS_REMAINING" >&2
    FAILURES=$((FAILURES + 1))
    return
  fi

  printf '[smoke-test][PASS] %s certificate valid for %s days\n' "$host" "$days_left"
}

for host in ${CERT_HOSTS//,/ }; do
  check_certificate_expiry "$host"
done

if [[ "$FAILURES" -gt 0 ]]; then
  printf '[smoke-test][ERROR] %s endpoint check(s) failed.\n' "$FAILURES" >&2
  exit 1
fi

printf '[smoke-test] All endpoint checks passed.\n'
exit 0
